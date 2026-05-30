import { Router } from 'express';
import { createCheckout, createPublicCheckout, stripeWebhook, getCheckoutInfo, createBillingPortal } from '../controllers/paymentsController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/public-checkout', createPublicCheckout); // sem auth — LP → Stripe antes do cadastro
router.post('/create-checkout', authMiddleware, createCheckout);
router.post('/billing-portal', authMiddleware, createBillingPortal);
router.post('/webhook', stripeWebhook); // sem auth — assinado pelo Stripe
router.get('/checkout-info/:sessionId', getCheckoutInfo); // sem auth — retorna só email+plano

export default router;
