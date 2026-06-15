// ─────────────────────────────────────────────────────────────────────────────
// Bia — inbound conversacional da recuperação de checkout LimpaPro (linha 'recuperacao').
//
// Quando o cliente RESPONDE a mensagem de recuperação, a Bia conversa com IA (Claude
// Sonnet): tira dúvida, reenvia o link oficial de pagamento, contorna objeção — tom de
// atendente humana, simpática, NÃO insistente. Mantém histórico em whatsapp_sessions
// (tipo='recuperacao'), o que também faz o backoff do outbound (emConversa()=true).
//
// Via PRIMÁRIA: webhook /webhook/recup (tem o texto direto). Poll é fallback se o
// webhook Multi Device da Z-API falhar (bug conhecido — ver sdrIoPolling).
//
// Guard-rails duros no system prompt: NUNCA inventa preço/link/desconto. Pedido de
// desconto/reembolso/problema sério → tag [ESCALAR] → human_takeover (Bia cala, humano assume).
// Tudo no-op enquanto recuperacaoHabilitada()=false (RECUP_ENABLED!='true').
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendHuman, fmtPhone } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Recuperação sai pela MESMA linha IO (decisão Thiago). Roteamento seguro: a Bia só
// fala com quem ELA abordou (tem sessão tipo='recuperacao'); o resto da linha é humano.
const INSTANCE = 'io' as const;
const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 30;

function recuperacaoHabilitada(): boolean {
  return process.env.RECUP_ENABLED === 'true' && Boolean(process.env.ZAPI_INSTANCE_ID_IO?.trim());
}

// Roteamento: este telefone é um lead de recuperação que a Bia abordou? (tem sessão
// tipo='recuperacao'). Usado pelo webhook /io pra decidir Bia vs. atendimento humano.
export async function ehLeadRecuperacao(rawPhone: string): Promise<boolean> {
  if (!recuperacaoHabilitada()) return false;
  const phone = fmtPhone(rawPhone);
  const { data } = await supabase.from('whatsapp_sessions')
    .select('id').eq('phone', phone).eq('tipo', 'recuperacao').limit(1).maybeSingle();
  return Boolean(data);
}

const OPT_OUT = /\b(parar de mandar|para de mandar|chega de mensagem|n[ãa]o (me )?manda mais|n[ãa]o quero mais|me descadastr|descadastrar|sair da lista|cancela(r)? (meu )?cadastro|stop)\b/i;

interface BiaLeadData {
  email?: string; produto?: string | null; status?: 'pix_gerado' | 'abandonou' | null;
  valor_centavos?: number | null; link?: string | null; pix_code?: string | null; human_takeover?: boolean;
}
interface BiaSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome: string | null;
  lead_data: BiaLeadData;
}

