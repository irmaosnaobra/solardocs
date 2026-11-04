import { describe, it, expect, vi, beforeEach } from 'vitest';

// A Carla retoma os usuários da SolarDoc que não pagam (03/11/2026): as regras puras, o estado (liga e desliga), a rodada inteira sobre
// dependências falsas e o modo seco. Nada aqui toca banco de verdade, Z-API nem relógio de verdade. O banco em memória só atende o estado
// e as leituras reais de teto e de erro de linha.

const h = vi.hoisted(() => ({
  /** true = o texto do redator "sumiu" (trava global). */
  semTexto: false,
  /** Piso do início (ms) que o teste impõe às leituras do código; undefined = a constante de verdade. */
  piso: undefined as number | undefined,
  /** true = a leitura dos consultores (banco do gerador) falha. */
  consultoresFalham: false,
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: (tabela: string) => {
      if (tabela !== 'consultores') throw new Error('sem banco do gerador');
      return { select: async () => (h.consultoresFalham ? { data: null, error: { code: 'x' } } : { data: [{ nome: 'Nilce', whatsapp: '34991516846' }], error: null }) };
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => undefined) }));
vi.mock('../services/solardoc/retomadaUsuariosRegras', async (orig) => {
  const real = await orig<typeof import('../services/solardoc/retomadaUsuariosRegras')>();
  return {
    ...real,
    textosVazios: (t?: Parameters<typeof real.textosVazios>[0]) => h.semTexto || real.textosVazios(t),
    pisoDoCodigoMs: (iso?: string) => (h.piso !== undefined ? h.piso : real.pisoDoCodigoMs(iso)),
  };
});

import { banco } from './_bancoFalso';
import { interruptores, semearAlvo } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import * as Regras from '../services/solardoc/retomadaUsuariosRegras';
import {
  AVALIACOES_POR_RODADA, CEDE_AGENDA_MAX, INICIO_RETOMADA_ISO, PREFIXO_CARIMBO_RET, PREFIXO_FORA_RET, PREFIXO_VEZ_RET, ROBO_RETOMADA_USUARIOS, TELEFONE_DA_LINHA_5040,
  VARIACOES_RETOMADA, chaveVezRet, chavesRepetidas, classificarUsuario, faixaDe, grupoDoTexto, inicioEfetivoMs, inicioEmTexto,
  limiteCedeAAgenda, marcaDoMotivo, montarChavesDaCasa, motivoDaConversa, motivosDoTexto, mudoPelaConversa, ordenarFila, pagaHoje, paradaDoMotivo,
  provaDePagamento, saidaDaConta, saudacao, segmentoDaConta, textoDaRetomada, textosVazios, variacaoDe, variantesDaChaveRet,
  type ContextoClassificar, type ExtrasRet, type GrupoTexto, type UsuarioRet, type VendaRet,
} from '../services/solardoc/retomadaUsuariosRegras';
import {
  CHAVE_DISJUNTOR_RET, CHAVE_LINHA_PAUSA_RET, envDesligaRetomada, estadoRetomadaUsuarios, garantirLargadaRet, lerIaParada, lerLargadaRet,
  lerLinhaPausada, lerPausaRetomada, pausarRetomada, retomarRetomada,
} from '../services/solardoc/retomadaUsuariosEstado';
import {
  EXTRAS_VAZIOS, depsReais, montarFila, runRetomadaUsuariosTick, sondarRetomadaUsuarios,
  type DepsRet, type PublicoLido, type RelatorioRet,
} from '../services/solardoc/retomadaUsuarios';
import { CHAVE_LINHA_PAUSA } from '../services/agentes5040/vivoEnvio';
import { CHAVE_DISJUNTOR, disjuntorAberto } from '../services/agentes5040/cota';
import { variantesDaChave } from '../services/gerador/caixaWhatsapp';
import { dentroDaJanelaDaBaseLinha } from '../services/agents/whatsapp/lineThrottle';
import { primeiroNome } from '../services/nexus/email';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone } from '../services/solardoc/quizSolardoc';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import { TELEFONES_DE_RESERVA } from '../services/agentes5040/fichaEnvio';
import type { FatosPorteiro, MsgConversa } from '../services/agentes5040/tipos';

// Quinta-feira, 05/11/2026, 14:00 em Brasília (17:00Z), dentro da janela. A largada foi na terça, 03/11, ao meio-dia de Brasília: o 1º dia
// de janela depois dela é a quarta, 04/11, às 9h (12:00Z). Por isso o piso dos testes é a quarta às 12:00Z.
const AGORA = new Date('2026-11-05T17:00:00.000Z');
const LARGADA = Date.parse('2026-11-03T15:00:00.000Z');
const PISO = Date.parse('2026-11-04T12:00:00.000Z');
const HORA = 3_600_000;
const DIA = 24 * HORA;
const CRIADA = '2026-10-01T12:00:00.000Z';

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.CARLA_RETOMADA_USUARIOS_OFF;
  delete process.env.EP_CONFIRMA_TETO_HORA;
  h.semTexto = false; h.piso = undefined; h.consultoresFalham = false;
  banco.reset();
  seq = 0;
});

// ── ajudantes ────────────────────────────────────────────────────────────────

let seq = 0;
/** Uma conta grátis com WhatsApp no padrão (55 + DDD + 9 + 8 dígitos), criada antes da largada. */
const usuario = (over: Partial<UsuarioRet> = {}): UsuarioRet => {
  seq++;
  return {
    id: `u${seq}`, email: `pessoa${seq}@exemplo.com`, nome: 'ana paula souza', whatsapp: `5534998${String(100000 + seq)}`, plano: 'free', billing_status: null,
    plano_expira_em: null, created_at: CRIADA, whatsapp_opt_out: false, whatsapp_replied_at: null, is_admin: false, carla_sem_cnpj_count: 0,
    carla_inativo_count: 0, last_canceled_at: null, ...over,
  };
};
const chaveDe = (u: UsuarioRet): string => chaveDoTelefone(String(u.whatsapp));
const hmacDoUsuario = (u: UsuarioRet): string => hmacDe(chaveDe(u))!;
const extras = (over: Partial<ExtrasRet> = {}): ExtrasRet => ({ ...EXTRAS_VAZIOS, ...over });
const ctx = (over: Partial<ContextoClassificar> = {}, u?: UsuarioRet): ContextoClassificar => ({
  agoraMs: AGORA.getTime(), largadaMs: LARGADA, chavesDaCasa: new Set(), repetidas: new Set(), hmac: u ? hmacDoUsuario(u) : 'a'.repeat(64), ...over,
});
const classificar = (u: UsuarioRet, x: ExtrasRet = EXTRAS_VAZIOS, over: Partial<ContextoClassificar> = {}) => classificarUsuario(u, x, ctx(over, u));
const motivoDe = (u: UsuarioRet, x: ExtrasRet = EXTRAS_VAZIOS, over: Partial<ContextoClassificar> = {}): string => {
  const c = classificar(u, x, over);
  return c.ok ? 'ok' : c.motivo;
};
const venda = (over: Partial<VendaRet> = {}): VendaRet => ({ email: 'x@y.com', valor: 67, status: 'paid', subscription_id: 'sub_1', ...over });
const msg = (autor: 'lead' | 'robo' | 'equipe', antesMs: number, id = 1): MsgConversa => ({
  id, from_me: autor !== 'lead', from_api: autor === 'robo', autor, texto: 'oi', tipo: 'texto', media_url: null,
  momment: new Date(AGORA.getTime() - antesMs).toISOString(),
});
const ISO = (ms: number): string => new Date(ms).toISOString();

// ── regras: quem não paga hoje, o segmento e o grupo do texto ────────────────

describe('regras: paga hoje', () => {
  const u = (over: Partial<UsuarioRet>) => pagaHoje({ plano: 'free', billing_status: null, plano_expira_em: null, ...over }, AGORA.getTime());

  it('plano pago, billing ativo, em teste, atrasado, não pago, suspenso e plano que ainda não venceu são "paga hoje"', () => {
    expect(u({ plano: 'ilimitado' })).toBe(true);
    expect(u({ plano: 'pro' })).toBe(true);
    for (const billing_status of ['active', 'trialing', 'past_due', 'unpaid', 'suspended']) expect(u({ billing_status }), billing_status).toBe(true);
    expect(u({ plano_expira_em: ISO(AGORA.getTime() + DIA) })).toBe(true);
  });

  it('grátis sem cobrança, com plano vencido ou cancelado, não é "paga hoje"', () => {
    expect(u({})).toBe(false);
    expect(u({ plano_expira_em: ISO(AGORA.getTime() - DIA) })).toBe(false);
    expect(u({ billing_status: 'canceled' })).toBe(false);
  });
});

describe('regras: saída da conta (parecer de 03/11: sem o updated_at da venda)', () => {
  const agora = AGORA.getTime();
  it('o saiu_em é o mais recente entre o cancelamento e o plano vencido, e a forma acompanha', () => {
    const cancel = ISO(agora - 90 * DIA);
    const expira = ISO(agora - 30 * DIA);
    expect(saidaDaConta({ last_canceled_at: cancel, plano_expira_em: null }, agora)).toEqual({ saiuEm: Date.parse(cancel), forma: 'cartao' });
    expect(saidaDaConta({ last_canceled_at: null, plano_expira_em: expira }, agora)).toEqual({ saiuEm: Date.parse(expira), forma: 'pix' });
    expect(saidaDaConta({ last_canceled_at: cancel, plano_expira_em: expira }, agora)).toEqual({ saiuEm: Date.parse(expira), forma: 'pix' });
    expect(saidaDaConta({ last_canceled_at: expira, plano_expira_em: cancel }, agora)).toEqual({ saiuEm: Date.parse(expira), forma: 'cartao' });
  });

  it('plano que ainda não venceu não é saída, e sem nenhuma das duas datas não há data nem forma', () => {
    expect(saidaDaConta({ last_canceled_at: null, plano_expira_em: ISO(agora + DIA) }, agora)).toEqual({ saiuEm: null, forma: null });
    expect(saidaDaConta({ last_canceled_at: null, plano_expira_em: null }, agora)).toEqual({ saiuEm: null, forma: null });
    expect(saidaDaConta({ last_canceled_at: 'lixo', plano_expira_em: 'lixo' }, agora)).toEqual({ saiuEm: null, forma: null });
  });
});

describe('regras: segmento e grupo do texto', () => {
  const agora = AGORA.getTime();
  type BaseDaConta = { last_canceled_at: string | null; plano_expira_em: string | null; created_at: string | null };
  const base: BaseDaConta = { last_canceled_at: null, plano_expira_em: null, created_at: CRIADA };
  const seg = (u: Partial<BaseDaConta>, x: Partial<ExtrasRet> = {}) => segmentoDaConta({ ...base, ...u }, extras(x), agora);

  it('ex-assinante por qualquer um dos três sinais, inclusive venda em teste e sem subscription_id', () => {
    expect(seg({ last_canceled_at: ISO(agora - 40 * DIA) }).segmento).toBe('ex_assinante');
    expect(seg({ plano_expira_em: ISO(agora - 40 * DIA) }).segmento).toBe('ex_assinante');
    expect(seg({}, { vendas: [venda({ status: 'canceled' })] }).segmento).toBe('ex_assinante');
    expect(seg({}, { vendas: [venda({ status: 'trialing', subscription_id: null })] }).segmento).toBe('ex_assinante');
    expect(seg({}, { vendas: [venda({ valor: 0 })] }).segmento).toBe('gratis');
  });

  it('a recência do ex-assinante é a data da saída; a venda sozinha, sem data de saída, fica sem recência', () => {
    const cancel = ISO(agora - 40 * DIA);
    expect(seg({ last_canceled_at: cancel })).toMatchObject({ saiuEm: Date.parse(cancel), recencia: Date.parse(cancel), formaAntiga: 'cartao' });
    expect(seg({}, { vendas: [venda({ status: 'canceled' })] })).toMatchObject({ saiuEm: null, recencia: null, formaAntiga: null });
  });

  it('grátis ativo pelo documento em 60 dias, descontadas as 3 h de adianto do banco; depois CNPJ; depois o resto', () => {
    const dentro = agora - 60 * DIA + 2 * HORA + 3 * HORA;     // 60 dias menos 2 h, como o banco guarda (3 h adiantado)
    const fora = agora - 60 * DIA - 2 * HORA + 3 * HORA;       // 60 dias mais 2 h
    expect(seg({}, { ultimoDocumentoBrutoMs: dentro }).segmento).toBe('gratis_ativo');
    expect(seg({}, { ultimoDocumentoBrutoMs: fora }).segmento).toBe('gratis');
    expect(seg({}, { ultimoDocumentoBrutoMs: fora, temCnpj: true }).segmento).toBe('gratis_cnpj');
    expect(seg({}, { temCnpj: true }).segmento).toBe('gratis_cnpj');
    expect(seg({}).segmento).toBe('gratis');
    expect(seg({}, { ultimoDocumentoBrutoMs: dentro }).recencia).toBe(dentro - 3 * HORA);
  });

  it('pagamento provado: venda paid com valor, também a do Asaas (que grava paid); teste, plano vencido e cancelamento não provam', () => {
    expect(provaDePagamento([venda()])).toBe(true);
    expect(provaDePagamento([venda({ status: 'trialing' })])).toBe(false);
    expect(provaDePagamento([venda({ status: 'canceled' })])).toBe(false);
    expect(provaDePagamento([venda({ valor: 0 })])).toBe(false);
    expect(provaDePagamento([venda({ valor: '67' })])).toBe(true);
    expect(provaDePagamento([])).toBe(false);
  });

  it('grupoDoTexto: grátis é nunca_pagou; ex-assinante com prova é pagou; sem prova é incerto; nenhum pagou fora do ex-assinante', () => {
    for (const s of ['gratis_ativo', 'gratis_cnpj', 'gratis'] as const) {
      expect(grupoDoTexto(s, false), s).toBe('nunca_pagou');
      expect(grupoDoTexto(s, true), s).toBe('nunca_pagou');
    }
    expect(grupoDoTexto('ex_assinante', true)).toBe('pagou');
    expect(grupoDoTexto('ex_assinante', false)).toBe('incerto');
  });

  it('venda só em teste, só o cancelamento e só o plano vencido dão o grupo incerto; com venda paga dá pagou', () => {
    const c = (u: Partial<UsuarioRet>, x: Partial<ExtrasRet> = {}) => classificar(usuario(u), extras(x));
    const grupo = (r: ReturnType<typeof c>) => (r.ok ? r.grupo : r.motivo);
    expect(grupo(c({}, { vendas: [venda({ status: 'trialing' })] }))).toBe('incerto');
    expect(grupo(c({ last_canceled_at: ISO(AGORA.getTime() - 50 * DIA) }))).toBe('incerto');
    expect(grupo(c({ plano_expira_em: ISO(AGORA.getTime() - 50 * DIA) }))).toBe('incerto');
    expect(grupo(c({ last_canceled_at: ISO(AGORA.getTime() - 50 * DIA) }, { vendas: [venda()] }))).toBe('pagou');
    expect(grupo(c({}))).toBe('nunca_pagou');
  });
});

