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
//   O lembrete com prazo (P1 pelo prazo) para destino de fora ainda mora na
//   janela do transacional (7h–21h) e numa rajada própria de 6 em 10 min
//   [revisão]: o prazo vem de quem chama. O teto próprio de 28/h e 150/24h só
//   vale para o lembrete que não é agenda (regra do dono, abaixo).
// - O teto da linha (24/h e 200/24h) vale para P2 a P5. A proativa também não
//   empurra o TOTAL da hora, urgente incluído, acima de 40.
// - O mesmo robô não passa de 6 mensagens em 10 min somando o lembrete com
//   prazo e as proativas dele [revisão], fora da agenda (abaixo).
// - O freio de erro conta só erro de LINHA, nunca número inválido. Durante o
//   freio, a resposta e o lembrete viram a sonda da linha (1 tentativa a cada
//   5 min); a proativa espera 15 min; o evento vai para a caixa.
// - A pausa humana segue o HEAD robô a robô (respeitaPausa em CLASSE_POR_ROBO):
//   a agenda do eletroposto e a vendedora reativa passam; a Duda, a Giovanna, as
//   boas-vindas e a cobrança do SIM esperam. Todo frio espera a conversa esfriar
//   (aperto novo para o frio da linha solardoc, que hoje não confere).
// - Reativo atrasado vira frio, com ou sem conversa nas últimas 24h [crítica],
//   menos a resposta a quem pediu para remarcar (ep_remarcar_reativo), que é
//   agenda: com conversa em 24h vira transacional de agenda [regra do dono].
//   DÍVIDA: a oferta fria mora nos mesmos arquivos e pode pedir com esse nome;
//   fecha com o passaporte por chamada (chefeQuedas e chefeGuarda cravam).
//   O manual_crm é de 1 destino por chamada: chamada com mais é lote e é
//   decidida como o robô de lote (frio) [revisão].
// - Aviso ao time só vale com destino interno; para estranho, vira frio. Grupo
//   não é interno por padrão: só o da lista explícita, ou para o robô de grupo
//   [revisão].
// - 'adiar' tem escopo: 'linha' faz o robô parar a rodada; 'destino' faz o robô
//   pular para o próximo candidato (pausa e chave repetida são do destino).
//
// AGENDA NUNCA BLOQUEIA [regra do dono, 07/10/2026; memória
// agenda-nunca-bloqueia.md]. Pedido de robô de agenda (classes.ts, campo agenda)
// cuja classe efetiva não caiu para frio:
// - nunca é segurado por freio de VOLUME: teto total da hora (40), teto da linha
//   (24/h e 200/24h), vaga guardada para prioridade maior, volume sustentado,
//   rampa e o teto próprio do lembrete (28/h e 150/24h). Ele conta em todos,
//   para o frio ver a linha ocupada e ceder;
// - o que só ESPAÇA (a rajada global de proativas e a do lembrete, o espaço de
//   25 a 60 s entre proativas e a emergência) adia a agenda só DENTRO da janela
//   útil: até Pedido.validoAte menos 3 min. No último momento útil a agenda sai
//   assim mesmo, e o 'adiar' nunca aponta para depois desse limite;
// - no último momento útil ela sai só com o espaçamento curto entre mensagens
//   (10 s, espera em processo), como o urgente;
// - o que ainda a para (DURO): a linha caída (freio de erro), a chave repetida
//   (o toque já saiu), a pausa humana robô a robô como no HEAD, a janela do
//   transacional (7h–21h) para destino de fora e a cadência própria da
//   remarcação do NÃO ATENDEU (1 a cada 15 min). A rajada por robô (6 em 10
//   min) NÃO para a agenda [rodada 4]: dura no último momento útil, ela cortava
//   lembrete legítimo depois de uma queda curta (3 itens no dia das duas faixas
//   com as carteiras do solar e 40 min de linha fora). Ela continua valendo
//   para todo o resto;
// - a linha caída segura a agenda, mas NUNCA a descarta: o toque cujo fim útil
//   caiu dentro da queda (provada pelo livro, Estado.quedaRecente) continua vivo
//   e é REENVIADO na volta, como lembrete atrasado, só com o espaçamento curto
//   (agendaRepresadaPelaLinha, abaixo). Durante o freio, a agenda no último
//   momento útil é a sonda da linha (1 tentativa a cada 5 min), para sair logo
//   que a linha volta. O pedido de agenda que chega depois do fim útil SEM essa
//   prova é tratado como agenda sem prazo, só espaçada;
// - dentro dos 60/h da emergência as últimas vagas ficam para o evento e a
//   agenda (e, por medida, para a resposta e o aviso de lead novo ao time):
//   quem cede é o frio e o resto proativo.
// O preço, escrito: sem a rajada por robô na agenda, o robô frio pedindo com o
// nome de um robô de agenda só é segurado pela guarda arquivo → robôs
// (chefeGuarda) e pelo que só espaça; os números pioraram e estão cravados como
// DÍVIDA no chefeQuedas. A defesa completa é o passaporte por chamada.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Classe, MetaRobo, CLASSES, PRIORIDADE, ROBO_DESCONHECIDO,
  ehUrgente, ehProativa, ehFria, naRampa, metaDoRobo, prioridadeFina, ehAgendaDoPedido,
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
  | 'frio_1h' | 'frio_24h' | 'proativa_10min' | 'lembrete_10min' | 'lembrete_1h' | 'lembrete_24h' | 'robo_10min' | 'linha_1h' | 'linha_24h'
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
  /** Físicas do MESMO robô do pedido nos últimos 10 min, somando lembrete com prazo e proativas. */
  doRobo10min?: number;
  /** Último envio do MESMO robô do pedido (epoch ms), qualquer classe. Decide a cadência própria. */
  ultimoDoRoboEm?: number | null;
  /** Últimos envios (epoch ms). `carimbado` = último envio de robô que o HEAD conta (frio ou agenda). */
  ultimoEm?: { fisica?: number | null; proativa?: number | null; frio?: number | null; carimbado?: number | null };
  maisAntigoEm?: Partial<Record<GrupoJanela, number>>;
  /** Erros de LINHA seguidos desde o último envio ok. Número inválido não entra. */
  errosLinhaSeguidos: number;
  ultimoErroLinhaEm?: number | null;
  /**
   * A última QUEDA da linha vista no livro: `de` = o 1º erro de linha da última
   * sequência de erros; `voltouEm` = o 1º envio ok depois do último erro de
   * linha (null = a linha ainda não voltou). É a prova, do próprio CHEFE, de que
   * foi a linha que segurou a agenda (agendaRepresadaPelaLinha).
   */
  quedaRecente?: { de: number; voltouEm: number | null } | null;
  /** Última volta da linha (monitor). Arma a rampa de 72h. */
  reconectadoEm?: number | null;
  /** Rampa forçada à mão (LINHA_RECONECTADA_EM). Vale a mais recente das duas. */
  rampaForcadaEm?: number | null;
  /** Pedidos vivos esperando vaga, por classe efetiva (a espera viva). */
  esperando?: ContagemPorClasse;
  /** Telefones da equipe: destino daqui vira aviso_interno. */
  equipe?: readonly string[];
  /** Grupos do time (lista explícita): só eles são interno, fora o robô de grupo. */
  gruposInternos?: readonly string[];
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
   * Fim da janela ÚTIL do toque (epoch ms): o lembrete de 1h passou dos 45 min,
   * o bom dia passou das 12h. É por ele que o CHEFE nunca adia agenda para
   * depois do momento útil: passado o limite, ela sai. CONTRATO: robô de agenda
   * com janela própria declara. Sem ele, o fim útil é o prazo mais a tolerância
   * de 5 min; sem os dois, a agenda é só espaçada, sem prazo (nunca descartada),
   * como a remarcação do NÃO ATENDEU.
   *
   * Passado o validoAte, o robô de AGENDA só desiste do toque se a linha não o
   * segurou. Se segurou (agendaRepresadaPelaLinha), o toque continua vivo e é
   * REENVIADO quando a linha volta, como lembrete atrasado: o texto é do robô
   * ("a reunião começou às 9h, o link é este"), o CHEFE só garante que ele sai
   * [regra do dono, 07/10: a linha caída é a única que para a agenda, e na volta
   * a régua é reenviar, não descartar].
   */
  validoAte?: number | null;
  /**
   * Quando o pedido nasceu (epoch ms): a primeira vez que o robô o fez. A janela
   * de 15 min do reativo conta até aqui enquanto o pedido tiver até 2h
   * (reativoEsperaMaxMs), para a espera imposta pelo CHEFE não rebaixar a
   * resposta a frio.
   */
  nascidoEm?: number | null;
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
  | 'rajada_robo'
  | 'cadencia_robo'
  | 'espaco_proativa'
  | 'teto_proativo_total'
  | 'teto_linha_hora'
  | 'teto_linha_dia'
  | 'teto_lembrete_hora'
  | 'teto_lembrete_dia'
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
  /** Trava que só ESPAÇA a agenda dentro da janela útil (cai no último momento útil). */
  mole?: boolean;
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
 * robô, e só quatro coisas mudam:
 * 1. destino interno (telefone da equipe; grupo só da lista explícita ou para
 *    robô de grupo) vira aviso_interno [revisão: grupo qualquer era interno];
 * 2. aviso ao time para destino de FORA vira frio (ou a classe com lead que o
 *    robô declara) [revisão]: o aviso não tem janela, pausa nem orçamento do
 *    frio, então só vale para a equipe. Vem antes do prazo, para o alerta de
 *    10 min mandado a lead não virar lembrete sem pausa;
 * 3. reativo sem mensagem do destino nos 15 min antes do nascimento do pedido
 *    (ou de agora, se o pedido tem mais de 2h) vira FRIO, tenha ou não
 *    conversa nas últimas 24h [crítica]. Um reativo atrasado rebaixado a P3
 *    deixava um lote do CRM para quem escreveu ontem sair a 24/h, fora do
 *    orçamento do frio [revisão]. A exceção é a resposta a quem pediu para
 *    remarcar (robô de agenda): com conversa nas últimas 24h, vira
 *    transacional de agenda, porque a agenda não pode virar frio [regra do
 *    dono, 07/10];
 * 4. robô de agenda com prazo em até 90 min (e até 5 min depois dele) vira P1.
 */
