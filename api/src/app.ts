import dotenv from 'dotenv';
dotenv.config(); // DEVE ser o primeiro a executar

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import companyRoutes from './routes/company';
import clientsRoutes from './routes/clients';
import terceirosRoutes from './routes/terceiros';
import documentsRoutes from './routes/documents';
import suggestionsRoutes from './routes/suggestions';
import { globalLimiter, aiLimiter } from './middleware/rateLimiter';

const app = express();

app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (ex: curl, mobile) em desenvolvimento
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origem não permitida — ${origin}`));
    }
  },
  credentials: true,
}));
app.use(express.json());

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
app.use('/documents', documentsRoutes);
app.use('/suggestions', suggestionsRoutes);

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
