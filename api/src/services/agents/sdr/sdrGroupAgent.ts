// Agente da Luma DENTRO do grupo de consultores. Diferente do SDR (que conversa
// com lead), aqui ela atende comandos do time: buscar lead, assumir takeover,
// registrar agendamento manual, descartar, etc.
//
// Trigger: mensagem no grupo IO (ZAPI_IO_GROUP_ID) que mencione "luma" no texto
// (ou na transcrição de áudio). Mídia (áudio/imagem) é processada antes via
// mediaProcessor.
//
// Modelo: Haiku 4.5 — comandos curtos, contexto pequeno, custo baixo.

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { sendToGroup, type ZapiInstance } from '../zapiClient';
import { criarCardAgendamento } from './sdrAgentService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_GROUP_HISTORY = 30;

const GROUP_SYSTEM_PROMPT = `Você é a "Luma" agora respondendo NO GRUPO INTERNO de consultores da Irmãos na Obra (Diego, Thiago, Nilce, Giovanna). NÃO é cliente do outro lado — é o TIME que comanda você.

# COMO RESPONDER NO GRUPO
- Direto e curto. Nada de emoji excessivo.
- Sem saudação ("oi gente", "tudo bem"). Vai direto pro ponto.
- 1-3 frases por mensagem. Se for confirmação, 1 frase basta ("Feito. Hugo está em takeover humano.").
- Quando precisar dos dados do lead pra agir, use a tool buscar_lead. Se achar mais de um, peça confirmação ANTES de agir.
- Quando o consultor mandar comando ambíguo, faça UMA pergunta curta de esclarecimento — não chute.

# TOOLS DISPONÍVEIS
- **buscar_lead(query)**: busca por nome ou trecho do telefone. Retorna até 5 matches.
- **assumir_takeover(lead_phone)**: marca lead como sob responsabilidade humana. Você fica em silêncio com esse lead.
- **liberar_takeover(lead_phone)**: devolve o lead pra você (volta a responder automático).
- **registrar_agendamento_grupo(lead_phone, canal, horario, horario_iso, endereco?)**: registra agendamento direto, sem precisar trocar mensagem com o lead. Útil quando consultor LIGOU e marcou por telefone.
- **descartar_lead_grupo(lead_phone, motivo)**: marca como perdido (lead some do funil ativo mas fica salvo 45 dias).
- **adicionar_nota(lead_phone, nota)**: anexa observação no lead, aparece no próximo card.

# REGRAS
- NUNCA invente dados. Se não souber, pergunta.
- Se o consultor disser "marca pro Hugo terça 14h" e você achar 3 Hugos: lista os 3 com cidade + última conta de luz, pede confirmação.
- Se ele mandar áudio/imagem, você JÁ recebeu o conteúdo no input — não diga "não consigo ouvir áudio".
- Se ele perguntar algo que NÃO é comando (ex: "Luma, quanto tá a meta do mês?"), responda direto se souber, ou diga "não tenho esse dado aqui no grupo, olha no dashboard".
- Você NÃO precisa marcar [ESTAGIO] aqui — isso é só pro fluxo do lead, não do grupo.

# IDENTIDADE DOS CONSULTORES
Diego (técnico, Uberlândia), Thiago (backoffice, Araguari), Nilce (vendas), Giovanna (pré-atendimento). Eles podem te chamar pelo nome direto ou só "Luma".`;

