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
  inv: "Tsunnes 2,25K", mod: "Era 700W", pot: 700,
  rows: [
    {n:3,  invs:1, g:291,  kwp:2.1,  descMax:6739.20,  pVista:7050,  pOrc:7402.50,  p18x:466.08},
    {n:4,  invs:1, g:388,  kwp:2.8,  descMax:7718.10,  pVista:8050,  pOrc:8452.50,  p18x:532.19},
    {n:5,  invs:2, g:485,  kwp:3.5,  descMax:11004.50, pVista:11450, pOrc:12022.50, p18x:756.96},
    {n:6,  invs:2, g:582,  kwp:4.2,  descMax:11983.40, pVista:12500, pOrc:13125.00, p18x:826.38},
    {n:7,  invs:2, g:679,  kwp:4.9,  descMax:12962.30, pVista:13500, pOrc:14175.00, p18x:892.49},
    {n:8,  invs:2, g:776,  kwp:5.6,  descMax:13941.20, pVista:14500, pOrc:15225.00, p18x:958.60},
    {n:9,  invs:3, g:873,  kwp:6.3,  descMax:17227.60, pVista:17950, pOrc:18847.50, p18x:1186.68},
    {n:10, invs:3, g:970,  kwp:7.0,  descMax:18205.20, pVista:18950, pOrc:19897.50, p18x:1252.79},
    {n:11, invs:3, g:1067, kwp:7.7,  descMax:19184.10, pVista:19950, pOrc:20947.50, p18x:1318.90},
    {n:12, invs:3, g:1164, kwp:8.4,  descMax:20164.30, pVista:20950, pOrc:21997.50, p18x:1385.01},
    {n:13, invs:4, g:1261, kwp:9.1,  descMax:23449.40, pVista:24400, pOrc:25620.00, p18x:1613.09},
    {n:14, invs:4, g:1358, kwp:9.8,  descMax:24428.30, pVista:25400, pOrc:26670.00, p18x:1679.20},
    {n:15, invs:4, g:1455, kwp:10.5, descMax:25407.20, pVista:26400, pOrc:27720.00, p18x:1745.31},
    {n:16, invs:4, g:1552, kwp:11.2, descMax:26387.40, pVista:27450, pOrc:28822.50, p18x:1814.72},
    {n:17, invs:5, g:1649, kwp:11.9, descMax:29672.50, pVista:30850, pOrc:32392.50, p18x:2039.50},
    {n:18, invs:5, g:1746, kwp:12.6, descMax:30651.40, pVista:31850, pOrc:33442.50, p18x:2105.61},
    {n:19, invs:5, g:1843, kwp:13.3, descMax:31630.30, pVista:32900, pOrc:34545.00, p18x:2175.02},
    {n:20, invs:5, g:1940, kwp:14.0, descMax:32610.50, pVista:33900, pOrc:35595.00, p18x:2241.13},
    {n:21, invs:6, g:2037, kwp:14.7, descMax:35824.69, pVista:37250, pOrc:39112.50, p18x:2462.60},
    {n:22, invs:6, g:2134, kwp:15.4, descMax:36832.68, pVista:38300, pOrc:40215.00, p18x:2532.02},
    {n:23, invs:6, g:2231, kwp:16.1, descMax:37840.67, pVista:39350, pOrc:41317.50, p18x:2601.43},
    {n:24, invs:6, g:2328, kwp:16.8, descMax:38849.96, pVista:40400, pOrc:42420.00, p18x:2670.85},
    {n:25, invs:7, g:2425, kwp:17.5, descMax:42035.45, pVista:43700, pOrc:45885.00, p18x:2889.01},
    {n:26, invs:7, g:2522, kwp:18.2, descMax:43042.15, pVista:44750, pOrc:46987.50, p18x:2958.43},
    {n:27, invs:7, g:2619, kwp:18.9, descMax:44050.14, pVista:45800, pOrc:48090.00, p18x:3027.84},
    {n:28, invs:7, g:2716, kwp:19.6, descMax:45059.43, pVista:46850, pOrc:49192.50, p18x:3097.26},
    {n:29, invs:8, g:2813, kwp:20.3, descMax:48243.62, pVista:50150, pOrc:52657.50, p18x:3315.42},
    {n:30, invs:8, g:2910, kwp:21.0, descMax:49252.91, pVista:51200, pOrc:53760.00, p18x:3384.84},
    {n:31, invs:8, g:3007, kwp:21.7, descMax:50259.60, pVista:52250, pOrc:54862.50, p18x:3454.25},
    {n:32, invs:8, g:3104, kwp:22.4, descMax:51268.89, pVista:53300, pOrc:55965.00, p18x:3523.67}
  ]
},

