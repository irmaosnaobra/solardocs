import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';
import { srcImagemSegura } from '../services/templates/propostaSolarCompleta';
import {
  calcularFinanceiro, valorParcelaCartao, valorParcelaFin, svgBarrasMensais, svgCurvas25,
} from '../services/propostaSolarCalculos';

const NB = ' '; // o Intl põe espaço sem quebra depois de "R$"

const company: any = {
  nome: 'Empresa Exemplo Solar LTDA', nome_fantasia: 'Empresa Exemplo Solar', cnpj: '12345678000190',
  endereco: 'Rua A, 10, Centro', socio_adm: 'Maria Souza', whatsapp: '17996243536', email: 'contato@exemplo.com',
  cor_marca: '#1E3A8A', cor_secundaria: '#F7B500',
};
const client: any = { nome: 'Cliente Exemplo', cidade: 'Sao Jose do Rio Preto', uf: 'SP' };
const base: Record<string, unknown> = {
  emitido_em: '2026-10-15T12:00:00.000Z', cidade: 'Sao Jose do Rio Preto', uf: 'SP', consumo_kwh: '650',
  qtd_modulos: '12', potencia_modulo: '550', marca_modulo: 'Canadian', marca_inversor: 'Growatt',
  potencia_inversor: '5', investimento: '28.900,00', codigo: '20260012',
};
const render = (f: Record<string, unknown> = {}, modelo: 1 | 2 | 3 | 4 = 4, emp: any = company) => {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaSolar', emp, client, { ...base, ...f }, modelo, out);
  return { html, out };
};
const paginas = (h: string) => (h.match(/<div class="page[ "]/g) || []).length;

const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u1/obra/1-abc123.jpg?token=xyz';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('modelo 4 Completo: folhas', () => {
  it('sem galerias: 4 folhas e nenhuma "Quem já confia na gente"', () => {
    const { html } = render({ pag_cartao_12: true });
    expect(paginas(html)).toBe(4);
    expect(html).not.toContain('Quem já confia na gente');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 2/4');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 4/4');
    expect(html).toContain('Análise Financeira');
    expect(html).toContain('Investimento e formas de pagamento');
    expect(html).toContain('Garantias e próximos passos');
  });

  it('cabeçalho só na 1ª folha, rodapé grande só na última', () => {
    const { html } = render({});
    expect((html.match(/<div class="head">/g) || []).length).toBe(1);
    expect((html.match(/<div class="foot">/g) || []).length).toBe(1);
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Garantias e próximos passos'));
    expect(html).toContain('page-break-after:always');
    expect(html).toContain('.page:last-child{ page-break-after:auto');
  });

  it('com obras, empresas ou foto do telhado: 5 folhas e a numeração acompanha', () => {
    const { html } = render({
      pag_cartao_12: true,
      fotos_obras: [{ url: HTTPS, legenda: 'Residência em Campinas' }],
      empresas_atendidas: [{ url: HTTPS, nome: 'Empresa X' }],
      foto_telhado_b64: PNG,
    });
    expect(paginas(html)).toBe(5);
    expect(html).toContain('Quem já confia na gente');
    expect(html).toContain('Obras realizadas');
    expect(html).toContain('Empresas atendidas');
    expect(html).toContain('Local da instalação');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 5/5');
    expect(render({ foto_telhado_b64: PNG }).html).toContain('Local da instalação');
  });

  it('bancos parceiros: logo em ladrilho com nome, ou só o nome', () => {
    const { html } = render({ bancos_parceiros: [{ nome: 'Banco A', url: HTTPS }, { nome: 'Banco B' }] });
    expect(html).toContain('Bancos que financiam o seu sistema');
    expect(html).toMatch(/<div class="bk"><div class="lg"><img src="https:[^"]+" alt="Banco A"\/><\/div><div class="nm">Banco A<\/div><\/div>/);
    expect(html).toContain('<div class="bk so"><div class="nm">Banco B</div></div>');
  });

  it('mesmos tokens do modelo 1: fonte, cores, acento', () => {
    const { html } = render({});
    expect(html).toContain('family=Inter');
    expect(html).toContain('--accent:#F7B500');
    expect(html).toContain('--ink:#161A22');
    expect(html).toContain('.page{ width:794px; min-height:1122px');
  });
});

