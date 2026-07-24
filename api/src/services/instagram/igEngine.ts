// ─────────────────────────────────────────────────────────────────────────────
// Motor de automação do Instagram (comentário→DM, story→DM). Substituto do
// ManyChat, integrado ao nosso CRM: quando a pessoa manda um WhatsApp na DM,
// deposita o lead no rodízio/agenda via ingestManychatLead (reaproveita tudo).
//
// Regras da Meta respeitadas:
//   • Resposta privada a comentário FURA a janela de 24h (needs_window=false).
//   • DM/followup só saem com a janela de 24h ABERTA (needs_window=true).
//   • Teto ~200 DMs/h e ~2/s (anti-derrubada de conta).
// Gate: IG_AUTOMACAO_ENABLED='true' + conta conectada (ig_config com token).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ingestManychatLead } from '../agenda/manychatLeadService';
import {
  igEnv, getIgConfig, sendPrivateReply, sendDM, replyToComment,
  refreshLongToken, saveIgConfig,
} from './igClient';

const IG_MAX_POR_HORA = Number(process.env.IG_MAX_POR_HORA || 180);
const MAX_POR_TICK = 15;
const SPACING_MS = 500;                 // ~2/s

interface Automation {
  id: string; nome: string; ativo: boolean;
  gatilhos: { comment?: boolean; story?: boolean; dm?: boolean };
  palavras_chave: string[]; match_tipo: string; post_id: string | null;
  respostas_publicas: string[]; dm_boas_vindas: string | null;
  botao_rotulo: string | null; link_url: string | null;
  lembrete_texto: string | null; lembrete_horas: number;
}

function ligado(): boolean { return igEnv().enabled; }
const pick = <T,>(arr: T[]): T | null => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

function matchKeyword(text: string, kws: string[], tipo: string): boolean {
  const t = (text || '').toLowerCase().trim();
  if (tipo === 'qualquer') return true;
  const lista = (kws || []).map(k => (k || '').toLowerCase().trim()).filter(Boolean);
  if (!lista.length) return false;
  if (tipo === 'exato') return lista.includes(t);
  return lista.some(k => t.includes(k));           // contem (default)
}

async function loadAutomations(): Promise<Automation[]> {
  const { data } = await supabaseGerador.from('ig_automations').select('*').eq('ativo', true);
  return (data as Automation[]) || [];
}

async function jaVisto(ref: string): Promise<boolean> {
  if (!ref) return false;
  const { data } = await supabase.from('ig_events').select('id').eq('ref', ref).limit(1);
  return !!(data && data.length);
}
async function logEvent(tipo: string, ref: string | null, raw: any): Promise<void> {
  await supabase.from('ig_events').insert({ tipo, ref, raw });
}
async function upsertContact(igUserId: string, username: string | null, automationId: string | null, reply: boolean): Promise<void> {
  const patch: any = { ig_user_id: igUserId, updated_at: new Date().toISOString() };
  if (username) patch.username = username;
  if (automationId) patch.last_automation_id = automationId;
  if (reply) patch.last_reply_at = new Date().toISOString();
  await supabase.from('ig_contacts').upsert(patch, { onConflict: 'ig_user_id' });
}
async function enqueue(item: { tipo: string; automation_id: string; recipient: string; payload: any; needs_window: boolean; enviar_apos?: string }): Promise<void> {
  await supabase.from('ig_queue').insert({
    tipo: item.tipo, automation_id: item.automation_id, recipient: item.recipient,
    payload: item.payload, needs_window: item.needs_window, enviar_apos: item.enviar_apos || new Date().toISOString(),
  });
}

function welcomePayload(a: Automation): any {
  const text = a.dm_boas_vindas || 'Oi! Aqui está o que você pediu 👇';
  if (a.link_url) return { text, button: { url: a.link_url, title: a.botao_rotulo || 'Abrir link' } };
  return { text };
}
function enqueueReminderIfAny(a: Automation, recipient: string): Promise<void> | null {
  if (!a.lembrete_texto) return null;
  const apos = new Date(Date.now() + (Number(a.lembrete_horas) || 24) * 3600 * 1000).toISOString();
  return enqueue({ tipo: 'followup', automation_id: a.id, recipient, payload: { text: a.lembrete_texto }, needs_window: true, enviar_apos: apos });
}

