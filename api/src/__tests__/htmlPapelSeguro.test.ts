import { describe, it, expect } from 'vitest';
import { limparHtmlPapel } from '../services/gerador/htmlPapelSeguro';

// O HTML de um papel guardado no servidor é impresso por OUTRA pessoa: nada que execute código pode sobrar, e o papel normal
// tem de sair idêntico, byte a byte. Dados fictícios.

const PERIGOS = /<script|<iframe|<object|<embed|<base|http-equiv|\son[a-z]+\s*=|srcdoc|javascript:|vbscript:|data:text/i;

describe('limparHtmlPapel', () => {
  it('tira script (com o conteúdo), iframe, object, embed e base', () => {
    const r = limparHtmlPapel('<p>a</p><script>alert(1)</script><SCRIPT src=x></SCRIPT><iframe src="https://x"></iframe><object data="x"></object><embed src="x"><base href="https://x"><p>b</p>');
    expect(r).toBe('<p>a</p><p>b</p>');
  });

  it('tira atributos on*, mesmo disfarçados, e o srcdoc', () => {
    const r = limparHtmlPapel('<img src="x.png" onerror="alert(1)"><div ONCLICK=alert(1) class="a">t</div><img/src=x/onerror=alert(1)><svg onload="x()"><circle/></svg><p srcdoc="<script>1</script>" id="k">z</p>');
    expect(r).not.toMatch(PERIGOS);
    expect(r).toContain('<img src="x.png">');
    expect(r).toContain('class="a"');
    expect(r).toContain('id="k"');
  });

  it('tira javascript:, vbscript: e data: que não seja imagem, inclusive com entidades e espaços escondidos', () => {
    const r = limparHtmlPapel([
      '<a href="javascript:alert(1)">1</a>',
      '<a href=" JaVa\tScRiPt:alert(1)">2</a>',
      '<a href="&#106;avascript&colon;alert(1)">3</a>',
      '<a href="&#x6A;&#x61;vascript:alert(1)">4</a>',
      '<a href="vbscript:msgbox(1)">5</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD4=">6</a>',
      '<img src="data:text/html,<script>1</script>">',
      '<img srcset="https://ok/a.png 1x, javascript:alert(1) 2x">',
    ].join(''));
    expect(r).not.toMatch(PERIGOS);
    expect(r).toContain('>1</a>');
    expect(r).toContain('>6</a>');
  });

  it('tira meta http-equiv e link que não é stylesheet; comentários também', () => {
    const r = limparHtmlPapel('<meta http-equiv="refresh" content="0;url=https://x"><meta charset="utf-8"><link rel="import" href="https://x"><link rel="stylesheet" href="https://x/a.css"><!--[if IE]><script>1</script><![endif]--><p>x</p>');
    expect(r).toBe('<meta charset="utf-8"><link rel="stylesheet" href="https://x/a.css"><p>x</p>');
  });

  it('style com @import, expression() ou url(javascript:) é limpo; style comum fica', () => {
    const r = limparHtmlPapel('<style>@import url(https://x/a.css);.a{width:expression(alert(1));background:url(javascript:alert(2))}.b{color:red}</style><p style="width:expression(alert(1))">1</p><p style="color:red">2</p>');
    expect(r).not.toMatch(/@import|expression|javascript/i);
    expect(r).toContain('.b{color:red}');
    expect(r).toContain('<p style="color:red">2</p>');
  });

  it('o papel normal sai IGUAL, byte a byte: texto, estilos, tabelas, imagens e classes', () => {
    const normal = '<div class="ep-doc"><style>@page{size:A4;margin:0}.ep-page{width:210mm;min-height:297mm}.a>.b{color:#0B1A2B}</style>'
      + '<div class="ep-page"><img class="sol-logo" src="/gerador/logo.png" alt="Irmãos na Obra"><img src="data:image/png;base64,iVBORw0KGgo=" alt="">'
      + '<h1>Contrato nº 001/2026 · R$ 12.345,67 &amp; 3 &lt; 4</h1><table class="t" style="width:100%"><tr><td colspan="2">x &nbsp; y</td></tr></table>'
      + '<p>Linha<br/>seguinte <span class="ep-rec-vazio"></span> 5 < 6 e a > b.</p><a href="https://irmaosnaobra.com.br/p?x=1&y=2">link</a><a href="#cl-3">ref</a>'
      + '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></div></div>';
    expect(limparHtmlPapel(normal)).toBe(normal);
  });

  it('tag que não fecha ou lixo solto não derruba nem deixa passar', () => {
    expect(() => limparHtmlPapel('<div <<<>>> <img src="x" onerror="1')).not.toThrow();
    expect(limparHtmlPapel('<img src="x" onerror="1')).not.toMatch(/onerror/);
    expect(limparHtmlPapel('a < b')).toBe('a < b');
    expect(limparHtmlPapel('')).toBe('');
  });
  // Os 9 ataques da revisão: nenhum pode sair com script, atributo on*, javascript:, animação de atributo ou <style> em svg/math.
  const NBSP = String.fromCharCode(160);
  const ataques: Array<[string, string]> = [
    ['style dentro de svg lido como marcação', '<svg><style><img src=x onerror=alert(1)></style></svg>'],
    ['style dentro de math lido como marcação', '<math><style><img src=x onerror=alert(1)></style></math>'],
    ['NBSP não separa atributo (valor sem aspas)', `<img src=x${NBSP}onerror=alert(1)><a href=javascript:alert(1)${NBSP}>l</a>`],
    ['title tem texto cru para o navegador', '<title><img src=x onerror=alert(1)></title><p>t</p>'],
    ['textarea tem texto cru para o navegador', '<textarea><img src=x onerror=alert(1)></textarea>'],
    ['entidade hexadecimal com zeros à esquerda', '<a href="&#x000006A;avascript:alert(1)">e</a>'],
    ['entidade decimal com zeros à esquerda', '<a href="&#0000106;avascript:alert(1)">e</a>'],
    ['animate muda o href para javascript:', '<svg><a href="#"><animate attributeName="href" values="javascript:alert(1)" begin="0s" fill="freeze"/><text>x</text></a></svg>'],
    ['set põe um on* por fora', '<svg><circle r="5"><set attributeName="onmouseover" to="alert(1)"/></circle></svg>'],
  ];
  it.each(ataques)('ataque da revisão sai sem script: %s', (_nome, html) => {
    const r = limparHtmlPapel(html);
    // Atributo só existe depois de espaço ASCII: com NBSP o onerror é parte do valor do src, e o navegador o lê assim.
    expect(r).not.toMatch(/<script|<iframe|<object|<embed|<base|http-equiv|[\t\n\f\r /]on[a-z]+[\t\n\f\r ]*=|srcdoc|javascript:|vbscript:|data:text/i);
    expect(r).not.toMatch(/<(animate|animatetransform|set|title|textarea|noscript)[\s/>]/i);
    expect(r).not.toMatch(/<(svg|math)[^>]*>[\s\S]*<style/i);
    expect(r).not.toMatch(/[\t\n\f\r /]on(error|mouseover)=|javascript/i);
  });

  it('href/xlink:href com data:image/svg+xml (um <use> carrega um SVG com script) é recusado, inclusive disfarçado; data:image raster segue', () => {
    const SVG = 'data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cscript%3Ealert(1)%3C/script%3E%3C/svg%3E';
    const casos = [`<svg><use href="${SVG}#a"/></svg>`, `<svg><use xlink:href="${SVG}#a"/></svg>`, '<svg><use href="data&colon;image/svg+xml,x"/></svg>',
      '<svg><use href="DATA:IMAGE/SVG+XML;base64,AAAA"/></svg>', '<svg><use href=" da	ta:image/svg+xml,x"/></svg>', `<a href="${SVG}">x</a>`];
    for (const c of casos) expect(limparHtmlPapel(c), c).not.toMatch(/data:image\/svg|data&colon;|DATA:IMAGE|da	ta/i);
    expect(limparHtmlPapel('<img src="data:image/png;base64,AAAA" alt="x">')).toBe('<img src="data:image/png;base64,AAAA" alt="x">');
    expect(limparHtmlPapel('<svg><use href="#forma"/></svg>')).toBe('<svg><use href="#forma"/></svg>');
  });
  it('<style> comum fora de svg continua intacto, e o de dentro de svg perde só a tag', () => {
    expect(limparHtmlPapel('<style>.a{color:red}</style>')).toBe('<style>.a{color:red}</style>');
    expect(limparHtmlPapel('<svg><style>.a{fill:red}</style><path d="M0 0"/></svg>')).toBe('<svg>.a{fill:red}<path d="M0 0"/></svg>');
    expect(limparHtmlPapel('<svg></svg><style>.b{color:blue}</style>')).toBe('<svg></svg><style>.b{color:blue}</style>');
  });
});
