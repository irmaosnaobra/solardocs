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
  CHAVES_TEXTO, PREFIXO_SONDA_CARIMBO_RET, PREFIXO_SONDA_CLAIM_RET, PREFIXO_SONDA_FALHOU_RET, PREFIXO_SONDA_OK_RET,
  VARIACOES_RETOMADA, chaveDoTexto, chaveVezRet, chavesRepetidas, classificarUsuario, faixaDe, grupoDoTexto, hashEstavel, inicioEfetivoMs, inicioEmTexto,
  limiteCedeAAgenda, marcaDoMotivo, montarChavesDaCasa, motivoDaConversa, motivosDoTexto, mudoPelaConversa, ordenarFila, pagaHoje, paradaDoMotivo,
  nomeParaTexto, provaDePagamento, saidaDaConta, saudacao, segmentoDaConta, textoDaRetomada, textosVazios, usouAPlataforma, variacaoDe, variantesDaChaveRet,
  type ContextoClassificar, type ExtrasRet, type GrupoTexto, type UsuarioRet, type VendaRet,
} from '../services/solardoc/retomadaUsuariosRegras';
import {
  CHAVE_DISJUNTOR_RET, CHAVE_LINHA_PAUSA_RET, envDesligaRetomada, estadoRetomadaUsuarios, garantirLargadaRet, lerIaParada, lerLargadaRet,
  lerLinhaPausada, lerPausaRetomada, pausarRetomada, retomarRetomada,
} from '../services/solardoc/retomadaUsuariosEstado';
import {
  EXTRAS_VAZIOS, depsReais, montarFila, rodarSondaRetomada, runRetomadaUsuariosTick, sondarRetomadaUsuarios,
  type DepsRet, type DepsSonda, type PublicoLido, type RelatorioRet, type VagasFrio,
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
    for (const billing_status of ['trialing', 'past_due', 'unpaid', 'suspended']) expect(u({ billing_status }), billing_status).toBe(true);
    expect(u({ plano: 'ilimitado', billing_status: 'active' })).toBe(true);
    expect(u({ plano: 'pro', billing_status: 'active' })).toBe(true);
    expect(u({ plano_expira_em: ISO(AGORA.getTime() + DIA) })).toBe(true);
  });

  it('free com billing_status "active" (o PADRÃO da coluna, 138 de 138 no banco em 05/11) NÃO é "paga hoje": sem pagamento vigente entra na fila', () => {
    expect(u({ billing_status: 'active' })).toBe(false);
    expect(u({ billing_status: 'active', plano_expira_em: null, last_canceled_at: ISO(AGORA.getTime() - 30 * DIA) } as never)).toBe(false);
    expect(u({ billing_status: 'active', plano_expira_em: ISO(AGORA.getTime() - DIA) })).toBe(false);          // Pix vencido
    expect(u({ billing_status: 'active', plano_expira_em: ISO(AGORA.getTime() + DIA) })).toBe(true);           // Pix ainda valendo
    const livre = usuario({ billing_status: 'active' });
    expect(classificar(livre).ok).toBe(true);
    expect(motivoDe(usuario({ billing_status: 'active', plano: 'ilimitado' }))).toBe('paga_hoje');
    expect(motivoDe(usuario({ billing_status: 'active', plano: 'pro' }))).toBe('paga_hoje');
  });

  it('a fila do público lido: 3 free "active" entram, o pagante "active" e o free em cobrança ficam de fora', () => {
    const livres = [usuario({ billing_status: 'active' }), usuario({ billing_status: 'active' }), usuario({ billing_status: 'active', last_canceled_at: ISO(AGORA.getTime() - 40 * DIA) })];
    const fora = [usuario({ plano: 'ilimitado', billing_status: 'active' }), usuario({ plano: 'pro', billing_status: 'active' }), usuario({ billing_status: 'past_due' })];
    const pub: PublicoLido = { usuarios: [...livres, ...fora], extras: () => EXTRAS_VAZIOS, chavesDaCasa: new Set() };
    const r = montarFila(pub, AGORA.getTime(), LARGADA);
    expect(r.fila.map(i => i.u.id).sort()).toEqual(livres.map(u => u.id).sort());
    expect(r.porMotivo).toEqual({ paga_hoje: 3 });
  });

  it('falha segura: a conta que não deu para reler (contaAgora null) para a rodada e não envia; a lida como paga não envia', async () => {
    const nulo = falsas(gente(2), { contaAgora: async () => null });
    expect(await rodar(nulo.d)).toMatchObject({ enviou: false, avaliados: 1 });
    expect(nulo.e.enviados).toHaveLength(0);
    const paga = falsas(gente(1), { contaAgora: async () => ({ plano: 'pro', billing_status: 'active', plano_expira_em: null, whatsapp_opt_out: false }) });
    expect(await rodar(paga.d)).toMatchObject({ enviou: false });
    const livre = falsas(gente(1), { contaAgora: async () => ({ plano: 'free', billing_status: 'active', plano_expira_em: null, whatsapp_opt_out: false }) });
    expect(await rodar(livre.d)).toMatchObject({ enviou: true });
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
  const NOME_25 = 'Abcdefghijklmnopqrstuvwxy';        // 25 letras
  const NOME_30 = 'Abcdefghijklmnopqrstuvwxyzabcd';        // 30 letras, o maior nome que o primeiroNome aceita
  const hmacs = (n: number): string[] => Array.from({ length: n }, (_, i) => (i * 0x2000000).toString(16).padStart(8, '0') + '0'.repeat(56));
  const H = hmacs(1)[0]!;
  /** Um id de conta que cai no texto A (0) ou B (1) pelo hash estável. */
  const idDaVariacao = (v: 0 | 1): string => { for (let i = 0; i < 1000; i++) if (hashEstavel(`conta-${i}`) % 2 === v) return `conta-${i}`; throw new Error('sem id'); };
  const TEXTOS_LITERAIS = {
    usouA: 'Olá, {nome}. Aqui é a Carla, da SolarDoc. Você já usou a SolarDoc, e agora a proposta aceita inversores de marcas diferentes. Quer ver?',
    usouB: 'Opa, {nome}. Sou a Carla, da SolarDoc. Você testou a SolarDoc. Agora a IA lê a conta de luz e preenche o cadastro do cliente. Quer testar?',
    nuncaA: 'E aí, {nome}! Aqui é a Carla, da SolarDoc. Você criou sua conta e ainda não montou nenhuma proposta. Quer que eu te mostre como é?',
    nuncaB: 'Aqui é a Carla, da SolarDoc. Sua conta ficou parada, e o menu novo traz Nova proposta e Ler conta de luz no topo. Quer um passo a passo, {nome}?',
  } as const;
  const casos: Array<{ rotulo: keyof typeof TEXTOS_LITERAIS; usou: boolean; variante: 0 | 1 }> = [
    { rotulo: 'usouA', usou: true, variante: 0 }, { rotulo: 'usouB', usou: true, variante: 1 },
    { rotulo: 'nuncaA', usou: false, variante: 0 }, { rotulo: 'nuncaB', usou: false, variante: 1 },
  ];
  const gera = (usou: boolean, variante: 0 | 1, nome: string | null) =>
    textoDaRetomada('nunca_pagou', nome, H, VARIACOES_RETOMADA, { usou, idUsuario: idDaVariacao(variante) });

  it('os 4 textos de quem nunca pagou saem literais, com o nome em "Aaaa" (1ª maiúscula, resto minúsculo)', () => {
    for (const c of casos) {
      for (const nome of ['ana', 'ANA', 'aNa']) {
        const r = gera(c.usou, c.variante, nome);
        expect(r.ok, c.rotulo).toBe(true);
        if (r.ok) expect(r.texto, c.rotulo).toBe(TEXTOS_LITERAIS[c.rotulo].replace('{nome}', 'Ana'));
      }
      const joao = gera(c.usou, c.variante, 'joão');
      expect(joao.ok && joao.texto.includes('João'), c.rotulo).toBe(true);
    }
  });

  it('sem nome, o ", {nome}" some inteiro ("Olá, {nome}." vira "Olá."), e nunca sobra { ou }', () => {
    const esperado = {
      usouA: 'Olá. Aqui é a Carla, da SolarDoc. Você já usou a SolarDoc, e agora a proposta aceita inversores de marcas diferentes. Quer ver?',
      usouB: 'Opa. Sou a Carla, da SolarDoc. Você testou a SolarDoc. Agora a IA lê a conta de luz e preenche o cadastro do cliente. Quer testar?',
      nuncaA: 'E aí! Aqui é a Carla, da SolarDoc. Você criou sua conta e ainda não montou nenhuma proposta. Quer que eu te mostre como é?',
      nuncaB: 'Aqui é a Carla, da SolarDoc. Sua conta ficou parada, e o menu novo traz Nova proposta e Ler conta de luz no topo. Quer um passo a passo?',
    };
    for (const c of casos) {
      for (const nome of ['', '   ', null, undefined, 'ana@gmail.com', '{nome}', 'A{B', 'x.com', '11999990000']) {
        const r = gera(c.usou, c.variante, nome as string | null);
        expect(r.ok, `${c.rotulo} ${String(nome)}`).toBe(true);
        if (r.ok) { expect(r.texto, c.rotulo).toBe(esperado[c.rotulo]); expect(r.texto).not.toMatch(/[{}]/); }
      }
    }
  });

  it('com nome curto e com nome de 25 letras: até 160 caracteres, motivosDoTexto vazio, sem { }; o que não cabe com o nome perde o nome', () => {
    for (const c of casos) {
      for (const nome of ['Ana', NOME_25]) {
        const r = gera(c.usou, c.variante, nome);
        expect(r.ok, `${c.rotulo} ${nome}`).toBe(true);
        if (!r.ok) continue;
        expect(r.texto.length).toBeLessThanOrEqual(160);
        expect(motivosDoTexto(r.texto), r.texto).toEqual([]);
        expect(r.texto).not.toMatch(/[{}]/);
        const comNome = TEXTOS_LITERAIS[c.rotulo].replace('{nome}', nomeParaTexto(nome));
        if (comNome.length <= 160) expect(r.texto).toBe(comNome);
        else expect(r.texto).toBe(TEXTOS_LITERAIS[c.rotulo].replace(', {nome}', ''));
      }
    }
    // O B de quem nunca usou passa de 160 com 25 letras: o nome cai (a conta é feita aqui, não de cabeça).
    expect(TEXTOS_LITERAIS.nuncaB.replace('{nome}', NOME_25).length).toBeGreaterThan(160);
    const nuncaB = gera(false, 1, NOME_25);
    expect(nuncaB.ok && nuncaB.texto.endsWith('passo a passo?')).toBe(true);
    // O nome de 30 letras (o maior do primeiroNome) também sai inteiro e válido.
    for (const c of casos) { const r = gera(c.usou, c.variante, NOME_30); expect(r.ok && r.texto.length <= 160 && !/[{}]/.test(r.texto), c.rotulo).toBe(true); }
  });

  it('usou = documentos_usados > 0; nunca usou é o resto (zero, vazio, ilegível)', () => {
    expect(usouAPlataforma({ documentos_usados: 1 })).toBe(true);
    expect(usouAPlataforma({ documentos_usados: 12 })).toBe(true);
    expect(usouAPlataforma({ documentos_usados: '3' })).toBe(true);
    for (const v of [0, null, undefined, '', 'abc', -1]) expect(usouAPlataforma({ documentos_usados: v as never }), String(v)).toBe(false);
    expect(chaveDoTexto('nunca_pagou', true)).toBe('nunca_pagou_usou');
    expect(chaveDoTexto('nunca_pagou', false)).toBe('nunca_pagou_nunca_usou');
    expect(chaveDoTexto('pagou', true)).toBe('pagou');
    expect(chaveDoTexto('incerto', false)).toBe('incerto');
  });

  it('o perfil escolhe a lista: usou nunca recebe o texto de quem nunca usou, e o contrário', () => {
    for (let i = 0; i < 40; i++) {
      const u = textoDaRetomada('nunca_pagou', 'Ana', H, VARIACOES_RETOMADA, { usou: true, idUsuario: `c${i}` });
      const n = textoDaRetomada('nunca_pagou', 'Ana', H, VARIACOES_RETOMADA, { usou: false, idUsuario: `c${i}` });
      expect(u.ok && /^(Olá|Opa)/.test(u.texto)).toBe(true);
      expect(n.ok && /^(E aí|Aqui é a Carla)/.test(n.texto)).toBe(true);
    }
  });

  it('A e B alternam pelo hash estável do id da conta, não pelo hmac do telefone', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const vars = ids.map(id => (textoDaRetomada('nunca_pagou', 'Ana', H, VARIACOES_RETOMADA, { usou: true, idUsuario: id }) as { variacao: number }).variacao);
    expect(new Set(vars)).toEqual(new Set([0, 1]));
    for (let i = 0; i < ids.length; i++) {
      const outra = textoDaRetomada('nunca_pagou', 'Ana', hmacs(3)[2]!, VARIACOES_RETOMADA, { usou: true, idUsuario: ids[i] });
      expect(outra.ok && outra.variacao, ids[i]).toBe(vars[i]);
    }
    expect(hashEstavel('abc')).toBe(hashEstavel('abc'));
    expect(hashEstavel('abc')).not.toBe(hashEstavel('abd'));
  });

  it('nomeParaTexto: 1ª maiúscula, resto minúsculo; nome com algo além de letra, hífen e apóstrofo vira vazio', () => {
    expect(nomeParaTexto('ANA')).toBe('Ana');
    expect(nomeParaTexto('joão')).toBe('João');
    expect(nomeParaTexto("d'ávila")).toBe("D'ávila");
    expect(nomeParaTexto('')).toBe('');
    expect(nomeParaTexto(null)).toBe('');
    for (const ruim of ['a b', 'a1', 'a{b}', 'ana.com', 'ana@x']) expect(nomeParaTexto(ruim), ruim).toBe('');
  });

  it('"Oi, Ana." com nome de gente; "Oi." com e-mail, número, sigla, título e empresa (grupo incerto, que ainda leva {oi})', () => {
    expect(saudacao('Ana')).toBe('Oi, Ana.');
    expect(saudacao('')).toBe('Oi.');
    const t = textoDaRetomada('incerto', primeiroNome('ana paula souza'), H);
    expect(t.ok && t.texto.startsWith('Oi, Ana. Aqui é a Carla, da SolarDoc.')).toBe(true);
    for (const nome of ['ana@gmail.com', '11999990000', 'MF', 'Eng Flavio Peetz', 'Solar Energia', null, '']) {
      expect(primeiroNome(nome), String(nome)).toBe('');
      const r = textoDaRetomada('incerto', primeiroNome(nome), H);
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
    const enorme = 'N'.repeat(80);
    const r = textoDaRetomada('incerto', enorme, hmacs(2)[1]!);
    expect(r.ok && r.texto.startsWith('Oi. Aqui é a Carla')).toBe(true);
  });

  it('os 8 textos passam em motivosDoTexto sem nome e com o nome de 25 letras, e o pagou segue a entrevista de saída', () => {
    expect(VARIACOES_RETOMADA.pagou).toHaveLength(3);
    expect(VARIACOES_RETOMADA.nunca_pagou_usou).toHaveLength(2);
    expect(VARIACOES_RETOMADA.nunca_pagou_nunca_usou).toHaveLength(2);
    expect(VARIACOES_RETOMADA.incerto).toHaveLength(1);
    expect(VARIACOES_RETOMADA.pagou.map(t => t.length)).toEqual([93, 96, 92]);
    for (const k of CHAVES_TEXTO) {
      for (const m of VARIACOES_RETOMADA[k]) {
        const sem = m.replace(', {nome}', '').replace('{oi}', 'Oi.');
        expect(motivosDoTexto(sem), sem).toEqual([]);
        expect(sem.length, sem).toBeLessThanOrEqual(160);
        const com = m.replace('{nome}', NOME_25).replace('{oi}', saudacao(NOME_25));
        if (com.length <= 160) expect(motivosDoTexto(com), com).toEqual([]);
      }
    }
  });

  it('não leva link, emoji, travessão, R$ nem "hoje", e tem um "?" só, no fim', () => {
    for (const g of CHAVES_TEXTO) {
      for (const m of VARIACOES_RETOMADA[g]) {
        const t = m.replace('{oi}', 'Oi, Ana.').replace('{nome}', 'Ana');
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
    expect(motivosDoTexto('Olá, {nome}. Quer ver?')).toContain('modelo_sobrando');
    expect(motivosDoTexto('Oi, Ana. Quer ver o que tem de novo?')).toEqual([]);
  });

  it('pelo grupo: ninguém que nunca pagou leva "assinou", pagou nunca leva "testou" (o incerto só leva a C)', () => {
    for (const k of ['nunca_pagou_usou', 'nunca_pagou_nunca_usou'] as const) for (const m of VARIACOES_RETOMADA[k]) expect(m).not.toMatch(/assinou/);
    for (const m of VARIACOES_RETOMADA.pagou) expect(m).not.toMatch(/testou/);
    expect(VARIACOES_RETOMADA.incerto).toHaveLength(1);
    expect(VARIACOES_RETOMADA.incerto[0]).toMatch(/Passando pra contar que a plataforma mudou bastante/);
    expect(VARIACOES_RETOMADA.incerto[0]).not.toMatch(/assinou|testou/);
    for (const h8 of hmacs(8)) {
      const r = textoDaRetomada('incerto', 'Ana', h8);
      expect(r.ok && r.variacao).toBe(0);
    }
  });

  it('a variação do pagou é estável pelo hmac e cobre as 3', () => {
    expect(variacaoDe('00000000' + '0'.repeat(56), 3)).toBe(0);
    expect(variacaoDe('00000001' + '0'.repeat(56), 3)).toBe(1);
    expect(variacaoDe('00000002' + '0'.repeat(56), 3)).toBe(2);
    const h1 = hmacs(1)[0]!;
    expect(textoDaRetomada('pagou', 'Ana', h1)).toEqual(textoDaRetomada('pagou', 'Ana', h1));
    const usadas = new Set(hmacs(9).map(x => (textoDaRetomada('pagou', 'Ana', x) as { variacao: number }).variacao));
    expect(usadas).toEqual(new Set([0, 1, 2]));
  });

  it('com uma lista vazia, devolve sem_texto, e textosVazios acusa (qualquer das 4)', () => {
    const cheio = { pagou: ['Oi. Quer ver?'], nunca_pagou_usou: ['Oi. Quer ver?'], nunca_pagou_nunca_usou: ['Oi. Quer ver?'], incerto: ['Oi. Quer ver?'] };
    expect(Regras.textosVazios(cheio)).toBe(false);
    for (const k of CHAVES_TEXTO) expect(Regras.textosVazios({ ...cheio, [k]: [] } as never), k).toBe(true);
    expect(textoDaRetomada('pagou', 'Ana', H, { ...cheio, pagou: [] } as never)).toEqual({ ok: false, motivo: 'sem_texto' });
    expect(textoDaRetomada('nunca_pagou', 'Ana', H, { ...cheio, nunca_pagou_usou: [] } as never, { usou: true })).toEqual({ ok: false, motivo: 'sem_texto' });
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

describe('inicioEfetivoMs (D35, revisto em 05/11/2026): o início é o piso, quem libera é a sonda', () => {
  const ini = (largada: string, piso = 0) => new Date(inicioEfetivoMs(Date.parse(largada), piso)).toISOString();

  it('o início é o próprio piso: não há mais "dia do deploy" nem "9h do dia seguinte"', () => {
    expect(ini('2026-11-05T13:00:00.000Z', Date.parse('2026-11-05T17:00:00Z'))).toBe('2026-11-05T17:00:00.000Z');       // largada e piso no mesmo dia
    expect(ini('2026-11-07T15:00:00.000Z', Date.parse('2026-11-05T17:00:00Z'))).toBe('2026-11-05T17:00:00.000Z');       // largada depois do piso: o piso
    expect(ini('2026-11-03T18:00:00.000Z', Date.parse('2026-11-10T12:00:00.000Z'))).toBe('2026-11-10T12:00:00.000Z');
  });

  it('piso ou largada que não são data dão Infinity (nunca), e inicioEmTexto não escreve nada para eles', () => {
    expect(inicioEfetivoMs(Date.parse('2026-11-03T18:00:00.000Z'), NaN)).toBe(Infinity);
    expect(inicioEfetivoMs(NaN, PISO)).toBe(Infinity);
    expect(inicioEmTexto(Infinity)).toBeNull();
    expect(inicioEmTexto(Date.parse('2026-11-04T12:00:00.000Z'))).toBe('04/11');
  });

  it('o piso do código está preenchido com a data de 05/11/2026 às 17:00Z (a trava PISO_NAO_PREENCHIDO saiu)', () => {
    expect(INICIO_RETOMADA_ISO).toBe('2026-11-05T17:00:00Z');
    expect(Number.isFinite(Date.parse(INICIO_RETOMADA_ISO))).toBe(true);
    expect(Number.isFinite(inicioEfetivoMs(Date.parse('2026-11-05T13:00:00.000Z'), Date.parse(INICIO_RETOMADA_ISO)))).toBe(true);
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
    sondaEstado: async () => ({ estado: 'ok' }),
    sondaRodar: async () => { reg('sondaRodar'); return 'ok'; },
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

  it('no dia da largada, com o piso passado e a sonda ok, envia dentro da janela; fora dela não envia (o portão e as travas seguem)', async () => {
    const hoje = { garantirLargada: async () => Date.parse('2026-11-05T13:00:00.000Z'), pisoInicioMs: () => Date.parse('2026-11-05T17:00:00Z') };
    const dentro = falsas(gente(1), { ...hoje, ...comJanelaReal });
    expect(await rodar(dentro.d, new Date('2026-11-05T17:00:00.000Z'))).toMatchObject({ motivo: null, enviou: true });          // quinta 14h BRT
    const noPiso = falsas(gente(1), { ...hoje, ...comJanelaReal });
    expect(await rodar(noPiso.d, new Date('2026-11-05T16:59:59.999Z'))).toMatchObject({ motivo: 'antes_do_inicio', enviou: false });
    for (const quando of ['2026-11-05T23:00:00.000Z', '2026-11-08T17:00:00.000Z', '2026-11-20T17:00:00.000Z', '2026-11-06T11:59:59.000Z']) {
      const { d, e } = falsas(gente(1), { ...hoje, ...comJanelaReal, pisoInicioMs: () => 0 });
      expect(await rodar(d, new Date(quando)), quando).toMatchObject({ motivo: 'fora_da_janela', enviou: false });
      expect(e.chamadas, quando).not.toContain('enviar');
    }
  });

  it('sem a sonda ok não envia, em nenhum horário: a rodada espera a sonda e nada é lido nem enviado', async () => {
    for (const estado of [{ estado: 'nenhuma' }, { estado: 'em_andamento', desdeMs: AGORA.getTime() - 1000 }, { estado: 'falhou' }] as const) {
      const { d, e } = falsas(gente(1), { sondaEstado: async () => estado, sondaRodar: async () => 'erro' });
      const r = await rodar(d);
      expect(r.enviou, estado.estado).toBe(false);
      expect(e.chamadas, estado.estado).not.toContain('lerPublico');
      expect(e.chamadas, estado.estado).not.toContain('enviar');
    }
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

  it('teto de 25 em 24 h pelo banco: com 24 carimbos envia, com 25 não (a chave da sonda fica de fora)', async () => {
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
    expect(await reais.tetoCampanha(AGORA)).toBe('ok');                // a chave da sonda (usu_rec_sent:sonda:) pesa no frio da linha, não no teto de 25 da campanha
    banco.poe('system_state', { key: 'usu_rec_sent:x24', value: {}, updated_at: ISO(AGORA.getTime() - HORA) });
    expect(await reais.tetoCampanha(AGORA)).toBe('cheio');
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
    expect(e.enviados[0]!.texto).toMatch(/^(E aí, Ana! Aqui é a Carla, da SolarDoc\.|Aqui é a Carla, da SolarDoc\..* passo a passo, Ana\?$)/);
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
    expect(s.linhas[2]!.texto).toMatch(/^(E aí, \w+! Aqui é a Carla, da SolarDoc\.|Aqui é a Carla, da SolarDoc\..* passo a passo, \w+\?$)/);
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

// ── a sonda automática antes do 1º envio (05/11/2026) ────────────────────────

describe('rodarSondaRetomada: a sonda sobre dependências falsas', () => {
  const PISO_ISO = '2026-11-05T17:00:00Z';
  const CLAIM = `${PREFIXO_SONDA_CLAIM_RET}${PISO_ISO}`;
  const OK = `${PREFIXO_SONDA_OK_RET}${PISO_ISO}`;
  const FALHOU = `${PREFIXO_SONDA_FALHOU_RET}${PISO_ISO}`;
  const CARIMBO = `${PREFIXO_SONDA_CARIMBO_RET}${PISO_ISO}`;

  /** Uma linha em memória: cada carimbo presente come 1 vaga do dia; `intrusos` simula outro frio que entra no meio (por leitura). */
  function linhaFalsa(over: Partial<DepsSonda> = {}, cfg: { base?: number; tetoHora?: number; tetoDia?: number; intrusosPorLeitura?: number[] } = {}) {
    const chaves = new Map<string, Record<string, unknown>>();
    const ordem: string[] = [];
    const avisos: Array<{ assunto: string; html: string }> = [];
    let leitura = 0;
    const d: DepsSonda = {
      vagas: async () => {
        ordem.push('vagas');
        const extra = (cfg.intrusosPorLeitura ?? [])[leitura++] ?? 0;
        const doCarimbo = chaves.has(CARIMBO) ? 1 : 0;
        const v: VagasFrio = { hora: { teto: cfg.tetoHora ?? 6, usadas: 1 + doCarimbo + extra }, dia: { teto: cfg.tetoDia ?? 30, usadas: (cfg.base ?? 4) + doCarimbo + extra } };
        return v;
      },
      inserir: async (chave, valor) => {
        ordem.push(`inserir:${chave === CARIMBO ? 'carimbo' : chave === CLAIM ? 'claim' : chave === OK ? 'ok' : chave === FALHOU ? 'falhou' : chave}`);
        if (chaves.has(chave)) return 'ja';
        chaves.set(chave, valor);
        return 'ok';
      },
      apagar: async (chave) => { ordem.push('apagar'); chaves.delete(chave); return true; },
      espacamento: async () => { ordem.push('espacamento'); return !chaves.has(CARIMBO); },
      avisar: async (assunto, html) => { avisos.push({ assunto, html }); },
      ...over,
    };
    return { d, chaves, ordem, avisos };
  }

  it('passou: claim, carimbo falso, espaçamento, apaga, mede de novo e grava a marca ok; sem e-mail', async () => {
    const { d, chaves, ordem, avisos } = linhaFalsa();
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('ok');
    expect(ordem).toEqual(['inserir:claim', 'vagas', 'espacamento', 'inserir:carimbo', 'vagas', 'espacamento', 'apagar', 'vagas', 'inserir:ok']);
    expect([...chaves.keys()].sort()).toEqual([CLAIM, OK].sort());      // o carimbo falso não fica
    expect(chaves.get(OK)).toMatchObject({ tentativas: 1 });
    expect(avisos).toHaveLength(0);
  });

  it('o carimbo falso tem o prefixo e o formato de um envio real da retomada (usu_rec_sent:..., com estado)', async () => {
    let gravado: { chave: string; valor: Record<string, unknown> } | null = null;
    const { d } = linhaFalsa({
      inserir: async (chave, valor) => { if (chave.startsWith(PREFIXO_CARIMBO_RET)) gravado = { chave, valor }; return 'ok'; },
      espacamento: (() => { let n = 0; return async () => n++ > 0 ? false : true; })(),
      vagas: async () => ({ hora: { teto: 6, usadas: 0 }, dia: { teto: 30, usadas: 0 } }),
    });
    await rodarSondaRetomada(AGORA, PISO_ISO, d);       // a queda dá 0 e falha: o que importa aqui é o que foi gravado
    expect(gravado).not.toBeNull();
    expect(gravado!.chave).toBe(CARIMBO);
    expect(gravado!.chave.startsWith(PREFIXO_CARIMBO_RET)).toBe(true);
    expect(gravado!.valor).toMatchObject({ estado: 'reservado' });
  });

  it('o espaçamento é medido ANTES do carimbo e tem que dar true: se já dá false, a sonda é ADIADA (claim solto, nada gravado, sem e-mail)', async () => {
    const { d, chaves, ordem, avisos } = linhaFalsa({ espacamento: async () => false });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('erro');
    expect(ordem).not.toContain('inserir:carimbo');
    expect(chaves.size).toBe(0);                                  // nem claim, nem falhou, nem ok: a próxima rodada tenta de novo
    expect(avisos).toHaveLength(0);
  });

  it('a vaga da HORA também tem que cair exatamente 1: hora que não cai (ou cai 2) reprova depois de 2 passadas', async () => {
    let leitura = 0;
    const horaParada = linhaFalsa({
      vagas: async () => { leitura++; return { hora: { teto: 6, usadas: 1 }, dia: { teto: 30, usadas: 4 + (horaParada.chaves.has(CARIMBO) ? 1 : 0) } }; },
    });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, horaParada.d)).toBe('falhou');
    expect(horaParada.chaves.get(FALHOU)).toMatchObject({ motivo: 'vaga_nao_caiu_exatamente_1', queda: 1, queda_hora: 0, tentativas: 2 });
    expect(leitura).toBeGreaterThan(0);
    let n = 0;       // leituras em trios (v0, v1, v2): a hora cai 1 com o carimbo, mas NÃO volta ao valor inicial depois do apagar
    const horaVolta = linhaFalsa({
      vagas: async () => { const i = n++ % 3; return { hora: { teto: 6, usadas: i === 0 ? 1 : 2 }, dia: { teto: 30, usadas: i === 1 ? 5 : 4 } }; },
    });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, horaVolta.d)).toBe('falhou');
    expect(horaVolta.chaves.get(FALHOU)).toMatchObject({ motivo: 'vaga_nao_voltou' });
  });

  it('claim que já existe: ocupada, e nada mais roda (só o tick que inseriu segue)', async () => {
    const { d, chaves, ordem } = linhaFalsa();
    chaves.set(CLAIM, {});
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('ocupada');
    expect(ordem).toEqual(['inserir:claim']);
  });

  it('claim que não gravou (erro de banco): erro, sem marca; a próxima rodada tenta', async () => {
    const { d, chaves, avisos } = linhaFalsa({ inserir: async () => 'erro' });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('erro');
    expect(chaves.size).toBe(0);
    expect(avisos).toHaveLength(0);
  });

  it('teto afrouxado (dia acima de 30 ou hora acima de 6): reprova sem gravar o carimbo, marca, avisa o dono', async () => {
    for (const cfg of [{ tetoDia: 31 }, { tetoDia: 40 }, { tetoHora: 7 }]) {
      const { d, chaves, ordem, avisos } = linhaFalsa({}, cfg);
      expect(await rodarSondaRetomada(AGORA, PISO_ISO, d), JSON.stringify(cfg)).toBe('falhou');
      expect(ordem).not.toContain('inserir:carimbo');
      expect(chaves.get(FALHOU)).toMatchObject({ motivo: 'teto_afrouxado' });
      expect(avisos).toHaveLength(1);
      expect(avisos[0]!.html).toContain('teto_afrouxado');
    }
  });

  it('teto no limite (6 por hora e 30 por dia) passa', async () => {
    const { d } = linhaFalsa({}, { tetoHora: 6, tetoDia: 30 });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('ok');
  });

  it('espaçamento que não enxerga o carimbo (ESPACAMENTO_OFF, por exemplo) reprova na hora e a chave sai', async () => {
    const { d, chaves, ordem, avisos } = linhaFalsa({ espacamento: async () => true });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('falhou');
    expect(chaves.get(FALHOU)).toMatchObject({ motivo: 'espacamento_nao_viu_a_chave', tentativas: 1 });
    expect(chaves.has(CARIMBO)).toBe(false);
    expect(ordem.filter(o => o === 'inserir:carimbo')).toHaveLength(1);       // determinístico: não repete
    expect(avisos).toHaveLength(1);
  });

  it('espaçamento que lança: reprova, e o carimbo falso é apagado mesmo assim (finally)', async () => {
    const { d, chaves } = linhaFalsa({ espacamento: async () => { throw new Error('banco'); } });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('falhou');
    expect(chaves.has(CARIMBO)).toBe(false);
    expect(chaves.get(FALHOU)).toMatchObject({ motivo: 'espacamento_nao_leu' });
  });

  it('a vaga do dia que cai 2 (outro frio entrou no meio) repete UMA vez e, na 2ª, passa', async () => {
    // 1ª passada: o intruso aparece na leitura 2 (depois do carimbo); a 2ª passada é limpa.
    const { d, chaves, ordem } = linhaFalsa({}, { intrusosPorLeitura: [0, 1] });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('ok');
    expect(ordem.filter(o => o === 'inserir:carimbo')).toHaveLength(2);
    expect(chaves.get(OK)).toMatchObject({ tentativas: 2 });
    expect(chaves.has(FALHOU)).toBe(false);
  });

  it('a vaga que não cai (0) ou cai 2 nas duas passadas: reprova depois de 2 passadas, nunca 3', async () => {
    const zero = linhaFalsa({ vagas: async () => ({ hora: { teto: 6, usadas: 0 }, dia: { teto: 30, usadas: 4 } }) });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, zero.d)).toBe('falhou');
    expect(zero.chaves.get(FALHOU)).toMatchObject({ motivo: 'vaga_nao_caiu_exatamente_1', queda: 0, tentativas: 2 });
    expect(zero.ordem.filter(o => o === 'inserir:carimbo')).toHaveLength(2);
    expect(zero.avisos).toHaveLength(1);
    const dois = linhaFalsa({}, { intrusosPorLeitura: [0, 1, 0, 1] });       // o intruso entra entre v0 e v1 nas duas passadas: queda de 2
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, dois.d)).toBe('falhou');
    expect(dois.chaves.get(FALHOU)).toMatchObject({ motivo: 'vaga_nao_caiu_exatamente_1', queda: 2, tentativas: 2 });
  });

  it('a vaga que não volta ao valor inicial (v2 diferente de v0) repete uma vez e reprova', async () => {
    // leituras: v0=4, v1=5, v2=6 (intruso depois do apagar) -> repete; 2ª passada igual -> reprova com vaga_nao_voltou
    const { d, chaves } = linhaFalsa({}, { intrusosPorLeitura: [0, 0, 1, 1, 1, 2] });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('falhou');
    expect(chaves.get(FALHOU)).toMatchObject({ motivo: 'vaga_nao_voltou', tentativas: 2 });
  });

  it('a chave que não apagou: reprova, o e-mail diz que ela ficou e come 1 vaga por 24 h', async () => {
    const { d, chaves, avisos } = linhaFalsa({ apagar: async () => false });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('falhou');
    expect(chaves.get(FALHOU)).toMatchObject({ motivo: 'chave_da_sonda_ficou' });
    expect(avisos[0]!.html).toContain(CARIMBO);
    expect(avisos[0]!.html).toMatch(/1 vaga/);
  });

  it('marca de falha gravada: o claim sai junto e apagar SÓ a marca deixa a sonda para refazer; marca que não gravou: o claim fica e segura a pausa', async () => {
    const um = linhaFalsa({ espacamento: async () => true });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, um.d)).toBe('falhou');
    expect(um.chaves.has(FALHOU)).toBe(true);
    expect(um.chaves.has(CLAIM)).toBe(false);
    um.chaves.delete(FALHOU);                                   // o dono apaga a marca
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, linhaFalsa().d)).toBe('ok');   // e a próxima rodada refaz
    const dois = linhaFalsa({ espacamento: async () => true, inserir: async (chave, valor) => {
      if (chave === FALHOU) return 'erro';
      if (dois.chaves.has(chave)) return 'ja';
      dois.chaves.set(chave, valor); return 'ok';
    } });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, dois.d)).toBe('falhou');
    expect(dois.chaves.has(CLAIM)).toBe(true);
    expect(dois.avisos[0]!.html).toContain(CLAIM);
  });

  it('carimbo falso que não gravou (erro) ou que já existia (sobra): a chave é apagada mesmo assim, e se não apagar o e-mail diz que ficou', async () => {
    for (const gravou of ['erro', 'ja'] as const) {
      const apagadas: string[] = [];
      const { d, chaves } = linhaFalsa({
        inserir: async (chave) => (chave === CARIMBO ? gravou : chave === FALHOU || chave === CLAIM ? 'ok' : 'ok'),
        apagar: async (chave) => { apagadas.push(chave); return true; },
      });
      expect(await rodarSondaRetomada(AGORA, PISO_ISO, d), gravou).toBe('falhou');
      expect(apagadas, gravou).toContain(CARIMBO);
      expect(chaves.size, gravou).toBe(0);
    }
    const preso = linhaFalsa({ inserir: async (chave) => (chave === CARIMBO ? 'erro' : 'ok'), apagar: async (chave) => chave !== CARIMBO, });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, preso.d)).toBe('falhou');
    expect(preso.avisos[0]!.html).toContain(CARIMBO);
    expect(preso.avisos[0]!.html).toMatch(/1 vaga/);
  });

  it('o e-mail que não sai não derruba nada: a marca de falha e o log ficam', async () => {
    const { d, chaves } = linhaFalsa({ espacamento: async () => true, avisar: async () => { throw new Error('resend caiu'); } });
    expect(await rodarSondaRetomada(AGORA, PISO_ISO, d)).toBe('falhou');
    expect(chaves.has(FALHOU)).toBe(true);
  });

  it('o e-mail de falha não leva telefone, e-mail de cliente nem segredo, e diz como refazer', async () => {
    const { d, avisos } = linhaFalsa({ espacamento: async () => true });
    await rodarSondaRetomada(AGORA, PISO_ISO, d);
    const html = avisos[0]!.html;
    expect(avisos[0]!.assunto).toMatch(/sonda/i);
    expect(html).toContain(FALHOU);
    expect(html).not.toContain(CLAIM);                  // marca gravada: apagar só ela basta
    expect(html).not.toMatch(/\d{10,}/);
  });
});

