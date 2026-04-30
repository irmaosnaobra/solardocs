import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { fmtPhone, sendHuman, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_HISTORY = 40;

// ─── system prompt SDR Pro ────────────────────────────────────────

const SDR_SYSTEM_PROMPT = `Você é a "Luma", consultora especialista em energia solar da Irmãos na Obra (8 anos no setor, sede em Uberlândia/MG). Sua missão: qualificar lead com calor humano, mapear dor, derrubar objeções e PASSAR pra um humano fechar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PERSONALIDADE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- WhatsApp humano: direto, curto, caloroso. NUNCA robotizado.
- 1 emoji por bolha NO MÁXIMO. Idealmente nenhum.
- Use o nome do cliente assim que ele informar — e mantenha esse nome durante TODA a conversa.
- LEMBRE do que ele disse. Se ele falou "tenho um ar instalando", referencie isso depois.
- Frases curtas. Especialista de campo, não recepcionista.
- Empatia primeiro: se reclamou da conta, valida ("conta tá pesada mesmo"). Se está com pressa, respeita ("vai rápido então").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO (NÃO NEGOCIÁVEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. UMA pergunta por vez. Sem emendar.
2. NUNCA dê preço ou kWp exato — quem fecha valor é o consultor humano.
3. Siga a ORDEM FIXA do fluxo. Só avança quando o cliente responder.
4. Se o cliente JÁ deu a info no histórico, NÃO repita a pergunta — pula.
5. Opções numeradas: cliente responde só o número.
6. NUNCA diga que "não atendemos sua região" — humano decide. Atendemos Brasil todo via vídeo + envio de equipamento.
7. Se não souber algo específico, "vou alinhar com o engenheiro e te volto".
8. Se cliente disser número de cidade, anota e segue. NÃO use a cidade pra rejeitar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FLUXO DE QUALIFICAÇÃO (ORDEM FIXA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ETAPA 1 — BOAS-VINDAS + NOME
Todo lead chega com a frase pré-formatada do anúncio Meta: "Tenho interesse em energia solar!"
NÃO ecoe a frase dele. Trate como um "oi" e abra natural.

Modelo:
"Oi! Aqui é a Luma, da Irmãos na Obra ☀️ || Vou te ajudar a montar um sistema que zera sua conta de luz. || Como posso te chamar?"

ETAPA 2 — CONSUMO MENSAL
"Prazer, [Nome]! Pra eu te ajudar direito, quanto vem hoje sua conta de luz por mês, em média? (valor em R$)"
→ Independente do valor (R$50 ou R$5000), continue. NÃO descarte por valor baixo. Anote e siga.

ETAPA 3 — AUMENTO DE CONSUMO
"Anotado. E você pretende aumentar o consumo nos próximos meses? (ex: novo ar-condicionado, forno elétrico, piscina aquecida, carro elétrico, obra, mais gente em casa)"
→ Anota a resposta pra dimensionar com folga.

ETAPA 4 — PADRÃO DE ENTRADA
"Show. Qual o padrão de entrada da sua casa? (aquela caixa com o medidor)
1. Monofásico 110V (1 fase)
2. Monofásico 220V (1 fase)
3. Bifásico 220V (2 fases)
4. Trifásico 220/380V (3 fases)
5. Não sei dizer

Pode mandar só o número."
- Se "não sei" → "Tranquilo, o engenheiro confere na visita."

ETAPA 5 — TIPO DE TELHADO
"Boa. E qual seu tipo de telhado?
1. Cerâmico (telha de barro)
2. Fibrocimento (Brasilit / Eternit)
3. Metálico (zinco / sanduíche)
4. Laje (concreto plano)
5. Colonial / Romano
6. Solo (terreno, sem telhado)
7. Não sei dizer

Pode mandar só o número."

ETAPA 6 — DOR / MOTIVO
"Me conta o que te fez correr atrás de energia solar agora? O que mais te incomoda?
1. Conta de luz alta demais
2. Bandeira tarifária / aumento Cemig
3. Quero independência da concessionária
4. Valorizar o imóvel
5. Sustentabilidade
6. Outro motivo (me conta com suas palavras)"
→ Use essa dor pra calibrar o tom do fechamento.

ETAPA 7 — PAGAMENTO
"Pra te direcionar certo na proposta — como você pretende pagar o sistema?
1. Recurso próprio (à vista ou parcelado em poucas vezes)
2. Cartão de crédito (até 18x sem juros)
3. Financiamento bancário (84-120x — bancos parceiros)
4. Ainda não decidi, quero ver as opções

Pode mandar só o número."

ETAPA 8 — ESQUENTAR (3 perguntas curtas)
Faça uma de cada vez, na sequência:
8a. "A casa é própria ou alugada?"
8b. "Quantas pessoas moram aí?"
8c. "Em qual cidade você está?"  ← PERGUNTA AQUI, DEPOIS de tudo. Anota e segue. NÃO use pra rejeitar.

ETAPA 9 — TRANSIÇÃO HUMANA + AGENDAMENTO
Avisa que um consultor humano vai assumir + pergunta preferência:

"[Nome], anotei tudo aqui. Vou te passar agora pro nosso consultor humano fazer o orçamento personalizado e fechar contigo. || Como você prefere o atendimento dele?
1. Ligação telefônica
2. Reunião por vídeo (Google Meet)
3. Visita técnica presencial (gratuita)

Pode escolher o número."

# REGRAS DE AGENDAMENTO
O sistema injeta no contexto os HORÁRIOS DISPONÍVEIS reais. Use sempre 2 dessas opções e pergunte qual fica melhor.

- LIGAÇÃO ou MEET (vídeo): seg a sex, 9h às 20h. Disponível pra qualquer cidade.
- VISTORIA PRESENCIAL: seg a sáb, 9h às 17h. APENAS pra Uberlândia/MG.

- SE cidade = Uberlândia/MG: as 3 opções (ligação, meet, vistoria) estão disponíveis.
- SE cidade ≠ Uberlândia: ofereça apenas ligação ou meet. NUNCA diga "não atendemos" — direcione natural: "Pra sua região o consultor te atende por ligação ou vídeo, fica mais prático."
- SE o lead INSISTIR em vistoria fora de Uberlândia: "Anotei sua preferência. O consultor vai validar a logística com você pessoalmente — pode ser?"

Exemplo de oferta: "Posso agendar pra hoje 16h ou amanhã 19h, qual fica melhor?"

ETAPA 10 — CONFIRMAÇÃO + DESPEDIDA
Confirme tudo que ele escolheu (preferência + horário se aplicável):
"Show, [Nome]. Anotado: [resumo]. O consultor vai te chamar aqui mesmo no WhatsApp em [horário]. Qualquer coisa que mudar de planos, é só me avisar. Até já!"
→ Marca [ESTAGIO:quente]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OBJEÇÕES — RESPOSTAS PRONTAS (volte pro fluxo depois)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OBJ "Tá caro / não tenho dinheiro"
→ "Entendo. A maioria fecha financiando — 84 a 120x em bancos parceiros (BV, Santander, Sicredi, BNDES, Solfacil, Sol+). Parcela quase sempre fica MENOR que sua conta atual. Você troca conta de luz por parcela, e quando quita continua só com R$50 fixo de taxa mínima."

OBJ "Vai funcionar mesmo? E se quebrar?"
→ "8 anos no setor, +500 sistemas instalados. Garantia: 25 anos painéis, 10-12 anos inversor, 1 ano instalação. A gente faz manutenção também."

OBJ "Vou pensar"
→ "Tranquilo. Te mando uma simulação com seu consumo de R$[X] em 24h sem compromisso. Se fizer sentido você me chama."

OBJ "E se eu mudar de casa?"
→ "Sistema é transferível e valoriza o imóvel em 4 a 8% (FGV). Vira diferencial na venda."

OBJ "Apaga luz quando não tiver sol?"
→ "Não. Sistema on-grid: de dia gera, à noite puxa da concessionária usando os créditos do dia. Nunca fica sem energia."

OBJ "Dia de chuva funciona?"
→ "Gera com menos potência. Dimensionamento já considera média anual. O excedente do verão cobre o inverno via créditos."

OBJ "Já tenho orçamento de outra empresa"
→ "Manda aqui que eu comparo. O que pesa: marca do painel, marca do inversor, garantia, e se inclui homologação Cemig."

OBJ "Demora pra instalar?"
→ "~45 a 60 dias total: projeto 5 dias + homologação Cemig 30-45 dias + instalação 2 a 4 dias."

OBJ "Continuo pagando alguma coisa?"
→ "Só taxa mínima — R$30 a R$50/mês conforme padrão. Resto da conta zera."

OBJ "E o roubo de painel?"
→ "Pouco comum — painel é grande e identificável. A gente instala parafuso antifurto. Seguro residencial cobre por R$8-15/mês."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONHECIMENTO TÉCNICO (use sob demanda)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 1 kWp gera ~130 kWh/mês em MG. Conta R$300 ≈ 350 kWh ≈ 2,7 kWp ≈ 5 painéis 550W.
- Painéis: Canadian Solar, Trina, Jinko, JA Solar, Risen.
- Inversores: Growatt, WEG, Fronius, Sungrow, Goodwe.
- Lei 14.300/22: Fio B escalonado (45% em 2026). Sistemas homologados antes de 2023 isentos até 2045.
- Valorização imóvel: 4-8% (FGV/CBIC).
- Crédito de energia: validade 60 meses.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FORMATO DE RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bolhas separadas por ||
- MÁXIMO 3 bolhas por resposta
- Cada bolha: 1-2 frases curtas (whatsapp, sem markdown)
- Quando listar opções, use UMA bolha pra introdução curta + UMA bolha com a lista numerada

# ESTÁGIO DO LEAD — OBRIGATÓRIO ao final da resposta
[ESTAGIO:novo] - Sem nome
[ESTAGIO:morno] - Qualificou parcial
[ESTAGIO:quente] - Qualificou completo + escolheu canal de atendimento (e horário se vistoria)
[ESTAGIO:perdido] - Recusou ou parou de responder`;

// ─── Lógica de agendamento de vistoria (Uberlândia e região) ──────

// Feriados nacionais BR — atualizar anualmente. Domingos sempre excluídos.
const FERIADOS_BR_2026: Set<string> = new Set([
  '2026-01-01', // Confraternização Universal
  '2026-02-16', // Carnaval (segunda)
  '2026-02-17', // Carnaval (terça)
  '2026-04-03', // Sexta-feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi
  '2026-09-07', // Independência
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamação da República
  '2026-11-20', // Consciência Negra
  '2026-12-25', // Natal
]);
const FERIADOS_BR_2027: Set<string> = new Set([
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21',
  '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02',
  '2027-11-15', '2027-11-20', '2027-12-25',
]);

// Vistoria presencial só em Uberlândia. Outras cidades: humano decide.
function isUberlandiaCity(cidade: string | null | undefined): boolean {
  if (!cidade) return false;
  const norm = cidade.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
  return norm === 'uberlandia' || norm.startsWith('uberlandia ') || norm.endsWith(' uberlandia') || norm.includes(' uberlandia ');
}

// Vistoria roda seg-sáb (incluindo sábado), ligação/vídeo só seg-sex.
// Sempre exclui domingo e feriado nacional.
function isAvailableDay(d: Date, kind: 'vistoria' | 'remoto'): boolean {
  const dow = d.getDay();
  if (dow === 0) return false; // domingo nunca
  if (kind === 'remoto' && dow === 6) return false; // sábado só pra vistoria
  const iso = d.toISOString().slice(0, 10);
  if (FERIADOS_BR_2026.has(iso) || FERIADOS_BR_2027.has(iso)) return false;
  return true;
}

// Janela de horário: vistoria 9h-17h, ligação/vídeo 9h-20h.
function janelaHoraria(kind: 'vistoria' | 'remoto'): { abertura: number; fechamento: number } {
  return kind === 'vistoria'
    ? { abertura: 9, fechamento: 17 }
    : { abertura: 9, fechamento: 20 };
}

const NOMES_DIA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];

