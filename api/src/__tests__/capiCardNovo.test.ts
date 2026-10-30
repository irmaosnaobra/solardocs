import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Schedule do SERVIDOR para o card do quiz que a página não contou (SAIU SEM MARCAR e card da Duda), 29/10/2026.
// A decisão é pura (capiCardNovoPuro) e o tick (capiCardNovo) lê e grava em bancos simulados. O Meta é simulado.
// Todo telefone, IP e cookie aqui é inventado.

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  gerador: {} as Record<string, Array<Record<string, any>>>,
  principal: {} as Record<string, any>,
  gravados: [] as Array<{ tabela: string; op: string; row: any }>,
  erros: {} as Record<string, string>,
  logs: [] as string[],
  /** tabela -> a leitura nunca responde. */
  travar: {} as Record<string, boolean>,
}));

vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.enviar }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** Banco simulado: filtros eq/in/gte/lte sobre as linhas de h.gerador[tabela]; insert/upsert vão para h.gravados. */
vi.mock('../utils/supabaseGerador', () => {
  const comp = (a: any, b: any) => (typeof a === 'string' && typeof b === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : Number(a) - Number(b));
  const cadeia = (tabela: string) => {
    const filtros: Array<(r: any) => boolean> = [];
    let lim = Infinity;
    const c: any = {
      select: () => c,
      eq: (col: string, v: unknown) => { filtros.push(r => r[col] === v); return c; },
      in: (col: string, vs: unknown[]) => { filtros.push(r => vs.includes(r[col])); return c; },
      gte: (col: string, v: unknown) => { filtros.push(r => r[col] != null && comp(r[col], v) >= 0); return c; },
      lte: (col: string, v: unknown) => { filtros.push(r => r[col] != null && comp(r[col], v) <= 0); return c; },
      order: () => c,
      limit: (n: number) => { lim = n; return c; },
      insert: (row: any) => { h.gravados.push({ tabela, op: 'insert', row }); return Promise.resolve({ error: h.erros[`insert:${tabela}`] ? { message: h.erros[`insert:${tabela}`] } : null }); },
      upsert: (row: any) => { h.gravados.push({ tabela, op: 'upsert', row }); return Promise.resolve({ error: null }); },
      then: (ok: (v: unknown) => void) => {
        if (h.travar[tabela]) return undefined;   // nunca resolve
        const e = h.erros[`select:${tabela}`];
        if (e) return ok({ data: null, error: { message: e } });
        return ok({ data: (h.gerador[tabela] ?? []).filter(r => filtros.every(f => f(r))).slice(0, lim), error: null });
      },
    };
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: () => Promise.resolve(
        h.erros['select:system_state'] ? { data: null, error: { message: h.erros['select:system_state'] } }
          : { data: h.principal[k] ? { value: h.principal[k] } : null, error: null }) }) }),
      upsert: (row: any) => { h.gravados.push({ tabela: 'system_state', op: 'upsert', row }); h.principal[row.key] = row.value; return Promise.resolve({ error: null }); },
    }),
  },
}));

import { sha256, userData, normFone } from '../utils/metaCapi';
import {
  escolherCardsNovos, montarEventoCardNovo, origemDoEvento, variantesDoFone, leadIdDoQuiz, janelaDosCards, recusaDefinitiva,
  core8DeCardsDaPagina, ORCAMENTO_MS, MIN_RESTANTE_MS, TETO_LEITURA_MS, TETO_ENVIOS, type CardCand, type LeadQuiz,
} from '../services/meta/capiCardNovoPuro';
import { runCapiCardNovo, CHAVE_DESDE } from '../services/meta/capiCardNovo';
import { CAMPO_CAPI, campoCapiDe, lerCapi, semCamposInternos, fbcAindaVale, ehCampoInterno } from '../services/meta/capiNavegador';
import { linhaDaPagina, registrarSchedulePagina } from '../services/meta/capiPagina';
import { MARCA_SAIU, MARCA_ORIGEM_DUDA, ehCardDaDuda, ehCardSaiu, semMarcaSaiu } from '../services/agenda/solarRota';
import { observacaoDoCardDaDuda } from '../services/agentes5040/acoesVivo';
import { respostasDoLead } from '../services/io/solarAgenteQuiz';
import { resumoDoLead } from '../services/io/solarBoasVindas';
import { hidratarLead, observacaoDoCardSaiu, camposDeRecuperacao } from '../services/io/solarQuizAviso';
import { avisoSaiuSemMarcar } from '../services/io/solarQuizTextos';
import { limparRespostas, limparRespostasExtra } from '../services/io/solarQuiz';

const NOW = Date.parse('2026-10-29T15:00:00Z');
const H = 3_600_000, D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const CORTE = NOW - 5 * H;                    // a marca capi_card_novo_desde
const TEL = '5534991112222';                  // lead (como a página mandou)
const TEL_SEM9 = '553491112222';              // a variante sem o 9
const FBC_NOVO = `fb.1.${NOW - 2 * D}.AbCdEf123`;
const FBC_VELHO = `fb.1.${NOW - 9 * D}.AbCdEf123`;
const FBP = 'fb.1.1760000000000.1234567890';
const IP_FALSO = '203.0.113.9';               // faixa de documentação, nunca um IP real
const UA_FALSO = 'UA-Falso/1.0 (teste)';

