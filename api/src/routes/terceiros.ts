import { Router } from 'express';
import { listTerceiros, createTerceiro, updateTerceiro, deleteTerceiro } from '../controllers/terceirosController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);
router.get('/', listTerceiros);
router.post('/', createTerceiro);
router.put('/:id', updateTerceiro);
router.delete('/:id', deleteTerceiro);
export default router;
