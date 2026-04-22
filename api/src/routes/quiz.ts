import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { executePixelEvent } from '../controllers/pixelController';

const router = Router();

router.post('/event', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      session_id, event_type, step, answer,
      score, diagnostic, utm_source, utm_medium,
      utm_campaign, utm_content, fbclid, source,
    } = req.body;

    if (!event_type) { res.status(400).json({ error: 'event_type obrigatório' }); return; }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || null;

    await supabase.from('quiz_events').insert({
      session_id: session_id || null,
      event_type,
      step:        step        ?? null,
      answer:      answer      ?? null,
      score:       score       ?? null,
      diagnostic:  diagnostic  ?? null,
      utm_source:  utm_source  ?? null,
      utm_medium:  utm_medium  ?? null,
      utm_campaign:utm_campaign?? null,
      utm_content: utm_content ?? null,
      fbclid:      fbclid      ?? null,
      source:      source      ?? null,
      ip:          ip,
    });

    // ── Automação: Marcar 'Sem Perfil' se for reprovado ────────────────
    if (source === 'simulador' && event_type.startsWith('rejected_')) {
      try {
        await supabase.from('quiz_events').insert({
          session_id,
          event_type: 'admin_followup',
          answer: JSON.stringify({ status: 'Sem Perfil', value: 0 }),
          source: 'system'
        });
      } catch (e) {}
    }

    // ── Disparo automático de CAPI — só no form_submitted (deduplica com fbq Lead do browser) ─
    if (source === 'simulador' && event_type === 'form_submitted') {
      try {
        let phone = '';
        let city = '';
        if (answer) {
          const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
          phone = parsed.whatsapp || '';
          city = parsed.city || '';
        }
        const eventBody = req.body as any;
        executePixelEvent({
          pixel_id: '446093469730871',
          event_name: 'Lead',
          phone,
          city,
          score: score || 0,
          ip,
          userAgent: req.headers['user-agent'],
          fbc: eventBody.fbc || eventBody.fbclid || undefined,
          fbp: eventBody.fbp || undefined,
          event_id: eventBody.event_id || undefined,
          event_source_url: 'https://solardocs-landing.vercel.app/simulador',
        }).catch(e => console.error('Auto CAPI Lead Error:', e));
      } catch (e) {}
    }

    // ── CAPI InitiateCheckout quando qualificado ─────────────────────────
    if (source === 'simulador' && event_type === 'qualified') {
      try {
        const eventBody = req.body as any;
        executePixelEvent({
          pixel_id: '446093469730871',
          event_name: 'InitiateCheckout',
          score: score || 0,
          ip,
          userAgent: req.headers['user-agent'],
          fbc: eventBody.fbc || eventBody.fbclid || undefined,
          fbp: eventBody.fbp || undefined,
          event_id: eventBody.event_id || undefined,
          event_source_url: 'https://solardocs-landing.vercel.app/simulador',
        }).catch(e => console.error('Auto CAPI InitiateCheckout Error:', e));
      } catch (e) {}
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('quiz/event error:', err);
    res.status(500).json({ error: 'Erro ao salvar evento' });
  }
});

router.get('/funnel', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Number(req.query.days) || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { data: events } = await supabase
      .from('quiz_events')
      .select('*')
      .gte('created_at', since);

    const ev = events ?? [];

    const sessions = new Set(ev.map(e => e.session_id).filter(Boolean));
    const byType = (type: string) => new Set(ev.filter(e => e.event_type === type).map(e => e.session_id)).size;
    const byStep = (step: number) => new Set(ev.filter(e => e.event_type === 'step' && e.step === step).map(e => e.session_id)).size;

    // Busca compras no período
    const { data: purchases } = await supabase
      .from('users')
      .select('id, plano, created_at')
      .neq('plano', 'free')
      .gte('created_at', since);

    const totalPurchases = purchases?.length ?? 0;

    const funnel = [
      { label: 'Entrou no Quiz',     count: byType('page_view'),   icon: '👁️' },
      { label: 'Viu o conteúdo',     count: byType('view_content'), icon: '📄' },
      { label: 'Clicou em Começar',  count: byType('started'),     icon: '▶️' },
      { label: 'Respondeu Q1',       count: byStep(1),             icon: '1️⃣' },
      { label: 'Respondeu Q2',       count: byStep(2),             icon: '2️⃣' },
      { label: 'Respondeu Q3',       count: byStep(3),             icon: '3️⃣' },
      { label: 'Respondeu Q4',       count: byStep(4),             icon: '4️⃣' },
      { label: 'Completou o Quiz',   count: byType('completed'),   icon: '✅' },
      { label: 'Clicou pra LP',      count: byType('cta_click'),   icon: '🔗' },
      { label: 'Comprou',            count: totalPurchases,        icon: '💰' },
    ];

    res.json({ funnel, days, total_sessions: sessions.size });
  } catch (err) {
    console.error('quiz/funnel error:', err);
    res.status(500).json({ error: 'Erro ao buscar funil' });
  }
});

