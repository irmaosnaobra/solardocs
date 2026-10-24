// ─────────────────────────────────────────────────────────────────────────────
// OS AVISOS DO QUIZ SOLAR PARA A EQUIPE (24/10/2026)
//
// O cliente que clica "falar com um especialista agora" vira um card da Nilce no horário real e um aviso no
// celular dela com a ficha, a abertura sugerida e um link "falei com o cliente". Quem sai do quiz depois de deixar o
// WhatsApp, sem marcar e sem clicar, vira um aviso de abandono. Tudo aqui fala SÓ com a equipe (Nilce e Thiago),
// nunca com o cliente.
//
// REGRAS DO CHEFE ANTI-BAN que moldam este arquivo:
//   · 1 bolha só por aviso;
//   · CLAIM POR INSERT na `system_state` (chave única): `aviso_agora:<lead>`, `lembrete_5:<lead>`, `lembrete_10:<lead>`,
//     `abandono:<lead>`. Nada de Set em memória (a Vercel tem várias instâncias, e o /process-messages tem mais de um chamador);
//   · o aviso "agora" SEMPRE sai para a Nilce (ele leva o link "falei" e os lembretes dependem dele). Quem não pode mandar um
//     2º aviso do mesmo lead é a ficha do 5040: antes de avisar, gravamos `aviso_antigo:<card>` (o mesmo marcador dos avisos
//     antigos), e o fichaTick pula o card. O abandono não tem card, então a ficha nunca o vê;
//   · os envios são de robôs registrados em chefe/classes (aviso_interno_p2): `solar_quiz_aviso` (T1, T2), `solar_quiz_lembrete`
//     (T4, T5, T6) e `solar_quiz_lista_manha` (T3). Cada envio deixa o carimbo `solar_quiz_env:` no balde da linha
//     (PREFIXOS_RESPOSTA_AGENTES do lineThrottle: conta no espaçamento e no total da hora, sem segurar agenda nem frio) e
//     entra nos tetos de emergência da linha de 60 por hora e 450 em 24 h (vivoEnvio.ts, prefixosLinha);
//   · o tick manda NO MÁXIMO 1 mensagem por rodada (somando lembretes, abandono, lista das 07:00 e cartão), olha o cooldown da
//     linha antes de cada envio e PARA no primeiro que falhar (o mesmo molde do fichaTick). T1 e T2 nunca viram linha de cartão;
//   · horário conferido no servidor: nada de lembrete, abandono ou "agora" fora do atendimento direto;
//   · mais de 12 avisos por hora para a mesma pessoa: T4 e T5 viram UM cartão a cada 10 min (claim por janela, sem dobra);
//   · o aviso das 07:00 do abandono fora do horário (`SOLAR_QUIZ_FILA_MANHA`, PROPOSTA, ligada por padrão, `0` desliga) e
//     o aviso de 10 min ao Thiago (`SOLAR_QUIZ_ESCALA_THIAGO`, PROPOSTA, ligada por padrão, `0` desliga) esperam o ok do dono;
//   · `SOLAR_QUIZ_AVISOS_OFF=1` cala tudo o que este arquivo envia, sem deploy.
//
// O link "falei" abre uma PÁGINA com um botão. Só o POST do botão marca (`solar_falei:<lead>`): um GET nunca marca,
// porque a prévia de link do WhatsApp abriria o endereço sozinha.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'crypto';
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp, linhaEmCooldown } from '../agents/zapiClient';
import { marcarAvisoAntigo } from '../agentes5040/chaves';
import { rotuloDaFaixa } from '../agenda/solarRota';
import { TEL_AVISO } from './solarEquipe';
import {
  horarioAgoraAberto, limparRespostas, limparRespostasExtra, calcularDiagnostico, type Respostas, type RespostasExtra,
} from './solarQuiz';
import {
  avisoAgora, avisoSaiuSemMarcar, segundoAviso, avisoParaOThiago, listaDas7, cartaoAgrupado, horaBonita, primeiroNomeDe,
  type DadosDaFicha, type DadosCurtos, type ItemDaLista, type OndeSaiu,
} from './solarQuizTextos';

const LOG = 'solar-quiz-aviso';

