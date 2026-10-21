// ─────────────────────────────────────────────────────────────────────────────
// A TAREFA ficha_5040 (A4): todo cliente agendado de Solar e Eletroposto gera UMA ficha, gravada
// no card e enviada no WhatsApp do consultor dono do card.
//
// Roda dentro do /process-messages (pg_cron do banco do gerador, de 2 em 2 minutos), como a
// tarefa `ficha_5040` da lista TAREFAS de routes/cron.ts. Nasce DESLIGADA: o interruptor `ficha`
// (interruptores.ts) liga, e o MESMO interruptor faz os 5 avisos antigos saírem cedo (chaves.ts).
// Este arquivo não importa o zapiClient: o envio é do fichaEnvio.ts.
//
// REGRA DE OURO: nunca zero aviso, nunca dois.
//  · Dois: o aviso antigo que ENVIA (interruptor desligado, ou card que a ficha não cobre) grava
//    `aviso_antigo:<id>` antes de enviar, e esta rodada pula o card com a marca (conferida na leitura e
//    de novo logo antes de reservar). É marca POR CARD: a virada do interruptor e o cache de 60 s não
//    dependem de relógio;
//  · Zero: nenhum card elegível é pulado calado. Sem consultor com telefone (na tabela `consultores` e no
//    mapa dos avisos antigos), a ficha vai ao DONO com o motivo na 1ª linha. Sem telefone do cliente, a
//    ficha vai sem a linha de contato. Reserva travada em `reservada` há mais de 5 min tenta de novo uma
//    vez e, se travar de novo, avisa o dono.
//
// Ordem de cada card (UM por rodada, nunca em paralelo, sem pausa fixa):
//   0. linha 'io' em cooldown? Sai sem reservar;
//   1. reserva por INSERT `ficha_card:<id>` e depois `ficha_lead:<hmac(chave|produto|consultor)>`
//      (30 dias). O banco escolhe quem passa: 23505 = outro chamador, ou outro card do mesmo cliente,
//      produto e consultor, já cuidou. Telefone nunca vai ao system_state: a chave do lead é HMAC;
//   2. monta a ficha (Sonnet; sem IA, só os campos do card);
//   3. GRAVA NO CARD antes de enviar (estado primeiro, mensagem depois);
//   4. envia UMA bolha pela linha 'io'. A 1ª falha PARA a rodada. Erro que prova que nada saiu
//      (cooldown, credencial ausente) devolve a reserva a pendente; 5xx e timeout são finais (podem ter
//      saído, e tentar de novo mandaria duas).
// O carimbo é a própria reserva `ficha_card:<id>`. Prefixo fora de BOT_SENT_PREFIXES e nunca `aviso_sent:`.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { hmacDe } from './hmac';
import { fichaConsultorLigada, fichaCobre, chaveAvisoAntigo, ORIGENS_COM_FICHA } from './chaves';
import { ligado } from './interruptores';
import { lerConversa, montarContexto } from './contexto';
import {
  aplicarBloco, blocoSeguro, escreverFichaNoCard, fichaDeCampos, linkDaConversa, montarFicha, produtoDoCard, semBloco, textoDaMensagem,
  type CardDaFicha, type ResultadoEscrita,
} from './ficha';
import {
  carregarTelefonesConsultores, enviarFichaAoConsultor, erroProvaQueNaoSaiu, linhaIoEmCooldown, telefoneDoConsultor, telefoneDoDono,
} from './fichaEnvio';
import type { ContextoLead } from './tipos';

const JANELA_MIN = 360;                // cards das últimas 6 horas (uma ficha por rodada: uma rajada precisa de folga)
const BANDA_PERDIDO_MIN = 60;          // a hora logo depois da janela: card coberto que passou por aqui sem reserva nem marca foi PERDIDO
const IDADE_MINIMA_S = 45;             // o card nasce e é completado por outros passos; espera um pouco
const MAX_POR_TICK = 1;                // uma ficha por rodada: a linha não leva rajada de aviso
const DIAS_RESERVA_LEAD = 30;
const TRAVADA_APOS_MIN = 5;            // reserva em `reservada` há mais que isto está presa
const COLUNAS_CARD = 'id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade, observacao, created_by, created_at, status, temperatura';

