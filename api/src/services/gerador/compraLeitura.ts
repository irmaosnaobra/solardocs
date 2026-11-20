// ─────────────────────────────────────────────────────────────────────────────
// A COMPRA LIDA SOZINHA (19/11/2026): PURO. Recebe o que a leitura achou num arquivo (orçamento, pedido ou nota fiscal) e devolve o `obra.json` novo.
// Regras:
//   - item que já existe (mesmo tipo e modelo parecido, como o kit que veio da proposta) recebe SÓ os campos vazios; nunca sobrescreve;
//   - item novo entra com origem 'arquivo' e `lido_de` = o nome do arquivo;
//   - NOTA FISCAL ou PEDIDO marcam os itens como COMPRADOS, ligam o documento ao item e criam a compra (fornecedor, data, nota); o valor da linha
//     vai para `valor_centavos`. Se os itens que o documento casa já estão numa compra (o pedido que chega com a nota), a nota PENDURA nessa compra: não nasce outra;
//     o item já comprado em outra compra (a 2ª nota do mesmo modelo) não é somado nem preenchido: a linha da nota entra à parte, com a sua quantidade;
//   - ORÇAMENTO só preenche fornecedor e o valor "orçado" (`orcado_centavos`): não marca comprado, não cria compra;
//   - o mesmo arquivo (sha256) nunca é aplicado duas vezes.
// Sem banco e sem relógio (o `agora` e o gerador de id entram por parâmetro).
// ─────────────────────────────────────────────────────────────────────────────
import { UNIDADES_ITEM, itensIniciais, type CompraObra, type DocumentoCompra, type ItemCompra, type ObraPrivada } from './jornadaObra';
import { ehKit } from './compraKit';
import { itemParecidoCom, marcaDaDescricao, potenciaDaDescricao, tipoDaDescricao } from './compraTexto';

export type TipoDocumento = DocumentoCompra['tipo'];
export interface ItemLido {
  descricao: string; quantidade: number | null; unidade: string; valor_unitario_centavos: number | null; valor_total_centavos: number | null;
}
export interface DocLido {
  tipo: TipoDocumento; fornecedor: string; numero: string; chave: string | null; data: string | null; total_centavos: number | null;
  itens: ItemLido[]; origem: 'xml' | 'ia';
}
export interface ArquivoLido { nome: string; sha256: string; path: string }
type EquipDaProposta = Parameters<typeof itensIniciais>[0];
export interface ContextoMescla {
  por: string; agora: string; novoId: (prefixo: string) => string; nfId?: string; /** o id da compra, quando o registro da nota já o usou */ compraId?: string;
  /** O kit da proposta (módulo e inversor): com a lista de itens VAZIA, a 1ª leitura parte dele (o kit previsto recebe os campos vazios e vira comprado), não de itens "novos". */
  equip?: EquipDaProposta;
}
export interface ResumoMescla {
  documento_id: string; tipo: TipoDocumento; compra_id: string | null;
  /** Itens que já existiam e ganharam campos vazios. */
  atualizados: number; novos: number; marcados_comprados: number; descartados: number;
}

const MAX_ITENS = 80;
const MAX_COMPRAS = 20;
const MAX_DOCUMENTOS = 40;

/** O tipo do documento a partir do que a leitura disse: XML é sempre nota; a IA diz nota_fiscal, cupom, pedido, orcamento ou outro (outro vale como orçamento: não marca comprado). */
export function tipoDoDocumento(lida: { tipo?: string; origem?: string }): TipoDocumento {
  if (lida.origem === 'xml') return 'nota_fiscal';
  const t = String(lida.tipo ?? '').toLowerCase();
  if (t === 'nota_fiscal' || t === 'cupom') return 'nota_fiscal';
  if (t === 'pedido') return 'pedido';
  return 'orcamento';
}

const valorDaLinha = (i: ItemLido): number | null => {
  if (i.valor_total_centavos !== null && i.valor_total_centavos > 0) return i.valor_total_centavos;
  if (i.valor_unitario_centavos && i.quantidade) return Math.round(i.valor_unitario_centavos * i.quantidade);
  return null;
};
const unidadeDe = (u: string): ItemCompra['unidade'] => UNIDADES_ITEM.find((x) => x === u.trim().toLowerCase()) ?? 'un';

