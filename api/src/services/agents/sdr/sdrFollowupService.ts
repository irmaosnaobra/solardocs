import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendZAPI as sendWA, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cadência de 10 dias em 6 toques. Após o 6º (D+10), marca como perdido.
// Tom progressivo: lembrete suave → urgência → última chance.
//
//  T1: ~2h depois         (resgate quente)
//  T2: ~24h depois        (D+1, gentil)
//  T3: ~48h depois        (D+2, valor)
//  T4: ~96h depois        (D+4, prova social)
//  T5: ~168h depois       (D+7, oportunidade)
//  T6: ~240h depois       (D+10, última chance / encerra)
const MAX_CONTATOS = 6;
const INTERVALOS_MIN = [120, 1440, 2880, 5760, 10080, 14400];

const TONS_FOLLOWUP: { t: number; tom: string; objetivo: string }[] = [
  {
    t: 1,
    tom: 'Resgate quente — leve, curto, sem pressão. Como se você tivesse esquecido de algo.',
    objetivo: 'Reabrir conversa lembrando da etapa exata onde parou. Pergunta direta sobre o ponto que faltou.',
  },
  {
    t: 2,
    tom: 'Gentil, com pitada de empatia (sei que a vida corre).',
    objetivo: 'Mostrar valor concreto. Estimar economia simples baseada no consumo, se já souber.',
  },
  {
    t: 3,
    tom: 'Carismático, focado na dor que ele já mencionou (se mencionou).',
    objetivo: 'Reforçar o benefício e oferecer simplificar — "te mando uma simulação rápida pra ver se faz sentido".',
  },
  {
    t: 4,
    tom: 'Prova social leve — sem inventar nomes, mas mencionando que outros clientes da região fecharam recentemente.',
    objetivo: 'Despertar urgência social moderada e abrir caminho pra agendamento.',
  },
  {
    t: 5,
    tom: 'Oportunidade — mencionar que a fila de instalação tá cheia, próximas vagas são em X semanas.',
    objetivo: 'Senso de escassez sem pressão agressiva. Convida pra reservar agora.',
  },
  {
    t: 6,
    tom: 'Despedida respeitosa. Sem culpar. Diz que vai encerrar o cadastro mas deixa porta aberta.',
    objetivo: 'Última mensagem. Honestidade que respeita o tempo dele. Marca como perdido depois.',
  },
];

interface SdrLead {
  phone: string;
  nome?: string;
  cidade?: string;
  estagio?: string;
  contatos?: number;
  ultimo_contato?: string;
  updated_at?: string;
  aguardando_resposta?: boolean;
  instance?: ZapiInstance;
  human_takeover?: boolean;
}

