import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// FOLLOW-UP DO NÃO ATENDIDO (o consultor esperou e a pessoa não veio).
// O risco número um aqui é MENTIR: dizer "o consultor te chamou e não conseguiu
// falar com você" pra quem o ROBÔ marcou de ausente horas ANTES da reunião. Nesse
// caso ninguém chamou ninguém, e o horário dela já tinha voltado pra vitrine.

let fichas: any[] = [];
let estado: Array<{ key: string; value?: any; updated_at?: string }> = [];
const ofertados: Array<{ id: number; copy: string }> = [];
let resultadoOferta: any = { acao: 'ofertou', ofertas: ['a', 'b', 'c'] };

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        select() { return q; },
        eq() { return q; },
        gte() { return q; },
        lte() { return q; },
        order() { return q; },
        limit: async () => ({ data: fichas, error: null }),
      };
      return q;
    },
  },
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _like: null as string | null,
        select() { return q; },
        like(_c: string, v: string) { q._like = String(v).replace(/%$/, ''); return q; },
        limit: async () => ({ data: estado.filter(e => e.key.startsWith(q._like || '')), error: null }),
        insert: async (r: any) => (estado.some(e => e.key === r.key)
          ? { error: { code: '23505' } }
          : (estado.push(r), { error: null })),
        upsert: async (r: any) => {
          const i = estado.findIndex(e => e.key === r.key);
          if (i >= 0) estado[i] = r; else estado.push(r);
          return { error: null };
        },
        delete: () => ({
          eq: async (_c: string, v: string) => { estado = estado.filter(e => e.key !== v); return { error: null }; },
        }),
      };
      return q;
    },
  },
}));

const fichasCriadas: Array<{ id: number; motivo?: string }> = [];
vi.mock('../services/io/eletropostoCobraSim', () => ({
  criarFichaCurioso: async (f: any, _dry: boolean, motivo?: string) => {
    fichasCriadas.push({ id: f.id, motivo });
    return 'criada';
  },
}));

vi.mock('../services/io/eletropostoRemarcar', () => ({
  ofertarPorConta: async (ficha: any, copy: any) => {
    ofertados.push({ id: ficha.id, copy: copy.name });
    return resultadoOferta;
  },
  bolhasNaoAtendido: function bolhasNaoAtendido() { return []; },
  bolhasNaoAtendido2: function bolhasNaoAtendido2() { return []; },
  bolhasNaoAtendido3: function bolhasNaoAtendido3() { return []; },
}));

