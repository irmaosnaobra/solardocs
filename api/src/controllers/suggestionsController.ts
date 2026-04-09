import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';
import { sendSuggestionEmail } from '../utils/mailer';

const suggestionSchema = z.object({
  titulo: z.string().min(3, 'Título obrigatório'),
  descricao: z.string().min(10, 'Descreva melhor sua sugestão'),
  arquivo_nome: z.string().optional(),
  arquivo_base64: z.string().optional(),
});

async function assertVip(userId: string): Promise<{ plano: string; email: string }> {
  const { data: user } = await supabase
    .from('users')
    .select('plano, email')
    .eq('id', userId)
    .single();

  if (!user || user.plano !== 'ilimitado') {
    throw new ApiError(403, 'Recurso exclusivo do plano VIP');
  }
  return user;
}

export async function listSuggestions(req: Request, res: Response): Promise<void> {
  try {
    await assertVip(req.userId);

    const { data, error } = await supabase
      .from('suggestions')
      .select('id, titulo, descricao, arquivo_nome, status, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ suggestions: data });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('ListSuggestions error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function createSuggestion(req: Request, res: Response): Promise<void> {
  try {
    const vipUser = await assertVip(req.userId);
    const body = suggestionSchema.parse(req.body);

    if (body.arquivo_base64 && body.arquivo_base64.length > 7_000_000) {
      res.status(400).json({ error: 'Arquivo muito grande. Limite de 5 MB.' });
      return;
    }

    const { data, error } = await supabase
      .from('suggestions')
      .insert({ ...body, user_id: req.userId, status: 'recebido' })
      .select()
      .single();

    if (error) throw error;

    // Envia email em background — não bloqueia a resposta ao cliente
    sendSuggestionEmail({
      titulo: body.titulo,
      descricao: body.descricao,
      userEmail: vipUser.email,
      arquivoNome: body.arquivo_nome,
      arquivoBase64: body.arquivo_base64,
    }).catch((err) => console.error('Email send error:', err));

    res.status(201).json({ suggestion: data });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateSuggestion error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