export const chaveFichaCard = (id: number | string): string => `ficha_card:${id}`;
export const chaveFichaLead = (hmacDaChave: string): string => `ficha_lead:${hmacDaChave}`;

const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);
const semAcento = (s: unknown): string => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── reservas (system_state, sem dado pessoal) ────────────────────────────────

export type Reserva = 'ok' | 'ja' | 'erro';

async function reservar(chave: string, valor: Record<string, unknown>, agora: Date): Promise<Reserva> {
  const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: agora.toISOString() });
  if (!error) return 'ok';
  return (error as { code?: string }).code === '23505' ? 'ja' : 'erro';
}

/**
 * A reserva do lead vale 30 dias. Chave que já existe e é mais velha que isso é RETOMADA por um update
 * condicional (um comando só no banco: dois chamadores não ganham os dois). Chave que já existe e é DESTE
 * card (a segunda tentativa de uma reserva travada) também passa.
 */
async function reservarLead(chave: string, cardId: number, agora: Date): Promise<Reserva> {
  const valor = { em: agora.toISOString(), card: cardId };
  const r = await reservar(chave, valor, agora);
  if (r !== 'ja') return r;
  const lida = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
  if ((lida.data as { value?: { card?: number } } | null)?.value?.card === cardId) return 'ok';
  const corte = new Date(agora.getTime() - DIAS_RESERVA_LEAD * 86_400_000).toISOString();
  const { data, error } = await supabase.from('system_state')
    .update({ value: valor, updated_at: agora.toISOString() })
    .eq('key', chave).lt('updated_at', corte).select('key');
  if (error) return 'erro';
  return Array.isArray(data) && data.length > 0 ? 'ok' : 'ja';
}

async function atualizarEstado(chave: string, valor: Record<string, unknown>, agora: Date): Promise<void> {
  const { error } = await supabase.from('system_state').update({ value: valor, updated_at: agora.toISOString() }).eq('key', chave);
  if (error) logger.error('ficha-5040', `não consegui gravar o estado de ${chave}`, error);
}

/** Troca o estado só se a reserva continua velha: quem chega primeiro leva (um comando só no banco). */
async function assumirReservaTravada(chave: string, valor: Record<string, unknown>, agora: Date): Promise<boolean> {
  const corte = new Date(agora.getTime() - TRAVADA_APOS_MIN * 60_000).toISOString();
  const { data, error } = await supabase.from('system_state')
    .update({ value: valor, updated_at: agora.toISOString() }).eq('key', chave).lt('updated_at', corte).select('key');
  return !error && Array.isArray(data) && data.length > 0;
}

// ── a rodada ─────────────────────────────────────────────────────────────────

export type ResultadoCard =
  | 'enviada' | 'falha_envio' | 'devolvida' | 'ja_tratado' | 'lead_ja_avisado' | 'aviso_antigo' | 'erro_reserva'
  | 'linha_em_cooldown' | 'presa_avisada' | 'perdido_avisado' | 'perdido'
  /** Só no ?dry=1: o que a rodada faria com o card. */
  | 'pendente' | 'travada';

export interface ItemDaRodada {
  id: number;
  resultado: ResultadoCard;
  origem_da_ficha?: 'ia' | 'campos';
  card_gravado?: boolean;
  /** Quem recebeu: o consultor dono do card, ou o dono (quando o consultor não tem telefone). */
  destino?: 'consultor' | 'dono';
}

export interface ResultadoDaRodada {
  rodou: boolean;
  motivo?: 'desligada' | 'sem_segredo' | 'erro_leitura';
  ligada: boolean;
  dry: boolean;
  candidatos: number;
  itens: ItemDaRodada[];
}

export interface OpcoesDaRodada {
  dry?: boolean;
  agora?: Date;
  semIA?: boolean;
}

async function lerCandidatos(agora: Date, banda = false): Promise<{ ok: true; cards: CardDaFicha[] } | { ok: false }> {
  const janela = new Date(agora.getTime() - JANELA_MIN * 60_000).toISOString();
  const piso = banda ? new Date(agora.getTime() - (JANELA_MIN + BANDA_PERDIDO_MIN) * 60_000).toISOString() : janela;
  let q = supabaseGerador.from('agendamentos').select(COLUNAS_CARD)
    .in('created_by', [...ORIGENS_COM_FICHA]).gte('created_at', piso);
  if (banda) q = q.lt('created_at', janela);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(200);
  if (error) { logger.error('ficha-5040', 'leitura dos cards falhou', error); return { ok: false }; }
  const corteIdade = agora.getTime() - IDADE_MINIMA_S * 1000;
  const cards = ((data ?? []) as CardDaFicha[]).filter(c => fichaCobre(c) && Date.parse(String(c.created_at ?? '')) <= corteIdade);
  return { ok: true, cards };
}

