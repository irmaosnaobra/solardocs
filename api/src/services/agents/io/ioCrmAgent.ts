// ─────────────────────────────────────────────────────────────────────
// CORA — Gestora silenciosa do CRM Irmãos na Obra
// Linha Z-API: 34998165040 (instance='io')
//
// Cora é a ÚNICA agente operando nesse número. A Luma SDR está
// desligada pra essa linha (ver sdrAgentService.ts:handleSdrLead
// early-return e cron.ts comentários).
//
// O QUE FAZ:
//   1) Roda no /cron/master (a cada hora) e dispara mensagem de followup
//      pra leads do simulador que não responderam dentro dos prazos da
//      cadência (D+2, D+3, D+5, D+8, D+12, D+20).
//   2) Quando lead responde no zap (detectado via processIoInboundForCrm),
//      pausa o followup, classifica via keywords e move o card no Kanban.
//
// NÃO FAZ:
//   - Não responde mensagens (apenas registra e classifica).
//   - Não inicia conversa do zero (só envia followup pra lead que veio
//     pelo simulador).
//   - Não envia fora de horário comercial (10h-17h BRT, seg-sex).
//   - Não envia pra lead com opt_out.
//
// COEXISTÊNCIA COM A LUMA (sdrAgentService):
//   A Luma cuida de leads que CHEGAM pelo zap (anúncio click-to-WhatsApp).
//   Esse agente cuida de leads que vieram pelo SIMULADOR (preencheram form
//   na LP). São fluxos paralelos. Se um lead simulador depois manda zap,
//   a Luma assume a conversa — esse agente só pausa o followup automático.
// ─────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { sendZAPI as sendWA } from '../zapiClient';
import { logger } from '../../../utils/logger';

// ─── Configuração da cadência ───────────────────────────────────────
// Boas-vindas imediatas (sem esperar dias) + 6 toques na cadência D+2 a D+20.
// Welcome é detectada por followup_last_at IS NULL — sai no primeiro ciclo
// de cron em horário comercial. Não incrementa followup_count (D+2 segue
// contando a partir da hora do welcome).
const CADENCIA_DIAS = [2, 3, 5, 8, 12, 20];

// Welcome enviado pela Cora QUANDO o lead conclui o simulador (POST /io-leads).
// Já avisa que recebemos a simulação e pergunta se pode ligar.
const WELCOME_MSG = (nome: string): string =>
  `Oi ${nome}, recebemos sua simulação aqui. Posso te ligar agora pra fechar os detalhes?`;

// Welcome enviado pela Cora QUANDO o lead manda primeira mensagem no zap
// (clicou no botão WhatsApp do simulador, abriu o app, mandou). Sai com 15s
// de delay pra parecer que humano notou e respondeu, não bot instantâneo.
const WELCOME_INBOUND_MSG = (nome: string): string =>
  `Oi ${nome}, um de nossos especialistas vai te atender, bem vindo aos Irmãos na Obra`;

const WELCOME_INBOUND_DELAY_MS = 15_000;

const MENSAGENS = (nome: string): string[] => [
  `Oi ${nome}, vamos fechar?`,
  `Oi ${nome}, vamos negociar ainda?`,
  `${nome}, desistiu do projeto? Quer uma ligação?`,
  `${nome}, você deve tá muito ocupado, quer marcar um horário?`,
  `${nome}, posso parar de te chamar?`,
  `Oi ${nome}, já tentamos diversos contatos, estamos encerrando por aqui, obrigado!`,
];

// Status que liberam o agente pra mandar followup. Se a equipe moveu pro
// 'vendido', 'perdido', 'quente' (negociação ativa) ou 'followup' manual
// agendado, ele não interfere.
const STATUS_ATIVOS = ['novo', 'em_contato', 'frio', 'morno'];

