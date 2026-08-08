// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTOS · AULA 4 — "Como medir o movimento de um ponto sem contratar pesquisa"
//
// É a aula que produz o número mais pesado da conta da aula 13: recargas por
// dia. A gangorra da 13 mostra que ele manda em tudo — e é justamente o que
// todo mundo chuta.
//
// Filosofia da casa: o menu Eletroposto tem Pesquisa, Mercado, Postos e Mapa
// porque a equipe NÃO chuta demanda — ela olha dado público. Esta aula ensina o
// mesmo hábito na escala de uma pessoa com um celular.
//
// Rodar:  node plugcash/aulas/aula-04-movimento.js [--sql]
// ─────────────────────────────────────────────────────────────────────────────

const T = '#0A0A0A';
const M = '#6B6B6B';
const V = '#00C853';
const A = '#C2410C';
const CINZA = '#D9D9D9';

const base = (c, w = 720, h = 380) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif">${c}</svg>`;

// ── 1 · O funil do movimento ────────────────────────────────────────────────
const funil = base(`
  <text x="40" y="38" font-size="13" font-weight="700" fill="${M}">DE TODO MUNDO QUE PASSA ATÉ QUEM PLUGA NO SEU PONTO</text>

  <rect x="40" y="58" width="640" height="46" rx="6" fill="${T}"/>
  <text x="60" y="87" font-size="14" font-weight="700" fill="#fff">carros que passam na via</text>
  <text x="660" y="87" font-size="13" text-anchor="end" fill="#fff">você conta</text>

  <rect x="40" y="116" width="440" height="46" rx="6" fill="#6B6B6B"/>
  <text x="60" y="145" font-size="14" font-weight="700" fill="#fff">que são elétricos ou híbridos plug-in</text>
  <text x="500" y="145" font-size="13" fill="${T}">você conta</text>

  <rect x="40" y="174" width="250" height="46" rx="6" fill="#9A9A9A"/>
  <text x="60" y="203" font-size="14" font-weight="700" fill="#fff">que precisam carregar agora</text>
  <text x="310" y="203" font-size="13" fill="${T}">estimativa</text>

  <rect x="40" y="232" width="140" height="46" rx="6" fill="#B9B9B9"/>
  <text x="60" y="261" font-size="14" font-weight="700" fill="#fff">que param</text>
  <text x="200" y="261" font-size="13" fill="${T}">depende de você: preço, sinalização, app</text>

  <rect x="40" y="290" width="76" height="46" rx="6" fill="${V}"/>
  <text x="136" y="319" font-size="14" font-weight="800" fill="${T}">recargas por dia — o número que vai pra conta</text>

  <text x="40" y="362" font-size="12" fill="${M}">Os dois primeiros degraus você MEDE. Os dois últimos você estima — e por isso a conta vira faixa, não número.</text>
`);

// ── 2 · A contagem de calçada ───────────────────────────────────────────────
const contagem = base(`
  <text x="360" y="40" font-size="15" font-weight="800" text-anchor="middle" fill="${T}">Trinta minutos, três vezes, no papel</text>

  <rect x="40" y="66" width="200" height="128" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="140" y="98" font-size="13" font-weight="800" text-anchor="middle" fill="${T}">DIA ÚTIL</text>
  <text x="140" y="126" font-size="19" font-weight="800" text-anchor="middle" fill="${T}">7h — 9h</text>
  <text x="140" y="152" font-size="12.5" text-anchor="middle" fill="${M}">quem vai trabalhar</text>
  <text x="140" y="176" font-size="12.5" text-anchor="middle" fill="${M}">passa, não para</text>

  <rect x="260" y="66" width="200" height="128" rx="10" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="360" y="98" font-size="13" font-weight="800" text-anchor="middle" fill="${V}">DIA ÚTIL</text>
  <text x="360" y="126" font-size="19" font-weight="800" text-anchor="middle" fill="${T}">17h — 19h</text>
  <text x="360" y="152" font-size="12.5" text-anchor="middle" fill="${M}">o pico de quase todo</text>
  <text x="360" y="176" font-size="12.5" text-anchor="middle" fill="${M}">ponto de destino</text>

  <rect x="480" y="66" width="200" height="128" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="580" y="98" font-size="13" font-weight="800" text-anchor="middle" fill="${T}">SÁBADO</text>
  <text x="580" y="126" font-size="19" font-weight="800" text-anchor="middle" fill="${T}">10h — 12h</text>
  <text x="580" y="152" font-size="12.5" text-anchor="middle" fill="${M}">o dia que decide</text>
  <text x="580" y="176" font-size="12.5" text-anchor="middle" fill="${M}">comércio de rua</text>

  <rect x="40" y="220" width="640" height="128" rx="10" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="62" y="252" font-size="14" font-weight="800" fill="${T}">O que anotar em cada janela</text>
  <text x="62" y="282" font-size="13.5" fill="${T}">1. Quantos carros passaram no total (risquinho a cada um, sem app nenhum).</text>
  <text x="62" y="304" font-size="13.5" fill="${T}">2. Quantos eram elétricos ou híbridos plug-in — placa, emblema, ausência de escapamento.</text>
  <text x="62" y="326" font-size="13.5" fill="${T}">3. Quantos ENTRARAM no seu comércio, não só passaram na frente.</text>
`);