const OBS_SAIU = `${MARCA_SAIU} · Casa · LIGAÇÃO\nConsumo: ~800 kWh/mês`;
const OBS_DUDA = observacaoDoCardDaDuda(800);
const OBS_PAGINA = 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConsumo: ~800 kWh/mês';

let seq = 100;
const card = (o: Partial<CardCand> = {}): CardCand => ({
  id: ++seq, cliente_nome: 'Ana Souza', cliente_telefone: TEL, cidade: 'Uberlândia-MG', status: 'agendado', created_by: 'lp_solar',
  created_at: iso(NOW - 2 * H), observacao: OBS_SAIU, ...o,
});
const capiCampo = (o: Record<string, unknown> = {}) => ({
  name: CAMPO_CAPI,
  values: [JSON.stringify({ fbc: FBC_NOVO, fbp: FBP, client_user_agent: UA_FALSO, client_ip_address: IP_FALSO, event_source_url: 'https://solardoc.app/io/solar', ts: iso(NOW - 3 * H), ...o })],
});
const lead = (o: Partial<LeadQuiz> = {}): LeadQuiz => ({
  lead_id: 'quiz_3491112222', form_id: 'quiz_solar', nome: 'Ana Souza', whatsapp: TEL, cidade: 'Uberlândia-MG',
  created_time: iso(NOW - 2 * H - 10 * 60_000), agendado_id: null, field_data: [capiCampo()], ...o,
});
const escolher = (cards: CardCand[], leads: LeadQuiz[] = [lead()], o: Record<string, unknown> = {}) => escolherCardsNovos({
  agoraMs: NOW, corteMs: CORTE, cards, leads, cardsComSchedule: new Set<number>(), fonesComSchedule: new Set<string>(), ...o,
});

// ── A decisão pura ───────────────────────────────────────────────────────────

describe('quem recebe o Schedule do servidor', () => {
  it('o card SAIU e o da Duda, com lead do quiz e fora de qualquer dedup, entram', () => {
    const a = card(), b = card({ observacao: OBS_DUDA, cliente_telefone: '5534988887777' });
    const r = escolher([a, b], [lead(), lead({ lead_id: 'quiz_3488887777', whatsapp: '5534988887777' })]);
    expect(r.enviar.map(e => [e.card.id, e.classe])).toEqual([[a.id, 'saiu'], [b.id, 'duda']]);
  });

  it('origem: só lp_solar. Eletroposto, manychat, gente do /gerador e teste ficam de fora', () => {
    const cards = ['lp_eletroposto', 'manychat', 'lead-meta', 'Nilce', 'lp_solar_teste', '', null].map(o => card({ created_by: o as any }));
    const r = escolher(cards);
    expect(r.enviar).toHaveLength(0);
    expect(r.ignorados.origem).toBe(7);
  });

  it('janela: 60 minutos de espera, no máximo 6 dias, e nunca antes da marca de corte', () => {
    const cedo = card({ created_at: iso(NOW - 59 * 60_000) });
    const noLimite = card({ created_at: iso(NOW - 60 * 60_000) });
    const velho = card({ created_at: iso(NOW - 6 * D - 60_000) });
    const antesDaMarca = card({ created_at: iso(CORTE - 60_000) });
    const r = escolher([cedo, noLimite, velho, antesDaMarca]);
    expect(r.enviar.map(e => e.card.id)).toEqual([noLimite.id]);
    expect(r.ignorados).toMatchObject({ espera_de_60min: 1, antes_da_janela: 2 });
  });

  it('com a marca bem antiga o piso é agora - 6 dias (o Meta recusa evento de mais de 7)', () => {
    const j = janelaDosCards(NOW, NOW - 30 * D);
    expect(j.deMs).toBe(NOW - 6 * D);
    expect(j.ateMs).toBe(NOW - 60 * 60_000);
    const antigo = card({ created_at: iso(NOW - 6 * D - H) });
    expect(escolher([antigo], [lead({ created_time: iso(NOW - 6 * D - 2 * H) })], { corteMs: NOW - 30 * D }).enviar).toHaveLength(0);
  });

  it('cancelado, nome de teste e card da página sem marca (sem SAIU nem Duda) não entram', () => {
    const r = escolher([card({ status: 'cancelado' }), card({ status: ' Cancelado ' }), card({ cliente_nome: 'Teste Interno' }), card({ observacao: OBS_PAGINA })]);
    expect(r.enviar).toHaveLength(0);
    expect(r.ignorados).toMatchObject({ cancelado: 2, teste: 1, sem_marca_saiu_nem_duda: 1 });
  });

  it('dedup por card: quem já tem o Schedule (página ou rodada anterior) não sai', () => {
    const c = card();
    const r = escolher([c], [lead()], { cardsComSchedule: new Set([c.id]) });
    expect(r.enviar).toHaveLength(0);
    expect(r.ignorados.card_ja_tem_schedule).toBe(1);
  });

  it('dedup por telefone em 30 dias: um Schedule de OUTRO card, de qualquer origem, calam este', () => {
    const r = escolher([card()], [lead()], { fonesComSchedule: new Set(['91112222']) });
    expect(r.enviar).toHaveLength(0);
    expect(r.ignorados.fone_ja_teve_schedule_em_30d).toBe(1);
  });

  it('dois cards da mesma pessoa na MESMA rodada: só o mais antigo sai', () => {
    const velho = card({ created_at: iso(NOW - 5 * H) }), novo = card({ created_at: iso(NOW - 2 * H) });
    const r = escolher([novo, velho], [lead({ created_time: iso(NOW - 6 * H) })]);
    expect(r.enviar.map(e => e.card.id)).toEqual([velho.id]);
  });

  it('o lead do quiz casa pela forma COM ou SEM o 9 (a chave é DDD + 8 dígitos)', () => {
    expect(leadIdDoQuiz(TEL)).toBe('quiz_3491112222');
    expect(leadIdDoQuiz(TEL_SEM9)).toBe('quiz_3491112222');
    const sem9 = card({ cliente_telefone: TEL_SEM9 });
    const r = escolher([sem9]);
    expect(r.enviar).toHaveLength(1);
    // o external_id é o do telefone que a página mandou (com o 9), não o do card
    expect(r.enviar[0].foneLead).toBe(TEL);
  });

  it('lead de outra pessoa ou de outro formulário não casa', () => {
    const c = card();
    expect(escolher([c], [lead({ lead_id: 'quiz_3499999999' })]).ignorados.sem_lead_do_quiz).toBe(1);
    expect(escolher([c], [lead({ form_id: 'quiz_solar_teste' })]).ignorados.sem_lead_do_quiz).toBe(1);
  });

  it('o lead do MESMO telefone casa sem janela de data (rascunho de semanas atrás, a pessoa voltou): o fbc velho cai em capiNavegador', () => {
    const c = card();
    for (const dias of [8, 20, 60]) {
      const r = escolher([c], [lead({ created_time: iso(NOW - dias * D), field_data: [capiCampo({ fbc: FBC_VELHO })] })]);
      expect(r.enviar, `${dias} dias`).toHaveLength(1);
      expect(montarEventoCardNovo(r.enviar[0], NOW).navegador!.fbc).toBeNull();   // a frescura não é da seleção
    }
    // lead criado depois do card também é a mesma pessoa
    expect(escolher([c], [lead({ created_time: iso(NOW - H) })]).enviar).toHaveLength(1);
  });

  it('o vínculo direto (leads_meta.agendado_id = id do card) vale mesmo com o rascunho antigo', () => {
    const c = card();
    const r = escolher([c], [lead({ created_time: iso(NOW - 20 * D), agendado_id: c.id })]);
    expect(r.enviar).toHaveLength(1);
  });

  it('teto de 10 por rodada: o resto fica para a seguinte, do mais antigo para o mais novo', () => {
    const cards: CardCand[] = []; const leads: LeadQuiz[] = [];
    for (let i = 0; i < 14; i++) {
      const tel = `55349911${String(10000 + i).slice(-5)}`;   // 14 pessoas diferentes
      cards.push(card({ cliente_telefone: tel, created_at: iso(NOW - 5 * H + i * 60_000) }));
      leads.push(lead({ lead_id: leadIdDoQuiz(tel)!, whatsapp: tel, created_time: iso(NOW - 6 * H) }));
    }
    const r = escolher(cards, leads);
    expect(TETO_ENVIOS).toBe(10);
    expect(r.enviar).toHaveLength(10);
    expect(r.enviar.map(e => e.card.id)).toEqual(cards.slice(0, 10).map(c => c.id));
    expect(r.ignorados.teto_da_rodada).toBe(4);
  });
});

