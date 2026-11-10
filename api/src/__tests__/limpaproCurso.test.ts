import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─────────────────────────────────────────────────────────────────────────────
// LIMPAPRO DENTRO DO APP: /limpapro/curso, /limpapro/aulas/:slug e /limpapro/progresso.
//
// O conteúdo das aulas é pago e o repositório é público: as aulas deste teste são texto de mentira. O que se prova:
//   - sem acesso, a aula dá 403 (e a lista não traz nada do curso);
//   - bônus sem o plano Completo dá 403; com ele, abre;
//   - liberação atrasada (anti-reembolso) dá 403 até a data;
//   - o progresso grava no formato da área de membros ("m01#0": true) e NÃO apaga as outras chaves;
//   - quem tem acesso mas não tem linha em limpapro_membros ganha a linha na primeira abertura;
//   - o html sai sem script, sem on*, sem javascript:, a prova sai como dado e a foto aponta para o app.
// ─────────────────────────────────────────────────────────────────────────────

// A RPC `limpapro_progresso_set` ainda nao existe no banco: por padrao ela "nao existe" (PGRST202) e a api cai no caminho
// antigo. Um teste liga uma versao falsa para provar o caminho atomico.
const rpc = vi.hoisted(() => ({
  impl: null as null | ((fn: string, args: Record<string, any>) => { data: any; error: any }),
  chamadas: [] as Array<{ fn: string; args: Record<string, any> }>,
}));
vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return {
    supabase: {
      from: supabaseFalso.from,
      rpc: async (fn: string, args: Record<string, any>) => {
        rpc.chamadas.push({ fn, args });
        return rpc.impl ? rpc.impl(fn, args) : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      },
    },
  };
});
// A autenticação real é o JWT; aqui o id da conta vem do cabeçalho x-teste-user.
vi.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.userId = String(req.headers['x-teste-user'] || ''); next(); },
}));

import { db, limpar, semear } from './helpers/dbFalso';
import limpaproRoutes from '../routes/limpapro';
import { prepararAula } from '../services/limpapro/aulaHtml';

const app = express();
app.use(express.json());
app.use('/limpapro', limpaproRoutes);

const EMAIL = 'aluno@empresa.com.br';
const DIA = 24 * 60 * 60 * 1000;
const haDias = (n: number) => new Date(Date.now() - n * DIA).toISOString();

function conta(over: Record<string, any> = {}) {
  return semear('users', { email: EMAIL, nome: 'Aluno Teste', whatsapp: null, is_admin: false, ...over });
}
function aula(slug: string, over: Record<string, any> = {}) {
  return semear('limpapro_aulas', {
    slug, grupo: 'modulo', modulo: 1, ordem: 1, titulo: `Aula ${slug}`, resumo: 'Resumo de mentira', minutos: 5,
    html: '<div class="aula-p">Texto de mentira</div>', bonus: false, requer: 'curso-principal', libera_apos_dias: 0, ...over,
  });
}
const aluno = (over: Record<string, any> = {}) => semear('limpapro_membros', {
  email: EMAIL, nome: 'Aluno Teste', telefone: null, ativo: true, progresso: {}, criado_em: haDias(30), ...over,
});
const item = (nome: string, email = EMAIL) => semear('limpapro_entitlements', { email, item: nome, ativo: true });
const quem = (u: any) => ({ 'x-teste-user': u.id });

beforeEach(() => {
  limpar('users', 'limpapro_aulas', 'limpapro_membros', 'limpapro_entitlements');
  rpc.impl = null; rpc.chamadas.length = 0;
  aula('m01'); aula('m02', { ordem: 2, modulo: 2 });
  aula('m05', { ordem: 5, modulo: 5, libera_apos_dias: 7 });
  aula('scripts', { grupo: 'bonus', modulo: null, ordem: 8, bonus: true, requer: 'premium', libera_apos_dias: 7 });
  aula('usina', { grupo: 'extra', modulo: null, ordem: 10, requer: 'usina' });
});

