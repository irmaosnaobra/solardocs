const PIXEL_ID     = '824905216831401';
const ACCESS_TOKEN = process.env.META_PIXEL_TOKEN || '';
const API_URL      = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

async function sha256(text: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

// Telefone pro Meta: só dígitos, COM código do país (BR = 55). Heurística BR:
// 10-11 dígitos (DDD + número, sem país) → prefixa 55; 12-13 já tem país.
// Sem o país o hash não casa com o cadastro do Facebook.
function normalizePhoneDigits(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  external_id?: string[];
  fbc?: string;
  fbp?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

interface MetaEvent {
  event_name:    string;
  event_time:    number;
  event_id?:     string;
  action_source: 'website';
  event_source_url?: string;
  user_data:     MetaUserData;
  custom_data?:  Record<string, unknown>;
}

export interface MetaSendResult { ok: boolean; status: number; error?: string }

// Envia um evento ao Meta via Conversions API (CAPI).
// MUDANÇAS vs versão antiga (que perdia venda):
//  - aceita ph (telefone), fn/ln (nome), external_id, fbc/fbp → correspondência
//    MUITO mais forte (o email sozinho quase não casa com o anúncio no Brasil);
//  - CHECA a resposta do Meta (res.ok + corpo) e RETORNA {ok,status} — antes
//    falhava em silêncio (token errado passava batido);
//  - timeout de 6s (AbortSignal) — sem isto o await podia pendurar a função;
//  - eventTime opcional → reenvio retroativo com a data ORIGINAL do card-pass.
// Backward-compatible: chamadas antigas (só email) continuam funcionando.
export async function sendMetaEvent(
  eventName: string,
  opts: {
    eventId?:    string;
    email?:      string;
    phone?:      string;
    firstName?:  string;
    lastName?:   string;
    externalId?: string;   // se ausente e houver email, usa o email como external_id
    fbc?:        string;
    fbp?:        string;
    ip?:         string;
    userAgent?:  string;
    eventTime?:  number;   // unix (s) — reenvio retroativo com a data original
    sourceUrl?:  string;
    customData?: Record<string, unknown>;
  } = {}
): Promise<MetaSendResult> {
  if (!ACCESS_TOKEN) return { ok: false, status: 0, error: 'no_token' };

  try {
    const user_data: MetaUserData = {};
    if (opts.email)     user_data.em = [await sha256(opts.email)];
    if (opts.phone) {
      const ph = normalizePhoneDigits(opts.phone);
      if (ph) user_data.ph = [await sha256(ph)];
    }
    if (opts.firstName) user_data.fn = [await sha256(opts.firstName)];
    if (opts.lastName)  user_data.ln = [await sha256(opts.lastName)];
    const extId = opts.externalId || opts.email;
    if (extId)          user_data.external_id = [await sha256(extId)];
    if (opts.fbc)       user_data.fbc = opts.fbc;
    if (opts.fbp)       user_data.fbp = opts.fbp;
    if (opts.ip)        user_data.client_ip_address = opts.ip;
    if (opts.userAgent) user_data.client_user_agent = opts.userAgent;

    const event: MetaEvent = {
      event_name:    eventName,
      event_time:    opts.eventTime ?? Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data,
    };
    if (opts.eventId)    event.event_id = opts.eventId;
    if (opts.sourceUrl)  event.event_source_url = opts.sourceUrl;
    if (opts.customData) event.custom_data = opts.customData;

    const res = await fetch(`${API_URL}?access_token=${ACCESS_TOKEN}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ data: [event] }),
      signal:  AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      console.error(`Meta CAPI ${eventName} FALHOU: HTTP ${res.status} — ${body.slice(0, 300)}`);
      return { ok: false, status: res.status, error: body.slice(0, 300) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Meta CAPI ${eventName} erro de rede/timeout:`, msg);
    return { ok: false, status: 0, error: msg };
  }
}
