// ─────────────────────────────────────────────────────────────────────────────
// OS AVISOS DA HELENA AO CONSULTOR (12/11/2026, parecer do chefe anti-ban: NÃO BLOQUEIA com estas condições).
//
//   1. Aviso na marcação: só quando o PREPARO começou (sem preparo a ficha já sai na hora e faz o papel do aviso).
//      1 bolha, link na última linha. Trava em `inv_agente_aviso_marcada:<card>:<quando ISO>`: INSERT `pendente` ANTES
//      de enviar, `enviado` depois. O que não cabe na linha fica `pendente` e sai numa rodada seguinte; se a ficha do
//      preparo sair antes (reserva `ficha_helena:<card>`), o pendente morre.
//   2. Resumo do dia: a partir das 7h30 de Brasília, todo dia (aviso à equipe não tem janela), 1 bolha por consultor, com as
//      reuniões que a Helena marcou para hoje e que ainda não foram avisadas hoje. Trava `inv_agente_aviso_dia:<dono>:<data>`.
//      Vale até a primeira reunião daquele dono: passou dela, descarta (é aviso, não agenda). Dono sem celular cadastrado
//      é PULADO (nunca cai no telefone do dono da casa).
//
// Condições do anti-ban: o carimbo de cada aviso é contado na linha (`ficha_lead:helena:marcada:<card>` e
// `ficha_lead:helena:dia:<dono>:<data>`, que caem no balde da equipe), e ANTES de cada envio (nesta ordem): linha livre,
// menos de 40 carimbos na hora, menos de 6 proativas em 10 min, e 25 s mais um sorteio de 0 a 35 s desde a última proativa.
// No máximo 1 aviso à equipe por rodada (o de marcação antes do resumo), nunca pelo enviarEmSequencia. Erro de envio:
// `contarErroDaLinha`, a trava volta a `pendente` e não há nova tentativa na mesma rodada.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { contarErroDaLinha, zerarErrosDaLinha } from '../agentes5040/guardaDaLinha';
import { carregarTelefonesConsultores, telefoneDoConsultor } from '../agentes5040/fichaEnvio';
import { conferirAntesDoAviso } from './investidorAgenteAvisosLinha';
import { ORIGEM_AGENTE_EP } from './eletropostoCard';
import { dataBrasilia, inicioDoDiaBrasiliaIso, primeiroNomeDoConsultor, type DadosDaConversa } from './investidorAgentePuro';
import { fatosDoAviso, rotuloDoTipo, textoAvisoMarcada, textoResumoDoDia, type LinhaDoResumo } from './investidorAgenteAvisosTextos';
import type { TipoHelena } from './investidorAgenteTextos';

const LOG = 'investidor-agente-avisos';

export const PREFIXO_AVISO_MARCADA = 'inv_agente_aviso_marcada:';
export const PREFIXO_AVISO_DIA = 'inv_agente_aviso_dia:';
/** Os carimbos que entram na conta da linha (balde da equipe: `ficha_lead:`). Nunca BOT_SENT_PREFIXES nem PREFIXOS_AGENDA. */
export const CARIMBO_MARCADA = 'ficha_lead:helena:marcada:';
export const CARIMBO_DIA = 'ficha_lead:helena:dia:';
/** A reserva da ficha ao consultor (a mesma de investidorAgente.FICHA_HELENA_PREFIX; o teste confere). */
export const RESERVA_DA_FICHA = 'ficha_helena:';

const HORA_MS = 3_600_000;
/** O resumo só sai depois das 7h30 de Brasília. */
export const RESUMO_A_PARTIR_DOS_MIN = 7 * 60 + 30;
/** Um pendente de marcação mais velho que isto não é mais lido (a reunião passou ou a ficha já saiu). */
const PENDENTE_VALE_MS = 36 * HORA_MS;