describe('a sonda de verdade (lineThrottle e banco em memória) e o estado dela', () => {
  const reais = depsReais();
  const PISO_ISO = INICIO_RETOMADA_ISO;
  const agoraReal = (): Date => new Date();
  const chaves = (): string[] => banco.linhas('system_state').map(l => String(l.key));

  beforeEach(() => { delete process.env.LINHA_MAX_DIA; delete process.env.LINHA_MAX_HORA; delete process.env.ESPACAMENTO_OFF; delete process.env.LINHA_RESERVA_TRANSACIONAL; });

  it('com os tetos de fábrica (6 por hora e 30 por dia), passa: o carimbo come 1 vaga, o espaçamento o vê e a chave sai', async () => {
    const { depsReaisSonda } = await import('../services/solardoc/retomadaUsuarios');
    expect(await rodarSondaRetomada(agoraReal(), PISO_ISO, depsReaisSonda())).toBe('ok');
    expect(chaves().sort()).toEqual([`${PREFIXO_SONDA_CLAIM_RET}${PISO_ISO}`, `${PREFIXO_SONDA_OK_RET}${PISO_ISO}`].sort());
    expect(chaves().some(k => k.startsWith(PREFIXO_SONDA_CARIMBO_RET))).toBe(false);
    expect(await reais.sondaEstado()).toEqual({ estado: 'ok' });
  });

  it('com LINHA_MAX_DIA afrouxado (60) reprova; com ESPACAMENTO_OFF=1 reprova; as duas deixam a marca de falha e o e-mail', async () => {
    const { depsReaisSonda } = await import('../services/solardoc/retomadaUsuarios');
    const mailer = await import('../utils/mailer');
    process.env.LINHA_MAX_DIA = '60';
    expect(await rodarSondaRetomada(agoraReal(), PISO_ISO, depsReaisSonda())).toBe('falhou');
    expect(banco.linhas('system_state').find(l => l.key === `${PREFIXO_SONDA_FALHOU_RET}${PISO_ISO}`)?.value).toMatchObject({ motivo: 'teto_afrouxado' });
    expect(mailer.sendOpsAlert).toHaveBeenCalled();
    expect(await reais.sondaEstado()).toEqual({ estado: 'falhou' });
    banco.tabelas['system_state'] = banco.linhas('system_state').filter(l => l.key !== `${PREFIXO_SONDA_FALHOU_RET}${PISO_ISO}`);       // o dono apaga só a marca
    expect(await reais.sondaEstado()).toEqual({ estado: 'nenhuma' });
    banco.reset(); delete process.env.LINHA_MAX_DIA;
    process.env.ESPACAMENTO_OFF = '1';
    expect(await rodarSondaRetomada(agoraReal(), PISO_ISO, depsReaisSonda())).toBe('falhou');
    expect(banco.linhas('system_state').find(l => l.key === `${PREFIXO_SONDA_FALHOU_RET}${PISO_ISO}`)?.value).toMatchObject({ motivo: 'espacamento_nao_viu_a_chave' });
    expect(chaves().some(k => k.startsWith(PREFIXO_SONDA_CARIMBO_RET))).toBe(false);
  });

  it('o claim é INSERT: com ele já gravado, a segunda sonda é "ocupada" e não escreve nada', async () => {
    const { depsReaisSonda } = await import('../services/solardoc/retomadaUsuarios');
    banco.poe('system_state', { key: `${PREFIXO_SONDA_CLAIM_RET}${PISO_ISO}`, value: {}, updated_at: agoraReal().toISOString() });
    const antes = banco.escritas.length;
    expect(await rodarSondaRetomada(agoraReal(), PISO_ISO, depsReaisSonda())).toBe('ocupada');
    expect(banco.escritas.slice(antes).every(w => w.op === 'insert')).toBe(true);
    expect(chaves()).toEqual([`${PREFIXO_SONDA_CLAIM_RET}${PISO_ISO}`]);
  });

  it('o carimbo de teste da sonda conta para o frio da LINHA (vagasDoFrioLinha) mas não para o teto de 25 da campanha', async () => {
    const quando = agoraReal().toISOString();
    for (let i = 0; i < 24; i++) banco.poe('system_state', { key: `${PREFIXO_CARIMBO_RET}f${i}`, value: { estado: 'enviado', user_id: `u${i}` }, updated_at: quando });
    banco.poe('system_state', { key: `${PREFIXO_SONDA_CARIMBO_RET}${PISO_ISO}`, value: { estado: 'reservado', sonda: true }, updated_at: quando });
    expect(await reais.tetoCampanha(agoraReal())).toBe('ok');                       // 24 envios + a sonda: 24, não 25
    const { vagasDoFrioLinha } = await import('../services/agents/whatsapp/lineThrottle');
    expect((await vagasDoFrioLinha()).dia.usadas).toBe(25);                          // a linha conta a chave
    banco.poe('system_state', { key: `${PREFIXO_CARIMBO_RET}f24`, value: { estado: 'enviado', user_id: 'u24' }, updated_at: quando });
    expect(await reais.tetoCampanha(agoraReal())).toBe('cheio');
  });

  it('o estado: nenhuma, em andamento (só o claim, com a hora), ok e falhou (falhou vale mais que ok)', async () => {
    expect(await reais.sondaEstado()).toEqual({ estado: 'nenhuma' });
    banco.poe('system_state', { key: `${PREFIXO_SONDA_CLAIM_RET}${PISO_ISO}`, value: {}, updated_at: '2026-11-05T17:05:00.000Z' });
    expect(await reais.sondaEstado()).toEqual({ estado: 'em_andamento', desdeMs: Date.parse('2026-11-05T17:05:00.000Z') });
    banco.poe('system_state', { key: `${PREFIXO_SONDA_OK_RET}${PISO_ISO}`, value: {}, updated_at: '2026-11-05T17:06:00.000Z' });
    expect(await reais.sondaEstado()).toEqual({ estado: 'ok' });
    banco.poe('system_state', { key: `${PREFIXO_SONDA_FALHOU_RET}${PISO_ISO}`, value: {}, updated_at: '2026-11-05T17:07:00.000Z' });
    expect(await reais.sondaEstado()).toEqual({ estado: 'falhou' });
    banco.reset();
    banco.poe('system_state', { key: `${PREFIXO_SONDA_OK_RET}2026-01-01T00:00:00Z`, value: {}, updated_at: '2026-11-05T17:06:00.000Z' });
    expect(await reais.sondaEstado()).toEqual({ estado: 'nenhuma' });         // marca de OUTRO piso não vale
  });

  it('leitura do estado que falha lança (a rodada não envia)', async () => {
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    await expect(reais.sondaEstado()).rejects.toThrow();
  });
});

