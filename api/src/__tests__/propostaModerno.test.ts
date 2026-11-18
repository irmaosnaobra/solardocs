import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';
import { calcularFinanceiro } from '../services/propostaSolarCalculos';
import { pBRL } from '../services/propostaSolarBase';
import { cenariosModerno } from './fixtures/propostaModernoDados';
import { ALTURA_UTIL } from '../services/templates/propostaModernoPaginas';

// Moderno (modelos 2 e 3) em folhas A4, refeito em 18/11/2026. O que estas regras seguram:
// campo sem valor nunca sai vazio, texto sem travessão nem emoji, números iguais aos da conta de sempre,
// e o 3 é o 2 com uma capa na frente.
const render = (nome: string, modelo: 2 | 3) => {
  const c = cenariosModerno.find((x) => x.nome === nome)!;
  return generateFromTemplate('propostaSolar', c.empresa, c.cliente, { ...c.campos }, modelo);
};
// Texto visível: sem <style>, sem tags, sem SVG.
const texto = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
const folhas = (h: string) => (h.match(/<div class="page[ "]/g) || []).length;

describe('Moderno em folhas A4', () => {
  for (const c of cenariosModerno) {
    for (const m of [2, 3] as const) {
      it(`${c.nome}, modelo ${m}: nada vazio, sem travessão, sem emoji`, () => {
        const h = render(c.nome, m);
        const t = texto(h);
        for (const proibido of ['___', 'undefined', 'NaN', 'null', '—', '–', 'Invalid Date', 'Indefinido']) expect(t).not.toContain(proibido);
        expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
        // Valor vazio: rótulo sem número, célula vazia (a coluna de quantidade da linha de total é a única exceção).
        expect(h).not.toMatch(/<div class="v">\s*<\/div>/);
        expect(h).not.toMatch(/<td>\s*<\/td>/);
        expect(h).not.toMatch(/<b>\s*<\/b>/);
      });
    }
    it(`${c.nome}: o 3 é o 2 com uma capa na frente`, () => {
      const m2 = render(c.nome, 2), m3 = render(c.nome, 3);
      expect(m2).not.toContain('class="page capa"');
      expect(m3).toContain('class="page capa"');
      expect(folhas(m3)).toBe(folhas(m2) + 1);
      expect(folhas(m2)).toBeGreaterThanOrEqual(5);
      expect(folhas(m3)).toBeLessThanOrEqual(8);
    });
  }

  it('mesmos números da conta de sempre (payback e economia em 25 anos)', () => {
    const c = cenariosModerno.find((x) => x.nome === 'completa-bateria')!;
    const fin = calcularFinanceiro({ consumoKwh: 650, tarifa: 1.05, taxaMinima: 95, inflacao: 0.06, inflacaoTaxaMin: 0.06, investimento: 29900 });
    const h = render(c.nome, 2);
    expect(h).toContain(fin.paybackTexto);
    expect(h).toContain(pBRL(fin.economia25));
    expect(h).toContain(`${pBRL(fin.economiaMensal)} <small>por mês</small>`);
  });

  it('dados mínimos: sem CPF, e-mail, telefone, foto, garantia de inversor nem QR', () => {
    const t = texto(render('minimo', 3));
    expect(render('minimo', 3)).not.toContain('<div class="k">Inversor</div>');
    for (const r of ['CPF', 'E-mail', 'Telefone', 'Vistoria feita por', 'Local da instalação', 'Aponte a câmera', 'Bateria', 'Cartão de crédito', 'Financiamento']) expect(t).not.toContain(r);
  });

  it('completa: CPF formatado, bateria explicada, financiamento com aviso de crédito', () => {
    const h = render('completa-bateria', 2);
    expect(h).toContain('529.982.247-25');
    expect(h).toContain('Seu sistema tem bateria.');
    expect(h).toContain('Capacidade total: 10,24 kWh.');
    expect(h).toContain('Simulação sujeita a análise de crédito do banco.');
    expect(h).toContain('120 dias de carência');
  });

  it('só à vista: nenhuma grade de parcelas e o incluso vai para a folha do investimento', () => {
    const h = render('so-avista', 2);
    expect(h).not.toContain('class="parc');
    expect(h.indexOf('O valor inclui')).toBeGreaterThan(h.indexOf('<h2>Investimento</h2>'));
    expect(h.indexOf('O valor inclui')).toBeLessThan(h.indexOf('<h2>Como trabalhamos</h2>'));
    expect((h.match(/O valor inclui/g) || []).length).toBe(1);
  });

  it('fluxo de caixa: saldo negativo antes do retorno e positivo depois', () => {
    const h = render('completa-bateria', 2);
    const vira = h.match(/<tr class="vira"><td>Ano (\d+)<\/td>/);
    expect(vira).not.toBeNull();
    expect(h).toMatch(/<td>Ano 1<\/td>[\s\S]*?<td class="r sd"><span>-R\$/);
  });
});

