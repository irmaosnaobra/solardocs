import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Posse das agentes da linha 5040 (Fase B1b): posse.ts + o leitor do alvo de interruptores.ts.
// Banco falso em memória que CONTA cada chamada: o caso "tudo desligado" prova zero leitura por contagem.

type Linha = Record<string, any>;
const h = vi.hoisted(() => {
  const estado = {
    tabelas: {} as Record<string, Linha[]>,
    chamadas: [] as Array<{ tabela: string; chave: string | null }>,
    falhar: [] as Array<{ tabela: string; op?: string; key?: string; code?: string }>,
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
        const chave = String(filtros.find(([c]) => c === 'key')?.[1] ?? filtros.find(([c]) => c === 'phone')?.[1] ?? '') || null;
        estado.chamadas.push({ tabela, chave });
        const f = estado.falhar.find(x => x.tabela === tabela && (!x.op || x.op === op) && (!x.key || x.key === chave));
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
  return { estado, cliente };
});

vi.mock('../utils/supabase', () => ({ supabase: h.cliente }));

import {
  CHAVE_INTERRUPTORES, CHAVE_VIVO_ALVO, alvoDoValor, lerAlvoVivo, ligado, zerarCacheInterruptores, CACHE_MS,
} from '../services/agentes5040/interruptores';
import { DONAS_LIBERADAS_PARA_TODOS, agenteAtendeEste, assumirPosse, atualizarPosse, cedeAAgente, lerPosse } from '../services/agentes5040/posse';
import type { DonaViva } from '../services/agentes5040/interruptores';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';

const X = '34999998888';       // celular de teste
const CHAVE_X = '3499998888';
const Y = '34988887777';       // outro lead
const CHAVE_Y = '3488887777';

const DONAS = ['DUDA', 'HELENA', 'CARLA'] as const;
const env = (v: Partial<Record<'DUDA' | 'HELENA' | 'CARLA', '0' | '1' | undefined>>) => {
  for (const d of DONAS) {
    if (v[d] === undefined) delete process.env[`AGENTES5040_${d}_VIVO`]; else process.env[`AGENTES5040_${d}_VIVO`] = v[d]!;
  }
};
const semear = (tabela: string, linha: Linha) => { (h.estado.tabelas[tabela] ??= []).push(linha); };
const alvo = (v: Partial<{ kid: string | null; hmacs: string[]; modos: Record<string, string> }> = {}) =>
  semear('system_state', {
    key: CHAVE_VIVO_ALVO,
    value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE_X)], modos: {}, atualizado_em: '2026-10-21T10:00:00Z', ...v },
  });
const posse = (extra: Record<string, unknown> = {}, chave = CHAVE_X) =>
  semear('whatsapp_sessions', {
    phone: chave, tipo: 'ag5040',
    lead_data: { dona: 'duda', estado: 'viva', desde: '2026-10-21T10:00:00Z', ate_wa_id: 1, respostas: 1, imagens: [], links: [], ...extra },
  });
