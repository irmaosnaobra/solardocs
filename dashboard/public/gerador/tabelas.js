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
// O preco da placa NAO tem celula propria: mora dentro da coluna N junto do inversor e da
// estrutura. Reajuste de placa se aplica como delta por placa (N += delta x n_placas).
// Ultimo: 18/08/2026, placa Tsun 600W de R$456 para R$620 (+R$164 por placa).
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
// CUIDADO com o modulo: nem todo kit "SAJ" usa a mesma placa. SAJ 2,25K, SAJ 3K PROMO e
// SAJ 7,5K rodam com TCL 600W; SAJ 3K, SAJ 6K e as duas do 6K PROMO rodam com Tsun 600W.
// O SAJ 3K PROMO NAO herda o custo da aba "SAJ 3K - TSUN 600W" — sao placas diferentes,
// e o custo dele nao esta na planilha. Reajuste de Tsun nao pode passar por ele.
const TABELAS = {

"MICRODEYE-TSUN600W": {
  inv: "Deye 2,25K", mod: "Tsun 600W", pot: 600,
  rows: [
    {n:3 , invs:1, g:255 , kwp:1.8 , descMax:6161.87 , pVista:6450 , pOrc:6772.50 , p18x:426.42},
    {n:4 , invs:1, g:340 , kwp:2.4 , descMax:7188.87 , pVista:7500 , pOrc:7875.00 , p18x:495.83},
    {n:5 , invs:2, g:425 , kwp:3.0 , descMax:9801.74 , pVista:10200, pOrc:10710.00, p18x:674.33},
    {n:6 , invs:2, g:510 , kwp:3.6 , descMax:10828.74, pVista:11300, pOrc:11865.00, p18x:747.06},
    {n:7 , invs:2, g:595 , kwp:4.2 , descMax:11855.74, pVista:12350, pOrc:12967.50, p18x:816.47},
    {n:8 , invs:2, g:680 , kwp:4.8 , descMax:12882.74, pVista:13400, pOrc:14070.00, p18x:885.89},
    {n:9 , invs:3, g:765 , kwp:5.4 , descMax:15495.61, pVista:16150, pOrc:16957.50, p18x:1067.69},
    {n:10, invs:3, g:850 , kwp:6.0 , descMax:16522.61, pVista:17200, pOrc:18060.00, p18x:1137.11},
    {n:11, invs:3, g:935 , kwp:6.6 , descMax:17549.61, pVista:18250, pOrc:19162.50, p18x:1206.53},
    {n:12, invs:3, g:1020, kwp:7.2 , descMax:18576.61, pVista:19350, pOrc:20317.50, p18x:1279.25},
    {n:13, invs:4, g:1105, kwp:7.8 , descMax:21189.48, pVista:22050, pOrc:23152.50, p18x:1457.75},
    {n:14, invs:4, g:1190, kwp:8.4 , descMax:22216.48, pVista:23100, pOrc:24255.00, p18x:1527.17},
    {n:15, invs:4, g:1275, kwp:9.0 , descMax:23243.48, pVista:24150, pOrc:25357.50, p18x:1596.58},
    {n:16, invs:4, g:1360, kwp:9.6 , descMax:24270.48, pVista:25250, pOrc:26512.50, p18x:1669.31},
    {n:17, invs:5, g:1445, kwp:10.2, descMax:26883.35, pVista:27950, pOrc:29347.50, p18x:1847.81},
    {n:18, invs:5, g:1530, kwp:10.8, descMax:27910.35, pVista:29000, pOrc:30450.00, p18x:1917.22},
    {n:19, invs:5, g:1615, kwp:11.4, descMax:28937.35, pVista:30100, pOrc:31605.00, p18x:1989.94},
    {n:20, invs:5, g:1700, kwp:12.0, descMax:29964.35, pVista:31150, pOrc:32707.50, p18x:2059.36}
  ]
},

"SAJ-2.25K-TSUN600W": {
  inv: "SAJ 2,25K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:3,  invs:1, g:255,  kwp:1.8,  descMax:5522.27,  pVista:5750,  pOrc:6037.50,  p18x:380.14},
    {n:4,  invs:1, g:340,  kwp:2.4,  descMax:6336.07,  pVista:6600,  pOrc:6930.00,  p18x:436.33},
    {n:5,  invs:2, g:425,  kwp:3.0,  descMax:8735.74,  pVista:9100,  pOrc:9555.00,  p18x:601.61},
    {n:6,  invs:2, g:510,  kwp:3.6,  descMax:9549.54,  pVista:9950,  pOrc:10447.50, p18x:657.81},
    {n:7,  invs:2, g:595,  kwp:4.2,  descMax:10363.34, pVista:10800, pOrc:11340.00, p18x:714.00},
    {n:8,  invs:2, g:680,  kwp:4.8,  descMax:11177.14, pVista:11650, pOrc:12232.50, p18x:770.19},
    {n:9,  invs:3, g:765,  kwp:5.4,  descMax:13576.81, pVista:14150, pOrc:14857.50, p18x:935.47},
    {n:10, invs:3, g:850,  kwp:6.0,  descMax:14390.61, pVista:15000, pOrc:15750.00, p18x:991.67},
    {n:11, invs:3, g:935,  kwp:6.6,  descMax:15204.41, pVista:15800, pOrc:16590.00, p18x:1044.56},
    {n:12, invs:3, g:1020, kwp:7.2,  descMax:16018.21, pVista:16650, pOrc:17482.50, p18x:1100.75},
    {n:13, invs:4, g:1105, kwp:7.8,  descMax:18417.88, pVista:19150, pOrc:20107.50, p18x:1266.03},
    {n:14, invs:4, g:1190, kwp:8.4,  descMax:19231.68, pVista:20000, pOrc:21000.00, p18x:1322.22},
    {n:15, invs:4, g:1275, kwp:9.0,  descMax:20045.48, pVista:20850, pOrc:21892.50, p18x:1378.42},
    {n:16, invs:4, g:1360, kwp:9.6,  descMax:20859.28, pVista:21700, pOrc:22785.00, p18x:1434.61},
    {n:17, invs:5, g:1445, kwp:10.2, descMax:23258.95, pVista:24200, pOrc:25410.00, p18x:1599.89},
    {n:18, invs:5, g:1530, kwp:10.8, descMax:24072.75, pVista:25050, pOrc:26302.50, p18x:1656.08},
    {n:19, invs:5, g:1615, kwp:11.4, descMax:24886.55, pVista:25900, pOrc:27195.00, p18x:1712.28},
    {n:20, invs:5, g:1700, kwp:12.0, descMax:25700.35, pVista:26700, pOrc:28035.00, p18x:1765.42}
  ]
},

