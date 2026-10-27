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
//      quiz_aviso:<hmac>:semvaga               sem vaga (UMA por pessoa, para sempre; nunca se a desistência já saiu)
//      compra_aviso:<id da venda>              compra (uma para Stripe, Asaas e comprovante)
//    O valor guarda como a coisa saiu: enviado | pendente | sem_grupo | falhou | expirado.
//  - UM aviso avulso por vez: a vez é uma chave de 2 min tomada por update condicional
//    ou insert (quiz_aviso_vez). Os demais ficam `pendente` e saem no cartão, que junta
//    os pendentes numa bolha só, no máximo 1 a cada 10 min (descarregarPendentes).
//  - COMPRA (Stripe, Asaas e comprovante) só reivindica o claim e fica `pendente`: quem envia
//    ao grupo é o tick (descarregarPendentes), nunca o webhook. O aviso ao Thiago sai na hora.
//  - Fica `pendente` também: linha pausada (ag5040_linha_pausa) ou em cooldown, trava de
//    1 h depois de um 4xx do grupo, 12 avisos avulsos na hora (o cartão não tem esse teto),
//    linha com 40 envios ou mais na hora (avulso e cartão), leitura de teto que falha, e o
//    ESPAÇAMENTO contra o último envio da linha (25 s mais um sorteio de 0 a 35 s, sem sleep).
//  - Cada envio físico (avulso e cartão) deixa o carimbo `solardoc_aviso_sent:` (balde das
//    respostas das agentes, lineThrottle.ts), e a conta de "abaixo de 40 na hora" os soma.
//    O carimbo de um envio que falhou FICA: 5xx e timeout podem ter saído.
//  - Erro de LINHA (classificarErroEnvio diferente de 'destino') conta em ag5040_linha_erros:
//    2 seguidos gravam a pausa da linha (15 min) e um envio ok zera. Só o 4xx de DESTINO grava
//    a trava `quiz_aviso_trava` por 1 h: nesse tempo só e-mail.
//  - Claim parado em `novo` há mais de 10 min (a função caiu entre o insert e o `marcar`) vale
//    como `pendente`: o texto vai junto no claim.
//  - No cartão, só a primeira linha tem emoji (regra do WhatsApp). O e-mail do cliente nunca
//    entra no texto.
//  - Pendente com mais de 24 h não some calado: vira e-mail e `expirado`.
//  - Lead de teste (utm_source = 'raio-x-teste') nunca gera aviso.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendOpsAlert } from '../../utils/mailer';
import { sendToGroup, linhaEmCooldown } from '../agents/zapiClient';
import { prefixosTotalDaLinha, PREFIXOS_AGENDA } from '../agents/whatsapp/lineThrottle';
import { classificarErroEnvio } from '../chefe/decidir';
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
/** Os mesmos contadores do vivoEnvio.ts e do agendaEnvio.ts: 2 erros de linha seguidos pausam a linha por 15 min. */
const CHAVE_LINHA_ERROS = 'ag5040_linha_erros';
const ERROS_PARA_PAUSAR = 2;
const PAUSA_LINHA_MS = 15 * 60_000;
const TETO_AVISOS_HORA = 12;
const LINHA_MAX_HORA_PARA_AVISAR = 40;
const VEZ_ESPERA_MS = 2 * 60_000;
const CARTAO_ESPERA_MS = 10 * 60_000;
const TRAVA_4XX_MS = 3600_000;
const PENDENTE_VALIDADE_MS = 24 * 3600_000;
/** Claim em `novo` há mais que isto (a função tem 300 s) foi abandonado: vale como pendente. */
const NOVO_ABANDONADO_MS = 10 * 60_000;
/** Espaçamento contra o último envio de QUALQUER robô da linha (o mesmo da agenda): 25 s mais um sorteio de 0 a 35 s. */
const ESPACO_LINHA_MS = 25_000;
const ESPACO_SORTEIO_MS = 35_000;
export const TEMPOS_AVISO = { sorteio: (max: number): number => Math.floor(Math.random() * (max + 1)) };
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

/** Lead de teste (utm_source = raio-x-teste OU o campo teste = sim, gravado pela rota do quiz): nunca gera aviso nem mensagem. */
export const ehLeadDeTeste = (fieldData: unknown): boolean =>
  campoDe(fieldData, 'utm_source').toLowerCase() === UTM_TESTE || campoDe(fieldData, 'teste').toLowerCase() === 'sim';

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

