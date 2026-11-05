import { createHmac } from 'crypto';

// Link rastreado da proposta solar: funções puras (sem banco, sem rede) que o
// GET /p/:id e o controller de documentos usam. Fica separado do templateService
// de propósito: o teste de rota mocka o template, e estas contas não podem sumir.

// Robôs de prévia e crawlers. O WhatsApp abre o link no momento em que o vendedor
// ENVIA, para montar a prévia: sem este filtro o vendedor recebe um alerta de
// "proposta aberta" que foi o próprio envio dele.
const ROBOS = [
  'whatsapp', 'facebookexternalhit', 'facebot', 'facebookcatalog', 'meta-externalagent', 'meta-externalfetcher',
  'telegrambot', 'twitterbot', 'slackbot', 'slack-imgproxy', 'discordbot', 'linkedinbot', 'skypeuripreview',
  'googlebot', 'google-inspectiontool', 'googleother', 'adsbot', 'mediapartners', 'bingbot', 'bingpreview',
  'applebot', 'pinterest', 'embedly', 'iframely', 'duckduckbot', 'baiduspider', 'yandexbot', 'bytespider',
  'headlesschrome', 'lighthouse', 'vercel-screenshot',
  'curl', 'wget', 'python-requests', 'python-urllib', 'axios', 'node-fetch', 'undici', 'go-http-client',
  'java/', 'libwww', 'httpclient',
  'crawler', 'spider', 'preview', 'scraper',
];

// "bot" genérico só como palavra inteira ("... bot ...", "Bot)") ou nome com barra ("QualquerBot/1.0").
// Substring pura pegava CUBOT, um celular de verdade. Os robôs conhecidos estão nomeados acima.
const ROBO_GENERICO = /(^|[^a-z0-9])bot([^a-z0-9]|$)|bot\//i;

/** true quando o User-Agent é de robô de prévia, crawler ou ferramenta de linha de comando. UA vazio também. */
export function ehRobo(ua: unknown): boolean {
  const s = String(Array.isArray(ua) ? ua[0] ?? '' : ua ?? '').trim().toLowerCase();
  if (!s) return true;
  return ROBOS.some((r) => s.includes(r)) || ROBO_GENERICO.test(s);
}

/**
 * Chave de "mesmo aparelho olhando a mesma proposta": HMAC-SHA256 de IP + UA + id do documento.
 * O IP nunca é guardado puro. O segredo (ver segredoDaChave) impede reverter o hash testando os IPs
 * possíveis; se ele girar, só se perde a janela de 10 minutos de quem estava aberto.
 */
let avisouSemSegredo = false;

/**
 * Segredo do HMAC: VAPID_PRIVATE_KEY (nunca esteve em arquivo do repo); se faltar, JWT_SECRET;
 * se faltar também, uma constante só para não quebrar a página (e vai para o log, uma vez).
 * O JWT_SECRET antigo está exposto em arquivo do repo público, por isso não é a primeira escolha.
 */
function segredoDaChave(): string {
  const s = process.env.VAPID_PRIVATE_KEY || process.env.JWT_SECRET;
  if (s) return s;
  if (!avisouSemSegredo) {
    avisouSemSegredo = true;
    console.warn('[proposta-link] sem VAPID_PRIVATE_KEY nem JWT_SECRET: chave de abertura usa constante fixa');
  }
  return 'sem-segredo';
}

export function chaveAbertura(ip: unknown, ua: unknown, documentId: string): string {
  const pimenta = segredoDaChave();
  return createHmac('sha256', pimenta)
    .update(`${String(ip ?? '')}|${String(Array.isArray(ua) ? ua[0] ?? '' : ua ?? '')}|${documentId}`)
    .digest('hex');
}

export type Dispositivo = 'Celular' | 'Tablet' | 'Computador';

export function dispositivo(ua: unknown): Dispositivo {
  const s = String(Array.isArray(ua) ? ua[0] ?? '' : ua ?? '').toLowerCase();
  if (/ipad|tablet|kindle|silk|playbook/.test(s)) return 'Tablet';
  // Android sem "Mobile" é tablet; com "Mobile" é celular.
  if (/android/.test(s) && !/mobile/.test(s)) return 'Tablet';
  if (/iphone|ipod|android|mobi|windows phone|blackberry/.test(s)) return 'Celular';
  return 'Computador';
}

export interface Geo { cidade: string | null; uf: string | null; pais: string | null }

type Headers = Record<string, string | string[] | undefined>;

function cabecalho(h: Headers, nome: string): string | null {
  const v = h[nome];
  const s = String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
  return s ? s : null;
}

/** Cidade, UF e país que a Vercel põe nos headers x-vercel-ip-*. A cidade chega com percent-encoding. */
export function geo(headers: Headers): Geo {
  let cidade = cabecalho(headers, 'x-vercel-ip-city');
  if (cidade) {
    try { cidade = decodeURIComponent(cidade); } catch { /* mantém o texto cru */ }
  }
  return {
    cidade: cidade || null,
    uf: cabecalho(headers, 'x-vercel-ip-country-region'),
    pais: cabecalho(headers, 'x-vercel-ip-country'),
  };
}

// Mesma regra do propostaDiasValidade do templateService (padrão 7). Duplicada de
// propósito, ver o comentário do topo.
function diasValidade(dados: Record<string, unknown>): number {
  const n = parseInt(String(dados.validade_dias ?? '').replace(/\D/g, ''), 10);
  return n > 0 ? n : 7;
}

function dataValida(v: unknown): Date | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fim do último dia de validade em America/Sao_Paulo ("2026-11-11T23:59:59-03:00").
 * Emissão = dados.emitido_em, ou createdAt; mais validade_dias. O servidor roda em UTC:
 * o dia é lido no fuso de Brasília, igual à data impressa na proposta. O Brasil não tem
 * horário de verão desde 2019, então o deslocamento fixo de -03:00 vale.
 * Devolve null quando a data não fecha (emissão inválida e dias absurdos).
 */
export function linkExpiraEm(dados: Record<string, unknown>, createdAt?: unknown): string | null {
  const emissao = dataValida(dados.emitido_em) ?? dataValida(createdAt) ?? new Date();
  const ate = new Date(emissao.getTime() + diasValidade(dados) * 86400000);
  if (Number.isNaN(ate.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ate); // 2026-11-11
  if (!/^\d{4}-\d{2}-\d{2}$/.test(partes)) return null;
  return `${partes}T23:59:59-03:00`;
}

/** DD/MM/AAAA, no dia de Brasília, de um ISO. */
export function dataBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function linkVencido(expiraEm: unknown, agora: Date = new Date()): boolean {
  const d = dataValida(expiraEm);
  return !!d && d.getTime() < agora.getTime();
}
