import { Router, Request, Response } from 'express';
import { cleanupProDocuments } from '../controllers/documentsController';
import { runMonthlyReset } from '../services/planService';
import { runFollowupCnpj, blastFollowupDay1, stampFollowupStarted, runNoContractsEmailReminder } from '../services/followupService';
import { runWhatsappFollowup, runInactiveEngagement } from '../services/agents/whatsapp/whatsappFollowupService';
import { processMessageQueue } from '../services/agents/whatsapp/whatsappAgentService';
import { runSdrFollowups, } from '../services/agents/sdr/sdrFollowupService';
import { runSdrB2bFollowups } from '../services/agents/sdr/sdrB2bFollowupService';
import { pollZapiMessages, retryCardsPendentes } from '../services/agents/sdr/sdrAgentService';
import { pollZapiMessagesIO, processIoTakeoverEvents, processarLembretesAgendamento, revisarLeadsLuma, processarReativacao, cleanupPerdidosAntigos, enviarRelatorioDiario } from '../services/agents/sdr/sdrIoPolling';
import { logger } from '../utils/logger';

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
    logger.error('cron', 'cleanup-pro-docs falhou', err);
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
    logger.error('cron', 'monthly-reset falhou', err);
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
    logger.error('cron', 'followup-cnpj falhou', err);
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
    logger.error('cron', 'followup-blast-day1 falhou', err);
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
    logger.error('cron', 'followup-stamp falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Lembrete WhatsApp dia-1 (1x apenas, ~20-48h apos signup, sem reply nem opt-out)
router.get('/followup-whatsapp', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runWhatsappFollowup();
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

// Roda a cada minuto — processa fila + polling Z-API SolarDoc + polling Z-API Irmaos na Obra
// (Z-API webhook MD nao dispara consistentemente, polling eh fallback)
router.get('/process-messages', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const [queueResult, pollResult, pollIoResult, takeoverResult, lembretesResult, revisaoResult, reativacaoResult, cleanupResult, relatorioResult, cardRetryResult] = await Promise.allSettled([
      processMessageQueue(),
      pollZapiMessages(),
      pollZapiMessagesIO(),
      processIoTakeoverEvents(),
      processarLembretesAgendamento(),
      revisarLeadsLuma(),
      processarReativacao(),
      cleanupPerdidosAntigos(),
      enviarRelatorioDiario(),
      retryCardsPendentes(),
    ]);
    res.json({
      ok: true,
      queue:      queueResult.status === 'fulfilled' ? queueResult.value : { error: String((queueResult as any).reason) },
      poll:       pollResult.status  === 'fulfilled' ? pollResult.value  : { error: String((pollResult as any).reason) },
      poll_io:    pollIoResult.status === 'fulfilled' ? pollIoResult.value : { error: String((pollIoResult as any).reason) },
      takeover:   takeoverResult.status === 'fulfilled' ? takeoverResult.value : { error: String((takeoverResult as any).reason) },
      lembretes:  lembretesResult.status === 'fulfilled' ? lembretesResult.value : { error: String((lembretesResult as any).reason) },
      revisao:    revisaoResult.status === 'fulfilled' ? revisaoResult.value : { error: String((revisaoResult as any).reason) },
      reativacao: reativacaoResult.status === 'fulfilled' ? reativacaoResult.value : { error: String((reativacaoResult as any).reason) },
      cleanup:    cleanupResult.status === 'fulfilled' ? cleanupResult.value : { error: String((cleanupResult as any).reason) },
      relatorio:  relatorioResult.status === 'fulfilled' ? relatorioResult.value : { error: String((relatorioResult as any).reason) },
      card_retry: cardRetryResult.status === 'fulfilled' ? cardRetryResult.value : { error: String((cardRetryResult as any).reason) },
    });
  } catch (err) {
    logger.error('cron', 'process-messages falhou', err);
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
    logger.error('cron', 'sdr-followup falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Follow-up B2B — Carla. Cadência mais espaçada (6 toques em 30d).
router.get('/sdr-b2b-followup', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runSdrB2bFollowups();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'sdr-b2b-followup falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Roda a cada 3 dias por usuário — lembrete email para quem tem empresa mas
// não gerou documento nos últimos 3 dias (até 1 ano após signup)
router.get('/no-contracts-reminder', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runNoContractsEmailReminder();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'no-contracts-reminder falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// ─── MASTER CRON ───────────────────────────────────────────────────
// Plano Hobby permite 1 cron/dia. Roda TODAS as tarefas diárias de uma só
// vez. As funções fazem dedup interna (followup_email_last_sent_at,
// contract_reminder_last_sent_at, followup_last_sent_at) então é seguro
// disparar manualmente também.
router.get('/master', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;

  const tasks: Array<[string, () => Promise<any>]> = [
    ['followup-email-cnpj',         () => runFollowupCnpj()],
    ['no-contracts-reminder',       () => runNoContractsEmailReminder()],
    ['followup-whatsapp-day1',      () => runWhatsappFollowup()],
    ['inactive-engagement-day14',   () => runInactiveEngagement()],
    ['sdr-followup',                () => runSdrFollowups()],
    ['sdr-b2b-followup',             () => runSdrB2bFollowups()],
    ['cleanup-pro-docs',            () => cleanupProDocuments()],
    ['monthly-reset',               () => runMonthlyReset()],
    ['process-message-queue',       () => processMessageQueue()],
  ];

  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  const results = settled.map((r, i) => ({
    task:   tasks[i][0],
    status: r.status,
    ...(r.status === 'fulfilled' ? { res: r.value } : { error: String(r.reason) }),
  }));

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    logger.error('cron', 'master cron parcial', { failed });
  }

  res.json({ ok: true, results });
});

export default router;
