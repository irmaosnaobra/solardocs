// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTOS · AULA 1 — "Por que o formulário te barrou"
//
// É a primeira tela depois do pagamento. Ela não ensina técnica: ela devolve a
// dignidade de quem acabou de ser reprovado por um formulário e mesmo assim
// pagou. Se esta aula soar como consolo, o resto do curso não é lido.
//
// A régua tem quatro motivos, e são os mesmos quatro da página de venda:
// sem_ponto, sem_capital, nao_decisor, fluxo_baixo. A aula mostra a régua
// inteira, aberta — inclusive as perguntas e o peso de cada uma. Mostrar o
// critério que reprovou a pessoa é o oposto de vender: é o que faz ela
// acreditar no que vem depois.
//
// Rodar:  node plugcash/aulas/aula-01-porque.js         (prova visual)
//         node plugcash/aulas/aula-01-porque.js --sql   (SQL)
// ─────────────────────────────────────────────────────────────────────────────

const T = '#0A0A0A';
const M = '#6B6B6B';
const V = '#00C853';
const A = '#C2410C';
const CINZA = '#D9D9D9';

const base = (c, w = 720, h = 380) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif">${c}</svg>`;

// ── 1 · A régua aberta ──────────────────────────────────────────────────────
const aRegua = base(`
  <text x="40" y="38" font-size="13" font-weight="700" fill="${M}">O QUE O FORMULÁRIO PERGUNTOU, E QUANTO CADA RESPOSTA VALIA</text>

  <rect x="40" y="56" width="640" height="34" fill="${T}"/>
  <text x="58" y="79" font-size="12.5" font-weight="700" fill="#fff">A pergunta</text>
  <text x="662" y="79" font-size="12.5" font-weight="700" text-anchor="end" fill="#fff">peso</text>

  <rect x="40" y="90" width="640" height="46" fill="#fff" stroke="${CINZA}"/>
  <text x="58" y="112" font-size="13.5" fill="${T}">Você já tem o local onde vai instalar?</text>
  <text x="58" y="130" font-size="11.5" fill="${M}">tenho e é meu · tenho arrendado · estou procurando · não faço ideia</text>
  <text x="662" y="120" font-size="14" font-weight="800" text-anchor="end" fill="${T}">até 3</text>

  <rect x="40" y="136" width="640" height="46" fill="#FAFAFA" stroke="${CINZA}"/>
  <text x="58" y="158" font-size="13.5" fill="${T}">Quanto você tem disponível para investir?</text>
  <text x="58" y="176" font-size="11.5" fill="${M}">faixas declaradas · ou "não sei ainda"</text>
  <text x="662" y="166" font-size="14" font-weight="800" text-anchor="end" fill="${T}">até 3</text>

  <rect x="40" y="182" width="640" height="46" fill="#fff" stroke="${CINZA}"/>
  <text x="58" y="204" font-size="13.5" fill="${T}">A decisão de investir é sua?</text>
  <text x="58" y="222" font-size="11.5" fill="${M}">é minha · divido com sócio · é de terceiros</text>
  <text x="662" y="212" font-size="14" font-weight="800" text-anchor="end" fill="${T}">até 3</text>

  <rect x="40" y="228" width="640" height="46" fill="#FAFAFA" stroke="${CINZA}"/>
  <text x="58" y="250" font-size="13.5" fill="${T}">Que tipo de ponto é?</text>
  <text x="58" y="268" font-size="11.5" fill="${M}">posto · mercado · hotel · estacionamento · investidor sem ponto</text>
  <text x="662" y="258" font-size="14" font-weight="800" text-anchor="end" fill="${T}">até 2</text>

  <rect x="40" y="292" width="200" height="56" rx="8" fill="#FDF0E9" stroke="${A}" stroke-width="2"/>
  <text x="140" y="316" font-size="12.5" font-weight="800" text-anchor="middle" fill="${A}">0 a 4 pontos</text>
  <text x="140" y="336" font-size="12" text-anchor="middle" fill="${T}">você está aqui</text>

  <rect x="260" y="292" width="200" height="56" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="360" y="316" font-size="12.5" font-weight="800" text-anchor="middle" fill="${T}">5 a 8 pontos</text>
  <text x="360" y="336" font-size="12" text-anchor="middle" fill="${M}">reunião pra definir o ponto</text>

  <rect x="480" y="292" width="200" height="56" rx="8" fill="#EAF8EF" stroke="${V}" stroke-width="2"/>
  <text x="580" y="316" font-size="12.5" font-weight="800" text-anchor="middle" fill="${V}">9 a 11 pontos</text>
  <text x="580" y="336" font-size="12" text-anchor="middle" fill="${T}">reunião de projeto</text>
`);

