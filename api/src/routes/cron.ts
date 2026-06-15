import { Router, Request, Response } from 'express';
import { cleanupProDocuments } from '../controllers/documentsController';
import { runMonthlyReset } from '../services/planService';
import { runFollowupCnpj, blastFollowupDay1, stampFollowupStarted, runNoContractsEmailReminder, runCheckoutAbandonRecovery, recoverOrphanCheckouts } from '../services/followupService';
import { runWhatsappFollowup, runInactiveEngagement } from '../services/agents/whatsapp/whatsappFollowupService';
import { runCarlaSemCnpjFollowup, runCarlaInativoFollowup } from '../services/agents/whatsapp/carlaPlatformFollowupService';
import { runCarlaCnpjKillerBroadcast } from '../services/agents/whatsapp/carlaCnpjKillerQuestion';
import { runPromoGeradorBroadcast } from '../services/agents/whatsapp/promoGeradorBroadcast';
import { runPromoGeradorV2Broadcast } from '../services/agents/whatsapp/promoGeradorV2Broadcast';
import { runPixVipReminder } from '../services/agents/whatsapp/pixVipReminderService';
import { runLimpaproRecoveryConsumer, seedLimpaproRecoveryBacklog, enviarOpenerTeste } from '../services/agents/whatsapp/limpaproRecoveryService';
import { pollBiaRecuperacao } from '../services/agents/whatsapp/biaInboundService';
import { getInsights } from '../services/insightsService';
import { processMessageQueue } from '../services/agents/whatsapp/whatsappAgentService';
import { runSdrFollowups, } from '../services/agents/sdr/sdrFollowupService';
import { runSdrB2bFollowups } from '../services/agents/sdr/sdrB2bFollowupService';
import { runCarlaMorningBroadcast } from '../services/agents/sdr/sdrB2bMorningHook';
import { pollZapiMessages, retryCardsPendentes } from '../services/agents/sdr/sdrAgentService';
import { pollZapiMessagesIO, processIoTakeoverEvents, processarLembretesAgendamento, revisarLeadsLuma, processarReativacao, processarNudge10min, processarNudge18h, cleanupPerdidosAntigos, cleanupMessageDedup, enviarRelatorioDiario } from '../services/agents/sdr/sdrIoPolling';
import { runIoBroadcastTick } from '../services/io/broadcastTickService';
import { processarLembretesAgenda } from '../services/agenda/lembretesAgenda';
import { enviarReagendarDiario } from '../services/agenda/reagendarDigest';
import { syncLeadsMeta, realinharAgendamentosLeadMeta } from '../services/agenda/leadsMetaService';
import { syncSocialWindsor } from '../services/agenda/socialWindsorService';
import { gerarProdutosVirais } from '../services/agenda/produtosViraisService';
import { runDunning } from '../services/dunningService';
import { syncStripePlans } from '../services/stripeSyncService';
import { runWinback } from '../services/winbackService';
import { runMonitorCriativos } from '../services/agenda/monitorCriativosService';
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

