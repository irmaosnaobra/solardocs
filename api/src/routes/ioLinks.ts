import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { logger } from '../utils/logger';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────
// PÚBLICO — a página estática /io/links (link na bio, estilo Linktree) lê isso.
// Chamada via rewrite /_api/io-links do dashboard (mesma origem, sem CORS).
// Retorna SÓ os botões ativos, na ordem definida no editor.
// ──────────────────────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('io_links')
      .select('id, section, label, url, icon, featured, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    res.json({ ok: true, links: data ?? [] });
  } catch (err: any) {
    logger.error('io-links', 'list público falhou', err);
    res.status(500).json({ error: 'failed', detail: String(err?.message || err) });
  }
});

// Contador de cliques server-side. Best-effort: a página dispara via sendBeacon
// e nunca espera resposta — então mesmo se falhar, o usuário já navegou.
router.post('/:id/click', async (req: Request, res: Response) => {
  try {
    await supabase.rpc('increment_io_link_click', { link_id: req.params.id });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // nunca quebra a navegação do visitante
  }
});

// ──────────────────────────────────────────────────────────────────────────
// ADMIN — editor dos botões (só aiorosgroup). authMiddleware + adminMiddleware.
// ──────────────────────────────────────────────────────────────────────────

// Lista TUDO (inclusive inativos) pro editor.
router.get('/admin', authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('io_links')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, links: data ?? [] });
  } catch (err: any) {
    logger.error('io-links', 'list admin falhou', err);
    res.status(500).json({ error: 'failed', detail: String(err?.message || err) });
  }
});

router.post('/admin', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { section, label, url, icon, featured, active, sort_order } = req.body || {};
    if (!label?.trim() || !url?.trim()) {
      return res.status(400).json({ error: 'label e url são obrigatórios' });
    }
    const { data, error } = await supabase
      .from('io_links')
      .insert({
        section: section?.trim() || null,
        label: label.trim(),
        url: url.trim(),
        icon: icon?.trim() || '',
        featured: !!featured,
        active: active === undefined ? true : !!active,
        sort_order: Number.isFinite(sort_order) ? sort_order : 999,
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, link: data });
  } catch (err: any) {
    logger.error('io-links', 'create falhou', err);
    res.status(500).json({ error: 'failed', detail: String(err?.message || err) });
  }
});

router.put('/admin/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { section, label, url, icon, featured, active, sort_order } = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (section !== undefined) patch.section = section?.trim() || null;
    if (label !== undefined) patch.label = label.trim();
    if (url !== undefined) patch.url = url.trim();
    if (icon !== undefined) patch.icon = icon?.trim() || '';
    if (featured !== undefined) patch.featured = !!featured;
    if (active !== undefined) patch.active = !!active;
    if (sort_order !== undefined && Number.isFinite(sort_order)) patch.sort_order = sort_order;

    const { data, error } = await supabase
      .from('io_links')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, link: data });
  } catch (err: any) {
    logger.error('io-links', 'update falhou', err);
    res.status(500).json({ error: 'failed', detail: String(err?.message || err) });
  }
});

router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('io_links').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('io-links', 'delete falhou', err);
    res.status(500).json({ error: 'failed', detail: String(err?.message || err) });
  }
});

export default router;
