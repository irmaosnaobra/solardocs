/**
 * Versões salvas no card (entrega 1 de 2), no sandbox da bancada: lê o dashboard/public/gerador/index.html de verdade, roda os
 * <script> inline num `vm` com DOM de mentira e prova a parte do navegador: o snapshot leva o card ligado, abrir a versão de outro
 * card troca o card ligado, "Limpar cliente" desliga, o preenchimento a partir do card liga sozinho, e falha ao enviar nunca lança.
 * Sem rede, sem navegador. Só dados fictícios.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const HTML = join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador', 'index.html');

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
  const html = readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
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
    getComputedStyle: () => ({}), Blob, Image: function () {}, FormData: function () {}, URL, URLSearchParams, Intl, Date, Math, JSON, Promise,
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
const A = { linha: 'eletroposto', codigo: '101', nome: 'Fulano de Teste' };
const B = { linha: 'eletroposto', codigo: '202', nome: 'Beltrano de Teste' };

beforeAll(() => { SB = criarSandbox(); });

describe('versões no card: a tela', () => {
  it('o script carrega sem erro e expõe as peças novas', () => {
    expect(SB.__errosDeCarga).toEqual([]);
    for (const f of ['ctrCardSet', 'ctrCardDeOrigem', 'ctrVersEnviar', 'ctrVersAbrir', 'ctrVersImprimir', 'ctrVersExcluir', 'epAbrirEntrada', 'fsReabrirEntrada']) {
      expect(rodar(`typeof ${f}`)).toBe('function');
    }
  });

  it('o snapshot inclui o card ligado, e sem card ligado vem null', () => {
    rodar(`ctrCardSet('ele', null)`);
    expect(rodar('orcSnapTake().ctrCard')).toBeNull();
    rodar(`ctrCardSet('ele', ${JSON.stringify(A)})`);
    expect(rodar('orcSnapTake().ctrCard')).toEqual(A);
    // o do Fechamento solar é outro estado: não vaza para o do eletroposto
    expect(rodar('fsCardLigado')).toBeNull();
  });

  it('abrir uma versão de outro card troca o card ligado (com o aviso de papel de outro cliente)', () => {
    rodar(`ctrCardSet('ele', ${JSON.stringify(A)}); globalThis.__avisos = []; confirm = (m) => { __avisos.push(String(m)); return true; };`);
    rodar(`epAbrirEntrada({ id: 'x', tipo: 'Contrato', cliente: 'Beltrano de Teste', snap: { sim: { 'el-cliente': 'Beltrano de Teste' } } }, ${JSON.stringify(B)})`);
    expect(rodar('ctrCardLigado')).toEqual(B);
    expect(rodar('__avisos.length')).toBe(1);
    expect(rodar('__avisos[0]')).toMatch(/troca o cliente ligado \(Fulano de Teste\)/);
  });

  it('recusar o aviso mantém o card e não abre nada', () => {
    rodar(`ctrCardSet('ele', ${JSON.stringify(A)}); confirm = () => false;`);
    rodar(`epAbrirEntrada({ id: 'x', tipo: 'Contrato', cliente: '', snap: { sim: {} } }, ${JSON.stringify(B)})`);
    expect(rodar('ctrCardLigado')).toEqual(A);
    rodar('confirm = () => true;');
  });

  it('abrir o papel do histórico com card no snapshot liga esse card', () => {
    rodar(`ctrCardSet('ele', null)`);
    rodar(`orcSnapApply({ ctrCard: ${JSON.stringify(B)}, sim: {} }, 'Contrato')`);
    expect(rodar('ctrCardLigado')).toEqual(B);
  });

  it('"Limpar cliente" desliga o card', () => {
    rodar(`ctrCardSet('ele', ${JSON.stringify(A)}); ctrEstadoZerar();`);
    expect(rodar('ctrCardLigado')).toBeNull();
  });

  it('liga sozinho pela origem linha:id e ignora origem torta', () => {
    rodar(`ctrCardSet('ele', null); ctrCardDeOrigem('ele', 'eletroposto:77', 'Ciclano')`);
    expect(rodar('ctrCardLigado')).toEqual({ linha: 'eletroposto', codigo: '77', nome: 'Ciclano' });
    rodar(`ctrCardDeOrigem('ele', 'solar:9', 'X'); ctrCardDeOrigem('ele', '../../etc', 'X'); ctrCardDeOrigem('ele', '', 'X')`);
    expect(rodar('ctrCardLigado.codigo')).toBe('77');
    rodar(`ctrCardDeOrigem('sol', 'vendasolar:5', 'Dona Sol')`);
    expect(rodar('fsCardLigado')).toEqual({ linha: 'vendasolar', codigo: '5', nome: 'Dona Sol' });
    expect(rodar('ctrCardLigado.codigo')).toBe('77');
    expect(rodar('orcSnapTake().ctrCard.codigo')).toBe('77');
    expect(rodar('fsSnap(false).fsCard.codigo')).toBe('5');
    rodar(`ctrCardSet('ele', null); ctrCardSet('sol', null)`);
  });

  it('envio: sem card não chama o servidor; com card, falha de rede vira aviso e nunca lança', async () => {
    rodar(`globalThis.__chamadas = []; globalThis.__toasts = []; vdcFetch = async (rota, metodo, corpo) => { __chamadas.push([rota, metodo]); return { status: 0, json: null }; }; showToast = (m) => { __toasts.push(String(m)); };`);
    await rodar(`ctrVersEnviar('ele', { tipo: 'Contrato', html: '<p>x</p>', snap: {}, card: null })`);
    expect(rodar('__chamadas.length')).toBe(0);
    await rodar(`ctrVersEnviar('ele', { tipo: 'Contrato', html: '<p>x</p>', snap: {}, card: ${JSON.stringify(A)} })`);
    expect(rodar('__chamadas[0]')).toEqual(['/gerador/contratos/eletroposto/101/versoes', 'POST']);
    expect(rodar('__toasts.join(" ")')).toMatch(/não ficou salvo no card.*histórico deste aparelho/);
    // resposta de erro do servidor (413) também só avisa
    rodar(`vdcFetch = async () => ({ status: 413, json: { ok: false, error: 'Este papel passou do limite.' } }); __toasts.length = 0;`);
    await rodar(`ctrVersEnviar('ele', { tipo: 'Contrato', html: '<p>x</p>', snap: {}, card: ${JSON.stringify(A)} })`);
    expect(rodar('__toasts[0]')).toMatch(/passou do limite/);
  });

  it('a linha de aviso aparece sem card ligado, e a ligação aparece com nome e código', () => {
    const el = (id: string) => `document.getElementById('${id}')`;
    rodar(`ctrCardSet('ele', null)`);
    // o DOM de mentira não guarda innerHTML de verdade; o que se prova é que montar a tela não lança
    expect(() => rodar(`ctrCardUi('ele')`)).not.toThrow();
    rodar(`ctrCardSet('ele', ${JSON.stringify(A)})`);
    expect(() => rodar(`ctrCardUi('ele')`)).not.toThrow();
    void el;
  });
  it('o Imprimir da versão salva usa iframe com sandbox SEM scripts, e não joga o HTML na página', () => {
    const fonte = String(rodar('ctrVersImprimir.toString()'));
    expect(fonte).toContain('sandbox="allow-same-origin allow-modals"');
    expect(fonte).not.toMatch(/allow-scripts/);
    expect(fonte).not.toMatch(/epPreview|innerHTML\s*=\s*v\.html/);
    expect(fonte).toContain('fr.srcdoc = doc');
  });
  it('snapshot vindo do servidor: <img onerror> num pedido da IA e numa cláusula extra não vira tag no papel', async () => {
    const sujo = {
      ctrNum: '1', ctrCard: A, sim: {},
      ctrEsc: { extras: [{ nome: '<img src=x onerror=alert(3)> Item <b>ok</b>', inc: true }] },
      ctrIa: { pedidos: [{ id: 1, tipo: 'completo', texto: '<img src=x onerror=alert(1)>', avisos: ['<svg onload=1>'], recusa: '',
        ops: [{ tipo: 'inserir_item', depois_de: 'x', texto: '<img src=x onerror=alert(2)>negrito <b>x</b><br>fim', itens: ['<script>1</script>'] }] }] },
    };
    // a função de limpeza, direto: só <b>, <i>, <br> e a lacuna ficam
    const limpo = JSON.stringify(rodar(`ctrSnapLimpo(${JSON.stringify(sujo)})`));
    expect(limpo).not.toMatch(/<img|<script|<svg/i);
    expect(limpo).toContain('<b>ok</b>');
    expect(limpo).toContain('<b>x</b><br>fim');
    expect(rodar(`ctrTextoSeguro('<i>a</i> <span class="ep-rec-vazio"></span> <a href=x>l</a>')`)).toBe('<i>a</i> <span class="ep-rec-vazio"></span> &lt;a href=x&gt;l&lt;/a&gt;');
    // e pelo caminho real do "Abrir para editar": o que fica no estado do contrato não tem tag perigosa
    rodar(`ctrCardSet('ele', ${JSON.stringify(A)}); globalThis.__toasts = []; showToast = (m) => { __toasts.push(String(m)); };
      vdcFetch = async () => ({ status: 200, json: { ok: true, versao: { id: 'v1', tipo: 'Contrato', snap: ${JSON.stringify(sujo)}, html: '<p>x</p>' } } });`);
    await rodar(`ctrVersAbrir('ele', 'v1')`);
    expect(rodar('JSON.stringify(ctrEsc.extras)')).not.toMatch(/<img/i);
    expect(rodar('JSON.stringify(ctrIa.pedidos)')).not.toMatch(/<img|<script|<svg/i);
    expect(rodar('JSON.stringify(ctrIa.pedidos)')).toContain('<b>x</b><br>fim');
    rodar(`ctrCardSet('ele', null)`);
  });

  it('o limite do corpo conta BYTES, não caracteres: 2,2 milhões de "é" (4,4 MB em UTF-8) é recusado', async () => {
    rodar(`globalThis.__chamadas = []; globalThis.__toasts = []; vdcFetch = async (rota, metodo) => { __chamadas.push([rota, metodo]); return { status: 201, json: { ok: true, versao: {} } }; }; showToast = (m) => { __toasts.push(String(m)); };`);
    await rodar(`ctrVersEnviar('ele', { tipo: 'Contrato', html: 'é'.repeat(2200000), snap: {}, card: ${JSON.stringify(A)} })`);
    expect(rodar('__chamadas.length')).toBe(0);
    expect(rodar('__toasts.join(" ")')).toMatch(/grande demais/);
  });
  it('a limpeza do snapshot só escapa as chaves que viram HTML cru: "consumo > 100" e "A & B" nos campos voltam iguais; <img onerror> nas chaves cruas segue neutralizado', () => {
    const snap = {
      ctrModelos: { 'ctr-arr-dados': 'consumo > 100 kWh e A & B' }, campos: { 'fs-obs': 'consumo > 100 e <b>x</b>' }, ctrExtras: 'item 1 > item 0', sim: { 'el-cliente': 'Ana & Cia <Ltda>' },
      ctrEsc: { extras: [{ nome: '<img src=x onerror=alert(1)> > 5', inc: true }] },
      ctrIa: { pedidos: [{ id: 1, texto: '<img src=x onerror=alert(2)>', ops: [{ tipo: 'inserir_item', texto: '<img src=x onerror=alert(3)>ok <b>x</b>' }] }] },
      itens: [{ nome: '<svg onload=alert(4)>' }],
    };
    const l = rodar(`ctrSnapLimpo(${JSON.stringify(snap)})`);
    expect(l.ctrModelos['ctr-arr-dados']).toBe('consumo > 100 kWh e A & B');
    expect(l.campos['fs-obs']).toBe('consumo > 100 e <b>x</b>');
    expect(l.ctrExtras).toBe('item 1 > item 0');
    expect(l.sim['el-cliente']).toBe('Ana & Cia <Ltda>');
    expect(JSON.stringify(l.ctrEsc)).not.toMatch(/<img/i);
    expect(JSON.stringify(l.ctrEsc)).toContain('&gt; 5');
    expect(JSON.stringify(l.ctrIa)).not.toMatch(/<img/i);
    expect(JSON.stringify(l.ctrIa)).toContain('ok <b>x</b>');
    expect(JSON.stringify(l.itens)).not.toMatch(/<svg/i);
  });
  it('corpo acima de 4,3 MB nem é enviado: avisa que segue no histórico do aparelho', async () => {
    rodar(`globalThis.__chamadas = []; globalThis.__toasts = []; vdcFetch = async (rota, metodo) => { __chamadas.push([rota, metodo]); return { status: 201, json: { ok: true, versao: {} } }; }; showToast = (m) => { __toasts.push(String(m)); };`);
    await rodar(`ctrVersEnviar('ele', { tipo: 'Contrato', html: 'x'.repeat(4400000), snap: {}, card: ${JSON.stringify(A)} })`);
    expect(rodar('__chamadas.length')).toBe(0);
    expect(rodar('__toasts.join(" ")')).toMatch(/grande demais para salvar no card; ele segue no histórico deste aparelho/);
  });
});
