import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  contextoDoCurso, listarAulas, lerAula, podeAbrir, progressoDasAulas, marcadosDaAula, modulosConcluidos,
  estadoCertificado, gravarChave, ProgressoCheio, CHAVE_PADRAO, CHAVE_CHECK, type AulaLinha, type ContextoCurso,
} from '../services/limpapro/curso';
import { prepararAula } from '../services/limpapro/aulaHtml';

const router = Router();
router.use(authMiddleware);

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

const MENSAGEM: Record<string, string> = {
  sem_acesso: 'Esta conta ainda não tem o LimpaPro.',
  premium: 'Este bônus é do plano Completo.',
  item: 'Esta aula não está no seu acesso.',
  espera: 'Esta aula abre alguns dias depois da compra.',
};

function recusa(res: Response, aula: AulaLinha, ctx: ContextoCurso): boolean {
  const b = podeAbrir(aula, ctx);
  if (b.ok) return false;
  res.status(403).json({
    error: MENSAGEM[b.motivo], motivo: b.motivo, ...(b.motivo === 'espera' ? { liberaEm: b.liberaEm } : {}),
  });
  return true;
}

/**
 * GET /limpapro/curso — os módulos, as aulas SEM o html e o progresso da pessoa.
 * Quem não tem o curso recebe 200 com `acesso: false` e nada do conteúdo: a tela mostra a venda.
 */
router.get('/curso', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await contextoDoCurso(req.userId);
    if (!ctx) { res.status(404).json({ error: 'Conta não encontrada' }); return; }
    if (!ctx.acesso) { res.json({ acesso: false }); return; }

    const todas = await listarAulas();
    const progresso = progressoDasAulas(ctx.membro);
    // Extra vendido à parte só aparece para quem tem o item; bônus aparece sempre (com cadeado).
    const visiveis = todas.filter((a) => a.grupo !== 'extra' || ctx.itens.has(a.requer) || ctx.isAdmin);
    const aulas = visiveis.map((a) => {
      const b = podeAbrir(a, ctx);
      return {
        slug: a.slug, grupo: a.grupo, modulo: a.modulo, ordem: a.ordem, titulo: a.titulo, resumo: a.resumo,
        minutos: a.minutos, bonus: a.bonus,
        feita: !!progresso[CHAVE_PADRAO(a.slug)],
        bloqueio: b.ok ? null : b.motivo,
        ...(!b.ok && b.motivo === 'espera' ? { liberaEm: b.liberaEm } : {}),
      };
    });
    const { feitos, total } = modulosConcluidos(todas, progresso);
    res.json({
      acesso: true,
      premium: ctx.premium,
      aulas,
      progresso,
      modulosFeitos: feitos,
      modulosTotal: total,
      certificado: estadoCertificado(ctx, todas, progresso),
    });
  } catch (err) {
    console.error('[limpapro/curso] falhou:', err);
    res.status(500).json({ error: 'Não foi possível abrir o curso agora.' });
  }
});

/** GET /limpapro/aulas/:slug — o html (limpo), a prova e os itens marcados. Só com acesso. */
router.get('/aulas/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const slug = String(req.params.slug || '');
    if (!SLUG_RE.test(slug)) { res.status(404).json({ error: 'Aula não encontrada' }); return; }
    const ctx = await contextoDoCurso(req.userId);
    if (!ctx) { res.status(404).json({ error: 'Conta não encontrada' }); return; }
    // Sem acesso, nem confirma que a aula existe.
    if (!ctx.acesso) { res.status(403).json({ error: MENSAGEM.sem_acesso, motivo: 'sem_acesso' }); return; }

    const aula = await lerAula(slug);
    if (!aula) { res.status(404).json({ error: 'Aula não encontrada' }); return; }
    if (recusa(res, aula, ctx)) return;

    const { html, quiz } = prepararAula(aula.html);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      slug: aula.slug, titulo: aula.titulo, minutos: aula.minutos, grupo: aula.grupo, modulo: aula.modulo,
      html, quiz,
      feita: !!progressoDasAulas(ctx.membro)[CHAVE_PADRAO(aula.slug)],
      marcados: marcadosDaAula(ctx.membro, aula.slug),
    });
  } catch (err) {
    console.error('[limpapro/aulas] falhou:', err);
    res.status(500).json({ error: 'Não foi possível abrir a aula agora.' });
  }
});

/**
 * POST /limpapro/progresso
 *   { aula: "m01", concluida: true|false }       marca ou desmarca a aula ("m01#0")
 *   { aula: "plano-7-dias", item: 2, marcado: true|false }   um item do checklist da aula ("chk:plano-7-dias:2")
 * Grava em limpapro_membros.progresso, no formato da área de membros, sem tocar nas outras chaves.
 */
router.post('/progresso', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { aula?: unknown; concluida?: unknown; item?: unknown; marcado?: unknown };
    const slug = String(body.aula ?? '').replace(/#0$/, '');
    if (!SLUG_RE.test(slug)) { res.status(400).json({ error: 'Aula inválida' }); return; }
    const ehCheck = body.item !== undefined;
    if (ehCheck) {
      if (!Number.isInteger(body.item) || (body.item as number) < 0 || (body.item as number) > 99 || typeof body.marcado !== 'boolean') {
        res.status(400).json({ error: 'Item inválido' }); return;
      }
    } else if (typeof body.concluida !== 'boolean') {
      res.status(400).json({ error: 'Informe concluida: true ou false' }); return;
    }

    const ctx = await contextoDoCurso(req.userId);
    if (!ctx) { res.status(404).json({ error: 'Conta não encontrada' }); return; }
    if (!ctx.acesso) { res.status(403).json({ error: MENSAGEM.sem_acesso, motivo: 'sem_acesso' }); return; }

    const aula = await lerAula(slug);
    if (!aula) { res.status(404).json({ error: 'Aula não encontrada' }); return; }
    if (recusa(res, aula, ctx)) return;

    const chave = ehCheck ? CHAVE_CHECK(slug, body.item as number) : CHAVE_PADRAO(slug);
    const valor = ehCheck ? (body.marcado as boolean) : (body.concluida as boolean);
    const r = await gravarChave(ctx, chave, valor);

    const todas = await listarAulas();
    const progresso = progressoDasAulas(r.salvo ? ctx.membro : null);
    const { feitos, total } = modulosConcluidos(todas, progresso);
    res.json({
      ok: true, salvo: r.salvo, progresso, modulosFeitos: feitos, modulosTotal: total,
      certificado: estadoCertificado(ctx, todas, progresso),
    });
  } catch (err) {
    if (err instanceof ProgressoCheio) { res.status(409).json({ error: 'O progresso desta conta chegou ao limite.' }); return; }
    console.error('[limpapro/progresso] falhou:', err);
    res.status(500).json({ error: 'Não foi possível salvar agora.' });
  }
});

export default router;
