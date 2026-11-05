// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 4: o leitor do XML da NF-e (modelo 55) e da NFC-e (modelo 65).
//
// Puro: sem banco, sem rede, sem disco, sem relógio (o "hoje" entra por parâmetro) e sem log.
// Lê só um SUBCONJUNTO estrito de XML 1.0: sem DTD, sem entidade declarada, sem instrução de processamento além da declaração inicial.
// Por isso XXE e "billion laughs" são impossíveis: não existe código que resolva entidade.
// Dinheiro nunca passa por ponto flutuante: o valor sai da string, em centavos, pelo `centavosDeDecimal`.
// ─────────────────────────────────────────────────────────────────────────────
import { TextDecoder } from 'util';
import { chaveNfeValida } from './jornadaObra';
import { cnpjValido } from '../../utils/cnpj';
import { dataReal, somaDias, VALOR_MAX_CENTAVOS, MAX_BYTES_XML } from './financeiroCliente';

export type MotivoXml = 'grande' | 'malformado' | 'proibido' | 'nao_e_nfe' | 'modelo_nao_aceito' | 'chave_invalida' | 'chave_inconsistente'
  | 'homologacao' | 'nao_autorizada' | 'emitente_invalido' | 'data_invalida' | 'valor_invalido' | 'sem_itens';
export interface ItemXml {
  descricao: string; quantidade: number; unidade: string; valor_unitario_centavos: number | null;
  valor_produto_centavos: number | null; valor_total_centavos: number; ncm: string; ajuste?: true;
}
export interface NotaXml {
  tipo: 'nota_fiscal'; emitente: string; cnpj: string; numero: string; data: string; chave: string; valor_total_centavos: number;
  itens: ItemXml[]; confianca: 'alta'; origem: 'xml'; modelo: '55' | '65'; itens_na_nota: number; soma_itens_centavos: number; diferenca_centavos: number;
}
export type ResultadoXml = { ok: true; nota: NotaXml } | { ok: false; motivo: MotivoXml };

export const MENSAGEM_XML: Record<MotivoXml, string> = {
  grande: 'O XML passa de 1 MB. Confira se é o XML da nota.',
  malformado: 'Este XML está quebrado. Baixe o XML da nota de novo.',
  proibido: 'Este XML tem conteúdo que não é de nota fiscal. Baixe o XML da nota de novo.',
  nao_e_nfe: 'Este XML não é de NF-e nem de NFC-e.',
  modelo_nao_aceito: 'Só entra XML de NF-e (modelo 55) ou de NFC-e (modelo 65).',
  chave_invalida: 'A chave de acesso deste XML não confere.',
  chave_inconsistente: 'A chave de acesso não bate com os dados da nota.',
  homologacao: 'Este XML é de teste da Sefaz e não tem valor fiscal.',
  nao_autorizada: 'Esta nota não foi autorizada pela Sefaz.',
  emitente_invalido: 'O CNPJ do emitente não confere.',
  data_invalida: 'A data de emissão deste XML não confere.',
  valor_invalido: 'Os valores deste XML não conferem.',
  sem_itens: 'Este XML não tem itens.',
};

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_OK = new Set([NS_NFE, 'http://www.w3.org/2000/09/xmldsig#', 'http://www.w3.org/2001/XMLSchema-instance']);
const MAX_PROFUNDIDADE = 40;
const MAX_NOS = 20_000;
const MAX_ATRIBUTOS = 24;
const MAX_ITENS = 60;

class ErroXml extends Error { constructor(public motivo: MotivoXml) { super(motivo); } }
const falha = (m: MotivoXml): never => { throw new ErroXml(m); };

// ── 1. O parser estrito ────────────────────────────────────────────────────────────────────────────
interface No { nome: string; qname: string; attrs: Record<string, string>; ns: Record<string, string>; filhos: No[]; texto: string }

