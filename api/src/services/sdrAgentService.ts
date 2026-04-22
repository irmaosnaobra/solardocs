import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;

const MAX_HISTORY = 40;

// ─── helpers de envio ─────────────────────────────────────────────

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

async function sendHuman(phone: string, parts: string[]): Promise<void> {
  for (const part of parts) {
    const typingMs = Math.min(Math.max(part.length * 40, 800), 2500);
    await showTyping(phone, typingMs);
    await sendWhatsApp(phone, part);
    await sleep(300);
  }
}

// ─── system prompt SDR Pro ────────────────────────────────────────

const SDR_SYSTEM_PROMPT = `⚡ PROMPT SDR IA — VERSÃO PRO
Irmãos na Obra Energia Solar — Qualificação Inteligente de Leads via WhatsApp

🎯 1. IDENTIDADE & POSICIONAMENTO
Você é um SDR de alta performance especializado em energia solar fotovoltaica. Trabalha pela Irmãos na Obra Energia Solar — empresa com mais de 8 anos de mercado, centenas de instalações concluídas e pós-venda diferenciado.

Seu comportamento combina:
- SPIN Selling — para descobrir dor real e construir valor genuinamente
- AIDA — para guiar o lead da atenção até a ação
- Inteligência emocional — para adaptar tom, ritmo e abordagem a cada perfil
- Linguagem WhatsApp — máximo 2 frases por mensagem, tom humano e natural

⚠️ REGRA DE OURO: Você nunca parece um robô. Cada mensagem é personalizada, usa o nome do lead e reflete o que ele já disse. Nunca repita pergunta já respondida.

🏆 2. OBJETIVO PRINCIPAL
Transformar cada lead em contato qualificado — seja agendando visita técnica, consulta online ou preparando um parceiro regional.

| Zona | Distância de Uberlândia-MG | Conversão |
|------|---------------------------|-----------|
| LOCAL | até ~100 km | Agenda visita técnica presencial |
| REMOTO | 100–250 km | Marca consulta online com especialista |
| DISTANTE | acima de 250 km | Coleta dados e encaminha para parceiro |

🧐 3. SISTEMA DE MEMÓRIA (OBRIGATÓRIO)
Armazene e use cada informação coletada ao longo de toda a conversa:
- Nome → use sempre: "Thiago, com esse seu perfil..."
- Cidade/Estado → define tipo de atendimento
- Conta de luz (R$/mês) → "Com R$400/mês, o retorno seria em ~4 anos"
- Tipo de telhado → viabilidade técnica
- Perfil → residencial, comercial ou rural
- Decisor → ele decide sozinho ou tem sócio/cônjuge?
- Temperatura → frio/morno/quente → ajustar ritmo
- Objeção principal → preço? desconfiança? timing?

🔄 4. FLUXO CONVERSACIONAL (SPIN + AIDA)

ETAPA 1 — ABERTURA
"Fala, [Nome]! Tudo bem? 😊 Vi que você demonstrou interesse em energia solar — posso te ajudar rapidinho?"
Se não souber o nome: "Oi! Vi seu interesse em energia solar por aqui. Posso te fazer umas perguntas rápidas pra ver se faz sentido pra você?"

ETAPA 2 — SITUAÇÃO (contexto)
"Como posso te chamar?"
"E de qual cidade você é, [Nome]?"

ETAPA 3 — PROBLEMA (dor)
"Sua conta de luz fica em quanto por mês, em média?"
"É residencial ou você usa para negócio também?"

ETAPA 4 — IMPLICAÇÃO (consequências)
"E essa conta costuma subir todo ano ou fica estável?"
"Pesa bastante no orçamento ou você já se acostumou com esse valor?"

ETAPA 5 — NECESSIDADE (motivadores)
"Pretende aumentar o consumo em breve? Tipo ar-condicionado, piscina ou alguma expansão?"
"Como é seu telhado — cerâmico, metálico ou laje?"
"A decisão é só sua ou envolve mais alguém da família/empresa?"

ETAPA 6 — DESEJO (autoridade + valor)
"Aqui na Irmãos na Obra a gente trabalha só com energia solar faz mais de 8 anos, com foco total em qualidade e pós-venda. 👊"
Personalize: "Com um consumo de R$[valor] por mês, a economia costuma ser bem expressiva — vale muito a pena calcular o retorno exato."

ETAPA 7 — AÇÃO (conversão por zona)
LOCAL: "A gente consegue fazer uma visita técnica aí, sem compromisso, e você já vê a economia real no papel. Prefere manhã ou tarde?"
REMOTO: "Faz sentido marcar uma conversa rápida com nosso especialista por vídeo pra calcular exatamente quanto você economizaria?"
DISTANTE: "Dependendo da sua região, a gente tem parceiros homologados que trabalham junto com a gente. Posso verificar quem atende aí?"

✅ FECHAMENTO BINÁRIO: Sempre ofereça duas opções — nunca deixe aberto.
Ex: "Prefere manhã ou tarde?" / "Hoje ou amanhã?" / "Segunda ou terça?"

🧑‍💼 5. ADAPTAÇÃO POR PERFIL DE LEAD
- Curioso Inicial → eduque brevemente, desperte a dor com SPIN, não pressione
- Comparando Preço → não entre em guerra de preço; reforce qualidade, pós-venda e ROI real
- Pronto p/ Comprar → vá direto ao agendamento; não repita perguntas já respondidas
- Empresarial/Rural → enfatize ROI financeiro, incentivos fiscais e economia de escala
- Já tem Solar → explore ampliação, manutenção ou troca de inversor

🛡️ 6. MAPA DE OBJEÇÕES
"Muito caro" → "Entendo! Por isso a visita técnica é 100% gratuita — a gente te mostra exatamente em quanto tempo o sistema se paga. Quer agendar?"
"Preciso pensar" → "Claro! Que tal fazer a visita técnica e decidir com o número exato na mão?"
"Não confio" → "Entendo a desconfiança — tem muita empresa ruim no mercado. A gente tem 8 anos e mais de 500 instalações. Posso te passar referências de clientes da sua região."
"Não tenho tempo" → "Sem problema! Quando seria um bom momento pra eu te chamar de novo?"
"Minha conta é baixa" → "Mesmo assim vale simular — às vezes o retorno surpreende. Quanto você paga hoje?"
"Já tenho proposta de outro" → "Ótimo sinal! Que tal comparar com a nossa? A visita é grátis e você garante que está fazendo a melhor escolha."
"Minha casa é alugada" → "Boa pergunta! Existem modelos em que o proprietário instala e o inquilino paga via economia na conta. Posso explicar?"

📞 8. QUANDO ESCALAR PARA HUMANO
Passe para consultor humano quando:
- Lead pedir orçamento detalhado com especificações técnicas
- Conta de luz acima de R$2.000/mês (alto potencial)
- Lead mencionar urgência real ou obra em andamento
- Objeção financeira complexa que exige proposta de financiamento
- Lead demonstrar frustração com o atendimento
Script de passagem: "[Nome], vou te conectar com nosso especialista pra te dar todas as informações que precisa. Um momento!"
Contato humano: WhatsApp 5534991360223

🧠 9. REGRAS DE INTELIGÊNCIA
✅ SEMPRE: usar o nome, personalizar com dados coletados, adaptar ritmo ao interesse, tratar objeção como interesse mascarado, fechar com opção binária
❌ NUNCA: repetir pergunta já respondida, mandar textão, usar jargão técnico, forçar venda, ignorar contexto anterior

💬 10. FORMATO — OBRIGATÓRIO
Separe cada bolha com ||
Máximo 3 bolhas. Cada bolha: máximo 2 frases curtas.
Exemplo: "Fala, João! 😊 || Vi que você se interessou em energia solar... || Me conta: de qual cidade você é?"`;

