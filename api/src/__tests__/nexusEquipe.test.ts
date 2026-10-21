import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { banco } from './_bancoFalso';
import { U1, U2, U3, app, bearer, empresaDaConta, equipeAuth, naoSocioAuth, receita, semearParceiro, tokensDeConsultor } from './_nexusAjuda';

// v4: a equipe do Portal NEXUS entra por DOIS logins (token do Gerador OU JWT do SolarDoc de admin/equipe). Aqui: o
// middleware exigeEquipeNexus (inclusive token forjado, alg:none, expirado, outro segredo), /adm/eu, os membros da equipe,
// o funil, o convite que exige sócio pelos dois logins, o `adm` do /eu e a origem link_cadastro. Nada sai para a rede.

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const consultor = vi.hoisted(() => ({ tokens: {} as Record<string, { email: string; confirmado: boolean }> }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const u = consultor.tokens[token];
        if (!u) return { data: { user: null }, error: { message: 'jwt inválido' } };
        return { data: { user: { email: u.email, email_confirmed_at: u.confirmado ? '2026-01-01T00:00:00Z' : null } }, error: null };
      }),
    },
    from: () => {
      const q: any = { select: () => q, eq: () => q, ilike: () => q, gte: () => q, order: () => q, range: () => Promise.resolve({ data: [], error: null }), limit: () => Promise.resolve({ data: [], error: null }) };
      return q;
    },
  },
}));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async () => undefined) }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => undefined) }));

import { JWT_SECRET, signToken } from '../utils/jwt';
import { origemValida, resetSondaPortal } from '../services/nexus/repositorio';
import { calcularFunil } from '../routes/geradorNexusAdm';

const ADM = '00000000-0000-4000-8000-0000000000a1'; // is_admin
const MEM = '00000000-0000-4000-8000-0000000000b1'; // conta comum
const THI = '00000000-0000-4000-8000-0000000000c1'; // nome de sócio, e-mail de fora
const sol = (uid: string) => ({ Authorization: `Bearer ${signToken(uid)}` });
const com = (token: string) => ({ Authorization: `Bearer ${token}` });
const ausente = { erro: { code: '42P01', message: 'relation "public.nexus_equipe" does not exist' } };

function usuario(id: string, email: string, extra: Record<string, unknown> = {}) {
  banco.poe('users', { id, email, nome: email.split('@')[0], is_admin: false, ...extra });
}
let seq = 0;
function membro(email: string, papel: 'admin' | 'socio', ativo = true, user_id?: string | null) {
  const id = `00000000-0000-4000-a100-${String(++seq).padStart(12, '0')}`;
  // Sem user_id explícito, a linha nasce presa à conta do SolarDoc com esse e-mail (como o POST faz).
  const dono = user_id !== undefined ? user_id : (banco.linhas('users').find((u) => String(u.email).trim().toLowerCase() === email.toLowerCase())?.id ?? null);
  banco.poe('nexus_equipe', { id, email, user_id: dono, papel, ativo, criado_por: 'x', created_at: `2026-10-0${(seq % 9) + 1}T10:00:00Z`, updated_at: '2026-10-01T10:00:00Z' });
  return id;
}

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  resetSondaPortal();
  consultor.tokens = { ...tokensDeConsultor(), tx: { email: 'alguem@gmail.com', confirmado: true }, tu: { email: 'nova@irmaosnaobra.app', confirmado: false } };
  delete process.env.SOLAR_SOCIOS;
  process.env.NEXUS_CONVITE_INTERVALO_MS = '0';
  usuario(ADM, 'dono@exemplo.com', { is_admin: true });
  usuario(MEM, 'membro@exemplo.com');
  receita('ativa');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.NEXUS_CONVITE_INTERVALO_MS; });

const admEu = (h: Record<string, string>) => request(app()).get('/gerador/nexus/adm/eu').set(h);

