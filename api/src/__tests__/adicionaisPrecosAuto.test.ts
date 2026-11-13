import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O servidor cria sozinho o preço do adicional que faltar na Stripe (com ADICIONAIS_MENSAIS ligada), sem nunca deixar dois preços ativos e sem
// nunca usar um preço com valor diferente do catálogo. Stripe simulada em memória, com a unicidade da lookup_key como a de verdade.
// ─────────────────────────────────────────────────────────────────────────────

const alertas = vi.hoisted(() => ({ lista: [] as Array<{ assunto: string; corpo: string }> }));
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: vi.fn(async (assunto: string, corpo: string) => { alertas.lista.push({ assunto, corpo }); }),
}));

import {
  ErroPrecoAdicional, _limparCachePrecos, divergenciaDoPreco, definicoesDePreco, garantirPrecosAdicionais, resolverPrecosAdicionais,
} from '../services/produtos/adicionaisPrecos';
import { linhasDoBump } from '../services/produtos/adicionaisStripe';

type Preco = {
  id: string; lookup_key: string; product: string; unit_amount: number; currency: string; active: boolean;
  recurring: { interval: string; interval_count?: number } | null; nickname?: string;
};
type Produto = { id: string; name: string; active: boolean; metadata: Record<string, string> };

function stripeSimulada(inicial: { precos?: Preco[]; produtos?: Produto[]; semBusca?: boolean } = {}) {
  const precos: Preco[] = [...(inicial.precos ?? [])];
  const produtos: Produto[] = [...(inicial.produtos ?? [])];
  let n = 0;
  const s = {
    precos, produtos,
    prices: {
      list: vi.fn(async (q: { lookup_keys?: string[]; active?: boolean }) => ({
        data: precos.filter((p) => (!q.lookup_keys || q.lookup_keys.includes(p.lookup_key)) && (q.active === undefined || p.active === q.active)),
      })),
      create: vi.fn(async (b: any) => {
        // A unicidade de verdade: lookup_key já usada (por qualquer preço) recusa, sem transfer_lookup_key.
        if (precos.some((p) => p.lookup_key === b.lookup_key) && !b.transfer_lookup_key) throw new Error('lookup_key already in use');
        const novo: Preco = {
          id: `price_${++n}`, lookup_key: b.lookup_key, product: b.product, unit_amount: b.unit_amount, currency: b.currency,
          active: true, recurring: { ...b.recurring, interval_count: 1 }, nickname: b.nickname,
        };
        precos.push(novo);
        return novo;
      }),
    },
    products: {
      search: vi.fn(async (q: { query: string }) => {
        if (inicial.semBusca) throw new Error('search indisponivel');
        const grupo = /sd_adicional'\]:'([^']+)'/.exec(q.query)?.[1];
        return { data: produtos.filter((p) => p.active && p.metadata.sd_adicional === grupo) };
      }),
      list: vi.fn(async () => ({ data: produtos.filter((p) => p.active), has_more: false })),
      create: vi.fn(async (b: { name: string; metadata: Record<string, string> }) => {
        const p: Produto = { id: `prod_${++n}`, name: b.name, active: true, metadata: b.metadata };
        produtos.push(p);
        return p;
      }),
    },
  };
  return s;
}

const certo = (lookup_key: string, over: Partial<Preco> = {}): Preco => {
  const def = definicoesDePreco().find((d) => d.lookupKey === lookup_key)!;
  return {
    id: `price_existente_${lookup_key}`, lookup_key, product: 'prod_x', unit_amount: Math.round(def.valor * 100), currency: 'brl',
    active: true, recurring: { interval: 'month', interval_count: 1 }, ...over,
  };
};

const ENV = { ...process.env };
beforeEach(() => {
  _limparCachePrecos();
  alertas.lista = [];
  process.env.ADICIONAIS_MENSAIS = '1';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

describe('cria o que falta', () => {
  it('sem preço: cria produto + preço BRL mensal, valor do catálogo, mesma lookup_key e mesmo nome do script', async () => {
    const st = stripeSimulada();
    const r = await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(r.get('ad_offgrid_mensal')).toBe(st.precos[0].id);
    expect(st.produtos).toHaveLength(1);
    expect(st.produtos[0]).toMatchObject({ name: 'Venda Off-Grid (adicional mensal)', metadata: { sd_adicional: 'offgrid' } });
    expect(st.precos).toHaveLength(1);
    expect(st.precos[0]).toMatchObject({
      lookup_key: 'ad_offgrid_mensal', currency: 'brl', unit_amount: 1700, product: st.produtos[0].id, recurring: { interval: 'month' },
    });
    const chamada = st.prices.create.mock.calls[0][0];
    expect(chamada.transfer_lookup_key).toBeUndefined();
  });

  it('os valores do catálogo: R$ 17 cada, R$ 30 o pacote do checkout, R$ 40 o do app', async () => {
    const st = stripeSimulada();
    await resolverPrecosAdicionais(st, ['ad_inventario_mensal', 'ad_pacote_checkout_mensal', 'ad_pacote_app_mensal']);
    const por = Object.fromEntries(st.precos.map((p) => [p.lookup_key, p.unit_amount]));
    expect(por).toEqual({ ad_inventario_mensal: 1700, ad_pacote_checkout_mensal: 3000, ad_pacote_app_mensal: 4000 });
  });

  it('os dois preços do pacote dividem UM produto', async () => {
    const st = stripeSimulada();
    await resolverPrecosAdicionais(st, ['ad_pacote_checkout_mensal', 'ad_pacote_app_mensal']);
    expect(st.produtos.filter((p) => p.metadata.sd_adicional === 'pacote')).toHaveLength(1);
    expect(new Set(st.precos.map((p) => p.product)).size).toBe(1);
  });

  it('reaproveita o produto que já existe (por metadata, ou por nome se a busca estiver fora)', async () => {
    const existente: Produto = { id: 'prod_velho', name: 'Venda Off-Grid (adicional mensal)', active: true, metadata: { sd_adicional: 'offgrid' } };
    const a = stripeSimulada({ produtos: [existente] });
    await resolverPrecosAdicionais(a, ['ad_offgrid_mensal']);
    expect(a.products.create).not.toHaveBeenCalled();
    expect(a.precos[0].product).toBe('prod_velho');

    _limparCachePrecos();
    const b = stripeSimulada({ produtos: [{ ...existente, metadata: {} }], semBusca: true });
    await resolverPrecosAdicionais(b, ['ad_offgrid_mensal']);
    expect(b.products.create).not.toHaveBeenCalled();
    expect(b.precos[0].product).toBe('prod_velho');
  });

  it('busca vazia (a Stripe demora a indexar) mas o produto está na lista: usa o da lista e NÃO cria produto novo', async () => {
    const existente: Produto = { id: 'prod_indexando', name: 'Venda Off-Grid (adicional mensal)', active: true, metadata: { sd_adicional: 'offgrid' } };
    const st = stripeSimulada({ produtos: [existente] });
    st.products.search.mockResolvedValue({ data: [] });
    await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(st.products.search).toHaveBeenCalled();
    expect(st.products.list).toHaveBeenCalled();
    expect(st.products.create).not.toHaveBeenCalled();
    expect(st.precos[0].product).toBe('prod_indexando');
  });

  it('busca vazia e lista sem o produto: aí sim cria', async () => {
    const st = stripeSimulada();
    st.products.search.mockResolvedValue({ data: [] });
    await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(st.products.list).toHaveBeenCalled();
    expect(st.products.create).toHaveBeenCalledTimes(1);
  });

  it('com a flag DESLIGADA não cria nada (só lê)', async () => {
    delete process.env.ADICIONAIS_MENSAIS;
    const st = stripeSimulada();
    const r = await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(r.size).toBe(0);
    expect(st.precos).toHaveLength(0);
    expect(st.products.create).not.toHaveBeenCalled();
  });

  it('cliente sem `products` (quem só lê) não cria e não quebra', async () => {
    const r = await resolverPrecosAdicionais({ prices: { list: vi.fn(async () => ({ data: [] })) } }, ['ad_offgrid_mensal']);
    expect(r.size).toBe(0);
  });

  it('o checkout do plano com o bump: o preço que faltava é criado e a linha entra na cobrança', async () => {
    const st = stripeSimulada();
    const r = await linhasDoBump(st, ['curso-limpapro']);
    expect(r.aplicados).toEqual(['curso-limpapro']);
    expect(r.linhas).toEqual([{ price: st.precos[0].id, quantity: 1 }]);
    expect(st.precos[0].unit_amount).toBe(1700);
  });
});

describe('reaproveita o que existe', () => {
  it('preço certo existente: usa o id, não cria nada e guarda em cache', async () => {
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal')] });
    const r = await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(r.get('ad_offgrid_mensal')).toBe('price_existente_ad_offgrid_mensal');
    expect(st.prices.create).not.toHaveBeenCalled();
    expect(st.products.create).not.toHaveBeenCalled();
    await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(st.prices.list).toHaveBeenCalledTimes(1);
  });
});

describe('corrida', () => {
  it('duas requisições ao mesmo tempo resolvem para o mesmo preço, com uma criação só', async () => {
    const st = stripeSimulada();
    const [a, b] = await Promise.all([
      resolverPrecosAdicionais(st, ['ad_offgrid_mensal']),
      resolverPrecosAdicionais(st, ['ad_offgrid_mensal']),
    ]);
    expect(a.get('ad_offgrid_mensal')).toBe(b.get('ad_offgrid_mensal'));
    expect(st.precos).toHaveLength(1);
    expect(st.prices.create).toHaveBeenCalledTimes(1);
  });

  it('outra instância criou no meio: a Stripe recusa a chave repetida, lista de novo e usa o existente (nunca dois preços)', async () => {
    const st = stripeSimulada();
    const vencedor = certo('ad_offgrid_mensal', { id: 'price_do_vencedor' });
    // Na hora de criar, o preço do vencedor já apareceu (a 1ª leitura não o viu).
    st.prices.create.mockImplementationOnce(async () => { st.precos.push(vencedor); throw new Error('lookup_key already in use'); });
    const r = await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(r.get('ad_offgrid_mensal')).toBe('price_do_vencedor');
    expect(st.precos.filter((p) => p.lookup_key === 'ad_offgrid_mensal' && p.active)).toHaveLength(1);
  });

  it('o vencedor da corrida com valor errado também é recusado', async () => {
    const st = stripeSimulada();
    st.prices.create.mockImplementationOnce(async () => {
      st.precos.push(certo('ad_offgrid_mensal', { id: 'price_torto', unit_amount: 9700 }));
      throw new Error('lookup_key already in use');
    });
    await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toBeInstanceOf(ErroPrecoAdicional);
  });

  it('erro de criação sem preço existente (Stripe fora) sobe como erro, sem cache', async () => {
    const st = stripeSimulada();
    st.prices.create.mockRejectedValueOnce(new Error('stripe fora'));
    await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toThrow('stripe fora');
    // Na próxima tentativa tenta de novo (a falha não ficou presa no cache).
    const r = await resolverPrecosAdicionais(st, ['ad_offgrid_mensal']);
    expect(r.get('ad_offgrid_mensal')).toBeTruthy();
  });
});

describe('valor divergente: lança, avisa o dono e não cria outro', () => {
  const casos: Array<[string, Partial<Preco>, RegExp]> = [
    ['valor', { unit_amount: 9700 }, /valor 9700 centavos \(catalogo: 1700\)/],
    ['moeda', { currency: 'usd' }, /moeda usd/],
    ['intervalo', { recurring: { interval: 'year', interval_count: 1 } }, /1x year/],
    ['a cada 2 meses', { recurring: { interval: 'month', interval_count: 2 } }, /2x month/],
    ['cobrança única', { recurring: null }, /unica/],
    ['cobrança por uso (metered)', { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } as any }, /uso metered/],
  ];
  for (const [rotulo, over, esperado] of casos) {
    it(`${rotulo} diferente: ErroPrecoAdicional, nenhum preço criado, e-mail ao dono`, async () => {
      const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', over)] });
      await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toMatchObject({ name: 'ErroPrecoAdicional', lookupKey: 'ad_offgrid_mensal' });
      await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toBeInstanceOf(ErroPrecoAdicional);
      expect(st.prices.create).not.toHaveBeenCalled();
      expect(st.products.create).not.toHaveBeenCalled();
      expect(st.precos).toHaveLength(1);
      expect(alertas.lista).toHaveLength(1);                       // uma vez por chave por instância
      expect(alertas.lista[0].assunto).toMatch(/diverge do catálogo/);
      expect(alertas.lista[0].corpo).toContain('ad_offgrid_mensal');
      expect(alertas.lista[0].corpo).toMatch(esperado);
    });
  }

  it('com a flag DESLIGADA o preço divergente também não é usado', async () => {
    delete process.env.ADICIONAIS_MENSAIS;
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', { unit_amount: 9700 })] });
    await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toBeInstanceOf(ErroPrecoAdicional);
  });

  it('no checkout do plano o bump divergente é descartado e o plano segue sem ele', async () => {
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', { unit_amount: 9700 })] });
    expect(await linhasDoBump(st, ['offgrid'])).toEqual({ linhas: [], aplicados: [] });
    expect(st.prices.create).not.toHaveBeenCalled();
  });

  it('bump com vários itens: o divergente sai sozinho, os outros ficam (e o metadata só leva o que entrou)', async () => {
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', { unit_amount: 9700 }), certo('ad_inventario_mensal')] });
    const r = await linhasDoBump(st, ['offgrid', 'inventario', 'curso-limpapro']);
    expect(r.aplicados).toEqual(['inventario', 'curso-limpapro']);
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]).toEqual({ price: 'price_existente_ad_inventario_mensal', quantity: 1 });
    // o divergente não ganhou preço novo; o que faltava foi criado
    expect(st.precos.filter((p) => p.lookup_key === 'ad_offgrid_mensal')).toHaveLength(1);
    expect(st.precos.find((p) => p.lookup_key === 'ad_limpapro_mensal')?.unit_amount).toBe(1700);
  });

  it('bump: falha da Stripe em UM item não derruba os outros', async () => {
    const st = stripeSimulada({ precos: [certo('ad_inventario_mensal')] });
    st.prices.list.mockRejectedValueOnce(new Error('rede'));
    const r = await linhasDoBump(st, ['offgrid', 'inventario']);
    expect(r.aplicados).toEqual(['inventario']);
  });

  it('bump: com TODOS divergentes o plano segue sem nenhuma linha', async () => {
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', { currency: 'usd' }), certo('ad_inventario_mensal', { unit_amount: 1 })] });
    expect(await linhasDoBump(st, ['offgrid', 'inventario'])).toEqual({ linhas: [], aplicados: [] });
  });

  it('preço inativo com a chave: a Stripe recusa criar, e o inativo NÃO é usado', async () => {
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', { active: false })] });
    await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toMatchObject({ name: 'ErroPrecoAdicional' });
    expect(st.precos).toHaveLength(1);
  });

  it('o e-mail que falha não derruba: o erro de preço continua sendo o que sobe', async () => {
    const { sendOpsAlert } = await import('../utils/mailer');
    vi.mocked(sendOpsAlert).mockRejectedValueOnce(new Error('resend fora'));
    const st = stripeSimulada({ precos: [certo('ad_offgrid_mensal', { unit_amount: 1 })] });
    await expect(resolverPrecosAdicionais(st, ['ad_offgrid_mensal'])).rejects.toBeInstanceOf(ErroPrecoAdicional);
  });
});

describe('divergenciaDoPreco', () => {
  const def = definicoesDePreco().find((d) => d.lookupKey === 'ad_pacote_app_mensal')!;
  it('usage_type licensed explícito e usage_type ausente valem (a Stripe devolve os dois jeitos); metered não', () => {
    const base = certo('ad_pacote_app_mensal');
    expect(divergenciaDoPreco({ ...base, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }, def)).toBeNull();
    expect(divergenciaDoPreco({ ...base, recurring: { interval: 'month', interval_count: 1 } }, def)).toBeNull();
    expect(divergenciaDoPreco({ ...base, recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } }, def)).toMatch(/uso metered/);
  });
  it('bate quando valor, moeda e cobrança são os do catálogo', () => {
    expect(divergenciaDoPreco(certo('ad_pacote_app_mensal'), def)).toBeNull();
  });
  it('R$ 30 no preço do app (R$ 40) diverge', () => {
    expect(divergenciaDoPreco(certo('ad_pacote_app_mensal', { unit_amount: 3000 }), def)).toMatch(/valor 3000/);
  });
});

