// Exporta as paginas de uma aula como JSON puro, com o SVG comprimido.
// Serve pra carga no banco sem transcricao manual (ver LEIA-ME desta pasta).
process.argv.push('--sql');
const log = console.log; console.log = () => {};
const { PAGINAS } = require('../' + process.argv[2]);
console.log = log;
const enxuto = PAGINAS.map(p => p.svg
  ? { ...p, svg: p.svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim() }
  : p);
process.stdout.write(JSON.stringify(enxuto));
