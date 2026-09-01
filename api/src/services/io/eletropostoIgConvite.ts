// ─────────────────────────────────────────────────────────────────────────────
// LEAD DE ELETROPOSTO QUE VEIO DO INSTAGRAM NÃO MARCA AGENDA — VAI PRA LP.
//
// Ordem do Thiago (19/08/2026): "está chegando alguns curiosos de eletroposto e
// frios; eles têm que ser convencidos a passar pelo solardoc.app/io/eletroposto
// e não marcar agenda direta."
//
// O QUE ESTAVA ACONTECENDO
// Quem largava um telefone num comentário ou numa DM caía direto em
// `ingestEletroposto`, que abria uma REUNIÃO de verdade na agenda do Thiago ou
// do Diego. Os três cards `manychat_eletroposto` que existem provam o estrago:
// os três nasceram `agendado`, com cidade nula, capital nulo, ponto nulo, e a
// observação afirmando "→ Lead qualificado no Instagram" — sobre um lead de quem
// a gente só tinha o número. O último ocupou as 8h da manhã seguinte.
//
// A régua que decide quem merece reunião (NOTA 1/2/3) só existe DENTRO da LP —
// é ela que pergunta o local, o decisor, a entrada trifásica e devolve a
// simulação. A DM não pergunta nada disso, então nenhum lead de Instagram tem
// como provar que é NOTA 2. Por isso o caminho agora é um só: cadastro em
// `eletroposto_nota1` (origem `instagram_dm`) e UM convite pra página.
//
// ── Por que o convite é um TICK e não sai na hora da ingestão ──
// A ingestão roda dentro do request (webhook do ManyChat, drenagem da fila do
// IG) e não escolhe a hora: o card 826 nasceu 23h15. Mandar dali seria WhatsApp
// de madrugada de um número desconhecido — o gesto que derruba a linha. Aqui o
// envio respeita a janela diurna, o teto da linha e o espaçamento, igual ao
// resto do outbound frio.
//
// ── Travas ──
//   • UM convite por pessoa, pra sempre (`convite_enviado_at` na própria ficha).
//   • Janela 09h–19h (BRT), 1 pessoa a cada 10 min, dentro do teto da linha.
//   • Pula quem está na supressão (pediu PARAR) e quem JÁ tem reunião marcada —
//     esse preencheu a LP no meio do caminho, e mandar "vai preencher a LP" pra
//     quem já preencheu é o jeito mais rápido de parecer robô.
//   • Marca ANTES de enviar: convite repetido é pior que convite perdido.
//
// Kill-switch: EP_IG_CONVITE_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { carregarBloqueioProativo } from './ioSend';
// Família de origem, não lista fixa: origem nova de EP entra sozinha na trava.
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

/** Origem gravada em `eletroposto_nota1` pelo lead que chegou por DM/comentário.
 *  Mora aqui (e não no manychatLeadService) porque é a chave que liga os dois
 *  lados: quem GRAVA e quem CONVIDA precisam concordar na mesma palavra. */
export const ORIGEM_IG = 'instagram_dm';

const INTERVALO_MS = 10 * 60 * 1000;
const JANELA_INICIO_H = 9;
const JANELA_FIM_H = 19;
/** Teto da fila avaliada por rodada. Cada candidato custa UMA consulta ao CRM
 *  (a trava de "já é cliente"), e como o tick manda 1 pessoa a cada 10 min uma
 *  fila de 40 já é mais de meio dia de envio — varrer 500 seria trabalho jogado
 *  fora a cada 5 minutos. Como a ordem é por chegada, o teto nunca esconde quem
 *  está na frente. */
const MAX_FILA = 40;

const desligado = (): boolean => (process.env.EP_IG_CONVITE_OFF || '').trim() === '1';

/** A LP com a etiqueta de onde a pessoa veio — é o que faz a visita aparecer no
 *  funil como Instagram em vez de "direto". A LP lê utm_* da querystring. */