describe('quem a página já contou antes do deploy', () => {
  it('core8DeCardsDaPagina: só lp_solar sem marca SAIU nem Duda e sem nome de teste', () => {
    const r = core8DeCardsDaPagina([
      card({ observacao: OBS_PAGINA, cliente_telefone: '5534988880001' }),
      card({ observacao: OBS_SAIU, cliente_telefone: '5534988880002' }),
      card({ observacao: OBS_DUDA, cliente_telefone: '5534988880003' }),
      card({ observacao: OBS_PAGINA, cliente_telefone: '5534988880004', cliente_nome: 'Teste Interno' }),
      card({ observacao: OBS_PAGINA, cliente_telefone: '5534988880005', created_by: 'manychat' }),
      card({ observacao: OBS_PAGINA, cliente_telefone: '123' }),
    ]);
    expect([...r]).toEqual(['88880001']);
  });

  it('escolherCardsNovos cala a pessoa que a página já contou, também pela forma sem o 9', () => {
    const c = card({ cliente_telefone: TEL_SEM9 });
    const r = escolher([c], [lead()], { fonesDePaginaAntiga: new Set(['91112222']) });
    expect(r.enviar).toHaveLength(0);
    expect(r.ignorados.pagina_ja_contou_antes_do_deploy).toBe(1);
  });
});

