import { describe, it, expect, vi, beforeEach } from 'vitest';

// O ALERTA DE 10 MINUTOS — E OS QUATRO JEITOS DE ELE DAR ERRADO.
//
// Ele existe porque o Thiago pediu (03/09): "aviso 10 minutos antes da reunião
// agendada confirmada, cheia de emojis de alerta, só para confirmados, não
// podemos perder nada". O risco não é o envio — é o que cerca:
//
//   · REPETIR. O tick roda de 5 em 5 min e a janela tem 13. Sem dedup, a mesma
//     reunião gritaria duas ou três vezes. Alerta repetido é como a régua de
//     1 hora morreu em 25/07, e esta morreria igual.
//   · TOCAR PRA QUEM NÃO CONFIRMOU. Aí volta a ser o ping antigo, com o mesmo
//     barulho e o mesmo destino.
//   · ACORDAR O CONSULTOR ERRADO. O alerta da call do Diego no WhatsApp do
//     Thiago é ruído puro.
//   · SUMIR NUM ERRO DE ENVIO. Falhou? não carimba, e o próximo tick tenta.

const enviados: Array<{ numero: string; texto: string }> = [];
let falharEnvio = false;

let fichas: any[] = [];
const carimbos = new Map<string, any>();

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _naoNulo: null as string | null,
        _gte: null as string | null,
        _lte: null as string | null,
        _status: null as string | null,
        select() { return q; },
        eq(col: string, v: any) { if (col === 'status') q._status = v; return q; },
        not(col: string, _op: string, _v: any) { q._naoNulo = col; return q; },
        gte(_c: string, v: string) { q._gte = v; return q; },
        lte(_c: string, v: string) { q._lte = v; return q; },
        limit() {
          const out = fichas.filter(f =>
            (!q._status || f.status === q._status)
            && (!q._naoNulo || f[q._naoNulo] != null)
            && (!q._gte || f.quando >= q._gte)
            && (!q._lte || f.quando <= q._lte));
          return Promise.resolve({ data: out, error: null });
        },
      };
      return q;
    },
  },
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select() { return q; },
        in(_col: string, chaves: string[]) {
          return Promise.resolve({
            data: chaves.filter(k => carimbos.has(k)).map(k => ({ key: k, value: carimbos.get(k) })),
            error: null,
          });
        },
        upsert(linha: any) {
          carimbos.set(linha.key, linha.value);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
  },
}));

vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: (numero: string, texto: string) => {
    if (falharEnvio) return Promise.reject(new Error('linha caiu'));
    enviados.push({ numero, texto });
    return Promise.resolve({ ok: true });
  },
}));

// O cadastro do CRM: é dele que sai o telefone do dono da reunião.
vi.mock('../services/io/eletropostoAgenda', async (original) => {
  const real = await original<typeof import('../services/io/eletropostoAgenda')>();
  return {
    ...real,
    carregarConsultores: () => Promise.resolve(new Map([
      ['Thiago', '5534991360223'],
      ['Diego', '5534991360172'],
    ])),
  };
});

import { runEletropostoAlerta10minTick } from '../services/io/eletropostoAlerta10min';

const AGORA = new Date('2026-09-08T17:00:00-03:00').getTime();
const daquiA = (min: number) => new Date(AGORA + min * 60_000).toISOString();

function ficha(over: Partial<Record<string, any>> = {}) {
  return {
    id: 1,
    vendedor_nome: 'Diego',
    quando: daquiA(10),
    cliente_nome: 'Marcelo Berwerth',
    cliente_telefone: '5516997710422',
    status: 'agendado',
    presenca_confirmada_at: '2026-09-08T12:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  enviados.length = 0;
  carimbos.clear();
  falharEnvio = false;
  delete process.env.EP_ALERTA_10MIN_OFF;
});

describe('alerta de 10 minutos', () => {
  it('reunião confirmada a 10 min: manda, e manda gritando', async () => {
    fichas = [ficha()];
    const r = await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(r.enviados).toBe(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('🚨');
    expect(enviados[0].texto).toContain('REUNIÃO CONFIRMADA EM 10 MINUTOS');
    expect(enviados[0].texto).toContain('Marcelo Berwerth');
  });

  it('roda de novo no tick seguinte e NÃO repete', async () => {
    fichas = [ficha()];
    await runEletropostoAlerta10minTick({ agora: AGORA });
    const r2 = await runEletropostoAlerta10minTick({ agora: AGORA + 5 * 60_000 });
    expect(r2.enviados).toBe(0);
    expect(r2.motivo).toBe('todas_ja_avisadas');
    expect(enviados).toHaveLength(1);
  });

  it('vai pro dono da reunião, não pros dois', async () => {
    fichas = [ficha({ vendedor_nome: 'Diego' })];
    await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(enviados.map(e => e.numero)).toEqual(['5534991360172']);
  });

  it('sem presença confirmada, silêncio', async () => {
    fichas = [ficha({ presenca_confirmada_at: null })];
    const r = await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(r.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('confirmada mas ainda longe (40 min), silêncio', async () => {
    fichas = [ficha({ quando: daquiA(40) })];
    const r = await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(r.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('confirmada e cancelada não alerta ninguém', async () => {
    fichas = [ficha({ status: 'cancelado' })];
    const r = await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(r.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('envio falhou: não carimba, e o próximo tick manda', async () => {
    fichas = [ficha()];
    falharEnvio = true;
    const r1 = await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(r1.enviados).toBe(0);
    expect(r1.erros).toBe(1);

    falharEnvio = false;
    const r2 = await runEletropostoAlerta10minTick({ agora: AGORA + 5 * 60_000 });
    expect(r2.enviados).toBe(1);
    expect(enviados).toHaveLength(1);
  });

  it('remarcou para outro horário: alerta de novo, porque é outra reunião', async () => {
    fichas = [ficha()];
    await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(enviados).toHaveLength(1);

    // O robô de remarcação (ou o repasse de 12h) mexeu no `quando`.
    const depois = AGORA + 3 * 3600_000;
    fichas = [ficha({ quando: new Date(depois + 10 * 60_000).toISOString() })];
    const r = await runEletropostoAlerta10minTick({ agora: depois });
    expect(r.enviados).toBe(1);
    expect(enviados).toHaveLength(2);
  });

  it('kill-switch cala tudo', async () => {
    process.env.EP_ALERTA_10MIN_OFF = '1';
    fichas = [ficha()];
    const r = await runEletropostoAlerta10minTick({ agora: AGORA });
    expect(r.motivo).toBe('desligado');
    expect(enviados).toHaveLength(0);
  });

  it('dry decide igual e não manda nem carimba', async () => {
    fichas = [ficha()];
    const r = await runEletropostoAlerta10minTick({ agora: AGORA, dry: true });
    expect(r.previa).toHaveLength(1);
    expect(r.previa?.[0].faltam_min).toBe(10);
    expect(enviados).toHaveLength(0);
    expect(carimbos.size).toBe(0);
  });
});
