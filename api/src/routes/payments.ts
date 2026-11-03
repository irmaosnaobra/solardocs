import { Router } from 'express';
import { createCheckout, createPublicCheckout, stripeWebhook, getCheckoutInfo, createBillingPortal, getCupomInfo, getPixCheckoutInfo, getPixUrl } from '../controllers/paymentsController';
import {
  criarPixRecorrenteHandler, statusPixRecorrenteHandler, cancelarPixRecorrenteHandler, asaasWebhookHandler,
  criarPixPublicoHandler, statusPixPublicoHandler, criarPixAvulsoPublicoHandler, statusPixAvulsoPublicoHandler,
} from '../controllers/asaasPixController';
import { authMiddleware } from '../middleware/auth';
import { pixPublicoRateLimit, pixAvulsoRateLimit } from '../middleware/pixPublicoRateLimit';

const router = Router();

router.post('/public-checkout', createPublicCheckout); // sem auth — LP → Stripe antes do cadastro
router.post('/create-checkout', authMiddleware, createCheckout);
router.post('/billing-portal', authMiddleware, createBillingPortal);
router.post('/webhook', stripeWebhook); // sem auth — assinado pelo Stripe
router.get('/checkout-info/:sessionId', getCheckoutInfo); // sem auth — retorna só email+plano
router.get('/cupom/:codigo', getCupomInfo); // sem auth — a tela /assinar mostra o preço do 1º mês
router.get('/pix-url', getPixUrl); // sem auth — só { url } do checkout Pix da Kiwify (https) ou null; o /pix do dashboard redireciona para ela
router.get('/pix-checkout', getPixCheckoutInfo); // sem auth — a tela /quase-la oferece o Pix a quem voltou do Stripe

// Pix RECORRENTE (Asaas). Fica fora de /payments/webhook de propósito: aquele
// prefixo recebe express.raw pro Stripe, e o Asaas manda JSON comum.
router.post('/pix-recorrente', authMiddleware, criarPixRecorrenteHandler);
router.get('/pix-recorrente', authMiddleware, statusPixRecorrenteHandler);
router.post('/pix-recorrente/cancelar', authMiddleware, cancelarPixRecorrenteHandler);

// SEM login: quem abandonou o checkout da Stripe cai direto na tela de Pix e
// paga ali, antes de ter conta. Rate-limit porque é a única rota aberta que
// cria cobrança de verdade no gateway, e trava de ambiente (PIX_PUBLICO_ATIVO)
// dentro do handler — sem a variável, responde 503 e ninguém entra por aqui.
router.post('/pix-recorrente/publico', pixPublicoRateLimit, criarPixPublicoHandler);
router.get('/pix-recorrente/publico/:id', statusPixPublicoHandler);
// Pix AVULSO do quiz e da LP (código copia e cola de R$ 67, sem CPF). Balde de rate limit próprio (10/h por IP); trava PIX_AVULSO_FUNIL no handler.
router.post('/pix-avulso/publico', pixAvulsoRateLimit, criarPixAvulsoPublicoHandler);
router.get('/pix-avulso/publico/:id', statusPixAvulsoPublicoHandler);
router.post('/asaas/webhook', asaasWebhookHandler); // sem auth — validado pelo header asaas-access-token

export default router;
