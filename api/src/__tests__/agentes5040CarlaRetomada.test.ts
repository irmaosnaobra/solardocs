import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A Carla na rodada viva quando a conversa é a da RETOMADA dos usuários (03/11/2026): quem tem conta e recebeu a mensagem do robô
// carla_retomada_usuarios. Banco falso em memória, IA falsa, vivoEnvio e fichaEnvio trocados por mocks que contam chamadas. O Pix é sempre
// o automático do Asaas (03/11/2026): sem modo para controlar. Os casos fora da retomada continuam em agentes5040Carla.test.ts.
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); } }));
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
import { avisosDaCarla, planejarCarla } from '../services/agentes5040/carlaVivo';
import { LINKS_CARLA } from '../services/agentes5040/personas/carla';
import { PROMESSA_PLANILHA_ELETROPOSTO } from '../services/agentes5040/conhecimento/solardoc';
import type { DadosPosse } from '../services/agentes5040/posse';
import type { SaidaAgente } from '../services/agentes5040/tipos';

const AGORA = new Date('2026-11-05T17:00:00.000Z');                       // quinta, 14:00 em Brasília
const DIA = 86_400_000;
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);
const DESDE_POSSE = iso(2 * DIA);

const TEL = '5534991100000';
const CHAVE = '3491100000';

let banco: BancoFalso;
let gerador: BancoFalso;

const lead = (id: number, momento: string, texto = 'O que mudou?') =>
  ({ id, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto, momment: momento });
const nossa = (id: number, momento: string) =>
  ({ id, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: 'Oi, Ana. Aqui é a Carla, da SolarDoc.', momment: momento });

interface Opcoes {
  /** Campos a mais (ou a trocar) em lead_data da posse. */
  posse?: Record<string, unknown>;
  /** A conta de `users`; null = a conta não existe. */
  conta?: Record<string, unknown> | null;
  textoDoLead?: string;
  /** Quando a posse da retomada vence (padrão: daqui a 20 dias). */
  ate?: string;
  vendas?: Array<Record<string, unknown>>;
}

/** A conversa da retomada: a nossa abertura (8), a fala do lead (10), com a posse da Carla com origem retomada_usuarios. */
function semearRetomada(o: Opcoes = {}) {
  banco.tabelas.wa_mensagens = [nossa(8, iso(2 * DIA)), lead(10, MOMENTO_LEAD, o.textoDoLead)];
  banco.tabelas.whatsapp_sessions = [{
    phone: CHAVE, tipo: 'ag5040',
    lead_data: {
      dona: 'carla', estado: 'viva', apresentada: true, desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [],
      origem: 'retomada_usuarios',
      retomada: {
        user_id: 'u1', segmento: 'gratis', grupo: 'nunca_pagou', variacao: 0, primeiro_nome: 'Ana',
        texto: 'Oi, Ana. Aqui é a Carla, da SolarDoc. A plataforma mudou bastante desde que você testou. Quer ver o que tem de novo?',
        em: DESDE_POSSE, ate: o.ate ?? new Date(AGORA.getTime() + 20 * DIA).toISOString(),
      },
      ...(o.posse ?? {}),
    },
  }];
  banco.tabelas.system_state = [
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)], modos: {}, atualizado_em: iso(3600_000) } },
  ];
  banco.tabelas.users = o.conta === null ? [] : [{
    id: 'u1', email: 'ana@exemplo.com', whatsapp: TEL, plano: 'free', billing_status: null, plano_expira_em: null,
    created_at: '2026-06-10T12:00:00.000Z', last_canceled_at: null, ...(o.conta ?? {}),
  }];
  banco.tabelas.sales = o.vendas ?? [];
  zerarCacheInterruptores();
}

const posseDe = (): Record<string, any> => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data;
const chavesDoEstado = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);

type Saida = { bolhas: string[]; extra?: Record<string, unknown> };
const modelo = (lista: Saida[]) =>
  iaFalsa((_b, n) => {
    const x = lista[Math.min(n - 1, lista.length - 1)]!;
    return respostaIA(saidaJson(x.bolhas, x.extra ?? {}), { cache_creation_input_tokens: 100 });
  });
