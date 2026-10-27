import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A chave do aviso de IA (avisoIA.ts) vale false em produção; estes testes exercitam o modo LIGADO e desligam a chave onde provam o desligado.
const aviso = vi.hoisted(() => ({ on: true }));
vi.mock('../services/agentes5040/avisoIA', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/avisoIA')>()),
  get AVISO_IA_NA_PRIMEIRA_MSG() { return aviso.on; },
}));

// B1d-2a, o robô de agenda da Duda (agendaEnvio.ts). Banco e WhatsApp simulados na memória. Prova: o texto exato
// de cada bolha fixa (<= 160), montado NA HORA DO ENVIO a partir do ISO do item; o card relido (mudou ou passou = descarta);
// pausa humana não sai e fica; linha caída não sai e fica; espaçamento (25 s + sorteio, ou 10 s no último momento útil) medido no banco; reserva duplicada não
// reenvia; o teto das agentes cheio NÃO segura; a janela das 7h às 21h e a rodada própria da fila (trava com token);
// nada de telefone no que se grava nem no log; no máximo 3 por chamada. A contagem é a das chamadas ao sendHuman.

type Linha = { value: any; updated_at: string };

const h = vi.hoisted(() => ({
  estado: new Map<string, Linha>(),
  cards: new Map<number, { cliente_telefone: string | null; status: string | null; quando: string | null; vendedor_nome?: string | null }>(),
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
  rebaixados: [] as number[],
  posse: { dona: 'duda', estado: 'viva', apresentada: true } as any,
  posseErro: false,
  posseAtualizacoes: [] as any[],
  posseLeituras: [] as string[],
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

// A posse (aviso de IA, 22/10): por padrão a Duda já se apresentou (apresentada: true), então os textos dos outros testes ficam como eram.
vi.mock('../services/agentes5040/posse', () => ({
  lerPosse: vi.fn(async (chave: string) => { h.posseLeituras.push(chave); if (h.posseErro) throw new Error('posse: XX000'); return h.posse; }),
  atualizarPosse: vi.fn(async (_c: string, patch: any) => { h.posseAtualizacoes.push(patch); if (h.posse) h.posse = { ...h.posse, ...patch }; return true; }),
}));

vi.mock('../services/agentes5040/agendaSolar', () => ({
  marcarBoasVindasEnviada: vi.fn(async (id: number) => { h.boasVindas.push(id); return true; }),
  rebaixarSaiuAMudo: vi.fn(async (id: number) => { h.rebaixados.push(id); return true; }),
}));

import {
  enfileirarAgenda, enviarAgendaPendente, montarBolhaAgenda, chaveFila, chaveCarimboAgenda, isoCompacto, runAgendaTick, TEMPOS_AGENDA, LIMITES_AGENDA,
  type PedidoAgenda,
} from '../services/agentes5040/agendaEnvio';
import { sendHuman } from '../services/agents/zapiClient';
const SORTEIO_REAL = TEMPOS_AGENDA.sorteio;
import { STATUS_QUE_NAO_RECEBEM } from '../services/agenda/solarStatus';
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
/** A volta honesta: quando = o aviso do "ligar agora" (6 min atrás), as duas vagas em ISO, validade de 40 min depois do aviso. */
const pedidoVolta = (extra: Partial<PedidoAgenda> = {}): PedidoAgenda => ({
  tipo: 'volta', cardId: 503, telefone: TEL, quando: ant(6 * MIN), validoAte: dep(24 * MIN), consultora: 'Ana', opcoes: [VAGA1, VAGA2], ...extra,
});

const esperas: number[] = [];

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.estado.clear(); h.cards.clear(); h.enviados.length = 0; h.falhas.length = 0; esperas.length = 0; h.leiturasFila = 0;
  h.cooldown = false; h.pode = { pode: true, motivo: 'sem-pausa' }; h.bloqueado = false; h.motivos = [];
  h.escondeCarimbo = false; h.falhaCard = false; h.aposEnvio = null; h.boasVindas.length = 0; h.rebaixados.length = 0;
  h.posse = { dona: 'duda', estado: 'viva', apresentada: true }; h.posseErro = false; h.posseAtualizacoes.length = 0; h.posseLeituras.length = 0;
  for (const id of [501, 502, 503, 504, 505, 506]) h.cards.set(id, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
  TEMPOS_AGENDA.esperar = async (ms: number) => { esperas.push(ms); };
  TEMPOS_AGENDA.sorteio = () => 0;   // determinístico: o sorteio de 0 a 35 s tem teste próprio
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
      [pedidoVolta({ cardId: 503 }), 'Se a Ana ainda não conseguiu te ligar, deixo marcado: hoje às 15h ou amanhã às 9h. Qual fica melhor?'],
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

  it('espaçamento: último envio da linha há 4 s (ag5040_sent) completa a espera de 21 s (25 s de base) e carimba na hora certa', async () => {
    h.estado.set('ag5040_sent:9:1', { value: { estado: 'enviado' }, updated_at: ant(4_000) });
    await enfileirarAgenda(pedido(), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r.enviadas).toBe(1);
    expect(esperas).toEqual([21_000]);
    expect(h.estado.get(chaveCarimboAgenda(501, 'confirma', QUANDO))!.updated_at).toBe(new Date(AGORA.getTime() + 21_000).toISOString());
  });

  it('o sorteio de 0 a 35 s entra no espaçamento: com o sorteio no máximo a espera é de 56 s, e o item no último momento útil NÃO leva sorteio (10 s)', async () => {
    TEMPOS_AGENDA.sorteio = (max: number) => max;   // 35 s
    h.estado.set('ag5040_sent:9:1', { value: { estado: 'enviado' }, updated_at: ant(4_000) });
    await enfileirarAgenda(pedido(), AGORA);
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    expect(esperas).toEqual([56_000]);
    h.estado.clear(); esperas.length = 0;
    h.estado.set('ag5040_sent:9:1', { value: { estado: 'enviado' }, updated_at: ant(4_000) });
    await enfileirarAgenda(pedido({ validoAte: dep(20 * MIN) }), AGORA);                 // vence em menos de 30 min
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    expect(esperas).toEqual([6_000]);
    h.estado.clear(); esperas.length = 0;
    h.estado.set('ag5040_sent:9:1', { value: { estado: 'enviado' }, updated_at: ant(4_000) });
    await enfileirarAgenda(pedido({ validoAte: ant(5 * MIN) }), AGORA);                  // já venceu: agenda nunca bloqueia, sai com os 10 s
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    expect(esperas).toEqual([6_000]);
  });

  it('o sorteio real fica entre 0 e 35 s e varia', () => {
    const v = Array.from({ length: 300 }, () => SORTEIO_REAL(LIMITES_AGENDA.sorteioMs));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(35_000);
    expect(new Set(v).size).toBeGreaterThan(50);
  });

  it('o orçamento de 150 s mede também o tempo REAL: envios lentos (sem espera simulada) também cortam a chamada, sem descartar', async () => {
    const base = Date.now(); let relogio = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => base + relogio);
    try {
      h.aposEnvio = () => { relogio += 100_000; };          // cada envio "demora" 100 s de relógio real
      for (const id of [501, 502, 503]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
      const r = await enviarAgendaPendente(AGORA);
      expect(r).toMatchObject({ enviadas: 2, descartadas: 0, mantidas: 1, parou: 'tempo' });
      expect(esperas).toEqual([25_000]);                    // a 3ª (100 s + 100 s + 25 s) passaria dos 150 s
      expect(fila()).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });

  it('a ordem é a do validoAte: o que vence antes sai antes, mesmo entrando depois na fila', async () => {
    await enfileirarAgenda(pedido({ cardId: 501, tipo: 'confirma', validoAte: dep(5 * HORA) }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca', validoAte: dep(1 * HORA) }), new Date(AGORA.getTime() + 1_000));
    await enfileirarAgenda(pedido({ cardId: 504, tipo: 'confirma', validoAte: dep(3 * HORA) }), new Date(AGORA.getTime() + 2_000));
    const r = await enviarAgendaPendente(AGORA);
    expect(r.enviadas).toBe(3);
    const ordem = [502, 504, 501].map(id => id === 502 ? chaveCarimboAgenda(502, 'remarca', QUANDO) : chaveCarimboAgenda(id, 'confirma', QUANDO));
    const marcas = ordem.map(k => Date.parse(h.estado.get(k)!.updated_at));
    expect(marcas[0]).toBeLessThan(marcas[1]!);
    expect(marcas[1]).toBeLessThan(marcas[2]!);
    expect(textos()[0]).toContain('mudei');
  });

  it('cabe no tempo da rota: a espera que passaria do orçamento da chamada deixa o resto na fila (parou: tempo), sem descartar', async () => {
    TEMPOS_AGENDA.sorteio = (max: number) => max;
    h.estado.set('ag5040_sent:9:1', { value: { estado: 'enviado' }, updated_at: ant(1_000) });   // a 1ª espera 59 s, a 2ª 60 s, a 3ª passaria de 150 s
    for (const id of [501, 502, 503]) await enfileirarAgenda(pedido({ cardId: id }), AGORA);
    const r = await enviarAgendaPendente(AGORA);
    expect(r).toMatchObject({ enviadas: 2, descartadas: 0, mantidas: 1, parou: 'tempo' });
    expect(esperas).toEqual([59_000, 60_000]);
    expect(fila()).toHaveLength(1);
    expect(LIMITES_AGENDA.orcamentoMs + 3 * 15_000).toBeLessThan(LIMITES_AGENDA.travaMs);   // a trava cobre a rodada inteira
    expect(LIMITES_AGENDA.travaMs).toBeLessThan(300_000);                                   // e vence antes da função
  });

  it('espaçamento também olha o carimbo de agenda, e sem envio recente não espera', async () => {
    h.estado.set('ag5040_agenda_sent:7:confirma:20261021T100000Z', { value: { estado: 'enviado' }, updated_at: ant(9_000) });
    await enfileirarAgenda(pedido(), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(esperas).toEqual([16_000]);
    h.estado.clear(); esperas.length = 0;
    await enfileirarAgenda(pedido({ cardId: 502 }), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(esperas).toEqual([]);
  });

  it('espaçamento vale contra QUALQUER envio da linha (agenda do eletroposto, Giovanna, aviso, ficha, aviso ao grupo do SolarDoc)', async () => {
    for (const [prefixo, ms, esperado] of [['ep_agenda_sent:', 3_000, 22_000], ['solar_giovanna_sent:', 8_000, 17_000], ['aviso_sent:', 5_000, 20_000], ['ficha_lead:', 1_000, 24_000], ['solardoc_aviso_sent:', 4_000, 21_000]] as const) {
      h.estado.clear(); esperas.length = 0;
      h.estado.set(`${prefixo}x:1`, { value: {}, updated_at: ant(ms) });
      await enfileirarAgenda(pedido(), AGORA);
      expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
      expect(esperas, prefixo).toEqual([esperado]);
    }
  });

  it('dois na mesma chamada saem espaçados 25 s um do outro (sorteio zerado)', async () => {
    await enfileirarAgenda(pedido({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ cardId: 502, tipo: 'remarca' }), AGORA);
    await enviarAgendaPendente(AGORA);
    const a = Date.parse(h.estado.get(chaveCarimboAgenda(501, 'confirma', QUANDO))!.updated_at);
    const b = Date.parse(h.estado.get(chaveCarimboAgenda(502, 'remarca', QUANDO))!.updated_at);
    expect(Math.abs(b - a)).toBe(25_000);
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
    const r2 = await enviarAgendaPendente(new Date(AGORA.getTime() + 90_000));
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
    expect(textos()).toEqual(Array(2).fill('Se a Ana ainda não conseguiu te ligar, deixo marcado: hoje às 15h ou amanhã às 9h. Qual fica melhor?'));
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
    const ate = Date.parse(h.estado.get('ag5040_linha_pausa')!.value.ate);       // 15 min contados do relógio da chamada (+ o espaçamento de 25 s)
    expect(ate).toBeGreaterThanOrEqual(AGORA.getTime() + 15 * MIN);
    expect(ate).toBeLessThanOrEqual(AGORA.getTime() + 15 * MIN + 25_000);
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

describe('agendaEnvio: a abertura do card do quiz (tipo abertura)', () => {
  // Quinta 22/10 às 14h30 (Brasília), vista de quarta 21/10: "amanhã às 14h30".
  const ab = (extra: Partial<PedidoAgenda> = {}): PedidoAgenda => pedido({ tipo: 'abertura', caminho: 'ligacao', nome: 'Irineu', ...extra });

  it('sai o texto fixo do caminho, com o nome, a consultora e o horário montado no envio; o carimbo é o da agenda e as boas-vindas NÃO são carimbadas de novo', async () => {
    for (const [id, caminho] of [[501, 'ligacao'], [502, 'video'], [503, 'vistoria']] as const) {
      h.cards.set(id, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
      expect((await enfileirarAgenda(ab({ cardId: id, caminho }), AGORA)).ok).toBe(true);
    }
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 3, descartadas: 0, mantidas: 0 });
    expect(textos()).toEqual([
      'Oi, Irineu! Aqui é a Duda, do atendimento com IA da Irmãos na Obra. *Giovanna* te liga amanhã às 14h30. É uma ligação curta para entender sua conta.',
      'Oi, Irineu! Aqui é a Duda, do atendimento com IA da Irmãos na Obra. *Giovanna* te chama por vídeo amanhã às 14h30. Responda SIM para confirmar.',
      'Oi, Irineu! Aqui é a Duda, do atendimento com IA da Irmãos na Obra. *Giovanna* vai aí amanhã às 14h30, visita técnica. Responda SIM para confirmar.',
    ]);
    for (const e of h.enviados) { expect(e.partes).toHaveLength(1); expect(e.inst).toBe('io'); expect(e.opts).toEqual({ maxBolhas: 1, max: 160 }); }
    expect(carimbos()).toEqual([501, 502, 503].map(id => chaveCarimboAgenda(id, 'abertura', QUANDO)).sort());
    expect(h.boasVindas).toEqual([]);
    expect(fila()).toEqual([]);
  });

  it('a fila guarda o caminho e o primeiro nome, nunca o telefone nem o texto pronto', async () => {
    await enfileirarAgenda(ab({ nome: 'Irineu de Almeida' }), AGORA);
    const v = h.estado.get(chaveFila(501, 'abertura', QUANDO))!.value;
    expect(v).toMatchObject({ tipo: 'abertura', caminho: 'ligacao', nome: 'Irineu', quando: QUANDO, descarta_em: QUANDO });
    expect(JSON.stringify(v)).not.toMatch(/5534991360223|amanhã|14h30|Aqui é a Duda/);
  });

  it('enfileirar recusa caminho que não existe e bolha que não cabe nem sem nome e sem asteriscos', async () => {
    expect(await enfileirarAgenda(ab({ caminho: 'curioso' }), AGORA)).toEqual({ ok: false, motivo: 'pedido_invalido' });
    expect(await enfileirarAgenda(ab({ caminho: undefined }), AGORA)).toEqual({ ok: false, motivo: 'pedido_invalido' });
    expect(await enfileirarAgenda(ab({ cardId: 502, caminho: 'vistoria', consultora: 'Maria' + 'a'.repeat(60) }), AGORA)).toEqual({ ok: false, motivo: 'bolha_invalida' });
    expect(await enfileirarAgenda(ab({ cardId: 503, consultora: '' }), AGORA)).toEqual({ ok: false, motivo: 'bolha_invalida' });
    expect(h.estado.size).toBe(0);
  });

  it('o reforço (reenvio depois de 5xx) não derruba a abertura: o texto é o mesmo', () => {
    const c = { consultora: 'Giovanna', caminho: 'video', nome: 'Irineu', quando: 'amanhã às 14h30' };
    expect(montarBolhaAgenda('abertura', c, true)).toBe(montarBolhaAgenda('abertura', c, false));
    expect(montarBolhaAgenda('abertura', c)).not.toBeNull();
  });

  it('agenda de verdade: o teto cheio das agentes e da linha NÃO a segura (só 7h-21h, pausa humana, linha caída, chave repetida e 10 s)', async () => {
    await enfileirarAgenda(ab(), AGORA);
    // 40 envios recentes das agentes e 70 da linha: nenhum teto pode segurar
    for (let i = 0; i < 40; i++) h.estado.set(`ag5040_sent:${i}:1`, { value: {}, updated_at: ant(30 * MIN) });
    for (let i = 0; i < 70; i++) h.estado.set(`solar_boasvindas_sent:${1000 + i}`, { value: {}, updated_at: ant(30 * MIN) });
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    expect(chamadas()).toBe(1);
  });

  it('pausa humana mantém na fila, e vence pela validade (= o horário do card)', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' };
    await enfileirarAgenda(ab(), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 0, mantidas: 1 });
    expect(fila()).toEqual([chaveFila(501, 'abertura', QUANDO)]);
    h.pode = { pode: true, motivo: 'sem-pausa' };
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
  });

  it('linha caída mantém na fila; fora das 7h às 21h não lê nada', async () => {
    h.cooldown = true;
    await enfileirarAgenda(ab(), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, mantidas: 1, parou: 'linha_pausada' });
    h.cooldown = false;
    expect(await enviarAgendaPendente(new Date('2026-10-22T01:30:00.000Z'))).toMatchObject({ enviadas: 0, parou: 'fora_da_janela' });   // 22h30 em Brasília
    expect(chamadas()).toBe(0);
    expect(fila()).toHaveLength(1);
  });

  it('card mudado de horário, cancelado ou com o horário já passado: descarta, sem enviar', async () => {
    await enfileirarAgenda(ab({ cardId: 501 }), AGORA);
    await enfileirarAgenda(ab({ cardId: 502 }), AGORA);
    await enfileirarAgenda(ab({ cardId: 503 }), AGORA);
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: '2026-10-23T13:00:00.000Z' });
    h.cards.set(502, { cliente_telefone: TEL, status: 'cancelado', quando: QUANDO });
    expect(await enviarAgendaPendente(new Date(Date.parse(QUANDO) + MIN))).toMatchObject({ enviadas: 0, descartadas: 3 });
    expect(chamadas()).toBe(0);
    expect(fila()).toEqual([]);
  });

  it('chave repetida: a abertura que já saiu não sai de novo, e enfileirar de novo recusa (ja_enviado)', async () => {
    await enfileirarAgenda(ab(), AGORA);
    await enviarAgendaPendente(AGORA);
    expect(await enfileirarAgenda(ab(), AGORA)).toEqual({ ok: false, motivo: 'ja_enviado' });
    expect(chamadas()).toBe(1);
  });
});

describe('agendaEnvio: abertura descartada deixa o marcador solar_bv_dedup e o card é relido (status e consultora)', () => {
  const ab = (extra: Partial<PedidoAgenda> = {}): PedidoAgenda => pedido({ tipo: 'abertura', caminho: 'ligacao', nome: 'Irineu', ...extra });
  const dedup = (id: number): string[] => [...h.estado.keys()].filter(k => k === `solar_bv_dedup:${id}`);
  const todosDedup = (): string[] => [...h.estado.keys()].filter(k => k.startsWith('solar_bv_dedup:')).sort();

  it('cada status que o solarBoasVindas não atende descarta a abertura SEM enviar, e deixa o marcador do card', async () => {
    for (const status of STATUS_QUE_NAO_RECEBEM) {
      h.estado.clear(); (sendHuman as any).mockClear();
      h.cards.set(501, { cliente_telefone: TEL, status, quando: QUANDO });
      await enfileirarAgenda(ab(), AGORA);
      expect(await enviarAgendaPendente(AGORA), status).toMatchObject({ enviadas: 0, descartadas: 1, mantidas: 0 });
      expect(chamadas(), status).toBe(0);
      expect(fila(), status).toEqual([]);
      expect(carimbos(), status).toEqual([]);
      expect(dedup(501), status).toEqual(['solar_bv_dedup:501']);
    }
  });

  it('abertura do card SAIU SEM MARCAR descartada na fila REBAIXA o card a MUDO; a abertura normal e a que sai não rebaixam (27/10/2026)', async () => {
    h.cards.set(501, { cliente_telefone: TEL, status: 'cancelado', quando: QUANDO });
    await enfileirarAgenda(ab({ saiu: true, consultora: 'Nilce' }), AGORA);
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: '2026-10-23T13:00:00.000Z' });   // horário mudou: descarta
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(h.rebaixados).toEqual([501]);
    h.estado.clear(); h.rebaixados.length = 0;
    h.cards.set(502, { cliente_telefone: TEL, status: 'fez_orcamento', quando: QUANDO });
    await enfileirarAgenda(ab({ cardId: 502 }), AGORA);                  // abertura normal descartada: nada de rebaixar
    expect((await enviarAgendaPendente(AGORA)).descartadas).toBe(1);
    h.cards.set(503, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
    await enfileirarAgenda(ab({ cardId: 503, saiu: true, consultora: 'Nilce' }), AGORA);     // a abertura SAIU que SAI mantém o card falando
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 1, descartadas: 0 });
    expect(h.rebaixados).toEqual([]);
    expect((sendHuman as any).mock.calls.at(-1)[1][0]).toContain('vai te ligar');
  });

  it('o status vem relido com maiúscula e espaço também; status que recebe (agendado, em_atendimento, nao_atendeu) sai normalmente', async () => {
    h.cards.set(501, { cliente_telefone: TEL, status: ' FECHOU ', quando: QUANDO });
    await enfileirarAgenda(ab(), AGORA);
    expect((await enviarAgendaPendente(AGORA)).descartadas).toBe(1);
    for (const [i, status] of (['agendado', 'em_atendimento', 'nao_atendeu'] as const).entries()) {
      h.cards.set(502 + i, { cliente_telefone: TEL, status, quando: QUANDO });
      await enfileirarAgenda(ab({ cardId: 502 + i }), AGORA);
    }
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 3, descartadas: 0 });
    expect(todosDedup()).toEqual(['solar_bv_dedup:501']);
  });

  it('confirma e remarca também conferem o status (descartam sem enviar), mas só a abertura grava o marcador', async () => {
    h.cards.set(501, { cliente_telefone: TEL, status: 'fez_orcamento', quando: QUANDO });
    h.cards.set(502, { cliente_telefone: TEL, status: 'apalavrado', quando: QUANDO });
    await enfileirarAgenda(pedido({ tipo: 'confirma', cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ tipo: 'remarca', cardId: 502 }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 2 });
    expect(chamadas()).toBe(0);
    expect(todosDedup()).toEqual([]);
  });

  it('a volta honesta só morre com o card cancelado: status de negociação não a segura', async () => {
    h.cards.set(503, { cliente_telefone: TEL, status: 'fez_orcamento', quando: null });
    await enfileirarAgenda(pedidoVolta({ cardId: 503 }), AGORA);
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
  });

  it('opt-out, bloqueio, pausa humana vencida, cancelado, horário passado, sem número e número trocado deixam o marcador; horário mudado não (o alarme acusa)', async () => {
    const casos: Array<[string, () => Promise<Date | void>]> = [
      ['opt_out', async () => { h.motivos = ['opt_out']; }],
      ['denuncia', async () => { h.motivos = ['denuncia']; }],
      ['bloqueado', async () => { h.bloqueado = true; }],
      ['pausa vencida', async () => { h.pode = { pode: false, motivo: 'humano-ativo' }; return new Date(AGORA.getTime() + 2 * HORA); }],
      ['horário mudou', async () => { h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: '2026-10-23T13:00:00.000Z' }); }],
      ['cancelado', async () => { h.cards.set(501, { cliente_telefone: TEL, status: 'cancelado', quando: QUANDO }); }],
      ['horário passado', async () => new Date(Date.parse(QUANDO) + MIN)],
      ['card sumiu', async () => { h.cards.delete(501); }],
      ['sem número', async () => { h.cards.set(501, { cliente_telefone: '123', status: 'agendado', quando: QUANDO }); }],
      ['número trocado', async () => { h.cards.set(501, { cliente_telefone: '5534988887777', status: 'agendado', quando: QUANDO }); }],
    ];
    for (const [nome, preparar] of casos) {
      h.estado.clear(); (sendHuman as any).mockClear();
      h.bloqueado = false; h.motivos = []; h.pode = { pode: true, motivo: 'sem-pausa' };
      h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
      await enfileirarAgenda(ab({ validoAte: dep(HORA) }), AGORA);
      const quando = (await preparar()) ?? AGORA;
      expect(await enviarAgendaPendente(quando), nome).toMatchObject({ enviadas: 0, descartadas: 1, mantidas: 0 });
      expect(chamadas(), nome).toBe(0);
      expect(fila(), nome).toEqual([]);
      expect(dedup(501), nome).toEqual(nome === 'horário mudou' ? [] : ['solar_bv_dedup:501']);
      expect(carimbos(), nome).toEqual([]);
    }
  });

  it('o marcador nunca leva o prefixo do carimbo da agenda (que conta nos tetos), nem telefone, nem texto', async () => {
    h.motivos = ['opt_out'];
    await enfileirarAgenda(ab(), AGORA);
    await enviarAgendaPendente(AGORA);
    const chaves = [...h.estado.keys()];
    expect(chaves).toEqual(['solar_bv_dedup:501']);
    expect(chaves.some(k => k.startsWith('ag5040_agenda_sent:'))).toBe(false);
    const linha = h.estado.get('solar_bv_dedup:501')!;
    expect(linha.value).toMatchObject({ origem: 'abertura_descartada', motivo: 'opt_out' });
    expect(JSON.stringify(linha)).not.toMatch(/5534991360223|Aqui é a Duda/);
  });

  it('número inválido na hora de enviar (HTTP 400/404 do destino): descarta e deixa o marcador; 5xx que pode ter chegado NÃO', async () => {
    await enfileirarAgenda(ab({ cardId: 501 }), AGORA);
    h.falhas.push(new Error('[zapi:io] HTTP 400 — {"error":"phone number invalid"}'));
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(dedup(501)).toEqual(['solar_bv_dedup:501']);
    expect(fila()).toEqual([]);
    // 5xx: o carimbo fica em falhou e o item espera o reenvio; sem marcador
    await enfileirarAgenda(ab({ cardId: 502 }), AGORA);
    h.falhas.push(new Error('Z-API HTTP 503'));
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, mantidas: 1 });
    expect(dedup(502)).toEqual([]);
  });

  it('abertura enviada, mantida na fila (pausa humana) ou vista no dry NÃO grava o marcador', async () => {
    await enfileirarAgenda(ab({ cardId: 501 }), AGORA);
    expect((await enviarAgendaPendente(AGORA)).enviadas).toBe(1);
    h.pode = { pode: false, motivo: 'humano-ativo' };
    await enfileirarAgenda(ab({ cardId: 502 }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, mantidas: 1, descartadas: 0 });
    h.pode = { pode: true, motivo: 'sem-pausa' };
    h.motivos = ['opt_out'];
    await enfileirarAgenda(ab({ cardId: 503 }), AGORA);
    await enviarAgendaPendente(AGORA, { dry: true });
    expect(todosDedup()).toEqual([]);
  });

  it('a consultora do texto é a do card AGORA (a ficha trocou de mãos depois do pedido); card sem consultora usa a do item', async () => {
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO, vendedor_nome: 'Nilce Souza' });
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO, vendedor_nome: 'Diego' });
    h.cards.set(503, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO, vendedor_nome: '  ' });
    await enfileirarAgenda(ab({ cardId: 501 }), AGORA);
    await enfileirarAgenda(pedido({ tipo: 'confirma', cardId: 502 }), AGORA);
    await enfileirarAgenda(ab({ cardId: 503 }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 3 });
    const t = textos();
    expect(t.some(x => x.includes('*Nilce* te liga') && !x.includes('Giovanna'))).toBe(true);
    expect(t).toContain('Ficou marcado para amanhã às 14h30. A Diego te liga nesse horário.');
    expect(t.some(x => x.includes('*Giovanna* te liga'))).toBe(true);
  });

  it('a consultora do card que não cabe nos 160 descarta a abertura (nada sai) e deixa o marcador', async () => {
    h.cards.set(501, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO, vendedor_nome: 'M' + 'a'.repeat(40) });
    await enfileirarAgenda(ab({ caminho: 'vistoria' }), AGORA);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 0, descartadas: 1 });
    expect(chamadas()).toBe(0);
    expect(dedup(501)).toEqual(['solar_bv_dedup:501']);
  });
});