"SOLAX-1.875K-ERA620W": {
  inv: "SOLAX 1,875K", mod: "Era 620W", pot: 620,
  rows: [
    {n:3,  invs:1, g:255,  kwp:1.86,  descMax:6444.88,  pVista:6750,  pOrc:7087.50,  p18x:446.24},
    {n:4,  invs:1, g:340,  kwp:2.48,  descMax:7325.24,  pVista:7650,  pOrc:8032.50,  p18x:505.74},
    {n:5,  invs:2, g:425,  kwp:3.10,  descMax:10514.40, pVista:10950, pOrc:11497.50, p18x:723.91},
    {n:6,  invs:2, g:510,  kwp:3.72,  descMax:11394.76, pVista:11850, pOrc:12442.50, p18x:783.40},
    {n:7,  invs:2, g:595,  kwp:4.34,  descMax:12275.12, pVista:12800, pOrc:13440.00, p18x:846.21},
    {n:8,  invs:2, g:680,  kwp:4.96,  descMax:13155.48, pVista:13700, pOrc:14385.00, p18x:905.71},
    {n:9,  invs:3, g:765,  kwp:5.58,  descMax:16344.64, pVista:17000, pOrc:17850.00, p18x:1123.87},
    {n:10, invs:3, g:850,  kwp:6.20,  descMax:17225.00, pVista:17900, pOrc:18795.00, p18x:1183.37},
    {n:11, invs:3, g:935,  kwp:6.82,  descMax:18105.36, pVista:18850, pOrc:19792.50, p18x:1246.18},
    {n:12, invs:3, g:1020, kwp:7.44,  descMax:18985.72, pVista:19750, pOrc:20737.50, p18x:1305.67},
    {n:13, invs:4, g:1105, kwp:8.06,  descMax:22174.88, pVista:23050, pOrc:24202.50, p18x:1523.84},
    {n:14, invs:4, g:1190, kwp:8.68,  descMax:23055.24, pVista:24000, pOrc:25200.00, p18x:1586.64},
    {n:15, invs:4, g:1275, kwp:9.30,  descMax:23935.60, pVista:24900, pOrc:26145.00, p18x:1646.14},
    {n:16, invs:4, g:1360, kwp:9.92,  descMax:24815.96, pVista:25800, pOrc:27090.00, p18x:1705.64},
    {n:17, invs:5, g:1445, kwp:10.54, descMax:28005.12, pVista:29100, pOrc:30555.00, p18x:1923.80},
    {n:18, invs:5, g:1530, kwp:11.16, descMax:28885.48, pVista:30050, pOrc:31552.50, p18x:1986.61},
    {n:19, invs:5, g:1615, kwp:11.78, descMax:29765.84, pVista:30950, pOrc:32497.50, p18x:2046.11},
    {n:20, invs:5, g:1700, kwp:12.40, descMax:30646.20, pVista:31850, pOrc:33442.50, p18x:2105.61},
    {n:21, invs:6, g:1785, kwp:13.02, descMax:33771.54, pVista:35100, pOrc:36855.00, p18x:2320.46},
    {n:22, invs:6, g:1870, kwp:13.64, descMax:34682.63, pVista:36050, pOrc:37852.50, p18x:2383.27},
    {n:23, invs:6, g:1955, kwp:14.26, descMax:35593.72, pVista:37000, pOrc:38850.00, p18x:2446.07},
    {n:24, invs:6, g:2040, kwp:14.88, descMax:36504.80, pVista:37950, pOrc:39847.50, p18x:2508.88},
    {n:25, invs:7, g:2125, kwp:15.50, descMax:39594.69, pVista:41150, pOrc:43207.50, p18x:2720.43},
    {n:26, invs:7, g:2210, kwp:16.12, descMax:40505.78, pVista:42100, pOrc:44205.00, p18x:2783.24},
    {n:27, invs:7, g:2295, kwp:16.74, descMax:41416.87, pVista:43050, pOrc:45202.50, p18x:2846.04},
    {n:28, invs:7, g:2380, kwp:17.36, descMax:42327.95, pVista:44000, pOrc:46200.00, p18x:2908.84},
    {n:29, invs:8, g:2465, kwp:17.98, descMax:45417.84, pVista:47200, pOrc:49560.00, p18x:3120.40},
    {n:30, invs:8, g:2550, kwp:18.60, descMax:46328.93, pVista:48150, pOrc:50557.50, p18x:3183.20},
    {n:31, invs:8, g:2635, kwp:19.22, descMax:47240.01, pVista:49100, pOrc:51555.00, p18x:3246.01},
    {n:32, invs:8, g:2720, kwp:19.84, descMax:48151.10, pVista:50050, pOrc:52552.50, p18x:3308.81}
  ]
}

};
