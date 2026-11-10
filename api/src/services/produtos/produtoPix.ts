/**
 * COMPRA POR PIX DENTRO DO APP: cobranca do Asaas no CPF da pessoa, uma por produto.
 *
 * Quatro produtos da loja "Para crescer" (ids do catalogo.ts): offgrid, inventario, curso-fechamento e
 * curso-limpapro. O valor sai SEMPRE do catalogo. O pagamento confirmado chama a MESMA concessao que a
 * Kiwify usa para cada produto, entao a area de membros, o menu e o app reconhecem a compra do mesmo jeito.
 *
 * Quem libera: o webhook do Asaas (PAYMENT_RECEIVED / PAYMENT_CONFIRMED, `tratarWebhookProduto`) e a consulta
 * da tela (`statusCobrancaProduto`), para nao depender so do webhook. Os dois passam por `liberarCobranca`, que
 * tem uma trava so: `produto_cobrancas.liberado_em`, gravada com UPDATE condicional (is null) ANTES de conceder.
 * Webhook repetido, CONFIRMED e RECEIVED do mesmo pagamento, ou tela e webhook ao mesmo tempo: so quem grava
 * primeiro concede. Se a concessao falha, a trava e devolvida e a proxima chamada tenta de novo.
 *
 * Reembolso e exclusao so marcam o status e avisam a operacao (e-mail de alerta): nada e revogado sozinho.
 * Tabela: api/MIGRATION_produto_cobrancas.sql (aplicar antes do deploy).
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/apiError';
import { cpfValido } from '../../utils/documento';
import { sendOpsAlert } from '../../utils/mailer';
import { asaasFetch, asaasHabilitado, AsaasError } from '../asaas/asaasClient';
import { garantirClienteAsaas, soDigitos } from '../asaas/pixRecorrenteService';
import { produtoPorId } from './catalogo';
import { acessos, concederAcesso } from './acessos';
import { liberarOffGrid, OFFGRID_ADDON_PRECO } from '../offgrid/acesso';

/** Ordem em que o upsell oferece o proximo produto (pula o que a pessoa ja tem). */
export const ORDEM_PRODUTOS_PIX = ['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro'] as const;
export type ProdutoPix = (typeof ORDEM_PRODUTOS_PIX)[number];

/** 409: a pessoa ja tem o produto. A rota devolve `{ error, jaTem: true }`. */
export class JaTemProdutoError extends ApiError {
  readonly jaTem = true;
  constructor() { super(409, 'Você já tem este produto.'); }
}

/** 409: o Pix ja foi pago e a liberacao esta em andamento. A rota devolve `{ error, pagoAguardando: true }`. */
export class PagoAguardandoLiberacaoError extends ApiError {
  readonly pagoAguardando = true;
  constructor() { super(409, 'Seu Pix já foi pago, estamos liberando. Atualize a página em instantes.'); }
}

/**
 * A concessao falhou por um motivo que VAI SE REPETIR (conta sem e-mail, tabela ou coluna que nao bate, produto que
 * nao e vendido por Pix). Nao e erro de rede nem de banco: o webhook responde 200 (senao o Asaas pausa a fila toda
 * apos 15 falhas seguidas) e a cobranca fica marcada (pago, sem liberado_em) para nova tentativa pela tela.
 */
export class LiberacaoPermanenteError extends Error {
  constructor(message: string) { super(message); this.name = 'LiberacaoPermanenteError'; }
}

/**
 * A concessao foi GRAVADA, mas a conferencia final (acessos()) nao enxergou o produto nem na segunda leitura. O
 * acessos() engole erro de leitura, entao quase sempre e o banco piscando, nao falha da concessao. Nao e permanente
 * (nao fecha a porta): a trava e devolvida e a cobranca fica para a tela e para a reentrega tentarem de novo.
 */
export class ConferenciaIncertaError extends Error {
  constructor(message: string) { super(message); this.name = 'ConferenciaIncertaError'; }
}

export type StatusPublico = 'pendente' | 'pago' | 'expirado' | 'cancelado';

/** So reaproveita o QR que ainda tem mais que isto de validade (da tempo de abrir o app do banco e pagar). */
const REUSO_MIN_VALIDADE_MS = 15 * 60_000;
/** A tela pergunta a cada poucos segundos; o Asaas so e consultado uma vez a cada 5 s por cobranca. */
export const CONSULTA_ASAAS_INTERVALO_MS = 5_000;
/** Quanto tempo, apos o pagamento, o webhook ainda devolve 500 por conferencia incerta (reenvio do Asaas). */
export const JANELA_REENVIO_CONFERENCIA_MS = 8 * 60_000;
/** Asaas mudou o status para estes: o dinheiro entrou. */
const STATUS_ASAAS_PAGO = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

export interface CobrancaProduto {
  id: string;
  /** null se a conta foi apagada (a cobranca fica como registro financeiro). */
  user_id: string | null;
  produto: string;
  valor: number | string;
  cpf: string;
  asaas_payment_id: string;
  asaas_customer_id: string | null;
  status: 'pendente' | 'pago' | 'expirado' | 'cancelado' | 'reembolsado';
  qr_payload: string | null;
  qr_imagem: string | null;
  expira_em: string | null;
  criado_em: string;
  pago_em: string | null;
  liberado_em: string | null;
  consultado_em: string | null;
  alertado_em: string | null;
}