describe('GET /limpapro/aulas/:slug', () => {
  it('sem acesso, a aula dá 403 e não entrega o conteúdo', async () => {
    const u = conta();
    const r = await request(app).get('/limpapro/aulas/m01').set(quem(u));
    expect(r.status).toBe(403);
    expect(r.body.motivo).toBe('sem_acesso');
    expect(JSON.stringify(r.body)).not.toContain('Texto de mentira');
  });

  it('com a compra, abre', async () => {
    const u = conta(); aluno(); item('curso-principal');
    const r = await request(app).get('/limpapro/aulas/m01').set(quem(u));
    expect(r.status).toBe(200);
    expect(r.body.html).toContain('Texto de mentira');
  });

  it('bônus sem o plano Completo dá 403, mesmo com a janela de 7 dias vencida', async () => {
    const u = conta(); aluno(); item('curso-principal');
    const r = await request(app).get('/limpapro/aulas/scripts').set(quem(u));
    expect(r.status).toBe(403);
    expect(r.body.motivo).toBe('premium');
    expect(r.body.error).toBe('Este bônus é do plano Completo.');
  });

  it('bônus com o plano Completo abre', async () => {
    const u = conta(); aluno(); item('curso-principal'); item('premium');
    const r = await request(app).get('/limpapro/aulas/scripts').set(quem(u));
    expect(r.status).toBe(200);
  });

  it('liberação atrasada: m05 dá 403 até 7 dias depois da compra e abre depois', async () => {
    const u = conta(); const m = aluno({ criado_em: haDias(2) }); item('curso-principal');
    const cedo = await request(app).get('/limpapro/aulas/m05').set(quem(u));
    expect(cedo.status).toBe(403);
    expect(cedo.body.motivo).toBe('espera');
    expect(typeof cedo.body.liberaEm).toBe('string');
    m.criado_em = haDias(8);
    const tarde = await request(app).get('/limpapro/aulas/m05').set(quem(u));
    expect(tarde.status).toBe(200);
  });

  it('extra vendido à parte só abre com o item', async () => {
    const u = conta(); aluno(); item('curso-principal');
    expect((await request(app).get('/limpapro/aulas/usina').set(quem(u))).status).toBe(403);
    item('usina');
    expect((await request(app).get('/limpapro/aulas/usina').set(quem(u))).status).toBe(200);
  });

  it('aula que não existe dá 404 e slug esquisito é recusado', async () => {
    const u = conta(); aluno(); item('curso-principal');
    expect((await request(app).get('/limpapro/aulas/nao-existe').set(quem(u))).status).toBe(404);
    expect((await request(app).get('/limpapro/aulas/..%2Fx').set(quem(u))).status).toBe(404);
  });

  it('acha o aluno pelo WhatsApp quando o e-mail da conta é outro', async () => {
    const u = conta({ email: 'outro@empresa.com.br', whatsapp: '(34) 90000-1234' });
    aluno({ telefone: '5534900001234' });
    const r = await request(app).get('/limpapro/aulas/m01').set(quem(u));
    expect(r.status).toBe(200);
  });
});

describe('GET /limpapro/curso', () => {
  it('sem acesso, devolve só acesso:false (nada do curso)', async () => {
    const u = conta();
    const r = await request(app).get('/limpapro/curso').set(quem(u));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ acesso: false });
  });

  it('lista as aulas SEM o html, com cadeado no bônus, e esconde extra que a pessoa não tem', async () => {
    const u = conta(); aluno({ progresso: { 'm01#0': true } }); item('curso-principal');
    const r = await request(app).get('/limpapro/curso').set(quem(u));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('Texto de mentira');
    const por = Object.fromEntries(r.body.aulas.map((a: any) => [a.slug, a]));
    expect(por.m01.feita).toBe(true);
    expect(por.scripts.bloqueio).toBe('premium');
    expect(por.usina).toBeUndefined();
    expect(r.body.modulosFeitos).toBe(1);
    expect(r.body.modulosTotal).toBe(3);
    expect(r.body.certificado.liberado).toBe(false);
  });
});

