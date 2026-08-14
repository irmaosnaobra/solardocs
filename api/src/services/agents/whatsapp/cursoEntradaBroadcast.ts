// ═══════════════════════════════════════════════════════════════════════════
// CAMPANHA ATIVA — reconquista da base com a entrada de R$19.
//
// Tudo o que existia da oferta era REATIVO: a Giovanna só falava do curso pra
// quem chamava ela. Isto aqui é o lado ATIVO — sai atrás de quem esfriou:
// FREE, inadimplente (cartão não passou) e quem cancelou antes de converter.
//
// A oferta é a mesma do inbound: curso Kit de Fechamento por R$19 (pagamento
// único no Pix) + 30 dias de plataforma completa. Quando o lead responde, ESTA
// cadência para e a Giovanna assume — o bloco do R$19 já está no prompt dela,
// então a conversa continua sem costura e sem repetir a oferta.
//
// ⚠️ ANTI-BAN — leia antes de mexer nos números.
// A linha `solardoc` JÁ FOI BANIDA uma vez por envio automático em massa
// (registrado em carlaThrottle.ts). Por isso esta campanha:
//   1. NÃO tem orçamento próprio — consome o MESMO teto da Carla
//      (dentroDoTetoCarla/marcarEnvioCarla). O teto protege a LINHA FÍSICA, não
//      a cadência: dois orçamentos separados na mesma linha dobrariam o tráfego
//      e reproduziriam exatamente o acidente que derrubou o número.
//   2. Respeita a janela de envio e espaça os envios (anti-rajada).
//   3. Manda TEXTO no toque proativo. A imagem do curso só sai depois, no
//      inbound, quando ele já respondeu — imagem em disparo cheira a spam.
// Consequência prática: a base drena em DRIP, ao longo de dias. É de propósito.
//
// Estado em `system_state` (chave curso19:<userId>) em vez de coluna nova: não
// exige migração em produção e some junto se a campanha for descartada.
// ═══════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendHuman, sleep } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { dentroDoTetoCarla, marcarEnvioCarla, dentroDaJanelaDeEnvio } from './carlaThrottle';
import { registrarMsgProativa } from './whatsappAgentService';
import { classificarFalha } from './filaAlerta';

import { carregarCerebro } from '../../io/cerebroAgentes';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// OPT-IN EXPLÍCITO, não kill-switch. Disparo em massa não pode começar sozinho
// só porque um deploy subiu: quem liga é o dono, setando CAMPANHA_CURSO19_ON=true
// no Vercel — sem code change e sem novo deploy. Desligar é remover a variável.
//
// O modo seco IGNORA esta trava de propósito: revisar a campanha em produção
// antes de ligar é justamente o que a gente quer que seja fácil.
// Lida em tempo de CHAMADA, não no import: assim ligar/desligar no Vercel vale
// no próximo tick, sem esperar a função serverless reciclar.
const campanhaLigada = () => (process.env.CAMPANHA_CURSO19_ON || '').toLowerCase() === 'true';

const CHAVE = (userId: string) => `curso19:${userId}`;
const GAP_ENTRE_ENVIOS_MS = 4000;

export const MAX_TOQUES = 3;

// Quem respondeu NAS ÚLTIMAS 72h está em conversa viva com a Giovanna — mandar
// um disparo por cima atropela o 1x1. Quem respondeu antes disso é o contrário:
// é a parte MAIS quente da base (já engajou uma vez) e é exatamente quem esta
// campanha existe pra reconquistar.
//
// A Carla usa `whatsapp_replied_at IS NULL` como corte, mas lá o significado é
// "respondeu à minha cadência, então para". Copiar isso aqui derrubaria 38 das
// 90 pessoas alcançáveis — gente que respondeu meses atrás e há muito esfriou.
const JANELA_CONVERSA_VIVA_MS = 72 * 60 * 60 * 1000;
/** Minutos desde o toque anterior. T1 sai no primeiro tick elegível. */
const INTERVALOS_MIN = [0, 4320, 5760]; // T1 agora · T2 +3d · T3 +4d (7d no total)

const TONS: Record<number, { tom: string; objetivo: string }> = {
  1: {
    tom: 'Reabre a conversa como quem lembrou dele, não como quem tem cota a bater. Nada de "temos uma novidade incrível".',
    objetivo:
      'Apresentar o curso Kit de Fechamento como o que ele ganha por R$19, e que junto abre a plataforma completa por 30 dias. Fecha com uma pergunta curta e direta.',
  },
  2: {
    tom: 'Consultora que conhece a dor. Ancora numa objeção concreta que todo integrador ouve.',
    objetivo:
      'Usar a aula de "achei mais barato" como prova do valor do curso. Repetir a condição (R$19 único, 30 dias de plataforma junto) só se ele não tiver respondido nada.',
  },
  3: {
    tom: 'Direta e calorosa, encerra com classe. Sem pressão e sem drama.',
    objetivo:
      'Última chamada honesta: pergunta se faz sentido pegar o curso por R$19 ou se prefere que ela não insista mais. O cliente decide.',
  },
};

