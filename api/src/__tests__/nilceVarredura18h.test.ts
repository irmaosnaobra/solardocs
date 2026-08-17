import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Varredura das 18h da Nilce (ordem do Thiago, 17/08): o que não teve ação até o
// fim do dia é EMPACOTADO no próximo dia útil, encaixando nos horários que
// sobraram, e o que não couber vai pro dia seguinte.
//
// O que pode dar errado em silêncio: mexer em ficha de outro consultor, empacotar
// por cima de horário já marcado, pôr duas fichas no mesmo slot, ressuscitar
// cliente que já foi trabalhado, duplicar quem já tem horário futuro, marcar em
// fim de semana ou feriado, e o lead morto voltando pro 08:00 todo dia.

let agendamentos: any[] = [];
let estado: Record<string, any> = {};

function resolver(f: Record<string, any>, patch: any) {
  if (patch) {
    const alvo = agendamentos.find(a => a.id === f.id);
    if (!alvo || (f.status && alvo.status !== f.status)) return { error: null };  // corrida
    Object.assign(alvo, patch);
    return { error: null };
  }
  let rows = agendamentos.filter(a => a.vendedor_nome === f.vendedor_nome);
  if (f.__notStatus) rows = rows.filter(a => !f.__notStatus.includes(a.status));
  if (f.__gteQuando) rows = rows.filter(a => a.quando >= f.__gteQuando);
  return { data: rows.slice().sort((a, b) => a.quando.localeCompare(b.quando)), error: null };
}

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const f: Record<string, any> = {};
      let patch: any = null;
      const q: any = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: any) => { f[c] = v; return q; },
        gte: (_c: string, v: any) => { f.__gteQuando = v; return q; },
        not: (_c: string, _op: string, lista: string) => {
          f.__notStatus = lista.replace(/[()]/g, '').split(','); return q;
        },
        update: (p: any) => { patch = p; return q; },
        then: (ok: any, no?: any) => Promise.resolve(resolver(f, patch)).then(ok, no),
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const f: Record<string, any> = {};
      const q: any = {
        select: () => q,
        in: (c: string, v: any[]) => { f[c] = v; return q; },
        upsert: (r: any) => { estado[r.key] = r.value; return Promise.resolve({ error: null }); },
        then: (ok: any, no?: any) => Promise.resolve({
          data: (f.key || []).filter((k: string) => estado[k]).map((k: string) => ({ key: k, value: estado[k] })),
          error: null,
        }).then(ok, no),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { runNilceVarredura18h, GRADE_NILCE } from '../services/agenda/nilceVarredura18h';

// "agora": QUINTA, 20/08/2026, 18h em Brasília. Próximo dia útil = sexta 21/08.
const AGORA = new Date('2026-08-20T18:00:00-03:00');
const emSP = (iso: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso)).replace(', ', ' ');

let proximoId = 1;
function ficha(over: Partial<any> = {}) {
  const f = {
    id: proximoId++,
    vendedor_nome: 'Nilce',
    quando: '2026-08-20T09:00:00-03:00',   // hoje de manhã, já venceu
    cliente_nome: `Cliente ${proximoId}`,
    cliente_telefone: `5534991${String(100000 + proximoId).slice(-6)}`,
    status: 'agendado',
    temperatura: null,
    created_by: 'lead-meta',
    historico: null,
    ...over,
  };
  agendamentos.push(f);
  return f;
}

