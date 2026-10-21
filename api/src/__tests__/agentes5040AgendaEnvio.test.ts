import { describe, it, expect, vi, beforeEach } from 'vitest';

// B1d-2a, o robô de agenda da Duda (agendaEnvio.ts). Banco e WhatsApp simulados na memória. Prova: o texto exato
// de cada bolha fixa (<= 160), montado NA HORA DO ENVIO a partir do ISO do item; o card relido (mudou ou passou = descarta);
// pausa humana não sai e fica; linha caída não sai e fica; espaçamento de 10 s medido no banco; reserva duplicada não
// reenvia; o teto das agentes cheio NÃO segura; a janela das 7h às 21h e a rodada própria da fila (trava com token);
// nada de telefone no que se grava nem no log; no máximo 3 por chamada. A contagem é a das chamadas ao sendHuman.

type Linha = { value: any; updated_at: string };

const h = vi.hoisted(() => ({
  estado: new Map<string, Linha>(),
  cards: new Map<number, { cliente_telefone: string | null; status: string | null; quando: string | null }>(),
  leiturasFila: 0,
  enviados: [] as Array<{ tel: string; partes: string[]; inst: string; opts: any }>,
  falhas: [] as Array<Error | null>,
  cooldown: false,
  pode: { pode: true, motivo: 'sem-pausa' } as any,
  bloqueado: false,
  motivos: [] as string[],
  escondeCarimbo: false,
  falhaCard: false,
  aposEnvio: null as null | (() => void),
  boasVindas: [] as number[],
}));

