import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { getUsers, triggerMonthlyReset, getVisits, getAnalytics, getMetaFunnel } from '../controllers/adminController';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users',          getUsers);
router.post('/reset-monthly', triggerMonthlyReset);
router.get('/visits',         getVisits);
router.get('/analytics',      getAnalytics);
router.get('/meta-funnel',    getMetaFunnel);

export default router;