const leiturasDe = (tabela: string) => h.estado.chamadas.filter(c => c.tabela === tabela);
let erroConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.estado.tabelas = {};
  h.estado.chamadas = [];
  h.estado.falhar = [];
  env({});
  zerarCacheInterruptores();
  erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
});
// A lista de donas liberadas para 'todos' é vazia em produção; os casos que exercitam o modo 'todos' liberam a dona à mão.
const liberar = (...d: DonaViva[]) => { (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).push(...d); };
afterEach(() => { erroConsole.mockRestore(); env({}); (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0; });

describe('interruptores novos e leitor do alvo', () => {
  it('duda_vivo, helena_vivo e carla_vivo: env liga e desliga; a chave do banco liga só o que está true', async () => {
    env({ DUDA: '1', HELENA: '0' });
    semear('system_state', { key: CHAVE_INTERRUPTORES, value: { helena_vivo: true, carla_vivo: true } });
    expect(await ligado('duda_vivo')).toBe(true);
    expect(await ligado('helena_vivo')).toBe(false);   // a env vence a chave
    expect(await ligado('carla_vivo')).toBe(true);
  });

  it('o valor do alvo ausente, torto ou com hmac inválido vira alvo vazio em modo teste', () => {
    for (const v of [undefined, null, 'lixo', [], 7, { hmacs: 'x', modos: 3 }]) {
      expect(alvoDoValor(v)).toMatchObject({ kid: null, hmacs: [], modos: {} });
    }
    expect(alvoDoValor({ hmacs: ['curto', 'a'.repeat(64), 'a'.repeat(64), 5], modos: { duda: 'todos', helena: 'x', outra: 'todos' } }))
      .toMatchObject({ hmacs: ['a'.repeat(64)], modos: { duda: 'todos' } });
  });

  it('cache de 60 s, e zerarCacheInterruptores zera também o do alvo', async () => {
    let t = 1_000_000;
    const ler = vi.fn(async () => ({ hmacs: [] }));
    await lerAlvoVivo({ ler, agora: () => t });
    t += CACHE_MS - 1;
    await lerAlvoVivo({ ler, agora: () => t });
    expect(ler).toHaveBeenCalledTimes(1);
    zerarCacheInterruptores();
    await lerAlvoVivo({ ler, agora: () => t });
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it('erro de leitura do alvo devolve null (e o erro vale poucos segundos, não um minuto)', async () => {
    let t = 1_000_000;
    let falha = true;
    const ler = vi.fn(async () => { if (falha) throw new Error('banco fora'); return { hmacs: [] }; });
    expect(await lerAlvoVivo({ ler, agora: () => t })).toBeNull();
    falha = false;
    t += 11_000;
    expect(await lerAlvoVivo({ ler, agora: () => t })).not.toBeNull();
  });
});

describe('cedeAAgente: passo 1, tudo desligado', () => {
  it('env 0 nas três: false e ZERO chamadas ao banco', async () => {
    env({ DUDA: '0', HELENA: '0', CARLA: '0' });
    posse(); alvo();
    h.estado.chamadas = [];
    expect(await cedeAAgente(X)).toBe(false);
    expect(await agenteAtendeEste('duda', X)).toBe(false);
    expect(await agenteAtendeEste('carla', X)).toBe(false);
    expect(h.estado.chamadas).toEqual([]);
  });

  it('desligado pelo banco: uma leitura só (a dos interruptores, em cache), nunca o alvo nem a posse', async () => {
    posse(); alvo();
    semear('system_state', { key: CHAVE_INTERRUPTORES, value: { duda_vivo: false } });
    h.estado.chamadas = [];
    expect(await cedeAAgente(X)).toBe(false);
    expect(await cedeAAgente(Y)).toBe(false);
    expect(await agenteAtendeEste('helena', X)).toBe(false);
    expect(h.estado.chamadas).toEqual([{ tabela: 'system_state', chave: CHAVE_INTERRUPTORES }]);
  });

  it('erro ao ler o interruptor também é desligado: false', async () => {
    h.estado.falhar = [{ tabela: 'system_state', key: CHAVE_INTERRUPTORES }];
    posse(); alvo();
    expect(await cedeAAgente(X)).toBe(false);
    expect(leiturasDe('whatsapp_sessions')).toEqual([]);
  });
});

describe('cedeAAgente: escopo por lead (passo 2) e posse (passo 3)', () => {
  it('chave do alvo ausente = modo teste com lista vazia: ninguém é atendido, a posse nem é lida', async () => {
    env({ DUDA: '1' });
    posse();
    expect(await cedeAAgente(X)).toBe(false);
    expect(await agenteAtendeEste('duda', X)).toBe(false);
    expect(leiturasDe('whatsapp_sessions')).toEqual([]);
  });

  it('modo teste: o lead da lista com posse viva cede; o lead de fora não cede e a posse não é lida', async () => {
    env({ DUDA: '1' });
    alvo(); posse(); posse({}, CHAVE_Y);
    expect(await cedeAAgente(X)).toBe(true);
    h.estado.chamadas = [];
    expect(await cedeAAgente(Y)).toBe(false);
    expect(leiturasDe('whatsapp_sessions')).toEqual([]);
    expect(await agenteAtendeEste('duda', X)).toBe(true);
    expect(await agenteAtendeEste('duda', Y)).toBe(false);
  });

  it('lead no escopo mas SEM posse: não cede (o robô antigo atende como hoje)', async () => {
    env({ DUDA: '1' });
    alvo();
    expect(await cedeAAgente(X)).toBe(false);
  });

  it('estados: viva, passou_humano e nao_incomodar cedem; encerrada não', async () => {
    env({ DUDA: '1' });
    alvo();
    for (const [estado, esperado] of [['viva', true], ['passou_humano', true], ['nao_incomodar', true], ['encerrada', false]] as const) {
      h.estado.tabelas.whatsapp_sessions = [];
      posse({ estado });
      expect(await cedeAAgente(X), estado).toBe(esperado);
    }
  });

  it('trava do modo todos: com a lista de donas liberadas vazia, todos gravado vale como teste (só o alvo)', async () => {
    expect(DONAS_LIBERADAS_PARA_TODOS).toEqual([]);
    env({ DUDA: '1' });
    alvo({ modos: { duda: 'todos' } });
    posse({}, CHAVE_Y);
    expect(await agenteAtendeEste('duda', X)).toBe(true);    // o alvo
    expect(await agenteAtendeEste('duda', Y)).toBe(false);   // fora do alvo: 'todos' não vale
    expect(await cedeAAgente(Y)).toBe(false);
  });

  it('modo todos (dona liberada): qualquer lead com posse cede; sem posse não; a lista deixa de importar', async () => {
    liberar('duda');
    env({ DUDA: '1' });
    alvo({ hmacs: [], modos: { duda: 'todos' } });
    posse({}, CHAVE_Y);
    expect(await cedeAAgente(Y)).toBe(true);
    expect(await cedeAAgente(X)).toBe(false);
    expect(await agenteAtendeEste('duda', X)).toBe(true);
  });

  it('o modo é por dona: duda em todos não libera a helena, que segue em teste', async () => {
    liberar('duda', 'helena');
    env({ DUDA: '1', HELENA: '1' });
    alvo({ hmacs: [], modos: { duda: 'todos' } });
    expect(await agenteAtendeEste('duda', Y)).toBe(true);
    expect(await agenteAtendeEste('helena', Y)).toBe(false);
  });

  it('posse de uma dona cuja chave está desligada não cede, mesmo havendo outra dona ligada que cobre o lead', async () => {
    liberar('helena');
    env({ DUDA: '0', HELENA: '1' });
    alvo({ hmacs: [], modos: { helena: 'todos' } });
    posse({ dona: 'duda' });
    expect(await cedeAAgente(X)).toBe(false);
    h.estado.tabelas.whatsapp_sessions = [];
    posse({ dona: 'helena' });
    expect(await cedeAAgente(X)).toBe(true);
  });

  it('posse com dona humano: cede enquanto alguma dona ligada cobre o lead; encerrada não', async () => {
    env({ CARLA: '1' });
    alvo();
    posse({ dona: 'humano', estado: 'passou_humano' });
    expect(await cedeAAgente(X)).toBe(true);
    h.estado.tabelas.whatsapp_sessions = [];
    posse({ dona: 'humano', estado: 'encerrada' });
    expect(await cedeAAgente(X)).toBe(false);
  });
});

describe('uma leitura por vez (cache frio)', () => {
  it('5 chamadas simultâneas de ligado com cache frio fazem 1 leitura dos interruptores', async () => {
    semear('system_state', { key: CHAVE_INTERRUPTORES, value: { duda_vivo: true } });
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => ligado('duda_vivo')));
    expect(r).toEqual([true, true, true, true, true]);
    expect(h.estado.chamadas.filter(c => c.tabela === 'system_state' && c.chave === CHAVE_INTERRUPTORES)).toHaveLength(1);
  });

  it('5 chamadas simultâneas de lerAlvoVivo com cache frio fazem 1 leitura do alvo', async () => {
    alvo();
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => lerAlvoVivo()));
    expect(r.every(a => a && a.hmacs.length === 1)).toBe(true);
    expect(h.estado.chamadas.filter(c => c.tabela === 'system_state' && c.chave === CHAVE_VIVO_ALVO)).toHaveLength(1);
  });

  it('5 agenteAtendeEste simultâneos: 1 leitura de interruptores e 1 do alvo', async () => {
    env({ DUDA: undefined });
    semear('system_state', { key: CHAVE_INTERRUPTORES, value: { duda_vivo: true } });
    alvo();
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => agenteAtendeEste('duda', X)));
    expect(r).toEqual([true, true, true, true, true]);
    expect(h.estado.chamadas.filter(c => c.chave === CHAVE_INTERRUPTORES)).toHaveLength(1);
    expect(h.estado.chamadas.filter(c => c.chave === CHAVE_VIVO_ALVO)).toHaveLength(1);
  });
});

