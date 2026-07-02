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
import { sendZAPI, sleep } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { dentroDoTetoCarla, marcarEnvioCarla, dentroDaJanelaDeEnvio } from './carlaThrottle';
import { registrarMsgProativa } from './whatsappAgentService';

// Espaçamento mínimo entre dois envios da Carla no MESMO ciclo (anti-ráfaga).
const GAP_ENTRE_ENVIOS_MS = 4000;

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
    tom: 'Próxima e leve, como quem percebeu que a pessoa cadastrou e parou. "Tava aqui e lembrei de você."',
    objetivo: 'Reabrir a conversa entendendo a dor real dele (como monta proposta/contrato hoje). NÃO fala de plano ainda — só puxa o papo pra descobrir onde a plataforma ajudaria.',
  },
  2: {
    tom: 'Consultora que entende o negócio. Conecta a dor dele a UM ganho concreto (proposta com payback na frente do cliente, contrato com a marca dele).',
    objetivo: 'Mostrar o valor de virar assinante e conduzir pro trial: "põe o cartão, testa 7 dias sem pagar, cancela quando quiser". Preços PRO 27 / VIP 67.',
  },
  3: {
    tom: 'Direta e calorosa, encerra com classe. Sem pressão.',
    objetivo: 'Última pergunta clara: faz sentido testar 7 dias grátis pra ver funcionando, ou prefere que eu não te incomode mais? O cliente decide.',
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
    objetivo: 'Reabrir conversa sem pressão. Se gerou docs antes, reconhece brevemente. Descobre o que travou.',
  },
  2: {
    tom: 'Valor concreto. "Quem opera com a própria marca e proposta com payback fecha mais rápido."',
    objetivo: 'Conectar a dor a um ganho e conduzir pro trial pago (7 dias grátis no cartão). Convidar pra testar com 1 venda desta semana.',
  },
  3: {
    tom: 'Pergunta dor — qual ferramenta tá usando hoje pros docs/propostas?',
    objetivo: 'Entender o gargalo. Se usa Word/manual, mostra o ganho de assinar e oferece o trial pra ele sentir.',
  },
  4: {
    tom: 'Prova social leve + valor. Integradores que assinam saem na frente do concorrente.',
    objetivo: 'Acender pertencimento sem inventar nomes. Conduzir pro trial de 7 dias (PRO 27 / VIP 67).',
  },
  5: {
    tom: 'Última pergunta direta e calorosa, sem rodeio. Encerra com classe se for o caso.',
    objetivo: 'O cliente decide: testa 7 dias grátis pra ver funcionando, ou encerro? Deixa porta aberta.',
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
    `Você é a "Giovanna", consultora especialista da SolarDoc Pro. Vendedora de verdade, mas humana e consultiva — entende o negócio do integrador solar e conduz com calor, sem ser robótica. (Esta é a MESMA Giovanna que responde quando o cliente retorna — uma pessoa só, do primeiro contato ao fechamento.)`,
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
    linhas.push(`- Cadastrou na solardoc.app mas parou no começo (não configurou a empresa/CNPJ ainda).`);
  } else {
    linhas.push(`- Tem empresa cadastrada na solardoc.app mas está há ${args.diasInativo}+ dias sem gerar nenhum documento novo.`);
  }
  linhas.push(``);
  linhas.push(`SUA MISSÃO (converter em ASSINANTE — NÃO existe mais plano grátis pra oferecer):`);
  linhas.push(`- Você está reabrindo a conversa pra CONVERTER este usuário num assinante pago (PRO R$27 ou VIP R$67).`);
  linhas.push(`- A entrada é o TRIAL: escolhe o plano, põe o cartão, 7 dias grátis, só cobra no 8º dia, cancela quando quiser.`);
  linhas.push(`- NUNCA ofereça "plano grátis", "10 docs grátis" ou "sem cartão" — isso ACABOU. Se citar valor, é PRO 27 / VIP 67 com 7 dias grátis.`);
  linhas.push(`- Venda a transformação (parecer/operar mais profissional, fechar mais rápido), não a ferramenta. Uma tacada certeira por mensagem.`);
  linhas.push(``);
  linhas.push(`REGRAS DE HUMANIZAÇÃO (CRÍTICAS):`);
  linhas.push(`- Tom: consultora calorosa e segura, que entende o negócio do integrador. Próxima, sem ser robótica nem manual de SDR.`);
  linhas.push(`- Direta, frases curtas, com peso de quem conhece o setor solar.`);
  linhas.push(`- 1-2 frases. Máximo 2 bolhas separadas por ||.`);
  linhas.push(`- 0-1 emoji (com parcimônia, natural — não exagere).`);
  linhas.push(`- VARIE o início. NUNCA "Oi [Nome]" duas vezes seguidas. Use ("E aí ${args.nome}", "${args.nome}, voltei aqui", "${args.nome}, posso te roubar 30s?", "Tava lembrando da nossa conversa").`);
  linhas.push(`- NÃO use frases de manual ("estou à disposição", "qualquer dúvida", "não perca essa oportunidade").`);
  linhas.push(`- Termine de um jeito que gere resposta natural — uma pergunta curta direta.`);
  linhas.push(`- NÃO use markdown.`);
  linhas.push(`- Se ele já gerou ${args.totalDocs ?? 0} docs antes, reconhece sem bajular.`);
  linhas.push(`- O link ${APP_URL} leva ao checkout do plano (7 dias grátis no cartão). Mande no máximo UMA vez na cadência, quando ele mostrar interesse.`);
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
        1: `${args.nome}, vi que você cadastrou e parou no começo. || Como tu monta proposta e contrato pro cliente hoje?`,
        2: `${args.nome}, voltei aqui. A plataforma gera proposta com payback e contrato com a tua marca em 2min. || Testa 7 dias grátis, só põe o cartão e cancela quando quiser: ${APP_URL}`,
        3: `${args.nome}, posso te perguntar direto? Faz sentido testar 7 dias grátis pra ver funcionando, ou prefere que eu encerre por aqui?`,
      },
      inativo: {
        1: `${args.nome}, tudo certo por aí? Faz uns dias que não te vejo na plataforma.`,
        2: `${args.nome}, quem roda a proposta com a própria marca e payback fecha mais rápido. Tem alguma venda essa semana pra testar?`,
        3: `${args.nome}, qual ferramenta você tá usando pros docs hoje? Tô curiosa.`,
        4: `${args.nome}, integrador que assina sai na frente do concorrente. || Testa 7 dias grátis (só cobra no 8º dia): ${APP_URL}`,
        5: `${args.nome}, vou encerrar pra não te incomodar. Quando quiser testar, ${APP_URL} tá aí. Abs.`,
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

  // Janela de envio (hoje 30/jun: só 18:30–20:00 BRT). Fora dela, não dispara.
  if (!dentroDaJanelaDeEnvio(now)) return { enviados: 0, encerrados: 0, debug: 'fora_da_janela' };

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

    // Teto anti-ban COMPARTILHADO (sem_cnpj + inativo) na linha solardoc. Estourou
    // → para de varrer (break, não continue): o resto fica pro próximo ciclo horário.
    if (!(await dentroDoTetoCarla())) {
      logger.info('carla-sem-cnpj', 'teto anti-ban atingido, segurando pro próximo ciclo');
      break;
    }

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
      await marcarEnvioCarla(u.id);  // alimenta o teto anti-ban
      // Salva o opener na sessão (por user_id) pra Giovanna ter contexto no reply.
      await registrarMsgProativa({ userId: u.id, phone: u.whatsapp, content: msg, nome: u.nome });

      await supabase.from('users').update({
        carla_sem_cnpj_count: proxima,
        carla_sem_cnpj_last_at: now.toISOString(),
      }).eq('id', u.id);

      enviados++;
      if (isLast) encerrados++;
      await sleep(GAP_ENTRE_ENVIOS_MS); // espaça do próximo envio (anti-ráfaga)
    } catch (err) {
      logger.error('carla-sem-cnpj', `falha pra user ${u.id}`, err);
    }
  }

  return { enviados, encerrados };
}

