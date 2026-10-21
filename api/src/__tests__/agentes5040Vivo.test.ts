import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A rodada viva (B1c-3). Banco falso em memória, IA falsa, e as duas saídas (vivoEnvio e fichaEnvio) trocadas por
// mocks que contam chamadas: nada aqui alcança a rede.
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
  cooldown: false,
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ enviarResposta: (...a: unknown[]) => h.enviar(...a) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: async () => ({ ok: true, mapa: new Map([['diego', '34991360172']]) }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: (e: any) => /em cooldown|credenciais Z-API ausentes/i.test(String(e?.message ?? e)),
  linhaIoEmCooldown: () => h.cooldown,
  telefoneDoConsultor: (m: Map<string, string>, n: string) => m.get(String(n ?? '').trim().toLowerCase().split(' ')[0]!) ?? null,
  telefoneDoDono: () => '34900000000',
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { BOLHA_PASSAGEM_AGENDA, BOLHA_PASSAGEM_GENERICA, CHAVE_TRAVA, runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);                                      // 2 min antes: passou da rajada, dentro dos 15 min
const DESDE_POSSE = iso(10 * 60_000);
const FALA_DUDA = 'Aqui é a Duda, da Irmãos na Obra. Qual é o valor da sua conta de luz?';

// i-ésimo lead: telefone de 13 dígitos (com o nono) e a chave de 10 (DDD + 8 últimos), que é a da posse
const telDe = (i: number): string => `55349911${String(1000 + i).padStart(5, '0')}`;
const chaveDe = (i: number): string => `34${telDe(i).slice(-8)}`;
const TEL = telDe(0);
const CHAVE = chaveDe(0);

let banco: BancoFalso;
let gerador: BancoFalso;

const linhaLead = (id: number, tel: string, momento: string, extra: Record<string, unknown> = {}) =>
  ({ id, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Quero saber de energia solar', momment: momento, ...extra });

const linhaNossa = (id: number, tel: string, momento: string, api: boolean | null) =>
  ({ id, instancia: 'inst-io', telefone: tel, is_group: false, from_me: true, from_api: api, tipo: 'texto', texto: 'Oi, tudo bem?', momment: momento });

function semearLead(i = 0, opts: { momento?: string; posse?: Record<string, unknown> | null; dona?: string; extraMsgs?: any[]; id?: number } = {}) {
  const tel = telDe(i); const chave = chaveDe(i); const id = opts.id ?? 10 + i;
  (banco.tabelas.wa_mensagens ??= []).push(linhaLead(id, tel, opts.momento ?? MOMENTO_LEAD), ...(opts.extraMsgs ?? []));
  if (opts.posse !== null) {
    (banco.tabelas.whatsapp_sessions ??= []).push({
      phone: chave, tipo: 'ag5040',
      lead_data: { dona: opts.dona ?? 'duda', estado: 'viva', desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [], ...(opts.posse ?? {}) },
    });
  }
}

function alvo(hmacs: string[], modos: Record<string, string> = {}) {
  banco.tabelas.system_state = [
    ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs, modos, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

const posseDe = (i = 0) => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === chaveDe(i) && l.tipo === 'ag5040')!.lead_data as Record<string, any>;
const chavesDoEstado = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);
const turnosGravados = (): string[] => [...banco.objetos.keys()].filter(k => k.startsWith('turnos/'));

const responder = (bolhas = [FALA_DUDA], extra: Record<string, unknown> = {}) =>
  iaFalsa(() => respostaIA(saidaJson(bolhas, extra), { cache_creation_input_tokens: 100 }));
let ia = responder();
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.cooldown = false;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry ? { ok: false, motivo: 'dry' } : { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  zerarCacheArmazem(); zerarCacheInterruptores();
  ia = responder();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_DUDA_VIVO;
  (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0;
});

describe('rodada viva: interruptor, trava e prazo', () => {
  it('nada ligado (env) = zero leitura de banco, zero modelo, zero envio', async () => {
    process.env.AGENTES5040_DUDA_VIVO = '0';
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const antes = banco.leituras.length;
    const r = await rodar();
    expect(r.ligado).toBe(false);
    expect(banco.leituras.length).toBe(antes);
    expect(gerador.leituras).toEqual([]);
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(banco.escritas).toEqual([]);
  });

  it('helena_vivo e carla_vivo ligados sozinhos não ligam nada nesta fase', async () => {
    process.env.AGENTES5040_DUDA_VIVO = '0';
    process.env.AGENTES5040_HELENA_VIVO = '1'; process.env.AGENTES5040_CARLA_VIVO = '1';
    semearLead(0, { dona: 'helena' }); alvo([hmacDe(CHAVE)!]);
    const antes = banco.leituras.length;
    const r = await rodar();
    expect(r.ligado).toBe(false);
    expect(banco.leituras.length).toBe(antes);
    expect(h.enviar).not.toHaveBeenCalled();
    delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  });

  it('sem env e sem a chave do banco = desligado: a única leitura é a dos interruptores', async () => {
    delete process.env.AGENTES5040_DUDA_VIVO;
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const antes = banco.leituras.length;
    const r = await rodar();
    expect(r.ligado).toBe(false);
    expect(banco.leituras.slice(antes)).toEqual(['system_state']);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('trava tomada e dentro da validade = sai sem ler a conversa nem gastar modelo; trava expirada (300 s) pode ser tomada e é solta no fim', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    banco.tabelas.system_state!.push({ key: CHAVE_TRAVA, value: { em: iso(10_000) }, updated_at: iso(10_000) });
    const leiturasAntes = banco.leituras.filter(t => t === 'wa_mensagens').length;
    const r1 = await rodar();
    expect(r1.ocupada).toBe(true);
    expect(banco.leituras.filter(t => t === 'wa_mensagens').length).toBe(leiturasAntes);
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(chavesDoEstado()).toContain(CHAVE_TRAVA);

    banco.tabelas.system_state!.find(l => l.key === CHAVE_TRAVA)!.updated_at = iso(301_000);
    const r2 = await rodar();
    expect(r2.ocupada).toBeUndefined();
    expect(r2.enviadas).toBe(1);
    expect(chavesDoEstado()).not.toContain(CHAVE_TRAVA);          // liberada no fim
  });

  it('a trava é solta no fim da rodada normal e também quando a rodada falha no meio', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    banco.falhar.whatsapp_sessions = { code: '57014' };            // a leitura das posses quebra
    const r = await rodar();
    expect(r.ok).toBe(false);
    expect(chavesDoEstado()).not.toContain(CHAVE_TRAVA);
  });

  it('o dry não toma a trava', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    await rodar({ dry: true });
    expect(banco.escritas.some(e => e.tabela === 'system_state' && (e.chaves ?? []).includes(CHAVE_TRAVA))).toBe(false);
  });
});

describe('rodada viva: o caminho feliz', () => {
  it('responde pelo número da fala (nunca pela chave da posse), atualiza a posse e grava o turno com enviado', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(r.ok).toBe(true);
    expect(r.enviadas).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const pedido = h.enviar.mock.calls[0]![0];
    expect(pedido).toMatchObject({ dona: 'duda', telefone: TEL, waIdAlvo: 10, momentoFalaLead: MOMENTO_LEAD, bolha: FALA_DUDA, dry: false });
    expect(pedido.telefone).not.toBe(CHAVE);
    expect(pedido.peca).toBeUndefined();
    expect(posseDe()).toMatchObject({ estado: 'viva', ate_wa_id: 10, respostas: 1 });
    expect(chavesDoEstado()).toContain('ag5040_vez_vivo:10');
    const caminho = turnosGravados()[0]!;
    const t = JSON.parse(banco.objetos.get(caminho)!);
    expect(t).toMatchObject({ origem: 'vivo', wa_id: 10, persona: 'duda', falou: true, enviado: true, bolhas: [FALA_DUDA] });
    // relatório sem telefone
    expect(JSON.stringify(r)).not.toContain(TEL);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('a mesma fala não é respondida duas vezes (a posse já avançou)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    await rodar();
    const r2 = await rodar();
    expect(r2.enviadas).toBe(0);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(r2.puladas.ja_atendida).toBe(1);
  });

  it('LID: o número sai do mapa de LID', async () => {
    const lid = '123456789012345';
    banco.tabelas.wa_lid_telefone = [{ lid, telefone: TEL, chave: CHAVE }];
    banco.tabelas.wa_mensagens = [linhaLead(10, lid, MOMENTO_LEAD)];
    banco.tabelas.whatsapp_sessions = [{ phone: CHAVE, tipo: 'ag5040', lead_data: { dona: 'duda', estado: 'viva', desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [] } }];
    alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.enviar.mock.calls[0]![0].telefone).toBe(TEL);
  });

  it('link: a 2ª bolha vai como peça', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([FALA_DUDA.replace('Qual é o valor da sua conta de luz?', 'Dá para simular pelo site.'), 'https://solardoc.app/gerador'], { peca: { tipo: 'link', id: 'simulador' } });
    await rodar();
    const pedido = h.enviar.mock.calls[0]?.[0];
    expect(pedido?.peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/gerador' });
  });
});

describe('rodada viva: quem entra na fila', () => {
  it('4 conversas elegíveis = só 3 por rodada', async () => {
    (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).push('duda');
    for (let i = 0; i < 4; i++) semearLead(i, { momento: iso((10 - i) * 60_000) });
    alvo([], { duda: 'todos' });
    const r = await rodar();
    expect(r.elegiveis).toBe(4);
    expect(r.processadas).toBe(3);
    expect(ia.chamadas).toHaveLength(3);
    expect(h.enviar).toHaveBeenCalledTimes(3);
    expect(r.puladas.limite_de_conversas).toBe(1);
    // as 3 mais antigas foram atendidas; a mais nova fica para a próxima rodada
    expect(posseDe(3).ate_wa_id).toBeNull();
    expect(posseDe(0).ate_wa_id).toBe(10);
  });

  it('só dona ligada E no escopo: lead fora do alvo não é atendido, e o do alvo sim', async () => {
    semearLead(0); semearLead(1);
    alvo([hmacDe(chaveDe(1))!]);
    const r = await rodar();
    expect(r.puladas.fora_do_escopo).toBe(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].telefone).toBe(telDe(1));
  });

  it('posse de helena e de carla é ignorada na rodada; posse que não é viva também', async () => {
    semearLead(0, { dona: 'helena' }); semearLead(1, { dona: 'carla' }); semearLead(2, { posse: { estado: 'passou_humano' } }); semearLead(3, { posse: null });
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!, hmacDe(chaveDe(2))!]);
    const r = await rodar();
    expect(r.puladas.dona_fora_da_rodada).toBe(2);
    expect(r.puladas.sem_posse_viva).toBe(2);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(0);
  });

  it('rajada: fala de 20 s atrás espera; fala de 2 min responde', async () => {
    semearLead(0, { momento: iso(20_000) }); semearLead(1);
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!]);
    const r = await rodar();
    expect(r.puladas.rajada).toBe(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('ate_wa_id null: âncora em posse.desde com folga de 15 min. Fala de mais de 15 min antes da posse não conta; poll atrasado 3 min ainda responde', async () => {
    const desde = iso(60_000);
    semearLead(0, { momento: iso(30 * 60_000), posse: { desde } });                      // 29 min antes da posse: velha
    semearLead(1, { momento: iso(4 * 60_000), posse: { desde } });                       // poll atrasado 3 min: a fala que abriu a conversa
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!]);
    const r = await rodar();
    expect(r.puladas.fala_antes_da_posse).toBe(1);
    expect(r.enviadas).toBe(1);
    expect(h.enviar.mock.calls.map(c => c[0].waIdAlvo)).toEqual([11]);
  });

  it('poll atrasado: fala que abriu a conversa e uma mensagem NOSSA depois dela = não é respondida', async () => {
    const desde = iso(60_000);
    semearLead(0, { momento: iso(4 * 60_000), posse: { desde }, extraMsgs: [linhaNossa(40, telDe(0), iso(3 * 60_000), false)] });
    alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(r.puladas.ja_respondida_por_nos).toBe(1);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(0);
  });

  it('recusa que passa (teto, linha pausada) solta a vez; recusa que fica (mudo, pausa humana) não fala e marca a fala como vista', async () => {
    semearLead(0); semearLead(1);
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!]);
    h.enviar.mockImplementationOnce(async () => ({ ok: false, motivo: 'teto_agentes', detalhe: 'hora:20' }))
      .mockImplementationOnce(async () => ({ ok: false, motivo: 'mudo', detalhe: 'opt_out' }));
    const r = await rodar();
    expect(r.enviadas).toBe(0);
    expect(chavesDoEstado()).not.toContain('ag5040_vez_vivo:10');
    expect(posseDe(0).ate_wa_id).toBeNull();
    expect(posseDe(1).ate_wa_id).toBe(11);
    expect(r.decisoes.map(d => d.resultado)).toEqual(['recusada', 'recusada']);
    expect(h.ficha).not.toHaveBeenCalled();
  });

  it("'erro_linha' deixa a vez (o carimbo já existe) e a posse como está", async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'erro_linha', detalhe: 'timeout' }));
    await rodar();
    expect(chavesDoEstado()).toContain('ag5040_vez_vivo:10');
    expect(posseDe().ate_wa_id).toBeNull();
  });

  it("'erro_linha' PARA a rodada inteira: a 2ª conversa não é tentada nem gasta modelo", async () => {
    semearLead(0); semearLead(1);
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!]);
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'erro_linha', detalhe: 'http_500' }));
    const r = await rodar();
    expect(r.parou).toBe('erro_linha');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(ia.chamadas).toHaveLength(1);
    expect(chavesDoEstado()).not.toContain('ag5040_vez_vivo:11');
    expect(posseDe(1).ate_wa_id).toBeNull();
  });

  it("'pediu_humano' (supressão do telefone): ficha ao consultor, SEM bolha, posse passa ao humano", async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'pediu_humano' }));
    const r = await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('pediu para falar com uma pessoa');
    expect(h.enviar).toHaveBeenCalledTimes(1);                          // só a tentativa da fala; nenhuma bolha fixa
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10, respostas: 0 });
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passou_ao_humano', ficha: 'enviada', n_bolhas: 0 });
  });

  it("'bolha_invalida' vira a trava sem fala segura: ficha e, só porque a ficha saiu, a bolha fixa genérica", async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockImplementationOnce(async () => ({ ok: false, motivo: 'bolha_invalida', detalhe: 'travessao' }));
    const r = await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(2);
    expect(h.enviar.mock.calls[1]![0].bolha).toBe(BOLHA_PASSAGEM_GENERICA);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passou_ao_humano', ficha: 'enviada' });
    expect(JSON.parse(banco.objetos.get(turnosGravados()[0]!)!)).toMatchObject({ enviado: false, motivo_silencio: 'bolha_invalida' });
  });

  it("'bolha_invalida' com a ficha em cooldown: nenhuma bolha e a posse segue viva para a próxima rodada", async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'bolha_invalida', detalhe: 'passa_de_160' }));
    h.cooldown = true;
    await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(posseDe().estado).toBe('viva');
  });

  it('fala com mais de 15 min = passou_humano com ficha, SEM bolha e sem gastar modelo', async () => {
    semearLead(0, { momento: iso(20 * 60_000), posse: { desde: iso(30 * 60_000) } });
    alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passou_ao_humano', ficha: 'enviada' });
  });

  it("'prazo' devolvido pelo envio (passou de 15 min durante o modelo) = passou_humano, sem bolha", async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'prazo', detalhe: 'passou_de_15min' }));
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);                      // só a tentativa da fala; nenhuma bolha de passagem
    expect(posseDe().estado).toBe('passou_humano');
  });

  it('10 respostas na posse = passou_humano com ficha e a bolha fixa, sem modelo', async () => {
    semearLead(0, { posse: { respostas: 10, ate_wa_id: 3 } }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ bolha: BOLHA_PASSAGEM_GENERICA, telefone: TEL });
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
  });
});