"SAJ-3K": {
  inv: "SAJ 3K", mod: "Tsun 600W", pot: 600,
  rows: [
    {n:4, invs:1, g:320, kwp:2.4, descMax:7969.00 , pVista:8300 , pOrc:8715.00 , p18x:548.72},
    {n:5, invs:1, g:400, kwp:3.0, descMax:9191.00 , pVista:9600 , pOrc:10080.00, p18x:634.67},
    {n:6, invs:1, g:480, kwp:3.6, descMax:10257.00, pVista:10700, pOrc:11235.00, p18x:707.39},
    {n:7, invs:1, g:560, kwp:4.2, descMax:11323.00, pVista:11800, pOrc:12390.00, p18x:780.11},
    {n:8, invs:1, g:640, kwp:4.8, descMax:12389.00, pVista:12900, pOrc:13545.00, p18x:852.83}
  ]
},

"SAJ-6K": {
  inv: "SAJ 6K", mod: "Tsun 600W", pot: 600,
  rows: [
    {n:5 , invs:1, g:400 , kwp:3.0 , descMax:9867.00 , pVista:10300, pOrc:10815.00, p18x:680.94},
    {n:6 , invs:1, g:480 , kwp:3.6 , descMax:10964.20, pVista:11400, pOrc:11970.00, p18x:753.67},
    {n:7 , invs:1, g:560 , kwp:4.2 , descMax:12061.40, pVista:12550, pOrc:13177.50, p18x:829.69},
    {n:8 , invs:1, g:640 , kwp:4.8 , descMax:13158.60, pVista:13700, pOrc:14385.00, p18x:905.72},
    {n:9 , invs:1, g:720 , kwp:5.4 , descMax:14411.80, pVista:15000, pOrc:15750.00, p18x:991.67},
    {n:10, invs:1, g:800 , kwp:6.0 , descMax:15509.00, pVista:16150, pOrc:16957.50, p18x:1067.69},
    {n:11, invs:1, g:880 , kwp:6.6 , descMax:16606.20, pVista:17300, pOrc:18165.00, p18x:1143.72},
    {n:12, invs:1, g:960 , kwp:7.2 , descMax:17703.40, pVista:18400, pOrc:19320.00, p18x:1216.44},
    {n:13, invs:1, g:1040, kwp:7.8 , descMax:18956.60, pVista:19700, pOrc:20685.00, p18x:1302.39},
    {n:14, invs:1, g:1120, kwp:8.4 , descMax:20053.80, pVista:20850, pOrc:21892.50, p18x:1378.42},
    {n:15, invs:1, g:1200, kwp:9.0 , descMax:21151.00, pVista:22000, pOrc:23100.00, p18x:1454.44},
    {n:16, invs:1, g:1280, kwp:9.6 , descMax:22248.20, pVista:23150, pOrc:24307.50, p18x:1530.47},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:23501.40, pVista:24450, pOrc:25672.50, p18x:1616.42},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:24598.60, pVista:25600, pOrc:26880.00, p18x:1692.44},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:25695.80, pVista:26700, pOrc:28035.00, p18x:1765.17},
    {n:20, invs:1, g:1600, kwp:12.0, descMax:26793.00, pVista:27850, pOrc:29242.50, p18x:1841.19}
  ]
},