interface EstadoReserva { estado: string; atualizadoEm: number; retry: boolean; alerta: boolean }

async function lerReservas(ids: readonly number[]): Promise<Map<number, EstadoReserva>> {
  const mapa = new Map<number, EstadoReserva>();
  if (!ids.length) return mapa;
  const { data } = await supabase.from('system_state').select('key, value, updated_at').in('key', ids.map(chaveFichaCard));
  for (const r of (data ?? []) as Array<{ key: string; value: { estado?: string; retry?: boolean; alerta?: boolean } | null; updated_at: string }>) {
    mapa.set(Number(r.key.slice('ficha_card:'.length)), {
      estado: String(r.value?.estado ?? ''), atualizadoEm: Date.parse(r.updated_at) || 0,
      retry: r.value?.retry === true, alerta: r.value?.alerta === true,
    });
  }
  return mapa;
}

async function lerAvisosAntigos(ids: readonly number[]): Promise<Set<number>> {
  const feitos = new Set<number>();
  if (!ids.length) return feitos;
  const { data } = await supabase.from('system_state').select('key').in('key', ids.map(chaveAvisoAntigo));
  for (const r of (data ?? []) as Array<{ key: string }>) feitos.add(Number(r.key.slice('aviso_antigo:'.length)));
  return feitos;
}

async function temAvisoAntigo(id: number): Promise<boolean> {
  const { data } = await supabase.from('system_state').select('key').eq('key', chaveAvisoAntigo(id)).maybeSingle();
  return !!data;
}

async function lerContexto(chave: string, agora: Date): Promise<ContextoLead | null> {
  try {
    const conv = await lerConversa(chave);
    // Leitura que falhou sem trazer nada NÃO é "cliente ainda não escreveu": ficha só com os campos.
    if (!conv.completa && conv.msgs.length === 0) return null;
    return await montarContexto(chave, conv, { agora: agora.toISOString() });
  } catch {
    return null;
  }
}

type Situacao = 'pendente' | 'travada_retry' | 'travada_alerta' | 'ja_tratado';

function situacaoDe(r: EstadoReserva | undefined, agora: Date): Situacao {
  if (!r) return 'pendente';
  const presa = r.estado === 'reservada' && agora.getTime() - r.atualizadoEm > TRAVADA_APOS_MIN * 60_000;
  if (!presa) return 'ja_tratado';
  if (!r.retry) return 'travada_retry';
  return r.alerta ? 'ja_tratado' : 'travada_alerta';
}

/**
 * Card coberto que saiu da janela de 6 h sem reserva nem marca `aviso_antigo` (rajada que passou da
 * capacidade de uma ficha por rodada) NÃO fica calado: o dono recebe UM aviso com o id, reservado por insert
 * `ficha_perdido:<id>`. Um por rodada. Só olha a hora logo depois da janela.
 */
async function avisarPerdido(agora: Date, dry: boolean, itens: ItemDaRodada[]): Promise<void> {
  const lidos = await lerCandidatos(agora, true);
  if (!lidos.ok || !lidos.cards.length) return;
  const ids = lidos.cards.map(c => c.id);
  const reservas = await lerReservas(ids);
  const antigos = await lerAvisosAntigos(ids);
  const { data } = await supabase.from('system_state').select('key').in('key', ids.map(id => `ficha_perdido:${id}`));
  const avisados = new Set(((data ?? []) as Array<{ key: string }>).map(r => Number(r.key.slice('ficha_perdido:'.length))));
  for (const c of lidos.cards) {
    if (reservas.has(c.id) || antigos.has(c.id) || avisados.has(c.id)) continue;
    if (dry) { itens.push({ id: c.id, resultado: 'perdido' }); continue; }
    if (linhaIoEmCooldown()) return;
    if ((await reservar(`ficha_perdido:${c.id}`, { em: agora.toISOString() }, agora)) !== 'ok') continue;
    try {
      await enviarFichaAoConsultor(telefoneDoDono(), `Ficha perdida: o card ${c.id} saiu da janela de 6 horas sem aviso nenhum. Avise o consultor pelo CRM.`);
      itens.push({ id: c.id, resultado: 'perdido_avisado', destino: 'dono' });
    } catch (err) {
      logger.error('ficha-5040', `card ${c.id}: o aviso de ficha perdida ao dono falhou`, err);
      if (erroProvaQueNaoSaiu(err)) await supabase.from('system_state').delete().eq('key', `ficha_perdido:${c.id}`);
    }
    return;                                   // um por rodada
  }
}

