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
//   SOLAX 1,875K + Era 620W ..... 3 a 32  (preco cravado)
// Sairam de linha, alem das quatro com Tsun: Micro SAJ 2,25K, SAJ 7,5K, Sungrow 5K,
// Sungrow 7,5K e Tsunnes 2,25K. Nenhum kit atende acima de 18 placas hoje — o SAJ 7,3K
// (10 a 23 placas) foi pedido em 20/08 e esta' parado esperando o custo do inversor.
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
    {n:3 , invs:1, g:240 , kwp:1.8 , descMax:5522.27 , pVista:5750 , pOrc:6037.50 , p18x:380.14},
    {n:4 , invs:1, g:320 , kwp:2.4 , descMax:6336.33 , pVista:6600 , pOrc:6930.00 , p18x:436.33},
    {n:5 , invs:2, g:400 , kwp:3.0 , descMax:8735.74 , pVista:9100 , pOrc:9555.00 , p18x:601.61},
    {n:6 , invs:2, g:480 , kwp:3.6 , descMax:9549.54 , pVista:9950 , pOrc:10447.50, p18x:657.81},
    {n:7 , invs:2, g:560 , kwp:4.2 , descMax:10363.34, pVista:10800, pOrc:11340.00, p18x:714.00},
    {n:8 , invs:2, g:640 , kwp:4.8 , descMax:11177.14, pVista:11650, pOrc:12232.50, p18x:770.19},
    {n:9 , invs:3, g:720 , kwp:5.4 , descMax:13576.81, pVista:14150, pOrc:14857.50, p18x:935.47},
    {n:10, invs:3, g:800 , kwp:6.0 , descMax:14390.61, pVista:15000, pOrc:15750.00, p18x:991.67},
    {n:11, invs:3, g:880 , kwp:6.6 , descMax:15204.41, pVista:15800, pOrc:16590.00, p18x:1044.56},
    {n:12, invs:3, g:960 , kwp:7.2 , descMax:16018.21, pVista:16700, pOrc:17535.00, p18x:1100.75},
    {n:13, invs:4, g:1040, kwp:7.8 , descMax:18417.88, pVista:19150, pOrc:20107.50, p18x:1266.03},
    {n:14, invs:4, g:1120, kwp:8.4 , descMax:19231.68, pVista:20000, pOrc:21000.00, p18x:1322.22},
    {n:15, invs:4, g:1200, kwp:9.0 , descMax:20045.48, pVista:20850, pOrc:21892.50, p18x:1378.42},
    {n:16, invs:4, g:1280, kwp:9.6 , descMax:20859.28, pVista:21700, pOrc:22785.00, p18x:1434.61},
    {n:17, invs:5, g:1360, kwp:10.2, descMax:23258.95, pVista:24200, pOrc:25410.00, p18x:1599.89},
    {n:18, invs:5, g:1440, kwp:10.8, descMax:24072.75, pVista:25050, pOrc:26302.50, p18x:1656.08},
    {n:19, invs:5, g:1520, kwp:11.4, descMax:24886.55, pVista:25900, pOrc:27195.00, p18x:1712.28},
    {n:20, invs:5, g:1600, kwp:12.0, descMax:25700.35, pVista:26700, pOrc:28035.00, p18x:1765.42}
  ]
},

"SAJ-6K-TCL": {
  inv: "SAJ 6K", mod: "TCL 600W", pot: 600,
  rows: [
    {n:5 , invs:1, g:375 , kwp:3.0 , descMax:8801.00 , pVista:9150 , pOrc:9607.50 , p18x:604.92},
    {n:6 , invs:1, g:450 , kwp:3.6 , descMax:9685.00 , pVista:10100, pOrc:10605.00, p18x:667.72},
    {n:7 , invs:1, g:525 , kwp:4.2 , descMax:10569.00, pVista:11000, pOrc:11550.00, p18x:727.22},
    {n:8 , invs:1, g:600 , kwp:4.8 , descMax:11453.00, pVista:11950, pOrc:12547.50, p18x:790.03},
    {n:9 , invs:1, g:675 , kwp:5.4 , descMax:12493.00, pVista:13000, pOrc:13650.00, p18x:859.44},
    {n:10, invs:1, g:750 , kwp:6.0 , descMax:13377.00, pVista:13950, pOrc:14647.50, p18x:922.25},
    {n:11, invs:1, g:825 , kwp:6.6 , descMax:14261.00, pVista:14850, pOrc:15592.50, p18x:981.75},
    {n:12, invs:1, g:900 , kwp:7.2 , descMax:15145.00, pVista:15750, pOrc:16537.50, p18x:1041.25},
    {n:13, invs:1, g:975 , kwp:7.8 , descMax:16185.00, pVista:16850, pOrc:17692.50, p18x:1113.97},
    {n:14, invs:1, g:1050, kwp:8.4 , descMax:17069.00, pVista:17750, pOrc:18637.50, p18x:1173.47},
    {n:15, invs:1, g:1125, kwp:9.0 , descMax:17953.00, pVista:18700, pOrc:19635.00, p18x:1236.28},
    {n:16, invs:1, g:1200, kwp:9.6 , descMax:18837.00, pVista:19600, pOrc:20580.00, p18x:1295.78},
    {n:17, invs:1, g:1275, kwp:10.2, descMax:19877.00, pVista:20700, pOrc:21735.00, p18x:1368.50},
    {n:18, invs:1, g:1350, kwp:10.8 , descMax:20761.00, pVista:21600, pOrc:22680.00, p18x:1428.00}
  ]
},

