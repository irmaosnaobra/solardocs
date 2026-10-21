import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { banco } from './_bancoFalso';
import { PARTNER, PED1, PRO_COM_TERMO, SOL1, U1, U2, app, bearer, equipeAuth, receita, semearParceiro, tokensDeConsultor } from './_nexusAjuda';

// Serviços NEXUS do Portal do Parceiro (v3): o /eu com níveis, bloqueios, serviços e saldo; os pedidos por tipo
// (equipamento, engenharia com pacote, consultoria) e seus gates; o saldo de engenharia (compra confirmada, uso,
// sem_saldo, cancelada libera, corrida); a solicitação de plataforma; e a sonda que exige as colunas da seção v3.

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

const enviados: Array<{ phone: string; texto: string; linha: string }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => { enviados.push({ phone, texto, linha }); }),
}));
const emails: string[] = [];
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: vi.fn(async (assunto: string) => { emails.push(assunto); }),
}));

import { enviador } from '../services/nexus/email';
import { resetSondaPortal } from '../services/nexus/repositorio';

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  resetSondaPortal();
  enviados.length = 0;
  emails.length = 0;
  consultor.tokens = tokensDeConsultor();
  delete process.env.NEXUS_AVISO_LIGADO;
  delete process.env.NEXUS_AVISO_PHONE;
  vi.spyOn(enviador, 'enviar').mockResolvedValue(undefined);
  receita('ativa');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ligarAviso = () => {
  process.env.NEXUS_AVISO_LIGADO = '1';
  process.env.NEXUS_AVISO_PHONE = '5511900000000';
};
const pedidoConfirmadoDeEngenharia = (pacote: number, id = PED1) =>
  banco.poe('nexus_pedidos', { id, user_id: U1, tipo: 'engenharia', pacote, status: 'confirmado', created_at: '2026-10-10T10:00:00Z' });
const engenharia = (extra: Record<string, unknown> = {}) => ({
  tipo: 'engenharia', dados: { servico_nome: 'ART', cidade: 'Araguari', uf: 'MG', usa_pacote: true, ...extra },
});

describe('GET /nexus/eu na v3', () => {
  it('devolve servicos, saldo_engenharia, termo, montagem_aprovada e os bloqueios com o texto de quando libera', async () => {
    semearParceiro(U1);
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.status).toBe(200);
    expect(r.body.nivel).toBe('cadastrado');
    expect(r.body.servicos.map((s: any) => s.id)).toEqual(['eng-3', 'eng-5', 'eng-10', 'consultoria', 'plataforma']);
    expect(r.body.servicos.every((s: any) => s.preco === 'Negociado com o comercial')).toBe(true);
    expect(r.body.saldo_engenharia).toEqual({ comprados: 0, usados: 0, disponiveis: 0 });
    expect(r.body.termo).toEqual({ versao: 'v1', disponivel: false, aceito_em: null });
    expect(r.body.montagem_aprovada).toBe(false);
    expect(r.body.libera).toMatchObject({ pacotes_engenharia: false, consultoria: false, plataforma: false, termo: false, oportunidades: false });
    expect(r.body.bloqueios.plataforma).toBe('Libera com a primeira compra de carregador');
    expect(r.body.bloqueios.consultoria).toMatch(/^Libera quando a equipe NEXUS marca/);
    expect(r.body.bloqueios.simulador).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/[—–]/);
  });

  it('Pro com o Termo aceito e a montagem aprovada: libera tudo, sem bloqueios, com o aceite e o saldo', async () => {
    semearParceiro(U1, { ...PRO_COM_TERMO, montagem_aprovada_em: '2026-10-02T10:00:00Z' });
    pedidoConfirmadoDeEngenharia(5);
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.body.nivel).toBe('pro');
    expect(r.body.bloqueios).toEqual({});
    expect(r.body.libera.oportunidades).toBe(true);
    expect(r.body.montagem_aprovada).toBe(true);
    expect(r.body.termo).toEqual({ versao: 'v1', disponivel: true, aceito_em: '2026-10-03T10:00:00Z' });
    expect(r.body.saldo_engenharia).toEqual({ comprados: 5, usados: 0, disponiveis: 5 });
  });

  it('termo aceito em versão antiga conta como pendente', async () => {
    semearParceiro(U1, { ...PRO_COM_TERMO, termo_versao: 'v0' });
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.body.termo.aceito_em).toBeNull();
    expect(r.body.libera.oportunidades).toBe(false);
    expect(r.body.bloqueios.oportunidades).toBe('Aceite o Termo de Parceria para receber oportunidades');
  });
});