export function linkDaLP(): string {
  const base = (process.env.DASHBOARD_URL || 'https://solardoc.app').replace(/\/$/, '');
  return base + '/io/eletroposto?utm_source=instagram&utm_medium=dm&utm_campaign=convite_agenda';
}

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' }));
}
function foraDaJanela(): boolean {
  const h = horaBrasilia();
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}
/** DDD + últimos 8 — a MESMA chave do CRM (donoDoTelefone), que tolera o 9 e o 55. */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
function primeiroNome(nome: string | null | undefined): string {
  // O IG entrega "@fulano" quando não há nome real — arroba na saudação denuncia
  // o robô na primeira linha.
  const p = String(nome || '').trim().replace(/^@/, '').split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 ? p : 'tudo bem';
}

/**
 * O convite. UMA bolha (sendFrio), e ela precisa VENDER a página — não avisar
 * que a página existe.
 *
 * O argumento é o do próprio produto: a reunião do eletroposto vale pelo estudo
 * do PONTO, e sem local, capital e decisor não há estudo pra levar. Então a
 * simulação não é burocracia antes da conversa, é o que faz a conversa valer.
 * E o fechamento devolve o que o lead veio buscar: quem preenche escolhe o
 * horário ali mesmo, sem depender de ninguém responder.
 */
export function bolhaConviteLP(nome: string | null | undefined): string[] {
  const p = primeiroNome(nome);
  return [
    'Oi ' + p + '! Aqui é da Irmãos na Obra, sobre o eletroposto que você viu no Instagram. '
    + 'Antes de marcar a conversa eu preciso de 2 minutos seus: nesta página você diz onde seria o ponto '
    + 'e como pretende investir, e ela já te devolve a simulação de faturamento do seu caso.\n\n'
    + linkDaLP() + '\n\n'
    + 'É isso que faz a conversa valer: o consultor entra com o estudo do SEU ponto na mão, '
    + 'não com apresentação genérica. E quem preenche escolhe o horário na própria página, na hora.',
  ];
}

export interface CandidatoIgConvite {
  id: number; telefone: string; nome: string | null; ficha_em: string;
}

/** Quem está esperando o convite, do mais antigo pro mais novo — fila justa:
 *  quem chegou primeiro fala primeiro. */
