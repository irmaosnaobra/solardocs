/**
 * "Limpar os dados desta pessoa" / apagar um campo no "Editar dados" (card de venda do /gerador): os campos do formulário do contrato
 * que o mesmo mapa de `aplicarCadastroEletroposto` / `aplicarCadastroSolar` preenche a partir daquela pessoa também esvaziam, e só esses.
 * O "Confirmar" da leitura por IA (sem `opts`) continua ignorando valor vazio.
 *
 * Lê o dashboard/public/gerador/index.html de verdade, roda os <script> num sandbox `vm` com um DOM de mentira que GUARDA o valor de cada
 * campo (diferente da bancada contratosGerador.test.ts, que só lê). Sem rede, sem navegador. Só dados fictícios.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const HTML = join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador', 'index.html');

type Ctx = Record<string, any>;
const elementos = new Map<string, any>();

const vazio: any = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === Symbol.iterator ? undefined : vazio),
  apply: () => vazio,
  set: () => true,
});
function criar(id: string): any {
  const alvo: Record<string, any> = {
    id, value: '', defaultValue: '', dataset: {}, options: [], tagName: 'INPUT', style: {}, children: [], textContent: '', innerHTML: '', hidden: false, checked: false, open: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null, focus() {},
    closest: () => null, querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [],
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as string] : vazio), set: (t, k, v) => { t[k as string] = v; return true; } });
}
const el = (id: string): any => { let e = elementos.get(id); if (!e) { e = criar(id); elementos.set(id, e); } return e; };
const val = (id: string): string => String(el(id).value);

function criarSandbox(): Ctx {
  const html = readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const doc = new Proxy({}, {
    get(_t, k) {
      if (k === 'getElementById') return (id: string) => el(id);
      if (k === 'querySelectorAll' || k === 'getElementsByTagName' || k === 'getElementsByClassName') return () => [];
      if (k === 'querySelector' || k === 'createElement' || k === 'createElementNS') return () => criar('x');
      if (k === 'readyState') return 'complete';
      if (k === 'cookie') return '';
      if (k === 'addEventListener' || k === 'removeEventListener') return () => {};
      return vazio;
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
    getComputedStyle: () => ({}), Image: function () {}, FormData: function () {}, Event: function () {}, URL, URLSearchParams, Intl, Date, Math, JSON, Promise,
    MutationObserver: function (this: any) { this.observe = () => {}; }, IntersectionObserver: function (this: any) { this.observe = () => {}; }, ResizeObserver: function (this: any) { this.observe = () => {}; },
    supabase: { createClient: () => new Proxy({}, { get: () => () => new Proxy(function () {}, { get: () => () => ({ then: () => {} }) }) }) },
    alert() {}, confirm: () => true, prompt: () => '', innerWidth: 1200, innerHeight: 900, performance: { now: () => 0 },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.top = ctx; ctx.parent = ctx;
  vm.createContext(ctx);
  scripts.forEach((s, i) => { try { vm.runInContext(s, ctx, { filename: 'gerador-inline-' + i }); } catch { /* o resto do script não carrega: o teste abaixo acusa se faltar a função */ } });
  // Navegação e avisos não interessam aqui: só o que a aplicação escreve nos campos.
  const mudos: Record<string, string> = {
    navEletroposto: 'function () {}', eletroSubaba: 'function () {}', crmFecharDetalhe: 'function () {}', ctrEspSync: 'function () {}', ctrResumo: 'function () {}',
    ctrAgZerar: 'function () {}', showToast: 'function () {}', vdcAvisar: 'function () {}', ctrArrCliAtivo: 'function () { return true; }',
    navFechamentoSolar: 'function () {}', fsTipoMudou: 'function () {}', fsProcModelo: 'function () {}', fsAba: 'function () {}', fsRevalida: 'function () {}',
    fsTitularAlerta: 'function () {}', fsFinAlerta: 'function () {}', fsLimparCliente: 'function () { __fsLimpou = (typeof __fsLimpou === "undefined" ? 0 : __fsLimpou) + 1; }',
  };
  for (const [nome, corpo] of Object.entries(mudos)) { try { vm.runInContext(`${nome} = ${corpo};`, ctx); } catch { /* const: fica o original */ } }
  return ctx;
}