// ── as chaves de system_state ───────────────────────────────────────────────
export const CHAVES = {
  avisoAgora: 'aviso_agora:',
  falei: 'solar_falei:',
  token: 'solar_falei_token:',
  saiu: 'solar_saiu:',
  abandono: 'abandono:',
  lembrete5: 'lembrete_5:',
  lembrete10: 'lembrete_10:',
  manha: 'solar_quiz_manha:',
  manhaLote: 'solar_quiz_manha_lote:',
  envio: 'solar_quiz_env:',
  cartaoFila: 'solar_quiz_cartao_fila:',
  cartaoLote: 'solar_quiz_cartao_lote:',
} as const;

/** Os robôs registrados em chefe/classes.ts para os envios deste arquivo. */
export const ROBOS_QUIZ = { aviso: 'solar_quiz_aviso', lembrete: 'solar_quiz_lembrete', listaManha: 'solar_quiz_lista_manha' } as const;
const ROBO_DO_TIPO: Record<string, string> = {
  agora: ROBOS_QUIZ.aviso, abandono: ROBOS_QUIZ.aviso,
  lembrete5: ROBOS_QUIZ.lembrete, lembrete10: ROBOS_QUIZ.lembrete, cartao: ROBOS_QUIZ.lembrete,
  manha: ROBOS_QUIZ.listaManha,
};

export const LIMITE_AVISOS_HORA = 12;
export const CARTAO_A_CADA_MS = 10 * 60_000;
export const LEMBRETE_NILCE_MS = 5 * 60_000;
export const LEMBRETE_THIAGO_MS = 10 * 60_000;
/** Lembrete atrasado demais (o tick parou) não vale mais: o cliente já foi atendido ou desistiu. */
const LEMBRETE_VALE_ATE_MS = 40 * 60_000;
export const ABANDONO_APOS_SAIDA_MS = 5 * 60_000;
export const ABANDONO_APOS_SILENCIO_MS = 10 * 60_000;
/** Aviso de abandono mais velho que isto não sai (a janela de 5 a 10 min já passou faz tempo). */
const ABANDONO_VALE_ATE_MS = 60 * 60_000;
const ABANDONO_POR_TICK = 5;
const LEADS_LIDOS = 48 * 3_600_000;

export const desligado = (): boolean => (process.env.SOLAR_QUIZ_AVISOS_OFF || '').trim() === '1';
export const escalaThiagoLigada = (): boolean => (process.env.SOLAR_QUIZ_ESCALA_THIAGO || '').trim() !== '0';
export const filaManhaLigada = (): boolean => (process.env.SOLAR_QUIZ_FILA_MANHA || '').trim() !== '0';

const agoraIso = (ms = Date.now()): string => new Date(ms).toISOString();
const msDe = (iso: unknown): number => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : NaN; };

// ── a camada fina sobre a system_state ──────────────────────────────────────
type Linha = { key: string; value: any; updated_at: string };

/** Claim por INSERT. 'perdeu' = a chave já existia (outro tick, outra instância ou clique repetido). */
export async function reivindicar(chave: string, valor: Record<string, unknown>, quando = Date.now()): Promise<'ganhou' | 'perdeu' | 'erro'> {
  try {
    const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: agoraIso(quando) });
    if (!error) return 'ganhou';
    if ((error as { code?: string }).code === '23505') return 'perdeu';
    logger.error(LOG, `claim ${chave.split(':')[0]} falhou`, error);
    return 'erro';
  } catch (err) {
    logger.error(LOG, `claim ${chave.split(':')[0]} lançou`, err);
    return 'erro';
  }
}

/** A linha da chave; null = não existe; 'erro' = a leitura falhou. */
export async function lerChave(chave: string): Promise<Linha | null | 'erro'> {
  try {
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chave).maybeSingle();
    if (error) return 'erro';
    return (data as Linha | null) ?? null;
  } catch { return 'erro'; }
}

export async function apagarChave(chave: string): Promise<void> {
  try { await supabase.from('system_state').delete().eq('key', chave); } catch (err) { logger.error(LOG, `apagar ${chave.split(':')[0]} falhou`, err); }
}

async function gravarChave(chave: string, valor: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase.from('system_state').upsert({ key: chave, value: valor, updated_at: agoraIso() }, { onConflict: 'key' });
    if (error) logger.warn(LOG, `gravar ${chave.split(':')[0]} falhou`, error);
  } catch (err) { logger.warn(LOG, `gravar ${chave.split(':')[0]} lançou`, err); }
}