describe('cedeAAgente: normalização do telefone', () => {
  it('todo formato dos pontos de corte cai na mesma chave', async () => {
    env({ DUDA: '1' });
    alvo(); posse();
    for (const f of [
      '34999998888', '5534999998888', '553499998888', '3499998888', '+55 (34) 99999-8888', '5534999998888@c.us', '55-34-9999-8888', ' 34 99999 8888 ',
    ]) {
      expect(await cedeAAgente(f), f).toBe(true);
      expect(await agenteAtendeEste('duda', f), f).toBe(true);
    }
    // a posse foi lida SEMPRE pela chave de 10 dígitos
    const chaves = new Set(leiturasDe('whatsapp_sessions').map(c => c.chave));
    expect([...chaves]).toEqual([CHAVE_X]);
  });

  it('o mesmo DDD com outros 8 dígitos não casa; telefone sem chave (curto, grupo, LID, vazio) é false e nunca lança', async () => {
    liberar('duda', 'helena', 'carla');
    env({ DUDA: '1', HELENA: '1', CARLA: '1' });
    alvo({ hmacs: [], modos: { duda: 'todos', helena: 'todos', carla: 'todos' } });
    for (const t of ['123', '', null, undefined, '120363000000000000', 'lid:123456789012345', 'abc']) {
      expect(await cedeAAgente(t as any), String(t)).toBe(false);
      expect(await agenteAtendeEste('duda', t as any), String(t)).toBe(false);
    }
    expect(leiturasDe('whatsapp_sessions')).toEqual([]);
  });
});

