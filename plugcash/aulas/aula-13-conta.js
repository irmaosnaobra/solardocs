// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTOS · AULA 13 — "A conta que decide"
//
// É a aula que fecha o curso e a que mais trabalha pela mentoria — sem truque.
//
// Como ela vende sem esconder nada: ensina a conta INTEIRA, com os números do
// próprio ponto da pessoa, e no fim mostra qual das premissas ela consegue
// medir sozinha e qual não consegue. A que não dá pra medir sozinha é onde a
// mentoria entra. Quem quiser tocar sozinho, sai daqui sabendo fazer; quem
// olhar o tamanho do serviço, contrata. As duas saídas são legítimas.
//
// Regra da casa que vale dobrado aqui: NÃO INVENTAR VALOR. Todo número desta
// aula é de exemplo e está marcado como tal. O que a aula ensina é a ESTRUTURA
// da conta — que não muda com tarifa, e é justamente o que ninguém mostra.
//
// Sete diagramas. É a aula mais ilustrada do curso porque é a que mais gente
// erra fazendo de cabeça.
//
// Rodar:  node plugcash/aulas/aula-13-conta.js         (gera a prova visual)
//         node plugcash/aulas/aula-13-conta.js --sql   (imprime o SQL)
// ─────────────────────────────────────────────────────────────────────────────

const T = '#0A0A0A';
const M = '#6B6B6B';
const V = '#00C853';
const A = '#C2410C';
const CINZA = '#D9D9D9';

const base = (conteudo, w = 720, h = 380) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif">${conteudo}</svg>`;

// ── 1 · A conta inteira cabe numa linha ─────────────────────────────────────
const aLinha = base(`
  <text x="360" y="52" font-size="13" font-weight="700" text-anchor="middle" fill="${M}">TUDO O QUE ENTRA NO SEU BOLSO, POR MÊS</text>

  <rect x="30" y="76" width="146" height="88" rx="8" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="103" y="108" font-size="12.5" text-anchor="middle" fill="${M}">recargas</text>
  <text x="103" y="126" font-size="12.5" text-anchor="middle" fill="${M}">por dia</text>
  <text x="103" y="152" font-size="20" font-weight="800" text-anchor="middle" fill="${T}">6</text>

  <text x="190" y="128" font-size="22" font-weight="800" text-anchor="middle" fill="${M}">×</text>

  <rect x="206" y="76" width="146" height="88" rx="8" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="279" y="108" font-size="12.5" text-anchor="middle" fill="${M}">kWh por</text>
  <text x="279" y="126" font-size="12.5" text-anchor="middle" fill="${M}">recarga</text>
  <text x="279" y="152" font-size="20" font-weight="800" text-anchor="middle" fill="${T}">22</text>

  <text x="366" y="128" font-size="22" font-weight="800" text-anchor="middle" fill="${M}">×</text>

  <rect x="382" y="76" width="146" height="88" rx="8" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="455" y="108" font-size="12.5" text-anchor="middle" fill="${M}">margem por</text>
  <text x="455" y="126" font-size="12.5" text-anchor="middle" fill="${M}">kWh</text>
  <text x="455" y="152" font-size="20" font-weight="800" text-anchor="middle" fill="${V}">R$ 1,06</text>

  <text x="542" y="128" font-size="22" font-weight="800" text-anchor="middle" fill="${M}">×</text>

  <rect x="558" y="76" width="132" height="88" rx="8" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="624" y="108" font-size="12.5" text-anchor="middle" fill="${M}">dias no</text>
  <text x="624" y="126" font-size="12.5" text-anchor="middle" fill="${M}">mês</text>
  <text x="624" y="152" font-size="20" font-weight="800" text-anchor="middle" fill="${T}">30</text>

  <path d="M360 182 L360 210" stroke="${M}" stroke-width="2"/>
  <path d="M353 202 L360 210 L367 202" fill="none" stroke="${M}" stroke-width="2"/>

  <rect x="120" y="222" width="480" height="66" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="360" y="252" font-size="13" text-anchor="middle" fill="${M}">margem bruta do mês</text>
  <text x="360" y="278" font-size="24" font-weight="800" text-anchor="middle" fill="${T}">R$ 4.198</text>

  <text x="360" y="330" font-size="13" text-anchor="middle" fill="${A}" font-weight="700">E daqui ainda sai o custo fixo. Ninguém leva essa linha pra casa.</text>
  <text x="360" y="356" font-size="11.5" text-anchor="middle" fill="${M}">Números de exemplo — troque pelos do seu ponto.</text>
`);

