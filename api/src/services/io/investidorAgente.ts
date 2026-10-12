// ─────────────────────────────────────────────────────────────────────────────
// A HELENA: AGENTE DE INVESTIDORES DO ELETROPOSTO (10/10/2026)
//
// Ordem do dono: chamar, um por vez, quem preencheu o formulário do eletroposto
// e declarou quanto pretende investir, confirmar se o plano continua de pé e
// marcar a reunião com o consultor. Começa em 11/10/2026, 08h de Brasília.
//
// SÃO DUAS METADES, e elas têm freios diferentes:
//
//   ABERTURA (fria)   uma pessoa por chamada, UMA bolha (sendFrio). Passa por
//                     todos os portões abaixo antes de reivindicar a pessoa.
//   RESPOSTA (reativa) quem respondeu é atendido: a IA lê a conversa inteira,
//                     responde em até 2 bolhas e devolve uma ação. O número da
//                     oferta agenda direto, sem IA.
//
// ── Os portões da abertura, na ordem, todos ANTES do claim ──
//   1. chave de desligar (INVESTIDOR_AGENTE_OFF=1 ou `inv_agente_off` no banco)
//   2. disjuntor: 2 erros de envio seguidos param até alguém religar; 3 pedidos
//      de parada no mesmo dia param as aberturas até o dia seguinte
//   3. início (11/10/2026 08h) e janela própria, em Brasília
//   4. teto do dia PRÓPRIO (30 na largada, 20 depois; env e rampa só apertam)
//   5. teto e espaçamento da LINHA (lineThrottle, sem mexer nele)
//   6. fila: o primeiro. 7. pausa humana daquele telefone
// Portão que não consegue LER fecha: sem saber quanto já saiu, não sai mais nada.
//
// ── O estado ──
// Tudo em `system_state`, sem tabela nova:
//   inv_agente:<chave>            a sessão (o insert dela é o claim)
//   inv_agente_sent:<chave>:t1    o carimbo do envio (conta no teto da linha)
//   inv_agente_vez:<chave>:<ts>   a vez de responder uma leva de mensagens
//   inv_agente_parar:<dia>:<chave> pedido de parada (alimenta o disjuntor)
//   inv_agente_off                chave de desligar
//   inv_agente_disjuntor          erros de envio seguidos
// A chave é DDD + 8 últimos dígitos (chaveContato), a mesma do resto da casa.
//
// ── Estado primeiro, mensagem depois ──
// Sessão, opt-out, status do cadastro e card são gravados ANTES de a mensagem
// correspondente sair. A exceção é o carimbo da abertura, que só existe com o
// envio feito: ele é a conta do teto, e carimbo sem envio gastaria a linha.
//
// Prévia sem enviar: GET /cron/investidor-agente?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from '../../utils/anthropicClient';
import { sendFrio, sendHuman, sendWhatsApp } from '../agents/zapiClient';
import {
  dentroDoTetoHorarioLinha, respeitaEspacamentoLinha, rampaReconexaoVigente, maxPorDia,
} from '../agents/whatsapp/lineThrottle';
import {
  carregarSilenciados, carregarMudos, carregarBloqueados, silenciarContato, chaveContato,
} from '../agents/whatsapp/silenciar';
import { carregarPausas, podeFalarComLead, registrarBloqueio } from '../agents/whatsapp/pausaHumana';
import { pareceRoboDeles } from '../agents/whatsapp/roboDoOutroLado';
import { EQUIPE } from '../../routes/ioEletroposto';
import { INSTANCE_ID_IO } from './solarRespostas';
import { type LinhaOrigem } from './eletropostoPares';
import { carregarCompromissos, aindaLivre } from './eletropostoVagas';
import { agendaFechadaNoIso } from '../agenda/agendaFechada';
import { ORIGEM_LP_EP, ORIGEM_AGENTE_EP, consultaDoRodizio, donoDaVez, gravarCardEletroposto } from './eletropostoCard';
import { INV_SESSAO_PREFIX, sessaoEhDaHelena, type EstagioInvestidor } from './investidorAgentePosse';
import {
  antesDoInicio, janelaAberta, tetoDoDia, dataBrasilia, horaBrasiliaTexto, inicioDoDiaBrasiliaIso,
  montarFila, renderAbertura, textoDaAbertura, primeiroNome, horariosDaOferta, textoOferta, textoConfirmacao, horarioCurto,
  textoPassagem, textoDespedida, textoParou, textoNaoEntendi, escolhaPorNumero, pediuParar, montarObservacao,
  montarSistema, montarPedido, lerSaida, juntarDados, violaRegras, pedidoDeReescrita, SCHEMA_SAIDA_HELENA,
  type CandidatoInvestidor, type DadosDaConversa, type MsgDaConversa, type RefCadastro, type ResultadoFila,
  type SaidaHelena,
} from './investidorAgentePuro';

const LOG = 'investidor-agente';

// ── Chaves em system_state ───────────────────────────────────────────────────
/** Carimbo de envio efetivado. Está em BOT_SENT_PREFIXES (lineThrottle.ts): conta
 *  como frio e entra no espaçamento, para os outros robôs frios enxergarem. */
export const INV_SENT_PREFIX = 'inv_agente_sent:';
const INV_VEZ_PREFIX = 'inv_agente_vez:';
const INV_PARAR_PREFIX = 'inv_agente_parar:';
/** Trava de chamada sobreposta: uma rodada por balde de 5 minutos (UTC). */
export const INV_LOCK_PREFIX = 'inv_agente_lock:';
const BALDE_DO_LOCK_MS = 5 * 60_000;
/** Falhas seguidas ao ler a conversa antes de desistir e passar para gente. */
const FALHAS_DE_HISTORICO_ATE_PASSAR = 3;
export const INV_OFF_KEY = 'inv_agente_off';
export const INV_DISJUNTOR_KEY = 'inv_agente_disjuntor';

// ── Limites ──────────────────────────────────────────────────────────────────
/** Erros de envio seguidos que param a abertura até alguém religar. */
const ERROS_ATE_ABRIR = 2;
/** Pedidos de parada no mesmo dia que param as aberturas até o dia seguinte. */
const PARADAS_ATE_PARAR = 3;
/** Junta mensagens seguidas ("Sim" e logo "obrigado") numa leva só. */
const ESPERA_MS = 30_000;
/** Resposta mais velha que isto não é mais conversa viva: vai para o consultor. */
const RESPOSTA_VIVA_MS = 60 * 60_000;
/** Conversas atendidas por chamada. */
const POR_TICK = 3;
/** Respostas da Helena por pessoa. Passou disso, é com gente. */
const MAX_RESPOSTAS = 10;
/** Listas de horário por pessoa. Quem recusou três listas precisa de gente. */
const MAX_OFERTAS = 3;
/** Qualquer mensagem na linha nesta janela tira a pessoa da fila da abertura. */
const CONVERSA_RECENTE_MS = 7 * 86_400_000;
const PAGINA = 1000;

/** Modelo da conversa: as mesmas constantes da agente do quiz solar. O padrão é
 *  o Opus 5; se ele não responder, a mesma pergunta vai para o Sonnet 4.6. */
const MODELO = (process.env.INVESTIDOR_AGENTE_MODELO || 'claude-opus-5').trim();
const MODELO_RESERVA = 'claude-sonnet-4-6';

const desligadoPorEnv = (): boolean => (process.env.INVESTIDOR_AGENTE_OFF || '').trim() === '1';

