import crypto from 'crypto';
import { waitUntil } from '../../utils/waitUntil';
import { baixarObjeto, lerDocsComVersao } from './docsClienteBanco';
import type { ArquivoDoc } from './docsCliente';
import { lerCadastro } from './cadastroVenda';
import { MAX_ARQUIVOS_LIDOS, MAX_BYTES_LIDOS, SLOTS_LIDOS_SOLAR, lerDocumentosDaVenda, ordemDeLeitura } from './cadastroVendaLeitura';
import { comLimite, contextoDaLeitura, logErro } from './cadastroLeituraAuto';
import { aplicarLeitura, obraAbertaParaIa } from './leituraGravacao';
import { legivel, releituraDevida, rodarReleituraDoConsumo } from './leituraConsumo';
import { invalidarCachesHub } from './vendaSolarHub';
import {
  cotaDaVenda, devolver, emEspera, gastoNaHora, lerRegistro, marcadorValido, marcarConsumoRelido, marcarLidos, reservar, soltarMarcador, tomarMarcador,
  type ArquivoLido, type Registro,
} from './leituraRegistro';

// ─────────────────────────────────────────────────────────────────────────────
// LEITURA DO QUE FICOU PENDENTE (19/11/2026). Obra aberta com documentos que a IA ainda não leu (obra antiga, ou envio que falhou): o GET da obra,
// para quem pode pedir "Ler tudo" (`pode.ler_tudo`), conta os pendentes e, se der, começa UMA leitura em lote em segundo plano (`waitUntil`) só com eles.
// Pendente = arquivo de item legível (`SLOTS_LIDOS_SOLAR`) cujo id não está em `arquivos` do registro (`leituraRegistro.ts`) e que NÃO foi enviado há menos
// de 3 min (a leitura do próprio envio ainda pode estar rodando e já cobre o arquivo).
//
// Regras: nunca em obra finalizada, cancelada ou com a conta fechada (`obraAbertaParaIa`; o registro das obras antigas não tem `arquivos`, e todo arquivo
// delas contaria como pendente); uma leitura por vez (a trava da venda e o marcador `rodando`, que com mais de 3 min é velho); o dedupe por sha vale
// (arquivo cujo sha já foi lido só é marcado como lido: é o caso das obras de antes do registro por id, e o download acontece uma vez só, na primeira
// rodada); conta na cota de 20 por hora da VENDA, nunca na da pessoa, e cota cheia não começa; a IA falhando NÃO marca nada como lido, mas guarda a hora
// da falha e o GET só tenta de novo depois de 10 min (o mesmo vale para um arquivo que o armazenamento não entregou); duas falhas seguidas da IA com o
// mesmo conjunto de arquivos os marcam `falhou` e eles param de contar (um envio novo, ou o Trocar, tem id novo); as regras de gravação são as da
// leitura automática (`aplicarLeitura`: só campo vazio, `doc` de origem, marca `ia` no dinheiro, vetos de outra pessoa). Só os arquivos que a IA recebeu
// (`aceitos`) são marcados como lidos. Arquivo que o servidor não consegue ler (objeto sumido, PDF torto, imagem grande demais) é marcado como lido
// para não repetir para sempre; o que não coube em 20 arquivos e 22 MB fica pendente para a rodada seguinte.
// ─────────────────────────────────────────────────────────────────────────────

export interface EstadoLeitura { rodando: boolean; pendentes: number; ultima_em: string | null; /** os itens que a IA lê (o front usa para saber se espera a leitura depois do envio) */ slots?: readonly string[] }
export const SEM_LEITURA: EstadoLeitura = { rodando: false, pendentes: 0, ultima_em: null };
/** No máximo tantos arquivos pendentes são baixados por rodada (o resto fica para a seguinte). */
const MAX_BAIXAR_POR_RODADA = 60;
/** Arquivo enviado há menos que isto não é pendente: a leitura do envio ainda pode estar rodando. */
export const RECENTE_MS = 3 * 60 * 1000;

export const pendentesDe = (arquivos: readonly ArquivoDoc[], r: Registro, agora: number = Date.now()): ArquivoDoc[] => {
  const lidos = new Set(r.arquivos.map((a) => a.id));
  return arquivos.filter((a) => SLOTS_LIDOS_SOLAR.includes(a.slot) && !lidos.has(a.id) && !(agora - Date.parse(a.em) < RECENTE_MS));
};

interface Baixado { arq: ArquivoDoc; bytes: Buffer; sha: string }

