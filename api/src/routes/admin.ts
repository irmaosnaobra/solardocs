import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { getUsers, triggerMonthlyReset, getVisits, getAnalytics, getMetaFunnel, getFunnel, getRevenue } from '../controllers/adminController';
import { getLimpaproFunnel, getLimpaproLeads } from '../controllers/limpaproController';
import { supabase } from '../utils/supabase';
import { runIoBroadcastTick } from '../services/io/broadcastTickService';

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
router.get('/funnel-limpapro', getLimpaproFunnel);
router.get('/leads-limpapro',  getLimpaproLeads);
router.get('/revenue',        getRevenue);

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

// Contagem leve pro badge do sidebar — leads com empresa + whatsapp,
// quebrados por plano (total, pro, vip, adm). Admin não conta como cliente.
router.get('/platform-crm/counts', async (_req: Request, res: Response) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, plano, whatsapp, is_admin');
    const { data: companies } = await supabase.from('company').select('user_id');
    const companySet = new Set((companies ?? []).map((c: any) => c.user_id));

    let total = 0, pro = 0, vip = 0, adm = 0;
    for (const u of users ?? []) {
      const hasWpp = !!(u.whatsapp && String(u.whatsapp).trim());
      const hasCompany = companySet.has(u.id);
      if (!hasWpp || !hasCompany) continue;
      if (u.is_admin) { adm++; continue; } // admin sai do funil de clientes
      total++;
      if (u.plano === 'pro') pro++;
      else if (u.plano === 'ilimitado') vip++;
    }
    res.json({ total, pro, vip, adm });
  } catch (err) {
    console.error('platform-crm/counts error:', err);
    res.status(500).json({ error: 'Erro ao contar' });
  }
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
    const { mensagens, contatos, contexto_ai, usou_ia, cadencia_min, cadencia_max, total } = req.body as {
      mensagens?: { slot: number; base: string; media_url?: string | null; media_type?: 'image' | 'video' | 'audio' | null }[];
      contatos?: string[];
      contexto_ai?: string;
      usou_ia?: boolean;
      cadencia_min?: number;
      cadencia_max?: number;
      total?: number;
    };
    if (!Array.isArray(mensagens) || mensagens.length === 0) { res.status(400).json({ error: 'mensagens obrigatorio' }); return; }

    const mensagensClean = mensagens.map(m => {
      const mt = m.media_type === 'image' || m.media_type === 'video' || m.media_type === 'audio' ? m.media_type : null;
      const mu = mt && typeof m.media_url === 'string' && m.media_url.trim() ? m.media_url.trim() : null;
      return { slot: m.slot, base: m.base, media_url: mu, media_type: mt };
    });

    const { data, error } = await supabase.from('io_broadcasts').insert({
      criado_por: req.userId,
      mensagens: mensagensClean,
      contatos: Array.isArray(contatos) ? contatos : null,
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

// Anexa/substitui a lista de contatos de um broadcast (pra retomar disparos
// antigos cuja lista nao foi persistida).
router.put('/io/broadcasts/:id/contatos', async (req: Request, res: Response): Promise<void> => {
  try {
    const { contatos } = req.body as { contatos?: string[] };
    if (!Array.isArray(contatos)) { res.status(400).json({ error: 'contatos[] obrigatorio' }); return; }
    const { error } = await supabase.from('io_broadcasts').update({ contatos }).eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Erro atualizando contatos', detail: error.message }); return; }
    res.json({ ok: true, n: contatos.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro put contatos', message: String(err) });
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

// Detalhe de um broadcast (com contatos).
router.get('/io/broadcasts/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('io_broadcasts')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) { res.status(500).json({ error: 'Erro buscando broadcast', detail: error.message }); return; }
    if (!data) { res.status(404).json({ error: 'nao encontrado' }); return; }
    res.json({ broadcast: data });
  } catch (err) {
    res.status(500).json({ error: 'Erro get broadcast', message: String(err) });
  }
});

// Lista envios de um broadcast (opcional ?since=ISO + ?limit=N).
router.get('/io/broadcasts/:id/envios', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    let q = supabase
      .from('io_broadcast_envios')
      .select('*')
      .eq('broadcast_id', req.params.id)
      .order('enviado_em', { ascending: false })
      .limit(limit);
    if (typeof req.query.since === 'string' && req.query.since) {
      q = q.gt('enviado_em', req.query.since);
    }
    const { data, error } = await q;
    if (error) { res.status(500).json({ error: 'Erro buscando envios', detail: error.message }); return; }
    res.json({ envios: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro get envios', message: String(err) });
  }
});

// Kick-off manual: chama o tick imediatamente sem esperar o cron. Retorna
// resultado do tick (até MAX_ENVIOS_POR_TICK envios processados).
router.post('/io/broadcasts/:id/tick', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    // Garante que esse broadcast existe e está rodando — se 'pendente' inicial, marca rodando
    const { data: b } = await supabase.from('io_broadcasts').select('status').eq('id', id).maybeSingle();
    if (!b) { res.status(404).json({ error: 'nao encontrado' }); return; }
    if (b.status !== 'rodando' && b.status !== 'pendente') {
      res.json({ ok: true, skipped: true, status: b.status });
      return;
    }
    if (b.status === 'pendente') {
      await supabase.from('io_broadcasts').update({ status: 'rodando' }).eq('id', id);
    }
    const result = await runIoBroadcastTick();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Erro no tick manual', message: String(err) });
  }
});

// Upload de mídia (imagem/vídeo) pros disparos IO. Aceita base64 e devolve URL
// pública (bucket io-broadcasts-media, auto-criado público). Z-API precisa de
// URL pública pra send-image/send-video.
router.post('/io/broadcasts/upload-media', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, mime, kind } = req.body as { data?: string; mime?: string; kind?: 'image' | 'video' | 'audio' };
    if (!data || typeof data !== 'string') { res.status(400).json({ error: 'data (base64) obrigatorio' }); return; }
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') { res.status(400).json({ error: 'kind precisa ser image, video ou audio' }); return; }

    const base64 = data.includes(',') ? data.split(',', 2)[1] : data;
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) { res.status(400).json({ error: 'data vazio ou invalido' }); return; }

    const bucket = 'io-broadcasts-media';
    // Garante bucket publico (idempotente — ignora "already exists").
    const { error: createErr } = await supabase.storage.createBucket(bucket, { public: true });
    if (createErr && !/already exists/i.test(createErr.message)) {
      res.status(500).json({ error: 'Erro criando bucket', detail: createErr.message });
      return;
    }

    const defaultExt = kind === 'image' ? 'jpg' : kind === 'audio' ? 'mp3' : 'mp4';
    const defaultMime = kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const ext = (mime?.split('/')[1] || defaultExt).replace(/[^a-z0-9]/gi, '').slice(0, 8) || defaultExt;
    const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: mime || defaultMime,
      upsert: false,
    });
    if (upErr) { res.status(500).json({ error: 'Erro upload', detail: upErr.message }); return; }

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    res.json({ url: pub.publicUrl, path });
  } catch (err) {
    res.status(500).json({ error: 'Erro upload media', message: String(err) });
  }
});