/** As chaves com este prefixo, a partir de `desdeMs` (pelo updated_at). null = a leitura falhou. */
export async function listarChaves(prefixo: string, desdeMs?: number, limite = 500): Promise<Linha[] | null> {
  try {
    let q = supabase.from('system_state').select('key, value, updated_at').like('key', `${prefixo}%`);
    if (desdeMs !== undefined) q = q.gte('updated_at', agoraIso(desdeMs));
    const { data, error } = await q.limit(limite);
    if (error) return null;
    return (data ?? []) as Linha[];
  } catch { return null; }
}

// ── o "falei com o cliente" ─────────────────────────────────────────────────
const CODIGO_OK = /^[A-Za-z0-9_-]{8,40}$/;

/** O lead já foi atendido (alguém tocou no botão) DEPOIS de `desdeMs`? Um "falei" de ontem não vale para o clique de hoje.
 *  true | false | null (não deu para ler). */
export async function jaFalou(lead: string, desdeMs = 0): Promise<boolean | null> {
  const l = await lerChave(CHAVES.falei + lead);
  if (l === 'erro') return null;
  if (l === null) return false;
  const em = msDe((l.value as { em?: string })?.em ?? l.updated_at);
  return !Number.isFinite(em) || em >= desdeMs;
}

export type ResultadoFalei =
  | { estado: 'marcado'; nome: string; em: number }
  | { estado: 'ja_estava'; nome: string; em: number }
  | { estado: 'invalido' }
  | { estado: 'erro' };

/** O NOME que a página mostra. Só consulta; nunca marca. */
export async function nomeDoToken(codigo: string): Promise<string | null> {
  if (!CODIGO_OK.test(codigo)) return null;
  const t = await lerChave(CHAVES.token + codigo);
  if (t === 'erro' || t === null) return null;
  return String((t.value as { nome?: string })?.nome ?? '') || 'o cliente';
}

/** O clique no botão (POST). Marca `solar_falei:<lead>` por INSERT; o segundo clique só diz "já estava". */
export async function marcarFalei(codigo: string, quando = Date.now()): Promise<ResultadoFalei> {
  if (!CODIGO_OK.test(codigo)) return { estado: 'invalido' };
  const t = await lerChave(CHAVES.token + codigo);
  if (t === 'erro') return { estado: 'erro' };
  if (t === null) return { estado: 'invalido' };
  const lead = String((t.value as { lead?: string })?.lead ?? '');
  const nome = String((t.value as { nome?: string })?.nome ?? '') || 'o cliente';
  if (!lead) return { estado: 'invalido' };
  const r = await reivindicar(CHAVES.falei + lead, { em: agoraIso(quando), por: 'link' }, quando);
  if (r === 'ganhou') return { estado: 'marcado', nome, em: quando };
  if (r === 'erro') return { estado: 'erro' };
  const antes = await lerChave(CHAVES.falei + lead);
  const em = antes && antes !== 'erro' ? msDe((antes.value as { em?: string })?.em) : NaN;
  // O mesmo cliente que voltou outro dia tem um aviso NOVO: o "falei" de antes do aviso não vale, e o clique de agora o troca.
  const tokenEm = msDe((t.value as { em?: string })?.em);
  if (Number.isFinite(em) && Number.isFinite(tokenEm) && em < tokenEm) {
    await gravarChave(CHAVES.falei + lead, { em: agoraIso(quando), por: 'link' });
    return { estado: 'marcado', nome, em: quando };
  }
  return { estado: 'ja_estava', nome, em: Number.isFinite(em) ? em : quando };
}

// ── o envio, com o limite por hora ──────────────────────────────────────────
export type Pessoa = 'nilce' | 'thiago';

async function enviosNaUltimaHora(pessoa: Pessoa, agora: number): Promise<number | null> {
  const l = await listarChaves(`${CHAVES.envio}${pessoa}:`, agora - 3_600_000, 100);
  return l === null ? null : l.length;
}

/** O carimbo do envio no balde da linha (prefixo solar_quiz_env:), com o nome do robô registrado no CHEFE. */
async function carimbarEnvio(pessoa: Pessoa, tipo: string, lead: string): Promise<void> {
  await gravarChave(`${CHAVES.envio}${pessoa}:${tipo}:${lead}`, { em: agoraIso(), robo: ROBO_DO_TIPO[tipo] ?? ROBOS_QUIZ.aviso });
}

/**
 * Manda UMA bolha para a pessoa e deixa o carimbo `solar_quiz_env:` (conta nos 12 por hora e nos tetos da linha). Nunca lança.
 * 'cooldown' = a linha está em cooldown: nada sai (quem chama trata como falha e para o tick).
 */
