// Polling do /chats da linha Z-API "Irmaos na Obra" (instance 'io').
//
// Por que existe:
//   Z-API tem um bug confirmado em Multi Device onde NAO dispara webhook
//   on-message-received pra essa instancia, mesmo com receivedCallbackUrl
//   configurado corretamente. Outros endpoints de leitura (chat-messages,
//   messages-by-phone) tambem nao funcionam em Multi Device.
//
// O que faz hoje (05/10/2026):
//   - Consulta GET /chats da Z-API IO (esse endpoint funciona em Multi Device).
//   - Pra cada chat que mexeu nos ultimos 5 minutos e em que o LEAD escreveu,
//     a unica coisa que ainda vira acao e a resposta de campanha: quem esta na
//     base do eletroposto e respondeu uma pergunta nossa vira aviso pra equipe.
//   - O resto nao recebe nada daqui. Inbound sem dono e da recepcao
//     (recepcaoIoPoll), e quem ficou sem resposta a sentinela do vacuo cobra.
//     A Luma, que pegava o lead novo neste ponto, foi removida em 05/10/2026.

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { tryClaimMessage, hasRecentWebhookClaim, temInboundRecebido } from './sdrAgentService';
import { sendWhatsApp } from '../zapiClient';
import { EQUIPE } from '../../../routes/ioEletroposto';
import { respostaDeCampanhaPonto, avisoDeResposta, pareceMensagemDoLead } from '../../io/pesquisaPontoRespostas';

