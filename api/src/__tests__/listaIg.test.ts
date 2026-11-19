import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BancoFalso } from './bancoFalsoQuiz';

// Cards e avisos da lista do Instagram (19/11/2026): as sondas do chefe anti-ban com banco falso.
const h = vi.hoisted(() => ({
  main: null as any, ger: null as any, bloqueado: false, cooldown: false, pausa: 'nao' as 'sim' | 'nao' | 'erro',
  rodizio: 0, envios: [] as Array<{ tel: string; texto: string }>, falha: [] as Array<Error | null>,
  nilce: [] as Array<{ card: number; lead: string }>, nilceMotivo: 'enviado' as string,
  vagas: [] as string[], pedidasVagas: [] as any[], falhaRepasse: false,
}));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: (t: string) => {
      const q = h.ger.from(t);
      const update = q.update;
      // Simula o repasse que não gruda: o UPDATE só do repassar_em volta erro.
      q.update = (p: any) => (h.falhaRepasse && t === 'agendamentos' && p && 'repassar_em' in p ? { eq: async () => ({ error: { code: 'XX' } }) } : update(p));
      return q;
    },
  },
}));
vi.mock('../services/io/eletropostoVagas', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoVagas')>()),
  proximasVagas: async (dono: string, _n: number, o: any) => { h.pedidasVagas.push({ dono, agora: o.agora, faixa: o.faixa }); return h.vagas; },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', async (orig) => ({
  ...(await orig<typeof import('../services/agents/zapiClient')>()),
  linhaEmCooldown: () => h.cooldown,
  sendWhatsApp: async (tel: string, texto: string) => {
    const f = h.falha.shift();
    if (f) throw f;
    h.envios.push({ tel, texto });
  },
}));
vi.mock('../services/agentes5040/vivoEnvio', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/vivoEnvio')>()), linhaPausada: async () => h.pausa,
}));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()), estaBloqueado: async () => h.bloqueado,
}));
vi.mock('../services/io/eletropostoCard', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoCard')>()), consultaDoRodizio: async () => ({ count: h.rodizio, error: null }),
}));
vi.mock('../services/io/solarQuizAviso', () => ({
  avisarAgendado: async (_p: string, card: number, lead: string) => {
    h.nilce.push({ card, lead });
    return { enviado: h.nilceMotivo === 'enviado', motivo: h.nilceMotivo };
  },
}));

import { criarCardEletroposto, criarCardSolar } from '../services/io/listaIgCards';
import { avisarLeadDaLista, runListaIgResumoTick } from '../services/io/listaIgAviso';
import { baldeDe5, reservarVaga } from '../services/io/listaIgVaga';
import { ehCardMudo } from '../services/agenda/solarRota';
import { ehCardSemAvisoAutomatico, ehCardDoLote, ORIGEM_CADASTRO_EP } from '../services/agenda/origemEtiqueta';
import { cardReabre, reuniaoDaEquipe, REUNIAO_VENCIDA_MS } from '../services/io/investidorAgentePuro';
import { ultimaLinhaEhDePessoa } from '../services/io/investidorAgenteEquipe';
import { EQUIPE } from '../services/io/solarEquipe';

const AGORA = Date.parse('2026-11-19T17:00:00Z');   // quinta, 14h de Brasília
const NOITE = Date.parse('2026-11-20T01:30:00Z');   // quinta, 22h30 de Brasília
const pessoa = { nome: 'Ana Souza', telefone: '5534991112222', email: 'ana@exemplo.com', cidade: 'Uberlândia', uf: 'MG' };
const entrada = (listaId: number) => ({ listaId, pessoa, utm: { source: 'ig' } });
const ss = () => h.main.tabela('system_state') as any[];
const chaves = (p: string) => ss().filter(l => String(l.key).startsWith(p)).map(l => l.key);
const semear = (key: string, msAtras: number, value: any = {}) =>
  ss().push({ key, value, updated_at: new Date(AGORA - msAtras).toISOString() });

