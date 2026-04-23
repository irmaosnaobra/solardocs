import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { sendMetaEvent } from '../../utils/metaPixel';
import { fmtPhone, sendHuman } from '../zapiClient';
import { logger } from '../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_HISTORY = 40;

// ─── system prompt SDR Pro ────────────────────────────────────────

const SDR_SYSTEM_PROMPT = `Você é a "Luma", consultora comercial sênior da Irmãos na Obra. Sua única missão é qualificar leads de energia solar e agendar Visitas Técnicas ou Reuniões.

# PERSONALIDADE
- Linguagem de WhatsApp: Direta, curta, humana.
- Use emojis moderadamente (1 por mensagem).
- NUNCA envie textos longos. Máximo 3 linhas por mensagem.
- Use o nome do cliente assim que ele informar.

# REGRAS DE OURO (NÃO NEGOCIÁVEL)
1. Não dê preços ou detalhes técnicos profundos antes da qualificação.
2. Se o cliente perguntar "Quanto custa?", responda: "Para te dar o valor exato e garantir sua economia, preciso de 3 informações rápidas. Qual seu nome primeiro?"
3. Siga a ordem de perguntas obrigatórias: Nome -> Cidade -> Consumo (R$) -> Pretende aumentar o consumo? -> Tipo de telhado.
4. Só avance para a próxima pergunta após o cliente responder a anterior.
5. Se o cliente travar, use o SPIN Selling (foque na dor da conta alta e no benefício de zerar).

# LÓGICA DE DECISÃO (UBERLÂNDIA - 250KM)
- Se a cidade for Uberlândia ou até 250km (Araguari, Uberaba, Patos de Minas, Ituiutaba, Monte Carmelo, Tupaciguara, etc.): O objetivo final é AGENDAR VISITA TÉCNICA PRESENCIAL.
- Se for fora desse raio: O objetivo final é AGENDAR REUNIÃO ONLINE via Google Meet.

# SCRIPT DE FECHAMENTO (CTA)
- Lead Quente (Consumo > R$ 500): "Vi aqui que sua economia será enorme, [Nome]. O engenheiro pode ir aí na sua casa em [Cidade] terça ou quarta para validar seu telhado e já fechar o projeto. Qual fica melhor?"

# MEMÓRIA DO LEAD
Sempre tente extrair e confirmar:
- Nome
- Cidade
- Consumo mensal (R$)
- Planos de aumentar carga (Ar-condicionado, piscina, etc)
- Tipo de telhado

# FORMATO — OBRIGATÓRIO
Separe cada bolha com ||
Máximo 3 bolhas. Cada bolha: máximo 2 frases curtas.

🌡️ ESTÁGIO DO LEAD — OBRIGATÓRIO ao final da resposta:
[ESTAGIO:novo] - Sem nome ou cidade
[ESTAGIO:frio] - Desinteressado ou conta muito baixa (< R$150)
[ESTAGIO:morno] - Passou dados mas não agendou
[ESTAGIO:quente] - Agendou visita ou reunião
[ESTAGIO:perdido] - Recusou ou parou de responder`;

// ─── sessão SDR ───────────────────────────────────────────────────

interface SdrSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome?: string;
  ctwa_clid?: string | null;
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

type Estagio = 'novo' | 'frio' | 'morno' | 'quente' | 'perdido' | 'fechamento';

