import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A porta das agentes da linha 5040 (Fase B1c-1): assumirNaEntrada. Posse, interruptores e porteiro
// REAIS; o banco é um cliente em memória que CONTA cada chamada. A leitura da conversa, os fatos do
// porteiro e a Meta são falsos (o contexto.ts tem teste próprio).

type Linha = Record<string, any>;
const h = vi.hoisted(() => {
  const estado = {
    tabelas: {} as Record<string, Linha[]>,
    chamadas: [] as Array<{ tabela: string; op: string }>,
    falhar: [] as Array<{ tabela: string; op?: string; code?: string }>,
    /** Roda antes de cada leitura de conversa: o teste simula a outra entrada gravando a posse no meio. */
    aoLerConversa: null as null | (() => void),
  };
  const cliente = {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: any = null;
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { filtros.push([c, v]); return b; };
      b.insert = (p: any) => { op = 'insert'; payload = p; return b; };
      b.update = (p: any) => { op = 'update'; payload = p; return b; };
      const executar = () => {
        estado.chamadas.push({ tabela, op });
        const f = estado.falhar.find(x => x.tabela === tabela && (!x.op || x.op === op));
        if (f) return { data: null, error: { code: f.code ?? 'XX000', message: 'falha com 5534999998888 dentro' } };
        const todas = (estado.tabelas[tabela] ??= []);
        const casa = (l: Linha) => filtros.every(([c, v]) => String(l[c]) === String(v));
        if (op === 'insert') {
          if (tabela === 'whatsapp_sessions' && todas.some(l => l.phone === payload.phone && l.tipo === payload.tipo)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          todas.push({ ...payload });
          return { data: null, error: null };
        }
        if (op === 'update') { for (const l of todas.filter(casa)) Object.assign(l, payload); return { data: null, error: null }; }
        return { data: todas.filter(casa)[0] ?? null, error: null };
      };
      b.maybeSingle = () => Promise.resolve(executar());
      b.then = (ok: any, ko: any) => Promise.resolve(executar()).then(ok, ko);
      return b;
    },
  };
  const moc = {
    conversa: { msgs: [] as any[], completa: true },
    conversaLanca: false,
    fatos: {} as Record<string, unknown>,
    fatosLanca: false,
    meta: { ok: true as boolean, campanha: { nome: 'Campanha' } as { nome: string } | null },
    produtoDaCampanha: 'solar' as string | null,
  };
  const fns = {
    lerConversa: vi.fn(),
    lerFatosPorteiro: vi.fn(),
    buscarOrigemDoAnuncio: vi.fn(),
  };
  return { estado, cliente, moc, fns };
});

vi.mock('../utils/supabase', () => ({ supabase: h.cliente }));
vi.mock('../services/agentes5040/contexto', () => ({
  lerConversa: h.fns.lerConversa,
  lerFatosPorteiro: h.fns.lerFatosPorteiro,
}));
vi.mock('../services/io/metaConjuntos', () => ({
  buscarOrigemDoAnuncio: h.fns.buscarOrigemDoAnuncio,
  lerMapaCampanhaProduto: async () => ({}),
  produtoDaCampanha: () => h.moc.produtoDaCampanha,
}));

import { CHAVE_VIVO_ALVO, zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { ancoraDaPosse, assumirNaEntrada } from '../services/agentes5040/entrada';
import { cedeAAgente } from '../services/agentes5040/posse';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';

const X = '5534999998888';     // celular de teste (no alvo)
const CHAVE_X = '3499998888';
const Y = '5534988887777';     // outro lead, fora do alvo
const AD = { externalAdReply: { sourceId: '120210000000000001', title: 'Anuncio' } };

const env = (v: Partial<Record<'DUDA' | 'HELENA' | 'CARLA', '0' | '1' | undefined>>) => {
  for (const d of ['DUDA', 'HELENA', 'CARLA'] as const) {
    if (v[d] === undefined) delete process.env[`AGENTES5040_${d}_VIVO`]; else process.env[`AGENTES5040_${d}_VIVO`] = v[d]!;
  }
};
const semear = (tabela: string, linha: Linha) => { (h.estado.tabelas[tabela] ??= []).push(linha); };
const alvo = () => semear('system_state', {
  key: CHAVE_VIVO_ALVO,
  value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE_X)], modos: {}, atualizado_em: '2026-10-21T10:00:00Z' },
});
const posse = (dona = 'duda', estado = 'viva') => semear('whatsapp_sessions', {
  phone: CHAVE_X, tipo: 'ag5040',
  lead_data: { dona, estado, desde: '2026-10-21T10:00:00Z', ate_wa_id: 1, respostas: 1, imagens: [], links: [] },
});
const posses = () => (h.estado.tabelas.whatsapp_sessions ?? []).filter(l => l.tipo === 'ag5040');
const inserts = () => h.estado.chamadas.filter(c => c.tabela === 'whatsapp_sessions' && c.op === 'insert').length;
const daLeadComTexto = (texto: string) => ({ id: 5, from_me: false, from_api: null, autor: 'lead', texto, tipo: 'text', media_url: null, momment: '2026-10-21T13:00:00Z' });

