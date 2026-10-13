// Gera dashboard/public/gerador/ui/io2-acabamento.css a partir de gerador-io2-acabamento.src.css.
// Na fonte, § vira o prefixo do app, §L o da tela de login e §S o dos subapps (sem data-mode). A folha publicada e GERADA: edite a fonte e rode
//   node dashboard/scripts/gerador-io2-acabamento.mjs
import fs from 'node:fs';

const fonte = fs.readFileSync(new URL('./gerador-io2-acabamento.src.css', import.meta.url), 'utf8');
const APP = 'html.io2[data-mode="app"]:not(#_):not(#_):not(#_):not(#_):not(#_)';
const SUBAPP = 'html.io2:not(#_):not(#_):not(#_):not(#_):not(#_)';
const LOGIN = 'html.io2[data-mode="login"]:not(#_):not(#_):not(#_):not(#_):not(#_)';
const saida = fonte.replaceAll('§L', LOGIN).replaceAll('§S', SUBAPP).replaceAll('§', APP);
fs.writeFileSync(new URL('../public/gerador/ui/io2-acabamento.css', import.meta.url), saida);
console.log('ok', saida.length, 'caracteres');
