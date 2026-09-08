/**
 * AS FONTES DO /irmaosnaobra — baixa do Google, corta o que a pagina nao usa,
 * e escreve o @font-face no topo do style.css.
 *
 * POR QUE NAO USAR O <link> DO GOOGLE: o navegador precisa abrir DUAS conexoes
 * novas antes de desenhar a primeira letra (googleapis pro CSS, gstatic pros
 * arquivos), e o CSS de la' BLOQUEIA a pintura. Servindo do proprio dominio,
 * os arquivos entram na conexao que ja' esta' aberta.
 *
 * POR QUE CORTAR: o subconjunto `latin` que o Google entrega carrega o alfabeto
 * inteiro do Ocidente — islandes, polones, simbolo de moeda de meio mundo. Uma
 * pagina em portugues usa uma fracao disso. O corte aqui e' generoso de
 * proposito (ASCII inteiro + Latin-1 inteiro + pontuacao tipografica), pra
 * nenhuma letra de texto futuro cair fora e aparecer na fonte do sistema.
 *
 *   node scripts/build-fontes-irmaosnaobra.js
 *
 * Precisa do fonttools: python -m pip install "fonttools[woff]" brotli
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

// Inter e JetBrains Mono pedem FAIXA (400..700), nao pesos soltos: assim o
// Google devolve a fonte variavel, UM arquivo que cobre a faixa inteira.
// Barlow Condensed nao tem variavel no Google, entao vem em tres arquivos.
const PEDIDO = 'https://fonts.googleapis.com/css2'
  + '?family=Barlow+Condensed:wght@600;700;800'
  + '&family=Inter:wght@400..700'
  + '&family=JetBrains+Mono:wght@400..700'
  + '&display=swap';

// UA de Chrome: sem isso o Google devolve .ttf em vez de .woff2 (o dobro do peso)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// O QUE FICA EM CADA FONTE.
// Medi o que a pagina realmente desenha — Inter 77 caracteres, Barlow 52,
// Mono 70 — e guardo MUITO mais que isso de proposito: conteudo muda, e letra
// faltando aparece na fonte do sistema, o que e' pior que uns KB.
const PONTUACAO = [
  'U+2013-2014',   // – —
  'U+2018-201D',   // aspas curvas
  'U+2022',        // •
  'U+2026',        // …
  'U+2039-203A',   // ‹ ›
  'U+20AC',        // €
  'U+2212',        // − (menos de verdade)
  'U+2713',        // ✓ (o tique do campo respondido)
];

// Texto corrido: precisa do alfabeto inteiro nas duas caixas.
const FICA_TEXTO = ['U+0020-007E', 'U+00A0-00FF'].concat(PONTUACAO).join(',');

// Barlow Condensed e' a fonte de titulo, e NESTE SITE ela nunca desenha
// minuscula: toda regra que usa var(--display) tambem manda
// text-transform:uppercase. Entao o arquivo dela nao carrega a-z nem os
// acentos minusculos — 13,2 KB no lugar de 19,5, por peso, tres pesos.
// A premissa e' verificada no comeco deste script; se alguem escrever uma
// regra de titulo sem uppercase, o build para e avisa.
const FICA_TITULO = [
  'U+0020-0040',   // espaco, pontuacao, digitos (vai ate' o @)
  'U+0041-005A',   // A-Z, as letras. Eu esqueci esta linha na primeira
                   // versao e o conferir-fontes pegou: 25 maiusculas
                   // sem desenho, porque 0x20-0x40 para no @ e a faixa
                   // seguinte comeca no [.
  'U+005B-0060',   // [ \\ ] ^ _ `
  'U+007B-007E',   // { | } ~
  'U+00A0-00BF',   // simbolos do Latin-1 (° ª º « » ± ² ³)
  'U+00C0-00DE',   // MAIUSCULAS acentuadas
].concat(PONTUACAO).join(',');

// A premissa do FICA_TITULO, conferida no proprio CSS. Sem isso o corte
// silenciosamente quebraria no dia em que alguem tirasse um uppercase.
function conferirTitulosEmCaixaAlta() {
  const css = fs.readFileSync(CSS, 'utf8');
  const soltas = [];
  for (const [, sel, corpo] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!corpo.includes('var(--display)')) continue;
    if (!corpo.replace(/\s/g, '').includes('text-transform:uppercase')) {
      soltas.push(sel.trim().replace(/\s+/g, ' ').slice(0, 70));
    }
  }
  if (soltas.length) {
    console.error('\nPAREI: estas regras usam a fonte de titulo SEM caixa alta,');
    console.error('entao o corte que tira as minusculas do Barlow deixaria letra sem desenho:\n');
    soltas.forEach((x) => console.error('  ' + x));
    console.error('\nOu ponha text-transform:uppercase nelas, ou troque o');
    console.error('FICA_TITULO por FICA_TEXTO neste script.\n');
    process.exit(1);
  }
}

const SAIDA = path.join(__dirname, '..', 'public', 'irmaosnaobra', 'assets', 'fontes');
const CSS = path.join(__dirname, '..', 'public', 'irmaosnaobra', 'assets', 'css', 'style.css');
const ABRE = '/* ===== FONTES (geradas por scripts/build-fontes-irmaosnaobra.js) ===== */';
const FECHA = '/* ===== fim das fontes ===== */';

