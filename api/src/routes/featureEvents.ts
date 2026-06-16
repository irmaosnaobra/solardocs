import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { logFeatureEvent } from '../controllers/featureEventsController';

const router = Router();
router.use(authMiddleware);

// Registra uso de feature interna (calculadora etc). Não abate crédito.
router.post('/', logFeatureEvent);

export default router;