// ── as exclusões, na ordem do plano ──────────────────────────────────────────

describe('exclusões: cada motivo com a sua causa', () => {
  it('quem entra: grátis, com WhatsApp no padrão, criado antes da largada, sem nada de errado', () => {
    const u = usuario();
    const c = classificar(u);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c).toMatchObject({ tel: `55${String(u.whatsapp).slice(2)}`, chave: chaveDe(u), segmento: 'gratis', grupo: 'nunca_pagou', respondeu: false });
  });

  it('sem telefone, sem segredo e telefone fora do padrão (valor formatado, que a resposta não casaria)', () => {
    expect(motivoDe(usuario({ whatsapp: null }))).toBe('sem_telefone');
    expect(motivoDe(usuario({ whatsapp: 'abc' }))).toBe('sem_telefone');
    expect(motivoDe(usuario(), EXTRAS_VAZIOS, { hmac: null })).toBe('sem_segredo');
    expect(motivoDe(usuario({ whatsapp: '(34) 99810-0001' }))).toBe('telefone_fora_do_padrao');
    expect(motivoDe(usuario({ whatsapp: '+55 34 99810-0001' }))).toBe('telefone_fora_do_padrao');
    for (const f of ['5534998100001', '553498100001', '34998100001', '3498100001']) expect(motivoDe(usuario({ whatsapp: f })), f).toBe('ok');
  });

  it('admin e conta de teste', () => {
    expect(motivoDe(usuario({ is_admin: true }))).toBe('admin_ou_teste');
    expect(motivoDe(usuario({ email: 'teste@gmail.com' }))).toBe('admin_ou_teste');
    expect(motivoDe(usuario({ email: 'joao.test@gmail.com' }))).toBe('admin_ou_teste');
    expect(motivoDe(usuario({ email: 'alguem@solardoc.app' }))).toBe('admin_ou_teste');
    expect(motivoDe(usuario({ nome: 'Conta de Teste' }))).toBe('admin_ou_teste');
    expect(motivoDe(usuario({ email: 'contest@gmail.com', nome: 'Maria Tester' }))).toBe('ok');
  });

  it('linha nossa: a 5040 e um reserva (telefone da equipe)', () => {
    const casa = montarChavesDaCasa([TELEFONE_DA_LINHA_5040, TELEFONES_DE_RESERVA.thiago, null, 'lixo']);
    expect(casa.has(chaveContato(TELEFONE_DA_LINHA_5040)!)).toBe(true);
    expect(casa.size).toBe(2);
    expect(motivoDe(usuario({ whatsapp: TELEFONE_DA_LINHA_5040 }), EXTRAS_VAZIOS, { chavesDaCasa: casa })).toBe('linha_nossa');
    expect(motivoDe(usuario({ whatsapp: `55${TELEFONES_DE_RESERVA.thiago}` }), EXTRAS_VAZIOS, { chavesDaCasa: casa })).toBe('linha_nossa');
    expect(motivoDe(usuario(), EXTRAS_VAZIOS, { chavesDaCasa: casa })).toBe('ok');
  });

  it('paga hoje, opt-out, data ilegível e conta criada depois (ou na hora) da largada', () => {
    expect(motivoDe(usuario({ plano: 'ilimitado' }))).toBe('paga_hoje');
    expect(motivoDe(usuario({ billing_status: 'past_due' }))).toBe('paga_hoje');
    expect(motivoDe(usuario({ whatsapp_opt_out: true }))).toBe('opt_out');
    expect(motivoDe(usuario({ created_at: 'lixo' }))).toBe('data_ilegivel');
    expect(motivoDe(usuario({ created_at: null }))).toBe('data_ilegivel');
    expect(motivoDe(usuario({ created_at: ISO(LARGADA + 1000) }))).toBe('depois_da_largada');
    expect(motivoDe(usuario({ created_at: ISO(LARGADA) }))).toBe('depois_da_largada');
    expect(motivoDe(usuario({ created_at: ISO(LARGADA - 1000) }))).toBe('ok');
  });

  it('telefone em mais de uma conta', () => {
    const a = usuario(); const b = usuario({ whatsapp: a.whatsapp });
    const repetidas = chavesRepetidas([a, b, usuario()]);
    expect(repetidas.size).toBe(1);
    expect(motivoDe(a, EXTRAS_VAZIOS, { repetidas })).toBe('telefone_em_mais_de_uma_conta');
    expect(motivoDe(b, EXTRAS_VAZIOS, { repetidas })).toBe('telefone_em_mais_de_uma_conta');
  });

  it('mudo antigo: 3 toques e nunca respondeu fica fora; os mesmos toques com resposta entram', () => {
    expect(motivoDe(usuario({ carla_sem_cnpj_count: 2, carla_inativo_count: 1 }))).toBe('mudo_antigo');
    expect(motivoDe(usuario({ carla_sem_cnpj_count: 1 }), extras({ toquesCurso19: 2 }))).toBe('mudo_antigo');
    expect(motivoDe(usuario({ carla_sem_cnpj_count: 1, carla_inativo_count: 1 }))).toBe('ok');
    expect(motivoDe(usuario({ carla_sem_cnpj_count: 2, carla_inativo_count: 1, whatsapp_replied_at: ISO(AGORA.getTime() - 10 * DIA) }))).toBe('ok');
  });

  it('já na campanha e marcado fora: com `ate` no futuro ou sem `ate` ou com `ate` ilegível fica fora; vencido entra', () => {
    expect(motivoDe(usuario(), extras({ jaNaCampanha: true }))).toBe('ja_na_campanha');
    const fora = (marcaFora: ExtrasRet['marcaFora']) => motivoDe(usuario(), extras({ marcaFora }));
    expect(fora({ motivo: 'suprimido', ate: ISO(AGORA.getTime() + DIA) })).toBe('fora_marcado:suprimido');
    expect(fora({ motivo: 'sem_whatsapp' })).toBe('fora_marcado:sem_whatsapp');
    expect(fora({ motivo: 'x', ate: 'lixo' })).toBe('fora_marcado:x');
    expect(fora({ motivo: 'suprimido', ate: ISO(AGORA.getTime() - 1000) })).toBe('ok');
  });

  it('convite da NEXUS por e-mail nas últimas 24 h adia (não marca); passadas as 24 h, entra', () => {
    expect(motivoDe(usuario(), extras({ nexusConviteEmMs: AGORA.getTime() - 23 * HORA }))).toBe('email_nexus_24h');
    expect(motivoDe(usuario(), extras({ nexusConviteEmMs: AGORA.getTime() - 25 * HORA }))).toBe('ok');
    expect(marcaDoMotivo('email_nexus_24h', AGORA.getTime())).toBeNull();
  });

  it('o primeiro motivo da ordem vale quando há vários', () => {
    const tudo = usuario({ plano: 'ilimitado', whatsapp_opt_out: true, created_at: ISO(LARGADA + 1000), is_admin: true });
    expect(motivoDe(tudo)).toBe('admin_ou_teste');
    expect(motivoDe(usuario({ plano: 'ilimitado', whatsapp_opt_out: true, created_at: ISO(LARGADA + 1000) }))).toBe('paga_hoje');
    expect(motivoDe(usuario({ whatsapp_opt_out: true, created_at: ISO(LARGADA + 1000) }))).toBe('opt_out');
    expect(motivoDe(usuario({ created_at: ISO(LARGADA + 1000), carla_sem_cnpj_count: 3 }), extras({ jaNaCampanha: true }))).toBe('depois_da_largada');
    expect(motivoDe(usuario({ carla_sem_cnpj_count: 3 }), extras({ jaNaCampanha: true }))).toBe('mudo_antigo');
    expect(motivoDe(usuario(), extras({ jaNaCampanha: true, marcaFora: { motivo: 'x' }, nexusConviteEmMs: AGORA.getTime() }))).toBe('ja_na_campanha');
  });

  it('as formas do telefone batem com a variantesDaChave da caixa', () => {
    for (const chave of ['3498100001', '1198765432', '8588881234']) expect(variantesDaChaveRet(chave), chave).toEqual(variantesDaChave(chave));
    expect(variantesDaChaveRet('abc')).toEqual([]);
  });
});

// ── a ordem da fila ──────────────────────────────────────────────────────────

describe('ordem da fila', () => {
  const item = (hmac: string, segmento: Regras.Segmento, respondeu: boolean, recencia: number | null) => ({ hmac, segmento, respondeu, recencia });

  it('faixa A (ex-assinante que respondeu), B (quem já respondeu), C (quem nunca respondeu); dentro dela, ex-assinante, ativo, CNPJ, resto', () => {
    const fila = ordenarFila([
      item('c', 'gratis', false, 1), item('b', 'gratis_cnpj', true, 1), item('a', 'ex_assinante', true, 1),
      item('f', 'ex_assinante', false, 1), item('e', 'gratis_ativo', false, 1), item('g', 'gratis_cnpj', false, 1), item('d', 'gratis_ativo', true, 1),
    ]);
    expect(fila.map(i => i.hmac)).toEqual(['a', 'd', 'b', 'f', 'e', 'g', 'c']);
    expect([faixaDe(fila[0]!), faixaDe(fila[1]!), faixaDe(fila[3]!)]).toEqual([0, 1, 2]);
  });

  it('a recência é decrescente, o sem data vai por último e o desempate é o hmac crescente', () => {
    const fila = ordenarFila([
      item('zz', 'ex_assinante', true, null), item('b2', 'ex_assinante', true, 100), item('a1', 'ex_assinante', true, 100), item('c3', 'ex_assinante', true, 500),
    ]);
    expect(fila.map(i => i.hmac)).toEqual(['c3', 'a1', 'b2', 'zz']);
  });

  it('não altera a lista de entrada', () => {
    const entrada = [item('b', 'gratis', false, 1), item('a', 'gratis', false, 1)];
    ordenarFila(entrada);
    expect(entrada.map(i => i.hmac)).toEqual(['b', 'a']);
  });

  it('montarFila: classifica todo mundo, conta os motivos e ordena quem entra', () => {
    const quente = usuario({ last_canceled_at: ISO(AGORA.getTime() - 20 * DIA), whatsapp_replied_at: ISO(AGORA.getTime() - 15 * DIA) });
    const frio = usuario();
    const pago = usuario({ plano: 'ilimitado' });
    const admin = usuario({ is_admin: true });
    const pub: PublicoLido = { usuarios: [frio, pago, admin, quente], extras: () => EXTRAS_VAZIOS, chavesDaCasa: new Set() };
    const r = montarFila(pub, AGORA.getTime(), LARGADA);
    expect(r.total).toBe(4);
    expect(r.fila.map(i => i.u.id)).toEqual([quente.id, frio.id]);
    expect(r.porMotivo).toEqual({ paga_hoje: 1, admin_ou_teste: 1 });
  });
});

