// ─────────────────────────────────────────────────────────────────────────────
// Cliente da "Instagram API com Login do Instagram" (base graph.instagram.com).
// NÃO precisa de Página do Facebook. Token da conta guardado no MAIN (ig_config),
// nunca exposto ao navegador.
//
// Gate: tudo depende de IG_APP_ID / IG_APP_SECRET / IG_REDIRECT_URI / IG_VERIFY_TOKEN
// no ambiente. Sem isso, as funções falham explícito (o motor fica desligado).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

const GRAPH = 'https://graph.instagram.com/v25.0';
const GRAPH_ROOT = 'https://graph.instagram.com';           // token exchange/refresh
const OAUTH_TOKEN = 'https://api.instagram.com/oauth/access_token';

export const IG_SCOPES = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights';

export interface IgConfig {
  ig_user_id?: string; username?: string; name?: string;
  profile_picture_url?: string; access_token?: string; token_expires_at?: string;
}

export function igEnv() {
  return {
    appId: (process.env.IG_APP_ID || '').trim(),
    appSecret: (process.env.IG_APP_SECRET || '').trim(),
    redirectUri: (process.env.IG_REDIRECT_URI || '').trim(),
    verifyToken: (process.env.IG_VERIFY_TOKEN || '').trim(),
    enabled: (process.env.IG_AUTOMACAO_ENABLED || '').trim() === 'true',
  };
}

/** Config da conta conectada (com token). Só servidor. */
export async function getIgConfig(): Promise<IgConfig | null> {
  const { data } = await supabase.from('ig_config').select('*').eq('id', 1).maybeSingle();
  return (data as IgConfig) || null;
}