const RE_NOME = /[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?/y;
const RE_DECL = /^<\?xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+encoding\s*=\s*(["'])utf-8\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>/i;
const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const pontoValido = (c: number): boolean => c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
const tem = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Troca as 5 entidades do XML e as referências numéricas. Qualquer outra `&nome;` é proibida (é assim que o XXE entra). */
function semEntidades(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&([^;\s<&]{0,12});?/g, (todo: string, corpo: string): string => {
    if (!todo.endsWith(';')) return falha('malformado');
    if (tem(ENT, corpo)) return ENT[corpo];
    let m = /^#(\d{1,7})$/.exec(corpo);
    let cp: number | null = m ? Number(m[1]) : null;
    if (cp === null) { m = /^#x([0-9a-fA-F]{1,6})$/.exec(corpo); cp = m ? parseInt(m[1], 16) : null; }
    if (cp !== null) { if (!pontoValido(cp)) return falha('malformado'); return String.fromCodePoint(cp); }
    return falha(/^[A-Za-z_][\w.-]*$/.test(corpo) ? 'proibido' : 'malformado');
  });
}

const local = (q: string): string => { const i = q.indexOf(':'); return i < 0 ? q : q.slice(i + 1); };

/** Bytes -> árvore. Lança ErroXml. */
function arvoreXml(bytes: Buffer): No {
  if (!bytes || !bytes.length) return falha('malformado');
  if (bytes.length > MAX_BYTES_XML) return falha('grande');
  let texto = '';
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return falha('malformado'); }
  // Barreira antes de qualquer leitura: DTD e entidade declarada nunca entram, nem dentro de comentário.
  if (/<!\s*(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i.test(texto)) return falha('proibido');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/.test(texto)) return falha('malformado');
  let i = 0;
  const n = texto.length;
  while (i < n && /\s/.test(texto[i])) i++;
  if (texto.startsWith('<?xml', i)) {
    const m = RE_DECL.exec(texto.slice(i));
    if (!m) return falha('malformado');
    i += m[0].length;
  }
  const pilha: No[] = [];
  let raiz: No | null = null;
  let nos = 0;
  while (i < n) {
    const lt = texto.indexOf('<', i);
    const fim = lt < 0 ? n : lt;
    if (fim > i) {
      const t = texto.slice(i, fim);
      if (pilha.length) pilha[pilha.length - 1].texto += semEntidades(t);
      else if (/\S/.test(t)) return falha('malformado');
    }
    if (lt < 0) break;
    i = lt;
    if (texto.startsWith('<!--', i)) { const f = texto.indexOf('-->', i + 4); if (f < 0) return falha('malformado'); i = f + 3; continue; }
    if (texto.startsWith('<![CDATA[', i)) {
      if (!pilha.length) return falha('malformado');
      const f = texto.indexOf(']]>', i + 9); if (f < 0) return falha('malformado');
      pilha[pilha.length - 1].texto += texto.slice(i + 9, f); i = f + 3; continue;
    }
    if (texto.startsWith('<!', i) || texto.startsWith('<?', i)) return falha('proibido');
    if (texto.startsWith('</', i)) {
      const f = texto.indexOf('>', i); if (f < 0) return falha('malformado');
      const nome = texto.slice(i + 2, f).trim();
      const topo = pilha.pop();
      if (!topo || topo.qname !== nome) return falha('malformado');
      i = f + 1; continue;
    }
    // Tag de abertura.
    RE_NOME.lastIndex = i + 1;
    const mn = RE_NOME.exec(texto);
    if (!mn || mn.index !== i + 1) return falha('malformado');
    const qname = mn[0];
    let j = i + 1 + qname.length;
    const no: No = { nome: local(qname), qname, attrs: {}, ns: {}, filhos: [], texto: '' };
    let nAttr = 0;
    let fechou = false;
    for (;;) {
      const ini = j;
      while (j < n && /\s/.test(texto[j])) j++;
      if (j >= n) return falha('malformado');
      if (texto.startsWith('/>', j)) { j += 2; fechou = true; break; }
      if (texto[j] === '>') { j += 1; break; }
      if (j === ini) return falha('malformado'); // atributo grudado no nome ou no anterior
      RE_NOME.lastIndex = j;
      const ma = RE_NOME.exec(texto);
      if (!ma || ma.index !== j) return falha('malformado');
      const an = ma[0];
      j += an.length;
      while (j < n && /\s/.test(texto[j])) j++;
      if (texto[j] !== '=') return falha('malformado');
      j++;
      while (j < n && /\s/.test(texto[j])) j++;
      const q = texto[j];
      if (q !== '"' && q !== "'") return falha('malformado');
      const fq = texto.indexOf(q, j + 1);
      if (fq < 0) return falha('malformado');
      const bruto = texto.slice(j + 1, fq);
      if (bruto.includes('<')) return falha('malformado');
      const valor = semEntidades(bruto);
      j = fq + 1;
      if (++nAttr > MAX_ATRIBUTOS) return falha('grande');
      if (an === 'xmlns' || an.startsWith('xmlns:')) {
        if (!NS_OK.has(valor)) return falha('proibido');
        const p = an === 'xmlns' ? '' : an.slice(6);
        if (tem(no.ns, p)) return falha('malformado');
        no.ns[p] = valor;
      } else {
        const ln = local(an);
        if (tem(no.attrs, ln)) return falha('malformado');
        no.attrs[ln] = valor;
      }
    }
    if (++nos > MAX_NOS) return falha('grande');
    if (pilha.length) pilha[pilha.length - 1].filhos.push(no);
    else if (raiz) return falha('malformado'); // duas raízes
    else raiz = no;
    if (!fechou) { pilha.push(no); if (pilha.length > MAX_PROFUNDIDADE) return falha('grande'); }
    i = j;
  }
  if (pilha.length || !raiz) return falha('malformado');
  return raiz;
}

// ── 2. Centavos pela string, sem ponto flutuante ─────────────────────────────────────────────────────
/** "1234.56" -> 123456. `casas` é o máximo de casas decimais que o leiaute aceita. Arredonda meio para cima na 3ª casa. */
export function centavosDeDecimal(s: string, casas: number): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,13})(?:\.(\d+))?$/.exec(s);
  if (!m || (m[2] !== undefined && (m[2].length < 1 || m[2].length > casas))) return null;
  const frac = (m[2] || '').padEnd(3, '0');
  const c = parseInt(m[1], 10) * 100 + parseInt(frac.slice(0, 2), 10) + (frac.charCodeAt(2) - 48 >= 5 ? 1 : 0);
  return Number.isSafeInteger(c) ? c : null;
}