// ── COMENTÁRIO ────────────────────────────────────────────────────────────────
export async function handleComment(value: any): Promise<void> {
  const commentId = value?.id;
  const text = value?.text || '';
  const fromId = value?.from?.id;
  const username = value?.from?.username || null;
  const mediaId = value?.media?.id || value?.media_id || null;
  if (!commentId || !fromId) return;
  if (await jaVisto(commentId)) return;
  await logEvent('comment', commentId, value);

  const autos = await loadAutomations();
  for (const a of autos) {
    if (!a.gatilhos?.comment) continue;
    if (a.post_id && mediaId && a.post_id !== mediaId) continue;
    if (!matchKeyword(text, a.palavras_chave, a.match_tipo)) continue;

    await upsertContact(fromId, username, a.id, false);
    // DM privada (fura a janela de 24h) com a mensagem + botão do link.
    await enqueue({ tipo: 'private_reply', automation_id: a.id, recipient: commentId, payload: welcomePayload(a), needs_window: false });
    // Resposta pública opcional (sorteia variação).
    const pub = pick(a.respostas_publicas || []);
    if (pub) await enqueue({ tipo: 'public_reply', automation_id: a.id, recipient: commentId, payload: { text: pub }, needs_window: false });
    // Lembrete por tempo (só sai se a pessoa responder → janela aberta).
    await enqueueReminderIfAny(a, fromId);
    break;
  }
}

// ── MENSAGEM (story reply / DM) ────────────────────────────────────────────────
export async function handleMessage(m: any, ownIgId: string): Promise<void> {
  const senderId = m?.sender?.id;
  const mid = m?.message?.mid;
  if (!senderId || senderId === ownIgId) return;         // ignora nossos próprios ecos
  if (m?.message?.is_echo) return;
  if (mid && await jaVisto(mid)) return;
  if (mid) await logEvent('message', mid, m);

  const text = m?.message?.text || '';
  const isStory = !!m?.message?.reply_to?.story;

  // Toda mensagem recebida ABRE a janela de 24h.
  await upsertContact(senderId, null, null, true);

  const autos = await loadAutomations();
  for (const a of autos) {
    const gatilhoOn = isStory ? a.gatilhos?.story : a.gatilhos?.dm;
    if (!gatilhoOn) continue;
    if (!matchKeyword(text, a.palavras_chave, a.match_tipo)) continue;
    await upsertContact(senderId, null, a.id, false);
    // Conversa já aberta → DM direta (não precisa de janela).
    await enqueue({ tipo: 'dm', automation_id: a.id, recipient: senderId, payload: welcomePayload(a), needs_window: false });
    await enqueueReminderIfAny(a, senderId);
    break;
  }

  // Integração com o CRM: se a pessoa mandou um WhatsApp na DM, deposita o lead
  // no rodízio/agenda (reaproveita ingestManychatLead → avisa o consultor).
  await maybeDepositLead(senderId, text);
}

