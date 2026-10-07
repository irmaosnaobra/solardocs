// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — SIMULADOR: passa uma fila de pedidos pelo decidir(), tick a
// tick, como os robôs fazem em produção.
//
// Como os robôs de hoje:
// - robô de tick ('tick') pergunta a cada tick (pg_cron de 2 em 2 min) e, dentro
//   do tick, manda um depois do outro; 'adiar' com escopo 'linha' faz ele parar
//   a rodada, com escopo 'destino' ele pula para o próximo candidato;
// - pedido que nasce de webhook ou de fila ('imediato') pergunta na hora em que
//   chega; se for adiado, ou se o robô parou a rodada antes de chegar nele,
//   volta como robô de tick;
// - erro de envio para a rodada do robô (parar no erro) e devolve o pedido à
//   fila; o livro registra o erro com o tipo, e é dele que sai o freio;
// - o que vai para a caixa de saída fica nela (persistido) e o drenador pergunta
//   de novo a cada tick, sem marca nenhuma: se a resposta é caixa outra vez, o
//   item continua lá; se é enviar_agora, sai. Com o motivo chave_repetida o
//   drenador trata como já enviado e dá baixa (nunca manda duas vezes).
//
// - a fila do tick é por prioridade e, dentro dela, pelo fim da janela útil
//   (validoAte, ou o prazo): quem vence antes pergunta antes, como cada robô de
//   agenda ordena a própria fila por horário. Entre robôs, é o que a espera viva
//   do CHEFE ligado vai fazer;
// - o pedido leva o próprio nascimento (`desde`) como nascidoEm, e passado o
//   validoAte sem sair ele EXPIRA: é a conta da regra do dono (agenda nunca
//   expira por freio do CHEFE).
//
// PURO e determinístico: o mesmo roteiro dá sempre o mesmo resultado. Serve ao
// replay das quedas e ao replay offline de um dia real do livro.
// ─────────────────────────────────────────────────────────────────────────────

import { Classe, ehUrgente, prioridadeFina } from './classes';
import { Regulamento, REGULAMENTO_PADRAO } from './regulamento';
import { Decisao, Motivo, Pedido, TipoErro, ContagemPorClasse, decidir, classeEfetiva, metaDoPedido } from './decidir';
import { EnvioLivro, montarEstado } from './estado';
import { chaveDoContato } from './destinos';

/**
 * Um pedido com hora de nascer. O `validoAte` (do Pedido) é também o ponto em que
 * o robô desiste: passado dele sem sair, o simulador marca como EXPIRADO. É a
 * conta da regra do dono: agenda nunca expira por freio do CHEFE.
 */
export interface PedidoAgendado extends Pedido {
  /** Quando o pedido nasce (epoch ms). Vira o `nascidoEm` do pedido, se ele não trouxer o dele. */
  desde: number;
  modo: 'tick' | 'imediato';
  /** O destino não escreveu nas últimas 24h (conta no volume sustentado). */
  semConversa?: boolean;
  rotulo?: string;
}

export interface Falha {
  de: number;
  ate: number;
  erro: TipoErro;
}

export interface OpcoesSimulacao {
  inicio: number;
  fim: number;
  tickMs?: number;
  reg?: Regulamento;
  /** Intervalos em que todo envio falha com o tipo de erro dado. */
  falhas?: readonly Falha[];
  reconectadoEm?: number | null;
  equipe?: readonly string[];
  /** Grupos do time (lista explícita). */
  gruposInternos?: readonly string[];
  /** Última mensagem recebida por destino (telefone cru; a chave é calculada aqui). */
  entradas?: ReadonlyMap<string, number>;
  pausas?: ReadonlyMap<string, number>;
  /** Livro anterior ao início (o que já saiu antes da janela simulada). */
  livroInicial?: readonly EnvioLivro[];
  /** Tempo que cada bolha ocupa ao sair (digitando + envio). */
  msPorBolha?: number;
}

export interface Enviado {
  pedido: PedidoAgendado;
  em: number;
  bolhas: number;
  classe: Classe;
  tentativas: number;
  /** Saiu pela caixa de saída (o drenador), não na primeira pergunta. */
  viaCaixa: boolean;
}

