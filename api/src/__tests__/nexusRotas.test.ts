import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { banco } from './_bancoFalso';
import { CNPJ, LOGO, U1, U2, app, bearer, empresaDaConta, propostaOk, receita, semearParceiro } from './_nexusAjuda';

// Rotas do parceiro do Portal do Parceiro NEXUS (v2) com o banco principal simulado: status ligado e desligado (42P01
// e PGRST205, sonda de 6 tabelas), /eu (nível, catálogo 69.990/89.990 sem preço de revenda, contagens), 403 para CNPJ
// inativo sem criar nada, perfil, propostas travadas por perfil, pedidos (só Partner), solicitações (travas e avisos)
// e a procura (cache de 6 h). Nenhuma chamada sai para a rede.

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const h = vi.hoisted(() => ({
  agendamentos: [] as Array<{ created_at: string; cidade: string | null }>,
  chamadasAgendamentos: 0,
}));

vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'sem consultor neste arquivo' } })) },
    from: (tabela: string) => {
      const q: any = {
        select: () => q, eq: () => q, ilike: () => q, gte: () => q, order: () => q,
        // agendamentos: paginado por range; eletroposto_parceria (lead do integrador): sem ficha.
        range: (de: number, ate: number) => {
          h.chamadasAgendamentos++;
          return Promise.resolve({ data: h.agendamentos.slice(de, ate + 1), error: null });
        },
        limit: () => Promise.resolve({ data: [], error: null }),
      };
      void tabela;
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
import { anoBRT } from '../services/nexus/tempo';
import { agregarProcura, resetCacheProcura, ufDaCidade, ultimosSeisMeses } from '../services/nexus/procura';

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  resetSondaPortal();
  resetCacheProcura();
  enviados.length = 0;
  emails.length = 0;
  h.agendamentos = [];
  h.chamadasAgendamentos = 0;
  delete process.env.NEXUS_AVISO_LIGADO;
  delete process.env.NEXUS_AVISO_PHONE;
  receita('ativa');
});
afterEach(() => vi.unstubAllGlobals());

const ligarAviso = () => {
  process.env.NEXUS_AVISO_LIGADO = '1';
  process.env.NEXUS_AVISO_PHONE = '5511900000000';
};

describe('GET /gerador/nexus/status', () => {
  it('ligado quando as 6 tabelas existem', async () => {
    const r = await request(app()).get('/gerador/nexus/status');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ligado: true });
  });

  it.each(['42P01', 'PGRST205'])('desligado quando a tabela não existe (%s)', async (code) => {
    banco.falhas['nexus_parceiros.select'] = { erro: { code, message: 'x' } };
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: false });
  });

  it.each(['nexus_pedidos', 'nexus_oportunidades', 'nexus_usinas', 'nexus_solicitacoes'])('desligado se só a tabela %s faltar', async (t) => {
    banco.falhas[`${t}.select`] = { erro: { code: '42P01', message: 'x' } };
    expect((await request(app()).get('/gerador/nexus/status')).body).toEqual({ ligado: false });
  });

  it('erro passageiro do banco não desliga o portal por 60 s', async () => {
    banco.falhas['nexus_parceiros.select'] = { erro: { code: '57014', message: 'timeout' }, uma: true };
    expect((await request(app()).get('/gerador/nexus/status')).body.ligado).toBe(true);
    expect((await request(app()).get('/gerador/nexus/status')).body.ligado).toBe(true);
  });

  it('guarda a resposta por 60 s: a segunda chamada não vai ao banco', async () => {
    await request(app()).get('/gerador/nexus/status');
    banco.falhas['nexus_parceiros.select'] = { erro: { code: '42P01', message: 'x' } };
    expect((await request(app()).get('/gerador/nexus/status')).body.ligado).toBe(true); // ainda no cache
    resetSondaPortal();
    expect((await request(app()).get('/gerador/nexus/status')).body.ligado).toBe(false);
  });
});