// ── 3 · Passante x parador ──────────────────────────────────────────────────
const passanteParador = base(`
  <text x="40" y="38" font-size="13" font-weight="700" fill="${M}">DUAS CONTAS DIFERENTES, E QUASE TODO MUNDO USA A ERRADA</text>

  <rect x="40" y="60" width="310" height="286" rx="10" fill="#fff" stroke="${A}" stroke-width="2.5"/>
  <text x="64" y="94" font-size="15" font-weight="800" fill="${A}">QUEM PASSA</text>
  <text x="64" y="122" font-size="13" fill="${M}">O número grande e inútil.</text>
  <line x1="64" y1="140" x2="326" y2="140" stroke="${CINZA}"/>
  <text x="64" y="168" font-size="13.5" fill="${T}">"Passam 8 mil carros por dia"</text>
  <text x="64" y="192" font-size="13.5" fill="${T}">soa ótimo numa reunião</text>
  <text x="64" y="228" font-size="13" fill="${M}">Mas passar não é parar. A pessoa</text>
  <text x="64" y="250" font-size="13" fill="${M}">está indo pra algum lugar, e o seu</text>
  <text x="64" y="272" font-size="13" fill="${M}">ponto não é ele.</text>
  <rect x="64" y="292" width="262" height="38" rx="6" fill="#FDF0E9"/>
  <text x="78" y="316" font-size="12.5" font-weight="700" fill="${A}">Serve pra ponto de PASSAGEM</text>

  <rect x="374" y="60" width="310" height="286" rx="10" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="398" y="94" font-size="15" font-weight="800" fill="${V}">QUEM ENTRA</text>
  <text x="398" y="122" font-size="13" fill="${M}">O número pequeno e verdadeiro.</text>
  <line x1="398" y1="140" x2="660" y2="140" stroke="${CINZA}"/>
  <text x="398" y="168" font-size="13.5" fill="${T}">Quantos carros estacionam no seu</text>
  <text x="398" y="192" font-size="13.5" fill="${T}">comércio por dia — você já sabe</text>
  <text x="398" y="228" font-size="13" fill="${M}">Se você tem mercado, hotel ou posto,</text>
  <text x="398" y="250" font-size="13" fill="${M}">esse dado está no seu caixa: número</text>
  <text x="398" y="272" font-size="13" fill="${M}">de clientes por dia.</text>
  <rect x="398" y="292" width="262" height="38" rx="6" fill="#EAF8EF"/>
  <text x="412" y="316" font-size="12.5" font-weight="700" fill="${V}">Serve pra ponto de DESTINO</text>
`);

