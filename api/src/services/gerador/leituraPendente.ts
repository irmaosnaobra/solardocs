import crypto from 'crypto';
import { waitUntil } from '../../utils/waitUntil';
import { baixarObjeto, lerDocsComVersao } from './docsClienteBanco';
import { assinaturaBate, type ArquivoDoc } from './docsCliente';
import { lerCadastro } from './cadastroVenda';
import { MAX_ARQUIVOS_LIDOS, MAX_BYTES_LIDOS, MAX_IMAGEM_BYTES, SLOTS_LIDOS_SOLAR, lerDocumentosDaVenda, ordemDeLeitura } from './cadastroVendaLeitura';
import { comLimite, contextoDaLeitura, logErro } from './cadastroLeituraAuto';
import { aplicarLeitura } from './leituraGravacao';
import { invalidarCachesHub } from './vendaSolarHub';
import {
  cotaDaVenda, devolver, emEspera, gastoNaHora, lerRegistro, marcadorValido, marcarLidos, reservar, soltarMarcador, tomarMarcador,
  type ArquivoLido, type Registro,
} from './leituraRegistro';

// ─────────────────────────────────────────────────────────────────────────────
// LEITURA DO QUE FICOU PENDENTE (19/11/2026). Obra aberta com documentos que a IA ainda não leu (obra antiga, ou envio que falhou): o GET da obra,
// para quem pode pedir "Ler tudo" (`pode.ler_tudo`), conta os pendentes e, se der, começa UMA leitura em lote em segundo plano (`waitUntil`) só com eles.
// Pendente = arquivo de item legível (`SLOTS_LIDOS_SOLAR`) cujo id não está em `arquivos` do registro (`leituraRegistro.ts`).
//
// Regras: uma leitura por vez (a trava da venda e o marcador `rodando`, que com mais de 3 min é velho); o dedupe por sha vale (arquivo cujo sha já foi
// lido só é marcado como lido: é o caso das obras de antes do registro por id, e o download acontece uma vez só, na primeira rodada); conta na cota de
// 20 por hora da VENDA, nunca na da pessoa, e cota cheia não começa; a IA falhando NÃO marca nada como lido, mas guarda a hora da falha e o GET só tenta
// de novo depois de 10 min; as regras de gravação são as da leitura automática (`aplicarLeitura`: só campo vazio, `doc` de origem, marca `ia` no
// dinheiro, vetos de outra pessoa). Arquivo que o servidor não consegue ler (objeto sumido, PDF torto, imagem grande demais) é marcado como lido para
// não repetir para sempre; arquivo que não coube em 20 arquivos e 22 MB fica pendente para a rodada seguinte.
// ─────────────────────────────────────────────────────────────────────────────

export interface EstadoLeitura { rodando: boolean; pendentes: number; ultima_em: string | null }
export const SEM_LEITURA: EstadoLeitura = { rodando: false, pendentes: 0, ultima_em: null };
/** No máximo tantos arquivos pendentes são baixados por rodada (o resto fica para a seguinte). */
const MAX_BAIXAR_POR_RODADA = 60;

export const pendentesDe = (arquivos: readonly ArquivoDoc[], r: Registro): ArquivoDoc[] => {
  const lidos = new Set(r.arquivos.map((a) => a.id));
  return arquivos.filter((a) => SLOTS_LIDOS_SOLAR.includes(a.slot) && !lidos.has(a.id));
};

interface Baixado { arq: ArquivoDoc; bytes: Buffer; sha: string }

/** O servidor consegue entregar este arquivo à IA? (mesmas conferências de `prepararArquivos`) */
const legivel = (b: Baixado): boolean => {
  if (b.bytes.length > MAX_BYTES_LIDOS) return false;
  if (b.arq.mime === 'application/pdf') return b.bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  return b.bytes.length <= MAX_IMAGEM_BYTES && assinaturaBate(b.arq.mime, b.bytes.subarray(0, 16));
};

type Resultado = 'ok' | 'nada' | 'cota' | 'falhou';
interface Dados { card: { id: number; cliente_nome?: unknown }; nome: string }

