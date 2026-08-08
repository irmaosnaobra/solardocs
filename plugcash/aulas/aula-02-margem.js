// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTOS · AULA 2 — "Quanto sobra por recarga"
//
// Primeira aula com número na tela, e por isso a que decide se a pessoa confia
// no curso. Ela compra energia num preço e entrega noutro: a aula inteira é
// sobre a diferença — e sobre tudo o que come essa diferença antes de virar
// dinheiro dela.
//
// FILOSOFIA DA CASA (Estudo de Viabilidade do Simulador, premissas 1 e 3):
//   · Receita = kWh × preço de revenda + TAXA DE ATIVAÇÃO por sessão.
//     A taxa de ativação existe e quase toda planilha de fornecedor esquece.
//   · Custos variáveis: energia, gateway, arrendamento, manutenção, imposto —
//     acompanham a ocupação. É esta lista que sai da margem, não só a energia.
//   · Termos reais, sem inflação.
//
// NENHUMA TARIFA INVENTADA. Os números da tela são de exemplo e estão marcados.
// O que a aula ensina é onde ler o preço real na conta de luz da pessoa — que
// é a única fonte que não envelhece.
//
// Rodar:  node plugcash/aulas/aula-02-margem.js         (prova visual)
//         node plugcash/aulas/aula-02-margem.js --sql   (SQL)
// ─────────────────────────────────────────────────────────────────────────────

const T = '#0A0A0A';
const M = '#6B6B6B';
const V = '#00C853';
const A = '#C2410C';
const CINZA = '#D9D9D9';

const base = (conteudo, w = 720, h = 380) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif">${conteudo}</svg>`;

// ── 1 · O negócio inteiro numa figura ───────────────────────────────────────
const compraVende = base(`
  <rect x="40" y="70" width="200" height="110" rx="10" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="140" y="106" font-size="13" text-anchor="middle" fill="${M}">você COMPRA o kWh</text>
  <text x="140" y="140" font-size="27" font-weight="800" text-anchor="middle" fill="${T}">R$ 0,81</text>
  <text x="140" y="164" font-size="11.5" text-anchor="middle" fill="${M}">custo real, próxima página</text>

  <path d="M248 125 L318 125" stroke="${M}" stroke-width="2.5"/>
  <path d="M310 118 L318 125 L310 132" fill="none" stroke="${M}" stroke-width="2.5"/>

  <rect x="326" y="70" width="200" height="110" rx="10" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="426" y="106" font-size="13" text-anchor="middle" fill="${M}">você VENDE o kWh</text>
  <text x="426" y="140" font-size="27" font-weight="800" text-anchor="middle" fill="${V}">R$ 2,20</text>
  <text x="426" y="164" font-size="11.5" text-anchor="middle" fill="${M}">preço que você define</text>

  <path d="M534 125 L604 125" stroke="${V}" stroke-width="2.5"/>
  <path d="M596 118 L604 125 L596 132" fill="none" stroke="${V}" stroke-width="2.5"/>

  <rect x="612" y="70" width="72" height="110" rx="10" fill="#EAF8EF" stroke="${V}" stroke-width="2"/>
  <text x="648" y="118" font-size="11.5" text-anchor="middle" fill="${V}">sobra</text>
  <text x="648" y="146" font-size="17" font-weight="800" text-anchor="middle" fill="${V}">1,39</text>

  <rect x="40" y="216" width="644" height="120" rx="10" fill="#FDF0E9" stroke="${A}" stroke-width="2"/>
  <text x="62" y="248" font-size="14.5" font-weight="800" fill="${A}">Só que essa sobra ainda não é sua.</text>
  <text x="62" y="278" font-size="13.5" fill="${T}">Dela ainda saem: gateway de pagamento, imposto sobre a venda,</text>
  <text x="62" y="300" font-size="13.5" fill="${T}">o que você paga ao dono do imóvel e a manutenção do equipamento.</text>
  <text x="62" y="326" font-size="13" fill="${M}">Números de exemplo — os seus saem da sua conta de luz e da sua praça.</text>
`);