describe('Moderno: segurança, dados vazios e altura das folhas', () => {
  const ATAQUE = 'data:image/png;base64,AA" onerror="alert(3)';
  it('foto e logo fora do formato não entram no HTML (nada de atributo injetado)', () => {
    const c = cenariosModerno[0];
    for (const m of [2, 3] as const) {
      const h = generateFromTemplate('propostaSolar', { ...c.empresa, logo_base64: ATAQUE }, c.cliente, { ...c.campos, foto_telhado_b64: ATAQUE }, m);
      expect(h).not.toContain('onerror');
      expect(h).not.toContain('Vistoria feita por');
      const js = generateFromTemplate('propostaSolar', { ...c.empresa, logo_base64: 'javascript:alert(1)' }, c.cliente, { ...c.campos, foto_telhado_b64: 'https://x.example/a.jpg' }, m);
      expect(js).not.toContain('javascript:');
      expect(js).not.toContain('x.example');
    }
    const ok = generateFromTemplate('propostaSolar', { ...c.empresa, logo_base64: 'https://cdn.example/logo.png?a=1&b=2' }, c.cliente, { ...c.campos }, 3);
    expect(ok).toContain('src="https://cdn.example/logo.png?a=1&amp;b=2"');
  });

  it('dados vazios: nenhum 0 kWp, 0 kWh, R$ 0 nem NaN', () => {
    for (const m of [2, 3] as const) {
      const t = texto(generateFromTemplate('propostaSolar', { nome: 'X', cnpj: '' } as never, { nome: 'Cliente' } as never, {}, m)).replace(/\s+/g, ' ');
      expect(t).not.toMatch(/(^|[^\d.,])0 (kWp|kWh|módulos)/);
      expect(t).not.toMatch(/R\$\s?0(?![\d.,])/);
      expect(t).not.toContain('NaN');
    }
  });

  it('extremo: 600 caracteres de condição, 6 inversores, 26 parcelas, nomes longos; nenhuma folha estimada passa da altura útil', () => {
    const g = cenariosModerno.find((x) => x.nome === 'grande')!;
    const inversores = [10, 8, 6, 5, 3.6, 12].map((p, i) => ({ qtd: 1, marca: ['Growatt', 'Huawei', 'Deye', 'Sungrow Power Supply', 'Fronius', 'SMA Solar Technology'][i], potencia: String(p), garantia: String([10, 12, 5, 10, 7, 15][i]) }));
    const campos = {
      ...g.campos, inversores, pag_custom: 'Pagamento combinado em etapas, '.repeat(20).slice(0, 600), pag_entrada: true, entrada_valor: '30.000,00',
      foto_telhado_b64: 'data:image/png;base64,iVBORw0KGgo=', endereco: 'Rodovia BR-050, Quilômetro 63, Galpão 7, Condomínio Empresarial Distrito Industrial Norte, Uberlândia - MG',
      bateria_marca: 'BYD', bateria_qtd: '4', bateria_capacidade_kwh: '5,12', bateria_garantia_anos: '10',
      garantia_extra1_nome: 'Monitoramento remoto do sistema completo', garantia_extra2_nome: 'Limpeza semestral dos módulos fotovoltaicos',
    };
    const empresa = { ...g.empresa, nome: 'Companhia Brasileira de Energia Solar Fotovoltaica do Triângulo', nome_fantasia: 'Companhia Brasileira de Energia Solar Fotovoltaica do Triângulo Mineiro' };
    const cliente = { ...g.cliente, nome: 'Supermercado Bom Preço da Família Oliveira e Filhos Comércio Ltda' };
    for (const m of [2, 3] as const) {
      const h = generateFromTemplate('propostaSolar', empresa, cliente, campos, m);
      const est = [...h.matchAll(/data-est="(\d+)"/g)].map((x) => Number(x[1]));
      expect(est.length).toBeGreaterThan(1);
      for (const e of est) expect(e).toBeLessThanOrEqual(ALTURA_UTIL);
      expect(h).toContain('Continuação da folha anterior.');
      expect(h).toContain('<h2>Equipamentos</h2>');
      // Toda a condição especial sai inteira, sem corte.
      expect(h).toContain(campos.pag_custom.trim().slice(-20));
    }
  });
});
