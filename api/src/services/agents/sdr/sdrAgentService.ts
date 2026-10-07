// O que sobrou do sdrAgentService (05/10/2026).
//
// A Luma SDR, que atendia lead de energia solar B2C, foi desligada em maio de 2026
// e removida do código em 05/10/2026: prompt, ferramentas, sessão do lead,
// handleSdrLead e o polling da linha SolarDoc. O agente do grupo IO
// (sdrGroupAgent), que ainda atende por "Luma", não é ela e fica.
// Ficaram aqui as três peças que outros módulos usam:
//   - o dedup atômico de mensagens (tryClaimMessage e companhia), usado pelo
//     webhook, pela Bia, pela recepção e pelo poll da linha IO;
//   - o card de agendamento do grupo IO (criarCardAgendamento), usado pelo
//     agente do grupo e pela rota /zapi-admin/io/test-card;
//   - o reenvio de card pendente (retryCardsPendentes), tarefa card_retry do
//     /cron/process-messages.

import { supabase } from '../../../utils/supabase';
import { fmtPhone, sendToGroup, deleteGroupMessage, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

// ─── Dedup atômico de mensagens recebidas ────────────────────────
//
// Por que existe: webhook Z-API às vezes redispara a mesma mensagem (retry após
// timeout), e o polling de fallback (cron 1min) compete com o webhook pra
// processar leads NOVOS antes do webhook salvar a sessão. Resultado: cliente
// recebia 2 boas-vindas idênticas. Esse dedup atômico garante que apenas o
// PRIMEIRO chamador processe — segundos chamadores recebem false e são pulados.
//
// Chave: 'whk:<messageId>' pra webhook, 'poll:<phone>:<lastMessageTime>' pra
// polling. Falha de unique violation (23505) = já processado, retorna false.

export async function tryClaimMessage(
  messageId: string,
  phone: string | null,
  source: 'webhook' | 'poll',
): Promise<boolean> {
  const { error } = await supabase.from('sdr_message_dedup').insert({
    message_id: messageId,
    phone,
    source,
  });
  if (!error) return true;
  if (error.code === '23505') return false; // já reivindicado por outro processo
  // Erro inesperado (rede, RLS): loga mas DEIXA PROCESSAR — cliente sem resposta é pior que duplicada
  logger.warn('dedup', `falha reivindicando ${messageId}: ${error.message}`);
  return true;
}

// Checa se houve um claim recente do webhook pra esse phone — usado pelo polling
// pra evitar processar mensagem que o webhook já está cuidando.
export async function hasRecentWebhookClaim(phone: string, secondsAgo = 90): Promise<boolean> {
  const cutoff = new Date(Date.now() - secondsAgo * 1000).toISOString();
  const { data } = await supabase
    .from('sdr_message_dedup')
    .select('message_id')
    .eq('phone', phone)
    .eq('source', 'webhook')
    .gte('processed_at', cutoff)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// MENSAGEM RECEBIDA DE VERDADE (22/09/2026).
//
// A recepção da linha (recepcaoIo) grava um claim `recep:<id>` para CADA mensagem
// que CHEGA. O polling grava `poll:<phone>:<hora>` por MOVIMENTO na conversa — e
// movimento inclui o que NÓS mandamos. Quem quer saber "o lead falou?" pergunta
// pelos claims da recepção, não pelos do polling.
export async function temInboundRecebido(phone: string, minutos = 15): Promise<boolean> {
  const cutoff = new Date(Date.now() - minutos * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('sdr_message_dedup')
    .select('message_id')
    .eq('phone', phone)
    .like('message_id', 'recep:%')
    .gte('processed_at', cutoff)
    .limit(1);
  return !!(data && data.length);
}

function fmtBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function canalLabel(canal: string): string {
  if (canal === 'ligacao') return '📞 Ligação';
  if (canal === 'meet') return '🎥 Meet (vídeo)';
  if (canal === 'vistoria') return '🏠 Vistoria presencial';
  return canal;
}

export async function criarCardAgendamento(
  phone: string,
  canal: string,
  horario: string,
  observacoes: string | undefined,
  instance: ZapiInstance,
  horarioIso?: string,
  endereco?: string,
): Promise<{ ok: boolean; reason?: string }> {
  // Default: grupo "Agendamento" da linha IO. Override via env ZAPI_IO_GROUP_ID.
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';

  // Busca contexto do lead
  const { data: lead } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, estado, estagio, total_mensagens, ultima_mensagem, created_at, ctwa_clid, card_message_id, observacoes_internas')
    .eq('phone', phone)
    .single();

  // Pega histórico pra extrair info estruturada
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', phone)
    .eq('tipo', 'sdr')
    .single();

  const messages = (session?.messages as any[]) || [];
  const fullText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase();
  const fullTextOriginal = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');

  // Extração best-effort de campos do histórico
  const consumo = fullText.match(/r?\$?\s?(\d{2,5})\s?(reais|\/m[eê]s|por m[eê]s)?/i)?.[1] || '—';
  const padraoMatch = fullText.match(/\b(monof[aá]sico|bif[aá]sico|trif[aá]sico)\b[^.]*?(110v?|220v?|380v?)?/i);
  const padrao = padraoMatch ? padraoMatch[0].trim() : '—';
  const telhadoMatch = fullText.match(/\b(cer[aâ]mico|fibrocimento|met[aá]lico|laje|colonial|romano|solo)\b/i);
  const telhado = telhadoMatch ? telhadoMatch[0] : '—';

  const aumentaConsumo = /aumentar|ar[\s-]?condicionado|piscina|carro el[eé]trico|forno|obra|mais gente/i.test(fullText) ? 'sim' : '—';
  const casaPropria = /\b(casa pr[oó]pria|im[oó]vel pr[oó]prio|j[aá] [eé] minha)\b/i.test(fullText) ? 'própria'
    : /\baluguel|alugada\b/i.test(fullText) ? 'alugada' : '—';

  let pagamento = '—';
  if (/\bfinanciamento\b|\bfinanciar\b|\bbanco\b/i.test(fullText)) pagamento = 'financiamento';
  else if (/\bcart[aã]o\b/i.test(fullText)) pagamento = 'cartão de crédito';
  else if (/\b(recurso pr[oó]prio|[aà] vista|dinheiro)\b/i.test(fullText)) pagamento = 'recurso próprio';

  // Resumo dos últimos 6 turnos pra contexto humano
  const ultimas = messages.slice(-12).map((m: any) => {
    const c = typeof m.content === 'string' ? m.content : '[mídia]';
    return `${m.role === 'user' ? '👤' : '🤖'} ${c.slice(0, 200)}`;
  }).join('\n');

  const linkWa = `https://wa.me/${fmtPhone(phone)}`;
  const card = [
    `🔔 *NOVO ATENDIMENTO AGENDADO*`,
    ``,
    `*Cliente:* ${lead?.nome || session?.nome || 'Sem nome'}`,
    `*WhatsApp:* ${phone}  →  ${linkWa}`,
    `*Cidade:* ${lead?.cidade || '—'}${lead?.estado ? ` / ${lead.estado}` : ''}`,
    ``,
    `📋 *AGENDAMENTO*`,
    `• Canal: ${canalLabel(canal)}`,
    `• Horário: *${horario}*`,
    canal === 'vistoria' && endereco ? `• Endereço: ${endereco}` : null,
    observacoes ? `• Observações: ${observacoes}` : null,
    (lead as any)?.observacoes_internas ? `• Notas da equipe:\n${(lead as any).observacoes_internas}` : null,
    ``,
    `⚡ *QUALIFICAÇÃO*`,
    `• Conta de luz: R$ ${consumo}/mês`,
    `• Padrão de entrada: ${padrao}`,
    `• Telhado: ${telhado}`,
    `• Pretende aumentar consumo: ${aumentaConsumo}`,
    `• Casa: ${casaPropria}`,
    `• Pagamento preferido: ${pagamento}`,
    ``,
    `💬 *ÚLTIMAS MENSAGENS*`,
    ultimas || '(sem histórico)',
    ``,
    `📊 ${lead?.total_mensagens || 0} mensagens trocadas · lead criado em ${fmtBR(lead?.created_at)}`,
    `🔗 CRM: https://solardoc.app/crm`,
  ].filter(Boolean).join('\n');

  // Guarda o messageId do card anterior (se houver) pra deletar APÓS confirmar
  // que o novo card chegou no grupo. Evita ficar dois cards do mesmo cliente
  // empilhados quando há reagendamento ou atualização.
  const oldCardMessageId: string | null = (lead as any)?.card_message_id ?? null;

  // PRIMEIRO persiste o agendamento — se o sendToGroup falhar, o lead AINDA fica
  // marcado como quente no CRM e a equipe vê via dashboard. Card pendente pode
  // ser reenviado pelo cron de retry (campo card_enviado_at = null).
  const update: any = {
    canal_atendimento: canal,
    horario_atendimento: horario,
    agendado_at: new Date().toISOString(),
    card_enviado_at: null, // só marca quando o envio confirmar
    card_payload: card,    // salva pro retry
    card_group_id: groupId,
    estagio: 'quente',
    aguardando_resposta: false,
    updated_at: new Date().toISOString(),
    lembrete_enviado_at: null,
    lembrete_cliente_at: null, // reset pra disparar 30min antes do novo horário
    lembrete_grupo_at: null,   // reset pra disparar 20min/2min antes do novo horário
  };
  if (horarioIso) update.horario_iso = horarioIso;
  if (endereco) update.endereco_vistoria = endereco;
  await supabase.from('sdr_leads').update(update).eq('phone', phone);

  try {
    const sent = await sendToGroup(groupId, card, instance);
    await supabase.from('sdr_leads')
      .update({
        card_enviado_at: new Date().toISOString(),
        card_message_id: sent.messageId,
      })
      .eq('phone', phone);

    // Apaga o card antigo (best-effort — falha aqui não invalida o novo card).
    if (oldCardMessageId && sent.messageId && oldCardMessageId !== sent.messageId) {
      try {
        await deleteGroupMessage(groupId, oldCardMessageId, instance);
      } catch (delErr) {
        logger.warn('luma-card', `falha apagando card antigo ${oldCardMessageId} no grupo`, delErr);
      }
    }
    return { ok: true };
  } catch (err) {
    logger.error('luma-card', `falha ao enviar card pro grupo ${groupId}`, err);
    // Lead já está marcado quente e card_payload salvo — retry vai pegar
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Retry de cards de agendamento que ficaram pendentes (sendToGroup falhou).
// Roda no cron — pega leads com card_payload mas sem card_enviado_at.
export async function retryCardsPendentes(): Promise<{ retried: number; ok: number; failed: number }> {
  const { data: pendentes } = await supabase
    .from('sdr_leads')
    .select('phone, card_payload, card_group_id, instance, card_message_id')
    .is('card_enviado_at', null)
    .not('card_payload', 'is', null)
    .not('agendado_at', 'is', null)
    .limit(20);

  let ok = 0, failed = 0;
  for (const lead of (pendentes || []) as any[]) {
    if (!lead.card_payload || !lead.card_group_id) continue;
    const inst: ZapiInstance = (lead.instance === 'io' ? 'io' : 'solardoc');
    const oldMessageId: string | null = lead.card_message_id ?? null;
    try {
      const sent = await sendToGroup(lead.card_group_id, lead.card_payload, inst);
      await supabase.from('sdr_leads')
        .update({
          card_enviado_at: new Date().toISOString(),
          card_message_id: sent.messageId,
        })
        .eq('phone', lead.phone);
      ok++;
      logger.info('luma-card-retry', `card reenviado com sucesso pra ${lead.phone}`);

      // Apaga card antigo se houver (best-effort)
      if (oldMessageId && sent.messageId && oldMessageId !== sent.messageId) {
        try {
          await deleteGroupMessage(lead.card_group_id, oldMessageId, inst);
        } catch (delErr) {
          logger.warn('luma-card-retry', `falha apagando card antigo ${oldMessageId}`, delErr);
        }
      }
    } catch (err) {
      failed++;
      logger.error('luma-card-retry', `retry falhou pra ${lead.phone}`, err);
    }
  }

  return { retried: pendentes?.length || 0, ok, failed };
}
