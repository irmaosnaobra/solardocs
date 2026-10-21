// ─────────────────────────────────────────────────────────────────────────────
// A HELENA DO ELETROPOSTO NA RODADA VIVA (B2): as regras que vêm ANTES da IA e as peças das ações. Este arquivo NÃO
// envia mensagem: quem fala com o lead e com o consultor é o vivo.ts (por vivoEnvio e fichaEnvio). Só o vivo.ts o importa.
//
// A regra de ouro: NENHUM robô do eletroposto muda. A confirmação (ep_agenda), a régua do SIM, a gravação da resposta e da
// presença (eletropostoRespostas), a remarcação, o reagendamento automático, o NÃO ATENDEU e o alerta de 10 minutos seguem
// como estão. A Helena só responde o que hoje fica sem resposta, e só depois de o ep_respostas ter lido a fala. As funções
// de intenção (querRemarcar, pediuRemarcar, querODeVolta, confirmouMesmo) são as DELES, carregadas por import() só quando
// uma conversa da Helena chega aqui (os módulos deles puxam o envio e a rota do eletroposto). Os prefixos de
// system_state dos robôs ficam escritos aqui e o agentes5040Helena.test.ts compara cada um com o export real.
//
// Telefone cru nunca vai para log nem para chave: a chave do contato (DDD + 8 últimos) é o que circula.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { ehCardSemAvisoAutomatico, ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { quandoPorExtenso } from './personas/comum';
import type { CardResumo } from './tipos';

const LOG = 'helena-ep-5040';

/** Os prefixos de system_state dos robôs do eletroposto. Cópia deliberada: o teste compara com o export real de cada um. */
export const PREFIXOS_EP = Object.freeze({
  resposta: 'ep_resposta:',         // eletropostoAgenda.EP_RESPOSTA_PREFIX
  remarcar: 'ep_remarcar:',         // eletropostoRemarcar.EP_REMARCAR_PREFIX
  remarcarEnviado: 'ep_remarcar_sent:', // eletropostoRemarcar.EP_REMARCAR_SENT
  ofertaFria: 'ep_oferta_fria:',    // eletropostoRemarcar.EP_OFERTA_FRIA_SENT
  liberadoSim: 'ep_liberado_sim:',  // eletropostoCobraSim.EP_LIBERADO_PREFIX
  mudo: 'ep_mudo:',                 // eletropostoReagendaAuto.EP_MUDO_PREFIX
});

/** A reserva de "1 vez por card" da bolha do SIM. Nasce por INSERT (23505 = já respondeu). */
export const PREFIXO_PRESENCA = 'ag5040_helena_presenca:';

/** Os números do ep_respostas que a cobertura espelha (PASSADO_MAX_MS e LOOKBACK_MAX_MS dele). */
const PASSADO_MAX_MS = 5 * 24 * 3_600_000;
const LOOKBACK_MAX_MS = 3 * 24 * 3_600_000;
/** OFERTA_VALIDA_MS do eletropostoRemarcar. */
const OFERTA_VALIDA_MS = 24 * 3_600_000;
/** Pendência da Helena: confirmação oficial do ep_agenda que não saiu. */
export const ESPERA_CONFIRMACAO_MS = 10 * 60_000;

const semAcento = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ── os módulos dos robôs (import() uma vez só) ───────────────────────────────

interface FuncoesEp {
  querRemarcar: (t: string[]) => boolean;
  pediuRemarcar: (t: string[]) => boolean;
  querODeVolta: (t: string[]) => boolean;
  confirmouMesmo: (t: string[]) => boolean;
  escolhaDaResposta: (t: string[], ofertas: string[]) => number | null;
}
let carregando: Promise<FuncoesEp> | null = null;
export function funcoesEp(): Promise<FuncoesEp> {
  carregando ??= Promise.all([import('../io/eletropostoRemarcar'), import('../io/eletropostoRespostas')])
    .then(([rem, resp]) => ({
      querRemarcar: rem.querRemarcar, escolhaDaResposta: rem.escolhaDaResposta,
      pediuRemarcar: resp.pediuRemarcar, querODeVolta: resp.querODeVolta, confirmouMesmo: resp.confirmouMesmo,
    }))
    .catch(e => { carregando = null; throw e; });
  return carregando;
}

// ── os cards de eletroposto do telefone ──────────────────────────────────────

