// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTOS · AULA 5 — "A carga disponível: a pergunta que derruba a maioria"
//
// Primeira aula ilustrada do PlugCash, e é a prova do formato: se página com
// diagrama funciona aqui, funciona em qualquer lugar. Foi escolhida por ser a
// que mais reprova gente na régua E por ser puro esquema — conta de luz, padrão
// de entrada, uma conta de subtração. Nada disso melhora com alguém falando na
// frente de uma câmera.
//
// Regra de cada página: UMA ideia. Precisou de três parágrafos? Vira duas
// páginas. O diagrama é o centro; o texto explica o diagrama, não o contrário.
//
// Os diagramas são SVG escrito à mão, não imagem gerada. Um painel elétrico
// gerado por IA fica plausível e ERRADO — e num curso que ensina a ler um
// painel de verdade, isso é pior que não ter imagem.
//
// Rodar:  node plugcash/aulas/aula-05-carga.js         (gera a prova visual)
//         node plugcash/aulas/aula-05-carga.js --sql   (imprime o SQL)
// ─────────────────────────────────────────────────────────────────────────────

const T = '#0A0A0A';      // traço principal
const M = '#6B6B6B';      // secundário
const V = '#00C853';      // acento — marca o que a página quer que se olhe
const A = '#C2410C';      // alerta, só onde algo reprova

const base = (conteudo, w = 720, h = 380) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif">${conteudo}</svg>`;

// ── 1 · A conta de luz, com o campo que importa marcado ─────────────────────
const contaDeLuz = base(`
  <rect x="40" y="24" width="330" height="332" rx="8" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="62" y="58" font-size="15" font-weight="700" fill="${T}">CONTA DE ENERGIA</text>
  <line x1="62" y1="70" x2="348" y2="70" stroke="${M}" stroke-width="1"/>

  <text x="62" y="98" font-size="12" fill="${M}">Classe / Subclasse</text>
  <text x="62" y="116" font-size="14" fill="${T}">Comercial — Trifásico</text>

  <text x="62" y="148" font-size="12" fill="${M}">Tipo de fornecimento</text>
  <text x="62" y="166" font-size="14" fill="${T}">Baixa tensão · Grupo B</text>

  <rect x="52" y="186" width="306" height="58" rx="6" fill="none" stroke="${V}" stroke-width="2.5"/>
  <text x="62" y="208" font-size="12" fill="${V}" font-weight="700">DEMANDA CONTRATADA</text>
  <text x="62" y="232" font-size="20" font-weight="800" fill="${T}">75 kW</text>

  <text x="62" y="272" font-size="12" fill="${M}">Consumo do mês</text>
  <text x="62" y="290" font-size="14" fill="${T}">4.820 kWh</text>
  <line x1="62" y1="308" x2="348" y2="308" stroke="${M}" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="62" y="332" font-size="13" fill="${M}">Total a pagar</text>
  <text x="270" y="332" font-size="13" font-weight="700" fill="${T}">R$ 3.914,20</text>

  <path d="M368 215 L440 215" stroke="${V}" stroke-width="2.5"/>
  <path d="M432 208 L440 215 L432 222" fill="none" stroke="${V}" stroke-width="2.5"/>

  <text x="456" y="196" font-size="15" font-weight="800" fill="${T}">É este número.</text>
  <text x="456" y="222" font-size="13.5" fill="${M}">É o teto que a distribuidora</text>
  <text x="456" y="242" font-size="13.5" fill="${M}">já contratou com você — e</text>
  <text x="456" y="262" font-size="13.5" fill="${M}">o ponto de partida da conta.</text>
`);

