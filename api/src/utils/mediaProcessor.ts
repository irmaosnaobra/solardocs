// Processa midia recebida no WhatsApp:
// - audio: transcreve via OpenAI Whisper
// - imagem: baixa e converte pra base64 pra mandar pro Anthropic vision

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

/**
 * Transcreve audio via OpenAI Whisper.
 * Retorna a transcricao em texto, ou null se falhar (audio muito longo,
 * sem API key, erro de rede, etc) — caller deve ter fallback.
 */
export async function transcribeAudio(audioUrl: string, mimeType: string = 'audio/ogg'): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn('[mediaProcessor] OPENAI_API_KEY ausente, transcricao desativada');
    return null;
  }

  try {
    // Baixa o audio
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      console.error(`[mediaProcessor] Falha ao baixar audio: HTTP ${audioRes.status}`);
      return null;
    }
    const audioBuffer = await audioRes.arrayBuffer();

    // Whisper aceita ate 25MB
    if (audioBuffer.byteLength > 25 * 1024 * 1024) {
      console.warn('[mediaProcessor] Audio acima de 25MB, pulando transcricao');
      return null;
    }

    // multipart/form-data manual
    const ext = mimeType.includes('mp4') ? 'mp4'
              : mimeType.includes('mpeg') ? 'mp3'
              : mimeType.includes('wav') ? 'wav'
              : mimeType.includes('webm') ? 'webm'
              : 'ogg';

    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[mediaProcessor] Whisper HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as { text?: string };
    return data.text?.trim() || null;
  } catch (err) {
    console.error('[mediaProcessor] transcribeAudio:', err);
    return null;
  }
}

/**
 * Baixa imagem e retorna como objeto pronto pra mandar no Anthropic vision.
 * Retorna null se falhar.
 */
export async function downloadImageAsAnthropicSource(imageUrl: string, mimeType: string = 'image/jpeg'): Promise<{
  type: 'base64';
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
} | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.error(`[mediaProcessor] Falha ao baixar imagem: HTTP ${res.status}`);
      return null;
    }
    const buffer = await res.arrayBuffer();

    // Anthropic aceita ate 5MB por imagem
    if (buffer.byteLength > 5 * 1024 * 1024) {
      console.warn('[mediaProcessor] Imagem acima de 5MB, ignorando');
      return null;
    }

    const validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    const safeMime = validMimes.find(m => mimeType.includes(m.split('/')[1])) || 'image/jpeg';

    const base64 = Buffer.from(buffer).toString('base64');
    return {
      type: 'base64',
      media_type: safeMime,
      data: base64,
    };
  } catch (err) {
    console.error('[mediaProcessor] downloadImageAsAnthropicSource:', err);
    return null;
  }
}
