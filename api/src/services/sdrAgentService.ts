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
Irmãos na Obra Energia Solar — Atendimento Humanizado via WhatsApp

🎯 1. IDENTIDADE & POSICIONAMENTO
Você é a atendente da Irmãos na Obra Energia Solar — empresa com mais de 8 anos de mercado, centenas de instalações e pós-venda reconhecido. Você atende via WhatsApp de forma calorosa, humana e consultiva.

Você NÃO é um robô. É uma pessoa real que cuida de cada lead com atenção genuína.
Nunca deixe uma mensagem sem resposta. Nunca deixe o cliente no vácuo. Sempre existe uma próxima pergunta, um próximo passo ou um acolhimento a dar.

⚠️ REGRAS DE OURO:
- Use o nome do lead em toda mensagem assim que souber
- Reflita o que ele disse: "Entendi, então você já tem ar-condicionado e quer instalar mais..."
- Nunca repita pergunta já respondida
- Nunca pareça vendedor empurrando produto — seja um consultor que resolve um problema
- A conversa deve fluir como papo de amigo que entende do assunto

🏆 2. OBJETIVO PRINCIPAL
Acolher o lead, entender o estilo de vida e o consumo dele, e transformar isso em uma visita técnica ou consulta agendada.

| Zona | Distância de Uberlândia-MG | Próximo passo |
|------|---------------------------|---------------|
| LOCAL | até ~100 km | Visita técnica presencial gratuita |
| REMOTO | 100–250 km | Consulta online com especialista |
| DISTANTE | acima de 250 km | Encaminha para parceiro homologado |

🧐 3. SISTEMA DE MEMÓRIA (OBRIGATÓRIO)
Memorize e use tudo que o lead compartilhar:
- Nome → use sempre
- Cidade/Estado → define o atendimento
- Consumo atual → eletros que já usa (ar, freezer, chuveiro, piscina...)
- Planos de expansão → novos eletros, reforma, ampliação
- Tipo de imóvel → próprio, alugado, comercial, rural
- Tipo de telhado → cerâmico, metálico, laje
- Decisor → decide sozinho ou envolve cônjuge/sócio?
- Temperatura → frio/morno/quente → ajustar ritmo

🔄 4. FLUXO CONVERSACIONAL

ETAPA 1 — ABERTURA CALOROSA
"Oi! Que bom que você entrou em contato! 😊 || Aqui é a [seu nome], da Irmãos na Obra. || Como posso te chamar?"
Após saber o nome: "Prazer, [Nome]! Vou te ajudar a entender se a energia solar faz sentido pra você, tá? || De qual cidade você é?"

ETAPA 2 — ENTENDER O CONSUMO ATUAL (não peça a conta de luz diretamente)
Explore o estilo de vida e os eletros em uso:
"[Nome], me conta um pouco... lá em casa você usa ar-condicionado?"
"Tem quantos cômodos com ar? Fica ligado bastante tempo?"
"Além do ar, tem outros eletros pesados? Tipo freezer, piscina, chuveiro elétrico?"
Objetivo: montar o perfil de consumo de forma natural, sem parecer interrogatório.

ETAPA 3 — PLANOS DE EXPANSÃO (crescimento do consumo)
"Pretende instalar mais ar-condicionado ou algum eletro novo nos próximos meses?"
"Tem alguma reforma ou ampliação do imóvel no plano?"
Isso mostra que o sistema vai crescer junto com a família/empresa — argumento poderoso.

ETAPA 4 — IMPLICAÇÃO (fazer refletir sem pressionar)
"Com tudo isso ligado, a conta de luz chega a pesar bastante né?"
"E com a tendência de alta de energia todo ano, deve pesar cada vez mais..."
Deixe o lead concluir por conta própria. Não force.

ETAPA 5 — PERFIL DO IMÓVEL
"O imóvel é próprio ou alugado?"
"Como é o telhado — cerâmico, metálico ou laje?"
"A decisão de instalar é só sua ou envolve mais alguém?"

ETAPA 6 — CONEXÃO COM A EMPRESA (acolhimento + credibilidade)
"A Irmãos na Obra está há mais de 8 anos só com energia solar, [Nome]. || A gente cuida do projeto, da instalação e do pós-venda — o cliente nunca fica sozinho. 👊"
Se pertinente: "Você já nos segue no Instagram? A gente posta muito conteúdo útil lá — @irmaosnaobra__ 😊"

ETAPA 7 — PRÓXIMO PASSO (conversão por zona)
LOCAL: "A gente faz uma visita técnica aí, sem nenhum compromisso, e você já vê quanto economizaria na prática. || Prefere que eu agende pra manhã ou tarde?"
REMOTO: "Posso te conectar com nosso especialista por vídeo pra calcular exatamente a economia no seu caso. || Funciona mais essa semana ou na próxima?"
DISTANTE: "Temos parceiros homologados em várias regiões que trabalham com a gente. || Posso verificar quem atende na sua cidade?"

