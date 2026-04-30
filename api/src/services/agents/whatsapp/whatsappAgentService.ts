import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { handleSdrLead } from '../sdr/sdrAgentService';
import { fmtPhone, sendHuman } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

const MAX_HISTORY = 30;

// ─── system prompt ───────────────────────────────────────────────

function buildSystemPrompt(user: {
  email: string; plano: string; nome_empresa?: string; tem_cnpj: boolean; nome?: string;
}): string {
  const planoLabel: Record<string, string> = { free: 'Gratuito', pro: 'PRO', ilimitado: 'VIP' };
  const nomeUsuario = user.nome ? user.nome.split(' ')[0] : null;

  return `Você é a "Dani" da SolarDoc Pro. Tom de amiga prestativa, não vendedora. Tranquila. Sem pressão.

━━ PERFIL DO USUÁRIO ━━
${nomeUsuario ? `- Nome: ${nomeUsuario}` : '- Nome: integrador'}
- Plano: ${planoLabel[user.plano] || user.plano}
- Empresa: ${user.tem_cnpj ? `${user.nome_empresa || 'cadastrada'} ✅` : 'NÃO cadastrada'}

━━ COMO RESPONDER ━━
- Curto. 1-2 frases por mensagem. Sem emojis exagerados.
- Não tente vender. Não pressione. Não repita CTA várias vezes.
- Se a pessoa pediu ajuda concreta, ajude direto.
- Se for conversa solta, responde curtinho e deixa quieto.
- Só mencione ${APP_URL} se for relevante (e nunca mais que 1 vez na conversa).

━━ FORMATO ━━
Máximo 2 bolhas separadas por ||. Frases curtas.`;
}

// ─── histórico ───────────────────────────────────────────────────

async function getSession(phone: string): Promise<{ messages: { role: 'user' | 'assistant'; content: string }[]; nome?: string }> {
  const { data } = await supabase.from('whatsapp_sessions').select('messages, nome').eq('phone', phone).single();
  return { messages: (data?.messages as any[]) || [], nome: data?.nome || undefined };
}

async function saveSession(
  phone: string,
  userId: string | null,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = { phone, user_id: userId, tipo: 'platform', messages: trimmed, updated_at: new Date().toISOString() };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── boas-vindas ─────────────────────────────────────────────────

export async function processMessageQueue(): Promise<{ processed: number; debug?: any }> {
  const { data: messages, error: qErr } = await supabase
    .from('message_queue')
    .select('*')
    .neq('processed', true)
    .order('created_at', { ascending: true })
    .limit(10);

  if (qErr || !messages || messages.length === 0) {
    return { processed: 0, debug: { error: qErr?.message, count: messages?.length ?? 0 } };
  }

  let processed = 0;
  const errors: string[] = [];
  for (const msg of messages) {
    // Marca como processado ANTES — apenas o primeiro a fazer isso processa a mensagem
    const { data: claimed } = await supabase
      .from('message_queue')
      .update({ processed: true })
      .eq('id', msg.id)
      .eq('processed', false)
      .select('id');

    if (!claimed || claimed.length === 0) continue; // outro processo já pegou

    try {
      await handleIncomingWhatsApp(msg.phone, msg.text, msg.sender_name);
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(errMsg.slice(0, 100));
    }
  }
  return { processed, debug: errors.length ? errors : undefined } as any;
}

export async function sendWelcomeWhatsApp(phone: string, _email: string): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');

  const parts = [
    `Oi! Sou a Dani, da SolarDoc Pro 🌞`,
    `Tô aqui se você precisar de qualquer coisa — pra gerar documento, tirar dúvida ou se travar em algo. Sem pressa.`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, null, [{ role: 'assistant', content: fullText }]);
}

// Palavras que indicam vontade de parar de receber automação
const OPT_OUT_PATTERNS = /\b(para|parar|stop|cancela|cancelar|sair|nao quero|não quero|nao manda|não manda|me deixe|me deixa|chega de mensagem|descadastr)\b/i;