/** `enviando` = alguma rodada pegou a trava e está mandando (ou caiu no meio): nunca se repete. */
export type Estado = 'pendente' | 'enviando' | 'enviado' | 'descartado';
export interface Trava extends Record<string, unknown> { estado: Estado }
interface PendenteDaMarcada extends Trava {
  card: number; quando: string; consultor: string; nome: string; tipo: TipoHelena; cidade: string; fatos: string[];
}

// ── O "no máximo 1 aviso por rodada" ─────────────────────────────────────────
let avisoNestaRodada = false;
/** Chamada no começo de cada rodada da Helena (rodarInvestidorAgente). */
export function iniciarRodadaDeAvisos(): void { avisoNestaRodada = false; }
/** Algum aviso à equipe já gastou a vez nesta rodada? (os avisos novos da Helena esperam o das marcações e o resumo) */
export const avisoDaRodadaGasto = (): boolean => avisoNestaRodada;

const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? '');
const lerValor = (v: unknown): Record<string, unknown> | null => {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }
  return x && typeof x === 'object' ? x as Record<string, unknown> : null;
};
const semAcento = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** O dono do card como entra na chave da trava: primeiro nome, minúsculo, sem acento. */
export const chaveDoDono = (dono: unknown): string => semAcento(primeiroNomeDoConsultor(dono)).replace(/[^a-z0-9]/g, '');

/** O celular do consultor, SÓ dele (nunca o telefone do dono da casa). `lido: false` = a leitura da lista falhou (não prova que ele está sem celular). */
export async function celularSoDoConsultor(consultor: string): Promise<{ lido: boolean; tel: string | null }> {
  const lido = await carregarTelefonesConsultores();
  return lido.ok ? { lido: true, tel: telefoneDoConsultor(lido.mapa, consultor) } : { lido: false, tel: null };
}

// ── A trava (pendente → enviado) e o carimbo da linha ────────────────────────
export async function gravarTrava(key: string, valor: Trava, agora: Date): Promise<void> {
  const { error } = await supabase.from('system_state').upsert({ key, value: valor, updated_at: agora.toISOString() }, { onConflict: 'key' });
  if (error) logger.error(LOG, `gravar a trava ${key.split(':')[0]} (${valor.estado}) falhou (${codigoDe(error) || 'sem código'})`);
}
/** `true` = a trava nasceu agora; `false` = já existia (ou não deu para gravar: na dúvida, não manda). */
export async function reservar(key: string, valor: Trava, agora: Date): Promise<boolean> {
  const { error } = await supabase.from('system_state').insert({ key, value: valor, updated_at: agora.toISOString() });
  if (!error) return true;
  if (codigoDe(error) !== '23505') logger.error(LOG, `reservar o aviso falhou (${codigoDe(error) || 'sem código'}): nada sai`);
  return false;
}
/** `true` só para quem trocou a trava de `pendente` para `enviando`; leitura ou escrita que falha vale `false`. */
async function pegarATrava(key: string, valor: Trava, agora: Date): Promise<boolean> {
  const { data, error } = await supabase.from('system_state')
    .update({ value: { ...valor, estado: 'enviando' }, updated_at: agora.toISOString() })
    .eq('key', key).eq('value->>estado', 'pendente').select('key');
  if (error) { logger.error(LOG, `pegar a trava do aviso falhou (${codigoDe(error) || 'sem código'}): nada sai`); return false; }
  return ((data ?? []) as unknown[]).length > 0;
}
async function carimbarNaLinha(key: string, agora: Date): Promise<void> {
  const em = agora.toISOString();
  const { error } = await supabase.from('system_state').upsert([{ key, value: { em }, updated_at: em }], { onConflict: 'key' });
  if (error) logger.error(LOG, 'AVISO ENVIADO SEM CARIMBO: o teto da linha está contando a menos', error);
}

