// ─────────────────────────────────────────────────────────────────────────────
// ONDE ESTÁ CADA LEAD DO QUIZ DO SOLARDOC (26/10/2026). SÓ LEITURA. (A escrita do registro da ligação é do followupQuizSolardoc.)
//
// A tela "Quiz SolarDoc" do /gerador mostra, por lead: a Carla chamou? o time foi avisado? comprou? em que pé está a ligação? As respostas moram em dois bancos:
//   - os leads: `leads_meta` no banco do GERADOR (form_id 'quiz_solardoc'; lead_id 'sdquiz_<DDD+8>');
//   - o que a Carla e o aviso fizeram: `system_state` no banco PRINCIPAL, em chaves com o HMAC do telefone.
// Os dois clientes têm o mesmo método `.from()` e nenhum tipo pega a troca, por isso o teste de estrutura lê este arquivo.
//
// Nada aqui escreve, envia ou muda robô. Chaves, claim, largada, HMAC e compra são os MESMOS que os robôs usam (importados).
// Leitura que falha vira "nao_conferiu", nunca "não chamou" nem "não comprou". Telefone e nome não saem daqui: a resposta é por lead_id.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { chaveDoTelefone, normalizarTelefoneSd } from './quizSolardoc';
import { ehLeadDeTeste, PREFIXO_CLAIM_QUIZ } from './avisoGrupoSolardoc';
import { chavesComPlanoPago, vendasDesde, type VendasComData } from './compraQuizSolardoc';
import { estadoRecuperacaoCarla, lerLargada, type EstadoRecuperacao } from './recuperacaoCarlaEstado';
import { hmacDoLeadRec } from './recuperacaoCarla';
import { PREFIXO_CARIMBO_REC, campoFd, semCnpj, type LeadRec } from './recuperacaoCarlaRegras';
import { PREFIXO_FOLLOWUP, estadoDoFollowup, histDoValor, type FollowupDoLead } from './followupQuizSolardoc';

export const DIAS_PADRAO = 60;
export const DIAS_MAXIMO = 180;
export const LIMITE_LEADS = 1000;
export const LOTE_CHAVES = 100;
export const FORM_ID_QUIZ_SD = 'quiz_solardoc';
const SUFIXO_SEM_VAGA = ':semvaga';

// ── tipos da resposta ────────────────────────────────────────────────────────

/**
 * chamou = envio provado (estado 'enviado'); tentou = o robô gravou que tentou (`detalhe` diz se a mensagem não saiu ou ficou incerta);
 * sem_confirmacao = existe o claim da Carla mas sem estado (nasce só com a hora; fica assim se nada foi tentado ou se a gravação do
 * 'enviado' falhou), então não dá para afirmar nada; nao_chamou = sem claim; nao_conferiu = a leitura falhou.
 */
export type EstadoCarla = 'chamou' | 'tentou' | 'sem_confirmacao' | 'nao_chamou' | 'nao_conferiu';
export interface CarlaDoLead { estado: EstadoCarla; em: string | null; motivo: string | null; detalhe?: 'nao_saiu' | 'incerto' }
export type NaoConferiu = { nao_conferiu: true };
export type AvisoDoLead = { em: string | null; tipo: string } | NaoConferiu | null;
export type CompraDoLead = { em: string | null } | NaoConferiu | null;
export interface StatusDoLead { carla: CarlaDoLead; aviso: AvisoDoLead; comprou: CompraDoLead; followup: FollowupDoLead | null }

export interface RespostaStatus {
  ok: true;
  carla_ligada: boolean;
  carla_motivo: string;
  largada: string | null;
  truncado: boolean;
  /** A fila de ligação: quantos leads (fora os de teste) estão com a ligação devida hoje. */
  /** `incompleta`: alguma leitura do follow-up falhou (ou faltou hmac); esses leads vêm com `followup: null` e não entram na conta. */
  fila: { para_ligar_hoje: number; incompleta: boolean };
  status: Record<string, StatusDoLead>;
}

/** Linha de `system_state` (só o que a tela precisa). */
export interface LinhaEstado { key: string; value?: unknown }

// ── puro ─────────────────────────────────────────────────────────────────────

/** Dias pedidos: 60 se não vier número, nunca menos que 1 nem mais que 180. */
export function limitarDias(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return DIAS_PADRAO;
  return Math.min(n, DIAS_MAXIMO);
}

