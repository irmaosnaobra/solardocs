import dotenv from 'dotenv';
dotenv.config(); // DEVE ser o primeiro a executar

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import companyRoutes from './routes/company';
import clientsRoutes from './routes/clients';
import terceirosRoutes from './routes/terceiros';
import inventoryRoutes from './routes/inventory';
import documentsRoutes from './routes/documents';
import suggestionsRoutes from './routes/suggestions';
import featureEventsRoutes from './routes/featureEvents';
import prestadoresRoutes from './routes/prestadores';
import paymentsRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import trafegoRoutes from './routes/trafego';
import trackingRoutes from './routes/tracking';
import cronRoutes from './routes/cron';
import chatRoutes from './routes/chat';
import quizRoutes from './routes/quiz';
import pixelRoutes from './routes/pixel';
import webhookRoutes from './routes/webhook';
import zapiAdminRoutes from './routes/zapiAdmin';
import mcpRoutes from './routes/mcp';
import unsubscribeRoutes from './routes/unsubscribe';
import publicPropostaRoutes from './routes/publicProposta';
import dashboardsRoutes from './routes/dashboards';
import geradorRoutes from './routes/gerador';
import ioLinksRoutes from './routes/ioLinks';
import ioIndicacoesRoutes from './routes/ioIndicacoes';
import ioEletropostoRoutes from './routes/ioEletroposto';
import { globalLimiter, aiLimiter } from './middleware/rateLimiter';

const app = express();

// Atrás do proxy da Vercel: confia no 1º hop (X-Forwarded-For) pra req.ip ser o
// IP real do cliente. Sem isso, todo mundo cai no mesmo bucket de rate-limit (o IP
// do proxy) e o express-rate-limit v8 ainda avisa de misconfig. '1' = não-permissivo.
app.set('trust proxy', 1);

app.use(helmet());
// Domínios de produção sempre permitidos (rede de segurança, independe de env var)
const PRODUCTION_ORIGINS = [
  'https://solardoc.app',
  'https://www.solardoc.app',
  'https://solardocs-dashboard.vercel.app',
  'https://limpapro.solardoc.app', // landing do curso LimpaPro → tracking /_t/limpapro
];
const envOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...PRODUCTION_ORIGINS, ...envOrigins]));
// Aceita também previews da Vercel (solardocs-dashboard-*.vercel.app)
const VERCEL_PREVIEW_RE = /^https:\/\/solardocs-dashboard-[a-z0-9-]+\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (ex: curl, mobile, server-to-server)
    if (!origin || allowedOrigins.includes(origin) || VERCEL_PREVIEW_RE.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origem não permitida — ${origin}`));
    }
  },
  credentials: true,
}));
// Webhook do Stripe precisa do body raw (antes do express.json)
app.use('/payments/webhook', express.raw({ type: 'application/json' }));
// Webhook WhatsApp — aceita JSON bruto ou texto
app.use('/webhook', express.text({ type: '*/*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting global
app.use(globalLimiter);

// Rate limiting específico para endpoints de IA
app.use('/documents/generate', aiLimiter);

app.get('/', (_req, res) => {
  res.json({ status: 'SolarDoc Pro API running' });
});

app.use('/auth', authRoutes);
app.use('/company', companyRoutes);
app.use('/clients', clientsRoutes);
app.use('/terceiros', terceirosRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/documents', documentsRoutes);
app.use('/suggestions', suggestionsRoutes);
app.use('/feature-events', featureEventsRoutes);
app.use('/prestadores', prestadoresRoutes);
app.use('/payments', paymentsRoutes);
app.use('/admin', adminRoutes);
app.use('/trafego', trafegoRoutes);
// /_t = path neutro (escapa adblocker). /tracking mantido temporariamente como alias.
app.use('/_t', trackingRoutes);
app.use('/tracking', trackingRoutes);
app.use('/cron', cronRoutes);
app.use('/chat', chatRoutes);
app.use('/quiz', quizRoutes);
app.use('/pixel', pixelRoutes);
app.use('/webhook', webhookRoutes);
app.use('/zapi-admin', zapiAdminRoutes);
app.use('/mcp', mcpRoutes);
app.use('/unsubscribe', unsubscribeRoutes);
app.use('/p', publicPropostaRoutes);
app.use('/dashboards', dashboardsRoutes);
app.use('/gerador', geradorRoutes);
app.use('/io-links', ioLinksRoutes);
app.use('/io-indicacoes', ioIndicacoesRoutes);
app.use('/io/eletroposto', ioEletropostoRoutes);

// Error handler global — nunca expõe stack trace em produção
app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Erro interno do servidor'
    : err.message;
  res.status(statusCode).json({ error: message });
});

// No Vercel (serverless) o listen não é usado — o export default é suficiente
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
// CORS fix deploy trigger 1778213086
