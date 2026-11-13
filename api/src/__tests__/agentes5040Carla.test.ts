import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A Carla na rodada viva (B3b). Banco falso em memória, IA falsa, vivoEnvio e fichaEnvio trocados por mocks que contam
// chamadas. A porta (assumirNaEntrada) com a Carla tem os casos (i) em agentes5040Entrada.test.ts.
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
  cooldown: false,
  pix: { tipo: 'link' } as any,
  pixPedidos: [] as unknown[][],
  pixValido: ((_c: string) => true) as (c: string) => boolean,
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); } }));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ enviarResposta: (...a: unknown[]) => h.enviar(...a), pixValidoComoPeca: (c: string) => h.pixValido(c) }));
// O Pix automático da conversa (05/11/2026): o servidor resolve o marcador pix_automatico. Padrão dos testes antigos: o link; os novos mudam h.pix.
vi.mock('../services/solardoc/pixAutoCodigo', () => ({ resolverPixConversa: async (...a: unknown[]) => { h.pixPedidos.push(a); return h.pix; } }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: async () => ({ ok: true, mapa: new Map([['diego', '34991360172']]) }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: () => false,
  linhaIoEmCooldown: () => h.cooldown,
  leadEhDeTeste: async () => false,
  telefoneDoConsultor: (m: Map<string, string>, n: string) => m.get(String(n ?? '').trim().toLowerCase().split(' ')[0]!) ?? null,
  telefoneDoDono: () => '34900000000',
  tetoDaLinhaPermiteFicha: async () => 'ok',
}));
vi.mock('../services/agentes5040/agendaEnvio', () => ({
  enfileirarAgenda: async () => ({ ok: true, chave: 'ag5040_agenda_fila:0:confirma' }),
  bolhaDeConfirmacao: () => null,
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { pediuDeNovo, planejarCarla, MAX_IMAGENS_POR_CONVERSA } from '../services/agentes5040/carlaVivo';
import { MAX_DEPOIMENTOS_POR_CONVERSA } from '../services/agentes5040/conhecimento/depoimentos';
import { saida as saidaDe, conversaDoLead } from './_agentes5040Util';
import { gerarPixCopiaECola } from '../utils/pixBrCode';
import { LINKS_CARLA } from '../services/agentes5040/personas/carla';
import { PROMESSA_PLANILHA_ELETROPOSTO } from '../services/agentes5040/conhecimento/solardoc';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);
const DESDE_POSSE = iso(30 * 60_000);

const TEL = '5534991100000';
const CHAVE = '3491100000';

let banco: BancoFalso;
let gerador: BancoFalso;

const lead = (id: number, momento: string, texto = 'Quanto custa o SolarDoc?') =>
  ({ id, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto, momment: momento });
const nossa = (id: number, momento: string) =>
  ({ id, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: 'Oi, aqui é a Carla, do SolarDoc.', momment: momento });

/** Conversa: lead (8) > nossa (9) > lead (10, a que se responde). A posse já respondeu uma vez (respostas 1). */
function semear(opts: { posse?: Record<string, unknown>; textoDoLead?: string; primeiroToque?: boolean } = {}) {
  banco.tabelas.wa_mensagens = opts.primeiroToque
    ? [lead(10, MOMENTO_LEAD, opts.textoDoLead)]
    : [lead(8, iso(9 * 60_000)), nossa(9, iso(8 * 60_000)), lead(10, MOMENTO_LEAD, opts.textoDoLead)];
  banco.tabelas.whatsapp_sessions = [{
    phone: CHAVE, tipo: 'ag5040',
    lead_data: {
      dona: 'carla', estado: 'viva', apresentada: true, desde: DESDE_POSSE, ate_wa_id: opts.primeiroToque ? null : 9,
      respostas: opts.primeiroToque ? 0 : 1, imagens: [], links: [], ...(opts.posse ?? {}),
    },
  }];
  banco.tabelas.system_state = [
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)], modos: {}, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

const posseDe = (): Record<string, any> => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data;
const chavesDoEstado = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);

type Saida = { bolhas: string[]; extra?: Record<string, unknown> };
/** A IA devolve a n-ésima resposta da lista (a última se acabar). */
const modelo = (lista: Saida[]) =>
  iaFalsa((_b, n) => {
    const x = lista[Math.min(n - 1, lista.length - 1)]!;
    return respostaIA(saidaJson(x.bolhas, x.extra ?? {}), { cache_creation_input_tokens: 100 });
  });
let ia = modelo([{ bolhas: ['Oi'] }]);
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });

const pedidos = (): any[] => h.enviar.mock.calls.map(c => c[0]);
const link = (id: string, bolha1 = 'Segue o link.'): Saida => ({ bolhas: [bolha1, id === 'pix_kiwify' ? 'https://solardoc.app/pix' : LINKS_CARLA[id]!], extra: { peca: { tipo: 'link', id } } });
const imagem = (slug: string, bolha1 = 'Escolhi esse porque é da sua região.'): Saida => ({ bolhas: [bolha1], extra: { peca: { tipo: 'imagem', id: `depoimento:${slug}` } } });

beforeEach(() => {
  h.pix = { tipo: 'link' }; h.pixValido = () => true; h.pixPedidos = [];
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  // O envio falso: com peça, duas mensagens saíram; sem peça, uma.
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry
    ? { ok: false, motivo: 'dry' }
    : { ok: true, enviadas: p.peca ? 2 : 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  h.cooldown = false;
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_CARLA_VIVO = '1';
  delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.AGENTES5040_HELENA_VIVO;
  delete process.env.SOLARDOC_PIX_CHECKOUT_URL;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  zerarCacheArmazem(); zerarCacheInterruptores();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_CARLA_VIVO; delete process.env.SOLARDOC_PIX_CHECKOUT_URL;
});

describe('Carla: link de assinatura, Pix e avulsos', () => {
  it('assinatura = peça link https://solardoc.app/assinar (a peça vem do id, e o link fica registrado na posse)', async () => {
    semear(); ia = modelo([link('assinatura', 'Segue o link da assinatura.')]);
    const r = await rodar();
    expect(r.enviadas).toBe(1);
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ dona: 'carla', telefone: TEL, bolha: 'Segue o link da assinatura.', peca: { tipo: 'link', texto: 'https://solardoc.app/assinar' } });
    expect(posseDe()).toMatchObject({ respostas: 2, ate_wa_id: 10, links: ['https://solardoc.app/assinar'] });
  });

  it('a 2ª bolha escrita pelo modelo NÃO é a peça: o endereço sai do id', async () => {
    semear();
    ia = modelo([{ bolhas: ['Segue o link da assinatura.', 'https://solardoc.app/outra-coisa'], extra: { peca: { tipo: 'link', id: 'assinatura' } } }]);
    await rodar();
    expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/assinar' });
  });

  it.each([
    ['sem URL de checkout na env', undefined],
    ['com a URL do checkout da Kiwify na env', 'https://pay.kiwify.com.br/abc123'],
  ])('Pix %s = sempre peça link https://solardoc.app/?pagar=pix (o Pix automático), nunca código nem Kiwify', async (_n, env) => {
    if (env) process.env.SOLARDOC_PIX_CHECKOUT_URL = env;
    semear(); ia = modelo([link('pix_automatico', 'O Pix é automático, cobra na sua conta, e o acesso abre sozinho quando o banco confirmar.')]);
    await rodar();
    expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/?pagar=pix' });
    expect(posseDe().links).toEqual(['https://solardoc.app/?pagar=pix']);
    expect(chavesDoEstado().some(k => k.startsWith('pix_solicitado:'))).toBe(false);
  });

  describe('Pix automático na conversa (05/11/2026): o servidor troca o link pelo código', () => {
    const CODIGO = '000201260400147BRNOVO5204000053039865802BR5913AIOROS GROUP6009UBERLANDIA62070503***6304BEEF';
    const codigo = (novo = true) => ({ tipo: 'codigo', codigo: CODIGO, validadeMs: Date.now() + 20 * 3_600_000, novo });
    beforeEach(() => { h.pix = { tipo: 'link' }; h.pixValido = () => true; h.pixPedidos = []; });

    it('código: a bolha 1 vira o texto fixo (1 bolha, termina em "o código vai aqui embaixo") e a peça é o código sozinho (tipo pix)', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue o Pix automático.')]); h.pix = codigo();
      await rodar();
      const p = pedidos()[0];
      expect(p.peca).toEqual({ tipo: 'pix', texto: CODIGO });
      expect(p.bolha).toMatch(/^Fechado(, \p{Lu}\p{L}*)?\. É o Pix automático de R\$ 67 por mês, e você cancela quando quiser pelo app do banco\. O código vai aqui embaixo\.$/u);
      expect(p.bolha.length).toBeLessThanOrEqual(160);
      expect(p.bolha).not.toMatch(/[—–]|https?:/);
      expect(h.pixPedidos).toHaveLength(1);
      expect((h.pixPedidos[0]![0] as { tel: string }).tel).toBeTruthy();
      expect(posseDe().links).toEqual([]);   // o código não é link: nada a deduplicar
    });

    it('código vivo reenviado (pedido repetido) sai igual: o resolver devolve o mesmo e a peça é a mesma', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue.')]); h.pix = codigo(false);
      await rodar();
      expect(pedidos()[0].peca).toEqual({ tipo: 'pix', texto: CODIGO });
    });

    it('sem CPF: a resposta é o pedido do CPF (1 bolha, sem peça, nada de link nem código)', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue o Pix automático.')]); h.pix = { tipo: 'pedir_cpf' };
      await rodar();
      const p = pedidos()[0];
      expect(p.peca).toBeUndefined();
      expect(p.bolha).toMatch(/[Oo] Pix automático pede o CPF de quem paga, e eu ainda não tenho o seu\. Me manda aqui, por favor\? Assim eu gero o código\.$/);
      expect(p.bolha.length).toBeLessThanOrEqual(160);
    });

    it('já pagou: o texto do redator (pagamento entrou, SolarDoc liberada), 1 bolha, sem peça', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue.')]); h.pix = { tipo: 'ja_pagou' };
      await rodar();
      const p = pedidos()[0];
      expect(p.peca).toBeUndefined();
      expect(p.bolha).toMatch(/^Boa notícia(, \p{Lu}\p{L}*)?: seu pagamento já entrou e a SolarDoc já está liberada na sua conta\. É só entrar em https:\/\/solardoc\.app com o seu e-mail\.$/u);
      expect(p.bolha.length).toBeLessThanOrEqual(160);
    });

    it('código vivo com menos de 30 min: diz até que horas vale (hora de Brasília), sem peça e sem pedir código novo', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue.')]);
      h.pix = { tipo: 'aguardar', ateMs: Date.parse('2026-11-05T18:40:00.000Z') };   // 15h40 em Brasília
      await rodar();
      const p = pedidos()[0];
      expect(p.peca).toBeUndefined();
      expect(p.bolha).toContain('só até 15h40.');
      expect(p.bolha).toMatch(/me chama aqui depois desse horário que eu mando um novo\.$/);
      expect(p.bolha).not.toMatch(/já te mandei|chamo o time/);
      expect(p.bolha.length).toBeLessThanOrEqual(160);
    });

    it('código que o vivoEnvio recusaria (formato ou CRC): nunca promete "o código vai aqui embaixo", cai no link do Pix automático', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue o Pix automático.')]); h.pix = codigo(); h.pixValido = () => false;
      await rodar();
      expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/?pagar=pix' });
      expect(pedidos()[0].bolha).toBe('Segue o Pix automático.');
    });

    it('o resolver falhou e devolveu link: o link do Pix automático de sempre', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue o Pix automático.')]); h.pix = { tipo: 'link' };
      await rodar();
      expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/?pagar=pix' });
    });

    it('a peça do código caiu no teto (só a bolha saiu): pendência de peça tipo pix, e o aviso aparece no turno seguinte', async () => {
      semear(); ia = modelo([link('pix_automatico', 'Segue.')]); h.pix = codigo();
      h.enviar.mockImplementation(async (p: any) => ({ ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`], pecaCaiu: 'teto' }));
      await rodar();
      expect(posseDe().peca_pendente).toMatchObject({ tipo: 'pix', ref: 'pix_automatico' });
    });
  });

  it('o id antigo pix_kiwify e a peça tipo pix (código) não existem mais: recusa, nada de código sai', async () => {
    semear(); ia = modelo([link('pix_kiwify', 'O código Pix vem abaixo.'), link('pix_kiwify', 'O código Pix vem abaixo.')]);
    await rodar();
    expect(pedidos().every((x: any) => x.peca?.tipo !== 'pix')).toBe(true);
    expect(chavesDoEstado().some(k => k.startsWith('pix_solicitado:'))).toBe(false);
    expect(LINKS_CARLA.pix_kiwify).toBeUndefined();
  });

  it('Pix em que só a bolha saiu (enviadas 1, peça caiu no teto): pendência gravada, e o aviso aparece no turno seguinte', async () => {
    semear(); ia = modelo([link('pix_automatico', 'O Pix automático cobra na sua conta.')]);
    h.enviar.mockImplementation(async (p: any) => ({ ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`], pecaCaiu: 'teto' }));
    await rodar();
    expect(chavesDoEstado().some(k => k.startsWith('pix_solicitado:'))).toBe(false);
    expect(posseDe().links).toEqual([]);
    expect(posseDe().peca_pendente).toMatchObject({ tipo: 'link', ref: 'pix_automatico' });

    // turno seguinte: o lead fala de novo; a IA recebe o aviso de que a peça não saiu
    const agora2 = new Date(AGORA.getTime() + 10 * 60_000);
    banco.tabelas.wa_mensagens!.push(nossa(11, new Date(AGORA.getTime() + 5 * 60_000).toISOString()), lead(12, new Date(agora2.getTime() - 2 * 60_000).toISOString(), 'Não chegou o link'));
    h.enviar.mockReset().mockImplementation(async (p: any) => ({ ok: true, enviadas: p.peca ? 2 : 1, carimbos: [] }));
    ia = modelo([link('pix_automatico', 'Segue o link de novo.')]);
    await runVivoTick({ agora: agora2, cliente: ia.cliente });
    const corpo = JSON.stringify(ia.chamadas[0]!.body);
    expect(corpo).toContain('NÃO saiu');
    expect(corpo).toContain('pix_automatico');
    expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/?pagar=pix' });
    expect(posseDe().peca_pendente).toBeNull();
    expect(chavesDoEstado().some(k => k.startsWith('pix_solicitado:'))).toBe(false);
  });

  it.each([
    ['curso-fechamento', '/kit'],
    ['offgrid', '/dimensionamento'],
    ['precificacao', '/calculadora'],
    ['inventario', '/inventario-empresarial'],
  ])('avulso %s = link https://solardoc.app%s', async (id, rota) => {
    semear(); ia = modelo([link(`avulso:${id}`, 'Te mando o link.')]);
    await rodar();
    expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: `https://solardoc.app${rota}` });
  });

  it('peça com id que não existe: nova chamada com o aviso e, na segunda vez sem peça, a resposta sai sem peça', async () => {
    semear();
    ia = modelo([
      { bolhas: ['Segue o link.', 'https://solardoc.app/assinar'], extra: { peca: { tipo: 'link', id: 'avulso:nao-existe' } } },
      { bolhas: ['Posso te explicar melhor o plano, quer?'] },
    ]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(JSON.stringify(ia.chamadas[1]!.body)).toContain('não existe');
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0].peca).toBeUndefined();
  });

  describe('com ADICIONAIS_MENSAIS ligada: a página de fora das 3 ferramentas tem o preço antigo e não vai junto', () => {
    const antes = process.env.ADICIONAIS_MENSAIS;
    beforeEach(() => { process.env.ADICIONAIS_MENSAIS = '1'; });
    afterEach(() => { if (antes === undefined) delete process.env.ADICIONAIS_MENSAIS; else process.env.ADICIONAIS_MENSAIS = antes; });

    it.each(['offgrid', 'curso-fechamento', 'inventario'])('avulso %s: link recusado, a Carla reescreve sem a peça', async (id) => {
      semear();
      ia = modelo([link(`avulso:${id}`, 'Te mando o link.'), { bolhas: ['É no app ou no checkout do plano, por mês.'] }]);
      await rodar();
      expect(ia.chamadas).toHaveLength(2);
      expect(JSON.stringify(ia.chamadas[1]!.body)).toContain('adicional mensal');
      expect(pedidos()[0].peca).toBeUndefined();
    });

    it('a Precificação segue com o link dela', async () => {
      semear(); ia = modelo([link('avulso:precificacao', 'Te mando o link.')]);
      await rodar();
      expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/calculadora' });
    });
  });

  it('o mesmo link só 1 vez por conversa: repetido sem o lead pedir = recusado; se ele pede de novo, sai', async () => {
    semear({ posse: { links: ['https://solardoc.app/assinar'] }, textoDoLead: 'Ok, vou olhar com calma' });
    ia = modelo([link('assinatura', 'Segue o link.'), { bolhas: ['Fico no aguardo.'] }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(JSON.stringify(ia.chamadas[1]!.body)).toContain('já foi enviado');
    expect(pedidos()[0].peca).toBeUndefined();

    h.enviar.mockClear();
    banco = novoBanco(); h.principal = banco;
    semear({ posse: { links: ['https://solardoc.app/assinar'] }, textoDoLead: 'Me manda o link de novo, por favor' });
    ia = modelo([link('assinatura', 'Segue o link.')]);
    await rodar();
    expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/assinar' });
  });

  it('peça recusada duas vezes (a IA insiste): vai ao humano com ficha e nenhuma bolha sobra sozinha com peça', async () => {
    semear({ posse: { links: ['https://solardoc.app/assinar'] }, textoDoLead: 'Ok, vou olhar com calma' });
    ia = modelo([link('assinatura', 'Segue o link.')]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(pedidos().every(p => p.peca === undefined)).toBe(true);
    expect(posseDe().estado).toBe('passou_humano');
  });
});

describe('Carla: depoimento (imagem)', () => {
  const SLUGS = ['juliano-grilo-energia', 'vanderlei-american-energy', 'lucas-rsc-solar', 'alessandro-forca-solar'];

  it('o limite de imagens é um número só: MAX_IMAGENS_POR_CONVERSA = MAX_DEPOIMENTOS_POR_CONVERSA (2)', () => {
    expect(MAX_IMAGENS_POR_CONVERSA).toBe(MAX_DEPOIMENTOS_POR_CONVERSA);
    expect(MAX_IMAGENS_POR_CONVERSA).toBe(2);
  });

  it('o portão recusa a imagem acima do limite sozinho (planejarCarla), mesmo sem a trava', () => {
    const posse: any = { dona: 'carla', estado: 'viva', apresentada: true, desde: DESDE_POSSE, ate_wa_id: 9, respostas: 1, imagens: SLUGS.slice(0, MAX_IMAGENS_POR_CONVERSA), links: [], imagem_wa_id: 1 };
    const base = conversaDoLead()[0]!;
    const msgs = [base, { ...base, id: 99, autor: 'robo' as const, from_me: true, texto: 'Oi' }, { ...base, id: 100 }];
    const r = planejarCarla({ saida: saidaDe(['Escolhi esse.'], { peca: { tipo: 'imagem', id: 'depoimento:lucas-rsc-solar' } }), posse, msgs, fala: { id: 100 }, textosDoLead: ['oi'] });
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe('imagens_demais');
  });

  it('a trava recebe depoimentosJaEnviados = posse.imagens.length: no limite, a trava barra (reescrita) e a resposta sai sem imagem', async () => {
    semear({ posse: { imagens: SLUGS.slice(0, 2), imagem_wa_id: 8 } });
    ia = modelo([imagem(SLUGS[2]!), { bolhas: ['Quer que eu te explique como funciona?'] }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(JSON.stringify(ia.chamadas[1]!.body)).toContain('já foram 2 depoimentos');
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0].peca).toBeUndefined();
    expect(posseDe().imagens).toEqual(SLUGS.slice(0, 2));
  });

  it('envia o card como imagem https://solardoc.app/depoimentos/<arquivo>, SEM legenda, e o registro da posse existe ANTES do envio', async () => {
    semear();
    let imagensNoEnvio: unknown = null;
    h.enviar.mockImplementation(async (p: any) => {
      imagensNoEnvio = [...posseDe().imagens];
      return { ok: true, enviadas: p.peca ? 2 : 1, carimbos: [] };
    });
    ia = modelo([imagem('lucas-rsc-solar')]);
    await rodar();
    expect(pedidos()[0].peca).toEqual({ tipo: 'imagem', url: 'https://solardoc.app/depoimentos/card-lucas-rsc-solar.jpg', slug: 'lucas-rsc-solar' });
    expect(imagensNoEnvio).toEqual(['lucas-rsc-solar']);
    expect(posseDe()).toMatchObject({ imagens: ['lucas-rsc-solar'], imagem_wa_id: 10, respostas: 2 });
  });

  it('o 2º depoimento ainda sai (limite 2)', async () => {
    semear({ posse: { imagens: [SLUGS[0]!], imagem_wa_id: 8 } });
    ia = modelo([imagem(SLUGS[1]!)]);
    await rodar();
    expect(pedidos()[0].peca).toMatchObject({ tipo: 'imagem', slug: SLUGS[1] });
    expect(posseDe().imagens).toEqual(SLUGS.slice(0, 2));
  });

  it('cada card 1 vez por pessoa: o card repetido é recusado', async () => {
    semear({ posse: { imagens: ['lucas-rsc-solar'], imagem_wa_id: 8 } });
    ia = modelo([imagem('lucas-rsc-solar'), { bolhas: ['Quer ver o plano?'] }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(JSON.stringify(ia.chamadas[1]!.body)).toContain('já foi enviado');
    expect(pedidos()[0].peca).toBeUndefined();
  });

  it('duas imagens sem fala do lead no meio: recusada; com fala do lead depois da última, sai', async () => {
    semear({ posse: { imagens: ['juliano-grilo-energia'], imagem_wa_id: 10 } });     // a última imagem respondeu a ESTA fala
    ia = modelo([imagem('lucas-rsc-solar'), { bolhas: ['Quer ver o plano?'] }]);
    await rodar();
    expect(JSON.stringify(ia.chamadas[1]!.body)).toContain('ainda não falou desde a última imagem');
    expect(pedidos()[0].peca).toBeUndefined();

    banco = novoBanco(); h.principal = banco; h.enviar.mockClear();
    semear({ posse: { imagens: ['juliano-grilo-energia'], imagem_wa_id: 8 } });     // ele falou (10) depois da imagem que respondeu a 8
    ia = modelo([imagem('lucas-rsc-solar')]);
    await rodar();
    expect(pedidos()[0].peca).toMatchObject({ tipo: 'imagem', slug: 'lucas-rsc-solar' });
  });

  it('nunca no primeiro toque (posse sem resposta nossa): recusada', async () => {
    semear({ primeiroToque: true });
    ia = modelo([imagem('lucas-rsc-solar'), { bolhas: ['Oi, aqui é a Carla, do SolarDoc. Como você monta suas propostas hoje?'] }]);
    await rodar();
    expect(pedidos()[0].peca).toBeUndefined();
    expect(posseDe().imagens).toEqual([]);
  });

  it('a imagem que caiu dentro do envio (teto) libera o card de novo e deixa a pendência', async () => {
    semear();
    h.enviar.mockImplementation(async (p: any) => ({ ok: true, enviadas: 1, carimbos: [], pecaCaiu: 'teto', ...(p ? {} : {}) }));
    ia = modelo([imagem('lucas-rsc-solar')]);
    await rodar();
    expect(posseDe().imagens).toEqual([]);
    expect(posseDe().peca_pendente).toMatchObject({ tipo: 'imagem', ref: 'depoimento:lucas-rsc-solar' });
  });
});

describe('Carla: lead que já tem conta, promessa da planilha e suporte', () => {
  it('lead que virou cliente (tem conta): a posse fecha, a IA não roda, ZERO bolha ao lead e UMA ficha à Giovanna (reserva do suporte)', async () => {
    semear({ textoDoLead: 'Paguei e não consigo entrar' });
    banco.tabelas.users = [{ id: 'u1', whatsapp: TEL }];
    ia = modelo([{ bolhas: ['Oi'] }]);
    const r = await rodar();
    expect(posseDe().estado).toBe('encerrada');
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('SUPORTE');
    expect(String(h.ficha.mock.calls[0]![1])).toContain('Paguei e não consigo entrar');
    expect(chavesDoEstado()).toContain(`ag5040_suporte:${hmacDe(CHAVE)}:10`);
    expect(r.puladas.carla_lead_ja_e_cliente).toBe(1);
    expect(r.decisoes[0]).toMatchObject({ resultado: 'posse_encerrada', ficha: 'enviada' });
  });

  it('lead com conta e a linha em cooldown (ficha adiada): a posse NÃO fecha, para a próxima rodada tentar; depois sai uma ficha só', async () => {
    semear();
    banco.tabelas.users = [{ id: 'u1', whatsapp: TEL }];
    h.cooldown = true;
    await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    h.cooldown = false;
    banco.tabelas.system_state = banco.tabelas.system_state!.filter(l => !String(l.key).startsWith('ag5040_vez_vivo:'));
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe().estado).toBe('encerrada');
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('prometer_planilha grava a promessa do dia (sem telefone cru) depois que a bolha saiu', async () => {
    semear({ textoDoLead: 'Se eu fechar hoje vem mais alguma coisa?' });
    ia = modelo([{ bolhas: [PROMESSA_PLANILHA_ELETROPOSTO], extra: { acao: 'prometer_planilha' } }]);
    await rodar();
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0].peca).toBeUndefined();
    const chaves = chavesDoEstado().filter(k => k.startsWith('ag5040_planilha_prometida:'));
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).not.toContain(CHAVE);
    expect((banco.tabelas.system_state ?? []).find(l => l.key === chaves[0])!.value).toEqual({ dia: '2026-10-20' });
    expect(posseDe().planilha_prometida).toBe(true);
  });

  it('prometer_planilha com o envio recusado: nada de promessa registrada', async () => {
    semear({ textoDoLead: 'Se eu fechar hoje vem mais alguma coisa?' });
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'teto_agentes' }));
    ia = modelo([{ bolhas: [PROMESSA_PLANILHA_ELETROPOSTO], extra: { acao: 'prometer_planilha' } }]);
    await rodar();
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_planilha_prometida:'))).toBe(false);
    expect(posseDe().planilha_prometida).toBeUndefined();
  });

  it('prometer_planilha sem falar de planilha, ou repetida: recusada e nada registrado', async () => {
    semear();
    ia = modelo([{ bolhas: ['Fechado, então.'], extra: { acao: 'prometer_planilha' } }, { bolhas: ['Boa decisão.'] }]);
    await rodar();
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_planilha_prometida:'))).toBe(false);

    banco = novoBanco(); h.principal = banco; h.enviar.mockClear();
    semear({ posse: { planilha_prometida: true } });
    ia = modelo([{ bolhas: [PROMESSA_PLANILHA_ELETROPOSTO], extra: { acao: 'prometer_planilha' } }, { bolhas: ['Boa decisão.'] }]);
    await rodar();
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_planilha_prometida:'))).toBe(false);
  });

  it('suporte_giovanna: ficha antes da bolha, posse passou_humano (o mesmo caminho da Duda)', async () => {
    semear({ textoDoLead: 'Paguei e não chegou o acesso' });
    ia = modelo([{ bolhas: ['Entendi. Passei os seus dados para a Giovanna e ela fala com você por aqui mesmo.'], extra: { acao: 'suporte_giovanna', resumo: 'Pagou e não recebeu o acesso' } }]);
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('SUPORTE');
    expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
  });
});

