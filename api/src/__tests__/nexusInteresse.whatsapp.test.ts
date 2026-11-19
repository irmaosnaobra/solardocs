import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// verificaWhatsapp.ts, condições do chefe-antiban: 1 consulta por telefone, teto, linha, prazo, faxina, nada enviado.
const h = vi.hoisted(() => {
  const envios: Record<string, any> = {};
  for (const n of ['sendWhatsApp', 'sendFrio', 'sendHuman', 'sendZAPI', 'sendImage', 'sendDocument', 'sendAudio', 'sendVideo', 'sendSticker', 'sendToGroup', 'zapiPost']) {
    envios[n] = vi.fn();
  }
  return {
    envios,
    estado: new Map<string, { value: any; updated_at: string }>(),
    eventos: [] as string[],
    consultas: [] as string[],
    linha: null as { whatsapp_ok: boolean | null } | null,
    lookups: [] as Array<{ tabela: string; coluna: string; valor: string }>,
    aoInserir: null as null | (() => void),
    insertErro: null as any,
    contagemErro: null as any,
    consulta: (async () => 'sim') as (tel: string) => Promise<'sim' | 'nao' | 'erro'>,
    cooldown: false,
    caida: false,
    rampa: null as null | { hora: number; dia: number },
  };
});

function construtor(modo: 'select' | 'delete', opts?: { head?: boolean }) {
  const filtros: Array<(k: string, r: { updated_at: string }) => boolean> = [];
  const casadas = () => [...h.estado.entries()].filter(([k, r]) => filtros.every((f) => f(k, r)));
  const q: any = {
    like: (_c: string, p: string) => { filtros.push((k) => k.startsWith(p.replace(/%$/, ''))); return q; },
    gte: (_c: string, v: string) => { filtros.push((_k, r) => r.updated_at >= v); return q; },
    lt: (_c: string, v: string) => { filtros.push((_k, r) => r.updated_at < v); return q; },
    eq: (_c: string, v: string) => { filtros.push((k) => k === v); return q; },
    maybeSingle: () => {
      const a = casadas()[0];
      return Promise.resolve({ data: a ? { value: a[1].value, updated_at: a[1].updated_at } : null, error: null });
    },
    then: (ok: any, ko: any) => {
      if (modo === 'delete') {
        h.eventos.push('delete');
        for (const [k] of casadas()) h.estado.delete(k);
        return Promise.resolve({ error: null }).then(ok, ko);
      }
      h.eventos.push('contagem');
      return Promise.resolve(
        h.contagemErro ? { count: null, error: h.contagemErro } : { count: opts?.head ? casadas().length : null, error: null },
      ).then(ok, ko);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'system_state') {
        // Tabela do cadastro: confere a coluna e o valor do .eq (telefone cru, como veio).
        return {
          select: () => ({
            eq: (coluna: string, valor: string) => {
              h.lookups.push({ tabela: t, coluna, valor });
              return { maybeSingle: () => Promise.resolve({ data: h.linha, error: null }) };
            },
          }),
        };
      }
      return {
        insert: (row: { key: string; value: any; updated_at: string }) => {
          h.eventos.push('insert');
          if (h.insertErro) return Promise.resolve({ error: h.insertErro });
          if (h.estado.has(row.key)) return Promise.resolve({ error: { code: '23505' } });
          h.estado.set(row.key, { value: row.value, updated_at: row.updated_at });
          h.aoInserir?.();
          return Promise.resolve({ error: null });
        },
        update: (v: { value: any }) => ({
          eq: (_c: string, key: string) => {
            h.eventos.push('update');
            const r = h.estado.get(key);
            if (r) r.value = v.value;
            return Promise.resolve({ error: null });
          },
        }),
        delete: () => construtor('delete'),
        select: (_c: string, o?: { head?: boolean }) => construtor('select', o),
      };
    },
  },
}));
vi.mock('../services/agents/zapiClient', async (orig) => ({
  ...(await orig<any>()),
  ...h.envios,
  linhaEmCooldown: () => h.cooldown,
  numeroTemWhatsApp: (tel: string) => { h.eventos.push('consulta'); h.consultas.push(tel); return h.consulta(tel); },
}));
vi.mock('../services/gerador/caixaWhatsapp', async (orig) => ({
  ...(await orig<any>()),
  estadoDaLinha: () => ({ estado: h.caida ? 'caida' : 'conectada', leitura_em: null, ultima_conexao: null }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async (orig) => ({
  ...(await orig<any>()),
  rampaReconexaoVigente: async () => h.rampa,
}));

import { verificarWhatsapp, telefoneCanonico } from '../services/nexus/verificaWhatsapp';
import { hmacDe } from '../services/agentes5040/hmac';

const TEL = '5534999990001';
const TEL_SEM_9 = '553499990001';
const TABELA = 'nexus_instagram_interesse';
const whatsappDoCadastro = async (t: string) => (await verificarWhatsapp(t, { tabela: TABELA })).whatsappOk;
const CHAVE = () => `nexus_pe:${hmacDe(telefoneCanonico(TEL))}`;
const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function encher(n: number, minutos: number, prefixo = 'nexus_pe:outro') {
  for (let i = 0; i < n; i++) h.estado.set(`${prefixo}${i}`, { value: { r: 'sim' }, updated_at: minutosAtras(minutos) });
}

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'chave-de-teste';
  h.estado.clear();
  h.eventos.length = 0;
  h.consultas.length = 0;
  h.linha = null;
  h.lookups.length = 0;
  h.aoInserir = null;
  h.insertErro = null;
  h.contagemErro = null;
  h.consulta = async () => 'sim';
  h.cooldown = false;
  h.caida = false;
  h.rampa = null;
});
afterEach(() => {
  // Condição 6: nada sai por WhatsApp, em nenhum cenário: zero chamadas em todas as funções de envio.
  for (const [nome, fn] of Object.entries(h.envios)) expect(fn, nome).not.toHaveBeenCalled();
  vi.useRealTimers();
  delete process.env.AGENTES5040_HMAC;
});

describe('whatsappDoCadastro: a consulta', () => {
  it('sim grava true; o INSERT da chave vem ANTES da consulta e a chave não leva o telefone', async () => {
    expect(await whatsappDoCadastro(TEL)).toBe(true);
    expect(h.eventos.filter((e) => e === 'insert' || e === 'consulta')).toEqual(['insert', 'consulta']);
    expect(h.consultas).toEqual([TEL]);
    const chaves = [...h.estado.keys()];
    expect(chaves).toEqual([CHAVE()]);
    expect(chaves[0]).toMatch(/^nexus_pe:[0-9a-f]{64}$/);
    expect(JSON.stringify([...h.estado.entries()])).not.toContain(TEL);
    expect(h.estado.get(CHAVE())!.value.r).toBe('sim');
  });

  it('nao grava false', async () => {
    h.consulta = async () => 'nao';
    expect(await whatsappDoCadastro(TEL)).toBe(false);
    expect(h.estado.get(CHAVE())!.value.r).toBe('nao');
  });

  it('erro da consulta grava null, e a vaga fica gasta', async () => {
    h.consulta = async () => 'erro';
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.estado.get(CHAVE())!.value.r).toBe('erro');
  });

  it('consulta que lança também é null', async () => {
    h.consulta = async () => { throw new Error('rede'); };
    expect(await whatsappDoCadastro(TEL)).toBeNull();
  });

  it('prazo de 4 s: consulta que não volta vira null', async () => {
    vi.useFakeTimers();
    h.consulta = () => new Promise(() => {});
    const p = whatsappDoCadastro(TEL);
    await vi.advanceTimersByTimeAsync(3900);
    expect(h.estado.get(CHAVE())!.value.r).toBe('pendente');
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toBeNull();
    expect(h.estado.get(CHAVE())!.value.r).toBe('erro');
  });

  it('23505 reaproveita o resultado guardado e não consulta de novo', async () => {
    h.consulta = async () => 'nao';
    expect(await whatsappDoCadastro(TEL)).toBe(false);
    h.consulta = async () => 'sim'; // se consultasse de novo, daria true
    expect(await whatsappDoCadastro(TEL)).toBe(false);
    expect(h.consultas).toHaveLength(1);
  });

  it('23505 com a consulta ainda pendente ou com erro guardado é null, sem nova consulta', async () => {
    h.estado.set(CHAVE(), { value: { r: 'pendente' }, updated_at: minutosAtras(0) });
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    h.estado.set(CHAVE(), { value: { r: 'erro' }, updated_at: minutosAtras(0) });
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });

  it('INSERT com erro que não é 23505 não consulta', async () => {
    h.insertErro = { code: 'XX000' };
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });

  it('sem chave de HMAC não há como guardar o telefone: não consulta', async () => {
    process.env.AGENTES5040_HMAC = '';
    const antes = process.env.SUPABASE_SERVICE_KEY;
    process.env.SUPABASE_SERVICE_KEY = '';
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    process.env.SUPABASE_SERVICE_KEY = antes;
    expect(h.consultas).toHaveLength(0);
    expect(h.estado.size).toBe(0);
  });
});