describe('a rodada e a sonda', () => {
  it('o piso de verdade (INICIO_RETOMADA_ISO, sem injeção): antes dele não envia; nele, com a sonda ok e dentro da janela, envia; sem a sonda ok não', async () => {
    const real = { pisoInicioMs: () => Regras.pisoDoCodigoMs(), garantirLargada: async () => Date.parse('2026-11-05T13:00:00.000Z'), janela: (a: Date) => dentroDaJanelaDaBaseLinha(a) };
    const antes = falsas(gente(1), real);
    expect(await rodar(antes.d, new Date('2026-11-05T16:59:59.999Z'))).toMatchObject({ motivo: 'antes_do_inicio', enviou: false });
    const no = falsas(gente(1), real);
    expect(await rodar(no.d, new Date('2026-11-05T17:00:00.000Z'))).toMatchObject({ motivo: null, enviou: true });
    const semSonda = falsas(gente(1), { ...real, sondaEstado: async () => ({ estado: 'nenhuma' }), sondaRodar: async () => 'ocupada' });
    expect(await rodar(semSonda.d, new Date('2026-11-05T17:00:00.000Z'))).toMatchObject({ enviou: false });
    const domingo = falsas(gente(1), real);
    expect(await rodar(domingo.d, new Date('2026-11-08T17:00:00.000Z'))).toMatchObject({ motivo: 'fora_da_janela', enviou: false });
  });

  it('sonda ainda não feita: roda DEPOIS das travas e ANTES da vez, e o envio segue no mesmo tick', async () => {
    const { d, e } = falsas(gente(1), { sondaEstado: async () => ({ estado: 'nenhuma' }) });
    const r = await rodar(d);
    expect(r).toMatchObject({ motivo: null, enviou: true });
    expect(e.chamadas.indexOf('sondaRodar')).toBeGreaterThanOrEqual(0);
    expect(e.chamadas.indexOf('sondaRodar')).toBeLessThan(e.chamadas.indexOf('tomarVez'));
  });

  it('sonda ok: não roda de novo', async () => {
    const { d, e } = falsas(gente(1));
    await rodar(d);
    expect(e.chamadas).not.toContain('sondaRodar');
  });

  it('uma trava da linha barra ANTES da sonda: a sonda só roda com a linha calma', async () => {
    for (const over of [{ espacamento: async () => false }, { tetoHorario: async () => false }, { linhaNaHora: async () => 4 }] as Array<Partial<DepsRet>>) {
      const { d, e } = falsas(gente(1), { ...over, sondaEstado: async () => ({ estado: 'nenhuma' }) });
      const r = await rodar(d);
      expect(r.enviou).toBe(false);
      expect(e.chamadas).not.toContain('sondaRodar');
    }
  });

  it('sonda que reprova: motivo sonda_falhou, nada lido do público e nada enviado', async () => {
    const { d, e } = falsas(gente(1), { sondaEstado: async () => ({ estado: 'nenhuma' }), sondaRodar: async () => 'falhou' });
    expect(await rodar(d)).toMatchObject({ motivo: 'sonda_falhou', enviou: false });
    expect(e.chamadas).not.toContain('tomarVez');
    expect(e.chamadas).not.toContain('lerPublico');
    expect(e.chamadas).not.toContain('enviar');
  });

  it('sonda já falhada (marca no banco): motivo sonda_falhou mesmo fora da janela, sem rodar a sonda', async () => {
    const { d, e } = falsas(gente(1), { sondaEstado: async () => ({ estado: 'falhou' }), janela: () => false });
    expect(await rodar(d)).toMatchObject({ motivo: 'sonda_falhou', enviou: false });
    expect(e.chamadas).not.toContain('sondaRodar');
  });

  it('claim de outro tick (ocupada ou em andamento): sonda_em_andamento, sem enviar', async () => {
    const um = falsas(gente(1), { sondaEstado: async () => ({ estado: 'nenhuma' }), sondaRodar: async () => 'ocupada' });
    expect(await rodar(um.d)).toMatchObject({ motivo: 'sonda_em_andamento', enviou: false });
    const dois = falsas(gente(1), { sondaEstado: async () => ({ estado: 'em_andamento', desdeMs: 1 }) });
    expect(await rodar(dois.d)).toMatchObject({ motivo: 'sonda_em_andamento', enviou: false });
  });

  it('estado da sonda ilegível: a rodada não envia (leitura_da_sonda_falhou)', async () => {
    const { d, e } = falsas(gente(1), { sondaEstado: async () => { throw new Error('caiu'); } });
    expect(await rodar(d)).toMatchObject({ ok: false, motivo: 'leitura_da_sonda_falhou', enviou: false });
    expect(e.chamadas).not.toContain('enviar');
  });

  it('sonda que não gravou o claim (erro): sonda_nao_rodou, sem enviar', async () => {
    const { d } = falsas(gente(1), { sondaEstado: async () => ({ estado: 'nenhuma' }), sondaRodar: async () => 'erro' });
    expect(await rodar(d)).toMatchObject({ ok: false, motivo: 'sonda_nao_rodou', enviou: false });
  });

  it('o modo seco só LÊ a sonda: mostra o estado e nunca a roda', async () => {
    const { d, e } = falsas(boasContasDaSonda(), { sondaEstado: async () => ({ estado: 'nenhuma' }) });
    const s = await sondarRetomadaUsuarios({ n: 3, agora: AGORA }, d);
    expect(s.sonda).toBe('nenhuma');
    expect(e.chamadas).not.toContain('sondaRodar');
  });
});

