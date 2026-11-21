import type { CardVendido } from '../services/gerador/fichaEletroposto';
import { credenciaisTrello } from '../services/gerador/dossieVenda';
import { ErroCadastro, comTrava } from '../services/gerador/cadastroVendaBanco';
import { lerDocsComVersao } from '../services/gerador/docsClienteBanco';
import { registrarArquivoNoSlot } from '../services/gerador/docsRegistrar';
import { mudarJornada, ehRecusa, type Recusa } from '../services/gerador/jornadaSolarBanco';
import type { EstadoJornada } from '../services/gerador/jornadaSolar';
import type { EstadoObra } from '../services/gerador/jornadaObra';
import { lerCardsPorIds, lerLigacao } from '../services/gerador/vendaSolarHub';
import { gravarRegistroTrello, lerRegistroTrello, registroTrelloVazio } from '../services/gerador/trelloVendaSolar';
import { lerAnexoPorIa } from '../services/gerador/trelloHomologIa';
import { gravarRegistroHomolog, lerRegistroHomolog } from '../services/gerador/trelloHomologBanco';
import { AUTOR_TRELLO, autorDaConclusaoAutomatica, elegivelParaHomolog, sincroniaDevida, type RegistroHomolog } from '../services/gerador/trelloHomologPuro';
import { baixarAnexoDoTrello, lerCartaoHomologacao } from '../services/gerador/trelloHomologTrello';
import { sincronizarHomologacao, type DepsHomolog } from '../services/gerador/trelloHomologSync';
import { waitUntil } from '../utils/waitUntil';

// ─────────────────────────────────────────────────────────────────────────────
// HOMOLOGAÇÃO LIDA DO TRELLO (20/11/2026): o passo 5 (etapa 3) é espelho do cartão. Este arquivo liga a sincronia (`trelloHomologSync.ts`) à obra: a
// elegibilidade, a trava (uma sincronia por obra de cada vez, sem esperar), o intervalo de 10 min, a conclusão automática e os três gatilhos
// (GET da obra, fila das 08:00 e os testes). Falha do Trello nunca quebra quem chama: tudo aqui é "melhor esforço" e só deixa o código no log.
//
// CONCLUSÃO AUTOMÁTICA: com a sincronia dizendo que o obrigatório está completo (parecer aprovado no cartão + arquivo do parecer), a etapa 3 conclui pelo
// MESMO caminho da manual (`concluirEtapa3PeloTrello`, em `geradorJornadaSolar.ts`: ela só GRAVA, e recusa se a etapa da vez não for a 3). Nada aqui nem lá
// envia mensagem: o aviso "É sua" é do tick, que lê o histórico. QUEM assina (e portanto se avisa) está em `autorDaConclusaoAutomatica`
// (`trelloHomologPuro.ts`): é o único ponto a ajustar.
// ─────────────────────────────────────────────────────────────────────────────