/** Os campos vazios do item que o item lido preenche. Devolve o item novo e se algo mudou. */
function preencher(ex: ItemCompra, l: ItemLido, doc: DocLido, arq: ArquivoLido, docId: string, compraId: string | null, docs: readonly DocumentoCompra[]): { item: ItemCompra; mudou: boolean; marcou: boolean } {
  const tipo = tipoDaDescricao(l.descricao);
  const pot = potenciaDaDescricao(l.descricao);
  const valor = valorDaLinha(l);
  const compra = doc.tipo !== 'orcamento';
  const novo: ItemCompra = { ...ex };
  if (novo.quantidade === null && l.quantidade) novo.quantidade = l.quantidade;
  if (!novo.marca) novo.marca = marcaDaDescricao(l.descricao);
  if (!novo.modelo && ehKit({ tipo })) novo.modelo = l.descricao.slice(0, 80);
  if (novo.potencia_w === null && tipo === 'modulo' && pot.w) novo.potencia_w = pot.w;
  if (novo.potencia_kw === null && tipo === 'inversor' && pot.kw) novo.potencia_kw = pot.kw;
  if (!novo.fornecedor) novo.fornecedor = doc.fornecedor.slice(0, 80);
  if (!novo.lido_de) novo.lido_de = arq.nome.slice(0, 120);
  if (compra) {
    if (novo.valor_centavos === null && valor !== null) novo.valor_centavos = valor;
    if (!novo.data && doc.data) novo.data = doc.data;
    if (!novo.compra_id && compraId) novo.compra_id = compraId;
    if (!novo.documento_id || docs.find((d) => d.id === ex.documento_id)?.tipo === 'orcamento') novo.documento_id = docId;
  } else {
    if (novo.orcado_centavos === null && valor !== null) novo.orcado_centavos = valor;
    if (!novo.documento_id) novo.documento_id = docId;
  }
  const marcou = compra && !novo.comprado;
  if (marcou) novo.comprado = true;
  return { item: novo, mudou: JSON.stringify(novo) !== JSON.stringify(ex), marcou };
}

function itemNovo(l: ItemLido, doc: DocLido, arq: ArquivoLido, docId: string, compraId: string | null, ctx: ContextoMescla): ItemCompra {
  const tipo = tipoDaDescricao(l.descricao);
  const pot = potenciaDaDescricao(l.descricao);
  const valor = valorDaLinha(l);
  const compra = doc.tipo !== 'orcamento';
  return {
    id: ctx.novoId('i'), origem: 'arquivo', tipo, descricao: l.descricao.slice(0, 120), quantidade: l.quantidade && l.quantidade > 0 ? l.quantidade : null,
    unidade: unidadeDe(l.unidade), marca: marcaDaDescricao(l.descricao), modelo: ehKit({ tipo }) ? l.descricao.slice(0, 80) : '',
    potencia_w: tipo === 'modulo' ? pot.w : null, potencia_kw: tipo === 'inversor' ? pot.kw : null,
    garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null,
    compra_id: compra ? compraId : null, fornecedor: doc.fornecedor.slice(0, 80), valor_centavos: compra ? valor : null, data: compra ? doc.data : null, etapa: 4,
    criado_por: ctx.por, criado_em: ctx.agora, comprado: compra, orcado_centavos: compra ? null : valor, lido_de: arq.nome.slice(0, 120), documento_id: docId, serie: '',
  };
}

/** O sha já foi lido nesta obra? (a decisão de não ler de novo vale antes de gastar a IA) */
export const jaLido = (p: ObraPrivada, sha256: string): boolean => p.compra.documentos.some((d) => d.sha256 === sha256);

const alvoDe = (itens: readonly ItemCompra[], usados: ReadonlySet<string>, l: ItemLido): number => {
  const tipo = tipoDaDescricao(l.descricao);
  return itens.findIndex((i) => !usados.has(i.id) && i.tipo === tipo && itemParecidoCom(i, l.descricao));
};

/** A compra ainda aceita este documento? Nota: só a que não tem nota. Pedido: só a que não tem outro pedido. */
const cabeNaCompra = (p: ObraPrivada, c: CompraObra, doc: DocLido): boolean =>
  doc.tipo === 'nota_fiscal' ? !c.nota : !p.compra.documentos.some((d) => d.compra_id === c.id && d.tipo === 'pedido');

/**
 * A compra que já existe e a que este documento pertence: a dos itens que ele casa (o pedido que criou a compra e agora chega a nota da MESMA compra).
 * Orçamento não tem compra. Compra que já tem nota (ou pedido) fica de fora: é outra compra.
 */
export function compraExistenteDoDocumento(p: ObraPrivada, doc: DocLido): string | null {
  if (doc.tipo === 'orcamento') return null;
  const usados = new Set<string>();
  for (const l of doc.itens.slice(0, 60)) {
    if (!l.descricao.trim()) continue;
    const k = alvoDe(p.compra.itens, usados, l);
    if (k < 0) continue;
    const it = p.compra.itens[k];
    usados.add(it.id);
    const c = it.comprado && it.compra_id ? p.compra.compras.find((x) => x.id === it.compra_id) : undefined;
    if (c && cabeNaCompra(p, c, doc)) return c.id;
  }
  return null;
}

