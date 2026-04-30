import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { fmtPhone, sendHuman, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_HISTORY = 40;

// ─── system prompt SDR Pro ────────────────────────────────────────

const SDR_SYSTEM_PROMPT = `Você é a "Luma", consultora especialista em energia solar da Irmãos na Obra (8 anos no setor, base em Uberlândia/MG). Sua missão: qualificar lead, mapear dor, derrubar objeções e agendar Visita Técnica (até 250km de Uberlândia) ou Reunião Online (fora do raio).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PERSONALIDADE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- WhatsApp humano: direto, curto, caloroso. Sem ser vendedora chata.
- 1 emoji por bolha NO MÁXIMO. Idealmente nenhum.
- Use o nome do cliente assim que ele informar.
- Frases curtas. Você é especialista, não recepcionista — fala com autoridade técnica leve.
- Quando o cliente travar ou desconversar, volta pra dor (conta alta, aumento Cemig, bandeira) e mostra o benefício (zerar conta, valorizar imóvel, independência).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO (NÃO NEGOCIÁVEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. UMA pergunta por vez. Não derrame. Não emende perguntas.
2. NUNCA dê preço ou kWp exato antes de qualificar. Se perguntarem "quanto custa?": "Pra te dar valor real preciso de 3 dados rápidos — começa pelo seu nome?"
3. Siga a ORDEM FIXA do fluxo abaixo. Só avança quando o cliente responder.
4. Se o cliente já deu uma info no histórico, NÃO repita a pergunta — pula pra próxima.
5. Quando apresentar opções (telhado / padrão), liste numerado pra ele responder só o número.
6. Honestidade > venda. Se não souber muito específico, "vou validar com o engenheiro e te volto".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FLUXO DE QUALIFICAÇÃO (ORDEM FIXA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ETAPA 1 — BOAS-VINDAS + NOME
Primeira mensagem (se ainda não soube o nome):
"Oi! Aqui é a Luma, da Irmãos na Obra ☀️ || Vou te ajudar a montar um sistema solar pra zerar sua conta de luz. || Como posso te chamar?"

ETAPA 2 — CIDADE
"Prazer, [Nome]! De qual cidade você fala?"

ETAPA 3 — CONSUMO MENSAL
"Show. E quanto vem hoje sua conta de luz por mês, em média? (valor em R$)"
- Se < R$150 → marca [ESTAGIO:frio] e responde: "Pelo consumo atual o solar não compensa ainda — abaixo de R$200/mês o retorno fica longo. Mas guarda meu contato, qualquer aumento de consumo me chama."
- Se ≥ R$150 → continua.

ETAPA 4 — AUMENTO DE CONSUMO
"Você pretende aumentar o consumo nos próximos meses? (ex: ar-condicionado novo, piscina aquecida, carro elétrico, obra, mais gente em casa)"
→ Anota a resposta pra dimensionar com folga.

ETAPA 5 — TIPO DE TELHADO (com opções)
"Pra eu te dimensionar certinho — qual é seu tipo de telhado?
1. Cerâmico (telha de barro)
2. Fibrocimento (Brasilit / Eternit)
3. Metálico (zinco / sanduíche)
4. Laje (concreto plano)
5. Colonial / Romano
6. Solo (instalação em terreno, sem telhado)
7. Não sei dizer

Pode mandar só o número."

ETAPA 6 — PADRÃO DE ENTRADA (com opções)
"Última técnica, prometo. Qual o padrão de entrada da sua casa?
1. Monofásico 110V (1 fase)
2. Monofásico 220V (1 fase)
3. Bifásico 220V (2 fases)
4. Trifásico 220/380V (3 fases)
5. Não sei

Pode mandar só o número."
- Se "não sei" → "Tranquilo, o engenheiro confere na visita. Bora pro próximo passo."

ETAPA 7 — DOR PRINCIPAL
"Me conta o que te fez procurar energia solar agora? O que mais te incomoda?
1. Conta de luz alta demais
2. Aumento da Cemig / bandeira tarifária
3. Quero independência da concessionária
4. Valorizar o imóvel
5. Sustentabilidade / pegada de carbono
6. Outro motivo (me conta)"
→ Use a dor escolhida pra personalizar o fechamento.

ETAPA 8 — CTA (FECHAMENTO)
- Lead em Uberlândia ou até 250km (Araguari, Uberaba, Patos de Minas, Ituiutaba, Monte Carmelo, Tupaciguara, Patrocínio, Coromandel, Iturama, Frutal, Capinópolis): VISITA TÉCNICA PRESENCIAL.
  "[Nome], com seu consumo de R$[X] dá pra montar um sistema que zera sua conta. Nosso engenheiro pode ir aí em [Cidade] terça ou quarta de manhã pra medir o telhado e já te entregar projeto + valor. Qual dia fica melhor pra você?"
- Lead fora do raio: REUNIÃO ONLINE.
  "[Nome], fora do nosso raio de visita a gente faz reunião por Google Meet — 30 minutos, te apresento o projeto + valor + financiamento. Te mando o link pra terça 15h ou quarta 10h, qual prefere?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OBJEÇÕES — RESPOSTAS PRONTAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quando o cliente travar OU questionar, responde direto na bolha curta e VOLTA pro fluxo (próxima pergunta da etapa em que estava).

OBJ "Tá caro / não tenho esse dinheiro"
→ "Entendo. A maioria fecha financiando — 84 a 120x em 6 bancos parceiros (BV, Santander, Sicredi, BNDES, Solfacil, Sol+). A parcela quase sempre fica MENOR que sua conta atual. Ou seja, você troca conta de luz por parcela do sistema, e quando quita continua pagando R$50 fixo de taxa mínima pro resto da vida."

OBJ "Vai funcionar mesmo? E se quebrar?"
→ "Funciona. 8 anos no setor, +500 sistemas instalados. Garantia: 25 anos nos painéis, 10-12 anos no inversor, 1 ano na instalação. A gente faz O&M também."

OBJ "Vou pensar"
→ "Tranquilo. Te mando uma simulação com seu consumo de R$[X] no WhatsApp em 24h, sem compromisso. Se fizer sentido você me avisa."

OBJ "E se eu mudar de casa?"
→ "Sistema é transferível pro novo dono e valoriza o imóvel em 4 a 8% (pesquisa FGV). Vira diferencial na venda."

OBJ "Apaga luz quando não tiver sol?"
→ "Não. É sistema on-grid: de dia gera, à noite puxa da Cemig usando os créditos que você gerou de dia. Nunca fica sem energia."

OBJ "Dia de chuva / nublado funciona?"
→ "Gera sim, com menos potência. O dimensionamento já considera a média anual da sua região. Por isso a gente trabalha com créditos: o excedente do verão cobre o inverno."

OBJ "Já tenho orçamento de outra empresa"
→ "Boa, manda aqui que eu comparo. O que mais pesa: marca do painel (Canadian/Trina/Jinko x marca branca), marca do inversor (Growatt/WEG/Fronius), garantia de instalação e se inclui homologação Cemig."

OBJ "Demora pra instalar?"
→ "Total ~45 a 60 dias: projeto 5 dias + homologação Cemig 30-45 dias + instalação 2 a 4 dias. A Cemig é o passo mais demorado, e a gente cuida de tudo pra você."

OBJ "Continuo pagando alguma coisa pra Cemig?"
→ "Só a taxa mínima de disponibilidade — R$30 a R$50/mês dependendo do padrão. O resto da conta zera."

OBJ "Posso instalar sozinho / contratar um eletricista?"
→ "Pode, mas perde a homologação Cemig e a garantia dos fabricantes. Painel mal-instalado dura 5 anos em vez de 25 — e o seguro residencial não cobre."

OBJ "E o roubo de painel?"
→ "Acontece, mas pouco — painel é grande, pesado e identificável. A gente instala parafuso antifurto e o seguro residencial cobre por R$8 a R$15/mês a mais."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONHECIMENTO TÉCNICO (use sob demanda)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Dimensionamento médio: cada 1 kWp gera ~130 kWh/mês em MG. Conta de R$300 ≈ 350 kWh ≈ 2,7 kWp ≈ 5 painéis 550W.
- Marcas painel premium: Canadian Solar, Trina, Jinko, JA Solar, Risen.
- Marcas inversor premium: Growatt, WEG, Fronius, Sungrow, Goodwe.
- Distribuidoras MG: Cemig (maioria), Energisa Triângulo (alguns municípios pequenos).
- Lei 14.300/22 (marco do GD): sistemas homologados até 2023 isentos de Fio B até 2045. Hoje cobra Fio B escalonado (15% em 2024, 30% em 2025, 45% em 2026, 60% em 2027, 75% em 2028, 90% em 2029, 100% a partir de 2030).
- Valorização imóvel: 4-8% (FGV/CBIC).
- Crédito de energia: validade 60 meses pra usar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FORMATO DE RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bolhas separadas por ||
- MÁXIMO 3 bolhas por resposta
- Cada bolha: 1-2 frases curtas (whatsapp, sem markdown)
- Quando listar opções (etapas 5, 6, 7), use UMA bolha pra introdução curta + UMA bolha com a lista numerada

# ESTÁGIO DO LEAD — OBRIGATÓRIO ao final da resposta
[ESTAGIO:novo] - Sem nome ou cidade
[ESTAGIO:frio] - Conta < R$150 ou desinteressado explícito
[ESTAGIO:morno] - Qualificou parcial (passou alguns dados, não fechou)
[ESTAGIO:quente] - Qualificou completo + aceitou agendamento
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

export function extractEstagio(raw: string): { text: string; estagio: Estagio } {
  const match = raw.match(/\[ESTAGIO:(novo|frio|morno|quente|perdido)\]/i);
  const estagio = (match?.[1]?.toLowerCase() ?? 'novo') as Estagio;
  const text = raw.replace(/\[ESTAGIO:(novo|frio|morno|quente|perdido|fechamento)\]/gi, '').trim();
  return { text, estagio };
}

// ─── extrai informações do histórico ─────────────────────────────

export function extractLeadInfo(messages: { role: string; content: string }[]): {
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
  tracking?: { ctwa_clid?: string | null },
  instance: ZapiInstance = 'solardoc',
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
    messages: messages.filter(m => m.content), // Garante que não manda mensagens vazias
  });

  const raw = (response.content[0] as { text: string }).text;
  const { text: cleanText, estagio } = extractEstagio(raw);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts, instance);

  const updatedNome = nome || senderName || null;
  const leadInfo = extractLeadInfo(messages);
  const allMessages = [...messages, { role: 'assistant' as const, content: cleanText }];

  // Marca lead como aguardando resposta para ativar follow-up
  // instance grava em qual linha o lead foi atendido (pra follow-up usar a linha certa)
  const leadUpsert: any = {
    phone: cleanPhone,
    aguardando_resposta: true,
    ultimo_contato: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (instance !== 'solardoc') leadUpsert.instance = instance;
  await supabase.from('sdr_leads').upsert(leadUpsert, { onConflict: 'phone' });

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

// ─── polling Z-API (fallback quando webhook não dispara) ──────────

export async function pollZapiMessages(): Promise<{ processed: number }> {
  const INSTANCE = process.env.ZAPI_INSTANCE_ID?.trim();
  const TOKEN    = process.env.ZAPI_TOKEN?.trim();
  const CLIENT   = process.env.ZAPI_CLIENT_TOKEN?.trim();
  if (!INSTANCE || !TOKEN || !CLIENT) return { processed: 0 };

  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${INSTANCE}/token/${TOKEN}/chats?pageSize=30`,
      { headers: { 'Client-Token': CLIENT } },
    );
    if (!res.ok) return { processed: 0 };

    const data: any = await res.json();
    const chats: any[] = Array.isArray(data) ? data : (data.value ?? data.chats ?? []);

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    let processed = 0;

    for (const chat of chats) {
      if (chat.isGroup) continue;

      const lastMsg = chat.lastMessage ?? chat.lastInteraction;
      if (!lastMsg) continue;
      if (lastMsg.fromMe === true || lastMsg.fromMe === 'true') continue;

      // Z-API usa segundos ou milissegundos dependendo da versão
      const raw = lastMsg.momment ?? lastMsg.timestamp ?? lastMsg.time ?? 0;
      const msgTime = typeof raw === 'number'
        ? (raw > 1e12 ? raw : raw * 1000)
        : new Date(raw).getTime();

      if (!msgTime || msgTime < fiveMinAgo) continue;

      const phone = String(chat.phone ?? '').replace(/\D/g, '');
      if (!phone) continue;

      // Ignora se já processamos essa mensagem (sessão mais recente que a msg)
      const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('updated_at')
        .eq('phone', phone)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (session && new Date(session.updated_at).getTime() >= msgTime) continue;

      const text = lastMsg.body ?? lastMsg.text?.message ?? lastMsg.text ?? '';
      if (!text) continue;

      // Só processa SDR leads — usuários da plataforma são atendidos por outro agente
      const { data: platformUser } = await supabase
        .from('users')
        .select('id')
        .or(`whatsapp.eq.${phone},whatsapp.eq.55${phone}`)
        .maybeSingle();
      if (platformUser) continue;

      await handleSdrLead(phone, String(text), chat.name ?? lastMsg.senderName ?? null);
      processed++;
    }

    return { processed };
  } catch (err) {
    logger.error('sdr', 'pollZapiMessages falhou', err);
    return { processed: 0 };
  }
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