// ── HMAC do webhook (X-Hub-Signature-256) ───────────────────────────────────
export function verifyHmac(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  const { appSecret } = igEnv();
  if (!appSecret || !signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch { return false; }
}

// ── OAuth ────────────────────────────────────────────────────────────────────
export function authorizeUrl(): string {
  const { appId, redirectUri } = igEnv();
  const p = new URLSearchParams({
    client_id: appId, redirect_uri: redirectUri,
    response_type: 'code', scope: IG_SCOPES,
  });
  return `https://www.instagram.com/oauth/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ token: string; userId: string }> {
  const { appId, appSecret, redirectUri } = igEnv();
  const form = new URLSearchParams({
    client_id: appId, client_secret: appSecret, grant_type: 'authorization_code',
    redirect_uri: redirectUri, code,
  });
  const r = await fetch(OAUTH_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const j = await r.json() as any;
  if (!r.ok || !j.access_token) throw new Error('exchangeCode falhou: ' + JSON.stringify(j).slice(0, 200));
  // pode vir array de user_id ou string
  const userId = Array.isArray(j.user_id) ? String(j.user_id[0]) : String(j.user_id || '');
  return { token: j.access_token, userId };
}

export async function exchangeLongToken(shortToken: string): Promise<{ token: string; expiresIn: number }> {
  const { appSecret } = igEnv();
  const p = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken });
  const r = await fetch(`${GRAPH_ROOT}/access_token?${p.toString()}`);
  const j = await r.json() as any;
  if (!r.ok || !j.access_token) throw new Error('exchangeLongToken falhou: ' + JSON.stringify(j).slice(0, 200));
  return { token: j.access_token, expiresIn: Number(j.expires_in || 5184000) };
}

export async function refreshLongToken(longToken: string): Promise<{ token: string; expiresIn: number }> {
  const p = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: longToken });
  const r = await fetch(`${GRAPH_ROOT}/refresh_access_token?${p.toString()}`);
  const j = await r.json() as any;
  if (!r.ok || !j.access_token) throw new Error('refreshLongToken falhou: ' + JSON.stringify(j).slice(0, 200));
  return { token: j.access_token, expiresIn: Number(j.expires_in || 5184000) };
}

export async function getMe(token: string): Promise<{ user_id: string; username: string; name?: string; profile_picture_url?: string }> {
  const p = new URLSearchParams({ fields: 'user_id,username,name,profile_picture_url', access_token: token });
  const r = await fetch(`${GRAPH}/me?${p.toString()}`);
  const j = await r.json() as any;
  if (!r.ok) throw new Error('getMe falhou: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

/** Assina os webhooks (comments, messages) na conta após conectar. */
export async function subscribeApps(igUserId: string, token: string): Promise<void> {
  const p = new URLSearchParams({ subscribed_fields: 'comments,messages', access_token: token });
  const r = await fetch(`${GRAPH}/${igUserId}/subscribed_apps?${p.toString()}`, { method: 'POST' });
  const j = await r.json() as any;
  if (!r.ok) logger.error('ig', 'subscribeApps falhou', j);
}

/** Salva/atualiza a config da conta (após OAuth). */
export async function saveIgConfig(cfg: IgConfig): Promise<void> {
  await supabase.from('ig_config').upsert({ id: 1, ...cfg, updated_at: new Date().toISOString() }, { onConflict: 'id' });
}

/** Métricas da conta: perfil (seguidores/posts) + alcance (precisa scope insights). */
export async function getInsights(igUserId: string, token: string): Promise<any> {
  const pf = new URLSearchParams({ fields: 'followers_count,media_count,username', access_token: token });
  let profile: any = null;
  try { profile = await (await fetch(`${GRAPH}/me?${pf.toString()}`)).json(); }
  catch (err) { logger.error('ig', 'getInsights perfil falhou', err); }
  let alcance: any = null;
  try {
    const ip = new URLSearchParams({ metric: 'reach', period: 'day', metric_type: 'total_value', access_token: token });
    alcance = await (await fetch(`${GRAPH}/${igUserId}/insights?${ip.toString()}`)).json();
  } catch (err) { logger.error('ig', 'getInsights alcance falhou (falta reconectar com scope insights?)', err); }
  return { profile, alcance };
}

/** Posts recentes pro seletor visual do painel. */
export async function getMedia(igUserId: string, token: string): Promise<any[]> {
  const p = new URLSearchParams({ fields: 'id,media_type,media_url,thumbnail_url,caption,permalink', access_token: token, limit: '24' });
  const r = await fetch(`${GRAPH}/${igUserId}/media?${p.toString()}`);
  const j = await r.json() as any;
  if (!r.ok) throw new Error('getMedia falhou: ' + JSON.stringify(j).slice(0, 200));
  return j.data || [];
}

// ── Envio de mensagens ───────────────────────────────────────────────────────
type MsgPayload = { text?: string; button?: { url: string; title: string } };

function buildMessage(p: MsgPayload): any {
  if (p.button) {
    return { attachment: { type: 'template', payload: { template_type: 'button', text: p.text || '', buttons: [{ type: 'web_url', url: p.button.url, title: p.button.title }] } } };
  }
  return { text: p.text || '' };
}

/** DM privada em resposta a um comentário (fura a janela de 24h). recipient=comment_id. */
export async function sendPrivateReply(igUserId: string, commentId: string, payload: MsgPayload, token: string): Promise<void> {
  await sendMessageRaw(igUserId, { comment_id: commentId }, buildMessage(payload), token);
}

/** DM normal (conversa já aberta). recipient=ig_user_id da pessoa. */
export async function sendDM(igUserId: string, recipientIgsid: string, payload: MsgPayload, token: string): Promise<void> {
  await sendMessageRaw(igUserId, { id: recipientIgsid }, buildMessage(payload), token);
}

async function sendMessageRaw(igUserId: string, recipient: Record<string, string>, message: any, token: string): Promise<void> {
  const r = await fetch(`${GRAPH}/${igUserId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient, message, access_token: token }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`sendMessage ${r.status}: ${t.slice(0, 200)}`); }
}

/** Resposta pública ao comentário. */
export async function replyToComment(commentId: string, message: string, token: string): Promise<void> {
  const form = new URLSearchParams({ message, access_token: token });
  const r = await fetch(`${GRAPH}/${commentId}/replies`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!r.ok) { const t = await r.text(); throw new Error(`replyToComment ${r.status}: ${t.slice(0, 200)}`); }
}