export interface CardEp {
  id: number;
  status: string | null;
  quando: string | null;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  cidade: string | null;
  observacao: string | null;
  created_by: string | null;
  created_at: string | null;
  confirmacao_at: string | null;
  lembrete_1h_at: string | null;
  lembrete_5min_at: string | null;
  presenca_confirmada_at: string | null;
}

const COLUNAS_EP = 'id, status, quando, vendedor_nome, cliente_nome, cliente_telefone, cidade, observacao, created_by, created_at, confirmacao_at, lembrete_1h_at, lembrete_5min_at, presenca_confirmada_at';

/** Todo card de eletroposto do telefone (qualquer status), do mais novo ao mais velho. DDD + 8 últimos, como o ep_respostas. Erro SOBE. */
export async function lerCardsEp(chave: string): Promise<CardEp[]> {
  const { data, error } = await supabaseGerador.from('agendamentos').select(COLUNAS_EP)
    .ilike('cliente_telefone', `%${chave.slice(-8)}`).order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(`leitura dos cards do eletroposto falhou (${String((error as { code?: string }).code ?? 'desconhecido').slice(0, 20)})`);
  return ((data ?? []) as CardEp[]).filter(c => chaveContato(String(c.cliente_telefone ?? '')) === chave && ehOrigemEletroposto(c.created_by));
}

export const cardResumoDe = (c: CardEp): CardResumo => ({
  id: c.id, status: c.status, quando: c.quando, vendedor_nome: c.vendedor_nome, cliente_nome: c.cliente_nome, cidade: c.cidade,
  observacao: c.observacao, created_by: c.created_by, created_at: c.created_at,
});

// ── a cobertura do ep_respostas ──────────────────────────────────────────────

/**
 * O ep_respostas vai ler a fala desta ficha? Espelha o filtro dele: família eletroposto e fora do lote; ao menos um toque
 * da automação e a fala depois do primeiro; status agendado ou nao_atendeu (cancelado só se a régua do SIM liberou);
 * reunião de até 5 dias atrás; fala dentro dos 3 dias de leitura. Ficha fora disto o ep_respostas NUNCA marca.
 */
export function coberturaDoEpRespostas(c: CardEp, o: { agoraMs: number; falaMs: number; liberados: ReadonlySet<number> }): boolean {
  if (!ehOrigemEletroposto(c.created_by) || ehCardSemAvisoAutomatico(c.created_by)) return false;
  const toques = [c.confirmacao_at, c.lembrete_1h_at, c.lembrete_5min_at].filter(Boolean) as string[];
  if (!toques.length) return false;
  const status = String(c.status ?? '');
  if (!['agendado', 'nao_atendeu', 'cancelado'].includes(status)) return false;
  if (status === 'cancelado' && !o.liberados.has(c.id)) return false;
  const quando = Date.parse(String(c.quando ?? ''));
  if (!Number.isFinite(quando) || quando < o.agoraMs - PASSADO_MAX_MS) return false;
  const primeiro = Math.min(...toques.map(t => Date.parse(t)).filter(Number.isFinite));
  if (!Number.isFinite(primeiro) || o.falaMs <= primeiro) return false;
  if (o.falaMs < o.agoraMs - LOOKBACK_MAX_MS) return false;
  return true;
}

// ── o fecho depois do SIM ────────────────────────────────────────────────────

/** Quanto tempo depois da bolha de presença da Helena um "sim" ou "isso" ainda é só fecho (depois disso é fala nova). */
export const JANELA_FECHO_SIM_MS = 30 * 60_000;

const FECHO_COM_SIM = /^(?:(?:muito |mto )?(?:obrigad[oa]s?|valeu|vlw|show|top|blz|beleza|ok|okay|certo|combinado|perfeito|otimo|tmj|fechado|sim|isso)[\s!.,]*)+$/;
const FECHO_SEM_SIM = /^(?:(?:muito |mto )?(?:obrigad[oa]s?|valeu|vlw|show|top|blz|beleza|ok|okay|certo|combinado|perfeito|otimo|tmj|fechado)[\s!.,]*)+$/;

/**
 * "Obrigado", "ok", emoji: a conversa que já recebeu a resposta do SIM não responde a isto. "Sim" e "isso" só contam como
 * fecho dentro dos 30 minutos depois da bolha de presença (`simIssoValem`); depois disso são fala nova e seguem o caminho normal.
 */
