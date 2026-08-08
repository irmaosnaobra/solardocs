// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTOS · AULA 7 — "Quanto kW você precisa de verdade"
//
// Segunda aula ilustrada. Escolhida porque é onde o comprador mais perde
// dinheiro: superdimensionar é o erro que o fornecedor NUNCA vai corrigir, já
// que o erro sempre é para cima do orçamento dele.
//
// De onde veio a espinha técnica: dois materiais de fornecedor (Nansen e
// NeoCharge, 2020) que o Thiago mandou. Deles saiu UM fato que reorganiza a
// aula inteira — o carregador de bordo do carro é o teto do AC, então um
// carregador de 22 kW entrega 7 kW para um carro de 7 kW. Fato de física e de
// norma, não texto de ninguém: aqui está reescrito e redesenhado do zero.
//
// O que NÃO veio de lá: os dados. Aqueles PDFs são de 2020 — falam em 913
// carregadores no Brasil, chamam 60 kW de "ultra rápida" e listam Leaf e
// e-Golf como o mercado. Nada disso entra.
//
// Regra de cada página: UMA ideia. O diagrama é o centro; o texto explica o
// diagrama, não o contrário.
//
// Números de modelo específico ficaram DE FORA de propósito: ficha de carro
// muda todo ano e a aula não pode envelhecer junto. Ensina-se onde olhar.
//
// Rodar:  node plugcash/aulas/aula-07-potencia.js         (gera a prova visual)
//         node plugcash/aulas/aula-07-potencia.js --sql   (imprime o SQL)
// ─────────────────────────────────────────────────────────────────────────────

const T = '#0A0A0A';      // traço principal
const M = '#6B6B6B';      // secundário
const V = '#00C853';      // acento — marca o que a página quer que se olhe
const A = '#C2410C';      // alerta, só onde algo reprova

const base = (conteudo, w = 720, h = 380) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif">${conteudo}</svg>`;

// ── 1 · O teto que não está no seu carregador ───────────────────────────────
// O caminho do AC passa por dentro do carro; o do DC não. É a página que
// explica por que comprar potência a mais em AC não muda nada.
const carregadorDeBordo = base(`
  <text x="40" y="40" font-size="13" font-weight="700" fill="${M}">CAMINHO DO AC — passa por dentro do carro</text>

  <rect x="40" y="58" width="120" height="86" rx="6" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="100" y="94" font-size="13" text-anchor="middle" fill="${M}">seu carregador</text>
  <text x="100" y="120" font-size="19" font-weight="800" text-anchor="middle" fill="${T}">22 kW</text>

  <path d="M160 101 L232 101" stroke="${T}" stroke-width="2.5"/>
  <path d="M224 94 L232 101 L224 108" fill="none" stroke="${T}" stroke-width="2.5"/>

  <rect x="232" y="58" width="150" height="86" rx="6" fill="#fff" stroke="${A}" stroke-width="3"/>
  <text x="307" y="88" font-size="12.5" text-anchor="middle" fill="${A}" font-weight="700">CARREGADOR DE BORDO</text>
  <text x="307" y="106" font-size="11.5" text-anchor="middle" fill="${M}">(dentro do carro)</text>
  <text x="307" y="130" font-size="19" font-weight="800" text-anchor="middle" fill="${A}">7 kW</text>

  <path d="M382 101 L454 101" stroke="${A}" stroke-width="2.5"/>
  <path d="M446 94 L454 101 L446 108" fill="none" stroke="${A}" stroke-width="2.5"/>

  <rect x="454" y="58" width="110" height="86" rx="6" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="509" y="94" font-size="13" text-anchor="middle" fill="${M}">bateria</text>
  <text x="509" y="120" font-size="19" font-weight="800" text-anchor="middle" fill="${A}">7 kW</text>

  <text x="584" y="96" font-size="14.5" font-weight="800" fill="${A}">O menor</text>
  <text x="584" y="118" font-size="14.5" font-weight="800" fill="${A}">dos dois</text>
  <text x="584" y="140" font-size="14.5" font-weight="800" fill="${A}">manda.</text>

  <line x1="40" y1="176" x2="680" y2="176" stroke="${M}" stroke-width="1" stroke-dasharray="4 4"/>

  <text x="40" y="212" font-size="13" font-weight="700" fill="${M}">CAMINHO DO DC — não passa</text>

  <rect x="40" y="230" width="120" height="86" rx="6" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="100" y="266" font-size="13" text-anchor="middle" fill="${M}">seu carregador</text>
  <text x="100" y="292" font-size="19" font-weight="800" text-anchor="middle" fill="${T}">60 kW</text>

  <path d="M160 273 L454 273" stroke="${V}" stroke-width="2.5"/>
  <path d="M446 266 L454 273 L446 280" fill="none" stroke="${V}" stroke-width="2.5"/>
  <rect x="232" y="252" width="150" height="42" rx="6" fill="none" stroke="${M}" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="307" y="278" font-size="12.5" text-anchor="middle" fill="${M}">contornado</text>

  <rect x="454" y="230" width="110" height="86" rx="6" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="509" y="266" font-size="13" text-anchor="middle" fill="${M}">bateria</text>
  <text x="509" y="292" font-size="19" font-weight="800" text-anchor="middle" fill="${V}">60 kW</text>

  <text x="584" y="268" font-size="14.5" font-weight="800" fill="${T}">Aqui o</text>
  <text x="584" y="290" font-size="14.5" font-weight="800" fill="${T}">limite é</text>
  <text x="584" y="312" font-size="14.5" font-weight="800" fill="${T}">a bateria.</text>
`);