describe('POST /limpapro/progresso', () => {
  it('grava no formato da área de membros e NÃO apaga as outras chaves', async () => {
    const u = conta();
    const m = aluno({ progresso: { 'm02#0': true, 'chk:plano-7-dias:1': true, 'b00#0': true } });
    item('curso-principal');
    const r = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: true });
    expect(r.status).toBe(200);
    expect(m.progresso).toEqual({ 'm02#0': true, 'chk:plano-7-dias:1': true, 'b00#0': true, 'm01#0': true });
    // desmarcar tira só a chave dela
    await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: false });
    expect(m.progresso).toEqual({ 'm02#0': true, 'chk:plano-7-dias:1': true, 'b00#0': true });
  });

  it('item de checklist grava "chk:<aula>:<n>" sem mexer no resto', async () => {
    const u = conta();
    const m = aluno({ progresso: { 'm01#0': true } }); item('curso-principal');
    const r = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', item: 2, marcado: true });
    expect(r.status).toBe(200);
    expect(m.progresso).toEqual({ 'm01#0': true, 'chk:m01:2': true });
  });

  it('sem acesso dá 403 e não grava nada', async () => {
    const u = conta(); const m = aluno({ ativo: false, progresso: {} });
    const r = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: true });
    expect(r.status).toBe(403);
    expect(m.progresso).toEqual({});
  });

  it('bônus sem o plano Completo dá 403 e não grava', async () => {
    const u = conta(); const m = aluno({ progresso: {} }); item('curso-principal');
    const r = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'scripts', concluida: true });
    expect(r.status).toBe(403);
    expect(m.progresso).toEqual({});
  });

  it('corpo inválido dá 400', async () => {
    const u = conta(); aluno(); item('curso-principal');
    expect((await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01' })).status).toBe(400);
    expect((await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'M 01!', concluida: true })).status).toBe(400);
    expect((await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: 'sim' })).status).toBe(400);
  });

  it('quem tem acesso só por entitlement ganha a linha em limpapro_membros e o progresso grava nela', async () => {
    const u = conta({ whatsapp: null });
    item('curso-principal');
    expect(db.limpapro_membros ?? []).toHaveLength(0);
    const r = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: true });
    expect(r.status).toBe(200);
    expect(db.limpapro_membros).toHaveLength(1);
    expect(db.limpapro_membros[0]).toMatchObject({ email: EMAIL, ativo: true, progresso: { 'm01#0': true } });
  });

  it('com os 5 módulos feitos: sem o plano Completo o certificado não libera; com ele, libera com o link', async () => {
    const u = conta();
    db.limpapro_aulas = [];
    for (let i = 1; i <= 5; i++) aula(`m0${i}`, { ordem: i, modulo: i });
    aluno({ progresso: { 'm01#0': true, 'm02#0': true, 'm03#0': true, 'm04#0': true } }); item('curso-principal');
    const sem = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm05', concluida: true });
    expect(sem.status).toBe(200);
    expect(sem.body.modulosFeitos).toBe(5);
    expect(sem.body.certificado).toEqual({ liberado: false, motivo: 'plano' });
    item('premium');
    const com = await request(app).get('/limpapro/curso').set(quem(u));
    expect(com.body.certificado.liberado).toBe(true);
    expect(com.body.certificado.url).toContain('certificado.html?nome=Aluno%20Teste');
  });
});

describe('premium, extras e telefone dividido', () => {
  it('premium NAO abre os extras: usina exige o item usina', async () => {
    const u = conta(); aluno(); item('curso-principal'); item('premium');
    const r = await request(app).get('/limpapro/aulas/usina').set(quem(u));
    expect(r.status).toBe(403);
    expect(r.body.motivo).toBe('item');
    const p = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'usina', concluida: true });
    expect(p.status).toBe(403);
  });

  it('conta A (compra por e-mail) com o mesmo telefone do membro B nao herda os itens de B e grava na PROPRIA linha', async () => {
    const A = conta({ whatsapp: '(34) 90000-1234' });
    const B = aluno({ email: 'b@empresa.com.br', nome: 'B', telefone: '5534900001234', progresso: { 'm02#0': true } });
    item('premium', 'b@empresa.com.br'); item('usina', 'b@empresa.com.br'); item('curso-principal', 'b@empresa.com.br');
    item('curso-principal'); // A tem compra propria, mas ainda nao tem linha
    expect((await request(app).get('/limpapro/aulas/scripts').set(quem(A))).status).toBe(403);
    expect((await request(app).get('/limpapro/aulas/usina').set(quem(A))).status).toBe(403);
    const r = await request(app).post('/limpapro/progresso').set(quem(A)).send({ aula: 'm01', concluida: true });
    expect(r.status).toBe(200);
    expect(B.progresso).toEqual({ 'm02#0': true });
    const propria = db.limpapro_membros.find((m) => m.email === EMAIL)!;
    expect(propria.progresso).toEqual({ 'm01#0': true });
    // o progresso de B nao aparece para A
    const lista = await request(app).get('/limpapro/curso').set(quem(A));
    expect(lista.body.aulas.find((a: any) => a.slug === 'm02').feita).toBe(false);
  });

  it('conta sem e-mail, com acesso so pelo telefone: le, nao grava na linha de outra pessoa e nao ganha a janela dela', async () => {
    const C = conta({ email: '', whatsapp: '(34) 90000-1234' });
    const B = aluno({ email: 'b@empresa.com.br', telefone: '5534900001234', progresso: { 'm02#0': true }, criado_em: haDias(30) });
    item('curso-principal', 'b@empresa.com.br');
    expect((await request(app).get('/limpapro/aulas/m01').set(quem(C))).status).toBe(200);
    const w = await request(app).post('/limpapro/progresso').set(quem(C)).send({ aula: 'm01', concluida: true });
    expect(w.status).toBe(200);
    expect(w.body.salvo).toBe(false);
    expect(B.progresso).toEqual({ 'm02#0': true });
    // m05 tem janela de 7 dias: sem linha propria ela fica fechada (a de B tem 30 dias e nao vale para C)
    expect((await request(app).get('/limpapro/aulas/m05').set(quem(C))).status).toBe(403);
    expect(db.limpapro_membros).toHaveLength(1);
  });

  it('administrador abre tudo e nao cria linha em limpapro_membros', async () => {
    const adm = conta({ is_admin: true });
    expect((await request(app).get('/limpapro/aulas/usina').set(quem(adm))).status).toBe(200);
    expect((await request(app).get('/limpapro/aulas/scripts').set(quem(adm))).status).toBe(200);
    const w = await request(app).post('/limpapro/progresso').set(quem(adm)).send({ aula: 'm01', concluida: true });
    expect(w.status).toBe(200);
    expect(w.body.salvo).toBe(false);
    expect(db.limpapro_membros ?? []).toHaveLength(0);
  });
});

