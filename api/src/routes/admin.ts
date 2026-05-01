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
const SDR_ESTAGIOS = ['reativacao','novo','frio','morno','quente','perdido','fechamento'];

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

    // Se for fechamento, dispara Purchase no Meta
    if (estagio === 'fechamento') {
      const { data: lead } = await supabase.from('sdr_leads').select('ctwa_clid').eq('phone', phone).single();
      if (lead?.ctwa_clid) {
        const { sendMetaEvent } = await import('../utils/metaPixel');
        await sendMetaEvent('Purchase', {
          customData: { ctwa_clid: lead.ctwa_clid, value: 0, currency: 'BRL' } // O valor pode ser ajustado depois
        }).catch(console.error);
      }
    }

    await supabase.from('sdr_leads').update({ estagio, updated_at: new Date().toISOString() }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

// Toggle human_takeover de um lead. Use pra "devolver pra Luma" (false) ou
// "assumir manualmente sem precisar mandar mensagem" (true).
router.patch('/sdr-leads/:phone/takeover', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { takeover } = req.body;
    const update: any = {
      human_takeover: !!takeover,
      updated_at: new Date().toISOString(),
    };
    if (takeover) update.human_takeover_at = new Date().toISOString();
    else update.human_takeover_at = null;
    await supabase.from('sdr_leads').update(update).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atualizar takeover' }); }
});

