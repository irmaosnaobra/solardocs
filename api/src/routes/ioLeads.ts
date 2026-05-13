import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import {
  createIoLead, listIoLeads, updateIoLead, getIoLeadHistory,
} from '../controllers/ioLeadsController';

const router = Router();

// POST público (chamado pelo simulador /io/simular) — CORS aberto
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
router.options('/', (_req, res) => { res.sendStatus(204); });
router.post('/', createIoLead);

// Demais endpoints exigem admin
router.get('/',           authMiddleware, adminMiddleware, listIoLeads);
router.patch('/:id',      authMiddleware, adminMiddleware, updateIoLead);
router.get('/:id/history',authMiddleware, adminMiddleware, getIoLeadHistory);

export default router;
