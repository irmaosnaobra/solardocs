// A retomada do convite, a passagem por silêncio e a equipe que assumiu (13/11/2026), de ponta a ponta, sem rede: banco em memória, Z-API e IA simuladas.
// Nomes, telefones e ids inventados.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    /** Chaves de system_state cujo DELETE devolve `{error}` (como o supabase faz: sem rejeitar). */
    falhaNoDelete: new Set<string>(), falhaNoUpsert: new Set<string>(), falhaNoInsert: new Set<string>(),
    atualizacoes: [] as Array<{ tabela: string; patch: Row; id: unknown; or: string | null }>,
    linha: { teto: true, espaco: true, rampa: null as null | { hora: number; dia: number }, pedidosDeTeto: [] as unknown[] },
    filtros: {
      silenciados: new Set<string>(), pausados: new Set<string>(), mudos: new Set<string>(), mudosCom: null as number | null, antesDoClaim: null as null | (() => void),
      /** Leituras de bloqueio que falham: 'silenciados' | 'mudos' | 'bloqueados' | 'pausas'. */
      falha: new Set<string>(),
      /** Quais leituras foram pedidas em modo estrito. */
      estritas: [] as string[],
    },
    zap: { frio: [] as Array<{ tel: string; partes: string[] }>, humano: [] as Array<{ tel: string; partes: string[]; opts: any }>, equipe: [] as Array<{ tel: string; texto: string }>, erroNoFrio: false, calaFrio: false },
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
      /** Espião: roda no instante em que o modelo é chamado. */
      aoChamar: null as null | (() => void),
    },
    agenda: { livre: true, compromissos: [] as Row[] | null, fechados: new Set<string>() },
    card: { gravados: [] as Row[], erro: null as unknown, bloqueado: false, cardsDaLp: 0 },
    opt: [] as Array<{ tel: string; motivo: string; origem: string }>,
    /** As colunas pedidas a `wa_mensagens` em cada leitura (o dublê ignora a lista, então o teste confere aqui). */
    colunasWa: [] as string[],
    /** O transcritor de áudio simulado: o que foi pedido e o que ele devolve. */
    audio: { chamadas: [] as Array<{ url: string; mime: string }>, fn: (async (_url: string) => 'texto do áudio') as (url: string) => Promise<string | null> },
  };
});

