import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { banco } from './_bancoFalso';
import { U1, U2, app, bearer, equipeAuth, propostaOk, receita, semearParceiro, tokensDeConsultor } from './_nexusAjuda';

// Rotas da Trilha do Parceiro NEXUS com o banco principal simulado: dormente (tabela ausente e NEXUS_TRILHA_OFF), Raio-X,
// diagnóstico (plano pago), Academia, reunião, ações da equipe e isolamento entre parceiros. Nada sai para a rede.

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
const enviados: unknown[] = [];
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async (...a: unknown[]) => { enviados.push(a); }) }));
const emails: unknown[] = [];
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async (...a: unknown[]) => { emails.push(a); }) }));

import { resetSondaPortal } from '../services/nexus/repositorio';
import { type Decisao, atualizarTrilha, garantirTrilha, resetSondaTrilha } from '../services/nexus/trilhaRepo';
import { AULAS } from '../services/nexus/academia';

const EQUIPE_EMAIL = 'thiago@irmaosnaobra.app';
const D = '2026-11-01T12:00:00.000Z';
const CLIENTE_U1 = '00000000-0000-4000-b000-000000000001';
const CLIENTE_U2 = '00000000-0000-4000-b000-000000000002';
const amanha = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const pref = () => ({ dias: [amanha()], periodo: 'manha' });

function usuario(id: string, extra: Record<string, unknown> = {}) {
  banco.poe('users', { id, email: `${id.slice(-4)}@exemplo.com`, nome: 'Fulano', is_admin: false, plano: 'free', billing_status: 'active', plano_expira_em: null, ...extra });
}
const PAGO = { plano: 'ilimitado', billing_status: 'active' };
function semearTrilha(uid: string, extra: Record<string, unknown> = {}) {
  banco.poe('nexus_trilha', { user_id: uid, raio_x: {}, mentoria_encontros: 0, academia: {}, ultimo_movimento_em: D, created_at: D, updated_at: D, ...extra });
}
const linhaTrilha = (uid: string) => banco.linhas('nexus_trilha').find((t) => t.user_id === uid)!;
const eventos = (uid: string) => banco.linhas('nexus_trilha_eventos').filter((e) => e.user_id === uid);

const respostasCheias = () => ({
  anos_solar: '3-5', usinas: '20-100', equipe: '3-5', raio_km: 150, capacidades: ['eletrica_bt', 'obra_civil'], ja_montou_eletroposto: 'nunca',
  conhece_mercado: 'pouco', papel: 'revenda', quando: 'agora', dificuldades: ['cliente'], demanda_12m: 6,
  clientes_em_vista: [
    { nome: 'Posto A', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto', fase: 'quente' },
    { nome: 'Hotel B', cidade: 'Uberaba', uf: 'MG', tipo_local: 'hotel', fase: 'ideia' },
  ],
  simulacao: { tipo_local: 'posto', modelo: 'nexus-dc-80', kwh_mes: 6300, preco_kwh: 2.1, resultado: {} },
});

const get = (uid: string, url = '/gerador/nexus/trilha') => request(app()).get(url).set(bearer(uid));
const enviar = (uid: string, metodo: 'post' | 'put', url: string, corpo: unknown) => request(app())[metodo](url).set(bearer(uid)).send(corpo as object);

beforeEach(() => {
  banco.reset();
  banco.trilhaLigada = true;
  resetSondaPortal();
  resetSondaTrilha();
  delete process.env.NEXUS_TRILHA_OFF;
  consultor.tokens = tokensDeConsultor();
  enviados.length = 0;
  emails.length = 0;
  receita('ativa');
  usuario(U1, PAGO);
  usuario(U2, PAGO);
  semearParceiro(U1);
  semearParceiro(U2);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.NEXUS_TRILHA_OFF; });

describe('dormente: tabela ausente ou NEXUS_TRILHA_OFF', () => {
  it('tabela ausente: GET devolve { ligada:false } e nada é criado', async () => {
    banco.trilhaLigada = false;
    const r = await get(U1);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ligada: false });
    expect(banco.tabelas['nexus_trilha'] ?? []).toHaveLength(0);
  });

  it('tabela ausente: as outras rotas da trilha respondem 503 trilha_desligada e a equipe lê { ligada:false }', async () => {
    banco.trilhaLigada = false;
    expect((await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: {} })).body).toEqual({ erro: 'trilha_desligada' });
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { preferencia: pref() })).status).toBe(503);
    expect((await request(app()).get('/gerador/nexus/equipe/trilha').set(equipeAuth)).body).toEqual({ ligada: false });
    expect((await request(app()).get('/gerador/nexus/equipe/trilha-mapa').set(equipeAuth)).body).toEqual({ ligada: false });
  });

  it('NEXUS_TRILHA_OFF=1 desliga mesmo com as tabelas', async () => {
    process.env.NEXUS_TRILHA_OFF = '1';
    expect((await get(U1)).body).toEqual({ ligada: false });
  });

  it('desligada, o portal é o de sempre: /eu sem marca da trilha e proposta Básica liberada pelo perfil', async () => {
    banco.trilhaLigada = false;
    const eu = await get(U1, '/gerador/nexus/eu');
    expect(eu.status).toBe(200);
    expect(eu.body.libera.basico).toBe(true);
    expect(eu.body).not.toHaveProperty('trilha_ligada');
    expect((await enviar(U1, 'post', '/gerador/nexus/propostas', propostaOk('basico'))).status).toBe(201);
  });
});

