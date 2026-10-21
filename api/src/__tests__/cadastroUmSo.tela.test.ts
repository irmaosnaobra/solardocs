/**
 * Um cadastro, vários papéis (entrega 2 de 2): ligar um card vendido aplica o cadastro sozinho; no Gerar, só a identidade editada volta ao
 * cadastro do MESMO card (nunca número do negócio); card A nunca leva dado ao B; postMessage de outro card é ignorado; reabrir uma versão com o
 * cadastro diferente só mostra a faixa. Lê o dashboard/public/gerador/index.html de verdade num `vm` com DOM que GUARDA o valor dos campos.
 * O servidor é de mentira (vdcFetch). Sem rede, sem navegador. Só dados fictícios.
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
    getComputedStyle: () => ({}), Blob, Image: function () {}, FormData: function () {}, Event: function () {}, URL, URLSearchParams, Intl, Date, Math, JSON, Promise,
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
    orcInit: 'function () {}', recTipoMudou: 'function () {}', ctrEscRender: 'function () {}', orcKitMarcado: 'function () { return false; }', fsTitularAlerta: 'function () {}', fsFinAlerta: 'function () {}', fsLimparCliente: 'function () { __fsLimpou = (typeof __fsLimpou === "undefined" ? 0 : __fsLimpou) + 1; }',
  };
  vm.runInContext('__ctrEspSyncReal = ctrEspSync;', ctx);   // o teste do papel gerado liga o espelho de verdade
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

const EM = '2026-10-21T10:00:00.000Z';   // o `em` dos campos do cadastro de mentira: a leitura mais nova que a tela viu
const A = { linha: 'eletroposto', codigo: '101', nome: 'Dona Marta Souza' };
const B = { linha: 'eletroposto', codigo: '202', nome: 'Seu Beto Lima' };
const MARTA = { nome: 'Dona Marta Souza', cpf_cnpj: '529.982.247-25', endereco: 'Rua das Flores 10', bairro: 'Centro', cidade: 'Araguari', uf: 'MG', cep: '38440-000', telefone: '34988880001', email: 'marta@exemplo.test' };
const BETO = { nome: 'Seu Beto Lima', cpf_cnpj: '111.444.777-35', endereco: 'Av Brasil 20', bairro: 'Industrial', cidade: 'Uberaba', uf: 'MG', cep: '38000-000', telefone: '34977770002', email: 'beto@exemplo.test' };

// Servidor de mentira: guarda o cadastro de cada card, registra as chamadas e aplica o PUT como o servidor (valor novo por cima).
interface Chamada { rota: string; metodo: string; corpo?: any }
let cads: Record<string, any>; let chamadas: Chamada[]; let toasts: string[]; let postadas: any[];
function instalarServidor(): void {
  SB.__srv = async (rota: string, metodo: string, corpo?: any) => {
    chamadas.push({ rota, metodo, corpo });
    const m = /\/gerador\/clientes\/(eletroposto|vendasolar)\/(\d+)\/cadastro$/.exec(rota);
    if (m) {
      const k = m[1] + ':' + m[2];
      if (!cads[k]) return { status: 404, json: { ok: false } };
      if (metodo === 'PUT') Object.entries(corpo.campos as Record<string, string>).forEach(([c, v]) => { cads[k].campos[c] = campo(v); });
      return { status: 200, json: { ok: true, cadastro: JSON.parse(JSON.stringify(cads[k])) } };
    }
    if (/vinculos$/.test(rota)) return { status: 200, json: { ok: true, proposta: '', venda: '' } };
    return { status: 404, json: { ok: false } };
  };
  rodar('vdcFetch = (rota, metodo, corpo) => __srv(rota, metodo, corpo); showToast = (m) => { __toasts.push(String(m)); };');
}
const fluxo = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const puts = () => chamadas.filter((c) => c.metodo === 'PUT');
const gets = () => chamadas.filter((c) => c.metodo === 'GET' && /cadastro$/.test(c.rota));
const escolher = async (c: 'ele' | 'sol', card: { linha: string; codigo: string; nome: string; status?: string }) => {
  SB.__ach = [card]; rodar(`CTR_VERS.${c}.achados = __ach; ctrCardEscolher('${c}', 0)`);
  await fluxo();
};

describe('um cadastro, vários papéis', () => {
  beforeAll(() => { SB = criarSandbox(); });
  beforeEach(() => {
    elementos.clear(); toasts = []; chamadas = []; postadas = [];
    cads = { 'eletroposto:101': cadastro(MARTA), 'eletroposto:202': cadastro(BETO), 'vendasolar:301': cadastro({ ...MARTA, nome: 'Dona Marta Solar' }) };
    SB.__toasts = toasts;
    rodar("vdcOrigemEp = ''; vdcOrigemFs = ''; ctrCardLigado = null; fsCardLigado = null; vdcBase = { ele: null, sol: null }; vdcDiff = { ele: null, sol: null }; vdcPendente = { ele: 0, sol: 0 }; fsMontado = true;");
    instalarServidor();
  });

  it('as peças existem e o script carrega sem lançar', () => {
    for (const f of ['vdcAplicarDoCard', 'vdcVoltaParaCadastro', 'vdcColetarVolta', 'vdcMsgPlanilha', 'vdcConferirVersao', 'vdcAtualizarDaFaixa']) expect(rodar(`typeof ${f}`), f).toBe('function');
  });

  it('ligar um card VENDIDO pelo seletor aplica o cadastro sozinho (identidade nos papéis e no Orçamento), sem navegar', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    expect(rodar('ctrCardLigado')).toMatchObject({ codigo: '101' });
    expect(gets()).toHaveLength(1);
    expect(val('el-cliente')).toBe('Dona Marta Souza');
    ['eq-cli-nome', 'rec-cli-nome', 'proc-outorgante', 'bnk-nome'].forEach((id) => expect(val(id), id).toBe('Dona Marta Souza'));
    ['orc-cli-doc', 'eq-cli-doc', 'rec-cli-doc', 'proc-outorgante-doc', 'bnk-doc'].forEach((id) => expect(val(id), id).toBe('529.982.247-25'));
    expect(val('orc-cli-email')).toBe('marta@exemplo.test');
    expect(rodar('vdcOrigemEp')).toBe('eletroposto:101');
    expect(rodar('vdcBase.ele && vdcBase.ele.origem')).toBe('eletroposto:101');
  });

  it('card NÃO vendido: liga mas não busca nem aplica nada', async () => {
    await escolher('ele', { ...A, status: 'agendado' });
    expect(rodar('ctrCardLigado')).toMatchObject({ codigo: '101' });
    expect(chamadas).toHaveLength(0);
    expect(val('el-cliente')).toBe('');
  });

  it('número do negócio nunca vem do cadastro: valor e sinal digitados ficam como estão ao aplicar', async () => {
    el('orc-valor').value = '88.000,00'; el('ctr-sinal').value = '8.000,00';
    await escolher('ele', { ...A, status: 'fechou' });
    expect(val('orc-valor')).toBe('88.000,00');
    expect(val('ctr-sinal')).toBe('8.000,00');
  });

  it('Gerar: editar o NOME no contrato grava só o nome no cadastro do MESMO card (fonte contrato), sem número do negócio, e os outros papéis recebem', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    chamadas.length = 0;
    el('ctr-contratante').value = 'Marta Souza da Silva'; el('ctr-contratante').dataset.tocado = '1';   // o espelho do contrato, onde a pessoa digita (o ouvinte de input marca tocado)
    el('orc-valor').value = '99.999,00'; el('ctr-sinal').value = '9.999,00'; el('ctr-prazo-obra').value = '120';
    await rodar('vdcVoltaParaCadastro("ele")');
    await fluxo();
    expect(puts()).toHaveLength(1);
    expect(puts()[0].rota).toMatch(/clientes\/eletroposto\/101\/cadastro$/);
    expect(puts()[0].corpo).toEqual({ campos: { nome: 'Marta Souza da Silva' }, fonte: 'contrato', base_em: EM });
    expect(cads['eletroposto:101'].campos.nome.valor).toBe('Marta Souza da Silva');
    expect(cads['eletroposto:202'].campos.nome.valor).toBe('Seu Beto Lima');
    expect(toasts.join(' | ')).toMatch(/Atualizado no cadastro do cliente: nome/);
    // reaplicado em silêncio: o Simulador e os outros papéis já têm o nome novo, e o negócio não mexeu
    expect(val('el-cliente')).toBe('Marta Souza da Silva');
    expect(val('rec-cli-nome')).toBe('Marta Souza da Silva');
    expect(val('orc-valor')).toBe('99.999,00');
    // depois da volta, a base é a nova: gerar de novo sem editar nada não grava nada
    chamadas.length = 0;
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()).toHaveLength(0);
  });

  it('Gerar sem editar identidade não grava nada; apagar um campo (vazio) também não apaga o cadastro', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    chamadas.length = 0;
    el('orc-cli-email').value = '';
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()).toHaveLength(0);
  });

  it('espelho que só SEGUE a fonte (ninguém digitou nele) nunca vira edição: ctr-local derivado do modelo não vai para o cadastro', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    chamadas.length = 0;
    el('ctr-local').value = 'Rua Nova 77, Uberlandia';   // o espelho recalculou (troca de modelo / cidade), sem tocado
    el('ctr-cidade').value = 'Outra Cidade';
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()).toHaveLength(0);
    el('ctr-local').dataset.tocado = '1';               // agora a pessoa digitou no local do ponto
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()[0].corpo.campos).toEqual({ endereco_ponto: 'Rua Nova 77, Uberlandia' });
  });

  it('depois da volta nada digitado à mão por outra pessoa é apagado (cedente, e titular/financiamento no solar)', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    el('ctr-ced-end').value = 'Endereço do cedente digitado, Uberaba/MG';   // composto: não volta ao cadastro, e não pode sumir
    el('ctr-aval-nome').value = 'Avalista digitado';
    el('ctr-contratante').value = 'Nome corrigido'; el('ctr-contratante').dataset.tocado = '1';
    await rodar('vdcVoltaParaCadastro("ele")'); await fluxo();
    expect(puts()[0].corpo.campos).toEqual({ nome: 'Nome corrigido', aval_nome: 'Avalista digitado' });
    expect(val('ctr-ced-end')).toBe('Endereço do cedente digitado, Uberaba/MG');
    expect(val('ctr-aval-nome')).toBe('Avalista digitado');
    expect(val('el-cliente')).toBe('Nome corrigido');
    // solar: o titular digitado à mão sobrevive a um telefone corrigido
    await escolher('sol', { linha: 'vendasolar', codigo: '301', nome: 'Dona Marta Solar', status: 'fechou' });
    el('fs-p-tuc-end').value = 'Rua do titular digitada'; el('fs-p-tuc-rg').value = 'MG-1.234.567'; el('fs-b-fin-nome').value = 'Financiado digitado';
    el('fs-tel').value = '34 98888-0099';
    chamadas.length = 0;
    await rodar('vdcVoltaParaCadastro("sol")'); await fluxo();
    expect(puts()[0].corpo.campos).toEqual({ telefone: '34 98888-0099', fin_nome: 'Financiado digitado' });   // rg e endereço do titular são compostos: não voltam, e ficam
    expect(val('fs-p-tuc-end')).toBe('Rua do titular digitada');
    expect(val('fs-p-tuc-rg')).toBe('MG-1.234.567');
    expect(val('fs-b-fin-nome')).toBe('Financiado digitado');
  });

  it('endereço composto volta sem o bairro e a cidade-UF volta separada', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    chamadas.length = 0;
    el('orc-cli-end').value = 'Rua Nova 77, Centro'; el('el-cidade').value = 'Uberlandia-MG';
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()[0].corpo.campos).toEqual({ endereco: 'Rua Nova 77', cidade: 'Uberlandia', uf: 'MG' });
  });

  it('card A -> card B: o dado de A não vai para o cadastro de B nem para o formulário de B, e nada é gravado', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    el('ctr-contratante').value = 'Editado em A, ainda não gerado';
    await escolher('ele', { ...B, status: 'fechou' });
    expect(val('el-cliente')).toBe('Seu Beto Lima');
    expect(val('orc-cli-doc')).toBe('111.444.777-35');
    expect(rodar('vdcOrigemEp')).toBe('eletroposto:202');
    chamadas.length = 0;
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()).toHaveLength(0);
    expect(cads['eletroposto:101'].campos.nome.valor).toBe('Dona Marta Souza');
    expect(cads['eletroposto:202'].campos.nome.valor).toBe('Seu Beto Lima');
  });

  it('trocar para um card NÃO vendido com os campos de A ainda na tela: o Gerar não grava nada em ninguém', async () => {
    await escolher('ele', { ...A, status: 'fechou' });
    await escolher('ele', { ...B, status: 'agendado' });   // liga B sem aplicar cadastro
    el('ctr-contratante').value = 'Algo digitado com os dados de A na tela';
    chamadas.length = 0;
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()).toHaveLength(0);
  });

  it('A vendido -> B NÃO vendido -> C vendido: nada de A fica em B, só o nome de B; em C só dados de C; gerar com B não grava nada; o papel salvo em B não tem dado de A', async () => {
    const C = { linha: 'eletroposto', codigo: '303', nome: 'Dona Cida Prado' };
    cads['eletroposto:303'] = cadastro({ nome: 'Dona Cida Prado', cpf_cnpj: '390.533.447-05', cidade: 'Patos', uf: 'MG', email: 'cida@exemplo.test' });
    el('orc-valor').value = '77.000,00';
    await escolher('ele', { ...A, status: 'fechou' });
    el('ctr-ced-nome').value = 'Cedente de A'; el('ctr-ta-matricula').value = 'Matricula de A'; el('ctr-local').value = 'Local de A';
    toasts.length = 0;   // (os espelhos do contrato voltam a seguir a fonte pelo ctrEspSync, que o sandbox deixa mudo)
    await escolher('ele', { ...B, status: 'agendado' });
    expect(val('el-cliente')).toBe('Seu Beto Lima');   // só o nome do card novo
    ['orc-cli-doc', 'orc-cli-end', 'orc-cli-cep', 'orc-cli-tel', 'orc-cli-email', 'eq-cli-nome', 'rec-cli-nome', 'proc-outorgante', 'bnk-nome', 'bnk-doc', 'el-cidade',
      'ctr-ced-nome', 'ctr-ta-matricula', 'ctr-local'].forEach((id) => expect(val(id), id).toBe(''));
    expect(val('orc-valor')).toBe('77.000,00');   // número do negócio não é tocado
    expect(toasts.join(' | ')).toContain('Dados do cliente anterior foram limpos; preencha os do novo cliente');
    expect(rodar('ctrCardLigado')).toMatchObject({ codigo: '202' });
    expect(rodar('vdcOrigemEp')).toBe('');
    // o que um papel salvo em B levaria (o snapshot vem dos campos): nada de A
    const dump = JSON.stringify([...elementos.values()].map((e: any) => e.value).filter(Boolean));
    expect(dump).not.toMatch(/Marta|529\.982|Flores|marta@|Cedente de A|Matricula de A|Local de A/);
    chamadas.length = 0;
    await rodar('vdcVoltaParaCadastro("ele")');
    expect(puts()).toHaveLength(0);
    await escolher('ele', { ...C, status: 'fechou' });
    expect(val('el-cliente')).toBe('Dona Cida Prado');
    expect(val('orc-cli-doc')).toBe('390.533.447-05');
    expect(val('orc-cli-email')).toBe('cida@exemplo.test');
    expect(val('orc-cli-end')).toBe('');
    expect(rodar('vdcOrigemEp')).toBe('eletroposto:303');
    expect(JSON.stringify([...elementos.values()].map((e: any) => e.value).filter(Boolean))).not.toMatch(/Marta|Beto|529\.982|Flores/);
  });

  it('Fechamento: A vendido -> B não vendido limpa a identidade, os titulares e deixa o nome de B; o valor do contrato fica', async () => {
    await escolher('sol', { linha: 'vendasolar', codigo: '301', nome: 'Dona Marta Solar', status: 'fechou' });
    el('fs-p-tuc-nome').value = 'Titular de A'; el('fs-b-fin-nome').value = 'Financiado de A'; el('fs-c-valor').value = '55.000,00';
    await escolher('sol', { linha: 'vendasolar', codigo: '302', nome: 'Seu Zeca Novo', status: 'agendado' });
    expect(val('fs-nome')).toBe('Seu Zeca Novo');
    ['fs-doc', 'fs-end', 'fs-cep', 'fs-tel', 'fs-cidade', 'fs-p-tuc-nome', 'fs-b-fin-nome', 'fs-p-uc'].forEach((id) => expect(val(id), id).toBe(''));
    expect(val('fs-c-valor')).toBe('55.000,00');
    expect(rodar('fsCardLigado')).toMatchObject({ codigo: '302' });
    chamadas.length = 0;
    await rodar('vdcVoltaParaCadastro("sol")');
    expect(puts()).toHaveLength(0);
  });

  it('a resposta atrasada de um card que já foi trocado não aplica nada', async () => {
    let solta: () => void = () => {};
    SB.__srv2 = SB.__srv;
    SB.__srv = (rota: string, m: string, c?: any) => new Promise((ok) => { solta = () => ok(SB.__srv2(rota, m, c)); });
    SB.__ach = [{ ...A, status: 'fechou' }]; rodar("CTR_VERS.ele.achados = __ach; ctrCardEscolher('ele', 0)");
    rodar(`ctrCardSet('ele', ${JSON.stringify(B)})`);   // trocou de cliente com a resposta no ar
    solta(); await fluxo();
    expect(val('el-cliente')).toBe('');
  });

  describe('planilha do cliente (postMessage)', () => {
    const msg = (o: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const f = el('planilha-eletro-frame');
      return { origin: 'http://localhost', source: f.contentWindow, data: { tipo: 'cadastro-atualizado', linha: 'eletroposto', ...o }, ...extra };
    };
    it('salvou o card ligado: busca e reaplica, sem esvaziar terceiros', async () => {
      await escolher('ele', { ...A, status: 'fechou' });
      el('ctr-ced-nome').value = 'Cedente digitado';
      cads['eletroposto:101'].campos.nome = campo('Marta Planilha');
      cads['eletroposto:101'].campos.cpf_cnpj = campo('111.444.777-35');   // até o documento muda: segue sendo o mesmo card
      chamadas.length = 0;
      SB.__ev = msg({ codigo: '101' }); rodar('vdcMsgPlanilha(__ev)'); await fluxo();
      expect(gets()).toHaveLength(1);
      expect(val('el-cliente')).toBe('Marta Planilha');
      expect(val('orc-cli-doc')).toBe('111.444.777-35');
      expect(val('ctr-ced-nome')).toBe('Cedente digitado');
      expect(puts()).toHaveLength(0);
    });
    it('de OUTRO card, de outra origem ou de outra janela: ignorada, nada é buscado nem escrito', async () => {
      await escolher('ele', { ...A, status: 'fechou' });
      chamadas.length = 0;
      const casos = [msg({ codigo: '202' }), msg({ codigo: '101' }, { origin: 'https://evil.example' }), msg({ codigo: '101' }, { source: { postMessage() {} } }),
        msg({ codigo: '101', linha: 'vendasolar' }), msg({ codigo: '10x' }), msg({ codigo: '101', tipo: 'outra-coisa' })];
      for (const ev of casos) { SB.__ev = ev; rodar('vdcMsgPlanilha(__ev)'); }
      await fluxo();
      expect(chamadas).toHaveLength(0);
      expect(val('el-cliente')).toBe('Dona Marta Souza');
    });
    it('com formulário vindo de outro card, a mensagem não faz nada', async () => {
      rodar("vdcOrigemEp = 'eletroposto:202'");
      rodar(`ctrCardSet('ele', ${JSON.stringify(A)})`);
      SB.__ev = msg({ codigo: '101' }); rodar('vdcMsgPlanilha(__ev)'); await fluxo();
      expect(chamadas).toHaveLength(0);
    });
    it('o contrato que gravou no cadastro avisa a planilha aberta (mesma origem)', async () => {
      const f = el('planilha-eletro-frame');
      f.getAttribute = () => '/gerador/clientes/?linha=eletroposto&embutida=1';
      f.contentWindow = { postMessage: (d: any, o: string) => postadas.push([d, o]) };
      await escolher('ele', { ...A, status: 'fechou' });
      el('ctr-contratante').value = 'Nome corrigido no contrato'; el('ctr-contratante').dataset.tocado = '1';
      await rodar('vdcVoltaParaCadastro("ele")'); await fluxo();
      expect(postadas).toEqual([[{ tipo: 'cadastro-recarregar', linha: 'eletroposto', codigo: '101' }, 'http://localhost']]);
    });
  });

  describe('reabrir uma versão salva', () => {
    const snapAntigo = () => ({ ctrCard: A, sim: { 'el-cliente': 'Marta Nome Antigo' }, doc: '529.982.247-25', end: 'Rua das Flores 10, Centro', email: 'marta@exemplo.test', tel: '', cep: '', ie: '' });
    it('com o cadastro diferente: mostra a faixa e NÃO muda nada sem o clique; o clique aplica o cadastro', async () => {
      SB.__e = { id: 'v1', tipo: 'Contrato', cliente: 'Marta Nome Antigo', snap: snapAntigo() };
      rodar(`epAbrirEntrada(__e, ${JSON.stringify(A)})`);
      await fluxo();
      expect(val('el-cliente')).toBe('Marta Nome Antigo');
      expect(rodar('vdcDiff.ele && vdcDiff.ele.chave')).toBe('eletroposto:101');
      const faixa = String(el('ctr-card-ele').innerHTML);
      expect(faixa).toContain('Os dados do cliente mudaram desde esta versão');
      expect(faixa).toContain('Atualizar com os dados atuais do cliente');
      expect(puts()).toHaveLength(0);
      expect(rodar('vdcBase.ele')).toBeNull();   // versão aberta: nada volta ao cadastro sozinho
      // sem o clique, o Gerar também não leva nada ao cadastro
      el('ctr-contratante').value = 'Digitado depois de abrir a versão';
      await rodar('vdcVoltaParaCadastro("ele")');
      expect(puts()).toHaveLength(0);
      // o clique
      await rodar('vdcAtualizarDaFaixa("ele")'); await fluxo();
      expect(val('el-cliente')).toBe('Dona Marta Souza');
      expect(rodar('vdcDiff.ele')).toBeNull();
    });
    it('com o cadastro igual ao salvo: sem faixa', async () => {
      SB.__e = { id: 'v1', tipo: 'Contrato', cliente: 'Dona Marta Souza', snap: { ...snapAntigo(), sim: { 'el-cliente': 'Dona Marta Souza' } } };
      rodar(`epAbrirEntrada(__e, ${JSON.stringify(A)})`);
      await fluxo();
      expect(rodar('vdcDiff.ele')).toBeNull();
      expect(String(el('ctr-card-ele').innerHTML)).not.toContain('mudaram desde esta versão');
    });
  });

  describe('Fechamento solar', () => {
    it('ligar o card solar vendido aplica o cadastro; editar o nome e gerar grava só o nome no cadastro solar do mesmo card', async () => {
      await escolher('sol', { linha: 'vendasolar', codigo: '301', nome: 'Dona Marta Solar', status: 'fechou' });
      expect(val('fs-nome')).toBe('Dona Marta Solar');
      expect(rodar('vdcOrigemFs')).toBe('vendasolar:301');
      chamadas.length = 0;
      el('fs-nome').value = 'Marta Solar Corrigida'; el('fs-c-valor').value = '55.000,00';
      await rodar('vdcVoltaParaCadastro("sol")'); await fluxo();
      expect(puts()).toHaveLength(1);
      expect(puts()[0].rota).toMatch(/clientes\/vendasolar\/301\/cadastro$/);
      expect(puts()[0].corpo).toEqual({ campos: { nome: 'Marta Solar Corrigida' }, fonte: 'contrato', base_em: EM });
      expect(val('fs-c-valor')).toBe('55.000,00');
    });
  });

  describe('correções da revisão', () => {
    const espelhosAntigos = {
      'ctr-contratante': { v: 'Marta Nome Antigo', t: true }, 'ctr-contratante-doc': { v: '000.000.000-00', t: true }, 'ctr-contratante-end': { v: 'Rua Antiga 1', t: true },
    };
    const versao = () => ({ id: 'v1', tipo: 'Contrato', cliente: 'Marta Nome Antigo', snap: { ctrCard: A, sim: { 'el-cliente': 'Marta Nome Antigo' }, doc: '000.000.000-00', end: 'Rua Antiga 1', ctrEspelhos: espelhosAntigos } });

    it('Atualizar com os dados atuais: os espelhos digitados voltam a seguir a fonte e o PAPEL sai com nome, CPF e endereço novos', async () => {
      rodar('ctrEspSync = __ctrEspSyncReal');
      SB.__e = versao(); rodar(`epAbrirEntrada(__e, ${JSON.stringify(A)})`); await fluxo();
      expect(rodar("ctrCampo('ctr-contratante')")).toBe('Marta Nome Antigo');
      expect(rodar("ctrCampo('ctr-contratante-doc')")).toBe('000.000.000-00');
      expect(rodar('vdcDiff.ele && vdcDiff.ele.chave')).toBe('eletroposto:101');
      await rodar('vdcAtualizarDaFaixa("ele")'); await fluxo();
      expect(rodar("ctrCampo('ctr-contratante')")).toBe('Dona Marta Souza');
      expect(rodar("ctrCampo('ctr-contratante-doc')")).toBe('529.982.247-25');
      expect(rodar("ctrCampo('ctr-contratante-end')")).toBe('Rua das Flores 10, Centro');
    });
    it('versão com a identidade digitada DIRETO no contrato (Simulador vazio) também mostra a faixa', async () => {
      const v: any = versao(); v.snap.sim = {}; v.snap.doc = ''; v.snap.end = '';
      SB.__e = v; rodar(`epAbrirEntrada(__e, ${JSON.stringify(A)})`); await fluxo();
      expect(rodar('vdcDiff.ele && vdcDiff.ele.rotulos.length > 0')).toBe(true);
    });
    it('endereço: "Rua X 10, Centro" -> "Rua X 10, Jardim" grava rua e bairro separados, nunca "…Jardim, Centro"', async () => {
      await escolher('ele', { ...A, status: 'fechou' });
      chamadas.length = 0;
      el('orc-cli-end').value = 'Rua X 10, Jardim';
      await rodar('vdcVoltaParaCadastro("ele")'); await fluxo();
      expect(puts()[0].corpo.campos).toEqual({ endereco: 'Rua X 10', bairro: 'Jardim' });
      expect(cads['eletroposto:101'].campos.endereco.valor).toBe('Rua X 10');
      expect(val('orc-cli-end')).toBe('Rua X 10, Jardim');
      expect(val('bnk-bairro')).toBe('Jardim');
      // número no fim não é bairro: o texto todo é a rua
      el('orc-cli-end').value = 'Rua X 10, Apto 12';
      chamadas.length = 0;
      await rodar('vdcVoltaParaCadastro("ele")'); await fluxo();
      expect(puts()[0].corpo.campos).toEqual({ endereco: 'Rua X 10, Apto 12' });
    });
    it('trocar de A para B vendido esvazia A ANTES de buscar B e o Gerar espera enquanto o cadastro de B não chegou', async () => {
      await escolher('ele', { ...A, status: 'fechou' });
      let solta: () => void = () => {};
      SB.__srv2 = SB.__srv;
      SB.__srv = (rota: string, m: string, c?: any) => new Promise((ok) => { solta = () => ok(SB.__srv2(rota, m, c)); });
      toasts.length = 0;
      SB.__ach = [{ ...B, status: 'fechou' }]; rodar("CTR_VERS.ele.achados = __ach; ctrCardEscolher('ele', 0)");
      expect(val('orc-cli-doc')).toBe('');          // nada de A enquanto B não chegou
      expect(val('orc-cli-email')).toBe('');
      expect(rodar('vdcPendente.ele')).toBe(1);
      rodar("epPrevEstado = null; epPreview({ html: '<p>x</p>', arquivo: 'a', titulo: 'a' })");
      expect(toasts.join(' | ')).toMatch(/Carregando os dados do cliente/);
      expect(rodar('epPrevEstado')).toBeNull();     // o Gerar não abriu
      solta(); await fluxo();
      expect(rodar('vdcPendente.ele')).toBe(0);
      expect(val('orc-cli-doc')).toBe('111.444.777-35');
    });
    it('zerar o cliente também zera a origem dos formulários (eletroposto e Fechamento)', () => {
      rodar("vdcOrigemEp = 'eletroposto:101'; try { ctrEstadoZerar(); } catch (e) {}");
      expect(rodar('vdcOrigemEp')).toBe('');
      const f = readFileSync(HTML, 'utf8');
      expect(f).toMatch(/function fsLimparCliente\(\) \{\r?\n  vdcBase\.sol = null; vdcDiff\.sol = null; vdcOrigemFs = '';/);
    });
    it('a planilha mudou o cadastro com edição de identidade ainda não gerada: a edição é mantida, o resto recebe, e o Gerar ainda leva a edição', async () => {
      await escolher('ele', { ...A, status: 'fechou' });
      el('ctr-contratante').value = 'Nome do contrato'; el('ctr-contratante').dataset.tocado = '1';
      cads['eletroposto:101'].campos.nome = campo('Nome da planilha');
      cads['eletroposto:101'].campos.email = campo('novo@planilha.test');
      toasts.length = 0;
      const f = el('planilha-eletro-frame');
      SB.__ev = { origin: 'http://localhost', source: f.contentWindow, data: { tipo: 'cadastro-atualizado', linha: 'eletroposto', codigo: '101' } };
      rodar('vdcMsgPlanilha(__ev)'); await fluxo();
      expect(val('el-cliente')).toBe('Dona Marta Souza');            // a chave editada (nome) não foi sobrescrita
      expect(val('ctr-contratante')).toBe('Nome do contrato');
      expect(val('orc-cli-email')).toBe('novo@planilha.test');        // o que ninguém editou recebe
      expect(toasts.join(' | ')).toContain('A planilha mudou dados do cliente; o que você editou no contrato foi mantido.');
      chamadas.length = 0;
      await rodar('vdcVoltaParaCadastro("ele")'); await fluxo();
      expect(puts()[0].corpo.campos).toEqual({ nome: 'Nome do contrato' });
    });
    it('a volta manda base_em e, com conflito (409), avisa e não grava nem mexe nos papéis', async () => {
      await escolher('ele', { ...A, status: 'fechou' });
      el('ctr-contratante').value = 'Nome do contrato'; el('ctr-contratante').dataset.tocado = '1';
      const ok = SB.__srv;
      SB.__srv = async (rota: string, m: string, c?: any) => (m === 'PUT' ? (chamadas.push({ rota, metodo: m, corpo: c }), { status: 409, json: { ok: false, conflitos: ['nome'] } }) : ok(rota, m, c));
      toasts.length = 0; chamadas.length = 0;
      await rodar('vdcVoltaParaCadastro("ele")'); await fluxo();
      expect(puts()).toHaveLength(1);
      expect(puts()[0].corpo.base_em).toBe(EM);
      expect(toasts.join(' | ')).toMatch(/Outra pessoa alterou o cadastro deste cliente \(nome[^)]*\)/);
      expect(cads['eletroposto:101'].campos.nome.valor).toBe('Dona Marta Souza');
      expect(val('el-cliente')).toBe('Dona Marta Souza');
    });
    it('a comparação da IA rotula a fonte "contrato"', () => {
      expect(readFileSync(HTML, 'utf8')).toContain("fonte === 'contrato' ? ' (do contrato)'");
    });
  });

  it('a planilha embutida só avisa e escuta com origem conferida (fonte)', () => {
    const f = readFileSync(join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador', 'clientes', 'index.html'), 'utf8');
    expect(f).toMatch(/postMessage\(\{ tipo: 'cadastro-atualizado', linha: 'eletroposto'[\s\S]{0,160}?location\.origin\)/);
    expect(f).toMatch(/ev\.origin !== location\.origin \|\| ev\.source !== window\.parent/);
    expect(f).toContain("d.tipo !== 'cadastro-recarregar'");
  });
});
