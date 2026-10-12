import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rotas do financeiro por cliente, de verdade, com o login, o `system_state`, o
// Storage e a IA simulados em memória. O que se prova aqui: quem vê o quê (o
// gasto nunca sai para quem não é sócio), que o autor é o do token, que o mesmo
// pedido duas vezes é uma linha só e que arquivo ruim não entra.
//
// Nenhum dado de cliente de verdade: nomes, valores e ids são inventados.

type Linha = { key: string; value: unknown };

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  estado: new Map<string, unknown>(),
  erroEstado: false,
  consultas: [] as Array<{ padrao: string; de: number; ate: number; ordenado: boolean }>,
  carimbos: new Map<string, string>(),
  gravacoes: [] as Array<{ op: 'insert' | 'update'; chave: string; linha: Record<string, unknown> }>,
  antesDeGravar: null as null | (() => void),
  limitador: 0,
  bucketPublico: false as boolean | undefined,
  lerBucketFalha: false,
  leiturasDoBucket: 0,
  bucketExiste: true,
  criarBucketFalha: false,
  assinarFalha: false,
  uploads: [] as Array<{ bucket: string; path: string; bytes: number; opcoes: unknown }>,
  bucketsCriados: [] as Array<{ nome: string; opcoes: unknown }>,
  leitura: null as null | ((entrada: { bytes: Buffer; media_type: string; hojeBr?: string }) => unknown),
  leituras: [] as Array<{ bytes: number; media_type: string; hojeBr?: string }>,
  log: { error: [] as unknown[][] },
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn((...a: unknown[]) => { h.log.error.push(a); }), warn: vi.fn(), info: vi.fn() },
}));
// O limite de IA é por IP e por minuto: aqui todos os pedidos vêm do mesmo lugar.
vi.mock('../middleware/rateLimiter', () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => { h.limitador++; next(); },
}));
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
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => {
          let padrao = '';
          let ordenado = false;
          const q = {
            like: (_c: string, p: string) => { padrao = p; return q; },
            order: () => { ordenado = true; return q; },
            // Igual ao PostgREST: devolve no máximo o intervalo pedido, e nunca
            // mais de 1000 linhas por vez.
            range: async (de: number, ate: number) => {
              h.consultas.push({ padrao, de, ate, ordenado });
              if (h.erroEstado) return { data: null, error: { message: 'boom do banco' } };
              const prefixo = padrao.replace(/%$/, '');
              const linhas: Linha[] = [...h.estado.entries()]
                .filter(([k]) => k.startsWith(prefixo))
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .slice(de, Math.min(ate + 1, de + 1000))
                .map(([key, value]) => ({ key, value: JSON.parse(JSON.stringify(value)) }));
              return { data: linhas, error: null };
            },
            eq: (_c: string, k: string) => ({
              maybeSingle: async () => {
                if (h.erroEstado) return { data: null, error: { message: 'boom do banco' } };
                if (!h.estado.has(k)) return { data: null, error: null };
                // Igual ao Postgres: o carimbo volta com "+00:00", não com "Z".
                const carimbo = h.carimbos.get(k);
                return {
                  data: { key: k, value: JSON.parse(JSON.stringify(h.estado.get(k))), updated_at: carimbo ? carimbo.replace('Z', '+00:00') : null },
                  error: null,
                };
              },
            }),
          };
          return q;
        },
        // INSERT de verdade: chave repetida é erro 23505, não sobrescreve.
        insert: async (linha: Record<string, unknown>) => {
          const gancho = h.antesDeGravar; h.antesDeGravar = null; gancho?.();
          if (h.erroEstado) return { error: { message: 'boom do banco' } };
          const chave = String(linha.key);
          if (h.estado.has(chave)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          h.gravacoes.push({ op: 'insert', chave, linha });
          h.estado.set(chave, JSON.parse(JSON.stringify(linha.value)));
          h.carimbos.set(chave, String(linha.updated_at));
          return { error: null };
        },
        // UPDATE com filtro: só grava a linha que casa com TODOS os filtros, e
        // devolve as linhas afetadas (vazio quando o `updated_at` já é outro).
        update: (valores: Record<string, unknown>) => {
          const filtros: Record<string, unknown> = {};
          const q = {
            eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
            is: (c: string, v: unknown) => { filtros[c] = v; return q; },
            select: async () => {
              const gancho = h.antesDeGravar; h.antesDeGravar = null; gancho?.();
              if (h.erroEstado) return { data: null, error: { message: 'boom do banco' } };
              const chave = String(filtros.key);
              const guardado = h.carimbos.get(chave) ?? null;
              const pedido = (filtros.updated_at ?? null) as string | null;
              const casa = h.estado.has(chave) && 'updated_at' in filtros
                && (pedido === null ? guardado === null : guardado !== null && Date.parse(pedido) === Date.parse(guardado));
              if (!casa) return { data: [], error: null };
              h.gravacoes.push({ op: 'update', chave, linha: valores });
              h.estado.set(chave, JSON.parse(JSON.stringify(valores.value)));
              h.carimbos.set(chave, String(valores.updated_at));
              return { data: [{ key: chave }], error: null };
            },
          };
          return q;
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, corpo: Buffer, opcoes: unknown) => {
          h.uploads.push({ bucket, path, bytes: corpo.length, opcoes });
          if (!h.bucketExiste) return { data: null, error: { message: 'Bucket not found' } };
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string, segundos: number) => (h.assinarFalha
          ? { data: null, error: { message: 'sem assinatura' } }
          : { data: { signedUrl: `https://assinado.test/${path}?exp=${segundos}` }, error: null }),
        download: async () => ({ data: null, error: { message: 'não usado' } }),
      }),
      getBucket: async (nome: string) => {
        h.leiturasDoBucket++;
        if (h.lerBucketFalha) return { data: null, error: { message: 'fetch failed' } };
        if (!h.bucketExiste) return { data: null, error: { message: 'Bucket not found' } };
        return { data: { name: nome, public: h.bucketPublico }, error: null };
      },
      createBucket: async (nome: string, opcoes: unknown) => {
        h.bucketsCriados.push({ nome, opcoes });
        if (h.criarBucketFalha) return { data: null, error: { message: 'new row violates row-level security policy' } };
        h.bucketExiste = true;
        return { data: { name: nome }, error: null };
      },
    },
  },
}));
vi.mock('../services/gerador/financeiroLeitura', () => ({
  lerComprovante: vi.fn(async (entrada: { bytes: Buffer; media_type: string; hojeBr?: string }) => {
    h.leituras.push({ bytes: entrada.bytes.length, media_type: entrada.media_type, hojeBr: entrada.hojeBr });
    if (!h.leitura) throw new Error('leitura não simulada');
    return h.leitura(entrada);
  }),
}));

import { mountFinanceiro } from '../routes/geradorFinanceiro';
import { esquecerConferenciaDoBucket } from '../services/gerador/financeiroArquivos';

const r = Router();
mountFinanceiro(r);
const app = express();
app.use(express.json({ limit: '10mb' }));   // igual ao app.ts: o padrão de 100 kb barraria o upload antes da rota
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';        // consultora
const GIOVANNA = 'Bearer tk-giovanna';  // consultora
const THIAGO = 'Bearer tk-thiago';      // sócio
const CARD = 501;
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Valores "com cara própria", para procurar no corpo da resposta sem falso positivo.
const GASTO = 1_873_219;
const ENTRADA = 1_000_000;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 4)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(32, 5)]);
const PDF = Buffer.from('%PDF-1.4\ncomprovante de teste\n%%EOF');

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app',
    'tk-thiago': 'thiago@irmaosnaobra.app',
    'tk-estranho': 'alguem@gmail.com',
  };
  h.estado = new Map();
  h.erroEstado = false; h.consultas = []; h.gravacoes = []; h.carimbos = new Map(); h.antesDeGravar = null;
  h.limitador = 0; h.bucketPublico = false; h.lerBucketFalha = false; h.leiturasDoBucket = 0;
  esquecerConferenciaDoBucket();
  h.bucketExiste = true; h.criarBucketFalha = false; h.assinarFalha = false;
  h.uploads = []; h.bucketsCriados = []; h.leitura = null; h.leituras = []; h.log.error = [];
  delete process.env.SOLAR_SOCIOS;
});

