import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

export async function trackVisit(req: Request, res: Response): Promise<void> {
  try {
    const {
      session_id,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      referrer, landing_url,
    } = req.body as Record<string, string>;

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    const user_agent = (req.headers['user-agent'] as string) || null;

    await supabase.from('page_visits').insert({
      session_id:   session_id   || null,
      utm_source:   utm_source   || null,
      utm_medium:   utm_medium   || null,
      utm_campaign: utm_campaign || null,
      utm_content:  utm_content  || null,
      utm_term:     utm_term     || null,
      referrer:     referrer     || null,
      landing_url:  landing_url  || null,
      user_agent,
      ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('trackVisit error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function trackEvent(req: Request, res: Response): Promise<void> {
  try {
    const { session_id, event_type, event_data } = req.body as {
      session_id: string;
      event_type: string;
      event_data?: Record<string, unknown>;
    };

    if (!session_id || !event_type) {
      res.status(400).json({ error: 'session_id e event_type são obrigatórios' });
      return;
    }

    await supabase.from('lp_events').insert({
      session_id,
      event_type,
      event_data: event_data ?? null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('trackEvent error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}
