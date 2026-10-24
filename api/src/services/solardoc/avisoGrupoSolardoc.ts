// ─────────────────────────────────────────────────────────────────────────────
// AVISOS DO GRUPO DO SOLARDOC (24/10/2026, plano B1).
//
// Desistência do quiz, "sem vaga hoje" e compra vão para UM grupo da 5040 onde
// estão o Thiago, o Diego e a Giovanna. O aviso de compra no grupo é UM A MAIS:
// o aviso individual ao Thiago (Stripe, Asaas e comprovante) nunca é dispensado.
// Regras (veredito do chefe-antiban):
//
//  - Sai pela 5040 (instância 'io') e SEMPRE por `sendToGroup`. NUNCA por
//    `sendWhatsApp`: o `fmtPhone` estraga id de grupo e o 4xx trava a linha por 60 s.
//  - O id do grupo é a constante GRUPO_VENDAS_SOLARDOC (não é segredo; o dono
//    preenche depois de criar o grupo), com a env ZAPI_SOLARDOC_GRUPO_ID por cima.
//    Nunca o grupo do agendamento da IO nem o do eletroposto. Sem id, não envia.
//  - 1 bolha, sem mídia, sem janela de horário.
//  - A VEZ do aviso é reivindicada por insert em system_state ANTES de qualquer envio:
//      quiz_aviso:<hmac>                       desistência (uma por pessoa)
//      quiz_aviso:<hmac>:semvaga:<dia BRT>     sem vaga (uma por pessoa por dia)
//      compra_aviso:<id da venda>              compra (uma para Stripe, Asaas e comprovante)
//    O valor guarda como a coisa saiu: enviado | pendente | sem_grupo | falhou | expirado.
//  - UM aviso avulso por vez: a vez é uma chave de 2 min tomada por update condicional
//    ou insert (quiz_aviso_vez). Os demais ficam `pendente` e saem no cartão, que junta
//    os pendentes numa bolha só, no máximo 1 a cada 10 min (descarregarPendentes).
//  - Fica `pendente` também: linha pausada (ag5040_linha_pausa) ou em cooldown, trava de
//    1 h depois de um 4xx do grupo, 12 avisos na hora, linha com 40 envios ou mais na hora.
//  - Cada envio físico (avulso e cartão) deixa o carimbo `solardoc_aviso_sent:` (balde das
//    respostas das agentes, lineThrottle.ts), e a conta de "abaixo de 40 na hora" os soma.
//  - O primeiro 4xx do grupo grava a trava `quiz_aviso_trava` por 1 h: nesse tempo só e-mail.
//  - Pendente com mais de 24 h não some calado: vira e-mail e `expirado`.
//  - Lead de teste (utm_source = 'raio-x-teste') nunca gera aviso.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendOpsAlert } from '../../utils/mailer';
import { sendToGroup, linhaEmCooldown } from '../agents/zapiClient';
import { prefixosTotalDaLinha } from '../agents/whatsapp/lineThrottle';
import { hmacDe } from '../agentes5040/hmac';
import { chaveDoTelefone, codigoDoQuiz, leadIdDoQuiz, normalizarTelefoneSd } from './quizSolardoc';
import {
  montarAviso, ROTULO_PROPOSTAS, ROTULO_QUANDO, type CamposAviso, type ModeloAviso,
} from './avisoGrupoTextos';

import { GRUPO_VENDAS_SOLARDOC } from './grupoVendasId';

export { GRUPO_VENDAS_SOLARDOC };

/** Grupo do cartão de agendamento da linha IO: este módulo NUNCA escreve nele. */
const GRUPO_AGENDAMENTO_IO = '120363424419098566-group';
/** Grupo do eletroposto (routes/webhook.ts), onde a linha entra lead: também proibido aqui. */
const GRUPO_ELETROPOSTO = '120363410228854732-group';

