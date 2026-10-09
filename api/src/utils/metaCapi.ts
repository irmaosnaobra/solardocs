// ── O META APRENDE QUEM É CLIENTE QUENTE (09/10/2026) ────────────────────────
// Pedido do dono: "ensina ao Meta quais os melhores clientes, você tem base dos
// 2 hoje". Este arquivo é a peça comum aos dois caminhos que fazem isso:
//
//   1. o evento pela API de Conversões, mandado ao pixel do PRODUTO (solar ou
//      eletroposto) na hora em que o lead marca horário, tira nota alta no quiz
//      ou é avançado pelo consultor;
//   2. a lista de clientes quentes que sobe como público personalizado (o
//      serviço do público usa as mesmas normalizações daqui).
//
// Por que não reaproveitar o metaPixel.ts: lá o `sendMetaEvent` tem o pixel do
// SolarDoc B2B fixo e o `sendCrmLeadEvent` só aceita lead_id numérico de
// formulário do Meta. O lead do quiz é `quiz_<tel>` e nunca casava em nenhum dos
// dois: do quiz, o Meta só sabia que a pessoa marcou (pelo pixel do navegador).
//
// A regra que amarra tudo: `external_id` é SEMPRE o hash do telefone com 55. O
// evento do quiz sai com fbc, fbp, IP e navegador; o do consultor, dias depois,
// sai só com telefone e nome. É o external_id igual nos dois que deixa o Meta
// ligar o "virou orçamento" de hoje ao clique no anúncio da semana passada.

import { createHash } from 'crypto';

/** "Pixel de Ékent Energia Solar": o do quiz /io/solar e o da campanha Solar - Quiz - Agenda. */
export const PIXEL_SOLAR = (process.env.META_PIXEL_SOLAR_ID || '').trim() || '446093469730871';
/** "Eletroposto": o das páginas /io/eletroposto e /io/eletroposto/parceria. */
export const PIXEL_ELETROPOSTO = (process.env.META_PIXEL_ELETROPOSTO_ID || '').trim() || '26788759654130722';

export type ProdutoMeta = 'solar' | 'eletroposto';
export const pixelDoProduto = (p: ProdutoMeta): string => (p === 'eletroposto' ? PIXEL_ELETROPOSTO : PIXEL_SOLAR);

// O system user acessa os dois pixels (conferido em 09/10/2026 com envio de
// teste). Lido na hora da chamada, nunca no import: teste troca o env.
const token = (): string => (process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '').trim();
const GRAPH = 'https://graph.facebook.com/v23.0';

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Tira acento e deixa só a-z. O Meta recomenda caractere romano em nome e cidade. */
export function semAcento(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Telefone no formato que o Meta casa: só dígitos, com o 55. Fora de 10 a 13 dígitos, null. */
export function normFone(s: unknown): string | null {
  let d = String(s ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith('55')) return null;
    d = d.slice(2);
  }
  if (d.length !== 10 && d.length !== 11) return null;
  return '55' + d;
}

/** Nome e sobrenome do jeito que o Meta compara: minúsculo, sem acento, só letras. */
export function separarNome(nome: unknown): { fn: string; ln: string } {
  const partes = semAcento(nome).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return { fn: partes[0] || '', ln: partes.length > 1 ? partes[partes.length - 1] : '' };
}

/** "Uberlândia", "Uberlândia, MG" ou "Uberlândia/MG" viram "uberlandia". */
export function normCidade(s: unknown): string {
  return semAcento(String(s ?? '').split(/[,/]| - /)[0]).replace(/[^a-z]/g, '');
}

/** UF de duas letras, minúscula. Aceita "MG", "mg" ou o fim de "Uberlândia, MG". */
export function normUf(s: unknown): string {
  const m = semAcento(s).match(/(?:^|[^a-z])([a-z]{2})\s*$/);
  return m ? m[1] : '';
}

export interface PessoaMeta {
  telefone?: unknown;
  nome?: unknown;
  email?: unknown;
  cidade?: unknown;
  uf?: unknown;
}