/** Parte a lista em pedaços de até `tam` (o `.in()` do PostgREST estoura a URL com chave demais). */
export function emLotes<T>(lista: readonly T[], tam: number = LOTE_CHAVES): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam));
  return out;
}

const valorDe = (l: LinhaEstado | undefined): Record<string, unknown> =>
  (l?.value && typeof l.value === 'object' ? l.value : {}) as Record<string, unknown>;
const textoOuNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const MOTIVO_ANTES_DA_LARGADA = 'Chegou antes de a Carla começar';
export const MOTIVO_TESTE = 'Teste';
export const MOTIVO_SEM_CNPJ = 'Sem CNPJ';

/**
 * O que a Carla fez com o lead, a partir da chave `quiz_rec_sent:<hmac>`.
 *   estado 'enviado' (gravado só depois de envio provado) = chamou;
 *   'nao_saiu' e 'incerto' = tentou (com o detalhe); claim sem estado (ou com estado desconhecido) = sem_confirmacao;
 *   sem chave = nao_chamou, com o motivo só quando sai fácil (teste, antes da largada, sem CNPJ);
 *   `claim === undefined` com leitura que falhou, ou sem HMAC = nao_conferiu.
 * `largadaMs`: número = hora da largada; null = a Carla ainda não largou; undefined = a leitura da largada falhou (sem motivo de "antes").
 */
export function carlaDoLead(a: {
  lead: LeadRec; hmac: string | null; leituraOk: boolean; claim: LinhaEstado | undefined; largadaMs: number | null | undefined;
}): CarlaDoLead {
  if (!a.leituraOk || !a.hmac) return { estado: 'nao_conferiu', em: null, motivo: null };
  if (a.claim) {
    const v = valorDe(a.claim);
    const em = textoOuNull(v.em);
    if (v.estado === 'enviado') return { estado: 'chamou', em, motivo: null };
    if (v.estado === 'nao_saiu') return { estado: 'tentou', em, motivo: null, detalhe: 'nao_saiu' };
    if (v.estado === 'incerto') return { estado: 'tentou', em, motivo: null, detalhe: 'incerto' };
    return { estado: 'sem_confirmacao', em, motivo: null };
  }
  let motivo: string | null = null;
  const criado = Date.parse(String(a.lead.created_time ?? ''));
  if (ehLeadDeTeste(a.lead.field_data)) motivo = MOTIVO_TESTE;
  else if (typeof a.largadaMs === 'number' && Number.isFinite(criado) && criado < a.largadaMs) motivo = MOTIVO_ANTES_DA_LARGADA;
  else if (semCnpj(a.lead.field_data)) motivo = MOTIVO_SEM_CNPJ;
  return { estado: 'nao_chamou', em: null, motivo };
}

/** Estados da chave da desistência (`quiz_aviso:<hmac>`) em que o time recebeu o aviso, por grupo ou por e-mail. */
export const AVISADO_NA_DESISTENCIA: readonly string[] = ['enviado', 'enviado_cartao', 'email', 'sem_grupo', 'email_sem_grupo', 'falhou', 'expirado'];
/** Na chave `:semvaga` só estes: lá 'sem_grupo' e 'email' não geram e-mail nenhum (o resumo por e-mail só roda no tick). 'email_sem_grupo' (27/10) é o aviso que o robô da Carla mandou por e-mail no fim da rodada. */
export const AVISADO_NO_SEM_VAGA: readonly string[] = ['enviado', 'enviado_cartao', 'email_sem_grupo', 'falhou', 'expirado'];

/**
 * O time foi avisado? A chave `quiz_aviso:<hmac>` nasce 'novo' e fica 'pendente' até o tick enviar, e a do comprador ('comprou')
 * nunca envia nada: esses não contam. Sem grupo de vendas ('sem_grupo'), com falha de envio ('falhou') ou expirado, o aviso sai
 * por e-mail sem regravar a chave, então contam. O texto do aviso (leva o nome) não sai daqui.
 */
export function avisoDoLead(a: { leituraOk: boolean; hmac: string | null; desistencia: LinhaEstado | undefined; semVaga: LinhaEstado | undefined }): AvisoDoLead {
  if (!a.leituraOk || !a.hmac) return { nao_conferiu: true };
  const achados = ([[a.desistencia, AVISADO_NA_DESISTENCIA], [a.semVaga, AVISADO_NO_SEM_VAGA]] as const).flatMap(([l, contam]) => {
    const v = valorDe(l);
    return l && typeof v.estado === 'string' && contam.includes(v.estado) ? [{ em: textoOuNull(v.em), tipo: textoOuNull(v.tipo) ?? 'desistencia' }] : [];
  });
  if (!achados.length) return null;
  achados.sort((x, y) => (Date.parse(x.em ?? '') || Infinity) - (Date.parse(y.em ?? '') || Infinity));
  return achados[0];
}