describe('portal desligado (tabela ausente)', () => {
  it('rotas do parceiro respondem 503 portal_desligado', async () => {
    banco.falhas['nexus_usinas.select'] = { erro: { code: '42P01', message: 'x' } };
    for (const rota of ['/gerador/nexus/eu', '/gerador/nexus/propostas', '/gerador/nexus/pedidos', '/gerador/nexus/oportunidades', '/gerador/nexus/usinas']) {
      const r = await request(app()).get(rota).set(bearer(U1));
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ erro: 'portal_desligado' });
    }
  });
});

describe('GET /gerador/nexus/cnpj/:cnpj (público)', () => {
  it('CNPJ ativo devolve a razão social', async () => {
    const r = await request(app()).get(`/gerador/nexus/cnpj/${CNPJ}`);
    expect(r.body).toEqual({ ok: true, ativa: true, razao_social: 'SOLAR EXEMPLO LTDA', nome_fantasia: 'Solar Exemplo' });
  });
  it('CNPJ inativo, inválido e Receita fora', async () => {
    receita('baixada');
    expect((await request(app()).get(`/gerador/nexus/cnpj/${CNPJ}`)).body).toMatchObject({ ok: true, ativa: false });
    expect((await request(app()).get('/gerador/nexus/cnpj/123')).body).toEqual({ ok: false, motivo: 'invalido' });
    receita('fora');
    expect((await request(app()).get(`/gerador/nexus/cnpj/${CNPJ}`)).body).toEqual({ ok: false, motivo: 'indisponivel' });
  });
});

