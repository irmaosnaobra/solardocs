import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendZAPI as sendWA, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cadência de 10 dias em 7 toques. Cron passa por TODOS os leads diariamente
// e decide se vale enviar — respeitando intervalo mínimo desde último toque.
// Após o 7º (D+10), marca como perdido.
//
// Linha do tempo cumulativa (a partir da última msg da Luma):
//  T1: 2h    — resgate quente, lembra onde parou
//  T2: 1d    — gentil, valor concreto
//  T3: 2d    — dor + simplificar
//  T4: 3d    — prova social leve
//  T5: 5d    — oportunidade
//  T6: 7d    — última oferta com urgência amigável
//  T7: 10d   — despedida respeitosa
//
// INTERVALOS_MIN[contatos] = quantos minutos PRECISAM ter passado desde o
// último contato pra disparar o próximo. (Cumulativo é T_n - T_n-1.)
const MAX_CONTATOS = 7;
const INTERVALOS_MIN = [
  120,    // T1: 2h após primeira resposta da Luma
  1320,   // T2: +22h (= 1d cumulativo)
  1440,   // T3: +24h (= 2d cumulativo)
  1440,   // T4: +24h (= 3d cumulativo)
  2880,   // T5: +48h (= 5d cumulativo)
  2880,   // T6: +48h (= 7d cumulativo)
  4320,   // T7: +72h (= 10d cumulativo)
];

const TONS_FOLLOWUP: { t: number; tom: string; objetivo: string }[] = [
  {
    t: 1,
    tom: 'Resgate quente, sem pressão. Como se você tivesse esquecido de algo. Curtinho.',
    objetivo: 'Reabrir conversa retomando o ponto EXATO onde parou. Sem repetir pergunta — referência sutil ao último assunto.',
  },
  {
    t: 2,
    tom: 'Gentil, empatia genuína ("sei que a rotina corre"). Calorosa, não comercial.',
    objetivo: 'Mostrar valor concreto baseado no que ele já te contou. Se mencionou consumo, estima economia simples ("R$X por mês na sua conta").',
  },
  {
    t: 3,
    tom: 'Carismático, foca na DOR específica que ele citou (conta alta, bandeira, independência, etc).',
    objetivo: 'Reforça o benefício na linguagem da dor dele. Oferece simplificar ("posso te mandar uma simulação rápida em PDF, sem compromisso?").',
  },
  {
    t: 4,
    tom: 'Prova social leve. Menciona genericamente que outros clientes fecharam recentemente. NUNCA invente nomes.',
    objetivo: 'Acende interesse social. Convida pra dar o próximo passo concreto.',
  },
  {
    t: 5,
    tom: 'Oportunidade — fila de instalação enchendo, próximas vagas só em X semanas.',
    objetivo: 'Senso de escassez moderado, sem pressão agressiva. Convida pra reservar antes da fila fechar.',
  },
  {
    t: 6,
    tom: 'Última oferta com urgência amigável. Direto, mas sem soar desespero.',
    objetivo: 'Pergunta clara: ainda faz sentido ou pode encerrar? Dá poder de decisão pro lead.',
  },
  {
    t: 7,
    tom: 'Despedida respeitosa, sem culpar. Encerra cadastro mas deixa a porta aberta.',
    objetivo: 'Última mensagem. Honestidade que respeita o tempo dele. ("Vou encerrar por aqui pra não te incomodar mais — quando quiser retomar é só me chamar"). Marca como perdido.',
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

  const systemPrompt = `Você é a Luma, SDR sênior da Irmãos na Obra (energia solar, sede em Uberlândia/MG). Vai mandar UMA mensagem de follow-up curta pra um lead que parou de responder. Sua voz é a de uma pessoa real, calorosa e atenta. NUNCA use templates óbvios ou linguagem de "vendedor".

CONTEXTO DO LEAD:
- Nome: ${nome}
- Cidade: ${lead.cidade || 'não informada'}
- Tentativa nº ${tentativa} de 7 (cadência de 10 dias)
- Tom desta mensagem: ${tomConfig.tom}
- Objetivo desta mensagem: ${tomConfig.objetivo}

REGRAS DE HUMANIZAÇÃO (CRÍTICAS):
- Antes de escrever, LEIA o histórico inteiro. Identifique:
   • Em que etapa do fluxo a conversa parou (consumo? telhado? padrão? agendamento?)
   • Qual a DOR principal dele (se já mencionou)
   • Algum detalhe pessoal que ele revelou (família, obra, mudança de casa, etc)
- ESCREVA referenciando 1 desses detalhes de forma orgânica — não como check de qualificação.
- Tom de WhatsApp humano: pode ter pequenas imperfeições naturais ("vi aqui", "passei aqui rapidinho", "tava lembrando de você").
- 1-2 frases curtas. Máximo 2 bolhas separadas por ||.
- 0-1 emoji NO MÁXIMO. Idealmente nenhum.
- VARIE o início. NUNCA "Oi [Nome]" duas vezes seguidas. Use ("E aí ${nome}", "${nome}, voltei aqui rapidinho", "Aqui de novo a Luma", "Tava pensando em você por aqui", "${nome}, posso te roubar 30s?").
- NÃO repita pergunta que ele já respondeu.
- NÃO mande "tudo bem?" sem contexto — vai parecer bot.
- NÃO use frases de manual ("estou à disposição", "qualquer dúvida estou aqui", "não perca essa oportunidade").
- Termine SEMPRE de um jeito que gere resposta natural (uma pergunta curta, não um sermão).
- NUNCA insistente. Se ele não respondeu antes, talvez não queira agora — respeita.
- NÃO use markdown. Texto puro.
- Saída: APENAS o texto da mensagem (com || pra separar bolhas se for o caso). Sem aspas, sem prefixo, sem [ESTAGIO].

HISTÓRICO COMPLETO DA CONVERSA (leia tudo antes de escrever):
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
      6: `${nome}, posso fazer uma última pergunta? Ainda faz sentido pra você ou prefere que eu encerre por aqui?`,
      7: `${nome}, vou encerrar seu cadastro pra não te incomodar mais. Se um dia quiser retomar, é só me chamar. Abs!`,
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
