import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Planilha de clientes com as linhas do /gerador (fase 2): GET da grade e POST /campo. Login, bancos, planilha e cadastro
// simulados; nada sai para a rede. Dados inventados.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  csv: '',
  linhas: new Map<string, { value: any; updated_at: string }>(),
  cards: [] as Array<Record<string, any>>,
  propostas: [] as Array<Record<string, any>>,
  cads: new Map<number, any>(),
  cardsCaem: false,
  cadFalha: 0,
  csvCai: false,
  gestaoCai: false,
  geradorOverlayCai: false,
  registroCai: false,
  tique: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: (t: string) => ({
      select: () => ({
        in: async (c: string, vs: unknown[]) => {
          if (t === 'agendamentos' && h.cardsCaem) return { data: null, error: { code: 'XX000' } };
          return { data: (t === 'agendamentos' ? h.cards : h.propostas).filter((r) => vs.includes(r[c])), error: null };
        },
        eq: (_c: string, id: unknown) => ({ maybeSingle: async () => ({ data: h.cards.find((r) => r.id === id) ?? null, error: null }) }),
      }),
    }),
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const stamp = () => `2026-10-22T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          in: async (_c: string, chaves: string[]) => {
            if (h.geradorOverlayCai && chaves.some((k) => k.startsWith('gestao_gerador:'))) return { data: null, error: { code: 'XX000' } };
            if (h.gestaoCai && chaves.some((k) => k.startsWith('gestao_cliente:'))) return { data: null, error: { code: 'XX000' } };
            return { data: chaves.filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null };
          },
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => {
              if (h.registroCai && k.startsWith('codigo_solar:')) return { data: null, error: { code: 'XX000' } };
              const l = h.linhas.get(k);
              return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
            },
          }),
          like: (_c: string, p: string) => {
            const prefixo = p.replace(/%$/, '');
            const chain: any = {
              order: () => chain,
              range: async () => ({ data: [...h.linhas.entries()].filter(([k]) => k.startsWith(prefixo)).map(([k, l]) => ({ key: k, value: l.value })), error: null }),
            };
            return chain;
          },
        }),
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505' } };
          h.linhas.set(l.key, { value: l.value, updated_at: l.key.startsWith('cadastro_trava:') ? String(l.updated_at) : stamp() });
          return { error: null };
        },
        delete: () => ({
          eq: (_c: string, k: string) => ({
            eq: (_c2: string, v: string) => ({
              select: async () => {
                const l = h.linhas.get(k);
                if (!l || l.updated_at !== v) return { data: [], error: null };
                h.linhas.delete(k);
                return { data: [{ key: k }], error: null };
              },
            }),
          }),
        }),
        update: (novo: { value: unknown }) => ({
          eq: (_c: string, k: string) => ({
            eq: (_c2: string, v: string) => ({
              select: async () => {
                const l = h.linhas.get(k);
                if (!l || l.updated_at !== v) return { data: [], error: null };
                h.linhas.set(k, { value: novo.value, updated_at: stamp() });
                return { data: [{ key: k }], error: null };
              },
            }),
            is: () => ({ select: async () => ({ data: [], error: null }) }),
          }),
        }),
      };
    },
  },
}));
vi.mock('../services/gerador/cadastroVenda', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVenda')>()),
  lerCadastros: vi.fn(async (ids: number[]) => {
    const falhas = new Set(ids.filter((i) => i === h.cadFalha));
    return { mapa: new Map(ids.filter((i) => h.cads.has(i) && !falhas.has(i)).map((i) => [i, h.cads.get(i)])), falhas, indisponivel: false };
  }),
}));

import { mountClientes, limparCacheClientes } from '../routes/geradorClientes';
import { mountVendaSolar } from '../routes/geradorVendaSolar';
import { dependenciasDoAlocador } from '../routes/geradorVendaSolarCliente';
import { alocarCodigoSolar } from '../services/gerador/vendaSolarCodigo';
import { assinarLigacao, invalidarCachesHub, type Ligacao } from '../services/gerador/vendaSolarHub';
import { assinarRegistro } from '../services/gerador/vendaSolarRegistro';
import { CABECALHO, linha, paraCsv } from './solarPlanilhaFixture';

const r = Router();
mountClientes(r);
mountVendaSolar(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const grade = (auth = THIAGO) => request(app).get('/gerador/clientes/solar').set('Authorization', auth);
const campo = (corpo: Record<string, unknown>, auth = THIAGO) =>
  request(app).post('/gerador/clientes/solar/campo').set('Authorization', auth).send({ base_em: '2026-10-22T11:00:00.000Z', ...corpo });

const cad = (campos: Record<string, string>) => ({ v: 1, alteracoes: [], em: null, campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'x', em: 'x', fonte: 'manual' }])) });
const card = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Hermes Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia mg', vendedor_nome: 'Nilce',
  created_by: 'lp_solar', status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', ...o,
});
const ligar = (id: number, lig: Partial<Ligacao>) => {
  const l: Ligacao = { proposta: null, venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', ...lig };
  h.linhas.set(`venda_solar:${id}`, { updated_at: 'x', value: { ...l, sig: assinarLigacao(id, l) } });
};
const registro = (codigo: string, cardId: number) => {
  const x = { codigo, card: cardId, por: 'nilce', em: '2026-10-22T10:00:00.000Z', origem: 'novo' as const };
  h.linhas.set(`codigo_solar:${codigo.slice(1)}`, { updated_at: 'r', value: { ...x, sig: assinarRegistro(x) } });
};
const linhaDe = (res: request.Response, codigo: string) => res.body.linhas.find((l: { codigo: string }) => l.codigo === codigo);

beforeEach(() => {
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app' };
  h.csv = paraCsv([CABECALHO,
    linha({ codigo: '#0057', cliente: 'Ana', homologacao: 'Ana Souza Inventada', consultor: 'Nilce', contato: '34999990001', cadastro: '03/08/2026' }),
    linha({ codigo: '#0058', cliente: 'Bruno', homologacao: 'Bruno Lima Inventado', consultor: 'Giovanna', contato: '34977770002' }),
    linha({ codigo: '#0060', cliente: 'Caio', consultor: '' }),
  ]);
  h.linhas = new Map(); h.tique = 0; h.cardsCaem = false; h.geradorOverlayCai = false; h.registroCai = false; h.csvCai = false; h.gestaoCai = false; h.cadFalha = 0;
  process.env.TRELLO_KEY = 'chave-trello-falsa'; process.env.TRELLO_TOKEN = 'token-trello-falso';
  h.cards = [card(1143), card(1144, { cliente_nome: 'Ana Souza Inventada', cliente_telefone: '34999990001' }),
    card(1145, { cliente_nome: 'Pedro Outro', cliente_telefone: '34977770002' }), card(1146, { cliente_nome: 'Caio' })];
  h.propostas = [];
  h.cads = new Map([[1143, cad({ nome: 'Hermes Inventado', endereco_ponto: 'Rua da Usina, 10, Centro, Uberlândia - MG' })]]);
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste-inventado';
  delete process.env.SOLAR_SOCIOS;
  limparCacheClientes(); invalidarCachesHub();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('docs.google.com')) return h.csvCai ? new Response('erro', { status: 500 }) : new Response(h.csv, { status: 200 });
    if (String(url).includes('trello.com')) return new Response('[]', { status: 200 });
    throw new Error('rede indisponível no teste');
  }));
  // #0070: só no /gerador (alocador, card 1143). #0057: alocador do card 1144, mesmo cliente (junta). #0058: alocador do card 1145, outro cliente (conflito).
  ligar(1143, { venda: '#0070', por: 'gerador' }); registro('#0070', 1143);
  ligar(1144, { venda: '#0057', por: 'gerador' }); registro('#0057', 1144);
  ligar(1145, { venda: '#0058', por: 'gerador' }); registro('#0058', 1145);
  ligar(1146, { venda: '#0060', por: 'nilce' });   // ligação de gente: junta
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GET /clientes/solar com a camada do /gerador', () => {
  it('só-Gerador, junta e conflito; fonte com as três; aviso de mesmo telefone sem telefone', async () => {
    const res = await grade();
    expect(res.status).toBe(200);
    expect(res.body.fonte).toEqual({ planilha: true, gerador: true, cadastro: true });
    const l70 = linhaDe(res, '#0070');
    expect(l70).toMatchObject({ so_gerador: true, card: 1143, aviso_telefone: 'Mesmo telefone da linha #0057 do Excel. Se for a mesma venda, use no Excel o número #0070.' });
    expect(l70.celulas.cliente).toEqual({ valor: 'Hermes', origem: 'gerador', fixa: true });
    expect(l70.celulas.endereco).toMatchObject({ valor: 'Rua da Usina, 10, Centro, Uberlândia - MG', fixa: true });
    expect(l70.celulas.engenheiro).toEqual({ valor: 'Guilherme', origem: 'gerador' });
    const l57 = linhaDe(res, '#0057');
    expect(l57.card).toBe(1144);
    expect(l57.celulas.cliente).toMatchObject({ valor: 'Ana', origem: 'planilha', fixa: true });
    expect(l57.celulas.engenheiro).toMatchObject({ valor: 'Guilherme', origem: 'gerador' });
    expect(linhaDe(res, '#0058')).toMatchObject({ conflito: 'planilha' });
    expect(linhaDe(res, '#0058@1145')).toMatchObject({ exibir: '#0058', conflito: 'gerador', somente_leitura: true });
    expect(JSON.stringify(l70.aviso_telefone)).not.toMatch(/99999/);
  });

  it('consultor vê só as dele; outro consultor não vê a linha só-Gerador nem a coluna de sócio', async () => {
    expect(linhaDe(await grade(NILCE), '#0070')).toBeTruthy();
    const g = await grade(GIOVANNA);
    expect(linhaDe(g, '#0070')).toBeUndefined();
    expect(JSON.stringify(g.body.catalogo)).not.toMatch(/valor_venda/);
  });

  it('cards, propostas ou o overlay do card fora do ar: 200 só com o CSV e fonte.gerador false (S7)', async () => {
    h.cardsCaem = true;
    const a = await grade();
    expect(a.status).toBe(200);
    expect(a.body.fonte.gerador).toBe(false);
    expect(linhaDe(a, '#0070')).toBeUndefined();
    h.cardsCaem = false; invalidarCachesHub();
    h.geradorOverlayCai = true;
    const b = await grade();
    expect(b.status).toBe(200);
    expect(b.body.fonte.gerador).toBe(false);
  });
});

describe('portão do número com a planilha fora e os overlays fora (leitores de verdade)', () => {
  it('fresca falha, a cópia sai sem overlay: quem não é sócio recebe candidatos [] e ocultas >= 1 (/cliente e o caminho da rota do Trello)', async () => {
    h.csv = paraCsv([CABECALHO,
      linha({ codigo: '#0061', cliente: 'Dora', homologacao: 'Dora Inventada', consultor: 'Nilce', contato: '34955550000' }),
    ]);
    h.cards.push(card(1147, { cliente_nome: 'Parente Inventado', cliente_telefone: '(34) 95555-0000' }));
    expect((await grade()).status).toBe(200);   // aquece o cache do módulo
    h.csvCai = true; h.gestaoCai = true;
    const r = await request(app).post('/gerador/vendas-solares/1147/cliente').set('Authorization', NILCE).send({});
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ precisa: 'confirmar', candidatos: [] });
    expect(r.body.ocultas).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(r.body)).not.toMatch(/Dora|95555/);
    // o mesmo caminho que a rota do Trello usa (as mesmas dependências e novo: false)
    const t = await alocarCodigoSolar({ card: h.cards.find((c) => c.id === 1147) as any, quem: { nome: 'nilce', socio: false }, novo: false }, dependenciasDoAlocador());
    expect(t).toMatchObject({ ok: false, motivo: 'confirmar', candidatos: [] });
    expect((t as { ocultas: number }).ocultas).toBeGreaterThanOrEqual(1);
    // o sócio vê o nome (só ele)
    const s = await request(app).post('/gerador/vendas-solares/1147/cliente').set('Authorization', THIAGO).send({});
    expect(s.body.candidatos.map((c: { codigo: string }) => c.codigo)).toEqual(['#0061']);
  });
});

describe('POST /clientes/solar/campo com as linhas do /gerador', () => {
  it('linha só-Gerador: coluna não pessoal grava na chave do CARD (S2); pessoal e consultor dão 400; #N@card 400; alheio 404 igual a inexistente', async () => {
    const ok = await campo({ codigo: '#0070', coluna: 'engenheiro', valor: 'Fulano' }, NILCE);
    expect(ok.status).toBe(200);
    expect(ok.body.celula).toMatchObject({ valor: 'Fulano', origem: 'sistema' });
    expect(h.linhas.has('gestao_gerador:1143')).toBe(true);
    expect(h.linhas.has('gestao_cliente:0070')).toBe(false);
    expect(linhaDe(await grade(), '#0070').celulas.engenheiro).toMatchObject({ valor: 'Fulano', origem: 'sistema' });
    for (const coluna of ['cliente', 'homologacao', 'contato', 'endereco', 'cidade', 'uf']) {
      const x = await campo({ codigo: '#0070', coluna, valor: 'Algo' });
      expect(x.status).toBe(400);
      expect(x.body.error).toBe('Esta informação vem do cadastro do card. Para mudar, edite no card da agenda.');
    }
    expect((await campo({ codigo: '#0070', coluna: 'consultor', valor: 'Diego' })).body.error).toBe('O consultor vem do card da agenda. Para trocar, transfira o card.');
    expect((await campo({ codigo: '#0070@1143', coluna: 'engenheiro', valor: 'X' })).status).toBe(400);
    const alheio = await campo({ codigo: '#0070', coluna: 'engenheiro', valor: 'X' }, GIOVANNA);
    const inexistente = await campo({ codigo: '#0099', coluna: 'engenheiro', valor: 'X' }, GIOVANNA);
    expect(alheio.status).toBe(404);
    expect(alheio.body).toEqual(inexistente.body);
  });

  it('linha do CSV com registro do alocador: coluna pessoal 400 mesmo com o /gerador fora do ar; registro ilegível 503 sem gravar', async () => {
    expect((await campo({ codigo: '#0057', coluna: 'contato', valor: '34911112222' })).status).toBe(400);
    h.cardsCaem = true; invalidarCachesHub();
    for (const coluna of ['cliente', 'homologacao', 'contato', 'endereco', 'cidade', 'uf']) {
      expect((await campo({ codigo: '#0057', coluna, valor: '34911112222' })).status).toBe(400);
    }
    h.registroCai = true;
    expect((await campo({ codigo: '#0057', coluna: 'cidade', valor: 'Araguari' })).status).toBe(503);
    expect([...h.linhas.keys()].some((k) => k.startsWith('gestao_'))).toBe(false);
    // linha sem registro (ligação de gente) segue editável como antes
    h.registroCai = false;
    expect((await campo({ codigo: '#0060', coluna: 'cidade', valor: 'Araguari' })).status).toBe(200);
  });

  it('S1: na linha junta sem consultor no CSV, o vendedor do card que vê a linha também grava', async () => {
    const g = await grade(NILCE);
    expect(linhaDe(g, '#0060')).toBeTruthy();
    expect((await campo({ codigo: '#0060', coluna: 'engenheiro', valor: 'Fulano' }, NILCE)).status).toBe(200);
    expect((await campo({ codigo: '#0060', coluna: 'engenheiro', valor: 'Fulano' }, GIOVANNA)).status).toBe(404);
  });

  it('P2-1: editar uma célula cujo valor veio do /gerador não grava esse valor na trilha (nem no código, nem no card)', async () => {
    // #0070 só-Gerador: concessionária montada pela UF da instalação (Cemig); #0057 junta: engenheiro montado ("Guilherme")
    expect((await campo({ codigo: '#0070', coluna: 'concessionaria', valor: 'Equatorial' })).status).toBe(200);
    expect((await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'Fulano' })).status).toBe(200);
    const trilhas = [...h.linhas.entries()].filter(([k]) => k.startsWith('gestao_')).flatMap(([, l]) => l.value.alteracoes);
    expect(trilhas.length).toBe(2);
    expect(trilhas.every((a: { antes: unknown }) => a.antes === null)).toBe(true);
  });

  it('G-1: na linha do CSV, sem a linha do /gerador lida, o POST não manda progresso (a tela recalcula)', async () => {
    const x = await campo({ codigo: '#0057', coluna: 'depoimento', valor: 'Sim' });
    expect(x.status).toBe(200);
    expect(x.body.progresso).toBeUndefined();
    const y = await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'Fulano' });
    expect(y.body.progresso).toBeDefined();
  });

  it('G-3: na linha junta, o digitado no card aparece no POST e apagar um valor que só existe ali apaga ali', async () => {
    h.linhas.set('gestao_gerador:1144', { updated_at: 'g1', value: { campos: { depoimento: { valor: 'Pedido', por: 'nilce', em: '2026-10-22T10:00:00.000Z' } }, alteracoes: [], em: null } });
    const g = await grade();
    expect(linhaDe(g, '#0057').celulas.depoimento).toMatchObject({ valor: 'Pedido', origem: 'sistema' });
    const x = await campo({ codigo: '#0057', coluna: 'depoimento', valor: '' });
    expect(x.status).toBe(200);
    expect(x.body.celula.valor).toBeNull();
    expect(h.linhas.get('gestao_gerador:1144')!.value.campos.depoimento).toBeUndefined();
    expect(h.linhas.has('gestao_cliente:0057')).toBe(false);
  });

  it('G-9: a tela manda o card da linha só-Gerador; código que entrou no CSV de outro jeito (ou de outro card) dá 409', async () => {
    expect((await campo({ codigo: '#0070', coluna: 'engenheiro', valor: 'X', card: 1143 })).status).toBe(200);
    const x = await campo({ codigo: '#0070', coluna: 'engenheiro', valor: 'X', card: 9999 });
    expect(x.status).toBe(409);
    expect(x.body.error).toBe('A linha mudou. Recarregue a página.');
    expect((await campo({ codigo: '#0058', coluna: 'engenheiro', valor: 'X', card: 1145 })).status).toBe(409);   // conflito, não junta
    expect((await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'X', card: 1144 })).status).toBe(200);   // junta deste card
    expect((await campo({ codigo: '#0070', coluna: 'engenheiro', valor: 'X', card: 'abc' })).status).toBe(400);
  });

  it('item 1: registro apagado e ligação por gerador: a coluna pessoal continua travada', async () => {
    h.linhas.delete('codigo_solar:0057');
    expect((await campo({ codigo: '#0057', coluna: 'contato', valor: '34911112222' })).status).toBe(400);
  });

  it('item 2: linha do Excel sem nome nem telefone, mas com endereço de outro cliente, vira conflito (não junta)', async () => {
    h.csv = paraCsv([CABECALHO, linha({ codigo: '#0062', endereco: 'Rua De Outro Cliente, 5', consultor: 'Nilce' })]);
    limparCacheClientes();
    h.cards.push(card(1147, { cliente_nome: 'Iris Inventada' }));
    ligar(1147, { venda: '#0062', por: 'gerador' }); registro('#0062', 1147);
    const g = await grade();
    expect(linhaDe(g, '#0062')).toMatchObject({ conflito: 'planilha' });
    expect(linhaDe(g, '#0062@1147')).toMatchObject({ conflito: 'gerador' });
  });

  it('item 3: apagar a célula que mostra o valor do Excel não apaga o valor escondido no overlay do card', async () => {
    h.csv = paraCsv([CABECALHO, linha({ codigo: '#0057', cliente: 'Ana', homologacao: 'Ana Souza Inventada', consultor: 'Nilce', contato: '34999990001', depoimento: 'Sim' })]);
    limparCacheClientes();
    h.linhas.set('gestao_gerador:1144', { updated_at: 'g1', value: { campos: { depoimento: { valor: 'Pedido', por: 'nilce', em: '2026-10-22T10:00:00.000Z' } }, alteracoes: [], em: null } });
    expect((await campo({ codigo: '#0057', coluna: 'depoimento', valor: '' })).status).toBe(200);
    expect(h.linhas.get('gestao_gerador:1144')!.value.campos.depoimento.valor).toBe('Pedido');
    expect(h.linhas.has('gestao_cliente:0057')).toBe(false);
  });

  it('item 3 (final): par pulado mostra as colunas pessoais como só leitura na grade', async () => {
    h.cadFalha = 1144;
    const g = await grade();
    const l57 = linhaDe(g, '#0057');
    expect(l57.celulas.contato.fixa).toBe(true);
    expect(l57.celulas.engenheiro.fixa).toBeUndefined();
  });

  it('item 2 (final): obs ou outro equipamento preenchidos também tiram a linha de "vazia"', async () => {
    // a fixture não tem OBS nem OUTRO EQUIP: entram no fim do cabeçalho
    const cab = [...CABECALHO, 'OBS:', 'OUTRO EQUIP'];
    h.cards.push(card(1147, { cliente_nome: 'Iris Inventada' }), card(1148, { cliente_nome: 'Jonas Inventado' }));
    ligar(1147, { venda: '#0062', por: 'gerador' }); registro('#0062', 1147);
    ligar(1148, { venda: '#0063', por: 'gerador' }); registro('#0063', 1148);
    h.csv = paraCsv([cab, [...linha({ codigo: '#0062', consultor: 'Nilce' }), 'Obra do vizinho', ''], [...linha({ codigo: '#0063', consultor: 'Nilce' }), '', 'Bateria do vizinho']]);
    limparCacheClientes();
    const g = await grade();
    expect(linhaDe(g, '#0062')).toMatchObject({ conflito: 'planilha' });
    expect(linhaDe(g, '#0063')).toMatchObject({ conflito: 'planilha' });
  });

  it('item 5: par pulado (cadastro do card não respondeu) não manda progresso', async () => {
    h.cadFalha = 1144;
    const x = await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'Fulano' });
    expect(x.status).toBe(200);
    expect(x.body.progresso).toBeUndefined();
  });

  it('item 6: quem só vê a linha junta pelo CSV não descobre o card testando valores (409 igual)', async () => {
    h.cards.find((c) => c.id === 1144)!.vendedor_nome = 'Giovanna';
    const certo = await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'X', card: 1144 }, NILCE);
    const errado = await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'X', card: 1999 }, NILCE);
    expect(certo.status).toBe(409);
    expect(certo.body).toEqual(errado.body);
    expect((await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'X', card: 1144 }, THIAGO)).status).toBe(200);   // sócio confere
  });

  it('nenhum dado pessoal em gestao_*', async () => {
    await campo({ codigo: '#0070', coluna: 'engenheiro', valor: 'Fulano' });
    await campo({ codigo: '#0057', coluna: 'engenheiro', valor: 'Ciclano' });
    const tudo = JSON.stringify([...h.linhas.entries()].filter(([k]) => k.startsWith('gestao_')));
    expect(tudo).not.toMatch(/Hermes|Ana Souza|99999|Rua da Usina/);
  });
});