// ── 2 · De onde sai cada número ─────────────────────────────────────────────
// Amarra o curso inteiro: cada entrada da conta veio de uma aula anterior.
const deOndeSai = base(`
  <rect x="24" y="34" width="196" height="94" rx="8" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="44" y="62" font-size="14.5" font-weight="800" fill="${T}">recargas por dia</text>
  <text x="44" y="86" font-size="12.5" fill="${M}">medido na calçada,</text>
  <text x="44" y="104" font-size="12.5" fill="${M}">contando o movimento</text>
  <text x="44" y="122" font-size="11.5" font-weight="700" fill="${V}">AULA 4</text>

  <rect x="24" y="144" width="196" height="94" rx="8" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="44" y="172" font-size="14.5" font-weight="800" fill="${T}">kWh por recarga</text>
  <text x="44" y="196" font-size="12.5" fill="${M}">permanência × potência</text>
  <text x="44" y="214" font-size="12.5" fill="${M}">que o carro aceita</text>
  <text x="44" y="232" font-size="11.5" font-weight="700" fill="${V}">AULA 7</text>

  <rect x="24" y="254" width="196" height="94" rx="8" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="44" y="282" font-size="14.5" font-weight="800" fill="${T}">margem por kWh</text>
  <text x="44" y="306" font-size="12.5" fill="${M}">a margem LÍQUIDA,</text>
  <text x="44" y="324" font-size="12.5" fill="${M}">depois da cascata</text>
  <text x="44" y="342" font-size="11.5" font-weight="700" fill="${V}">AULA 2</text>

  <path d="M220 81 C 280 81, 290 176, 348 186" fill="none" stroke="${V}" stroke-width="2"/>
  <path d="M220 191 L348 191" stroke="${V}" stroke-width="2"/>
  <path d="M220 301 C 280 301, 290 200, 348 196" fill="none" stroke="${V}" stroke-width="2"/>

  <rect x="356" y="146" width="188" height="90" rx="8" fill="#fff" stroke="${V}" stroke-width="3"/>
  <text x="450" y="182" font-size="14" font-weight="800" text-anchor="middle" fill="${T}">A CONTA</text>
  <text x="450" y="208" font-size="12.5" text-anchor="middle" fill="${M}">desta aula</text>

  <path d="M544 191 L596 191" stroke="${T}" stroke-width="2"/>
  <path d="M588 184 L596 191 L588 198" fill="none" stroke="${T}" stroke-width="2"/>

  <rect x="604" y="146" width="92" height="90" rx="8" fill="#F5F5F5" stroke="${T}" stroke-width="2"/>
  <text x="650" y="180" font-size="13" text-anchor="middle" fill="${M}">vai ou</text>
  <text x="650" y="202" font-size="13" text-anchor="middle" fill="${M}">não vai</text>
`);

// ── 3 · O custo que não some quando o movimento some ────────────────────────
const custoFixo = base(`
  <text x="40" y="42" font-size="13" font-weight="700" fill="${M}">MÊS CHEIO</text>

  <rect x="40" y="60" width="640" height="52" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="60" width="286" height="52" rx="6" fill="${A}" opacity="0.88"/>
  <text x="60" y="92" font-size="13.5" font-weight="700" fill="#fff">custo fixo</text>
  <rect x="326" y="60" width="140" height="52" fill="#B9B9B9"/>
  <text x="346" y="92" font-size="13" fill="#fff">energia</text>
  <text x="486" y="92" font-size="13.5" font-weight="700" fill="${V}">sobra</text>

  <text x="40" y="160" font-size="13" font-weight="700" fill="${M}">MÊS FRACO — metade do movimento</text>

  <rect x="40" y="178" width="640" height="52" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="178" width="286" height="52" rx="6" fill="${A}" opacity="0.88"/>
  <text x="60" y="210" font-size="13.5" font-weight="700" fill="#fff">custo fixo — não mudou</text>
  <rect x="326" y="178" width="70" height="52" fill="#B9B9B9"/>
  <text x="410" y="210" font-size="13.5" font-weight="700" fill="${A}">quase nada sobra</text>

  <rect x="40" y="262" width="640" height="86" rx="8" fill="#fff" stroke="${T}" stroke-width="2"/>
  <text x="62" y="292" font-size="14" font-weight="800" fill="${T}">O que compõe o custo fixo</text>
  <text x="62" y="316" font-size="13" fill="${M}">demanda contratada · arrendamento do espaço · conectividade e software</text>
  <text x="62" y="336" font-size="13" fill="${M}">manutenção preventiva · seguro · taxa do meio de pagamento</text>
`);

