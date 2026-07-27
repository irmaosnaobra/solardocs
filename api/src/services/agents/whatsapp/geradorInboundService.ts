// ─────────────────────────────────────────────────────────────────────────────
// Inbound + handoff do follow-up do /gerador (energia solar) — linha 34998165040.
//
// Quando o lead RESPONDE o toque de reengajamento, ESTE é o momento de "sucesso":
//   1. Notifica IMEDIATAMENTE o consultor dono (consultores.whatsapp) — UMA vez.
//   2. Responde ao lead de forma humana e curta (sem vender, sem cotar preço) dizendo
//      que o consultor vai chamar.
//   3. CALA o bot (handed_off=true) — daqui pra frente é o consultor humano que conduz.
//
// O bot NÃO negocia nem cota: é um "puxador". A regra de sucesso é deliberadamente burra
// e segura: qualquer resposta do lead que NÃO seja opt-out = sucesso → handoff. Não tenta
// classificar "positivo vs negativo" (frágil); o consultor decide ao assumir.
//
// Convive com a Bia na MESMA linha. PRECEDÊNCIA: um telefone que já é da Bia
// (sessão tipo='recuperacao') NUNCA é tocado aqui — o roteador checa Bia primeiro.
// E o bot só fala com quem ELE abordou (sessão tipo='gerador_followup'); cliente de
// energia em atendimento humano normal nunca casa → nunca é tocado.
//
// No-op enquanto GERADOR_FOLLOWUP_ENABLED!='true'.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { supabaseGerador } from '../../../utils/supabaseGerador';
import { sendHuman, sendWhatsApp, fmtPhone } from '../zapiClient';
import { tryClaimMessage } from '../sdr/sdrAgentService';
import { logger } from '../../../utils/logger';
import { followupHabilitado } from './geradorFollowupService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const INSTANCE = 'io' as const;
const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 20;
const CRM_BASE_URL = 'https://solardoc.app/gerador';

// Variantes BR do telefone (Z-API às vezes grava sem o 9º dígito). Mesmo helper da Bia.
export function phoneVariants(raw: string): string[] {
  const clean = raw.replace(/\D/g, '');
  const c55 = clean.startsWith('55') ? clean : `55${clean}`;
  const semDdi = c55.replace(/^55/, '');
  const add9 = c55.length === 12 ? c55.slice(0, 4) + '9' + c55.slice(4) : c55;
  const rem9 = c55.length === 13 && c55[4] === '9' ? c55.slice(0, 4) + c55.slice(5) : c55;
  return Array.from(new Set([clean, c55, semDdi, add9, rem9, add9.replace(/^55/, ''), rem9.replace(/^55/, '')]));
}

interface SolarLeadData {
  tel_key?: string; consultor?: string; cidade?: string | null;
  status_origem?: string; handed_off?: boolean; human_takeover?: boolean;
  consultor_notificado?: boolean;
}
interface SolarSession {
  phoneCanonico: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome: string | null;
  lead_data: SolarLeadData;
}

// Este telefone é um lead do followup solar? (sessão tipo='gerador_followup').
// PRECEDÊNCIA: o chamador deve checar ehLeadRecuperacao (Bia) ANTES — Bia ganha.
export async function ehLeadSolar(rawPhone: string): Promise<boolean> {
  if (!followupHabilitado()) return false;
  const { data } = await supabase.from('whatsapp_sessions')
    .select('id').in('phone', phoneVariants(rawPhone)).eq('tipo', 'gerador_followup').limit(1).maybeSingle();
  return Boolean(data);
}

const OPT_OUT = /\b(parar de mandar|para de mandar|chega de mensagem|n[ãa]o (me )?manda mais|n[ãa]o quero mais|me descadastr|descadastrar|sair da lista|cancela(r)? (meu )?cadastro|stop|nao perturbe|n[ãa]o perturbe)\b/i;

async function loadSession(rawPhone: string): Promise<SolarSession> {
  const { data } = await supabase.from('whatsapp_sessions')
    .select('phone, messages, nome, lead_data').in('phone', phoneVariants(rawPhone)).eq('tipo', 'gerador_followup')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return {
    phoneCanonico: (data?.phone as string) ?? fmtPhone(rawPhone),
    messages: (data?.messages as SolarSession['messages']) || [],
    nome: data?.nome ?? null,
    lead_data: (data?.lead_data as SolarLeadData) ?? {},
  };
}
async function saveSession(s: SolarSession, msgs: SolarSession['messages'], ld: SolarLeadData): Promise<void> {
  await supabase.from('whatsapp_sessions').upsert({
    phone: s.phoneCanonico, tipo: 'gerador_followup', nome: s.nome,
    messages: msgs.slice(-MAX_HISTORY * 2), lead_data: ld,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });
}