// ─── FLUXO 2: COM CNPJ INATIVO 3+ DIAS ──────────────────────────────

export async function runCarlaInativoFollowup(): Promise<{ enviados: number; encerrados: number; debug?: any }> {
  const now = new Date();

  // Janela de envio (hoje 30/jun: só 18:30–20:00 BRT). Fora dela, não dispara.
  if (!dentroDaJanelaDeEnvio(now)) return { enviados: 0, encerrados: 0, debug: 'fora_da_janela' };

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

    // Mesmo teto anti-ban compartilhado da linha solardoc. Estourou → para o ciclo.
    if (!(await dentroDoTetoCarla())) {
      logger.info('carla-inativo', 'teto anti-ban atingido, segurando pro próximo ciclo');
      break;
    }

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
      await marcarEnvioCarla(u.id);  // alimenta o teto anti-ban
      // Salva o opener na sessão (por user_id) pra Giovanna ter contexto no reply.
      await registrarMsgProativa({ userId: u.id, phone: u.whatsapp, content: msg, nome: u.nome });

      await supabase.from('users').update({
        carla_inativo_count: proxima,
        carla_inativo_last_at: now.toISOString(),
      }).eq('id', u.id);

      enviados++;
      if (isLast) encerrados++;
      await sleep(GAP_ENTRE_ENVIOS_MS); // espaça do próximo envio (anti-ráfaga)
    } catch (err) {
      logger.error('carla-inativo', `falha pra user ${u.id}`, err);
    }
  }

  return { enviados, encerrados };
}