describe('whatsappDoCadastro: quando não consulta', () => {
  it.each([true, false])('linha já na tabela com whatsapp_ok %s: usa o que está lá', async (ok) => {
    h.linha = { whatsapp_ok: ok };
    expect(await whatsappDoCadastro(TEL)).toBe(ok);
    expect(h.lookups).toEqual([{ tabela: TABELA, coluna: 'telefone', valor: TEL }]);
    expect(h.consultas).toHaveLength(0);
    expect(h.estado.size).toBe(0);
  });

  it('linha na tabela com whatsapp_ok null ainda consulta', async () => {
    h.linha = { whatsapp_ok: null };
    expect(await whatsappDoCadastro(TEL)).toBe(true);
    expect(h.consultas).toHaveLength(1);
  });

  it('linha em cooldown, linha caída (monitor) ou em rampa: null, sem consulta nem vaga gasta', async () => {
    h.cooldown = true;
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    h.cooldown = false;
    h.caida = true;
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    h.caida = false;
    h.rampa = { hora: 1, dia: 1 };
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
    expect(h.estado.size).toBe(0);
  });

  it('teto de 10 em 10 min: o 11º não consulta; com 9 ainda consulta', async () => {
    encher(9, 2);
    expect(await whatsappDoCadastro(TEL)).toBe(true);
    h.estado.delete(CHAVE());
    h.consultas.length = 0;
    encher(1, 2, 'nexus_pe:extra');
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
    expect(h.estado.has(CHAVE())).toBe(false);
  });

  it('janelas que PRECISAM consultar: 10 chaves de 11 min, 30 de 61 min e 200 de 25 h atrás', async () => {
    for (const [n, minutos] of [[10, 11], [30, 61], [200, 25 * 60]] as const) {
      h.estado.clear();
      h.consultas.length = 0;
      encher(n, minutos);
      expect(await whatsappDoCadastro(TEL), `${n} chaves de ${minutos} min`).toBe(true);
      expect(h.consultas).toHaveLength(1);
    }
  });

  it('corrida: a contagem passa do teto depois de reservar, então solta a própria chave e não consulta', async () => {
    h.aoInserir = () => encher(10, 0, 'nexus_pe:corrida'); // 10 pedidos simultâneos entraram junto
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
    expect(h.estado.has(CHAVE())).toBe(false);
    expect(h.estado.size).toBe(10);
  });

  it('teto de 30 em 1 h', async () => {
    encher(30, 30);
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });

  it('teto de 200 em 24 h', async () => {
    encher(200, 600);
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });

  it('chave de outro prefixo não entra na contagem do teto', async () => {
    encher(200, 2, 'ag5040_ia:vivo:2026-11-19:');
    expect(await whatsappDoCadastro(TEL)).toBe(true);
  });

  it('erro ao contar o teto não consulta', async () => {
    h.contagemErro = { code: 'XX000' };
    expect(await whatsappDoCadastro(TEL)).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });
});