let ia = modelo([{ bolhas: ['Oi'] }]);
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });
const pedidos = (): any[] => h.enviar.mock.calls.map(c => c[0]);
/** O que a IA recebeu como mensagem do usuário (os fatos e a conversa), SEM o bloco fixo do sistema, que cita frases como "Conta no SolarDoc: sim". */
const mensagens = (i: number): string => JSON.stringify(ia.chamadas[i]!.body.messages);
const link = (id: string, bolha1 = 'Segue o link.'): Saida => ({ bolhas: [bolha1, LINKS_CARLA[id]!], extra: { peca: { tipo: 'link', id } } });

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry
    ? { ok: false, motivo: 'dry' }
    : { ok: true, enviadas: p.peca ? 2 : 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
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

describe('retomada: a Carla atende quem tem conta quando a posse é da campanha', () => {
  it('conta grátis: a posse NÃO fecha, a IA roda, os fatos trazem a situação da conta (e não "Conta no SolarDoc: sim"), e nenhuma ficha sai', async () => {
    semearRetomada();
    ia = modelo([{ bolhas: ['Mudou bastante, principalmente a tela de propostas. Quer ver como ficou?'] }]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(1);
    const corpo = mensagens(0);
    expect(corpo).toContain('Situação da conta: grátis desde 10/06/2026, nunca assinou. Plano ativo agora: não.');
    expect(corpo).toContain('a conversa começou pela nossa mensagem de retomada');
    expect(corpo).toContain('Quer ver o que tem de novo?');
    expect(corpo).not.toContain('Conta no SolarDoc: sim');
    expect(corpo).not.toContain('Conta no SolarDoc com este WhatsApp');
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    expect(pedidos()).toHaveLength(1);
    expect(r.puladas.carla_lead_ja_e_cliente).toBeUndefined();
  });

  it('o ctx da retomada leva o Pix automático: peça pix_automatico, o e-mail da conta com o meio coberto, e nenhum código nem comprovante', async () => {
    semearRetomada();
    ia = modelo([{ bolhas: ['Quer ver como ficou?'] }]);
    await rodar();
    const corpo = mensagens(0);
    expect(corpo).toContain('Pix: peça pix_automatico (o Pix automático, que cobra na conta dele todo mês e mostra o código para copiar). Nunca Pix avulso nem código.');
    expect(corpo).toContain('exatamente assim: a***@exemplo.com.');
    expect(corpo).not.toContain('ana@exemplo.com');
    expect(corpo).not.toContain('Ele já pagou antes');
    expect(corpo).not.toContain('pix_kiwify');
    expect(corpo).not.toContain('foto do comprovante');
    expect(corpo).toContain('peça entrar_no_app');
    expect(corpo).toContain('https://solardoc.app/?pagar=pix');
  });

  it('o Pix na retomada: a bolha 1 com o e-mail coberto passa na trava, a peça sai como link /?pagar=pix e sem e-mail na URL', async () => {
    semearRetomada();
    ia = modelo([link('pix_automatico', 'Pelo Pix automático, que cobra na sua conta. Use o mesmo e-mail da conta: a***@exemplo.com.')]);
    await rodar();
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0].peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/?pagar=pix' });
    expect(pedidos()[0].peca.texto).not.toMatch(/@|email/i);
    expect(posseDe().links).toEqual(['https://solardoc.app/?pagar=pix']);
    expect(chavesDoEstado().some(k => k.startsWith('pix_solicitado:'))).toBe(false);
  });

  it('o e-mail INTEIRO na bolha 1 continua barrado pela trava (só o coberto passa)', async () => {
    semearRetomada();
    ia = modelo([link('pix_automatico', 'Use o mesmo e-mail da conta: ana@exemplo.com.')]);
    await rodar();
    expect(pedidos().filter(x => x.peca)).toHaveLength(0);
  });

  it('ex-assinante com pagamento provado: "já foi assinante", a forma e a data de saída, e a frase de renovar pelo Pix', async () => {
    semearRetomada({
      conta: { last_canceled_at: '2026-09-02T12:00:00.000Z' }, vendas: [{ email: 'ana@exemplo.com', valor: 67, status: 'paid' }],
      posse: { retomada: { user_id: 'u1', segmento: 'ex_assinante', grupo: 'pagou', variacao: 0, primeiro_nome: 'Ana', texto: 'Oi, Ana.', em: DESDE_POSSE, ate: new Date(AGORA.getTime() + 20 * DIA).toISOString() } },
    });
    ia = modelo([{ bolhas: ['Quer ver como ficou?'] }]);
    await rodar();
    const corpo = mensagens(0);
    expect(corpo).toContain('Situação da conta: já foi assinante (no cartão) e saiu em 02/09/2026. Plano ativo agora: não.');
    expect(corpo).toContain('Ele já pagou antes e pode renovar pelo Pix.');
  });

  it('a mesma conta com venda só em teste: "sem pagamento confirmado" e a ordem de não dizer que assinou', async () => {
    semearRetomada({
      conta: { last_canceled_at: '2026-09-02T12:00:00.000Z' }, vendas: [{ email: 'ana@exemplo.com', valor: 67, status: 'trialing' }],
    });
    ia = modelo([{ bolhas: ['Quer ver como ficou?'] }]);
    await rodar();
    const corpo = mensagens(0);
    expect(corpo).toContain('sem pagamento confirmado no nosso registro');
    expect(corpo).toContain('Não diga que ele assinou nem que pagou.');
    expect(corpo).not.toContain('já foi assinante');
  });

  it('conta que voltou a pagar: a posse fecha SEM bolha e SEM ficha (o suporte é da Giovanna, que a fila já responde)', async () => {
    semearRetomada({ conta: { plano: 'ilimitado' }, textoDoLead: 'Voltei a assinar, mas não consigo entrar' });
    ia = modelo([{ bolhas: ['Oi'] }]);
    const r = await rodar();
    expect(posseDe().estado).toBe('encerrada');
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(r.puladas.retomada_voltou_a_assinar).toBe(1);
    expect(r.decisoes[0]).toMatchObject({ resultado: 'posse_encerrada', motivo: 'voltou_a_assinar' });
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_vez_vivo:'))).toBe(false);       // a vez foi solta
  });

  it('posse vencida: fecha e não fala, sem ler a conta e sem tomar a vez; nenhuma ficha de prazo sai nem com a fala mais velha que 15 min', async () => {
    semearRetomada({ ate: iso(1000) });
    banco.tabelas.wa_mensagens = [nossa(8, iso(3 * DIA)), lead(10, iso(40 * 60_000))];     // fala de 40 min atrás: passaria do prazo de 15 min
    ia = modelo([{ bolhas: ['Oi'] }]);
    const r = await rodar();
    expect(posseDe().estado).toBe('encerrada');
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(r.puladas.retomada_vencida).toBe(1);
    expect(banco.leituras).not.toContain('users');
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_vez_vivo:'))).toBe(false);
  });

  it('a imagem que o leitor de comprovante já tratou (ate_wa_id marcado no corte da Giovanna): a Carla não responde de novo a ela', async () => {
    semearRetomada({ posse: { ate_wa_id: 10 } });
    banco.tabelas.wa_mensagens = [nossa(8, iso(2 * DIA)), { ...lead(10, MOMENTO_LEAD, ''), tipo: 'image', media_url: 'https://x/c.jpg' }];
    ia = modelo([{ bolhas: ['Recebi, a equipe confere.'] }]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.puladas.ja_atendida).toBe(1);
  });

  it('conta que não existe mais: a Carla não fala, a vez é solta e a posse fecha (não fica 30 dias sem dono)', async () => {
    semearRetomada({ conta: null });
    ia = modelo([{ bolhas: ['Oi'] }]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.puladas.conta_inexistente).toBe(1);
    expect(r.decisoes[0]).toMatchObject({ resultado: 'recusada', motivo: 'conta_inexistente' });
    expect(chavesDoEstado().some(k => k.startsWith('ag5040_vez_vivo:'))).toBe(false);
    expect(posseDe().estado).toBe('encerrada');
  });

  it('conta com outro telefone (não casa com a conversa): a Carla não fala e a posse fecha', async () => {
    semearRetomada({ conta: { whatsapp: '5511999990000' } });
    ia = modelo([{ bolhas: ['Oi'] }]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(r.puladas.conta_inexistente).toBe(1);
    expect(posseDe().estado).toBe('encerrada');
  });

  it('a resposta da Carla na retomada estende o `ate` da posse para 30 dias a partir do envio', async () => {
    semearRetomada({ ate: new Date(AGORA.getTime() + 2 * DIA).toISOString() });
    ia = modelo([{ bolhas: ['Mudou bastante. Quer ver como ficou?'] }]);
    await rodar();
    expect(posseDe()).toMatchObject({ respostas: 1, ate_wa_id: 10 });
    const ate = Date.parse(String(posseDe().retomada.ate));
    expect(Math.abs(ate - (AGORA.getTime() + 30 * DIA))).toBeLessThan(60_000);
    expect(posseDe().retomada).toMatchObject({ user_id: 'u1', primeiro_nome: 'Ana' });      // o resto da retomada fica
  });

  it('na retomada o cartão sai pela peça entrar_no_app (https://solardoc.app/auth) e fica registrado na posse', async () => {
    semearRetomada({ textoDoLead: 'Quero voltar a assinar no cartão' });
    ia = modelo([link('entrar_no_app', 'Entra no app e toca em Fazer Upgrade.')]);
    await rodar();
    expect(pedidos()[0]).toMatchObject({ bolha: 'Entra no app e toca em Fazer Upgrade.', peca: { tipo: 'link', texto: 'https://solardoc.app/auth' } });
    expect(posseDe().links).toEqual(['https://solardoc.app/auth']);
  });

  it('a IA pede o link de assinatura na retomada: recusado, a segunda chamada leva o aviso do cartão por dentro do app e a resposta sai sem peça', async () => {
    semearRetomada({ textoDoLead: 'Quero assinar de novo' });
    ia = modelo([link('assinatura', 'Segue o link da assinatura.'), { bolhas: ['Entra no app e toca em Fazer Upgrade. Quer que eu mande o link do login?'] }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    const aviso = mensagens(1);
    expect(aviso).toContain('esta pessoa já tem conta');
    expect(aviso).toContain('entrar_no_app');
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0].peca).toBeUndefined();
    expect(posseDe().links).toEqual([]);
  });
});

// ── o plano da Carla (a peça) e os avisos do sistema, sem a rodada ───────────

describe('planejarCarla na retomada e fora dela', () => {
  const posseNormal = (): DadosPosse => ({ dona: 'carla', estado: 'viva', desde: DESDE_POSSE, ate_wa_id: 9, respostas: 1, imagens: [], links: [] });
  const posseRet = (extra: Record<string, unknown> = {}): DadosPosse => ({ ...posseNormal(), origem: 'retomada_usuarios', ...extra });
  const saida = (peca: { tipo: 'link' | 'pix' | 'imagem'; id: string } | null, acao = 'continuar', bolhas = ['Segue.', 'https://solardoc.app/x']): SaidaAgente =>
    ({ bolhas, acao, peca, dados: {}, resumo: '', sabe_contexto: true });
  const plano = (s: SaidaAgente, p: DadosPosse) => planejarCarla({ saida: s, posse: p, msgs: [], fala: { id: 10 }, textosDoLead: ['oi'] });
  const recusas: string[] = [];
  const recusado = (r: ReturnType<typeof plano>): { motivo: string; aviso: string } => {
    expect(r.ok).toBe(false);
    const x = r as { motivo: string; aviso: string };
    recusas.push(x.aviso);
    return x;
  };

  it('na retomada: o link de assinatura é recusado (cria outra conta e outra cobrança) e manda o cartão por dentro do app', () => {
    const r = recusado(plano(saida({ tipo: 'link', id: 'assinatura' }), posseRet()));
    expect(r.motivo).toBe('assinatura_com_conta');
    expect(r.aviso).toContain('entrar_no_app');
    expect(r.aviso).toContain('Fazer Upgrade');
  });

  it('na retomada: a promessa da planilha é recusada', () => {
    const r = recusado(plano(saida(null, 'prometer_planilha', [PROMESSA_PLANILHA_ELETROPOSTO]), posseRet()));
    expect(r.motivo).toBe('planilha_na_retomada');
  });

  it('na retomada: o Pix sai sempre como link do Pix automático (/?pagar=pix); a peça tipo pix (código) e o id pix_kiwify são recusados', () => {
    const ok = plano(saida({ tipo: 'link', id: 'pix_automatico' }), posseRet());
    expect(ok.ok).toBe(true);
    expect((ok as { peca?: unknown }).peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/?pagar=pix' });
    expect(recusado(plano(saida({ tipo: 'link', id: 'pix_kiwify' }), posseRet())).motivo).toBe('peca_desconhecida');
    expect(recusado(plano(saida({ tipo: 'pix', id: 'pix_automatico' }), posseRet())).motivo).toBe('peca_desconhecida');
    const repetido = recusado(plano(saida({ tipo: 'link', id: 'pix_automatico' }), posseRet({ links: ['https://solardoc.app/?pagar=pix'] })));
    expect(repetido.motivo).toBe('link_repetido');
  });

  it('na retomada: entrar_no_app sai como link do login, uma vez só (repetido sem o lead pedir é recusado)', () => {
    const ok = plano(saida({ tipo: 'link', id: 'entrar_no_app' }), posseRet());
    expect(ok.ok).toBe(true);
    expect((ok as { peca?: unknown }).peca).toEqual({ tipo: 'link', texto: 'https://solardoc.app/auth' });
    const repetido = recusado(plano(saida({ tipo: 'link', id: 'entrar_no_app' }), posseRet({ links: ['https://solardoc.app/auth'] })));
    expect(repetido.motivo).toBe('link_repetido');
  });

  it('ex-assinante: entrar_no_app é recusado (o cartão pelo app abre outra cobrança) e manda para o Pix automático; quem nunca assinou segue', () => {
    const ex = recusado(plano(saida({ tipo: 'link', id: 'entrar_no_app' }), posseRet({ retomada: { segmento: 'ex_assinante', grupo: 'pagou' } })));
    expect(ex.motivo).toBe('entrar_ex_assinante');
    expect(ex.aviso).toContain('pix_automatico');
    expect(plano(saida({ tipo: 'link', id: 'entrar_no_app' }), posseRet({ retomada: { segmento: 'gratis_ativo', grupo: 'nunca_pagou' } })).ok).toBe(true);
  });

  it('FORA da retomada: entrar_no_app é recusado (é só para quem já tem conta), e assinatura, o Pix automático e a planilha seguem como hoje', () => {
    expect(recusado(plano(saida({ tipo: 'link', id: 'entrar_no_app' }), posseNormal())).motivo).toBe('entrar_sem_conta');
    expect(plano(saida({ tipo: 'link', id: 'assinatura' }), posseNormal()).ok).toBe(true);
    expect(plano(saida({ tipo: 'link', id: 'pix_automatico' }), posseNormal()).ok).toBe(true);
    expect(plano(saida(null, 'prometer_planilha', [PROMESSA_PLANILHA_ELETROPOSTO]), posseNormal()).ok).toBe(true);
  });

  it('nenhum texto de recusa leva a palavra "menu" (a trava barra em toda bolha)', () => {
    expect(recusas.length).toBeGreaterThan(3);
    for (const a of recusas) expect(a, a).not.toMatch(/\bmenu\b/i);
  });
});

describe('avisosDaCarla: o Pix automático, na retomada e fora dela', () => {
  const posseNormal = (): DadosPosse => ({ dona: 'carla', estado: 'viva', desde: DESDE_POSSE, ate_wa_id: 9, respostas: 1, imagens: [], links: [] });
  const posseRet = (): DadosPosse => ({ ...posseNormal(), origem: 'retomada_usuarios' });
  const AVISO_PIX = /^AVISO DO SISTEMA, Pix:/;

  it('um aviso de Pix só, sempre o do Pix automático: nenhum manda o link da assinatura, falar de Kiwify, código ou comprovante', () => {
    for (const p of [posseRet(), posseNormal()]) {
      const avisos = avisosDaCarla(p, AGORA).filter(a => AVISO_PIX.test(a));
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toContain('pix_automatico');
      expect(avisos[0]).toContain('https://solardoc.app/?pagar=pix');
      expect(avisos[0]).not.toMatch(/link da assinatura|Kiwify|pix_kiwify|copia e cola|comprovante|\bmenu\b/i);
    }
  });

  it('na retomada o aviso manda usar o mesmo e-mail da conta; fora dela pede e-mail e CPF ou CNPJ na página', () => {
    expect(avisosDaCarla(posseRet(), AGORA)[0]).toContain('na bolha 1 diga para usar na página o mesmo e-mail da conta');
    expect(avisosDaCarla(posseNormal(), AGORA)[0]).toContain('pede e-mail e CPF ou CNPJ');
  });

  it('os outros avisos (links já enviados, promessa da planilha) valem igual nas duas conversas', () => {
    const ret = { ...posseRet(), links: ['https://solardoc.app/auth'], planilha_prometida: true };
    const avisos = avisosDaCarla(ret, AGORA).join('\n');
    expect(avisos).toContain('links que já saíram nesta conversa: https://solardoc.app/auth');
    expect(avisos).toContain('a promessa da planilha de eletroposto já foi feita');
  });
});
