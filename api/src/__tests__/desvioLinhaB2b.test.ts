import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Desvio da linha B2B pra linha IO (ZAPI_SOLARDOC_VIA_IO=1).
//
// O que este teste tranca: quando a Giovanna/curso R$19 passam a sair pelo MESMO
// número da Bia e do followup do gerador, os dois tetos anti-ban têm que virar UM.
// Se cada um contar só o seu, a linha manda 12/h + 4/h e toma ban — que é
// exatamente como a linha IO caiu em 01/ago/2026.

const db: { state: Array<{ key: string; updated_at: string }> } = { state: [] };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _filtros: [] as Array<(r: any) => boolean>,
        select() { return q; },
        like(col: string, padrao: string) {
          const pref = padrao.replace(/%$/, '');
          q._filtros.push((r: any) => String(r[col]).startsWith(pref));
          return q;
        },
        // orFilter do lineThrottle: "key.like.limpapro_recovery:%,key.like.gerador_followup:%"
        or(expr: string) {
          const prefixos = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
          q._filtros.push((r: any) => prefixos.some(p => String(r.key).startsWith(p)));
          return q;
        },
        gte(col: string, val: string) { q._filtros.push((r: any) => String(r[col]) >= val); return q; },
        limit(n: number) {
          const linhas = db.state.filter(r => q._filtros.every((f: any) => f(r))).slice(0, n);
          return Promise.resolve({ data: linhas, error: null });
        },
      };
      return q;
    },
  },
}));

const agora = () => new Date().toISOString();
function semear(prefixo: string, quantos: number) {
  for (let i = 0; i < quantos; i++) db.state.push({ key: `${prefixo}user${i}`, updated_at: agora() });
}

const envOriginal = { ...process.env };
beforeEach(() => { db.state = []; vi.resetModules(); });
afterEach(() => { process.env = { ...envOriginal }; });

async function tetos() {
  const carla = await import('../services/agents/whatsapp/carlaThrottle');
  const linha = await import('../services/agents/whatsapp/lineThrottle');
  return { carla, linha };
}

describe('desvio da linha B2B pra linha IO', () => {
  it('sem a env var, cada linha conta só o seu — a Carla não vê a Bia', async () => {
    delete process.env.ZAPI_SOLARDOC_VIA_IO;
    semear('limpapro_recovery:', 12);   // linha IO cheia
    const { carla, linha } = await tetos();

    expect(await carla.dentroDoTetoCarla()).toBe(true);          // B2B é outro número
    expect(await linha.dentroDoTetoHorarioLinha()).toBe(false);  // IO estourou
  });

  it('sem a env var, envio da Carla NÃO consome o teto da linha IO', async () => {
    delete process.env.ZAPI_SOLARDOC_VIA_IO;
    semear('carla_sent:', 12);
    const { linha } = await tetos();

    expect(await linha.dentroDoTetoHorarioLinha()).toBe(true);
  });

  it('com a env var, a Carla respeita o teto da linha IO (não soma por cima)', async () => {
    process.env.ZAPI_SOLARDOC_VIA_IO = '1';
    semear('limpapro_recovery:', 12);   // a Bia já encheu a linha
    const { carla } = await tetos();

    expect(await carla.dentroDoTetoCarla()).toBe(false);
  });

  it('com a env var, o envio da Carla passa a ocupar o teto da linha IO', async () => {
    process.env.ZAPI_SOLARDOC_VIA_IO = '1';
    semear('carla_sent:', 12);
    const { linha } = await tetos();

    expect(await linha.dentroDoTetoHorarioLinha()).toBe(false);
  });

  it('com a env var e linha vazia, a Carla continua limitada aos 4/h dela', async () => {
    process.env.ZAPI_SOLARDOC_VIA_IO = '1';
    semear('carla_sent:', 4);           // teto próprio da Carla estourado, linha ainda com folga
    const { carla, linha } = await tetos();

    expect(await carla.dentroDoTetoCarla()).toBe(false);
    expect(await linha.dentroDoTetoHorarioLinha()).toBe(true);
  });

  it('o envio pedido pra solardoc só vira io com a env var ligada', async () => {
    delete process.env.ZAPI_SOLARDOC_VIA_IO;
    const semDesvio = await import('../services/agents/zapiClient');
    expect(semDesvio.solardocViaIo()).toBe(false);

    vi.resetModules();
    process.env.ZAPI_SOLARDOC_VIA_IO = '1';
    const comDesvio = await import('../services/agents/zapiClient');
    expect(comDesvio.solardocViaIo()).toBe(true);
  });
});