"SAJ-3K-PROMO": {
  inv: "SAJ 3K", mod: "TCL 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:4, invs:1, g:300, kwp:2.4, descMax:6895, pVista:6895, pOrc:6895, p18x:1068.04},
    {n:5, invs:1, g:375, kwp:3.0, descMax:7889, pVista:7889, pOrc:7889, p18x:1222.01},
    {n:6, invs:1, g:450, kwp:3.6, descMax:8811, pVista:8811, pOrc:8811, p18x:1364.82},
    {n:7, invs:1, g:525, kwp:4.2, descMax:9988, pVista:9988, pOrc:9988, p18x:1547.14}
  ]
},

"SOLAX-1.875K-ERA620W": {
  inv: "SOLAX 1,875K", mod: "Era 620W", pot: 620, precoExato: true,
  rows: [
    {n:3, invs:1, g:240, kwp:1.86, descMax:6600.00, pVista:6600, pOrc:6600.00, p18x:1022.34},
    {n:4, invs:1, g:320, kwp:2.48, descMax:7500.00, pVista:7500, pOrc:7500.00, p18x:1161.75},
    {n:5, invs:2, g:400, kwp:3.1, descMax:10800.00, pVista:10800, pOrc:10800.00, p18x:1672.92},
    {n:6, invs:2, g:480, kwp:3.72, descMax:11750.00, pVista:11750, pOrc:11750.00, p18x:1820.08},
    {n:7, invs:2, g:560, kwp:4.34, descMax:12650.00, pVista:12650, pOrc:12650.00, p18x:1959.49},
    {n:8, invs:2, g:640, kwp:4.96, descMax:13550.00, pVista:13550, pOrc:13550.00, p18x:2098.9},
    {n:9, invs:3, g:720, kwp:5.58, descMax:16900.00, pVista:16900, pOrc:16900.00, p18x:2617.81},
    {n:10, invs:3, g:800, kwp:6.2, descMax:17800.00, pVista:17800, pOrc:17800.00, p18x:2757.22},
    {n:11, invs:3, g:880, kwp:6.82, descMax:18700.00, pVista:18700, pOrc:18700.00, p18x:2896.63},
    {n:12, invs:3, g:960 , kwp:7.44, descMax:19650.00, pVista:19650, pOrc:19650.00, p18x:3043.79},
    {n:13, invs:4, g:1040, kwp:8.06, descMax:22950.00, pVista:22950, pOrc:22950.00, p18x:3554.96},
    {n:14, invs:4, g:1120, kwp:8.68, descMax:23850.00, pVista:23850, pOrc:23850.00, p18x:3694.37},
    {n:15, invs:4, g:1200, kwp:9.3, descMax:24750.00, pVista:24750, pOrc:24750.00, p18x:3833.78},
    {n:16, invs:4, g:1280, kwp:9.92, descMax:25700.00, pVista:25700, pOrc:25700.00, p18x:3980.93},
    {n:17, invs:5, g:1360, kwp:10.54, descMax:29000.00, pVista:29000, pOrc:29000.00, p18x:4492.1},
    {n:18, invs:5, g:1440, kwp:11.16, descMax:29900.00, pVista:29900, pOrc:29900.00, p18x:4631.51},
    {n:19, invs:5, g:1520, kwp:11.78, descMax:30850.00, pVista:30850, pOrc:30850.00, p18x:4778.67},
    {n:20, invs:5, g:1600, kwp:12.4, descMax:31750.00, pVista:31750, pOrc:31750.00, p18x:4918.08},
    {n:21, invs:6, g:1680, kwp:13.02, descMax:35000.00, pVista:35000, pOrc:35000.00, p18x:5421.5},
    {n:22, invs:6, g:1760, kwp:13.64, descMax:35950.00, pVista:35950, pOrc:35950.00, p18x:5568.66},
    {n:23, invs:6, g:1840, kwp:14.26, descMax:36900.00, pVista:36900, pOrc:36900.00, p18x:5715.81},
    {n:24, invs:6, g:1920, kwp:14.88, descMax:37850.00, pVista:37850, pOrc:37850.00, p18x:5862.97},
    {n:25, invs:7, g:2000, kwp:15.5, descMax:41050.00, pVista:41050, pOrc:41050.00, p18x:6358.65},
    {n:26, invs:7, g:2080, kwp:16.12, descMax:42000.00, pVista:42000, pOrc:42000.00, p18x:6505.8},
    {n:27, invs:7, g:2160, kwp:16.74, descMax:42950.00, pVista:42950, pOrc:42950.00, p18x:6652.96},
    {n:28, invs:7, g:2240, kwp:17.36, descMax:43900.00, pVista:43900, pOrc:43900.00, p18x:6800.11},
    {n:29, invs:8, g:2320, kwp:17.98, descMax:47100.00, pVista:47100, pOrc:47100.00, p18x:7295.79},
    {n:30, invs:8, g:2400, kwp:18.6, descMax:48050.00, pVista:48050, pOrc:48050.00, p18x:7442.95},
    {n:31, invs:8, g:2480, kwp:19.22, descMax:49000.00, pVista:49000, pOrc:49000.00, p18x:7590.1},
    {n:32, invs:8, g:2560, kwp:19.84, descMax:49950.00, pVista:49950, pOrc:49950.00, p18x:7737.26}
  ]
}

};
