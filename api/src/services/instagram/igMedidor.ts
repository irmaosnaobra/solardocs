import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { contaDoInstagram } from '../gerador/redes/publicador';
import { diaBR, horaBR, somaDias, tipoDaMidia, montarRelatorio, type LinhaPost } from './igMedidorCalc';
export * from './igMedidorCalc';

// ────────────────────────────────────────────────────────────────────────────
// MEDIDOR DO INSTAGRAM @irmaosnaobra__ (23/11/2026). SÓ LEITURA na Meta.
//
// Todo dia (06h de Brasília, pelo /cron/master) coleta as métricas de cada post e da conta e grava no banco
// do Gerador (ig_metricas_post, ig_metricas_conta; ver MIGRATION_ig_medidor.sql). O relatório semanal lê o
// que foi gravado e dá uma decisão por post: REPETIR, MANTER, CORRIGIR ou CORTAR (formato com 3 posts
// seguidos em CORRIGIR). Não depende do PC ligado: usa o MESMO token de sistema e a MESMA conta do
// publicador de Reels (META_SYSTEM_USER_TOKEN; conta por REDES_IG_USER_ID ou lida da Página).
//
// Interruptor: IG_MEDIDOR_LIGADO ('1' ou 'true'). Desligado, não coleta nada.
// Este arquivo só faz GET no Graph. Não manda mensagem, não publica, não comenta.
// ────────────────────────────────────────────────────────────────────────────

const LOG = 'ig_medidor';
const GRAPH = 'https://graph.facebook.com/v22.0';
const TIMEOUT_MS = 10_000;
const HORA_DA_COLETA = 6;
/** Tempo total da coleta: passou disso, grava o que tem e sai (parou: 'tempo'). */
export const TEMPO_MAX_MS = 90_000;
/** Teto de chamadas ao Graph por coleta (conta, lista, insights e repetições contam): a coleta das 6h não compete com o post das 9h. */
export const ORCAMENTO_CHAMADAS = 60;
/** Só as mídias dos últimos 30 dias entram na coleta, da mais nova para a mais velha. */
const DIAS_DE_MIDIA = 30;
/** O "uma métrica por vez" só roda em tantas mídias por coleta; nas outras, o que falhar fica null. */
const MAX_MIDIAS_NO_FALLBACK = 2;
/** Limite de requisições do app da Meta (4, 17, 32, 613): para a coleta inteira, sem repetir. */
const CODIGOS_DE_LIMITE = [4, 17, 32, 613];

export const METRICAS_POST = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'follows', 'profile_visits'] as const;
export type MetricaPost = (typeof METRICAS_POST)[number];

const tokenSistema = (): string => String(process.env.META_SYSTEM_USER_TOKEN || '').trim();

export const medidorLigado = (env: NodeJS.ProcessEnv = process.env): boolean =>
  /^(1|true)$/i.test(String(env.IG_MEDIDOR_LIGADO ?? '').trim());

// ── chamadas à Meta (só GET) ─────────────────────────────────────────────────

interface ErroGraph { http: number; code?: number; mensagem: string }

export interface Orcamento { restante: number; fallbacks: number; chamadas: number; inicio: number }
export const novoOrcamento = (): Orcamento => ({ restante: ORCAMENTO_CHAMADAS, fallbacks: 0, chamadas: 0, inicio: Date.now() });

/** Para a coleta inteira: acabou o orçamento de chamadas ou a Meta mandou o limite de requisições. */
export class ParadaColeta extends Error {
  constructor(public motivo: 'orcamento' | 'limite' | 'tempo', detalhe = '') { super(`${motivo}${detalhe ? ': ' + detalhe : ''}`); }
}

