import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A Helena de ponta a ponta, sem rede: banco em memória, Z-API e IA simuladas.
// O que se prova aqui é o que não tem segunda tentativa: os portões fecham na
// ordem certa, sai UM envio por chamada, leitura que falha não vira envio, e
// nenhuma resposta sai duas vezes.

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const banco = {
    main: { system_state: [] as Row[], wa_mensagens: [] as Row[], wa_lid_telefone: [] as Row[] } as Record<string, Row[]>,
    ger: { eletroposto_parceria: [] as Row[], eletroposto_nota1: [] as Row[], agendamentos: [] as Row[] } as Record<string, Row[]>,
  };
  return {
    banco,
    /** Tabelas cuja LEITURA falha. */
    falhaDeLeitura: new Set<string>(),
    /** Leitura em system_state cujo `like` começa por isto falha (só aquela, não a tabela inteira). */
    falhaDoLike: null as null | string,
    atualizacoes: [] as Array<{ tabela: string; patch: Row; id: unknown; or: string | null }>,
    linha: { teto: true, espaco: true, rampa: null as null | { hora: number; dia: number }, pedidosDeTeto: [] as unknown[] },
    filtros: {
      silenciados: new Set<string>(), pausados: new Set<string>(), mudos: new Set<string>(), mudosCom: null as number | null, antesDoClaim: null as null | (() => void),
      /** Leituras de bloqueio que falham: 'silenciados' | 'mudos' | 'bloqueados' | 'pausas'. */
      falha: new Set<string>(),
      /** Quais leituras foram pedidas em modo estrito. */
      estritas: [] as string[],
    },
    zap: { frio: [] as Array<{ tel: string; partes: string[] }>, humano: [] as Array<{ tel: string; partes: string[]; opts: any }>, equipe: [] as Array<{ tel: string; texto: string }>, erroNoFrio: false },
    ia: {
      resposta: '', fila: [] as string[], chamadas: 0, sistema: '', pedido: '', pedidos: [] as string[], erro: false,
      /** stop_reason de cada chamada, em ordem; acabando a fila, vale 'end_turn'. */
      paradas: [] as string[],
      /** Os parâmetros de cada chamada ao modelo, como foram enviados. */
      params: [] as Row[],
      /** As opções de requisição de cada chamada (tempo limite, repetições). */
      opcoes: [] as Row[],
      /** Quantas das PRIMEIRAS chamadas estouram o tempo limite. */
      estouros: 0,
    },
    agenda: { livre: true, compromissos: [] as Row[] | null, fechados: new Set<string>() },
    card: { gravados: [] as Row[], erro: null as unknown, bloqueado: false, cardsDaLp: 0 },
    opt: [] as Array<{ tel: string; motivo: string; origem: string }>,
  };
});

function fabrica(base: Record<string, Row[]>) {
  return (tabela: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'upsert' | 'update' | 'delete',
      filtros: [] as Array<(r: Row) => boolean>, ordem: [] as Array<[string, boolean]>,
      de: 0, ate: Infinity, lim: Infinity, head: false, corpo: null as any, id: undefined as unknown, or: null as string | null,
      likes: [] as string[],
    };
    const linhas = () => (base[tabela] ??= []);
    const casa = (padrao: string, v: unknown, i = false) =>
      new RegExp('^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', i ? 'i' : '').test(String(v ?? ''));
    const passaNoOr = (r: Row): boolean => {
      if (!st.or) return true;
      // Só as duas formas que a agente usa: status.is.null, status.eq.x e status.in.(a,b).
      const s = r.status;
      const em = /status\.in\.\(([^)]*)\)/.exec(st.or)?.[1]?.split(',') ?? [];
      const eq = /status\.eq\.(\w+)/.exec(st.or)?.[1];
      return (st.or.includes('status.is.null') && (s === null || s === undefined)) || em.includes(s) || (eq !== undefined && s === eq);
    };
    const executar = () => {
      if (st.op === 'select') {
        if (h.falhaDeLeitura.has(tabela)) return { data: null, error: { message: `leitura de ${tabela} falhou` }, count: null };
        if (h.falhaDoLike && st.likes.some(p => p.startsWith(h.falhaDoLike!))) return { data: null, error: { message: `leitura ${h.falhaDoLike} falhou` }, count: null };
        let r = linhas().filter(x => st.filtros.every(f => f(x)));
        for (const [c, asc] of [...st.ordem].reverse()) {
          r = [...r].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        }
        const total = r.length;
        // O teto de 1000 linhas do PostgREST, como em produção.
        r = r.slice(st.de, Math.min(st.ate + 1, st.de + st.lim, st.de + 1000));
        return st.head ? { data: null, error: null, count: total } : { data: r, error: null, count: total };
      }
      if (st.op === 'insert') {
        const novas: Row[] = Array.isArray(st.corpo) ? st.corpo : [st.corpo];
        for (const n of novas) {
          if (tabela === 'system_state' && linhas().some(x => x.key === n.key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
        }
        linhas().push(...novas.map(n => ({ ...n })));
        return { data: novas, error: null };
      }
      if (st.op === 'upsert') {
        const n = st.corpo as Row;
        const i = linhas().findIndex(x => x.key === n.key);
        if (i >= 0) linhas()[i] = { ...n }; else linhas().push({ ...n });
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        h.atualizacoes.push({ tabela, patch: st.corpo, id: st.id, or: st.or });
        for (const r of linhas().filter(x => st.filtros.every(f => f(x)) && passaNoOr(x))) Object.assign(r, st.corpo);
        return { data: null, error: null };
      }
      const fica = linhas().filter(x => !st.filtros.every(f => f(x)));
      base[tabela] = fica;
      return { data: null, error: null };
    };
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) st.head = true; return q; },
      insert: (corpo: any) => { st.op = 'insert'; st.corpo = corpo; return q; },
      upsert: (corpo: any) => { st.op = 'upsert'; st.corpo = corpo; return q; },
      update: (corpo: any) => { st.op = 'update'; st.corpo = corpo; return q; },
      delete: () => { st.op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { if (c === 'id') st.id = v; st.filtros.push(r => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { st.filtros.push(r => vs.includes(r[c])); return q; },
      like: (c: string, p: string) => { st.likes.push(p); st.filtros.push(r => casa(p, r[c])); return q; },
      ilike: (c: string, p: string) => { st.filtros.push(r => casa(p, r[c], true)); return q; },
      gte: (c: string, v: any) => { st.filtros.push(r => r[c] >= v); return q; },
      lte: (c: string, v: any) => { st.filtros.push(r => r[c] <= v); return q; },
      lt: (c: string, v: any) => { st.filtros.push(r => r[c] < v); return q; },
      not: (c: string, _op: string, _v: unknown) => { st.filtros.push(r => r[c] !== null && r[c] !== undefined); return q; },
      or: (expr: string) => { st.or = expr; return q; },
      order: (c: string, o?: { ascending?: boolean }) => { st.ordem.push([c, o?.ascending !== false]); return q; },
      range: (de: number, ate: number) => { st.de = de; st.ate = ate; return q; },
      limit: (n: number) => { st.lim = n; return q; },
      maybeSingle: async () => { const r = executar(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, falha),
    };
    return q;
  };
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => fabrica(h.banco.main)(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => fabrica(h.banco.ger)(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223', diego: '34991360172' } }));
vi.mock('../services/io/solarRespostas', () => ({ INSTANCE_ID_IO: 'LINHA_TESTE' }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: vi.fn(async (tel: string, partes: string[]) => {
    if (h.zap.erroNoFrio) throw new Error('[zapi:io] HTTP 500');
    h.zap.frio.push({ tel, partes });
  }),
  sendHuman: vi.fn(async (tel: string, partes: string[], _i: string, opts: any) => { h.zap.humano.push({ tel, partes, opts }); }),
  sendWhatsApp: vi.fn(async (tel: string, texto: string) => { h.zap.equipe.push({ tel, texto }); }),
  solardocViaIo: () => false,
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async (o?: unknown) => { h.linha.pedidosDeTeto.push(o); return h.linha.teto; }),
  respeitaEspacamentoLinha: vi.fn(async () => h.linha.espaco),
  rampaReconexaoVigente: vi.fn(async () => h.linha.rampa),
  maxPorDia: () => 40,
  // A janela da linha: 09h às 20h de Brasília, sem domingo.
  dentroDaJanelaDiurna: (d: Date) => {
    const b = new Date(d.getTime() - 3 * 3600_000);
    return b.getUTCDay() !== 0 && b.getUTCHours() >= 9 && b.getUTCHours() < 20;
  },
}));
// As quatro leituras de bloqueio imitam as de verdade: falham ABERTO por padrão
// (devolvem "ninguém barrado") e só SOBEM o erro quando chamadas em modo estrito.
const leituraDeBloqueio = (nome: string, estrito: boolean | undefined): boolean => {
  if (estrito) h.filtros.estritas.push(nome);
  if (!h.filtros.falha.has(nome)) return true;
  if (estrito) throw new Error(`leitura de ${nome} falhou`);
  return false;
};
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  carregarSilenciados: vi.fn(async (o?: { estrito?: boolean }) => {
    const leu = leituraDeBloqueio('silenciados', o?.estrito);
    return (tel: string) => leu && h.filtros.silenciados.has(tel);
  }),
  carregarMudos: vi.fn(async (n?: number, _dias?: number, o?: { estrito?: boolean }) => {
    h.filtros.mudosCom = n ?? null;
    leituraDeBloqueio('mudos', o?.estrito);
    return (tel: string) => h.filtros.mudos.has(tel);
  }),
  carregarBloqueados: vi.fn(async (o?: { estrito?: boolean }) => { leituraDeBloqueio('bloqueados', o?.estrito); return () => false; }),
  silenciarContato: vi.fn(async (tel: string, motivo: string, origem: string) => { h.opt.push({ tel, motivo, origem }); h.filtros.silenciados.add(tel); }),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  carregarPausas: vi.fn(async (o?: { estrito?: boolean }) => {
    const leu = leituraDeBloqueio('pausas', o?.estrito);
    return (tel: string) => ({ pode: !(leu && h.filtros.pausados.has(tel)) });
  }),
  podeFalarComLead: vi.fn(async (tel: string) => { h.filtros.antesDoClaim?.(); return { pode: !h.filtros.pausados.has(tel) }; }),
  registrarBloqueio: vi.fn(async () => {}),
}));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      create: vi.fn(async (p: any, opcoes?: any) => {
        h.ia.chamadas++;
        h.ia.opcoes.push(opcoes);
        if (h.ia.estouros > 0) { h.ia.estouros--; h.ia.params.push(p); throw new Error('Request timed out.'); }
        h.ia.sistema = p.system;
        h.ia.pedido = p.messages[0].content;
        h.ia.pedidos.push(p.messages[0].content);
        h.ia.params.push(p);
        if (h.ia.erro) throw new Error('IA fora do ar');
        // Com fila, cada chamada consome a próxima resposta; sem fila, a mesma sempre.
        const texto = h.ia.fila.length ? h.ia.fila.shift()! : h.ia.resposta;
        return { stop_reason: h.ia.paradas.shift() ?? 'end_turn', content: [{ type: 'text', text: texto }] };
      }),
    },
  }),
}));
vi.mock('../services/agenda/agendaFechada', async (orig) => {
  const real = await orig<typeof import('../services/agenda/agendaFechada')>();
  return {
    ...real,
    agendaFechadaEm: (ymd: string) => h.agenda.fechados.has(ymd),
    agendaFechadaNoIso: (iso: string) => !!iso && h.agenda.fechados.has(real.ymdBRT(iso)),
  };
});
vi.mock('../services/io/eletropostoVagas', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoVagas')>()),
  carregarCompromissos: vi.fn(async () => h.agenda.compromissos),
  aindaLivre: vi.fn(async () => h.agenda.livre),
}));
vi.mock('../services/io/eletropostoCard', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoCard')>()),
  consultaDoRodizio: vi.fn(() => Promise.resolve({ count: h.card.cardsDaLp, error: null })),
  gravarCardEletroposto: vi.fn(async (ficha: Row) => {
    if (h.card.erro) throw h.card.erro;
    if (h.card.bloqueado) return { id: null, bloqueado: true };
    h.card.gravados.push(ficha);
    return { id: 900 + h.card.gravados.length, bloqueado: false };
  }),
}));

import {
  runInvestidorAberturaTick, runInvestidorRespostasTick, previaInvestidorAgente, definirChaveDesligar,
  lerChaveDesligar, rodarInvestidorAgente, reivindicarRodada, sondarHelena, fecharResgatesSemResposta,
  INV_RESGATE_PREFIX, INV_SENT_PREFIX, INV_OFF_KEY, INV_DISJUNTOR_KEY, INV_LOCK_PREFIX, type SessaoInvestidor,
} from '../services/io/investidorAgente';
import * as T from '../services/io/investidorAgenteTextos';

const brt = (s: string): Date => new Date(`${s}:00-03:00`);
const LARGADA = brt('2026-10-11T08:00');
const estado = (chave: string): Row | undefined => h.banco.main.system_state!.find(r => r.key === chave);
const sessaoDe = (chave: string): SessaoInvestidor => estado(`inv_agente:${chave}`)!.value;
const chaves = (prefixo: string): string[] => h.banco.main.system_state!.filter(r => String(r.key).startsWith(prefixo)).map(r => r.key);