function consulta(tabela: string) {
  let op = 'select'; let payload: any = null; let unico = false; let max: number | null = null; let selecionou = false;
  let ordem: { col: string; asc: boolean } | null = null; let id: number | null = null;
  const filtros: Array<(k: string, r: Linha) => boolean> = [];
  const q: any = {
    select: () => { selecionou = true; return q; },
    insert: (p: any) => { op = 'insert'; payload = p; return q; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return q; },
    update: (p: any) => { op = 'update'; payload = p; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (c: string, v: any) => {
      if (tabela === 'agendamentos') id = Number(v);
      else if (c === 'value->>token') filtros.push((_k, r) => r.value?.token === v);
      else filtros.push((k) => (c === 'key' ? k === v : true));
      return q;
    },
    lte: (_c: string, v: string) => { filtros.push((_k, r) => r.updated_at <= v); return q; },
    like: (_c: string, p: string) => { const pre = p.replace(/%$/, ''); filtros.push(k => k.startsWith(pre)); return q; },
    or: (expr: string) => {
      const pres = expr.split(',').map(x => x.replace(/^key\.like\./, '').replace(/%$/, ''));
      filtros.push(k => pres.some(pp => k.startsWith(pp))); return q;
    },
    order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { unico = true; return q; },
    then: (ok: (v: any) => any, ko?: (e: any) => any) => {
      let res: any;
      if (tabela === 'agendamentos') {
        const c = h.falhaCard ? undefined : h.cards.get(id ?? -1);
        res = h.falhaCard ? { data: null, error: { code: 'XX000' } } : { data: c ? { id, ...c } : null, error: null };
      } else if (op === 'insert') {
        if (h.estado.has(payload.key)) res = { data: null, error: { code: '23505' } };
        else { h.estado.set(payload.key, { value: payload.value, updated_at: payload.updated_at }); res = { data: null, error: null }; }
      } else if (op === 'upsert') {
        h.estado.set(payload.key, { value: payload.value, updated_at: payload.updated_at });
        res = { data: null, error: null };
      } else if (op === 'update') {
        const tocadas: Array<{ key: string }> = [];
        for (const [k, r] of [...h.estado.entries()].filter(([k, r]) => filtros.every(f => f(k, r)))) {
          h.estado.set(k, { value: payload.value ?? r.value, updated_at: payload.updated_at ?? r.updated_at });
          tocadas.push({ key: k });
        }
        res = { data: selecionou ? tocadas : null, error: null };
      } else if (op === 'delete') {
        for (const k of [...h.estado.keys()].filter(k => filtros.every(f => f(k, h.estado.get(k)!)))) h.estado.delete(k);
        res = { data: null, error: null };
      } else {
        if (tabela === 'system_state' && filtros.length === 1 && max === 1 && !ordem) h.leiturasFila++;
        let casa = [...h.estado.entries()].filter(([k, r]) => filtros.every(f => f(k, r)));
        if (h.escondeCarimbo && unico) casa = casa.filter(([k]) => !k.startsWith('ag5040_agenda_sent:'));
        if (ordem) {
          const o = ordem;
          casa.sort((a, b) => {
            const va = o.col === 'key' ? a[0] : a[1].updated_at; const vb = o.col === 'key' ? b[0] : b[1].updated_at;
            return (va < vb ? -1 : va > vb ? 1 : 0) * (o.asc ? 1 : -1);
          });
        }
        if (max !== null) casa = casa.slice(0, max);
        const rows = casa.map(([k, r]) => ({ key: k, value: r.value, updated_at: r.updated_at }));
        res = { data: unico ? (rows[0] ?? null) : rows, error: null };
      }
      return Promise.resolve(res).then(ok, ko);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  solardocViaIo: () => false,
  linhaEmCooldown: () => h.cooldown,
  sendHuman: vi.fn(async (tel: string, partes: string[], inst: string, opts: any) => {
    h.enviados.push({ tel, partes, inst, opts });
    const f = h.falhas.shift();
    if (f) throw f;
    h.aposEnvio?.();
  }),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: vi.fn(async () => h.pode),
}));
vi.mock('../services/agents/whatsapp/silenciar', async () => {
  const real = await vi.importActual<typeof import('../services/agents/whatsapp/silenciar')>('../services/agents/whatsapp/silenciar');
  return {
    ...real,
    estaBloqueado: vi.fn(async () => h.bloqueado),
    motivosDaSupressao: vi.fn(async () => [...h.motivos]),
  };
});

vi.mock('../services/agentes5040/agendaSolar', () => ({
  marcarBoasVindasEnviada: vi.fn(async (id: number) => { h.boasVindas.push(id); return true; }),
}));

import {
  enfileirarAgenda, enviarAgendaPendente, montarBolhaAgenda, chaveFila, chaveCarimboAgenda, isoCompacto, runAgendaTick, TEMPOS_AGENDA,
  type PedidoAgenda,
} from '../services/agentes5040/agendaEnvio';
import { sendHuman } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';

const AGORA = new Date('2026-10-21T15:00:00.000Z');                       // quarta, 12:00 em Brasília
const TEL = '5534991360223';
const ant = (ms: number): string => new Date(AGORA.getTime() - ms).toISOString();
const dep = (ms: number): string => new Date(AGORA.getTime() + ms).toISOString();
const MIN = 60_000; const HORA = 3_600_000;
// Quinta 22/10, 14h30 em Brasília: relativo à AGORA é "amanhã às 14h30".
const QUANDO = '2026-10-22T17:30:00.000Z';
const VAGA1 = '2026-10-21T18:00:00.000Z';                                  // hoje às 15h
const VAGA2 = '2026-10-22T12:00:00.000Z';                                  // amanhã às 9h
const chamadas = (): number => (sendHuman as any).mock.calls.length;
const fila = (): string[] => [...h.estado.keys()].filter(k => k.startsWith('ag5040_agenda_fila:')).sort();
const carimbos = (): string[] => [...h.estado.keys()].filter(k => k.startsWith('ag5040_agenda_sent:')).sort();
const textos = (): string[] => h.enviados.map(e => e.partes[0]!);

const pedido = (extra: Partial<PedidoAgenda> = {}): PedidoAgenda => ({
  tipo: 'confirma', cardId: 501, telefone: TEL, quando: QUANDO, validoAte: dep(2 * HORA), consultora: 'Giovanna', ...extra,
});
/** A volta honesta: quando = o aviso do "ligar agora" (6 min atrás), as duas vagas em ISO, validade de 30 min depois do aviso. */
const pedidoVolta = (extra: Partial<PedidoAgenda> = {}): PedidoAgenda => ({
  tipo: 'volta', cardId: 503, telefone: TEL, quando: ant(6 * MIN), validoAte: dep(24 * MIN), consultora: 'Ana', opcoes: [VAGA1, VAGA2], ...extra,
});

const esperas: number[] = [];

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.estado.clear(); h.cards.clear(); h.enviados.length = 0; h.falhas.length = 0; esperas.length = 0; h.leiturasFila = 0;
  h.cooldown = false; h.pode = { pode: true, motivo: 'sem-pausa' }; h.bloqueado = false; h.motivos = [];
  h.escondeCarimbo = false; h.falhaCard = false; h.aposEnvio = null; h.boasVindas.length = 0;
  for (const id of [501, 502, 503, 504, 505, 506]) h.cards.set(id, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
  TEMPOS_AGENDA.esperar = async (ms: number) => { esperas.push(ms); };
  (sendHuman as any).mockClear();
  (logger.error as any).mockClear();
});