// ── 2 · Padrão de entrada ──────────────────────────────────────────────────
const padraoEntrada = base(`
  <line x1="86" y1="40" x2="86" y2="330" stroke="${T}" stroke-width="4"/>
  <text x="60" y="352" font-size="12" fill="${M}">Poste</text>
  <path d="M86 78 C 150 78, 160 96, 196 96" fill="none" stroke="${T}" stroke-width="2.5"/>

  <rect x="196" y="70" width="92" height="76" rx="6" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <circle cx="242" cy="102" r="17" fill="none" stroke="${T}" stroke-width="2"/>
  <text x="242" y="107" font-size="12" text-anchor="middle" fill="${T}">kWh</text>
  <text x="242" y="166" font-size="12.5" text-anchor="middle" fill="${M}">Medidor</text>

  <line x1="288" y1="108" x2="352" y2="108" stroke="${T}" stroke-width="2.5"/>

  <rect x="352" y="70" width="92" height="76" rx="6" fill="#fff" stroke="${V}" stroke-width="3"/>
  <path d="M382 88 L382 128 M398 88 L398 128 M414 88 L414 128" stroke="${V}" stroke-width="3" stroke-linecap="round"/>
  <text x="398" y="166" font-size="12.5" text-anchor="middle" fill="${V}" font-weight="700">Disjuntor geral</text>

  <line x1="444" y1="108" x2="512" y2="108" stroke="${T}" stroke-width="2.5"/>
  <rect x="512" y="62" width="112" height="92" rx="6" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <line x1="530" y1="82" x2="606" y2="82" stroke="${M}" stroke-width="2"/>
  <line x1="530" y1="102" x2="606" y2="102" stroke="${M}" stroke-width="2"/>
  <line x1="530" y1="122" x2="606" y2="122" stroke="${M}" stroke-width="2"/>
  <text x="568" y="174" font-size="12.5" text-anchor="middle" fill="${M}">Quadro geral</text>

  <rect x="196" y="228" width="428" height="80" rx="8" fill="none" stroke="${V}" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="216" y="256" font-size="14" font-weight="800" fill="${T}">O disjuntor geral é o teto físico.</text>
  <text x="216" y="280" font-size="13.5" fill="${M}">A demanda contratada é o teto comercial. Os dois existem,</text>
  <text x="216" y="298" font-size="13.5" fill="${M}">e o menor dos dois é o que vale para você.</text>
`);

// ── 3 · A conta: o que sobra ───────────────────────────────────────────────
const barraDeCarga = base(`
  <text x="40" y="46" font-size="13" font-weight="700" fill="${M}">CAPACIDADE CONTRATADA — 75 kW</text>

  <rect x="40" y="62" width="640" height="54" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="62" width="290" height="54" rx="6" fill="${T}"/>
  <text x="60" y="95" font-size="14" font-weight="700" fill="#fff">Carga já usada · 34 kW</text>
  <text x="350" y="95" font-size="14" fill="${M}">Folga: 41 kW</text>

  <text x="40" y="168" font-size="13" font-weight="700" fill="${M}">O QUE O CARREGADOR PEDE</text>

  <rect x="40" y="184" width="640" height="54" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="184" width="512" height="54" rx="6" fill="${A}" opacity="0.9"/>
  <text x="60" y="217" font-size="14" font-weight="700" fill="#fff">Estação de 60 kW</text>

  <line x1="352" y1="56" x2="352" y2="250" stroke="${V}" stroke-width="2" stroke-dasharray="5 4"/>
  <text x="362" y="270" font-size="12.5" fill="${V}" font-weight="700">limite da folga</text>

  <rect x="40" y="296" width="640" height="60" rx="8" fill="#FDF0E9" stroke="${A}" stroke-width="1.5"/>
  <text x="60" y="322" font-size="14.5" font-weight="800" fill="${A}">Não cabe. Faltam 19 kW.</text>
  <text x="60" y="344" font-size="13.5" fill="${T}">E isto é uma conta de subtração, não uma opinião do fornecedor.</text>
`);