// ── o texto ──────────────────────────────────────────────────────────────────

describe('texto da retomada', () => {
  const NOME_30 = 'Abcdefghijklmnopqrstuvwxyzabcd';        // 30 letras, o maior nome que o primeiroNome aceita
  const hmacs = (n: number): string[] => Array.from({ length: n }, (_, i) => (i * 0x2000000).toString(16).padStart(8, '0') + '0'.repeat(56));

  it('"Oi, Ana." com nome de gente; "Oi." com e-mail, número, sigla, título e empresa', () => {
    expect(saudacao('Ana')).toBe('Oi, Ana.');
    expect(saudacao('')).toBe('Oi.');
    const t = textoDaRetomada('nunca_pagou', primeiroNome('ana paula souza'), hmacs(1)[0]!);
    expect(t.ok && t.texto.startsWith('Oi, Ana. Aqui é a Carla, da SolarDoc.')).toBe(true);
    for (const nome of ['ana@gmail.com', '11999990000', 'MF', 'Eng Flavio Peetz', 'Solar Energia', null, '']) {
      expect(primeiroNome(nome), String(nome)).toBe('');
      const r = textoDaRetomada('pagou', primeiroNome(nome), hmacs(1)[0]!);
      expect(r.ok && r.texto.startsWith('Oi. Aqui é a Carla'), String(nome)).toBe(true);
    }
  });

  it('com o maior nome aceito (30 letras) cabe em 160; passando de 160, cai em "Oi."', () => {
    expect(primeiroNome(NOME_30)).toBe(NOME_30);
    for (const grupo of ['pagou', 'nunca_pagou', 'incerto'] as GrupoTexto[]) {
      for (const h8 of hmacs(3)) {
        const r = textoDaRetomada(grupo, NOME_30, h8);
        expect(r.ok, `${grupo} ${h8}`).toBe(true);
        if (r.ok) expect(r.texto.length).toBeLessThanOrEqual(160);
      }
    }
    // Um nome que não cabe (só possível se o primeiroNome da NEXUS deixasse passar mais de 30 letras) cai no "Oi.".
    const enorme = 'N'.repeat(80);
    const r = textoDaRetomada('pagou', enorme, hmacs(2)[1]!);
    expect(r.ok && r.texto.startsWith('Oi. Aqui é a Carla')).toBe(true);
  });

  it('os 5 textos do redator passam em motivosDoTexto, com e sem o nome de 30 letras, e têm os tamanhos combinados', () => {
    const modelos = [...VARIACOES_RETOMADA.pagou, ...VARIACOES_RETOMADA.nunca_pagou.slice(0, 2)];
    expect(modelos).toHaveLength(5);
    const semNome = modelos.map(m => m.replace('{oi}', 'Oi.'));
    expect(semNome.map(t => t.length)).toEqual([112, 124, 113, 111, 123]);
    for (const m of modelos) {
      for (const oi of ['Oi.', saudacao(NOME_30)]) {
        const t = m.replace('{oi}', oi);
        expect(motivosDoTexto(t), t).toEqual([]);
        expect(t.length).toBeLessThanOrEqual(156);
      }
    }
  });

  it('não leva link, emoji, travessão, R$ nem "hoje", e tem um "?" só, no fim', () => {
    for (const g of ['pagou', 'nunca_pagou', 'incerto'] as GrupoTexto[]) {
      for (const m of VARIACOES_RETOMADA[g]) {
        const t = m.replace('{oi}', 'Oi, Ana.');
        expect(t).not.toMatch(/https?:|www\.|R\$|\bhoje\b|[—–]/i);
        expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(t.match(/\?/g)).toHaveLength(1);
        expect(t.endsWith('?')).toBe(true);
        expect(t[0]).toBe(t[0]!.toUpperCase());
      }
    }
  });

  it('motivosDoTexto reprova cada defeito', () => {
    expect(motivosDoTexto('Oi. ' + 'x'.repeat(200) + '?')).toContain('passa_de_160');
    expect(motivosDoTexto('Oi. Veja solardoc.app?')).toContain('link');
    expect(motivosDoTexto('Oi. Veja https://x.com agora?')).toContain('link');
    expect(motivosDoTexto(`Oi ${String.fromCodePoint(0x1F600)} tudo bem?`)).toContain('emoji');
    expect(motivosDoTexto(`Oi ${String.fromCharCode(0x2014)} tudo bem?`)).toContain('travessao');
    expect(motivosDoTexto(`Oi ${String.fromCharCode(0x2013)} tudo bem?`)).toContain('travessao');
    expect(motivosDoTexto('oi, tudo bem?')).toContain('sem_maiuscula_no_comeco');
    expect(motivosDoTexto('Oi. Tudo bem?? Quer ver?')).toContain('perguntas');
    expect(motivosDoTexto('Oi. Tudo bem.')).toContain('perguntas');
    expect(motivosDoTexto('Oi. Por R$ 67, quer ver?')).toContain('preco_ou_hoje');
    expect(motivosDoTexto('Oi. Só hoje, quer ver?')).toContain('preco_ou_hoje');
    expect(motivosDoTexto('{oi} Quer ver?')).toContain('modelo_sobrando');
    expect(motivosDoTexto('Oi, Ana. Quer ver o que tem de novo?')).toEqual([]);
  });

  it('pelo grupo: nunca_pagou nunca leva "assinou", pagou nunca leva "testou" e o incerto só leva a C', () => {
    for (const m of VARIACOES_RETOMADA.nunca_pagou) expect(m).not.toMatch(/assinou/);
    for (const m of VARIACOES_RETOMADA.pagou) expect(m).not.toMatch(/testou/);
    expect(VARIACOES_RETOMADA.incerto).toHaveLength(1);
    expect(VARIACOES_RETOMADA.incerto[0]).toMatch(/Passando pra contar que a plataforma mudou bastante/);
    expect(VARIACOES_RETOMADA.incerto[0]).not.toMatch(/assinou|testou/);
    for (const h8 of hmacs(8)) {
      const r = textoDaRetomada('incerto', 'Ana', h8);
      expect(r.ok && r.variacao).toBe(0);
    }
  });

  it('a variação é estável pelo hmac, dentro do grupo, e cobre as 3 do grupo', () => {
    expect(variacaoDe('00000000' + '0'.repeat(56), 3)).toBe(0);
    expect(variacaoDe('00000001' + '0'.repeat(56), 3)).toBe(1);
    expect(variacaoDe('00000002' + '0'.repeat(56), 3)).toBe(2);
    const h1 = hmacs(1)[0]!;
    expect(textoDaRetomada('pagou', 'Ana', h1)).toEqual(textoDaRetomada('pagou', 'Ana', h1));
    const usadas = new Set(hmacs(9).map(x => (textoDaRetomada('nunca_pagou', 'Ana', x) as { variacao: number }).variacao));
    expect(usadas).toEqual(new Set([0, 1, 2]));
  });

  it('com um grupo vazio, devolve sem_texto, e textosVazios acusa', () => {
    const vazio = { pagou: [], nunca_pagou: ['{oi} Quer ver?'], incerto: ['{oi} Quer ver?'] } as const;
    expect(textoDaRetomada('pagou', 'Ana', hmacs(1)[0]!, vazio)).toEqual({ ok: false, motivo: 'sem_texto' });
    expect(Regras.textosVazios(vazio as never)).toBe(true);
    expect(Regras.textosVazios(VARIACOES_RETOMADA)).toBe(false);
  });

  it('o texto de verdade que o código carrega está preenchido', () => {
    h.semTexto = false;
    expect(textosVazios()).toBe(false);
  });
});

// ── a agenda primeiro, o início e as marcas ──────────────────────────────────

describe('limiteCedeAAgenda (D28)', () => {
  it('sem env dá 4, texto ilegível dá 4, 10 dá 4 (a env só aperta), 5 dá 3, 2 e 1 dão 0', () => {
    expect(limiteCedeAAgenda(undefined)).toBe(4);
    expect(limiteCedeAAgenda('')).toBe(4);
    expect(limiteCedeAAgenda('abc')).toBe(4);
    expect(limiteCedeAAgenda('10')).toBe(4);
    expect(limiteCedeAAgenda('6')).toBe(CEDE_AGENDA_MAX);
    expect(limiteCedeAAgenda('5')).toBe(3);
    expect(limiteCedeAAgenda('2')).toBe(0);
    expect(limiteCedeAAgenda('1')).toBe(0);
    expect(limiteCedeAAgenda('-3')).toBe(4);
    expect(limiteCedeAAgenda('0')).toBe(4);
  });
});

describe('inicioEfetivoMs (D35): nunca no dia do deploy, sempre às 9h de um dia de janela', () => {
  const ini = (largada: string, piso = 0) => new Date(inicioEfetivoMs(Date.parse(largada), piso)).toISOString();

  it('largada numa terça às 15h dá quarta às 9h; num sábado dá segunda às 9h; às 2h da manhã dá o dia seguinte às 9h', () => {
    expect(ini('2026-11-03T18:00:00.000Z')).toBe('2026-11-04T12:00:00.000Z');         // terça 15h BRT -> quarta 9h
    expect(ini('2026-11-07T15:00:00.000Z')).toBe('2026-11-09T12:00:00.000Z');         // sábado -> segunda (domingo fechado)
    expect(ini('2026-11-04T05:00:00.000Z')).toBe('2026-11-05T12:00:00.000Z');         // quarta 2h BRT -> quinta 9h
    expect(ini('2026-11-08T15:00:00.000Z')).toBe('2026-11-09T12:00:00.000Z');         // domingo -> segunda
  });

  it('largada na quinta 19/11 pula o feriado de 20/11 e dá sábado 21/11 às 9h; Finados (02/11) também fecha', () => {
    expect(ini('2026-11-19T15:00:00.000Z')).toBe('2026-11-21T12:00:00.000Z');
    expect(ini('2026-10-31T15:00:00.000Z')).toBe('2026-11-03T12:00:00.000Z');         // sábado 31/10 -> domingo e Finados fechados -> terça
  });

  it('o piso mais tarde vence a conta da largada, e o piso mais cedo não adianta nada', () => {
    expect(ini('2026-11-03T18:00:00.000Z', Date.parse('2026-11-10T12:00:00.000Z'))).toBe('2026-11-10T12:00:00.000Z');
    expect(ini('2026-11-03T18:00:00.000Z', Date.parse('2026-11-01T12:00:00.000Z'))).toBe('2026-11-04T12:00:00.000Z');
  });

  it('o instante devolvido passa na janela da linha, e 1 ms antes não', () => {
    for (const largada of ['2026-11-03T18:00:00.000Z', '2026-11-07T15:00:00.000Z', '2026-11-19T15:00:00.000Z']) {
      const t = inicioEfetivoMs(Date.parse(largada), 0);
      expect(dentroDaJanelaDaBaseLinha(new Date(t)), largada).toBe(true);
      expect(dentroDaJanelaDaBaseLinha(new Date(t - 1)), largada).toBe(false);
    }
  });

  it('piso ou largada que não são data dão Infinity (nunca), e inicioEmTexto não escreve nada para eles', () => {
    expect(inicioEfetivoMs(Date.parse('2026-11-03T18:00:00.000Z'), NaN)).toBe(Infinity);
    expect(inicioEfetivoMs(NaN, PISO)).toBe(Infinity);
    expect(inicioEmTexto(Infinity)).toBeNull();
    expect(inicioEmTexto(Date.parse('2026-11-04T12:00:00.000Z'))).toBe('04/11');
  });

  it('o piso do código é uma data ou a trava PISO_NAO_PREENCHIDO, e com a trava a campanha nunca começa', () => {
    // Sem data, o robô fica Pausado (sem_data_de_inicio) na Central; o teste "piso ou largada que não são data: nunca envia" prova o tick.
    if (INICIO_RETOMADA_ISO === 'PISO_NAO_PREENCHIDO') {
      expect(inicioEfetivoMs(Date.parse('2026-11-03T18:00:00.000Z'), Date.parse(INICIO_RETOMADA_ISO))).toBe(Infinity);
    } else {
      expect(Number.isFinite(Date.parse(INICIO_RETOMADA_ISO))).toBe(true);
    }
  });
});