// ─── system prompt da Bia ───────────────────────────────────────────
function buildBiaSystemPrompt(ctx: {
  nome?: string | null; produto?: string | null; status?: 'pix_gerado' | 'abandonou' | null;
  valorCentavos?: number | null; link?: string | null; pixCode?: string | null;
}): string {
  const nome = ctx.nome ? ctx.nome.trim().split(/\s+/)[0] : null;
  const produto = ctx.produto || 'Limpa Solar Pro';
  const valor = ctx.valorCentavos
    ? `R$ ${(ctx.valorCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
  const link = ctx.link || process.env.RECUP_CHECKOUT_URL || null;

  return `Você é a "Bia", atendente do Limpa Solar Pro pelo WhatsApp. A pessoa entrou
no checkout e não finalizou — você ajuda a concluir, tira dúvida, remove travas.
Atendente humana, simpática, tranquila. NUNCA robótica, NUNCA insistente.

━━ CONTEXTO DESTE CLIENTE ━━
${nome ? `- Nome: ${nome}` : '- Nome: desconhecido (não invente)'}
- Produto: ${produto}
${valor ? `- Valor: ${valor}` : '- Valor: NÃO informado — você NÃO sabe o preço'}
- Situação: ${ctx.status === 'pix_gerado' ? 'gerou o Pix e não pagou' : ctx.status === 'abandonou' ? 'abandonou o checkout' : 'entrou no checkout'}
${link ? `- LINK OFICIAL pra finalizar: ${link}` : '- LINK: indisponível agora (NÃO invente nenhum link)'}
${ctx.pixCode ? '- PIX copia-e-cola disponível (use exatamente como está)' : ''}

━━ O QUE VOCÊ FAZ ━━
- Responde dúvida de forma simples e direta.
- Reenvia o LINK OFICIAL acima quando a pessoa quer pagar/pede o link. Use SOMENTE
  o link/pix do CONTEXTO. Sem ele, diga que vai pedir o link atualizado pro time —
  NÃO escreva nenhuma URL de cabeça.
- Contorna objeção comum (segurança, "vou pensar", "é confiável?") com calma, sem pressão.

━━ REGRA DURA — NUNCA ━━
- NUNCA invente preço. Sem valor no contexto e perguntarem: diga que confirma com o time.
- NUNCA prometa desconto, cupom, brinde, parcelamento especial ou reembolso (depende de
  humano). Se pedirem, diga que vai verificar e PARE (sem prometer prazo curto).
- NUNCA invente link, código pix ou política da empresa.
- NÃO insista. "Não quero agora"/"vou pensar" → acolha ("sem problema, fico à disposição") e ENCERRE.

━━ COMO ESCREVER ━━
- WhatsApp: curto, humano, no máximo 2 bolhas separadas por ||. 1-2 frases por bolha.
  No máximo 1 emoji. UMA resposta por mensagem do cliente. Nome só se souber.
- Se já comprou ("já paguei"/"comprei"): agradeça, diga que confere — NÃO mande link, NÃO cobre.

━━ ESCALAÇÃO ━━
Assunto que exige humano (desconto, reembolso, problema no pagamento, reclamação séria):
responda UMA vez acolhendo que vai passar pro time, e termine com a tag literal [ESCALAR]
(o sistema remove a tag antes de enviar e aciona um humano).`;
}

// ─── sessão ─────────────────────────────────────────────────────────
async function loadSession(phone: string): Promise<BiaSession> {
  const { data } = await supabase.from('whatsapp_sessions')
    .select('messages, nome, lead_data').eq('phone', phone).eq('tipo', 'recuperacao')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return {
    messages: (data?.messages as BiaSession['messages']) || [],
    nome: data?.nome ?? null,
    lead_data: (data?.lead_data as BiaLeadData) ?? {},
  };
}
async function saveSession(phone: string, msgs: BiaSession['messages'], nome: string | null, ld: BiaLeadData): Promise<void> {
  await supabase.from('whatsapp_sessions').upsert({
    phone, tipo: 'recuperacao', nome, messages: msgs.slice(-MAX_HISTORY * 2), lead_data: ld,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });
}

// ─── takeover: humano digitou do celular da recuperação → Bia cala ──
export async function marcarTakeoverBia(rawPhone: string): Promise<void> {
  const phone = fmtPhone(rawPhone);
  const s = await loadSession(phone);
  await saveSession(phone, s.messages, s.nome, { ...s.lead_data, human_takeover: true });
  logger.info('bia-inbound', `human takeover ${phone} — Bia silenciada`);
}

// ─── handler principal — chamado pelo webhook /io quando ehLeadRecuperacao()=true ──
export async function handleBiaInbound(rawPhone: string, text: string, senderName?: string | null): Promise<void> {
  if (!recuperacaoHabilitada()) return;
  const phone = fmtPhone(rawPhone);
  const clean = (text || '').trim();
  if (!clean) return;

  const session = await loadSession(phone);
  const nome = session.nome ?? senderName ?? null;

  if (session.lead_data.human_takeover === true) { // humano assumiu → registra e cala
    await saveSession(phone, [...session.messages, { role: 'user', content: clean }], nome, session.lead_data);
    return;
  }
  if (OPT_OUT.test(clean)) {
    await sendHuman(phone, ['Sem problema, parei por aqui.', 'Se precisar é só me chamar neste número.'], INSTANCE);
    await saveSession(phone, [...session.messages, { role: 'user', content: clean }], nome, { ...session.lead_data, human_takeover: true });
    logger.info('bia-inbound', `opt-out ${phone}`);
    return;
  }

  const messages = [...session.messages, { role: 'user' as const, content: clean }];
  let raw: string;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 350,
      system: buildBiaSystemPrompt({
        nome, produto: session.lead_data.produto, status: session.lead_data.status,
        valorCentavos: session.lead_data.valor_centavos, link: session.lead_data.link, pixCode: session.lead_data.pix_code,
      }),
      messages,
    });
    const block = resp.content.find(b => b.type === 'text') as { text: string } | undefined;
    raw = block?.text ?? '';
  } catch (err) { logger.error('bia-inbound', `claude falhou ${phone}`, err); return; }
  if (!raw.trim()) return;

  const escalar = /\[ESCALAR\]/i.test(raw);
  const parts = raw.replace(/\[ESCALAR\]/ig, '').trim().split('||').map(p => p.trim()).filter(Boolean).slice(0, 2);
  if (parts.length) await sendHuman(phone, parts, INSTANCE);

  await saveSession(phone, [...messages, { role: 'assistant', content: raw }], nome,
    escalar ? { ...session.lead_data, human_takeover: true } : session.lead_data);
  if (escalar) logger.info('bia-inbound', `escalado pra humano: ${phone} (${session.lead_data.email ?? 's/ email'})`);
}

// ─── INBOUND POR POLLING (via confiável da linha IO) ────────────────
// O webhook on-message-received da Z-API NÃO entrega texto na instância IO em Multi
// Device (confirmado: _route='/io'=0 eventos; ReceivedCallback não casa sdr_leads) —
// por isso o sdrIoPolling existe. A Bia escuta respostas do MESMO jeito: poll dos chats
// IO, e SÓ processa quem tem sessão de recuperação (ehLeadRecuperacao). Cliente de
// energia nunca é tocado. Texto vem do endpoint chat-messages.
//
// ⚠️ chat-messages NÃO é usado em nenhum outro lugar do projeto — comportamento em
// Multi Device é INCERTO. VALIDAR E2E num número de teste antes de RECUP_ENABLED=true.
export async function pollBiaRecuperacao(): Promise<{ processed: number; skipped: number; errors: number }> {
  if (!recuperacaoHabilitada()) return { processed: 0, skipped: 0, errors: 0 };
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) return { processed: 0, skipped: 0, errors: 0 };

  const cutoff = Date.now() - 5 * 60 * 1000;
  let chats: Array<{ phone?: string; name?: string; isGroup?: unknown; lastMessageTime?: unknown }> = [];
  try {
    const res = await fetch(`https://api.z-api.io/instances/${id}/token/${token}/chats?pageSize=30`,
      { headers: { 'Client-Token': client } });
    if (!res.ok) return { processed: 0, skipped: 0, errors: 0 };
    const data: any = await res.json();
    chats = Array.isArray(data) ? data : (data.value ?? data.chats ?? []);
  } catch (err) { logger.error('bia-poll', 'fetch chats falhou', err); return { processed: 0, skipped: 0, errors: 1 }; }

  let processed = 0, skipped = 0, errors = 0;
  for (const chat of chats) {
    if (chat.isGroup === true || chat.isGroup === 'true' || !chat.phone) { skipped++; continue; }
    const rawT = chat.lastMessageTime ?? 0;
    const lastTime = typeof rawT === 'number' ? (rawT > 1e12 ? rawT : rawT * 1000) : Number(rawT) || new Date(rawT as string).getTime();
    if (!lastTime || lastTime < cutoff) { skipped++; continue; }

    const phone = String(chat.phone).replace(/\D/g, '');
    if (!phone) { skipped++; continue; }

    // ROTEAMENTO: só processa quem a Bia abordou (tem sessão recuperação). Energia = pula.
    if (!(await ehLeadRecuperacao(phone))) { skipped++; continue; }

    // Busca a última mensagem do chat (chat-messages). Se foi do CLIENTE (fromMe=false) →
    // Bia responde. Se foi NOSSA mas NÃO da API (humano digitou) → takeover.
    try {
      const r = await fetch(`https://api.z-api.io/instances/${id}/token/${token}/chat-messages/${phone}?pageSize=1`,
        { headers: { 'Client-Token': client } });
      if (!r.ok) { skipped++; continue; }
      const msgs: any = await r.json();
      const arr = Array.isArray(msgs) ? msgs : (msgs.value ?? msgs.messages ?? []);
      const last = arr[arr.length - 1] ?? arr[0];
      if (!last) { skipped++; continue; }

      const fromMe = last.fromMe === true || last.fromMe === 'true';
      const fromApi = last.fromApi === true || last.fromApi === 'true';
      if (fromMe) {
        // Humano digitou do celular (não foi a Bia via API) → silencia a Bia.
        if (!fromApi) { await marcarTakeoverBia(phone); processed++; } else skipped++;
        continue;
      }
      const texto = last.text?.message ?? last.message ?? last.body ?? '';
      if (!texto.trim()) { skipped++; continue; }
      await handleBiaInbound(phone, texto, chat.name ?? null);
      processed++;
    } catch (err) {
      logger.error('bia-poll', `processar ${phone} falhou`, err);
      errors++;
    }
  }
  return { processed, skipped, errors };
}
