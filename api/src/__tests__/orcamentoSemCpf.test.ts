import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';
import { CPF_OCULTO, documentoVazio } from '../utils/documentoBr';
import { cenariosModerno } from './fixtures/propostaModernoDados';
import { empresaOffGrid, clienteOffGrid, dadosOffGrid } from './fixtures/offgridDados';

// Orçamento sem CPF real (pedido dos integradores): cliente sem documento sai com XXX.XXX.XXX-XX. CPF de 11 dígitos
// segue formatado como sempre; CNPJ e número pela metade não mudam.
const XXX = 'XXX.XXX.XXX-XX';
const CPF_FMT = '529.982.247-25';
const maria = cenariosModerno.find((x) => x.nome === 'completa-bateria')!;
const grande = cenariosModerno.find((x) => x.nome === 'grande')!;
const semAssinatura = (campos: Record<string, unknown>) => { const { assinatura: _a, ...resto } = campos; return resto; };
const ocorrencias = (h: string, t: string) => h.split(t).length - 1;

const moderno = (cpf: string | undefined, modelo: 2 | 3, comAssinatura = false) => {
  const campos = comAssinatura ? { ...maria.campos } : semAssinatura(maria.campos);
  return generateFromTemplate('propostaSolar', maria.empresa, { ...maria.cliente, cpf_cnpj: cpf }, campos, modelo);
};
const modelo1 = (cpf: string | undefined) =>
  generateFromTemplate('propostaSolar', maria.empresa, { ...maria.cliente, cpf_cnpj: cpf }, semAssinatura(maria.campos), 1);

const base: Record<string, unknown> = { ...dadosOffGrid, emitido_em: '2026-11-09T15:00:00.000Z', codigo: '20260031', endereco: 'Estrada do Pequi, km 8' };
const assinaturaValida = {
  empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio administrador' },
  cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
};
const offGrid = (cpf: string | undefined, assinatura?: unknown) =>
  generateFromTemplate('propostaOffGrid', empresaOffGrid, { ...clienteOffGrid, cpf_cnpj: cpf }, { ...base, ...(assinatura ? { assinatura } : {}) }, 2);

describe('documentoVazio', () => {
  it('só vazio, nulo, espaços e máscara sem dígito contam como vazio', () => {
    for (const v of ['', '   ', '...-', '__.___.___-__', null, undefined]) expect(documentoVazio(v)).toBe(true);
    for (const v of ['5', '529.982.247-25', '11.222.333/0001-81', '123']) expect(documentoVazio(v)).toBe(false);
  });
});

describe('Moderno (2 e 3) com cliente sem CPF', () => {
  for (const m of [2, 3] as const) {
    for (const vazio of ['', '   ', '...-', undefined]) {
      it(`modelo ${m}, documento ${JSON.stringify(vazio)}: linha do resumo e assinatura com ${XXX}`, () => {
        const h = moderno(vazio, m);
        expect(h).toContain(`<tr><td>CPF</td><td>${XXX}</td></tr>`);
        expect(h).toContain(`<span class="num">CPF ${XXX}</span>`);
        expect(ocorrencias(h, XXX)).toBe(2);
      });
    }
    it(`modelo ${m}: CPF válido sai formatado e sem ${XXX}`, () => {
      const h = moderno('52998224725', m);
      expect(h).toContain(`<tr><td>CPF</td><td>${CPF_FMT}</td></tr>`);
      expect(h).toContain(`CPF ${CPF_FMT}`);
      expect(h).not.toContain(XXX);
    });
    it(`modelo ${m}: com assinatura preenchida vale o documento da assinatura`, () => {
      const h = moderno('', m, true);
      expect(h).toContain(`CPF ${CPF_FMT}`);
      expect(h).not.toContain(XXX);
    });
  }
  it('CNPJ e número pela metade não mudam: sem XXX e sem linha de CPF inventada', () => {
    const cnpj = generateFromTemplate('propostaSolar', grande.empresa, grande.cliente, semAssinatura(grande.campos), 2);
    expect(cnpj).toContain('CNPJ 11.222.333/0001-81');
    expect(cnpj).not.toContain(XXX);
    const metade = moderno('12345', 2);
    expect(metade).not.toContain(XXX);
    expect(metade).not.toContain('<tr><td>CPF</td>');
  });
});

// 1 Página e Off-grid não imprimem o CPF do cadastro (só o do aceite, que é validado): sem CPF não há o que esconder,
// então não ganham a linha XXX. Se ganhassem, o cliente SEM CPF teria uma linha que o cliente COM CPF não tem.
describe('1 Página (modelo 1) e Off-grid sem aceite: seguem sem linha de CPF', () => {
  it('documento vazio ou preenchido: nenhum XXX', () => {
    for (const doc of ['', '  ', undefined, '52998224725']) {
      expect(modelo1(doc)).not.toContain(XXX);
      expect(offGrid(doc)).not.toContain(XXX);
    }
  });
  it('off-grid com aceite válido: CPF formatado, sem XXX', () => {
    const h = offGrid('', assinaturaValida);
    expect(h).toContain(`CPF ${CPF_FMT}`);
    expect(h).not.toContain(XXX);
  });
});

describe('CPF_OCULTO', () => {
  it('é o texto combinado com os integradores', () => { expect(CPF_OCULTO).toBe(XXX); });
});

describe('Moderno: empresa (PJ) sem CNPJ', () => {
  it('não vira CPF XXX, com ou sem assinatura PJ vazia', () => {
    for (const m of [2, 3] as const) {
      const pj = { ...maria.cliente, tipo: 'PJ', cpf_cnpj: '' };
      expect(generateFromTemplate('propostaSolar', maria.empresa, pj, semAssinatura(maria.campos), m)).not.toContain(XXX);
      const assinPj = { ...maria.campos, assinatura: { ...(maria.campos.assinatura as Record<string, unknown>), cliente: { tipo: 'PJ', nome: 'Empresa X', documento: '' } } };
      expect(generateFromTemplate('propostaSolar', maria.empresa, { ...maria.cliente, cpf_cnpj: '' }, assinPj, m)).not.toContain(XXX);
    }
  });
});
