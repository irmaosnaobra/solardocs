import crypto from 'crypto';
import { baixarObjeto, lerDocsComVersao } from './docsClienteBanco';
import { assinaturaBate, type ArquivoDoc } from './docsCliente';
import { lerCadastro } from './cadastroVenda';
import { MAX_BYTES_LIDOS, MAX_IMAGEM_BYTES, lerDocumentosDaVenda } from './cadastroVendaLeitura';
import { comLimite, contextoDaLeitura } from './cadastroLeituraAuto';
import { aplicarLeitura, obraAbertaParaIa } from './leituraGravacao';
import { invalidarCachesHub } from './vendaSolarHub';
import { cotaDaVenda, devolver, lerRegistro, reservar, soltarMarcador, type Registro } from './leituraRegistro';

// ─────────────────────────────────────────────────────────────────────────────
// RELEITURA ÚNICA DA CONTA DE LUZ PARA O CONSUMO MÉDIO (20/11/2026). Até esta data a leitura por IA não tirava o consumo médio da conta de luz da
// unidade geradora (o prompt mandava ignorar quando só havia o consumo do mês). Obra que já tinha a conta lida ficou com "Consumo médio: Falta".
// O GET da obra (`leituraDaObra`, em `leituraPendente.ts`), sem nada pendente, pede UMA releitura só da(s) conta(s) de luz quando: o consumo está vazio,
// a conta já foi lida (id em `arquivos` do registro, e não `falhou`) e a marca `consumo_relido` do registro ainda não existe. A marca é gravada ao
// COMEÇAR (junto do marcador `rodando`, sob trava): falhar, não achar o consumo ou estourar o tempo NÃO repete. Nada de releitura a cada abertura.
// Valem as regras de sempre (`aplicarLeitura`: só campo vazio, nunca em obra finalizada, cancelada ou com a conta fechada) e a cota da venda (1 leitura).
// ─────────────────────────────────────────────────────────────────────────────

/** Quantas contas de luz entram na releitura (as mais recentes). */
export const MAX_CONTAS_RELIDAS = 2;

/** O servidor consegue entregar este arquivo à IA? (mesmas conferências de `prepararArquivos`) */
export const legivel = (b: { arq: ArquivoDoc; bytes: Buffer }): boolean => {
  if (b.bytes.length > MAX_BYTES_LIDOS) return false;
  if (b.arq.mime === 'application/pdf') return b.bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  return b.bytes.length <= MAX_IMAGEM_BYTES && assinaturaBate(b.arq.mime, b.bytes.subarray(0, 16));
};

/** As contas de luz da unidade geradora que já foram lidas (e a IA não desistiu delas), as mais recentes primeiro. Vazio = nada a reler. */
export function contasLidas(arquivos: readonly ArquivoDoc[], r: Registro): ArquivoDoc[] {
  const lidas = new Map(r.arquivos.map((a) => [a.id, a]));
  return arquivos.filter((a) => a.slot === 'conta_luz' && lidas.has(a.id) && !lidas.get(a.id)?.falhou)
    .sort((x, y) => Date.parse(y.em) - Date.parse(x.em)).slice(0, MAX_CONTAS_RELIDAS);
}

/** A releitura ainda é devida? (marca não gravada, conta lida e consumo vazio). A cota e o marcador quem confere é `leituraDaObra`. */
export const releituraDevida = (arquivos: readonly ArquivoDoc[], r: Registro, consumoVazio: boolean): boolean =>
  consumoVazio && !r.consumo_relido && contasLidas(arquivos, r).length > 0;

type Resultado = 'ok' | 'nada' | 'cota' | 'falhou';
interface Dados { card: { id: number; cliente_nome?: unknown }; nome: string }

async function reler(g: Dados, sinal: { abortado: boolean }): Promise<Resultado> {
  const id = g.card.id;
  const venda = cotaDaVenda(id);
  if (!(await obraAbertaParaIa(id))) return 'nada';
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  const contas = contasLidas(reg.arquivos, await lerRegistro(venda.caminho));
  if (!contas.length) return 'nada';
  const bytes = new Map<string, Buffer>();
  for (const a of contas) {
    try { const b = await baixarObjeto(a.caminho); if (legivel({ arq: a, bytes: b })) bytes.set(a.caminho, b); } catch { /* sumiu ou falhou: fica de fora */ }
  }
  const escolhidas = contas.filter((a) => bytes.has(a.caminho));
  if (!escolhidas.length) return 'nada';

  const cad = await lerCadastro(id, 'vendasolar');
  if (cad.campos.consumo_medio_kwh?.valor?.trim()) return 'nada';   // alguém preencheu enquanto isso
  const sha = crypto.createHash('sha256').update(`consumo:${id}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).digest('hex');
  if ((await reservar(venda, g.nome, sha, false)) !== 'ok') return 'cota';
  const ctx = await contextoDaLeitura(id, g.card, cad, reg.arquivos);
  const r = await lerDocumentosDaVenda(escolhidas, { linha: 'vendasolar', ...ctx, baixar: async (caminho) => bytes.get(caminho) ?? baixarObjeto(caminho) });
  if (!r.ok || sinal.abortado) { await devolver(venda, g.nome, sha); return 'falhou'; }
  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: reg.arquivos, r, cad, cancelado: () => sinal.abortado });
  if (sinal.abortado) { await devolver(venda, g.nome, sha); return 'falhou'; }
  if (x.campos.length || x.comercial.length) invalidarCachesHub();
  return 'ok';
}

/** Roda a releitura (o marcador `rodando` e a marca `consumo_relido` já são nossos), com limite de tempo, e solta o marcador. Nunca lança. */
export async function rodarReleituraDoConsumo(g: Dados): Promise<void> {
  const r = await comLimite((sinal) => reler(g, sinal), 'falhou' as Resultado);
  // Só solta o marcador: nenhuma falha da releitura grava `falha_em` (a espera de 10 min é da leitura normal de documento novo, e não deve parar por causa dela).
  // Não repete mesmo assim: a marca `consumo_relido` já foi gravada ao começar.
  await soltarMarcador(cotaDaVenda(g.card.id), g.nome);
}
