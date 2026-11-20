import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { banco, evento, iso, consultaFalsa } from './_monjourBancoFalso';

// GET /admin/monjour/quiz-funil/sessoes e /sessao/:sid: quem chegou e quem saiu de cada tela, e a jornada de uma sessão.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consultaFalsa() } }));

import adminMonjour from '../routes/adminMonjour';
import { esquecerSessoesLidas } from '../services/monjour/sessoesQuizMonjour';
import { QUIZ_NOVO_DESDE } from '../services/monjour/monjourCatalogo';

const app = express();
app.use(express.json());
app.use('/admin/monjour', adminMonjour);

// O relógio é falso e as sessões são ANTIGAS (antes do quiz novo): a conta fica igual em qualquer data e as telas novas (abertura e
// prévia do app, com `desde`) não existem para elas. Os números de passo abaixo são posições do catálogo: P(n) leva o n antigo à posição de hoje.
const T0 = Date.parse(QUIZ_NOVO_DESDE) - 3 * 3600_000;
const CHAVES = ['edad', 'objetivo', 'cuerpo', 'zona', 'hace', 'inyecciones'];

/** Uma sessão que viu as telas 1 a `ate`, 10 s por tela. `quando` desloca a entrada. */
function sessao(sid: string, ate: number, quando = 0, ctx: Record<string, unknown> = {}) {
  for (let n = 1; n <= ate; n += 1) {
    const ts = T0 + quando + n * 10_000;
    banco.linhas.push(evento(sid, 'monjour_passo', { passo: CHAVES[n - 1] ?? 'noticia', n, ts, pais: 'MX', regiao: 'Jalisco', cidade: 'Guadalajara', disp: 'movil', so: 'android', nav: 'chrome', utm_content: '120256011166960271', ...ctx }, iso(ts)));
  }
}
const resp = (sid: string, passo: string, valor: unknown, seg: number) =>
  banco.linhas.push(evento(sid, 'monjour_resp', { passo, resp: valor, ts: T0 + seg * 1000 }, iso(T0 + seg * 1000)));
const fim = (sid: string, destino: string, seg: number, extra: Record<string, unknown> = {}) =>
  banco.linhas.push(evento(sid, 'monjour_fim', { destino, ts: T0 + seg * 1000, ...extra }, iso(T0 + seg * 1000)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0 + 3 * 3600_000));
  banco.linhas = []; banco.consultas = []; banco.erro = false; esquecerSessoesLidas();
});
afterEach(() => { vi.useRealTimers(); });