const GROUP_TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_lead',
    description: 'Busca leads no CRM por nome (parcial) ou trecho do telefone. Retorna até 5 matches com nome, cidade, estágio, telefone, última mensagem.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto de busca: nome (parcial OK) ou trecho do telefone (8+ dígitos).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'assumir_takeover',
    description: 'Marca um lead como sob responsabilidade humana — Luma para de responder automaticamente até liberar. Use quando consultor sinalizar que está pessoalmente conduzindo (ex: ligou, está visitando, fechando).',
    input_schema: {
      type: 'object',
      properties: {
        lead_phone: { type: 'string', description: 'Telefone do lead (só dígitos, com 55 ou sem).' },
      },
      required: ['lead_phone'],
    },
  },
  {
    name: 'liberar_takeover',
    description: 'Devolve o lead pra Luma — ela volta a responder automaticamente. Use quando consultor terminar a interação direta e quer que o follow-up siga normal.',
    input_schema: {
      type: 'object',
      properties: {
        lead_phone: { type: 'string', description: 'Telefone do lead.' },
      },
      required: ['lead_phone'],
    },
  },
  {
    name: 'registrar_agendamento_grupo',
    description: 'Registra agendamento DIRETO sem precisar trocar mensagem com o lead. Útil quando consultor já fechou data/hora por ligação ou pessoalmente. Dispara card no grupo (igual fluxo normal).',
    input_schema: {
      type: 'object',
      properties: {
        lead_phone: { type: 'string', description: 'Telefone do lead.' },
        canal: { type: 'string', enum: ['ligacao', 'meet', 'vistoria'], description: 'Canal combinado.' },
        horario: { type: 'string', description: 'Horário em texto natural (ex: "terça 14h", "amanhã 9h").' },
        horario_iso: { type: 'string', description: 'ISO 8601 BRT do horário (ex: "2026-05-05T14:00:00-03:00").' },
        endereco: { type: 'string', description: 'OBRIGATÓRIO se canal=vistoria. Endereço completo.' },
      },
      required: ['lead_phone', 'canal', 'horario', 'horario_iso'],
    },
  },
  {
    name: 'descartar_lead_grupo',
    description: 'Marca lead como perdido (não deleta — fica no CRM por 45 dias). Use quando consultor disser que lead tá morto, comprou de outro, etc.',
    input_schema: {
      type: 'object',
      properties: {
        lead_phone: { type: 'string', description: 'Telefone do lead.' },
        motivo: { type: 'string', description: 'Razão curta (será logada).' },
      },
      required: ['lead_phone', 'motivo'],
    },
  },
  {
    name: 'adicionar_nota',
    description: 'Anexa observação no lead. Aparece no próximo card de agendamento e fica registrada no histórico.',
    input_schema: {
      type: 'object',
      properties: {
        lead_phone: { type: 'string', description: 'Telefone do lead.' },
        nota: { type: 'string', description: 'Observação curta (até 200 chars).' },
      },
      required: ['lead_phone', 'nota'],
    },
  },
];

interface GroupSession {
  messages: { role: 'user' | 'assistant'; content: any; sender?: string }[];
}

async function getGroupSession(groupId: string): Promise<GroupSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages')
    .eq('phone', groupId)
    .eq('tipo', 'grupo_io')
    .maybeSingle();
  return { messages: (data?.messages as any[]) || [] };
}

async function saveGroupSession(groupId: string, messages: any[]): Promise<void> {
  const trimmed = messages.slice(-MAX_GROUP_HISTORY * 2);
  await supabase.from('whatsapp_sessions').upsert({
    phone: groupId,
    tipo: 'grupo_io',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });
}

function normPhone(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  return d.startsWith('55') ? d : (d.length >= 10 ? `55${d}` : d);
}

// ─── Implementações das tools ───────────────────────────────────────

