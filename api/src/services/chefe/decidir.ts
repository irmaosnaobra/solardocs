// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — DECIDIR: a regra inteira numa função pura.
//
//   decidir(estado, pedido, agora) → enviar_agora | adiar | caixa_de_saida
//
// Sem I/O, sem relógio, sem sorteio: o "sorteio" do espaçamento e do adiar sai
// de um hash da chave do pedido, então o mesmo estado dá sempre a mesma
// decisão e o teste reproduz qualquer caso.
//
// TRABALHA NO LIMITE SEGURO, NÃO ABAIXO DELE [memória chefe-antiban-da-linha.md].
// O decidir nunca descarta. Quando trava, devolve o instante mais cedo em que a
// regra que travou libera, e o robô volta nessa hora (os gates são pré-claim).
// A ordem é por prioridade e prazo: o pedido de prioridade menor não pega a
// vaga que uma prioridade maior que está esperando vai usar.
//
// AS CORREÇÕES DA CRÍTICA, onde elas mudam a especificação:
// - Envio que nasce de evento NUNCA recebe 'adiar'. Ou sai agora (P0) ou vai
//   para a caixa de saída, que é persistida e drenada depois.
// - P0 e P1 ficam fora do teto da linha e da rampa. Só obedecem a um
//   espaçamento curto (10 s, vira espera em processo) e ao teto de emergência.
//   O lembrete com prazo (P1 pelo prazo) ainda mora na janela do transacional
//   (7h–21h) e numa rajada própria de 6 em 10 min [revisão]: o prazo vem de
//   quem chama, e sem isso era passe livre para a classe autodeclarada voltar.
// - O teto da linha (24/h e 200/24h) vale para P2 a P5. A proativa também não
//   empurra o TOTAL da hora, urgente incluído, acima de 40.
// - O freio de erro conta só erro de LINHA, nunca número inválido. Durante o
//   freio, a resposta e o lembrete viram a sonda da linha (1 tentativa a cada
//   5 min); a proativa espera 15 min; o evento vai para a caixa.
// - A pausa humana segue o HEAD robô a robô (respeitaPausa em CLASSE_POR_ROBO):
//   a agenda do eletroposto e a vendedora reativa passam; a Duda, a Giovanna, as
//   boas-vindas e a cobrança do SIM esperam. Todo frio espera a conversa esfriar
//   (aperto novo para o frio da linha solardoc, que hoje não confere).
// - Reativo atrasado vira frio, com ou sem conversa nas últimas 24h [crítica].
//   O manual_crm é de 1 destino por chamada: chamada com mais é lote e é
//   decidida como o robô de lote (frio) [revisão].
// - 'adiar' tem escopo: 'linha' faz o robô parar a rodada; 'destino' faz o robô
//   pular para o próximo candidato (pausa e chave repetida são do destino).
// ─────────────────────────────────────────────────────────────────────────────

import {
  Classe, MetaRobo, CLASSES, PRIORIDADE, ROBO_DESCONHECIDO,
  ehUrgente, ehProativa, ehFria, naRampa, metaDoRobo, prioridadeFina,
} from './classes';
import {
  Regulamento, REGULAMENTO_PADRAO, JanelaHorario, degrauDaRampa, dentroDaJanela, proximaAbertura,
} from './regulamento';
import { ehDestinoInterno } from './destinos';

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type JanelaContagem = '10min' | '1h' | '3h' | '6h' | '24h';
export type ContagemPorClasse = Partial<Record<Classe, number>>;

/**
 * Grupos cujo envio mais antigo dentro da janela dá o instante exato em que a
 * vaga abre. Opcional: sem ele, o 'adiar' usa o ritmo médio (janela ÷ teto).
 */
export type GrupoJanela =
  | 'frio_1h' | 'frio_24h' | 'proativa_10min' | 'lembrete_10min' | 'linha_1h' | 'linha_24h'
  | 'total_1h' | 'total_24h' | 'rampa_1h' | 'rampa_24h' | 'aviso_1h'
  | 'semConversa_3h' | 'semConversa_6h';