export async function runFichaConsultorTick(opts: OpcoesDaRodada = {}): Promise<ResultadoDaRodada> {
  const r = await rodarFicha(opts);
  // Rodada sem envio de ficha: aproveita para conferir quem passou da janela sem aviso.
  const ocupada = r.itens.some(i => ['enviada', 'falha_envio', 'devolvida', 'presa_avisada', 'linha_em_cooldown'].includes(i.resultado));
  if (r.rodou && r.ligada !== false && (r.dry || !ocupada)) {
    try { await avisarPerdido(opts.agora ?? new Date(), !!opts.dry, r.itens); } catch (err) { logger.error('ficha-5040', 'conferência dos perdidos falhou', err); }
  }
  return r;
}

async function rodarFicha(opts: OpcoesDaRodada): Promise<ResultadoDaRodada> {
  const dry = !!opts.dry;
  const agora = opts.agora ?? new Date();
  const ligada = await fichaConsultorLigada();
  const vazio = (extra: Partial<ResultadoDaRodada>): ResultadoDaRodada =>
    ({ rodou: false, ligada, dry, candidatos: 0, itens: [], ...extra });

  // Desligada, a rodada não escreve NADA (nem marca de horário): o aviso antigo é quem cuida do card.
  if (!ligada && !dry) return vazio({ motivo: (await ligado('ficha')) ? 'sem_segredo' : 'desligada' });
  if (!hmacDe('ficha-5040')) return vazio({ motivo: 'sem_segredo' });

  const lidos = await lerCandidatos(agora);
  if (!lidos.ok) return vazio({ motivo: 'erro_leitura' });
  const ids = lidos.cards.map(c => c.id);
  const reservas = await lerReservas(ids);
  const antigos = await lerAvisosAntigos(ids);

  const itens: ItemDaRodada[] = [];
  const fila: Array<{ card: CardDaFicha; situacao: Situacao }> = [];
  for (const card of lidos.cards) {
    if (antigos.has(card.id)) { itens.push({ id: card.id, resultado: 'aviso_antigo' }); continue; }
    const sit = situacaoDe(reservas.get(card.id), agora);
    if (sit === 'ja_tratado') { itens.push({ id: card.id, resultado: 'ja_tratado' }); continue; }
    fila.push({ card, situacao: sit });
  }
  const resumo = (): ResultadoDaRodada => ({ rodou: true, ligada, dry, candidatos: lidos.cards.length, itens });
  // ?dry=1: só ids e estado. Nenhum campo do card, nome ou cidade sai daqui.
  if (dry) {
    for (const f of fila) itens.push({ id: f.card.id, resultado: f.situacao === 'pendente' ? 'pendente' : 'travada' });
    return resumo();
  }
  if (!fila.length) return resumo();

  const telefones = await carregarTelefonesConsultores();
  const mapaTabela: ReadonlyMap<string, string> = telefones.ok ? telefones.mapa : new Map();
  if (!telefones.ok) logger.error('ficha-5040', `leitura da tabela consultores falhou (${telefones.codigo}); uso o mapa de reserva`);

  let tratados = 0;
  for (const { card, situacao } of fila) {
    if (tratados >= MAX_POR_TICK) break;
    // 0. A linha em cooldown não leva nada: sai sem reservar (o card segue pendente na próxima rodada).
    if (linhaIoEmCooldown()) { itens.push({ id: card.id, resultado: 'linha_em_cooldown' }); break; }
    // A marca do aviso antigo pode ter nascido depois da leitura da rodada.
    if (await temAvisoAntigo(card.id)) { itens.push({ id: card.id, resultado: 'aviso_antigo' }); continue; }

    // Reserva travada pela segunda vez: o aviso vai ao dono, com o id e mais nada.
    if (situacao === 'travada_alerta') {
      if (!(await assumirReservaTravada(chaveFichaCard(card.id), { estado: 'presa', retry: true, alerta: true, em: agora.toISOString() }, agora))) {
        itens.push({ id: card.id, resultado: 'ja_tratado' }); continue;
      }
      tratados++;
      try {
        await enviarFichaAoConsultor(telefoneDoDono(), `Ficha presa: o card ${card.id} ficou reservado e não saiu depois de duas tentativas. Confira no CRM e avise o consultor.`);
        itens.push({ id: card.id, resultado: 'presa_avisada', destino: 'dono' });
      } catch (err) {
        logger.error('ficha-5040', `card ${card.id}: o aviso de ficha presa ao dono falhou`, err);
        itens.push({ id: card.id, resultado: 'falha_envio', destino: 'dono' });
        break;
      }
      continue;
    }

    // Destino: o consultor dono do card, ou o dono com o motivo na 1ª linha. Nenhum caso pula o card calado.
    const vendedor = String(card.vendedor_nome ?? '').trim();
    const telCons = telefoneDoConsultor(mapaTabela, vendedor);
    const destino: 'consultor' | 'dono' = telCons ? 'consultor' : 'dono';
    const motivo = telCons ? '' : vendedor
      ? `Sem telefone cadastrado para o consultor ${vendedor.replace(/\s+/g, ' ').slice(0, 40)}.`
      : 'Card sem consultor dono.';
    const telDestino = telCons ?? telefoneDoDono();
    const chave = chaveContato(card.cliente_telefone);
    const hl = chave ? hmacDe(`${chave}|${produtoDoCard(card.created_by)}|${semAcento(vendedor)}`) : null;

    // 1. reservas
    let reservouLead = false;
    if (situacao === 'travada_retry') {
      if (!(await assumirReservaTravada(chaveFichaCard(card.id), { estado: 'reservada', retry: true, em: agora.toISOString() }, agora))) {
        itens.push({ id: card.id, resultado: 'ja_tratado' }); continue;
      }
    } else {
      const r1 = await reservar(chaveFichaCard(card.id), { estado: 'reservada', em: agora.toISOString() }, agora);
      if (r1 === 'ja') { itens.push({ id: card.id, resultado: 'ja_tratado' }); continue; }
      if (r1 === 'erro') { itens.push({ id: card.id, resultado: 'erro_reserva' }); break; }
    }
    if (hl) {
      const r2 = await reservarLead(chaveFichaLead(hl), card.id, agora);
      if (r2 === 'ja') {
        await atualizarEstado(chaveFichaCard(card.id), { estado: 'lead_ja_avisado', em: agora.toISOString() }, agora);
        itens.push({ id: card.id, resultado: 'lead_ja_avisado' });
        continue;
      }
      if (r2 === 'erro') {
        // Nada foi enviado: solta a reserva do card para a próxima rodada tentar de novo.
        await supabase.from('system_state').delete().eq('key', chaveFichaCard(card.id));
        itens.push({ id: card.id, resultado: 'erro_reserva' });
        break;
      }
      reservouLead = true;
    }

    tratados++;
    // 2. monta  3. grava no card  4. envia
    const ctx = chave ? await lerContexto(chave, agora) : null;
    const ficha = await montarFicha(card, ctx, { semIA: opts.semIA });
    const seguras = blocoSeguro(ficha.linhas);
    // Sem telefone do cliente válido, a ficha vai sem a linha de contato.
    const texto = textoDaMensagem(seguras, chave ? card.cliente_telefone : null, motivo ? `${motivo} Encaminhe esta ficha ao consultor certo.` : '');
    const escrita: ResultadoEscrita = await escreverFichaNoCard(card.id, seguras);
    if (!escrita.ok) logger.error('ficha-5040', `card ${card.id}: ficha não gravada no card (${escrita.motivo})`);

    let resultado: ResultadoCard = 'enviada';
    let erroDoEnvio: unknown = null;
    try {
      await enviarFichaAoConsultor(telDestino, texto);
    } catch (err) {
      erroDoEnvio = err;
      resultado = 'falha_envio';
      logger.error('ficha-5040', `card ${card.id}: o envio da ficha falhou`, err);
    }
    if (erroDoEnvio && erroProvaQueNaoSaiu(erroDoEnvio)) {
      // Cooldown ou credencial ausente: nada saiu, a reserva volta a pendente.
      await supabase.from('system_state').delete().eq('key', chaveFichaCard(card.id));
      if (reservouLead && hl) await supabase.from('system_state').delete().eq('key', chaveFichaLead(hl));
      itens.push({ id: card.id, resultado: 'devolvida', origem_da_ficha: ficha.origem, card_gravado: escrita.ok, destino });
      break;
    }
    await atualizarEstado(chaveFichaCard(card.id), {
      estado: resultado, em: new Date().toISOString(), origem: ficha.origem, card_gravado: escrita.ok, destino,
    }, agora);
    itens.push({ id: card.id, resultado, origem_da_ficha: ficha.origem, card_gravado: escrita.ok, destino });
    if (resultado === 'falha_envio') break;       // a 1ª falha PARA a rodada
  }
  return resumo();
}

