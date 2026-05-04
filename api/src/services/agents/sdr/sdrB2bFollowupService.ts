import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendZAPI as sendWA } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { detectarRecusaNaUltimaMsg } from './detectarRecusa';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cadência B2B SolarDoc — Carla. Ciclo de venda mais longo que B2C: integrador
// avalia ferramenta, conversa com sócio, testa em 1 cliente. Cadência aberta:
// 6 toques em 30 dias.
//
// Linha do tempo cumulativa (a partir do último toque da Carla):
//  T1: 4h    — link/lembrete leve
//  T2: 1d    — checagem peer-to-peer
//  T3: 3d    — valor concreto (tempo economizado)
//  T4: 7d    — caso real / prova
//  T5: 14d   — pergunta direta
//  T6: 30d   — despedida respeitosa, encerra
const MAX_CONTATOS = 6;
const INTERVALOS_MIN = [
  240,    // T1: 4h
  1200,   // T2: +20h (= 1d cumulativo)
  2880,   // T3: +48h (= 3d cumulativo)
  5760,   // T4: +96h (= 7d cumulativo)
  10080,  // T5: +168h (= 14d cumulativo)
  23040,  // T6: +384h (= 30d cumulativo)
];

const TONS_FOLLOWUP: { t: number; tom: string; objetivo: string }[] = [
  {
    t: 1,
    tom: 'Empresário pra empresário — direto, peer-to-peer. Sem floreio. "Tava aqui e lembrei de você."',
    objetivo: 'Reabrir referenciando onde a conversa parou. Se você tinha mandado link pro plano free, lembra dele sem repetir tudo.',
  },
  {
    t: 2,
    tom: 'Calorosa mas sem perder o peso de quem viveu o setor. Sem "tudo bem?".',
    objetivo: 'Mostrar valor concreto baseado no que ele já te contou (volume de vendas, gargalo, etc). Algo tipo "ainda tá fechando contrato no Word? Aquilo come tempo da semana."',
  },
  {
    t: 3,
    tom: 'Direta, traz dor + tempo. Carla viveu isso — pode resgatar ("quando eu tava no campo a gente perdia X horas com isso").',
    objetivo: 'Reforçar tempo economizado por venda fechada. Convidar pra testar com 1 cliente real (free, sem cartão).',
  },
  {
    t: 4,
    tom: 'Prova social leve, B2B. Menciona genericamente que outros integradores estão usando e vendo resultado. NUNCA invente nomes/cidades específicas.',
    objetivo: 'Trazer pertencimento ("integrador como você"). Convida pra dar próximo passo concreto (logar e gerar 1 doc).',
  },
  {
    t: 5,
    tom: 'Direta, sem rodeio. Pergunta clara: faz sentido ou prefere encerrar? Empresário valoriza honestidade.',
    objetivo: 'Dar poder de decisão. Sem soar desespero. Se ele responder "depois", deixa porta aberta.',
  },
  {
    t: 6,
    tom: 'Despedida respeitosa, sem culpar. Encerra cadastro mas deixa link salvo pra ele voltar sozinho.',
    objetivo: 'Última mensagem. Honestidade que respeita o tempo dele. "Vou encerrar por aqui pra não te incomodar — link tá salvo aí pra quando fizer sentido. Abs!" Marca como perdido.',
  },
];

interface B2bLead {
  phone: string;
  nome?: string;
  contatos?: number;
  ultimo_contato?: string;
  updated_at?: string;
  human_takeover?: boolean;
  ultima_mensagem?: string;
}