describe('marcaDoMotivo (5.4)', () => {
  const agoraMs = AGORA.getTime();
  it('cada motivo com o `ate` certo', () => {
    expect(marcaDoMotivo('suprimido', agoraMs)).toEqual({ ate: ISO(agoraMs + 30 * DIA) });
    expect(marcaDoMotivo('bloqueado', agoraMs)).toEqual({ ate: ISO(agoraMs + 30 * DIA) });
    expect(marcaDoMotivo('numero_de_teste', agoraMs)).toEqual({ ate: ISO(agoraMs + 30 * DIA) });
    expect(marcaDoMotivo('posse_existente:encerrada', agoraMs)).toEqual({ ate: ISO(agoraMs + 7 * DIA) });
    expect(marcaDoMotivo('toque_recente_14d', agoraMs, { toqueMs: agoraMs - 3 * DIA })).toEqual({ ate: ISO(agoraMs + 11 * DIA) });
    expect(marcaDoMotivo('falou_nas_24h', agoraMs, { falaMs: agoraMs - 2 * HORA })).toEqual({ ate: ISO(agoraMs + 22 * HORA) });
    expect(marcaDoMotivo('mudo_pela_conversa', agoraMs)).toEqual({});
    expect(marcaDoMotivo('sem_whatsapp', agoraMs)).toEqual({});
    expect(marcaDoMotivo('humano_na_conversa', agoraMs)).toEqual({ ate: ISO(agoraMs + DIA) });
    expect(marcaDoMotivo('outro_robo', agoraMs)).toEqual({ ate: ISO(agoraMs + 3 * DIA) });
    expect(marcaDoMotivo('telefone_nao_casa_com_a_conta', agoraMs)).toEqual({ ate: ISO(agoraMs + 7 * DIA) });
  });

  it('motivos da própria rodada não marcam', () => {
    for (const m of ['leitura_falhou', 'carla_nao_atende', 'sem_texto', 'texto_invalido', 'qualquer_outra']) expect(marcaDoMotivo(m, agoraMs), m).toBeNull();
  });
});

describe('a conversa: toque recente, fala recente e mudo', () => {
  const agoraMs = AGORA.getTime();
  it('toque nosso nos últimos 14 dias; fala do lead nas últimas 24 h; depois, o mudo', () => {
    expect(motivoDaConversa([msg('robo', 3 * DIA)], agoraMs)).toMatchObject({ motivo: 'toque_recente_14d' });
    expect(motivoDaConversa([msg('equipe', 13 * DIA)], agoraMs)).toMatchObject({ motivo: 'toque_recente_14d' });
    expect(motivoDaConversa([msg('lead', 2 * HORA)], agoraMs)).toMatchObject({ motivo: 'falou_nas_24h' });
    expect(motivoDaConversa([msg('lead', 30 * HORA), msg('robo', 20 * DIA)], agoraMs)).toBeNull();
    expect(motivoDaConversa([], agoraMs)).toBeNull();
  });

  it('mudo: 3 ou mais mensagens nossas e nenhuma do lead, em 60 dias ou na conversa inteira', () => {
    const tres = [msg('robo', 20 * DIA, 1), msg('robo', 25 * DIA, 2), msg('robo', 30 * DIA, 3)];
    expect(mudoPelaConversa(tres, agoraMs)).toBe(true);
    expect(motivoDaConversa(tres, agoraMs)).toMatchObject({ motivo: 'mudo_pela_conversa' });
    expect(mudoPelaConversa([...tres, msg('lead', 40 * DIA, 4)], agoraMs)).toBe(false);
    expect(mudoPelaConversa(tres.slice(0, 2), agoraMs)).toBe(false);
    // 3 antigas (mais de 60 dias) e nenhuma do lead em toda a conversa: continua mudo.
    expect(mudoPelaConversa([msg('robo', 100 * DIA, 1), msg('robo', 110 * DIA, 2), msg('robo', 120 * DIA, 3)], agoraMs)).toBe(true);
    // O lead já falou uma vez (há 100 dias): a conversa inteira não é muda, e em 60 dias só há 2 mensagens nossas.
    expect(mudoPelaConversa([msg('lead', 100 * DIA, 1), msg('robo', 99 * DIA, 2), msg('robo', 20 * DIA, 3), msg('robo', 21 * DIA, 4)], agoraMs)).toBe(false);
    // 3 mensagens nossas nos últimos 60 dias e o lead falou só ANTES dessa janela: em 60 dias não houve resposta, então é mudo.
    expect(mudoPelaConversa([msg('lead', 100 * DIA, 1), msg('robo', 20 * DIA, 2), msg('robo', 21 * DIA, 3), msg('robo', 22 * DIA, 4)], agoraMs)).toBe(true);
  });
});

describe('paradaDoMotivo (D26)', () => {
  it('estrutura trava (bloqueio) e horário, teto e agenda só explicam', () => {
    for (const m of ['sem_texto', 'carla_nao_atende_todos', 'ia_parada', 'linha_pausada', 'sem_data_de_inicio', 'leitura_falhou']) {
      expect(paradaDoMotivo(m)?.bloqueio, m).toBe(true);
    }
    for (const m of ['fora_da_janela', 'teto_da_campanha', 'teto_da_linha', 'cede_a_agenda']) expect(paradaDoMotivo(m)?.bloqueio, m).toBe(false);
    expect(paradaDoMotivo('antes_do_inicio', { inicioMs: PISO })).toMatchObject({ bloqueio: false, texto: 'Começa em 04/11 às 9h' });
    expect(paradaDoMotivo('antes_do_inicio')).toMatchObject({ motivo: 'antes_do_inicio', bloqueio: true });
    expect(paradaDoMotivo('cede_a_agenda')?.texto).toBe('A agenda está usando a linha: o frio espera');
    expect(paradaDoMotivo('sem_texto')?.texto).toBe('Sem o texto do redator: não envia');
    expect(paradaDoMotivo('espacamento_da_linha')).toBeNull();
    expect(paradaDoMotivo('qualquer_outra')).toBeNull();
  });
});

describe('nomes e chaves', () => {
  it('o robô, os prefixos e a vez de 10 min', () => {
    expect(ROBO_RETOMADA_USUARIOS).toBe('carla_retomada_usuarios');
    expect(PREFIXO_CARIMBO_RET).toBe('usu_rec_sent:');
    expect(PREFIXO_FORA_RET).toBe('usu_rec_fora:');
    expect(chaveVezRet(new Date(600_000 * 7 + 5))).toBe(`${PREFIXO_VEZ_RET}7`);
    expect(chaveVezRet(new Date(600_000 * 7 + 599_999))).toBe(`${PREFIXO_VEZ_RET}7`);
    expect(chaveVezRet(new Date(600_000 * 8))).toBe(`${PREFIXO_VEZ_RET}8`);
  });
});

// ── o estado (liga e desliga) ────────────────────────────────────────────────

describe('estado: nasce ligada, desliga por duas portas', () => {
  const pausa = (value: unknown) => banco.poe('system_state', { key: 'usu_rec_pausa', value, updated_at: ISO(AGORA.getTime()) });

  it('nasce ligada, sem env e sem chave', async () => {
    expect(await estadoRetomadaUsuarios({ env: {}, agora: AGORA.getTime() })).toEqual({ ligada: true, motivo: 'ligada' });
  });

  it('a env "1" desliga (com espaços também), e "true", "0" e vazio não', async () => {
    expect(envDesligaRetomada({ CARLA_RETOMADA_USUARIOS_OFF: '1' } as never)).toBe(true);
    expect(envDesligaRetomada({ CARLA_RETOMADA_USUARIOS_OFF: ' 1 ' } as never)).toBe(true);
    for (const v of ['true', '0', '', 'sim']) expect(envDesligaRetomada({ CARLA_RETOMADA_USUARIOS_OFF: v } as never), v).toBe(false);
    expect(await estadoRetomadaUsuarios({ env: { CARLA_RETOMADA_USUARIOS_OFF: '1' } as never })).toEqual({ ligada: false, motivo: 'env_desligada' });
    expect(await estadoRetomadaUsuarios({ env: { CARLA_RETOMADA_USUARIOS_OFF: 'true' } as never, agora: AGORA.getTime() })).toEqual({ ligada: true, motivo: 'ligada' });
  });

  it('a chave usu_rec_pausa desliga; com `ate` vencido a pausa expirou; com `ate` ilegível fica pausada', async () => {
    pausa({ em: ISO(AGORA.getTime()), motivo: 'painel' });
    expect(await estadoRetomadaUsuarios({ env: {}, agora: AGORA.getTime() })).toEqual({ ligada: false, motivo: 'pausa_no_banco' });
    banco.reset();
    pausa({ ate: ISO(AGORA.getTime() - 1000) });
    expect(await estadoRetomadaUsuarios({ env: {}, agora: AGORA.getTime() })).toEqual({ ligada: true, motivo: 'ligada' });
    banco.reset();
    pausa({ ate: ISO(AGORA.getTime() + DIA) });
    expect((await estadoRetomadaUsuarios({ env: {}, agora: AGORA.getTime() })).ligada).toBe(false);
    banco.reset();
    pausa({ ate: 'lixo' });
    expect((await estadoRetomadaUsuarios({ env: {}, agora: AGORA.getTime() })).ligada).toBe(false);
  });

  it('leitura que falha vale desligado', async () => {
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    expect(await estadoRetomadaUsuarios({ env: {} })).toEqual({ ligada: false, motivo: 'leitura_falhou' });
  });

  it('pausarRetomada grava sem prazo, com o motivo e quem pediu; lerPausaRetomada devolve; retomarRetomada apaga', async () => {
    await pausarRetomada({ motivo: 'painel', por: 'thiago' }, AGORA);
    const linha = banco.linhas('system_state').find(l => l.key === 'usu_rec_pausa')!;
    expect(linha.value).toEqual({ em: AGORA.toISOString(), motivo: 'painel', por: 'thiago' });
    expect(await lerPausaRetomada(AGORA.getTime())).toEqual({ em: AGORA.toISOString(), motivo: 'painel', por: 'thiago', n: null });
    await pausarRetomada({ motivo: 'dois_erros_de_linha', n: 2 }, AGORA);
    expect((await lerPausaRetomada(AGORA.getTime()))?.n).toBe(2);
    await retomarRetomada();
    expect(await lerPausaRetomada(AGORA.getTime())).toBeNull();
    expect((await estadoRetomadaUsuarios({ env: {} })).ligada).toBe(true);
  });

  it('pausa e retomada que não gravam LANÇAM (o botão do painel não finge)', async () => {
    banco.falhas['system_state.upsert'] = { erro: { message: 'caiu' } };
    await expect(pausarRetomada({ motivo: 'painel' }, AGORA)).rejects.toThrow();
    banco.falhas['system_state.delete'] = { erro: { message: 'caiu' } };
    await expect(retomarRetomada()).rejects.toThrow();
  });

  it('a largada é gravada uma vez e a leitura seguinte devolve a mesma', async () => {
    expect(await lerLargadaRet()).toBeNull();
    expect(await garantirLargadaRet(AGORA)).toBe(AGORA.getTime());
    expect(await garantirLargadaRet(new Date(AGORA.getTime() + 5 * DIA))).toBe(AGORA.getTime());
    expect(banco.linhas('system_state').filter(l => l.key === 'usu_rec_largada')).toHaveLength(1);
  });
});

describe('leituras leves da linha e da IA (as mesmas do robô, sem arrastar o cota.ts para a Central)', () => {
  it('as chaves copiadas são as dos arquivos de origem', () => {
    expect(CHAVE_LINHA_PAUSA_RET).toBe(CHAVE_LINHA_PAUSA);
    expect(CHAVE_DISJUNTOR_RET).toBe(CHAVE_DISJUNTOR);
  });

  it('linha pausada: `ate` no futuro = sim; vencido ou sem chave = não; erro = erro', async () => {
    expect(await lerLinhaPausada(AGORA)).toBe('nao');
    banco.poe('system_state', { key: CHAVE_LINHA_PAUSA, value: { ate: ISO(AGORA.getTime() + 60_000) } });
    expect(await lerLinhaPausada(AGORA)).toBe('sim');
    banco.reset();
    banco.poe('system_state', { key: CHAVE_LINHA_PAUSA, value: { ate: ISO(AGORA.getTime() - 60_000) } });
    expect(await lerLinhaPausada(AGORA)).toBe('nao');
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    expect(await lerLinhaPausada(AGORA)).toBe('erro');
  });

  it('o disjuntor da IA concorda com o do cota.ts em todos os casos', async () => {
    const casos: Array<() => void> = [
      () => { /* sem chave */ },
      () => banco.poe('system_state', { key: CHAVE_DISJUNTOR, value: { ate: ISO(AGORA.getTime() + 60_000) } }),
      () => banco.poe('system_state', { key: CHAVE_DISJUNTOR, value: { ate: ISO(AGORA.getTime() - 60_000) } }),
      () => banco.poe('system_state', { key: CHAVE_DISJUNTOR, value: { ate: 'lixo' } }),
      () => { banco.falhas['system_state.select'] = { erro: { message: 'caiu' } }; },
    ];
    for (const [i, monta] of casos.entries()) {
      banco.reset(); monta();
      expect(await lerIaParada(AGORA), `caso ${i}`).toBe(await disjuntorAberto(AGORA));
    }
  });
});

// ── a rodada, sobre dependências falsas ──────────────────────────────────────

const FATOS_OK: FatosPorteiro = {
  leituraOk: true, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false, donaAtual: null, ehClienteSolarDoc: true,
  anuncio: null, primeiroTextoDoLead: null, origemCadastro: null, outroRoboAtivo: false,
};