function boasContasDaSonda(): UsuarioRet[] { return gente(3); }

describe('releitura que não consegue ler PARA a rodada (conserto 1c)', () => {
  it('leitura_falhou na releitura: desfaz a posse e o claim, e não tenta a próxima pessoa', async () => {
    let n = 0;
    const { d, e } = falsas(gente(3), {
      // a 1ª leitura da conversa é a avaliação; a 2ª é a releitura antes do envio, que falha
      conversa: async () => (++n === 2 ? { msgs: [], completa: false } : { msgs: [], completa: true }),
    });
    const r = await rodar(d);
    expect(r).toMatchObject({ enviou: false, avaliados: 1 });
    expect(r.puladas).toEqual({ releitura_leitura_falhou: 1 });
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).toContain('apagarClaim');
    expect(e.enviados).toHaveLength(0);
  });

  it('os outros motivos de releitura (mensagem nova) continuam passando para a próxima pessoa', async () => {
    let n = 0;
    const { d } = falsas(gente(3), {
      conversa: async () => { n++; return { msgs: n === 2 ? [msg('lead', 1000, 99)] : [], completa: true }; },
    });
    const r = await rodar(d);
    expect(r.avaliados).toBeGreaterThan(1);
    expect(r.puladas.releitura_mensagem_nova).toBe(1);
  });
});