/** Fatos limpos: leitura ok e nenhum sinal. Cada caso liga o que quer. */
const fatos = (extra: Record<string, unknown> = {}) => {
  h.moc.fatos = {
    leituraOk: true, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false, donaAtual: null,
    ehClienteSolarDoc: false, anuncio: null, origemCadastro: null, outroRoboAtivo: false, ...extra,
  };
};

let erroConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.estado.tabelas = {}; h.estado.chamadas = []; h.estado.falhar = []; h.estado.aoLerConversa = null;
  h.moc.conversa = { msgs: [], completa: true }; h.moc.conversaLanca = false; h.moc.fatosLanca = false;
  h.moc.meta = { ok: true, campanha: { nome: 'Campanha' } }; h.moc.produtoDaCampanha = 'solar';
  fatos();
  h.fns.lerConversa.mockReset().mockImplementation(async () => {
    h.estado.aoLerConversa?.();
    if (h.moc.conversaLanca) throw new Error('banco fora 5534999998888');
    return h.moc.conversa;
  });
  // O falso calcula o texto do primeiro lead da conversa que recebeu, como o contexto.ts de verdade.
  h.fns.lerFatosPorteiro.mockReset().mockImplementation(async (_chave: string, msgs: any[], anuncio: unknown) => {
    if (h.moc.fatosLanca) throw new Error('banco fora');
    const primeiro = msgs.find(m => m.autor === 'lead' && String(m.texto ?? '').trim());
    return { ...h.moc.fatos, anuncio, primeiroTextoDoLead: primeiro ? String(primeiro.texto) : null };
  });
  h.fns.buscarOrigemDoAnuncio.mockReset().mockImplementation(async () => ({ ...h.moc.meta }));
  env({}); zerarCacheInterruptores();
  erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { erroConsole.mockRestore(); env({}); zerarCacheInterruptores(); });

const BOTAO_SOLAR = 'Olá! Quero simular meu projeto de energia solar';

describe('assumirNaEntrada: passos 1 e 2 (nada ligado, fora do escopo)', () => {
  it('(a) tudo desligado: false e ZERO chamadas ao banco, com posse e alvo gravados', async () => {
    env({ DUDA: '0', HELENA: '0', CARLA: '0' });
    posse(); alvo();
    h.estado.chamadas = [];
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR, anuncio: AD })).toBe(false);
    expect(h.estado.chamadas).toEqual([]);
    expect(h.fns.lerConversa).not.toHaveBeenCalled();
    expect(h.fns.lerFatosPorteiro).not.toHaveBeenCalled();
  });

  it('(b) duda_vivo ligado e o lead fora do alvo: false, sem ler a posse e sem ler a conversa', async () => {
    env({ DUDA: '1' });
    alvo(); posse();                       // a posse é do X; quem chega é o Y
    fatos({ origemCadastro: 'lp_solar' });
    h.estado.chamadas = [];
    expect(await assumirNaEntrada(Y, { texto: BOTAO_SOLAR })).toBe(false);
    expect(h.estado.chamadas.filter(c => c.tabela === 'whatsapp_sessions')).toEqual([]);
    expect(h.fns.lerConversa).not.toHaveBeenCalled();
    expect(posses()).toHaveLength(1);
  });

  it('duda_vivo ligado e NENHUM alvo gravado: ninguém está no escopo, false sem ler a posse', async () => {
    env({ DUDA: '1' });
    fatos({ origemCadastro: 'lp_solar' });
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    expect(h.estado.chamadas.filter(c => c.tabela === 'whatsapp_sessions')).toEqual([]);
    expect(posses()).toHaveLength(0);
  });

  it('telefone que não é pessoa (curto, grupo, lixo, vazio): false', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    for (const t of ['123', '120363000000000000@g.us', 'lid:99', '', null, undefined]) {
      expect(await assumirNaEntrada(t as string, { texto: BOTAO_SOLAR })).toBe(false);
    }
    expect(posses()).toHaveLength(0);
  });
});