"SAJ-3K-PROMO": {
  inv: "SAJ 3K", mod: "TCL 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:4, invs:1, g:320, kwp:2.4, descMax:6895, pVista:6895, pOrc:6895, p18x:1068.04},
    {n:5, invs:1, g:400, kwp:3.0, descMax:7889, pVista:7889, pOrc:7889, p18x:1222.01},
    {n:6, invs:1, g:480, kwp:3.6, descMax:8811, pVista:8811, pOrc:8811, p18x:1364.82},
    {n:7, invs:1, g:560, kwp:4.2, descMax:9988, pVista:9988, pOrc:9988, p18x:1547.14}
  ]
},

"SAJ-6K-PROMO": {
  inv: "SAJ 6K", mod: "Tsun 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:5 , invs:1, g:400 , kwp:3.0 , descMax:9800 , pVista:9800 , pOrc:9800 , p18x:1518.02},
    {n:6 , invs:1, g:480 , kwp:3.6 , descMax:10890, pVista:10890, pOrc:10890, p18x:1686.86},
    {n:7 , invs:1, g:560 , kwp:4.2 , descMax:11980, pVista:11980, pOrc:11980, p18x:1855.70},
    {n:8 , invs:1, g:640 , kwp:4.8 , descMax:13050, pVista:13050, pOrc:13050, p18x:2021.44},
    {n:9 , invs:1, g:720 , kwp:5.4 , descMax:14290, pVista:14290, pOrc:14290, p18x:2213.52},
    {n:10, invs:1, g:800 , kwp:6.0 , descMax:15070, pVista:15070, pOrc:15070, p18x:2334.45},
    {n:11, invs:1, g:880 , kwp:6.6 , descMax:16300, pVista:16300, pOrc:16300, p18x:2524.99},
    {n:12, invs:1, g:960 , kwp:7.2 , descMax:18190, pVista:18190, pOrc:18190, p18x:2817.63},
    {n:13, invs:1, g:1040, kwp:7.8 , descMax:19700, pVista:19700, pOrc:19700, p18x:3051.54},
    {n:14, invs:1, g:1120, kwp:8.4 , descMax:20790, pVista:20790, pOrc:20790, p18x:3220.38},
    {n:15, invs:1, g:1200, kwp:9.0 , descMax:22000, pVista:22000, pOrc:22000, p18x:3407.80},
    {n:16, invs:1, g:1280, kwp:9.6 , descMax:23070, pVista:23070, pOrc:23070, p18x:3573.55},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:24450, pVista:24450, pOrc:24450, p18x:3787.30},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:25580, pVista:25580, pOrc:25580, p18x:3962.34},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:26700, pVista:26700, pOrc:26700, p18x:4135.83},
    {n:20, invs:1, g:1600, kwp:12.0, descMax:27360, pVista:27360, pOrc:27360, p18x:4238.14}
  ]
},

