import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';

// Iluminação pública (CIP/COSIP): taxa da prefeitura que vem na conta e continua
// depois do solar. Aparece só nos valores de conta hoje/depois; economia, payback
// e economia em 25 anos não mudam.

const company: any = {
  nome: 'CMO ENERGIA SOLAR LTDA', nome_fantasia: 'CMO ENERGIA SOLAR', cnpj: '12345678000190',
  endereco: 'AVENIDA ALCEBÍADES BERNARDO, 738', socio_adm: 'Jair', whatsapp: '5517996803659',
};
const client: any = { nome: 'Fulano de Tal', cidade: 'Uberlândia', uf: 'MG' };
// emitido_em fixo: sem ele o template usa a data de hoje e o HTML muda todo dia.
const EMISSAO = '2026-10-21T15:00:00.000Z';
const fixA: Record<string, unknown> = {
  cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '450', qtd_modulos: '10', potencia_modulo: '620',
  marca_modulo: 'Canadian', qtd_inversores: '1', marca_inversor: 'Growatt', potencia_inversor: '5',
  investimento: '22000', taxa_minima: '90', tarifa_kwh: '1,20', emitido_em: EMISSAO,
};
// Sem taxa mínima nem tarifa: cai nos padrões do template (90 e tarifa do estado).
const fixB: Record<string, unknown> = {
  cidade: 'Campinas', uf: 'SP', consumo_kwh: '800', qtd_modulos: '16', potencia_modulo: '600',
  marca_modulo: 'Jinko', qtd_inversores: '1', marca_inversor: 'Deye', potencia_inversor: '8',
  investimento: '38000', emitido_em: EMISSAO,
};

// Modelos: 1 = 1 página, 2 = Moderno (M1), 3 = M1 com capa.
function render(fix: Record<string, unknown>, extra: Record<string, unknown>, modelo: 1 | 2 | 3) {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaSolar', company, client, { ...fix, ...extra }, modelo, out);
  return { html, resumo: out.resumo ?? '' };
}
describe('iluminação pública: sem o campo o documento não muda um byte', () => {
  // Comparação na mesma execução: ausente é a referência; vazio, zero e inválido
  // têm que gerar exatamente o mesmo HTML e o mesmo resumo.
  const equivalentes: Array<[string, Record<string, unknown>]> = [
    ['vazio', { iluminacao_publica: '' }],
    ['"0"', { iluminacao_publica: '0' }],
    ['"0,00"', { iluminacao_publica: '0,00' }],
    ['texto inválido', { iluminacao_publica: 'abc' }],
    ['negativo', { iluminacao_publica: '-10' }],
  ];
  for (const [nomeCaso, extra] of equivalentes) {
    for (const [nomeFix, fix] of [['A', fixA], ['B', fixB]] as const) {
      for (const modelo of [1, 2, 3] as const) {
        it(`${nomeCaso}: fixture ${nomeFix}, modelo ${modelo}`, () => {
          const ref = render(fix, {}, modelo);
          const r = render(fix, extra, modelo);
          expect(r.html).toBe(ref.html);
          expect(r.resumo).toBe(ref.resumo);
        });
      }
    }
  }
});

describe('iluminação pública: valores exibidos', () => {
  // brl() usa espaço sem quebra entre "R$" e o número.
  const norm = (s: string) => s.replace(/ /g, ' ');
  const hoje = (h: string) => norm((h.match(/Hoje você paga<\/div>\s*<div class="compare-value">([^<]*)</) || [])[1] || '');
  const depois = (h: string) => norm((h.match(/Com energia solar<\/div>\s*<div class="compare-value">([^<]*)</) || [])[1] || '');
  const depoisSub = (h: string) => norm((h.match(/Com energia solar<\/div>[\s\S]*?<div class="compare-sub">([^<]*)</) || [])[1] || '');
  const fin = (h: string, rotulo: string) => norm((h.match(new RegExp(`${rotulo}</div><div class="v num">([^<]*)<`)) || [])[1] || '');
  const savings = (h: string) => norm((h.match(/<div class="compare-savings">([^<]*)</) || [])[1] || '');

  for (const cip of ['30', '25,90', '30.00']) {
    const valor = parseFloat(cip.replace(',', '.'));
    it(`Moderno com CIP "${cip}": hoje +${valor}, depois = taxa mínima + CIP, economia igual`, () => {
      const sem = render(fixA, {}, 2).html;
      const com = render(fixA, { iluminacao_publica: cip }, 2).html;
      expect(hoje(sem)).toBe('R$ 540');
      expect(depois(sem)).toBe('R$ 90');
      expect(hoje(com)).toBe(`R$ ${Math.round(540 + valor)}`);
      expect(depois(com)).toBe(`R$ ${Math.round(90 + valor)}`);
      expect(depoisSub(sem)).toBe('taxa mínima da concessionária');
      expect(depoisSub(com)).toContain('taxa mínima da concessionária + iluminação pública R$');
      expect(depoisSub(com)).toContain(valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
      // Economia e payback ficam na frase de economia: tem que ser a mesma.
      expect(savings(com)).toBe(savings(sem));
      expect(savings(sem)).toContain('R$ 450');
    });

    it(`Moderno com CIP "${cip}": economia, payback e gráfico iguais ao caso sem CIP`, () => {
      const sem = render(fixA, {}, 2);
      const com = render(fixA, { iluminacao_publica: cip }, 2);
      expect(com.resumo).toBe(sem.resumo);
      // Fora do bloco "antes vs depois" o documento é idêntico.
      const semBloco = (h: string) => h.replace(/<div class="section">\s*<h2>Sua conta de luz: antes vs depois<\/h2>[\s\S]*?<\/div>\s*<\/div>\s*<div class="compare-savings">/, '<SAVINGS>');
      expect(semBloco(com.html)).toBe(semBloco(sem.html));
    });

    it(`1 página com CIP "${cip}": conta depois = taxa mínima + CIP; economia, payback e 25 anos iguais`, () => {
      const sem = render(fixA, {}, 1).html;
      const com = render(fixA, { iluminacao_publica: cip }, 1).html;
      expect(fin(sem, 'Conta após instalação')).toBe('R$ 90,00');
      expect(fin(com, 'Conta após instalação')).toBe(`R$ ${(90 + valor).toFixed(2).replace('.', ',')}`);
      expect(com).toContain('Taxa mínima + iluminação pública R$');
      expect(sem).not.toContain('iluminação pública');
      for (const rotulo of ['Economia mensal', 'Tempo de retorno', 'Economia em 25 anos']) {
        expect(fin(com, rotulo)).toBe(fin(sem, rotulo));
        expect(fin(sem, rotulo)).not.toBe('');
      }
      expect(fin(sem, 'Economia mensal')).toBe('R$ 450,00');
    });
  }
});
