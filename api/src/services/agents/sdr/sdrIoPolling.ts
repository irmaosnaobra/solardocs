// Polling de leads NOVOS na linha Z-API "Irmaos na Obra" (instance 'io').
//
// Por que existe:
//   Z-API tem um bug confirmado em Multi Device onde NAO dispara webhook
//   on-message-received pra essa instancia, mesmo com receivedCallbackUrl
//   configurado corretamente. Outros endpoints de leitura (chat-messages,
//   messages-by-phone) tambem nao funcionam em Multi Device.
//
// Como funciona:
//   - Consulta GET /chats da Z-API IO (esse endpoint funciona em Multi Device)
//   - Pra cada chat com lastMessageTime nos ultimos N minutos:
//       - Se NAO tem sessao SDR existente → eh um lead NOVO. Assume frase
//         padrao do anuncio Meta ("Tenho interesse em energia solar!") e
//         dispara handleSdrLead. Funciona porque 100% dos leads click-to-WhatsApp
//         do anuncio chegam com essa frase pre-formatada.
//       - Se TEM sessao SDR existente → pula. A continuacao do fluxo (etapa 2+)
//         depende do webhook funcionar. Se webhook continuar falhando, abrir
//         ticket Z-API mencionando que /chat-messages nao funciona em MD.

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { handleSdrLead } from './sdrAgentService';
import { sendToGroup, sendWhatsApp, type ZapiInstance } from '../zapiClient';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FRASE_PADRAO_ANUNCIO = 'Tenho interesse em energia solar!';

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

    // Lead NOVO — dispara fluxo da Luma com frase padrao do anuncio
    try {
      await handleSdrLead(phone, FRASE_PADRAO_ANUNCIO, chat.name ?? null, undefined, 'io');
      processed++;
    } catch (err) {
      logger.error('sdr-io-poll', `handleSdrLead falhou pra ${phone}`, err);
      errors++;
    }
  }

  return { processed, skipped, errors };
}

// ─── Relatório diário às 21h BRT — enviado no grupo ─────────────────
//
// Compila números do dia + acumulado do mês, compara com meta R$220k,
// gera pontos positivos/negativos + dicas via Claude Haiku, manda no
// grupo "Agendamento". Dedup via system_state (1x por dia).

const META_MES = 220000;
const RELATORIO_HORA_BRT = 21; // 21h Brasília
const RELATORIO_KEY = 'ultimo_relatorio_diario_io';

function fmtBR(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function diasUteisRestantesMes(): number {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000); // BRT
  const ano = agora.getUTCFullYear();
  const mes = agora.getUTCMonth();
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  let count = 0;
  for (let d = agora.getUTCDate() + 1; d <= ultimoDia; d++) {
    const dt = new Date(Date.UTC(ano, mes, d));
    const dow = dt.getUTCDay();
    const iso = dt.toISOString().slice(0, 10);
    if (dow === 0 || dow === 6) continue;
    if (FERIADOS_BR_LUMA.has(iso)) continue;
    count++;
  }
  return count;
}