// ── 4 · O ponto de equilíbrio ───────────────────────────────────────────────
const equilibrio = base(`
  <text x="360" y="46" font-size="16" font-weight="800" text-anchor="middle" fill="${T}">Quantas recargas por dia só para não sair do bolso</text>

  <line x1="90" y1="300" x2="670" y2="300" stroke="${T}" stroke-width="2"/>
  <line x1="90" y1="80" x2="90" y2="300" stroke="${T}" stroke-width="2"/>
  <text x="66" y="90" font-size="11.5" text-anchor="end" fill="${M}">R$</text>
  <text x="670" y="326" font-size="11.5" text-anchor="end" fill="${M}">recargas por dia</text>

  <line x1="90" y1="196" x2="670" y2="196" stroke="${A}" stroke-width="2.5"/>
  <text x="660" y="186" font-size="12.5" text-anchor="end" fill="${A}" font-weight="700">custo fixo — reta, não desce</text>

  <path d="M90 300 L670 96" stroke="${V}" stroke-width="2.5"/>
  <text x="560" y="128" font-size="12.5" fill="${V}" font-weight="700">margem bruta</text>

  <circle cx="386" cy="196" r="7" fill="#fff" stroke="${T}" stroke-width="3"/>
  <line x1="386" y1="196" x2="386" y2="300" stroke="${T}" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="386" y="326" font-size="13" font-weight="800" text-anchor="middle" fill="${T}">3,4</text>

  <rect x="404" y="216" width="256" height="66" rx="8" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <text x="422" y="242" font-size="13.5" font-weight="800" fill="${T}">Abaixo daqui você paga</text>
  <text x="422" y="264" font-size="13.5" font-weight="800" fill="${T}">para o ponto existir.</text>

  <text x="120" y="126" font-size="12.5" fill="${M}">Este é o número que</text>
  <text x="120" y="146" font-size="12.5" fill="${M}">quase ninguém calcula —</text>
  <text x="120" y="166" font-size="12.5" fill="${M}">e o único que decide.</text>
`);

// ── 5 · A gangorra: o que realmente mexe no resultado ───────────────────────
const gangorra = base(`
  <text x="40" y="40" font-size="13" font-weight="700" fill="${M}">MEXENDO CADA PREMISSA EM 30%, QUANTO O RETORNO ANDA</text>

  <line x1="360" y1="66" x2="360" y2="330" stroke="${M}" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="360" y="352" font-size="11.5" text-anchor="middle" fill="${M}">cenário de partida</text>

  <text x="40" y="98" font-size="13" font-weight="700" fill="${T}">recargas por dia</text>
  <rect x="150" y="82" width="420" height="26" rx="4" fill="${A}" opacity="0.9"/>
  <rect x="360" y="82" width="210" height="26" fill="${V}"/>
  <text x="586" y="101" font-size="12.5" font-weight="800" fill="${T}">enorme</text>

  <text x="40" y="158" font-size="13" font-weight="700" fill="${T}">margem por kWh</text>
  <rect x="222" y="142" width="276" height="26" rx="4" fill="${A}" opacity="0.9"/>
  <rect x="360" y="142" width="138" height="26" fill="${V}"/>
  <text x="514" y="161" font-size="12.5" font-weight="800" fill="${T}">grande</text>

  <text x="40" y="218" font-size="13" font-weight="700" fill="${T}">custo do equipamento</text>
  <rect x="306" y="202" width="108" height="26" rx="4" fill="${A}" opacity="0.9"/>
  <rect x="360" y="202" width="54" height="26" fill="${V}"/>
  <text x="430" y="221" font-size="12.5" font-weight="800" fill="${M}">pequeno</text>

  <text x="40" y="278" font-size="13" font-weight="700" fill="${T}">preço da obra</text>
  <rect x="330" y="262" width="60" height="26" rx="4" fill="${A}" opacity="0.9"/>
  <rect x="360" y="262" width="30" height="26" fill="${V}"/>
  <text x="406" y="281" font-size="12.5" font-weight="800" fill="${M}">quase nada</text>

  <rect x="40" y="306" width="640" height="0" fill="none"/>
  <text x="40" y="330" font-size="13" fill="${M}">Você passa semanas pechinchando equipamento e minutos estimando movimento. Está invertido.</text>
`);

