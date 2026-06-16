import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';

// Analytics de uso de features internas (calculadora etc).
// NÃO consome crédito de documentos — é só registro de uso.

const eventSchema = z.object({
  feature: z.string().min(1).max(40),
  event_type: z.string().min(1).max(40),
  event_data: z.record(z.string(), z.unknown()).optional(),
});

// POST /feature-events — registra um uso (autenticado).
export async function logFeatureEvent(req: Request, res: Response): Promise<void> {
  try {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'feature e event_type são obrigatórios' });
      return;
    }

    const { feature, event_type, event_data } = parsed.data;

    await supabase.from('feature_events').insert({
      user_id: req.userId,
      feature,
      event_type,
      event_data: event_data ?? null,
    });

    // Resposta enxuta; tracking nunca deve travar o front.
    res.status(204).end();
  } catch (err) {
    // Fail-silent: analytics não pode quebrar a UX.
    console.error('logFeatureEvent error:', err);
    res.status(204).end();
  }
}
