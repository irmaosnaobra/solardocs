// Follow-ups da Carla (vendedora B2B SolarDoc) pra usuários cadastrados na
// plataforma. Diferente do sdrB2bFollowupService — aqueles são leads que
// chegaram via WhatsApp sem nunca cadastrar. Estes JÁ tem conta solardoc.app.
//
// Dois fluxos paralelos:
//
// 1) SEM CNPJ — usuário cadastrou mas não preencheu empresa. Email cron já
//    manda 9 toques em 180d (followupService). Adiciona 3 toques WhatsApp:
//      T1 D+2, T2 D+10, T3 D+30 → encerra
//
// 2) COM CNPJ INATIVO 3+ DIAS — não gerou doc nenhum nos últimos 3 dias.
//    5 toques em 60d:
//      T1 3d, T2 7d, T3 14d, T4 30d, T5 60d → encerra
//
// Regras de parada (qualquer fluxo):
// - whatsapp_replied_at NOT NULL (cliente respondeu) → para
// - whatsapp_opt_out = true → para
// - Reset count quando muda de fluxo (sem_cnpj → inativo): count zera ao
//   cadastrar empresa e fluxo "sem_cnpj" para naturalmente.

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendZAPI } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

// ─── CADÊNCIAS ──────────────────────────────────────────────────────

const MAX_SEM_CNPJ = 3;
// Minutos desde signup (T1) ou desde last_at (T2+)
const INTERVALOS_SEM_CNPJ = [
  2880,   // T1: 2d desde signup
  11520,  // T2: +8d (= D+10 cumulativo)
  28800,  // T3: +20d (= D+30 cumulativo)
];

const TONS_SEM_CNPJ: Record<number, { tom: string; objetivo: string }> = {
  1: {
    tom: 'Empresário pra empresário, leve. "Tava aqui e vi que parou no meio."',
    objetivo: 'Lembrar do CNPJ pra destravar a plataforma — sem cobrar. Mencionar que com 1 doc gerado a percepção de valor muda.',
  },
  2: {
    tom: 'Pragmática. "Sem CNPJ a plataforma fica fora do ar pra você."',
    objetivo: 'Oferecer ajuda concreta pra cadastrar. Lembrar dos 10 docs grátis vitalícios.',
  },
  3: {
    tom: 'Direta, encerra com classe. Sem cobrança.',
    objetivo: 'Última pergunta clara: ainda faz sentido ou encerro o cadastro? Empresário decide.',
  },
};

const MAX_INATIVO = 5;
// Minutos desde última atividade (T1) ou desde last_at (T2+)
const INTERVALOS_INATIVO = [
  4320,   // T1: 3d desde última atividade
  5760,   // T2: +4d (= 7d cumulativo)
  10080,  // T3: +7d (= 14d cumulativo)
  23040,  // T4: +16d (= 30d cumulativo)
  43200,  // T5: +30d (= 60d cumulativo)
];

const TONS_INATIVO: Record<number, { tom: string; objetivo: string }> = {
  1: {
    tom: 'Checagem leve, sem cobrar. "Tudo certo por aí?"',
    objetivo: 'Reabrir conversa sem pressão. Se gerou docs antes, parabeniza brevemente.',
  },
  2: {
    tom: 'Valor concreto. "Ferramenta só vira ativo quando roda com cliente real."',
    objetivo: 'Lembrar que cada doc gerado economiza 30-60min. Convidar pra rodar 1 venda esta semana.',
  },
  3: {
    tom: 'Pergunta dor — qual ferramenta tá usando hoje pros docs?',
    objetivo: 'Entender o gargalo. Se usa Word/manual, oferecer gerar 1 doc pra ele de exemplo.',
  },
  4: {
    tom: 'Prova social leve. Outros integradores estão fechando contratos pela plataforma.',
    objetivo: 'Acender pertencimento sem inventar nomes. Convidar pra próximo passo concreto.',
  },
  5: {
    tom: 'Última pergunta direta, sem rodeio. Encerra com classe se for o caso.',
    objetivo: 'Empresário decide: seguimos ou encerro? Deixa porta aberta pra retorno espontâneo.',
  },
};