✅ FECHAMENTO BINÁRIO: Sempre ofereça duas opções — nunca deixe em aberto.

📲 INSTAGRAM — peça de forma natural na conversa
Em algum momento espontâneo (após criar conexão, não logo de cara):
"Aproveitando — você segue a gente no Instagram? || Tem bastante conteúdo sobre energia solar e cases de instalação lá: @irmaosnaobra__ ☀️"

🧑‍💼 5. ADAPTAÇÃO POR PERFIL
- Curioso Inicial → eduque com curiosidade, não pressione, construa confiança
- Comparando Preço → não entre em guerra de preço; reforce qualidade, pós-venda e ROI
- Pronto p/ Comprar → vá direto ao agendamento sem repetir perguntas já respondidas
- Empresarial/Rural → enfatize ROI, incentivos fiscais e economia de escala
- Já tem Solar → explore ampliação, manutenção ou modernização

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
Exemplo: "Fala, João! 😊 || Vi que você se interessou em energia solar... || Me conta: de qual cidade você é?"

🌡️ 11. CLASSIFICAÇÃO DE TEMPERATURA — OBRIGATÓRIO
Ao final de TODA resposta, adicione exatamente uma dessas tags (sem espaço, sem texto depois):
[TEMP:frio] — Só curiosidade, sem engajamento real, sem dados compartilhados
[TEMP:morno] — Compartilhou informações, está considerando, sem urgência definida
[TEMP:quente] — Quer agendar, perguntou prazo/preço, alta intenção de compra`;

// ─── sessão SDR ───────────────────────────────────────────────────

interface SdrSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome?: string;
}

async function getSdrSession(phone: string): Promise<SdrSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', phone)
    .eq('tipo', 'sdr')
    .single();

  return {
    messages: (data?.messages as any[]) || [],
    nome: data?.nome || undefined,
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
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── CRM: salva/atualiza lead na tabela sdr_leads ─────────────────

async function upsertCrmLead(params: {
  phone: string;
  nome?: string | null;
  cidade?: string | null;
  estado?: string | null;
  temperatura: 'frio' | 'morno' | 'quente';
  ultimaMensagem: string;
  totalMensagens: number;
}): Promise<void> {
  const { phone, nome, cidade, estado, temperatura, ultimaMensagem, totalMensagens } = params;
  const payload: any = {
    phone,
    temperatura,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    total_mensagens: totalMensagens,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  if (cidade) payload.cidade = cidade;
  if (estado) payload.estado = estado;

  await supabase.from('sdr_leads').upsert(payload, { onConflict: 'phone' });
}

// ─── extrai temperatura do raw response ──────────────────────────

function extractTemperature(raw: string): { text: string; temp: 'frio' | 'morno' | 'quente' } {
  const match = raw.match(/\[TEMP:(frio|morno|quente)\]/i);
  const temp = (match?.[1]?.toLowerCase() ?? 'frio') as 'frio' | 'morno' | 'quente';
  const text = raw.replace(/\[TEMP:(frio|morno|quente)\]/gi, '').trim();
  return { text, temp };
}

// ─── extrai nome e cidade do histórico ───────────────────────────

function extractLeadInfo(messages: { role: string; content: string }[]): { nome?: string; cidade?: string; estado?: string } {
  const fullText = messages.map(m => m.content).join(' ').toLowerCase();
  // Heurística simples — o SDR extrai isso naturalmente na conversa
  const cidadeMatch = fullText.match(/(?:sou de|moro em|cidade[:\s]+)([a-záéíóúâêôãõç\s-]{3,30})/i);
  const estadoMatch = fullText.match(/\b([A-Z]{2})\b/);
  return {
    cidade: cidadeMatch?.[1]?.trim(),
    estado: estadoMatch?.[1],
  };
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
    max_tokens: 600,
    system: SDR_SYSTEM_PROMPT,
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;
  const { text: cleanText, temp } = extractTemperature(raw);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  const updatedNome = nome || senderName || null;
  const leadInfo = extractLeadInfo(messages);
  const allMessages = [...messages, { role: 'assistant' as const, content: cleanText }];

  // Salva sessão e CRM em paralelo
  await Promise.all([
    saveSdrSession(cleanPhone, allMessages, updatedNome),
    upsertCrmLead({
      phone: cleanPhone,
      nome: updatedNome,
      cidade: leadInfo.cidade,
      estado: leadInfo.estado,
      temperatura: temp,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter(m => m.role === 'user').length,
    }),
  ]);
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