async function enviarUm(pessoa: Pessoa, texto: string, tipo: string, lead: string): Promise<'enviado' | 'falhou' | 'sem_destino' | 'cooldown'> {
  const tel = TEL_AVISO[pessoa];
  if (!tel) { logger.error(LOG, `sem telefone para ${pessoa}`); return 'sem_destino'; }
  if (linhaEmCooldown('io')) return 'cooldown';
  try { await sendWhatsApp(tel, texto, 'io'); } catch (err) {
    logger.error(LOG, `envio para ${pessoa} falhou`, err);
    return 'falhou';
  }
  await carimbarEnvio(pessoa, tipo, lead);
  return 'enviado';
}

/**
 * SÓ para os lembretes (T4 e T5). Mais de 12 envios na última hora para a mesma pessoa: o lembrete vira uma linha na
 * fila do cartão (`solar_quiz_cartao_fila:<pessoa>:<tipo>:<lead>`), que sai a cada 10 min num texto só (T6).
 * Leitura do contador que falha = envia (zero aviso é pior que um a mais). T1 e T2 NÃO passam por aqui.
 */
async function despachar(pessoa: Pessoa, texto: string, tipo: string, lead: string, agora: number): Promise<'enviado' | 'agrupado' | 'falhou' | 'sem_destino' | 'cooldown'> {
  const n = await enviosNaUltimaHora(pessoa, agora);
  if (n !== null && n >= LIMITE_AVISOS_HORA) {
    await reivindicar(`${CHAVES.cartaoFila}${pessoa}:${tipo}:${lead}`, { lead, tipo, em: agoraIso(agora) }, agora);
    return 'agrupado';
  }
  return enviarUm(pessoa, texto, tipo, lead);
}

// ── o aviso "agora" (T1) ────────────────────────────────────────────────────
export interface PedidoAvisoAgora {
  cardId: number;
  /** `quiz_<DDD+8>`: a mesma chave do rascunho em leads_meta. */
  lead: string;
  ficha: DadosDaFicha;
  /** O horário da ligação que o card guarda. */
  quandoMs: number;
}
export type ResultadoAviso = { enviado: boolean; motivo: 'enviado' | 'desligado' | 'ja_avisado' | 'falhou' | 'sem_destino' | 'cooldown' };

/**
 * T1. O claim é por CARD (`aviso_agora:<id do card>`): o mesmo cliente que clica "agora" em outro dia tem outro card e outro
 * aviso. A marca `aviso_antigo:<card>` (a ficha pula o card) só nasce DEPOIS de ganhar o claim. Claim com ERRO não segura o
 * aviso: sai mesmo assim, e a ficha não é bloqueada. T1 nunca é agrupado em cartão.
 */
export async function avisarAgora(p: PedidoAvisoAgora, agora = Date.now()): Promise<ResultadoAviso> {
  if (desligado()) return { enviado: false, motivo: 'desligado' };
  const codigo = randomBytes(9).toString('base64url');
  const claim = await reivindicar(CHAVES.avisoAgora + p.cardId, { codigo, card_id: p.cardId, lead: p.lead, em: agoraIso(agora) }, agora);
  if (claim === 'perdeu') return { enviado: false, motivo: 'ja_avisado' };
  // Este aviso é o aviso do lead "agora": a ficha do 5040 pula o card (marca `aviso_antigo:<id>`, a mesma dos avisos antigos),
  // e assim a Nilce recebe UM aviso só, o que tem o link "falei".
  if (claim === 'ganhou') await marcarAvisoAntigo(p.cardId);
  await gravarChave(CHAVES.token + codigo, { lead: p.lead, nome: p.ficha.nome, em: agoraIso(agora) });
  const r = await enviarUm('nilce', avisoAgora(p.ficha, horaBonita(p.quandoMs), codigo), 'agora', p.lead);
  return { enviado: r === 'enviado', motivo: r };
}

// ── o rascunho do lead, de volta ────────────────────────────────────────────
type Campos = Array<{ name?: string; values?: string[] }>;
const campoDe = (fd: unknown, nome: string): string => {
  const lista = Array.isArray(fd) ? (fd as Campos) : [];
  return String(lista.find(c => c?.name === nome)?.values?.[0] ?? '');
};

export const CAMPO_CODIGOS = 'Respostas (código)';
export const CAMPO_ATIVIDADE = 'Atividade em';

