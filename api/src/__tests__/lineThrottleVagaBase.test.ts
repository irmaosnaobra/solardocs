import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// B4c em MODO SOMBRA (21/10/2026): vaga guardada da Base = mín(5, teto frio / 6). Frio que se identifica (`robo`) e que
// SERIA segurado pela vaga só registra (log + ag5040_base_sombra:<dia BRT>); com AGENTES5040_BASE_VAGA=1 passa a segurar.

type Row = { key: string; value?: any; updated_at: string };
const db: { rows: Row[]; chamadas: number } = { rows: [], chamadas: 0 };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      db.chamadas++;
      const filtros: Array<(r: Row) => boolean> = [];
      const q: any = {
        select() { return q; },
        or(expr: string) {
          const ps = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
          filtros.push(r => ps.some(p => r.key.startsWith(p))); return q;
        },
        like(_c: string, p: string) { const pre = p.replace(/%$/, ''); filtros.push(r => r.key.startsWith(pre)); return q; },
        gte(_c: string, v: string) { filtros.push(r => r.updated_at >= v); return q; },
        eq(_c: string, v: string) { filtros.push(r => r.key === v); return q; },
        upsert(p: Row) {
          db.rows = db.rows.filter(r => r.key !== p.key);
          db.rows.push({ key: p.key, value: p.value, updated_at: p.updated_at });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() { const r = db.rows.find(x => filtros.every(f => f(x))); return Promise.resolve({ data: r ? { value: r.value } : null, error: null }); },
        limit(n: number) { return Promise.resolve({ data: db.rows.filter(r => filtros.every(f => f(r))).slice(0, n).map(r => ({ key: r.key })), error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const envOriginal = { ...process.env };
// quarta 21/10/2026, 15h BRT (18h UTC): dentro da janela da Base
const QUARTA_15H = new Date('2026-10-21T18:00:00.000Z');

beforeEach(() => {
  db.rows = []; db.chamadas = 0; vi.resetModules();
  delete process.env.LINHA_RECONECTADA_EM; delete process.env.AGENTES5040_BASE_VAGA;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(QUARTA_15H);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

const haMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const frios = (n: number, prefixo = 'limpapro_recovery:') => { for (let i = 0; i < n; i++) db.rows.push({ key: `${prefixo}${i}`, updated_at: haMin(120 + i * 20) }); };
const fila = (v: { vazia: boolean; minAtras: number }) => db.rows.push({ key: 'ag5040_base_fila', value: { vazia: v.vazia, em: haMin(v.minAtras) }, updated_at: haMin(v.minAtras) });
const carregar = async () => ({ ...(await import('../services/agents/whatsapp/lineThrottle')), logger: (await import('../utils/logger')).logger });
const contador = () => db.rows.find(r => r.key === 'ag5040_base_sombra:2026-10-21')?.value;

describe('B4c: vaga da Base em modo sombra', () => {
  it('SEM robo: idêntico ao de hoje, sem consulta extra e sem registro', async () => {
    const { dentroDoTetoHorarioLinha, logger } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(26);
    const antes = db.chamadas;
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    expect(db.chamadas - antes).toBe(3);   // aquecimento + 1 h + 24 h
    expect(contador()).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('seria segurado (26 de 30 com a vaga de 5 inteira): na sombra PASSA, registra o log e o contador por robô, sem telefone', async () => {
    const { dentroDoTetoHorarioLinha, logger } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(26);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('linha', 'vaga_da_base (sombra)', { robo: 'bia_recuperacao' });
    expect(contador()).toEqual({ n: 1, robos: { bia_recuperacao: 1 } });
    expect(await dentroDoTetoHorarioLinha({ transacional: false, robo: 'ep_oferta_fria' })).toBe(true);
    expect(contador()).toEqual({ n: 2, robos: { bia_recuperacao: 1, ep_oferta_fria: 1 } });
  });

  it('com AGENTES5040_BASE_VAGA=1 segura de verdade (e não toca o contador da sombra)', async () => {
    process.env.AGENTES5040_BASE_VAGA = '1';
    const { dentroDoTetoHorarioLinha, logger } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(26);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('linha', 'vaga_da_base', { robo: 'bia_recuperacao' });
    expect(contador()).toBeUndefined();
  });

  it('com 24 de 30 (abaixo de 30 menos 5) não é segurado nem contado', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(24);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toBeUndefined();
  });

  it('a vaga usada pela Base libera o resto: 23 frios + 2 retomadas (3 vagas livres, corte em 27) não conta; com 27 passa a contar', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(23); frios(2, 'ag5040_retomada:');
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toBeUndefined();
    frios(2, 'semente:');
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toEqual({ n: 1, robos: { bia_recuperacao: 1 } });
  });

  it('as 5 vagas da Base já usadas: nada fica guardado', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(5, 'ag5040_retomada:'); frios(24);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toBeUndefined();
  });

  it('fila vazia, fila velha (20 min ou mais), sem fila gravada: nada guardado', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    frios(26);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);        // sem a chave
    fila({ vazia: true, minAtras: 2 });
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    db.rows = db.rows.filter(r => r.key !== 'ag5040_base_fila'); fila({ vazia: false, minAtras: 25 });
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toBeUndefined();
  });

  it('fora da janela da Base (domingo, 21h, feriado): nada guardado', async () => {
    for (const quando of ['2026-10-25T18:00:00.000Z', '2026-10-22T00:30:00.000Z', '2026-11-02T18:00:00.000Z']) {
      db.rows = []; vi.resetModules(); vi.setSystemTime(new Date(quando));
      const { dentroDoTetoHorarioLinha } = await carregar();
      fila({ vazia: false, minAtras: 2 }); frios(26);
      expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
      expect(db.rows.some(r => r.key.startsWith('ag5040_base_sombra:')), quando).toBe(false);
    }
  });

  it('a Base e o transacional nunca são afetados pela vaga', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(26);
    process.env.AGENTES5040_BASE_VAGA = '1';
    expect(await dentroDoTetoHorarioLinha({ robo: 'base_retomada_5040' })).toBe(true);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toBeUndefined();
  });

  it('na rampa de reconexão (teto frio 1 => vaga 0) não guarda nada', async () => {
    process.env.LINHA_RECONECTADA_EM = '2026-10-21T10:00:00-03:00';
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila({ vazia: false, minAtras: 2 });
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    expect(contador()).toBeUndefined();
  });

  it('o teto de verdade continua mandando: com 30 frios fecha mesmo na sombra', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila({ vazia: false, minAtras: 2 }); frios(30);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(false);
    expect(contador()).toBeUndefined();
  });

  it('o contador não casa com nenhum prefixo contado pela linha', async () => {
    const { prefixosTotalDaLinha, PREFIXOS_AGENDA } = await carregar();
    const chave = 'ag5040_base_sombra:2026-10-21';
    expect([...prefixosTotalDaLinha(), ...PREFIXOS_AGENDA, 'carla_sent:'].some(p => chave.startsWith(p))).toBe(false);
  });

  it('a janela da Base do lineThrottle é a mesma de baseRegras.dentroDaJanelaBase', async () => {
    const { dentroDaJanelaDaBaseLinha } = await carregar();
    const { dentroDaJanelaBase } = await import('../services/agentes5040/baseRegras');
    const t0 = Date.parse('2026-10-18T00:00:00.000Z');
    for (let h = 0; h < 24 * 21; h++) {
      const d = new Date(t0 + h * 3_600_000);
      expect(dentroDaJanelaDaBaseLinha(d), d.toISOString()).toBe(dentroDaJanelaBase(d));
    }
  });

  it('os chamadores frios se identificam (guarda de fonte: LimpaPro, NaoAtendidoFup e Retorno)', async () => {
    const { readFileSync } = await import('node:fs');
    const lê = (rel: string) => readFileSync(`${process.cwd()}/src/services/${rel}`, 'utf-8');
    expect(lê('agents/whatsapp/limpaproRecoveryService.ts')).toContain("dentroDoTetoHorario({ robo: 'bia_recuperacao' })");
    expect(lê('io/eletropostoNaoAtendidoFup.ts')).toContain("robo: 'ep_oferta_fria'");
    expect(lê('io/eletropostoRetorno.ts')).toContain("robo: 'ep_oferta_fria'");
    expect(lê('io/eletropostoRemarcar.ts')).toContain("robo: opts.robo ?? 'ep_oferta_fria'");
    expect(lê('io/sementeSolarService.ts')).toContain("dentroDoTetoHorarioLinha({ robo: 'semente' })");
    expect(lê('io/eletropostoIgConvite.ts')).toContain("dentroDoTetoHorarioLinha({ robo: 'ep_ig_convite' })");
    expect(lê('agents/sdr/carlaRetomada.ts')).toContain("dentroDoTetoHorarioLinha({ robo: 'carla_retomada' })");
    // carlaThrottle.ts fica SEM robo: o chefeGuarda lê `robo:` como registro de robô e o arquivo é um gate compartilhado por vários (não hospeda nenhum).
    expect(lê('gerador/redes/statusIo.ts')).toContain("dentroDoTetoHorarioLinha({ robo: 'status_5040' })");
    expect(lê('io/investidorAgente.ts').split("robo: 'investidor_agente_abertura'").length - 1).toBe(4);
  });
});