async function lote(g: Dados, sinal: { abortado: boolean }): Promise<Resultado> {
  const id = g.card.id;
  const venda = cotaDaVenda(id);
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  const r = await lerRegistro(venda.caminho);
  const pend = pendentesDe(reg.arquivos, r).slice(0, MAX_BAIXAR_POR_RODADA);
  if (!pend.length) return 'nada';

  // 1) baixa os pendentes UMA vez; o sha diz quais já foram lidos (de antes do registro por id) e quais a IA não consegue ler.
  const conhecidos = new Set([...r.lidos.map((x) => x.sha), ...r.arquivos.flatMap((a) => (a.sha ? [a.sha] : []))]);
  const marcar: ArquivoLido[] = [];
  const novos: Baixado[] = [];
  for (const arq of pend) {
    let bytes: Buffer;
    try { bytes = await baixarObjeto(arq.caminho); } catch (e) {
      if ((e as { codigo?: unknown } | null)?.codigo === 'objeto_ausente') marcar.push({ id: arq.id });   // sumiu do armazenamento: não há o que ler
      else logErro('baixar pendente', e);                                                               // falha do armazenamento: tenta na próxima rodada
      continue;
    }
    const b: Baixado = { arq, bytes, sha: crypto.createHash('sha256').update(bytes).digest('hex') };
    if (conhecidos.has(b.sha) || !legivel(b)) marcar.push({ id: arq.id, sha: b.sha }); else novos.push(b);
  }
  if (marcar.length) await marcarLidos(venda, g.nome, marcar);
  if (!novos.length) return 'nada';

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

  // 3) a cota da venda (uma leitura) e a chamada à IA, uma só para o lote.
  const shaLote = crypto.createHash('sha256').update(`lote:${id}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).digest('hex');
  if ((await reservar(venda, g.nome, shaLote, false)) !== 'ok') return 'cota';
  const cad = await lerCadastro(id, 'vendasolar');
  const ctx = await contextoDaLeitura(id, g.card, cad, reg.arquivos);
  const bytesPorCaminho = new Map(escolhidos.map((n) => [n.arq.caminho, n.bytes]));
  const res = await lerDocumentosDaVenda(escolhidos.map((n) => n.arq), {
    linha: 'vendasolar', ...ctx, baixar: async (caminho) => bytesPorCaminho.get(caminho) ?? baixarObjeto(caminho),
  });
  if (!res.ok || sinal.abortado) { await devolver(venda, g.nome, shaLote); return 'falhou'; }
  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: reg.arquivos, r: res, cad, cancelado: () => sinal.abortado });
  if (sinal.abortado) { await devolver(venda, g.nome, shaLote); return 'falhou'; }
  await marcarLidos(venda, g.nome, escolhidos.map((n) => ({ id: n.arq.id, sha: n.sha })), true);
  if (x.campos.length || x.comercial.length) invalidarCachesHub();
  return 'ok';
}

/** Roda o lote (o marcador `rodando` já é nosso), com limite de tempo, e solta o marcador. Nunca lança. */
async function rodarEmLote(g: Dados): Promise<void> {
  const venda = cotaDaVenda(g.card.id);
  const r = await comLimite((sinal) => lote(g, sinal), 'falhou' as Resultado);
  await soltarMarcador(venda, g.nome, r === 'falhou' ? { falha: true } : r === 'ok' ? { sucesso: true } : {});
}

/**
 * O estado da leitura para o GET da obra e, se houver pendentes e nada impedir, o começo da leitura em lote em segundo plano. Só chame para quem tem
 * `pode.ler_tudo`. Nunca lança (qualquer falha vira "sem leitura") e não espera a IA.
 */
export async function leituraDaObra(g: Dados & { arquivos: readonly ArquivoDoc[] }): Promise<EstadoLeitura> {
  try {
    const venda = cotaDaVenda(g.card.id);
    const r = await lerRegistro(venda.caminho);
    const pend = pendentesDe(g.arquivos, r);
    let rodando = marcadorValido(r);
    if (pend.length && !rodando && !emEspera(r) && gastoNaHora(r) < venda.limite) {
      // O marcador é pego sob a trava ANTES de responder: dois GETs juntos começam uma leitura só, e o GET seguinte já vê `rodando`.
      rodando = true;
      if (await tomarMarcador(venda, g.nome)) waitUntil(rodarEmLote(g));
    }
    return { rodando, pendentes: pend.length, ultima_em: r.ultima_em };
  } catch (e) {
    logErro('estado da leitura', e);
    return SEM_LEITURA;
  }
}