/** Os campos que o rascunho leva para o abandono poder remontar a ficha inteira. */
export function camposDeRecuperacao(resp: Respostas, extra: RespostasExtra, atividadeMs: number): Array<{ name: string; values: string[] }> {
  return [
    { name: CAMPO_CODIGOS, values: [JSON.stringify({ r: resp, x: extra })] },
    { name: CAMPO_ATIVIDADE, values: [agoraIso(atividadeMs)] },
  ];
}

export interface LeadHidratado {
  lead: string; nome: string; tel: string; nota: number; cidadeUf: string; curioso: boolean;
  atividadeMs: number; ficha: DadosDaFicha; contaTxt: string;
}

const DIGITOS = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** O lead de leads_meta pronto para virar texto. null = rascunho do quiz antigo (sem os códigos) ou ilegível. */
export function hidratarLead(row: Record<string, any>): LeadHidratado | null {
  const bruto = campoDe(row.field_data, CAMPO_CODIGOS);
  if (!bruto) return null;
  let cod: { r?: unknown; x?: unknown };
  try { cod = JSON.parse(bruto); } catch { return null; }
  const resp = limparRespostas(cod.r);
  if (!resp.conta) return null;
  const extra = limparRespostasExtra(cod.x);
  const tel = DIGITOS(row.whatsapp);
  const nota = Number(campoDe(row.field_data, 'Pontos'));
  const caminho = campoDe(row.field_data, 'Caminho');
  const atividade = msDe(campoDe(row.field_data, CAMPO_ATIVIDADE) || row.created_time);
  const diag = calcularDiagnostico(resp, extra);
  const cidadeUf = String(row.cidade ?? '') || resp.cidade;
  const nome = String(row.nome ?? '').trim();
  if (!tel || !nome || !Number.isFinite(atividade)) return null;
  return {
    lead: String(row.lead_id), nome, tel, nota: Number.isFinite(nota) ? nota : 0, cidadeUf, curioso: caminho === 'curioso',
    atividadeMs: atividade, contaTxt: rotuloDaFaixa(resp.conta) ?? '',
    ficha: {
      nome, tel, nota: Number.isFinite(nota) ? nota : 0, cidadeUf, resp, extra, diag, kwh: diag?.kwh_mes ?? null,
      utmSource: campoDe(row.field_data, 'utm_source') || null, utmCampaign: campoDe(row.field_data, 'utm_campaign') || null,
    },
  };
}

const curtoDe = (l: LeadHidratado): DadosCurtos => ({ nome: l.nome, nota: l.nota, cidadeUf: l.cidadeUf, tel: l.tel, conta: l.contaTxt });

const COLUNAS_LEAD = 'lead_id, nome, whatsapp, cidade, field_data, agendado_id, created_time';
async function lerLeads(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>();
  if (!ids.length) return out;
  try {
    const { data, error } = await supabaseGerador.from('leads_meta').select(COLUNAS_LEAD).in('lead_id', ids);
    if (error) throw error;
    for (const r of (data ?? []) as Array<Record<string, any>>) out.set(String(r.lead_id), r);
  } catch (err) { logger.error(LOG, 'ler leads falhou', err); }
  return out;
}

// ── a marca de saída (o beacon da página) ───────────────────────────────────
/** SÓ grava uma marca. Só se o rascunho existir (sem rascunho não há ficha para avisar). Nunca envia nada. */
export async function gravarSaida(lead: string, onde: OndeSaiu, agora = Date.now()): Promise<boolean> {
  try {
    const { data, error } = await supabaseGerador.from('leads_meta').select('lead_id').eq('lead_id', lead).limit(1);
    if (error || !data?.length) return false;
  } catch { return false; }
  await gravarChave(CHAVES.saiu + lead, { em: agoraIso(agora), onde });
  return true;
}

// ── o tick: lembretes, abandono, lista das 07:00 e cartão ───────────────────
export interface ResultadoTick {
  motivo?: string;
  lembretes: { nilce: number; thiago: number };
  abandonos: { enviados: number; fila: number; pulados: number };
  manha: { enviada: number };
  cartoes: { enviados: number };
  /** O tick parou porque um envio falhou ou a linha está em cooldown. */
  parou?: 'falha' | 'cooldown';
}
const vazio = (): ResultadoTick => ({ lembretes: { nilce: 0, thiago: 0 }, abandonos: { enviados: 0, fila: 0, pulados: 0 }, manha: { enviada: 0 }, cartoes: { enviados: 0 } });

