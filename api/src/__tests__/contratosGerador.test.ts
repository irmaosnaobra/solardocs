/**
 * Bancada permanente dos contratos do /gerador.
 *
 * Lê o dashboard/public/gerador/index.html de verdade (sem copiar código), roda os <script> inline num
 * sandbox `vm` com um DOM de mentira (campos vazios, `window`, `localStorage`) e chama as funções que
 * montam o texto dos contratos (ctrDados, ctrModelo, ctrNumerar) e a tabela de pagamento (ctrPag*).
 * Sem rede, sem navegador. Só dados fictícios.
 *
 * O que vale para todo modelo: nenhum marcador solto, nenhum "undefined"/"NaN"/"null"/"[object", toda
 * remissão aponta para item que existe, nenhuma chave repetida, sem "neste ato", sem "justo e contratado" e
 * sem travessão. "Não incluído" fica proibido só nos modelos já reescritos pelas regras da casa
 * (contratoRegras.ts); nos outros há `it.todo`. Ao terminar a reescrita de um modelo, tire o nome dele de
 * AINDA_NAO_REESCRITOS e a regra passa a valer. Todos os modelos estão reescritos (o solar, o último, em 21/10/2026).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { CAMPOS_AGENTE } from '../services/gerador/contratoAgenteCampos';

const HTML = join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador', 'index.html');

// Modelos cujo texto ainda não foi reescrito pelas regras da casa. Remova daqui quando for reescrito.
const AINDA_NAO_REESCRITOS: string[] = [];

// ─── O sandbox ───────────────────────────────────────────────────────────────
type Ctx = Record<string, any>;
const campos: Record<string, string> = {};

function elemento(id: string): any {
  const base: Record<string, any> = {
    style: {}, children: [], childNodes: [], options: [], files: [], innerHTML: '', textContent: '', checked: false, id,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      const tem = Object.prototype.hasOwnProperty.call(campos, id);
      if (k === 'value') return tem ? campos[id] : '';
      // Campo preenchido aqui vale como "escrito no contrato" (espelho desligado), não como cópia da outra aba.
      if (k === 'dataset') return tem ? { tocado: '1' } : {};
      if (k in base) return base[k as string];
      if (k === 'closest' || k === 'querySelector' || k === 'parentElement' || k === 'parentNode' || k === 'cloneNode') return () => elemento(id + '/' + String(k));
      if (k === 'querySelectorAll' || k === 'getElementsByTagName') return () => [];
      return elemento(id + '.' + String(k));
    },
    set(_, k, v) { base[k as string] = v; return true; },
    apply() { return elemento(id + '()'); },
  });
}

function criarSandbox(): Ctx {
  let html = readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
  // O papeis-solar.js é script externo no navegador (carrega antes do script grande); aqui entra no mesmo lugar, como inline.
  html = html.replace('<script src="/gerador/papeis-solar.js"></script>', () => '<script>' + readFileSync(join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador', 'papeis-solar.js'), 'utf8').replace(/\r\n/g, '\n') + '</script>');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const doc = new Proxy({}, {
    get(_, k) {
      if (k === 'getElementById') return (id: string) => elemento(id);
      if (k === 'querySelectorAll') return () => [];
      if (k === 'querySelector' || k === 'createElement' || k === 'createElementNS') return () => elemento(String(k));
      if (k === 'readyState') return 'complete';
      if (k === 'cookie') return '';
      return elemento('document.' + String(k));
    },
  });
  const store: Record<string, string> = {};
  const nunca = () => new Promise(() => {});
  const ctx: Ctx = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: doc,
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: unknown) => { store[k] = String(v); }, removeItem: (k: string) => { delete store[k]; }, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node', language: 'pt-BR', onLine: true, clipboard: {}, serviceWorker: { addEventListener() {}, register: nunca, getRegistration: nunca, controller: null, ready: nunca() } },
    location: { href: 'http://localhost/gerador/', search: '', hash: '', pathname: '/gerador/', origin: 'http://localhost', hostname: 'localhost', reload() {}, replace() {} },
    history: { pushState() {}, replaceState() {} },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, requestAnimationFrame: () => 0, queueMicrotask() {},
    fetch: nunca, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({}), Image: function () {}, FormData: function () {}, URL, URLSearchParams, Intl, Date, Math, JSON, Promise,
    MutationObserver: function (this: any) { this.observe = () => {}; }, IntersectionObserver: function (this: any) { this.observe = () => {}; }, ResizeObserver: function (this: any) { this.observe = () => {}; },
    supabase: { createClient: () => new Proxy({}, { get: () => () => new Proxy(function () {}, { get: () => () => ({ then: () => {} }) }) }) },
    alert() {}, confirm: () => true, prompt: () => '', innerWidth: 1200, innerHeight: 900, performance: { now: () => 0 },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.top = ctx; ctx.parent = ctx;
  vm.createContext(ctx);
  const erros: string[] = [];
  scripts.forEach((s, i) => { try { vm.runInContext(s, ctx, { filename: 'gerador-inline-' + i }); } catch (e: any) { erros.push(`script ${i}: ${String(e && e.message).slice(0, 160)}`); } });
  ctx.__errosDeCarga = erros;
  return ctx;
}

let SB: Ctx;
const rodar = (codigo: string): any => vm.runInContext(codigo, SB);

type Extra = { pag?: boolean; pagModelo?: string; opc?: Record<string, boolean>; eqv?: any; pre?: string };

/** Zera a tela, preenche os campos e devolve o modelo já numerado. */
function gerar(tipo: string, c: Record<string, string>, extra: Extra = {}) {
  for (const k of Object.keys(campos)) delete campos[k];
  Object.assign(campos, c);
  SB.__tipo = tipo; SB.__semPag = extra.pag === false; SB.__opc = extra.opc || {}; SB.__eqv = extra.eqv || null; SB.__pagModelo = extra.pagModelo || 'vista';
  rodar('if (!globalThis.__swOrig) globalThis.__swOrig = ctrSoftware; ctrSoftware = __swOrig;');
  rodar("ctrEsc = ctrEscNovo(); ctrEsc.extras = [{ nome: 'Carregador DC 80 kW, instalado e comissionado', inc: true }]; ctrIa = { pedidos: [] };");
  if (extra.pre) rodar(extra.pre);
  return rodar(`(() => {
    if (!globalThis.__eqvOrig) globalThis.__eqvOrig = ctrEqv;
    ctrEqv = __eqv ? () => __eqv : __eqvOrig;
    ctrOpc = Object.assign({}, __opc);
    const saldo = Math.max(0, ctrComTipo(__tipo, ctrTotal) - ctrComTipo(__tipo, ctrSinalPago));
    ctrPag.linhas = __semPag ? [] : ctrPagModelo(__pagModelo, saldo);
    const d = ctrComTipo(__tipo, () => ctrDados());
    const modelo = ctrModelo(d);
    const { resolver, quebradas, pos } = ctrNumerar(modelo);
    return { d, modelo, quebradas, pos, resolver, blocos: ctrBlocosDoc(d), anexos: ctrAnexos(d).flat() };
  })()`);
}


/**
 * O texto final do papel, sem tags: cabeçalho, qualificação das partes (inclusive dono e fiador), cláusulas
 * com as remissões resolvidas, tabelas e fecho com as assinaturas. É o que o cliente lê.
 */