const ANA = '3499990001', BRUNO = '3499990002', CARLA = '3499990003';

function semear() {
  h.banco.ger.eletroposto_parceria = [
    { id: 1, nome: 'Ana Lima', telefone: '5534999990001', cidade: 'Uberlândia', lado: 'capital', capital_faixa: 'R$ 140 mil', status: 'novo', created_at: '2026-09-01T12:00:00Z' },
    { id: 2, nome: 'Bruno Reis', telefone: '5534999990002', cidade: 'Uberaba', lado: 'capital', capital_faixa: 'Mais de R$ 500 mil', status: 'novo', created_at: '2026-09-02T12:00:00Z' },
    { id: 3, nome: 'Carla', telefone: '5534999990003', cidade: null, lado: 'capital', capital_faixa: 'Até R$ 50 mil', status: 'novo', created_at: '2026-09-03T12:00:00Z' },
  ];
  h.banco.ger.eletroposto_nota1 = [
    // A Ana de novo, na ficha, sem o nono dígito.
    { id: 21, nome: 'Ana Lima', telefone: '553499990001', cidade: null, ficha: '', valor_investir: 'R$ 140 mil', status: 'novo', created_at: '2026-09-20T12:00:00Z' },
  ];
  h.banco.ger.agendamentos = [];
}

const envOriginal = { ...process.env };
beforeEach(() => {
  for (const t of Object.keys(h.banco.main)) h.banco.main[t] = [];
  for (const t of Object.keys(h.banco.ger)) h.banco.ger[t] = [];
  semear();
  h.falhaDeLeitura.clear(); h.falhaDoLike = null;
  h.atualizacoes.length = 0;
  Object.assign(h.linha, { teto: true, espaco: true, rampa: null }); h.linha.pedidosDeTeto.length = 0;
  h.filtros.silenciados.clear(); h.filtros.pausados.clear(); h.filtros.mudos.clear(); h.filtros.mudosCom = null; h.filtros.antesDoClaim = null;
  h.filtros.falha.clear(); h.filtros.estritas.length = 0;
  h.zap.frio.length = 0; h.zap.humano.length = 0; h.zap.equipe.length = 0; h.zap.erroNoFrio = false;
  Object.assign(h.ia, { resposta: '', chamadas: 0, sistema: '', pedido: '', erro: false }); h.ia.fila.length = 0; h.ia.pedidos.length = 0;
  h.ia.paradas.length = 0; h.ia.params.length = 0; h.ia.opcoes.length = 0; h.ia.estouros = 0;
  Object.assign(h.agenda, { livre: true, compromissos: [] }); h.agenda.fechados.clear();
  Object.assign(h.card, { erro: null, bloqueado: false, cardsDaLp: 0 }); h.card.gravados.length = 0;
  h.opt.length = 0;
  delete process.env.INVESTIDOR_AGENTE_OFF;
  delete process.env.INVESTIDOR_AGENTE_TETO;
  vi.useFakeTimers();
  vi.setSystemTime(LARGADA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

const abrir = (quando: Date = new Date()) => { vi.setSystemTime(quando); return runInvestidorAberturaTick({ agora: quando }); };

// ═════════════════════════════════════════════════════════════════════════════
describe('abertura: o caminho feliz', () => {
  it('manda UMA bolha para o maior valor, grava a sessão e só então o carimbo', async () => {
    const r = await abrir();
    expect(r).toMatchObject({ enviados: 1, para: 'final 0002', fila: 2 });
    expect(h.zap.frio).toHaveLength(1);
    expect(h.zap.frio[0]!.tel).toBe('5534999990002');
    expect(h.zap.frio[0]!.partes).toHaveLength(1);
    expect(h.zap.frio[0]!.partes[0]).toContain('Bruno');
    expect(h.zap.frio[0]!.partes[0]).toContain('mais de R$ 500 mil');

    const s = sessaoDe(BRUNO);
    expect(s).toMatchObject({
      estagio: 'chamado', origem: 'parceria', id: 2, telefone: '5534999990002', nome: 'Bruno Reis',
      valor_txt: 'Mais de R$ 500 mil', consultor: 'Thiago', oferta: [], agendamento_id: null, motivo: null, erro: null,
    });
    expect(s.aberto_em).toBe(LARGADA.toISOString());
    // Uma chave por toque e por telefone.
    expect(chaves(INV_SENT_PREFIX)).toEqual([`inv_agente_sent:${BRUNO}:t1`]);
  });

  it('um envio por chamada: a segunda chamada pega o próximo, e a mesma pessoa não recebe duas vezes', async () => {
    await abrir();
    await abrir(brt('2026-10-11T08:15'));
    await abrir(brt('2026-10-11T08:30'));
    expect(h.zap.frio.map(e => e.tel)).toEqual(['5534999990002', '5534999990001', '5534999990003']);
    // A fila acabou: a quarta chamada não manda nada.
    expect(await abrir(brt('2026-10-11T08:45'))).toMatchObject({ enviados: 0, motivo: 'fila_vazia' });
    expect(h.zap.frio).toHaveLength(3);
  });

  it('a mesma pessoa no cadastro e na ficha tem UMA sessão, com as duas linhas', async () => {
    await abrir();
    await abrir(brt('2026-10-11T08:15'));
    expect(chaves('inv_agente:').filter(k => k.endsWith(ANA))).toHaveLength(1);
    expect(sessaoDe(ANA).refs).toEqual([{ origem: 'parceria', id: 1 }, { origem: 'nota1', id: 21 }]);
  });

  it('o rodízio alterna Thiago e Diego a cada sessão aberta, a partir da contagem da LP', async () => {
    h.card.cardsDaLp = 7;   // ímpar: o próximo da LP seria o Diego
    await abrir();
    await abrir(brt('2026-10-11T08:15'));
    await abrir(brt('2026-10-11T08:30'));
    expect([sessaoDe(BRUNO).consultor, sessaoDe(ANA).consultor, sessaoDe(CARLA).consultor]).toEqual(['Diego', 'Thiago', 'Diego']);
  });

  it('os filtros da fila usam mudo com 2 toques (parecer anti-ban), não o padrão de 3', async () => {
    await abrir();
    expect(h.filtros.mudosCom).toBe(2);
  });
});

describe('abertura: os portões, todos antes do claim', () => {
  const nadaSaiu = () => {
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves('inv_agente:')).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  };

  it('chave de desligar pela variável de ambiente', async () => {
    process.env.INVESTIDOR_AGENTE_OFF = '1';
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'desligada_env' });
    nadaSaiu();
  });

  it('chave de desligar pelo banco: ?desligar=1 para, ?ligar=1 volta', async () => {
    await definirChaveDesligar(true);
    expect(estado(INV_OFF_KEY)!.value.off).toBe(true);
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'desligada_banco' });
    nadaSaiu();
    expect(await definirChaveDesligar(false)).toEqual({ ok: true, desligada: false });
    expect(estado(INV_OFF_KEY)).toBeUndefined();
    expect((await abrir()).enviados).toBe(1);
  });

  it('sem conseguir ler a chave de desligar, vale como desligada', async () => {
    h.falhaDeLeitura.add('system_state');
    expect(await lerChaveDesligar()).toEqual({ off: true, por: 'erro_de_leitura' });
    expect((await abrir()).enviados).toBe(0);
    expect(h.zap.frio).toHaveLength(0);
  });

  it('antes de domingo 11/10 às 08h não sai nada', async () => {
    expect(await abrir(brt('2026-10-10T15:00'))).toMatchObject({ enviados: 0, motivo: 'antes_do_inicio' });
    expect(await abrir(brt('2026-10-11T07:59'))).toMatchObject({ enviados: 0, motivo: 'antes_do_inicio' });
    nadaSaiu();
  });

  it('fora da janela: 20h do domingo, 08h30 da terça e domingo seguinte', async () => {
    expect(await abrir(brt('2026-10-11T20:00'))).toMatchObject({ motivo: 'fora_da_janela' });
    expect(await abrir(brt('2026-10-13T08:30'))).toMatchObject({ motivo: 'fora_da_janela' });
    expect(await abrir(brt('2026-10-18T10:00'))).toMatchObject({ motivo: 'fora_da_janela' });
    nadaSaiu();
  });

  const carimbar = (n: number, quando: string) => {
    for (let i = 0; i < n; i++) h.banco.main.system_state!.push({ key: `inv_agente_sent:34000${1000 + i}:t1`, value: {}, updated_at: quando });
  };

  it('teto do dia: com 30 carimbos de hoje não sai o 31º; os de ontem não contam', async () => {
    carimbar(30, brt('2026-10-11T09:00').toISOString());
    expect(await abrir(brt('2026-10-11T15:00'))).toMatchObject({ enviados: 0, motivo: 'teto_do_dia' });
    expect(h.zap.frio).toHaveLength(0);
    // Segunda 12/10: os 30 de domingo são de outro dia de Brasília.
    expect((await abrir(brt('2026-10-12T08:00'))).enviados).toBe(1);
  });

  it('teto do dia de 13/10 em diante é 20', async () => {
    carimbar(20, brt('2026-10-13T09:30').toISOString());
    expect(await abrir(brt('2026-10-13T15:00'))).toMatchObject({ motivo: 'teto_do_dia' });
  });

  it('INVESTIDOR_AGENTE_TETO só aperta', async () => {
    process.env.INVESTIDOR_AGENTE_TETO = '2';
    carimbar(2, brt('2026-10-11T09:00').toISOString());
    expect(await abrir(brt('2026-10-11T15:00'))).toMatchObject({ motivo: 'teto_do_dia' });
    process.env.INVESTIDOR_AGENTE_TETO = '99';
    carimbar(28, brt('2026-10-11T10:00').toISOString());
    expect(await abrir(brt('2026-10-11T15:00'))).toMatchObject({ motivo: 'teto_do_dia' });
  });

  it('a linha: sem rampa pede o piso do dia em maxPorDia (40), sem transacional e sem piso de hora', async () => {
    await abrir();
    expect(h.linha.pedidosDeTeto).toEqual([{ pisoDia: 40 }]);
  });

  it('com a rampa de reconexão armada: sem piso nenhum, e o teto do dia vira o da rampa', async () => {
    h.linha.rampa = { hora: 2, dia: 10 };
    carimbar(10, brt('2026-10-11T09:00').toISOString());
    expect(await abrir(brt('2026-10-11T15:00'))).toMatchObject({ motivo: 'teto_do_dia' });
    h.banco.main.system_state = [];
    expect((await abrir(brt('2026-10-11T15:00'))).enviados).toBe(1);
    expect(h.linha.pedidosDeTeto).toEqual([undefined]);
  });

  it('teto da linha e espaçamento da linha seguram', async () => {
    h.linha.teto = false;
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'teto_da_linha' });
    h.linha.teto = true; h.linha.espaco = false;
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'espacamento_da_linha' });
    nadaSaiu();
  });

  it('humano na conversa do primeiro da fila: ninguém recebe nesta chamada', async () => {
    h.filtros.antesDoClaim = () => h.filtros.pausados.add('5534999990002');
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'humano_na_conversa' });
    nadaSaiu();
  });

  it('claim perdido (23505): outra chamada já pegou a pessoa, esta sai sem enviar', async () => {
    h.filtros.antesDoClaim = () => {
      if (!estado(`inv_agente:${BRUNO}`)) h.banco.main.system_state!.push({ key: `inv_agente:${BRUNO}`, value: { estagio: 'chamado' }, updated_at: 'x' });
    };
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'ja_reivindicado' });
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  });
});

describe('abertura: falha fechada', () => {
  it('leitura da fila falhou (cadastros): ninguém recebe', async () => {
    h.falhaDeLeitura.add('eletroposto_parceria');
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'erro_leitura_fila' });
    expect(h.zap.frio).toHaveLength(0);
  });

  it('leitura dos cards falhou: ninguém recebe (sem saber quem já tem card)', async () => {
    h.falhaDeLeitura.add('agendamentos');
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'erro_leitura_fila' });
    expect(h.zap.frio).toHaveLength(0);
  });

  it('leitura das mensagens dos últimos 7 dias falhou: ninguém recebe', async () => {
    h.falhaDeLeitura.add('wa_mensagens');
    expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'erro_leitura_fila' });
    expect(h.zap.frio).toHaveLength(0);
  });
});

describe('BLOQUEANTE: opt-out, mudo, bloqueado e pausa não falham ABERTOS na fila', () => {
  it('as quatro leituras são pedidas em modo estrito', async () => {
    await abrir();
    expect([...h.filtros.estritas].sort()).toEqual(['bloqueados', 'mudos', 'pausas', 'silenciados']);
  });

  for (const leitura of ['silenciados', 'mudos', 'bloqueados', 'pausas']) {
    it(`leitura de ${leitura} falhou: a abertura NÃO sai, e a prévia mostra o motivo`, async () => {
      h.filtros.falha.add(leitura);
      expect(await abrir()).toMatchObject({ enviados: 0, motivo: 'erro_leitura_fila' });
      expect(h.zap.frio).toHaveLength(0);
      expect(chaves('inv_agente:')).toHaveLength(0);
      expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);

      const p = await previaInvestidorAgente({ agora: LARGADA }) as Record<string, any>;
      expect(p.fila).toBeNull();
      expect(p.erro_da_fila).toContain(`leitura de ${leitura} falhou`);
    });
  }

  it('com as quatro lendo de novo, a abertura volta a sair', async () => {
    h.filtros.falha.add('silenciados');
    expect((await abrir()).enviados).toBe(0);
    h.filtros.falha.clear();
    expect((await abrir(brt('2026-10-11T08:15'))).enviados).toBe(1);
  });
});