// ── 4 · O que dá pra saber sem sair de casa ─────────────────────────────────
const dadoPublico = base(`
  <text x="360" y="40" font-size="15" font-weight="800" text-anchor="middle" fill="${T}">Três fontes públicas, meia hora, custo zero</text>

  <rect x="40" y="62" width="640" height="86" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="62" y="92" font-size="14" font-weight="800" fill="${T}">1 · Quantos elétricos existem no seu estado</text>
  <text x="62" y="118" font-size="13" fill="${M}">Emplacamento é público e sai todo mês. O que importa é a CURVA dos últimos 12 meses,</text>
  <text x="62" y="136" font-size="13" fill="${M}">não o total: ela diz se a sua região está entrando na onda ou olhando ela passar.</text>

  <rect x="40" y="158" width="640" height="86" rx="10" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="62" y="188" font-size="14" font-weight="800" fill="${T}">2 · Quantos pontos de recarga já existem no raio que interessa</text>
  <text x="62" y="214" font-size="13" fill="${M}">Os apps de recarga são mapas abertos. Conte os que estão a 10 minutos de você, anote a</text>
  <text x="62" y="232" font-size="13" fill="${M}">potência de cada um e leia as avaliações — elas dizem quais vivem quebrados.</text>

  <rect x="40" y="254" width="640" height="86" rx="10" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="62" y="284" font-size="14" font-weight="800" fill="${V}">3 · O movimento da sua rua, por hora</text>
  <text x="62" y="310" font-size="13" fill="${M}">O mapa que você usa pra trânsito mostra o horário de pico de qualquer endereço comercial.</text>
  <text x="62" y="328" font-size="13" fill="${M}">É a checagem que confirma — ou desmente — a sua contagem de calçada.</text>

  <text x="360" y="366" font-size="12" text-anchor="middle" fill="${M}">Nenhuma delas custa dinheiro. Todas estão a um celular de distância.</text>
`, 720, 392);

// ── 5 · Do movimento à recarga ──────────────────────────────────────────────
const paraRecarga = base(`
  <text x="40" y="40" font-size="13" font-weight="700" fill="${M}">A ÚNICA CONTA DESTA AULA</text>

  <rect x="40" y="62" width="640" height="52" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="360" y="94" font-size="15" font-weight="800" text-anchor="middle" fill="${T}">carros que entram × % de elétricos × % que decide parar = recargas/dia</text>

  <rect x="40" y="136" width="200" height="96" rx="8" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="140" y="164" font-size="12.5" text-anchor="middle" fill="${M}">você contou</text>
  <text x="140" y="196" font-size="24" font-weight="800" text-anchor="middle" fill="${T}">180</text>
  <text x="140" y="218" font-size="12" text-anchor="middle" fill="${M}">carros/dia entram</text>

  <text x="256" y="192" font-size="20" font-weight="800" text-anchor="middle" fill="${M}">×</text>

  <rect x="272" y="136" width="200" height="96" rx="8" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="372" y="164" font-size="12.5" text-anchor="middle" fill="${M}">você contou</text>
  <text x="372" y="196" font-size="24" font-weight="800" text-anchor="middle" fill="${T}">6%</text>
  <text x="372" y="218" font-size="12" text-anchor="middle" fill="${M}">são plug-in</text>

  <text x="488" y="192" font-size="20" font-weight="800" text-anchor="middle" fill="${M}">×</text>

  <rect x="504" y="136" width="176" height="96" rx="8" fill="#fff" stroke="${A}" stroke-width="2.5"/>
  <text x="592" y="164" font-size="12.5" text-anchor="middle" fill="${A}">você ESTIMA</text>
  <text x="592" y="196" font-size="24" font-weight="800" text-anchor="middle" fill="${T}">30%</text>
  <text x="592" y="218" font-size="12" text-anchor="middle" fill="${M}">param pra carregar</text>

  <rect x="180" y="256" width="360" height="62" rx="8" fill="#EAF8EF" stroke="${V}" stroke-width="2.5"/>
  <text x="360" y="282" font-size="13" text-anchor="middle" fill="${M}">recargas por dia, cenário base</text>
  <text x="360" y="308" font-size="22" font-weight="800" text-anchor="middle" fill="${T}">3,2</text>

  <text x="40" y="352" font-size="12" fill="${M}">O terceiro fator é o único chutado — por isso ele vira faixa (15% / 30% / 50%) e gera os três cenários da aula 13.</text>
`);