// ── 2 · As quatro faltas ────────────────────────────────────────────────────
const asFaltas = base(`
  <rect x="24" y="34" width="322" height="146" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="48" y="68" font-size="15" font-weight="800" fill="${T}">SEM O PONTO</text>
  <text x="48" y="94" font-size="13" fill="${M}">Você não tem onde instalar, ou tem</text>
  <text x="48" y="114" font-size="13" fill="${M}">dúvida se o que tem serve.</text>
  <rect x="48" y="130" width="274" height="34" rx="6" fill="#F5F5F5"/>
  <text x="62" y="152" font-size="12.5" font-weight="700" fill="${T}">Resolve nas aulas 3, 4 e 12</text>

  <rect x="374" y="34" width="322" height="146" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="398" y="68" font-size="15" font-weight="800" fill="${T}">SEM O CAPITAL</text>
  <text x="398" y="94" font-size="13" fill="${M}">Não sabe quanto precisa, ou não tem</text>
  <text x="398" y="114" font-size="13" fill="${M}">o valor inteiro hoje.</text>
  <rect x="398" y="130" width="274" height="34" rx="6" fill="#F5F5F5"/>
  <text x="412" y="152" font-size="12.5" font-weight="700" fill="${T}">Resolve nas aulas 8 e 13</text>

  <rect x="24" y="198" width="322" height="146" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="48" y="232" font-size="15" font-weight="800" fill="${T}">NÃO É QUEM DECIDE</text>
  <text x="48" y="258" font-size="13" fill="${M}">A palavra final é de um sócio, do</text>
  <text x="48" y="278" font-size="13" fill="${M}">cônjuge ou da diretoria.</text>
  <rect x="48" y="294" width="274" height="34" rx="6" fill="#F5F5F5"/>
  <text x="62" y="316" font-size="12.5" font-weight="700" fill="${T}">Resolve nas aulas 9 e 13</text>

  <rect x="374" y="198" width="322" height="146" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="398" y="232" font-size="15" font-weight="800" fill="${T}">MOVIMENTO INCERTO</text>
  <text x="398" y="258" font-size="13" fill="${M}">O ponto existe, mas ninguém sabe se</text>
  <text x="398" y="278" font-size="13" fill="${M}">passa carro elétrico ali.</text>
  <rect x="398" y="294" width="274" height="34" rx="6" fill="#F5F5F5"/>
  <text x="412" y="316" font-size="12.5" font-weight="700" fill="${T}">Resolve nas aulas 4 e 7</text>
`);