async function upsertCrmLead(params: {
  phone: string;
  nome?: string | null;
  cidade?: string | null;
  estado?: string | null;
  estagio: Estagio;
  ultimaMensagem: string;
  totalMensagens: number;
  tracking?: { ctwa_clid?: string | null };
}): Promise<void> {
  const { phone, nome, cidade, estado, estagio, ultimaMensagem, totalMensagens, tracking } = params;
  const payload: any = {
    phone,
    estagio,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    total_mensagens: totalMensagens,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  if (cidade) payload.cidade = cidade;
  if (estado) payload.estado = estado;
  if (tracking?.ctwa_clid) payload.ctwa_clid = tracking.ctwa_clid;

  // Não sobrescreve fechamento/perdido/quente com estágio inferior
  const { data: existing } = await supabase.from('sdr_leads').select('estagio, ctwa_clid').eq('phone', phone).single();
  const protegidos = ['fechamento', 'perdido', 'quente'];
  if (existing?.estagio && protegidos.includes(existing.estagio)) {
    payload.estagio = existing.estagio;
  }

  // Se for NOVO lead, dispara evento CAPI
  if (!existing && tracking?.ctwa_clid) {
    await sendMetaEvent('Lead', {
      customData: { ctwa_clid: tracking.ctwa_clid, phone: phone },
    }).catch(console.error);
  }

  // Lead respondeu → para de aguardar e zera follow-up
  payload.aguardando_resposta = false;
  payload.ultimo_contato = new Date().toISOString();
  payload.contatos = 0; // Zera contatos de follow-up ao responder

  await supabase.from('sdr_leads').upsert(payload, { onConflict: 'phone' });
}

// ─── extrai estágio do raw response ──────────────────────────────

function extractEstagio(raw: string): { text: string; estagio: Estagio } {
  const match = raw.match(/\[ESTAGIO:(novo|frio|morno|quente|perdido)\]/i);
  const estagio = (match?.[1]?.toLowerCase() ?? 'novo') as Estagio;
  const text = raw.replace(/\[ESTAGIO:(novo|frio|morno|quente|perdido|fechamento)\]/gi, '').trim();
  return { text, estagio };
}

// ─── extrai informações do histórico ─────────────────────────────

function extractLeadInfo(messages: { role: string; content: string }[]): {
  nome?: string;
  cidade?: string;
  consumo?: string;
  telhado?: string;
  aumento_carga?: boolean;
} {
  const fullText = messages.map(m => m.content).join(' ').toLowerCase();

  const cidadeMatch = fullText.match(/(?:sou de|moro em|cidade[:\s]+)([a-záéíóúâêôãõç\s-]{3,30})/i);
  const consumoMatch = fullText.match(/(?:consumo|gasto|conta|pago|valor)[:\s]+(?:r\$)?\s?(\d{2,5})/i);
  const telhadoMatch = fullText.match(/(?:telhado|telha)[:\s]+(cerâmico|metálico|laje|telha)/i);
  const aumentoMatch = fullText.includes('aumentar') || fullText.includes('mais ar') || fullText.includes('piscina');

  return {
    cidade: cidadeMatch?.[1]?.trim(),
    consumo: consumoMatch?.[1]?.trim(),
    telhado: telhadoMatch?.[1]?.trim(),
    aumento_carga: aumentoMatch || undefined,
  };
}

// ─── handler principal SDR ────────────────────────────────────────

export async function handleSdrLead(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null }
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSdrSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20240620',
    max_tokens: 600,
    system: SDR_SYSTEM_PROMPT,
    messages: messages.filter(m => m.content), // Garante que não manda mensagens vazias
  });

  const raw = (response.content[0] as { text: string }).text;
  const { text: cleanText, estagio } = extractEstagio(raw);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  const updatedNome = nome || senderName || null;
  const leadInfo = extractLeadInfo(messages);
  const allMessages = [...messages, { role: 'assistant' as const, content: cleanText }];

  // Marca lead como aguardando resposta para ativar follow-up
  await supabase.from('sdr_leads').upsert({
    phone: cleanPhone,
    aguardando_resposta: true,
    ultimo_contato: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone' });

  // Salva sessão e CRM em paralelo
  await Promise.all([
    saveSdrSession(cleanPhone, allMessages, updatedNome),
    upsertCrmLead({
      phone: cleanPhone,
      nome: updatedNome,
      cidade: leadInfo.cidade,
      estagio,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter(m => m.role === 'user').length,
      tracking
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
