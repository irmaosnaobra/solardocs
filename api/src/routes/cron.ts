import { Router, Request, Response } from 'express';
import { cleanupProDocuments } from '../controllers/documentsController';
import { runMonthlyReset } from '../services/planService';
import { runFollowupCnpj, blastFollowupDay1, stampFollowupStarted } from '../services/followupService';
import { runWhatsappFollowup, runInactiveEngagement } from '../services/agents/whatsapp/whatsappFollowupService';
import { processMessageQueue } from '../services/agents/whatsapp/whatsappAgentService';
import { runSdrFollowups } from '../services/agents/sdr/sdrFollowupService';

const router = Router();

function verifyCronSecret(req: Request, res: Response): boolean {
  const auth   = req.headers['authorization'] ?? '';
  const secret = auth.replace('Bearer ', '').trim();
  
  const validVercel = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  const validGithub = secret === 'solardocs_master_cron_2024';
  
  if (!validVercel && !validGithub) {
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

// 8h Brasília — followup manhã (sem CNPJ)
router.get('/followup-whatsapp-morning', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runWhatsappFollowup('morning');
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: 'Cron failed' }); }
});

// 17h Brasília — followup tarde (sem CNPJ)
router.get('/followup-whatsapp-evening', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runWhatsappFollowup('evening');
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: 'Cron failed' }); }
});

// 10h Brasília — engajamento usuários inativos 3+ dias
router.get('/inactive-engagement', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runInactiveEngagement();
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: 'Cron failed' }); }
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

// Roda a cada 30 min — follow-up SDR (10 tentativas antes de marcar Perdido)
router.get('/sdr-followup', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runSdrFollowups();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cron sdr-followup error:', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// ─── MASTER CRON ───────────────────────────────────────────────────
// Disparado 1x por hora pela Vercel. Evita o limite de 2 crons da conta Hobby.
router.get('/master', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  
  // Pegar hora atual no fuso de Brasília
  const nowBr = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hour = nowBr.getHours();
  
  const results: any = { executed: [], hour_br: hour };

  try {
    // 08h Brasília: Follow-up Manhã (Sem CNPJ)
    if (hour === 8) {
      const resM = await runWhatsappFollowup('morning');
      results.executed.push({ task: 'followup-whatsapp-morning', res: resM });
    }

    // 09h Brasília: Follow-up E-mail CNPJ
    if (hour === 9) {
      const resC = await runFollowupCnpj();
      results.executed.push({ task: 'followup-email-cnpj', res: resC });
    }

    // 10h Brasília: Limpeza e Manutenção
    if (hour === 10) {
      await Promise.allSettled([cleanupProDocuments(), runMonthlyReset()]);
      results.executed.push('cleanup-pro-docs', 'monthly-reset');
    }

    // 11h Brasília: Engajamento Usuários Inativos (com CNPJ)
    if (hour === 11) {
      const resI = await runInactiveEngagement();
      results.executed.push({ task: 'inactive-engagement', res: resI });
    }

    // 14h Brasília: Follow-up SDR Solar (B2C Leads)
    if (hour === 14) {
      const resS = await runSdrFollowups();
      results.executed.push({ task: 'sdr-followup', res: resS });
    }

    // 17h Brasília: Follow-up Tarde/Noite (Sem CNPJ)
    if (hour === 17) {
      const resT = await runWhatsappFollowup('evening');
      results.executed.push({ task: 'followup-whatsapp-evening', res: resT });
    }

    // Sempre tenta processar a fila de mensagens (caso o cron de 1min falhe)
    const resQ = await processMessageQueue();
    results.executed.push({ task: 'process-message-queue', res: resQ });

    res.json({ ok: true, results });
  } catch (err) {
    console.error('Master cron error:', err);
    res.status(500).json({ error: 'Master cron partial failure', details: String(err) });
  }
});

export default router;