// ─── TESTE GATED: dispara o opener (Giovanna) pra UM user específico ──────────
// Mesmo caminho de produção (gera msg na voz da Giovanna, envia, marca throttle,
// SALVA a sessão por user_id, incrementa o count) — mas escopado a 1 user_id e
// ignorando o gate de intervalo (é disparo manual). Serve pra validar o loop
// chama→contexto→vende num cliente real antes da leva automática.
export async function dispararOpenerTesteParaUser(userId: string): Promise<{ ok: boolean; enviado_para?: string; msg?: string; detail?: string }> {
  const { data: u } = await supabase
    .from('users')
    .select('id, nome, whatsapp, plano, created_at, carla_inativo_count, whatsapp_opt_out, whatsapp_replied_at')
    .eq('id', userId)
    .maybeSingle();

  if (!u) return { ok: false, detail: 'user não encontrado' };
  if (!u.whatsapp) return { ok: false, detail: 'user sem whatsapp' };
  if (u.whatsapp_opt_out) return { ok: false, detail: 'user fez opt-out' };

  const now = new Date();
  const count = (u.carla_inativo_count as number | null) ?? 0;
  const proxima = count + 1;
  const nome = primeiroNome(u.nome as string | null);

  // Total de docs (contexto pro pitch).
  const { count: totalDocs } = await supabase
    .from('documents').select('id', { count: 'exact', head: true }).eq('user_id', u.id);

  const msg = await gerarMsgCarla({
    fluxo: 'inativo',
    tentativa: proxima,
    maxTentativas: MAX_INATIVO,
    nome,
    diasInativo: 5,
    totalDocs: totalDocs ?? 0,
    tomCfg: TONS_INATIVO[proxima] ?? TONS_INATIVO[1],
  });

  await sendZAPI(u.whatsapp as string, msg, 'solardoc');
  await marcarEnvioCarla(u.id as string);
  // Salva o opener por user_id → Giovanna lê o contexto quando o cliente responder.
  await registrarMsgProativa({ userId: u.id as string, phone: u.whatsapp as string, content: msg, nome: u.nome as string | null });
  await supabase.from('users').update({
    carla_inativo_count: proxima,
    carla_inativo_last_at: now.toISOString(),
  }).eq('id', u.id);

  return { ok: true, enviado_para: u.whatsapp as string, msg };
}
