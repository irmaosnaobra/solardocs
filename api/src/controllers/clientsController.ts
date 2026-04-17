import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';

const clientSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  tipo: z.enum(['PF', 'PJ']).default('PF'),
  nacionalidade: z.string().optional(),
  cpf_cnpj: z.string().optional(),
  endereco: z.string().optional(),
  cep: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  concessionaria: z.string().optional(),
  email: z.string().optional(),
  telefone: z.string().optional(),
  telefone2: z.string().optional(),
  padrao: z.enum(['Monofásico', 'Bifásico', 'Trifásico']).optional(),
  tipo_telhado: z.enum(['Fibromadeira', 'Fibrometal', 'Cimento', 'Cerâmico', 'Zinco', 'Sanduíche', 'Solo', 'Carport', 'Estrutura Metálica', 'Outro']).optional(),
});

export async function listClients(req: Request, res: Response): Promise<void> {
  try {
    const search = req.query.search as string | undefined;
    let query = supabase.from('clients').select('*').eq('user_id', req.userId).order('nome');

    if (search) query = query.ilike('nome', `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ clients: data });
  } catch (err) {
    console.error('ListClients error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function createClient(req: Request, res: Response): Promise<void> {
  try {
    const body = clientSchema.parse(req.body);
    const { data, error } = await supabase
      .from('clients')
      .insert({ ...body, user_id: req.userId })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ client: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateClient error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function updateClient(req: Request, res: Response): Promise<void> {
  try {
    const body = clientSchema.partial().parse(req.body);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('clients')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Cliente não encontrado' });
      return;
    }
    res.json({ client: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpdateClient error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function deleteClient(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Cliente não encontrado' });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    if (err?.code === '23503') {
      res.status(409).json({ error: 'Este cliente possui documentos vinculados. Exclua os documentos primeiro.' });
      return;
    }
    console.error('DeleteClient error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
