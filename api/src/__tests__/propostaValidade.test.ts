import { describe, it, expect } from 'vitest';
import { generateFromTemplate, type Client } from '../services/templateService';

const company = { nome: 'Solar Teste', cor_marca: '#B45309', whatsapp: '34991360223' } as never;
const client = { nome: 'João da Silva', cidade: 'Uberlândia', uf: 'MG' } as unknown as Client;
const base = {
  cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '450', qtd_modulos: '10',
  potencia_modulo: '620', marca_modulo: 'Canadian', qtd_inversores: '1',
  marca_inversor: 'Growatt', potencia_inversor: '5', investimento: '22.000,00',
};

function render(modelo: 1 | 2, f: Record<string, unknown>) {
  return generateFromTemplate('propostaSolar', company, client, { ...base, ...f }, modelo);
}

describe('validade da proposta solar', () => {
  it('1 Pagina: padrao 7 dias quando o campo nao vem', () => {
    expect(render(1, {})).toMatch(/VÁLIDO POR 7 DIAS · ATÉ \d{2}\/\d{2}\/\d{4}/);
  });

  it('1 Pagina: respeita o valor editado e o singular', () => {
    expect(render(1, { validade_dias: '15' })).toContain('VÁLIDO POR 15 DIAS');
    expect(render(1, { validade_dias: '1' })).toContain('VÁLIDO POR 1 DIA ·');
  });

  it('1 Pagina: vazio ou zero cai no padrao 7', () => {
    expect(render(1, { validade_dias: '' })).toContain('VÁLIDO POR 7 DIAS');
    expect(render(1, { validade_dias: '0' })).toContain('VÁLIDO POR 7 DIAS');
  });

  it('Moderno: mostra a validade no cabecalho', () => {
    expect(render(2, { validade_dias: '10' })).toMatch(/Válido por 10 dias · até \d{2} de \w+ de \d{4}/);
  });

  it('numero absurdo nao vira "Invalid Date" no PDF', () => {
    const html = render(1, { validade_dias: '99999999999999' });
    expect(html).toContain('VÁLIDO POR 99999999999999 DIAS');
    expect(html).not.toMatch(/INVALID DATE/i);
  });

  it('a data limite e hoje + N dias', () => {
    const esperado = new Date(Date.now() + 30 * 86400000)
      .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    expect(render(1, { validade_dias: '30' })).toContain(`ATÉ ${esperado}`);
  });
});