export const PREFIXO_CLAIM_QUIZ = 'quiz_aviso:';
export const PREFIXO_CLAIM_COMPRA = 'compra_aviso:';
/** Carimbo do envio físico. O MESMO texto está em PREFIXOS_RESPOSTA_AGENTES (lineThrottle.ts). */
export const PREFIXO_CARIMBO_AVISO = 'solardoc_aviso_sent:';
export const CHAVE_VEZ_AVULSA = 'quiz_aviso_vez';
export const CHAVE_CARTAO_ULTIMO = 'quiz_aviso_cartao_ultimo';
export const CHAVE_TRAVA_4XX = 'quiz_aviso_trava';
const CHAVE_LINHA_PAUSA = 'ag5040_linha_pausa';
const TETO_AVISOS_HORA = 12;
const LINHA_MAX_HORA_PARA_AVISAR = 40;
const VEZ_ESPERA_MS = 2 * 60_000;
const CARTAO_ESPERA_MS = 10 * 60_000;
const TRAVA_4XX_MS = 3600_000;
const PENDENTE_VALIDADE_MS = 24 * 3600_000;
const UTM_TESTE = 'raio-x-teste';

const dig = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
/** O mesmo grupo, com ou sem o sufixo: só os dígitos do id. */
const chaveGrupo = (g: string): string => dig(String(g).replace(/(-group|@g\.us)$/i, ''));

/** O id do grupo em uso, ou '' (= sem grupo: não envia). Lido a cada chamada. */
export function grupoVendas(): string {
  const id = (process.env.ZAPI_SOLARDOC_GRUPO_ID || '').trim() || GRUPO_VENDAS_SOLARDOC.trim();
  if (!id) return '';
  const proibidos = [
    GRUPO_AGENDAMENTO_IO, (process.env.ZAPI_IO_GROUP_ID || '').trim(),
    GRUPO_ELETROPOSTO, (process.env.IO_GRUPO_ELETROPOSTO_ID || '').trim(),
  ].filter(Boolean).map(chaveGrupo);
  if (proibidos.includes(chaveGrupo(id))) {
    logger.error('solardoc-aviso', 'o id do grupo de vendas é o do agendamento da IO ou o do eletroposto: recusado, nada será enviado');
    return '';
  }
  return id;
}

// ── o lead do quiz ───────────────────────────────────────────────────────────

export interface LeadQuizLinha {
  lead_id?: string | null;
  nome?: string | null;
  whatsapp?: string | null;
  cidade?: string | null;
  field_data?: unknown;
  created_time?: string | null;
}

type Campo = { name?: string; values?: unknown[] };

/** Primeiro valor do campo `nome` do field_data, ou ''. */
export function campoDe(fieldData: unknown, nome: string): string {
  const lista = Array.isArray(fieldData) ? (fieldData as Campo[]) : [];
  const c = lista.find(x => x?.name === nome);
  const v = Array.isArray(c?.values) ? c?.values?.[0] : '';
  return String(v ?? '').trim();
}

/** Lead de teste: nunca gera aviso nem mensagem. */
export const ehLeadDeTeste = (fieldData: unknown): boolean => campoDe(fieldData, 'utm_source').toLowerCase() === UTM_TESTE;

/** Os campos do aviso a partir da linha do `leads_meta` (field_data com ids de opção, nunca o texto). */
export function camposDoLead(l: LeadQuizLinha): CamposAviso {
  const fd = l.field_data;
  const tel = normalizarTelefoneSd(l.whatsapp);
  return {
    nome_completo: l.nome,
    empresa: campoDe(fd, 'Empresa'),
    cidade: l.cidade,
    telefone: l.whatsapp,
    indice: campoDe(fd, 'Índice'),
    perfil: campoDe(fd, 'Perfil nome'),
    propostas_mes: ROTULO_PROPOSTAS[campoDe(fd, 'propostas_mes')] ?? '',
    quando: ROTULO_QUANDO[campoDe(fd, 'quando_comecar')] ?? '',
    codigo: campoDe(fd, 'Código') || (tel ? codigoDoQuiz(tel) : ''),
  };
}

const COLUNAS_LEAD = 'lead_id, nome, whatsapp, cidade, field_data, created_time';

