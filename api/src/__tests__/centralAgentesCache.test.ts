import { describe, it, expect, vi } from 'vitest';
import { criarCacheDeMontagem } from '../services/io/centralAgentesCache';

// Cache da rota pública GET /gerador/agentes. Relógio e montagem são dublês:
// nada espera 60 s de verdade.

function bancada(montar: (n: number) => Promise<unknown>) {
  let t = 1_000_000;
  let chamadas = 0;
  const avisos: number[] = [];
  const obter = criarCacheDeMontagem(
    () => montar(++chamadas),
    { agora: () => t, aoServirAntigo: (_e, idade) => avisos.push(idade) },
  );
  return {
    obter,
    avanca: (ms: number) => { t += ms; },
    get chamadas() { return chamadas; },
    avisos,
  };
}

describe('cache da Central das Agentes', () => {
  it('duas chamadas seguidas montam uma vez só', async () => {
    const b = bancada(async n => ({ n }));
    const a = await b.obter();
    const c = await b.obter();
    expect(b.chamadas).toBe(1);
    expect(c).toBe(a);
  });

  it('dentro dos 60 s reaproveita; depois de 60 s monta de novo', async () => {
    const b = bancada(async n => ({ n }));
    expect(await b.obter()).toEqual({ n: 1 });
    b.avanca(59_999);
    expect(await b.obter()).toEqual({ n: 1 });
    expect(b.chamadas).toBe(1);
    b.avanca(1);
    expect(await b.obter()).toEqual({ n: 2 });
    expect(b.chamadas).toBe(2);
  });

  it('chamadas simultâneas montam uma vez só e dividem a mesma resposta', async () => {
    let solta!: (v: unknown) => void;
    const b = bancada(() => new Promise(r => { solta = r; }));
    const todas = [b.obter(), b.obter(), b.obter(), b.obter()];
    expect(b.chamadas).toBe(1);
    solta({ ok: true });
    const res = await Promise.all(todas);
    expect(b.chamadas).toBe(1);
    expect(res.every(r => r === res[0])).toBe(true);
  });

  it('falha com cópia antiga (até 5 min) entrega a antiga, avisa e não guarda o erro', async () => {
    const b = bancada(async n => { if (n === 2) throw new Error('banco caiu'); return { n }; });
    expect(await b.obter()).toEqual({ n: 1 });
    b.avanca(61_000);
    expect(await b.obter()).toEqual({ n: 1 });   // a 2ª montagem falhou
    expect(b.avisos).toEqual([61_000]);
    expect(b.chamadas).toBe(2);
    // o erro não ficou guardado: a chamada seguinte tenta de novo e pega o novo
    expect(await b.obter()).toEqual({ n: 3 });
    expect(b.chamadas).toBe(3);
  });

  it('falha com a cópia antiga já passada de 5 min repassa o erro', async () => {
    const b = bancada(async n => { if (n >= 2) throw new Error('banco caiu'); return { n }; });
    await b.obter();
    b.avanca(5 * 60_000);
    await expect(b.obter()).rejects.toThrow('banco caiu');
    expect(b.avisos).toEqual([]);
  });

  it('falha sem nenhuma cópia repassa o erro, e a chamada seguinte tenta de novo', async () => {
    const b = bancada(async n => { if (n === 1) throw new Error('primeira falhou'); return { n }; });
    await expect(b.obter()).rejects.toThrow('primeira falhou');
    expect(await b.obter()).toEqual({ n: 2 });
    expect(b.chamadas).toBe(2);
  });

  it('falha simultânea: todos os que esperavam recebem a cópia antiga, com uma montagem só', async () => {
    let rejeita!: (e: Error) => void;
    let n = 0;
    const b = bancada(() => (++n === 1 ? Promise.resolve({ n: 1 }) : new Promise((_r, rej) => { rejeita = rej; })));
    await b.obter();
    b.avanca(61_000);
    const todas = [b.obter(), b.obter(), b.obter()];
    rejeita(new Error('x'));
    expect(await Promise.all(todas)).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
    expect(b.chamadas).toBe(2);
  });

  it('montagem que lança de forma síncrona não trava as chamadas seguintes', async () => {
    let chamou = 0;
    const obter = criarCacheDeMontagem((): Promise<unknown> => {
      if (++chamou === 1) throw new Error('síncrono');
      return Promise.resolve({ ok: 1 });
    });
    await expect(obter()).rejects.toThrow('síncrono');
    expect(await obter()).toEqual({ ok: 1 });
  });

  it('usa Date.now por padrão (relógio falso do vitest)', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const obter = criarCacheDeMontagem(async () => ({ n: ++n }));
      expect(await obter()).toEqual({ n: 1 });
      vi.advanceTimersByTime(60_001);
      expect(await obter()).toEqual({ n: 2 });
    } finally { vi.useRealTimers(); }
  });
});