export interface ResultadoSimulacao {
  enviados: Enviado[];
  caixa: Array<{ pedido: PedidoAgendado; em: number; motivo: Motivo }>;
  pendentes: Array<{ pedido: PedidoAgendado; ultimoMotivo: Motivo | null }>;
  expirados: Array<{ pedido: PedidoAgendado; ultimoMotivo: Motivo | null }>;
  falhas: Array<{ pedido: PedidoAgendado; em: number }>;
  /** Itens da caixa que o drenador baixou como já enviados (chave repetida). */
  deduplicados: Array<{ pedido: PedidoAgendado; em: number }>;
  livro: EnvioLivro[];
  decisoes: number;
  /** Quantas vezes cada motivo apareceu (para o relatório da sombra). */
  motivos: Partial<Record<Motivo, number>>;
}

interface Vivo {
  p: PedidoAgendado;
  proxima: number;
  tentativas: number;
  ultimoMotivo: Motivo | null;
  modo: 'tick' | 'imediato';
  naCaixa: boolean;
}

const chaveMap = (m?: ReadonlyMap<string, number>): Map<string, number> => {
  const out = new Map<string, number>();
  if (!m) return out;
  for (const [tel, t] of m) {
    const k = chaveDoContato(tel);
    if (k) out.set(k, t);
  }
  return out;
};