describe('exigeEquipeNexus: os dois logins', () => {
  it('token do Gerador de sócio: entra, via gerador, sócio e gere equipe', async () => {
    const r = await admEu(equipeAuth);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, email: 'thiago@irmaosnaobra.app', nome: 'thiago', socio: true, gerirEquipe: true, via: 'gerador' });
  });

  it('token do Gerador de consultor que não é sócio: entra, mas sem sócio e sem gerir equipe', async () => {
    const r = await admEu(naoSocioAuth);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ email: 'ana@irmaosnaobra.app', socio: false, gerirEquipe: false, via: 'gerador' });
  });

  it('token do Gerador de e-mail de fora ou não confirmado: 403 (regra do exigeConsultor)', async () => {
    expect((await admEu(com('tx'))).status).toBe(403);
    expect((await admEu(com('tu'))).status).toBe(403);
  });

  it('JWT do SolarDoc com is_admin: entra, via solardoc, sócio e gere equipe', async () => {
    const r = await admEu(sol(ADM));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, email: 'dono@exemplo.com', nome: 'dono', socio: true, gerirEquipe: true, via: 'solardoc' });
  });

  it('JWT do SolarDoc comum SEM linha em nexus_equipe: 403 sem_acesso_adm', async () => {
    const r = await admEu(sol(MEM));
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('sem_acesso_adm');
  });

  it('JWT comum com linha INATIVA: 403; com linha ativa: 200, papel admin entra mas não é sócio e não gere equipe', async () => {
    const id = membro('membro@exemplo.com', 'admin', false);
    expect((await admEu(sol(MEM))).status).toBe(403);
    banco.linhas('nexus_equipe').find((m) => m.id === id)!.ativo = true;
    const r = await admEu(sol(MEM));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ socio: false, gerirEquipe: false, via: 'solardoc' });
  });

  it('JWT comum com papel socio: sócio e gere equipe', async () => {
    membro('membro@exemplo.com', 'socio');
    expect((await admEu(sol(MEM))).body).toMatchObject({ socio: true, gerirEquipe: true });
  });

  it('linha da equipe com user_id DIFERENTE do JWT (ou sem user_id) não entra, mesmo com o e-mail igual e ativa', async () => {
    const id = membro('membro@exemplo.com', 'socio', true, U2);
    const r = await admEu(sol(MEM));
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('sem_acesso_adm');
    banco.linhas('nexus_equipe').find((m) => m.id === id)!.user_id = null;
    expect((await admEu(sol(MEM))).status).toBe(403);
    banco.linhas('nexus_equipe').find((m) => m.id === id)!.user_id = MEM;
    expect((await admEu(sol(MEM))).status).toBe(200);
  });

  it('o e-mail da equipe vale em qualquer caixa e com espaços', async () => {
    banco.linhas('users').find((u) => u.id === MEM)!.email = ' Membro@Exemplo.COM ';
    membro('membro@exemplo.com', 'admin');
    expect((await admEu(sol(MEM))).status).toBe(200);
  });

  it('sem token, token lixo e chave publishable: 401', async () => {
    expect((await request(app()).get('/gerador/nexus/adm/eu')).status).toBe(401);
    expect((await admEu(com('lixo'))).status).toBe(401);
    expect((await admEu(com('sb_publishable_abc'))).status).toBe(401);
  });

  it('JWT assinado com OUTRO segredo (userId de um admin): 401', async () => {
    const forjado = jwt.sign({ userId: ADM }, 'outro-segredo-qualquer-0123456789', { expiresIn: '7d' });
    const r = await admEu(com(forjado));
    expect(r.status).toBe(401);
    const e = await request(app()).get('/gerador/nexus/equipe/parceiros').set(com(forjado));
    expect(e.status).toBe(401);
  });

  it('JWT com alg:none (sem assinatura) de um admin: 401', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const semAssinatura = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: ADM })}.`;
    expect((await admEu(com(semAssinatura))).status).toBe(401);
    expect((await admEu(com(`${semAssinatura}x`))).status).toBe(401);
  });

  it('JWT do SolarDoc expirado: 401', async () => {
    const velho = jwt.sign({ userId: ADM, exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET);
    expect((await admEu(com(velho))).status).toBe(401);
  });

  it('JWT assinado com o segredo certo, mas com algoritmo HS512 ou sem userId UUID: 401', async () => {
    expect((await admEu(com(jwt.sign({ userId: ADM }, JWT_SECRET, { algorithm: 'HS512' })))).status).toBe(401);
    expect((await admEu(com(jwt.sign({ userId: 'nao-e-uuid' }, JWT_SECRET)))).status).toBe(401);
    expect((await admEu(com(jwt.sign({ sub: ADM }, JWT_SECRET)))).status).toBe(401);
  });

  it('JWT válido de conta que não existe mais: 401. Erro do banco ao ler a conta: 500, nunca acesso', async () => {
    expect((await admEu(sol('00000000-0000-4000-8000-0000000000ff'))).status).toBe(401);
    banco.falhas['users.select'] = { erro: { code: 'XX000', message: 'banco caiu' } };
    const r = await admEu(sol(ADM));
    expect(r.status).toBe(500);
    expect(r.body.ok).toBeUndefined();
  });

  it('token do Gerador nunca vira acesso pela porta do SolarDoc e vice-versa: o JWT do SolarDoc de admin não passa por consultor', async () => {
    // O JWT do SolarDoc não é conhecido do Supabase do Gerador: só entra pela porta do SolarDoc.
    const r = await admEu(sol(ADM));
    expect(r.body.via).toBe('solardoc');
    // E um token que o Gerador conhece não precisa ser JWT do SolarDoc: via gerador.
    expect((await admEu(equipeAuth)).body.via).toBe('gerador');
  });

  it('tabela nexus_equipe ausente: is_admin entra, conta comum 403, e o portal CONTINUA ligado', async () => {
    banco.falhas['nexus_equipe.select'] = ausente;
    expect((await admEu(sol(ADM))).status).toBe(200);
    expect((await admEu(sol(MEM))).status).toBe(403);
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: true });
    const m = await request(app()).get('/gerador/nexus/equipe/membros').set(sol(ADM));
    expect(m.status).toBe(200);
    expect(m.body).toEqual({ membros: [] });
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: true });
  });

  it('erro do banco que não é tabela ausente na leitura da equipe: 500, nunca acesso', async () => {
    banco.falhas['nexus_equipe.select'] = { erro: { code: 'XX000', message: 'banco caiu' } };
    expect((await admEu(sol(MEM))).status).toBe(500);
  });

  it('portal desligado (tabelas do portal ausentes): 401 e 403 vêm primeiro; quem tem acesso recebe 503 portal_desligado', async () => {
    banco.falhas['nexus_parceiros.select'] = { erro: { code: '42P01', message: 'relation "nexus_parceiros" does not exist' } };
    expect((await request(app()).get('/gerador/nexus/adm/eu')).status).toBe(401);
    expect((await admEu(sol(MEM))).status).toBe(403);
    const r = await admEu(sol(ADM));
    expect(r.status).toBe(503);
    expect(r.body.erro).toBe('portal_desligado');
  });
});

describe('rotas da equipe com os dois logins', () => {
  it('GET /equipe/parceiros: JWT de admin entra; JWT comum 403; sem token 401', async () => {
    semearParceiro(U1);
    const ok = await request(app()).get('/gerador/nexus/equipe/parceiros').set(sol(ADM));
    expect(ok.status).toBe(200);
    expect(ok.body.parceiros).toHaveLength(1);
    expect((await request(app()).get('/gerador/nexus/equipe/parceiros').set(sol(MEM))).status).toBe(403);
    expect((await request(app()).get('/gerador/nexus/equipe/parceiros')).status).toBe(401);
  });

  it('PATCH de parceiro pelo JWT do SolarDoc de admin grava (partner)', async () => {
    const p = semearParceiro(U1);
    const r = await request(app()).patch(`/gerador/nexus/equipe/parceiros/${p.id}`).set(sol(ADM)).send({ partner: true });
    expect(r.status).toBe(200);
    expect(banco.linhas('nexus_parceiros')[0]!.partner_em).toBeTruthy();
  });

  it('o criado_por de uma oportunidade criada pelo SolarDoc é o e-mail da conta', async () => {
    const r = await request(app()).post('/gerador/nexus/equipe/oportunidades').set(sol(ADM))
      .send({ tipo: 'cliente', cidade: 'Araguari', uf: 'MG', descricao: 'Posto com 2 vagas.', prazo_aceite: new Date(Date.now() + 86_400_000).toISOString() });
    expect(r.status).toBe(201);
    expect(r.body.oportunidade.criado_por).toBe('dono@exemplo.com');
  });
});

describe('convite por e-mail exige sócio pelos dois logins', () => {
  const previa = (h: Record<string, string>) => request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(h);

  it('Gerador: sócio passa, consultor não sócio 403 so_socio', async () => {
    expect((await previa(equipeAuth)).status).toBe(200);
    const r = await previa(naoSocioAuth);
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('so_socio');
  });

  it('SolarDoc: is_admin passa; papel socio passa; papel admin e conta comum não', async () => {
    expect((await previa(sol(ADM))).status).toBe(200);
    membro('membro@exemplo.com', 'socio');
    expect((await previa(sol(MEM))).status).toBe(200);
    banco.linhas('nexus_equipe')[0]!.papel = 'admin';
    const r = await previa(sol(MEM));
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('so_socio');
  });

  it('conta do SolarDoc com NOME de sócio (thiago@fora.com) e papel admin: 403 so_socio, e no POST de envio também', async () => {
    usuario(THI, 'thiago@exemplo.com');
    membro('thiago@exemplo.com', 'admin');
    expect((await previa(sol(THI))).body.erro).toBe('so_socio');
    const env = await request(app()).post('/gerador/nexus/equipe/convites/email/enviar').set(sol(THI)).send({ confirmar: true });
    expect(env.status).toBe(403);
    expect(env.body.erro).toBe('so_socio');
  });
});

describe('membros da equipe', () => {
  const lista = (h: Record<string, string>) => request(app()).get('/gerador/nexus/equipe/membros').set(h);
  const novo = (h: Record<string, string>, corpo: unknown) => request(app()).post('/gerador/nexus/equipe/membros').set(h).send(corpo as object);
  const altera = (h: Record<string, string>, id: string, corpo: unknown) => request(app()).patch(`/gerador/nexus/equipe/membros/${id}`).set(h).send(corpo as object);

  it('GET: qualquer da equipe vê a lista com as chaves do contrato', async () => {
    membro('a@exemplo.com', 'admin');
    const r = await lista(naoSocioAuth);
    expect(r.status).toBe(200);
    expect(r.body.membros).toHaveLength(1);
    expect(Object.keys(r.body.membros[0]).sort()).toEqual(['ativo', 'created_at', 'criado_por', 'email', 'id', 'papel', 'user_id']);
    expect((await lista(sol(MEM))).status).toBe(403);
  });

  it('POST: quem gere adiciona (e-mail em minúsculas, criado_por = quem adicionou); consultor não sócio 403', async () => {
    usuario(U2, 'novo.nome@exemplo.com');
    const r = await novo(sol(ADM), { email: '  Novo.Nome@Exemplo.COM ', papel: 'socio' });
    expect(r.status).toBe(201);
    expect(r.body.membro).toMatchObject({ email: 'novo.nome@exemplo.com', papel: 'socio', ativo: true, criado_por: 'dono@exemplo.com' });
    expect(banco.linhas('nexus_equipe')).toHaveLength(1);
    const n = await novo(naoSocioAuth, { email: 'x@exemplo.com', papel: 'admin' });
    expect(n.status).toBe(403);
    expect(n.body.erro).toBe('sem_permissao');
    expect(banco.linhas('nexus_equipe')).toHaveLength(1);
  });

  it('POST: e-mail SEM conta em users dá 409 sem_conta e nada é gravado', async () => {
    const r = await novo(sol(ADM), { email: 'ninguem@exemplo.com', papel: 'admin' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('sem_conta');
    expect(banco.linhas('nexus_equipe')).toHaveLength(0);
  });

  it('POST: grava o user_id da conta; reativar atualiza o user_id para a conta atual do e-mail', async () => {
    const r = await novo(sol(ADM), { email: 'membro@exemplo.com', papel: 'admin' });
    expect(r.body.membro.user_id).toBe(MEM);
    banco.linhas('nexus_equipe')[0]!.user_id = U2; // conta antiga
    banco.linhas('nexus_equipe')[0]!.ativo = false;
    const b = await novo(sol(ADM), { email: 'membro@exemplo.com', papel: 'admin' });
    expect(b.status).toBe(200);
    expect(b.body.membro).toMatchObject({ user_id: MEM, ativo: true });
    expect((await admEu(sol(MEM))).status).toBe(200);
  });

  it('POST: papel admin de nexus_equipe não gere equipe', async () => {
    membro('membro@exemplo.com', 'admin');
    expect((await novo(sol(MEM), { email: 'x@exemplo.com', papel: 'admin' })).status).toBe(403);
  });

  it('POST pelo Gerador (sócio) grava com o e-mail do consultor em criado_por', async () => {
    usuario(U2, 'pessoa@exemplo.com');
    const r = await novo(equipeAuth, { email: 'pessoa@exemplo.com', papel: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.membro.criado_por).toBe('thiago@irmaosnaobra.app');
  });

  it('POST: e-mail repetido reativa e troca o papel, sem criar outra linha', async () => {
    usuario(U2, 'velho@exemplo.com');
    const id = membro('velho@exemplo.com', 'admin', false);
    const r = await novo(sol(ADM), { email: 'VELHO@exemplo.com', papel: 'socio' });
    expect(r.status).toBe(200);
    expect(r.body.membro).toMatchObject({ id, ativo: true, papel: 'socio' });
    expect(banco.linhas('nexus_equipe')).toHaveLength(1);
  });

  it('POST: e-mail e papel inválidos são 400 e nada é gravado', async () => {
    for (const corpo of [{ email: 'sem-arroba', papel: 'admin' }, { email: '', papel: 'admin' }, { email: 'a@b', papel: 'admin' }, { email: 'a@exemplo.com', papel: 'dono' }, { email: 'a@exemplo.com' }, {}]) {
      expect((await novo(sol(ADM), corpo)).status).toBe(400);
    }
    expect(banco.linhas('nexus_equipe')).toHaveLength(0);
  });

  it('POST sem a tabela: 503 equipe_sem_tabela (não portal_desligado) e o portal segue ligado', async () => {
    banco.falhas['nexus_equipe.select'] = ausente;
    banco.falhas['nexus_equipe.insert'] = ausente;
    usuario(U2, 'x@exemplo.com');
    const r = await novo(sol(ADM), { email: 'x@exemplo.com', papel: 'admin' });
    expect(r.status).toBe(503);
    expect(r.body.erro).toBe('equipe_sem_tabela');
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: true });
  });

  it('PATCH: desativa, reativa e troca o papel de OUTRO membro', async () => {
    usuario(U2, 'outro@exemplo.com');
    const id = membro('outro@exemplo.com', 'admin');
    const a = await altera(sol(ADM), id, { ativo: false });
    expect(a.status).toBe(200);
    expect(a.body.membro.ativo).toBe(false);
    const b = await altera(sol(ADM), id, { ativo: true, papel: 'socio' });
    expect(b.body.membro).toMatchObject({ ativo: true, papel: 'socio' });
  });

  it('PATCH: ninguém desativa o PRÓPRIO acesso (SolarDoc com papel socio e Gerador), e a linha segue ativa', async () => {
    const meu = membro('membro@exemplo.com', 'socio');
    const r = await altera(sol(MEM), meu, { ativo: false });
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('nao_pode_desativar_a_si_mesmo');
    const dele = membro('thiago@irmaosnaobra.app', 'socio');
    expect((await altera(equipeAuth, dele, { ativo: false })).status).toBe(409);
    expect(banco.linhas('nexus_equipe').every((m) => m.ativo === true)).toBe(true);
  });

  it('PATCH: reativar regrava o user_id com a conta atual do e-mail; sem conta, 409 sem_conta e a linha fica como estava', async () => {
    usuario(U2, 'volta@exemplo.com');
    const id = membro('volta@exemplo.com', 'admin', false, U3); // conta antiga
    const r = await altera(sol(ADM), id, { ativo: true });
    expect(r.status).toBe(200);
    expect(r.body.membro).toMatchObject({ ativo: true, user_id: U2 });
    expect(banco.linhas('nexus_equipe')[0]!.user_id).toBe(U2);

    const sem = membro('sumiu@exemplo.com', 'admin', false, U3);
    const s = await altera(sol(ADM), sem, { ativo: true });
    expect(s.status).toBe(409);
    expect(s.body.erro).toBe('sem_conta');
    expect(banco.linhas('nexus_equipe').find((m) => m.id === sem)).toMatchObject({ ativo: false, user_id: U3 });
    // desativar não exige conta
    expect((await altera(sol(ADM), id, { ativo: false })).status).toBe(200);
  });

  it('PATCH: ninguém muda o PRÓPRIO papel (SolarDoc e Gerador); o de outro muda', async () => {
    const meu = membro('membro@exemplo.com', 'socio');
    const r = await altera(sol(MEM), meu, { papel: 'admin' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('nao_pode_mudar_o_proprio_papel');
    const dele = membro('thiago@irmaosnaobra.app', 'socio');
    expect((await altera(equipeAuth, dele, { papel: 'admin' })).status).toBe(409);
    expect(banco.linhas('nexus_equipe').every((m) => m.papel === 'socio')).toBe(true);
    const outro = membro('outro@exemplo.com', 'admin');
    expect((await altera(sol(MEM), outro, { papel: 'socio' })).status).toBe(200);
  });

  it('POST: acha a conta sem diferenciar maiúscula no e-mail gravado; _ e % do e-mail não viram curinga', async () => {
    usuario(U2, 'Antigo.Nome@Exemplo.com');
    const r = await novo(sol(ADM), { email: 'antigo.nome@exemplo.com', papel: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.membro.user_id).toBe(U2);

    usuario(U3, 'axb@exemplo.com');
    const c = await novo(sol(ADM), { email: 'a_b@exemplo.com', papel: 'admin' });
    expect(c.status).toBe(409);
    expect(c.body.erro).toBe('sem_conta');
    const p = await novo(sol(ADM), { email: 'a%@exemplo.com', papel: 'admin' });
    expect(p.status).toBe(409);
    expect(p.body.erro).toBe('sem_conta');
  });

  it('PATCH: sem permissão 403, id inválido ou inexistente 404, corpo vazio ou inválido 400', async () => {
    const id = membro('outro@exemplo.com', 'admin');
    expect((await altera(naoSocioAuth, id, { ativo: false })).status).toBe(403);
    expect((await altera(sol(ADM), 'nao-uuid', { ativo: false })).status).toBe(404);
    expect((await altera(sol(ADM), '00000000-0000-4000-a100-0000000000ff', { ativo: false })).status).toBe(404);
    expect((await altera(sol(ADM), id, {})).status).toBe(400);
    expect((await altera(sol(ADM), id, { ativo: 'nao' })).status).toBe(400);
    expect((await altera(sol(ADM), id, { papel: 'dono' })).status).toBe(400);
    expect(banco.linhas('nexus_equipe')[0]!.ativo).toBe(true);
  });
});

describe('GET /equipe/funil', () => {
  const funil = (q = '', h: Record<string, string> = sol(ADM)) => request(app()).get(`/gerador/nexus/equipe/funil${q}`).set(h);
  const parceiro = (n: number, extra: Record<string, unknown>) => banco.poe('nexus_parceiros', {
    id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`, user_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    origem: 'portal', uf: 'MG', carregadores_comprados: 0, created_at: '2026-10-10T12:00:00Z',
    perfil_completo_em: null, primeira_proposta_em: null, conversa_pedida_em: null, conversa_feita_em: null, partner_em: null, termo_aceito_em: null, ...extra,
  });
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  function semear() {
    const T = '2026-10-11T10:00:00Z';
    parceiro(1, { origem: 'portal', uf: 'MG', perfil_completo_em: T, primeira_proposta_em: T });
    parceiro(2, { origem: 'solardoc', uf: 'MG', perfil_completo_em: T, primeira_proposta_em: T, conversa_pedida_em: T, conversa_feita_em: T, partner_em: T, carregadores_comprados: 1, termo_aceito_em: T });
    parceiro(3, { origem: 'link_cadastro', uf: 'sp', perfil_completo_em: T, partner_em: T, carregadores_comprados: 5, termo_aceito_em: T, primeira_proposta_em: T });
    parceiro(4, { origem: null, uf: null });
    parceiro(5, { origem: 'portal', uf: 'MG', created_at: '2026-09-01T12:00:00Z', perfil_completo_em: T });
    banco.poe('nexus_propostas', { id: 'pr1', user_id: uid(1) }, { id: 'pr2', user_id: uid(1) }, { id: 'pr3', user_id: uid(2) }, { id: 'pr4', user_id: uid(3) });
    banco.poe('nexus_pedidos', { id: 'pd1', user_id: uid(2), tipo: 'equipamento', status: 'confirmado' }, { id: 'pd2', user_id: uid(3), tipo: 'equipamento', status: 'confirmado' },
      { id: 'pd3', user_id: uid(1), tipo: 'equipamento', status: 'solicitado' }, { id: 'pd4', user_id: uid(1), tipo: 'engenharia', status: 'confirmado' });
  }
  const totais = (r: any) => Object.fromEntries(r.body.etapas.map((e: any) => [e.chave, e.total]));

  it('conta as etapas, por origem e por UF (parceiros distintos; 8 origens sempre; vazios em baldes)', async () => {
    semear();
    const r = await funil();
    expect(r.status).toBe(200);
    expect(r.body.etapas.map((e: any) => e.rotulo)).toEqual(['Cadastros', 'Perfil completo', 'Primeira proposta', 'Conversa pedida', 'Conversa feita', 'Partner', 'Primeira compra (Pro)', 'Termo aceito', 'Master']);
    expect(totais(r)).toEqual({ cadastros: 5, perfil_completo: 4, primeira_proposta: 3, conversa_pedida: 1, conversa_feita: 1, partner: 2, primeira_compra: 2, termo_aceito: 2, master: 1 });
    expect(r.body.por_origem.map((o: any) => o.origem)).toEqual(['portal', 'solardoc', 'solardoc_banner', 'partner_lp', 'convite_email', 'convite_wpp', 'anuncio', 'link_cadastro', 'sem_origem']);
    const o = Object.fromEntries(r.body.por_origem.map((x: any) => [x.origem, x]));
    expect(o.portal).toEqual({ origem: 'portal', cadastros: 2, propostas: 1, compras: 0 });
    expect(o.solardoc).toEqual({ origem: 'solardoc', cadastros: 1, propostas: 1, compras: 1 });
    expect(o.link_cadastro).toEqual({ origem: 'link_cadastro', cadastros: 1, propostas: 1, compras: 1 });
    expect(o.anuncio).toEqual({ origem: 'anuncio', cadastros: 0, propostas: 0, compras: 0 });
    expect(o.sem_origem).toEqual({ origem: 'sem_origem', cadastros: 1, propostas: 0, compras: 0 });
    expect(r.body.por_uf).toEqual([
      { uf: 'MG', cadastros: 3, propostas: 2, compras: 1 },
      { uf: 'SP', cadastros: 1, propostas: 1, compras: 1 },
      { uf: 'sem_uf', cadastros: 1, propostas: 0, compras: 0 },
    ]);
  });

  it('desde=AAAA-MM-DD filtra a coorte pelo dia em Brasília; data inválida é 400', async () => {
    semear();
    const r = await funil('?desde=2026-10-01');
    expect(totais(r).cadastros).toBe(4); // o parceiro 5 é de 01/09
    expect(r.body.por_origem.find((x: any) => x.origem === 'portal').cadastros).toBe(1);
    expect((await funil('?desde=2026-10-11')).body.etapas[0].total).toBe(0);
    expect((await funil('?desde=ontem')).status).toBe(400);
    expect((await funil('?desde=2026-02-31')).status).toBe(400);
  });

  it('sem parceiros: tudo zero, 8 origens, nenhuma UF', async () => {
    const r = await funil();
    expect(r.status).toBe(200);
    expect(r.body.etapas.every((e: any) => e.total === 0)).toBe(true);
    expect(r.body.por_origem).toHaveLength(8);
    expect(r.body.por_uf).toEqual([]);
  });

  it('pagina além de 1000 linhas (parceiros, propostas e pedidos)', async () => {
    for (let i = 1; i <= 1250; i++) parceiro(i, { origem: i % 2 ? 'portal' : 'anuncio', uf: i % 3 ? 'MG' : 'GO', perfil_completo_em: i <= 1100 ? '2026-10-11T10:00:00Z' : null });
    for (let i = 1; i <= 1200; i++) banco.poe('nexus_propostas', { id: `pr${String(i).padStart(5, '0')}`, user_id: uid(i) });
    for (let i = 1; i <= 1050; i++) banco.poe('nexus_pedidos', { id: `pd${String(i).padStart(5, '0')}`, user_id: uid(i), tipo: 'equipamento', status: 'confirmado' });
    const r = await funil();
    expect(r.status).toBe(200);
    expect(totais(r).cadastros).toBe(1250);
    expect(totais(r).perfil_completo).toBe(1100);
    const o = Object.fromEntries(r.body.por_origem.map((x: any) => [x.origem, x]));
    expect(o.portal.cadastros + o.anuncio.cadastros).toBe(1250);
    expect(o.portal.propostas + o.anuncio.propostas).toBe(1200);
    expect(o.portal.compras + o.anuncio.compras).toBe(1050);
    expect(r.body.por_uf.reduce((s: number, x: any) => s + x.cadastros, 0)).toBe(1250);
  });

  it('só a equipe vê: sem token 401, conta comum 403, consultor do Gerador 200', async () => {
    expect((await request(app()).get('/gerador/nexus/equipe/funil')).status).toBe(401);
    expect((await funil('', sol(MEM))).status).toBe(403);
    expect((await funil('', naoSocioAuth)).status).toBe(200);
  });

  it('calcularFunil é pura: master conta só >= 5 carregadores e primeira compra só >= 1', () => {
    const f = calcularFunil([{ user_id: 'a', carregadores_comprados: 4 }, { user_id: 'b', carregadores_comprados: 5 }, { user_id: 'c' }], new Set(), new Set());
    expect(f.etapas.find((e) => e.chave === 'primeira_compra')!.total).toBe(2);
    expect(f.etapas.find((e) => e.chave === 'master')!.total).toBe(1);
  });
});

