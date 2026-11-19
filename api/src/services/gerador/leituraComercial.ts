// ─────────────────────────────────────────────────────────────────────────────
// LEITURA POR IA DOS DADOS COMERCIAIS DA VENDA SOLAR (19/11/2026). Módulo PURO (sem banco, sem rede). Do contrato assinado e do orçamento ou
// proposta a IA lê o valor total, a forma de pagamento, o prazo prometido e o kit (placas e inversor). Aqui ficam a conferência do que ela
// devolveu (`limparComercial`), a conversão para o formato do JSON privado da obra (`vendaDoComercial`, `kitDoComercial`) e a conferência de
// DE QUEM é o documento (`documentoDeOutroContratante`): contrato, procuração e orçamento de outra pessoa não gravam nada.
// A gravação mora em `leituraGravacao.ts`. Nada daqui vai para log: valor, nome e texto do documento nunca saem.
// ─────────────────────────────────────────────────────────────────────────────
import type { ArquivoDoc } from './docsCliente';
import type { Confianca, DocumentoLido, ResultadoLeituraCadastro } from './cadastroVendaLeitura';
import { donoDoArquivo } from './cadastroVendaPapeis';
import { FORMAS_PAGAMENTO, type FormaPagamento } from './jornadaSolar';
import { normalizarNome } from './dossieVenda';

/** O que a IA pode devolver na lista `comercial` (só de contrato e orçamento). */
export const CAMPOS_COMERCIAIS = [
  'valor_total', 'pagamento_forma', 'pagamento_descricao', 'prazo_instalacao',
  'placas_qtd', 'placas_marca', 'placas_potencia_w', 'inversor_qtd', 'inversor_marca', 'inversor_potencia_kw', 'kwp',
] as const;
export type CampoComercial = typeof CAMPOS_COMERCIAIS[number];

/** Os itens de onde sai o dado comercial (valor, pagamento, prazo e kit). A procuração não tem dado comercial. */
export const SLOTS_COMERCIAIS: readonly string[] = ['contrato_assinado', 'orcamento'];
/** Os itens cujo texto fala do CONTRATANTE (ou do outorgante): o nome escrito neles tem de ser o da venda. */
export const SLOTS_DO_CONTRATANTE: readonly string[] = ['contrato_assinado', 'procuracao', 'orcamento'];

export interface ItemComercial { valor: string; confianca: Confianca; arquivoId: string; /** o item do documento de onde veio */ slot: string }
export type ComercialLido = Partial<Record<CampoComercial, ItemComercial>>;

const ORDEM: Record<Confianca, number> = { baixa: 0, media: 1, alta: 2 };
const semAcento = (v: string): string => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * O item que vale para o arquivo: o do próprio item do catálogo, ou, em `outros`, o tipo que a IA deu ao conteúdo. Fora da lista dada, ''.
 * Arquivo num item da lista cuja IA diz ser de outro tipo de documento (a CNH no lugar do contrato) não vale.
 */
export function slotEfetivo(arquivo: { slot: string }, doc: { tipo?: string } | undefined, entre: readonly string[]): string {
  const tipo = doc?.tipo ?? '';
  if (entre.includes(arquivo.slot)) return !tipo || tipo === 'outro' || tipo === arquivo.slot || entre.includes(tipo) ? arquivo.slot : '';
  return arquivo.slot === 'outros' && entre.includes(tipo) ? tipo : '';
}

/**
 * `comercial` da saída da IA -> o que passa: campo conhecido, valor não vazio, `indice` de arquivo de contrato ou orçamento, confiança
 * acima de baixa. O mesmo campo duas vezes fica com o de maior confiança (empate, o primeiro).
 */
