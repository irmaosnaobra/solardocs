import { Router, Request, Response } from 'express';
import { cleanupProDocuments } from '../controllers/documentsController';
import { runMonthlyReset } from '../services/planService';
import { runFollowupCnpj, blastFollowupDay1, stampFollowupStarted, runNoContractsEmailReminder, runCheckoutAbandonRecovery, recoverOrphanCheckouts, runUpgradeNudge, recoverAbandonedCheckouts } from '../services/followupService';
import { reDrivePendingPurchases } from '../services/salesLedger';
import { runWhatsappFollowup, runInactiveEngagement } from '../services/agents/whatsapp/whatsappFollowupService';
import { runCarlaSemCnpjFollowup, runCarlaInativoFollowup, dispararOpenerTesteParaUser } from '../services/agents/whatsapp/carlaPlatformFollowupService';
import { runCarlaCnpjKillerBroadcast } from '../services/agents/whatsapp/carlaCnpjKillerQuestion';
import { runCursoEntradaBroadcast } from '../services/agents/whatsapp/cursoEntradaBroadcast';
import { runPromoGeradorBroadcast } from '../services/agents/whatsapp/promoGeradorBroadcast';
import { runPromoGeradorV2Broadcast } from '../services/agents/whatsapp/promoGeradorV2Broadcast';
import { runPixVipReminder } from '../services/agents/whatsapp/pixVipReminderService';
import { runLimpaproRecoveryConsumer, runLimpaproRecoverySeeds, seedLimpaproRecoveryBacklog, seedLimpaproCupomBacklog, seedLimpaproFechamentoBacklog, seedLimpaproGrupoBacklog, enviarOpenerTeste } from '../services/agents/whatsapp/limpaproRecoveryService';
import { pollBiaRecuperacao } from '../services/agents/whatsapp/biaInboundService';
import { pollLimpaproAtendimento } from '../services/agents/whatsapp/limpaproAtendimentoService';
import { getInsights } from '../services/insightsService';
import { processMessageQueue } from '../services/agents/whatsapp/whatsappAgentService';
import { runSdrFollowups, } from '../services/agents/sdr/sdrFollowupService';
import { runSdrB2bFollowups } from '../services/agents/sdr/sdrB2bFollowupService';
import { runCarlaMorningBroadcast } from '../services/agents/sdr/sdrB2bMorningHook';
import { pollZapiMessages, retryCardsPendentes } from '../services/agents/sdr/sdrAgentService';
import { pollZapiMessagesIO, processIoTakeoverEvents, processarLembretesAgendamento, revisarLeadsLuma, processarReativacao, processarNudge10min, processarNudge18h, cleanupPerdidosAntigos, cleanupMessageDedup, enviarRelatorioDiario } from '../services/agents/sdr/sdrIoPolling';
import { runIoBroadcastTick } from '../services/io/broadcastTickService';
import { runGeradorBroadcastTick, runGeradorSequenciasConsumer } from '../services/io/geradorAutomacaoService';
import { runProspeccaoApifyTick } from '../services/io/prospeccaoApifyService';
import { runSequenciaStopOnReply } from '../services/io/sequenciaStopOnReply';
import { runBlastRespostas } from '../services/io/blastRespostas';
import { runZapiHealthCheck } from '../services/io/zapiHealthMonitor';
import { runAlertaLeadQuenteSemProposta } from '../services/agenda/leadQuenteSemPropostaService';
import { runGrupoEletropostoDiario } from '../services/io/grupoEletropostoDiario';
import { drainIgQueue, refreshIgToken } from '../services/instagram/igEngine';
import { varrerComentariosFacebook } from '../services/instagram/fbComentarios';
import { varrerInboxFacebook } from '../services/instagram/fbMensagens';
import { runRepescagemTick, semearRepescagem } from '../services/io/eletropostoRepescagem';
import { runEntradaIoDigest } from '../services/io/entradaIoDigest';
import { runConviteNota1Garantido } from '../services/io/eletropostoConviteGarantido';
import { runSementeTick, publicoSemente, bolhasSemente } from '../services/io/sementeSolarService';
import { runGrupoFriosTick, publicoGrupoFrio, bolhasGrupoFrio } from '../services/io/eletropostoGrupoFrios';
import { runEletropostoAgendaTick } from '../services/io/eletropostoAgenda';
import { runEletropostoRespostasTick } from '../services/io/eletropostoRespostas';
import { runSolarBoasVindasTick } from '../services/io/solarBoasVindas';
import { runSolarRespostasTick } from '../services/io/solarRespostas';
import { processarLembretesAgenda } from '../services/agenda/lembretesAgenda';
import { enviarReagendarDiario } from '../services/agenda/reagendarDigest';
import { enviarAgendaProxima } from '../services/agenda/agendaProximaDigest';
import { syncLeadsMeta, realinharAgendamentosLeadMeta } from '../services/agenda/leadsMetaService';
import { syncSocialWindsor } from '../services/agenda/socialWindsorService';
import { gerarProdutosVirais } from '../services/agenda/produtosViraisService';
import { runDunning } from '../services/dunningService';
import { syncStripePlans } from '../services/stripeSyncService';
import { runWinback } from '../services/winbackService';
import { runAuxiliarTrafego } from '../services/agenda/auxiliarTrafegoService';
import { runCapiLeads } from '../services/agenda/capiLeadsService';
import { tickOrdens } from '../services/metaOrdensService';
import { runInventoryLowStockAlert } from '../services/inventoryAlertService';
import { logger } from '../utils/logger';