// ── 6 · O que é medido, o que é cotado, o que é chute ───────────────────────
const medidoChute = base(`
  <rect x="24" y="34" width="212" height="300" rx="10" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="46" y="68" font-size="15" font-weight="800" fill="${V}">VOCÊ MEDE</text>
  <text x="46" y="88" font-size="12" fill="${M}">hoje, sozinho, de graça</text>
  <line x1="46" y1="104" x2="214" y2="104" stroke="${CINZA}" stroke-width="1"/>
  <text x="46" y="132" font-size="13" fill="${T}">carga disponível</text>
  <text x="46" y="160" font-size="13" fill="${T}">movimento da via</text>
  <text x="46" y="188" font-size="13" fill="${T}">permanência do carro</text>
  <text x="46" y="216" font-size="13" fill="${T}">tarifa que você paga</text>
  <text x="46" y="244" font-size="13" fill="${T}">custo do arrendamento</text>
  <rect x="46" y="266" width="168" height="48" rx="6" fill="#EAF8EF"/>
  <text x="60" y="288" font-size="12" font-weight="700" fill="${V}">É a maior parte</text>
  <text x="60" y="306" font-size="12" font-weight="700" fill="${V}">da conta.</text>

  <rect x="254" y="34" width="212" height="300" rx="10" fill="#fff" stroke="${T}" stroke-width="2.5"/>
  <text x="276" y="68" font-size="15" font-weight="800" fill="${T}">VOCÊ EXIGE</text>
  <text x="276" y="88" font-size="12" fill="${M}">por escrito, de terceiros</text>
  <line x1="276" y1="104" x2="444" y2="104" stroke="${CINZA}" stroke-width="1"/>
  <text x="276" y="132" font-size="13" fill="${T}">parecer da distribuidora</text>
  <text x="276" y="160" font-size="13" fill="${T}">preço fechado do kit</text>
  <text x="276" y="188" font-size="13" fill="${T}">prazo de obra</text>
  <text x="276" y="216" font-size="13" fill="${T}">taxa da plataforma</text>
  <text x="276" y="244" font-size="13" fill="${T}">garantia e assistência</text>
  <rect x="276" y="266" width="168" height="48" rx="6" fill="#F5F5F5"/>
  <text x="290" y="288" font-size="12" font-weight="700" fill="${T}">Sem papel, não</text>
  <text x="290" y="306" font-size="12" font-weight="700" fill="${T}">entra na conta.</text>

  <rect x="484" y="34" width="212" height="300" rx="10" fill="#fff" stroke="${A}" stroke-width="2.5"/>
  <text x="506" y="68" font-size="15" font-weight="800" fill="${A}">NINGUÉM SABE</text>
  <text x="506" y="88" font-size="12" fill="${M}">nem eu, nem o fornecedor</text>
  <line x1="506" y1="104" x2="674" y2="104" stroke="${CINZA}" stroke-width="1"/>
  <text x="506" y="132" font-size="13" fill="${T}">frota elétrica em 3 anos</text>
  <text x="506" y="160" font-size="13" fill="${T}">concorrente na esquina</text>
  <text x="506" y="188" font-size="13" fill="${T}">preço do kWh em 2030</text>
  <text x="506" y="216" font-size="13" fill="${T}">hábito de quem carrega</text>
  <rect x="506" y="238" width="168" height="76" rx="6" fill="#FDF0E9"/>
  <text x="520" y="262" font-size="12" font-weight="700" fill="${A}">Aqui não se estima:</text>
  <text x="520" y="280" font-size="12" font-weight="700" fill="${A}">testa-se em faixa,</text>
  <text x="520" y="298" font-size="12" font-weight="700" fill="${A}">do pior ao melhor.</text>
`);

