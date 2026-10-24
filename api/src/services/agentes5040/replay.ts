// ─────────────────────────────────────────────────────────────────────────────
// REPLAY DE CONVERSAS PASSADAS. Pega conversas reais da linha 5040 (os três produtos) e, para cada
// TURNO (o bloco de mensagens do lead até a nossa resposta), pergunta à agente o que ela diria com o
// histórico REAL daquele ponto, e grava junto o que foi respondido de verdade. NADA é enviado.
//
// Mesmas regras do ensaio ao vivo (ver ensaio.ts), mais as do passado:
//  · cada turno usa só o histórico até ali e `agora` = o instante do turno (horário comercial e a
//    conversa de época, não os de hoje). Card, leads_meta e cadastros criados DEPOIS do turno somem;
//  · o porteiro do replay monta os fatos aqui (sem ler atendimento_pausa de hoje: uma pausa aberta
//    agora não cala o passado). Humano vem das falas da equipe nas 24 h antes do turno;
//    "não incomodar", bloqueado, mudo e cliente do SolarDoc seguem o estado de hoje;
//  · iniciativa 'abertura' só no turno em que a PRIMEIRA mensagem da conversa é nossa (robô);
//  · horários livres nunca entram (a agenda de hoje não diz o que estava livre naquele dia);
//  · teto próprio (AGENTES5040_TETO_REPLAY) e interruptor próprio (ligado('replay')).
//    `dry` ignora só o interruptor, usa o modelo, não grava e não reserva.
// ─────────────────────────────────────────────────────────────────────────────

import { novoAnthropic } from '../../utils/anthropicClient';
import { anuncioDaMensagem } from './anuncioDoLead';
import { gravarMidiaCache, gravarTurno, lerMidiaCache, lerTurnosNosDias, type TurnoGravado } from './armazem';
import {
  carregarListasDeBarragem, lerCards, lerConversa, montarContexto, type ListasDeBarragem,
} from './contexto';
import { clienteComCota, disjuntorAberto, faxinar, registrarTentativa, reservarChave, type EstadoCota } from './cota';
import { hmacDe } from './hmac';
import { ligado } from './interruptores';
import type { ClienteIA } from './ia';
import { ehMidia } from './midia';
import { decidirDona, origemDoLeadMeta } from './porteiro';
import { lerCandidatas, MOTIVO_ANUNCIO, PRAZO_TOTAL_MS } from './ensaio';
import { diaBRT } from './relogio';
import {
  donaAtualDe, falhaDeInfra, juntarDados, montarGravado, pensarTurno, respostaReal,
} from './turno';
import type {
  AnuncioOrigem, CadastroEletroposto, CardResumo, ContextoLead, FatosPorteiro, LeadMetaResumo, MsgConversa, Persona,
} from './tipos';

/** Depois disto o replay não abre conversa nova; o teto de 240 s para qualquer chamada ao modelo é PRAZO_TOTAL_MS. */
export const PRAZO_REPLAY_MS = 200_000;
const BALDE_MS = 5 * 60_000;
const HORA_MS = 3_600_000;
const JANELA_RECENTE_DIAS = 60;
const JANELA_HUMANO_H = 24;

export interface OpcoesReplay {
  desde: Date | string;
  ate: Date | string;
  /** Conversas por execução (padrão 5). */
  maxConversas?: number;
  /** Turnos por conversa (padrão 8): os primeiros da janela. */
  maxTurnos?: number;
  dry?: boolean;
  agora?: Date;
  cliente?: ClienteIA;
}

export interface TurnoReplayResumo {
  hmac8: string;
  wa_id: number;
  kind: 'resposta' | 'abertura';
  passo: number | 'falha';
  persona: Persona | null;
  falou: boolean;
  /** Só tamanhos: o TEXTO da agente e do lead fica no bucket privado, nunca na resposta da rota. */
  n_bolhas: number;
  tamanho: number;
  acao: string | null;
  motivo: string | null;
  modelo: string | null;
  uso: TurnoGravado['uso'];
  gravado: 'gravado' | 'ja_existia' | 'nao_gravou';
}

