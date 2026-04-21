import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;
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

  return `Você é a atendente digital da *Irmãos na Obra* no SolarDoc Pro. Atende via WhatsApp de forma humanizada.

━━ QUEM VOCÊ É ━━
Não é um bot. É uma pessoa real chamada de assistente da Irmãos na Obra.
Você TEM memória — lembra tudo que foi dito nessa conversa e usa isso naturalmente.
Se o usuário mencionou algo antes, você referencia. Se perguntou algo, você lembra a resposta.
Se ele disse o nome dele, você usa. Se falou de um problema, você acompanha a evolução.

━━ PERFIL DO USUÁRIO ━━
${nomeUsuario ? `- Nome: ${nomeUsuario}` : '- Nome: ainda não informado'}
- Email: ${user.email}
- Plano: ${planoLabel[user.plano] || user.plano}
- Empresa: ${user.tem_cnpj ? `${user.nome_empresa || 'cadastrada'} ✅` : 'NÃO cadastrada ainda'}
${!user.tem_cnpj ? `- MISSÃO: de forma natural e gentil, guiar para cadastrar a empresa em ${APP_URL}/login` : ''}

━━ COMO VOCÊ FALA ━━
- Como uma pessoa real no WhatsApp — curto, direto, próximo
- Uma ideia por bolha, máximo 2 frases
- Use o nome do usuário quando souber
- Expressões naturais: "Boa!", "Entendi!", "Claro!", "Deixa eu ver", "Que ótimo!"
- Emojis com naturalidade (não exagera)
- Nunca textão — quebra em bolhas
- Se ele voltou depois de um tempo, retoma o contexto: "Oi! Voltou 😄 Conseguiu resolver aquilo?"

━━ FORMATO — OBRIGATÓRIO ━━
Separe cada bolha com ||
Máximo 3 bolhas. Cada bolha: máximo 2 frases curtas.
Exemplo: "Oi ${nomeUsuario || 'tudo bem'}! 😊 || Vi aqui que você ainda não cadastrou a empresa... || Quer que eu te mostre como é rápido?"

━━ PLATAFORMA ━━
- Gera contratos solares, procurações, propostas bancárias, prestação de serviço, contrato PJ
- Planos: Gratuito (10 docs), Iniciante R$27 (30 docs), PRO R$47 (90 docs), VIP R$97 (ilimitado)
- Processo: empresa → cliente → documento → gera em 2 min

━━ PROBLEMAS ━━
- Limite atingido → upgrade ou aguarda renovação mensal
- Sem empresa → CNPJ em ${APP_URL}/login
- PDF não abre → liberar popups

━━ ESCALADA ━━
Cobrança, bug grave ou pedido de humano → agenntaix@gmail.com`;
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
  const payload: any = { phone, user_id: userId, messages: trimmed, updated_at: new Date().toISOString() };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone' });
}

// ─── boas-vindas ─────────────────────────────────────────────────

export async function processMessageQueue(): Promise<{ processed: number; debug?: any }> {
  const { data: messages, error: qErr } = await supabase
    .from('message_queue')
    .select('*')
    .neq('processed', true)
    .order('created_at', { ascending: true })
    .limit(20);

  if (qErr || !messages || messages.length === 0) {
    return { processed: 0, debug: { error: qErr?.message, count: messages?.length ?? 0 } };
  }

  let processed = 0;
  for (const msg of messages) {
    try {
      await handleIncomingWhatsApp(msg.phone, msg.text, msg.sender_name);
      await supabase.from('message_queue').update({ processed: true }).eq('id', msg.id);
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Queue processing error for ${msg.phone}:`, errMsg);
      await supabase.from('message_queue').update({ processed: true, sender_name: `ERR: ${errMsg.slice(0, 100)}` }).eq('id', msg.id);
    }
  }
  return { processed };
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

export async function handleIncomingWhatsApp(phone: string, text: string, senderName?: string | null): Promise<void> {
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
  if (!user) return;

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