describe('assumirNaEntrada: passo 3 (já tem posse = o mesmo que cedeAAgente)', () => {
  it('(c) posse viva da Duda: true, igual ao cedeAAgente, sem ler a conversa nem gravar nada', async () => {
    env({ DUDA: '1' }); alvo(); posse();
    expect(await cedeAAgente(X)).toBe(true);
    h.estado.chamadas = [];
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(true);
    expect(h.fns.lerConversa).not.toHaveBeenCalled();
    expect(inserts()).toBe(0);
  });

  it('(c) posse passou_humano e nao_incomodar também cedem; o humano que a agente chamou também', async () => {
    env({ DUDA: '1' }); alvo();
    for (const [dona, estado] of [['duda', 'passou_humano'], ['duda', 'nao_incomodar'], ['humano', 'viva']] as const) {
      h.estado.tabelas = {}; alvo(); posse(dona, estado); zerarCacheInterruptores();
      expect(await assumirNaEntrada(X, {})).toBe(await cedeAAgente(X));
      expect(await assumirNaEntrada(X, {})).toBe(true);
    }
  });

  it('(c) posse encerrada: igual ao cedeAAgente (false) e a porta NÃO assume de novo por cima dela', async () => {
    env({ DUDA: '1' }); alvo(); posse('duda', 'encerrada');
    fatos({ origemCadastro: 'lp_solar' });
    expect(await cedeAAgente(X)).toBe(false);
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    expect(inserts()).toBe(0);
    expect(h.fns.lerConversa).not.toHaveBeenCalled();
    expect(posses()[0]!.lead_data.estado).toBe('encerrada');
  });

  it('(c) posse da Helena com só a Duda ligada: não cede e a porta não assume por cima (false, sem inserir)', async () => {
    env({ DUDA: '1' }); alvo(); posse('helena', 'viva');
    fatos({ origemCadastro: 'lp_solar' });
    expect(await cedeAAgente(X)).toBe(await assumirNaEntrada(X, { texto: BOTAO_SOLAR }));
    expect(inserts()).toBe(0);
  });

  it('(c) erro ao ler a posse com o lead no escopo: o mesmo true do cedeAAgente (o antigo cala), sem gravar', async () => {
    env({ DUDA: '1' }); alvo();
    h.estado.falhar = [{ tabela: 'whatsapp_sessions', op: 'select' }];
    expect(await cedeAAgente(X)).toBe(true);
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(true);
    expect(inserts()).toBe(0);
  });
});