describe('POST /nexus/pedidos por tipo', () => {
  it('sem tipo vale equipamento (o front v2 não manda tipo) e grava tipo equipamento', async () => {
    semearParceiro(U1, PARTNER);
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ modelo: 'nexus-dc-80', quantidade: 2 });
    expect(r.status).toBe(201);
    expect(r.body.tipo).toBe('equipamento');
    expect(banco.linhas('nexus_pedidos')[0]).toMatchObject({ tipo: 'equipamento', modelo: 'nexus-dc-80', quantidade: 2, pacote: null, status: 'solicitado' });
  });

  it('equipamento: gate do Partner, modelo e quantidade validados', async () => {
    semearParceiro(U1);
    const corpo = { tipo: 'equipamento', modelo: 'nexus-dc-80', quantidade: 1 };
    expect((await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send(corpo)).status).toBe(403);
    banco.linhas('nexus_parceiros')[0]!.partner_em = '2026-10-01T10:00:00Z';
    expect((await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ ...corpo, modelo: 'x' })).body.erro).toBe('modelo_invalido');
    expect((await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ ...corpo, quantidade: 0 })).body.erro).toBe('quantidade_invalida');
    expect((await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send(corpo)).status).toBe(201);
  });

  it.each([3, 5, 10])('engenharia com pacote de %i projetos: grava tipo e pacote, modelo e quantidade ficam nulos', async (pacote) => {
    semearParceiro(U1, PARTNER);
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'engenharia', pacote });
    expect(r.status).toBe(201);
    expect(banco.linhas('nexus_pedidos')[0]).toMatchObject({ tipo: 'engenharia', pacote, modelo: null, quantidade: null, status: 'solicitado' });
  });

  it('engenharia: pacote fora de 3, 5 e 10 é recusado', async () => {
    semearParceiro(U1, PARTNER);
    for (const pacote of [0, 1, 4, 7, 'abc', undefined]) {
      const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'engenharia', pacote });
      expect(r.status).toBe(400);
      expect(r.body.erro).toBe('pacote_invalido');
    }
    expect(banco.linhas('nexus_pedidos')).toHaveLength(0);
  });

  it('consultoria: grava a observação, sem modelo nem quantidade', async () => {
    semearParceiro(U1, PARTNER);
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'consultoria', obs: 'Reunião com o posto na quinta' });
    expect(r.status).toBe(201);
    expect(banco.linhas('nexus_pedidos')[0]).toMatchObject({ tipo: 'consultoria', obs: 'Reunião com o posto na quinta', modelo: null, quantidade: null, pacote: null });
  });

  it('tipo desconhecido: 400 tipo_invalido', async () => {
    semearParceiro(U1, PARTNER);
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'plataforma' });
    expect(r.body.erro).toBe('tipo_invalido');
  });

  it('engenharia e consultoria só do Partner em diante: o cadastrado com perfil completo leva 403', async () => {
    semearParceiro(U1);
    for (const corpo of [{ tipo: 'engenharia', pacote: 3 }, { tipo: 'consultoria' }]) {
      const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send(corpo);
      expect(r.status).toBe(403);
      expect(r.body.erro).toBe('etapa_bloqueada');
    }
    expect(banco.linhas('nexus_pedidos')).toHaveLength(0);
  });

  it('o aviso (c) vale para todos os tipos, com o tipo no texto, e sempre sai também por e-mail', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ modelo: 'nexus-dc-80', quantidade: 2 });
    await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'engenharia', pacote: 5 });
    await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'consultoria', obs: 'Posto novo' });
    expect(enviados.map((e) => e.texto)).toEqual([
      expect.stringMatching(/pediu equipamento: 2x NEXUS DC 80 kW/),
      expect.stringMatching(/fez pedido de pacote de engenharia \(5 projetos\)/),
      expect.stringMatching(/fez pedido de consultoria de vendas NEXUS.*Recado: Posto novo/),
    ]);
    expect(emails).toHaveLength(3);
    expect(enviados.every((e) => e.linha === 'io')).toBe(true);
  });

  it('GET /pedidos devolve todos os tipos com tipo e pacote', async () => {
    semearParceiro(U1, PARTNER);
    await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'engenharia', pacote: 3 });
    await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ modelo: 'nexus-dc-120', quantidade: 1 });
    const r = await request(app()).get('/gerador/nexus/pedidos').set(bearer(U1));
    expect(r.body.pedidos.map((p: any) => [p.tipo, p.pacote])).toEqual(expect.arrayContaining([['engenharia', 3], ['equipamento', null]]));
  });
});

