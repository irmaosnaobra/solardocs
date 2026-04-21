import { Router, Request, Response } from 'express';
import { cleanupProDocuments } from '../controllers/documentsController';
import { runMonthlyReset } from '../services/planService';
import { runFollowupCnpj, blastFollowupDay1, stampFollowupStarted } from '../services/followupService';
import { runWhatsappFollowup } from '../services/whatsappFollowupService';
import { processMessageQueue } from '../services/whatsappAgentService';

const router = Router();

function verifyCronSecret(req: Request, res: Response): boolean {
  const auth   = req.headers['authorization'] ?? '';
  const secret = auth.replace('Bearer ', '').trim();
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Roda todo dia — apaga documentos PRO com mais de 30 dias
router.get('/cleanup-pro-docs', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    await cleanupProDocuments();
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron cleanup error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Roda todo dia — reset mensal de documentos usados
router.get('/monthly-reset', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    await runMonthlyReset();
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron monthly reset error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Roda todo dia às 9h — follow-up para usuários sem CNPJ (dias 1 a 7)
router.get('/followup-cnpj', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runFollowupCnpj();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron followup error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// One-shot — manda email dia 1 para TODOS sem CNPJ
router.get('/followup-blast-day1', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await blastFollowupDay1();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron blast error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// One-shot — só carimba followup_started_at sem reenviar email
router.get('/followup-stamp', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await stampFollowupStarted();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron stamp error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Roda todo dia às 9h — follow-up WhatsApp para usuários sem CNPJ
router.get('/followup-whatsapp', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runWhatsappFollowup();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron WhatsApp followup error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Roda a cada minuto — processa fila de mensagens WhatsApp
router.get('/process-messages', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await processMessageQueue();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron process-messages error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

export default router;