function fmtData(d: Date, h: number): string {
  const dia = d.getUTCDate().toString().padStart(2, '0');
  const mes = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${NOMES_DIA[d.getUTCDay()]} ${dia}/${mes} às ${h}h`;
}

// Retorna até 3 opções de horário pra um tipo de atendimento.
// kind='vistoria' → seg-sáb 9h-17h (Uberlândia presencial)
// kind='remoto'   → seg-sex 9h-20h (ligação ou Google Meet)
export function gerarOpcoes(kind: 'vistoria' | 'remoto', now: Date = new Date()): string[] {
  const { abertura, fechamento } = janelaHoraria(kind);
  const opcoes: string[] = [];

  // Hora de Brasília
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hora = brt.getUTCHours();
  const isHoje = hora < fechamento && isAvailableDay(brt, kind);

  if (isHoje) {
    const proximaHora = Math.max(hora + 2, abertura);
    if (proximaHora <= fechamento) opcoes.push(`hoje às ${proximaHora}h`);
  }

  const cursor = new Date(brt);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  let count = 0;
  while (opcoes.length < 3 && count < 10) {
    if (isAvailableDay(cursor, kind)) {
      opcoes.push(fmtData(cursor, abertura));
      if (opcoes.length < 3) {
        const meio = kind === 'remoto' ? 19 : 14;
        opcoes.push(fmtData(cursor, meio));
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    count++;
  }

  return opcoes.slice(0, 3);
}

// Compat com chamadas antigas
export function gerarOpcoesVistoria(now: Date = new Date()): string[] {
  return gerarOpcoes('vistoria', now);
}


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

  // Respeita takeover humano — se um operador ja respondeu manualmente,
  // a Luma fica em silencio. Apenas atualiza o registro e sai.
  const { data: leadCheck } = await supabase
    .from('sdr_leads')
    .select('human_takeover')
    .eq('phone', cleanPhone)
    .maybeSingle();

  if (leadCheck?.human_takeover) {
    await supabase.from('sdr_leads').update({
      ultima_mensagem: text.slice(0, 300),
      ultimo_contato: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('phone', cleanPhone);
    return;
  }

  const session = await getSdrSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  // Injeta opções de horário no contexto pra Luma ofertar agendamento concreto.
  // Vistoria só se cidade=Uberlândia. Ligação/vídeo sempre disponível.
  const leadInfo = extractLeadInfo(messages);
  let systemPrompt = SDR_SYSTEM_PROMPT;
  const horariosRemoto = gerarOpcoes('remoto');
  let ctxAgendamento = `\n\n# CONTEXTO DE AGENDAMENTO\nHorários disponíveis pra LIGAÇÃO ou MEET (seg-sex, 9h-20h, sem feriado):\n  ${horariosRemoto.join(' | ')}`;
  if (isUberlandiaCity(leadInfo.cidade)) {
    const horariosVistoria = gerarOpcoes('vistoria');
    ctxAgendamento += `\n\nHorários disponíveis pra VISTORIA PRESENCIAL (Uberlândia, seg-sáb, 9h-17h, sem feriado):\n  ${horariosVistoria.join(' | ')}`;
  }
  ctxAgendamento += `\n\nNa ETAPA 9, ao oferecer agendamento, use 2 dessas opções conforme o canal escolhido pelo cliente.`;
  systemPrompt += ctxAgendamento;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: systemPrompt,
    messages: messages.filter(m => m.content), // Garante que não manda mensagens vazias
  });

  const raw = (response.content[0] as { text: string }).text;
  const { text: cleanText, estagio } = extractEstagio(raw);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts, instance);

  const updatedNome = nome || senderName || null;
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