// ─── resposta a mensagem recebida ────────────────────────────────
export async function handleIncomingWhatsApp(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null }
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');

  // Normaliza número BR: Z-API às vezes omite o 9 do celular (553498364589 → 5534998364589)
  const c55 = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
  const addNine = (p: string) => p.length === 12 && p.startsWith('55') ? p.slice(0, 4) + '9' + p.slice(4) : p;
  const phoneVariants = [
    cleanPhone,
    cleanPhone.replace(/^55/, ''),
    c55,
    addNine(c55),
    addNine(c55).replace(/^55/, ''),
  ];

  let user: { id: string; email: string; plano: string } | null = null;
  for (const variant of phoneVariants) {
    const { data } = await supabase.from('users').select('id, email, plano').eq('whatsapp', variant).single();
    if (data) { user = data; break; }
  }

  // Número não cadastrado na plataforma → roteia pra SDR B2B (Carla/SolarDoc)
  // ou SDR B2C (Luma/Irmãos na Obra) com base em sinais
  if (!user) {
    const lowerText = text.trim().toLowerCase();

    // B2C signals (Irmãos na Obra)
    const B2C_TRIGGER = 'tenho interesse em energia solar';
    const isB2cTriggered = lowerText.includes(B2C_TRIGGER);

    // B2B signals (SolarDoc)
    const B2B_TRIGGERS = ['sou empresario solar', 'sou empresário solar', 'quero a solardoc', 'integrador solar', 'quero conhecer a solardoc'];
    const isB2bTriggered = B2B_TRIGGERS.some(t => lowerText.includes(t));
    const isFromAd = !!tracking?.ctwa_clid;

    // Sessões existentes
    const { data: b2cSession } = await supabase
      .from('whatsapp_sessions').select('id').eq('phone', cleanPhone).eq('tipo', 'sdr').single();
    const { data: b2bSession } = await supabase
      .from('whatsapp_sessions').select('id').eq('phone', cleanPhone).eq('tipo', 'sdr_b2b').single();

    // Roteamento: prioriza sessão existente, depois trigger, depois ad (B2B por default)
    if (b2bSession || isB2bTriggered) {
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking);
      return;
    }
    if (b2cSession || isB2cTriggered) {
      await handleSdrLead(cleanPhone, text, senderName, tracking);
      return;
    }
    if (isFromAd) {
      // Anúncio Meta (ctwa_clid) sem trigger explícito → assume B2B SolarDoc
      // (porque é o produto que está rodando ads no momento)
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking);
      return;
    }
    // Mensagem aleatória de número desconhecido → ignora
    return;
  }

  // Cliente respondeu — marca pra parar com automacao futura.
  // (whatsapp_replied_at IS NOT NULL bloqueia runWhatsappFollowup e runInactiveEngagement)
  await supabase.from('users').update({
    whatsapp_replied_at: new Date().toISOString(),
  }).eq('id', user.id);

  // Detecta pedido explicito de parar com mensagens automaticas
  if (OPT_OUT_PATTERNS.test(text)) {
    await supabase.from('users').update({ whatsapp_opt_out: true }).eq('id', user.id);
    await sendHuman(cleanPhone, [
      'Anotado, parei de mandar mensagem automatica.',
      'Se um dia precisar de algo, e so me chamar aqui.',
    ]);
    return;
  }

  const { data: company } = await supabase
    .from('company')
    .select('nome')
    .eq('user_id', user.id)
    .single();

  const session = await getSession(cleanPhone);
  // Salva nome do remetente se ainda não tiver
  const nome = session.nome || senderName || null;

  const userCtx = {
    email: user.email,
    plano: user.plano,
    nome_empresa: company?.nome,
    tem_cnpj: !!company,
    nome: nome || undefined,
  };

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 350,
    system: buildSystemPrompt(userCtx),
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;
  const parts = raw.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  await saveSession(cleanPhone, user.id, [
    ...messages,
    { role: 'assistant', content: raw },
  ], nome);
}