describe('/nexus/eu: adm e origem link_cadastro', () => {
  const eu = (uid = U1) => request(app()).get('/gerador/nexus/eu').set(bearer(uid));

  it('adm:false para conta comum, true para is_admin e para e-mail ativo em nexus_equipe', async () => {
    usuario(U1, 'parceiro1@exemplo.com');
    semearParceiro(U1);
    expect((await eu()).body.adm).toBe(false);
    banco.linhas('users').find((u) => u.id === U1)!.is_admin = true;
    expect((await eu()).body.adm).toBe(true);
    banco.linhas('users').find((u) => u.id === U1)!.is_admin = false;
    const id = membro('parceiro1@exemplo.com', 'admin', false);
    expect((await eu()).body.adm).toBe(false); // linha inativa não vale
    banco.linhas('nexus_equipe').find((m) => m.id === id)!.ativo = true;
    expect((await eu()).body.adm).toBe(true);
  });

  it('sem a tabela nexus_equipe: /eu responde 200 e adm segue só o is_admin', async () => {
    banco.falhas['nexus_equipe.select'] = ausente;
    usuario(U1, 'parceiro1@exemplo.com');
    semearParceiro(U1);
    const r = await eu();
    expect(r.status).toBe(200);
    expect(r.body.adm).toBe(false);
    usuario(U2, 'parceiro2@exemplo.com', { is_admin: true });
    semearParceiro(U2);
    expect((await eu(U2)).body.adm).toBe(true);
  });

  it('erro do banco ao ler a conta nunca derruba o /eu nem liga o adm', async () => {
    semearParceiro(U1);
    banco.falhas['users.select'] = { erro: { code: 'XX000', message: 'banco caiu' } };
    const r = await eu();
    expect(r.status).toBe(200);
    expect(r.body.adm).toBe(false);
  });

  it('origem link_cadastro é aceita na criação do parceiro (e uma origem fora da lista continua virando portal)', async () => {
    empresaDaConta(U3);
    const r = await request(app()).get('/gerador/nexus/eu?origem=link_cadastro').set(bearer(U3));
    expect(r.status).toBe(200);
    expect(r.body.parceiro.origem).toBe('link_cadastro');
    expect(origemValida('link_cadastro')).toBe('link_cadastro');
    expect(origemValida('qualquer_coisa')).toBe('portal');
  });
});
