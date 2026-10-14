import { logger } from '../../../utils/logger';
import { REGRAS_REDES } from '../../chefe/regulamento';
import { tokenDaPaginaFb, PAGINA_FB } from '../../instagram/fbComentarios';
import { validarVideo, type VideoOk } from './video';
import {
  CHAVES, chaveLigada, chaveDaPublicacao, lerLinha, reivindicar, trocarSe, gravarValor, tomarFaixa, ErroLivro,
  lerErroMeta, erroDeRede, paradaVigente, registrarParada, textoDaParada, type ErroMeta, type RedeMeta,
} from './comum';
import { supabase } from '../../../utils/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// PUBLICADOR DE REELS (fase 1 das redes, 14/10/2026): Instagram e Página do Facebook.
//
// Parecer do chefe anti-ban, em palavras simples:
//   - claim por insert de (rede, conta, hash do vídeo) ANTES da 1ª chamada que escreve;
//   - no Instagram, a cota da Meta é lida ANTES (content_publishing_limit) e, se a
//     leitura falhar, não publica;
//   - 30 min entre publicações da conta; o mesmo vídeo só 1 vez por conta;
//   - o contêiner é lido no máximo 1 vez por minuto e por até 5 min; passou disso,
//     falha honesta (a tela mostra que não confirmou, nunca "publicado" de enfeite);
//   - código de erro da Meta para a conta por 15 min (parada compartilhada com a
//     resposta a comentário); erro de cota, até o dia seguinte;
//   - nada se refaz sozinho: timeout e 5xx contam como feito ("incerto").
//
// Cada escrita na Meta tem o caminho escrito por extenso (media, media_publish,
// video_reels), porque é assim que a guarda do chefe lê. Este arquivo não manda
// mensagem a ninguém e por isso NÃO está na lista dos clientes oficiais do Graph.
//
// Cada publicação é uma linha em system_state: `redes_pub:<rede>.<conta>.<hash>`. A
// própria linha é o claim e o registro. Quem a leva adiante é o `avancar`, que a tela
// chama enquanto está aberta e que o cron de 5 min também chama; o 1 por minuto e a
// passagem para "publicando" são trocas com versão, então tela e cron no mesmo segundo
// não leem duas vezes nem publicam duas vezes.
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'redes_publicador';
const GRAPH = 'https://graph.facebook.com/v21.0';
const PREFIXO = 'redes_pub:';
const LEGENDA_MAX = 2200;
const TIMEOUT_MS = 30_000;

/** Prazos do publicador (objeto mutável só para os testes): o token da Página e o cron inteiro. */
export const limitesPublicador = { tokenMs: 10_000, cronMs: 20_000 };

