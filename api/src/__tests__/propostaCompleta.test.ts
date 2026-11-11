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
const secoesTab = (h: string) => (h.match(/<div class="tab">[^<]+<\/div>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
const paginas = (h: string) => (h.match(/<div class="page[ "]/g) || []).length;
// n fotos de obra com URL já assinada (o servidor só entrega ao template o que já passou pela reassinatura).
const fotosObra = (n: number, legenda = (i: number) => `Obra ${i + 1}`) => Array.from({ length: n }, (_, i) => ({ url: HTTPS, legenda: legenda(i) }));

const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u1/obra/1-abc123.jpg?token=xyz';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('modelo 4 Completo: folhas', () => {
  it('sem galerias: 4 folhas e nenhuma "Quem já confia na gente"', () => {
    const { html } = render({ pag_cartao_12: true });
    expect(paginas(html)).toBe(5);
    expect(html).not.toContain('Quem já confia na gente');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 2/5');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 5/5');
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
      fotos_obras: fotosObra(6),
      empresas_atendidas: [{ url: HTTPS, nome: 'Empresa X' }],
      foto_telhado_b64: PNG,
    });
    expect(paginas(html)).toBe(6);
    expect(html).toContain('Quem já confia na gente');
    expect(html).toContain('Obras realizadas');
    expect(html).toContain('Empresas atendidas');
    expect(html).toContain('Local da instalação');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 6/6');
    expect(render({ foto_telhado_b64: PNG }).html).toContain('Local da instalação');
  });

  it('bancos_parceiros (o "outro banco" de propostas antigas) é ignorado no modelo 4: só os fixos de bancos_logos saem', () => {
    const antigo = [{ nome: 'Sicredi' }, { nome: 'Banco A', url: HTTPS }];
    const { html } = render({ bancos_parceiros: antigo, bancos_logos: ['itau', 'bb'] });
    expect(html).toContain('Bancos que financiam o seu sistema');
    expect((html.match(/<div class="bk[ "]/g) || []).length).toBe(2);
    expect(html).toContain('alt="Itaú"');
    expect(html).not.toContain('Banco A');
    expect(html).not.toContain('class="bk so"');
    // Sem fixos marcados, o "outro banco" não faz a seção aparecer.
    const vazio = render({ bancos_parceiros: antigo, bancos_logos: [], pag_vista: false, pag_cartao: false, pag_fin: false }).html;
    expect(vazio).not.toContain('Bancos que financiam o seu sistema');
    expect(secoesTab(vazio)).not.toContain('Investimento e formas de pagamento');
    // Com todos os bancos fixos padrão, o mesmo "Sicredi" só nome não vira um nono cartão.
    expect((render({ bancos_parceiros: antigo }).html.match(/<div class="bk[ "]/g) || []).length).toBe(BANCOS_IDS.length);
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
        ...fotosObra(6, () => 'boa'),
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
    expect(html).not.toContain('Banco C');
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
      fotos_obras: fotosObra(6, (i) => (i === 0 ? '<img src=x onerror=alert(1)> "aspas" & cia' : `Obra ${i + 1}`)),
      empresas_atendidas: [{ url: HTTPS, nome: '<script>alert(2)</script>' }],
      bancos_parceiros: [{ nome: '<b>Banco</b>' }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toContain('<b>Banco</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;aspas&quot; &amp; cia');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('respeita os limites: 12 obras, 12 empresas, todos os bancos fixos (parceiros ignorados)', () => {
    const { html } = render({
      fotos_obras: fotosObra(15),
      empresas_atendidas: Array.from({ length: 15 }, (_, i) => ({ url: HTTPS, nome: `Empresa ${i + 1}` })),
      bancos_parceiros: Array.from({ length: 11 }, (_, i) => ({ nome: `Banco ${i + 1}` })),
    });
    expect(html).toContain('Obra 12<');
    expect(html).not.toContain('Obra 13');
    expect(html).toContain('Empresa 12<');
    expect(html).not.toContain('Empresa 13');
    expect((html.match(/<div class="bk[ "]/g) || []).length).toBe(BANCOS_IDS.length);
    expect(html).not.toContain('Banco 1<');
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
    expect(paginas(html)).toBe(4);
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
    expect(paginas(html)).toBe(4);
    const f5 = html.slice(html.indexOf('Garantias e próximos passos'));
    expect(f5.indexOf('Preço do projeto')).toBeGreaterThan(-1);
    expect(f5.indexOf('Preço do projeto')).toBeLessThan(f5.indexOf('Garantias inclusas'));
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 4/4');
  });

  it('sem consumo, a folha de geração se junta à seguinte quando cabe; numeração acompanha', () => {
    const solo = render({ consumo_kwh: '0', pag_cartao_12: true });
    expect(secoes(solo.html)).toEqual(expect.arrayContaining(['Economia e Geração', 'Investimento e formas de pagamento']));
    expect(paginas(solo.html)).toBe(4); // projeto, geração + investimento, garantias
    expect(solo.html).toContain('· 4/4');
    expect(solo.html).not.toContain('· 5/');
    // Com 21 cartões a folha de pagamentos não comporta o gráfico: a geração fica sozinha.
    const f: Record<string, unknown> = { consumo_kwh: '0' };
    for (let n = 1; n <= 21; n++) f['pag_cartao_' + n] = true;
    for (const n of [36, 48, 60, 72, 84]) f['pag_fin_' + n] = true;
    f.pag_custom = 'Condição especial';
    f.bancos_parceiros = Array.from({ length: 8 }, (_, i) => ({ nome: 'Banco ' + i }));
    expect(paginas(render(f).html)).toBe(5);
  });

  it('frases e rótulos começam com maiúscula', () => {
    const f: Record<string, unknown> = { pag_cartao_12: true, pag_custom: 'x', pag_entrada: true, entrada_valor: '8000', preco_avista: '27000' };
    const { html } = render(f);
    for (const t of ['Por mês na sua conta', 'Taxa mínima da concessionária', 'A combinar com o vendedor', 'Economia de', 'Do contrato à ligação: até 45 dias úteis.', 'Sem entrada', 'Com o sistema quitado']) {
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
    const todos = render({ pag_cartao_12: true, foto_telhado_b64: PNG, fotos_obras: fotosObra(6) }).html;
    expect(secoes(todos)).toEqual(expect.arrayContaining(['Local da instalação', 'Quem já confia na gente']));
    expect(paginas(todos)).toBe(6);
    // A confiança agora divide a folha do investimento (quando cabe); a foto do telhado segue na folha dela, logo depois.
    expect(todos.indexOf('Local da instalação')).toBeGreaterThan(todos.indexOf('Quem já confia na gente'));
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
import { BANCOS_FIXOS, BANCOS_IDS } from '../services/templates/bancosLogos';

describe('modelo 4 Completa + Banco', () => {
  const secoes = (h: string) => (h.match(/<div class="tab">[^<]+<\/div>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
  const ASSIN_PF = {
    empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio administrador' },
    cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
  };
  const empBanc: any = { ...company, cidade: 'Uberlândia-MG', dados_bancarios: { banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6', tipo_conta: 'poupanca', titular: 'Sol Forte', pix: 'pix@exemplo.com' } };
  const logos = (h: string) => (h.match(/<div class="bk fx">/g) || []).length;

  it('bancos_logos ausente = todos os logos fixos; [] = nenhum e a seção some sem outro conteúdo na folha', () => {
    expect(logos(render({}).html)).toBe(BANCOS_IDS.length);
    expect(render({}).html).toContain(`alt="${BANCOS_FIXOS.sicredi.nome}"`);
    expect(logos(render({ bancos_logos: ['itau', 'bb'] }).html)).toBe(2);
    const vazio = render({ pag_vista: false, pag_cartao: false, pag_fin: false, bancos_logos: [] }).html;
    expect(logos(vazio)).toBe(0);
    expect(vazio).not.toContain('Bancos que financiam o seu sistema');
    expect(secoes(vazio)).not.toContain('Investimento e formas de pagamento');
  });

  it('só os fixos: os enviados (bancos_parceiros) nunca entram', () => {
    const { html } = render({ bancos_parceiros: Array.from({ length: 6 }, (_, i) => ({ nome: `Banco ${i + 1}` })) });
    expect(logos(html)).toBe(BANCOS_IDS.length);
    expect(html).not.toContain('Banco 1<');
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

  it('dados bancários: opção desligada por padrão; só true mostra, e só as linhas que existem', () => {
    expect(render({}, 4, empBanc).html).not.toContain('Dados para pagamento');
    expect(render({ mostrar_dados_bancarios: false }, 4, empBanc).html).not.toContain('Dados para pagamento');
    expect(render({ mostrar_dados_bancarios: 'true' }, 4, empBanc).html).not.toContain('Dados para pagamento');
    const { html } = render({ mostrar_dados_bancarios: true }, 4, empBanc);
    expect(html).toContain('Dados para pagamento');
    expect(html).toContain('12345-6 poupança');
    expect(html).toContain('Chave Pix');
    expect(html).not.toContain('CPF/CNPJ do titular');
    const so = render({ mostrar_dados_bancarios: true }, 4, { ...company, dados_bancarios: { banco: 'X', agencia: '1' } }).html;
    expect(so).not.toContain('Dados para pagamento');
    const pix = render({ mostrar_dados_bancarios: true }, 4, { ...company, dados_bancarios: { pix: 'a@b.com' } }).html;
    expect(pix).toContain('Chave Pix');
    expect(pix).not.toContain('<span class="lab">Banco</span>');
    expect(pix).not.toContain('<span class="lab">Agência</span>');
  });

  it('aceite: última folha, com nome, CPF formatado, local e data; rodapé grande só nela', () => {
    const { html } = render({ assinatura: ASSIN_PF, mostrar_dados_bancarios: true }, 4, empBanc);
    expect(paginas(html)).toBe(5);
    const secs = secoes(html);
    expect(secs[secs.length - 1]).toBe('Aceite da proposta');
    expect(html).toContain('As duas partes confirmam os equipamentos, os valores e as condições desta proposta.');
    expect(html).toContain('Uberlândia-MG, 15 de outubro de 2026.');
    expect(html).toContain('<div class="nm">Maria Aparecida Souza</div>');
    // Na folha de aceite sempre aparecem a empresa (razão social e CNPJ) e o cliente (nome completo e CPF), inteiros.
    expect(html).toContain('<div class="nm">Sol Forte Energia Ltda</div>');
    expect(html).toContain('<div class="dc">CNPJ 11.222.333/0001-81</div>');
    expect(html).toContain('<div class="dc">CPF 529.982.247-25</div>');
    expect(html).not.toContain('class="dp"');
    expect(html).not.toContain('***');
    expect(html).toContain('Carlos Pereira, Sócio administrador');
    expect(html).toContain('Pela empresa');
    expect(html).toContain('Pelo cliente');
    expect((html.match(/<div class="foot">/g) || []).length).toBe(1);
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Aceite da proposta'));
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 5/5');
    expect(html).toContain('Proposta Comercial · Cliente Exemplo · 2/5');
    // O cabeçalho da 1ª folha também leva o CPF.
    expect(html.slice(0, html.indexOf('Detalhamento do Projeto'))).toContain('<div class="rowf"><span>CPF</span><span class="num">529.982.247-25</span></div>');
  });

  it('aceite PJ: razão social, CNPJ inteiro e representante; local cai na cidade do cliente', () => {
    const a = { ...ASSIN_PF, cliente: { tipo: 'PJ', nome: 'Padaria Pão Quente Ltda', documento: '11222333000181', representante: 'Ana Lima' } };
    const { html } = render({ assinatura: a });
    expect(html).toContain('<div class="nm">Padaria Pão Quente Ltda</div>');
    expect(html).toContain('<div class="rp">Ana Lima</div>');
    expect(html).toContain('<div class="dc">CNPJ 11.222.333/0001-81</div>');
    expect(html).not.toContain('class="dp"');
    expect(html.slice(0, html.indexOf('Detalhamento do Projeto'))).toContain('<div class="rowf"><span>CNPJ</span><span class="num">11.222.333/0001-81</span></div>');
    expect(html).toContain('Sao Jose do Rio Preto, 15 de outubro de 2026.');
    expect(render({ assinatura: { ...a, local: 'Araguari-MG' } }).html).toContain('Araguari-MG, 15 de outubro de 2026.');
  });

  it('dados bancários: o CPF e o CNPJ do titular e a chave Pix saem inteiros', () => {
    const cpf = render({ mostrar_dados_bancarios: true }, 4, { ...company, dados_bancarios: { pix: '529.982.247-25', documento: '529.982.247-25' } }).html;
    expect(cpf).toContain('<span class="lab">CPF/CNPJ do titular</span><span class="val">529.982.247-25</span>');
    expect(cpf).toContain('<span class="lab">Chave Pix</span><span class="val">529.982.247-25</span>');
    expect(cpf).not.toContain('class="dp"');
    expect(cpf).not.toContain('***');
    const cnpj = render({ mostrar_dados_bancarios: true }, 4, { ...company, dados_bancarios: { pix: 'a@b.com', documento: '11.222.333/0001-81' } }).html;
    expect(cnpj).toContain('<span class="val">11.222.333/0001-81</span>');
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

  it('obras: só a partir de 6 fotos, sempre em fileiras completas de 3 (6, 9 ou 12); as que sobram não saem', () => {
    const fotosNoHtml = (n: number) => (render({ fotos_obras: fotosObra(n) }).html.match(/<div class="ob">/g) || []).length;
    expect([0, 1, 5].map(fotosNoHtml)).toEqual([0, 0, 0]);
    expect(render({ fotos_obras: fotosObra(5) }).html).not.toContain('Obras realizadas');
    expect([6, 7, 8, 9, 10, 11, 12, 15].map(fotosNoHtml)).toEqual([6, 6, 6, 9, 9, 9, 12, 12]);
    const doze = render({ fotos_obras: fotosObra(12) }).html;
    expect(doze).toContain('Obra 12<');
    const onze = render({ fotos_obras: fotosObra(11) }).html;
    expect(onze).toContain('Obra 9<');
    expect(onze).not.toContain('Obra 10<');
  });

  it('nenhuma combinação de foto do telhado, 12 obras e empresas some com seção; folha extra só quando não cabe', () => {
    const empresas = Array.from({ length: 8 }, (_, i) => ({ url: HTTPS, nome: `Empresa ${i + 1}` }));
    for (const f of [{ foto_telhado_b64: PNG, fotos_obras: fotosObra(12), empresas_atendidas: empresas }, { fotos_obras: fotosObra(9), empresas_atendidas: empresas }]) {
      const html = render(f).html;
      expect(html).toContain('Obras realizadas');
      expect(html).toContain('Empresas atendidas');
      const n = paginas(html);
      for (let i = 2; i <= n; i++) expect(html).toContain(`· ${i}/${n}`);
    }
  });

  it('cronograma do projeto: prazo total, 5 etapas na vertical com desenho, número, título e explicação', () => {
    for (const f of [{}, { assinatura: ASSIN_PF }]) {
      const html = render({ prazo_instalacao_dias: '60', ...f }).html;
      expect(html).toContain('Cronograma do projeto');
      expect(html).toContain('Do contrato à ligação: até 60 dias úteis.');
      expect(html).not.toContain('Etapas até a ligação');
      expect(html).not.toContain('class="prazo"');
      expect((html.match(/<div class="cr">/g) || []).length).toBe(5);
      expect((html.match(/<svg viewBox="0 0 64 64"/g) || []).length).toBe(5);
      const cron = html.slice(html.indexOf('Cronograma do projeto'));
      const ordem = ['Projeto', 'Vistoria técnica', 'Instalação', 'Homologação', 'Ligação'].map((t) => cron.indexOf(`</span>${t}</div>`));
      expect(ordem.every((v, i) => v > 0 && (i === 0 || v > ordem[i - 1]))).toBe(true);
      expect(cron).toContain('O engenheiro dimensiona o sistema pela sua conta de luz e pelo seu telhado. Depois desenha o projeto elétrico e emite a ART, o registro da responsabilidade técnica.');
      expect(cron).toContain('A empresa envia o projeto para a concessionária e acompanha o pedido até a aprovação. Depois a concessionária troca o medidor por um bidirecional.');
      expect(cron).toContain('Com o medidor novo, o sistema é ligado e começa a gerar. A energia que sobra vira crédito na sua conta de luz.');
      // O traço usa as variáveis de cor da proposta, não cor escrita à mão.
      expect(html).toContain('.ln{ fill:none; stroke:var(--c1)');
    }
  });

  it('cronograma ganha folha própria quando não cabe com as garantias (sem aceite, com o rodapé grande); a numeração fecha', () => {
    const html = render({}).html;
    expect(secoes(html)).toEqual(expect.arrayContaining(['Cronograma do projeto', 'Garantias e próximos passos']));
    expect(secoes(html).indexOf('Cronograma do projeto')).toBeLessThan(secoes(html).indexOf('Garantias e próximos passos'));
    const n = paginas(html);
    expect(html).toContain(`· ${n}/${n}`);
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Garantias e próximos passos'));
    // Com aceite cabe tudo na folha de garantias.
    expect(secoes(render({ assinatura: ASSIN_PF }).html)).not.toContain('Cronograma do projeto');
  });

  it('sem assinatura: sem folha de aceite, sem CPF no cabeçalho, rodapé grande na última', () => {
    const { html } = render({});
    expect(secoes(html)).not.toContain('Aceite da proposta');
    expect(html).not.toContain('class="dp"');
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Garantias e próximos passos'));
    expect(paginas(html)).toBe(5);
  });

  it('texto do usuário no aceite e nos dados bancários sai escapado', () => {
    const a = { ...ASSIN_PF, empresa: { ...ASSIN_PF.empresa, razao_social: 'A <b>B</b> Ltda' } };
    const { html } = render({ assinatura: a, mostrar_dados_bancarios: true }, 4, { ...empBanc, dados_bancarios: { pix: '<i>x</i>' } });
    expect(html).not.toContain('<b>B</b>');
    expect(html).not.toContain('<i>x</i>');
    expect(html).toContain('A &lt;b&gt;B&lt;/b&gt; Ltda');
  });
});

// ─── Fio B (Lei 14.300) ─────────────────────────────────────────────────────────────────────────
import { anoCivil, calcularFinanceiro as calcFin, lerFioB, percentualFioB, serieFioB, validarFioB } from '../services/propostaSolarCalculos';

describe('Fio B: contas', () => {
  it('percentual por ano do calendário', () => {
    expect([2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2035].map(percentualFioB)).toEqual([15, 15, 30, 45, 60, 75, 90, 100, 100]);
  });

  it('série: ano 1 é o ano da emissão, reajusta pela tarifa e sobe o percentual', () => {
    const s = serieFioB({ fio: { tarifa: 0.28, pct: 70, simultaneidade: 30 }, geracaoMediaMensal: 756, inflacao: 0.06, anoInicial: 2026 });
    expect(s.percentuais.slice(0, 5)).toEqual([60, 75, 90, 100, 100]);
    const cent = (n: number) => Math.round(n * 100) / 100;
    expect(s.custoMensal[0]).toBe(cent(756 * 0.7 * 0.28 * 1 * 0.6));
    expect(s.custoMensal[1]).toBe(cent(756 * 0.7 * 0.28 * 1.06 * 0.75));
    expect(s.custoMensal[3]).toBe(cent(756 * 0.7 * 0.28 * Math.pow(1.06, 3) * 1));
    expect(s.custoMensal).toHaveLength(25);
  });

  it('com e sem Fio B: sem ele é idêntico ao de sempre; com ele a conta com solar, a economia e o retorno pioram', () => {
    const e = { consumoKwh: 650, tarifa: 1.2, taxaMinima: 90, inflacao: 0.06, inflacaoTaxaMin: 0.06, investimento: 28900 };
    const sem = calcFin(e);
    expect(calcFin({ ...e, fioBMensal: undefined })).toEqual(sem);
    const serie = serieFioB({ fio: { tarifa: 0.28, pct: 70, simultaneidade: 30 }, geracaoMediaMensal: 756, inflacao: 0.06, anoInicial: 2026 });
    const com = calcFin({ ...e, fioBMensal: serie.custoMensal });
    expect(com.contaComSolar).toBeCloseTo(90 + serie.custoMensal[0], 6);
    expect(com.economiaMensal).toBeLessThan(sem.economiaMensal);
    expect(com.economia25).toBeLessThan(sem.economia25);
    expect(com.paybackMeses).toBeGreaterThan(sem.paybackMeses);
    expect(com.semSolarAcum).toEqual(sem.semSolarAcum);
    // O acumulado com solar de 25 anos soma a taxa mínima e o Fio B de cada ano.
    let esperado = 0;
    for (let a = 1; a <= 25; a++) esperado += 90 * 12 * Math.pow(1.06, a - 1) + serie.custoMensal[a - 1] * 12;
    expect(com.comSolarAcum[24]).toBe(Math.round(esperado));
  });

  it('validação: só vale com fio_b_mostrar true; tarifa 0,01 a 2 e parte injetada 1 a 100 (ausente = 70)', () => {
    expect(validarFioB({})).toBeNull();
    expect(validarFioB({ fio_b_mostrar: false, fio_b_tarifa: 99 })).toBeNull();
    const msgTarifa = 'Escreva o valor do Fio B da sua concessionária, em R$ por kWh.';
    const msgPct = 'A parte da geração que vai para a rede tem que ficar entre 1% e 100%.';
    for (const t of [undefined, null, '', 0, 0.009, 2.01, 'abc']) expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: t })).toBe(msgTarifa);
    for (const t of [0.01, 2, '0,28']) expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: t })).toBeNull();
    for (const p of [0, 101, -5, 'x']) expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: p })).toBe(msgPct);
    for (const p of [undefined, null, '', 1, 100, 70]) expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: p })).toBeNull();
    expect(lerFioB({ fio_b_mostrar: true, fio_b_tarifa: '0,28' })).toEqual({ tarifa: 0.28, pct: 70, simultaneidade: 30 });
    expect(lerFioB({ fio_b_mostrar: true, fio_b_tarifa: 5 })).toBeNull();
    expect(lerFioB({ fio_b_tarifa: 0.28 })).toBeNull();
    expect(anoCivil(new Date('2026-11-05T15:00:00.000Z'))).toBe(2026);
    expect(anoCivil(new Date('2027-01-01T01:00:00.000Z'))).toBe(2026); // ainda 31/12 em São Paulo
  });
});