/** No máximo 1 envio por rodada, somando as 4 partes; o primeiro 'falhou' ou cooldown para tudo (molde do fichaTick). */
interface Rodada { gasto: boolean; parou: boolean }
const livre = (c: Rodada): boolean => !c.gasto && !c.parou;
const falhou = (res: string): boolean => res === 'falhou' || res === 'sem_destino' || res === 'cooldown';

/** 5 min sem "falei": 2º aviso à Nilce. 10 min: aviso ao Thiago (atrás de SOLAR_QUIZ_ESCALA_THIAGO). Só dentro do horário. */
async function lembretes(agora: number, r: ResultadoTick, c: Rodada): Promise<void> {
  if (!horarioAgoraAberto(agora)) return;
  const avisos = await listarChaves(CHAVES.avisoAgora, agora - LEMBRETE_VALE_ATE_MS - 60_000);
  if (!avisos?.length) return;
  const idDe = (a: Linha) => String((a.value as { lead?: string })?.lead ?? '');
  const leads = await lerLeads(avisos.map(idDe).filter(Boolean));
  for (const a of avisos) {
    if (!livre(c)) return;
    const lead = idDe(a);
    const em = msDe((a.value as { em?: string })?.em);
    const codigo = String((a.value as { codigo?: string })?.codigo ?? '');
    if (!lead || !Number.isFinite(em) || !codigo) continue;
    const idade = agora - em;
    if (idade < LEMBRETE_NILCE_MS || idade > LEMBRETE_VALE_ATE_MS) continue;
    // "Falei" (depois deste aviso) cancela. Leitura que falha = não manda (lembrete a mais, para quem já falou, é o que o botão existe para evitar).
    if ((await jaFalou(lead, em)) !== false) continue;
    const hid = leads.get(lead) ? hidratarLead(leads.get(lead)!) : null;
    if (!hid) continue;
    const curto = curtoDe(hid);
    const chave5 = CHAVES.lembrete5 + a.key.slice(CHAVES.avisoAgora.length);
    const chave10 = CHAVES.lembrete10 + a.key.slice(CHAVES.avisoAgora.length);
    if ((await reivindicar(chave5, { em: agoraIso(agora) }, agora)) === 'ganhou') {
      const res = await despachar('nilce', segundoAviso(curto, codigo), 'lembrete5', lead, agora);
      if (falhou(res)) { await apagarChave(chave5); c.parou = true; r.parou = res === 'cooldown' ? 'cooldown' : 'falha'; return; }
      if (res === 'enviado') { r.lembretes.nilce++; c.gasto = true; return; }
    }
    if (idade >= LEMBRETE_THIAGO_MS && escalaThiagoLigada() && livre(c)
      && (await reivindicar(chave10, { em: agoraIso(agora) }, agora)) === 'ganhou') {
      const res = await despachar('thiago', avisoParaOThiago(curto, Math.round(idade / 60_000)), 'lembrete10', lead, agora);
      if (falhou(res)) { await apagarChave(chave10); c.parou = true; r.parou = res === 'cooldown' ? 'cooldown' : 'falha'; return; }
      if (res === 'enviado') { r.lembretes.thiago++; c.gasto = true; return; }
    }
  }
}

/** Quem deixou o WhatsApp, não marcou e não clicou "agora". NÃO cria card (um card faria os crons de agenda mandarem ao
 *  cliente "te ligo às X" num horário que ele nunca escolheu). Sem Schedule. O curioso também entra (ordem do dono). */