describe('agendaEnvio: as bolhas fixas', () => {
  it('confirma, remarca e volta saem com o texto exato, montado NO ENVIO a partir do ISO, com as chaves preenchidas e até 160', async () => {
    const sexta = '2026-10-23T17:30:00.000Z';                               // sexta 23/10, 14h30
    const hoje16h = '2026-10-21T19:00:00.000Z';                             // hoje, 16h
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: sexta });
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: hoje16h });
    const casos: Array<[PedidoAgenda, string]> = [
      [pedido({ tipo: 'confirma', cardId: 501, quando: sexta }), 'Ficou marcado para sexta, 23/10 às 14h30. A Giovanna te liga nesse horário.'],
      [pedido({ tipo: 'remarca', cardId: 502, quando: hoje16h, consultora: 'Nilce Souza' }), 'Pronto, mudei sua ligação para hoje às 16h. Quem liga é a Nilce.'],
      [pedidoVolta({ cardId: 503 }), 'Consigo deixar a ligação marcada pra você: hoje às 15h ou amanhã às 9h. Qual fica melhor?'],
    ];
    for (const [p] of casos) expect((await enfileirarAgenda(p, AGORA)).ok).toBe(true);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 3, descartadas: 0, mantidas: 0 });
    expect(chamadas()).toBe(3);
    for (const [, texto] of casos) { expect(textos()).toContain(texto); expect(texto.length).toBeLessThanOrEqual(160); }
    for (const e of h.enviados) {
      expect(e.partes).toHaveLength(1);
      expect(e.inst).toBe('io');
      expect(e.opts).toEqual({ maxBolhas: 1, max: 160 });
      expect(e.tel).toBe(TEL);
    }
    expect(carimbos()).toEqual([
      `ag5040_agenda_sent:501:confirma:${isoCompacto(sexta)}`, `ag5040_agenda_sent:502:remarca:${isoCompacto(hoje16h)}`,
      `ag5040_agenda_sent:503:volta:${isoCompacto(ant(6 * MIN))}`,
    ]);
    expect(fila()).toEqual([]);
  });

  it('campo faltando, travessão ou mais de 160 não viram bolha', () => {
    expect(montarBolhaAgenda('confirma', { dia: 'hoje', hora: '', consultora: 'Ana' })).toBeNull();
    expect(montarBolhaAgenda('volta', { dia: '', hora: '', consultora: 'Ana', opcao1: 'amanhã às 9h' })).toBeNull();
    expect(montarBolhaAgenda('confirma', { dia: 'hoje — cedo', hora: '9h', consultora: 'Ana' })).toBeNull();
    expect(montarBolhaAgenda('remarca', { dia: 'x'.repeat(150), hora: '9h', consultora: 'Ana' })).toBeNull();
  });

  it('enfileirar recusa pedido inválido e bolha inválida, e não grava nada', async () => {
    expect(await enfileirarAgenda(pedido({ cardId: 0 }), AGORA)).toEqual({ ok: false, motivo: 'pedido_invalido' });
    expect(await enfileirarAgenda(pedido({ validoAte: 'ontem' }), AGORA)).toEqual({ ok: false, motivo: 'pedido_invalido' });
    expect(await enfileirarAgenda(pedido({ quando: 'ontem' }), AGORA)).toEqual({ ok: false, motivo: 'pedido_invalido' });
    expect(await enfileirarAgenda(pedidoVolta({ opcoes: undefined }), AGORA)).toEqual({ ok: false, motivo: 'pedido_invalido' });
    expect(await enfileirarAgenda(pedido({ consultora: '' }), AGORA)).toEqual({ ok: false, motivo: 'bolha_invalida' });
    expect(h.estado.size).toBe(0);
  });
});