/** O lead do quiz pelo telefone (lead_id = sdquiz_<DDD+8>) ou, se não achar, pelo `lp_session` gravado. Erro de leitura = null. */
export async function lerLeadDoQuiz(a: { telefone?: string | null; lpSession?: string | null }): Promise<LeadQuizLinha | null> {
  try {
    const tel = normalizarTelefoneSd(a.telefone);
    if (tel) {
      const { data } = await supabaseGerador.from('leads_meta').select(COLUNAS_LEAD)
        .eq('lead_id', leadIdDoQuiz(tel)).eq('form_id', 'quiz_solardoc').limit(1);
      if (data?.length) return data[0] as LeadQuizLinha;
    }
    const lp = String(a.lpSession ?? '').trim();
    if (lp && /^[\w.:-]{1,100}$/.test(lp)) {
      const { data } = await supabaseGerador.from('leads_meta').select(COLUNAS_LEAD)
        .eq('form_id', 'quiz_solardoc')
        .contains('field_data', [{ name: 'lp_session', values: [lp] }])
        .order('created_time', { ascending: false }).limit(1);
      if (data?.length) return data[0] as LeadQuizLinha;
    }
  } catch (e) {
    logger.warn('solardoc-aviso', 'ler o lead do quiz falhou', { erro: String(e) });
  }
  return null;
}

// ── id da venda: nunca nulo ──────────────────────────────────────────────────

const PARTE_INVALIDA = new Set(['', 'null', 'undefined', 'nan']);
const parteValida = (p: unknown): boolean => !PARTE_INVALIDA.has(String(p ?? '').trim().toLowerCase());

/**
 * Id único da venda para a chave do claim: o primeiro candidato que existe (nem vazio, nem "null", nem
 * "undefined"), com o prefixo. Sem nenhum, null: quem chama PULA o aviso ao grupo e registra.
 */
export function idDeVenda(prefixo: string, ...candidatos: unknown[]): string | null {
  for (const c of candidatos) {
    if (parteValida(c)) return `${prefixo}${String(c).trim()}`;
  }
  return null;
}

const idValido = (id: unknown): boolean => {
  const t = String(id ?? '').trim();
  return !!t && t.split(':').every(parteValida);
};

// ── claim, vez, trava, teto e envio ──────────────────────────────────────────

export type ResultadoAviso =
  | 'enviado'     // saiu no grupo
  | 'pendente'    // espera a vez, o teto, a linha ou a trava: sai no próximo cartão
  | 'duplicado'   // outra chamada já tem a vez
  | 'sem_grupo'   // sem id de grupo: nada enviado
  | 'por_email'   // trava de 4xx ou pausa da linha: o tick manda UM e-mail de resumo e o item não vai ao grupo
  | 'falhou'      // o WhatsApp falhou: e-mail mandado
  | 'ignorado'    // teste, sem plano ativo, sem chave
  | 'erro';       // o claim não gravou: nada enviado

const agoraIso = (): string => new Date().toISOString();
const iso = (ms: number): string => new Date(ms).toISOString();

async function reivindicar(chave: string, tipo: string): Promise<'ok' | 'duplicado' | 'erro'> {
  const em = agoraIso();
  const { error } = await supabase.from('system_state').insert({ key: chave, value: { tipo, estado: 'novo', em }, updated_at: em });
  if (!error) return 'ok';
  if ((error as { code?: string }).code === '23505') return 'duplicado';
  logger.error('solardoc-aviso', 'claim do aviso não gravou: nada será enviado', { tipo, erro: error.message });
  return 'erro';
}

async function marcar(chave: string, tipo: string, estado: string, extra: Record<string, unknown> = {}): Promise<void> {
  const em = agoraIso();
  const { error } = await supabase.from('system_state').update({ value: { tipo, estado, em, ...extra }, updated_at: em }).eq('key', chave);
  if (error) logger.warn('solardoc-aviso', 'marcar o estado do aviso falhou', { tipo, estado, erro: error.message });
}

/**
 * Toma uma chave de "vez": só passa quem encontra a chave mais velha que `janelaMs` (update condicional) ou
 * ainda inexistente (insert). Duas chamadas ao mesmo tempo: uma só leva.
 */
async function tomarChave(chave: string, janelaMs: number): Promise<boolean> {
  const agora = agoraIso();
  const { data, error } = await supabase.from('system_state')
    .update({ updated_at: agora, value: { em: agora } }).eq('key', chave).lt('updated_at', iso(Date.now() - janelaMs)).select('key');
  if (error) return false;
  if (data?.length) return true;
  const { error: erroInsert } = await supabase.from('system_state').insert({ key: chave, value: { em: agora }, updated_at: agora });
  return !erroInsert;
}