interface Espiao {
  chamadas: string[];
  enviados: Array<{ tel: string; texto: string }>;
  claims: Map<string, Record<string, unknown>>;
  fora: Array<{ hmac: string; motivo: string; marca: { ate?: string } }>;
  posses: Array<{ chave: string; em: string; extra: Record<string, unknown> }>;
  resumos: Array<Record<string, unknown>>;
}

function falsas(usuarios: UsuarioRet[], over: Partial<DepsRet> = {}, extrasPor: (u: UsuarioRet) => ExtrasRet = () => EXTRAS_VAZIOS): { d: DepsRet; e: Espiao } {
  const e: Espiao = { chamadas: [], enviados: [], claims: new Map(), fora: [], posses: [], resumos: [] };
  const reg = (n: string): void => { e.chamadas.push(n); };
  const d: DepsRet = {
    estado: async () => ({ ligada: true, motivo: 'ligada' }),
    segredoOk: () => true,
    carlaAtendeTodos: async () => true,
    iaParada: async () => false,
    lerLargada: async () => LARGADA,
    garantirLargada: async () => { reg('garantirLargada'); return LARGADA; },
    pisoInicioMs: () => PISO,
    janela: () => true,
    linhaPausada: async () => 'nao',
    tetoHorario: async () => true,
    espacamento: async () => true,
    linhaNaHora: async () => 0,
    limiteAgenda: () => 4,
    tetoCampanha: async () => 'ok',
    vagasDoFrio: async () => ({ hora: { teto: 6, usadas: 0 }, dia: { teto: 30, usadas: 0 } }),
    tomarVez: async () => { reg('tomarVez'); return 'tomada'; },
    limparVezes: async () => undefined,
    lerPublico: async () => { reg('lerPublico'); return { usuarios, extras: extrasPor, chavesDaCasa: new Set<string>() }; },
    listas: async () => ({ silenciado: () => false, bloqueado: () => false, mudo: () => false }),
    ehNumeroDeTeste: async () => false,
    posse: async () => 'livre',
    conversa: async () => ({ msgs: [], completa: true }),
    fatosPorteiro: async () => FATOS_OK,
    carlaAtende: async () => true,
    primeiroNome: (n) => primeiroNome(n),
    telefoneExiste: async () => { reg('telefoneExiste'); return 'sim'; },
    claim: async (chave, valor) => { if (e.claims.has(chave)) return 'ja'; e.claims.set(chave, valor); reg('claim'); return 'ok'; },
    apagarClaim: async (chave) => { e.claims.delete(chave); reg('apagarClaim'); },
    marcarClaim: async (chave, valor) => { e.claims.set(chave, valor); reg('marcarClaim'); },
    marcarFora: async (hmac, motivo, marca) => { e.fora.push({ hmac, motivo, marca }); reg('marcarFora'); },
    assumirPosse: async (chave, em, extra) => { e.posses.push({ chave, em, extra }); reg('assumirPosse'); return 'assumida'; },
    posseAindaNossa: async () => true,
    desfazerPosse: async () => { reg('desfazerPosse'); return true; },
    podeFalarAgora: async () => 'sim',
    supressao: async () => [],
    contaAgora: async (id) => { const u = usuarios.find(x => x.id === id); return u ?? 'sumiu'; },
    enviar: async (tel, texto) => { reg('enviar'); e.enviados.push({ tel, texto }); return true; },
    erroDeLinha: async () => { reg('erroDeLinha'); },
    envioOk: async () => { reg('envioOk'); },
    gravarResumo: async (r) => { e.resumos.push(r as unknown as Record<string, unknown>); },
    ...over,
  };
  return { d, e };
}

const rodar = (d: DepsRet, agora: Date = AGORA): Promise<RelatorioRet> => runRetomadaUsuariosTick({ agora }, d);
const gente = (n: number): UsuarioRet[] => Array.from({ length: n }, () => usuario());

describe('rodada: ligada, segredo e texto', () => {
  it('desligada (env ou chave): sai com ligada false e não lê nada', async () => {
    const { d, e } = falsas(gente(2), { estado: async () => ({ ligada: false, motivo: 'pausa_no_banco' }) });
    const r = await rodar(d);
    expect(r).toMatchObject({ ok: true, ligada: false, motivo: 'pausa_no_banco', enviou: false });
    expect(e.chamadas).toEqual([]);
  });

  it('sem segredo de HMAC: ok false e nada roda', async () => {
    const { d, e } = falsas(gente(1), { segredoOk: () => false });
    expect(await rodar(d)).toMatchObject({ ok: false, motivo: 'sem_segredo_de_hmac' });
    expect(e.chamadas).toEqual([]);
  });

  it('sem o texto do redator é trava GLOBAL: para logo depois do estado, sem largada, sem leitura e sem envio', async () => {
    h.semTexto = true;
    const { d, e } = falsas(gente(2));
    const r = await rodar(d);
    expect(r).toMatchObject({ ok: true, ligada: true, motivo: 'sem_texto', enviou: false, avaliados: 0 });
    expect(e.chamadas).toEqual([]);
  });

  it('a chave do banco é relida antes de cada envio: pausa que entra no meio da rodada para tudo', async () => {
    let n = 0;
    const { d, e } = falsas(gente(2), { estado: async () => (++n === 1 ? { ligada: true, motivo: 'ligada' } : { ligada: false, motivo: 'pausa_no_banco' }) });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.ligada).toBe(false);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'parou', motivo: 'pausa_no_banco' });
    expect(e.chamadas).not.toContain('claim');
    expect(e.chamadas).not.toContain('enviar');
  });
});

describe('rodada: o início (D35), a janela e as travas, em ordem', () => {
  const comJanelaReal = { janela: (agora: Date) => dentroDaJanelaDaBaseLinha(agora) };

  it('antes do piso não envia, e depois dele envia', async () => {
    const antes = falsas(gente(1), { pisoInicioMs: () => AGORA.getTime() + 1000 });
    expect(await rodar(antes.d)).toMatchObject({ motivo: 'antes_do_inicio', enviou: false });
    expect(antes.e.chamadas).not.toContain('lerPublico');
    const depois = falsas(gente(1), { pisoInicioMs: () => AGORA.getTime() });
    expect(await rodar(depois.d)).toMatchObject({ motivo: null, enviou: true });
  });

  it('no dia da largada não envia, nem às 9h; às 9h do 1º dia de janela seguinte, envia', async () => {
    const deploy = { garantirLargada: async () => Date.parse('2026-11-05T13:00:00.000Z') };     // quinta 10h BRT, a 1ª rodada depois do deploy
    for (const hora of ['2026-11-05T12:00:00.000Z', '2026-11-05T17:00:00.000Z', '2026-11-05T22:59:00.000Z']) {
      const { d } = falsas(gente(1), { ...deploy, ...comJanelaReal, pisoInicioMs: () => 0 });
      expect(await rodar(d, new Date(hora)), hora).toMatchObject({ motivo: 'antes_do_inicio', enviou: false });
    }
    const sexta8h59 = falsas(gente(1), { ...deploy, ...comJanelaReal, pisoInicioMs: () => 0 });
    expect(await rodar(sexta8h59.d, new Date('2026-11-06T11:59:59.999Z'))).toMatchObject({ motivo: 'antes_do_inicio' });
    const sexta9h = falsas(gente(1), { ...deploy, ...comJanelaReal, pisoInicioMs: () => 0 });
    expect(await rodar(sexta9h.d, new Date('2026-11-06T12:00:00.000Z'))).toMatchObject({ motivo: null, enviou: true });
  });

  it('o piso mais tarde vence a conta da largada', async () => {
    const { d } = falsas(gente(1), { garantirLargada: async () => LARGADA, pisoInicioMs: () => Date.parse('2026-11-09T12:00:00.000Z') });
    expect(await rodar(d)).toMatchObject({ motivo: 'antes_do_inicio' });
  });

  it('piso ou largada que não são data: nunca envia (sem_data_de_inicio)', async () => {
    for (const over of [{ pisoInicioMs: () => NaN }, { garantirLargada: async () => NaN }]) {
      const { d, e } = falsas(gente(1), over);
      expect(await rodar(d)).toMatchObject({ motivo: 'sem_data_de_inicio', enviou: false });
      expect(e.chamadas).not.toContain('lerPublico');
    }
  });

  it('piso que não é data: a largada NÃO é gravada (o 1º tick depois do deploy não gasta a rede)', async () => {
    const { d, e } = falsas(gente(1), { pisoInicioMs: () => NaN });
    expect(await rodar(d)).toMatchObject({ motivo: 'sem_data_de_inicio', enviou: false });
    expect(e.chamadas).not.toContain('garantirLargada');
  });

  it('a reserva do quiz: com o frio de 24 h a 8 do teto a campanha para (reserva_do_quiz) e não toma a vez; com folga, segue', async () => {
    const cheio = falsas(gente(1), { vagasDoFrio: async () => ({ hora: { teto: 6, usadas: 0 }, dia: { teto: 30, usadas: 22 } }) });
    expect(await rodar(cheio.d)).toMatchObject({ motivo: 'reserva_do_quiz', enviou: false });
    expect(cheio.e.chamadas).not.toContain('tomarVez');
    const folga = falsas(gente(1), { vagasDoFrio: async () => ({ hora: { teto: 6, usadas: 0 }, dia: { teto: 30, usadas: 21 } }) });
    expect((await rodar(folga.d)).motivo).not.toBe('reserva_do_quiz');
    const sem = falsas(gente(1), { vagasDoFrio: async () => null });
    expect(await rodar(sem.d)).toMatchObject({ motivo: 'leitura_do_teto_falhou', enviou: false });
  });

  it('a largada que falha para a rodada (largada_falhou)', async () => {
    const { d } = falsas(gente(1), { garantirLargada: async () => { throw new Error('banco caiu'); } });
    expect(await rodar(d)).toMatchObject({ ok: false, motivo: 'largada_falhou' });
  });

  it('domingo, feriado fixo, 20h e 8h59 ficam fora da janela', async () => {
    const dominio = { ...comJanelaReal, pisoInicioMs: () => 0, garantirLargada: async () => Date.parse('2026-10-02T12:00:00.000Z') };
    for (const quando of [
      '2026-11-08T17:00:00.000Z',     // domingo 14h
      '2026-11-20T17:00:00.000Z',     // sexta, Consciência Negra
      '2026-11-05T23:00:00.000Z',     // quinta 20h
      '2026-11-05T11:59:59.000Z',     // quinta 8h59
      '2026-11-15T17:00:00.000Z',     // domingo, Proclamação
    ]) {
      const { d } = falsas(gente(1), dominio);
      expect(await rodar(d, new Date(quando)), quando).toMatchObject({ motivo: 'fora_da_janela', enviou: false });
    }
    const sabado = falsas(gente(1), dominio);
    expect(await rodar(sabado.d, new Date('2026-11-07T17:00:00.000Z'))).toMatchObject({ enviou: true });
  });

  it('as travas vêm nesta ordem: a Carla atende todos > IA > linha pausada > teto da linha > espaçamento > agenda > teto de 25', async () => {
    const tudoBarrando: Partial<DepsRet> = {
      carlaAtendeTodos: async () => false, iaParada: async () => true, linhaPausada: async () => 'sim', tetoHorario: async () => false,
      espacamento: async () => false, linhaNaHora: async () => 4, tetoCampanha: async () => 'cheio',
    };
    const ordem: Array<[keyof DepsRet, string]> = [
      ['carlaAtendeTodos', 'carla_nao_atende_todos'], ['iaParada', 'ia_parada'], ['linhaPausada', 'linha_pausada'], ['tetoHorario', 'teto_da_linha'],
      ['espacamento', 'espacamento_da_linha'], ['linhaNaHora', 'cede_a_agenda'], ['tetoCampanha', 'teto_da_campanha'],
    ];
    const sobra: Partial<DepsRet> = { ...tudoBarrando };
    for (const [chave, motivo] of ordem) {
      const { d, e } = falsas(gente(1), sobra);
      expect(await rodar(d), motivo).toMatchObject({ motivo, enviou: false });
      expect(e.chamadas, motivo).not.toContain('tomarVez');
      delete sobra[chave];
    }
    const livre = falsas(gente(1), sobra);
    expect(await rodar(livre.d)).toMatchObject({ motivo: null, enviou: true });
  });

  it('leitura que falha na linha pausada, na agenda ou no teto de 25 não envia', async () => {
    expect(await rodar(falsas(gente(1), { linhaPausada: async () => 'erro' }).d)).toMatchObject({ motivo: 'leitura_da_pausa_falhou', enviou: false });
    expect(await rodar(falsas(gente(1), { linhaNaHora: async () => { throw new Error('carimbos_da_linha_na_hora'); } }).d))
      .toMatchObject({ motivo: 'leitura_da_linha_falhou', enviou: false });
    expect(await rodar(falsas(gente(1), { tetoCampanha: async () => 'erro' }).d)).toMatchObject({ motivo: 'leitura_do_teto_falhou', enviou: false });
  });

  it('cede_a_agenda: com 3 carimbos da linha na hora envia; com 4 não; limite 0 (env 2 ou 1) sempre cede', async () => {
    expect(await rodar(falsas(gente(1), { linhaNaHora: async () => 3 }).d)).toMatchObject({ enviou: true });
    expect(await rodar(falsas(gente(1), { linhaNaHora: async () => 4 }).d)).toMatchObject({ motivo: 'cede_a_agenda', enviou: false });
    expect(await rodar(falsas(gente(1), { linhaNaHora: async () => 0, limiteAgenda: () => limiteCedeAAgenda('2') }).d)).toMatchObject({ motivo: 'cede_a_agenda' });
    expect(await rodar(falsas(gente(1), { linhaNaHora: async () => 3, limiteAgenda: () => limiteCedeAAgenda('5') }).d)).toMatchObject({ motivo: 'cede_a_agenda' });
  });

  it('as travas rodam de novo antes do claim, a agenda inclusive: com a linha subindo a 4 entre a 1ª passada e o claim, nada sai', async () => {
    let n = 0;
    const { d, e } = falsas(gente(2), { linhaNaHora: async () => (++n === 1 ? 3 : 4) });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'parou', motivo: 'cede_a_agenda' });
    expect(e.chamadas).not.toContain('claim');
    expect(e.chamadas).not.toContain('assumirPosse');
    expect(e.chamadas).not.toContain('enviar');
  });

  it('a janela também é conferida de novo antes do claim (parecer de 03/11): rodada que atravessa as 20h não envia', async () => {
    let n = 0;
    const { d, e } = falsas(gente(3), { janela: () => ++n === 1 });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'parou', motivo: 'fora_da_janela' });
    expect(e.chamadas).not.toContain('claim');
    expect(e.chamadas).not.toContain('enviar');
  });

  it('teto de 25 em 24 h pelo banco: com 24 carimbos envia, com 25 não (a chave da sonda 1 também pesa)', async () => {
    const reais = depsReais();
    const poe = (n: number) => { banco.reset(); for (let i = 0; i < n; i++) banco.poe('system_state', { key: `usu_rec_sent:x${i}`, value: {}, updated_at: ISO(AGORA.getTime() - 2 * HORA) }); };
    poe(24);
    expect(await rodar(falsas(gente(1), { tetoCampanha: reais.tetoCampanha }).d)).toMatchObject({ enviou: true });
    poe(25);
    expect(await rodar(falsas(gente(1), { tetoCampanha: reais.tetoCampanha }).d)).toMatchObject({ motivo: 'teto_da_campanha', enviou: false });
    banco.reset();
    for (let i = 0; i < 25; i++) banco.poe('system_state', { key: `usu_rec_sent:x${i}`, value: {}, updated_at: ISO(AGORA.getTime() - 25 * HORA) });
    expect(await reais.tetoCampanha(AGORA)).toBe('ok');                // 25 envios de mais de 24 h atrás não pesam
    poe(24);
    expect(await reais.tetoCampanha(AGORA)).toBe('ok');
    banco.poe('system_state', { key: 'usu_rec_sent:sonda:2026-11-05', value: { sonda: true }, updated_at: ISO(AGORA.getTime() - HORA) });
    expect(await reais.tetoCampanha(AGORA)).toBe('cheio');             // a chave da sonda 1 também pesa na conta por updated_at
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    expect(await reais.tetoCampanha(AGORA)).toBe('erro');
  });

  it('a agenda pelo banco: a linha inteira (agenda e frio) na última hora, e só ela', async () => {
    const reais = depsReais();
    const poe = (key: string, minutosAtras: number) => banco.poe('system_state', { key, value: {}, updated_at: ISO(AGORA.getTime() - minutosAtras * 60_000) });
    poe('ep_agenda_sent:1', 10); poe('usu_rec_sent:a', 20); poe('quiz_rec_sent:b', 30);
    poe('ag5040_sent:1', 5);                 // resposta de agente: fora da conta da linha
    poe('ep_agenda_sent:velho', 90);         // de mais de 1 h: fora
    poe('usu_rec_fora:a', 1); poe('usu_rec_vez:1', 1);   // marca e vez: não são envio
    expect(await reais.linhaNaHora(AGORA)).toBe(3);
    poe('limpapro_recovery:z', 3);
    expect(await reais.linhaNaHora(AGORA)).toBe(4);
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    await expect(reais.linhaNaHora(AGORA)).rejects.toThrow();
  });
});

