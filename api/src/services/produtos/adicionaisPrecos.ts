/**
 * PREÇOS DOS ADICIONAIS NA STRIPE, achados pela `lookup_key` (nunca por price_id colado no código).
 *
 * Em runtime só se LÊ (`resolverPrecosAdicionais`, com cache por instância). Quem cria é o script
 * `api/scripts/criar-precos-adicionais.ts`, que usa `garantirPrecosAdicionais`, idempotente: preço que já existe
 * é pulado, preço que falta é criado. O runtime nunca inventa preço: se faltar, devolve vazio e quem chama decide.
 */

import { Stripe } from 'stripe';
import {
  ITENS_AVULSOS, PACOTE, PRECOS, lookupKeyDoItem, nomeDoItem, todasAsLookupKeys,
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

const cache = new Map<string, string>();

/** Só para teste. */
export function _limparCachePrecos(): void { cache.clear(); }

/**
 * lookup_key -> price_id. Lê da Stripe só o que ainda não está em cache. Chave sem preço ativo simplesmente
 * não aparece no resultado. Falha de rede lança: quem chama isola.
 */
export async function resolverPrecosAdicionais(
  stripe: Pick<Stripe, 'prices'>, chaves: string[],
): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  const faltam: string[] = [];
  for (const k of new Set(chaves)) {
    const c = cache.get(k);
    if (c) saida.set(k, c); else faltam.push(k);
  }
  if (faltam.length) {
    const achados = await stripe.prices.list({ lookup_keys: faltam.slice(0, 10), active: true, limit: 10 });
    for (const p of achados.data) {
      if (p.lookup_key) { cache.set(p.lookup_key, p.id); saida.set(p.lookup_key, p.id); }
    }
  }
  return saida;
}

export interface ResultadoGarantia { lookupKey: string; situacao: 'ja-existe' | 'criado' | 'faltaria-criar'; priceId?: string }

/**
 * Cria o que falta. `criar: false` (padrão do script) só informa o que criaria. Preço com valor diferente do
 * esperado NÃO é alterado (preço da Stripe é imutável): vira aviso no retorno do script, quem decide é o dono.
 */
export async function garantirPrecosAdicionais(
  stripe: Pick<Stripe, 'prices' | 'products'>, opts: { criar: boolean },
): Promise<ResultadoGarantia[]> {
  const defs = definicoesDePreco();
  const existentes = await stripe.prices.list({ lookup_keys: todasAsLookupKeys(), limit: 10 });
  const porChave = new Map(existentes.data.map((p) => [p.lookup_key as string, p]));
  const produtoDoGrupo = new Map<string, string>();
  for (const d of defs) {
    const ja = porChave.get(d.lookupKey);
    const prod = ja ? (typeof ja.product === 'string' ? ja.product : (ja.product as { id?: string })?.id) : undefined;
    if (prod) produtoDoGrupo.set(d.grupo, prod);
  }

  const saida: ResultadoGarantia[] = [];
  for (const d of defs) {
    const ja = porChave.get(d.lookupKey);
    if (ja) { saida.push({ lookupKey: d.lookupKey, situacao: 'ja-existe', priceId: ja.id }); continue; }
    if (!opts.criar) { saida.push({ lookupKey: d.lookupKey, situacao: 'faltaria-criar' }); continue; }

    let produto = produtoDoGrupo.get(d.grupo);
    if (!produto) {
      const novo = await stripe.products.create({ name: d.nome, metadata: { sd_adicional: d.grupo } });
      produto = novo.id;
      produtoDoGrupo.set(d.grupo, produto);
    }
    const preco = await stripe.prices.create({
      product: produto,
      currency: 'brl',
      unit_amount: Math.round(d.valor * 100),
      recurring: { interval: 'month' },
      lookup_key: d.lookupKey,
      nickname: `${d.nome} - R$ ${d.valor}/mes`,
    });
    saida.push({ lookupKey: d.lookupKey, situacao: 'criado', priceId: preco.id });
  }
  return saida;
}
