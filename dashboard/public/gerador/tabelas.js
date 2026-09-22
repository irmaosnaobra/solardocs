// ============= DADOS =============
// IMPORTANTE: este TABELAS é duplicado dentro de proposta.html. Ao atualizar um, atualize o outro.
//
// De onde vem cada numero: NENHUM preco aqui e digitado. Cada linha nasce da planilha
// "TABELA - mar2026.xlsx" (Desktop), uma aba por kit, sempre pela mesma cadeia:
//
//   custo   = Combustivel(K) + C/A(L) + Montagem(M) + Kit do fornecedor(N) + Engenharia(O)
//   descMax = custo x 1,30                              <- piso do desconto ("a vista")
//   pVista  = FINAL997( ARREDONDAR.PARA.CIMA((custo x 1,35 + 10)/50) x 50 )
//   pOrc    = FINAL997( ARREDONDAR.PARA.CIMA((custo x 1,35 + 10)/50) x 50 x 1,05 )
//   p18x    = pVista x 1,19 / 18
//
// A comissao do vendedor (6%) sai de dentro dessa margem.
//
// FINAL997, PRECO PSICOLOGICO (22/09/2026, ordem do Thiago): todo preco que o cliente ve
// termina em 497 ou 997. O valor vai pro ponto mais proximo, e o que cai exatamente no meio
// desce. Nas palavras dele: "10.020 a 10.250 = 9.997; 10.251 a 10.450 = 10.497".
//   FINAL997(p) = TETO((p - 250) / 500) x 500 - 3
//   ... 9.751 a 10.250 -> 9.997 | 10.251 a 10.750 -> 10.497 | 10.751 a 11.250 -> 10.997 ...
// Vale pro pVista, pro pOrc e pro preco dos kits cravados (PROMO e SOLAX). O pOrc e' o
// FINAL997 do pOrc da formula, nao do pVista ja' arredondado, entao ele NAO e' mais
// pVista x 1,05 exato. O descMax (piso) NAO entra: segue custo x 1,30, centavo por centavo.
// Com o arredondamento a margem no a' vista fica entre 24,8% e 26,7%, nao mais 26% plano.
// Quem refizer a tabela: primeiro a formula de sempre, o FINAL997 por ultimo.
//
// REAJUSTE DE 22/09/2026: +15% NO CUSTO DE TODOS OS KITS. A placa subiu e, na conta do
// Thiago, o projeto inteiro ficou 15% mais caro. O numero dele e' o do projeto pronto, nao o
// da placa, entao entrou como custo x 1,15 em cada linha, e nao como delta por placa: o delta
// existe pra quando so' se sabe o preco da placa, e aqui a conta do projeto ja' veio feita.
//   Kits da formula (Deye, SAJ 6K, SAJ 7,3K): custo de antes = descMax/1,30, vezes 1,15, e a
//   cadeia acima devolve descMax, pVista, pOrc e p18x. A margem fica nos 26% por construcao.
//   Kits de preco cravado (SAJ 3K PROMO, SOLAX): sem custo conhecido, o preco foi x 1,15 e
//   arredondado pra cima de 50 em 50. Isso preserva a razao preco/custo sem precisar saber o
//   custo. O p18x deles manteve o coeficiente que ja' tinham (0,1549 x preco), que nao e' o
//   1,19/18 da formula.
// A PLANILHA NAO TEM ESSES 15%. Custo desta tabela = soma K..O da planilha x 1,15; quem regerar
// da planilha sem o fator desfaz o reajuste em silencio. E toda relacao de custo citada abaixo
// (+400, +24n, +958, degrau de +680/+800, R$530/R$650 por placa) esta' em valor de planilha,
// de antes do reajuste. Em valor desta tabela, vezes 1,15.
// Duas linhas do Deye estavam fora da formula desde 20/08 e voltaram pra ela neste reajuste: a
// de 12 placas tinha R$50 a mais no a' vista (o p18x dela ja' era o da formula) e a de 20 tinha
// o p18x errado em centavos. As duas vieram coladas de uma tabela antiga.
//
// O preco da placa NAO tem celula propria: mora dentro da coluna N junto do inversor e da
// estrutura. Reajuste de placa se aplica como delta por placa (N += delta x n_placas).
//
// A PLACA TSUN 600W SAIU DA CASA (20/08/2026, ordem do Thiago). Ela subiu de R$456 para
// R$620 em 18/08; a tabela repassou os R$164 cheios, o kit de 8 placas do Deye foi a
// R$14.070 e parou de fechar. Repassar so' um terco (R$55) salvava o preco mas derrubava a
// margem pra 17-21%, e ate' 12,9% na PROMO. Em vez de vender magro, a placa saiu.
//
// A LINHA HOJE SAO QUATRO KITS, todos com a margem cheia do modelo:
//   Deye 2,25K + TCL 600W ....... 3 a 20 placas (micro)
//   SAJ 3K PROMO + TCL 600W ..... 4 a 7   (preco cravado, so' cartao e a' vista)
//   SAJ 6K + TCL 600W ........... 5 a 18  (o teto de 18 e' ordem do Thiago, 20/08)
//   SAJ 7,3K + TCL 600W ......... 10 a 23 (destravado em 25/08 — ver bloco proprio abaixo)
//   SOLAX 1,875K + Era 620W ..... 3 a 32  (preco cravado)
// Sairam de linha, alem das quatro com Tsun: Micro SAJ 2,25K, SAJ 7,5K, Sungrow 5K,
// Sungrow 7,5K e Tsunnes 2,25K.
// O SAJ 7,3K, pedido em 20/08, ficou parado esperando o custo do inversor ate' o Thiago
// dar a diferenca pro 6K (R$958) em 25/08. E' o unico kit que passa de 18 placas em
// string — acima disso, so' ele ou o SOLAX (micro).
// Quem precisar de qualquer tabela removida: `git show a1086ed:.../tabelas.js`.
//
// O Deye e o SAJ 6K rodam com o custo do kit de ANTES de 18/08, o que equivale a dizer que
// a TCL custa o que a Tsun custava. Nao sai de uma celula "TCL" — a planilha chama de
// "Tsun 600W" o modulo de TODAS as abas —, mas o degrau da coluna N por placa fecha nos
// dois lados (conferido em 20/08):
//   Micro SAJ 2,25K, que roda TCL ........... R$530 por placa
//   Micro Deye, Tsun, tirando o +164 ........ R$530
//   SAJ 3K (TCL) ............................ R$530 e R$650, conforme a faixa
//   SAJ 6K (Tsun) antes do reajuste ......... R$530 e R$650, as mesmas faixas
// Nao e' o preco da placa sozinha (a coluna N junta inversor, placa e estrutura), mas e' o
// que entra por placa a mais — que e' exatamente o que a tabela precisa. Se a TCL tiver
// preco proprio diferente disso, refazer.
//
// A PLANILHA JA' ESTA' COM A TSUN A R$620 na coluna N — o que esta' velho la' e' o
// Total Custo (coluna P), formula cujo valor em cache e' anterior a' edicao. Quem ler o
// Total Custo pega o custo de antes do reajuste; quem somar K..O pega o de depois.
// Conferido em 20/08: Microdeye 8 placas, soma K..O = R$9.909,80 e cache = R$8.597,80,
// exatamente os R$164 x 8 de diferenca. Regerar do Total Custo NAO reaplica o aumento;
// regerar da soma das colunas reaplica.
//
// GERACAO POR PLACA (numero do Thiago): micro 80 kWh/mes por placa, string 75. Era 85 e 80
// ate' 20/08; o micro passou por 78 no mesmo dia e o Thiago corrigiu pra 80 em 21/08. Vale
// para as placas de 600W e para a Era 620W do SOLAX, que ja' vinha tratada como 600W.
// Micro e string se distinguem pelo campo `invs`: no micro ele cresce com as placas.
// A geracao nao mexe em preco, mexe em quantas placas o consumo pede — e na economia e no
// payback que a proposta mostra pro cliente.
//
// SAJ-6K de 5 a 7 placas nao existe na aba do SAJ 6K (ela comeca em 8). Sai da aba do
// SAJ 3K, que cobre 4..8 com a mesma placa e o mesmo fornecedor, pela relacao exata
//   custo_6K(n) = custo_3K(n) + 24n + 400
// (+400 = o inversor 6K custa isso a mais que o 3K; +24n = a Montagem, que o 3K calcula
// como Wp x 0,16 e o 6K como kWp x 200). Confere em n=8, onde as duas abas se sobrepoem.
//
// As tabelas *-PROMO tem preco cravado (precoExato) e NAO acompanham custo sozinhas:
// aumento de custo come a margem delas em silencio. Ao reajustar, refazer preservando a
// razao preco/custo de cada linha — e nunca deixar uma PROMO passar do preco normal.
//
// CUIDADO com o modulo: o nome da aba na planilha NAO diz qual placa o kit usa — todas
// dizem "Tsun 600W". Depois que a Tsun saiu, todo kit SAJ daqui roda com TCL 600W, e o
// custo de nenhum deles esta' confirmado na planilha como TCL. O SAJ 3K PROMO segue com
// preco cravado, sem custo conhecido.
const TABELAS = {
"MICRODEYE-TCL600W": {
  inv: "Deye 2,25K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:3 , invs:1, g:240 , kwp:1.8 , descMax:6350.61 , pVista:6497 , pOrc:6997.00 , p18x:429.52},
    {n:4 , invs:1, g:320 , kwp:2.4 , descMax:7286.78 , pVista:7497 , pOrc:7997.00 , p18x:495.64},
    {n:5 , invs:2, g:400 , kwp:3.0 , descMax:10046.10, pVista:10497, pOrc:10997.00, p18x:693.97},
    {n:6 , invs:2, g:480 , kwp:3.6 , descMax:10981.97, pVista:11497, pOrc:11997.00, p18x:760.08},
    {n:7 , invs:2, g:560 , kwp:4.2 , descMax:11917.84, pVista:12497, pOrc:12997.00, p18x:826.19},
    {n:8 , invs:2, g:640 , kwp:4.8 , descMax:12853.71, pVista:13497, pOrc:13997.00, p18x:892.30},
    {n:9 , invs:3, g:720 , kwp:5.4 , descMax:15613.33, pVista:15997, pOrc:16997.00, p18x:1057.58},
    {n:10, invs:3, g:800 , kwp:6.0 , descMax:16549.20, pVista:16997, pOrc:17997.00, p18x:1123.69},
    {n:11, invs:3, g:880 , kwp:6.6 , descMax:17485.07, pVista:17997, pOrc:18997.00, p18x:1189.80},
    {n:12, invs:3, g:960 , kwp:7.2 , descMax:18420.94, pVista:18997, pOrc:19997.00, p18x:1255.91},
    {n:13, invs:4, g:1040, kwp:7.8 , descMax:21180.56, pVista:21997, pOrc:22997.00, p18x:1454.25},
    {n:14, invs:4, g:1120, kwp:8.4 , descMax:22116.43, pVista:22997, pOrc:23997.00, p18x:1520.36},
    {n:15, invs:4, g:1200, kwp:9.0 , descMax:23052.30, pVista:23997, pOrc:24997.00, p18x:1586.47},
    {n:16, invs:4, g:1280, kwp:9.6 , descMax:23988.17, pVista:24997, pOrc:25997.00, p18x:1652.58},
    {n:17, invs:5, g:1360, kwp:10.2, descMax:26747.79, pVista:27997, pOrc:28997.00, p18x:1850.91},
    {n:18, invs:5, g:1440, kwp:10.8, descMax:27683.66, pVista:28997, pOrc:29997.00, p18x:1917.02},
    {n:19, invs:5, g:1520, kwp:11.4, descMax:28619.53, pVista:29497, pOrc:30997.00, p18x:1950.08},
    {n:20, invs:5, g:1600, kwp:12.0, descMax:29555.40, pVista:30497, pOrc:32497.00, p18x:2016.19}
  ]
},

