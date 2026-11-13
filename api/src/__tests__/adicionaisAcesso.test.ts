import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// ADICIONAIS MENSAIS: a posse com data (nunca encurta), a liberação por fatura paga da Stripe, o bump no Pix do plano
// e o adicional comprado no app por Pix (autorização separada). Banco falso em memória; Stripe e Asaas falsos.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return { supabase: supabaseFalso };
});
const asaasFetch = vi.fn();
vi.mock('../services/asaas/asaasClient', async (orig) => ({
  ...(await orig<typeof import('../services/asaas/asaasClient')>()),
  asaasFetch: (...a: unknown[]) => asaasFetch(...a),
  asaasHabilitado: () => true,
}));

import { db, falhas, limpar, semear } from './helpers/dbFalso';
import { acessos, concederOuEstender } from '../services/produtos/acessos';
import {
  liberarAdicionaisDaFatura, liberarAdicionaisDaSessao, itemDoPlano, assinaturaSoDeAdicional, linhasDoBump, processarFaturaDeAdicionais,
  ErroLeituraDaAssinatura, faturaEhSoDeAdicional,
} from '../services/produtos/adicionaisStripe';
import { estadoDosAdicionais } from '../services/produtos/adicionaisApp';
import { cancelarAdicionalCartao, comprarAdicionalCartao } from '../services/produtos/adicionaisCartaoApp';
import { gerarCodigoNovo } from '../services/solardoc/pixAutoCodigo';
import { estenderAdicionaisDoPlano, gravarAdicionaisDoPlano } from '../services/produtos/adicionaisPlanoPix';
import { cancelarAdicionalPix, criarPixAdicional, tratarWebhookAdicionalPix } from '../services/produtos/adicionaisPix';
import { _limparCachePrecos } from '../services/produtos/adicionaisPrecos';

const DIA = 86_400_000;
const ENV = { ...process.env };
const EMAIL = 'cliente@empresa.com.br';
const CPF = '52998224725';
let userId = '';

const posse = (produto: string) => (db.entitlements ?? []).find((e) => e.user_id === userId && e.produto === produto);
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  limpar('users', 'entitlements', 'system_state', 'kit_pedidos', 'sales', 'asaas_pix_assinaturas', 'asaas_webhook_events');
  userId = semear('users', {
    email: EMAIL, nome: 'Cliente', whatsapp: null, plano: 'ilimitado', is_admin: false, plano_expira_em: null,
    billing_status: 'active', created_at: iso(Date.now() - 400 * DIA),
  }).id;
  process.env.ADICIONAIS_MENSAIS = '1';
  asaasFetch.mockReset();
  _limparCachePrecos();
});
afterEach(() => { process.env = { ...ENV }; });

describe('concederOuEstender: nunca encurta', () => {
  it('sem linha, cria com a data', async () => {
    const ate = new Date(Date.now() + 10 * DIA);
    expect(await concederOuEstender({ userId, produto: 'offgrid', ate })).toBe('criado');
    expect(posse('offgrid')?.expira_em).toBe(ate.toISOString());
    expect(posse('offgrid')?.origem).toBe('compra');
  });

  it('posse para sempre (expira_em nulo) fica como está', async () => {
    semear('entitlements', { user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: null, obs: 'Kiwify' });
    expect(await concederOuEstender({ userId, produto: 'offgrid', ate: new Date(Date.now() + 5 * DIA) })).toBe('mantido');
    expect(posse('offgrid')?.expira_em).toBeNull();
    expect(posse('offgrid')?.obs).toBe('Kiwify');
  });

  it('data mais distante fica como está', async () => {
    const longe = iso(Date.now() + 90 * DIA);
    semear('entitlements', { user_id: userId, produto: 'inventario', origem: 'cortesia', expira_em: longe });
    expect(await concederOuEstender({ userId, produto: 'inventario', ate: new Date(Date.now() + 33 * DIA) })).toBe('mantido');
    expect(posse('inventario')?.expira_em).toBe(longe);
  });

  it('data mais próxima ou vencida anda para a frente', async () => {
    semear('entitlements', { user_id: userId, produto: 'curso-limpapro', origem: 'compra', expira_em: iso(Date.now() - 2 * DIA) });
    const ate = new Date(Date.now() + 33 * DIA);
    expect(await concederOuEstender({ userId, produto: 'curso-limpapro', ate })).toBe('estendido');
    expect(posse('curso-limpapro')?.expira_em).toBe(ate.toISOString());
  });

  it('a mesma data reentregue não muda nada', async () => {
    const ate = new Date(Date.now() + 33 * DIA);
    await concederOuEstender({ userId, produto: 'offgrid', ate });
    expect(await concederOuEstender({ userId, produto: 'offgrid', ate })).toBe('mantido');
    expect(db.entitlements.filter((e) => e.produto === 'offgrid')).toHaveLength(1);
  });

  it('o acesso vale enquanto a data não passou e some depois', async () => {
    await concederOuEstender({ userId, produto: 'offgrid', ate: new Date(Date.now() + DIA) });
    expect((await acessos(userId)).produtos.has('offgrid')).toBe(true);
    db.entitlements[0].expira_em = iso(Date.now() - 1000);
    expect((await acessos(userId)).produtos.has('offgrid')).toBe(false);
  });
});