/** A compra vazia com o kit da proposta já semeado (origem 'proposta', não comprado). Com itens, ou sem proposta, devolve a mesma obra. */
export function semearKitDaProposta(p: ObraPrivada, ctx: Pick<ContextoMescla, 'por' | 'agora' | 'novoId' | 'equip'>): ObraPrivada {
  if (p.compra.itens.length > 0 || !ctx.equip) return p;
  const kit = itensIniciais(ctx.equip).map((i): ItemCompra => ({ ...i, id: ctx.novoId('i'), criado_por: ctx.por, criado_em: ctx.agora }));
  return kit.length ? { ...p, compra: { ...p.compra, itens: kit } } : p;
}

export function aplicarDocumentoNaCompra(p0: ObraPrivada, doc: DocLido, arq: ArquivoLido, ctx: ContextoMescla): { privada: ObraPrivada; resumo: ResumoMescla } | { repetido: true } {
  if (jaLido(p0, arq.sha256)) return { repetido: true };
  const p = semearKitDaProposta(p0, ctx);
  const docId = ctx.novoId('d');
  const compra = doc.tipo !== 'orcamento';
  let compras: CompraObra[] = [...p.compra.compras];
  let compraId: string | null = null;
  if (compra) {
    // A compra que já existe (a dos itens que o documento casa; ou a que a rota já registrou) recebe a nota: nunca nascem duas compras para a mesma compra.
    const reusada = ctx.compraId ? (compras.some((c) => c.id === ctx.compraId) ? ctx.compraId : null) : compraExistenteDoDocumento(p, doc);
    if (reusada) {
      compraId = reusada;
      compras = compras.map((c) => (c.id !== reusada ? c : {
        ...c, fornecedor: c.fornecedor || doc.fornecedor.slice(0, 80), data: c.data ?? doc.data,
        ...(doc.tipo === 'nota_fiscal' && !c.nota ? { nota_chega: 'anexada' as const, nota: { path: arq.path, sha256: arq.sha256, numero: doc.numero.slice(0, 40), chave: doc.chave ?? '', nf_id: ctx.nfId ?? '' } } : {}),
      }));
    } else if (compras.length < MAX_COMPRAS) {
      compraId = ctx.compraId ?? ctx.novoId('c');
      compras.push({
        id: compraId, fornecedor: doc.fornecedor.slice(0, 80), cidade: '', data: doc.data, forma: '', nota_chega: 'anexada',
        nota: doc.tipo === 'nota_fiscal' ? { path: arq.path, sha256: arq.sha256, numero: doc.numero.slice(0, 40), chave: doc.chave ?? '', nf_id: ctx.nfId ?? '' } : null,
      });
    }
  }
  const itens: ItemCompra[] = p.compra.itens.map((i) => ({ ...i }));
  const usados = new Set<string>();
  const resumo: ResumoMescla = { documento_id: docId, tipo: doc.tipo, compra_id: compraId, atualizados: 0, novos: 0, marcados_comprados: 0, descartados: 0 };
  for (const l of doc.itens.slice(0, 60)) {
    if (!l.descricao.trim()) continue;
    const alvo = alvoDe(itens, usados, l);
    // O item que já foi comprado em OUTRA compra (a segunda nota do mesmo modelo) não é preenchido nem somado: a linha desta nota entra à parte, com a sua quantidade.
    const deOutraCompra = alvo >= 0 && compraId !== null && itens[alvo].comprado && !!itens[alvo].compra_id && itens[alvo].compra_id !== compraId;
    if (alvo >= 0 && !deOutraCompra) {
      const r = preencher(itens[alvo], l, doc, arq, docId, compraId, p.compra.documentos);
      usados.add(r.item.id);
      itens[alvo] = r.item;
      if (r.mudou) resumo.atualizados++;
      if (r.marcou) resumo.marcados_comprados++;
    } else if (itens.length >= MAX_ITENS) {
      resumo.descartados++;
    } else {
      const novo = itemNovo(l, doc, arq, docId, compraId, ctx);
      usados.add(novo.id);
      itens.push(novo);
      resumo.novos++;
      if (novo.comprado) resumo.marcados_comprados++;
    }
  }
  const documento: DocumentoCompra = {
    id: docId, tipo: doc.tipo, nome: arq.nome.slice(0, 120), sha256: arq.sha256, path: arq.path, fornecedor: doc.fornecedor.slice(0, 80), numero: doc.numero.slice(0, 40),
    data: doc.data, total_centavos: doc.total_centavos, itens: doc.itens.length, origem: doc.origem, compra_id: compraId, em: ctx.agora, por: ctx.por,
  };
  return { privada: { ...p, compra: { itens, compras, documentos: [...p.compra.documentos, documento].slice(-MAX_DOCUMENTOS) } }, resumo };
}
