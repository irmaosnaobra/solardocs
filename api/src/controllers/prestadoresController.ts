import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';

const regiaoSchema = z.object({
  cidade: z.string().min(2),
  estado: z.string().length(2),
});

const upsertSchema = z.object({
  nome_empresa: z.string().optional().nullable(),
  responsavel: z.string().min(2),
  whatsapp: z.string().min(8),
  anos_experiencia: z.number().int().min(0).max(80).optional().nullable(),
  time_size: z.number().int().min(1).max(500).optional().nullable(),
  especialidade: z.enum(['instalacao_solar', 'manutencao', 'ambos']).optional().nullable(),
  capacidade_kwp_mes: z.number().min(0).optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
  regioes: z.array(regiaoSchema).min(1, 'Cadastre pelo menos 1 cidade').max(50),
});

const STATUS_VALIDOS = ['pendente', 'aprovado', 'suspenso'] as const;
type Status = typeof STATUS_VALIDOS[number];

async function assertVip(userId: string): Promise<void> {
  const { data: user } = await supabase
    .from('users').select('plano, is_admin').eq('id', userId).single();
  if (!user) throw new ApiError(401, 'Usuário não encontrado');
  if (user.is_admin) return;
  if (user.plano !== 'ilimitado') throw new ApiError(403, 'Recurso exclusivo do plano VIP');
}

// ── /prestadores/me — user vê o próprio cadastro ──────────────────

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const { data: prestador } = await supabase
      .from('prestadores')
      .select('*')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (!prestador) {
      res.json({ prestador: null, regioes: [] });
      return;
    }

    const { data: regioes } = await supabase
      .from('prestador_regioes')
      .select('cidade, estado')
      .eq('prestador_id', prestador.id);

    res.json({ prestador, regioes: regioes ?? [] });
  } catch (err) {
    console.error('GetMe prestador error:', err);
    res.status(500).json({ error: 'Erro ao carregar perfil' });
  }
}

export async function upsertMe(req: Request, res: Response): Promise<void> {
  try {
    await assertVip(req.userId);
    const body = upsertSchema.parse(req.body);

    // Upsert do perfil
    const { data: existing } = await supabase
      .from('prestadores')
      .select('id, status')
      .eq('user_id', req.userId)
      .maybeSingle();

    let prestadorId: string;
    const payload = {
      nome_empresa: body.nome_empresa ?? null,
      responsavel: body.responsavel,
      whatsapp: body.whatsapp,
      anos_experiencia: body.anos_experiencia ?? null,
      time_size: body.time_size ?? null,
      especialidade: body.especialidade ?? null,
      capacidade_kwp_mes: body.capacidade_kwp_mes ?? null,
      observacoes: body.observacoes ?? null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      prestadorId = existing.id;
      await supabase.from('prestadores').update(payload).eq('id', prestadorId);
    } else {
      const { data: created, error } = await supabase
        .from('prestadores')
        .insert({ ...payload, user_id: req.userId, status: 'pendente' })
        .select('id').single();
      if (error) throw error;
      prestadorId = created.id;
    }

    // Substituir regiões: delete tudo e re-insere
    await supabase.from('prestador_regioes').delete().eq('prestador_id', prestadorId);
    if (body.regioes.length > 0) {
      const rows = body.regioes.map(r => ({
        prestador_id: prestadorId,
        cidade: r.cidade.trim(),
        estado: r.estado.toUpperCase(),
      }));
      const { error: regError } = await supabase.from('prestador_regioes').insert(rows);
      if (regError) throw regError;
    }

    res.json({ ok: true, prestador_id: prestadorId, status: existing?.status ?? 'pendente' });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpsertMe prestador error:', err);
    res.status(500).json({ error: 'Erro ao salvar cadastro' });
  }
}

export async function deactivateMe(req: Request, res: Response): Promise<void> {
  try {
    await supabase
      .from('prestadores')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('user_id', req.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('DeactivateMe error:', err);
    res.status(500).json({ error: 'Erro ao desativar' });
  }
}

// ── /prestadores/admin — admin lista todos e modera ───────────────

export async function listAdminAll(_req: Request, res: Response): Promise<void> {
  try {
    const { data: prestadores } = await supabase
      .from('prestadores')
      .select('*, users:user_id(email)')
      .order('created_at', { ascending: false });

    const ids = (prestadores ?? []).map((p: any) => p.id);
    const { data: regioes } = ids.length
      ? await supabase.from('prestador_regioes').select('prestador_id, cidade, estado').in('prestador_id', ids)
      : { data: [] };

    const regioesByPrestador: Record<string, { cidade: string; estado: string }[]> = {};
    (regioes ?? []).forEach((r: any) => {
      (regioesByPrestador[r.prestador_id] = regioesByPrestador[r.prestador_id] || []).push({ cidade: r.cidade, estado: r.estado });
    });

    const result = (prestadores ?? []).map((p: any) => ({
      id: p.id,
      user_id: p.user_id,
      autor_email: p.users?.email ?? null,
      nome_empresa: p.nome_empresa,
      responsavel: p.responsavel,
      whatsapp: p.whatsapp,
      anos_experiencia: p.anos_experiencia,
      time_size: p.time_size,
      especialidade: p.especialidade,
      capacidade_kwp_mes: p.capacidade_kwp_mes,
      observacoes: p.observacoes,
      ativo: p.ativo,
      status: p.status,
      created_at: p.created_at,
      regioes: regioesByPrestador[p.id] ?? [],
    }));

    res.json({ prestadores: result });
  } catch (err) {
    console.error('ListAdminAll prestadores error:', err);
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

    const update: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (status === 'aprovado') {
      update.aprovado_em = new Date().toISOString();
      update.aprovado_por = req.userId;
    }

    const { error } = await supabase.from('prestadores').update(update).eq('id', id);
    if (error) throw error;

    res.json({ ok: true, status });
  } catch (err) {
    console.error('ChangeStatus prestador error:', err);
    res.status(500).json({ error: 'Erro ao mudar status' });
  }
}
