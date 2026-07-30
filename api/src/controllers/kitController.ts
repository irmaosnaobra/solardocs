import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { acessoDoUsuario } from '../services/kitIntegradorService';

// Kit de Fechamento do Integrador — leitura do acesso e progresso do comprador.
// A aba /materiais do dashboard consome estes dois endpoints.

// GET /kit/meu-acesso — o que este usuário comprou e o que já consumiu.
export async function meuAcesso(req: Request, res: Response): Promise<void> {
  try {
    // `curso_vitalicio` (MIGRATION_curso_vitalicio.sql) é o grandfather de quem
    // já tinha o curso pelo plano. Se a migration ainda NÃO rodou, o Postgres
    // devolve 42703 (coluna inexistente) — aí caímos no comportamento antigo em
    // vez de trancar a base inteira. Deploy antes da migration não machuca: o
    // curso simplesmente continua liberado pra assinante até o SQL rodar.
    const COLUNAS = 'email, plano, pack_trial_until, curso_vitalicio';
    let { data: user, error: eUser } = await supabase
      .from('users').select(COLUNAS).eq('id', req.userId).maybeSingle();
    const semColuna = !!eUser && (eUser.code === '42703' || /curso_vitalicio/.test(eUser.message || ''));
    if (semColuna) {
      ({ data: user } = await supabase
        .from('users').select('email, plano, pack_trial_until').eq('id', req.userId).maybeSingle());
    } else if (eUser) {
      throw eUser;
    }

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    const acesso = await acessoDoUsuario(req.userId, user.email);

    const { data: prog } = await supabase
      .from('kit_progresso')
      .select('modulo, concluido_em')
      .eq('user_id', req.userId);

    // Quem pode abrir o curso — decidido AQUI, não na tela.
    //
    // ASSINATURA NÃO LIBERA MAIS (30/07/2026): o curso virou produto à parte,
    // quem quiser compra. A campanha "o curso entra junto no VIP" foi removida
    // junto — não sobrou promessa de inclusão em nenhuma tela.
    //
    // 1. COMPRA (itens.length > 0): vale pra sempre. Inclui quem levou só o
    //    order bump: ele fica 'ilimitado' por 30 dias e temKit=false, então um
    //    gate por plano tiraria o curso dele no dia 31 depois de ter pago.
    // 2. VITALÍCIO: o grandfather da virada. A migration carimbou quem tinha o
    //    curso naquele dia — assinante pagante e quem já estava estudando —
    //    inclusive quem assinou POR CAUSA da campanha antiga. Tirar deles seria
    //    quebrar promessa já paga. Quem está nos 7 dias grátis NÃO entrou.
    // 3. LEGADO: a migration ainda não rodou — mantém a regra antiga em vez de
    //    trancar todo mundo. Some sozinho quando o SQL subir.
    //
    // kit_progresso NÃO libera nada. Foi tentador usar "já tem progresso" como
    // prova de que a pessoa estudava, mas POST /kit/progresso não checa acesso:
    // qualquer usuário logado gravaria uma linha e se daria o curso de graça.
    // Quem estudava de verdade foi carimbado pelo backfill B da migration — uma
    // foto do passado, que ninguém consegue forjar depois.
    //
    // A tela continua desenhando o cadeado, mas quem decide é o servidor: assim a
    // regra muda num lugar só e não depende de o front estar atualizado.
    const comprou = acesso.itens.length > 0;
    const vitalicio = (user as { curso_vitalicio?: boolean }).curso_vitalicio === true;
    const legado = semColuna && (user.plano === 'pro' || user.plano === 'ilimitado');
    const liberado = comprou || vitalicio || legado;

    res.json({
      ...acesso,
      liberado,
      motivoAcesso: comprou ? 'compra'
        : vitalicio ? 'vitalicio'
        : legado ? 'legado'
        : null,
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

// POST /kit/app-instalado — a pessoa instalou o app (PWA) no aparelho.
// Chamado pelo InstallBanner: quando ela aceita o prompt nativo e também no
// primeiro carregamento já em modo standalone — o iPhone não dispara evento de
// instalação, e sem esse segundo caminho o número do iOS ficaria sempre zero.
// Só carimba a PRIMEIRA vez: o que interessa é quando virou app, não quantas
// vezes abriu. Erro aqui é silencioso — medição nunca pode atrapalhar o uso.
export async function marcarAppInstalado(req: Request, res: Response): Promise<void> {
  try {
    await supabase
      .from('users')
      .update({ app_instalado_em: new Date().toISOString() })
      .eq('id', req.userId)
      .is('app_instalado_em', null);
  } catch (err) {
    console.error('marcarAppInstalado error:', err);
  }
  res.status(204).send();
}
