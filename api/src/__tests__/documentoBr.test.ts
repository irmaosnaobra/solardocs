import { describe, it, expect } from 'vitest';
import {
  cpfValido, cnpjValido, soDigitos, formatarCpf, formatarCnpj, normalizarCnpj, validarAssinatura, normalizarAssinatura,
} from '../utils/documentoBr';
import { normalizarDadosBancarios, dadosBancariosCompletos } from '../utils/dadosBancarios';

const empresa = { razao_social: 'Sol Forte Energia Ltda', cnpj: '11.222.333/0001-81', representante: 'Carlos Pereira', cargo: 'Sócio' };
const pf = { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '529.982.247-25' };
const pj = { tipo: 'PJ', nome: 'Padaria Pão Quente Ltda', documento: '11.222.333/0001-81', representante: 'Ana' };
const com = (o: Record<string, unknown>) => ({ empresa, cliente: pf, ...o });

describe('CPF e CNPJ', () => {
  it('CPF: dígito verificador', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('1234')).toBe(false);
    expect(cpfValido(undefined)).toBe(false);
  });
  it('CNPJ: o mesmo de utils/cnpj', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });
  it('CNPJ alfanumérico (julho de 2026): vale com DV correto; letras minúsculas e pontuação passam; DV errado não', () => {
    expect(cnpjValido('12ABC34501DE35')).toBe(true);
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true);
    expect(cnpjValido('12abc34501de35')).toBe(true);
    expect(cnpjValido('AB12CD34EF5602')).toBe(true);
    expect(cnpjValido('12ABC34501DE36')).toBe(false);
    expect(cnpjValido('12ABC34501DEAB')).toBe(false); // DV tem que ser número
    expect(cnpjValido('12ABC34501D35')).toBe(false); // 13 posições
    expect(cnpjValido('AAAAAAAAAAAAAA')).toBe(false);
    expect(cnpjValido('54.129.446/0001-40')).toBe(true); // os numéricos antigos seguem valendo
    expect(formatarCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(formatarCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(normalizarCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });
  it('assinatura com CNPJ alfanumérico na empresa e no cliente PJ mantém as letras', () => {
    const a = com({ empresa: { ...empresa, cnpj: '12.ABC.345/01DE-35' }, cliente: { ...pj, documento: 'ab12cd34ef5602' } });
    expect(validarAssinatura(a)).toBeNull();
    const n = normalizarAssinatura(a)!;
    expect(n.empresa.cnpj).toBe('12ABC34501DE35');
    expect(n.cliente.documento).toBe('AB12CD34EF5602');
  });
  it('máscaras e dígitos', () => {
    expect(soDigitos('529.982.247-25')).toBe('52998224725');
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
    expect(formatarCpf('123')).toBe('123');
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('validarAssinatura', () => {
  it('tudo certo: null', () => {
    expect(validarAssinatura(com({}))).toBeNull();
    expect(validarAssinatura(com({ cliente: pj }))).toBeNull();
  });
  it('sem objeto: mensagem de preencher', () => {
    expect(validarAssinatura(undefined)).toBe('Para gerar a Completa + Banco, preencha as assinaturas do cliente e da empresa.');
    expect(validarAssinatura({ empresa })).toBe('Para gerar a Completa + Banco, preencha as assinaturas do cliente e da empresa.');
  });
  it('cliente PF', () => {
    expect(validarAssinatura(com({ cliente: { ...pf, nome: 'Maria' } }))).toBe('Escreva o nome completo do cliente.');
    expect(validarAssinatura(com({ cliente: { ...pf, documento: '111.111.111-11' } }))).toBe('CPF do cliente inválido. Confira os números.');
  });
  it('cliente PJ', () => {
    expect(validarAssinatura(com({ cliente: { ...pj, nome: 'AB' } }))).toBe('Escreva a razão social do cliente.');
    expect(validarAssinatura(com({ cliente: { ...pj, documento: '11.222.333/0001-82' } }))).toBe('CNPJ do cliente inválido. Confira os números.');
  });
  it('empresa', () => {
    expect(validarAssinatura(com({ empresa: { ...empresa, razao_social: 'A' } }))).toBe('Escreva a razão social da sua empresa.');
    expect(validarAssinatura(com({ empresa: { ...empresa, cnpj: '123' } }))).toBe('CNPJ da sua empresa inválido. Confira na tela Empresa.');
    expect(validarAssinatura(com({ empresa: { ...empresa, representante: 'C' } }))).toBe('Escreva quem assina pela sua empresa.');
  });
  it('a primeira mensagem de erro vence (cliente antes da empresa)', () => {
    expect(validarAssinatura(com({ cliente: { ...pf, nome: 'Maria' }, empresa: { ...empresa, razao_social: '' } }))).toBe('Escreva o nome completo do cliente.');
  });
  it('normalizar: dígitos, tamanhos máximos e tipo', () => {
    const n = normalizarAssinatura(com({ cliente: { ...pf, nome: 'M'.repeat(300) }, local: 'L'.repeat(200) }))!;
    expect(n.cliente.documento).toBe('52998224725');
    expect(n.empresa.cnpj).toBe('11222333000181');
    expect(n.cliente.nome).toHaveLength(160);
    expect(n.local).toHaveLength(80);
    expect(normalizarAssinatura(com({ cliente: { ...pf, tipo: 'xx' } }))!.cliente.tipo).toBe('PF');
  });
});

describe('dados bancários', () => {
  it('normaliza: apara, limita, descarta vazio e vira null sem nada', () => {
    expect(normalizarDadosBancarios({ banco: '  Banco X  ', agencia: '', conta: 'c'.repeat(50), tipo_conta: 'xx', lixo: 1 }))
      .toEqual({ banco: 'Banco X', conta: 'c'.repeat(20) });
    expect(normalizarDadosBancarios({ tipo_conta: 'poupanca' })).toEqual({ tipo_conta: 'poupanca' });
    expect(normalizarDadosBancarios({ banco: '  ' })).toBeNull();
    expect(normalizarDadosBancarios('x')).toBeNull();
    expect(normalizarDadosBancarios(null)).toBeNull();
  });
  it('só mostra com banco+agência+conta ou com Pix', () => {
    expect(dadosBancariosCompletos({ banco: 'X', agencia: '1', conta: '2' })).toBe(true);
    expect(dadosBancariosCompletos({ banco: 'X', agencia: '1' })).toBe(false);
    expect(dadosBancariosCompletos({ pix: 'a' })).toBe(true);
    expect(dadosBancariosCompletos(null)).toBe(false);
  });
});