async function abandonos(agora: number, r: ResultadoTick, c: Rodada): Promise<void> {
  let linhas: Array<Record<string, any>> = [];
  try {
    const { data, error } = await supabaseGerador.from('leads_meta').select(COLUNAS_LEAD)
      .eq('form_id', 'quiz_solar').is('agendado_id', null)
      .gte('created_time', agoraIso(agora - LEADS_LIDOS)).order('created_time', { ascending: false }).limit(200);
    if (error) throw error;
    linhas = (data ?? []) as Array<Record<string, any>>;
  } catch (err) { logger.error(LOG, 'ler os rascunhos do quiz falhou', err); return; }
  if (!linhas.length) return;

  const [agoras, saidas, feitos] = await Promise.all([
    listarChaves(CHAVES.avisoAgora, agora - LEADS_LIDOS), listarChaves(CHAVES.saiu, agora - LEADS_LIDOS),
    listarChaves(CHAVES.abandono, agora - LEADS_LIDOS),
  ]);
  // Sem conseguir ler quem já clicou "agora" ou já foi avisado, não avisa ninguém (melhor calar que repetir).
  if (!agoras || !feitos || !saidas) return;

  let tratados = 0;
  for (const row of linhas) {
    if (!livre(c)) return;
    if (tratados >= ABANDONO_POR_TICK) break;
    const lead = String(row.lead_id);
    if (row.agendado_id) continue;   // marcou horário (ou clicou "agora"): tem card, não é abandono
    const hid = hidratarLead(row);
    if (!hid) { r.abandonos.pulados++; continue; }   // o curioso também avisa (ordem do dono): a nota vai na 1ª linha
    if (agoras.some(x => (x.value as { lead?: string })?.lead === lead) || feitos.some(x => x.key === CHAVES.abandono + lead)) continue;
    // Atendido DEPOIS da última atividade deste rascunho (um "falei" de outro dia não vale).
    if ((await jaFalou(lead, hid.atividadeMs)) !== false) continue;

    const marca = saidas.find(x => x.key === CHAVES.saiu + lead);
    const saiuEm = marca ? msDe((marca.value as { em?: string })?.em) : NaN;
    // A marca só vale se for DEPOIS da última atividade (quem refez o quiz depois de sair começa de novo).
    const marcaValida = Number.isFinite(saiuEm) && saiuEm >= hid.atividadeMs;
    const vence = marcaValida ? saiuEm + ABANDONO_APOS_SAIDA_MS : hid.atividadeMs + ABANDONO_APOS_SILENCIO_MS;
    if (agora < vence || agora > vence + ABANDONO_VALE_ATE_MS) continue;
    const ondeBruto = marcaValida ? String((marca!.value as { onde?: string })?.onde ?? '') : '';
    const onde: OndeSaiu = ondeBruto === 'whatsapp' || ondeBruto === 'horarios' ? ondeBruto : 'diagnostico';

    const dentro = horarioAgoraAberto(agora);
    if (!dentro && !filaManhaLigada()) continue;   // sem fila das 07:00: o aviso fora do horário simplesmente não sai
    if ((await reivindicar(CHAVES.abandono + lead, { em: agoraIso(agora), onde }, agora)) !== 'ganhou') continue;
    tratados++;

    if (!dentro) {
      // Fora do horário: guarda numa fila. Só o id e o "onde", sem telefone; a lista das 07:00 relê o rascunho.
      await gravarChave(CHAVES.manha + lead, { onde, em: agoraIso(agora) });
      r.abandonos.fila++;
      continue;
    }
    // O link "falei" também vale aqui (o lembrete não: só o "agora" prometeu ligação em 5 minutos).
    const codigo = randomBytes(9).toString('base64url');
    await gravarChave(CHAVES.token + codigo, { lead, nome: hid.nome, em: agoraIso(agora) });
    // T2 nunca é agrupado em cartão: sai direto, deixa o carimbo e conta nos 12 por hora.
    const res = await enviarUm('nilce', avisoSaiuSemMarcar(hid.ficha, onde, horaBonita(agora), codigo), 'abandono', lead);
    if (res !== 'enviado') {
      await apagarChave(CHAVES.abandono + lead);
      c.parou = true; r.parou = res === 'cooldown' ? 'cooldown' : 'falha';
      return;
    }
    r.abandonos.enviados++;
    c.gasto = true;
    return;
  }
}

/** A lista das 07:00: UMA mensagem com todos os que saíram fora do horário. */
async function soltarManha(agora: number, r: ResultadoTick, c: Rodada): Promise<void> {
  if (!livre(c) || !horarioAgoraAberto(agora) || !filaManhaLigada()) return;
  const fila = await listarChaves(CHAVES.manha);
  if (!fila?.length) return;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agora));
  const loteChave = CHAVES.manhaLote + ymd;
  if ((await reivindicar(loteChave, { n: fila.length, em: agoraIso(agora) }, agora)) !== 'ganhou') return;
  const ids = fila.map(f => f.key.slice(CHAVES.manha.length));
  const rows = await lerLeads(ids);
  const itens: ItemDaLista[] = [];
  const consumidos: string[] = [];
  for (const f of fila) {
    const lead = f.key.slice(CHAVES.manha.length);
    const row = rows.get(lead);
    // Quem marcou horário ou foi atendido nesse meio tempo sai da lista.
    const hid = row && !row.agendado_id ? hidratarLead(row) : null;
    consumidos.push(f.key);
    if (!hid || (await jaFalou(lead, hid.atividadeMs)) !== false) continue;
    const onde = String((f.value as { onde?: string })?.onde ?? '');
    itens.push({ nome: hid.nome, nota: hid.nota, cidadeUf: hid.cidadeUf, conta: hid.contaTxt, tel: hid.tel,
      onde: onde === 'whatsapp' || onde === 'horarios' ? onde : 'diagnostico' });
  }
  if (itens.length) {
    const res = await enviarUm('nilce', listaDas7(itens), 'manha', ymd);
    if (res !== 'enviado') {   // as linhas ficam; o próximo tick tenta de novo
      await apagarChave(loteChave);
      c.parou = true; r.parou = res === 'cooldown' ? 'cooldown' : 'falha';
      return;
    }
    r.manha.enviada = itens.length;
    c.gasto = true;
  }
  for (const k of consumidos) await apagarChave(k);
}