export async function publicoIgConvite(): Promise<CandidatoIgConvite[]> {
  const { data: fichas, error } = await supabaseGerador
    .from('eletroposto_nota1')
    .select('id, nome, telefone, created_at, convite_enviado_at, origem')
    .eq('origem', ORIGEM_IG)
    .is('convite_enviado_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_FILA);
  if (error) throw new Error('ep-ig-convite: ler eletroposto_nota1 falhou — ' + error.message);
  if (!fichas || !fichas.length) return [];

  const estaBloqueado = await carregarBloqueioProativo();

  const out: CandidatoIgConvite[] = [];
  for (const f of (fichas as Array<{ id: number; nome: string | null; telefone: string | null; created_at: string }>)) {
    const chave = telKey(f.telefone);
    if (!chave) continue;
    const tel = String(f.telefone || '').replace(/\D/g, '');
    if (!tel || estaBloqueado(tel)) continue;
    if (await jaTemCardDeEletroposto(chave, tel)) continue;
    out.push({ id: f.id, telefone: tel, nome: f.nome ?? null, ficha_em: f.created_at });
  }
  return out;
}

/**
 * Essa pessoa já é do eletroposto no CRM? Então o convite não sai.
 *
 * SEM JANELA DE DATA, e isso é o ponto. A primeira versão olhava só reunião de
 * ontem pra frente, e a base tem ~60 cards em `em_atendimento`,
 * `proposta_apresentada` e `fez_orcamento` cuja reunião foi semanas atrás. Um
 * deles comentando no Instagram receberia "sobre o eletroposto que você viu no
 * Instagram, antes de marcar a conversa eu preciso de 2 minutos seus" — depois
 * de já ter tido a conversa e recebido proposta. Fingir primeiro contato com
 * quem já é cliente é o jeito mais rápido de virar bloqueio na linha.
 *
 * Consulta POR CANDIDATO (a fila é de unidades, não de milhares): sem a janela
 * de data, varrer `agendamentos` inteiro estouraria o limite do PostgREST e a
 * truncagem deixaria gente passar em silêncio — o oposto do que a trava quer.
 *
 * Só card de ELETROPOSTO conta. Quem tem reunião de solar com a Nilce continua
 * podendo ser convidado: é outro produto, e ele nunca ouviu falar deste.
 * `cancelado`/`sem_interesse` também não contam — esses voltaram pra fila.
 */
async function jaTemCardDeEletroposto(chave: string, telefone: string): Promise<boolean> {
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('cliente_telefone, created_by, status')
    .not('status', 'in', '(cancelado,sem_interesse)')
    .ilike('cliente_telefone', `%${telefone.slice(-8)}`)
    .limit(50);
  // Falhou a leitura? Trata como "já tem" e não manda. Convite a mais é
  // irreversível; convite a menos espera o próximo tick.
  if (error) {
    logger.error('ep-ig-convite', 'checar card de eletroposto falhou — segurando o convite', error);
    return true;
  }
  return ((data ?? []) as Array<{ cliente_telefone: string | null; created_by: string | null }>)
    .some(a => telKey(a.cliente_telefone) === chave && ehOrigemEletroposto(a.created_by));
}

type Resultado = { enviados: number; motivo?: string; publico?: number; previa?: string[] };

export async function runEletropostoIgConviteTick(opts: { dry?: boolean } = {}): Promise<Resultado> {
  if (desligado()) return { enviados: 0, motivo: 'desligado' };

  let publico: CandidatoIgConvite[];
  try {
    publico = await publicoIgConvite();
  } catch (err) {
    logger.error('ep-ig-convite', 'montar público falhou', err);
    return { enviados: 0, motivo: 'erro_leitura' };
  }

  if (opts.dry) {
    return {
      enviados: 0, motivo: 'dry', publico: publico.length,
      previa: publico[0] ? bolhaConviteLP(publico[0].nome) : [],
    };
  }
  if (!publico.length) return { enviados: 0, motivo: 'ninguem_pendente' };
  if (foraDaJanela()) return { enviados: 0, motivo: 'fora_da_janela', publico: publico.length };
  if (!(await dentroDoTetoHorarioLinha())) return { enviados: 0, motivo: 'teto_linha', publico: publico.length };

  // O espaçamento se mede na PRÓPRIA ficha mais recente que já recebeu convite —
  // sem marcador em system_state pra manter sincronizado. Uma fonte de verdade só.
  const { data: ultimos } = await supabaseGerador
    .from('eletroposto_nota1')
    .select('convite_enviado_at')
    .eq('origem', ORIGEM_IG)
    .not('convite_enviado_at', 'is', null)
    .order('convite_enviado_at', { ascending: false })
    .limit(1);
  const ultimo = (ultimos ?? [])[0] as { convite_enviado_at?: string } | undefined;
  const ultimoMs = new Date(ultimo?.convite_enviado_at ?? 0).getTime();
  if (Date.now() - ultimoMs < INTERVALO_MS) return { enviados: 0, motivo: 'intervalo', publico: publico.length };

  const alvo = publico[0]!;
  // Marca ANTES de enviar. Se o envio falhar, o motivo fica em `convite_erro` e a
  // pessoa NÃO volta pra fila: convite duplicado de número desconhecido é o que
  // vira denúncia, e denúncia é o que derruba a linha.
  await supabaseGerador.from('eletroposto_nota1')
    .update({ convite_enviado_at: new Date().toISOString() }).eq('id', alvo.id);

  try {
    await sendFrio(alvo.telefone, bolhaConviteLP(alvo.nome), 'io');
    logger.info('ep-ig-convite', 'convite da LP enviado (ficha ' + alvo.id + ', de ' + alvo.ficha_em.slice(0, 10) + ')');
    return { enviados: 1, publico: publico.length - 1 };
  } catch (err) {
    logger.error('ep-ig-convite', 'convite falhou pra ficha ' + alvo.id, err);
    await supabaseGerador.from('eletroposto_nota1')
      .update({ convite_erro: String((err as Error)?.message || err).slice(0, 300) }).eq('id', alvo.id);
    return { enviados: 0, motivo: 'erro_envio', publico: publico.length };
  }
}