export interface RelatorioReplay {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  motivo?: string;
  conversasVistas: number;
  conversasProcessadas: number;
  turnosGravados: number;
  turnosJaExistiam: number;
  chamadasIA: number;
  parou: EstadoCota['parou'] | 'prazo' | null;
  /** A leitura das mensagens da janela bateu no teto de páginas: só as mais recentes entraram. */
  janelaTruncada: boolean;
  puladas: Record<string, number>;
  turnos: TurnoReplayResumo[];
}

const novo = (dry: boolean, extra: Partial<RelatorioReplay> = {}): RelatorioReplay => ({
  ok: true, ligado: true, dry, conversasVistas: 0, conversasProcessadas: 0, turnosGravados: 0, turnosJaExistiam: 0,
  chamadasIA: 0, parou: null, janelaTruncada: false, puladas: {}, turnos: [], ...extra,
});

// ── quebrar a conversa em turnos ─────────────────────────────────────────────

export interface TurnoDaConversa {
  kind: 'resposta' | 'abertura';
  /** Id da última mensagem do bloco do lead (da primeira nossa, na abertura). */
  waId: number;
  momento: string;
  /** O bloco do lead (vazio na abertura). */
  bloco: MsgConversa[];
  /** A conversa até este turno, inclusive o bloco. */
  historico: MsgConversa[];
  /** O que foi respondido de verdade logo depois. */
  real: MsgConversa[];
}

/**
 * Turno = bloco de mensagens do lead até a nossa resposta. Se a conversa COMEÇA por uma fala do robô
 * (abertura depois do cadastro), esse é o turno 0, com histórico vazio. Fala da equipe no começo não abre turno.
 */
export function quebrarEmTurnos(msgs: readonly MsgConversa[]): TurnoDaConversa[] {
  const turnos: TurnoDaConversa[] = [];
  let i = 0;
  if (msgs.length && msgs[0]!.autor === 'robo') {
    const real = respostaReal(msgs);
    turnos.push({ kind: 'abertura', waId: msgs[0]!.id, momento: msgs[0]!.momment, bloco: [], historico: [], real });
    i = real.length;
  }
  while (i < msgs.length) {
    if (msgs[i]!.autor !== 'lead') { i++; continue; }
    let j = i;
    while (j < msgs.length && msgs[j]!.autor === 'lead') j++;
    const bloco = msgs.slice(i, j);
    const ultimo = bloco[bloco.length - 1]!;
    const real = respostaReal(msgs.slice(j));
    turnos.push({ kind: 'resposta', waId: ultimo.id, momento: ultimo.momment, bloco, historico: msgs.slice(0, j), real });
    i = j + real.length;
  }
  return turnos;
}

// ── a época: tira o que ainda não existia ────────────────────────────────────

interface Cadastros { card: CardResumo | null; leadsMeta: LeadMetaResumo | null; cadastros: CadastroEletroposto[] }

const antesDe = (iso: string | null | undefined, ms: number): boolean => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) && t <= ms;
};

/** Card, leads_meta e cadastros que já existiam no instante do turno. */
export function dadosDaEpoca(d: Cadastros, ms: number): Cadastros {
  return {
    card: d.card && antesDe(d.card.created_at, ms) ? d.card : null,
    leadsMeta: d.leadsMeta && antesDe(d.leadsMeta.created_time, ms) ? d.leadsMeta : null,
    // O status do cadastro também é o de hoje: não vale para o passado.
    cadastros: d.cadastros.filter(c => antesDe(c.created_at, ms)).map(c => ({ ...c, status: null })),
  };
}

/**
 * O card que existia no instante do turno: o mais novo criado ATÉ ali (não o mais novo de todos). O que muda depois
 * (status, data marcada, observação) é apagado, porque o banco só guarda o estado de HOJE; o consultor fica, marcado
 * como "pode ter mudado" para a persona não citar o nome sem outro sinal.
 */