export function ehSoFecho(textos: readonly string[], simIssoValem = true): boolean {
  const t = textos.map(x => String(x ?? '').trim()).filter(Boolean);
  if (!t.length) return false;
  const re = simIssoValem ? FECHO_COM_SIM : FECHO_SEM_SIM;
  return t.every(x => {
    const sem = semAcento(x).replace(/[\p{Extended_Pictographic}‍️]/gu, '').trim();
    if (!sem) return true;
    return re.test(sem);
  });
}

/** Pediu para remarcar ou cancelar (as três leituras DELES juntas)? Para o que só se sabe depois da transcrição de áudio. */
export async function pedeRemarcar(textos: readonly string[]): Promise<boolean> {
  const ep = await funcoesEp();
  const t = [...textos];
  return ep.pediuRemarcar(t) || ep.querRemarcar(t) || ep.querODeVolta(t);
}

// ── as regras antes da IA ────────────────────────────────────────────────────

export type Veredicto =
  | { tipo: 'seguir'; semCard: boolean; cards: CardEp[]; cardAlvo: CardEp | null; presencaRespondida?: boolean }
  | { tipo: 'cala' | 'espera' | 'humano'; motivo: string };

interface LinhaEstado { key: string; value: Record<string, unknown> | null; updated_at?: string | null }

const chavesDo = (id: number): string[] => [
  `${PREFIXOS_EP.mudo}${id}`, `${PREFIXOS_EP.resposta}${id}`, `${PREFIXOS_EP.remarcar}${id}`,
  `${PREFIXOS_EP.liberadoSim}${id}`, `${PREFIXO_PRESENCA}${id}`,
];

/**
 * O que a Helena faz com esta fala ANTES de chamar a IA. Só leitura. Ordem (a primeira que casa vence):
 *  1. nenhum card de eletroposto, em qualquer status = seguir sem card (a IA responde; marcar cria o card);
 *  2. só card do lote (cadastro_eletroposto) = cala (o consultor responde, e o ep_respostas já avisa);
 *  3. ficha ep_mudo (a marca do horário atual do card) = cala;
 *  4. fecho ("obrigado", emoji) depois da resposta do SIM = cala;
 *  5. pediu para remarcar ou cancelar (pediuRemarcar, querRemarcar, querODeVolta): se o ep_respostas cobre a ficha, é do
 *     robô de remarcação e da equipe = cala; se não cobre (sem toque, mais de 5 dias, status fora dos três) = humano;
 *  5b. confirmou ("sim", "confirmo") e o card mais novo ainda está 'cancelado' = cala (o ep_respostas pode estar no meio
 *     de reabrir o card ou de oferecer horários);
 *  6. oferta de remarcação aberta (ep_remarcar:<id>, menos de 24 h) = cala (escolhaDaResposta só dá o motivo);
 *  7. um robô de remarcação já falou depois da fala (carimbo ep_remarcar_sent / ep_oferta_fria) = cala;
 *  8. ficha coberta e o marcador ep_resposta:<id>.ate ainda atrás da fala = espera (a próxima rodada);
 *  9. o resto = seguir com card.
 * Erro de leitura = espera (nunca fala sem ter lido).
 */