describe('"usou" = contador > 0 OU linha em documents (05/11/2026)', () => {
  const reais = depsReais();
  const lerFila = async (us: UsuarioRet[]) => {
    banco.poe('users', ...us.map(u => ({ ...u })));
    const pub = await reais.lerPublico(AGORA, LARGADA);
    return pub ? montarFila(pub, AGORA.getTime(), LARGADA) : null;
  };

  it('contador 0 com documento vira "usou"; contador 0 sem documento, "nunca usou"; contador > 0 é "usou" sem consultar documents', async () => {
    const comDoc = usuario({ documentos_usados: 0 });
    const semDoc = usuario({ documentos_usados: 0 });
    const contador = usuario({ documentos_usados: 4 });
    banco.poe('documents', { user_id: comDoc.id, created_at: '2025-01-01T00:00:00.000Z' });          // velho: fora da janela de 60 dias, e vale
    const r = await lerFila([comDoc, semDoc, contador]);
    expect(r).not.toBeNull();
    const usou = (u: UsuarioRet) => r!.fila.find(i => i.u.id === u.id)?.usou;
    expect(usou(comDoc)).toBe(true);
    expect(usou(semDoc)).toBe(false);
    expect(usou(contador)).toBe(true);
  });

  it('consulta a documents que falha: o público não é lido e a rodada para (sem chutar o texto, nada enviado)', async () => {
    banco.poe('users', { ...usuario({ documentos_usados: 0 }) });
    banco.falhas['documents.select'] = { erro: { message: 'caiu' }, pular: 1 };         // a 1ª leitura é a dos documentos de 60 dias
    expect(await reais.lerPublico(AGORA, LARGADA)).toBeNull();
    const { d, e } = falsas(gente(1), { lerPublico: async () => null });
    expect(await rodar(d)).toMatchObject({ ok: false, motivo: 'leitura_do_publico_falhou', enviou: false });
    expect(e.enviados).toHaveLength(0);
  });

  it('o texto enviado segue o critério: contador 0 com documento recebe o de "usou"', async () => {
    const u = usuario({ documentos_usados: 0 });
    const pub = { usuarios: [u], extras: () => ({ ...EXTRAS_VAZIOS, temDocumento: true }), chavesDaCasa: new Set<string>() };
    const { d, e } = falsas([u], { lerPublico: async () => pub });
    await rodar(d);
    expect(e.enviados[0]!.texto).toMatch(/^(Olá|Opa)/);
    const semDoc = falsas([u], { lerPublico: async () => ({ ...pub, extras: () => EXTRAS_VAZIOS }) });
    await rodar(semDoc.d);
    expect(semDoc.e.enviados[0]!.texto).toMatch(/^(E aí|Aqui é a Carla)/);
  });
});