/**
 * Confere a linha, manda UMA bolha e fecha a trava. Devolve 'enviado', ou 'pendente' (a trava continua pendente: a linha
 * não coube, o consultor está sem celular, outro aviso já saiu nesta rodada ou o envio falhou). A tentativa gasta o aviso da
 * rodada mesmo quando falha: nunca há segunda tentativa na mesma rodada.
 */
export async function enviarComConferencias(i: {
  tel: string | null; texto: string; trava: string; valor: Trava; carimbo: string; agora: Date; sorteio?: () => number;
}): Promise<'enviado' | 'pendente'> {
  if (avisoNestaRodada || !i.tel) return 'pendente';
  const conf = await conferirAntesDoAviso(i.agora, i.sorteio);
  if (!conf.ok) { logger.warn(LOG, `aviso espera a linha (${conf.motivo}): fica para uma rodada seguinte`); return 'pendente'; }
  avisoNestaRodada = true;
  // Pega a trava: `pendente` -> `enviando` por update condicional. Duas rodadas cruzadas não mandam o mesmo aviso.
  if (!(await pegarATrava(i.trava, i.valor, i.agora))) return 'pendente';
  try {
    await sendWhatsApp(i.tel, i.texto, 'io');
  } catch (e) {
    logger.error(LOG, 'o aviso à equipe não saiu: a trava volta a pendente', { erro: String(e).slice(0, 200) });
    await contarErroDaLinha(i.agora, e);
    await gravarTrava(i.trava, { ...i.valor, estado: 'pendente' }, i.agora);
    return 'pendente';
  }
  await zerarErrosDaLinha(i.agora);
  await gravarTrava(i.trava, { ...i.valor, estado: 'enviado', enviado_em: i.agora.toISOString() }, i.agora);
  await carimbarNaLinha(i.carimbo, i.agora);
  return 'enviado';
}

// ═════════════════════════════════════════════════════════════════════════════
// 1) AVISO NA MARCAÇÃO
// ═════════════════════════════════════════════════════════════════════════════

export interface EntradaDaMarcacao {
  /** O preparo começou (a confirmação saiu com a primeira pergunta). Sem ele a ficha sai na hora e faz o papel do aviso. */
  comPreparo: boolean;
  cardId: number; iso: string; consultor: string; nome: string | null; tipo: TipoHelena; cidade: string | null; dados: DadosDaConversa | undefined;
}

const dadosDoTexto = (p: PendenteDaMarcada) => ({
  consultor: primeiroNomeDoConsultor(p.consultor), nome: p.nome, tipo: rotuloDoTipo(p.tipo), cidade: p.cidade, quando: p.quando, fatos: p.fatos,
});

/**
 * Chamado por `agendar` quando o preparo começou, depois de a confirmação ao cliente sair e o card estar gravado. Reserva a
 * trava `pendente` e tenta enviar na hora; se não couber, fica pendente para `rodarAvisosDaEquipe`. Nunca lança.
 */
export async function avisarMarcacao(e: EntradaDaMarcacao, agora: Date = new Date(), sorteio?: () => number): Promise<'enviado' | 'pendente' | 'nada'> {
  if (!e.comPreparo) return 'nada';
  try {
    const p: PendenteDaMarcada = {
      estado: 'pendente', card: e.cardId, quando: e.iso, consultor: e.consultor, nome: String(e.nome ?? '').trim(),
      tipo: e.tipo, cidade: String(e.cidade ?? '').trim(), fatos: fatosDoAviso(e.tipo, e.dados),
    };
    const trava = `${PREFIXO_AVISO_MARCADA}${e.cardId}:${e.iso}`;
    if (!(await reservar(trava, p, agora))) return 'nada';
    return await enviarComConferencias({
      tel: (await celularSoDoConsultor(e.consultor)).tel, texto: textoAvisoMarcada(dadosDoTexto(p), agora.toISOString()),
      trava, valor: p, carimbo: `${CARIMBO_MARCADA}${e.cardId}`, agora, sorteio,
    });
  } catch (err) {
    logger.error(LOG, 'o aviso da marcação falhou: nada sai', err);
    return 'nada';
  }
}