const get = (rota: string, auth = NILCE) => request(app).get(`/gerador/financeiro/${rota}`).set('Authorization', auth);
const post = (rota: string, corpo: unknown, auth = NILCE) =>
  request(app).post(`/gerador/financeiro/${rota}`).set('Authorization', auth).send(corpo as object);

const corpoEntrada = (extra: Record<string, unknown> = {}) => ({
  id: 'ent-00000001', tipo: 'entrada', categoria: 'sinal', valor_centavos: ENTRADA, data: '2026-10-01', ...extra,
});
const corpoSaida = (extra: Record<string, unknown> = {}) => ({
  id: 'sai-00000001', tipo: 'saida', categoria: 'equipamento', valor_centavos: GASTO, data: '2026-10-02',
  contraparte: 'Fornecedor Sigiloso', ...extra,
});
const lancar = (corpo: Record<string, unknown>, auth = NILCE, card = CARD) => post(`${card}/lancamento`, corpo, auth);
const linhasDoCard = (card = CARD) => [...h.estado.keys()].filter((k) => k.startsWith(`fin:${card}:`));
const gravado = (id: string, card = CARD) => h.estado.get(`fin:${card}:${id}`) as Record<string, any>;
const subir = (bytes: Buffer, media_type: string, extra: Record<string, unknown> = {}, auth = NILCE, card = CARD) =>
  post(`${card}/arquivo`, { base64: bytes.toString('base64'), media_type, nome: 'comprovante do cliente.png', ler: false, ...extra }, auth);

/** Um sócio lança uma entrada e uma saída no card, e a venda vale R$ 50.000,00. */
async function cardComEntradaESaida(): Promise<void> {
  h.estado.set(`pos_venda:${CARD}`, { modelo: 'chave_na_mao', valor: 50_000, etapa: 'papeis' });
  expect((await lancar(corpoEntrada(), THIAGO)).status).toBe(200);
  expect((await lancar(corpoSaida(), THIAGO)).status).toBe(200);
}

describe('login', () => {
  const rotas: Array<['get' | 'post', string]> = [
    ['get', 'resumo?ids=1,2'],
    ['get', `${CARD}`],
    ['post', `${CARD}/arquivo`],
    ['post', `${CARD}/lancamento`],
    ['post', `${CARD}/lancamento/ent-00000001/apagar`],
  ];
  it('401 sem token, com chave publishable e com token inválido, em TODAS as rotas', async () => {
    for (const [metodo, rota] of rotas) {
      const url = `/gerador/financeiro/${rota}`;
      const semToken = metodo === 'get' ? await request(app).get(url) : await request(app).post(url).send(corpoEntrada());
      expect(semToken.status, rota).toBe(401);
      expect(semToken.headers['cache-control'], rota).toBe('no-store');
      for (const auth of ['Bearer sb_publishable_abc', 'Bearer lixo']) {
        const res = metodo === 'get' ? await get(rota, auth) : await post(rota, corpoEntrada(), auth);
        expect(res.status, `${rota} ${auth}`).toBe(401);
      }
    }
    expect(h.consultas).toHaveLength(0);   // nada é lido antes do login
    expect(h.gravacoes).toHaveLength(0);
    expect(h.uploads).toHaveLength(0);
  });
  it('403 para conta que não é @irmaosnaobra.app', async () => {
    for (const [metodo, rota] of rotas) {
      const res = metodo === 'get' ? await get(rota, 'Bearer tk-estranho') : await post(rota, corpoEntrada(), 'Bearer tk-estranho');
      expect(res.status, rota).toBe(403);
    }
    expect(h.gravacoes).toHaveLength(0);
  });
  it('id de card que não é inteiro maior que zero: 400', async () => {
    for (const ruim of ['0', '-1', 'abc', '1.5', '1e3', '12abc']) {
      expect((await get(ruim)).status, ruim).toBe(400);
      expect((await get(ruim)).body).toEqual({ error: 'id inválido' });
      expect((await lancar(corpoEntrada(), NILCE, ruim as unknown as number)).status, ruim).toBe(400);
    }
  });
});

