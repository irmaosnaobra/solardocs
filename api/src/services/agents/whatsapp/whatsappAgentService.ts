import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { handleSdrLead } from '../sdr/sdrAgentService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID?.trim();
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN?.trim();
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN?.trim();
const APP_URL       = 'https://solardocs-dashboard.vercel.app';

const MAX_HISTORY = 30; // ~30 trocas = contexto rico sem estourar tokens

// ─── helpers de envio ────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

async function zapiPost(path: string, body: unknown): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) return;
  try {
    await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify(body),
    });
  } catch { /* ignora erros de rede */ }
}

async function showTyping(phone: string, durationMs = 1500): Promise<void> {
  await zapiPost('send-typing', { phone: fmtPhone(phone), duration: durationMs }).catch(() => {});
  await sleep(durationMs);
}

async function sendWhatsApp(phone: string, message: string): Promise<void> {
  await zapiPost('send-text', { phone: fmtPhone(phone), message });
}

// Envia múltiplas bolhas com "digitando..." entre elas
async function sendHuman(phone: string, parts: string[]): Promise<void> {
  for (const part of parts) {
    const typingMs = Math.min(Math.max(part.length * 40, 800), 2500);
    await showTyping(phone, typingMs);
    await sendWhatsApp(phone, part);
    await sleep(300);
  }
}

// ─── system prompt ───────────────────────────────────────────────

function buildSystemPrompt(user: {
  email: string; plano: string; nome_empresa?: string; tem_cnpj: boolean; nome?: string;
}): string {
  const planoLabel: Record<string, string> = { free: 'Gratuito', pro: 'PRO', ilimitado: 'VIP' };
  const nomeUsuario = user.nome ? user.nome.split(' ')[0] : null;

  return `Você é a "Dani", consultora de sucesso do cliente do SolarDoc Pro. Sua missão é garantir que o integrador gaste menos de 2 minutos gerando documentos.

━━ PERFIL DO USUÁRIO ━━
${nomeUsuario ? `- Nome: ${nomeUsuario}` : '- Nome: integrador'}
- Email: ${user.email}
- Plano: ${planoLabel[user.plano] || user.plano}
- Empresa: ${user.tem_cnpj ? `${user.nome_empresa || 'cadastrada'} ✅` : 'NÃO cadastrada ainda'}

━━ DIRETRIZES ━━
- Se não tiver CNPJ, guie para ${APP_URL}/login de forma gentil.
- Uma ideia por bolha, máximo 2 frases. Use || para separar.
- Proporcione uma experiência de WhatsApp rápida e eficiente.

━━ FORMATO ━━
Máximo 3 bolhas separadas por ||.`;
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
    `☀️ Oi! Bem-vindo ao *SolarDoc Pro* — Irmãos na Obra!`,
    `Sou sua assistente aqui na plataforma. Fui criada por integradores com 8 anos no setor solar pra acabar com a burocracia que toma seu tempo de venda 😄`,
    `Com a gente você gera contratos, procurações e propostas bancárias em menos de 2 minutos. *Seu teste é grátis — 10 documentos sem cartão!*`,
    `Pra começar, é só cadastrar o CNPJ da sua empresa aqui:\n👉 ${APP_URL}/login\n\nQualquer dúvida me chama!`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, null, [{ role: 'assistant', content: fullText }]);
}

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

  // Número não cadastrado na plataforma → SDR agent (lead B2C)
  if (!user) {
    const SDR_TRIGGER = 'tenho interesse em energia solar';
    const { data: existingSession } = await supabase
      .from('whatsapp_sessions')
      .select('id')
      .eq('phone', cleanPhone)
      .eq('tipo', 'sdr')
      .single();

    const hasSession   = !!existingSession;
    const isTriggered  = text.trim().toLowerCase().includes(SDR_TRIGGER);
    const isFromAd     = !!tracking?.ctwa_clid; // lead clicou em anúncio Meta

    if (!isTriggered && !hasSession && !isFromAd) {
      // Mensagem aleatória de número desconhecido sem sessão nem anúncio → ignora
      return;
    }

    await handleSdrLead(cleanPhone, text, senderName, tracking);
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
    model: 'claude-3-haiku-20240307',
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