describe('agendaEnvio: o aviso de IA na confirmação, na remarcação e na volta (22/10/2026)', () => {
  const FRASE = 'Aqui é a Duda, do atendimento com IA da Irmãos na Obra.';

  it('posse ainda não apresentada: a confirma sai com a frase na frente (até 160); o 1º envio grava apresentada e os seguintes saem sem a frase', async () => {
    h.posse = { dona: 'duda', estado: 'viva', apresentada: false };
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
    for (const p of [pedido({ tipo: 'confirma', cardId: 501 }), pedido({ tipo: 'remarca', cardId: 502 })]) expect((await enfileirarAgenda(p, AGORA)).ok).toBe(true);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 2 });
    expect(textos()[0]).toBe(`${FRASE} Ficou marcado para amanhã às 14h30. A Giovanna te liga nesse horário.`);
    expect(textos()[0]!.length).toBeLessThanOrEqual(160);
    // a posse virou apresentada no 1º envio: o 2º não repete a frase
    expect(textos()[1]).toBe('Pronto, mudei sua ligação para amanhã às 14h30. Quem liga é a Giovanna.');
    expect(h.posseAtualizacoes).toEqual([{ apresentada: true }]);
    expect(h.posseLeituras[0]).toBe('3491360223');   // a chave da posse é a chaveContato do telefone do card
  });

  it('cada tipo leva a frase quando a posse não está apresentada (remarca e volta também)', async () => {
    h.posse = { dona: 'duda', estado: 'viva', apresentada: false };
    expect((await enfileirarAgenda(pedido({ tipo: 'remarca', cardId: 502 }), AGORA)).ok).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()[0]).toBe(`${FRASE} Pronto, mudei sua ligação para amanhã às 14h30. Quem liga é a Giovanna.`);
    h.posse = { dona: 'duda', estado: 'viva', apresentada: false };
    h.estado.clear(); h.enviados.length = 0;
    expect((await enfileirarAgenda(pedidoVolta({ cardId: 503 }), AGORA)).ok).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()[0]).toBe(`${FRASE} Se a Ana ainda não conseguiu te ligar, deixo marcado: hoje às 15h ou amanhã às 9h. Qual fica melhor?`);
    expect(textos()[0]!.length).toBeLessThanOrEqual(160);
  });

  it('posse já apresentada: o texto fica como era e a posse não é tocada', async () => {
    expect((await enfileirarAgenda(pedido(), AGORA)).ok).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()).toEqual(['Ficou marcado para amanhã às 14h30. A Giovanna te liga nesse horário.']);
    expect(h.posseAtualizacoes).toEqual([]);
  });

  it('erro ao ler a posse (e posse que não existe): sai COM o aviso, o lado seguro', async () => {
    h.posseErro = true;
    expect((await enfileirarAgenda(pedido(), AGORA)).ok).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()[0]!.startsWith(FRASE)).toBe(true);
    h.posseErro = false; h.posse = null; h.estado.clear(); h.enviados.length = 0;
    expect((await enfileirarAgenda(pedido({ cardId: 502 }), AGORA)).ok).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()[0]!.startsWith(FRASE)).toBe(true);
  });

  it('a abertura não muda (ela já traz o aviso) e não mexe na posse', async () => {
    h.posse = { dona: 'duda', estado: 'viva', apresentada: false };
    expect((await enfileirarAgenda(pedido({ tipo: 'abertura', caminho: 'ligacao', nome: 'Ana' }), AGORA)).ok).toBe(true);
    await enviarAgendaPendente(AGORA);
    expect(textos()[0]!.match(/atendimento com IA/g)).toHaveLength(1);
    expect(h.posseAtualizacoes).toEqual([]);
    expect(h.posseLeituras).toEqual([]);
  });

  it('envio que falha (5xx) não marca apresentada; o dry não lê nem grava a posse de volta', async () => {
    h.posse = { dona: 'duda', estado: 'viva', apresentada: false };
    expect((await enfileirarAgenda(pedido(), AGORA)).ok).toBe(true);
    h.falhas.push(Object.assign(new Error('http_500'), { status: 500 }));
    await enviarAgendaPendente(AGORA);
    expect(h.posseAtualizacoes).toEqual([]);
    expect(h.posse.apresentada).toBe(false);
    h.estado.clear(); h.enviados.length = 0; h.falhas.length = 0;
    expect((await enfileirarAgenda(pedido({ cardId: 502 }), AGORA)).ok).toBe(true);
    expect(await enviarAgendaPendente(AGORA, { dry: true })).toMatchObject({ enviadas: 1 });
    expect(chamadas()).toBe(1);
    expect(h.posseAtualizacoes).toEqual([]);
  });

  it('não cabe em 160 com a frase: usa a versão curta (sem a consultora) e, se a volta tem datas longas, a curta da volta', () => {
    const campos = { dia: 'quinta, 23/10', hora: '14h30', consultora: 'Wilhelmina-Alexandrina-Maximiliana-Bartolomeu' };
    const longa = montarBolhaAgenda('confirma', campos, false, true);
    expect(longa).toBe(`${FRASE} Ficou marcado para quinta, 23/10 às 14h30. Te ligamos nesse horário.`);
    expect(montarBolhaAgenda('remarca', campos, false, true)).toBe(`${FRASE} Pronto, mudei sua ligação para quinta, 23/10 às 14h30.`);
    expect(montarBolhaAgenda('confirma', campos, true, true)).toBe(`${FRASE} Só reforçando: a sua ligação ficou para quinta, 23/10 às 14h30.`);
    const volta = montarBolhaAgenda('volta', { consultora: 'Ana', opcao1: 'segunda, 26/10 às 14h30', opcao2: 'terça, 27/10 às 14h30' }, false, true);
    // a versão cheia e a sem o nome estouram os 160 com a frase: cai para uma mais curta, que continua condicional
    expect(volta).toBe(`${FRASE} Se ela não ligou, deixo marcado: segunda, 26/10 às 14h30 ou terça, 27/10 às 14h30. Qual prefere?`);
    for (const b of [longa, volta]) expect(b!.length).toBeLessThanOrEqual(160);
    // pior caso da volta com a frase: consultora de nome longo e as duas opções em dias diferentes; cai no degrau curto e segue condicional
    const pior = montarBolhaAgenda('volta', { consultora: 'Wilhelmina-Alexandrina-Maximiliana-Bartolomeu', opcao1: 'quinta, 23/10 às 14h30', opcao2: 'sexta, 24/10 às 14h45' }, false, true)!;
    expect(pior.length).toBeLessThanOrEqual(160);
    expect(pior).toMatch(/ Se /);
    expect(pior).not.toMatch(/Posso ligar/);
    // sem o aviso o texto cheio segue o mesmo de antes
    expect(montarBolhaAgenda('confirma', { dia: 'hoje', hora: '9h', consultora: 'Ana' })).toBe('Ficou marcado para hoje às 9h. A Ana te liga nesse horário.');
  });
});

describe('agendaEnvio: chave do aviso de IA DESLIGADA (a de produção)', () => {
  beforeEach(() => { aviso.on = false; });
  afterEach(() => { aviso.on = true; });

  it('posse não apresentada: confirma, remarca e volta saem SEM a frase, e a posse nem é lida nem gravada', async () => {
    h.posse = { dona: 'duda', estado: 'viva', apresentada: false };
    h.cards.set(502, { cliente_telefone: TEL, status: 'agendado', quando: QUANDO });
    for (const p of [pedido({ tipo: 'confirma', cardId: 501 }), pedido({ tipo: 'remarca', cardId: 502 })]) expect((await enfileirarAgenda(p, AGORA)).ok).toBe(true);
    expect(await enviarAgendaPendente(AGORA)).toMatchObject({ enviadas: 2 });
    expect(textos()[0]).toBe('Ficou marcado para amanhã às 14h30. A Giovanna te liga nesse horário.');
    expect(textos().join(' ')).not.toMatch(/atendimento com IA/);
    expect(h.posseAtualizacoes).toEqual([]);
    expect(h.posseLeituras).toEqual([]);
  });
});
