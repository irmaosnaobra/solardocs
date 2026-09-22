import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// FOLLOW-UP DE RETORNO de quem perdeu o horário na régua do SIM. Os riscos:
//   1. chamar de volta quem JÁ voltou (a pior: a pessoa tem reunião marcada e
//      recebe uma lista de horários novos, como se não tivesse);
//   2. chamar quem está conversando com o consultor agora;
//   3. contar rodada que não saiu, e com isso queimar a última chance em
//      silêncio;
//   4. rajada: 18 liberados virando 18 ofertas no mesmo minuto.

let estado: Array<{ key: string; value?: any; updated_at?: string }> = [];
let fichas: any[] = [];
const ofertados: Array<{ id: number; rodada: number | undefined; copy: string }> = [];
let resultadoOferta: any = { acao: 'ofertou', ofertas: ['a', 'b', 'c'] };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _like: null as string | null,
        select() { return q; },
        like(_c: string, v: string) { q._like = String(v).replace(/%$/, ''); return q; },
        limit() { return Promise.resolve({ data: estado.filter(e => e.key.startsWith(q._like || '')), error: null }); },
        insert(linha: any) {
          if (estado.some(e => e.key === linha.key)) return Promise.resolve({ error: { code: '23505' } });
          estado.push(linha);
          return Promise.resolve({ error: null });
        },
        upsert(linha: any) {
          const i = estado.findIndex(e => e.key === linha.key);
          if (i >= 0) estado[i] = linha; else estado.push(linha);
          return Promise.resolve({ error: null });
        },
        delete() {
          return { eq: (_c: string, v: string) => { estado = estado.filter(e => e.key !== v); return Promise.resolve({ error: null }); } };
        },
      };
      return q;
    },
  },
}));

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        select() { return q; },
        in(_c: string, ids: number[]) {
          return Promise.resolve({ data: fichas.filter(f => ids.includes(f.id)), error: null });
        },
      };
      return q;
    },
  },
}));

vi.mock('../services/io/eletropostoRemarcar', () => ({
  ofertarPorConta: async (ficha: any, copy: any, opts: any) => {
    ofertados.push({ id: ficha.id, rodada: opts?.rodada, copy: copy.name });
    return resultadoOferta;
  },
  bolhasRetorno1: function bolhasRetorno1() { return []; },
  bolhasRetorno2: function bolhasRetorno2() { return []; },
}));

