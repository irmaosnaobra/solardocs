const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');

// ─────────────────────────────────────────────────────────────────────────────
// BANNER DO CHECKOUT
//
// O trabalho dele é um só: a pessoa clicou num botão preto-e-verde na nossa
// página e caiu numa tela da Kiwify que não parece nossa. O banner fecha esse
// buraco — mesma marca, mesmo nome de produto, mesma promessa. Quebra visual no
// checkout é abandono que ninguém consegue medir depois.
//
// O QUE ELE NÃO TEM, DE PROPÓSITO:
//   · PREÇO. O checkout já mostra, e número em imagem estática envelhece na
//     primeira vez que alguém reajusta — foi exatamente o que aconteceu com o
//     og.jpg, que ficou meses anunciando "a partir de R$85.000".
//   · contagem regressiva, vaga limitada, "de R$ X por R$ Y". A regra da casa
//     proíbe, e este comprador chegou de uma página que se orgulha de não ter
//     truque: ver um aqui desmonta tudo o que ele acabou de ler.
//
// AS TRÊS LINHAS DE BAIXO são as mesmas três da landing, palavra por palavra.
// Promessa que muda de redação entre a página e o checkout vira promessa nova.
//
// Rodar: node plugcash/brand/banner-checkout.js
// ─────────────────────────────────────────────────────────────────────────────

const VERDE = '#00C853';
const PRETO = '#0A0A0A';

// Kiwify recorta o banner em telas estreitas a partir das bordas. Tudo que
// precisa sobreviver fica dentro da faixa central — daí o `zonaSegura`.
const FORMATOS = [
  { nome: 'banner-checkout-1920x480', w: 1920, h: 480, escala: 1 },
  { nome: 'banner-checkout-1200x300', w: 1200, h: 300, escala: 0.62 },
  { nome: 'banner-checkout-quadrado', w: 1080, h: 1080, escala: 1.42, empilhado: true },
];

const marca = (t) => `
  <svg viewBox="0 0 80 80" style="width:${t}px;height:${t}px;flex:none">
    <rect width="80" height="80" rx="21" fill="${VERDE}"/>
    <rect x="38.5" y="11" width="3.6" height="58" rx="1.8" fill="#fff"/>
    <path d="M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z" fill="#fff"/>
  </svg>`;

const check = (t) => `
  <svg viewBox="0 0 24 24" fill="none" stroke="${VERDE}" stroke-width="2.6"
       stroke-linecap="round" stroke-linejoin="round" style="width:${t}px;height:${t}px;flex:none">
    <path d="M20 6 9 17l-5-5"/>
  </svg>`;

// As três garantias, iguais às da landing.
const LINHAS = [
  'Acesso vitalício, no celular ou no computador',
  'Sete dias de garantia — devolução integral',
  'Acesso liberado por e-mail assim que o pagamento é aprovado',
];

function html(f) {
  const e = f.escala;
  const px = (n) => Math.round(n * e) + 'px';
  const empilhado = f.empilhado;

  return `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${f.w}px;height:${f.h}px;background:${PRETO};color:#fff;overflow:hidden;
       font-family:'Inter','Segoe UI',system-ui,-apple-system,Arial,sans-serif;position:relative}
  /* Filete verde no topo: é o mesmo do cartão de preço da landing. Quem vem de
     lá reconhece antes de ler. */
  .regua{position:absolute;left:0;right:0;top:0;height:${px(7)};background:${VERDE}}
  /* Faixa central com largura travada: num banner de 1920 o space-between
     jogava os dois blocos pros extremos e eles viravam ilhas — e extremo de
     banner e justamente o que o checkout corta em tela estreita. */
  .zonaSegura{position:absolute;inset:0;max-width:${empilhado ? f.w : 1360}px;margin:0 auto;display:flex;
    ${empilhado
      ? `flex-direction:column;justify-content:center;align-items:flex-start;padding:0 ${px(68)};gap:${px(40)}`
      : `align-items:center;justify-content:space-between;padding:0 ${px(88)};gap:${px(56)}`}}
  .marca{display:flex;align-items:center;gap:${px(16)}}
  .marca .nome{font-size:${px(34)};font-weight:800;letter-spacing:-.02em;line-height:1}
  .cash{color:${VERDE}}
  h1{font-size:${px(empilhado ? 54 : 46)};font-weight:800;letter-spacing:-.03em;
     line-height:1.06;margin-top:${px(18)};max-width:${empilhado ? '15ch' : '17ch'}}
  .assina{font-size:${px(15)};color:#8f8f8f;margin-top:${px(14)};letter-spacing:.02em}
  ul{list-style:none;display:flex;flex-direction:column;gap:${px(18)};flex:none}
  li{display:flex;align-items:flex-start;gap:${px(13)};font-size:${px(empilhado ? 20 : 19)};
     line-height:1.35;color:#EDEDED;max-width:${px(empilhado ? 300 : 430)}}
  </style>
  <div class="regua"></div>
  <div class="zonaSegura">
    <div>
      <span class="marca">${marca(Math.round(42 * e))}
        <span class="nome">Plug<span class="cash">Cash</span></span>
      </span>
      <h1>Fundamentos do Eletroposto</h1>
      <p class="assina">Irmãos na Obra &middot; Mobilidade Elétrica</p>
    </div>
    <ul>${LINHAS.map((l) => `<li>${check(Math.round(21 * e))}<span>${l}</span></li>`).join('')}</ul>
  </div>`;
}

(async () => {
  const destino = path.join(__dirname, '..', '..', 'dashboard', 'public', 'plugcash', 'img');
  fs.mkdirSync(destino, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const f of FORMATOS) {
    await page.setViewport({ width: f.w, height: f.h, deviceScaleFactor: 1 });
    await page.setContent(html(f), { waitUntil: 'domcontentloaded' });
    const arq = path.join(destino, `${f.nome}.png`);
    await page.screenshot({ path: arq, type: 'png' });
    console.log(`  ${f.nome}.png  ${f.w}x${f.h}  ${(fs.statSync(arq).size / 1024).toFixed(1)} KB`);
  }

  await browser.close();
})();