// ── GET /quiz/summary — todos os funis consolidados ──────────────────────
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    // Suporte a ?from=ISO&to=ISO ou ?days=N
    let since: string;
    let until: string | null = null;

    if (req.query.from) {
      since = new Date(req.query.from as string).toISOString();
      until = req.query.to ? new Date(req.query.to as string).toISOString() : null;
    } else {
      const days = Number(req.query.days) || 7;
      since = new Date(Date.now() - days * 86400000).toISOString();
    }

    function applyRange(q: any) {
      const base = q.gte('created_at', since);
      return until ? base.lte('created_at', until) : base;
    }

    // Chave de deduplicação: IP se disponível, senão session_id
    const dedupKey = (e: any) => e.ip || e.session_id || Math.random().toString();

    // ── Quiz B2B (source IS NULL ou 'quiz') ─────────────────────────────
    const quizQuery = supabase
      .from('quiz_events')
      .select('session_id, ip, event_type, step, score, diagnostic, source')
      .or('source.is.null,source.eq.quiz');
    const { data: quizRaw } = await (applyRange(quizQuery) as any);

    const qev = quizRaw ?? [];
    const qByType = (type: string) => new Set(qev.filter((e: any) => e.event_type === type).map(dedupKey)).size;
    const qByStep = (step: number) => new Set(qev.filter((e: any) => e.event_type === 'step' && e.step === step).map(dedupKey)).size;

    // Busca compras no período
    const { data: purchases } = await (applyRange(
      supabase.from('users').select('id').neq('plano', 'free')
    ) as any);

    const quizFunnel = [
      { label: 'Entrou na página',          count: qByType('page_view'),    icon: '👁️' },
      { label: 'P1 — Papel na integradora', count: qByStep(1),              icon: '1️⃣' },
      { label: 'P2 — Principal travamento', count: qByStep(2),              icon: '2️⃣' },
      { label: 'P3 — Impacto do atraso',    count: qByStep(3),              icon: '3️⃣' },
      { label: 'P4 — Visão de futuro',      count: qByStep(4),              icon: '4️⃣' },
      { label: 'Completou o diagnóstico',   count: qByType('completed'),    icon: '✅' },
      { label: 'Clicou para a LP',          count: qByType('cta_click'),    icon: '🔗' },
    ];

    // ── Simulador B2C (source = 'simulador') ────────────────────────────
    const { data: simRaw } = await (applyRange(
      supabase.from('quiz_events').select('session_id, ip, event_type, step, diagnostic, score').eq('source', 'simulador')
    ) as any);

    const sev = simRaw ?? [];
    const sByType = (type: string) => new Set(sev.filter((e: any) => e.event_type === type).map(dedupKey)).size;
    const sByStep = (step: number) => new Set(sev.filter((e: any) => e.event_type === 'step' && e.step === step).map(dedupKey)).size;

    const simFunnel = [
      { label: 'Entrou na página',          count: sByType('page_view'),        icon: '👁️' },
      { label: 'P1 — Conta de luz',         count: sByStep(1),                  icon: '1️⃣' },
      { label: 'P2 — Objetivo',             count: sByStep(2),                  icon: '2️⃣' },
      { label: 'P3 — Consumo',              count: sByStep(3),                  icon: '3️⃣' },
      { label: 'P4 — Tipo de imóvel',       count: sByStep(4),                  icon: '4️⃣' },
      { label: 'P5 — Telhado',              count: sByStep(5),                  icon: '5️⃣' },
      { label: 'P6 — Urgência',             count: sByStep(6),                  icon: '6️⃣' },
      { label: 'P7 — Forma de pagamento',   count: sByStep(7),                  icon: '7️⃣' },
      { label: 'P8 — Padrão de energia',    count: sByStep(8),                  icon: '8️⃣' },
      { label: 'Chegou ao Formulário',       count: sByType('form_view'),        icon: '📋' },
      { label: 'Enviou Formulário',          count: sByType('form_submitted'),   icon: '📤' },
      { label: 'Qualificado',                count: sByType('qualified'),        icon: '🚀' },
      { label: 'Rejeitado (iGreen)',         count: sByType('rejected_igreen'),  icon: '💸' },
      { label: 'Rejeitado (Região)',         count: sByType('rejected_region'),  icon: '📍' },
      { label: 'Rejeitado (Perfil)',         count: sByType('rejected_profile'), icon: '💡' },
    ];

    // ── Landing Page (page_visits + lp_events) ──────────────────────────
    const { data: visits } = await (applyRange(
      supabase.from('page_visits').select('session_id, ip')
    ) as any);

    const { data: lpRaw } = await (applyRange(
      supabase.from('lp_events').select('session_id, event_type, event_data')
    ) as any);

    // Visitantes únicos da landing: IP > session_id
    const uniqueVisitors = new Set((visits ?? []).map((v: any) => v.ip || v.session_id)).size;

    const lpev = lpRaw ?? [];
    const lpByType = (type: string) =>
      new Set(lpev.filter((e: any) => e.event_type === type).map((e: any) => e.session_id)).size;
    const lpByScroll = (depth: number) =>
      new Set(lpev.filter((e: any) => e.event_type === 'scroll' && e.event_data?.depth === depth).map((e: any) => e.session_id)).size;
    const lpBySection = (section: string) =>
      new Set(lpev.filter((e: any) => e.event_type === 'section' && e.event_data?.section === section).map((e: any) => e.session_id)).size;

    // Breakdown por plano clicado
    const planClicks = lpev.filter((e: any) => e.event_type === 'plan_click');
    const planOrder = ['free', 'iniciante', 'pro', 'vip'];
    const planMap: Record<string, { plano: string; count: number; valor: number }> = {};
    for (const e of planClicks) {
      const p = e.event_data?.plan || 'desconhecido';
      if (!planMap[p]) planMap[p] = { plano: e.event_data?.plano || p, count: 0, valor: e.event_data?.valor || 0 };
      planMap[p].count++;
    }
    const planBreakdown = planOrder
      .filter(p => planMap[p])
      .map(p => ({ plan: p, ...planMap[p] }));

    const lpByPlan = (plan: string) => planMap[plan]?.count ?? 0;

    // Free cadastrado no período (freemium)
    const { data: freeUsers } = await (applyRange(
      supabase.from('users').select('id').eq('plano', 'free')
    ) as any);
    const totalFree = freeUsers?.length ?? 0;

    // Comprou (assinante pago cadastrado no período)
    const { data: paidUsers } = await (applyRange(
      supabase.from('users').select('id').neq('plano', 'free')
    ) as any);
    const totalPaid = paidUsers?.length ?? 0;

    const landingFunnel = [
      { label: 'Visitou a página',        count: uniqueVisitors,             icon: '👁️' },
      { label: 'Scroll 25%',             count: lpByScroll(25),             icon: '📜' },
      { label: 'Scroll 50%',             count: lpByScroll(50),             icon: '📜' },
      { label: 'Scroll 75%',             count: lpByScroll(75),             icon: '📜' },
      { label: 'Viu Seção Problema',      count: lpBySection('problema'),    icon: '😓' },
      { label: 'Viu Seção Crença',        count: lpBySection('crenca'),      icon: '💭' },
      { label: 'Viu Seção Solução',       count: lpBySection('solucao'),     icon: '💡' },
      { label: 'Viu Seção Preços',        count: lpBySection('precos'),      icon: '💰' },
      { label: 'Scroll 100%',            count: lpByScroll(100),            icon: '🏁' },
      { label: 'Clicou no CTA',          count: lpByType('cta_click'),      icon: '🔗' },
      { label: '→ Botão Cadastrar',       count: lpByPlan('free'),           icon: '🎁' },
      { label: '→ Botão Iniciante',      count: lpByPlan('iniciante'),      icon: '🌱' },
      { label: '→ Botão PRO',            count: lpByPlan('pro'),            icon: '⚡' },
      { label: '→ Botão VIP',            count: lpByPlan('vip'),            icon: '👑' },
      { label: 'Cadastrou (freemium)',    count: totalFree,                  icon: '🧪' },
      { label: 'Comprou',                count: totalPaid,                  icon: '💰' },
    ];

    // Breakdown de CTAs por botão
    const ctaClicks = lpev.filter((e: any) => e.event_type === 'cta_click');
    const ctaByLabel: Record<string, number> = {};
    for (const e of ctaClicks) {
      const lbl = e.event_data?.label?.trim() || e.event_data?.href || 'Desconhecido';
      ctaByLabel[lbl] = (ctaByLabel[lbl] || 0) + 1;
    }
    const ctaBreakdown = Object.entries(ctaByLabel)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));

    res.json({
      since,
      until,
      quiz:      { name: 'Quiz SolarDoc (B2B)',            color: '#2563eb', funnel: quizFunnel },
      simulador: { name: 'Simulador Irmãos na Obra (B2C)', color: '#f59e0b', funnel: simFunnel },
      landing:   { name: 'Landing Page SolarDoc',          color: '#10b981', funnel: landingFunnel, ctaBreakdown, planBreakdown },
    });
  } catch (err) {
    console.error('quiz/summary error:', err);
    res.status(500).json({ error: 'Erro ao buscar resumo' });
  }
});