// ── 7 · A rampa de ocupação ─────────────────────────────────────────────────
// A premissa mais dura do método da casa, e a que separa estudo sério de
// planilha de fornecedor: o movimento entra devagar, o custo fixo entra inteiro
// no mês 1. O ano 1 quase sempre é negativo — e tem que estar escrito.
const rampa = base(`
  <text x="40" y="40" font-size="13" font-weight="700" fill="${M}">SEIS MESES ATÉ O PONTO RODAR CHEIO</text>

  <line x1="80" y1="272" x2="672" y2="272" stroke="${T}" stroke-width="2"/>
  <line x1="80" y1="70" x2="80" y2="272" stroke="${T}" stroke-width="2"/>

  <path d="M80 246 L172 210 L264 175 L356 140 L448 104 L540 78 L672 78" fill="none" stroke="${V}" stroke-width="3"/>
  <circle cx="540" cy="78" r="6" fill="${V}"/>
  <text x="556" y="70" font-size="12.5" font-weight="800" fill="${V}">100% no mês 6</text>

  <line x1="80" y1="164" x2="672" y2="164" stroke="${A}" stroke-width="2.5" stroke-dasharray="7 4"/>
  <text x="672" y="154" font-size="12.5" text-anchor="end" fill="${A}" font-weight="700">custo fixo — inteiro desde o mês 1</text>

  <path d="M80 246 L172 210 L264 175 L356 164 L356 164 L264 164 L172 164 L80 164 Z" fill="${A}" opacity="0.14"/>
  <text x="150" y="204" font-size="12.5" font-weight="800" fill="${A}">prejuízo</text>

  <text x="80" y="296" font-size="11.5" text-anchor="middle" fill="${M}">mês 1</text>
  <text x="356" y="296" font-size="11.5" text-anchor="middle" fill="${M}">mês 3</text>
  <text x="540" y="296" font-size="11.5" text-anchor="middle" fill="${M}">mês 6</text>

  <rect x="40" y="316" width="640" height="46" rx="8" fill="#FDF0E9" stroke="${A}" stroke-width="1.5"/>
  <text x="60" y="345" font-size="13.5" font-weight="800" fill="${A}">Você precisa de caixa para atravessar isso. Chama-se capital de giro, e entra no investimento.</text>
`);