describe('assumirNaEntrada: passo 4 (sem posse, o porteiro decide a Duda)', () => {
  it('(d) pelo anúncio de solar: grava a posse 1 vez (dona duda, viva) e devolve true; o porteiro vê {adId, produto}', async () => {
    env({ DUDA: '1' }); alvo();
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD })).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(posses()[0]).toMatchObject({ phone: CHAVE_X, tipo: 'ag5040', lead_data: { dona: 'duda', estado: 'viva', respostas: 0, ate_wa_id: null } });
    expect(inserts()).toBe(1);
    expect(h.fns.buscarOrigemDoAnuncio).toHaveBeenCalledWith('120210000000000001');
    expect(h.fns.lerFatosPorteiro.mock.calls[0]![2]).toEqual({ adId: '120210000000000001', produto: 'solar' });
    expect(h.fns.lerFatosPorteiro.mock.calls[0]![3]).toMatchObject({ completa: true });
  });

  it('(d) pelo texto de botão do solar: a mensagem que chegou ainda não está em wa_mensagens e mesmo assim vale', async () => {
    env({ DUDA: '1' }); alvo();
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(posses()[0]!.lead_data.dona).toBe('duda');
    const msgs = h.fns.lerFatosPorteiro.mock.calls[0]![1] as any[];
    expect(msgs.slice(-1)[0]).toMatchObject({ autor: 'lead', texto: BOTAO_SOLAR });
  });

  it('(d) pelo texto de botão quando a conversa já traz o texto do lead: usa o da conversa (a primeira fala), não duplica', async () => {
    env({ DUDA: '1' }); alvo();
    h.moc.conversa = { msgs: [daLeadComTexto(BOTAO_SOLAR)], completa: true };
    expect(await assumirNaEntrada(X, { texto: 'e aí?' })).toBe(true);
    const msgs = h.fns.lerFatosPorteiro.mock.calls[0]![1] as any[];
    expect(msgs).toHaveLength(1);
  });

  it('(d) pelo card de lp_solar (sem anúncio e sem botão)', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    expect(await assumirNaEntrada(X, { texto: 'oi, tudo bem?' })).toBe(true);
    expect(posses()).toHaveLength(1);
  });

  it('(d) anúncio sem id (só ctwa_clid) conta como "sem anúncio" e segue para o card; a Meta nem é chamada', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'quiz' });
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: { ctwa_clid: 'clid-1' } })).toBe(true);
    expect(h.fns.buscarOrigemDoAnuncio).not.toHaveBeenCalled();
    expect(h.fns.lerFatosPorteiro.mock.calls[0]![2]).toBeNull();
  });

  it('(d) waId vira ate_wa_id - 1, para a rodada viva ainda enxergar a mensagem que abriu a conversa', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    expect(await assumirNaEntrada(X, { waId: 100 })).toBe(true);
    expect(posses()[0]!.lead_data.ate_wa_id).toBe(99);
  });

  it('(d) a âncora da posse: desde = momento da mensagem (momment, em ms) menos 60 s; sem momento vale a hora de agora', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    const msg = Date.now() - 3 * 60_000;                       // o poll pegou a mensagem 3 min depois
    expect(await assumirNaEntrada(X, { texto: 'oi', momento: msg })).toBe(true);
    expect(posses()[0]!.lead_data.desde).toBe(new Date(msg - 60_000).toISOString());

    h.estado.tabelas = {}; alvo();
    const antes = Date.now();
    expect(await assumirNaEntrada(X, { texto: 'oi' })).toBe(true);
    const desde = Date.parse(posses()[0]!.lead_data.desde);
    expect(desde).toBeGreaterThanOrEqual(antes);
    expect(desde).toBeLessThanOrEqual(Date.now());
  });

  it('(d) ancoraDaPosse: aceita ms, segundos e ISO; momento fora do razoável (futuro, mais de 1 h, lixo) vira null', () => {
    const agora = Date.parse('2026-10-21T15:00:00.000Z');
    const t = agora - 120_000;
    const esperado = new Date(t - 60_000).toISOString();
    expect(ancoraDaPosse(t, agora)).toBe(esperado);
    expect(ancoraDaPosse(String(t), agora)).toBe(esperado);
    expect(ancoraDaPosse(Math.floor(t / 1000), agora)).toBe(new Date(Math.floor(t / 1000) * 1000 - 60_000).toISOString());
    expect(ancoraDaPosse(new Date(t).toISOString(), agora)).toBe(esperado);
    expect(ancoraDaPosse(agora + 10 * 60_000, agora)).toBeNull();          // no futuro
    expect(ancoraDaPosse(agora - 2 * 3_600_000, agora)).toBeNull();        // mais de 1 h atrás
    expect(ancoraDaPosse(0, agora)).toBeNull();
    for (const ruim of [null, undefined, '', 'ontem', NaN]) expect(ancoraDaPosse(ruim as any, agora)).toBeNull();
  });

  it('(d) todo formato do telefone cai na MESMA chave de 10 dígitos: 1 linha de posse', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    for (const t of [X, '34999998888', '(34) 99999-8888', '+55 34 9 9999-8888', '553499998888']) {
      expect(await assumirNaEntrada(t, { texto: 'oi' })).toBe(true);
    }
    expect(posses()).toHaveLength(1);
    expect(posses()[0]!.phone).toBe(CHAVE_X);
    expect(inserts()).toBe(1);
  });
});

