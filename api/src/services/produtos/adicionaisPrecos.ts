/**
 * PREÇOS DOS ADICIONAIS NA STRIPE, achados pela `lookup_key` (nunca por price_id colado no código).
 *
 * `resolverPrecosAdicionais` lê da Stripe (com cache por instância) e, com ADICIONAIS_MENSAIS ligada, CRIA o que faltar com a chave que o
 * servidor já tem: produto + preço (BRL, mensal, valor do catálogo, mesma `lookup_key`, mesmos nomes do script). O script
 * `api/scripts/criar-precos-adicionais.ts` continua valendo e usa o mesmo código (`garantirPrecosAdicionais`).
 *
 * Três travas, para nunca cobrar errado:
 *   - CORRIDA: a `lookup_key` é única na Stripe (criamos SEM `transfer_lookup_key`). Duas requisições ao mesmo tempo: quem perde recebe erro
 *     de chave já usada, lista de novo e usa o preço do vencedor. Dentro da mesma instância as criações também dividem a mesma promessa.
 *   - VALOR ERRADO: preço existente com valor, moeda ou intervalo diferentes do catálogo NÃO é usado e NÃO se cria outro. Lança
 *     `ErroPrecoAdicional` e avisa o dono (uma vez por chave por instância). Preço da Stripe é imutável: quem decide é o dono.
 *   - FLAG: desligada, nada é criado (só se lê o que já existe).
 */

import { logger } from '../../utils/logger';
import {
  ITENS_AVULSOS, PACOTE, PRECOS, adicionaisLigado, lookupKeyDoItem, nomeDoItem, todasAsLookupKeys,
} from './adicionais';

export interface DefinicaoDePreco {
  lookupKey: string;
  /** Nome do produto que o cliente VÊ na linha do checkout. */
  nome: string;
  /** Em reais, por mês. */
  valor: number;
  /** Preços que dividem o mesmo produto da Stripe (os dois do pacote). */
  grupo: string;
}

/** As 6 definições: 4 avulsos, o pacote do checkout (R$ 30) e o do app (R$ 40). */
export function definicoesDePreco(): DefinicaoDePreco[] {
  const avulsos = ITENS_AVULSOS.map((id) => ({
    lookupKey: lookupKeyDoItem(id, 'app') as string,
    nome: `${nomeDoItem(id)} (adicional mensal)`,
    valor: PRECOS.avulso,
    grupo: id,
  }));
  return [
    ...avulsos,
    { lookupKey: lookupKeyDoItem(PACOTE, 'checkout') as string, nome: 'As 4 ferramentas (adicional mensal)', valor: PRECOS.pacoteCheckout, grupo: PACOTE },
    { lookupKey: lookupKeyDoItem(PACOTE, 'app') as string, nome: 'As 4 ferramentas (adicional mensal)', valor: PRECOS.pacoteApp, grupo: PACOTE },
  ];
}