describe('rodada viva: ação que exige ferramenta, não incomodar e falha de IA', () => {
  it('ligar_agora: ficha primeiro, depois a bolha FIXA (a do modelo nunca vai); passou_humano', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder(['Combinado. Já avisei a consultora e ela te liga em instantes. Se ela não puder agora, te volto aqui com um horário.'], { acao: 'ligar_agora' });
    const r = await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34900000000');            // card sem consultor: vai ao dono
    expect(String(h.ficha.mock.calls[0]![1])).toContain('Card sem consultor dono.');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_GENERICA);
    expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
    expect(r.decisoes[0]).toMatchObject({ acao: 'ligar_agora', resultado: 'passou_ao_humano', ficha: 'enviada' });
    expect(chavesDoEstado().some(k => k.startsWith('ficha_lead:'))).toBe(true);
  });

  it('as bolhas fixas: agenda para marcar; a genérica para ligar e passar; as duas cabem no envio', async () => {
    expect(BOLHA_PASSAGEM_GENERICA).toBe('Vou deixar a consultora cuidar daqui. Já mandei a nossa conversa toda pra ela, e ela te responde por aqui mesmo em breve.');
    expect(BOLHA_PASSAGEM_AGENDA).toBe('Pra acertar o horário, a consultora fala com você. Já mandei a nossa conversa pra ela, e ela te chama por aqui em breve.');
    for (const b of [BOLHA_PASSAGEM_GENERICA, BOLHA_PASSAGEM_AGENDA]) {
      expect(b.length).toBeLessThanOrEqual(160);
      expect(b).not.toMatch(/[—–]/);
      expect(b).not.toContain('||');
    }
    // Só as ações do enum da Duda chegam aqui (remarcar_horario, suporte e confirmar presença seguem a mesma regra no código).
    const casos: Array<[string, string]> = [
      ['marcar_horario', BOLHA_PASSAGEM_AGENDA],
      ['ligar_agora', BOLHA_PASSAGEM_GENERICA], ['passar_carla', BOLHA_PASSAGEM_GENERICA], ['passar_helena', BOLHA_PASSAGEM_GENERICA],
    ];
    for (const [acao, esperada] of casos) {
      banco = novoBanco(); h.principal = banco; gerador = novoBanco(); h.gerador = gerador;
      h.enviar.mockClear(); h.ficha.mockClear();
      semearLead(); alvo([hmacDe(CHAVE)!]);
      ia = responder(['Marcado: amanhã, quarta, às 9h. Se precisar mudar, é só me chamar aqui.'], { acao, ...(acao === 'marcar_horario' ? { dados: { horario: 'amanhã, quarta, às 9h' } } : {}) });
      await rodar();
      expect(h.enviar, acao).toHaveBeenCalledTimes(1);
      expect(h.enviar.mock.calls[0]![0].bolha, acao).toBe(esperada);
    }
  });

  it('o consultor do card recebe a ficha (e o contato leva o número completo)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    gerador.tabelas.agendamentos = [{ id: 7, cliente_telefone: TEL, cliente_nome: 'Tadeu Souza', vendedor_nome: 'Diego Souza', status: 'agendado', created_by: 'lp_solar', created_at: iso(86_400_000), quando: '2026-10-22T13:00:00Z', cidade: 'Araguari', observacao: null }];
    ia = responder([], { acao: 'passar_helena' });
    await rodar();
    expect(h.ficha.mock.calls[0]![0]).toBe('34991360172');
    expect(String(h.ficha.mock.calls[0]![1])).toContain(`wa.me/${TEL}`);
  });

  it('ficha que falhou (incerta) = nenhuma bolha; passou_humano para não mandar duas', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([], { acao: 'passar_helena' });
    h.ficha.mockRejectedValue(new Error('timeout'));
    const r = await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('passou_humano');
    expect(r.decisoes[0]).toMatchObject({ ficha: 'falhou' });
  });

  it('ficha que PROVOU não sair (cooldown) = desfaz a reserva, posse segue viva, nenhuma bolha', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([], { acao: 'passar_helena' });
    h.ficha.mockRejectedValue(new Error('linha io em cooldown'));
    const r = await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    expect(chavesDoEstado().some(k => k.startsWith('ficha_lead:'))).toBe(false);
    expect(r.decisoes[0]).toMatchObject({ ficha: 'adiada' });
  });

  it('linha em cooldown antes de mandar a ficha: nada é reservado e nenhuma bolha sai', async () => {
    semearLead(0, { momento: iso(20 * 60_000) }); alvo([hmacDe(CHAVE)!]);
    h.cooldown = true;
    await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(chavesDoEstado().some(k => k.startsWith('ficha_lead:'))).toBe(false);
    expect(posseDe().estado).toBe('viva');
  });

  it('ficha já reservada para esta fala = passou_humano sem ficha nova e sem bolha', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([], { acao: 'passar_helena' });
    banco.tabelas.system_state!.push({ key: `ficha_lead:${hmacDe(`${CHAVE}|vivo|10`)}`, value: { estado: 'enviada' } });
    const r = await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('passou_humano');
    expect(r.decisoes[0]).toMatchObject({ ficha: 'lead_ja_avisado' });
  });

  it('bolha de passagem recusada pelo envio: a ficha já saiu, a posse passa ao humano mesmo assim', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([], { acao: 'passar_helena' });
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'pausa_humana' }));
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', respostas: 0 });
  });

  it('não incomodar: despedida pelo envio ANTES do silêncio; depois silencia pelo número completo e a posse fica nao_incomodar', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder(['Tudo bem, não te chamo mais. Obrigada pela atenção.'], { acao: 'nao_incomodar' });
    let suprimidosNaHoraDoEnvio = -1;
    h.enviar.mockImplementation(async () => {
      suprimidosNaHoraDoEnvio = (banco.tabelas.whatsapp_suppression ?? []).length;
      return { ok: true, enviadas: 1, carimbos: [] };
    });
    await rodar();
    expect(suprimidosNaHoraDoEnvio).toBe(0);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Tudo bem, não te chamo mais. Obrigada pela atenção.');
    expect(banco.tabelas.whatsapp_suppression).toEqual([expect.objectContaining({ phone: TEL, motivo: 'opt_out' })]);
    expect(posseDe().estado).toBe('nao_incomodar');
    expect(h.ficha).not.toHaveBeenCalled();
  });

  it('não incomodar com a despedida recusada: silencia e muda o estado do mesmo jeito', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder(['Tudo bem, não te chamo mais. Obrigada pela atenção.'], { acao: 'nao_incomodar' });
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'teto_linha', detalhe: 'hora:60' }));
    await rodar();
    expect(banco.tabelas.whatsapp_suppression).toHaveLength(1);
    expect(posseDe().estado).toBe('nao_incomodar');
  });

  it('calar: não fala, marca a fala como vista e grava o turno com enviado false', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([], { acao: 'calar' });
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().ate_wa_id).toBe(10);
    expect(JSON.parse(banco.objetos.get(turnosGravados()[0]!)!)).toMatchObject({ enviado: false });
  });

  it('falha de IA: nas 2 primeiras rodadas solta a vez e tenta de novo; na 3ª passa ao humano com ficha e a bolha fixa', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = iaFalsa(() => { throw new Error('400 invalid_request_error: bad request'); });
    for (const n of [1, 2]) {
      const r = await rodar();
      expect(r.puladas.ia_indisponivel, `rodada ${n}`).toBe(1);
      expect(h.ficha).not.toHaveBeenCalled();
      expect(posseDe().estado).toBe('viva');
      expect(chavesDoEstado()).not.toContain('ag5040_vez_vivo:10');
    }
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_GENERICA);
    expect(posseDe().estado).toBe('passou_humano');
    expect(chavesDoEstado().some(k => k.startsWith('ia_falha'))).toBe(false);
  });

  it('crédito/teto da IA para a rodada: solta a vez, não conta como falha e não passa ao humano', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    process.env.AGENTES5040_TETO_RESPOSTA = '1';
    banco.tabelas.system_state!.push({ key: `ag5040_ia:resposta:2026-10-20:1`, value: {} });
    const r = await rodar();
    delete process.env.AGENTES5040_TETO_RESPOSTA;
    expect(r.parou).toBe('teto');
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(chavesDoEstado()).not.toContain('ag5040_vez_vivo:10');
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_tent:'))).toBe(false);
  });
});