async function graphGet(caminho: string, params: Record<string, string>, token: string, orc: Orcamento): Promise<{ ok: true; json: any } | { ok: false; erro: ErroGraph }> {
  if (orc.restante <= 0) throw new ParadaColeta('orcamento');
  if (Date.now() - orc.inicio > TEMPO_MAX_MS) throw new ParadaColeta('tempo');
  orc.restante--; orc.chamadas++;
  const qs = new URLSearchParams({ ...params, access_token: token });
  let r: Response;
  try {
    r = await fetch(`${GRAPH}/${caminho}?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, erro: { http: 0, mensagem: String((err as Error)?.message || err) } };
  }
  const t = await r.text().catch(() => '');
  let j: any = null;
  try { j = JSON.parse(t); } catch { j = null; }
  if (!r.ok || j?.error) {
    const code = Number(j?.error?.code) || undefined;
    if (code !== undefined && CODIGOS_DE_LIMITE.includes(code)) throw new ParadaColeta('limite', `code ${code}`);
    return { ok: false, erro: { http: r.status, code: Number(j?.error?.code) || undefined, mensagem: String(j?.error?.message ?? t).slice(0, 300) } };
  }
  return { ok: true, json: j ?? {} };
}

/** Erro "esta métrica não existe para este tipo de mídia" (código 100 ou texto de não suportada). */
export function metricaNaoSuportada(e: ErroGraph): boolean {
  return e.code === 100 || /not supported|does not support|must be one of|not available|unsupported/i.test(e.mensagem);
}

function valoresDoInsights(json: any): Partial<Record<MetricaPost, number>> {
  const out: Partial<Record<MetricaPost, number>> = {};
  for (const item of Array.isArray(json?.data) ? json.data : []) {
    const nome = String(item?.name ?? '') as MetricaPost;
    const v = item?.total_value?.value ?? item?.values?.[0]?.value;
    if (METRICAS_POST.includes(nome) && typeof v === 'number' && Number.isFinite(v)) out[nome] = v;
  }
  return out;
}

/**
 * Insights de UMA mídia. Métrica não suportada para o tipo NÃO derruba: sai da lista e a chamada se repete;
 * a que sobrar sem valor fica null. Se a mensagem não diz qual métrica, cada uma é pedida sozinha.
 * Erro que não é de métrica (token, limite, rede) sobe para quem chamou.
 */
export async function lerInsightsDaMidia(mediaId: string, token: string, orc: Orcamento = novoOrcamento()): Promise<Record<MetricaPost, number | null>> {
  const res = Object.fromEntries(METRICAS_POST.map((m) => [m, null])) as Record<MetricaPost, number | null>;
  let lista: MetricaPost[] = [...METRICAS_POST];
  let tentativas = 0;
  while (lista.length && tentativas++ <= METRICAS_POST.length) {
    const r = await graphGet(`${mediaId}/insights`, { metric: lista.join(',') }, token, orc);
    if (r.ok) {
      const v = valoresDoInsights(r.json);
      for (const m of lista) if (v[m] !== undefined) res[m] = v[m]!;
      return res;
    }
    if (!metricaNaoSuportada(r.erro)) throw new Error(`insights ${mediaId}: HTTP ${r.erro.http} ${r.erro.mensagem}`);
    const citadas = lista.filter((m) => new RegExp(`\\b${m}\\b`, 'i').test(r.erro.mensagem));
    if (citadas.length && citadas.length < lista.length) {
      lista = lista.filter((m) => !citadas.includes(m));
      continue;
    }
    // Mensagem sem nome da métrica (ou citando todas): uma de cada vez, a que falhar fica null.
    // Só em poucas mídias por coleta (gasta chamadas); nas outras, tudo o que sobrou fica null.
    if (orc.fallbacks >= MAX_MIDIAS_NO_FALLBACK) return res;
    orc.fallbacks++;
    for (const m of lista) {
      const um = await graphGet(`${mediaId}/insights`, { metric: m }, token, orc);
      if (um.ok) { const v = valoresDoInsights(um.json); if (v[m] !== undefined) res[m] = v[m]!; }
      else if (!metricaNaoSuportada(um.erro)) throw new Error(`insights ${mediaId}/${m}: HTTP ${um.erro.http} ${um.erro.mensagem}`);
    }
    return res;
  }
  return res;
}

// ── coleta ───────────────────────────────────────────────────────────────────

export interface ResultadoColeta {
  ok: boolean;
  motivo?: 'desligado' | 'sem_token' | 'sem_conta' | 'erro' | 'limite';
  /** Coleta parcial: acabou o orçamento de chamadas ou a Meta mandou limite (4/17/32/613). O que deu para coletar foi gravado. */
  parou?: 'orcamento' | 'limite' | 'tempo';
  chamadas?: number;
  conta?: string;
  dia?: string;
  posts?: number;
  falhas?: number;
  seguidores?: number | null;
  ganhoDia?: number | null;
  erro?: string;
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export async function coletarMetricasIg(): Promise<ResultadoColeta> {
  if (!medidorLigado()) return { ok: false, motivo: 'desligado' };
  const token = tokenSistema();
  if (!token) { logger.warn(LOG, 'sem META_SYSTEM_USER_TOKEN: coleta ignorada'); return { ok: false, motivo: 'sem_token' }; }
  const conta = await contaDoInstagram().catch(() => null);
  if (!conta) { logger.warn(LOG, 'conta do Instagram não resolvida: coleta ignorada'); return { ok: false, motivo: 'sem_conta' }; }

  const hoje = diaBR();
  const orc = novoOrcamento();
  let parou: 'orcamento' | 'limite' | 'tempo' | undefined;
  try {
    // 1) Conta
    const perfil = await graphGet(conta, { fields: 'followers_count,media_count' }, token, orc);
    if (!perfil.ok) throw new Error(`perfil: HTTP ${perfil.erro.http} ${perfil.erro.mensagem}`);
    const seguidores = int(perfil.json?.followers_count);
    const posts = int(perfil.json?.media_count);

    // 2) Mídias
    const lista = await graphGet(`${conta}/media`, { fields: 'id,media_type,media_product_type,caption,timestamp,permalink', limit: '50' }, token, orc);
    if (!lista.ok) throw new Error(`media: HTTP ${lista.erro.http} ${lista.erro.mensagem}`);
    const corte = Date.now() - DIAS_DE_MIDIA * 86_400_000;
    const midias: any[] = (Array.isArray(lista.json?.data) ? lista.json.data : [])
      .filter((m: any) => { const t = Date.parse(String(m?.timestamp ?? '')); return Number.isFinite(t) && t >= corte; })
      .sort((a: any, b: any) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    // 3) Insights por mídia (falha de uma não derruba as outras, salvo token inválido)
    const linhas: Array<Record<string, unknown>> = [];
    let falhas = 0;
    for (const m of midias) {
      try {
        const v = await lerInsightsDaMidia(String(m.id), token, orc);
        linhas.push({
          media_id: String(m.id), coletado_em: hoje, conta,
          tipo: tipoDaMidia(m.media_type, m.media_product_type),
          publicado_em: m.timestamp ?? null,
          legenda: typeof m.caption === 'string' ? m.caption.slice(0, 2200) : null,
          permalink: m.permalink ?? null,
          reach: int(v.reach), views: int(v.views), likes: int(v.likes), comments: int(v.comments),
          saved: int(v.saved), shares: int(v.shares), follows: int(v.follows),
          profile_visits: int(v.profile_visits), total_interactions: int(v.total_interactions),
          atualizado_em: new Date().toISOString(),
        });
      } catch (err) {
        if (err instanceof ParadaColeta) { parou = err.motivo; logger.warn(LOG, 'coleta parou no meio', { motivo: err.message, chamadas: orc.chamadas }); break; }
        falhas++;
        const msg = String((err as Error)?.message || err);
        logger.warn(LOG, 'insights de uma mídia falhou', { media: String(m.id), msg: msg.slice(0, 200) });
        if (/HTTP (401|403)\b/.test(msg) || /"?code"?:? ?190/.test(msg)) break; // token ruim: não adianta insistir
      }
    }
    if (linhas.length) {
      const { error } = await supabaseGerador.from('ig_metricas_post').upsert(linhas, { onConflict: 'media_id,coletado_em' });
      if (error) throw new Error(`gravar posts: ${error.message}`);
    }

    // 4) Conta do dia: ganho = hoje - último dia gravado; sem dia anterior, tenta follower_count do Graph
    let ganhoDia: number | null = null;
    if (seguidores !== null) {
      const { data: ant } = await supabaseGerador.from('ig_metricas_conta')
        .select('dia,seguidores').eq('conta', conta).lt('dia', hoje).not('seguidores', 'is', null)
        .order('dia', { ascending: false }).limit(1);
      const anterior = Array.isArray(ant) && ant[0] ? int(ant[0].seguidores) : null;
      if (anterior !== null) ganhoDia = seguidores - anterior;
    }
    if (ganhoDia === null && !parou) {
      try {
        const fc = await graphGet(`${conta}/insights`, { metric: 'follower_count', period: 'day' }, token, orc);
        if (fc.ok) {
          const vals = fc.json?.data?.[0]?.values;
          const ultimo = Array.isArray(vals) && vals.length ? int(vals[vals.length - 1]?.value) : null;
          if (ultimo !== null) ganhoDia = ultimo;
        }
      } catch (err) {
        if (!(err instanceof ParadaColeta)) throw err;
        parou = err.motivo;
      }
    }
    const { error: eConta } = await supabaseGerador.from('ig_metricas_conta')
      .upsert({ conta, dia: hoje, seguidores, ganho_dia: ganhoDia, posts, atualizado_em: new Date().toISOString() }, { onConflict: 'conta,dia' });
    if (eConta) throw new Error(`gravar conta: ${eConta.message}`);

    logger.info(LOG, 'coleta feita', { dia: hoje, posts: linhas.length, falhas, chamadas: orc.chamadas, parou });
    return { ok: true, conta, dia: hoje, posts: linhas.length, falhas, seguidores, ganhoDia, chamadas: orc.chamadas, ...(parou ? { parou } : {}) };
  } catch (err) {
    if (err instanceof ParadaColeta) {
      logger.warn(LOG, 'coleta parou antes de ter dado', { motivo: err.message, chamadas: orc.chamadas });
      return { ok: false, motivo: 'limite', parou: err.motivo, conta, dia: hoje, chamadas: orc.chamadas };
    }
    const msg = String((err as Error)?.message || err).slice(0, 300);
    logger.error(LOG, 'coleta falhou', { msg });
    return { ok: false, motivo: 'erro', conta, dia: hoje, erro: msg };
  }
}

/** Gancho do /cron/master: roda a coleta só na hora 6 de Brasília e nunca lança erro. */
export async function coletaDiariaIg(agora: Date = new Date()): Promise<ResultadoColeta | { ok: true; pulou: 'fora_da_hora' | 'ja_coletado' }> {
  if (horaBR(agora) !== HORA_DA_COLETA) return { ok: true, pulou: 'fora_da_hora' };
  try {
    // O master roda 2x na hora 6 (GitHub no :00 e Vercel no :17): se a linha de hoje da conta já existe, não coleta de novo.
    // O POST manual do /admin chama coletarMetricasIg direto e continua podendo forçar.
    if (medidorLigado()) {
      const conta = await contaDoInstagram().catch(() => null);
      if (conta) {
        const hoje = diaBR(agora);
        const { data } = await supabaseGerador.from('ig_metricas_conta').select('dia').eq('conta', conta).eq('dia', hoje).limit(1);
        if (Array.isArray(data) && data.length) {
          logger.info(LOG, 'ja_coletado', { dia: hoje });
          return { ok: true, pulou: 'ja_coletado' };
        }
      }
    }
    return await coletarMetricasIg();
  } catch (err) {
    logger.error(LOG, 'coleta diária estourou', { msg: String((err as Error)?.message || err).slice(0, 200) });
    return { ok: false, motivo: 'erro', erro: String((err as Error)?.message || err).slice(0, 200) };
  }
}

/** Relatório semanal a partir do que está gravado (não chama a Meta). */
export async function relatorioSemanal(agora: Date = new Date()) {
  const conta = await contaDoInstagram().catch(() => null);
  if (!conta) throw new Error('conta do Instagram não resolvida');
  const hoje = diaBR(agora);

  // A última coleta de cada post: a coleta é diária, então 5 dias de linhas bastam
  const { data: posts, error } = await supabaseGerador.from('ig_metricas_post')
    .select('media_id,coletado_em,tipo,publicado_em,legenda,permalink,views,saved,shares,comments,follows')
    .eq('conta', conta).gte('coletado_em', somaDias(hoje, -5)).order('coletado_em', { ascending: false }).limit(1000);
  if (error) throw new Error(`ler posts: ${error.message}`);
  const ultimas = new Map<string, LinhaPost>();
  for (const l of (posts ?? []) as any[]) if (!ultimas.has(l.media_id)) ultimas.set(l.media_id, l as LinhaPost);

  const { data: dias, error: e2 } = await supabaseGerador.from('ig_metricas_conta')
    .select('dia,seguidores,ganho_dia').eq('conta', conta).gte('dia', somaDias(hoje, -10)).order('dia', { ascending: false }).limit(20);
  if (e2) throw new Error(`ler conta: ${e2.message}`);

  return montarRelatorio([...ultimas.values()], (dias ?? []) as any[], agora);
}