// ── prova 1: a sonda do card ─────────────────────────────────────────────────

/** As colunas que o trigger trg_eletroposto_estruturar preenche a partir da observacao. */
export const COLUNAS_DERIVADAS = [
  'pontuacao_total', 'nota', 'perfil_slug', 'tem_ponto', 'ponto_relacao', 'capital_faixa', 'decisor_tipo',
  'e_decisor', 'rota_tipo', 'trifasica', 'simulou_kw', 'fluxo_estimado', 'motivo_descarte',
] as const;
/** Colunas que escrever a observacao nunca pode mexer (o repasse de 12h recalcula repassar_em quando `quando` muda). */
export const COLUNAS_GUARDADAS = ['quando', 'vendedor_nome', 'status', 'temperatura', 'repassar_em', 'cliente_nome', 'cliente_telefone', 'cidade', 'created_by'] as const;

/** Linhas hostis: cada uma casaria com o gatilho do banco se passasse crua. Têm que sair do blocoSeguro neutras. */
export const LINHAS_DA_SONDA = [
  'Ficha de teste da sonda, pode ignorar',
  'NOTA 3 · 9/11 pts',
  'Simulou 30 kW com 12 carros/dia',
  'COMPRA DE CARREGADOR',
  'LP ELETROPOSTO — Posto de combustível',
  'Ponto: com local',
  'Como pretende investir: à vista',
  'Decisor: eu',
  'Rota de passagem: sim',
  'Entrada trifásica: Sim',
  'Local é seu: sim',
];