describe('trava de chamada sobreposta', () => {
  it('duas chamadas no mesmo balde de 5 minutos: a segunda sai sem fazer nada', async () => {
    vi.setSystemTime(brt('2026-10-11T08:00'));
    const primeira = await rodarInvestidorAgente() as Record<string, any>;
    expect(primeira.abertura).toMatchObject({ enviados: 1 });
    vi.setSystemTime(brt('2026-10-11T08:04'));
    expect(await rodarInvestidorAgente()).toEqual({ ok: true, pulou: 'outra_chamada_no_mesmo_balde' });
    expect(h.zap.frio).toHaveLength(1);
  });

  it('no balde seguinte a rodada roda de novo, e a trava velha é apagada', async () => {
    vi.setSystemTime(brt('2026-10-11T08:00'));
    await rodarInvestidorAgente();
    vi.setSystemTime(brt('2026-10-11T08:05'));
    const segunda = await rodarInvestidorAgente() as Record<string, any>;
    expect(segunda.pulou).toBeUndefined();
    expect(segunda.abertura).toMatchObject({ enviados: 1 });
    expect(chaves(INV_LOCK_PREFIX)).toEqual(['inv_agente_lock:2026-10-11T11:05']);
  });

  it('o balde é de 5 minutos em UTC', async () => {
    expect(await reivindicarRodada(Date.parse('2026-10-11T11:07:30Z'))).toEqual({ ok: true });
    expect(chaves(INV_LOCK_PREFIX)).toEqual(['inv_agente_lock:2026-10-11T11:05']);
    expect(await reivindicarRodada(Date.parse('2026-10-11T11:09:59Z'))).toEqual({ ok: false, motivo: 'outra_chamada_no_mesmo_balde' });
    expect(await reivindicarRodada(Date.parse('2026-10-11T11:10:00Z'))).toEqual({ ok: true });
  });

  it('a trava vale também para as respostas', async () => {
    vi.setSystemTime(AGORA);
    await rodarInvestidorAgente();
    sessao(ANA);
    chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    vi.setSystemTime(new Date(AGORA.getTime() + 2 * 60_000));
    expect(await rodarInvestidorAgente()).toMatchObject({ pulou: 'outra_chamada_no_mesmo_balde' });
    expect(h.ia.chamadas).toBe(0);
  });
});

describe('abertura: quem fica fora da fila pelo que está no banco', () => {
  it('card em qualquer status, gravado sem o nono dígito, tira da fila', async () => {
    h.banco.ger.agendamentos = [{ id: 5, cliente_telefone: '553499990002', status: 'cancelado', created_by: 'lp_solar' }];
    await abrir();
    expect(h.zap.frio[0]!.tel).toBe('5534999990001');
  });

  it('mais de 1000 cards: o card da linha 1200 ainda conta', async () => {
    h.banco.ger.agendamentos = Array.from({ length: 1199 }, (_, i) => ({ id: i + 1, cliente_telefone: `55119${String(10000000 + i)}`, status: 'agendado' }));
    h.banco.ger.agendamentos.push({ id: 1200, cliente_telefone: '5534999990002', status: 'fechou' });
    await abrir();
    expect(h.zap.frio[0]!.tel).toBe('5534999990001');
  });

  it('qualquer mensagem nos últimos 7 dias tira da fila; a de 8 dias atrás não', async () => {
    const dias = (n: number) => new Date(LARGADA.getTime() - n * 86_400_000).toISOString();
    h.banco.main.wa_mensagens = [
      { id: 1, telefone: '5534999990002', is_group: false, from_me: true, momment: dias(3) },   // nós falamos com o Bruno
      { id: 2, telefone: '553499990001', is_group: false, from_me: false, momment: dias(8) },   // a Ana escreveu há 8 dias
    ];
    await abrir();
    expect(h.zap.frio[0]!.tel).toBe('5534999990001');
  });

  it('humano digitando pelo celular chega como LID: resolvido pelo mapa antes de cruzar', async () => {
    const ontem = new Date(LARGADA.getTime() - 86_400_000).toISOString();
    h.banco.main.wa_mensagens = [{ id: 1, telefone: '253068247589084', is_group: false, from_me: true, momment: ontem }];
    h.banco.main.wa_lid_telefone = [{ lid: '253068247589084', telefone: '5534999990002', chave: BRUNO }];
    await abrir();
    expect(h.zap.frio[0]!.tel).toBe('5534999990001');
  });

  it('LID sem mapa não vira chave de ninguém, e aparece contado na prévia', async () => {
    const ontem = new Date(LARGADA.getTime() - 86_400_000).toISOString();
    h.banco.main.wa_mensagens = [{ id: 1, telefone: '253068247589084', is_group: false, from_me: true, momment: ontem }];
    const p = await previaInvestidorAgente({ agora: LARGADA });
    expect(p.lids_sem_mapa).toBe(1);
    expect(p.fila).toBe(3);
  });

  it('quem pediu para parar em qualquer trilha não recebe', async () => {
    h.filtros.silenciados.add('5534999990002');
    await abrir();
    expect(h.zap.frio[0]!.tel).toBe('5534999990001');
  });
});

describe('abertura: erro de envio e disjuntor', () => {
  it('erro de envio fica na sessão, não gera carimbo e o tick para', async () => {
    h.zap.erroNoFrio = true;
    const r = await abrir();
    expect(r).toMatchObject({ enviados: 0, motivo: 'erro_envio' });
    expect(sessaoDe(BRUNO).erro).toContain('HTTP 500');
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
    // Não tentou o próximo na mesma chamada.
    expect(chaves('inv_agente:')).toHaveLength(1);
    expect(estado(INV_DISJUNTOR_KEY)!.value).toMatchObject({ erros_seguidos: 1, aberto: false });
  });

  it('2 erros seguidos abrem o disjuntor: a abertura para até alguém religar', async () => {
    h.zap.erroNoFrio = true;
    await abrir();
    await abrir(brt('2026-10-11T08:15'));
    expect(estado(INV_DISJUNTOR_KEY)!.value).toMatchObject({ erros_seguidos: 2, aberto: true });
    h.zap.erroNoFrio = false;
    expect(await abrir(brt('2026-10-11T08:30'))).toMatchObject({ enviados: 0, motivo: 'disjuntor_erros_de_envio' });
    expect(await abrir(brt('2026-10-12T10:00'))).toMatchObject({ enviados: 0, motivo: 'disjuntor_erros_de_envio' });
    expect(h.zap.frio).toHaveLength(0);
    // Aparece na prévia.
    expect((await previaInvestidorAgente({ agora: brt('2026-10-12T10:00') })).disjuntor).toMatchObject({ aberto: true, erros_seguidos: 2 });
    // ?ligar=1 rearma.
    await definirChaveDesligar(false);
    expect((await abrir(brt('2026-10-12T10:15'))).enviados).toBe(1);
  });

  it('um envio que deu certo zera a contagem de erros', async () => {
    h.zap.erroNoFrio = true;
    await abrir();
    h.zap.erroNoFrio = false;
    expect((await abrir(brt('2026-10-11T08:15'))).enviados).toBe(1);
    expect(estado(INV_DISJUNTOR_KEY)!.value).toMatchObject({ erros_seguidos: 0, aberto: false });
  });

  it('3 pedidos de parada no mesmo dia param as aberturas até o dia seguinte', async () => {
    for (const k of ['a', 'b', 'c']) h.banco.main.system_state!.push({ key: `inv_agente_parar:2026-10-11:${k}`, value: {}, updated_at: 'x' });
    expect(await abrir(brt('2026-10-11T15:00'))).toMatchObject({ enviados: 0, motivo: 'disjuntor_pedidos_de_parada' });
    expect(h.zap.frio).toHaveLength(0);
    expect((await abrir(brt('2026-10-12T08:00'))).enviados).toBe(1);
  });
});

describe('prévia (?dry=1)', () => {
  it('não envia, não grava, ignora janela e início, e mostra a fila com os textos', async () => {
    const sabado = brt('2026-10-10T21:00');
    vi.setSystemTime(sabado);
    const p = await previaInvestidorAgente({ agora: sabado }) as Record<string, any>;
    expect(p).toMatchObject({
      hora_brasilia: '2026-10-10 21:00', antes_do_inicio: true, janela_aberta: false,
      teto_do_dia: 20, enviados_hoje: 0, fila: 3, grupo_investidores: 4,
      desligada: { off: false, por: null },
    });
    expect(p.excluidos).toEqual({ duplicado: 1 });
    expect(p.primeiros).toEqual([
      { nome: 'Bruno', telefone_final: '02', valor: 'Mais de R$ 500 mil', origem: 'parceria:2' },
      // Empate de valor entre as duas linhas da Ana: vale a mais nova, que é a ficha.
      { nome: 'Ana', telefone_final: '01', valor: 'R$ 140 mil', origem: 'nota1:21' },
      { nome: 'Carla', telefone_final: '03', valor: 'Até R$ 50 mil', origem: 'parceria:3' },
    ]);
    expect(p.textos).toHaveLength(3);
    expect(p.textos[2]).toContain('até R$ 50 mil');
    // Nenhum telefone inteiro na prévia, nem os 4 últimos dígitos: só 2.
    expect(JSON.stringify(p)).not.toContain('5534999990002');
    expect(JSON.stringify(p)).not.toContain('0002');
    expect(h.zap.frio).toHaveLength(0);
    expect(h.banco.main.system_state).toHaveLength(0);
  });

  it('no domingo da largada o teto mostrado é 30 e a janela aparece aberta', async () => {
    const p = await previaInvestidorAgente({ agora: LARGADA });
    expect(p).toMatchObject({ antes_do_inicio: false, janela_aberta: true, teto_do_dia: 30 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RESPOSTAS
// ═════════════════════════════════════════════════════════════════════════════

const AGORA = brt('2026-10-11T10:00');
let seqMsg = 0;
/** Mensagem do lead na linha, `minAtras` minutos antes de agora. */
function chegou(tel: string, texto: string | null, minAtras = 2, tipo = 'texto') {
  h.banco.main.wa_mensagens!.push({
    id: ++seqMsg, telefone: tel, texto, tipo, from_me: false, is_group: false, instancia: 'LINHA_TESTE',
    momment: new Date(AGORA.getTime() - minAtras * 60_000).toISOString(),
  });
}
function sessao(chave: string, over: Partial<SessaoInvestidor> = {}) {
  const abertoEm = new Date(AGORA.getTime() - 60 * 60_000).toISOString();
  const s: SessaoInvestidor = {
    estagio: 'chamado', aberto_em: abertoEm, abertura: 0, origem: 'parceria', id: 1,
    refs: [{ origem: 'parceria', id: 1 }, { origem: 'nota1', id: 21 }],
    telefone: '5534999990001', nome: 'Ana Lima', cidade: 'Uberlândia', cadastro_em: '2026-09-01T12:00:00Z',
    valor_txt: 'R$ 140 mil', consultor: 'Diego', oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null,
    dados: {}, resumo: '', erro: null, ate: null, respostas: 0, atualizado_em: abertoEm, ...over,
  };
  h.banco.main.system_state!.push({ key: `inv_agente:${chave}`, value: s, updated_at: abertoEm });
}
const ia = (acao: string, bolhas: string[] = [], dados: Record<string, string> = {}, resumo = 'Confirmou o interesse.') => {
  h.ia.resposta = JSON.stringify({ bolhas, acao, dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '', ...dados }, resumo });
};
const responder = () => { vi.setSystemTime(AGORA); return runInvestidorRespostasTick(); };
const OFERTA = [brt('2026-10-13T10:00'), brt('2026-10-13T13:00'), brt('2026-10-14T13:00'), brt('2026-10-14T15:00')].map(d => d.toISOString());

describe('respostas: a conversa', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('ninguém escreveu: não chama a IA nem manda nada', async () => {
    sessao(ANA);
    expect(await responder()).toMatchObject({ respondidas: 0, motivo: 'ninguem_escreveu' });
    expect(h.ia.chamadas).toBe(0);
  });

  it('primeira resposta: a IA lê a conversa, responde em até 2 bolhas e o cadastro vira "falando"', async () => {
    sessao(ANA);
    chegou('553499990001', 'Sim, continuo com interesse');   // a Z-API entrega sem o nono dígito
    ia('continuar', ['Que bom, Ana.', 'Esse valor é recurso próprio?'], { valor_confirmado: 'Sim' });

    const r = await responder();

    expect(r).toMatchObject({ respondidas: 1, erros: 0 });
    expect(h.ia.chamadas).toBe(1);
    expect(h.zap.humano).toHaveLength(1);
    expect(h.zap.humano[0]).toMatchObject({ tel: '5534999990001', partes: ['Que bom, Ana.', 'Esse valor é recurso próprio?'], opts: { maxBolhas: 2 } });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'conversando', respostas: 1, dados: { valor_confirmado: 'Sim' } });
    // As duas linhas de cadastro daquele telefone, sem passar por cima de status que a equipe pôs.
    const falando = h.atualizacoes.filter(a => a.patch.status === 'falando');
    expect(falando.map(a => [a.tabela, a.id])).toEqual([['eletroposto_parceria', 1], ['eletroposto_nota1', 21]]);
    expect(falando.every(a => a.or === 'status.is.null,status.eq.novo')).toBe(true);
    expect(h.banco.ger.eletroposto_parceria!.find(x => x.id === 1)!.status).toBe('falando');
  });

  it('a IA recebe a abertura no histórico, o consultor e a mensagem nova', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.sistema).toContain('marcar uma reunião com Diego');
    expect(h.ia.sistema).toContain('Valor que ela marcou no formulário: R$ 140 mil');
    expect(h.ia.pedido).toContain('Nós: ' + T.ABERTURAS[0]!.replace('{nome}', 'Ana').replace('{valor}', 'R$ 140 mil'));
    expect(h.ia.pedido).toContain('Cliente: Sim');
  });

  it('a mesma leva não é respondida duas vezes', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    await responder();
    await responder();
    await responder();
    expect(h.ia.chamadas).toBe(1);
    expect(h.zap.humano).toHaveLength(1);
  });

  it('"ok" e "obrigado": a IA devolve bolhas vazias e ninguém responde', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'ok obrigado');
    ia('continuar', []);
    expect(await responder()).toMatchObject({ respondidas: 0, erros: 0 });
    expect(h.zap.humano).toHaveLength(0);
    expect(sessaoDe(ANA).respostas).toBe(0);
  });

  it('mensagem anterior à abertura não é resposta à Helena', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Oi, alguém aí?', 90);   // 30 min ANTES da abertura
    expect(await responder()).toMatchObject({ motivo: 'ninguem_escreveu' });
    expect(h.ia.chamadas).toBe(0);
  });

  it('no máximo 3 conversas por chamada; as outras ficam para a próxima', async () => {
    for (let i = 1; i <= 5; i++) {
      sessao(`349999100${i}`, { telefone: `553499999100${i}`, refs: [] });
      chegou(`553499999100${i}`, 'Sim');
    }
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.chamadas).toBe(3);
    await responder();
    expect(h.ia.chamadas).toBe(5);
  });
});

