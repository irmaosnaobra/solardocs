import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';

const terceiroSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  tipo: z.enum(['PF', 'PJ']).default('PJ'),
  cpf_cnpj: z.string().optional(),
  endereco: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  representante_nome: z.string().optional(),
  representante_cpf: z.string().optional(),
  email: z.string().optional(),
  telefone: z.string().optional(),
  telefone2: z.string().optional(),
});

export async function listTerceiros(req: Request, res: Response): Promise<void> {
  try {
    const search = req.query.search as string | undefined;
    let query = supabase.from('terceiros').select('*').eq('user_id', req.userId).order('nome');
    if (search) query = query.ilike('nome', `%${search}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ terceiros: data });
  } catch (err) {
    console.error('ListTerceiros error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function createTerceiro(req: Request, res: Response): Promise<void> {
  try {
    const body = terceiroSchema.parse(req.body);
    const { data, error } = await supabase
      .from('terceiros')
      .insert({ ...body, user_id: req.userId })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ terceiro: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateTerceiro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function updateTerceiro(req: Request, res: Response): Promise<void> {
  try {
    const body = terceiroSchema.partial().parse(req.body);
    const { id } = req.params;
    const { data, error } = await supabase
      .from('terceiros')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();
    if (error || !data) {
      res.status(404).json({ error: 'Terceiro não encontrado' });
      return;
    }
    res.json({ terceiro: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpdateTerceiro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function deleteTerceiro(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('terceiros')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Terceiro não encontrado' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error('DeleteTerceiro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
