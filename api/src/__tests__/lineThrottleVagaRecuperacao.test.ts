import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A vaga guardada da recuperação do quiz (P4), parecer do chefe anti-ban de 16/11/2026: com `quiz_rec_fila` fresca (prontos > 0, menos de 20 min),
// o frio P5 que se identifica (`robo`) cede a vaga, até mín(15, metade do teto frio) carimbos `quiz_rec_sent*` em 24 h e só dentro da janela.
// O próprio robô da recuperação (P4), quem não se identifica e o transacional nunca são segurados. Leitura que falha não segura ninguém.

type Row = { key: string; value?: any; updated_at: string };
const db: { rows: Row[]; falhar: boolean } = { rows: [], falhar: false };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
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
        maybeSingle() {
          if (db.falhar) return Promise.resolve({ data: null, error: { message: 'falhou' } });
          const r = db.rows.find(x => filtros.every(f => f(x))); return Promise.resolve({ data: r ? { value: r.value } : null, error: null });
        },
        limit(n: number) { return Promise.resolve({ data: db.rows.filter(r => filtros.every(f => f(r))).slice(0, n).map(r => ({ key: r.key })), error: null }); },
        upsert() { return Promise.resolve({ data: null, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const envOriginal = { ...process.env };
// quarta 18/11/2026, 15h BRT (18h UTC): dentro da janela
const QUARTA_15H = new Date('2026-11-18T18:00:00.000Z');

beforeEach(() => {
  db.rows = []; db.falhar = false; vi.resetModules();
  delete process.env.LINHA_RECONECTADA_EM; delete process.env.AGENTES5040_BASE_VAGA;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(QUARTA_15H);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

const haMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const fila = (prontos: number, minAtras: number) => db.rows.push({ key: 'quiz_rec_fila', value: { prontos, em: haMin(minAtras) }, updated_at: haMin(minAtras) });
const recuperacoes = (n: number) => { for (let i = 0; i < n; i++) db.rows.push({ key: `quiz_rec_sent:h${i}`, value: { estado: 'enviado' }, updated_at: haMin(300 + i) }); };
const carregar = async () => import('../services/agents/whatsapp/lineThrottle');

describe('vaga guardada da recuperação do quiz', () => {
  it('fila fresca com prontos: o P5 (Bia, Helena, retomada de usuários) cede; o P4 da recuperação e quem não se identifica passam', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila(3, 2);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(false);
    expect(await dentroDoTetoHorarioLinha({ robo: 'investidor_agente_abertura' })).toBe(false);
    expect(await dentroDoTetoHorarioLinha({ robo: 'carla_retomada_usuarios' })).toBe(false);
    expect(await dentroDoTetoHorarioLinha({ robo: 'quiz_recuperacao_5040' })).toBe(true);
    expect(await dentroDoTetoHorarioLinha({ robo: 'dunning_lembrete' })).toBe(true);
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, robo: 'bia_recuperacao' })).toBe(true);
  });

  it('fila velha (20 min ou mais), vazia (0 prontos) ou ausente: ninguém é segurado', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    fila(3, 20);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    db.rows = []; fila(0, 1);
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
    db.rows = [];
    expect(await dentroDoTetoHorarioLinha({ robo: 'bia_recuperacao' })).toBe(true);
  });

  it('a vaga acaba em 15 carimbos da recuperação em 24 h: aí o P5 volta a passar', async () => {
    const { vagaDaRecuperacaoSegura } = await carregar();
    fila(3, 2);
    recuperacoes(14);
    expect(await vagaDaRecuperacaoSegura('bia_recuperacao', 30)).toBe(true);
    recuperacoes(15);
    expect(await vagaDaRecuperacaoSegura('bia_recuperacao', 30)).toBe(false);
  });

  it('fora da janela e com leitura que falha: não segura', async () => {
    const { vagaDaRecuperacaoSegura } = await carregar();
    fila(3, 2);
    expect(await vagaDaRecuperacaoSegura('bia_recuperacao', 30, new Date('2026-11-22T15:00:00.000Z'))).toBe(false);   // domingo
    db.falhar = true;
    expect(await vagaDaRecuperacaoSegura('bia_recuperacao', 30)).toBe(false);
  });

  it('o 3º toque conta no frio da linha e o marcador da fila não conta', async () => {
    const { prefixosDaLinha } = await carregar();
    expect(prefixosDaLinha()).toContain('quiz_rec_sent3:');
    expect(prefixosDaLinha().some(p => 'quiz_rec_fila'.startsWith(p))).toBe(false);
  });
});
