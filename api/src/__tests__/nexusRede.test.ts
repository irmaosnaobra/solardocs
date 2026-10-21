import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { banco } from './_bancoFalso';
import { U1, U2, U3, app, bearer, equipeAuth, propostaOk, receita, semearParceiro } from './_nexusAjuda';

// A rede do Portal do Parceiro NEXUS (v2): oportunidades (só Pro, contato só depois do aceite, expira sozinha, cada
// resposta avisa a equipe), usinas, e as rotas da EQUIPE (consultor): parceiros com Partner e Montagem aprovada,
// pedidos que somam carregadores_comprados, oportunidades com sugestões, usinas, solicitações e os totais do painel.

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

import { resetSondaPortal } from '../services/nexus/repositorio';
import { placarDoParceiro, tempoDeRespostaMs } from '../routes/geradorNexusRede';

const OP = '00000000-0000-4000-a000-000000000001';
const futuro = () => new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
const passado = () => new Date(Date.now() - 3_600_000).toISOString();
const PRO = { partner_em: '2026-10-01T10:00:00Z', montagem_aprovada_em: '2026-10-02T10:00:00Z', carregadores_comprados: 1 };

function semearOportunidade(extra: Record<string, unknown> = {}) {
  const o = {
    id: OP, tipo: 'obra', cidade: 'Araguari', uf: 'MG', descricao: 'Instalar 1 carregador de 80 kW num posto.',
    valor_servico: null, prazo_aceite: futuro(), parceiro_user_id: U1, status: 'oferecida',
    etapas: [{ status: 'oferecida', em: '2026-10-20T10:00:00Z', obs: 'equipe' }],
    contato: { nome: 'Posto do Zé', telefone: '34988887777' }, origem_ref: '123', criado_por: 'thiago@irmaosnaobra.app',
    created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...extra,
  };
  banco.poe('nexus_oportunidades', o);
  return o;
}

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  resetSondaPortal();
  enviados.length = 0;
  emails.length = 0;
  consultor.tokens = { tc: { email: 'Thiago@irmaosnaobra.app', confirmado: true } };
  delete process.env.NEXUS_AVISO_LIGADO;
  delete process.env.NEXUS_AVISO_PHONE;
  receita('ativa');
});
afterEach(() => vi.unstubAllGlobals());

const ligarAviso = () => {
  process.env.NEXUS_AVISO_LIGADO = '1';
  process.env.NEXUS_AVISO_PHONE = '5511900000000';
};