/** Corre a promessa contra um relógio. Estourou: rejeita (a promessa original segue solta, sem efeito aqui). */
function comPrazo<T>(p: Promise<T>, ms: number, nome: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const relogio = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${nome}: passou de ${ms} ms`)), ms); });
  return Promise.race([p, relogio]).finally(() => clearTimeout(t));
}

/** O token da Página (leitura de me/accounts do motor), com prazo. Falha ou prazo estourado: null. */
const tokenDaPagina = (): Promise<string | null> => comPrazo(tokenDaPaginaFb(), limitesPublicador.tokenMs, 'token da Página').catch(() => null);

export type EstadoPub = 'criando' | 'aguardando' | 'publicando' | 'publicado' | 'falhou' | 'nao_saiu' | 'incerto';

export interface Publicacao {
  id: string;
  rede: RedeMeta;
  conta: string;
  hash: string;
  video_url: string;
  legenda: string;
  por: string;
  criado_em: string;
  estado: EstadoPub;
  container_id: string | null;
  video_id: string | null;
  media_id: string | null;
  /** Link da publicação no Instagram, lido depois do media_publish. Opcional: pode faltar sem mudar o estado. */
  permalink?: string | null;
  ultima_leitura_em: string | null;
  vence_em: string | null;
  motivo: string | null;
  mensagem: string | null;
}

export interface ResultadoPub {
  ok: boolean;
  http: number;
  motivo: string;
  mensagem: string;
  abre_em?: string | null;
  publicacao?: PublicacaoTela;
}

const MENSAGENS: Record<string, string> = {
  chave_desligada: 'A publicação nesta rede está desligada.',
  entrada_invalida: 'Pedido inválido.',
  sem_token: 'A conexão com a Meta não está configurada.',
  conta_indisponivel: 'Não consegui achar a conta desta rede agora. Tente de novo.',
  espacamento: 'Tem que passar 30 minutos entre uma publicação e outra na mesma conta.',
  mesmo_video: 'Este vídeo já foi (ou está sendo) publicado nesta conta.',
  erro_livro: 'Não consegui conferir os limites agora. Nada foi publicado.',
  cota_lida_falhou: 'Não consegui ler a cota de publicação do Instagram. Nada foi publicado.',
  cota_esgotada: 'A cota de publicação do Instagram acabou por agora.',
  meta_recusou: 'A Meta recusou a publicação. Nada foi publicado.',
  meta_incerto: 'Não sei se a Meta recebeu. Confira a conta antes de tentar de novo: esta tela não repete sozinha.',
  nao_encontrada: 'Publicação não encontrada.',
  demorou: 'A Meta não confirmou em 5 minutos. Confira a conta; esta tela não publica depois disso.',
  pedido_ja_feito: 'O pedido já foi feito. Confira a Página antes de subir de novo.',
  falhou_processar: 'A Meta não conseguiu processar o vídeo.',
};

const sem = (http: number, motivo: string, extra: Partial<ResultadoPub> = {}): ResultadoPub =>
  ({ ok: false, http, motivo, mensagem: MENSAGENS[motivo] ?? 'Não foi possível agora.', ...extra });

// ── chamadas à Meta ──────────────────────────────────────────────────────────

const tokenSistema = (): string => String(process.env.META_SYSTEM_USER_TOKEN || '').trim();
const sinal = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS);

type RespostaMeta = { ok: true; json: any } | { ok: false; erro: ErroMeta };

/** Roda UMA chamada ao Graph e a traduz: corpo lido, erro com código, queda de rede à parte. */
async function meta(f: () => Promise<Response>): Promise<RespostaMeta> {
  let r: Response;
  try { r = await f(); } catch (err) { return { ok: false, erro: erroDeRede(String((err as Error)?.message || err)) }; }
  const t = await r.text().catch(() => '');
  let j: any = null;
  try { j = JSON.parse(t); } catch { j = null; }
  if (!r.ok || j?.error) return { ok: false, erro: lerErroMeta(r.status, j ?? t) };
  return { ok: true, json: j ?? {} };
}

/** Recusa certa (4xx) ou resultado incerto (queda de rede, timeout, 5xx)? Incerto conta como feito. */
const incertoDe = (e: ErroMeta): boolean => e.rede || e.http >= 500 || e.http === 408;

let cacheContaIg: { id: string; em: number } | null = null;

/** Conta do Instagram ligada à Página, lida da PÁGINA com o token de sistema (não é o id do login do Instagram). */
export async function contaDoInstagram(): Promise<string | null> {
  const forcada = String(process.env.REDES_IG_USER_ID || '').trim();
  if (/^\d{5,25}$/.test(forcada)) return forcada;
  if (cacheContaIg && Date.now() - cacheContaIg.em < 6 * 3600_000) return cacheContaIg.id;
  const tk = tokenSistema();
  if (!tk) return null;
  const r = await meta(() => fetch(`${GRAPH}/${PAGINA_FB}?fields=instagram_business_account&access_token=${tk}`, { signal: sinal() }));
  const id = r.ok ? String(r.json?.instagram_business_account?.id ?? '') : '';
  if (!/^\d{5,25}$/.test(id)) return null;
  cacheContaIg = { id, em: Date.now() };
  return id;
}

/** Limpa o cache da conta (testes). */
export function limparCachePublicador(): void { cacheContaIg = null; }

/** Cota do Instagram: `{ usado, total }`, ou null se a leitura falhou (falha fechada). */
async function lerCotaInstagram(conta: string): Promise<{ usado: number; total: number } | null> {
  const tk = tokenSistema();
  const r = await meta(() => fetch(`${GRAPH}/${conta}/content_publishing_limit?fields=quota_usage,config&access_token=${tk}`, { signal: sinal() }));
  if (!r.ok) return null;
  const linha = Array.isArray(r.json?.data) ? r.json.data[0] : null;
  const usado = Number(linha?.quota_usage);
  const total = Number(linha?.config?.quota_total);
  return Number.isFinite(usado) && Number.isFinite(total) && total > 0 ? { usado, total } : null;
}

/** Só aceita link `https://` de instagram.com (ou www.instagram.com), sem usuário nem senha. Qualquer outra coisa: null. */
export function linkDoInstagram(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 300) return null;
  try {
    const u = new URL(t);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return host === 'instagram.com' || host === 'www.instagram.com' ? t : null;
  } catch { return null; }
}

