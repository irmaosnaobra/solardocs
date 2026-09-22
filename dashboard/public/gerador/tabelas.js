// ============= DADOS =============
// IMPORTANTE: este TABELAS é duplicado dentro de proposta.html. Ao atualizar um, atualize o outro.
//
// De onde vem cada numero: NENHUM preco aqui e digitado. Cada linha nasce da planilha
// "TABELA - mar2026.xlsx" (Desktop), uma aba por kit, sempre pela mesma cadeia:
//
//   custo   = Combustivel(K) + C/A(L) + Montagem(M) + Kit do fornecedor(N) + Engenharia(O)
//   descMax = custo x 1,30                              <- piso do desconto ("a vista")
//   pVista  = ARREDONDAR.PARA.CIMA((custo x 1,35 + 10)/50) x 50
//   pOrc    = pVista x 1,05
//   p18x    = pVista x 1,19 / 18
//
// A comissao do vendedor (6%) sai de dentro dessa margem.
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
    {n:3 , invs:1, g:240 , kwp:1.8 , descMax:6350.61 , pVista:6650 , pOrc:6982.50 , p18x:439.64},
    {n:4 , invs:1, g:320 , kwp:2.4 , descMax:7286.78 , pVista:7600 , pOrc:7980.00 , p18x:502.44},
    {n:5 , invs:2, g:400 , kwp:3.0 , descMax:10046.10, pVista:10450, pOrc:10972.50, p18x:690.86},
    {n:6 , invs:2, g:480 , kwp:3.6 , descMax:10981.97, pVista:11450, pOrc:12022.50, p18x:756.97},
    {n:7 , invs:2, g:560 , kwp:4.2 , descMax:11917.84, pVista:12400, pOrc:13020.00, p18x:819.78},
    {n:8 , invs:2, g:640 , kwp:4.8 , descMax:12853.71, pVista:13400, pOrc:14070.00, p18x:885.89},
    {n:9 , invs:3, g:720 , kwp:5.4 , descMax:15613.33, pVista:16250, pOrc:17062.50, p18x:1074.31},
    {n:10, invs:3, g:800 , kwp:6.0 , descMax:16549.20, pVista:17200, pOrc:18060.00, p18x:1137.11},
    {n:11, invs:3, g:880 , kwp:6.6 , descMax:17485.07, pVista:18200, pOrc:19110.00, p18x:1203.22},
    {n:12, invs:3, g:960 , kwp:7.2 , descMax:18420.94, pVista:19150, pOrc:20107.50, p18x:1266.03},
    {n:13, invs:4, g:1040, kwp:7.8 , descMax:21180.56, pVista:22050, pOrc:23152.50, p18x:1457.75},
    {n:14, invs:4, g:1120, kwp:8.4 , descMax:22116.43, pVista:23000, pOrc:24150.00, p18x:1520.56},
    {n:15, invs:4, g:1200, kwp:9.0 , descMax:23052.30, pVista:23950, pOrc:25147.50, p18x:1583.36},
    {n:16, invs:4, g:1280, kwp:9.6 , descMax:23988.17, pVista:24950, pOrc:26197.50, p18x:1649.47},
    {n:17, invs:5, g:1360, kwp:10.2, descMax:26747.79, pVista:27800, pOrc:29190.00, p18x:1837.89},
    {n:18, invs:5, g:1440, kwp:10.8, descMax:27683.66, pVista:28800, pOrc:30240.00, p18x:1904.00},
    {n:19, invs:5, g:1520, kwp:11.4, descMax:28619.53, pVista:29750, pOrc:31237.50, p18x:1966.81},
    {n:20, invs:5, g:1600, kwp:12.0, descMax:29555.40, pVista:30750, pOrc:32287.50, p18x:2032.92}
  ]
},