// ── Lead Extractor (Google Places Text Search New API) ────────────
// /admin/leads/google/search                POST   { query, max_pages? } → busca rápida (1 termo, até 60) + persiste
// /admin/leads/google/scan/start            POST   { uf, categoria } → inicia varredura estadual (job), retorna search_id
// /admin/leads/google/scan/:id/tick         POST   processa UMA fatia de municípios (dirigido pela aba)
// /admin/leads/google/scan/:id/cancel       POST   seta flag de cancelamento
// /admin/leads/google/searches              GET    lista buscas anteriores
// /admin/leads/google/searches/:id          GET    retorna leads da busca
// /admin/leads/google/searches/:id/progress GET    retorna o estado do job (p/ barra + retomar)
// /admin/leads/google/searches/:id          DELETE remove busca + leads
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

// Campos pedidos à Google (compartilhado entre busca rápida e varredura).
const GOOGLE_PLACES_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.types', 'places.location',
  'nextPageToken',
].join(',');

// UFs válidas (IBGE) — valida o input da varredura.
const UFS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Mapeia um GooglePlace pra linha de google_leads (mesmo mapeamento da busca rápida).
function placeToRow(searchId: string, p: GooglePlace) {
  return {
    search_id: searchId,
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
  };
}

// Erro tipado pra distinguir rate-limit/transitório (429/5xx/RESOURCE_EXHAUSTED).
class GooglePlacesError extends Error {
  httpStatus: number;
  transient: boolean;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
    this.transient = httpStatus === 429 || httpStatus >= 500;
  }
}