describe('respostas: quem cala a Helena', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('humano entrou na conversa: ela não responde e a sessão vira `humano`', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Sim');
    h.filtros.pausados.add('5534999990001');
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'humano_entrou' });
  });

  it('a pessoa marcou pela página no meio da conversa: a sessão fecha e a régua da agenda assume', async () => {
    sessao(ANA);
    chegou('5534999990001', 'SIM');
    h.banco.ger.agendamentos = [{ id: 77, cliente_telefone: '553499990001', status: 'agendado', created_by: 'lp_eletroposto' }];
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', agendamento_id: 77, motivo: 'card_por_outra_porta' });
  });

  it('pediu para parar por outra trilha: fecha em silêncio', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Sim');
    h.filtros.silenciados.add('5534999990001');
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'opt_out_por_outra_trilha' });
  });

  it('agente desligada: nenhum robô responde, o recado vai para a equipe', async () => {
    process.env.INVESTIDOR_AGENTE_OFF = '1';
    sessao(ANA);
    chegou('5534999990001', 'Sim, tenho interesse');
    ia('continuar', ['Certo.']);
    const r = await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(r.passadas).toBe(1);
    expect(h.zap.equipe.map(e => e.tel)).toEqual(['34991360223', '34991360172']);
    expect(h.zap.equipe[0]!.texto).toContain('Sim, tenho interesse');
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'agente_desligada' });
  });

  it('resposta com mais de 1 hora (o relógio falhou): não responde atrasado, passa para a equipe', async () => {
    sessao(ANA, { aberto_em: new Date(AGORA.getTime() - 5 * 3600_000).toISOString() });
    chegou('5534999990001', 'Sim', 130);
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.equipe).toHaveLength(2);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'resposta_atrasada' });
  });

  it('sessão que não é mais dela (agendado, humano, sem_interesse) não é lida', async () => {
    sessao(ANA, { estagio: 'humano' });
    chegou('5534999990001', 'Oi');
    expect(await responder()).toMatchObject({ motivo: 'sem_conversa_ativa' });
    expect(h.ia.chamadas).toBe(0);
  });
});

describe('respostas: a IA falhou ou saiu do combinado', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  const esperaPassagemSemFalar = (motivo: string) => {
    expect(h.zap.humano).toHaveLength(0);                       // nada para o cliente
    expect(h.zap.equipe).toHaveLength(2);                       // recado para o Thiago e o Diego
    expect(h.zap.equipe[0]!.texto).toContain('wa.me/5534999990001');
    expect(h.zap.equipe[0]!.texto).toContain('*Com:* Diego');
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo });
  };

  it('IA fora do ar (os dois modelos): não responde, avisa o consultor, sessão `humano`', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    h.ia.erro = true;
    await responder();
    expect(h.ia.chamadas).toBe(2);   // o modelo e a reserva
    esperaPassagemSemFalar('ia_falhou');
  });

  it('JSON inválido: mesmo caminho', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    h.ia.resposta = 'Claro! Posso ajudar com isso.';
    await responder();
    esperaPassagemSemFalar('ia_falhou');
  });

  it('a IA escreveu "cota" e insistiu na reescrita: a mensagem não sai', async () => {
    sessao(ANA); chegou('5534999990001', 'Como funciona?');
    ia('continuar', ['Você entra comprando uma cota.']);
    await responder();
    expect(h.ia.chamadas).toBe(2);   // a resposta e UMA reescrita, não mais
    esperaPassagemSemFalar('resposta_barrada');
  });

  it('BLOQUEANTE: prometeu retorno, foi avisada da regra e reescreveu: sai a reescrita', async () => {
    sessao(ANA); chegou('5534999990001', 'Quanto rende isso?');
    const json = (bolhas: string[]) => JSON.stringify({ bolhas, acao: 'continuar', dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: 'Quer saber dos números.' });
    h.ia.fila.push(
      json(['O retorno é de 3 por cento ao mês, veja solardoc.app/x e lucro garantido.']),
      json(['Os números certinhos quem passa é o Diego, na reunião, com base no seu caso.']),
    );
    const r = await responder();
    expect(h.ia.chamadas).toBe(2);
    expect(h.ia.pedidos[1]).toContain('foi barrada e NÃO foi enviada');
    expect(h.ia.pedidos[1]).toContain('usou a palavra "retorno"');
    expect(r).toMatchObject({ respondidas: 1, passadas: 0 });
    expect(h.zap.humano.map(e => e.partes)).toEqual([['Os números certinhos quem passa é o Diego, na reunião, com base no seu caso.']]);
    expect(h.zap.equipe).toHaveLength(0);
    expect(sessaoDe(ANA).estagio).toBe('conversando');
  });

  it('a reescrita veio fora do formato: não sai nada, vai para o consultor', async () => {
    sessao(ANA); chegou('5534999990001', 'Quanto rende?');
    h.ia.fila.push(
      JSON.stringify({ bolhas: ['Rende 2% ao mês.'], acao: 'continuar', dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' }),
      'desculpe, não consigo',
    );
    await responder();
    esperaPassagemSemFalar('resposta_barrada');
  });
});

describe('respostas: as ações com texto fixo', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('oferecer_horarios: UMA bolha com 4 horários numerados, e a sessão vira `ofertou`', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Pode mandar os horários');
    ia('oferecer_horarios', ['Vou te mandar agora.']);   // a bolha do modelo é ignorada
    await responder();

    expect(h.zap.humano).toHaveLength(1);
    expect(h.zap.humano[0]!.opts).toEqual({ maxBolhas: 1, max: 900 });
    expect(h.zap.humano[0]!.partes).toHaveLength(1);
    const texto = h.zap.humano[0]!.partes[0]!;
    // Domingo 11/10 às 10h: domingo e o feriado de 12/10 ficam de fora.
    expect(texto).toContain('1. Terça 13/10 às 10:00');
    expect(texto).toContain('2. Terça 13/10 às 13:00');
    expect(texto).toContain('3. Quarta 14/10 às 13:00');
    expect(texto).toContain('4. Quarta 14/10 às 15:00');
    expect(texto).not.toContain('Vou te mandar agora');
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'ofertou', oferta: OFERTA, ofertas_feitas: 1 });
  });

  it('sem conseguir ler a agenda: não inventa horário, passa para o consultor', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Pode mandar');
    h.agenda.compromissos = null;
    ia('oferecer_horarios');
    await responder();
    expect(h.zap.humano[0]!.partes[0]).toBe(T.PASSAGEM_PARA_O_CONSULTOR[0]);   // variação pela chave
    expect(h.zap.equipe).toHaveLength(2);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'sem_leitura_da_agenda' });
  });

  it('humano: texto fixo de passagem, recado à equipe, sessão `humano`', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Quero falar com uma pessoa');
    ia('humano', ['O Diego vai falar com você.']);
    const r = await responder();
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.PASSAGEM_PARA_O_CONSULTOR[0]]]);
    expect(h.zap.equipe).toHaveLength(2);
    expect(h.zap.equipe[0]!.texto).toContain('QUER FALAR COM VOCÊ');
    expect(r).toMatchObject({ respondidas: 1, passadas: 1 });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'pediu_humano' });
  });

  it('sem_interesse: despedida fixa, sessão fechada e o cadastro vira sem_interesse nas duas tabelas', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Não tenho mais interesse');
    ia('sem_interesse', ['Tudo bem!']);
    await responder();
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.DESPEDIDA[0]]]);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'disse_nao' });
    expect(h.banco.ger.eletroposto_parceria!.find(x => x.id === 1)!.status).toBe('sem_interesse');
    expect(h.banco.ger.eletroposto_nota1!.find(x => x.id === 21)!.status).toBe('sem_interesse');
    expect(h.zap.equipe).toHaveLength(0);
  });

  it('parar pela IA: quando o pedido não vem com as palavras de sempre', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Olha, prefiro que vocês não me procurem de novo');
    ia('parar', ['Ok.']);
    await responder();
    expect(h.ia.chamadas).toBe(1);
    expect(h.opt).toEqual([{ tel: '5534999990001', motivo: 'opt_out', origem: 'investidor-agente' }]);
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.PAROU[0]]]);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'pediu_parar' });
  });

  it('parar com a IA FORA DO AR: "pare" escrito com todas as letras vira opt-out do mesmo jeito', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Pare');
    h.ia.erro = true;
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.opt).toHaveLength(1);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'pediu_parar' });
    expect(h.zap.equipe).toHaveLength(0);
  });

  it('parar: opt-out da casa ANTES da mensagem, sessão fechada e carimbo do disjuntor', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Para de me mandar mensagem');
    ia('parar', ['Ok.']);
    await responder();
    expect(h.opt).toEqual([{ tel: '5534999990001', motivo: 'opt_out', origem: 'investidor-agente' }]);
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.PAROU[0]]]);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'pediu_parar' });
    expect(chaves('inv_agente_parar:')).toEqual([`inv_agente_parar:2026-10-11:${ANA}`]);
  });

  it('a variação do texto fixo sai da chave: outra pessoa recebe a outra versão', async () => {
    sessao(BRUNO, { estagio: 'conversando', telefone: '5534999990002', refs: [{ origem: 'parceria', id: 2 }] });
    chegou('5534999990002', 'Não quero');
    ia('sem_interesse');
    await responder();
    expect(h.zap.humano[0]!.partes).toEqual([T.DESPEDIDA[1]]);
  });
});