/** A compra gravada no próprio claim do aviso (`estado:'comprou'`), com a data. */
export function compraNoClaim(linha: LinhaEstado | undefined): { em: string | null } | null {
  const v = valorDe(linha);
  return linha && v.estado === 'comprou' ? { em: textoOuNull(v.em) } : null;
}

// ── leitura ──────────────────────────────────────────────────────────────────

export interface DepsStatus {
  /** Leads do quiz criados desde `desdeIso`, mais novo primeiro, até `limite`. Erro LANÇA. */
  leads(desdeIso: string, limite: number): Promise<LeadRec[]>;
  /** Linhas de system_state destas chaves. null = a leitura falhou. */
  chaves(chaves: string[]): Promise<Map<string, LinhaEstado> | null>;
  estado(): Promise<EstadoRecuperacao>;
  /** Hora da largada (ms), null = ainda não largou. Erro LANÇA. */
  largada(): Promise<number | null>;
  /** Erro LANÇA. */
  vendas(desdeMs: number): Promise<VendasComData>;
  /** Das chaves dadas (DDD + 8 últimos), as que têm plano pago, numa leitura em lote. Erro LANÇA. */
  planos(chaves: string[]): Promise<Set<string>>;
}

export function depsStatusReais(): DepsStatus {
  return {
    async leads(desdeIso, limite) {
      const { data, error } = await supabaseGerador.from('leads_meta')
        .select('lead_id, nome, whatsapp, cidade, field_data, created_time')
        .eq('form_id', FORM_ID_QUIZ_SD).gte('created_time', desdeIso)
        .order('created_time', { ascending: false }).limit(limite);
      if (error) throw new Error(`ler leads do quiz: ${error.message}`);
      return (data ?? []) as LeadRec[];
    },
    async chaves(chaves) {
      const achadas = new Map<string, LinhaEstado>();
      try {
        for (const lote of emLotes(chaves, LOTE_CHAVES)) {
          const { data, error } = await supabase.from('system_state').select('key, value').in('key', lote);
          if (error) return null;
          for (const r of (data ?? []) as LinhaEstado[]) achadas.set(r.key, r);
        }
        return achadas;
      } catch { return null; }
    },
    estado: () => estadoRecuperacaoCarla(),
    largada: () => lerLargada(),
    vendas: (desdeMs) => vendasDesde(desdeMs),
    planos: (chaves) => chavesComPlanoPago(chaves),
  };
}

/**
 * O estado de cada lead do quiz dos últimos `dias` (60 por padrão, 180 no máximo). Só leitura.
 * A leitura dos leads que falha LANÇA (a rota responde 502); as demais viram "nao_conferiu" por lead.
 */