export function classeEfetiva(
  meta: MetaRobo, pedido: Pedido, estado: Pick<Estado, 'equipe' | 'gruposInternos' | 'destino'>, agora: number,
  reg: Regulamento = REGULAMENTO_PADRAO,
): Classe {
  let classe = meta.classe;
  if (ehDestinoInterno(pedido.destino, estado.equipe ?? [], { grupos: estado.gruposInternos ?? [], roboDeGrupo: meta.roboDeGrupo })) {
    classe = 'aviso_interno_p2';
  } else if (classe === 'aviso_interno_p2') {
    classe = meta.classeComLead ?? 'frio_p5';
  } else if (classe === 'reativo_p1') {
    const entrada = estado.destino?.ultimaEntradaEm;
    const nasc = pedido.nascidoEm;
    // A espera que o próprio CHEFE impõe não rebaixa a resposta: os 15 min contam
    // até o nascimento, enquanto o pedido tiver até 2h.
    const ancora = typeof nasc === 'number' && Number.isFinite(nasc) && nasc <= agora && agora - nasc <= reg.reativoEsperaMaxMs
      ? nasc : agora;
    const desde = typeof entrada === 'number' ? Math.max(0, ancora - entrada) : Infinity;
    if (!(desde <= reg.reativoJanelaMs)) {
      const conversa = typeof entrada === 'number' && Math.max(0, agora - entrada) <= reg.conversaVivaMs;
      classe = meta.agenda && conversa ? 'transacional_agenda_p3' : 'frio_p5';
    }
  }
  const prazo = pedido.prazo;
  if (meta.podeTerPrazo && typeof prazo === 'number' && Number.isFinite(prazo)
    && (classe === 'transacional_agenda_p3' || classe === 'aviso_interno_p2')
    && prazo >= agora - reg.prazoP1ToleranciaMs && prazo <= agora + reg.prazoP1AntesMs) {
    classe = 'lembrete_p1';
  }
  return classe;
}