const COLUNAS = 'id, user_id, produto, valor, cpf, asaas_payment_id, asaas_customer_id, status, qr_payload, qr_imagem, expira_em, criado_em, pago_em, liberado_em, consultado_em, alertado_em';

export interface PixProdutoCriado {
  cobrancaId: string;
  produto: string;
  valor: number;
  qrPayload: string;
  /** PNG em base64 puro (sem o prefixo data:). */
  qrImagemBase64: string;
  /** ISO com fuso (Z). */
  expiraEm: string;
}

export interface ProximoProduto { produto: string; nome: string; preco: number }

export interface StatusProduto {
  status: StatusPublico;
  produto: string;
  liberado: boolean;
  expiraEm: string | null;
  proximo?: ProximoProduto;
}

// ── pequenas utilidades ──────────────────────────────────────────────────────

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (t: string): string => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 529.***.***-25: so os 3 primeiros e os 2 ultimos digitos. */
export function mascararCpf(cpf: string | null | undefined): string | null {
  const d = soDigitos(cpf);
  if (d.length !== 11) return null;
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

/** Data de hoje (+dias) no fuso de Brasilia, AAAA-MM-DD: o Asaas conta o vencimento pelo dia de la. */
function dataBR(offsetDias = 0): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  if (offsetDias) d.setUTCDate(d.getUTCDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

/** O `expirationDate` do Asaas vem sem fuso ("2026-11-12 23:59:59", horario de Brasilia). */
function instanteDoAsaas(texto: string | null | undefined, reserva: Date): Date {
  const t = String(texto ?? '').trim();
  if (!t) return reserva;
  const iso = t.replace(' ', 'T');
  const comFuso = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}-03:00`;
  const ms = Date.parse(comFuso);
  return Number.isFinite(ms) ? new Date(ms) : reserva;
}

/** externalReference da cobranca: produto, cobranca e usuario. Nunca comeca com 'pc:' nem 'sdav:'. */
export function refDaCobranca(produto: string, cobrancaId: string, userId: string): string {
  return `prod:${produto}:${cobrancaId}:${userId}`;
}

export function lerRefDaCobranca(ref: string | null | undefined): { produto: string; cobrancaId: string; userId: string } | null {
  const m = /^prod:([a-z0-9-]+):([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(String(ref ?? '').trim());
  return m ? { produto: m[1], cobrancaId: m[2], userId: m[3] } : null;
}

export function ehProdutoDaLojaPix(id: unknown): id is ProdutoPix {
  return typeof id === 'string' && (ORDEM_PRODUTOS_PIX as readonly string[]).includes(id);
}

function statusPublico(c: CobrancaProduto): StatusPublico {
  if (c.liberado_em || c.status === 'pago') return 'pago';
  if (c.status === 'cancelado' || c.status === 'reembolsado') return 'cancelado';
  if (c.status === 'expirado') return 'expirado';
  const ate = Date.parse(String(c.expira_em ?? ''));
  return Number.isFinite(ate) && Date.now() > ate ? 'expirado' : 'pendente';
}

async function alertar(assunto: string, corpoHtml: string): Promise<boolean> {
  try { await sendOpsAlert(assunto, corpoHtml); return true; } catch (err) {
    logger.error('produto-pix', `alerta nao saiu: ${assunto}`, err);
    return false;
  }
}

/** No maximo 1 alerta de falha por cobranca por hora (a tela e o webhook tentam de novo e repetiriam o e-mail). */
export const ALERTA_INTERVALO_MS = 60 * 60_000;

async function alertarCobranca(cobrancaId: string, assunto: string, corpoHtml: string): Promise<void> {
  let carimbado: string | null = null;
  let carimboNovo = "";
  try {
    const { data } = await supabase.from('produto_cobrancas').select('alertado_em').eq('id', cobrancaId).maybeSingle();
    const ultimo = (data as { alertado_em?: string | null } | null)?.alertado_em ?? null;
    if (ultimo && Date.now() - Date.parse(ultimo) < ALERTA_INTERVALO_MS) return;
    // Compara e troca: se outra chamada gravou o carimbo no meio, so uma delas manda o e-mail.
    carimboNovo = new Date().toISOString();
    const q = supabase.from('produto_cobrancas').update({ alertado_em: carimboNovo }).eq('id', cobrancaId);
    const { data: ganhou } = await (ultimo ? q.eq('alertado_em', ultimo) : q.is('alertado_em', null)).select('id');
    if (!Array.isArray(ganhou) || ganhou.length === 0) return;
    carimbado = ultimo;
  } catch (err) {
    logger.error('produto-pix', `carimbo do alerta da cobranca ${cobrancaId} falhou`, err);
    return;
  }
  // O e-mail nao saiu: o carimbo volta ao que era, senao a hora de silencio engoliria um alerta que ninguem recebeu.
  if (!(await alertar(assunto, corpoHtml))) {
    try { await supabase.from('produto_cobrancas').update({ alertado_em: carimbado }).eq('id', cobrancaId).eq('alertado_em', carimboNovo); } catch { /* ja logado */ }
  }
}

/** Erro de banco: schema ou restricao que nao bate (vai se repetir) e permanente; o resto (rede, timeout) e transitorio. */
const CODIGOS_PERMANENTES = new Set(['42P01', '42703', '23502', '23514', '22P02']);
function falhaDeBanco(onde: string, error: { message?: string; code?: string }): Error {
  const msg = `${onde}: ${error.message ?? 'erro'}`;
  return CODIGOS_PERMANENTES.has(String(error.code ?? '')) ? new LiberacaoPermanenteError(msg) : new Error(msg);
}

/**
 * Erro de funcao compartilhada (concederAcesso, liberarOffGrid) que carrega o `code` do banco: schema ou restricao que
 * nao bate vira permanente; o resto segue transitorio. `LiberacaoPermanenteError` ja classificada passa direto.
 */
async function classificando<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (!(err instanceof LiberacaoPermanenteError) && typeof code === 'string' && CODIGOS_PERMANENTES.has(code)) {
      throw new LiberacaoPermanenteError((err as Error).message);
    }
    throw err;
  }
}

/** O Asaas so confirma o valor cheio: menor nao libera; faltando o valor, tambem nao (nao ha o que conferir). */
function valorConfere(c: CobrancaProduto, valor: unknown): boolean {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= Number(c.valor) - 0.009;
}

async function recusarValor(c: CobrancaProduto, valor: unknown, de: string): Promise<void> {
  logger.error('produto-pix', `pagamento ${c.asaas_payment_id}: valor ${String(valor)} nao confere com o cobrado ${c.valor} (${de})`);
  await alertarCobranca(
    c.id,
    'Pix de produto com valor diferente',
    `<p>O pagamento <strong>${esc(c.asaas_payment_id)}</strong> (${esc(c.produto)}) veio com ${typeof valor === 'number' ? `R$ ${valor.toFixed(2)}` : 'valor ausente'} e a cobrança era de R$ ${Number(c.valor).toFixed(2)} (${esc(de)}). Nada foi liberado.</p>`,
  );
}

// ── leitura ──────────────────────────────────────────────────────────────────

async function cobrancaDoUsuario(userId: string, id: string): Promise<CobrancaProduto | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await supabase.from('produto_cobrancas').select(COLUNAS).eq('id', id).eq('user_id', userId).maybeSingle();
  return (data as unknown as CobrancaProduto | null) ?? null;
}

/** CPF (so digitos) da ultima cobranca da pessoa. */
async function ultimoCpf(userId: string): Promise<string | null> {
  const { data } = await supabase.from('produto_cobrancas').select('cpf')
    .eq('user_id', userId).order('criado_em', { ascending: false }).limit(1).maybeSingle();
  const d = soDigitos((data as { cpf?: string } | null)?.cpf);
  return d.length === 11 ? d : null;
}

/** GET /produtos/cpf: mascarado para exibir. */
export async function cpfMascaradoDaPessoa(userId: string): Promise<string | null> {
  return mascararCpf(await ultimoCpf(userId));
}

/** O proximo produto da ordem (Off-grid, Estoque, Fecha Vendas, LimpaPro) que a pessoa ainda nao tem. */
export async function proximoProduto(userId: string): Promise<ProximoProduto | undefined> {
  const a = await acessos(userId);
  for (const id of ORDEM_PRODUTOS_PIX) {
    if (a.produtos.has(id)) continue;
    const p = produtoPorId(id);
    if (p) return { produto: p.id, nome: p.nome, preco: p.preco };
  }
  return undefined;
}

// ── criar ────────────────────────────────────────────────────────────────────

function respostaDaCobranca(c: CobrancaProduto): PixProdutoCriado {
  return {
    cobrancaId: c.id,
    produto: c.produto,
    valor: Number(c.valor),
    qrPayload: String(c.qr_payload ?? ''),
    qrImagemBase64: String(c.qr_imagem ?? ''),
    expiraEm: new Date(Date.parse(String(c.expira_em))).toISOString(),
  };
}

/**
 * Apaga no Asaas a cobranca pendente que acabou de ser substituida (troca de CPF, QR perto de vencer, segundo POST):
 * sem isto, duas cobrancas do mesmo produto ficariam abertas e a pessoa poderia pagar as duas.
 * Marca 'cancelado' ANTES de apagar, para o PAYMENT_DELETED que o Asaas manda nao virar alerta; se apagar falhar,
 * desfaz a marca e CONSULTA a antiga: o DELETE falha justamente quando ela foi paga agora. Se estiver paga, a nova e
 * apagada e a antiga e liberada (a pessoa pagou por ela): lanca 409 (`jaTem` se liberou, `pagoAguardando` se a
 * liberacao falhou). Qualquer outra falha so e registrada: o POST nunca quebra por causa da antiga.
 */
async function cancelarSubstituida(antiga: CobrancaProduto, nova: { id: string; paymentId: string }): Promise<void> {
  let marcou = false;
  try {
    const { data } = await supabase.from('produto_cobrancas').update({ status: 'cancelado' })
      .eq('id', antiga.id).eq('status', 'pendente').select('id');
    marcou = Array.isArray(data) && data.length > 0;
    await asaasFetch(`/payments/${antiga.asaas_payment_id}`, { method: 'DELETE' });
    return;
  } catch (err) {
    logger.warn('produto-pix', `nao apaguei a cobranca substituida ${antiga.id} no Asaas: ${(err as Error)?.message ?? 'erro'}`);
  }

  try {
    if (marcou) await supabase.from('produto_cobrancas').update({ status: 'pendente' }).eq('id', antiga.id).eq('status', 'cancelado');
    const r = await asaasFetch<{ status?: string; value?: number }>(`/payments/${antiga.asaas_payment_id}`);
    const paga = STATUS_ASAAS_PAGO.has(String(r?.status ?? '').toUpperCase());
    if (!paga) return;
    if (!valorConfere(antiga, r?.value)) { await recusarValor(antiga, r?.value, 'cobranca substituida'); return; }

    // Ja paga: a nova sai do ar e a antiga e quem libera.
    await supabase.from('produto_cobrancas').update({ status: 'cancelado' }).eq('id', nova.id).eq('status', 'pendente');
    await asaasFetch(`/payments/${nova.paymentId}`, { method: 'DELETE' }).catch((e) => {
      logger.warn('produto-pix', `nao apaguei a cobranca nova ${nova.id} depois de achar a antiga paga: ${(e as Error)?.message ?? 'erro'}`);
    });
    try {
      await liberarCobranca(antiga);
    } catch {
      throw new PagoAguardandoLiberacaoError();
    }
    throw new JaTemProdutoError();
  } catch (err) {
    if (err instanceof JaTemProdutoError || err instanceof PagoAguardandoLiberacaoError) throw err;
    logger.warn('produto-pix', `cobranca substituida ${antiga.id}: nao consegui conferir`, err);
  }
}

export async function criarCobrancaProduto(args: {
  userId: string;
  produto: unknown;
  cpf?: unknown;
  usarCpfSalvo?: unknown;
}): Promise<PixProdutoCriado> {
  if (!ehProdutoDaLojaPix(args.produto)) throw new ApiError(400, 'Produto desconhecido.');
  const produto = args.produto;
  // O valor vem do catalogo e de mais lugar nenhum: o corpo da requisicao nunca decide preco.
  const item = produtoPorId(produto);
  if (!item) throw new ApiError(400, 'Produto desconhecido.');

  let cpf = soDigitos(typeof args.cpf === 'string' ? args.cpf : '');
  if (args.usarCpfSalvo === true && !cpf) {
    cpf = (await ultimoCpf(args.userId)) ?? '';
    if (!cpf) throw new ApiError(400, 'Informe o seu CPF.');
  }
  if (!cpfValido(cpf)) throw new ApiError(400, 'Informe um CPF válido.');

  if (!asaasHabilitado()) throw new ApiError(503, 'Pix indisponível agora.');

  const a = await acessos(args.userId);
  if (a.produtos.has(produto)) throw new JaTemProdutoError();

  // Ja pago e ainda sem liberar (a concessao falhou e a tela/o webhook estao tentando de novo): nao cobrar de novo.
  const { data: pagas } = await supabase.from('produto_cobrancas').select('id')
    .eq('user_id', args.userId).eq('produto', produto).eq('status', 'pago').is('liberado_em', null).limit(1);
  if (Array.isArray(pagas) && pagas.length > 0) throw new PagoAguardandoLiberacaoError();

  // Quem fecha e reabre a tela (ou toca duas vezes) recebe o MESMO codigo, em vez de uma cobranca nova.
  const agora = Date.now();
  const { data: pendente } = await supabase.from('produto_cobrancas').select(COLUNAS)
    .eq('user_id', args.userId).eq('produto', produto).eq('status', 'pendente')
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  const antiga = (pendente as unknown as CobrancaProduto | null) ?? null;
  if (antiga) {
    const ate = Date.parse(String(antiga.expira_em ?? ''));
    if (Number.isFinite(ate) && ate - agora > REUSO_MIN_VALIDADE_MS && antiga.qr_payload && antiga.qr_imagem && antiga.cpf === cpf) {
      logger.info('produto-pix', `cobranca ${antiga.id} (${produto}) reaproveitada`);
      return respostaDaCobranca(antiga);
    }
    if (Number.isFinite(ate) && ate <= agora) {
      await supabase.from('produto_cobrancas').update({ status: 'expirado' }).eq('id', antiga.id).eq('status', 'pendente');
    }
  }

  const { data: u } = await supabase.from('users').select('id, email, nome, whatsapp').eq('id', args.userId).maybeSingle();
  const usuario = u as { id: string; email: string | null; nome: string | null; whatsapp: string | null } | null;
  if (!usuario) throw new ApiError(404, 'Usuário não encontrado.');
  // Sem e-mail a concessao nao teria onde gravar (LimpaPro, Fecha Vendas): melhor recusar ANTES de cobrar.
  if (!String(usuario.email ?? '').trim()) {
    throw new ApiError(400, 'Sua conta está sem e-mail. Atualize o cadastro e tente de novo.');
  }
  const emailConta = String(usuario.email).trim();

  const id = randomUUID();
  const vencimento = dataBR(1);
  let paymentId = '';
  let customerId = '';
  let qr: { encodedImage?: string | null; payload?: string | null; expirationDate?: string } | null = null;
  try {
    customerId = await garantirClienteAsaas({
      nome: (usuario.nome || emailConta).trim(), email: emailConta, cpfCnpj: cpf, whatsapp: usuario.whatsapp, userId: usuario.id,
    });
    const pag = await asaasFetch<{ id?: string }>('/payments', {
      method: 'POST',
      body: {
        customer: customerId,
        billingType: 'PIX',
        value: item.preco,
        dueDate: vencimento,
        description: `SolarDoc ${item.nome}`,
        externalReference: refDaCobranca(produto, id, usuario.id),
      },
    });
    if (!pag?.id) throw new ApiError(502, 'Pix indisponível agora.');
    paymentId = pag.id;
    qr = await asaasFetch(`/payments/${paymentId}/pixQrCode`);
    if (!qr?.payload || !qr.encodedImage) throw new ApiError(502, 'Pix indisponível agora.');
  } catch (err) {
    if (paymentId) await asaasFetch(`/payments/${paymentId}`, { method: 'DELETE' }).catch(() => {});
    if (err instanceof ApiError) throw err;
    if (err instanceof AsaasError) {
      logger.error('produto-pix', `Asaas recusou a cobranca de ${produto} (HTTP ${err.status})`);
      // 4xx de validacao (CPF recusado, cliente invalido): a pessoa corrige. O resto e falha nossa ou do Asaas.
      if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        throw new ApiError(400, 'O Pix não foi aceito. Confira o CPF e tente de novo.');
      }
      throw new ApiError(502, 'Pix indisponível agora.');
    }
    throw err;
  }

  const expira = instanteDoAsaas(qr.expirationDate, new Date(Date.parse(`${vencimento}T23:59:59-03:00`)));
  const linha = {
    id, user_id: usuario.id, produto, valor: item.preco, cpf, asaas_payment_id: paymentId, asaas_customer_id: customerId,
    status: 'pendente', qr_payload: qr.payload, qr_imagem: qr.encodedImage, expira_em: expira.toISOString(),
  };
  const { error } = await supabase.from('produto_cobrancas').insert(linha);
  if (error) {
    // Sem a linha o pagamento nao acharia dono: melhor cancelar a cobranca e falhar antes de mostrar o codigo.
    logger.error('produto-pix', `nao gravei a cobranca ${id} (${produto})`, error);
    await asaasFetch(`/payments/${paymentId}`, { method: 'DELETE' }).catch(() => {});
    throw new ApiError(502, 'Pix indisponível agora.');
  }

  // A nova ja esta gravada: so agora a antiga pendente sai do ar (nunca ficar sem nenhuma).
  if (antiga) await cancelarSubstituida(antiga, { id, paymentId });

  logger.info('produto-pix', `cobranca ${id} criada (${produto}, R$ ${item.preco})`);
  return respostaDaCobranca({ ...linha, criado_em: new Date().toISOString(), pago_em: null, liberado_em: null, consultado_em: null, alertado_em: null } as unknown as CobrancaProduto);
}

// ── liberar ──────────────────────────────────────────────────────────────────

/**
 * Concede o produto pela MESMA via da Kiwify. Lanca `LiberacaoPermanenteError` se o motivo vai se repetir, e erro
 * comum se foi rede ou banco (transitorio). Conferido no fim: a conta tem que enxergar o produto.
 */
async function concederProduto(c: CobrancaProduto): Promise<void> {
  if (!c.user_id) throw new LiberacaoPermanenteError(`cobranca ${c.id} sem usuario (conta apagada)`);
  const { data: u, error: erroConta } = await supabase.from('users').select('email, nome, whatsapp').eq('id', c.user_id).maybeSingle();
  if (erroConta) throw falhaDeBanco('users', erroConta);
  const conta = u as { email?: string | null; nome?: string | null; whatsapp?: string | null } | null;
  const email = String(conta?.email ?? '').toLowerCase().trim();
  if (!email) throw new LiberacaoPermanenteError(`conta ${c.user_id} sem e-mail: nao da para conceder ${c.produto}`);

  const antes = await acessos(c.user_id);
  const jaTinha = antes.produtos.has(c.produto);

  switch (c.produto) {
    case 'offgrid':
      // Com o credito de R$ 97 do primeiro pedido de kit, como na Kiwify. `garantirPosse`: se offgrid_desde ja existia
      // sem a posse (ou com ela vencida), grava/reativa o entitlement.
      await classificando(() => liberarOffGrid(c.user_id as string, OFFGRID_ADDON_PRECO, { garantirPosse: true }));
      break;
    case 'inventario':
      await classificando(() => concederAcesso({ userId: c.user_id as string, produto: 'inventario', origem: 'compra', orderId: `pix:${c.id}`, reativarVencido: true, lancarErro: true }));
      break;
    case 'curso-fechamento': {
      // O curso e o menu leem kit_pedidos (pedido pago, qualquer item): a mesma linha que o webhook da Kiwify grava.
      // order_id derivado da cobranca: reentrega cai na mesma linha.
      const { error } = await supabase.from('kit_pedidos').upsert({
        order_id: `app-pix-${c.id}`,
        email,
        nome: conta?.nome ?? null,
        produto: 'Fecha Vendas (Pix no app)',
        itens: ['kit'],
        bump_vip: false,
        bump_prospeccao: false,
        valor: Number(c.valor),
        status: 'paid',
        user_id: c.user_id,
        conta_criada: false,
        segmento: 'app_pix',
        payload: { origem: 'app_pix', cobranca_id: c.id, asaas_payment_id: c.asaas_payment_id },
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'order_id' });
      if (error) throw falhaDeBanco('kit_pedidos', error);
      break;
    }
    case 'curso-limpapro':
      await concederLimpaPro(email, conta?.nome ?? null, conta?.whatsapp ?? null);
      break;
    default:
      throw new LiberacaoPermanenteError(`produto ${c.produto} nao vendido por Pix`);
  }

  // Conferencia final. A concessao acima ja gravou (se tivesse falhado teria lancado). O acessos() engole erro de
  // leitura, entao "nao enxergo" pode ser so o banco piscando: le de novo uma vez e, se ainda assim nao aparecer,
  // lanca ConferenciaIncertaError (transitorio: a trava volta e a cobranca fica para nova tentativa), nunca o erro
  // permanente.
  let depois = await acessos(c.user_id);
  if (!depois.produtos.has(c.produto)) depois = await acessos(c.user_id);
  if (!depois.produtos.has(c.produto)) {
    throw new ConferenciaIncertaError(`${c.produto} concedido, mas a conferencia nao enxergou o produto (duas leituras)`);
  }

  // Pagamento em duplicidade: a conta ja tinha o produto antes desta cobranca (outra compra, Kiwify, cortesia).
  // Avisa so depois de concluir, uma vez (a concessao so conclui uma vez por cobranca).
  if (jaTinha) {
    await alertarCobranca(
      c.id,
      'Pix por produto que a conta já tinha',
      `<p>A cobrança <strong>${esc(c.id)}</strong> (${esc(c.produto)}, R$ ${Number(c.valor).toFixed(2)}) foi paga por <strong>${esc(email)}</strong>, mas essa conta já tinha o produto.</p>
       <p>Confira e, se for o caso, devolva o valor pelo Asaas (pagamento ${esc(c.asaas_payment_id)}).</p>`,
    );
  }
}

/**
 * LimpaPro: grava o que o webhook do funil (fora deste repositorio) grava no plano de R$ 47, sem bonus:
 *  - `limpapro_entitlements`: o item `curso-principal` ativo, por e-mail (e o que o acessos() le);
 *  - `limpapro_membros`: a linha do comprador (e-mail em minusculo PK, nome, telefone se houver, progresso {}), com
 *    ON CONFLICT DO NOTHING. Sem senha: o primeiro acesso na area de membros externa cria a senha.
 */
async function concederLimpaPro(email: string, nome: string | null, whatsapp: string | null): Promise<void> {
  const { data: existente, error: erroLeitura } = await supabase.from('limpapro_entitlements').select('email, ativo')
    .eq('email', email).eq('item', 'curso-principal').limit(1);
  if (erroLeitura) throw falhaDeBanco('limpapro_entitlements', erroLeitura);
  const linha = (existente as Array<{ ativo?: boolean | null }> | null)?.[0];
  if (linha) {
    if (linha.ativo === false) {
      const { error } = await supabase.from('limpapro_entitlements').update({ ativo: true }).eq('email', email).eq('item', 'curso-principal');
      if (error) throw falhaDeBanco('limpapro_entitlements', error);
    }
  } else {
    const { error } = await supabase.from('limpapro_entitlements').insert({ email, item: 'curso-principal', ativo: true });
    // 23505: outra chamada gravou a mesma linha agora; esta so confirma.
    if (error && (error as { code?: string }).code !== '23505') throw falhaDeBanco('limpapro_entitlements', error);
  }

  const telefone = soDigitos(whatsapp);
  const { error: erroMembro } = await supabase.from('limpapro_membros').upsert(
    { email, nome, ...(telefone ? { telefone } : {}), progresso: {} },
    { onConflict: 'email', ignoreDuplicates: true },
  );
  if (erroMembro) throw falhaDeBanco('limpapro_membros', erroMembro);
}

/**
 * Libera uma cobranca paga (o valor ja foi conferido por quem chama). Idempotente: so quem grava `liberado_em`
 * primeiro concede. Se a concessao falha, devolve a trava (a cobranca fica `pago` sem `liberado_em`, marcada para
 * nova tentativa pela tela), avisa a operacao (no maximo 1 vez por hora) e lanca: `LiberacaoPermanenteError` quando o
 * motivo vai se repetir, erro comum quando foi rede ou banco.
 */
export async function liberarCobranca(c: CobrancaProduto): Promise<{ liberado: boolean; novo: boolean }> {
  if (c.liberado_em) return { liberado: true, novo: false };
  const agora = new Date().toISOString();
  const { data: ganhou, error } = await supabase.from('produto_cobrancas')
    .update({ status: 'pago', pago_em: c.pago_em ?? agora, liberado_em: agora })
    .eq('id', c.id).is('liberado_em', null).select('id');
  if (error) throw new Error(`produto_cobrancas: ${error.message}`);
  if (!Array.isArray(ganhou) || ganhou.length === 0) return { liberado: true, novo: false };

  try {
    await concederProduto(c);
  } catch (err) {
    // Devolve a trava; uma segunda tentativa se o UPDATE falhar. Se nem assim, a cobranca fica "liberada" sem
    // concessao: isso e o pior estado e o alerta diz isso, sem a trava de 1 por hora.
    let erroTrava: string | null = null;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { error: e } = await supabase.from('produto_cobrancas').update({ liberado_em: null }).eq('id', c.id);
      erroTrava = e ? (e.message ?? 'erro') : null;
      if (!e) break;
    }
    logger.error('produto-pix', `liberacao de ${c.produto} falhou (cobranca ${c.id})${erroTrava ? `; trava NAO devolvida: ${erroTrava}` : ''}`, err);
    const motivo = esc((err as Error)?.message ?? 'erro');
    if (erroTrava) {
      await alertar(
        'Pix pago: liberação falhou e a trava ficou gravada',
        `<p>A cobrança <strong>${esc(c.id)}</strong> (${esc(c.produto)}, pagamento ${esc(c.asaas_payment_id)}) foi paga e a liberação falhou: ${motivo}.</p>
         <p><strong>A cobrança ficou marcada como liberada sem a concessão</strong> (não consegui devolver a trava: ${esc(erroTrava)}). Libere o produto na mão e limpe <code>liberado_em</code>.</p>`,
      );
    } else {
      await alertarCobranca(
        c.id,
        'Pix pago e produto NÃO liberado',
        `<p>A cobrança <strong>${esc(c.id)}</strong> (${esc(c.produto)}) foi paga (pagamento ${esc(c.asaas_payment_id)}), mas a liberação falhou: ${motivo}.</p>
         <p>Ela ficou marcada para nova tentativa (a tela refaz a cada consulta); se persistir, libere na mão.</p>`,
      );
    }
    throw err;
  }
  logger.info('produto-pix', `${c.produto} liberado (cobranca ${c.id})`);
  return { liberado: true, novo: true };
}

// ── consultar (tela) ─────────────────────────────────────────────────────────

export async function statusCobrancaProduto(userId: string, id: string): Promise<StatusProduto | null> {
  let c = await cobrancaDoUsuario(userId, id);
  if (!c) return null;

  const pendente = !c.liberado_em && c.status === 'pendente';
  // Pago e sem liberar: a concessao falhou antes e a trava foi devolvida. Tenta de novo, com a MESMA espera de 5 s
  // (sem ela, cada GET da tela repetiria a concessao e o alerta).
  const pagoSemLiberar = !c.liberado_em && c.status === 'pago';
  if (pendente || pagoSemLiberar) {
    const ultima = Date.parse(String(c.consultado_em ?? ''));
    if (!(Number.isFinite(ultima) && Date.now() - ultima < CONSULTA_ASAAS_INTERVALO_MS)) {
      await supabase.from('produto_cobrancas').update({ consultado_em: new Date().toISOString() }).eq('id', c.id);
      try {
        if (pagoSemLiberar) {
          await liberarCobranca(c);
        } else {
          const r = await asaasFetch<{ status?: string; deleted?: boolean; value?: number }>(`/payments/${c.asaas_payment_id}`);
          const st = String(r?.status ?? '').toUpperCase();
          if (STATUS_ASAAS_PAGO.has(st)) {
            if (valorConfere(c, r?.value)) await liberarCobranca(c);
            else await recusarValor(c, r?.value, 'consulta da tela');
          } else if (r?.deleted) {
            await supabase.from('produto_cobrancas').update({ status: 'cancelado' }).eq('id', c.id).eq('status', 'pendente');
          } else if (st === 'REFUNDED') {
            await supabase.from('produto_cobrancas').update({ status: 'reembolsado' }).eq('id', c.id).eq('status', 'pendente');
          } else if (st === 'OVERDUE') {
            await supabase.from('produto_cobrancas').update({ status: 'expirado' }).eq('id', c.id).eq('status', 'pendente');
          }
        }
      } catch (err) {
        // Asaas fora do ar (ou concessao que falhou, ja alertada): a tela segue com o estado que temos e pergunta de novo.
        logger.error('produto-pix', `consulta da cobranca ${c.id} falhou`, err);
      }
      c = (await cobrancaDoUsuario(userId, id)) ?? c;
    }
  }

  const resp: StatusProduto = {
    status: statusPublico(c),
    produto: c.produto,
    liberado: !!c.liberado_em,
    expiraEm: c.expira_em ? new Date(Date.parse(c.expira_em)).toISOString() : null,
  };
  if (resp.liberado) {
    const prox = await proximoProduto(userId);
    if (prox) resp.proximo = prox;
  }
  return resp;
}

// ── webhook do Asaas ─────────────────────────────────────────────────────────

interface PagamentoDoWebhook {
  id?: string; value?: number; externalReference?: string | null;
}

/**
 * Evento do Asaas cuja cobranca e de produto (externalReference `prod:...`). Chamado por processarWebhookAsaas antes
 * dos outros trilhos.
 *
 * Lanca (o handler devolve 500 e o Asaas reenvia) SO em erro transitorio: rede ou banco. Falha que vai se repetir
 * (concessao permanente, valor que nao confere, cobranca sem linha) responde 200 com `tratado: false`: 15 falhas
 * seguidas fazem o Asaas pausar a fila inteira, inclusive a do plano. Nesses casos a operacao e alertada e a cobranca
 * fica marcada (pago, sem liberado_em) para nova tentativa pela tela.
 */
export async function tratarWebhookProduto(
  evento: string,
  pagamento: PagamentoDoWebhook | null | undefined,
): Promise<{ tratado: boolean; motivo: string }> {
  const ref = lerRefDaCobranca(pagamento?.externalReference);
  const paymentId = String(pagamento?.id ?? '');
  if (!ref || !paymentId) return { tratado: false, motivo: 'cobranca de produto sem referencia valida' };

  const { data, error: erroLeitura } = await supabase.from('produto_cobrancas').select(COLUNAS).eq('asaas_payment_id', paymentId).maybeSingle();
  if (erroLeitura) throw new Error(`produto_cobrancas: ${erroLeitura.message}`);
  const c = (data as unknown as CobrancaProduto | null) ?? null;
  if (!c) {
    // O Asaas reenvia por 14 dias e pausa a fila apos falhas seguidas: nao devolvemos erro, avisamos a operacao.
    logger.error('produto-pix', `pagamento ${paymentId} (${evento}) sem linha em produto_cobrancas`);
    await alertar(
      'Pix de produto sem cobrança registrada',
      `<p>O Asaas avisou <strong>${esc(evento)}</strong> do pagamento <strong>${esc(paymentId)}</strong> (produto ${esc(ref.produto)}), mas não há cobrança gravada.</p>
       <p>Se foi pago, libere na mão.</p>`,
    );
    return { tratado: false, motivo: 'pagamento de produto sem cobranca registrada' };
  }
  if (c.id !== ref.cobrancaId || c.user_id !== ref.userId || c.produto !== ref.produto) {
    logger.error('produto-pix', `pagamento ${paymentId}: referencia nao bate com a cobranca ${c.id}`);
    await alertarCobranca(
      c.id,
      'Pix de produto com referência divergente',
      `<p>O pagamento <strong>${esc(paymentId)}</strong> traz uma referência que não bate com a cobrança ${esc(c.id)}. Nada foi liberado.</p>`,
    );
    return { tratado: false, motivo: 'referencia diverge da cobranca' };
  }

  switch (evento) {
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED': {
      if (c.liberado_em) return { tratado: true, motivo: 'produto ja liberado' };
      // O valor tem que vir do pagamento; se o evento nao trouxe, pergunta ao Asaas. Sem valor, nao libera.
      let valor: unknown = pagamento?.value;
      if (typeof valor !== 'number') {
        try {
          const r = await asaasFetch<{ value?: number }>(`/payments/${paymentId}`);
          valor = r?.value;
        } catch (err) {
          // 4xx (cobranca que o Asaas nao conhece) vai se repetir; rede e 5xx e transitorio.
          if (err instanceof AsaasError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) valor = undefined;
          else throw err;
        }
      }
      if (!valorConfere(c, valor)) {
        await recusarValor(c, valor, 'webhook');
        return { tratado: false, motivo: 'valor nao confere com o cobrado' };
      }
      try {
        const r = await liberarCobranca(c);
        return { tratado: true, motivo: r.novo ? 'produto liberado' : 'produto ja liberado' };
      } catch (err) {
        if (err instanceof LiberacaoPermanenteError) {
          return { tratado: false, motivo: 'liberacao nao concluida: a cobranca fica marcada para nova tentativa' };
        }
        // Conferencia incerta (a concessao gravou; o banco nao deixou conferir): 500 so enquanto a cobranca e RECENTE.
        // Passada a janela, 200: o Asaas nao reenvia para sempre nem pausa a fila por causa de uma cobranca so, e a
        // tela (a cada 5 s) e o proximo evento (CONFIRMED apos RECEIVED) seguem tentando.
        if (err instanceof ConferenciaIncertaError) {
          const desde = Date.parse(String(c.pago_em ?? ''));
          const recente = !Number.isFinite(desde) || Date.now() - desde < JANELA_REENVIO_CONFERENCIA_MS;
          if (!recente) return { tratado: false, motivo: 'conferencia incerta: a cobranca fica marcada para nova tentativa' };
        }
        throw err;
      }
    }
    case 'PAYMENT_REFUNDED':
    case 'PAYMENT_DELETED': {
      const novo = evento === 'PAYMENT_REFUNDED' ? 'reembolsado' : 'cancelado';
      // Cobranca que NOS apagamos (substituida) ou que ja expirou: nada a fazer nem a avisar.
      if (evento === 'PAYMENT_DELETED' && !c.liberado_em && (c.status === 'cancelado' || c.status === 'expirado')) {
        return { tratado: true, motivo: 'cobranca de produto ja encerrada' };
      }
      // Reentrega do mesmo reembolso: ja marcado e avisado.
      if (evento === 'PAYMENT_REFUNDED' && c.status === 'reembolsado') {
        return { tratado: true, motivo: 'reembolso ja registrado' };
      }
      // Excluir uma cobranca ja paga nao muda o que foi entregue: so marca a pendente.
      if (evento === 'PAYMENT_REFUNDED' || (c.status === 'pendente' && !c.liberado_em)) {
        await supabase.from('produto_cobrancas').update({ status: novo }).eq('id', c.id);
      }
      await alertar(
        evento === 'PAYMENT_REFUNDED' ? 'Pix de produto reembolsado' : 'Pix de produto excluído no Asaas',
        `<p>Cobrança <strong>${esc(c.id)}</strong> (${esc(c.produto)}, R$ ${Number(c.valor).toFixed(2)}), pagamento ${esc(paymentId)}: ${evento === 'PAYMENT_REFUNDED' ? 'reembolsada' : 'excluída'}.</p>
         <p>${c.liberado_em ? 'O acesso <strong>não</strong> foi revogado: decida se tira.' : 'O produto não havia sido liberado.'}</p>`,
      );
      return { tratado: true, motivo: `cobranca de produto ${novo}` };
    }
    case 'PAYMENT_OVERDUE': {
      if (c.status === 'pendente' && !c.liberado_em) {
        await supabase.from('produto_cobrancas').update({ status: 'expirado' }).eq('id', c.id).eq('status', 'pendente');
      }
      return { tratado: true, motivo: 'cobranca de produto vencida' };
    }
    default:
      return { tratado: false, motivo: `evento ${evento} ignorado (cobranca de produto)` };
  }
}
