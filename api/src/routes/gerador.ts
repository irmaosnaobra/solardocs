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
    const roteiro = await roteirizarTema(tema, req.body?.fonte_url);
    res.json({ ok: true, roteiro });
  } catch (err: any) {
    logger.error('gerador', 'social/roteirizar falhou', err);
    res.status(500).json({ error: 'IA failed', detail: String(err?.message || err) });
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

// [THROWAWAY] teste: pega transcrição de um vídeo do YouTube do IP da Vercel.
// Valida se o YouTube libera legenda do datacenter (não do meu IP local).
router.get('/social/_test-transcript', async (req: Request, res: Response) => {
  const vid = String(req.query.v || '');
  if (!vid) return res.status(400).json({ error: 'passe ?v=VIDEO_ID' });
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    let t;
    try { t = await YoutubeTranscript.fetchTranscript(vid, { lang: 'pt-BR' } as any); }
    catch { t = await YoutubeTranscript.fetchTranscript(vid); }
    const txt = t.map((x: any) => x.text).join(' ');
    res.json({ ok: true, chars: txt.length, preview: txt.slice(0, 300) });
  } catch (err: any) {
    res.json({ ok: false, erro: String(err?.message || err).slice(0, 200) });
  }
});

export default router;