let SB: Ctx;
const rodar = (codigo: string): any => vm.runInContext(codigo, SB);
const campo = (valor: string) => ({ valor, por: 'x', em: '2026-10-21T10:00:00.000Z', fonte: 'manual' });
/** Monta o cadastro como a tela o recebe. `vazios` saem do objeto (como o servidor faz ao apagar o campo). */
const cadastro = (campos: Record<string, string>, tipo = 'PF') => ({ tipo, faltando: [], campos: Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== '').map(([k, v]) => [k, campo(v)])) });
/** `origem`: 'linha:id' do card de onde vem o cadastro (o vdcPreencher da tela sempre passa). */
function aplicarEp(cad: unknown, limpar?: string[], tipoAntes = 'PF', origem = ''): void {
  SB.__cad = cad; SB.__lim = limpar ?? null; SB.__tipoAntes = tipoAntes; SB.__origem = origem;
  rodar('aplicarCadastroEletroposto(__cad, { origem: __origem, ...(__lim ? { limpar: new Set(__lim), tipoAntes: __tipoAntes } : {}) })');
}
function aplicarSol(cad: unknown, limpar?: string[], tipoAntes = 'PF', origem = ''): void {
  SB.__cad = cad; SB.__lim = limpar ?? null; SB.__tipoAntes = tipoAntes; SB.__origem = origem;
  rodar('aplicarCadastroSolar(__cad, null, { origem: __origem, ...(__lim ? { limpar: new Set(__lim), tipoAntes: __tipoAntes } : {}) })');
}

// Os dados do comprador que estavam (por engano) com a pessoa do cedente, e o cedente de verdade.
const COMPRADOR = { nome: 'Dona Marta Souza', cpf_cnpj: '529.982.247-25', endereco: 'Rua das Flores 10', bairro: 'Centro', cidade: 'Araguari', uf: 'MG', cep: '38440-000', telefone: '34988880001', email: 'marta@exemplo.test' };
const CEDENTE = { ced_nome: 'Joao Cedente', ced_cpf_cnpj: '111.444.777-35', ced_endereco: 'Av Brasil 20', ced_cidade: 'Uberaba', ced_uf: 'MG' };

