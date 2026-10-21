// Limpeza do HTML de um papel guardado no servidor, porque OUTRA pessoa vai imprimi-lo (versões salvas no card).
//
// Não é o `sanitizarHtmlContrato` (contratoIa.ts): aquele ESCAPA todo marcador, serve para texto de cláusula. Aqui o papel
// inteiro é HTML de verdade (tabelas, estilos, classes, imagens), e o que sai tem de ser idêntico ao que entrou, byte a byte,
// quando não há nada perigoso: só se reescreve uma tag que perdeu algo, e as demais seguem exatamente como vieram.
//
// Sai: <script> (com o conteúdo), <iframe>, <object>, <embed>, <applet>, <base>, <frame>, <frameset>, <meta http-equiv>,
// <link> que não seja stylesheet, <xmp>, <plaintext>, <title>, <textarea>, <noscript>, <animate>/<set>/<animateTransform> (só a tag; o
// conteúdo segue e é limpo como marcação), <style> dentro de <svg>/<math> (lá é marcação, não CSS), comentários (inclusive condicionais), declarações <!...> estranhas,
// todo atributo on*, `srcdoc`, e URL com esquema `javascript:`, `vbscript:` ou `data:` que não seja `data:image/`.
// Fica: <style>, classes, ids, <img> com https:, http: ou data:image.
// Defesa em profundidade: a tela ainda imprime esse HTML num iframe sem scripts.

// Fora com a tag (o conteúdo, se houver, segue e é limpo como marcação): o navegador trata o conteúdo de title, textarea, noscript e
// afins como texto cru ou como marcação conforme o contexto, e apagar a tag tira a dúvida. Animações SVG mudam atributos (href,
// on*) por fora da limpeza dos atributos: saem também.
const TAGS_FORA = new Set(['iframe', 'object', 'embed', 'applet', 'base', 'frame', 'frameset', 'xmp', 'plaintext', 'noembed', 'noframes', 'noscript',
  'title', 'textarea', 'animate', 'set', 'animatetransform', 'animatemotion', 'discard']);
/** Espaço do HTML: só estes cinco. U+00A0 e os outros NÃO separam nome de atributo. */
const ws = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
const FIM_NOME = /[\t\n\f\r =>/]/;
const FIM_VALOR = /[\t\n\f\r >]/;
const ATRIBUTOS_URL = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'data', 'srcset', 'ping', 'codebase', 'manifest', 'longdesc', 'cite', 'lowsrc', 'dynsrc']);

const ENTIDADES: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', quot: '"', amp: '&', apos: "'", nbsp: ' ' };
function decodificar(v: string): string {
  return v
    .replace(/&#x0*([0-9a-f]{1,6});?/gi, (_m, h: string) => { const n = parseInt(h, 16); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
    .replace(/&#0*(\d{1,7});?/g, (_m, d: string) => { const n = Number(d); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
    .replace(/&([a-z]{2,8});?/gi, (m, nome: string) => ENTIDADES[nome.toLowerCase()] ?? m);
}
/** O valor como o navegador o leria: sem entidades, sem espaço nem caractere de controle, minúsculo. */
// Os caracteres que o navegador ignora dentro do esquema da URL (java	script: vale como javascript:).
const FAIXAS_IGNORADAS: Array<[number, number]> = [[0, 0x20], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]];
const IGNORADOS = new RegExp('[' + FAIXAS_IGNORADAS.map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('') + ']', 'g');
const normalizarUrl = (v: string): string => decodificar(v).replace(IGNORADOS, '').toLowerCase();

function urlPerigosa(v: string): boolean {
  const u = normalizarUrl(v);
  if (/^(javascript|vbscript|livescript|mocha):/.test(u)) return true;
  if (/^data:/.test(u)) return !/^data:image\//.test(u);
  return false;
}
/** `<use href="data:image/svg+xml,...">` carrega um SVG com script como documento: em href/xlink:href só `data:` de imagem raster passa. */
const urlSvgEmHref = (v: string): boolean => /^data:image\/svg/.test(normalizarUrl(v));
/** `srcset` é uma lista de URLs: qualquer uma perigosa derruba o atributo. */
const srcsetPerigoso = (v: string): boolean => v.split(',').some((p) => urlPerigosa(p.trim().split(/\s+/)[0] ?? ''));

const cssPerigoso = (v: string): boolean => /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|@import/i.test(decodificar(v).replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16) || 32)));