describe('Carla: pedido de reenvio do link (heurística explícita) e hora da pendência', () => {
  it.each([
    'Me manda o link de novo, por favor', 'manda o link', 'Reenvia pra mim', 'não chegou o link', 'Não recebi nada', 'cadê o link?', 'Cadê o pix', 'manda o pix de novo',
  ])('"%s" conta como pedido', (t) => { expect(pediuDeNovo([t])).toBe(true); });

  it.each([
    'Vou mandar pro meu sócio', 'vou mandar o link pro meu sócio', 'Ok, vou olhar com calma', 'Depois eu te mando o comprovante', 'Quando eu enviar a proposta aviso', 'Qual o link do site de vocês?',
  ])('"%s" NÃO conta', (t) => { expect(pediuDeNovo([t])).toBe(false); });

  it('a pendência do link usa a hora do turno (agora injetado), não o relógio', async () => {
    semear();
    const agora2 = new Date(AGORA.getTime() + 30_000);
    h.enviar.mockImplementation(async () => ({ ok: true, enviadas: 1, carimbos: [], pecaCaiu: 'teto' }));
    ia = modelo([link('assinatura', 'Segue o link.')]);
    await runVivoTick({ agora: agora2, cliente: ia.cliente });
    expect(posseDe().peca_pendente).toMatchObject({ tipo: 'link', ref: 'assinatura', em: agora2.toISOString() });
  });
});
