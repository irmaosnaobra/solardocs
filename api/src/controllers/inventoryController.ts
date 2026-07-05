import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';

// Inventário de materiais/patrimônio da empresa. CRUD por user_id (mesmo padrão
// de clients/terceiros — service key + filtro por user_id). Movimentação de
// entrada/saída passa pela RPC atômica inventory_apply_movement.

const itemSchema = z.object({
  local:          z.string().min(1, 'Local obrigatório').max(60),
  nome:           z.string().min(1, 'Nome obrigatório').max(120),
  marca:          z.string().max(80).optional().nullable(),
  unidade:        z.string().max(16).optional(),
  quantidade:     z.number().min(0).optional(),
  valor_unitario: z.number().min(0).optional(),
  estoque_minimo: z.number().min(0).optional(),
  ordem:          z.number().int().optional(),
});

const movementSchema = z.object({
  tipo:       z.enum(['entrada', 'saida']),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  observacao: z.string().max(200).optional().nullable(),
});

export async function listInventory(req: Request, res: Response): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', req.userId)
      .order('local', { ascending: true })
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true });

    if (error) throw error;
    res.json({ items: data ?? [] });
  } catch (err) {
    console.error('ListInventory error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function createItem(req: Request, res: Response): Promise<void> {
  try {
    const body = itemSchema.parse(req.body);
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({ ...body, user_id: req.userId })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ item: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateItem error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function updateItem(req: Request, res: Response): Promise<void> {
  try {
    const body = itemSchema.partial().parse(req.body);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('inventory_items')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Item não encontrado' });
      return;
    }
    res.json({ item: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpdateItem error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function deleteItem(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Item não encontrado' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error('DeleteItem error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Entrada/saída de estoque. A RPC faz tudo numa transação (lock + valida saldo +
// atualiza + registra movimento). Erros de negócio voltam como mensagem-código.
export async function addMovement(req: Request, res: Response): Promise<void> {
  try {
    const { tipo, quantidade, observacao } = movementSchema.parse(req.body);
    const { id } = req.params;

    const { data, error } = await supabase.rpc('inventory_apply_movement', {
      p_item_id:    id,
      p_user_id:    req.userId,
      p_tipo:       tipo,
      p_quantidade: quantidade,
      p_observacao: observacao ?? null,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('item_nao_encontrado')) {
        res.status(404).json({ error: 'Item não encontrado' });
        return;
      }
      if (msg.includes('estoque_insuficiente')) {
        res.status(400).json({ error: 'Estoque insuficiente para essa saída' });
        return;
      }
      throw error;
    }

    res.json({ item: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('AddMovement error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function listMovements(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('item_id', id)
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json({ movements: data ?? [] });
  } catch (err) {
    console.error('ListMovements error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