async function reivindicar(chave: string, tipo: string, texto: string): Promise<'ok' | 'duplicado' | 'erro'> {
  const em = agoraIso();
  // O texto vai no claim desde o início: se a função cair antes do `marcar`, o claim `novo` velho ainda pode sair (descarregarPendentes).
  const { error } = await supabase.from('system_state').insert({ key: chave, value: { tipo, estado: 'novo', em, texto }, updated_at: em });
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
 * Quem já comprou: grava o claim `quiz_aviso:<hmac>` com estado `comprou`, SEM envio, para o tick de desistência não consultar
 * `sales` e `users` de novo a cada rodada. Já existir (23505) não é erro. Nunca lança.
 */
export async function marcarComprou(hmac: string): Promise<void> {
  try {
    const em = agoraIso();
    const { error } = await supabase.from('system_state').insert({ key: `${PREFIXO_CLAIM_QUIZ}${hmac}`, value: { tipo: 'desistencia', estado: 'comprou', em }, updated_at: em });
    if (error && (error as { code?: string }).code !== '23505') logger.warn('solardoc-aviso', 'marcar quem comprou falhou', { erro: error.message });
  } catch (e) {
    logger.warn('solardoc-aviso', 'marcar quem comprou falhou', { erro: String(e) });
  }
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
  const [{ data, error }, { data: cartao, error: erroCartao }] = await Promise.all([
    supabase.from('system_state').select('value')
      // Só os que de fato saíram avulsos (`enviado`). O filtro é no banco: pendente, email e sem_grupo na hora não gastam o teto nem escondem os enviados atrás do limite de 200.
      // `enviado_cartao` não entra: o cartão inteiro conta 1, pela chave dele.
      .or(`key.like.${PREFIXO_CLAIM_QUIZ}%,key.like.${PREFIXO_CLAIM_COMPRA}%`).eq('value->>estado', 'enviado').gte('updated_at', desde).limit(200),
    supabase.from('system_state').select('key').eq('key', CHAVE_CARTAO_ULTIMO).gte('updated_at', desde).limit(1),
  ]);
  // Leitura que falha vale como "linha cheia" (quem chama trata o throw como "não cabe"): nunca como zero.
  if (error) throw new Error(`ler avisos da hora: ${error.message}`);
  if (erroCartao) throw new Error(`ler o cartão da hora: ${erroCartao.message}`);
  const enviados = ((data ?? []) as Array<{ value?: { estado?: string } }>).filter(r => r.value?.estado === 'enviado').length;
  return enviados + (cartao?.length ?? 0);
}

/** Envios da linha 5040 na última hora, com os do próprio módulo (a mesma conta do teto anti-ban). */
async function enviosDaLinhaNaHora(): Promise<number> {
  const prefixos = [...new Set([...prefixosTotalDaLinha(), PREFIXO_CARIMBO_AVISO])];
  const filtro = prefixos.map(p => `key.like.${p}%`).join(',');
  const { data, error } = await supabase.from('system_state').select('key').or(filtro).gte('updated_at', iso(Date.now() - 3600_000)).limit(LINHA_MAX_HORA_PARA_AVISAR + 1);
  if (error) throw new Error(`ler envios da linha: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Cabe mais um aviso agora? Leitura que falha vale como "não cabe" (vira pendente, nunca se perde).
 * Avulso: 12 por hora do módulo e 40 da linha. Cartão (`avulso: false`): só os 40 da linha (o cartão inteiro conta 1 no teto dos 12).
 */
async function cabeAgora(opts: { avulso: boolean } = { avulso: true }): Promise<boolean> {
  try {
    if (opts.avulso && await avisosDaUltimaHora() >= TETO_AVISOS_HORA) return false;
    if (await enviosDaLinhaNaHora() >= LINHA_MAX_HORA_PARA_AVISAR) return false;
    return true;
  } catch (e) {
    logger.warn('solardoc-aviso', 'conferir o teto falhou: aviso fica pendente', { erro: String(e) });
    return false;
  }
}

/**
 * Espaçamento contra o último envio de QUALQUER robô da linha (chaves de prefixosTotalDaLinha() e PREFIXOS_AGENDA, com o
 * carimbo do próprio módulo): faz menos de 25 s mais um sorteio de 0 a 35 s? Então o aviso fica pendente, SEM sleep. Leitura que
 * falha, ou relógio do banco à frente do nosso, vale como "ainda não".
 */
async function linhaEspacada(): Promise<boolean> {
  try {
    const prefixos = [...new Set([...prefixosTotalDaLinha(), ...PREFIXOS_AGENDA, PREFIXO_CARIMBO_AVISO])];
    const filtro = prefixos.map(p => `key.like.${p}%`).join(',');
    const { data, error } = await supabase.from('system_state').select('updated_at').or(filtro)
      .order('updated_at', { ascending: false }).limit(1);
    if (error) { logger.warn('solardoc-aviso', 'ler o último envio da linha falhou: aviso fica pendente', { erro: error.message }); return false; }
    const ultimo = Date.parse(String(((data ?? []) as Array<{ updated_at?: string }>)[0]?.updated_at ?? ''));
    if (!Number.isFinite(ultimo)) return true;           // nenhum envio recente na linha
    const passou = Date.now() - ultimo;
    if (passou < 0) return false;                        // relógio do banco à frente: não espera, fica para a próxima rodada
    return passou >= ESPACO_LINHA_MS + TEMPOS_AVISO.sorteio(ESPACO_SORTEIO_MS);
  } catch (e) {
    logger.warn('solardoc-aviso', 'conferir o espaçamento da linha falhou: aviso fica pendente', { erro: String(e) });
    return false;
  }
}

// ── erros de linha (os mesmos contadores do vivoEnvio.ts e do agendaEnvio.ts) ──

async function lerErrosSeguidos(): Promise<number> {
  const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
  const n = Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function gravarErros(n: number, quando: Date): Promise<void> {
  const { error } = await supabase.from('system_state').upsert(
    { key: CHAVE_LINHA_ERROS, value: { n, em: quando.toISOString() }, updated_at: quando.toISOString() }, { onConflict: 'key' });
  if (error) logger.warn('solardoc-aviso', 'não gravei o contador de erros da linha', { erro: error.message });
}

/** Envio ok: o contador de erros seguidos volta a zero (só escreve se havia algo a zerar). */
async function zerarErros(quando: Date): Promise<void> {
  try { if ((await lerErrosSeguidos()) > 0) await gravarErros(0, quando); } catch (e) { logger.warn('solardoc-aviso', 'não zerei o contador de erros da linha', { erro: String(e) }); }
}

/** Erro de linha: soma ao contador; no 2º seguido grava a pausa de 15 min da linha. */
async function contarErroDeLinha(quando: Date): Promise<void> {
  try {
    const n = (await lerErrosSeguidos()) + 1;
    await gravarErros(n, quando);
    if (n >= ERROS_PARA_PAUSAR) {
      const ate = new Date(quando.getTime() + PAUSA_LINHA_MS).toISOString();
      const { error } = await supabase.from('system_state').upsert(
        { key: CHAVE_LINHA_PAUSA, value: { ate, motivo: 'erros_seguidos', n }, updated_at: quando.toISOString() }, { onConflict: 'key' });
      if (error) logger.error('solardoc-aviso', 'não gravei a pausa da linha', { erro: error.message });
      else logger.error('solardoc-aviso', `linha pausada até ${ate} (${n} erros seguidos)`);
    }
  } catch (e) { logger.warn('solardoc-aviso', 'contagem de erro da linha falhou', { erro: String(e) }); }
}

const PREFIXO_MARCA_EMAIL = 'solardoc_aviso_mail:';

/** Marca, ANTES de decidir "vai por e-mail", que este aviso não vai ao grupo. Insert; já existir não é erro. Nunca lança. */
async function marcarMail(chave: string): Promise<void> {
  try {
    const em = agoraIso();
    const { error } = await supabase.from('system_state').insert({ key: `${PREFIXO_MARCA_EMAIL}${chave}`, value: { em }, updated_at: em });
    if (error && (error as { code?: string }).code !== '23505') logger.warn('solardoc-aviso', 'marca do e-mail não gravou', { erro: error.message });
  } catch (e) { logger.warn('solardoc-aviso', 'marca do e-mail não gravou', { erro: String(e) }); }
}

/**
 * Dos claims `novo` velhos e `pendente`: quais JÁ SAÍRAM no grupo (algum carimbo `solardoc_aviso_sent:` leva a chave do aviso) e quais já
 * foram resolvidos por e-mail (marca `solardoc_aviso_mail:<chave>`). Esses não voltam ao grupo. Erro de leitura LANÇA (quem chama não envia nada).
 */
async function jaResolvidos(linhas: Array<{ key: string; updated_at?: string }>): Promise<{ saiu: Set<string>; mail: Set<string> }> {
  const saiu = new Set<string>();
  const mail = new Set<string>();
  if (!linhas.length) return { saiu, mail };
  const maisAntigo = linhas.reduce((m, r) => (String(r.updated_at ?? '') < m ? String(r.updated_at ?? '') : m), iso(Date.now()));
  const desde = iso(Math.max(0, (Date.parse(maisAntigo) || Date.now()) - 3600_000));
  const { data, error } = await supabase.from('system_state').select('value').like('key', `${PREFIXO_CARIMBO_AVISO}%`).gte('updated_at', desde).limit(2000);
  if (error) throw new Error(`ler carimbos dos avisos: ${error.message}`);
  for (const r of (data ?? []) as Array<{ value?: { chaves?: unknown } }>) {
    if (Array.isArray(r.value?.chaves)) for (const k of r.value!.chaves as unknown[]) saiu.add(String(k));
  }
  const chaves = linhas.map(r => r.key);
  for (let i = 0; i < chaves.length; i += 100) {
    const { data: m, error: erroM } = await supabase.from('system_state').select('key')
      .in('key', chaves.slice(i, i + 100).map(k => `${PREFIXO_MARCA_EMAIL}${k}`));
    if (erroM) throw new Error(`ler marcas de e-mail: ${erroM.message}`);
    for (const r of (m ?? []) as Array<{ key: string }>) mail.add(r.key.slice(PREFIXO_MARCA_EMAIL.length));
  }
  return { saiu, mail };
}

const escapar = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** true = o e-mail saiu; false = falhou (já logado). Nunca lança. */
async function emailOps(assunto: string, texto: string, motivo: string): Promise<boolean> {
  try {
    await sendOpsAlert(assunto, `<p>${escapar(motivo)}</p><pre style="white-space:pre-wrap;font-family:inherit">${escapar(texto)}</pre>`);
    return true;
  } catch (e) {
    logger.error('solardoc-aviso', 'e-mail de resgate também falhou', { erro: String(e) });
    return false;
  }
}

/** UM e-mail de resumo com os avisos que não saíram por falta de id do grupo (a rodada inteira, nunca um por lead). */
export async function emailResumoSemGrupo(textos: string[]): Promise<boolean> {
  if (!textos.length) return true;
  return emailOps(
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

/**
 * O envio físico ao grupo: carimbo da linha antes. Falhou: o carimbo FICA (5xx e timeout podem ter saído). Erro de linha
 * (classificarErroEnvio diferente de 'destino') conta nos 2 seguidos que pausam a linha; só o 4xx de DESTINO grava a trava de 1 h.
 * Envio ok zera a conta de erros.
 */
async function enviarAoGrupo(grupo: string, texto: string, chaves: string[] = []): Promise<{ ok: true } | { ok: false; erro: unknown }> {
  const carimbo = `${PREFIXO_CARIMBO_AVISO}${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const em = agoraIso();
  // O carimbo leva as chaves dos avisos que vão neste envio: se o envio der certo e o `marcar(enviado)` falhar, o claim fica `novo`/`pendente`
  // e a conferência de descarregarPendentes acha o carimbo e NÃO reenvia.
  const { error: erroCarimbo } = await supabase.from('system_state').insert({ key: carimbo, value: { em, chaves }, updated_at: em });
  if (erroCarimbo) logger.warn('solardoc-aviso', 'carimbo do envio não gravou (envia mesmo assim)', { erro: erroCarimbo.message });
  try {
    await sendToGroup(grupo, texto, 'io');
  } catch (erro) {
    if (classificarErroEnvio(erro) === 'destino') {
      const st = status4xx(erro);
      if (st) await gravarTrava(st);
    } else {
      await contarErroDeLinha(new Date());
    }
    return { ok: false, erro };
  }
  await zerarErros(new Date());
  return { ok: true };
}

interface OpcoesEmitir {
  chave: string; tipo: string; texto: string;
  /** Desistência e sem vaga: na trava de 4xx e na pausa da linha não esperam 24 h, viram e-mail (resumo da rodada). Compra espera. */
  urgente?: boolean;
  /** Compra: só reivindica o claim e fica pendente. Quem envia ao grupo é o tick (descarregarPendentes), nunca o webhook. */
  soReivindicar?: boolean;
  /** Opt-in do ROBÔ da Carla (27/10): sem id de grupo, o aviso marcado `sem_grupo` entra neste coletor da rodada e o robô manda UM e-mail no fim
   *  (`fecharSemGrupo`). O tick não passa isto: ele manda o resumo dele. */
  coletorSemGrupo?: ColetorSemGrupo;
}

/** Avisos de uma rodada do robô que ficaram `sem_grupo` e esperam o e-mail único do fim da rodada. */
export type ColetorSemGrupo = Array<{ chave: string; tipo: string; texto: string }>;

async function emitir(o: OpcoesEmitir): Promise<ResultadoAviso> {
  const r = await reivindicar(o.chave, o.tipo, o.texto);
  if (r === 'duplicado') return 'duplicado';
  if (r === 'erro') return 'erro';

  const grupo = grupoVendas();
  if (!grupo) {
    await marcar(o.chave, o.tipo, 'sem_grupo');
    logger.warn('solardoc-aviso', `sem id do grupo de vendas: aviso de ${o.tipo} não enviado`);
    o.coletorSemGrupo?.push({ chave: o.chave, tipo: o.tipo, texto: o.texto });
    return 'sem_grupo';
  }
  // Pendente: a linha ou o grupo não estão para envio, o teto da hora encheu ou outro aviso avulso tem a vez.
  const pendente = async (): Promise<ResultadoAviso> => {
    await marcar(o.chave, o.tipo, 'pendente', { texto: o.texto });
    return 'pendente';
  };
  if (o.soReivindicar) return pendente();
  const parada = await paradaDoGrupo();
  if (parada && o.urgente && parada.tipo !== 'duvida') {
    await marcarMail(o.chave);   // a marca vai ANTES: se o `marcar` falhar, o claim `novo` velho não vira pendente e não vai ao grupo depois do e-mail
    await marcar(o.chave, o.tipo, 'email');
    return 'por_email';
  }
  if (parada) return pendente();
  if (emCooldown()) return pendente();   // cooldown curto da memória: fica para a próxima rodada
  if (!(await cabeAgora({ avulso: true }))) return pendente();
  if (!(await linhaEspacada())) return pendente();   // antes das chaves: o espaçamento que falha não gasta a vez de ninguém
  if (!(await tomarChave(CHAVE_VEZ_AVULSA, VEZ_ESPERA_MS))) return pendente();

  const env = await enviarAoGrupo(grupo, o.texto, [o.chave]);
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

/**
 * Fim da rodada do robô: UM e-mail com todos os avisos coletados (sem id de grupo). Se o e-mail saiu, cada claim vira `email_sem_grupo`
 * (estado que nenhum código reabre ou reenvia: descarregarPendentes só olha `pendente`/`novo`); se falhou, viram `sem_grupo_falhou` (também sem reabrir nada,
 * e fora das listas de "avisado" da tela: o time NÃO soube) e o erro já está no log.
 * Esvazia o coletor. Nunca lança.
 */
export async function fecharSemGrupo(coletor: ColetorSemGrupo): Promise<void> {
  if (!coletor.length) return;
  const itens = coletor.splice(0, coletor.length);
  try {
    const saiu = await emailResumoSemGrupo(itens.map(i => i.texto));
    for (const i of itens) await marcar(i.chave, i.tipo, saiu ? 'email_sem_grupo' : 'sem_grupo_falhou');
  } catch (e) {
    logger.error('solardoc-aviso', 'fechar os avisos sem grupo falhou', { erro: String(e) });
  }
}

// ── os três avisos ───────────────────────────────────────────────────────────

const hmacDoLead = (whatsapp: string | null | undefined): string | null => {
  const tel = normalizarTelefoneSd(whatsapp);
  return tel ? hmacDe(chaveDoTelefone(tel)) : null;
};

/**
 * Desistência: o lead do quiz não comprou em 15 min. Uma vez por pessoa (o claim é a trava de TODOS os caminhos: robô, tick, vencimento).
 *  - `horaCarla` ("HH:MM", BRT): a Carla já falou.
 *  - `motivoCarla` (a frase inteira, de FRASE_DO_MOTIVO): a Carla não vai chamar ou não chamou.
 *  - `soReivindicar`: só toma o claim e deixa o aviso `pendente`; quem envia é o tick do B1 (descarregarPendentes), com o espaçamento dele.
 */
export async function avisarDesistencia(
  lead: LeadQuizLinha, opts: { horaCarla?: string | null; motivoCarla?: string | null; soReivindicar?: boolean; coletorSemGrupo?: ColetorSemGrupo } = {},
): Promise<ResultadoAviso> {
  if (ehLeadDeTeste(lead.field_data)) return 'ignorado';
  const h = hmacDoLead(lead.whatsapp);
  if (!h) { logger.warn('solardoc-aviso', 'desistência sem telefone ou sem segredo de HMAC: ignorada'); return 'ignorado'; }
  const texto = montarAviso('desistencia', { ...camposDoLead(lead), hora_carla: opts.horaCarla ?? null, motivo_carla: opts.motivoCarla ?? null });
  return emitir({ chave: `${PREFIXO_CLAIM_QUIZ}${h}`, tipo: 'desistencia', texto, urgente: true, soReivindicar: opts.soReivindicar, coletorSemGrupo: opts.coletorSemGrupo });
}

/** Sem vaga para a Carla. UMA vez por pessoa, para sempre (B2.1). Quem decide não chamar quando a desistência já saiu é o robô (lerFila). */
export async function avisarSemVaga(lead: LeadQuizLinha, opts: { coletorSemGrupo?: ColetorSemGrupo } = {}): Promise<ResultadoAviso> {
  if (ehLeadDeTeste(lead.field_data)) return 'ignorado';
  const h = hmacDoLead(lead.whatsapp);
  if (!h) { logger.warn('solardoc-aviso', 'sem vaga sem telefone ou sem segredo de HMAC: ignorado'); return 'ignorado'; }
  const texto = montarAviso('semVaga', camposDoLead(lead));
  return emitir({ chave: `${PREFIXO_CLAIM_QUIZ}${h}:semvaga`, tipo: 'sem_vaga', texto, urgente: true, coletorSemGrupo: opts.coletorSemGrupo });
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
  /** NUNCA entra no texto do grupo (só o nome; sem nome, o rótulo). Mantido por compatibilidade dos chamadores. */
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
      // Sem nome: nunca o e-mail do cliente no grupo. Na Stripe o rótulo diz de onde faltou; nos outros canais sai "nome não informado".
      nome_completo: doLead.nome_completo || c.nome || (c.canal === 'cartao' ? 'Sem nome na Stripe' : ''),
      valor: c.valor,
      codigo: lead ? doLead.codigo : (c.origemQuiz && tel ? codigoDoQuiz(tel) : ''),
      doQuizSemCodigo: !lead && !!c.origemQuiz,
    };
    const modelo: ModeloAviso = c.canal === 'cartao' && c.emTeste ? 'compraCartaoTeste' : MODELO_DO_CANAL[c.canal];
    const texto = montarAviso(modelo, campos);
    return await emitir({ chave: `${PREFIXO_CLAIM_COMPRA}${String(c.id).trim()}`, tipo: `compra_${c.canal}`, texto, soReivindicar: true });
  } catch (e) {
    logger.error('solardoc-aviso', 'aviso de compra falhou', { erro: String(e) });
    return 'erro';
  }
}

// ── pendentes: um cartão só, a cada 10 min ───────────────────────────────────

const TETO_CARTAO_CHARS = 3500;

/** Tira o emoji do começo do aviso (no cartão só a primeira linha leva emoji). */
const SEM_EMOJI_NO_COMECO = /^(?:\p{Extended_Pictographic}\uFE0F?\u200D?)+\s*/u;
export const semEmojiNoComeco = (t: string): string => t.replace(SEM_EMOJI_NO_COMECO, '');

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
  const consulta = (estado: string) => supabase.from('system_state').select('key, value, updated_at')
    .or(`key.like.${PREFIXO_CLAIM_QUIZ}%,key.like.${PREFIXO_CLAIM_COMPRA}%`)
    .eq('value->>estado', estado)
    .order('updated_at', { ascending: true }).limit(200);
  const [{ data, error }, { data: dataNovo, error: erroNovo }] = await Promise.all([consulta('pendente'), consulta('novo')]);
  if (error) { logger.warn('solardoc-aviso', 'ler pendentes falhou', { erro: error.message }); return { enviados: 0, motivo: 'erro_leitura' }; }
  // Claim parado em `novo` há mais de 10 min (a função caiu entre o insert e o `marcar`) vale como pendente. Falha só nesta leitura não barra o resto.
  if (erroNovo) logger.warn('solardoc-aviso', 'ler claims abandonados falhou', { erro: erroNovo.message });
  const corteNovo = iso(Date.now() - NOVO_ABANDONADO_MS);
  const abandonados = ((erroNovo ? [] : dataNovo ?? []) as LinhaPendente[]).filter(r => r.value?.estado === 'novo' && String(r.updated_at ?? '') < corteNovo);
  const todosBrutos = ([...((data ?? []) as LinhaPendente[]), ...abandonados])
    .filter(r => (r.value?.estado === 'pendente' || r.value?.estado === 'novo') && r.value.texto)
    .sort((a, b) => (String(a.updated_at ?? '') < String(b.updated_at ?? '') ? -1 : 1));

  // 0) O que JÁ saiu (envio ok e `marcar` que falhou) ou já foi resolvido por e-mail não volta ao grupo: só ganha a marca certa.
  let todos = todosBrutos;
  try {
    const r = await jaResolvidos(todosBrutos);
    for (const p of todosBrutos) {
      if (r.saiu.has(p.key)) await marcar(p.key, p.value?.tipo ?? 'aviso', p.value?.estado === 'pendente' ? 'enviado_cartao' : 'enviado');
      else if (r.mail.has(p.key)) await marcar(p.key, p.value?.tipo ?? 'aviso', 'email');
    }
    todos = todosBrutos.filter(p => !r.saiu.has(p.key) && !r.mail.has(p.key));
  } catch (e) {
    logger.warn('solardoc-aviso', 'conferir o que já saiu falhou: nada é enviado nesta rodada', { erro: String(e) });
    return { enviados: 0, motivo: 'erro_leitura' };
  }

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
        for (const p of urgentes) { await marcarMail(p.key); await marcar(p.key, p.value?.tipo ?? 'aviso', 'email'); }
        if (emailAgora) await emailResumoParada(porEmail, parada);
      }
    }
    return { enviados: 0, expirados, motivo: parada.tipo === 'trava' ? 'trava_4xx' : parada.tipo === 'pausa' ? 'linha_caida' : 'duvida', porEmail, parada };
  }
  if (emCooldown()) return { enviados: 0, expirados, motivo: 'linha_caida' };
  // Os 40 por hora da linha valem para o cartão (os 12 avulsos por hora, não). Leitura que falha = linha cheia. Antes de qualquer chave.
  if (!(await cabeAgora({ avulso: false }))) return { enviados: 0, expirados, motivo: 'linha_cheia' };
  if (!(await linhaEspacada())) return { enviados: 0, expirados, motivo: 'linha_espacando' };
  if (!(await tomarChave(CHAVE_CARTAO_ULTIMO, CARTAO_ESPERA_MS))) return { enviados: 0, expirados, motivo: 'cartao_recente' };
  if (!(await tomarChave(CHAVE_VEZ_AVULSA, VEZ_ESPERA_MS))) {
    await devolverChave(CHAVE_CARTAO_ULTIMO);
    return { enviados: 0, expirados, motivo: 'vez_ocupada' };
  }

  const incluidos: LinhaPendente[] = [];
  let corpo = '';
  for (const p of pendentes) {
    // Sozinho, o aviso sai como foi montado (com o emoji dele). Junto, só o cabeçalho do cartão leva emoji: o dos avisos cai fora.
    const parte = `${incluidos.length ? '\n\n' : ''}${semEmojiNoComeco(p.value!.texto!)}`;
    if (incluidos.length && (corpo + parte).length > TETO_CARTAO_CHARS) break;
    corpo += parte;
    incluidos.push(p);
  }
  const texto = incluidos.length === 1 ? incluidos[0]!.value!.texto! : `📋 ${incluidos.length} avisos que esperaram o teto da linha\n\n${corpo}`;
  const env = await enviarAoGrupo(grupo, texto, incluidos.map(p => p.key));
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
