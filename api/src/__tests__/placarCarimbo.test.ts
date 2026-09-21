import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A TRAVA DO SLOT DO PLACAR.
//
// Desde 21/09/2026 o placar tem dois chamadores: o /process-messages (pg_cron de
// 2 em 2 minutos) e o workflow do GitHub, de reserva. Com dois chamadores, "ler,
// ver que não tem, gravar" deixa uma fresta — os dois leem vazio no mesmo
// instante e os dois mandam. O carimbo virou INSERT pra o banco escolher um só.
//
// O que este arquivo tranca:
//   1. dois ticks simultâneos no mesmo slot = UMA mensagem no celular dela;
//   2. carimbo que falha por outro motivo = NENHUMA mensagem (falha fechada —
//      com pinger de 2 em 2 minutos, mandar sem carimbar é mandar 30x por hora);
//   3. o tick seguinte do mesmo slot sai pela leitura, sem nem tentar gravar.
// ─────────────────────────────────────────────────────────────────────────────

const estado = new Map<string, unknown>();
let falhaNoInsert: { code: string; message: string } | null = null;
let inserts = 0;

vi.mock('../utils/supabase', () => {
  const tabela = (nome: string) => {
    const filtro: Record<string, unknown> = {};
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => { filtro[col] = val; return q; },
      gte: () => q,
      order: () => q,
      limit: () => q,
      // Resolve depois de um giro do event loop, como uma ida ao banco de verdade:
      // é isso que deixa os dois ticks lerem "vazio" antes de qualquer um gravar.
      maybeSingle: () => new Promise(r => setTimeout(() => {
        const k = String(filtro.key);
        r({ data: estado.has(k) ? { key: k, value: estado.get(k) } : null, error: null });
      }, 0)),
      // Uma mensagem só, na primeira página. Respeitar o offset importa: um mock
      // que devolve a mesma linha pra qualquer página faz a leitura andar até o
      // teto de 40 mil (e o aviso de teto disparar) — foi o que este teste pegou
      // na primeira versão dele.
      range: (de: number) => Promise.resolve({
        data: nome === 'wa_mensagens' && de === 0
          ? [{ telefone: '5534988887777', from_me: false, momment: new Date(Date.now() - 3600_000).toISOString() }]
          : [],
        error: null,
      }),
      insert: (row: { key: string; value: unknown }) => new Promise(r => setTimeout(() => {
        if (nome !== 'system_state') return r({ error: null });   // o logger grava em error_logs
        inserts++;
        if (falhaNoInsert) return r({ error: falhaNoInsert });
        if (estado.has(row.key)) return r({ error: { code: '23505', message: 'duplicate key' } });
        estado.set(row.key, row.value);
        r({ error: null });
      }, 0)),
      upsert: (row: { key: string; value: unknown }) => { estado.set(row.key, row.value); return Promise.resolve({ error: null }); },
      then: (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err),
    };
    return q;
  };
  return { supabase: { from: (nome: string) => tabela(nome) } };
});

const envios: string[] = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string) => { envios.push(tel); }),
}));

vi.mock('../services/agents/whatsapp/silenciar', () => ({
  chaveContato: (p: string) => {
    const d = String(p ?? '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return null;
    const s = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    return s.length < 10 ? null : s.slice(0, 2) + s.slice(-8);
  },
}));

import { runPlacarGiovanna } from '../services/io/placarGiovanna';

describe('placar do 5040 — a trava do slot', () => {
  beforeEach(() => {
    estado.clear();
    envios.length = 0;
    falhaNoInsert = null;
    inserts = 0;
    delete process.env.PLACAR_OFF;
    delete process.env.PLACAR_HORAS;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-21T08:03:00-03:00'));   // segunda, slot das 8
  });
  afterEach(() => { vi.useRealTimers(); });

  it('dois chamadores no mesmo instante mandam UMA mensagem', async () => {
    const [a, b] = await Promise.all([runPlacarGiovanna(), runPlacarGiovanna()]);
    expect(envios).toHaveLength(1);
    expect(inserts).toBe(2);                                   // os dois tentaram: a trava é o banco
    const motivos = [a.motivo, b.motivo];
    expect([a.enviado, b.enviado].filter(Boolean)).toHaveLength(1);
    expect(motivos).toContain('ja_enviado_neste_slot');
  });

  it('carimbo que quebra por outro motivo segura o placar', async () => {
    falhaNoInsert = { code: '57014', message: 'statement timeout' };
    const r = await runPlacarGiovanna();
    expect(r.enviado).toBe(false);
    expect(r.motivo).toBe('erro_carimbo');
    expect(envios).toHaveLength(0);
  });

  it('o tick seguinte do mesmo slot para na leitura, sem tentar gravar', async () => {
    await runPlacarGiovanna();
    expect(envios).toHaveLength(1);
    const antes = inserts;
    vi.setSystemTime(new Date('2026-09-21T09:15:00-03:00'));  // mesma folga do slot das 8
    const r = await runPlacarGiovanna();
    expect(r.motivo).toBe('ja_enviado_neste_slot');
    expect(inserts).toBe(antes);
    expect(envios).toHaveLength(1);
  });

  it('o slot seguinte é outro carimbo e sai normalmente', async () => {
    await runPlacarGiovanna();
    vi.setSystemTime(new Date('2026-09-21T10:01:00-03:00'));
    const r = await runPlacarGiovanna();
    expect(r.enviado).toBe(true);
    expect(envios).toHaveLength(2);
  });
});