type Resultado = 'ok' | 'nada' | 'cota' | 'falhou';
interface Dados { card: { id: number; cliente_nome?: unknown }; nome: string }
/** O que o lote conta ao `rodarEmLote` para soltar o marcador: os arquivos que foram à IA, se a IA RECUSOU o pedido (não passageiro), se o armazenamento falhou e se a fila esvaziou. */
interface Rastro { ids: string[]; naoPassageira: boolean; armazenamento: boolean; fimDaFila: boolean }

async function lote(g: Dados, sinal: { abortado: boolean }, rastro: Rastro): Promise<Resultado> {
  const id = g.card.id;
  const venda = cotaDaVenda(id);
  if (!(await obraAbertaParaIa(id))) return 'nada';
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  const r = await lerRegistro(venda.caminho);
  const pend = pendentesDe(reg.arquivos, r).slice(0, MAX_BAIXAR_POR_RODADA);
  if (!pend.length) { rastro.fimDaFila = true; return 'nada'; }

  // 1) baixa os pendentes UMA vez; o sha diz quais já foram lidos (de antes do registro por id) e quais a IA não consegue ler.
  const conhecidos = new Set([...r.lidos.map((x) => x.sha), ...r.arquivos.flatMap((a) => (a.sha ? [a.sha] : []))]);
  const marcar: ArquivoLido[] = [];
  const novos: Baixado[] = [];
  for (const arq of pend) {
    let bytes: Buffer;
    try { bytes = await baixarObjeto(arq.caminho); } catch (e) {
      if ((e as { codigo?: unknown } | null)?.codigo === 'objeto_ausente') marcar.push({ id: arq.id });   // sumiu do armazenamento: não há o que ler
      else { logErro('baixar pendente', e); rastro.armazenamento = true; }                                // falha do armazenamento: espera 10 min e tenta de novo
      continue;
    }
    const b: Baixado = { arq, bytes, sha: crypto.createHash('sha256').update(bytes).digest('hex') };
    if (conhecidos.has(b.sha) || !legivel(b)) marcar.push({ id: arq.id, sha: b.sha }); else novos.push(b);
  }
  if (marcar.length) await marcarLidos(venda, g.nome, marcar);
  if (!novos.length) { rastro.fimDaFila = !rastro.armazenamento; return 'nada'; }

  // 2) o lote da IA: até 20 arquivos e 22 MB, na ordem de prioridade da leitura (documentos, conta de luz, contrato, procuração, orçamento...).
  const porId = new Map(novos.map((n) => [n.arq.id, n]));
  const escolhidos: Baixado[] = [];
  let total = 0;
  for (const a of ordemDeLeitura(novos.map((n) => n.arq), new Set(), 'vendasolar')) {
    const n = porId.get(a.id);
    if (!n || escolhidos.length >= MAX_ARQUIVOS_LIDOS || total + n.bytes.length > MAX_BYTES_LIDOS) continue;
    escolhidos.push(n); total += n.bytes.length;
  }
  if (!escolhidos.length) return 'nada';
  // Depois de uma falha não passageira com mais de 1 arquivo, um por vez (o de maior prioridade): acha o ruim sem marcar os bons.
  if (r.modo_unico) escolhidos.splice(1);

  // 3) a cota da venda (uma leitura) e a chamada à IA, uma só para o lote.
  const shaLote = crypto.createHash('sha256').update(`lote:${id}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).digest('hex');
  if ((await reservar(venda, g.nome, shaLote, false)) !== 'ok') return 'cota';
  rastro.ids = escolhidos.map((n) => n.arq.id);   // daqui em diante, falha (inclusive o estouro do tempo) conta contra este conjunto
  const cad = await lerCadastro(id, 'vendasolar');
  const ctx = await contextoDaLeitura(id, g.card, cad, reg.arquivos);
  const bytesPorCaminho = new Map(escolhidos.map((n) => [n.arq.caminho, n.bytes]));
  const res = await lerDocumentosDaVenda(escolhidos.map((n) => n.arq), {
    linha: 'vendasolar', ...ctx, baixar: async (caminho) => bytesPorCaminho.get(caminho) ?? baixarObjeto(caminho),
  });
  if (!res.ok || sinal.abortado) {
    await devolver(venda, g.nome, shaLote);
    rastro.naoPassageira = !sinal.abortado && !res.ok && res.motivo === 'ia_indisponivel' && res.transitorio === false;   // 429, 5xx, rede e tempo nunca contam
    return 'falhou';
  }
  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: reg.arquivos, r: res, cad, cancelado: () => sinal.abortado });
  if (sinal.abortado) { await devolver(venda, g.nome, shaLote); return 'falhou'; }
  // Só o que a IA recebeu conta como lido; o que ela não aceitou (não coube, não bateu com o tipo) continua pendente.
  await marcarLidos(venda, g.nome, escolhidos.filter((n) => res.aceitos.includes(n.arq.id)).map((n) => ({ id: n.arq.id, sha: n.sha })), true);
  rastro.ids = [];
  rastro.fimDaFila = escolhidos.length === novos.length && escolhidos.every((n) => res.aceitos.includes(n.arq.id)) && !rastro.armazenamento;   // esvaziou a fila
  if (x.campos.length || x.comercial.length) invalidarCachesHub();
  return 'ok';
}

/** Roda o lote (o marcador `rodando` já é nosso), com limite de tempo, e solta o marcador. Nunca lança. */
async function rodarEmLote(g: Dados): Promise<void> {
  const venda = cotaDaVenda(g.card.id);
  const rastro: Rastro = { ids: [], naoPassageira: false, armazenamento: false, fimDaFila: false };
  const r = await comLimite((sinal) => lote(g, sinal, rastro), 'falhou' as Resultado);
  await soltarMarcador(venda, g.nome, {
    ...(r === 'ok' ? { sucesso: true } : {}),
    ...(r === 'falhou' || rastro.armazenamento ? { falha: true, ids: r === 'falhou' && rastro.naoPassageira ? rastro.ids : [] } : {}),
    ...(r !== 'falhou' && rastro.fimDaFila ? { fimDaFila: true } : {}),
  });
}

/** O consumo médio já está no cadastro? (só se chama com a conta de luz já lida e a marca ainda por gravar) */
const consumoPreenchido = async (card: number): Promise<boolean> =>
  !!(await lerCadastro(card, 'vendasolar')).campos.consumo_medio_kwh?.valor?.trim();

/**
 * O estado da leitura para o GET da obra e, se houver pendentes e nada impedir, o começo da leitura em lote em segundo plano. Só chame para quem tem
 * `pode.ler_tudo`. `aberta`: a obra não está cancelada nem com a conta fechada (a rota já sabe; a finalizada nem chega lá); sem ele, o serviço
 * confere (`obraAbertaParaIa`). Obra fechada: devolve a leitura vazia (0 pendentes) e não começa nada. Nunca lança (qualquer falha vira "sem leitura") e não espera a IA.
 */
export async function leituraDaObra(g: Dados & { arquivos: readonly ArquivoDoc[]; aberta?: boolean }): Promise<EstadoLeitura> {
  try {
    if (!(g.aberta ?? await obraAbertaParaIa(g.card.id))) return SEM_LEITURA;
    const venda = cotaDaVenda(g.card.id);
    const r = await lerRegistro(venda.caminho);
    const pend = pendentesDe(g.arquivos, r);
    let rodando = marcadorValido(r);
    if (pend.length && !rodando && !emEspera(r) && gastoNaHora(r) < venda.limite) {
      // O marcador é pego sob a trava ANTES de responder: dois GETs juntos começam uma leitura só, e o GET seguinte já vê `rodando`.
      rodando = true;
      if (await tomarMarcador(venda, g.nome)) waitUntil(rodarEmLote(g));
    } else if (!pend.length && !r.consumo_relido && releituraDevida(g.arquivos, r, true)) {
      // Nada pendente e a conta de luz já lida, sem a marca `consumo_relido`. Consumo médio já preenchido: grava a marca (uma vez) e os GETs seguintes nem olham
      // o cadastro. Vazio (a leitura antiga não o tirava): UMA releitura só da conta. A marca entra junto do marcador, sob trava, então abrir a obra de novo não
      // repete e dois GETs juntos fazem uma só (`leituraConsumo.ts`).
      if (await consumoPreenchido(g.card.id)) await marcarConsumoRelido(venda, g.nome);
      else if (!rodando && !emEspera(r) && gastoNaHora(r) < venda.limite) {
        rodando = true;
        if (await tomarMarcador(venda, g.nome, true)) waitUntil(rodarReleituraDoConsumo(g));
      }
    }
    return { rodando, pendentes: pend.length, ultima_em: r.ultima_em, slots: SLOTS_LIDOS_SOLAR };
  } catch (e) {
    logErro('estado da leitura', e);
    return SEM_LEITURA;
  }
}
