import { describe, it, expect } from 'vitest';
import { normalizeExtraction, RawExtraction } from '../controllers/contaScanController';

const PADROES = ['Monofásico', 'Bifásico', 'Trifásico'];

// Guard do risco nº1 do Escanear Conta: o padrão de energia lido pela IA PRECISA
// virar exatamente um dos enums do clientsController/ClientModal (ou vazio), senão
// o <select> renderiza em branco e o zod do backend dá 400 no salvar.
describe('normalizeExtraction — padrão de energia (enum)', () => {
  const casos: Array<[string | undefined, string]> = [
    ['Trifásico', 'Trifásico'],
    ['trifasico', 'Trifásico'],
    ['TRIFÁSICO', 'Trifásico'],
    ['Trifásica', 'Trifásico'],   // variação de gênero comum
    ['tri', 'Trifásico'],         // abreviação
    ['monofasico', 'Monofásico'],
    ['Bifásico', 'Bifásico'],
    ['quadrifásico', ''],         // inexistente → vazio (não quebra select/zod)
    [undefined, ''],
  ];
  it.each(casos)('padrao "%s" → "%s"', (entrada, esperado) => {
    const { cliente } = normalizeExtraction({ padrao: entrada } as RawExtraction);
    expect(cliente.padrao).toBe(esperado);
    expect(cliente.padrao === '' || PADROES.includes(cliente.padrao)).toBe(true);
  });
});

describe('normalizeExtraction — tipo e formatação', () => {
  it('mapeia tipo PJ e cai em PF por padrão', () => {
    expect(normalizeExtraction({ tipo: 'PJ' } as RawExtraction).cliente.tipo).toBe('PJ');
    expect(normalizeExtraction({ tipo: 'pessoa fisica' } as RawExtraction).cliente.tipo).toBe('PF');
    expect(normalizeExtraction({} as RawExtraction).cliente.tipo).toBe('PF');
  });

  it('formata CPF, CEP e telefone pra exibição', () => {
    const { cliente } = normalizeExtraction({
      tipo: 'PF', cpf_cnpj: '12345678909', cep: '38400000', telefone: '34991360223',
    } as RawExtraction);
    expect(cliente.cpf_cnpj).toBe('123.456.789-09');
    expect(cliente.cep).toBe('38400-000');
    expect(cliente.telefone).toBe('(34) 99136-0223');
  });

  it('formata CNPJ quando tipo PJ', () => {
    const { cliente } = normalizeExtraction({ tipo: 'PJ', cpf_cnpj: '11222333000181' } as RawExtraction);
    expect(cliente.cpf_cnpj).toBe('11.222.333/0001-81');
  });

  it('descarta documento incompleto/inválido em vez de vazar lixo', () => {
    expect(normalizeExtraction({ tipo: 'PF', cpf_cnpj: '123' } as RawExtraction).cliente.cpf_cnpj).toBe('');
    expect(normalizeExtraction({ cep: '38x' } as RawExtraction).cliente.cep).toBe('');
  });

  it('nunca vaza CPF mascarado', () => {
    const { cliente, detectado } = normalizeExtraction({
      tipo: 'PF', cpf_cnpj: '***.456.789-**', cpf_mascarado: true,
    } as RawExtraction);
    expect(cliente.cpf_cnpj).toBe('');
    expect(detectado.cpf_mascarado).toBe(true);
  });

  it('UF vira 2 letras maiúsculas', () => {
    expect(normalizeExtraction({ uf: 'mg' } as RawExtraction).cliente.uf).toBe('MG');
    expect(normalizeExtraction({ uf: 'Minas Gerais' } as RawExtraction).cliente.uf).toBe('MI');
  });
});

describe('normalizeExtraction — consumo detectado', () => {
  it('usa a média do histórico quando não há consumo médio explícito', () => {
    const { detectado } = normalizeExtraction({ historico_kwh: [500, 400, 600] } as RawExtraction);
    expect(detectado.consumo_medio_kwh).toBe(500);
    expect(detectado.historico_kwh).toEqual([500, 400, 600]);
  });

  it('prioriza o consumo médio explícito e ignora valores inválidos', () => {
    const { detectado } = normalizeExtraction({ consumo_medio_kwh: 452, historico_kwh: [0, -3, 'x'] as never } as RawExtraction);
    expect(detectado.consumo_medio_kwh).toBe(452);
    expect(detectado.historico_kwh).toEqual([]);
  });
});
