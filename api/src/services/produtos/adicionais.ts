/**
 * ADICIONAIS MENSAIS: as 4 ferramentas vendidas como assinatura extra (13/11/2026).
 *
 * Venda Off-Grid, Estoque em Dia, Fecha Vendas e LimpaPro viram adicional MENSAL: o acesso vale enquanto paga.
 * Duas portas: o order bump do checkout do plano mensal (R$ 17 por ferramenta, ou as 4 por R$ 30) e a compra
 * dentro do app (R$ 17 cada, ou as 4 por R$ 40). Tudo atrás de ADICIONAIS_MENSAIS: desligada, nada muda.
 *
 * Este arquivo só tem a parte PURA (lista, preço, normalização, flag). Stripe, Asaas e banco moram nos irmãos
 * (adicionaisPrecos, adicionaisStripe, adicionaisPix, adicionaisAcesso).
 */

import { produtoPorId } from './catalogo';

/** Ids das 4 ferramentas que viram adicional (os mesmos ids do catálogo de produtos). */
export const ITENS_AVULSOS = ['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro'] as const;
export type ItemAvulso = (typeof ITENS_AVULSOS)[number];

/** O pacote com as 4. Não é produto do catálogo: é só a forma de cobrar mais barato. */
export const PACOTE = 'pacote';

/** Onde a compra acontece: no checkout do plano (bump) ou dentro do app. Muda só o preço do pacote. */
export type ContextoAdicional = 'checkout' | 'app';

export const PRECOS = { avulso: 17, pacoteCheckout: 30, pacoteApp: 40 } as const;

/** Dias de folga depois do fim do período pago (cobrança que atrasa, débito que retenta). */
export const FOLGA_ADICIONAL_DIAS = 3;

/** Prefixo do `obs` das posses que vêm de adicional: é por ele que a tela lista "ativos" e o cancelamento acha a linha. */
export const OBS_ADICIONAL = 'adicional:';

const LIGADOS = new Set(['1', 'true', 'sim', 'on', 'yes']);

/** A flag lida a CADA chamada: a env costuma entrar na Vercel depois do deploy. */
export function adicionaisLigado(): boolean {
  return LIGADOS.has((process.env.ADICIONAIS_MENSAIS || '').trim().toLowerCase());
}

/** Momento (ms) em que a flag ligou. Quem assinou depois dele não leva mais o Fecha Vendas de brinde. null = não definido ou inválido. */
export function corteDosAdicionais(): number | null {
  const bruto = (process.env.ADICIONAIS_CORTE || '').trim();
  if (!bruto) return null;
  const ms = Date.parse(bruto);
  return Number.isFinite(ms) ? ms : null;
}

export const ehItemAvulso = (id: unknown): id is ItemAvulso =>
  typeof id === 'string' && (ITENS_AVULSOS as readonly string[]).includes(id);

export const ehItemValido = (id: unknown): boolean => id === PACOTE || ehItemAvulso(id);

/**
 * Lista que veio do corpo da requisição (pública!) vira lista limpa: só ids conhecidos, sem repetição. Tudo que não
 * for lista, ou não tiver id válido, vira []. 'pacote' marcado, ou as 4 marcadas uma a uma, viram só ['pacote']
 * (é o mais barato para o cliente). Ordem estável: a das ferramentas.
 */
export function normalizarAdicionais(entrada: unknown): string[] {
  if (!Array.isArray(entrada)) return [];
  const marcados = new Set<string>();
  for (const v of entrada) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (ehItemValido(id)) marcados.add(id);
  }
  if (marcados.has(PACOTE)) return [PACOTE];
  const avulsos = ITENS_AVULSOS.filter((i) => marcados.has(i));
  if (avulsos.length === ITENS_AVULSOS.length) return [PACOTE];
  return avulsos;
}

/** Quanto a lista custa por mês no contexto. Lista é normalizada aqui também: quem chama não precisa lembrar. */
export function somaMensal(itens: unknown, contexto: ContextoAdicional): number {
  const lista = normalizarAdicionais(itens);
  if (lista.includes(PACOTE)) return contexto === 'checkout' ? PRECOS.pacoteCheckout : PRECOS.pacoteApp;
  return lista.length * PRECOS.avulso;
}

/** Expande 'pacote' nas 4 ferramentas. Item avulso volta nele mesmo. */
export function produtosDoItem(item: string): string[] {
  if (item === PACOTE) return [...ITENS_AVULSOS];
  return ehItemAvulso(item) ? [item] : [];
}

