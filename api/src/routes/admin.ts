import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { getUsers, triggerMonthlyReset, getVisits, getAnalytics, getMetaFunnel, getFunnel } from '../controllers/adminController';
import { supabase } from '../utils/supabase';

const router = Router();

// Endpoint /admin/users/delete-bootstrap aceita ?key=ZAPI_IO_2026_BOOTSTRAP pra
// disparo de manutencao via curl (sem precisar token de admin). DEFINIDO ANTES
// dos middlewares pra pular auth.
router.post('/users/delete-bootstrap', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== 'ZAPI_IO_2026_BOOTSTRAP') { res.status(403).json({ error: 'forbidden' }); return; }
  try {
    const { email, cnpj } = req.body as { email?: string; cnpj?: string };
    if (!email && !cnpj) { res.status(400).json({ error: 'Informe email ou cnpj' }); return; }

    let userId: string | null = null;
    let userEmail: string | null = null;

    if (cnpj) {
      const cleanCnpj = cnpj.replace(/\D/g, '');
      const { data: comp } = await supabase
        .from('company')
        .select('user_id')
        .or(`cnpj.eq.${cnpj},cnpj.eq.${cleanCnpj}`)
        .maybeSingle();
      if (!comp) { res.status(404).json({ error: 'Empresa com esse CNPJ não encontrada' }); return; }
      userId = comp.user_id;
    } else if (email) {
      const { data: u } = await supabase.from('users').select('id, email').eq('email', email).maybeSingle();
      if (!u) { res.status(404).json({ error: 'User com esse email não encontrado' }); return; }
      userId = u.id;
      userEmail = u.email;
    }
    if (!userId) { res.status(404).json({ error: 'User não encontrado' }); return; }

    if (!userEmail) {
      const { data: u } = await supabase.from('users').select('email').eq('id', userId).single();
      userEmail = u?.email ?? null;
    }

    const deleted: Record<string, number> = {};
    for (const t of ['documents', 'clients', 'terceiros', 'company']) {
      const { count } = await supabase.from(t).delete({ count: 'exact' }).eq('user_id', userId);
      deleted[t] = count || 0;
    }
    const { count: usersCount } = await supabase.from('users').delete({ count: 'exact' }).eq('id', userId);
    deleted.users = usersCount || 0;

    res.json({ ok: true, user_id: userId, email: userEmail, deleted });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar user', message: String(err) });
  }
});

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users',          getUsers);
router.post('/reset-monthly', triggerMonthlyReset);
router.get('/visits',         getVisits);
router.get('/analytics',      getAnalytics);
router.get('/meta-funnel',    getMetaFunnel);
router.get('/funnel',         getFunnel);

// Deletar user (cascade manual). Aceita { email } OU { cnpj } no body.
// Apaga: documents, clients, terceiros, company, e o user.
router.post('/users/delete', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, cnpj } = req.body as { email?: string; cnpj?: string };
    if (!email && !cnpj) {
      res.status(400).json({ error: 'Informe email ou cnpj' });
      return;
    }

    let userId: string | null = null;
    let userEmail: string | null = null;

    if (cnpj) {
      const cleanCnpj = cnpj.replace(/\D/g, '');
      const { data: comp } = await supabase
        .from('company')
        .select('user_id')
        .or(`cnpj.eq.${cnpj},cnpj.eq.${cleanCnpj}`)
        .maybeSingle();
      if (!comp) { res.status(404).json({ error: 'Empresa com esse CNPJ não encontrada' }); return; }
      userId = comp.user_id;
    } else if (email) {
      const { data: u } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', email)
        .maybeSingle();
      if (!u) { res.status(404).json({ error: 'User com esse email não encontrado' }); return; }
      userId = u.id;
      userEmail = u.email;
    }

    if (!userId) { res.status(404).json({ error: 'User não encontrado' }); return; }

    if (!userEmail) {
      const { data: u } = await supabase.from('users').select('email').eq('id', userId).single();
      userEmail = u?.email ?? null;
    }

    // Delete em ordem (FK constraints)
    const deleted: Record<string, number> = {};
    const tabelas = ['documents', 'clients', 'terceiros', 'company'];
    for (const t of tabelas) {
      const { count } = await supabase.from(t).delete({ count: 'exact' }).eq('user_id', userId);
      deleted[t] = count || 0;
    }
    const { count: usersCount } = await supabase.from('users').delete({ count: 'exact' }).eq('id', userId);
    deleted.users = usersCount || 0;

    res.json({ ok: true, user_id: userId, email: userEmail, deleted });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar user', message: String(err) });
  }
});