// ── 2 · Onde ler o preço REAL do seu kWh ────────────────────────────────────
const precoReal = base(`
  <rect x="40" y="28" width="330" height="324" rx="8" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="62" y="60" font-size="15" font-weight="700" fill="${T}">CONTA DE ENERGIA</text>
  <line x1="62" y1="72" x2="348" y2="72" stroke="${M}" stroke-width="1"/>

  <text x="62" y="100" font-size="12" fill="${M}">Consumo</text>
  <text x="330" y="100" font-size="13" text-anchor="end" fill="${T}">4.820 kWh</text>

  <text x="62" y="128" font-size="12" fill="${M}">Energia (TE)</text>
  <text x="330" y="128" font-size="13" text-anchor="end" fill="${T}">R$ 1.542,40</text>

  <text x="62" y="156" font-size="12" fill="${M}">Distribuição (TUSD)</text>
  <text x="330" y="156" font-size="13" text-anchor="end" fill="${T}">R$ 1.108,60</text>

  <text x="62" y="184" font-size="12" fill="${M}">Demanda</text>
  <text x="330" y="184" font-size="13" text-anchor="end" fill="${T}">R$ 486,00</text>

  <text x="62" y="212" font-size="12" fill="${M}">Bandeira</text>
  <text x="330" y="212" font-size="13" text-anchor="end" fill="${T}">R$ 96,40</text>

  <text x="62" y="240" font-size="12" fill="${M}">Tributos</text>
  <text x="330" y="240" font-size="13" text-anchor="end" fill="${T}">R$ 680,80</text>

  <rect x="52" y="256" width="306" height="60" rx="6" fill="none" stroke="${V}" stroke-width="2.5"/>
  <text x="62" y="280" font-size="12" font-weight="700" fill="${V}">TOTAL A PAGAR</text>
  <text x="330" y="304" font-size="19" font-weight="800" text-anchor="end" fill="${T}">R$ 3.914,20</text>

  <path d="M368 286 L432 286" stroke="${V}" stroke-width="2.5"/>
  <path d="M424 279 L432 286 L424 293" fill="none" stroke="${V}" stroke-width="2.5"/>

  <text x="450" y="88" font-size="15" font-weight="800" fill="${T}">Não olhe a linha</text>
  <text x="450" y="110" font-size="15" font-weight="800" fill="${T}">"energia".</text>

  <text x="450" y="146" font-size="13.5" fill="${M}">Ela é menos da metade</text>
  <text x="450" y="166" font-size="13.5" fill="${M}">do que você paga.</text>

  <rect x="450" y="190" width="234" height="112" rx="8" fill="#EAF8EF" stroke="${V}" stroke-width="2"/>
  <text x="466" y="216" font-size="12.5" font-weight="800" fill="${V}">O SEU CUSTO REAL</text>
  <text x="466" y="244" font-size="13" fill="${T}">total a pagar</text>
  <text x="466" y="266" font-size="13" fill="${T}">dividido pelo consumo</text>
  <line x1="466" y1="278" x2="668" y2="278" stroke="${V}" stroke-width="1"/>
  <text x="466" y="296" font-size="16" font-weight="800" fill="${T}">R$ 0,81 / kWh</text>

  <text x="450" y="330" font-size="12" fill="${M}">Uma divisão. É o número que entra na conta —</text>
  <text x="450" y="348" font-size="12" fill="${M}">e ele muda todo mês com a bandeira.</text>
`);

// ── 3 · A cascata: do preço de venda até o que sobra ────────────────────────
const cascata = base(`
  <text x="40" y="38" font-size="13" font-weight="700" fill="${M}">O QUE ACONTECE COM CADA R$ 2,20 QUE O MOTORISTA PAGA</text>

  <rect x="40" y="58" width="640" height="42" rx="5" fill="${V}"/>
  <text x="60" y="85" font-size="14" font-weight="800" fill="#fff">preço de venda · R$ 2,20</text>

  <rect x="40" y="112" width="236" height="38" rx="5" fill="#8A8A8A"/>
  <text x="60" y="137" font-size="13" fill="#fff">energia que você comprou</text>
  <text x="292" y="137" font-size="13" font-weight="700" fill="${T}">− R$ 0,81</text>

  <rect x="40" y="162" width="58" height="38" rx="5" fill="#A8A8A8"/>
  <text x="114" y="187" font-size="13" fill="${T}">gateway de pagamento</text>
  <text x="292" y="187" font-size="13" font-weight="700" fill="${T}">− R$ 0,07</text>

  <rect x="40" y="212" width="88" height="38" rx="5" fill="#A8A8A8"/>
  <text x="144" y="237" font-size="13" fill="${T}">imposto sobre a venda</text>
  <text x="292" y="237" font-size="13" font-weight="700" fill="${T}">− R$ 0,15</text>

  <rect x="40" y="262" width="70" height="38" rx="5" fill="#A8A8A8"/>
  <text x="126" y="287" font-size="13" fill="${T}">repasse ao dono do imóvel</text>
  <text x="292" y="287" font-size="13" font-weight="700" fill="${T}">− R$ 0,11</text>

  <rect x="386" y="112" width="294" height="188" rx="8" fill="#EAF8EF" stroke="${V}" stroke-width="2.5"/>
  <text x="410" y="146" font-size="13" font-weight="800" fill="${V}">SOBRA DE VERDADE</text>
  <text x="410" y="196" font-size="34" font-weight="800" fill="${T}">R$ 1,06</text>
  <text x="410" y="224" font-size="13" fill="${M}">por kWh vendido</text>
  <line x1="410" y1="240" x2="656" y2="240" stroke="${V}" stroke-width="1"/>
  <text x="410" y="262" font-size="13" fill="${T}">A sobra bruta de R$ 1,39</text>
  <text x="410" y="282" font-size="13" font-weight="700" fill="${A}">era 31% maior que esta.</text>

  <text x="40" y="336" font-size="12" fill="${M}">Percentuais de exemplo. Os do gateway e do imposto você exige por escrito; o repasse você negocia.</text>
`);