describe('GET /nexus/trilha', () => {
  it('liga, cria a linha na primeira chamada e devolve a visão no patamar 1', async () => {
    const r = await get(U1);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ligada: true, patamar: 1, assinante: true,
      proximo_passo: { codigo: 'raio_x' },
      raio_x: { nota: 10, enviado_em: null },
      preparo: { encontros_meta: 4, academia: { feitas: 0, meta: 12 } },
      termo: { aceito: false, versao: 'v1' },
      prefill: { cnpj: '11222333000181', tem_logo: true, propostas_solares: 0, clientes_pj: [] },
    });
    expect(Object.keys(r.body.etapas)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(banco.linhas('nexus_trilha')).toHaveLength(1);
    expect((await get(U1)).status).toBe(200);
    expect(banco.linhas('nexus_trilha')).toHaveLength(1); // 2ª chamada não duplica
  });

  it('sem plano pago ativo (free active não conta) assinante é false', async () => {
    banco.linhas('users').find((u) => u.id === U1)!.plano = 'free';
    expect((await get(U1)).body.assinante).toBe(false);
  });

  it('quem já comprou carregador entra com os patamares 1 a 4 como legado (não perde o pedido)', async () => {
    banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!.carregadores_comprados = 2;
    const r = await get(U1);
    expect(r.body.patamar).toBe(6);
    expect(r.body.historico.map((h: { tipo: string }) => h.tipo)).toContain('legado');
  });

  it('sem login: 401', async () => {
    expect((await request(app()).get('/gerador/nexus/trilha')).status).toBe(401);
  });
});

describe('Raio-X', () => {
  it('PUT valida chaves e valores', async () => {
    expect((await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: { user_id: U2 } })).body).toMatchObject({ erro: 'chave_desconhecida' });
    expect((await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: { quando: 'nunca' } })).body).toMatchObject({ erro: 'valor_invalido', campo: 'quando' });
    expect((await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', {})).status).toBe(400);
  });

  it('PUT grava parcial, junta com o que já tinha e devolve nota e faltas', async () => {
    await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: { anos_solar: '1-3', usinas: '0-20' } });
    const r = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: { equipe: '1-2', raio_km: 100 } });
    expect(r.status).toBe(200);
    expect(r.body.nota).toBe(25); // empresa 10 + experiência 15
    expect(r.body.faltas.length).toBeGreaterThan(0);
    expect(linhaTrilha(U1).raio_x).toMatchObject({ anos_solar: '1-3', usinas: '0-20', equipe: '1-2', raio_km: 100 });
  });

  it('cliente_id de OUTRO usuário é recusado; o do próprio usuário passa', async () => {
    banco.poe('clients', { id: CLIENTE_U1, user_id: U1, nome: 'Posto A', tipo: 'PJ' }, { id: CLIENTE_U2, user_id: U2, nome: 'Posto B', tipo: 'PJ' });
    const item = (id: string) => ({ respostas: { clientes_em_vista: [{ cliente_id: id, nome: 'Posto', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto', fase: 'quente' }] } });
    const outro = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', item(CLIENTE_U2));
    expect(outro.status).toBe(400);
    expect(outro.body).toEqual({ erro: 'cliente_invalido' });
    expect((await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', item(CLIENTE_U1))).status).toBe(200);
    expect(linhaTrilha(U1).raio_x.clientes_em_vista).toHaveLength(1);
  });

  it('enviar com nota abaixo de 80 não fecha o patamar 1', async () => {
    await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: { anos_solar: '1-3' } });
    const r = await enviar(U1, 'post', '/gerador/nexus/trilha/raio-x/enviar', {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ passou: false, nota: 10, trilha: { patamar: 1 } });
    expect(linhaTrilha(U1).p1_em ?? null).toBeNull();
  });

  it('enviar com 80+ fecha o 1, copia raio, papel e capacidades para o parceiro e abre o patamar 2', async () => {
    await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: respostasCheias() });
    const r = await enviar(U1, 'post', '/gerador/nexus/trilha/raio-x/enviar', {});
    expect(r.body).toMatchObject({ passou: true, nota: 100, faltas: [], trilha: { patamar: 2, proximo_passo: { codigo: 'pedir_diagnostico' } } });
    const p = banco.linhas('nexus_parceiros').find((x) => x.user_id === U1)!;
    expect(p).toMatchObject({ raio_km: 150, papel_revenda: true, papel_montagem: false, cap_eletrica_bt: true, cap_obra_civil: true, cap_eletrica_mt: false });
    expect(linhaTrilha(U1).p1_em).toBeTruthy();
    expect(eventos(U1).map((e) => e.tipo)).toEqual(['raio_x_enviado', 'patamar_concluido']);
  });
});

describe('diagnóstico e preparo', () => {
  it('exige o patamar 1 e plano pago ativo; depois grava o pedido e recusa pedido repetido', async () => {
    semearTrilha(U1);
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { preferencia: pref() })).body).toEqual({ erro: 'etapa_bloqueada' });
    linhaTrilha(U1).p1_em = D;
    banco.linhas('users').find((u) => u.id === U1)!.plano = 'free';
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { preferencia: pref() })).body).toEqual({ erro: 'assinatura_necessaria' });
    banco.linhas('users').find((u) => u.id === U1)!.plano = 'ilimitado';
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { preferencia: { dias: [], periodo: 'manha' } })).status).toBe(400);
    const ok = await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { preferencia: pref() });
    expect(ok.status).toBe(200);
    expect(ok.body.diagnostico.pedido_em).toBeTruthy();
    expect(ok.body.proximo_passo.codigo).toBe('aguardar_agenda');
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { preferencia: pref() })).body).toEqual({ erro: 'ja_pedido' });
  });

  it('preparo exige o patamar 2 e aceita só mentoria ou academia', async () => {
    semearTrilha(U1, { p1_em: D });
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/preparo', { formato: 'academia' })).body).toEqual({ erro: 'etapa_bloqueada' });
    linhaTrilha(U1).p2_em = D;
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/preparo', { formato: 'curso' })).body).toEqual({ erro: 'formato_invalido' });
    const r = await enviar(U1, 'post', '/gerador/nexus/trilha/preparo', { formato: 'academia' });
    expect(r.body).toMatchObject({ patamar: 3, preparo: { formato: 'academia' }, proximo_passo: { codigo: 'academia' } });
  });
});

