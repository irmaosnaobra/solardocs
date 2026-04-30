const SUPABASE_URL = 'https://qdpfwncyzuztibpujlbq.supabase.co';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ status: 'webhook online' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const body = await request.json().catch(() => ({}));

      // Loga no Supabase para debug
      await fetch(`${SUPABASE_URL}/rest/v1/webhook_debug`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ payload: body })
      });

      if (body.fromMe || body.isGroup) {
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
      }

      const phone = body.phone || body.senderPhone;
      const text = body.text?.message
        || body.message?.conversation
        || body.message?.extendedTextMessage?.text
        || (typeof body.message === 'string' ? body.message : null)
        || body.text;

      if (phone && text) {
        // Salva na fila do Supabase
        await fetch(`${SUPABASE_URL}/rest/v1/message_queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            phone: String(phone),
            text: String(text),
            sender_name: body.senderName || body.pushname || null
          })
        });

        // Dispara processamento imediato (~5 segundos)
        // Usa secret hardcoded da GitHub Actions (cron.ts aceita ambos: env.CRON_SECRET e este)
        fetch('https://api.solardoc.app/cron/process-messages', {
          headers: { 'Authorization': `Bearer solardocs_master_cron_2024` }
        }).catch(() => {});
      }
    } catch (err) {
      // silently continue
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