// ── 8 · Os quatro indicadores do estudo ─────────────────────────────────────
const indicadores = base(`
  <text x="40" y="38" font-size="13" font-weight="700" fill="${M}">O ESTUDO NÃO ENTREGA UM NÚMERO. ENTREGA QUATRO, EM TRÊS CENÁRIOS.</text>

  <rect x="40" y="56" width="640" height="34" fill="${T}"/>
  <text x="58" y="79" font-size="12.5" font-weight="700" fill="#fff">Indicador</text>
  <text x="352" y="79" font-size="12.5" font-weight="700" text-anchor="middle" fill="#fff">Conservador</text>
  <text x="490" y="79" font-size="12.5" font-weight="700" text-anchor="middle" fill="${V}">Base</text>
  <text x="628" y="79" font-size="12.5" font-weight="700" text-anchor="middle" fill="#fff">Otimista</text>

  <rect x="40" y="90" width="640" height="42" fill="#fff" stroke="${CINZA}" stroke-width="1"/>
  <text x="58" y="117" font-size="13" fill="${T}">Lucro/mês em regime</text>
  <text x="352" y="117" font-size="13" text-anchor="middle" fill="${M}">baixo</text>
  <text x="490" y="117" font-size="13" font-weight="700" text-anchor="middle" fill="${T}">o seu número</text>
  <text x="628" y="117" font-size="13" text-anchor="middle" fill="${M}">alto</text>

  <rect x="40" y="132" width="640" height="42" fill="#FAFAFA" stroke="${CINZA}" stroke-width="1"/>
  <text x="58" y="159" font-size="13" fill="${T}">Lucro do ano 1, já com a rampa</text>
  <text x="352" y="159" font-size="13" text-anchor="middle" fill="${A}">negativo</text>
  <text x="490" y="159" font-size="13" font-weight="700" text-anchor="middle" fill="${A}">quase sempre negativo</text>
  <text x="628" y="159" font-size="13" text-anchor="middle" fill="${M}">perto de zero</text>

  <rect x="40" y="174" width="640" height="42" fill="#fff" stroke="${CINZA}" stroke-width="1"/>
  <text x="58" y="201" font-size="13" fill="${T}">Payback descontado</text>
  <text x="352" y="201" font-size="13" text-anchor="middle" fill="${M}">longo ou nenhum</text>
  <text x="490" y="201" font-size="13" font-weight="700" text-anchor="middle" fill="${T}">em anos</text>
  <text x="628" y="201" font-size="13" text-anchor="middle" fill="${M}">curto</text>

  <rect x="40" y="216" width="640" height="42" fill="#FAFAFA" stroke="${CINZA}" stroke-width="1"/>
  <text x="58" y="243" font-size="13" fill="${T}">TIR em 10 anos</text>
  <text x="352" y="243" font-size="13" text-anchor="middle" fill="${M}">abaixo da taxa</text>
  <text x="490" y="243" font-size="13" font-weight="700" text-anchor="middle" fill="${T}">compara com 14,25%</text>
  <text x="628" y="243" font-size="13" text-anchor="middle" fill="${M}">acima</text>

  <rect x="40" y="258" width="640" height="42" fill="#fff" stroke="${CINZA}" stroke-width="1"/>
  <text x="58" y="285" font-size="13" fill="${T}">VPL à taxa de 14,25%</text>
  <text x="352" y="285" font-size="13" text-anchor="middle" fill="${M}">negativo</text>
  <text x="490" y="285" font-size="13" font-weight="700" text-anchor="middle" fill="${T}">positivo ou não</text>
  <text x="628" y="285" font-size="13" text-anchor="middle" fill="${M}">positivo</text>

  <text x="40" y="332" font-size="13" fill="${M}">A taxa não é negociável no estudo: é fixa para que todo projeto seja medido com a mesma régua.</text>
  <text x="40" y="356" font-size="13" font-weight="700" fill="${T}">VPL negativo não quer dizer que dá prejuízo. Quer dizer que o dinheiro rende mais em outro lugar.</text>
`);

// ── 9 · O que precisa estar dentro do investimento ──────────────────────────
const investimento = base(`
  <rect x="40" y="66" width="640" height="54" rx="6" fill="#F5F5F5" stroke="${M}" stroke-width="1.5"/>
  <rect x="40" y="66" width="228" height="54" rx="6" fill="${T}"/>
  <text x="60" y="98" font-size="13.5" font-weight="700" fill="#fff">equipamento</text>
  <text x="288" y="98" font-size="13" fill="${M}">é só esta parte que o fornecedor cota</text>

  <rect x="40" y="138" width="640" height="196" rx="8" fill="#fff" stroke="${V}" stroke-width="2.5"/>
  <text x="62" y="168" font-size="14" font-weight="800" fill="${V}">O QUE TAMBÉM ENTRA — E QUASE SEMPRE FICA DE FORA</text>

  <text x="62" y="200" font-size="13.5" fill="${T}">obra civil, base e proteção física</text>
  <text x="62" y="226" font-size="13.5" fill="${T}">entrada de energia e conexão com a concessionária</text>
  <text x="62" y="252" font-size="13.5" fill="${T}">projeto elétrico e ART</text>
  <text x="62" y="278" font-size="13.5" fill="${T}">homologação e taxas</text>
  <rect x="52" y="292" width="616" height="32" rx="6" fill="#EAF8EF"/>
  <text x="62" y="314" font-size="13.5" font-weight="800" fill="${V}">capital de giro para atravessar a rampa</text>

  <text x="360" y="360" font-size="12.5" text-anchor="middle" fill="${M}">Payback calculado só sobre o equipamento é o erro mais comum — e o mais otimista.</text>
`);