const logErro = (que: string, err: unknown): void =>
  console.error(`[trello-homolog] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

/** Mais que o pior caso de uma rodada (download e IA com tempo limite): o dono vivo nunca perde a trava; se o processo morrer, ela expira sozinha. */
const TTL_TRAVA_MS = 300_000;

export type ResultadoHomolog = 'inelegivel' | 'sem_cartao' | 'recente' | 'ocupado' | 'sem_credencial' | 'falhou' | 'sincronizou' | 'concluiu';

export interface EntradaHomolog {
  js: EstadoJornada | null;
  jo: Pick<EstadoObra, 'fechada'> | null;
  /** O id do cartão guardado na ligação da venda (24 hex), se o registro do Trello não o tiver. */
  cardIdLig?: string | null;
  origem: 'tela' | 'fila';
  /** Só na fila: a fila do dia do Thiago ou a do Diego já saiu? */
  filaDosDonosSaiu?: boolean;
}

/** O que entra de fora (rede, banco, IA, relógio): troca nos testes. */
export interface IoHomolog {
  agora: () => Date;
  deps: (card: CardVendido, js: EstadoJornada) => DepsHomolog;
  cardId: (card: number) => Promise<string | null>;
  lerRegistro: (card: number) => Promise<RegistroHomolog>;
  trava: <T>(card: number, fn: () => Promise<T>) => Promise<T | 'ocupado'>;
  concluir: (card: CardVendido, autor: string) => Promise<'concluiu' | 'nao_pronto' | 'ignorada'>;
}

/** As dependências reais de UMA obra. */
function depsReais(card: CardVendido, js: EstadoJornada): DepsHomolog {
  const codigo = String(card.id);
  return {
    agora: () => new Date(),
    credenciais: credenciaisTrello,
    lerCartao: lerCartaoHomologacao,
    baixar: baixarAnexoDoTrello,
    lerPorIa: (a) => lerAnexoPorIa(a),
    slotsComArquivo: async () => new Set((await lerDocsComVersao('vendasolar', codigo)).reg.arquivos.map((a) => a.slot)),
    anexosEnviados: async () => new Set(Object.values((await lerRegistroTrello(card.id)).anexados)),
    registrar: (e) => registrarArquivoNoSlot({ codigo, slot: e.slot, mime: e.mime, bytes: e.bytes, por: 'trello', antes: e.antes }),
    // Marca o arquivo no registro do envio ao Trello (a chave é o id do documento): o cartão não recebe de volta o que ele mesmo mandou. Mesma trava do
    // botão, sem esperar: ocupada, o anexo fica para a próxima rodada.
    marcarNoTrello: async (cartaoId, docId, anexoId) => {
      try {
        await comTrava(`trello:${card.id}`, 'trello', async () => {
          const lido = await lerRegistroTrello(card.id);
          const reg = lido.card_id === cartaoId ? lido : { ...registroTrelloVazio(), card_id: cartaoId };
          await gravarRegistroTrello(card.id, { ...reg, anexados: { ...reg.anexados, [docId]: anexoId } });
        }, 60_000, { tentativas: 1, esperaMs: 0 });
        return true;
      } catch (err) { logErro('marcar anexo', err); return false; }
    },
    preencherProtocolo: async (p) => {
      const r = await mudarJornada(card.id, () => js, (e) => {
        if (e.etapas[3].protocolo || e.etapas[3].concluida_em) return { recusa: 'ja_tinha', http: 200 } as Recusa;
        return {
          ...e, etapas: { ...e.etapas, 3: { ...e.etapas[3], protocolo: { numero: p.numero, em: p.em } } },
          historico: [...e.historico, { em: new Date().toISOString(), por: AUTOR_TRELLO, acao: 'protocolo' as const, etapa: 3 }].slice(-50),
        };
      });
      return ehRecusa(r) ? 'ja_tinha' : 'preencheu';
    },
    lerRegistro: () => lerRegistroHomolog(card.id),
    gravarRegistro: (r) => gravarRegistroHomolog(card.id, r),
  };
}

const ioReal: IoHomolog = {
  agora: () => new Date(),
  deps: depsReais,
  cardId: async (card) => (await lerRegistroTrello(card)).card_id,
  lerRegistro: lerRegistroHomolog,
  trava: async (card, fn) => {
    try { return await comTrava(`homolog:${card}`, 'trello', fn, TTL_TRAVA_MS, { tentativas: 1, esperaMs: 0 }); } catch (err) {
      if (err instanceof ErroCadastro && err.codigo === 'ocupado') return 'ocupado';
      throw err;
    }
  },
  // `import()` por causa do ciclo de módulos: `geradorJornadaSolar` chama este arquivo no GET.
  concluir: async (card, autor) => (await import('./geradorJornadaSolar')).concluirEtapa3PeloTrello(card, autor),
};

/**
 * Sincroniza a homologação de UMA obra e, se o obrigatório fechou, conclui a etapa 3. Só obra COM cartão (do registro do Trello ou da ligação), com a
 * etapa 3 aberta, sem cancelar e sem a fase 2 fechada; o chamador já garantiu que a obra não é finalizada. Nunca lança quando `io` é o real.
 */
export async function homologarObra(card: CardVendido, e: EntradaHomolog, io: IoHomolog = ioReal): Promise<ResultadoHomolog> {
  if (!e.js || !elegivelParaHomolog(e.js, e.jo)) return 'inelegivel';
  const cardId = (await io.cardId(card.id)) ?? e.cardIdLig ?? null;
  if (!cardId) return 'sem_cartao';
  if (!sincroniaDevida(await io.lerRegistro(card.id), io.agora().getTime())) return 'recente';
  const js = e.js;
  const sync = await io.trava(card.id, async () => {
    // Relido DENTRO da trava: dois GETs juntos fazem uma sincronia só.
    if (!sincroniaDevida(await io.lerRegistro(card.id), io.agora().getTime())) return null;
    return sincronizarHomologacao(cardId, io.deps(card, js));
  });
  if (sync === 'ocupado') return 'ocupado';
  if (!sync) return 'recente';
  if (sync.acao === 'sem_credencial') return 'sem_credencial';
  if (sync.acao === 'falhou') return 'falhou';
  if (!sync.completo_agora) return 'sincronizou';
  const autor = autorDaConclusaoAutomatica({ completoAntes: sync.completo_antes, origem: e.origem, filaDosDonosSaiu: e.filaDosDonosSaiu === true });
  return (await io.concluir(card, autor)) === 'concluiu' ? 'concluiu' : 'sincronizou';
}

/** O gatilho do GET da obra: em segundo plano, sem segurar a resposta. A tela mostra o que já estava gravado. Nunca lança. */
export function dispararHomologacao(card: CardVendido, l: { estado: EstadoJornada | null; obraEstado: Pick<EstadoObra, 'fechada'> | null; lig: { trello_card?: string | null } }): void {
  try {
    if (!l.estado || !elegivelParaHomolog(l.estado, l.obraEstado)) return;
    waitUntil(homologarObra(card, { js: l.estado, jo: l.obraEstado, cardIdLig: l.lig.trello_card ?? null, origem: 'tela' }).then(() => undefined, (err) => logErro('sincronia', err)));
  } catch (err) { logErro('disparo', err); }
}

/** O gatilho da fila das 08:00 (uma obra). Espera terminar, porque a fila logo depois já deve ver o estado novo. Nunca lança. */
export async function homologarDaFila(cardNum: number, js: EstadoJornada | null, jo: Pick<EstadoObra, 'fechada'> | null, filaDosDonosSaiu: boolean, io: IoHomolog = ioReal): Promise<void> {
  try {
    if (!js || !elegivelParaHomolog(js, jo)) return;
    const card = (await lerCardsPorIds([cardNum])).get(cardNum);
    if (!card) return;
    // O cartão da ligação vale como no GET (obra cujo registro do Trello não tem o id).
    const cardIdLig = await lerLigacao(cardNum).then((r) => r.lig.trello_card ?? null, () => null);
    await homologarObra(card, { js, jo, cardIdLig, origem: 'fila', filaDosDonosSaiu }, io);
  } catch (err) { logErro('fila', err); }
}