// ── 2 · A conta é de tempo, não de potência ─────────────────────────────────
const contaDeTempo = base(`
  <rect x="40" y="34" width="640" height="66" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="360" y="66" font-size="17" font-weight="800" text-anchor="middle" fill="${T}">energia entregue = potência × tempo de permanência</text>
  <text x="360" y="88" font-size="13" text-anchor="middle" fill="${M}">e é a energia que vira quilômetro — e vira dinheiro</text>

  <text x="40" y="142" font-size="13" font-weight="700" fill="${M}">O MESMO CARRO, PARADO 40 MINUTOS</text>

  <rect x="40" y="160" width="640" height="46" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="160" width="72" height="46" rx="6" fill="${T}"/>
  <text x="130" y="189" font-size="14" fill="${T}">AC 7 kW  ·  <tspan font-weight="700">4,7 kWh</tspan>  ·  cerca de 25 km</text>

  <rect x="40" y="218" width="640" height="46" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="218" width="226" height="46" rx="6" fill="${T}"/>
  <text x="284" y="247" font-size="14" fill="${T}">AC 22 kW  ·  <tspan font-weight="700">14,7 kWh</tspan>  ·  cerca de 80 km</text>

  <rect x="40" y="276" width="640" height="46" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="276" width="616" height="46" rx="6" fill="${V}"/>
  <text x="60" y="305" font-size="14" font-weight="700" fill="#fff">DC 60 kW  ·  40 kWh  ·  cerca de 215 km</text>

  <text x="40" y="352" font-size="12.5" fill="${M}">Valores de exemplo, com o carro aceitando a potência inteira. Troque 40 min pela permanência REAL do seu ponto.</text>
`);