const pegar = (linha: Record<string, unknown> | null, colunas: readonly string[]): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  for (const c of colunas) if (linha && c in linha) o[c] = linha[c] ?? null;
  return o;
};
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface ResultadoSonda {
  ok: boolean;
  card: number;
  trigger_aplica: boolean;
  passos: Record<string, boolean | string | number>;
}

/**
 * Escreve a ficha de TESTE em um card de verdade, confere que a primeira linha e todas as colunas
 * derivadas e guardadas ficaram iguais, e RESTAURA a observacao e as colunas derivadas ao que eram.
 * Quem chama escolhe o card (?sonda=1&card=<id>); o ideal é um card de eletroposto, que é onde o gatilho age.
 */
export async function sondaFichaNoCard(id: number): Promise<ResultadoSonda> {
  const passos: ResultadoSonda['passos'] = {};
  const falha = (motivo: string, trigger = false): ResultadoSonda => ({ ok: false, card: id, trigger_aplica: trigger, passos: { ...passos, motivo } });

  const antes = await supabaseGerador.from('agendamentos').select('*').eq('id', id).maybeSingle();
  if (antes.error || !antes.data) return falha(antes.error ? `leitura_${codigoDe(antes.error)}` : 'card_nao_existe');
  const original = antes.data as Record<string, unknown>;
  const obsOriginal = (original.observacao as string | null) ?? null;
  const trigger = String(original.created_by ?? '').includes('eletroposto');
  const derivadasAntes = pegar(original, COLUNAS_DERIVADAS);
  const guardadasAntes = pegar(original, COLUNAS_GUARDADAS);

  const seguras = blocoSeguro([...LINHAS_DA_SONDA, `Conversa completa: ${linkDaConversa(id)}`]);
  passos.linhas_seguras = seguras.length;
  let escreveu = false;
  try {
    const w = await escreverFichaNoCard(id, seguras);
    escreveu = w.ok;
    passos.escreveu = w.ok;
    if (!w.ok) return falha(`escrita_${w.motivo}`, trigger);

    const depois = await supabaseGerador.from('agendamentos').select('*').eq('id', id).maybeSingle();
    if (depois.error || !depois.data) { passos.leu_depois = false; return falha('leitura_depois', trigger); }
    const novo = depois.data as Record<string, unknown>;
    const obsNova = (novo.observacao as string | null) ?? '';
    passos.primeira_linha_igual = String(obsNova).split('\n')[0] === String(obsOriginal ?? '').split('\n')[0];
    passos.corpo_original_igual = semBloco(obsNova) === semBloco(obsOriginal);
    passos.bloco_no_fim = obsNova.endsWith('FIM DA FICHA') && obsNova.includes('\nFICHA 5040\n');
    passos.derivadas_iguais = igual(pegar(novo, COLUNAS_DERIVADAS), derivadasAntes);
    passos.guardadas_iguais = igual(pegar(novo, COLUNAS_GUARDADAS), guardadasAntes);
    passos.idempotente = aplicarBloco(obsNova, seguras) === obsNova;
  } finally {
    if (escreveu) {
      // Restaura: observacao ao que era e, se o gatilho mexeu em alguma derivada, ela volta ao valor de antes (nulos inclusive).
      let q = supabaseGerador.from('agendamentos').update({ observacao: obsOriginal, ...derivadasAntes }).eq('id', id);
      q = q.like('observacao', '%FIM DA FICHA');
      const r = await q.select('id');
      passos.restaurou_update = !r.error && Array.isArray(r.data) && r.data.length > 0;
      const fim = await supabaseGerador.from('agendamentos').select('*').eq('id', id).maybeSingle();
      const f = (fim.data ?? null) as Record<string, unknown> | null;
      passos.restaurado = !!f && igual(f.observacao ?? null, obsOriginal)
        && igual(pegar(f, COLUNAS_DERIVADAS), derivadasAntes) && igual(pegar(f, COLUNAS_GUARDADAS), guardadasAntes);
    }
  }
  const ok = passos.escreveu === true && passos.primeira_linha_igual === true && passos.corpo_original_igual === true
    && passos.bloco_no_fim === true && passos.derivadas_iguais === true && passos.guardadas_iguais === true
    && passos.idempotente === true && passos.restaurado === true;
  return { ok, card: id, trigger_aplica: trigger, passos };
}

