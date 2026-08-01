import { describe, it, expect } from 'vitest';
import { formatarCidadeUf, montarMensagem, type LinhaAgenda } from '../services/agenda/agendaProximaDigest';

// Cidade é texto livre digitado pelo lead. Os casos abaixo saíram da tabela
// `agendamentos` de verdade (30/07/2026) — se a cascata quebrar, quebra aqui.
describe('formatarCidadeUf', () => {
  it('usa a UF escrita pelo lead e tira ela do nome da cidade', () => {
    expect(formatarCidadeUf('Petrolina-PE', '5511999999999')).toBe('Petrolina PE');
    expect(formatarCidadeUf('São Paulo-SP', '5534999999999')).toBe('São Paulo SP');
    expect(formatarCidadeUf('Araguari MG', null)).toBe('Araguari MG');
    expect(formatarCidadeUf('Uberlândia/mg', null)).toBe('Uberlândia MG');
    expect(formatarCidadeUf('Bauru-sp', null)).toBe('Bauru SP');
  });

  it('cai na cidade conhecida antes do DDD (o telefone não é o endereço)', () => {
    // Lead de Cariacica/ES com número de São Paulo: continua ES.
    expect(formatarCidadeUf('Cariacica', '5511988887777')).toBe('Cariacica ES');
    expect(formatarCidadeUf('Campos dos Goytacazes', '5534991360172')).toBe('Campos dos Goytacazes RJ');
  });

  it('usa o DDD quando a cidade é desconhecida', () => {
    expect(formatarCidadeUf('Vila Nova do Sul', '5551999998888')).toBe('Vila Nova do Sul RS');
    expect(formatarCidadeUf('Bairro do Meio', '34991360223')).toBe('Bairro do Meio MG');
  });

  it('normaliza a bagunça de digitação sem inventar UF', () => {
    expect(formatarCidadeUf('UberlÂndia', null)).toBe('Uberlândia MG');
    expect(formatarCidadeUf('Patos De Minas', null)).toBe('Patos de Minas MG');
    expect(formatarCidadeUf('Itaporanga S/P', null)).toBe('Itaporanga S/p'); // sem UF válida no fim → não estraga
    expect(formatarCidadeUf(null, '5534991360223')).toBe('');
    expect(formatarCidadeUf('   ', null)).toBe('');
  });
});

describe('montarMensagem', () => {
  const linhas: LinhaAgenda[] = [
    { cliente: 'Hudson Lourenço', cidade: 'Cariacica ES', hora: '13:00', consultor: 'Thiago' },
    { cliente: 'Eliel Júlio Soares da Silva', cidade: 'Petrolina PE', hora: '15:00', consultor: 'Diego' },
    { cliente: 'Helena', cidade: '', hora: '18:05', consultor: 'Thiago' },
  ];

  it('monta uma linha por cliente no formato pedido', () => {
    const msg = montarMensagem({ data: '2026-08-03', rotulo: 'segunda-feira, 03/08', linhas });
    expect(msg).toContain('📅 *Agenda de segunda-feira, 03/08*');
    expect(msg).toContain('3 clientes marcados');
    expect(msg).toContain('Hudson Lourenço - Cariacica ES - 13:00 - Thiago');
    expect(msg).toContain('Eliel Júlio Soares da Silva - Petrolina PE - 15:00 - Diego');
  });

  it('cliente sem cidade não vira "Fulano -  - 18:05"', () => {
    const msg = montarMensagem({ data: '2026-08-03', rotulo: 'segunda-feira, 03/08', linhas });
    expect(msg).toContain('Helena - 18:05 - Thiago');
    expect(msg).not.toContain(' -  - ');
  });

  it('agenda vazia avisa em vez de mandar lista em branco', () => {
    const msg = montarMensagem({ data: null, rotulo: null, linhas: [] });
    expect(msg).toContain('Nenhum cliente marcado');
  });
});
