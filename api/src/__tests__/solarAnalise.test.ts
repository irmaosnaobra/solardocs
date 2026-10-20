import { describe, it, expect } from 'vitest';
import { analisarRateio, analisarConsumo, analisarSolar, paraNumero, type Valores } from '../services/gerador/solarAnalise';

// Análise da venda solar (rateio e consumo): módulo puro, sem mock nenhum. Documentos inventados (dígitos válidos).
const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
const CNPJ_MATRIZ = '11.222.333/0001-81';
const CNPJ_FILIAL = '11.222.333/0002-62';

const rateio = (v: Valores) => analisarRateio(v);
const temTexto = (lista: string[], re: RegExp) => lista.some((t) => re.test(t));

describe('rateio: bloqueios (mecânicos)', () => {
  it('soma 100 contando a geradora: sem bloqueio e sem aviso de soma', () => {
    const r = rateio({ unidade_consumidora: '100', geradora_pct: '40', benef_1_uc: '200', benef_1_pct: '35', benef_2_uc: '300', benef_2_pct: '25', rateio_modalidade: 'multiplas_ucs' });
    expect(r.soma).toBe(100);
    expect(r.bloqueios).toEqual([]);
    expect(temTexto(r.avisos, /soma dos percentuais/)).toBe(false);
  });
  it('soma 101 bloqueia (centavos somam sem erro de ponto flutuante)', () => {
    const r = rateio({ geradora_pct: '60', benef_1_uc: '200', benef_1_pct: '41' });
    expect(r.soma).toBe(101);
    expect(temTexto(r.bloqueios, /não pode passar de 100%/)).toBe(true);
    // 33,33 x 3 + 0,01 = 100: não bloqueia
    const t = rateio({ geradora_pct: '0.01', benef_1_uc: '1', benef_1_pct: '33.33', benef_2_uc: '2', benef_2_pct: '33.33', benef_3_uc: '3', benef_3_pct: '33.33' });
    expect(t.soma).toBe(100);
    expect(t.bloqueios).toEqual([]);
  });
  it('UC repetida bloqueia, entre geradora e beneficiária e entre beneficiárias (ignora pontuação)', () => {
    const a = rateio({ unidade_consumidora: '0012-3456', geradora_pct: '50', benef_1_uc: '00123456', benef_1_pct: '50' });
    expect(temTexto(a.bloqueios, /mesma unidade consumidora/)).toBe(true);
    const b = rateio({ unidade_consumidora: '9', geradora_pct: '40', benef_1_uc: '77', benef_1_pct: '30', benef_2_uc: ' 77 ', benef_2_pct: '30' });
    expect(b.bloqueios).toHaveLength(1);
    expect(b.bloqueios[0]).toMatch(/beneficiária 1 e na beneficiária 2/);
  });
  it('percentual sem UC e UC sem percentual bloqueiam', () => {
    const r = rateio({ geradora_pct: '50', benef_1_pct: '50', benef_2_uc: '200' });
    expect(r.bloqueios).toEqual([
      'A beneficiária 1 tem percentual e falta a unidade consumidora.',
      'A beneficiária 2 tem unidade consumidora e falta o percentual.',
    ]);
  });
  it('sem beneficiárias não há nada a conferir (autoconsumo local)', () => {
    const r = rateio({ unidade_consumidora: '100', rateio_modalidade: 'autoconsumo_local' });
    expect(r).toEqual({ soma: 0, bloqueios: [], avisos: [] });
  });
});