describe('cedeAAgente: falhas', () => {
  it('erro ao ler o alvo: a agente não atende (false) e a posse não é lida', async () => {
    env({ DUDA: '1' });
    posse();
    h.estado.falhar = [{ tabela: 'system_state', key: CHAVE_VIVO_ALVO }];
    expect(await cedeAAgente(X)).toBe(false);
    expect(await agenteAtendeEste('duda', X)).toBe(false);
    expect(leiturasDe('whatsapp_sessions')).toEqual([]);
  });

  it('erro ao ler a posse COM o lead no escopo: true, e o log leva só o código (nunca o telefone)', async () => {
    env({ DUDA: '1' });
    alvo();
    h.estado.falhar = [{ tabela: 'whatsapp_sessions', code: '57014' }];
    expect(await cedeAAgente(X)).toBe(true);
    const saida = JSON.stringify(erroConsole.mock.calls);
    expect(saida).toContain('57014');
    expect(saida).not.toContain('99999');
    expect(saida).not.toContain('8888');
  });

  it('erro ao ler a posse com o lead FORA do escopo: false, e a posse nem é lida', async () => {
    env({ DUDA: '1' });
    alvo();
    h.estado.falhar = [{ tabela: 'whatsapp_sessions', code: '57014' }];
    expect(await cedeAAgente(Y)).toBe(false);
    expect(leiturasDe('whatsapp_sessions')).toEqual([]);
  });

  it('kid trocado: os hmacs antigos não casam e ninguém está em teste (falha segura); modo todos (dona liberada) segue valendo', async () => {
    liberar('duda');
    env({ DUDA: '1', HELENA: '1' });
    alvo({ kid: 'deadbeef' });
    posse();
    expect(await agenteAtendeEste('duda', X)).toBe(false);
    expect(await cedeAAgente(X)).toBe(false);
    zerarCacheInterruptores();
    h.estado.tabelas.system_state = [];
    alvo({ kid: 'deadbeef', modos: { duda: 'todos' } });
    expect(await agenteAtendeEste('duda', X)).toBe(true);
    expect(await agenteAtendeEste('helena', X)).toBe(false);
  });

  it('sem segredo de HMAC nenhum: nada casa em modo teste e nada lança', async () => {
    env({ DUDA: '1' });
    alvo();
    delete process.env.AGENTES5040_HMAC;
    const servico = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      expect(await agenteAtendeEste('duda', X)).toBe(false);
      expect(await cedeAAgente(X)).toBe(false);
    } finally {
      if (servico !== undefined) process.env.SUPABASE_SERVICE_KEY = servico;
    }
  });

  it('posse com dado ilegível no escopo: trata como erro de leitura (true)', async () => {
    env({ DUDA: '1' });
    alvo();
    semear('whatsapp_sessions', { phone: CHAVE_X, tipo: 'ag5040', lead_data: { dona: '???', estado: 'viva' } });
    expect(await cedeAAgente(X)).toBe(true);
  });
});