/**
 * Fim da janela útil do pedido (epoch ms), ou null. O validoAte declarado vale;
 * sem ele, o prazo mais a tolerância (o toque de 5 min ainda sai até 3 a 5 min
 * depois do início); sem os dois, null: a agenda é espaçada sem prazo, nunca
 * descartada. A resposta não usa o prazo.
 */
export function fimUtilDoPedido(pedido: Pick<Pedido, 'validoAte' | 'prazo'>, classe: Classe, reg: Regulamento = REGULAMENTO_PADRAO): number | null {
  const v = pedido.validoAte;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const p = pedido.prazo;
  if (classe !== 'reativo_p1' && typeof p === 'number' && Number.isFinite(p)) return p + reg.prazoP1ToleranciaMs;
  return null;
}

/**
 * AGENDA REPRESADA PELA LINHA NUNCA EXPIRA [regra do dono, 07/10/2026; memória
 * agenda-nunca-bloqueia.md]. Responde se um pedido de agenda cujo fim útil já
 * passou foi segurado pela LINHA CAÍDA: então ele continua vivo e é REENVIADO
 * quando a linha volta, em vez de o robô desistir dele.
 *
 * A prova sai do estado do próprio CHEFE (Estado.quedaRecente, montado do
 * livro), nunca de um campo declarado por quem chama, que viraria passe livre
 * como o prazo inventado: o fim útil caiu dentro da última queda, isto é,
 * depois do 1º erro de linha da sequência (com a folga da sonda, 5 min, para a
 * linha que morreu antes da 1ª tentativa) e antes do 1º envio ok da volta (ou a
 * linha ainda está fora). Nesse intervalo nenhum envio saiu: o toque não tinha
 * como sair no último momento útil dele.
 *
 * ESCOLHA DOCUMENTADA: o toque cujo momento passou durante a queda (o lembrete
 * de 5 min de uma reunião que já começou, o alerta de 10 min ao consultor) SAI
 * na volta, marcado como atrasado; o robô troca o texto para o de lembrete
 * atrasado ("a reunião começou às 9h, o link é este"). Na volta ele fica no
 * último momento útil: nada que só espaça o segura, sai com o espaçamento curto
 * entre mensagens (10 s), na frente de qualquer frio. O que é duro continua
 * valendo (janela do transacional para lead, pausa humana do HEAD, chave
 * repetida, cadência própria): o toque espera, mas não morre.
 *
 * O pedido de agenda que chega depois do fim útil SEM essa prova (prazo ou
 * validoAte no passado sem queda nenhuma) não ganha o último momento útil: é
 * tratado como agenda sem prazo, só espaçada. Sem isto, um prazo vencido
 * declarado por quem chama soltava 39 toques às 7h02 de domingo, um a cada 10 s.
 */