/**
 * Lê o link da publicação (GET, só leitura) com o token de sistema e o mesmo prazo do token da Página.
 * Nunca muda estado nem registra parada: falha, prazo estourado ou link estranho viram null, e a publicação
 * segue "publicada" sem link. Não se refaz sozinho: é uma tentativa só. O log leva só o código, nunca o token.
 */
async function lerPermalink(mediaId: string, tk: string): Promise<string | null> {
  try {
    const ms = limitesPublicador.tokenMs;
    const r = await comPrazo(
      meta(() => fetch(`${GRAPH}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${tk}`, { signal: AbortSignal.timeout(ms) })),
      ms, 'permalink',
    );
    if (!r.ok) {
      logger.error(LOG, `leitura do permalink de ${mediaId} falhou: http ${r.erro.http}, código ${r.erro.codigo ?? '-'}`);
      return null;
    }
    const link = linkDoInstagram(r.json?.permalink);
    if (!link) logger.error(LOG, `permalink de ${mediaId} veio vazio ou fora do instagram.com`);
    return link;
  } catch {
    logger.error(LOG, `leitura do permalink de ${mediaId} passou do prazo ou caiu`);
    return null;
  }
}

// ── registro ─────────────────────────────────────────────────────────────────

export const chaveDe = (id: string): string => `${PREFIXO}${id}`;
export const idValido = (id: unknown): id is string => typeof id === 'string' && /^(instagram|facebook)\.\d{5,25}\.[0-9a-f]{16}$/.test(id);

const chaveUltima = (rede: RedeMeta): string => `redes_pub_ultima:${rede}`;

async function grava(rec: Publicacao, mudanca: Partial<Publicacao>): Promise<Publicacao> {
  const novo = { ...rec, ...mudanca };
  const ok = await gravarValor(chaveDe(rec.id), novo);
  if (!ok) logger.error(LOG, `registro de ${rec.id} não gravou: o estado na tela pode ficar atrasado`);
  return novo;
}

export interface PublicacaoTela {
  id: string; rede: RedeMeta; estado: EstadoPub; por: string; criado_em: string;
  media_id: string | null; permalink: string | null; motivo: string | null; mensagem: string | null;
  vence_em: string | null; proxima_leitura_em: string | null; video_url: string; legenda: string;
}

/** O que a tela vê. "Publicando" parado há mais de 5 min vira "incerto": o servidor caiu no meio e ninguém sabe. */
export function paraTela(rec: Publicacao, agora = Date.now()): PublicacaoTela {
  let estado = rec.estado;
  let mensagem = rec.mensagem;
  const lido = Date.parse(rec.ultima_leitura_em ?? '');
  if (estado === 'publicando' && Number.isFinite(lido) && agora - lido > REGRAS_REDES.reels.leituraConteinerMaxMs) {
    estado = 'incerto';
    mensagem = MENSAGENS.meta_incerto!;
  }
  return {
    id: rec.id, rede: rec.rede, estado, por: rec.por, criado_em: rec.criado_em, media_id: rec.media_id,
    permalink: linkDoInstagram(rec.permalink),
    motivo: rec.motivo, mensagem, vence_em: rec.vence_em,
    proxima_leitura_em: estado === 'aguardando' && Number.isFinite(lido) ? new Date(lido + REGRAS_REDES.reels.leituraConteinerMs).toISOString() : null,
    video_url: rec.video_url, legenda: rec.legenda.slice(0, 120),
  };
}

// ── publicar ─────────────────────────────────────────────────────────────────

