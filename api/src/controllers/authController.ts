import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { signToken } from '../utils/jwt';

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

    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: body.email, password_hash, plano: 'free', limite_documentos: 3, documentos_usados: 0 })
      .select('id, email, plano, limite_documentos, documentos_usados, created_at')
      .single();

    if (error) throw error;

    const token = signToken(user.id);
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
