import { Router } from 'express';
import { sendPixelEvent } from '../controllers/pixelController';

const router = Router();

// Endpoint público para receber eventos do simulador
router.post('/', sendPixelEvent);

export default router;
