// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — ESTADO a partir de um livro de envios, em memória.
//
// O livro de produção (chefe_envio) vai devolver os agregados por RPC, contados
// no servidor. Esta função faz a MESMA conta sobre uma lista em memória. Serve
// a duas coisas: o replay das quedas no teste e o replay offline de um dia real
// do livro, que é como a sombra mede atraso por classe sem tocar na linha.
//
// PURA: recebe o livro, o instante e os extras; devolve o Estado.
// ─────────────────────────────────────────────────────────────────────────────

import { Classe, CLASSES, ehProativa, ehFria, naRampa } from './classes';
import { Estado, ContagemPorClasse, GrupoJanela, JanelaContagem, TipoErro } from './decidir';
import { chaveDoContato } from './destinos';

/** Uma linha do livro: uma chamada de envio (com N bolhas físicas). */
export interface EnvioLivro {
  em: number;
  robo: string;
  classe: Classe;
  destino: string;
  /** Mensagens físicas desta chamada. */
  bolhas: number;
  ok: boolean;
  /** Tipo do erro quando ok=false. Só 'linha' alimenta o freio. */
  erro?: TipoErro | null;
  /** O destino NÃO escreveu nas últimas 24h quando o envio saiu. */
  semConversa?: boolean;
  /** Robô que o HEAD conta (tem prefixo em BOT_SENT_PREFIXES). */
  carimbado?: boolean;
  chave?: string;
}

export interface ExtrasEstado {
  /** Destino e chave do pedido que vai ser decidido (para a parte do destino). */
  destino?: string;
  chave?: string;
  /** Robô do pedido (para a rajada por robô e a cadência própria). */
  robo?: string;
  /** Última mensagem recebida, por chave do contato (chaveDoContato). */
  entradas?: ReadonlyMap<string, number>;
  /** Pausa humana ativa: última fala, por chave do contato. */
  pausas?: ReadonlyMap<string, number>;
  reconectadoEm?: number | null;
  rampaForcadaEm?: number | null;
  esperando?: ContagemPorClasse;
  equipe?: readonly string[];
  /** Grupos do time (lista explícita). */
  gruposInternos?: readonly string[];
}

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const JANELAS: ReadonlyArray<[JanelaContagem, number]> = [
  ['10min', 10 * MIN], ['1h', HORA], ['3h', 3 * HORA], ['6h', 6 * HORA], ['24h', 24 * HORA],
];

/** Grupo de cada janela "mais antigo": quem conta e em que janela. */
const GRUPOS: ReadonlyArray<[GrupoJanela, number, (e: EnvioLivro) => boolean]> = [
  ['frio_1h', HORA, e => ehFria(e.classe)],
  ['frio_24h', 24 * HORA, e => ehFria(e.classe)],
  ['proativa_10min', 10 * MIN, e => ehProativa(e.classe)],
  ['lembrete_10min', 10 * MIN, e => e.classe === 'lembrete_p1'],
  ['lembrete_1h', HORA, e => e.classe === 'lembrete_p1'],
  ['lembrete_24h', 24 * HORA, e => e.classe === 'lembrete_p1'],
  ['linha_1h', HORA, e => ehProativa(e.classe)],
  ['linha_24h', 24 * HORA, e => ehProativa(e.classe)],
  ['total_1h', HORA, () => true],
  ['total_24h', 24 * HORA, () => true],
  ['rampa_1h', HORA, e => naRampa(e.classe)],
  ['rampa_24h', 24 * HORA, e => naRampa(e.classe)],
  ['aviso_1h', HORA, e => e.classe === 'aviso_interno_p2'],
  ['semConversa_3h', 3 * HORA, e => naRampa(e.classe) && !!e.semConversa],
  ['semConversa_6h', 6 * HORA, e => naRampa(e.classe) && !!e.semConversa],
];