describe('GET /financeiro/:cardId', () => {
  it('sócio vê entrada, saída, resultado e margem', async () => {
    await cardComEntradaESaida();
    const res = await get(`${CARD}`, THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, socio: true, autor: 'thiago', valor_venda_centavos: 5_000_000 });
    expect(res.body.lancamentos.map((l: any) => l.id)).toEqual(['sai-00000001', 'ent-00000001']);   // data decrescente
    expect(res.body.totais).toEqual({
      recebido: ENTRADA, gasto: GASTO, resultado_caixa: ENTRADA - GASTO,
      a_receber: 5_000_000 - ENTRADA, recebido_a_mais: 0,
      resultado_previsto: 5_000_000 - GASTO, margem_prevista: 62.5,
      por_categoria: { entrada: { sinal: ENTRADA }, saida: { equipamento: GASTO } },
      qtd_entradas: 1, qtd_saidas: 1,
    });
    expect(res.body.catalogo.entrada[0]).toEqual({ slug: 'sinal', rotulo: 'Sinal' });
    expect(res.body.catalogo.saida).toHaveLength(10);
    expect(res.body.catalogo.formas).toHaveLength(7);
  });

  it('consultor NÃO vê saída: o corpo da resposta não contém o valor do gasto nem nada que saia dele', async () => {
    await cardComEntradaESaida();
    const res = await get(`${CARD}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, socio: false, autor: 'nilce', valor_venda_centavos: 5_000_000 });
    expect(res.body.lancamentos.map((l: any) => l.id)).toEqual(['ent-00000001']);
    expect(res.body.totais).toEqual({
      recebido: ENTRADA, gasto: null, resultado_caixa: null,
      a_receber: 5_000_000 - ENTRADA, recebido_a_mais: 0,
      resultado_previsto: null, margem_prevista: null,
      por_categoria: { entrada: { sinal: ENTRADA }, saida: null },
      qtd_entradas: 1, qtd_saidas: null,
    });
    for (const p of [GASTO, ENTRADA - GASTO, 5_000_000 - GASTO, '62.5', 'Fornecedor Sigiloso', 'sai-00000001', '"tipo":"saida"']) {
      expect(res.text).not.toContain(String(p));
    }
  });

  it('entrada que já foi saída: o consultor vê a entrada, mas nem o gasto do histórico nem o que a IA leu naquele tempo', async () => {
    const LIDO = 1_644_457;   // o que a IA leu quando o lançamento era saída
    // A consultora cria a entrada; o sócio a transforma em saída (lida por IA) e depois de volta em entrada.
    await lancar(corpoEntrada());
    const virouSaida = await lancar({
      id: 'ent-00000001', tipo: 'saida', categoria: 'equipamento', valor_centavos: GASTO, contraparte: 'Fornecedor Sigiloso',
      origem: 'ia', lido_pela_ia: { valor_centavos: LIDO, data: '2026-10-02', id_transacao: 'E2E-SAIDA-1' },
    }, THIAGO);
    expect(virouSaida.status).toBe(200);
    const voltou = await lancar({ id: 'ent-00000001', tipo: 'entrada', categoria: 'sinal', valor_centavos: 700_000, contraparte: 'Cliente de Teste' }, THIAGO);
    expect(voltou.status).toBe(200);
    // O sócio vê tudo, e tudo fica gravado.
    expect(voltou.body.lancamento.alteracoes[1].antes).toMatchObject({ tipo: 'saida', valor_centavos: GASTO });
    expect(voltou.body.lancamento.lido_pela_ia).toMatchObject({ valor_centavos: LIDO });
    expect(gravado('ent-00000001')).toMatchObject({ ja_foi_saida: true, lido_pela_ia: { valor_centavos: LIDO } });
    expect(gravado('ent-00000001').alteracoes).toHaveLength(2);

    // ("equipamento" existe no catálogo, que é público: procura-se só nos lançamentos)
    const semRastro = (res: { text: string; body: any }, lancs: unknown) => {
      for (const p of [GASTO, LIDO, 'Fornecedor Sigiloso', 'E2E-SAIDA-1', 'ja_foi_saida']) expect(res.text).not.toContain(String(p));
      for (const p of ['equipamento', '"tipo":"saida"']) expect(JSON.stringify(lancs)).not.toContain(p);
    };
    const lista = await get(`${CARD}`);
    expect(lista.body.lancamentos).toHaveLength(1);
    expect(lista.body.lancamentos[0]).toMatchObject({ tipo: 'entrada', valor_centavos: 700_000, alteracoes: [], lido_pela_ia: null });
    semRastro(lista, lista.body.lancamentos);

    // A autora edita e apaga a própria entrada: as respostas também não trazem o tempo de saída.
    const editou = await lancar({ id: 'ent-00000001', valor_centavos: 710_000 });
    expect(editou.status).toBe(200);
    expect(editou.body.lancamento.alteracoes).toEqual([expect.objectContaining({ por: 'nilce', antes: { valor_centavos: 700_000 } })]);
    expect(editou.body.lancamento.lido_pela_ia).toBeNull();
    semRastro(editou, editou.body.lancamento);
    expect(gravado('ent-00000001').lido_pela_ia).toMatchObject({ valor_centavos: LIDO });   // a máscara é só da resposta
    const apagou = await post(`${CARD}/lancamento/ent-00000001/apagar`, { motivo: 'conferido e errado' });
    expect(apagou.status).toBe(200);
    expect(apagou.body.lancamento).toMatchObject({ apagado: true, lido_pela_ia: null });
    expect(apagou.body.lancamento.alteracoes).toHaveLength(1);
    semRastro(apagou, apagou.body.lancamento);
    const depois = await get(`${CARD}`);
    expect(depois.body.lancamentos[0]).toMatchObject({ apagado: true, lido_pela_ia: null });
    semRastro(depois, depois.body.lancamentos);
    // O sócio continua vendo o histórico inteiro.
    const socio = await get(`${CARD}`, THIAGO);
    expect(socio.body.lancamentos[0].alteracoes).toHaveLength(3);
    expect(socio.body.lancamentos[0].lido_pela_ia).toMatchObject({ valor_centavos: LIDO });
  });

  it('SOLAR_SOCIOS troca quem é sócio', async () => {
    await cardComEntradaESaida();
    process.env.SOLAR_SOCIOS = 'nilce';
    expect((await get(`${CARD}`)).body.totais.gasto).toBe(GASTO);
    expect((await get(`${CARD}`, THIAGO)).body.totais.gasto).toBeNull();
  });

  it('card sem nada: totais zerados e venda null', async () => {
    const res = await get('999', THIAGO);
    expect(res.body).toMatchObject({ ok: true, valor_venda_centavos: null, lancamentos: [] });
    expect(res.body.totais).toMatchObject({ recebido: 0, gasto: 0, a_receber: null, resultado_previsto: null, margem_prevista: null });
  });

  it('o card 50 não enxerga o card 501', async () => {
    await cardComEntradaESaida();
    const res = await get('50', THIAGO);
    expect(res.body.lancamentos).toEqual([]);
    expect(h.consultas[h.consultas.length - 1].padrao).toBe('fin:50:%');
  });

  it('arquivo ganha url assinada de 1 hora; se assinar falhar, url null; a url não vai para o banco', async () => {
    const up = await subir(PNG, 'image/png');
    await lancar(corpoEntrada({ arquivo: up.body.arquivo }));
    const res = await get(`${CARD}`);
    const arq = res.body.lancamentos[0].arquivo;
    expect(arq.url).toBe(`https://assinado.test/${arq.path}?exp=3600`);
    expect(Object.keys(gravado('ent-00000001').arquivo).sort()).toEqual(['nome', 'path', 'sha256', 'tamanho', 'tipo']);
    h.assinarFalha = true;
    expect((await get(`${CARD}`)).body.lancamentos[0].arquivo).toMatchObject({ path: arq.path, url: null });
  });

  it('mais de 1000 lançamentos: pagina até o fim e soma exato', async () => {
    for (let i = 0; i < 2300; i++) {
      const id = `massa-${String(i).padStart(6, '0')}`;
      h.estado.set(`fin:${CARD}:${id}`, {
        id, card_id: CARD, tipo: 'entrada', categoria: 'parcela', valor_centavos: 1, data: '2026-09-01',
        criado_por: 'thiago', criado_em: '2026-09-01T12:00:00.000Z', apagado: false,
      });
    }
    h.consultas = [];
    const res = await get(`${CARD}`, THIAGO);
    expect(res.body.totais.recebido).toBe(2300);
    expect(res.body.lancamentos).toHaveLength(2300);
    expect(h.consultas.map((c) => [c.de, c.ate])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(h.consultas.every((c) => c.ordenado)).toBe(true);
  });

  it('erro de banco: 500 { error: "falha" }, e a mensagem real só no log', async () => {
    h.erroEstado = true;
    const res = await get(`${CARD}`, THIAGO);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'falha' });
    expect(res.text).not.toContain('boom');
    expect(JSON.stringify(h.log.error)).toContain('boom do banco');
  });
});