// ─── Helpers de horário ─────────────────────────────────────────────
function nowBRT(): Date {
  // Date em UTC + offset; pra horário local de Brasília criamos a partir
  // do toLocaleString.
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

export function isHorarioComercial(d: Date = nowBRT()): boolean {
  const dow = d.getDay();          // 0=dom, 6=sáb
  const hour = d.getHours();
  const isWeekday = dow >= 1 && dow <= 5;
  const isWindow = hour >= 10 && hour < 17;
  return isWeekday && isWindow;
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function primeiroNome(nome: string | null): string {
  if (!nome) return '';
  return nome.trim().split(/\s+/)[0] || '';
}

// ─── Detecção de keywords (classificação automática) ────────────────
type ClassificacaoAcao =
  | { tipo: 'em_negociacao'; motivo: string }
  | { tipo: 'proposta_enviada'; motivo: string }
  | { tipo: 'pausado'; motivo: string }
  | { tipo: 'desistiu'; motivo: string }
  | { tipo: 'opt_out'; motivo: string }
  | { tipo: 'em_conversa' };  // resposta normal sem keyword forte

const KW_NEGOCIACAO = [
  'quanto custa', 'qual o valor', 'qual valor', 'preço', 'preco',
  'quero fechar', 'vamos fechar', 'fechar o orcamento', 'fechar o orçamento',
  'como financia', 'financiamento', 'parcel', 'entrada', 'quantas vezes',
  'quando instala', 'prazo de instala', 'quanto tempo demora',
  'quero a proposta', 'manda o orcamento', 'manda o orçamento', 'manda a proposta',
  'atende minha regiao', 'atende minha região', 'atende aqui em',
];
const KW_PROPOSTA = [
  'tô analisando', 'to analisando', 'estou analisando',
  'vou ver com', 'vou pensar', 'vou conversar com',
  'comparando com outra', 'cotação com outra',
  'preciso falar com o banco', 'esperando o financiamento', 'esperando aprovar',
];
const KW_PAUSADO = [
  'depois eu vejo', 'mes que vem', 'mês que vem', 'ano que vem',
  'tô viajando', 'to viajando', 'tô ocupado', 'to ocupado', 'em obra',
  'me chama em', 'te chamo quando', 'esperando a próxima conta',
  'esperando a proxima conta',
];
const KW_DESISTIU = [
  'não tenho interesse', 'nao tenho interesse', 'desisti',
  'muito caro', 'fora do orçamento', 'fora do orcamento', 'nao cabe', 'não cabe',
  'já fechei com outra', 'ja fechei com outra', 'fechei com a',
  'vou esperar mais um tempo', 'não é prioridade', 'nao e prioridade',
];
const KW_OPT_OUT = [
  'para de me mandar', 'pare de me mandar', 'nao me chama mais', 'não me chama mais',
  'remove meu numero', 'remove meu número', 'sai do meu zap',
  'me incomoda', 'tô recebendo demais', 'to recebendo demais',
  'nao autorizei', 'não autorizei', 'nao pedi contato', 'não pedi contato',
];

function matchAny(msg: string, list: string[]): string | null {
  const m = msg.toLowerCase();
  for (const k of list) if (m.includes(k)) return k;
  return null;
}

export function classificarMensagem(msg: string): ClassificacaoAcao {
  // Ordem importa: opt-out > desistiu > pausado > negociacao > proposta > em_conversa
  const optKw = matchAny(msg, KW_OPT_OUT);
  if (optKw) return { tipo: 'opt_out', motivo: optKw };

  const desKw = matchAny(msg, KW_DESISTIU);
  if (desKw) return { tipo: 'desistiu', motivo: desKw };

  const pauKw = matchAny(msg, KW_PAUSADO);
  if (pauKw) return { tipo: 'pausado', motivo: pauKw };

  const negKw = matchAny(msg, KW_NEGOCIACAO);
  if (negKw) return { tipo: 'em_negociacao', motivo: negKw };

  const propKw = matchAny(msg, KW_PROPOSTA);
  if (propKw) return { tipo: 'proposta_enviada', motivo: propKw };

  return { tipo: 'em_conversa' };
}

// Mapeia ação da classificação → status do CRM (8 colunas existentes)
function statusFromAcao(acao: ClassificacaoAcao): { status: string | null; nota: string } {
  switch (acao.tipo) {
    case 'em_negociacao':    return { status: 'quente',     nota: `Cora · 🔥 keyword "${acao.motivo}"` };
    case 'proposta_enviada': return { status: 'quente',     nota: `Cora · 📋 analisando proposta ("${acao.motivo}")` };
    case 'pausado':          return { status: 'followup',   nota: `Cora · ⏳ pausa pedida ("${acao.motivo}")` };
    case 'desistiu':         return { status: 'perdido',    nota: `Cora · ❌ desistiu ("${acao.motivo}")` };
    case 'opt_out':          return { status: 'perdido',    nota: `Cora · 🚫 opt-out ("${acao.motivo}") — não contatar` };
    case 'em_conversa':      return { status: 'em_contato', nota: 'Cora · 💬 lead respondeu' };
  }
}

// ─── Inserir histórico de status ────────────────────────────────────
async function gravarHistorico(leadId: string, fromStatus: string | null, toStatus: string, nota: string | null) {
  try {
    await supabase.from('io_lead_history').insert({
      lead_id: leadId,
      from_status: fromStatus,
      to_status: toStatus,
      note: nota,
    });
  } catch (err) {
    logger.error('cora', `falha gravando histórico do lead ${leadId}`, err);
  }
}

// ─── Welcome instantâneo: chamado pelo controller após criar io_lead ──
//
// Best-effort: se está em horário comercial, manda boas-vindas agora.
// Senão, deixa pro cron pegar (vai sair 10h do próximo dia útil).
// Idempotente — claim atômico via followup_last_at IS NULL.
// Nunca lança exceção (rola fire-and-forget no controller).
export async function sendWelcomeIfBusinessHours(leadId: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (!isHorarioComercial()) {
      return { sent: false, reason: 'fora_horario' };
    }

    const { data: lead } = await supabase
      .from('io_leads')
      .select('id, nome, whatsapp, status, followup_last_at, opt_out, followup_paused')
      .eq('id', leadId)
      .single();

    if (!lead || lead.opt_out || lead.followup_paused) {
      return { sent: false, reason: 'nao_elegivel' };
    }
    if (lead.followup_last_at) {
      return { sent: false, reason: 'ja_enviado' };
    }
    if (!STATUS_ATIVOS.includes(lead.status)) {
      return { sent: false, reason: 'status_inativo' };
    }

    const now = new Date();
    const { data: claimed } = await supabase
      .from('io_leads')
      .update({
        followup_last_at: now.toISOString(),
        last_contact_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', leadId)
      .is('followup_last_at', null)
      .select('id')
      .maybeSingle();

    if (!claimed) return { sent: false, reason: 'race_condition' };

    const nome = primeiroNome(lead.nome);
    await sendWA(lead.whatsapp, WELCOME_MSG(nome), 'io');
    await gravarHistorico(lead.id, null, lead.status, 'Cora · 👋 boas-vindas enviadas (instantâneo)');
    logger.info('cora', `welcome instantâneo lead=${leadId} nome=${nome}`);
    return { sent: true };
  } catch (err) {
    logger.error('cora', `welcome instantâneo falhou lead=${leadId}`, err);
    return { sent: false, reason: 'erro' };
  }
}

// ─── Inbound: chamado quando lead responde no zap ───────────────────
//
// Procura io_lead pelo telefone (com ou sem 55) e:
//   - Marca last_inbound_at = agora
//   - Pausa followup automático
//   - Classifica msg e move card se keyword bater
//   - Grava histórico
//
// Retorna o lead atualizado ou null se não achou (não é simulador lead).
export async function processIoInboundForCrm(
  rawPhone: string,
  message: string,
): Promise<{ matched: boolean; classificacao?: ClassificacaoAcao; novoStatus?: string }> {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (!digits) return { matched: false };

  // Tenta achar por whatsapp salvo (com e sem 55)
  const candidatos = [
    digits,
    digits.startsWith('55') ? digits.slice(2) : `55${digits}`,
  ];

  const { data: lead, error } = await supabase
    .from('io_leads')
    .select('id, status, opt_out, nome, whatsapp, last_inbound_at')
    .or(candidatos.map(c => `whatsapp.eq.${c}`).join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !lead) return { matched: false };
  if (lead.opt_out) return { matched: true };

  // Detecta primeiro contato ANTES de atualizar last_inbound_at — vai
  // disparar mensagem "um especialista vai te atender" com 15s de delay.
  const isFirstInbound = !lead.last_inbound_at;

  const acao = classificarMensagem(message || '');
  const { status: novoStatus, nota } = statusFromAcao(acao);

  const update: Record<string, unknown> = {
    last_inbound_at: new Date().toISOString(),
    last_contact_at: new Date().toISOString(),
    followup_paused: true,
    updated_at: new Date().toISOString(),
  };

  if (acao.tipo === 'opt_out') update.opt_out = true;

  // Só atualiza status se for diferente E o atual é movediço (não veio
  // de decisão humana tipo 'vendido')
  const podeMover = !['vendido', 'perdido'].includes(lead.status) || acao.tipo === 'opt_out';
  if (novoStatus && novoStatus !== lead.status && podeMover) {
    update.status = novoStatus;
  }

  await supabase.from('io_leads').update(update).eq('id', lead.id);

  if (update.status) {
    await gravarHistorico(lead.id, lead.status, novoStatus!, nota);
  }

  logger.info('cora', `inbound classificado lead=${lead.id} ação=${acao.tipo} status=${update.status ?? '(mantido)'}`);

  // ─── Welcome do PRIMEIRO inbound (15s delay) ───────────────────────
  // Só dispara se for a primeira mensagem que o lead manda no zap.
  // Pula se opt_out (LGPD). Aguarda inline pra Vercel não matar o
  // setTimeout antes do request acabar (serverless mata callbacks
  // pendentes ao retornar).
  if (isFirstInbound && acao.tipo !== 'opt_out') {
    const nome = primeiroNome(lead.nome);
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          await sendWA(lead.whatsapp, WELCOME_INBOUND_MSG(nome), 'io');
          await gravarHistorico(lead.id, lead.status, lead.status, 'Cora · 👋 boas-vindas WhatsApp ("especialista vai atender")');
          logger.info('cora', `welcome inbound enviado lead=${lead.id} nome=${nome}`);
        } catch (err) {
          logger.error('cora', `falha enviando welcome inbound lead=${lead.id}`, err);
        }
        resolve();
      }, WELCOME_INBOUND_DELAY_MS);
    });
  }

  return { matched: true, classificacao: acao, novoStatus: update.status as string | undefined };
}