describe('rodada: uma mensagem por vez', () => {
  it('com 5 elegíveis, sai 1, com o texto da pessoa e para o telefone dela', async () => {
    const us = gente(5);
    const { d, e } = falsas(us);
    const r = await rodar(d);
    expect(r).toMatchObject({ ok: true, enviou: true, candidatos: 5, avaliados: 1 });
    expect(e.enviados).toHaveLength(1);
    expect(e.enviados[0]!.tel).toMatch(/^55\d{11}$/);
    expect(e.enviados[0]!.texto).toMatch(/^Oi, Ana\. Aqui é a Carla, da SolarDoc\./);
    expect(e.claims.size).toBe(1);
  });

  it('a vez de 10 min ocupada ou com erro encerra a rodada sem ler o público', async () => {
    const ocupada = falsas(gente(2), { tomarVez: async () => 'ocupada' });
    expect(await rodar(ocupada.d)).toMatchObject({ motivo: 'vez_ocupada', enviou: false });
    expect(ocupada.e.chamadas).not.toContain('lerPublico');
    expect(await rodar(falsas(gente(2), { tomarVez: async () => 'erro' }).d)).toMatchObject({ motivo: 'vez_nao_reservada' });
  });

  it('a vez é uma chave por faixa de 10 minutos, e a real não toma duas vezes a mesma faixa', async () => {
    const reais = depsReais();
    expect(await reais.tomarVez(AGORA)).toBe('tomada');
    expect(await reais.tomarVez(new Date(AGORA.getTime() + 60_000))).toBe('ocupada');
    expect(await reais.tomarVez(new Date(AGORA.getTime() + 11 * 60_000))).toBe('tomada');
    expect(banco.linhas('system_state').filter(l => String(l.key).startsWith('usu_rec_vez:'))).toHaveLength(2);
    await reais.limparVezes(new Date(AGORA.getTime() + 3 * HORA));
    expect(banco.linhas('system_state').filter(l => String(l.key).startsWith('usu_rec_vez:'))).toHaveLength(0);
  });

  it('leitura do público que falha: ok false, sem envio; fila vazia: nada a fazer', async () => {
    expect(await rodar(falsas(gente(1), { lerPublico: async () => null }).d)).toMatchObject({ ok: false, motivo: 'leitura_do_publico_falhou' });
    const vazia = falsas([]);
    expect(await rodar(vazia.d)).toMatchObject({ ok: true, candidatos: 0, enviou: false });
    expect(vazia.e.resumos).toHaveLength(1);
  });

  it('as listas de barragem que falham: ok false, sem envio', async () => {
    const { d, e } = falsas(gente(2), { listas: async () => { throw new Error('caiu'); } });
    expect(await rodar(d)).toMatchObject({ ok: false, motivo: 'listas_de_barragem_falhou', enviou: false });
    expect(e.chamadas).not.toContain('claim');
  });

  it('no máximo 8 pessoas são avaliadas por rodada', async () => {
    const { d, e } = falsas(gente(12), { posse: async () => ({ estado: 'encerrada' }) });
    const r = await rodar(d);
    expect(AVALIACOES_POR_RODADA).toBe(8);
    expect(r.avaliados).toBe(8);
    expect(r.puladas.limite_por_rodada).toBe(1);
    expect(e.fora).toHaveLength(8);
    expect(r.enviou).toBe(false);
  });
});

describe('rodada: as conferências por pessoa e as marcas', () => {
  const um = gente;
  const rodaUma = async (over: Partial<DepsRet>) => {
    const { d, e } = falsas(um(1), over);
    const r = await rodar(d);
    return { r, e };
  };
  const esperaMarca = (e: Espiao, motivo: string, ate?: string) => {
    expect(e.fora, motivo).toHaveLength(1);
    expect(e.fora[0]).toMatchObject({ motivo });
    if (ate === undefined) expect(e.fora[0]!.marca).toEqual({}); else expect(e.fora[0]!.marca).toEqual({ ate });
  };

  it('suprimido, bloqueado, número de teste: +30 dias', async () => {
    const mais30 = ISO(AGORA.getTime() + 30 * DIA);
    let x = await rodaUma({ listas: async () => ({ silenciado: () => true, bloqueado: () => false, mudo: () => false }) });
    expect(x.r.puladas).toEqual({ suprimido: 1 }); esperaMarca(x.e, 'suprimido', mais30);
    x = await rodaUma({ listas: async () => ({ silenciado: () => false, bloqueado: () => true, mudo: () => false }) });
    expect(x.r.puladas).toEqual({ bloqueado: 1 }); esperaMarca(x.e, 'bloqueado', mais30);
    x = await rodaUma({ ehNumeroDeTeste: async () => true });
    expect(x.r.puladas).toEqual({ numero_de_teste: 1 }); esperaMarca(x.e, 'numero_de_teste', mais30);
  });

  it('teste ilegível, posse ilegível e conversa incompleta: leitura_falhou, SEM marca', async () => {
    for (const over of [
      { ehNumeroDeTeste: async () => null }, { posse: async () => 'erro' as const }, { conversa: async () => ({ msgs: [], completa: false }) },
      { fatosPorteiro: async () => ({ ...FATOS_OK, leituraOk: false }) },
    ] as Array<Partial<DepsRet>>) {
      const x = await rodaUma(over);
      expect(x.r.puladas).toEqual({ leitura_falhou: 1 });
      expect(x.e.fora).toHaveLength(0);
      expect(x.r.enviou).toBe(false);
    }
  });

  it('posse que já existe (qualquer dona e estado): posse_existente:<estado>, +7 dias', async () => {
    const x = await rodaUma({ posse: async () => ({ estado: 'encerrada' }) });
    expect(x.r.puladas).toEqual({ 'posse_existente:encerrada': 1 });
    esperaMarca(x.e, 'posse_existente:encerrada', ISO(AGORA.getTime() + 7 * DIA));
    expect(x.e.chamadas).not.toContain('telefoneExiste');
  });

  it('toque recente em 14 dias: a marca vale até 14 dias depois do toque', async () => {
    const x = await rodaUma({ conversa: async () => ({ msgs: [msg('robo', 3 * DIA)], completa: true }) });
    expect(x.r.puladas).toEqual({ toque_recente_14d: 1 });
    esperaMarca(x.e, 'toque_recente_14d', ISO(AGORA.getTime() - 3 * DIA + 14 * DIA));
  });

  it('fala do lead nas 24 h: a marca vale até 24 h depois da fala', async () => {
    const x = await rodaUma({ conversa: async () => ({ msgs: [msg('lead', 2 * HORA)], completa: true }) });
    expect(x.r.puladas).toEqual({ falou_nas_24h: 1 });
    esperaMarca(x.e, 'falou_nas_24h', ISO(AGORA.getTime() - 2 * HORA + 24 * HORA));
  });

  it('mudo pela conversa: marca para sempre (sem `ate`)', async () => {
    const msgs = [msg('robo', 20 * DIA, 1), msg('robo', 25 * DIA, 2), msg('robo', 30 * DIA, 3)];
    const x = await rodaUma({ conversa: async () => ({ msgs, completa: true }) });
    expect(x.r.puladas).toEqual({ mudo_pela_conversa: 1 });
    esperaMarca(x.e, 'mudo_pela_conversa');
  });

  it('gente da equipe na conversa +24 h, outro robô +3 dias, telefone que não casa com a conta +7 dias', async () => {
    let x = await rodaUma({ fatosPorteiro: async () => ({ ...FATOS_OK, humanoNaConversa: true }) });
    expect(x.r.puladas).toEqual({ humano_na_conversa: 1 }); esperaMarca(x.e, 'humano_na_conversa', ISO(AGORA.getTime() + DIA));
    x = await rodaUma({ fatosPorteiro: async () => ({ ...FATOS_OK, outroRoboAtivo: true }) });
    expect(x.r.puladas).toEqual({ outro_robo: 1 }); esperaMarca(x.e, 'outro_robo', ISO(AGORA.getTime() + 3 * DIA));
    x = await rodaUma({ fatosPorteiro: async () => ({ ...FATOS_OK, ehClienteSolarDoc: false }) });
    expect(x.r.puladas).toEqual({ telefone_nao_casa_com_a_conta: 1 }); esperaMarca(x.e, 'telefone_nao_casa_com_a_conta', ISO(AGORA.getTime() + 7 * DIA));
  });

  it('reunião de eletroposto marcada: reuniao_ativa, marca de 7 dias, e a pessoa não entra na fila', async () => {
    const x = await rodaUma({ fatosPorteiro: async () => ({ ...FATOS_OK, reuniaoEletroposto: true }) });
    expect(x.r.puladas).toEqual({ reuniao_ativa: 1 }); esperaMarca(x.e, 'reuniao_ativa', ISO(AGORA.getTime() + 7 * DIA));
  });

  it('a Carla não atende esta pessoa: carla_nao_atende, sem marca', async () => {
    const x = await rodaUma({ carlaAtende: async () => false });
    expect(x.r.puladas).toEqual({ carla_nao_atende: 1 });
    expect(x.e.fora).toHaveLength(0);
  });

  it('a ordem das conferências: a supressão vem antes da posse, e a posse antes da conversa', async () => {
    const supressaoEPosse = await rodaUma({
      listas: async () => ({ silenciado: () => true, bloqueado: () => false, mudo: () => false }), posse: async () => ({ estado: 'viva' }),
    });
    expect(supressaoEPosse.r.puladas).toEqual({ suprimido: 1 });
    const posseEConversa = await rodaUma({ posse: async () => ({ estado: 'viva' }), conversa: async () => ({ msgs: [msg('robo', DIA)], completa: true }) });
    expect(posseEConversa.r.puladas).toEqual({ 'posse_existente:viva': 1 });
  });

  it('o phone-exists "não" marca para sempre e NÃO grava usu_rec_sent; "erro" para a rodada', async () => {
    const nao = falsas(gente(2), { telefoneExiste: async () => 'nao' });
    const r = await rodar(nao.d);
    expect(r.puladas.sem_whatsapp).toBe(2);
    expect(nao.e.fora.map(f => f.motivo)).toEqual(['sem_whatsapp', 'sem_whatsapp']);
    expect(nao.e.fora.every(f => Object.keys(f.marca).length === 0)).toBe(true);
    expect(nao.e.claims.size).toBe(0);
    expect(r.enviou).toBe(false);
    const erro = falsas(gente(2), { telefoneExiste: async () => 'erro' });
    const r2 = await rodar(erro.d);
    expect(r2.decisoes).toEqual([expect.objectContaining({ resultado: 'parou', motivo: 'phone_exists_falhou' })]);
    expect(r2.avaliados).toBe(1);
  });

  it('a pessoa barrada vai para a próxima da fila: a 1ª suprimida, a 2ª recebe', async () => {
    const us = gente(3);
    const primeiro = ordenarFila(montarFila({ usuarios: us, extras: () => EXTRAS_VAZIOS, chavesDaCasa: new Set() }, AGORA.getTime(), LARGADA).fila)[0]!;
    const { d, e } = falsas(us, { listas: async () => ({ silenciado: (tel: string) => chaveContato(tel) === chaveContato(primeiro.tel), bloqueado: () => false, mudo: () => false }) });
    const r = await rodar(d);
    expect(r.enviou).toBe(true);
    expect(r.puladas.suprimido).toBe(1);
    expect(e.enviados).toHaveLength(1);
    expect(chaveContato(e.enviados[0]!.tel)).not.toBe(chaveContato(primeiro.tel));
  });
});