vi.mock('../utils/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

import { runEletropostoRetornoTick, rodadaDevida, EP_RETORNO_PREFIX } from '../services/io/eletropostoRetorno';
import { EP_LIBERADO_PREFIX } from '../services/io/eletropostoCobraSim';

/** 23/09/2026, 10h de Brasília: dentro da janela da oferta. */
const AGORA = new Date('2026-09-23T13:00:00.000Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

function liberado(id: number, h: number) {
  return { key: `${EP_LIBERADO_PREFIX}${id}`, value: { em: horasAtras(h), nome: 'Marcos', quando: horasAtras(h - 2) }, updated_at: horasAtras(h) };
}
function ficha(id: number, over: Record<string, any> = {}) {
  return {
    id, cliente_nome: 'Marcos Silva', cliente_telefone: '5534999887766', vendedor_nome: 'Diego',
    quando: horasAtras(20), status: 'cancelado', lead_resposta_at: null, ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  estado = []; fichas = []; ofertados.length = 0;
  resultadoOferta = { acao: 'ofertou', ofertas: ['a', 'b', 'c'] };
  delete process.env.EP_RETORNO_OFF;
});
afterEach(() => { vi.useRealTimers(); });

describe('rodadaDevida — a cadência', () => {
  it('não chama antes de 20h', () => {
    expect(rodadaDevida({ horasDesdeLiberacao: 5, r1Enviada: false, r2Enviada: false })).toBeNull();
  });
  it('20h depois, a primeira oferta', () => {
    expect(rodadaDevida({ horasDesdeLiberacao: 21, r1Enviada: false, r2Enviada: false })).toBe('r1');
  });
  it('a segunda só em D+3, não no dia seguinte', () => {
    expect(rodadaDevida({ horasDesdeLiberacao: 30, r1Enviada: true, r2Enviada: false })).toBeNull();
    expect(rodadaDevida({ horasDesdeLiberacao: 70, r1Enviada: true, r2Enviada: false })).toBe('r2');
  });
  it('depois da segunda, o robô cala pra sempre', () => {
    expect(rodadaDevida({ horasDesdeLiberacao: 500, r1Enviada: true, r2Enviada: true })).toBeNull();
  });
});

describe('o tick', () => {
  it('chama de volta com horário na mesa e carimba a rodada', async () => {
    estado = [liberado(1, 21)];
    fichas = [ficha(1)];
    const r = await runEletropostoRetornoTick();
    expect(r.ofertas).toBe(1);
    expect(ofertados[0]).toMatchObject({ id: 1, rodada: 1, copy: 'bolhasRetorno1' });
    expect(estado.some(e => e.key === `${EP_RETORNO_PREFIX}1:r1`)).toBe(true);
  });

  it('NÃO chama quem já voltou pra agenda', async () => {
    estado = [liberado(1, 21)];
    fichas = [ficha(1, { status: 'agendado' })];
    const r = await runEletropostoRetornoTick();
    expect(r.ofertas).toBe(0);
    expect(r.voltaram).toBe(1);
    expect(ofertados).toHaveLength(0);
  });

  it('NÃO chama quem escreveu depois de perder o horário', async () => {
    estado = [liberado(1, 21)];
    fichas = [ficha(1, { lead_resposta_at: horasAtras(2) })];
    const r = await runEletropostoRetornoTick();
    expect(r.ofertas).toBe(0);
    expect(ofertados).toHaveLength(0);
  });

  it('resposta de ANTES da liberação não protege ninguém', async () => {
    // Ele falou no dia em que marcou, sumiu depois e perdeu o horário: é
    // exatamente quem esta cadência existe pra chamar.
    estado = [liberado(1, 21)];
    fichas = [ficha(1, { lead_resposta_at: horasAtras(40) })];
    const r = await runEletropostoRetornoTick();
    expect(r.ofertas).toBe(1);
  });

  it('oferta que não saiu não queima a rodada', async () => {
    estado = [liberado(1, 21)];
    fichas = [ficha(1)];
    resultadoOferta = { acao: 'sem_vaga' };
    const r1 = await runEletropostoRetornoTick();
    expect(r1.ofertas).toBe(0);
    expect(r1.sem_vaga).toBe(1);
    expect(estado.some(e => e.key === `${EP_RETORNO_PREFIX}1:r1`)).toBe(false);

    // Abriu vaga: o mesmo lead é chamado no tick seguinte.
    resultadoOferta = { acao: 'ofertou', ofertas: ['a'] };
    const r2 = await runEletropostoRetornoTick();
    expect(r2.ofertas).toBe(1);
  });

  it('rodada já reivindicada por outro tick não sai duas vezes', async () => {
    estado = [liberado(1, 21), { key: `${EP_RETORNO_PREFIX}1:r1`, value: { claim: 'agora' } }];
    fichas = [ficha(1)];
    const r = await runEletropostoRetornoTick();
    expect(r.ofertas).toBe(0);
    expect(ofertados).toHaveLength(0);
  });

  it('18 liberados não viram 18 ofertas no mesmo tick', async () => {
    estado = Array.from({ length: 18 }, (_, i) => liberado(i + 1, 21));
    fichas = Array.from({ length: 18 }, (_, i) => ficha(i + 1));
    const r = await runEletropostoRetornoTick();
    expect(r.ofertas).toBe(1);
    expect(ofertados).toHaveLength(1);
  });

  it('liberação de mais de 8 dias não vira oferta', async () => {
    estado = [liberado(1, 9 * 24)];
    fichas = [ficha(1)];
    const r = await runEletropostoRetornoTick();
    expect(r.motivo).toBe('ninguem_liberado');
  });

  it('fora da janela de 9h às 19h não faz nada', async () => {
    vi.setSystemTime(new Date('2026-09-23T23:30:00.000Z')); // 20h30 BRT
    estado = [liberado(1, 21)];
    fichas = [ficha(1)];
    expect((await runEletropostoRetornoTick()).motivo).toBe('fora_da_janela');
  });

  it('kill-switch para tudo', async () => {
    process.env.EP_RETORNO_OFF = '1';
    estado = [liberado(1, 21)];
    fichas = [ficha(1)];
    expect((await runEletropostoRetornoTick()).motivo).toBe('desligado');
    expect(ofertados).toHaveLength(0);
  });

  it('dry mostra quem seria chamado e não grava nada', async () => {
    estado = [liberado(1, 21)];
    fichas = [ficha(1)];
    const r = await runEletropostoRetornoTick({ dry: true });
    expect(r.previa).toEqual([{ id: 1, cliente: 'Marcos Silva', rodada: 'r1' }]);
    expect(ofertados).toHaveLength(0);
    expect(estado.some(e => e.key.startsWith(EP_RETORNO_PREFIX))).toBe(false);
  });
});
