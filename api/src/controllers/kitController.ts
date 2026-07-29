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

// ── Avaliações (5 estrelas + comentário) ────────────────────────────────────
// Coletadas ao concluir cada módulo e ao concluir o curso. Vão para o banco com
// aprovado=false: NADA aparece na página de venda sem o Thiago escolher no
// /admin, e só com autorização explícita do aluno.

const avaliacaoSchema = z.object({
  cursoSlug: z.string().min(1).max(60),
  moduloSlug: z.string().max(60).optional(),   // vazio = avaliação do curso inteiro
  estrelas: z.number().int().min(1).max(5),
  comentario: z.string().max(1200).optional(),
  nomeExibicao: z.string().max(80).optional(),
  empresa: z.string().max(80).optional(),
  cidade: z.string().max(80).optional(),
  autorizaPublicar: z.boolean().optional(),
});

// POST /kit/avaliacao — cria ou atualiza a avaliação do aluno.
export async function salvarAvaliacao(req: Request, res: Response): Promise<void> {
  try {
    const parsed = avaliacaoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Avaliação inválida' });
      return;
    }
    const a = parsed.data;

    const { error } = await supabase.from('curso_avaliacoes').upsert(
      {
        user_id: req.userId,
        curso_slug: a.cursoSlug,
        modulo_slug: a.moduloSlug || '',
        estrelas: a.estrelas,
        comentario: a.comentario?.trim() || null,
        nome_exibicao: a.nomeExibicao?.trim() || null,
        empresa: a.empresa?.trim() || null,
        cidade: a.cidade?.trim() || null,
        autoriza_publicar: a.autorizaPublicar ?? false,
        // Editou a avaliação? Volta para a fila de moderação.
        aprovado: false,
        aprovado_em: null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'user_id,curso_slug,modulo_slug' },
    );

    if (error) {
      console.error('salvarAvaliacao error:', error);
      res.status(500).json({ error: 'Não consegui salvar sua avaliação' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error('salvarAvaliacao error:', err);
    res.status(500).json({ error: 'Não consegui salvar sua avaliação' });
  }
}

// GET /kit/avaliacoes?curso=slug — o que ESTE aluno já avaliou.
export async function minhasAvaliacoes(req: Request, res: Response): Promise<void> {
  try {
    const curso = String(req.query.curso || '').trim();
    let q = supabase
      .from('curso_avaliacoes')
      .select('curso_slug, modulo_slug, estrelas, comentario, nome_exibicao, empresa, cidade, autoriza_publicar')
      .eq('user_id', req.userId);
    if (curso) q = q.eq('curso_slug', curso);

    const { data } = await q;
    res.json({ avaliacoes: data ?? [] });
  } catch (err) {
    console.error('minhasAvaliacoes error:', err);
    res.json({ avaliacoes: [] });
  }
}

// GET /kit/depoimentos?curso=slug — PÚBLICO. Só o que foi aprovado E autorizado.
// É o que a landing consome; enquanto não houver nada aprovado, devolve lista
// vazia e a página simplesmente não mostra a seção.
export async function depoimentosPublicos(req: Request, res: Response): Promise<void> {
  try {
    const curso = String(req.query.curso || 'kit-fechamento').trim();
    const { data } = await supabase
      .from('curso_avaliacoes')
      .select('estrelas, comentario, nome_exibicao, empresa, cidade, criado_em')
      .eq('curso_slug', curso)
      .eq('aprovado', true)
      .eq('autoriza_publicar', true)
      .not('comentario', 'is', null)
      .order('aprovado_em', { ascending: false })
      .limit(12);

    const depoimentos = (data ?? []).map((d: {
      estrelas: number; comentario: string | null;
      nome_exibicao: string | null; empresa: string | null; cidade: string | null;
    }) => ({
      estrelas: d.estrelas,
      comentario: d.comentario,
      nome: d.nome_exibicao,
      empresa: d.empresa,
      cidade: d.cidade,
    }));

    res.json({ depoimentos });
  } catch (err) {
    console.error('depoimentosPublicos error:', err);
    res.json({ depoimentos: [] });
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