"SUNGROW-5K": {
  inv: "Sungrow 5K", mod: "ZNShine 600W", pot: 600, precoExato: true,
  rows: [
    {n:6, invs:1, g:480, kwp:3.6, descMax:11850.00, pVista:11850, pOrc:11850.00, p18x:1835.57},
    {n:7, invs:1, g:560, kwp:4.2, descMax:12750.00, pVista:12750, pOrc:12750.00, p18x:1974.98},
    {n:8, invs:1, g:640, kwp:4.8, descMax:13700.00, pVista:13700, pOrc:13700.00, p18x:2122.13},
    {n:9, invs:1, g:720, kwp:5.4, descMax:14800.00, pVista:14800, pOrc:14800.00, p18x:2292.52},
    {n:10, invs:1, g:800, kwp:6, descMax:15750.00, pVista:15750, pOrc:15750.00, p18x:2439.68},
    {n:11, invs:1, g:880, kwp:6.6, descMax:16650.00, pVista:16650, pOrc:16650.00, p18x:2579.09},
    {n:12, invs:1, g:960, kwp:7.2, descMax:17650.00, pVista:17650, pOrc:17650.00, p18x:2733.99},
    {n:13, invs:1, g:1040, kwp:7.8, descMax:19100.00, pVista:19100, pOrc:19100.00, p18x:2958.59},
    {n:14, invs:1, g:1120, kwp:8.4, descMax:20000.00, pVista:20000, pOrc:20000.00, p18x:3098},
    {n:15, invs:1, g:1200, kwp:9, descMax:20900.00, pVista:20900, pOrc:20900.00, p18x:3237.41}
  ]
},

"SUNGROW-7.5K": {
  inv: "Sungrow 7,5K", mod: "ZNShine 600W", pot: 600, precoExato: true,
  rows: [
    {n:15, invs:1, g:1200, kwp:9, descMax:22000.00, pVista:22000, pOrc:22000.00, p18x:3407.8},
    {n:16, invs:1, g:1280, kwp:9.6, descMax:23000.00, pVista:23000, pOrc:23000.00, p18x:3562.7},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:24000.00, pVista:24000, pOrc:24000.00, p18x:3717.6},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:25000.00, pVista:25000, pOrc:25000.00, p18x:3872.5},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:26000.00, pVista:26000, pOrc:26000.00, p18x:4027.4},
    {n:20, invs:1, g:1600, kwp:12, descMax:27000.00, pVista:27000, pOrc:27000.00, p18x:4182.3},
    {n:21, invs:1, g:1680, kwp:12.6, descMax:28000.00, pVista:28000, pOrc:28000.00, p18x:4337.2},
    {n:22, invs:1, g:1760, kwp:13.2, descMax:29000.00, pVista:29000, pOrc:29000.00, p18x:4492.1},
    {n:23, invs:1, g:1840, kwp:13.8, descMax:30000.00, pVista:30000, pOrc:30000.00, p18x:4647},
    {n:24, invs:1, g:1920, kwp:14.4, descMax:31000.00, pVista:31000, pOrc:31000.00, p18x:4801.9}
  ]
},

"SAJ-7.5K": {
  inv: "SAJ 7,5K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:15, invs:1, g:1200, kwp:9.0,  descMax:21000.00, pVista:22700, pOrc:23835.00, p18x:1500.72},
    {n:16, invs:1, g:1280, kwp:9.6,  descMax:22000.00, pVista:23700, pOrc:24885.00, p18x:1566.83},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:23000.00, pVista:24950, pOrc:26197.50, p18x:1649.47},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:24000.00, pVista:25950, pOrc:27247.50, p18x:1715.58},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:25000.00, pVista:26950, pOrc:28297.50, p18x:1781.69},
    {n:20, invs:1, g:1600, kwp:12.0, descMax:26000.00, pVista:27950, pOrc:29347.50, p18x:1847.81},
    {n:21, invs:1, g:1680, kwp:12.6, descMax:27000.00, pVista:29200, pOrc:30660.00, p18x:1930.44},
    {n:22, invs:1, g:1760, kwp:13.2, descMax:28000.00, pVista:30200, pOrc:31710.00, p18x:1996.56},
    {n:23, invs:1, g:1840, kwp:13.8, descMax:29000.00, pVista:31150, pOrc:32707.50, p18x:2059.36},
    {n:24, invs:1, g:1920, kwp:14.4, descMax:30000.00, pVista:32150, pOrc:33757.50, p18x:2125.47},
    {n:25, invs:1, g:2000, kwp:15.0, descMax:31000.00, pVista:33400, pOrc:35070.00, p18x:2208.11}
  ]
},

