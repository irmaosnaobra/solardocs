import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A entrevista de saída pelo WhatsApp (04/11/2026), pela retomada que já existe: os 3 textos do grupo `pagou`, o que a retomada deixa de fazer
// (formulário já respondido e e-mail do mesmo dia), o que a Carla sabe quando a pessoa responde e a ação registrar_feedback_saida de ponta a ponta.
// Banco falso em memória, IA falsa, vivoEnvio e fichaEnvio por mocks (mesmo desenho do agentes5040CarlaRetomada.test.ts).
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
  avisos: [] as Array<{ assunto: string; html: string }>,
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); } }));
vi.mock('../utils/mailer', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendOpsAlert: async (assunto: string, html: string) => { h.avisos.push({ assunto, html }); },
}));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ enviarResposta: (...a: unknown[]) => h.enviar(...a) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: async () => ({ ok: true, mapa: new Map([['diego', '34991360172']]) }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: () => false,
  linhaIoEmCooldown: () => false,
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
import { planejarCarla } from '../services/agentes5040/carlaVivo';
import { ACOES_CARLA, fatosDaRetomada } from '../services/agentes5040/personas/carla';
import type { DadosPosse } from '../services/agentes5040/posse';
import type { ContaRetomada, SaidaAgente } from '../services/agentes5040/tipos';
import {
  VARIACOES_RETOMADA, classificarUsuario, motivosDoTexto, textoDaRetomada, type ExtrasRet, type UsuarioRet, type VendaRet,
} from '../services/solardoc/retomadaUsuariosRegras';
import { EXTRAS_VAZIOS } from '../services/solardoc/retomadaUsuarios';
import { emBolhas } from '../services/agents/bolhas';
import { registrarToken, resolverToken } from '../services/pesquisa/token';
import { linkPesquisa } from '../utils/mailerPesquisa';
import { PEDIDO_DEPOIMENTO_AVISO } from '../services/agentes5040/personas/carla';
import { cedeAoPedidoDeDepoimento } from '../services/agentes5040/posse';

const AGORA = new Date('2026-11-05T17:00:00.000Z');                       // quinta, 14:00 em Brasília
const DIA = 86_400_000;
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();

// ── os 3 textos ──────────────────────────────────────────────────────────────

describe('os 3 textos do grupo pagou', () => {
  const TEXTOS = [
    'Oi, aqui é a Carla, da SolarDoc. O que fez você parar de usar, ou o que faltou pra continuar?',
    'Carla aqui, da SolarDoc. Se pudesse mudar uma coisa na SolarDoc pra você ter ficado, qual seria?',
    'Oi, é a Carla, da SolarDoc. Pode ser sincero, não vou me ofender: o que pesou pra você sair?',
  ];

  it('são exatamente estes 3, e passam no motivosDoTexto com e sem nome', () => {
    expect([...VARIACOES_RETOMADA.pagou]).toEqual(TEXTOS);
    for (const t of VARIACOES_RETOMADA.pagou) {
      expect(motivosDoTexto(t), t).toEqual([]);
      expect(t.length).toBeLessThanOrEqual(160);
      expect(t.match(/\?/g)).toHaveLength(1);
      expect(t).not.toMatch(/https?:|www\./i);
    }
    for (const nome of ['Ana', null, '']) {
      for (const h8 of ['00000000', '00000001', '00000002', 'ffffffff']) {
        const r = textoDaRetomada('pagou', nome, h8 + '0'.repeat(56));
        expect(r.ok, `${nome} ${h8}`).toBe(true);
        if (r.ok) expect(TEXTOS).toContain(r.texto);
      }
    }
  });

  it('cada texto sai em 1 bolha (emBolhas = 1)', () => {
    for (const t of VARIACOES_RETOMADA.pagou) expect(emBolhas(t, { maxBolhas: 1, max: 900 }), t).toHaveLength(1);
  });

  it('o incerto e o nunca_pagou ficam como estavam', () => {
    expect(VARIACOES_RETOMADA.incerto).toHaveLength(1);
    expect(VARIACOES_RETOMADA.incerto[0]).toMatch(/Passando pra contar que a plataforma mudou bastante/);
    expect(VARIACOES_RETOMADA.nunca_pagou).toHaveLength(3);
    for (const m of VARIACOES_RETOMADA.nunca_pagou) expect(m).toMatch(/mudou bastante/);
  });
});

// ── quem a retomada deixa de procurar ────────────────────────────────────────

describe('o grupo pagou não leva WhatsApp de quem já respondeu o formulário nem no mesmo dia do e-mail de saída', () => {
  const LARGADA = Date.parse('2026-11-03T15:00:00.000Z');
  const usuario = (over: Partial<UsuarioRet> = {}): UsuarioRet => ({
    id: 'u1', email: 'ana@exemplo.com', nome: 'ana', whatsapp: '5534998100001', plano: 'free', billing_status: null, plano_expira_em: null,
    created_at: '2026-10-01T12:00:00.000Z', whatsapp_opt_out: false, whatsapp_replied_at: null, is_admin: false, carla_sem_cnpj_count: 0, carla_inativo_count: 0,
    last_canceled_at: iso(40 * DIA), ...over,
  });
  const venda: VendaRet = { email: 'ana@exemplo.com', valor: 67, status: 'paid', subscription_id: 'sub_1' };
  const extras = (over: Partial<ExtrasRet> = {}): ExtrasRet => ({ ...EXTRAS_VAZIOS, vendas: [venda], ...over });
  const classificar = (u: UsuarioRet, x: ExtrasRet) =>
    classificarUsuario(u, x, { agoraMs: AGORA.getTime(), largadaMs: LARGADA, chavesDaCasa: new Set(), repetidas: new Set(), hmac: 'a'.repeat(64) });

  it('sem nenhuma das duas marcas, o ex-assinante entra no grupo pagou', () => {
    const c = classificar(usuario(), extras());
    expect(c.ok && c.grupo).toBe('pagou');
  });

  it('já respondeu o formulário de saída: fora', () => {
    expect(classificar(usuario(), extras({ respondeuSaida: true }))).toEqual({ ok: false, motivo: 'respondeu_pesquisa_saida' });
  });

  it('o e-mail de saída saiu hoje: fora hoje', () => {
    expect(classificar(usuario(), extras({ emailSaidaHoje: true }))).toEqual({ ok: false, motivo: 'email_saida_hoje' });
  });

  it('as duas marcas só valem para o grupo pagou: o grátis que nunca pagou segue na fila', () => {
    const u = usuario({ last_canceled_at: null });
    const c = classificar(u, { ...EXTRAS_VAZIOS, respondeuSaida: true, emailSaidaHoje: true });
    expect(c.ok && c.grupo).toBe('nunca_pagou');
  });
});

// ── o que a Carla sabe e a ação que registra ─────────────────────────────────

const CONTA: ContaRetomada = {
  user_id: 'u1', plano: 'free', segmento: 'ex_assinante', grupo: 'pagou', criada_em: '2026-06-10T12:00:00.000Z', saiu_em: '2026-09-02T12:00:00.000Z',
  forma_antiga: 'cartao', ultimo_documento_em: null, tem_cnpj: true, email_mascarado: 'a***@exemplo.com', primeiro_nome: 'Ana',
  texto_enviado: VARIACOES_RETOMADA.pagou[0]!, enviado_em: iso(2 * DIA),
};

describe('a persona da Carla', () => {
  it('o bloco da entrevista de saída só aparece quando o toque foi a entrevista', () => {
    const com = fatosDaRetomada({ ...CONTA, entrevista_saida: true }, AGORA.toISOString()).join('\n');
    expect(com).toContain('Se o seu último toque foi a entrevista de saída: agradeça, faça as 3 perguntas uma por vez (por que saiu, a crítica, o que faria voltar), registre as respostas e só depois, se fizer sentido, ofereça a volta pelo Pix automático.');
    expect(com).toContain('registrar_feedback_saida');
    const sem = fatosDaRetomada(CONTA, AGORA.toISOString()).join('\n');
    expect(sem).not.toContain('entrevista de saída');
    expect(sem).not.toContain('registrar_feedback_saida');
  });

  it('a ação registrar_feedback_saida existe na Carla', () => {
    expect(ACOES_CARLA).toContain('registrar_feedback_saida');
  });
});

describe('planejarCarla: registrar_feedback_saida', () => {
  const base: DadosPosse = { dona: 'carla', estado: 'viva', desde: iso(2 * DIA), ate_wa_id: 9, respostas: 1, imagens: [], links: [] };
  const posseEntrevista = (extra: Record<string, unknown> = {}): DadosPosse =>
    ({ ...base, origem: 'retomada_usuarios', retomada: { user_id: 'u1', grupo: 'pagou', entrevista_saida: true }, ...extra });
  const saida = (dados: Record<string, string>, peca: SaidaAgente['peca'] = null): SaidaAgente =>
    ({ bolhas: ['Obrigada por contar. E qual é a sua crítica sincera?'], acao: 'registrar_feedback_saida', peca, dados, resumo: '', sabe_contexto: true });
  const plano = (s: SaidaAgente, p: DadosPosse) => planejarCarla({ saida: s, posse: p, msgs: [], fala: { id: 10 }, textosDoLead: ['oi'] });

  it('na conversa da entrevista, com pelo menos uma resposta em dados: aceita', () => {
    expect(plano(saida({ porque: 'Ficou caro' }), posseEntrevista()).ok).toBe(true);
  });

  it('fora da entrevista (posse comum, retomada sem a marca), sem dados ou com peça: recusa', () => {
    const recusa = (r: ReturnType<typeof plano>): string => { expect(r.ok).toBe(false); return (r as { motivo: string }).motivo; };
    expect(recusa(plano(saida({ porque: 'x' }), base))).toBe('feedback_fora_da_entrevista');
    expect(recusa(plano(saida({ porque: 'x' }), { ...base, origem: 'retomada_usuarios', retomada: { user_id: 'u1', grupo: 'nunca_pagou' } }))).toBe('feedback_fora_da_entrevista');
    expect(recusa(plano(saida({}), posseEntrevista()))).toBe('feedback_vazio');
    expect(recusa(plano(saida({ porque: 'x' }, { tipo: 'link', id: 'pix_automatico' }), posseEntrevista()))).toBe('feedback_com_peca');
  });
});

// ── de ponta a ponta: a conversa da entrevista ───────────────────────────────

describe('a rodada viva: a pessoa responde a entrevista de saída', () => {
  const TEL = '5534991100000';
  const CHAVE = '3491100000';
  let banco: BancoFalso;
  let gerador: BancoFalso;
  type Saida = { bolhas: string[]; extra?: Record<string, unknown> };
  let ia = iaFalsa(() => respostaIA(saidaJson(['Oi'])));
  const modelo = (lista: Saida[]) => iaFalsa((_b, n) => {
    const x = lista[Math.min(n - 1, lista.length - 1)]!;
    return respostaIA(saidaJson(x.bolhas, x.extra ?? {}), { cache_creation_input_tokens: 100 });
  });
  const mensagens = (i: number): string => JSON.stringify(ia.chamadas[i]!.body.messages);
  const posseDe = (): Record<string, any> => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data;

  function semear(entrevista: boolean) {
    banco.tabelas.wa_mensagens = [
      { id: 8, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: VARIACOES_RETOMADA.pagou[0], momment: iso(2 * DIA) },
      { id: 10, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Achei caro pro tanto que eu usava', momment: iso(2 * 60_000) },
    ];
    banco.tabelas.whatsapp_sessions = [{
      phone: CHAVE, tipo: 'ag5040',
      lead_data: {
        dona: 'carla', estado: 'viva', apresentada: true, desde: iso(2 * DIA), ate_wa_id: null, respostas: 0, imagens: [], links: [], origem: 'retomada_usuarios',
        retomada: {
          user_id: 'u1', segmento: 'ex_assinante', grupo: 'pagou', variacao: 0, primeiro_nome: 'Ana', texto: VARIACOES_RETOMADA.pagou[0], em: iso(2 * DIA),
          ate: new Date(AGORA.getTime() + 20 * DIA).toISOString(), ...(entrevista ? { entrevista_saida: true } : {}),
        },
      },
    }];
    banco.tabelas.system_state = [{ key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)], modos: {}, atualizado_em: iso(3600_000) } }];
    banco.tabelas.users = [{
      id: 'u1', nome: 'Ana Souza', email: 'ana@exemplo.com', whatsapp: TEL, plano: 'free', billing_status: null, plano_expira_em: null,
      created_at: '2026-06-10T12:00:00.000Z', last_canceled_at: '2026-09-02T12:00:00.000Z',
    }];
    banco.tabelas.sales = [{ email: 'ana@exemplo.com', valor: 67, status: 'paid' }];
    zerarCacheInterruptores();
  }

  beforeEach(() => {
    banco = novoBanco(); gerador = novoBanco();
    h.principal = banco; h.gerador = gerador; h.avisos = [];
    h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry
      ? { ok: false, motivo: 'dry' }
      : { ok: true, enviadas: p.peca ? 2 : 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
    h.ficha.mockReset().mockResolvedValue(undefined);
    process.env.AGENTES5040_HMAC = 'segredo-de-teste';
    process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
    process.env.AGENTES5040_CARLA_VIVO = '1';
    delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.AGENTES5040_HELENA_VIVO;
    zerarCacheArmazem(); zerarCacheInterruptores();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.AGENTES5040_CARLA_VIVO; });

  it('a Carla recebe o bloco da entrevista, responde, e a ação grava pesquisa_saida:<userId> e avisa o Thiago', async () => {
    semear(true);
    ia = modelo([{ bolhas: ['Obrigada por contar. E qual é a sua crítica sincera?'], extra: { acao: 'registrar_feedback_saida', dados: { porque: 'Achei caro pro tanto que eu usava' } } }]);
    await runVivoTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(1);
    expect(mensagens(0)).toContain('Se o seu último toque foi a entrevista de saída');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const linha = (banco.tabelas.system_state ?? []).find(l => l.key === 'pesquisa_saida:u1');
    expect(linha?.value).toMatchObject({ tipo: 'saida', user_id: 'u1', porque: 'Achei caro pro tanto que eu usava', critica: '', voltaria: '', origem: 'whatsapp' });
    expect(Date.parse(linha!.value.em)).toBeGreaterThan(0);
    expect(h.avisos).toHaveLength(1);
    expect(h.avisos[0]!.assunto).toMatch(/Entrevista de saída/);
    expect(h.avisos[0]!.html).toContain('Achei caro');
    expect(h.avisos[0]!.html).toContain('WhatsApp');
    expect(posseDe().retomada.entrevista_saida).toBe(true);
  });

  it('as respostas seguintes se juntam à anterior (a última palavra de cada pergunta vale)', async () => {
    semear(true);
    banco.tabelas.system_state!.push({ key: 'pesquisa_saida:u1', value: { tipo: 'saida', user_id: 'u1', porque: 'Caro', critica: '', voltaria: '', em: iso(3600_000) }, updated_at: iso(3600_000) });
    ia = modelo([{ bolhas: ['Anotado. E o que faria você voltar?'], extra: { acao: 'registrar_feedback_saida', dados: { critica: 'Faltou modelo de contrato' } } }]);
    await runVivoTick({ agora: AGORA, cliente: ia.cliente });
    const linhas = (banco.tabelas.system_state ?? []).filter(l => l.key === 'pesquisa_saida:u1');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.value).toMatchObject({ porque: 'Caro', critica: 'Faltou modelo de contrato' });
  });

  it('sem a marca da entrevista na posse, a ação é recusada e nada é gravado nem avisado', async () => {
    semear(false);
    ia = modelo([{ bolhas: ['Obrigada.'], extra: { acao: 'registrar_feedback_saida', dados: { porque: 'caro' } } }, { bolhas: ['Entendi.'] }]);
    await runVivoTick({ agora: AGORA, cliente: ia.cliente });
    expect(mensagens(0)).not.toContain('Se o seu último toque foi a entrevista de saída');
    expect((banco.tabelas.system_state ?? []).some(l => String(l.key).startsWith('pesquisa_saida:'))).toBe(false);
    expect(h.avisos).toHaveLength(0);
  });
});