describe('Fio B: modelo 4', () => {
  const FIO = { fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: 70 };
  const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  it('desligado ou ausente: o HTML é idêntico, sem o bloco', () => {
    const sem = render({}).html;
    expect(render({ fio_b_mostrar: false, fio_b_tarifa: 0.28 }).html).toBe(sem);
    expect(sem).not.toContain('Fio B');
  });

  it('ligado: bloco com o texto, a linha da proposta e a faixa de 4 anos a partir do ano da emissão', () => {
    const { html } = render(FIO);
    expect(html).toContain('Fio B (Lei 14.300)');
    expect(html).toContain('Quem instala a partir de 2023 paga uma parte do Fio B sobre a energia que vai para a rede. Essa parte sobe a cada ano até chegar a 100% em 2029.');
    expect(html).toContain(`Nesta proposta: Fio B de ${moeda(0.28)} por kWh e simultaneidade de 30%, então 70% da geração vai para a rede. A economia desta proposta já desconta esse custo.`);
    const faixa = html.slice(html.indexOf('class="fgrid"'));
    expect(['2026', '2027', '2028', '2029'].map((a) => faixa.indexOf(`<div class="a num">${a}</div>`)).every((v, i, arr) => v > 0 && (i === 0 || v > arr[i - 1]))).toBe(true);
    for (const pct of ['60%', '75%', '90%', '100%']) expect(faixa).toContain(`<div class="p num">${pct}</div>`);
    expect((faixa.match(/ por mês<\/div>/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('Taxa mínima da concessionária + Fio B');
    // Emissão em 2028: a faixa começa em 2028.
    const em28 = render({ ...FIO, emitido_em: '2028-03-10T12:00:00.000Z' }).html;
    expect(em28).toContain('<div class="a num">2028</div>');
    expect(em28).toContain('<div class="a num">2031</div>');
  });

  it('os números fecham: conta com solar, economia, retorno, 25 anos e o resumo de WhatsApp usam a mesma conta', () => {
    const sem = render({});
    const com = render(FIO);
    expect(com.html).not.toBe(sem.html);
    // O custo do ano 1 da faixa é o que entra na conta com solar: conta com solar = taxa mínima (90) + custo do ano 1.
    const custo1 = parseFloat((/<div class="a num">2026<\/div>[^]*?<div class="c num">R\$.([\d.,]+) por mês/.exec(com.html) as RegExpExecArray)[1].replace(/\./g, '').replace(',', '.'));
    const contaCom = parseFloat((/Com energia solar<\/div><div class="v num">R\$.([\d.,]+)</.exec(com.html) as RegExpExecArray)[1].replace(/\./g, '').replace(',', '.'));
    expect(contaCom).toBeCloseTo(90 + custo1, 1);
    // "Conta após instalação" da folha 1 mostra o mesmo valor; a economia mensal é conta hoje - conta com solar.
    expect(com.html).toContain(`<div class="k">Conta após instalação</div><div class="v num">${moeda(contaCom)}</div>`);
    const contaHoje = parseFloat((/Hoje você paga<\/div><div class="v num">R\$.([\d.,]+)</.exec(com.html) as RegExpExecArray)[1].replace(/\./g, '').replace(',', '.'));
    const eco = parseFloat((/Economia de R\$.([\d.,]+) todo mês/.exec(com.html) as RegExpExecArray)[1].replace(/\./g, '').replace(',', '.'));
    expect(eco).toBeCloseTo(contaHoje - contaCom, 1);
    expect(com.html).toContain(`<div class="k">Economia mensal</div><div class="v num">${moeda(eco)}</div>`);
    // O resumo do WhatsApp do modelo 4 usa a mesma economia mensal (o do modelo 1 segue sem Fio B).
    const resumoEco = (r?: string) => /Economia: ~R\$.([\d.,]+)\/mês/.exec(String(r))?.[1];
    expect(resumoEco(com.out.resumo)).toBe(eco.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
    expect(resumoEco(sem.out.resumo)).not.toBe(resumoEco(com.out.resumo));
    expect(resumoEco(render(FIO, 1).out.resumo)).toBe(resumoEco(sem.out.resumo));
    // Retorno e 25 anos pioram, e o gráfico e os cartões saem da mesma série.
    const pay = (h: string) => /Tempo de retorno<\/div><div class="v num">([^<]+)</.exec(h)?.[1];
    expect(pay(com.html)).not.toBe(pay(sem.html));
    const ec25 = (h: string) => /Em 25 anos<\/div><div class="v num">([^<]+)</.exec(h)?.[1];
    expect(ec25(com.html)).not.toBe(ec25(sem.html));
    expect(com.html).toContain('A área verde é sua economia');
  });

  it('tarifa inválida com Fio B ligado: o template trata como desligado (o controller devolve 400 antes)', () => {
    expect(render({ fio_b_mostrar: true, fio_b_tarifa: 9 }).html).toBe(render({}).html);
  });

  it('modelos 1, 2 e 3 ignoram o Fio B (byte a byte)', () => {
    for (const m of [1, 2, 3] as const) expect(render(FIO, m).html).toBe(render({}, m).html);
  });
});

// ─── Fio B e economia: defesas e conferências ────────────────────────────────────────────────────
import { numeroFlex, serieFioB as serieFio } from '../services/propostaSolarCalculos';
import { validarFioBNaProposta, MSG_FIO_B_MAIOR_QUE_TARIFA, MSG_FIO_B_SEM_ECONOMIA } from '../services/propostaSolarFioBCheck';

describe('Fio B: leitura de número, centavos e conferência na proposta', () => {
  it('numeroFlex: a regra do formulário (ponto de milhar só com vírgula; leitura estrita)', () => {
    expect([numeroFlex('0,28'), numeroFlex('0.28'), numeroFlex(' 1.000,5 '), numeroFlex(0.3), numeroFlex('2')]).toEqual([0.28, 0.28, 1000.5, 0.3, 2]);
    for (const ruim of ['0,28abc', 'abc', '', '  ', '1,2,3', undefined, null, {}, [], '0,2 8']) expect(Number.isNaN(numeroFlex(ruim))).toBe(true);
    expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: '0,28abc' })).toBe('Escreva o valor do Fio B da sua concessionária, em R$ por kWh.');
    expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: '1.000,5' })).toBe('Escreva o valor do Fio B da sua concessionária, em R$ por kWh.');
    expect(validarFioB({ fio_b_mostrar: true, fio_b_tarifa: '0,28', fio_b_injetada_pct: '70%' })).toBe('A parte da geração que vai para a rede tem que ficar entre 1% e 100%.');
  });

  it('custo mensal do Fio B em centavos; conta com solar + economia = conta de hoje, exato', () => {
    const s = serieFio({ fio: { tarifa: 0.28, pct: 70, simultaneidade: 30 }, geracaoMediaMensal: 803.3333, inflacao: 0.06, anoInicial: 2026 });
    for (const c of s.custoMensal) expect(Math.round(c * 100) / 100).toBe(c);
    const { html } = render({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: 70 });
    const n = (re: RegExp) => Math.round(parseFloat((re.exec(html) as RegExpExecArray)[1].replace(/\./g, '').replace(',', '.')) * 100);
    const hoje = n(/Hoje você paga<\/div><div class="v num">R\$.([\d.,]+)</);
    const com = n(/Com energia solar<\/div><div class="v num">R\$.([\d.,]+)</);
    const eco = n(/Economia de R\$.([\d.,]+) todo mês/);
    expect(com + eco).toBe(hoje);
  });

  it('data de emissão: o ano do Fio B é o ano da data impressa (virada do ano em São Paulo)', () => {
    const { html } = render({ fio_b_mostrar: true, fio_b_tarifa: 0.28, emitido_em: '2027-01-01T01:00:00.000Z' });
    expect(html).toContain('<span class="num">31/12/2026</span>');
    expect(html).toContain('<div class="a num">2026</div>');
    expect(html).toContain('<div class="p num">60%</div>');
  });

  it('conferência: Fio B >= tarifa de energia, e Fio B que zera a economia do ano 1', () => {
    const f = { ...base, fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: 70 };
    expect(validarFioBNaProposta(f, { cidade: 'Sao Jose do Rio Preto', uf: 'SP' })).toBeNull();
    expect(validarFioBNaProposta({ ...f, fio_b_tarifa: 2, fio_b_injetada_pct: 100 })).toBe(MSG_FIO_B_MAIOR_QUE_TARIFA);
    expect(validarFioBNaProposta({ ...f, tarifa_kwh: '0,28' })).toBe(MSG_FIO_B_MAIOR_QUE_TARIFA);
    expect(validarFioBNaProposta({ ...f, tarifa_kwh: '1,00', consumo_kwh: '100', fio_b_tarifa: 0.5, fio_b_injetada_pct: 100 })).toBe(MSG_FIO_B_SEM_ECONOMIA);
    expect(validarFioBNaProposta({ ...f, fio_b_mostrar: false, fio_b_tarifa: 99 })).toBeNull();
    // Sem consumo não há economia para comer.
    expect(validarFioBNaProposta({ ...f, consumo_kwh: '0', fio_b_tarifa: 0.5, tarifa_kwh: '1,00' })).toBeNull();
    // O limite daqui bate com o que o template imprime: com economia, o texto sai; sem, nada de economia.
    expect(render({ fio_b_mostrar: true, fio_b_tarifa: 0.28 }).html).toContain('todo mês');
    const sem = render({ tarifa_kwh: '1,00', consumo_kwh: '100', fio_b_mostrar: true, fio_b_tarifa: 0.5, fio_b_injetada_pct: 100 }).html;
    expect(sem).not.toContain('todo mês');
  });

  it('defesa: economia mensal ou de 25 anos <= 0 não mostra frase, cartões, faixa, gráfico, destaque nem retorno', () => {
    const casos = [
      { fio_b_mostrar: true, fio_b_tarifa: 2, fio_b_injetada_pct: 100 },
      { consumo_kwh: '20' }, // conta de hoje menor que a taxa mínima, sem Fio B
    ];
    for (const f of casos) {
      const { html } = render(f);
      for (const t of ['todo mês', 'o sistema se paga sozinho', 'Em 1 ano', 'Em 25 anos', 'a mais no seu bolso', 'A área verde', 'Sua economia em 25 anos', 'Economia em 25 anos', 'Tempo de retorno', 'Economia mensal']) {
        expect(html).not.toContain(t);
      }
      expect(html).not.toContain('>—<');
      expect(html).toContain('Conta após instalação');
      expect(html).toContain('Geração estimada mês a mês');
    }
  });

  it('economia positiva mas sem retorno em 25 anos: o cartão de retorno some (nunca "—"), o resto fica', () => {
    const { html } = render({ investimento: '99.999.999,00' });
    expect(html).not.toContain('Tempo de retorno');
    expect(html).not.toContain('>—<');
    expect(html).toContain('Economia mensal');
    expect(html).toContain('grid-template-columns:repeat(2,1fr)');
    expect(html).not.toContain('o sistema se paga sozinho');
  });

  it('sem consumo com Fio B: a explicação do Fio B aparece (a conta após instalação leva o Fio B), sem a frase da economia', () => {
    const { html } = render({ consumo_kwh: '0', fio_b_mostrar: true, fio_b_tarifa: 0.28 });
    expect(html).toContain('Taxa mínima + Fio B');
    expect(html).toContain('Fio B (Lei 14.300)');
    expect(html).toContain('Nesta proposta: Fio B de');
    expect(html).not.toContain('A economia desta proposta já desconta esse custo.');
    expect(render({ fio_b_mostrar: true, fio_b_tarifa: 0.28 }).html).toContain('A economia desta proposta já desconta esse custo.');
  });

  it('fotos inválidas saem ANTES do limite de 12; legendas e nomes limitados a 2 linhas', () => {
    const ruins = Array.from({ length: 12 }, (_, i) => ({ url: 'javascript:alert(1)', legenda: `Ruim ${i}` }));
    const { html } = render({ fotos_obras: [...ruins, ...fotosObra(6)] });
    expect((html.match(/<div class="ob">/g) || []).length).toBe(6);
    expect(html).not.toContain('Ruim');
    expect(html).toContain('-webkit-line-clamp:2');
  });

  it('telhado + 12 obras + 12 empresas: tudo aparece, a numeração fecha e a combinação dá o menor número de folhas', () => {
    const empresas = Array.from({ length: 12 }, (_, i) => ({ url: HTTPS, nome: 'Empresa com nome bem comprido ' + i }));
    const html = render({ foto_telhado_b64: PNG, fotos_obras: fotosObra(12, (i) => 'L'.repeat(80) + i), empresas_atendidas: empresas, assinatura: ASSIN_BASE }).html;
    expect(html).toContain('Local da instalação');
    expect((html.match(/<div class="ob">/g) || []).length).toBe(12);
    expect((html.match(/<div class="em">/g) || []).length).toBe(12);
    const n = paginas(html);
    for (let i = 2; i <= n; i++) expect(html).toContain(`· ${i}/${n}`);
    // Com tudo isso, o número de folhas de "confiança" é o menor possível entre as combinações de altura.
    const sem = render({ fotos_obras: fotosObra(12), assinatura: ASSIN_BASE }).html;
    expect(n - paginas(sem)).toBeLessThanOrEqual(2);
  });
});
const ASSIN_BASE = {
  empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio' },
  cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
};