describe('o evento montado', () => {
  const envio = (c: CardCand, l: LeadQuiz = lead()) => escolher([c], [l]).enviar[0];

  it('SAIU com _capi e navegador: website, com url, fbc, fbp, IP e navegador; id e hora do card', () => {
    const c = card();
    const ev = montarEventoCardNovo(envio(c), NOW);
    expect(ev).toMatchObject({
      produto: 'solar', nome: 'Schedule', origem: 'website', eventId: `card_ag_${c.id}`,
      eventTime: Math.floor(Date.parse(c.created_at!) / 1000), urlDaPagina: 'https://solardoc.app/io/solar',
      navegador: { fbc: FBC_NOVO, fbp: FBP, ip: IP_FALSO, userAgent: UA_FALSO },
    });
  });

  it('SAIU SEM _capi: system_generated, sem url e sem navegador', () => {
    const ev = montarEventoCardNovo(envio(card(), lead({ field_data: [] })), NOW);
    expect(ev.origem).toBe('system_generated');
    expect(ev.urlDaPagina).toBeUndefined();
    expect(ev.navegador).toEqual({});
  });

  it('SAIU com _capi mas sem user agent: system_generated (website exige o navegador)', () => {
    const l = lead({ field_data: [capiCampo({ client_user_agent: undefined })] });
    expect(montarEventoCardNovo(envio(card(), l), NOW).origem).toBe('system_generated');
  });

  it('card da Duda: SEMPRE chat, e com _capi ainda leva fbc, fbp, IP e navegador para casar a pessoa', () => {
    const ev = montarEventoCardNovo(envio(card({ observacao: OBS_DUDA })), NOW);
    expect(ev.origem).toBe('chat');
    expect(ev.urlDaPagina).toBeUndefined();
    expect(ev.navegador).toMatchObject({ fbc: FBC_NOVO, fbp: FBP, ip: IP_FALSO, userAgent: UA_FALSO });
    expect(montarEventoCardNovo(envio(card({ observacao: OBS_DUDA }), lead({ field_data: [] })), NOW).origem).toBe('chat');
    expect(origemDoEvento('duda', null)).toBe('chat');
  });

  it('fbc com 7 dias ou mais fica de fora; o fbp continua', () => {
    const l = lead({ field_data: [capiCampo({ fbc: FBC_VELHO })] });
    const ev = montarEventoCardNovo(envio(card(), l), NOW);
    expect(ev.navegador!.fbc).toBeNull();
    expect(ev.navegador!.fbp).toBe(FBP);
    expect(fbcAindaVale(FBC_NOVO, NOW)).toBe(FBC_NOVO);
    expect(fbcAindaVale(FBC_VELHO, NOW)).toBeUndefined();
    expect(fbcAindaVale(`fb.1.${NOW - 7 * D}.x`, NOW)).toBeUndefined();   // exatamente 7 dias já não vale
  });

  it('ph leva as DUAS formas do telefone (com e sem o 9) do lead e do card; external_id é só o do lead', () => {
    const c = card({ cliente_telefone: TEL_SEM9 });
    const ev = montarEventoCardNovo(envio(c), NOW);
    const ud = userData(ev.pessoa, ev.navegador);
    expect(ud.ph).toEqual([sha256(TEL), sha256(TEL_SEM9)]);
    expect(ud.external_id).toEqual([sha256(TEL)]);
    expect(variantesDoFone(TEL)).toEqual([TEL, TEL_SEM9]);
    expect(variantesDoFone(TEL_SEM9)).toEqual([TEL_SEM9, TEL]);
    expect(variantesDoFone('123')).toEqual([]);
  });

  it('leva nome, sobrenome, cidade, UF e país', () => {
    const ud = userData(montarEventoCardNovo(envio(card()), NOW).pessoa);
    expect(ud.fn).toEqual([sha256('ana')]);
    expect(ud.ln).toEqual([sha256('souza')]);
    expect(ud.ct).toEqual([sha256('uberlandia')]);
    expect(ud.st).toEqual([sha256('mg')]);
    expect(ud.country).toEqual([sha256('br')]);
  });

  it('nenhum campo do evento leva o telefone em texto puro', () => {
    const ev = montarEventoCardNovo(envio(card()), NOW);
    expect(String(ev.eventId)).not.toMatch(/\d{8}/);
  });
});

describe('recusa definitiva', () => {
  it('2804036 e "sem identificador" são definitivas; o resto volta na rodada seguinte', () => {
    expect(recusaDefinitiva({ ok: false, status: 400, erro: '{"error":{"error_subcode":2804036}}' })).toBe(true);
    expect(recusaDefinitiva({ ok: false, status: 0, erro: 'sem_identificador' })).toBe(true);
    expect(recusaDefinitiva({ ok: false, status: 400, erro: 'Invalid parameter' })).toBe(false);
    expect(recusaDefinitiva({ ok: false, status: 0, erro: 'timeout' })).toBe(false);
    expect(recusaDefinitiva({ ok: true, status: 200 })).toBe(false);
  });
});

// ── O tick ───────────────────────────────────────────────────────────────────

const env0 = { ...process.env };
const enviadosAoMeta = () => h.enviar.mock.calls.map(c => c[0]);
const dedupGravado = () => h.gravados.filter(g => g.tabela === 'capi_conversoes_enviadas').map(g => g.row);

function cenario(cards: CardCand[], leads: LeadQuiz[] = [lead()], dedup: Array<Record<string, any>> = []) {
  h.principal[CHAVE_DESDE] = { desde: iso(CORTE) };
  h.gerador.agendamentos = cards as any;
  h.gerador.leads_meta = leads as any;
  h.gerador.capi_conversoes_enviadas = dedup;
}

beforeEach(() => {
  h.enviar.mockReset().mockResolvedValue({ ok: true, status: 200, recebidos: 1 });
  h.gerador = {}; h.principal = {}; h.gravados.length = 0; h.erros = {}; h.travar = {};
  delete process.env.CAPI_CARD_OFF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...env0 }; });