describe('oportunidades do parceiro', () => {
  it('só o Pro vê: antes disso 403 etapa_bloqueada', async () => {
    semearParceiro(U1, { partner_em: '2026-10-01T10:00:00Z' });
    semearOportunidade();
    const r = await request(app()).get('/gerador/nexus/oportunidades').set(bearer(U1));
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ erro: 'etapa_bloqueada' });
    expect((await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({})).status).toBe(403);
  });

  it('lista só as oferecidas a ele, sem rascunho, e o contato só aparece depois do aceite', async () => {
    semearParceiro(U1, PRO);
    semearOportunidade();
    semearOportunidade({ id: '00000000-0000-4000-a000-000000000002', status: 'aceita' });
    semearOportunidade({ id: '00000000-0000-4000-a000-000000000003', status: 'rascunho' });
    semearOportunidade({ id: '00000000-0000-4000-a000-000000000004', parceiro_user_id: U2 });
    const r = await request(app()).get('/gerador/nexus/oportunidades').set(bearer(U1));
    expect(r.status).toBe(200);
    expect(r.body.oportunidades).toHaveLength(2);
    const oferecida = r.body.oportunidades.find((o: any) => o.status === 'oferecida');
    const aceita = r.body.oportunidades.find((o: any) => o.status === 'aceita');
    expect(oferecida).not.toHaveProperty('contato');
    expect(aceita.contato).toEqual({ nome: 'Posto do Zé', telefone: '34988887777' });
    for (const o of r.body.oportunidades) {
      expect(o).not.toHaveProperty('parceiro_user_id');
      expect(o).not.toHaveProperty('criado_por');
      expect(o).not.toHaveProperty('origem_ref');
    }
    expect(JSON.stringify(oferecida)).not.toContain('34988887777');
  });

  it('devolve o placar do parceiro e a distância até a oportunidade quando as duas cidades têm coordenada', async () => {
    semearParceiro(U1, PRO); // Uberlândia/MG
    semearOportunidade(); // Araguari/MG, oferecida
    semearOportunidade({ id: '00000000-0000-4000-a000-000000000002', cidade: 'Cidade Que Nao Existe', status: 'fechou',
      etapas: [{ status: 'oferecida', em: '2026-10-01T10:00:00Z' }, { status: 'aceita', em: '2026-10-01T10:30:00Z' }] });
    semearOportunidade({ id: '00000000-0000-4000-a000-000000000003', status: 'recusada',
      etapas: [{ status: 'oferecida', em: '2026-10-02T10:00:00Z' }, { status: 'recusada', em: '2026-10-02T11:30:00Z' }] });
    const r = await request(app()).get('/gerador/nexus/oportunidades').set(bearer(U1));
    expect(r.body.placar).toEqual({ aceitas: 1, recusadas: 1, total: 3, tempo_medio_min: 60 });
    const araguari = r.body.oportunidades.find((o: any) => o.status === 'oferecida');
    expect(araguari.distancia_km).toBeGreaterThan(20);
    expect(araguari.distancia_km).toBeLessThan(80);
    const sem = r.body.oportunidades.find((o: any) => o.status === 'fechou');
    expect(sem).not.toHaveProperty('distancia_km'); // sem coordenada, omite
  });

  it('oferecida com o prazo vencido vira expirada na leitura (sem cron) e não pode mais ser aceita', async () => {
    semearParceiro(U1, PRO);
    semearOportunidade({ prazo_aceite: passado() });
    const r = await request(app()).get('/gerador/nexus/oportunidades').set(bearer(U1));
    expect(r.body.oportunidades[0].status).toBe('expirada');
    expect(banco.linhas('nexus_oportunidades')[0].status).toBe('expirada');
    expect(banco.linhas('nexus_oportunidades')[0].etapas.at(-1).status).toBe('expirada');
    const a = await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({});
    expect(a.status).toBe(409);
    expect(a.body.erro).toBe('estado_invalido');
  });

  it('aceitar logo depois do prazo vencer: 409 expirada, sem contato', async () => {
    semearParceiro(U1, PRO);
    semearOportunidade({ prazo_aceite: passado() });
    const a = await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({});
    expect(a.status).toBe(409);
    expect(a.body.erro).toBe('expirada');
    expect(JSON.stringify(a.body)).not.toContain('34988887777');
  });

  it('aceitar: vira aceita, devolve o contato, registra a etapa e avisa a equipe (e) uma vez', async () => {
    ligarAviso();
    semearParceiro(U1, PRO);
    semearOportunidade();
    const r = await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({});
    expect(r.status).toBe(200);
    expect(r.body.oportunidade).toMatchObject({ status: 'aceita', contato: { nome: 'Posto do Zé', telefone: '34988887777' } });
    const linha = banco.linhas('nexus_oportunidades')[0];
    expect(linha.status).toBe('aceita');
    expect(linha.etapas.map((e: any) => e.status)).toEqual(['oferecida', 'aceita']);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toBe('Solar Exemplo aceitou a oportunidade em Araguari/MG.');
    // aceitar de novo: estado inválido, e o aviso não repete
    expect((await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({})).status).toBe(409);
    expect(enviados).toHaveLength(1);
  });

  it('recusar com motivo: vira recusada, guarda o motivo na etapa e o contato nunca é entregue', async () => {
    ligarAviso();
    semearParceiro(U1, PRO);
    semearOportunidade();
    const r = await request(app()).post(`/gerador/nexus/oportunidades/${OP}/recusar`).set(bearer(U1)).send({ motivo: 'Equipe ocupada' });
    expect(r.status).toBe(200);
    expect(r.body.oportunidade.status).toBe('recusada');
    expect(r.body.oportunidade).not.toHaveProperty('contato');
    expect(banco.linhas('nexus_oportunidades')[0].etapas.at(-1)).toMatchObject({ status: 'recusada', obs: 'Equipe ocupada' });
    expect(enviados[0].texto).toContain('recusou a oportunidade');
  });

  it('etapas: contato, visita, orçamento e fechou só depois do aceite; cada uma avisa; terminal não muda mais', async () => {
    ligarAviso();
    semearParceiro(U1, PRO);
    semearOportunidade();
    const etapa = (status: string, obs?: string) => request(app()).post(`/gerador/nexus/oportunidades/${OP}/etapa`).set(bearer(U1)).send({ status, obs });
    expect((await etapa('contato')).status).toBe(409); // ainda oferecida
    await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({});
    expect((await etapa('aceita')).status).toBe(400);  // status que o parceiro não escolhe
    expect((await etapa('contato')).status).toBe(200);
    expect((await etapa('visita', 'Quinta às 9h')).status).toBe(200);
    expect((await etapa('orcamento')).status).toBe(200);
    const fechou = await etapa('fechou');
    expect(fechou.status).toBe(200);
    expect(fechou.body.oportunidade.contato).toBeTruthy();
    expect((await etapa('perdeu')).status).toBe(409);
    expect(banco.linhas('nexus_oportunidades')[0].etapas.map((e: any) => e.status)).toEqual(['oferecida', 'aceita', 'contato', 'visita', 'orcamento', 'fechou']);
    expect(enviados.map((e) => e.texto)).toEqual([
      'Solar Exemplo aceitou a oportunidade em Araguari/MG.',
      'Solar Exemplo marcou a etapa Contato feito na oportunidade em Araguari/MG.',
      'Solar Exemplo marcou a etapa Visita agendada na oportunidade em Araguari/MG. Recado: Quinta às 9h.',
      'Solar Exemplo marcou a etapa Orçamento enviado na oportunidade em Araguari/MG.',
      'Solar Exemplo fechou a oportunidade em Araguari/MG.',
    ]);
  });

  it('oportunidade de outro parceiro: 404', async () => {
    semearParceiro(U1, PRO);
    semearParceiro(U2, PRO);
    semearOportunidade({ parceiro_user_id: U2 });
    expect((await request(app()).post(`/gerador/nexus/oportunidades/${OP}/aceitar`).set(bearer(U1)).send({})).status).toBe(404);
    expect(banco.linhas('nexus_oportunidades')[0].status).toBe('oferecida');
  });
});