// ─── takeover: consultor/humano digitou pela linha → bot cala ───────
export async function marcarTakeoverSolar(rawPhone: string): Promise<void> {
  const s = await loadSession(rawPhone);
  await saveSession(s, s.messages, { ...s.lead_data, human_takeover: true });
  logger.info('gerador-inbound', `human takeover ${s.phoneCanonico} — bot silenciado`);
}

// ─── handoff: avisa o CONSULTOR dono IMEDIATAMENTE (1×). consultores.whatsapp mora no
//     gerador. Idempotente via flag consultor_notificado na própria sessão. ──────────
async function notificarConsultor(s: SolarSession, ld: SolarLeadData, ultimaMsgLead: string): Promise<void> {
  if (ld.consultor_notificado) return;
  const nomeConsultor = (ld.consultor || '').trim();
  if (!nomeConsultor) { logger.error('gerador-inbound', 'lead sem consultor — não dá pra notificar', { phone: s.phoneCanonico }); return; }

  const { data: c } = await supabaseGerador
    .from('consultores').select('whatsapp').eq('nome', nomeConsultor).maybeSingle();
  const wpp = (c?.whatsapp as string | undefined)?.trim();
  if (!wpp) { logger.error('gerador-inbound', 'consultor sem whatsapp cadastrado', { consultor: nomeConsultor }); return; }

  const nomeLead = (s.nome || '').trim() || 'Cliente';
  const telLead = s.phoneCanonico.replace(/^55/, '');
  const cid = ld.cidade ? `\n📍 ${ld.cidade}` : '';
  const linkCrm = `${CRM_BASE_URL}?crm=reagendar&consultor=${encodeURIComponent(nomeConsultor)}`;
  const msg =
    `🔥 *Lead respondeu o follow-up!*\n\n` +
    `*${nomeLead}* respondeu o reengajamento da Irmãos na Obra e tá aberto pra conversar.${cid}\n` +
    `📱 ${telLead}\n` +
    `💬 _"${ultimaMsgLead.slice(0, 160)}"_\n\n` +
    `Chama ele agora que tá quente. 👇\n${linkCrm}`;

  await sendWhatsApp(wpp, msg, INSTANCE);
  logger.info('gerador-inbound', `consultor ${nomeConsultor} notificado do lead ${s.phoneCanonico}`);
}

// ─── system prompt (BURRO e seguro: confirma interesse, NÃO vende, NÃO cota) ──
function buildSystemPrompt(nome: string | null): string {
  const primeiro = nome ? nome.trim().split(/\s+/)[0] : null;
  return `Você é atendente da "Irmãos na Obra" (energia solar) no WhatsApp. A pessoa tinha
agendado uma conversa sobre economizar na conta de luz, não rolou, e você mandou uma
mensagem retomando. Ela acabou de responder.

SEU ÚNICO PAPEL: confirmar de forma simpática que um consultor vai chamar ela em seguida.
Você NÃO é o vendedor — só faz a ponte. Já avisamos o consultor; ele assume a partir daqui.

${primeiro ? `Nome da pessoa: ${primeiro} (use só se ficar natural).` : 'Nome: desconhecido (não invente).'}

REGRAS DURAS — NUNCA:
- NUNCA cite preço, valor de conta, economia em R$, prazo de instalação ou número nenhum.
- NUNCA invente link, condição, desconto ou detalhe técnico.
- NÃO tente vender nem fazer simulação. Se perguntarem valores/detalhes, diga que o
  consultor vai passar tudo certinho na conversa.
- NÃO insista. Se a pessoa disser que não tem interesse, agradeça com educação e encerre.

COMO ESCREVER:
- WhatsApp: curto e humano, no máximo 2 bolhas separadas por ||. 1 frase por bolha.
  No máximo 1 emoji. Tom acolhedor, sem pressão.
- Resposta típica: confirmar que o consultor vai chamar já já. Ex.: "Que ótimo! || Já
  passei seu contato pro nosso consultor, ele vai te chamar aqui pertinho 😊"
- Se a pessoa claramente não quer: "Sem problema, qualquer coisa é só chamar. 👍" e pare.`;
}