describe('progresso: RPC atomica e teto de chaves', () => {
  it('com a RPC no banco, grava por ela (marcar e desmarcar) e usa o objeto que ela devolve', async () => {
    const u = conta(); aluno({ progresso: { 'm02#0': true } }); item('curso-principal');
    rpc.impl = (_fn, a) => {
      const m = db.limpapro_membros.find((x) => x.email === a.p_email)!;
      const novo = { ...m.progresso }; if (a.p_valor) novo[a.p_chave] = true; else delete novo[a.p_chave];
      m.progresso = novo; return { data: novo, error: null };
    };
    const r = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: true });
    expect(r.status).toBe(200);
    expect(rpc.chamadas[0]).toEqual({ fn: 'limpapro_progresso_set', args: { p_email: EMAIL, p_chave: 'm01#0', p_valor: true } });
    expect(r.body.progresso).toEqual({ 'm02#0': true, 'm01#0': true });
    await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: false });
    expect(rpc.chamadas[1].args.p_valor).toBe(false);
    expect(db.limpapro_membros[0].progresso).toEqual({ 'm02#0': true });
  });

  it('teto de 200 chaves: marcar chave nova recusa (409); desmarcar nunca falha', async () => {
    const u = conta(); item('curso-principal');
    const cheio: Record<string, boolean> = {};
    for (let i = 0; i < 200; i++) cheio[`x${i}#0`] = true;
    const m = aluno({ progresso: { ...cheio, 'm01#0': true } }); // 201 chaves: ja passou do teto
    const marcar = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm02', concluida: true });
    expect(marcar.status).toBe(409);
    const desmarcar = await request(app).post('/limpapro/progresso').set(quem(u)).send({ aula: 'm01', concluida: false });
    expect(desmarcar.status).toBe(200);
    expect(m.progresso['m01#0']).toBeUndefined();
    expect(Object.keys(m.progresso)).toHaveLength(200);
  });
});

describe('html da aula', () => {
  it('sai sem script, sem on*, sem javascript:, a prova vira dado e a foto aponta para o app', () => {
    const bruto = `<div class="aula-wrap" onclick="roubar()">
      <p class="aula-p">Oi <script>alert(1)</script><b onmouseover="x()">negrito</b></p>
      <a href="javascript:alert(2)">link</a>
      <iframe src="https://mau.example"></iframe>
      <figure class="aula-fig"><img src="assets/fotos/sujo-limpo.webp" alt="foto" onerror="y()"></figure>
      <script type="application/json" class="quiz-json">[{"q":"Pergunta <b>1</b>?","o":["A","B"],"c":1},{"q":"Sem resposta","o":["so uma"],"c":0},{"q":"Fora","o":["A","B"],"c":9}]</script>
      <div class="quiz-mount"></div></div>`;
    const { html, quiz } = prepararAula(bruto);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick|onmouseover|onerror/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).toContain('Oi');
    expect(html).toContain('<b');
    expect(html).toContain('src="/limpapro/fotos/sujo-limpo.webp"');
    expect(html).not.toContain('assets/fotos');
    expect(quiz).toEqual([{ q: 'Pergunta 1?', o: ['A', 'B'], c: 1 }]);
  });

  it('a rota devolve o html limpo e a prova separada', async () => {
    const u = conta(); aluno(); item('curso-principal');
    db.limpapro_aulas = [];
    aula('m01', {
      html: '<p class="aula-p" onclick="x()">Oi</p><script>alert(1)</script><script type="application/json" class="quiz-json">[{"q":"P?","o":["A","B"],"c":0}]</script>',
    });
    const r = await request(app).get('/limpapro/aulas/m01').set(quem(u));
    expect(r.status).toBe(200);
    expect(r.body.html).toContain('Oi');
    expect(r.body.html).not.toMatch(/<script|onclick/i);
    expect(r.body.quiz).toEqual([{ q: 'P?', o: ['A', 'B'], c: 0 }]);
  });
});
