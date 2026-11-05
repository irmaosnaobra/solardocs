// Web push para o celular do usuário da SolarDoc. As inscrições moram em feature_events
// (feature 'push'), sem tabela nova: 'inscricao' liga um aparelho, 'cancelada' desliga.
import webpush from 'web-push';
import { supabase } from '../utils/supabase';

export interface InscricaoPush {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// O web-push faz POST no endpoint que o cliente mandou. Sem lista de hosts isso é SSRF
// (a api bateria em qualquer endereço, inclusive interno). Só os serviços de push dos
// navegadores entram: FCM (Chrome/Android), Mozilla, Windows (Edge) e Apple (Safari).
export function hostPushPermitido(endpoint: unknown): boolean {
  let u: URL;
  try { u = new URL(String(endpoint ?? '')); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const h = u.hostname.toLowerCase();
  return h === 'fcm.googleapis.com'
    || h === 'updates.push.services.mozilla.com'
    || h === 'web.push.apple.com'
    || h.endsWith('.notify.windows.com')
    || h.endsWith('.push.apple.com');
}

export interface LinhaPush {
  event_type: string;
  event_data: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
}

/**
 * Inscrições ativas a partir das linhas de feature 'push', da MAIS NOVA para a mais antiga.
 * Ativa é a inscrição cujo último evento para aquele endpoint é 'inscricao'.
 */
export function inscricoesAtivas(linhas: LinhaPush[]): InscricaoPush[] {
  const vistos = new Set<string>();
  const ativas: InscricaoPush[] = [];
  for (const l of linhas) {
    const endpoint = l.event_data?.endpoint;
    if (!endpoint || vistos.has(endpoint)) continue;
    vistos.add(endpoint);
    if (l.event_type !== 'inscricao') continue;
    const p256dh = l.event_data?.keys?.p256dh;
    const auth = l.event_data?.keys?.auth;
    if (p256dh && auth) ativas.push({ endpoint, keys: { p256dh, auth } });
  }
  return ativas;
}

/** Últimas 200 linhas de push do usuário (mais novas primeiro). */
export async function linhasDePush(userId: string): Promise<LinhaPush[]> {
  const { data, error } = await supabase
    .from('feature_events')
    .select('event_type, event_data')
    .eq('user_id', userId)
    .eq('feature', 'push')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as LinhaPush[];
}

export async function registrarPush(userId: string, eventType: 'inscricao' | 'cancelada', data: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('feature_events').insert({
    user_id: userId, feature: 'push', event_type: eventType, event_data: data,
  });
  if (error) throw error;
}

export function pushConfigurado(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Manda o aviso a todos os aparelhos ativos do usuário. Nunca lança: o chamador é uma
 * página pública. 404 e 410 do serviço de push significam aparelho que saiu, e viram 'cancelada'.
 */
export async function enviarPushAoUsuario(userId: string, payload: PushPayload): Promise<{ enviados: number; removidas: number }> {
  const zero = { enviados: 0, removidas: 0 };
  if (!pushConfigurado()) {
    console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes, aviso não enviado');
    return zero;
  }
  try {
    const assunto = process.env.VAPID_SUBJECT || 'mailto:equipe@solardoc.app';
    webpush.setVapidDetails(assunto, process.env.VAPID_PUBLIC_KEY as string, process.env.VAPID_PRIVATE_KEY as string);
    const inscricoes = inscricoesAtivas(await linhasDePush(userId)).filter((i) => hostPushPermitido(i.endpoint));
    let enviados = 0;
    let removidas = 0;
    const corpo = JSON.stringify(payload);
    await Promise.all(inscricoes.map(async (ins) => {
      try {
        await webpush.sendNotification(ins, corpo, { TTL: 86400, timeout: 5000 });
        enviados++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          removidas++;
          try { await registrarPush(userId, 'cancelada', { endpoint: ins.endpoint, motivo: status }); } catch { /* segue */ }
        } else {
          console.error('[push] envio falhou', status ?? '', (err as Error).message);
        }
      }
    }));
    return { enviados, removidas };
  } catch (err) {
    console.error('[push] erro ao enviar', (err as Error).message);
    return zero;
  }
}
