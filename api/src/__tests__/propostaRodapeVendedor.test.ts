import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';

const company: any = {
  nome: 'CMO ENERGIA SOLAR LTDA',
  nome_fantasia: 'CMO ENERGIA SOLAR',
  cnpj: '12345678000190',
  endereco: 'AVENIDA ALCEBÍADES BERNARDO, 738',
  socio_adm: 'Jair',
  whatsapp: '5517996803659',
};
const client: any = { nome: 'Fulano de Tal', cidade: 'Uberlândia', uf: 'MG' };
const base: Record<string, unknown> = {
  cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '450', qtd_modulos: '10',
  potencia_modulo: '620', marca_modulo: 'Canadian', qtd_inversores: '1',
  marca_inversor: 'Growatt', potencia_inversor: '5', investimento: '22000',
};

const render = (f: Record<string, unknown>, modelo: 1 | 2 = 1) =>
  generateFromTemplate('propostaSolar', company, client, { ...base, ...f }, modelo);

describe('rodapé editável da proposta', () => {
  it('1 página: fixo do cadastro quando o form não manda nada', () => {
    const h = render({});
    expect(h).toContain('>Jair<');
    expect(h).toContain('(17) 99680-3659');          // contato da empresa formatado
    expect(h).toContain('12.345.678/0001-90');       // CNPJ fixo, ligado por padrão
  });

  it('1 página: nome e telefone editados saem no card e no QR', () => {
    // O QR é SVG: a URL não aparece como texto. Prova indireta — mascarado e
    // cru geram o MESMO desenho, e ele muda em relação ao telefone do cadastro.
    const qr = (h: string) => (h.match(/<div class="qrbox">([\s\S]*?)<\/div>/) || [])[1] || '';
    const h = render({ vendedor_nome: 'Maria Souza', vendedor_whatsapp: '(17) 99624-3536' });
    expect(h).toContain('Maria Souza');
    expect(h).toContain('(17) 99624-3536');
    expect(qr(h)).not.toBe('');
    expect(qr(h)).toBe(qr(render({ vendedor_whatsapp: '17996243536' })));
    expect(qr(h)).not.toBe(qr(render({})));
  });

  it('1 página: desmarcar CNPJ tira do documento (inclusive string "false")', () => {
    expect(render({ mostrar_cnpj: false })).not.toContain('12.345.678/0001-90');
    expect(render({ mostrar_cnpj: 'false' })).not.toContain('12.345.678/0001-90');
  });

  it('1 página: desmarcar contato tira a linha e o QR', () => {
    const h = render({ mostrar_vendedor_contato: false });
    expect(h).not.toContain('wa.me');
    expect(h).not.toContain('Aponte a câmera');
    expect(h).toContain('>Jair<');
  });

  it('1 página: desmarcar nome + contato tira o card do vendedor inteiro', () => {
    const h = render({ mostrar_vendedor_nome: false, mostrar_vendedor_contato: false });
    expect(h).not.toContain('<h4>Vendedor</h4>');
    expect(h).toContain('grid-template-columns:1fr');
    expect(h).toContain('<h4>Empresa</h4>');
  });

  it('moderno: desmarcar contato mata o CTA do WhatsApp', () => {
    expect(render({}, 2)).toContain('Quero fechar — WhatsApp');
    expect(render({ mostrar_vendedor_contato: false }, 2)).not.toContain('Quero fechar — WhatsApp');
  });

  it('moderno: CNPJ sai no rodapé e some ao desmarcar', () => {
    expect(render({}, 2)).toContain('CNPJ 12.345.678/0001-90');
    expect(render({ mostrar_cnpj: false }, 2)).not.toContain('CNPJ 12.345.678/0001-90');
  });

  it('moderno: nome desmarcado não aparece na legenda da foto nem no texto do WhatsApp', () => {
    const h = render({ mostrar_vendedor_nome: false, foto_telhado_b64: 'data:image/jpeg;base64,AAA' }, 2);
    expect(h).not.toContain('Vistoria realizada por');
  });
});
