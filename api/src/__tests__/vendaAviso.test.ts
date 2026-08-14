import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// O aviso de venda é a única peça do webhook que fala com uma PESSOA. Dois
// jeitos de ele apodrecer em silêncio, os dois cobertos aqui:
//   1) a Stripe reentrega o mesmo checkout.session.completed por até 3 dias —
//      avisar duas vezes ensina o dono a ignorar o aviso;
//   2) a linha do WhatsApp cai (aconteceu 3x entre 04 e 06/08) — sem o e-mail
//      de fallback a venda passa e ninguém fica sabendo, que é exatamente o
//      problema que motivou a feature.

type Row = Record<string, any>;
const sales: Row[] = [];
let falharLeitura = false;

// Fake do Supabase com estado: precisa respeitar o `.is('aviso_dono_em', null)`,
// senão a trava "passa" no teste e falha em produção.
vi.mock('../utils/supabase', () => {
  function query() {
    const filtros: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const alvos = () => sales.filter((r) => filtros.every((f) => f(r)));
    const q: any = {
      update: (p: Row) => { patch = p; return q; },
      eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
      is: (col: string, val: any) => { filtros.push((r) => (r[col] ?? null) === val); return q; },
      select: () => q,
      // `await supabase.from('sales').select(...).eq(...)` sem maybeSingle —
      // é assim que o historicoDoCliente lê as compras antigas do e-mail.
      then: (ok: any, erro: any) => Promise.resolve(
        falharLeitura ? { data: null, error: new Error('banco fora') } : { data: alvos(), error: null },
      ).then(ok, erro),
      maybeSingle: async () => {
        const linhas = alvos();
        if (!linhas.length) return { data: null, error: null };
        linhas.forEach((r) => Object.assign(r, patch));
        return { data: { id: linhas[0].id }, error: null };
      },
    };
    return q;
  }
  return { supabase: { from: () => query() } };
});

const enviados: Array<{ phone: string; texto: string; linha: string }> = [];
let falharWhats = false;
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => {
    if (falharWhats) throw new Error('[zapi:solardoc] em cooldown (instância indisponível)');
    enviados.push({ phone, texto, linha });
  }),
}));

const emails: Array<{ assunto: string; corpo: string }> = [];
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: vi.fn(async (assunto: string, corpo: string) => { emails.push({ assunto, corpo }); }),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { avisarVendaAoDono, textoAvisoVenda, historicoDoCliente } from '../services/vendaAviso';

const venda = (over: Partial<Parameters<typeof textoAvisoVenda>[0]> = {}) => ({
  produto: 'VIP', valor: 67, cobrouAgora: true,
  email: 'novo@integrador.com', nome: 'Luiz', phone: '5534991360223',
  utmSource: 'ig', utmCampaign: 'camp-1', utmContent: 'criativo-3',
  ...over,
});

beforeEach(() => {
  sales.length = 0; enviados.length = 0; emails.length = 0;
  falharWhats = false; falharLeitura = false;
  sales.push({ id: 'venda-1', aviso_dono_em: null });
});

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('aviso de venda no WhatsApp do dono', () => {
  it('manda a mensagem com plano, valor e se o dinheiro entrou', async () => {
    const r = await avisarVendaAoDono('venda-1', venda());
    expect(r).toBe('enviado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].linha).toBe('solardoc'); // nunca a IO, que é a que cai
    expect(enviados[0].texto).toContain('R$ 67,00/mês');
    expect(enviados[0].texto).toContain('entrou agora');
    expect(enviados[0].texto).toContain('wa.me/5534991360223');
    expect(enviados[0].texto).toContain('ig · camp-1 · criativo-3');
  });

  it('venda em trial NÃO diz que o dinheiro entrou', () => {
    const t = textoAvisoVenda(venda({ cobrouAgora: false, produto: 'VIP PROMO', valor: 49 }));
    expect(t).toContain('ainda NÃO entrou');
    expect(t).toContain('R$ 49,00/mês');
  });

  it('sem UTM não finge origem', () => {
    const t = textoAvisoVenda(venda({ utmSource: null, utmCampaign: null, utmContent: null }));
    expect(t).toContain('sem UTM');
  });

  it('reentrega da Stripe não avisa duas vezes', async () => {
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('enviado');
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('duplicado');
    expect(enviados).toHaveLength(1);
    expect(sales[0].aviso_dono_em).toBeTruthy();
  });

  it('linha caída cai pro e-mail — a venda não passa em silêncio', async () => {
    falharWhats = true;
    const r = await avisarVendaAoDono('venda-1', venda());
    expect(r).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0].assunto).toContain('R$ 67,00');
    expect(emails[0].corpo).toContain('novo@integrador.com');
  });

  it('venda que não entrou no ledger avisa mesmo assim (sem trava pra perder)', async () => {
    const r = await avisarVendaAoDono(null, venda());
    expect(r).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });
});