export async function statusLeadsQuiz(opts: { dias?: unknown; agora?: Date } = {}, deps: DepsStatus = depsStatusReais()): Promise<RespostaStatus> {
  const agora = opts.agora ?? new Date();
  const dias = limitarDias(opts.dias);
  const desdeMs = agora.getTime() - dias * 86_400_000;
  const leads = await deps.leads(new Date(desdeMs).toISOString(), LIMITE_LEADS);
  const truncado = leads.length >= LIMITE_LEADS;

  const estado = await deps.estado().catch((): EstadoRecuperacao => ({ ligada: false, motivo: 'leitura_falhou' }));
  let largadaMs: number | null | undefined;
  try { largadaMs = await deps.largada(); } catch { largadaMs = undefined; }

  const hmacs = leads.map((l) => hmacDoLeadRec(l));
  const chavesPedidas = hmacs.flatMap((h) =>
    h ? [`${PREFIXO_CARIMBO_REC}${h}`, `${PREFIXO_CLAIM_QUIZ}${h}`, `${PREFIXO_CLAIM_QUIZ}${h}${SUFIXO_SEM_VAGA}`, `${PREFIXO_FOLLOWUP}${h}`] : []);
  const lidas = chavesPedidas.length ? await deps.chaves(chavesPedidas) : new Map<string, LinhaEstado>();
  const leituraOk = lidas !== null;

  // Compras: o ledger da janela (com data, em páginas de 1000) e, para quem não casou, o plano pago numa leitura em lote.
  let vendas: VendasComData | null = null;
  try { vendas = await deps.vendas(desdeMs); } catch { vendas = null; }

  const status: Record<string, StatusDoLead> = {};
  const comprasPendentes: Array<{ id: string; chave: string }> = [];
  const compras = new Map<string, CompraDoLead>();

  leads.forEach((lead, i) => {
    const id = String(lead.lead_id ?? '').trim();
    if (!id) return;
    const h = hmacs[i];
    const carimbo = h ? lidas?.get(`${PREFIXO_CARIMBO_REC}${h}`) : undefined;
    const avisoLinha = h ? lidas?.get(`${PREFIXO_CLAIM_QUIZ}${h}`) : undefined;
    const semVagaLinha = h ? lidas?.get(`${PREFIXO_CLAIM_QUIZ}${h}${SUFIXO_SEM_VAGA}`) : undefined;
    status[id] = {
      carla: carlaDoLead({ lead, hmac: h, leituraOk, claim: carimbo, largadaMs }),
      aviso: avisoDoLead({ leituraOk, hmac: h, desistencia: avisoLinha, semVaga: semVagaLinha }),
      comprou: null,
      // O follow-up é calculado depois das compras (precisa do `comprou` de cada lead). Leitura que falhou ou lead sem hmac = null, nunca um "novo" inventado.
      followup: null,
    };
    if (ehLeadDeTeste(lead.field_data)) return;   // teste nunca compra: poupa a consulta
    const tel = normalizarTelefoneSd(lead.whatsapp);
    if (!tel) { compras.set(id, { nao_conferiu: true }); return; }
    const noClaim = compraNoClaim(avisoLinha);
    if (noClaim) { compras.set(id, noClaim); return; }
    // O casamento com o ledger (sessão do lp ou telefone) é o mesmo de comprouLead; quem não casou vai conferir o plano pago, em lote.
    const lp = campoFd(lead.field_data, 'lp_session');
    const chave = chaveDoTelefone(tel);
    if (vendas && ((lp && vendas.sessoes.has(lp)) || vendas.chaves.has(chave))) {
      compras.set(id, { em: (lp && vendas.sessoes.get(lp)) || vendas.chaves.get(chave) || null });
    }
    else comprasPendentes.push({ id, chave });
  });

  if (comprasPendentes.length) {
    try {
      const pagas = await deps.planos([...new Set(comprasPendentes.map((p) => p.chave))]);
      for (const p of comprasPendentes) {
        // "Não" só quando o ledger foi lido inteiro. Leitura que falhou ou cortada não prova que não comprou.
        compras.set(p.id, pagas.has(p.chave) ? { em: null } : vendas && !vendas.truncada ? null : { nao_conferiu: true });
      }
    } catch {
      for (const p of comprasPendentes) compras.set(p.id, { nao_conferiu: true });
    }
  }
  for (const [id, c] of compras) if (status[id]) status[id].comprou = c;

  // Follow-up de novo, agora com a compra: quem comprou fecha. "nao_conferiu" NÃO fecha (sem prova de compra, a ligação continua devida).
  const testes = new Set<string>();
  leads.forEach((lead, i) => {
    const id = String(lead.lead_id ?? '').trim();
    const st = status[id];
    if (!id || !st) return;
    if (ehLeadDeTeste(lead.field_data)) testes.add(id);
    const h = hmacs[i];
    if (!h || !leituraOk) { st.followup = null; return; }
    const comprou = !!st.comprou && !('nao_conferiu' in st.comprou);
    st.followup = estadoDoFollowup({ hist: histDoValor(lidas?.get(`${PREFIXO_FOLLOWUP}${h}`)?.value), criadoEm: lead.created_time, comprou, agora });
  });
  const paraLigarHoje = Object.entries(status).filter(([id, st]) => !testes.has(id) && st.followup?.devido).length;
  // Lead de teste não entra na conta (nem na fila, nem em "incompleta").
  const incompleta = Object.entries(status).some(([id, st]) => !testes.has(id) && st.followup === null);

  return {
    ok: true,
    carla_ligada: estado.ligada,
    carla_motivo: estado.motivo,
    largada: typeof largadaMs === 'number' ? new Date(largadaMs).toISOString() : null,
    truncado,
    fila: { para_ligar_hoje: paraLigarHoje, incompleta },
    status,
  };
}
