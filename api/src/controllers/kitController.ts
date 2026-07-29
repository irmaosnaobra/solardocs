import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { acessoDoUsuario } from '../services/kitIntegradorService';

// Kit de Fechamento do Integrador — leitura do acesso e progresso do comprador.
// A aba /materiais do dashboard consome estes dois endpoints.

// GET /kit/meu-acesso — o que este usuário comprou e o que já consumiu.
export async function meuAcesso(req: Request, res: Response): Promise<void> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('email, plano, pack_trial_until')
      .eq('id', req.userId)
      .maybeSingle();

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    const acesso = await acessoDoUsuario(req.userId, user.email);

    const { data: prog } = await supabase
      .from('kit_progresso')
      .select('modulo, concluido_em')
      .eq('user_id', req.userId);

    res.json({
      ...acesso,
      plano: user.plano,
      packTrialUntil: user.pack_trial_until,
      progresso: (prog || []).map((p: { modulo: string }) => p.modulo),
    });
  } catch (err) {
    console.error('meuAcesso error:', err);
    res.status(500).json({ error: 'Erro ao carregar seus materiais' });
  }
}

// GET /kit/missoes — o que o aluno já fez NA PLATAFORMA (não no curso).
// É o que destrava o módulo bônus: empresa cadastrada, cliente cadastrado e
// documento gerado. Só contagem, nada de dado sensível.
export async function missoes(req: Request, res: Response): Promise<void> {
  try {
    const [empresa, clientes, documentos] = await Promise.all([
      supabase.from('company').select('id', { count: 'exact', head: true }).eq('user_id', req.userId),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('user_id', req.userId),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', req.userId),
    ]);

    res.json({
      empresa: (empresa.count ?? 0) > 0,
      clientes: clientes.count ?? 0,
      documentos: documentos.count ?? 0,
    });
  } catch (err) {
    console.error('missoes error:', err);
    // Falha aqui não pode esconder o curso: devolve tudo zerado.
    res.json({ empresa: false, clientes: 0, documentos: 0 });
  }
}

const progressoSchema = z.object({
  modulo: z.string().min(1).max(60),
  concluido: z.boolean().optional(),
});

// POST /kit/progresso — marca/desmarca um módulo como concluído.
export async function marcarProgresso(req: Request, res: Response): Promise<void> {
  try {
    const parsed = progressoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'modulo é obrigatório' });
      return;
    }
    const { modulo, concluido = true } = parsed.data;

    if (concluido) {
      await supabase
        .from('kit_progresso')
        .upsert({ user_id: req.userId, modulo }, { onConflict: 'user_id,modulo' });
    } else {
      await supabase.from('kit_progresso').delete().eq('user_id', req.userId).eq('modulo', modulo);
    }

    res.status(204).end();
  } catch (err) {
    // Progresso é conveniência: nunca derruba a leitura do material.
    console.error('marcarProgresso error:', err);
    res.status(204).end();
  }
}