/** Todas as ferramentas que a lista libera, sem repetição. */
export function produtosDaLista(itens: unknown): string[] {
  const out = new Set<string>();
  for (const i of normalizarAdicionais(itens)) for (const p of produtosDoItem(i)) out.add(p);
  return [...out];
}

// ── chaves de preço na Stripe (lookup_key) ──────────────────────────────────

const LOOKUP_AVULSO: Record<ItemAvulso, string> = {
  offgrid: 'ad_offgrid_mensal',
  inventario: 'ad_inventario_mensal',
  'curso-fechamento': 'ad_fechavendas_mensal',
  'curso-limpapro': 'ad_limpapro_mensal',
};
const LOOKUP_PACOTE_CHECKOUT = 'ad_pacote_checkout_mensal';
const LOOKUP_PACOTE_APP = 'ad_pacote_app_mensal';

export const PREFIXO_LOOKUP = 'ad_';

export function lookupKeyDoItem(item: string, contexto: ContextoAdicional): string | null {
  if (item === PACOTE) return contexto === 'checkout' ? LOOKUP_PACOTE_CHECKOUT : LOOKUP_PACOTE_APP;
  return ehItemAvulso(item) ? LOOKUP_AVULSO[item] : null;
}

/** Todas as lookup_keys que existem (o script de preços cria uma por linha). */
export function todasAsLookupKeys(): string[] {
  return [...Object.values(LOOKUP_AVULSO), LOOKUP_PACOTE_CHECKOUT, LOOKUP_PACOTE_APP];
}

/** A lookup_key é de adicional? (os preços de plano nunca começam com `ad_`) */
export const ehLookupAdicional = (key: string | null | undefined): boolean =>
  typeof key === 'string' && todasAsLookupKeys().includes(key);

/** Que ferramentas a lookup_key libera. null = não é de adicional. */
export function produtosDaLookup(key: string | null | undefined): string[] | null {
  if (!ehLookupAdicional(key)) return null;
  if (key === LOOKUP_PACOTE_CHECKOUT || key === LOOKUP_PACOTE_APP) return [...ITENS_AVULSOS];
  const item = ITENS_AVULSOS.find((i) => LOOKUP_AVULSO[i] === key);
  return item ? [item] : null;
}

/** O item (avulso ou 'pacote') que a lookup_key representa. */
export function itemDaLookup(key: string | null | undefined): string | null {
  if (!ehLookupAdicional(key)) return null;
  if (key === LOOKUP_PACOTE_CHECKOUT || key === LOOKUP_PACOTE_APP) return PACOTE;
  return ITENS_AVULSOS.find((i) => LOOKUP_AVULSO[i] === key) ?? null;
}

export function nomeDoItem(item: string): string {
  if (item === PACOTE) return 'As 4 ferramentas';
  return produtoPorId(item)?.nome ?? item;
}

/** O que o front lê em GET /produtos/adicionais/oferta. */
export function ofertaPublica(): {
  ligado: boolean;
  precos: { avulso: number; pacoteCheckout: number; pacoteApp: number };
  itens: Array<{ id: string; nome: string }>;
} {
  return {
    ligado: adicionaisLigado(),
    precos: { avulso: PRECOS.avulso, pacoteCheckout: PRECOS.pacoteCheckout, pacoteApp: PRECOS.pacoteApp },
    itens: ITENS_AVULSOS.map((id) => ({ id, nome: nomeDoItem(id) })),
  };
}

/** Fim do período pago mais a folga. */
export function comFolga(fimDoPeriodoMs: number): Date {
  return new Date(fimDoPeriodoMs + FOLGA_ADICIONAL_DIAS * 24 * 60 * 60 * 1000);
}

/** `adicional:<meio>:<item>[:cancelando]` — o carimbo gravado em entitlements.obs. */
export function obsDoAdicional(meio: 'cartao' | 'pix', item: string, cancelando = false): string {
  return `${OBS_ADICIONAL}${meio}:${item}${cancelando ? ':cancelando' : ''}`;
}

export function lerObsDoAdicional(obs: string | null | undefined): { meio: 'cartao' | 'pix'; item: string; cancelando: boolean } | null {
  const s = String(obs ?? '');
  if (!s.startsWith(OBS_ADICIONAL)) return null;
  const [meio, item, extra] = s.slice(OBS_ADICIONAL.length).split(':');
  if ((meio !== 'cartao' && meio !== 'pix') || !ehItemValido(item)) return null;
  return { meio, item, cancelando: extra === 'cancelando' };
}