"TSUNNES-2.25K-ERA700W": {
  inv: "Tsunnes 2,25K", mod: "Era 700W", pot: 700, precoExato: true,
  rows: [
    {n:3, invs:1, g:291, kwp:2.1, descMax:6850.00, pVista:6850, pOrc:6850.00, p18x:1061.07},
    {n:4, invs:1, g:388, kwp:2.8, descMax:7850.00, pVista:7850, pOrc:7850.00, p18x:1215.97},
    {n:5, invs:2, g:485, kwp:3.5, descMax:11250.00, pVista:11250, pOrc:11250.00, p18x:1742.63},
    {n:6, invs:2, g:582, kwp:4.2, descMax:12250.00, pVista:12250, pOrc:12250.00, p18x:1897.53},
    {n:7, invs:2, g:679, kwp:4.9, descMax:13250.00, pVista:13250, pOrc:13250.00, p18x:2052.43},
    {n:8, invs:2, g:776, kwp:5.6, descMax:14250.00, pVista:14250, pOrc:14250.00, p18x:2207.33},
    {n:9, invs:3, g:873, kwp:6.3, descMax:17650.00, pVista:17650, pOrc:17650.00, p18x:2733.99},
    {n:10, invs:3, g:970, kwp:7, descMax:18650.00, pVista:18650, pOrc:18650.00, p18x:2888.89},
    {n:11, invs:3, g:1067, kwp:7.7, descMax:19650.00, pVista:19650, pOrc:19650.00, p18x:3043.79},
    {n:12, invs:3, g:1164, kwp:8.4, descMax:20650.00, pVista:20650, pOrc:20650.00, p18x:3198.69},
    {n:13, invs:4, g:1261, kwp:9.1, descMax:24050.00, pVista:24050, pOrc:24050.00, p18x:3725.35},
    {n:14, invs:4, g:1358, kwp:9.8, descMax:25050.00, pVista:25050, pOrc:25050.00, p18x:3880.25},
    {n:15, invs:4, g:1455, kwp:10.5, descMax:26050.00, pVista:26050, pOrc:26050.00, p18x:4035.15},
    {n:16, invs:4, g:1552, kwp:11.2, descMax:27050.00, pVista:27050, pOrc:27050.00, p18x:4190.05},
    {n:17, invs:5, g:1649, kwp:11.9, descMax:30450.00, pVista:30450, pOrc:30450.00, p18x:4716.71},
    {n:18, invs:5, g:1746, kwp:12.6, descMax:31450.00, pVista:31450, pOrc:31450.00, p18x:4871.61},
    {n:19, invs:5, g:1843, kwp:13.3, descMax:32450.00, pVista:32450, pOrc:32450.00, p18x:5026.51},
    {n:20, invs:5, g:1940, kwp:14, descMax:33450.00, pVista:33450, pOrc:33450.00, p18x:5181.41},
    {n:21, invs:6, g:2037, kwp:14.7, descMax:36750.00, pVista:36750, pOrc:36750.00, p18x:5692.58},
    {n:22, invs:6, g:2134, kwp:15.4, descMax:37800.00, pVista:37800, pOrc:37800.00, p18x:5855.22},
    {n:23, invs:6, g:2231, kwp:16.1, descMax:38800.00, pVista:38800, pOrc:38800.00, p18x:6010.12},
    {n:24, invs:6, g:2328, kwp:16.8, descMax:39850.00, pVista:39850, pOrc:39850.00, p18x:6172.77},
    {n:25, invs:7, g:2425, kwp:17.5, descMax:43150.00, pVista:43150, pOrc:43150.00, p18x:6683.94},
    {n:26, invs:7, g:2522, kwp:18.2, descMax:44200.00, pVista:44200, pOrc:44200.00, p18x:6846.58},
    {n:27, invs:7, g:2619, kwp:18.9, descMax:45200.00, pVista:45200, pOrc:45200.00, p18x:7001.48},
    {n:28, invs:7, g:2716, kwp:19.6, descMax:46250.00, pVista:46250, pOrc:46250.00, p18x:7164.13},
    {n:29, invs:8, g:2813, kwp:20.3, descMax:49550.00, pVista:49550, pOrc:49550.00, p18x:7675.3},
    {n:30, invs:8, g:2910, kwp:21, descMax:50550.00, pVista:50550, pOrc:50550.00, p18x:7830.2},
    {n:31, invs:8, g:3007, kwp:21.7, descMax:51600.00, pVista:51600, pOrc:51600.00, p18x:7992.84},
    {n:32, invs:8, g:3104, kwp:22.4, descMax:52600.00, pVista:52600, pOrc:52600.00, p18x:8147.74}
  ]
},

