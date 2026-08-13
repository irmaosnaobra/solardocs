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

/**
 * Baixa PDF e retorna no formato de bloco `document` da Anthropic (o modelo lê a
 * página como imagem + texto, sem precisar de conversão nossa).
 *
 * Existe por causa do comprovante de Pix: banco (Sicoob, Itaú, Nubank…) exporta
 * comprovante em PDF, e o cliente manda esse PDF no WhatsApp. Enquanto só imagem
 * era lida, quem pagava e mandava a prova em PDF ouvia "não analiso esse formato"
 * e ficava sem acesso — foi o que segurou o Junior Moraes 2 dias em 11/08/2026.
 *
 * Retorna null se falhar (o chamador segue no fluxo normal).
 */
export async function downloadPdfAsAnthropicSource(pdfUrl: string): Promise<{
  type: 'base64';
  media_type: 'application/pdf';
  data: string;
} | null> {
  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) {
      console.error(`[mediaProcessor] Falha ao baixar PDF: HTTP ${res.status}`);
      return null;
    }
    const buffer = await res.arrayBuffer();

    // Teto conservador: comprovante é 1 página (~100KB). Acima disso é catálogo,
    // projeto, datasheet — não vale o custo de visão nem o risco de timeout.
    if (buffer.byteLength > 5 * 1024 * 1024) {
      console.warn('[mediaProcessor] PDF acima de 5MB, ignorando');
      return null;
    }

    // Confere a assinatura %PDF- antes de mandar pra IA: a Z-API entrega qualquer
    // anexo com mime 'application/pdf' e um arquivo corrompido viraria erro 400.
    const head = Buffer.from(buffer.slice(0, 5)).toString('latin1');
    if (!head.startsWith('%PDF-')) {
      console.warn('[mediaProcessor] arquivo não é PDF de verdade (sem %PDF-), ignorando');
      return null;
    }

    return {
      type: 'base64',
      media_type: 'application/pdf',
      data: Buffer.from(buffer).toString('base64'),
    };
  } catch (err) {
    console.error('[mediaProcessor] downloadPdfAsAnthropicSource:', err);
    return null;
  }
}