describe('rateio: avisos', () => {
  it('soma 80 avisa: a sobra fica na geradora em algumas distribuidoras', () => {
    const r = rateio({ geradora_pct: '30', benef_1_uc: '200', benef_1_pct: '50', rateio_modalidade: 'multiplas_ucs' });
    expect(r.soma).toBe(80);
    expect(r.bloqueios).toEqual([]);
    expect(r.avisos.join(' ')).toContain('Em algumas distribuidoras a sobra fica na geradora. Confira com a distribuidora.');
    expect(r.avisos).toContain('A alteração do rateio vale a partir do ciclo de faturamento seguinte.');
  });
  it('autoconsumo remoto: documento diferente do titular da geradora avisa; igual não', () => {
    const base = { unidade_consumidora: '100', geradora_pct: '50', benef_1_uc: '200', benef_1_pct: '50', rateio_modalidade: 'autoconsumo_remoto', cpf_cnpj: CPF_A };
    expect(temTexto(rateio({ ...base, benef_1_doc: CPF_B }).avisos, /documento diferente do titular/)).toBe(true);
    expect(temTexto(rateio({ ...base, benef_1_doc: CPF_A }).avisos, /documento|CPF ou CNPJ/)).toBe(false);
    expect(temTexto(rateio({ ...base, benef_1_doc: '52998224725' }).avisos, /documento diferente/)).toBe(false);   // sem pontuação, é o mesmo
  });
  it('autoconsumo remoto: documento vazio avisa; o titular da UC vale mais que o comprador; matriz e filial passam', () => {
    const base = { geradora_pct: '50', benef_1_uc: '200', benef_1_pct: '50', rateio_modalidade: 'autoconsumo_remoto', cpf_cnpj: CPF_A };
    expect(temTexto(rateio(base).avisos, /Falta o CPF ou CNPJ da beneficiária 1/)).toBe(true);
    // com titular da UC, a comparação é com ele (o comprador não conta)
    expect(temTexto(rateio({ ...base, tuc_cpf_cnpj: CPF_B, benef_1_doc: CPF_A }).avisos, /documento diferente/)).toBe(true);
    expect(temTexto(rateio({ ...base, tuc_cpf_cnpj: CPF_B, benef_1_doc: CPF_B }).avisos, /documento diferente/)).toBe(false);
    expect(temTexto(rateio({ ...base, cpf_cnpj: CNPJ_MATRIZ, benef_1_doc: CNPJ_FILIAL }).avisos, /documento diferente/)).toBe(false);
    // sem documento nem do titular nem do comprador, avisa uma vez em vez de comparar com nada
    const sem = rateio({ geradora_pct: '50', benef_1_uc: '200', benef_1_pct: '50', rateio_modalidade: 'autoconsumo_remoto', benef_1_doc: CPF_B });
    expect(temTexto(sem.avisos, /Falta o documento do titular da unidade geradora/)).toBe(true);
  });
  it('geração compartilhada não exige o mesmo titular', () => {
    const r = rateio({ geradora_pct: '50', benef_1_uc: '200', benef_1_pct: '50', rateio_modalidade: 'geracao_compartilhada', cpf_cnpj: CPF_A, benef_1_doc: CPF_B });
    expect(temTexto(r.avisos, /documento/)).toBe(false);
  });
  it('beneficiárias sem modalidade escolhida avisam', () => {
    const r = rateio({ geradora_pct: '50', benef_1_uc: '200', benef_1_pct: '50' });
    expect(temTexto(r.avisos, /Escolha a modalidade do rateio/)).toBe(true);
  });
});