"SOLAX-1.875K-ERA620W": {
  inv: "SOLAX 1,875K", mod: "Era 620W", pot: 620, precoExato: true,
  rows: [
    {n:3, invs:1, g:255, kwp:1.86, descMax:6600.00, pVista:6600, pOrc:6600.00, p18x:1022.34},
    {n:4, invs:1, g:340, kwp:2.48, descMax:7500.00, pVista:7500, pOrc:7500.00, p18x:1161.75},
    {n:5, invs:2, g:425, kwp:3.1, descMax:10800.00, pVista:10800, pOrc:10800.00, p18x:1672.92},
    {n:6, invs:2, g:510, kwp:3.72, descMax:11750.00, pVista:11750, pOrc:11750.00, p18x:1820.08},
    {n:7, invs:2, g:595, kwp:4.34, descMax:12650.00, pVista:12650, pOrc:12650.00, p18x:1959.49},
    {n:8, invs:2, g:680, kwp:4.96, descMax:13550.00, pVista:13550, pOrc:13550.00, p18x:2098.9},
    {n:9, invs:3, g:765, kwp:5.58, descMax:16900.00, pVista:16900, pOrc:16900.00, p18x:2617.81},
    {n:10, invs:3, g:850, kwp:6.2, descMax:17800.00, pVista:17800, pOrc:17800.00, p18x:2757.22},
    {n:11, invs:3, g:935, kwp:6.82, descMax:18700.00, pVista:18700, pOrc:18700.00, p18x:2896.63},
    {n:12, invs:3, g:1020, kwp:7.44, descMax:19650.00, pVista:19650, pOrc:19650.00, p18x:3043.79},
    {n:13, invs:4, g:1105, kwp:8.06, descMax:22950.00, pVista:22950, pOrc:22950.00, p18x:3554.96},
    {n:14, invs:4, g:1190, kwp:8.68, descMax:23850.00, pVista:23850, pOrc:23850.00, p18x:3694.37},
    {n:15, invs:4, g:1275, kwp:9.3, descMax:24750.00, pVista:24750, pOrc:24750.00, p18x:3833.78},
    {n:16, invs:4, g:1360, kwp:9.92, descMax:25700.00, pVista:25700, pOrc:25700.00, p18x:3980.93},
    {n:17, invs:5, g:1445, kwp:10.54, descMax:29000.00, pVista:29000, pOrc:29000.00, p18x:4492.1},
    {n:18, invs:5, g:1530, kwp:11.16, descMax:29900.00, pVista:29900, pOrc:29900.00, p18x:4631.51},
    {n:19, invs:5, g:1615, kwp:11.78, descMax:30850.00, pVista:30850, pOrc:30850.00, p18x:4778.67},
    {n:20, invs:5, g:1700, kwp:12.4, descMax:31750.00, pVista:31750, pOrc:31750.00, p18x:4918.08},
    {n:21, invs:6, g:1785, kwp:13.02, descMax:35000.00, pVista:35000, pOrc:35000.00, p18x:5421.5},
    {n:22, invs:6, g:1870, kwp:13.64, descMax:35950.00, pVista:35950, pOrc:35950.00, p18x:5568.66},
    {n:23, invs:6, g:1955, kwp:14.26, descMax:36900.00, pVista:36900, pOrc:36900.00, p18x:5715.81},
    {n:24, invs:6, g:2040, kwp:14.88, descMax:37850.00, pVista:37850, pOrc:37850.00, p18x:5862.97},
    {n:25, invs:7, g:2125, kwp:15.5, descMax:41050.00, pVista:41050, pOrc:41050.00, p18x:6358.65},
    {n:26, invs:7, g:2210, kwp:16.12, descMax:42000.00, pVista:42000, pOrc:42000.00, p18x:6505.8},
    {n:27, invs:7, g:2295, kwp:16.74, descMax:42950.00, pVista:42950, pOrc:42950.00, p18x:6652.96},
    {n:28, invs:7, g:2380, kwp:17.36, descMax:43900.00, pVista:43900, pOrc:43900.00, p18x:6800.11},
    {n:29, invs:8, g:2465, kwp:17.98, descMax:47100.00, pVista:47100, pOrc:47100.00, p18x:7295.79},
    {n:30, invs:8, g:2550, kwp:18.6, descMax:48050.00, pVista:48050, pOrc:48050.00, p18x:7442.95},
    {n:31, invs:8, g:2635, kwp:19.22, descMax:49000.00, pVista:49000, pOrc:49000.00, p18x:7590.1},
    {n:32, invs:8, g:2720, kwp:19.84, descMax:49950.00, pVista:49950, pOrc:49950.00, p18x:7737.26}
  ]
}

};