// ─── PROMPT BUILDER ─────────────────────────────────────────────────

function carlaSystem(args: {
  fluxo: 'sem_cnpj' | 'inativo';
  tentativa: number;
  maxTentativas: number;
  nome: string;
  empresa?: string | null;
  diasDesdeSignup?: number;
  diasInativo?: number;
  totalDocs?: number;
  tomCfg: { tom: string; objetivo: string };
}): string {
  const linhas = [
    `Você é a Carla, empresária-vendedora da SolarDoc Pro. Esteve 6 anos no campo instalando painel antes de virar consultora — fala empresário pra empresário, peer-to-peer.`,
    ``,
    `CONTEXTO:`,
    `- Nome: ${args.nome}`,
  ];
  if (args.empresa) linhas.push(`- Empresa: ${args.empresa}`);
  if (args.diasDesdeSignup != null) linhas.push(`- Dias desde cadastro: ${args.diasDesdeSignup}`);
  if (args.diasInativo != null) linhas.push(`- Dias inativo (sem gerar doc): ${args.diasInativo}`);
  if (args.totalDocs != null) linhas.push(`- Documentos já gerados: ${args.totalDocs}`);
  linhas.push(`- Tentativa nº ${args.tentativa} de ${args.maxTentativas}`);
  linhas.push(`- Tom desta mensagem: ${args.tomCfg.tom}`);
  linhas.push(`- Objetivo: ${args.tomCfg.objetivo}`);
  linhas.push(``);
  linhas.push(`SITUAÇÃO ATUAL DO USUÁRIO:`);
  if (args.fluxo === 'sem_cnpj') {
    linhas.push(`- Cadastrou na solardoc.app mas NÃO preencheu o CNPJ da empresa ainda. Sem CNPJ a plataforma não gera documento.`);
  } else {
    linhas.push(`- Tem empresa cadastrada na solardoc.app mas está há ${args.diasInativo}+ dias sem gerar nenhum documento novo.`);
  }
  linhas.push(``);
  linhas.push(`REGRAS DE HUMANIZAÇÃO (CRÍTICAS):`);
  linhas.push(`- Tom B2B: empresário pra empresário. SEM "tudo bem?", SEM "como posso te ajudar", SEM linguagem jovem de SDR.`);
  linhas.push(`- Direta, frases curtas, peso de quem viveu o setor (resgate experiência se couber: "quando eu tava no campo").`);
  linhas.push(`- 1-2 frases. Máximo 2 bolhas separadas por ||.`);
  linhas.push(`- 0-1 emoji NO MÁXIMO. Idealmente nenhum.`);
  linhas.push(`- VARIE o início. NUNCA "Oi [Nome]" duas vezes seguidas. Use ("E aí ${args.nome}", "${args.nome}, voltei aqui", "${args.nome}, posso te roubar 30s?", "Tava lembrando da nossa conversa").`);
  linhas.push(`- NÃO use frases de manual ("estou à disposição", "qualquer dúvida", "não perca essa oportunidade").`);
  linhas.push(`- Termine de um jeito que gere resposta natural — uma pergunta curta direta.`);
  linhas.push(`- NÃO use markdown.`);
  linhas.push(`- Se o lead já tem empresa cadastrada, NÃO peça pra cadastrar de novo.`);
  linhas.push(`- Se ele já gerou ${args.totalDocs ?? 0} docs antes, reconhece sem bajular.`);
  linhas.push(`- Pode mencionar o link ${APP_URL} no máximo UMA vez na cadência inteira (use só quando fizer sentido).`);
  linhas.push(`- Saída: APENAS o texto da mensagem (com || pra separar bolhas se for o caso). Sem aspas, sem prefixo.`);
  return linhas.join('\n');
}