"SAJ-6K-TCL": {
  inv: "SAJ 6K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:5 , invs:1, g:375 , kwp:3.0 , descMax:10121.15, pVista:10497, pOrc:10997.00, p18x:693.97},
    {n:6 , invs:1, g:450 , kwp:3.6 , descMax:11137.75, pVista:11497, pOrc:11997.00, p18x:760.08},
    {n:7 , invs:1, g:525 , kwp:4.2 , descMax:12154.35, pVista:12497, pOrc:13497.00, p18x:826.19},
    {n:8 , invs:1, g:600 , kwp:4.8 , descMax:13170.95, pVista:13497, pOrc:14497.00, p18x:892.30},
    {n:9 , invs:1, g:675 , kwp:5.4 , descMax:14366.95, pVista:14997, pOrc:15497.00, p18x:991.47},
    {n:10, invs:1, g:750 , kwp:6.0 , descMax:15383.55, pVista:15997, pOrc:16997.00, p18x:1057.58},
    {n:11, invs:1, g:825 , kwp:6.6 , descMax:16400.15, pVista:16997, pOrc:17997.00, p18x:1123.69},
    {n:12, invs:1, g:900 , kwp:7.2 , descMax:17416.75, pVista:17997, pOrc:18997.00, p18x:1189.80},
    {n:13, invs:1, g:975 , kwp:7.8 , descMax:18612.75, pVista:19497, pOrc:20497.00, p18x:1288.97},
    {n:14, invs:1, g:1050, kwp:8.4 , descMax:19629.35, pVista:20497, pOrc:21497.00, p18x:1355.08},
    {n:15, invs:1, g:1125, kwp:9.0 , descMax:20645.95, pVista:21497, pOrc:22497.00, p18x:1421.19},
    {n:16, invs:1, g:1200, kwp:9.6 , descMax:21662.55, pVista:22497, pOrc:23497.00, p18x:1487.30},
    {n:17, invs:1, g:1275, kwp:10.2, descMax:22858.55, pVista:23497, pOrc:24997.00, p18x:1553.41},
    {n:18, invs:1, g:1350, kwp:10.8 , descMax:23875.15, pVista:24997, pOrc:25997.00, p18x:1652.58}
  ]
},