// ── o pedido de depoimento: quem responde é a Carla ──────────────────────────

describe('a rodada viva: o pagante responde ao pedido de depoimento', () => {
  const TEL = '5534991100000';
  const CHAVE = '3491100000';
  let banco: BancoFalso;
  let gerador: BancoFalso;
  let ia = iaFalsa(() => respostaIA(saidaJson(['Oi'])));
  const modelo = (bolhas: string[], extra: Record<string, unknown> = {}) =>
    iaFalsa(() => respostaIA(saidaJson(bolhas, extra), { cache_creation_input_tokens: 100 }));
  const mensagens = (i: number): string => JSON.stringify(ia.chamadas[i]!.body.messages);
  const posseDe = (): Record<string, any> => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data;

  async function semear(comMarca: boolean) {
    process.env.AGENTES5040_HMAC = 'segredo-de-teste';
    const token = await registrarToken('u1', 'depoimento');
    const link = linkPesquisa('depoimento', token);
    banco.tabelas.wa_mensagens = [
      { id: 8, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: 'Oi, Ana, aqui é a Carla, da SolarDoc. Você topa contar em 2 frases?', momment: iso(2 * DIA) },
      { id: 10, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Topo sim', momment: iso(2 * 60_000) },
    ];
    banco.tabelas.whatsapp_sessions = [{
      phone: CHAVE, tipo: 'ag5040',
      lead_data: {
        dona: 'carla', estado: 'viva', apresentada: true, desde: iso(2 * DIA), ate_wa_id: null, respostas: 0, imagens: [], links: [],
        ...(comMarca ? { origem: 'pedido_depoimento', pedido_depoimento: { user_id: 'u1', link, em: iso(2 * DIA), ate: new Date(AGORA.getTime() + 5 * DIA).toISOString() } } : {}),
      },
    }];
    banco.tabelas.system_state = [...(banco.tabelas.system_state ?? []), { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)], modos: {}, atualizado_em: iso(3600_000) } }];
    banco.tabelas.users = [{ id: 'u1', nome: 'Ana Souza', email: 'ana@exemplo.com', whatsapp: TEL, plano: 'pro', billing_status: 'active', plano_expira_em: null, created_at: '2026-06-10T12:00:00.000Z' }];
    zerarCacheInterruptores();
    return { token, link };
  }

  beforeEach(() => {
    banco = novoBanco(); gerador = novoBanco();
    h.principal = banco; h.gerador = gerador; h.avisos = [];
    h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry
      ? { ok: false, motivo: 'dry' }
      : { ok: true, enviadas: p.peca ? 2 : 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
    h.ficha.mockReset().mockResolvedValue(undefined);
    process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
    process.env.AGENTES5040_CARLA_VIVO = '1';
    delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.AGENTES5040_HELENA_VIVO;
    zerarCacheArmazem(); zerarCacheInterruptores();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.AGENTES5040_CARLA_VIVO; });

  it('com a marca: o pagante NÃO é passado à Giovanna, o bloco aparece e o link sai na bolha 2 com um token válido', async () => {
    const { token, link } = await semear(true);
    ia = modelo(['Que bom! Segue o link para você escrever e autorizar a publicação.', 'https://solardoc.app/pesquisa/depoimento'], { peca: { tipo: 'link', id: 'pesquisa_depoimento' } });
    await runVivoTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(1);
    expect(mensagens(0)).toContain('Se o seu último toque foi o pedido de depoimento');
    expect(mensagens(0)).toContain('Nunca diga que vai publicar sem a autorização do formulário');
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    // o link saiu (as 2 bolhas): o pedido acabou e a posse encerra; o que vier depois é da Giovanna
    expect(posseDe().estado).toBe('encerrada');
    const pedido = h.enviar.mock.calls[0]![0] as any;
    expect(pedido.peca).toEqual({ tipo: 'link', texto: link });
    expect(link).toBe(`https://solardoc.app/pesquisa/depoimento?t=${token}`);
    expect(await resolverToken('depoimento', new URL(pedido.peca.texto).searchParams.get('t'))).toBe('u1');
  });

  it('sem a marca: o bloco não aparece e a peça pesquisa_depoimento é recusada', async () => {
    await semear(false);
    ia = modelo(['Segue o link.', 'https://solardoc.app/pesquisa/depoimento'], { peca: { tipo: 'link', id: 'pesquisa_depoimento' } });
    await runVivoTick({ agora: AGORA, cliente: ia.cliente });
    // sem a marca o pagante é cliente com conta: a Carla nem chama o modelo, então o bloco não chega a lugar nenhum, e nada sai
    expect(ia.chamadas.every((_c, i) => !mensagens(i).includes('Se o seu último toque foi o pedido de depoimento'))).toBe(true);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('a recusa (nao_incomodar) encerra a posse do pedido e NÃO silencia o número', async () => {
    await semear(true);
    ia = modelo(['Tudo bem, obrigada pela atenção.'], { acao: 'nao_incomodar' });
    await runVivoTick({ agora: AGORA, cliente: ia.cliente });
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(posseDe().estado).toBe('encerrada');
    expect((banco.tabelas.whatsapp_suppression ?? [])).toHaveLength(0);
  });

  it('só a posse VIVA do pedido cede à Carla: viva cede; passou_humano, nao_incomodar e encerrada não (a Giovanna atende); vencida e posse sem a Carla no ar também não', async () => {
    await semear(true);
    expect(await cedeAoPedidoDeDepoimento(TEL)).toBe(true);
    for (const estado of ['nao_incomodar', 'passou_humano', 'encerrada']) {
      posseDe().estado = estado;
      expect(await cedeAoPedidoDeDepoimento(TEL), estado).toBe(false);
    }
    posseDe().estado = 'viva';
    posseDe().pedido_depoimento.ate = iso(60_000);
    expect(await cedeAoPedidoDeDepoimento(TEL)).toBe(false);
  });

  it('a Carla desligada para o número, ou a leitura da posse falhando: false (a mensagem do pagante nunca some)', async () => {
    await semear(true);
    banco.falhar.whatsapp_sessions = { code: 'XX000', message: 'banco soluçou' };
    expect(await cedeAoPedidoDeDepoimento(TEL)).toBe(false);
    banco.falhar.whatsapp_sessions = undefined;
    expect(await cedeAoPedidoDeDepoimento(TEL)).toBe(true);
    delete process.env.AGENTES5040_CARLA_VIVO;
    zerarCacheInterruptores();
    expect(await cedeAoPedidoDeDepoimento(TEL)).toBe(false);
  });

  it('o aviso fala do link só como peça e traz as regras da autorização', () => {
    expect(PEDIDO_DEPOIMENTO_AVISO).toContain('pesquisa_depoimento');
    expect(PEDIDO_DEPOIMENTO_AVISO).toContain('agradeça e mande o link mesmo assim, explicando que é lá que fica a autorização');
    expect(PEDIDO_DEPOIMENTO_AVISO).toContain('https://solardoc.app/pesquisa/depoimento (o sistema troca pelo link dela, com o token)');
    expect(PEDIDO_DEPOIMENTO_AVISO).not.toContain('?t=');
  });
});