// ── 3. A NF-e ───────────────────────────────────────────────────────────────────────────────────────
const f1 = (no: No | null | undefined, nome: string): No | null => (no ? no.filhos.find((x) => x.nome === nome) || null : null);
const fN = (no: No | null | undefined, nome: string): No[] => (no ? no.filhos.filter((x) => x.nome === nome) : []);
const em = (no: No | null | undefined, ...nomes: string[]): No | null => nomes.reduce<No | null>((a, nm) => f1(a, nm), no ?? null);
const tx = (no: No | null | undefined, ...nomes: string[]): string => { const x = em(no, ...nomes); return x ? x.texto.trim() : ''; };
const curto = (v: unknown, max: number): string => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Opcional: vazio vale 0; preenchido e fora do formato derruba a leitura. */
function opc(s: string): number {
  if (s === '') return 0;
  const c = centavosDeDecimal(s, 2);
  return c === null ? falha('valor_invalido') : c;
}

function notaDaArvore(raiz: No, hojeBr: string): NotaXml {
  let nfe: No | null = null;
  let prot: No | null = null;
  if (raiz.nome === 'nfeProc') { nfe = f1(raiz, 'NFe'); prot = f1(raiz, 'protNFe'); if (fN(raiz, 'NFe').length !== 1) return falha('nao_e_nfe'); }
  else if (raiz.nome === 'NFe') nfe = raiz;
  else return falha('nao_e_nfe');
  if (!nfe || raiz.ns[''] !== NS_NFE || (nfe.ns[''] !== undefined && nfe.ns[''] !== NS_NFE)) return falha('nao_e_nfe');
  if (fN(nfe, 'infNFe').length !== 1) return falha('nao_e_nfe');
  const inf = f1(nfe, 'infNFe');
  const ide = f1(inf, 'ide'); const emit = f1(inf, 'emit'); const tot = em(inf, 'total', 'ICMSTot');
  if (!inf || !ide || !emit || !tot) return falha('nao_e_nfe');

  const mod = tx(ide, 'mod');
  if (mod !== '55' && mod !== '65') return falha('modelo_nao_aceito');
  const id = String(inf.attrs.Id || '');
  const chave = /^NFe\d{44}$/.test(id) ? id.slice(3) : '';
  if (!chaveNfeValida(chave)) return falha('chave_invalida');
  if (tx(ide, 'tpAmb') !== '1') return falha('homologacao');

  const cnpj = tx(emit, 'CNPJ'); const cpf = tx(emit, 'CPF');
  if (cnpj ? !(/^\d{14}$/.test(cnpj) && cnpjValido(cnpj)) : !/^\d{11}$/.test(cpf)) return falha('emitente_invalido');
  const dh = tx(ide, 'dhEmi') || tx(ide, 'dEmi');
  const data = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?)?$/.test(dh) ? dh.slice(0, 10) : '';
  if (!dataReal(data) || data > somaDias(hojeBr, 1)) return falha('data_invalida');
  const serie = tx(ide, 'serie'); const nNF = tx(ide, 'nNF');
  const confere = chave.slice(0, 2) === tx(ide, 'cUF')
    && chave.slice(2, 6) === data.slice(2, 4) + data.slice(5, 7)
    && chave.slice(6, 20) === (cnpj || `000${cpf}`)
    && chave.slice(20, 22) === mod
    && /^\d{1,3}$/.test(serie) && chave.slice(22, 25) === serie.padStart(3, '0')
    && /^\d{1,9}$/.test(nNF) && chave.slice(25, 34) === nNF.padStart(9, '0');
  if (!confere) return falha('chave_inconsistente');
  if (prot) {
    const ip = f1(prot, 'infProt');
    if (!ip || tx(ip, 'chNFe') !== chave) return falha('chave_inconsistente');
    if (tx(ip, 'cStat') !== '100' && tx(ip, 'cStat') !== '150') return falha('nao_autorizada');
  }

  const total = centavosDeDecimal(tx(tot, 'vNF'), 2);
  if (total === null || total <= 0 || total > VALOR_MAX_CENTAVOS) return falha('valor_invalido');

  const dets = fN(inf, 'det');
  if (!dets.length) return falha('sem_itens');
  const todos: ItemXml[] = dets.map((d): ItemXml => {
    const p = f1(d, 'prod'); const imp = f1(d, 'imposto');
    if (!p) return falha('nao_e_nfe');
    const vProd = centavosDeDecimal(tx(p, 'vProd'), 2);
    if (vProd === null) return falha('valor_invalido');
    // O ICMS de cada item é o primeiro filho de `imposto/ICMS` (ICMS00, ICMS10, ICMSSN202...). Nunca o vICMSSTRet nem o vFCPSTRet.
    const icmsX = f1(imp, 'ICMS')?.filhos[0] ?? null;
    const custo = vProd - opc(tx(p, 'vDesc')) + opc(tx(p, 'vFrete')) + opc(tx(p, 'vSeg')) + opc(tx(p, 'vOutro'))
      + opc(tx(imp, 'IPI', 'IPITrib', 'vIPI')) + opc(tx(icmsX, 'vICMSST')) + opc(tx(icmsX, 'vFCPST'));
    if (custo < 0 || custo > VALOR_MAX_CENTAVOS) return falha('valor_invalido');
    const q = tx(p, 'qCom');
    const quantidade = /^\d{1,11}(\.\d{1,4})?$/.test(q) && Number(q) > 0 && Number(q) < 1_000_000 ? Number(q) : 0;
    const ncm = tx(p, 'NCM');
    return {
      descricao: curto(tx(p, 'xProd'), 120) || 'Item da nota',
      quantidade, unidade: curto(tx(p, 'uCom'), 10),
      valor_unitario_centavos: centavosDeDecimal(tx(p, 'vUnCom'), 10),
      valor_produto_centavos: vProd,
      valor_total_centavos: custo,
      ncm: /^(\d{2}|\d{8})$/.test(ncm) ? ncm : '',
    };
  });
  const itens = todos.slice(0, MAX_ITENS);
  const soma = itens.reduce((a, x) => a + x.valor_total_centavos, 0);
  const resto = total - soma;
  if (resto > 0) {
    itens.push({
      descricao: todos.length > MAX_ITENS ? `Demais ${todos.length - MAX_ITENS} itens e ajustes da nota` : 'Ajuste da nota (impostos e outras despesas)',
      quantidade: 1, unidade: 'un', valor_unitario_centavos: resto, valor_produto_centavos: null, valor_total_centavos: resto, ncm: '', ajuste: true,
    });
  }
  return {
    tipo: 'nota_fiscal', emitente: curto(tx(emit, 'xNome'), 80), cnpj: cnpj || '', numero: nNF, data, chave, valor_total_centavos: total,
    itens, confianca: 'alta', origem: 'xml', modelo: mod, itens_na_nota: todos.length,
    soma_itens_centavos: itens.reduce((a, x) => a + x.valor_total_centavos, 0), diferenca_centavos: resto < 0 ? resto : 0,
  };
}

/** A leitura inteira. Nunca lança. */
export function lerNfeXml(bytes: Buffer, hojeBr: string): ResultadoXml {
  try { return { ok: true, nota: notaDaArvore(arvoreXml(bytes), hojeBr) }; }
  catch (e) { if (e instanceof ErroXml) return { ok: false, motivo: e.motivo }; return { ok: false, motivo: 'malformado' }; }
}
