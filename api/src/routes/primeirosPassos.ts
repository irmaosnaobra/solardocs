import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getPrimeirosPassos, putPrimeirosPassosWhatsapp } from '../controllers/primeirosPassosController';

const router = Router();

router.use(authMiddleware);

router.get('/', getPrimeirosPassos);
router.put('/whatsapp', putPrimeirosPassosWhatsapp);

export default router;