describe('GET /gerador/nexus/eu', () => {
  it('sem token: 401', async () => {
    expect((await request(app()).get('/gerador/nexus/eu')).status).toBe(401);
  });

  it('cria o parceiro na primeira chamada e devolve nível, progresso, catálogo de 69.990/89.990 sem preço de revenda', async () => {
    empresaDaConta();
    process.env.NEXUS_PRECO_REVENDA_DC80 = '99000'; // env antiga: não pode mais vazar
    const r = await request(app()).get('/gerador/nexus/eu?origem=partner_lp&utm_source=meta&utm_campaign=outubro').set(bearer(U1));
    delete process.env.NEXUS_PRECO_REVENDA_DC80;
    expect(r.status).toBe(200);
    expect(r.body.parceiro).toMatchObject({ user_id: U1, cnpj: CNPJ, cnpj_situacao: 'ativa', origem: 'partner_lp', cidade: 'Uberlândia', status: 'novo' });
    expect(r.body.parceiro.utm).toEqual({ utm_source: 'meta', utm_campaign: 'outubro' });
    expect(r.body.parceiro).not.toHaveProperty('notas_equipe');
    expect(r.body.parceiro).not.toHaveProperty('lead_gerador_id');
    expect(r.body.nivel).toBe('cadastrado');
    expect(r.body.progresso).toEqual({ proximo: 'partner', faltam: ['perfil', 'primeira_proposta', 'conversa', 'aprovacao_partner'] });
    expect(r.body.libera).toMatchObject({ simulador: true, basico: false, pedido: false, oportunidades: false });
    expect(r.body).not.toHaveProperty('trilha');
    expect(r.body.catalogo.produtos.map((p: any) => [p.id, p.precoSugerido])).toEqual([['nexus-dc-80', 69990], ['nexus-dc-120', 89990]]);
    expect(JSON.stringify(r.body.catalogo)).not.toMatch(/precoRevenda|99000/);
    const [dc80, dc120] = r.body.catalogo.produtos;
    expect(dc80.specs).toEqual({
      conectores: 'CCS2, 2 plugues', atendimento: 'Dois carros ao mesmo tempo', comunicacao: 'OCPP 1.6J', refrigeracao: 'Ativa',
      tela: 'Sensível ao toque', monitoramento: 'Telemetria de cada tomada em tempo real', corrente: 'Contínua (DC)',
      tensaoEntrada: null, eficiencia: null, protecao: null, certificacao: null, garantia: null, dimensoes: null,
    });
    expect(dc120.specs.atendimento).toBe('Divide a potência entre as vagas');
    expect(dc120.specs.garantia).toBeNull();
    expect(r.body.entrega).toBe('Entrega na primeira quinzena de dezembro');
    expect(r.body.financiamento).toEqual({ parcelas: 96, carenciaDias: 120, taxaRefMensal: 1.49 });
    expect(r.body.contagens).toEqual({ propostas_mes: 0, pedidos: 0, oportunidades_recebidas: 0, usinas: 0 });
    expect(r.body.whatsappComercial).toBe('5534998165040');
    expect(r.body.empresa).toMatchObject({ nome: 'SOLAR EXEMPLO LTDA', cnpj: CNPJ, whatsapp: '34999990000', logo_base64: null });
    expect(banco.linhas('nexus_parceiros')).toHaveLength(1);
  });

  it('origem fora da lista vira portal; chamada repetida não cria outro parceiro', async () => {
    empresaDaConta();
    const a = await request(app()).get('/gerador/nexus/eu?origem=qualquer_coisa').set(bearer(U1));
    expect(a.body.parceiro.origem).toBe('portal');
    const r = await request(app()).get('/gerador/nexus/eu?origem=anuncio').set(bearer(U1));
    expect(r.body.parceiro.origem).toBe('portal'); // a origem fica a da criação
    expect(banco.linhas('nexus_parceiros')).toHaveLength(1);
  });

  it('CNPJ inativo na Receita: 403 cnpj_inativo e nada é criado', async () => {
    empresaDaConta();
    receita('baixada');
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ erro: 'cnpj_inativo' });
    expect(banco.escritas.filter((e) => e.tabela === 'nexus_parceiros')).toHaveLength(0);
  });

  it('Receita fora do ar: cria como nao_verificado', async () => {
    empresaDaConta();
    receita('fora');
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.status).toBe(200);
    expect(r.body.parceiro.cnpj_situacao).toBe('nao_verificado');
    expect(r.body.libera.simulador).toBe(true);
  });

  it('conta sem empresa/CNPJ: 409 sem_cnpj', async () => {
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ erro: 'sem_cnpj' });
  });

  it('o aviso (a) sai uma vez só, com a env ligada', async () => {
    empresaDaConta();
    ligarAviso();
    await request(app()).get('/gerador/nexus/eu?origem=solardoc').set(bearer(U1));
    await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('Parceiro NEXUS novo: Solar Exemplo');
    expect(enviados[0].texto).toContain('Origem: solardoc');
  });

  it('as contagens vêm do banco e o nível acompanha a equipe', async () => {
    semearParceiro(U1, { partner_em: '2026-10-20T10:00:00Z', montagem_aprovada_em: '2026-10-20T10:00:00Z', carregadores_comprados: 1 });
    banco.poe('nexus_pedidos', { id: 'x1', user_id: U1, status: 'confirmado', quantidade: 1 });
    banco.poe('nexus_usinas', { id: 'x2', user_id: U1 });
    banco.poe('nexus_oportunidades', { id: 'x3', parceiro_user_id: U1, status: 'oferecida' });
    banco.poe('nexus_oportunidades', { id: 'x4', parceiro_user_id: U1, status: 'rascunho' });
    const r = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(r.body.nivel).toBe('pro');
    expect(r.body.libera.oportunidades).toBe(true);
    expect(r.body.contagens).toEqual({ propostas_mes: 0, pedidos: 1, oportunidades_recebidas: 1, usinas: 1 });
  });
});