export function cardDaEpoca(cards: readonly CardResumo[], ms: number): CardResumo | null {
  const c = [...cards]
    .filter(x => antesDe(x.created_at, ms))
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))[0];
  if (!c) return null;
  return {
    ...c, status: null, quando: null, observacao: null,
    vendedor_nome: c.vendedor_nome ? `${c.vendedor_nome} (pode ter mudado)` : null,
  };
}

const recente = (iso: string | null | undefined, ms: number): boolean => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) && ms - t <= JANELA_RECENTE_DIAS * 86_400_000;
};

/** Mesma regra do contexto.ts (card vence cadastro), com o instante do turno. */
function origemDaEpoca(d: Cadastros, ms: number): string | null {
  if (d.card?.created_by && recente(d.card.created_at, ms)) return d.card.created_by;
  if (d.leadsMeta && recente(d.leadsMeta.created_time, ms)) return origemDoLeadMeta(d.leadsMeta);
  const cad = d.cadastros.find(c => recente(c.created_at, ms));
  if (cad) return cad.origem === 'nota1' ? 'lp_eletroposto' : 'cadastro_eletroposto';
  return null;
}

/** Os fatos do porteiro de um turno do passado. */
export function fatosDaEpoca(a: {
  chave: string; hist: readonly MsgConversa[]; ms: number; dados: Cadastros; listas: ListasDeBarragem;
  cliente: boolean; anuncio: AnuncioOrigem | null; donaAtual: Persona | null;
}): FatosPorteiro {
  const primeiro = a.hist.find(m => m.autor === 'lead' && String(m.texto ?? '').trim());
  const humano = a.hist.some(m => {
    const t = Date.parse(m.momment);
    return m.autor === 'equipe' && t <= a.ms && a.ms - t <= JANELA_HUMANO_H * HORA_MS;
  });
  return {
    leituraOk: true,
    humanoNaConversa: humano,
    naoIncomodar: a.listas.silenciado(a.chave),
    bloqueado: a.listas.bloqueado(a.chave),
    mudo: a.listas.mudo(a.chave),
    donaAtual: a.donaAtual,
    ehClienteSolarDoc: a.cliente,
    anuncio: a.anuncio,
    primeiroTextoDoLead: primeiro ? String(primeiro.texto) : null,
    origemCadastro: origemDaEpoca(a.dados, a.ms),
    // O replay não tem como saber que sessão antiga existia naquela época: lê como "sem outro robô".
    outroRoboAtivo: false,
  };
}

// ── a execução ───────────────────────────────────────────────────────────────

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };
const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