// ── 4 · O limiar que muda tudo ─────────────────────────────────────────────
const tensao = base(`
  <rect x="40" y="150" width="150" height="76" rx="8" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="115" y="182" font-size="13" text-anchor="middle" fill="${M}">Carga total</text>
  <text x="115" y="206" font-size="16" font-weight="800" text-anchor="middle" fill="${T}">do seu ponto</text>

  <path d="M190 172 L268 96" fill="none" stroke="${V}" stroke-width="2.5"/>
  <path d="M262 100 L268 96 L270 104" fill="none" stroke="${V}" stroke-width="2.5"/>
  <path d="M190 204 L268 280" fill="none" stroke="${A}" stroke-width="2.5"/>
  <path d="M262 276 L268 280 L270 272" fill="none" stroke="${A}" stroke-width="2.5"/>

  <rect x="278" y="52" width="402" height="92" rx="8" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="300" y="82" font-size="15" font-weight="800" fill="${V}">Abaixo do limiar → baixa tensão</text>
  <text x="300" y="106" font-size="13.5" fill="${T}">Ligação mais simples, prazo menor, sem subestação.</text>
  <text x="300" y="126" font-size="13.5" fill="${M}">É o caminho que a maioria dos pontos consegue.</text>

  <rect x="278" y="236" width="402" height="112" rx="8" fill="#fff" stroke="${A}" stroke-width="2.5"/>
  <text x="300" y="266" font-size="15" font-weight="800" fill="${A}">Acima do limiar → média tensão</text>
  <text x="300" y="290" font-size="13.5" fill="${T}">Entra subestação própria, projeto maior, prazo maior</text>
  <text x="300" y="310" font-size="13.5" fill="${T}">e um custo que muda a conta do investimento inteiro.</text>
  <text x="300" y="334" font-size="13" fill="${M}">O limiar exato é da norma da SUA distribuidora.</text>
`);

// ── 5 · O caminho do pedido formal ─────────────────────────────────────────
const pedidoFormal = base(`
  ${[
    ['1', 'Você pede', 'Solicitação de\ninformação de carga'],
    ['2', 'Ela analisa', 'Prazo é dela,\nnão seu'],
    ['3', 'Ela responde', 'Por escrito,\ncom número'],
    ['4', 'Você decide', 'Com dado, não\ncom estimativa'],
  ].map(([n, t, d], k) => {
    const x = 40 + k * 172;
    const linhas = d.split('\n');
    return `
      <rect x="${x}" y="96" width="140" height="128" rx="8" fill="#fff"
            stroke="${k === 3 ? V : T}" stroke-width="${k === 3 ? 3 : 2}"/>
      <circle cx="${x + 26}" cy="124" r="14" fill="${k === 3 ? V : T}"/>
      <text x="${x + 26}" y="129" font-size="13" font-weight="700" text-anchor="middle" fill="#fff">${n}</text>
      <text x="${x + 16}" y="166" font-size="14.5" font-weight="800" fill="${T}">${t}</text>
      ${linhas.map((l, j) => `<text x="${x + 16}" y="${190 + j * 18}" font-size="12.5" fill="${M}">${l}</text>`).join('')}
      ${k < 3 ? `<path d="M${x + 146} 160 L${x + 166} 160" stroke="${M}" stroke-width="2"/>
                 <path d="M${x + 160} 154 L${x + 166} 160 L${x + 160} 166" fill="none" stroke="${M}" stroke-width="2"/>` : ''}
    `;
  }).join('')}
  <rect x="40" y="272" width="640" height="72" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="60" y="300" font-size="14.5" font-weight="800" fill="${T}">O pedido é gratuito. A estimativa errada, não.</text>
  <text x="60" y="324" font-size="13.5" fill="${M}">Esta é a única resposta que vale em contrato, projeto e financiamento.</text>
`, 720, 364);

