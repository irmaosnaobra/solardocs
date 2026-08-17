import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 19h (ordem do Thiago, 17/08): o que a Nilce não atendeu PASSA PRA GIOVANNA e
// cai no próximo dia útil, encaixado na agenda DELA — e o que não couber vai pro
// dia seguinte. A Nilce fica com o novo e quente, a Giovanna treina no resto.
//
// O erro que este arquivo existe pra impedir é sutil: a ficha parada é lida da
// agenda da NILCE, mas a vaga tem que sair da agenda da GIOVANNA. Trocar uma pela
// outra grava em cima do que a Giovanna já tem marcado, e o índice único só
// pegaria a colisão exata. Junto com isso: não mexer em ficha de terceiro, não
// pôr duas no mesmo slot, não duplicar quem já tem horário futuro com qualquer
// uma das duas, e não marcar em fim de semana nem feriado.

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

import { runNilceParaGiovanna, GRADE_NILCE } from '../services/agenda/nilceParaGiovanna';

// "agora": QUINTA, 20/08/2026, 19h em Brasília. Próximo dia útil = sexta 21/08.
const AGORA = new Date('2026-08-20T19:00:00-03:00');
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

describe('19h: o que a Nilce não atendeu passa pra Giovanna', () => {
  beforeEach(() => {
    agendamentos = []; estado = {}; proximoId = 1;
    delete process.env.NILCE_19H_OFF;
    vi.useFakeTimers(); vi.setSystemTime(AGORA);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a grade dela é 8–11 e 13–16 de 30 em 30, com almoço fechado', () => {
    expect(GRADE_NILCE).toEqual([
      '08:00','08:30','09:00','09:30','10:00','10:30','11:00',
      '13:00','13:30','14:00','14:30','15:00','15:30','16:00',
    ]);
  });

  it('passa pra Giovanna e empacota do primeiro horário livre em diante', async () => {
    const a = ficha(), b = ficha(), c = ficha();
    const r = await runNilceParaGiovanna();
    expect(r.movidas).toBe(3);
    expect([a, b, c].map(f => f.vendedor_nome)).toEqual(['Giovanna', 'Giovanna', 'Giovanna']);
    expect(emSP(a.quando)).toBe('2026-08-21 08:00');
    expect(emSP(b.quando)).toBe('2026-08-21 08:30');
    expect(emSP(c.quando)).toBe('2026-08-21 09:00');
  });

  it('a vaga sai da agenda da GIOVANNA — não grava em cima do que ela já tem', async () => {
    ficha({ vendedor_nome: 'Giovanna', quando: '2026-08-21T08:00:00-03:00' });
    ficha({ vendedor_nome: 'Giovanna', quando: '2026-08-21T09:00:00-03:00' });
    const parada = ficha();
    const outra = ficha();
    await runNilceParaGiovanna();
    expect(emSP(parada.quando)).toBe('2026-08-21 08:30');   // o buraco entre as duas dela
    expect(emSP(outra.quando)).toBe('2026-08-21 09:30');    // o próximo buraco
  });

  it('agenda CHEIA da Nilce no dia seguinte não atrapalha: quem manda é a da Giovanna', async () => {
    // a Nilce pode ter o dia inteiro marcado — isso não tira vaga da Giovanna
    for (const h of ['08:00','08:30','09:00','09:30','10:00'])
      ficha({ quando: `2026-08-21T${h}:00-03:00` });
    const parada = ficha();
    await runNilceParaGiovanna();
    expect(parada.vendedor_nome).toBe('Giovanna');
    expect(emSP(parada.quando)).toBe('2026-08-21 08:00');   // livre PRA ELA
  });

  it('lotou o dia? o resto vai pro dia seguinte', async () => {
    const paradas = Array.from({ length: 17 }, () => ficha());
    const r = await runNilceParaGiovanna();
    expect(r.movidas).toBe(17);
    expect(emSP(paradas[13].quando)).toBe('2026-08-21 16:00');   // último da sexta
    expect(emSP(paradas[14].quando)).toBe('2026-08-24 08:00');   // segunda (pula o fim de semana)
    expect(emSP(paradas[16].quando)).toBe('2026-08-24 09:00');
    expect(r.dias_usados).toEqual(['2026-08-21', '2026-08-24']);
    expect(paradas.every(f => f.vendedor_nome === 'Giovanna')).toBe(true);
  });

  it('nunca marca em fim de semana nem feriado', async () => {
    vi.setSystemTime(new Date('2026-09-04T19:00:00-03:00'));   // sexta; 07/09 é feriado
    const f = ficha({ quando: '2026-09-04T09:00:00-03:00' });
    await runNilceParaGiovanna();
    expect(emSP(f.quando)).toBe('2026-09-08 08:00');            // pula sáb, dom e a Independência
  });

  it('não toca ficha do Thiago nem do Diego', async () => {
    const t = ficha({ vendedor_nome: 'Thiago' });
    const d = ficha({ vendedor_nome: 'Diego' });
    const r = await runNilceParaGiovanna();
    expect(r.paradas).toBe(0);
    expect(t.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(d.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('quem teve ação fica parado onde está', async () => {
    const quente = ficha({ temperatura: 'quente' });
    const naoAtendeu = ficha({ status: 'nao_atendeu' });
    const semOrcamento = ficha({ status: 'sem_orcamento' });
    const futura = ficha({ quando: '2026-08-21T14:00:00-03:00' });
    const r = await runNilceParaGiovanna();
    expect(r.movidas).toBe(0);
    expect(quente.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(naoAtendeu.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(semOrcamento.quando).toBe('2026-08-20T09:00:00-03:00');
    expect(futura.quando).toBe('2026-08-21T14:00:00-03:00');
  });

  it('cliente com horário futuro em QUALQUER uma das duas não ganha um segundo', async () => {
    const tel = '5534991234567';
    const velha = ficha({ cliente_telefone: tel });
    ficha({ vendedor_nome: 'Giovanna', cliente_telefone: tel, quando: '2026-08-25T10:00:00-03:00' });
    const r = await runNilceParaGiovanna();
    expect(r.movidas).toBe(0);
    expect(velha.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('a passagem é de mão única: ficha que já é da Giovanna não é varrida de novo', async () => {
    const f = ficha();
    expect((await runNilceParaGiovanna()).movidas).toBe(1);
    expect(f.vendedor_nome).toBe('Giovanna');

    // vence de novo na mão dela: o robô não mexe mais (só lê a agenda da Nilce)
    f.quando = '2026-08-20T09:00:00-03:00';
    const r = await runNilceParaGiovanna();
    expect(r.paradas).toBe(0);
    expect(r.movidas).toBe(0);
    expect(f.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('kill-switch para tudo; o dry mostra e não grava', async () => {
    const f = ficha();
    process.env.NILCE_19H_OFF = '1';
    expect((await runNilceParaGiovanna()).off).toBe(true);
    expect(f.quando).toBe('2026-08-20T09:00:00-03:00');

    const seco = await runNilceParaGiovanna({ dry: true });
    expect(seco.previa).toHaveLength(1);
    expect(seco.previa![0].para).toContain('21/08');
    expect(seco.movidas).toBe(0);
    expect(f.quando).toBe('2026-08-20T09:00:00-03:00');
  });

  it('deixa rastro no histórico e mantém o que já estava lá', async () => {
    const f = ficha({ historico: 'liguei, caiu na caixa' });
    await runNilceParaGiovanna();
    expect(f.historico).toMatch(/passou de Nilce para Giovanna/);
    expect(f.historico).toMatch(/liguei, caiu na caixa/);
  });
});