interface Atributo { nome: string; valor: string | null; bruto: string }

/** Lê os atributos de uma tag a partir de `i` (logo depois do nome). Devolve onde a tag acaba (depois do `>`). */
function lerAtributos(h: string, i: number): { atributos: Atributo[]; fim: number; autoFecha: boolean } | null {
  const atributos: Atributo[] = [];
  const n = h.length;
  let autoFecha = false;
  while (i < n) {
    const ini = i;
    while (i < n && ws(h[i])) i++;
    if (i >= n) return null;
    if (h[i] === '>') return { atributos, fim: i + 1, autoFecha };
    if (h[i] === '/') {
      let j = i + 1;
      while (j < n && ws(h[j])) j++;
      if (h[j] === '>') { autoFecha = true; return { atributos, fim: j + 1, autoFecha }; }
      i++;
      atributos.push({ nome: '', valor: null, bruto: h.slice(ini, i) });
      continue;
    }
    const iniNome = i;
    while (i < n && !FIM_NOME.test(h[i])) i++;
    if (i === iniNome) { i++; atributos.push({ nome: '', valor: null, bruto: h.slice(ini, i) }); continue; }
    const nome = h.slice(iniNome, i).toLowerCase();
    let j = i;
    while (j < n && ws(h[j])) j++;
    let valor: string | null = null;
    if (h[j] === '=') {
      j++;
      while (j < n && ws(h[j])) j++;
      if (h[j] === '"' || h[j] === "'") {
        const q = h[j];
        const f = h.indexOf(q, j + 1);
        if (f < 0) return null;
        valor = h.slice(j + 1, f);
        i = f + 1;
      } else {
        const iniV = j;
        while (j < n && !FIM_VALOR.test(h[j])) j++;
        valor = h.slice(iniV, j);
        i = j;
      }
    }
    atributos.push({ nome, valor, bruto: h.slice(ini, i) });
  }
  return null;
}

function atributoPerigoso(a: Atributo): boolean {
  const nome = a.nome;
  if (!nome) return false;
  if (nome.startsWith('on') || nome === 'srcdoc') return true;
  const v = a.valor ?? '';
  if (ATRIBUTOS_URL.has(nome)) {
    if ((nome === 'href' || nome === 'xlink:href') && urlSvgEmHref(v)) return true;
    return nome === 'srcset' ? srcsetPerigoso(v) : urlPerigosa(v);
  }
  if (nome === 'style') return cssPerigoso(v);
  return false;
}

