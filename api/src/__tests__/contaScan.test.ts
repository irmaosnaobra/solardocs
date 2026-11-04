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

// Tarifa e iluminação alimentam a proposta (preço do kWh + taxa mínima). Precisam
// preservar o decimal — se arredondassem, uma tarifa 0,78 viraria 1 e detonaria o cálculo.
describe('normalizeExtraction — tarifa e iluminação pública', () => {
  it('preserva a tarifa decimal (não arredonda)', () => {
    const { detectado } = normalizeExtraction({ tarifa_kwh: 0.78, iluminacao_publica: 12.5 } as RawExtraction);
    expect(detectado.tarifa_kwh).toBe(0.78);
    expect(detectado.iluminacao_publica).toBe(12.5);
  });
  it('aceita string com vírgula', () => {
    const { detectado } = normalizeExtraction({ tarifa_kwh: '0,845' } as RawExtraction);
    expect(detectado.tarifa_kwh).toBeCloseTo(0.845);
  });
  it('ausente ou zero vira null', () => {
    const { detectado } = normalizeExtraction({} as RawExtraction);
    expect(detectado.tarifa_kwh).toBeNull();
    expect(detectado.iluminacao_publica).toBeNull();
  });
});

describe('normalizeExtraction — endereço em partes', () => {
  const ler = (raw: RawExtraction) => normalizeExtraction(raw).cliente;

  it('partes separadas viram as 4 partes e a linha completa', () => {
    const c = ler({ logradouro: 'Rua das Flores', numero: '123', complemento: 'Apto 4', bairro: 'Centro' });
    expect(c.logradouro).toBe('Rua das Flores');
    expect(c.numero).toBe('123');
    expect(c.complemento).toBe('Apto 4');
    expect(c.bairro).toBe('Centro');
    expect(c.endereco).toBe('Rua das Flores, 123, Apto 4, Centro');
  });

  it('sem complemento e sem número não deixa vírgula sobrando', () => {
    expect(ler({ logradouro: 'Rua A', numero: '10', bairro: 'Centro' }).endereco).toBe('Rua A, 10, Centro');
    expect(ler({ logradouro: 'Rua A', bairro: 'Centro' }).endereco).toBe('Rua A, Centro');
  });

  it('S/N fica como veio', () => {
    const c = ler({ logradouro: 'Fazenda Boa Vista', numero: 'S/N', bairro: 'Zona Rural' });
    expect(c.numero).toBe('S/N');
    expect(c.endereco).toBe('Fazenda Boa Vista, S/N, Zona Rural');
  });

  it('mantém a caixa do texto como vier', () => {
    expect(ler({ logradouro: 'RUA DAS FLORES', numero: '5', bairro: 'centro' }).endereco).toBe('RUA DAS FLORES, 5, centro');
  });

  it('formato antigo (só endereco) vira o logradouro', () => {
    const c = ler({ endereco: 'Rua X, 123, Bairro Y' });
    expect(c.logradouro).toBe('Rua X, 123, Bairro Y');
    expect(c.numero).toBe('');
    expect(c.endereco).toBe('Rua X, 123, Bairro Y');
  });

  it('endereco antigo é ignorado quando alguma parte vem', () => {
    const c = ler({ endereco: 'Velho, 1', logradouro: 'Rua Nova' });
    expect(c.logradouro).toBe('Rua Nova');
    expect(c.endereco).toBe('Rua Nova');
  });

  it('vazios e valores que não são texto não quebram', () => {
    const c = ler({ logradouro: 42, numero: null, complemento: {}, bairro: '  ' } as unknown as RawExtraction);
    expect(c.logradouro).toBe('');
    expect(c.numero).toBe('');
    expect(c.complemento).toBe('');
    expect(c.bairro).toBe('');
    expect(c.endereco).toBe('');
    expect(ler({}).endereco).toBe('');
  });
});