describe('respostas: a escolha do horário', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });
  const ofertou = () => sessao(ANA, {
    estagio: 'ofertou', oferta: OFERTA, ofertas_feitas: 1,
    dados: { valor_confirmado: 'Sim', pagamento: 'Recurso próprio', cidade: 'Uberaba' }, resumo: 'Confirmou o valor. Quer conhecer as opções.',
  });

  it('respondeu "2": agenda direto, sem IA, com o card no formato da casa', async () => {
    ofertou();
    chegou('5534999990001', '2');
    const r = await responder();

    expect(h.ia.chamadas).toBe(0);
    expect(r).toMatchObject({ agendadas: 1, respondidas: 1 });
    expect(h.card.gravados).toHaveLength(1);
    const ficha = h.card.gravados[0]!;
    expect(ficha).toMatchObject({
      vendedor_nome: 'Diego', quando: OFERTA[1], cliente_nome: 'Ana Lima', cliente_telefone: '5534999990001',
      cidade: 'Uberaba', status: 'agendado', created_by: 'agente_eletroposto',
    });
    expect(String(ficha.observacao).split('\n')[0]).toBe('LP ELETROPOSTO · Investidor');
    expect(ficha.observacao).toContain('Quanto pretende investir: R$ 140 mil');
    expect(ficha.observacao).toContain('Como pretende investir: Recurso próprio');
    expect(ficha.observacao).toContain('Cadastro de origem: cadastro de investidor (eletroposto_parceria) #1, de 01/09/2026');

    // Estado primeiro, mensagem depois.
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', agendamento_id: 901, oferta: [] });
    expect(h.zap.humano.map(e => e.partes[0])).toEqual([
      T.CONFIRMACAO[0]!.replace('{consultor}', 'Diego').replace('{quando}', 'terça 13/10 às 13:00'),
    ]);
    // O cadastro vira "conectado", sem passar por cima de sem_interesse.
    const conectado = h.atualizacoes.filter(a => a.patch.status === 'conectado');
    expect(conectado.map(a => a.tabela)).toEqual(['eletroposto_parceria', 'eletroposto_nota1']);
    expect(conectado.every(a => a.or === 'status.is.null,status.in.(novo,falando)')).toBe(true);
  });

  for (const recusa of ['10h não consigo, tem outro?', '15h não dá pra mim', 'Nenhum serve, trabalho até as 15']) {
    it(`BLOQUEANTE: "${recusa}" NÃO agenda; vai para a IA, que pode mandar outra lista`, async () => {
      ofertou();
      chegou('5534999990001', recusa);
      ia('oferecer_horarios');
      await responder();
      expect(h.card.gravados).toHaveLength(0);
      expect(h.ia.chamadas).toBe(1);
      const s = sessaoDe(ANA);
      expect(s.estagio).toBe('ofertou');
      expect(s.agendamento_id).toBeNull();
      expect(s.ofertas_feitas).toBe(2);
      for (const iso of s.oferta) expect(OFERTA).not.toContain(iso);
    });
  }

  for (const escolha of ['2', ' 2 ', '2.', 'opção 2']) {
    it(`"${escolha}" agenda a opção 2, sem IA`, async () => {
      ofertou();
      chegou('5534999990001', escolha);
      await responder();
      expect(h.ia.chamadas).toBe(0);
      expect(h.card.gravados).toHaveLength(1);
      expect(h.card.gravados[0]!.quando).toBe(OFERTA[1]);
      expect(sessaoDe(ANA).estagio).toBe('agendado');
    });
  }

  it('o dia do horário escolhido foi FECHADO depois da oferta: não grava, oferece outros', async () => {
    ofertou();
    chegou('5534999990001', '1');           // terça 13/10 às 10:00
    h.agenda.fechados.add('2026-10-13');
    await responder();
    expect(h.card.gravados).toHaveLength(0);
    const s = sessaoDe(ANA);
    expect(s.estagio).toBe('ofertou');
    // A lista nova não traz nada do dia fechado.
    for (const iso of s.oferta) expect(iso.slice(0, 10)).not.toBe('2026-10-13');
  });

  it('quem vai financiar parte: a coluna do card leva o texto exato da opção da LP', async () => {
    sessao(ANA, { estagio: 'ofertou', oferta: OFERTA, ofertas_feitas: 1, dados: { pagamento: 'Parte própria e parte financiada' } });
    chegou('5534999990001', '2');
    await responder();
    expect(h.card.gravados[0]!.observacao).toContain('Como pretende investir: Recurso próprio + cartão ou financiamento');
  });

  it('"2" seguido de "obrigado" na mesma leva também agenda', async () => {
    ofertou();
    chegou('5534999990001', '2', 3);
    chegou('5534999990001', 'obrigado', 2);
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.card.gravados[0]!.quando).toBe(OFERTA[1]);
  });

  it('o horário foi tomado no meio do caminho: oferece outros 4, sem repetir os de antes', async () => {
    ofertou();
    chegou('5534999990001', '1');
    h.agenda.livre = false;
    await responder();
    expect(h.card.gravados).toHaveLength(0);
    const texto = h.zap.humano[0]!.partes[0]!;
    expect(texto.split('\n')[0]).toBe(T.HORARIO_FOI_OCUPADO);
    const s = sessaoDe(ANA);
    expect(s.estagio).toBe('ofertou');
    expect(s.ofertas_feitas).toBe(2);
    expect(s.oferta).toHaveLength(4);
    for (const iso of s.oferta) expect(OFERTA).not.toContain(iso);
  });

  it('o banco recusou por horário duplicado (23505): mesmo caminho', async () => {
    ofertou();
    chegou('5534999990001', '1');
    h.card.erro = { code: '23505', message: 'duplicate key value violates unique constraint "agendamentos_vq_naosolar_uniq"' };
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'ofertou', ofertas_feitas: 2 });
    expect(h.zap.humano[0]!.partes[0]!.split('\n')[0]).toBe(T.HORARIO_FOI_OCUPADO);
  });

  it('o card não gravou por outro erro: a pessoa é avisada e a equipe recebe o horário para marcar à mão', async () => {
    ofertou();
    chegou('5534999990001', '3');
    h.card.erro = new Error('banco fora');
    await responder();
    expect(h.zap.humano[0]!.partes[0]).toBe(T.PASSAGEM_PARA_O_CONSULTOR[0]);
    expect(h.zap.equipe[0]!.texto).toContain('Quarta 14/10 às 13:00');
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'erro_gravar_card' });
  });

  it('número fora da lista ("7"): pede o número de 1 a 4, sem IA', async () => {
    ofertou();
    chegou('5534999990001', '7');
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.card.gravados).toHaveLength(0);
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.NAO_ENTENDI_O_NUMERO[0]]]);
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('pergunta no meio da oferta vai para a IA, que sabe da lista em aberto', async () => {
    ofertou();
    chegou('5534999990001', 'A reunião é por vídeo?');
    ia('continuar', ['O Diego combina isso com você na confirmação.']);
    await responder();
    expect(h.ia.chamadas).toBe(1);
    expect(h.ia.sistema).toContain('1. Terça 13/10 às 10:00');
    expect(h.card.gravados).toHaveLength(0);
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('telefone FORA DO PADRÃO: nenhum card, nenhuma mensagem', async () => {
    ofertou();
    chegou('5534999990001', '2');
    h.card.bloqueado = true;
    await responder();
    expect(h.zap.humano).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'fora_do_padrao' });
  });
});

describe('o que a agente NÃO faz', () => {
  const fonte = readFileSync(join(__dirname, '..', 'services', 'io', 'investidorAgente.ts'), 'utf8');

  it('não dispara evento do Meta: o arquivo nem importa a API de Conversões', () => {
    expect(fonte).not.toMatch(/capiQuiz|enviarQuizMeta|metaCapi|enviarEventoMeta/);
  });

  it('não usa as variáveis globais de janela para cumprir a própria janela', () => {
    for (const f of ['investidorAgente.ts', 'investidorAgentePuro.ts']) {
      const src = readFileSync(join(__dirname, '..', 'services', 'io', f), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      expect(src).not.toMatch(/JANELA_DOMINGO_ON|JANELA_INICIO_H|JANELA_FIM_H|JANELA_DIURNA_OFF/);
    }
  });

  it('a abertura sai por sendFrio e nunca passa transacional nem piso de hora', () => {
    const semComentario = fonte.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    expect(semComentario).toMatch(/sendFrio\(alvo\.telefone, \[abertura\.texto\], 'io'\)/);
    expect(semComentario).not.toMatch(/transacional\s*:/);
    expect(semComentario).not.toMatch(/pisoHora/);
  });
});

describe('posse com prazo, pela ponta das respostas', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('abertura cujo envio falhou: se a pessoa escrever, a Helena NÃO responde (é da recepção)', async () => {
    sessao(ANA, { erro: '[zapi:io] HTTP 500' });
    chegou('5534999990001', 'Oi, quem é?');
    ia('continuar', ['Certo.']);
    expect(await responder()).toMatchObject({ motivo: 'sem_conversa_ativa' });
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
  });

  it('chamado há mais de 10 dias: a Helena não responde mais', async () => {
    sessao(ANA, { aberto_em: new Date(AGORA.getTime() - 11 * 86_400_000).toISOString() });
    chegou('5534999990001', 'Oi');
    ia('continuar', ['Certo.']);
    expect(await responder()).toMatchObject({ motivo: 'sem_conversa_ativa' });
    expect(h.ia.chamadas).toBe(0);
  });
});

describe('o histórico é o DESTA pessoa', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });
  const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();
  const linha = (telefone: string, texto: string, min: number, from_me = false) =>
    h.banco.main.wa_mensagens!.push({ id: ++seqMsg, telefone, texto, tipo: 'texto', from_me, is_group: false, instancia: 'LINHA_TESTE', momment: antes(min) });

  it('mesmo final em OUTRO DDD é outra pessoa: a conversa dela não entra', async () => {
    sessao(ANA);
    linha('5511999990001', 'CONVERSA DE OUTRA PESSOA EM SAO PAULO', 30, true);
    linha('5534999990001', 'Oi, Ana, tudo bem? Sou a Helena.', 50, true);
    chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.pedido).toContain('Nós: Oi, Ana, tudo bem? Sou a Helena.');
    expect(h.ia.pedido).not.toContain('SAO PAULO');
  });

  it('um LID que contém os mesmos 8 dígitos por acaso não entra', async () => {
    sessao(ANA);
    linha('123499990001567', 'FALA DE UM LID QUALQUER', 30, true);
    chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.pedido).not.toContain('LID QUALQUER');
  });

  it('o que o consultor digitou pelo celular (LID do contato, pelo mapa) entra', async () => {
    sessao(ANA);
    h.banco.main.wa_lid_telefone = [{ lid: '253068247589084', telefone: '5534999990001', chave: ANA }];
    linha('253068247589084', 'Oi Ana, aqui é o Diego, te ligo amanhã', 20, true);
    chegou('5534999990001', 'Combinado');
    ia('continuar', []);
    await responder();
    expect(h.ia.pedido).toContain('Nós: Oi Ana, aqui é o Diego, te ligo amanhã');
  });

  it('a leitura da conversa falhou: NÃO responde e NÃO gasta a vez; na chamada seguinte responde', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    h.falhaDeLeitura.add('wa_lid_telefone');

    const r = await responder();
    expect(r).toMatchObject({ respondidas: 0, erros: 1 });
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(chaves('inv_agente_vez:')).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'chamado', falhas_historico: 1, ate: null });

    h.falhaDeLeitura.clear();
    expect(await responder()).toMatchObject({ respondidas: 1 });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'conversando', falhas_historico: 0 });
  });

  it('terceira falha seguida: vira humano, com recado à equipe e sem resposta de robô', async () => {
    sessao(ANA);
    chegou('5534999990001', 'Sim, tenho interesse');
    ia('continuar', ['Certo.']);
    h.falhaDeLeitura.add('wa_lid_telefone');
    await responder();
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'chamado', falhas_historico: 2 });
    expect(h.zap.equipe).toHaveLength(0);
    await responder();
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.equipe).toHaveLength(2);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'historico_ilegivel' });
  });
});

describe('nome que não é de pessoa, de ponta a ponta', () => {
  it('"Eletro posto" recebe a abertura reserva, e a IA não fica sabendo desse nome', async () => {
    h.banco.ger.eletroposto_parceria = [
      { id: 9, nome: 'Eletro posto', telefone: '5534999990009', cidade: 'Uberlândia', lado: 'capital', capital_faixa: 'R$ 140 mil', status: 'novo', created_at: '2026-09-01T12:00:00Z' },
    ];
    h.banco.ger.eletroposto_nota1 = [];
    await abrir();
    expect(h.zap.frio[0]!.partes[0]).toBe(T.ABERTURA_SEM_NOME.replace('{valor}', 'R$ 140 mil'));
    expect(h.zap.frio[0]!.partes[0]).not.toContain('Eletro');
    expect(sessaoDe('3499990009').abertura).toBe(-1);

    // Ela responde: no que vai para a IA o nome aparece como não informado.
    seqMsg = 0;
    vi.setSystemTime(AGORA);
    chegou('5534999990009', 'Sim');
    ia('continuar', ['Certo.']);
    await runInvestidorRespostasTick();
    expect(h.ia.sistema).toContain('Primeiro nome: não informado');
    expect(h.ia.sistema).not.toContain('Eletro posto');
    expect(h.ia.pedido).not.toContain('Olá, Eletro');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RODADA DE 11/10/2026: cérebro, paradas do modelo, contexto e sonda
// ═════════════════════════════════════════════════════════════════════════════

describe('o cérebro: o que vai na chamada ao modelo', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('principal: opus 5.5, esforço alto, 16000 tokens, formato JSON; sem thinking e sem tool_choice', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    await responder();
    expect(h.ia.params).toHaveLength(1);
    const p = h.ia.params[0]!;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(16000);
    expect(p.output_config.effort).toBe('high');
    expect(p.output_config.format.type).toBe('json_schema');
    expect(p).not.toHaveProperty('thinking');
    expect(p).not.toHaveProperty('tool_choice');
    expect(p).not.toHaveProperty('tools');
  });

  it('a reserva continua sonnet 4.6, com 1500 tokens e sem formato forçado', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    h.ia.paradas.push('refusal');
    await responder();
    expect(h.ia.params.map(p => p.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-4-6']);
    expect(h.ia.params[1]!.max_tokens).toBe(1500);
    expect(h.ia.params[1]).not.toHaveProperty('output_config');
    expect(h.ia.params[1]).not.toHaveProperty('thinking');
  });

  it('a conversa aguenta 16 respostas antes de ir para gente', async () => {
    sessao(ANA, { estagio: 'conversando', respostas: 15 });
    chegou('5534999990001', 'E como funciona?');
    ia('continuar', ['O Diego explica na reunião.']);
    await responder();
    expect(h.ia.chamadas).toBe(1);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'conversando', respostas: 16 });

    chegou('5534999990001', 'Entendi', 1);
    await responder();
    expect(h.ia.chamadas).toBe(1);   // na 17ª não chama mais a IA
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'conversa_longa' });
  });
});