/** Os pendentes de marcação, do mais antigo ao mais novo. Erro de leitura sobe. */
async function lerPendentesDaMarcada(agora: Date): Promise<Array<{ key: string; p: PendenteDaMarcada }>> {
  const { data, error } = await supabase.from('system_state').select('key, value')
    .like('key', `${PREFIXO_AVISO_MARCADA}%`).gte('updated_at', new Date(agora.getTime() - PENDENTE_VALE_MS).toISOString())
    .order('updated_at', { ascending: true }).limit(50);
  if (error) throw new Error(`ler os avisos pendentes: ${error.message}`);
  const out: Array<{ key: string; p: PendenteDaMarcada }> = [];
  for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
    const v = lerValor(l.value);
    if (v?.estado === 'pendente' && Number.isInteger(Number(v.card))) out.push({ key: l.key, p: v as PendenteDaMarcada });
  }
  return out;
}

/** O pendente ainda vale? Morre se a ficha já saiu, o card sumiu, mudou de horário, de status ou de dono, ou a reunião passou. */
async function aindaVale(p: PendenteDaMarcada, agora: Date): Promise<{ vale: boolean; dono: string }> {
  const { data: ficha, error: eFicha } = await supabase.from('system_state').select('key').eq('key', `${RESERVA_DA_FICHA}${p.card}`).maybeSingle();
  if (eFicha) throw new Error(`ler a reserva da ficha: ${eFicha.message}`);
  if (ficha) return { vale: false, dono: '' };
  const { data, error } = await supabaseGerador.from('agendamentos').select('id, status, quando, vendedor_nome').eq('id', p.card).maybeSingle();
  if (error) throw new Error(`ler o card do aviso: ${error.message}`);
  const c = data as { status: string | null; quando: string | null; vendedor_nome: string | null } | null;
  const dono = String(c?.vendedor_nome ?? '');
  const vale = !!c && String(c.status ?? '').trim().toLowerCase() === 'agendado'
    && Date.parse(String(c.quando ?? '')) === Date.parse(p.quando) && Date.parse(p.quando) > agora.getTime()
    && chaveDoDono(dono) === chaveDoDono(p.consultor);
  return { vale, dono };
}

/** Tenta UM pendente de marcação (o mais antigo que ainda vale). Os que morreram são fechados sem gastar o aviso da rodada. */
async function rodarPendentes(agora: Date, sorteio?: () => number): Promise<'tentou' | 'nada'> {
  if (avisoNestaRodada) return 'tentou';
  for (const { key, p } of await lerPendentesDaMarcada(agora)) {
    const { vale, dono } = await aindaVale(p, agora);
    if (!vale) { await gravarTrava(key, { ...p, estado: 'descartado' }, agora); continue; }
    // Nunca prende os outros. Leitura da lista OK e consultor sem celular: a trava é descartada. Leitura que FALHOU: a trava
    // continua pendente (não prova nada) e o laço segue para o próximo.
    const { lido, tel } = await celularSoDoConsultor(dono || p.consultor);
    if (!lido) { logger.warn(LOG, `ler os celulares da equipe falhou: o aviso do card ${p.card} continua pendente`); continue; }
    if (!tel) { logger.warn(LOG, `consultor sem celular cadastrado: o aviso do card ${p.card} é descartado`); await gravarTrava(key, { ...p, estado: 'descartado', motivo: 'sem_celular' }, agora); continue; }
    await enviarComConferencias({
      tel, texto: textoAvisoMarcada(dadosDoTexto(p), agora.toISOString()),
      trava: key, valor: p, carimbo: `${CARIMBO_MARCADA}${p.card}`, agora, sorteio,
    });
    // Mandou ou não coube (linha, celular): o próximo pendente esbarra na mesma coisa, e o resumo NUNCA passa na frente
    // de uma marcação que espera. Sai da rodada.
    return 'tentou';
  }
  return 'nada';
}