// ─── Cron: roda followups pendentes ─────────────────────────────────
export async function runIoCrmFollowups(): Promise<{
  welcomes: number;
  enviados: number;
  encerrados: number;
  pulado_horario?: boolean;
  erros: number;
}> {
  if (!isHorarioComercial()) {
    return { welcomes: 0, enviados: 0, encerrados: 0, pulado_horario: true, erros: 0 };
  }

  // Busca leads candidatos: status ativo, sem opt-out, sem pausa, ainda
  // não bateu o último contato (count < 6)
  const { data: leads, error } = await supabase
    .from('io_leads')
    .select('id, nome, whatsapp, status, created_at, followup_count, followup_last_at, last_contact_at, last_inbound_at')
    .in('status', STATUS_ATIVOS)
    .eq('opt_out', false)
    .eq('followup_paused', false)
    .lt('followup_count', CADENCIA_DIAS.length);

  if (error) {
    logger.error('cora', 'erro buscando leads', error);
    return { welcomes: 0, enviados: 0, encerrados: 0, erros: 1 };
  }
  if (!leads?.length) return { welcomes: 0, enviados: 0, encerrados: 0, erros: 0 };

  const now = new Date();
  let welcomes = 0;
  let enviados = 0;
  let encerrados = 0;
  let erros = 0;

  for (const lead of leads) {
    try {
      const nome = primeiroNome(lead.nome);

      // ─── BOAS-VINDAS — primeiro contato pra lead que acabou de entrar ──
      // Detecta por followup_last_at IS NULL. Não incrementa count (D+2
      // começa contando a partir do welcome).
      if (!lead.followup_last_at) {
        const { data: claimedW } = await supabase
          .from('io_leads')
          .update({
            followup_last_at: now.toISOString(),
            last_contact_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', lead.id)
          .is('followup_last_at', null)
          .eq('followup_paused', false)
          .select('id')
          .maybeSingle();

        if (!claimedW) continue;

        await sendWA(lead.whatsapp, WELCOME_MSG(nome), 'io');
        await gravarHistorico(lead.id, null, lead.status, 'Cora · 👋 boas-vindas enviadas');
        welcomes++;
        logger.info('cora', `welcome enviado lead=${lead.id} nome=${nome}`);
        continue;
      }

      // ─── CADÊNCIA NORMAL (D+2 .. D+20) ────────────────────────────────
      const proximoIdx = lead.followup_count;       // 0..5
      const diasNecessarios = CADENCIA_DIAS[proximoIdx];

      // Marco zero do timer = última mensagem trocada (qualquer direção).
      // Se já foi enviado welcome, conta a partir do followup_last_at.
      const marcoIso =
        lead.last_inbound_at ||
        lead.followup_last_at ||
        lead.last_contact_at ||
        lead.created_at;
      const dias = diasDesde(marcoIso);

      if (dias < diasNecessarios) continue;

      // Claim atômico — incrementa followup_count com optimistic lock pra evitar
      // disparo duplicado se o cron rodar 2x em paralelo
      const { data: claimed } = await supabase
        .from('io_leads')
        .update({
          followup_count: proximoIdx + 1,
          followup_last_at: now.toISOString(),
          last_contact_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', lead.id)
        .eq('followup_count', proximoIdx)
        .eq('followup_paused', false)
        .select('id')
        .maybeSingle();

      if (!claimed) continue;

      const msg = MENSAGENS(nome)[proximoIdx];

      await sendWA(lead.whatsapp, msg, 'io');
      enviados++;

      // Se foi a última mensagem (D+20), encerra
      if (proximoIdx + 1 >= CADENCIA_DIAS.length) {
        await supabase.from('io_leads').update({
          status: 'perdido',
          followup_paused: true,
          updated_at: now.toISOString(),
        }).eq('id', lead.id);
        await gravarHistorico(lead.id, lead.status, 'perdido', 'Cora · 📊 cadência D+20 sem resposta — reativação 90d');
        encerrados++;
      }

      logger.info('cora', `followup #${proximoIdx + 1} enviado lead=${lead.id} nome=${nome}`);
    } catch (err) {
      erros++;
      logger.error('cora', `falha enviando lead=${lead.id}`, err);
    }
  }

  return { welcomes, enviados, encerrados, erros };
}