function fabrica(base: Record<string, Row[]>) {
  return (tabela: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'upsert' | 'update' | 'delete',
      filtros: [] as Array<(r: Row) => boolean>, ordem: [] as Array<[string, boolean]>,
      de: 0, ate: Infinity, lim: Infinity, head: false, corpo: null as any, id: undefined as unknown, or: null as string | null,
      likes: [] as string[], chave: undefined as unknown,
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
        // `or` de chaves (`key.like.<prefixo>%,key.like.<outro>%`), como o PostgREST: só as linhas que casam com algum padrão.
        const padroesDoOr = st.or && st.or.includes('key.like.') ? [...st.or.matchAll(/key.like.([^,]+)/g)].map(m => m[1]!) : null;
        let r = linhas().filter(x => st.filtros.every(f => f(x)) && (!padroesDoOr || padroesDoOr.some(pt => casa(pt, x.key))));
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
          if (tabela === 'system_state' && [...h.falhaNoInsert].some(p => String(n.key).startsWith(p))) return { data: null, error: { code: '57014', message: 'insert falhou' } };
          if (tabela === 'system_state' && linhas().some(x => x.key === n.key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
        }
        linhas().push(...novas.map(n => ({ ...n })));
        return { data: novas, error: null };
      }
      if (st.op === 'upsert') {
        for (const n of (Array.isArray(st.corpo) ? st.corpo : [st.corpo]) as Row[]) {
          if (tabela === 'system_state' && [...h.falhaNoUpsert].some(p => String(n.key).startsWith(p))) return { data: null, error: { message: 'upsert falhou' } };
          const i = linhas().findIndex(x => x.key === n.key);
          if (i >= 0) linhas()[i] = { ...n }; else linhas().push({ ...n });
        }
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        h.atualizacoes.push({ tabela, patch: st.corpo, id: st.id, or: st.or });
        const tocadas = linhas().filter(x => st.filtros.every(f => f(x)) && passaNoOr(x));
        for (const r of tocadas) Object.assign(r, st.corpo);
        return { data: tocadas.map(r => ({ ...r })), error: null };
      }
      if (tabela === 'system_state' && h.falhaNoDelete.has(String(st.chave))) return { data: null, error: { message: 'delete falhou' } };
      const fica = linhas().filter(x => !st.filtros.every(f => f(x)));
      base[tabela] = fica;
      return { data: null, error: null };
    };
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) st.head = true; if (tabela === 'wa_mensagens') h.colunasWa.push(String(_c)); return q; },
      insert: (corpo: any) => { st.op = 'insert'; st.corpo = corpo; return q; },
      upsert: (corpo: any) => { st.op = 'upsert'; st.corpo = corpo; return q; },
      update: (corpo: any) => { st.op = 'update'; st.corpo = corpo; return q; },
      delete: () => { st.op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { if (c === 'id') st.id = v; if (c === 'key') st.chave = v; st.filtros.push(r => (c.includes('->>') ? (r[c.split('->>')[0]!] ?? {})[c.split('->>')[1]!] : r[c]) === v); return q; },
      in: (c: string, vs: unknown[]) => { if (c === 'key') st.likes.push(String(vs[0])); st.filtros.push(r => vs.includes(r[c])); return q; },
      like: (c: string, p: string) => { st.likes.push(p); st.filtros.push(r => casa(p, r[c])); return q; },
      ilike: (c: string, p: string) => { st.filtros.push(r => casa(p, r[c], true)); return q; },
      gte: (c: string, v: any) => { st.filtros.push(r => r[c] >= v); return q; },
      is: (c: string, v: any) => { st.filtros.push(r => (r[c] ?? null) === v); return q; },
      gt: (c: string, v: any) => { st.filtros.push(r => r[c] > v); return q; },
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
// Fase B1b: força o corte por posse (cedeAAgente) em telefones escolhidos; o resto segue o posse REAL.
const cortes = vi.hoisted(() => ({ cede: new Set<string>() }));
vi.mock('../services/agentes5040/posse', async (orig) => {
  const real = await orig<typeof import('../services/agentes5040/posse')>();
  return { ...real, cedeAAgente: async (t: string) => (cortes.cede.has(String(t)) ? true : real.cedeAAgente(t)) };
});
vi.mock('../utils/mediaProcessor', () => ({
  transcribeAudio: vi.fn(async (url: string, mime: string) => { h.audio.chamadas.push({ url, mime }); return h.audio.fn(url); }),
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223', diego: '34991360172' } }));
vi.mock('../services/io/solarRespostas', () => ({ INSTANCE_ID_IO: 'LINHA_TESTE' }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: vi.fn(async (tel: string, partes: string[]) => {
    if (h.zap.erroNoFrio) throw new Error('[zapi:io] HTTP 500');
    if (h.zap.calaFrio) return false;   // a pausa humana calou o envio na hora
    h.zap.frio.push({ tel, partes });
    return true;
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
        h.ia.aoChamar?.();
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
// Os freios das respostas (60/h, 450/24 h, 10 s entre conversas) têm teste próprio (investidorAgenteLinha.test.ts): aqui passam.
const linhaDaResposta = vi.hoisted(() => ({ ok: true, esperaMs: 0, bolhas: [] as Array<{ chave: string; n: number }>, fichas: [] as number[], conferencias: 0 }));
vi.mock('../services/io/investidorAgenteLinha', () => ({
  PREFIXO_ENV: 'inv_agente_env:',
  LIMITES_DA_RESPOSTA: { horaLinha: 60, diaLinha: 450, entreConversasMs: 10_000 },
  TEMPOS_DA_RESPOSTA: { dormir: async () => {} },
  conferirLinhaParaResposta: vi.fn(async () => { linhaDaResposta.conferencias++; return linhaDaResposta.ok ? { ok: true, esperaMs: linhaDaResposta.esperaMs } : { ok: false, motivo: 'teto_hora' }; }),
  registrarBolhas: vi.fn(async (chave: string, n: number) => { linhaDaResposta.bolhas.push({ chave, n }); }),
  registrarFichaNaLinha: vi.fn(async (cardId: number) => { linhaDaResposta.fichas.push(cardId); }),
}));
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

// ─────────────────────────────────────────────────────────────────────────────
// Dublês a mais, só para a retomada do convite, a passagem por silêncio e a equipe que assumiu (13/11/2026).
// ─────────────────────────────────────────────────────────────────────────────
const x = vi.hoisted(() => ({
  /** As conferências da linha dos avisos à equipe (a regra delas tem teste próprio). */
  confere: { ok: true },
  consultores: new Map<string, string>(),
  leituraDosCelularesFalha: false,
  errosDaLinha: [] as unknown[],
  zeradosDaLinha: 0,
}));
vi.mock('../services/io/investidorAgenteAvisosLinha', () => ({
  conferirAntesDoAviso: vi.fn(async () => (x.confere.ok ? { ok: true } : { ok: false, motivo: 'linha_pausada' })),
}));
vi.mock('../services/agentes5040/guardaDaLinha', () => ({
  contarErroDaLinha: vi.fn(async (_a: Date, e?: unknown) => { x.errosDaLinha.push(e ?? 'calado'); }),
  zerarErrosDaLinha: vi.fn(async () => { x.zeradosDaLinha++; }),
  linhaLivre: vi.fn(async () => 'sim'),
}));
vi.mock('../services/agentes5040/fichaEnvio', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/fichaEnvio')>()),
  carregarTelefonesConsultores: vi.fn(async () => (x.leituraDosCelularesFalha ? { ok: false, codigo: 'interno' } : { ok: true, mapa: x.consultores })),
}));

import { sendFrio, sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';
import { carregarSilenciados } from '../services/agents/whatsapp/silenciar';
import {
  runInvestidorConviteTick, runInvestidorSilencioTick, runInvestidorRespostasTick, previaInvestidorAgente, rodarInvestidorAgente,
  INV_SENT_PREFIX, INV_DISJUNTOR_KEY, INV_OFF_KEY, type SessaoInvestidor,
} from '../services/io/investidorAgente';
import { iniciarRodadaDeAvisos } from '../services/io/investidorAgenteAvisos';
import {
  rodarAvisosDaHelenaEquipe, reservarAvisoDaEquipe, PREFIXO_AVISO_SILENCIO, PREFIXO_AVISO_ASSUMIU, CARIMBO_SILENCIO, CARIMBO_ASSUMIU,
} from '../services/io/investidorAgenteAvisosEquipe';
import { TEXTO_DO_SILENCIO, textoEquipeAssumiu } from '../services/io/investidorAgenteConvite';
import { horarioNaFrase, lerChaveDeToque } from '../services/io/investidorAgentePuro';
import * as fs from 'fs';
import * as path from 'path';

const HORA = 3_600_000;
const brt = (s: string): Date => new Date(`${s}:00-03:00`);
const HOJE = brt('2026-11-13T10:00');                    // sexta-feira: janela do frio aberta, teto 20
const ANA = '3499990001', BRUNO = '3499990002';
const TEL_ANA = '5534999990001', TEL_BRUNO = '5534999990002';
const CEL_DIEGO = '5534999990021', CEL_THIAGO = '5534999990022';
const estado = (chave: string): Row | undefined => h.banco.main.system_state!.find(r => r.key === chave);
const sessaoDe = (chave: string): SessaoInvestidor => estado(`inv_agente:${chave}`)!.value;
const chaves = (prefixo: string): string[] => h.banco.main.system_state!.filter(r => String(r.key).startsWith(prefixo)).map(r => r.key);
const atras = (horas: number, de: Date = HOJE): string => new Date(de.getTime() - horas * HORA).toISOString();

let seq = 0;
/** Uma mensagem na linha. `quem`: 'dela' (automação), 'equipe' (gente no celular da linha, from_api falso) ou 'cliente'. */
function msg(tel: string, quem: 'dela' | 'equipe' | 'cliente', horasAtras: number, texto = 'texto', tipo = 'texto') {
  h.banco.main.wa_mensagens!.push({
    id: ++seq, telefone: tel, texto, tipo, is_group: false, instancia: 'LINHA_TESTE', momment: atras(horasAtras),
    from_me: quem !== 'cliente', from_api: quem === 'dela' ? true : quem === 'equipe' ? false : null,
  });
}

/**
 * A sessão de quem recebeu o convite e parou de responder: conversando, com convite registrado, cuja última fala da Helena foi há
 * `horas` horas (a sessão é gravada antes de cada fala, então o `atualizado_em` fica colado nela).
 */
function convite(chave: string, tel: string, over: Partial<SessaoInvestidor> = {}, horas = 30, mensagens = true) {
  const ultima = atras(horas);
  const s: SessaoInvestidor = {
    estagio: 'conversando', aberto_em: atras(5 * 24), abertura: 0, origem: 'parceria', id: 1,
    refs: [{ origem: 'parceria', id: 1 }], telefone: tel, nome: 'Ana Lima', cidade: 'Uberlândia', cadastro_em: '2026-09-01T12:00:00Z',
    valor_txt: 'R$ 140 mil', consultor: 'Diego', oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null,
    dados: { valor_confirmado: 'Sim', cidade: 'Uberaba' }, resumo: 'Confirmou o valor.', erro: null, ate: atras(horas + 1), respostas: 3,
    atualizado_em: ultima, tipo: 'investidor', card_id: 501, cards_conhecidos: [501], convidou_em: ultima, convites: 1, ...over,
  };
  h.banco.main.system_state!.push({ key: `inv_agente:${chave}`, value: s, updated_at: ultima });
  if (mensagens) {
    msg(tel, 'dela', horas + 5, 'Oi, sou a Helena');
    msg(tel, 'cliente', horas + 4, 'Oi, tenho interesse');
    msg(tel, 'dela', horas, 'Podemos marcar uma conversa com o Diego?');
  }
}

const enviarConvite = (agora: Date = HOJE) => { vi.setSystemTime(agora); return runInvestidorConviteTick({ agora }); };
const silenciar = (agora: Date = HOJE) => { vi.setSystemTime(agora); return runInvestidorSilencioTick({ agora }); };
const depois = (min: number): Date => new Date(HOJE.getTime() + min * 60_000);

const envOriginal = { ...process.env };
beforeEach(() => {
  for (const t of Object.keys(h.banco.main)) h.banco.main[t] = [];
  for (const t of Object.keys(h.banco.ger)) h.banco.ger[t] = [];
  h.banco.ger.agendamentos = [
    { id: 501, cliente_telefone: TEL_ANA, cliente_nome: 'Ana Lima', status: 'cancelado', quando: '2026-09-10T15:00:00Z', created_by: 'lp_eletroposto', vendedor_nome: 'Diego', created_at: '2026-09-02T12:00:00Z' },
    { id: 502, cliente_telefone: TEL_BRUNO, cliente_nome: 'Bruno Reis', status: 'cancelado', quando: '2026-09-11T15:00:00Z', created_by: 'lp_eletroposto', vendedor_nome: 'Thiago', created_at: '2026-09-03T12:00:00Z' },
  ];
  h.falhaDeLeitura.clear(); h.falhaDoLike = null; h.atualizacoes.length = 0;
  Object.assign(h.linha, { teto: true, espaco: true, rampa: null }); h.linha.pedidosDeTeto.length = 0;
  h.filtros.silenciados.clear(); h.filtros.pausados.clear(); h.filtros.mudos.clear(); h.filtros.mudosCom = null; h.filtros.antesDoClaim = null;
  h.filtros.falha.clear(); h.filtros.estritas.length = 0;
  h.zap.frio.length = 0; h.zap.humano.length = 0; h.zap.equipe.length = 0; h.zap.erroNoFrio = false; h.zap.calaFrio = false;
  h.falhaNoDelete.clear(); h.falhaNoUpsert.clear(); h.falhaNoInsert.clear();
  Object.assign(h.ia, { resposta: '', chamadas: 0, sistema: '', pedido: '', erro: false }); h.ia.fila.length = 0; h.ia.pedidos.length = 0;
  h.ia.paradas.length = 0; h.ia.params.length = 0; h.ia.opcoes.length = 0; h.ia.estouros = 0;
  Object.assign(h.agenda, { livre: true, compromissos: [] }); h.agenda.fechados.clear();
  Object.assign(h.card, { erro: null, bloqueado: false, cardsDaLp: 0 }); h.card.gravados.length = 0;
  h.opt.length = 0; h.colunasWa.length = 0;
  Object.assign(linhaDaResposta, { ok: true, esperaMs: 0, conferencias: 0 }); linhaDaResposta.bolhas.length = 0; linhaDaResposta.fichas.length = 0;
  Object.assign(x, { leituraDosCelularesFalha: false, zeradosDaLinha: 0 }); x.confere.ok = true; x.errosDaLinha.length = 0;
  x.consultores = new Map([['diego', CEL_DIEGO], ['thiago', CEL_THIAGO]]);
  delete process.env.INVESTIDOR_AGENTE_OFF; delete process.env.INVESTIDOR_AGENTE_TETO; delete process.env.INVESTIDOR_AGENTE_RETOMADAS_DIA;
  seq = 0;
  iniciarRodadaDeAvisos();
  vi.useFakeTimers();
  vi.setSystemTime(HOJE);
});
afterEach(() => { cortes.cede.clear(); vi.useRealTimers(); process.env = { ...envOriginal }; });

// ═════════════════════════════════════════════════════════════════════════════
describe('retomada do convite: o caminho feliz', () => {
  it('manda UMA bolha com 2 horários, com o carimbo c1 e a sessão `ofertou` gravados ANTES do envio', async () => {
    convite(ANA, TEL_ANA);
    // O que está no banco NO INSTANTE do envio: carimbo e sessão já gravados (estado primeiro, claim antes).
    const noEnvio: Array<{ c1: boolean; estagio: string }> = [];
    vi.mocked(sendFrio).mockImplementationOnce(async (tel: string, partes: string[]) => {
      noEnvio.push({ c1: !!estado(`inv_agente_sent:${ANA}:c1`), estagio: sessaoDe(ANA).estagio });
      h.zap.frio.push({ tel, partes });
      return true;
    });
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 1, para: 'final 0001' });
    expect(noEnvio).toEqual([{ c1: true, estagio: 'ofertou' }]);
    expect(h.zap.frio).toHaveLength(1);
    expect(h.zap.frio[0]!.tel).toBe(TEL_ANA);
    expect(h.zap.frio[0]!.partes).toHaveLength(1);

    const s = sessaoDe(ANA);
    expect(s.estagio).toBe('ofertou');
    expect(s.oferta).toHaveLength(2);
    expect(s.ofertas_feitas).toBe(1);
    expect(s.convite_retomado_em).toBe(HOJE.toISOString());
    const texto = h.zap.frio[0]!.partes[0]!;
    expect(texto).toContain('com Diego');
    expect(texto).toContain(horarioNaFrase(s.oferta[0]!));
    expect(texto).toContain(horarioNaFrase(s.oferta[1]!));
    expect(texto).not.toMatch(/[—–]/);
    expect(estado(`inv_agente_sent:${ANA}:c1`)!.value).toMatchObject({ convite: true });
    expect(x.zeradosDaLinha).toBe(1);
  });

  it('os 2 horários ficam no futuro e na faixa de reunião nova (:00 e :30)', async () => {
    convite(ANA, TEL_ANA);
    await enviarConvite();
    for (const iso of sessaoDe(ANA).oferta) {
      expect(new Date(iso).getTime()).toBeGreaterThan(HOJE.getTime());
      expect(new Date(new Date(iso).getTime() - 3 * HORA).getUTCMinutes() % 30).toBe(0);
    }
  });

  it('o carimbo c1 entra na conta única, mas não vira toque nem abertura', async () => {
    convite(ANA, TEL_ANA);
    await enviarConvite();
    expect(chaves(INV_SENT_PREFIX)).toEqual([`inv_agente_sent:${ANA}:c1`]);
    expect(lerChaveDeToque(`inv_agente_sent:${ANA}:c1`)).toBeNull();
  });

  it('uma vez por pessoa para sempre: a segunda rodada não manda de novo, mesmo 3 dias depois', async () => {
    convite(ANA, TEL_ANA);
    await enviarConvite();
    expect(await enviarConvite(new Date(HOJE.getTime() + 3 * 24 * HORA))).toMatchObject({ enviados: 0, motivo: 'nenhum_candidato' });
    expect(h.zap.frio).toHaveLength(1);
  });

  it('uma pessoa por chamada: com duas elegíveis, a mais antiga sai e a outra espera a próxima rodada', async () => {
    convite(ANA, TEL_ANA, {}, 30);
    convite(BRUNO, TEL_BRUNO, { nome: 'Bruno Reis', consultor: 'Thiago', card_id: 502, cards_conhecidos: [502] }, 40);
    await enviarConvite();
    expect(h.zap.frio).toHaveLength(1);
    expect(h.zap.frio[0]!.tel).toBe(TEL_BRUNO);
    expect(sessaoDe(ANA).estagio).toBe('conversando');
  });

  it('quem estava em `ofertou` (lista de 4 sem resposta) também recebe, com 2 horários novos', async () => {
    const antiga = ['2026-11-16T12:00:00.000Z', '2026-11-16T17:30:00.000Z', '2026-11-17T12:00:00.000Z', '2026-11-17T17:30:00.000Z'];
    convite(ANA, TEL_ANA, { estagio: 'ofertou', oferta: antiga, ofertas_feitas: 1, convidou_em: undefined });
    const r = await enviarConvite();
    expect(r.enviados).toBe(1);
    const s = sessaoDe(ANA);
    expect(s.ofertas_feitas).toBe(2);
    expect(s.oferta).toHaveLength(2);
    for (const iso of s.oferta) expect(antiga).not.toContain(iso);   // os que já foram oferecidos ficam de fora
  });
});

describe('retomada do convite: quem NÃO entra', () => {
  const nada = async (esperado: string | RegExp) => {
    const r = await enviarConvite();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toMatch(esperado);
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  };

  it('menos de 24 h da última fala da Helena', async () => {
    convite(ANA, TEL_ANA, {}, 23.5);
    await nada('menos_de_24h');
  });

  it('o cliente escreveu depois da última fala dela', async () => {
    convite(ANA, TEL_ANA);
    msg(TEL_ANA, 'cliente', 26, 'só um minuto');
    await nada('cliente_depois');
  });

  it('outro robô falou depois da Helena (from_api verdadeiro, mas a fala não é dela)', async () => {
    convite(ANA, TEL_ANA);
    msg(TEL_ANA, 'dela', 26, 'lembrete de outro robô');
    await nada('outra_fala_depois');
  });

  it('conversa vazia: não envia', async () => {
    convite(ANA, TEL_ANA, {}, 30, false);
    await nada('sem_conversa');
  });

  it('erro ao ler a conversa: não envia e não muda a sessão', async () => {
    convite(ANA, TEL_ANA);
    h.falhaDeLeitura.add('wa_lid_telefone');
    const antes = JSON.stringify(sessaoDe(ANA));
    await nada('erro_leitura_conversa');
    expect(JSON.stringify(sessaoDe(ANA))).toBe(antes);
  });

  it.each([
    ['grupo resgate', { grupo: 'resgate' as const }],
    ['sem_retomada', { sem_retomada: true }],
    ['erro de envio', { erro: 'falhou' }],
    ['ciclo encerrado', { ciclo_encerrado: 'outra_conversa' as const }],
    ['3 listas já feitas', { ofertas_feitas: 3 }],
    ['conversando sem convite registrado', { convidou_em: undefined }],
    ['conversando sem resposta da Helena', { respostas: 0 }],
    ['estágio chamado', { estagio: 'chamado' as const }],
    ['estágio humano', { estagio: 'humano' as const }],
    ['estágio agendado', { estagio: 'agendado' as const }],
    ['já recebeu a retomada', { convite_retomado_em: atras(60) }],
  ])('sessão fora da regra: %s', async (_nome, over) => {
    convite(ANA, TEL_ANA, over as Partial<SessaoInvestidor>);
    await nada('nenhum_candidato');
  });
});

describe('retomada do convite: os portões, todos antes do claim', () => {
  const nadaSaiu = (motivo: string | RegExp, r: { enviados: number; motivo?: string }) => {
    expect(r.enviados).toBe(0);
    expect(r.motivo).toMatch(motivo);
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX).filter(k => k.endsWith(':c1'))).toHaveLength(0);
    expect(sessaoDe(ANA).estagio).toBe('conversando');
  };

  it('chave de desligar (env e banco) e disjuntor de erros', async () => {
    convite(ANA, TEL_ANA);
    process.env.INVESTIDOR_AGENTE_OFF = '1';
    nadaSaiu('desligada_env', await enviarConvite());
    delete process.env.INVESTIDOR_AGENTE_OFF;
    h.banco.main.system_state!.push({ key: INV_OFF_KEY, value: { off: true }, updated_at: atras(1) });
    nadaSaiu('desligada_banco', await enviarConvite());
    h.banco.main.system_state = h.banco.main.system_state!.filter(r => r.key !== INV_OFF_KEY);
    h.banco.main.system_state!.push({ key: INV_DISJUNTOR_KEY, value: { erros_seguidos: 2, aberto: true }, updated_at: atras(1) });
    nadaSaiu('disjuntor_erros_de_envio', await enviarConvite());
  });

  it('grupo fechado hoje pelo pedido de parada (investidor: 3)', async () => {
    convite(ANA, TEL_ANA);
    for (const n of [1, 2, 3]) h.banco.main.system_state!.push({ key: `inv_agente_parar:2026-11-13:investidor:00000000${n}`, value: {}, updated_at: atras(1) });
    nadaSaiu('nenhum_candidato', await enviarConvite());
  });

  it('fora da janela do frio: domingo, antes das 9h e depois das 19h59', async () => {
    convite(ANA, TEL_ANA);
    nadaSaiu('fora_da_janela', await enviarConvite(brt('2026-11-15T10:00')));     // domingo
    nadaSaiu('fora_da_janela', await enviarConvite(brt('2026-11-13T08:30')));
    nadaSaiu('fora_da_janela', await enviarConvite(brt('2026-11-13T20:10')));
  });

  it('feriado nacional abre (a janela do frio é a da abertura)', async () => {
    convite(ANA, TEL_ANA, {}, 30);
    const r = await enviarConvite(brt('2026-11-20T10:00'));   // sexta, Consciência Negra
    expect(r.enviados).toBe(1);
  });

  it('teto do dia e cota das retomadas (o c1 conta nas duas)', async () => {
    convite(ANA, TEL_ANA);
    process.env.INVESTIDOR_AGENTE_TETO = '1';
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${BRUNO}:t1`, value: {}, updated_at: atras(1) });
    nadaSaiu('teto_do_dia', await enviarConvite());
    process.env.INVESTIDOR_AGENTE_TETO = '20';
    h.banco.main.system_state = h.banco.main.system_state!.filter(r => !String(r.key).startsWith('inv_agente_sent:'));
    process.env.INVESTIDOR_AGENTE_RETOMADAS_DIA = '1';
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${BRUNO}:t2`, value: {}, updated_at: atras(1) });
    nadaSaiu('cota_de_retomadas', await enviarConvite());
  });

  it('o teto e o espaço da linha (portão do frio)', async () => {
    convite(ANA, TEL_ANA);
    h.linha.teto = false;
    nadaSaiu('portao_do_frio', await enviarConvite());
    h.linha.teto = true; h.linha.espaco = false;
    nadaSaiu('portao_do_frio', await enviarConvite());
  });

  it('opt-out, mudo (3 toques em 60 dias) e pausa humana: leituras em modo estrito', async () => {
    convite(ANA, TEL_ANA);
    h.filtros.silenciados.add(TEL_ANA);
    nadaSaiu('nenhuma_passou_nos_cortes', await enviarConvite());
    expect(h.filtros.estritas).toEqual(expect.arrayContaining(['silenciados', 'mudos', 'bloqueados', 'pausas']));
    h.filtros.silenciados.clear(); h.filtros.mudos.add(TEL_ANA);
    nadaSaiu('nenhuma_passou_nos_cortes', await enviarConvite());
    expect(h.filtros.mudosCom).toBe(3);
    h.filtros.mudos.clear(); h.filtros.pausados.add(TEL_ANA);
    nadaSaiu('nenhuma_passou_nos_cortes', await enviarConvite());
  });

  it('leitura de corte que falha: ninguém recebe', async () => {
    convite(ANA, TEL_ANA);
    for (const f of ['silenciados', 'mudos', 'bloqueados', 'pausas']) {
      h.filtros.falha.clear(); h.filtros.falha.add(f);
      nadaSaiu('erro_leitura_cortes', await enviarConvite());
    }
  });

  it('pausa humana que aparece na hora de falar (podeFalarComLead)', async () => {
    convite(ANA, TEL_ANA);
    h.filtros.antesDoClaim = () => h.filtros.pausados.add(TEL_ANA);
    nadaSaiu('humano_na_conversa', await enviarConvite());
  });

  it('posse de agente da 5040: cede', async () => {
    convite(ANA, TEL_ANA);
    cortes.cede.add(TEL_ANA);
    nadaSaiu('posse_de_agente_5040', await enviarConvite());
  });

  it('robô de agenda com a pessoa (reagenda ainda com volta num card não atendido): cede', async () => {
    convite(ANA, TEL_ANA, { cards_conhecidos: [501, 509] });
    h.banco.ger.agendamentos!.push({ id: 509, cliente_telefone: TEL_ANA, status: 'nao_atendeu', quando: atras(48), created_by: 'lp_eletroposto', vendedor_nome: 'Diego' });
    nadaSaiu('robo_de_agenda_com_a_pessoa', await enviarConvite());
  });

  it('o card_id entra no lote dos robôs de agenda, mesmo fora de cards_conhecidos', async () => {
    convite(ANA, TEL_ANA, { cards_conhecidos: [], card_id: 509 });
    h.banco.ger.agendamentos!.push({ id: 509, cliente_telefone: TEL_ANA, status: 'nao_atendeu', quando: atras(48), created_by: 'lp_eletroposto', vendedor_nome: 'Diego' });
    nadaSaiu('robo_de_agenda_com_a_pessoa', await enviarConvite());
  });

  it('card por outra porta: a sessão fecha como agendado e NADA sai', async () => {
    convite(ANA, TEL_ANA);
    h.banco.ger.agendamentos!.push({ id: 700, cliente_telefone: TEL_ANA, cliente_nome: 'Ana Lima', status: 'agendado', quando: '2026-11-20T15:00:00Z', created_by: 'manual', vendedor_nome: 'Diego' });
    const r = await enviarConvite();
    expect(r.enviados).toBe(0);
    expect(h.zap.frio).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', agendamento_id: 700, motivo: 'card_por_outra_porta' });
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  });

  it('erro ao ler os cards: ninguém recebe (falha fechada)', async () => {
    convite(ANA, TEL_ANA);
    h.falhaDeLeitura.add('agendamentos');
    const r = await enviarConvite();
    expect(r.enviados).toBe(0);
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  });

  it('a sessão relida com outro estágio (mexida entre a leitura e o envio): não manda', async () => {
    convite(ANA, TEL_ANA);
    const linha = h.banco.main.system_state!.find(r => r.key === `inv_agente:${ANA}`)!;
    // Entre a leitura das sessões e a releitura, outra rodada passa a sessão para `humano`.
    vi.mocked(carregarSilenciados).mockImplementationOnce(async () => { linha.value = { ...linha.value, estagio: 'humano' }; return () => false; });
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'sessao_mudou' });
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  });

  it('a sessão relida com outro atualizado_em: não manda', async () => {
    convite(ANA, TEL_ANA);
    const linha = h.banco.main.system_state!.find(r => r.key === `inv_agente:${ANA}`)!;
    vi.mocked(carregarSilenciados).mockImplementationOnce(async () => { linha.value = { ...linha.value, atualizado_em: atras(0.2) }; return () => false; });
    expect(await enviarConvite()).toMatchObject({ enviados: 0, motivo: 'sessao_mudou' });
    expect(h.zap.frio).toHaveLength(0);
  });
});

