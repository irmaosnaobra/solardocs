import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';

// Texto de garantia de 11/2026 do contratoSolarM2 (cláusulas 4, 8 e 13). Só o contrato com
// versao_garantia >= 2 usa o texto novo. Sem a marca, o texto de antes sai palavra por palavra.

const empresa = {
  id: 'c1', nome: 'Sol Forte Energia LTDA', cnpj: '11.222.333/0001-44', cidade: 'Campinas', uf: 'SP',
  endereco: 'Rua das Palmeiras, 100', telefone: '(19) 99999-0000',
} as never;
const clientePF = { id: 'k1', nome: 'Maria Souza', cpf_cnpj: '123.456.789-09', cidade: 'Campinas', uf: 'SP', endereco: 'Rua A, 1', tipo: 'PF' } as never;
const clientePJ = { id: 'k2', nome: 'Padaria Doce Ltda', cpf_cnpj: '11.111.111/0001-11', cidade: 'Campinas', uf: 'SP', endereco: 'Rua B, 2', tipo: 'PJ' } as never;

const base: Record<string, unknown> = {
  valor_total: '25.000,00',
  garantia_modulos_anos: '15',
  garantia_inversor_anos: '10',
  garantia_instalacao_anos: '1',
  garantia_instalacao_unidade: 'anos',
  garantia_resposta_dias: '2',
  foro_cidade: 'Campinas',
};

const gera = (c: unknown, f: Record<string, unknown>) =>
  generateFromTemplate('contratoSolar', empresa, c as never, f, 2) as string;

describe('contratoSolarM2: texto de garantia', () => {
  it('contrato novo (versao_garantia 2) sai com o texto novo', () => {
    const h = gera(clientePF, { ...base, versao_garantia: 2 });
    expect(h).toContain('Os equipamentos têm a garantia do fabricante: 15 (quinze) anos para os módulos e 10 (dez) anos para o inversor.');
    expect(h).toContain('A CONTRATADA garante a instalação por 1 (um) ano, a contar da entrega do sistema');
    expect(h).toContain('responde em até 2 (dois) dias úteis do pedido');
    expect(h).toContain('por mensagem ao telefone (19) 99999-0000 ou por e-mail');
    expect(h).toContain('multa de 5% (cinco por cento)');
    expect(h).not.toContain('constatados por laudo técnico');
    expect(h).not.toContain('até 10%');
    expect(h).not.toContain('perda das garantias');
  });

  it('padrões: instalação vazia vira 1 ano e resposta vazia vira 2 dias úteis', () => {
    const h = gera(clientePF, { ...base, versao_garantia: 2, garantia_instalacao_anos: '', garantia_resposta_dias: '' });
    expect(h).toContain('garante a instalação por 1 (um) ano');
    expect(h).toContain('responde em até 2 (dois) dias úteis');
  });

  it('instalação zero ou negativa cai no padrão de 1 ano, como o campo vazio', () => {
    for (const v of ['0', '-2', '  0 ', 'abc']) {
      const h = gera(clientePF, { ...base, versao_garantia: 2, garantia_instalacao_anos: v });
      expect(h).toContain('garante a instalação por 1 (um) ano');
    }
  });

  it('singular e outros valores', () => {
    const h = gera(clientePF, { ...base, versao_garantia: 2, garantia_resposta_dias: '1', garantia_instalacao_anos: '6', garantia_instalacao_unidade: 'meses' });
    expect(h).toContain('responde em até 1 (um) dia útil do pedido');
    expect(h).toContain('garante a instalação por 6 (seis) meses');
  });

  it('bateria entra na lista de equipamentos; sem telefone da empresa o canal fica genérico', () => {
    const semTel = { ...(empresa as object), telefone: '' } as never;
    const h = generateFromTemplate('contratoSolar', semTel, clientePF, {
      ...base, versao_garantia: 2, bateria_marca: 'WEG', bateria_qtd: '1', bateria_garantia_anos: '10',
    }, 2) as string;
    expect(h).toContain('por mensagem ou e-mail, com a descrição');
    expect(h).not.toContain('por mensagem ao telefone');
    expect(h).toContain('10 (dez) anos para o inversor e 10 (dez) anos para a bateria');
  });

  it('pessoa física tem o conserto por orçamento em negrito; empresa não', () => {
    const pf = gera(clientePF, { ...base, versao_garantia: 2 });
    const pj = gera(clientePJ, { ...base, versao_garantia: 2 });
    expect(pf).toContain('<b><span class="rot">Conserto por orçamento:</span>');
    expect(pj).not.toContain('<b><span class="rot">Conserto por orçamento:</span>');
    expect(pj).toContain('<span class="rot">Conserto por orçamento:</span>');
    expect(pj).toContain('As garantias dos equipamentos são só dos fabricantes.');
    expect(pf).toContain('Essas garantias se somam à garantia que a lei dá.');
  });

  it('o texto novo não leva travessão, meia-risca nem nome de empresa fixo', () => {
    const h = gera(clientePF, { ...base, versao_garantia: 2 });
    const ini = h.indexOf('Garantias e manutenção');
    const trecho = h.slice(ini, h.indexOf('Multa por interrupção'));
    expect(trecho).not.toMatch(/[–—]/);
    expect(h).not.toMatch(/Irm[ãa]os na Obra|AIOROS/i);
  });

  it('contrato antigo (sem a marca) mantém o texto de antes, inteiro', () => {
    const h = gera(clientePF, { ...base });
    expect(h).toContain('Equipamentos: As garantias dos equipamentos são exclusivamente do fabricante, cobrindo 15 (quinze) anos para módulos fotovoltaicos, 10 (dez) anos para o inversor, e prazos específicos para demais componentes conforme manual do fabricante.');
    expect(h).toContain('A garantia de instalação é de 1 (um) ano, válida somente para defeitos de instalação devidamente constatados por laudo técnico.');
    expect(h).toContain('Exclusões de Garantia:');
    expect(h).toContain('A geração de energia pode variar até 10% devido a condições climáticas e características do local.');
    expect(h).toContain('multa de 5% do valor total do contrato, além da perda das garantias aplicáveis.');
    expect(h).not.toContain('Conserto por orçamento');
  });

  it('versao_garantia 1 também fica no texto antigo', () => {
    const h = gera(clientePF, { ...base, versao_garantia: 1 });
    expect(h).toContain('além da perda das garantias aplicáveis');
    expect(h).not.toContain('Conserto por orçamento');
  });

  it('sem variável crua no HTML', () => {
    const h = gera(clientePF, { ...base, versao_garantia: 2 });
    // {{LOGO}} é o marcador de sempre: o front troca pela logo da empresa na hora de abrir.
    expect(h.replace(/\{\{LOGO\}\}/g, '')).not.toMatch(/\{\{[^}]*\}\}/);
    expect(h).not.toContain('undefined');
  });
});