describe('GET /admin/monjour/quiz-funil/sessoes', () => {
  it('pagina de 50 em 50 e pára em 500 linhas, com o total real', async () => {
    for (let i = 0; i < 520; i += 1) sessao(`s${String(i).padStart(3, '0')}`, 1, i * 1000);
    const a = await request(app).get('/admin/monjour/quiz-funil/sessoes?period=7dias&passo=2&tipo=chegaram');
    expect(a.status).toBe(200);
    expect(a.body.total).toBe(520);
    expect(a.body.itens).toHaveLength(50);
    expect(a.body.proximo).toBe('50');
    // Do mais novo ao mais velho.
    expect(a.body.itens[0].sid).toBe('s519');
    const ultima = await request(app).get('/admin/monjour/quiz-funil/sessoes?period=7dias&passo=2&tipo=chegaram&cursor=450');
    expect(ultima.body.itens).toHaveLength(50);
    expect(ultima.body.proximo).toBeNull();
    const alem = await request(app).get('/admin/monjour/quiz-funil/sessoes?period=7dias&passo=2&cursor=500');
    expect(alem.body.itens).toHaveLength(0);
    expect(alem.body.proximo).toBeNull();
  });

  it('lê os mesmos tipos do funil (com o app) e só as colunas necessárias', async () => {
    sessao('a', 2);
    banco.linhas.push(evento('a', 'monjour_app', { acao: 'abriu' }, iso(T0 + 60_000)));
    // Sessão só de app não é visitante do quiz: fica fora, como no funil.
    banco.linhas.push(evento('so-app', 'monjour_app', { acao: 'abriu' }, iso(T0)));
    const r = await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2');
    expect(r.body.total).toBe(1);
    expect(banco.consultas.every((c) => c.colunas === 'session_id, event_type, event_data, created_at')).toBe(true);
  });

  it('sonda marcada só num evento do app sai da lista, como sai do funil', async () => {
    sessao('a', 2);
    sessao('b', 2);
    banco.linhas.push(evento('b', 'monjour_app', { acao: 'abriu', utm_source: 'sonda' }, iso(T0 + 60_000)));
    const r = await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2');
    expect(r.body.itens.map((i: { sid: string }) => i.sid)).toEqual(['a']);
  });

  it('trocar de página ou de aba no mesmo período não relê o banco', async () => {
    for (let i = 0; i < 60; i += 1) sessao(`s${String(i).padStart(2, '0')}`, 1, i * 1000);
    await request(app).get('/admin/monjour/quiz-funil/sessoes?period=7dias&passo=2');
    const lidas = banco.consultas.length;
    const b = await request(app).get('/admin/monjour/quiz-funil/sessoes?period=7dias&passo=2&cursor=50');
    await request(app).get('/admin/monjour/quiz-funil/sessoes?period=7dias&passo=2&tipo=sairam');
    expect(b.body.itens).toHaveLength(10);
    expect(banco.consultas.length).toBe(lidas);
    await request(app).get('/admin/monjour/quiz-funil/sessoes?period=30dias&passo=2');
    expect(banco.consultas.length).toBeGreaterThan(lidas);
  });

  it('chegaram e saíram seguem a conta do funil', async () => {
    sessao('a', 2);
    sessao('b', 5);
    sessao('c', 5);
    fim('c', 'checkout', 100, { plan: 'basico' });
    sessao('d', 5);
    fim('d', 'checkout', 100, { plan: 'plus' });
    fim('d', 'compra', 200, { plan: 'plus' });
    const por = async (passo: number, tipo: string) =>
      (await request(app).get(`/admin/monjour/quiz-funil/sessoes?passo=${passo}&tipo=${tipo}`)).body;
    expect((await por(4, 'chegaram')).total).toBe(4);
    expect((await por(4, 'sairam')).itens.map((i: { sid: string }) => i.sid)).toEqual(['a']);
    expect((await por(7, 'chegaram')).total).toBe(3);
    expect((await por(7, 'sairam')).itens.map((i: { sid: string }) => i.sid)).toEqual(['b']);
    const clicaram = await por(35, 'sairam');
    expect(clicaram.itens.map((i: { sid: string }) => i.sid)).toEqual(['c']);
    expect(clicaram.itens[0]).toMatchObject({ clicouComprar: true, comprou: false, plano: 'basico' });
    const compraram = await por(36, 'chegaram');
    expect(compraram.itens[0]).toMatchObject({ sid: 'd', clicouComprar: true, comprou: true, plano: 'plus', maxPasso: 34 });
    expect((await por(36, 'sairam')).total).toBe(0);
  });

  it('cada linha traz contexto, respostas com rótulo e anúncio e conjunto do catálogo', async () => {
    sessao('a', 3);
    resp('a', 'edad', '25', 5);
    resp('a', 'objetivo', 'peso', 15);
    resp('a', 'cuerpo', 'mediana', 25);
    const r = await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=5');
    expect(r.body.itens[0]).toEqual({
      sid: 'a', entrou: iso(T0 + 5_000), pais: 'MX', paisNome: 'México', regiao: 'Jalisco', cidade: 'Guadalajara',
      disp: 'movil', so: 'android', nav: 'chrome', idade: '25-34 años', objetivo: 'Bajar de peso', cuerpo: 'Mediana',
      anuncio: 'IMG01 Dono 1 livro', conjunto: 'CJ1 - Imagens', maxPasso: 5, maxPassoRotulo: 'Corpo hoje', clicouComprar: false, comprou: false, plano: null, atalho: false, volta: false,
    });
  });

  it('filtros de país, aparelho e anúncio valem; sessão sonda fica fora', async () => {
    sessao('mx', 2);
    sessao('co', 2, 0, { pais: 'CO', disp: 'escritorio', utm_content: '' });
    sessao('sonda', 2, 0, { utm_source: 'sonda' });
    const todas = await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2');
    expect(todas.body.total).toBe(2);
    const pais = await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2&pais=co');
    expect(pais.body.itens.map((i: { sid: string }) => i.sid)).toEqual(['co']);
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2&disp=movil')).body.itens[0].sid).toBe('mx');
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2&anuncio=sem')).body.itens[0].sid).toBe('co');
  });

  it('pedido ruim volta 400 e banco fora volta 500', async () => {
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes')).status).toBe(400);
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=37')).status).toBe(400);
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2&tipo=outro')).status).toBe(400);
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2&cursor=-1')).status).toBe(400);
    banco.erro = true;
    expect((await request(app).get('/admin/monjour/quiz-funil/sessoes?passo=2')).status).toBe(500);
  });
});