describe('retomada do convite: 2 horários livres do consultor dono do card', () => {
  it('sem leitura da agenda: não envia nessa rodada, e a pessoa fica para a próxima', async () => {
    convite(ANA, TEL_ANA);
    h.agenda.compromissos = null;
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'sem_leitura_da_agenda' });
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
    expect(sessaoDe(ANA).estagio).toBe('conversando');
    h.agenda.compromissos = [];
    expect((await enviarConvite(depois(10))).enviados).toBe(1);
  });

  it('o consultor sem 2 horários livres no horizonte: não envia, mesmo com o outro consultor livre', async () => {
    convite(ANA, TEL_ANA);
    // O Diego está ocupado do começo ao fim do horizonte; o Thiago, livre.
    h.agenda.compromissos = [{ ts: HOJE.getTime(), dono: 'Diego', ini: HOJE.getTime() - 86_400_000, fim: HOJE.getTime() + 60 * 86_400_000 }];
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'sem_2_horarios_livres' });
    expect(h.zap.frio).toHaveLength(0);
    expect(chaves(INV_SENT_PREFIX)).toHaveLength(0);
  });

  it('um horário tomado pelo consultor sai da oferta: os 2 vêm livres para ELE', async () => {
    convite(ANA, TEL_ANA);
    const original = JSON.parse(JSON.stringify(sessaoDe(ANA)));
    await enviarConvite();
    const livres = sessaoDe(ANA).oferta;
    // Refaz do zero, com o primeiro horário tomado pelo Diego (e livre para o Thiago).
    h.banco.main.system_state = h.banco.main.system_state!.filter(r => !String(r.key).startsWith('inv_agente_sent:'));
    estado(`inv_agente:${ANA}`)!.value = original;
    h.zap.frio.length = 0;
    h.agenda.compromissos = [{ ts: new Date(livres[0]!).getTime(), dono: 'Diego', ep: true }];
    await enviarConvite(depois(15));
    expect(h.zap.frio).toHaveLength(1);
    expect(sessaoDe(ANA).oferta).not.toContain(livres[0]);
  });
});

