import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL || 'https://solardoc.pro';

const MAX_HISTORY = 10; // últimas 10 trocas

function buildSystemPrompt(user: { email: string; plano: string; nome_empresa?: string; tem_cnpj: boolean }): string {
  const planoLabel: Record<string, string> = { free: 'Gratuito', pro: 'PRO', ilimitado: 'VIP' };
  const contexto = `
━━ CONTEXTO DO USUÁRIO ━━
• Email: ${user.email}
• Plano atual: ${planoLabel[user.plano] || user.plano}
• Empresa cadastrada: ${user.tem_cnpj ? `Sim (${user.nome_empresa || 'cadastrada'})` : 'NÃO — ainda não informou o CNPJ'}
${!user.tem_cnpj ? `• AÇÃO PRIORITÁRIA: incentive gentilmente a cadastrar a empresa em ${APP_URL}/login para começar a usar a plataforma` : ''}`;

  return `Você é a Sol, agente especialista do SolarDoc Pro — plataforma de documentação para integradores de energia solar.
Você atende via WhatsApp e conhece cada detalhe do sistema.
${contexto}

━━ SUA MISSÃO ━━
• Dar boas-vindas e fazer o usuário se sentir bem atendido
• Tirar dúvidas sobre a plataforma com precisão
• Ajudar a resolver problemas técnicos
• Incentivar o uso e upgrades de plano quando fizer sentido
• Fazer follow-up suave para quem não ativou a conta ainda

━━ PLANOS ━━
• Gratuito → 10 docs/mês (teste)
• Iniciante R$27/mês → 30 docs/mês
• PRO R$47/mês → 90 docs/mês, histórico 30 dias
• VIP R$97/mês → documentos ilimitados, histórico permanente, suporte prioritário

━━ DOCUMENTOS DISPONÍVEIS ━━
1. Contrato Solar — instalação fotovoltaica completo
2. Proposta Bancária — financiamento junto a bancos
3. Procuração — autoriza representação na concessionária
4. Prestação de Serviço — entre integradora e terceiros
5. Contrato PJ Vendas — para parceiros comerciais

━━ COMO GERAR UM DOCUMENTO ━━
1. Cadastre sua empresa (CNPJ, endereço) — só na primeira vez
2. Cadastre o cliente (nome, CPF, endereço)
3. Menu lateral → escolha o documento
4. Preencha os campos e clique em Gerar
5. Baixe o PDF ou salve no histórico

━━ PROBLEMAS COMUNS ━━
• "Limite atingido" → precisa fazer upgrade ou aguardar renovação mensal
• "Cadastre sua empresa primeiro" → vá em Empresa no menu e preencha o CNPJ
• Não recebeu acesso após pagamento → use o email da compra; persistindo → suporte
• PDF não abre → libere popups no navegador

━━ ESCALADA ━━
Se for problema de cobrança, bug grave ou o usuário pedir atendimento humano, passe para: agenntaix@gmail.com ou ${APP_URL}

━━ REGRAS ━━
• Respostas curtas — WhatsApp não é manual
• Tom leve e profissional, como colega que entende do assunto
• Use emojis com moderação
• Nunca invente funcionalidade
• Nunca envie links externos além do ${APP_URL}`;
}

async function sendWhatsApp(phone: string, message: string): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) return;
  await fetch(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify({ phone, message }),
    }
  );
}

async function getHistory(phone: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages')
    .eq('phone', phone)
    .single();
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

export async function sendWelcomeWhatsApp(phone: string, email: string): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');

  const welcome = `☀️ *Bem-vindo ao SolarDoc Pro!*

Sou a Sol, sua assistente especialista aqui na plataforma. Fui criada por integradores solares com 8 anos de mercado para resolver o problema que todo integrador conhece: burocracia consumindo tempo de venda.

Com o SolarDoc Pro você gera em menos de 2 minutos:
📄 Contrato de Instalação Solar
🏦 Proposta para Financiamento Bancário
📋 Procuração para Concessionária
💼 Contrato PJ e Prestação de Serviço

*Seu teste é 100% gratuito — 10 documentos sem cartão de crédito.*

Para começar, acesse a plataforma e cadastre os dados da sua empresa (CNPJ):
👉 https://solardocs-dashboard.vercel.app/login

Qualquer dúvida, é só me chamar aqui! 😊`;

  await sendWhatsApp(cleanPhone, welcome);

  // Salva a mensagem de boas-vindas no histórico
  await saveHistory(cleanPhone, null, [
    { role: 'assistant', content: welcome },
  ]);
}

export async function handleIncomingWhatsApp(phone: string, text: string): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');

  // Busca usuário pelo WhatsApp
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plano')
    .eq('whatsapp', cleanPhone)
    .single();

  if (!user) return; // ignora quem não está cadastrado

  // Busca empresa do usuário
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
  const isFirstMessage = history.length === 0;

  const messages = [
    ...history,
    { role: 'user' as const, content: text.trim() },
  ];

  const systemPrompt = buildSystemPrompt(userCtx);

  // Saudação automática na primeira mensagem
  let prependGreeting = '';
  if (isFirstMessage) {
    prependGreeting = `Olá! Eu sou a Sol, sua assistente no SolarDoc Pro. `;
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt,
    messages,
  });

  const reply = prependGreeting + (response.content[0] as { text: string }).text;

  await sendWhatsApp(cleanPhone, reply);
  await saveHistory(cleanPhone, user.id, [
    ...messages,
    { role: 'assistant', content: reply },
  ]);
}
