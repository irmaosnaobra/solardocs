// ============= DADOS =============
const TABELAS = {

"MICRODEYE-TSUN600W": {
  inv: "Deye 2,25K", mod: "Tsun 600W", pot: 600,
  rows: [
    {n:3,  invs:1, g:255,  kwp:1.8,  descMax:5522.27,  pVista:5750,  pOrc:6037.50,  p18x:380.14},
    {n:4,  invs:1, g:340,  kwp:2.4,  descMax:6336.33,  pVista:6600,  pOrc:6930.00,  p18x:436.33},
    {n:5,  invs:2, g:425,  kwp:3.0,  descMax:8735.74,  pVista:9100,  pOrc:9555.00,  p18x:601.61},
    {n:6,  invs:2, g:510,  kwp:3.6,  descMax:9549.54,  pVista:9950,  pOrc:10447.50, p18x:657.81},
    {n:7,  invs:2, g:595,  kwp:4.2,  descMax:10363.34, pVista:10800, pOrc:11340.00, p18x:714.00},
    {n:8,  invs:2, g:680,  kwp:4.8,  descMax:11177.14, pVista:11650, pOrc:12232.50, p18x:770.19},
    {n:9,  invs:3, g:765,  kwp:5.4,  descMax:13576.81, pVista:14150, pOrc:14857.50, p18x:935.47},
    {n:10, invs:3, g:850,  kwp:6.0,  descMax:14390.61, pVista:15000, pOrc:15750.00, p18x:991.67},
    {n:11, invs:3, g:935,  kwp:6.6,  descMax:15204.41, pVista:15800, pOrc:16590.00, p18x:1044.56},
    {n:12, invs:3, g:1020, kwp:7.2,  descMax:16018.21, pVista:16700, pOrc:17535.00, p18x:1100.75},
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
    {n:4, invs:1, g:320, kwp:2.4, descMax:7116.20,  pVista:7400,  pOrc:7770.00,  p18x:489.22},
    {n:5, invs:1, g:400, kwp:3.0, descMax:8125.00,  pVista:8450,  pOrc:8872.50,  p18x:558.64},
    {n:6, invs:1, g:480, kwp:3.6, descMax:8977.80,  pVista:9350,  pOrc:9817.50,  p18x:618.14},
    {n:7, invs:1, g:560, kwp:4.2, descMax:9830.60,  pVista:10250, pOrc:10762.50, p18x:677.64},
    {n:8, invs:1, g:640, kwp:4.8, descMax:10683.40, pVista:11150, pOrc:11707.50, p18x:737.14}
  ]
},

"SAJ-6K": {
  inv: "SAJ 6K", mod: "Tsun 600W", pot: 600,
  rows: [
    {n:8,  invs:1, g:640,  kwp:4.8,  descMax:11453.00, pVista:11950, pOrc:12547.50, p18x:790.03},
    {n:9,  invs:1, g:720,  kwp:5.4,  descMax:12493.00, pVista:13000, pOrc:13650.00, p18x:859.44},
    {n:10, invs:1, g:800,  kwp:6.0,  descMax:13377.00, pVista:13950, pOrc:14647.50, p18x:922.25},
    {n:11, invs:1, g:880,  kwp:6.6,  descMax:14261.00, pVista:14850, pOrc:15592.50, p18x:981.75},
    {n:12, invs:1, g:960,  kwp:7.2,  descMax:15145.00, pVista:15750, pOrc:16537.50, p18x:1041.25},
    {n:13, invs:1, g:1040, kwp:7.8,  descMax:16185.00, pVista:16850, pOrc:17692.50, p18x:1113.97},
    {n:14, invs:1, g:1120, kwp:8.4,  descMax:17069.00, pVista:17750, pOrc:18637.50, p18x:1173.47},
    {n:15, invs:1, g:1200, kwp:9.0,  descMax:17953.00, pVista:18700, pOrc:19635.00, p18x:1236.28},
    {n:16, invs:1, g:1280, kwp:9.6,  descMax:18837.00, pVista:19600, pOrc:20580.00, p18x:1295.78},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:19877.00, pVista:20700, pOrc:21735.00, p18x:1368.50},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:20761.00, pVista:21600, pOrc:22680.00, p18x:1428.00},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:21645.00, pVista:22500, pOrc:23625.00, p18x:1487.50},
    {n:20, invs:1, g:1600, kwp:12.0, descMax:22529.00, pVista:23450, pOrc:24622.50, p18x:1550.31}
  ]
},