async function execBuscarLead(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return 'Erro: query vazia.';

  const digits = q.replace(/\D/g, '');
  let matches: any[] = [];

  if (digits.length >= 8) {
    const { data } = await supabase
      .from('sdr_leads')
      .select('phone, nome, cidade, estagio, ultima_mensagem, canal_atendimento, horario_atendimento, human_takeover')
      .ilike('phone', `%${digits}%`)
      .eq('instance', 'io')
      .limit(5);
    matches = data || [];
  } else {
    const { data } = await supabase
      .from('sdr_leads')
      .select('phone, nome, cidade, estagio, ultima_mensagem, canal_atendimento, horario_atendimento, human_takeover')
      .ilike('nome', `%${q}%`)
      .eq('instance', 'io')
      .order('updated_at', { ascending: false })
      .limit(5);
    matches = data || [];
  }

  if (!matches.length) return `Nenhum lead encontrado pra "${q}".`;
  return matches.map((m: any, i: number) =>
    `${i + 1}. ${m.nome || 'Sem nome'} (${m.phone}) — ${m.cidade || 'cidade ?'} · estágio ${m.estagio}${m.canal_atendimento ? ` · ${m.canal_atendimento} ${m.horario_atendimento}` : ''}${m.human_takeover ? ' · TAKEOVER HUMANO' : ''}`
  ).join('\n');
}

async function execAssumirTakeover(leadPhone: string): Promise<string> {
  const phone = normPhone(leadPhone);
  const { data: lead } = await supabase
    .from('sdr_leads').select('nome').eq('phone', phone).maybeSingle();
  if (!lead) return `Lead ${phone} não encontrado no CRM.`;
  await supabase.from('sdr_leads').update({
    human_takeover: true,
    human_takeover_at: new Date().toISOString(),
    aguardando_resposta: false,
    updated_at: new Date().toISOString(),
  }).eq('phone', phone);
  return `OK. ${lead.nome || phone} agora em takeover humano. Não vou mais mandar mensagem automática pra ele.`;
}

async function execLiberarTakeover(leadPhone: string): Promise<string> {
  const phone = normPhone(leadPhone);
  const { data: lead } = await supabase
    .from('sdr_leads').select('nome').eq('phone', phone).maybeSingle();
  if (!lead) return `Lead ${phone} não encontrado no CRM.`;
  await supabase.from('sdr_leads').update({
    human_takeover: false,
    human_takeover_at: null,
    aguardando_resposta: true,
    updated_at: new Date().toISOString(),
  }).eq('phone', phone);
  return `Liberado. ${lead.nome || phone} volta pro fluxo automático no próximo trigger.`;
}

async function execRegistrarAgendamento(
  leadPhone: string,
  canal: string,
  horario: string,
  horarioIso: string,
  endereco: string | undefined,
): Promise<string> {
  const phone = normPhone(leadPhone);
  const { data: lead } = await supabase
    .from('sdr_leads').select('nome').eq('phone', phone).maybeSingle();
  if (!lead) return `Lead ${phone} não encontrado no CRM.`;
  if (canal === 'vistoria' && (!endereco || endereco.length < 10)) {
    return 'Vistoria precisa de endereço completo. Pede no grupo antes de tentar de novo.';
  }
  const r = await criarCardAgendamento(phone, canal, horario, undefined, 'io', horarioIso, endereco);
  if (r.ok) return `Agendamento registrado pro ${lead.nome || phone}: ${canal} ${horario}. Card no grupo.`;
  return `Falha ao registrar (${r.reason || 'erro'}). Tenta de novo ou faz manual.`;
}

async function execDescartarLead(leadPhone: string, motivo: string): Promise<string> {
  const phone = normPhone(leadPhone);
  const { data: lead } = await supabase
    .from('sdr_leads').select('nome').eq('phone', phone).maybeSingle();
  if (!lead) return `Lead ${phone} não encontrado no CRM.`;
  await supabase.from('sdr_leads').update({
    estagio: 'perdido',
    aguardando_resposta: false,
    updated_at: new Date().toISOString(),
  }).eq('phone', phone);
  logger.info('luma-grupo-descarte', `${phone} marcado perdido: ${motivo}`);
  return `${lead.nome || phone} marcado como perdido. Motivo: ${motivo.slice(0, 100)}.`;
}