export function agendaRepresadaPelaLinha(
  meta: MetaRobo, classe: Classe, fimUtil: number | null, estado: Pick<Estado, 'quedaRecente'>,
  reg: Regulamento = REGULAMENTO_PADRAO,
): boolean {
  if (!ehAgendaDoPedido(meta, classe) || fimUtil === null || !Number.isFinite(fimUtil)) return false;
  const q = estado.quedaRecente;
  if (!q || !Number.isFinite(q.de)) return false;
  return fimUtil > q.de - reg.freioSondaUrgenteMs && (q.voltouEm === null || fimUtil <= q.voltouEm);
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
 *
 * `agenda` diz se o pedido é de agenda e `limiteUtil` é o fim da janela útil
 * menos a margem (null = sem prazo). Para a agenda, as travas que só espaçam
 * vêm marcadas `mole` e somem no último momento útil.
 */
export function travasDoPedido(estado: Estado, pedido: Pedido, agora: number, reg: Regulamento = REGULAMENTO_PADRAO): {
  meta: MetaRobo; classe: Classe; custo: number; travas: Trava[]; esperarMs: number; agenda: boolean; limiteUtil: number | null;
} {
  const meta = metaDoPedido(pedido);
  const classe = classeEfetiva(meta, pedido, estado, agora, reg);
  const custo = bolhasPermitidas(meta, classe, pedido, reg);
  const agenda = ehAgendaDoPedido(meta, classe);
  const interno = ehDestinoInterno(pedido.destino, estado.equipe ?? [], { grupos: estado.gruposInternos ?? [], roboDeGrupo: meta.roboDeGrupo });
  const fim = agenda ? fimUtilDoPedido(pedido, classe, reg) : null;
  // Passou do fim útil (com a margem do tick): só a agenda represada pela linha
  // caída guarda o último momento útil; o resto vira agenda sem prazo, só espaçada.
  const passou = fim !== null && agora > fim + reg.agendaMargemUtilMs;
  const represada = passou && agendaRepresadaPelaLinha(meta, classe, fim, estado, reg);
  const limiteUtil = fim === null || (passou && !represada) ? null : fim - reg.agendaMargemUtilMs;
  // Último momento útil: não cabe mais um 'adiar' (piso de 60 s) antes do limite.
  const ultimoMomento = limiteUtil !== null && agora + reg.adiarPisoMs > limiteUtil;
  const travas: Trava[] = [];
  const semente = pedido.chave ?? `${pedido.robo}|${pedido.destino}`;
  const antigo = estado.maisAntigoEm ?? {};
  const ult = estado.ultimoEm ?? {};

  /** Espaçamento curto entre mensagens (10 s), em processo: o do urgente e o da agenda no último momento útil. */
  const esperaCurta = (): number => {
    const fis = ult.fisica;
    const falta = typeof fis === 'number' ? fis + reg.espacoUrgenteMs - agora : 0;
    return Math.max(0, Math.min(reg.esperaMaxEmProcessoMs, falta));
  };
  /** Instante em que uma vaga da janela abre: o mais antigo sai, ou o ritmo médio. */
  const vaga = (grupo: GrupoJanela, janelaMs: number, teto: number): number => {
    const a = antigo[grupo];
    if (typeof a === 'number' && Number.isFinite(a) && a + janelaMs > agora) return a + janelaMs;
    return agora + Math.ceil(janelaMs / Math.max(1, teto));
  };
  /** Trava DURA: vale para todos, agenda inclusive. */
  const trava = (motivo: Motivo, libera: number, escopo: Escopo = 'linha') => travas.push({ motivo, libera, escopo });
  /**
   * Trava que só ESPAÇA: dura para quem não é agenda; para a agenda, adia só
   * dentro da janela útil e some no último momento útil [regra do dono].
   */
  const espaca = (motivo: Motivo, libera: number) => {
    if (agenda && ultimoMomento) return;
    travas.push({ motivo, libera, escopo: 'linha', mole: agenda });
  };

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

  // ── Freio de erro de linha: a linha caída é o que para a agenda ───────────
  const ultErro = estado.ultimoErroLinhaEm;
  const freioAtivo = estado.errosLinhaSeguidos >= reg.freioErros
    && typeof ultErro === 'number' && agora < ultErro + reg.freioMs;
  // A proativa espera o freio acabar; o evento vai para a caixa, que não perde
  // nada; a resposta, o lembrete e a agenda no último momento útil (a represada
  // inclusive) viram a sonda da linha: tentam no máximo 1 vez a cada 5 min, e o
  // primeiro ok desarma o freio para todo mundo. A linha caída é o freio que a
  // regra do dono deixa parar a agenda (e a régua, quando ela volta, é de
  // reenvio, não de descarte): sem a sonda, a agenda represada dormia os 15 min
  // do freio depois da volta (medido: 10 min parada com a linha já de pé).
  if (freioAtivo) {
    const urgenteSonda = classe === 'reativo_p1' || classe === 'lembrete_p1' || (agenda && ultimoMomento);
    if (!urgenteSonda) trava('freio_de_erro', ultErro! + reg.freioMs);
    else if (agora < ultErro! + reg.freioSondaUrgenteMs) trava('freio_de_erro', ultErro! + reg.freioSondaUrgenteMs);
  }

  // ── Emergência: o único teto do P0 e do P1, e vale para todos ─────────────
  // As últimas vagas da hora (a reserva) ficam para o evento e a agenda: quem
  // cede é o frio e o resto proativo. O frio e a proativa comum já param em 40;
  // aqui param antes dos 60 o resto (o lembrete que não é agenda). A resposta e
  // o aviso urgente ao time (lead novo) NÃO cedem, por medida (chefeQuedas): com
  // a reserva valendo para eles, a resposta segurada no pico esperava horas e
  // virava frio, e o aviso de lead novo esperava 104 min na caixa no dia real
  // do solar. Para a agenda a emergência só espaça, e no último momento útil
  // ela sai assim mesmo [regra do dono, 07/10].
  const total1h = somar(estado, '1h', TODAS);
  const total24h = somar(estado, '24h', TODAS);
  const naoCede = classe === 'evento_p0' || classe === 'reativo_p1' || agenda || (classe === 'aviso_interno_p2' && meta.urgente);
  const reservaUrgente = naoCede ? 0 : reg.reservaEmergenciaHora;
  const tetoHoraEmergencia = reg.emergenciaHora - reservaUrgente;
  if (total1h + custo > tetoHoraEmergencia) espaca('teto_emergencia', vaga('total_1h', HORA, tetoHoraEmergencia));
  if (total24h + custo > reg.emergenciaDia) espaca('teto_emergencia', vaga('total_24h', 24 * HORA, reg.emergenciaDia));

  // ── Rajada por robô: lembrete com prazo e proativas do mesmo robô ─────────
  // A rajada do lembrete e a das proativas são contadas à parte; sem esta, o
  // mesmo robô passava 11 em 10 min com metade dos pedidos com prazo [revisão].
  // FORA DA AGENDA [regra do dono; rodada 4]: dura, ela já tinha sido gasta pelos
  // outros toques do mesmo robô quando o lembrete chegava ao último momento útil,
  // e o lembrete expirava (medido: 3 no dia das duas faixas com o solar e 40 min
  // de linha fora às 8h). Para a agenda, o que espaça é a rajada global (que só
  // espaça dentro da janela útil). Contra o robô frio pedindo com o nome de um
  // robô de agenda fica a guarda arquivo → robôs (dívida cravada no chefeQuedas).
  if (!agenda && (classe === 'lembrete_p1' || ehProativa(classe))) {
    const doRobo = Math.max(0, estado.doRobo10min ?? 0);
    if (doRobo + custo > reg.rajadaMaxPorRobo) trava('rajada_robo', vaga('robo_10min', reg.rajadaJanelaMs, reg.rajadaMaxPorRobo));
  }

  // ── Cadência própria: a remarcação do NÃO ATENDEU, 1 a cada 15 min ────────
  // Espaçada, nunca em rajada (a de 02/10 foi 39 em 55 min), nunca cortada.
  const ultDoRobo = estado.ultimoDoRoboEm;
  if (meta.cadenciaPropria && typeof ultDoRobo === 'number' && Number.isFinite(ultDoRobo)
    && agora < ultDoRobo + reg.cadenciaPropriaMs) {
    trava('cadencia_robo', ultDoRobo + reg.cadenciaPropriaMs);
  }

  // ── Lembrete com prazo: o prazo vem de quem chama [revisão] ───────────────
  // Sem isto, um robô de agenda pedindo com prazo=agora+60min mandava 39 frios
  // em 6 min, inclusive de madrugada (o 02/10, pior). O P1 pelo prazo continua
  // na janela do transacional (para destino de fora: o alerta ao time não tem
  // janela) e numa rajada própria. O teto próprio de hora e de dia só vale para
  // o lembrete que não é agenda [regra do dono, 07/10].
  if (classe === 'lembrete_p1') {
    const jl = janelaDaClasse(classe, reg);
    if (!interno && jl && !dentroDaJanela(jl, agora)) trava('fora_da_janela', proximaAbertura(jl, agora));
    const lembretes10 = somar(estado, '10min', ['lembrete_p1']);
    if (lembretes10 + custo > reg.rajadaMaxLembrete) {
      espaca('rajada_lembrete', vaga('lembrete_10min', reg.rajadaJanelaMs, reg.rajadaMaxLembrete));
    }
    if (!agenda) {
      if (somar(estado, '1h', ['lembrete_p1']) + custo > reg.lembreteHora) trava('teto_lembrete_hora', vaga('lembrete_1h', HORA, reg.lembreteHora));
      if (somar(estado, '24h', ['lembrete_p1']) + custo > reg.lembreteDia) trava('teto_lembrete_dia', vaga('lembrete_24h', 24 * HORA, reg.lembreteDia));
    }
  }

  if (ehUrgente(classe)) {
    // Espaçamento curto: vira espera em processo, nunca 'adiar'.
    return { meta, classe, custo, travas, esperarMs: esperaCurta(), agenda, limiteUtil };
  }

  // ═══ Daqui para baixo: P2 a P5, as proativas ═══════════════════════════════

  // ── Janela ────────────────────────────────────────────────────────────────
  const janela = janelaDaClasse(classe, reg);
  if (janela && !dentroDaJanela(janela, agora)) trava('fora_da_janela', proximaAbertura(janela, agora));

  // ── Anti-rajada de 10 min e espaçamento entre proativas ───────────────────
  const proativas10 = somar(estado, '10min', PROATIVAS);
  if (proativas10 + custo > reg.rajadaMaxProativas) {
    espaca('rajada_10min', vaga('proativa_10min', reg.rajadaJanelaMs, reg.rajadaMaxProativas));
  }
  if (typeof ult.proativa === 'number') {
    const jitter = Math.floor(sorteio(`${semente}|p|${ult.proativa}`) * reg.jitterProativaMs);
    const libera = ult.proativa + reg.espacoProativaMs + jitter;
    if (agora < libera) espaca('espaco_proativa', libera);
  }

  const linha1h = somar(estado, '1h', PROATIVAS);
  const linha24h = somar(estado, '24h', PROATIVAS);
  const acima = esperandoAcima(estado, classe, PROATIVAS);

  // ── Freios de VOLUME: a agenda conta neles, mas nenhum a segura ───────────
  // [regra do dono, 07/10] Teto total da hora, teto da linha, vaga guardada,
  // volume sustentado e rampa. Quem cede quando falta espaço é o frio.
  if (!agenda) {
    // O aviso URGENTE ao time (lead novo) fica fora do total da hora e do teto
    // da linha: vai para contato salvo da equipe, não para estranho, e segurá-lo
    // atrás de uma hora cheia atrasa a ligação para o lead. Desde que a agenda
    // não é mais segurada pelo teto da linha, ela sozinha enche os 24/h de
    // manhã, e o aviso de lead novo esperava 37 min na caixa (medido no controle
    // de uma reunião a cada 15 min). Continua na rajada, no espaçamento e na
    // emergência, com a reserva (para em 50 na hora).
    const avisoUrgente = classe === 'aviso_interno_p2' && meta.urgente;
    // Total da hora: a proativa não leva a linha ao nível de atenção.
    if (!avisoUrgente && total1h + custo > reg.totalProativoHora) {
      trava('teto_proativo_total', vaga('total_1h', HORA, reg.totalProativoHora));
    }

    // Teto da linha para P2 a P5, com a vaga de quem tem prioridade maior.
    if (!avisoUrgente) {
      if (linha1h + custo > reg.linhaHora) trava('teto_linha_hora', vaga('linha_1h', HORA, reg.linhaHora));
      else if (linha1h + custo > reg.linhaHora - acima) trava('reservado_prioridade_maior', vaga('linha_1h', HORA, reg.linhaHora));
      if (linha24h + custo > reg.linhaDia) trava('teto_linha_dia', vaga('linha_24h', 24 * HORA, reg.linhaDia));
      else if (linha24h + custo > reg.linhaDia - acima) trava('reservado_prioridade_maior', vaga('linha_24h', 24 * HORA, reg.linhaDia));
    }

    // Volume sustentado para quem não está conversando. Segura o pico de 3h e
    // de 6h. NÃO segura classe errada (ver o regulamento e o chefeQuedas).
    const entrada = estado.destino?.ultimaEntradaEm;
    const temConversa = typeof entrada === 'number' && Math.max(0, agora - entrada) <= reg.conversaVivaMs;
    if (naRampa(classe) && !temConversa) {
      const s3 = Math.max(0, estado.semConversa?.['3h'] ?? 0);
      const s6 = Math.max(0, estado.semConversa?.['6h'] ?? 0);
      if (s3 + custo > reg.sustentado3h) trava('volume_sustentado', vaga('semConversa_3h', 3 * HORA, reg.sustentado3h));
      if (s6 + custo > reg.sustentado6h) trava('volume_sustentado', vaga('semConversa_6h', 6 * HORA, reg.sustentado6h));
    }
  }

  // ── Rampa de reconexão (P3 a P5 que não são agenda) ───────────────────────
  const tetos = tetosVigentes(estado, agora, reg);
  if (!agenda && tetos.rampa && naRampa(classe)) {
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

  // ── Sublimite do aviso ao time (o urgente e a agenda não entram em cartão) ─
  if (classe === 'aviso_interno_p2' && !meta.urgente && !agenda) {
    const avisos1h = somar(estado, '1h', ['aviso_interno_p2']);
    if (avisos1h + custo > reg.avisoHora) trava('sublimite_aviso', vaga('aviso_1h', HORA, reg.avisoHora));
  }

  // A agenda no último momento útil (e a represada pela linha, que já passou
  // dele) sai só com o espaçamento curto entre mensagens: o espaço de 25 a 60 s
  // entre proativas é dos que só espaçam, e caiu.
  return { meta, classe, custo, travas, esperarMs: agenda && ultimoMomento ? esperaCurta() : 0, agenda, limiteUtil };
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
 * - AGENDA [regra do dono, 07/10]: o que só espaça nunca empurra o 'adiar' para
 *   depois do limite útil (fim da janela útil menos 3 min). Só uma trava dura
 *   (linha caída, chave, pausa, janela, cadência) passa dele. A rajada por robô
 *   não vale para a agenda.
 */
export function decidir(estado: Estado, pedido: Pedido, agora: number | Date, reg: Regulamento = REGULAMENTO_PADRAO): Decisao {
  const t = typeof agora === 'number' ? agora : agora.getTime();
  const { meta, classe, custo, travas, esperarMs, agenda, limiteUtil } = travasDoPedido(estado, pedido, t, reg);
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
  let ate = Math.max(t + reg.adiarPisoMs, alvo.libera) + jitter;
  if (agenda && limiteUtil !== null) {
    // Só o duro passa do limite útil. Fora do último momento útil, t + piso cabe
    // antes do limite, então o 'adiar' fica entre t + 60 s e o limite.
    const duras = travas.filter(x => !x.mole);
    const liberaDura = duras.reduce((m, x) => Math.max(m, x.libera), -Infinity);
    if (liberaDura <= limiteUtil) ate = Math.max(t + reg.adiarPisoMs, Math.min(ate, limiteUtil));
  }
  return { acao: 'adiar', ate, motivo: alvo.motivo, escopo: alvo.escopo, classe, prioridade };
}