/** O preço da Stripe não bate com o catálogo (ou está inativo): nunca é usado. */
export class ErroPrecoAdicional extends Error {
  constructor(public lookupKey: string, detalhe: string) {
    super(`preco ${lookupKey} na Stripe nao bate com o catalogo: ${detalhe}`);
    this.name = 'ErroPrecoAdicional';
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type ClienteStripe = { prices: any; products?: any };

const cache = new Map<string, string>();
const criacoes = new Map<string, Promise<string>>();
const produtos = new Map<string, Promise<string>>();
const avisados = new Set<string>();

/** Só para teste. */
export function _limparCachePrecos(): void {
  cache.clear(); criacoes.clear(); produtos.clear(); avisados.clear();
}

/** O que diverge do catálogo (valor, moeda, intervalo, recorrência, tipo de uso, ativo). null = bate. */
export function divergenciaDoPreco(p: any, def: DefinicaoDePreco): string | null {
  const dif: string[] = [];
  const esperado = Math.round(def.valor * 100);
  if (p?.unit_amount !== esperado) dif.push(`valor ${p?.unit_amount ?? '?'} centavos (catalogo: ${esperado})`);
  if (String(p?.currency ?? '').toLowerCase() !== 'brl') dif.push(`moeda ${p?.currency ?? '?'} (catalogo: brl)`);
  if (p?.recurring?.interval !== 'month' || (p?.recurring?.interval_count ?? 1) !== 1) {
    dif.push(`cobranca ${p?.recurring ? `${p.recurring.interval_count ?? 1}x ${p.recurring.interval}` : 'unica'} (catalogo: mensal)`);
  }
  // `usage_type` ausente vale licensed (cobrança fixa por período); metered cobraria por uso e nunca bateria com o valor do catálogo.
  if ((p?.recurring?.usage_type ?? 'licensed') !== 'licensed') dif.push(`uso ${p.recurring.usage_type} (catalogo: licensed)`);
  if (p?.active === false) dif.push('preco inativo');
  return dif.length ? dif.join('; ') : null;
}

/** Avisa o dono (e-mail de operação, o mesmo das outras falhas de Stripe), uma vez por chave por instância. Nunca lança. */
async function avisarDono(lookupKey: string, detalhe: string): Promise<void> {
  if (avisados.has(lookupKey)) return;
  avisados.add(lookupKey);
  try {
    // Lazy: o script de preços roda sem a chave do Resend, e o módulo do e-mail exige a chave ao carregar.
    const { sendOpsAlert } = await import('../../utils/mailer');
    await sendOpsAlert(
      'Adicionais: preço da Stripe diverge do catálogo',
      `<p>O preço <b>${lookupKey}</b> existe na Stripe com dados diferentes do catálogo: ${detalhe}.</p>`
      + '<p>Ele NÃO está sendo usado, e a venda dessa ferramenta fica de fora até acertar. Preço da Stripe não se edita: crie o certo com outra lookup_key ou arquive este, e ajuste o catálogo (adicionais.ts) se o valor novo for o desejado.</p>',
    );
  } catch (err) {
    logger.error('adicionais', `aviso de preco divergente (${lookupKey}) nao saiu`, err);
  }
}

/** Valida o preço lido da Stripe: bate = cache e id; não bate = aviso ao dono e erro. */
async function aceitar(p: any, def: DefinicaoDePreco): Promise<string> {
  const dif = divergenciaDoPreco(p, def);
  if (dif) {
    logger.error('adicionais', `preco ${def.lookupKey} divergente: ${dif}`);
    await avisarDono(def.lookupKey, dif);
    throw new ErroPrecoAdicional(def.lookupKey, dif);
  }
  cache.set(def.lookupKey, p.id);
  return p.id as string;
}

/** O produto do grupo na Stripe: acha por metadata (ou nome) e só cria se não existir. Uma promessa por grupo na instância. */
function produtoDoGrupo(stripe: ClienteStripe, def: DefinicaoDePreco): Promise<string> {
  const em = produtos.get(def.grupo);
  if (em) return em;
  const p = (async (): Promise<string> => {
    // A busca da Stripe demora a enxergar produto recém-criado (e pode estar fora): vazia ou com erro, a lista (por metadata ou nome) é a
    // reserva ANTES de criar produto novo (poucas páginas, a conta tem poucos produtos).
    try {
      const r = await stripe.products.search({ query: `metadata['sd_adicional']:'${def.grupo}' AND active:'true'`, limit: 1 });
      if (r?.data?.[0]?.id) return r.data[0].id as string;
    } catch { /* cai na lista */ }
    let cursor: string | undefined;
    for (let pagina = 0; pagina < 5; pagina++) {
      const l = await stripe.products.list({ active: true, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      const achado = (l?.data ?? []).find((x: any) => x?.metadata?.sd_adicional === def.grupo || x?.name === def.nome);
      if (achado) return achado.id as string;
      if (!l?.has_more || !l.data?.length) break;
      cursor = l.data[l.data.length - 1].id;
    }
    const novo = await stripe.products.create({ name: def.nome, metadata: { sd_adicional: def.grupo } });
    return novo.id as string;
  })();
  produtos.set(def.grupo, p);
  p.catch(() => produtos.delete(def.grupo));
  return p;
}

/**
 * Cria o preço que falta. Sem `transfer_lookup_key` de propósito: se a chave já foi usada, a Stripe recusa, e quem perdeu a corrida lista de
 * novo e usa o preço que já existe (validado do mesmo jeito).
 */
async function criarPreco(stripe: ClienteStripe, def: DefinicaoDePreco): Promise<string> {
  const produto = await produtoDoGrupo(stripe, def);
  try {
    const novo = await stripe.prices.create({
      product: produto,
      currency: 'brl',
      unit_amount: Math.round(def.valor * 100),
      recurring: { interval: 'month' },
      lookup_key: def.lookupKey,
      nickname: `${def.nome} - R$ ${def.valor}/mes`,
    });
    logger.info('adicionais', `preco ${def.lookupKey} criado na Stripe: ${novo.id}`);
    return await aceitar(novo, def);
  } catch (err) {
    if (err instanceof ErroPrecoAdicional) throw err;
    const existentes = await stripe.prices.list({ lookup_keys: [def.lookupKey], limit: 1 });
    const outro = existentes?.data?.[0];
    if (!outro) throw err;
    return aceitar(outro, def);
  }
}

function garantirPreco(stripe: ClienteStripe, def: DefinicaoDePreco): Promise<string> {
  const em = criacoes.get(def.lookupKey);
  if (em) return em;
  const p = criarPreco(stripe, def);
  criacoes.set(def.lookupKey, p);
  p.then(() => criacoes.delete(def.lookupKey), () => criacoes.delete(def.lookupKey));
  return p;
}

/**
 * lookup_key -> price_id. Lê da Stripe só o que ainda não está em cache; o que existir é validado contra o catálogo (divergente lança
 * `ErroPrecoAdicional`). O que não existir é CRIADO se ADICIONAIS_MENSAIS estiver ligada e o cliente tiver `products`; senão a chave só não
 * aparece no resultado. Falha de rede lança: quem chama isola.
 */
export async function resolverPrecosAdicionais(stripe: ClienteStripe, chaves: string[]): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  const faltam: string[] = [];
  for (const k of new Set(chaves)) {
    const c = cache.get(k);
    if (c) saida.set(k, c); else faltam.push(k);
  }
  if (!faltam.length) return saida;

  const defs = new Map(definicoesDePreco().map((d) => [d.lookupKey, d]));
  const achados = await stripe.prices.list({ lookup_keys: faltam.slice(0, 10), active: true, limit: 10 });
  for (const p of achados.data ?? []) {
    const def = p.lookup_key ? defs.get(p.lookup_key) : undefined;
    if (def) saida.set(def.lookupKey, await aceitar(p, def));
  }

  if (adicionaisLigado() && stripe.products) {
    for (const k of faltam) {
      const def = defs.get(k);
      if (def && !saida.has(k)) saida.set(k, await garantirPreco(stripe, def));
    }
  }
  return saida;
}

export interface ResultadoGarantia { lookupKey: string; situacao: 'ja-existe' | 'criado' | 'faltaria-criar'; priceId?: string }

/**
 * O que o script faz: informa (ou cria, com `criar: true`) os 6 preços, com o mesmo código do servidor. Preço existente com valor diferente
 * lança `ErroPrecoAdicional` (nada é alterado: preço da Stripe é imutável e quem decide é o dono).
 */
export async function garantirPrecosAdicionais(
  stripe: ClienteStripe, opts: { criar: boolean },
): Promise<ResultadoGarantia[]> {
  const defs = definicoesDePreco();
  const existentes = await stripe.prices.list({ lookup_keys: todasAsLookupKeys(), limit: 10 });
  const porChave = new Map<string, any>((existentes.data ?? []).map((p: any) => [p.lookup_key as string, p]));

  // Primeiro confere TODOS os que já existem: um divergente aborta antes de criar qualquer coisa (nada pela metade).
  const conferidos = new Map<string, string>();
  for (const d of defs) {
    const ja = porChave.get(d.lookupKey);
    if (ja) conferidos.set(d.lookupKey, await aceitar(ja, d));
  }

  const saida: ResultadoGarantia[] = [];
  for (const d of defs) {
    const idExistente = conferidos.get(d.lookupKey);
    if (idExistente) { saida.push({ lookupKey: d.lookupKey, situacao: 'ja-existe', priceId: idExistente }); continue; }
    if (!opts.criar) { saida.push({ lookupKey: d.lookupKey, situacao: 'faltaria-criar' }); continue; }
    saida.push({ lookupKey: d.lookupKey, situacao: 'criado', priceId: await garantirPreco(stripe, d) });
  }
  return saida;
}