// ═══ SAJ 7,3K — como este kit foi montado (21/08/2026) ═══
// Nao veio de aba propria na planilha: nao existe aba do 7,3K. Veio do SAJ 6K pela
// mesma relacao que o 3K->6K ja' usa neste arquivo:
//
//   custo_7,3K(n) = custo_6K(n) + 958
//
// DUAS ASSUNCOES, as duas do Thiago em 25/08 e nenhuma conferida na planilha:
//   1. os R$958 sao CUSTO do inversor (coluna N), no mesmo sentido do "+400" do 3K->6K,
//      e nao diferenca de preco de venda;
//   2. a Montagem do 7,3K segue kWp x 200, igual a' do 6K — mesmo n, mesmo kWp, mesma
//      montagem. Por isso o inversor e' o UNICO termo que muda.
// Se a aba do 7,3K aparecer e disser outra coisa, refazer daqui.
//
// custo_6K(10..18) sai do descMax da tabela do 6K (descMax = custo x 1,30). De 19 a 23 o
// 6K nao tem linha, entao o custo foi estendido pelo degrau da propria aba: +680 por
// placa, +800 quando n%4==1 (n=9, 13, 17, 21) — padrao regular nas 14 linhas do 6K.
//   n=19 e n=20 NAO sao chute: conferem exato contra a aba do 6K de antes de 20/08
//   (`git show a1086ed`), descontados os R$55/placa do repasse da Tsun — 16650 e 17330.
//   n=21, 22 e 23 sao INFERIDOS: nenhuma versao da planilha chegou a ter essas linhas.
//
// Depois do reajuste de 22/09 os dois lados subiram 15%, entao em valor desta tabela a
// diferenca de custo e' 958 x 1,15 = R$1.101,70.
//
// De 10 a 18 este kit e' mais caro que o SAJ 6K (+R$1.500 cravados depois do FINAL997)
// pela MESMA geracao —
// so' faz sentido quando o cliente quer folga de inversor. Quem quer barato usa o 6K.
"SAJ-7.3K-TCL": {
  inv: "SAJ 7,3K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:10, invs:1, g:750 , kwp:6   , descMax:16815.76, pVista:17497, pOrc:18497.00, p18x:1156.75},
    {n:11, invs:1, g:825 , kwp:6.6 , descMax:17832.36, pVista:18497, pOrc:19497.00, p18x:1222.86},
    {n:12, invs:1, g:900 , kwp:7.2 , descMax:18848.96, pVista:19497, pOrc:20497.00, p18x:1288.97},
    {n:13, invs:1, g:975 , kwp:7.8 , descMax:20044.96, pVista:20997, pOrc:21997.00, p18x:1388.14},
    {n:14, invs:1, g:1050, kwp:8.4 , descMax:21061.56, pVista:21997, pOrc:22997.00, p18x:1454.25},
    {n:15, invs:1, g:1125, kwp:9   , descMax:22078.16, pVista:22997, pOrc:23997.00, p18x:1520.36},
    {n:16, invs:1, g:1200, kwp:9.6 , descMax:23094.76, pVista:23997, pOrc:24997.00, p18x:1586.47},
    {n:17, invs:1, g:1275, kwp:10.2, descMax:24290.76, pVista:24997, pOrc:26497.00, p18x:1652.58},
    {n:18, invs:1, g:1350, kwp:10.8, descMax:25307.36, pVista:26497, pOrc:27497.00, p18x:1751.75},
    {n:19, invs:1, g:1425, kwp:11.4, descMax:26323.96, pVista:27497, pOrc:28497.00, p18x:1817.86},
    {n:20, invs:1, g:1500, kwp:12  , descMax:27340.56, pVista:28497, pOrc:29997.00, p18x:1883.97},
    {n:21, invs:1, g:1575, kwp:12.6, descMax:28536.56, pVista:29497, pOrc:30997.00, p18x:1950.08},
    {n:22, invs:1, g:1650, kwp:13.2, descMax:29553.16, pVista:30497, pOrc:31997.00, p18x:2016.19},
    {n:23, invs:1, g:1725, kwp:13.8, descMax:30569.76, pVista:31997, pOrc:33497.00, p18x:2115.36}
  ]
},