// Pagina um único termo até `maxPages` (máx ~60). O delay de 2s é SÓ entre
// páginas do MESMO termo (exigência do nextPageToken da Google), nunca entre
// termos diferentes. Retorna os places + quantos requests gastou.
async function buscarPlacesPaginado(
  query: string,
  apiKey: string,
  maxPages = 3,
): Promise<{ places: GooglePlace[]; requests: number }> {
  const out: GooglePlace[] = [];
  let nextPageToken: string | undefined;
  let requests = 0;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      textQuery: query,
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
        'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    requests++;
    if (!r.ok) {
      const txt = await r.text();
      throw new GooglePlacesError(`Google Places ${r.status}: ${txt.slice(0, 300)}`, r.status);
    }
    const data = await r.json() as { places?: GooglePlace[]; nextPageToken?: string };
    out.push(...(data.places ?? []));
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
    // Google exige um pequeno delay antes de reusar o nextPageToken.
    await sleep(2000);
  }
  return { places: out, requests };
}

interface Municipio { id: number; nome: string }

// Lista de municípios de uma UF via IBGE, ORDENADA por id (cursor determinístico:
// a fatia [processados : processados+BATCH] tem que ser estável entre ticks).
async function fetchMunicipiosIBGE(uf: string): Promise<Municipio[]> {
  const r = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
  );
  if (!r.ok) throw new Error(`IBGE ${r.status}`);
  const data = await r.json() as Array<{ id: number; nome: string }>;
  return data
    .map(m => ({ id: m.id, nome: m.nome }))
    .sort((a, b) => a.id - b.id);
}

