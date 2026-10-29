import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { codigoVistoria, cortar, dataBR, dataHoraAs, esc, horaBR, ucfirst, urlPublica } from '../services/relatorio/base';
import { MARGEM_PDF_MM, opcoesPdfComRodape } from '../services/relatorio/pdf';

// Base compartilhada dos relatórios: texto, datas em horário de Brasília, links e rodapé do PDF.
// Tudo função pura, sem banco. Dados inventados.

describe('esc', () => {
  it('escapa os cinco caracteres: & < > " e o apóstrofo', () => {
    expect(esc(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
  it('null, undefined e número viram texto, sem quebrar', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
    expect(esc(12)).toBe('12');
  });
  it('não deixa tag viva nem fechar atributo entre aspas simples', () => {
    const s = esc(`<img src=x onerror="a(1)"> d'agua`);
    expect(s).not.toMatch(/[<>"']/);
    expect(s).toContain('d&#39;agua');
  });
});

describe('ucfirst', () => {
  it('põe a primeira letra em maiúscula e deixa o resto', () => {
    expect(ucfirst('painel sujo')).toBe('Painel sujo');
    expect(ucfirst('água na caixa')).toBe('Água na caixa');
    expect(ucfirst('Já está certo')).toBe('Já está certo');
    expect(ucfirst('1 item')).toBe('1 item');
  });
  it('pula o espaço do começo, que o HTML não mostra', () => {
    expect(ucfirst('  painel')).toBe('  Painel');
  });
  it('vazio, só espaço e nulo não quebram', () => {
    expect(ucfirst('')).toBe('');
    expect(ucfirst('   ')).toBe('   ');
    expect(ucfirst(null)).toBe('');
    expect(ucfirst(undefined)).toBe('');
  });
});

describe('cortar', () => {
  it('texto curto fica como está, e o do tamanho exato também', () => {
    expect(cortar('Solar', 10)).toBe('Solar');
    expect(cortar('1234567890', 10)).toBe('1234567890');
  });
  it('texto longo cabe em n caracteres, contando as reticências', () => {
    const r = cortar('Solar Energia Ltda', 10);
    expect(r).toBe('Solar Ene…');
    expect(Array.from(r)).toHaveLength(10);
  });
  it('tira o espaço que sobraria antes das reticências', () => {
    expect(cortar('Solar Energia', 7)).toBe('Solar…');
  });
  it('nulo e limite inválido devolvem vazio', () => {
    expect(cortar(null, 10)).toBe('');
    expect(cortar(undefined, 10)).toBe('');
    expect(cortar('abc', 0)).toBe('');
    expect(cortar('abc', -1)).toBe('');
    expect(cortar('abc', NaN)).toBe('');
  });
  it('limite 1 deixa só as reticências', () => {
    expect(cortar('abc', 1)).toBe('…');
  });
  it('não parte um caractere de dois códigos ao meio', () => {
    const carinha = '\u{1F600}';
    expect(cortar(`ab${carinha}cd`, 4)).toBe(`ab${carinha}…`);
  });
});

describe('datas em America/Sao_Paulo', () => {
  it('converte UTC para o horário de Brasília', () => {
    expect(dataBR('2026-10-27T15:00:00Z')).toBe('27/10/2026');
    expect(horaBR('2026-10-27T15:00:00Z')).toBe('12:00');
    expect(dataHoraAs('2026-10-27T15:00:00Z')).toBe('27/10/2026 às 12:00');
  });
  it('a virada do dia usa o fuso: 02h30 UTC ainda é o dia anterior em Brasília', () => {
    expect(dataBR('2026-10-28T02:30:00Z')).toBe('27/10/2026');
    expect(horaBR('2026-10-28T02:30:00Z')).toBe('23:30');
  });
  it('meia-noite sai 00:00, nunca 24:00', () => {
    expect(horaBR('2026-10-27T03:00:00Z')).toBe('00:00');
    expect(dataHoraAs('2026-10-27T03:00:00Z')).toBe('27/10/2026 às 00:00');
  });
  it('entende o fuso escrito no texto e o formato que o banco devolve', () => {
    expect(dataHoraAs('2026-10-27T12:00:00-03:00')).toBe('27/10/2026 às 12:00');
    expect(dataHoraAs('2026-10-27T15:00:00.123456+00:00')).toBe('27/10/2026 às 12:00');
  });
  it('em 2026 não há horário de verão: verão e inverno têm o mesmo deslocamento', () => {
    expect(horaBR('2026-01-15T12:00:00Z')).toBe('09:00');
    expect(horaBR('2026-07-15T12:00:00Z')).toBe('09:00');
  });
  it('aceita Date', () => {
    expect(dataHoraAs(new Date(Date.UTC(2026, 9, 27, 15, 0)))).toBe('27/10/2026 às 12:00');
  });
  it('data inválida devolve vazio nas três funções', () => {
    const ruins = [undefined, null, '', '   ', 'abc', '27/10/2026', '2026-13-45T00:00:00Z', '2026-10-27T25:00:00Z', '2026-02-30T10:00:00Z', '2026-02-30', new Date('x')];
    for (const r of ruins) {
      expect([dataBR(r), horaBR(r), dataHoraAs(r)], String(r)).toEqual(['', '', '']);
    }
  });
  it('texto só com a data não muda de dia por causa do fuso', () => {
    expect(dataBR('2026-10-27')).toBe('27/10/2026');
    expect(horaBR('2026-10-27')).toBe('');
    expect(dataHoraAs('2026-10-27')).toBe('27/10/2026');
  });
});

describe('urlPublica', () => {
  let guardado: string | undefined;
  beforeEach(() => { guardado = process.env.DASHBOARD_URL; delete process.env.DASHBOARD_URL; });
  afterEach(() => {
    if (guardado === undefined) delete process.env.DASHBOARD_URL; else process.env.DASHBOARD_URL = guardado;
  });

  it('sem DASHBOARD_URL usa o endereço padrão', () => {
    expect(urlPublica('v', 'x')).toBe('https://solardoc.app/v/x');
    expect(urlPublica('m', 'abc')).toBe('https://solardoc.app/m/abc');
  });
  it('com DASHBOARD_URL tira espaço e barras do fim', () => {
    process.env.DASHBOARD_URL = ' https://exemplo.test/// ';
    expect(urlPublica('v', 'abc')).toBe('https://exemplo.test/v/abc');
  });
  it('DASHBOARD_URL só com espaço volta ao padrão', () => {
    process.env.DASHBOARD_URL = '   ';
    expect(urlPublica('v', 'x')).toBe('https://solardoc.app/v/x');
  });
});

describe('codigoVistoria', () => {
  it('usa os 8 primeiros caracteres do id, sem hífen', () => {
    expect(codigoVistoria('11111111-1111-4111-8111-111111111111')).toBe('VT-11111111');
  });
  it('põe em maiúscula', () => {
    expect(codigoVistoria('abcdef12-3456-4789-8abc-def012345678')).toBe('VT-ABCDEF12');
  });
});

describe('opcoesPdfComRodape', () => {
  it('A4 em pé, fundo impresso, margem do @page e rodapé ligado', () => {
    const o = opcoesPdfComRodape({ esquerda: 'Empresa · VT-11111111 · Maria' });
    expect(o).toMatchObject({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
    });
  });
  it('a margem é a mesma dos dois relatórios: 14, 16 e 18 mm', () => {
    expect(MARGEM_PDF_MM).toEqual({ topo: 14, lados: 16, base: 18 });
  });
  it('o rodapé traz a página, o corpo de 10,5 px e o recuo igual à margem lateral', () => {
    const f = opcoesPdfComRodape({ esquerda: 'Empresa' }).footerTemplate;
    expect(f).toContain('class="pageNumber"');
    expect(f).toContain('class="totalPages"');
    expect(f).toContain('Página <span class="pageNumber"></span> de <span class="totalPages"></span>');
    expect(f).toContain('font-size:10.5px');
    expect(f).toContain('padding:0 16mm');
  });
  it('escapa o texto da esquerda: aspas, menor que, e comercial e apóstrofo', () => {
    const f = opcoesPdfComRodape({ esquerda: `Empresa "A" <b>x</b> & Cia's` }).footerTemplate;
    expect(f).toContain('Empresa &quot;A&quot; &lt;b&gt;x&lt;/b&gt; &amp; Cia&#39;s');
    expect(f).not.toContain('<b>');
  });
  it('texto da esquerda vazio não tira a página do rodapé', () => {
    const f = opcoesPdfComRodape({ esquerda: '' }).footerTemplate;
    expect(f).toContain('pageNumber');
    expect(f).toContain('totalPages');
  });
  it('sem travessão nem emoji no rodapé', () => {
    const f = opcoesPdfComRodape({ esquerda: 'Empresa' }).footerTemplate;
    // Os dois travessões (U+2013 e U+2014) montados pelo código, para o arquivo não carregar nenhum.
    const travessoes = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
    expect(f).not.toMatch(travessoes);
    expect(f).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('pureza dos módulos de relatorio/', () => {
  // Os templates importam estes arquivos e os renders compilam só o que os templates importam:
  // se um deles puxar supabase ou logger, o render e os testes de HTML deixam de funcionar.
  const lerFonte = (nome: string) => readFileSync(join(__dirname, '..', 'services', 'relatorio', `${nome}.ts`), 'utf8');
  const IMPORTA_BANCO = /(?:from\s+|require\()\s*['"][^'"]*\b(?:supabase|logger)\b[^'"]*['"]/;

  for (const nome of ['base', 'marca', 'fotos', 'pdf']) {
    it(`${nome}.ts não importa supabase nem logger`, () => {
      expect(lerFonte(nome)).not.toMatch(IMPORTA_BANCO);
    });
  }
  it('marcaDb.ts é o único que importa supabase e logger', () => {
    const fonte = lerFonte('marcaDb');
    expect(fonte).toMatch(/from\s+'\.\.\/\.\.\/utils\/supabase'/);
    expect(fonte).toMatch(/from\s+'\.\.\/\.\.\/utils\/logger'/);
  });
});