describe('rodada: claim, posse e releitura', () => {
  it('o claim é por INSERT: o carimbo leva o estado, o grupo e a variação, e a posse leva a origem e os dados da retomada com `ate` em 30 dias', async () => {
    const [u] = [usuario({ last_canceled_at: ISO(AGORA.getTime() - 40 * DIA) })];
    const { d, e } = falsas([u], {}, () => extras({ vendas: [venda()] }));
    const r = await rodar(d);
    expect(r.enviou).toBe(true);
    const chave = `${PREFIXO_CARIMBO_RET}${hmacDoUsuario(u)}`;
    expect(e.claims.get(chave)).toMatchObject({ estado: 'enviado', user_id: u.id, segmento: 'ex_assinante', grupo: 'pagou', variacao: expect.any(Number) });
    const p = e.posses[0]!;
    expect(p.chave).toBe(chaveDe(u));
    expect(p.extra).toMatchObject({ origem: 'retomada_usuarios' });
    const ret = p.extra.retomada as Record<string, unknown>;
    expect(ret).toMatchObject({ user_id: u.id, segmento: 'ex_assinante', grupo: 'pagou', primeiro_nome: 'Ana', em: p.em });
    expect(ret.texto).toBe(e.enviados[0]!.texto);
    expect(Date.parse(String(ret.ate)) - Date.parse(String(ret.em))).toBe(30 * DIA);
    // a ordem: claim, posse, releitura e só então o envio
    expect(e.chamadas.filter(c => ['claim', 'assumirPosse', 'enviar', 'marcarClaim', 'envioOk'].includes(c))).toEqual(['claim', 'assumirPosse', 'enviar', 'marcarClaim', 'envioOk']);
  });

  it('o 23505 do claim (já existia) não envia e passa para a próxima pessoa', async () => {
    const us = gente(2);
    const { d, e } = falsas(us);
    const primeiro = montarFila({ usuarios: us, extras: () => EXTRAS_VAZIOS, chavesDaCasa: new Set() }, AGORA.getTime(), LARGADA).fila[0]!;
    e.claims.set(`${PREFIXO_CARIMBO_RET}${primeiro.hmac}`, { estado: 'enviado' });
    const r = await rodar(d);
    expect(r.puladas.ja_reivindicado).toBe(1);
    expect(r.enviou).toBe(true);
    expect(e.enviados).toHaveLength(1);
  });

  it('claim com erro para a rodada, sem envio', async () => {
    const { d, e } = falsas(gente(2), { claim: async () => 'erro' });
    const r = await rodar(d);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'parou', motivo: 'erro_no_claim' });
    expect(e.chamadas).not.toContain('enviar');
  });

  it('posse tomada no meio: o claim sai e a rodada segue para a próxima', async () => {
    let n = 0;
    const { d, e } = falsas(gente(2), { assumirPosse: async () => (++n === 1 ? 'ja_tinha_dona' : 'assumida') });
    const r = await rodar(d);
    expect(r.puladas.posse_tomada_agora).toBe(1);
    expect(e.chamadas).toContain('apagarClaim');
    expect(r.enviou).toBe(true);
    expect(e.claims.size).toBe(1);
  });

  it('posse com erro: relê pelo posseAindaNossa; se não é nossa, apaga o claim e para a rodada', async () => {
    const sem = falsas(gente(2), { assumirPosse: async () => 'erro', posseAindaNossa: async () => false });
    const r = await rodar(sem.d);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'parou', motivo: 'posse_falhou' });
    expect(sem.e.claims.size).toBe(0);
    const com = falsas(gente(1), { assumirPosse: async () => 'erro', posseAindaNossa: async () => true });
    expect((await rodar(com.d)).enviou).toBe(true);
  });

  const releituras: Array<[string, Partial<DepsRet>]> = [
    ['mensagem nova na conversa', { conversa: (() => { let n = 0; return async () => ({ msgs: ++n === 1 ? [] : [msg('lead', 1000, 99)], completa: true }); })() }],
    ['conversa ilegível', { conversa: (() => { let n = 0; return async () => ({ msgs: [], completa: ++n === 1 }); })() }],
    ['gente da equipe entrou', { podeFalarAgora: async () => 'nao' }],
    ['pausa humana ilegível', { podeFalarAgora: async () => 'erro' }],
    ['supressão apareceu', { supressao: async () => ['opt_out'] }],
    ['supressão ilegível', { supressao: async () => null }],
    ['posse deixou de ser nossa', { posseAindaNossa: async () => false }],
    ['a conta pediu opt-out depois da leitura do público', { contaAgora: async () => ({ plano: 'free', billing_status: null, plano_expira_em: null, whatsapp_opt_out: true }) }],
    ['a conta passou a pagar depois da leitura do público', { contaAgora: async () => ({ plano: 'ilimitado', billing_status: 'active', plano_expira_em: null, whatsapp_opt_out: false }) }],
    ['a conta sumiu (o opt-out da Giovanna apaga a conta grátis)', { contaAgora: async () => 'sumiu' }],
    ['a conta ficou ilegível', { contaAgora: async () => null }],
  ];
  it.each(releituras)('releitura antes do envio: %s desfaz a posse e o claim e não envia', async (_nome, over) => {
    const { d, e } = falsas(gente(1), over);
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'abortou' });
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).toContain('apagarClaim');
    expect(e.chamadas).not.toContain('enviar');
    expect(e.claims.size).toBe(0);
  });

  it.each([
    ['opt-out', { plano: 'free', billing_status: null, plano_expira_em: null, whatsapp_opt_out: true }, 'releitura_opt_out'],
    ['plano pago', { plano: 'ilimitado', billing_status: 'active', plano_expira_em: null, whatsapp_opt_out: false }, 'releitura_paga_hoje'],
    ['Pix com prazo no futuro', { plano: 'free', billing_status: null, plano_expira_em: new Date(AGORA.getTime() + 86_400_000).toISOString(), whatsapp_opt_out: false }, 'releitura_paga_hoje'],
  ] as const)('a conta muda entre a leitura do público e o envio (%s): nada sai, nenhum carimbo fica e o motivo vai em puladas', async (_n, conta, motivo) => {
    const lidas: string[] = [];
    const { d, e } = falsas(gente(1), { contaAgora: async (id) => { lidas.push(id); return { ...conta }; } });
    const r = await rodar(d);
    expect(lidas).toHaveLength(1);
    expect(r.enviou).toBe(false);
    expect(r.puladas[motivo]).toBe(1);
    expect(e.enviados).toHaveLength(0);
    expect(e.claims.size).toBe(0);
    expect(e.chamadas).not.toContain('envioOk');
  });
});

describe('rodada: erros de envio', () => {
  const comErro = (err: Error) => falsas(gente(2), { enviar: async () => { throw err; } });
  const unicoClaim = (e: Espiao) => [...e.claims.values()][0];

  it('destino (número inválido): o claim fica como destino, a posse volta e NÃO conta como erro da linha', async () => {
    const { d, e } = comErro(new Error('Z-API HTTP 400: número inválido'));
    const r = await rodar(d);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'envio_falhou', motivo: 'destino' });
    expect(unicoClaim(e)).toMatchObject({ estado: 'destino' });
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).not.toContain('erroDeLinha');
    expect(e.chamadas).not.toContain('envioOk');
  });

  it('erro que prova que nada saiu (cooldown, credencial): apaga o claim e a posse e conta o erro', async () => {
    const { d, e } = comErro(new Error('instância em cooldown'));
    const r = await rodar(d);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'envio_falhou', motivo: 'cooldown' });
    expect(e.claims.size).toBe(0);
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).toContain('erroDeLinha');
  });

  it('timeout ou 5xx: o claim fica como incerto, a posse fica e o erro conta', async () => {
    for (const err of [new Error('timeout'), new Error('Z-API HTTP 502')]) {
      const { d, e } = comErro(err);
      const r = await rodar(d);
      expect(r.enviou).toBe(false);
      expect(unicoClaim(e)).toMatchObject({ estado: 'incerto' });
      expect(e.chamadas).not.toContain('desfazerPosse');
      expect(e.chamadas).toContain('erroDeLinha');
    }
  });

  it('o envio que devolveu false (a pausa calou): o claim fica como nao_saiu e a posse volta', async () => {
    const { d, e } = falsas(gente(2), { enviar: async () => false });
    const r = await rodar(d);
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'nao_enviou', motivo: 'envio_nao_saiu' });
    expect(unicoClaim(e)).toMatchObject({ estado: 'nao_saiu' });
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).not.toContain('envioOk');
  });

  it('todo erro encerra a rodada: só uma pessoa é tentada', async () => {
    const { d, e } = comErro(new Error('timeout'));
    await rodar(d);
    expect(e.chamadas.filter(c => c === 'claim')).toHaveLength(1);
  });

  it('o 2º erro seguido grava a pausa da linha por 15 min E a pausa da campanha com o motivo dois_erros_de_linha', async () => {
    const reais = depsReais();
    await reais.erroDeLinha(AGORA);
    expect(banco.linhas('system_state').find(l => l.key === 'ag5040_linha_pausa')).toBeUndefined();
    expect(banco.linhas('system_state').find(l => l.key === 'usu_rec_pausa')).toBeUndefined();
    await reais.erroDeLinha(AGORA);
    const linha = banco.linhas('system_state').find(l => l.key === 'ag5040_linha_pausa')!;
    expect(linha.value).toMatchObject({ motivo: 'erros_seguidos', n: 2 });
    expect(Date.parse(linha.value.ate) - AGORA.getTime()).toBe(15 * 60_000);
    expect(banco.linhas('system_state').find(l => l.key === 'usu_rec_pausa')!.value).toMatchObject({ motivo: 'dois_erros_de_linha', n: 2 });
    expect((await estadoRetomadaUsuarios({ env: {}, agora: AGORA.getTime() })).ligada).toBe(false);
  });

  it('um envio ok zera o contador de erros', async () => {
    const reais = depsReais();
    await reais.erroDeLinha(AGORA);
    await reais.envioOk(AGORA);
    expect(banco.linhas('system_state').find(l => l.key === 'ag5040_linha_erros')!.value).toMatchObject({ n: 0 });
  });
});

