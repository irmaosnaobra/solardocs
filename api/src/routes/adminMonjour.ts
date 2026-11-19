// ───────────────────────────────────────────────────────────────────────────
// ROTAS DO MONJOUR NO ADMIN (19/11/2026): quem passou em cada tela do quiz, a jornada
// de uma sessão, os membros do app e "o que mais gostam". Montado em routes/admin.ts
// em /monjour, DEPOIS do authMiddleware e do adminMiddleware que o router já aplica.
// A conta mora em services/monjour/. Contrato: Desktop\ligera\JORNADAS-CONTRATO.md.
// ───────────────────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { lerSessoesDaTela, lerJornadaDaSessao, passoValido } from '../services/monjour/sessoesQuizMonjour';
import { lerMembros, lerMembro } from '../services/monjour/membrosMonjour';
import { lerGostos } from '../services/monjour/gostosMonjour';
import { MEMBRO_VALIDO } from '../services/monjour/leituraAppMonjour';

const router = Router();

const texto = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : null);
const SID_VALIDO = /^[A-Za-z0-9_.:-]{1,80}$/;

function falhou(res: Response, err: unknown): void {
  res.status(500).json({ error: String((err as Error)?.message || err) });
}

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

router.get('/quiz-funil/sessao/:sid', async (req: Request, res: Response): Promise<void> => {
  const sid = String(req.params.sid);
  if (!SID_VALIDO.test(sid)) { res.status(400).json({ error: 'sid_invalido' }); return; }
  try {
    res.set('Cache-Control', 'no-store');
    const jornada = await lerJornadaDaSessao(sid);
    if (!jornada) { res.status(404).json({ error: 'sessao_nao_encontrada' }); return; }
    res.json(jornada);
  } catch (err) { falhou(res, err); }
});

// A lista mostra todos os membros; o período vale só para os dias ativos de cada um.
router.get('/membros', async (req: Request, res: Response): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await lerMembros(String(req.query.period || 'maximo'), {
      q: (texto(req.query.q) ?? '').slice(0, 80),
      plano: (texto(req.query.plano) ?? '').toLowerCase(),
      parados: req.query.parados === '1',
    }));
  } catch (err) { falhou(res, err); }
});

router.get('/membros/:m', async (req: Request, res: Response): Promise<void> => {
  const m = String(req.params.m).toLowerCase();
  if (!MEMBRO_VALIDO.test(m)) { res.status(400).json({ error: 'membro_invalido' }); return; }
  try {
    res.set('Cache-Control', 'no-store');
    const detalhe = await lerMembro(m);
    if (!detalhe) { res.status(404).json({ error: 'membro_nao_encontrado' }); return; }
    res.json(detalhe);
  } catch (err) { falhou(res, err); }
});

router.get('/gostos', async (req: Request, res: Response): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await lerGostos(String(req.query.period || '7dias')));
  } catch (err) { falhou(res, err); }
});

export default router;
