import { Router, Request, Response, NextFunction } from 'express';
import { trackVisit, trackEvent } from '../controllers/trackingController';

const router = Router();

// CORS aberto — endpoints públicos de analytics (só escrita, sem dados sensíveis)
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

router.options('/visit', (_req, res) => { res.sendStatus(204); });
router.options('/event',  (_req, res) => { res.sendStatus(204); });

router.post('/visit', trackVisit);
router.post('/event', trackEvent);

export default router;