export function limparComercial(bruto: unknown, arquivos: readonly ArquivoDoc[], documentos: readonly DocumentoLido[]): ComercialLido {
  const lista = bruto && typeof bruto === 'object' ? (bruto as { comercial?: unknown }).comercial : null;
  const saida: ComercialLido = {};
  if (!Array.isArray(lista)) return saida;
  for (const x of lista) {
    if (!x || typeof x !== 'object') continue;
    const s = x as { campo?: unknown; valor?: unknown; indice?: unknown; confianca?: unknown };
    const campo = typeof s.campo === 'string' ? s.campo.trim() as CampoComercial : null;
    const valor = typeof s.valor === 'string' ? s.valor.replace(/\s+/g, ' ').trim() : '';
    const i = Number(s.indice);
    if (!campo || !CAMPOS_COMERCIAIS.includes(campo) || !valor || !Number.isInteger(i) || i < 1 || i > arquivos.length) continue;
    const c = semAcento(String(s.confianca ?? ''));
    const confianca: Confianca = c === 'alta' || c === 'media' ? c : 'baixa';
    if (confianca === 'baixa') continue;
    const arquivo = arquivos[i - 1];
    const slot = slotEfetivo(arquivo, documentos.find((d) => d.id === arquivo.id), SLOTS_COMERCIAIS);
    if (!slot) continue;
    const antigo = saida[campo];
    if (!antigo || ORDEM[confianca] > ORDEM[antigo.confianca]) saida[campo] = { valor: valor.slice(0, 300), confianca, arquivoId: arquivo.id, slot };
  }
  return saida;
}

// ── De quem é o documento ────────────────────────────────────────────────────

/** Dois nomes de pessoa são a mesma? Compara normalizado (sem acento nem caixa): igual, ou o mais curto (2 palavras ou mais) cabe inteiro no mais longo. */
export function mesmoNome(a: string, b: string): boolean {
  const x = normalizarNome(a); const y = normalizarNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [curto, longo] = x.length <= y.length ? [x.split(' '), new Set(y.split(' '))] : [y.split(' '), new Set(x.split(' '))];
  return curto.length >= 2 && curto.every((p) => longo.has(p));
}

/**
 * Contrato, procuração ou orçamento de OUTRA pessoa que não o contratante? `pessoa` é o nome que a IA leu como dono do texto. Com contratante
 * conhecido, nome diferente OU nome nenhum lido vale como outra pessoa (não dá para provar que o papel é dele: nada é gravado). Sem contratante
 * conhecido, só vale como outra pessoa o nome do financiador, do titular da homologação ou do avalista já conhecidos.
 */
export function documentoDeOutroContratante(pessoa: string | undefined, contratante: string | undefined, outros: ReadonlyArray<string | undefined>): boolean {
  const lido = (pessoa ?? '').trim();
  if (!lido) return !!contratante?.trim();
  if (contratante?.trim()) return !mesmoNome(lido, contratante);
  return outros.some((n) => !!n && mesmoNome(lido, n));
}

/**
 * O arquivo lido (item do titular) é de outra pessoa que não o contratante? Sim quando: o leitor deu ao conteúdo um dono diferente do contratante
 * (financiador, avalista...), ou trouxe campos de outra pessoa (fin_, aval_, ced_, tuc_), ou o nome lido é o do financiador/avalista já conhecido, ou
 * há contratante conhecido e o nome lido é outro. Só vale para o item `documento_titular`: os demais itens não alimentam o contratante.
 * `r.sugestoes` é o que veio DESTE arquivo (numa leitura de vários, quem chama filtra por `origens`).
 */
export function documentoDeOutraPessoa(
  arquivo: { id: string; slot: string }, r: Pick<Extract<ResultadoLeituraCadastro, { ok: true }>, 'documentos' | 'sugestoes'>,
  contratante: string | undefined, outros: ReadonlyArray<string | undefined>,
): boolean {
  if (arquivo.slot !== 'documento_titular') return false;
  const doc = r.documentos.find((d) => d.id === arquivo.id);
  const dono = donoDoArquivo(arquivo.slot, doc?.tipo, 'vendasolar');
  if (dono && dono !== 'comprador') return true;
  if (Object.keys(r.sugestoes).some((c) => ['fin_', 'aval_', 'ced_', 'tuc_'].some((p) => c.startsWith(p)))) return true;
  const lido = r.sugestoes.nome?.valor ?? '';
  if (!lido) return false;
  if (outros.some((n) => !!n && mesmoNome(lido, n)) && !(contratante && mesmoNome(lido, contratante))) return true;
  return !!contratante?.trim() && !mesmoNome(lido, contratante);
}