// ── 3 · O caminho de volta ──────────────────────────────────────────────────
const caminho = base(`
  <text x="360" y="42" font-size="15" font-weight="800" text-anchor="middle" fill="${T}">Você não foi eliminado. Foi adiado.</text>

  <line x1="90" y1="180" x2="640" y2="180" stroke="${CINZA}" stroke-width="3"/>

  <circle cx="120" cy="180" r="17" fill="${A}"/>
  <text x="120" y="186" font-size="13" font-weight="800" text-anchor="middle" fill="#fff">1</text>
  <text x="120" y="228" font-size="13" font-weight="800" text-anchor="middle" fill="${T}">hoje</text>
  <text x="120" y="248" font-size="12" text-anchor="middle" fill="${M}">falta uma perna</text>

  <circle cx="290" cy="180" r="17" fill="${T}"/>
  <text x="290" y="186" font-size="13" font-weight="800" text-anchor="middle" fill="#fff">2</text>
  <text x="290" y="228" font-size="13" font-weight="800" text-anchor="middle" fill="${T}">este curso</text>
  <text x="290" y="248" font-size="12" text-anchor="middle" fill="${M}">você resolve a falta</text>

  <circle cx="460" cy="180" r="17" fill="${T}"/>
  <text x="460" y="186" font-size="13" font-weight="800" text-anchor="middle" fill="#fff">3</text>
  <text x="460" y="228" font-size="13" font-weight="800" text-anchor="middle" fill="${T}">você avisa</text>
  <text x="460" y="248" font-size="12" text-anchor="middle" fill="${M}">um botão dentro do app</text>

  <circle cx="620" cy="180" r="19" fill="${V}"/>
  <text x="620" y="187" font-size="13" font-weight="800" text-anchor="middle" fill="#fff">4</text>
  <text x="620" y="228" font-size="13" font-weight="800" text-anchor="middle" fill="${V}">a reunião</text>
  <text x="620" y="248" font-size="12" text-anchor="middle" fill="${M}">agora com projeto</text>

  <rect x="90" y="286" width="550" height="62" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="112" y="312" font-size="13.5" font-weight="800" fill="${T}">O botão "já resolvi" fica na sua conta, dentro do app.</text>
  <text x="112" y="334" font-size="13" fill="${M}">Ele reabre a agenda pra você — sem passar pelo formulário de novo.</text>
`);

// ── 4 · Por que a agenda é fechada ──────────────────────────────────────────
const porQueFechada = base(`
  <text x="40" y="40" font-size="13" font-weight="700" fill="${M}">O QUE ACONTECE NUMA REUNIÃO SEM AS TRÊS PERNAS</text>

  <rect x="40" y="60" width="640" height="110" rx="10" fill="#FDF0E9" stroke="${A}" stroke-width="2"/>
  <text x="62" y="92" font-size="14.5" font-weight="800" fill="${A}">Uma hora de conversa, um orçamento bonito, e nada acontece.</text>
  <text x="62" y="120" font-size="13.5" fill="${T}">Sem local definido, o orçamento é chute: a carga do ponto muda o preço inteiro.</text>
  <text x="62" y="142" font-size="13.5" fill="${T}">Sem forma de pagar, o número não vira decisão.</text>
  <text x="62" y="164" font-size="13.5" fill="${T}">Sem quem decide na sala, a resposta é sempre "vou levar pro meu sócio".</text>

  <rect x="40" y="196" width="640" height="140" rx="10" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="62" y="228" font-size="14.5" font-weight="800" fill="${V}">Por que isso é bom para você, e não só pra gente</text>
  <text x="62" y="258" font-size="13.5" fill="${T}">Um orçamento feito sobre chute te dá um número que você não pode usar:</text>
  <text x="62" y="280" font-size="13.5" fill="${T}">não serve pro banco, não serve pro sócio, não serve pra comparar proposta.</text>
  <text x="62" y="308" font-size="13.5" font-weight="700" fill="${T}">E o pior: ele te dá a sensação de que você já decidiu — quando não decidiu nada.</text>
`);

