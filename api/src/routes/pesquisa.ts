// ─────────────────────────────────────────────────────────────────────────────
// AS ROTAS DAS PESQUISAS (04/11/2026).
//   GET  /pesquisa/:tipo/:token   -> { ok, nome, empresa, cidade } para preencher o formulário (tipo: saida | depoimento)
//   POST /pesquisa/:tipo/:token   -> grava a resposta (upsert) e avisa o Thiago
//   GET  /admin/pesquisas         -> as respostas dos dois tipos (só admin)
// As públicas têm limite por IP. O token só abre se o e-mail o gravou (token.ts): link inventado e token de outro tipo dão 404.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { logger } from '../utils/logger';
import { ehTipoPesquisa, resolverToken } from '../services/pesquisa/token';
import { avisarThiago, gravarResposta, lerContexto, listarRespostas, validarResposta } from '../services/pesquisa/respostas';

const limite = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { ok: false, error: 'Muitas tentativas. Tente de novo em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const pesquisaPublicaRouter = Router();
pesquisaPublicaRouter.use(limite);

const INVALIDO = { ok: false, error: 'Este link não vale mais. Peça um novo respondendo o e-mail.' };

pesquisaPublicaRouter.get('/:tipo/:token', async (req: Request, res: Response) => {
  const tipo = req.params.tipo;
  if (!ehTipoPesquisa(tipo)) { res.status(404).json(INVALIDO); return; }
  const userId = await resolverToken(tipo, req.params.token);
  if (!userId) { res.status(404).json(INVALIDO); return; }
  try {
    const ctx = await lerContexto(userId);
    if (!ctx) { res.status(404).json(INVALIDO); return; }
    res.json({ ok: true, nome: ctx.nome, empresa: ctx.empresa, cidade: ctx.cidade });
  } catch (e) {
    logger.error('pesquisa', `GET falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
    res.status(500).json({ ok: false, error: 'Erro interno do servidor.' });
  }
});

pesquisaPublicaRouter.post('/:tipo/:token', async (req: Request, res: Response) => {
  const tipo = req.params.tipo;
  if (!ehTipoPesquisa(tipo)) { res.status(404).json(INVALIDO); return; }
  const userId = await resolverToken(tipo, req.params.token);
  if (!userId) { res.status(404).json(INVALIDO); return; }
  const v = validarResposta(tipo, req.body);
  if (!v.ok) { res.status(400).json({ ok: false, error: v.erro }); return; }
  try {
    const { valor, avisar } = await gravarResposta(tipo, userId, v.dados, 'formulario');
    // O Thiago só é avisado na 1ª resposta da pessoa neste tipo, ou quando o conteúdo mudou: repetição idêntica (duplo clique, reenvio) não avisa.
    if (avisar) await avisarThiago(tipo, userId, valor, await lerContexto(userId).catch(() => null));
    res.json({ ok: true });
  } catch (e) {
    logger.error('pesquisa', `POST falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
    res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
  }
});

/** Já atrás do login e do guard de admin que o resto do /admin usa. Montar ANTES de `app.use('/admin', ...)`. */
export const pesquisaAdminRouter = Router();
pesquisaAdminRouter.use(authMiddleware);
pesquisaAdminRouter.use(adminMiddleware);

pesquisaAdminRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const linhas = await listarRespostas();
    res.json({
      ok: true,
      total: linhas.length,
      saida: linhas.filter(l => l.tipo === 'saida'),
      depoimento: linhas.filter(l => l.tipo === 'depoimento'),
    });
  } catch (e) {
    logger.error('pesquisa', `admin falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
    res.status(500).json({ ok: false, error: 'Erro interno do servidor.' });
  }
});