describe('whatsappDoCadastro: faxina própria', () => {
  it('a cada consulta apaga nexus_pe:* com mais de 48 h e mexe só nelas', async () => {
    h.estado.set('nexus_pe:velha', { value: { r: 'sim' }, updated_at: minutosAtras(49 * 60) });
    h.estado.set('nexus_pe:recente', { value: { r: 'sim' }, updated_at: minutosAtras(47 * 60) });
    h.estado.set('ag5040_ia:vivo:x', { value: {}, updated_at: minutosAtras(100 * 60) });
    await whatsappDoCadastro(TEL);
    expect([...h.estado.keys()].sort()).toEqual(['ag5040_ia:vivo:x', CHAVE(), 'nexus_pe:recente'].sort());
  });

  it.each(['23505', 'teto', 'linha caída'])('sem consulta (%s), não há faxina', async (motivo) => {
    h.estado.set('nexus_pe:velha', { value: { r: 'sim' }, updated_at: minutosAtras(49 * 60) });
    if (motivo === '23505') h.estado.set(CHAVE(), { value: { r: 'sim' }, updated_at: minutosAtras(1) });
    if (motivo === 'teto') encher(200, 2);
    if (motivo === 'linha caída') h.caida = true;
    await whatsappDoCadastro(TEL);
    expect(h.consultas).toHaveLength(0);
    expect(h.estado.has('nexus_pe:velha')).toBe(true);
  });
});