/** Devolve a vez tomada sem uso (o envio não aconteceu). */
async function devolverChave(chave: string): Promise<void> {
  await supabase.from('system_state').update({ updated_at: iso(0) }).eq('key', chave);
}

async function gravarTrava(status: string): Promise<void> {
  const agora = agoraIso();
  const { error } = await supabase.from('system_state')
    .upsert({ key: CHAVE_TRAVA_4XX, value: { ate: iso(Date.now() + TRAVA_4XX_MS), em: agora, status }, updated_at: agora }, { onConflict: 'key' });
  if (error) logger.warn('solardoc-aviso', 'gravar a trava do grupo falhou', { erro: error.message });
}

/**
 * Por que o grupo não pode receber agora?
 *  - 'trava': o 4xx de 1 h (quiz_aviso_trava), com a hora de volta e o status;
 *  - 'pausa': a linha 5040 pausada pelos erros seguidos (ag5040_linha_pausa), com a hora de volta;
 *  - 'duvida': a leitura falhou (na dúvida, não envia e não resolve nada por e-mail);
 *  - null: nada impede (o cooldown curto da memória é conferido à parte, em `emCooldown`).
 */
export type ParadaDoGrupo = { tipo: 'trava'; ate: number; status: string } | { tipo: 'pausa'; ate: number } | { tipo: 'duvida' } | null;