describe('assumirNaEntrada: idempotência (webhook, fila e poll veem a mesma mensagem)', () => {
  it('(e) chamada 2x em sequência: 1 INSERT efetivo; as duas devolvem true', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    expect(await assumirNaEntrada(X, { texto: 'oi' })).toBe(true);
    expect(await assumirNaEntrada(X, { texto: 'oi' })).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(inserts()).toBe(1);               // a 2ª já achou a posse e nem tentou inserir
  });

  it('(e) chamada 2x ao mesmo tempo: 1 linha, as duas true', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    const r = await Promise.all([assumirNaEntrada(X, { texto: 'oi' }), assumirNaEntrada(X, { texto: 'oi' })]);
    expect(r).toEqual([true, true]);
    expect(posses()).toHaveLength(1);
  });

  it('(e) a outra entrada grava a posse no meio da leitura: o INSERT bate em 23505 e volta true (ja_tinha_dona), sem 2ª linha', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    h.estado.aoLerConversa = () => { if (!posses().length) posse('duda', 'viva'); };
    expect(await assumirNaEntrada(X, { texto: 'oi' })).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(inserts()).toBe(1);               // a tentativa existiu e perdeu para a outra por 23505
  });
});

describe('assumirNaEntrada: a Helena (B2, eletroposto)', () => {
  const donaDaPosse = () => (posses()[0]?.lead_data as { dona?: string } | undefined)?.dona;

  it('(h) o porteiro decide a Helena (anúncio de eletroposto) com helena_vivo ligado e o lead no escopo: a posse nasce da Helena e o robô antigo cala', async () => {
    env({ DUDA: '1', HELENA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'eletroposto';
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD, waId: 11 })).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(donaDaPosse()).toBe('helena');
    expect((posses()[0]!.lead_data as { ate_wa_id: number }).ate_wa_id).toBe(10);
    expect(inserts()).toBe(1);
  });

  it('(h) só helena_vivo ligado: a Helena assume sozinha (a Duda desligada não é pré-requisito)', async () => {
    env({ HELENA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'eletroposto';
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD })).toBe(true);
    expect(donaDaPosse()).toBe('helena');
  });

  it('(h) helena_vivo desligado, mesmo com a Duda ligada: o porteiro decide a Helena e a porta NÃO assume (false, nada gravado)', async () => {
    env({ DUDA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'eletroposto';
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD })).toBe(false);
    expect(posses()).toHaveLength(0);
    expect(inserts()).toBe(0);
  });

  it('(h) lead fora do escopo da Helena (hmac fora da lista): false, nada gravado', async () => {
    env({ DUDA: '1', HELENA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'eletroposto';
    expect(await assumirNaEntrada(Y, { texto: 'oi', anuncio: AD })).toBe(false);
    expect(posses()).toHaveLength(0);
  });

  it('(h) o porteiro decide a Duda com as duas ligadas: a posse é da Duda, não da Helena', async () => {
    env({ DUDA: '1', HELENA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(true);
    expect(donaDaPosse()).toBe('duda');
  });

  it('(h) posse da Helena já gravada: a porta cede (true) e não insere outra', async () => {
    env({ HELENA: '1' }); alvo(); posse('helena', 'viva');
    expect(await assumirNaEntrada(X, { texto: 'oi' })).toBe(true);
    expect(inserts()).toBe(0);
  });
});

describe('assumirNaEntrada: a Carla (B3b, SolarDoc)', () => {
  const donaDaPosse = () => (posses()[0]?.lead_data as { dona?: string } | undefined)?.dona;

  // Mudança de expectativa em B3b: antes (f) afirmava que a porta NÃO assumia a Carla mesmo com carla_vivo ligado.
  it('(i) o porteiro decide a Carla (anúncio do SolarDoc) com carla_vivo ligado e o lead no escopo: a posse nasce da Carla e o robô antigo cala', async () => {
    env({ CARLA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'solardoc';
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD, waId: 11 })).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(donaDaPosse()).toBe('carla');
    expect(inserts()).toBe(1);
  });

  it('(i) carla_vivo desligado (as outras ligadas): o porteiro decide a Carla e a porta NÃO assume', async () => {
    env({ DUDA: '1', HELENA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'solardoc';
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD })).toBe(false);
    expect(posses()).toHaveLength(0);
    expect(inserts()).toBe(0);
  });

  it('(i) lead fora do escopo da Carla (hmac fora da lista): false, nada gravado', async () => {
    env({ CARLA: '1' }); alvo();
    h.moc.produtoDaCampanha = 'solardoc';
    expect(await assumirNaEntrada(Y, { texto: 'oi', anuncio: AD })).toBe(false);
    expect(posses()).toHaveLength(0);
  });

  it('(i) cliente com conta nunca é da Carla: o porteiro manda à Giovanna (passo 3) e a porta não assume', async () => {
    env({ DUDA: '1', CARLA: '1' }); alvo();
    fatos({ ehClienteSolarDoc: true, origemCadastro: 'solardoc' });
    expect(await assumirNaEntrada(X, { texto: 'oi', anuncio: AD })).toBe(false);
    expect(posses()).toHaveLength(0);
    expect(inserts()).toBe(0);
  });
});