const PAGINAS = [
  {
    ordem: 1,
    titulo: 'O número mais pesado da conta é o mais chutado',
    texto: 'Na aula 13 você vai ver uma gangorra: mexer 30% no movimento move o retorno mais do que mexer 30% no preço do equipamento. E é justamente o movimento que quase todo mundo estima de cabeça, olhando a rua e achando que "passa bastante carro".',
    destaque: 'Duas horas de calçada valem mais que duas semanas pechinchando carregador.',
  },
  {
    ordem: 2,
    titulo: 'O funil, do que passa ao que pluga',
    svg: funil,
    legenda: 'Os dois primeiros degraus você mede. Os dois últimos você estima — e é por isso que a conta final vira faixa.',
  },
  {
    ordem: 3,
    titulo: 'Quem passa não é quem entra',
    svg: passanteParador,
    legenda: 'Ponto de passagem vive de quem passa. Ponto de destino vive de quem entra. Usar o número errado infla tudo.',
    destaque: 'Se você já tem comércio, o número que interessa está no seu caixa: quantos clientes por dia. Você já mediu, sem saber.',
  },
  {
    ordem: 4,
    titulo: 'A contagem de calçada, em três janelas',
    svg: contagem,
    legenda: 'Papel e caneta. Nenhum aplicativo faz isso melhor do que você olhando a sua própria rua.',
    texto: 'Faça em três dias diferentes, não em três horas do mesmo dia. Chuva, feriado e véspera de feriado mentem — anote o clima junto e descarte o dia estranho.',
  },
  {
    ordem: 5,
    titulo: 'Três fontes públicas que confirmam o que você contou',
    svg: dadoPublico,
    legenda: 'É o mesmo hábito que a nossa equipe usa antes de qualquer estudo: olhar dado público antes de opinar.',
  },
  {
    ordem: 6,
    titulo: 'Como identificar um elétrico passando',
    lista: [
      'Placa: veículos elétricos e híbridos têm identificação própria em boa parte dos estados — vale conferir a regra da sua região antes de contar.',
      'Ausência de escapamento é o sinal mais rápido num carro parado.',
      'Emblemas de modelo: os elétricos que mais vendem no Brasil hoje são poucos e repetidos. Aprenda a reconhecer os cinco mais comuns na sua cidade e você acerta a maioria.',
      'Na dúvida, não conte. Um erro para menos te protege; um erro para mais te custa equipamento.',
    ],
    destaque: 'Sub-contar é conservador. Super-contar é o começo de um prejuízo.',
  },
  {
    ordem: 7,
    titulo: 'Do movimento para a recarga',
    svg: paraRecarga,
    legenda: 'Dois fatores medidos e um estimado. É esse número que a aula 13 multiplica.',
  },
  {
    ordem: 8,
    titulo: 'O erro de leitura mais comum',
    texto: 'Muita gente conta o movimento de hoje e projeta o eletroposto de hoje. Mas o ponto vai operar por dez anos, e a frota do seu estado está crescendo — ou não. A curva de emplacamento diz qual dos dois.',
    destaque: 'Você não instala para o movimento de hoje. Instala para o de daqui a dois anos, e paga a conta com o de hoje. Os dois números precisam caber.',
  },
  {
    ordem: 9,
    titulo: 'O que levar desta aula',
    lista: [
      'Carros que entram no seu ponto por dia — do caixa, se você tem comércio; da calçada, se não tem.',
      'O percentual de plug-in que você contou, em três janelas diferentes.',
      'Quantos pontos de recarga existem a 10 minutos, e de que potência.',
      'A curva de emplacamento de elétricos do seu estado nos últimos 12 meses.',
      'Recargas por dia em três faixas: conservador, base e otimista.',
    ],
    destaque: 'A última linha é a entrada mais importante da aula 13. Chegue lá com três números, não com um.',
  },
];

if (process.argv.includes('--sql')) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(`update public.pc_aulas set paginas = ${q(JSON.stringify(PAGINAS))}::jsonb, duracao_seg = 26*60
      where ordem = 4 and curso_id = (select id from public.pc_cursos where slug = 'fundamentos');`);
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
    const saida = path.join(__dirname, 'prova-aula-04.png');
    await pg.screenshot({ path: saida, fullPage: true }); await b.close();
    console.log(`${svgs.length} diagramas → ${saida}`);
  })();
}
module.exports = { PAGINAS };
