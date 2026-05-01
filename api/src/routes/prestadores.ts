import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import {
  getMe, upsertMe, deactivateMe,
  listAdminAll, changeStatus,
} from '../controllers/prestadoresController';

const router = Router();
router.use(authMiddleware);

// Próprio cadastro do user
router.get('/me', getMe);
router.post('/me', upsertMe);
router.delete('/me', deactivateMe);

// Admin
router.get('/admin/all', adminMiddleware, listAdminAll);
router.patch('/admin/:id/status', adminMiddleware, changeStatus);

export default router;
