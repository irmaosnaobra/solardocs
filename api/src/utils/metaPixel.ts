const PIXEL_ID     = '824905216831401';
const ACCESS_TOKEN = process.env.META_PIXEL_TOKEN || '';
const API_URL      = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

// ── Conversions API for CRM (conversão de leads) ─────────────────────────────
// Fluxo DIFERENTE do pixel acima: aqui avisamos o Meta que um LEAD dos Forms
// (Irmãos na Obra / Ékent solar) virou CONTRATO. O Meta aprende o perfil de quem
// fecha e busca mais gente parecida (-15% custo/lead bom, +44% conversão, dado
// Meta). Doc: developers.facebook.com/docs/marketing-api/conversions-api/
//   conversion-leads-integration/payload-specification
// Chave = lead_id (leadgen_id) em TEXTO PURO (não hash), action_source=
// system_generated. Dataset = pixel do funil de leads solar (Ékent Energia
// Solar), NÃO o Solardocs do pixel acima. Token = System User (acessa a conta
// de leads act_...250); cai pro META_PIXEL_TOKEN se o SU não estiver setado.
const LEADS_DATASET_ID = process.env.META_LEADS_DATASET_ID || '446093469730871'; // "Pixel de Ékent Energia Solar"
const LEADS_CAPI_TOKEN = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';

export interface CrmLeadEventResult { ok: boolean; status: number; error?: string; received?: number }

// Envia um evento de conversão-de-lead (CRM) ao Meta.
// - leadId: o leadgen_id do Lead Ads (leads_meta.lead_id), texto puro.
// - eventName: estágio do CRM ("Converted" = fechou a venda; ou "Sales Opportunity" etc).
// - value/currency: opcional — valor do contrato (custom_data), pra medir ROAS real.
// - eventTime: unix (s) — pra retroativo, a data ORIGINAL do fechamento.
// Best-effort: retorna {ok,status}; nunca lança (o cron trata o resultado).
export async function sendCrmLeadEvent(
  leadId: string,
  eventName: string,
  opts: {
    value?: number;
    currency?: string;
    eventTime?: number;
    leadEventSource?: string;   // rótulo da origem do CRM (ex: "Gerador IO")
    eventId?: string;           // idempotência no lado do Meta (dedup)
  } = {},
): Promise<CrmLeadEventResult> {
  if (!LEADS_CAPI_TOKEN) return { ok: false, status: 0, error: 'no_token' };
  if (!leadId || !/^\d{6,20}$/.test(leadId)) return { ok: false, status: 0, error: 'lead_id_invalido' };

  const event: Record<string, unknown> = {
    event_name:    eventName,
    event_time:    opts.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: 'system_generated',           // OBRIGATÓRIO p/ conversion-leads
    // lead_id em texto puro (NÃO hash) e COMO STRING: ids do Meta têm até 17
    // dígitos e Number() estoura MAX_SAFE_INTEGER (~9e15) → corromperia os
    // últimos dígitos ("...198" vira "...200") → o Meta nunca casaria a venda.
    // Verificado ao vivo: o dataset aceita lead_id string (events_received:1).
    user_data:     { lead_id: leadId },
    custom_data: {
      lead_event_source: opts.leadEventSource || 'Gerador IO',
      event_source:      'crm',
      ...(opts.value != null ? { value: opts.value, currency: opts.currency || 'BRL' } : {}),
    },
  };
  if (opts.eventId) event.event_id = opts.eventId;

  try {
    const url = `https://graph.facebook.com/v21.0/${LEADS_DATASET_ID}/events?access_token=${LEADS_CAPI_TOKEN}`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ data: [event] }),
      signal:  AbortSignal.timeout(6000),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`Meta CRM-CAPI ${eventName} FALHOU: HTTP ${res.status} — ${body.slice(0, 300)}`);
      return { ok: false, status: res.status, error: body.slice(0, 300) };
    }
    let received: number | undefined;
    try { received = JSON.parse(body).events_received; } catch { /* ignore */ }
    return { ok: true, status: res.status, received };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Meta CRM-CAPI ${eventName} erro de rede/timeout:`, msg);
    return { ok: false, status: 0, error: msg };
  }
}

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