export async function runReplay(opts: OpcoesReplay): Promise<RelatorioReplay> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const inicio = Date.now();
  try {
    if (!dry && !(await ligado('replay'))) return novo(dry, { ligado: false, motivo: 'interruptor replay desligado' });
    if (!hmacDe('replay')) return novo(dry, { ok: false, motivo: 'sem segredo de HMAC: o replay não roda' });
    const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
    if (!inst) return novo(dry, { ok: false, motivo: 'sem a instância da linha IO' });
    const desdeMs = Date.parse(iso(opts.desde));
    const ateMs = Date.parse(iso(opts.ate));
    if (!Number.isFinite(desdeMs) || !Number.isFinite(ateMs) || desdeMs >= ateMs) return novo(dry, { ok: false, motivo: 'janela inválida' });
    if (await disjuntorAberto(agora)) return novo(dry, { parou: 'disjuntor', motivo: 'disjuntor aberto' });

    if (!dry) {
      const trava = await reservarChave(`ag5040_lock:replay:${Math.floor(agora.getTime() / BALDE_MS)}`, {}, agora);
      if (trava === 'ja_existe') return novo(dry, { motivo: 'outro replay já pegou este intervalo' });
      if (trava === 'erro') return novo(dry, { ok: false, motivo: 'não consegui reservar o replay' });
    }

    // Lidas das mais recentes para as mais antigas: se a janela passar do teto de páginas, o que fica de fora é o mais velho.
    const { candidatas, truncado } = await lerCandidatas(inst, new Date(desdeMs).toISOString(), new Date(ateMs).toISOString());
    const r = novo(dry, { conversasVistas: candidatas.length, janelaTruncada: truncado });
    if (truncado) r.motivo = 'a janela passou do teto de leitura: só as mensagens mais recentes entraram';
    // O dry ignora o interruptor e gasta modelo de verdade: no máximo 1 conversa e 2 turnos (a sonda de cache). Mais que isso, só ligado.
    const maxConversas = dry ? 1 : Math.max(1, Math.min(opts.maxConversas ?? 5, 50));
    const maxTurnos = dry ? Math.min(2, Math.max(1, opts.maxTurnos ?? 2)) : Math.max(1, Math.min(opts.maxTurnos ?? 8, 30));
    const listas = await carregarListasDeBarragem();
    const base: ClienteIA = opts.cliente ?? (novoAnthropic() as unknown as ClienteIA);
    const { cliente, estado } = clienteComCota(dry ? 'dry' : 'replay', () => new Date(), base, inicio + PRAZO_TOTAL_MS);

    // As mais recentes primeiro: é o que o dono quer ver.
    for (const c of candidatas) {
      if (r.conversasProcessadas >= maxConversas) break;
      if (Date.now() - inicio > PRAZO_REPLAY_MS) { r.parou = 'prazo'; break; }
      if (estado.parou) { r.parou = estado.parou; break; }
      const feito = await replayDaConversa(c.chave, { desdeMs, ateMs, maxTurnos, dry, agora, listas, cliente, estado, r, inicio });
      if (feito) r.conversasProcessadas++;
      if (r.parou) break;
    }
    if (estado.parou && !r.parou) r.parou = estado.parou;
    r.chamadasIA = estado.chamadas;
    if (!dry) await faxinar(agora);
    return r;
  } catch (e) {
    console.error('[agentes5040] replay falhou', String((e as { code?: string })?.code ?? 'interno'));
    return novo(dry, { ok: false, motivo: 'o replay falhou' });
  }
}

interface Execucao {
  desdeMs: number; ateMs: number; maxTurnos: number; dry: boolean; agora: Date; listas: ListasDeBarragem;
  cliente: ClienteIA; estado: EstadoCota; r: RelatorioReplay; inicio: number;
}