"SAJ-6K-TCL": {
  inv: "SAJ 6K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:5 , invs:1, g:375 , kwp:3.0 , descMax:10121.15, pVista:10550, pOrc:11077.50, p18x:697.47},
    {n:6 , invs:1, g:450 , kwp:3.6 , descMax:11137.75, pVista:11600, pOrc:12180.00, p18x:766.89},
    {n:7 , invs:1, g:525 , kwp:4.2 , descMax:12154.35, pVista:12650, pOrc:13282.50, p18x:836.31},
    {n:8 , invs:1, g:600 , kwp:4.8 , descMax:13170.95, pVista:13700, pOrc:14385.00, p18x:905.72},
    {n:9 , invs:1, g:675 , kwp:5.4 , descMax:14366.95, pVista:14950, pOrc:15697.50, p18x:988.36},
    {n:10, invs:1, g:750 , kwp:6.0 , descMax:15383.55, pVista:16000, pOrc:16800.00, p18x:1057.78},
    {n:11, invs:1, g:825 , kwp:6.6 , descMax:16400.15, pVista:17050, pOrc:17902.50, p18x:1127.19},
    {n:12, invs:1, g:900 , kwp:7.2 , descMax:17416.75, pVista:18100, pOrc:19005.00, p18x:1196.61},
    {n:13, invs:1, g:975 , kwp:7.8 , descMax:18612.75, pVista:19350, pOrc:20317.50, p18x:1279.25},
    {n:14, invs:1, g:1050, kwp:8.4 , descMax:19629.35, pVista:20400, pOrc:21420.00, p18x:1348.67},
    {n:15, invs:1, g:1125, kwp:9.0 , descMax:20645.95, pVista:21500, pOrc:22575.00, p18x:1421.39},
    {n:16, invs:1, g:1200, kwp:9.6 , descMax:21662.55, pVista:22550, pOrc:23677.50, p18x:1490.81},
    {n:17, invs:1, g:1275, kwp:10.2, descMax:22858.55, pVista:23750, pOrc:24937.50, p18x:1570.14},
    {n:18, invs:1, g:1350, kwp:10.8 , descMax:23875.15, pVista:24850, pOrc:26092.50, p18x:1642.86}
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
// De 10 a 18 este kit e' mais caro que o SAJ 6K (+R$1.450 a R$1.500) pela MESMA geracao —
// so' faz sentido quando o cliente quer folga de inversor. Quem quer barato usa o 6K.
"SAJ-7.3K-TCL": {
  inv: "SAJ 7,3K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:10, invs:1, g:750 , kwp:6   , descMax:16815.76, pVista:17500, pOrc:18375.00, p18x:1156.94},
    {n:11, invs:1, g:825 , kwp:6.6 , descMax:17832.36, pVista:18550, pOrc:19477.50, p18x:1226.36},
    {n:12, invs:1, g:900 , kwp:7.2 , descMax:18848.96, pVista:19600, pOrc:20580.00, p18x:1295.78},
    {n:13, invs:1, g:975 , kwp:7.8 , descMax:20044.96, pVista:20850, pOrc:21892.50, p18x:1378.42},
    {n:14, invs:1, g:1050, kwp:8.4 , descMax:21061.56, pVista:21900, pOrc:22995.00, p18x:1447.83},
    {n:15, invs:1, g:1125, kwp:9   , descMax:22078.16, pVista:22950, pOrc:24097.50, p18x:1517.25},
    {n:16, invs:1, g:1200, kwp:9.6 , descMax:23094.76, pVista:24000, pOrc:25200.00, p18x:1586.67},
    {n:17, invs:1, g:1275, kwp:10.2, descMax:24290.76, pVista:25250, pOrc:26512.50, p18x:1669.31},
    {n:18, invs:1, g:1350, kwp:10.8, descMax:25307.36, pVista:26300, pOrc:27615.00, p18x:1738.72},
    {n:19, invs:1, g:1425, kwp:11.4, descMax:26323.96, pVista:27350, pOrc:28717.50, p18x:1808.14},
    {n:20, invs:1, g:1500, kwp:12  , descMax:27340.56, pVista:28450, pOrc:29872.50, p18x:1880.86},
    {n:21, invs:1, g:1575, kwp:12.6, descMax:28536.56, pVista:29650, pOrc:31132.50, p18x:1960.19},
    {n:22, invs:1, g:1650, kwp:13.2, descMax:29553.16, pVista:30700, pOrc:32235.00, p18x:2029.61},
    {n:23, invs:1, g:1725, kwp:13.8, descMax:30569.76, pVista:31800, pOrc:33390.00, p18x:2102.33}
  ]
},

"SAJ-3K-PROMO": {
  inv: "SAJ 3K", mod: "TCL 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:4, invs:1, g:300, kwp:2.4, descMax:7950.00, pVista:7950, pOrc:7950.00, p18x:1231.46},
    {n:5, invs:1, g:375, kwp:3.0, descMax:9100.00, pVista:9100, pOrc:9100.00, p18x:1409.59},
    {n:6, invs:1, g:450, kwp:3.6, descMax:10150.00, pVista:10150, pOrc:10150.00, p18x:1572.23},
    {n:7, invs:1, g:525, kwp:4.2, descMax:11500.00, pVista:11500, pOrc:11500.00, p18x:1781.35}
  ]
},