export async function enviarRelatorioDiario(): Promise<{ enviado: boolean; motivo?: string }> {
  // Só dispara entre 21:00 e 21:10 BRT pra dar margem se cron atrasar
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hora = brt.getUTCHours();
  const min = brt.getUTCMinutes();
  if (hora !== RELATORIO_HORA_BRT || min > 10) {
    return { enviado: false, motivo: 'fora da janela 21:00-21:10 BRT' };
  }

  // Dedup: já mandou hoje?
  const hojeISO = brt.toISOString().slice(0, 10);
  const { data: estado } = await supabase
    .from('system_state').select('value').eq('key', RELATORIO_KEY).maybeSingle();
  if (estado?.value && (estado.value as any).data === hojeISO) {
    return { enviado: false, motivo: 'já enviado hoje' };
  }

  // Coleta números
  const startOfDay = new Date(brt); startOfDay.setUTCHours(0, 0, 0, 0);
  const startDayUTC = new Date(startOfDay.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 1)).toISOString();

  const [
    leadsHoje, agendadosHoje, fechadosHoje, reativacaoHoje,
    fechadosMes, vendidoMes, totalLeads,
    porEstagio, perdidosHoje, descartadosHoje,
  ] = await Promise.all([
    supabase.from('sdr_leads').select('phone', { count: 'exact', head: true })
      .eq('instance', 'io').gte('created_at', startDayUTC),
    supabase.from('sdr_leads').select('phone', { count: 'exact', head: true })
      .eq('instance', 'io').gte('agendado_at', startDayUTC),
    supabase.from('sdr_leads').select('phone, valor_venda, codigo_contrato, nome, consultor')
      .eq('instance', 'io').eq('estagio', 'fechamento').gte('updated_at', startDayUTC),
    supabase.from('sdr_leads').select('phone', { count: 'exact', head: true })
      .eq('instance', 'io').gte('reativacao_enviada_at', startDayUTC),
    supabase.from('sdr_leads').select('phone, valor_venda, consultor')
      .eq('instance', 'io').eq('estagio', 'fechamento').gte('updated_at', startOfMonth),
    supabase.from('sdr_leads').select('valor_venda')
      .eq('instance', 'io').eq('estagio', 'fechamento').not('valor_venda', 'is', null).gte('updated_at', startOfMonth),
    supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io'),
    supabase.from('sdr_leads').select('estagio').eq('instance', 'io'),
    supabase.from('sdr_leads').select('phone', { count: 'exact', head: true })
      .eq('instance', 'io').eq('estagio', 'perdido').gte('updated_at', startDayUTC),
    supabase.from('webhook_debug').select('id', { count: 'exact', head: true })
      .gte('created_at', startDayUTC),
  ]);

  const somaMes = (vendidoMes.data ?? []).reduce((a: number, r: any) => a + (Number(r.valor_venda) || 0), 0);
  const somaHoje = (fechadosHoje.data ?? []).reduce((a: number, r: any) => a + (Number(r.valor_venda) || 0), 0);
  const pctMeta = (somaMes / META_MES) * 100;
  const faltaMeta = Math.max(0, META_MES - somaMes);
  const diasRest = diasUteisRestantesMes();
  const ritmoNec = diasRest > 0 ? faltaMeta / diasRest : 0;

  // Por estágio
  const estagioMap: Record<string, number> = {};
  for (const r of (porEstagio.data ?? [])) estagioMap[r.estagio] = (estagioMap[r.estagio] || 0) + 1;

  // Por consultor (mês)
  const consultorMes: Record<string, { count: number; valor: number }> = {};
  for (const r of (fechadosMes.data ?? [])) {
    const k = r.consultor || 'sem';
    if (!consultorMes[k]) consultorMes[k] = { count: 0, valor: 0 };
    consultorMes[k].count++;
    consultorMes[k].valor += Number(r.valor_venda) || 0;
  }

  // Dicas via IA
  let dicas = '';
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `Você é coach de vendas da Irmãos na Obra. Recebe os números do dia e gera 2-3 dicas práticas e diretas pra equipe bater a meta. Tom: motivacional mas sem frescura, focado em ação concreta. Cada dica em 1 frase. Não use bullets repetidos, sem emoji excessivo.`,
      messages: [{
        role: 'user',
        content: `META MÊS: R$ ${fmtBR(META_MES)} | VENDIDO: R$ ${fmtBR(somaMes)} (${pctMeta.toFixed(1)}%) | DIAS ÚTEIS RESTANTES: ${diasRest} | RITMO NECESSÁRIO/DIA: R$ ${fmtBR(ritmoNec)}

HOJE: ${leadsHoje.count} leads novos · ${agendadosHoje.count} agendamentos · ${(fechadosHoje.data?.length || 0)} fechamentos (R$ ${fmtBR(somaHoje)}) · ${reativacaoHoje.count} reativações enviadas · ${perdidosHoje.count} perdidos

PIPELINE: ${estagioMap.quente || 0} quente · ${estagioMap.morno || 0} morno · ${estagioMap.novo || 0} novo · ${estagioMap.reativacao || 0} reativação

Gere 3 dicas práticas curtas pra a equipe (Diego, Giovanna, Nilce, Thiago) bater meta. Saída: linhas começando com • (bullet).`,
      }],
    });
    dicas = (r.content[0] as { text: string }).text.trim();
  } catch {
    dicas = '• Foque nos leads quentes que estão aguardando agendamento\n• Reative quem tá em "morno" sem resposta há mais de 3 dias\n• Liga pra quem agendou mas ainda não fechou';
  }

  // Pontos positivos / negativos automáticos
  const positivos: string[] = [];
  const negativos: string[] = [];

  if (somaHoje > 0) positivos.push(`R$ ${fmtBR(somaHoje)} fechado hoje (${fechadosHoje.data?.length} contrato${(fechadosHoje.data?.length || 0) > 1 ? 's' : ''})`);
  if ((agendadosHoje.count || 0) >= 3) positivos.push(`${agendadosHoje.count} agendamentos novos — pipeline cheio`);
  if (pctMeta >= 50) positivos.push(`${pctMeta.toFixed(0)}% da meta já cumprida`);
  if (Object.keys(consultorMes).filter(k => k !== 'sem').length >= 3) positivos.push('Equipe inteira engajada (3+ consultores fechando)');

  if (somaHoje === 0) negativos.push('NENHUM fechamento hoje — atenção redobrada amanhã');
  if ((agendadosHoje.count || 0) === 0) negativos.push('Zero agendamentos novos hoje — preciso aquecer leads');
  if ((estagioMap.quente || 0) > 5 && somaHoje === 0) negativos.push(`${estagioMap.quente} leads quentes sem fechar — onde tá o gargalo?`);
  if (ritmoNec > somaHoje * 1.5 && diasRest > 0) negativos.push(`Ritmo necessário: R$ ${fmtBR(ritmoNec)}/dia útil pra bater meta`);
  if (pctMeta < 30 && diasRest < 10) negativos.push(`⚠️ Apenas ${pctMeta.toFixed(0)}% da meta com ${diasRest} dias úteis restantes`);

  if (positivos.length === 0) positivos.push('Dia neutro — vamo pra cima amanhã');
  if (negativos.length === 0) negativos.push('Sem alertas — equipe rodando bem');

  // Top consultor mês
  const topConsultor = Object.entries(consultorMes)
    .filter(([k]) => k !== 'sem')
    .sort((a, b) => b[1].valor - a[1].valor)[0];

  // Card final
  const dataBR = brt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const card = [
    `📊 *RELATÓRIO DIÁRIO — IRMÃOS NA OBRA*`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${dataBR}`,
    ``,
    `🎯 *META DO MÊS*`,
    `R$ ${fmtBR(somaMes)} / R$ ${fmtBR(META_MES)}  (${pctMeta.toFixed(1)}%)`,
    diasRest > 0 ? `Faltam ${diasRest} dias úteis · ritmo necessário R$ ${fmtBR(ritmoNec)}/dia` : 'Último dia útil do mês',
    ``,
    `✅ *HOJE*`,
    `• Leads novos: ${leadsHoje.count || 0}`,
    `• Reativações enviadas: ${reativacaoHoje.count || 0}`,
    `• Agendamentos: ${agendadosHoje.count || 0}`,
    `• Fechamentos: ${fechadosHoje.data?.length || 0} (R$ ${fmtBR(somaHoje)})`,
    `• Perdidos: ${perdidosHoje.count || 0}`,
    ``,
    `📈 *PIPELINE ATUAL*`,
    `• 🔴 Quente: ${estagioMap.quente || 0}`,
    `• 🟡 Morno: ${estagioMap.morno || 0}`,
    `• 🆕 Novo: ${estagioMap.novo || 0}`,
    `• ⚡ Reativação: ${estagioMap.reativacao || 0}`,
    `• ✅ Fechado: ${estagioMap.fechamento || 0}`,
    `Total: ${totalLeads.count || 0} leads`,
    ``,
    topConsultor ? `🏆 *TOP CONSULTOR DO MÊS*\n${topConsultor[0].toUpperCase()}: R$ ${fmtBR(topConsultor[1].valor)} (${topConsultor[1].count} contrato${topConsultor[1].count > 1 ? 's' : ''})` : '',
    ``,
    `🚀 *PONTOS POSITIVOS*`,
    ...positivos.map(p => `• ${p}`),
    ``,
    `⚠️ *PONTOS DE ATENÇÃO*`,
    ...negativos.map(n => `• ${n}`),
    ``,
    `💡 *DICAS DA LUMA PRA AMANHÃ*`,
    dicas,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔗 CRM completo: https://solardoc.app/crm`,
  ].filter(s => s !== null && s !== undefined).join('\n');

  // Envia pro grupo
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
  try {
    await sendToGroup(groupId, card, 'io');
    // Marca como enviado
    await supabase.from('system_state').upsert({
      key: RELATORIO_KEY,
      value: { data: hojeISO, enviado_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    return { enviado: true };
  } catch (err) {
    logger.error('relatorio-diario', 'falha ao enviar', err);
    return { enviado: false, motivo: 'falha no envio' };
  }
}

// ─── Auto-cleanup: deleta leads em "perdido" há mais de 45 dias ─────
//
// Lead vira "perdido" quando para de responder (após follow-ups esgotarem)
// ou a IA decide. Mantemos no CRM por 45 dias pra dar chance de retorno
// orgânico. Após esse prazo, exclui pra manter o CRM limpo.
//
// Importante: Lead descartado EXPLICITAMENTE pela tool descartar_lead já
// é DELETADO na hora — esta função só pega os "perdidos por silêncio".
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

// ─── Reativação em massa: leads importados que ainda não foram contactados ──
//
// Lista importada via POST /admin/sdr-leads/import vira leads com
// estagio='reativacao' e lead_origem='reativacao'.
//
// Cron processa em horário comercial (seg-sex 9h-20h, sem feriado), com meta
// de 50 leads/dia. Cron de 1min processa 1-2 leads por execução.
//
// Mensagem inicial é gerada via Claude pra ser personalizada e humanizada.
// Quando o lead RESPONDE, handleSdrLead processa normalmente: a Luma faz a
// qualificação e o estagio sai de 'reativacao' pra 'morno' (ou outro).

const FERIADOS_BR_LUMA: Set<string> = new Set([
  '2026-01-01','2026-02-16','2026-02-17','2026-04-03','2026-04-21',
  '2026-05-01','2026-06-04','2026-09-07','2026-10-12','2026-11-02',
  '2026-11-15','2026-11-20','2026-12-25',
  '2027-01-01','2027-02-08','2027-02-09','2027-03-26','2027-04-21',
  '2027-05-01','2027-05-27','2027-09-07','2027-10-12','2027-11-02',
  '2027-11-15','2027-11-20','2027-12-25',
]);

function emHorarioComercial(): boolean {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dia = brt.getUTCDay();
  if (dia === 0 || dia === 6) return false; // sem domingo/sábado
  const iso = brt.toISOString().slice(0, 10);
  if (FERIADOS_BR_LUMA.has(iso)) return false;
  const hora = brt.getUTCHours();
  return hora >= 9 && hora < 20;
}

async function gerarMsgReativacao(lead: any): Promise<string> {
  const nome = lead.nome ? lead.nome.split(' ')[0] : null;
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system: `Você é a Luma, SDR sênior de energia solar da Irmãos na Obra (sede Uberlândia/MG, 8 anos no setor). Está retomando contato com um lead frio que demonstrou interesse em energia solar tempos atrás. Escreva UMA mensagem inicial humanizada pra reativar.

REGRAS:
- 1-2 frases curtas. WhatsApp.
- 0-1 emoji NO MÁXIMO. Idealmente nenhum.
- Use o primeiro nome se tiver. Se não, evita "tudo bem".
- Tom de retomada respeitosa, não agressiva. Como se você tivesse esquecido de retomar e agora voltou pra resgatar.
- VARIE a abertura — não use sempre "Oi". Pode ser "Olá", "[Nome], voltei aqui", "Aqui é a Luma da Irmãos na Obra".
- NÃO mencione tabela de preços ou cobre nada. Só reabre conversa.
- Termine SEMPRE com uma pergunta curta que provoque resposta natural ("ainda faz sentido?", "bora retomar?", "quer ver as opções?").
- NÃO use frases de manual ("estou à disposição", "qualquer dúvida").
- Saída: APENAS o texto da mensagem, sem aspas.`,
      messages: [{
        role: 'user',
        content: `Nome: ${nome || 'sem nome'} · Cidade: ${lead.cidade || 'não informada'}\n\nGere a mensagem de reativação.`,
      }],
    });
    const txt = (r.content[0] as { text: string }).text.trim();
    return txt.replace(/^["']|["']$/g, '');
  } catch {
    // Fallback estático
    if (nome) return `Olá ${nome}, aqui é a Luma da Irmãos na Obra. Vi seu contato sobre energia solar e voltei pra te chamar — ainda faz sentido a gente conversar?`;
    return `Olá, aqui é a Luma da Irmãos na Obra. Vi seu interesse em energia solar e voltei pra retomar — ainda faz sentido a gente conversar?`;
  }
}

const META_REATIVACAO_DIA = 20;
const REATIVACOES_POR_EXECUCAO = 1;

export async function processarReativacao(): Promise<{ enviados: number; pulado_horario: boolean; meta_atingida: boolean }> {
  if (!emHorarioComercial()) {
    return { enviados: 0, pulado_horario: true, meta_atingida: false };
  }

  // Conta quantos foram reativados hoje (BRT)
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  brt.setUTCHours(0, 0, 0, 0);
  const inicioHojeBR = new Date(brt.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const { count: feitosHoje } = await supabase
    .from('sdr_leads')
    .select('phone', { count: 'exact', head: true })
    .gte('reativacao_enviada_at', inicioHojeBR);

  if ((feitosHoje ?? 0) >= META_REATIVACAO_DIA) {
    return { enviados: 0, pulado_horario: false, meta_atingida: true };
  }

  // Pega próximos da fila
  const restantes = META_REATIVACAO_DIA - (feitosHoje ?? 0);
  const limite = Math.min(REATIVACOES_POR_EXECUCAO, restantes);

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, instance, reativacao_tentativas')
    .eq('estagio', 'reativacao')
    .eq('instance', 'io')
    .is('reativacao_enviada_at', null)
    .order('created_at', { ascending: true })
    .limit(limite);

  if (!leads?.length) return { enviados: 0, pulado_horario: false, meta_atingida: false };

  let enviados = 0;
  for (const lead of leads) {
    try {
      const msg = await gerarMsgReativacao(lead);
      await sendWhatsApp(lead.phone, msg, 'io');

      // Anexa no histórico (cria sessão pra Luma manter contexto quando lead responder)
      const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('messages')
        .eq('phone', lead.phone)
        .eq('tipo', 'sdr')
        .maybeSingle();
      const oldMessages = (session?.messages as any[]) || [];
      await supabase.from('whatsapp_sessions').upsert({
        phone: lead.phone,
        tipo: 'sdr',
        nome: lead.nome,
        messages: [...oldMessages, { role: 'assistant', content: msg }].slice(-80),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'phone,tipo' });

      await supabase.from('sdr_leads').update({
        reativacao_enviada_at: new Date().toISOString(),
        reativacao_tentativas: (lead.reativacao_tentativas ?? 0) + 1,
        ultimo_contato: new Date().toISOString(),
        aguardando_resposta: true,
        ultima_mensagem: msg.slice(0, 300),
        updated_at: new Date().toISOString(),
      }).eq('phone', lead.phone);
      enviados++;
    } catch (err) {
      logger.error('reativacao', `falha pro lead ${lead.phone}`, err);
    }
  }

  return { enviados, pulado_horario: false, meta_atingida: false };
}

// ─── Revisão horária: Luma re-avalia contexto e reposiciona leads no funil ──
//
// Roda no /cron/process-messages a cada minuto, mas processa CADA lead apenas
// 1x por hora (controle via ultima_revisao_luma). Limita a 5 leads por execução
// pra não estourar custo de IA.
//
// REPOSICIONA EM AMBAS DIREÇÕES: pode promover (frio→quente) E rebaixar
// (quente→morno) baseado na evolução real da conversa.
//
// Estados finais protegidos: fechamento e perdido nunca são revisados.
//
// Quando muda: dispara card no grupo "🔄 Luma reposicionou Lead X de A → B + motivo"

const HIERARQUIA_FUNIL = ['frio', 'novo', 'morno', 'quente'] as const;
type EstagioFunil = typeof HIERARQUIA_FUNIL[number];

function direcaoMudanca(de: string, para: string): 'promocao' | 'rebaixamento' | 'lateral' | null {
  const iDe = HIERARQUIA_FUNIL.indexOf(de as EstagioFunil);
  const iPara = HIERARQUIA_FUNIL.indexOf(para as EstagioFunil);
  if (iDe === -1 || iPara === -1) return null;
  if (iPara === iDe) return null;
  if (iPara > iDe) return 'promocao';
  return 'rebaixamento';
}

function nomeEstagio(s: string): string {
  return ({ novo: 'Novo', frio: 'Frio', morno: 'Morno', quente: 'Quente' } as Record<string,string>)[s] || s;
}

interface RevisaoIA {
  estagio_sugerido: EstagioFunil;
  motivo: string;
}

async function avaliarLeadComIA(lead: any, historico: string): Promise<RevisaoIA | null> {
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Você é a Luma, SDR sênior de energia solar da Irmãos na Obra. Avalia o estágio atual de um lead com base no contexto da conversa e SUGERE em qual estágio ele deveria estar:

- "frio": conta de luz < R$200, sem capacidade financeira, recusou explicitamente, só curioso
- "novo": ainda sem nome ou contato inicial sem qualificação
- "morno": qualificou parcialmente — passou alguns dados (nome, consumo, telhado, etc) mas não fechou
- "quente": qualificou COMPLETO + aceitou agendamento (canal + horário definidos)

Saída em JSON puro, sem markdown:
{ "estagio_sugerido": "frio|novo|morno|quente", "motivo": "1 frase curta com a razão" }`,
      messages: [{
        role: 'user',
        content: `Lead: ${lead.nome || 'Sem nome'} · Cidade: ${lead.cidade || '—'}
Estágio atual: ${lead.estagio}
Agendamento: ${lead.canal_atendimento ? `${lead.canal_atendimento} ${lead.horario_atendimento}` : 'nenhum'}

CONVERSA:
${historico}`,
      }],
    });
    const txt = (r.content[0] as { text: string }).text.trim();
    const cleaned = txt.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!HIERARQUIA_FUNIL.includes(parsed.estagio_sugerido)) return null;
    return parsed;
  } catch (err) {
    logger.error('luma-revisao', 'erro avaliando lead', err);
    return null;
  }
}

export async function revisarLeadsLuma(): Promise<{ avaliados: number; promovidos: number }> {
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, estagio, canal_atendimento, horario_atendimento, instance, ultima_revisao_luma')
    .eq('instance', 'io')
    .not('estagio', 'in', '("fechamento","perdido")')
    .or(`ultima_revisao_luma.is.null,ultima_revisao_luma.lt.${umaHoraAtras}`)
    .order('ultima_revisao_luma', { ascending: true, nullsFirst: true })
    .limit(5);

  if (!leads?.length) return { avaliados: 0, promovidos: 0 };

  let avaliados = 0;
  let promovidos = 0;

  for (const lead of leads) {
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('messages')
      .eq('phone', lead.phone)
      .eq('tipo', 'sdr')
      .single();

    const messages = (session?.messages as any[]) || [];
    const historico = messages.slice(-30).map((m: any) =>
      `${m.role === 'user' ? 'Lead' : 'Luma'}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`
    ).join('\n');

    if (!historico) {
      // Sem histórico, só atualiza timestamp pra não ficar revisando vazio
      await supabase.from('sdr_leads').update({
        ultima_revisao_luma: new Date().toISOString(),
      }).eq('phone', lead.phone);
      continue;
    }

    const revisao = await avaliarLeadComIA(lead, historico);
    avaliados++;

    if (!revisao) {
      await supabase.from('sdr_leads').update({
        ultima_revisao_luma: new Date().toISOString(),
      }).eq('phone', lead.phone);
      continue;
    }

    const novoEstagio = revisao.estagio_sugerido;
    const direcao = direcaoMudanca(lead.estagio, novoEstagio);

    if (direcao) {
      await supabase.from('sdr_leads').update({
        estagio: novoEstagio,
        ultima_revisao_luma: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('phone', lead.phone);

      // Avisa no grupo — emoji difere se foi promoção ou rebaixamento
      const seta = direcao === 'promocao' ? '🔺' : '🔻';
      const linkWa = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
      const card = [
        `🔄 *LUMA REPOSICIONOU LEAD*`,
        ``,
        `*${lead.nome || 'Sem nome'}*  →  ${linkWa}`,
        `*${lead.cidade || '—'}*`,
        ``,
        `${seta} ${nomeEstagio(lead.estagio)}  →  *${nomeEstagio(novoEstagio)}*`,
        ``,
        `💡 ${revisao.motivo}`,
      ].join('\n');

      try {
        const inst: ZapiInstance = (lead.instance === 'io' ? 'io' : 'solardoc') as ZapiInstance;
        await sendToGroup(groupId, card, inst);
        promovidos++;
      } catch (err) {
        logger.error('luma-revisao', `falha ao avisar reposicionamento de ${lead.phone}`, err);
      }
    } else {
      // Mantém estágio mas atualiza timestamp
      await supabase.from('sdr_leads').update({
        ultima_revisao_luma: new Date().toISOString(),
      }).eq('phone', lead.phone);
    }
  }

  return { avaliados, promovidos };
}

// Lembretes pré-evento — 2 disparos separados por agendamento:
//  CLIENTE (WhatsApp): 30 min antes do horário (todos os canais)
//  GRUPO (alerta time):
//    - Vistoria   → 20 min antes
//    - Ligação/Meet → 2 min antes
// Cada disparo tem dedup independente (lembrete_cliente_at / lembrete_grupo_at).
// Janela de 90s cobre atraso do cron. Roda no /cron/process-messages a cada minuto.
export async function processarLembretesAgendamento(): Promise<{ cliente: number; grupo: number }> {
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
  const now = Date.now();

  // Pega todos os leads com agendamento futuro que ainda têm pelo menos 1 lembrete pendente
  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, canal_atendimento, horario_atendimento, horario_iso, endereco_vistoria, instance, lembrete_cliente_at, lembrete_grupo_at')
    .not('horario_iso', 'is', null)
    .in('canal_atendimento', ['ligacao', 'meet', 'vistoria']);

  if (!leads?.length) return { cliente: 0, grupo: 0 };

  let clienteEnviados = 0;
  let grupoEnviados = 0;

  for (const lead of leads) {
    if (!lead.horario_iso || !lead.canal_atendimento) continue;
    const eventoMs = new Date(lead.horario_iso).getTime();
    if (isNaN(eventoMs)) continue;
    if (now > eventoMs) continue; // já passou

    const isVistoria = lead.canal_atendimento === 'vistoria';
    const linkWa = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
    const minsRestantes = Math.max(1, Math.round((eventoMs - now) / 60000));
    const inst: ZapiInstance = (lead.instance === 'io' ? 'io' : 'solardoc') as ZapiInstance;

    // ── 1) Lembrete CLIENTE — 30 min antes ──
    if (!lead.lembrete_cliente_at) {
      const inicio = eventoMs - 30 * 60 * 1000;
      if (now >= inicio && now <= inicio + 90 * 1000) {
        const nome = (lead.nome || '').split(' ')[0] || '';
        let msg = '';
        if (isVistoria) {
          msg = `Oi${nome ? ' ' + nome : ''}! Lembrando que daqui ~30 min nosso técnico vai aí pra vistoria, no endereço *${lead.endereco_vistoria || 'combinado'}*, às *${lead.horario_atendimento}*. Tô avisando pra você ficar de olho. Qualquer ajuste me chama!`;
        } else if (lead.canal_atendimento === 'meet') {
          msg = `Oi${nome ? ' ' + nome : ''}! Lembrando que nosso consultor vai te chamar no *Google Meet* daqui ~30 min, às *${lead.horario_atendimento}*. O link vem aqui na hora. Já se prepara!`;
        } else {
          msg = `Oi${nome ? ' ' + nome : ''}! Lembrando que nosso consultor vai te ligar daqui ~30 min, às *${lead.horario_atendimento}*. Deixa o telefone à mão, beleza?`;
        }

        try {
          await sendWhatsApp(lead.phone, msg, inst);
          await supabase.from('sdr_leads').update({
            lembrete_cliente_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('phone', lead.phone);
          clienteEnviados++;
        } catch (err) {
          logger.error('lembrete-cliente', `falha pro lead ${lead.phone}`, err);
        }
      }
    }

    // ── 2) Lembrete GRUPO — 20min vistoria / 2min ligação-meet ──
    if (!lead.lembrete_grupo_at) {
      const antecedenciaMs = isVistoria ? 20 * 60 * 1000 : 2 * 60 * 1000;
      const inicio = eventoMs - antecedenciaMs;
      if (now >= inicio && now <= inicio + 90 * 1000) {
        let card = '';
        if (isVistoria) {
          card = [
            `🚨🚨 *ALERTA — VISTORIA EM ${minsRestantes} MIN* 🚨🚨`,
            ``,
            `*Cliente:* ${lead.nome || 'Sem nome'}`,
            `*WhatsApp:* ${linkWa}`,
            `*Cidade:* ${lead.cidade || '—'}`,
            ``,
            `📍 *ENDEREÇO*`,
            `${lead.endereco_vistoria || '⚠️ ENDEREÇO NÃO INFORMADO — verificar com cliente'}`,
            ``,
            `🕐 Horário marcado: *${lead.horario_atendimento}*`,
            `🚗 Saída recomendada: AGORA`,
          ].join('\n');
        } else {
          const emoji = lead.canal_atendimento === 'meet' ? '🎥' : '📞';
          const tipo = lead.canal_atendimento === 'meet' ? 'MEET (vídeo)' : 'LIGAÇÃO';
          card = [
            `⚠️⚠️ *LEMBRETE — ${tipo} EM ${minsRestantes} MIN* ⚠️⚠️`,
            ``,
            `*Cliente:* ${lead.nome || 'Sem nome'}`,
            `${emoji} *Telefone:* ${lead.phone}`,
            `🔗 ${linkWa}`,
            ``,
            `🕐 Horário marcado: *${lead.horario_atendimento}*`,
            `🟢 PREPARAR PRA CONTATO AGORA`,
          ].join('\n');
        }

        try {
          await sendToGroup(groupId, card, inst);
          await supabase.from('sdr_leads').update({
            lembrete_grupo_at: new Date().toISOString(),
            lembrete_enviado_at: new Date().toISOString(), // compat
            updated_at: new Date().toISOString(),
          }).eq('phone', lead.phone);
          grupoEnviados++;
        } catch (err) {
          logger.error('lembrete-grupo', `falha pro lead ${lead.phone}`, err);
        }
      }
    }
  }

  return { cliente: clienteEnviados, grupo: grupoEnviados };
}

// Processa webhook_debug recente procurando mensagens enviadas pelo celular
// (fromMe=true, fromApi=false) na linha IO. Pra cada uma, marca o lead com
// human_takeover=true — Luma vai ficar em silencio nessas conversas.
export async function processIoTakeoverEvents(): Promise<{ takeovers: number }> {
  const ioInstanceId = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  if (!ioInstanceId) return { takeovers: 0 };

  // Janela de 10min — Cron roda 1x/min, com folga pra cobrir lentidao da queue
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: events } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', cutoff)
    .filter('payload->>instanceId', 'eq', ioInstanceId)
    .filter('payload->>fromMe', 'eq', 'true');

  if (!events?.length) return { takeovers: 0 };

  const phonesToTakeover = new Set<string>();
  for (const ev of events) {
    const p: any = ev.payload;
    // fromApi=true → mensagem enviada pela nossa API (Luma) — NAO eh takeover
    if (p.fromApi === true || p.fromApi === 'true') continue;
    if (p.isGroup === true || p.isGroup === 'true') continue;
    const phone = String(p.phone ?? '').replace(/\D/g, '');
    if (!phone) continue;
    phonesToTakeover.add(phone);
  }

  if (!phonesToTakeover.size) return { takeovers: 0 };

  let takeovers = 0;
  for (const phone of phonesToTakeover) {
    // So marca se ainda nao tiver takeover (evita reset de timestamp)
    const { data: lead } = await supabase
      .from('sdr_leads')
      .select('human_takeover')
      .eq('phone', phone)
      .maybeSingle();
    if (lead && !lead.human_takeover) {
      await supabase.from('sdr_leads').update({
        human_takeover: true,
        human_takeover_at: new Date().toISOString(),
        aguardando_resposta: false,
        updated_at: new Date().toISOString(),
      }).eq('phone', phone);
      takeovers++;
    }
  }

  return { takeovers };
}