describe('o script segue valendo (mesmo código)', () => {
  it('simulação não cria; --criar cria os 6; a segunda rodada só encontra', async () => {
    const st = stripeSimulada();
    const sim = await garantirPrecosAdicionais(st, { criar: false });
    expect(sim.map((r) => r.situacao)).toEqual(Array(6).fill('faltaria-criar'));
    expect(st.precos).toHaveLength(0);

    const criado = await garantirPrecosAdicionais(st, { criar: true });
    expect(criado.map((r) => r.situacao)).toEqual(Array(6).fill('criado'));
    expect(st.precos).toHaveLength(6);
    expect(st.produtos.filter((p) => p.metadata.sd_adicional === 'pacote')).toHaveLength(1);

    const de_novo = await garantirPrecosAdicionais(st, { criar: true });
    expect(de_novo.map((r) => r.situacao)).toEqual(Array(6).fill('ja-existe'));
    expect(st.precos).toHaveLength(6);
  });

  it('preço divergente no script também lança e não altera nada', async () => {
    const st = stripeSimulada({ precos: [certo('ad_limpapro_mensal', { unit_amount: 4700 })] });
    await expect(garantirPrecosAdicionais(st, { criar: true })).rejects.toBeInstanceOf(ErroPrecoAdicional);
    expect(st.prices.create).not.toHaveBeenCalled();
  });
});