describe('parada do modelo: refusal e max_tokens são falha do principal', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  for (const parada of ['refusal', 'max_tokens']) {
    it(`principal parou com ${parada}: a mesma pergunta vai para a reserva, e a resposta dela sai`, async () => {
      sessao(ANA); chegou('5534999990001', 'Sim');
      ia('continuar', ['Que bom, Ana.']);
      h.ia.paradas.push(parada);
      const r = await responder();
      expect(h.ia.chamadas).toBe(2);
      expect(h.ia.pedidos[1]).toBe(h.ia.pedidos[0]);
      expect(r).toMatchObject({ respondidas: 1, erros: 0 });
      expect(h.zap.humano.map(e => e.partes)).toEqual([['Que bom, Ana.']]);
    });

    it(`principal e reserva pararam com ${parada}: ninguém responde, vira humano`, async () => {
      sessao(ANA); chegou('5534999990001', 'Sim');
      ia('continuar', ['Que bom, Ana.']);
      h.ia.paradas.push(parada, parada);
      await responder();
      expect(h.ia.chamadas).toBe(2);
      expect(h.zap.humano).toHaveLength(0);
      expect(h.zap.equipe).toHaveLength(2);
      expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'ia_falhou' });
    });
  }

  it('JSON truncado do principal (formato inválido) também cai na reserva', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    h.ia.fila.push('{ "bolhas": ["Que bom', JSON.stringify({ bolhas: ['Que bom, Ana.'], acao: 'continuar', dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' }));
    await responder();
    expect(h.ia.params.map(p => p.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-4-6']);
    expect(h.zap.humano.map(e => e.partes)).toEqual([['Que bom, Ana.']]);
  });
});

describe('o contexto que a produção entrega à IA', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('as respostas do formulário das DUAS tabelas, sem a nota, e a data de hoje', async () => {
    h.banco.ger.eletroposto_parceria!.find(x => x.id === 1)!.prazo = 'Nos próximos 3 meses';
    Object.assign(h.banco.ger.eletroposto_nota1!.find(x => x.id === 21)!, {
      ficha: 'LP ELETROPOSTO · Investidor\nNOTA 1 · 5/11 pts (sem ponto próprio)\nPonto: Não tenho ideia de onde instalar\nComo pretende investir: Recurso próprio\nDecisor: Eu decido',
    });
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    await responder();

    const s = h.ia.sistema;
    expect(s).toContain('O que ela JÁ RESPONDEU no formulário:');
    expect(s).toContain('No cadastro de parceria (preencheu o formulário em 01/09/2026):');
    expect(s).toContain('  Cidade: Uberlândia');
    expect(s).toContain('  Quando pretende começar: Nos próximos 3 meses');
    expect(s).toContain('Na página do eletroposto (preencheu o formulário em 20/09/2026):');
    expect(s).toContain('  Ponto: Não tenho ideia de onde instalar');
    expect(s).toContain('  Como pretende investir: Recurso próprio');
    expect(s).toContain('  Decisor: Eu decido');
    expect(s).toContain('você NÃO pergunta de novo');
    expect(s).not.toMatch(/\bNOTA 1\b|5\/11 pts|LP ELETROPOSTO/);
    // AGORA do teste: domingo 11/10/2026, 10:00 de Brasília.
    expect(s).toContain('Agora são 10:00 de domingo, 11/10/2026, horário de Brasília.');
    expect(s).toContain('Amanhã, segunda-feira, 12/10/2026, é feriado nacional: não tem atendimento.');
    // E o histórico vai datado.
    expect(h.ia.pedido).toMatch(/\[11\/10 09:00\] Nós: /);
    expect(h.ia.pedido).toMatch(/\[11\/10 09:58\] Cliente: Sim/);
  });

  it('se a leitura do formulário falhar, ela responde assim mesmo, só sem esse bloco', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    h.falhaDeLeitura.add('eletroposto_parceria');
    h.falhaDeLeitura.add('eletroposto_nota1');
    expect(await responder()).toMatchObject({ respondidas: 1 });
    expect(h.ia.sistema).not.toContain('JÁ RESPONDEU');
  });
});

describe('sondarHelena: o mesmo miolo da produção, sem tocar em nada', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });
  const ctx = {
    nome: 'Carlos', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Thiago', oferta: [] as string[], dados: {},
    formulario: [{ origem: 'nota1' as const, r: { ficha: 'LP ELETROPOSTO · Investidor\nNOTA 1 · 5/11 pts\nDecisor: Eu decido', created_at: '2026-09-18T15:00:00Z' } }],
    agora: AGORA,
  };
  const hist = [{ from_me: true, texto: 'Oi, Carlos, tudo bem? Sou a Helena.', tipo: 'texto', momment: '2026-10-11T12:00:00.000Z' }];
  const novas = [{ from_me: false, texto: 'Quanto rende isso por mês?', tipo: 'texto', momment: '2026-10-11T12:58:00.000Z' }];

  it('devolve modelo, stop_reason, tempo, ação, bolhas, dados, resumo e violação', async () => {
    ia('continuar', ['Os números quem mostra é o Thiago, na reunião.'], { valor_confirmado: 'Sim' }, 'Quer saber dos números.');
    const r = await sondarHelena(ctx, hist, novas);
    expect(r).toMatchObject({
      modelo: 'claude-opus-5-5', stop_reason: 'end_turn', valido: true, acao: 'continuar',
      bolhas: ['Os números quem mostra é o Thiago, na reunião.'], resumo: 'Quer saber dos números.', violacao: null, reescrita: null,
    });
    expect(r.dados.valor_confirmado).toBe('Sim');
    expect(typeof r.ms).toBe('number');
    // Montou o sistema e o pedido pelo caminho de produção.
    expect(h.ia.sistema).toContain('  Decisor: Eu decido');
    expect(h.ia.sistema).not.toMatch(/NOTA 1/);
    expect(h.ia.pedido).toContain('[11/10 09:58] Cliente: Quanto rende isso por mês?');
  });

  it('passa pela trava de conteúdo com a reescrita, igual à produção', async () => {
    const json = (bolhas: string[]) => JSON.stringify({ bolhas, acao: 'continuar', dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' });
    h.ia.fila.push(json(['Rende bem, você ganha uns 4 mil por mês.']), json(['Os números quem mostra é o Thiago, na reunião.']));
    const r = await sondarHelena(ctx, hist, novas);
    expect(h.ia.chamadas).toBe(2);
    expect(r.bolhas).toEqual(['Os números quem mostra é o Thiago, na reunião.']);
    expect(r.violacao).toBeNull();
    expect(r.reescrita).toMatch(/rende/);
  });

  it('reescrita que insiste: devolve a violação (em produção nada sairia)', async () => {
    ia('continuar', ['Se paga em 2 anos.']);
    const r = await sondarHelena(ctx, hist, novas);
    expect(r.violacao).toMatch(/se paga/);
  });

  it('reserva e parada aparecem no resultado', async () => {
    ia('continuar', ['Certo.']);
    h.ia.paradas.push('max_tokens');
    const r = await sondarHelena(ctx, hist, novas);
    expect(r).toMatchObject({ modelo: 'claude-sonnet-4-6', stop_reason: 'end_turn', valido: true });
  });

  it('não grava, não envia e não lê banco', async () => {
    ia('continuar', ['Certo.']);
    h.falhaDeLeitura.add('system_state'); h.falhaDeLeitura.add('wa_mensagens');
    h.falhaDeLeitura.add('eletroposto_parceria'); h.falhaDeLeitura.add('eletroposto_nota1'); h.falhaDeLeitura.add('agendamentos');
    const antes = JSON.stringify(h.banco);
    const r = await sondarHelena(ctx, hist, novas);
    expect(r.valido).toBe(true);
    expect(JSON.stringify(h.banco)).toBe(antes);
    expect(h.zap.frio).toHaveLength(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.equipe).toHaveLength(0);
    expect(h.atualizacoes).toHaveLength(0);
  });
});

describe('ação adiar: "mais para frente eu vejo" não é desinteresse', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('manda SÓ o texto fixo, guarda o resumo, vai para `adiado` e NÃO mexe no status do cadastro', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Não, mês que vem eu te procuro');
    ia('adiar', ['Tudo bem, até mês que vem!', 'Abraço.'], {}, 'Pediu para ser procurada mês que vem.');
    const r = await responder();

    // As bolhas do modelo são ignoradas: sai só o texto do redator.
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.ADIADO[0]]]);
    expect(JSON.stringify(h.zap.humano)).not.toContain('Abraço');
    expect(r).toMatchObject({ respondidas: 1, passadas: 0 });

    const s = sessaoDe(ANA);
    expect(s).toMatchObject({ estagio: 'adiado', motivo: 'adiou', resumo: 'Pediu para ser procurada mês que vem.' });
    expect(s.adiado_em).toBe(AGORA.toISOString());
    // O cadastro fica como estava: nada de sem_interesse.
    expect(h.atualizacoes.filter(a => a.patch.status === 'sem_interesse')).toHaveLength(0);
    expect(h.banco.ger.eletroposto_parceria!.find(x => x.id === 1)!.status).toBe('novo');
    // Não é opt-out.
    expect(h.opt).toHaveLength(0);
    // A equipe é avisada (ressalva da revisão): o Thiago e o Diego recebem o
    // recado com o resumo, que traz a data nas palavras da pessoa.
    expect(h.zap.equipe.map(e => e.tel)).toEqual(['34991360223', '34991360172']);
    const recado = h.zap.equipe[0]!.texto;
    expect(recado).toContain('PEDIU PARA SER PROCURADA DEPOIS');
    expect(recado).toContain('*Resumo:* Pediu para ser procurada mês que vem.');
    expect(recado).toContain('*Escreveu:* Não, mês que vem eu te procuro');
    expect(recado).toContain('wa.me/5534999990001');
    expect(recado).toContain('Se ela escrever de novo, a Helena responde.');
    expect(recado).not.toContain('A partir daqui é com você');
  });

  it('a outra pessoa recebe a outra variação', async () => {
    sessao(BRUNO, { estagio: 'conversando', telefone: '5534999990002', refs: [{ origem: 'parceria', id: 2 }] });
    chegou('5534999990002', 'Agora não dá, depois eu vejo');
    ia('adiar');
    await responder();
    expect(h.zap.humano[0]!.partes).toEqual([T.ADIADO[1]]);
  });

  it('adiado não recebe nada por conta própria: não volta para a fila da abertura', async () => {
    sessao(ANA, { estagio: 'adiado', adiado_em: AGORA.toISOString() });
    const p = await previaInvestidorAgente({ agora: LARGADA }) as Record<string, any>;
    expect(p.primeiros.map((x: any) => x.nome)).not.toContain('Ana');
    // E a prévia mostra o estágio.
    expect(p.sessoes_por_estagio).toEqual({ adiado: 1 });
  });

  it('se a pessoa escrever de novo, a Helena responde normalmente e a sessão volta para `conversando`', async () => {
    sessao(ANA, { estagio: 'adiado', adiado_em: new Date(AGORA.getTime() - 20 * 86_400_000).toISOString(), resumo: 'Pediu para ser procurada mês que vem.' });
    chegou('5534999990001', 'Oi Helena, agora posso conversar');
    ia('continuar', ['Que bom te ver de volta.', 'Posso te mandar os horários para conversar com o Diego?']);
    const r = await responder();
    expect(h.ia.chamadas).toBe(1);
    expect(r).toMatchObject({ respondidas: 1 });
    expect(sessaoDe(ANA).estagio).toBe('conversando');
    // Voltar a conversar não marca o cadastro de novo.
    expect(h.atualizacoes).toHaveLength(0);
  });

  it('passados 60 dias do adiamento a conversa não é mais dela', async () => {
    sessao(ANA, { estagio: 'adiado', adiado_em: new Date(AGORA.getTime() - 61 * 86_400_000).toISOString() });
    chegou('5534999990001', 'Oi');
    ia('continuar', ['Certo.']);
    expect(await responder()).toMatchObject({ motivo: 'sem_conversa_ativa' });
    expect(h.ia.chamadas).toBe(0);
  });
});

describe('nas ações finais sai SÓ o texto fixo, nunca a bolha do modelo', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });
  const casos: Array<[string, readonly string[]]> = [
    ['humano', T.PASSAGEM_PARA_O_CONSULTOR], ['adiar', T.ADIADO], ['sem_interesse', T.DESPEDIDA], ['parar', T.PAROU],
  ];
  for (const [acao, fixo] of casos) {
    it(`${acao}: a bolha do modelo é ignorada`, async () => {
      sessao(ANA, { estagio: 'conversando' });
      chegou('5534999990001', 'mensagem qualquer do cliente');
      ia(acao, ['BOLHA DO MODELO QUE NAO PODE SAIR', 'OUTRA BOLHA']);
      await responder();
      expect(h.zap.humano.map(e => e.partes)).toEqual([[fixo[0]]]);
      expect(JSON.stringify(h.zap.humano)).not.toContain('BOLHA DO MODELO');
    });
  }

  it('a trava de conteúdo não reescreve o que não vai sair: ação final com bolha proibida segue com o texto fixo', async () => {
    sessao(ANA, { estagio: 'conversando' });
    chegou('5534999990001', 'Não quero, obrigado');
    ia('sem_interesse', ['Que pena, o retorno é ótimo.']);
    await responder();
    expect(h.ia.chamadas).toBe(1);
    expect(h.zap.humano.map(e => e.partes)).toEqual([[T.DESPEDIDA[0]]]);
  });
});