beforeEach(() => {
  h.main = new BancoFalso(); h.ger = new BancoFalso();
  h.main.tabela('io_instagram_interesse').push({ id: 1, card_solar_id: null, card_eletroposto_id: null }, { id: 2, card_solar_id: null, card_eletroposto_id: null });
  Object.assign(h, { bloqueado: false, cooldown: false, pausa: 'nao', rodizio: 0, nilceMotivo: 'enviado' });
  h.envios.length = 0; h.falha.length = 0; h.nilce.length = 0; h.pedidasVagas.length = 0; h.falhaRepasse = false;
  h.vagas = [new Date(AGORA + 3_600_000).toISOString(), new Date(AGORA + 5_400_000).toISOString()];
  delete process.env.IO_LISTA_AVISOS_OFF;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('card solar (condições 1, 5, 11, 12)', () => {
  it('nasce MUDO pela marca, lp_solar com src=ig, carimbado, ligado na lista e com aviso_antigo', async () => {
    const r = await criarCardSolar(entrada(1), { tipo: 'casa', conta: '300_600', pagamento: 'vista' }, AGORA);
    expect(r.status).toBe('ok');
    const card = h.ger.tabela('agendamentos')[0];
    expect(ehCardMudo(card.observacao)).toBe(true);
    expect(card.observacao.split('\n').slice(0, 2)).toEqual(['LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO', 'Onde: Casa']);
    expect(card.observacao).toContain('Veio da lista de interesse do Instagram');
    expect([card.created_by, card.src, card.vendedor_nome]).toEqual(['lp_solar', 'ig', 'Nilce']);
    expect(card.boas_vindas_at && card.bomdia_at && card.lembrete_5min_at).toBeTruthy();
    expect(h.main.tabela('io_instagram_interesse')[0].card_solar_id).toBe(card.id);
    expect(chaves('aviso_antigo:')).toEqual([`aviso_antigo:${card.id}`]);
  });

  it('um card por pessoa: a mesma linha não cria outro; telefone com card vivo também não', async () => {
    await criarCardSolar(entrada(1), { tipo: 'casa', conta: 'ate300', pagamento: 'vista' }, AGORA);
    expect(await criarCardSolar(entrada(2), { tipo: 'casa', conta: 'ate300', pagamento: 'vista' }, AGORA)).toEqual({ status: 'pulou', motivo: 'card_vivo' });
    h.ger.tabela('agendamentos')[0].status = 'cancelado';
    expect(await criarCardSolar(entrada(1), { tipo: 'casa', conta: 'ate300', pagamento: 'vista' }, AGORA)).toEqual({ status: 'pulou', motivo: 'ja_tem_card' });
  });

  it('telefone bloqueado: sem card, sem chave, sem aviso', async () => {
    h.bloqueado = true;
    expect(await criarCardSolar(entrada(1), { tipo: 'casa', conta: 'ate300', pagamento: 'vista' }, AGORA)).toEqual({ status: 'pulou', motivo: 'bloqueado' });
    expect(await criarCardEletroposto(entrada(2), 'cotista', { local: 'meu', capital: '100', recurso: 'proprio' }, AGORA)).toEqual({ status: 'pulou', motivo: 'bloqueado' });
    expect(h.ger.tabela('agendamentos')).toHaveLength(0);
    expect(ss()).toHaveLength(0);
  });
});

describe('card de eletroposto (condições 2, 3, 4, 5)', () => {
  it('origem nova muda, carimbos do tick, ep_mudo, tipo, repassar_em nulo, dono do rodízio', async () => {
    h.rodizio = 1;
    const r = await criarCardEletroposto(entrada(2), 'arrendamento', { ponto_tipo: 'posto', relacao: 'proprietario', vagas: '3_5' }, AGORA);
    expect(r.status).toBe('ok');
    const card = h.ger.tabela('agendamentos')[0];
    expect([card.created_by, card.src, card.vendedor_nome]).toEqual(['lista_ig_eletroposto', 'ig', 'Diego']);
    expect(ehCardSemAvisoAutomatico(card.created_by)).toBe(true);
    expect(ehCardDoLote(card.created_by)).toBe(false);
    expect(cardReabre({ id: card.id, status: 'agendado', quando: card.quando, origem: card.created_by, historico: [] } as any, AGORA)).toBe(false);
    expect(card.repassar_em ?? null).toBeNull();
    expect(card.confirmacao_at && card.lembrete_1h_at && card.lembrete_5min_at).toBeTruthy();
    expect(Date.parse(card.quando)).toBeGreaterThan(AGORA);
    expect(chaves('ep_mudo:')).toEqual([`ep_mudo:${card.id}`]);
    expect(ss().find(l => l.key === `tipo_card:${card.id}`)?.value?.tipo).toBe('arrendamento');
    expect(h.main.tabela('io_instagram_interesse')[1].card_eletroposto_id).toBe(card.id);
    expect(await criarCardEletroposto(entrada(1), 'cotista', { local: 'meu', capital: '100', recurso: 'proprio' }, AGORA)).toEqual({ status: 'pulou', motivo: 'card_vivo' });
  });

  it('condição 3: o predicado ANTIGO (copiado literal) e o novo dão o mesmo resultado para as origens que já existem', () => {
    // ── cópia literal de investidorAgentePuro.ts e origemEtiqueta.ts ANTES de 19/11/2026 ──
    const norm = (v: unknown): string => (v ?? '').toString().trim().toLowerCase();
    function ehCardSemAvisoAutomatico_antigo(createdBy: unknown): boolean {
      return norm(createdBy) === ORIGEM_CADASTRO_EP;
    }
    const statusDoCard = (c: any): string => String(c.status ?? '').trim().toLowerCase();
    const STATUS_REABRIVEIS: ReadonlySet<string> = new Set(['cancelado', 'nao_atendeu']);
    function reuniaoDaEquipe_antigo(c: any, agoraMs: number): boolean {
      if (statusDoCard(c) !== 'agendado' || !ehCardSemAvisoAutomatico_antigo(c.origem)) return false;
      const q = Date.parse(String(c.quando ?? ''));
      return Number.isFinite(q) && q >= agoraMs - REUNIAO_VENCIDA_MS && ultimaLinhaEhDePessoa(c.historico);
    }
    function cardReabre_antigo(c: any, agoraMs: number): boolean {
      const st = statusDoCard(c);
      if (STATUS_REABRIVEIS.has(st)) return true;
      if (st !== 'agendado') return false;
      if (ehCardSemAvisoAutomatico_antigo(c.origem)) return !reuniaoDaEquipe_antigo(c, agoraMs);
      const q = Date.parse(String(c.quando ?? ''));
      return Number.isFinite(q) && q < agoraMs - REUNIAO_VENCIDA_MS;
    }
    const faixa_antiga = (reabriveis: any[]) => (reabriveis.some(c => !ehCardSemAvisoAutomatico_antigo(c.origem)) ? 'card_parado' : 'lote_mudo');
    const faixa_nova = (reabriveis: any[]) => (reabriveis.some(c => !ehCardDoLote(c.origem)) ? 'card_parado' : 'lote_mudo');
    // ── fim da cópia ──
    const origens = ['lp_eletroposto', 'manychat_eletroposto', 'prosp_eletroposto', 'agente_eletroposto', 'convite_investidor_eletroposto',
      ORIGEM_CADASTRO_EP, ' Cadastro_Eletroposto ', 'ep-trafego', 'lp_solar', 'lead-meta', '', null, undefined];
    const quandos = [AGORA + 3_600_000, AGORA - 3_600_000, AGORA - 2 * REUNIAO_VENCIDA_MS, NaN];
    const historicos = [[], [{ por: 'Giovanna', em: new Date(AGORA).toISOString() }], [{ por: 'robo', em: new Date(AGORA).toISOString() }], null];
    const cards: any[] = [];
    for (const origem of origens) for (const status of ['agendado', 'nao_atendeu', 'cancelado', 'negociacao', ' Agendado', null]) for (const quando of quandos) for (const historico of historicos) {
      const c = { id: 1, status, quando: Number.isFinite(quando) ? new Date(quando).toISOString() : null, origem, historico } as any;
      cards.push(c);
      expect(cardReabre(c, AGORA), `${origem} ${status}`).toBe(cardReabre_antigo(c, AGORA));
      expect(reuniaoDaEquipe(c, AGORA)).toBe(reuniaoDaEquipe_antigo(c, AGORA));
    }
    for (const origem of origens) expect(ehCardDoLote(origem)).toBe(ehCardSemAvisoAutomatico_antigo(origem));
    for (let k = 0; k < cards.length; k += 7) expect(faixa_nova(cards.slice(k, k + 5))).toBe(faixa_antiga(cards.slice(k, k + 5)));
  });
});

describe('card vivo, vaga real e repasse (revisão de 19/11)', () => {
  const sol = { tipo: 'casa', conta: 'ate300', pagamento: 'vista' };
  const card = (x: Record<string, unknown>) => h.ger.tabela('agendamentos').push({ id: 500, cliente_telefone: pessoa.telefone, vendedor_nome: 'Thiago', ...x });

  it('(a) agendado no futuro e fora do lote segura: não cria nem avisa', async () => {
    card({ status: 'agendado', created_by: 'lp_eletroposto', quando: new Date(AGORA + 86_400_000).toISOString() });
    expect(await criarCardEletroposto(entrada(2), 'cotista', { local: 'meu', capital: '100', recurso: 'proprio' }, AGORA)).toEqual({ status: 'pulou', motivo: 'card_vivo' });
    expect(h.ger.tabela('agendamentos')).toHaveLength(1);
  });

  it('(b) card parado (não atendeu, lote no futuro, vencido): não cria, devolve "voltou" uma vez por cadastro', async () => {
    card({ status: 'nao_atendeu', created_by: 'lp_solar', quando: new Date(AGORA - 86_400_000).toISOString() });
    expect(await criarCardSolar(entrada(1), sol, AGORA)).toEqual({ status: 'voltou', card: { id: 500, dono: 'Thiago' } });
    expect(await criarCardSolar(entrada(1), sol, AGORA)).toEqual({ status: 'pulou', motivo: 'ja_avisado' });
    h.ger.zerar();
    card({ status: 'agendado', created_by: ORIGEM_CADASTRO_EP, quando: new Date(AGORA + 86_400_000).toISOString() });
    expect((await criarCardEletroposto(entrada(2), 'cotista', { local: 'meu', capital: '100', recurso: 'proprio' }, AGORA)).status).toBe('voltou');
    expect(h.ger.tabela('agendamentos')).toHaveLength(1);
    const r = await avisarLeadDaLista({ porta: 'solar', cardId: 500, listaId: 1, dono: 'nilce', voltou: true, texto: 'voltou' }, AGORA);
    expect(r.motivo).toBe('enviado');
    expect(h.nilce).toHaveLength(0);                     // pelo robô da lista, não pelo avisarAgendado
    expect(h.envios.map(e => e.tel)).toEqual([EQUIPE.nilce]);
    expect(chaves('io_lista_env:')).toEqual(['io_lista_env:nilce:volta:1:500']);
    expect(chaves('aviso_antigo:')).toEqual([]);
  });

  it('(c) só card morto: cria como sempre', async () => {
    card({ status: 'cancelado', created_by: 'lp_solar', quando: new Date(AGORA + 86_400_000).toISOString() });
    card({ id: 501, status: 'sem_interesse', created_by: 'lp_solar', quando: new Date(AGORA - 86_400_000).toISOString() });
    expect((await criarCardSolar(entrada(1), sol, AGORA)).status).toBe('ok');
  });

  it('eletroposto usa a primeira vaga REAL do dono (proximasVagas) e pula a que alguém tomou', async () => {
    h.ger.tabela('agendamentos').push({ id: 9, vendedor_nome: 'Thiago', quando: h.vagas[0], status: 'agendado', cliente_telefone: '5511900000000', created_by: 'lp_eletroposto' });
    const r = await criarCardEletroposto(entrada(2), 'so_carregador', { potencia: '80', qtd: '1', instala: 'nao_sei' }, AGORA);
    expect(h.pedidasVagas).toEqual([{ dono: 'Thiago', agora: AGORA, faixa: 'novo' }]);
    expect(r).toMatchObject({ status: 'ok', card: { quando: h.vagas[1], dono: 'Thiago' } });
    expect(chaves('tipo_card:')).toEqual([]);   // só o carregador não tem tipo
  });

  it('repassar_em que não confirma vira io_lista_repasse:<id>, e o tick refaz e confere até apagar', async () => {
    h.falhaRepasse = true;
    const r = await criarCardEletroposto(entrada(2), 'cotista', { local: 'meu', capital: '100', recurso: 'proprio' }, AGORA);
    expect(r.status).toBe('ok');
    const id = (r as any).card.id;
    expect(chaves('io_lista_repasse:')).toEqual([`io_lista_repasse:${id}`]);
    expect((await runListaIgResumoTick({ agora: AGORA })).repasse).toEqual({ consertados: 0, pendentes: 1 });
    h.falhaRepasse = false;
    expect((await runListaIgResumoTick({ agora: AGORA })).repasse).toEqual({ consertados: 1, pendentes: 0 });
    expect(chaves('io_lista_repasse:')).toEqual([]);
  });
});

describe('avisos (condições 6 a 11)', () => {
  const ep = (dono: 'thiago' | 'diego') => ({ porta: 'eletroposto' as const, cardId: 5, listaId: 9, dono, texto: 'Ficha' });

  it('Thiago e Diego um depois do outro: o dono primeiro, o outro 25 s + sorteio depois, carimbo antes de cada envio', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 25 s + 17,5 s
    const p = avisarLeadDaLista(ep('diego'), AGORA);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(h.envios.map(e => e.tel)).toEqual([EQUIPE.diego]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await p).motivo).toBe('enviado');
    expect(h.envios.map(e => e.tel)).toEqual([EQUIPE.diego, EQUIPE.thiago]);
    expect(chaves('io_lista_env:').sort()).toEqual(['io_lista_env:diego:5', 'io_lista_env:thiago:5']);
    expect(chaves('io_lista_vaga:')).toHaveLength(1);
    expect(ss().find(l => l.key.startsWith('io_lista_vaga:')).value.n).toBe(2);
    expect(chaves('aviso_antigo:')).toEqual(['aviso_antigo:5']);
    expect(h.envios[0].texto).not.toMatch(/foi avisado/);
  });

  it('o 1º falhou: o 2º não sai; falha sem prova guarda a chave', async () => {
    h.falha.push(new Error('[zapi:io] HTTP 500'));
    const p = avisarLeadDaLista(ep('thiago'), AGORA);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await p).motivo).toBe('falhou');
    expect(h.envios).toHaveLength(0);
    expect(chaves('io_lista_env:')).toEqual(['io_lista_env:thiago:5']);
    expect(chaves('io_lista_pend:')).toEqual([]);
  });

  it('o 1º provou que nada saiu (cooldown): chave apagada, os dois esperam o resumo', async () => {
    h.falha.push(new Error('[zapi:io] em cooldown (instância indisponível há <60s)'));
    const p = avisarLeadDaLista(ep('thiago'), AGORA);
    await vi.advanceTimersByTimeAsync(120_000);
    await p;
    expect(h.envios).toHaveLength(0);
    expect(chaves('io_lista_env:')).toEqual([]);
    expect(chaves('io_lista_pend:').sort()).toEqual(['io_lista_pend:diego:5', 'io_lista_pend:thiago:5']);
  });

  it('Nilce: carimbo solar_quiz_env por INSERT antes do avisarAgendado, 1 vaga', async () => {
    const r = await avisarLeadDaLista({ porta: 'solar', cardId: 7, listaId: 3, dono: 'nilce', texto: 'Ficha' }, AGORA);
    expect(r).toEqual({ motivo: 'enviado', enviados: ['nilce'] });
    expect(h.nilce).toEqual([{ card: 7, lead: 'ig_3' }]);
    expect(chaves('solar_quiz_env:')).toEqual(['solar_quiz_env:nilce:agendado:ig_3']);
    h.nilceMotivo = 'cooldown';
    vi.setSystemTime(AGORA + 10 * 60_000);
    await avisarLeadDaLista({ porta: 'solar', cardId: 8, listaId: 4, dono: 'nilce', texto: 'Ficha' }, AGORA + 10 * 60_000);
    expect(chaves('solar_quiz_env:')).toEqual(['solar_quiz_env:nilce:agendado:ig_3']);
    expect(chaves('aviso_antigo:')).toContain('aviso_antigo:8');
    expect(chaves('io_lista_pend:')).toEqual(['io_lista_pend:nilce:8']);
  });

  it('teto: balde de 5 min tomado = sem aviso, aviso_antigo gravado e pendente', async () => {
    semear(`io_lista_vaga:${baldeDe5(AGORA)}`, 60_000, { n: 1 });
    const r = await avisarLeadDaLista({ porta: 'solar', cardId: 7, listaId: 3, dono: 'nilce', texto: 'x' }, AGORA);
    expect(r.motivo).toBe('teto');
    expect(h.nilce).toHaveLength(0);
    expect(chaves('aviso_antigo:')).toEqual(['aviso_antigo:7']);
    expect(chaves('io_lista_pend:')).toEqual(['io_lista_pend:nilce:7']);
  });

  it('teto: 12 por hora, 60 em 24 h, lead de eletroposto precisa das 2 vagas, linha com 40 na hora', async () => {
    for (let i = 0; i < 11; i++) semear(`io_lista_vaga:h${i}`, 10 * 60_000, { n: 1 });
    expect(await reservarVaga(2, AGORA)).toBe('teto');
    expect(await reservarVaga(1, AGORA)).toBe('ok');
    h.main.zerar();
    for (let i = 0; i < 59; i++) semear(`io_lista_vaga:d${i}`, 2 * 3_600_000 + i * 60_000, { n: 1 });
    expect(await reservarVaga(2, AGORA)).toBe('teto');
    h.main.zerar();
    for (let i = 0; i < 40; i++) semear(`ag5040_sent:x${i}`, 30 * 60_000);
    expect(await reservarVaga(1, AGORA)).toBe('teto');
    expect(chaves('io_lista_vaga:')).toEqual([]);
  });

  it('janela: Thiago e Diego só das 7h às 21h; fora, o aviso espera no pendente', async () => {
    vi.setSystemTime(NOITE);
    const r = await avisarLeadDaLista(ep('thiago'), NOITE);
    expect(r.motivo).toBe('fora_da_janela');
    expect(h.envios).toHaveLength(0);
    expect(chaves('io_lista_pend:').sort()).toEqual(['io_lista_pend:diego:5', 'io_lista_pend:thiago:5']);
    expect(chaves('io_lista_vaga:')).toEqual([]);
  });

  it('IO_LISTA_AVISOS_OFF=1: nenhum aviso nem resumo, o aviso fica pendente', async () => {
    process.env.IO_LISTA_AVISOS_OFF = '1';
    expect((await avisarLeadDaLista(ep('thiago'), AGORA)).motivo).toBe('desligado');
    expect(chaves('io_lista_pend:').sort()).toEqual(['io_lista_pend:diego:5', 'io_lista_pend:thiago:5']);
    expect((await runListaIgResumoTick({ agora: AGORA })).motivo).toBe('desligado');
    expect(h.envios).toHaveLength(0);
    expect(chaves('io_lista_vaga:')).toEqual([]);
  });

  it('falha da Nilce conta no freio de erro da linha', async () => {
    h.nilceMotivo = 'falhou';
    await avisarLeadDaLista({ porta: 'solar', cardId: 7, listaId: 3, dono: 'nilce', texto: 'x' }, AGORA);
    expect(ss().find(l => l.key === 'ag5040_linha_erros')?.value?.n).toBe(1);
  });

  it('resumo: card que virou negociação sai da lista e do pendente', async () => {
    h.ger.tabela('agendamentos').push({ id: 6, cliente_nome: 'Bia', cidade: 'Uberaba-MG', status: 'negociacao' });
    semear('io_lista_pend:nilce:6', 3_600_000, { card: 6, porta: 'solar' });
    expect((await runListaIgResumoTick({ agora: AGORA })).motivo).toBe('nada');
    expect(h.envios).toHaveLength(0);
    expect(chaves('io_lista_pend:')).toEqual([]);
  });

  it('resumo: 1 mensagem por pessoa com nomes e cidades, gasta 1 vaga, limpa os pendentes', async () => {
    h.ger.tabela('agendamentos').push({ id: 5, cliente_nome: 'Ana Souza', cidade: 'Uberlândia-MG', status: 'agendado' });
    semear('io_lista_pend:thiago:5', 3_600_000, { card: 5, porta: 'eletroposto' });
    semear('io_lista_pend:diego:5', 3_600_000, { card: 5, porta: 'eletroposto' });
    const r = await runListaIgResumoTick({ agora: AGORA });
    expect(r).toMatchObject({ enviado: true, pessoa: 'thiago', n: 1 });
    expect(h.envios).toHaveLength(1);
    expect(h.envios[0].texto).toContain('Ana Souza, Uberlândia-MG');
    expect(chaves('io_lista_pend:')).toEqual(['io_lista_pend:diego:5']);
    expect((await runListaIgResumoTick({ agora: AGORA })).motivo).toBe('teto');   // o balde de 5 min já foi
  });
});