describe('usinas do parceiro', () => {
  const usina = { dono_nome: 'Fazenda Boa Vista', whatsapp: '(34) 98888-7777', cidade: 'Araguari', uf: 'mg', distribuidora: 'CEMIG', potencia_kwp: 1000, geracao_kwh_mes: 140000, disponivel_kwh_mes: 90000, interesse: 'vender_creditos', obs: 'Usina de 2023' };

  it('exige perfil completo; grava, avisa (d) uma por usina e lista só as dele', async () => {
    ligarAviso();
    semearParceiro(U1, {}, {});
    banco.linhas('nexus_parceiros')[0].raio_km = null; // perfil incompleto
    expect((await request(app()).post('/gerador/nexus/usinas').set(bearer(U1)).send(usina)).status).toBe(403);
    banco.linhas('nexus_parceiros')[0].raio_km = 150;

    const r = await request(app()).post('/gerador/nexus/usinas').set(bearer(U1)).send(usina);
    expect(r.status).toBe(201);
    expect(banco.linhas('nexus_usinas')[0]).toMatchObject({ user_id: U1, uf: 'MG', whatsapp: '34988887777', potencia_kwp: 1000, interesse: 'vender_creditos', status: 'recebida' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('indicou uma usina: Fazenda Boa Vista em Araguari/MG');
    await request(app()).post('/gerador/nexus/usinas').set(bearer(U1)).send({ ...usina, dono_nome: 'Outra Fazenda' });
    expect(enviados).toHaveLength(2); // uma por usina

    semearParceiro(U2);
    await request(app()).post('/gerador/nexus/usinas').set(bearer(U2)).send(usina);
    const lista = await request(app()).get('/gerador/nexus/usinas').set(bearer(U1));
    expect(lista.body.usinas).toHaveLength(2);
    expect(lista.body.usinas[0]).not.toHaveProperty('obs_equipe');
  });

  it('valida dono, UF, interesse, WhatsApp e números', async () => {
    semearParceiro(U1);
    for (const ruim of [{ dono_nome: '' }, { uf: 'XX' }, { interesse: 'doar' }, { whatsapp: '123' }, { potencia_kwp: -5 }, { geracao_kwh_mes: 'muito' }]) {
      expect((await request(app()).post('/gerador/nexus/usinas').set(bearer(U1)).send({ ...usina, ...ruim })).status).toBe(400);
    }
    expect(banco.linhas('nexus_usinas')).toHaveLength(0);
  });
});

describe('rotas da equipe: acesso', () => {
  const rotas = [
    '/gerador/nexus/equipe/parceiros', '/gerador/nexus/equipe/propostas', '/gerador/nexus/equipe/pedidos',
    '/gerador/nexus/equipe/oportunidades', '/gerador/nexus/equipe/usinas', '/gerador/nexus/equipe/solicitacoes',
  ];

  it('exigem consultor: sem token 401, JWT do SolarDoc 401, conta de fora 403', async () => {
    consultor.tokens.fora = { email: 'qualquer@gmail.com', confirmado: true };
    for (const rota of rotas) {
      expect((await request(app()).get(rota)).status).toBe(401);
      expect((await request(app()).get(rota).set(bearer(U1))).status).toBe(401);
      expect((await request(app()).get(rota).set({ Authorization: 'Bearer fora' })).status).toBe(403);
    }
    expect((await request(app()).patch('/gerador/nexus/equipe/parceiros/x').send({ status: 'novo' })).status).toBe(401);
    expect((await request(app()).post('/gerador/nexus/equipe/oportunidades').send({})).status).toBe(401);
  });

  it('tabela ausente: 503 com consultor logado', async () => {
    banco.falhas['nexus_parceiros.select'] = { erro: { code: 'PGRST205', message: 'x' } };
    const r = await request(app()).get('/gerador/nexus/equipe/parceiros').set(equipeAuth);
    expect(r.status).toBe(503);
    expect(r.body.erro).toBe('portal_desligado');
  });
});

describe('equipe: parceiros', () => {
  it('lista parceiros com nível, contagens e os totais do painel', async () => {
    semearParceiro(U1, { partner_em: '2026-10-01T10:00:00Z' });
    await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('completo'));
    await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('basico'));
    banco.poe('nexus_pedidos', { id: 'pd1', user_id: U1, quantidade: 1, status: 'solicitado', created_at: new Date().toISOString() });
    banco.poe('nexus_pedidos', { id: 'pd2', user_id: U1, quantidade: 3, status: 'confirmado', confirmado_em: new Date().toISOString(), created_at: new Date().toISOString() });
    banco.poe('nexus_oportunidades', { id: 'o1', status: 'oferecida' });
    banco.poe('nexus_oportunidades', { id: 'o2', status: 'fechou' });
    banco.poe('nexus_usinas', { id: 'u1', user_id: U1, status: 'recebida' });
    banco.poe('nexus_usinas', { id: 'u2', user_id: U1, status: 'descartada' });
    banco.poe('nexus_solicitacoes', { id: 's1', user_id: U1, status: 'aberta' });
    const r = await request(app()).get('/gerador/nexus/equipe/parceiros').set(equipeAuth);
    expect(r.status).toBe(200);
    expect(r.body.parceiros).toHaveLength(1);
    expect(r.body.parceiros[0]).toMatchObject({
      empresa: 'Solar Exemplo', cnpj: '11222333000181', whatsapp: '34999990000', tem_logo: true, nivel: 'partner',
      propostas_total: 2, propostas_30d: 2, pedidos_total: 2,
    });
    expect(r.body.parceiros[0]).not.toHaveProperty('logo_base64');
    expect(r.body.totais).toEqual({
      parceiros: 1, novos_30d: 1, partners: 1, credenciados: 1, propostas_mes: 2, carregadores_mes: 4, valor_mes: 279960, empresas_ativas_mes: 1,
      pedidos_abertos: 1, carregadores_confirmados_mes: 3, oportunidades_abertas: 1, usinas_novas: 1, solicitacoes_abertas: 1,
    });
  });

  it('PATCH marca Partner, Montagem aprovada e conversa feita (true grava a hora, false limpa) e valida o corpo', async () => {
    const p = semearParceiro(U1);
    const auth = equipeAuth;
    const id = p.id as string;
    const a = await request(app()).patch(`/gerador/nexus/equipe/parceiros/${id}`).set(auth).send({
      status: 'em_contato', conversa_feita: true, partner: true, montagem_aprovada: true, notas_equipe: 'Ligar na quinta',
    });
    expect(a.status).toBe(200);
    expect(a.body.parceiro).toMatchObject({ status: 'em_contato', notas_equipe: 'Ligar na quinta' });
    for (const c of ['conversa_feita_em', 'partner_em', 'montagem_aprovada_em']) expect(a.body.parceiro[c]).toBeTruthy();
    const b = await request(app()).patch(`/gerador/nexus/equipe/parceiros/${id}`).set(auth).send({ partner: false });
    expect(b.body.parceiro.partner_em).toBeNull();
    expect(b.body.parceiro.conversa_feita_em).toBeTruthy(); // o que não veio no corpo fica como está

    expect((await request(app()).patch(`/gerador/nexus/equipe/parceiros/${id}`).set(auth).send({ status: 'vip' })).status).toBe(400);
    expect((await request(app()).patch(`/gerador/nexus/equipe/parceiros/${id}`).set(auth).send({ partner: 'sim' })).status).toBe(400);
    expect((await request(app()).patch(`/gerador/nexus/equipe/parceiros/${id}`).set(auth).send({})).status).toBe(400);
    expect((await request(app()).patch(`/gerador/nexus/equipe/parceiros/${U2}`).set(auth).send({ status: 'novo' })).status).toBe(404);

    const eu = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(eu.body.parceiro).not.toHaveProperty('notas_equipe'); // a nota da equipe nunca aparece para o parceiro
    expect(eu.body.libera.pedido).toBe(false); // o Partner foi desfeito
  });

  it('propostas de todos, com empresa e cidade do parceiro; ?desde inválido é 400', async () => {
    semearParceiro(U1);
    await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('simulador'));
    const r = await request(app()).get('/gerador/nexus/equipe/propostas').set(equipeAuth);
    expect(r.status).toBe(200);
    expect(r.body.propostas).toHaveLength(1);
    expect(r.body.propostas[0]).toMatchObject({ empresa: 'Solar Exemplo', cidade_parceiro: 'Uberlândia', cliente_cidade: 'Araguari', quantidade: 2 });
    expect(r.body.propostas[0]).not.toHaveProperty('dados');
    expect(r.body.propostas[0].user_id).toBe(U1);
    expect((await request(app()).get('/gerador/nexus/equipe/propostas?desde=2099-01-01').set(equipeAuth)).body.propostas).toHaveLength(0);
    expect((await request(app()).get('/gerador/nexus/equipe/propostas?desde=ontem').set(equipeAuth)).status).toBe(400);
  });
});

