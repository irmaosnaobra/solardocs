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

const STATUS_VALIDOS = ['recebido', 'aprovada', 'em_desenvolvimento', 'publicada', 'rejeitada'] as const;
type Status = typeof STATUS_VALIDOS[number];

async function assertVip(userId: string): Promise<{ plano: string; email: string; is_admin?: boolean }> {
  const { data: user } = await supabase
    .from('users')
    .select('plano, email, is_admin')
    .eq('id', userId)
    .single();

  if (!user) throw new ApiError(401, 'Usuário não encontrado');
  if (user.is_admin) return user; // admin é VIP por extensão
  if (user.plano !== 'ilimitado') {
    throw new ApiError(403, 'Recurso exclusivo do plano VIP');
  }
  return user;
}

// ── Próprias sugestões do user ───────────────────────────────────────

export async function listSuggestions(req: Request, res: Response): Promise<void> {
  try {
    await assertVip(req.userId);

    const { data, error } = await supabase
      .from('suggestions')
      .select('id, titulo, descricao, arquivo_nome, status, votos_count, comentarios_count, created_at')
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

// ── Feed público (qualquer user logado vê o roadmap) ────────────────

export async function listFeed(req: Request, res: Response): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('suggestions')
      .select('id, titulo, descricao, status, votos_count, comentarios_count, created_at, user_id, users:user_id(email)')
      .in('status', ['aprovada', 'em_desenvolvimento', 'publicada'])
      .order('votos_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Pega quais o user atual votou
    const { data: meusVotos } = await supabase
      .from('suggestion_votes')
      .select('suggestion_id')
      .eq('user_id', req.userId);
    const votedSet = new Set((meusVotos ?? []).map((v: any) => v.suggestion_id));

    const suggestions = (data ?? []).map((s: any) => ({
      id: s.id,
      titulo: s.titulo,
      descricao: s.descricao,
      status: s.status,
      votos_count: s.votos_count,
      comentarios_count: s.comentarios_count,
      created_at: s.created_at,
      autor_email: s.users?.email ?? null,
      voted: votedSet.has(s.id),
    }));

    res.json({ suggestions });
  } catch (err) {
    console.error('ListFeed error:', err);
    res.status(500).json({ error: 'Erro ao buscar feed' });
  }
}

// ── Toggle vote (VIP only) ─────────────────────────────────────────

export async function toggleVote(req: Request, res: Response): Promise<void> {
  try {
    await assertVip(req.userId);
    const { id } = req.params;

    const { data: existing } = await supabase
      .from('suggestion_votes')
      .select('id')
      .eq('suggestion_id', id)
      .eq('user_id', req.userId)
      .maybeSingle();

    let voted: boolean;
    if (existing) {
      await supabase.from('suggestion_votes').delete().eq('id', existing.id);
      voted = false;
    } else {
      const { error } = await supabase
        .from('suggestion_votes')
        .insert({ suggestion_id: id, user_id: req.userId });
      if (error) throw error;
      voted = true;
    }

    // Recalcula contador
    const { count } = await supabase
      .from('suggestion_votes')
      .select('*', { count: 'exact', head: true })
      .eq('suggestion_id', id);
    await supabase.from('suggestions').update({ votos_count: count ?? 0 }).eq('id', id);

    res.json({ voted, votos_count: count ?? 0 });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('ToggleVote error:', err);
    res.status(500).json({ error: 'Erro ao votar' });
  }
}

// ── Comentários ─────────────────────────────────────────────────────

export async function listComments(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('suggestion_comments')
      .select('id, texto, created_at, user_id, users:user_id(email)')
      .eq('suggestion_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const comments = (data ?? []).map((c: any) => ({
      id: c.id,
      texto: c.texto,
      created_at: c.created_at,
      autor_email: c.users?.email ?? null,
    }));

    res.json({ comments });
  } catch (err) {
    console.error('ListComments error:', err);
    res.status(500).json({ error: 'Erro ao buscar comentários' });
  }
}

const commentSchema = z.object({
  texto: z.string().min(3, 'Comentário muito curto').max(2000, 'Comentário muito longo'),
});

export async function createComment(req: Request, res: Response): Promise<void> {
  try {
    await assertVip(req.userId);
    const { id } = req.params;
    const { texto } = commentSchema.parse(req.body);

    const { data, error } = await supabase
      .from('suggestion_comments')
      .insert({ suggestion_id: id, user_id: req.userId, texto: texto.trim() })
      .select('id, texto, created_at')
      .single();

    if (error) throw error;

    // Atualiza contador
    const { count } = await supabase
      .from('suggestion_comments')
      .select('*', { count: 'exact', head: true })
      .eq('suggestion_id', id);
    await supabase.from('suggestions').update({ comentarios_count: count ?? 0 }).eq('id', id);

    res.status(201).json({ comment: data });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateComment error:', err);
    res.status(500).json({ error: 'Erro ao comentar' });
  }
}

// ── Admin: lista todas + moderação ──────────────────────────────────

export async function listAdminAll(_req: Request, res: Response): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('suggestions')
      .select('id, titulo, descricao, status, votos_count, comentarios_count, created_at, user_id, users:user_id(email)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const suggestions = (data ?? []).map((s: any) => ({
      id: s.id,
      titulo: s.titulo,
      descricao: s.descricao,
      status: s.status,
      votos_count: s.votos_count,
      comentarios_count: s.comentarios_count,
      created_at: s.created_at,
      autor_email: s.users?.email ?? null,
    }));

    res.json({ suggestions });
  } catch (err) {
    console.error('ListAdminAll error:', err);
    res.status(500).json({ error: 'Erro ao listar' });
  }
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const status = String((req.body as any)?.status || '') as Status;

    if (!STATUS_VALIDOS.includes(status)) {
      res.status(400).json({ error: 'Status inválido' });
      return;
    }

    const update: Record<string, any> = { status };
    if (status === 'aprovada') {
      update.aprovada_em = new Date().toISOString();
      update.aprovada_por = req.userId;
    }

    const { error } = await supabase.from('suggestions').update(update).eq('id', id);
    if (error) throw error;

    res.json({ ok: true, status });
  } catch (err) {
    console.error('ChangeStatus error:', err);
    res.status(500).json({ error: 'Erro ao mudar status' });
  }
}