describe('POST /financeiro/:cardId/lancamento', () => {
  it('consultor cria entrada; o autor gravado é o do token, mesmo com outro nome no corpo', async () => {
    const res = await lancar(corpoEntrada({ criado_por: 'thiago', autor: 'thiago', por: 'thiago', card_id: 9 }));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.lancamento).toMatchObject({ id: 'ent-00000001', card_id: CARD, criado_por: 'nilce', tipo: 'entrada', valor_centavos: ENTRADA });
    expect(gravado('ent-00000001')).toMatchObject({ criado_por: 'nilce', card_id: CARD });
    expect(res.body.totais).toMatchObject({ recebido: ENTRADA, gasto: null, qtd_saidas: null });
    expect(res.body.valor_venda_centavos).toBeNull();     // o card não tem valor de venda registrado
    expect(h.gravacoes).toHaveLength(1);
    expect(h.gravacoes[0].op).toBe('insert');               // criar é INSERT, nunca upsert
    expect(Object.keys(h.gravacoes[0].linha).sort()).toEqual(['key', 'updated_at', 'value']);
    expect(h.gravacoes[0].linha.key).toBe(`fin:${CARD}:ent-00000001`);
    expect(String(h.gravacoes[0].linha.updated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('consultor recebe 403 ao criar saída, e nada é gravado', async () => {
    const res = await lancar(corpoSaida());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'so_socio' });
    expect(linhasDoCard()).toEqual([]);
  });

  it('consultor não edita saída que existe, nem transforma entrada em saída', async () => {
    await cardComEntradaESaida();
    const antes = JSON.stringify(gravado('sai-00000001'));
    // Tenta "consertar" a saída mandando como entrada: 403, e o corpo não devolve nada dela.
    const a = await lancar({ id: 'sai-00000001', tipo: 'entrada', categoria: 'sinal', valor_centavos: 1, data: '2026-10-02' });
    expect(a.status).toBe(403);
    expect(a.body).toEqual({ error: 'so_socio' });
    expect(a.text).not.toContain(String(GASTO));
    expect(JSON.stringify(gravado('sai-00000001'))).toBe(antes);
    const b = await lancar({ id: 'ent-00000001', tipo: 'saida', categoria: 'frete' });
    expect(b.status).toBe(403);
    expect(b.body).toEqual({ error: 'so_socio' });          // virar saída é assunto de sócio, antes de ser assunto de autor
    expect(gravado('ent-00000001').tipo).toBe('entrada');
  });

  it('sócio cria saída e recebe os totais completos', async () => {
    const res = await lancar(corpoSaida(), THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.totais).toMatchObject({ gasto: GASTO, resultado_caixa: -GASTO, qtd_saidas: 1 });
    expect(gravado('sai-00000001').criado_por).toBe('thiago');
  });

  it('mesmo id duas vezes vira UMA linha, sem alteração', async () => {
    const a = await lancar(corpoEntrada());
    const b = await lancar(corpoEntrada());
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(linhasDoCard()).toEqual([`fin:${CARD}:ent-00000001`]);
    expect(h.gravacoes).toHaveLength(1);                 // a segunda nem grava
    expect(b.body.lancamento.alteracoes).toEqual([]);
    expect(b.body.lancamento.criado_em).toBe(a.body.lancamento.criado_em);
    expect(b.body.totais.recebido).toBe(ENTRADA);        // não somou duas vezes
  });

  it('editar guarda o valor antigo e quem mudou', async () => {
    await lancar(corpoEntrada());
    const res = await lancar({ id: 'ent-00000001', valor_centavos: 1_200_000, confirmar_duplicado: true }, THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.lancamento).toMatchObject({ valor_centavos: 1_200_000, criado_por: 'nilce' });
    expect(res.body.lancamento.alteracoes).toHaveLength(1);
    expect(res.body.lancamento.alteracoes[0]).toMatchObject({ por: 'thiago', antes: { valor_centavos: ENTRADA } });
    expect(linhasDoCard()).toHaveLength(1);
    expect(h.gravacoes.map((g) => g.op)).toEqual(['insert', 'update']);   // editar é UPDATE com trava
  });

  it('quem não é sócio só edita a entrada que ELE criou: a de outro dá 403 so_autor', async () => {
    await lancar(corpoEntrada({ id: 'ent-da-giovanna' }), GIOVANNA);
    const antes = JSON.stringify(gravado('ent-da-giovanna'));
    const deOutro = await lancar({ id: 'ent-da-giovanna', valor_centavos: 5 });      // nilce tentando
    expect(deOutro.status).toBe(403);
    expect(deOutro.body).toEqual({ error: 'so_autor' });
    // Nem mandando o corpo inteiro, nem dizendo no corpo que foi ela quem criou.
    const forcando = await lancar(corpoEntrada({ id: 'ent-da-giovanna', valor_centavos: 5, criado_por: 'nilce', confirmar_duplicado: true }));
    expect(forcando.status).toBe(403);
    expect(forcando.body).toEqual({ error: 'so_autor' });
    expect(JSON.stringify(gravado('ent-da-giovanna'))).toBe(antes);
    expect(h.gravacoes).toHaveLength(1);
    // A própria autora edita; o sócio edita qualquer uma.
    expect((await lancar({ id: 'ent-da-giovanna', descricao: 'Sinal conferido' }, GIOVANNA)).status).toBe(200);
    expect((await lancar({ id: 'ent-da-giovanna', contraparte: 'Cliente de Teste' }, THIAGO)).status).toBe(200);
    expect(gravado('ent-da-giovanna')).toMatchObject({ criado_por: 'giovanna', descricao: 'Sinal conferido', contraparte: 'Cliente de Teste' });
  });

  it('a resposta traz o valor da venda de agora, igual ao GET', async () => {
    h.estado.set(`pos_venda:${CARD}`, { modelo: 'chave_na_mao', valor: 50_000 });
    const criou = await lancar(corpoEntrada());
    expect(criou.body).toMatchObject({ ok: true, valor_venda_centavos: 5_000_000 });
    expect(criou.body.totais.a_receber).toBe(5_000_000 - ENTRADA);
    h.estado.set(`pos_venda:${CARD}`, { modelo: 'chave_na_mao', valor: 60_000.5 });   // mudou no meio
    const repetiu = await lancar(corpoEntrada());                                         // o caminho que não grava
    expect(repetiu.body.valor_venda_centavos).toBe(6_000_050);
    const editou = await lancar({ id: 'ent-00000001', forma: 'pix' });
    expect(editou.body.valor_venda_centavos).toBe(6_000_050);
    expect((await get(`${CARD}`)).body.valor_venda_centavos).toBe(6_000_050);
    expect(Object.keys(editou.body).sort()).toEqual(['lancamento', 'ok', 'totais', 'valor_venda_centavos']);
  });

  it('409 de possível duplicado, sem gravar; depois passa com confirmar_duplicado', async () => {
    await lancar(corpoEntrada());
    const repetido = corpoEntrada({ id: 'ent-00000002', categoria: 'parcela' });   // mesmo tipo, valor e data
    const a = await lancar(repetido);
    expect(a.status).toBe(409);
    expect(a.body).toEqual({
      error: 'possivel_duplicado',
      duplicados: [{ id: 'ent-00000001', tipo: 'entrada', valor_centavos: ENTRADA, data: '2026-10-01', categoria: 'sinal', motivo: 'mesmo_valor_e_data' }],
    });
    expect(linhasDoCard()).toHaveLength(1);
    const b = await lancar({ ...repetido, confirmar_duplicado: true });
    expect(b.status).toBe(200);
    expect(linhasDoCard()).toHaveLength(2);
    expect(b.body.totais.recebido).toBe(2 * ENTRADA);
    expect('confirmar_duplicado' in gravado('ent-00000002')).toBe(false);
    // "true" em texto não confirma nada.
    const c = await lancar({ ...repetido, id: 'ent-00000003', confirmar_duplicado: 'true' });
    expect(c.status).toBe(409);
  });

  it('duplicado por transação e por arquivo', async () => {
    const up = await subir(PNG, 'image/png');
    await lancar(corpoEntrada({ id_transacao: 'E2E-TESTE-1', arquivo: up.body.arquivo }));
    const porTransacao = await lancar(corpoEntrada({ id: 'ent-00000002', valor_centavos: 5, data: '2026-09-09', id_transacao: 'E2E-TESTE-1' }));
    expect(porTransacao.status).toBe(409);
    expect(porTransacao.body.duplicados[0].motivo).toBe('mesma_transacao');
    const porArquivo = await lancar(corpoEntrada({ id: 'ent-00000003', valor_centavos: 6, data: '2026-09-08', arquivo: up.body.arquivo }));
    expect(porArquivo.status).toBe(409);
    expect(porArquivo.body.duplicados[0].motivo).toBe('mesmo_arquivo');
  });

  it('consultor não fica sabendo de uma SAÍDA pelo aviso de duplicado', async () => {
    await lancar(corpoSaida({ id_transacao: 'E2E-TESTE-9' }), THIAGO);
    // Mesma transação de uma saída: para o consultor ela não existe, então não há 409.
    const res = await lancar(corpoEntrada({ id_transacao: 'E2E-TESTE-9' }));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(String(GASTO));
    // O sócio, no mesmo caso, é avisado e vê a saída.
    const socio = await lancar(corpoEntrada({ id: 'ent-00000009', data: '2026-09-15', id_transacao: 'E2E-TESTE-9' }), THIAGO);
    expect(socio.status).toBe(409);
    expect(socio.body.duplicados.map((d: any) => d.tipo).sort()).toEqual(['entrada', 'saida']);
  });

  it('arquivo.path de outro card é recusado', async () => {
    const up = await subir(PNG, 'image/png', {}, NILCE, 777);
    expect(up.body.arquivo.path.startsWith('fin/777/')).toBe(true);
    const res = await lancar(corpoEntrada({ arquivo: up.body.arquivo }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'arquivo_de_outro_card' });
    expect(linhasDoCard()).toEqual([]);
  });

  it('validação devolve 400 com o código', async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [corpoEntrada({ id: 'curto' }), 'id_invalido'],
      [corpoEntrada({ tipo: 'receita' }), 'tipo_invalido'],
      [corpoEntrada({ categoria: 'frete' }), 'categoria_invalida'],
      [corpoEntrada({ valor_centavos: 14500.5 }), 'valor_invalido'],
      [corpoEntrada({ valor_centavos: '1000' }), 'valor_invalido'],
      [corpoEntrada({ data: '2026-02-30' }), 'data_invalida'],
      [corpoEntrada({ forma: 'cheque' }), 'forma_invalida'],
      [corpoEntrada({ categoria: 'outros' }), 'descricao_obrigatoria'],
      [corpoEntrada({ descricao: 5 }), 'texto_invalido'],
      [corpoEntrada({ arquivo: 'x' }), 'arquivo_invalido'],
    ];
    for (const [corpo, erro] of casos) {
      const res = await lancar(corpo);
      expect(res.status, erro).toBe(400);
      expect(res.body, erro).toEqual({ error: erro });
    }
    expect((await request(app).post(`/gerador/financeiro/${CARD}/lancamento`).set('Authorization', NILCE).send([1] as unknown as object)).body)
      .toEqual({ error: 'corpo_invalido' });
    expect(linhasDoCard()).toEqual([]);
  });

  it('nada é escrito fora do system_state (nem em agendamentos)', async () => {
    // O mock de `from` lança para qualquer outra tabela: se a rota tocasse em
    // `agendamentos`, estes pedidos responderiam 500.
    await cardComEntradaESaida();
    expect((await get(`${CARD}`, THIAGO)).status).toBe(200);
    expect(h.gravacoes).toHaveLength(2);
    expect(h.gravacoes.every((g) => g.chave.startsWith(`fin:${CARD}:`))).toBe(true);
  });
});