describe('retomada do convite: claim e envio', () => {
  it('23505 no carimbo c1: já saiu, pula e não manda nem mexe na sessão', async () => {
    convite(ANA, TEL_ANA);
    // Outra chamada pega o carimbo entre a leitura e o claim.
    h.filtros.antesDoClaim = () => { h.banco.main.system_state!.push({ key: `inv_agente_sent:${ANA}:c1`, value: {}, updated_at: atras(0) }); };
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'ja_reivindicado' });
    expect(h.zap.frio).toHaveLength(0);
    expect(sessaoDe(ANA).estagio).toBe('conversando');
    expect(sessaoDe(ANA).convite_retomado_em).toBeUndefined();
  });

  it('erro de envio: desfaz a sessão, apaga o c1, conta o erro na linha e no disjuntor', async () => {
    convite(ANA, TEL_ANA);
    const antes = JSON.parse(JSON.stringify(sessaoDe(ANA)));
    h.zap.erroNoFrio = true;
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'erro_envio' });
    expect(estado(`inv_agente_sent:${ANA}:c1`)).toBeUndefined();
    expect(sessaoDe(ANA)).toEqual(antes);                           // idêntica, inclusive o atualizado_em
    expect(estado(`inv_agente:${ANA}`)!.updated_at).toBe(antes.atualizado_em);
    expect(x.errosDaLinha).toHaveLength(1);
    expect(estado(INV_DISJUNTOR_KEY)!.value).toMatchObject({ erros_seguidos: 1 });
    // E a pessoa continua elegível na próxima rodada (a fala da Helena continua sendo a última).
    h.zap.erroNoFrio = false;
    expect((await enviarConvite(depois(15))).enviados).toBe(1);
  });

  it('envio calado pela pausa humana: desfaz a sessão, apaga o c1 e NÃO conta erro de linha (como a retomada)', async () => {
    convite(ANA, TEL_ANA);
    const antes = JSON.parse(JSON.stringify(sessaoDe(ANA)));
    h.zap.calaFrio = true;
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'envio_calado_pela_linha' });
    expect(estado(`inv_agente_sent:${ANA}:c1`)).toBeUndefined();
    expect(sessaoDe(ANA)).toEqual(antes);
    expect(x.errosDaLinha).toHaveLength(0);
    expect(estado(INV_DISJUNTOR_KEY)).toBeUndefined();
  });

  it('o sucesso zera o disjuntor que tinha 1 erro', async () => {
    convite(ANA, TEL_ANA);
    h.banco.main.system_state!.push({ key: INV_DISJUNTOR_KEY, value: { erros_seguidos: 1, aberto: false }, updated_at: atras(1) });
    expect((await enviarConvite()).enviados).toBe(1);
    expect(estado(INV_DISJUNTOR_KEY)!.value).toMatchObject({ erros_seguidos: 0, aberto: false });
  });
});

