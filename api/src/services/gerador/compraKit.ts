// ─────────────────────────────────────────────────────────────────────────────
// A COMPRA, SEPARADA EM KIT E MATERIAL ELÉTRICO (19/11/2026). PURO: sem banco, sem rota e sem relógio. Só tipos de `jornadaObra` (sem ciclo).
//
// Kit = módulos, inversor e estrutura. Material elétrico = o resto. O PORTÃO da Compra (libera a Logística) é só: módulos e inversor existem e todos
// estão com o tique "Comprado". A estrutura aparece no grupo kit, mas não segura o portão: é cobrada no fechamento (item `material`), se foi comprada ou
// prevista pela proposta. Dois tipos de item NÃO contam para nada (kit, material, fechamento):
//   - o "previsto" que nasceu da proposta e foi trocado por outro item comprado do mesmo tipo (o equipamento final é o comprado);
//   - o "orçado, não comprado": veio de um ORÇAMENTO (origem `arquivo`, documento do tipo orçamento) e não tem o tique. É só uma cotação.
// ─────────────────────────────────────────────────────────────────────────────
import type { DocumentoCompra, ItemCompra } from './jornadaObra';

export const TIPOS_KIT: readonly ItemCompra['tipo'][] = ['modulo', 'inversor', 'estrutura'];
export const ehKit = (i: Pick<ItemCompra, 'tipo'>): boolean => TIPOS_KIT.includes(i.tipo);
export const grupoDoItem = (i: Pick<ItemCompra, 'tipo'>): 'kit' | 'material' => (ehKit(i) ? 'kit' : 'material');

const ROTULO_TIPO: Record<string, string> = { modulo: 'módulos', inversor: 'inversor', estrutura: 'estrutura' };

/** O previsto da proposta que já foi trocado por um item comprado do mesmo tipo (de outra origem): não conta. */
export function trocadoPeloComprado(i: ItemCompra, doTipo: readonly ItemCompra[]): boolean {
  return i.origem === 'proposta' && !i.comprado && doTipo.some((c) => c.comprado && c.origem !== 'proposta');
}

/**
 * O item "orçado, não comprado": lido de um orçamento (não de nota nem de pedido) e sem o tique "Comprado". O front o mostra como cotação (`orcado_apenas`).
 * Sem o documento na lista (a lista guarda os 40 últimos), vale o sinal do próprio item: veio de arquivo, sem compra e sem valor pago.
 */
export function orcadoApenas(i: ItemCompra, docs: readonly DocumentoCompra[] = []): boolean {
  if (i.origem !== 'arquivo' || i.comprado) return false;
  const d = i.documento_id ? docs.find((x) => x.id === i.documento_id) : undefined;
  return d ? d.tipo === 'orcamento' : i.compra_id === null && i.valor_centavos === null;
}

/** Os itens que contam: sem o orçado-não-comprado e sem o previsto da proposta já trocado pelo comprado do mesmo tipo. */
export function itensQueContam(itens: readonly ItemCompra[], docs: readonly DocumentoCompra[] = []): ItemCompra[] {
  const vivos = itens.filter((i) => !orcadoApenas(i, docs));
  return vivos.filter((i) => !trocadoPeloComprado(i, vivos.filter((x) => x.tipo === i.tipo)));
}

export interface StatusDoKit {
  /** Os itens de kit que contam (sem o orçado e sem o previsto já trocado), a estrutura inclusa. */
  ativos: ItemCompra[];
  /** Os de `ativos` que seguram o portão da Compra e da Logística: módulos e inversor. */
  portao: ItemCompra[];
  comprados: number;
  total: number;
  /** Módulos e inversor existem e estão todos comprados (a estrutura não segura). */
  completo: boolean;
  /** O que falta, em palavras: "módulos", "inversor". */
  faltam: string[];
}

export function statusDoKit(itens: readonly ItemCompra[], docs: readonly DocumentoCompra[] = []): StatusDoKit {
  const faltam: string[] = [];
  const contam = itensQueContam(itens, docs);
  const ativos = contam.filter(ehKit);
  const portao: ItemCompra[] = [];
  for (const tipo of ['modulo', 'inversor'] as const) {
    const doTipo = ativos.filter((i) => i.tipo === tipo);
    portao.push(...doTipo);
    if (!doTipo.length || doTipo.some((i) => !i.comprado)) faltam.push(ROTULO_TIPO[tipo]);
  }
  return { ativos, portao, comprados: ativos.filter((i) => i.comprado).length, total: ativos.length, completo: faltam.length === 0, faltam };
}

export interface StatusDoMaterial { itens: ItemCompra[]; comprados: number; total: number; completo: boolean }
/** O material elétrico (tudo que não é kit): "completo" só com pelo menos um item e todos comprados. */
export function statusDoMaterial(itens: readonly ItemCompra[], docs: readonly DocumentoCompra[] = []): StatusDoMaterial {
  const doMaterial = itensQueContam(itens, docs).filter((i) => !ehKit(i));
  const comprados = doMaterial.filter((i) => i.comprado).length;
  return { itens: doMaterial, comprados, total: doMaterial.length, completo: doMaterial.length > 0 && comprados === doMaterial.length };
}

export const listaE = (l: readonly string[]): string => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`);
export const textoDoKit = (s: StatusDoKit): string => {
  const comprados = s.portao.filter((i) => i.comprado).length;
  return s.completo ? `Kit comprado (${comprados} de ${s.portao.length})` : `Kit: falta comprar ${listaE(s.faltam)}${s.portao.length ? ` (${comprados} de ${s.portao.length} comprados)` : ''}`;
};

/** O número de série do inversor guardado no item da Compra (o comprado primeiro). Vazio quando nenhum item o tem. */
export function serieDoInversor(itens: readonly ItemCompra[], docs: readonly DocumentoCompra[] = []): string {
  const invs = itensQueContam(itens, docs).filter((i) => i.tipo === 'inversor' && i.serie);
  return (invs.find((i) => i.comprado) ?? invs[0])?.serie ?? '';
}