export async function regrasDaHelena(p: {
  chave: string; fala: { id: number; momment: string }; textos: readonly string[]; agoraMs: number;
}): Promise<Veredicto> {
  try {
    const falaMs = Date.parse(p.fala.momment);
    if (!Number.isFinite(falaMs)) return { tipo: 'espera', motivo: 'momento_invalido' };
    // Sem o telefone resolvido (chave lid:) não dá para dizer que não há card: a Helena não decide.
    if (!/^\d{10}$/.test(p.chave)) return { tipo: 'espera', motivo: 'chave_sem_telefone' };
    const cards = await lerCardsEp(p.chave);
    if (!cards.length) return { tipo: 'seguir', semCard: true, cards: [], cardAlvo: null };
    // O ep_respostas casa o inbound pelo telefone CRU da linha (DDD + 8). Fala que chegou como LID ele nunca vê: o marcador
    // não anda, e esperar por ele seria esperar à toa. Sem o telefone cru conferido, esta fala não é "coberta".
    const bruto = await supabase.from('wa_mensagens').select('telefone').eq('id', p.fala.id).maybeSingle();
    if (bruto.error) return { tipo: 'espera', motivo: 'leitura_falhou' };
    const falaVisivel = chaveContato(String((bruto.data as { telefone?: string | null } | null)?.telefone ?? '')) === p.chave;
    const normais = cards.filter(c => !ehCardSemAvisoAutomatico(c.created_by));
    if (!normais.length) return { tipo: 'cala', motivo: 'card_do_lote' };

    const chaves = normais.flatMap(c => chavesDo(c.id));
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at').in('key', chaves);
    if (error) return { tipo: 'espera', motivo: 'leitura_falhou' };
    const estado = new Map<string, LinhaEstado>(((data ?? []) as LinhaEstado[]).map(l => [l.key, l]));
    const valor = (k: string): Record<string, unknown> | null => estado.get(k)?.value ?? null;

    // 3. ep_mudo vale só para o horário em que foi marcado
    for (const c of normais) {
      const m = valor(`${PREFIXOS_EP.mudo}${c.id}`);
      if (m && Date.parse(String(m.quando ?? '')) === Date.parse(String(c.quando ?? ''))) return { tipo: 'cala', motivo: 'ep_mudo' };
    }

    const textos = p.textos.map(t => String(t ?? '').trim()).filter(Boolean);
    const ep = await funcoesEp();

    // 4. fecho depois da resposta do SIM ("sim" e "isso" só dentro dos 30 minutos depois da bolha de presença)
    const reservas = normais.map(c => estado.get(`${PREFIXO_PRESENCA}${c.id}`)).filter((l): l is LinhaEstado => !!l);
    if (reservas.length) {
      const recente = reservas.some(l => {
        const t = Date.parse(String(l.value?.em ?? l.updated_at ?? ''));
        return !Number.isFinite(t) || p.agoraMs - t <= JANELA_FECHO_SIM_MS;      // sem hora legível: o silêncio é o lado seguro
      });
      if (ehSoFecho(textos, recente)) return { tipo: 'cala', motivo: 'fecho_depois_do_sim' };
    }

    const liberados = new Set(normais.filter(c => estado.has(`${PREFIXOS_EP.liberadoSim}${c.id}`)).map(c => c.id));
    const coberta = falaVisivel && normais.some(c => coberturaDoEpRespostas(c, { agoraMs: p.agoraMs, falaMs, liberados }));

    // 5. remarcar / cancelar
    if (ep.pediuRemarcar(textos) || ep.querRemarcar(textos) || ep.querODeVolta(textos)) {
      return coberta ? { tipo: 'cala', motivo: 'remarcacao_do_robo' } : { tipo: 'humano', motivo: 'remarcar_sem_cobertura' };
    }

    // 5b. confirmou, mas o card mais novo ainda está cancelado: o ep_respostas pode estar no meio de reabrir o card ou de
    // oferecer horários, e a Helena não fala por cima dele
    if (normais[0]?.status === 'cancelado' && ep.confirmouMesmo([...textos])) return { tipo: 'cala', motivo: 'cancelado_confirmou' };

    // 6. oferta aberta
    for (const c of normais) {
      const o = valor(`${PREFIXOS_EP.remarcar}${c.id}`);
      const em = Date.parse(String(o?.em ?? ''));
      if (o && Number.isFinite(em) && p.agoraMs - em < OFERTA_VALIDA_MS) {
        const ofertas = Array.isArray(o.ofertas) ? o.ofertas.map(String) : [];
        return { tipo: 'cala', motivo: ep.escolhaDaResposta([...textos], ofertas) !== null ? 'escolha_de_horario' : 'oferta_aberta' };
      }
    }

    // 7. o robô de remarcação falou depois da fala (a bolha pode ainda não estar em wa_mensagens)
    const ids = new Set(normais.map(c => String(c.id)));
    for (const prefixo of [PREFIXOS_EP.remarcarEnviado, PREFIXOS_EP.ofertaFria]) {
      const r = await supabase.from('system_state').select('key, updated_at').like('key', `${prefixo}%`).gte('updated_at', p.fala.momment).limit(200);
      if (r.error) return { tipo: 'espera', motivo: 'leitura_falhou' };
      for (const l of (r.data ?? []) as Array<{ key: string }>) {
        if (ids.has(l.key.slice(prefixo.length).split(':')[0]!)) return { tipo: 'cala', motivo: 'robo_falou' };
      }
    }

    // 8. o marcador do ep_respostas
    if (coberta) {
      const ate = Math.max(0, ...normais.map(c => Date.parse(String(valor(`${PREFIXOS_EP.resposta}${c.id}`)?.ate ?? ''))).filter(Number.isFinite));
      if (!(ate >= falaMs)) return { tipo: 'espera', motivo: 'marcador_atras' };
    }
    return { tipo: 'seguir', semCard: false, cards: normais, cardAlvo: normais[0] ?? null, presencaRespondida: reservas.length > 0 };
  } catch (e) {
    logger.error(LOG, `as regras falharam (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return { tipo: 'espera', motivo: 'leitura_falhou' };
  }
}

// ── confirmar presença ───────────────────────────────────────────────────────

export type ProvaDaPresenca = { ok: true; cardId: number } | { ok: false; motivo: string };

/**
 * A prova de que dá para dizer "confirmado": a fala é uma afirmativa de verdade (confirmouMesmo, a regra DELE), o card relido
 * está 'agendado' e o ep_respostas JÁ gravou presenca_confirmada_at. O marcador sai antes da presença no ep_respostas, então
 * presença nula = silêncio, nunca "confirmado". Status 'cancelado' (horário revendido) também não confirma nada.
 */
export async function provaDaPresenca(cards: readonly CardEp[], textos: readonly string[]): Promise<ProvaDaPresenca> {
  const ep = await funcoesEp();
  if (!ep.confirmouMesmo([...textos])) return { ok: false, motivo: 'nao_confirmou_mesmo' };
  const candidatos = cards.filter(c => !ehCardSemAvisoAutomatico(c.created_by) && c.status === 'agendado');
  if (!candidatos.length) return { ok: false, motivo: 'sem_card_agendado' };
  for (const c of candidatos) {
    const { data, error } = await supabaseGerador.from('agendamentos').select('id, status, presenca_confirmada_at').eq('id', c.id).maybeSingle();
    if (error) return { ok: false, motivo: 'leitura_falhou' };
    const l = data as { status?: string | null; presenca_confirmada_at?: string | null } | null;
    if (l && l.status === 'agendado' && l.presenca_confirmada_at) return { ok: true, cardId: c.id };
  }
  return { ok: false, motivo: 'presenca_nao_gravada' };
}

// ── o que a bolha da Helena nunca diz ────────────────────────────────────────

const PEDE_SIM_MAIUSCULO = /\bSIM\b/;
const PEDE_SIM_POR_EXTENSO = /\b(?:respond\w*|respost\w*|confirm\w*|dig\w*|mand\w*|diz\w*|escrev\w*|com|um)\s+(?:um\s+|o\s+)?["“']?sim\b/i;
const PROMETE_LEMBRETE = /\blembr(?:ete|etes|arei|aremos|ar voce|o voce)\b|\bvou te lembrar\b|\bte aviso (?:antes|na hora)\b/;
const DIZ_CONFIRMADO = /\bconfirmad[oa]s?\b/;
/** Pedido de confirmação sem a palavra "sim": "confirma sua presença?", "confirme a presença". */
const PEDE_CONFIRMACAO = /confirm\w*\s+(sua\s+|a\s+)?presen/i;

/** Por que a bolha da Helena não sai (null = pode). `podeConfirmar` só vale na resposta ao SIM que passou na prova. */
export function violacaoDaBolha(bolha: string, podeConfirmar: boolean): string | null {
  const b = String(bolha ?? '');
  if (PEDE_SIM_MAIUSCULO.test(b) || PEDE_SIM_POR_EXTENSO.test(b) || PEDE_CONFIRMACAO.test(semAcento(b))) return 'pede_sim';
  const t = semAcento(b);
  if (PROMETE_LEMBRETE.test(t)) return 'promete_lembrete';
  if (!podeConfirmar && DIZ_CONFIRMADO.test(t)) return 'diz_confirmado';
  return null;
}

const DIA_OU_HORA = /\b(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|hoje|amanha|depois de amanha)\b|\b\d{1,2}\s*(?:h|:)\s*\d{0,2}\b|\b\d{1,2}\s*\/\s*\d{1,2}\b|\bas\s+\d{1,2}\b/;
const CONSULTORES = /\b(?:thiago|diego)\b/;

/** A bolha logo depois do insert do card: nada de dia, hora, consultor, "confirmado", SIM ou lembrete (a confirmação oficial é do ep_agenda). */
export function bolhaSemDetalhe(bolha: string): boolean {
  const t = semAcento(bolha);
  if (!t) return false;
  return !DIA_OU_HORA.test(t) && !CONSULTORES.test(t) && violacaoDaBolha(bolha, false) === null;
}

/** COPY PARA O REDATOR: a bolha fixa depois de o card nascer. Sem dia, hora, consultor, "confirmado", SIM nem lembrete. Até 160. */
export function bolhaCardCriado(nome: string | null | undefined): string {
  const n = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  const ok = n.length >= 2 && n.length <= 20 && n.toLowerCase() !== 'lead' && n.toLowerCase() !== 'cliente';
  return `${ok ? `Pronto, ${n}, deixei` : 'Pronto, deixei'} a sua reunião marcada. Os detalhes vão na mensagem de confirmação, aqui no mesmo WhatsApp.`;
}

/** COPY PARA O REDATOR: a bolha fixa da resposta ao SIM, quando a prova passou e a IA não escreveu uma que sirva. */
export function bolhaPresencaAnotada(nome: string | null | undefined): string {
  const n = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  const ok = n.length >= 2 && n.length <= 20 && n.toLowerCase() !== 'lead' && n.toLowerCase() !== 'cliente';
  return `${ok ? `Obrigada, ${n}.` : 'Obrigada.'} Sua presença ficou anotada e está tudo certo.`;
}

// ── marcar sem card: o consultor e os horários ───────────────────────────────

export const CONSULTORES_EP: readonly string[] = ['Thiago', 'Diego'];

/**
 * O consultor do card novo. O dono do telefone (vendedor do agendamento ativo mais novo, como o manychat) SÓ vale se for da
 * dupla do eletroposto: a lista do manychat pode devolver a consultora do solar, que não atende reunião de eletroposto.
 * Senão, o rodízio do manychat (contagem de cards lp_eletroposto e manychat_eletroposto). null = não deu para decidir.
 */
export async function consultorDoCardNovo(tel: string): Promise<string | null> {
  try {
    const { donoDoTelefone } = await import('../agenda/leadsMetaService');
    const dono = await donoDoTelefone(tel);
    const achado = CONSULTORES_EP.find(c => semAcento(c) === semAcento(dono).split(/\s+/)[0]);
    if (achado) return achado;
    const { consultaDoRodizio, donoDaVez } = await import('../io/eletropostoCard');
    const { count, error } = await consultaDoRodizio(['lp_eletroposto', 'manychat_eletroposto']);
    if (error) return null;
    return donoDaVez(count || 0);
  } catch (e) {
    logger.error(LOG, `o consultor do card novo não saiu (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return null;
  }
}

/** As próximas vagas (ISO) do consultor, faixa 'novo'. Leitura que falhou = lista vazia (ninguém oferece o que não leu). */
export async function vagasDoConsultor(dono: string, agoraMs: number, n = 4): Promise<string[]> {
  try {
    const { proximasVagas } = await import('../io/eletropostoVagas');
    return (await proximasVagas(dono, n, { agora: agoraMs })) ?? [];
  } catch (e) {
    logger.error(LOG, `as vagas não saíram (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return [];
  }
}

export async function aindaLivreEp(iso: string, dono: string): Promise<boolean> {
  try {
    const { aindaLivre } = await import('../io/eletropostoVagas');
    return await aindaLivre(iso, dono);
  } catch { return false; }
}

const normaliza = (s: unknown): string => semAcento(s).replace(/\s+/g, ' ').replace(/[.\s]+$/, '');

/** O ISO da vaga que a IA nomeou: o texto da lista inteiro, ou uma frase que o contém (só se uma vaga casa). */
export function acharVagaEp(texto: string | null | undefined, vagas: readonly string[], agoraIso: string): string | null {
  const alvo = normaliza(texto);
  if (!alvo) return null;
  const exata = vagas.find(v => normaliza(quandoPorExtenso(v, agoraIso)) === alvo);
  if (exata) return exata;
  const contidas = vagas.filter(v => { const q = normaliza(quandoPorExtenso(v, agoraIso)); return !!q && alvo.includes(q); });
  return contidas.length === 1 ? contidas[0]! : null;
}

/** O card que a Helena grava (o mesmo formato do investidorAgente.agendar). confirmacao_at fica NULO: é o gatilho da confirmação do ep_agenda. */
export function fichaDoCardEp(a: { dono: string; iso: string; nome: string | null; tel: string; cidade: string | null; dados: Readonly<Record<string, string>> }): Record<string, unknown> {
  const linhas = [
    'ELETROPOSTO · WhatsApp (Helena, linha 5040)',
    ...Object.entries(a.dados).filter(([k]) => k !== 'horario').slice(0, 6).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`),
  ];
  return {
    vendedor_nome: a.dono, quando: a.iso, cliente_nome: String(a.nome ?? '').trim().slice(0, 120) || 'Lead eletroposto',
    cliente_telefone: a.tel, cidade: a.cidade ? a.cidade.slice(0, 120) : null, status: 'agendado', temperatura: 'morno',
    observacao: linhas.join('\n'), created_by: 'agente_eletroposto', src: null,
  };
}

/**
 * Relê os cards de eletroposto do telefone logo ANTES de gravar: card que nasceu depois das regras (ep_agenda, landing, outro
 * consultor) = não grava ('ja_tem_card': quem chama passa ao humano com a ficha). Leitura que falhou = 'erro': nunca se grava
 * sem ter lido.
 */
export async function gravarCardSeNaoHouver(chave: string, ficha: Record<string, unknown>): Promise<Awaited<ReturnType<typeof gravarCardDaHelena>> | { status: 'ja_tem_card' }> {
  try {
    if ((await lerCardsEp(chave)).length) return { status: 'ja_tem_card' };
  } catch (e) {
    logger.error(LOG, `a releitura dos cards falhou (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return { status: 'erro' };
  }
  return gravarCardDaHelena(ficha);
}

/** Grava o card. 'tomado' = 23505 (alguém pegou o horário); 'bloqueado' = fora do padrão. */
export async function gravarCardDaHelena(ficha: Record<string, unknown>): Promise<{ status: 'ok'; id: number } | { status: 'tomado' } | { status: 'bloqueado' } | { status: 'erro' }> {
  try {
    const { gravarCardEletroposto } = await import('../io/eletropostoCard');
    const r = await gravarCardEletroposto(ficha);
    if (r.bloqueado) return { status: 'bloqueado' };
    if (!r.id) return { status: 'erro' };
    return { status: 'ok', id: r.id };
  } catch (e) {
    if (String((e as { code?: string })?.code) === '23505') return { status: 'tomado' };
    logger.error(LOG, `gravar o card falhou (${String((e as { code?: string })?.code ?? 'desconhecido').slice(0, 20)})`);
    return { status: 'erro' };
  }
}

// ── a pendência de 10 minutos ────────────────────────────────────────────────

export interface EpMarcou { cardId: number; em: string; wa_id: number; dono: string; resolvido_em?: string; como?: string }

/** A posse tem um card marcado pela Helena esperando a confirmação oficial há 10 minutos ou mais? */
export function pendenciaEpDevida(posse: Readonly<Record<string, unknown>>, agoraMs: number): boolean {
  const m = posse.ep_marcou as Partial<EpMarcou> | undefined;
  if (!m || m.resolvido_em) return false;
  const t = Date.parse(String(m.em ?? ''));
  return !Number.isFinite(t) || agoraMs - t >= ESPERA_CONFIRMACAO_MS;
}

/** O card marcado pela Helena já recebeu a confirmação oficial? 'confirmado' | 'ainda_nao' | 'sumiu' | 'cancelado' | null (leitura falhou). */
export async function situacaoDaConfirmacao(cardId: number): Promise<'confirmado' | 'ainda_nao' | 'sumiu' | 'cancelado' | null> {
  const { data, error } = await supabaseGerador.from('agendamentos').select('id, status, confirmacao_at').eq('id', cardId).maybeSingle();
  if (error) return null;
  if (!data) return 'sumiu';
  const c = data as { status?: string | null; confirmacao_at?: string | null };
  if (c.confirmacao_at) return 'confirmado';
  if (String(c.status ?? '') === 'cancelado') return 'cancelado';
  return 'ainda_nao';
}