describe('varredura das 18h da Nilce', () => {
  beforeEach(() => {
    agendamentos = []; estado = {}; proximoId = 1;
    delete process.env.NILCE_18H_OFF;
    vi.useFakeTimers(); vi.setSystemTime(AGORA);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a grade dela é 8–11 e 13–16 de 30 em 30, com almoço fechado', () => {
    expect(GRADE_NILCE).toEqual([
      '08:00','08:30','09:00','09:30','10:00','10:30','11:00',
      '13:00','13:30','14:00','14:30','15:00','15:30','16:00',
    ]);
  });

  it('empacota do primeiro horário livre em diante, sem buraco', async () => {
    const a = ficha(), b = ficha(), c = ficha();
    const r = await runNilceVarredura18h();
    expect(r.movidas).toBe(3);
    expect(emSP(a.quando)).toBe('2026-08-21 08:00');
    expect(emSP(b.quando)).toBe('2026-08-21 08:30');
    expect(emSP(c.quando)).toBe('2026-08-21 09:00');
  });

  it('encaixa NOS MARCADOS: pula o que já está ocupado no dia', async () => {
    ficha({ quando: '2026-08-21T08:00:00-03:00' });   // já marcada amanhã 08:00
    ficha({ quando: '2026-08-21T09:00:00-03:00' });   // já marcada amanhã 09:00
    const parada = ficha();
    const outra = ficha();
    await runNilceVarredura18h();
    expect(emSP(parada.quando)).toBe('2026-08-21 08:30');   // o buraco entre as duas
    expect(emSP(outra.quando)).toBe('2026-08-21 09:30');    // o próximo buraco
  });

  it('lotou o dia? o resto vai pro dia seguinte', async () => {
    const paradas = Array.from({ length: 17 }, () => ficha());
    const r = await runNilceVarredura18h();
    expect(r.movidas).toBe(17);
    expect(emSP(paradas[13].quando)).toBe('2026-08-21 16:00');   // último da sexta
    expect(emSP(paradas[14].quando)).toBe('2026-08-24 08:00');   // segunda (pula o fim de semana)
    expect(emSP(paradas[16].quando)).toBe('2026-08-24 09:00');
    expect(r.dias_usados).toEqual(['2026-08-21', '2026-08-24']);
  });

  it('nunca marca em fim de semana nem feriado', async () => {
    vi.setSystemTime(new Date('2026-09-04T18:00:00-03:00'));   // sexta; 07/09 é feriado
    const f = ficha({ quando: '2026-09-04T09:00:00-03:00' });
    await runNilceVarredura18h();
    expect(emSP(f.quando)).toBe('2026-09-08 08:00');            // pula sáb, dom e a Independência
  });

  it('não toca ficha de outro consultor', async () => {
    const t = ficha({ vendedor_nome: 'Thiago' });
    const d = ficha({ vendedor_nome: 'Diego' });
    const r = await runNilceVarredura18h();
    expect(r.paradas).toBe(0);
    expect(t.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(d.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('quem teve ação fica parado onde está', async () => {
    const quente = ficha({ temperatura: 'quente' });
    const naoAtendeu = ficha({ status: 'nao_atendeu' });
    const semOrcamento = ficha({ status: 'sem_orcamento' });
    const futura = ficha({ quando: '2026-08-21T14:00:00-03:00' });
    const r = await runNilceVarredura18h();
    expect(r.movidas).toBe(0);
    expect(quente.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(naoAtendeu.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(semOrcamento.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(futura.quando).toBe('2026-08-21T14:00:00-03:00');
  });

  it('cliente que já tem horário futuro não ganha um segundo', async () => {
    const tel = '5534991234567';
    const velha = ficha({ cliente_telefone: tel });
    ficha({ cliente_telefone: tel, quando: '2026-08-25T10:00:00-03:00' });
    const r = await runNilceVarredura18h();
    expect(r.movidas).toBe(0);
    expect(velha.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('para na 3ª quicada — lead morto não fica dono do 08:00', async () => {
    const f = ficha();
    for (let i = 1; i <= 3; i++) {
      f.quando = '2026-08-20T09:00:00-03:00';
      expect((await runNilceVarredura18h()).movidas).toBe(1);
      expect(estado['nilce_18h:1'].vezes).toBe(i);
    }
    f.quando = '2026-08-20T09:00:00-03:00';
    const r = await runNilceVarredura18h();
    expect(r.movidas).toBe(0);
    expect(r.puladas_no_teto).toBe(1);
    expect(f.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('kill-switch para tudo; o dry mostra e não grava', async () => {
    const f = ficha();
    process.env.NILCE_18H_OFF = '1';
    expect((await runNilceVarredura18h()).off).toBe(true);
    expect(f.quando).toBe('2026-08-20T09:00:00-03:00');

    const seco = await runNilceVarredura18h({ dry: true });
    expect(seco.previa).toHaveLength(1);
    expect(seco.previa![0].para).toContain('21/08');
    expect(seco.movidas).toBe(0);
    expect(f.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('deixa rastro no histórico e mantém o que já estava lá', async () => {
    const f = ficha({ historico: 'liguei, caiu na caixa' });
    await runNilceVarredura18h();
    expect(f.historico).toMatch(/Fechamento do dia/);
    expect(f.historico).toMatch(/liguei, caiu na caixa/);
    expect(f.vendedor_nome).toBe('Nilce');   // nunca troca de dono
  });
});