vi.mock('../utils/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

import {
  runEletropostoNaoAtendidoFupTick, EP_FUP_NAOATENDIDO_PREFIX,
} from '../services/io/eletropostoNaoAtendidoFup';

/** 22/09/2026, 19h30 de Brasília: dentro da janela das 19h. */
const AGORA = new Date('2026-09-22T22:30:00.000Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

function ficha(over: Record<string, any> = {}) {
  return {
    id: 1, cliente_nome: 'Marcos Silva', cliente_telefone: '5534999887766', vendedor_nome: 'Diego',
    quando: horasAtras(3), created_by: 'lp_eletroposto', status: 'nao_atendeu',
    lead_resposta_at: null, ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  fichas = []; estado = []; ofertados.length = 0; fichasCriadas.length = 0;
  resultadoOferta = { acao: 'ofertou', ofertas: ['a', 'b', 'c'] };
  delete process.env.EP_FUP_NAOATENDIDO_OFF;
});
afterEach(() => { vi.useRealTimers(); });

describe('follow-up do não atendido', () => {
  it('chama de volta quem o consultor marcou, com horário na mesa', async () => {
    fichas = [ficha()];
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.ofertas).toBe(1);
    expect(ofertados[0]).toMatchObject({ id: 1, copy: 'bolhasNaoAtendido' });
    expect(estado.some(e => e.key === `${EP_FUP_NAOATENDIDO_PREFIX}1:r1`)).toBe(true);
  });

  it('NÃO chama quem o ROBÔ marcou de ausente', async () => {
    // O corte das 13h marca vermelho horas ANTES da reunião. Dizer pra essa
    // pessoa que o consultor a chamou é mentira escrita.
    fichas = [ficha()];
    estado = [{ key: 'ep_nao_atendeu_auto:1' }];
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.ofertas).toBe(0);
    expect(r.marcadas_pelo_robo).toBe(1);
    expect(ofertados).toHaveLength(0);
  });

  it('NÃO chama quem escreveu depois da hora da reunião', async () => {
    fichas = [ficha({ lead_resposta_at: horasAtras(1) })];
    expect((await runEletropostoNaoAtendidoFupTick()).ofertas).toBe(0);
  });

  it('resposta de ANTES da reunião não protege: ele falou e mesmo assim não veio', async () => {
    fichas = [ficha({ lead_resposta_at: horasAtras(10) })];
    expect((await runEletropostoNaoAtendidoFupTick()).ofertas).toBe(1);
  });

  it('o mesmo degrau não sai duas vezes', async () => {
    fichas = [ficha()];
    await runEletropostoNaoAtendidoFupTick();
    ofertados.length = 0;
    expect((await runEletropostoNaoAtendidoFupTick()).ofertas).toBe(0);
    expect(ofertados).toHaveLength(0);
  });

  it('o 2º toque sai 20h depois do 1º, e não antes', async () => {
    fichas = [ficha()];
    estado = [{ key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r1`, updated_at: horasAtras(5) }];
    expect((await runEletropostoNaoAtendidoFupTick()).ofertas).toBe(0);

    estado = [{ key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r1`, updated_at: horasAtras(21) }];
    vi.setSystemTime(new Date('2026-09-23T13:00:00.000Z')); // 10h BRT, janela diurna
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.ofertas).toBe(1);
    expect(ofertados[ofertados.length - 1].copy).toBe('bolhasNaoAtendido2');
  });

  it('depois dos três toques e mais um dia, a ficha cai na lista', async () => {
    fichas = [ficha()];
    estado = [
      { key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r1`, updated_at: horasAtras(95) },
      { key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r2` },
      { key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r3` },
    ];
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.viraram_lista).toBe(1);
    expect(fichasCriadas).toHaveLength(1);
    // Fim da linha: nenhuma mensagem sai junto.
    expect(ofertados).toHaveLength(0);
  });

  it('antes das 92h a ficha NÃO cai na lista: ele ainda pode voltar', async () => {
    fichas = [ficha()];
    estado = [
      { key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r1`, updated_at: horasAtras(70) },
      { key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r2` },
      { key: `${EP_FUP_NAOATENDIDO_PREFIX}1:r3` },
    ];
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.viraram_lista).toBe(0);
    expect(fichasCriadas).toHaveLength(0);
  });

  it('oferta que não saiu não queima a ficha', async () => {
    fichas = [ficha()];
    resultadoOferta = { acao: 'sem_vaga' };
    const r1 = await runEletropostoNaoAtendidoFupTick();
    expect(r1.sem_vaga).toBe(1);
    expect(estado.some(e => e.key === `${EP_FUP_NAOATENDIDO_PREFIX}1:r1`)).toBe(false);

    resultadoOferta = { acao: 'ofertou', ofertas: ['a'] };
    expect((await runEletropostoNaoAtendidoFupTick()).ofertas).toBe(1);
  });

  it('dois na fila, um por vez é o teto do tick', async () => {
    fichas = [ficha({ id: 1 }), ficha({ id: 2 }), ficha({ id: 3 })];
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.ofertas).toBe(2);
  });

  it('o 1º toque não sai antes das 19h, mesmo com o tick rodando', async () => {
    // Às 17h o tick RODA (é a janela dos toques 2 e 3, que caem de dia), mas o
    // primeiro toque tem hora marcada: o dia precisa ter acabado e os cards
    // precisam estar marcados.
    vi.setSystemTime(new Date('2026-09-22T20:00:00.000Z')); // 17h BRT
    fichas = [ficha()];
    const r = await runEletropostoNaoAtendidoFupTick();
    expect(r.ofertas).toBe(0);
    expect(ofertados).toHaveLength(0);
  });

  it('de madrugada não roda nada', async () => {
    vi.setSystemTime(new Date('2026-09-23T06:00:00.000Z')); // 3h BRT
    fichas = [ficha()];
    expect((await runEletropostoNaoAtendidoFupTick()).motivo).toBe('fora_da_janela');
  });

  it('dry mostra a lista a qualquer hora e não grava nada', async () => {
    vi.setSystemTime(new Date('2026-09-22T17:00:00.000Z')); // 14h BRT
    fichas = [ficha()];
    const r = await runEletropostoNaoAtendidoFupTick({ dry: true });
    expect(r.previa).toHaveLength(1);
    expect(ofertados).toHaveLength(0);
    expect(estado).toHaveLength(0);
  });

  it('ficha de solar não entra', async () => {
    fichas = [ficha({ created_by: 'lp_solar' })];
    expect((await runEletropostoNaoAtendidoFupTick()).motivo).toBe('ninguem_nao_atendido');
  });

  it('kill-switch para tudo', async () => {
    process.env.EP_FUP_NAOATENDIDO_OFF = '1';
    fichas = [ficha()];
    expect((await runEletropostoNaoAtendidoFupTick()).motivo).toBe('desligado');
  });

  it('o 1º toque NÃO cria ficha na lista: ela é o fim da linha', async () => {
    // "Se ele não continuar, não reagendar, não aceitar, ele cai para curioso"
    // (22/09/2026). Criar a ficha no primeiro toque sujaria a lista com gente
    // que está voltando pra agenda.
    fichas = [ficha()];
    await runEletropostoNaoAtendidoFupTick();
    expect(fichasCriadas).toHaveLength(0);
  });
});
