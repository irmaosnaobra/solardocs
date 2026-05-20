import { Router } from 'express';
import { createCheckout, stripeWebhook, getCheckoutInfo, createBillingPortal } from '../controllers/paymentsController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/create-checkout', authMiddleware, createCheckout);
router.post('/billing-portal', authMiddleware, createBillingPortal);
router.post('/webhook', stripeWebhook); // sem auth — assinado pelo Stripe
router.get('/checkout-info/:sessionId', getCheckoutInfo); // sem auth — retorna só email+plano

export default router;