// ── Stripe ───────────────────────────────────────────────────────────────────
const FIM = Math.floor((Date.now() + 30 * DIA) / 1000);
const item = (id: string, lookup: string | null, extra: Record<string, unknown> = {}) => ({
  id, price: { id: `price_${id}`, lookup_key: lookup, recurring: { interval: 'month' } }, current_period_end: FIM, ...extra,
});
const sub = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1', status: 'active', metadata: { userId }, customer: 'cus_1', current_period_end: FIM, cancel_at_period_end: false,
  items: { data: [item('si_plano', null), item('si_ad', 'ad_offgrid_mensal')] }, ...over,
});
const stripeCom = (s: unknown) => ({
  subscriptions: { retrieve: vi.fn(async () => s) },
  customers: { retrieve: vi.fn(async () => ({ email: EMAIL })) },
});

describe('fatura paga da Stripe libera o adicional', () => {
  it('estende até o fim do período + 3 dias, com o carimbo do cartão', async () => {
    const r = await liberarAdicionaisDaFatura(stripeCom(sub()), { id: 'in_1', subscription: 'sub_1' });
    expect(r).toEqual({ liberados: ['offgrid'], soAdicional: false });
    expect(Date.parse(posse('offgrid')!.expira_em)).toBe(FIM * 1000 + 3 * DIA);
    expect(posse('offgrid')!.obs).toBe('adicional:cartao:offgrid');
    expect(posse('offgrid')!.order_id).toBe('sub_1');
  });

  it('pacote libera as 4 ferramentas', async () => {
    const s = sub({ items: { data: [item('si_plano', null), item('si_pk', 'ad_pacote_checkout_mensal')] } });
    const r = await liberarAdicionaisDaFatura(stripeCom(s), { id: 'in_2', subscription: 'sub_1' });
    expect([...r.liberados].sort()).toEqual(['curso-fechamento', 'curso-limpapro', 'inventario', 'offgrid']);
    expect(posse('inventario')!.obs).toBe('adicional:cartao:pacote');
  });

  it('a mesma fatura reentregue não duplica linha nem encurta', async () => {
    const st = stripeCom(sub());
    await liberarAdicionaisDaFatura(st, { id: 'in_1', subscription: 'sub_1' });
    await liberarAdicionaisDaFatura(st, { id: 'in_1', subscription: 'sub_1' });
    expect(db.entitlements.filter((e) => e.produto === 'offgrid')).toHaveLength(1);
  });

  it('a renovação do mês seguinte empurra a data', async () => {
    await liberarAdicionaisDaFatura(stripeCom(sub()), { id: 'in_1', subscription: 'sub_1' });
    const proximo = FIM + 30 * 86400;
    const renovada = sub({ items: { data: [item('si_plano', null), item('si_ad', 'ad_offgrid_mensal', { current_period_end: proximo })] } });
    await liberarAdicionaisDaFatura(stripeCom(renovada), { id: 'in_2', subscription: 'sub_1' });
    expect(Date.parse(posse('offgrid')!.expira_em)).toBe(proximo * 1000 + 3 * DIA);
  });

  it('quem já tem a ferramenta para sempre não é tocado', async () => {
    semear('entitlements', { user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: null, obs: 'Kiwify' });
    await liberarAdicionaisDaFatura(stripeCom(sub()), { id: 'in_1', subscription: 'sub_1' });
    expect(posse('offgrid')!.expira_em).toBeNull();
    expect(posse('offgrid')!.obs).toBe('Kiwify');
  });

  it('assinatura só de plano, ou fatura sem assinatura, não grava nada', async () => {
    const soPlano = sub({ items: { data: [item('si_plano', null)] } });
    expect(await liberarAdicionaisDaFatura(stripeCom(soPlano), { id: 'in_3', subscription: 'sub_1' })).toEqual({ liberados: [], soAdicional: false });
    expect(await liberarAdicionaisDaFatura(stripeCom(sub()), { id: 'in_4' })).toEqual({ liberados: [], soAdicional: false });
    expect(db.entitlements).toHaveLength(0);
  });

  it('assinatura SÓ de adicional é reconhecida (não é o plano)', async () => {
    const s = sub({ items: { data: [item('si_ad', 'ad_limpapro_mensal')] } });
    expect(assinaturaSoDeAdicional(s as never)).toBe(true);
    expect(assinaturaSoDeAdicional(sub() as never)).toBe(false);
    expect(itemDoPlano(sub().items.data)?.id).toBe('si_plano');
    expect(itemDoPlano(s.items.data)).toBeUndefined();
    const r = await liberarAdicionaisDaFatura(stripeCom(s), { id: 'in_5', subscription: 'sub_1' });
    expect(r).toEqual({ liberados: ['curso-limpapro'], soAdicional: true });
  });

  it('o plano é achado mesmo quando o adicional vem primeiro na lista', () => {
    expect(itemDoPlano([item('si_ad', 'ad_offgrid_mensal'), item('si_plano', null)])?.id).toBe('si_plano');
  });

  it('assinatura marcada para cancelar grava "cancelando"', async () => {
    await liberarAdicionaisDaFatura(stripeCom(sub({ cancel_at_period_end: true })), { id: 'in_6', subscription: 'sub_1' });
    expect(posse('offgrid')!.obs).toBe('adicional:cartao:offgrid:cancelando');
  });

  it('a sessão do checkout libera para a conta achada pelo e-mail (conta criada pelo webhook)', async () => {
    const s = sub({ metadata: {} });
    const r = await liberarAdicionaisDaSessao(stripeCom(s), {
      id: 'cs_1', subscription: 'sub_1', payment_status: 'paid', customer_email: EMAIL.toUpperCase(),
    });
    expect(r).toEqual(['offgrid']);
    expect(posse('offgrid')).toBeTruthy();
  });

  it('sessão sem assinatura ou sem conta não grava nada', async () => {
    expect(await liberarAdicionaisDaSessao(stripeCom(sub()), { id: 'cs_2', payment_status: 'paid' })).toEqual([]);
    const semConta = { id: 'cs_3', subscription: 'sub_1', payment_status: 'paid', customer_email: 'ninguem@x.com' };
    expect(await liberarAdicionaisDaSessao(stripeCom(sub({ metadata: {} })), semConta)).toEqual([]);
    expect(db.entitlements).toHaveLength(0);
  });
});