describe('equipe: pedidos', () => {
  it('confirmar soma em carregadores_comprados e leva o parceiro a Pro; cancelar desfaz', async () => {
    semearParceiro(U1, { partner_em: '2026-10-01T10:00:00Z', montagem_aprovada_em: '2026-10-02T10:00:00Z' });
    const mk = async (quantidade: number) => {
      const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ modelo: 'nexus-dc-80', quantidade });
      return r.body.id as string;
    };
    const p1 = await mk(2);
    const p2 = await mk(3);
    const lista = await request(app()).get('/gerador/nexus/equipe/pedidos').set(equipeAuth);
    expect(lista.body.pedidos).toHaveLength(2);
    expect(lista.body.pedidos[0]).toMatchObject({ empresa: 'Solar Exemplo', user_id: U1, whatsapp_parceiro: '34999990000', proposta_numero: null });

    const a = await request(app()).patch(`/gerador/nexus/equipe/pedidos/${p1}`).set(equipeAuth).send({ status: 'confirmado', valor_negociado: 129000.5, obs_equipe: 'Fechado por telefone' });
    expect(a.status).toBe(200);
    expect(a.body.pedido).toMatchObject({ status: 'confirmado', valor_negociado: 129000.5, obs_equipe: 'Fechado por telefone' });
    expect(a.body.pedido.confirmado_em).toBeTruthy();
    expect(a.body.carregadores_comprados).toBe(2);
    expect(banco.linhas('nexus_parceiros')[0].carregadores_comprados).toBe(2);
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.nivel).toBe('pro');

    const primeira = a.body.pedido.confirmado_em;
    const b = await request(app()).patch(`/gerador/nexus/equipe/pedidos/${p1}`).set(equipeAuth).send({ status: 'confirmado' });
    expect(b.body.pedido.confirmado_em).toBe(primeira); // reconfirmar não muda a data

    await request(app()).patch(`/gerador/nexus/equipe/pedidos/${p2}`).set(equipeAuth).send({ status: 'confirmado' });
    const eu = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(eu.body.parceiro.carregadores_comprados).toBe(5);
    expect(eu.body.nivel).toBe('master');

    const c = await request(app()).patch(`/gerador/nexus/equipe/pedidos/${p2}`).set(equipeAuth).send({ status: 'cancelado' });
    expect(c.body.carregadores_comprados).toBe(2);
    expect(c.body.pedido.confirmado_em).toBeNull();
    expect((await request(app()).get('/gerador/nexus/eu').set(bearer(U1))).body.nivel).toBe('pro');
  });

  it('valida status e valor; pedido inexistente é 404', async () => {
    semearParceiro(U1, { partner_em: '2026-10-01T10:00:00Z' });
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ modelo: 'nexus-dc-120', quantidade: 1 });
    const id = r.body.id as string;
    for (const ruim of [{ status: 'pago' }, { valor_negociado: -1 }, { valor_negociado: 'caro' }, {}]) {
      expect((await request(app()).patch(`/gerador/nexus/equipe/pedidos/${id}`).set(equipeAuth).send(ruim)).status).toBe(400);
    }
    expect((await request(app()).patch(`/gerador/nexus/equipe/pedidos/${U3}`).set(equipeAuth).send({ status: 'negociando' })).status).toBe(404);
  });
});