"SAJ-3K-PROMO": {
  inv: "SAJ 3K", mod: "TCL 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:4, invs:1, g:300, kwp:2.4, descMax:7997.00, pVista:7997, pOrc:7997.00, p18x:1238.74},
    {n:5, invs:1, g:375, kwp:3.0, descMax:8997.00, pVista:8997, pOrc:8997.00, p18x:1393.64},
    {n:6, invs:1, g:450, kwp:3.6, descMax:9997.00, pVista:9997, pOrc:9997.00, p18x:1548.53},
    {n:7, invs:1, g:525, kwp:4.2, descMax:11497.00, pVista:11497, pOrc:11497.00, p18x:1780.89}
  ]
},

"SOLAX-1.875K-ERA620W": {
  inv: "SOLAX 1,875K", mod: "Era 620W", pot: 620, precoExato: true,
  rows: [
    {n:3, invs:1, g:240, kwp:1.86, descMax:7497.00, pVista:7497, pOrc:7497.00, p18x:1161.29},
    {n:4, invs:1, g:320, kwp:2.48, descMax:8497.00, pVista:8497, pOrc:8497.00, p18x:1316.19},
    {n:5, invs:2, g:400, kwp:3.1, descMax:12497.00, pVista:12497, pOrc:12497.00, p18x:1935.79},
    {n:6, invs:2, g:480, kwp:3.72, descMax:13497.00, pVista:13497, pOrc:13497.00, p18x:2090.69},
    {n:7, invs:2, g:560, kwp:4.34, descMax:14497.00, pVista:14497, pOrc:14497.00, p18x:2245.59},
    {n:8, invs:2, g:640, kwp:4.96, descMax:15497.00, pVista:15497, pOrc:15497.00, p18x:2400.50},
    {n:9, invs:3, g:720, kwp:5.58, descMax:19497.00, pVista:19497, pOrc:19497.00, p18x:3020.09},
    {n:10, invs:3, g:800, kwp:6.2, descMax:20497.00, pVista:20497, pOrc:20497.00, p18x:3174.99},
    {n:11, invs:3, g:880, kwp:6.82, descMax:21497.00, pVista:21497, pOrc:21497.00, p18x:3329.89},
    {n:12, invs:3, g:960 , kwp:7.44, descMax:22497.00, pVista:22497, pOrc:22497.00, p18x:3484.80},
    {n:13, invs:4, g:1040, kwp:8.06, descMax:26497.00, pVista:26497, pOrc:26497.00, p18x:4104.40},
    {n:14, invs:4, g:1120, kwp:8.68, descMax:27497.00, pVista:27497, pOrc:27497.00, p18x:4259.29},
    {n:15, invs:4, g:1200, kwp:9.3, descMax:28497.00, pVista:28497, pOrc:28497.00, p18x:4414.20},
    {n:16, invs:4, g:1280, kwp:9.92, descMax:29497.00, pVista:29497, pOrc:29497.00, p18x:4569.09},
    {n:17, invs:5, g:1360, kwp:10.54, descMax:33497.00, pVista:33497, pOrc:33497.00, p18x:5188.69},
    {n:18, invs:5, g:1440, kwp:11.16, descMax:34497.00, pVista:34497, pOrc:34497.00, p18x:5343.59},
    {n:19, invs:5, g:1520, kwp:11.78, descMax:35497.00, pVista:35497, pOrc:35497.00, p18x:5498.50},
    {n:20, invs:5, g:1600, kwp:12.4, descMax:36497.00, pVista:36497, pOrc:36497.00, p18x:5653.39},
    {n:21, invs:6, g:1680, kwp:13.02, descMax:39997.00, pVista:39997, pOrc:39997.00, p18x:6195.54},
    {n:22, invs:6, g:1760, kwp:13.64, descMax:41497.00, pVista:41497, pOrc:41497.00, p18x:6427.89},
    {n:23, invs:6, g:1840, kwp:14.26, descMax:42497.00, pVista:42497, pOrc:42497.00, p18x:6582.79},
    {n:24, invs:6, g:1920, kwp:14.88, descMax:43497.00, pVista:43497, pOrc:43497.00, p18x:6737.69},
    {n:25, invs:7, g:2000, kwp:15.5, descMax:46997.00, pVista:46997, pOrc:46997.00, p18x:7279.84},
    {n:26, invs:7, g:2080, kwp:16.12, descMax:48497.00, pVista:48497, pOrc:48497.00, p18x:7512.19},
    {n:27, invs:7, g:2160, kwp:16.74, descMax:49497.00, pVista:49497, pOrc:49497.00, p18x:7667.10},
    {n:28, invs:7, g:2240, kwp:17.36, descMax:50497.00, pVista:50497, pOrc:50497.00, p18x:7821.99},
    {n:29, invs:8, g:2320, kwp:17.98, descMax:53997.00, pVista:53997, pOrc:53997.00, p18x:8364.14},
    {n:30, invs:8, g:2400, kwp:18.6, descMax:55497.00, pVista:55497, pOrc:55497.00, p18x:8596.50},
    {n:31, invs:8, g:2480, kwp:19.22, descMax:56497.00, pVista:56497, pOrc:56497.00, p18x:8751.39},
    {n:32, invs:8, g:2560, kwp:19.84, descMax:57497.00, pVista:57497, pOrc:57497.00, p18x:8906.29}
  ]
}

};