const router = Router();

function verifyCronSecret(req: Request, res: Response): boolean {
  const auth   = req.headers['authorization'] ?? '';
  const secret = auth.replace('Bearer ', '').trim();

  // Secrets vêm SÓ de env (sem fallback hardcoded). Aceita o do Vercel OU o do
  // GitHub Actions — ambos configuráveis. Sem secret no header → 401.
  const cronSecret   = (process.env.CRON_SECRET || '').trim();
  const githubSecret = (process.env.GITHUB_CRON_SECRET || '').trim();
  const validVercel = cronSecret && secret === cronSecret;
  const validGithub = githubSecret && secret === githubSecret;

  if (!secret || (!validVercel && !validGithub)) {
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

// 3×/dia (09h, 16h e 20h BRT) — manda pro Thiago e pro Diego a lista GERAL dos
// clientes marcados na PRÓXIMA agenda (primeiro dia depois de hoje que tem
// cliente marcado). Numa sexta, os 3 disparos + sábado + domingo caem todos na
// segunda — que é o pedido. NÃO entra no /cron/master (roda de hora em hora).
// ?dry=1 → não envia, devolve a mensagem que sairia.
router.get('/agenda-proxima', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const r = await enviarAgendaProxima({ dry });
    res.json({ ok: true, dry, ...r });
  } catch (err: any) {
    logger.error('cron', 'agenda-proxima falhou', err);
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

// Nudge de CONVERSÃO free->pago — free engajado (CNPJ + 3+ docs). Email via
// sendMarketingEmail (List-Unsubscribe). Elegibilidade reconsultada a cada run
// (stop-on-conversion). NÃO está no master cron ainda: rodada como one-shot
// controlado primeiro (dispara o 1º lote e observa) antes de virar autopilot.
router.get('/upgrade-nudge', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runUpgradeNudge();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'upgrade-nudge falhou', err);
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
    // Trava de segurança (stop-on-reply): PARA as sequências de quem respondeu ANTES
    // de rodar o drip deste tick — evita mandar o próximo passo por cima da resposta
    // do cliente. Awaited de propósito (roda antes do runGeradorSequenciasConsumer).
    const stopReplyResult = await runSequenciaStopOnReply().catch((e) => ({ error: String(e) }));

    // Respostas a DISPARO: quem pediu pra parar entra na supressão antes de
    // qualquer envio deste tick; o resto vira fila de atendimento humano no
    // /admin. Também awaited — a supressão precisa valer pro tick que vem logo
    // abaixo, senão a pessoa que acabou de pedir "pare" recebe o próximo slot.
    const blastRespResult = await runBlastRespostas().catch((e) => ({ error: String(e) }));

    const [queueResult, pollResult, pollIoResult, cleanupResult, dedupCleanupResult, cardRetryResult, agendaResult, recupSeedsResult, recupConsumerResult, biaPollResult, geradorSeqResult, igDrainResult, fbComentResult, fbInboxResult, repescagemResult, conviteResult, sementeResult, grupoFrioResult, epAgendaResult, epRespostasResult, solarBvResult, solarRespResult, curso19Result, carlaCnpjResult, carlaInativoResult] = await Promise.allSettled([
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
      processarLembretesAgenda(),      // [AVISOS-AGENDA-OFF 28/07] no-op: kill-switch dentro do módulo
      runLimpaproRecoverySeeds(),      // recuperação LimpaPro (Bia): põe gente na esteira (1x/h, auto-gated)
      runLimpaproRecoveryConsumer(),   // recuperação LimpaPro (Bia): drena marcadores prontos
      pollBiaRecuperacao(),            // inbound da Bia (poll IO; webhook IO não entrega texto)
      pollLimpaproAtendimento(),       // trilha 1x1 do LimpaPro: aluno que escreve na linha (LIMPAPRO_ATENDIMENTO_ENABLED)
      runGeradorSequenciasConsumer(),  // Central de Automação: drip de sequências (gated por kill-switch)
      drainIgQueue(),                  // Instagram nativo: drena a fila de DMs/respostas (gated por kill-switch)
      varrerComentariosFacebook(),     // Facebook: comentário em post/anúncio da Página → resposta privada (FB_COMENTARIOS_OFF desliga)
      varrerInboxFacebook(),           // Facebook: inbox do Messenger — responde, manda o menu e chama o humano (FB_INBOX_OFF desliga)
      runRepescagemTick(),             // eletroposto: 1 pessoa do apagão a cada 20min, 07h–20h
      runConviteNota1Garantido(),      // eletroposto: TODO nota 1 entra no grupo — rede embaixo do envio da LP
      runSementeTick(),                // semente: nutrição de quem pediu orçamento de solar e não fechou
      runGrupoFriosTick(),             // eletroposto: quem esfriou (não atendeu / sem interesse) vai pro grupo
      runEletropostoAgendaTick(),      // eletroposto: confirmação ao marcar + lembrete 1h + 5min (anti no-show)
      runEletropostoRespostasTick(),   // eletroposto: lead respondeu a automação → recado pro Thiago e pro Diego
      runSolarBoasVindasTick(),        // solar: quem acabou de se cadastrar recebe o consultor, o contato e a pergunta do consumo (SOLAR_BOASVINDAS_OFF desliga)
      runSolarRespostasTick(),         // solar: cliente respondeu as boas-vindas → recado pro consultor dono da ficha
      // [06/08] As três cadências da linha B2B passam a drenar AQUI também, não só no
      // master de hora em hora. Motivo: com a margem de 5 min entre envios elas mandariam
      // 1 por ciclo — no master isso viraria 1/h, um quarto do que o teto (4/h) permite.
      // No tick de 5 min a margem vira o RITMO e o teto volta a ser o limite: até 4/h,
      // uma a cada 5 min, em vez das 4 em 37 segundos desta madrugada. As três já são
      // idempotentes e gated (campanha/janela/teto/espaçamento) — rodar mais vezes não
      // manda MAIS, manda melhor distribuído.
      runCursoEntradaBroadcast(),      // curso R$19: 3 toques (exige CAMPANHA_CURSO19_ON)
      runCarlaSemCnpjFollowup(),       // Giovanna: 3 toques em 30d
      runCarlaInativoFollowup(),       // Giovanna: 5 toques em 60d
    ]);
    res.json({
      ok: true,
      stop_on_reply: stopReplyResult,
      blast_respostas: blastRespResult,
      queue:      queueResult.status === 'fulfilled' ? queueResult.value : { error: String((queueResult as any).reason) },
      poll:       pollResult.status  === 'fulfilled' ? pollResult.value  : { error: String((pollResult as any).reason) },
      poll_io:    pollIoResult.status === 'fulfilled' ? pollIoResult.value : { error: String((pollIoResult as any).reason) },
      cleanup:    cleanupResult.status === 'fulfilled' ? cleanupResult.value : { error: String((cleanupResult as any).reason) },
      dedup_cleanup: dedupCleanupResult.status === 'fulfilled' ? dedupCleanupResult.value : { error: String((dedupCleanupResult as any).reason) },
      card_retry: cardRetryResult.status === 'fulfilled' ? cardRetryResult.value : { error: String((cardRetryResult as any).reason) },
      agenda:     agendaResult.status === 'fulfilled' ? agendaResult.value : { error: String((agendaResult as any).reason) },
      recup_seeds:    recupSeedsResult.status === 'fulfilled' ? recupSeedsResult.value : { error: String((recupSeedsResult as any).reason) },
      recup_consumer: recupConsumerResult.status === 'fulfilled' ? recupConsumerResult.value : { error: String((recupConsumerResult as any).reason) },
      bia_poll:       biaPollResult.status === 'fulfilled' ? biaPollResult.value : { error: String((biaPollResult as any).reason) },
      gerador_seq:    geradorSeqResult.status === 'fulfilled' ? geradorSeqResult.value : { error: String((geradorSeqResult as any).reason) },
      ig_drain:       igDrainResult.status === 'fulfilled' ? igDrainResult.value : { error: String((igDrainResult as any).reason) },
      fb_comentarios: fbComentResult.status === 'fulfilled' ? fbComentResult.value : { error: String((fbComentResult as any).reason) },
      fb_inbox:       fbInboxResult.status === 'fulfilled' ? fbInboxResult.value : { error: String((fbInboxResult as any).reason) },
      ep_repescagem:  repescagemResult.status === 'fulfilled' ? repescagemResult.value : { error: String((repescagemResult as any).reason) },
      ep_convite:     conviteResult.status === 'fulfilled' ? conviteResult.value : { error: String((conviteResult as any).reason) },
      semente:        sementeResult.status === 'fulfilled' ? sementeResult.value : { error: String((sementeResult as any).reason) },
      ep_grupo_frio:  grupoFrioResult.status === 'fulfilled' ? grupoFrioResult.value : { error: String((grupoFrioResult as any).reason) },
      ep_agenda:      epAgendaResult.status === 'fulfilled' ? epAgendaResult.value : { error: String((epAgendaResult as any).reason) },
      ep_respostas:   epRespostasResult.status === 'fulfilled' ? epRespostasResult.value : { error: String((epRespostasResult as any).reason) },
      solar_boas_vindas: solarBvResult.status === 'fulfilled' ? solarBvResult.value : { error: String((solarBvResult as any).reason) },
      solar_respostas:   solarRespResult.status === 'fulfilled' ? solarRespResult.value : { error: String((solarRespResult as any).reason) },
      curso19:        curso19Result.status === 'fulfilled' ? curso19Result.value : { error: String((curso19Result as any).reason) },
      carla_sem_cnpj: carlaCnpjResult.status === 'fulfilled' ? carlaCnpjResult.value : { error: String((carlaCnpjResult as any).reason) },
      carla_inativo:  carlaInativoResult.status === 'fulfilled' ? carlaInativoResult.value : { error: String((carlaInativoResult as any).reason) },
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
// ── Repescagem do eletroposto: quem chegou no apagão de 01–03/ago e ficou sem resposta.
// Semeia a fila UMA vez (?semear=1); ?dry=1 mostra quem entraria sem gravar nada.
// Sem parâmetro, roda um tick à mão — o consumo normal é no /process-messages,
// 1 pessoa a cada 20min entre 07h e 20h.
router.get('/eletroposto-repescagem', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    if (dry || req.query.semear === '1') {
      res.json({ ok: true, dry, ...(await semearRepescagem({ dry })) });
      return;
    }
    res.json({ ok: true, ...(await runRepescagemTick()) });
  } catch (err: any) {
    logger.error('cron', 'eletroposto-repescagem falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});
// ── SEMENTE: nutrição de quem pediu orçamento de solar e não fechou ──────────
// ?dry=1 mostra QUEM entraria e a mensagem que sairia, sem enviar nada — é o
// jeito de revisar a campanha em produção antes de ligar (SEMENTE_ON=true).
// Sem parâmetro, roda um tick à mão; o normal é rodar no /process-messages.
// ── Convite do grupo pra quem esfriou no eletroposto (não atendeu / sem interesse)
// ?publico=1 lista quem entraria e a mensagem, sem enviar.
router.get('/eletroposto-grupo-frios', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    if (req.query.publico === '1') {
      const p = await publicoGrupoFrio();
      res.json({ ok: true, total: p.length, amostra: p.slice(0, 20), exemplo: p[0] ? bolhasGrupoFrio(p[0].status, p[0].nome) : [] });
      return;
    }
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await runGrupoFriosTick({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'eletroposto-grupo-frios falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// ── Agente de agendamento do eletroposto (confirmação + 1h + 5min) ───────────
// ?dry=1 devolve exatamente quem receberia e o texto de cada bolha, sem enviar.
// O tick normal roda no /process-messages a cada 5 min.
router.get('/eletroposto-agenda', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await runEletropostoAgendaTick({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'eletroposto-agenda falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// ── Boas-vindas do solar (1 toque, na hora do cadastro) ──────────────────────
// ?dry=1 devolve quem receberia e o texto de cada bolha, sem enviar e sem gravar
// a flag — e funciona COM O AGENTE DESLIGADO, que é como a copy é conferida
// contra ficha real sem tocar em ninguém.
// O tick normal roda no /process-messages a cada 5 min.
router.get('/solar-boas-vindas', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await runSolarBoasVindasTick({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'solar-boas-vindas falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// ── Cliente de solar respondeu → recado pro consultor dono da ficha ──────────
// ?dry=1 mostra o recado que sairia e pra quem, sem mandar (e sem gravar marcador).
router.get('/solar-respostas', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await runSolarRespostasTick({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'solar-respostas falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// ── Respostas à automação da agenda → recado pro Thiago e pro Diego ──────────
// ?dry=1 mostra o aviso que sairia, sem mandar (e sem gravar o marcador).
router.get('/eletroposto-respostas', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await runEletropostoRespostasTick({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'eletroposto-respostas falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

router.get('/semente-solar', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    if (req.query.publico === '1') {
      const p = await publicoSemente();
      res.json({ ok: true, total: p.length, amostra: p.slice(0, 20), exemplo: p[0] ? bolhasSemente(p[0].proximo_toque, p[0].nome) : [] });
      return;
    }
    res.json({ ok: true, dry, ...(await runSementeTick({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'semente-solar falhou', err);
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
// 2º toque (cupom) pro backlog — semeia o cupom pra quem já tomou o opener e não respondeu.
// One-shot manual ao ligar o cupom (não agendar). ?dry=1 pra conferir a contagem sem semear.
router.get('/limpapro-cupom-seed', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await seedLimpaproCupomBacklog({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'limpapro-cupom-seed falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});
// 3º toque (fechamento) pro backlog — última msg fria pra quem tomou opener+cupom e segue
// mudo. One-shot manual ao ligar o fechamento. ?dry=1 confere a contagem sem semear.
router.get('/limpapro-fechamento-seed', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    res.json({ ok: true, dry, ...(await seedLimpaproFechamentoBacklog({ dry })) });
  } catch (err: any) {
    logger.error('cron', 'limpapro-fechamento-seed falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});
// 4º toque (grupo pago) pro backlog — convite pra Comunidade +Sol pra quem tomou os 3 toques
// do curso e nunca respondeu. One-shot manual ao ligar o grupo. ?dry=1 confere sem semear.
// ?todos=1 abre pra TODO abandono em aberto (inclusive quem nunca ouviu a Bia).
router.get('/limpapro-grupo-seed', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const todos = req.query.todos === '1' || req.query.todos === 'true';
    res.json({ ok: true, dry, todos, ...(await seedLimpaproGrupoBacklog({ dry, todos })) });
  } catch (err: any) {
    logger.error('cron', 'limpapro-grupo-seed falhou', err);
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

// TESTE gated — dispara o opener da Giovanna (follow-up) pra UM user_id, pelo
// caminho real (salva sessão por user_id, incrementa count). Valida o loop
// chama→contexto→vende num cliente antes da leva automática.
// /cron/giovanna-test-followup?userId=<uuid>
router.get('/giovanna-test-followup', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const userId = String(req.query.userId || '').trim();
    if (!userId) { res.status(400).json({ error: 'userId obrigatorio' }); return; }
    const r = await dispararOpenerTesteParaUser(userId);
    res.json(r);
  } catch (err: any) {
    logger.error('cron', 'giovanna-test-followup falhou', err);
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

// Campanha de reconquista com a entrada de R$19 (curso + 30 dias de plataforma).
// Público: FREE, inadimplente e quem cancelou. 3 toques; para quando ele responde.
//
// `?seco=1` NÃO envia e NÃO grava — devolve a prévia das mensagens. É como se
// revisa a campanha antes de ela tocar em alguém real. Use sempre antes de ligar.
// `?limite=N` limita os envios deste tick (o teto anti-ban ainda manda em cima).
router.get('/curso-entrada-19', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const seco = req.query.seco === '1' || req.query.seco === 'true';
    const limiteRaw = Number(req.query.limite);
    const limite = Number.isFinite(limiteRaw) && limiteRaw > 0 ? limiteRaw : undefined;
    const result = await runCursoEntradaBroadcast({ seco, limite });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'curso-entrada-19 falhou', err);
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

// Tick dedicado da Central de Automação do Gerador (disparos). Espelha o
// io-broadcast-tick: um blast pode levar até 4 min, então não roda dentro do
// /process-messages. Apontar o mesmo pinger de 1 min (Cloudflare Worker / GitHub
// Actions) pra cá. Gated por CRON_SECRET + kill-switch GERADOR_AUTOMACAO_ENABLED.
router.get('/gerador-broadcast-tick', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runGeradorBroadcastTick();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron', 'gerador-broadcast-tick falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Prospecção: motor das buscas de lead na Apify. A tela /gerador/prospeccao só
// enfileira o pedido em prospeccao_buscas; QUEM GASTA é este tick, com kill-switch
// (PROSPECCAO_APIFY_OFF), cap de leads por busca e cap de buscas por dia.
// Uma busca por tick: a run é assíncrona, então tick inicia, tick acompanha, tick importa.
router.get('/prospeccao-tick', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await runProspeccaoApifyTick();
    res.json(result);
  } catch (err) {
    logger.error('cron', 'prospeccao-tick falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Renovação semanal do token do Instagram (dura 60d; renova quando falta <14d).
// Apontar o pinger semanal (GitHub Actions) pra cá. Gated por kill-switch.
router.get('/instagram-refresh-token', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await refreshIgToken();
    res.json(result);
  } catch (err) {
    logger.error('cron', 'instagram-refresh-token falhou', err);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Facebook: varredura manual dos comentários (a automática roda no
// /process-messages a cada 5min). Serve pra conferir na hora depois de um
// comentário de teste, sem esperar o tick.
router.get('/facebook-comentarios', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    res.json(await varrerComentariosFacebook());
  } catch (err) {
    logger.error('cron', 'facebook-comentarios falhou', err);
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

// Copiloto de tráfego 24h. Roda de hora em hora (master). SÓ AVISA no WhatsApp
// do Thiago (34991360223) quando há AÇÃO: escalar (ROAS forte), pausar sangrador,
// bateu meta (LimpaPro R$1200/dia · SolarDoc 10 clientes/dia), lembrete meia-noite.
// Dia parado = silêncio. Madrugada segura pra 7h. NÃO mexe no Meta.
// ?dry=1 → não envia, só loga a msg + match-rate. ?force=1 → ignora dedup/madrugada.
router.get('/auxiliar-trafego', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry   = req.query.dry === '1' || req.query.dry === 'true';
    const force = req.query.force === '1' || req.query.force === 'true';
    const result = await runAuxiliarTrafego({ dry, force });
    res.json({ ok: true, dry, force, ...result });
  } catch (err: any) {
    logger.error('cron', 'auxiliar-trafego falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// Loop CAPI: fechamentos da planilha CONTRATOS → lead capturado → Meta (conversão
// de leads). Roda de hora em hora no master, mas é idempotente (dedup por lead_id
// → não remanda). Teste: /cron/capi-leads?dry=1
router.get('/capi-leads', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const result = await runCapiLeads({ dry });
    res.json({ ok: true, dry, ...result });
  } catch (err: any) {
    logger.error('cron', 'capi-leads falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// Disciplina das ordens de tráfego: expira as vencidas (reconferindo no Meta se
// a condição ainda valia = perdida, ou já não vale = vencida) e abre as novas.
// Roda de hora em hora no master. Manual: /cron/ordens-trafego-tick
router.get('/ordens-trafego-tick', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await tickOrdens();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error('cron', 'ordens-trafego-tick falhou', err);
    res.status(500).json({ error: 'Cron failed', detail: String(err?.message || err) });
  }
});

// Digest de estoque baixo do Inventário (aba grátis). GATED: rodar manual /
// ?dry=1 primeiro pra conferir volume; só entra no master depois de adoção.
// O badge in-app já é o alerta sempre-ligado — o email é reforço opcional.
// /cron/inventory-low-stock?dry=1
router.get('/inventory-low-stock', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const result = await runInventoryLowStockAlert({ dry });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error('cron', 'inventory-low-stock falhou', err);
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
    ['abandoned-checkout-recovery', () => recoverAbandonedCheckouts()],  // COMEÇOU e NÃO passou cartão (checkout.session.expired): email + WhatsApp p/ retomar
    ['followup-email-cnpj',         () => runFollowupCnpj()],            // 5 emails/30d — gerador de proposta
    // ['no-contracts-reminder',       () => runNoContractsEmailReminder()], // [PAUSED-FOLLOWUP] lembrete inativos por email
    // 2026-06-30: WhatsApp Carla RELIGADO já como UMA persona (Giovanna) que leva
    //   o follow-up até a venda. Conserto feito: (1) o opener é salvo na sessão por
    //   user_id (registrarMsgProativa) → quando o cliente responde, a Giovanna lê o
    //   contexto e continua a MESMA conversa (não assume cega); (2) o opener é gerado
    //   na voz da Giovanna (não mais "Carla" seca) → uma pessoa só do 1º contato ao
    //   fechamento; (3) guarda anti-loop + saída pra humano no prompt da Giovanna.
    //   Teto anti-ban segue ativo (carlaThrottle, 4/h). Re-pausar = comentar as 2.
    //   2026-06-30: ARRANQUE controlado — guard dentroDaJanelaDeEnvio só deixa
    //   disparar HOJE entre 18:30–20:00 BRT (≈4 pessoas no tick das 19h). A partir
    //   de 01/jul o guard expira sozinho e a cadência volta 24/7 (4/h, ~96/dia).
    // Reconquista com a entrada de R$19 (curso + 30 dias). NÃO dispara sozinha:
    // exige CAMPANHA_CURSO19_ON=true no Vercel — disparo em massa não pode começar
    // só porque um deploy subiu. Sem a variável, este tick é no-op barato.
    // Divide o MESMO teto anti-ban (4/h) com as duas cadências da Carla abaixo.
    // Prévia sem enviar: GET /cron/curso-entrada-19?seco=1
    ['curso-entrada-19',            () => runCursoEntradaBroadcast()],    // 3 toques; para quando o lead responde
    ['carla-sem-cnpj',              () => runCarlaSemCnpjFollowup()],     // follow-up Giovanna — 3 toques 30d
    ['carla-inativo',               () => runCarlaInativoFollowup()],     // follow-up Giovanna — 5 toques 60d
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
    ['lembretes-agenda',            () => processarLembretesAgenda()], // [AVISOS-AGENDA-OFF 28/07] no-op: kill-switch dentro do módulo
    ['eletroposto-agenda',          () => runEletropostoAgendaTick()], // eletroposto: confirma ao marcar, avisa 1h e 5min antes (anti no-show)
    ['eletroposto-respostas',       () => runEletropostoRespostasTick()], // eletroposto: quem respondeu a automação vira recado pra equipe
    ['solar-boas-vindas',           () => runSolarBoasVindasTick()],     // solar: recibo do cadastro pro cliente (SOLAR_BOASVINDAS_OFF desliga)
    ['solar-respostas',             () => runSolarRespostasTick()],      // solar: resposta do cliente vira recado pro consultor dono
    ['dunning',                     () => runDunning()],            // 5 dias: D0-D4 lembrete, D5 cancela+free
    ['sync-stripe-plans',           () => syncStripePlans()],       // reconcilia users.plano com Stripe real (horário)
    ['meta-purchase-redrive',       () => reDrivePendingPurchases()], // reenvia Purchase que não confirmou entrega (garante Meta = card-pass)
    ['winback',                     () => runWinback()],            // emails D+7 e D+30 pra cancelados
    ['pix-vip-reminder',            () => runPixVipReminder()],     // avisa VIP-pix (84994501564) ~2d antes de vencer: valor + chave Pix
    // ['auxiliar-trafego',            () => runAuxiliarTrafego()],    // [COPILOTO-OFF 23/07] Thiago pediu pra desligar — não quer mais os avisos horários. Rota manual /cron/auxiliar-trafego segue existindo (só dispara se chamada à mão). Reativar = descomentar.
    ['ordens-trafego-tick',         () => tickOrdens()],           // disciplina das ordens: expira vencidas (reconfere Meta) + abre novas
    ['capi-leads',                  () => runCapiLeads()],         // loop: fechamento (planilha) → lead → Meta (conversão de leads, otimiza perfil)
    ['zapi-health',                 () => runZapiHealthCheck()],   // monitor: linha IO caída → 1 email pro Thiago (2 checagens seguidas). Toda a mensageria depende dela.
    ['alerta-lead-quente',          () => runAlertaLeadQuenteSemProposta()], // DARK (ALERTA_LEAD_QUENTE_ENABLED): lead quente sem proposta +48h → avisa o consultor dono 1×
    ['grupo-eletroposto-diario',    () => runGrupoEletropostoDiario()], // 1 publicação/dia no grupo (fila io_grupo_pauta); fila vazia avisa a equipe
    ['entrada-io-digest',           () => runEntradaIoDigest()],       // 12h e 18h: quem escreveu no 5040 hoje (ninguém responde por robô nessa linha)

    // ['inventory-low-stock',         () => runInventoryLowStockAlert()], // [GATED] digest de estoque baixo — ligar após adoção do Inventário
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
