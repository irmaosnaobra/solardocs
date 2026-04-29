import { Router } from 'express';
import { handleUnsubscribe } from '../controllers/unsubscribeController';

const router = Router();

router.get('/', handleUnsubscribe);
router.post('/', handleUnsubscribe);

export default router;
