import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Blindagem do motor de resposta automática do Instagram (exigência do chefe-antiban):
//   1) uma resposta por pessoa por automação a cada 7 dias (DM e pública juntas);
//   2) drenagem: conversa > anúncio > orgânico, teto por hora a CADA envio, intervalo sorteado de 2 a 6 s,
//      relógio de 200 s, e limite da Meta (code 4/17/32/613) volta pra fila +15 min sem "me chama no direct".

const h = vi.hoisted(() => {
  process.env.META_SYSTEM_USER_TOKEN = 'tk';
  process.env.IG_AUTOMACAO_ENABLED = 'true';
  return {
    ordem: [] as string[],
    publicas: [] as string[],
    erro: null as null | ((alvo: string) => Error | null),
    demoraMs: 0,
    automacoes: [] as any[],
  };
});

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: { from: () => ({ select: () => ({ eq: async () => ({ data: h.automacoes }) }) }) },
  geradorComServiceKey: false,
}));
vi.mock('../services/agenda/manychatLeadService', () => ({ ingestManychatLead: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(), solardocViaIo: () => false }));
vi.mock('../services/io/prospeccaoConversaIg', () => ({ tratarRespostaProspeccao: vi.fn() }));
vi.mock('../services/instagram/igIa', () => ({ responderComIa: vi.fn(), conversaAtiva: vi.fn(async () => false) }));
vi.mock('../services/instagram/igClient', async () => {
  const real = await vi.importActual<any>('../services/instagram/igClient');
  const envia = async (alvo: string) => {
    if (h.demoraMs) await new Promise(r => setTimeout(r, h.demoraMs));
    const e = h.erro?.(alvo);
    if (e) throw e;
    h.ordem.push(alvo);
    return { message_id: 'm-' + alvo };
  };
  return {
    ...real,
    igEnv: () => ({ enabled: true, appId: 'a', appSecret: 's', redirectUri: '', verifyToken: '' }),
    getIgConfig: vi.fn(async () => ({ access_token: 'igtk', ig_user_id: '17841400000001' })),
    sendPrivateReply: vi.fn(async (_ig: string, comentario: string) => envia(comentario)),
    sendDM: vi.fn(async (_ig: string, pessoa: string) => envia(pessoa)),
    replyToComment: vi.fn(async (comentario: string) => { h.publicas.push(comentario); return { id: 'r1' }; }),
  };
});

import { banco } from './redesBancoFalso';
import { drainIgQueue, handleComment, reservarRespostaPessoa, chaveRespostaPessoaIg, grupoDaFila } from '../services/instagram/igEngine';
import { replyToComment } from '../services/instagram/igClient';

const DIA = 24 * 3600 * 1000;

function linhaFila(id: string, tipo: string, extra: { origem?: string; criado: string; tentativas?: number; pubFail?: string; pubOk?: string; reserva?: string }): void {
  (banco.tabelas.ig_queue ??= []).push({
    id, tipo, automation_id: 'a1', recipient: id, status: 'pending', needs_window: false,
    payload: {
      text: 'oi',
      ...(extra.origem ? { origem: extra.origem } : {}),
      ...(extra.pubFail ? { pub_fail: extra.pubFail } : {}),
      ...(extra.pubOk ? { pub_ok: extra.pubOk } : {}),
      ...(extra.reserva ? { reserva: extra.reserva } : {}),
    },
    enviar_apos: '2000-01-01T00:00:00.000Z', criado_em: `2026-11-20T10:00:${extra.criado}.000Z`, tentativas: extra.tentativas ?? 0,
  });
}
const linha = (id: string) => banco.tabelas.ig_queue!.find(r => r.id === id)!;
const publicasNaFila = () => (banco.tabelas.ig_queue ?? []).filter(r => r.tipo === 'public_reply');