export async function publicarReel(p: {
  rede: unknown; video_url: unknown; legenda: unknown; por: string; agora?: Date;
}): Promise<ResultadoPub> {
  const agora = (p.agora ?? new Date()).getTime();
  const iso = new Date(agora).toISOString();
  if (p.rede !== 'instagram' && p.rede !== 'facebook') return sem(400, 'entrada_invalida');
  const rede: RedeMeta = p.rede;

  // 1) chave desta rede (cada uma tem a sua)
  if (!chaveLigada(chaveDaPublicacao(rede))) return sem(403, 'chave_desligada');
  if (typeof p.legenda !== 'string' || p.legenda.length > LEGENDA_MAX) {
    return sem(400, 'entrada_invalida', { mensagem: `A legenda tem de ter até ${LEGENDA_MAX} caracteres.` });
  }
  const legenda = p.legenda.trim();
  if (!tokenSistema()) return sem(503, 'sem_token');

  try {
    // 2) parada vigente da conta (compartilhada com a resposta a comentário)
    const parada = await paradaVigente(rede, agora);
    if (parada) return sem(429, 'parada', { mensagem: textoDaParada(parada.motivo, parada.ate), abre_em: new Date(parada.ate).toISOString() });

    // 3) a conta
    const conta = rede === 'instagram' ? await contaDoInstagram() : PAGINA_FB;
    if (!conta) return sem(502, 'conta_indisponivel');

    // 4) o vídeo, antes de qualquer escrita
    const v = await validarVideo(p.video_url, { maxBytes: REGRAS_REDES.reels.videoMaxBytes });
    if (!v.ok) return { ok: false, http: 400, motivo: v.motivo, mensagem: v.mensagem };

    // 5) 30 min desde a última publicação da conta (leitura; a troca com versão vem depois do claim)
    const ultima = await lerLinha<{ em?: string }>(chaveUltima(rede));
    const tu = Date.parse(String(ultima?.value?.em ?? ''));
    if (Number.isFinite(tu) && agora - tu < REGRAS_REDES.reels.entrePublicacoesMs) {
      return sem(429, 'espacamento', { abre_em: new Date(tu + REGRAS_REDES.reels.entrePublicacoesMs).toISOString() });
    }

    // 6) CLAIM de (rede, conta, hash), antes da 1ª chamada que escreve
    const id = `${rede}.${conta}.${v.hash}`;
    const rec: Publicacao = {
      id, rede, conta, hash: v.hash, video_url: v.url, legenda, por: p.por, criado_em: iso, estado: 'criando',
      container_id: null, video_id: null, media_id: null, ultima_leitura_em: null, vence_em: null, motivo: null, mensagem: null,
    };
    const claim = await reivindicar(chaveDe(id), rec, iso);
    if (claim === 'erro') return sem(502, 'erro_livro');
    if (claim === 'duplicado') {
      // Só uma publicação que NÃO saiu (recusada antes de escrever) pode ser retomada por clique de gente.
      const antiga = await lerLinha<Publicacao>(chaveDe(id));
      if (!antiga || antiga.value?.estado !== 'nao_saiu' || (await trocarSe(chaveDe(id), rec, antiga.updated_at, iso)) === null) return sem(409, 'mesmo_video');
    }

    // 7) a faixa de 30 min, com versão: dois vídeos diferentes juntos não passam os dois
    const faixa = await tomarFaixa(chaveUltima(rede), REGRAS_REDES.reels.entrePublicacoesMs, p.por, agora);
    if (!faixa.ok) {
      await grava(rec, { estado: 'nao_saiu', motivo: 'espacamento', mensagem: MENSAGENS.espacamento });
      return sem(429, 'espacamento', { abre_em: new Date(agora + faixa.esperaMs).toISOString() });
    }

    return rede === 'instagram' ? await criarNoInstagram(rec, agora) : await criarNaPagina(rec, v, agora);
  } catch (err) {
    logger.error(LOG, 'publicar falhou antes de escrever', err instanceof ErroLivro ? { codigo: err.codigo } : err);
    return sem(502, 'erro_livro');
  }
}

/** Resultado de erro de escrita: recusa (nada saiu), ou incerto (fica registrado e NÃO se refaz). */
async function falhaDeEscrita(rec: Publicacao, rede: RedeMeta, e: ErroMeta, agora: number): Promise<ResultadoPub> {
  await registrarParada(rede, e, agora).catch(() => undefined);
  const incerto = incertoDe(e);
  logger.error(LOG, `escrita na Meta ${incerto ? 'incerta' : 'recusada'} (${rec.id}): http ${e.http}, código ${e.codigo ?? '-'}`);
  const motivo = incerto ? 'meta_incerto' : 'meta_recusou';
  const novo = await grava(rec, { estado: incerto ? 'incerto' : 'nao_saiu', motivo, mensagem: MENSAGENS[motivo]! });
  return sem(incerto ? 202 : 502, motivo, { publicacao: paraTela(novo, agora) });
}

