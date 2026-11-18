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

  it('Moderno: mostra a validade no cabecalho, com a data exata (emissão + 10 dias)', () => {
    // Emissão fixa: 18/11/2026 15h UTC (12h em Brasília). Mais 10 dias corridos = 28 de novembro de 2026.
    const h = render(2, { validade_dias: '10', emitido_em: '2026-11-18T15:00:00.000Z' });
    expect(h).toContain('Válida até<b>28 de novembro de 2026</b>');
    expect(h).toContain('Emitida em<b>18 de novembro de 2026</b>');
    expect(h).toContain('Esta proposta vale até 28 de novembro de 2026.');
    // Na virada do mês e do ano também: 25/12 + 10 = 04/01.
    expect(render(2, { validade_dias: '10', emitido_em: '2026-12-25T15:00:00.000Z' })).toContain('Válida até<b>04 de janeiro de 2027</b>');
  });

  it('numero absurdo nao vira "Invalid Date" no PDF', () => {
    const html = render(1, { validade_dias: '99999999999999' });
    expect(html).toContain('VÁLIDO POR 99999999999999 DIAS');
    expect(html).not.toMatch(/INVALID DATE/i);
  });

  // Reeditar uma proposta antiga (/histórico) manda o emitido_em original: o prazo
  // que o cliente já viu não pode renovar sozinho porque alguém corrigiu um typo.
  it('emitido_em ancora a validade na emissao, nao no dia da correcao', () => {
    const emitido = new Date(Date.now() - 3 * 86400000);
    const esperado = new Date(emitido.getTime() + 7 * 86400000)
      .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const html = render(1, { emitido_em: emitido.toISOString(), validade_dias: '7' });
    expect(html).toContain(`ATÉ ${esperado}`);
  });

  it('emitido_em invalido ou vazio cai em hoje', () => {
    const hoje7 = new Date(Date.now() + 7 * 86400000)
      .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    expect(render(1, { emitido_em: 'nada disso', validade_dias: '7' })).toContain(`ATÉ ${hoje7}`);
    expect(render(1, { emitido_em: '', validade_dias: '7' })).toContain(`ATÉ ${hoje7}`);
  });

  it('a data limite e hoje + N dias', () => {
    const esperado = new Date(Date.now() + 30 * 86400000)
      .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    expect(render(1, { validade_dias: '30' })).toContain(`ATÉ ${esperado}`);
  });
});
