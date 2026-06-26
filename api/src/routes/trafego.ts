import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { agendarReuniao, listarReunioes, confirmarReuniao, recusarReuniao } from '../controllers/trafegoController';

const router = Router();

// Cliente autenticado propõe um horário de reunião de tráfego.
router.post('/agendar', authMiddleware, agendarReuniao);

// Painel "SolarDoc Cria Funil Tráfego Pago" — só admin (aiorosgroup) lista e confirma.
router.get('/admin/reunioes', authMiddleware, adminMiddleware, listarReunioes);
router.post('/admin/confirmar', authMiddleware, adminMiddleware, confirmarReuniao);
router.post('/admin/recusar', authMiddleware, adminMiddleware, recusarReuniao);

export default router;