export async function paradaDoGrupo(): Promise<ParadaDoGrupo> {
  const t = await supabase.from('system_state').select('value').eq('key', CHAVE_TRAVA_4XX).maybeSingle();
  if (t.error) return { tipo: 'duvida' };
  const vt = (t.data as { value?: { ate?: string; status?: string } } | null)?.value;
  const ateT = Date.parse(String(vt?.ate ?? ''));
  if (Number.isFinite(ateT) && ateT > Date.now()) return { tipo: 'trava', ate: ateT, status: String(vt?.status ?? '4xx') };
  const p = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
  if (p.error) return { tipo: 'duvida' };
  const ateP = Date.parse(String((p.data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
  if (Number.isFinite(ateP) && ateP > Date.now()) return { tipo: 'pausa', ate: ateP };
  return null;
}

const emCooldown = (): boolean => linhaEmCooldown('io');

/** "HH:MM" de Brasília. */
const horaBRT = (ms: number): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** A linha do e-mail que diz por que o grupo não recebeu. */
export function motivoDaParada(p: NonNullable<ParadaDoGrupo>): string {
  if (p.tipo === 'trava') return `O grupo do WhatsApp está travado até ${horaBRT(p.ate)} (Brasília) por erro ${p.status}.`;
  if (p.tipo === 'pausa') return `A linha 5040 está pausada até ${horaBRT(p.ate)} (Brasília) pelos erros seguidos de envio.`;
  return 'Não consegui conferir o estado do grupo.';
}

/** Avisos que saíram no grupo na última hora (cartão de pendentes conta como 1). */
async function avisosDaUltimaHora(): Promise<number> {
  const desde = iso(Date.now() - 3600_000);
  const [{ data }, { data: cartao }] = await Promise.all([
    supabase.from('system_state').select('value')
      .or(`key.like.${PREFIXO_CLAIM_QUIZ}%,key.like.${PREFIXO_CLAIM_COMPRA}%`).gte('updated_at', desde).limit(200),
    supabase.from('system_state').select('key').eq('key', CHAVE_CARTAO_ULTIMO).gte('updated_at', desde).limit(1),
  ]);
  const enviados = ((data ?? []) as Array<{ value?: { estado?: string } }>).filter(r => r.value?.estado === 'enviado').length;
  return enviados + (cartao?.length ?? 0);
}

/** Envios da linha 5040 na última hora, com os do próprio módulo (a mesma conta do teto anti-ban). */
async function enviosDaLinhaNaHora(): Promise<number> {
  const prefixos = [...new Set([...prefixosTotalDaLinha(), PREFIXO_CARIMBO_AVISO])];
  const filtro = prefixos.map(p => `key.like.${p}%`).join(',');
  const { data } = await supabase.from('system_state').select('key').or(filtro).gte('updated_at', iso(Date.now() - 3600_000)).limit(LINHA_MAX_HORA_PARA_AVISAR + 1);
  return data?.length ?? 0;
}

/** Cabe mais um aviso agora? Leitura que falha vale como "não cabe" (vira pendente, nunca se perde). */
async function cabeAgora(): Promise<boolean> {
  try {
    if (await avisosDaUltimaHora() >= TETO_AVISOS_HORA) return false;
    if (await enviosDaLinhaNaHora() >= LINHA_MAX_HORA_PARA_AVISAR) return false;
    return true;
  } catch (e) {
    logger.warn('solardoc-aviso', 'conferir o teto falhou: aviso fica pendente', { erro: String(e) });
    return false;
  }
}

const escapar = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function emailOps(assunto: string, texto: string, motivo: string): Promise<void> {
  try {
    await sendOpsAlert(assunto, `<p>${escapar(motivo)}</p><pre style="white-space:pre-wrap;font-family:inherit">${escapar(texto)}</pre>`);
  } catch (e) {
    logger.error('solardoc-aviso', 'e-mail de resgate também falhou', { erro: String(e) });
  }
}

/** UM e-mail de resumo com os avisos que não saíram por falta de id do grupo (a rodada inteira, nunca um por lead). */
export async function emailResumoSemGrupo(textos: string[]): Promise<void> {
  if (!textos.length) return;
  await emailOps(
    `Avisos do SolarDoc sem grupo (${textos.length})`, textos.join('\n\n'),
    'O grupo de vendas do SolarDoc ainda não tem id (ZAPI_SOLARDOC_GRUPO_ID / GRUPO_VENDAS_SOLARDOC). Avisos que não saíram:',
  );
}

/**
 * UM e-mail de resumo com os avisos de desistência e de sem vaga que não podem esperar a trava de 1 h (4xx) nem a pausa
 * da linha: a mesma regra de quando falta o id do grupo. Cada item já foi marcado `email` e NÃO vai ao grupo depois.
 */
export async function emailResumoParada(textos: string[], parada: ParadaDoGrupo): Promise<void> {
  if (!textos.length) return;
  const motivo = parada ? motivoDaParada(parada) : 'O grupo do WhatsApp não estava disponível.';
  await emailOps(`Avisos do SolarDoc por e-mail: grupo parado (${textos.length})`, textos.join('\n\n'), `${motivo} Avisos que não esperam:`);
}

/** Erro 4xx do grupo (menos 408 e 429, que pedem espera): a linha ou o grupo disse NÃO. */
const status4xx = (e: unknown): string | null => {
  const m = /HTTP (4\d\d)/.exec(e instanceof Error ? e.message : String(e));
  return m && m[1] !== '408' && m[1] !== '429' ? m[1]! : null;
};

/** O envio físico ao grupo: carimbo da linha antes, 4xx grava a trava de 1 h. */
async function enviarAoGrupo(grupo: string, texto: string): Promise<{ ok: true } | { ok: false; erro: unknown }> {
  const carimbo = `${PREFIXO_CARIMBO_AVISO}${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const em = agoraIso();
  const { error: erroCarimbo } = await supabase.from('system_state').insert({ key: carimbo, value: { em }, updated_at: em });
  if (erroCarimbo) logger.warn('solardoc-aviso', 'carimbo do envio não gravou (envia mesmo assim)', { erro: erroCarimbo.message });
  try {
    await sendToGroup(grupo, texto, 'io');
    return { ok: true };
  } catch (erro) {
    if (!erroCarimbo) await supabase.from('system_state').delete().eq('key', carimbo);
    const st = status4xx(erro);
    if (st) await gravarTrava(st);
    return { ok: false, erro };
  }
}

interface OpcoesEmitir {
  chave: string; tipo: string; texto: string;
  /** Desistência e sem vaga: na trava de 4xx e na pausa da linha não esperam 24 h, viram e-mail (resumo da rodada). Compra espera. */
  urgente?: boolean;
}

async function emitir(o: OpcoesEmitir): Promise<ResultadoAviso> {
  const r = await reivindicar(o.chave, o.tipo);
  if (r === 'duplicado') return 'duplicado';
  if (r === 'erro') return 'erro';

  const grupo = grupoVendas();
  if (!grupo) {
    await marcar(o.chave, o.tipo, 'sem_grupo');
    logger.warn('solardoc-aviso', `sem id do grupo de vendas: aviso de ${o.tipo} não enviado`);
    return 'sem_grupo';
  }
  // Pendente: a linha ou o grupo não estão para envio, o teto da hora encheu ou outro aviso avulso tem a vez.
  const pendente = async (): Promise<ResultadoAviso> => {
    await marcar(o.chave, o.tipo, 'pendente', { texto: o.texto });
    return 'pendente';
  };
  const parada = await paradaDoGrupo();
  if (parada && o.urgente && parada.tipo !== 'duvida') {
    await marcar(o.chave, o.tipo, 'email');
    return 'por_email';
  }
  if (parada) return pendente();
  if (emCooldown()) return pendente();   // cooldown curto da memória: fica para a próxima rodada
  if (!(await cabeAgora())) return pendente();
  if (!(await tomarChave(CHAVE_VEZ_AVULSA, VEZ_ESPERA_MS))) return pendente();

  const env = await enviarAoGrupo(grupo, o.texto);
  if (env.ok) {
    await marcar(o.chave, o.tipo, 'enviado');
    return 'enviado';
  }
  await devolverChave(CHAVE_VEZ_AVULSA);
  await marcar(o.chave, o.tipo, 'falhou');
  logger.error('solardoc-aviso', `envio ao grupo falhou (${o.tipo})`, { erro: String(env.erro) });
  await emailOps(`Aviso do SolarDoc não chegou ao grupo (${o.tipo})`, o.texto, 'O WhatsApp falhou ao enviar este aviso ao grupo de vendas. Segue o conteúdo:');
  return 'falhou';
}

// ── os três avisos ───────────────────────────────────────────────────────────

const diaBRT = (ms = Date.now()): string => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
const hmacDoLead = (whatsapp: string | null | undefined): string | null => {
  const tel = normalizarTelefoneSd(whatsapp);
  return tel ? hmacDe(chaveDoTelefone(tel)) : null;
};

/** Desistência: o lead do quiz não comprou em 15 min. Uma vez por pessoa. `horaCarla` só quando a Carla já falou ("HH:MM", BRT). */
export async function avisarDesistencia(lead: LeadQuizLinha, opts: { horaCarla?: string | null } = {}): Promise<ResultadoAviso> {
  if (ehLeadDeTeste(lead.field_data)) return 'ignorado';
  const h = hmacDoLead(lead.whatsapp);
  if (!h) { logger.warn('solardoc-aviso', 'desistência sem telefone ou sem segredo de HMAC: ignorada'); return 'ignorado'; }
  const texto = montarAviso('desistencia', { ...camposDoLead(lead), hora_carla: opts.horaCarla ?? null });
  return emitir({ chave: `${PREFIXO_CLAIM_QUIZ}${h}`, tipo: 'desistencia', texto, urgente: true });
}

/** Sem vaga para a Carla no dia. Uma vez por pessoa por dia (BRT). */
export async function avisarSemVaga(lead: LeadQuizLinha, opts: { dia?: string } = {}): Promise<ResultadoAviso> {
  if (ehLeadDeTeste(lead.field_data)) return 'ignorado';
  const h = hmacDoLead(lead.whatsapp);
  if (!h) { logger.warn('solardoc-aviso', 'sem vaga sem telefone ou sem segredo de HMAC: ignorado'); return 'ignorado'; }
  const texto = montarAviso('semVaga', camposDoLead(lead));
  return emitir({ chave: `${PREFIXO_CLAIM_QUIZ}${h}:semvaga:${opts.dia ?? diaBRT()}`, tipo: 'sem_vaga', texto, urgente: true });
}

export type CanalCompra = 'cartao' | 'asaas' | 'comprovante';
const MODELO_DO_CANAL: Record<CanalCompra, ModeloAviso> = { cartao: 'compraCartao', asaas: 'compraAsaas', comprovante: 'compraComprovante' };

export interface CompraAviso {
  /** Id da venda, estável entre reentregas (monte com `idDeVenda`): session.id (Stripe), `asaas:<contrato>` ou `pix:<e2e ou dedupKey>`. */
  id: string;
  canal: CanalCompra;
  /** O plano da pessoa está ativo? Sem plano ativo, nenhum aviso. */
  planoAtivo: boolean;
  /** Cartão em teste grátis (trialing): o texto NÃO diz "Pagamento confirmado". */
  emTeste?: boolean;
  valor: number;
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  /** `lp_session` da sessão da Stripe, para casar com o lead do quiz. */
  lpSession?: string | null;
  /** O metadata da sessão da Stripe diz origem = quiz_solardoc. */
  origemQuiz?: boolean;
  utmSource?: string | null;
}

/**
 * Compra (uma por venda, para os três caminhos), UM A MAIS que o aviso individual ao Thiago. O lead do quiz é
 * achado pelo `lp_session` ou pelo telefone do cliente pagante; sem lead, o campo Origem sai "outra". Sem id de
 * grupo NÃO manda e-mail. Id nulo ou inválido: pula e registra. Nunca lança.
 */
export async function avisarCompra(c: CompraAviso): Promise<ResultadoAviso> {
  try {
    if (!c.planoAtivo) return 'ignorado';
    if (!idValido(c.id)) {
      logger.error('solardoc-aviso', 'compra sem id único da venda: aviso ao grupo pulado', { canal: c.canal });
      return 'ignorado';
    }
    if (String(c.utmSource ?? '').toLowerCase() === UTM_TESTE) return 'ignorado';
    const lead = await lerLeadDoQuiz({ telefone: c.telefone, lpSession: c.lpSession });
    if (lead && ehLeadDeTeste(lead.field_data)) return 'ignorado';
    const doLead = lead ? camposDoLead(lead) : {};
    const tel = normalizarTelefoneSd(c.telefone);
    const campos: CamposAviso = {
      ...doLead,
      nome_completo: doLead.nome_completo || c.nome || c.email || '',
      valor: c.valor,
      codigo: lead ? doLead.codigo : (c.origemQuiz && tel ? codigoDoQuiz(tel) : ''),
      doQuizSemCodigo: !lead && !!c.origemQuiz,
    };
    const modelo: ModeloAviso = c.canal === 'cartao' && c.emTeste ? 'compraCartaoTeste' : MODELO_DO_CANAL[c.canal];
    const texto = montarAviso(modelo, campos);
    return await emitir({ chave: `${PREFIXO_CLAIM_COMPRA}${String(c.id).trim()}`, tipo: `compra_${c.canal}`, texto });
  } catch (e) {
    logger.error('solardoc-aviso', 'aviso de compra falhou', { erro: String(e) });
    return 'erro';
  }
}

// ── pendentes: um cartão só, a cada 10 min ───────────────────────────────────

const TETO_CARTAO_CHARS = 3500;

type LinhaPendente = { key: string; updated_at?: string; value?: { tipo?: string; estado?: string; texto?: string } };

/**
 * Esvazia os pendentes. Primeiro o que passou de 24 h vira e-mail (um só) e `expirado`, com ou sem grupo. Depois,
 * se o grupo, a linha e a trava deixam, junta o resto num cartão (1 bolha, no máximo 1 a cada 10 min, e só se
 * nenhum aviso avulso teve a vez nos últimos 2 min). Devolve quantos saíram no cartão.
 */
export async function descarregarPendentes(
  opts: { emailAgora?: boolean } = {},
): Promise<{ enviados: number; expirados?: number; motivo?: string; porEmail?: string[]; parada?: ParadaDoGrupo }> {
  const emailAgora = opts.emailAgora !== false;
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at')
    .or(`key.like.${PREFIXO_CLAIM_QUIZ}%,key.like.${PREFIXO_CLAIM_COMPRA}%`)
    .eq('value->>estado', 'pendente')
    .order('updated_at', { ascending: true }).limit(200);
  if (error) { logger.warn('solardoc-aviso', 'ler pendentes falhou', { erro: error.message }); return { enviados: 0, motivo: 'erro_leitura' }; }
  const todos = ((data ?? []) as LinhaPendente[]).filter(r => r.value?.estado === 'pendente' && r.value.texto);

  // 1) Vencidos (mais de 24 h): não somem calados.
  const corte = iso(Date.now() - PENDENTE_VALIDADE_MS);
  const vencidos = todos.filter(r => String(r.updated_at ?? '') < corte);
  if (vencidos.length) {
    await emailOps(
      `Avisos do SolarDoc que esperaram mais de 24 h (${vencidos.length})`, vencidos.map(p => p.value!.texto).join('\n\n'),
      'Estes avisos ficaram pendentes por mais de 24 horas e não foram ao grupo de vendas. Segue o conteúdo:',
    );
    for (const p of vencidos) await marcar(p.key, p.value?.tipo ?? 'aviso', 'expirado');
  }
  const pendentes = todos.filter(r => !vencidos.includes(r));
  const expirados = vencidos.length || undefined;

  // 2) O cartão.
  const grupo = grupoVendas();
  if (!grupo) return { enviados: 0, expirados, motivo: 'sem_grupo' };
  if (!pendentes.length) return { enviados: 0, expirados, motivo: 'nada_pendente' };
  const parada = await paradaDoGrupo();
  if (parada) {
    // Trava de 4xx ou pausa da linha: desistência e sem vaga não esperam, viram UM e-mail e saem da fila. Compra espera.
    let porEmail: string[] | undefined;
    if (parada.tipo !== 'duvida') {
      const urgentes = pendentes.filter(p => p.value?.tipo === 'desistencia' || p.value?.tipo === 'sem_vaga');
      if (urgentes.length) {
        porEmail = urgentes.map(p => p.value!.texto!);
        for (const p of urgentes) await marcar(p.key, p.value?.tipo ?? 'aviso', 'email');
        if (emailAgora) await emailResumoParada(porEmail, parada);
      }
    }
    return { enviados: 0, expirados, motivo: parada.tipo === 'trava' ? 'trava_4xx' : parada.tipo === 'pausa' ? 'linha_caida' : 'duvida', porEmail, parada };
  }
  if (emCooldown()) return { enviados: 0, expirados, motivo: 'linha_caida' };
  if (!(await tomarChave(CHAVE_CARTAO_ULTIMO, CARTAO_ESPERA_MS))) return { enviados: 0, expirados, motivo: 'cartao_recente' };
  if (!(await tomarChave(CHAVE_VEZ_AVULSA, VEZ_ESPERA_MS))) {
    await devolverChave(CHAVE_CARTAO_ULTIMO);
    return { enviados: 0, expirados, motivo: 'vez_ocupada' };
  }

  const incluidos: LinhaPendente[] = [];
  let corpo = '';
  for (const p of pendentes) {
    const parte = `${incluidos.length ? '\n\n' : ''}${p.value!.texto}`;
    if (incluidos.length && (corpo + parte).length > TETO_CARTAO_CHARS) break;
    corpo += parte;
    incluidos.push(p);
  }
  const texto = incluidos.length === 1 ? corpo : `📋 ${incluidos.length} avisos que esperaram o teto da linha\n\n${corpo}`;
  const env = await enviarAoGrupo(grupo, texto);
  if (!env.ok) {
    logger.error('solardoc-aviso', 'cartão de pendentes falhou', { erro: String(env.erro) });
    await devolverChave(CHAVE_VEZ_AVULSA);
    await emailOps('Avisos do SolarDoc não chegaram ao grupo', texto, 'O WhatsApp falhou ao enviar o cartão de avisos pendentes ao grupo de vendas. Segue o conteúdo:');
    for (const p of incluidos) await marcar(p.key, p.value?.tipo ?? 'aviso', 'falhou');
    return { enviados: 0, expirados, motivo: 'falhou' };
  }
  // `enviado_cartao` não entra na conta de 12 por hora (o cartão inteiro conta 1, pela chave dele).
  for (const p of incluidos) await marcar(p.key, p.value?.tipo ?? 'aviso', 'enviado_cartao');
  return { enviados: incluidos.length, expirados };
}