// ── 4 · A taxa de ativação, a linha que ninguém coloca ──────────────────────
const ativacao = base(`
  <text x="360" y="44" font-size="15" font-weight="800" text-anchor="middle" fill="${T}">Duas fontes de receita, não uma</text>

  <rect x="40" y="72" width="310" height="140" rx="10" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="64" y="106" font-size="14" font-weight="800" fill="${T}">POR ENERGIA</text>
  <text x="64" y="132" font-size="13" fill="${M}">kWh entregue × preço de revenda</text>
  <text x="64" y="168" font-size="13" fill="${T}">quem carrega muito paga mais</text>
  <text x="64" y="192" font-size="13" fill="${M}">é a maior parte, e é variável</text>

  <rect x="370" y="72" width="310" height="140" rx="10" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="394" y="106" font-size="14" font-weight="800" fill="${V}">POR SESSÃO</text>
  <text x="394" y="132" font-size="13" fill="${M}">taxa fixa de ativação, por plugada</text>
  <text x="394" y="168" font-size="13" fill="${T}">quem para 10 minutos também paga</text>
  <text x="394" y="192" font-size="13" fill="${M}">pequena, e sustenta o ponto no mês fraco</text>

  <rect x="40" y="236" width="640" height="100" rx="10" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="64" y="268" font-size="14" font-weight="800" fill="${T}">Por que a taxa de ativação existe</text>
  <text x="64" y="296" font-size="13.5" fill="${M}">Um carro que ocupa o conector por 15 minutos e leva 4 kWh custa a você quase o</text>
  <text x="64" y="318" font-size="13.5" fill="${M}">mesmo que um que leva 40 — a vaga ficou ocupada igual. A taxa cobra a ocupação.</text>
`);

// ── 5 · O preço não é livre: quem manda é a gasolina ────────────────────────
const teto = base(`
  <text x="40" y="40" font-size="13" font-weight="700" fill="${M}">O SEU PREÇO VIVE ENTRE DOIS LIMITES</text>

  <line x1="90" y1="86" x2="90" y2="316" stroke="${T}" stroke-width="2"/>

  <line x1="90" y1="110" x2="660" y2="110" stroke="${A}" stroke-width="2.5"/>
  <text x="106" y="100" font-size="13.5" font-weight="800" fill="${A}">TETO — o que ele gastaria de gasolina no mesmo trecho</text>
  <text x="106" y="132" font-size="12.5" fill="${M}">Passou daqui, carregar deixa de compensar e ele carrega em casa.</text>

  <line x1="90" y1="286" x2="660" y2="286" stroke="${T}" stroke-width="2.5"/>
  <text x="106" y="276" font-size="13.5" font-weight="800" fill="${T}">PISO — o seu custo real por kWh, mais os descontos da cascata</text>
  <text x="106" y="308" font-size="12.5" fill="${M}">Abaixo daqui você está pagando para trabalhar.</text>

  <rect x="106" y="160" width="440" height="98" rx="8" fill="#EAF8EF" stroke="${V}" stroke-width="2.5"/>
  <text x="130" y="192" font-size="14.5" font-weight="800" fill="${V}">A FAIXA ONDE VOCÊ DECIDE</text>
  <text x="130" y="220" font-size="13.5" fill="${T}">Perto do teto: margem alta, ponto mais vazio.</text>
  <text x="130" y="244" font-size="13.5" fill="${T}">Perto do piso: fila, margem fina, equipamento se pagando devagar.</text>

  <text x="574" y="200" font-size="12.5" fill="${M}">Não existe</text>
  <text x="574" y="220" font-size="12.5" fill="${M}">preço certo.</text>
  <text x="574" y="244" font-size="12.5" font-weight="700" fill="${T}">Existe faixa,</text>
  <text x="574" y="264" font-size="12.5" font-weight="700" fill="${T}">e escolha.</text>

  <text x="40" y="352" font-size="12.5" fill="${M}">O teto se calcula: quantos km aquele kWh rende, e quanto custaria rodar os mesmos km a combustível.</text>
`);

