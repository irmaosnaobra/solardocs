// Gera o SQL de uma aula com o SVG comprimido (espaco entre tags colapsado).
// Nao muda o desenho: SVG ignora espaco em branco entre elementos.
//
// O --sql entra no argv ANTES do require de proposito: sem ele o modulo cai no
// ramo do puppeteer, renderiza a prova e imprime "N diagramas ->" no stdout —
// que ia grudar no fim do SQL e quebrar o comando. O console e silenciado
// durante o require pelo mesmo motivo.
process.argv.push('--sql');
const log = console.log; console.log = () => {};
const { PAGINAS } = require('./' + process.argv[2]);
console.log = log;

const ordem = parseInt(process.argv[3], 10);
const enxuto = PAGINAS.map(p => p.svg
  ? { ...p, svg: p.svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim() }
  : p);
const json = JSON.stringify(enxuto).replace(/'/g, "''");
process.stdout.write(
  `update public.pc_aulas set paginas='${json}'::jsonb,status='publicado' ` +
  `where ordem=${ordem} and curso_id=(select id from public.pc_cursos where slug='fundamentos');`
);