// ── Sessão ───────────────────────────────────────────────────────────────────
export interface SessaoInvestidor {
  estagio: EstagioInvestidor;
  aberto_em: string;
  /** Índice da abertura enviada (-1 = a reserva, sem nome). */
  abertura: number;
  origem: 'parceria' | 'nota1';
  id: number;
  /** Todas as linhas de cadastro daquele telefone, nas duas tabelas. */
  refs: RefCadastro[];
  telefone: string;
  nome: string | null;
  cidade: string | null;
  cadastro_em: string | null;
  valor_txt: string;
  consultor: string;
  /** Os 4 horários da oferta em aberto, em ISO. */
  oferta: string[];
  ofertas_feitas: number;
  agendamento_id: number | null;
  motivo: string | null;
  dados: DadosDaConversa;
  resumo: string;
  erro: string | null;
  /** Até onde a conversa já foi lida. */
  ate: string | null;
  respostas: number;
  /** Leituras da conversa que falharam em seguida (a vez não é gasta nelas). */
  falhas_historico?: number;
  atualizado_em: string;
}

const chaveDaSessao = (chave: string): string => `${INV_SESSAO_PREFIX}${chave}`;

async function gravarSessao(chave: string, s: SessaoInvestidor): Promise<void> {
  const em = new Date().toISOString();
  const { error } = await supabase.from('system_state')
    .upsert({ key: chaveDaSessao(chave), value: { ...s, atualizado_em: em }, updated_at: em }, { onConflict: 'key' });
  if (error) throw new Error(`gravar sessão ${chave}: ${error.message}`);
}

// ── Leitura paginada ─────────────────────────────────────────────────────────
// O PostgREST corta a resposta em 1000 linhas e ignora um .limit() maior (26/09:
// o placar publicou 41 locais em vez de 49, sem erro). Tudo que precisa vir
// inteiro vem por .range, em blocos, até a página voltar incompleta. Erro SOBE:
// lista incompleta aqui viraria mensagem para quem não devia receber.
type Pagina = PromiseLike<{ data: unknown; error: { message?: string } | null }>;

async function lerTudo<T>(rotulo: string, pagina: (de: number, ate: number) => Pagina, teto = 60_000): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) throw new Error(`${rotulo}: ${error.message || 'falha de leitura'}`);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
    if (out.length >= teto) throw new Error(`${rotulo}: passou de ${teto} linhas, leitura interrompida`);
  }
}