// ── 3 · Destino x passagem ──────────────────────────────────────────────────
const destinoPassagem = base(`
  <rect x="34" y="30" width="308" height="300" rx="10" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="58" y="64" font-size="16" font-weight="800" fill="${V}">PONTO DE DESTINO</text>
  <text x="58" y="88" font-size="13" fill="${M}">O motorista veio fazer outra coisa.</text>

  <line x1="58" y1="106" x2="318" y2="106" stroke="${M}" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="58" y="132" font-size="13" fill="${M}">Mercado, hotel, restaurante,</text>
  <text x="58" y="152" font-size="13" fill="${M}">academia, estacionamento.</text>

  <text x="58" y="192" font-size="12" font-weight="700" fill="${M}">PERMANÊNCIA</text>
  <text x="58" y="218" font-size="22" font-weight="800" fill="${T}">1 a 4 horas</text>

  <text x="58" y="256" font-size="12" font-weight="700" fill="${M}">O QUE BASTA</text>
  <text x="58" y="282" font-size="22" font-weight="800" fill="${V}">AC 7 a 22 kW</text>
  <text x="58" y="308" font-size="12.5" fill="${M}">Comprar DC aqui é pagar por pressa</text>
  <text x="58" y="326" font-size="12.5" fill="${M}">que ninguém pediu.</text>

  <rect x="378" y="30" width="308" height="300" rx="10" fill="#fff" stroke="${A}" stroke-width="2.5"/>
  <text x="402" y="64" font-size="16" font-weight="800" fill="${A}">PONTO DE PASSAGEM</text>
  <text x="402" y="88" font-size="13" fill="${M}">O motorista parou SÓ pra carregar.</text>

  <line x1="402" y1="106" x2="662" y2="106" stroke="${M}" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="402" y="132" font-size="13" fill="${M}">Rodovia, posto, entrada e</text>
  <text x="402" y="152" font-size="13" fill="${M}">saída de cidade.</text>

  <text x="402" y="192" font-size="12" font-weight="700" fill="${M}">PERMANÊNCIA</text>
  <text x="402" y="218" font-size="22" font-weight="800" fill="${T}">15 a 40 minutos</text>

  <text x="402" y="256" font-size="12" font-weight="700" fill="${M}">O QUE EXIGE</text>
  <text x="402" y="282" font-size="22" font-weight="800" fill="${A}">DC, e de verdade</text>
  <text x="402" y="308" font-size="12.5" fill="${M}">AC aqui não é ponto barato:</text>
  <text x="402" y="326" font-size="12.5" fill="${M}">é ponto que ninguém usa.</text>
`);

// ── 4 · Os dois erros, e o que cada um custa ────────────────────────────────
const doisErros = base(`
  <rect x="40" y="76" width="300" height="122" rx="10" fill="#FDF0E9" stroke="${A}" stroke-width="2"/>
  <text x="62" y="108" font-size="14.5" font-weight="800" fill="${A}">POTÊNCIA A MAIS</text>
  <text x="62" y="134" font-size="13" fill="${T}">Equipamento mais caro, entrada de</text>
  <text x="62" y="153" font-size="13" fill="${T}">energia maior, projeto maior — e o</text>
  <text x="62" y="172" font-size="13" fill="${T}">carro parado 3 horas do mesmo jeito.</text>

  <rect x="380" y="76" width="300" height="122" rx="10" fill="#FDF0E9" stroke="${A}" stroke-width="2"/>
  <text x="402" y="108" font-size="14.5" font-weight="800" fill="${A}">POTÊNCIA A MENOS</text>
  <text x="402" y="134" font-size="13" fill="${T}">Na beira da estrada, ninguém espera</text>
  <text x="402" y="153" font-size="13" fill="${T}">2 horas. O ponto existe, aparece no</text>
  <text x="402" y="172" font-size="13" fill="${T}">app e não é usado.</text>

  <rect x="40" y="226" width="640" height="118" rx="10" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="62" y="260" font-size="14.5" font-weight="800" fill="${T}">Só um dos dois erros tem quem o corrija.</text>
  <text x="62" y="288" font-size="13.5" fill="${M}">O erro para baixo o mercado te avisa: o carregador fica vazio e você percebe.</text>
  <text x="62" y="310" font-size="13.5" fill="${M}">O erro para cima ninguém avisa — ele passou pelo orçamento de quem vendeu,</text>
  <text x="62" y="332" font-size="13.5" fill="${M}">e sair caro não é defeito para o fornecedor.</text>
`);

