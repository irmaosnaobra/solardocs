import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;
const APP_URL       = 'https://solardocs-dashboard.vercel.app';

const MAX_HISTORY = 10;

// ─── helpers de envio ────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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
  await zapiPost('send-typing', { phone, duration: durationMs }).catch(() => {});
  await sleep(durationMs);
}

async function sendWhatsApp(phone: string, message: string): Promise<void> {
  await zapiPost('send-text', { phone, message });
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
  email: string; plano: string; nome_empresa?: string; tem_cnpj: boolean;
}): string {
  const planoLabel: Record<string, string> = { free: 'Gratuito', pro: 'PRO', ilimitado: 'VIP' };

  return `Você é a atendente digital da *Irmãos na Obra* no SolarDoc Pro. Atende via WhatsApp.

PERFIL DO USUÁRIO:
- Email: ${user.email}
- Plano: ${planoLabel[user.plano] || user.plano}
- Empresa cadastrada: ${user.tem_cnpj ? `Sim — ${user.nome_empresa || 'cadastrada'}` : 'NÃO (não informou o CNPJ ainda)'}
${!user.tem_cnpj ? `- PRIORIDADE: incentivar cadastrar a empresa em ${APP_URL}/login` : ''}

COMO VOCÊ FALA:
- Igual a uma pessoa real no WhatsApp — curto, direto, natural
- Uma ideia por mensagem, no máximo 2 frases curtas
- Use expressões como "Boa!", "Claro!", "Certo!", "Deixa eu te ajudar"
- Emojis com naturalidade, sem exagero
- Nunca mande textão — se precisar explicar algo longo, quebre em mensagens
- Tom próximo, como colega de trabalho

FORMATO DE RESPOSTA — MUITO IMPORTANTE:
Separe cada bolha de mensagem com o separador ||
Exemplo: "Oi! Que bom falar com você 😊 || Você está no plano gratuito, que dá 10 documentos pra testar. || Posso te ajudar com alguma coisa?"
Máximo 3 bolhas por resposta. Cada bolha: no máximo 2 frases curtas.

PLATAFORMA:
- Gera contratos, procurações, propostas bancárias, prestação de serviço, contrato PJ
- Planos: Gratuito (10 docs), Iniciante R$27 (30 docs), PRO R$47 (90 docs), VIP R$97 (ilimitado)
- Processo: cadastra empresa → cadastra cliente → escolhe documento → gera em 2 min

PROBLEMAS COMUNS:
- Limite atingido: aguarda renovação ou faz upgrade
- Sem empresa: cadastrar CNPJ em ${APP_URL}/login
- PDF não abre: liberar popups no navegador

QUANDO ESCALAR: cobrança, bug grave ou pedido de humano → agenntaix@gmail.com`;
}

// ─── histórico ───────────────────────────────────────────────────

async function getHistory(phone: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { data } = await supabase.from('whatsapp_sessions').select('messages').eq('phone', phone).single();
  return (data?.messages as any[]) || [];
}

async function saveHistory(
  phone: string,
  userId: string | null,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  await supabase
    .from('whatsapp_sessions')
    .upsert({ phone, user_id: userId, messages: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'phone' });
}

// ─── boas-vindas ─────────────────────────────────────────────────

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
  await saveHistory(cleanPhone, null, [{ role: 'assistant', content: fullText }]);
}

// ─── resposta a mensagem recebida ────────────────────────────────

export async function handleIncomingWhatsApp(phone: string, text: string): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plano')
    .eq('whatsapp', cleanPhone)
    .single();

  if (!user) return;

  const { data: company } = await supabase
    .from('company')
    .select('nome')
    .eq('user_id', user.id)
    .single();

  const userCtx = {
    email: user.email,
    plano: user.plano,
    nome_empresa: company?.nome,
    tem_cnpj: !!company,
  };

  const history = await getHistory(cleanPhone);
  const messages = [
    ...history,
    { role: 'user' as const, content: text.trim() },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: buildSystemPrompt(userCtx),
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;

  // Divide nas bolhas definidas pelo modelo
  const parts = raw.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  await saveHistory(cleanPhone, user.id, [
    ...messages,
    { role: 'assistant', content: raw },
  ]);
}