async function gerarFollowupCarla(lead: B2bLead, tentativa: number): Promise<string> {
  const tomConfig = TONS_FOLLOWUP.find(t => t.t === tentativa) ?? TONS_FOLLOWUP[0];

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', lead.phone)
    .eq('tipo', 'sdr_b2b')
    .single();

  const nome = session?.nome || lead.nome || 'amigo';
  const messages = (session?.messages as any[]) || [];
  const historico = messages.slice(-12).map((m: any) =>
    `${m.role === 'user' ? 'Lead' : 'Carla'}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`
  ).join('\n');

  const systemPrompt = `Você é a Carla, empresária-vendedora da SolarDoc Pro. Esteve no campo instalando painel por 6 anos antes de virar consultora — fala empresário pra empresário, peer-to-peer. Vai mandar UMA mensagem de follow-up curta pra um integrador solar que parou de responder.

CONTEXTO DO LEAD:
- Nome: ${nome}
- Tentativa nº ${tentativa} de ${MAX_CONTATOS} (cadência de 30 dias)
- Tom desta mensagem: ${tomConfig.tom}
- Objetivo desta mensagem: ${tomConfig.objetivo}

REGRAS DE HUMANIZAÇÃO (CRÍTICAS):
- Antes de escrever, LEIA o histórico inteiro. Identifique:
   • Em que ponto a conversa parou (qualificação? objeção? link enviado?)
   • Qual o gargalo dele (volume de vendas, tempo, equipe, ferramenta atual)
   • Se já mandou o link solardoc.app/auth — não repete o link toda hora
- Tom B2B: empresário pra empresário. SEM "tudo bem?", SEM "como posso te ajudar", SEM linguagem jovem de SDR.
- Direta, frases curtas, peso de quem viveu o setor.
- 1-2 frases. Máximo 2 bolhas separadas por ||.
- 0-1 emoji NO MÁXIMO. Idealmente nenhum.
- VARIE o início. NUNCA "Oi [Nome]" duas vezes seguidas. Use ("E aí ${nome}", "${nome}, voltei aqui", "${nome}, posso te roubar 30s?", "Tava lembrando da nossa conversa").
- NÃO repita pergunta que ele já respondeu.
- NÃO use frases de manual ("estou à disposição", "qualquer dúvida", "não perca essa oportunidade").
- Termine de um jeito que gere resposta natural — uma pergunta curta direta.
- NUNCA insistente. Se ele não respondeu, talvez não seja o momento — respeita.
- NÃO use markdown. Texto puro.
- Saída: APENAS o texto da mensagem (com || pra separar bolhas se for o caso). Sem aspas, sem prefixo.

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
    logger.error('sdr-b2b-followup', 'falha gerando follow-up via IA, usando fallback', err);
    const fallback: Record<number, string> = {
      1: `${nome}, te mandei o link mas não rolou de logar ainda? || solardoc.app/auth — 10 docs grátis sem cartão.`,
      2: `${nome}, ainda fechando contrato no Word? Aquilo come tempo da semana.`,
      3: `${nome}, tô curiosa — qual ferramenta vocês usam hoje pros docs?`,
      4: `${nome}, integrador como você fechou na semana passada e me chamou pedindo o VIP. Vale testar pelo menos no free.`,
      5: `${nome}, posso te perguntar direto? Faz sentido seguir conversando ou prefere que eu encerre por aqui?`,
      6: `${nome}, vou encerrar pra não te incomodar. Link tá salvo aí pra quando fizer sentido — solardoc.app/auth. Abs!`,
    };
    return fallback[tentativa] || `${nome}, ainda faz sentido a gente conversar?`;
  }
}

export async function runSdrB2bFollowups(): Promise<{ enviados: number; perdidos: number }> {
  const now = new Date();

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, contatos, ultimo_contato, updated_at, human_takeover, ultima_mensagem')
    .eq('tipo', 'b2b')
    .eq('aguardando_resposta', true)
    .eq('human_takeover', false)
    .not('estagio', 'in', '("perdido","fechado","quente")')
    .lt('contatos', MAX_CONTATOS);

  if (!leads?.length) return { enviados: 0, perdidos: 0 };

  let enviados = 0;
  let perdidos = 0;

  for (const lead of leads as B2bLead[]) {
    const contatos = lead.contatos ?? 0;
    const ultimoContato = new Date((lead.ultimo_contato ?? lead.updated_at) ?? 0);
    const minutos = (now.getTime() - ultimoContato.getTime()) / 60000;
    const intervaloNecessario = INTERVALOS_MIN[contatos] ?? 23040;

    if (minutos < intervaloNecessario) continue;

    const proximasTentativas = contatos + 1;

    if (proximasTentativas > MAX_CONTATOS) {
      await supabase.from('sdr_leads').update({
        estagio: 'perdido',
        aguardando_resposta: false,
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);
      perdidos++;
      continue;
    }

    // Detecção de recusa: se a última msg do lead foi um "não" explícito,
    // marca perdido e NÃO envia follow-up.
    const { data: sessionCheck } = await supabase
      .from('whatsapp_sessions')
      .select('messages')
      .eq('phone', lead.phone)
      .eq('tipo', 'sdr_b2b')
      .maybeSingle();
    const histMsgs = (sessionCheck?.messages as any[]) || [];
    const recusa = detectarRecusaNaUltimaMsg(histMsgs);
    if (recusa.recusou) {
      await supabase.from('sdr_leads').update({
        estagio: 'perdido',
        aguardando_resposta: false,
        ultima_mensagem: recusa.motivo ? `[recusou: ${recusa.motivo}]` : '[recusou]',
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);
      logger.info('sdr-b2b-followup', `lead ${lead.phone} recusou (${recusa.motivo}) — perdido sem follow-up`);
      perdidos++;
      continue;
    }

    try {
      const msg = await gerarFollowupCarla(lead, proximasTentativas);
      await sendWA(lead.phone, msg, 'solardoc');

      // Salva no histórico da sessão B2B
      try {
        const { data: session } = await supabase
          .from('whatsapp_sessions')
          .select('messages')
          .eq('phone', lead.phone)
          .eq('tipo', 'sdr_b2b')
          .single();
        const oldMessages = (session?.messages as any[]) || [];
        const newMessages = [...oldMessages, { role: 'assistant', content: msg }];
        await supabase.from('whatsapp_sessions').upsert({
          phone: lead.phone,
          tipo: 'sdr_b2b',
          messages: newMessages.slice(-80),
          updated_at: now.toISOString(),
        }, { onConflict: 'phone,tipo' });
      } catch (sessErr) {
        logger.error('sdr-b2b-followup', `erro salvando follow-up no historico de ${lead.phone}`, sessErr);
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
      logger.error('sdr-b2b-followup', `Erro ao enviar follow-up para ${lead.phone}`, err);
    }
  }

  return { enviados, perdidos };
}