describe('agendaEnvio: a fila guarda o ISO, nunca o texto (correção 1)', () => {
  it('"hoje", "amanhã", o dia e a hora são montados quando a bolha SAI, não quando entrou na fila', async () => {
    await enfileirarAgenda(pedido(), AGORA);                                // na fila, a ligação é "amanhã"
    const valor = h.estado.get(chaveFila(501, 'confirma', QUANDO))!.value;
    expect(JSON.stringify(valor)).not.toMatch(/amanhã|14h30|hoje/);
    expect(valor.quando).toBe(QUANDO);
    const nodia = new Date('2026-10-22T12:00:00.000Z');                     // no dia da ligação, 9h em Brasília
    expect((await enviarAgendaPendente(nodia)).enviadas).toBe(1);
    expect(textos()).toEqual(['Ficou marcado para hoje às 14h30. A Giovanna te liga nesse horário.']);
  });

  it('a chave leva o ISO compacto: a 2ª remarcação do mesmo card não colide com a 1ª, e +00:00 e .000Z são a mesma chave', async () => {
    const outra = '2026-10-23T13:00:00.000Z';
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
    expect((await enfileirarAgenda(pedido({ tipo: 'remarca', cardId: 502 }), AGORA)).ok).toBe(true);
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    // o mesmo card remarcado de novo, para outro horário: outra chave de fila e outro carimbo
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: outra });
    expect((await enfileirarAgenda(pedido({ tipo: 'remarca', cardId: 502, quando: outra }), AGORA)).ok).toBe(true);
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    expect(carimbos()).toEqual([
      `ag5040_agenda_sent:502:remarca:${isoCompacto(QUANDO)}`, `ag5040_agenda_sent:502:remarca:${isoCompacto(outra)}`,
    ].sort());
    expect(chamadas()).toBe(2);
    expect(isoCompacto('2026-10-22T17:30:00+00:00')).toBe(isoCompacto('2026-10-22T17:30:00.000Z'));
    expect(isoCompacto(QUANDO)).toBe('20261022T173000Z');
    expect(chaveFila(7, 'confirma', QUANDO)).toBe('ag5040_agenda_fila:7:confirma:20261022T173000Z');
  });

  it('o card mudou de horário depois do pedido: descarta, sem enviar (o card mudou)', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: '2026-10-23T13:00:00.000Z' });
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('o card relido com o horário no formato do banco (+00:00) conta como o mesmo horário', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: '2026-10-22T17:30:00+00:00' });
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
  });

  it('o horário da ligação já passou: confirma e remarca são descartados, sem enviar', async () => {
    const logo = dep(HORA);
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: logo });
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: logo });
    await enfileirarAgenda(pedido({ cardId: 501, quando: logo }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca', quando: logo }), AGORA);
    const r = await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * HORA));
    expect(r).toMatchObject({ enviadas: 0, descartadas: 2 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('a volta sai até 2 h depois do aviso e é descartada depois disso (e a vaga que já passou também a mata)', async () => {
    await enfileirarAgenda(pedidoVolta({ cardId: 503, validoAte: dep(HORA) }), AGORA);
    expect((await enviarAgendaPendente(new Date(AGORA.getTime() + 90 * MIN))).enviadas).toBe(1);     // 1h24 depois do aviso
    h.estado.clear(); (sendHuman as any).mockClear();
    await enfileirarAgenda(pedidoVolta({ cardId: 504, validoAte: dep(HORA) }), AGORA);
    const r = await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * HORA));                    // 2h06 depois do aviso
    expect(r).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
    h.estado.clear();
    await enfileirarAgenda(pedidoVolta({ cardId: 505, validoAte: dep(HORA) }), AGORA);
    expect(await enviarAgendaPendente(new Date(AGORA.getTime() + 3 * HORA + 30 * MIN))).toMatchObject({ enviadas: 0, descartadas: 1 });   // a vaga das 15h já passou
  });

  it('a janela das 7h às 21h (Brasília) mora DENTRO de enviarAgendaPendente: fora dela nada é lido nem enviado', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    for (const hora of ['2026-10-21T02:00:00.000Z', '2026-10-21T09:59:00.000Z', '2026-10-22T00:00:00.000Z']) {
      expect(await enviarAgendaPendente(new Date(hora)), hora).toMatchObject({ enviadas: 0, descartadas: 0, mantidas: 0, parou: 'fora_da_janela' });
    }
    expect(chamadas()).toBe(0);
    expect(fila()).toHaveLength(1);
    expect((await enviarAgendaPendente(new Date('2026-10-21T10:00:00.000Z'))).enviadas).toBe(1);   // 7h em Brasília
  });
});