const baixar = (url, bin) => new Promise((ok, erro) => {
  https.get(url, { headers: { 'user-agent': UA } }, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
      return baixar(r.headers.location, bin).then(ok, erro);
    if (r.statusCode !== 200) return erro(new Error(url + ' respondeu ' + r.statusCode));
    const pedacos = [];
    r.on('data', (d) => pedacos.push(d));
    r.on('end', () => ok(bin ? Buffer.concat(pedacos) : Buffer.concat(pedacos).toString('utf8')));
  }).on('error', erro);
});

(async () => {
  conferirTitulosEmCaixaAlta();
  fs.mkdirSync(SAIDA, { recursive: true });
  const css = await baixar(PEDIDO, false);

  const blocos = [...css.matchAll(/\/\*\s*([\w\[\]-]+)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)];
  const latin = blocos.filter((b) => b[1] === 'latin');
  if (!latin.length) throw new Error('nao achei o subconjunto latin no CSS do Google');

  const regras = [];
  let antes = 0, depois = 0;

  for (const [, , corpo] of latin) {
    const fam = /font-family:\s*'([^']+)'/.exec(corpo)[1];
    const peso = /font-weight:\s*([\d ]+);/.exec(corpo)[1].trim();
    const variavel = peso.includes(' ');
    const url = /url\((https:[^)]+\.woff2)\)/.exec(corpo)[1];

    const nome = fam.toLowerCase().replace(/\s+/g, '-')
      + '-' + (variavel ? 'variavel' : peso) + '.woff2';
    const destino = path.join(SAIDA, nome);
    const cru = path.join(SAIDA, '_cru.woff2');

    const bytes = await baixar(url, true);
    fs.writeFileSync(cru, bytes);
    antes += bytes.length;

    // O corte. `--layout-features=*` mantem kerning e ligadura: tirar isso
    // economizaria mais uns bytes e estragaria o espacamento das palavras.
    const fica = fam === 'Barlow Condensed' ? FICA_TITULO : FICA_TEXTO;
    execFileSync('python', ['-m', 'fontTools.subset', cru,
      '--unicodes=' + fica,
      '--layout-features=*',
      '--flavor=woff2',
      '--output-file=' + destino,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    fs.unlinkSync(cru);
    const tam = fs.statSync(destino).size;
    depois += tam;
    console.log('  ' + nome.padEnd(30)
      + (bytes.length / 1024).toFixed(1).padStart(6) + ' KB  ->  '
      + (tam / 1024).toFixed(1).padStart(6) + ' KB   ('
      + Math.round((1 - tam / bytes.length) * 100) + '% menor)');

    // A faixa do @font-face acompanha o que sobrou no arquivo: dizer ao
    // navegador que a fonte cobre mais do que cobre faz ele NAO buscar a
    // proxima e deixar o caractere sem desenho.
    regras.push("@font-face{font-family:'" + fam + "';font-style:normal;font-weight:" + peso + ";"
      + "font-display:swap;src:url('/irmaosnaobra/assets/fontes/" + nome + "') format('woff2');"
      + "unicode-range:" + fica + ";}");
  }

  let s = fs.readFileSync(CSS, 'utf8');
  const bloco = ABRE + '\n' + regras.join('\n') + '\n' + FECHA;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.includes(ABRE)
    ? s.replace(new RegExp(esc(ABRE) + '[\\s\\S]*?' + esc(FECHA)), bloco)
    : bloco + '\n\n' + s;
  fs.writeFileSync(CSS, s.replace(/\r\n/g, '\n'), 'utf8');

  console.log('\n  ' + latin.length + ' fontes: '
    + (antes / 1024).toFixed(1) + ' KB  ->  ' + (depois / 1024).toFixed(1) + ' KB'
    + '   (' + Math.round((1 - depois / antes) * 100) + '% menor)');
  console.log('  @font-face reescrito no topo do style.css');
})();