describe('mesmo número com e sem o 9', () => {
  it('forma canônica: 55 + DDD + 8 últimos dígitos, só para a chave', () => {
    expect(telefoneCanonico(TEL)).toBe('553499990001');
    expect(telefoneCanonico(TEL_SEM_9)).toBe('553499990001');
    expect(telefoneCanonico('55 (34) 99999-0001')).toBe('553499990001');
  });

  it.each([[TEL, TEL_SEM_9], [TEL_SEM_9, TEL]])('%s e depois %s gastam UMA consulta só, com o telefone como veio', async (a, b) => {
    h.consulta = async () => 'nao';
    expect(await whatsappDoCadastro(a)).toBe(false);
    expect(await whatsappDoCadastro(b)).toBe(false);
    expect(h.consultas).toEqual([a]);
    expect([...h.estado.keys()]).toEqual([CHAVE()]);
  });
});

describe('verificarWhatsapp: a assinatura que outra rota reaproveita', () => {
  it('devolve { whatsappOk, aviso } e só traz aviso no não', async () => {
    h.consulta = async () => 'nao';
    expect(await verificarWhatsapp(TEL)).toEqual({ whatsappOk: false, aviso: 'sem_whatsapp' });
    h.estado.clear();
    h.consulta = async () => 'sim';
    expect(await verificarWhatsapp(TEL)).toEqual({ whatsappOk: true });
    h.estado.clear();
    h.consulta = async () => 'erro';
    expect(await verificarWhatsapp(TEL)).toEqual({ whatsappOk: null });
  });

  it('o que já está guardado como não também devolve o aviso; sem tabela, nenhuma leitura de tabela', async () => {
    h.linha = { whatsapp_ok: true }; // sem `tabela` isto nem é lido
    h.estado.set(CHAVE(), { value: { r: 'nao' }, updated_at: minutosAtras(1) });
    expect(await verificarWhatsapp(TEL)).toEqual({ whatsappOk: false, aviso: 'sem_whatsapp' });
    expect(h.lookups).toEqual([]);
    expect(h.consultas).toHaveLength(0);
  });
});
