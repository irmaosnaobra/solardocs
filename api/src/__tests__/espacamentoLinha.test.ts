import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Margem de 5 min entre envios + janela diurna da linha.
//
// O que este teste tranca: o teto de 12/h autoriza as 12 no MESMO minuto, e foi
// assim que a linha caiu — 04/ago, 8 pessoas / 37 mensagens numa hora; 06/ago 01h13,
// 4 mensagens em 37 segundos. A régua de 5 min é o que transforma "cabe na hora" em
// "sai espaçado", e a janela é o que impede venda fria às 2 da manhã.

const db: { state: Array<{ key: string; updated_at: string }> } = { state: [] };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _filtros: [] as Array<(r: any) => boolean>,
        select() { return q; },
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

const envOriginal = { ...process.env };
beforeEach(() => { db.state = []; vi.resetModules(); });
afterEach(() => { process.env = { ...envOriginal }; });

const haMinutos = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
const carregar = () => import('../services/agents/whatsapp/lineThrottle');

describe('margem entre envios da linha (10 min + jitter)', () => {
  it('linha em silêncio: pode enviar', async () => {
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(true);
  });

  it('envio há 1 min: segura (é a rajada que derrubou a linha)', async () => {
    db.state.push({ key: 'limpapro_grupo_sent:a@b.com', updated_at: haMinutos(1) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(false);
  });

  it('envio há 6 min: AINDA segura (a base subiu de 5 pra 10 min)', async () => {
    db.state.push({ key: 'limpapro_grupo_sent:a@b.com', updated_at: haMinutos(6) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(false);
  });

  it('envio há 20 min: libera mesmo com o jitter no teto', async () => {
    db.state.push({ key: 'limpapro_grupo_sent:a@b.com', updated_at: haMinutos(20) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(true);
  });

  it('semente e grupo frio entram na conta da linha (estavam fora)', async () => {
    db.state.push({ key: 'semente:5534999', updated_at: haMinutos(2) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(false);
  });

  it('conta o envio de QUALQUER bot da linha, não só o meu', async () => {
    db.state.push({ key: 'gerador_followup:5511999', updated_at: haMinutos(2) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(false);  // a Bia espera o followup
  });

  it('fila (_pending) não é envio — não conta na margem', async () => {
    db.state.push({ key: 'limpapro_grupo_pending:a@b.com', updated_at: haMinutos(1) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(true);
  });

  it('ESPACAMENTO_OFF=1 volta ao comportamento antigo', async () => {
    process.env.ESPACAMENTO_OFF = '1';
    db.state.push({ key: 'limpapro_grupo_sent:a@b.com', updated_at: haMinutos(1) });
    const { respeitaEspacamentoLinha } = await carregar();
    expect(await respeitaEspacamentoLinha()).toBe(true);
  });
});

describe('janela diurna (09h-20h BRT, sem domingo)', () => {
  const asBrt = (h: number) => new Date(Date.UTC(2026, 7, 6, h + 3, 0, 0)); // 06/ago/2026 = quinta

  it('02h da manhã: não sai', async () => {
    const { dentroDaJanelaDiurna } = await carregar();
    expect(dentroDaJanelaDiurna(asBrt(2))).toBe(false);
  });

  it('08h: ainda não (a janela fechou pras 09h)', async () => {
    const { dentroDaJanelaDiurna } = await carregar();
    expect(dentroDaJanelaDiurna(asBrt(8))).toBe(false);
  });

  it('20h em ponto: fecha (era 21h)', async () => {
    const { dentroDaJanelaDiurna } = await carregar();
    expect(dentroDaJanelaDiurna(asBrt(20))).toBe(false);
  });

  it('domingo 15h: não sai — dia de maior denúncia', async () => {
    const { dentroDaJanelaDiurna } = await carregar();
    expect(dentroDaJanelaDiurna(new Date(Date.UTC(2026, 7, 9, 18, 0, 0)))).toBe(false); // 09/ago = domingo
  });

  it('09h: sai', async () => {
    const { dentroDaJanelaDiurna } = await carregar();
    expect(dentroDaJanelaDiurna(asBrt(9))).toBe(true);
  });

  it('JANELA_DIURNA_OFF=1 volta pro 24/7', async () => {
    process.env.JANELA_DIURNA_OFF = '1';
    const { dentroDaJanelaDiurna } = await carregar();
    expect(dentroDaJanelaDiurna(asBrt(2))).toBe(true);
  });
});

describe('rampa de aquecimento pós-reconexão', () => {
  const dia = (n: number) => new Date(Date.UTC(2026, 7, 10, 12, 0, 0) + n * 24 * 3600 * 1000);

  it('sem a env, valem os tetos cheios', async () => {
    const { tetosVigentes, MAX_POR_HORA, MAX_POR_DIA } = await carregar();
    expect(tetosVigentes(dia(0))).toEqual({ hora: MAX_POR_HORA, dia: MAX_POR_DIA });
  });

  it('dia 0 da reconexão: 2/h e 10/dia', async () => {
    process.env.LINHA_RECONECTADA_EM = '2026-08-10';
    const { tetosVigentes } = await carregar();
    expect(tetosVigentes(dia(0))).toEqual({ hora: 2, dia: 10 });
  });

  it('dia 1: sobe pra 3/h', async () => {
    process.env.LINHA_RECONECTADA_EM = '2026-08-10';
    const { tetosVigentes } = await carregar();
    expect(tetosVigentes(dia(1)).hora).toBe(3);
  });

  it('depois de 3 dias a rampa some sozinha (não precisa tirar a env)', async () => {
    process.env.LINHA_RECONECTADA_EM = '2026-08-10';
    const { tetosVigentes, MAX_POR_HORA } = await carregar();
    expect(tetosVigentes(dia(4)).hora).toBe(MAX_POR_HORA);
  });
});