// ─── Fio B: simultaneidade (barra de 0% a 100%) ──────────────────────────────────────────────────
describe('Fio B: simultaneidade', () => {
  const FIO_S = (s: unknown) => ({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_simultaneidade_pct: s });
  const FIO_ANTIGO = { fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: 70 };

  it('conversão: simultaneidade vence; sem ela vale a injetada de antes; sem nenhuma, 30% (injetada 70%)', () => {
    expect(lerFioB({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_simultaneidade_pct: 40 })).toEqual({ tarifa: 0.28, pct: 60, simultaneidade: 40 });
    expect(lerFioB({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_injetada_pct: 80 })).toEqual({ tarifa: 0.28, pct: 80, simultaneidade: 20 });
    expect(lerFioB({ fio_b_mostrar: true, fio_b_tarifa: 0.28 })).toEqual({ tarifa: 0.28, pct: 70, simultaneidade: 30 });
    // As duas chaves juntas: a simultaneidade é quem manda.
    expect(lerFioB({ fio_b_mostrar: true, fio_b_tarifa: 0.28, fio_b_simultaneidade_pct: 10, fio_b_injetada_pct: 50 })).toEqual({ tarifa: 0.28, pct: 90, simultaneidade: 10 });
    expect(lerFioB(FIO_S('25'))).toEqual({ tarifa: 0.28, pct: 75, simultaneidade: 25 });
  });

  it('extremos: 0% (tudo vai para a rede) e 100% (nada vai, custo zero)', () => {
    expect(lerFioB(FIO_S(0))).toEqual({ tarifa: 0.28, pct: 100, simultaneidade: 0 });
    expect(lerFioB(FIO_S(100))).toEqual({ tarifa: 0.28, pct: 0, simultaneidade: 100 });
    const zero = serieFioB({ fio: { tarifa: 0.28, pct: 0, simultaneidade: 100 }, geracaoMediaMensal: 800, inflacao: 0.06, anoInicial: 2026 });
    expect(zero.custoMensal.every((c) => c === 0)).toBe(true);
    const tudo = serieFioB({ fio: { tarifa: 0.28, pct: 100, simultaneidade: 0 }, geracaoMediaMensal: 800, inflacao: 0.06, anoInicial: 2026 });
    expect(tudo.custoMensal[0]).toBe(Math.round(800 * 0.28 * 0.6 * 100) / 100);
  });

  it('validação: inteira de 0 a 100, senão 400 com a frase; 100% é válido', () => {
    const msg = 'A simultaneidade tem que ficar entre 0% e 100%.';
    for (const s of [-1, 101, 30.5, 'abc', '30%', 1000]) expect(validarFioB(FIO_S(s))).toBe(msg);
    for (const s of [0, 1, 30, 99, 100, '70', undefined, null, '']) expect(validarFioB(FIO_S(s))).toBeNull();
    expect(validarFioB({ fio_b_mostrar: false, fio_b_tarifa: 0.28, fio_b_simultaneidade_pct: 500 })).toBeNull();
    // Com simultaneidade, a injetada antiga é ignorada na validação.
    expect(validarFioB({ ...FIO_S(30), fio_b_injetada_pct: 500 })).toBeNull();
    expect(lerFioB(FIO_S(101))).toBeNull();
  });

  it('texto do bloco: simultaneidade e parte que vai para a rede; com 100%, nada vai e não há custo', () => {
    const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const html40 = render(FIO_S(40)).html;
    expect(html40).toContain(`Nesta proposta: Fio B de ${moeda(0.28)} por kWh e simultaneidade de 40%, então 60% da geração vai para a rede. A economia desta proposta já desconta esse custo.`);
    expect(html40).not.toContain('sobre 70% da geração');
    const html100 = render(FIO_S(100)).html;
    expect(html100).toContain(`Nesta proposta: Fio B de ${moeda(0.28)} por kWh e simultaneidade de 100%, então nada vai para a rede e não há custo de Fio B. A economia desta proposta já desconta esse custo.`);
    expect(html100).toContain('R$' + NB + '0,00 por mês');
    // Sem consumo (sem economia), a frase da economia não entra.
    const semEco = render({ ...FIO_S(100), consumo_kwh: '0' }).html;
    expect(semEco).toContain('então nada vai para a rede e não há custo de Fio B.</div>');
  });

  it('simultaneidade 30 = números idênticos ao de antes (injetada 70, ou nenhuma das duas)', () => {
    const antigo = render(FIO_ANTIGO);
    const nova = render(FIO_S(30));
    const padrao = render({ fio_b_mostrar: true, fio_b_tarifa: 0.28 });
    expect(nova.html).toBe(antigo.html);
    expect(padrao.html).toBe(antigo.html);
    expect(nova.out.resumo).toBe(antigo.out.resumo);
  });

  it('simultaneidade maior = custo menor, economia maior; o resumo de WhatsApp acompanha', () => {
    const eco = (r: { html: string }) => parseFloat((/Economia de R\$.([\d.,]+) todo mês/.exec(r.html) as RegExpExecArray)[1].replace(/\./g, '').replace(',', '.'));
    const a = render(FIO_S(0));
    const b = render(FIO_S(30));
    const c = render(FIO_S(100));
    expect(eco(a)).toBeLessThan(eco(b));
    expect(eco(b)).toBeLessThan(eco(c));
    const resumo = (r: { out: { resumo?: string } }) => /Economia: ~R\$.([\d.,]+)\/mês/.exec(String(r.out.resumo))?.[1];
    expect(resumo(a)).not.toBe(resumo(c));
    // Com 100% o Fio B não tira nada: a economia é a mesma de sem Fio B.
    expect(eco(c)).toBe(eco(render({})));
  });

  it('a conferência "Fio B que zera a economia" continua valendo com a simultaneidade', () => {
    const f = { ...base, tarifa_kwh: '1,00', consumo_kwh: '100', fio_b_mostrar: true, fio_b_tarifa: 0.5 };
    expect(validarFioBNaProposta({ ...f, fio_b_simultaneidade_pct: 0 })).toBe(MSG_FIO_B_SEM_ECONOMIA);
    expect(validarFioBNaProposta({ ...f, fio_b_simultaneidade_pct: 100 })).toBeNull();
  });
});