"SUNGROW-5K": {
  inv: "Sungrow 5K", mod: "ZNShine 600W", pot: 600,
  rows: [
    {n:6,  invs:1, g:480,  kwp:3.6,  descMax:11662.30, pVista:12150, pOrc:12757.50, p18x:803.25},
    {n:7,  invs:1, g:560,  kwp:4.2,  descMax:12569.70, pVista:13100, pOrc:13755.00, p18x:866.06},
    {n:8,  invs:1, g:640,  kwp:4.8,  descMax:13520.00, pVista:14050, pOrc:14752.50, p18x:928.86},
    {n:9,  invs:1, g:720,  kwp:5.4,  descMax:14595.10, pVista:15200, pOrc:15960.00, p18x:1004.89},
    {n:10, invs:1, g:800,  kwp:6.0,  descMax:15503.80, pVista:16150, pOrc:16957.50, p18x:1067.69},
    {n:11, invs:1, g:880,  kwp:6.6,  descMax:16429.40, pVista:17100, pOrc:17955.00, p18x:1130.50},
    {n:12, invs:1, g:960,  kwp:7.2,  descMax:17407.00, pVista:18100, pOrc:19005.00, p18x:1196.61},
    {n:13, invs:1, g:1040, kwp:7.8,  descMax:18811.00, pVista:19550, pOrc:20527.50, p18x:1292.47},
    {n:14, invs:1, g:1120, kwp:8.4,  descMax:19718.40, pVista:20500, pOrc:21525.00, p18x:1355.28},
    {n:15, invs:1, g:1200, kwp:9.0,  descMax:20633.60, pVista:21450, pOrc:22522.50, p18x:1418.08},
    {n:16, invs:1, g:1280, kwp:9.6,  descMax:21594.30, pVista:22450, pOrc:23572.50, p18x:1484.19}
  ]
},

"SUNGROW-7.5K": {
  inv: "Sungrow 7,5K", mod: "ZNShine 600W", pot: 600,
  rows: [
    {n:15, invs:1, g:1200, kwp:9.0,  descMax:21842.60, pVista:22700, pOrc:23835.00, p18x:1500.72},
    {n:16, invs:1, g:1280, kwp:9.6,  descMax:22802.00, pVista:23700, pOrc:24885.00, p18x:1566.83},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:23992.80, pVista:24950, pOrc:26197.50, p18x:1649.47},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:24953.50, pVista:25950, pOrc:27247.50, p18x:1715.58},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:25914.20, pVista:26950, pOrc:28297.50, p18x:1781.69},
    {n:20, invs:1, g:1600, kwp:12.0, descMax:26874.90, pVista:27950, pOrc:29347.50, p18x:1847.81},
    {n:21, invs:1, g:1680, kwp:12.6, descMax:28064.40, pVista:29200, pOrc:30660.00, p18x:1930.44},
    {n:22, invs:1, g:1760, kwp:13.2, descMax:29025.10, pVista:30200, pOrc:31710.00, p18x:1996.56},
    {n:23, invs:1, g:1840, kwp:13.8, descMax:29985.80, pVista:31150, pOrc:32707.50, p18x:2059.36},
    {n:24, invs:1, g:1920, kwp:14.4, descMax:30946.50, pVista:32150, pOrc:33757.50, p18x:2125.47},
    {n:25, invs:1, g:2000, kwp:15.0, descMax:32134.70, pVista:33400, pOrc:35070.00, p18x:2208.11}
  ]
}

};