describe('agendaEnvio: o que para o envio', () => {
  it('o validoAte NÃO descarta por tempo: no fim útil, sem pausa humana, o item sai (agenda nunca bloqueia)', async () => {
    await enfileirarAgenda(pedido({ validoAte: dep(5 * MIN) }), AGORA);
    const r = await enviarAgendaPendente(new Date(AGORA.getTime() + 6 * HORA));                      // 18h em Brasília, ainda antes da ligação
    expect(r).toMatchObject({ enviadas: 1, descartadas: 0 });
    expect(chamadas()).toBe(1);
    expect(fila()).toEqual([]);
    expect(carimbos()).toEqual([chaveCarimboAgenda(501, 'confirma', QUANDO)]);
  });

  it('pausa humana não sai e o item fica na fila (vence pela validade)', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' };
    await enfileirarAgenda(pedido(), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 0, descartadas: 0, mantidas: 1 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([chaveFila(501, 'confirma', QUANDO)]);
    expect(carimbos()).toEqual([]);
    h.pode = { pode: true, motivo: 'sem-pausa' };
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
  });

  it('pausa humana ainda ativa DEPOIS do validoAte: descarta (a bolha perdeu o sentido), sem enviar', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' };
    await enfileirarAgenda(pedido({ validoAte: dep(5 * MIN) }), AGORA);
    const r = await enviarAgendaPendente(new Date(AGORA.getTime() + 10 * MIN));
    expect(r).toMatchObject({ enviadas: 0, descartadas: 1, mantidas: 0 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('linha em cooldown: não envia, não reserva e mantém TODA a fila para a volta', async () => {
    h.cooldown = true;
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca' }), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 0, descartadas: 0, mantidas: 2, parou: 'linha_pausada' });
    expect(chamadas()).toBe(0);
    expect(fila()).toHaveLength(2);
    expect(carimbos()).toEqual([]);
    h.cooldown = false;
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(2);
    expect(fila()).toEqual([]);
  });

  it('linha pausada pelos erros seguidos (ag5040_linha_pausa) também segura e mantém', async () => {
    h.estado.set('ag5040_linha_pausa', { value: { ate: dep(10 * MIN) }, updated_at: ant(MIN) });
    await enfileirarAgenda(pedido(), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, mantidas: 1, parou: 'linha_pausada' });
    expect(chamadas()).toBe(0);
    expect(fila()).toHaveLength(1);
    h.estado.set('ag5040_linha_pausa', { value: { ate: ant(MIN) }, updated_at: ant(20 * MIN) });
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
  });

  it('linha caída com o validoAte vencido: nada sai e o item fica; na volta da linha ele sai', async () => {
    h.cooldown = true;
    await enfileirarAgenda(pedido({ cardId: 501, validoAte: dep(MIN) }), AGORA);
    const tarde = new Date(AGORA.getTime() + 2 * HORA);
    await enviarAgendaPendente(tarde);
    expect(chamadas()).toBe(0);
    expect(fila()).toHaveLength(1);
    h.cooldown = false;
    expect((await enviarAgendaPendente(tarde)).enviadas).toBe(1);
  });

  it('a linha é relida antes de CADA envio: caiu depois do 1º, o 2º fica na fila', async () => {
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca' }), AGORA);
    h.aposEnvio = () => { h.estado.set('ag5040_linha_pausa', { value: { ate: dep(20 * MIN) }, updated_at: AGORA.toISOString() }); };
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 1, mantidas: 1, parou: 'linha_pausada' });
    expect(chamadas()).toBe(1);
    expect(fila()).toEqual([chaveFila(502, 'remarca', QUANDO)]);
    expect(carimbos()).toEqual([chaveCarimboAgenda(501, 'confirma', QUANDO)]);
  });

  it('espaçamento: último envio da linha há 4 s (ag5040_sent) completa a espera de 6 s e carimba na hora certa', async () => {
    h.estado.set('ag5040_sent:9:1', { value: { estado: 'enviado' }, updated_at: ant(4_000) });
    await enfileirarAgenda(pedido(), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r.enviadas).toBe(1);
    expect(esperas).toEqual([6_000]);
    expect(h.estado.get(chaveCarimboAgenda(501, 'confirma', QUANDO))!.updated_at).toBe(new Date(AGORA.getTime() + 6_000).toISOString());
  });

  it('espaçamento também olha o carimbo de agenda, e sem envio recente não espera', async () => {
    h.estado.set('ag5040_agenda_sent:7:confirma:20261021T100000Z', { value: { estado: 'enviado' }, updated_at: ant(9_000) });
    await enfileirarAgenda(pedido(), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(esperas).toEqual([1_000]);
    h.estado.clear(); esperas.length = 0;
    await enfileirarAgenda(pedido({ cardId: 502 }), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(esperas).toEqual([]);
  });

  it('espaçamento vale contra QUALQUER envio da linha (agenda do eletroposto, Giovanna, aviso, ficha)', async () => {
    for (const [prefixo, ms, esperado] of [['ep_agenda_sent:', 3_000, 7_000], ['solar_giovanna_sent:', 8_000, 2_000], ['aviso_sent:', 5_000, 5_000], ['ficha_lead:', 1_000, 9_000]] as const) {
      h.estado.clear(); esperas.length = 0;
      h.estado.set(`${prefixo}x:1`, { value: {}, updated_at: ant(ms) });
      await enfileirarAgenda(pedido(), AGORA);
      expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
      expect(esperas, prefixo).toEqual([esperado]);
    }
  });

  it('dois na mesma chamada saem espaçados 10 s um do outro', async () => {
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca' }), AGORA);
    await enviarAgendaPendente(AGORA);
    const a = Date.parse(h.estado.get(chaveCarimboAgenda(501, 'confirma', QUANDO))!.updated_at);
    const b = Date.parse(h.estado.get(chaveCarimboAgenda(502, 'remarca', QUANDO))!.updated_at);
    expect(Math.abs(b - a)).toBe(10_000);
  });

  it('reserva duplicada não reenvia: carimbo já existente tira da fila sem enviar', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.estado.set(chaveCarimboAgenda(501, 'confirma', QUANDO), { value: { estado: 'enviado' }, updated_at: ant(HORA) });
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('corrida: o carimbo aparece entre a leitura e o INSERT (23505) e nada sai', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.estado.set(chaveCarimboAgenda(501, 'confirma', QUANDO), { value: { estado: 'reservado' }, updated_at: ant(HORA) });
    h.escondeCarimbo = true; // a leitura de checagem não o vê; o INSERT bate no índice
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('enfileirar de novo depois que saiu é recusado (ja_enviado)', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(await enfileirarAgenda(pedido(), AGORA)).toEqual({ ok: false, motivo: 'ja_enviado' });
    expect(fila()).toEqual([]);
  });

  it('card cancelado, sumido ou sem telefone: descarta sem enviar; opt-out e bloqueio também', async () => {
    h.cards.set(501, { cliente_telefone: TEL, status: 'cancelado', quando: QUANDO });
    h.cards.delete(502);
    h.cards.set(503, { cliente_telefone: null, status: 'agendado', quando: QUANDO });
    for (const id of [501, 502, 503]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 3 });
    h.motivos = ['opt_out'];
    await enfileirarAgenda(pedido({ cardId: 504 }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    h.motivos = []; h.bloqueado = true;
    await enfileirarAgenda(pedido({ cardId: 505 }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('o card mudou de número depois do pedido: não envia para o número novo', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.cards.set(501, { cliente_telefone: '5534988887777', status: 'agendado', quando: QUANDO });
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
  });

  it('leitura do card que falha mantém o item (não perde a confirmação)', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.falhaCard = true;
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 0, mantidas: 1 });
    expect(fila()).toHaveLength(1);
  });
});

describe('agendaEnvio: regra "agenda nunca bloqueia"', () => {
  it('teto das agentes cheio (20 na hora e 120 em 24 h) NÃO segura, e o teto de emergência cheio também não', async () => {
    for (let i = 0; i < 125; i++) h.estado.set(`ag5040_sent:${1000 + i}:1`, { value: { estado: 'enviado' }, updated_at: ant(i < 22 ? 5 * MIN + i : 2 * HORA) });
    for (let i = 0; i < 70; i++) h.estado.set(`ep_agenda_sent:${i}:manha`, { value: {}, updated_at: ant(20 * MIN) });
    await enfileirarAgenda(pedido(), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r.enviadas).toBe(1);
    expect(chamadas()).toBe(1);
  });

  it('o prazo de 15 min não vale: o item enfileirado há horas sai se ainda é válido', async () => {
    await enfileirarAgenda(pedido({ validoAte: dep(3 * HORA) }), new Date(AGORA.getTime() - 2 * HORA));
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
  });

  it('no máximo 3 por chamada; o resto sai na chamada seguinte', async () => {
    for (const id of [501, 502, 503, 504, 505]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
    const r1 = await enviarAgendaPendente(AGORA);
    expect(r1).toMatchObject({ enviadas: 3, parou: 'limite' });
    expect(chamadas()).toBe(3);
    expect(fila()).toHaveLength(2);
    const r2 = await enviarAgendaPendente(new Date(AGORA.getTime() + 30_000));
    expect(r2.enviadas).toBe(2);
    expect(chamadas()).toBe(5);
    expect(fila()).toEqual([]);
  });
});

describe('agendaEnvio: boas-vindas do card novo', () => {
  it('depois que o confirma sai, carimba as boas-vindas do card; remarca e volta não', async () => {
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca' }), AGORA);
    await enfileirarAgenda(pedidoVolta({ cardId: 503 }), AGORA);
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(3);
    expect(h.boasVindas).toEqual([501]);
  });

  it('confirma que não saiu (pausa humana, linha caída) não carimba as boas-vindas', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' };
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enviarAgendaPendente(AGORA);
    h.pode = { pode: true, motivo: 'sem-pausa' }; h.cooldown = true;
    await enviarAgendaPendente(AGORA);
    expect(h.boasVindas).toEqual([]);
  });
});

describe('agendaEnvio: erro de envio e dado pessoal', () => {
  it('erro 5xx: o carimbo fica como falhou, o item fica na fila, o log só leva o código e a chamada para', async () => {
    h.falhas.push(new Error('Z-API HTTP 503 {"phone":"5534991360223"}'));
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502 }), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 0, mantidas: 1, parou: 'erro_de_envio' });
    expect(chamadas()).toBe(1);
    expect(h.estado.get(chaveCarimboAgenda(501, 'confirma', QUANDO))!.value).toMatchObject({ estado: 'falhou', erro: 'http_503', reenviavel: true });
    expect(fila()).toEqual([chaveFila(501, 'confirma', QUANDO), chaveFila(502, 'confirma', QUANDO)]);
    expect(h.boasVindas).toEqual([]);
    const log = JSON.stringify((logger.error as any).mock.calls);
    expect(log).toContain('http_503');
    expect(log).not.toContain('34991360223');
    expect(h.estado.get('ag5040_linha_erros')!.value.n).toBe(1);
  });

  it('erro 5xx: permite 1 reenvio com o texto de lembrete atrasado; falhando de novo, não há terceiro', async () => {
    const sexta = '2026-10-23T17:30:00.000Z';
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: sexta });
    h.falhas.push(new Error('Z-API HTTP 502'));
    await enfileirarAgenda(pedido({ cardId: 501, quando: sexta }), AGORA);
    await enviarAgendaPendente(AGORA);
    const r = await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * MIN));
    expect(r).toMatchObject({ enviadas: 1 });
    expect(h.enviados[1]!.partes).toEqual(['Só reforçando: a sua ligação ficou para sexta, 23/10 às 14h30, com a Giovanna.']);
    expect(h.enviados[1]!.partes[0]!.length).toBeLessThanOrEqual(160);
    expect(carimbos()).toEqual([chaveCarimboAgenda(501, 'confirma', sexta), `${chaveCarimboAgenda(501, 'confirma', sexta)}:re`]);
    expect(fila()).toEqual([]);
    expect(h.boasVindas).toEqual([501]);
    // o reenvio também falha: sem 3º envio
    h.estado.clear(); h.enviados.length = 0; (sendHuman as any).mockClear(); h.boasVindas.length = 0;
    h.falhas.push(new Error('timeout'), new Error('Z-API HTTP 500'));
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca' }), AGORA);
    await enviarAgendaPendente(AGORA);
    await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * MIN));
    await enviarAgendaPendente(new Date(AGORA.getTime() + 4 * MIN));
    expect(chamadas()).toBe(2);
    expect(h.enviados[1]!.partes[0]).toBe('Só reforçando: a sua ligação ficou para amanhã às 14h30, com a Giovanna.');
    expect(fila()).toEqual([]);
  });

  it('item enfileirado com reforço (a bolha do turno pode ter chegado): o 1º envio já é o "Só reforçando"', async () => {
    await enfileirarAgenda(pedido({ reforco: true }), AGORA);
    expect(h.estado.get(chaveFila(501, 'confirma', QUANDO))!.value.reforco).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()).toEqual(['Só reforçando: a sua ligação ficou para amanhã às 14h30, com a Giovanna.']);
    expect(carimbos()).toEqual([chaveCarimboAgenda(501, 'confirma', QUANDO)]);
  });

  it('erro 5xx na volta: o reenvio usa o mesmo texto da volta', async () => {
    h.falhas.push(new Error('Z-API HTTP 504'));
    await enfileirarAgenda(pedidoVolta({ cardId: 503 }), AGORA);
    await enviarAgendaPendente(AGORA);
    await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * MIN));
    expect(textos()).toEqual(Array(2).fill('Consigo deixar a ligação marcada pra você: hoje às 15h ou amanhã às 9h. Qual fica melhor?'));
  });

  it('erro 4xx (rejeitado): o carimbo fica, o item sai da fila e não há reenvio', async () => {
    h.falhas.push(new Error('Z-API HTTP 400 {"error":"Instance disconnected"}'));
    await enfileirarAgenda(pedido(), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1, parou: 'erro_de_envio' });
    const c = h.estado.get(chaveCarimboAgenda(501, 'confirma', QUANDO))!.value;
    expect(c).toMatchObject({ estado: 'falhou', erro: 'http_400' });
    expect(c.reenviavel).toBeUndefined();
    expect(fila()).toEqual([]);
    await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * MIN));
    expect(chamadas()).toBe(1);
  });

  it('número inválido (4xx do destino) isolado NÃO conta na pausa da linha: descarta só aquele item e segue', async () => {
    h.falhas.push(new Error('[zapi:io] HTTP 400 — {"error":"phone number invalid"}'));
    for (const id of [501, 502, 503]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 2, descartadas: 1 });
    expect(r.parou).not.toBe('erro_de_envio');
    expect(chamadas()).toBe(3);
    expect(h.estado.has('ag5040_linha_pausa')).toBe(false);
    expect(h.estado.get('ag5040_linha_erros')?.value?.n ?? 0).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('2º erro de destino SEGUIDO na chamada: para, o 3º item fica na fila e os dois contam como erro de linha (pausa de 15 min)', async () => {
    h.falhas.push(new Error('[zapi:io] HTTP 400 — {"error":"phone number invalid"}'), new Error('[zapi:io] HTTP 404 — {"error":"Phone not exists"}'));
    for (const id of [501, 502, 503]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 0, descartadas: 2, mantidas: 1, parou: 'erro_de_envio' });
    expect(chamadas()).toBe(2);
    expect(h.estado.get('ag5040_linha_erros')!.value.n).toBe(2);
    const ate = Date.parse(h.estado.get('ag5040_linha_pausa')!.value.ate);       // 15 min contados do relógio da chamada (+ o espaçamento de 10 s)
    expect(ate).toBeGreaterThanOrEqual(AGORA.getTime() + 15 * MIN);
    expect(ate).toBeLessThanOrEqual(AGORA.getTime() + 15 * MIN + 10_000);
    expect(fila()).toEqual([chaveFila(503, 'confirma', QUANDO)]);
  });

  it('erro de destino, envio ok e outro erro de destino: não são seguidos, a chamada não para', async () => {
    h.falhas.push(new Error('[zapi:io] HTTP 400 — x'), null as any, new Error('[zapi:io] HTTP 404 — y'));
    for (const id of [501, 502, 503, 504]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 2, descartadas: 2 });
    expect(r.parou).not.toBe('erro_de_envio');
    expect(fila()).toEqual([]);
  });

  it('erro que PROVA que nada saiu (cooldown): apaga a reserva e mantém o item para a volta da linha', async () => {
    h.falhas.push(new Error('linha io em cooldown'));
    await enfileirarAgenda(pedido(), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, mantidas: 1, parou: 'erro_de_envio' });
    expect(carimbos()).toEqual([]);
    expect(fila()).toHaveLength(1);
    expect((await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * MIN))).enviadas).toBe(1);
    expect(h.enviados[1]!.partes[0]).toMatch(/^Ficou marcado/); // texto normal, não o reforço
  });

  it('2 erros de linha seguidos gravam ag5040_linha_pausa por 15 min; envio ok zera o contador', async () => {
    h.falhas.push(new Error('Z-API HTTP 503'));
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(h.estado.get('ag5040_linha_erros')!.value.n).toBe(1);
    expect(h.estado.has('ag5040_linha_pausa')).toBe(false);
    h.falhas.push(new Error('Z-API HTTP 503'));
    await enviarAgendaPendente(new Date(AGORA.getTime() + 2 * MIN));
    expect(h.estado.get('ag5040_linha_erros')!.value.n).toBe(2);
    const pausa = h.estado.get('ag5040_linha_pausa')!.value;
    expect(Date.parse(pausa.ate)).toBe(AGORA.getTime() + 2 * MIN + 15 * MIN);
    // depois da pausa, um envio ok zera
    h.estado.delete('ag5040_linha_pausa'); h.estado.delete(chaveCarimboAgenda(501, 'confirma', QUANDO));
    await enfileirarAgenda(pedido({ cardId: 505 }), AGORA);
    await enviarAgendaPendente(new Date(AGORA.getTime() + 30 * MIN));
    expect(h.estado.get('ag5040_linha_erros')!.value.n).toBe(0);
  });

  it('nenhum telefone em chave ou value de system_state, antes e depois do envio, nem no log', async () => {
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedidoVolta({ cardId: 502 }), AGORA);
    const antes = JSON.stringify([...h.estado.entries()]);
    expect(antes).not.toContain('34991360223');
    expect(antes).not.toContain(TEL);
    expect(h.estado.get(chaveFila(501, 'confirma', QUANDO))!.value.tel_hmac).toMatch(/^[0-9a-f]{64}$/);
    h.falhas.push(new Error('falhou 5534991360223'));
    await enviarAgendaPendente(AGORA);
    const depois = JSON.stringify([...h.estado.entries()]);
    expect(depois).not.toContain('34991360223');
    expect(JSON.stringify((logger.error as any).mock.calls)).not.toContain('34991360223');
  });

  it('o telefone sai só no sendHuman, lido do card (a fila não o guarda)', async () => {
    h.cards.set(501, { cliente_telefone: '(34) 99136-0223', status: 'agendado', quando: QUANDO });
    await enfileirarAgenda(pedido({ cardId: 501, telefone: '34991360223' }), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(h.enviados[0]!.tel).toBe('34991360223');
  });
});