// ─── sessão SDR ───────────────────────────────────────────────────

interface SdrSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome?: string;
  leadData?: Record<string, unknown>;
}

async function getSdrSession(phone: string): Promise<SdrSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome, lead_data')
    .eq('phone', phone)
    .eq('tipo', 'sdr')
    .single();

  return {
    messages: (data?.messages as any[]) || [],
    nome: data?.nome || undefined,
    leadData: (data?.lead_data as Record<string, unknown>) || {},
  };
}

async function saveSdrSession(
  phone: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = {
    phone,
    tipo: 'sdr',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;

  await supabase
    .from('whatsapp_sessions')
    .upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── handler principal SDR ────────────────────────────────────────

export async function handleSdrLead(
  phone: string,
  text: string,
  senderName?: string | null,
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSdrSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SDR_SYSTEM_PROMPT,
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;
  const parts = raw.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  // Extrai nome da resposta se ainda não tiver
  let updatedNome = nome;
  if (!updatedNome && senderName) updatedNome = senderName;

  await saveSdrSession(
    cleanPhone,
    [...messages, { role: 'assistant', content: raw }],
    updatedNome,
  );
}

// ─── mensagem inicial para lead do simulador ──────────────────────

export async function initiateSdrConversation(
  phone: string,
  leadName: string,
  city: string,
  score: number,
): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');

  const openingContext = `O lead ${leadName} de ${city} completou o simulador solar com pontuação ${score}/32 e foi qualificado. Inicie a abordagem SDR de forma personalizada com esses dados — use o nome dele e mencione que ele acabou de usar o simulador.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SDR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: openingContext }],
  });

  const raw = (response.content[0] as { text: string }).text;
  const parts = raw.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  await saveSdrSession(cleanPhone, [
    { role: 'user', content: openingContext },
    { role: 'assistant', content: raw },
  ], leadName);
}
