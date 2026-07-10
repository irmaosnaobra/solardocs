// ─────────────────────────────────────────────────────────────────────────────
// Recuperação de checkout LimpaPro — agente "Bia" pela linha 34998165040.
//
// Contata quem entrou no checkout da Kiwify e não comprou (gerou pix / abandonou),
// pela instância Z-API 'recuperacao'. Arquitetura (auditada adversarialmente):
//
//   2 PRODUTORES semeiam marcadores em system_state → 1 CONSUMIDOR único drena.
//     • Real-time: webhook Kiwify → marcador ready_at = now + DEBOUNCE (earliest-wins).
//     • Backlog: seed dos ~12 leads em aberto, ready_at escalonado 10/10min (skip-if-exists).
//     • Consumidor (roda no tick de /process-messages ~5min): processa marcadores
//       prontos (ready_at<=now) com CLAIM atômico (DELETE…RETURNING), re-check de
//       pagamento, throttle, cap por tick, envio via Bia, e semeia a sessão de conversa.
//
// SALVAGUARDAS (obrigatórias — risco de mandar msg errada pra cliente real):
//   1. RE-CHECK de pagamento IMEDIATAMENTE antes de cada envio (jaPagou) + verdade
//      re-derivada da RPC limpapro_leads no consumo. O evento 'abandoned'/'waiting'
//      da Kiwify pode disparar DEPOIS de uma compra (visto: irineu -4.2h, alexsandro
//      -1.1h). Mandar "você abandonou" pra quem já comprou seria péssimo.
//   2. CLAIM atômico: 2 execuções concorrentes do consumidor (process-messages é
//      batido por 2 crons) não enviam 2x pro mesmo lead.
//   3. IDEMPOTÊNCIA: mark-before-send + cooldown 30d (jaContatado). 1 toque por lead.
//   4. THROTTLE horário + cap por tick (anti-ban da linha nova).
//   5. BACKOFF: sessão criada no envio + inbound da Bia faz emConversa()=true → para.
//
// Marcador carrega só {origem, ready_at, seeded_at, nome} — NUNCA snapshot do lead
// (webhook não tem telefone/estado; snapshot do backlog apodrece). A verdade vem da
// RPC lida no consumo, indexada por email.
//
// Best-effort: Z-API pode banir a linha; falhas são logadas e engolidas. Risco de ban
// aceito explicitamente pelo dono (linha nova, isolada de solardoc/io). Tudo é no-op
// enquanto recuperacaoHabilitada()=false (RECUP_ENABLED!='true' → merge dark seguro).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { sendHuman, fmtPhone } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { dentroDoTetoHorarioLinha } from './lineThrottle';

// A recuperação SAI pela MESMA linha física IO (34998165040) — decisão do Thiago:
// uma só linha, a IA de recuperação convive com o atendimento humano de energia solar.
// O roteamento é seguro: a Bia só conversa com quem ELA abordou (tem sessão
// tipo='recuperacao'); todo o resto da linha IO continua 100% humano.
const INSTANCE = 'io' as const;

// Habilitado? A linha IO já está configurada (instância 'io' em produção). Um flag
// de env (RECUP_ENABLED) permite ligar/desligar a recuperação sem mexer em código —
// fica DESLIGADA por padrão até o Thiago mandar ativar (merge dark seguro).
function recuperacaoHabilitada(): boolean {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  return Boolean(id && token && process.env.RECUP_ENABLED === 'true');
}

// Cooldown: não recontatar o mesmo lead dentro deste intervalo (1 toque por lead).
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
// Debounce: atraso entre o sinal de "aberto" e o contato (deixa a compra cair primeiro).
export const DEBOUNCE_MS = 8 * 60 * 1000; // 8 min
// Escalonamento do backlog: 5 min entre leads (cadência pedida pelo Thiago).
const SEED_STAGGER_MS = 5 * 60 * 1000;
// Anti-rajada intra-tick: no máximo N envios por execução do consumidor.
const MAX_ENVIOS_POR_TICK = 2;

const PENDING_PREFIX = 'limpapro_recovery_pending:';
// 2º toque (cupom): fila e marcador de "já enviei o cupom" próprios — INDEPENDENTES do
// opener (senão jaContatado bloquearia o cupom, ou limpar jaContatado re-mandaria o opener).
const CUPOM_PENDING_PREFIX = 'limpapro_cupom_pending:';
const CUPOM_SENT_PREFIX = 'limpapro_cupom_sent:';
// Quanto tempo após o OPENER (não o abandono) esperar antes do cupom. O Thiago pediu
// "2h sem responder"; medimos desde o opener porque é o relógio coerente (não dá pra
// "não responder" uma msg que ainda não chegou) e o opener sai ~8min após o abandono.
const CUPOM_DELAY_MS = 2 * 60 * 60 * 1000; // 2h