const PAGINAS = [
  {
    ordem: 1,
    titulo: 'Primeiro, o que isto aqui não é',
    texto: 'Este curso não é o prêmio de consolação de quem não conseguiu a reunião. É a parte do trabalho que vem antes dela — e que, feita direito, faz a reunião valer alguma coisa.',
    destaque: 'Você pagou por informação, não por atenção. Nas próximas aulas ninguém vai te elogiar: vai te dar conta pra fazer.',
  },
  {
    ordem: 2,
    titulo: 'A régua que te barrou, aberta',
    svg: aRegua,
    legenda: 'São quatro perguntas e onze pontos. Nada aqui é secreto — e mostrar o critério é o mínimo que a gente deve a quem respondeu.',
    texto: 'Você somou de 0 a 4. Isso não mede o seu potencial nem o seu dinheiro: mede quantas das três pernas de um projeto já estão de pé no seu caso.',
  },
  {
    ordem: 3,
    titulo: 'Qual das quatro faltas é a sua',
    svg: asFaltas,
    legenda: 'Ache a sua e vá direto nas aulas indicadas. O curso funciona em ordem, mas a sua urgência tem endereço.',
  },
  {
    ordem: 4,
    titulo: 'Por que a agenda fecha para quem tem uma falta',
    svg: porQueFechada,
    legenda: 'A reunião não foi negada por desinteresse. Foi negada porque ela não produziria nada de útil para você.',
    destaque: 'Orçamento feito sobre chute não serve pro banco, não serve pro sócio e não serve pra comparar proposta. Só serve pra te dar a sensação de que você já decidiu.',
  },
  {
    ordem: 5,
    titulo: 'O caminho de volta, e como avisar',
    svg: caminho,
    legenda: 'Quando você resolver a sua falta, o botão "já resolvi" na sua conta reabre a agenda — sem refazer o formulário.',
  },
  {
    ordem: 6,
    titulo: 'Como este curso está organizado',
    lista: [
      'As aulas 2 a 7 respondem se o SEU ponto presta: quanto sobra por recarga, quanto movimento passa, quanta energia tem e que potência cabe.',
      'As aulas 8 a 12 respondem quanto custa e como se paga: do que é feito o preço, como abrir uma proposta, o que faz o protocolo voltar e como montar sem ser dono do imóvel.',
      'A aula 13 junta tudo numa conta só — a mesma conta que a nossa equipe usa em Estudo de Viabilidade de cliente.',
      'A aula 14 diz o que fazer na segunda-feira de manhã.',
    ],
    destaque: 'Uma ideia por página, um desenho por ideia. Se você levar mais de meia hora numa aula, ela está mal escrita — e eu quero saber.',
  },
  {
    ordem: 7,
    titulo: 'Uma promessa e um aviso',
    texto: 'A promessa: quando você terminar, vai conseguir abrir qualquer proposta de eletroposto e apontar o que ficou de fora — inclusive numa proposta nossa. É de propósito. Se você contratar outro executor com o nosso checklist na mão, este material fez o trabalho dele.',
    destaque: 'O aviso: nenhuma aula vai te dizer que o seu ponto presta. Elas te dão o método para descobrir — e "não presta" é uma resposta que vale o preço do curso.',
  },
];

if (process.argv.includes('--sql')) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(`update public.pc_aulas set paginas = ${q(JSON.stringify(PAGINAS))}::jsonb, duracao_seg = 16*60
      where ordem = 1 and curso_id = (select id from public.pc_cursos where slug = 'fundamentos');`);
} else {
  const puppeteer = require('puppeteer'); const path = require('path');
  (async () => {
    const svgs = PAGINAS.filter((p) => p.svg);
    const html = `<html><head><meta charset=utf-8><style>
      body{margin:0;padding:28px;background:#F5F5F5;font-family:Inter,Segoe UI,Arial,sans-serif;width:840px}
      .p{background:#fff;border:1px solid #D9D9D9;border-radius:16px;padding:24px;margin-bottom:20px}
      h3{margin:0 0 14px;font-size:19px;font-weight:800}
      .d{background:#F5F5F5;border:1px solid #D9D9D9;border-radius:12px;padding:20px}
      .d svg{width:100%;height:auto;display:block}</style></head><body>${
      svgs.map((p) => `<div class=p><h3>${p.ordem}. ${p.titulo}</h3><div class=d>${p.svg}</div></div>`).join('')
    }</body></html>`;
    const b = await puppeteer.launch({ headless: 'new' }); const pg = await b.newPage();
    await pg.setViewport({ width: 840, height: 1200 });
    await pg.setContent(html, { waitUntil: 'domcontentloaded' });
    const saida = path.join(__dirname, 'prova-aula-01.png');
    await pg.screenshot({ path: saida, fullPage: true }); await b.close();
    console.log(`${svgs.length} diagramas → ${saida}`);
  })();
}
module.exports = { PAGINAS };