/** O que o CHEFE sabe sobre o destino deste pedido. */
export interface EstadoDestino {
  /** Última mensagem RECEBIDA deste destino (epoch ms). Decide reativo e conversa viva. */
  ultimaEntradaEm?: number | null;
  /** Pausa humana ativa (atendimento_pausa sem liberado_em). `ultimaFalaEm` = última fala de humano ou lead. */
  pausa?: { ultimaFalaEm: number } | null;
  /** A mesma chave de toque já recebeu enviar_agora neste instante (epoch ms). */
  chaveReservadaEm?: number | null;
}

/**
 * Fotografia da linha física, só com agregados (a RPC conta no servidor; nada de
 * puxar linhas, o PostgREST corta em 1000).
 */
export interface Estado {
  /** Mensagens FÍSICAS que saíram (ou estão reservadas), por classe, em cada janela corrida. */
  contagens: Partial<Record<JanelaContagem, ContagemPorClasse>>;
  /** Físicas de P3 a P5 para destino que NÃO escreveu nas últimas 24h. */
  semConversa?: Partial<Record<'3h' | '6h', number>>;
  /** Últimos envios (epoch ms). `carimbado` = último envio de robô que o HEAD conta (frio ou agenda). */
  ultimoEm?: { fisica?: number | null; proativa?: number | null; frio?: number | null; carimbado?: number | null };
  maisAntigoEm?: Partial<Record<GrupoJanela, number>>;
  /** Erros de LINHA seguidos desde o último envio ok. Número inválido não entra. */
  errosLinhaSeguidos: number;
  ultimoErroLinhaEm?: number | null;
  /** Última volta da linha (monitor). Arma a rampa de 72h. */
  reconectadoEm?: number | null;
  /** Rampa forçada à mão (LINHA_RECONECTADA_EM). Vale a mais recente das duas. */
  rampaForcadaEm?: number | null;
  /** Pedidos vivos esperando vaga, por classe efetiva (a espera viva). */
  esperando?: ContagemPorClasse;
  /** Telefones da equipe: destino daqui vira aviso_interno. */
  equipe?: readonly string[];
  destino?: EstadoDestino;
}

export interface Pedido {
  /** Nome do robô em CLASSE_POR_ROBO. Desconhecido = frio. */
  robo: string;
  /** Telefone ou id de grupo. */
  destino: string;
  /** Bolhas de TEXTO pedidas (sem o Pix). */
  bolhas?: number;
  /** A mensagem leva Pix copia-e-cola? Ele sai sempre em bolha própria. */
  temPix?: boolean;
  /** Chave do toque (idempotência entre os relógios). */
  chave?: string;
  /** Prazo do envio (epoch ms). Só vale para robô de agenda (podeTerPrazo). */
  prazo?: number | null;
  /**
   * Quantos destinos a CHAMADA do robô cobre (o lista.length da rota). Robô de
   * 1 destino por chamada (roboDeLote) com mais de 1 é lote. É contrato para a
   * fase do passaporte, que confere o número; a defesa de verdade contra lote
   * disfarçado é o rebaixamento a frio de quem não escreveu em 15 min.
   */
  destinosNaChamada?: number;
}

export type Motivo =
  | 'chave_repetida'
  | 'freio_de_erro'
  | 'pausa_humana'
  | 'fora_da_janela'
  | 'teto_emergencia'
  | 'rajada_10min'
  | 'rajada_lembrete'
  | 'espaco_proativa'
  | 'teto_proativo_total'
  | 'teto_linha_hora'
  | 'teto_linha_dia'
  | 'reservado_prioridade_maior'
  | 'volume_sustentado'
  | 'rampa_hora'
  | 'rampa_dia'
  | 'reserva_transacional'
  | 'teto_frio_hora'
  | 'teto_frio_dia'
  | 'espaco_frio'
  | 'sublimite_aviso';