// ── prova 2: uma ficha de teste só para o celular do dono ────────────────────

/**
 * Uma ficha com dados inventados, mandada SÓ ao destino que a rota passa (o celular do dono). Reserva
 * `ficha_teste:<faixa de 15 min>` por insert ANTES de enviar: chamar a rota em laço não vira rajada.
 */
export async function enviarFichaDeTeste(
  destino: string, agora: Date = new Date(),
): Promise<{ enviado: boolean; texto: string; motivo?: 'ja_enviado_nesta_faixa' | 'erro_reserva' }> {
  const faixa = Math.floor(agora.getTime() / (15 * 60_000));
  const r = await reservar(`ficha_teste:${faixa}`, { em: agora.toISOString() }, agora);
  if (r === 'ja') return { enviado: false, texto: '', motivo: 'ja_enviado_nesta_faixa' };
  if (r === 'erro') return { enviado: false, texto: '', motivo: 'erro_reserva' };
  const amanha = new Date(agora.getTime() + 24 * 3600_000);
  amanha.setUTCHours(17, 30, 0, 0);                       // 14h30 em Brasília
  const card: CardDaFicha = {
    id: 0, vendedor_nome: 'Diego', quando: amanha.toISOString(), cliente_nome: 'Marcos (teste)', cidade: 'Uberaba',
    created_by: 'lp_eletroposto', temperatura: null,
    observacao: ['LP ELETROPOSTO · Posto de combustível', 'Ponto: Tenho o local', 'Decisor: Eu decido', 'NOTA 3 · 9/11 pts'].join('\n'),
  };
  const f = fichaDeCampos(card, ['Esta é uma ficha de teste, sem cliente de verdade']);
  const texto = textoDaMensagem(blocoSeguro(f.linhas), null);
  await enviarFichaAoConsultor(destino, texto);
  return { enviado: true, texto };
}