async function criarNoInstagram(rec: Publicacao, agora: number): Promise<ResultadoPub> {
  const tk = tokenSistema();
  // A cota da Meta, ANTES. Leitura que falha fecha: não publica no escuro.
  const cota = await lerCotaInstagram(rec.conta);
  if (!cota) {
    await grava(rec, { estado: 'nao_saiu', motivo: 'cota_lida_falhou', mensagem: MENSAGENS.cota_lida_falhou });
    return sem(502, 'cota_lida_falhou');
  }
  if (cota.usado >= cota.total) {
    await grava(rec, { estado: 'nao_saiu', motivo: 'cota_esgotada', mensagem: MENSAGENS.cota_esgotada });
    return sem(429, 'cota_esgotada');
  }
  const r = await meta(() => fetch(`${GRAPH}/${rec.conta}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: sinal(),
    body: JSON.stringify({ media_type: 'REELS', video_url: rec.video_url, caption: rec.legenda, share_to_feed: true, access_token: tk }),
  }));
  if (!r.ok) return falhaDeEscrita(rec, 'instagram', r.erro, agora);
  const container = String(r.json?.id ?? '');
  if (!container) return falhaDeEscrita(rec, 'instagram', erroDeRede('contêiner sem id na resposta'), agora);
  const novo = await grava(rec, {
    estado: 'aguardando', container_id: container, ultima_leitura_em: new Date(agora).toISOString(),
    vence_em: new Date(agora + REGRAS_REDES.reels.leituraConteinerMaxMs).toISOString(),
    mensagem: 'A Meta está processando o vídeo.',
  });
  return { ok: true, http: 202, motivo: 'aguardando', mensagem: novo.mensagem!, publicacao: paraTela(novo, agora) };
}

async function criarNaPagina(rec: Publicacao, v: VideoOk, agora: number): Promise<ResultadoPub> {
  const tk = await tokenDaPagina();
  if (!tk) {
    await grava(rec, { estado: 'nao_saiu', motivo: 'conta_indisponivel', mensagem: MENSAGENS.conta_indisponivel });
    return sem(502, 'conta_indisponivel');
  }
  // Início: a Meta devolve o id do vídeo e o endereço de envio.
  const ini = await meta(() => fetch(`${GRAPH}/${rec.conta}/video_reels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: sinal(),
    body: JSON.stringify({ upload_phase: 'start', access_token: tk }),
  }));
  if (!ini.ok) return falhaDeEscrita(rec, 'facebook', ini.erro, agora);
  const videoId = String(ini.json?.video_id ?? '');
  const enviarPara = String(ini.json?.upload_url ?? '');
  let hospedeOk = false;
  try { hospedeOk = /(^|\.)facebook\.com$/i.test(new URL(enviarPara).hostname); } catch { hospedeOk = false; }
  if (!videoId || !hospedeOk) return falhaDeEscrita(rec, 'facebook', erroDeRede('início sem id ou com endereço de envio estranho'), agora);
  // Envio: a Meta busca o arquivo pelo link. O token só vai para um endereço da própria Meta.
  const env = await meta(() => fetch(enviarPara, { method: 'POST', headers: { Authorization: `OAuth ${tk}`, file_url: v.url }, signal: sinal() }));
  if (!env.ok) return falhaDeEscrita({ ...rec, video_id: videoId }, 'facebook', env.erro, agora);
  // Fim: publica.
  const fim = await meta(() => fetch(`${GRAPH}/${rec.conta}/video_reels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: sinal(),
    body: JSON.stringify({ upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: rec.legenda, access_token: tk }),
  }));
  if (!fim.ok) return falhaDeEscrita({ ...rec, video_id: videoId }, 'facebook', fim.erro, agora);
  const novo = await grava(rec, {
    estado: 'aguardando', video_id: videoId, ultima_leitura_em: new Date(agora).toISOString(),
    vence_em: new Date(agora + REGRAS_REDES.reels.leituraConteinerMaxMs).toISOString(),
    mensagem: 'A Meta está processando o Reel.',
  });
  return { ok: true, http: 202, motivo: 'aguardando', mensagem: novo.mensagem!, publicacao: paraTela(novo, agora) };
}

// ── avançar ──────────────────────────────────────────────────────────────────

export interface ResultadoAvanco {
  ok: boolean; http: number; motivo: string; mensagem: string; lido: boolean; publicacao?: PublicacaoTela;
}

/**
 * Leva a publicação um passo adiante: lê o contêiner (no máximo 1 vez por minuto, trocando a versão
 * antes) e, se o Instagram disser FINISHED, passa para "publicando" (troca com versão, uma só vence)
 * e chama media_publish. Depois de 5 min sem confirmação, falha honesta. Chamar de novo não faz mal.
 */
export async function avancarPublicacao(id: unknown, agoraMs: number = Date.now()): Promise<ResultadoAvanco> {
  const fim = (rec: Publicacao | null, motivo: string, ok: boolean, http: number, lido: boolean, mensagem?: string): ResultadoAvanco => ({
    ok, http, motivo, lido, mensagem: mensagem ?? rec?.mensagem ?? MENSAGENS[motivo] ?? '', ...(rec ? { publicacao: paraTela(rec, agoraMs) } : {}),
  });
  if (!idValido(id)) return fim(null, 'nao_encontrada', false, 404, false);
  const tk = tokenSistema();
  if (!tk) return fim(null, 'sem_token', false, 503, false);
  let linha: { value: Publicacao; updated_at: string } | null;
  try { linha = await lerLinha<Publicacao>(chaveDe(id)); } catch { return fim(null, 'erro_livro', false, 502, false); }
  if (!linha || !linha.value?.id) return fim(null, 'nao_encontrada', false, 404, false);
  let rec = linha.value;
  if (rec.estado !== 'aguardando') return fim(rec, rec.estado, true, 200, false);

  // Desligar a env da rede PARA o avanço: nem lê o contêiner nem chama media_publish (a env é a da rede DESTE registro).
  if (!chaveLigada(chaveDaPublicacao(rec.rede))) return fim(rec, 'chave_desligada', false, 403, false);

  // Passou dos 5 min: falha honesta, sem ler de novo. No Instagram o contêiner não foi publicado: falhou. Na Página
  // o `finish` com PUBLISHED já saiu (só se chega aqui depois dele), então pode estar no ar: incerto.
  const vence = Date.parse(rec.vence_em ?? '');
  if (Number.isFinite(vence) && agoraMs > vence) {
    const pagina = rec.rede === 'facebook';
    const motivo = pagina ? 'pedido_ja_feito' : 'demorou';
    const novo = { ...rec, estado: (pagina ? 'incerto' : 'falhou') as EstadoPub, motivo, mensagem: MENSAGENS[motivo]! };
    const trocou = await trocarSe(chaveDe(id), novo, linha.updated_at, new Date(agoraMs).toISOString()).catch(() => null);
    if (trocou !== null) rec = novo;
    return fim(rec, motivo, true, 200, false);
  }

  // O 1 por minuto: a troca de versão é o que vale, não o relógio de quem chamou.
  const lido = Date.parse(rec.ultima_leitura_em ?? '');
  if (Number.isFinite(lido) && agoraMs - lido < REGRAS_REDES.reels.leituraConteinerMs) return fim(rec, 'aguardando', true, 200, false);
  const leituraIso = new Date(agoraMs).toISOString();
  const comLeitura: Publicacao = { ...rec, ultima_leitura_em: leituraIso };
  let versao: string | null = null;
  try { versao = await trocarSe(chaveDe(id), comLeitura, linha.updated_at, leituraIso); } catch { return fim(rec, 'erro_livro', false, 502, false); }
  if (versao === null) return fim(rec, 'aguardando', true, 200, false);
  rec = comLeitura;

  return rec.rede === 'instagram' ? avancarInstagram(rec, versao, agoraMs, tk) : avancarPagina(rec, agoraMs);
}

async function avancarInstagram(rec: Publicacao, versao: string, agoraMs: number, tk: string): Promise<ResultadoAvanco> {
  const parada = await paradaVigente('instagram', agoraMs).catch(() => null);
  if (parada) return { ok: true, http: 200, motivo: 'parada', lido: false, mensagem: textoDaParada(parada.motivo, parada.ate), publicacao: paraTela(rec, agoraMs) };
  const r = await meta(() => fetch(`${GRAPH}/${rec.container_id}?fields=status_code,status&access_token=${tk}`, { signal: sinal() }));
  if (!r.ok) {
    await registrarParada('instagram', r.erro, agoraMs).catch(() => undefined);
    logger.error(LOG, `leitura do contêiner de ${rec.id} falhou: http ${r.erro.http}, código ${r.erro.codigo ?? '-'}`);
    return { ok: true, http: 200, motivo: 'leitura_falhou', lido: true, mensagem: 'Não consegui ler o estado agora. Tento de novo em 1 minuto.', publicacao: paraTela(rec, agoraMs) };
  }
  const codigo = String(r.json?.status_code ?? '').toUpperCase();
  if (codigo === 'ERROR' || codigo === 'EXPIRED') {
    const novo = await grava(rec, { estado: 'falhou', motivo: 'falhou_processar', mensagem: MENSAGENS.falhou_processar });
    return { ok: true, http: 200, motivo: 'falhou_processar', lido: true, mensagem: novo.mensagem!, publicacao: paraTela(novo, agoraMs) };
  }
  if (codigo !== 'FINISHED') return { ok: true, http: 200, motivo: 'aguardando', lido: true, mensagem: 'A Meta ainda está processando o vídeo.', publicacao: paraTela(rec, agoraMs) };

  // FINISHED: "aguardando" -> "publicando" com versão. Só uma chamada passa daqui, e só ela publica.
  const emPublicacao: Publicacao = { ...rec, estado: 'publicando', mensagem: 'Publicando.' };
  let vez: string | null = null;
  try { vez = await trocarSe(chaveDe(rec.id), emPublicacao, versao, new Date(agoraMs).toISOString()); } catch { vez = null; }
  if (vez === null) return { ok: true, http: 200, motivo: 'aguardando', lido: true, mensagem: 'Outra chamada está publicando.', publicacao: paraTela(rec, agoraMs) };

  const pub = await meta(() => fetch(`${GRAPH}/${rec.conta}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: sinal(),
    body: JSON.stringify({ creation_id: rec.container_id, access_token: tk }),
  }));
  if (!pub.ok) {
    await registrarParada('instagram', pub.erro, agoraMs).catch(() => undefined);
    const incerto = incertoDe(pub.erro);
    logger.error(LOG, `media_publish de ${rec.id} ${incerto ? 'incerto' : 'recusado'}: http ${pub.erro.http}, código ${pub.erro.codigo ?? '-'}`);
    const motivo = incerto ? 'meta_incerto' : 'meta_recusou';
    const novo = await grava(emPublicacao, { estado: incerto ? 'incerto' : 'falhou', motivo, mensagem: MENSAGENS[motivo]! });
    return { ok: true, http: 200, motivo, lido: true, mensagem: novo.mensagem!, publicacao: paraTela(novo, agoraMs) };
  }
  const mediaId = String(pub.json?.id ?? '') || null;
  // "Publicado" primeiro e firme: a leitura do link vem depois e nunca muda o estado.
  let novo = await grava(emPublicacao, { estado: 'publicado', media_id: mediaId, motivo: null, mensagem: 'Publicado no Instagram.' });
  const permalink = mediaId ? await lerPermalink(mediaId, tk) : null;
  if (permalink) novo = await grava(novo, { permalink });
  return { ok: true, http: 200, motivo: 'publicado', lido: true, mensagem: novo.mensagem!, publicacao: paraTela(novo, agoraMs) };
}

