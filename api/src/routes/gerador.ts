import { Router, Request, Response } from 'express';
import { generateGeradorPdf } from '../controllers/pdfGeradorController';
import { trackEvent } from '../controllers/trackingGeradorController';
import { gerarIdeiasSociais, roteirizarTema } from '../services/agenda/socialIdeiasService';
import { varrerAdLibrary, gerarVideoAvatar } from '../services/agenda/socialStudioStubs';
import { logger } from '../utils/logger';

const router = Router();

// PDF público de proposta do Gerador IO. Rate-limit global já cobre — chamada
// é pesada (Puppeteer), mas controller verifica existência da proposta antes
// de levantar o browser.
router.get('/pdf/:codigo', generateGeradorPdf);

// Tracking server-side de acessos e cliques (lê IP + UA da request, resolve geo).
router.post('/track', trackEvent);

// IA: ideias de Reels/vídeos de energia solar, ancoradas nos posts reais que
// mais performaram (aba "Redes" do gerador). Chamado via rewrite /_api/* do dashboard.
router.post('/social/ideias', async (req: Request, res: Response) => {
  try {
    const rede = (req.body?.rede === 'tiktok') ? 'tiktok' : 'instagram';
    const ideias = await gerarIdeiasSociais(rede);
    res.json({ ok: true, ideias });
  } catch (err: any) {
    logger.error('gerador', 'social/ideias falhou', err);
    res.status(500).json({ error: 'IA failed', detail: String(err?.message || err) });
  }
});

// Estúdio: roteiriza UM tema-isca no DNA viral (pega tema + link opcional).
router.post('/social/roteirizar', async (req: Request, res: Response) => {
  try {
    const tema = String(req.body?.tema || '').trim();
    if (!tema) return res.status(400).json({ error: 'tema obrigatório' });
    const r = await roteirizarTema(tema, req.body?.fonte_url, req.body?.apresentador);
    // degradação honesta: link sem transcrição → sinaliza pro front pedir descrição
    if (r && (r as any).erro) {
      return res.json({ ok: true, roteiro: null, motivo: (r as any).erro, ehYoutube: (r as any).ehYoutube });
    }
    res.json({ ok: true, roteiro: r });
  } catch (err: any) {
    logger.error('gerador', 'social/roteirizar falhou', err);
    res.status(500).json({ error: 'IA failed', detail: String(err?.message || err) });
  }
});

// [THROWAWAY] testa o Whisper em prod e DEVOLVE o status HTTP exato (401/429/400).
router.get('/social/_test-whisper', async (_req: Request, res: Response) => {
  try {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return res.json({ ok: false, motivo: 'OPENAI_API_KEY ausente no runtime' });
    const audioRes = await fetch('https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg');
    const buf = await audioRes.arrayBuffer();
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/ogg' }), 'a.ogg');
    form.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
    });
    const body = await r.text();
    res.json({ ok: r.ok, http: r.status, keyLen: key.length, body: body.slice(0, 300) });
  } catch (err: any) {
    res.json({ ok: false, erro: String(err?.message || err).slice(0, 200) });
  }
});

// Estúdio: varredura de virais (Ad Library) — STUB até a Meta liberar.
router.post('/social/varrer', async (_req: Request, res: Response) => {
  res.json(await varrerAdLibrary());
});

// Estúdio: gerar vídeo com avatar (HeyGen) — STUB até configurar HeyGen.
router.post('/social/gerar-video', async (req: Request, res: Response) => {
  res.json(await gerarVideoAvatar(String(req.body?.roteiro || '')));
});

export default router;
