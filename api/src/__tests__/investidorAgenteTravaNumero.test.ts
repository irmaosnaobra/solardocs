import { describe, it, expect, vi } from 'vitest';

// A TRAVA POR CÓDIGO PARA NÚMERO NA FALA DA HELENA (13/10/2026).
// Até aqui "não fale número" era só instrução ao modelo. Agora `violaRegras` barra:
//   · valor em reais que a pessoa não disse (compara pelo número: 140 mil = 140.000);
//   · potência (80 kW), prazo (45 dias) e volume de recarga (15 recargas por dia);
// e deixa passar o que é conversa: "kWh" sem número, "24h", data, hora e "30 minutos".
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  violaRegras, valoresEmReais, valoresLiberados, pedidoDeReescrita, type MsgDaConversa,
} from '../services/io/investidorAgentePuro';

describe('violaRegras: número que o modelo não pode dizer', () => {
  it('as três frases do pedido acusam', () => {
    expect(violaRegras(['Esse modelo sai por R$ 180 mil.'])).toMatch(/valor em reais/);
    expect(violaRegras(['São 80 kW e 45 dias de obra.'])).not.toBeNull();
    expect(violaRegras(['Dá para fazer 15 recargas por dia.'])).toMatch(/recargas/);
  });

  it('cada família acusa pelo motivo certo', () => {
    expect(violaRegras(['É um carregador de 80 kW'])).toMatch(/potência/);
    expect(violaRegras(['Um de 7,4 kWh'])).toMatch(/potência/);
    expect(violaRegras(['Fica pronto em 45 dias'])).toMatch(/prazo/);
    expect(violaRegras(['A obra leva uns 2 meses'])).toMatch(/prazo/);
    expect(violaRegras(['Em 2 anos muita coisa muda'])).toMatch(/prazo/);
    for (const t of ['em 3 semanas', 'em 1 mês', 'em 1 dia', 'O prazo é de uns 3 meses', 'A entrega leva 20 dias', 'A homologação demora 2 meses', 'Fica pronta, uns 45 dias']) {
      expect(violaRegras([t]), t).toMatch(/prazo/);
    }
    expect(violaRegras(['São 15 recargas por dia'])).toMatch(/recargas/);
    expect(violaRegras(['Dá umas 300 recargas'])).toMatch(/recargas/);
    expect(violaRegras(['Cada recarga por mês conta'])).toMatch(/recargas/);
    expect(violaRegras(['Umas 20 recargas'])).toMatch(/recargas/);
    expect(violaRegras(['Umas 20 boas recargas'])).toMatch(/recargas/);
    expect(violaRegras(['Uma recarga por hora'])).toMatch(/recargas/);
  });

  it('tempo que passou ou conversa, sem promessa de prazo, passa', () => {
    for (const t of [
      'Faz 2 semanas que você preencheu',
      'Te chamo nos próximos 2 dias',
      'Há 1 mês você preencheu o formulário',
      'Nos últimos 3 dias tentei falar com você',
      'Daqui a 3 dias eu volto a falar com você',
      'Uns 2 meses atrás você se cadastrou',
      'Você pensa nisso há 2 anos?',
    ]) {
      expect(violaRegras([t]), t).toBeNull();
    }
  });

  it('dígito solto perto da palavra "recarga" não barra', () => {
    for (const t of [
      'Monitoramento remoto 24h e cadastro nos apps e mapas de recarga',
      'Terça 13/10 às 10:00, e a primeira recarga é com a gente',
      'Quarta às 15:00 falamos de recarga',
    ]) {
      expect(violaRegras([t]), t).toBeNull();
    }
  });

  it('valor sem R$: "180 mil" e "2 milhões" também barram, salvo os que a pessoa disse', () => {
    expect(violaRegras(['Sai por 180 mil'])).toMatch(/valor em reais/);
    expect(violaRegras(['Custa uns 2 milhões'])).toMatch(/valor em reais/);
    expect(violaRegras(['Custa 1,5 milhão'])).toMatch(/valor em reais/);
    expect(violaRegras(['Os seus 140 mil'], [140000])).toBeNull();
    expect(violaRegras(['Os seus 140 mil'])).toMatch(/valor em reais/);
    expect(violaRegras(['Sai por 180 mil'], [140000])).toMatch(/180/);
    // "mil" sem número na frente é palavra comum
    expect(violaRegras(['Já ajudamos mil pessoas?'.replace('mil pessoas', 'muita gente')])).toBeNull();
  });

  it('valor em reais: R$, "mil", "mil reais", "reais", milhão e milhões', () => {
    for (const t of ['R$ 70', 'R$70 mil', 'R$ 1,5 milhão', 'R$ 150.000,00', '200 mil reais', '80 reais', '2 milhões', '1 milhão']) {
      expect(violaRegras([t]), t).toMatch(/valor em reais/);
    }
  });

  it('o que é conversa passa', () => {
    for (const t of [
      'A tarifa por kWh quem define é você',
      'Monitoramento remoto 24h',
      'Terça 13/10 às 10:00',
      'Quarta tenho dois horários depois do almoço: 13:00 ou 15:00',
      'Dura uns 30 minutos',
      'O consultor mostra os números na reunião.',
      'Tenho 4 horários livres na quinta',
      'Você tem recargas por perto?'.replace('recargas por perto', 'um ponto'),
    ]) {
      expect(violaRegras([t]), t).toBeNull();
    }
  });

  it('valor que a pessoa disse passa, comparado pelo número', () => {
    const frase = ['Como isso se encaixa nos seus R$ 140 mil depende do modelo de negócio'];
    expect(violaRegras(frase, [140000])).toBeNull();
    expect(violaRegras(frase)).toMatch(/valor em reais/);
    expect(violaRegras(frase, [])).toMatch(/valor em reais/);
    // 140 mil = R$ 140 mil = 140.000, escritos de jeitos diferentes
    expect(violaRegras(['Com 140 mil reais'], [140000])).toBeNull();
    expect(violaRegras(['Com R$ 140.000,00'], [140000])).toBeNull();
    expect(violaRegras(['Com R$ 140.000'], [140000])).toBeNull();
  });

  it('só o valor da pessoa passa: outro valor, mesmo com a lista, acusa', () => {
    expect(violaRegras(['Dá para começar com R$ 180 mil'], [140000])).toMatch(/180/);
  });

  it('potência, prazo e recarga acusam mesmo com valor liberado', () => {
    expect(violaRegras(['Nos seus R$ 140 mil cabe um de 80 kW'], [140000])).toMatch(/potência/);
  });
});