describe('consumo da conta contra a geração da proposta', () => {
  const v: Valores = { consumo_medio_kwh: '1000' };
  it('dentro da faixa (90% a 130%) não avisa', () => {
    for (const geracao of [900, 1000, 1300]) {
      const c = analisarConsumo(v, { mediaMensalGerada: geracao });
      expect(c.aviso, String(geracao)).toBeNull();
      expect(c).toMatchObject({ base: 'proposta_media_gerada', proposta_kwh: geracao, conta_kwh: 1000, contas_kwh: [{ unidade: 'geradora', kwh: 1000 }] });
    }
  });
  it('80% avisa com a frase do contrato', () => {
    const c = analisarConsumo(v, { mediaMensalGerada: 800 });
    expect(c.aviso).toBe('O sistema da proposta gera 800 kWh/mês e a conta mostra 1.000 kWh/mês de consumo. Confira o dimensionamento.');
  });
  it('140% avisa', () => {
    expect(analisarConsumo(v, { mediaMensalGerada: 1400 }).aviso).toMatch(/gera 1\.400 kWh\/mês e a conta mostra 1\.000 kWh\/mês/);
  });
  it('sem proposta ligada: sem comparação e sem aviso', () => {
    const c = analisarConsumo(v, null);
    expect(c).toMatchObject({ base: null, proposta_kwh: null, aviso: null, conta_kwh: 1000 });
    expect(c.razao).toMatch(/proposta ligada/);
  });
  it('proposta sem geração, ou conta sem consumo: sem comparação e sem aviso', () => {
    expect(analisarConsumo(v, {})).toMatchObject({ base: null, aviso: null });
    expect(analisarConsumo({}, { mediaMensalGerada: 800 })).toMatchObject({ base: 'proposta_media_gerada', conta_kwh: null, contas_kwh: [], aviso: null });
  });
  // Formato real do gerador: `mensalKwh` é um array de 12 gerações mensais; `consumoKwh` é o consumo informado.
  const DOZE = [900, 1000, 1100, 1000, 900, 800, 800, 900, 1000, 1100, 1200, 1300];   // soma 12.000, média 1.000
  it('ordem da geração: mediaMensalGerada, depois a média do array mensalKwh, depois geracaoAnualKwh / 12', () => {
    expect(analisarConsumo(v, { mediaMensalGerada: 1000, mensalKwh: [100, ...DOZE.slice(1)], geracaoAnualKwh: 6000, consumoKwh: 400 }))
      .toMatchObject({ base: 'proposta_media_gerada', proposta_kwh: 1000, proposta_consumo_kwh: 400, aviso: null });
    expect(analisarConsumo(v, { mediaMensalGerada: null, mensalKwh: DOZE, geracaoAnualKwh: 6000, consumoKwh: '400' }))
      .toMatchObject({ base: 'proposta_mensal_12', proposta_kwh: 1000, proposta_consumo_kwh: 400, aviso: null });
    expect(analisarConsumo(v, { mensalKwh: JSON.stringify(DOZE) })).toMatchObject({ base: 'proposta_mensal_12', proposta_kwh: 1000 });   // o banco pode devolver o JSON em texto
    expect(analisarConsumo(v, { mensalKwh: null, geracaoAnualKwh: '12000', consumoKwh: 400 }))
      .toMatchObject({ base: 'proposta_anual_12', proposta_kwh: 1000, proposta_consumo_kwh: 400, aviso: null });
    expect(analisarConsumo(v, { mediaMensalGerada: 0, geracaoAnualKwh: 9600 })).toMatchObject({ base: 'proposta_anual_12', proposta_kwh: 800 });   // 0 não vale como geração
    expect(analisarConsumo(v, { geracaoAnualKwh: 9600 }).aviso).toMatch(/gera 800 kWh\/mês/);
  });
  it('array que não tem 12 números válidos não vira média (cai para a geração anual, ou sem comparação)', () => {
    for (const torto of [[1000], DOZE.slice(0, 11), [...DOZE.slice(0, 11), 'x'], [...DOZE.slice(0, 11), -5], new Array(12).fill(0), 1000, 'abc', {}]) {
      expect(analisarConsumo(v, { mensalKwh: torto }), JSON.stringify(torto)).toMatchObject({ base: null, aviso: null });
    }
    expect(analisarConsumo(v, { mensalKwh: [1], geracaoAnualKwh: 12000 })).toMatchObject({ base: 'proposta_anual_12', proposta_kwh: 1000 });
  });
  it('o consumo da proposta (consumoKwh) nunca é geração: sem os dados de geração não há comparação, mas ele sai à parte', () => {
    const c = analisarConsumo(v, { consumoKwh: 1000 });
    expect(c).toMatchObject({ base: null, proposta_kwh: null, proposta_consumo_kwh: 1000, aviso: null, conta_kwh: 1000 });
    expect(analisarConsumo(v, {})).toMatchObject({ base: null, proposta_consumo_kwh: null, aviso: null });
    expect(analisarConsumo(v, null)).toMatchObject({ base: null, proposta_consumo_kwh: null });
  });
  it('89% e 131% avisam; 90% e 130% não', () => {
    expect(analisarConsumo(v, { mediaMensalGerada: 890 }).aviso).toMatch(/gera 890 kWh\/mês/);
    expect(analisarConsumo(v, { mediaMensalGerada: 1310 }).aviso).toMatch(/gera 1\.310 kWh\/mês/);
    expect(analisarConsumo(v, { mediaMensalGerada: 900 }).aviso).toBeNull();
    expect(analisarConsumo(v, { mediaMensalGerada: 1300 }).aviso).toBeNull();
  });
  it('diz que o consumo das beneficiárias não entra, quando há beneficiárias', () => {
    const c = analisarConsumo({ ...v, benef_1_uc: '200', benef_1_pct: '50' }, { mediaMensalGerada: 1000 });
    expect(c.razao).toMatch(/consumo das beneficiárias/);
    expect(c.contas_kwh).toHaveLength(1);
  });
  it('lê o número do jeito que o banco entrega', () => {
    expect(paraNumero('1234.5')).toBe(1234.5);
    expect(paraNumero('1.234,5')).toBe(1234.5);
    expect(paraNumero(' 800 kWh')).toBe(800);
    expect(paraNumero(null)).toBeNull();
    expect(paraNumero('abc')).toBeNull();
    expect(paraNumero(-3)).toBeNull();
  });
});

describe('analisarSolar junta as duas', () => {
  it('devolve rateio e consumo', () => {
    const a = analisarSolar({ consumo_medio_kwh: '1000', geradora_pct: '100' }, { mensalKwh: new Array(12).fill(1000), consumoKwh: 950 });
    expect(Object.keys(a).sort()).toEqual(['consumo', 'rateio']);
    expect(a.rateio.soma).toBe(100);
    expect(a.consumo).toMatchObject({ base: 'proposta_mensal_12', proposta_kwh: 1000, proposta_consumo_kwh: 950 });
  });
});