describe('PUT /gerador/nexus/perfil', () => {
  const perfil = {
    cidade: 'Uberlândia', uf: 'mg', raio_km: 150, papel_revenda: true, papel_montagem: false, cap_eletrica_bt: true,
    equipe_tamanho: 6, logo_base64: LOGO,
  };

  it('grava o perfil e o logo na empresa da conta e libera Básico e Completo (perfil_completo_em na primeira vez)', async () => {
    empresaDaConta();
    const r = await request(app()).put('/gerador/nexus/perfil').set(bearer(U1)).send(perfil);
    expect(r.status).toBe(200);
    expect(r.body.parceiro).toMatchObject({ cidade: 'Uberlândia', uf: 'MG', raio_km: 150, papel_revenda: true, cap_eletrica_bt: true, equipe_tamanho: 6 });
    expect(r.body.parceiro.perfil_completo_em).toBeTruthy();
    expect(r.body.nivel).toBe('cadastrado');
    expect(r.body.libera).toMatchObject({ basico: true, completo: true, materiais: true, engenharia: true, negociar: true, conversa: false });
    expect(banco.linhas('company')[0].logo_base64).toBe(LOGO);
    expect(r.body.empresa.logo_base64).toBe(LOGO);
  });

  it('recusa logo que não é imagem em data URL, UF inválida e raio absurdo', async () => {
    empresaDaConta();
    for (const ruim of [{ logo_base64: 'http://x.invalid/a.png' }, { logo_base64: 'data:text/html;base64,AAAA' }, { uf: 'XX' }, { raio_km: 99999 }]) {
      const r = await request(app()).put('/gerador/nexus/perfil').set(bearer(U1)).send({ ...perfil, ...ruim });
      expect(r.status).toBe(400);
      expect(r.body.erro).toBe('perfil_invalido');
    }
    expect(banco.linhas('company')[0].logo_base64).toBeNull();
  });

  it('conta sem empresa: sem CNPJ no corpo, 409 sem_cnpj; com CNPJ ativo, cria a empresa e o parceiro', async () => {
    const sem = await request(app()).put('/gerador/nexus/perfil').set(bearer(U1)).send({ ...perfil, logo_base64: undefined });
    expect(sem.status).toBe(409);
    expect(sem.body.erro).toBe('sem_cnpj');
    const r = await request(app()).put('/gerador/nexus/perfil').set(bearer(U1)).send({ ...perfil, cnpj: '11.222.333/0001-81', empresa: 'Solar Nova' });
    expect(r.status).toBe(200);
    expect(banco.linhas('company')[0]).toMatchObject({ user_id: U1, nome: 'Solar Nova', cnpj: CNPJ });
    expect(r.body.parceiro.cnpj).toBe(CNPJ);
  });

  it('CNPJ já usado por outra conta: 409 cnpj_em_uso', async () => {
    empresaDaConta(U2, { cnpj: CNPJ });
    const r = await request(app()).put('/gerador/nexus/perfil').set(bearer(U1)).send({ ...perfil, cnpj: CNPJ });
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('cnpj_em_uso');
  });
});

