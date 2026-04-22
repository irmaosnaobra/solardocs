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

// ── CRM SDR Leads (Solar B2C) ─────────────────────────────────────
const SDR_ESTAGIOS = ['novo','frio','morno','quente','perdido','fechamento'];

router.get('/sdr-leads', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('sdr_leads').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ leads: data ?? [] });
  } catch { res.status(500).json({ error: 'Erro ao buscar leads SDR' }); }
});

router.patch('/sdr-leads/:phone/estagio', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { estagio } = req.body;
    if (!SDR_ESTAGIOS.includes(estagio)) { res.status(400).json({ error: 'Estágio inválido' }); return; }
    await supabase.from('sdr_leads').update({ estagio, updated_at: new Date().toISOString() }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

// ── CRM Plataforma (SolarDoc B2B) ────────────────────────────────
const PLAT_ESTAGIOS = ['novo','ativo','interessado','negociando','perdido','cliente'];

router.get('/platform-crm', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('platform_crm').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ leads: data ?? [] });
  } catch { res.status(500).json({ error: 'Erro ao buscar leads plataforma' }); }
});

router.post('/platform-crm', async (req: Request, res: Response) => {
  try {
    const { nome, email, phone, user_id, estagio, nota } = req.body;
    const { data, error } = await supabase.from('platform_crm').insert({
      nome, email, phone, user_id: user_id || null,
      estagio: estagio || 'novo', nota: nota || null,
    }).select().single();
    if (error) throw error;
    res.json({ lead: data });
  } catch { res.status(500).json({ error: 'Erro ao criar lead' }); }
});

router.patch('/platform-crm/:id/estagio', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estagio, nota } = req.body;
    if (!PLAT_ESTAGIOS.includes(estagio)) { res.status(400).json({ error: 'Estágio inválido' }); return; }
    const upd: any = { estagio, updated_at: new Date().toISOString() };
    if (nota !== undefined) upd.nota = nota;
    await supabase.from('platform_crm').update(upd).eq('id', id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

export default router;