describe('fatura de adicional: classifica ANTES de liberar', () => {
  const soAdicional = () => sub({ items: { data: [item('si_ad', 'ad_limpapro_mensal')] } });

  it('fatura só de adicional segue marcada como tal mesmo quando a liberação lança erro', async () => {
    falhas.tabelaQuebrada.add('entitlements');
    const r = await processarFaturaDeAdicionais(stripeCom(soAdicional()), { id: 'in_x', subscription: 'sub_1' });
    expect(r).toEqual({ soAdicional: true, liberados: [] });
  });

  it('sem falha: classifica e libera', async () => {
    const r = await processarFaturaDeAdicionais(stripeCom(soAdicional()), { id: 'in_y', subscription: 'sub_1' });
    expect(r).toEqual({ soAdicional: true, liberados: ['curso-limpapro'] });
  });

  it('fatura de plano com adicional: libera o adicional e NÃO é só de adicional (o plano segue o caminho dele)', async () => {
    const r = await processarFaturaDeAdicionais(stripeCom(sub()), { id: 'in_z', subscription: 'sub_1' });
    expect(r).toEqual({ soAdicional: false, liberados: ['offgrid'] });
  });

  it('plano sem adicional e fatura sem assinatura: nada a fazer, nunca lança', async () => {
    const soPlano = sub({ items: { data: [item('si_plano', null)] } });
    expect(await processarFaturaDeAdicionais(stripeCom(soPlano), { id: 'in_1', subscription: 'sub_1' })).toEqual({ soAdicional: false, liberados: [] });
    expect(await processarFaturaDeAdicionais(stripeCom(sub()), { id: 'in_2' })).toEqual({ soAdicional: false, liberados: [] });
  });

  it('leitura da assinatura que falha LANÇA (o webhook responde 500 e a Stripe reenvia): a fatura nunca segue pelo caminho do plano', async () => {
    const st = { subscriptions: { retrieve: vi.fn(async () => { throw new Error('rede'); }) }, customers: { retrieve: vi.fn() } };
    await expect(processarFaturaDeAdicionais(st, { id: 'in_3', subscription: 'sub_1' })).rejects.toBeInstanceOf(ErroLeituraDaAssinatura);
    await expect(faturaEhSoDeAdicional(st, { id: 'in_3', subscription: 'sub_1' })).rejects.toBeInstanceOf(ErroLeituraDaAssinatura);
    expect(db.entitlements).toHaveLength(0);
  });
});