// ── POST /quiz/leads/status — atualizar status de acompanhamento ─────────
router.post('/leads/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { session_id, status, value } = req.body;
    if (!session_id || !status) {
      res.status(400).json({ error: 'session_id e status obrigatórios' });
      return;
    }

    const answerObj = { status, value: value || 0 };

    await supabase.from('quiz_events').insert({
      session_id,
      event_type: 'admin_followup',
      answer: JSON.stringify(answerObj),
      source: 'admin'
    });

    // Se o status for "Fechado", dispara o evento de Purchase para o Meta CAPI
    if (status === 'Fechado') {
      try {
        // Busca dados do lead para identificação no CAPI
        const { data: initialEvents } = await supabase
          .from('quiz_events')
          .select('answer, ip, fbclid')
          .eq('session_id', session_id)
          .not('answer', 'is', null)
          .order('created_at', { ascending: true });

        let leadData: any = null;
        let ip = null;
        
        if (initialEvents) {
          for (const e of initialEvents) {
            try {
              const p = JSON.parse(e.answer);
              if (p.name && p.whatsapp) {
                leadData = p;
                ip = e.ip;
                break;
              }
            } catch {}
          }
        }

        if (leadData) {
          executePixelEvent({
            pixel_id: '446093469730871', // Pixel B2C
            event_name: 'Purchase',
            phone: leadData.whatsapp,
            city: leadData.city,
            value: Number(value) || 0,
            currency: 'BRL',
            ip,
            userAgent: req.headers['user-agent']
          }).catch(e => console.error('Purchase CAPI Error:', e));
        }
      } catch (capiErr) {
        console.error('Error triggering Purchase CAPI:', capiErr);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('quiz/leads/status error:', err);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// ── POST /quiz/leads/note — salvar anotação do SDR ──────────────────────
router.post('/leads/note', async (req: Request, res: Response): Promise<void> => {
  try {
    const { session_id, note } = req.body;
    if (!session_id) {
      res.status(400).json({ error: 'session_id obrigatório' });
      return;
    }

    await supabase.from('quiz_events').insert({
      session_id,
      event_type: 'admin_note',
      answer: note || '',
      source: 'admin'
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('quiz/leads/note error:', err);
    res.status(500).json({ error: 'Erro ao salvar nota' });
  }
});

// ── GET /quiz/leads — leads do simulador B2C ──────────────────────
router.get('/leads', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: raw } = await supabase
      .from('quiz_events')
      .select('session_id, ip, created_at, event_type, answer, score')
      .or('source.eq.simulador,event_type.eq.admin_followup,event_type.eq.admin_note')
      .order('created_at', { ascending: false });

    const events = raw ?? [];
    const leadMap = new Map<string, any>();

    for (const e of events) {
      const key = e.session_id || e.ip || `rnd-${Math.random()}`;
      if (!leadMap.has(key)) {
        leadMap.set(key, { id: key, events: [] });
      }
      leadMap.get(key).events.push(e);
    }

    const leads = [];

    for (const [key, lc] of leadMap.entries()) {
      let ans = null;
      for (const e of lc.events) {
        if (e.answer) {
          try { 
            const parsed = JSON.parse(e.answer); 
            if (parsed && parsed.name && parsed.city) {
              ans = parsed;
              break;
            }
          } catch {}
        }
      }

      if (!ans) continue;

      let finalStatus = null;
      let finalScore = null;
      let createdAt = null;

      for (const e of lc.events) {
        if (e.event_type.startsWith('rejected_') || e.event_type === 'qualified' || e.event_type === 'form_submitted') {
          if (!finalStatus) finalStatus = e.event_type;
          if (!createdAt) createdAt = e.created_at;
        }
        if (e.score != null && finalScore == null) finalScore = e.score;
      }

      if (!finalStatus) finalStatus = 'form_submitted';

      let followupStatus = 'Pendente';
      let saleValue = 0;
      let latestNote = '';
      for (const e of lc.events) {
        if (e.event_type === 'admin_followup' && followupStatus === 'Pendente') {
          try {
            const f = JSON.parse(e.answer);
            followupStatus = f.status || e.answer;
            saleValue = f.value || 0;
          } catch {
            followupStatus = e.answer;
          }
        }
        if (e.event_type === 'admin_note' && !latestNote) {
          latestNote = e.answer;
        }
        if (followupStatus !== 'Pendente' && latestNote) break;
      }

      leads.push({
        id: key,
        name: ans.name,
        whatsapp: ans.whatsapp || null,
        city: ans.city,
        state: ans.state,
        created_at: createdAt || lc.events[0].created_at,
        status: finalStatus,
        score: finalScore,
        followup: followupStatus,
        saleValue: saleValue,
        note: latestNote,
      });
    }

    res.json({ leads });
  } catch (err) {
    console.error('quiz/leads error:', err);
    res.status(500).json({ error: 'Erro ao buscar leads do simulador' });
  }
});

export default router;
