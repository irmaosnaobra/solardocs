import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Os freios do disparo são lidos de env var pra dar pra apertar sem deploy.
// Este teste trava o comportamento deles: um erro aqui não dá tela vermelha,
// vira mensagem na madrugada pra lista errada — e a linha já foi banida uma vez.

const db: { envios: any[] } = { envios: [] };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: [] as Array<(r: any) => boolean>,
        select(_c?: string, opts?: { count?: string; head?: boolean }) {
          q._contando = opts?.count === 'exact';
          return q;
        },
        eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return q; },
        gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
        in(col: string, vals: any[]) { q._filtros.push((r: any) => vals.includes(r[col])); return q; },
        or() { return q; },
        order() { return q; },
        limit() { return q._resolver(); },
        update() { return { eq: async () => ({ error: null }) }; },
        _resolver() {
          const linhas = (tabela === 'io_broadcast_envios' ? db.envios : []).filter((r) => q._filtros.every((f: any) => f(r)));
          return Promise.resolve({ data: linhas, error: null, count: linhas.length });
        },
        then(res: any, rej: any) { return q._resolver().then(res, rej); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/io/ioSend', () => ({
  sleep: vi.fn(), humanizar: vi.fn((s: string) => s), enviarZapiIO: vi.fn(),
  carregarSupressao: vi.fn(async () => () => false),
  adquirirLockBlast: vi.fn(async () => true),
  liberarLockBlast: vi.fn(async () => undefined),
}));

const envOriginal = { ...process.env };
beforeEach(() => { db.envios = []; vi.resetModules(); });
afterEach(() => { process.env = { ...envOriginal }; });

async function rodar() {
  const mod = await import('../services/io/broadcastTickService');
  return mod.runIoBroadcastTick();
}

describe('freios do disparo em massa', () => {
  // O defeito que este teste tranca: Number('') e' 0, e 0 passa em isFinite e em
  // >= 0. Sem o teste de string vazia, env var AUSENTE virava 0 — janela 0..0
  // (sempre fechada) e teto 0 — e o disparo parava calado, sem erro nenhum.
  it('sem NENHUMA env var configurada, os padroes valem e o disparo funciona', async () => {
    delete process.env.IO_BLAST_OFF;
    delete process.env.IO_BLAST_HORA_INICIO;
    delete process.env.IO_BLAST_HORA_FIM;
    delete process.env.IO_BLAST_TETO_DIA;
    delete process.env.IO_BLAST_DIAS_DEDUP;

    const r = await rodar();
    // Fora do horario comercial o motivo legitimo e' a janela; dentro, e'
    // 'nada_rodando'. O que NAO pode acontecer e' teto_diario com zero envios.
    expect(r.reason).not.toBe('teto_diario');
    expect(['nada_rodando', 'fora_da_janela_horaria']).toContain(r.reason);
  });

  it('kill-switch congela tudo', async () => {
    process.env.IO_BLAST_OFF = '1';
    expect((await rodar()).reason).toBe('blast_desligado');
  });

  it('fora da janela de horário não manda nada', async () => {
    delete process.env.IO_BLAST_OFF;
    // Janela impossível (início = fim) → qualquer hora está fora.
    process.env.IO_BLAST_HORA_INICIO = '9';
    process.env.IO_BLAST_HORA_FIM = '9';
    expect((await rodar()).reason).toBe('fora_da_janela_horaria');
  });

  it('para ao bater o teto do dia — contando a LINHA, não a campanha', async () => {
    delete process.env.IO_BLAST_OFF;
    process.env.IO_BLAST_HORA_INICIO = '0';
    process.env.IO_BLAST_HORA_FIM = '24';
    process.env.IO_BLAST_TETO_DIA = '2';
    const hoje = new Date().toISOString();
    // Dois envios hoje, de campanhas DIFERENTES: o teto é da linha.
    db.envios = [
      { id: '1', phone: '34999990001', broadcast_id: 'camp-a', enviado_em: hoje },
      { id: '2', phone: '34999990002', broadcast_id: 'camp-b', enviado_em: hoje },
    ];
    expect((await rodar()).reason).toBe('teto_diario');
  });

  it('dentro da janela e abaixo do teto, segue o fluxo normal', async () => {
    delete process.env.IO_BLAST_OFF;
    process.env.IO_BLAST_HORA_INICIO = '0';
    process.env.IO_BLAST_HORA_FIM = '24';
    process.env.IO_BLAST_TETO_DIA = '150';
    // Sem broadcast rodando: o motivo tem que ser 'nada_rodando', ou seja, os
    // freios deixaram passar e quem barrou foi a ausência de campanha.
    expect((await rodar()).reason).toBe('nada_rodando');
  });
});