async function avancarPagina(rec: Publicacao, agoraMs: number): Promise<ResultadoAvanco> {
  const parada = await paradaVigente('facebook', agoraMs).catch(() => null);
  if (parada) return { ok: true, http: 200, motivo: 'parada', lido: false, mensagem: textoDaParada(parada.motivo, parada.ate), publicacao: paraTela(rec, agoraMs) };
  const tk = await tokenDaPagina();
  if (!tk) return { ok: true, http: 200, motivo: 'leitura_falhou', lido: true, mensagem: 'Não consegui ler o estado agora. Tento de novo em 1 minuto.', publicacao: paraTela(rec, agoraMs) };
  const r = await meta(() => fetch(`${GRAPH}/${rec.video_id}?fields=status&access_token=${tk}`, { signal: sinal() }));
  if (!r.ok) {
    await registrarParada('facebook', r.erro, agoraMs).catch(() => undefined);
    logger.error(LOG, `leitura do Reel de ${rec.id} falhou: http ${r.erro.http}, código ${r.erro.codigo ?? '-'}`);
    return { ok: true, http: 200, motivo: 'leitura_falhou', lido: true, mensagem: 'Não consegui ler o estado agora. Tento de novo em 1 minuto.', publicacao: paraTela(rec, agoraMs) };
  }
  const st = r.json?.status ?? {};
  const videoStatus = String(st?.video_status ?? '').toLowerCase();
  const publicacao = String(st?.publishing_phase?.status ?? '').toLowerCase();
  if (videoStatus === 'error' || videoStatus === 'expired' || publicacao === 'error') {
    const novo = await grava(rec, { estado: 'falhou', motivo: 'falhou_processar', mensagem: MENSAGENS.falhou_processar });
    return { ok: true, http: 200, motivo: 'falhou_processar', lido: true, mensagem: novo.mensagem!, publicacao: paraTela(novo, agoraMs) };
  }
  if (videoStatus === 'ready' && (!publicacao || publicacao === 'complete')) {
    const novo = await grava(rec, { estado: 'publicado', media_id: rec.video_id, motivo: null, mensagem: 'Publicado na Página.' });
    return { ok: true, http: 200, motivo: 'publicado', lido: true, mensagem: novo.mensagem!, publicacao: paraTela(novo, agoraMs) };
  }
  return { ok: true, http: 200, motivo: 'aguardando', lido: true, mensagem: 'A Meta ainda está processando o Reel.', publicacao: paraTela(rec, agoraMs) };
}