// ═════════════════════════════════════════════════════════════════════════════
// 2) RESUMO DO DIA
// ═════════════════════════════════════════════════════════════════════════════

interface CardDoDia { id: number; dono: string; quando: string; nome: string; cidade: string }

const minutosEmBrasilia = (agora: Date): number => {
  const d = new Date(agora.getTime() - 3 * HORA_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Os cards agendados HOJE (Brasília) que a Helena marcou, de qualquer horário do dia. Erro sobe. */
async function lerCardsDoDia(agora: Date): Promise<CardDoDia[]> {
  const ini = inicioDoDiaBrasiliaIso(agora);
  const { data, error } = await supabaseGerador.from('agendamentos').select('id, vendedor_nome, quando, status, cliente_nome, cidade')
    .eq('created_by', ORIGEM_AGENTE_EP).eq('status', 'agendado')
    .gte('quando', ini).lt('quando', new Date(Date.parse(ini) + 24 * HORA_MS).toISOString());
  if (error) throw new Error(`ler os cards do dia: ${error.message}`);
  return ((data ?? []) as Array<{ id: number; vendedor_nome: string | null; quando: string | null; cliente_nome: string | null; cidade: string | null }>)
    .filter(c => c.quando && c.vendedor_nome)
    .map(c => ({ id: Number(c.id), dono: String(c.vendedor_nome), quando: String(c.quando), nome: String(c.cliente_nome ?? ''), cidade: String(c.cidade ?? '') }));
}

/** Os cards cuja marcação já foi avisada hoje: trava de marcação criada hoje (pendente ou enviada) ou ficha enviada hoje. */
async function lerAvisadosHoje(agora: Date): Promise<Set<number>> {
  const ini = inicioDoDiaBrasiliaIso(agora);
  const [marcadas, fichas] = await Promise.all([
    supabase.from('system_state').select('key, value').like('key', `${PREFIXO_AVISO_MARCADA}%`).gte('updated_at', ini).limit(1000),
    supabase.from('system_state').select('key').like('key', `${RESERVA_DA_FICHA}%`).gte('updated_at', ini).limit(1000),
  ]);
  if (marcadas.error || fichas.error) throw new Error('ler o que já foi avisado hoje falhou');
  const ids = new Set<number>();
  for (const l of (marcadas.data ?? []) as Array<{ key: string; value: unknown }>) {
    if (lerValor(l.value)?.estado !== 'descartado') ids.add(Number(l.key.slice(PREFIXO_AVISO_MARCADA.length).split(':')[0]));
  }
  for (const l of (fichas.data ?? []) as Array<{ key: string }>) ids.add(Number(l.key.slice(RESERVA_DA_FICHA.length)));
  return ids;
}

/** O tipo de cada card (rótulo): da sessão da Helena que o marcou. Sem sessão, fica vazio (a linha fecha no nome). */
async function tiposDosCards(ids: number[]): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  try {
    const { data, error } = await supabase.from('system_state').select('value').like('key', 'inv_agente:%').in('value->>agendamento_id', ids.map(String)).limit(200);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as Array<{ value: unknown }>) {
      const v = lerValor(l.value);
      const t = String(v?.tipo ?? '') as TipoHelena;
      if (v && t in { investidor: 1, arrendamento: 1, parceiro: 1, curioso: 1 }) mapa.set(Number(v.agendamento_id), rotuloDoTipo(t));
    }
  } catch (err) { logger.warn(LOG, 'ler o tipo dos cards do resumo falhou: as linhas saem sem o tipo', { erro: String(err).slice(0, 120) }); }
  return mapa;
}

/**
 * O resumo do dia. Um consultor por rodada (a primeira tentativa gasta o aviso da rodada). Devolve quantos saíram.
 * Antes das 7h30 não faz nada. Descarta o resumo do dono cuja primeira reunião do dia já começou.
 */