describe('propostas', () => {
  it('Básico e Completo ficam travados até o perfil fechar: 403 etapa_bloqueada; o Simulador passa', async () => {
    empresaDaConta();
    await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    for (const saida of ['basico', 'completo'] as const) {
      const r = await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk(saida));
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ erro: 'etapa_bloqueada' });
    }
    expect((await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('simulador'))).status).toBe(201);
  });

  it('numera AAAA + sequência de 4 dígitos por parceiro, grava primeira_proposta_em e libera a conversa', async () => {
    semearParceiro(U1);
    const ano = anoBRT();
    const a = await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('completo'));
    const b = await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('basico'));
    expect(a.status).toBe(201);
    expect(a.body.numero).toBe(`${ano}0001`);
    expect(b.body.numero).toBe(`${ano}0002`);
    expect(banco.linhas('nexus_parceiros')[0].primeira_proposta_em).toBeTruthy();
    const eu = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(eu.body.libera.conversa).toBe(true);
    expect(eu.body.contagens.propostas_mes).toBe(2);
  });

  it('valida quantidade 1..50, valores e dados', async () => {
    semearParceiro(U1);
    const ruins = [
      { ...propostaOk(), equipamento: { modelo: 'x', quantidade: 0, preco_unitario: 1 } },
      { ...propostaOk(), equipamento: { modelo: 'x', quantidade: 51, preco_unitario: 1 } },
      { ...propostaOk(), valor_total: -1 },
      { ...propostaOk(), valor_total: 100_000_000 },
      { ...propostaOk(), dados: { grande: 'x'.repeat(210 * 1024) } },
      { ...propostaOk(), saida: 'outra' },
    ];
    for (const corpo of ruins) {
      expect((await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(corpo)).status).toBe(400);
    }
    expect(banco.linhas('nexus_propostas')).toHaveLength(0);
  });

  it('lista, abre e atualiza só as do dono; outro usuário recebe 404', async () => {
    semearParceiro(U1);
    const n = await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('completo'));
    const lista = await request(app()).get('/gerador/nexus/propostas').set(bearer(U1));
    expect(lista.body.propostas).toHaveLength(1);
    expect(lista.body.propostas[0]).toMatchObject({ numero: n.body.numero, cliente_nome: 'Posto Exemplo', quantidade: 2 });
    expect(lista.body.propostas[0]).not.toHaveProperty('dados');

    const um = await request(app()).get(`/gerador/nexus/propostas/${n.body.id}`).set(bearer(U1));
    expect(um.body.proposta.dados).toEqual({ form: { a: 1 } });

    const up = await request(app()).put(`/gerador/nexus/propostas/${n.body.id}`).set(bearer(U1)).send({ ...propostaOk('basico'), valor_total: 150000 });
    expect(up.status).toBe(200);
    expect(up.body.numero).toBe(n.body.numero);
    expect(banco.linhas('nexus_propostas')[0]).toMatchObject({ saida_ultima: 'basico', valor_total: 150000 });

    semearParceiro(U2);
    expect((await request(app()).get(`/gerador/nexus/propostas/${n.body.id}`).set(bearer(U2))).status).toBe(404);
    expect((await request(app()).put(`/gerador/nexus/propostas/${n.body.id}`).set(bearer(U2)).send(propostaOk('simulador'))).status).toBe(404);
    expect((await request(app()).get('/gerador/nexus/propostas/nao-e-uuid').set(bearer(U1))).status).toBe(404);
  });

  it('a rota antiga de pedido por proposta e a de conversa saíram', async () => {
    semearParceiro(U1);
    expect((await request(app()).post('/gerador/nexus/conversa').set(bearer(U1)).send({})).status).toBe(404);
    expect((await request(app()).post('/gerador/nexus/propostas/00000000-0000-4000-8000-000000000009/pedido').set(bearer(U1)).send({})).status).toBe(404);
  });
});

describe('pedidos de equipamento', () => {
  it('só do Partner em diante: antes disso 403 etapa_bloqueada e nada é gravado', async () => {
    semearParceiro(U1);
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ modelo: 'nexus-dc-80', quantidade: 1 });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ erro: 'etapa_bloqueada' });
    expect(banco.linhas('nexus_pedidos')).toHaveLength(0);
  });

  it('Partner pede: grava solicitado, liga à proposta, e o aviso (c) sai por WhatsApp e e-mail', async () => {
    ligarAviso();
    semearParceiro(U1, { partner_em: '2026-10-20T10:00:00Z' });
    const pr = await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('completo'));
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ proposta_id: pr.body.id, modelo: 'nexus-dc-80', quantidade: 2, obs: 'Entrega em dezembro' });
    expect(r.status).toBe(201);
    expect(banco.linhas('nexus_pedidos')[0]).toMatchObject({ user_id: U1, proposta_id: pr.body.id, modelo: 'nexus-dc-80', quantidade: 2, status: 'solicitado', obs: 'Entrega em dezembro' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toBe(`Solar Exemplo pediu equipamento: 2x NEXUS DC 80 kW, proposta ${pr.body.numero}, R$ 139.980,00. Recado: Entrega em dezembro.`);
    expect(emails).toHaveLength(1);

    const lista = await request(app()).get('/gerador/nexus/pedidos').set(bearer(U1));
    expect(lista.body.pedidos).toHaveLength(1);
    expect(lista.body.pedidos[0]).toMatchObject({ status: 'solicitado', quantidade: 2 });
    expect(lista.body.pedidos[0]).not.toHaveProperty('obs_equipe');
  });

  it('valida modelo do catálogo, quantidade 1..50 e proposta que seja dele', async () => {
    semearParceiro(U1, { partner_em: '2026-10-20T10:00:00Z' });
    for (const ruim of [{ modelo: 'outro', quantidade: 1 }, { modelo: 'nexus-dc-80', quantidade: 0 }, { modelo: 'nexus-dc-80', quantidade: 51 }]) {
      expect((await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send(ruim)).status).toBe(400);
    }
    semearParceiro(U2, { partner_em: '2026-10-20T10:00:00Z' });
    const alheia = await request(app()).post('/gerador/nexus/propostas').set(bearer(U2)).send(propostaOk('completo'));
    const r = await request(app()).post('/gerador/nexus/pedidos').set(bearer(U1)).send({ proposta_id: alheia.body.id, modelo: 'nexus-dc-80', quantidade: 1 });
    expect(r.status).toBe(404);
    expect(banco.linhas('nexus_pedidos')).toHaveLength(0);
  });
});