describe('tick capi_card_novo', () => {
  it('primeira rodada: só grava a marca no system_state e não envia nem lê card', async () => {
    h.gerador.agendamentos = [card()] as any;
    const r = await runCapiCardNovo();
    expect(r.primeiraRodada).toBe(true);
    expect(h.enviar).not.toHaveBeenCalled();
    const marca = h.gravados.find(g => g.tabela === 'system_state');
    expect(marca!.row).toMatchObject({ key: CHAVE_DESDE, value: { desde: iso(NOW) } });
    expect(dedupGravado()).toHaveLength(0);
  });

  it('dry na primeira rodada não grava nem a marca', async () => {
    await runCapiCardNovo({ dry: true });
    expect(h.gravados).toHaveLength(0);
  });

  it('card SAIU com _capi: manda 1 Schedule website e grava o dedup (origem card_novo) só depois do aceite', async () => {
    const c = card();
    cenario([c]);
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(1);
    expect(enviadosAoMeta()).toHaveLength(1);
    expect(enviadosAoMeta()[0]).toMatchObject({ produto: 'solar', nome: 'Schedule', origem: 'website', eventId: `card_ag_${c.id}` });
    expect(dedupGravado()).toEqual([expect.objectContaining({
      lead_id: `ag_${c.id}`, telefone_core8: '91112222', origem: 'card_novo', event_name: 'Schedule', meta_status: 200, meta_received: 1,
    })]);
  });

  it('recusa comum: não grava dedup e o card volta na rodada seguinte', async () => {
    cenario([card()]);
    h.enviar.mockResolvedValue({ ok: false, status: 400, erro: 'Invalid parameter' });
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(0);
    expect(r.erros).toHaveLength(1);
    expect(dedupGravado()).toHaveLength(0);
  });

  it('recusa definitiva (2804036): grava a marca para não tentar para sempre', async () => {
    const c = card();
    cenario([c]);
    h.enviar.mockResolvedValue({ ok: false, status: 400, erro: '{"error":{"error_subcode":2804036}}' });
    const r = await runCapiCardNovo();
    expect(r.recusadosDefinitivos).toBe(1);
    expect(dedupGravado()).toEqual([expect.objectContaining({ lead_id: `ag_${c.id}`, origem: 'card_novo', meta_status: 400 })]);
    expect(String(dedupGravado()[0].meta_error)).toContain('2804036');
  });

  it('card que a página contou (linha pagina) não sai; nem outro card da mesma pessoa em 30 dias', async () => {
    const a = card(), b = card({ id: a.id + 1000 });
    // A coluna de data da tabela é `enviado_em` (created_at não existe nela): as linhas do teste usam o nome real.
    cenario([a], [lead()], [{ lead_id: `ag_${a.id}`, event_name: 'Schedule', telefone_core8: '91112222', enviado_em: iso(NOW - H) }]);
    expect((await runCapiCardNovo()).enviados).toBe(0);
    for (const dias of [10, 29]) {
      cenario([b], [lead()], [{ lead_id: 'ag_1', event_name: 'Schedule', telefone_core8: '91112222', enviado_em: iso(NOW - dias * D) }]);
      const r = await runCapiCardNovo();
      expect(r.enviados, `${dias} dias dentro da janela: cala`).toBe(0);
      expect(h.enviar).not.toHaveBeenCalled();
    }
    // 31 dias atrás já não conta
    cenario([b], [lead()], [{ lead_id: 'ag_1', event_name: 'Schedule', telefone_core8: '91112222', enviado_em: iso(NOW - 31 * D) }]);
    expect((await runCapiCardNovo()).enviados).toBe(1);
  });

  it('linha só com created_at (a coluna que NÃO existe) não prova nada: o filtro é por enviado_em', async () => {
    // Guarda do erro do teste antigo: se o código voltasse a filtrar por created_at, este cenário calaria o card.
    cenario([card()], [lead()], [{ lead_id: 'ag_1', event_name: 'Schedule', telefone_core8: '91112222', created_at: iso(NOW - D) }]);
    expect((await runCapiCardNovo()).enviados).toBe(1);
  });

  it('um Schedule (qualquer evento que não seja Schedule não conta) de outro nome de evento não cala o card', async () => {
    cenario([card()], [lead()], [{ lead_id: 'ag_1', event_name: 'ClienteQuente', telefone_core8: '91112222', enviado_em: iso(NOW - H) }]);
    expect((await runCapiCardNovo()).enviados).toBe(1);
  });

  it('leitura do dedup que falha ABORTA a rodada: nada é enviado', async () => {
    cenario([card()]);
    h.erros['select:capi_conversoes_enviadas'] = 'column enviado_em does not exist';
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(0);
    expect(r.erros[0].erro).toContain('ler dedup');
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('leitura dos cards ou dos leads que falha também aborta', async () => {
    cenario([card()]);
    h.erros['select:agendamentos'] = 'queda';
    expect((await runCapiCardNovo()).erros[0].erro).toContain('ler agendamentos');
    delete h.erros['select:agendamentos'];
    h.erros['select:leads_meta'] = 'queda';
    expect((await runCapiCardNovo()).erros[0].erro).toContain('ler leads_meta');
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('teto de 10 envios por rodada', async () => {
    const cards: CardCand[] = []; const leads: LeadQuiz[] = [];
    for (let i = 0; i < 13; i++) {
      const tel = `55349911${String(10000 + i).slice(-5)}`;
      cards.push(card({ cliente_telefone: tel, created_at: iso(NOW - 5 * H + i * 60_000) }));
      leads.push(lead({ lead_id: leadIdDoQuiz(tel)!, whatsapp: tel, created_time: iso(NOW - 6 * H) }));
    }
    cenario(cards, leads);
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(10);
    expect(h.enviar).toHaveBeenCalledTimes(10);
  });

  it('teto duro de 12 s: só começa envio com pelo menos 6 s de sobra', async () => {
    expect([ORCAMENTO_MS, MIN_RESTANTE_MS, TETO_LEITURA_MS]).toEqual([12_000, 6_000, 3_000]);
    const cards: CardCand[] = []; const leads: LeadQuiz[] = [];
    for (let i = 0; i < 5; i++) {
      const tel = `55349911${String(20000 + i).slice(-5)}`;
      cards.push(card({ cliente_telefone: tel, created_at: iso(NOW - 5 * H + i * 60_000) }));
      leads.push(lead({ lead_id: leadIdDoQuiz(tel)!, whatsapp: tel, created_time: iso(NOW - 6 * H) }));
    }
    cenario(cards, leads);
    // cada chamada "demora" 3 s no relógio: a 1ª, 2ª e 3ª começam (0, 3 e 6 s), a 4ª já nasce com 9 s
    h.enviar.mockImplementation(async () => { vi.setSystemTime(Date.now() + 3_000); return { ok: true, status: 200, recebidos: 1 }; });
    const r = await runCapiCardNovo();
    expect(h.enviar).toHaveBeenCalledTimes(3);
    expect(r.enviados).toBe(3);
    expect(r.pendentes).toBe(2);
  });

  it('leitura que passa de 3 s aborta a rodada e NADA é enviado', async () => {
    vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(NOW);
    cenario([card()]);
    h.travar.leads_meta = true;
    const p = runCapiCardNovo();
    await vi.advanceTimersByTimeAsync(3_100);
    const r = await p;
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
    expect(r.erros[0].erro).toContain('passou de 3000 ms');
    expect(dedupGravado()).toHaveLength(0);
  });

  it('META_TEST_EVENT_CODE ligado: o evento sai, mas NENHUM dedup é gravado (o card real não é queimado na aba de testes)', async () => {
    cenario([card()]);
    process.env.META_TEST_EVENT_CODE = 'TEST123';
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(1);
    expect(r.semDedupPorTeste).toBe(1);
    expect(dedupGravado()).toHaveLength(0);
    // com a recusa definitiva também
    h.enviar.mockResolvedValue({ ok: false, status: 400, erro: '2804036' });
    await runCapiCardNovo();
    expect(dedupGravado()).toHaveLength(0);
  });

  it('pessoa já contada pela página ANTES do deploy (card lp_solar sem marca SAIU nem Duda nos últimos 30 dias) não recebe', async () => {
    const velhoDaPagina = card({ observacao: OBS_PAGINA, created_at: iso(NOW - 10 * D) });
    cenario([card(), velhoDaPagina]);
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(0);
    expect(r.ignorados.pagina_ja_contou_antes_do_deploy).toBe(1);
    // de mais de 30 dias já não conta
    cenario([card(), card({ observacao: OBS_PAGINA, created_at: iso(NOW - 31 * D) })]);
    expect((await runCapiCardNovo()).enviados).toBe(1);
    // card da Duda ou SAIU antigo da mesma pessoa não é "página": não calam
    cenario([card(), card({ observacao: OBS_DUDA, created_at: iso(NOW - 10 * D) })]);
    expect((await runCapiCardNovo()).enviados).toBe(1);
  });

  it('CAPI_CARD_OFF=1 desliga o tick', async () => {
    cenario([card()]);
    process.env.CAPI_CARD_OFF = '1';
    const r = await runCapiCardNovo();
    expect(r.pulado).toBe('desligado');
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('dedup que não grava (banco fora): o erro aparece no relatório, o Meta já recebeu', async () => {
    cenario([card()]);
    h.erros['insert:capi_conversoes_enviadas'] = 'banco fora';
    const r = await runCapiCardNovo();
    expect(r.enviados).toBe(1);
    expect(r.erros[0].erro).toContain('dedup insert');
  });

  it('dry: mostra o que sairia (com a origem) e não chama o Meta nem grava', async () => {
    cenario([card(), card({ observacao: OBS_DUDA, cliente_telefone: '5534988887777' })], [lead(), lead({ lead_id: 'quiz_3488887777', whatsapp: '5534988887777' })]);
    const r = await runCapiCardNovo({ dry: true });
    expect(r.aEnviar!.map(x => x.origem)).toEqual(['website', 'chat']);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.gravados).toHaveLength(0);
  });

  it('o telefone nunca vai em texto puro nem no event_id nem no relatório', async () => {
    cenario([card()]);
    const r = await runCapiCardNovo();
    expect(JSON.stringify(r)).not.toContain('991112222');
    expect(String(enviadosAoMeta()[0].eventId)).not.toContain('991112222');
  });
});

// ── A constante da Duda e do SAIU ────────────────────────────────────────────

describe('marcas do card', () => {
  it('a observação do card da Duda sai idêntica ao que saía, e o reconhecimento a lê', () => {
    expect(observacaoDoCardDaDuda(800)).toBe('LP SOLAR QUIZ · LIGAÇÃO\nOrigem: conversa com a Duda no WhatsApp\nConsumo: ~800 kWh/mês');
    expect(observacaoDoCardDaDuda(null)).toBe('LP SOLAR QUIZ · LIGAÇÃO\nOrigem: conversa com a Duda no WhatsApp');
    expect(MARCA_ORIGEM_DUDA).toBe('Origem: conversa com a Duda no WhatsApp');
    expect(ehCardDaDuda(observacaoDoCardDaDuda(800))).toBe(true);
    expect(ehCardDaDuda(OBS_SAIU)).toBe(false);
    expect(ehCardDaDuda(null)).toBe(false);
    expect(ehCardSaiu(OBS_SAIU)).toBe(true);
  });

  it('semMarcaSaiu: tira a marca SAIU e ACRESCENTA a linha da Duda logo abaixo da 1ª; o resto do texto fica igual', () => {
    expect(semMarcaSaiu(OBS_SAIU)).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO\nOrigem: conversa com a Duda no WhatsApp\nConsumo: ~800 kWh/mês');
    const mudo = `${MARCA_SAIU} · MUDO · LIGAÇÃO\nOnde: Casa\nConsumo: ~800 kWh/mês`;
    expect(semMarcaSaiu(mudo)).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO\nOrigem: conversa com a Duda no WhatsApp\nOnde: Casa\nConsumo: ~800 kWh/mês');
    // não duplica, e card que não é SAIU volta como veio
    expect(semMarcaSaiu(semMarcaSaiu(OBS_SAIU))).toBe(semMarcaSaiu(OBS_SAIU));
    expect(semMarcaSaiu(OBS_PAGINA)).toBe(OBS_PAGINA);
    expect(semMarcaSaiu(OBS_DUDA)).toBe(OBS_DUDA);
  });

  it('o card SAIU que a Duda remarcou (marca trocada por semMarcaSaiu) entra como Duda, e o evento sai como chat', () => {
    const remarcado = card({ observacao: semMarcaSaiu(OBS_SAIU) });
    expect(ehCardSaiu(remarcado.observacao)).toBe(false);
    expect(ehCardDaDuda(remarcado.observacao)).toBe(true);
    const r = escolher([remarcado]);
    expect(r.enviar.map(e => e.classe)).toEqual(['duda']);
    expect(montarEventoCardNovo(r.enviar[0], NOW).origem).toBe('chat');
  });
});

// ── O _capi não vaza ─────────────────────────────────────────────────────────

describe('_capi é campo interno', () => {
  const RESP = {
    conta: '600_1050', cidade: 'Uberlândia-MG', tipo: 'casa', imovel: 'proprio', urgencia: 'ja', concorrente: 'sim', pagamento: 'vista', decisor: 'eu', grupoa: 'nao',
    telhado: 'ceramica', sombra: 'sol', aumento: 'nao', dor: 'sobe', tempo: 'meses', travou: 'caro', desejo: 'viajar', criterio: 'parcela',
  };
  const fd = () => [
    { name: 'Pontos', values: ['85'] }, { name: 'Caminho', values: ['ligacao'] }, { name: 'Consumo', values: ['~800 kWh'] },
    { name: 'utm_source', values: ['meta'] },
    ...camposDeRecuperacao(limparRespostas(RESP), limparRespostasExtra(RESP), NOW),
    capiCampo(),
  ];
  const segredos = [FBC_NOVO, FBP, IP_FALSO, UA_FALSO, 'client_ip_address', 'client_user_agent', '_capi', 'fbc'];
  const limpo = (txt: string) => { for (const s of segredos) expect(txt, s).not.toContain(s); };

  it('a ficha do card SAIU (falando e muda) e o aviso da Nilce não levam fbc, fbp, IP nem navegador', () => {
    const hid = hidratarLead({ lead_id: 'quiz_3491112222', nome: 'Ana Souza', whatsapp: TEL, cidade: 'Uberlândia-MG', field_data: fd(), created_time: iso(NOW) })!;
    expect(hid).toBeTruthy();
    limpo(observacaoDoCardSaiu(hid, false));
    limpo(observacaoDoCardSaiu(hid, true));
    limpo(avisoSaiuSemMarcar(hid.ficha, 'whatsapp', '14:20', 'codigo123'));
    limpo(JSON.stringify(hid));
  });

  it('o resumo das boas-vindas e as respostas que vão ao prompt da Duda não levam o _capi', () => {
    limpo(resumoDoLead(fd() as any, 'Uberlândia-MG'));
    const respostas = respostasDoLead(fd());
    expect(respostas.length).toBeGreaterThan(0);
    limpo(respostas.join('\n'));
  });

  it('respostasDoLead ignora qualquer nome que comece com "_"', () => {
    expect(respostasDoLead([{ name: '_qualquer', values: ['x'] }, { name: 'Consumo', values: ['500'] }])).toEqual(['Consumo: 500']);
  });

  it('semCamposInternos tira os campos "_" e aguenta lixo', () => {
    expect(semCamposInternos(fd()).map(c => c.name)).not.toContain('_capi');
    expect(semCamposInternos(null)).toEqual([]);
    expect(semCamposInternos([null, { name: '_x' }, { name: 'ok' }])).toEqual([{ name: 'ok' }]);
    expect(ehCampoInterno(' _capi')).toBe(true);
    expect(ehCampoInterno('Consumo')).toBe(false);
  });

  it('campoCapiDe guarda UMA chave com os cinco dados e o ts; fbc/fbp malformados e requisição sem nada não geram campo', () => {
    const req = { ip: IP_FALSO, headers: { 'user-agent': UA_FALSO } } as any;
    const c = campoCapiDe(req, { fbc: FBC_NOVO, fbp: FBP }, NOW)!;
    expect(c.name).toBe('_capi');
    expect(c.values).toHaveLength(1);
    expect(JSON.parse(c.values[0])).toEqual({
      fbc: FBC_NOVO, fbp: FBP, client_user_agent: UA_FALSO, client_ip_address: IP_FALSO, event_source_url: 'https://solardoc.app/io/solar', ts: iso(NOW),
    });
    expect(JSON.parse(campoCapiDe(req, { fbc: 'lixo<x>' }, NOW)!.values[0]).fbc).toBeUndefined();
    expect(campoCapiDe({ ip: IP_FALSO, headers: {} } as any, {}, NOW)).toBeNull();
    expect(lerCapi([c])).toMatchObject({ fbc: FBC_NOVO, client_user_agent: UA_FALSO });
    expect(lerCapi([{ name: '_capi', values: ['{quebrado'] }])).toBeNull();
    expect(lerCapi(undefined)).toBeNull();
  });
});

// ── A linha de dedup da página ───────────────────────────────────────────────

describe('linha de dedup da página', () => {
  /** Troca o banco do gerador por um que só guarda o que o upsert recebe. */
  async function comBanco<T>(upsert: (linha: Record<string, unknown>) => unknown, corpo: () => Promise<T>): Promise<T> {
    const mod = await import('../utils/supabaseGerador');
    const orig = (mod.supabaseGerador as any).from;
    (mod.supabaseGerador as any).from = () => ({ upsert: (l: Record<string, unknown>) => upsert(l) });
    try { return await corpo(); } finally { (mod.supabaseGerador as any).from = orig; }
  }

  it('telefone_core8 é sempre preenchido; meta_status 0; sem telefone válido não há linha (NOT NULL, erro 23502)', () => {
    expect(linhaDaPagina({ cardId: 7, telefone: TEL, nome: 'Ana' })).toMatchObject({
      lead_id: 'ag_7', telefone_core8: '91112222', origem: 'pagina', event_name: 'Schedule', meta_status: 0, valor: null,
    });
    expect(linhaDaPagina({ cardId: 7, telefone: TEL })).not.toHaveProperty('meta_error');
    expect(linhaDaPagina({ cardId: 7, telefone: TEL, semEventId: true })).toMatchObject({ meta_error: 'sem_event_id' });
    expect(linhaDaPagina({ cardId: 7, telefone: '123' })).toBeNull();
    expect(linhaDaPagina({ cardId: '', telefone: TEL })).toBeNull();
    expect(normFone(TEL)!.slice(-8)).toBe('91112222');
  });

  it('o banco que não conhece meta_error: tenta de novo sem a coluna e a linha entra', async () => {
    const tentativas: Array<Record<string, unknown>> = [];
    await comBanco(l => { tentativas.push(l); return Promise.resolve({ error: 'meta_error' in l ? { code: '42703', message: 'column "meta_error" does not exist' } : null }); },
      () => registrarSchedulePagina({ cardId: 9, telefone: TEL, nome: 'Ana', semEventId: true }, 'teste'));
    expect(tentativas).toHaveLength(2);
    expect(tentativas[0]).toHaveProperty('meta_error');
    expect(tentativas[1]).not.toHaveProperty('meta_error');
    expect(tentativas[1]).toMatchObject({ lead_id: 'ag_9', origem: 'pagina', telefone_core8: '91112222' });
  });

  it('nunca lança, mesmo com o banco quebrando', async () => {
    await comBanco(() => { throw new Error('banco fora'); },
      async () => { await expect(registrarSchedulePagina({ cardId: 9, telefone: TEL }, 'teste')).resolves.toBeUndefined(); });
  });

  it('registro de teste (flag, nome de teste) e META_TEST_EVENT_CODE ligado: nenhuma linha', async () => {
    const tentativas: unknown[] = [];
    await comBanco(l => { tentativas.push(l); return Promise.resolve({ error: null }); }, async () => {
      await registrarSchedulePagina({ cardId: 9, telefone: TEL, nome: 'Ana', teste: true }, 'teste');
      await registrarSchedulePagina({ cardId: 9, telefone: TEL, nome: 'Teste Interno' }, 'teste');
      process.env.META_TEST_EVENT_CODE = 'TEST123';
      await registrarSchedulePagina({ cardId: 9, telefone: TEL, nome: 'Ana' }, 'teste');
      delete process.env.META_TEST_EVENT_CODE;
      expect(tentativas).toHaveLength(0);
      await registrarSchedulePagina({ cardId: 9, telefone: TEL, nome: 'Ana' }, 'teste');
      expect(tentativas).toHaveLength(1);
    });
  });

  it('teto de 800 ms: banco que trava não segura a resposta', async () => {
    vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(NOW);
    await comBanco(() => new Promise(() => {}), async () => {
      let acabou = false;
      const p = registrarSchedulePagina({ cardId: 9, telefone: TEL, nome: 'Ana' }, 'teste').then(() => { acabou = true; });
      await vi.advanceTimersByTimeAsync(799);
      expect(acabou).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(acabou).toBe(true);
    });
  });
});