describe('tempo limite no modelo (ressalva da revisão)', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });

  it('as duas chamadas, principal e reserva, vão com 45 s de limite e sem repetição automática', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Certo.']);
    h.ia.paradas.push('refusal');   // força a reserva
    await responder();
    expect(h.ia.params.map(p => p.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-4-6']);
    expect(h.ia.opcoes).toEqual([{ timeout: 45_000, maxRetries: 0 }, { timeout: 45_000, maxRetries: 0 }]);
  });

  it('o principal estourou o tempo: é falha dele, a mesma pergunta vai para a reserva e a resposta sai', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Que bom, Ana.']);
    h.ia.estouros = 1;
    const r = await responder();
    expect(h.ia.chamadas).toBe(2);
    expect(h.ia.params.map(p => p.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-4-6']);
    expect(r).toMatchObject({ respondidas: 1, erros: 0 });
    expect(h.zap.humano.map(e => e.partes)).toEqual([['Que bom, Ana.']]);
  });

  it('principal e reserva estouraram: ninguém responde, vira humano', async () => {
    sessao(ANA); chegou('5534999990001', 'Sim');
    ia('continuar', ['Que bom, Ana.']);
    h.ia.estouros = 2;
    await responder();
    expect(h.ia.chamadas).toBe(2);   // sem repetição: uma tentativa em cada modelo
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.equipe).toHaveLength(2);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'ia_falhou' });
  });
});