describe('solicitações', () => {
  it('conversa: 403 até a primeira proposta; depois grava conversa_pedida_em e avisa (b), uma vez por dia', async () => {
    ligarAviso();
    semearParceiro(U1);
    const antes = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'conversa', dados: {} });
    expect(antes.status).toBe(403);
    expect(antes.body).toEqual({ erro: 'etapa_bloqueada' });

    await request(app()).post('/gerador/nexus/propostas').set(bearer(U1)).send(propostaOk('completo'));
    const r = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'conversa', dados: { obs: 'Prefiro de manhã' } });
    expect(r.status).toBe(201);
    expect(banco.linhas('nexus_parceiros')[0].conversa_pedida_em).toBeTruthy();
    expect(banco.linhas('nexus_solicitacoes')[0]).toMatchObject({ user_id: U1, tipo: 'conversa', status: 'aberta' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('pediu conversa com o comercial. WhatsApp: 34999990000.');
    await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'conversa', dados: {} });
    expect(banco.linhas('nexus_solicitacoes')).toHaveLength(2); // a solicitação fica; o aviso do dia não repete
    expect(enviados).toHaveLength(1);
  });

  it('engenharia e negociar preço exigem o perfil completo e cada um avisa com texto próprio', async () => {
    ligarAviso();
    empresaDaConta();
    await request(app()).get('/gerador/nexus/eu').set(bearer(U1)); // cadastrado, sem perfil
    enviados.length = 0;
    for (const tipo of ['engenharia', 'negociar_preco']) {
      expect((await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo, dados: {} })).status).toBe(403);
    }

    banco.reset(); banco.projeta = true; resetSondaPortal(); enviados.length = 0;
    semearParceiro(U1);
    const eng = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({
      tipo: 'engenharia', dados: { servico: 'Projeto elétrico', cidade: 'Araguari', uf: 'MG', potencia: '80 kW', descricao: 'Ponto novo' },
    });
    expect(eng.status).toBe(201);
    const neg = await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send({ tipo: 'negociar_preco', dados: { quantidade: 3 } });
    expect(neg.status).toBe(201);
    expect(enviados.map((e) => e.texto)).toEqual([
      'Solar Exemplo pediu serviço de engenharia: Projeto elétrico em Araguari/MG. WhatsApp: 34999990000.',
      'Solar Exemplo quer negociar o preço do equipamento com o comercial. WhatsApp: 34999990000.',
    ]);
    const lista = await request(app()).get('/gerador/nexus/solicitacoes').set(bearer(U1));
    expect(lista.body.solicitacoes).toHaveLength(2);
    expect(lista.body.solicitacoes[0]).not.toHaveProperty('obs_equipe');
  });

  it('tipo e dados inválidos: 400', async () => {
    semearParceiro(U1);
    for (const ruim of [{ tipo: 'outra', dados: {} }, { tipo: 'engenharia', dados: [] }, { tipo: 'engenharia', dados: { x: 'y'.repeat(25 * 1024) } }]) {
      expect((await request(app()).post('/gerador/nexus/solicitacoes').set(bearer(U1)).send(ruim)).status).toBe(400);
    }
    expect(banco.linhas('nexus_solicitacoes')).toHaveLength(0);
  });
});