describe('GET /admin/monjour/quiz-funil/sessao/:sid', () => {
  it('jornada tela por tela com o tempo em cada tela e só as respostas permitidas', async () => {
    banco.linhas.push(evento('j', 'monjour_passo', { passo: 'edad', n: 1, ts: T0, pais: 'MX' }, iso(T0)));
    resp('j', 'edad', '25', 5);
    banco.linhas.push(evento('j', 'monjour_passo', { passo: 'objetivo', n: 2, ts: T0 + 20_000 }, iso(T0 + 20_000)));
    resp('j', 'objetivo', 'peso', 25);
    banco.linhas.push(evento('j', 'monjour_passo', { passo: 'peso', n: 19, ts: T0 + 50_000 }, iso(T0 + 50_000)));
    resp('j', 'peso', '80', 55);
    resp('j', 'zona', 'texto-solto', 56);
    fim('j', 'checkout', 90);
    const r = await request(app).get('/admin/monjour/quiz-funil/sessao/j');
    expect(r.status).toBe(200);
    expect(r.body.resumo).toMatchObject({ sid: 'j', pais: 'MX', idade: '25-34 años', objetivo: 'Bajar de peso', clicouComprar: true });
    const linha = r.body.linha;
    expect(linha.map((l: { tipo: string; n: number | null }) => `${l.tipo}:${l.n}`)).toEqual([
      'viu:2', 'respondeu:2', 'viu:4', 'respondeu:4', 'viu:23', 'respondeu:6', 'fim:35',
    ]);
    expect(linha[0]).toEqual({ ts: iso(T0), tipo: 'viu', passo: 'edad', n: 2, rotulo: 'Idade', resposta: null, segundosNaTela: 20 });
    expect(linha[1]).toMatchObject({ resposta: '25-34 años', rotulo: 'Idade', segundosNaTela: null });
    expect(linha[2].segundosNaTela).toBe(30);
    expect(linha[4]).toMatchObject({ rotulo: 'Peso', segundosNaTela: 40 });
    // Peso digitado não é resposta permitida; valor fora da lista não é repetido.
    expect(JSON.stringify(linha)).not.toContain('80');
    expect(linha[5].resposta).toBe('Outra resposta');
    expect(linha[6]).toMatchObject({ tipo: 'fim', passo: 'checkout', rotulo: 'Clicou em comprar' });
  });

  it('tela parada por mais de 30 minutos não tem tempo', async () => {
    banco.linhas.push(evento('l', 'monjour_passo', { passo: 'edad', n: 1, ts: T0 }, iso(T0)));
    banco.linhas.push(evento('l', 'monjour_passo', { passo: 'objetivo', n: 2, ts: T0 + 3_600_000 }, iso(T0 + 3_600_000)));
    const r = await request(app).get('/admin/monjour/quiz-funil/sessao/l');
    expect(r.body.linha[0].segundosNaTela).toBeNull();
  });

  it('sessão que não existe, sonda e sid estranho', async () => {
    sessao('sonda', 2, 0, { utm_source: 'sonda' });
    expect((await request(app).get('/admin/monjour/quiz-funil/sessao/nada')).status).toBe(404);
    expect((await request(app).get('/admin/monjour/quiz-funil/sessao/sonda')).status).toBe(404);
    expect((await request(app).get('/admin/monjour/quiz-funil/sessao/a%20b')).status).toBe(400);
    banco.erro = true;
    expect((await request(app).get('/admin/monjour/quiz-funil/sessao/x')).status).toBe(500);
  });
});

