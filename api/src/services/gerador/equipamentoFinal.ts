// ─────────────────────────────────────────────────────────────────────────────
// O EQUIPAMENTO FINAL DA OBRA (19/11/2026). PURO. "A proposta é o ponto de partida; o equipamento final é o que foi COMPRADO."
// Um helper só para o Resumo, o relatório, o termo de garantia e o Book, e a planilha antiga: cada categoria (módulos, inversor) vem da Compra quando há
// item comprado dela; senão da proposta (com a etiqueta "da proposta"). Estrutura e material só existem quando comprados.
// Sem valor de dinheiro aqui: pode ir para qualquer pessoa que veja a obra.
// ─────────────────────────────────────────────────────────────────────────────
import type { DocumentoCompra, ItemCompra } from './jornadaObra';
import { orcadoApenas } from './compraKit';
import { parecidos, potenciaDaDescricao } from './compraTexto';

/** O que a proposta ligada traz do equipamento (o mesmo formato de `equipamentoDaProposta`). */
export interface EquipDaProposta { qtdPlacas: number | null; modeloPlaca: string; potPlaca: number | null; qtdInversor: number | null; inversor: string }

export interface EquipLinha {
  descricao: string; quantidade: number | null; marca: string; modelo: string; potencia_w: number | null; potencia_kw: number | null;
  origem: 'compra' | 'proposta'; item_id: string | null;
  /** O número de série (do item da Compra). */
  serie: string;
}
export interface EquipamentoFinal {
  /** 'compra' se há item comprado; 'proposta' se só há o previsto ou a proposta; 'vazio' sem nada. */
  origem: 'compra' | 'proposta' | 'vazio';
  /** O texto que o Resumo mostra: "Comprado", "da proposta" ou "". */
  etiqueta: string;
  modulos: EquipLinha[]; inversores: EquipLinha[]; estruturas: EquipLinha[]; material: EquipLinha[];
  qtd_modulos: number | null; qtd_inversores: number | null; potencia_modulo_w: number | null; kwp: number | null;
  /** "Comprado diferente da proposta": o que mudou (vazio = igual ou sem como comparar). */
  diferencas: string[];
}

const linhaDoItem = (i: ItemCompra, origem: 'compra' | 'proposta'): EquipLinha => ({
  descricao: i.descricao, quantidade: i.quantidade, marca: i.marca, modelo: i.modelo, potencia_w: i.potencia_w, potencia_kw: i.potencia_kw, origem, item_id: i.id, serie: i.serie,
});
const soma = (l: readonly EquipLinha[]): number | null => { const n = l.reduce((s, x) => s + (x.quantidade ?? 0), 0); return n > 0 ? n : null; };

/** O kit de uma categoria: os comprados; sem nenhum, o previsto da Compra (que nasce da proposta); sem Compra, a proposta. */
function categoria(tipo: 'modulo' | 'inversor', itens: readonly ItemCompra[], daProposta: EquipLinha[]): EquipLinha[] {
  const doTipo = itens.filter((i) => i.tipo === tipo);
  const comprados = doTipo.filter((i) => i.comprado);
  if (comprados.length) return comprados.map((i) => linhaDoItem(i, 'compra'));
  if (doTipo.length) return doTipo.map((i) => linhaDoItem(i, 'proposta'));
  return daProposta;
}

function linhasDaProposta(e: EquipDaProposta | null): { modulos: EquipLinha[]; inversores: EquipLinha[] } {
  if (!e) return { modulos: [], inversores: [] };
  const base = { marca: '', potencia_kw: null, origem: 'proposta' as const, item_id: null, serie: '' };
  const modulos: EquipLinha[] = e.qtdPlacas || e.modeloPlaca
    ? [{ ...base, descricao: `Módulo ${e.modeloPlaca}${e.potPlaca ? ` ${e.potPlaca} W` : ''}`.trim(), quantidade: e.qtdPlacas, modelo: e.modeloPlaca, potencia_w: e.potPlaca }] : [];
  const inversores: EquipLinha[] = e.inversor || e.qtdInversor
    ? [{ ...base, descricao: `Inversor ${e.inversor}`.trim(), quantidade: e.qtdInversor, modelo: e.inversor, potencia_w: null, potencia_kw: potenciaDaDescricao(e.inversor).kw }] : [];
  return { modulos, inversores };
}