/** O HTML do papel sem script e sem o que executa código. Idêntico ao que entrou quando não há nada a tirar. */
export function limparHtmlPapel(entrada: string): string {
  const h = String(entrada ?? '');
  const n = h.length;
  let saida = '';
  let i = 0;
  let estrangeiro = 0;   // dentro de <svg>/<math> o navegador lê <style> como marcação, não como CSS
  while (i < n) {
    const lt = h.indexOf('<', i);
    if (lt < 0) { saida += h.slice(i); break; }
    saida += h.slice(i, lt);
    i = lt;
    // Comentário (inclui os condicionais): sai inteiro.
    if (h.startsWith('<!--', i)) {
      const f = h.indexOf('-->', i + 4);
      i = f < 0 ? n : f + 3;
      continue;
    }
    // <!doctype> passa; qualquer outra declaração ou CDATA sai.
    if (h[i + 1] === '!' || h[i + 1] === '?') {
      if (/^<!doctype[\t\n\f\r ]/i.test(h.slice(i, i + 10))) {
        const f = h.indexOf('>', i);
        const fim = f < 0 ? n : f + 1;
        saida += h.slice(i, fim); i = fim;
      } else {
        const f = h.indexOf('>', i);
        i = f < 0 ? n : f + 1;
      }
      continue;
    }
    const fechando = h[i + 1] === '/';
    const iniNome = i + (fechando ? 2 : 1);
    const m = /^[a-zA-Z][^\t\n\f\r />]*/.exec(h.slice(iniNome, iniNome + 40));
    if (!m) { saida += '<'; i++; continue; }   // "<" solto no texto
    const nome = m[0].toLowerCase();
    const aposNome = iniNome + m[0].length;
    if (fechando) {
      const f = h.indexOf('>', aposNome);
      const fim = f < 0 ? n : f + 1;
      if (nome === 'svg' || nome === 'math') estrangeiro = Math.max(0, estrangeiro - 1);
      if (nome !== 'script' && !TAGS_FORA.has(nome) && !(nome === 'style' && estrangeiro > 0)) saida += h.slice(i, fim);
      i = fim;
      continue;
    }
    const lido = lerAtributos(h, aposNome);
    if (!lido) { i = n; break; }   // tag que não fecha: o resto não é HTML confiável
    const { atributos, fim, autoFecha } = lido;
    const bruta = h.slice(i, fim);
    if (nome === 'script') {
      // O conteúdo é texto cru até </script>.
      const re = /<\/script[\t\n\f\r />]/ig;
      re.lastIndex = fim;
      const mm = re.exec(h);
      if (!mm) { i = n; break; }
      const f = h.indexOf('>', mm.index);
      i = f < 0 ? n : f + 1;
      continue;
    }
    if (TAGS_FORA.has(nome)) { i = fim; continue; }
    if (nome === 'style' && estrangeiro > 0) { i = fim; continue; }   // o conteúdo segue e é limpo como marcação
    if ((nome === 'svg' || nome === 'math') && !autoFecha) estrangeiro++;
    if (nome === 'meta' && atributos.some((a) => a.nome === 'http-equiv')) { i = fim; continue; }
    if (nome === 'link') {
      const rel = (atributos.find((a) => a.nome === 'rel')?.valor ?? '').toLowerCase();
      if (!/(^|[\t\n\f\r ])stylesheet([\t\n\f\r ]|$)/.test(rel)) { i = fim; continue; }
    }
    if (nome === 'style') {
      // Conteúdo CSS cru até </style>: limpa o que executa e devolve o resto como veio.
      const re = /<\/style[\t\n\f\r />]/ig;
      re.lastIndex = fim;
      const mm = re.exec(h);
      const corpoFim = mm ? mm.index : n;
      const css = h.slice(fim, corpoFim);
      const aberta = atributos.some(atributoPerigoso) ? reescrever(nome, atributos, autoFecha) : bruta;
      saida += aberta + (cssPerigoso(css) ? limparCss(css) : css);
      i = corpoFim;
      continue;
    }
    saida += atributos.some(atributoPerigoso) ? reescrever(nome, atributos, autoFecha, bruta) : bruta;
    i = fim;
  }
  return saida;
}

/** Tira do CSS o que executa ou busca algo de fora (`@import`, `expression()`, `behavior`, `url(javascript:)`). */
function limparCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/(-moz-binding|behavior)\s*:[^;}]*;?/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript)\s*:[^)]*\)/gi, 'url()');
}

/** A tag sem os atributos perigosos; os que ficam mantêm o espaço e as aspas de origem. */
function reescrever(nome: string, atributos: Atributo[], autoFecha: boolean, bruta?: string): string {
  const nomeOriginal = bruta ? (/^<([^\s/>]+)/.exec(bruta)?.[1] ?? nome) : nome;
  const ficam = atributos.filter((a) => !atributoPerigoso(a)).map((a) => a.bruto);
  const fecho = autoFecha ? '/>' : '>';
  return `<${nomeOriginal}${ficam.join('')}${fecho}`;
}
