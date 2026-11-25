// ───────────────────────────────────────────────────────────────────────────
// ROTAS DA DOMINA IA NO ADMIN (24/11/2026): resumo (vendas e leads da Stripe, lidos pelo site), o funil do quiz,
// quem passou em cada tela e a jornada de uma sessão. Montado em routes/admin.ts em /dominaia, DEPOIS do
// authMiddleware e do adminMiddleware que o router já aplica. A conta mora em services/dominaia/.
// Contrato com o painel: /resumo, /quiz-funil, /quiz-funil/sessoes e /quiz-funil/sessao/:sid (mais o atalho /sessao/:sid).
// ───────────────────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { lerFunilDominaia } from '../services/dominaia/painelQuizDominaia';
import { lerResumoDominaia } from '../services/dominaia/resumoDominaia';
import { lerSessoesDaTela, lerJornadaDaSessao, passoValido } from '../services/dominaia/sessoesQuizDominaia';

const router = Router();

const texto = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : null);
const SID_VALIDO = /^[A-Za-z0-9_.:-]{1,80}$/;

function falhou(res: Response, err: unknown): void {
  res.status(500).json({ error: String((err as Error)?.message || err) });
}

// O funil da primeira à última etapa, com recortes por país, aparelho e anúncio. Os filtros valem pela sessão.
router.get('/quiz-funil', async (req: Request, res: Response): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await lerFunilDominaia(String(req.query.period || '7dias'), {
      pais: texto(req.query.pais)?.toUpperCase() ?? null,
      disp: texto(req.query.disp)?.toLowerCase() ?? null,
      anuncio: texto(req.query.anuncio),
      conjunto: texto(req.query.conjunto),
    }));
  } catch (err) { falhou(res, err); }
});

// Vendas e leads da Stripe (lidos pelo site da Domina IA) mais o app de lp_events.
// Site fora ou sem DOMINAIA_ADMIN_TOKEN: 200 com indisponivel, para o painel avisar em vez de quebrar.
router.get('/resumo', async (req: Request, res: Response): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await lerResumoDominaia(String(req.query.period || '7dias')));
  } catch (err) { falhou(res, err); }
});

// Chegaram (passou da tela N) ou saíram (parou na N). 50 por página, até 500; o cursor é o ponto de partida da próxima.
router.get('/quiz-funil/sessoes', async (req: Request, res: Response): Promise<void> => {
  const passo = passoValido(req.query.passo);
  if (passo === null) { res.status(400).json({ error: 'passo_invalido' }); return; }
  const tipo = texto(req.query.tipo) ?? 'chegaram';
  if (tipo !== 'chegaram' && tipo !== 'sairam') { res.status(400).json({ error: 'tipo_invalido' }); return; }
  const cursor = texto(req.query.cursor);
  if (cursor !== null && !/^\d{1,4}$/.test(cursor)) { res.status(400).json({ error: 'cursor_invalido' }); return; }
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await lerSessoesDaTela(String(req.query.period || '7dias'), {
      passo, tipo, cursor: cursor ? Number(cursor) : 0,
      filtros: {
        pais: texto(req.query.pais)?.toUpperCase() ?? null,
        disp: texto(req.query.disp)?.toLowerCase() ?? null,
        anuncio: texto(req.query.anuncio),
        conjunto: texto(req.query.conjunto),
      },
    }));
  } catch (err) { falhou(res, err); }
});

// A jornada de uma sessão. Dois caminhos para a mesma leitura: /quiz-funil/sessao/:sid e o curto /sessao/:sid.
async function jornada(req: Request, res: Response): Promise<void> {
  const sid = String(req.params.sid);
  if (!SID_VALIDO.test(sid)) { res.status(400).json({ error: 'sid_invalido' }); return; }
  try {
    res.set('Cache-Control', 'no-store');
    const j = await lerJornadaDaSessao(sid);
    if (!j) { res.status(404).json({ error: 'sessao_nao_encontrada' }); return; }
    res.json(j);
  } catch (err) { falhou(res, err); }
}
router.get('/quiz-funil/sessao/:sid', jornada);
router.get('/sessao/:sid', jornada);

export default router;
