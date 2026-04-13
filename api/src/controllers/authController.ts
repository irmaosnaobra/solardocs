import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { signToken } from '../utils/jwt';
import { sendMetaEvent } from '../utils/metaPixel';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PRICE_TO_PLAN: Record<string, { plano: string; limite: number }> = {
  [process.env.STRIPE_PRICE_INICIANTE!]: { plano: 'iniciante', limite: 15 },
  [process.env.STRIPE_PRICE_PRO!]:       { plano: 'pro',       limite: 35 },
  [process.env.STRIPE_PRICE_VIP!]:       { plano: 'ilimitado', limite: 999999 },
};

async function detectStripePlan(email: string): Promise<{ plano: string; limite: number } | null> {
  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (!customers.data.length) return null;
    const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
    if (!subs.data.length) return null;
    const priceId = subs.data[0].items.data[0]?.price?.id ?? '';
    return PRICE_TO_PLAN[priceId] ?? null;
  } catch {
    return null;
  }
}

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
});

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const body = registerSchema.parse(req.body);

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', body.email)
      .single();

    if (existing) {
      res.status(409).json({ error: 'Email já cadastrado' });
      return;
    }

    const password_hash = await bcrypt.hash(body.password, 12);

    // Verifica se o e-mail já possui assinatura ativa no Stripe (comprou antes de cadastrar)
    const stripePlan = await detectStripePlan(body.email);
    const plano           = stripePlan?.plano  ?? 'free';
    const limite_documentos = stripePlan?.limite ?? 0;

    const dataReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: body.email, password_hash, plano, limite_documentos, documentos_usados: 0, data_reset: dataReset })
      .select('id, email, plano, limite_documentos, documentos_usados, created_at')
      .single();

    if (error) throw error;

    const token = signToken(user.id);

    // Meta CAPI — Lead (server-side, deduplica com pixel client)
    sendMetaEvent('Lead', {
      eventId:   req.headers['x-meta-event-id'] as string | undefined,
      email:     body.email,
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ token, user });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const body = loginSchema.parse(req.body);

    const { data: user } = await supabase
      .from('users')
      .select('id, email, password_hash, plano, limite_documentos, documentos_usados, data_reset, created_at')
      .eq('email', body.email)
      .single();

    if (!user) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    const validPassword = await bcrypt.compare(body.password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    const { password_hash: _, ...userWithoutPassword } = user;
    const token = signToken(user.id);
    res.json({ token, user: userWithoutPassword });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, plano, limite_documentos, documentos_usados, data_reset, created_at, is_admin')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error('GetMe error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