const textoDe = (r: any): string => [...r.blocos, ...(r.anexos || [])].join(' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
const chavesDe = (r: any): string[] => r.modelo.flatMap((c: any) => [c.key, ...c.itens.map((i: any) => i.key)]);

// ─── Dados fictícios ─────────────────────────────────────────────────────────
const PF = { 'ctr-contratante': 'Cliente Teste', 'ctr-contratante-doc': '111.444.777-35', 'ctr-contratante-end': 'Rua Exemplo, 100, Centro, Cidade Teste/MG', 'ctr-cidade': 'Cidade Teste',
  'ctr-contratante-cep': '38400-000', 'ctr-contratante-tel': '(34) 90000-0000', 'ctr-contratante-email': 'cliente@exemplo.test', 'ctr-local': 'Av. Exemplo, 200, Cidade Teste/MG',
  'ctr-foro': 'Cidade Teste/MG', 'ctr-ta-matricula': '12345', 'ctr-ta-cartorio': '1º Ofício de Registro de Imóveis de Cidade Teste', 'ctr-multa': '2', 'ctr-juros': '1', 'ctr-equip': 'carregador de corrente contínua de 80 kW', 'orc-cli-doc': '111.444.777-35' };
const PJ = { ...PF, 'ctr-contratante': 'Empresa Teste Ltda', 'ctr-contratante-doc': '11.222.333/0001-81', 'orc-cli-doc': '11.222.333/0001-81', 'ctr-rep': 'Representante Teste', 'ctr-rep-doc': '222.555.888-46' };
const OBRA = { 'ctr-total': '145.000,00', 'ctr-sinal': '10.000,00' };
const SOC = { 'ctr-soc-software': '5', 'ctr-soc-invest': '145.000,00', 'ctr-soc-aporte': '72.500,00', 'ctr-soc-cota': '50', 'ctr-soc-cota-nexus': '50', 'ctr-soc-aporte-nexus': '72.500,00', 'ctr-sinal': '10.000,00' };
const COTAS = { ...SOC, 'ctr-soc-n': '4', 'ctr-soc-qtd': '2', 'ctr-soc-cota': '25', 'ctr-soc-aporte': '36.250,00', 'ctr-soc-cota-nexus': '0', 'ctr-soc-aporte-nexus': '0' };
const DONO = { 'ctr-int-nome': 'Dono Teste', 'ctr-int-doc': '333.666.999-60', 'ctr-int-end': 'Rua do Dono, 5, Cidade Teste/MG', 'ctr-int-qualidade': 'proprietario' };
const FIADOR = { 'ctr-aval-tem': 'sim', 'ctr-aval-nome': 'Fiador Teste', 'ctr-aval-doc': '444.777.000-91', 'ctr-aval-end': 'Rua do Fiador, 9, Cidade Teste/MG', 'ctr-aval-rg': 'MG-00.000.000', 'ctr-aval-qualif': 'brasileiro, casado' };
const FIADOR_PJ = { ...FIADOR, 'ctr-aval-nome': 'Fiadora Teste Ltda', 'ctr-aval-doc': '55.666.777/0001-88', 'ctr-aval-rep': 'Sócio Teste', 'ctr-aval-rep-doc': '555.888.111-04' };
const ITEM_CARREGADOR = { desc: 'Carregador DC 80 kW', detalhe: '', ncm: '8504.40.90', un: 'un', qtd: 1, unit: 12000000, opcional: false };
const EQV = { itens: [ITEM_CARREGADOR], fora: [], subtotal: 120000, frete: 2000, total: 122000, num: 'EQ-TESTE-1', freteTipo: 'CIF',
  entregaLocal: 'Av. Exemplo, 200, Cidade Teste/MG', prazo: '30 dias', garantia: '12 meses', emit: {}, ie: '' };
/** Pedido com mais um item: o preço total acompanha (centavos nos itens, reais no total). */
const eqvCom = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const it = { detalhe: '', ncm: '', un: 'un', qtd: 1, opcional: false, ...item } as any;
  const subtotal = (ITEM_CARREGADOR.unit + it.unit * it.qtd) / 100;
  return { ...EQV, itens: [ITEM_CARREGADOR, it], subtotal, total: subtotal + EQV.frete, ...extra };
};

