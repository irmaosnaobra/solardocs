// ─────────────────────────────────────────────────────────────────────────────
// A PORTA DAS AGENTES DA LINHA 5040 (Fase B, B1c-1). NADA aqui envia mensagem nem chama IA.
//
// A recepção antiga responde na hora (webhook, fila e poll); a rodada viva só roda de 2 em 2
// minutos. Sem a posse gravada NA ENTRADA, o robô antigo responderia primeiro, abriria sessão
// e a agente nova nunca assumiria lead novo. Por isso a posse se decide aqui, com o MESMO
// porteiro do ensaio (lerFatosPorteiro + decidirDona), e quem pergunta é cada ponto de corte de
// CONVERSA: webhook /io, fila, poll da recepção e a recepção.
//
//   assumirNaEntrada(telefone, { waId?, texto?, anuncio?, momento? }): true = o robô antigo cala.
//
//   1. nenhum *_vivo ligado: false, sem leitura no banco;
//   2. lead fora do escopo de toda dona ligada: false, sem ler a posse;
//   3. já tem posse: o mesmo que cedeAAgente;
//   4. sem posse: porteiro. A porta assume a DUDA e a HELENA (B2): a dona que o porteiro escolhe só vale se o
//      interruptor dela está ligado e o lead está no escopo dela. Carla, Giovanna, passo 7 (pergunta), ninguém
//      ou outro robô antigo na conversa = false (o antigo faz como hoje).
//      Dona duda/helena e agenteAtendeEste(dona) = assumirPosse por INSERT; 'assumida' = true; 'ja_tinha_dona'
//      (23505: webhook, fila e poll viram a mesma mensagem) = o que o cedeAAgente diz da posse que a
//      outra entrada gravou (viva = true); 'erro' = false;
//   5. qualquer erro de leitura sem posse: false. Falha da porta nunca deixa o lead sem resposta.
//
// Import estático mínimo (posse, interruptores): o webhook e os robôs antigos importam este arquivo.
// O resto (conversa, porteiro, anúncio) entra por import() só no passo 4, que raramente acontece, e
// assim não cria ciclo com os módulos que chamam a porta. Telefone cru nunca vai para o log.
// ─────────────────────────────────────────────────────────────────────────────

import { agenteAtendeEste, assumirPosse, cedeAAgente, chaveDaPosse, lerPosse } from './posse';
import type { AnuncioOrigem, MsgConversa } from './tipos';

export interface DadosDaEntrada {
  /**
   * Id (wa_mensagens) da mensagem que chegou, quando o ponto de corte o conhece. A posse nasce com
   * ate_wa_id = waId - 1, para a rodada viva ainda enxergar a mensagem que abriu a conversa.
   */
  waId?: number | null;
  /** Texto da mensagem que chegou (botão das nossas páginas). Vale só se a conversa não tem texto do lead ainda. */
  texto?: string | null;
  /**
   * O payload da mensagem (o objeto que tem externalAdReply, adContext ou ctwa_clid no topo), como a
   * Fase A já lê. Sem ele, ou sem id de anúncio dentro, vale "sem anúncio" e o porteiro segue para botão e card.
   */
  anuncio?: Record<string, unknown> | null;
  /**
   * O momento da mensagem que abriu a conversa, como vem no payload do Z-API (campo `momment`, em ms; aceita
   * também segundos e ISO). A âncora da posse (`desde`) sai dele menos 60 s. Sem ele (ou fora do razoável) vale agora.
   */
  momento?: number | string | null;
}

const FOLGA_ANCORA_MS = 60_000;
const IDADE_MAXIMA_MOMENTO_MS = 60 * 60_000;

/**
 * A âncora da posse (ISO): momento da mensagem - 60 s, ou null quando o payload não trouxe um momento confiável
 * (ausente, ilegível, no futuro ou de mais de 1 h atrás: ms e segundos misturados cairiam em 1970 e desligariam a
 * âncora). null = a posse usa a hora de agora.
 */
export function ancoraDaPosse(momento: number | string | null | undefined, agora: number = Date.now()): string | null {
  if (momento === null || momento === undefined || momento === '') return null;
  let t = typeof momento === 'number' ? momento : Number(momento);
  if (!Number.isFinite(t)) t = Date.parse(String(momento));
  else if (t > 0 && t < 1e11) t *= 1000;           // segundos
  if (!Number.isFinite(t)) return null;
  if (t > agora + 60_000 || t < agora - IDADE_MAXIMA_MOMENTO_MS) return null;
  return new Date(t - FOLGA_ANCORA_MS).toISOString();
}

const codigoDe = (e: unknown): string => {
  const c = (e as { code?: string } | null)?.code;
  return c ? String(c).slice(0, 20) : 'interno';
};

/**
 * Anúncio do payload -> { adId, produto }. `ok: false` = havia anúncio e não deu para saber de que
 * produto (a Meta não respondeu): ninguém chuta, como no ensaio.
 */