export type Escopo = 'linha' | 'destino';

interface Comum {
  classe: Classe;
  /** Prioridade fina (classe × 10 + subprioridade). Menor sai primeiro. */
  prioridade: number;
}

export type Decisao =
  | (Comum & { acao: 'enviar_agora'; maxBolhas: number; esperarMs: number })
  | (Comum & { acao: 'adiar'; ate: number; motivo: Motivo; escopo: Escopo })
  | (Comum & { acao: 'caixa_de_saida'; motivo: Motivo });

/** Uma regra que travou: por quê, até quando e para quem. */
export interface Trava {
  motivo: Motivo;
  libera: number;
  escopo: Escopo;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUXILIARES PUROS
// ─────────────────────────────────────────────────────────────────────────────

const HORA = 60 * 60 * 1000;
const JANELA_MS: Readonly<Record<JanelaContagem, number>> = {
  '10min': 10 * 60 * 1000, '1h': HORA, '3h': 3 * HORA, '6h': 6 * HORA, '24h': 24 * HORA,
};

/** FNV-1a de 32 bits → [0, 1). O "sorteio" determinístico do núcleo. */
export function sorteio(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

/** Soma da contagem de um conjunto de classes numa janela. */
export function somar(estado: Estado, janela: JanelaContagem, classes: readonly Classe[]): number {
  const c = estado.contagens[janela];
  if (!c) return 0;
  let n = 0;
  for (const k of classes) n += Math.max(0, c[k] ?? 0);
  return n;
}

/**
 * Janela de horário da classe. Evento, resposta e aviso ao time não têm janela.
 * O lembrete com prazo mora na do transacional [revisão]: o prazo é declarado
 * por quem chama e não pode abrir a madrugada.
 */
export function janelaDaClasse(classe: Classe, reg: Regulamento): JanelaHorario | null {
  if (ehFria(classe)) return reg.janelaFrio;
  if (classe === 'transacional_agenda_p3' || classe === 'lembrete_p1') return reg.janelaTransacional;
  return null;
}

/** Classifica o erro de um envio. Só 'linha' alimenta o freio. */
export type TipoErro = 'linha' | 'destino' | 'outro';

/**
 * Erro de LINHA: instância fora, desconectada, 5xx, timeout, 429 [crítica].
 * Número inválido (4xx comum) é do DESTINO e não freia ninguém.
 * O "em cooldown" do zapiPost é 'outro': o zapiPost abre o cooldown em qualquer
 * 4xx, número inválido inclusive, então contá-lo como linha faria duas fichas
 * com telefone ruim calarem o lembrete de 5 min por 15 min.
 */
export function classificarErroEnvio(erro: unknown): TipoErro {
  const s = String(erro instanceof Error ? erro.message : (erro ?? '')).toLowerCase();
  if (!s.trim()) return 'outro';
  if (/em cooldown/.test(s)) return 'outro';
  if (/instance not found|disconnected|desconectad|not connected|enqueue message is disabled|session (closed|expired)/.test(s)) return 'linha';
  if (/http 5\d\d|http 429|http 408|too many requests|timeout|timed out|etimedout|econnreset|econnrefused|enotfound|socket hang up|fetch failed|aborted/.test(s)) return 'linha';
  if (/http 4\d\d/.test(s)) return 'destino';
  return 'outro';
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE EFETIVA E BOLHAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O robô que vale para ESTE pedido. Robô de 1 destino por chamada (o humano no
 * CRM) com mais de um destino na chamada é lote, e lote só sai pelo robô de
 * lote dele, que é frio [revisão]. Robô sem registro é frio.
 */
export function metaDoPedido(pedido: Pick<Pedido, 'robo' | 'destinosNaChamada'>): MetaRobo {
  const meta = metaDoRobo(pedido.robo) ?? ROBO_DESCONHECIDO;
  const n = pedido.destinosNaChamada;
  if (meta.roboDeLote && typeof n === 'number' && n > 1) return metaDoRobo(meta.roboDeLote) ?? ROBO_DESCONHECIDO;
  return meta;
}

/**
 * A classe que vale para ESTE pedido, agora. Ninguém declara classe: ela sai do
 * robô, e só três coisas mudam:
 * 1. destino da equipe vira aviso_interno;
 * 2. reativo sem mensagem do destino nos últimos 15 min vira FRIO, tenha ou não
 *    conversa nas últimas 24h [crítica]. O P3 é só de robô de agenda; um
 *    reativo atrasado rebaixado a P3 deixava um lote do CRM para quem escreveu
 *    ontem sair a 24/h, fora do orçamento do frio [revisão];
 * 3. robô de agenda com prazo em até 90 min (e até 5 min depois dele) vira P1.
 */
export function classeEfetiva(
  meta: MetaRobo, pedido: Pedido, estado: Pick<Estado, 'equipe' | 'destino'>, agora: number,
  reg: Regulamento = REGULAMENTO_PADRAO,
): Classe {
  let classe = meta.classe;
  if (ehDestinoInterno(pedido.destino, estado.equipe ?? [])) {
    classe = 'aviso_interno_p2';
  } else if (classe === 'reativo_p1') {
    const entrada = estado.destino?.ultimaEntradaEm;
    const desde = typeof entrada === 'number' ? Math.max(0, agora - entrada) : Infinity;
    if (!(desde >= 0 && desde <= reg.reativoJanelaMs)) classe = 'frio_p5';
  }
  const prazo = pedido.prazo;
  if (meta.podeTerPrazo && typeof prazo === 'number' && Number.isFinite(prazo)
    && (classe === 'transacional_agenda_p3' || classe === 'aviso_interno_p2')
    && prazo >= agora - reg.prazoP1ToleranciaMs && prazo <= agora + reg.prazoP1AntesMs) {
    classe = 'lembrete_p1';
  }
  return classe;
}

/** Bolhas que este envio pode usar: 1 toque = 1 mensagem, mais a do Pix. */
export function bolhasPermitidas(meta: MetaRobo, classe: Classe, pedido: Pedido, reg: Regulamento = REGULAMENTO_PADRAO): number {
  const porClasse: Record<Classe, number> = {
    evento_p0: reg.bolhasEvento,
    reativo_p1: reg.bolhasReativo,
    lembrete_p1: reg.bolhasTransacional,
    aviso_interno_p2: reg.bolhasAviso,
    transacional_agenda_p3: reg.bolhasTransacional,
    frio_receita_p4: reg.bolhasFrio,
    frio_p5: reg.bolhasFrio,
  };
  const teto = Math.max(1, Math.min(meta.maxBolhas, porClasse[classe]));
  const pedidas = Number.isFinite(pedido.bolhas) ? Math.floor(pedido.bolhas!) : teto;
  return Math.max(1, Math.min(pedidas, teto)) + (pedido.temPix ? reg.bolhaExtraPix : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// TETOS DERIVADOS (exportados para o teste conferir o mesmo número)
// ─────────────────────────────────────────────────────────────────────────────

export interface TetosVigentes {
  frioHora: number;
  frioDia: number;
  rampa: { linhaHora: number; linhaDia: number } | null;
}

/**
 * Tetos do frio e da rampa que valem agora. Fora da rampa: 6/h e 30/24h. Na
 * rampa, a conta do HEAD [código lineThrottle.ts:90-95, :236-238]: o dia da
 * rampa menos a reserva, nunca menos de 1.
 */
export function tetosVigentes(estado: Pick<Estado, 'reconectadoEm' | 'rampaForcadaEm'>, agora: number, reg: Regulamento = REGULAMENTO_PADRAO): TetosVigentes {
  const marcas = [estado.reconectadoEm, estado.rampaForcadaEm].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const desde = marcas.length ? Math.max(...marcas) : null;
  const d = degrauDaRampa(reg, desde, agora);
  if (!d) return { frioHora: reg.frioPorHora, frioDia: reg.frioPorDia, rampa: null };
  const dia = Math.min(reg.linhaDiaBase, d.dia);
  return {
    frioHora: Math.min(reg.frioPorHora, d.frioHora),
    frioDia: Math.max(1, dia - Math.min(reg.reservaTransacionalDia, dia - 1)),
    rampa: { linhaHora: Math.min(reg.linhaHora, d.linhaHora), linhaDia: Math.min(reg.linhaDia, d.linhaDia) },
  };
}

/** Pedidos esperando com prioridade de CLASSE maior, entre as classes dadas. */
function esperandoAcima(estado: Estado, classe: Classe, entre: readonly Classe[]): number {
  const e = estado.esperando;
  if (!e) return 0;
  let n = 0;
  for (const c of entre) if (PRIORIDADE[c] < PRIORIDADE[classe]) n += Math.max(0, e[c] ?? 0);
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECIDIR
// ─────────────────────────────────────────────────────────────────────────────

const TODAS: readonly Classe[] = CLASSES;
const PROATIVAS: readonly Classe[] = CLASSES.filter(ehProativa);
const FRIAS: readonly Classe[] = CLASSES.filter(ehFria);
const RAMPA: readonly Classe[] = CLASSES.filter(naRampa);

/**
 * Levanta TODAS as travas do pedido (não para na primeira), para o 'adiar'
 * apontar o instante em que todas liberam. Exportado para a sombra e o teste.
 */
export function travasDoPedido(estado: Estado, pedido: Pedido, agora: number, reg: Regulamento = REGULAMENTO_PADRAO): {
  meta: MetaRobo; classe: Classe; custo: number; travas: Trava[]; esperarMs: number;
} {
  const meta = metaDoPedido(pedido);
  const classe = classeEfetiva(meta, pedido, estado, agora, reg);
  const custo = bolhasPermitidas(meta, classe, pedido, reg);
  const travas: Trava[] = [];
  const semente = pedido.chave ?? `${pedido.robo}|${pedido.destino}`;
  const antigo = estado.maisAntigoEm ?? {};
  const ult = estado.ultimoEm ?? {};

  /** Instante em que uma vaga da janela abre: o mais antigo sai, ou o ritmo médio. */
  const vaga = (grupo: GrupoJanela, janelaMs: number, teto: number): number => {
    const a = antigo[grupo];
    if (typeof a === 'number' && Number.isFinite(a) && a + janelaMs > agora) return a + janelaMs;
    return agora + Math.ceil(janelaMs / Math.max(1, teto));
  };
  const trava = (motivo: Motivo, libera: number, escopo: Escopo = 'linha') => travas.push({ motivo, libera, escopo });

  // ── Chave repetida: o mesmo toque já saiu (4 relógios no mesmo tick) ──────
  const reservada = estado.destino?.chaveReservadaEm;
  if (pedido.chave && typeof reservada === 'number' && agora - reservada < reg.chaveJanelaMs) {
    trava('chave_repetida', reservada + reg.chaveJanelaMs, 'destino');
  }

  // ── Pausa humana: segue o HEAD robô a robô; todo frio respeita ───────────
  const respeitaPausa = meta.respeitaPausa || ehFria(classe);
  const pausa = estado.destino?.pausa;
  if (respeitaPausa && classe !== 'aviso_interno_p2' && pausa && Number.isFinite(pausa.ultimaFalaEm)
    && agora - pausa.ultimaFalaEm <= reg.pausaSilencioMs) {
    trava('pausa_humana', pausa.ultimaFalaEm + reg.pausaSilencioMs, 'destino');
  }

  // ── Freio de erro de linha ────────────────────────────────────────────────
  const ultErro = estado.ultimoErroLinhaEm;
  const freioAtivo = estado.errosLinhaSeguidos >= reg.freioErros
    && typeof ultErro === 'number' && agora < ultErro + reg.freioMs;
  // A proativa espera o freio acabar; o evento vai para a caixa, que não perde
  // nada; a resposta e o lembrete viram a sonda da linha: tentam no máximo 1 vez
  // a cada 5 min, e o primeiro ok desarma o freio para todo mundo.
  if (freioAtivo) {
    const urgenteSonda = classe === 'reativo_p1' || classe === 'lembrete_p1';
    if (!urgenteSonda) trava('freio_de_erro', ultErro! + reg.freioMs);
    else if (agora < ultErro! + reg.freioSondaUrgenteMs) trava('freio_de_erro', ultErro! + reg.freioSondaUrgenteMs);
  }

  // ── Emergência: o único teto do P0 e do P1, e vale para todos ─────────────
  const total1h = somar(estado, '1h', TODAS);
  const total24h = somar(estado, '24h', TODAS);
  if (total1h + custo > reg.emergenciaHora) trava('teto_emergencia', vaga('total_1h', HORA, reg.emergenciaHora));
  if (total24h + custo > reg.emergenciaDia) trava('teto_emergencia', vaga('total_24h', 24 * HORA, reg.emergenciaDia));

  // ── Lembrete com prazo: o prazo vem de quem chama [revisão] ───────────────
  // Sem isto, um robô de agenda pedindo com prazo=agora+60min mandava 39 frios
  // em 6 min, inclusive de madrugada (o 02/10, pior). O P1 pelo prazo continua
  // na janela do transacional e numa rajada própria. Resposta e evento, não.
  if (classe === 'lembrete_p1') {
    const jl = janelaDaClasse(classe, reg);
    if (jl && !dentroDaJanela(jl, agora)) trava('fora_da_janela', proximaAbertura(jl, agora));
    const lembretes10 = somar(estado, '10min', ['lembrete_p1']);
    if (lembretes10 + custo > reg.rajadaMaxLembrete) {
      trava('rajada_lembrete', vaga('lembrete_10min', reg.rajadaJanelaMs, reg.rajadaMaxLembrete));
    }
  }

  if (ehUrgente(classe)) {
    // Espaçamento curto: vira espera em processo, nunca 'adiar'.
    const fis = ult.fisica;
    const falta = typeof fis === 'number' ? fis + reg.espacoUrgenteMs - agora : 0;
    const esperarMs = Math.max(0, Math.min(reg.esperaMaxEmProcessoMs, falta));
    return { meta, classe, custo, travas, esperarMs };
  }

  // ═══ Daqui para baixo: P2 a P5, as proativas ═══════════════════════════════

  // ── Janela ────────────────────────────────────────────────────────────────
  const janela = janelaDaClasse(classe, reg);
  if (janela && !dentroDaJanela(janela, agora)) trava('fora_da_janela', proximaAbertura(janela, agora));

  // ── Anti-rajada de 10 min e espaçamento entre proativas ───────────────────
  const proativas10 = somar(estado, '10min', PROATIVAS);
  if (proativas10 + custo > reg.rajadaMaxProativas) {
    trava('rajada_10min', vaga('proativa_10min', reg.rajadaJanelaMs, reg.rajadaMaxProativas));
  }
  if (typeof ult.proativa === 'number') {
    const jitter = Math.floor(sorteio(`${semente}|p|${ult.proativa}`) * reg.jitterProativaMs);
    const libera = ult.proativa + reg.espacoProativaMs + jitter;
    if (agora < libera) trava('espaco_proativa', libera);
  }

  // ── Total da hora: a proativa não leva a linha ao nível de atenção ────────
  // O aviso URGENTE ao time (lead novo) fica fora desta conta: vai para contato
  // salvo da equipe, não para estranho, e segurá-lo atrás de uma hora cheia de
  // resposta e lembrete atrasa a ligação para o lead. Continua no teto da linha,
  // na rajada, no espaçamento e na emergência.
  if (!(classe === 'aviso_interno_p2' && meta.urgente) && total1h + custo > reg.totalProativoHora) {
    trava('teto_proativo_total', vaga('total_1h', HORA, reg.totalProativoHora));
  }

  // ── Teto da linha para P2 a P5, com a vaga de quem tem prioridade maior ───
  const linha1h = somar(estado, '1h', PROATIVAS);
  const linha24h = somar(estado, '24h', PROATIVAS);
  const acima = esperandoAcima(estado, classe, PROATIVAS);
  if (linha1h + custo > reg.linhaHora) trava('teto_linha_hora', vaga('linha_1h', HORA, reg.linhaHora));
  else if (linha1h + custo > reg.linhaHora - acima) trava('reservado_prioridade_maior', vaga('linha_1h', HORA, reg.linhaHora));
  if (linha24h + custo > reg.linhaDia) trava('teto_linha_dia', vaga('linha_24h', 24 * HORA, reg.linhaDia));
  else if (linha24h + custo > reg.linhaDia - acima) trava('reservado_prioridade_maior', vaga('linha_24h', 24 * HORA, reg.linhaDia));

  // ── Volume sustentado para quem não está conversando ─────────────────────
  // Segura o pico de 3h e de 6h. NÃO segura classe errada na escala da hora
  // (ver o regulamento e a dívida cravada no chefeQuedas).
  const entrada = estado.destino?.ultimaEntradaEm;
  const temConversa = typeof entrada === 'number' && Math.max(0, agora - entrada) <= reg.conversaVivaMs;
  if (naRampa(classe) && !temConversa) {
    const s3 = Math.max(0, estado.semConversa?.['3h'] ?? 0);
    const s6 = Math.max(0, estado.semConversa?.['6h'] ?? 0);
    if (s3 + custo > reg.sustentado3h) trava('volume_sustentado', vaga('semConversa_3h', 3 * HORA, reg.sustentado3h));
    if (s6 + custo > reg.sustentado6h) trava('volume_sustentado', vaga('semConversa_6h', 6 * HORA, reg.sustentado6h));
  }

  // ── Rampa de reconexão (P3 a P5) ──────────────────────────────────────────
  const tetos = tetosVigentes(estado, agora, reg);
  if (tetos.rampa && naRampa(classe)) {
    const r1h = somar(estado, '1h', RAMPA);
    const r24h = somar(estado, '24h', RAMPA);
    if (r1h + custo > tetos.rampa.linhaHora) trava('rampa_hora', vaga('rampa_1h', HORA, tetos.rampa.linhaHora));
    if (r24h + custo > tetos.rampa.linhaDia) trava('rampa_dia', vaga('rampa_24h', 24 * HORA, tetos.rampa.linhaDia));
  }

  // ── Frio (P4 e P5) ────────────────────────────────────────────────────────
  if (ehFria(classe)) {
    // Reserva do transacional na linha: o frio não pega as últimas vagas.
    const reservaHora = Math.max(reg.reservaFrioHora, acima);
    if (linha1h + custo > reg.linhaHora - reservaHora) trava('reserva_transacional', vaga('linha_1h', HORA, reg.linhaHora));
    if (linha24h + custo > reg.linhaDia - reg.reservaTransacionalDia) trava('reserva_transacional', vaga('linha_24h', 24 * HORA, reg.linhaDia));

    // Orçamento do frio, com a vaga do frio de receita que está esperando.
    const frio1h = somar(estado, '1h', FRIAS);
    const frio24h = somar(estado, '24h', FRIAS);
    const reservaP4 = classe === 'frio_p5' ? Math.max(0, estado.esperando?.frio_receita_p4 ?? 0) : 0;
    if (frio1h + custo > tetos.frioHora) trava('teto_frio_hora', vaga('frio_1h', HORA, tetos.frioHora));
    else if (frio1h + custo > tetos.frioHora - reservaP4) trava('reservado_prioridade_maior', vaga('frio_1h', HORA, tetos.frioHora));
    if (frio24h + custo > tetos.frioDia) trava('teto_frio_dia', vaga('frio_24h', 24 * HORA, tetos.frioDia));
    else if (frio24h + custo > tetos.frioDia - reservaP4) trava('reservado_prioridade_maior', vaga('frio_24h', 24 * HORA, tetos.frioDia));

    // Espaçamento do frio: 10 a 15 min do último envio carimbado (frio ou
    // agenda, como o HEAD) e 2 min de qualquer outra mensagem física.
    const marcas = [ult.carimbado, ult.frio].filter((x): x is number => typeof x === 'number');
    if (marcas.length) {
      const ultimo = Math.max(...marcas);
      const jitter = Math.floor(sorteio(`${semente}|f|${ultimo}`) * reg.jitterFrioMs);
      const libera = ultimo + reg.espacoFrioMs + jitter;
      if (agora < libera) trava('espaco_frio', libera);
    }
    if (typeof ult.fisica === 'number' && agora < ult.fisica + reg.espacoFrioAposOutroMs) {
      trava('espaco_frio', ult.fisica + reg.espacoFrioAposOutroMs);
    }
  }

  // ── Sublimite do aviso ao time (o urgente não entra em cartão) ────────────
  if (classe === 'aviso_interno_p2' && !meta.urgente) {
    const avisos1h = somar(estado, '1h', ['aviso_interno_p2']);
    if (avisos1h + custo > reg.avisoHora) trava('sublimite_aviso', vaga('aviso_1h', HORA, reg.avisoHora));
  }

  return { meta, classe, custo, travas, esperarMs: 0 };
}

/**
 * A decisão. Sempre uma de três, nunca 'descartar'.
 *
 * - Nenhuma trava: enviar_agora, com o maxBolhas e a espera curta em processo.
 * - Travou e o robô nasce de evento: caixa_de_saida (nunca 'adiar'). Com o
 *   motivo chave_repetida, quem drena a caixa confere a chave antes de mandar:
 *   se o toque já saiu, só marca como feito.
 * - Travou: adiar até o instante em que a ÚLTIMA trava libera (todas precisam
 *   liberar), mais um sorteio de 0 a 90 s, nunca menos de 60 s à frente. Se
 *   alguma trava é da linha, o escopo é 'linha' (o robô para a rodada).
 */
export function decidir(estado: Estado, pedido: Pedido, agora: number | Date, reg: Regulamento = REGULAMENTO_PADRAO): Decisao {
  const t = typeof agora === 'number' ? agora : agora.getTime();
  const { meta, classe, custo, travas, esperarMs } = travasDoPedido(estado, pedido, t, reg);
  const prioridade = prioridadeFina(classe, meta.subprioridade);

  if (travas.length === 0) {
    return { acao: 'enviar_agora', maxBolhas: custo, esperarMs, classe, prioridade };
  }

  const daLinha = travas.filter(x => x.escopo === 'linha');
  const candidatas = daLinha.length ? daLinha : travas;
  const alvo = candidatas.reduce((a, b) => (b.libera > a.libera ? b : a));

  if (meta.nasceDeEvento) {
    return { acao: 'caixa_de_saida', motivo: alvo.motivo, classe, prioridade };
  }

  const semente = pedido.chave ?? `${pedido.robo}|${pedido.destino}`;
  const jitter = Math.floor(sorteio(`${semente}|a|${alvo.motivo}|${Math.floor(t / 60000)}`) * reg.adiarJitterMs);
  const ate = Math.max(t + reg.adiarPisoMs, alvo.libera) + jitter;
  return { acao: 'adiar', ate, motivo: alvo.motivo, escopo: alvo.escopo, classe, prioridade };
}