// ─── handler principal — chamado quando ehLeadSolar()=true (e NÃO é da Bia) ──
export async function handleSolarInbound(rawPhone: string, text: string, senderName?: string | null): Promise<void> {
  if (!followupHabilitado()) return;
  const clean = (text || '').trim();
  if (!clean) return;

  const session = await loadSession(rawPhone);
  const ld = session.lead_data;
  session.nome = session.nome ?? senderName ?? null;

  // Humano já assumiu → registra a fala do lead e fica quieto.
  if (ld.human_takeover === true) {
    await saveSession(session, [...session.messages, { role: 'user', content: clean }], ld);
    return;
  }

  // Opt-out → para e marca (não conta como sucesso, não notifica consultor).
  if (OPT_OUT.test(clean)) {
    await sendHuman(rawPhone, ['Sem problema, não te incomodo mais por aqui.', 'Qualquer coisa é só chamar. 👍'], INSTANCE);
    await saveSession(session, [...session.messages, { role: 'user', content: clean }], { ...ld, human_takeover: true });
    logger.info('gerador-inbound', `opt-out ${session.phoneCanonico}`);
    return;
  }

  // ── SUCESSO: lead respondeu (não-optout). Notifica o consultor AGORA (1×) e fará handoff. ──
  // A notificação vem ANTES da resposta ao lead: o que importa é o consultor receber o lead
  // quente o quanto antes; se o envio ao lead falhar, o consultor já foi avisado.
  await notificarConsultor(session, ld, clean).catch(err =>
    logger.error('gerador-inbound', `notificar consultor falhou ${session.phoneCanonico}`, err));

  const messages = [...session.messages, { role: 'user' as const, content: clean }];
  let raw = '';
  try {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 250,
      system: buildSystemPrompt(session.nome),
      messages,
    });
    const block = resp.content.find(b => b.type === 'text') as { text: string } | undefined;
    raw = block?.text ?? '';
  } catch (err) {
    // IA falhou: ainda assim fazemos handoff com uma resposta fixa segura (consultor já avisado).
    logger.error('gerador-inbound', `claude falhou ${session.phoneCanonico}`, err);
    raw = 'Que bom que respondeu! || Já passei seu contato pro nosso consultor, ele vai te chamar aqui em seguida 😊';
  }

  const parts = raw.split('||').map(p => p.trim()).filter(Boolean).slice(0, 2);
  if (parts.length) await sendHuman(session.phoneCanonico, parts, INSTANCE);

  // handed_off=true + consultor_notificado=true → bot CALA. Daqui é humano.
  await saveSession(session, [...messages, { role: 'assistant', content: raw }],
    { ...ld, handed_off: true, human_takeover: true, consultor_notificado: true });
  logger.info('gerador-inbound', `handoff concluído ${session.phoneCanonico} → consultor ${ld.consultor}`);
}

// ─── INBOUND VIA webhook_debug (fallback do webhook /io, igual à Bia) ────────
// Via primária é o webhook /io em tempo real (notifica consultor em segundos). Este poll
// é a rede de segurança: o webhook Multi Device da Z-API às vezes não entrega o texto.
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

export async function pollGeradorFollowup(): Promise<{ processed: number; skipped: number; errors: number }> {
  if (!followupHabilitado()) return { processed: 0, skipped: 0, errors: 0 };

  const desde = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('webhook_debug').select('payload, created_at')
    .gte('created_at', desde).order('created_at', { ascending: true }).limit(200);
  if (error) { logger.error('gerador-poll', 'ler webhook_debug falhou', error); return { processed: 0, skipped: 0, errors: 1 }; }

  // Import tardio pra evitar ciclo de import (biaInboundService importa este? não — mas a
  // checagem de precedência precisa de ehLeadRecuperacao). Carrega só a função.
  const { ehLeadRecuperacao } = await import('./biaInboundService');

  let processed = 0, skipped = 0, errors = 0;
  for (const r of rows ?? []) {
    const p = (r.payload ?? {}) as Record<string, any>;
    if (p.type !== 'ReceivedCallback' || p.instanceId !== INSTANCE_ID_IO) { skipped++; continue; }
    if (p.isGroup === true || p.isGroup === 'true') { skipped++; continue; }

    const phone = String(p.phone || p.senderPhone || '').replace(/\D/g, '');
    if (!phone) { skipped++; continue; }

    // PRECEDÊNCIA: se é lead da Bia, NÃO é nosso (a Bia trata). Senão, é nosso?
    if (await ehLeadRecuperacao(phone)) { skipped++; continue; }
    if (!(await ehLeadSolar(phone))) { skipped++; continue; }

    const fromMe = p.fromMe === true || p.fromMe === 'true';
    const fromApi = p.fromApi === true || p.fromApi === 'true';
    if (fromMe) {
      // Humano (consultor) digitou pela linha, não o bot via API → takeover.
      if (!fromApi) {
        try { await marcarTakeoverSolar(phone); processed++; } catch (err) { errors++; logger.error('gerador-poll', `takeover ${phone}`, err); }
      } else skipped++;
      continue;
    }

    const texto = p.text?.message ?? (typeof p.text === 'string' ? p.text : '') ?? p.message ?? p.body ?? '';
    if (!String(texto).trim()) { skipped++; continue; }

    const messageId = p.messageId || p.zaapId || p.id || null;
    if (messageId) {
      const claimed = await tryClaimMessage(`gerador:${messageId}`, phone, 'poll');
      if (!claimed) { skipped++; continue; }
    }

    try {
      await handleSolarInbound(phone, String(texto), p.senderName || p.pushname || null);
      processed++;
    } catch (err) {
      logger.error('gerador-poll', `handleSolarInbound ${phone} falhou`, err);
      errors++;
    }
  }
  return { processed, skipped, errors };
}
