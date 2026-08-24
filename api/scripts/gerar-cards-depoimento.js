// Gera os CARDS DE DEPOIMENTO que a cadência de confiança manda no WhatsApp.
//
// Por que card e não print de conversa: print expõe nome, número e foto de um
// cliente numa conversa privada — licença diferente da frase, e ninguém foi
// perguntado sobre isso. O card carrega só a fala que JÁ está publicada na
// página de vendas, na mesma autorização.
//
// REGRA DO CARD: nada entra aqui que não esteja no `DEPOIMENTOS` do Landing.tsx.
// Sem logo do cliente, sem "cliente desde", sem moldura inventada. A fala é
// literal; o card é só o suporte dela.
//
// Uso:  node api/scripts/gerar-cards-depoimento.js
// Saída: api/scripts/out/card-<slug>.png (1080×1080, pronto pro WhatsApp)
//
// Depois de gerar, COPIE pra dashboard/public/depoimentos/ e commite — é de lá
// que a cadência serve as imagens (solardoc.app/depoimentos/<arquivo>.png). Não
// precisa de Cloudinary: o matcher do proxy exclui `.png`, então estático não
// leva 307 pro login. As envs CONFIANCA_WA_CARD_1/_2/_3 existem só pra trocar
// um criativo sem deploy; sem elas vale o arquivo do repo.
//
// A pasta out/ é descartável (está no .gitignore) — o que vale é a cópia em
// dashboard/public/depoimentos/.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const CARDS = [
  {
    slug: 'alessandro-forca-solar',
    texto: 'Criava os meus orçamentos tudo através de planilha. Aqui, com quatro, cinco cliques eu consigo montar uma proposta. Recomendo.',
    nome: 'Alessandro Goulart',
    empresa: 'Força Solar',
    cidade: 'Feliz/RS',
  },
  {
    slug: 'lucas-rsc-solar',
    texto: 'Rapidez. Eu coloquei ele no meu celular, então eu consigo responder de qualquer lugar que eu estiver. Rápido demais.',
    nome: 'Lucas Paulino',
    empresa: 'RSC Solar',
    cidade: 'Londrina/PR',
  },
  {
    slug: 'antonio-exxel-solar',
    texto: 'Praticidade na confecção das propostas. Eu tinha outro CRM — o custo benefício dessa proposta me fez optar.',
    nome: 'Antônio Henrique',
    empresa: 'Exxel Solar',
    cidade: 'Xique-Xique/BA',
  },
];

// Fala longa pede corpo menor pra caber sem apertar as margens.
function corpo(texto) {
  if (texto.length > 125) return 58;
  if (texto.length > 100) return 63;
  return 68;
}

function html(card) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Sans+3:ital,wght@0,600;1,400&display=swap">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1080px; background:#0f172a;
    font-family:'Source Sans 3',sans-serif; color:#e2e8f0;
    display:flex; flex-direction:column; justify-content:space-between;
    padding:96px 88px 80px; position:relative; overflow:hidden;
  }
  /* Faixa quente no topo: é a assinatura visual dos e-mails da cadência. */
  .faixa { position:absolute; top:0; left:0; right:0; height:14px;
    background:linear-gradient(90deg,#f59e0b,#fbbf24); }
  .marca { font-family:'Archivo',sans-serif; font-weight:700; font-size:26px;
    letter-spacing:.26em; text-transform:uppercase; color:#f59e0b; }
  .aspas { font-family:'Archivo',sans-serif; font-size:190px; line-height:.62;
    color:#f59e0b; opacity:.22; height:104px; }
  blockquote { font-size:${corpo(card.texto)}px; line-height:1.42; font-style:italic;
    color:#f8fafc; max-width:23ch; }
  .quem { border-top:2px solid rgba(245,158,11,.42); padding-top:26px; }
  .quem b { display:block; font-family:'Archivo',sans-serif; font-weight:600;
    font-size:34px; color:#fbbf24; letter-spacing:-.01em; }
  .quem span { display:block; font-size:27px; color:#94a3b8; margin-top:6px; }
</style></head><body>
  <div class="faixa"></div>
  <div class="marca">SolarDoc</div>
  <div>
    <div class="aspas">&ldquo;</div>
    <blockquote>${card.texto}</blockquote>
  </div>
  <div class="quem">
    <b>${card.nome}</b>
    <span>${card.empresa} — ${card.cidade}</span>
  </div>
</body></html>`;
}

(async () => {
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

  for (const card of CARDS) {
    // 'load' e não 'networkidle0': a folha do Google Fonts fica com conexão viva
    // depois do primeiro card e o networkidle nunca chega — o 2º card estourava
    // os 30s de timeout. Quem garante a fonte certa é o document.fonts.ready.
    await page.setContent(html(card), { waitUntil: 'load' });
    // Sem isto o PNG sai com a fonte de fallback — a troca acontece depois do load.
    await page.evaluateHandle('document.fonts.ready');
    const destino = path.join(outDir, `card-${card.slug}.png`);
    await page.screenshot({ path: destino, type: 'png' });
    console.log('gerado:', destino, fs.statSync(destino).size, 'bytes');
  }

  await browser.close();
})();