/** O que mudou entre o comprado e a proposta (só compara categoria comprada com proposta que traz o dado). */
function diferencas(modulos: readonly EquipLinha[], inversores: readonly EquipLinha[], e: EquipDaProposta | null): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (modulos.length && modulos.every((m) => m.origem === 'compra')) {
    const qtd = soma(modulos);
    if (e.qtdPlacas && qtd && qtd !== e.qtdPlacas) out.push(`placas: ${qtd} no lugar de ${e.qtdPlacas}`);
    const pot = modulos[0].potencia_w;
    if (e.potPlaca && pot && pot !== e.potPlaca) out.push(`potência das placas: ${pot} W no lugar de ${e.potPlaca} W`);
    const m = modulos[0];
    if (e.modeloPlaca && !parecidos(e.modeloPlaca, `${m.marca} ${m.modelo} ${m.descricao}`)) out.push(`placa: ${(m.marca ? `${m.marca} ` : '') + (m.modelo || m.descricao)} no lugar de ${e.modeloPlaca}`);
  }
  if (inversores.length && inversores.every((i) => i.origem === 'compra')) {
    const qtd = soma(inversores);
    if (e.qtdInversor && qtd && qtd !== e.qtdInversor) out.push(`inversores: ${qtd} no lugar de ${e.qtdInversor}`);
    const i = inversores[0];
    if (e.inversor && !parecidos(e.inversor, `${i.marca} ${i.modelo} ${i.descricao}`)) out.push(`inversor: ${(i.marca ? `${i.marca} ` : '') + (i.modelo || i.descricao)} no lugar de ${e.inversor}`);
  }
  return out;
}

/** O item só orçado (cotação) nunca entra no equipamento final. */
export function equipamentoFinal(todos: readonly ItemCompra[], proposta: EquipDaProposta | null, docs: readonly DocumentoCompra[] = [], serieDaEntrega = ''): EquipamentoFinal {
  const itens = todos.filter((i) => !orcadoApenas(i, docs));
  const p = linhasDaProposta(proposta);
  const modulos = categoria('modulo', itens, p.modulos);
  // A série do inversor da Entrega vale primeiro; sem ela, a do item da Compra.
  const inversores = categoria('inversor', itens, p.inversores).map((l) => ({ ...l, serie: serieDaEntrega || l.serie }));
  const estruturas = itens.filter((i) => i.tipo === 'estrutura' && i.comprado).map((i) => linhaDoItem(i, 'compra'));
  const material = itens.filter((i) => (i.tipo === 'eletrico' || i.tipo === 'outro') && i.comprado).map((i) => linhaDoItem(i, 'compra'));
  const comprou = itens.some((i) => i.comprado);
  const temAlgo = modulos.length + inversores.length + estruturas.length + material.length > 0;
  const kwp = modulos.reduce((s, m) => s + (m.quantidade ?? 0) * (m.potencia_w ?? 0), 0) / 1000;
  return {
    origem: comprou ? 'compra' : temAlgo ? 'proposta' : 'vazio',
    etiqueta: comprou ? 'Comprado' : temAlgo ? 'da proposta' : '',
    modulos, inversores, estruturas, material,
    qtd_modulos: soma(modulos), qtd_inversores: soma(inversores), potencia_modulo_w: modulos[0]?.potencia_w ?? null, kwp: kwp > 0 ? Math.round(kwp * 100) / 100 : null,
    diferencas: diferencas(modulos, inversores, proposta),
  };
}

/**
 * Os itens que alimentam o termo de garantia e o Book: em cada categoria (módulo, inversor), os comprados se houver; senão o que a Compra tem previsto.
 * O resto passa como está. Mesmo tipo que `ItemCompra`, para `camposDoTermo` não mudar.
 */
export function itensParaTermo(todos: readonly ItemCompra[], docs: readonly DocumentoCompra[] = []): ItemCompra[] {
  const itens = todos.filter((i) => !orcadoApenas(i, docs));
  const so = (tipo: ItemCompra['tipo']): ItemCompra[] => {
    const doTipo = itens.filter((i) => i.tipo === tipo);
    const comprados = doTipo.filter((i) => i.comprado);
    return comprados.length ? comprados : doTipo;
  };
  return [...so('modulo'), ...so('inversor'), ...itens.filter((i) => i.tipo !== 'modulo' && i.tipo !== 'inversor')];
}
