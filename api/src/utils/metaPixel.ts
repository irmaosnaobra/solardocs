const PIXEL_ID     = '824905216831401';
const ACCESS_TOKEN = process.env.META_PIXEL_TOKEN || '';
const API_URL      = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

interface MetaEvent {
  event_name:    string;
  event_time:    number;
  event_id?:     string;
  action_source: 'website';
  user_data: {
    em?: string[];
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data?: Record<string, unknown>;
}

async function sha256(text: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

export async function sendMetaEvent(
  eventName: string,
  opts: {
    eventId?:   string;
    email?:     string;
    ip?:        string;
    userAgent?: string;
    customData?: Record<string, unknown>;
  } = {}
): Promise<void> {
  if (!ACCESS_TOKEN) return;

  try {
    const event: MetaEvent = {
      event_name:    eventName,
      event_time:    Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data:     {},
    };

    if (opts.eventId)    event.event_id = opts.eventId;
    if (opts.email)      event.user_data.em = [await sha256(opts.email)];
    if (opts.ip)         event.user_data.client_ip_address = opts.ip;
    if (opts.userAgent)  event.user_data.client_user_agent  = opts.userAgent;
    if (opts.customData) event.custom_data = opts.customData;

    await fetch(`${API_URL}?access_token=${ACCESS_TOKEN}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ data: [event] }),
    });
  } catch (err) {
    console.error('Meta CAPI error:', err);
  }
}