"SOLAX-1.875K-ERA620W": {
  inv: "SOLAX 1,875K", mod: "Era 620W", pot: 620, precoExato: true,
  rows: [
    {n:3, invs:1, g:240, kwp:1.86, descMax:7600.00, pVista:7600, pOrc:7600.00, p18x:1177.24},
    {n:4, invs:1, g:320, kwp:2.48, descMax:8650.00, pVista:8650, pOrc:8650.00, p18x:1339.89},
    {n:5, invs:2, g:400, kwp:3.1, descMax:12450.00, pVista:12450, pOrc:12450.00, p18x:1928.51},
    {n:6, invs:2, g:480, kwp:3.72, descMax:13550.00, pVista:13550, pOrc:13550.00, p18x:2098.90},
    {n:7, invs:2, g:560, kwp:4.34, descMax:14550.00, pVista:14550, pOrc:14550.00, p18x:2253.80},
    {n:8, invs:2, g:640, kwp:4.96, descMax:15600.00, pVista:15600, pOrc:15600.00, p18x:2416.45},
    {n:9, invs:3, g:720, kwp:5.58, descMax:19450.00, pVista:19450, pOrc:19450.00, p18x:3012.81},
    {n:10, invs:3, g:800, kwp:6.2, descMax:20500.00, pVista:20500, pOrc:20500.00, p18x:3175.45},
    {n:11, invs:3, g:880, kwp:6.82, descMax:21550.00, pVista:21550, pOrc:21550.00, p18x:3338.10},
    {n:12, invs:3, g:960 , kwp:7.44, descMax:22600.00, pVista:22600, pOrc:22600.00, p18x:3500.75},
    {n:13, invs:4, g:1040, kwp:8.06, descMax:26400.00, pVista:26400, pOrc:26400.00, p18x:4089.37},
    {n:14, invs:4, g:1120, kwp:8.68, descMax:27450.00, pVista:27450, pOrc:27450.00, p18x:4252.01},
    {n:15, invs:4, g:1200, kwp:9.3, descMax:28500.00, pVista:28500, pOrc:28500.00, p18x:4414.66},
    {n:16, invs:4, g:1280, kwp:9.92, descMax:29600.00, pVista:29600, pOrc:29600.00, p18x:4585.04},
    {n:17, invs:5, g:1360, kwp:10.54, descMax:33350.00, pVista:33350, pOrc:33350.00, p18x:5165.92},
    {n:18, invs:5, g:1440, kwp:11.16, descMax:34400.00, pVista:34400, pOrc:34400.00, p18x:5328.56},
    {n:19, invs:5, g:1520, kwp:11.78, descMax:35500.00, pVista:35500, pOrc:35500.00, p18x:5498.96},
    {n:20, invs:5, g:1600, kwp:12.4, descMax:36550.00, pVista:36550, pOrc:36550.00, p18x:5661.60},
    {n:21, invs:6, g:1680, kwp:13.02, descMax:40250.00, pVista:40250, pOrc:40250.00, p18x:6234.73},
    {n:22, invs:6, g:1760, kwp:13.64, descMax:41350.00, pVista:41350, pOrc:41350.00, p18x:6405.12},
    {n:23, invs:6, g:1840, kwp:14.26, descMax:42450.00, pVista:42450, pOrc:42450.00, p18x:6575.51},
    {n:24, invs:6, g:1920, kwp:14.88, descMax:43550.00, pVista:43550, pOrc:43550.00, p18x:6745.90},
    {n:25, invs:7, g:2000, kwp:15.5, descMax:47250.00, pVista:47250, pOrc:47250.00, p18x:7319.03},
    {n:26, invs:7, g:2080, kwp:16.12, descMax:48300.00, pVista:48300, pOrc:48300.00, p18x:7481.67},
    {n:27, invs:7, g:2160, kwp:16.74, descMax:49400.00, pVista:49400, pOrc:49400.00, p18x:7652.07},
    {n:28, invs:7, g:2240, kwp:17.36, descMax:50500.00, pVista:50500, pOrc:50500.00, p18x:7822.45},
    {n:29, invs:8, g:2320, kwp:17.98, descMax:54200.00, pVista:54200, pOrc:54200.00, p18x:8395.58},
    {n:30, invs:8, g:2400, kwp:18.6, descMax:55300.00, pVista:55300, pOrc:55300.00, p18x:8565.98},
    {n:31, invs:8, g:2480, kwp:19.22, descMax:56350.00, pVista:56350, pOrc:56350.00, p18x:8728.62},
    {n:32, invs:8, g:2560, kwp:19.84, descMax:57450.00, pVista:57450, pOrc:57450.00, p18x:8899.01}
  ]
}

};
