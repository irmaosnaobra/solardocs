import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Porta eletroposto (respostas por caminho) e o encaixe da verificação do WhatsApp no handler.
// A verificação em si tem teste próprio (nexusInteresse.whatsapp.test.ts).
const h = vi.hoisted(() => ({
  rpcChamadas: [] as Array<{ nome: string; args: Record<string, any> }>,
  wa: { resultado: null as boolean | null, chamadas: [] as string[], tabelas: [] as string[] },
}));
const wa = h.wa;

vi.mock('../utils/supabase', () => ({
  supabase: {
    rpc: (nome: string, args: Record<string, any>) => {
      h.rpcChamadas.push({ nome, args });
      return Promise.resolve({ data: { posicao: 7, novo: true }, error: null });
    },
  },
}));
vi.mock('../services/nexus/verificaWhatsapp', () => ({
  verificarWhatsapp: async (tel: string, o?: { tabela?: string }) => {
    wa.chamadas.push(tel);
    wa.tabelas.push(o?.tabela ?? '');
    return wa.resultado === false ? { whatsappOk: false, aviso: 'sem_whatsapp' } : { whatsappOk: wa.resultado };
  },
}));

import { cadastrarInteresse } from '../routes/nexusInteresse';

const app = express();
app.use(express.json());
app.post('/nexus-interesse', cadastrarInteresse);
const post = (b: object) => request(app).post('/nexus-interesse').send(b);

const base = {
  porta: 'mobilidade',
  mobilidade: ['moto'],
  objetivo: 'proprio',
  investimento: '50_100',
  recurso: 'os_dois',
  nome: 'Maria Souza',
  telefone: '55 (34) 99999-0001',
  email: 'Maria@Exemplo.com',
  cidade: 'Uberlândia',
  uf: 'mg',
};
const { investimento: _i, objetivo: _o, recurso: _r, mobilidade: _m, porta: _p, ...contato } = base;
const ELE = { ...contato, porta: 'eletroposto', caminho: 'cotista', respostas: { local: 'meu', capital: '100', recurso: 'proprio' } };