type Cenario = { nome: string; tipo: string; campos: Record<string, string>; extra?: Extra; vale?: (r: any) => void; lacuna?: boolean };
// O que cada cenário tem de provar sobre o papel: a parte, o dono e o fiador chegam ao texto (preâmbulo e assinaturas).
const noPapel = (r: any, ...nomes: string[]) => { const t = textoDe(r); for (const n of nomes) expect(t, 'no papel: ' + n).toContain(n); };
const comFiador = (r: any) => { expect(r.d.aval && r.d.aval.nome).toMatch(/^Fiadora? Teste/); noPapel(r, r.d.aval.nome); };
const comDono = (r: any) => { expect(r.d.interv && r.d.interv.nome).toBe('Dono Teste'); noPapel(r, 'Dono Teste'); };
const foroDoConsumidor = (r: any) => expect(textoDe(r)).toMatch(/domic[ií]lio/);
const tem = (r: any, ...frases: Array<string | RegExp>) => { const t = textoDe(r); for (const f of frases) expect(t, 'deve ter: ' + f).toMatch(f instanceof RegExp ? f : new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); };
const nao = (r: any, ...frases: Array<string | RegExp>) => { const t = textoDe(r); for (const f of frases) expect(t, 'não deve ter: ' + f).not.toMatch(f instanceof RegExp ? f : new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); };
const ambos = (...fs: Array<(r: any) => void>) => (r: any) => fs.forEach(f => f(r));
const CENARIOS: Record<string, Cenario[]> = {
  completo: [
    { nome: 'pessoa física', tipo: 'completo', campos: { ...PF, ...OBRA }, vale: foroDoConsumidor },
    { nome: 'empresa', tipo: 'completo', campos: { ...PJ, ...OBRA }, vale: r => { expect(textoDe(r)).not.toMatch(/domic[ií]lio/); noPapel(r, 'Representante Teste'); } },
    { nome: 'dono do imóvel diferente', tipo: 'completo', campos: { ...PF, ...OBRA, 'ctr-soc-dono': 'nao' }, vale: ambos(r => tem(r, 'termo de anuência'), r => nao(r, 'declara ser o dono do imóvel')) },
    { nome: 'imóvel é do cliente', tipo: 'completo', campos: { ...PF, ...OBRA, 'ctr-soc-dono': 'sim' }, vale: ambos(r => tem(r, 'declara ser o dono do imóvel'), r => nao(r, 'termo de anuência do proprietário')) },
    { nome: 'sem sinal', tipo: 'completo', campos: { ...PF, 'ctr-total': '145.000,00' }, vale: ambos(r => tem(r, 'custos já feitos e comprovados'), r => nao(r, 'arras penitenciais')) },
    { nome: 'com sinal: arras e dobro', tipo: 'completo', campos: { ...PF, ...OBRA }, vale: ambos(r => tem(r, 'arras penitenciais', 'em dobro')) },
    { nome: 'cartão de crédito', tipo: 'completo', campos: { ...PF, ...OBRA }, extra: { pagModelo: 'cartao' }, vale: r => tem(r, 'Cartão de crédito') },
    { nome: 'parcelamento direto (reserva de domínio)', tipo: 'completo', campos: { ...PF, ...OBRA }, extra: { pagModelo: 'boleto' }, vale: r => tem(r, 'reserva de domínio') },
    { nome: 'financiamento', tipo: 'completo', campos: { ...PF, ...OBRA }, extra: { pagModelo: 'fin' }, vale: r => tem(r, 'Financiamento bancário', 'o banco') },
    { nome: 'com Software e percentual da plataforma', tipo: 'completo', campos: { ...PF, ...OBRA, 'ctr-pct': '5', 'ctr-mostra-pct': '1' }, extra: { pre: 'ctrSoftware = () => true;' }, vale: r => tem(r, 'plataforma de gestão', /5% \(cinco por cento\) do faturamento bruto/) },
    { nome: 'com vistoria', tipo: 'completo', campos: { ...PF, ...OBRA, 'vis-conclusao': 'apto', 'vis-num': 'V-1', 'vis-data': '2026-10-10' }, vale: r => tem(r, 'Relatório de Vistoria Técnica') },
    { nome: 'multa de 10% digitada: pessoa física no máximo 2%', tipo: 'completo', campos: { ...PF, ...OBRA, 'ctr-multa': '10' }, vale: ambos(r => tem(r, '2% (dois por cento)'), r => nao(r, '10% (dez por cento)')) },
    { nome: 'multa de 10% digitada: empresa mantém', tipo: 'completo', campos: { ...PJ, ...OBRA, 'ctr-multa': '10' }, vale: r => tem(r, '10% (dez por cento)') },
    { nome: 'limite de responsabilidade só com CNPJ (empresa)', tipo: 'completo', campos: { ...PJ, ...OBRA }, vale: r => tem(r, 'fica limitada ao valor que ela recebeu') },
    { nome: 'limite de responsabilidade só com CNPJ (CPF digitado errado vale pessoa física)', tipo: 'completo', campos: { ...PF, 'ctr-contratante-doc': '111.444.777', ...OBRA }, vale: ambos(r => nao(r, 'fica limitada ao valor que ela recebeu'), foroDoConsumidor) },
    { nome: 'arrependimento de 7 dias só para pessoa física (PF)', tipo: 'completo', campos: { ...PF, ...OBRA }, vale: r => tem(r, /desistir dele em até 7 \(sete\) dias/) },
    { nome: 'arrependimento de 7 dias só para pessoa física (empresa)', tipo: 'completo', campos: { ...PJ, ...OBRA }, vale: r => nao(r, /desistir dele em até 7 \(sete\) dias/) },
    { nome: 'com fiador pessoa física', tipo: 'completo', campos: { ...PJ, ...OBRA, ...FIADOR }, vale: comFiador },
    { nome: 'com fiador empresa', tipo: 'completo', campos: { ...PF, ...OBRA, ...FIADOR_PJ }, vale: comFiador },
    { nome: 'sem pagamento montado', tipo: 'completo', campos: { ...PF, ...OBRA }, extra: { pag: false }, lacuna: true },
  ],
  socio50: [
    { nome: 'pessoa física', tipo: 'socio50', campos: { ...PF, ...SOC } },
    { nome: 'empresa', tipo: 'socio50', campos: { ...PJ, ...SOC } },
    { nome: 'dono do imóvel diferente (interveniente)', tipo: 'socio50', campos: { ...PF, ...SOC, ...DONO }, vale: comDono },
    { nome: 'sócio não é o dono (sem interveniente)', tipo: 'socio50', campos: { ...PJ, ...SOC, 'ctr-soc-dono': 'nao' } },
    { nome: 'captação (aporte menor que o investimento)', tipo: 'socio50', campos: { ...PF, ...SOC, 'ctr-soc-aporte': '30.000,00', 'ctr-soc-aporte-nexus': '30.000,00' } },
  ],
  cotas: [
    { nome: 'pessoa física', tipo: 'cotas', campos: { ...PF, ...COTAS } },
    { nome: 'empresa', tipo: 'cotas', campos: { ...PJ, ...COTAS } },
    { nome: 'uma cota só', tipo: 'cotas', campos: { ...PF, ...COTAS, 'ctr-soc-qtd': '1' } },
  ],
  equip: [
    { nome: 'pessoa física', tipo: 'equip', campos: { ...PF }, extra: { eqv: EQV } },
    { nome: 'empresa', tipo: 'equip', campos: { ...PJ }, extra: { eqv: EQV } },
    { nome: 'com fiador', tipo: 'equip', campos: { ...PJ, ...FIADOR }, extra: { eqv: EQV }, vale: comFiador },
    { nome: 'a tabela de itens sai preenchida (descrição e NCM)', tipo: 'equip', campos: { ...PF }, extra: { eqv: EQV }, vale: r => tem(r, 'Carregador DC 80 kW', '8504.40.90') },
    { nome: 'com sinal: arras, e o atraso da vendedora devolve sem o dobro', tipo: 'equip', campos: { ...PF, 'ctr-sinal': '10.000,00' }, extra: { eqv: EQV }, vale: ambos(r => tem(r, 'arras penitenciais', 'sem o dobro'), r => nao(r, 'Da instalação do quadro')) },
    { nome: 'com instalação vendida: garantia da instalação', tipo: 'equip', campos: { ...PF }, extra: { eqv: eqvCom({ desc: 'Instalação do carregador', unit: 800000 }) }, lacuna: true /* serviço não tem NCM */,
      vale: ambos(r => tem(r, 'nota fiscal de serviço da instalação', /corrige sem custo o defeito de execução da instalação/), r => expect(r.d.eqv.itens.length).toBe(2)) },
    { nome: 'com "Kit de instalação": é material, não instalação vendida', tipo: 'equip', campos: { ...PF }, extra: { eqv: eqvCom({ desc: 'Kit de instalação', ncm: '8536.90.90', unit: 300000 }) },
      vale: r => { nao(r, 'nota fiscal de serviço da instalação', 'defeito de execução da instalação'); expect(r.d.eqv.itens.some((i: any) => /kit/i.test(i.desc))).toBe(true); SB.__q = r.d.eqv; expect(rodar('ctrEqInstVendida(__q)')).toBe(false); } },
    { nome: 'com "Instalação do kit carregador": a descrição não começa com kit, é instalação vendida', tipo: 'equip', campos: { ...PF }, extra: { eqv: eqvCom({ desc: 'Instalação do kit carregador', unit: 800000 }) }, lacuna: true /* serviço não tem NCM */,
      vale: r => { tem(r, 'nota fiscal de serviço da instalação'); SB.__q = r.d.eqv; expect(rodar('ctrEqInstVendida(__q)')).toBe(true); } },
    { nome: 'frete FOB', tipo: 'equip', campos: { ...PF }, extra: { eqv: { ...EQV, freteTipo: 'FOB' } }, vale: r => tem(r, '(FOB)') },
    { nome: 'multa de 10% digitada: pessoa física no máximo 2%', tipo: 'equip', campos: { ...PF, 'ctr-multa': '10' }, extra: { eqv: EQV }, vale: ambos(r => tem(r, '2% (dois por cento)'), r => nao(r, '10% (dez por cento)')) },
    { nome: 'limite de responsabilidade só com CNPJ', tipo: 'equip', campos: { ...PF }, extra: { eqv: EQV }, vale: r => nao(r, /limitada ao valor já pago/) },
    { nome: 'arrependimento de 7 dias só para pessoa física', tipo: 'equip', campos: { ...PJ }, extra: { eqv: EQV }, vale: r => nao(r, /pode desistir em até 7 \(sete\) dias/) },
  ],
  arrend: [
    { nome: 'percentual, pessoa física', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-piso': '500,00' } },
    { nome: 'percentual, empresa', tipo: 'arrend', campos: { ...PJ, 'ctr-arr-pct': '5', 'ctr-arr-piso': '500,00' } },
    { nome: 'valor fixo com reajuste', tipo: 'arrend', campos: { ...PF, 'ctr-arr-modo': 'fixo', 'ctr-arr-fixo': '2.000,00', 'ctr-arr-fixo-meses': '24', 'ctr-arr-reajuste': '10' } },
    { nome: 'dono do imóvel diferente (interveniente)', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', ...DONO }, vale: comDono },
    { nome: 'locatário cede o ponto', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-relacao': 'locatario', ...DONO, 'ctr-int-qualidade': 'locatario' } },
    { nome: 'ligação nova de energia, pessoa física: negrito, foro do domicílio, registro como direito da NEXUS', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-energia': 'uc' },
      vale: ambos(foroDoConsumidor, r => tem(r, 'Da ligação nova de energia', /A CESSIONÁRIA pode, por sua conta, registrar este contrato/), r => nao(r, 'averbam', 'material institucional e publicitário'), r => expect(r.blocos.join('')).toMatch(/<b>Durante o contrato, o CEDENTE não instala/)) },
    { nome: 'ligação nova, empresa: sem negrito de consumidor nem foro do domicílio', tipo: 'arrend', campos: { ...PJ, 'ctr-arr-pct': '5', 'ctr-arr-energia': 'uc' },
      vale: ambos(r => nao(r, /domic[ií]lio/), r => expect(r.blocos.join('')).not.toMatch(/<b>Durante o contrato, o CEDENTE não instala/)) },
    { nome: 'a NEXUS mantém a proteção contra cobrança de lucro cessante (pessoa física também)', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5' }, vale: r => tem(r, 'Nenhuma das partes responde por lucro cessante da outra') },
    { nome: 'energia no medidor da NEXUS na conta do cedente: fatura em dia', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-energia': 'sub' }, vale: r => tem(r, 'mantém em dia a fatura da sua unidade consumidora') },
    { nome: 'energia refaturada ao cedente', tipo: 'arrend', campos: { ...PJ, 'ctr-arr-pct': '5', 'ctr-arr-energia': 'refatura' }, vale: r => tem(r, 'mantém em dia a fatura da sua unidade consumidora') },
    { nome: 'valor fixo sem reajuste, empresa', tipo: 'arrend', campos: { ...PJ, 'ctr-arr-modo': 'fixo', 'ctr-arr-fixo': '2.000,00', 'ctr-arr-fixo-meses': '36', 'ctr-arr-reajuste': '0' }, vale: r => nao(r, 'Da medição e da prestação de contas') },
    { nome: 'percentual com contrato de sociedade e reserva paga', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-soc-ref': 'CS-1', 'ctr-arr-premio': '1.000,00', 'ctr-origem-ref': 'TA-1' }, vale: r => tem(r, 'não cria outra sociedade entre as partes') },
    { nome: 'multa de mora do cedente pessoa física limitada a 2%', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-mora-multa': '10' }, vale: r => tem(r, 'com a multa limitada a 2% (dois por cento)') },
    { nome: 'cliente é o cessionário (cedente terceiro)', tipo: 'arrend', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-cess': 'cliente', 'ctr-ced-nome': 'Cedente Teste', 'ctr-ced-doc': '666.999.222-77', 'ctr-ced-end': 'Rua do Cedente, 7, Cidade Teste/MG' },
      vale: ambos(r => nao(r, 'não é parte deste contrato'), r => tem(r, 'Cedente Teste'), r => nao(r, /domic[ií]lio/), r => expect(r.blocos.join('')).not.toMatch(/<b>Durante o contrato, o CEDENTE não instala/)) },
  ],
  termo_arr: [
    { nome: 'promessa, pessoa física', tipo: 'termo_arr', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-ta-nivel': 'promessa', 'ctr-ta-premio': '1.000,00' } },
    { nome: 'promessa, empresa', tipo: 'termo_arr', campos: { ...PJ, 'ctr-arr-pct': '5', 'ctr-ta-nivel': 'promessa', 'ctr-ta-premio': '1.000,00' } },
    { nome: 'carta de intenção', tipo: 'termo_arr', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-ta-nivel': 'intencao' } },
    { nome: 'dono do imóvel diferente (interveniente)', tipo: 'termo_arr', campos: { ...PF, 'ctr-arr-pct': '5', ...DONO }, vale: comDono },
    { nome: 'promessa, valor fixo, reserva, multa, inquilino com dono interveniente', tipo: 'termo_arr', campos: { ...PF, 'ctr-arr-modo': 'fixo', 'ctr-arr-fixo': '2.000,00', 'ctr-arr-fixo-meses': '24', 'ctr-arr-reajuste': '10', 'ctr-ta-nivel': 'promessa', 'ctr-ta-premio': '1.000,00', 'ctr-ta-multa': '5.000,00', 'ctr-arr-relacao': 'locatario', ...DONO },
      vale: ambos(comDono, foroDoConsumidor, r => tem(r, 'mesma multa', 'nem do INTERVENIENTE ANUENTE', 'Anexo I · Minuta do contrato de cessão', 'CESSIONÁRIA', 'CEDENTE'), r => nao(r, 'COMPROMITENTE', 'COMPROMISSÁRIA')) },
    { nome: 'promessa sem multa: perdas e danos nas duas pontas', tipo: 'termo_arr', campos: { ...PJ, 'ctr-arr-pct': '5', 'ctr-ta-nivel': 'promessa', 'ctr-ta-modelo': 'aberto' }, vale: ambos(r => tem(r, 'propor ao CEDENTE uma sociedade'), r => nao(r, /domic[ií]lio/)) },
    { nome: 'promessa com piso, energia própria e 2 vagas', tipo: 'termo_arr', campos: { ...PF, 'ctr-arr-pct': '5', 'ctr-arr-piso': '500,00', 'ctr-arr-carencia': '3', 'ctr-arr-vagas': '2', 'ctr-arr-energia': 'uc', 'ctr-ta-nivel': 'promessa' } },
    { nome: 'carta de intenção, valor fixo, modelo aberto', tipo: 'termo_arr', campos: { ...PF, 'ctr-arr-modo': 'fixo', 'ctr-arr-fixo': '2.000,00', 'ctr-arr-fixo-meses': '36', 'ctr-arr-reajuste': '0', 'ctr-ta-nivel': 'intencao', 'ctr-ta-modelo': 'aberto', 'ctr-ta-premio': '1.000,00' },
      vale: ambos(r => tem(r, 'Das condições pretendidas', 'não obriga as partes a assinar'), r => nao(r, 'Anexo I · Minuta')) },
    { nome: 'carta de intenção, percentual, horário do estabelecimento', tipo: 'termo_arr', campos: { ...PJ, 'ctr-arr-pct': '5', 'ctr-ta-nivel': 'intencao', 'ctr-arr-horario': 'estab' }, vale: r => tem(r, 'login de leitura') },
  ],
  termo_inv: [
    { nome: 'reserva, pessoa física', tipo: 'termo_inv', campos: { ...PF, ...COTAS, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'reserva', 'ctr-ti-deposito': '5.000,00' } },
    { nome: 'reserva, empresa', tipo: 'termo_inv', campos: { ...PJ, ...COTAS, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'reserva', 'ctr-ti-deposito': '5.000,00' } },
    { nome: 'reserva no 50/50', tipo: 'termo_inv', campos: { ...PF, ...SOC, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'reserva', 'ctr-ti-modelo': 'socio50', 'ctr-ti-deposito': '5.000,00' } },
    { nome: 'adesão a sociedade em cotas', tipo: 'termo_inv', campos: { ...PF, ...COTAS, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'adesao', 'ctr-ti-consent': '9', 'ctr-ti-contrato-num': 'TESTE-1', 'ctr-ti-contrato-data': '2026-10-01' } },
    { nome: 'reserva em cotas sem depósito: qualquer lado encerra sem custo', tipo: 'termo_inv', campos: { ...PF, ...COTAS, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'reserva' },
      vale: ambos(r => tem(r, 'Sem depósito, cada parte pode encerrar a reserva', 'Anexo I · Minuta do contrato de sociedade'), r => nao(r, 'arras', 'Do depósito de reserva')) },
    { nome: 'reserva em cotas com depósito no cartão, local definido, origem pessoal: arras e dobro', tipo: 'termo_inv', campos: { ...PF, ...COTAS, 'ctr-ti-uso': 'reserva', 'ctr-ti-deposito': '5.000,00', 'ctr-ti-deposito-forma': 'cartão de crédito', 'ctr-ti-ponto': 'Av. Teste, 1, Cidade Teste/MG', 'ctr-ti-origem': 'pessoal' },
      vale: ambos(r => tem(r, 'arras penitenciais', 'em dobro', 'não assinar o contrato de cessão do local', 'estorno total da compra no cartão', 'contato pessoal anterior', 'devolve o depósito em dobro'), r => nao(r, 'Forma pretendida')) },
    { nome: 'reserva em cotas, empresa, com depósito, sem local definido', tipo: 'termo_inv', lacuna: true, campos: { ...PJ, ...COTAS, 'ctr-ti-uso': 'reserva', 'ctr-ti-deposito': '5.000,00', 'ctr-ti-regiao': 'Cidade Teste/MG', 'ctr-ti-raio': '50' }, vale: ambos(r => nao(r, /domic[ií]lio/), r => tem(r, 'local a definir', 'a até 50 (cinquenta) km')) },
    { nome: 'reserva em cotas com o campo escondido ctr-sinal preenchido: a minuta anexa diz só o depósito da reserva', tipo: 'termo_inv', campos: { ...PF, ...COTAS, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'reserva', 'ctr-ti-deposito': '5.000,00', 'ctr-sinal': '7.000,00' },
      vale: r => { const anexo = (r.anexos || []).join(' ').replace(/<[^>]+>/g, ' '); expect(r.d.sinal).toBeGreaterThan(0); expect(anexo).toMatch(/5\.000,00/); expect(anexo).not.toMatch(/7\.000,00|12\.000,00/); } },
    { nome: 'reserva no 50/50 sem depósito', tipo: 'termo_inv', campos: { ...PF, ...SOC, 'ctr-ti-ponto': 'Av. Exemplo, 200, Cidade Teste/MG', 'ctr-ti-uso': 'reserva', 'ctr-ti-modelo': 'socio50' }, vale: r => tem(r, 'Sem depósito, cada parte pode encerrar') },
    { nome: 'reserva no 50/50, o investidor não é o dono do imóvel', tipo: 'termo_inv', campos: { ...PF, ...SOC, 'ctr-ti-uso': 'reserva', 'ctr-ti-modelo': 'socio50', 'ctr-ti-deposito': '5.000,00', 'ctr-soc-dono': 'nao', 'ctr-ti-ponto': 'Av. Teste, 1, Cidade Teste/MG' },
      vale: ambos(r => tem(r, 'autorização escrita do dono do imóvel', 'protocola o pedido de acesso em até 30 (trinta) dias', 'impedir de má-fé a aceitação do pedido de acesso'), r => nao(r, 'não assinar o contrato de cessão do local')) },
    { nome: 'adesão com depósito da reserva, cartão e termo de origem', tipo: 'termo_inv', campos: { ...PF, ...COTAS, 'ctr-ti-uso': 'adesao', 'ctr-ti-contrato-num': 'TESTE-1', 'ctr-ti-contrato-data': '2026-10-01', 'ctr-ti-consent': '9', 'ctr-ti-ponto': 'Av. Teste, 1, Cidade Teste/MG', 'ctr-ti-deposito': '5.000,00', 'ctr-origem-ref': 'nº TI-1' }, extra: { pagModelo: 'cartao10' },
      vale: ambos(r => tem(r, 'Esta adesão cumpre o Termo de Compromisso e Reserva de Cota', 'estorno total da compra no cartão'), r => nao(r, 'Do depósito de reserva')) },
    { nome: 'adesão, empresa, sem tabela de pagamento', tipo: 'termo_inv', campos: { ...PJ, ...COTAS, 'ctr-ti-uso': 'adesao', 'ctr-ti-contrato-num': 'TESTE-1', 'ctr-ti-contrato-data': '2026-10-01', 'ctr-ti-consent': '9', 'ctr-ti-ponto': 'Av. Teste, 1, Cidade Teste/MG' }, extra: { pag: false }, lacuna: true },
  ],
};


// ─── As verificações ─────────────────────────────────────────────────────────
function confereEstrutura(r: any, rotulo: string) {
  const txt = textoDe(r);
  expect(r.modelo.length, rotulo + ': tem cláusulas').toBeGreaterThan(3);
  expect(r.quebradas, rotulo + ': remissão para item que não existe').toEqual([]);
  expect(txt, rotulo).not.toMatch(/\{\{|\}\}/);
  expect(txt, rotulo).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b|\[object/);
  const chaves = chavesDe(r);
  expect(chaves.filter((k: string, i: number) => chaves.indexOf(k) !== i), rotulo + ': chave repetida').toEqual([]);
  // Toda chave citada num marcador existe no modelo (confere o que o resolver faria calado).
  const html = r.modelo.flatMap((c: any) => c.itens.map((i: any) => String(i.html))).join('\n');
  const citadas = [...html.matchAll(/\{\{[cin]:([A-Za-z0-9._-]+)\}\}/g)].map(m => m[1]);
  expect(citadas.filter((k: string) => !chaves.includes(k)), rotulo + ': marcador para chave inexistente').toEqual([]);
}

function confereEstilo(r: any, rotulo: string, comNaoIncluido: boolean) {
  const txt = textoDe(r);
  expect(txt, rotulo).not.toMatch(/neste ato/i);
  expect(txt, rotulo).not.toMatch(/justo e contratado|justas e contratadas/i);
  expect(txt, rotulo).not.toMatch(/[—–]/);
  if (comNaoIncluido) expect(txt, rotulo).not.toMatch(/\bobriga-se\b|\bobrigam-se\b/i);
  if (comNaoIncluido) expect(txt, rotulo).not.toMatch(/n[ãa]o inclu[ií]do/i);
}

beforeAll(() => { SB = criarSandbox(); }, 30000);

describe('contratos do /gerador: o sandbox carrega o index.html real', () => {
  it('os scripts inline rodam e as funções dos contratos existem', () => {
    expect(SB.__errosDeCarga).toEqual([]);
    for (const f of ['ctrModelo', 'ctrModeloSociedade', 'ctrModeloObra', 'ctrModeloEquip', 'ctrModeloArrend', 'ctrModeloTermoInv', 'ctrModeloTermoArr', 'ctrNumerar', 'ctrPagTrava']) {
      expect(typeof SB[f], f).toBe('function');
    }
  });
});

describe('contratos do /gerador: Arrendamento com o cliente como cessionário não leva a marca da NEXUS', () => {
  const CED = { 'ctr-arr-cess': 'cliente', 'ctr-ced-nome': 'Cedente Teste', 'ctr-ced-doc': '666.999.222-77', 'ctr-ced-end': 'Rua do Cedente, 7, Cidade Teste/MG' };
  // O papel inteiro: cabeçalho, corpo, fecho com as assinaturas e o pé de cada folha (ctrRodapeHTML, o mesmo que o ctrHTML usa).
  const papel = (r: any) => [...r.blocos, ...(r.anexos || []), ctrRodape(r.d, 1, 2), ctrRodape(r.d, 2, 2)].join(' ');
  const ctrRodape = (d: any, n: number, tot: number): string => { SB.__d = d; return rodar(`ctrRodapeHTML(__d, ${n}, ${tot})`); };
  const MARCA = /NEXUS|Nexus|AIOROS|nexus-logo|nexus-x/;

  it('modo cliente: nem NEXUS, nem AIOROS, nem logo, nem ícone do pé, mesmo com o carregador "NEXUS DC80" do Simulador', () => {
    for (const energia of ['uc', 'sub']) {
      const r = gerar('arrend', { ...PF, ...CED, 'ctr-arr-pct': '5', 'ctr-arr-energia': energia, 'ctr-equip': 'NEXUS DC80 · 80 kW' });
      expect(r.d.arrCli).toBe(true);
      const html = papel(r);
      expect(html.match(MARCA), 'marca no papel (energia ' + energia + ')').toBeNull();
      expect(textoDe(r)).toMatch(/carregador de corrente contínua de 80 kW/);
      // As proteções do contrato entre cliente e cedente seguem.
      if (energia === 'uc') tem(r, 'autoriza expressamente', 'comprova a posse da ÁREA', 'Dados do IMÓVEL');
      tem(r, 'Cedente Teste', 'CEDENTE', 'CESSIONÁRIO', 'Das obrigações do CEDENTE');
    }
  });

  it('modo cliente com valor fixo, pessoa jurídica e dono interveniente: sem marca', () => {
    const r = gerar('arrend', { ...PJ, ...CED, ...DONO, 'ctr-arr-modo': 'fixo', 'ctr-arr-fixo': '2.000,00', 'ctr-arr-fixo-meses': '24', 'ctr-arr-reajuste': '10', 'ctr-arr-relacao': 'locatario', 'ctr-int-qualidade': 'locatario', 'ctr-equip': 'NEXUS DC80 · 80 kW' });
    expect(papel(r).match(MARCA)).toBeNull();
  });

  // A Anuência que acompanha o Arrendamento: o proprietário (ou o inquilino) anui à cessão entre o cedente e o CLIENTE.
  const ANU = { 'anu-nome': 'Dono Teste', 'anu-doc': '333.666.999-60', 'anu-end': 'Rua do Dono, 5, Cidade Teste/MG', 'ctr-tipo': 'arrend' };
  const anuencia = (c: Record<string, string>): string => { for (const k of Object.keys(campos)) delete campos[k]; Object.assign(campos, c); return rodar('anuHTML(anuDados())'); };

  it('Anuência em modo cliente: sem logo, sem ícone e sem NEXUS/AIOROS, e o cliente aparece como CESSIONÁRIO', () => {
    for (const caso of ['dono_cessao', 'inquilino_cessao']) {
      const h = anuencia({ ...PF, ...CED, ...ANU, 'anu-caso': caso, 'ctr-arr-pct': '5', 'ctr-equip': 'NEXUS DC80 · 80 kW' });
      expect(h.match(MARCA), 'marca na anuência (' + caso + ')').toBeNull();
      expect(h).toContain('Cliente Teste');
      expect(h).toContain('CESSIONÁRIO');
      expect(h).toContain('Dono Teste');
    }
  });

  it('Anuência fora do modo cliente: a NEXUS continua (logo, ícone e partes)', () => {
    const h = anuencia({ ...PF, ...ANU, 'anu-caso': 'dono_cessao', 'ctr-arr-pct': '5' });
    expect(h).toContain('nexus-logo-papel.png');
    expect(h).toContain('nexus-x.png');
    expect(h).toContain('(a "NEXUS")');
    expect(h).toContain('Termo de anuência · Eletroposto');
  });

  it('modo normal: a NEXUS continua no cabeçalho, no pé e nas partes', () => {
    const r = gerar('arrend', { ...PF, 'ctr-arr-pct': '5' });
    expect(r.d.arrCli).toBeFalsy();
    const html = papel(r);
    expect(html).toContain('nexus-logo-papel.png');
    expect(html).toContain('nexus-x.png');
    expect(html).toContain('alt="NEXUS Eletroposto"');
    expect(html).toContain('Cessão de Área · Eletroposto');
    expect(html).not.toContain('Recarga de veículos elétricos · Cliente Teste');
    expect(html).not.toContain('não é parte deste contrato');
  });
});

describe('contratos do /gerador: estrutura de todos os modelos', () => {
  for (const [modelo, lista] of Object.entries(CENARIOS)) {
    describe(modelo, () => {
      for (const c of lista) {
        it(`${c.nome}: sem marcador solto, sem undefined, remissões e chaves em ordem`, () => {
          const r = gerar(c.tipo, c.campos, c.extra);
          expect(r.d.tipo).toBe(c.tipo);
          const cli = /Empresa Teste/.test(c.campos['ctr-contratante'] || '') ? 'Empresa Teste Ltda' : 'Cliente Teste';
          if (!c.campos['ctr-arr-cess']) noPapel(r, cli);
          if (c.vale) c.vale(r);
          confereEstrutura(r, `${modelo} / ${c.nome}`);
          // Com os dados preenchidos, nenhuma linha em branco para completar à mão (lacuna) pode sobrar no papel nem nos anexos.
          if (!c.lacuna) {
            const h = [...r.blocos, ...(r.anexos || [])].join('');
            const onde = [...h.matchAll(/ep-rec-vazio/g)].map(m => h.slice(Math.max(0, m.index! - 90), m.index!).replace(/<[^>]+>/g, '').replace(/\s+/g, ' '));
            expect(onde, `${modelo} / ${c.nome}: lacuna sobrando depois de`).toEqual([]);
          }
        });
      }
    });
  }
});

describe('contratos do /gerador: regras de escrita da casa', () => {
  for (const [modelo, lista] of Object.entries(CENARIOS)) {
    const reescrito = !AINDA_NAO_REESCRITOS.includes(modelo);
    for (const c of lista) {
      it(`${modelo} / ${c.nome}: sem "neste ato", "justo e contratado" nem travessão${reescrito ? ' nem "Não incluído"' : ''}`, () => {
        confereEstilo(gerar(c.tipo, c.campos, c.extra), `${modelo} / ${c.nome}`, reescrito);
      });
    }
    if (!reescrito) it.todo(`${modelo}: sem "Não incluído" (ligar quando a reescrita sair)`);
  }
  it('as verificações pegam o defeito (o teste não passa por ficar cego)', () => {
    const falso = (html: string) => ({ modelo: [{ key: 'a', titulo: 'Da coisa', itens: [{ key: 'a.1', html }] }], resolver: (h: string) => h, quebradas: [], blocos: ['<p>' + html + '</p>'] });
    for (const ruim of ['As partes, neste ato, fazem', 'Têm entre si justo e contratado', 'Prazo — 30 dias', 'Item não incluído no preço']) {
      expect(() => confereEstilo(falso(ruim), 'x', true), ruim).toThrow();
    }
    expect(() => confereEstilo(falso('Frase limpa, com vírgula.'), 'x', true)).not.toThrow();
    expect(() => confereEstrutura(falso('Ver {{i:nao.existe}} e undefined'), 'x')).toThrow();
  });
});

// ─── O pagamento (ctrPag*) ───────────────────────────────────────────────────
describe('contrato de sociedade (50/50 e cotas): versão "O básico" de 22/10/2026', () => {
  const DADOS = { 'ctr-pag-dados': 'Pix CNPJ 00.000.000/0001-00, Banco Teste, ag. 0001, c/c 12345-6', 'ctr-soc-dados': 'Pix 111.444.777-35, Banco Teste' };
  // Os casos que mais enchem o papel: interveniente, remuneração do local, cartão e dados de pagamento e da conta do sócio.
  const CHEIOS: Cenario[] = [
    { nome: '50/50 cheio (interveniente, remuneração do local, cartão, dados)', tipo: 'socio50', campos: { ...PF, ...SOC, ...DONO, 'ctr-soc-arrend': '5', ...DADOS }, extra: { pagModelo: 'cartao' } },
    { nome: 'cotas cheio (captação, empresa, cartão, dados)', tipo: 'cotas', campos: { ...PJ, ...COTAS, ...DADOS }, extra: { pagModelo: 'cartao' } },
  ];
  const TODOS = [...CENARIOS.socio50, ...CENARIOS.cotas, ...CHEIOS];

  it('cláusulas na ordem objeto, aporte, (captacao), local, operacao, resultado, prazo, dissolucao, gerais, com no máximo 8 itens cada', () => {
    for (const c of TODOS) {
      const r = gerar(c.tipo, c.campos, c.extra);
      confereEstrutura(r, c.nome);
      const ordem = ['objeto', 'aporte', ...(r.d.soc.captacao ? ['captacao'] : []), 'local', 'operacao', 'resultado', 'prazo', 'dissolucao', 'gerais'];
      expect(r.modelo.map((x: any) => x.key), c.nome).toEqual(ordem);
      for (const x of r.modelo) expect(x.itens.length, `${c.nome} / ${x.key}`).toBeLessThanOrEqual(8);
    }
    // Os dois lados da captação aparecem: o teste não passa por nunca ver a cláusula.
    expect(gerar('cotas', { ...PF, ...COTAS }).d.soc.captacao).toBe(true);
    expect(gerar('socio50', { ...PF, ...SOC }).d.soc.captacao).toBe(false);
  });

  // Teto de 4 folhas (regra 6, "sociedade 4"). O vm não tem layout e não mede folha: isto é uma aproximação pelo
  // tamanho do papel. Medido no Edge em 22/10/2026 com o epPaginar do index.html: 1.530 a 1.717 palavras deram
  // 4 folhas, a última entre 43% e 65% cheia; o texto anterior, com 3.190 palavras e 52 itens, dava 7.
  // Até 1.900 palavras e 34 itens cabe em 4. Passou daqui, meça no navegador e encurte primeiro o local.acesso.
  it('cabe em 4 folhas: no máximo 1.900 palavras no papel e 34 itens, em todos os casos', () => {
    for (const c of TODOS) {
      const r = gerar(c.tipo, c.campos, c.extra);
      const palavras = textoDe(r).split(/\s+/).filter(Boolean).length;
      const itens = r.modelo.reduce((a: number, x: any) => a + x.itens.length, 0);
      expect(palavras, `${c.nome}: palavras`).toBeLessThanOrEqual(1900);
      expect(itens, `${c.nome}: itens`).toBeLessThanOrEqual(34);
    }
  });

  it('toda chave citada pelo CAMPOS_AGENTE (socio50 e cotas) e pelo CTR_IA_CAMPOS_SOC existe em algum cenário da sociedade', () => {
    const existe: Record<string, Set<string>> = { socio50: new Set(), cotas: new Set() };
    for (const c of TODOS) for (const k of chavesDe(gerar(c.tipo, c.campos, c.extra))) existe[c.tipo].add(k);
    const faltam: string[] = [];
    for (const campo of CAMPOS_AGENTE) {
      for (const tipo of ['socio50', 'cotas'] as const) {
        for (const k of (campo.itens || {})[tipo] || []) if (!existe[tipo].has(k)) faltam.push(`${campo.id} -> ${tipo}:${k}`);
      }
    }
    const mapa = rodar('CTR_IA_CAMPOS_SOC') as Record<string, string>;
    expect(Object.keys(mapa).length).toBeGreaterThan(10);
    for (const k of Object.keys(mapa)) if (!existe.socio50.has(k) && !existe.cotas.has(k)) faltam.push(`CTR_IA_CAMPOS_SOC -> ${k}`);
    expect(faltam).toEqual([]);
  });
});

describe('contratos do /gerador: tabela de pagamento', () => {
  const L = (...a: any[]) => SB.ctrPagLinha(...a);
  it('aporte 72.500 com sinal 10.000 no cartão em 10x: restante 62.500, parcela 7.027,50, total 70.275,00', () => {
    const saldo = 72500 - 10000;
    const linhas = SB.ctrPagModelo('cartao10', saldo);
    const pc = SB.ctrPagCalc(linhas, saldo);
    expect(pc.linhas[0].valor).toBe('62.500,00');
    expect(pc.contas[0].parcelaCent).toBe(7027.5);
    expect(pc.contas[0].total).toBe(70275);
    expect(SB.ctrPagTrava('socio50', linhas, saldo)).toBe('');
  });
  it('papel antigo restaurado em 10x fecha em 11%; trocado para 18x, a linha volta à tabela de hoje e fecha em 18,98%', () => {
    const saldo = 62500;
    const salvo = { tocado: true, linhas: SB.ctrPagModelo('cartao10', saldo) };
    const rest = SB.ctrPagRestaurar(salvo);
    expect(rest.linhas[0].acr).toBe('11');
    expect(rest.linhas[0].acrAuto).toBe(10);
    expect(SB.ctrPagCalc(rest.linhas, saldo).contas[0].acr).toBe(11);
    rest.linhas[0].parc = '18';
    const c18 = SB.ctrPagCalc(rest.linhas, saldo).contas[0];
    expect(c18.acr).toBe(18.98);
    expect(c18.origem).toBe('tabela');
    expect(c18.parcelaCent).toBe(Math.round(saldo * 1.1898 / 18 * 100) / 100);
    // volta para 10x: a marca ainda vale, e a linha fecha de novo em 11%
    rest.linhas[0].parc = '10';
    expect(SB.ctrPagCalc(rest.linhas, saldo).contas[0].acr).toBe(11);
    // acréscimo digitado à mão não é lido como da tabela salva: a marca saiu e o valor vale em qualquer parcela
    delete rest.linhas[0].acrAuto; rest.linhas[0].acr = '7'; rest.linhas[0].parc = '18';
    expect(SB.ctrPagCalc(rest.linhas, saldo).contas[0].acr).toBe(7);
  });
  it('contrato salvo em 10x antes de 11/11/2026 (snapshot sem taxasCartao, acr vazio) reabre fechando em 11%', () => {
    const saldo = 62500;
    const salvo = { tocado: true, linhas: SB.ctrPagModelo('cartao10', saldo) };
    expect(salvo.linhas[0].acr).toBe('');
    const pc = SB.ctrPagCalc(SB.ctrPagRestaurar(salvo).linhas, saldo);
    expect(pc.contas[0].parcelaCent).toBe(6937.5);
    expect(pc.contas[0].total).toBe(69375);
    expect(pc.contas[0].acr).toBe(11);
  });
  it('snapshot antigo restaurado em 10x, trocado para 18x e salvo com taxasCartao {10: 12.44, 18: 31.832} reabre fechando em 31,832%', () => {
    const saldo = 62500;
    const rest = SB.ctrPagRestaurar({ tocado: true, linhas: SB.ctrPagModelo('cartao10', saldo) });
    expect(rest.linhas[0].acrAuto).toBe(10);
    rest.linhas[0].parc = '18';
    const salvo = JSON.parse(JSON.stringify(rest));
    const reaberto = SB.ctrPagRestaurar(salvo, { 10: 12.44, 18: 31.832 });
    const c = SB.ctrPagCalc(reaberto.linhas, saldo).contas[0];
    expect(c.acr).toBe(31.832);
    expect(reaberto.linhas[0].acrAuto).toBe(18);
    expect(c.parcelaCent).toBe(Math.round(saldo * 1.31832 / 18 * 100) / 100);
  });
  it('contrato novo em 18x lê a tabela da maquininha: cota de 50 mil fecha em R$ 3.305,00 (18,98%)', () => {
    const pc = SB.ctrPagCalc(SB.ctrPagModelo('cartao18', 50000), 50000);
    expect(pc.contas[0].acr).toBe(18.98);
    expect(pc.contas[0].parcelaCent).toBe(3305);
  });
  it('contrato salvo em 18x até 11/11/2026 (snapshot sem taxasCartao) reabre a 31,832%', () => {
    const saldo = 50000;
    const salvo = { tocado: true, linhas: SB.ctrPagModelo('cartao18', saldo) };
    const rest = SB.ctrPagRestaurar(salvo);
    expect(SB.ctrPagCalc(rest.linhas, saldo).contas[0].acr).toBe(31.832);
    expect(SB.ctrPagCalc(rest.linhas, saldo).contas[0].parcelaCent).toBe(3662);
  });
  it('proposta solar do /gerador: a nova lê a tabela da maquininha; a salva sem parcelasCartao segue com a de até 11/11/2026', () => {
    const nova = SB.calcTodasParcelas(28900);
    expect(Math.round(nova[12] * 100) / 100).toBe(Math.round(28900 * 1.1365 / 12 * 100) / 100);
    expect(Math.round(nova[21] * 100) / 100).toBe(Math.round(28900 * 1.2317 / 21 * 100) / 100);
    const base = { precoVista: 28900, precoOrcamento: 28900, pagOpts: { vista: true, cartao: { ativo: true, parcelas: [12, 21] }, fin: { ativo: false } } };
    const antigo = String(SB.montarBlocoPagamentoWpp(base));
    const fmt = (v: number) => (Math.round(v) >= 1000 ? Math.round(v).toLocaleString('pt-BR') : String(Math.round(v))) + ',00';
    expect(antigo).toContain('12x: R$ ' + fmt(28900 * 1.1269 / 12));
    expect(antigo).toContain('21x: R$ ' + fmt(28900 * 1.1928 / 21));
    const guardado = String(SB.montarBlocoPagamentoWpp({ ...base, parcelasCartao: { 12: 2000, 21: 1500 } }));
    expect(guardado).toContain('12x: R$ ' + fmt(2000));
  });
  it('edição de proposta solar: mesmo preço mantém as parcelas salvas; preço diferente ou sem parcelas salvas recalcula; proposta nova não muda', () => {
    // Proposta enviada antes de 11/11/2026, com a tabela de então (guardada em parcelasCartao).
    const antigas = SB.calcTodasParcelas(28900, { 12: 0.1269, 21: 0.1928 });
    const salvas = { precoOrcamento: 28900, parcelasCartao: antigas, parc10x: 111, parc12x: antigas[12], parc18x: 333 };
    const igual = SB.resolverParcelasCartao(28900, true, salvas);
    expect(igual.parcelasCartao[21]).toBe(antigas[21]);
    expect(igual.parc10x).toBe(111);
    expect(igual.parc18x).toBe(333);
    expect(igual.recalculadasNaEdicao).toBe(false);
    // tolerância de centavo
    expect(SB.resolverParcelasCartao(28900.01, true, salvas).recalculadasNaEdicao).toBe(false);
    // preço diferente: tabela atual, e o toast de "recalculadas"
    const outro = SB.resolverParcelasCartao(30000, true, salvas);
    expect(outro.recalculadasNaEdicao).toBe(true);
    expect(outro.parcelasCartao[21]).toBeCloseTo(30000 * 1.2317 / 21, 6);
    expect(outro.parc12x).toBeCloseTo(30000 * 1.1365 / 12, 6);
    // proposta salva sem parcelasCartao (ou sem o preço): recalcula
    const sem = SB.resolverParcelasCartao(28900, true, null);
    expect(sem.recalculadasNaEdicao).toBe(true);
    expect(sem.parcelasCartao[21]).toBeCloseTo(28900 * 1.2317 / 21, 6);
    // proposta nova (sem edição): tabela atual, sem aviso, mesmo que haja sobra de edição na memória
    const nova = SB.resolverParcelasCartao(28900, false, salvas);
    expect(nova.recalculadasNaEdicao).toBe(false);
    expect(nova.parcelasCartao[21]).toBeCloseTo(28900 * 1.2317 / 21, 6);
    expect(nova.parc12x).toBe(nova.parcelasCartao[12]);
  });
  it('contrato salvo com taxasCartao no snapshot reabre com a taxa guardada; com a tabela de hoje, a linha segue lendo a tabela', () => {
    const saldo = 62500;
    const salvo = { tocado: true, linhas: SB.ctrPagModelo('cartao10', saldo) };
    const pc = SB.ctrPagCalc(SB.ctrPagRestaurar(salvo, { 10: 12.44, 18: 31.832 }).linhas, saldo);
    expect(pc.contas[0].parcelaCent).toBe(7027.5);
    expect(pc.contas[0].total).toBe(70275);
    expect(pc.contas[0].acr).toBe(12.44);
    expect(SB.ctrPagRestaurar(salvo, { 10: 12.44, 18: 31.832 }).linhas[0].acr).toBe('');
    const guardado = SB.ctrPagCalc(SB.ctrPagRestaurar(salvo, { 10: 11, 18: 31.832 }).linhas, saldo);
    expect(guardado.contas[0].parcelaCent).toBe(6937.5);
  });
  it('soma diferente do saldo bloqueia, com a mensagem da tela', () => {
    const msg = SB.ctrPagTrava('socio50', [L('Cartão de crédito', 72000, 10, 0, 'Na assinatura')], 62500);
    expect(msg).toBe('As formas de pagamento somam R$ 72.000,00 e o valor devido é R$ 62.500,00. Ajuste o pagamento antes de gerar.');
  });
  it('texto de "Como o cliente vai pagar" que não montou a tabela trava; igual ao aplicado ou vazio passa (eletroposto)', () => {
    const linhas = SB.ctrPagModelo('vista', 62500);
    const msg = (texto: string, ok: string) => { for (const k of Object.keys(campos)) delete campos[k]; campos['ctr-pag-texto'] = texto; SB.__ok = ok; return rodar('ctrPag.txtok = __ok; ctrPagNaoMontado()'); };
    expect(SB.ctrPagTrava('socio50', linhas, 62500, false, msg('10 mil de Pix e 10x no cartão', ''))).toMatch(/a tabela não foi montada a partir desse texto\. Clique em Montar, confira e gere \(ou apague o texto se a tabela já está certa\)\./);
    expect(SB.ctrPagTrava('socio50', linhas, 62500, false, msg('10 mil de Pix e 10x no cartão', '10 mil de Pix e 10x no cartão'))).toBe('');
    expect(SB.ctrPagTrava('socio50', linhas, 62500, false, msg('', ''))).toBe('');
    expect(SB.ctrPagTrava('socio50', linhas, 62500, false, msg('10 mil de Pix e 10x no cartão', 'outro texto'))).toMatch(/não foi montada/);
    // O modelo rápido guarda o texto aplicado vazio: texto escrito depois dele trava.
    rodar("ctrPag.txtok = 'x'; ctrPagAplicar('vista');");
    expect(rodar('ctrPag.txtok')).toBe('');
    rodar("ctrPag.txtok = 'x'; ctrPagReset();");
    expect(rodar('ctrPag.txtok')).toBe('');
  });
  it('diferença de 0,03 não bloqueia', () => {
    expect(SB.ctrPagTrava('socio50', [L('Pix', 62499.97, 1, 0, 'Na assinatura')], 62500)).toBe('');
  });
  it('diferença de 0,06 bloqueia', () => {
    expect(SB.ctrPagTrava('socio50', [L('Pix', 62499.94, 1, 0, 'Na assinatura')], 62500)).not.toBe('');
  });
  it('sem nenhuma forma de pagamento e com saldo, bloqueia; arrendamento nunca trava', () => {
    expect(SB.ctrPagTrava('completo', [], 1000)).not.toBe('');
    expect(SB.ctrPagTrava('arrend', [], 1000)).toBe('');
  });
  it('cartão sem vencimento assume "Na assinatura do contrato" e não trava; o papel e a tela leem o mesmo valor', () => {
    const linhas = [L('Pix', 10000, 1, 0, 'Na entrega da NF'), L('Cartão de crédito', 52500, 10, 0, '', '', {})];
    expect(SB.ctrPagTrava('socio50', linhas, 62500)).toBe('');
    expect(SB.ctrPagQuando(linhas[1])).toBe('Na assinatura do contrato');
    expect(SB.ctrPagQuando(linhas[0])).toBe('Na entrega da NF');
    expect(SB.ctrPagConta(linhas[1]).incompleto).toBe('');
    // Cartão de débito não é crédito: não ganha o padrão.
    expect(SB.ctrPagQuando(L('Cartão de débito', 100, 1, 0, ''))).toBe('');
  });
  it.each(['Pix', 'Boleto bancário', 'Transferência', 'Financiamento bancário', 'Dinheiro', 'Permuta'])('%s sem vencimento fica incompleta e trava', forma => {
    const linhas = [L(forma, 62500, 1, 0, '')];
    const c = SB.ctrPagConta(linhas[0]);
    expect(c.incompleto).toMatch(/falta quando esta forma é paga/);
    expect(SB.ctrPagTrava('socio50', linhas, 62500)).toMatch(/falta quando esta forma é paga.*Ajuste o pagamento antes de gerar/);
    expect(SB.ctrPagTrava('socio50', [L(forma, 62500, 1, 0, 'Na assinatura')], 62500)).toBe('');
  });
  it('vencimento só com espaços conta como vazio', () => {
    expect(SB.ctrPagTrava('socio50', [L('Pix', 62500, 1, 0, '   ')], 62500)).toMatch(/falta quando/);
  });
});