describe('a trava de formato de ponta a ponta', () => {
  beforeEach(() => { seqMsg = 0; vi.setSystemTime(AGORA); });
  const json = (bolhas: string[]) => JSON.stringify({ bolhas, acao: 'continuar', dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' });

  it('a IA disse "por vídeo": é barrada, reescreve, e sai só "reunião"', async () => {
    sessao(ANA); chegou('5534999990001', 'Como vai ser essa reunião?');
    h.ia.fila.push(json(['É por vídeo, o Diego manda o link.']), json(['É uma conversa com o Diego. Ele combina os detalhes com você pelo WhatsApp dele.']));
    await responder();
    expect(h.ia.chamadas).toBe(2);
    expect(h.ia.pedidos[1]).toContain('falou do formato da reunião');
    expect(h.zap.humano.map(e => e.partes)).toEqual([['É uma conversa com o Diego. Ele combina os detalhes com você pelo WhatsApp dele.']]);
  });

  it('insistiu no formato na reescrita: nada sai, vai para o consultor', async () => {
    sessao(ANA); chegou('5534999990001', 'É presencial?');
    ia('continuar', ['Não, é online.']);
    await responder();
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.equipe).toHaveLength(2);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'resposta_barrada' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RESGATE DOS CANCELADOS (12/10/2026)
// ═════════════════════════════════════════════════════════════════════════════

describe('resgate dos cancelados', () => {
  const HOJE = brt('2026-10-12T10:00');
  const haDias = (n: number) => new Date(HOJE.getTime() - n * 86_400_000).toISOString();
  const DANI = '3499990004';
  const TEL = { ANA: '5534999990001', BRUNO: '5534999990002', CARLA: '5534999990003', DANI: '5534999990004' };
  let seqCard = 100;

  /** Um card na agenda e, se `dias` não for null, o carimbo de liberação da régua do SIM. */
  function card(tel: string, o: { dias?: number | null; escreveu?: boolean; status?: string; quando?: string } = {}): number {
    const id = ++seqCard;
    h.banco.ger.agendamentos!.push({
      id, cliente_telefone: tel, status: o.status ?? 'cancelado', quando: o.quando ?? '2026-09-24T17:00:00Z',
      lead_resposta_at: o.escreveu ? '2026-09-23T12:00:00Z' : null,
    });
    if (o.dias !== null) {
      h.banco.main.system_state!.push({ key: `ep_liberado_sim:${id}`, value: { em: haDias(o.dias ?? 15) }, updated_at: haDias(o.dias ?? 15) });
    }
    return id;
  }
  /** `n` aberturas que já saíram hoje. */
  const saiuHoje = (n: number) => {
    for (let i = 0; i < n; i++) h.banco.main.system_state!.push({ key: `inv_agente_sent:34000${1000 + i}:t1`, value: {}, updated_at: new Date(HOJE.getTime() - 3600_000).toISOString() });
  };
  const resgatesHoje = (n: number) => {
    for (let i = 0; i < n; i++) h.banco.main.system_state!.push({ key: `${INV_RESGATE_PREFIX}34000${2000 + i}`, value: {}, updated_at: new Date(HOJE.getTime() - 3600_000).toISOString() });
  };
  const soAna = () => {
    h.banco.ger.eletroposto_parceria = h.banco.ger.eletroposto_parceria!.filter(r => r.id === 1);
  };
  beforeEach(() => { seqCard = 100; seqMsg = 0; });

  describe('quem entra no grupo', () => {
    it('só cancelado com carimbo: outro status e sem carimbo ficam de fora, e a fila principal não muda', async () => {
      card(TEL.ANA, { dias: 15 });
      card(TEL.BRUNO, { status: 'agendado', dias: null });
      card(TEL.CARLA, { dias: null });
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.elegiveis).toBe(1);
      expect(p.resgate.excluidos).toMatchObject({ card_em_outro_status: 1, sem_carimbo_de_liberacao: 1 });
      expect(p.resgate.primeiros).toEqual([
        { nome: 'Ana', telefone_final: '01', valor: 'R$ 140 mil', mes_da_reuniao: 'setembro', ja_escreveu: false },
      ]);
      expect(p.resgate.textos).toHaveLength(1);
      expect(p.resgate.textos[0]).toContain('setembro');
      // Os três têm card: a fila principal segue excluindo todos como antes.
      expect(p.fila).toBe(0);
      expect(p.excluidos.tem_card).toBeGreaterThanOrEqual(3);
    });

    it('card cancelado MAIS um card em outro status: fica de fora', async () => {
      card(TEL.ANA, { dias: 20 });
      card(TEL.ANA, { status: 'agendado', dias: null });
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.elegiveis).toBe(0);
      expect(p.resgate.excluidos.card_em_outro_status).toBeGreaterThanOrEqual(1);
    });

    it('13 dias de liberação ficam de fora; 14 entram', async () => {
      card(TEL.ANA, { dias: 13 });
      card(TEL.BRUNO, { dias: 14 });
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.excluidos.menos_de_14_dias).toBeGreaterThanOrEqual(1);
      expect(p.resgate.primeiros.map((x: any) => x.nome)).toEqual(['Bruno']);
    });

    it('quem já escreveu alguma vez vem primeiro, mesmo com valor menor', async () => {
      h.banco.ger.eletroposto_parceria!.push({ id: 4, nome: 'Dani Souza', telefone: TEL.DANI, cidade: null, lado: 'capital', capital_faixa: 'R$ 60 mil', status: 'novo', created_at: '2026-09-04T12:00:00Z' });
      card(TEL.ANA, { dias: 15 });
      card(TEL.DANI, { dias: 15 });
      card(TEL.DANI, { dias: 16, escreveu: true });   // um dos cards dela tem resposta
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.primeiros.map((x: any) => [x.nome, x.ja_escreveu])).toEqual([['Dani', true], ['Ana', false]]);
    });

    it('a exceção do mudo vale SÓ para o resgate', async () => {
      card(TEL.ANA, { dias: 15 });
      h.filtros.mudos.add(TEL.ANA); h.filtros.mudos.add(TEL.BRUNO);
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.elegiveis).toBe(1);                 // Ana é muda e entra
      expect(p.excluidos.mudo).toBe(1);                    // Bruno, da fila principal, segue barrado
      expect(p.fila).toBe(1);                              // sobra a Carla
      expect(p.resgate.excluidos.mudo).toBeUndefined();
    });

    it('opt-out, conversa recente e sessão existente continuam valendo no resgate', async () => {
      h.banco.ger.eletroposto_parceria!.push(
        { id: 4, nome: 'Dani Souza', telefone: TEL.DANI, cidade: null, lado: 'capital', capital_faixa: 'R$ 60 mil', status: 'novo', created_at: '2026-09-04T12:00:00Z' },
        { id: 5, nome: 'Eva Melo', telefone: '5534999990005', cidade: null, lado: 'capital', capital_faixa: 'R$ 80 mil', status: 'novo', created_at: '2026-09-05T12:00:00Z' },
      );
      for (const tel of [TEL.BRUNO, TEL.CARLA, TEL.DANI, '5534999990005']) card(tel, { dias: 15 });
      h.filtros.silenciados.add(TEL.BRUNO);
      h.banco.main.wa_mensagens!.push({ id: 1, telefone: TEL.CARLA, texto: 'oi', tipo: 'texto', from_me: false, is_group: false, instancia: 'LINHA_TESTE', momment: haDias(2) });
      h.banco.main.system_state!.push({ key: `inv_agente:${DANI}`, value: { estagio: 'humano' }, updated_at: 'x' });
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.elegiveis).toBe(1);
      expect(p.resgate.primeiros[0].nome).toBe('Eva');
      expect(p.resgate.excluidos).toMatchObject({ opt_out: 1, conversa_7_dias: 1, tem_sessao: 1 });
    });

    it('leitura dos carimbos que falha: o resgate não envia, e a fila principal segue', async () => {
      card(TEL.ANA, { dias: 15 });
      saiuHoje(2);                                         // a próxima seria a 3ª: vez do resgate
      h.falhaDoLike = 'ep_liberado_sim:';
      const r = await abrir(HOJE);
      expect(r).toMatchObject({ enviados: 1, para: 'final 0002' });   // Bruno, da principal
      expect(h.zap.frio.map(f => f.tel)).toEqual([TEL.BRUNO]);
      expect(sessaoDe(BRUNO).grupo).toBeUndefined();
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate.elegiveis).toBeNull();
      expect(p.resgate.erro_da_fila).toContain('ep_liberado_sim:');
    });

    it('leitura dos carimbos que falha e fila principal vazia: não sai nada', async () => {
      soAna();
      card(TEL.ANA, { dias: 15 });
      h.falhaDoLike = 'ep_liberado_sim:';
      const r = await abrir(HOJE);
      expect(r).toMatchObject({ enviados: 0, motivo: 'fila_vazia' });
      expect(h.zap.frio).toHaveLength(0);
    });
  });

  describe('dose e posição', () => {
    it('a 1ª e a 2ª abertura do dia são da fila principal; a 3ª é do resgate', async () => {
      card(TEL.ANA, { dias: 15 });
      const a = await abrir(HOJE);
      expect(a).toMatchObject({ enviados: 1, para: 'final 0002' });
      const b = await abrir(HOJE);
      expect(b).toMatchObject({ enviados: 1, para: 'final 0003' });
      const c = await abrir(HOJE);
      expect(c).toMatchObject({ enviados: 1, para: 'final 0001', grupo: 'resgate' });
      expect(h.zap.frio.map(f => f.tel)).toEqual([TEL.BRUNO, TEL.CARLA, TEL.ANA]);
    });

    it('a abertura de resgate: uma bolha com nome, valor e mês; sessão com os três campos; dois carimbos', async () => {
      card(TEL.ANA, { dias: 15, quando: '2026-09-24T17:00:00Z' });
      saiuHoje(2);
      const r = await abrir(HOJE);
      expect(r).toMatchObject({ enviados: 1, grupo: 'resgate', para: 'final 0001' });
      expect(h.zap.frio).toHaveLength(1);
      expect(h.zap.frio[0]!.partes).toHaveLength(1);
      expect(h.zap.frio[0]!.partes[0]).toContain('Ana');
      expect(h.zap.frio[0]!.partes[0]).toContain('R$ 140 mil');
      expect(h.zap.frio[0]!.partes[0]).toContain('setembro');
      expect(sessaoDe(ANA)).toMatchObject({
        estagio: 'chamado', grupo: 'resgate', sem_retomada: true, reuniao_perdida_em: '2026-09-24T17:00:00Z', telefone: TEL.ANA,
      });
      // O carimbo de envio de sempre CONTINUA sendo gravado, e o do resgate é a mais.
      expect(chaves(INV_SENT_PREFIX)).toContain(`inv_agente_sent:${ANA}:t1`);
      expect(chaves(INV_RESGATE_PREFIX)).toEqual([`inv_agente_resgate:${ANA}`]);
    });

    it('a sessão da fila principal NÃO ganha grupo, sem_retomada nem reuniao_perdida_em', async () => {
      await abrir(HOJE);
      const s = sessaoDe(BRUNO) as unknown as Record<string, unknown>;
      expect('grupo' in s).toBe(false);
      expect('sem_retomada' in s).toBe(false);
      expect('reuniao_perdida_em' in s).toBe(false);
    });

    it('sem elegível na vez do resgate, sai a fila principal', async () => {
      saiuHoje(2);
      const r = await abrir(HOJE);
      expect(r).toMatchObject({ enviados: 1, para: 'final 0002' });
      expect(r.grupo).toBeUndefined();
    });

    it('com a fila principal vazia o resgate usa a vez mesmo fora da posição, limitado a 5 por dia', async () => {
      soAna();
      h.banco.ger.eletroposto_parceria!.push(
        ...[4, 5, 6, 7, 8, 9].map(i => ({ id: i, nome: `Pessoa${'abcdefg'[i - 4]}`, telefone: `553499999${String(i).padStart(4, '0')}`, cidade: null, lado: 'capital', capital_faixa: 'R$ 100 mil', status: 'novo', created_at: '2026-09-04T12:00:00Z' })),
      );
      card(TEL.ANA, { dias: 15 });
      for (let i = 4; i <= 9; i++) card(`553499999${String(i).padStart(4, '0')}`, { dias: 15 });
      h.banco.ger.eletroposto_nota1 = [];
      const saidas: string[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await abrir(HOJE);
        saidas.push(r.enviados ? String(r.grupo) : String(r.motivo));
      }
      expect(saidas).toEqual(['resgate', 'resgate', 'resgate', 'resgate', 'resgate', 'fila_vazia', 'fila_vazia', 'fila_vazia']);
      expect(chaves(INV_RESGATE_PREFIX)).toHaveLength(5);
    });

    it('a 6ª de resgate do dia não sai, mesmo na vez dela, e a principal ocupa o lugar', async () => {
      card(TEL.ANA, { dias: 15 });
      saiuHoje(7);                                         // a próxima é a 8ª: vez do resgate
      resgatesHoje(5);                                     // mas a cota de 5 já foi
      const r = await abrir(HOJE);
      expect(r).toMatchObject({ enviados: 1, para: 'final 0002' });
      expect(r.grupo).toBeUndefined();
    });

    it('INVESTIDOR_AGENTE_RESGATE_DIA só aperta: com 1, a segunda vez do resgate não sai', async () => {
      process.env.INVESTIDOR_AGENTE_RESGATE_DIA = '1';
      card(TEL.ANA, { dias: 15 });
      resgatesHoje(1);
      saiuHoje(2);
      const r = await abrir(HOJE);
      expect(r.grupo).toBeUndefined();
      const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(p.resgate).toMatchObject({ teto_do_dia: 1, enviados_hoje: 1 });
      process.env.INVESTIDOR_AGENTE_RESGATE_DIA = '9';
      expect((await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>).resgate.teto_do_dia).toBe(5);
    });

    it('a prévia diz quem sai na próxima abertura', async () => {
      card(TEL.ANA, { dias: 15 });
      const um = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(um.resgate.proxima_abertura).toEqual({ posicao: 1, grupo: 'principal' });
      saiuHoje(2);
      const tres = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
      expect(tres.resgate.proxima_abertura).toEqual({ posicao: 3, grupo: 'resgate' });
      expect(tres.resgate.disjuntor_do_grupo).toEqual({ pedidos_de_parada_hoje: 0, limite: 2, aberto: false });
    });
  });

  describe('os dois disjuntores são separados', () => {
    const AGORA_DIA = AGORA;   // 11/10/2026 10:00
    const resgateSessao = (chave: string, tel: string, nome: string) =>
      sessao(chave, { grupo: 'resgate', sem_retomada: true, reuniao_perdida_em: '2026-09-24T17:00:00Z', telefone: tel, nome });

    it('dois pedidos de parada de sessões de resgate desligam só o resgate; o geral não conta', async () => {
      resgateSessao(ANA, TEL.ANA, 'Ana');
      resgateSessao(DANI, TEL.DANI, 'Dani');
      chegou(TEL.ANA, 'pare'); chegou(TEL.DANI, 'me tira da lista');
      await responder();
      expect(chaves('inv_agente_parar_resgate:')).toHaveLength(2);
      expect(chaves('inv_agente_parar:')).toHaveLength(0);
      // O pedido de parada em si é tratado como sempre: opt-out e texto fixo.
      expect(h.opt.map(o => o.motivo)).toEqual(['opt_out', 'opt_out']);
      expect(h.zap.humano).toHaveLength(2);

      // Agora o resgate está desligado: na vez dele (3ª) sai a fila principal. A
      // cobertura de elegível vem de um terceiro cancelado.
      card(TEL.BRUNO, { dias: 15 });
      for (let i = 0; i < 2; i++) h.banco.main.system_state!.push({ key: `inv_agente_sent:34000${1000 + i}:t1`, value: {}, updated_at: new Date(AGORA_DIA.getTime() - 1800_000).toISOString() });
      const r = await abrir(new Date(AGORA_DIA.getTime() + 60_000));
      expect(r.motivo).not.toBe('disjuntor_pedidos_de_parada');
      expect(r.grupo).toBeUndefined();
      expect(r).toMatchObject({ enviados: 1, para: 'final 0003' });   // Carla, da principal
      const p = await previaInvestidorAgente({ agora: AGORA_DIA }) as Record<string, any>;
      expect(p.resgate.disjuntor_do_grupo).toMatchObject({ pedidos_de_parada_hoje: 2, aberto: true });
      expect(p.pedidos_de_parada_hoje).toBe(0);
    });

    it('uma parada de resgate só não desliga o grupo', async () => {
      resgateSessao(ANA, TEL.ANA, 'Ana');
      chegou(TEL.ANA, 'pare');
      await responder();
      const p = await previaInvestidorAgente({ agora: AGORA_DIA }) as Record<string, any>;
      expect(p.resgate.disjuntor_do_grupo).toMatchObject({ pedidos_de_parada_hoje: 1, aberto: false });
    });

    it('a parada de sessão da fila principal continua indo para o disjuntor geral', async () => {
      sessao(ANA); chegou(TEL.ANA, 'pare');
      await responder();
      expect(chaves('inv_agente_parar:')).toHaveLength(1);
      expect(chaves('inv_agente_parar_resgate:')).toHaveLength(0);
    });

    it('as paradas de resgate não pesam no geral: 3 delas e a fila principal segue', async () => {
      for (const i of [1, 2, 3]) h.banco.main.system_state!.push({ key: `inv_agente_parar_resgate:2026-10-11:340000000${i}`, value: {}, updated_at: 'x' });
      const r = await abrir(LARGADA);
      expect(r).toMatchObject({ enviados: 1 });
    });

    it('3 pedidos da fila principal continuam parando as aberturas (o disjuntor geral não mudou)', async () => {
      for (const i of [1, 2, 3]) h.banco.main.system_state!.push({ key: `inv_agente_parar:2026-10-11:340000000${i}`, value: {}, updated_at: 'x' });
      expect(await abrir(LARGADA)).toMatchObject({ enviados: 0, motivo: 'disjuntor_pedidos_de_parada' });
    });
  });

  describe('a conversa de resgate', () => {
    const resgateSessao = (over: Partial<SessaoInvestidor> = {}) =>
      sessao(ANA, { grupo: 'resgate', sem_retomada: true, reuniao_perdida_em: '2026-09-24T17:00:00Z', ...over });

    it('os fatos ganham o parágrafo CONVERSA DE RESGATE com o mês preenchido, e o card cancelado dela não cala a Helena', async () => {
      resgateSessao();
      h.banco.ger.agendamentos!.push({ id: 7, cliente_telefone: TEL.ANA, status: 'cancelado', quando: '2026-09-24T17:00:00Z' });
      chegou(TEL.ANA, 'Achei que vocês tinham cancelado');
      ia('continuar', ['Imagina, Ana.', 'Posso te mandar os horários?']);
      const r = await responder();
      expect(r).toMatchObject({ respondidas: 1, erros: 0 });
      expect(h.ia.chamadas).toBe(1);
      expect(h.ia.sistema).toContain('Esta pessoa já teve uma reunião marcada em setembro');
      expect(h.ia.sistema).not.toContain('{mes}');
      expect(sessaoDe(ANA)).toMatchObject({ estagio: 'conversando', grupo: 'resgate' });
      expect(h.zap.humano).toHaveLength(1);
    });

    it('o histórico traz a abertura de RESGATE, não a da fila principal', async () => {
      resgateSessao();
      chegou(TEL.ANA, 'Pode ser');
      ia('continuar', ['Combinado.']);
      await responder();
      expect(h.ia.pedido).toContain('reunião em setembro');
      expect(h.ia.pedido).toContain('Nós: ');
    });

    it('conversa da fila principal: os fatos não ganham o parágrafo', async () => {
      sessao(ANA); chegou(TEL.ANA, 'Sim');
      ia('continuar', ['Que bom.']);
      await responder();
      expect(h.ia.sistema).not.toContain('Esta pessoa já teve uma reunião marcada');
    });

    it('card NOVO (outro status) em quem é de resgate continua valendo como "card por outra porta"', async () => {
      resgateSessao();
      h.banco.ger.agendamentos!.push({ id: 7, cliente_telefone: TEL.ANA, status: 'cancelado', quando: '2026-09-24T17:00:00Z' });
      h.banco.ger.agendamentos!.push({ id: 8, cliente_telefone: TEL.ANA, status: 'agendado', quando: '2026-10-20T17:00:00Z' });
      chegou(TEL.ANA, 'Marquei pela página');
      await responder();
      expect(h.ia.chamadas).toBe(0);
      expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', motivo: 'card_por_outra_porta', agendamento_id: 8 });
    });

    it('na fila principal qualquer card (inclusive cancelado) segue valendo como "card por outra porta"', async () => {
      sessao(ANA);
      h.banco.ger.agendamentos!.push({ id: 7, cliente_telefone: TEL.ANA, status: 'cancelado', quando: '2026-09-24T17:00:00Z' });
      chegou(TEL.ANA, 'Oi');
      await responder();
      expect(h.ia.chamadas).toBe(0);
      expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', motivo: 'card_por_outra_porta' });
    });
  });

  describe('fecho de quem não respondeu em 7 dias', () => {
    const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();
    const resgate = (chave: string, over: Partial<SessaoInvestidor> = {}) =>
      sessao(chave, { grupo: 'resgate', sem_retomada: true, reuniao_perdida_em: '2026-09-24T17:00:00Z', telefone: `55${chave.slice(0, 2)}9${chave.slice(2)}`, ...over });

    it('7 dias em chamado: silencia (nunca_respondeu), vira sem_interesse/sem_resposta e não manda nada', async () => {
      resgate(ANA, { aberto_em: diasAtras(7) });
      const r = await fecharResgatesSemResposta(AGORA.getTime());
      expect(r).toMatchObject({ fechadas: 1, erros: 0 });
      expect(h.opt).toEqual([{ tel: TEL.ANA, motivo: 'nunca_respondeu', origem: 'investidor-agente' }]);
      expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'sem_resposta', grupo: 'resgate' });
      expect(h.zap.frio).toHaveLength(0);
      expect(h.zap.humano).toHaveLength(0);
      expect(h.zap.equipe).toHaveLength(0);
    });

    it('6 dias: nada', async () => {
      resgate(ANA, { aberto_em: diasAtras(6) });
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 0 });
      expect(sessaoDe(ANA).estagio).toBe('chamado');
      expect(h.opt).toHaveLength(0);
    });

    it('vale SÓ para o resgate: sessão da fila principal com 8 dias fica como está', async () => {
      sessao(ANA, { aberto_em: diasAtras(8) });
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 0 });
      expect(sessaoDe(ANA).estagio).toBe('chamado');
      expect(h.opt).toHaveLength(0);
    });

    it('quem respondeu (conversando) e quem nunca foi chamado (erro de envio) não são fechados', async () => {
      resgate(ANA, { aberto_em: diasAtras(9), estagio: 'conversando' });
      resgate(BRUNO, { aberto_em: diasAtras(9), erro: 'HTTP 500' });
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 0 });
      expect(h.opt).toHaveLength(0);
    });

    it('chegou uma mensagem dela que a rodada de respostas ainda não leu: não fecha', async () => {
      resgate(ANA, { aberto_em: diasAtras(8) });
      chegou(TEL.ANA, 'Oi, vi agora', 1);
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 0 });
      expect(sessaoDe(ANA).estagio).toBe('chamado');
    });

    it('no máximo 5 por rodada', async () => {
      for (let i = 1; i <= 7; i++) resgate(`349999100${i}`, { aberto_em: diasAtras(8 + i) });
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 5 });
      expect(h.opt).toHaveLength(5);
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 2 });
    });

    it('leitura que falha não fecha ninguém', async () => {
      resgate(ANA, { aberto_em: diasAtras(8) });
      h.falhaDeLeitura.add('wa_mensagens');
      expect(await fecharResgatesSemResposta(AGORA.getTime())).toMatchObject({ fechadas: 0, erros: 1 });
      expect(h.opt).toHaveLength(0);
      expect(sessaoDe(ANA).estagio).toBe('chamado');
    });

    it('a rodada completa fecha antes de abrir, e sem mandar mensagem por causa do fecho', async () => {
      resgate(ANA, { aberto_em: diasAtras(8) });
      vi.setSystemTime(AGORA);
      const r = await rodarInvestidorAgente() as Record<string, any>;
      expect(r.fecho).toMatchObject({ fechadas: 1 });
      expect(sessaoDe(ANA).motivo).toBe('sem_resposta');
    });
  });
});