// ── Páginas ────────────────────────────────────────────────────────────────
const PAGINAS = [
  {
    ordem: 1,
    titulo: 'Doze aulas viraram uma conta',
    texto: 'Tudo o que você mediu até aqui existia para chegar nesta página. A conta de um eletroposto não é complicada — ela é só honesta ou desonesta, dependendo de quantos números dela você inventou.',
    destaque: 'Não existe planilha que salve premissa chutada. Existe planilha que esconde por mais tempo.',
  },
  {
    ordem: 2,
    titulo: 'A receita inteira cabe numa linha',
    svg: aLinha,
    legenda: 'Quatro números multiplicados. É isso. Qualquer planilha de fornecedor que precise de três abas para mostrar isso está escondendo alguma coisa.',
  },
  {
    ordem: 3,
    titulo: 'De onde sai cada número',
    svg: deOndeSai,
    legenda: 'Nenhum número novo aparece nesta aula. Ela só junta o que você já mediu.',
    texto: 'Se algum dos três estiver vazio, pare. Voltar uma aula custa uma tarde; errar a conta custa o investimento inteiro.',
  },
  {
    ordem: 4,
    titulo: 'O custo que não some quando o movimento some',
    svg: custoFixo,
    legenda: 'A demanda contratada é o exemplo mais caro disso: você paga pela potência reservada, tenha usado ou não.',
    destaque: 'Receita é sazonal. Custo fixo não é. Toda conta que só olha o mês bom está errada no mês ruim.',
  },
  {
    ordem: 5,
    titulo: 'O ponto de equilíbrio: o número que decide',
    svg: equilibrio,
    legenda: 'Custo fixo dividido pela margem de uma recarga. Uma divisão — e quase ninguém faz.',
    texto: 'Compare esse número com o movimento que você contou na aula 4. Se o equilíbrio ficar acima do que você mediu, o ponto não é ruim: ele é inviável no formato que você desenhou. Muda o formato, não a esperança.',
  },
  {
    ordem: 6,
    titulo: 'Nem toda premissa pesa igual',
    svg: gangorra,
    legenda: 'Mexa cada premissa em 30% e veja o retorno andar. As duas primeiras mandam; as duas últimas quase não aparecem.',
    destaque: 'Você passa semanas pechinchando equipamento e minutos estimando movimento. Está invertido — e é a inversão mais cara deste mercado.',
  },
  {
    ordem: 7,
    titulo: 'Separe o que você mede do que você chuta',
    svg: medidoChute,
    legenda: 'Três colunas. Antes de rodar qualquer conta, cada número seu tem que estar em uma delas — e você tem que saber em qual.',
  },
  {
    ordem: 8,
    titulo: 'A coluna vermelha é honesta, não é desculpa',
    texto: 'Quantos carros elétricos vão passar na sua rua daqui a três anos ninguém sabe: nem eu, nem o fornecedor, nem a montadora. Quem te der esse número com uma casa decimal está vendendo, não calculando.',
    lista: [
      'O que dá para saber hoje: quantos elétricos e híbridos plug-in emplacaram no seu estado nos últimos 12 meses.',
      'O que dá para saber hoje: quantos pontos de recarga já existem no raio que interessa, e de que potência.',
      'O que dá para fazer com isso: montar três cenários, não uma previsão.',
    ],
    destaque: 'Previsão é chute com cara de conta. Cenário é chute assumido — e assumido dá para se preparar.',
  },
  {
    ordem: 9,
    titulo: 'O ponto não nasce cheio: a rampa de ocupação',
    svg: rampa,
    legenda: 'Seis meses até o movimento chegar em regime. É o padrão que a nossa equipe usa em todo estudo — e é a premissa que mais gente esquece.',
    texto: 'A receita entra devagar porque o motorista precisa descobrir que o seu ponto existe. O custo fixo não espera: demanda contratada, arrendamento, software e seguro chegam inteiros já no primeiro mês.',
    destaque: 'Por isso o ano 1 quase sempre fecha negativo — e isso não é sinal de projeto ruim. É sinal de projeto calculado direito.',
  },
  {
    ordem: 10,
    titulo: 'Investimento total não é o preço do carregador',
    svg: investimento,
    legenda: 'O fornecedor cota a primeira barra. As outras cinco também são dinheiro seu, e entram no payback.',
    destaque: 'Payback calculado só sobre o equipamento é o erro mais otimista que existe — e é o número que costuma vir na proposta.',
  },
  {
    ordem: 11,
    titulo: 'Quatro indicadores, três cenários, uma régua só',
    svg: indicadores,
    legenda: 'É assim que a nossa equipe entrega um Estudo de Viabilidade: nunca um número solto.',
    texto: 'A taxa de 14,25% ao ano é fixa de propósito. Ela representa o que o seu dinheiro renderia em outro lugar, e serve para que dois projetos diferentes sejam comparados com a mesma régua — inclusive o seu contra o de outro fornecedor.',
    destaque: 'VPL negativo não significa prejuízo. Significa que o dinheiro rende mais em outro lugar — e essa também é uma resposta.',
  },
  {
    ordem: 12,
    titulo: 'Três erros que aparecem em quase toda planilha que me mandam',
    lista: [
      'Começar o ano 1 com o ponto cheio. Sem rampa, o primeiro ano fica bonito no papel e vermelho no banco.',
      'Calcular payback só sobre o equipamento, deixando obra, entrada de energia, projeto e capital de giro fora da conta.',
      'Chamar faturamento de lucro. O kWh que você vendeu foi comprado antes, e a diferença é o negócio inteiro.',
      'Somar inflação na receita e esquecer dela no custo. O estudo roda em termos reais justamente para não permitir esse truque.',
    ],
    destaque: 'Os quatro inflam o resultado. Nenhum deles é acidente de quem está te vendendo alguma coisa.',
  },
  {
    ordem: 13,
    titulo: 'O que fazer com o número a que você chegou',
    lista: [
      'Cenário conservador ainda fecha: siga para projeto e homologação. Você tem o que o banco e o sócio pedem.',
      'Só o base e o otimista fecham: o ponto serve, o formato não. Menos potência, sociedade, ou começar com um conector.',
      'Nem o otimista fecha: este ponto não é o seu. Custou uma planilha descobrir, e não um eletroposto.',
    ],
    destaque: 'As três saídas são vitórias. A derrota é montar sem ter feito a conta.',
  },
  {
    ordem: 14,
    titulo: 'Onde acaba o que dá para fazer sozinho',
    texto: 'Você agora consegue montar a conta, defender cada premissa e reprovar uma proposta ruim — e isso não tem volta, é seu para sempre. O que continua difícil sozinho é o que depende de repetição: saber o que a SUA distribuidora costuma exigir, quanto ela demora de verdade, qual fornecedor entrega no prazo, e quanto a obra realmente custa na sua região.',
    destaque: 'Decidir, você já sabe. Executar é onde se perde tempo — e tempo, neste mercado, é a coisa mais cara que existe.',
  },
  {
    ordem: 15,
    titulo: 'O que levar desta aula',
    lista: [
      'Sua margem por kWh, com o custo real da energia dentro, mais a taxa de ativação por sessão.',
      'Seu custo fixo mensal, item por item — demanda contratada, arrendamento, software, seguro.',
      'Seu investimento TOTAL: equipamento, obra, entrada de energia, projeto, homologação e capital de giro.',
      'Seu ponto de equilíbrio em recargas por dia — e a comparação com o que você contou na rua.',
      'Os três cenários com rampa de seis meses, e os quatro indicadores de cada um.',
      'A resposta honesta a uma pergunta: você aguenta o conservador?',
    ],
    destaque: 'Com isso na mão, você para de ser alguém que quer um eletroposto e vira alguém que sabe quanto o dele vale.',
  },
];

// ── Saída ──────────────────────────────────────────────────────────────────
if (process.argv.includes('--sql')) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(
    `update public.pc_aulas
        set paginas = ${q(JSON.stringify(PAGINAS))}::jsonb,
            duracao_seg = 32*60,
            oferta_curso_slug = 'mentoria'
      where ordem = 13 and curso_id = (select id from public.pc_cursos where slug = 'fundamentos');`
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
    const saida = path.join(__dirname, 'prova-aula-13.png');
    await pg.screenshot({ path: saida, fullPage: true });
    await b.close();
    console.log(`${svgs.length} diagramas → ${saida}`);
  })();
}

module.exports = { PAGINAS };