describe('retomada do convite: a escolha do cliente segue pelo fluxo de `ofertou`', () => {
  const responder = (min = 20) => { vi.setSystemTime(depois(min)); return runInvestidorRespostasTick(); };
  const cardDaAna = () => h.banco.ger.agendamentos!.find(c => c.id === 501)!;
  const deleNaLinha = (texto: string) => h.banco.main.wa_mensagens!.push({
    id: ++seq, telefone: TEL_ANA, texto, tipo: 'texto', from_me: true, from_api: true, is_group: false, instancia: 'LINHA_TESTE', momment: HOJE.toISOString(),
  });
  const cliente = (texto: string, depoisMin: number) => h.banco.main.wa_mensagens!.push({
    id: ++seq, telefone: TEL_ANA, texto, tipo: 'texto', from_me: false, from_api: null, is_group: false, instancia: 'LINHA_TESTE', momment: depois(depoisMin).toISOString(),
  });

  it('"2" marca a reunião no 2º horário da retomada, sem IA para escolher', async () => {
    convite(ANA, TEL_ANA);
    await enviarConvite();
    const oferta = sessaoDe(ANA).oferta;
    deleNaLinha(h.zap.frio[0]!.partes[0]!);   // a retomada entra na linha, como o webhook a registra
    cliente('2', 5);
    const r = await responder();
    expect(r).toMatchObject({ agendadas: 1 });
    // O card parado da pessoa (501) é REMARCADO para o 2º horário, pelo mesmo caminho da oferta normal.
    expect(cardDaAna()).toMatchObject({ status: 'agendado', quando: oferta[1], vendedor_nome: 'Diego' });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', agendamento_id: 501 });
  });

  it('"3" (fora dos 2 horários) pede o número de novo e não marca nada', async () => {
    convite(ANA, TEL_ANA);
    await enviarConvite();
    deleNaLinha('retomada');
    cliente('3', 5);
    await responder();
    expect(cardDaAna()).toMatchObject({ status: 'cancelado' });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('"o primeiro", em palavras: a IA devolve agendar com opcao 1 e a reunião marca no 1º horário', async () => {
    convite(ANA, TEL_ANA);
    await enviarConvite();
    const oferta = sessaoDe(ANA).oferta;
    deleNaLinha('retomada');
    cliente('pode ser o primeiro', 5);
    h.ia.resposta = JSON.stringify({ bolhas: [], acao: 'agendar', opcao: 1, dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: 'Escolheu o primeiro.' });
    const r = await responder();
    expect(r).toMatchObject({ agendadas: 1 });
    expect(cardDaAna()).toMatchObject({ status: 'agendado', quando: oferta[0] });
  });
});

describe('a rodada: a ordem do frio', () => {
  const rodar = (min: number) => { vi.setSystemTime(depois(min)); return rodarInvestidorAgente() as Promise<Record<string, any>>; };

  function frioDeAbertura() {
    h.banco.ger.eletroposto_parceria = [
      { id: 7, nome: 'Carla Exemplo', telefone: '5534999990007', cidade: 'Uberaba', lado: 'capital', capital_faixa: 'R$ 140 mil', status: 'novo', created_at: '2026-09-01T12:00:00Z' },
    ];
    h.banco.ger.agendamentos!.push({ id: 507, cliente_telefone: '5534999990007', cliente_nome: 'Carla Exemplo', status: 'cancelado', quando: '2026-09-10T15:00:00Z', created_by: 'lp_eletroposto', vendedor_nome: 'Thiago', created_at: '2026-09-02T12:00:00Z' });
  }
  const sessaoBruno = (over: Partial<SessaoInvestidor>): Row => ({ key: `inv_agente:${BRUNO}`, updated_at: atras(3), value: {
    estagio: 'chamado', aberto_em: atras(10 * 24), abertura: 0, origem: 'parceria', id: 2, refs: [], telefone: TEL_BRUNO, nome: 'Bruno Reis', cidade: null,
    cadastro_em: null, valor_txt: 'R$ 100 mil', consultor: 'Thiago', oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null, dados: {}, resumo: '', erro: null,
    ate: null, respostas: 0, atualizado_em: atras(10 * 24), tipo: 'investidor', card_id: 502, cards_conhecidos: [502], ...over,
  } });

  it('o convite sai ANTES da abertura, e a rodada tem UM envio frio só', async () => {
    convite(ANA, TEL_ANA);
    frioDeAbertura();
    const r = await rodar(0);
    expect(r.convite).toMatchObject({ enviados: 1 });
    expect(r.abertura).toMatchObject({ enviados: 0, motivo: 'convite_enviado' });
    expect(h.zap.frio.map(f => f.tel)).toEqual([TEL_ANA]);
    // Na rodada seguinte, sem convite a mandar, a abertura sai.
    const r2 = await rodar(10);
    expect(r2.abertura).toMatchObject({ enviados: 1 });
    expect(h.zap.frio.map(f => f.tel)).toEqual([TEL_ANA, '5534999990007']);
  });

  it('o convite sai ANTES de uma retomada (toques 2 a 5) vencida', async () => {
    convite(ANA, TEL_ANA);
    h.banco.main.system_state!.push(sessaoBruno({}));
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${BRUNO}:t1`, value: {}, updated_at: atras(10 * 24) });
    const r = await rodar(0);
    expect(r.convite).toMatchObject({ enviados: 1 });
    expect(r.retomada).toBeUndefined();
    expect(h.zap.frio.map(f => f.tel)).toEqual([TEL_ANA]);
  });

  it('a resposta atrasada que saiu como frio já gastou o envio: o convite espera', async () => {
    convite(ANA, TEL_ANA);
    // O Bruno escreveu há 20 min (passou dos 15 min): a resposta sai como frio.
    h.banco.main.system_state!.push(sessaoBruno({ estagio: 'conversando', aberto_em: atras(3), atualizado_em: atras(3), respostas: 1 }));
    msg(TEL_BRUNO, 'dela', 3, 'Oi, sou a Helena');
    msg(TEL_BRUNO, 'cliente', 0.34, 'Oi, pode falar');
    h.ia.resposta = JSON.stringify({ bolhas: ['Claro, qual o valor que você pensa em investir?'], acao: 'continuar', opcao: 0, dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' });
    const r = await rodar(0);
    expect(r.respostas).toMatchObject({ frio: 1 });
    expect(r.convite).toBeUndefined();
    expect(h.zap.frio.map(f => f.tel)).toEqual([TEL_BRUNO]);
    expect(sessaoDe(ANA).estagio).toBe('conversando');
  });

  it('o convite respeita o portão do frio: fechado, nada de frio sai na rodada', async () => {
    convite(ANA, TEL_ANA);
    frioDeAbertura();
    h.linha.espaco = false;
    const r = await rodar(0);
    expect(r.convite).toBeUndefined();
    expect(h.zap.frio).toHaveLength(0);
  });
});

describe('prévia: conta os candidatos da retomada do convite', () => {
  it('candidatos, cortes e elegíveis agora, sem enviar nada e sem nome nem telefone', async () => {
    convite(ANA, TEL_ANA);                                                   // elegível
    convite(BRUNO, TEL_BRUNO, { nome: 'Bruno Reis', consultor: 'Thiago', card_id: 502, cards_conhecidos: [502] }, 10);   // 10 h: cedo
    const antes = JSON.stringify(h.banco.main.system_state);
    const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
    expect(p.convite_retomada).toMatchObject({ candidatos: 2, passaram_nos_cortes: 2, elegiveis_agora: 1, motivos_da_conversa: { menos_de_24h: 1 }, ja_retomados: 0 });
    expect(JSON.stringify(p.convite_retomada)).not.toMatch(/Ana|Bruno|5534/);
    expect(JSON.stringify(h.banco.main.system_state)).toBe(antes);
    expect(h.zap.frio).toHaveLength(0);
  });

  it('quem já foi retomado e quem está nos cortes não entram na contagem', async () => {
    convite(ANA, TEL_ANA);
    h.filtros.silenciados.add(TEL_ANA);
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${BRUNO}:c1`, value: {}, updated_at: atras(2) });
    const p = await previaInvestidorAgente({ agora: HOJE }) as Record<string, any>;
    expect(p.convite_retomada).toMatchObject({ candidatos: 1, passaram_nos_cortes: 0, elegiveis_agora: 0, excluidos: { opt_out: 1 }, ja_retomados: 1 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('passagem por silêncio', () => {
  /** A sessão que recebeu a retomada do convite `horas` atrás (a própria retomada é a última fala). */
  function retomada(chave: string, tel: string, horas: number, over: Partial<SessaoInvestidor> = {}) {
    convite(chave, tel, {
      estagio: 'ofertou', oferta: ['2026-11-16T12:00:00.000Z', '2026-11-16T17:30:00.000Z'], ofertas_feitas: 1,
      convite_retomado_em: atras(horas), atualizado_em: atras(horas), ...over,
    }, horas);
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${chave}:c1`, value: { convite: true }, updated_at: atras(horas) });
  }

  it('fronteira de 48 h: 47h54 não passa, depois de 48h passa para `humano` com o motivo', async () => {
    retomada(ANA, TEL_ANA, 47.9);
    expect(await silenciar()).toMatchObject({ passadas: 0 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
    expect(await silenciar(depois(10))).toMatchObject({ passadas: 1, erros: 0 });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'silencio_depois_do_convite' });
  });

  it('nada sai para o cliente (nem frio, nem resposta)', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    expect(h.zap.frio).toHaveLength(0);
    expect(h.zap.humano).toHaveLength(0);
  });

  it('reserva a trava `pendente` do aviso, uma por sessão', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'pendente', consultor: 'Diego' });
    // Reprocessar não duplica: a sessão já é `humano`, e a trava é um insert.
    expect(await silenciar(depois(10))).toMatchObject({ passadas: 0 });
    expect(chaves(PREFIXO_AVISO_SILENCIO)).toHaveLength(1);
  });

  it('cliente ou outro robô escrevendo depois da retomada: a sessão fica como está', async () => {
    retomada(ANA, TEL_ANA, 60);
    msg(TEL_ANA, 'cliente', 50, 'oi, vi agora');
    retomada(BRUNO, TEL_BRUNO, 60, { nome: 'Bruno Reis' });
    msg(TEL_BRUNO, 'dela', 50, 'outro robô');
    await silenciar();
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
    expect(sessaoDe(BRUNO).estagio).toBe('ofertou');
  });

  it('a equipe escreveu depois da retomada: vira `equipe_assumiu`, não silêncio', async () => {
    retomada(ANA, TEL_ANA, 60);
    msg(TEL_ANA, 'equipe', 50, 'oi, aqui é o Diego');
    expect(await silenciar()).toMatchObject({ passadas: 0, equipe: 1 });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeTruthy();
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)).toBeUndefined();
  });

  it('estágio que não é mais da Helena (agendado, sem_interesse) não muda', async () => {
    retomada(ANA, TEL_ANA, 60, { estagio: 'agendado' });
    retomada(BRUNO, TEL_BRUNO, 60, { estagio: 'sem_interesse', nome: 'Bruno Reis' });
    await silenciar();
    expect(sessaoDe(ANA).estagio).toBe('agendado');
    expect(sessaoDe(BRUNO).estagio).toBe('sem_interesse');
  });

  it('erro ao ler a conversa: a sessão não muda e o erro é contado', async () => {
    retomada(ANA, TEL_ANA, 60);
    h.falhaDeLeitura.add('wa_lid_telefone');
    expect(await silenciar()).toMatchObject({ passadas: 0, erros: 1 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('com a Helena desligada, não mexe em nada', async () => {
    retomada(ANA, TEL_ANA, 60);
    process.env.INVESTIDOR_AGENTE_OFF = '1';
    expect(await silenciar()).toMatchObject({ passadas: 0, motivo: 'desligada_env' });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('o aviso sai pelo enviarComConferencias, só ao consultor dono do card, com a linha do silêncio no topo da ficha', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    iniciarRodadaDeAvisos();
    expect(await rodarAvisosDaHelenaEquipe(HOJE, () => 0)).toMatchObject({ tipo: 'silencio', enviados: 1 });
    expect(h.zap.equipe).toHaveLength(1);
    expect(h.zap.equipe[0]!.tel).toBe(CEL_DIEGO);                  // o celular do Diego, nada de outro número
    const texto = h.zap.equipe[0]!.texto;
    const linhas = texto.split('\n');
    expect(linhas[0]).toBe('*HELENA PASSOU UMA CONVERSA PARA VOCÊ*');
    expect(linhas[1]).toBe(TEXTO_DO_SILENCIO);
    expect(texto).toContain('*Cliente:* Ana Lima');
    expect(texto).toContain('Confirmou o valor.');
    expect(texto.length).toBeLessThanOrEqual(1500);
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'enviado' });
    expect(estado(`${CARIMBO_SILENCIO}${ANA}`)).toBeTruthy();
    expect(h.zap.frio).toHaveLength(0);
    expect(x.zeradosDaLinha).toBe(1);
  });

  it('o carimbo é o próprio: não grava por cima do ficha_lead:helena:<card>', async () => {
    h.banco.main.system_state!.push({ key: 'ficha_lead:helena:501', value: { em: 'marcação' }, updated_at: atras(5) });
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(estado('ficha_lead:helena:501')!.value).toEqual({ em: 'marcação' });
  });

  it('consultor sem celular: a trava vira `descartado` com motivo sem_celular, e nada sai', async () => {
    retomada(ANA, TEL_ANA, 60, { consultor: 'Fulano' });
    await silenciar();
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(h.zap.equipe).toHaveLength(0);
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'descartado', motivo: 'sem_celular' });
    expect(estado(`${CARIMBO_SILENCIO}${ANA}`)).toBeUndefined();
  });

  it('leitura da lista de celulares que falha deixa a trava pendente (não prova que ele está sem celular)', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    x.leituraDosCelularesFalha = true;
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(h.zap.equipe).toHaveLength(0);
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'pendente' });
  });

  it('linha que não cabe: a trava fica pendente e sai numa rodada seguinte', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    x.confere.ok = false;
    iniciarRodadaDeAvisos();
    expect(await rodarAvisosDaHelenaEquipe(HOJE, () => 0)).toMatchObject({ enviados: 0, motivo: 'pendente' });
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'pendente' });
    x.confere.ok = true;
    iniciarRodadaDeAvisos();
    expect(await rodarAvisosDaHelenaEquipe(HOJE, () => 0)).toMatchObject({ enviados: 1 });
  });

  it('erro de envio: a trava volta a pendente e conta o erro da linha', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    vi.mocked(sendWhatsApp).mockRejectedValueOnce(new Error('[zapi:io] HTTP 500'));
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'pendente' });
    expect(x.errosDaLinha).toHaveLength(1);
    expect(estado(`${CARIMBO_SILENCIO}${ANA}`)).toBeUndefined();
  });

  it('1 aviso por rodada, somando os dois tipos: os outros saem nas rodadas seguintes', async () => {
    retomada(ANA, TEL_ANA, 60);
    retomada(BRUNO, TEL_BRUNO, 70, { nome: 'Bruno Reis', consultor: 'Thiago' });
    await silenciar();
    await reservarAvisoDaEquipe('assumiu', { chave: '3499990009', consultor: 'Diego', texto: textoEquipeAssumiu({ consultor: 'Diego', nome: 'Carla', tipo: 'curioso' }) });
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(h.zap.equipe).toHaveLength(1);
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);                 // mesma rodada: não passa de 1
    expect(h.zap.equipe).toHaveLength(1);
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(h.zap.equipe).toHaveLength(3);
    expect(new Set(h.zap.equipe.map(e => e.texto)).size).toBe(3);
  });

  it('pela rodada completa: passa para `humano` e o aviso sai depois dos avisos que já existiam', async () => {
    retomada(ANA, TEL_ANA, 60);
    const r = await (async () => { vi.setSystemTime(HOJE); return rodarInvestidorAgente() as Promise<Record<string, any>>; })();
    expect(r.silencio).toMatchObject({ passadas: 1 });
    expect(r.avisos_helena).toMatchObject({ tipo: 'silencio', enviados: 1 });
    expect(sessaoDe(ANA).estagio).toBe('humano');
    expect(h.zap.equipe).toHaveLength(1);
    expect(h.zap.frio.filter(f => f.tel === TEL_ANA)).toHaveLength(0);
  });

  it('com a Helena desligada ou o disjuntor aberto, os avisos novos não saem', async () => {
    retomada(ANA, TEL_ANA, 60);
    await silenciar();
    process.env.INVESTIDOR_AGENTE_OFF = '1';
    vi.setSystemTime(HOJE);
    const r = await rodarInvestidorAgente() as Record<string, any>;
    expect(r.avisos_helena).toBeUndefined();
    expect(h.zap.equipe).toHaveLength(0);
    delete process.env.INVESTIDOR_AGENTE_OFF;
    h.banco.main.system_state!.push({ key: INV_DISJUNTOR_KEY, value: { erros_seguidos: 2, aberto: true }, updated_at: atras(0.1) });
    vi.setSystemTime(depois(6));
    await rodarInvestidorAgente();
    expect(h.zap.equipe).toHaveLength(0);
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)!.value).toMatchObject({ estado: 'pendente' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('a equipe assumiu', () => {
  const responder = () => { vi.setSystemTime(HOJE); return runInvestidorRespostasTick(); };
  const cliente = (tel: string, texto: string, minAtras = 2) => h.banco.main.wa_mensagens!.push({
    id: ++seq, telefone: tel, texto, tipo: 'texto', from_me: false, from_api: null, is_group: false, instancia: 'LINHA_TESTE',
    momment: new Date(HOJE.getTime() - minAtras * 60_000).toISOString(),
  });
  const equipeDigitou = (tel: string, minAtras: number, fromApi: boolean | null = false) => h.banco.main.wa_mensagens!.push({
    id: ++seq, telefone: tel, texto: 'Oi, aqui é o Diego', tipo: 'texto', from_me: true, from_api: fromApi, is_group: false, instancia: 'LINHA_TESTE',
    momment: new Date(HOJE.getTime() - minAtras * 60_000).toISOString(),
  });
  /** A sessão em conversa, aberta há 2 h, com a última fala da Helena há 1 h. */
  function ativa(over: Partial<SessaoInvestidor> = {}) {
    convite(ANA, TEL_ANA, { aberto_em: atras(2), atualizado_em: atras(1), ...over }, 1, false);
    msg(TEL_ANA, 'dela', 1.5, 'Oi, sou a Helena');
  }
  const ia1 = () => { h.ia.resposta = JSON.stringify({ bolhas: ['Certo.'], acao: 'continuar', opcao: 0, dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' }); };

  it('from_api falso depois da abertura: ela NÃO responde, a sessão vira `humano` com o motivo', async () => {
    ativa();
    equipeDigitou(TEL_ANA, 30);
    cliente(TEL_ANA, 'Oi, pode falar');
    ia1();
    expect(await responder()).toMatchObject({ respondidas: 0 });
    expect(h.ia.chamadas).toBe(0);
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.frio).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
  });

  it('from_api nulo (gente no celular, como a Caixa lê) também dispara', async () => {
    ativa();
    equipeDigitou(TEL_ANA, 30, null);
    cliente(TEL_ANA, 'Oi');
    ia1();
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
    expect(h.ia.chamadas).toBe(0);
  });

  it('from_api verdadeiro (outro robô) NÃO é "assumiu": ela responde normalmente', async () => {
    ativa();
    equipeDigitou(TEL_ANA, 30, true);
    cliente(TEL_ANA, 'Oi, pode falar');
    ia1();
    expect(await responder()).toMatchObject({ respondidas: 1 });
    expect(h.ia.chamadas).toBe(1);
    expect(sessaoDe(ANA).estagio).not.toBe('humano');
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeUndefined();
  });

  it('a equipe falou ANTES da abertura da Helena: não conta', async () => {
    ativa({ aberto_em: atras(1.9) });
    equipeDigitou(TEL_ANA, 60 * 24);
    cliente(TEL_ANA, 'Oi, pode falar');
    ia1();
    expect(await responder()).toMatchObject({ respondidas: 1 });
  });

  it('a equipe falou DEPOIS da mensagem nova do cliente (a leitura vai até agora): também sai', async () => {
    ativa();
    cliente(TEL_ANA, 'Oi, pode falar', 5);
    equipeDigitou(TEL_ANA, 3);
    ia1();
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
    expect(h.ia.chamadas).toBe(0);
  });

  it('a mensagem do cliente não se perde: o cursor avança e a Helena não a processa depois', async () => {
    ativa();
    equipeDigitou(TEL_ANA, 30);
    cliente(TEL_ANA, 'Oi, pode falar');
    ia1();
    await responder();
    expect(sessaoDe(ANA).ate).toBeTruthy();
    expect(await responder()).toMatchObject({ respondidas: 0 });
    expect(h.ia.chamadas).toBe(0);
  });

  it('o consultor dono do card recebe 1 aviso (texto 4), 1 vez por sessão, com trava e carimbo', async () => {
    ativa();
    equipeDigitou(TEL_ANA, 30);
    cliente(TEL_ANA, 'Oi, pode falar');
    await responder();
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)!.value).toMatchObject({ estado: 'pendente', consultor: 'Diego' });
    iniciarRodadaDeAvisos();
    expect(await rodarAvisosDaHelenaEquipe(HOJE, () => 0)).toMatchObject({ tipo: 'assumiu', enviados: 1 });
    expect(h.zap.equipe).toHaveLength(1);
    expect(h.zap.equipe[0]!.tel).toBe(CEL_DIEGO);
    expect(h.zap.equipe[0]!.texto).toBe('*HELENA SAIU DA CONVERSA*\nDiego, alguém da equipe escreveu para Ana Lima (Investidor) pela linha e a Helena parou de responder. A conversa está na Caixa da 5040.');
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)!.value).toMatchObject({ estado: 'enviado' });
    expect(estado(`${CARIMBO_ASSUMIU}${ANA}`)).toBeTruthy();
    // Nenhuma outra rodada manda de novo, nem se a reserva for tentada outra vez.
    expect(await reservarAvisoDaEquipe('assumiu', { chave: ANA, consultor: 'Diego', texto: 'outra vez' })).toBe('existia');
    iniciarRodadaDeAvisos();
    expect(await rodarAvisosDaHelenaEquipe(HOJE, () => 0)).toMatchObject({ nada: true });
    expect(h.zap.equipe).toHaveLength(1);
  });

  it('nome vazio vira "a pessoa" no aviso', async () => {
    ativa({ nome: null });
    equipeDigitou(TEL_ANA, 30);
    cliente(TEL_ANA, 'Oi');
    await responder();
    iniciarRodadaDeAvisos();
    await rodarAvisosDaHelenaEquipe(HOJE, () => 0);
    expect(h.zap.equipe[0]!.texto).toContain('escreveu para a pessoa (Investidor)');
  });

  it('falha fechada: a leitura da conversa falha, ela não responde e não muda o estado (3 falhas seguidas passam para gente)', async () => {
    ativa();
    cliente(TEL_ANA, 'Oi, pode falar');
    ia1();
    h.falhaDeLeitura.add('wa_lid_telefone');
    expect(await responder()).toMatchObject({ respondidas: 0, erros: 1 });
    expect(h.ia.chamadas).toBe(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'conversando', falhas_historico: 1 });
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'conversando', falhas_historico: 2 });
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'historico_ilegivel' });
    expect(h.zap.humano).toHaveLength(0);
  });

  it('sessão que não é mais da Helena (agendado sem preparo) não é tocada', async () => {
    ativa({ estagio: 'agendado', agendamento_id: 900 });
    equipeDigitou(TEL_ANA, 30);
    cliente(TEL_ANA, 'Oi');
    await responder();
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeUndefined();
  });

  it('a retomada do convite também confere a equipe: gente digitou depois da fala dela, vira `equipe_assumiu` e NADA sai', async () => {
    convite(ANA, TEL_ANA);
    msg(TEL_ANA, 'equipe', 26, 'oi, aqui é o Diego');
    expect(await enviarConvite()).toMatchObject({ enviados: 0, motivo: 'equipe_assumiu' });
    expect(h.zap.frio).toHaveLength(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Correções da revisão e do anti-ban (13/11/2026)
// ═════════════════════════════════════════════════════════════════════════════
describe('anti-ban: o claim e a vaga do frio', () => {
  const frioDeAbertura = () => {
    h.banco.ger.eletroposto_parceria = [
      { id: 7, nome: 'Carla Exemplo', telefone: '5534999990007', cidade: 'Uberaba', lado: 'capital', capital_faixa: 'R$ 140 mil', status: 'novo', created_at: '2026-09-01T12:00:00Z' },
    ];
    h.banco.ger.agendamentos!.push({ id: 507, cliente_telefone: '5534999990007', cliente_nome: 'Carla Exemplo', status: 'cancelado', quando: '2026-09-10T15:00:00Z', created_by: 'lp_eletroposto', vendedor_nome: 'Thiago', created_at: '2026-09-02T12:00:00Z' });
  };

  it('23505 no claim do c1 ENCERRA a rodada: o próximo candidato não é tentado (nada de 2 frios em segundos)', async () => {
    convite(ANA, TEL_ANA, {}, 30);
    convite(BRUNO, TEL_BRUNO, { nome: 'Bruno Reis', consultor: 'Thiago', card_id: 502, cards_conhecidos: [502] }, 40);   // o mais antigo vai primeiro
    h.filtros.antesDoClaim = () => {
      if (!estado(`inv_agente_sent:${BRUNO}:c1`)) h.banco.main.system_state!.push({ key: `inv_agente_sent:${BRUNO}:c1`, value: {}, updated_at: atras(0) });
    };
    const r = await enviarConvite();
    expect(r).toMatchObject({ enviados: 0, motivo: 'ja_reivindicado' });
    expect(h.zap.frio).toHaveLength(0);
    expect(estado(`inv_agente_sent:${ANA}:c1`)).toBeUndefined();
    expect(sessaoDe(ANA).estagio).toBe('conversando');
  });

  it('convite com erro de envio gasta a vaga: nessa rodada não roda retomada nem abertura', async () => {
    convite(ANA, TEL_ANA);
    frioDeAbertura();
    // Uma retomada (toque 2) vencida de outra pessoa.
    h.banco.main.system_state!.push({ key: `inv_agente:${BRUNO}`, updated_at: atras(10 * 24), value: {
      estagio: 'chamado', aberto_em: atras(10 * 24), abertura: 0, origem: 'parceria', id: 2, refs: [], telefone: TEL_BRUNO, nome: 'Bruno Reis', cidade: null,
      cadastro_em: null, valor_txt: 'R$ 100 mil', consultor: 'Thiago', oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null, dados: {}, resumo: '', erro: null,
      ate: null, respostas: 0, atualizado_em: atras(10 * 24), tipo: 'investidor', card_id: 502, cards_conhecidos: [502],
    } });
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${BRUNO}:t1`, value: {}, updated_at: atras(10 * 24) });
    h.zap.erroNoFrio = true;
    const antes = vi.mocked(sendFrio).mock.calls.length;
    vi.setSystemTime(HOJE);
    const r = await rodarInvestidorAgente() as Record<string, any>;
    expect(r.convite).toMatchObject({ enviados: 0, motivo: 'erro_envio' });
    expect(r.abertura).toMatchObject({ enviados: 0, motivo: 'convite_falhou_vaga_gasta' });
    // UMA tentativa de envio frio na rodada inteira (a do convite): nem retomada, nem abertura.
    expect(vi.mocked(sendFrio).mock.calls.length - antes).toBe(1);
    expect(h.zap.frio).toHaveLength(0);
  });
});

describe('revisão: a sessão antiga (anterior ao inv_agente_env) continua elegível', () => {
  it('ofertou antiga: t1 da abertura, sem inv_agente_env, última fala colada no atualizado_em: recebe a retomada', async () => {
    convite(ANA, TEL_ANA, { estagio: 'ofertou', oferta: ['2026-10-14T12:00:00.000Z', '2026-10-14T17:30:00.000Z'], ofertas_feitas: 1, convidou_em: undefined,
      aberto_em: atras(32 * 24 + 1), atualizado_em: atras(32 * 24) }, 32 * 24, false);
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${ANA}:t1`, value: {}, updated_at: atras(32 * 24 + 1) });
    msg(TEL_ANA, 'dela', 32 * 24 + 1, 'abertura');
    msg(TEL_ANA, 'cliente', 32 * 24 + 0.5, 'tenho interesse');
    msg(TEL_ANA, 'dela', 32 * 24, 'lista de horários');
    expect(await enviarConvite()).toMatchObject({ enviados: 1 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
    expect(sessaoDe(ANA).ofertas_feitas).toBe(2);
  });
});

describe('revisão: a fala dela provada por carimbo', () => {
  const carimbo = (chave: string, horasAtras: number) =>
    h.banco.main.system_state!.push({ key: `inv_agente_env:${chave}:${HOJE.getTime() - horasAtras * HORA}:1`, value: { em: atras(horasAtras) }, updated_at: atras(horasAtras) });

  it('a sessão reescrita depois da última fala NÃO trava a retomada quando há carimbo da fala', async () => {
    convite(ANA, TEL_ANA, { atualizado_em: atras(1), convidou_em: atras(60) }, 30);
    expect((await enviarConvite()).motivo).toBe('outra_fala_depois');   // sem carimbo, só a reserva vale, e ela não casa
    carimbo(ANA, 30);
    expect((await enviarConvite(depois(15))).enviados).toBe(1);
  });

  it('com carimbo, a última mensagem de outro robô (sem carimbo) segura a retomada', async () => {
    convite(ANA, TEL_ANA, {}, 30);
    carimbo(ANA, 30);
    msg(TEL_ANA, 'dela', 26, 'outro robô');
    expect((await enviarConvite()).motivo).toBe('outra_fala_depois');
    expect(h.zap.frio).toHaveLength(0);
  });

  it('o horário do inv_agente_sent (toque) e do frio (resposta atrasada) também provam a fala', async () => {
    convite(ANA, TEL_ANA, { atualizado_em: atras(1), convidou_em: atras(60) }, 30);
    h.banco.main.system_state!.push({ key: `inv_agente_frio:${ANA}:${HOJE.getTime() - 30 * HORA}`, value: {}, updated_at: atras(30) });
    expect((await enviarConvite()).enviados).toBe(1);
  });

  it('reação e aviso do sistema depois da fala dela não seguram a retomada', async () => {
    convite(ANA, TEL_ANA, {}, 30);
    msg(TEL_ANA, 'cliente', 27, 'curtiu', 'reacao');
    msg(TEL_ANA, 'equipe', 26, 'aviso do sistema', 'notificacao');
    const r = await enviarConvite();
    expect(r.enviados).toBe(1);
    expect(sessaoDe(ANA).estagio).toBe('ofertou');                 // e a equipe não "assumiu" por causa do aviso
  });
});

describe('revisão: a passagem por silêncio conta da última fala dela, com envio real', () => {
  function retomada(horas: number, over: Partial<SessaoInvestidor> = {}, comC1 = true, horasDasMensagens = horas) {
    convite(ANA, TEL_ANA, {
      estagio: 'ofertou', oferta: ['2026-11-16T12:00:00.000Z', '2026-11-16T17:30:00.000Z'], ofertas_feitas: 1,
      convite_retomado_em: atras(horas), atualizado_em: atras(horas), ...over,
    }, horasDasMensagens);
    if (comC1) h.banco.main.system_state!.push({ key: `inv_agente_sent:${ANA}:c1`, value: { convite: true }, updated_at: atras(horas) });
  }
  const falaCarimbada = (horasAtras: number) => {
    msg(TEL_ANA, 'dela', horasAtras, 'resposta da Helena');
    h.banco.main.system_state!.push({ key: `inv_agente_env:${ANA}:${HOJE.getTime() - horasAtras * HORA}:1`, value: {}, updated_at: atras(horasAtras) });
  };

  it('o cliente respondeu à retomada e a Helena respondeu de volta há 50 h: passa (48 h da fala dela)', async () => {
    retomada(80);
    msg(TEL_ANA, 'cliente', 70, 'oi');
    falaCarimbada(50);
    expect(await silenciar()).toMatchObject({ passadas: 1 });
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'silencio_depois_do_convite' });
  });

  it('a retomada tem 80 h, mas a última fala dela tem 40 h: ainda não passa', async () => {
    retomada(80);
    msg(TEL_ANA, 'cliente', 70, 'oi');
    falaCarimbada(40);
    expect(await silenciar()).toMatchObject({ passadas: 0 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('sem o carimbo c1 (retomada nunca reivindicada), não passa', async () => {
    retomada(60, {}, false);
    expect(await silenciar()).toMatchObject({ passadas: 0 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
  });

  it('queda entre gravar `ofertou` e enviar: a última fala é de ANTES da retomada, e não vira "sem resposta" falso', async () => {
    retomada(60, {}, true, 90);       // c1 e sessão de 60 h, mas a última mensagem da conversa é de 90 h
    expect(await silenciar()).toMatchObject({ passadas: 0 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
    expect(estado(`${PREFIXO_AVISO_SILENCIO}${ANA}`)).toBeUndefined();
  });
});

describe('revisão: o aviso nasce ANTES do estado (falha fechada) e o pendente velho deixa rastro', () => {
  it('silêncio: sem conseguir reservar a trava, a sessão não muda', async () => {
    convite(ANA, TEL_ANA, { estagio: 'ofertou', oferta: ['2026-11-16T12:00:00.000Z'], ofertas_feitas: 1, convite_retomado_em: atras(60), atualizado_em: atras(60) }, 60);
    h.banco.main.system_state!.push({ key: `inv_agente_sent:${ANA}:c1`, value: {}, updated_at: atras(60) });
    h.falhaNoInsert.add(PREFIXO_AVISO_SILENCIO);
    expect(await silenciar()).toMatchObject({ passadas: 0, erros: 1 });
    expect(sessaoDe(ANA).estagio).toBe('ofertou');
    h.falhaNoInsert.clear();
    expect(await silenciar(depois(10))).toMatchObject({ passadas: 1 });
  });

  it('equipe assumiu: sem conseguir reservar a trava, a sessão não muda, ela não responde e a leva volta na rodada seguinte', async () => {
    convite(ANA, TEL_ANA, { aberto_em: atras(2), atualizado_em: atras(1) }, 1, false);
    msg(TEL_ANA, 'dela', 1.5, 'Oi, sou a Helena');
    h.banco.main.wa_mensagens!.push({ id: ++seq, telefone: TEL_ANA, texto: 'Oi, aqui é o Diego', tipo: 'texto', from_me: true, from_api: false, is_group: false, instancia: 'LINHA_TESTE', momment: new Date(HOJE.getTime() - 30 * 60_000).toISOString() });
    h.banco.main.wa_mensagens!.push({ id: ++seq, telefone: TEL_ANA, texto: 'Oi', tipo: 'texto', from_me: false, from_api: null, is_group: false, instancia: 'LINHA_TESTE', momment: new Date(HOJE.getTime() - 2 * 60_000).toISOString() });
    h.falhaNoInsert.add(PREFIXO_AVISO_ASSUMIU);
    vi.setSystemTime(HOJE);
    expect(await runInvestidorRespostasTick()).toMatchObject({ respondidas: 0, erros: 1 });
    expect(sessaoDe(ANA).estagio).toBe('conversando');
    expect(h.ia.chamadas).toBe(0);
    h.falhaNoInsert.clear();
    await runInvestidorRespostasTick();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)!.value).toMatchObject({ estado: 'pendente' });
  });

  it('pendente com mais de 48 h é descartado, com uma linha [helena-aviso] no log e sem telefone', async () => {
    h.banco.main.system_state!.push({ key: `${PREFIXO_AVISO_ASSUMIU}${ANA}`, updated_at: atras(50), value: { estado: 'pendente', chave: ANA, consultor: 'Diego', texto: `aviso sobre ${TEL_ANA}` } });
    iniciarRodadaDeAvisos();
    expect(await rodarAvisosDaHelenaEquipe(HOJE, () => 0)).toMatchObject({ nada: true });
    expect(h.zap.equipe).toHaveLength(0);
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)!.value).toMatchObject({ estado: 'descartado', motivo: 'velho' });
    const linhas = vi.mocked(logger.warn).mock.calls.map(c => c.map(String).join(' ')).filter(l => l.includes('[helena-aviso]'));
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.join(' ')).not.toContain(TEL_ANA);
    expect(linhas.join(' ')).not.toMatch(/\d{10}/);
  });
});

describe('revisão: a equipe não passa na frente do pedido de parar nem do card por outra porta; e chega pelo LID', () => {
  const responder = () => { vi.setSystemTime(HOJE); return runInvestidorRespostasTick(); };
  const naLinha = (tel: string, from_me: boolean, from_api: boolean | null, texto: string, minAtras: number, tipo = 'texto') =>
    h.banco.main.wa_mensagens!.push({ id: ++seq, telefone: tel, texto, tipo, from_me, from_api, is_group: false, instancia: 'LINHA_TESTE', momment: new Date(HOJE.getTime() - minAtras * 60_000).toISOString() });
  const ativa = () => { convite(ANA, TEL_ANA, { aberto_em: atras(2), atualizado_em: atras(1) }, 1, false); msg(TEL_ANA, 'dela', 1.5, 'Oi, sou a Helena'); };
  const ia1 = () => { h.ia.resposta = JSON.stringify({ bolhas: ['Certo.'], acao: 'continuar', opcao: 0, dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: '' }); };

  it('pedido de parar com a equipe na conversa: vale o pedido de parar (sem_interesse), não equipe_assumiu', async () => {
    ativa();
    naLinha(TEL_ANA, true, false, 'Oi, aqui é o Diego', 30);
    naLinha(TEL_ANA, false, null, 'Pare de me mandar mensagem', 2);
    ia1();
    await responder();
    expect(sessaoDe(ANA).motivo).toBe('pediu_parar');
    expect(sessaoDe(ANA).estagio).toBe('sem_interesse');
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeUndefined();
    // O opt-out e o carimbo de parada gravam, mas a confirmação da Helena NÃO sai: gente já assumiu a conversa.
    expect(h.opt.map(o => o.tel)).toEqual([TEL_ANA]);
    expect(chaves('inv_agente_parar:')).toHaveLength(1);
    expect(h.zap.humano).toHaveLength(0);
    expect(h.zap.frio).toHaveLength(0);
    expect(h.ia.chamadas).toBe(0);
  });

  it('sem a equipe na conversa, o pedido de parar continua mandando a confirmação (nada mudou para o resto)', async () => {
    ativa();
    naLinha(TEL_ANA, false, null, 'Pare de me mandar mensagem', 2);
    ia1();
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'pediu_parar' });
    expect(h.zap.humano).toHaveLength(1);
  });

  it('opt-out por outra trilha com a equipe na conversa: vale o opt-out', async () => {
    ativa();
    h.filtros.silenciados.add(TEL_ANA);
    naLinha(TEL_ANA, true, false, 'Oi, aqui é o Diego', 30);
    naLinha(TEL_ANA, false, null, 'Oi', 2);
    ia1();
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'sem_interesse', motivo: 'opt_out_por_outra_trilha' });
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeUndefined();
  });

  it('card por outra porta com a equipe na conversa: vale o `agendado`, sem aviso de equipe', async () => {
    ativa();
    h.banco.ger.agendamentos!.push({ id: 700, cliente_telefone: TEL_ANA, cliente_nome: 'Ana Lima', status: 'agendado', quando: '2026-11-20T15:00:00Z', created_by: 'manual', vendedor_nome: 'Diego' });
    naLinha(TEL_ANA, true, false, 'Oi, aqui é o Diego', 30);
    naLinha(TEL_ANA, false, null, 'Oi', 2);
    ia1();
    await responder();
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'agendado', motivo: 'card_por_outra_porta' });
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeUndefined();
  });

  it('a equipe escrevendo pelo LID do contato (mapa wa_lid_telefone) tira a Helena da conversa', async () => {
    ativa();
    h.banco.main.wa_lid_telefone = [{ lid: '253068247589084', telefone: TEL_ANA, chave: ANA }];
    naLinha('253068247589084', true, false, 'Oi, aqui é o Diego', 30);
    naLinha(TEL_ANA, false, null, 'Oi, pode falar', 2);
    ia1();
    expect(await responder()).toMatchObject({ respondidas: 0 });
    expect(h.ia.chamadas).toBe(0);
    expect(sessaoDe(ANA)).toMatchObject({ estagio: 'humano', motivo: 'equipe_assumiu' });
    expect(estado(`${PREFIXO_AVISO_ASSUMIU}${ANA}`)).toBeTruthy();
  });

  it('o LID de OUTRA pessoa (sem mapa para esta chave) não tira a Helena da conversa', async () => {
    ativa();
    h.banco.main.wa_lid_telefone = [{ lid: '253068247589084', telefone: '5534999990099', chave: '3499990099' }];
    naLinha('253068247589084', true, false, 'Oi, aqui é o Diego', 30);
    naLinha(TEL_ANA, false, null, 'Oi, pode falar', 2);
    ia1();
    expect(await responder()).toMatchObject({ respondidas: 1 });
    expect(sessaoDe(ANA).estagio).not.toBe('humano');
  });

  it('aviso do sistema (notificacao) escrito por gente não tira a Helena da conversa', async () => {
    ativa();
    naLinha(TEL_ANA, true, false, 'Fulano entrou no grupo', 30, 'notificacao');
    naLinha(TEL_ANA, false, null, 'Oi, pode falar', 2);
    ia1();
    expect(await responder()).toMatchObject({ respondidas: 1 });
    expect(sessaoDe(ANA).estagio).not.toBe('humano');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('as condições do chefe, no código', () => {
  const lerFonte = (arq: string): string => fs.readFileSync(path.join(__dirname, '..', 'services', 'io', arq), 'utf8');

  it('os avisos novos nunca passam por passarParaHumano nem avisarEquipe, e só enviam pelo enviarComConferencias', () => {
    const semComentarios = (t: string): string => t.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(' ');
    const fonte = semComentarios(lerFonte('investidorAgenteAvisosEquipe.ts'));
    expect(fonte).not.toMatch(/passarParaHumano|avisarEquipe|enviarEmSequencia|sendFrio|sendHuman|sendWhatsApp/);
    expect(fonte).toMatch(/enviarComConferencias/);
    const geral = lerFonte('investidorAgente.ts');
    // O trecho novo de investidorAgente.ts também não avisa por aqui.
    const trecho = semComentarios(geral.slice(geral.indexOf('A RETOMADA DO CONVITE, A PASSAGEM POR SILÊNCIO'), geral.indexOf('A RODADA: o que a rota do cron chama')));
    expect(trecho.length).toBeGreaterThan(1000);
    expect(trecho).not.toMatch(/passarParaHumano\(|avisarEquipe\(|enviarEmSequencia\(|sendWhatsApp\(/);
  });

  it('as travas e os carimbos têm os nomes do plano, e o carimbo não é o ficha_lead:helena:<card>', () => {
    expect(PREFIXO_AVISO_SILENCIO).toBe('inv_agente_aviso_silencio:');
    expect(PREFIXO_AVISO_ASSUMIU).toBe('inv_agente_aviso_assumiu:');
    expect(CARIMBO_SILENCIO).toBe('ficha_lead:helena:silencio:');
    expect(CARIMBO_ASSUMIU).toBe('ficha_lead:helena:assumiu:');
  });
});