router.post('/leads/google/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, max_pages } = req.body as { query?: string; max_pages?: number };
    const q = (query || '').trim();
    if (!q) { res.status(400).json({ error: 'query obrigatoria' }); return; }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    const pages = Math.max(1, Math.min(Number(max_pages) || 3, 3));

    let allPlaces: GooglePlace[];
    try {
      const r = await buscarPlacesPaginado(q, apiKey, pages);
      allPlaces = r.places;
    } catch (err) {
      const status = err instanceof GooglePlacesError ? err.httpStatus : 0;
      res.status(502).json({ error: 'Erro Google Places', http_status: status, body: String(err) });
      return;
    }

    // Cria registro da busca (tipo 'single' = busca rápida)
    const comTelefone = allPlaces.filter(p => p.nationalPhoneNumber || p.internationalPhoneNumber).length;
    const { data: searchRow, error: sErr } = await supabase.from('google_lead_searches').insert({
      criado_por: req.userId,
      tipo: 'single',
      query: q,
      total_resultados: allPlaces.length,
      com_telefone: comTelefone,
      status: 'concluido',
    }).select('id').single();
    if (sErr || !searchRow) { res.status(500).json({ error: 'Erro criando busca', detail: sErr?.message }); return; }

    // Insere leads (deduplica por place_id via índice único (search_id, place_id))
    if (allPlaces.length > 0) {
      const seen = new Set<string>();
      const rows = allPlaces
        .filter(p => p.id && !seen.has(p.id) && seen.add(p.id))
        .map(p => placeToRow(searchRow.id, p));
      if (rows.length > 0) {
        const { error: lErr } = await supabase.from('google_leads')
          .upsert(rows, { onConflict: 'search_id,place_id', ignoreDuplicates: true });
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

// ── Varredura estadual: INICIA o job ────────────────────────────────────────
// Cria a busca como 'rodando', guarda uf/categoria, conta municípios via IBGE
// e retorna search_id na hora. A aba então chama /tick em loop.
router.post('/leads/google/scan/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uf: rawUf, categoria: rawCat } = req.body as { uf?: string; categoria?: string };
    const uf = (rawUf || '').trim().toUpperCase();
    const categoria = (rawCat || '').trim();
    if (!UFS_BR.includes(uf)) { res.status(400).json({ error: 'UF inválida' }); return; }
    if (!categoria) { res.status(400).json({ error: 'categoria obrigatoria' }); return; }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    let municipiosTotal: number;
    try {
      municipiosTotal = (await fetchMunicipiosIBGE(uf)).length;
    } catch {
      res.status(502).json({ error: 'Erro consultando IBGE — tente de novo' });
      return;
    }

    const { data: searchRow, error: sErr } = await supabase.from('google_lead_searches').insert({
      criado_por: req.userId,
      tipo: 'varredura',
      uf,
      categoria,
      query: `${categoria} — ${uf} (varredura)`,
      status: 'rodando',
      municipios_total: municipiosTotal,
      municipios_processados: 0,
      requests_feitos: 0,
      total_resultados: 0,
      com_telefone: 0,
      cancelar: false,
    }).select('id').single();
    if (sErr || !searchRow) { res.status(500).json({ error: 'Erro criando varredura', detail: sErr?.message }); return; }

    res.json({
      search_id: searchRow.id,
      municipios_total: municipiosTotal,
      projecao_requests: municipiosTotal * 3,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro iniciando varredura', message: String(err) });
  }
});

// ── Varredura estadual: processa UMA fatia (dirigido pela aba) ───────────────
const SCAN_BATCH = 24;          // municípios por fatia (limitado pelo time-box)
const SCAN_CONCURRENCY = 8;     // queries simultâneas dentro da fatia
// Time-box CURTO de propósito: o tick fala com a aba via proxy edge /_api, que
// tem um teto de resposta menor que o maxDuration de 300s da função. Mantendo o
// budget bem abaixo desse teto, um tick nunca é morto no meio (o que viraria
// loop que gasta na Google sem avançar o cursor). Mais ticks, cada um seguro.
const SCAN_TICK_BUDGET_MS = 22000;  // para de pegar novos municípios após ~22s
const SCAN_LEASE_MS = 60000;        // lease > budget + margem (cobre crash)

router.post('/leads/google/scan/:id/tick', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    const nowIso = new Date().toISOString();
    const lockUntil = new Date(Date.now() + SCAN_LEASE_MS).toISOString();

    // 1) Claim atômico do lease: só pega se status='rodando', não cancelado e
    //    lock livre/expirado. Duas abas (ou um cron) não dirigem o mesmo job.
    const { data: claimed } = await supabase
      .from('google_lead_searches')
      .update({ locked_until: lockUntil })
      .eq('id', id)
      .eq('status', 'rodando')
      .eq('cancelar', false)
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .select('id, uf, categoria, municipios_processados, requests_feitos, falhas, falhas_consecutivas')
      .maybeSingle();

    if (!claimed) {
      // Pode ser: cancelado, já concluído, ou outra aba segurando o lock.
      const { data: cur } = await supabase
        .from('google_lead_searches')
        .select('status, cancelar, municipios_processados, municipios_total, total_resultados, com_telefone, requests_feitos')
        .eq('id', id).maybeSingle();
      if (cur?.cancelar && cur.status === 'rodando') {
        // Cancelamento pedido: finaliza como 'parado'.
        await supabase.from('google_lead_searches')
          .update({ status: 'parado', locked_until: null }).eq('id', id);
        res.json({ claimed: false, done: true, ...cur, status: 'parado' });
        return;
      }
      res.json({ claimed: false, ...(cur ?? {}), done: cur?.status !== 'rodando', status: cur?.status ?? 'desconhecido' });
      return;
    }

    const uf = claimed.uf as string;
    const categoria = claimed.categoria as string;
    const base = claimed.municipios_processados as number;
    const falhasAtuais = Array.isArray(claimed.falhas) ? claimed.falhas : [];

    // 2) Re-busca a lista IBGE (fonte da verdade de total/cursor). Blip → retry
    //    sem avançar; 3 consecutivos → 'erro'. Nunca matar o job por um blip.
    let municipios: Municipio[];
    try {
      municipios = await fetchMunicipiosIBGE(uf);
    } catch {
      const nConsec = (claimed.falhas_consecutivas as number) + 1;
      if (nConsec >= 3) {
        await supabase.from('google_lead_searches')
          .update({ status: 'erro', falhas_consecutivas: nConsec, locked_until: null }).eq('id', id);
        res.json({ claimed: true, done: true, status: 'erro', error: 'IBGE indisponível' });
        return;
      }
      await supabase.from('google_lead_searches')
        .update({ falhas_consecutivas: nConsec, locked_until: null }).eq('id', id);
      res.json({ claimed: true, retry: true, status: 'rodando' });
      return;
    }

    const total = municipios.length;
    if (base >= total) {
      await supabase.from('google_lead_searches')
        .update({ status: 'concluido', municipios_processados: total, locked_until: null }).eq('id', id);
      res.json({ claimed: true, done: true, status: 'concluido', municipios_processados: total, municipios_total: total });
      return;
    }

    // 3) Fatia [base : base+BATCH], processada em chunks concorrentes com time-box.
    const fatia = municipios.slice(base, base + SCAN_BATCH);
    const inicio = Date.now();
    let processedThisTick = 0;
    let requestsThisTick = 0;
    const placesColetados: GooglePlace[] = [];
    const novasFalhas: Array<{ id: number; nome: string }> = [];

    for (let i = 0; i < fatia.length; i += SCAN_CONCURRENCY) {
      if (Date.now() - inicio > SCAN_TICK_BUDGET_MS) break; // time-box: termina o tick
      const grupo = fatia.slice(i, i + SCAN_CONCURRENCY);
      const results = await Promise.allSettled(grupo.map(async (m) => {
        const query = `${categoria} ${m.nome} ${uf}`;
        try {
          return await buscarPlacesPaginado(query, apiKey);
        } catch (err) {
          // 1 retry inline (blip/rate-limit transitório)
          if (err instanceof GooglePlacesError && err.transient) {
            await sleep(1500);
            return await buscarPlacesPaginado(query, apiKey);
          }
          throw err;
        }
      }));
      results.forEach((r, idx) => {
        const m = grupo[idx];
        if (r.status === 'fulfilled') {
          placesColetados.push(...r.value.places);
          requestsThisTick += r.value.requests;
        } else {
          // Falha persistente: registra e segue (não bloqueia o cursor).
          novasFalhas.push({ id: m.id, nome: m.nome });
        }
        processedThisTick++; // concluído = sucesso OU falha registrada
      });
    }

    // 4) Upsert dedup dos places coletados (índice único (search_id, place_id)).
    if (placesColetados.length > 0) {
      const seen = new Set<string>();
      const rows = placesColetados
        .filter(p => p.id && !seen.has(p.id) && seen.add(p.id))
        .map(p => placeToRow(id, p));
      if (rows.length > 0) {
        await supabase.from('google_leads')
          .upsert(rows, { onConflict: 'search_id,place_id', ignoreDuplicates: true });
      }
    }

    // 5) Recomputa contadores (idempotente) e avança o cursor pelo nº REAL.
    const { count: totalResultados } = await supabase.from('google_leads')
      .select('id', { count: 'exact', head: true }).eq('search_id', id);
    const { count: comTelefone } = await supabase.from('google_leads')
      .select('id', { count: 'exact', head: true }).eq('search_id', id).not('telefone', 'is', null);

    const novoProcessados = base + processedThisTick;
    const done = novoProcessados >= total;

    await supabase.from('google_lead_searches').update({
      municipios_processados: novoProcessados,
      requests_feitos: (claimed.requests_feitos as number) + requestsThisTick,
      total_resultados: totalResultados ?? 0,
      com_telefone: comTelefone ?? 0,
      falhas: [...falhasAtuais, ...novasFalhas],
      falhas_consecutivas: 0,
      status: done ? 'concluido' : 'rodando',
      locked_until: null,
    }).eq('id', id);

    res.json({
      claimed: true,
      done,
      status: done ? 'concluido' : 'rodando',
      municipios_processados: novoProcessados,
      municipios_total: total,
      total_resultados: totalResultados ?? 0,
      com_telefone: comTelefone ?? 0,
      requests_feitos: (claimed.requests_feitos as number) + requestsThisTick,
    });
  } catch (err) {
    // Libera o lock pra próxima tentativa não ficar travada no lease.
    await supabase.from('google_lead_searches').update({ locked_until: null }).eq('id', id);
    res.status(500).json({ error: 'Erro no tick da varredura', message: String(err) });
  }
});

// ── Varredura estadual: pede cancelamento (cobre tab-close) ──────────────────
router.post('/leads/google/scan/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = await supabase.from('google_lead_searches')
      .update({ cancelar: true }).eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Erro cancelando', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro cancelando varredura', message: String(err) });
  }
});