beforeEach(() => {
  h.rpcChamadas.length = 0;
  wa.resultado = null;
  wa.chamadas.length = 0;
  wa.tabelas.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function recusa(corpo: object) {
  const r = await post(corpo);
  expect(r.status).toBe(400);
  expect(r.body.erro).toMatch(/^[A-ZÁÉÍÓÚÂÊÔ]/);
  expect(h.rpcChamadas).toHaveLength(0);
  return r;
}

// Um corpo válido por caminho, com as chaves e os valores exatos da spec.
const POR_CAMINHO: Record<string, Record<string, string>> = {
  cotista: { local: 'em_vista', capital: '500_mais', recurso: 'proprio_credito' },
  investidor: { local: 'nao', capital: 'naosei', recurso: 'financiamento' },
  arrendamento: { ponto_tipo: 'posto', relacao: 'represento', vagas: '10_mais' },
  chave_na_mao: { ponto: 'sem_ideia', valor: '280', recurso: 'naosei' },
  parceiro: { atuacao: 'integrador_solar', experiencia: 'certificado', interesse: 'vender_executar' },
  so_carregador: { potencia: '120', qtd: 'mais_10', instala: 'obra_e_projeto_meus' },
};
describe('POST /nexus-interesse: porta eletroposto', () => {
  it.each(Object.entries(POR_CAMINHO))('caminho %s grava as 3 respostas e zera os campos da mobilidade', async (caminho, respostas) => {
    const r = await post({ ...ELE, caminho, respostas });
    expect(r.status).toBe(200);
    const a = h.rpcChamadas[0].args;
    expect(a.p_eletroposto).toEqual([caminho]);
    expect(a.p_eletroposto_respostas).toEqual({ [caminho]: respostas });
    expect([a.p_mobilidade, a.p_outro, a.p_objetivo, a.p_investimento, a.p_recurso]).toEqual([[], null, null, null, null]);
  });

  it('sem porta, caminho presente infere eletroposto e a falta dele infere mobilidade', async () => {
    const { porta: _x, ...semPorta } = ELE;
    expect((await post(semPorta)).status).toBe(200);
    expect(h.rpcChamadas[0].args.p_eletroposto).toEqual(['cotista']);
    const { porta: _y, ...mob } = base;
    expect((await post(mob)).status).toBe(200);
    expect(h.rpcChamadas[1].args.p_mobilidade).toEqual(['moto']);
  });

  it('porta com valor desconhecido é 400', async () => {
    await recusa({ ...ELE, porta: 'solar' });
  });

  it('caminho ausente ou desconhecido é 400', async () => {
    await recusa({ ...ELE, caminho: undefined });
    await recusa({ ...ELE, caminho: 'foguete' });
  });

  it('falta de resposta ou valor inválido é 400 (todas obrigatórias)', async () => {
    for (const chave of ['local', 'capital', 'recurso']) {
      const { [chave]: _, ...resto } = ELE.respostas as Record<string, string>;
      await recusa({ ...ELE, respostas: resto });
      await recusa({ ...ELE, respostas: { ...ELE.respostas, [chave]: 'xx' } });
    }
    await recusa({ ...ELE, respostas: undefined });
    // Valor de outro caminho não vale: `proprio_credito` é do eletroposto, `os_dois` é da mobilidade.
    await recusa({ ...ELE, respostas: { ...ELE.respostas, recurso: 'os_dois' } });
    await recusa({ ...ELE, caminho: 'chave_na_mao', respostas: { ponto: 'definido', valor: '50', recurso: 'proprio' } });
  });

  it('chave estranha é descartada; empresa só vale no parceiro', async () => {
    await post({ ...ELE, respostas: { ...ELE.respostas, lixo: 'x', empresa: 'ACME' } });
    expect(h.rpcChamadas[0].args.p_eletroposto_respostas).toEqual({ cotista: ELE.respostas });
    await post({ ...ELE, caminho: 'parceiro', respostas: { ...POR_CAMINHO.parceiro, lixo: 'x', empresa: ' ACME Solar ' } });
    expect(h.rpcChamadas[1].args.p_eletroposto_respostas).toEqual({ parceiro: { ...POR_CAMINHO.parceiro, empresa: 'ACME Solar' } });
    await post({ ...ELE, caminho: 'parceiro', respostas: { ...POR_CAMINHO.parceiro, empresa: 'x'.repeat(200) } });
    expect(h.rpcChamadas[2].args.p_eletroposto_respostas.parceiro.empresa).toHaveLength(80);
    await post({ ...ELE, caminho: 'parceiro', respostas: { ...POR_CAMINHO.parceiro, empresa: '  ' } });
    expect(h.rpcChamadas[3].args.p_eletroposto_respostas.parceiro).toEqual(POR_CAMINHO.parceiro);
  });

  it('a porta eletroposto ignora os campos da mobilidade', async () => {
    await post({ ...ELE, mobilidade: ['moto'], outro: 'x', objetivo: 'frota', investimento: '50_100', recurso: 'os_dois' });
    const a = h.rpcChamadas[0].args;
    expect([a.p_mobilidade, a.p_outro, a.p_objetivo, a.p_investimento, a.p_recurso]).toEqual([[], null, null, null, null]);
  });
});

describe('POST /nexus-interesse: WhatsApp no handler', () => {
  it('telefone de teste nem chama a verificação e grava whatsapp_ok null', async () => {
    await post({ ...base, telefone: '5534900000000' });
    expect(wa.chamadas).toEqual([]);
    expect(h.rpcChamadas[0].args.p_whatsapp_ok).toBeNull();
  });

  it('true grava true, sem aviso', async () => {
    wa.resultado = true;
    const r = await post(base);
    expect(wa.chamadas).toEqual(['5534999990001']);
    expect(wa.tabelas).toEqual(['nexus_instagram_interesse']);
    expect(h.rpcChamadas[0].args.p_whatsapp_ok).toBe(true);
    expect(r.body).toEqual({ ok: true, posicao: 7, novo: true });
  });

  it('false grava false e devolve aviso sem_whatsapp, e o cadastro grava igual', async () => {
    wa.resultado = false;
    const r = await post(base);
    expect(h.rpcChamadas[0].args.p_whatsapp_ok).toBe(false);
    expect(r.body).toEqual({ ok: true, posicao: 7, novo: true, aviso: 'sem_whatsapp' });
  });

  it('null (não verificado) grava null, sem aviso', async () => {
    const r = await post(base);
    expect(h.rpcChamadas[0].args.p_whatsapp_ok).toBeNull();
    expect(r.body).not.toHaveProperty('aviso');
  });

  it('payload inválido e honeypot não chegam à verificação', async () => {
    await post({ ...base, nome: 'A' });
    await post({ ...base, site: 'spam' });
    expect(wa.chamadas).toEqual([]);
  });
});

// LEGADO v1: a página que estava no ar antes da v2. Sai junto com o caminho legado (depois de 19/12/2026).
describe('POST /nexus-interesse: payload v1 (legado)', () => {
  const { porta: _q, ...semPorta } = base;
  const V1 = { ...semPorta, eletroposto: ['cotista', 'foguete', 'parceiro', 'cotista'], investimento: '10_50' };

  it('payload v1 completo grava com a lista em p_eletroposto e respostas vazias', async () => {
    const r = await post({ ...V1, outro: ' ônibus ', origem: 'bio' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, posicao: 7, novo: true });
    expect(h.rpcChamadas[0].nome).toBe('nexus_instagram_gravar_v2');
    expect(h.rpcChamadas[0].args).toMatchObject({
      p_eletroposto: ['cotista', 'parceiro'], p_eletroposto_respostas: {}, p_mobilidade: ['moto'], p_outro: 'ônibus',
      p_objetivo: 'proprio', p_investimento: '10_50', p_recurso: 'os_dois', p_whatsapp_ok: null,
    });
  });

  it('v1 aceita ate_10 e 10_50, mas valores fora da lista antiga seguem 400', async () => {
    for (const investimento of ['ate_10', '10_50', '50_100', 'naosei']) {
      expect((await post({ ...V1, investimento })).status).toBe(200);
    }
    h.rpcChamadas.length = 0;
    await recusa({ ...V1, investimento: '1000_mais' });
    await recusa({ ...V1, investimento: undefined });
  });

  it('v1 sem nada marcado e sem outro é 400; só eletroposto marcado basta', async () => {
    await recusa({ ...V1, eletroposto: [], mobilidade: [] });
    expect((await post({ ...V1, eletroposto: ['cotista'], mobilidade: [] })).status).toBe(200);
  });

  it('v1 passa pela mesma verificação de WhatsApp e devolve o aviso', async () => {
    wa.resultado = false;
    const r = await post(V1);
    expect(wa.chamadas).toEqual(['5534999990001']);
    expect(h.rpcChamadas[0].args.p_whatsapp_ok).toBe(false);
    expect(r.body).toEqual({ ok: true, posicao: 7, novo: true, aviso: 'sem_whatsapp' });
  });

  it('v2 recusa ate_10 e 10_50 (porta mobilidade), mesmo com eletroposto em array junto', async () => {
    await recusa({ ...base, investimento: 'ate_10' });
    await recusa({ ...base, investimento: '10_50', eletroposto: ['cotista'] });
    await recusa({ ...V1, porta: 'mobilidade' });
  });

  it('com caminho presente vale o contrato v2, mesmo com eletroposto em array', async () => {
    await recusa({ ...V1, caminho: 'cotista' });
  });
});