describe('assumirNaEntrada: quem a porta NÃO assume nesta fase', () => {
  it('(f) só helena_vivo ligado e o porteiro decide a Duda: a Duda não atende este lead, false e nada gravado', async () => {
    env({ HELENA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    expect(posses()).toHaveLength(0);
    expect(inserts()).toBe(0);
  });

  it('(g) passo 7 (sem sinal do assunto), Giovanna (cliente do SolarDoc) e outro robô antigo na conversa: false, nada gravado', async () => {
    env({ DUDA: '1' }); alvo();
    fatos();                                                   // passo 7
    expect(await assumirNaEntrada(X, { texto: 'oi' })).toBe(false);
    fatos({ ehClienteSolarDoc: true, origemCadastro: 'lp_solar' });   // passo 3
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    fatos({ outroRoboAtivo: true, origemCadastro: 'lp_solar' });      // a recepção antiga já abriu sessão
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    expect(posses()).toHaveLength(0);
    expect(inserts()).toBe(0);
  });

  it('(g) humano na conversa, não incomodar, bloqueado e mudo: false, nada gravado', async () => {
    env({ DUDA: '1' }); alvo();
    for (const f of [{ humanoNaConversa: true }, { naoIncomodar: true }, { bloqueado: true }, { mudo: true }]) {
      fatos({ ...f, origemCadastro: 'lp_solar' });
      expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    }
    expect(posses()).toHaveLength(0);
  });
});

describe('assumirNaEntrada: passo 5 (erro de leitura sem posse = o antigo atende)', () => {
  const casos: Array<[string, () => void]> = [
    ['fatos do porteiro com leitura incompleta', () => fatos({ leituraOk: false, origemCadastro: 'lp_solar' })],
    ['o porteiro lança', () => { h.moc.fatosLanca = true; }],
    ['a conversa vem incompleta', () => { h.moc.conversa = { msgs: [], completa: false }; fatos({ origemCadastro: 'lp_solar' }); }],
    ['a leitura da conversa lança', () => { h.moc.conversaLanca = true; fatos({ origemCadastro: 'lp_solar' }); }],
    ['a Meta não responde sobre o anúncio', () => { h.moc.meta = { ok: false, campanha: null }; fatos({ origemCadastro: 'lp_solar' }); }],
    ['a Meta lança', () => { h.fns.buscarOrigemDoAnuncio.mockRejectedValue(new Error('rede')); fatos({ origemCadastro: 'lp_solar' }); }],
    ['o INSERT da posse falha', () => { fatos({ origemCadastro: 'lp_solar' }); h.estado.falhar = [{ tabela: 'whatsapp_sessions', op: 'insert', code: '57014' }]; }],
  ];
  for (const [nome, prepara] of casos) {
    it(`(h) ${nome}: false, nada gravado e o log não leva telefone`, async () => {
      env({ DUDA: '1' }); alvo();
      prepara();
      expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR, anuncio: AD })).toBe(false);
      expect(posses()).toHaveLength(0);
      const log = erroConsole.mock.calls.flat().join(' ');
      expect(log).not.toMatch(/5534999998888|3499998888|34999998888/);
    });
  }

  it('(h) erro ao ler o alvo (system_state fora): a Duda não atende, false', async () => {
    env({ DUDA: '1' }); alvo(); fatos({ origemCadastro: 'lp_solar' });
    h.estado.falhar = [{ tabela: 'system_state' }];
    expect(await assumirNaEntrada(X, { texto: BOTAO_SOLAR })).toBe(false);
    expect(posses()).toHaveLength(0);
  });
});
