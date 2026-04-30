const SUPABASE_URL = 'https://qdpfwncyzuztibpujlbq.supabase.co';

export default {
  async fetch(request, env, ctx) {
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

      // Extrai midia se houver (audio/imagem/video/documento)
      const audioUrl = body.audio?.audioUrl;
      const imageUrl = body.image?.imageUrl;
      const imageCaption = body.image?.caption;
      const videoUrl = body.video?.videoUrl;
      const documentUrl = body.document?.documentUrl;

      let mediaUrl = null, mediaType = null, mediaMime = null;
      if (audioUrl) {
        mediaUrl = audioUrl;
        mediaType = 'audio';
        mediaMime = body.audio?.mimeType || 'audio/ogg';
      } else if (imageUrl) {
        mediaUrl = imageUrl;
        mediaType = 'image';
        mediaMime = body.image?.mimeType || 'image/jpeg';
      } else if (videoUrl) {
        mediaUrl = videoUrl;
        mediaType = 'video';
        mediaMime = body.video?.mimeType || 'video/mp4';
      } else if (documentUrl) {
        mediaUrl = documentUrl;
        mediaType = 'document';
        mediaMime = body.document?.mimeType || 'application/octet-stream';
      }

      const text = body.text?.message
        || body.message?.conversation
        || body.message?.extendedTextMessage?.text
        || imageCaption
        || (mediaType === 'audio' ? '[audio]' : null)
        || (mediaType === 'image' ? '[imagem]' : null)
        || (mediaType === 'video' ? '[video]' : null)
        || (mediaType === 'document' ? '[documento]' : null)
        || (typeof body.message === 'string' ? body.message : null)
        || body.text;

      if (phone && (text || mediaUrl)) {
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
            text: text ? String(text) : '',
            sender_name: body.senderName || body.pushname || null,
            media_url: mediaUrl,
            media_type: mediaType,
            media_mime: mediaMime
          })
        });

        // Dispara processamento imediato (~5 segundos)
        // ctx.waitUntil mantem o Worker vivo ate a chamada terminar (sem isso
        // o fetch e cancelado quando o Worker retorna)
        ctx.waitUntil(
          fetch('https://api.solardoc.app/cron/process-messages', {
            headers: { 'Authorization': 'Bearer solardocs_master_cron_2024' }
          }).catch(() => {})
        );
      }
    } catch (err) {
      // silently continue
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
