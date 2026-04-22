import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { getUsers, triggerMonthlyReset, getVisits, getAnalytics, getMetaFunnel } from '../controllers/adminController';
import { supabase } from '../utils/supabase';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users',          getUsers);
router.post('/reset-monthly', triggerMonthlyReset);
router.get('/visits',         getVisits);
router.get('/analytics',      getAnalytics);
router.get('/meta-funnel',    getMetaFunnel);

// ── CRM SDR Leads ─────────────────────────────────────────────────
router.get('/sdr-leads', async (req: Request, res: Response) => {
  try {
    const temp = req.query.temperatura as string | undefined;
    let query = supabase
      .from('sdr_leads')
      .select('*')
      .order('updated_at', { ascending: false });

    if (temp && ['frio','morno','quente'].includes(temp)) {
      query = query.eq('temperatura', temp);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ leads: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar leads' });
  }
});

router.patch('/sdr-leads/:phone/temperatura', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { temperatura } = req.body;
    if (!['frio','morno','quente'].includes(temperatura)) {
      res.status(400).json({ error: 'Temperatura inválida' }); return;
    }
    await supabase.from('sdr_leads').update({ temperatura, updated_at: new Date().toISOString() }).eq('phone', phone);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

export default router;