// ── CRM SDR Leads (Solar B2C) ─────────────────────────────────────
const SDR_ESTAGIOS = ['reativacao','novo','frio','morno','quente','perdido','fechamento'];

router.get('/sdr-leads', async (req: Request, res: Response) => {
  try {
    // Supabase REST tem default de 1000 rows. Subimos pra 5000 pra evitar
    // que leads quentes/em-atendimento sumam quando ha muitos em reativacao.
    const { data, error } = await supabase
      .from('sdr_leads').select('*')
      .order('updated_at', { ascending: false })
      .limit(5000);
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
    // Calcula início de dia/mês/ano em horário de Brasília (UTC-3)
    // 00:00 BRT = 03:00 UTC. Servidor Vercel roda em UTC.
    const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const startOfDay = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate(), 3, 0, 0));
    const startOfMonth = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), 1, 3, 0, 0));
    const startOfYear = new Date(Date.UTC(brtNow.getUTCFullYear(), 0, 1, 3, 0, 0));
    const next24h = new Date(now.getTime() + 24*60*60*1000);

    // CRM Solar foca apenas na linha 'io' (Irmãos na Obra)
    const [
      totalRes, hojeRes, mesRes,
      quenteRes, fechamentoRes, fechamentoMesRes, frioRes, perdidoRes,
      agendadosRes, takeoverRes,
      vendidoMesRes, vendidoAnoRes,
    ] = await Promise.all([
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').gte('created_at', startOfDay.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').gte('created_at', startOfMonth.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'quente'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'fechamento'),
      // Fechamentos no mês corrente (updated_at = quando foi marcado fechamento)
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'fechamento').gte('updated_at', startOfMonth.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'frio'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'perdido'),
      supabase.from('sdr_leads').select('phone, nome, horario_iso, canal_atendimento, horario_atendimento, cidade')
        .eq('instance', 'io')
        .gte('horario_iso', now.toISOString()).lte('horario_iso', next24h.toISOString())
        .order('horario_iso', { ascending: true }),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('human_takeover', true),
      // Valor vendido acumulado MÊS (linha IO, fechados no mês corrente)
      supabase.from('sdr_leads').select('valor_venda').eq('instance', 'io').eq('estagio', 'fechamento').not('valor_venda', 'is', null).gte('updated_at', startOfMonth.toISOString()),
      // Valor vendido acumulado ANO (linha IO, fechados no ano corrente)
      supabase.from('sdr_leads').select('valor_venda').eq('instance', 'io').eq('estagio', 'fechamento').not('valor_venda', 'is', null).gte('updated_at', startOfYear.toISOString()),
    ]);

    const total = totalRes.count ?? 0;
    const fechadosMes = fechamentoMesRes.count ?? 0;
    // Conversão mensal: fechamentos do mês / total do pipeline
    const conversao = total > 0 ? (fechadosMes / total) * 100 : 0;

    // Soma valor vendido acumulado
    const somaVendidoMes = (vendidoMesRes.data ?? []).reduce((acc: number, r: any) => acc + (Number(r.valor_venda) || 0), 0);
    const somaVendidoAno = (vendidoAnoRes.data ?? []).reduce((acc: number, r: any) => acc + (Number(r.valor_venda) || 0), 0);

    res.json({
      total,
      hoje: hojeRes.count ?? 0,
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
      valor_vendido_mes: somaVendidoMes,
      valor_vendido_ano: somaVendidoAno,
      meta_mes: 220000,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar métricas', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Exclui lead SDR + sessão de conversa (whatsapp_sessions)
router.delete('/sdr-leads/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    if (!phone) { res.status(400).json({ error: 'phone obrigatório' }); return; }
    await supabase.from('whatsapp_sessions').delete().eq('phone', phone).eq('tipo', 'sdr');
    const { error } = await supabase.from('sdr_leads').delete().eq('phone', phone);
    if (error) { res.status(500).json({ error: 'Erro ao excluir' }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao excluir' }); }
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

// ── Disparos IO (broadcast WhatsApp via linha Irmãos na Obra) ──────────
// /admin/io/humanize — IA reformula mensagem-base para soar humano
// /admin/io/send-text — envia texto via Z-API IO (autenticado, sem bootstrap key)
router.post('/io/humanize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { base, context } = req.body as { base?: string; context?: string };
    if (!base || typeof base !== 'string') { res.status(400).json({ error: 'base obrigatorio' }); return; }
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurado' }); return; }

    const anthropic = new Anthropic({ apiKey: key });
    const ctx = (context || '').trim();
    const systemPrompt = [
      'Voce reformula uma mensagem-base do WhatsApp para soar como um humano brasileiro real escrevendo, nao como robo.',
      'Regras absolutas:',
      '- Mantenha o significado e a intencao da mensagem-base.',
      '- Frases curtas, naturais, coloquiais.',
      '- NUNCA use travessao (—) nem em-dash. Use virgula, ponto, ou simplesmente quebre a frase.',
      '- Sem emoji.',
      '- Variar sutilmente entre reformulacoes: ora "tudo bem?", ora vai direto; ora "Boa tarde", ora "Oi".',
      '- Nao adicione informacao nova que nao esteja na base.',
      '- Saida: APENAS a mensagem reformulada, sem aspas, sem prefixo, sem explicacao.',
      '',
      'Exemplo de reformulacao no tom certo:',
      'Base: Boa tarde, aqui e a Giovanna',
      'Saida: Boa tarde, e a Giovanna falando',
      ctx ? `\nContexto adicional do disparo: ${ctx}` : '',
    ].filter(Boolean).join('\n');

    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0.9,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Mensagem-base: ${base}\n\nReformule.` }],
    });
    const c = r.content[0];
    const text = c?.type === 'text' ? c.text.trim().replace(/^["']|["']$/g, '') : base;
    res.json({ message: text || base });
  } catch (err) {
    res.status(500).json({ error: 'Erro na humanizacao', message: String(err) });
  }
});

router.post('/io/send-text', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, message } = req.body as { phone?: string; message?: string };
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone) { res.status(400).json({ error: 'phone obrigatorio' }); return; }
    if (!message || typeof message !== 'string') { res.status(400).json({ error: 'message obrigatorio' }); return; }

    const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
    const token = process.env.ZAPI_TOKEN_IO?.trim();
    const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
    if (!id || !token || !client) {
      res.status(500).json({ error: 'creds Z-API IO ausentes' });
      return;
    }

    const r = await fetch(`https://api.z-api.io/instances/${id}/token/${token}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': client },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });
    const txt = await r.text();
    let body: unknown;
    try { body = JSON.parse(txt); } catch { body = txt; }
    res.status(r.ok ? 200 : 502).json({ zapi_status: r.status, body });
  } catch (err) {
    res.status(500).json({ error: 'Erro no envio', message: String(err) });
  }
});

// Cria registro de auditoria de um disparo. Retorna id pra cliente referenciar.
router.post('/io/broadcasts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { mensagens, contexto_ai, usou_ia, cadencia_min, cadencia_max, total } = req.body as {
      mensagens?: { slot: number; base: string }[];
      contexto_ai?: string;
      usou_ia?: boolean;
      cadencia_min?: number;
      cadencia_max?: number;
      total?: number;
    };
    if (!Array.isArray(mensagens) || mensagens.length === 0) { res.status(400).json({ error: 'mensagens obrigatorio' }); return; }

    const { data, error } = await supabase.from('io_broadcasts').insert({
      criado_por: req.userId,
      mensagens,
      contexto_ai: contexto_ai ?? null,
      usou_ia: usou_ia ?? true,
      cadencia_min: cadencia_min ?? 4,
      cadencia_max: cadencia_max ?? 8,
      total: total ?? 0,
      status: 'rodando',
    }).select('id').single();
    if (error || !data) { res.status(500).json({ error: 'Erro criando broadcast', detail: error?.message }); return; }
    res.json({ id: data.id });
  } catch (err) {
    res.status(500).json({ error: 'Erro criando broadcast', message: String(err) });
  }
});