// ── o resumo e o modo seco ───────────────────────────────────────────────────

describe('resumo da rodada', () => {
  it('grava usu_rec_resumo com a fila e as contagens, sem telefone nem e-mail', async () => {
    const us = [...gente(3), usuario({ plano: 'ilimitado' })];
    const { d, e } = falsas(us);
    await rodar(d);
    const primeiro = e.resumos[0] as { em: string; fila: number; por_motivo: Record<string, number> };
    expect(primeiro).toMatchObject({ fila: 3, por_motivo: { paga_hoje: 1 } });
    const ultimo = e.resumos[e.resumos.length - 1] as { avaliados: number; enviou: boolean };
    expect(ultimo).toMatchObject({ avaliados: 1, enviou: true });
    const texto = JSON.stringify(e.resumos);
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toMatch(/@/);
  });

  it('o gravarResumo de verdade faz upsert em system_state', async () => {
    const reais = depsReais();
    await reais.gravarResumo({ em: AGORA.toISOString(), fila: 2, por_motivo: { paga_hoje: 1 }, avaliados: 0, enviou: false });
    await reais.gravarResumo({ em: AGORA.toISOString(), fila: 2, por_motivo: { paga_hoje: 1 }, avaliados: 1, enviou: true });
    const linhas = banco.linhas('system_state').filter(l => l.key === 'usu_rec_resumo');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.value).toMatchObject({ avaliados: 1, enviou: true });
  });
});

describe('modo seco', () => {
  const boasContas = (): UsuarioRet[] => [
    usuario({ nome: 'carlos ex', last_canceled_at: ISO(AGORA.getTime() - 20 * DIA), whatsapp_replied_at: ISO(AGORA.getTime() - 15 * DIA) }),
    usuario({ nome: 'bruna' }), usuario({ nome: 'eng flavio' }), usuario({ nome: 'diego' }), usuario({ plano: 'ilimitado' }),
  ];

  it('lista os N primeiros na ordem, com segmento, grupo, o motivo de cada exclusão e a mensagem exata', async () => {
    const us = boasContas();
    const fila = montarFila({ usuarios: us, extras: () => EXTRAS_VAZIOS, chavesDaCasa: new Set() }, AGORA.getTime(), LARGADA).fila;
    const barrado = fila[1]!;
    const { d } = falsas(us, { posse: async () => 'livre', listas: async () => ({ silenciado: (tel: string) => chaveContato(tel) === chaveContato(barrado.tel), bloqueado: () => false, mudo: () => false }) });
    const s = await sondarRetomadaUsuarios({ n: 3, agora: AGORA }, d);
    expect(s.total_lido).toBe(5);
    expect(s.na_fila).toBe(4);
    expect(s.por_motivo).toEqual({ paga_hoje: 1 });
    expect(s.linhas.map(l => l.posicao)).toEqual([1, 2, 3]);
    expect(s.linhas[0]).toMatchObject({ situacao: 'elegivel', segmento: 'ex_assinante', grupo: 'incerto', respondeu: true, nome: 'carlos' });
    expect(s.linhas[0]!.texto).toMatch(/^Oi, Carlos\. Aqui é a Carla, da SolarDoc\. Passando pra contar/);
    expect(s.linhas[1]).toMatchObject({ situacao: 'pulado', motivo: 'suprimido', texto: null });
    expect(s.linhas[2]).toMatchObject({ situacao: 'elegivel' });
    expect(s.linhas[2]!.texto).toMatch(/^Oi\. Aqui é a Carla|^Oi, \w+\. Aqui é a Carla/);
  });

  it('traz a linha na hora, o limite, o início efetivo, a janela, as vagas do frio e os estados da trava', async () => {
    const { d } = falsas(boasContas(), { linhaNaHora: async () => 2, vagasDoFrio: async () => ({ hora: { teto: 6, usadas: 2 }, dia: { teto: 30, usadas: 9 } }) });
    const s = await sondarRetomadaUsuarios({ agora: AGORA }, d);
    expect(s).toMatchObject({
      estado: { ligada: true, motivo: 'ligada' }, linha_na_hora: 2, linha_limite: 4, janela_agora: true, linha_pausada: 'nao', teto_campanha: 'ok',
      carla_atende_todos: true, ia_parada: false, sem_texto: false, largada: ISO(LARGADA), inicio: ISO(PISO),
      vagas_do_frio: { hora: { teto: 6, usadas: 2 }, dia: { teto: 30, usadas: 9 } },
    });
  });

  it('leitura que falha vira "sem número" (null), nunca um zero inventado', async () => {
    const { d } = falsas(boasContas(), {
      linhaNaHora: async () => { throw new Error('caiu'); }, vagasDoFrio: async () => { throw new Error('caiu'); }, tetoCampanha: async () => 'erro',
    });
    const s = await sondarRetomadaUsuarios({ agora: AGORA }, d);
    expect(s.linha_na_hora).toBeNull();
    expect(s.vagas_do_frio).toBeNull();
    expect(s.teto_campanha).toBe('erro');
  });

  it('o piso por preencher aparece como início null, e a largada ausente vale "agora"', async () => {
    const { d, e } = falsas(boasContas(), { lerLargada: async () => null, pisoInicioMs: () => NaN });
    const s = await sondarRetomadaUsuarios({ agora: AGORA }, d);
    expect(s.largada).toBeNull();
    expect(s.inicio).toBeNull();
    expect(s.na_fila).toBe(4);       // tudo foi criado antes de "agora"
    expect(e.chamadas).not.toContain('garantirLargada');
  });

  it('o n fica entre 1 e 40', async () => {
    const { d } = falsas(gente(60));
    expect((await sondarRetomadaUsuarios({ n: 100, agora: AGORA }, d)).linhas).toHaveLength(40);
    expect((await sondarRetomadaUsuarios({ n: 0, agora: AGORA }, d)).linhas).toHaveLength(20);
    expect((await sondarRetomadaUsuarios({ n: -3, agora: AGORA }, d)).linhas).toHaveLength(1);
    expect((await sondarRetomadaUsuarios({ agora: AGORA }, d)).linhas).toHaveLength(20);
  });

  it('não toma a vez, não faz claim nem posse, não marca, não confere o WhatsApp e não envia', async () => {
    const { d, e } = falsas(boasContas());
    await sondarRetomadaUsuarios({ n: 10, agora: AGORA }, d);
    for (const proibida of ['tomarVez', 'claim', 'apagarClaim', 'marcarClaim', 'assumirPosse', 'desfazerPosse', 'marcarFora', 'telefoneExiste', 'enviar', 'garantirLargada', 'erroDeLinha']) {
      expect(e.chamadas, proibida).not.toContain(proibida);
    }
    expect(e.enviados).toHaveLength(0);
    expect(e.fora).toHaveLength(0);
  });

  it('o resultado não traz telefone nem e-mail', async () => {
    const us = boasContas();
    const { d } = falsas(us);
    const s = await sondarRetomadaUsuarios({ n: 10, agora: AGORA }, d);
    const texto = JSON.stringify(s);
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toMatch(/@exemplo\.com/);
    for (const u of us) expect(texto).not.toContain(String(u.whatsapp));
  });

  it('o público que não leu devolve só o cabeçalho, sem linhas', async () => {
    const { d } = falsas(boasContas(), { lerPublico: async () => null });
    const s = await sondarRetomadaUsuarios({ agora: AGORA }, d);
    expect(s.linhas).toEqual([]);
    expect(s.total_lido).toBe(0);
  });
});

describe('o público lido de verdade (depsReais.lerPublico) sobre o banco em memória', () => {
  const reais = depsReais();

  it('lê as extras (vendas, documentos, empresa, curso, NEXUS, carimbos e marcas) só dos candidatos, e a fila sai certa', async () => {
    const u1 = usuario({ email: 'Ana@Exemplo.com' });                                    // candidato: venda paga, documento e CNPJ
    const u2 = usuario({ last_canceled_at: ISO(AGORA.getTime() - 30 * DIA) });           // convite da NEXUS há 2 h
    const u3 = usuario();                                                                // já na campanha
    const u4 = usuario();                                                                // marcado fora, sem prazo
    const pago = usuario({ plano: 'ilimitado' });                                        // nem chega à 2ª leitura
    banco.poe('users', ...[u1, u2, u3, u4, pago].map(u => ({ ...u })));
    const docEm = AGORA.getTime() - 5 * DIA;
    banco.poe('sales', { email: 'ana@exemplo.com', valor: 67, status: 'paid', subscription_id: 's1' });
    banco.poe('documents', { user_id: u1.id, created_at: ISO(docEm - 3000) }, { user_id: u1.id, created_at: ISO(docEm) });
    banco.poe('company', { user_id: u1.id, cnpj: '11.222.333/0001-81' }, { user_id: u2.id, cnpj: '123' });
    const quando = ISO(AGORA.getTime());
    banco.poe('system_state',
      { key: `curso19:${u2.id}`, value: { count: 2 }, updated_at: quando },
      { key: `nexus_convite_email:${u2.id}`, value: {}, updated_at: ISO(AGORA.getTime() - 2 * HORA) },
      { key: `${PREFIXO_CARIMBO_RET}${hmacDoUsuario(u3)}`, value: { estado: 'enviado', user_id: u3.id }, updated_at: quando },
      { key: `${PREFIXO_FORA_RET}${hmacDoUsuario(u4)}`, value: { motivo: 'sem_whatsapp' }, updated_at: quando },
      { key: `${PREFIXO_FORA_RET}${hmacDoUsuario(u1)}`, value: { motivo: 'x', ate: ISO(AGORA.getTime() - DIA) }, updated_at: quando });

    const pub = await reais.lerPublico(AGORA, LARGADA);
    expect(pub).not.toBeNull();
    const r = montarFila(pub!, AGORA.getTime(), LARGADA);
    expect(r.total).toBe(5);
    expect(r.porMotivo).toEqual({ paga_hoje: 1, email_nexus_24h: 1, ja_na_campanha: 1, 'fora_marcado:sem_whatsapp': 1 });
    expect(r.fila).toHaveLength(1);
    expect(r.fila[0]).toMatchObject({ segmento: 'ex_assinante', grupo: 'pagou', saiuEm: null, formaAntiga: null });
    expect(pub!.extras(u1)).toMatchObject({ temCnpj: true, ultimoDocumentoBrutoMs: docEm, vendas: [expect.objectContaining({ status: 'paid' })] });
    expect(pub!.extras(u2)).toMatchObject({ toquesCurso19: 2, nexusConviteEmMs: AGORA.getTime() - 2 * HORA, temCnpj: false });
    expect(pub!.extras(pago)).toEqual(EXTRAS_VAZIOS);
    // as chaves da casa levam a 5040, os reservas, o dono e os consultores
    expect(pub!.chavesDaCasa.has(chaveContato(TELEFONE_DA_LINHA_5040)!)).toBe(true);
    expect(pub!.chavesDaCasa.has(chaveContato('34991516846')!)).toBe(true);
  });

  it('banco dos consultores que falha: o público não é lido (falha fechada, nunca arrisca chamar um consultor)', async () => {
    banco.poe('users', { ...usuario() });
    h.consultoresFalham = true;
    expect(await reais.lerPublico(AGORA, LARGADA)).toBeNull();
  });

  it('leitura de `users` que falha: o público não é lido', async () => {
    banco.falhas['users.select'] = { erro: { message: 'caiu' } };
    expect(await reais.lerPublico(AGORA, LARGADA)).toBeNull();
  });

  it('o resumo e as marcas não levam telefone: a marca guarda só o motivo, a hora e o prazo', async () => {
    await reais.marcarFora('abc123', 'suprimido', { ate: ISO(AGORA.getTime() + DIA) }, AGORA);
    await reais.marcarFora('def456', 'sem_whatsapp', {}, AGORA);
    const marcas = banco.linhas('system_state').filter(l => String(l.key).startsWith(PREFIXO_FORA_RET));
    expect(marcas.map(m => m.value)).toEqual([
      { motivo: 'suprimido', em: AGORA.toISOString(), ate: ISO(AGORA.getTime() + DIA) }, { motivo: 'sem_whatsapp', em: AGORA.toISOString() },
    ]);
  });
});

describe('mascararEmail: o e-mail da conta com o meio coberto para o Pix automático', () => {
  it('mostra até 2 letras do começo, *** e o domínio; começo curto mostra 1; sem e-mail válido é null', () => {
    expect(Regras.mascararEmail('Joao@Gmail.com')).toBe('jo***@gmail.com');
    expect(Regras.mascararEmail(' ana@exemplo.com ')).toBe('a***@exemplo.com');
    expect(Regras.mascararEmail('a@x.com')).toBe('a***@x.com');
    for (const x of ['', null, undefined, 'semarroba', '@x.com', 'a@', 'a b@x.com', 'a@semponto']) expect(Regras.mascararEmail(x), String(x)).toBeNull();
  });
});