describe('trava, e-mail e limite dos pedidos de serviço (aval do chefe-antiban)', () => {
  const pedir = (a: ReturnType<typeof app>, corpo: object) => request(a).post('/gerador/nexus/pedidos').set(bearer(U1)).send(corpo);
  const travas = () => banco.linhas('system_state').map((x) => String(x.key));
  const dia = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

  it('2 pedidos de consultoria do mesmo parceiro no mesmo dia: 1 WhatsApp, 1 trava e 2 e-mails', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    await pedir(app(), { tipo: 'consultoria', obs: 'Primeiro' });
    await pedir(app(), { tipo: 'consultoria', obs: 'Segundo' });
    expect(enviados).toHaveLength(1);
    expect(travas()).toHaveLength(1);
    expect(travas()[0]).toMatch(new RegExp(`^nexus_aviso:pedido_consultoria:00000000-0000-4000-9000-000000000001:${dia}$`));
    expect(emails).toEqual(['Portal NEXUS: pedido de consultoria', 'Portal NEXUS: pedido de consultoria']);
    expect(banco.linhas('nexus_pedidos')).toHaveLength(2);
  });

  it('pacotes de engenharia: a trava é por parceiro, tipo e dia (consultoria e engenharia não se bloqueiam); e-mail sempre', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    await pedir(app(), { tipo: 'engenharia', pacote: 3 });
    await pedir(app(), { tipo: 'engenharia', pacote: 5 });
    await pedir(app(), { tipo: 'consultoria' });
    expect(enviados).toHaveLength(2);
    const k = travas();
    expect(k).toHaveLength(2);
    expect(k.filter((x) => x.startsWith('nexus_aviso:pedido_engenharia:'))).toHaveLength(1);
    expect(k.filter((x) => x.startsWith('nexus_aviso:pedido_consultoria:'))).toHaveLength(1);
    expect(emails).toEqual([
      'Portal NEXUS: pedido de pacote de engenharia (3 projetos)',
      'Portal NEXUS: pedido de pacote de engenharia (5 projetos)',
      'Portal NEXUS: pedido de consultoria',
    ]);
  });

  it('pedido de equipamento continua com trava por pedido: 2 pedidos no dia, 2 WhatsApps, 2 e-mails', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    await pedir(app(), { modelo: 'nexus-dc-80', quantidade: 1 });
    await pedir(app(), { modelo: 'nexus-dc-80', quantidade: 1 });
    expect(enviados).toHaveLength(2);
    expect(travas().every((k) => /^nexus_aviso:pedido:[0-9a-f-]{36}$/.test(k))).toBe(true);
    expect(emails).toEqual(['Portal NEXUS: pedido de equipamento', 'Portal NEXUS: pedido de equipamento']);
  });

  it('o e-mail do pedido sai também com o aviso desligado e com a trava duplicada', async () => {
    semearParceiro(U1, PARTNER);
    await pedir(app(), { tipo: 'consultoria' });
    expect(enviados).toHaveLength(0);
    expect(emails).toEqual(['Portal NEXUS: pedido de consultoria']);
  });

  it('engenharia que usa o pacote: e-mail SEMPRE; o WhatsApp segue a trava por parceiro, tipo e dia', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    for (let i = 0; i < 2; i++) await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(enviados).toHaveLength(1);
    expect(emails).toEqual([
      'Portal NEXUS: solicitação de engenharia (usa 1 projeto do pacote)',
      'Portal NEXUS: solicitação de engenharia (usa 1 projeto do pacote)',
    ]);
    // engenharia avulsa (sem pacote) não manda e-mail
    emails.length = 0;
    await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia({ usa_pacote: false }));
    expect(emails).toHaveLength(0);
  });

  it('o 11º POST na hora do mesmo usuário leva 429 muitas_tentativas (pedidos e solicitações somam); outro usuário não é afetado', async () => {
    semearParceiro(U1, PARTNER);
    semearParceiro(U2, PARTNER);
    const a = app();
    for (let i = 0; i < 5; i++) expect((await pedir(a, { tipo: 'consultoria' })).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await request(a).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'negociar_preco', dados: {} })).status).toBe(201);
    const onze = await pedir(a, { tipo: 'consultoria' });
    expect(onze.status).toBe(429);
    expect(onze.body).toEqual({ erro: 'muitas_tentativas' });
    expect((await request(a).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'negociar_preco', dados: {} })).status).toBe(429);
    expect(banco.linhas('nexus_pedidos')).toHaveLength(5);
    expect((await request(a).post('/gerador/nexus/pedidos').set(bearer(U2)).send({ tipo: 'consultoria' })).status).toBe(201);
  });

  it('o assunto de cada tipo de pedido', async () => {
    const { assuntoDoAviso } = await import('../services/nexus/avisoComercial');
    const p = { id: 'p1', empresa: 'X' };
    expect(assuntoDoAviso('pedido', { parceiro: p, pedido: { id: '1', tipo: 'equipamento' } })).toBe('Portal NEXUS: pedido de equipamento');
    expect(assuntoDoAviso('pedido', { parceiro: p, pedido: { id: '1' } })).toBe('Portal NEXUS: pedido de equipamento');
    expect(assuntoDoAviso('pedido', { parceiro: p, pedido: { id: '1', tipo: 'engenharia', pacote: 10 } })).toBe('Portal NEXUS: pedido de pacote de engenharia (10 projetos)');
    expect(assuntoDoAviso('pedido', { parceiro: p, pedido: { id: '1', tipo: 'consultoria' } })).toBe('Portal NEXUS: pedido de consultoria');
  });
});

