import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A abertura do quiz com a fila de agenda REAL (enfileirarAgenda e enviarAgendaPendente de verdade, sem trocar a função por um falso).
// Prova o desfazer com honestidade: a resposta do banco pode se perder DEPOIS de a gravação entrar, e aí a fila manda (nada é
// desfeito e sai 1 abertura); a posse que não sai segura a reserva (para o alarme acusar); a posse relida decide o resto.
// Só o que está FORA do código sob teste é falso: os dois bancos (em memória), a Z-API, a pausa humana e a supressão.
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  zapi: vi.fn(),
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));
vi.mock('../services/agents/zapiClient', () => ({
  solardocViaIo: () => false,
  linhaEmCooldown: () => false,
  sendHuman: (...a: unknown[]) => h.zapi(...a),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({ podeFalarComLead: async () => ({ pode: true, motivo: 'sem-pausa' }) }));
vi.mock('../services/agents/whatsapp/silenciar', async () => {
  const real = await vi.importActual<typeof import('../services/agents/whatsapp/silenciar')>('../services/agents/whatsapp/silenciar');
  return { ...real, estaBloqueado: async () => false, motivosDaSupressao: async () => [] };
});
vi.mock('../services/agentes5040/vivoEnvio', async () => {
  const real = await vi.importActual<typeof import('../services/agentes5040/vivoEnvio')>('../services/agentes5040/vivoEnvio');
  return { ...real, enviarResposta: (...a: unknown[]) => h.enviar(...a) };
});
vi.mock('../services/agentes5040/fichaEnvio', async () => {
  const real = await vi.importActual<typeof import('../services/agentes5040/fichaEnvio')>('../services/agentes5040/fichaEnvio');
  return {
    ...real,
    carregarTelefonesConsultores: async () => ({ ok: true, mapa: new Map([['diego', '34991360172']]) }),
    enviarFichaAoConsultor: async () => undefined,
    tetoDaLinhaPermiteFicha: async () => 'ok',
  };
});

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { runVivoTick } from '../services/agentes5040/vivo';
import { enviarAgendaPendente, TEMPOS_AGENDA, chaveFila } from '../services/agentes5040/agendaEnvio';
import { desfazerPosseNova, TIPO_POSSE } from '../services/agentes5040/posse';
import { CHAVE_VIVO_ALVO, zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { logger } from '../utils/logger';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MIN = 60_000;
const QUANDO = '2026-10-21T17:30:00.000Z';                                // amanhã, 14h30 em Brasília
const TEL = '5534991100100';
const CHAVE = '3491100100';
const ERRO_BANCO = { code: '57014', message: 'cancelado' };

let banco: BancoFalso;
let gerador: BancoFalso;

const cardNoBanco = () => gerador.tabelas.agendamentos!.find(c => c.id === 500)!;
const posses = () => (banco.tabelas.whatsapp_sessions ?? []).filter(l => l.phone === CHAVE && l.tipo === TIPO_POSSE);
const chavesFila = () => (banco.tabelas.system_state ?? []).map(l => String(l.key)).filter(k => k.startsWith('ag5040_agenda_fila:'));
const dedupDoCard = () => (banco.tabelas.system_state ?? []).map(l => String(l.key)).filter(k => k.startsWith('solar_bv_dedup:'));

function semear() {
  gerador.tabelas.agendamentos = [{
    id: 500, cliente_nome: 'Irineu de Almeida', cliente_telefone: TEL, quando: QUANDO, vendedor_nome: 'Giovanna Souza',
    observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: R$ 600', created_by: 'lp_solar', status: 'agendado',
    created_at: iso(2 * MIN), boas_vindas_at: null,
  }];
  banco.tabelas.system_state = [
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)!], modos: {}, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

type Gancho = (q: any, nome: string) => void;
/** Embrulha o from() do banco para mexer em UMA operação sem trocar a função de negócio. */
function embrulhar(b: BancoFalso, gancho: Gancho) {
  const orig = b.cliente.from;
  b.cliente.from = (nome: string) => { const q = orig(nome); gancho(q, nome); return q; };
}
/** A operação roda de verdade e a resposta que chega é um erro (a gravação entrou, a resposta se perdeu). */
const perdeResposta = (b: any) => { const real = b.then; b.then = (ok: any, ko: any) => real.call(b, (x: any) => x).then(() => ({ data: null, error: ERRO_BANCO })).then(ok, ko); };
/** A operação nem chega ao banco: erro e nada gravado. */
const naoGrava = (b: any) => { b.then = (ok: any, ko: any) => Promise.resolve({ data: null, error: ERRO_BANCO }).then(ok, ko); };

const rodar = () => runVivoTick({ agora: AGORA, cliente: iaFalsa(() => respostaIA(saidaJson(['x']))).cliente });

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.enviar.mockReset().mockResolvedValue({ ok: false, motivo: 'dry' });
  h.zapi.mockReset().mockResolvedValue(undefined);
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  zerarCacheArmazem(); zerarCacheInterruptores();
  TEMPOS_AGENDA.esperar = async () => undefined;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(logger.error).mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  semear();
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_DUDA_VIVO;
});

describe('abertura com a fila real: o enfileirar respondeu erro', () => {
  it('a gravação ENTROU e a resposta se perdeu: nada é desfeito (nem reserva nem posse) e sai 1 abertura', async () => {
    embrulhar(banco, (q, nome) => {
      if (nome !== 'system_state') return;
      const up = q.upsert;
      q.upsert = (p: any, o: any) => { const b = up(p, o); if (String(p?.key).startsWith('ag5040_agenda_fila:')) perdeResposta(b); return b; };
    });
    const r = await rodar();
    expect(r.abertura).toMatchObject({ tentados: 1, abertos: 1, puladas: { fila_gravou_e_respondeu_erro: 1 } });
    expect(cardNoBanco().boas_vindas_at).toBeTruthy();
    expect(posses()).toHaveLength(1);
    expect(posses()[0]!.lead_data).toMatchObject({ dona: 'duda', estado: 'viva' });
    expect(chavesFila()).toEqual([chaveFila(500, 'abertura', QUANDO)]);
    // a fila entrega: 1 bolha, a abertura
    const e = await enviarAgendaPendente(AGORA);
    expect(e).toMatchObject({ enviadas: 1, descartadas: 0 });
    expect(h.zapi).toHaveBeenCalledTimes(1);
    expect(String(h.zapi.mock.calls[0]![1][0])).toMatch(/^Oi, Irineu! Sou a Duda/);
    // e a rodada seguinte não abre de novo (o card está reservado e a conversa tem posse)
    const r2 = await rodar();
    expect(r2.abertura!.abertos).toBe(0);
    expect(h.zapi).toHaveBeenCalledTimes(1);
    expect(chavesFila()).toEqual([]);
  });

  it('a releitura da fila FALHOU: não desfaz nada (a fila pode ter gravado) e registra', async () => {
    embrulhar(banco, (q, nome) => {
      if (nome !== 'system_state') return;
      const up = q.upsert;
      q.upsert = (p: any, o: any) => { const b = up(p, o); if (String(p?.key).startsWith('ag5040_agenda_fila:')) perdeResposta(b); return b; };
      const eq = q.eq;
      q.eq = (c: string, v: unknown) => { const b = eq(c, v); if (c === 'key' && String(v).startsWith('ag5040_agenda_fila:')) naoGrava(b); return b; };
    });
    const r = await rodar();
    expect(r.abertura).toMatchObject({ tentados: 1, abertos: 0, puladas: { fila_incerta: 1 } });
    expect(cardNoBanco().boas_vindas_at).toBeTruthy();
    expect(posses()).toHaveLength(1);
    expect(vi.mocked(logger.error).mock.calls.some(([, m]) => String(m).includes('reserva e posse ficam'))).toBe(true);
  });

  it('a gravação NÃO entrou e a releitura confirma: desfaz a posse e devolve a reserva', async () => {
    embrulhar(banco, (q, nome) => {
      if (nome !== 'system_state') return;
      const up = q.upsert;
      q.upsert = (p: any, o: any) => { const b = up(p, o); if (String(p?.key).startsWith('ag5040_agenda_fila:')) naoGrava(b); return b; };
    });
    const r = await rodar();
    expect(r.abertura).toMatchObject({ tentados: 1, abertos: 0, puladas: { fila_recusou_erro: 1 } });
    expect(cardNoBanco().boas_vindas_at).toBeNull();
    expect(posses()).toHaveLength(0);
    expect(chavesFila()).toEqual([]);
  });

  it('a fila recusou e a posse NÃO saiu (o DELETE falhou): a reserva FICA, para o alarme acusar', async () => {
    embrulhar(banco, (q, nome) => {
      if (nome === 'system_state') {
        const up = q.upsert;
        q.upsert = (p: any, o: any) => { const b = up(p, o); if (String(p?.key).startsWith('ag5040_agenda_fila:')) naoGrava(b); return b; };
      }
      if (nome === 'whatsapp_sessions') { const del = q.delete; q.delete = () => { const b = del(); naoGrava(b); return b; }; }
    });
    const r = await rodar();
    expect(r.abertura!.puladas).toEqual({ fila_recusou_erro_posse_ficou: 1 });
    expect(cardNoBanco().boas_vindas_at).toBeTruthy();
    expect(posses()).toHaveLength(1);
    expect(vi.mocked(logger.error).mock.calls.some(([, m]) => String(m).includes('a reserva fica para o alarme acusar'))).toBe(true);
  });
});

describe('abertura com a fila real: o assumirPosse respondeu erro', () => {
  const insercaoDaPosse = (como: 'perde' | 'nao-grava', antes?: () => void) => embrulhar(banco, (q, nome) => {
    if (nome !== 'whatsapp_sessions') return;
    const ins = q.insert;
    q.insert = (p: any) => { antes?.(); const b = ins(p); (como === 'perde' ? perdeResposta : naoGrava)(b); return b; };
  });

  it('o INSERT entrou e a resposta se perdeu; a releitura acha a posse da Duda: segue para a fila', async () => {
    insercaoDaPosse('perde');
    const r = await rodar();
    expect(r.abertura).toMatchObject({ tentados: 1, abertos: 1, puladas: {} });
    expect(posses()).toHaveLength(1);
    expect(chavesFila()).toEqual([chaveFila(500, 'abertura', QUANDO)]);
    expect(cardNoBanco().boas_vindas_at).toBeTruthy();
  });

  it('o INSERT não entrou e a releitura não acha posse: devolve a reserva e não enfileira', async () => {
    insercaoDaPosse('nao-grava');
    const r = await rodar();
    expect(r.abertura!.puladas).toEqual({ posse_falhou: 1 });
    expect(cardNoBanco().boas_vindas_at).toBeNull();
    expect(posses()).toHaveLength(0);
    expect(chavesFila()).toEqual([]);
  });

  it('a releitura da posse falhou: a reserva fica e nada é enfileirado', async () => {
    let tentou = false;
    insercaoDaPosse('nao-grava', () => { tentou = true; });
    embrulhar(banco, (q, nome) => {
      if (nome !== 'whatsapp_sessions') return;
      const sel = q.select;
      q.select = (...a: unknown[]) => { const b = sel(...a); if (tentou) naoGrava(b); return b; };
    });
    const r = await rodar();
    expect(r.abertura!.puladas).toEqual({ posse_incerta: 1 });
    expect(cardNoBanco().boas_vindas_at).toBeTruthy();
    expect(chavesFila()).toEqual([]);
    expect(vi.mocked(logger.error).mock.calls.some(([, m]) => String(m).includes('a reserva fica e nada é enfileirado'))).toBe(true);
  });

  it('a releitura acha posse de OUTRA dona (nasceu entre a leitura e o INSERT): devolve a reserva e não enfileira', async () => {
    insercaoDaPosse('nao-grava', () => {
      (banco.tabelas.whatsapp_sessions ??= []).push({
        phone: CHAVE, tipo: TIPO_POSSE, lead_data: { dona: 'helena', estado: 'viva', desde: iso(MIN), ate_wa_id: 1, respostas: 0, imagens: [], links: [] },
      });
    });
    const r = await rodar();
    expect(r.abertura!.puladas).toEqual({ posse_tomada_agora: 1 });
    expect(cardNoBanco().boas_vindas_at).toBeNull();
    expect(chavesFila()).toEqual([]);
    expect(posses()).toHaveLength(1);                                       // a posse da Helena fica, intacta
    expect(posses()[0]!.lead_data.dona).toBe('helena');
  });

  it('posse da Duda com OUTRA âncora (não é a desta rodada): tratada como posse tomada, a reserva volta', async () => {
    insercaoDaPosse('nao-grava', () => {
      (banco.tabelas.whatsapp_sessions ??= []).push({
        phone: CHAVE, tipo: TIPO_POSSE, lead_data: { dona: 'duda', estado: 'viva', desde: iso(5 * MIN), ate_wa_id: null, respostas: 0, imagens: [], links: [] },
      });
    });
    const r = await rodar();
    expect(r.abertura!.puladas).toEqual({ posse_tomada_agora: 1 });
    expect(cardNoBanco().boas_vindas_at).toBeNull();
    expect(chavesFila()).toEqual([]);
  });
});

describe('desfazerPosseNova só apaga a posse que esta chamada criou', () => {
  const lead = (dona: string, desde: string) => ({ dona, estado: 'viva', desde, ate_wa_id: null, respostas: 0, imagens: [], links: [] });
  const DESDE = '2026-10-20T15:00:00.000Z';

  it('mesma dona e mesmo desde: apaga e devolve true', async () => {
    banco.tabelas.whatsapp_sessions = [{ phone: CHAVE, tipo: TIPO_POSSE, lead_data: lead('duda', DESDE) }];
    expect(await desfazerPosseNova(TEL, 'duda', DESDE)).toBe(true);
    expect(posses()).toHaveLength(0);
  });

  it('o mesmo desde mas de OUTRA dona: não apaga', async () => {
    banco.tabelas.whatsapp_sessions = [{ phone: CHAVE, tipo: TIPO_POSSE, lead_data: lead('helena', DESDE) }];
    expect(await desfazerPosseNova(TEL, 'duda', DESDE)).toBe(true);        // a chamada correu sem erro; não havia o que apagar
    expect(posses()).toHaveLength(1);
    expect(posses()[0]!.lead_data.dona).toBe('helena');
  });

  it('a mesma dona com OUTRO desde (a posse é mais nova ou mais velha): não apaga', async () => {
    banco.tabelas.whatsapp_sessions = [{ phone: CHAVE, tipo: TIPO_POSSE, lead_data: lead('duda', '2026-10-20T14:00:00.000Z') }];
    expect(await desfazerPosseNova(TEL, 'duda', DESDE)).toBe(true);
    expect(posses()).toHaveLength(1);
    expect(posses()[0]!.lead_data.desde).toBe('2026-10-20T14:00:00.000Z');
  });

  it('posse de outro telefone ou de outro tipo de sessão não é tocada', async () => {
    banco.tabelas.whatsapp_sessions = [
      { phone: '3499999999', tipo: TIPO_POSSE, lead_data: lead('duda', DESDE) },
      { phone: CHAVE, tipo: 'bia', lead_data: lead('duda', DESDE) },
    ];
    await desfazerPosseNova(TEL, 'duda', DESDE);
    expect(banco.tabelas.whatsapp_sessions).toHaveLength(2);
  });

  it('erro do banco ou telefone sem chave devolve false (sem lançar)', async () => {
    banco.falhar.whatsapp_sessions = { code: '57014' };
    expect(await desfazerPosseNova(TEL, 'duda', DESDE)).toBe(false);
    banco.falhar.whatsapp_sessions = undefined;
    expect(await desfazerPosseNova('12', 'duda', DESDE)).toBe(false);
  });
});

describe('o marcador do alarme não nasce no caminho feliz', () => {
  it('abertura enfileirada e entregue não deixa solar_bv_dedup', async () => {
    await rodar();
    await enviarAgendaPendente(AGORA);
    expect(dedupDoCard()).toEqual([]);
  });
});