describe('modelo 4 Completo: imagens e escape', () => {
  it('descarta javascript:, http:// e data: que não seja png/jpeg/webp', () => {
    const { html } = render({
      fotos_obras: [
        { url: 'javascript:alert(1)', legenda: 'ruim 1' },
        { url: 'http://exemplo.com/a.png', legenda: 'ruim 2' },
        { url: 'data:image/svg+xml;base64,PHN2Zz4=', legenda: 'ruim 3' },
        { url: 'data:text/html;base64,PGI+', legenda: 'ruim 4' },
        { url: HTTPS, legenda: 'boa' },
      ],
      empresas_atendidas: [{ url: 'javascript:alert(1)', nome: 'Fantasma' }],
      bancos_parceiros: [{ nome: 'Banco C', url: 'http://x/y.png' }],
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('http://exemplo.com');
    expect(html).not.toContain('svg+xml');
    expect(html).not.toContain('ruim');
    expect(html).not.toContain('Fantasma');
    expect(html).toContain('alt="boa"');
    expect(html).not.toContain('src="http://x/y.png"');
    expect(html).toContain('<div class="bk so"><div class="nm">Banco C</div></div>');
  });

  it('foto do telhado só entra como data:image (nunca URL)', () => {
    expect(render({ foto_telhado_b64: HTTPS }).html).not.toContain('Local da instalação');
    expect(render({ foto_telhado_b64: 'javascript:alert(1)' }).html).not.toContain('Local da instalação');
    expect(render({ foto_telhado_b64: PNG }).html).toContain(`src="${PNG}"`);
  });

  it('srcImagemSegura: https só quando liberado; aspas e espaços derrubam', () => {
    expect(srcImagemSegura(HTTPS, { https: true })).toBe(HTTPS);
    expect(srcImagemSegura(HTTPS)).toBe('');
    expect(srcImagemSegura('https://a.com/x" onerror="1', { https: true })).toBe('');
    expect(srcImagemSegura('https://a.com/x y', { https: true })).toBe('');
    expect(srcImagemSegura(PNG)).toBe(PNG);
    expect(srcImagemSegura(null)).toBe('');
  });

  it('nome e legenda são escapados', () => {
    const { html } = render({
      fotos_obras: [{ url: HTTPS, legenda: '<img src=x onerror=alert(1)> "aspas" & cia' }],
      empresas_atendidas: [{ url: HTTPS, nome: '<script>alert(2)</script>' }],
      bancos_parceiros: [{ nome: '<b>Banco</b>' }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toContain('<b>Banco</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;aspas&quot; &amp; cia');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('respeita os limites: 6 obras, 12 empresas, 8 bancos', () => {
    const { html } = render({
      fotos_obras: Array.from({ length: 9 }, (_, i) => ({ url: HTTPS, legenda: `Obra ${i + 1}` })),
      empresas_atendidas: Array.from({ length: 15 }, (_, i) => ({ url: HTTPS, nome: `Empresa ${i + 1}` })),
      bancos_logos: [],
      bancos_parceiros: Array.from({ length: 11 }, (_, i) => ({ nome: `Banco ${i + 1}` })),
    });
    expect(html).toContain('Obra 6');
    expect(html).not.toContain('Obra 7');
    expect(html).toContain('Empresa 12<');
    expect(html).not.toContain('Empresa 13');
    expect(html).toContain('Banco 8<');
    expect(html).not.toContain('Banco 9');
  });

  it('nome do cliente com HTML sai escapado na faixa do topo e no título', () => {
    const out: { resumo?: string } = {};
    const html = generateFromTemplate('propostaSolar', company, { ...client, nome: 'A <b>B</b>' }, base, 4, out);
    expect(html).not.toContain('<b>B</b>');
    expect(html).toContain('A &lt;b&gt;B&lt;/b&gt;');
  });
});

describe('modelo 4 Completo: pagamentos e números', () => {
  it('parcelas ligadas aparecem com o valor; desligadas não', () => {
    const { html } = render({ pag_cartao_12: true, pag_cartao_6: false, pag_fin_60: true, pag_fin_36: false });
    expect(html).toContain('12× de');
    expect(html).not.toContain('6× de');
    expect(html).toContain('60× de');
    expect(html).not.toContain('36× de');
    expect(html).toContain(`R$${NB}2.715`); // mesma parcela do modelo Moderno (resumo: 12x R$ 2.715,00)
    expect(html).toContain('Cartão de crédito');
    expect(html).toContain('Financiamento bancário');
    expect(html).toContain('120 dias de carência');
  });

  it('cartão e financiamento desligados no form somem, mesmo com as parcelas marcadas', () => {
    const { html } = render({ pag_cartao: false, pag_cartao_12: true, pag_fin: false, pag_fin_60: true });
    expect(html).not.toContain('12× de');
    expect(html).not.toContain('60× de');
    expect(html).not.toContain('Cartão de crédito');
  });

  it('21 cartões e 5 financiamentos cabem; à vista com desconto, entrada e condição especial', () => {
    const f: Record<string, unknown> = {
      preco_avista: '26.500,00', pag_entrada: true, entrada_valor: '8000', entrada_modo: 'contrato', pag_custom: 'Condição <b>x</b>',
    };
    for (let n = 1; n <= 21; n++) f[`pag_cartao_${n}`] = true;
    for (const n of [36, 48, 60, 72, 84]) f[`pag_fin_${n}`] = true;
    const { html } = render(f);
    expect((html.match(/class="pt"/g) || []).length).toBe(26);
    expect(html).toContain('Desconto à vista');
    expect(html).toContain('Economia de');
    expect(html).toContain('Entrada + saldo');
    expect(html).toContain('na assinatura do contrato');
    expect(html).toContain('Condição &lt;b&gt;x&lt;/b&gt;');
  });

  it('sem nenhum pagamento ligado: só o investimento', () => {
    const { html } = render({ pag_vista: false, pag_cartao: false, pag_fin: false });
    expect(html).toContain('Preço do projeto');
    expect(html).not.toContain('class="pt"');
    expect(html).not.toContain('Desconto à vista');
    expect(html).not.toContain('class="hi"');
  });

  it('a economia em 25 anos e o payback são os do Moderno', () => {
    const { html } = render({});
    expect(html).toContain(`R$${NB}334.454,00`);
    expect(html).toContain('4 anos e 4 meses');
    expect(html).toContain('Geração estimada mês a mês');
    expect(html).toContain('Sua economia em 25 anos');
    expect((html.match(/<svg /g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('out.resumo é o mesmo dos outros modelos', () => {
    const f = { pag_cartao_12: true, pag_fin_60: true };
    const a = render(f, 4).out.resumo;
    expect(a).toBeTruthy();
    expect(a).toBe(render(f, 1).out.resumo);
    expect(a).toBe(render(f, 2).out.resumo);
  });

  it('consumo e investimento zerados não quebram nem imprimem economia negativa', () => {
    const { html } = render({ consumo_kwh: '0', investimento: '0' });
    expect(paginas(html)).toBe(3);
    expect(html).not.toContain('-R$');
    // Sem consumo a economia some dos destaques (o modelo 1 imprime negativo; aqui não).
    expect(html).not.toContain('Economia em 25 anos');
    // Sem investimento: nada de "Preço do projeto" zerado.
    expect(html).not.toContain('Preço do projeto');
  });
});

describe('modelo 4 Completo: folhas leves, textos e entrada', () => {
  const secoes = (h: string) => (h.match(/<div class="tab">[^<]+<\/div>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));

  it('sem forma de pagamento nem banco não há folha de pagamentos: o investimento abre a folha de garantias', () => {
    const { html } = render({ pag_vista: false, pag_cartao: false, pag_fin: false, bancos_logos: [] });
    expect(secoes(html)).not.toContain('Investimento e formas de pagamento');
    expect(paginas(html)).toBe(3);
    const f5 = html.slice(html.indexOf('Garantias e próximos passos'));
    expect(f5.indexOf('Preço do projeto')).toBeGreaterThan(-1);
    expect(f5.indexOf('Preço do projeto')).toBeLessThan(f5.indexOf('Garantias inclusas'));
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 3/3');
  });

  it('sem consumo, a folha de geração se junta à seguinte quando cabe; numeração acompanha', () => {
    const solo = render({ consumo_kwh: '0', pag_cartao_12: true });
    expect(secoes(solo.html)).toEqual(expect.arrayContaining(['Economia e Geração', 'Investimento e formas de pagamento']));
    expect(paginas(solo.html)).toBe(3); // projeto, geração + investimento, garantias
    expect(solo.html).toContain('· 3/3');
    expect(solo.html).not.toContain('· 4/');
    // Com 21 cartões a folha de pagamentos não comporta o gráfico: a geração fica sozinha.
    const f: Record<string, unknown> = { consumo_kwh: '0' };
    for (let n = 1; n <= 21; n++) f['pag_cartao_' + n] = true;
    for (const n of [36, 48, 60, 72, 84]) f['pag_fin_' + n] = true;
    f.pag_custom = 'Condição especial';
    f.bancos_parceiros = Array.from({ length: 8 }, (_, i) => ({ nome: 'Banco ' + i }));
    expect(paginas(render(f).html)).toBe(4);
  });

  it('frases e rótulos começam com maiúscula', () => {
    const f: Record<string, unknown> = { pag_cartao_12: true, pag_custom: 'x', pag_entrada: true, entrada_valor: '8000', preco_avista: '27000' };
    const { html } = render(f);
    for (const t of ['Por mês na sua conta', 'Taxa mínima da concessionária', 'A combinar com o vendedor', 'Economia de', 'Dias úteis do contrato à ligação', 'Sem entrada', 'Com o sistema quitado']) {
      expect(html).toContain(t);
    }
    for (const t of ['>por mês', '>taxa mínima da', '>a combinar', '>economia de', '>dias úteis', '>sem entrada', '>com o sistema', '>ou 12']) {
      expect(html).not.toContain(t);
    }
  });

  it('À vista só aparece com desconto; sem desconto não repete o preço do projeto', () => {
    const semDesc = render({ pag_cartao_12: true }).html;
    expect(semDesc).not.toContain('À vista');
    expect(semDesc.split('R$' + NB + '28.900,00').length - 1).toBeGreaterThan(0);
    expect(semDesc).not.toContain('Desconto à vista');
    // preco_avista igual (ou maior) ao investimento também não é desconto
    expect(render({ pag_cartao_12: true, preco_avista: '28.900,00' }).html).not.toContain('À vista');
    const comDesc = render({ pag_cartao_12: true, preco_avista: '26.500,00' }).html;
    expect(comDesc).toContain('Desconto à vista');
    expect(comDesc).toContain('R$' + NB + '26.500,00');
  });

  it('HSP com vírgula só no Completo', () => {
    expect(render({}).html).toMatch(/HSP da região: <strong>\d,\d h\/dia/);
    expect(render({}, 2).html).toMatch(/HSP da região: <strong>\d\.\d h\/dia/);
  });

  it('entrada: entrada e restante coerentes, sem "hoje"', () => {
    const modos: Array<[string, string]> = [['contrato', 'na assinatura do contrato'], ['entrega', 'na entrega do material'], ['dias', 'em 45 dias']];
    for (const [modo, txt] of modos) {
      const { html } = render({ pag_entrada: true, entrada_valor: '8000', entrada_modo: modo, entrada_dias: '45' });
      expect(html).toContain('Entrada de R$' + NB + '8.000,00 · Restante de R$' + NB + '20.900,00 ' + txt);
      expect(html).not.toContain('8.000,00 hoje');
      expect(html).not.toContain('· R$' + NB + '20.900,00 hoje');
    }
  });

  it('foto do telhado é seção própria, sem "Vistoria realizada por"; "Quem já confia" só leva obras e empresas', () => {
    const so = render({ foto_telhado_b64: PNG, vendedor_nome: 'Joao' }).html;
    expect(secoes(so)).toContain('Local da instalação');
    expect(secoes(so)).not.toContain('Quem já confia na gente');
    expect(so).not.toContain('Vistoria realizada');
    const todos = render({ pag_cartao_12: true, foto_telhado_b64: PNG, fotos_obras: [{ url: HTTPS, legenda: 'Casa' }] }).html;
    expect(secoes(todos)).toEqual(expect.arrayContaining(['Local da instalação', 'Quem já confia na gente']));
    expect(paginas(todos)).toBe(5);
    expect(todos.indexOf('Local da instalação')).toBeLessThan(todos.indexOf('Quem já confia na gente'));
  });

  it('item de galeria sem url (assinatura falhou) não aparece no HTML', () => {
    const { html } = render({
      fotos_obras: [{ path: 'portfolio/u/obra/1-abcdef.jpg', legenda: 'Sem url' }],
      empresas_atendidas: [{ path: 'portfolio/u/empresa/1-abcdef.png', nome: 'Sem url tambem' }],
    });
    expect(html).not.toContain('Sem url');
    expect(html).not.toContain('Quem já confia na gente');
  });
});

describe('módulo de cálculos', () => {
  it('parcelas: cartão com taxa padrão e Price com 4 meses de carência', () => {
    expect(valorParcelaCartao({}, 28900, 12)).toBe(Math.ceil((28900 * 1.127) / 12));
    expect(valorParcelaCartao({ taxa_cartao_12: '10' }, 28900, 12)).toBe(Math.ceil((28900 * 1.1) / 12));
    expect(valorParcelaCartao({}, 0, 12)).toBe(0);
    const i = 0.022;
    expect(valorParcelaFin({}, 28900, 60)).toBe(Math.ceil(28900 * Math.pow(1 + i, 4) * i / (1 - Math.pow(1 + i, -60))));
    expect(valorParcelaFin({ taxa_fin_60: '1,8' }, 28900, 60)).toBeLessThan(valorParcelaFin({}, 28900, 60));
  });

  it('financeiro: curvas, cards 1/5/10/25 e economia fecham entre si', () => {
    const r = calcularFinanceiro({ consumoKwh: 650, tarifa: 0.92, taxaMinima: 90, inflacao: 0.06, inflacaoTaxaMin: 0.06, investimento: 28900 });
    expect(r.semSolarAcum).toHaveLength(25);
    expect(r.breakdownEconomia[3]).toBe(r.economia25);
    expect(r.breakdownEconomia[0]).toBe(r.semSolarAcum[0] - r.comSolarAcum[0]);
    expect(r.paybackTexto).toBe('4 anos e 4 meses');
    const zero = calcularFinanceiro({ consumoKwh: 0, tarifa: 0.92, taxaMinima: 90, inflacao: 0.06, inflacaoTaxaMin: 0.06, investimento: 0 });
    expect(zero.paybackTexto).toBe('—');
  });

  it('SVGs: cores entram como parâmetro', () => {
    const b = svgBarrasMensais(Array(12).fill(500), ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'], '#112233', '#445566');
    expect(b).toContain('stop-color="#112233"');
    expect(b).toContain('stop-color="#445566"');
    const c = svgCurvas25(Array.from({ length: 25 }, (_, i) => 100 * (i + 1)), Array.from({ length: 25 }, (_, i) => 10 * (i + 1)), { sem: '#AA0000', com: '#00AA00' });
    expect(c).toContain('stroke="#AA0000"');
    expect(c).toContain('stroke="#00AA00"');
  });
});

// Trechos FIXOS da saída dos modelos 1, 2 e 3, medidos no origin/main (d57edb56) ANTES da extração
// do código compartilhado. Se um destes falhar, a refatoração mudou o que o cliente já recebe.
describe('modelos 1, 2 e 3 seguem byte a byte (trechos do origin/main)', () => {
  const full: Record<string, unknown> = { pag_vista: true };
  for (let n = 1; n <= 21; n++) full[`pag_cartao_${n}`] = true;
  for (const n of [36, 48, 60, 72, 84]) full[`pag_fin_${n}`] = true;

  it('modelo 1: tiles, composição, heróis e grade financeira', () => {
    const { html } = render(full, 1);
    expect(html).toContain('<div class="tile"><div class="k">Potência instalada</div><div class="v num">6,6<u>kWp</u></div></div>');
    expect(html).toContain('<div class="r"><span class="lab">Inversor <em class="mkq">Growatt · 5 kW</em></span><span class="inc">Incluído · 1 un</span></div>');
    expect(html).toContain(`<div class="heroR"><div class="k">Investimento</div><div class="v num">R$${NB}28.900,00</div><div class="s num">ou 84× de R$${NB}827,00</div></div>`);
    expect(html).toContain('<div class="fc"><div class="k">Tempo de retorno</div><div class="v num">4 anos e 4 meses</div></div>');
    expect(html).toContain('<div class="pg">Forma de pagamento &amp; contato</div>');
  });

  it('modelo 2: barras, curvas e cartão de 12x', () => {
    const { html } = render(full, 2);
    expect(html).toContain('<rect x="48" y="24" width="39.166666666666664" height="166" rx="3" fill="url(#g1)"/>');
    expect(html).toContain('<path d="M 70.0 226.2 L 95.4 222.3 L 120.8 218.0 L 146.3 213.6');
    expect(html).toContain(`<div class="breakdown-val">R$${NB}6.096</div>`);
    expect(html).toContain(`<div class="invest-cartao-value">12× de R$${NB}2.715</div>`);
  });

  it('modelo 3: o mesmo corpo do 2, com a capa', () => {
    const m2 = render(full, 2).html;
    const m3 = render(full, 3).html;
    expect(m3).toContain('class="capa"');
    expect(m3).toContain('<rect x="48" y="24" width="39.166666666666664" height="166" rx="3" fill="url(#g1)"/>');
    expect(m2).not.toContain('class="capa"');
  });

  it('resumo de WhatsApp (igual nos modelos 1 a 4)', () => {
    const r = render(full, 1).out.resumo as string;
    expect(r).toContain('* 12x Canadian 550W + 1x Growatt 5K\n* 6,6 kWp · gera ~803 kWh/mês');
    expect(r).toContain('Investimento: R$ 28.900,00');
    expect(r).toContain('* 12x: R$ 2.715,00/mês');
    expect(r).toContain('🏦 Financiamento (120 dias de carência):');
  });
});

// ─── Completa + Banco: bancos fixos, composição, dados bancários e aceite ──────────────────────
import { BANCOS_FIXOS } from '../services/templates/bancosLogos';

describe('modelo 4 Completa + Banco', () => {
  const secoes = (h: string) => (h.match(/<div class="tab">[^<]+<\/div>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
  const ASSIN_PF = {
    empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio administrador' },
    cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
  };
  const empBanc: any = { ...company, cidade: 'Uberlândia-MG', dados_bancarios: { banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6', tipo_conta: 'poupanca', titular: 'Sol Forte', pix: 'pix@exemplo.com' } };
  const logos = (h: string) => (h.match(/<div class="bk fx">/g) || []).length;

  it('bancos_logos ausente = os 8 logos; [] = nenhum e a seção some sem outro conteúdo na folha', () => {
    expect(logos(render({}).html)).toBe(8);
    expect(render({}).html).toContain(`alt="${BANCOS_FIXOS.sicredi.nome}"`);
    expect(logos(render({ bancos_logos: ['itau', 'bb'] }).html)).toBe(2);
    const vazio = render({ pag_vista: false, pag_cartao: false, pag_fin: false, bancos_logos: [] }).html;
    expect(logos(vazio)).toBe(0);
    expect(vazio).not.toContain('Bancos que financiam o seu sistema');
    expect(secoes(vazio)).not.toContain('Investimento e formas de pagamento');
  });

  it('fixos primeiro, depois os enviados; no máximo 12', () => {
    const { html } = render({ bancos_parceiros: Array.from({ length: 6 }, (_, i) => ({ nome: `Banco ${i + 1}` })) });
    expect(logos(html)).toBe(8);
    expect(html).toContain('Banco 4<');
    expect(html).not.toContain('Banco 5<');
  });

  it('composição traz quantidade e descrição; o que não tem dado fica Incluído', () => {
    const { html } = render({ qtd_modulos: '10', potencia_modulo: '550', marca_modulo: 'Canadian', tipo_telhado: 'Cerâmico' });
    expect(html).toContain('10 módulos Canadian de 550 W');
    expect(html).toContain('1 inversor Growatt de 5 kW');
    expect(html).toContain('Estrutura para telhado cerâmico');
    expect(html).not.toContain('Estrutura para telhado Cerâmico');
    expect(html).toContain('<span class="inc">Incluído</span>');
    const bat = render({ bateria_marca: 'BYD', bateria_qtd: '2', bateria_capacidade_kwh: '5' }).html;
    expect(bat).toContain('2 baterias BYD de 5 kWh');
    const sem = render({ tipo_telhado: '', marca_inversor: '', potencia_inversor: '' }).html;
    expect(sem).not.toContain('Estrutura para telhado');
    expect(sem).not.toContain('1 inversor');
  });

  it('dados bancários: só as linhas que existem; some com mostrar_dados_bancarios false ou sem dados completos', () => {
    const { html } = render({}, 4, empBanc);
    expect(html).toContain('Dados para pagamento');
    expect(html).toContain('12345-6 poupança');
    expect(html).toContain('Chave Pix');
    expect(html).not.toContain('CPF/CNPJ do titular');
    expect(render({ mostrar_dados_bancarios: false }, 4, empBanc).html).not.toContain('Dados para pagamento');
    const so = render({}, 4, { ...company, dados_bancarios: { banco: 'X', agencia: '1' } }).html;
    expect(so).not.toContain('Dados para pagamento');
    const pix = render({}, 4, { ...company, dados_bancarios: { pix: 'a@b.com' } }).html;
    expect(pix).toContain('Chave Pix');
    expect(pix).not.toContain('<span class="lab">Banco</span>');
    expect(pix).not.toContain('<span class="lab">Agência</span>');
  });

  it('aceite: última folha, com nome, CPF formatado, local e data; rodapé grande só nela', () => {
    const { html } = render({ assinatura: ASSIN_PF }, 4, empBanc);
    expect(paginas(html)).toBe(5);
    const secs = secoes(html);
    expect(secs[secs.length - 1]).toBe('Aceite da proposta');
    expect(html).toContain('As duas partes confirmam os equipamentos, os valores e as condições desta proposta.');
    expect(html).toContain('Uberlândia-MG, 15 de outubro de 2026.');
    expect(html).toContain('<div class="nm">Maria Aparecida Souza</div>');
    expect(html).toContain('CPF <span class="dp">529.982.247-25</span>');
    expect(html).toContain('CNPJ 11.222.333/0001-81');
    expect(html).toContain('Carlos Pereira, Sócio administrador');
    expect(html).toContain('Pela empresa');
    expect(html).toContain('Pelo cliente');
    expect((html.match(/<div class="foot">/g) || []).length).toBe(1);
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Aceite da proposta'));
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 5/5');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 2/5');
    // O cabeçalho da 1ª folha também leva o CPF.
    expect(html.slice(0, html.indexOf('Detalhamento do Projeto'))).toContain('<div class="rowf"><span>CPF</span><span class="dp">529.982.247-25</span></div>');
  });

  it('aceite PJ: razão social, CNPJ (sem marca de máscara) e representante; local cai na cidade do cliente', () => {
    const a = { ...ASSIN_PF, cliente: { tipo: 'PJ', nome: 'Padaria Pão Quente Ltda', documento: '11222333000181', representante: 'Ana Lima' } };
    const { html } = render({ assinatura: a });
    expect(html).toContain('<div class="nm">Padaria Pão Quente Ltda</div>');
    expect(html).toContain('<div class="rp">Ana Lima</div>');
    expect(html).not.toContain('class="dp"');
    expect(html.slice(0, html.indexOf('Detalhamento do Projeto'))).toContain('<div class="rowf"><span>CNPJ</span><span class="num">11.222.333/0001-81</span></div>');
    expect(html).toContain('Sao Jose do Rio Preto, 15 de outubro de 2026.');
    expect(render({ assinatura: { ...a, local: 'Araguari-MG' } }).html).toContain('Araguari-MG, 15 de outubro de 2026.');
  });

  it('dados bancários: o CPF do titular (11 dígitos) sai em span.dp; CNPJ e Pix ficam inteiros', () => {
    const cpf = render({}, 4, { ...company, dados_bancarios: { pix: '529.982.247-25', documento: '529.982.247-25' } }).html;
    expect(cpf).toContain('<span class="val"><span class="dp">529.982.247-25</span></span>');
    expect(cpf.match(/class="dp"/g)).toHaveLength(1); // a chave Pix não é mascarada
    // A contagem é só de dígitos: 11 dígitos com qualquer pontuação (ou sem) é CPF.
    const solto = render({}, 4, { ...company, dados_bancarios: { pix: 'a@b.com', documento: '529 982 247/25' } }).html;
    expect(solto).toContain('<span class="dp">529 982 247/25</span>');
    expect(render({}, 4, { ...company, dados_bancarios: { pix: 'a@b.com', documento: '52998224725' } }).html).toContain('<span class="dp">52998224725</span>');
    const cnpj = render({}, 4, { ...company, dados_bancarios: { pix: 'a@b.com', documento: '11.222.333/0001-81' } }).html;
    expect(cnpj).toContain('11.222.333/0001-81');
    expect(cnpj).not.toContain('class="dp"');
  });

  it('aceite traz o resumo do que está sendo aceito, só com o que existe', () => {
    const { html } = render({ assinatura: ASSIN_PF, preco_avista: '27.000,00', pag_vista: true });
    const aceite = html.slice(html.indexOf('Resumo do que está sendo aceito'));
    expect(aceite).toContain('<span class="lab">Proposta</span><span class="val num">20260012</span>');
    expect(aceite).toContain('Sistema</span><span class="val num">6,6 kWp com 12 módulos Canadian de 550 W');
    expect(aceite).toContain('Inversor</span><span class="val num">1 inversor Growatt de 5 kW');
    expect(aceite).toContain('Preço do projeto');
    expect(aceite).toContain('À vista');
    expect(aceite).toContain('Validade</span><span class="val num">Até 22/10/2026');
    expect(aceite.indexOf('Resumo do que está sendo aceito')).toBeLessThan(aceite.indexOf('As duas partes confirmam'));
    const enxuto = render({ assinatura: ASSIN_PF, codigo: '', investimento: '', pag_vista: false, marca_inversor: '', potencia_inversor: '' }).html;
    const resumo = enxuto.slice(enxuto.indexOf('Resumo do que está sendo aceito'), enxuto.indexOf('As duas partes confirmam'));
    expect(resumo).not.toContain('Proposta</span>');
    expect(resumo).not.toContain('Inversor</span>');
    expect(resumo).not.toContain('À vista');
  });

  it('folha de garantias traz as 5 etapas até a ligação, com ou sem aceite, depois do prazo e antes do selo', () => {
    for (const f of [{}, { assinatura: ASSIN_PF }]) {
      const html = render(f).html;
      const f5 = html.slice(html.indexOf('Garantias e próximos passos'));
      expect(f5).toContain('Etapas até a ligação');
      for (const [t, d] of [['Projeto', 'O engenheiro faz o projeto e a ART do seu sistema.'], ['Vistoria técnica', 'A equipe confere o telhado e o padrão de energia.'],
        ['Instalação', 'Módulos, inversor e proteções instalados no local.'], ['Homologação', 'A empresa faz o pedido de conexão na concessionária.'], ['Ligação', 'Sistema ligado e gerando energia.']]) {
        expect(f5).toContain(`<div class="t">${t}</div><div class="d">${d}</div>`);
      }
      expect((f5.match(/<div class="et">/g) || []).length).toBe(5);
      expect(f5.indexOf('Prazo de instalação')).toBeLessThan(f5.indexOf('Etapas até a ligação'));
      expect(f5.indexOf('Etapas até a ligação')).toBeLessThan(f5.indexOf('class="vpill"'));
    }
  });

  it('sem assinatura: sem folha de aceite, sem CPF no cabeçalho, rodapé grande na última', () => {
    const { html } = render({});
    expect(secoes(html)).not.toContain('Aceite da proposta');
    expect(html).not.toContain('class="dp"');
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Garantias e próximos passos'));
    expect(paginas(html)).toBe(4);
  });

  it('texto do usuário no aceite e nos dados bancários sai escapado', () => {
    const a = { ...ASSIN_PF, empresa: { ...ASSIN_PF.empresa, razao_social: 'A <b>B</b> Ltda' } };
    const { html } = render({ assinatura: a }, 4, { ...empBanc, dados_bancarios: { pix: '<i>x</i>' } });
    expect(html).not.toContain('<b>B</b>');
    expect(html).not.toContain('<i>x</i>');
    expect(html).toContain('A &lt;b&gt;B&lt;/b&gt; Ltda');
  });
});