describe('equipe: oportunidades', () => {
  const nova = { tipo: 'obra', cidade: 'Araguari', uf: 'mg', descricao: 'Instalar 1 carregador de 80 kW.', prazo_aceite: futuro(), contato: { nome: 'Posto do Zé', telefone: '(34) 98888-7777' }, origem_ref: '55' };

  it('cria como rascunho com o consultor, valida o corpo e lista', async () => {
    const r = await request(app()).post('/gerador/nexus/equipe/oportunidades').set(equipeAuth).send(nova);
    expect(r.status).toBe(201);
    expect(r.body.oportunidade).toMatchObject({
      tipo: 'obra', cidade: 'Araguari', uf: 'MG', status: 'rascunho', parceiro_user_id: null, criado_por: 'thiago@irmaosnaobra.app',
      contato: { nome: 'Posto do Zé', telefone: '34988887777' },
    });
    expect(r.body.oportunidade.etapas).toHaveLength(1);
    for (const ruim of [{ tipo: 'outro' }, { cidade: '' }, { uf: 'XX' }, { descricao: '' }, { prazo_aceite: 'amanhã' }, { contato: 'x' }]) {
      expect((await request(app()).post('/gerador/nexus/equipe/oportunidades').set(equipeAuth).send({ ...nova, ...ruim })).status).toBe(400);
    }
    const lista = await request(app()).get('/gerador/nexus/equipe/oportunidades').set(equipeAuth);
    expect(lista.body.oportunidades).toHaveLength(1);
    expect(lista.body.oportunidades[0].contato).toBeTruthy(); // a equipe vê tudo
    expect(lista.body.oportunidades[0]).toHaveProperty('empresa'); // nome da empresa do parceiro oferecido (null no rascunho)
  });

  it('oferecer exige parceiro Pro, prazo no futuro e vira oferecida com a etapa; o parceiro passa a ver', async () => {
    semearParceiro(U1, PRO);
    semearParceiro(U2, { partner_em: '2026-10-01T10:00:00Z' }); // Partner, ainda não Pro
    const c = await request(app()).post('/gerador/nexus/equipe/oportunidades').set(equipeAuth).send(nova);
    const id = c.body.oportunidade.id as string;
    const patch = (corpo: Record<string, unknown>) => request(app()).patch(`/gerador/nexus/equipe/oportunidades/${id}`).set(equipeAuth).send(corpo);

    expect((await patch({ status: 'oferecida' })).body.erro).toBe('parceiro_obrigatorio');
    expect((await patch({ status: 'oferecida', parceiro_user_id: U2 })).body.erro).toBe('parceiro_sem_nivel');
    expect((await patch({ status: 'oferecida', parceiro_user_id: U3 })).body.erro).toBe('parceiro_invalido');
    expect((await patch({ status: 'oferecida', parceiro_user_id: U1, prazo_aceite: passado() })).body.erro).toBe('prazo_invalido');
    expect((await patch({ status: 'inventado' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);

    const ok = await patch({ status: 'oferecida', parceiro_user_id: U1, valor_servico: 'R$ 4.500 a combinar' });
    expect(ok.status).toBe(200);
    expect(ok.body.oportunidade).toMatchObject({ status: 'oferecida', parceiro_user_id: U1, valor_servico: 'R$ 4.500 a combinar' });
    expect(ok.body.oportunidade.etapas.map((e: any) => e.status)).toEqual(['rascunho', 'oferecida']);
    expect(enviados).toHaveLength(0); // nada por WhatsApp ao parceiro: ele vê no portal

    const vista = await request(app()).get('/gerador/nexus/oportunidades').set(bearer(U1));
    expect(vista.body.oportunidades).toHaveLength(1);
    expect(vista.body.oportunidades[0]).not.toHaveProperty('contato');
  });

  it('trocar o parceiro só vale em rascunho, recusada ou expirada; em andamento responde 409 oportunidade_em_andamento', async () => {
    semearParceiro(U1, PRO);
    semearParceiro(U2, { ...PRO, cidade: 'Araguari' }, { cnpj: '11444777000161' });
    const patch = (corpo: Record<string, unknown>) => request(app()).patch(`/gerador/nexus/equipe/oportunidades/${OP}`).set(equipeAuth).send(corpo);

    for (const status of ['oferecida', 'aceita', 'contato', 'visita', 'orcamento', 'fechou', 'perdeu']) {
      banco.reset();
      semearParceiro(U1, PRO);
      semearParceiro(U2, { ...PRO, cidade: 'Araguari' }, { cnpj: '11444777000161' });
      semearOportunidade({ status, parceiro_user_id: U1 });
      const r = await patch({ parceiro_user_id: U2 });
      expect([status, r.status, r.body.erro]).toEqual([status, 409, 'oportunidade_em_andamento']);
      expect(banco.linhas('nexus_oportunidades')[0].parceiro_user_id).toBe(U1);
    }

    // o mesmo parceiro de novo (por exemplo, só ajustar o prazo) não é troca e passa
    banco.reset();
    semearParceiro(U1, PRO);
    semearOportunidade({ status: 'oferecida', parceiro_user_id: U1 });
    expect((await patch({ parceiro_user_id: U1, prazo_aceite: futuro() })).status).toBe(200);

    // recusada, expirada e rascunho aceitam a troca; reoferecer a outro parceiro registra nova etapa 'oferecida'
    for (const status of ['recusada', 'expirada', 'rascunho']) {
      banco.reset();
      semearParceiro(U1, PRO);
      semearParceiro(U2, { ...PRO, cidade: 'Araguari' }, { cnpj: '11444777000161' });
      semearOportunidade({ status, parceiro_user_id: U1, prazo_aceite: futuro() });
      const r = await patch({ parceiro_user_id: U2, status: 'oferecida' });
      expect([status, r.status]).toEqual([status, 200]);
      expect(r.body.oportunidade).toMatchObject({ status: 'oferecida', parceiro_user_id: U2 });
    }
  });

  it('placar e tempo de resposta usam a ÚLTIMA oferta e a resposta depois dela (reoferta não herda o parceiro anterior)', async () => {
    semearParceiro(U1, PRO);
    // U1 recusou em 1 h; foi reoferecida a ele depois de 10 dias e ele aceitou em 3 h: vale 3 h, não 1 h
    banco.poe('nexus_oportunidades',
      {
        id: 'r1', parceiro_user_id: U1, status: 'aceita',
        etapas: [
          { status: 'oferecida', em: '2026-10-01T10:00:00Z' }, { status: 'recusada', em: '2026-10-01T11:00:00Z' },
          { status: 'oferecida', em: '2026-10-11T10:00:00Z' }, { status: 'aceita', em: '2026-10-11T13:00:00Z' },
        ],
      },
      {
        // reoferecida a U1 e ainda sem resposta: a recusa do parceiro anterior não conta como resposta dele
        id: 'r2', parceiro_user_id: U1, status: 'oferecida',
        etapas: [
          { status: 'oferecida', em: '2026-10-05T10:00:00Z' }, { status: 'recusada', em: '2026-10-05T10:05:00Z' },
          { status: 'oferecida', em: '2026-10-12T10:00:00Z' },
        ],
      });
    semearOportunidade({ parceiro_user_id: null, status: 'rascunho' });
    const r = await request(app()).get(`/gerador/nexus/equipe/oportunidades/${OP}/sugestoes`).set(equipeAuth);
    expect(r.body.sugestoes[0].placar).toEqual({ aceitas: 1, recusadas: 0, tempo_medio_resposta_h: 3 });

    // o placar que o parceiro vê (minutos) segue a mesma regra
    expect(placarDoParceiro(banco.linhas('nexus_oportunidades').filter((o) => o.id !== OP))).toMatchObject({ aceitas: 1, tempo_medio_min: 180 });
    expect(tempoDeRespostaMs([{ status: 'oferecida', em: '2026-10-12T10:00:00Z' }])).toBeNull();
    expect(tempoDeRespostaMs(null)).toBeNull();
  });

  it('sugestões: só Pro ou Master da mesma UF, com cidade, raio e placar (aceitas, recusadas, tempo de resposta)', async () => {
    semearParceiro(U1, PRO);                                                    // Pro, MG, Uberlândia
    semearParceiro(U2, { ...PRO, cidade: 'Araguari', carregadores_comprados: 6 }, { cnpj: '11444777000161' }); // Master, MG, Araguari
    semearParceiro(U3, { ...PRO, uf: 'GO', cidade: 'Goiânia' }, { cnpj: '22333444000199' }); // Pro, mas outra UF
    const fora = semearParceiro('00000000-0000-4000-8000-000000000004', { partner_em: '2026-10-01T10:00:00Z' }, { cnpj: '33444555000100' }); // Partner
    void fora;
    // histórico do U1: 2 aceitas (uma fechou) e 1 recusada; resposta em 2 h na primeira e 4 h na segunda
    banco.poe('nexus_oportunidades',
      { id: 'h1', parceiro_user_id: U1, status: 'fechou', etapas: [{ status: 'oferecida', em: '2026-10-01T10:00:00Z' }, { status: 'aceita', em: '2026-10-01T12:00:00Z' }] },
      { id: 'h2', parceiro_user_id: U1, status: 'aceita', etapas: [{ status: 'oferecida', em: '2026-10-02T10:00:00Z' }, { status: 'aceita', em: '2026-10-02T14:00:00Z' }] },
      { id: 'h3', parceiro_user_id: U1, status: 'recusada', etapas: [{ status: 'oferecida', em: '2026-10-03T10:00:00Z' }, { status: 'recusada', em: '2026-10-03T16:00:00Z' }] });
    semearOportunidade({ parceiro_user_id: null, status: 'rascunho' });

    const r = await request(app()).get(`/gerador/nexus/equipe/oportunidades/${OP}/sugestoes`).set(equipeAuth);
    expect(r.status).toBe(200);
    expect(r.body.sugestoes.map((s: any) => s.user_id)).toEqual([U2, U1]); // mesma cidade (Araguari) primeiro
    const u1 = r.body.sugestoes.find((s: any) => s.user_id === U1);
    expect(u1).toMatchObject({ empresa: 'Solar Exemplo', cidade: 'Uberlândia', uf: 'MG', raio_km: 150, nivel: 'pro', whatsapp: '34999990000' });
    expect(u1.placar).toEqual({ aceitas: 2, recusadas: 1, tempo_medio_resposta_h: 4 });
    expect(r.body.sugestoes[0].nivel).toBe('master');
    expect(r.body.sugestoes[0].placar).toEqual({ aceitas: 0, recusadas: 0, tempo_medio_resposta_h: null });
    expect((await request(app()).get(`/gerador/nexus/equipe/oportunidades/${U3}/sugestoes`).set(equipeAuth)).status).toBe(404);
  });
});

describe('equipe: usinas e solicitações', () => {
  it('lista com a empresa e atualiza status e nota; valida', async () => {
    semearParceiro(U1);
    banco.poe('nexus_usinas', { id: '00000000-0000-4000-b000-000000000001', user_id: U1, dono_nome: 'Fazenda', status: 'recebida', created_at: '2026-10-20T10:00:00Z' });
    banco.poe('nexus_solicitacoes', { id: '00000000-0000-4000-c000-000000000001', user_id: U1, tipo: 'engenharia', dados: {}, status: 'aberta', created_at: '2026-10-20T10:00:00Z' });
    const us = await request(app()).get('/gerador/nexus/equipe/usinas').set(equipeAuth);
    expect(us.body.usinas[0]).toMatchObject({ dono_nome: 'Fazenda', empresa: 'Solar Exemplo', cidade_parceiro: 'Uberlândia' });
    const so = await request(app()).get('/gerador/nexus/equipe/solicitacoes').set(equipeAuth);
    expect(so.body.solicitacoes[0]).toMatchObject({ tipo: 'engenharia', empresa: 'Solar Exemplo', whatsapp_parceiro: '34999990000' });

    const u = await request(app()).patch('/gerador/nexus/equipe/usinas/00000000-0000-4000-b000-000000000001').set(equipeAuth).send({ status: 'em_analise', obs_equipe: 'Visitar em novembro' });
    expect(u.status).toBe(200);
    expect(u.body.usina).toMatchObject({ status: 'em_analise', obs_equipe: 'Visitar em novembro' });
    const s = await request(app()).patch('/gerador/nexus/equipe/solicitacoes/00000000-0000-4000-c000-000000000001').set(equipeAuth).send({ status: 'concluida' });
    expect(s.body.solicitacao.status).toBe('concluida');

    expect((await request(app()).patch('/gerador/nexus/equipe/usinas/00000000-0000-4000-b000-000000000001').set(equipeAuth).send({ status: 'aberta' })).status).toBe(400);
    expect((await request(app()).patch('/gerador/nexus/equipe/solicitacoes/00000000-0000-4000-c000-000000000001').set(equipeAuth).send({})).status).toBe(400);
    expect((await request(app()).patch(`/gerador/nexus/equipe/usinas/${U3}`).set(equipeAuth).send({ status: 'contrato' })).status).toBe(404);
    expect((await request(app()).get('/gerador/nexus/equipe/usinas?status=xx').set(equipeAuth)).status).toBe(400);
    expect((await request(app()).get('/gerador/nexus/equipe/usinas?status=descartada').set(equipeAuth)).body.usinas).toHaveLength(0);
  });
});