describe('rodada viva: o dry', () => {
  it('faz tudo menos reservar, enviar, atualizar a posse, mandar ficha e gravar; todo envio leva dry:true; o relatório traz a bolha que sairia', async () => {
    semearLead(0); semearLead(1);
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!]);
    const posseAntes = JSON.stringify(banco.tabelas.whatsapp_sessions);
    const r = await rodar({ dry: true });
    expect(r.dry).toBe(true);
    expect(r.conversasVistas).toBe(2);
    expect(h.enviar.mock.calls.length).toBeGreaterThan(0);
    for (const c of h.enviar.mock.calls) expect(c[0].dry).toBe(true);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(JSON.stringify(banco.tabelas.whatsapp_sessions)).toBe(posseAntes);
    const chaves = chavesDoEstado();
    expect(chaves.filter(k => /^(ag5040_vez_vivo:|ag5040_vez:|ag5040_vivo_lock|ag5040_tent:|ficha_lead:|ag5040_sent:)/.test(k))).toEqual([]);
    expect(turnosGravados()).toEqual([]);
    expect(banco.escritas.filter(e => ['whatsapp_sessions', 'whatsapp_suppression'].includes(e.tabela))).toEqual([]);
    expect(r.decisoes[0]).toMatchObject({ resultado: 'sairia', sairia: [FALA_DUDA] });
    expect(r.enviadas).toBe(0);
    // o dry usa o modelo, mas só em UMA conversa? (a cota própria do dry é a que paga)
    expect(chaves.some(k => k.startsWith('ag5040_ia:dry:'))).toBe(true);
  });

  it('o dry de ação com ferramenta mostra que passaria ao humano, sem ficha e sem posse alterada', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = responder([], { acao: 'passar_helena' });
    const r = await rodar({ dry: true });
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passaria_ao_humano', ficha: 'ficharia', sairia: [BOLHA_PASSAGEM_GENERICA] });
  });

  it('o dry respeita o interruptor e o escopo: sem alvo, nenhuma conversa', async () => {
    semearLead();
    const r = await rodar({ dry: true });
    expect(r.elegiveis).toBe(0);
    expect(r.puladas.fora_do_escopo).toBe(1);
    expect(ia.chamadas).toHaveLength(0);
  });
});