describe('agendaEnvio: a rodada própria da fila (runAgendaTick, correção 8)', () => {
  it('fila vazia = 1 leitura e mais nada; fora das 7h às 21h = zero leitura', async () => {
    const r = await runAgendaTick({ agora: AGORA });
    expect(r).toMatchObject({ ok: true, janela: true, comFila: false });
    expect(h.leiturasFila).toBe(1);
    expect([...h.estado.keys()]).toEqual([]);                               // nem trava nem nada
    h.leiturasFila = 0;
    await enfileirarAgenda(pedido(), AGORA);
    const noite = await runAgendaTick({ agora: new Date('2026-10-22T01:00:00.000Z') });
    expect(noite).toMatchObject({ ok: true, janela: false, comFila: false });
    expect(h.leiturasFila).toBe(0);
    expect(chamadas()).toBe(0);
  });

  it('com fila: toma a trava com token, entrega e solta a trava; roda sem nenhum *_vivo ligado', async () => {
    delete process.env.AGENTES5040_DUDA_VIVO;
    await enfileirarAgenda(pedido(), AGORA);
    const r = await runAgendaTick({ agora: AGORA });
    expect(r).toMatchObject({ ok: true, janela: true, comFila: true });
    expect(r.agenda).toMatchObject({ enviadas: 1 });
    expect(chamadas()).toBe(1);
    expect(h.estado.has('ag5040_agenda_trava')).toBe(false);                // solta no fim
    expect(fila()).toEqual([]);
  });

  it('trava ocupada (outra rodada em andamento): não envia nada; trava velha (mais de 120 s) é tomada', async () => {
    await enfileirarAgenda(pedido(), AGORA);
    h.estado.set('ag5040_agenda_trava', { value: { em: ant(30_000), token: 'outro' }, updated_at: ant(30_000) });
    const ocupada = await runAgendaTick({ agora: AGORA });
    expect(ocupada).toMatchObject({ ok: true, ocupada: true });
    expect(chamadas()).toBe(0);
    expect(h.estado.get('ag5040_agenda_trava')!.value.token).toBe('outro');   // a trava do outro não foi solta
    h.estado.set('ag5040_agenda_trava', { value: { em: ant(5 * MIN), token: 'velha' }, updated_at: ant(5 * MIN) });
    const tomada = await runAgendaTick({ agora: AGORA });
    expect(tomada.agenda).toMatchObject({ enviadas: 1 });
    expect(h.estado.has('ag5040_agenda_trava')).toBe(false);
  });

  it('?dry: não trava, não envia, não apaga da fila nem reserva carimbo; conta o que sairia', async () => {
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502 }), AGORA);
    const r = await runAgendaTick({ agora: AGORA, dry: true });
    expect(r).toMatchObject({ ok: true, dry: true, comFila: true });
    expect(r.agenda).toMatchObject({ enviadas: 2, descartadas: 0 });
    expect(chamadas()).toBe(0);
    expect(fila()).toHaveLength(2);
    expect(carimbos()).toEqual([]);
    expect(h.estado.has('ag5040_agenda_trava')).toBe(false);
    expect(esperas).toEqual([]);
  });
});