describe('valoresEmReais', () => {
  const v = (t: string, estreito = false) => valoresEmReais(t.toLowerCase(), estreito);

  it('leitura larga (o que a pessoa escreve): mil, k, milhão, ponto de milhar e número cru', () => {
    expect(v('tenho 140 mil')).toEqual([140000]);
    expect(v('uns 300k')).toEqual([300000]);
    expect(v('r$ 1,5 milhao')).toEqual([1500000]);
    expect(v('r$ 140.000,00')).toEqual([140000]);
    expect(v('300000')).toEqual([300000]);
    expect(v('de r$ 100 mil a r$ 300 mil').sort((a, b) => a - b)).toEqual([100000, 300000]);
  });

  it('leitura estreita (a fala da Helena) não conta "140k" nem número cru', () => {
    // sem moeda, "mil" conta na fala da Helena (desde 13/10), mas "k" e número cru não
    expect(v('140k', true)).toEqual([]);
    expect(v('300000', true)).toEqual([]);
    expect(v('140 mil reais', true)).toEqual([140000]);
    expect(v('180 mil', true)).toEqual([180000]);
  });

  it('número sem valor não vira valor (data, hora, endereço)', () => {
    expect(v('terça 13/10 às 10:00 na rua 1500')).toEqual([]);
  });
});

describe('valoresLiberados', () => {
  const msg = (from_me: boolean, texto: string): MsgDaConversa => ({ from_me, texto, tipo: 'texto', momment: '2026-10-13T10:00:00.000Z' });

  it('junta o valor do cadastro, o confirmado e o que a pessoa escreveu; a fala da Helena não conta', () => {
    const lib = valoresLiberados(
      { valorTxt: 'R$ 100 mil a R$ 300 mil', dados: { valor_confirmado: 'uns 250 mil' }, formulario: [] },
      [msg(true, 'Posso falar de R$ 999 mil'), msg(false, 'tenho 180 mil guardado')],
      [msg(false, 'ou 2 milhões se precisar')],
    );
    expect([...new Set(lib)].sort((a, b) => a - b)).toEqual([100000, 180000, 250000, 300000, 2000000]);
  });

  it('sem nada declarado, a lista é vazia', () => {
    expect(valoresLiberados({ valorTxt: '', dados: {}, formulario: [] }, [], [])).toEqual([]);
  });
});

describe('o recado da reescrita avisa dos números', () => {
  it('cita valor, potência, prazo e recargas', () => {
    const p = pedidoDeReescrita('PEDIDO', 'citou prazo ("45 dias")', ['45 dias']);
    expect(p).toContain('número que a pessoa não disse');
    expect(p).toContain('quantidade de recargas');
  });
});