describe('limpar a pessoa zera no formulário só o que veio dela', () => {
  beforeAll(() => { SB = criarSandbox(); });
  beforeEach(() => { elementos.clear(); rodar("vdcOrigemEp = ''; vdcOrigemFs = '';"); });

  it('as funções existem no sandbox', () => {
    expect(rodar('typeof aplicarCadastroEletroposto')).toBe('function');
    expect(rodar('typeof aplicarCadastroSolar')).toBe('function');
  });

  describe('eletroposto', () => {
    const preenche = () => aplicarEp(cadastro({ ...COMPRADOR, ...CEDENTE }));
    const campos = {
      comprador: ['el-cliente', 'eq-cli-nome', 'rec-cli-nome', 'proc-outorgante', 'bnk-nome', 'orc-cli-doc', 'eq-cli-doc', 'proc-outorgante-doc', 'orc-cli-end', 'orc-cli-cep',
        'orc-cli-tel', 'orc-cli-email', 'el-cidade', 'bnk-uf'],
      cedente: ['ctr-ced-nome', 'ctr-ced-doc', 'ctr-ced-end'],
    };

    it('o preenchimento normal escreve comprador e cedente (ponto de partida)', () => {
      preenche();
      campos.comprador.forEach((id) => expect(val(id), id).not.toBe(''));
      campos.cedente.forEach((id) => expect(val(id), id).not.toBe(''));
    });
    it('limpar o comprador zera os campos do comprador e NÃO toca os do cedente nem os que não vêm do cadastro', () => {
      preenche();
      el('ctr-foro').value = 'Uberlandia';        // escolha digitada: não vem do cadastro
      el('orc-cli-ie').value = 'digitada';        // PF: a IE não é escrita pelo cadastro
      const apagados = Object.keys(COMPRADOR).concat('tipo');
      aplicarEp(cadastro({ ...CEDENTE }), apagados);   // o servidor devolve o cadastro sem as chaves do comprador (sem nome também)
      campos.comprador.forEach((id) => expect(val(id), id).toBe(''));
      campos.cedente.forEach((id) => expect(val(id), id).not.toBe(''));
      expect(val('ctr-ced-nome')).toBe('Joao Cedente');
      expect(val('ctr-foro')).toBe('Uberlandia');
      expect(val('orc-cli-ie')).toBe('digitada');
    });
    it('apagar um campo só (telefone) esvazia só os campos que vêm dele', () => {
      preenche();
      const { telefone: _t, ...resto } = COMPRADOR;
      aplicarEp(cadastro({ ...resto, ...CEDENTE }), ['telefone']);
      expect(val('orc-cli-tel')).toBe('');
      expect(val('eq-cli-tel')).toBe('');
      expect(val('orc-cli-doc')).not.toBe('');
      expect(val('el-cliente')).toBe('Dona Marta Souza');
      expect(val('ctr-ced-nome')).toBe('Joao Cedente');
    });
    it('limpar o cedente zera o cedente e não toca o comprador', () => {
      preenche();
      aplicarEp(cadastro({ ...COMPRADOR }), Object.keys(CEDENTE));
      campos.cedente.forEach((id) => expect(val(id), id).toBe(''));
      campos.comprador.forEach((id) => expect(val(id), id).not.toBe(''));
    });
    it('sem opts (o "Confirmar" da leitura por IA) vazio continua sendo ignorado', () => {
      preenche();
      const { telefone: _t, ...resto } = COMPRADOR;   // mesmo cliente, só sem o telefone no cadastro
      aplicarEp(cadastro({ ...resto, ...CEDENTE }));
      expect(val('orc-cli-tel')).toBe('34988880001');
      expect(val('el-cliente')).toBe('Dona Marta Souza');
      expect(val('ctr-ced-nome')).toBe('Joao Cedente');
    });
    it('empresa: ao limpar o comprador PJ saem também a IE e o representante', () => {
      aplicarEp(cadastro({ ...COMPRADOR, cpf_cnpj: '11.222.333/0001-81', rg_ie: 'isento', rep_nome: 'Maria Rep', rep_cpf: '529.982.247-25' }, 'PJ'));
      expect(val('orc-cli-ie')).toBe('isento');
      expect(val('ctr-rep')).toBe('Maria Rep');
      aplicarEp(cadastro({}), ['nome', 'cpf_cnpj', 'rg_ie', 'rep_nome', 'rep_cpf', 'tipo'], 'PJ');
      ['orc-cli-ie', 'eq-cli-ie', 'ctr-rep', 'proc-rep', 'ctr-rep-doc', 'proc-rep-doc', 'orc-cli-doc'].forEach((id) => expect(val(id), id).toBe(''));
    });
  });

  describe('dois cards: o que é de um card nunca aparece no outro', () => {
    const TERCEIROS_A = { ...CEDENTE, aval_nome: 'Ana Avalista', aval_cpf_cnpj: '529.982.247-25', imovel_matricula: 'MAT-77' };
    const B = { nome: 'Beto Comprador', cpf_cnpj: '111.444.777-35', cidade: 'Uberlandia', uf: 'MG' };
    const dosTerceiros = ['ctr-ced-nome', 'ctr-ced-doc', 'ctr-ced-end', 'ctr-aval-nome', 'ctr-aval-doc', 'ctr-ta-matricula'];
    it('eletroposto: limpar o comprador do card A e confirmar o card B (sem cedente) não deixa cedente, avalista nem imóvel de A', () => {
      aplicarEp(cadastro({ ...COMPRADOR, ...TERCEIROS_A }), undefined, 'PF', 'eletroposto:101');
      dosTerceiros.forEach((id) => expect(val(id), id).not.toBe(''));
      aplicarEp(cadastro({ ...TERCEIROS_A }), Object.keys(COMPRADOR).concat('tipo'), 'PF', 'eletroposto:101');
      expect(val('el-cliente')).toBe('');
      expect(val('orc-cli-doc')).toBe('');
      dosTerceiros.forEach((id) => expect(val(id), id).not.toBe(''));   // são do card A e seguem nele
      aplicarEp(cadastro({ ...B }), undefined, 'PF', 'eletroposto:102');   // "Confirmar" no card B
      expect(val('el-cliente')).toBe('Beto Comprador');
      dosTerceiros.forEach((id) => expect(val(id), id).toBe(''));
    });
    it('eletroposto: limpar uma pessoa do MESMO card não esvazia os terceiros (cliente é o mesmo)', () => {
      aplicarEp(cadastro({ ...COMPRADOR, ...TERCEIROS_A }), undefined, 'PF', 'eletroposto:101');
      aplicarEp(cadastro({ ...COMPRADOR, ...CEDENTE }), ['aval_nome', 'aval_cpf_cnpj', 'imovel_matricula'], 'PF', 'eletroposto:101');
      expect(val('ctr-aval-nome')).toBe('');
      expect(val('ctr-ta-matricula')).toBe('');
      expect(val('ctr-ced-nome')).toBe('Joao Cedente');
      expect(val('el-cliente')).toBe('Dona Marta Souza');
    });
    it('solar: o Fechamento do card A não fica no B (o cliente é tratado como outro mesmo com a identidade vazia)', () => {
      SB.__fsLimpou = 0;
      aplicarSol(cadastro({ ...COMPRADOR }), undefined, 'PF', 'vendasolar:201');
      expect(val('fs-nome')).toBe('Dona Marta Souza');
      aplicarSol(cadastro({}), Object.keys(COMPRADOR).concat('tipo'), 'PF', 'vendasolar:201');   // limpa o contratante do A
      expect(val('fs-nome')).toBe('');
      expect(SB.__fsLimpou).toBe(0);                                                            // mesmo card: não zera o resto
      aplicarSol(cadastro({ nome: 'Beto Comprador', cpf_cnpj: '111.444.777-35' }), undefined, 'PF', 'vendasolar:202');
      expect(SB.__fsLimpou).toBe(1);                                                            // outro card: fsLimparCliente roda
      expect(val('fs-nome')).toBe('Beto Comprador');
    });
  });

  describe('venda solar', () => {
    const TUC = { tuc_nome: 'Pedro Titular', tuc_cpf_cnpj: '111.444.777-35' };
    const preenche = () => aplicarSol(cadastro({ ...COMPRADOR, rg_ie: 'MG-1234', estado_civil: 'casada', unidade_consumidora: '12345678', ...TUC, homologacao_mesmo: 'outra_pessoa' }));
    it('limpar o contratante zera a identidade dele no Fechamento e não toca o titular da homologação', () => {
      preenche();
      ['fs-nome', 'fs-doc', 'fs-cep', 'fs-end', 'fs-cidade', 'fs-rg', 'fs-estado-civil', 'fs-p-uc', 'fs-p-tuc-nome'].forEach((id) => expect(val(id), id).not.toBe(''));
      el('fs-c-valor').value = '30000';       // valor do contrato: não vem do cadastro
      const apagados = [...Object.keys(COMPRADOR), 'rg_ie', 'estado_civil', 'unidade_consumidora', 'tipo'];
      aplicarSol(cadastro({ ...TUC, homologacao_mesmo: 'outra_pessoa' }), apagados);
      ['fs-nome', 'fs-doc', 'fs-cep', 'fs-end', 'fs-bairro', 'fs-cidade', 'fs-uf', 'fs-tel', 'fs-rg', 'fs-estado-civil', 'fs-p-uc'].forEach((id) => expect(val(id), id).toBe(''));
      expect(val('fs-p-tuc-nome')).toBe('Pedro Titular');
      expect(val('fs-c-valor')).toBe('30000');
    });
    it('sem opts o vazio continua ignorado', () => {
      preenche();
      const { telefone: _t, ...resto } = COMPRADOR;
      aplicarSol(cadastro({ ...resto, ...TUC, homologacao_mesmo: 'outra_pessoa' }));
      expect(val('fs-tel')).not.toBe('');
      expect(val('fs-nome')).toBe('Dona Marta Souza');
    });
  });
});