describe('gravação com trava: ler, conferir e gravar não é atômico', () => {
  const CHAVE = `fin:${CARD}:ent-00000001`;
  const apagar = (id: string, motivo: unknown, auth = NILCE) => post(`${CARD}/lancamento/${id}/apagar`, { motivo }, auth);
  /** Outra requisição grava a mesma linha DEPOIS da leitura desta e ANTES da gravação dela. */
  const outraGravaNoMeio = (mudar: (v: Record<string, any>) => Record<string, any>) => {
    h.antesDeGravar = () => {
      h.estado.set(CHAVE, mudar(JSON.parse(JSON.stringify(h.estado.get(CHAVE)))));
      h.carimbos.set(CHAVE, new Date(Date.parse(h.carimbos.get(CHAVE)!) + 5).toISOString());
    };
  };

  it('edição com updated_at velho: 409 "mudou", sem duplicados, e a linha não é alterada', async () => {
    await lancar(corpoEntrada());
    outraGravaNoMeio((v) => ({ ...v, descricao: 'gravado pela outra requisição' }));
    const res = await lancar({ id: 'ent-00000001', valor_centavos: 5 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'mudou' });          // NUNCA traz `duplicados`: a tela distingue os dois 409 por isso
    expect('duplicados' in res.body).toBe(false);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(gravado('ent-00000001')).toMatchObject({ valor_centavos: ENTRADA, descricao: 'gravado pela outra requisição', alteracoes: [] });
    expect(h.gravacoes.map((g) => g.op)).toEqual(['insert']);
    // Pedindo de novo (agora lendo a linha nova), passa, e não perde o que a outra gravou.
    const denovo = await lancar({ id: 'ent-00000001', valor_centavos: 5 });
    expect(denovo.status).toBe(200);
    expect(gravado('ent-00000001')).toMatchObject({ valor_centavos: 5, descricao: 'gravado pela outra requisição' });
  });

  it('o outro 409 continua com duplicados', async () => {
    await lancar(corpoEntrada());
    const res = await lancar(corpoEntrada({ id: 'ent-00000002' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('possivel_duplicado');
    expect(res.body.duplicados).toHaveLength(1);
  });

  it('apagar entre a leitura e a gravação de uma edição NÃO é desfeito', async () => {
    await lancar(corpoEntrada());
    outraGravaNoMeio((v) => ({ ...v, apagado: true, apagado_por: 'thiago', apagado_em: '2026-10-11T12:00:00.000Z', motivo_apagado: 'lançado em dobro' }));
    const res = await lancar({ id: 'ent-00000001', valor_centavos: 5 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'mudou' });
    expect(gravado('ent-00000001')).toMatchObject({ apagado: true, apagado_por: 'thiago', valor_centavos: ENTRADA });
    // Na nova tentativa a edição encontra o apagado e é recusada.
    expect((await lancar({ id: 'ent-00000001', valor_centavos: 5 })).body).toEqual({ error: 'apagado' });
    expect((await get(`${CARD}`, THIAGO)).body.totais.recebido).toBe(0);
  });

  it('edição entre a leitura e a gravação de um apagar: 409 "mudou", e a edição fica', async () => {
    await lancar(corpoEntrada());
    outraGravaNoMeio((v) => ({ ...v, valor_centavos: 1_234_567 }));
    const res = await apagar('ent-00000001', 'lançado em dobro');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'mudou' });
    expect(gravado('ent-00000001')).toMatchObject({ apagado: false, valor_centavos: 1_234_567 });
    expect((await apagar('ent-00000001', 'lançado em dobro')).status).toBe(200);
    expect(gravado('ent-00000001')).toMatchObject({ apagado: true, valor_centavos: 1_234_567 });
  });

  it('duas criações simultâneas do mesmo id viram UMA linha', async () => {
    const [a, b] = await Promise.all([lancar(corpoEntrada()), lancar(corpoEntrada())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(linhasDoCard()).toEqual([CHAVE]);
    expect(h.gravacoes.map((g) => g.op)).toEqual(['insert']);
    expect(gravado('ent-00000001').alteracoes).toEqual([]);
    expect((await get(`${CARD}`)).body.totais.recebido).toBe(ENTRADA);   // não somou duas vezes
  });

  it('criação que perde a corrida para a MESMA criação: devolve o que existe, sem gravar', async () => {
    const pronta = { ...corpoEntrada(), card_id: CARD, criado_por: 'nilce', criado_em: '2026-10-11T12:00:00.000Z', apagado: false, alteracoes: [] };
    h.antesDeGravar = () => { h.estado.set(CHAVE, pronta); h.carimbos.set(CHAVE, '2026-10-11T12:00:00.000Z'); };
    const res = await lancar(corpoEntrada());
    expect(res.status).toBe(200);
    expect(res.body.lancamento).toMatchObject({ criado_em: '2026-10-11T12:00:00.000Z', alteracoes: [] });   // é a da outra
    expect(h.gravacoes).toHaveLength(0);                    // o INSERT bateu no 23505 e ninguém sobrescreveu
    expect(linhasDoCard()).toEqual([CHAVE]);
  });

  it('criação que perde a corrida para conteúdo DIFERENTE segue como edição (com a trava e com as regras de quem pode)', async () => {
    const daOutra = (por: string) => ({ ...corpoEntrada({ valor_centavos: 42 }), card_id: CARD, criado_por: por, criado_em: '2026-10-11T12:00:00.000Z', apagado: false, alteracoes: [] });
    // A outra era da própria pessoa (dois aparelhos): vira edição, com o valor antigo guardado.
    h.antesDeGravar = () => { h.estado.set(CHAVE, daOutra('nilce')); h.carimbos.set(CHAVE, '2026-10-11T12:00:00.000Z'); };
    const res = await lancar(corpoEntrada());
    expect(res.status).toBe(200);
    expect(h.gravacoes.map((g) => g.op)).toEqual(['update']);
    expect(gravado('ent-00000001')).toMatchObject({ valor_centavos: ENTRADA, criado_em: '2026-10-11T12:00:00.000Z' });
    expect(gravado('ent-00000001').alteracoes).toEqual([expect.objectContaining({ por: 'nilce', antes: { valor_centavos: 42 } })]);
    expect(linhasDoCard()).toEqual([CHAVE]);

    // A outra era de outra consultora: a segunda volta cai na regra do autor.
    h.estado.delete(CHAVE); h.carimbos.delete(CHAVE); h.gravacoes = [];
    h.antesDeGravar = () => { h.estado.set(CHAVE, daOutra('giovanna')); h.carimbos.set(CHAVE, '2026-10-11T12:00:00.000Z'); };
    const alheia = await lancar(corpoEntrada());
    expect(alheia.status).toBe(403);
    expect(alheia.body).toEqual({ error: 'so_autor' });
    expect(gravado('ent-00000001')).toMatchObject({ valor_centavos: 42, criado_por: 'giovanna' });
    expect(h.gravacoes).toHaveLength(0);
  });

  it('toda gravação leva um updated_at novo, distinto do lido, em ISO com milissegundos', async () => {
    await lancar(corpoEntrada());
    // Relógio do servidor atrás do carimbo gravado (outra instância adiantada): ainda assim sai diferente.
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    h.carimbos.set(CHAVE, futuro);
    expect((await lancar({ id: 'ent-00000001', forma: 'pix' })).status).toBe(200);
    const depois = h.carimbos.get(CHAVE)!;
    expect(depois).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(depois)).toBe(Date.parse(futuro) + 1);
    // No caso normal o carimbo anda para a frente a cada gravação.
    const antes = h.carimbos.get(CHAVE)!;
    expect((await apagar('ent-00000001', 'lançado em dobro')).status).toBe(200);
    expect(Date.parse(h.carimbos.get(CHAVE)!)).toBeGreaterThan(Date.parse(antes));
  });
});

describe('POST /financeiro/:cardId/lancamento/:id/apagar', () => {
  const apagar = (id: string, motivo: unknown, auth = NILCE) => post(`${CARD}/lancamento/${id}/apagar`, { motivo }, auth);

  it('apagar tira do total e mantém a linha', async () => {
    await cardComEntradaESaida();
    const res = await apagar('ent-00000001', 'lançado em dobro', THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.lancamento).toMatchObject({ apagado: true, apagado_por: 'thiago', motivo_apagado: 'lançado em dobro' });
    expect(res.body.totais).toMatchObject({ recebido: 0, gasto: GASTO, qtd_entradas: 0 });
    expect(res.body.valor_venda_centavos).toBe(5_000_000);   // o mesmo número do GET
    expect(Object.keys(res.body).sort()).toEqual(['lancamento', 'ok', 'totais', 'valor_venda_centavos']);
    expect(linhasDoCard()).toHaveLength(2);
    expect(gravado('ent-00000001')).toMatchObject({ apagado: true, valor_centavos: ENTRADA });
    const lista = await get(`${CARD}`, THIAGO);
    expect(lista.body.lancamentos.find((l: any) => l.id === 'ent-00000001').apagado).toBe(true);   // vem junto
    expect(lista.body.totais.recebido).toBe(0);
  });

  it('apagar de novo não troca quem apagou; editar o apagado é recusado', async () => {
    await lancar(corpoEntrada());
    await apagar('ent-00000001', 'lançado em dobro');
    const n = h.gravacoes.length;
    const de_novo = await apagar('ent-00000001', '', THIAGO);
    expect(de_novo.status).toBe(200);
    expect(de_novo.body.lancamento.apagado_por).toBe('nilce');
    expect(h.gravacoes).toHaveLength(n);
    const editar = await lancar(corpoEntrada({ valor_centavos: 5 }));
    expect(editar.status).toBe(400);
    expect(editar.body).toEqual({ error: 'apagado' });
  });

  it('consultor apaga a própria entrada, e recebe 403 na de outro e em saída', async () => {
    await lancar(corpoEntrada({ id: 'ent-da-nilce' }), NILCE);
    await lancar(corpoEntrada({ id: 'ent-da-giovanna', data: '2026-09-20' }), GIOVANNA);
    await lancar(corpoSaida(), THIAGO);

    const deOutro = await apagar('ent-da-giovanna', 'não é minha', NILCE);
    expect(deOutro.status).toBe(403);
    expect(deOutro.body).toEqual({ error: 'so_autor' });
    expect(gravado('ent-da-giovanna').apagado).toBe(false);

    const saida = await apagar('sai-00000001', 'quero apagar', NILCE);
    expect(saida.status).toBe(403);
    expect(saida.body).toEqual({ error: 'so_socio' });      // `so_socio` fica só para o que envolve saída
    expect(saida.text).not.toContain(String(GASTO));
    expect(gravado('sai-00000001').apagado).toBe(false);

    const propria = await apagar('ent-da-nilce', 'digitei errado', NILCE);
    expect(propria.status).toBe(200);
    expect(propria.body.totais).toMatchObject({ gasto: null, qtd_saidas: null });
    expect(propria.text).not.toContain(String(GASTO));
    expect(gravado('ent-da-nilce')).toMatchObject({ apagado: true, apagado_por: 'nilce' });

    // O sócio apaga qualquer um.
    expect((await apagar('ent-da-giovanna', 'conferido e errado', THIAGO)).status).toBe(200);
  });

  it('motivo é obrigatório', async () => {
    await lancar(corpoEntrada());
    for (const motivo of [undefined, '', 'ab', 5]) {
      const res = await apagar('ent-00000001', motivo);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'motivo_obrigatorio' });
    }
    expect(gravado('ent-00000001').apagado).toBe(false);
  });

  it('id inexistente: 404; lançamento de outro card também', async () => {
    await lancar(corpoEntrada());
    expect((await apagar('nao-existe-0001', 'motivo qualquer', THIAGO)).status).toBe(404);
    expect((await apagar('x', 'motivo qualquer', THIAGO)).status).toBe(404);
    const outroCard = await post('502/lancamento/ent-00000001/apagar', { motivo: 'motivo qualquer' }, THIAGO);
    expect(outroCard.status).toBe(404);
    expect(gravado('ent-00000001').apagado).toBe(false);
  });
});