export async function enviarResumoDoDia(agora: Date = new Date(), sorteio?: () => number): Promise<{ enviados: number; motivo?: string }> {
  if (avisoNestaRodada) return { enviados: 0, motivo: 'aviso_ja_saiu_na_rodada' };
  if (minutosEmBrasilia(agora) < RESUMO_A_PARTIR_DOS_MIN) return { enviados: 0, motivo: 'antes_das_7h30' };
  const cards = await lerCardsDoDia(agora);
  if (!cards.length) return { enviados: 0, motivo: 'sem_reuniao_hoje' };
  const avisados = await lerAvisadosHoje(agora);
  const dia = dataBrasilia(agora);
  const donos = new Map<string, CardDoDia[]>();
  for (const c of cards) donos.set(chaveDoDono(c.dono), [...(donos.get(chaveDoDono(c.dono)) ?? []), c]);

  for (const [dono, todos] of [...donos.entries()].sort((a, b) => Math.min(...a[1].map(c => Date.parse(c.quando))) - Math.min(...b[1].map(c => Date.parse(c.quando))))) {
    const itens = todos.filter(c => !avisados.has(c.id));
    if (!itens.length) continue;
    const trava = `${PREFIXO_AVISO_DIA}${dono}:${dia}`;
    const { data: lida, error: eLida } = await supabase.from('system_state').select('value').eq('key', trava).maybeSingle();
    if (eLida) throw new Error(`ler a trava do resumo: ${eLida.message}`);
    const estado = lerValor(lida?.value)?.estado;
    if (estado === 'enviado' || estado === 'enviando' || estado === 'descartado') continue;
    // O resumo vale até a primeira reunião do dono no dia (de qualquer card dele, avisado ou não).
    const primeira = Math.min(...todos.map(c => Date.parse(c.quando)));
    if (agora.getTime() >= primeira) { await gravarTrava(trava, { estado: 'descartado', motivo: 'passou_da_primeira_reuniao' }, agora); continue; }
    const { lido, tel } = await celularSoDoConsultor(todos[0]!.dono);
    if (!tel) { logger.warn(LOG, lido ? 'consultor sem celular cadastrado: o resumo dele é pulado' : 'ler os celulares da equipe falhou: o resumo dele fica para a próxima rodada'); continue; }
    const valor: Trava = { estado: 'pendente', cards: itens.map(c => c.id) };
    if (!lida && !(await reservar(trava, valor, agora))) continue;
    const tipos = await tiposDosCards(itens.map(c => c.id));
    const linhas: LinhaDoResumo[] = itens.map(c => ({ quando: c.quando, nome: c.nome, tipo: tipos.get(c.id) ?? '', cidade: c.cidade }));
    const r = await enviarComConferencias({
      tel, texto: textoResumoDoDia(primeiroNomeDoConsultor(todos[0]!.dono), linhas), trava, valor, carimbo: `${CARIMBO_DIA}${dono}:${dia}`, agora, sorteio,
    });
    return { enviados: r === 'enviado' ? 1 : 0, ...(r === 'pendente' ? { motivo: 'pendente' } : {}) };
  }
  return { enviados: 0, motivo: 'nada_a_avisar' };
}

// ═════════════════════════════════════════════════════════════════════════════
// A RODADA: o aviso de marcação primeiro, o resumo depois, no máximo UM por rodada.
// ═════════════════════════════════════════════════════════════════════════════

export async function rodarAvisosDaEquipe(agora: Date = new Date(), sorteio?: () => number): Promise<Record<string, unknown>> {
  try {
    if ((await rodarPendentes(agora, sorteio)) === 'tentou') return { marcada: 1 };
    const resumo = await enviarResumoDoDia(agora, sorteio);
    return { resumo };
  } catch (err) {
    logger.error(LOG, 'rodada dos avisos à equipe falhou', err);
    return { erro: String((err as Error)?.message || err).slice(0, 200) };
  }
}
