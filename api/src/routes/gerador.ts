import { Router, Request, Response } from 'express';
import { generateGeradorPdf } from '../controllers/pdfGeradorController';
import { trackEvent } from '../controllers/trackingGeradorController';
import { gerarIdeiasSociais } from '../services/agenda/socialIdeiasService';
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

export default router;