describe('POST /financeiro/:cardId/arquivo', () => {
  it('sobe imagem e PDF no bucket privado, com caminho do card e sem o nome do usuário', async () => {
    const casos: Array<[Buffer, string, string]> = [[PNG, 'image/png', 'png'], [JPG, 'image/jpeg', 'jpg'], [WEBP, 'image/webp', 'webp'], [PDF, 'application/pdf', 'pdf']];
    for (const [bytes, tipo, ext] of casos) {
      const res = await subir(bytes, tipo);
      expect(res.status, tipo).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ ok: true, leitura: 'pulada', sugestao: null, duplicados: [] });
      const a = res.body.arquivo;
      expect(a.path).toMatch(new RegExp(`^fin/${CARD}/${HOJE.slice(0, 7).replace('-', '')}/[0-9a-f-]{36}\\.${ext}$`));
      expect(a).toMatchObject({ nome: 'comprovante do cliente.png', tipo, tamanho: bytes.length });
      expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(a.url).toBe(`https://assinado.test/${a.path}?exp=3600`);
      expect('bytes' in a).toBe(false);
    }
    expect(h.uploads).toHaveLength(4);
    expect(h.uploads[0]).toMatchObject({ bucket: 'financeiro-clientes', bytes: PNG.length, opcoes: { contentType: 'image/png', upsert: false } });
    expect(h.uploads.some((u) => u.path.includes('comprovante'))).toBe(false);
    expect(h.leituras).toHaveLength(0);
  });

  it('image/jpg é aceito como image/jpeg, e data URL também', async () => {
    const res = await post(`${CARD}/arquivo`, { base64: `data:image/jpg;base64,${JPG.toString('base64')}`, media_type: 'image/jpg', ler: false });
    expect(res.status).toBe(200);
    expect(res.body.arquivo).toMatchObject({ tipo: 'image/jpeg', tamanho: JPG.length, nome: 'comprovante.jpg' });
  });

  it('tipo errado, HEIC, assinatura que não bate, base64 ruim e arquivo grande: 400 com o código, sem subir nada', async () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ base64: PNG.toString('base64'), media_type: 'image/gif' }, 'tipo_nao_aceito'],
      [{ base64: PNG.toString('base64'), media_type: 'text/html' }, 'tipo_nao_aceito'],
      [{ base64: PNG.toString('base64'), media_type: 'application/x-msdownload' }, 'tipo_nao_aceito'],
      [{ base64: PNG.toString('base64'), media_type: 'image/heic' }, 'heic_nao_suportado'],
      [{ base64: PNG.toString('base64'), media_type: 'IMAGE/HEIF' }, 'heic_nao_suportado'],
      [{ base64: PNG.toString('base64'), media_type: 'application/pdf' }, 'arquivo_invalido'],     // PNG dizendo que é PDF
      [{ base64: PDF.toString('base64'), media_type: 'image/png' }, 'arquivo_invalido'],
      [{ base64: Buffer.from('MZ\x90\x00 executavel').toString('base64'), media_type: 'image/jpeg' }, 'arquivo_invalido'],
      [{ base64: Buffer.from('RIFF1234WAVEfmt ').toString('base64'), media_type: 'image/webp' }, 'arquivo_invalido'],
      [{ base64: '@@@ isto não é base64 @@@', media_type: 'image/png' }, 'arquivo_invalido'],
      [{ base64: grande.toString('base64'), media_type: 'image/png' }, 'arquivo_grande'],
      [{ base64: 'A'.repeat(6 * 1024 * 1024), media_type: 'image/png' }, 'arquivo_grande'],
    ];
    for (const [corpo, erro] of casos) {
      const res = await post(`${CARD}/arquivo`, { nome: 'x.png', ler: true, ...corpo });
      expect(res.status, `${erro} ${corpo.media_type}`).toBe(400);
      expect(res.body, erro).toEqual({ error: erro });
    }
    for (const corpo of [{}, { base64: '', media_type: 'image/png' }, { base64: 5, media_type: 'image/png' }, { base64: 'AAAA' }, { base64: 'AAAA', media_type: 'image/png', nome: 5 }]) {
      const res = await post(`${CARD}/arquivo`, corpo);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'corpo_invalido' });
    }
    expect(h.uploads).toHaveLength(0);
    expect(h.leituras).toHaveLength(0);    // arquivo recusado não gasta IA
  });

  it('o limite é do arquivo cru: exatamente 3 MB passa', async () => {
    const noLimite = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024 - PNG.length)]);
    const res = await subir(noLimite, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.arquivo.tamanho).toBe(3 * 1024 * 1024);
  });

  it('ler: true devolve a sugestão simulada, em centavos, lida dos bytes que acabaram de subir', async () => {
    h.leitura = () => ({
      ok: true,
      eh_comprovante: true,
      sugestao: {
        valor_centavos: 123456, data: '2026-10-09', pagador: 'Cliente de Teste', recebedor: 'Empresa de Teste',
        forma: 'pix', id_transacao: 'E2E-TESTE-1', descricao: 'Sinal do contrato', confianca: 'alta',
      },
    });
    const res = await subir(PDF, 'application/pdf', { ler: true });
    expect(res.status).toBe(200);
    expect(res.body.leitura).toBe('ok');
    expect(res.body.sugestao).toMatchObject({ valor_centavos: 123456, data: '2026-10-09', pagador: 'Cliente de Teste', forma: 'pix', confianca: 'alta' });
    expect(h.leituras).toEqual([{ bytes: PDF.length, media_type: 'application/pdf', hojeBr: HOJE }]);
    expect(h.uploads).toHaveLength(1);
  });

  it('não é comprovante: 200, leitura "nao_e_comprovante" e sem sugestão', async () => {
    h.leitura = () => ({ ok: true, eh_comprovante: false, sugestao: { valor_centavos: null, confianca: 'baixa' } });
    const res = await subir(PNG, 'image/png', { ler: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, leitura: 'nao_e_comprovante', sugestao: null });
  });

  it('leitura que falha (ou que lança) NÃO derruba o upload: 200 com leitura "falhou"', async () => {
    h.leitura = () => ({ ok: false, motivo: 'falhou' });
    const a = await subir(PNG, 'image/png', { ler: true });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, leitura: 'falhou', sugestao: null });
    expect(a.body.arquivo.path).toMatch(/^fin\/501\//);
    h.leitura = () => { throw new Error('IA fora do ar'); };
    const b = await subir(PNG, 'image/png', { ler: true });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ ok: true, leitura: 'falhou', sugestao: null });
    expect(h.uploads).toHaveLength(2);
  });

  it('ler só vale com true de verdade', async () => {
    h.leitura = () => ({ ok: false, motivo: 'falhou' });
    for (const ler of ['true', 1, undefined, null]) {
      expect((await subir(PNG, 'image/png', { ler })).body.leitura).toBe('pulada');
    }
    expect(h.leituras).toHaveLength(0);
  });

  it('avisa quando o mesmo arquivo já está num lançamento vivo do card', async () => {
    const up = await subir(PNG, 'image/png');
    await lancar(corpoEntrada({ arquivo: up.body.arquivo }));
    const de_novo = await subir(PNG, 'image/png');
    expect(de_novo.body.duplicados).toEqual([
      { id: 'ent-00000001', tipo: 'entrada', valor_centavos: ENTRADA, data: '2026-10-01', categoria: 'sinal', motivo: 'mesmo_arquivo' },
    ]);
    expect((await subir(JPG, 'image/jpeg')).body.duplicados).toEqual([]);
    // Apagado deixa de ser duplicado.
    await post(`${CARD}/lancamento/ent-00000001/apagar`, { motivo: 'lançado errado' });
    expect((await subir(PNG, 'image/png')).body.duplicados).toEqual([]);
  });

  it('o mesmo arquivo numa SAÍDA não aparece para o consultor, só para o sócio', async () => {
    const up = await subir(PNG, 'image/png', {}, THIAGO);
    await lancar(corpoSaida({ arquivo: up.body.arquivo }), THIAGO);
    const consultor = await subir(PNG, 'image/png');
    expect(consultor.status).toBe(200);
    expect(consultor.body.duplicados).toEqual([]);
    expect(consultor.text).not.toContain(String(GASTO));
    const socio = await subir(PNG, 'image/png', {}, THIAGO);
    expect(socio.body.duplicados).toMatchObject([{ id: 'sai-00000001', tipo: 'saida', valor_centavos: GASTO, motivo: 'mesmo_arquivo' }]);
  });

  it('sem token: 401 sem tocar no limitador de IA; ler false não gasta o limite, ler true gasta', async () => {
    const semToken = await request(app).post(`/gerador/financeiro/${CARD}/arquivo`)
      .send({ base64: PNG.toString('base64'), media_type: 'image/png', ler: true });
    expect(semToken.status).toBe(401);
    expect((await subir(PNG, 'image/png', { ler: true }, 'Bearer lixo')).status).toBe(401);
    expect((await subir(PNG, 'image/png', { ler: true }, 'Bearer tk-estranho')).status).toBe(403);
    expect(h.limitador).toBe(0);
    expect(h.uploads).toHaveLength(0);

    h.leitura = () => ({ ok: false, motivo: 'falhou' });
    for (const ler of [false, undefined, 'true', 1]) expect((await subir(PNG, 'image/png', { ler })).status).toBe(200);
    expect(h.limitador).toBe(0);                           // subir sem leitura não conta
    expect(h.uploads).toHaveLength(4);
    expect((await subir(PNG, 'image/png', { ler: true })).status).toBe(200);
    expect(h.limitador).toBe(1);
    expect(h.leituras).toHaveLength(1);
  });

  it('bucket PÚBLICO: falha fechada, 503, nada sobe, a IA não é chamada e o log avisa', async () => {
    h.bucketPublico = true;
    const res = await subir(PNG, 'image/png', { ler: true });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'bucket_indisponivel' });
    expect(h.uploads).toHaveLength(0);
    expect(h.bucketsCriados).toHaveLength(0);
    expect(h.leituras).toHaveLength(0);
    expect(JSON.stringify(h.log.error)).toContain('PÚBLICO');
    // Não fica guardado como conferido: o próximo upload confere de novo, e passa quando o bucket volta a ser privado.
    expect((await subir(PNG, 'image/png')).status).toBe(503);
    h.bucketPublico = false;
    expect((await subir(PNG, 'image/png')).status).toBe(200);
    expect(h.leiturasDoBucket).toBe(3);
  });

  it('bucket que não diz se é público, ou que não dá para ler: também não sobe', async () => {
    h.bucketPublico = undefined;
    expect((await subir(PNG, 'image/png')).status).toBe(503);
    h.bucketPublico = false; h.lerBucketFalha = true;
    const res = await subir(PNG, 'image/png');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'bucket_indisponivel' });
    expect(h.uploads).toHaveLength(0);
  });

  it('a conferência do bucket é feita uma vez por instância, não a cada upload', async () => {
    for (let i = 0; i < 4; i++) expect((await subir(PNG, 'image/png')).status).toBe(200);
    expect(h.leiturasDoBucket).toBe(1);
    expect(h.uploads).toHaveLength(4);
  });

  it('bucket que não existe é criado privado e a subida tenta de novo UMA vez', async () => {
    h.bucketExiste = false;
    const res = await subir(PNG, 'image/png');
    expect(res.status).toBe(200);
    // Criado aqui, privado: o próximo upload nem pergunta de novo.
    expect((await subir(PNG, 'image/png')).status).toBe(200);
    expect(h.leiturasDoBucket).toBe(1);
    h.uploads = h.uploads.slice(0, 2);
    expect(h.bucketsCriados).toEqual([{ nome: 'financeiro-clientes', opcoes: { public: false, fileSizeLimit: 3 * 1024 * 1024 } }]);
    expect(h.uploads).toHaveLength(2);
    expect(h.uploads[0].path).toBe(h.uploads[1].path);
  });

  it('se não der para criar o bucket: 503 "bucket_indisponivel", sem segunda tentativa', async () => {
    h.bucketExiste = false; h.criarBucketFalha = true;
    const res = await subir(PNG, 'image/png', { ler: true });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'bucket_indisponivel' });
    expect(h.uploads).toHaveLength(1);
    expect(h.bucketsCriados).toHaveLength(1);
    expect(h.leituras).toHaveLength(0);
  });

  it('banco fora do ar: 500 antes de subir qualquer arquivo', async () => {
    h.erroEstado = true;
    const res = await subir(PNG, 'image/png');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'falha' });
    expect(h.uploads).toHaveLength(0);
  });

  it('o log de erro não leva base64, nome do arquivo nem caminho', async () => {
    h.bucketExiste = false; h.criarBucketFalha = true;
    await subir(PNG, 'image/png');
    const log = JSON.stringify(h.log.error);
    expect(h.log.error.length).toBeGreaterThan(0);
    for (const p of [PNG.toString('base64'), 'comprovante do cliente', 'fin/501/']) expect(log).not.toContain(p);
  });
});