async function gerarFollowupContextual(lead: SdrLead, tentativa: number): Promise<string> {
  const tomConfig = TONS_FOLLOWUP.find(t => t.t === tentativa) ?? TONS_FOLLOWUP[0];

  // Pega o histórico real da conversa pra contextualizar
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', lead.phone)
    .eq('tipo', 'sdr')
    .single();

  const nome = session?.nome || lead.nome || 'amigo';
  const messages = (session?.messages as any[]) || [];
  const historico = messages.slice(-12).map((m: any) =>
    `${m.role === 'user' ? 'Lead' : 'Luma'}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`
  ).join('\n');

  const systemPrompt = `Você é a Luma, SDR da Irmãos na Obra. Vai mandar UMA mensagem de follow-up curta pra um lead que parou de responder. Tem que ser HUMANO — não use templates óbvios. Lembre do que ele já te disse.

CONTEXTO:
- Nome do lead: ${nome}
- Cidade: ${lead.cidade || 'não informada'}
- Tentativa nº ${tentativa} de 6 (em janela de 10 dias)
- Tom: ${tomConfig.tom}
- Objetivo: ${tomConfig.objetivo}

REGRAS:
- 1-2 frases curtas. WhatsApp.
- 0-1 emoji NO MÁXIMO.
- Se ele já te deu o nome, USE.
- Se ele já mencionou consumo/dor/cidade no histórico, REFERENCIE de forma natural (não copie frase dele).
- Não pergunte coisa que ele já respondeu.
- Não comece com "Oi [Nome]" se já é a 3ª+ tentativa — varia ("E aí ${nome}", "${nome}, voltei aqui", "Aqui de novo a Luma").
- NUNCA seja insistente ou robótico.
- NÃO use markdown nem listas. Texto puro.
- Saída: APENAS o texto da mensagem, sem aspas, sem prefixo, sem [ESTAGIO].

HISTÓRICO RECENTE DA CONVERSA:
${historico || '(sem histórico — lead novo que só recebeu boas-vindas)'}`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Gere a mensagem de follow-up tentativa ${tentativa}.` }],
    });
    const txt = (res.content[0] as { text: string }).text.trim();
    return txt.replace(/^["']|["']$/g, '');
  } catch (err) {
    logger.error('sdr-followup', 'falha gerando follow-up via IA, usando fallback', err);
    // Fallback estático caso IA falhe
    const fallback: Record<number, string> = {
      1: `${nome}, vi que paramos no meio. Ainda tem interesse em zerar a conta?`,
      2: `${nome}, te separei aqui uma estimativa rápida. Posso compartilhar?`,
      3: `${nome}, sem pressão — só checando se ainda faz sentido a gente conversar.`,
      4: `${nome}, fechamos uns projetos por aí esses dias. Quer ver se cabe pra você?`,
      5: `${nome}, novembro tá com fila — se quiser garantir vaga ainda esse ano, é agora.`,
      6: `${nome}, vou encerrar seu cadastro por aqui pra não te incomodar mais. Se um dia quiser retomar, é só me chamar. Abs!`,
    };
    return fallback[tentativa] || `${nome}, ainda tem interesse em energia solar?`;
  }
}

export async function runSdrFollowups(): Promise<{ enviados: number; perdidos: number }> {
  const now = new Date();

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, contatos, ultimo_contato, updated_at, instance, human_takeover')
    .eq('aguardando_resposta', true)
    .eq('human_takeover', false)
    .not('estagio', 'in', '("perdido","fechamento","quente")')
    .lt('contatos', MAX_CONTATOS);

  if (!leads?.length) return { enviados: 0, perdidos: 0 };

  let enviados = 0;
  let perdidos = 0;

  for (const lead of leads as SdrLead[]) {
    const contatos = lead.contatos ?? 0;
    const ultimoContato = new Date((lead.ultimo_contato ?? lead.updated_at) ?? 0);
    const minutos = (now.getTime() - ultimoContato.getTime()) / 60000;
    const intervaloNecessario = INTERVALOS_MIN[contatos] ?? 14400;

    if (minutos < intervaloNecessario) continue;

    const proximasTentativas = contatos + 1;

    if (proximasTentativas > MAX_CONTATOS) {
      // Encerra como perdido após 6 tentativas (D+10)
      await supabase.from('sdr_leads').update({
        estagio: 'perdido',
        aguardando_resposta: false,
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);
      perdidos++;
      continue;
    }

    try {
      const msg = await gerarFollowupContextual(lead, proximasTentativas);
      const instance: ZapiInstance = lead.instance === 'io' ? 'io' : 'solardoc';
      await sendWA(lead.phone, msg, instance);

      // Salva a mensagem de follow-up no histórico de sessão pra Luma manter contexto
      try {
        const { data: session } = await supabase
          .from('whatsapp_sessions')
          .select('messages')
          .eq('phone', lead.phone)
          .eq('tipo', 'sdr')
          .single();
        const oldMessages = (session?.messages as any[]) || [];
        const newMessages = [...oldMessages, { role: 'assistant', content: msg }];
        await supabase.from('whatsapp_sessions').upsert({
          phone: lead.phone,
          tipo: 'sdr',
          messages: newMessages.slice(-80),
          updated_at: now.toISOString(),
        }, { onConflict: 'phone,tipo' });
      } catch (sessErr) {
        logger.error('sdr-followup', `erro salvando follow-up no historico de ${lead.phone}`, sessErr);
      }

      const isLast = proximasTentativas === MAX_CONTATOS;
      await supabase.from('sdr_leads').update({
        contatos: proximasTentativas,
        ultimo_contato: now.toISOString(),
        updated_at: now.toISOString(),
        ...(isLast ? { estagio: 'perdido', aguardando_resposta: false } : {}),
      }).eq('phone', lead.phone);

      enviados++;
      if (isLast) perdidos++;
    } catch (err) {
      logger.error('sdr-followup', `Erro ao enviar follow-up para ${lead.phone}`, err);
    }
  }

  return { enviados, perdidos };
}
