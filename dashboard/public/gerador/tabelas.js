// ============= DADOS =============
// IMPORTANTE: este TABELAS é duplicado dentro de proposta.html. Ao atualizar um, atualize o outro.
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

"SAJ-2.25K-TSUN600W": {
  inv: "SAJ 2,25K", mod: "Tsun 600W", pot: 600,
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

"SAJ-3K-PROMO": {
  inv: "SAJ 3K", mod: "Tsun 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:4, invs:1, g:320, kwp:2.4, descMax:6895, pVista:6895, pOrc:6895, p18x:1068.04},
    {n:5, invs:1, g:400, kwp:3.0, descMax:7889, pVista:7889, pOrc:7889, p18x:1222.01},
    {n:6, invs:1, g:480, kwp:3.6, descMax:8811, pVista:8811, pOrc:8811, p18x:1364.82}
  ]
},

"SAJ-6K-PROMO": {
  inv: "SAJ 6K", mod: "Tsun 600W", pot: 600, precoExato: true, soCartaoVista: true,
  rows: [
    {n:8,  invs:1, g:640,  kwp:4.8,  descMax:11358, pVista:11358, pOrc:11358, p18x:1759.35},
    {n:9,  invs:1, g:720,  kwp:5.4,  descMax:12380, pVista:12380, pOrc:12380, p18x:1917.66},
    {n:10, invs:1, g:800,  kwp:6.0,  descMax:12998, pVista:12998, pOrc:12998, p18x:2013.48},
    {n:11, invs:1, g:880,  kwp:6.6,  descMax:13998, pVista:13998, pOrc:13998, p18x:2168.39},
    {n:12, invs:1, g:960,  kwp:7.2,  descMax:15553, pVista:15553, pOrc:15553, p18x:2409.16},
    {n:13, invs:1, g:1040, kwp:7.8,  descMax:16850, pVista:16850, pOrc:16850, p18x:2610.07},
    {n:14, invs:1, g:1120, kwp:8.4,  descMax:17693, pVista:17693, pOrc:17693, p18x:2740.65},
    {n:15, invs:1, g:1200, kwp:9.0,  descMax:18700, pVista:18700, pOrc:18700, p18x:2896.63},
    {n:16, invs:1, g:1280, kwp:9.6,  descMax:19528, pVista:19528, pOrc:19528, p18x:3024.89},
    {n:17, invs:1, g:1360, kwp:10.2, descMax:20688, pVista:20688, pOrc:20688, p18x:3204.57},
    {n:18, invs:1, g:1440, kwp:10.8, descMax:21588, pVista:21588, pOrc:21588, p18x:3343.98},
    {n:19, invs:1, g:1520, kwp:11.4, descMax:22653, pVista:22653, pOrc:22653, p18x:3508.95},
    {n:20, invs:1, g:1600, kwp:12.0, descMax:22998, pVista:22998, pOrc:22998, p18x:3562.45}
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
  inv: "SAJ 7,5K", mod: "Tsun 600W", pot: 600,
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