function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return 'amigo';
  const p = nome.trim().split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 ? p : 'amigo';
}

function systemPrompt(args: {
  nome: string;
  tentativa: number;
  situacao: 'free' | 'inadimplente';
  // Persona editável na Central das Agentes (mesmo default de cerebroAgentes.curso19).
  persona?: string | null;
}): string {
  const contexto =
    args.situacao === 'inadimplente'
      ? 'Ele JÁ FOI cliente pagante e o acesso pausou porque o cartão não passou. Trate com respeito de quem já confiou na gente — nada de tom de cobrança.'
      : 'Ele tem cadastro na plataforma mas nunca virou assinante. Esfriou.';

  return [
    (args.persona && args.persona.trim()) || [
      'Você é a "Giovanna", consultora da SolarDoc. Vendedora de verdade, mas humana e consultiva.',
      '(É a MESMA Giovanna que responde quando ele retorna — uma pessoa só.)',
    ].join('\n'),
    '',
    'CONTEXTO:',
    `- Nome: ${args.nome}`,
    `- Situação: ${contexto}`,
    `- Toque nº ${args.tentativa} de ${MAX_TOQUES}`,
    `- Tom: ${TONS[args.tentativa].tom}`,
    `- Objetivo: ${TONS[args.tentativa].objetivo}`,
    '',
    'A OFERTA (não invente nada além disto):',
    '- Curso *Kit de Fechamento* por R$ 19 — pagamento ÚNICO no Pix. NÃO é mensalidade, NÃO pede cartão.',
    '- 6 módulos + bônus: 32 objeções respondidas (a primeira é "achei mais barato"), o roteiro da',
    '  visita técnica até a assinatura, e 15 mensagens prontas de prospecção e follow-up.',
    '- Junto vem a plataforma COMPLETA aberta por 30 dias: documentos ilimitados, proposta com',
    '  payback, contrato e procuração com a marca dele.',
    '- No fim dos 30 dias ele decide se assina (PRO R$27 ou VIP R$67). Se não quiser, não paga mais',
    '  nada e o curso continua sendo dele. Diga isso — é o que derruba a objeção de compromisso.',
    '',
    'REGRAS CRÍTICAS:',
    '- NÃO mande link de pagamento nem código Pix nesta mensagem. Se ele topar, ele responde e a',
    '  conversa continua — o Pix sai depois, no 1x1.',
    '- NUNCA cite "7 dias grátis" aqui: é outro caminho e misturar confunde.',
    '- Nunca invente preço, desconto ou prazo. Só R$19 / R$27 / R$67.',
    '- 1-2 frases por bolha, máximo 2 bolhas separadas por ||. 0-1 emoji.',
    '- VARIE o início; nada de "Oi [Nome]" padrão. Nada de frases de manual',
    '  ("não perca", "estou à disposição", "oportunidade única").',
    '- Sem markdown. Termine de um jeito que gere resposta natural.',
    '- Saída: APENAS o texto da mensagem. Sem aspas, sem prefixo.',
  ].join('\n');
}

/**
 * Fallback determinístico — se a IA falhar, a campanha não para nem manda vazio.
 *
 * ⚠️ Ele é o certo para falha PASSAGEIRA (limite, timeout, erro solto), porque a
 * pessoa só responde minutos depois e aí o inbound já voltou. Para a IA MORTA
 * (crédito zerado, chave recusada) ele é o errado — ver `iaFora` abaixo.
 */
function fallback(nome: string, tentativa: number): string {
  const fb: Record<number, string> = {
    1: `${nome}, montei um curso de fechamento aqui e lembrei de você. || São 32 objeções respondidas, sai por R$19 (uma vez só) e ainda abre a plataforma completa por 30 dias pra você usar. Quer ver?`,
    2: `${nome}, a primeira aula do curso é exatamente "o cliente achou mais barato" — o que responder, com o passo a passo. || R$19 uma vez, e os 30 dias de plataforma vêm junto. Faz sentido pra você?`,
    3: `${nome}, última vez que te chamo sobre isso, prometo. Rola pegar o curso por R$19, ou prefere que eu não insista mais? Qualquer resposta tá ótima.`,
  };
  return fb[tentativa] || `${nome}, ainda faz sentido a gente conversar?`;
}

/**
 * @returns `iaFora: true` quando a IA está MORTA (crédito zerado / chave
 *          recusada) — sinal para o tick abortar antes de enviar qualquer coisa.
 */
