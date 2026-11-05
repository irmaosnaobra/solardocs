import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// 05/11/2026 (Jornada, fase 1): o número só nasce com o contrato E a procuração assinados anexados (`docs_cliente:vendasolar:<id>`); sem os dois, 409
// `precisa: 'assinatura'`. O `confirmar` só devolve candidatos ao ADM, e `novo: true` só vale vindo do ADM (Thiago); de outro nome vira false.
// A rota `POST /gerador/vendas-solares/:card/cliente` (fase 2): guarda, corpo, segredo, credencial, o alocador e as respostas.
// Login, bancos, planilha e Trello simulados; nada sai para a rede. Dados inventados.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: any; updated_at: string }>(),
  cartoes: [] as Array<{ id: string; name: string }>,
  trelloCai: false,
  planilha: null as null | { codigos: string[]; vendas: any[] },
  copia: null as null | { codigos: string[]; vendas: any[] },
  escritas: 0,
  tique: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../routes/geradorClientes', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorClientes')>()),
  leituraAtualDaPlanilha: async () => { if (!h.planilha) throw new Error('planilha fora'); return h.planilha; },
  leituraDaPlanilhaDoCache: async () => { if (!h.copia) throw new Error('sem cópia'); return h.copia; },
}));
vi.mock('../services/gerador/trelloVendaSolar', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/trelloVendaSolar')>()),
  lerTodosOsCartoes: vi.fn(async () => (h.trelloCai ? { ok: false, motivo: 'boom', causa: 'quadro' } : { ok: true, dados: h.cartoes })),
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: () => ({
      select: () => ({
        eq: (_c: string, id: number) => ({ maybeSingle: async () => ({ data: h.cards.find((c) => c.id === id) ?? null, error: null }) }),
        in: async (_c: string, ids: number[]) => ({ data: h.cards.filter((c) => ids.includes(c.id)), error: null }),
      }),
    }),
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const stamp = () => `2026-10-22T15:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => { const l = h.linhas.get(k); return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null }; },
          }),
          in: async () => ({ data: [], error: null }),
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
          const trava = l.key.startsWith('cadastro_trava:');
          if (!trava) h.escritas++;
          h.linhas.set(l.key, { value: l.value, updated_at: trava ? String(l.updated_at) : stamp() });
          return { error: null };
        },
        upsert: async (l: { key: string; value: unknown }) => { h.escritas++; h.linhas.set(l.key, { value: l.value, updated_at: stamp() }); return { error: null }; },
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
            then: (ok: (x: unknown) => unknown) => { h.escritas++; h.linhas.delete(k); return Promise.resolve({ error: null }).then(ok); },
          }),
        }),
      };
    },
  },
}));

import { mountVendaSolar } from '../routes/geradorVendaSolar';
import { assinarLigacao, invalidarCachesHub, reiniciarLogsDoHub, type Ligacao } from '../services/gerador/vendaSolarHub';
import { reiniciarLogsDoRegistro } from '../services/gerador/vendaSolarRegistro';
import { CARTAO_CONFIAVEL_DESDE_MS } from '../services/gerador/vendaSolarCodigo';

const r = Router();
mountVendaSolar(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const CARLA = 'Bearer tk-carla';
const THIAGO = 'Bearer tk-thiago';
const cliente = (id: number, corpo: unknown = {}, auth = NILCE) => request(app).post(`/gerador/vendas-solares/${id}/cliente`).set('Authorization', auth).send(corpo as object);
const card = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Cliente Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia mg', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', ...o,
});
const venda = (codigo: string, o: Record<string, string> = {}) => ({ codigo, cliente: 'Parente Inventado', homologacao: '', telefone: '', data: '2026-09-01', consultor: 'Nilce', ...o });
const ligar = (id: number, lig: Partial<Ligacao>) => {
  const l: Ligacao = { proposta: null, venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', ...lig };
  h.linhas.set(`venda_solar:${id}`, { updated_at: 'x', value: { ...l, sig: assinarLigacao(id, l) } });
};
const U = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
/** O par de papéis assinados anexado ao card (o portão do número, etapa 2 da Jornada). */
const comPar = (id: number): void => {
  h.linhas.set(`docs_cliente:vendasolar:${id}`, {
    updated_at: 'p',
    value: {
      arquivos: [
        { id: 'a1', slot: 'contrato_assinado', caminho: `vendasolar/${id}/${U(1)}.pdf`, mime: 'application/pdf', bytes: 10, em: '2026-11-01T10:00:00.000Z', por: 'giovanna' },
        { id: 'a2', slot: 'procuracao', caminho: `vendasolar/${id}/${U(2)}.pdf`, mime: 'application/pdf', bytes: 10, em: '2026-11-01T10:00:00.000Z', por: 'giovanna' },
      ],
      alteracoes: [], apagados: [],
    },
  });
};
const DEPOIS = `${Math.floor(CARTAO_CONFIAVEL_DESDE_MS / 1000).toString(16)}${'0'.repeat(15)}1`;

beforeEach(() => {
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-carla': 'carla@irmaosnaobra.app' };
  h.cards = [card(1143), card(1144, { created_by: 'lp_eletroposto' }), card(1145, { status: 'agendado' }), card(1146, { vendedor_nome: 'Carla' })];
  h.linhas = new Map(); h.cartoes = [{ id: 'f'.padEnd(24, '1'), name: '#0064 - (Cristiano) Parente - Uberlândia MG' }];
  h.trelloCai = false; h.escritas = 0; h.tique = 0; h.copia = null;
  for (const id of [1143, 1146, 1147]) comPar(id);
  h.planilha = { codigos: ['#0063'], vendas: [venda('#0063')] };
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-servico-falsa-do-teste';
  process.env.TRELLO_KEY = 'chave-trello-falsa'; process.env.TRELLO_TOKEN = 'token-trello-falso';
  delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SOLAR_SOCIOS;
  invalidarCachesHub(); reiniciarLogsDoHub(); reiniciarLogsDoRegistro();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /vendas-solares/:card/cliente', () => {
  it('sem login 401; inexistente, eletroposto, não vendido e alheio dão o MESMO 404; sócio e vendedor passam', async () => {
    expect((await request(app).post('/gerador/vendas-solares/1143/cliente').send({})).status).toBe(401);
    const alheio = await cliente(1146, {}, NILCE);
    expect(alheio.status).toBe(404);
    for (const id of [999, 1144, 1145]) {
      const x = await cliente(id, {}, THIAGO);
      expect(x.status).toBe(404);
      expect(x.body).toEqual(alheio.body);
    }
    expect((await cliente(1146, { previa: true }, CARLA)).status).toBe(200);
    expect((await cliente(1146, { previa: true }, THIAGO)).status).toBe(200);
    expect(h.escritas).toBe(0);
  });

  it('corpo inválido 400; sem segredo 503; sem credencial 503 precisa credencial; no-store', async () => {
    expect((await cliente(1143, { novo: 'sim' })).status).toBe(400);
    expect((await cliente(1143, { previa: 1 })).status).toBe(400);
    const ok = await cliente(1143, { previa: true });
    expect(ok.headers['cache-control']).toBe('no-store');
    delete process.env.TRELLO_KEY;
    expect(await cliente(1143, {}).then((x) => [x.status, x.body.precisa])).toEqual([503, 'credencial']);
    process.env.TRELLO_KEY = 'chave-trello-falsa';
    delete process.env.SUPABASE_SERVICE_KEY;
    expect((await cliente(1143, {})).status).toBe(503);
    expect(h.escritas).toBe(0);
  });

  it('criou, ja_ligada e adotou_trello', async () => {
    const a = await cliente(1143, {});
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ ok: true, acao: 'criou', criou: true, codigo: '#0065' });
    const b = await cliente(1143, {});
    expect(b.body).toEqual({ ok: true, acao: 'ja_ligada', criou: false, codigo: '#0065' });
    h.cards.push(card(1147, { cliente_telefone: '' }));
    ligar(1147, { trello_card: DEPOIS, por: 'trello' });
    h.cartoes.push({ id: DEPOIS, name: '#0070 - Cliente Inventado - Uberlândia MG' });
    expect((await cliente(1147, {})).body).toMatchObject({ acao: 'adotou_trello', criou: true, codigo: '#0070' });
  });

  it('telefone igual ao de uma linha do Excel: sem novo 409 confirmar (sem telefone); com novo 200 criou com o aviso só de códigos', async () => {
    h.planilha = { codigos: ['#0063', '#0064'], vendas: [venda('#0063'), venda('#0064', { telefone: '34999990001' })] };
    const c = await cliente(1143, {}, THIAGO);
    expect(c.status).toBe(409);
    expect(c.body).toEqual({
      ok: false, precisa: 'confirmar', error: 'Esta venda pode já estar na planilha. O administrador decide: ligar a venda antiga ou criar o número novo.',
      candidatos: [{ codigo: '#0064', cliente: 'Parente Inventado', data: '2026-09-01', motivo: 'telefone' }], ocultas: 0,
    });
    // Quem não é ADM não recebe os candidatos, e o `novo` dele vale false.
    const naoAdm = await cliente(1143, { novo: true });
    expect(naoAdm.status).toBe(409);
    expect(naoAdm.body.candidatos).toBeUndefined();
    expect([...h.linhas.keys()].filter((k) => /^(venda_solar|codigo_solar):/.test(k))).toEqual([]);   // só o estado da Jornada (numero.falha) pode ser gravado
    const n = await cliente(1143, { novo: true }, THIAGO);
    expect(n.status).toBe(200);
    expect(n.body).toMatchObject({ acao: 'criou', codigo: '#0065', mesmoTelefone: { codigos: ['#0064'], ocultas: 0 } });
    expect(n.body.aviso).toBe('Mesmo telefone da linha #0064 do Excel. Se for a mesma venda, use no Excel o número #0065.');
    expect(JSON.stringify(n.body)).not.toMatch(/9999/);
  });

  it('pergunta só do cartão (telefone diferente): 409 confirmar com motivo cartao', async () => {
    h.planilha = { codigos: ['#0040'], vendas: [venda('#0040', { telefone: '34911112222' })] };
    ligar(1143, { trello_card: DEPOIS, por: 'trello' });
    h.cartoes.push({ id: DEPOIS, name: '#0040 - Cliente Inventado - Uberlândia MG' });
    const c = await cliente(1143, {}, THIAGO);
    expect(c.status).toBe(409);
    expect(c.body.candidatos).toEqual([{ codigo: '#0040', cliente: 'Parente Inventado', data: '2026-09-01', motivo: 'cartao' }]);
  });

  it('prévia sem escrita (com e sem novo)', async () => {
    h.planilha = { codigos: ['#0064'], vendas: [venda('#0064', { telefone: '34999990001' })] };
    const sem = await cliente(1143, { previa: true });
    expect(sem.body).toMatchObject({ ok: true, previa: true, acao: 'confirmar', ocultas: 0 });
    const com = await cliente(1143, { previa: true, novo: true });
    expect(com.body).toMatchObject({ ok: true, previa: true, acao: 'criaria', codigo: '#0065', provisorio: true });
    expect(h.escritas).toBe(0);
    expect([...h.linhas.keys()].some((k) => k.startsWith('cadastro_trava:'))).toBe(false);
  });

  it('planilha fora: a cópia confere; sem cópia, o botão pergunta (0 candidatos) e o gancho (novo) numera direto', async () => {
    h.planilha = null;
    h.copia = { codigos: ['#0070'], vendas: [] };
    expect((await cliente(1143, {})).body).toEqual({ ok: true, acao: 'criou', criou: true, codigo: '#0071', planilhaFora: true, aviso: 'Número conferido sem a planilha do Excel.' });
    h.copia = null;
    const sem = await cliente(1146, {}, THIAGO);
    expect(sem.status).toBe(409);
    expect(sem.body).toEqual({
      ok: false, precisa: 'confirmar', semPlanilha: true, candidatos: [], ocultas: 0,
      error: 'Esta venda pode já estar na planilha. O administrador decide: ligar a venda antiga ou criar o número novo.',
    });
    expect((await cliente(1146, { novo: true }, THIAGO)).body).toMatchObject({ ok: true, acao: 'criou', codigo: '#0072', planilhaFora: true });
  });

  it('409 tentar de novo com a trava ocupada; 502 com o Trello fora', async () => {
    h.trelloCai = true;
    expect((await cliente(1143, {})).status).toBe(502);
    h.trelloCai = false;
    h.linhas.set('cadastro_trava:trello_numero_solar', { value: { por: 'outro', ate: new Date(Date.now() + 60_000).toISOString() }, updated_at: 'o' });
    const oc = await cliente(1143, {});
    expect(oc.status).toBe(409);
    expect(oc.body).toMatchObject({ conflito: true, tentarDeNovo: true });
    expect([...h.linhas.keys()].filter((k) => /^(venda_solar|codigo_solar):/.test(k))).toEqual([]);   // só o estado da Jornada (numero.falha) pode ser gravado
  }, 20_000);

  it('sem o contrato E a procuração assinados anexados: 409 assinatura e o alocador não roda', async () => {
    h.cards.push(card(1148));
    const a = await cliente(1148, {});
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ ok: false, precisa: 'assinatura' });
    expect(a.body.error).toMatch(/contrato e a procuração assinados/);
    // só um dos dois também não basta
    h.linhas.set('docs_cliente:vendasolar:1148', { updated_at: 'p', value: { arquivos: [
      { id: 'a1', slot: 'contrato_assinado', caminho: `vendasolar/1148/${U(1)}.pdf`, mime: 'application/pdf', bytes: 10, em: '2026-11-01T10:00:00.000Z', por: 'x' },
    ], alteracoes: [], apagados: [] } });
    expect((await cliente(1148, {})).body.precisa).toBe('assinatura');
    expect(h.escritas).toBe(0);
  });

  it('venda cancelada nunca ganha número (409 cancelada) mesmo com o par completo', async () => {
    const e = { v: 1, card: 1143, origem: 'vendido', vendido_em: '2026-11-01T10:00:00.000Z', vendido_por: 'nilce', vendedor: 'nilce',
      etapas: { 1: { aberta_em: null, concluida_em: null, concluida_por: '', excedente: null }, 2: { aberta_em: null, concluida_em: null, concluida_por: '', papeis: { contrato: null, procuracao: null, recibo: null } },
        3: { aberta_em: null, concluida_em: null, concluida_por: '', rateio: null, protocolo: null, engenheiro: null, trello: null }, 4: { aberta_em: null } },
      esperando: null, cancelada: { em: '2026-11-02T10:00:00.000Z', por: 'thiago', etapa: 2, com_numero: false },
      numero: { tentado_em: null, falha: null, nasceu_em: null }, historico: [] };
    const { assinarJornada } = await import('../services/gerador/jornadaSolarBanco');
    h.linhas.set('jornada_solar:1143', { updated_at: 'j', value: { ...e, sig: assinarJornada(1143, e as any) } });
    const r = await cliente(1143, {});
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, precisa: 'cancelada' });
    expect(h.linhas.has('venda_solar:1143')).toBe(false);
  });
});