// 3º e ÚLTIMO toque (fechamento): quem tomou opener+cupom e continua em silêncio total.
// Fila e marcador próprios (mesma razão dos independentes do cupom). É a última mensagem
// FRIA — o cap de 3 toques que o Thiago aprovou. Depois disso, quem não respondeu fica quieto.
const FECHAMENTO_PENDING_PREFIX = 'limpapro_fechamento_pending:';
const FECHAMENTO_SENT_PREFIX = 'limpapro_fechamento_sent:';
// Espera após o CUPOM antes do toque de fechamento (dá tempo do cupom fazer efeito).
const FECHAMENTO_DELAY_MS = 20 * 60 * 60 * 1000; // 20h (≈ dia seguinte, sem virar madrugada)

// 2º toque (SEM desconto — decisão do Thiago: produto de qualidade recupera com bom
// atendimento + reforço de valor, não com cupom). Usa o checkout normal. DARK até
// RECUP_CUPOM_ENABLED='true' (nome do flag mantido pra não quebrar env existente).
function cupomHabilitado(): boolean {
  return recuperacaoHabilitada() && process.env.RECUP_CUPOM_ENABLED === 'true';
}

// 3º toque (fechamento). Flag PRÓPRIO — é a parte com maior risco de ban na linha
// compartilhada (mensagem fria adicional). DARK por padrão até o Thiago ligar de olhos
// abertos: RECUP_FECHAMENTO_ENABLED='true'. Reaproveita o link de cupom se houver.
function fechamentoHabilitado(): boolean {
  return recuperacaoHabilitada() && process.env.RECUP_FECHAMENTO_ENABLED === 'true';
}

type Origem = 'backlog' | 'realtime' | 'cupom' | 'fechamento';
interface PendingMarker { origem: Origem; ready_at: string; seeded_at: string; nome?: string | null; }

interface LeadAberto {
  nome: string | null;
  email: string;
  telefone: string | null;
  telefone_suspeito: boolean;
  produto: string | null;
  status: 'pix_gerado' | 'abandonou';
  valor_centavos: number | null;
  pix_ativo: boolean;
  horas_desde: number | null;
}

// ─── Mensagens da Bia (recuperação) — humanizadas, curtas, sem emoji-spam ─────
// Princípio: parece PESSOA ajudando, não robô/disparo. Bolhas curtas (1 ideia cada),
// pergunta no 1º toque (puxa resposta), foco em ATENDIMENTO e VALOR — nunca desconto.

// 1º toque — na hora. Só cuidado + pergunta. Zero pitch, zero desconto.
export function montarMensagem(lead: LeadAberto): string[] {
  const nome = (lead.nome || '').trim().split(/\s+/)[0];
  const oi = nome ? `Oi ${nome}, tudo bem?` : 'Oi, tudo bem?';
  const produto = 'LimpaPro Solar';

  if (lead.status === 'pix_gerado' && lead.pix_ativo) {
    return [
      oi,
      `Vi aqui que você gerou o Pix do ${produto} agora há pouco e ele ainda não caiu.`,
      `Deu algum problema pra pagar? Se quiser eu te reenvio o link pra finalizar rapidinho.`,
    ];
  }
  if (lead.status === 'pix_gerado') {
    return [
      oi,
      `Você tinha gerado o Pix do ${produto}, mas ele acabou expirando.`,
      `Quer que eu gere um link novo pra você concluir? É rápido.`,
    ];
  }
  return [
    oi,
    `Vi que você tava garantindo o ${produto} agora há pouco e parou bem na hora de finalizar.`,
    `Travou o pagamento ou ficou alguma dúvida? Me fala que eu resolvo com você.`,
  ];
}

// 2º toque — algumas horas depois (sem resposta). Tira a objeção + reforça valor +
// oferece suporte pessoal (concierge). SEM desconto. Link = checkout normal.
export function montarMensagemCupom(lead: LeadAberto): string[] {
  const nome = (lead.nome || '').trim().split(/\s+/)[0];
  const oi = nome ? `${nome}, ` : '';
  const link = process.env.RECUP_CHECKOUT_URL?.trim() || '';
  const out = [
    `${oi}só pra te deixar tranquilo:`,
    `Assim que o pagamento cai, o curso já libera direto aqui no seu WhatsApp — e o acesso é seu pra sempre, você assiste no seu ritmo.`,
    `É conteúdo direto ao ponto, do jeito que se faz de verdade no campo. E qualquer dúvida depois, é só me chamar aqui que eu te ajudo.`,
  ];
  out.push(link ? `Quer finalizar agora? É só por aqui: ${link}` : `Quer que eu te reenvie o link pra finalizar?`);
  return out;
}

// 3º toque — no dia seguinte. Fechamento com classe: última chance, sem pressão,
// atendimento pessoal no final. SEM desconto. Link = checkout normal.
export function montarMensagemFechamento(lead: LeadAberto): string[] {
  const nome = (lead.nome || '').trim().split(/\s+/)[0];
  const oi = nome ? `${nome}, ` : '';
  const link = process.env.RECUP_CHECKOUT_URL?.trim() || '';
  return [
    `${oi}não vou te encher mais — essa é minha última mensagem sobre isso.`,
    link ? `Se ainda quiser começar, é só finalizar por aqui: ${link}` : `Se ainda quiser começar, me chama que eu te passo o link.`,
    `E se não for o momento, sem problema nenhum. Quando decidir, é só me chamar que eu cuido de tudo com você. 👊`,
  ].filter(Boolean);
}