// ── Varredura estadual: re-arma um job 'parado'/'erro' pra continuar do cursor ─
// Não ressuscita 'concluido'. Limpa cancelar/lock/falhas e volta pra 'rodando';
// o tick continua de municipios_processados (upsert torna re-tentativa segura).
router.post('/leads/google/scan/:id/resume', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('google_lead_searches')
      .update({ status: 'rodando', cancelar: false, falhas_consecutivas: 0, locked_until: null })
      .eq('id', req.params.id)
      .eq('tipo', 'varredura')
      .in('status', ['parado', 'erro', 'rodando'])
      .select('id, municipios_total, municipios_processados, total_resultados, com_telefone, requests_feitos')
      .maybeSingle();
    if (error) { res.status(500).json({ error: 'Erro retomando', detail: error.message }); return; }
    if (!data) { res.status(409).json({ error: 'Varredura não pode ser retomada (já concluída?)' }); return; }
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Erro retomando varredura', message: String(err) });
  }
});

// ── Estado do job (p/ barra de progresso + retomar ao recarregar) ────────────
router.get('/leads/google/searches/:id/progress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('google_lead_searches')
      .select('id, tipo, uf, categoria, query, status, cancelar, municipios_total, municipios_processados, requests_feitos, total_resultados, com_telefone, falhas')
      .eq('id', req.params.id).maybeSingle();
    if (error) { res.status(500).json({ error: 'Erro progress', detail: error.message }); return; }
    if (!data) { res.status(404).json({ error: 'Busca não encontrada' }); return; }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro progress', message: String(err) });
  }
});

router.get('/leads/google/searches', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { data, error } = await supabase
      .from('google_lead_searches')
      .select('id, criado_em, query, total_resultados, com_telefone, status, tipo, uf, categoria, municipios_total, municipios_processados, requests_feitos')
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
    // Pagina em blocos de 1000 (teto do PostgREST) até esgotar — uma varredura
    // estadual pode ter milhares de leads, e um select simples cortaria em 1000.
    const PAGE = 1000;
    const todos: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('google_leads')
        .select('*')
        .eq('search_id', req.params.id)
        .order('rating', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true }) // desempate estável entre páginas
        .range(from, from + PAGE - 1);
      if (error) { res.status(500).json({ error: 'Erro buscando leads', detail: error.message }); return; }
      const lote = data ?? [];
      todos.push(...lote);
      if (lote.length < PAGE) break;
    }
    res.json({ leads: todos });
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