describe('compra no cartão confere o acesso antes de cobrar', () => {
  it('quem já tem a ferramenta leva 409 e a Stripe nem é chamada', async () => {
    semear('entitlements', { user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: null });
    const st = { prices: { list: vi.fn() }, customers: { list: vi.fn() }, subscriptions: { list: vi.fn(), update: vi.fn() }, checkout: { sessions: { create: vi.fn() } } };
    await expect(comprarAdicionalCartao(st, { userId, email: EMAIL, item: 'offgrid', dashboardUrl: 'https://solardoc.app' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(st.prices.list).not.toHaveBeenCalled();
    expect(st.subscriptions.update).not.toHaveBeenCalled();
    expect(st.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('código novo do Pix leva os adicionais do contrato que venceu', () => {
  it('a autorização nova sai com 67 + adicionais', async () => {
    delete process.env.AGENTES5040_HMAC;
    await gravarAdicionaisDoPlano('SD-VIP-velho', ['offgrid']);
    asaasFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/customers?')) return { data: [{ id: 'cus_a' }] };
      if (path === '/pix/automatic/authorizations') {
        return {
          id: 'auth_n', status: 'CREATED', payload: '000201NOVO6304BBBB',
          immediateQrCode: { conciliationIdentifier: 'qr_n', expirationDate: iso(Date.now() + 20 * 3600_000) },
        };
      }
      return {};
    });
    const r = await gerarCodigoNovo({
      antigo: {
        contract_id: 'SD-VIP-velho', user_id: userId, email: EMAIL, cpf_cnpj: CPF, plano: 'ilimitado', cupom: null, status: 'pendente',
        created_at: iso(Date.now() - 3 * DIA), qr_payload: '000201VELHO6304AAAA', ultimo_pagamento_em: null, ultimo_pagamento_id: '', expira_em: null,
      },
      nome: 'Cliente', tel: '5534991230001',
    });
    const chamada = asaasFetch.mock.calls.find((c) => c[0] === '/pix/automatic/authorizations')!;
    expect(chamada[1].body.value).toBe(84);
    expect(r.qrPayload).toBe('000201NOVO6304BBBB');
    const novo = db.system_state.find((x) => String(x.key).startsWith('pix_auto_adic:') && x.key !== 'pix_auto_adic:SD-VIP-velho');
    expect(novo?.value).toEqual({ itens: ['offgrid'], valor: 17 });
  });
});

describe('linhas do bump no checkout', () => {
  // Preço como a Stripe devolve: valor, moeda e cobrança do catálogo (o resolvedor confere antes de usar).
  const cheio = (a: { id: string; lookup_key: string }) => ({
    ...a, active: true, currency: 'brl', recurring: { interval: 'month', interval_count: 1 },
    unit_amount: a.lookup_key.startsWith('ad_pacote_checkout') ? 3000 : a.lookup_key.startsWith('ad_pacote_app') ? 4000 : 1700,
  });
  const stripePrecos = (achados: Array<{ id: string; lookup_key: string }>) => ({ prices: { list: vi.fn(async () => ({ data: achados.map(cheio) })) } });

  it('monta uma linha por item, na ordem pedida', async () => {
    const st = stripePrecos([{ id: 'price_a', lookup_key: 'ad_offgrid_mensal' }, { id: 'price_b', lookup_key: 'ad_limpapro_mensal' }]);
    const r = await linhasDoBump(st, ['offgrid', 'curso-limpapro']);
    expect(r.linhas).toEqual([{ price: 'price_a', quantity: 1 }, { price: 'price_b', quantity: 1 }]);
    expect(r.aplicados).toEqual(['offgrid', 'curso-limpapro']);
  });

  it('o pacote do checkout usa o preço de R$ 30 (lookup do checkout)', async () => {
    const st = stripePrecos([{ id: 'price_pk', lookup_key: 'ad_pacote_checkout_mensal' }]);
    const r = await linhasDoBump(st, ['pacote']);
    expect(st.prices.list).toHaveBeenCalledWith(expect.objectContaining({ lookup_keys: ['ad_pacote_checkout_mensal'] }));
    expect(r.aplicados).toEqual(['pacote']);
  });

  it('preço que não existe na Stripe é descartado: o plano nunca fica sem venda', async () => {
    expect(await linhasDoBump(stripePrecos([]), ['offgrid'])).toEqual({ linhas: [], aplicados: [] });
  });

  it('Stripe fora do ar também não derruba o checkout', async () => {
    const fora = { prices: { list: vi.fn(async () => { throw new Error('rede'); }) } };
    expect(await linhasDoBump(fora, ['offgrid'])).toEqual({ linhas: [], aplicados: [] });
  });
});

// ── Pix do plano com bump ────────────────────────────────────────────────────
describe('bump no Pix automático do plano', () => {
  it('grava o que foi escolhido e estende por 1 mês + 3 dias a cada pagamento', async () => {
    await gravarAdicionaisDoPlano('SD-VIP-abc', ['curso-fechamento', 'offgrid']);
    const r = await estenderAdicionaisDoPlano(userId, 'SD-VIP-abc');
    expect([...r].sort()).toEqual(['curso-fechamento', 'offgrid']);
    const dias = (Date.parse(posse('offgrid')!.expira_em) - Date.now()) / DIA;
    expect(dias).toBeGreaterThan(32.5);
    expect(dias).toBeLessThan(34.5);
    expect(posse('offgrid')!.obs).toBe('adicional:pix:offgrid');
    expect(posse('offgrid')!.order_id).toBe('SD-VIP-abc');
  });

  it('contrato sem bump não grava nada', async () => {
    await gravarAdicionaisDoPlano('SD-VIP-sem', []);
    expect(await estenderAdicionaisDoPlano(userId, 'SD-VIP-sem')).toEqual([]);
    expect(db.entitlements).toHaveLength(0);
  });
});

function asaasDoPlano(): void {
  asaasFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/customers?')) return { data: [{ id: 'cus_a' }] };
    if (path === '/pix/automatic/authorizations') {
      return { id: 'auth_p', status: 'CREATED', payload: 'PIX', encodedImage: 'img', immediateQrCode: { conciliationIdentifier: 'qr_p' } };
    }
    return {};
  });
}

describe('o contrato do plano manda o valor somado ao Asaas', () => {
  it('autorização com value = 67 + adicionais e QR do 1º mês também somado', async () => {
    asaasDoPlano();
    const { criarPixRecorrente } = await import('../services/asaas/pixRecorrenteService');
    const r = await criarPixRecorrente({
      userId, email: EMAIL, nome: 'Cliente', cpfCnpj: CPF, planKey: 'ilimitado',
      adicionais: ['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro'],
    });
    const chamada = asaasFetch.mock.calls.find((c) => c[0] === '/pix/automatic/authorizations')!;
    expect(chamada[1].body.value).toBe(97);
    expect(chamada[1].body.immediateQrCode.originalValue).toBe(97);
    expect(r.valor).toBe(67);
    expect(r.adicionais).toEqual(['pacote']);
    expect(r.totalMensal).toBe(97);
    // O contrato guarda o que foi escolhido para o webhook estender.
    const guardado = db.system_state.find((x) => String(x.key).startsWith('pix_auto_adic:'));
    expect(guardado?.value).toEqual({ itens: ['pacote'], valor: 30 });
  });

  it('com a flag desligada o adicional do corpo é ignorado e a autorização é de R$ 67', async () => {
    delete process.env.ADICIONAIS_MENSAIS;
    asaasDoPlano();
    const { criarPixRecorrente } = await import('../services/asaas/pixRecorrenteService');
    const r = await criarPixRecorrente({
      userId, email: EMAIL, nome: 'Cliente', cpfCnpj: CPF, planKey: 'ilimitado', adicionais: ['pacote'],
    });
    const chamada = asaasFetch.mock.calls.find((c) => c[0] === '/pix/automatic/authorizations')!;
    expect(chamada[1].body.value).toBe(67);
    expect(r.adicionais).toEqual([]);
    expect(r.totalMensal).toBe(67);
  });
});

// ── Pix do adicional, comprado no app ────────────────────────────────────────
function simularAsaas(): void {
  let n = 0;
  asaasFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.startsWith('/customers?')) return { data: [{ id: 'cus_1' }] };
    if (path === '/pix/automatic/authorizations') {
      n += 1;
      return {
        id: `auth_${n}`, status: 'CREATED', payload: `PIXCOPIA${n}`, encodedImage: 'img',
        immediateQrCode: { conciliationIdentifier: `qr_${n}`, expirationDate: iso(Date.now() + 20 * 3600_000) },
      };
    }
    if (init?.method === 'DELETE') return {};
    return {};
  });
}

describe('adicional por Pix dentro do app', () => {
  it('cria a autorização separada de R$ 17 e não toca nas tabelas do plano', async () => {
    simularAsaas();
    const r = await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    const chamada = asaasFetch.mock.calls.find((c) => c[0] === '/pix/automatic/authorizations')!;
    expect(chamada[1].body.value).toBe(17);
    expect(chamada[1].body.contractId.startsWith('SDAD-')).toBe(true);
    expect(r.valor).toBe(17);
    expect(r.qrPayload).toBe('PIXCOPIA1');
    expect(db.asaas_pix_assinaturas).toHaveLength(0);
  });

  it('o pacote custa R$ 40 no app', async () => {
    simularAsaas();
    const r = await criarPixAdicional({ userId, item: 'pacote', cpf: CPF });
    expect(r.valor).toBe(40);
  });

  it('clique duplo devolve o MESMO código, sem abrir uma segunda autorização', async () => {
    simularAsaas();
    const a = await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    const b = await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    expect(b.contractId).toBe(a.contractId);
    expect(asaasFetch.mock.calls.filter((c) => c[0] === '/pix/automatic/authorizations')).toHaveLength(1);
  });

  it('CPF inválido, item inválido e flag desligada são recusados antes de falar com o Asaas', async () => {
    await expect(criarPixAdicional({ userId, item: 'offgrid', cpf: '123' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(criarPixAdicional({ userId, item: 'plano-x', cpf: CPF })).rejects.toMatchObject({ statusCode: 400 });
    delete process.env.ADICIONAIS_MENSAIS;
    await expect(criarPixAdicional({ userId, item: 'offgrid', cpf: CPF })).rejects.toMatchObject({ statusCode: 404 });
    expect(asaasFetch).not.toHaveBeenCalled();
  });

  it('quem já tem a ferramenta (por qualquer caminho) não compra de novo', async () => {
    semear('entitlements', { user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: null });
    await expect(criarPixAdicional({ userId, item: 'offgrid', cpf: CPF })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('pagamento do 1º mês (ligado pelo QR) libera 1 mês + 3 dias e NÃO credita o plano', async () => {
    simularAsaas();
    const r = await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    const res = await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_1', pixQrCodeId: 'qr_1' } });
    expect(res).toEqual({ tratado: true, motivo: 'adicional creditado' });
    const dias = (Date.parse(posse('offgrid')!.expira_em) - Date.now()) / DIA;
    expect(dias).toBeGreaterThan(32.5);
    expect(dias).toBeLessThan(34.5);
    expect(posse('offgrid')!.order_id).toBe(r.contractId);
    expect(db.users[0].plano_expira_em).toBeNull();
  });

  it('CONFIRMED e RECEIVED do mesmo pagamento creditam uma vez só', async () => {
    simularAsaas();
    await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    await tratarWebhookAdicionalPix('PAYMENT_CONFIRMED', { payment: { id: 'pay_1', pixQrCodeId: 'qr_1' } });
    const antes = posse('offgrid')!.expira_em;
    const res = await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_1', pixQrCodeId: 'qr_1' } });
    expect(res?.motivo).toBe('adicional ja creditado');
    expect(posse('offgrid')!.expira_em).toBe(antes);
  });

  it('o débito mensal chega só com o id: a instrução liga o pagamento ao contrato', async () => {
    simularAsaas();
    const r = await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    await tratarWebhookAdicionalPix('PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED', {
      paymentInstruction: { paymentId: 'pay_2', authorization: { id: 'auth_1' } },
    });
    expect(db.system_state.some((x) => x.key === 'adicional_pag:pay_2')).toBe(true);
    const res = await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_2' } });
    expect(res?.motivo).toBe('adicional creditado');
    expect(posse('offgrid')!.order_id).toBe(r.contractId);
  });

  it('evento que não é de adicional devolve null e segue o trilho do plano', async () => {
    const pagamentoDoPlano = { payment: { id: 'pay_x', pixQrCodeId: 'qr_do_plano', externalReference: 'SD-VIP-xyz' } };
    expect(await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', pagamentoDoPlano)).toBeNull();
    const ativacaoDoPlano = { authorization: { id: 'auth_do_plano', contractId: 'SD-VIP-xyz' } };
    expect(await tratarWebhookAdicionalPix('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', ativacaoDoPlano)).toBeNull();
  });

  it('comprar o pacote cancela as autorizações das avulsas quando o pacote é pago', async () => {
    simularAsaas();
    await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_1', pixQrCodeId: 'qr_1' } });
    await criarPixAdicional({ userId, item: 'pacote', cpf: CPF });
    await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_2', pixQrCodeId: 'qr_2' } });
    const apagou = asaasFetch.mock.calls.filter((c) => c[1]?.method === 'DELETE').map((c) => c[0]);
    expect(apagou).toEqual(['/pix/automatic/authorizations/auth_1']);
    expect(posse('inventario')).toBeTruthy();
  });

  it('cancelar: tira a autorização, marca "cancelando" e o acesso segue até a data', async () => {
    simularAsaas();
    await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_1', pixQrCodeId: 'qr_1' } });
    expect(await cancelarAdicionalPix(userId, 'offgrid')).toBe(true);
    expect(asaasFetch).toHaveBeenCalledWith('/pix/automatic/authorizations/auth_1', { method: 'DELETE' });
    expect(posse('offgrid')!.obs).toBe('adicional:pix:offgrid:cancelando');
    expect((await acessos(userId)).produtos.has('offgrid')).toBe(true);
    const estado = await estadoDosAdicionais(userId);
    expect(estado.ativos).toEqual([expect.objectContaining({ id: 'offgrid', meio: 'pix', cancelado: true })]);
  });

  it('falha ao cancelar no Asaas NÃO marca como cancelado', async () => {
    simularAsaas();
    await criarPixAdicional({ userId, item: 'offgrid', cpf: CPF });
    await tratarWebhookAdicionalPix('PAYMENT_RECEIVED', { payment: { id: 'pay_1', pixQrCodeId: 'qr_1' } });
    asaasFetch.mockImplementation(async () => { throw new Error('asaas fora'); });
    await expect(cancelarAdicionalPix(userId, 'offgrid')).rejects.toMatchObject({ statusCode: 502 });
    expect(posse('offgrid')!.obs).toBe('adicional:pix:offgrid');
  });

  it('adicional pago junto com o Pix do plano não se cancela sozinho (o valor da autorização é fixo)', async () => {
    await gravarAdicionaisDoPlano('SD-VIP-abc', ['offgrid']);
    await estenderAdicionaisDoPlano(userId, 'SD-VIP-abc');
    await expect(cancelarAdicionalPix(userId, 'offgrid')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('estado dos adicionais na tela', () => {
  it('flag desligada: tudo vazio', async () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(await estadoDosAdicionais(userId)).toEqual({ ativos: [], podeComprar: [] });
  });

  it('lista o que falta e oferece o pacote; o que a conta já tem não aparece', async () => {
    semear('entitlements', { user_id: userId, produto: 'inventario', origem: 'compra', expira_em: null });
    const e = await estadoDosAdicionais(userId);
    expect(e.ativos).toEqual([]);
    // O Fecha Vendas já vem pela assinatura desta conta (sem corte definido o brinde segue): não é oferecido.
    expect(e.podeComprar).toEqual(['offgrid', 'curso-limpapro', 'pacote']);
  });

  it('adicional ativo mostra quando renova (sem a folga de 3 dias)', async () => {
    const fim = Date.now() + 20 * DIA;
    semear('entitlements', { user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: iso(fim + 3 * DIA), obs: 'adicional:cartao:offgrid' });
    const e = await estadoDosAdicionais(userId);
    expect(e.ativos).toEqual([{ id: 'offgrid', meio: 'cartao', renovaEm: iso(fim), cancelado: false }]);
    expect(e.podeComprar).not.toContain('offgrid');
  });

  it('posse vencida não é ativo e volta a poder comprar', async () => {
    semear('entitlements', { user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: iso(Date.now() - DIA), obs: 'adicional:cartao:offgrid' });
    const e = await estadoDosAdicionais(userId);
    expect(e.ativos).toEqual([]);
    expect(e.podeComprar).toContain('offgrid');
  });
});

describe('cancelar no cartão', () => {
  const comPosse = (subId: string) => semear('entitlements', {
    user_id: userId, produto: 'offgrid', origem: 'compra', expira_em: iso(Date.now() + 30 * DIA), obs: 'adicional:cartao:offgrid', order_id: subId,
  });

  it('assinatura do plano: tira só o item, sem proração, e marca cancelando', async () => {
    comPosse('sub_1');
    const st = { subscriptions: { retrieve: vi.fn(async () => sub()), update: vi.fn(async () => ({})) } };
    expect(await cancelarAdicionalCartao(st, { userId, item: 'offgrid' })).toBe(true);
    expect(st.subscriptions.update).toHaveBeenCalledWith('sub_1', { items: [{ id: 'si_ad', deleted: true }], proration_behavior: 'none' });
    expect(posse('offgrid')!.obs).toBe('adicional:cartao:offgrid:cancelando');
  });

  it('assinatura só de adicional com um item: cancela no fim do período', async () => {
    comPosse('sub_9');
    const so = sub({ id: 'sub_9', items: { data: [item('si_ad', 'ad_offgrid_mensal')] } });
    const st = { subscriptions: { retrieve: vi.fn(async () => so), update: vi.fn(async () => ({})) } };
    await cancelarAdicionalCartao(st, { userId, item: 'offgrid' });
    expect(st.subscriptions.update).toHaveBeenCalledWith('sub_9', { cancel_at_period_end: true });
  });

  it('sem adicional no cartão devolve false e não chama a Stripe', async () => {
    const st = { subscriptions: { retrieve: vi.fn(), update: vi.fn() } };
    expect(await cancelarAdicionalCartao(st, { userId, item: 'offgrid' })).toBe(false);
    expect(st.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});
