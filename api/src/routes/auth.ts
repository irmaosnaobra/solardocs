import { Router } from 'express';
import { register, login, getMe, forgotPassword, resetPassword, recentSignupsCount } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authMiddleware, getMe);
router.get('/recent-signups', recentSignupsCount);

export default router;