/** O cartão agrupado: a cada 10 min, o que passou de 12 por hora para a mesma pessoa. Só leva quem AINDA não foi atendido. */
async function soltarCartoes(agora: number, r: ResultadoTick, c: Rodada): Promise<void> {
  if (!livre(c) || !horarioAgoraAberto(agora)) return;
  for (const pessoa of ['nilce', 'thiago'] as const) {
    if (!livre(c)) return;
    const fila = await listarChaves(`${CHAVES.cartaoFila}${pessoa}:`);
    if (!fila?.length) continue;
    const recente = await listarChaves(`${CHAVES.envio}${pessoa}:cartao:`, agora - CARTAO_A_CADA_MS, 5);
    if (recente === null || recente.length) continue;
    // Um claim por janela de 10 min: o /process-messages tem dois chamadores e o cartão não pode sair em dobro.
    const janela = Math.floor(agora / CARTAO_A_CADA_MS);
    const loteChave = `${CHAVES.cartaoLote}${pessoa}:${janela}`;
    if ((await reivindicar(loteChave, { n: fila.length, em: agoraIso(agora) }, agora)) !== 'ganhou') continue;
    const porLead = new Map<string, number>();   // lead → quando entrou na fila
    for (const f of fila) {
      const id = String((f.value as { lead?: string })?.lead ?? '');
      const em = msDe((f.value as { em?: string })?.em);
      if (id) porLead.set(id, Math.min(porLead.get(id) ?? Infinity, Number.isFinite(em) ? em : 0));
    }
    const rows = await lerLeads([...porLead.keys()]);
    const itens: DadosCurtos[] = [];
    for (const [id, desde] of porLead) {
      const h = rows.get(id) ? hidratarLead(rows.get(id)!) : null;
      // Só quem ainda não foi atendido (jaFalou === false): quem a Nilce já atendeu não entra no cartão.
      if (h && (await jaFalou(id, desde)) === false) itens.push(curtoDe(h));
    }
    if (itens.length) {
      const res = await enviarUm(pessoa, cartaoAgrupado(itens), 'cartao', String(janela));
      if (res !== 'enviado') {   // as linhas ficam na fila; o claim sai para a próxima rodada tentar
        await apagarChave(loteChave);
        c.parou = true; r.parou = res === 'cooldown' ? 'cooldown' : 'falha';
        return;
      }
      r.cartoes.enviados++;
      c.gasto = true;
    }
    for (const f of fila) await apagarChave(f.key);
  }
}

/** Um tick. Roda dentro do /cron/process-messages (e só ali). Cada parte tem o seu try; no máximo 1 envio por rodada. */
export async function runSolarQuizAvisosTick(opts: { agora?: number } = {}): Promise<ResultadoTick> {
  const r = vazio();
  if (desligado()) return { ...r, motivo: 'desligado' };
  const agora = opts.agora ?? Date.now();
  const c: Rodada = { gasto: false, parou: false };
  const partes: Array<[string, () => Promise<void>]> = [
    ['lembretes', () => lembretes(agora, r, c)],
    ['abandonos', () => abandonos(agora, r, c)],
    ['manha', () => soltarManha(agora, r, c)],
    ['cartoes', () => soltarCartoes(agora, r, c)],
  ];
  for (const [nome, roda] of partes) {
    if (!livre(c)) break;
    try { await roda(); } catch (err) { logger.error(LOG, `${nome} falhou`, err); }
  }
  return r;
}

export { primeiroNomeDe };