describe('lerPosse, assumirPosse e atualizarPosse', () => {
  it('assumirPosse é INSERT: a primeira assume, a segunda devolve ja_tinha_dona e não muda a dona', async () => {
    expect(await assumirPosse('5534999998888', 'duda', 42)).toBe('assumida');
    expect(h.estado.tabelas.whatsapp_sessions![0]).toMatchObject({ phone: CHAVE_X, tipo: 'ag5040' });
    expect(await assumirPosse(X, 'helena', 43)).toBe('ja_tinha_dona');
    expect(await lerPosse(X)).toMatchObject({ dona: 'duda', estado: 'viva', ate_wa_id: 42, respostas: 0, imagens: [], links: [] });
    expect(h.estado.tabelas.whatsapp_sessions).toHaveLength(1);
  });

  it('erro de banco no insert = erro (não ja_tinha_dona), e telefone sem chave = erro', async () => {
    h.estado.falhar = [{ tabela: 'whatsapp_sessions', op: 'insert', code: '08006' }];
    expect(await assumirPosse(X, 'duda', 1)).toBe('erro');
    expect(await assumirPosse('123', 'duda', 1)).toBe('erro');
    expect(JSON.stringify(erroConsole.mock.calls)).not.toContain('99999');
  });

  it('atualizarPosse muda só o pedido (troca de dona, estado, contadores) e mantém o resto', async () => {
    await assumirPosse(X, 'duda', 1);
    expect(await atualizarPosse(X, { dona: 'helena' })).toBe(true);
    expect(await atualizarPosse('5534999998888', { ate_wa_id: 9, respostas: 3, estado: 'passou_humano' })).toBe(true);
    expect(await lerPosse(X)).toMatchObject({ dona: 'helena', estado: 'passou_humano', ate_wa_id: 9, respostas: 3 });
    expect(await atualizarPosse(Y, { dona: 'carla' })).toBe(false);   // sem posse
    expect(await atualizarPosse(X, { estado: 'inventado' as any })).toBe(false);
  });

  it('lerPosse: sem posse é null; erro de banco lança; chave inválida é null', async () => {
    expect(await lerPosse(X)).toBeNull();
    expect(await lerPosse('123')).toBeNull();
    h.estado.falhar = [{ tabela: 'whatsapp_sessions', code: '57014' }];
    await expect(lerPosse(X)).rejects.toThrow('57014');
  });
});