export async function pollZapiMessagesIO(): Promise<{ processed: number; skipped: number; errors: number }> {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) return { processed: 0, skipped: 0, errors: 0 };

  // Janela de 5min — bem maior que o ciclo de cron (1min) pra cobrir falhas pontuais
  const cutoff = Date.now() - 5 * 60 * 1000;

  let chats: any[] = [];
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${id}/token/${token}/chats?pageSize=30`,
      { headers: { 'Client-Token': client } },
    );
    if (!res.ok) return { processed: 0, skipped: 0, errors: 0 };
    const data: any = await res.json();
    chats = Array.isArray(data) ? data : (data.value ?? data.chats ?? []);
  } catch (err) {
    logger.error('sdr-io-poll', 'fetch chats falhou', err);
    return { processed: 0, skipped: 0, errors: 1 };
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const chat of chats) {
    if (chat.isGroup === true || chat.isGroup === 'true') continue;
    if (!chat.phone) continue;

    const rawT = chat.lastMessageTime ?? 0;
    const lastTime = typeof rawT === 'number'
      ? (rawT > 1e12 ? rawT : rawT * 1000)
      : Number(rawT) || new Date(rawT).getTime();
    if (!lastTime || lastTime < cutoff) continue;

    const phone = String(chat.phone).replace(/\D/g, '');
    if (!phone) continue;

    // Skip se ja tem sessao SDR (eh lead em andamento, nao novo)
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('updated_at')
      .eq('phone', phone)
      .eq('tipo', 'sdr')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (session) {
      skipped++;
      continue;
    }

    // Skip se webhook acabou de reivindicar essa mensagem (race condition).
    // Webhook leva 3-4s pra salvar a sessão; nesse meio tempo o polling enxergaria
    // o lead como "novo" e duplicaria a boas-vindas. Janela de 90s cobre isso.
    if (await hasRecentWebhookClaim(phone)) {
      skipped++;
      continue;
    }

    // Reivindica a mensagem atomicamente. Se outro tick do cron já reivindicou,
    // pula. Chave usa lastTime pra que mensagens NOVAS do mesmo phone gerem
    // claim diferente.
    const synthId = `poll:${phone}:${lastTime}`;
    if (!(await tryClaimMessage(synthId, phone, 'poll'))) {
      skipped++;
      continue;
    }

    // ── A CONVERSA MEXEU NÃO QUER DIZER QUE O LEAD ESCREVEU (22/09/2026) ──────
    //
    // O /chats da Z-API muda `lastMessageTime` a cada mensagem da conversa, e a
    // nossa também é mensagem da conversa. Em 22/09 a régua do SIM liberou 18
    // horários às 14h50 e avisou cada pessoa; minutos depois a equipe recebeu
    // "RESPONDEU A PESQUISA DO PONTO — Respondeu (sem texto legível)" de gente que
    // não tinha escrito nada. Eram os nossos próprios envios voltando como
    // resposta, e o Andre gerou três avisos sozinho.
    //
    // A prova de que foi o LEAD: texto na última mensagem (o /chats não devolve
    // texto do que a gente manda), ou um claim `recep:` da recepção, que só existe
    // para mensagem RECEBIDA. Sem uma das duas, este chat não vira aviso: ele é só o
    // eco do que mandamos.
    //
    // Efeito conhecido: com o webhook da recepção fora do ar, uma resposta só de
    // áudio/figurinha deixa de ser vista aqui (a de texto continua).
    if (!pareceMensagemDoLead(chat.lastMessage ?? null, await temInboundRecebido(phone))) {
      skipped++;
      continue;
    }

    // RESPOSTA DE CAMPANHA NOSSA — não é lead de anúncio (30/08/2026). Quem já está na
    // base do eletroposto e responde uma pergunta que a gente fez vai pra GENTE, não pra
    // robô: um robô abriria outro assunto e tentaria agendar reunião, que é o que a régua de
    // ponto próprio proíbe pra quem não tem local. Quem tem reunião futura não cai aqui —
    // esse é do agente de agendamento.
    try {
      const camp = await respostaDeCampanhaPonto(phone);
      // Um aviso por pessoa por dia: quem escreve três vezes seguidas não vira três
      // avisos iguais na equipe (o claim do dia é o mesmo).
      if (camp && await tryClaimMessage(`campanha:${phone}:${new Date().toISOString().slice(0, 10)}`, phone, 'poll')) {
        const aviso = avisoDeResposta(camp, chat.lastMessage ?? null);
        await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, aviso, 'io')));
        logger.info('sdr-io-poll', `resposta de campanha avisada: ${camp.nome} (${phone})`);
        processed++;
        continue;
      }
    } catch (err) {
      logger.error('sdr-io-poll', `aviso de resposta de campanha falhou pra ${phone}`, err);
    }

    // Ninguém reivindicou: quem atende é a recepção (recepcaoIoPoll) e a sentinela do vácuo cobra.
    skipped++;
  }

  return { processed, skipped, errors };
}

// ─── Auto-cleanup: deleta leads em "perdido" há mais de 45 dias ─────
//
// Lead vira "perdido" quando para de responder (após follow-ups esgotarem)
// ou a IA decide. Mantemos no CRM por 45 dias pra dar chance de retorno
// orgânico. Após esse prazo, exclui pra manter o CRM limpo.
//
// Importante: o lead descartado EXPLICITAMENTE pela tool descartar_lead da Luma
// (removida em 05/10/2026) era DELETADO na hora. Esta função só pega os
// "perdidos por silêncio".
export async function cleanupPerdidosAntigos(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

  // Busca primeiro pra log
  const { data: aDeletar } = await supabase
    .from('sdr_leads')
    .select('phone, nome')
    .eq('instance', 'io')
    .eq('estagio', 'perdido')
    .lt('updated_at', cutoff)
    .limit(100);

  if (!aDeletar?.length) return { deleted: 0 };

  const phones = aDeletar.map(l => l.phone);

  // Deleta sessões e leads
  await supabase.from('whatsapp_sessions').delete().in('phone', phones).eq('tipo', 'sdr');
  const { error } = await supabase.from('sdr_leads').delete().in('phone', phones);

  if (error) {
    logger.error('cleanup-perdidos', 'falha deletando perdidos', error);
    return { deleted: 0 };
  }

  return { deleted: aDeletar.length };
}

// Limpa entradas de dedup com mais de 7 dias — são inúteis depois desse prazo
// e a tabela cresce indefinidamente sem isso.
export async function cleanupMessageDedup(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from('sdr_message_dedup')
    .delete({ count: 'exact' })
    .lt('processed_at', cutoff);
  if (error) {
    logger.error('cleanup-dedup', 'falha limpando dedup', error);
    return { deleted: 0 };
  }
  return { deleted: count ?? 0 };
}