describe('o perfil do texto chega ao envio (documentos_usados e id da conta)', () => {
  it('quem gerou documento recebe o texto de "usou"; quem não gerou, o de "nunca usou"', async () => {
    const usou = usuario({ documentos_usados: 3 });
    const nunca = usuario({ documentos_usados: 0 });
    const semCampo = usuario();
    for (const [u, esperado] of [[usou, /^(Olá|Opa)/], [nunca, /^(E aí|Aqui é a Carla)/], [semCampo, /^(E aí|Aqui é a Carla)/]] as const) {
      const { d, e } = falsas([u]);
      await rodar(d);
      expect(e.enviados, u.id).toHaveLength(1);
      expect(e.enviados[0]!.texto, u.id).toMatch(esperado);
      expect(e.enviados[0]!.texto).toMatch(/Ana/);
      expect(e.enviados[0]!.texto).not.toMatch(/[{}]/);
    }
  });

  it('a leitura do público pede a coluna documentos_usados', async () => {
    banco.projeta = true;
    try {
      banco.poe('users', { ...usuario({ documentos_usados: 2 }) });
      const pub = await depsReais().lerPublico(AGORA, LARGADA);
      expect(pub?.usuarios[0]?.documentos_usados).toBe(2);
    } finally { banco.projeta = false; }
  });
});