// ── 5 · Quantas recargas cabem num dia ──────────────────────────────────────
const quantasCabem = base(`
  <text x="40" y="42" font-size="13" font-weight="700" fill="${M}">UM CONECTOR, UM DIA DE 12 HORAS ÚTEIS</text>

  <rect x="40" y="60" width="640" height="54" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="60" width="640" height="54" rx="6" fill="${T}"/>
  <text x="60" y="93" font-size="14" font-weight="700" fill="#fff">Teto teórico · sessões de 30 min, sem intervalo · 24 recargas</text>

  <text x="40" y="152" font-size="13" font-weight="700" fill="${M}">O QUE SOBRA DEPOIS DA REALIDADE</text>

  <rect x="40" y="170" width="640" height="46" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="170" width="300" height="46" rx="6" fill="#B4B4B4"/>
  <text x="356" y="199" font-size="13.5" fill="${T}">o movimento chega concentrado, não espalhado</text>

  <rect x="40" y="228" width="640" height="46" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="228" width="196" height="46" rx="6" fill="#8A8A8A"/>
  <text x="252" y="257" font-size="13.5" fill="${T}">o carro fica plugado depois de cheio</text>

  <rect x="40" y="286" width="640" height="46" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="286" width="96" height="46" rx="6" fill="${V}"/>
  <text x="152" y="315" font-size="14" font-weight="700" fill="${T}">o que o seu ponto entrega de verdade</text>

  <text x="40" y="362" font-size="12.5" fill="${M}">É esta última barra que entra na conta de retorno. Usar o teto teórico é como orçar um hotel com 100% de ocupação.</text>
`);

// ── Páginas ────────────────────────────────────────────────────────────────
const PAGINAS = [
  {
    ordem: 1,
    titulo: 'A pergunta que o catálogo responde não é a sua',
    texto: 'Todo fornecedor abre a conversa por "de quantos kW você quer?". A pergunta é confortável para ele e inútil para você, porque a potência certa não sai do catálogo: sai de quanto tempo o carro fica parado no seu ponto.',
    destaque: 'Você não está comprando kW. Está comprando quantos quilômetros consegue entregar no tempo em que o carro fica aí.',
  },
  {
    ordem: 2,
    titulo: 'Existe um teto que não está no seu carregador',
    svg: carregadorDeBordo,
    legenda: 'Em corrente alternada, a energia passa pelo carregador de bordo do próprio carro. Em corrente contínua, não passa — vai direto para a bateria.',
    texto: 'Ligue um carro de 7 kW num carregador AC de 22 kW e ele carrega a 7 kW. Os 15 kW que você pagou a mais não existem para aquele carro, e não vão existir para nenhum outro que tenha o mesmo limite.',
  },
  {
    ordem: 3,
    titulo: 'Onde conferir esse número antes de comprar qualquer coisa',
    lista: [
      'Na ficha técnica do modelo, procure "carregador de bordo" ou "carregamento AC" — é um número em kW.',
      'Procure também o "carregamento DC máximo": é outro número, quase sempre muito maior.',
      'Faça isso para os três ou quatro modelos que você mais vê passar na sua rua, não para o carro dos seus sonhos.',
    ],
    destaque: 'A ficha muda a cada ano de modelo. O que não muda é o método: dois números, por carro, antes de decidir.',
  },
  {
    ordem: 4,
    titulo: 'A conta é de tempo, não de potência',
    svg: contaDeTempo,
    legenda: 'Troque os 40 minutos pela permanência real do seu ponto e a resposta aparece sozinha.',
  },
  {
    ordem: 5,
    titulo: 'Seu ponto é de destino ou de passagem?',
    svg: destinoPassagem,
    legenda: 'Esta é a única classificação que importa para escolher potência. Todo o resto é consequência dela.',
    texto: 'Se você não consegue dizer em qual dos dois o seu ponto se encaixa, não é hora de escolher carregador — é hora de voltar para a aula de medir movimento.',
  },
  {
    ordem: 6,
    titulo: 'Errar para cima e errar para baixo custam diferente',
    svg: doisErros,
    destaque: 'O erro que o mercado corrige é o de menos. O de mais fica com você por dez anos, e passou pelo orçamento de quem lucrou com ele.',
  },
  {
    ordem: 7,
    titulo: 'A potência que você escolhe é a conta de luz que você assina',
    texto: 'Cada degrau de potência puxa junto a carga que o padrão de entrada precisa suportar e a demanda que você vai contratar todo mês — inclusive nos meses de movimento fraco. É a aula da carga disponível chegando pela outra ponta: lá você descobriu quanto cabe, aqui você escolhe quanto vai usar.',
    destaque: 'Demanda contratada é assinatura mensal, não pagamento por uso. Escolher potência é escolher um custo fixo.',
  },
  {
    ordem: 8,
    titulo: 'Quantas recargas cabem num dia — e quantas acontecem',
    svg: quantasCabem,
    legenda: 'A última barra é a que entra na conta de retorno.',
  },
  {
    ordem: 9,
    titulo: 'O fato incômodo que precisa entrar na sua conta',
    texto: 'A maior parte das recargas de carro elétrico é feita em casa, à noite, todo dia. Quem tem garagem e tomada não precisa de você. Isso não derruba o negócio — só define quem é o seu cliente: quem mora em prédio sem instalação, quem está viajando, quem esvaziou a bateria fora da rotina, e a frota que roda o dia inteiro.',
    destaque: 'Um ponto público não disputa com a garagem do motorista. Se a sua conta assume que disputa, ela está errada desde a primeira linha.',
  },
  {
    ordem: 10,
    titulo: 'O que levar desta aula',
    lista: [
      'A classificação do seu ponto: destino ou passagem.',
      'A permanência média real, em minutos, medida e não chutada.',
      'O carregador de bordo dos modelos que passam na sua rua, em kW.',
      'A faixa de potência que atende essa permanência — e nada além dela.',
      'Quantas recargas por dia o seu ponto entrega de verdade, para a conta de retorno.',
    ],
    destaque: 'Com esses cinco itens, você entra na conversa com o fornecedor com a especificação pronta. Sem eles, quem escreve a especificação é ele.',
  },
];