// ─── idempotência via system_state (envios efetivados) ──────────────
function stateKey(email: string): string {
  return `limpapro_recovery:${email.toLowerCase().trim()}`;
}
function fechamentoPendingKey(email: string): string {
  return `${FECHAMENTO_PENDING_PREFIX}${email.toLowerCase().trim()}`;
}
function fechamentoSentKey(email: string): string {
  return `${FECHAMENTO_SENT_PREFIX}${email.toLowerCase().trim()}`;
}
async function jaMandeiFechamento(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('key').eq('key', fechamentoSentKey(email)).maybeSingle();
  return Boolean(data);
}
async function marcarFechamentoEnviado(email: string): Promise<void> {
  await supabase.from('system_state').upsert({
    key: fechamentoSentKey(email),
    value: { sent_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}
function pendingKey(email: string): string {
  return `${PENDING_PREFIX}${email.toLowerCase().trim()}`;
}
function cupomPendingKey(email: string): string {
  return `${CUPOM_PENDING_PREFIX}${email.toLowerCase().trim()}`;
}
function cupomSentKey(email: string): string {
  return `${CUPOM_SENT_PREFIX}${email.toLowerCase().trim()}`;
}

async function jaMandeiCupom(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('key').eq('key', cupomSentKey(email)).maybeSingle();
  return Boolean(data);
}
async function marcarCupomEnviado(email: string): Promise<void> {
  await supabase.from('system_state').upsert({
    key: cupomSentKey(email),
    value: { sent_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

async function jaContatado(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('value').eq('key', stateKey(email)).maybeSingle();
  const v = (data?.value ?? {}) as { contacted_at?: string };
  if (!v.contacted_at) return false;
  return Date.now() - new Date(v.contacted_at).getTime() < COOLDOWN_MS;
}

// Quando o opener foi enviado (ISO) — usado pra cravar o cupom em opener+2h no backlog.
async function quandoContatado(email: string): Promise<number | null> {
  const { data } = await supabase
    .from('system_state').select('value').eq('key', stateKey(email)).maybeSingle();
  const v = (data?.value ?? {}) as { contacted_at?: string };
  return v.contacted_at ? new Date(v.contacted_at).getTime() : null;
}

async function marcarContatado(email: string, lead: LeadAberto): Promise<void> {
  await supabase.from('system_state').upsert({
    key: stateKey(email),
    value: { contacted_at: new Date().toISOString(), status: lead.status, produto: lead.produto, telefone: lead.telefone },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

// ─── re-check de pagamento (debounce duro) ──────────────────────────
async function jaPagou(email: string): Promise<boolean> {
  // email já vem normalizado (lowercase) da RPC; eq direto (sem interpolar em .or).
  const { count } = await supabase
    .from('limpapro_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'purchase').eq('status', 'paid')
    .eq('buyer_email', email.toLowerCase().trim());
  return (count ?? 0) > 0;
}

// ─── backoff: lead já está conversando? ─────────────────────────────
// Gera variantes BR do telefone (Z-API às vezes omite/inclui o 9º dígito).
function phoneVariants(raw: string): string[] {
  const clean = raw.replace(/\D/g, '');
  const c55 = clean.startsWith('55') ? clean : `55${clean}`;
  const addNine = (p: string) => (p.length === 12 && p.startsWith('55') ? p.slice(0, 4) + '9' + p.slice(4) : p);
  return Array.from(new Set([clean, clean.replace(/^55/, ''), c55, addNine(c55), addNine(c55).replace(/^55/, '')]));
}

async function emConversa(telefone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('messages, lead_data')
    .in('phone', phoneVariants(telefone))
    .eq('tipo', 'recuperacao')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return false;
  const msgs = (data.messages as unknown[]) || [];
  const ld = (data.lead_data ?? {}) as { human_takeover?: boolean };
  return msgs.length > 0 || ld.human_takeover === true;
}

// O CLIENTE respondeu (ou um humano assumiu)? Diferente de emConversa(): aqui ignoramos
// o próprio opener (role=assistant) e olhamos só se houve role='user'. É o gate do cupom —
// "não respondeu em 2h" só faz sentido se o cliente de fato não escreveu nada.
async function clienteRespondeu(telefone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('messages, lead_data')
    .in('phone', phoneVariants(telefone))
    .eq('tipo', 'recuperacao')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return false;
  const ld = (data.lead_data ?? {}) as { human_takeover?: boolean };
  if (ld.human_takeover === true) return true; // humano assumiu → Bia não insiste com cupom
  const msgs = (data.messages as { role?: string }[]) || [];
  return msgs.some(m => m?.role === 'user');
}

// ─── throttle por hora (anti-ban) ───────────────────────────────────
// Teto ÚNICO da linha física IO: conta os envios de TODOS os bots (Bia opener+cupom E
// followup do /gerador) na última hora. Mora em lineThrottle.ts pra que Bia e gerador
// dividam o MESMO orçamento — senão a linha mandaria N×MAX/h e tomaria ban (foi o bug
// do cupom: teto que só contava `recovery:`). Ver lineThrottle.BOT_SENT_PREFIXES.
const dentroDoTetoHorario = dentroDoTetoHorarioLinha;

// ─── elegibilidade lead-específica ──────────────────────────────────
async function porqueNaoEnviarLead(lead: LeadAberto): Promise<string | null> {
  if (!lead.telefone) return 'sem_telefone';
  if (lead.telefone_suspeito) return 'telefone_suspeito';
  if (await jaContatado(lead.email)) return 'ja_contatado';
  if (await jaPagou(lead.email)) return 'ja_pagou';        // re-check DURO no momento do envio
  if (await foiMarcadoPerdido(lead.telefone)) return 'perdido'; // já disse não → nunca reabrir a frio
  if (await emConversa(lead.telefone)) return 'em_conversa';
  return null;
}

// ─── envio: MARK → SEED sessão → SEND (ordem load-bearing) ──────────
async function enviarParaLead(lead: LeadAberto): Promise<void> {
  await marcarContatado(lead.email, lead);                  // 1. MARK (blinda reentrância)

  const phone = fmtPhone(lead.telefone!);
  await supabase.from('whatsapp_sessions').upsert({         // 2. SEED sessão (backoff + contexto pro inbound)
    phone, tipo: 'recuperacao', nome: lead.nome,
    messages: [{ role: 'assistant', content: montarMensagem(lead).join(' ') }],
    lead_data: {
      email: lead.email, produto: lead.produto, status: lead.status,
      valor_centavos: lead.valor_centavos, link: process.env.RECUP_CHECKOUT_URL || null,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });

  await sendHuman(lead.telefone!, montarMensagem(lead), INSTANCE);  // 3. SEND
  logger.info('limpapro-recovery', `contatado ${lead.email} (${lead.status}) via ${lead.telefone}`);

  // 4. AGENDA o 2º toque (cupom) pra +2h. Só semeia se o cupom estiver habilitado E
  //    ainda não foi enviado. ready_at relativo ao opener (agora). O envio em si tem
  //    re-check de pagamento + "cliente respondeu?" no consumidor — aqui só agenda.
  if (cupomHabilitado() && !(await jaMandeiCupom(lead.email))) {
    await supabase.from('system_state').upsert({
      key: cupomPendingKey(lead.email),
      value: { origem: 'cupom', ready_at: new Date(Date.now() + CUPOM_DELAY_MS).toISOString(),
               seeded_at: new Date().toISOString(), nome: lead.nome } as PendingMarker,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }
}

// ─── envio do 2º toque (cupom). Gates de SEND rodam no consumidor, não aqui. ──
async function enviarCupom(lead: LeadAberto): Promise<void> {
  await marcarCupomEnviado(lead.email);                     // 1. MARK (idempotência própria)
  // NÃO re-cria a sessão (já existe do opener); só registra a msg do cupom no histórico
  // pra Bia ter contexto se a pessoa responder depois. Append à conversa existente.
  const phone = fmtPhone(lead.telefone!);
  const texto = montarMensagemCupom(lead).join(' ');
  // Lê messages E lead_data pra fazer merge: o cupom FRIO já usou a alavanca de 30%, então
  // trava a oferta na conversa inbound (senão a Bia ofereceria o MESMO 30% de novo se a
  // pessoa responder depois). Merge (não sobrescreve) pra preservar o que o opener gravou.
  const { data: sess } = await supabase
    .from('whatsapp_sessions').select('messages, lead_data').in('phone', phoneVariants(lead.telefone!))
    .eq('tipo', 'recuperacao').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const hist = ((sess?.messages as unknown[]) || []).concat([{ role: 'assistant', content: texto }]);
  const ldMerged = { ...((sess?.lead_data as Record<string, unknown>) || {}), cupom_oferecido: true };
  await supabase.from('whatsapp_sessions').upsert({
    phone, tipo: 'recuperacao', nome: lead.nome, messages: hist, lead_data: ldMerged,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });

  await sendHuman(lead.telefone!, montarMensagemCupom(lead), INSTANCE);  // 2. SEND
  logger.info('limpapro-recovery', `cupom enviado ${lead.email} via ${lead.telefone}`);

  // 3. AGENDA o 3º toque (fechamento) pra +FECHAMENTO_DELAY. Só se habilitado e ainda não enviado.
  //    O envio em si tem re-check de pagamento + "cliente respondeu?" no consumidor — aqui só agenda.
  if (fechamentoHabilitado() && !(await jaMandeiFechamento(lead.email))) {
    await supabase.from('system_state').upsert({
      key: fechamentoPendingKey(lead.email),
      value: { origem: 'fechamento', ready_at: new Date(Date.now() + FECHAMENTO_DELAY_MS).toISOString(),
               seeded_at: new Date().toISOString(), nome: lead.nome } as PendingMarker,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }
}

// ─── envio do 3º toque (fechamento). Gates de SEND rodam no consumidor, não aqui. ──
async function enviarFechamento(lead: LeadAberto): Promise<void> {
  await marcarFechamentoEnviado(lead.email);                // 1. MARK (idempotência própria)
  const phone = fmtPhone(lead.telefone!);
  const texto = montarMensagemFechamento(lead).join(' ');
  const { data: sess } = await supabase
    .from('whatsapp_sessions').select('messages').in('phone', phoneVariants(lead.telefone!))
    .eq('tipo', 'recuperacao').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const hist = ((sess?.messages as unknown[]) || []).concat([{ role: 'assistant', content: texto }]);
  await supabase.from('whatsapp_sessions').upsert({
    phone, tipo: 'recuperacao', nome: lead.nome, messages: hist,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });

  await sendHuman(lead.telefone!, montarMensagemFechamento(lead), INSTANCE);  // 2. SEND
  logger.info('limpapro-recovery', `fechamento enviado ${lead.email} via ${lead.telefone}`);
}

// Lead marcado PERDIDO (recusou explícito)? Guarda dura contra mandar QUALQUER toque frio
// a quem já disse não — mesmo que outros gates não peguem. Lê status='perdido' da sessão.
async function foiMarcadoPerdido(telefone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('lead_data')
    .in('phone', phoneVariants(telefone)).eq('tipo', 'recuperacao')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data?.lead_data as { status?: string } | null)?.status === 'perdido';
}

// ─── elegibilidade do FECHAMENTO (3º toque) ─────────────────────────
// Mais restrito que o cupom: SÓ dispara se o cliente segue em silêncio TOTAL. Qualquer
// resposta/takeover → a conversa está viva, a Bia inbound cuida, não manda msg fria.
async function porqueNaoEnviarFechamento(lead: LeadAberto): Promise<string | null> {
  if (!lead.telefone) return 'sem_telefone';
  if (lead.telefone_suspeito) return 'telefone_suspeito';
  if (await jaMandeiFechamento(lead.email)) return 'fechamento_ja_enviado';
  if (await jaPagou(lead.email)) return 'ja_pagou';
  if (await foiMarcadoPerdido(lead.telefone)) return 'perdido';         // já disse não → nunca insiste
  if (await clienteRespondeu(lead.telefone)) return 'cliente_respondeu'; // conversa viva → não insiste a frio
  return null;
}

// ─── elegibilidade do CUPOM (2º toque) ──────────────────────────────
async function porqueNaoEnviarCupom(lead: LeadAberto): Promise<string | null> {
  if (!lead.telefone) return 'sem_telefone';
  if (lead.telefone_suspeito) return 'telefone_suspeito';
  if (await jaMandeiCupom(lead.email)) return 'cupom_ja_enviado';
  if (await jaPagou(lead.email)) return 'ja_pagou';            // re-check DURO: não dar desconto a quem já pagou cheio
  if (await foiMarcadoPerdido(lead.telefone)) return 'perdido'; // já disse não → não manda cupom
  if (await clienteRespondeu(lead.telefone)) return 'cliente_respondeu'; // respondeu/takeover → Bia humana cuida
  return null;
}

// ─── lê os leads em aberto (RPC validada) ───────────────────────────
async function lerLeadsAbertos(): Promise<LeadAberto[]> {
  const { data, error } = await supabase.rpc('limpapro_leads', { since_ts: null });
  if (error) { logger.error('limpapro-recovery', 'rpc limpapro_leads falhou', error); return []; }
  return (data?.leads_abertos ?? []) as LeadAberto[];
}

// ═════════════════════════════════════════════════════════════════════
// PRODUTOR REAL-TIME — webhook Kiwify (earliest-wins, NÃO envia, só agenda).
// Chamado em 'waiting_payment'/'abandoned' (NUNCA paid/refunded/chargeback).
// ═════════════════════════════════════════════════════════════════════
export async function agendarRecuperacaoRealtime(email: string | null, nome?: string | null): Promise<void> {
  if (!recuperacaoHabilitada()) return;                     // DARK: não acumula marcador enquanto desligado
  if (!email) return;
  const e = email.toLowerCase().trim();
  if (await jaContatado(e)) return;                         // corta na origem (dedup produtores)

  const readyAt = new Date(Date.now() + DEBOUNCE_MS);
  const { data: existing } = await supabase
    .from('system_state').select('value').eq('key', pendingKey(e)).maybeSingle();
  const prev = (existing?.value ?? null) as PendingMarker | null;

  // earliest-wins: nunca ATRASA um marcador existente (re-entregas da Kiwify dão
  // now+8min cada vez mais tarde → mantemos o mais cedo). Puxa pra frente um do backlog.
  if (prev?.ready_at && new Date(prev.ready_at).getTime() <= readyAt.getTime()) return;

  const marker: PendingMarker = {
    origem: 'realtime', ready_at: readyAt.toISOString(),
    seeded_at: new Date().toISOString(), nome: nome ?? prev?.nome ?? null,
  };
  await supabase.from('system_state').upsert(
    { key: pendingKey(e), value: marker, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  logger.info('limpapro-recovery', `realtime seed ${e} ready=${marker.ready_at}`);
}

// ═════════════════════════════════════════════════════════════════════
// SEED DO BACKLOG — os ~12 leads em aberto, ready_at escalonado 10/10min.
// SKIP-IF-EXISTS (idempotente): re-rodar não re-estagiona quem já está em voo.
// ═════════════════════════════════════════════════════════════════════
export async function seedLimpaproRecoveryBacklog(opts: { dry?: boolean } = {}): Promise<{
  semeados: number; pulados: number; motivo_skip: Record<string, number>;
}> {
  const motivo: Record<string, number> = {};
  const bump = (k: string) => { motivo[k] = (motivo[k] || 0) + 1; };
  if (!recuperacaoHabilitada()) return { semeados: 0, pulados: 0, motivo_skip: { desabilitado: 1 } };

  const leads = await lerLeadsAbertos();
  leads.sort((a, b) => (b.horas_desde ?? 0) - (a.horas_desde ?? 0)); // mais antigo primeiro

  const { data: existentes } = await supabase
    .from('system_state').select('key').like('key', `${PENDING_PREFIX}%`);
  const jaTemMarker = new Set((existentes ?? []).map(r => r.key.slice(PENDING_PREFIX.length)));

  const novos: { key: string; value: PendingMarker; updated_at: string }[] = [];
  const base = Date.now();
  let semeados = 0;

  for (const lead of leads) {
    const e = lead.email.toLowerCase().trim();
    if (!lead.telefone)         { bump('sem_telefone'); continue; }
    if (lead.telefone_suspeito) { bump('telefone_suspeito'); continue; }
    if (jaTemMarker.has(e))     { bump('ja_tem_marker'); continue; }
    if (await jaContatado(e))   { bump('ja_contatado'); continue; }

    novos.push({
      key: pendingKey(e),
      value: { origem: 'backlog', ready_at: new Date(base + semeados * SEED_STAGGER_MS).toISOString(),
               seeded_at: new Date().toISOString(), nome: lead.nome },
      updated_at: new Date().toISOString(),
    });
    semeados++;
  }

  if (!opts.dry && novos.length) {
    // INSERT-on-conflict-DO-NOTHING: não sobrescreve ready_at de quem já existe.
    await supabase.from('system_state').upsert(novos, { onConflict: 'key', ignoreDuplicates: true });
  }
  return { semeados, pulados: leads.length - semeados, motivo_skip: motivo };
}

// ═════════════════════════════════════════════════════════════════════
// SEED DO CUPOM (2º toque) PRO BACKLOG — quem JÁ tomou o opener e não respondeu.
// Os leads contatados antes do cupom existir nunca tiveram marcador de cupom semeado
// (o seed só acontece no enviarParaLead daqui pra frente). Esta função preenche essa
// lacuna: semeia o cupom pra quem foi contatado, não pagou e não respondeu — escalonado
// pra não blastar a linha. Idempotente (skip-if-exists no pending + no sent).
// ═════════════════════════════════════════════════════════════════════
export async function seedLimpaproCupomBacklog(opts: { dry?: boolean } = {}): Promise<{
  semeados: number; pulados: number; motivo_skip: Record<string, number>;
}> {
  const motivo: Record<string, number> = {};
  const bump = (k: string) => { motivo[k] = (motivo[k] || 0) + 1; };
  if (!cupomHabilitado()) return { semeados: 0, pulados: 0, motivo_skip: { cupom_desabilitado: 1 } };

  const leads = await lerLeadsAbertos();
  leads.sort((a, b) => (b.horas_desde ?? 0) - (a.horas_desde ?? 0));

  // Marcadores existentes (pending de cupom + sent de cupom) → skip-if-exists.
  const { data: pend } = await supabase
    .from('system_state').select('key').like('key', `${CUPOM_PENDING_PREFIX}%`);
  const jaPendCupom = new Set((pend ?? []).map(r => r.key.slice(CUPOM_PENDING_PREFIX.length)));

  const novos: { key: string; value: PendingMarker; updated_at: string }[] = [];
  const base = Date.now();
  let semeados = 0;

  for (const lead of leads) {
    const e = lead.email.toLowerCase().trim();
    if (!lead.telefone)            { bump('sem_telefone'); continue; }
    if (lead.telefone_suspeito)    { bump('telefone_suspeito'); continue; }
    if (jaPendCupom.has(e))        { bump('cupom_ja_agendado'); continue; }
    if (await jaMandeiCupom(e))    { bump('cupom_ja_enviado'); continue; }
    if (!(await jaContatado(e)))   { bump('sem_opener_ainda'); continue; } // só 2º toque p/ quem teve o 1º
    if (await jaPagou(e))          { bump('ja_pagou'); continue; }
    if (await clienteRespondeu(lead.telefone)) { bump('cliente_respondeu'); continue; }

    // ready_at respeita as 2h DESDE O OPENER pra todos: quem foi contatado há dias cai
    // pra "agora" (já passou) e quem tomou opener recente (Jadson/Lucimary) espera completar
    // as 2h. + stagger pra não disparar tudo no mesmo tick (anti-ban da linha compartilhada).
    const openerAt = await quandoContatado(e);
    const elegivelEm = openerAt ? openerAt + CUPOM_DELAY_MS : base; // sem timestamp → trata como pronto
    const readyAt = Math.max(elegivelEm, base) + semeados * SEED_STAGGER_MS;
    novos.push({
      key: cupomPendingKey(e),
      value: { origem: 'cupom', ready_at: new Date(readyAt).toISOString(),
               seeded_at: new Date().toISOString(), nome: lead.nome },
      updated_at: new Date().toISOString(),
    });
    semeados++;
  }

  if (!opts.dry && novos.length) {
    await supabase.from('system_state').upsert(novos, { onConflict: 'key', ignoreDuplicates: true });
  }
  return { semeados, pulados: leads.length - semeados, motivo_skip: motivo };
}

// ═════════════════════════════════════════════════════════════════════
// SEED DO FECHAMENTO (3º toque) PRO BACKLOG — quem JÁ tomou o cupom e segue em silêncio.
// Mesma lacuna do cupom: quem recebeu o 2º toque antes desta feature existir nunca teve
// marcador de fechamento. Só semeia p/ quem tomou o cupom, não pagou e não respondeu.
// Idempotente. É o toque MAIS restrito (última msg fria — cap de 3 aprovado pelo Thiago).
// ═════════════════════════════════════════════════════════════════════
export async function seedLimpaproFechamentoBacklog(opts: { dry?: boolean } = {}): Promise<{
  semeados: number; pulados: number; motivo_skip: Record<string, number>;
}> {
  const motivo: Record<string, number> = {};
  const bump = (k: string) => { motivo[k] = (motivo[k] || 0) + 1; };
  if (!fechamentoHabilitado()) return { semeados: 0, pulados: 0, motivo_skip: { fechamento_desabilitado: 1 } };

  const leads = await lerLeadsAbertos();
  leads.sort((a, b) => (b.horas_desde ?? 0) - (a.horas_desde ?? 0));

  const { data: pend } = await supabase
    .from('system_state').select('key').like('key', `${FECHAMENTO_PENDING_PREFIX}%`);
  const jaPendFech = new Set((pend ?? []).map(r => r.key.slice(FECHAMENTO_PENDING_PREFIX.length)));

  const novos: { key: string; value: PendingMarker; updated_at: string }[] = [];
  const base = Date.now();
  let semeados = 0;

  for (const lead of leads) {
    const e = lead.email.toLowerCase().trim();
    if (!lead.telefone)             { bump('sem_telefone'); continue; }
    if (lead.telefone_suspeito)     { bump('telefone_suspeito'); continue; }
    if (jaPendFech.has(e))          { bump('fechamento_ja_agendado'); continue; }
    if (await jaMandeiFechamento(e)) { bump('fechamento_ja_enviado'); continue; }
    if (!(await jaMandeiCupom(e)))  { bump('sem_cupom_ainda'); continue; } // só 3º toque p/ quem teve o 2º
    if (await jaPagou(e))           { bump('ja_pagou'); continue; }
    if (await clienteRespondeu(lead.telefone)) { bump('cliente_respondeu'); continue; }

    // Todos caem pra "agora" + stagger (o cupom do backlog já foi há tempo). Anti-rajada
    // pelo stagger + cap por tick + teto horário no consumidor.
    const readyAt = base + semeados * SEED_STAGGER_MS;
    novos.push({
      key: fechamentoPendingKey(e),
      value: { origem: 'fechamento', ready_at: new Date(readyAt).toISOString(),
               seeded_at: new Date().toISOString(), nome: lead.nome },
      updated_at: new Date().toISOString(),
    });
    semeados++;
  }

  if (!opts.dry && novos.length) {
    await supabase.from('system_state').upsert(novos, { onConflict: 'key', ignoreDuplicates: true });
  }
  return { semeados, pulados: leads.length - semeados, motivo_skip: motivo };
}

// ═════════════════════════════════════════════════════════════════════
// CONSUMIDOR ÚNICO — drena marcadores prontos. Roda no tick de /process-messages.
// Seguro sob execuções concorrentes via CLAIM por DELETE…RETURNING.
// Ordem de gates load-bearing:
//   PRÉ-claim (break → marcador SOBREVIVE): cap por tick + throttle horário.
//   PÓS-claim (continue → marcador consumido): !lead / jaPagou / emConversa / jaContatado.
// ═════════════════════════════════════════════════════════════════════
export async function runLimpaproRecoveryConsumer(opts: { dry?: boolean } = {}): Promise<{
  enviados: number; resolvidos: number; pulados: number; mantidos: number; motivo: Record<string, number>;
}> {
  const motivo: Record<string, number> = {};
  const bump = (k: string) => { motivo[k] = (motivo[k] || 0) + 1; };
  const out = { enviados: 0, resolvidos: 0, pulados: 0, mantidos: 0, motivo };
  if (!recuperacaoHabilitada()) { bump('desabilitado'); return out; }

  // 1. Marcadores prontos — opener, cupom E fechamento na mesma fila, ramifica por prefixo
  //    no loop. (poucas linhas → filtra/ordena em JS; sem operador-seta JSON no filtro, que é
  //    sintaxe não-exercitada no repo → risco de no-op silencioso).
  const { data: rows, error: stErr } = await supabase
    .from('system_state').select('key, value')
    .or(`key.like.${PENDING_PREFIX}%,key.like.${CUPOM_PENDING_PREFIX}%,key.like.${FECHAMENTO_PENDING_PREFIX}%`).limit(200);
  if (stErr) { logger.error('limpapro-recovery', 'consumer: ler markers falhou', stErr); bump('erro_markers'); return out; }

  const now = Date.now();
  const prontos = (rows ?? [])
    .filter(r => { const ra = (r.value as PendingMarker | null)?.ready_at; return !ra || new Date(ra).getTime() <= now; })
    .sort((a, b) => String((a.value as PendingMarker)?.ready_at ?? '').localeCompare(String((b.value as PendingMarker)?.ready_at ?? '')));
  if (prontos.length === 0) return out;

  // 2. Verdade atual — RPC DIRETA. Se falhar, ABORTA o tick com markers intactos
  //    (lerLeadsAbertos engole erro com [], o que deletaria o backlog inteiro como "todos pagaram").
  const { data: rpcData, error: rpcErr } = await supabase.rpc('limpapro_leads', { since_ts: null });
  if (rpcErr) {
    logger.error('limpapro-recovery', 'consumer: RPC falhou — abortando tick, markers preservados', rpcErr);
    bump('erro_rpc'); out.mantidos = prontos.length; return out;
  }
  const abertos = (rpcData?.leads_abertos ?? []) as LeadAberto[];
  const porEmail = new Map(abertos.map(l => [l.email.toLowerCase().trim(), l]));

  let enviadosTick = 0;
  for (const r of prontos) {
    // Tipo do marcador pelo prefixo: opener (toque 1), cupom (toque 2) ou fechamento (toque 3).
    const ehFechamento = r.key.startsWith(FECHAMENTO_PENDING_PREFIX);
    const ehCupom = r.key.startsWith(CUPOM_PENDING_PREFIX);
    const prefixo = ehFechamento ? FECHAMENTO_PENDING_PREFIX : ehCupom ? CUPOM_PENDING_PREFIX : PENDING_PREFIX;
    const email = r.key.slice(prefixo.length);
    const gate = ehFechamento ? porqueNaoEnviarFechamento : ehCupom ? porqueNaoEnviarCupom : porqueNaoEnviarLead;
    const enviar = ehFechamento ? enviarFechamento : ehCupom ? enviarCupom : enviarParaLead;
    const tag = ehFechamento ? 'fechamento' : ehCupom ? 'cupom' : 'opener';

    // ── GATES PRÉ-CLAIM (break → marcador sobrevive pro próximo tick) ──
    if (enviadosTick >= MAX_ENVIOS_POR_TICK) { out.mantidos++; bump('cap_tick'); break; }
    if (!opts.dry && !(await dentroDoTetoHorario())) { out.mantidos++; bump('teto_horario'); break; }
    // Toque desligado mas há marcador pendente: deixa quieto pro próximo tick (não claima).
    if (ehCupom && !cupomHabilitado()) { out.mantidos++; bump('cupom_desabilitado'); continue; }
    if (ehFechamento && !fechamentoHabilitado()) { out.mantidos++; bump('fechamento_desabilitado'); continue; }

    if (opts.dry) { // simula sem claimar/enviar/deletar
      const lead = porEmail.get(email);
      if (!lead) { bump(`resolvido_${tag}`); continue; }
      const skip = await gate(lead);
      if (skip) { bump(`${tag}:${skip}`); continue; }
      out.enviados++; enviadosTick++; bump(`enviaria_${tag}`); continue;
    }

    // ── CLAIM ATÔMICO: DELETE…RETURNING. Só UMA execução concorrente recebe a linha. ──
    const { data: claimed } = await supabase
      .from('system_state').delete().eq('key', r.key).select('key').maybeSingle();
    if (!claimed) { bump('corrida_perdida'); continue; } // outro tick levou

    // ── GATES PÓS-CLAIM (continue → marcador já consumido) ──
    const lead = porEmail.get(email);
    if (!lead) { out.resolvidos++; bump(`resolvido_${tag}`); continue; }  // pagou/estornou/saiu da RPC

    const skip = await gate(lead);
    if (skip) { out.pulados++; bump(`${tag}:${skip}`); continue; }

    try {
      await enviar(lead);
      out.enviados++; enviadosTick++;
    } catch (err) {
      out.pulados++; bump(`erro_envio_${tag}`);
      logger.error('limpapro-recovery', `consumer: envio ${tag} falhou ${email} (marcador já claimado)`, err);
      // best-effort/ban aceito: real-time não re-tenta; backlog auto-cura no próximo seed.
    }
  }
  return out;
}

// ─── TESTE: manda o 1º toque pra UM número específico (valida o ciclo completo) ──
// Cria a sessão de recuperação (faz ehLeadRecuperacao=true → backoff/inbound funcionam)
// e manda o opener pela linha IO. Lead sintético — NÃO passa pela RPC/seed (o número de
// teste não é lead real). Usado só pelo endpoint gated de teste, nunca em produção.
export async function enviarOpenerTeste(telefone: string, nome?: string | null): Promise<{ ok: boolean; motivo?: string }> {
  if (!recuperacaoHabilitada()) return { ok: false, motivo: 'desabilitado' };
  const lead: LeadAberto = {
    nome: nome ?? 'Teste', email: `teste+${telefone.replace(/\D/g, '')}@limpapro.local`,
    telefone, telefone_suspeito: false, produto: 'Limpa Solar Pro',
    status: 'abandonou', valor_centavos: 4700, pix_ativo: false, horas_desde: 1,
  };
  await enviarParaLead(lead);
  return { ok: true };
}