/** O que vem do navegador, quando o evento nasce de uma página. Vai em texto puro. */
export interface NavegadorMeta {
  fbc?: string | null;
  fbp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * user_data da API de Conversões. Hash em tudo que identifica a pessoa; fbc, fbp,
 * IP e navegador vão em texto puro, como o Meta pede. Campo vazio não entra:
 * hash de string vazia é um identificador falso que casa com ninguém.
 */
export function userData(p: PessoaMeta, nav: NavegadorMeta = {}): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  const fone = normFone(p.telefone);
  if (fone) { u.ph = [sha256(fone)]; u.external_id = [sha256(fone)]; }
  const email = String(p.email ?? '').trim().toLowerCase();
  if (email.includes('@')) u.em = [sha256(email)];
  const { fn, ln } = separarNome(p.nome);
  if (fn) u.fn = [sha256(fn)];
  if (ln) u.ln = [sha256(ln)];
  const ct = normCidade(p.cidade);
  if (ct) u.ct = [sha256(ct)];
  const st = normUf(p.uf) || normUf(p.cidade);
  if (st) u.st = [sha256(st)];
  u.country = [sha256('br')];
  if (nav.fbc) u.fbc = String(nav.fbc).slice(0, 500);
  if (nav.fbp) u.fbp = String(nav.fbp).slice(0, 500);
  if (nav.ip) u.client_ip_address = String(nav.ip);
  if (nav.userAgent) u.client_user_agent = String(nav.userAgent).slice(0, 1000);
  return u;
}

/** Só aceita fbc/fbp no formato do Meta ("fb.1.<ms>.<valor>"). Cookie forjado não entra. */
export function cookieMeta(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^fb\.\d\.\d{10,13}\.[\w.-]{4,400}$/.test(s) ? s : null;
}

export interface EventoMeta {
  produto: ProdutoMeta;
  nome: string;
  pessoa: PessoaMeta;
  navegador?: NavegadorMeta;
  /** Mesmo id do fbq no navegador: o Meta junta os dois e conta uma vez só. */
  eventId?: string;
  /** Unix em segundos. Padrão: agora. */
  eventTime?: number;
  /** 'website' quando nasce da página; 'system_generated' quando nasce do CRM. */
  origem: 'website' | 'system_generated';
  urlDaPagina?: string;
  valor?: number;
  dados?: Record<string, unknown>;
}

export interface ResultadoMeta { ok: boolean; status: number; recebidos?: number; erro?: string }

/**
 * Manda um evento ao pixel do produto. Nunca lança: o chamador é rota de quiz ou
 * tick de cron, e Meta fora do ar não pode derrubar nenhum dos dois.
 * META_TEST_EVENT_CODE, se existir, manda tudo para a aba "Testar eventos".
 */
export async function enviarEventoMeta(ev: EventoMeta): Promise<ResultadoMeta> {
  const tk = token();
  if (!tk) return { ok: false, status: 0, erro: 'sem_token' };
  const ud = userData(ev.pessoa, ev.navegador);
  if (!ud.ph && !ud.em && !ud.fbc && !ud.fbp) return { ok: false, status: 0, erro: 'sem_identificador' };
  const evento: Record<string, unknown> = {
    event_name: ev.nome,
    event_time: ev.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: ev.origem,
    user_data: ud,
  };
  if (ev.eventId) evento.event_id = String(ev.eventId).slice(0, 100);
  if (ev.urlDaPagina) evento.event_source_url = ev.urlDaPagina;
  const custom: Record<string, unknown> = { ...(ev.dados || {}) };
  if (typeof ev.valor === 'number' && Number.isFinite(ev.valor) && ev.valor > 0) {
    custom.value = Math.round(ev.valor * 100) / 100;
    custom.currency = 'BRL';
  }
  if (Object.keys(custom).length) evento.custom_data = custom;
  const corpo: Record<string, unknown> = { data: [evento] };
  const teste = (process.env.META_TEST_EVENT_CODE || '').trim();
  if (teste) corpo.test_event_code = teste;
  try {
    const res = await fetch(`${GRAPH}/${pixelDoProduto(ev.produto)}/events?access_token=${encodeURIComponent(tk)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(6000),
    });
    const j = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
    if (!res.ok || j.error) return { ok: false, status: res.status, erro: j.error?.message || `http_${res.status}` };
    return { ok: true, status: res.status, recebidos: j.events_received };
  } catch (e) {
    return { ok: false, status: 0, erro: (e as Error)?.message || String(e) };
  }
}