/** Monta o Estado que a RPC devolveria, a partir do livro em memória. */
export function montarEstado(livro: readonly EnvioLivro[], agora: number, extras: ExtrasEstado = {}): Estado {
  const contagens: Partial<Record<JanelaContagem, ContagemPorClasse>> = {};
  for (const [j] of JANELAS) {
    const c: ContagemPorClasse = {};
    for (const k of CLASSES) c[k] = 0;
    contagens[j] = c;
  }
  const semConversa = { '3h': 0, '6h': 0 };
  let doRobo10min = 0;
  let ultimoDoRoboEm: number | null = null;
  const ultimoEm: NonNullable<Estado['ultimoEm']> = { fisica: null, proativa: null, frio: null, carimbado: null };
  const maisAntigoEm: Partial<Record<GrupoJanela, number>> = {};
  const max = (a: number | null | undefined, b: number) => (typeof a === 'number' && a > b ? a : b);

  for (const e of livro) {
    if (!e.ok || e.em > agora) continue;
    const idade = agora - e.em;
    for (const [j, ms] of JANELAS) {
      if (idade < ms) contagens[j]![e.classe] = (contagens[j]![e.classe] ?? 0) + e.bolhas;
    }
    if (naRampa(e.classe) && e.semConversa) {
      if (idade < 3 * HORA) semConversa['3h'] += e.bolhas;
      if (idade < 6 * HORA) semConversa['6h'] += e.bolhas;
    }
    // Rajada por robô: o mesmo robô, lembrete com prazo e proativas, em 10 min.
    if (extras.robo !== undefined && e.robo === extras.robo && idade < 10 * MIN
      && (ehProativa(e.classe) || e.classe === 'lembrete_p1')) {
      doRobo10min += e.bolhas;
      const atual = maisAntigoEm.robo_10min;
      if (atual === undefined || e.em < atual) maisAntigoEm.robo_10min = e.em;
    }
    // Cadência própria: o último envio do mesmo robô, qualquer classe.
    if (extras.robo !== undefined && e.robo === extras.robo) ultimoDoRoboEm = max(ultimoDoRoboEm, e.em);
    ultimoEm.fisica = max(ultimoEm.fisica, e.em);
    if (ehProativa(e.classe)) ultimoEm.proativa = max(ultimoEm.proativa, e.em);
    if (ehFria(e.classe)) ultimoEm.frio = max(ultimoEm.frio, e.em);
    if (e.carimbado) ultimoEm.carimbado = max(ultimoEm.carimbado, e.em);
    for (const [g, ms, entra] of GRUPOS) {
      if (idade < ms && entra(e)) {
        const atual = maisAntigoEm[g];
        if (atual === undefined || e.em < atual) maisAntigoEm[g] = e.em;
      }
    }
  }

  // Erros de linha seguidos: do fim do livro para trás, até o último ok.
  // Erro de destino e 'outro' não contam nem zeram.
  let errosLinhaSeguidos = 0;
  let ultimoErroLinhaEm: number | null = null;
  const ordenado = livro.filter(e => e.em <= agora).sort((a, b) => b.em - a.em);
  for (const e of ordenado) {
    if (e.ok) break;
    if (e.erro === 'linha') {
      errosLinhaSeguidos++;
      if (ultimoErroLinhaEm === null) ultimoErroLinhaEm = e.em;
    }
  }

  const k = chaveDoContato(extras.destino);
  let chaveReservadaEm: number | null = null;
  if (extras.chave) {
    for (const e of livro) if (e.ok && e.chave === extras.chave && e.em <= agora) chaveReservadaEm = max(chaveReservadaEm, e.em);
  }
  const pausaEm = k ? extras.pausas?.get(k) : undefined;

  return {
    contagens,
    semConversa,
    doRobo10min,
    ultimoDoRoboEm,
    ultimoEm,
    maisAntigoEm,
    errosLinhaSeguidos,
    ultimoErroLinhaEm,
    reconectadoEm: extras.reconectadoEm ?? null,
    rampaForcadaEm: extras.rampaForcadaEm ?? null,
    esperando: extras.esperando,
    equipe: extras.equipe,
    gruposInternos: extras.gruposInternos,
    destino: {
      ultimaEntradaEm: k ? (extras.entradas?.get(k) ?? null) : null,
      pausa: typeof pausaEm === 'number' ? { ultimaFalaEm: pausaEm } : null,
      chaveReservadaEm,
    },
  };
}