// ── listar, cron e limites ───────────────────────────────────────────────────

/** As publicações mais recentes (as pendentes estão sempre entre elas: cada leitura renova o updated_at). */
export async function listarPublicacoes(limite = 30, agora = Date.now()): Promise<PublicacaoTela[]> {
  const { data, error } = await supabase.from('system_state').select('value, updated_at')
    .like('key', `${PREFIXO}%`).order('updated_at', { ascending: false }).limit(limite);
  if (error) throw new ErroLivro(String((error as { code?: string }).code ?? 'desconhecido'));
  return ((data ?? []) as Array<{ value: Publicacao }>)
    .map(l => l.value).filter(v => v && typeof v.id === 'string')
    .map(v => paraTela(v, agora));
}

/**
 * Pendurado no cron de 5 min (io-broadcast-tick): avança o que está aguardando. Sem espera dentro e sem
 * fila: cada publicação respeita o 1 por minuto sozinha, então a tela aberta e o cron não se atropelam.
 */
export async function avancarPendentes(agora = Date.now()): Promise<{ vistas: number; avancadas: number; reason?: string }> {
  if (!chaveLigada(CHAVES.instagram) && !chaveLigada(CHAVES.facebook)) return { vistas: 0, avancadas: 0, reason: 'desligado' };
  // Prazo total de uns 20 s (relógio de verdade, não o `agora` simulado): o cron compartilha a função com os avisos
  // e a sentinela, e uma chamada pendurada à Meta não pode segurar os dois.
  const inicio = Date.now();
  const resta = (): number => limitesPublicador.cronMs - (Date.now() - inicio);
  let pendentes: PublicacaoTela[];
  try { pendentes = (await comPrazo(listarPublicacoes(30, agora), Math.max(1, resta()), 'lista de Reels')).filter(p => p.estado === 'aguardando').slice(0, 5); }
  catch { return { vistas: 0, avancadas: 0, reason: 'prazo' }; }
  let avancadas = 0;
  for (const p of pendentes) {
    if (resta() <= 0) return { vistas: pendentes.length, avancadas, reason: 'prazo' };
    try {
      const r = await comPrazo(avancarPublicacao(p.id, agora), resta(), 'avanço do Reel');
      if (r.lido) avancadas++;
    } catch { return { vistas: pendentes.length, avancadas, reason: 'prazo' }; }
  }
  return { vistas: pendentes.length, avancadas };
}

