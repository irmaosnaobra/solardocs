import { Router, Request, Response, NextFunction } from 'express';
import { trackVisit, trackEvent } from '../controllers/trackingController';
import { trackLimpapro } from '../controllers/limpaproController';

const router = Router();

// CORS aberto — endpoints públicos de analytics (só escrita, sem dados sensíveis).
// Devolve a origem que chamou, e não '*': o navegador recusa '*' junto de
// Access-Control-Allow-Credentials, e o navigator.sendBeacon SEMPRE manda credencial.
// Com o curinga, toda visita derrubava um erro de CORS no console (o dado até entrava,
// porque o beacon não lê a resposta — mas o console ficava sujo e mascarava erro de verdade).
router.use((req: Request, res: Response, next: NextFunction) => {
  const origem = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origem || '*');
  if (origem) res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// /v e /e = paths neutros (escapam adblocker). /visit e /event = alias temporário.
router.options('/v',        (_req, res) => { res.sendStatus(204); });
router.options('/e',        (_req, res) => { res.sendStatus(204); });
router.options('/visit',    (_req, res) => { res.sendStatus(204); });
router.options('/event',    (_req, res) => { res.sendStatus(204); });
router.options('/limpapro', (_req, res) => { res.sendStatus(204); });

router.post('/v',        trackVisit);
router.post('/e',        trackEvent);
router.post('/visit',    trackVisit);
router.post('/event',    trackEvent);
// Funil LimpaPro (curso de limpeza) — isolado de page_visits
router.post('/limpapro', trackLimpapro);

export default router;