beforeEach(() => {
  banco.reiniciar();
  h.ordem.length = 0; h.publicas.length = 0; h.erro = null; h.demoraMs = 0;
  vi.mocked(replyToComment).mockClear();
  process.env.IG_SPACING_MIN_MS = '0';
  process.env.IG_SPACING_MAX_MS = '0';
  delete process.env.IG_MAX_POR_HORA;
  delete process.env.IG_RODADA_MAX_MS;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ── 1) Uma resposta por pessoa por automação a cada 7 dias ─────────────────────────────────────────
describe('dedup por pessoa: 1 resposta por automação a cada 7 dias', () => {
  const auto = {
    id: 'a1', nome: 'Menu', ativo: true, gatilhos: { comment: true }, palavras_chave: [], match_tipo: 'qualquer',
    post_id: null, respostas_publicas: ['Te chamei no direct'], dm_boas_vindas: 'Oi!', botao_rotulo: null, link_url: null,
    lembrete_texto: null, lembrete_horas: 24, prioridade: 100, midias: [], fallback: false, produto: 'solar',
  };
  const comentario = (id: string, de = 'P1') => ({ id, text: 'quero saber mais', from: { id: de, username: 'ana' }, media: { id: 'M1' } });
  const privadas = () => (banco.tabelas.ig_queue ?? []).filter(r => r.tipo === 'private_reply');
  const reservaDe = (a: string, p: string) => banco.tabelas.system_state!.find(r => r.key === chaveRespostaPessoaIg(a, p))!;

  beforeEach(() => { h.automacoes = [auto]; });

  it('2º comentário da mesma pessoa na mesma automação em menos de 7 dias não gera nada', async () => {
    await handleComment(comentario('C1'));
    expect(privadas()).toHaveLength(1);
    await handleComment(comentario('C2'));
    expect(privadas()).toHaveLength(1);                                   // nenhuma DM nova (a pública só nasce da DM)
    expect(publicasNaFila()).toHaveLength(0);
    expect(banco.tabelas.system_state!.filter(r => r.key === chaveRespostaPessoaIg('a1', 'P1'))).toHaveLength(1);
    expect(banco.tabelas.ig_events!.some(e => e.tipo === 'dedup_pessoa' && e.ref === 'C2')).toBe(true);
  });

  it('a DM enfileirada leva a chave da reserva no payload (a drenagem a apaga se a pessoa ficar sem nada)', async () => {
    await handleComment(comentario('C1'));
    expect(privadas()[0].payload.reserva).toBe(chaveRespostaPessoaIg('a1', 'P1'));
  });

  it('pessoa diferente, ou automação diferente, responde normal', async () => {
    await handleComment(comentario('C1', 'P1'));
    await handleComment(comentario('C2', 'P2'));
    expect(privadas()).toHaveLength(2);
    expect(await reservarRespostaPessoa('a2', 'P1')).toBe(true);
  });

  it('depois de 7 dias a mesma pessoa volta a receber', async () => {
    await handleComment(comentario('C1'));
    reservaDe('a1', 'P1').updated_at = new Date(Date.now() - 8 * DIA).toISOString();
    await handleComment(comentario('C2'));
    expect(privadas()).toHaveLength(2);
    expect(Date.now() - new Date(reservaDe('a1', 'P1').updated_at).getTime()).toBeLessThan(60_000);   // reserva renovada
  });

  it('6 dias e 23 h ainda bloqueia', async () => {
    await handleComment(comentario('C1'));
    reservaDe('a1', 'P1').updated_at = new Date(Date.now() - (7 * DIA - 3600_000)).toISOString();
    await handleComment(comentario('C2'));
    expect(privadas()).toHaveLength(1);
  });

  it('dois comentários ao mesmo tempo: só um reserva (insert atômico)', async () => {
    const r = await Promise.all([reservarRespostaPessoa('a1', 'P9'), reservarRespostaPessoa('a1', 'P9')]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('retomada de reserva vencida também é atômica: só um concorrente ganha', async () => {
    (banco.tabelas.system_state ??= []).push({ key: chaveRespostaPessoaIg('a1', 'P8'), value: 'x', updated_at: new Date(Date.now() - 9 * DIA).toISOString() });
    const r = await Promise.all([reservarRespostaPessoa('a1', 'P8'), reservarRespostaPessoa('a1', 'P8')]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('erro de banco que não é duplicidade deixa passar (a resposta ao lead vale mais que a trava)', async () => {
    banco.falha = (t, op) => (t === 'system_state' && op === 'insert' ? 'XX000' : null);
    expect(await reservarRespostaPessoa('a1', 'P7')).toBe(true);
  });
});

// ── 2) Drenagem da fila ──────────────────────────────────────────────────────────────────────────────
describe('drenagem: ordem', () => {
  it('conversa (DM) primeiro, depois anúncio, depois orgânico; dentro do grupo, ordem de chegada', async () => {
    linhaFila('org1', 'private_reply', { origem: 'organico', criado: '01' });
    linhaFila('adB', 'private_reply', { origem: 'anuncio', criado: '03' });
    linhaFila('dm1', 'dm', { criado: '05' });
    linhaFila('adA', 'private_reply', { origem: 'anuncio', criado: '02' });
    linhaFila('org2', 'private_reply', { criado: '00' });                  // sem marca (fila antiga) = orgânico
    await drainIgQueue();
    expect(h.ordem).toEqual(['dm1', 'adA', 'adB', 'org2', 'org1']);
  });

  it('grupoDaFila: tipo decide conversa x comentário; payload.origem decide anúncio x orgânico', () => {
    expect(grupoDaFila({ tipo: 'dm' })).toBe(0);
    expect(grupoDaFila({ tipo: 'followup_1h' })).toBe(0);
    expect(grupoDaFila({ tipo: 'private_reply', payload: { origem: 'anuncio' } })).toBe(1);
    expect(grupoDaFila({ tipo: 'public_reply', payload: { origem: 'anuncio' } })).toBe(1);
    expect(grupoDaFila({ tipo: 'private_reply', payload: { origem: 'organico' } })).toBe(2);
    expect(grupoDaFila({ tipo: 'private_reply', payload: {} })).toBe(2);
  });

  it('a resposta pública herda a origem da DM (anúncio continua na frente do orgânico)', async () => {
    linhaFila('adA', 'private_reply', { origem: 'anuncio', criado: '01', pubOk: 'Te chamei' });
    await drainIgQueue();
    expect(publicasNaFila()[0].payload).toMatchObject({ text: 'Te chamei', origem: 'anuncio' });
  });
});

describe('drenagem: teto por hora a cada envio', () => {
  it('para no meio da rodada quando o teto é atingido (antes era 1 conferência por rodada)', async () => {
    process.env.IG_MAX_POR_HORA = '3';
    const agora = new Date().toISOString();
    (banco.tabelas.system_state ??= []).push({ key: 'ig_sent:velho1', value: '1', updated_at: agora }, { key: 'ig_sent:velho2', value: '1', updated_at: agora });
    linhaFila('d1', 'dm', { criado: '01' }); linhaFila('d2', 'dm', { criado: '02' }); linhaFila('d3', 'dm', { criado: '03' });
    const r = await drainIgQueue();
    expect(h.ordem).toEqual(['d1']);                                      // 2 já contados + 1 = 3 = teto
    expect(r).toMatchObject({ enviados: 1, reason: 'teto_hora' });
    expect(linha('d2').status).toBe('pending');                           // sobra pra próxima rodada, intocada
    expect(linha('d3').status).toBe('pending');
  });

  it('teto já cheio na entrada: não envia nada', async () => {
    process.env.IG_MAX_POR_HORA = '1';
    (banco.tabelas.system_state ??= []).push({ key: 'ig_sent:x', value: '1', updated_at: new Date().toISOString() });
    linhaFila('d1', 'dm', { criado: '01' });
    expect(await drainIgQueue()).toMatchObject({ enviados: 0, reason: 'teto_hora' });
    expect(h.ordem).toEqual([]);
  });
});

describe('drenagem: intervalo e relógio', () => {
  it('intervalo sorteado entre 2 e 6 s (não os 500 ms fixos), só ENTRE envios', async () => {
    delete process.env.IG_SPACING_MIN_MS; delete process.env.IG_SPACING_MAX_MS;
    vi.useFakeTimers();
    const espera = vi.spyOn(globalThis, 'setTimeout');
    const sorteio = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    linhaFila('d1', 'dm', { criado: '01' }); linhaFila('d2', 'dm', { criado: '02' });
    const p = drainIgQueue();
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const atrasos = espera.mock.calls.map(c => Number(c[1])).filter(n => n >= 1000);
    expect(atrasos).toEqual([4000]);                                      // 2000 + 0,5 x 4000; um só, entre os dois envios
    expect(h.ordem).toEqual(['d1', 'd2']);

    // extremos do sorteio: 0 -> 2 s, quase 1 -> 6 s (arredonda)
    for (const [sorteado, esperado] of [[0, 2000], [0.9999, 6000]] as const) {
      sorteio.mockReturnValue(sorteado);
      h.ordem.length = 0; espera.mockClear();
      linhaFila('e' + esperado + 'a', 'dm', { criado: '10' }); linhaFila('e' + esperado + 'b', 'dm', { criado: '11' });
      const q = drainIgQueue();
      await vi.advanceTimersByTimeAsync(10_000);
      await q;
      expect(espera.mock.calls.map(c => Number(c[1])).filter(n => n >= 1000)).toEqual([esperado]);
    }
  });

  it('depois de 200 s (aqui 40 ms) a rodada não inicia envio novo; o resto fica pending', async () => {
    process.env.IG_RODADA_MAX_MS = '40';
    h.demoraMs = 60;
    linhaFila('d1', 'dm', { criado: '01' }); linhaFila('d2', 'dm', { criado: '02' }); linhaFila('d3', 'dm', { criado: '03' });
    const r = await drainIgQueue();
    expect(h.ordem).toEqual(['d1']);
    expect(r).toMatchObject({ enviados: 1, reason: 'tempo_da_rodada' });
    expect(linha('d2').status).toBe('pending');
  });
});

describe('drenagem: erros', () => {
  const erroMeta = (code: number, http = 400) => new Error(`sendMessage ${http}: {"error":{"message":"limite","type":"OAuthException","code":${code}}}`);

  it.each([4, 17, 32, 613])('code %i da Meta: volta pra fila +15 min e NÃO publica o "me chama no direct"', async (code) => {
    h.erro = () => erroMeta(code);
    linhaFila('p1', 'private_reply', { origem: 'anuncio', criado: '01', pubFail: '@ana me chama no direct' });
    linhaFila('p2', 'private_reply', { origem: 'anuncio', criado: '02' });
    const antes = Date.now();
    const r = await drainIgQueue();
    const p1 = linha('p1');
    expect(p1.status).toBe('pending');
    expect(p1.tentativas).toBe(1);
    const em = new Date(p1.enviar_apos).getTime() - antes;
    expect(em).toBeGreaterThan(14 * 60_000);
    expect(em).toBeLessThan(16 * 60_000);
    expect(p1.erro).toContain('limite_meta');
    expect(publicasNaFila()).toHaveLength(0);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(r).toMatchObject({ enviados: 0, adiados: 1, reason: 'limite_meta' });
    expect(linha('p2')).toMatchObject({ status: 'pending', tentativas: 0 });   // rodada parou: não insiste com a Meta limitando
    expect(banco.tabelas.system_state ?? []).toHaveLength(0);                    // não conta como enviado
  });

  it('depois de 8 tentativas por limite, desiste (failed) sem comentário público', async () => {
    h.erro = () => erroMeta(4);
    linhaFila('p1', 'private_reply', { criado: '01', tentativas: 7, pubFail: '@ana me chama' });
    await drainIgQueue();
    expect(linha('p1').status).toBe('failed');
    expect(linha('p1').erro).toContain('limite_meta_esgotado');
    expect(publicasNaFila()).toHaveLength(0);
  });

  it('erro comum (janela fechada, code 10) segue o caminho de hoje: failed + "me chama no direct" público', async () => {
    h.erro = () => erroMeta(10, 403);
    linhaFila('p1', 'private_reply', { origem: 'anuncio', criado: '01', pubFail: '@ana me chama no direct' });
    const r = await drainIgQueue();
    expect(linha('p1').status).toBe('failed');
    expect(publicasNaFila()[0].payload.text).toBe('@ana me chama no direct');
    expect(r).toMatchObject({ enviados: 0 });
    expect(r.adiados).toBeUndefined();
  });

  it('erro incerto (500/code 1) segue igual: status incerto, sem reenvio e sem comentário público', async () => {
    h.erro = () => erroMeta(1, 500);
    linhaFila('p1', 'private_reply', { criado: '01', pubFail: '@ana me chama' });
    const r = await drainIgQueue();
    expect(linha('p1').status).toBe('incerto');
    expect(r).toMatchObject({ incertos: 1 });
    expect(publicasNaFila()).toHaveLength(0);
  });
});

describe('falha definitiva solta a reserva de 7 dias da pessoa', () => {
  const erroMeta = (code: number, http = 400) => new Error(`sendMessage ${http}: {"error":{"message":"x","type":"OAuthException","code":${code}}}`);
  const chave = chaveRespostaPessoaIg('a1', 'P1');
  const chaveOutra = chaveRespostaPessoaIg('a1', 'P2');
  const reservas = () => (banco.tabelas.system_state ?? []).filter(r => String(r.key).startsWith('ig_auto:')).map(r => r.key);
  const reservar = () => { (banco.tabelas.system_state ??= []).push({ key: chave, value: 'x', updated_at: new Date().toISOString() }, { key: chaveOutra, value: 'x', updated_at: new Date().toISOString() }); };

  it('(a) 8ª tentativa por limite da Meta: apaga só a chave da pessoa', async () => {
    reservar();
    h.erro = () => erroMeta(4);
    linhaFila('p1', 'private_reply', { criado: '01', tentativas: 7, pubFail: '@ana me chama', reserva: chave });
    await drainIgQueue();
    expect(linha('p1').erro).toContain('limite_meta_esgotado');
    expect(reservas()).toEqual([chaveOutra]);
  });

  it('limite da Meta ainda com tentativas sobrando: a reserva fica (o item volta pra fila)', async () => {
    reservar();
    h.erro = () => erroMeta(4);
    linhaFila('p1', 'private_reply', { criado: '01', tentativas: 2, reserva: chave });
    await drainIgQueue();
    expect(linha('p1').status).toBe('pending');
    expect(reservas()).toEqual([chave, chaveOutra]);
  });

  it('(b) DM falhou e não há username (sem recado público): apaga a chave', async () => {
    reservar();
    h.erro = () => erroMeta(10, 403);
    linhaFila('p1', 'private_reply', { criado: '01', reserva: chave });
    await drainIgQueue();
    expect(linha('p1').status).toBe('failed');
    expect(publicasNaFila()).toHaveLength(0);
    expect(reservas()).toEqual([chaveOutra]);
  });

  it('DM falhou mas o recado público foi enfileirado: a reserva continua (a pessoa recebeu um aviso)', async () => {
    reservar();
    h.erro = () => erroMeta(10, 403);
    linhaFila('p1', 'private_reply', { criado: '01', pubFail: '@ana me chama', reserva: chave });
    await drainIgQueue();
    expect(publicasNaFila()).toHaveLength(1);
    expect(reservas()).toEqual([chave, chaveOutra]);
  });

  it('falha ao apagar a chave (erro de banco) só loga: a rodada segue e o item fica failed', async () => {
    reservar();
    banco.falha = (t, op) => (t === 'system_state' && op === 'delete' ? 'XX000' : null);
    h.erro = () => erroMeta(10, 403);
    linhaFila('p1', 'private_reply', { criado: '01', reserva: chave });
    linhaFila('p2', 'private_reply', { criado: '02' });
    h.erro = (alvo) => (alvo === 'p1' ? erroMeta(10, 403) : null);
    const r = await drainIgQueue();
    expect(linha('p1').status).toBe('failed');
    expect(linha('p2').status).toBe('sent');
    expect(r).toMatchObject({ enviados: 1 });
    expect(reservas()).toEqual([chave, chaveOutra]);
  });
});