// Append de um envio individual à auditoria.
router.post('/io/broadcasts/:id/envios', async (req: Request, res: Response): Promise<void> => {
  try {
    const broadcastId = req.params.id;
    const { phone, slot, mensagem_final, status, zaap_id, message_id, erro } = req.body as {
      phone?: string;
      slot?: number;
      mensagem_final?: string;
      status?: string;
      zaap_id?: string | null;
      message_id?: string | null;
      erro?: string | null;
    };
    if (!phone || !slot || !mensagem_final || !status) {
      res.status(400).json({ error: 'phone, slot, mensagem_final, status obrigatorios' });
      return;
    }
    const { error } = await supabase.from('io_broadcast_envios').insert({
      broadcast_id: broadcastId,
      phone,
      slot,
      mensagem_final,
      status,
      zaap_id: zaap_id ?? null,
      message_id: message_id ?? null,
      erro: erro ?? null,
    });
    if (error) { res.status(500).json({ error: 'Erro inserindo envio', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro append envio', message: String(err) });
  }
});

// Atualiza contadores e status final do broadcast.
router.patch('/io/broadcasts/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const broadcastId = req.params.id;
    const { sucesso, falha, status } = req.body as { sucesso?: number; falha?: number; status?: string };
    const patch: Record<string, unknown> = {};
    if (typeof sucesso === 'number') patch.sucesso = sucesso;
    if (typeof falha === 'number') patch.falha = falha;
    if (status) {
      patch.status = status;
      if (status === 'concluido' || status === 'parado' || status === 'erro') {
        patch.finalizado_em = new Date().toISOString();
      }
    }
    const { error } = await supabase.from('io_broadcasts').update(patch).eq('id', broadcastId);
    if (error) { res.status(500).json({ error: 'Erro atualizando broadcast', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro patch broadcast', message: String(err) });
  }
});

// Lista os últimos N broadcasts (default 20).
router.get('/io/broadcasts', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { data, error } = await supabase
      .from('io_broadcasts')
      .select('id, criado_em, mensagens, total, sucesso, falha, status, finalizado_em, usou_ia, cadencia_min, cadencia_max')
      .order('criado_em', { ascending: false })
      .limit(limit);
    if (error) { res.status(500).json({ error: 'Erro listando broadcasts', detail: error.message }); return; }
    res.json({ broadcasts: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro list broadcasts', message: String(err) });
  }
});

// ── Lead Extractor (Google Places Text Search New API) ────────────
// /admin/leads/google/search   POST  { query, max_pages? } → busca + persiste
// /admin/leads/google/searches GET   lista buscas anteriores
// /admin/leads/google/searches/:id GET  retorna leads da busca
// /admin/leads/google/searches/:id DELETE  remove busca + leads
interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
}

router.post('/leads/google/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, max_pages } = req.body as { query?: string; max_pages?: number };
    const q = (query || '').trim();
    if (!q) { res.status(400).json({ error: 'query obrigatoria' }); return; }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    const pages = Math.max(1, Math.min(Number(max_pages) || 3, 3));
    const fieldMask = [
      'places.id', 'places.displayName', 'places.formattedAddress',
      'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
      'places.websiteUri', 'places.rating', 'places.userRatingCount',
      'places.types', 'places.location',
      'nextPageToken',
    ].join(',');

    const allPlaces: GooglePlace[] = [];
    let nextPageToken: string | undefined;

    for (let page = 0; page < pages; page++) {
      const body: Record<string, unknown> = {
        textQuery: q,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        pageSize: 20,
      };
      if (nextPageToken) body.pageToken = nextPageToken;

      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        res.status(502).json({ error: 'Erro Google Places', http_status: r.status, body: txt });
        return;
      }
      const data = await r.json() as { places?: GooglePlace[]; nextPageToken?: string };
      const places = data.places ?? [];
      allPlaces.push(...places);
      nextPageToken = data.nextPageToken;
      if (!nextPageToken) break;
      // Google exige delay curto antes de usar o nextPageToken
      await new Promise<void>(resolve => setTimeout(resolve, 2000));
    }

    // Cria registro da busca
    const comTelefone = allPlaces.filter(p => p.nationalPhoneNumber || p.internationalPhoneNumber).length;
    const { data: searchRow, error: sErr } = await supabase.from('google_lead_searches').insert({
      criado_por: req.userId,
      query: q,
      total_resultados: allPlaces.length,
      com_telefone: comTelefone,
      status: 'concluido',
    }).select('id').single();
    if (sErr || !searchRow) { res.status(500).json({ error: 'Erro criando busca', detail: sErr?.message }); return; }

    // Insere leads (deduplica por place_id dentro da mesma busca)
    if (allPlaces.length > 0) {
      const seen = new Set<string>();
      const rows = allPlaces
        .filter(p => p.id && !seen.has(p.id) && seen.add(p.id))
        .map(p => ({
          search_id: searchRow.id,
          place_id: p.id,
          nome: p.displayName?.text ?? null,
          telefone: p.nationalPhoneNumber ?? null,
          telefone_internacional: p.internationalPhoneNumber ?? null,
          endereco: p.formattedAddress ?? null,
          website: p.websiteUri ?? null,
          rating: p.rating ?? null,
          reviews_count: p.userRatingCount ?? null,
          types: p.types ?? null,
          latitude: p.location?.latitude ?? null,
          longitude: p.location?.longitude ?? null,
        }));
      if (rows.length > 0) {
        const { error: lErr } = await supabase.from('google_leads').insert(rows);
        if (lErr) { res.status(500).json({ error: 'Erro inserindo leads', detail: lErr.message }); return; }
      }
    }

    // Retorna leads recém-inseridos
    const { data: leads } = await supabase.from('google_leads')
      .select('*').eq('search_id', searchRow.id).order('rating', { ascending: false, nullsFirst: false });

    res.json({
      search_id: searchRow.id,
      query: q,
      total: allPlaces.length,
      com_telefone: comTelefone,
      leads: leads ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro buscando Google Places', message: String(err) });
  }
});

router.get('/leads/google/searches', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { data, error } = await supabase
      .from('google_lead_searches')
      .select('id, criado_em, query, total_resultados, com_telefone, status')
      .order('criado_em', { ascending: false })
      .limit(limit);
    if (error) { res.status(500).json({ error: 'Erro listando buscas', detail: error.message }); return; }
    res.json({ searches: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro list searches', message: String(err) });
  }
});

router.get('/leads/google/searches/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('google_leads')
      .select('*')
      .eq('search_id', req.params.id)
      .order('rating', { ascending: false, nullsFirst: false });
    if (error) { res.status(500).json({ error: 'Erro buscando leads', detail: error.message }); return; }
    res.json({ leads: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro get leads', message: String(err) });
  }
});

router.delete('/leads/google/searches/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = await supabase.from('google_lead_searches').delete().eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Erro deletando busca', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro delete search', message: String(err) });
  }
});

export default router;