describe('saldo de engenharia pelas rotas', () => {
  it('pacote só entra no saldo quando a equipe CONFIRMA, e confirmar engenharia não conta como carregador', async () => {
    semearParceiro(U1, PARTNER);
    await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'engenharia', pacote: 5 });
    const pedido = banco.linhas('nexus_pedidos')[0]!;
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.saldo_engenharia.comprados).toBe(0);

    const c = await request(app()).patch(`/gerador/nexus/equipe/pedidos/${pedido.id}`).set(equipeAuth).send({ status: 'confirmado' });
    expect(c.status).toBe(200);
    expect(c.body.carregadores_comprados).toBe(0);
    expect(c.body.saldo_engenharia).toEqual({ comprados: 5, usados: 0, disponiveis: 5 });
    const eu = (await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body;
    expect(eu.saldo_engenharia).toEqual({ comprados: 5, usados: 0, disponiveis: 5 });
    expect(eu.nivel).toBe('partner'); // engenharia não leva ao Pro: só carregador comprado
  });

  it('confirmar um pedido de equipamento soma carregadores e leva ao Pro; engenharia e consultoria não somam', async () => {
    semearParceiro(U1, PARTNER);
    banco.poe('nexus_pedidos',
      { id: PED1, user_id: U1, tipo: 'equipamento', modelo: 'nexus-dc-80', quantidade: 2, status: 'solicitado' },
      { id: '00000000-0000-4000-a000-0000000000d3', user_id: U1, tipo: 'engenharia', pacote: 10, status: 'confirmado' },
      { id: '00000000-0000-4000-a000-0000000000d4', user_id: U1, tipo: 'consultoria', quantidade: 9, status: 'confirmado' });
    const r = await request(app()).patch(`/gerador/nexus/equipe/pedidos/${PED1}`).set(equipeAuth).send({ status: 'confirmado' });
    expect(r.body.carregadores_comprados).toBe(2);
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.nivel).toBe('pro');
  });

  it('usa_pacote consome 1 projeto por solicitação; no fim do saldo responde 409 sem_saldo e não grava', async () => {
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    for (let i = 0; i < 3; i++) {
      const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
      expect(r.status).toBe(201);
    }
    const sem = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(sem.status).toBe(409);
    expect(sem.body.erro).toBe('sem_saldo');
    expect(banco.linhas('nexus_solicitacoes')).toHaveLength(3);
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.saldo_engenharia).toEqual({ comprados: 3, usados: 3, disponiveis: 0 });
  });

  it('sem nenhum pacote comprado, usa_pacote dá sem_saldo; sem usa_pacote a engenharia avulsa segue como solicitação normal', async () => {
    semearParceiro(U1);
    expect((await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia())).body.erro).toBe('sem_saldo');
    const avulsa = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia({ usa_pacote: false }));
    expect(avulsa.status).toBe(201);
    expect(banco.linhas('nexus_solicitacoes')[0]!.dados.usa_pacote).toBe(false);
    // só o booleano true vale: a string "true" não consome (e é gravada como false)
    const texto = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia({ usa_pacote: 'true' }));
    expect(texto.status).toBe(201);
    expect(banco.linhas('nexus_solicitacoes')[1]!.dados.usa_pacote).toBe(false);
  });

  it('cancelada devolve o projeto ao saldo; a equipe cancela pelo PATCH da solicitação', async () => {
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    const um = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect((await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia())).status).toBe(409);

    const c = await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${um.body.id}`).set(equipeAuth).send({ status: 'cancelada', obs_equipe: 'Cliente desistiu' });
    expect(c.status).toBe(200);
    expect(c.body.solicitacao.status).toBe('cancelada');
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.saldo_engenharia).toEqual({ comprados: 3, usados: 2, disponiveis: 1 });
    expect((await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia())).status).toBe(201);
  });

  it('duas solicitações ao mesmo tempo com saldo 1: só uma fica, a outra vira cancelada e responde 409', async () => {
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    banco.poe('nexus_solicitacoes',
      { id: SOL1, user_id: U1, tipo: 'engenharia', status: 'em_andamento', dados: { usa_pacote: true }, created_at: '2026-10-11T10:00:00Z' },
      { id: '00000000-0000-4000-a000-0000000000e2', user_id: U1, tipo: 'engenharia', status: 'aberta', dados: { usa_pacote: true }, created_at: '2026-10-12T10:00:00Z' });
    const [a, b] = await Promise.all([
      request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia()),
      request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const ativas = banco.linhas('nexus_solicitacoes').filter((s) => s.status !== 'cancelada');
    expect(ativas).toHaveLength(3);
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.saldo_engenharia).toEqual({ comprados: 3, usados: 3, disponiveis: 0 });
  });

  it('o aviso da engenharia que usa o pacote diz isso; a que estoura o saldo não avisa ninguém', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(enviados[0]!.texto).toMatch(/serviço de engenharia: ART em Araguari\/MG \(usa 1 projeto do pacote\)/);
    banco.reset(); banco.projeta = true; resetSondaPortal(); enviados.length = 0;
    semearParceiro(U1, PARTNER);
    await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(enviados).toHaveLength(0);
  });

  it('engenharia avulsa continua exigindo só o perfil completo', async () => {
    semearParceiro(U1);
    expect((await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia({ usa_pacote: false }))).status).toBe(201);
  });
});

describe('solicitação de plataforma', () => {
  it('só do Pro em diante (libera.plataforma); antes, 403', async () => {
    semearParceiro(U1, PARTNER);
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'plataforma', dados: {} });
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('etapa_bloqueada');
  });

  it('Pro grava a solicitação e avisa o comercial', async () => {
    ligarAviso();
    semearParceiro(U1, { ...PARTNER, carregadores_comprados: 1 });
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'plataforma', dados: { obs: 'Tenho 3 pontos' } });
    expect(r.status).toBe(201);
    expect(banco.linhas('nexus_solicitacoes')[0]).toMatchObject({ tipo: 'plataforma', status: 'aberta' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.texto).toMatch(/quer revender a Plataforma NEXUS de gestão.*Recado: Tenho 3 pontos/);
  });
});

describe('equipe: parceiros, pedidos e propostas na v3', () => {
  it('GET /equipe/parceiros traz saldo_engenharia, termo_aceito_em e montagem_aprovada_em', async () => {
    semearParceiro(U1, { ...PRO_COM_TERMO, montagem_aprovada_em: '2026-10-02T10:00:00Z' });
    pedidoConfirmadoDeEngenharia(5);
    banco.poe('nexus_solicitacoes',
      { id: SOL1, user_id: U1, tipo: 'engenharia', status: 'aberta', dados: { usa_pacote: true }, created_at: '2026-10-11T10:00:00Z' },
      { id: '00000000-0000-4000-a000-0000000000e2', user_id: U1, tipo: 'engenharia', status: 'cancelada', dados: { usa_pacote: true }, created_at: '2026-10-12T10:00:00Z' });
    const r = await request(app()).get('/gerador/nexus/equipe/parceiros').set(equipeAuth);
    expect(r.status).toBe(200);
    expect(r.body.parceiros[0]).toMatchObject({
      nivel: 'pro', saldo_engenharia: { comprados: 5, usados: 1, disponiveis: 4 },
      termo_aceito_em: '2026-10-03T10:00:00Z', montagem_aprovada_em: '2026-10-02T10:00:00Z',
    });
  });

  it('GET /equipe/pedidos traz tipo e pacote; o total de carregadores confirmados do mês ignora engenharia', async () => {
    semearParceiro(U1, PARTNER);
    const agora = new Date().toISOString();
    banco.poe('nexus_pedidos',
      { id: PED1, user_id: U1, tipo: 'engenharia', pacote: 10, status: 'confirmado', confirmado_em: agora, created_at: agora },
      { id: '00000000-0000-4000-a000-0000000000d2', user_id: U1, tipo: 'equipamento', modelo: 'nexus-dc-80', quantidade: 2, status: 'confirmado', confirmado_em: agora, created_at: agora },
      { id: '00000000-0000-4000-a000-0000000000d3', user_id: U1, modelo: 'nexus-dc-80', quantidade: 1, status: 'confirmado', confirmado_em: agora, created_at: agora });
    const pedidos = await request(app()).get('/gerador/nexus/equipe/pedidos').set(equipeAuth);
    expect(pedidos.body.pedidos.find((p: any) => p.id === PED1)).toMatchObject({ tipo: 'engenharia', pacote: 10 });
    const painel = await request(app()).get('/gerador/nexus/equipe/parceiros').set(equipeAuth);
    expect(painel.body.totais.carregadores_confirmados_mes).toBe(3); // 2 + 1 (linha antiga, sem tipo, é equipamento)
  });

  it('GET /equipe/propostas traz aberturas e ultima_abertura_em', async () => {
    semearParceiro(U1, PARTNER);
    banco.poe('nexus_propostas', {
      id: '00000000-0000-4000-a000-0000000000f1', user_id: U1, numero: '20260001', saida_ultima: 'completo', quantidade: 1, valor_total: 1,
      created_at: new Date().toISOString(), aberturas: 3, ultima_abertura_em: '2026-10-20T21:00:00Z', primeira_abertura_em: '2026-10-19T10:00:00Z', link_criado_em: '2026-10-19T09:00:00Z',
    });
    const r = await request(app()).get('/gerador/nexus/equipe/propostas').set(equipeAuth);
    expect(r.body.propostas[0]).toMatchObject({ aberturas: 3, ultima_abertura_em: '2026-10-20T21:00:00Z' });
  });

  it('a equipe aceita o status cancelada na solicitação e recusa um status desconhecido', async () => {
    semearParceiro(U1, PARTNER);
    banco.poe('nexus_solicitacoes', { id: SOL1, user_id: U1, tipo: 'plataforma', status: 'aberta', dados: {} });
    expect((await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${SOL1}`).set(equipeAuth).send({ status: 'sumiu' })).status).toBe(400);
    expect((await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${SOL1}`).set(equipeAuth).send({ status: 'cancelada' })).status).toBe(200);
  });
});

describe('sonda do portal ligado (colunas da seção v3)', () => {
  it('só a coluna nova faltando (42703) desliga o portal', async () => {
    banco.falhas['nexus_propostas.select'] = { erro: { code: '42703', message: 'column nexus_propostas.link_token does not exist' } };
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: false });
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).status).toBe(503);
  });

  it('PGRST204 numa tabela do portal também desliga', async () => {
    banco.falhas['nexus_pedidos.select'] = { erro: { code: 'PGRST204', message: "Could not find the 'pacote' column of 'nexus_pedidos' in the schema cache" } };
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: false });
  });

  it('um erro de coluna numa rota (bug) NÃO desliga o portal pela sonda', async () => {
    semearParceiro(U1, PARTNER);
    banco.falhas['nexus_pedidos.insert'] = { erro: { code: '42703', message: 'column x does not exist' }, uma: true };
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ tipo: 'consultoria' });
    expect(r.status).toBe(500);
    resetSondaPortal();
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: true });
  });
});

describe('uso do pacote pela função do banco (nexus_usar_pacote)', () => {
  const E2 = '00000000-0000-4000-a000-0000000000e2';

  it('ok: a rota chama a função com o usuário e os dados, NÃO insere por fora, devolve o id e só então avisa', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    banco.rpcs.nexus_usar_pacote = () => ({ data: { ok: true, id: SOL1 }, error: null });
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(SOL1);
    expect(banco.rpcChamadas).toHaveLength(1);
    expect(banco.rpcChamadas[0]).toMatchObject({ nome: 'nexus_usar_pacote', args: { p_user: U1, p_dados: { usa_pacote: true, servico_nome: 'ART' } } });
    expect(banco.escritas.filter((e) => e.tabela === 'nexus_solicitacoes')).toHaveLength(0);
    expect(enviados).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  it('sem_saldo: 409, nenhum insert, nenhum aviso e nenhum e-mail', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    banco.rpcs.nexus_usar_pacote = () => ({ data: { ok: false, erro: 'sem_saldo' }, error: null });
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('sem_saldo');
    expect(banco.escritas.filter((e) => e.tabela === 'nexus_solicitacoes')).toHaveLength(0);
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('erro do banco na função: não vira 201 e não avisa', async () => {
    ligarAviso();
    semearParceiro(U1, PARTNER);
    banco.rpcs.nexus_usar_pacote = () => ({ data: null, error: { code: '42883', message: 'function nexus_usar_pacote does not exist' } });
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia());
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(enviados).toHaveLength(0);
  });

  it('sem usa_pacote a função nem é chamada (insert normal)', async () => {
    semearParceiro(U1);
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(engenharia({ usa_pacote: false }));
    expect(r.status).toBe(201);
    expect(banco.rpcChamadas).toHaveLength(0);
  });

  it('reabrir uma cancelada que usa o pacote sem saldo disponível: 409 sem_saldo e nada muda', async () => {
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    banco.poe('nexus_solicitacoes',
      { id: SOL1, user_id: U1, tipo: 'engenharia', status: 'cancelada', dados: { usa_pacote: true }, created_at: '2026-10-11T10:00:00Z' },
      { id: E2, user_id: U1, tipo: 'engenharia', status: 'aberta', dados: { usa_pacote: true }, created_at: '2026-10-12T10:00:00Z' },
      { id: '00000000-0000-4000-a000-0000000000e3', user_id: U1, tipo: 'engenharia', status: 'aberta', dados: { usa_pacote: true }, created_at: '2026-10-13T10:00:00Z' },
      { id: '00000000-0000-4000-a000-0000000000e4', user_id: U1, tipo: 'engenharia', status: 'concluida', dados: { usa_pacote: true }, created_at: '2026-10-14T10:00:00Z' });
    const r = await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${SOL1}`).set(equipeAuth).send({ status: 'aberta' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('sem_saldo');
    expect(banco.linhas('nexus_solicitacoes').find((s) => s.id === SOL1)!.status).toBe('cancelada');
  });

  it('reabrir com saldo disponível passa; cancelar, mexer na nota e reabrir cancelada avulsa não exigem saldo', async () => {
    semearParceiro(U1, PARTNER);
    pedidoConfirmadoDeEngenharia(3);
    banco.poe('nexus_solicitacoes',
      { id: SOL1, user_id: U1, tipo: 'engenharia', status: 'cancelada', dados: { usa_pacote: true }, created_at: '2026-10-11T10:00:00Z' },
      { id: E2, user_id: U1, tipo: 'engenharia', status: 'cancelada', dados: { usa_pacote: false }, created_at: '2026-10-12T10:00:00Z' });
    expect((await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${SOL1}`).set(equipeAuth).send({ status: 'em_andamento' })).status).toBe(200);
    expect(banco.linhas('nexus_solicitacoes').find((s) => s.id === SOL1)!.status).toBe('em_andamento');
    // saldo 3, 1 usado: a avulsa reabre sem olhar o saldo
    expect((await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${E2}`).set(equipeAuth).send({ status: 'aberta' })).status).toBe(200);
    expect((await request(app()).patch(`/gerador/nexus/equipe/solicitacoes/${SOL1}`).set(equipeAuth).send({ obs_equipe: 'nota' })).status).toBe(200);
  });
});