export function simular(pedidos: readonly PedidoAgendado[], opts: OpcoesSimulacao): ResultadoSimulacao {
  const reg = opts.reg ?? REGULAMENTO_PADRAO;
  const tickMs = opts.tickMs ?? 2 * 60 * 1000;
  const msPorBolha = opts.msPorBolha ?? 3000;
  const entradas = chaveMap(opts.entradas);
  const pausas = chaveMap(opts.pausas);
  const livro: EnvioLivro[] = [...(opts.livroInicial ?? [])];
  const res: ResultadoSimulacao = {
    enviados: [], caixa: [], pendentes: [], expirados: [], falhas: [], deduplicados: [], livro, decisoes: 0, motivos: {},
  };

  const vivos: Vivo[] = pedidos.map(p => ({ p, proxima: p.desde, tentativas: 0, ultimoMotivo: null, modo: p.modo, naCaixa: false }));
  const falhaEm = (t: number): TipoErro | null => {
    for (const f of opts.falhas ?? []) if (t >= f.de && t < f.ate) return f.erro;
    return null;
  };

  // Linha do tempo: os ticks e a chegada de cada pedido imediato.
  const momentos = new Set<number>();
  for (let t = opts.inicio; t < opts.fim; t += tickMs) momentos.add(t);
  for (const v of vivos) if (v.modo === 'imediato' && v.p.desde >= opts.inicio && v.p.desde < opts.fim) momentos.add(v.p.desde);
  const linhaDoTempo = [...momentos].sort((a, b) => a - b);
  let cursor = opts.inicio;

  /** O pedido como o robô o faz: com o nascimento (o `desde`), se não trouxer o dele. */
  const comoPedido = (p: PedidoAgendado): Pedido => (p.nascidoEm === undefined ? { ...p, nascidoEm: p.desde } : p);
  const classeDe = (v: Vivo, t: number): Classe => {
    const meta = metaDoPedido(v.p);
    const k = chaveDoContato(v.p.destino);
    return classeEfetiva(meta, comoPedido(v.p), {
      equipe: opts.equipe, gruposInternos: opts.gruposInternos, destino: { ultimaEntradaEm: k ? entradas.get(k) ?? null : null },
    }, t, reg);
  };
  /** Prazo para a fila: o fim da janela útil, ou o prazo (quem vence antes vai antes). */
  const fimDe = (v: Vivo): number => (typeof v.p.validoAte === 'number' ? v.p.validoAte : v.p.prazo ?? Infinity);
  const ordem = (v: Vivo, t: number): number => {
    const meta = metaDoPedido(v.p);
    return prioridadeFina(classeDe(v, t), meta.subprioridade);
  };

  for (const t of linhaDoTempo) {
    const ehTick = (t - opts.inicio) % tickMs === 0;
    cursor = Math.max(cursor, t);

    // Expira quem passou do prazo de validade sem sair.
    for (let i = vivos.length - 1; i >= 0; i--) {
      const v = vivos[i]!;
      if (typeof v.p.validoAte === 'number' && v.p.validoAte < t) {
        res.expirados.push({ pedido: v.p, ultimoMotivo: v.ultimoMotivo });
        vivos.splice(i, 1);
      }
    }

    const daVez = vivos
      .filter(v => v.p.desde <= t && v.proxima <= t && (v.modo === 'tick' ? ehTick : v.p.desde === t))
      .sort((a, b) => ordem(a, t) - ordem(b, t) || fimDe(a) - fimDe(b) || a.p.desde - b.p.desde);

    const parados = new Set<string>();
    for (const v of daVez) {
      if (parados.has(v.p.robo)) {
        // O robô parou a rodada: o pedido imediato que ficou atrás dele volta
        // como pedido de tick (senão ele nunca mais seria perguntado).
        if (v.modo === 'imediato') { v.modo = 'tick'; v.proxima = t + tickMs; }
        continue;
      }
      const agora = cursor;

      // Espera viva: quem já nasceu e ainda não saiu, por classe efetiva.
      const esperando: ContagemPorClasse = {};
      for (const o of vivos) {
        if (o === v || o.p.desde > agora) continue;
        const c = classeDe(o, agora);
        esperando[c] = (esperando[c] ?? 0) + 1;
      }

      const estado = montarEstado(livro, agora, {
        destino: v.p.destino, chave: v.p.chave, robo: v.p.robo, entradas, pausas,
        reconectadoEm: opts.reconectadoEm ?? null, esperando, equipe: opts.equipe, gruposInternos: opts.gruposInternos,
      });
      const d: Decisao = decidir(estado, comoPedido(v.p), agora, reg);
      res.decisoes++;
      v.tentativas++;

      if (d.acao === 'enviar_agora') {
        const em = agora + d.esperarMs;
        const erro = falhaEm(em);
        const meta = metaDoPedido(v.p);
        livro.push({
          em, robo: v.p.robo, classe: d.classe, destino: v.p.destino, bolhas: d.maxBolhas,
          ok: erro === null, erro, semConversa: v.p.semConversa ?? false,
          carimbado: meta.carimbos.length > 0, chave: v.p.chave,
        });
        cursor = em + d.maxBolhas * msPorBolha;
        if (erro === null) {
          res.enviados.push({ pedido: v.p, em, bolhas: d.maxBolhas, classe: d.classe, tentativas: v.tentativas, viaCaixa: v.naCaixa });
          vivos.splice(vivos.indexOf(v), 1);
        } else {
          // Parar no erro: o robô encerra a rodada e o pedido volta à fila.
          res.falhas.push({ pedido: v.p, em });
          v.modo = 'tick';
          v.proxima = t + tickMs;
          parados.add(v.p.robo);
        }
        continue;
      }

      res.motivos[d.motivo] = (res.motivos[d.motivo] ?? 0) + 1;
      v.ultimoMotivo = d.motivo;
      if (d.acao === 'caixa_de_saida') {
        if (!v.naCaixa) res.caixa.push({ pedido: v.p, em: agora, motivo: d.motivo });
        v.naCaixa = true;
        // Chave repetida: o toque já saiu. O drenador dá baixa, nunca reenvia.
        if (d.motivo === 'chave_repetida') {
          res.deduplicados.push({ pedido: v.p, em: agora });
          vivos.splice(vivos.indexOf(v), 1);
          continue;
        }
        // Fica na caixa; o drenador (process-messages) pergunta de novo no próximo tick.
        v.modo = 'tick';
        v.proxima = t + tickMs;
        continue;
      }
      v.modo = 'tick';
      v.proxima = d.ate;
      // Urgente adiado (emergência, pausa) não para o robô dos outros pedidos.
      if (d.escopo === 'linha' && !ehUrgente(d.classe)) parados.add(v.p.robo);
    }
  }

  for (const v of vivos) {
    if (v.p.desde < opts.fim) res.pendentes.push({ pedido: v.p, ultimoMotivo: v.ultimoMotivo });
  }
  return res;
}

/** Contagem de mensagens físicas por hora de Brasília ('AAAA-MM-DD HHh'). */
export function porHoraBrt(itens: ReadonlyArray<{ em: number; bolhas: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of itens) {
    const d = new Date(it.em - 3 * 60 * 60 * 1000);
    const rotulo = `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}h`;
    out.set(rotulo, (out.get(rotulo) ?? 0) + it.bolhas);
  }
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Maior soma de bolhas em qualquer janela corrida de `janelaMs`. */
export function picoEmJanela(itens: ReadonlyArray<{ em: number; bolhas: number }>, janelaMs: number): number {
  const xs = [...itens].sort((a, b) => a.em - b.em);
  let pico = 0;
  let soma = 0;
  let i = 0;
  for (let j = 0; j < xs.length; j++) {
    soma += xs[j]!.bolhas;
    while (xs[j]!.em - xs[i]!.em >= janelaMs) { soma -= xs[i]!.bolhas; i++; }
    if (soma > pico) pico = soma;
  }
  return pico;
}
