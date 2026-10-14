import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

// Ficha do cliente e Obras do eletroposto: rotas com o login e os dois bancos simulados (dados inventados).
// O que se prova aqui: o filtro "é eletroposto", a posse (404 igual), o corte por papel na resposta INTEIRA, que o
// pós-venda só se edita em Obras, 409, a corrida de gravação e que o `por` vem do token e não do corpo.

type Card = {
  id: number; cliente_nome: string; cliente_telefone: string; cidade: string; vendedor_nome: string;
  created_by: string; status: string; created_at: string;
}
const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, unknown>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  erroLeitura: false,
  erroCards: false,
  /** Roda uma vez entre a leitura e a gravação: simula outra pessoa gravando no meio. */
  noMeio: null as null | (() => void),
  tique: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const f: Record<string, unknown> = {};
          const b: any = {
            eq: (c: string, v: unknown) => { f[c] = v; return b; },
            ilike: () => b,   // o LIKE do banco é só pré-filtro: o teste devolve tudo para provar que o JS filtra
            order: () => b,
            range: async () => {
              if (h.erroCards) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
              return { data: h.cards.filter((r) => ('status' in f ? r.status === f.status : true)), error: null };
            },
            maybeSingle: async () => {
              if (h.erroCards) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
              return { data: h.cards.find((r) => r.id === f.id) ?? null, error: null };
            },
          };
          return b;
        },
      };
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-13T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          in: async (_c: string, chaves: string[]) => {
            if (h.erroLeitura) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
            return { data: chaves.filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null };
          },
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => {
              if (h.erroLeitura) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
              const l = h.linhas.get(k);
              const r = { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
              if (h.noMeio) { const f = h.noMeio; h.noMeio = null; f(); }
              return r;
            },
          }),
        }),
        insert: async (l: { key: string; value: unknown }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: stamp() });
          return { error: null };
        },
        update: (novo: { value: unknown; updated_at: string }) => ({
          eq: (_c: string, k: string) => {
            const faz = (ok: (l: { updated_at: string }) => boolean) => ({
              select: async () => {
                const l = h.linhas.get(k);
                if (!l || !ok(l)) return { data: [], error: null };
                h.linhas.set(k, { value: novo.value, updated_at: stamp() });
                return { data: [{ key: k }], error: null };
              },
            });
            return { eq: (_c2: string, v: string) => faz((l) => l.updated_at === v), is: () => faz(() => false) };
          },
        }),
      };
    },
  },
}));

import { mountClientesEletroposto } from '../routes/geradorEletropostoClientes';
import { progressoObra, colunasFichaPara } from '../services/gerador/fichaEletroposto';

const r = Router();
mountClientesEletroposto(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';
const MARCOS = 'Bearer tk-marcos';
const VELHO = '2000-01-01T00:00:00.000Z';
const AGORA = '2026-10-14T15:00:00.000Z';   // 12:00 em Brasília

const card = (id: number, o: Partial<Card>): Card => ({
  id, cliente_nome: 'Fulano', cliente_telefone: '', cidade: '', vendedor_nome: 'Nilce', created_by: 'lp_eletroposto',
  status: 'fechou', created_at: '2026-09-10T15:00:00.000Z', ...o,
});
const PV_101 = {
  modelo: 'meio_a_meio', valor: 250000.55, vendido_em: '2026-09-20', etapa: 'projeto', etapa_desde: '2026-09-21T12:00:00.000Z',
  previsto: '2026-10-05', responsavel: 'Marcos', obs: 'ZZOBSPV', por: 'thiago', em: '2026-09-21T12:00:00.000Z',
};
const PV_102 = {
  modelo: 'carregador', valor: 9876.5, vendido_em: '2026-09-25', etapa: 'concluido', etapa_desde: '2026-10-01T12:00:00.000Z',
  previsto: '2026-09-01', responsavel: '', obs: '', por: 'giovanna', em: '2026-10-01T12:00:00.000Z',
};

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-marcos': 'marcos@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com',
  };
  h.cards = [
    card(101, { cliente_nome: 'Carlos Alves', cliente_telefone: '(34) 98888-0001', cidade: 'Uberlandia', vendedor_nome: 'Nilce' }),
    card(102, { cliente_nome: 'Dora Reis', cidade: 'Catalao', vendedor_nome: 'Giovanna', created_by: 'manychat_eletroposto' }),
    card(103, { cliente_nome: 'Eli Solar', vendedor_nome: 'Nilce', created_by: 'lp_solar' }),
    card(104, { cliente_nome: 'Fabio Agendado', vendedor_nome: 'Nilce', status: 'agendado' }),
    card(105, { cliente_nome: 'Gil Prospec', vendedor_nome: 'Diego', created_by: 'prosp_eletroposto', created_at: '2026-08-02T15:00:00.000Z' }),
  ];
  h.linhas = new Map([
    ['pos_venda:101', { value: PV_101, updated_at: 'v101' }],
    ['pos_venda:102', { value: PV_102, updated_at: 'v102' }],
  ]);
  h.erroLeitura = false; h.erroCards = false; h.noMeio = null; h.tique = 0;
  delete process.env.SOLAR_SOCIOS; delete process.env.OBRAS_EQUIPE;
  vi.useFakeTimers({ toFake: ['Date'] });   // só o relógio: o timer falso trava o supertest
  vi.setSystemTime(new Date(AGORA));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const get = (auth = NILCE) => request(app).get('/gerador/clientes/eletroposto').set('Authorization', auth);
const post = (corpo: Record<string, unknown>, auth = NILCE) =>
  request(app).post('/gerador/clientes/eletroposto/campo').set('Authorization', auth).send({ base_em: VELHO, ...corpo });