// ── As páginas ─────────────────────────────────────────────────────────────
const PAGINAS = [
  {
    ordem: 1,
    titulo: 'A pergunta que fecha a agenda',
    texto: 'No formulário, uma pergunta derruba mais gente que todas as outras juntas: quanta energia o seu ponto tem disponível hoje. Quase ninguém sabe responder — e não é ignorância, é que ninguém nunca precisou olhar.',
    destaque: 'Ao fim desta aula você responde essa pergunta sobre o seu próprio endereço, com número e com fonte.',
  },
  {
    ordem: 2,
    titulo: 'A resposta já está na sua conta de luz',
    svg: contaDeLuz,
    legenda: 'Conta de energia comercial, trifásica, baixa tensão. O campo muda de nome entre distribuidoras — pode aparecer como "demanda contratada", "demanda faturada" ou "potência disponibilizada".',
    texto: 'Você não precisa de equipamento nem de visita técnica para começar. O primeiro número está impresso na conta que chega todo mês.',
  },
  {
    ordem: 3,
    titulo: 'Existem dois tetos, e o menor manda',
    svg: padraoEntrada,
    legenda: 'Do poste ao quadro geral. O disjuntor geral é o que limita fisicamente; a demanda contratada é o que limita comercialmente.',
    destaque: 'Adianta pouco ter 75 kW contratados se o disjuntor geral do padrão aguenta menos. Confira os dois.',
  },
  {
    ordem: 4,
    titulo: 'Agora a conta: quanto sobra de verdade',
    svg: barraDeCarga,
    texto: 'Da capacidade total, tire tudo que já funciona no local — iluminação, ar-condicionado, câmaras, motores. O que sobra é a sua folga real. E é contra ela que a potência do carregador é comparada.',
    destaque: 'É subtração. Não é opinião do fornecedor, nem "a gente dá um jeito na obra".',
  },
  {
    ordem: 5,
    titulo: 'O carregador não é a única carga que vai crescer',
    lista: [
      'Iluminação da área de recarga, que quase sempre é esquecida no cálculo.',
      'Câmeras, cancela, totem e a rede que liga tudo isso.',
      'Se houver mais de um bico, some os dois — a menos que a estação faça gestão de carga.',
      'Uma reserva para o que a operação vai pedir depois. Redimensionar padrão duas vezes custa duas obras.',
    ],
    destaque: 'Quem soma só o carregador descobre o resto na obra, quando o padrão já está fechado.',
  },
  {
    ordem: 6,
    titulo: 'O limiar que decide o tamanho do seu projeto',
    svg: tensao,
    legenda: 'O valor exato do limiar está na norma técnica da sua distribuidora — e é a primeira coisa a confirmar, porque ele muda o projeto inteiro.',
    texto: 'Acima de um certo total de carga instalada, a unidade sai da baixa tensão e vai para a média. Isso não é um detalhe técnico: muda o projeto, o prazo, o responsável técnico e o custo.',
  },
  {
    ordem: 7,
    titulo: 'Por que a conta de luz não é a palavra final',
    texto: 'O que você calculou até aqui é uma boa estimativa — suficiente para descartar um ponto ruim, e insuficiente para comprar equipamento. Quem responde em definitivo sobre a rede é a distribuidora, e só por escrito.',
    destaque: 'Estimativa serve para reprovar um ponto. Nunca para aprovar uma compra.',
  },
  {
    ordem: 8,
    titulo: 'O pedido formal, em quatro passos',
    svg: pedidoFormal,
    legenda: 'O modelo do ofício vai junto com este curso, com o texto pronto para preencher e enviar.',
  },
  {
    ordem: 9,
    titulo: 'A resposta chega. E aí?',
    lista: [
      'Cabe: siga para o projeto. Você tem o número por escrito, que é o que o banco e o contrato pedem.',
      'Não cabe, mas dá para aumentar: existe caminho, e ele tem prazo e custo. É a próxima aula.',
      'Não cabe e não dá: este ponto não é o seu. Descobrir isso agora custou um ofício; descobrir depois custaria o equipamento.',
    ],
    destaque: 'As três respostas são boas. A ruim é não ter perguntado.',
  },
  {
    ordem: 10,
    titulo: 'O que levar desta aula',
    lista: [
      'O número da demanda contratada do seu ponto, tirado da conta de luz.',
      'A capacidade do disjuntor geral, conferida no padrão de entrada.',
      'A carga que já é usada hoje, somada item por item.',
      'A folga real — e se a estação que você quer cabe nela.',
      'O ofício enviado, com protocolo.',
    ],
    destaque: 'Com esses cinco itens na mão, você deixa de ser alguém que quer um eletroposto e passa a ser alguém que tem um projeto.',
  },
];

// ── Saída ──────────────────────────────────────────────────────────────────
if (process.argv.includes('--sql')) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(
    `update public.pc_aulas set paginas = ${q(JSON.stringify(PAGINAS))}::jsonb, duracao_seg = 28*60
     where ordem = 5 and curso_id = (select id from public.pc_cursos where slug = 'fundamentos');`
  );
} else {
  // Prova visual: renderiza os diagramas pra conferir antes de gravar.
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
    const saida = path.join(__dirname, 'prova-aula-05.png');
    await pg.screenshot({ path: saida, fullPage: true });
    await b.close();
    console.log(`${svgs.length} diagramas → ${saida}`);
  })();
}

module.exports = { PAGINAS };