async function resolverAnuncio(payload: Record<string, unknown> | null | undefined): Promise<{ ok: boolean; anuncio: AnuncioOrigem | null }> {
  if (!payload) return { ok: true, anuncio: null };
  const { lerAnuncioDoPayload } = await import('./anuncio');
  const adId = lerAnuncioDoPayload(payload)?.adId ?? null;
  if (!adId) return { ok: true, anuncio: null };
  const { buscarOrigemDoAnuncio, lerMapaCampanhaProduto, produtoDaCampanha } = await import('../io/metaConjuntos');
  const origem = await buscarOrigemDoAnuncio(adId);
  if (!origem.ok) return { ok: false, anuncio: null };
  const mapa = await lerMapaCampanhaProduto();
  return { ok: true, anuncio: { adId, produto: produtoDaCampanha(origem.campanha?.nome, mapa) } };
}

/** Contexto e porteiro entram por import() uma vez só (promessa guardada): chamadas simultâneas esperam o mesmo carregamento. */
let carregando: Promise<{
  lerConversa: typeof import('./contexto').lerConversa;
  lerFatosPorteiro: typeof import('./contexto').lerFatosPorteiro;
  decidirDona: typeof import('./porteiro').decidirDona;
}> | null = null;
function modulosDoPorteiro() {
  carregando ??= Promise.all([import('./contexto'), import('./porteiro')])
    .then(([c, p]) => ({ lerConversa: c.lerConversa, lerFatosPorteiro: c.lerFatosPorteiro, decidirDona: p.decidirDona }))
    .catch(e => { carregando = null; throw e; });
  return carregando;
}

export async function assumirNaEntrada(telefone: string | null | undefined, dados: DadosDaEntrada = {}): Promise<boolean> {
  try {
    // 1 a 3: nada ligado, fora do escopo, ou já tem posse que cede (inclui erro ao ler a posse com o lead no escopo).
    // cedeAAgente não lê banco quando nenhum *_vivo está ligado e não lê a posse quando o lead está fora do escopo.
    if (await cedeAAgente(telefone)) return true;

    // false pode ser "sem posse" ou "posse que não cede" (encerrada, de outra dona): só assume quem não tem NENHUMA.
    // A porta assume a Duda e a Helena: sem nenhuma das duas ligada para este lead, nada mais a fazer (zero leitura de posse).
    const podeDuda = await agenteAtendeEste('duda', telefone);
    const podeHelena = await agenteAtendeEste('helena', telefone);
    if (!podeDuda && !podeHelena) return false;
    const chave = chaveDaPosse(telefone);
    if (!chave) return false;
    // Posse que apareceu entre o cedeAAgente e esta leitura (a outra entrada foi mais rápida): vale o mesmo critério dele.
    if (await lerPosse(chave)) return await cedeAAgente(telefone);

    // 4. sem posse: o mesmo porteiro do ensaio
    const { lerConversa, lerFatosPorteiro, decidirDona } = await modulosDoPorteiro();

    const conv = await lerConversa(chave);
    if (!conv.completa) return false;
    const msgs: MsgConversa[] = [...conv.msgs];
    const texto = String(dados.texto ?? '').trim();
    // A mensagem que chegou pode ainda não estar em wa_mensagens: sem texto do lead na conversa, ela é a primeira.
    if (texto && !msgs.some(m => m.autor === 'lead' && String(m.texto ?? '').trim())) {
      msgs.push({
        id: 0, from_me: false, from_api: null, autor: 'lead', texto, tipo: 'text', media_url: null,
        momment: new Date().toISOString(),
      });
    }

    const anuncio = await resolverAnuncio(dados.anuncio);
    if (!anuncio.ok) return false;

    const fatos = await lerFatosPorteiro(chave, msgs, anuncio.anuncio, { completa: true });
    const decisao = decidirDona(fatos);
    const dona: 'duda' | 'helena' | null =
      decisao.dona === 'duda' && podeDuda ? 'duda' : decisao.dona === 'helena' && podeHelena ? 'helena' : null;
    if (!dona) return false;
    // O mesmo escopo, de novo, no instante de gravar (o cache de 60 s pode ter virado durante as leituras).
    if (!(await agenteAtendeEste(dona, telefone))) return false;

    const ateWaId = typeof dados.waId === 'number' && Number.isFinite(dados.waId) ? dados.waId - 1 : null;
    const r = await assumirPosse(chave, dona, ateWaId, ancoraDaPosse(dados.momento) ?? undefined);
    if (r === 'erro') return false;
    // 'ja_tinha_dona' (23505) = a outra entrada gravou primeiro; a posse é dela e cala o antigo do mesmo jeito.
    return r === 'assumida' ? true : await cedeAAgente(telefone);
  } catch (e) {
    console.error('[agentes5040] a porta falhou: o robô antigo atende', codigoDe(e));
    return false;
  }
}