// ── Páginas ────────────────────────────────────────────────────────────────
const PAGINAS = [
  {
    ordem: 1,
    titulo: 'O negócio é a diferença, não a venda',
    svg: compraVende,
    legenda: 'Você compra energia num preço e entrega noutro. Tudo o mais neste curso existe para proteger essa diferença.',
    texto: 'Quem olha só o preço de venda acha que o negócio é ótimo. Quem olha só o preço de compra acha que é apertado. O negócio é o que sobra depois de tudo o que come essa diferença — e é isso que a gente vai calcular agora.',
  },
  {
    ordem: 2,
    titulo: 'Onde ler o preço real do seu kWh',
    svg: precoReal,
    legenda: 'Divida o total a pagar pelo consumo do mês. Uma divisão, feita na sua conta, com o seu número.',
    destaque: 'A linha "energia" da conta é menos da metade do que você paga. Usar ela como custo é o jeito mais rápido de inflar a margem no papel.',
  },
  {
    ordem: 3,
    titulo: 'Três coisas que mexem nesse número todo mês',
    lista: [
      'Bandeira tarifária: muda mensalmente e entra inteira no seu custo. Pegue a média dos últimos 12 meses, nunca o mês mais barato.',
      'Demanda contratada: se o eletroposto obrigar a contratar mais demanda, esse aumento é custo do eletroposto — não da loja que já existia.',
      'Horário: em algumas modalidades tarifárias a energia da ponta custa muito mais. Se o seu movimento for justamente no fim da tarde, isso não é detalhe.',
    ],
    destaque: 'Custo de energia não é um número. É uma média que você precisa saber defender.',
  },
  {
    ordem: 4,
    titulo: 'O que come a diferença antes de virar seu dinheiro',
    svg: cascata,
    legenda: 'Cada desconto é pequeno. Somados, comeram quase um terço da sobra bruta.',
    texto: 'É por isso que "margem de R$ 1,39" não quer dizer nada até você descontar a cascata. O número que entra na conta de retorno é o de baixo, nunca o de cima.',
  },
  {
    ordem: 5,
    titulo: 'A segunda receita: a taxa de ativação',
    svg: ativacao,
    legenda: 'É a linha que quase toda planilha de fornecedor esquece — e ela é o que segura o ponto no mês fraco.',
    destaque: 'A vaga ocupada custa igual, o carro levando 4 kWh ou 40. Quem só cobra energia está dando a vaga de graça para quem carrega pouco.',
  },
  {
    ordem: 6,
    titulo: 'O preço de venda não é livre',
    svg: teto,
    legenda: 'Teto e piso. Entre os dois, é escolha sua — e a escolha muda o movimento, não só a margem.',
  },
  {
    ordem: 7,
    titulo: 'Como calcular o seu teto, na prática',
    lista: [
      'Pegue um carro comum na sua região e veja quantos km ele faz por kWh. Costuma ficar entre 5 e 7.',
      'Veja quanto custa rodar esses mesmos km a combustível, com o preço do posto da sua rua.',
      'Divida: esse é o preço por kWh em que carregar empata com abastecer. Ninguém paga acima disso por muito tempo.',
    ],
    destaque: 'Esse cálculo você refaz quando o combustível mexe. É a única âncora de preço que o seu cliente realmente usa, mesmo sem fazer a conta.',
  },
  {
    ordem: 8,
    titulo: 'Uma coisa que este curso não vai fazer',
    texto: 'Não vou te dar uma tabela de preços por região. Tarifa de energia muda por distribuidora, por modalidade, por bandeira e por mês; combustível muda por semana. Qualquer tabela impressa aqui estaria errada antes de você terminar de ler.',
    destaque: 'O que não envelhece é o método: o seu custo sai da sua conta, o seu teto sai do posto da sua rua. As duas fontes estão a um clique de você.',
  },
  {
    ordem: 9,
    titulo: 'O que levar desta aula',
    lista: [
      'O seu custo real por kWh: total a pagar dividido pelo consumo, média de 12 meses.',
      'A cascata de descontos da sua praça: gateway, imposto, repasse, manutenção.',
      'A margem líquida por kWh — a de baixo, não a de cima.',
      'A taxa de ativação que você vai cobrar por sessão.',
      'O teto de preço da sua região, calculado contra o combustível.',
    ],
    destaque: 'Estes cinco números vão direto para a aula 13. Sem eles, aquela conta é ficção.',
  },
];

// ── Saída ──────────────────────────────────────────────────────────────────
if (process.argv.includes('--sql')) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(
    `update public.pc_aulas set paginas = ${q(JSON.stringify(PAGINAS))}::jsonb, duracao_seg = 24*60
      where ordem = 2 and curso_id = (select id from public.pc_cursos where slug = 'fundamentos');`
  );
} else {
  const puppeteer = require('puppeteer');
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
    const saida = path.join(__dirname, 'prova-aula-02.png');
    await pg.screenshot({ path: saida, fullPage: true });
    await b.close();
    console.log(`${svgs.length} diagramas → ${saida}`);
  })();
}

module.exports = { PAGINAS };