async function gerarMsgCarla(args: Parameters<typeof carlaSystem>[0]): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: carlaSystem(args),
      messages: [{ role: 'user', content: `Gere a mensagem de follow-up tentativa ${args.tentativa}.` }],
    });
    const txt = (res.content[0] as { text: string }).text.trim();
    return txt.replace(/^["']|["']$/g, '');
  } catch (err) {
    logger.error('carla-platform', 'falha gerando msg via IA, usando fallback', err);
    const fb: Record<string, Record<number, string>> = {
      sem_cnpj: {
        1: `${args.nome}, vi que você cadastrou mas o CNPJ não entrou ainda. || Sem ele a plataforma fica em pausa — me chama aqui se travou em algo.`,
        2: `${args.nome}, voltei aqui. Tem 10 docs grátis te esperando — só precisa do CNPJ pra destravar. ${APP_URL}`,
        3: `${args.nome}, posso te perguntar direto? Ainda faz sentido seguir ou prefere que eu encerre por aqui?`,
      },
      inativo: {
        1: `${args.nome}, tudo certo por aí? Faz uns dias que não te vejo na plataforma.`,
        2: `${args.nome}, ferramenta só vira ativo quando roda com cliente real. Tem alguma venda dessa semana pra rodar?`,
        3: `${args.nome}, qual ferramenta você tá usando pros docs hoje? Tô curiosa.`,
        4: `${args.nome}, integrador parecido com você fechou 3 contratos esta semana pela plataforma. Vale rodar 1 venda?`,
        5: `${args.nome}, vou encerrar pra não te incomodar. Quando quiser retomar, ${APP_URL} tá aí. Abs.`,
      },
    };
    return fb[args.fluxo][args.tentativa] || `${args.nome}, ainda faz sentido a gente conversar?`;
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────

function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return 'amigo';
  return nome.trim().split(' ')[0] || 'amigo';
}

function intervaloAtingido(
  count: number,
  lastAt: Date | null,
  ancoraInicial: Date,
  intervalos: number[],
  now: Date,
): boolean {
  const ancora = count === 0 ? ancoraInicial : (lastAt ?? ancoraInicial);
  const minutos = (now.getTime() - ancora.getTime()) / 60000;
  const necessario = intervalos[count] ?? Number.MAX_SAFE_INTEGER;
  return minutos >= necessario;
}

// ─── FLUXO 1: SEM CNPJ ──────────────────────────────────────────────

export async function runCarlaSemCnpjFollowup(): Promise<{ enviados: number; encerrados: number; debug?: any }> {
  const now = new Date();

  // 1. Pega user_ids que JÁ tem CNPJ pra excluir
  const { data: companies } = await supabase.from('company').select('user_id');
  const comCnpj = new Set((companies ?? []).map((c: any) => c.user_id).filter(Boolean));

  const { data: candidatos } = await supabase
    .from('users')
    .select('id, nome, whatsapp, created_at, carla_sem_cnpj_count, carla_sem_cnpj_last_at, whatsapp_opt_out, whatsapp_replied_at')
    .not('whatsapp', 'is', null)
    .eq('whatsapp_opt_out', false)
    .is('whatsapp_replied_at', null)
    .lt('carla_sem_cnpj_count', MAX_SEM_CNPJ);

  if (!candidatos?.length) return { enviados: 0, encerrados: 0 };

  let enviados = 0;
  let encerrados = 0;

  for (const u of candidatos as any[]) {
    if (comCnpj.has(u.id)) continue;        // Tem CNPJ — sai do fluxo sem_cnpj
    if (!u.whatsapp) continue;

    const count = u.carla_sem_cnpj_count ?? 0;
    const lastAt = u.carla_sem_cnpj_last_at ? new Date(u.carla_sem_cnpj_last_at) : null;
    const signup = new Date(u.created_at);

    if (!intervaloAtingido(count, lastAt, signup, INTERVALOS_SEM_CNPJ, now)) continue;

    const proxima = count + 1;
    const isLast = proxima === MAX_SEM_CNPJ;
    const nome = primeiroNome(u.nome);
    const diasDesdeSignup = Math.floor((now.getTime() - signup.getTime()) / (24 * 3600 * 1000));

    try {
      const msg = await gerarMsgCarla({
        fluxo: 'sem_cnpj',
        tentativa: proxima,
        maxTentativas: MAX_SEM_CNPJ,
        nome,
        diasDesdeSignup,
        tomCfg: TONS_SEM_CNPJ[proxima],
      });
      await sendZAPI(u.whatsapp, msg, 'solardoc');

      await supabase.from('users').update({
        carla_sem_cnpj_count: proxima,
        carla_sem_cnpj_last_at: now.toISOString(),
      }).eq('id', u.id);

      enviados++;
      if (isLast) encerrados++;
    } catch (err) {
      logger.error('carla-sem-cnpj', `falha pra user ${u.id}`, err);
    }
  }

  return { enviados, encerrados };
}

// ─── FLUXO 2: COM CNPJ INATIVO 3+ DIAS ──────────────────────────────

export async function runCarlaInativoFollowup(): Promise<{ enviados: number; encerrados: number; debug?: any }> {
  const now = new Date();

  const { data: companies } = await supabase.from('company').select('user_id');
  if (!companies?.length) return { enviados: 0, encerrados: 0 };

  const userIds = (companies as any[]).map(c => c.user_id).filter(Boolean);

  const { data: candidatos } = await supabase
    .from('users')
    .select('id, nome, whatsapp, plano, created_at, carla_inativo_count, carla_inativo_last_at, whatsapp_opt_out, whatsapp_replied_at')
    .in('id', userIds)
    .not('whatsapp', 'is', null)
    .eq('whatsapp_opt_out', false)
    .is('whatsapp_replied_at', null)
    .lt('carla_inativo_count', MAX_INATIVO);

  if (!candidatos?.length) return { enviados: 0, encerrados: 0 };

  // Pega último documento por user (uma query só)
  const { data: docs } = await supabase
    .from('documents')
    .select('user_id, created_at')
    .in('user_id', candidatos.map((c: any) => c.id))
    .order('created_at', { ascending: false });

  const ultimoDoc: Record<string, Date> = {};
  const totalDocs: Record<string, number> = {};
  for (const d of (docs ?? []) as any[]) {
    if (!ultimoDoc[d.user_id]) ultimoDoc[d.user_id] = new Date(d.created_at);
    totalDocs[d.user_id] = (totalDocs[d.user_id] ?? 0) + 1;
  }

  let enviados = 0;
  let encerrados = 0;

  for (const u of candidatos as any[]) {
    if (!u.whatsapp) continue;

    const count = u.carla_inativo_count ?? 0;
    const lastAt = u.carla_inativo_last_at ? new Date(u.carla_inativo_last_at) : null;
    // Sem doc gerado ainda → usa signup como referência (fallback antes de qualquer atividade)
    const ultAtividade = ultimoDoc[u.id] ?? new Date(u.created_at);

    if (!intervaloAtingido(count, lastAt, ultAtividade, INTERVALOS_INATIVO, now)) continue;

    const proxima = count + 1;
    const isLast = proxima === MAX_INATIVO;
    const nome = primeiroNome(u.nome);
    const diasInativo = Math.floor((now.getTime() - ultAtividade.getTime()) / (24 * 3600 * 1000));

    try {
      const msg = await gerarMsgCarla({
        fluxo: 'inativo',
        tentativa: proxima,
        maxTentativas: MAX_INATIVO,
        nome,
        diasInativo,
        totalDocs: totalDocs[u.id] ?? 0,
        tomCfg: TONS_INATIVO[proxima],
      });
      await sendZAPI(u.whatsapp, msg, 'solardoc');

      await supabase.from('users').update({
        carla_inativo_count: proxima,
        carla_inativo_last_at: now.toISOString(),
      }).eq('id', u.id);

      enviados++;
      if (isLast) encerrados++;
    } catch (err) {
      logger.error('carla-inativo', `falha pra user ${u.id}`, err);
    }
  }

  return { enviados, encerrados };
}