// ── Do texto da IA para o formato da obra ────────────────────────────────────

/** "R$ 38.900,00", "38900,00", "38.900" -> centavos. Fora de R$ 1.000 a R$ 100.000.000, null (provável parcela ou erro de leitura). */
export function centavosDe(v: string): number | null {
  let t = v.replace(/R\$|\s/gi, '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return c >= 100_000 && c <= 10_000_000_000 ? c : null;
}

const numeroDe = (v: string): number | null => {
  const m = /\d+(?:[.,]\d+)?/.exec(v);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const inteiroEntre = (v: string | undefined, min: number, max: number): number | null => {
  const n = v ? numeroDe(v) : null;
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const decimalEntre = (v: string | undefined, min: number, max: number): number | null => {
  const n = v ? numeroDe(v) : null;
  return n !== null && n >= min && n <= max ? n : null;
};
const textoLimpo = (v: string, max: number): string => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
/** Marca e modelo: letras, números e poucos sinais. */
const marcaLimpa = (v: string | undefined): string => textoLimpo((v ?? '').replace(/[^\p{L}\p{N} .+/&-]/gu, ''), 40);
const formaDe = (v: string | undefined): FormaPagamento | null => {
  const f = semAcento(v ?? '');
  return (FORMAS_PAGAMENTO as readonly string[]).includes(f) ? f as FormaPagamento : null;
};
const comoTexto = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

export interface VendaLida { valor_centavos?: number; forma?: FormaPagamento; obs?: string; prazo?: string }

/** Valor total, forma de pagamento (com a descrição) e prazo, já no formato do `privado.venda`. O que não passa na conferência não sai. */
export function vendaDoComercial(c: ComercialLido): VendaLida {
  const v = c.valor_total ? centavosDe(c.valor_total.valor) : null;
  const forma = formaDe(c.pagamento_forma?.valor);
  const prazo = c.prazo_instalacao ? textoLimpo(c.prazo_instalacao.valor, 200) : '';
  return {
    ...(v ? { valor_centavos: v } : {}),
    ...(forma ? { forma, obs: textoLimpo(c.pagamento_descricao?.valor ?? '', 60) } : {}),
    ...(prazo.length >= 3 ? { prazo } : {}),
  };
}

/**
 * O kit em texto legível, para `etapas[1].kit_texto`: "10 placas Jinko 610 W" e "1 inversor Growatt 5 kW". Só sai a parte que tem quantidade
 * e marca (a mesma exigência da proposta ligada); a potência entra quando veio.
 */
export function kitDoComercial(c: ComercialLido): { placas?: string; inversor?: string } {
  const qp = inteiroEntre(c.placas_qtd?.valor, 1, 5000); const mp = marcaLimpa(c.placas_marca?.valor); const pp = decimalEntre(c.placas_potencia_w?.valor, 50, 1500);
  const qi = inteiroEntre(c.inversor_qtd?.valor, 1, 100); const mi = marcaLimpa(c.inversor_marca?.valor); const pi = decimalEntre(c.inversor_potencia_kw?.valor, 0.3, 1000);
  return {
    ...(qp && mp.length >= 2 ? { placas: `${qp} ${qp === 1 ? 'placa' : 'placas'} ${mp}${pp ? ` ${comoTexto(pp)} W` : ''}`.slice(0, 120) } : {}),
    ...(qi && mi.length >= 2 ? { inversor: `${qi} ${qi === 1 ? 'inversor' : 'inversores'} ${mi}${pi ? ` ${comoTexto(pi)} kW` : ''}`.slice(0, 120) } : {}),
  };
}