describe('Academia', () => {
  beforeEach(() => semearTrilha(U1, { p1_em: D, p2_em: D, preparo_formato: 'academia' }));

  it('lista as 12 aulas SEM o gabarito', async () => {
    const r = await get(U1, '/gerador/nexus/trilha/academia');
    expect(r.status).toBe(200);
    expect(r.body.aulas).toHaveLength(12);
    expect(JSON.stringify(r.body)).not.toMatch(/"certa":\s*\d/);
  });

  it('as 12 certas fecham o patamar 3', async () => {
    let ultima: any;
    for (const a of AULAS) ultima = await enviar(U1, 'post', `/gerador/nexus/trilha/academia/${a.id}`, { resposta: a.certa });
    expect(ultima.body.certa).toBe(true);
    expect(ultima.body.trilha).toMatchObject({ patamar: 4, preparo: { academia: { feitas: 12 } } });
    expect(linhaTrilha(U1).p3_em).toBeTruthy();
  });

  it('resposta errada não pontua nem revela a certa e trava SÓ aquela aula por 2 minutos (409 aguarde com os segundos)', async () => {
    const a01 = AULAS[0]!;
    const errada = (a01.certa + 1) % a01.opcoes.length;
    const r1 = await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a01', { resposta: errada });
    expect(r1.body).toMatchObject({ certa: false, aguarde_s: 120 });
    expect(r1.body.trilha.preparo.academia.feitas).toBe(0);
    expect(r1.body.trilha.preparo.academia.aulas.a01.libera_em).toBeTruthy();
    expect(JSON.stringify(r1.body)).not.toMatch(/"certa":\s*\d/);
    // mesma aula na hora: travada, mesmo com a resposta certa
    const r2 = await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a01', { resposta: a01.certa });
    expect(r2.status).toBe(409);
    expect(r2.body.erro).toBe('aguarde');
    expect(r2.body.segundos).toBeGreaterThan(100);
    expect(r2.body.segundos).toBeLessThanOrEqual(120);
    expect(linhaTrilha(U1).academia.a01.certa).toBe(false); // nada mudou
    // outra aula segue livre
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a02', { resposta: AULAS[1]!.certa })).body.certa).toBe(true);
    // passados os 2 minutos, libera
    linhaTrilha(U1).academia.a01.em = new Date(Date.now() - 121_000).toISOString();
    const r3 = await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a01', { resposta: a01.certa });
    expect(r3.body.certa).toBe(true);
    expect(r3.body.aguarde_s).toBeUndefined();
  });

  it('duas aulas respondidas ao mesmo tempo: nenhuma se perde no JSON da Academia', async () => {
    const [x, y] = await Promise.all([
      enviar(U1, 'post', '/gerador/nexus/trilha/academia/a03', { resposta: AULAS[2]!.certa }),
      enviar(U1, 'post', '/gerador/nexus/trilha/academia/a04', { resposta: AULAS[3]!.certa }),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(Object.keys(linhaTrilha(U1).academia).sort()).toEqual(['a03', 'a04']);
    expect(eventos(U1).filter((e) => e.tipo === 'academia_aula')).toHaveLength(2);
  });

  it('aula inexistente e resposta inválida recusam; quem escolheu mentoria não responde aula', async () => {
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a99', { resposta: 0 })).status).toBe(404);
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a01', { resposta: 'x' })).status).toBe(400);
    linhaTrilha(U1).preparo_formato = 'mentoria';
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/academia/a01', { resposta: 0 })).body).toEqual({ erro: 'etapa_bloqueada' });
  });
});

describe('reunião com o cliente (patamar 4)', () => {
  const corpo = (extra: Record<string, unknown> = {}) => ({ cliente_nome: 'Posto Exemplo', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto', preferencia: pref(), ...extra });
  beforeEach(() => semearTrilha(U1, { p1_em: D, p2_em: D, p3_em: D }));

  it('exige o Termo aceito', async () => {
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', corpo())).body).toEqual({ erro: 'termo_pendente' });
  });

  it('com o termo aceito: cliente_id e proposta_id de outro usuário são recusados; os próprios passam', async () => {
    Object.assign(banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!, { termo_versao: 'v1', termo_aceito_em: D });
    banco.poe('clients', { id: CLIENTE_U1, user_id: U1, nome: 'Posto A', tipo: 'PJ' }, { id: CLIENTE_U2, user_id: U2, nome: 'Posto B', tipo: 'PJ' });
    const PROP_U1 = '00000000-0000-4000-c000-000000000001';
    const PROP_U2 = '00000000-0000-4000-c000-000000000002';
    banco.poe('nexus_propostas', { id: PROP_U1, user_id: U1 }, { id: PROP_U2, user_id: U2 });
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', corpo({ cliente_id: CLIENTE_U2 }))).body).toEqual({ erro: 'cliente_invalido' });
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', corpo({ proposta_id: PROP_U2 }))).body).toEqual({ erro: 'proposta_invalida' });
    const r = await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', corpo({ cliente_id: CLIENTE_U1, proposta_id: PROP_U1 }));
    expect(r.status).toBe(200);
    expect(r.body.reuniao).toMatchObject({ dados: { cliente_id: CLIENTE_U1, proposta_id: PROP_U1 } });
    expect(r.body.proximo_passo.codigo).toBe('aguardar_reuniao');
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', corpo())).body).toEqual({ erro: 'ja_pedida' });
  });
});

describe('isolamento entre parceiros', () => {
  it('o parceiro A não lê nem grava a trilha do B, mesmo mandando o user_id do B no corpo', async () => {
    semearTrilha(U1, { raio_x: { anos_solar: '5+' } });
    semearTrilha(U2, { raio_x: { anos_solar: '0-1' } });
    expect((await get(U1)).body.raio_x.respostas).toEqual({ anos_solar: '5+' });
    expect((await get(U2)).body.raio_x.respostas).toEqual({ anos_solar: '0-1' });
    const r = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { user_id: U2, respostas: { usinas: '500+' } });
    expect(r.status).toBe(200);
    expect(linhaTrilha(U1).raio_x).toEqual({ anos_solar: '5+', usinas: '500+' });
    expect(linhaTrilha(U2).raio_x).toEqual({ anos_solar: '0-1' });
    await enviar(U1, 'post', '/gerador/nexus/trilha/diagnostico', { user_id: U2, preferencia: pref() });
    expect(linhaTrilha(U2).diag_pedido_em ?? null).toBeNull();
  });
});

describe('liberação pela trilha nas rotas que já checam `libera`', () => {
  it('com a trilha ligada a proposta Básica só abre no patamar 3; propostas antigas continuam visíveis', async () => {
    semearTrilha(U1, { p1_em: D, p2_em: D });
    expect((await enviar(U1, 'post', '/gerador/nexus/propostas', propostaOk('basico'))).body).toEqual({ erro: 'etapa_bloqueada' });
    expect((await get(U1, '/gerador/nexus/propostas')).status).toBe(200);
    linhaTrilha(U1).p3_em = D;
    expect((await enviar(U1, 'post', '/gerador/nexus/propostas', propostaOk('basico'))).status).toBe(201);
    const eu = await get(U1, '/gerador/nexus/eu');
    expect(eu.body.trilha_ligada).toBe(true);
    expect(eu.body.libera).toMatchObject({ basico: true, pedido: false });
  });
});

describe('equipe', () => {
  const equipeGet = (url: string) => request(app()).get(url).set(equipeAuth);
  const patch = (uid: string, corpo: unknown, auth: Record<string, string> = equipeAuth) => request(app()).patch(`/gerador/nexus/equipe/trilha/${uid}`).set(auth).send(corpo as object);

  it('recusa parceiro comum (403) e quem não está logado (401), nas quatro rotas', async () => {
    for (const [metodo, url] of [['get', '/gerador/nexus/equipe/trilha'], ['get', '/gerador/nexus/equipe/trilha-mapa'], ['get', `/gerador/nexus/equipe/trilha/${U2}`], ['patch', `/gerador/nexus/equipe/trilha/${U2}`]] as const) {
      const comum = await (request(app()) as any)[metodo](url).set(bearer(U1)).send({ acao: 'obs', texto: 'x' });
      expect(comum.status).toBe(403);
      expect((await (request(app()) as any)[metodo](url).send({})).status).toBe(401);
    }
    expect(banco.escritas.filter((e) => e.tabela.startsWith('nexus_trilha'))).toHaveLength(0);
  });

  it('avançar sem motivo é recusado (400) e não grava nada; com motivo fecha o patamar e grava o e-mail só no histórico da equipe', async () => {
    semearTrilha(U1);
    const sem = await patch(U1, { acao: 'avancar' });
    expect(sem.status).toBe(400);
    expect(sem.body.erro).toBe('motivo_obrigatorio');
    expect(linhaTrilha(U1).p1_em ?? null).toBeNull();
    const ok = await patch(U1, { acao: 'avancar', motivo: 'Já conhecemos a empresa' });
    expect(ok.status).toBe(200);
    expect(ok.body.patamar).toBe(2);
    expect(linhaTrilha(U1).p1_em).toBeTruthy();
    expect(eventos(U1).find((e) => e.tipo === 'avancar')).toMatchObject({ autor: EQUIPE_EMAIL, dados: { patamar: 1, motivo: 'Já conhecemos a empresa' } });
    // a ficha da equipe mostra o e-mail; a visão do parceiro NÃO
    expect(JSON.stringify(ok.body)).toContain(EQUIPE_EMAIL);
    const doParceiro = await get(U1);
    expect(JSON.stringify(doParceiro.body)).not.toContain(EQUIPE_EMAIL);
    expect(JSON.stringify(doParceiro.body)).not.toContain('Já conhecemos a empresa');
    expect(doParceiro.body.historico.find((h: { tipo: string }) => h.tipo === 'avancar')).toMatchObject({ autor: 'NEXUS' });
  });

  it('ações de diagnóstico: agendar e marcar "aprovado" fecha o patamar 2; responsável e observação ficam só na equipe', async () => {
    semearTrilha(U1, { p1_em: D, diag_pedido_em: D });
    const ag = await patch(U1, { acao: 'agendar_diagnostico', quando: new Date(Date.now() + 86_400_000).toISOString(), link: 'https://meet.exemplo.com/abc' });
    expect(ag.status).toBe(200);
    expect(ag.body.diagnostico.link).toBe('https://meet.exemplo.com/abc');
    const feito = await patch(U1, { acao: 'diagnostico_feito', resultado: 'aprovado', plano: 'Focar em postos' });
    expect(feito.body).toMatchObject({ patamar: 3, diagnostico: { resultado: 'aprovado', plano: 'Focar em postos' } });
    await patch(U1, { acao: 'responsavel', email: 'ana@irmaosnaobra.app' });
    await patch(U1, { acao: 'obs', texto: 'Cliente exigente' });
    const equipe = await equipeGet(`/gerador/nexus/equipe/trilha/${U1}`);
    expect(equipe.body.equipe).toMatchObject({ responsavel_email: 'ana@irmaosnaobra.app', obs_equipe: 'Cliente exigente' });
    expect(equipe.body.parceiro).toMatchObject({ user_id: U1, uf: 'MG' });
    expect(equipe.body.parceiro).not.toHaveProperty('lead_gerador_id');
    const doParceiro = JSON.stringify((await get(U1)).body);
    expect(doParceiro).not.toContain('ana@irmaosnaobra.app');
    expect(doParceiro).not.toContain('Cliente exigente');
  });

  it('ação fora de ordem é 409; id inválido 400; parceiro inexistente 404', async () => {
    semearTrilha(U1);
    expect((await patch(U1, { acao: 'diagnostico_feito', resultado: 'aprovado' })).body).toEqual({ erro: 'sem_pedido' });
    expect((await patch(U1, { acao: 'promover_regional' })).status).toBe(409);
    expect((await patch('nao-e-uuid', { acao: 'obs', texto: 'x' })).status).toBe(400);
    expect((await patch('00000000-0000-4000-8000-0000000000ff', { acao: 'obs', texto: 'x' })).status).toBe(404);
  });

  it('lista com resumo e filtros; ficha lê sem criar a linha; mapa de demanda conta por UF', async () => {
    semearTrilha(U1, { p1_em: D, diag_pedido_em: D, raio_x_nota: 90, raio_x: { demanda_12m: 8, quando: 'agora', dificuldades: ['cliente', 'preco'], clientes_em_vista: [{ nome: 'A', cidade: 'x', uf: 'MG', tipo_local: 'posto', fase: 'quente' }] } });
    const lista = await equipeGet('/gerador/nexus/equipe/trilha');
    expect(lista.status).toBe(200);
    expect(lista.body.ligada).toBe(true);
    expect(lista.body.parceiros).toHaveLength(2);
    expect(lista.body.resumo).toMatchObject({ total: 2, por_patamar: { 1: 1, 2: 1 }, por_fila: { agendar_diagnostico: 1 } });
    const u1 = lista.body.parceiros.find((p: { user_id: string }) => p.user_id === U1);
    expect(u1).toMatchObject({ patamar: 2, nota: 90, assinante: true, pendencia_equipe: 'agendar_diagnostico', demanda_12m: 8, clientes_em_vista: 1 });
    expect((await equipeGet('/gerador/nexus/equipe/trilha?patamar=2')).body.parceiros).toHaveLength(1);
    expect((await equipeGet('/gerador/nexus/equipe/trilha?fila=agendar_diagnostico')).body.parceiros).toHaveLength(1);
    expect((await equipeGet('/gerador/nexus/equipe/trilha?q=uberl')).body.parceiros).toHaveLength(2);
    expect((await equipeGet('/gerador/nexus/equipe/trilha?q=zzz')).body.parceiros).toHaveLength(0);

    const antes = banco.linhas('nexus_trilha').length;
    const ficha = await equipeGet(`/gerador/nexus/equipe/trilha/${U2}`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.patamar).toBe(1);
    expect(banco.linhas('nexus_trilha')).toHaveLength(antes);

    const mapa = await equipeGet('/gerador/nexus/equipe/trilha-mapa');
    expect(mapa.body).toMatchObject({
      ligada: true, total: 2, por_patamar: { 1: 1, 2: 1 }, por_uf: [{ uf: 'MG', parceiros: 2, demanda_12m: 8, clientes_em_vista: 1 }],
      por_tipo_local: { posto: 1 }, fases: { quente: 1 }, quando: { agora: 1 }, dificuldades: { cliente: 1, preco: 1 },
    });
  });
});

describe('legado de quem já comprou (um lugar só, sem evento duplicado)', () => {
  const comprou = () => { banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!.carregadores_comprados = 1; };

  it('linha que já existia (criada antes da compra) recebe os patamares que faltam, uma vez só', async () => {
    semearTrilha(U1, { p1_em: D });
    expect((await get(U1)).body.patamar).toBe(1 + 1); // ainda não comprou: p2 em curso
    comprou();
    const r = await get(U1);
    expect(r.body.patamar).toBe(6);
    expect(linhaTrilha(U1)).toMatchObject({ p2_em: expect.any(String), p3_em: expect.any(String), p4_em: expect.any(String) });
    expect(linhaTrilha(U1).p1_em).toBe(D); // o que já estava marcado não muda
    const legado = eventos(U1).filter((e) => e.tipo === 'legado');
    expect(legado).toHaveLength(1);
    expect(legado[0]!.dados).toEqual({ patamares: [2, 3, 4] });
    await get(U1);
    expect(eventos(U1).filter((e) => e.tipo === 'legado')).toHaveLength(1);
  });

  it('duas chamadas ao mesmo tempo gravam o legado e o evento uma vez só', async () => {
    comprou();
    await Promise.all([get(U1), get(U1), get(U1)]);
    expect(linhaTrilha(U1).p4_em).toBeTruthy();
    expect(eventos(U1).filter((e) => e.tipo === 'legado')).toHaveLength(1);
  });
});

describe('contexto() só lê: nunca cria a linha da trilha', () => {
  it('/eu e proposta com a trilha ligada e sem linha não gravam nada em nexus_trilha', async () => {
    const eu = await get(U1, '/gerador/nexus/eu');
    expect(eu.status).toBe(200);
    expect(eu.body.trilha_ligada).toBe(true);
    expect(eu.body.libera.basico).toBe(false); // patamar 1 em memória
    expect((await enviar(U1, 'post', '/gerador/nexus/propostas', propostaOk('basico'))).body).toEqual({ erro: 'etapa_bloqueada' });
    expect(banco.tabelas['nexus_trilha'] ?? []).toHaveLength(0);
    expect(banco.escritas.filter((e) => e.tabela.startsWith('nexus_trilha'))).toHaveLength(0);
  });

  it('quem já comprou tem o legado em memória (pedido liberado) sem nada gravado', async () => {
    banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!.carregadores_comprados = 1;
    const eu = await get(U1, '/gerador/nexus/eu');
    expect(eu.body.libera).toMatchObject({ pedido: true, basico: true, plataforma: true });
    expect(banco.tabelas['nexus_trilha'] ?? []).toHaveLength(0);
  });
});

describe('escrita concorrente na trilha', () => {
  it('dois encontros da mentoria seguidos somam 2 (e cada um grava o seu evento)', async () => {
    semearTrilha(U1, { p1_em: D, p2_em: D, preparo_formato: 'mentoria', mentoria_paga_em: D });
    const patch = () => request(app()).patch(`/gerador/nexus/equipe/trilha/${U1}`).set(equipeAuth).send({ acao: 'mentoria_encontro' });
    const [a, b] = await Promise.all([patch(), patch()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(linhaTrilha(U1).mentoria_encontros).toBe(2);
    expect(eventos(U1).filter((e) => e.tipo === 'mentoria_encontro').map((e) => e.dados.numero).sort()).toEqual([1, 2]);
    // em fila também
    await patch();
    await patch();
    expect(linhaTrilha(U1).mentoria_encontros).toBe(4);
    expect(linhaTrilha(U1).p3_em).toBeTruthy();
    expect(eventos(U1).filter((e) => e.tipo === 'patamar_concluido')).toHaveLength(1);
    expect((await patch()).body).toEqual({ erro: 'encontros_completos' });
  });

  it('dois "avançar" ao mesmo tempo fecham dois patamares seguidos, nunca o mesmo duas vezes', async () => {
    semearTrilha(U1);
    const av = () => request(app()).patch(`/gerador/nexus/equipe/trilha/${U1}`).set(equipeAuth).send({ acao: 'avancar', motivo: 'Teste de corrida' });
    await Promise.all([av(), av()]);
    expect(linhaTrilha(U1).p1_em).toBeTruthy();
    expect(linhaTrilha(U1).p2_em).toBeTruthy();
    expect(linhaTrilha(U1).p3_em ?? null).toBeNull();
    expect(eventos(U1).filter((e) => e.tipo === 'avancar').map((e) => e.dados.patamar).sort()).toEqual([1, 2]);
  });
});

describe('equipe: oportunidade só para o regional (trilha ligada)', () => {
  const FUTURO = new Date(Date.now() + 5 * 86_400_000).toISOString();
  function semearOportunidade() {
    banco.poe('nexus_oportunidades', {
      id: OP, tipo: 'cliente', cidade: 'Uberlândia', uf: 'MG', descricao: 'Posto na BR', valor_servico: null, prazo_aceite: FUTURO,
      parceiro_user_id: null, status: 'rascunho', etapas: [], contato: {}, created_at: D, updated_at: D,
    });
  }
  const OP = '00000000-0000-4000-a000-0000000000f1';
  const pro = () => Object.assign(banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!, { carregadores_comprados: 1, termo_versao: 'v1', termo_aceito_em: D });
  const oferecer = () => request(app()).patch(`/gerador/nexus/equipe/oportunidades/${OP}`).set(equipeAuth).send({ status: 'oferecida', parceiro_user_id: U1, prazo_aceite: FUTURO });
  const sugestoes = () => request(app()).get(`/gerador/nexus/equipe/oportunidades/${OP}/sugestoes`).set(equipeAuth);

  it('Pro com termo que NÃO é regional não recebe oferta nem aparece nas sugestões; promovido, aparece', async () => {
    semearOportunidade();
    pro();
    semearTrilha(U1, { p1_em: D, p2_em: D, p3_em: D, p4_em: D });
    semearTrilha(U2, { p1_em: D });
    const r = await oferecer();
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('sem_termo_aceito');
    const s1 = await sugestoes();
    expect(s1.status).toBe(200);
    expect(JSON.stringify(s1.body)).not.toContain(U1);
    linhaTrilha(U1).regional_em = D;
    const s2 = await sugestoes();
    expect(JSON.stringify(s2.body)).toContain(U1);
    expect(banco.escritas.filter((e) => e.tabela === 'nexus_trilha')).toHaveLength(0); // só leu
  });

  it('com a trilha desligada vale a regra antiga (Pro com termo recebe)', async () => {
    banco.trilhaLigada = false;
    semearOportunidade();
    pro();
    expect(JSON.stringify((await sugestoes()).body)).toContain(U1);
  });
});

describe('atualizarTrilha e garantirTrilha direto (corrida de verdade, sem passar pelo HTTP)', () => {
  const parceiroDe = () => banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!;
  const mais1 = (lida: Record<string, any>): Decisao => {
    const n = (Number(lida.mentoria_encontros) || 0) + 1;
    return { tipo: 'gravar', patch: { mentoria_encontros: n }, eventos: [{ tipo: 'mentoria_encontro', dados: { numero: n }, autor: 'x' }] };
  };

  it('duas gravações simultâneas somam 2 e cada evento sai uma vez', async () => {
    semearTrilha(U1);
    await Promise.all([atualizarTrilha(parceiroDe(), mais1), atualizarTrilha(parceiroDe(), mais1)]);
    expect(linhaTrilha(U1).mentoria_encontros).toBe(2);
    expect(eventos(U1).map((e) => e.dados.numero).sort()).toEqual([1, 2]);
  });

  it('se outra gravação passa na frente, nada é escrito com o estado velho: relê, decide de novo e grava um evento só', async () => {
    semearTrilha(U1);
    let chamadas = 0;
    const { t } = await atualizarTrilha(parceiroDe(), (lida) => {
      chamadas++;
      if (chamadas === 1) Object.assign(linhaTrilha(U1), { mentoria_encontros: 1, updated_at: '2026-11-02T00:00:00.000Z' }); // o outro passou na frente
      return mais1(lida);
    });
    expect(chamadas).toBe(2);
    expect(t.mentoria_encontros).toBe(2);
    expect(eventos(U1).map((e) => e.dados.numero)).toEqual([2]);
  });

  it('o legado, chamado em paralelo, grava e registra uma vez só', async () => {
    semearTrilha(U1, { p1_em: D });
    banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!.carregadores_comprados = 1;
    await Promise.all([garantirTrilha(parceiroDe()), garantirTrilha(parceiroDe()), garantirTrilha(parceiroDe())]);
    expect(linhaTrilha(U1).p4_em).toBeTruthy();
    expect(eventos(U1).filter((e) => e.tipo === 'legado')).toHaveLength(1);
  });
});

describe('cliente_id sem cidade ou UF é preenchido com o cliente do próprio usuário', () => {
  beforeEach(() => {
    banco.poe('clients',
      { id: CLIENTE_U1, user_id: U1, nome: 'Posto A', cidade: 'Araguari', uf: 'MG', tipo: 'PJ' },
      { id: CLIENTE_U2, user_id: U2, nome: 'Posto B', cidade: 'Goiânia', uf: 'GO', tipo: 'PJ' },
      { id: '00000000-0000-4000-b000-000000000003', user_id: U1, nome: 'Hotel C', cidade: 'Uberaba MG', uf: null, tipo: 'PJ' });
  });
  const so = (id: string) => ({ respostas: { clientes_em_vista: [{ cliente_id: id, tipo_local: 'posto', fase: 'quente' }] } });

  it('o prefill manda a UF de cada cliente PJ (separada da cidade quando veio junta)', async () => {
    const r = await get(U1);
    const pj = r.body.prefill.clientes_pj;
    expect(pj).toEqual(expect.arrayContaining([
      { id: CLIENTE_U1, nome: 'Posto A', cidade: 'Araguari', uf: 'MG' },
      { id: '00000000-0000-4000-b000-000000000003', nome: 'Hotel C', cidade: 'Uberaba', uf: 'MG' },
    ]));
    expect(JSON.stringify(pj)).not.toContain('Posto B');
  });

  it('Raio-X: só com cliente_id, tipo e fase, o servidor completa nome, cidade e UF', async () => {
    const r = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', so(CLIENTE_U1));
    expect(r.status).toBe(200);
    expect(linhaTrilha(U1).raio_x.clientes_em_vista).toEqual([
      { cliente_id: CLIENTE_U1, nome: 'Posto A', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto', fase: 'quente' },
    ]);
    const hotel = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', so('00000000-0000-4000-b000-000000000003'));
    expect(hotel.status).toBe(200);
    expect(linhaTrilha(U1).raio_x.clientes_em_vista[0]).toMatchObject({ nome: 'Hotel C', cidade: 'Uberaba', uf: 'MG' });
  });

  it('o que o parceiro mandou não é sobrescrito', async () => {
    const corpo = { respostas: { clientes_em_vista: [{ cliente_id: CLIENTE_U1, nome: 'Meu apelido', cidade: 'Uberlândia', uf: 'MG', tipo_local: 'hotel', fase: 'ideia' }] } };
    await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', corpo);
    expect(linhaTrilha(U1).raio_x.clientes_em_vista[0]).toMatchObject({ nome: 'Meu apelido', cidade: 'Uberlândia' });
  });

  it('cliente_id de OUTRO usuário segue recusado, com ou sem UF, e nada da linha dele vaza', async () => {
    const sem = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', so(CLIENTE_U2));
    expect(sem.status).toBe(400);
    expect(sem.body).toEqual({ erro: 'cliente_invalido' });
    const com = await enviar(U1, 'put', '/gerador/nexus/trilha/raio-x', { respostas: { clientes_em_vista: [{ cliente_id: CLIENTE_U2, nome: 'X', cidade: 'Y', uf: 'GO', tipo_local: 'posto', fase: 'ideia' }] } });
    expect(com.body).toEqual({ erro: 'cliente_invalido' });
    expect(JSON.stringify(linhaTrilha(U1)?.raio_x ?? {})).not.toContain('Goiânia');
  });

  it('reunião: cliente_id sem cidade e UF é completado; de outro usuário, recusado', async () => {
    semearTrilha(U1, { p1_em: D, p2_em: D, p3_em: D });
    Object.assign(banco.linhas('nexus_parceiros').find((p) => p.user_id === U1)!, { termo_versao: 'v1', termo_aceito_em: D });
    const base = { tipo_local: 'posto', preferencia: pref() };
    expect((await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', { ...base, cliente_id: CLIENTE_U2 })).body).toEqual({ erro: 'cliente_invalido' });
    const ok = await enviar(U1, 'post', '/gerador/nexus/trilha/reuniao', { ...base, cliente_id: CLIENTE_U1 });
    expect(ok.status).toBe(200);
    expect(ok.body.reuniao.dados).toMatchObject({ cliente_id: CLIENTE_U1, cliente_nome: 'Posto A', cidade: 'Araguari', uf: 'MG' });
  });
});