async function execAdicionarNota(leadPhone: string, nota: string): Promise<string> {
  const phone = normPhone(leadPhone);
  const { data: lead } = await supabase
    .from('sdr_leads').select('nome, observacoes_internas').eq('phone', phone).maybeSingle();
  if (!lead) return `Lead ${phone} não encontrado no CRM.`;
  const existing = String((lead as any).observacoes_internas || '').trim();
  const stamp = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const novaNota = nota.slice(0, 200);
  const merged = existing ? `${existing}\n[${stamp}] ${novaNota}` : `[${stamp}] ${novaNota}`;
  await supabase.from('sdr_leads').update({
    observacoes_internas: merged,
    updated_at: new Date().toISOString(),
  }).eq('phone', phone);
  return `Nota adicionada em ${lead.nome || phone}.`;
}

// ─── Handler principal ─────────────────────────────────────────────

export async function handleGroupMessage(params: {
  groupId: string;
  senderPhone: string;
  senderName?: string | null;
  text: string;
  imageSource?: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null;
}): Promise<void> {
  const { groupId, senderName, text, imageSource } = params;

  // Trigger: precisa mencionar "luma" no texto (case-insensitive, palavra solta).
  // Imagem sem texto NÃO dispara — evita ruído de prints aleatórios no grupo.
  if (!/\bluma\b/i.test(text)) return;

  const session = await getGroupSession(groupId);
  const senderTag = senderName ? `[${senderName}] ` : '';

  const userContent: any = imageSource
    ? [
        { type: 'image', source: imageSource },
        { type: 'text', text: `${senderTag}${text.trim()}` },
      ]
    : `${senderTag}${text.trim()}`;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: userContent },
  ];

  const workingMessages: any[] = [...messages];
  let finalText = '';

  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: GROUP_SYSTEM_PROMPT,
      tools: GROUP_TOOLS,
      messages: workingMessages.filter((m: any) => m.content),
    });

    if (response.stop_reason === 'tool_use') {
      workingMessages.push({ role: 'assistant', content: response.content });
      const toolResults: any[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const input = block.input as any;
        let result = '';

        try {
          switch (block.name) {
            case 'buscar_lead':
              result = await execBuscarLead(String(input.query || ''));
              break;
            case 'assumir_takeover':
              result = await execAssumirTakeover(String(input.lead_phone || ''));
              break;
            case 'liberar_takeover':
              result = await execLiberarTakeover(String(input.lead_phone || ''));
              break;
            case 'registrar_agendamento_grupo':
              result = await execRegistrarAgendamento(
                String(input.lead_phone || ''),
                String(input.canal || ''),
                String(input.horario || ''),
                String(input.horario_iso || ''),
                input.endereco ? String(input.endereco) : undefined,
              );
              break;
            case 'descartar_lead_grupo':
              result = await execDescartarLead(String(input.lead_phone || ''), String(input.motivo || ''));
              break;
            case 'adicionar_nota':
              result = await execAdicionarNota(String(input.lead_phone || ''), String(input.nota || ''));
              break;
            default:
              result = `tool desconhecida: ${block.name}`;
          }
        } catch (err) {
          logger.error('luma-grupo-tool', `erro executando ${block.name}`, err);
          result = `Erro executando ${block.name}: ${err instanceof Error ? err.message : 'falha'}`;
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }

      workingMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b: any) => b.type === 'text') as any;
    finalText = (textBlock?.text || '').trim();
    break;
  }

  if (!finalText) finalText = 'Recebi mas não consegui processar — tenta de novo?';

  // Guarda no histórico (só texto pra economizar — imagem só vive na rodada atual)
  const userTextForHist = imageSource
    ? `${senderTag}${text.trim()} [imagem anexada]`
    : `${senderTag}${text.trim()}`;
  const newHistory = [
    ...session.messages,
    { role: 'user' as const, content: userTextForHist, sender: senderName || undefined },
    { role: 'assistant' as const, content: finalText },
  ];
  await saveGroupSession(groupId, newHistory);

  // Manda no grupo
  try {
    await sendToGroup(groupId, finalText, 'io');
  } catch (err) {
    logger.error('luma-grupo-resposta', `falha enviando resposta no grupo ${groupId}`, err);
  }
}