export interface SituacaoReels {
  ligado: boolean; pode: boolean; motivo: string | null; mensagem: string | null; abre_em: string | null; ultima_em: string | null;
}

/** O que pode agora e quando abre, sem chamar a Meta. A cota do Instagram é lida na hora de publicar. */
export async function situacaoReels(rede: RedeMeta, agora = Date.now()): Promise<SituacaoReels> {
  const base = { ultima_em: null as string | null };
  if (!chaveLigada(chaveDaPublicacao(rede))) return { ligado: false, pode: false, motivo: 'chave_desligada', mensagem: MENSAGENS.chave_desligada!, abre_em: null, ...base };
  if (!tokenSistema()) return { ligado: true, pode: false, motivo: 'sem_token', mensagem: MENSAGENS.sem_token!, abre_em: null, ...base };
  try {
    const [parada, ultima] = await Promise.all([paradaVigente(rede, agora), lerLinha<{ em?: string }>(chaveUltima(rede))]);
    const tu = Date.parse(String(ultima?.value?.em ?? ''));
    const ultimaEm = Number.isFinite(tu) ? new Date(tu).toISOString() : null;
    if (parada) return { ligado: true, pode: false, motivo: parada.motivo, mensagem: textoDaParada(parada.motivo, parada.ate), abre_em: new Date(parada.ate).toISOString(), ultima_em: ultimaEm };
    if (Number.isFinite(tu) && agora - tu < REGRAS_REDES.reels.entrePublicacoesMs) {
      return { ligado: true, pode: false, motivo: 'espacamento', mensagem: MENSAGENS.espacamento!, abre_em: new Date(tu + REGRAS_REDES.reels.entrePublicacoesMs).toISOString(), ultima_em: ultimaEm };
    }
    return { ligado: true, pode: true, motivo: null, mensagem: null, abre_em: null, ultima_em: ultimaEm };
  } catch {
    return { ligado: true, pode: false, motivo: 'erro_livro', mensagem: MENSAGENS.erro_livro!, abre_em: null, ...base };
  }
}
