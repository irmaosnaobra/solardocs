import { Router } from 'express';
import { createCheckout, createPublicCheckout, stripeWebhook, getCheckoutInfo, createBillingPortal, getCupomInfo, getPixCheckoutInfo } from '../controllers/paymentsController';
import {
  criarPixRecorrenteHandler, statusPixRecorrenteHandler, cancelarPixRecorrenteHandler, asaasWebhookHandler,
} from '../controllers/asaasPixController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/public-checkout', createPublicCheckout); // sem auth — LP → Stripe antes do cadastro
router.post('/create-checkout', authMiddleware, createCheckout);
router.post('/billing-portal', authMiddleware, createBillingPortal);
router.post('/webhook', stripeWebhook); // sem auth — assinado pelo Stripe
router.get('/checkout-info/:sessionId', getCheckoutInfo); // sem auth — retorna só email+plano
router.get('/cupom/:codigo', getCupomInfo); // sem auth — a tela /assinar mostra o preço do 1º mês
router.get('/pix-checkout', getPixCheckoutInfo); // sem auth — a tela /quase-la oferece o Pix a quem voltou do Stripe

// Pix RECORRENTE (Asaas). Fica fora de /payments/webhook de propósito: aquele
// prefixo recebe express.raw pro Stripe, e o Asaas manda JSON comum.
router.post('/pix-recorrente', authMiddleware, criarPixRecorrenteHandler);
router.get('/pix-recorrente', authMiddleware, statusPixRecorrenteHandler);
router.post('/pix-recorrente/cancelar', authMiddleware, cancelarPixRecorrenteHandler);
router.post('/asaas/webhook', asaasWebhookHandler); // sem auth — validado pelo header asaas-access-token

export default router;
