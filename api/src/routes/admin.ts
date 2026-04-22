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

// ── CRM Plataforma — status dinâmico baseado em comportamento real ─
router.get('/platform-crm', async (req: Request, res: Response) => {
  try {
    const cutoff2d = new Date(Date.now() - 2 * 86400000).toISOString();

    // Todos os usuários
    const { data: users } = await supabase
      .from('users')
      .select('id, email, whatsapp, plano, documentos_usados, created_at')
      .order('created_at', { ascending: false });

    if (!users?.length) { res.json({ columns: {} }); return; }

    // Usuários COM empresa cadastrada
    const { data: companies } = await supabase
      .from('company')
      .select('user_id, nome, cnpj');
    const companySet = new Set((companies ?? []).map((c: any) => c.user_id));
    const companyMap = Object.fromEntries((companies ?? []).map((c: any) => [c.user_id, c]));

    // Usuários que geraram doc nos últimos 2 dias
    const { data: recentDocs } = await supabase
      .from('documents')
      .select('user_id')
      .gte('created_at', cutoff2d);
    const recentSet = new Set((recentDocs ?? []).map((d: any) => d.user_id));

    // Classifica cada usuário
    const columns: Record<string, any[]> = {
      sem_cnpj: [], desativado: [], ativo: [], pro: [], vip: [],
    };

    for (const u of users) {
      const company = companyMap[u.id];
      const hasCompany = companySet.has(u.id);
      const recentActive = recentSet.has(u.id);

      const card = {
        id: u.id,
        email: u.email,
        whatsapp: u.whatsapp,
        plano: u.plano,
        empresa: company?.nome ?? null,
        cnpj: company?.cnpj ?? null,
        documentos_usados: u.documentos_usados,
        created_at: u.created_at,
        ativo_recente: recentActive,
      };

      if (u.plano === 'ilimitado') {
        columns.vip.push(card);
      } else if (u.plano === 'pro') {
        columns.pro.push(card);
      } else if (!hasCompany) {
        columns.sem_cnpj.push(card);
      } else if (recentActive) {
        columns.ativo.push(card);
      } else {
        columns.desativado.push(card);
      }
    }

    res.json({ columns });
  } catch (err) {
    console.error('platform-crm error:', err);
    res.status(500).json({ error: 'Erro ao buscar plataforma CRM' });
  }
});

export default router;