describe('rodada viva: vez própria, trava com token e cota própria', () => {
  it('a vez do ensaio sombra (ag5040_vez:<id>) já reservada NÃO prende a rodada viva, que usa a sua', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    banco.tabelas.system_state!.push({ key: 'ag5040_vez:10', value: { em: iso(60_000) } });
    const r = await rodar();
    expect(r.enviadas).toBe(1);
    expect(r.puladas.vez_ocupada).toBeUndefined();
    expect(chavesDoEstado()).toEqual(expect.arrayContaining(['ag5040_vez:10', 'ag5040_vez_vivo:10']));
  });

  it('a própria vez da rodada viva reservada = vez_ocupada (duas rodadas não respondem a mesma fala)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    banco.tabelas.system_state!.push({ key: 'ag5040_vez_vivo:10', value: { em: iso(60_000) } });
    const r = await rodar();
    expect(r.puladas.vez_ocupada).toBe(1);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('a trava leva um token aleatório e é solta pelo token mesmo se algo reescrever o updated_at (gatilho do banco)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    let tokenVisto = '';
    h.enviar.mockImplementation(async () => {
      const t = banco.tabelas.system_state!.find(l => l.key === CHAVE_TRAVA)!;
      tokenVisto = String(t.value.token);
      t.updated_at = new Date(AGORA.getTime() + 7_000).toISOString();           // o "gatilho" mexeu no updated_at
      return { ok: true, enviadas: 1, carimbos: [] };
    });
    await rodar();
    expect(tokenVisto).toMatch(/^[0-9a-f]{24}$/);
    expect(chavesDoEstado()).not.toContain(CHAVE_TRAVA);
  });

  it('trava tomada por OUTRA rodada (outro token) durante a minha não é solta por mim', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockImplementation(async () => {
      const t = banco.tabelas.system_state!.find(l => l.key === CHAVE_TRAVA)!;
      t.value = { em: AGORA.toISOString(), token: 'de-outra-rodada' };
      return { ok: true, enviadas: 1, carimbos: [] };
    });
    await rodar();
    expect(banco.tabelas.system_state!.find(l => l.key === CHAVE_TRAVA)?.value.token).toBe('de-outra-rodada');
  });

  it('o takeover da trava expirada grava um token novo', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    banco.tabelas.system_state!.push({ key: CHAVE_TRAVA, value: { em: iso(400_000), token: 'velho' }, updated_at: iso(400_000) });
    let tokenVisto = '';
    h.enviar.mockImplementation(async () => {
      tokenVisto = String(banco.tabelas.system_state!.find(l => l.key === CHAVE_TRAVA)!.value.token);
      return { ok: true, enviadas: 1, carimbos: [] };
    });
    await rodar();
    expect(tokenVisto).toMatch(/^[0-9a-f]{24}$/);
    expect(tokenVisto).not.toBe('velho');
    expect(chavesDoEstado()).not.toContain(CHAVE_TRAVA);
  });

  it('cota PRÓPRIA da resposta: a cota do ensaio sombra (vivo) estourada não para a rodada viva, e a vaga sai de ag5040_ia:resposta:', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    for (let n = 1; n <= 120; n++) banco.tabelas.system_state!.push({ key: `ag5040_ia:vivo:2026-10-20:${n}`, value: {} });
    const r = await rodar();
    expect(r.parou).toBeNull();
    expect(r.enviadas).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
    expect(chavesDoEstado()).toContain('ag5040_ia:resposta:2026-10-20:1');
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_ia:vivo:'))).toHaveLength(120);
  });

  it('cota PRÓPRIA da resposta: 300 chamadas no dia param a rodada viva (teto padrão)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    for (let n = 1; n <= 300; n++) banco.tabelas.system_state!.push({ key: `ag5040_ia:resposta:2026-10-20:${n}`, value: {} });
    const r = await rodar();
    expect(r.parou).toBe('teto');
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
  });
});