// ── Cliente novo x quem já assina ───────────────────────────────────────────
// Os dois avisos que o Thiago mostrou em 14/08 eram idênticos, e um deles era
// um cliente de 22/05 voltando pelo cupom de R$19. Sem esta distinção, uma
// recompra de quem JÁ paga (o começo de uma cobrança dobrada) chega com a
// mesma cara de uma aquisição — e as duas pedem ações opostas.
describe('histórico do cliente', () => {
  const chamada = (over: Record<string, any> = {}) => ({
    email: 'quem@integrador.com',
    checkoutSessionIdAtual: 'cs_agora',
    subscriptionIdAtual: 'sub_agora',
    ...over,
  });

  it('sem compra anterior é cliente NOVO', async () => {
    sales.push({ email: 'quem@integrador.com', checkout_session_id: 'cs_agora', status: 'paid' });
    const h = await historicoDoCliente(chamada());
    expect(h).toEqual({ tipo: 'novo', primeiraCompra: null, comprasAnteriores: 0 });
    expect(textoAvisoVenda(venda({ historico: h }))).toContain('*Cliente:* NOVO');
  });

  it('assinatura antiga VIVA na Stripe = duplicidade, com os meses de casa', async () => {
    sales.push(
      { email: 'quem@integrador.com', checkout_session_id: 'cs_maio', subscription_id: 'sub_velha', status: 'active', card_passed_at: diasAtras(88) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_agora', subscription_id: 'sub_agora', status: 'paid', card_passed_at: diasAtras(0) },
    );
    const h = await historicoDoCliente(chamada({ assinaturaViva: async () => true }));
    expect(h?.tipo).toBe('assinante');
    expect(h?.comprasAnteriores).toBe(1);

    const t = textoAvisoVenda(venda({ historico: h }));
    expect(t).toContain('JÁ ASSINA há 2 meses');
    expect(t).toContain('2ª compra neste e-mail');
    expect(t).toContain('pode virar cobrança dobrada');
  });

  it('a Stripe manda mais que o ledger: sub cancelada há 10min vira RECORRENTE, não duplicidade', async () => {
    // O ledger é reconciliado de hora em hora — dentro dessa hora ele ainda diz
    // 'active' pra uma assinatura que já morreu. Sem a conferida na Stripe, o
    // aviso gritaria duplicidade em cima de uma reativação.
    sales.push(
      { email: 'quem@integrador.com', checkout_session_id: 'cs_maio', subscription_id: 'sub_velha', status: 'active', card_passed_at: diasAtras(84) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_agora', subscription_id: 'sub_agora', status: 'paid', card_passed_at: diasAtras(0) },
    );
    const h = await historicoDoCliente(chamada({ assinaturaViva: async () => false }));
    expect(h?.tipo).toBe('recorrente');
    expect(textoAvisoVenda(venda({ historico: h }))).toContain('RECORRENTE');
  });

  it('linha do backfill (sem subscription_id) cai no status do ledger', async () => {
    sales.push(
      { email: 'quem@integrador.com', checkout_session_id: 'cs_velho', subscription_id: null, status: 'canceled', card_passed_at: diasAtras(120) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_agora', subscription_id: 'sub_agora', status: 'paid', card_passed_at: diasAtras(0) },
    );
    const viva = vi.fn(async () => true);
    const h = await historicoDoCliente(chamada({ assinaturaViva: viva }));
    expect(viva).not.toHaveBeenCalled(); // não há sub antiga pra perguntar
    expect(h?.tipo).toBe('recorrente');
  });

  it('Stripe fora não derruba nada — o ledger decide', async () => {
    sales.push(
      { email: 'quem@integrador.com', checkout_session_id: 'cs_maio', subscription_id: 'sub_velha', status: 'active', card_passed_at: diasAtras(40) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_agora', subscription_id: 'sub_agora', status: 'paid' },
    );
    const h = await historicoDoCliente(chamada({
      assinaturaViva: async () => { throw new Error('stripe 503'); },
    }));
    expect(h?.tipo).toBe('assinante');
  });

  it('com muitas assinaturas antigas, a VIVA (mais nova) não fica fora do corte de 3', async () => {
    // Já existe um e-mail com 3 subs no ledger. Como o Postgres devolve sem
    // ordem, cortar 3 quaisquer podia deixar a assinatura viva de fora e o
    // aviso diria RECORRENTE no comprador repetido — o caso mais caro de errar.
    sales.push(
      { email: 'quem@integrador.com', checkout_session_id: 'cs_1', subscription_id: 'sub_1', status: 'canceled', card_passed_at: diasAtras(200) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_2', subscription_id: 'sub_2', status: 'canceled', card_passed_at: diasAtras(150) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_3', subscription_id: 'sub_3', status: 'canceled', card_passed_at: diasAtras(100) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_4', subscription_id: 'sub_viva', status: 'canceled', card_passed_at: diasAtras(30) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_agora', subscription_id: 'sub_agora', status: 'paid', card_passed_at: diasAtras(0) },
    );
    const perguntadas: string[] = [];
    const h = await historicoDoCliente(chamada({
      assinaturaViva: async (s: string) => { perguntadas.push(s); return s === 'sub_viva'; },
    }));
    expect(perguntadas).toContain('sub_viva');
    expect(perguntadas).not.toContain('sub_1'); // a mais velha é a que sai
    expect(h?.tipo).toBe('assinante');
    expect(textoAvisoVenda(venda({ historico: h }))).toContain('5ª compra neste e-mail');
  });

  it('banco fora: o aviso admite que não conferiu em vez de chutar "novo"', async () => {
    falharLeitura = true;
    const h = await historicoDoCliente(chamada());
    expect(h).toBeNull();
    expect(textoAvisoVenda(venda({ historico: h }))).toContain('não deu pra conferir');
  });

  it('sem histórico apurado a mensagem não cria linha nenhuma (venda do PlugCash, ex.)', () => {
    expect(textoAvisoVenda(venda())).not.toContain('*Cliente:*');
    expect(textoAvisoVenda(venda()).split('\n')[0]).toBe('*💰VENDA SolarDoc*');
  });

  // A prévia da notificação do WhatsApp mostra só a primeira linha. Se o emoji
  // do tipo escorregar pro meio do texto, o Thiago volta a ter que ABRIR a
  // conversa pra saber se a venda é aquisição ou recompra de quem já paga.
  it('o emoji do tipo abre a mensagem — é o que aparece na prévia do WhatsApp', () => {
    const cabecalho = (h: any) => textoAvisoVenda(venda({ historico: h })).split('\n')[0];
    const base = { primeiraCompra: '2026-05-18T00:00:00Z', comprasAnteriores: 1 };

    expect(cabecalho({ ...base, tipo: 'novo' })).toBe('*💰VENDA SolarDoc*');
    expect(cabecalho({ ...base, tipo: 'assinante' })).toBe('*⚠️ASSINANTE SolarDoc*');
    expect(cabecalho({ ...base, tipo: 'recorrente' })).toBe('*🔄RECORRENTE SolarDoc*');

    // Três emojis diferentes: dois parecidos valeriam o mesmo que nenhum.
    const emojis = (['novo', 'assinante', 'recorrente'] as const).map((t) => cabecalho({ ...base, tipo: t }).slice(1, 3));
    expect(new Set(emojis).size).toBe(3);
  });

  it('quando a linha cai, o e-mail de resgate leva o mesmo sinal', async () => {
    falharWhats = true;
    await avisarVendaAoDono('venda-1', venda({
      historico: { tipo: 'assinante', primeiraCompra: '2026-05-18T00:00:00Z', comprasAnteriores: 2 },
    }));
    expect(emails[0].assunto).toContain('⚠️');
    expect(emails[0].corpo).toContain('JÁ ASSINA');
  });

  it('menos de um mês fala em dias — "0 meses" seria mentira', async () => {
    sales.push(
      { email: 'quem@integrador.com', checkout_session_id: 'cs_ontem', subscription_id: 'sub_velha', status: 'active', card_passed_at: diasAtras(9) },
      { email: 'quem@integrador.com', checkout_session_id: 'cs_agora', subscription_id: 'sub_agora', status: 'paid' },
    );
    const h = await historicoDoCliente(chamada({ assinaturaViva: async () => true }));
    expect(textoAvisoVenda(venda({ historico: h }))).toContain('JÁ ASSINA há 9 dias');
  });
});