async function lerSessoes(): Promise<Map<string, SessaoInvestidor>> {
  const linhas = await lerTudo<{ key: string; value: SessaoInvestidor }>('sessões da Helena', (de, ate) =>
    supabase.from('system_state').select('key, value')
      .like('key', `${INV_SESSAO_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  const mapa = new Map<string, SessaoInvestidor>();
  for (const l of linhas) mapa.set(String(l.key).slice(INV_SESSAO_PREFIX.length), (l.value ?? {}) as SessaoInvestidor);
  return mapa;
}

// ── Chave de desligar e disjuntor ────────────────────────────────────────────
export interface EstadoDesligar { off: boolean; por: 'env' | 'banco' | 'erro_de_leitura' | null }

/** Lida a cada chamada. Sem conseguir ler a chave do banco, vale como desligada. */
export async function lerChaveDesligar(): Promise<EstadoDesligar> {
  if (desligadoPorEnv()) return { off: true, por: 'env' };
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', INV_OFF_KEY).maybeSingle();
    if (error) throw error;
    const v = data?.value as { off?: unknown } | boolean | string | null | undefined;
    const ligada = v === true || v === '1' || (typeof v === 'object' && v !== null && (v.off === true || v.off === '1'));
    return ligada ? { off: true, por: 'banco' } : { off: false, por: null };
  } catch (err) {
    logger.error(LOG, 'ler a chave de desligar falhou: tratando como desligada', err);
    return { off: true, por: 'erro_de_leitura' };
  }
}

/** ?desligar=1 e ?ligar=1. Ligar também rearma o disjuntor de erros de envio. */
export async function definirChaveDesligar(desligar: boolean, por = 'cron'): Promise<{ ok: boolean; desligada: boolean; aviso?: string }> {
  const em = new Date().toISOString();
  if (desligar) {
    const { error } = await supabase.from('system_state')
      .upsert({ key: INV_OFF_KEY, value: { off: true, em, por }, updated_at: em }, { onConflict: 'key' });
    if (error) throw new Error(`gravar a chave de desligar: ${error.message}`);
    logger.info(LOG, 'agente DESLIGADA pela chave do banco');
    return { ok: true, desligada: true };
  }
  const { error } = await supabase.from('system_state').delete().in('key', [INV_OFF_KEY, INV_DISJUNTOR_KEY]);
  if (error) throw new Error(`remover a chave de desligar: ${error.message}`);
  logger.info(LOG, 'agente LIGADA: chave do banco removida e disjuntor rearmado');
  return desligadoPorEnv()
    ? { ok: true, desligada: true, aviso: 'A chave do banco saiu, mas INVESTIDOR_AGENTE_OFF=1 continua na Vercel e segue desligando.' }
    : { ok: true, desligada: false };
}

interface Disjuntor { erros_seguidos: number; aberto: boolean; em?: string; ultimo_erro?: string }

async function lerDisjuntor(): Promise<Disjuntor> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', INV_DISJUNTOR_KEY).maybeSingle();
  if (error) throw new Error(`ler disjuntor: ${error.message}`);
  const v = (data?.value ?? {}) as Partial<Disjuntor>;
  const erros = Number(v.erros_seguidos || 0);
  return { erros_seguidos: erros, aberto: v.aberto === true || erros >= ERROS_ATE_ABRIR, em: v.em, ultimo_erro: v.ultimo_erro };
}

async function gravarDisjuntor(d: Disjuntor): Promise<void> {
  const em = new Date().toISOString();
  await supabase.from('system_state')
    .upsert({ key: INV_DISJUNTOR_KEY, value: { ...d, em }, updated_at: em }, { onConflict: 'key' })
    .then(undefined, (e: unknown) => logger.error(LOG, 'gravar disjuntor falhou', e));
}

async function contarChaves(prefixo: string, desdeIso?: string): Promise<number> {
  let q = supabase.from('system_state').select('key', { count: 'exact', head: true }).like('key', `${prefixo}%`);
  if (desdeIso) q = q.gte('updated_at', desdeIso);
  const { count, error } = await q;
  if (error) throw new Error(`contar ${prefixo}: ${error.message}`);
  if (typeof count !== 'number') throw new Error(`contar ${prefixo}: resposta sem contagem`);
  return count;
}

/** Quantas aberturas saíram desde 00:00 de Brasília. Erro SOBE (falha fechada). */
const contarEnviadosHoje = (agora: Date): Promise<number> => contarChaves(INV_SENT_PREFIX, inicioDoDiaBrasiliaIso(agora));
const contarParadasHoje = (agora: Date): Promise<number> => contarChaves(`${INV_PARAR_PREFIX}${dataBrasilia(agora)}:`);

// ── A fila ───────────────────────────────────────────────────────────────────
interface LeituraDaFila { resultado: ResultadoFila; sessoes: Map<string, SessaoInvestidor>; lidsSemMapa: number }

/** As três origens, com a mesma leitura da aba Investidores (ver `curiosos()` em
 *  eletropostoPares.ts), só que paginada. */
async function lerOrigens(): Promise<LinhaOrigem[]> {
  const [cad, fic, ag] = await Promise.all([
    lerTudo<Record<string, unknown>>('cadastros de parceria', (de, ate) =>
      supabaseGerador.from('eletroposto_parceria')
        .select('id, nome, telefone, cidade, lado, ponto_relacao, capital_faixa, status, created_at')
        .in('lado', ['ponto', 'capital'])
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(de, ate)),
    lerTudo<Record<string, unknown>>('fichas da LP', (de, ate) =>
      supabaseGerador.from('eletroposto_nota1')
        .select('id, nome, telefone, cidade, ficha, valor_investir, status, created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(de, ate)),
    lerTudo<Record<string, unknown>>('agenda de arrendamento', (de, ate) =>
      supabaseGerador.from('agendamentos')
        .select('id, cliente_telefone, created_at').eq('status', 'arrendamento')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(de, ate)),
  ]);
  return [
    ...cad.map(r => ({ origem: 'parceria' as const, r })),
    ...fic.map(r => ({ origem: 'nota1' as const, r })),
    ...ag.map(r => ({ origem: 'agenda' as const, r })),
  ];
}

/** Chaves com QUALQUER card na agenda, em qualquer status. */
async function lerChavesComCard(): Promise<Set<string>> {
  const linhas = await lerTudo<{ cliente_telefone: string | null }>('cards da agenda', (de, ate) =>
    supabaseGerador.from('agendamentos').select('id, cliente_telefone')
      .not('cliente_telefone', 'is', null).order('id', { ascending: true }).range(de, ate));
  const chaves = new Set<string>();
  for (const l of linhas) { const k = chaveContato(l.cliente_telefone); if (k) chaves.add(k); }
  return chaves;
}

/**
 * Chaves com qualquer mensagem na linha nos últimos 7 dias, nossa ou dele.
 *
 * Quem digita pelo CELULAR da linha chega como LID (14 ou 15 dígitos), sem
 * telefone. Cruzar isso direto dá silêncio do lado errado: a conversa que a
 * Giovanna está tendo pareceria não existir. Então o LID é resolvido pelo mapa
 * `wa_lid_telefone` antes de virar chave. LID sem mapa é contado e aparece na
 * prévia: é conversa que esta trava não enxerga.
 */
async function lerChavesComConversa(agora: number): Promise<{ chaves: Set<string>; lidsSemMapa: number }> {
  const desde = new Date(agora - CONVERSA_RECENTE_MS).toISOString();
  const [msgs, mapa] = await Promise.all([
    lerTudo<{ telefone: string | null }>('mensagens dos últimos 7 dias', (de, ate) =>
      supabase.from('wa_mensagens').select('id, telefone')
        .eq('is_group', false).gte('momment', desde)
        .order('id', { ascending: true }).range(de, ate)),
    lerTudo<{ lid: string; chave: string | null; telefone: string | null }>('mapa de LID', (de, ate) =>
      supabase.from('wa_lid_telefone').select('lid, chave, telefone')
        .order('lid', { ascending: true }).range(de, ate)),
  ]);
  const chaveDoLid = new Map<string, string>();
  for (const m of mapa) {
    const k = String(m.chave || '') || chaveContato(m.telefone) || '';
    if (k) chaveDoLid.set(String(m.lid).replace(/\D/g, ''), k);
  }
  const chaves = new Set<string>();
  const semMapa = new Set<string>();
  for (const m of msgs) {
    const d = String(m.telefone ?? '').replace(/\D/g, '');
    if (!d) continue;
    if (d.length > 13) {
      const k = chaveDoLid.get(d);
      if (k) chaves.add(k); else semMapa.add(d);
      continue;
    }
    const k = chaveContato(d);
    if (k) chaves.add(k);
  }
  return { chaves, lidsSemMapa: semMapa.size };
}

/** Monta a fila inteira. Qualquer leitura que falhar derruba a rodada: sem
 *  saber quem tem card, quem conversou ou quem pediu para parar, ninguém recebe. */
async function lerFila(agora: number): Promise<LeituraDaFila> {
  const [linhas, comCard, conversa, sessoes, silenciado, mudo, bloqueado, pausa] = await Promise.all([
    lerOrigens(),
    lerChavesComCard(),
    lerChavesComConversa(agora),
    lerSessoes(),
    // Os quatro filtros da casa, lidos UMA vez por tick (o modelo é o
    // carregarBloqueioProativo do ioSend.ts). Mudo aqui é quem levou 2 toques
    // sem responder, mais apertado que o padrão de 3 (parecer anti-ban, 10/10).
    //
    // EM MODO ESTRITO (11/10/2026). O padrão destas quatro é falhar ABERTO: com
    // erro de leitura elas devolvem "ninguém barrado", o que serve para robô que
    // drena fila de quem já é nosso e não serve para abertura fria. Aqui o erro
    // SOBE, a fila não é montada e ninguém recebe (`erro_leitura_fila`; a prévia
    // mostra qual leitura falhou).
    carregarSilenciados({ estrito: true }),
    carregarMudos(2, 60, { estrito: true }),
    carregarBloqueados({ estrito: true }),
    carregarPausas({ estrito: true }),
  ]);
  const resultado = montarFila(linhas, {
    comCard,
    comSessao: new Set(sessoes.keys()),
    comConversa: conversa.chaves,
    silenciado, mudo, bloqueado,
    comHumano: (tel: string) => !pausa(tel).pode,
  });
  return { resultado, sessoes, lidsSemMapa: conversa.lidsSemMapa };
}

/**
 * O consultor desta pessoa. A fila só tem gente sem card, então vale o rodízio
 * Thiago e Diego da LP: a contagem dos cards da LP (a mesma da rota), MAIS as
 * sessões que a Helena já abriu. Cada card dela nasce de uma sessão, então os
 * cards dela contam no rodízio, e contam desde a abertura: sem isso todo mundo
 * chamado no domingo cairia no mesmo consultor até alguém agendar.
 */
async function consultorDaVez(sessoesAbertas: number): Promise<string> {
  try {
    const { count, error } = await consultaDoRodizio([ORIGEM_LP_EP]);
    if (error) throw error;
    return donoDaVez((count || 0) + sessoesAbertas);
  } catch (err) {
    logger.warn(LOG, 'contagem do rodízio falhou: usando só as sessões da agente', { erro: String(err) });
    return donoDaVez(sessoesAbertas);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ABERTURA
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoAbertura { enviados: number; motivo?: string; fila?: number; para?: string; erro?: string }

const semEnvio = (motivo: string, extra: Partial<ResultadoAbertura> = {}): ResultadoAbertura => ({ enviados: 0, motivo, ...extra });

/** Um envio por chamada, sempre. */
export async function runInvestidorAberturaTick(opts: { agora?: Date } = {}): Promise<ResultadoAbertura> {
  const agora = opts.agora ?? new Date();

  // 1) Chave de desligar.
  const chave = await lerChaveDesligar();
  if (chave.off) return semEnvio(`desligada_${chave.por}`);

  // 2) Disjuntor. Sem conseguir ler, não envia.
  let disjuntor: Disjuntor;
  let paradas: number;
  try {
    [disjuntor, paradas] = await Promise.all([lerDisjuntor(), contarParadasHoje(agora)]);
  } catch (err) {
    logger.error(LOG, 'ler o disjuntor falhou: abertura suspensa nesta rodada', err);
    return semEnvio('erro_leitura_disjuntor');
  }
  if (disjuntor.aberto) return semEnvio('disjuntor_erros_de_envio');
  if (paradas >= PARADAS_ATE_PARAR) return semEnvio('disjuntor_pedidos_de_parada');

  // 3) Início e janela própria.
  if (antesDoInicio(agora)) return semEnvio('antes_do_inicio');
  if (!janelaAberta(agora)) return semEnvio('fora_da_janela');

  // 4) Teto do dia PRÓPRIO. A rampa de reconexão aperta: linha que acabou de
  //    voltar manda no ritmo dela. Falha de leitura da contagem fecha.
  const rampa = await rampaReconexaoVigente(agora);
  const teto = tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null);
  let enviadosHoje: number;
  try {
    enviadosHoje = await contarEnviadosHoje(agora);
  } catch (err) {
    logger.error(LOG, 'contar os envios de hoje falhou: abertura suspensa nesta rodada', err);
    return semEnvio('erro_leitura_teto');
  }
  if (enviadosHoje >= teto) return semEnvio('teto_do_dia');

  // 5) A linha. Ordem do dono (10/10/2026) com o parecer anti-ban: o limite
  //    diário desta agente é o teto próprio do item 4; aqui o `pisoDia` só leva a
  //    rede do frio da linha de 30 para os 40 do teto cheio (maxPorDia). O teto
  //    por HORA e o espaçamento continuam sendo o freio, sem piso nenhum. Com a
  //    rampa de reconexão armada nem esse piso vale.
  const linhaComFolga = rampa
    ? await dentroDoTetoHorarioLinha()
    : await dentroDoTetoHorarioLinha({ pisoDia: maxPorDia() });
  if (!linhaComFolga) return semEnvio('teto_da_linha');
  if (!(await respeitaEspacamentoLinha())) return semEnvio('espacamento_da_linha');

  // 6) A fila: o primeiro.
  let leitura: LeituraDaFila;
  try {
    leitura = await lerFila(agora.getTime());
  } catch (err) {
    logger.error(LOG, 'montar a fila falhou: ninguém recebe nesta rodada', err);
    return semEnvio('erro_leitura_fila');
  }
  const alvo = leitura.resultado.fila[0];
  if (!alvo) return semEnvio('fila_vazia', { fila: 0 });

  // 7) Pausa humana daquele telefone, conferida de novo na hora de falar.
  if (!(await podeFalarComLead(alvo.telefone)).pode) {
    await registrarBloqueio(alvo.telefone, LOG);
    return semEnvio('humano_na_conversa', { fila: leitura.resultado.fila.length });
  }

  // CLAIM: o insert da sessão. 23505 = outra chamada já pegou esta pessoa.
  const abertura = renderAbertura(alvo.chave, alvo.nome, alvo.valorTxt);
  const consultor = await consultorDaVez(leitura.sessoes.size);
  const nowIso = new Date().toISOString();
  const sessao: SessaoInvestidor = {
    estagio: 'chamado', aberto_em: nowIso, abertura: abertura.indice,
    origem: alvo.origem, id: alvo.id, refs: alvo.refs,
    telefone: alvo.telefone, nome: alvo.nome, cidade: alvo.cidade, cadastro_em: alvo.criadoEm || null,
    valor_txt: alvo.valorTxt, consultor,
    oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null,
    dados: {}, resumo: '', erro: null, ate: null, respostas: 0, atualizado_em: nowIso,
  };
  const { error: eClaim } = await supabase.from('system_state')
    .insert({ key: chaveDaSessao(alvo.chave), value: sessao, updated_at: nowIso });
  if (eClaim) {
    if (String((eClaim as { code?: string }).code) === '23505') return semEnvio('ja_reivindicado');
    logger.error(LOG, 'claim da sessão falhou', eClaim);
    return semEnvio('erro_claim');
  }

  // UMA bolha. Erro de envio fica na sessão e o tick PARA: não tenta o próximo.
  const fim4 = alvo.telefone.slice(-4);
  try {
    await sendFrio(alvo.telefone, [abertura.texto], 'io');
  } catch (err) {
    const erro = String((err as Error)?.message || err).slice(0, 300);
    logger.error(LOG, `abertura falhou para o final ${fim4}`, err);
    await gravarSessao(alvo.chave, { ...sessao, erro }).catch(e => logger.error(LOG, 'registrar o erro na sessão falhou', e));
    const erros = disjuntor.erros_seguidos + 1;
    await gravarDisjuntor({ erros_seguidos: erros, aberto: erros >= ERROS_ATE_ABRIR, ultimo_erro: erro });
    return semEnvio('erro_envio', { erro });
  }

  // Envio feito: agora sim o carimbo, uma chave por toque e por telefone.
  const carimbo = { key: `${INV_SENT_PREFIX}${alvo.chave}:t1`, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() };
  let { error: eCarimbo } = await supabase.from('system_state').upsert(carimbo, { onConflict: 'key' });
  if (eCarimbo) ({ error: eCarimbo } = await supabase.from('system_state').upsert(carimbo, { onConflict: 'key' }));
  if (eCarimbo) logger.error(LOG, `ENVIO FEITO SEM CARIMBO (final ${fim4}): o teto de hoje está contando um a menos`, eCarimbo);
  if (disjuntor.erros_seguidos > 0) await gravarDisjuntor({ erros_seguidos: 0, aberto: false });

  logger.info(LOG, `abertura enviada (final ${fim4}, ${alvo.origem} #${alvo.id}, consultor ${consultor})`);
  return { enviados: 1, fila: leitura.resultado.fila.length - 1, para: `final ${fim4}` };
}

// ═════════════════════════════════════════════════════════════════════════════
// PRÉVIA (?dry=1): não envia, não grava, ignora janela e início.
// ═════════════════════════════════════════════════════════════════════════════

export async function previaInvestidorAgente(opts: { agora?: Date } = {}): Promise<Record<string, unknown>> {
  const agora = opts.agora ?? new Date();
  const tentar = async <T>(f: () => Promise<T>): Promise<T | { erro: string }> => {
    try { return await f(); } catch (e) { return { erro: String((e as Error)?.message || e) }; }
  };
  const [chave, disjuntor, paradas, enviados, rampa, leitura] = await Promise.all([
    lerChaveDesligar(),
    tentar(lerDisjuntor),
    tentar(() => contarParadasHoje(agora)),
    tentar(() => contarEnviadosHoje(agora)),
    rampaReconexaoVigente(agora),
    tentar(() => lerFila(agora.getTime())),
  ]);

  const base = {
    hora_brasilia: horaBrasiliaTexto(agora),
    antes_do_inicio: antesDoInicio(agora),
    janela_aberta: janelaAberta(agora),
    desligada: chave,
    disjuntor,
    pedidos_de_parada_hoje: paradas,
    rampa_de_reconexao: rampa,
    teto_do_dia: tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null),
    enviados_hoje: enviados,
  };
  if ('erro' in leitura) return { ...base, fila: null, erro_da_fila: leitura.erro };

  const { fila, excluidos, base: grupo } = leitura.resultado;
  const porEstagio: Record<string, number> = {};
  for (const s of leitura.sessoes.values()) porEstagio[String(s.estagio)] = (porEstagio[String(s.estagio)] ?? 0) + 1;
  const porStatus: Record<string, number> = {};
  for (const c of fila) porStatus[c.status || 'novo'] = (porStatus[c.status || 'novo'] ?? 0) + 1;

  return {
    ...base,
    grupo_investidores: grupo,
    fila: fila.length,
    excluidos,
    // Conversa de humano pelo celular que o mapa de LID não resolveu: a trava
    // dos 7 dias não enxerga estas.
    lids_sem_mapa: leitura.lidsSemMapa,
    // O status do cadastro não tira ninguém da fila (só `sem_interesse` tira).
    fila_por_status_do_cadastro: porStatus,
    sessoes_por_estagio: porEstagio,
    primeiros: fila.slice(0, 30).map((c: CandidatoInvestidor) => ({
      nome: primeiroNome(c.nome), telefone_final: c.telefone.slice(-2), valor: c.valorTxt, origem: `${c.origem}:${c.id}`,
    })),
    textos: fila.slice(0, 3).map(c => renderAbertura(c.chave, c.nome, c.valorTxt).texto),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// RESPOSTAS
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoRespostas {
  respondidas: number;
  agendadas: number;
  passadas: number;
  erros: number;
  motivo?: string;
}

const semResposta = (motivo?: string): ResultadoRespostas =>
  ({ respondidas: 0, agendadas: 0, passadas: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** A Z-API às vezes entrega o número sem o nono dígito, ou sem o 55: pergunta por todas. */
function variantes(phone: string): string[] {
  const d = String(phone || '').replace(/\D/g, '');
  const out = new Set([d]);
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith('55')) out.add(d.slice(0, 4) + '9' + d.slice(4));
  for (const v of [...out]) if (v.startsWith('55') && v.length >= 12) out.add(v.slice(2));
  return [...out];
}

/** Uma pergunta à IA. Recusa e qualquer falha viram saída inválida: na dúvida a
 *  agente cala e o consultor, que recebe o recado, assume. */
async function perguntar(sistema: string, pedido: string): Promise<SaidaHelena> {
  const cliente = novoAnthropic();
  const textoDe = (r: Anthropic.Message) => r.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  try {
    const r = await cliente.messages.create({
      model: MODELO,
      max_tokens: 4000,
      system: sistema,
      // Esforço baixo: é conversa de WhatsApp, a pessoa está esperando.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_SAIDA_HELENA } },
      messages: [{ role: 'user', content: pedido }],
    });
    if (r.stop_reason === 'refusal') return lerSaida('');
    return lerSaida(textoDe(r));
  } catch (err) {
    logger.warn(LOG, `${MODELO} falhou, tentando a reserva`, { erro: String((err as Error)?.message || err).slice(0, 300) });
  }
  try {
    const r = await cliente.messages.create({
      model: MODELO_RESERVA,
      max_tokens: 1500,
      system: sistema,
      messages: [{ role: 'user', content: pedido }],
    });
    if (r.stop_reason === 'refusal') return lerSaida('');
    return lerSaida(textoDe(r));
  } catch (err) {
    logger.error(LOG, 'a IA não respondeu', err);
    return lerSaida('');
  }
}

/** O recado no celular da equipe, do mesmo jeito que o eletropostoRespostas
 *  repassa: para o Thiago e para o Diego, com o nome de quem atende. */
async function avisarEquipe(s: SessaoInvestidor, titulo: string, novas: readonly MsgDaConversa[], extra = ''): Promise<boolean> {
  const escreveu = novas.map(m => (m.texto || `[${m.tipo}]`)).join(' / ').slice(0, 600);
  const corpo = [
    `*HELENA (investidores) PASSOU PARA VOCÊ: ${titulo}*`,
    `*Investidor:* ${s.nome || 'sem nome'}${s.cidade ? ` (${s.cidade})` : ''}`,
    `*WhatsApp:* wa.me/${s.telefone}`,
    `*Valor que marcou:* ${s.valor_txt}`,
    `*Com:* ${s.consultor}`,
    s.resumo ? `*Resumo:* ${s.resumo}` : '',
    escreveu ? `*Escreveu:* ${escreveu}` : '',
    extra,
  ].filter(Boolean);
  const recado = [...corpo, '', '_A Helena parou de responder nesta conversa. A partir daqui é com você._'].join('\n');
  const envios = await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, recado, 'io')));
  const ok = envios.filter(e => e.status === 'fulfilled').length;
  if (!ok) logger.error(LOG, `recado à equipe não chegou em ninguém (final ${s.telefone.slice(-4)})`);
  return ok > 0;
}

type StatusCadastro = 'falando' | 'conectado' | 'sem_interesse';
const TABELA_DO_CADASTRO: Record<'parceria' | 'nota1', string> = { parceria: 'eletroposto_parceria', nota1: 'eletroposto_nota1' };

/**
 * O status da linha de cadastro, nas duas tabelas daquele telefone.
 *
 * `falando` e `conectado` só sobem por cima de status "anterior" (vazio, novo,
 * falando): nunca apagam um `sem_interesse` que a equipe marcou à mão.
 * `sem_interesse` grava sempre, porque foi a própria pessoa quem disse.
 */
async function marcarCadastro(s: SessaoInvestidor, status: StatusCadastro): Promise<void> {
  const refs = s.refs?.length ? s.refs : [{ origem: s.origem, id: s.id }];
  for (const ref of refs) {
    const tabela = TABELA_DO_CADASTRO[ref.origem];
    if (!tabela) continue;
    let q = supabaseGerador.from(tabela).update({ status }).eq('id', ref.id);
    if (status === 'falando') q = q.or('status.is.null,status.eq.novo');
    if (status === 'conectado') q = q.or('status.is.null,status.in.(novo,falando)');
    const { error } = await q;
    if (error) logger.error(LOG, `marcar ${tabela} #${ref.id} como ${status} falhou`, error);
  }
}

/** Este telefone ganhou card na agenda por outra porta (LP, consultor)? */
async function cardDoTelefone(tel: string): Promise<number | null> {
  const chave = chaveContato(tel);
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('id, cliente_telefone').ilike('cliente_telefone', `%${tel.slice(-8)}`)
    .order('id', { ascending: false }).limit(50);
  if (error) throw new Error(`conferir card do telefone: ${error.message}`);
  const achado = ((data ?? []) as Array<{ id: number; cliente_telefone: string | null }>)
    .find(a => chaveContato(a.cliente_telefone) === chave);
  return achado ? achado.id : null;
}

/**
 * A conversa da linha com ESTA pessoa, mais antiga primeiro, até 20 mensagens.
 *
 * O `like '%<8 últimos>%'` sozinho traz gente demais: o mesmo final em outro DDD
 * é outra pessoa, e um LID de 15 dígitos pode conter esses 8 por acaso. Então,
 * depois de buscar, cada linha é conferida pela chave exata (DDD + 8). O que um
 * consultor digitou pelo celular fica gravado sob o LID do contato, e entra pela
 * lista de LIDs que o mapa `wa_lid_telefone` dá para esta chave: a IA precisa
 * ver o que a equipe já disse.
 *
 * Erro de leitura SOBE. Responder sem ter lido a conversa é a regra que a casa
 * proíbe (23/09, "se não sabe o que já foi dito, não fala").
 */
async function lerHistorico(chave: string, telefone: string, antesDe: string): Promise<MsgDaConversa[]> {
  const { data: mapa, error: eMapa } = await supabase
    .from('wa_lid_telefone').select('lid').eq('chave', chave).limit(50);
  if (eMapa) throw new Error(`mapa de LID: ${eMapa.message}`);
  const lids = new Set(((mapa ?? []) as Array<{ lid: string }>).map(m => String(m.lid).replace(/\D/g, '')).filter(Boolean));

  const base = () => supabase.from('wa_mensagens')
    .select('telefone, from_me, texto, tipo, momment')
    .eq('instancia', INSTANCE_ID_IO).eq('is_group', false)
    .lt('momment', antesDe)
    .order('momment', { ascending: false });
  const consultas = [base().like('telefone', `%${telefone.slice(-8)}%`).limit(60)];
  if (lids.size) consultas.push(base().in('telefone', [...lids]).limit(40));

  const linhas: Array<MsgDaConversa & { telefone: string | null }> = [];
  for (const r of await Promise.all(consultas)) {
    if (r.error) throw new Error(`conversa da linha: ${r.error.message}`);
    linhas.push(...((r.data ?? []) as Array<MsgDaConversa & { telefone: string | null }>));
  }
  const daPessoa = linhas.filter(m => {
    const d = String(m.telefone ?? '').replace(/\D/g, '');
    return d.length > 13 ? lids.has(d) : chaveContato(d) === chave;
  });
  const vistos = new Set<string>();
  return daPessoa
    .filter(m => { const k = `${m.momment}|${m.from_me}|${m.texto}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0))
    .slice(-20)
    .map(({ from_me, texto, tipo, momment }) => ({ from_me, texto, tipo, momment }));
}

interface Contexto {
  chave: string;
  novas: MsgDaConversa[];
  ultima: string;
  res: ResultadoRespostas;
  /** A conversa até a primeira mensagem nova, já lida e conferida. */
  historico: MsgDaConversa[];
}

/** Fecha a conversa passando para gente: estado primeiro, depois o texto fixo
 *  (quando há o que dizer ao cliente) e o recado à equipe. */
async function passarParaHumano(
  s: SessaoInvestidor, ctx: Contexto, motivo: string, titulo: string,
  opts: { falarComOCliente: boolean; extra?: string },
): Promise<void> {
  const nova: SessaoInvestidor = { ...s, estagio: 'humano', motivo, ate: ctx.ultima };
  await gravarSessao(ctx.chave, nova);
  if (opts.falarComOCliente) {
    try {
      await sendHuman(s.telefone, [textoPassagem(ctx.chave)], 'io', { maxBolhas: 2 });
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'texto de passagem não saiu', { erro: String(e) });
    }
  }
  if (await avisarEquipe(nova, titulo, ctx.novas, opts.extra ?? '')) ctx.res.passadas++;
}

/** Manda a lista de horários. `excluir` tira os que a pessoa já recusou. */
async function oferecerHorarios(
  s: SessaoInvestidor, ctx: Contexto, opts: { foiOcupado?: boolean } = {},
): Promise<void> {
  if ((s.ofertas_feitas ?? 0) >= MAX_OFERTAS) {
    await passarParaHumano(s, ctx, 'muitas_ofertas', 'NENHUM HORÁRIO SERVIU', { falarComOCliente: true });
    return;
  }
  const agora = Date.now();
  const compromissos = await carregarCompromissos(new Date(agora).toISOString(), new Date(agora + 22 * 86_400_000).toISOString());
  const horarios = compromissos ? horariosDaOferta(s.consultor, compromissos, agora, s.oferta ?? []) : [];
  if (horarios.length < 4) {
    await passarParaHumano(s, ctx, compromissos ? 'sem_vaga' : 'sem_leitura_da_agenda', 'QUER HORÁRIO E NÃO ACHEI 4 LIVRES', { falarComOCliente: true });
    return;
  }
  // Estado primeiro: a oferta fica gravada antes de a lista sair.
  const nova: SessaoInvestidor = {
    ...s, estagio: 'ofertou', oferta: horarios, ofertas_feitas: (s.ofertas_feitas ?? 0) + 1,
    ate: ctx.ultima, respostas: (s.respostas ?? 0) + 1,
  };
  await gravarSessao(ctx.chave, nova);
  try {
    // UMA bolha, com as 4 linhas numeradas inteiras (o teto de 900 não corta).
    await sendHuman(s.telefone, [textoOferta(ctx.chave, horarios, opts)], 'io', { maxBolhas: 1, max: 900 });
    ctx.res.respondidas++;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'a lista de horários não saiu', { erro: String(e) });
    await passarParaHumano(nova, ctx, 'erro_envio_oferta', 'QUER HORÁRIO E A LISTA NÃO SAIU', { falarComOCliente: false });
  }
}

/** Grava o card do horário escolhido. Horário tomado no meio do caminho vira
 *  lista nova. */
async function agendar(s: SessaoInvestidor, ctx: Contexto, iso: string): Promise<void> {
  const muitoPerto = new Date(iso).getTime() < Date.now() + 30 * 60_000;
  // AGENDA FECHADA: a mesma última porta do POST /agendar da LP. Entre oferecer e
  // a pessoa responder passam horas, e nesse meio-tempo o dia pode ter sido
  // fechado (sócios fora). Dia fechado é tratado como horário ocupado.
  if (muitoPerto || agendaFechadaNoIso(iso) || !(await aindaLivre(iso, s.consultor))) {
    await oferecerHorarios(s, ctx, { foiOcupado: true });
    return;
  }
  const ficha: Record<string, unknown> = {
    vendedor_nome: s.consultor,
    quando: iso,
    cliente_nome: (s.nome || 'Investidor sem nome').slice(0, 120),
    cliente_telefone: s.telefone,
    cidade: (s.dados?.cidade || s.cidade || '').trim().slice(0, 120) || null,
    status: 'agendado',
    temperatura: 'morno',
    observacao: montarObservacao({
      valorTxt: s.valor_txt, dados: s.dados ?? {}, cidadeDoCadastro: s.cidade,
      origem: s.origem, id: s.id, cadastroEm: s.cadastro_em, resumo: s.resumo,
    }),
    // Origem própria. Os eventos do Meta (Schedule, LeadQuente) moram na rota da
    // LP e não saem daqui: reunião marcada por robô não é conversão de anúncio.
    created_by: ORIGEM_AGENTE_EP,
    src: null,
  };
  let gravado: { id: number | null; bloqueado: boolean };
  try {
    gravado = await gravarCardEletroposto(ficha);
  } catch (err) {
    // 23505 = o índice de horário: alguém marcou aquele horário neste intervalo.
    if (String((err as { code?: string })?.code) === '23505') {
      await oferecerHorarios(s, ctx, { foiOcupado: true });
      return;
    }
    logger.error(LOG, 'gravar o card falhou', err);
    await passarParaHumano(s, ctx, 'erro_gravar_card', 'ESCOLHEU HORÁRIO E O CARD NÃO GRAVOU', {
      falarComOCliente: true, extra: `*Horário escolhido:* ${horarioCurto(iso)}. Marque à mão.`,
    });
    return;
  }
  if (gravado.bloqueado) {
    // FORA DO PADRÃO: nenhuma ficha nasce para este telefone, e ninguém escreve.
    await gravarSessao(ctx.chave, { ...s, estagio: 'sem_interesse', motivo: 'fora_do_padrao', ate: ctx.ultima });
    return;
  }
  await gravarSessao(ctx.chave, {
    ...s, estagio: 'agendado', agendamento_id: gravado.id, motivo: null, oferta: [], ate: ctx.ultima,
    respostas: (s.respostas ?? 0) + 1,
  });
  await marcarCadastro(s, 'conectado');
  ctx.res.agendadas++;
  logger.info(LOG, `reunião marcada (card ${gravado.id}, ${s.consultor}, ${horarioCurto(iso)})`);
  try {
    await sendHuman(s.telefone, [textoConfirmacao(ctx.chave, iso, s.consultor)], 'io', { maxBolhas: 2 });
    ctx.res.respondidas++;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'a confirmação não saiu (o card está gravado)', { card: gravado.id, erro: String(e) });
  }
}

/** Uma conversa, com a vez já reivindicada. */
async function atender(s0: SessaoInvestidor, ctx: Contexto, desligada: boolean): Promise<void> {
  let s = s0;
  const textos = ctx.novas.map(m => String(m.texto || '').trim()).filter(Boolean);

  // Primeira resposta da pessoa: o cadastro passa para "falando".
  if (s.estagio === 'chamado') {
    await marcarCadastro(s, 'falando');
    s = { ...s, estagio: 'conversando' };
  }

  // Resposta velha demais (o relógio falhou por mais de uma hora), agente
  // desligada ou conversa longa demais: ninguém responde por robô, vai para gente.
  if (Date.now() - Date.parse(ctx.ultima) > RESPOSTA_VIVA_MS) {
    await passarParaHumano(s, ctx, 'resposta_atrasada', 'RESPONDEU E FICOU SEM RESPOSTA', { falarComOCliente: false });
    return;
  }
  if (desligada) {
    await passarParaHumano(s, ctx, 'agente_desligada', 'RESPONDEU COM A AGENTE DESLIGADA', { falarComOCliente: false });
    return;
  }
  if ((s.respostas ?? 0) >= MAX_RESPOSTAS) {
    await passarParaHumano(s, ctx, 'conversa_longa', 'CONVERSA LONGA, PRECISA DE VOCÊ', { falarComOCliente: true });
    return;
  }

  // Pedido de parada escrito com todas as letras ("pare", "me tira da lista") não
  // depende da IA: se ela estiver fora do ar, o opt-out sai do mesmo jeito.
  if (pediuParar(textos)) {
    await parar(s, ctx);
    return;
  }

  // Escolheu um dos 4 horários: agenda direto, sem IA. SÓ o número solto vale
  // ("2", " 2 ", "2.", "opção 2"). Quem CITA o horário pode estar recusando
  // ("10h não consigo, tem outro?"), e isso é conversa para a IA, que pode pedir
  // outra lista. Bloqueante da revisão de 11/10/2026: recusa virava reunião.
  if (s.estagio === 'ofertou' && s.oferta?.length) {
    const idx = escolhaPorNumero(textos, s.oferta.length);
    if (idx !== null && idx >= 0) {
      await agendar(s, ctx, s.oferta[idx]!);
      return;
    }
    if (idx === -1) {
      // Número solto que não está na lista ("7"): pede o número de 1 a 4.
      await gravarSessao(ctx.chave, { ...s, ate: ctx.ultima, respostas: (s.respostas ?? 0) + 1 });
      try {
        await sendHuman(s.telefone, [textoNaoEntendi(ctx.chave)], 'io', { maxBolhas: 2 });
        ctx.res.respondidas++;
      } catch (e) {
        ctx.res.erros++;
        logger.error(LOG, 'pedido do número não saiu', { erro: String(e) });
      }
      return;
    }
    // Qualquer outra coisa (pergunta, "nenhum serve") segue para a IA, que sabe
    // que a lista está em aberto.
  }

  // A conversa: as últimas 20 mensagens da linha com esta pessoa, já lidas e
  // conferidas pela chave exata antes de a vez ser gasta (ver lerHistorico).
  const historico = [...ctx.historico];
  // A abertura tem que estar na conversa que a IA lê. Se o registro da linha
  // ainda não trouxe nenhuma fala nossa desde a abertura (ele atrasa), ela entra
  // aqui, do jeito que foi enviada e no lugar dela. Abertura cujo envio FALHOU
  // nunca entra: a IA não pode achar que disse o que não saiu.
  const desdeAAbertura = new Date(Date.parse(s.aberto_em) - 2 * 60_000).toISOString();
  if (!s.erro && !historico.some(m => m.from_me && m.momment >= desdeAAbertura)) {
    historico.push({
      from_me: true, tipo: 'texto', momment: s.aberto_em,
      texto: textoDaAbertura(s.abertura, s.nome, s.valor_txt),
    });
    historico.sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0));
  }

  const sistema = montarSistema({ nome: s.nome, valorTxt: s.valor_txt, cidade: s.cidade, consultor: s.consultor, oferta: s.estagio === 'ofertou' ? s.oferta : [], dados: s.dados ?? {} });
  const pedido = montarPedido(historico, ctx.novas);
  let saida = await perguntar(sistema, pedido);

  // IA falhou ou devolveu algo fora do combinado: não responde nada ao cliente,
  // avisa o consultor e a sessão vira `humano`.
  if (!saida.valido) {
    ctx.res.erros++;
    await passarParaHumano(s, ctx, 'ia_falhou', 'RESPONDEU E A IA NÃO SOUBE RESPONDER', { falarComOCliente: false });
    return;
  }

  // TRAVA DE CONTEÚDO. Resposta que promete rendimento, cita percentual, fala em
  // cota ou põe site não sai. O modelo ganha UMA chance de reescrever, sabendo
  // qual regra quebrou; se quebrar de novo, a conversa vai para o consultor.
  if (saida.acao === 'continuar') {
    const quebra = violaRegras(saida.bolhas);
    if (quebra) {
      logger.warn(LOG, `resposta da IA barrada (${quebra}): pedindo para reescrever`);
      const segunda = await perguntar(sistema, pedidoDeReescrita(pedido, quebra, saida.bolhas));
      const quebrouDeNovo = !segunda.valido
        ? 'a reescrita não veio no formato combinado'
        : segunda.acao === 'continuar' ? violaRegras(segunda.bolhas) : null;
      if (quebrouDeNovo) {
        logger.warn(LOG, `a reescrita também foi barrada: ${quebrouDeNovo}`);
        await passarParaHumano(s, ctx, 'resposta_barrada', 'RESPONDEU E A RESPOSTA DA IA FOI BARRADA', {
          falarComOCliente: false, extra: `*Motivo:* ${quebra}; na reescrita, ${quebrouDeNovo}.`,
        });
        return;
      }
      saida = segunda;
    }
  }
  s = { ...s, dados: juntarDados(s.dados, saida.dados), resumo: saida.resumo || s.resumo };

  if (saida.acao === 'continuar') {
    // Estado primeiro. Sem bolha (só "ok", "obrigado") ela não responde.
    await gravarSessao(ctx.chave, { ...s, ate: ctx.ultima, respostas: (s.respostas ?? 0) + (saida.bolhas.length ? 1 : 0) });
    if (!saida.bolhas.length) return;
    try {
      await sendHuman(s.telefone, saida.bolhas, 'io', { maxBolhas: 2 });
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'falha ao responder', { erro: String(e) });
    }
    return;
  }

  // Nas quatro ações abaixo sai o texto fixo do redator. As bolhas do modelo são
  // ignoradas, para não sair mensagem dobrada.
  if (saida.acao === 'oferecer_horarios') {
    await oferecerHorarios(s, ctx);
    return;
  }
  if (saida.acao === 'humano') {
    await passarParaHumano(s, ctx, 'pediu_humano', 'QUER FALAR COM VOCÊ', { falarComOCliente: true });
    return;
  }
  if (saida.acao === 'sem_interesse') {
    await gravarSessao(ctx.chave, { ...s, estagio: 'sem_interesse', motivo: 'disse_nao', ate: ctx.ultima });
    await marcarCadastro(s, 'sem_interesse');
    try {
      await sendHuman(s.telefone, [textoDespedida(ctx.chave)], 'io', { maxBolhas: 2 });
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'a despedida não saiu', { erro: String(e) });
    }
    return;
  }
  await parar(s, ctx);
}

/** Pediu para parar: o opt-out da casa (whatsapp_suppression), a sessão fechada
 *  e o carimbo que alimenta o disjuntor. Só depois a confirmação. */
async function parar(s: SessaoInvestidor, ctx: Contexto): Promise<void> {
  await silenciarContato(s.telefone, 'opt_out', LOG);
  await gravarSessao(ctx.chave, { ...s, estagio: 'sem_interesse', motivo: 'pediu_parar', ate: ctx.ultima });
  const em = new Date().toISOString();
  await supabase.from('system_state')
    .upsert({ key: `${INV_PARAR_PREFIX}${dataBrasilia(new Date())}:${ctx.chave}`, value: { em }, updated_at: em }, { onConflict: 'key' })
    .then(undefined, (e: unknown) => logger.error(LOG, 'carimbo de parada falhou', e));
  try {
    await sendHuman(s.telefone, [textoParou(ctx.chave)], 'io', { maxBolhas: 2 });
    ctx.res.respondidas++;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'a confirmação de parada não saiu', { erro: String(e) });
  }
}

/**
 * Quem respondeu à Helena. Roda SEMPRE, com a agente ligada ou não: com ela
 * desligada ninguém recebe resposta de robô, mas a mensagem do investidor vira
 * recado para o consultor em vez de ficar parada.
 */
export async function runInvestidorRespostasTick(): Promise<ResultadoRespostas> {
  const agora = Date.now();
  let sessoes: Map<string, SessaoInvestidor>;
  try {
    sessoes = await lerSessoes();
  } catch (err) {
    logger.error(LOG, 'ler as sessões falhou', err);
    return { ...semResposta('erro_sessoes'), erros: 1 };
  }
  // A mesma régua que os outros robôs leem (sessaoEhDaHelena): abertura que
  // falhou e `chamado` sem resposta há mais de 10 dias já não são dela, e aí
  // quem atende é a recepção. As duas pontas não podem discordar.
  const ativas = [...sessoes.entries()].filter(([, s]) => sessaoEhDaHelena(s, agora) && s.telefone);
  if (!ativas.length) return semResposta('sem_conversa_ativa');

  // O que chegou na linha destas pessoas desde o que já foi lido. Filtrado por
  // telefone no servidor e paginado: consulta crescente truncada só vê o passado.
  const piso = ativas.map(([, s]) => s.ate || s.aberto_em).sort()[0]!;
  const teto = new Date(agora - ESPERA_MS).toISOString();
  const fones = [...new Set(ativas.flatMap(([, s]) => variantes(s.telefone)))];
  const entrada: Array<MsgDaConversa & { telefone: string }> = [];
  try {
    for (let i = 0; i < fones.length; i += 120) {
      const lote = fones.slice(i, i + 120);
      entrada.push(...await lerTudo<MsgDaConversa & { telefone: string }>('respostas na linha', (de, ate) =>
        supabase.from('wa_mensagens').select('telefone, texto, tipo, momment, from_me')
          .eq('from_me', false).eq('is_group', false).eq('instancia', INSTANCE_ID_IO)
          .in('telefone', lote).gte('momment', piso).lte('momment', teto)
          .order('momment', { ascending: true }).range(de, ate)));
    }
  } catch (err) {
    logger.error(LOG, 'ler a linha falhou', err);
    return { ...semResposta('erro_linha'), erros: 1 };
  }

  const novasDe = new Map<string, MsgDaConversa[]>();
  for (const m of entrada.sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0))) {
    const k = chaveContato(m.telefone);
    const s = k ? sessoes.get(k) : undefined;
    if (!k || !s || !sessaoEhDaHelena(s, agora)) continue;
    if (m.momment <= (s.ate || s.aberto_em)) continue;
    if (!novasDe.has(k)) novasDe.set(k, []);
    novasDe.get(k)!.push(m);
  }
  if (!novasDe.size) return semResposta('ninguem_escreveu');

  const [silenciado, chaveOff] = await Promise.all([carregarSilenciados(), lerChaveDesligar()]);
  const res = semResposta();
  let feitas = 0;

  for (const [chave, todas] of novasDe) {
    if (feitas >= POR_TICK) break;
    const s = sessoes.get(chave)!;
    const ultima = todas[todas.length - 1]!.momment;
    // Mensagem automática do outro lado (atendente de IA, ausência) não é a
    // pessoa: sai da leva. Sobrando só isso, a leitura anda e ninguém responde.
    const novas = todas.filter(m => pareceRoboDeles(String(m.texto || '')).nivel !== 'certeza');
    const ctx: Contexto = { chave, novas, ultima, res, historico: [] };

    // Leituras ANTES de reivindicar a vez: se uma falhar, a leva fica para a
    // próxima chamada em vez de se perder.
    let card: number | null;
    try {
      card = await cardDoTelefone(s.telefone);
    } catch (err) {
      res.erros++;
      logger.error(LOG, 'conferir card falhou: a leva fica para a próxima chamada', err);
      continue;
    }
    const pausa = await podeFalarComLead(s.telefone);

    // A conversa, lida ANTES da vez. Se a leitura falhar, ela não responde e a
    // vez NÃO é gasta: a próxima chamada tenta de novo. Na terceira falha
    // seguida a conversa vai para gente (mais abaixo, já com a vez na mão).
    let semHistorico = false;
    if (novas.length) {
      try {
        ctx.historico = await lerHistorico(chave, s.telefone, novas[0]!.momment);
      } catch (err) {
        const falhas = (s.falhas_historico ?? 0) + 1;
        res.erros++;
        logger.error(LOG, `ler a conversa falhou (${falhas}ª vez seguida, final ${s.telefone.slice(-2)})`, err);
        if (falhas < FALHAS_DE_HISTORICO_ATE_PASSAR) {
          await gravarSessao(chave, { ...s, falhas_historico: falhas })
            .catch(e => logger.error(LOG, 'anotar a falha de leitura não gravou', e));
          continue;
        }
        semHistorico = true;
      }
    }

    // A vez: chave única por pessoa e última mensagem. Duas chamadas nunca
    // respondem a mesma leva.
    const { error: eVez } = await supabase.from('system_state')
      .insert({ key: `${INV_VEZ_PREFIX}${chave}:${ultima}`, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() });
    if (eVez) continue;
    feitas++;

    try {
      if (silenciado(s.telefone)) {
        // Pediu para parar por outra trilha: a conversa fecha em silêncio.
        await gravarSessao(chave, { ...s, estagio: 'sem_interesse', motivo: 'opt_out_por_outra_trilha', ate: ultima });
        continue;
      }
      if (!pausa.pode) {
        // Humano entrou na conversa: a agente cala e a sessão vira `humano`.
        await registrarBloqueio(s.telefone, LOG);
        await gravarSessao(chave, { ...s, estagio: 'humano', motivo: 'humano_entrou', ate: ultima });
        continue;
      }
      if (card !== null) {
        // Ganhou card por outra porta (marcou pela página, o consultor cadastrou):
        // daqui em diante quem responde é a régua da agenda, não a Helena.
        await gravarSessao(chave, { ...s, estagio: 'agendado', agendamento_id: card, motivo: 'card_por_outra_porta', ate: ultima });
        continue;
      }
      if (!novas.length) {
        await gravarSessao(chave, { ...s, ate: ultima });
        continue;
      }
      if (semHistorico) {
        await passarParaHumano({ ...s, falhas_historico: 0 }, ctx, 'historico_ilegivel', 'RESPONDEU E NÃO CONSEGUI LER A CONVERSA', { falarComOCliente: false });
        continue;
      }
      await atender({ ...s, falhas_historico: 0 }, ctx, chaveOff.off);
    } catch (err) {
      // A vez já foi gasta: esta leva não volta sozinha. Então ela vai para gente.
      res.erros++;
      logger.error(LOG, `atender falhou (final ${s.telefone.slice(-4)})`, err);
      await passarParaHumano(s, ctx, 'erro_interno', 'RESPONDEU E DEU ERRO NA AGENTE', { falarComOCliente: false })
        .catch(e => logger.error(LOG, 'nem o recado de erro saiu', e));
    }
  }

  if (res.respondidas || res.agendadas || res.passadas) {
    logger.info(LOG, `${res.respondidas} resposta(s), ${res.agendadas} reunião(ões), ${res.passadas} passada(s) para o consultor`);
  }
  return res;
}

// ═════════════════════════════════════════════════════════════════════════════
// A RODADA: o que a rota do cron chama.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Trava de chamada sobreposta. Um insert por balde de 5 minutos (UTC): quem
 * chega depois no mesmo balde leva 23505 e sai sem fazer nada. Cobre o cron da
 * Vercel disparando em dobro e uma chamada à mão caindo junto com ele.
 *
 * Sem conseguir gravar a trava, a rodada também não roda: na dúvida, não fala.
 */
export async function reivindicarRodada(agora: number = Date.now()): Promise<{ ok: boolean; motivo?: string }> {
  const balde = new Date(Math.floor(agora / BALDE_DO_LOCK_MS) * BALDE_DO_LOCK_MS).toISOString().slice(0, 16);
  const key = `${INV_LOCK_PREFIX}${balde}`;
  const em = new Date(agora).toISOString();
  const { error } = await supabase.from('system_state').insert({ key, value: { em }, updated_at: em });
  if (error) {
    if (String((error as { code?: string }).code) === '23505') return { ok: false, motivo: 'outra_chamada_no_mesmo_balde' };
    logger.error(LOG, 'gravar a trava da rodada falhou: rodada suspensa', error);
    return { ok: false, motivo: 'erro_na_trava' };
  }
  // As travas velhas não servem para nada: saem aqui, para a tabela não juntar 288 por dia.
  await supabase.from('system_state').delete().like('key', `${INV_LOCK_PREFIX}%`).lt('key', key)
    .then(undefined, () => {});
  return { ok: true };
}

/**
 * Uma rodada: quem respondeu (até 3 conversas) e depois a abertura (UMA pessoa).
 * As respostas primeiro, porque quem escreveu está esperando. Falha numa metade
 * não impede a outra de rodar os portões dela.
 */
export async function rodarInvestidorAgente(): Promise<Record<string, unknown>> {
  const vez = await reivindicarRodada();
  if (!vez.ok) return { ok: true, pulou: vez.motivo };
  const respostas = await runInvestidorRespostasTick().catch((e) => ({ error: String(e) }));
  const abertura = await runInvestidorAberturaTick().catch((e) => ({ error: String(e) }));
  return { ok: true, respostas, abertura };
}
