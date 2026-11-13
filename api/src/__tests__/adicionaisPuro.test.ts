import { describe, it, expect, afterEach } from 'vitest';
import {
  adicionaisLigado, corteDosAdicionais, itemDaLookup, lerObsDoAdicional, lookupKeyDoItem, normalizarAdicionais,
  obsDoAdicional, ofertaPublica, produtosDaLista, produtosDaLookup, somaMensal, todasAsLookupKeys,
} from '../services/produtos/adicionais';

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

describe('normalizarAdicionais', () => {
  it('lixo vira lista vazia', () => {
    expect(normalizarAdicionais(undefined)).toEqual([]);
    expect(normalizarAdicionais('offgrid')).toEqual([]);
    expect(normalizarAdicionais([1, null, {}, 'xpto'])).toEqual([]);
  });

  it('tira repetição, mantém a ordem das ferramentas e ignora id desconhecido', () => {
    expect(normalizarAdicionais(['curso-limpapro', 'offgrid', 'offgrid', 'precificacao'])).toEqual(['offgrid', 'curso-limpapro']);
  });

  it('as 4 marcadas uma a uma viram o pacote (mais barato para o cliente)', () => {
    expect(normalizarAdicionais(['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro'])).toEqual(['pacote']);
  });

  it('pacote junto com avulsas vira só o pacote', () => {
    expect(normalizarAdicionais(['offgrid', 'pacote'])).toEqual(['pacote']);
  });
});

describe('somaMensal', () => {
  it('avulso custa R$ 17 em qualquer contexto', () => {
    expect(somaMensal(['offgrid'], 'checkout')).toBe(17);
    expect(somaMensal(['offgrid', 'inventario', 'curso-limpapro'], 'app')).toBe(51);
  });

  it('o pacote custa R$ 30 no checkout e R$ 40 no app', () => {
    expect(somaMensal(['pacote'], 'checkout')).toBe(30);
    expect(somaMensal(['pacote'], 'app')).toBe(40);
  });

  it('as 4 marcadas uma a uma já saem pelo preço do pacote, não por 4 x 17', () => {
    expect(somaMensal(['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro'], 'checkout')).toBe(30);
  });

  it('nada marcado custa zero', () => {
    expect(somaMensal([], 'checkout')).toBe(0);
    expect(somaMensal(undefined, 'app')).toBe(0);
  });
});

describe('o que cada item libera', () => {
  it('pacote libera as 4; avulso libera só ele', () => {
    expect(produtosDaLista(['pacote'])).toHaveLength(4);
    expect(produtosDaLista(['offgrid'])).toEqual(['offgrid']);
  });

  it('as 6 lookup_keys existem e cada uma volta ao item certo', () => {
    expect(todasAsLookupKeys()).toHaveLength(6);
    expect(lookupKeyDoItem('curso-fechamento', 'checkout')).toBe('ad_fechavendas_mensal');
    expect(lookupKeyDoItem('pacote', 'checkout')).toBe('ad_pacote_checkout_mensal');
    expect(lookupKeyDoItem('pacote', 'app')).toBe('ad_pacote_app_mensal');
    expect(itemDaLookup('ad_pacote_app_mensal')).toBe('pacote');
    expect(produtosDaLookup('ad_limpapro_mensal')).toEqual(['curso-limpapro']);
    expect(produtosDaLookup('ad_pacote_checkout_mensal')).toHaveLength(4);
  });

  it('price de plano (sem o prefixo ad_) nunca é adicional', () => {
    expect(produtosDaLookup('sd-vip-anual-56400')).toBeNull();
    expect(produtosDaLookup(null)).toBeNull();
  });
});

describe('carimbo em entitlements.obs', () => {
  it('vai e volta, com e sem cancelando', () => {
    expect(lerObsDoAdicional(obsDoAdicional('pix', 'pacote'))).toEqual({ meio: 'pix', item: 'pacote', cancelando: false });
    expect(lerObsDoAdicional(obsDoAdicional('cartao', 'offgrid', true))).toEqual({ meio: 'cartao', item: 'offgrid', cancelando: true });
  });

  it('obs de outra origem não é adicional', () => {
    expect(lerObsDoAdicional('incluso no plano anual')).toBeNull();
    expect(lerObsDoAdicional(null)).toBeNull();
    expect(lerObsDoAdicional('adicional:boleto:offgrid')).toBeNull();
  });
});

describe('flag e corte', () => {
  it('desligada por padrão', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(adicionaisLigado()).toBe(false);
    expect(ofertaPublica().ligado).toBe(false);
  });

  it('liga com 1, true ou sim', () => {
    for (const v of ['1', 'true', 'SIM']) {
      process.env.ADICIONAIS_MENSAIS = v;
      expect(adicionaisLigado()).toBe(true);
    }
    process.env.ADICIONAIS_MENSAIS = '0';
    expect(adicionaisLigado()).toBe(false);
  });

  it('a oferta pública traz os preços e as 4 ferramentas', () => {
    const o = ofertaPublica();
    expect(o.precos).toEqual({ avulso: 17, pacoteCheckout: 30, pacoteApp: 40 });
    expect(o.itens.map((i) => i.id)).toEqual(['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro']);
    expect(o.itens.every((i) => i.nome.length > 0)).toBe(true);
  });

  it('o corte lê a data ISO e ignora lixo', () => {
    process.env.ADICIONAIS_CORTE = '2026-11-14T12:00:00-03:00';
    expect(corteDosAdicionais()).toBe(Date.parse('2026-11-14T12:00:00-03:00'));
    process.env.ADICIONAIS_CORTE = 'amanha';
    expect(corteDosAdicionais()).toBeNull();
    delete process.env.ADICIONAIS_CORTE;
    expect(corteDosAdicionais()).toBeNull();
  });
});