// Importa lista em massa de leads pra reativação. Aceita lista de objetos
// { nome, phone, cidade? }. Cria com estagio='reativacao', lead_origem='reativacao'.
// Cron horário processa em horário comercial respeitando meta de 50/dia.
router.post('/sdr-leads/import', async (req: Request, res: Response) => {
  try {
    const { leads } = (req.body as any) ?? {};
    if (!Array.isArray(leads) || leads.length === 0) {
      res.status(400).json({ error: 'leads deve ser array não-vazio' }); return;
    }
    const rows: any[] = [];
    const ignored: any[] = [];
    for (const l of leads) {
      const phone = String(l.phone || '').replace(/\D/g, '');
      const nome = String(l.nome || '').trim() || null;
      const cidade = l.cidade ? String(l.cidade).trim() : null;
      if (phone.length < 10 || phone.length > 13) {
        ignored.push({ phone: l.phone, nome, motivo: 'phone inválido' });
        continue;
      }
      // Normaliza pra formato BR com 55 prefixo
      const normalized = phone.startsWith('55') ? phone : `55${phone}`;
      rows.push({
        phone: normalized,
        nome,
        cidade,
        estagio: 'reativacao',
        lead_origem: 'reativacao',
        instance: 'io',
        aguardando_resposta: false,
        total_mensagens: 0,
        contatos: 0,
        reativacao_tentativas: 0,
      });
    }

    // upsert — se phone já existe, NÃO sobrescreve estágio (preserva leads ativos)
    const { data: existentes } = await supabase
      .from('sdr_leads')
      .select('phone, estagio')
      .in('phone', rows.map(r => r.phone));
    const existeSet = new Set((existentes || []).map((r: any) => r.phone));
    const novos = rows.filter(r => !existeSet.has(r.phone));
    const dups = rows.length - novos.length;

    if (novos.length > 0) {
      const { error } = await supabase.from('sdr_leads').insert(novos);
      if (error) { res.status(500).json({ error: error.message }); return; }
    }

    res.json({
      ok: true,
      total_recebidos: leads.length,
      inseridos: novos.length,
      duplicados: dups,
      invalidos: ignored.length,
      ignored,
    });
  } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

// Atualiza valor da venda (pra fechados ou quando agendar)
router.patch('/sdr-leads/:phone/valor-venda', async (req: Request, res: Response) => {
  try {
    const phone = String(req.params.phone || '');
    const valorRaw = (req.body as any)?.valor;
    const valor = valorRaw === null || valorRaw === '' ? null : Number(valorRaw);
    if (valor !== null && (isNaN(valor) || valor < 0)) {
      res.status(400).json({ error: 'valor inválido' }); return;
    }
    await supabase.from('sdr_leads').update({
      valor_venda: valor,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao salvar valor' }); }
});

// Atribui consultor responsável pelo lead
const CONSULTORES = ['diego', 'giovanna', 'nilce', 'thiago'];
router.patch('/sdr-leads/:phone/consultor', async (req: Request, res: Response) => {
  try {
    const phone = String(req.params.phone || '');
    const { consultor } = (req.body as any) ?? {};
    if (consultor !== null && consultor !== '' && !CONSULTORES.includes(consultor)) {
      res.status(400).json({ error: 'Consultor inválido' }); return;
    }
    await supabase.from('sdr_leads').update({
      consultor: consultor || null,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atribuir consultor' }); }
});

// Métricas do CRM — KPIs do topo da página
router.get('/sdr-metrics', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7); startOfWeek.setHours(0,0,0,0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const next24h = new Date(now.getTime() + 24*60*60*1000);

    const [
      totalRes, hojeRes, semanaRes, mesRes,
      quenteRes, fechamentoRes, frioRes, perdidoRes,
      agendadosRes, takeoverRes,
    ] = await Promise.all([
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).gte('created_at', startOfDay.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).gte('created_at', startOfWeek.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('estagio', 'quente'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('estagio', 'fechamento'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('estagio', 'frio'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('estagio', 'perdido'),
      supabase.from('sdr_leads').select('phone, nome, horario_iso, canal_atendimento, horario_atendimento, cidade')
        .gte('horario_iso', now.toISOString()).lte('horario_iso', next24h.toISOString())
        .order('horario_iso', { ascending: true }),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('human_takeover', true),
    ]);

    const total = totalRes.count ?? 0;
    const fechados = fechamentoRes.count ?? 0;
    const conversao = total > 0 ? (fechados / total) * 100 : 0;

    res.json({
      total,
      hoje: hojeRes.count ?? 0,
      semana: semanaRes.count ?? 0,
      mes: mesRes.count ?? 0,
      por_estagio: {
        quente: quenteRes.count ?? 0,
        fechamento: fechamentoRes.count ?? 0,
        frio: frioRes.count ?? 0,
        perdido: perdidoRes.count ?? 0,
      },
      conversao_pct: Number(conversao.toFixed(1)),
      agendados_24h: agendadosRes.data ?? [],
      em_takeover: takeoverRes.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar métricas', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Histórico completo da conversa do lead
router.get('/sdr-leads/:phone/history', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { data, error } = await supabase
      .from('whatsapp_sessions').select('messages, nome, updated_at')
      .eq('phone', phone).eq('tipo', 'sdr').single();
    if (error) { res.json({ messages: [], nome: null }); return; }
    res.json({ messages: data?.messages || [], nome: data?.nome });
  } catch { res.status(500).json({ error: 'Erro ao buscar histórico' }); }
});

// Notas internas
router.patch('/sdr-leads/:phone/notas', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { notas } = req.body;
    await supabase.from('sdr_leads').update({
      notas_internas: notas || null,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao salvar nota' }); }
});

// Tags
router.patch('/sdr-leads/:phone/tags', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { tags } = req.body;
    if (!Array.isArray(tags)) { res.status(400).json({ error: 'tags deve ser array' }); return; }
    await supabase.from('sdr_leads').update({
      tags: tags.map(String).filter(Boolean).slice(0, 20),
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao salvar tags' }); }
});

// Mandar mensagem manual pelo CRM (marca takeover automaticamente)
router.post('/sdr-leads/:phone/send-message', async (req: Request, res: Response) => {
  try {
    const phone = String(req.params.phone || '');
    const messageRaw = (req.body as any)?.message;
    if (!messageRaw || typeof messageRaw !== 'string' || messageRaw.trim().length === 0) {
      res.status(400).json({ error: 'message obrigatório' }); return;
    }
    const message: string = messageRaw;
    const { data: lead } = await supabase.from('sdr_leads').select('instance').eq('phone', phone).single();
    const instance = (lead?.instance === 'io' ? 'io' : 'solardoc') as 'io' | 'solardoc';
    const { sendWhatsApp } = await import('../services/agents/zapiClient');
    await sendWhatsApp(phone, message.trim(), instance);

    // Marca takeover (humano enviou mensagem, Luma pausa)
    await supabase.from('sdr_leads').update({
      human_takeover: true,
      human_takeover_at: new Date().toISOString(),
      ultima_mensagem: message.slice(0, 300),
      ultimo_contato: new Date().toISOString(),
      aguardando_resposta: false,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);

    // Anexa no histórico
    const { data: session } = await supabase.from('whatsapp_sessions')
      .select('messages').eq('phone', phone).eq('tipo', 'sdr').single();
    const oldMessages = (session?.messages as any[]) || [];
    await supabase.from('whatsapp_sessions').upsert({
      phone, tipo: 'sdr',
      messages: [...oldMessages, { role: 'assistant', content: `[humano] ${message}` }].slice(-80),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone,tipo' });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro ao enviar', detail: err instanceof Error ? err.message : String(err) }); }
});

// Cancela agendamento (mantém lead vivo)
router.post('/sdr-leads/:phone/cancel-schedule', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    await supabase.from('sdr_leads').update({
      canal_atendimento: null,
      horario_atendimento: null,
      horario_iso: null,
      agendado_at: null,
      lembrete_enviado_at: null,
      endereco_vistoria: null,
      estagio: 'morno',
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao cancelar' }); }
});

// Força próximo follow-up agora (independente da cadência)
router.post('/sdr-leads/:phone/force-followup', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    // Reseta ultimo_contato pra muito atrás → cron vai disparar próximo toque
    const old = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    await supabase.from('sdr_leads').update({
      ultimo_contato: old,
      aguardando_resposta: true,
      human_takeover: false,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true, message: 'Próximo follow-up sairá no próximo cron (~1 min)' });
  } catch { res.status(500).json({ error: 'Erro' }); }
});

// IA gera análise resumida + próxima ação sugerida
router.get('/sdr-leads/:phone/insights', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { data: lead } = await supabase.from('sdr_leads').select('*').eq('phone', phone).single();
    const { data: session } = await supabase.from('whatsapp_sessions')
      .select('messages').eq('phone', phone).eq('tipo', 'sdr').single();
    if (!lead) { res.status(404).json({ error: 'lead não encontrado' }); return; }

    const messages = (session?.messages as any[]) || [];
    const historico = messages.slice(-30).map((m: any) =>
      `${m.role === 'user' ? 'Lead' : 'Luma'}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`
    ).join('\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `Você é analista comercial sênior. Recebe contexto de um lead de energia solar e gera 3 coisas em JSON:
{
  "resumo": "1 frase descrevendo o lead em até 25 palavras",
  "score": número de 0-100 (probabilidade de fechar),
  "proxima_acao": "ação concreta sugerida em 1 frase imperativa"
}
Apenas JSON, sem markdown.`,
      messages: [{ role: 'user', content: `Lead: ${lead.nome || 'Sem nome'} | Cidade: ${lead.cidade || '—'} | Estágio: ${lead.estagio} | Agendamento: ${lead.canal_atendimento || 'nenhum'}\n\nConversa:\n${historico}` }],
    });
    const txt = (r.content[0] as { text: string }).text.trim();
    const cleaned = txt.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    let parsed: any;
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = { resumo: txt.slice(0, 200), score: null, proxima_acao: null }; }
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: 'Erro IA', detail: err instanceof Error ? err.message : String(err) }); }
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