// Todo dia 17h BRT (0 20 * * * UTC) — manda pra cada consultor a lista de
// clientes parados que precisam reagendar, com link único pro CRM filtrado.
// ?dry=1 → não envia, só retorna o que enviaria (conferência).
router.get('/reagendar-diario', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const r = await enviarReagendarDiario({ dry });
    res.json({ ok: true, dry, ...r });
  } catch (err: any) {
    logger.error('cron', 'reagendar-diario falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// A cada 15min (GitHub Actions) — puxa Lead Ads do Instagram e agenda no rodízio
router.get('/sync-leads-meta', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const r = await syncLeadsMeta();
    res.json({ ok: true, ...r });
  } catch (err: any) {
    logger.error('cron', 'sync-leads-meta falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// Sincroniza métricas sociais (IG + TikTok) da Windsor.ai → aba "Redes" do gerador
router.get('/sync-social-windsor', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const r = await syncSocialWindsor();
    res.json({ ok: true, ...r });
  } catch (err: any) {
    logger.error('cron', 'sync-social-windsor falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// One-shot: realinha agendamentos antigos de leads pro horário SP correto
router.get('/realinhar-leads-meta', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const r = await realinharAgendamentosLeadMeta();
    res.json({ ok: true, ...r });
  } catch (err: any) {
    logger.error('cron', 'realinhar-leads-meta falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
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

// Roda diário — pega quem cadastrou nas últimas 4-72h e não passou cartão,
// manda 1 email de recuperação ("Faltou só o cartão"). Idempotente via
// checkout_recovery_sent_at em users.
router.get('/checkout-recovery', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runCheckoutAbandonRecovery();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'checkout-recovery falhou', err);
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
//
// LUMA DESLIGADA NA LINHA IO (34998165040) — Cora é a única agente nesse número.
// Polling IO permanece ATIVO porque é como Cora "escuta" mensagens inbound
// (sem ele, ela nunca saberia que o lead clicou no botão WhatsApp do simulador).
// O early-return em handleSdrLead garante que Luma não age, só Cora.
// Tarefas Luma específicas (nudges, lembretes, reativação) seguem desligadas.
router.get('/process-messages', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const [queueResult, pollResult, pollIoResult, cleanupResult, dedupCleanupResult, cardRetryResult, agendaResult, recupConsumerResult, biaPollResult] = await Promise.allSettled([
      processMessageQueue(),
      pollZapiMessages(),
      pollZapiMessagesIO(),            // detecta inbound IO pra Cora processar
      // processIoTakeoverEvents(),    // [LUMA-IO-OFF] eventos de takeover humano IO
      // processarLembretesAgendamento(),// [LUMA-IO-OFF] lembretes de agendamento IO
      // revisarLeadsLuma(),            // [LUMA-IO-OFF] revisão de leads pela Luma IO
      // processarReativacao(),         // [LUMA-IO-OFF] reativação Luma IO
      // processarNudge10min(),         // [LUMA-IO-OFF] nudge 10min IO
      // processarNudge18h(),           // [LUMA-IO-OFF] nudge 18h IO
      cleanupPerdidosAntigos(),
      cleanupMessageDedup(),
      // enviarRelatorioDiario(),       // [LUMA-IO-OFF] relatório diário IO
      retryCardsPendentes(),
      processarLembretesAgenda(),      // lembretes 5min/3h da agenda /gerador
      runLimpaproRecoveryConsumer(),   // recuperação LimpaPro (Bia): drena marcadores prontos
      pollBiaRecuperacao(),            // inbound da Bia (poll IO; webhook IO não entrega texto)
    ]);
    res.json({
      ok: true,
      queue:      queueResult.status === 'fulfilled' ? queueResult.value : { error: String((queueResult as any).reason) },
      poll:       pollResult.status  === 'fulfilled' ? pollResult.value  : { error: String((pollResult as any).reason) },
      poll_io:    pollIoResult.status === 'fulfilled' ? pollIoResult.value : { error: String((pollIoResult as any).reason) },
      cleanup:    cleanupResult.status === 'fulfilled' ? cleanupResult.value : { error: String((cleanupResult as any).reason) },
      dedup_cleanup: dedupCleanupResult.status === 'fulfilled' ? dedupCleanupResult.value : { error: String((dedupCleanupResult as any).reason) },
      card_retry: cardRetryResult.status === 'fulfilled' ? cardRetryResult.value : { error: String((cardRetryResult as any).reason) },
      agenda:     agendaResult.status === 'fulfilled' ? agendaResult.value : { error: String((agendaResult as any).reason) },
      recup_consumer: recupConsumerResult.status === 'fulfilled' ? recupConsumerResult.value : { error: String((recupConsumerResult as any).reason) },
      bia_poll:       biaPollResult.status === 'fulfilled' ? biaPollResult.value : { error: String((biaPollResult as any).reason) },
      luma_io_off: 'Linha IO: polling ativo só pra Cora ouvir inbound, demais tarefas Luma desligadas',
    });
  } catch (err) {
    logger.error('cron', 'process-messages falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// ── Recuperação LimpaPro (Bia) — endpoints manuais (gated). ──
// O CONSUMO real roda dentro do /process-messages (tick ~5min); estes são pra
// disparo manual e ?dry=1 (conferência sem enviar/semear).
// Seed do backlog é one-shot: rodar UMA vez ao ligar a Bia (não agendar).
router.get('/limpapro-recovery-consume', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await runLimpaproRecoveryConsumer({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'limpapro-recovery-consume falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});
router.get('/limpapro-recovery-seed', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await seedLimpaproRecoveryBacklog({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'limpapro-recovery-seed falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// TESTE gated — manda o 1º toque pra UM número (valida o ciclo completo antes dos 12).
// /cron/recup-test-opener?phone=5534991360223&nome=Thiago
router.get('/recup-test-opener', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    if (!phone) { res.status(400).json({ error: 'phone obrigatorio' }); return; }
    const nome = req.query.nome ? String(req.query.nome) : null;
    res.json({ phone, ...(await enviarOpenerTeste(phone, nome)) });
  } catch (err: any) {
    logger.error('cron', 'recup-test-opener falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
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

// Carla — usuários da plataforma sem CNPJ. 3 toques em 30d (D+2, D+10, D+30).
router.get('/carla-sem-cnpj', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runCarlaSemCnpjFollowup();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'carla-sem-cnpj falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Carla — usuários com CNPJ inativos 3+ dias. 5 toques em 60d (3, 7, 14, 30, 60).
router.get('/carla-inativo', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runCarlaInativoFollowup();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'carla-inativo falhou', err);
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
// One-shot manual: dispara a pergunta-pílula pros users sem CNPJ que ainda
// não receberam. Cada user só recebe UMA vez. Disparar via curl quando
// quiser — não agendado pra evitar spam.
router.get('/carla-pergunta-cnpj', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runCarlaCnpjKillerBroadcast();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'carla-pergunta-cnpj falhou', err);
    res.status(500).json({ error: 'Cron failed', message: String(err) });
  }
});

// One-shot 27/05/2026 06:50 BRT — broadcast pros users plano=free pedindo
// e-mail em troca de 10 créditos no novo gerador. Idempotente
// (promo_gerador_sent_at). GitHub Actions chama em sequência até esvaziar.
router.get('/promo-gerador-blast', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runPromoGeradorBroadcast();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'promo-gerador-blast falhou', err);
    res.status(500).json({ error: 'Cron failed', message: String(err) });
  }
});

// V2: re-engajamento sem pedir email, link direto pro /auth.
// Cadência 15-20s, idempotente via promo_gerador_v2_sent_at.
router.get('/promo-gerador-v2-blast', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runPromoGeradorV2Broadcast();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'promo-gerador-v2-blast falhou', err);
    res.status(500).json({ error: 'Cron failed', message: String(err) });
  }
});

// Processa fila de disparos em massa (broadcasts /admin/disparos) server-side.
// Cloudflare Worker chama a cada minuto. Cada tick pega o broadcast mais antigo
// em status='rodando', adquire lock, e processa até MAX_ENVIOS_POR_TICK envios
// respeitando cadência aleatória. Loop client-side da página é apenas um fallback
// — mesmo se o browser fechar, o servidor continua até concluir.
router.get('/io-broadcast-tick', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runIoBroadcastTick();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'io-broadcast-tick falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Reconcilia users.plano com Stripe real (varre todas subs, pagina, e ajusta
// plano + limite por email). Disparado pelo master horário (.github/workflows/cron.yml).
// NÃO toca billing_status / past_due_since / dunning_last_day_sent — webhook é dono.
router.get('/sync-stripe-plans', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await syncStripePlans();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'sync-stripe-plans falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Winback de cancelados — varre subs canceladas no Stripe e dispara emails
// D+7 e D+30 pra clientes free que cancelaram (ex-dunning OU voluntários).
// Email-only, idempotente via winback_d7_sent_at / winback_d30_sent_at.
router.get('/winback', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runWinback();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'winback falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Dunning de inadimplência — varre contas past_due, manda lembretes D1/D2/D3/D4
// e CANCELA sub no Stripe + rebaixa pra free no D5. Idempotente
// (dunning_last_day_sent garante que cada dia só é enviado uma vez).
router.get('/dunning', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runDunning();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'dunning falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Monitor de criativos ruins no Meta (conta Ekent- Pré Paga). Alerta no WhatsApp
// do Thiago (34991360223) quando um anúncio gasta sem vender (sangrador) ou tem
// CTR baixa + CPC alto (criativo fraco). NÃO pausa — só avisa com link pra pausar.
// ?dry=1 → não envia WhatsApp, só loga o que enviaria (conferência).
router.get('/monitor-criativos', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const result = await runMonitorCriativos({ dry });
    res.json({ ok: true, dry, ...result });
  } catch (err: any) {
    logger.error('cron', 'monitor-criativos falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

router.get('/master', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;

  // 2026-05-12: Email follow-up CNPJ REATIVADO em cadência reduzida
  // (5 emails em 30d, foco no Gerador de Proposta, disparo 8h30 BRT).
  // WhatsApp Carla continua pausado pra evitar novos bloqueios.
  // Pra reativar restantes: descomentar linhas [PAUSED-FOLLOWUP].
  const tasks: Array<[string, () => Promise<any>]> = [
    ['checkout-recovery',           () => runCheckoutAbandonRecovery()], // 1 email pra quem cadastrou e não passou cartão (4-72h)
    ['orphan-checkout-recovery',    () => recoverOrphanCheckouts()],     // PAGOU e NÃO cadastrou: link de conclusão (carência 30min, até 6d). Template aprovado 02/06.
    ['followup-email-cnpj',         () => runFollowupCnpj()],            // 5 emails/30d — gerador de proposta
    // ['no-contracts-reminder',       () => runNoContractsEmailReminder()], // [PAUSED-FOLLOWUP] lembrete inativos por email
    // ['carla-sem-cnpj',              () => runCarlaSemCnpjFollowup()],     // [PAUSED-FOLLOWUP] WhatsApp Carla — 3 toques 30d
    // ['carla-inativo',                () => runCarlaInativoFollowup()],     // [PAUSED-FOLLOWUP] WhatsApp Carla — 5 toques 60d
    // ['carla-morning-broadcast',      () => runCarlaMorningBroadcast()],    // [PAUSED-FOLLOWUP] broadcast matinal
    ['sdr-followup',                () => runSdrFollowups()],
    ['sdr-b2b-followup',             () => runSdrB2bFollowups()],
    ['sync-social-windsor',         () => syncSocialWindsor()],      // métricas IG+TikTok → aba Redes do gerador
    ['produtos-virais',             () => gerarProdutosVirais()],    // 3 produtos top TikTok Shop → roteiro AIDA → fila canal 'produtos'
    ['insights-prewarm',             () => getInsights(true)],
    // ['luma-reativacao',             () => processarReativacao()], // [LUMA-IO-OFF] linha IO é só da Cora
    ['cleanup-pro-docs',            () => cleanupProDocuments()],
    ['monthly-reset',               () => runMonthlyReset()],
    ['process-message-queue',       () => processMessageQueue()],
    ['lembretes-agenda',            () => processarLembretesAgenda()], // backstop diário: garante confirmações que escaparam do gatilho de 15min
    ['dunning',                     () => runDunning()],            // 5 dias: D0-D4 lembrete, D5 cancela+free
    ['sync-stripe-plans',           () => syncStripePlans()],       // reconcilia users.plano com Stripe real (horário)
    ['winback',                     () => runWinback()],            // emails D+7 e D+30 pra cancelados
    ['pix-vip-reminder',            () => runPixVipReminder()],     // avisa VIP-pix (84994501564) ~2d antes de vencer: valor + chave Pix
    ['monitor-criativos',           () => runMonitorCriativos()],   // alerta WhatsApp: criativos Meta gastando sem vender / CTR baixa
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