async function maybeDepositLead(igUserId: string, text: string): Promise<void> {
  const m = (text || '').match(/(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/);
  if (!m) return;
  const digits = m[0].replace(/\D/g, '');
  if (digits.length < 10) return;
  try {
    await ingestManychatLead({ produto: 'solar', nome: 'Lead Instagram', whatsapp: digits, contact_id: 'ig_' + igUserId });
  } catch (err) { logger.error('ig', 'deposito CRM falhou', err); }
}

// ── DRENAGEM DA FILA ────────────────────────────────────────────────────────────
export async function drainIgQueue(): Promise<{ enviados: number; pulados: number; reason?: string }> {
  if (!ligado()) return { enviados: 0, pulados: 0, reason: 'desligado' };
  const cfg = await getIgConfig();
  if (!cfg?.access_token || !cfg.ig_user_id) return { enviados: 0, pulados: 0, reason: 'sem_conta' };

  // Teto anti-ban por hora.
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  const { data: sentRows } = await supabase.from('system_state').select('key').like('key', 'ig_sent:%').gte('updated_at', desde).limit(IG_MAX_POR_HORA + 1);
  if ((sentRows?.length || 0) >= IG_MAX_POR_HORA) return { enviados: 0, pulados: 0, reason: 'teto_hora' };

  const nowIso = new Date().toISOString();
  const { data: fila } = await supabase.from('ig_queue').select('*')
    .eq('status', 'pending').lte('enviar_apos', nowIso)
    .order('criado_em', { ascending: true }).limit(MAX_POR_TICK);
  if (!fila || fila.length === 0) return { enviados: 0, pulados: 0, reason: 'fila_vazia' };

  let enviados = 0, pulados = 0;
  for (const item of fila as any[]) {
    // Claim atômico.
    const { data: claimed } = await supabase.from('ig_queue')
      .update({ status: 'sending', claimed_at: new Date().toISOString(), tentativas: (item.tentativas || 0) + 1 })
      .eq('id', item.id).eq('status', 'pending').select('id');
    if (!claimed || !claimed.length) continue;

    // Janela de 24h.
    if (item.needs_window) {
      const { data: c } = await supabase.from('ig_contacts').select('last_reply_at').eq('ig_user_id', item.recipient).maybeSingle();
      const aberta = c?.last_reply_at && (Date.now() - new Date(c.last_reply_at).getTime()) < 24 * 3600 * 1000;
      if (!aberta) { await supabase.from('ig_queue').update({ status: 'skipped', erro: 'janela_24h_fechada' }).eq('id', item.id); pulados++; continue; }
    }

    try {
      if (item.tipo === 'private_reply') await sendPrivateReply(cfg.ig_user_id, item.recipient, item.payload, cfg.access_token);
      else if (item.tipo === 'public_reply') await replyToComment(item.recipient, item.payload?.text || '', cfg.access_token);
      else await sendDM(cfg.ig_user_id, item.recipient, item.payload, cfg.access_token); // dm | followup
      await supabase.from('ig_queue').update({ status: 'sent' }).eq('id', item.id);
      await supabase.from('system_state').upsert({ key: 'ig_sent:' + item.id, value: '1', updated_at: new Date().toISOString() }, { onConflict: 'key' });
      await logEvent('sent', item.id, { tipo: item.tipo, recipient: item.recipient });
      enviados++;
    } catch (err: any) {
      await supabase.from('ig_queue').update({ status: 'failed', erro: String(err?.message || err).slice(0, 300) }).eq('id', item.id);
      logger.error('ig', `envio ${item.tipo} falhou`, err);
    }
    await new Promise(r => setTimeout(r, SPACING_MS));
  }
  return { enviados, pulados };
}

// ── REFRESH DO TOKEN (semanal) ──────────────────────────────────────────────────
export async function refreshIgToken(): Promise<{ ok: boolean; reason?: string }> {
  if (!ligado()) return { ok: false, reason: 'desligado' };
  const cfg = await getIgConfig();
  if (!cfg?.access_token) return { ok: false, reason: 'sem_token' };
  // Só renova se faltar menos de ~14 dias (token dura 60d).
  if (cfg.token_expires_at) {
    const faltam = new Date(cfg.token_expires_at).getTime() - Date.now();
    if (faltam > 14 * 24 * 3600 * 1000) return { ok: true, reason: 'ainda_valido' };
  }
  try {
    const { token, expiresIn } = await refreshLongToken(cfg.access_token);
    await saveIgConfig({ ...cfg, access_token: token, token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() });
    return { ok: true };
  } catch (err: any) { logger.error('ig', 'refresh token falhou', err); return { ok: false, reason: String(err?.message || err) }; }
}
