/**
 * TRAZ AS FONTES DO GOOGLE PRA CASA — /irmaosnaobra
 *
 * POR QUE: com <link> pro fonts.googleapis.com o navegador precisa abrir DUAS
 * conexoes novas antes de desenhar qualquer letra (googleapis pro CSS,
 * gstatic pros arquivos), e o CSS de la' BLOQUEIA a pintura. No celular 4G isso
 * custava perto de meio segundo antes de aparecer a primeira palavra.
 *
 * Servindo do mesmo dominio, os arquivos entram na conexao que ja' esta' aberta.
 *
 * O QUE BAIXA: so' o subconjunto `latin`. Ele cobre acento portugues inteiro
 * (a-z, A-Z, os acentuados do Latin-1) mais a pontuacao geral (travessao, aspas
 * curvas). Os outros seis subconjuntos que o Google manda — cirilico, grego,
 * vietnamita — nunca seriam usados aqui.
 *
 *   node scripts/build-fontes-irmaosnaobra.js
 *
 * Mexeu na lista de pesos? Rode de novo e confira o @font-face no topo do
 * style.css: o bloco entre os marcadores e' REESCRITO por este script.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// Inter e JetBrains Mono pedem FAIXA (400..700), nao pesos soltos: assim o
// Google devolve a fonte variavel, UM arquivo que cobre a faixa inteira. Sao
// 47 KB no lugar de tres de 47, e 30 no lugar de dois de 30 — 124 KB a menos.
// Barlow Condensed nao tem variavel no Google, entao continua em tres arquivos
// (e sao os menores, 22 KB cada).
const PEDIDO = 'https://fonts.googleapis.com/css2'
  + '?family=Barlow+Condensed:wght@600;700;800'
  + '&family=Inter:wght@400..700'
  + '&family=JetBrains+Mono:wght@400..700'
  + '&display=swap';

// UA de Chrome: sem isso o Google devolve .ttf em vez de .woff2 (o dobro do peso)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
  fs.mkdirSync(SAIDA, { recursive: true });
  const css = await baixar(PEDIDO, false);

  const blocos = [...css.matchAll(/\/\*\s*([\w\[\]-]+)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)];
  const latin = blocos.filter((b) => b[1] === 'latin');
  if (!latin.length) throw new Error('nao achei o subconjunto latin no CSS do Google');

  const regras = [];
  let total = 0;

  for (const [, , corpo] of latin) {
    const fam = /font-family:\s*'([^']+)'/.exec(corpo)[1];
    const peso = /font-weight:\s*([\d ]+);/.exec(corpo)[1].trim();
    const variavel = peso.includes(' ');
    const faixa = /unicode-range:\s*([^;]+);/.exec(corpo)[1].trim();
    const url = /url\((https:[^)]+\.woff2)\)/.exec(corpo)[1];

    const nome = fam.toLowerCase().replace(/\s+/g, '-')
      + '-' + (variavel ? 'variavel' : peso) + '.woff2';
    const bytes = await baixar(url, true);
    fs.writeFileSync(path.join(SAIDA, nome), bytes);
    total += bytes.length;
    console.log('  ' + nome.padEnd(28) + (bytes.length / 1024).toFixed(1) + ' KB');

    regras.push("@font-face{font-family:'" + fam + "';font-style:normal;font-weight:" + peso + ";"
      + "font-display:swap;src:url('/irmaosnaobra/assets/fontes/" + nome + "') format('woff2');"
      + "unicode-range:" + faixa + ";}");
  }

  let s = fs.readFileSync(CSS, 'utf8');
  const bloco = ABRE + '\n' + regras.join('\n') + '\n' + FECHA;
  if (s.includes(ABRE)) {
    s = s.replace(new RegExp(ABRE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '[\\s\\S]*?' + FECHA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), bloco);
  } else {
    s = bloco + '\n\n' + s;
  }
  fs.writeFileSync(CSS, s.replace(/\r\n/g, '\n'), 'utf8');

  console.log('\n' + latin.length + ' fontes, ' + (total / 1024).toFixed(1) + ' KB no total');
  console.log('@font-face escrito no topo do style.css');
})();