describe('atalho e volta direto para a oferta (sessões e jornada)', () => {
  const passoSemN = (sid: string, passo: string, seg: number) =>
    banco.linhas.push(evento(sid, 'monjour_passo', { passo, ts: T0 + seg * 1000, pais: 'MX' }, iso(T0 + seg * 1000)));
  const oferta = (sid: string, seg: number) =>
    banco.linhas.push(evento(sid, 'monjour_passo', { passo: 'oferta', n: 30, ts: T0 + seg * 1000, pais: 'MX' }, iso(T0 + seg * 1000)));
  const por = async (passo: number, tipo: string) =>
    (await request(app).get(`/admin/monjour/quiz-funil/sessoes?passo=${passo}&tipo=${tipo}`)).body;
  const sids = (p: { itens: { sid: string }[] }) => p.itens.map((i) => i.sid).sort();

  beforeEach(() => {
    sessao('normal', 3);
    sessao('atalho', 1);
    passoSemN('atalho', 'atalho_oferta', 30);
    oferta('atalho', 40);
    passoSemN('volta', 'volta_oferta', 50);
    oferta('volta', 55);
  });

  it('as telas do meio só listam quem viu de verdade; a oferta lista quem foi a ela', async () => {
    expect(sids(await por(2, 'chegaram'))).toEqual(['atalho', 'normal']);
    expect(sids(await por(4, 'chegaram'))).toEqual(['normal']);
    expect(sids(await por(34, 'chegaram'))).toEqual(['atalho', 'volta']); // 'normal' parou na tela 3
  });

  it('saíram: quem foi à oferta não sai nas telas do meio', async () => {
    expect(sids(await por(2, 'sairam'))).toEqual([]);
    expect(sids(await por(5, 'sairam'))).toEqual(['normal']);
    expect(sids(await por(34, 'sairam'))).toEqual(['atalho', 'volta']);
  });

  it('cada linha diz se entrou pelo atalho ou voltou direto', async () => {
    const porSid = (p: { itens: { sid: string }[] }) => Object.fromEntries(p.itens.map((i) => [i.sid, i]));
    const naIdade = porSid(await por(2, 'chegaram'));
    expect(naIdade.atalho).toMatchObject({ atalho: true, volta: false });
    expect(naIdade.normal).toMatchObject({ atalho: false, volta: false });
    expect(porSid(await por(34, 'chegaram')).volta).toMatchObject({ atalho: false, volta: true });
  });

  it('a jornada mostra o evento com o rótulo certo e o tempo da tela 1 para no atalho', async () => {
    const a = (await request(app).get('/admin/monjour/quiz-funil/sessao/atalho')).body;
    expect(a.resumo).toMatchObject({ atalho: true, volta: false });
    expect(a.linha.map((l: { tipo: string; passo: string | null }) => `${l.tipo}:${l.passo}`)).toEqual(['viu:edad', 'atalho:atalho_oferta', 'viu:oferta']);
    expect(a.linha[1]).toMatchObject({ tipo: 'atalho', n: null, rotulo: 'Atalho para a oferta' });
    expect(a.linha[0].segundosNaTela).toBe(20); // da tela 1 (T0+10s) ao toque (T0+30s)
    const v = (await request(app).get('/admin/monjour/quiz-funil/sessao/volta')).body;
    expect(v.linha[0]).toMatchObject({ tipo: 'atalho', passo: 'volta_oferta', rotulo: 'Voltou direto para a oferta' });
  });
});
