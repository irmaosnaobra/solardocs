import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

router.post('/event', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      session_id, event_type, step, answer,
      score, diagnostic, utm_source, utm_medium,
      utm_campaign, utm_content, fbclid,
    } = req.body;

    if (!event_type) { res.status(400).json({ error: 'event_type obrigatório' }); return; }

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
    });

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

export default router;