/** true = a conversa entrou no replay (teve ao menos um turno na janela). */
async function replayDaConversa(chave: string, g: Execucao): Promise<boolean> {
  const { r, dry } = g;
  const hmac = hmacDe(chave);
  if (!hmac) { soma(r.puladas, 'sem_hmac'); return false; }
  const conv = await lerConversa(chave);
  if (!conv.completa) { soma(r.puladas, 'conversa_incompleta'); return false; }

  const turnos = quebrarEmTurnos(conv.msgs)
    .filter(t => Date.parse(t.momento) >= g.desdeMs && Date.parse(t.momento) <= g.ateMs)
    .slice(0, g.maxTurnos);
  if (!turnos.length) { soma(r.puladas, 'sem_turno_na_janela'); return false; }

  // O que já foi gravado desta conversa nos dias da época (o replay continua de onde parou).
  let gravados: TurnoGravado[];
  try { gravados = await lerTurnosNosDias(hmac, turnos.map(t => diaBRT(t.momento))); }
  catch { soma(r.puladas, 'armazem_falhou'); return false; }
  const porId = new Map(gravados.map(t => [t.wa_id, t]));

  const base = await montarContexto(chave, { msgs: [], completa: true }, { agora: g.agora.toISOString() });
  if (!base.completa) { soma(r.puladas, 'contexto_incompleto'); return false; }
  let cards: CardResumo[];
  try { cards = await lerCards(chave); }
  catch { soma(r.puladas, 'contexto_incompleto'); return false; }
  const dadosBase: Cadastros = { card: null, leadsMeta: base.leadsMeta, cadastros: base.cadastros };
  const primeiroDoLead = conv.msgs.find(m => m.autor === 'lead');
  const anuncio = primeiroDoLead ? await anuncioDaMensagem(primeiroDoLead.id) : { ok: true, anuncio: null };

  const anteriores: Array<Pick<TurnoGravado, 'persona' | 'acao' | 'falou' | 'dados'>> = [];
  for (const t of turnos) {
    if (Date.now() - g.inicio > PRAZO_REPLAY_MS) { r.parou = 'prazo'; break; }
    if (g.estado.parou) { r.parou = g.estado.parou; break; }

    const ja = porId.get(t.waId);
    if (ja) { anteriores.push(ja); r.turnosJaExistiam++; continue; }

    const ms = Date.parse(t.momento);
    const epoca = dadosDaEpoca({ ...dadosBase, card: cardDaEpoca(cards, ms) }, ms);
    const fatos = fatosDaEpoca({
      chave, hist: t.historico, ms, dados: epoca, listas: g.listas, cliente: base.ehClienteSolarDoc,
      anuncio: anuncio.anuncio, donaAtual: donaAtualDe(anteriores),
    });
    const decisao = anuncio.ok ? decidirDona(fatos) : MOTIVO_ANUNCIO;
    const persona: Persona | null = decisao.dona === 'carla' || decisao.dona === 'duda' || decisao.dona === 'helena' ? decisao.dona : null;

    let resultado: Awaited<ReturnType<typeof pensarTurno>> | null = null;
    if (persona) {
      const audios = t.historico.filter(m => m.autor === 'lead' && m.tipo === 'audio' && m.media_url).slice(-10).map(m => m.id);
      const cacheMidia = await lerMidiaCache([...new Set([...audios, ...t.bloco.filter(ehMidia).map(m => m.id)])]);
      const ctx: ContextoLead = {
        ...base, ...epoca, msgs: t.historico, anuncio: anuncio.anuncio, agora: new Date(ms).toISOString(), horariosLivres: [],
      };
      resultado = await pensarTurno({
        persona, ctx, novas: t.bloco,
        dadosAnteriores: juntarDados(anteriores.filter(a => a.falou).map(a => a.dados)),
        abertura: t.kind === 'abertura', cliente: g.cliente, cacheMidia,
      });
      if (g.estado.parou) {
        soma(r.puladas, 'ia_indisponivel');
        r.parou = g.estado.parou;
        break;
      }
      // Falha avulsa (400, timeout, limite): 2 tentativas por mensagem; na segunda o turno é gravado como falhou.
      if (falhaDeInfra(resultado.pensamento) && (dry || (await registrarTentativa(t.waId, g.agora)) === 1)) {
        soma(r.puladas, 'ia_indisponivel');
        break;
      }
      if (!dry) for (const b of resultado.midiasNovas) await gravarMidiaCache(b);
    }

    const turno = montarGravado({
      origem: 'replay', hmac, kind: t.kind, waId: t.waId, momento: t.momento, decisao, persona, resultado,
      entrada: t.bloco, nHistorico: t.historico.length, real: t.real, agora: g.agora,
    });
    let gravado: TurnoReplayResumo['gravado'] = 'nao_gravou';
    if (!dry) {
      try {
        gravado = await gravarTurno(turno);
        if (gravado === 'gravado') r.turnosGravados++; else r.turnosJaExistiam++;
      } catch { soma(r.puladas, 'armazem_falhou'); r.parou = 'erro'; break; }
    }
    anteriores.push(turno);
    r.turnos.push({
      hmac8: hmac.slice(0, 8), wa_id: t.waId, kind: t.kind, passo: decisao.passo, persona, falou: turno.falou,
      n_bolhas: turno.bolhas.length, tamanho: turno.bolhas.reduce((n, b) => n + b.length, 0), acao: turno.acao, motivo: turno.motivo_silencio, modelo: turno.modelo, uso: turno.uso, gravado,
    });
  }
  return true;
}
