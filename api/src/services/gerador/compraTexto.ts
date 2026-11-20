// ─────────────────────────────────────────────────────────────────────────────
// TEXTO DOS ITENS DA COMPRA (19/11/2026). PURO. Reconhece o tipo de um item pela descrição, tira marca e potência e diz se duas descrições são do
// mesmo produto ("modelo parecido"). É heurística: quando erra, o item entra como novo e a pessoa edita (nada daqui apaga dado).
// ─────────────────────────────────────────────────────────────────────────────
import type { ItemCompra } from './jornadaObra';

const semAcento = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const MARCAS = ['tsun', 'jinko', 'canadian', 'ja solar', 'trina', 'longi', 'risen', 'dmegc', 'tcl', 'byd', 'hanersun', 'osda', 'astronergy', 'saj', 'deye',
  'growatt', 'fronius', 'sungrow', 'solis', 'weg', 'huawei', 'goodwe', 'hoymiles', 'apsystems', 'sma', 'abb', 'intelbras', 'sofar', 'solax', 'fibrometal', 'fibromadeira'] as const;

const RE_INVERSOR = /\b(micro ?inversor(es)?|inversor(es)?|inverter)\b/;
const RE_MODULO = /\b(m[o]dulo(s)?|painel|paineis|placa(s)? (solar|fotovoltaica)|fotovoltaic[oa]s?|modulo(s)? fv)\b/;
const RE_ESTRUTURA = /\b(trilho(s)?|mini ?trilho|gancho(s)?|suporte(s)?|estrutura(s)?|perfil|perfis|grampo(s)?|emenda(s)?|presilha(s)?|fixador(es)?|fibrometal|fibromadeira)\b/;
const RE_ELETRICO = /\b(cabo(s)?|conector(es)?|mc4|dps|disjuntor(es)?|eletroduto(s)?|caixa(s)?|abracadeira(s)?|terminal|terminais|fusivel|quadro|string ?box|aterramento|haste(s)?|condulete|fita|parafuso(s)?)\b/;

/** O tipo do item pela descrição. Inversor vence módulo ("inversor para módulo"); cabo e conector nunca são kit. */
export function tipoDaDescricao(descricao: string): ItemCompra['tipo'] {
  const t = semAcento(descricao);
  if (/\b(cabo|conector|mc4|dps|disjuntor|eletroduto)/.test(t) && !RE_INVERSOR.test(t)) return 'eletrico';
  if (RE_INVERSOR.test(t)) return 'inversor';
  if (RE_MODULO.test(t)) return 'modulo';
  if (RE_ESTRUTURA.test(t)) return 'estrutura';
  if (RE_ELETRICO.test(t)) return 'eletrico';
  return 'outro';
}

export function marcaDaDescricao(descricao: string): string {
  const t = ` ${semAcento(descricao)} `;
  const m = MARCAS.find((x) => t.includes(` ${x} `) || t.includes(` ${x}-`) || t.includes(` ${x}.`));
  return m ? m.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

/** A potência em watts de um módulo ("600W", "615 Wp") ou em kW de um inversor ("6kW", "7,3K"). */
export function potenciaDaDescricao(descricao: string): { w: number | null; kw: number | null } {
  const t = semAcento(descricao).replace(',', '.');
  const w = /(\d{3,4})\s*w(p)?\b/.exec(t);
  const kw = /(\d{1,2}(?:\.\d+)?)\s*kw\b/.exec(t) ?? /(\d{1,2}(?:\.\d+)?)\s*k\b/.exec(t);
  return { w: w ? Number(w[1]) : null, kw: kw ? Number(kw[1]) : null };
}

const PARADAS = new Set(['de', 'da', 'do', 'para', 'com', 'e', 'em', 'o', 'a', 'un', 'und', 'pc', 'pecas', 'kit', 'solar', 'modulo', 'modulos', 'painel', 'paineis',
  'placa', 'placas', 'fotovoltaico', 'fotovoltaica', 'fotovoltaicos', 'inversor', 'inversores', 'microinversor', 'micro', 'fv', 'cabo', 'tipo', 'padrao']);

/** Os pedaços que importam de uma descrição: letras e números juntos, "600 W" vira "600w", sem palavras de enchimento. */
export function pedacos(descricao: string): string[] {
  const t = semAcento(descricao).replace(/(\d)[\s.,]*(wp|w|kw|k|mm|m)\b/g, (_, n, u) => `${n}${u === 'wp' ? 'w' : u}`);
  return [...new Set(t.split(/[^a-z0-9]+/).filter((x) => x.length >= 2 && !PARADAS.has(x)))];
}

/** Duas descrições do mesmo produto: dividem um pedaço com número (600w, tsm600, 6mm) ou mais da metade dos pedaços do menor lado. */
export function parecidos(a: string, b: string): boolean {
  const pa = pedacos(a);
  const pb = pedacos(b);
  if (!pa.length || !pb.length) return false;
  const comum = pa.filter((x) => pb.includes(x));
  if (!comum.length) return false;
  if (comum.some((x) => /\d/.test(x) && x.length >= 3)) return true;
  return comum.length / Math.min(pa.length, pb.length) >= 0.5;
}

/** Um item da Compra é do mesmo produto que a descrição lida? Compara a descrição, o modelo e a marca com modelo do item. */
export function itemParecidoCom(i: Pick<ItemCompra, 'descricao' | 'modelo' | 'marca'>, descricao: string): boolean {
  return [i.descricao, i.modelo, `${i.marca} ${i.modelo}`].some((x) => !!x.trim() && parecidos(x, descricao));
}
