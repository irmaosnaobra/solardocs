// Sonda manual: bate no portal do fornecedor e mostra o que volta.
// Uso: node scripts/probe.mjs           (deslogado)
//      SOOLLAR_EMAIL=... SOOLLAR_SENHA=... node scripts/probe.mjs
import { abrirSessao, urlsDasImagens } from '../src/lib/soollar.ts';
import fs from 'node:fs';

const { sessao, cd, secao } = await abrirSessao({
  cdSlug: process.env.SOOLLAR_CD ?? 'cduberlandiamg',
  secaoSlug: process.env.SOOLLAR_SECAO ?? 'ebike',
  email: process.env.SOOLLAR_EMAIL,
  senha: process.env.SOOLLAR_SENHA,
});

console.log('CD:', cd.name, cd.distributionCenterId);
console.log('Seção:', secao.name, secao.sectionId);
console.log('Logado:', sessao.logado);

const itens = await sessao.listarProdutos(cd.distributionCenterId, secao.sectionId);
console.log('Produtos:', itens.length);

const primeiro = itens[0];
console.log('\n--- primeiro item ---');
console.log(JSON.stringify(primeiro, null, 1).slice(0, 2000));
console.log('imagens:', urlsDasImagens(primeiro?.pathsImages));

console.log('\n--- amostra ---');
for (const p of itens.slice(0, 10)) {
  console.log(
    [p.ref, p.name.slice(0, 70), 'custo=' + p.value, 'estoque=' + p.availableQuantity].join(' | '),
  );
}

const detalhe = primeiro ? await sessao.produto(primeiro.id) : null;
console.log('\n--- ficha completa do primeiro ---');
console.log(JSON.stringify(detalhe, null, 1).slice(0, 3000));

fs.writeFileSync('scripts/.probe.json', JSON.stringify({ itens, detalhe }, null, 1), 'utf8');
console.log('\nsalvo em scripts/.probe.json');