// ── Saída ──────────────────────────────────────────────────────────────────
if (process.argv.includes('--sql')) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(
    `update public.pc_aulas set paginas = ${q(JSON.stringify(PAGINAS))}::jsonb, duracao_seg = 26*60
     where ordem = 7 and curso_id = (select id from public.pc_cursos where slug = 'fundamentos')
       and titulo ilike '%kW%';`
  );
} else {
  const puppeteer = require('puppeteer');
  const fs = require('fs');
  const path = require('path');
  (async () => {
    const svgs = PAGINAS.filter((p) => p.svg);
    const html = `<html><head><meta charset=utf-8><style>
      body{margin:0;padding:28px;background:#F5F5F5;font-family:Inter,Segoe UI,Arial,sans-serif;width:840px}
      .p{background:#fff;border:1px solid #D9D9D9;border-radius:16px;padding:24px;margin-bottom:20px}
      h3{margin:0 0 14px;font-size:19px;font-weight:800}
      .d{background:#F5F5F5;border:1px solid #D9D9D9;border-radius:12px;padding:20px}
      .d svg{width:100%;height:auto;display:block}
    </style></head><body>${
      svgs.map((p) => `<div class=p><h3>${p.ordem}. ${p.titulo}</h3><div class=d>${p.svg}</div></div>`).join('')
    }</body></html>`;
    const b = await puppeteer.launch({ headless: 'new' });
    const pg = await b.newPage();
    await pg.setViewport({ width: 840, height: 1200 });
    await pg.setContent(html, { waitUntil: 'domcontentloaded' });
    const saida = path.join(__dirname, 'prova-aula-07.png');
    await pg.screenshot({ path: saida, fullPage: true });
    await b.close();
    console.log(`${svgs.length} diagramas → ${saida}`);
  })();
}

module.exports = { PAGINAS };
