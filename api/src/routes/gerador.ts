import { Router, Request, Response } from 'express';
import { generateGeradorPdf } from '../controllers/pdfGeradorController';
import { trackEvent } from '../controllers/trackingGeradorController';
import { gerarIdeiasSociais, roteirizarTema, roteirizarUpload } from '../services/agenda/socialIdeiasService';
import { varrerAdLibrary, gerarVideoAvatar } from '../services/agenda/socialStudioStubs';
import { gerarProdutosVirais, redispararVideoProduto } from '../services/agenda/produtosViraisService';
import { processarWebhook } from '../services/agenda/higgsfieldService';
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

// Estúdio: roteiriza a partir de um vídeo enviado (URL no Storage) — transcreve via Whisper.
router.post('/social/roteirizar-upload', async (req: Request, res: Response) => {
  try {
    const videoUrl = String(req.body?.video_url || '').trim();
    if (!videoUrl) return res.status(400).json({ error: 'video_url obrigatório' });
    const r = await roteirizarUpload(videoUrl, req.body?.apresentador);
    if (r && (r as any).erro) return res.json({ ok: true, roteiro: null, motivo: (r as any).erro });
    res.json({ ok: true, roteiro: r });
  } catch (err: any) {
    logger.error('gerador', 'social/roteirizar-upload falhou', err);
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

// Máquina 2: TOP 1 produto viral do dia → roteiro → dispara vídeo automático no
// Higgsfield (sem aprovação). Disparável manual (botão) e pelo cron (8h30 BRT).
router.post('/social/produtos-virais', async (_req: Request, res: Response) => {
  try {
    const r = await gerarProdutosVirais();
    res.json({ ok: true, ...r });
  } catch (err: any) {
    logger.error('gerador', 'produtos-virais falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
  }
});

// Webhook do Higgsfield: chamado por eles quando o vídeo fica pronto. Responde
// 200 rápido. A função casa pelo request_id e só toca linha existente (defesa
// contra POST externo). Não tem auth pesada de propósito (Higgsfield não assina).
router.post('/social/higgsfield-webhook', async (req: Request, res: Response) => {
  try {
    const r = await processarWebhook(req.body || {});
    res.json({ ok: r.ok });
  } catch (err: any) {
    logger.error('gerador', 'higgsfield-webhook falhou', err);
    res.status(200).json({ ok: false }); // 200 mesmo no erro: não queremos retry agressivo
  }
});

// Re-dispara o vídeo de uma linha de produto (botão "Tentar de novo" no front).
router.post('/social/produto-regerar', async (req: Request, res: Response) => {
  try {
    const id = Number(req.body?.id);
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const r = await redispararVideoProduto(id);
    res.json({ ...r });
  } catch (err: any) {
    logger.error('gerador', 'produto-regerar falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
  }
});

export default router;
