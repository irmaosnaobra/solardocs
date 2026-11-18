import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';

// Endereço completo do cliente na proposta (28/10/2026). O formulário compõe o texto;
// o template só imprime, e só quando existe. Campo vazio some: nunca "___".

const company: any = {
  nome: 'CMO ENERGIA SOLAR LTDA', nome_fantasia: 'CMO ENERGIA SOLAR', cnpj: '12345678000190',
  endereco: 'AVENIDA ALCEBÍADES BERNARDO, 738', socio_adm: 'Jair', whatsapp: '5517996803659',
};
const client: any = { nome: 'Fulano de Tal', cidade: 'Uberlândia', uf: 'MG' };
const base: Record<string, unknown> = {
  cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '450', qtd_modulos: '10',
  potencia_modulo: '620', marca_modulo: 'Canadian', qtd_inversores: '1',
  marca_inversor: 'Growatt', potencia_inversor: '5', investimento: '22000',
};
const ENDERECO = 'Rua das Palmeiras, 1200, Apto 31, Jardim América, Uberlândia - MG, CEP 38400-100';

const render = (f: Record<string, unknown>, modelo: 1 | 2 | 3 = 1, cli: any = client) =>
  generateFromTemplate('propostaSolar', company, cli, { ...base, ...f }, modelo);

describe('endereço do cliente na proposta solar', () => {
  it('modelo 1: imprime a linha Endereço na ficha quando há endereço', () => {
    const h = render({ endereco: ENDERECO }, 1);
    expect(h).toContain('<div class="rowf end"><span>Endereço</span><span>' + ENDERECO + '</span>');
  });

  it('modelo 1: sem endereço não existe a linha', () => {
    const h = render({}, 1);
    expect(h).not.toContain('<div class="rowf end"><span>Endereço</span>');
    expect(h).not.toContain('___');
  });

  it('modelo 2: imprime o endereço na ficha técnica, com o rótulo Endereço', () => {
    const h = render({ endereco: ENDERECO }, 2);
    expect(h).toContain('<div class="k">Endereço da instalação</div><div class="v">Rua das Palmeiras, 1200');
    expect(h).not.toContain('class="page capa"');
  });

  it('modelo 2: sem endereço o rótulo não aparece, nem "___"', () => {
    const h = render({}, 2);
    expect(h).not.toContain('Endereço da instalação');
    expect(h).not.toContain('___');
  });

  it('modelo 2: espaços em branco contam como vazio', () => {
    expect(render({ endereco: '   ' }, 2)).not.toContain('Endereço da instalação');
  });

  it('modelo 3: imprime o endereço na capa e na ficha técnica', () => {
    const h = render({ endereco: ENDERECO }, 3);
    expect(h).toContain('<div class="loc">' + ENDERECO + '</div>');
    expect(h).toContain('Endereço da instalação');
  });

  it('modelo 3: sem endereço a capa não ganha a linha', () => {
    const h = render({}, 3);
    expect(h).toContain('class="page capa"');
    expect(h).not.toContain('Endereço da instalação');
  });

  it('cai no endereço do cadastro quando o form não manda', () => {
    const h = render({}, 2, { ...client, endereco: 'Rua do Cadastro, 5' });
    expect(h).toContain('Rua do Cadastro, 5');
  });

  it('escapa HTML do endereço digitado', () => {
    const h = render({ endereco: 'Rua <b>X</b> & Cia' }, 2);
    expect(h).toContain('Rua &lt;b&gt;X&lt;/b&gt; &amp; Cia');
    expect(h).not.toContain('Rua <b>X</b>');
  });
});