describe('procura', () => {
  const diasAtras = (n: number) => new Date(Date.now() - n * 24 * 3_600_000).toISOString();

  it('ufDaCidade lê o sufixo "-UF", "/UF" e " - UF" e ignora o resto', () => {
    expect(ufDaCidade('Uberlândia-MG')).toBe('MG');
    expect(ufDaCidade('Goiânia/go')).toBe('GO');
    expect(ufDaCidade('Curitiba - PR')).toBe('PR');
    expect(ufDaCidade('Sem sufixo')).toBeNull();
    expect(ufDaCidade('Cidade-XX')).toBeNull();
    expect(ufDaCidade(null)).toBeNull();
  });

  it('agregarProcura: 6 meses de Brasília, por UF nos últimos 90 dias e percentual fora de MG, GO e DF', () => {
    const agora = new Date('2026-10-21T15:00:00Z');
    expect(ultimosSeisMeses(agora)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    const g = agregarProcura([
      { created_at: '2026-10-20T12:00:00Z', cidade: 'Uberlândia-MG' },
      { created_at: '2026-10-10T12:00:00Z', cidade: 'Uberlândia/MG' },
      { created_at: '2026-09-15T12:00:00Z', cidade: 'Goiânia-GO' },
      { created_at: '2026-08-15T12:00:00Z', cidade: 'Curitiba - PR' },
      { created_at: '2026-08-01T12:00:00Z', cidade: 'Sem sufixo' },
      { created_at: '2026-06-10T12:00:00Z', cidade: 'Uberaba-MG' }, // fora dos 90 dias, dentro dos 6 meses
      { created_at: '2026-01-10T12:00:00Z', cidade: 'Uberaba-MG' }, // fora dos 6 meses
      { created_at: '2026-10-01T02:00:00Z', cidade: 'Palmas-TO' },   // 02:00 UTC de 01/10 ainda é 30/09 em Brasília
    ], agora);
    expect(g.meses.map((m) => [m.mes, m.total])).toEqual([
      ['2026-05', 0], ['2026-06', 1], ['2026-07', 0], ['2026-08', 2], ['2026-09', 2], ['2026-10', 2],
    ]);
    expect(g.total_com_uf).toBe(5); // MG x2, GO, PR, TO (o "Sem sufixo" não conta)
    expect(g.por_uf).toEqual([{ uf: 'MG', total: 2 }, { uf: 'GO', total: 1 }, { uf: 'PR', total: 1 }, { uf: 'TO', total: 1 }]);
    expect(g.pct_fora_mg_go_df).toBe(40); // PR e TO de 5
  });

  it('GET /procura?uf=MG devolve o contrato, só contagens, e guarda 6 h (a segunda chamada não vai ao banco do Gerador)', async () => {
    semearParceiro(U1);
    h.agendamentos = [
      { created_at: diasAtras(3), cidade: 'Uberlândia-MG' },
      { created_at: diasAtras(10), cidade: 'Uberaba-MG' },
      { created_at: diasAtras(20), cidade: 'Goiânia-GO' },
      { created_at: diasAtras(30), cidade: 'Curitiba-PR' },
    ];
    const r = await request(app()).get('/gerador/nexus/procura?uf=MG').set(bearer(U1));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ uf: 'MG', reunioes_90d_uf: 2, total_com_uf: 4, pct_fora_mg_go_df: 25 });
    expect(r.body.meses).toHaveLength(6);
    expect(r.body.por_uf[0]).toEqual({ uf: 'MG', total: 2 });
    expect(r.body.atualizado_em).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/Uberl|nome|telefone/i);
    const chamadas = h.chamadasAgendamentos;
    const r2 = await request(app()).get('/gerador/nexus/procura?uf=GO').set(bearer(U1));
    expect(r2.body.reunioes_90d_uf).toBe(1);
    expect(h.chamadasAgendamentos).toBe(chamadas);
  });

  it('UF inválida: 400; sem token: 401', async () => {
    semearParceiro(U1);
    expect((await request(app()).get('/gerador/nexus/procura?uf=XX').set(bearer(U1))).status).toBe(400);
    expect((await request(app()).get('/gerador/nexus/procura')).status).toBe(401);
  });
});