describe('GET /financeiro/resumo', () => {
  async function tresCards(): Promise<void> {
    await lancar(corpoEntrada({ id: 'a-ent-000001' }), THIAGO, 1);
    await lancar(corpoEntrada({ id: 'a-ent-000002', valor_centavos: 250_000, data: '2026-10-03' }), THIAGO, 1);
    await lancar(corpoSaida({ id: 'a-sai-000001' }), THIAGO, 1);
    await lancar(corpoEntrada({ id: 'a-ent-000003', valor_centavos: 77, data: '2026-10-04' }), THIAGO, 1);
    await post('1/lancamento/a-ent-000003/apagar', { motivo: 'lançado errado' }, THIAGO);
    await lancar(corpoSaida({ id: 'b-sai-000001', valor_centavos: 64_457 }), THIAGO, 12);     // card só com saída
    await lancar(corpoEntrada({ id: 'c-ent-000001', valor_centavos: 999 }), THIAGO, 3);       // não pedido
  }

  it('não é capturado por /:cardId', async () => {
    const res = await get('resumo?ids=1,2', THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ ok: true, socio: true, resumo: {} });
    expect('lancamentos' in res.body).toBe(false);
  });

  it('soma certo para o sócio, ignora apagados e só traz card com lançamento', async () => {
    await tresCards();
    const res = await get('resumo?ids=1,12,2,1', THIAGO);     // id repetido conta uma vez
    expect(res.body).toEqual({
      ok: true,
      socio: true,
      resumo: {
        1: { recebido: ENTRADA + 250_000, gasto: GASTO, qtd: 3 },
        12: { recebido: 0, gasto: 64_457, qtd: 1 },
      },
    });
  });

  it('mascara o gasto para o consultor: nem o valor, nem a contagem, nem o card que só tem saída', async () => {
    await tresCards();
    const res = await get('resumo?ids=1,12,2');
    expect(res.body).toEqual({ ok: true, socio: false, resumo: { 1: { recebido: ENTRADA + 250_000, gasto: null, qtd: 2 } } });
    for (const p of [GASTO, 64_457]) expect(res.text).not.toContain(String(p));
  });

  it('ids inválidos, vazios ou demais: 400', async () => {
    for (const ids of ['', 'abc', '1,,x', '0', '-3', '1.5', '1;2']) {
      expect((await get(`resumo?ids=${encodeURIComponent(ids)}`)).status, ids).toBe(400);
    }
    expect((await get('resumo')).status).toBe(400);
    const seiscentos = Array.from({ length: 600 }, (_, i) => i + 1).join(',');
    expect((await get(`resumo?ids=${seiscentos}`)).status).toBe(200);
    expect((await get(`resumo?ids=${seiscentos},601`)).status).toBe(400);
  });

  it('pagina a varredura e não confunde o card 1 com o 12', async () => {
    for (let i = 0; i < 1500; i++) {
      const id = `massa-${String(i).padStart(6, '0')}`;
      const card = i % 2 ? 1 : 12;
      h.estado.set(`fin:${card}:${id}`, {
        id, card_id: card, tipo: 'entrada', categoria: 'parcela', valor_centavos: 1, data: '2026-09-01',
        criado_por: 'thiago', criado_em: '2026-09-01T12:00:00.000Z', apagado: false,
      });
    }
    h.estado.set('pos_venda:1', { valor: 10 });          // outra chave do system_state não entra
    const res = await get('resumo?ids=1', THIAGO);
    expect(res.body.resumo).toEqual({ 1: { recebido: 750, gasto: 0, qtd: 750 } });
    expect(h.consultas.map((c) => [c.padrao, c.de, c.ate])).toEqual([['fin:%', 0, 999], ['fin:%', 1000, 1999]]);
  });

  it('erro de banco: 500 { error: "falha" }', async () => {
    h.erroEstado = true;
    const res = await get('resumo?ids=1', THIAGO);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'falha' });
  });
});