const obras = (auth = THIAGO) => request(app).get('/gerador/obras/eletroposto').set('Authorization', auth);
const postObra = (corpo: Record<string, unknown>, auth = THIAGO) =>
  request(app).post('/gerador/obras/eletroposto').set('Authorization', auth).send({ base_em: VELHO, ...corpo });
const chavesDe = (o: unknown, acc = new Set<string>()): Set<string> => {
  if (Array.isArray(o)) o.forEach((x) => chavesDe(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.add(k); chavesDe(v, acc); }
  return acc;
};
const SOCIO = ['valor', 'forma_pagto', 'entrada', 'financiamento', 'banco'];

describe('login', () => {
  it('401 sem token e com token inválido; 403 para conta de fora, nas quatro rotas', async () => {
    expect((await request(app).get('/gerador/clientes/eletroposto')).status).toBe(401);
    expect((await get('Bearer lixo')).status).toBe(401);
    expect((await get('Bearer tk-estranho')).status).toBe(403);
    expect((await request(app).post('/gerador/clientes/eletroposto/campo').send({})).status).toBe(401);
    expect((await request(app).get('/gerador/obras/eletroposto')).status).toBe(401);
    expect((await request(app).post('/gerador/obras/eletroposto').send({})).status).toBe(401);
  });
});

describe('GET /clientes/eletroposto', () => {
  it('sócio: só card FECHOU de eletroposto (solar e agendado ficam de fora), mais novo primeiro, no-store', async () => {
    const res = await get(THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, papel: 'socio', produto: 'eletroposto' });
    expect(res.body.linhas.map((l: { codigo: string }) => l.codigo)).toEqual(['105', '102', '101']);
    expect(res.body.totais.clientes).toBe(3);
    expect(typeof res.body.em).toBe('string');
    const g = res.body.catalogo.grupos;
    expect(g).toEqual(['Venda', 'Cliente', 'Local do ponto', 'Negócio', 'Datas', 'Observação']);
    const col = (k: string) => res.body.catalogo.colunas.find((c: { chave: string }) => c.chave === k);
    for (const k of SOCIO) expect(col(k).quem_ve, k).toBe('socio');
    expect(col('concessionaria')).toMatchObject({ opcoes: ['Cemig', 'Equatorial'], livre: true });
    expect(col('trifasico')).toMatchObject({ opcoes: ['Sim', 'Não'], livre: false });
  });
  it('a linha traz o pré-preenchimento do card (origem card) e o pós-venda só de leitura (origem pos_venda)', async () => {
    const res = await get(THIAGO);
    const l = res.body.linhas.find((x: { codigo: string }) => x.codigo === '101');
    expect(l.cliente).toBe('Carlos Alves');
    expect(l.consultor).toBe('Nilce');
    expect(l.celulas.cliente).toEqual({ valor: 'Carlos Alves', origem: 'card' });
    expect(l.celulas.contato).toEqual({ valor: '34988880001', origem: 'card' });
    expect(l.celulas.cidade).toEqual({ valor: 'Uberlandia', origem: 'card' });
    expect(l.celulas.consultor).toEqual({ valor: 'Nilce', origem: 'card' });
    expect(l.celulas.cpf_cnpj).toEqual({ valor: null, origem: 'vazio' });
    expect(l.celulas.modelo).toEqual({ valor: '50/50', origem: 'pos_venda', dica: 'Edita em Obras' });
    expect(l.celulas.valor).toEqual({ valor: 250000.55, origem: 'pos_venda', dica: 'Edita em Obras' });
    expect(l.celulas.etapa.valor).toBe('Projeto executivo e ART');
    expect(l.celulas.previsto.valor).toBe('2026-10-05');
    expect(l.celulas.responsavel.valor).toBe('Marcos');
    const col = res.body.catalogo.colunas.filter((c: { chave: string }) => ['modelo', 'valor', 'vendido_em', 'etapa', 'previsto', 'responsavel', 'consultor'].includes(c.chave));
    expect(col).toHaveLength(7);
    for (const c of col) expect(c.editavel, c.chave).toBe(false);
    // venda sem registro de pós-venda: leitura vazia, nunca zero
    const sem = res.body.linhas.find((x: { codigo: string }) => x.codigo === '105');
    expect(sem.celulas.modelo).toMatchObject({ valor: null, origem: 'pos_venda' });
    expect(sem.celulas.valor).toMatchObject({ valor: null, origem: 'pos_venda' });
  });
  it('consultor: só os cards dele; nenhuma coluna, valor ou nome de sócio ou de outro consultor na resposta inteira', async () => {
    h.linhas.set('cliente_ep:101', {
      updated_at: 't', value: {
        campos: {
          entrada: { valor: 4321.09, por: 'thiago', em: '2026-10-01T10:00:00.000Z' },
          forma_pagto: { valor: 'ZZFORMA', por: 'thiago', em: '2026-10-01T10:00:00.000Z' },
          cidade: { valor: 'Araguari', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
        },
        alteracoes: [{ em: '2026-10-01T10:00:00.000Z', por: 'thiago', coluna: 'entrada', antes: 99999.99 }], em: '2026-10-01T10:00:00.000Z',
      },
    });
    const res = await get(NILCE);
    expect(res.status).toBe(200);
    expect(res.body.papel).toBe('consultor');
    expect(res.body.linhas.map((l: { codigo: string }) => l.codigo)).toEqual(['101']);
    const chaves = new Set<string>([...res.body.catalogo.colunas.map((c: { chave: string }) => c.chave), ...res.body.linhas.flatMap((l: { celulas: object }) => Object.keys(l.celulas))]);
    for (const k of SOCIO) expect(chaves.has(k), `chave ${k}`).toBe(false);
    const rotulos = res.body.catalogo.colunas.map((c: { rotulo: string }) => c.rotulo);
    for (const rot of ['Valor da venda', 'Forma de pagamento', 'Entrada', 'Tem financiamento', 'Banco do financiamento']) expect(rotulos).not.toContain(rot);
    const texto = JSON.stringify(res.body).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'DATA');
    for (const s of ['250000', '4321', '99999', 'ZZFORMA', 'Dora', 'Giovanna', 'Gil Prospec', 'alteracoes']) expect(texto.includes(s), s).toBe(false);
    // a sobrescrita de OUTRA coluna continua aparecendo, com quem preencheu
    expect(res.body.linhas[0].celulas.cidade).toEqual({ valor: 'Araguari', origem: 'sistema', por: 'nilce', em: '2026-10-01T10:00:00.000Z' });
    expect(chavesDe(res.body).has('alteracoes')).toBe(false);
  });
  it('sobrescrita do sistema vale por cima do card; sobrescrita de coluna de pós-venda no registro é ignorada', async () => {
    h.linhas.set('cliente_ep:101', { updated_at: 't', value: { campos: {
      cliente: { valor: 'Carlos A. Alves Ltda', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
      modelo: { valor: 'ZZINTRUSO', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
    }, alteracoes: [], em: '2026-10-01T10:00:00.000Z' } });
    const l = (await get(THIAGO)).body.linhas.find((x: { codigo: string }) => x.codigo === '101');
    expect(l.celulas.cliente).toMatchObject({ valor: 'Carlos A. Alves Ltda', origem: 'sistema', por: 'nilce' });
    expect(l.celulas.modelo.valor).toBe('50/50');
  });
  it('banco fora: 502 genérico, sem texto do driver', async () => {
    h.erroCards = true;
    const res = await get(THIAGO);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('VALOR-SECRETO');
    h.erroCards = false; h.erroLeitura = true;
    const res2 = await get(THIAGO);
    expect(res2.status).toBe(502);
    expect(JSON.stringify(res2.body)).not.toContain('VALOR-SECRETO');
  });
});

describe('POST /clientes/eletroposto/campo', () => {
  it('posse: card inexistente, de outro consultor, de solar e ainda não vendido respondem IGUAL (404) e nada é gravado', async () => {
    const antes = h.linhas.size;
    const alvos = [999, 102, 103, 104];
    const resp = [];
    for (const codigo of alvos) resp.push(await post({ codigo: String(codigo), coluna: 'cidade', valor: 'X' }));
    for (const x of resp) { expect(x.status).toBe(404); expect(x.body).toEqual({ ok: false, error: 'Venda não encontrada.' }); }
    // a posse vem ANTES de coluna e valor: coluna inexistente e valor torto em card alheio também dão 404
    expect((await post({ codigo: '102', coluna: 'nao_existe', valor: 'X' })).status).toBe(404);
    expect((await post({ codigo: '102', coluna: 'modelo', valor: 'X' })).status).toBe(404);
    expect((await post({ codigo: '102', coluna: 'uf', valor: 'ZZ' })).status).toBe(404);
    expect(h.linhas.size).toBe(antes);
  });
  it('consultor pedindo coluna de sócio recebe a MESMA resposta de coluna inexistente', async () => {
    const a = await post({ codigo: '101', coluna: 'forma_pagto', valor: 'Pix' });
    const b = await post({ codigo: '101', coluna: 'coluna_que_nao_existe', valor: 'Pix' });
    const c = await post({ codigo: '101', coluna: 'valor', valor: '1' });
    for (const x of [a, b, c]) { expect(x.status).toBe(400); expect(x.body).toEqual({ ok: false, error: 'Coluna não encontrada.' }); }
    expect(h.linhas.has('cliente_ep:101')).toBe(false);
  });
  it('campo do pós-venda e consultor são só de leitura: 400, para consultor e para sócio, e o registro do pós-venda não muda', async () => {
    for (const coluna of ['modelo', 'etapa', 'previsto', 'vendido_em', 'responsavel', 'consultor']) {
      const c = await post({ codigo: '101', coluna, valor: 'Qualquer' });
      expect(c.status, coluna).toBe(400);
      const s = await post({ codigo: '101', coluna, valor: 'Qualquer' }, THIAGO);
      expect(s.status, coluna).toBe(400);
    }
    expect((await post({ codigo: '101', coluna: 'modelo', valor: 'x' })).body.error).toBe('Esta informação se edita em Obras.');
    expect((await post({ codigo: '101', coluna: 'valor', valor: '1' }, THIAGO)).status).toBe(400);   // dinheiro do pós-venda: nem o sócio grava aqui
    expect(h.linhas.get('pos_venda:101')!.value).toBe(PV_101);
    expect(h.linhas.has('cliente_ep:101')).toBe(false);
  });
  it('pedido torto: 400 sem base_em, código não numérico e valor enorme', async () => {
    expect((await request(app).post('/gerador/clientes/eletroposto/campo').set('Authorization', NILCE).send({ codigo: '101', coluna: 'cidade', valor: 'X' })).status).toBe(400);
    expect((await post({ codigo: 'abc', coluna: 'cidade', valor: 'X' })).status).toBe(400);
    expect((await post({ codigo: '101', coluna: 'obs', valor: 'x'.repeat(2001) })).status).toBe(400);
  });
  it('consultor grava no card dele: célula com origem sistema, quem e quando; mora em cliente_ep:<id>', async () => {
    const res = await post({ codigo: '101', coluna: 'cidade', valor: 'Araguari' });
    expect(res.status).toBe(200);
    expect(res.body.celula).toMatchObject({ valor: 'Araguari', origem: 'sistema', por: 'nilce' });
    expect(res.body.progresso).toMatchObject({ total: expect.any(Number) });
    const reg = h.linhas.get('cliente_ep:101')!.value as { campos: Record<string, { valor: unknown; por: string }> };
    expect(reg.campos.cidade).toMatchObject({ valor: 'Araguari', por: 'nilce' });
    // apagar devolve o que o card trouxe
    const apaga = await post({ codigo: '101', coluna: 'cidade', valor: '', base_em: res.body.em });
    expect(apaga.status).toBe(200);
    expect(apaga.body.celula).toEqual({ valor: 'Uberlandia', origem: 'card' });
  });
  it('validação por campo: CPF/CNPJ e CEP formatados, e-mail, data, lista, inteiro', async () => {
    const ok = async (coluna: string, valor: unknown) => post({ codigo: '101', coluna, valor });
    expect((await ok('cpf_cnpj', '12345678901')).body.celula.valor).toBe('123.456.789-01');
    expect((await ok('cpf_cnpj', '12345678000195')).body.celula.valor).toBe('12.345.678/0001-95');
    expect((await ok('cpf_cnpj', '123')).status).toBe(400);
    expect((await ok('cep', '38400100')).body.celula.valor).toBe('38400-100');
    expect((await ok('cep', '384')).status).toBe(400);
    expect((await ok('email', 'Ana@Exemplo.com')).body.celula.valor).toBe('ana@exemplo.com');
    expect((await ok('email', 'sem-arroba')).status).toBe(400);
    expect((await ok('contrato_assinado_em', '05/10/2026')).body.celula.valor).toBe('2026-10-05');
    expect((await ok('contrato_assinado_em', '31/02/2026')).status).toBe(400);
    expect((await ok('trifasico', 'sim')).body.celula.valor).toBe('Sim');
    expect((await ok('trifasico', 'talvez')).status).toBe(400);
    expect((await ok('uf', 'mg')).body.celula.valor).toBe('MG');
    expect((await ok('concessionaria', 'Energisa')).body.celula.valor).toBe('Energisa');   // lista aberta
    expect((await ok('qtd_carregadores', '2')).body.celula.valor).toBe(2);
    expect((await ok('qtd_carregadores', '2,5')).status).toBe(400);
    expect((await ok('potencia_kw', '80')).body.celula.valor).toBe(80);
  });
  it('sócio grava dinheiro (R$ 1.500,00 vira 1500) e o consultor, no mesmo card, não vê nem recebe isso', async () => {
    const res = await post({ codigo: '101', coluna: 'entrada', valor: '1.500,00' }, THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.celula.valor).toBe(1500);
    const doConsultor = await get(NILCE);
    expect(JSON.stringify(doConsultor.body)).not.toMatch(/1500|entrada/);
  });
  it('sócio grava em card de qualquer consultor', async () => {
    expect((await post({ codigo: '102', coluna: 'cidade', valor: 'Catalão' }, THIAGO)).status).toBe(200);
    expect((await post({ codigo: '105', coluna: 'cidade', valor: 'Patos' }, DIEGO)).status).toBe(200);
  });
  it('409: outra pessoa gravou depois da leitura; a mesma pessoa em duas abas não conflita', async () => {
    const t = await post({ codigo: '101', coluna: 'cpf_cnpj', valor: '12345678901' }, THIAGO);
    expect(t.status).toBe(200);
    const n = await post({ codigo: '101', coluna: 'cpf_cnpj', valor: '10987654321', base_em: VELHO });
    expect(n.status).toBe(409);
    expect(n.body).toMatchObject({ ok: false, conflito: true, por: 'thiago' });
    expect(n.body.celula).toMatchObject({ valor: '123.456.789-01', origem: 'sistema' });
    expect(((h.linhas.get('cliente_ep:101')!.value) as { campos: Record<string, { valor: unknown }> }).campos.cpf_cnpj.valor).toBe('123.456.789-01');
    const proprio = await post({ codigo: '101', coluna: 'cpf_cnpj', valor: '10987654321', base_em: VELHO }, THIAGO);
    expect(proprio.status).toBe(200);
  });
  it('corrida: outra gravação entre a leitura e a escrita não é perdida (lê de novo e grava as duas)', async () => {
    h.linhas.set('cliente_ep:101', { updated_at: 'v0', value: { campos: {}, alteracoes: [], em: null } });
    h.noMeio = () => {
      h.linhas.set('cliente_ep:101', { updated_at: 'v1', value: { campos: { banco: { valor: 'Banco Z', por: 'thiago', em: '2026-10-14T14:59:00.000Z' } }, alteracoes: [], em: '2026-10-14T14:59:00.000Z' } });
    };
    const res = await post({ codigo: '101', coluna: 'cidade', valor: 'Araguari' });
    expect(res.status).toBe(200);
    const campos = ((h.linhas.get('cliente_ep:101')!.value) as { campos: Record<string, { valor: unknown }> }).campos;
    expect(campos.banco.valor).toBe('Banco Z');
    expect(campos.cidade.valor).toBe('Araguari');
  });
  it('banco fora ao gravar: 500 genérico, sem texto do driver', async () => {
    h.erroCards = true;
    const res = await post({ codigo: '101', coluna: 'cidade', valor: 'X' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('VALOR-SECRETO');
  });
});

describe('GET /obras/eletroposto', () => {
  it('sócio: progresso (feitas sobre total), atrasado em Brasília, ordem e campos do contrato', async () => {
    const res = await obras(THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, socio: true });
    expect(res.body.obras.map((o: { id: number }) => o.id)).toEqual([101, 105, 102]);   // atrasada, sem previsão, concluída
    const o101 = res.body.obras[0];
    expect(o101).toMatchObject({
      id: 101, cliente: 'Carlos Alves', cidade: 'Uberlandia', consultor: 'Nilce', modelo: 'meio_a_meio', modelo_rotulo: '50/50',
      etapa: 'projeto', etapa_rotulo: 'Projeto executivo e ART', feitas: 1, total: 9, previsto: '2026-10-05', atrasado: true,
      responsavel: 'Marcos', obs: 'ZZOBSPV', vendido_em: '2026-09-20', em: '2026-09-21T12:00:00.000Z', falta_informar: false, concluido: false,
    });
    expect(o101.etapas[0]).toEqual({ chave: 'papeis', rotulo: 'Contrato assinado e sinal pago', dono: 'cliente', prazo_dias: 7 });
    expect(o101.etapas).toHaveLength(9);
    const o102 = res.body.obras[2];
    expect(o102).toMatchObject({ id: 102, modelo: 'carregador', feitas: 5, total: 5, atrasado: false, concluido: true });   // previsto antigo mas concluída
    const o105 = res.body.obras[1];
    expect(o105).toMatchObject({ id: 105, modelo: '', modelo_rotulo: 'Modelo a confirmar', etapa: '', feitas: 0, total: 1, falta_informar: true, previsto: null, atrasado: false, em: null });
    expect(o105.etapas.map((e: { chave: string }) => e.chave)).toEqual(['papeis']);
  });
  it('modelos: os 6 chegam para a tela escolher; valor e vendido_em só na resposta do sócio, e nunca o valor para o consultor', async () => {
    const socioRes = await obras(THIAGO);
    expect(socioRes.body.modelos).toEqual([
      { chave: 'chave_na_mao', rotulo: 'Chave na mão' }, { chave: 'meio_a_meio', rotulo: '50/50' }, { chave: 'arrendamento', rotulo: 'Arrendamento' },
      { chave: 'cotista', rotulo: 'Cotas' }, { chave: 'integrador', rotulo: 'Integrador' }, { chave: 'carregador', rotulo: 'Carregador avulso' },
    ]);
    const s101 = socioRes.body.obras.find((o: { id: number }) => o.id === 101);
    expect(s101).toMatchObject({ valor: 250000.55, vendido_em: '2026-09-20' });
    expect(socioRes.body.obras.find((o: { id: number }) => o.id === 105)).toMatchObject({ valor: null, vendido_em: null });
    const c = await obras(NILCE);
    expect(c.body.modelos).toHaveLength(6);
    expect(c.body.obras[0]).toMatchObject({ id: 101, vendido_em: '2026-09-20' });
    expect('valor' in c.body.obras[0]).toBe(false);
    expect(JSON.stringify(c.body)).not.toContain('250000');
    // a resposta do POST também respeita o papel
    const p = await postObra({ id: 101, responsavel: 'Lu', base_em: PV_101.em }, NILCE);
    expect('valor' in p.body.obra).toBe(false);
    expect(JSON.stringify(p.body)).not.toContain('250000');
  });
  it('atrasado olha o dia de Brasília: previsto hoje não está atrasado; ontem está', async () => {
    h.linhas.set('pos_venda:101', { value: { ...PV_101, previsto: '2026-10-14' }, updated_at: 'v' });
    expect((await obras(THIAGO)).body.obras.find((o: { id: number }) => o.id === 101).atrasado).toBe(false);
    h.linhas.set('pos_venda:101', { value: { ...PV_101, previsto: '2026-10-13' }, updated_at: 'v' });
    expect((await obras(THIAGO)).body.obras.find((o: { id: number }) => o.id === 101).atrasado).toBe(true);
    // 01:00 UTC de 15/10 ainda é 14/10 em Brasília
    vi.setSystemTime(new Date('2026-10-15T01:00:00.000Z'));
    h.linhas.set('pos_venda:101', { value: { ...PV_101, previsto: '2026-10-14' }, updated_at: 'v' });
    expect((await obras(THIAGO)).body.obras.find((o: { id: number }) => o.id === 101).atrasado).toBe(false);
  });
  it('consultor: só as obras dele, sem a de outros, sem dinheiro; fora da equipe: 403', async () => {
    const res = await obras(NILCE);
    expect(res.status).toBe(200);
    expect(res.body.socio).toBe(false);
    expect(res.body.obras.map((o: { id: number }) => o.id)).toEqual([101]);
    const texto = JSON.stringify(res.body);
    for (const s of ['Dora', 'Gil', '250000', 'valor']) expect(texto.includes(s), s).toBe(false);
    const fora = await obras(MARCOS);
    expect(fora.status).toBe(403);
    expect(fora.body.precisa).toBe('equipe');
    expect((await postObra({ id: 101, etapa: 'protocolo' }, MARCOS)).status).toBe(403);
  });
  it('banco fora: 502 genérico', async () => {
    h.erroCards = true;
    const res = await obras(THIAGO);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('VALOR-SECRETO');
  });
});

describe('progressoObra (o mesmo cálculo do PosVenda.resumo)', () => {
  const pv = (modelo: string, etapa: string) => ({ ...PV_101, modelo, etapa });
  it('posição menos 1; todas se concluído; modelo vazio ou sem registro dá 0 de 1; etapa fora da trilha nunca fica negativa', () => {
    expect(progressoObra(pv('chave_na_mao', 'papeis'))).toMatchObject({ feitas: 0, total: 10 });
    expect(progressoObra(pv('chave_na_mao', 'credito'))).toMatchObject({ feitas: 1, total: 10 });
    expect(progressoObra(pv('chave_na_mao', 'concluido'))).toMatchObject({ feitas: 10, total: 10, concluido: true });
    expect(progressoObra(pv('carregador', 'entrega'))).toMatchObject({ feitas: 3, total: 5 });
    expect(progressoObra(pv('', 'papeis'))).toMatchObject({ feitas: 0, total: 1, falta_informar: true });
    expect(progressoObra(null)).toMatchObject({ feitas: 0, total: 1, falta_informar: true, concluido: false });
    expect(progressoObra(pv('carregador', 'obra')).feitas).toBe(0);
    expect(progressoObra(pv('', 'concluido')).concluido).toBe(false);   // sem modelo não conclui
  });
});

describe('POST /obras/eletroposto', () => {
  const registro = (id: number) => h.linhas.get(`pos_venda:${id}`)!.value as Record<string, unknown>;

  it('sócio muda a etapa: grava o mesmo pos_venda:<id>, `por`, `etapa_desde` e `em` do corpo são ignorados (o `por` vem do TOKEN)', async () => {
    const res = await postObra({
      id: 101, etapa: 'protocolo', base_em: PV_101.em,
      por: 'impostor', em: '2000-01-01T00:00:00.000Z', etapa_desde: '2000-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const reg = registro(101);
    expect(reg).toMatchObject({
      modelo: 'meio_a_meio', valor: 250000.55, vendido_em: '2026-09-20', etapa: 'protocolo', por: 'thiago', responsavel: 'Marcos',
      etapa_desde: AGORA, previsto: '2026-10-21', em: AGORA,
    });
    expect(Object.keys(reg).sort()).toEqual(['em', 'etapa', 'etapa_desde', 'modelo', 'obs', 'por', 'previsto', 'responsavel', 'valor', 'vendido_em']);
    expect(res.body.obra).toMatchObject({ id: 101, etapa: 'protocolo', feitas: 2, total: 9, atrasado: false, em: AGORA });
    expect(res.body.em).toBe(AGORA);
  });
  it('trocar o modelo refaz o trilho: etapa que continua no trilho novo fica (relógio intacto); a que sai vai para a primeira etapa dele', async () => {
    // meio a meio -> chave na mão: "projeto" existe nos dois
    const a = await postObra({ id: 101, modelo: 'chave_na_mao', base_em: PV_101.em });
    expect(a.status).toBe(200);
    expect(registro(101)).toMatchObject({ modelo: 'chave_na_mao', etapa: 'projeto', etapa_desde: PV_101.etapa_desde, previsto: '2026-10-05', valor: 250000.55 });
    expect(a.body.obra).toMatchObject({ modelo: 'chave_na_mao', modelo_rotulo: 'Chave na mão', total: 10, feitas: 2 });
    // chave na mão -> carregador: "projeto" não existe; vai para "papeis", com relógio e prazo novos
    const b = await postObra({ id: 101, modelo: 'carregador', base_em: AGORA });
    expect(b.status).toBe(200);
    expect(registro(101)).toMatchObject({ modelo: 'carregador', etapa: 'papeis', etapa_desde: AGORA, previsto: '2026-10-21' });
    expect(b.body.obra).toMatchObject({ modelo: 'carregador', etapa: 'papeis', feitas: 0, total: 5, falta_informar: false });
    expect(b.body.obra.etapas.map((e: { chave: string }) => e.chave)).toEqual(['papeis', 'credito', 'pedido', 'entrega', 'concluido']);
    // modelo e etapa juntos: a etapa vale contra o trilho NOVO
    const c = await postObra({ id: 101, modelo: 'meio_a_meio', etapa: 'protocolo', base_em: AGORA });
    expect(c.status).toBe(200);
    expect(registro(101)).toMatchObject({ modelo: 'meio_a_meio', etapa: 'protocolo' });
    expect((await postObra({ id: 101, modelo: 'carregador', etapa: 'protocolo', base_em: AGORA })).body.error).toBe('etapa_fora_do_trilho');
  });
  it('venda sem modelo (as de hoje): escolher o modelo abre o trilho completo; consultor também pode', async () => {
    const res = await postObra({ id: 105, modelo: 'arrendamento', base_em: AGORA }, DIEGO);
    expect(res.status).toBe(200);
    expect(registro(105)).toMatchObject({ modelo: 'arrendamento', etapa: 'papeis', valor: null, vendido_em: '2026-08-02' });
    expect(res.body.obra).toMatchObject({ modelo: 'arrendamento', falta_informar: false, total: 10, feitas: 0 });
    const n = await postObra({ id: 101, modelo: 'cotista', base_em: PV_101.em }, NILCE);
    expect(n.status).toBe(200);
    expect(registro(101)).toMatchObject({ modelo: 'cotista', por: 'nilce' });
  });
  it('modelo inválido: 400 modelo_invalido (fora dos 6, vazio, número, lista); nada é gravado', async () => {
    for (const modelo of ['xyz', '', 7, ['carregador'], null, 'CARREGADOR']) {
      const r2 = await postObra({ id: 101, modelo, base_em: PV_101.em });
      expect(r2.status, String(modelo)).toBe(400);
      expect(r2.body, String(modelo)).toEqual({ ok: false, error: 'modelo_invalido' });
    }
    expect(registro(101)).toBe(PV_101);
  });
  it('consultor com `valor` ou `vendido_em`: 403 com a frase fixa, mesmo com outros campos válidos juntos; nada é gravado', async () => {
    for (const extra of [{ valor: 1000 }, { vendido_em: '2026-09-15' }, { valor: 'abc' }, { valor: null }]) {
      const r2 = await postObra({ id: 101, etapa: 'protocolo', ...extra, base_em: PV_101.em }, NILCE);
      expect(r2.status, JSON.stringify(extra)).toBe(403);
      expect(r2.body.error).toBe('Só sócio altera valor e data da venda.');
    }
    expect(registro(101)).toBe(PV_101);
    // a posse vem antes: card alheio com valor continua 404, igual a inexistente
    expect((await postObra({ id: 102, valor: 1, base_em: AGORA }, NILCE)).status).toBe(404);
    expect((await postObra({ id: 999, valor: 1, base_em: AGORA }, NILCE)).status).toBe(404);
  });
  it('sócio grava valor (número ou formato brasileiro) e data da venda; vazio limpa o valor', async () => {
    const a = await postObra({ id: 101, valor: '1.234,56', vendido_em: '2026-09-15', base_em: PV_101.em });
    expect(a.status).toBe(200);
    expect(registro(101)).toMatchObject({ valor: 1234.56, vendido_em: '2026-09-15', por: 'thiago', modelo: 'meio_a_meio', etapa: 'projeto' });
    expect(a.body.obra).toMatchObject({ valor: 1234.56, vendido_em: '2026-09-15' });
    expect((await postObra({ id: 101, valor: 250000, base_em: AGORA })).status).toBe(200);
    expect(registro(101).valor).toBe(250000);
    expect((await postObra({ id: 101, valor: 'R$ 8.887,77', base_em: AGORA })).status).toBe(200);
    expect(registro(101).valor).toBe(8887.77);
    expect((await postObra({ id: 101, valor: '145.000', base_em: AGORA })).status).toBe(200);
    expect(registro(101).valor).toBe(145000);   // ponto de milhar: nunca 145
    expect((await postObra({ id: 101, valor: '', base_em: AGORA })).status).toBe(200);
    expect(registro(101).valor).toBeNull();
    // inválidos
    expect((await postObra({ id: 101, valor: 'abc', base_em: AGORA })).body.error).toBe('valor_invalido');
    expect((await postObra({ id: 101, valor: -5, base_em: AGORA })).body.error).toBe('valor_invalido');
    expect((await postObra({ id: 101, valor: { a: 1 }, base_em: AGORA })).body.error).toBe('valor_invalido');
    expect((await postObra({ id: 101, vendido_em: '2026-02-30', base_em: AGORA })).body.error).toBe('data_invalida');
    expect((await postObra({ id: 101, vendido_em: '2030-01-01', base_em: AGORA })).body.error).toBe('data_invalida');
  });
  it('venda sem registro: o vendido_em que o sócio mandou vale mais que o dia do card', async () => {
    const res = await postObra({ id: 105, vendido_em: '2026-09-30', valor: 99000, base_em: AGORA }, THIAGO);
    expect(res.status).toBe(200);
    expect(registro(105)).toMatchObject({ vendido_em: '2026-09-30', valor: 99000, modelo: '' });
  });
  it('o pos_venda:<id> segue no formato que a Agenda lê: as mesmas 10 chaves, tipos certos, relido pelo módulo puro', async () => {
    const campos = { id: 101, modelo: 'carregador', valor: 5000, vendido_em: '2026-09-18', responsavel: 'Ze', obs: 'ok', previsto: '2026-11-01', base_em: PV_101.em };
    expect((await postObra(campos)).status).toBe(200);
    const reg = registro(101);
    expect(Object.keys(reg).sort()).toEqual(['em', 'etapa', 'etapa_desde', 'modelo', 'obs', 'por', 'previsto', 'responsavel', 'valor', 'vendido_em']);
    expect(reg).toMatchObject({ modelo: 'carregador', valor: 5000, vendido_em: '2026-09-18', etapa: 'papeis', previsto: '2026-11-01', responsavel: 'Ze', obs: 'ok', por: 'thiago' });
    expect(typeof reg.etapa_desde).toBe('string');
    expect(typeof reg.em).toBe('string');
    // a mesma regra pura que a rota pública da Agenda usa aceita o registro como "atual" e não o altera
    const { montarPosVenda } = await import('../services/agenda/posVendaEletroposto');
    const reler = montarPosVenda({ obs: 'ok' }, reg as never, AGORA, '2026-10-14');
    expect(reler.ok && reler.registro).toMatchObject({ modelo: 'carregador', valor: 5000, vendido_em: '2026-09-18', etapa: 'papeis' });
  });
  it('consultor mexe no card dele; `por` é o nome do token', async () => {
    const res = await postObra({ id: 101, responsavel: 'Lucas', obs: 'Ligar na sexta', base_em: PV_101.em }, NILCE);
    expect(res.status).toBe(200);
    expect(registro(101)).toMatchObject({ por: 'nilce', responsavel: 'Lucas', obs: 'Ligar na sexta', etapa: 'projeto' });
    expect(registro(101).etapa_desde).toBe(PV_101.etapa_desde);   // mesma etapa: o relógio dela não zera
  });
  it('etapa fora do trilho do modelo daquele card é recusada com o código da regra pura, e nada é gravado', async () => {
    const res = await postObra({ id: 101, etapa: 'credito', base_em: PV_101.em });   // meio a meio não tem crédito
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'etapa_fora_do_trilho' });
    expect((await postObra({ id: 101, etapa: 42, base_em: PV_101.em })).body.error).toBe('etapa_fora_do_trilho');
    expect(registro(101)).toBe(PV_101);
  });
  it('previsto, texto e corpo inválidos: 400 com o código; nada a gravar também', async () => {
    expect((await postObra({ id: 101, previsto: '2026-02-30', base_em: PV_101.em })).body.error).toBe('previsto_invalido');
    expect((await postObra({ id: 101, obs: { a: 1 }, base_em: PV_101.em })).body.error).toBe('texto_invalido');
    expect((await postObra({ id: 101, base_em: PV_101.em })).body.error).toBe('nada_a_gravar');
    expect((await postObra({ id: 'x', etapa: 'projeto' })).body.error).toBe('id_invalido');
    expect((await request(app).post('/gerador/obras/eletroposto').set('Authorization', THIAGO).send({ id: 101, etapa: 'projeto' })).body.error).toBe('base_em_invalido');
    expect(registro(101)).toBe(PV_101);
  });
  it('posse: card alheio, inexistente, de solar e não vendido dão o MESMO 404 para o consultor; nada é gravado', async () => {
    const antes = h.linhas.size;
    const resp = [];
    for (const id of [102, 999, 103, 104]) resp.push(await postObra({ id, etapa: 'papeis', base_em: AGORA }, NILCE));
    for (const x of resp) { expect(x.status).toBe(404); expect(x.body).toEqual({ ok: false, error: 'Venda não encontrada.' }); }
    // a posse vem antes da regra de etapa: card alheio com etapa torta também é 404
    expect((await postObra({ id: 102, etapa: 'ZZ', base_em: AGORA }, NILCE)).status).toBe(404);
    expect(h.linhas.size).toBe(antes);
    expect(registro(102)).toBe(PV_102);
    // sócio mexe em qualquer um
    expect((await postObra({ id: 102, responsavel: 'Zé', base_em: PV_102.em }, THIAGO)).status).toBe(200);
  });
  it('409: OUTRA pessoa gravou depois da leitura de quem pede; nada é sobrescrito', async () => {
    const res = await postObra({ id: 101, etapa: 'protocolo', base_em: '2026-09-01T00:00:00.000Z' }, DIEGO);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, conflito: true, por: 'thiago' });
    expect(res.body.obra).toMatchObject({ id: 101, etapa: 'projeto' });
    expect(registro(101)).toBe(PV_101);
  });
  it('a mesma pessoa não conflita consigo mesma: duas gravações seguidas com o mesmo base_em passam; outra pessoa com esse base_em dá 409', async () => {
    const a = await postObra({ id: 101, responsavel: 'Lucas', base_em: PV_101.em }, NILCE);
    expect(a.status).toBe(200);
    const b = await postObra({ id: 101, obs: 'segunda', base_em: PV_101.em }, NILCE);   // mesma aba velha, mesma pessoa
    expect(b.status).toBe(200);
    expect(registro(101)).toMatchObject({ responsavel: 'Lucas', obs: 'segunda', por: 'nilce' });
    const c = await postObra({ id: 101, obs: 'intrusa', base_em: PV_101.em }, THIAGO);
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ conflito: true, por: 'nilce' });
    expect(registro(101)).toMatchObject({ obs: 'segunda' });
  });
  it('corrida da MESMA pessoa: o compare-and-swap relê e grava por cima do que ela mesma gravou no meio, sem perder o resto', async () => {
    const meio = { ...PV_101, responsavel: 'Meio', por: 'nilce', em: '2026-10-14T14:59:00.000Z' };
    h.noMeio = () => { h.linhas.set('pos_venda:101', { value: meio, updated_at: 'v-meio' }); };
    const res = await postObra({ id: 101, obs: 'depois', base_em: PV_101.em }, NILCE);
    expect(res.status).toBe(200);
    expect(registro(101)).toMatchObject({ responsavel: 'Meio', obs: 'depois', por: 'nilce' });
  });
  it('corrida: gravação de outra pessoa entre a leitura e a escrita vira 409, nunca sobrescrita calada', async () => {
    const outro = { ...PV_101, responsavel: 'Outro', por: 'giovanna', em: '2026-10-14T14:59:00.000Z' };
    h.noMeio = () => { h.linhas.set('pos_venda:101', { value: outro, updated_at: 'v-outro' }); };
    const res = await postObra({ id: 101, etapa: 'protocolo', base_em: PV_101.em });
    expect(res.status).toBe(409);
    expect(registro(101)).toBe(outro);
  });
  it('venda sem registro: nasce com "vendido em" do card (nunca de hoje), modelo a confirmar e só a etapa de papéis', async () => {
    const res = await postObra({ id: 105, etapa: 'papeis', responsavel: 'Rita', base_em: AGORA }, DIEGO);
    expect(res.status).toBe(200);
    expect(registro(105)).toMatchObject({ modelo: '', valor: null, vendido_em: '2026-08-02', etapa: 'papeis', responsavel: 'Rita', por: 'diego', previsto: '2026-10-21' });
    expect(res.body.obra).toMatchObject({ id: 105, falta_informar: true, feitas: 0, total: 1 });
    expect((await postObra({ id: 105, etapa: 'projeto', base_em: AGORA }, DIEGO)).body.error).toBe('etapa_fora_do_trilho');
  });
});

describe('a ficha não vaza por rota pública', () => {
  it('o prefixo cliente_ep: só é lido pelos três arquivos da ficha', () => {
    const raiz = path.resolve(__dirname, '..');
    const achados: string[] = [];
    const anda = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') anda(p); continue; }
        if (!/\.(ts|js)$/.test(e.name)) continue;
        if (/cliente_ep|PREFIXO_FICHA_EP|chaveFichaEp/.test(fs.readFileSync(p, 'utf8'))) achados.push(path.relative(raiz, p).replace(/\\/g, '/'));
      }
    };
    anda(raiz);
    expect(achados.sort()).toEqual([
      'routes/geradorEletropostoClientes.ts', 'services/gerador/fichaEletroposto.ts', 'services/gerador/fichaEletropostoBanco.ts',
    ]);
  });
  it('colunas de sócio existem só no catálogo do sócio', () => {
    const consultor = colunasFichaPara(false).map((c) => c.chave);
    for (const k of SOCIO) expect(consultor).not.toContain(k);
    expect(colunasFichaPara(true).map((c) => c.chave)).toEqual(expect.arrayContaining(SOCIO));
  });
});

void GIOVANNA;
