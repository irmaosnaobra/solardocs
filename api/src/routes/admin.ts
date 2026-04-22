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

// ── CRM Plataforma — status dinâmico + override manual ────────────
router.get('/platform-crm', async (req: Request, res: Response) => {
  try {
    const cutoff2d = new Date(Date.now() - 2 * 86400000).toISOString();

    const { data: users } = await supabase
      .from('users')
      .select('id, email, whatsapp, plano, documentos_usados, created_at, crm_estagio')
      .order('created_at', { ascending: false });

    if (!users?.length) { res.json({ columns: {} }); return; }

    const { data: companies } = await supabase.from('company').select('user_id, nome, cnpj');
    const companySet = new Set((companies ?? []).map((c: any) => c.user_id));
    const companyMap = Object.fromEntries((companies ?? []).map((c: any) => [c.user_id, c]));

    const { data: recentDocs } = await supabase.from('documents').select('user_id').gte('created_at', cutoff2d);
    const recentSet = new Set((recentDocs ?? []).map((d: any) => d.user_id));

    const columns: Record<string, any[]> = { sem_cnpj: [], desativado: [], ativo: [], pro: [], vip: [] };

    for (const u of users) {
      const company = companyMap[u.id];
      const hasCompany = companySet.has(u.id);
      const recentActive = recentSet.has(u.id);

      const card = {
        id: u.id, email: u.email, whatsapp: u.whatsapp, plano: u.plano,
        empresa: company?.nome ?? null, cnpj: company?.cnpj ?? null,
        documentos_usados: u.documentos_usados, created_at: u.created_at,
        ativo_recente: recentActive, crm_estagio: u.crm_estagio,
      };

      // Override manual tem prioridade sobre classificação automática
      const estagio = u.crm_estagio ?? (
        u.plano === 'ilimitado' ? 'vip' :
        u.plano === 'pro'       ? 'pro' :
        !hasCompany             ? 'sem_cnpj' :
        recentActive            ? 'ativo' : 'desativado'
      );

      (columns[estagio] ??= []).push(card);
    }

    res.json({ columns });
  } catch (err) {
    console.error('platform-crm error:', err);
    res.status(500).json({ error: 'Erro ao buscar plataforma CRM' });
  }
});

// Move usuário da plataforma para coluna manual
router.patch('/platform-crm/:id/estagio', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estagio } = req.body;
    const valid = ['sem_cnpj','desativado','ativo','pro','vip'];
    if (!valid.includes(estagio)) { res.status(400).json({ error: 'Estágio inválido' }); return; }
    await supabase.from('users').update({ crm_estagio: estagio }).eq('id', id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao mover lead' }); }
});

// Reseta override (volta para classificação automática)
router.delete('/platform-crm/:id/estagio', async (req: Request, res: Response) => {
  try {
    await supabase.from('users').update({ crm_estagio: null }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao resetar' }); }
});

// Move lead da plataforma para o SDR Solar
router.post('/platform-crm/:id/para-sdr', async (req: Request, res: Response) => {
  try {
    const { data: user } = await supabase.from('users').select('id, email, whatsapp').eq('id', req.params.id).single();
    if (!user?.whatsapp) { res.status(400).json({ error: 'Usuário sem WhatsApp' }); return; }
    await supabase.from('sdr_leads').upsert({
      phone: user.whatsapp.replace(/\D/g,''),
      nome: null,
      estagio: 'novo',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao mover para SDR' }); }
});

export default router;