async function gerarMensagem(args: {
  nome: string;
  tentativa: number;
  situacao: 'free' | 'inadimplente';
}): Promise<{ texto: string; iaFora: boolean }> {
  try {
    const persona = await carregarCerebro('curso19');   // editável na Central das Agentes
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 250,
      system: systemPrompt({ ...args, persona }),
      messages: [{ role: 'user', content: `Gere a mensagem do toque ${args.tentativa}.` }],
    });
    const txt = (res.content[0] as { text: string }).text.trim();
    return { texto: txt.replace(/^["']|["']$/g, '') || fallback(args.nome, args.tentativa), iaFora: false };
  } catch (err) {
    // Mesma classificação que o aviso da fila usa — uma doença, um nome só.
    const causa = classificarFalha(err instanceof Error ? err.message : String(err));
    const iaFora = causa === 'ia_sem_credito' || causa === 'ia_chave';
    logger.error(
      'curso19',
      iaFora ? `IA fora (${causa}) — o toque NÃO sai` : 'IA falhou, usando fallback',
      err,
    );
    return { texto: fallback(args.nome, args.tentativa), iaFora };
  }
}

type Estado = { count: number; last_at: string | null };

async function lerEstados(): Promise<Map<string, Estado>> {
  const { data } = await supabase.from('system_state').select('key, value').like('key', 'curso19:%');
  const m = new Map<string, Estado>();
  for (const r of (data ?? []) as Array<{ key: string; value: any }>) {
    m.set(r.key.slice('curso19:'.length), {
      count: Number(r.value?.count) || 0,
      last_at: r.value?.last_at ?? null,
    });
  }
  return m;
}

function intervaloAtingido(estado: Estado | undefined, agora: Date): boolean {
  const count = estado?.count ?? 0;
  if (count >= MAX_TOQUES) return false;
  if (count === 0) return true;               // T1 sai no primeiro tick elegível
  if (!estado?.last_at) return true;
  const min = (agora.getTime() - new Date(estado.last_at).getTime()) / 60000;
  return min >= INTERVALOS_MIN[count];
}

export type ResultadoCampanha = {
  enviados: number;
  encerrados: number;
  elegiveis: number;
  pulados: number;
  seco: boolean;
  motivo?: string;
  previa?: Array<{ nome: string; telefone: string; toque: number; situacao: string; mensagem: string }>;
};

/**
 * Um tick da campanha. Chamado pelo cron de hora em hora.
 *
 * @param opts.seco  true = NÃO envia e NÃO grava; devolve a prévia das mensagens.
 *                   É como se revisa a campanha antes de ela tocar em alguém.
 * @param opts.limite teto de envios NESTE tick (o anti-ban ainda manda em cima).
 */
export async function runCursoEntradaBroadcast(
  opts?: { seco?: boolean; limite?: number },
): Promise<ResultadoCampanha> {
  const seco = opts?.seco === true;
  const limite = opts?.limite ?? 50;
  const agora = new Date();
  const base: ResultadoCampanha = { enviados: 0, encerrados: 0, elegiveis: 0, pulados: 0, seco };

  if (!campanhaLigada() && !seco) {
    return { ...base, motivo: 'campanha_desligada (defina CAMPANHA_CURSO19_ON=true)' };
  }
  // O modo seco ignora a janela: revisar a campanha às 3 da manhã é legítimo,
  // enviar não é.
  if (!seco && !dentroDaJanelaDeEnvio(agora)) return { ...base, motivo: 'fora_da_janela' };

  // ── Público: FREE (inclui quem cancelou e voltou pro grátis) e inadimplente.
  // PRO/VIP ativos ficam de fora: a entrada de R$19 existe pra quem NÃO paga —
  // oferecer a assinante é trocar R$67/mês por R$19 avulso.
  // O corte por `whatsapp_replied_at` é feito no laço (e não aqui) porque não é
  // "respondeu alguma vez" e sim "respondeu nas últimas 72h" — ver a constante.
  const { data: candidatos, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, plano, billing_status, whatsapp_opt_out, whatsapp_replied_at')
    .not('whatsapp', 'is', null)
    .eq('whatsapp_opt_out', false);

  if (error) throw new Error(`curso19: leitura da audiência falhou — ${error.message}`);
  if (!candidatos?.length) return base;

  // ── Exclusões que exigem outras tabelas, lidas de uma vez só.
  // 1. Quem JÁ tem o curso: a campanha oferece exatamente o que ele já tem.
  const { data: pedidos } = await supabase
    .from('kit_pedidos')
    .select('email, user_id, itens')
    .eq('status', 'paid');
  const jaTemCurso = new Set<string>();
  for (const p of (pedidos ?? []) as Array<{ email: string; user_id: string | null; itens: any }>) {
    if (!String(p.itens ?? '').includes('kit') && !(Array.isArray(p.itens) && p.itens.includes('kit'))) continue;
    if (p.user_id) jaTemCurso.add(p.user_id);
    if (p.email) jaTemCurso.add(p.email.toLowerCase().trim());
  }

  // 2. Quem já queimou a entrada de R$19 (a trava é por telefone, como no Pix).
  const { data: entradas } = await supabase
    .from('system_state').select('key').like('key', 'pix19_entrada:%');
  const jaUsouEntrada = new Set(
    (entradas ?? []).map((r: { key: string }) => r.key.slice('pix19_entrada:'.length)),
  );

  const estados = await lerEstados();
  const previa: NonNullable<ResultadoCampanha['previa']> = [];
  let enviados = 0, encerrados = 0, elegiveis = 0, pulados = 0;

  for (const u of candidatos as any[]) {
    const inadimplente = u.billing_status === 'past_due' || u.billing_status === 'suspended';
    const eFree = u.plano === 'free';

    if (!eFree && !inadimplente) { pulados++; continue; }   // PRO/VIP saudável

    // Conversa viva com a Giovanna agora → não atropela com disparo.
    const respondeu = u.whatsapp_replied_at ? new Date(u.whatsapp_replied_at).getTime() : 0;
    if (respondeu && agora.getTime() - respondeu < JANELA_CONVERSA_VIVA_MS) { pulados++; continue; }

    if (jaTemCurso.has(u.id) || jaTemCurso.has(String(u.email || '').toLowerCase())) { pulados++; continue; }
    if (jaUsouEntrada.has(String(u.whatsapp || '').replace(/\D/g, ''))) { pulados++; continue; }

    const estado = estados.get(u.id);
    if ((estado?.count ?? 0) >= MAX_TOQUES) { pulados++; continue; }
    if (!intervaloAtingido(estado, agora)) { pulados++; continue; }

    elegiveis++;
    if (enviados >= limite) continue;

    // Teto anti-ban COMPARTILHADO com a Carla — mesma linha física. Estourou,
    // para de varrer (break): o resto fica pro próximo ciclo horário.
    if (!seco && !(await dentroDoTetoCarla())) {
      logger.info('curso19', 'teto anti-ban atingido, segurando pro próximo ciclo');
      break;
    }

    const toque = (estado?.count ?? 0) + 1;
    const nome = primeiroNome(u.nome);
    const situacao: 'free' | 'inadimplente' = inadimplente ? 'inadimplente' : 'free';
    const { texto: msg, iaFora } = await gerarMensagem({ nome, tentativa: toque, situacao });

    // ⚠️ IA morta = campanha PARADA, não campanha no fallback.
    //
    // 07-10/08/2026: o crédito da Anthropic zerou e esta campanha continuou
    // disparando o texto determinístico — que promete "pega o curso por R$19" e,
    // por desenho (ver o topo do arquivo), NÃO manda o link: o Pix sai depois, no
    // 1x1. Só que o 1x1 é a Giovanna, e a Giovanna estava muda pela MESMA causa.
    // Resultado medido: 6 pessoas responderam ("Sim", "Como faço o curso?", "Ok
    // depois é 67,00 mensal?") e não receberam UMA linha de volta.
    //
    // Toque que gera resposta que ninguém pode responder é pior que toque nenhum:
    // queima o lead, queima a base e ainda gasta o teto anti-ban da linha. Então
    // aborta o tick inteiro — o público não vai a lugar nenhum e volta no próximo
    // ciclo, com a IA de pé.
    if (iaFora) {
      return { ...base, enviados, encerrados, elegiveis, pulados, motivo: 'ia_fora', ...(seco ? { previa } : {}) };
    }

    if (seco) {
      previa.push({ nome, telefone: u.whatsapp, toque, situacao, mensagem: msg });
      enviados++;
      continue;
    }

    try {
      // Bolha a bolha (o "||" do prompt ia cru pro cliente antes disto).
      await sendHuman(u.whatsapp, [msg], 'solardoc');
      await marcarEnvioCarla(u.id);   // alimenta o teto da LINHA
      // Deixa o opener na sessão pra Giovanna ter contexto quando ele responder —
      // sem isso ela recebe um "quanto é?" sem saber do que ele está falando.
      await registrarMsgProativa({ userId: u.id, phone: u.whatsapp, content: msg, nome: u.nome });

      const nowIso = agora.toISOString();
      await supabase.from('system_state').upsert(
        { key: CHAVE(u.id), value: { count: toque, last_at: nowIso }, updated_at: nowIso },
        { onConflict: 'key' },
      );

      enviados++;
      if (toque === MAX_TOQUES) encerrados++;
      await sleep(GAP_ENTRE_ENVIOS_MS);
    } catch (err) {
      logger.error('curso19', `falha pra user ${u.id}`, err);
    }
  }

  return { enviados, encerrados, elegiveis, pulados, seco, ...(seco ? { previa } : {}) };
}
