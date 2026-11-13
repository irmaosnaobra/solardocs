/**
 * CRIA OS PRECOS DOS ADICIONAIS MENSAIS NA STRIPE (produto + preco de cada um dos 6).
 *
 *   npx ts-node --transpile-only scripts/criar-precos-adicionais.ts            (so MOSTRA o que criaria)
 *   npx ts-node --transpile-only scripts/criar-precos-adicionais.ts --criar    (cria o que faltar)
 *
 * Idempotente: preco que ja existe pela lookup_key e pulado. Nada e apagado nem alterado.
 * Lookup keys: ad_offgrid_mensal, ad_inventario_mensal, ad_fechavendas_mensal, ad_limpapro_mensal (R$ 17),
 * ad_pacote_checkout_mensal (R$ 30) e ad_pacote_app_mensal (R$ 40). Todos em BRL, cobranca mensal.
 *
 * QUEM RODA: a sessao principal, na hora de ligar ADICIONAIS_MENSAIS (precisa de STRIPE_SECRET_KEY de PRODUCAO
 * no ambiente). Depois de criar, rode de novo sem --criar: tudo deve sair "ja-existe".
 */

import 'dotenv/config';
import Stripe from 'stripe';
import { garantirPrecosAdicionais } from '../src/services/produtos/adicionaisPrecos';

async function main(): Promise<void> {
  const chave = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!chave) throw new Error('STRIPE_SECRET_KEY nao definida');
  const criar = process.argv.includes('--criar');
  const stripe = new Stripe(chave);

  console.log(criar ? 'Modo: CRIAR o que faltar' : 'Modo: simulacao (use --criar para criar)');
  const resultado = await garantirPrecosAdicionais(stripe, { criar });
  for (const r of resultado) {
    console.log(`${r.situacao.padEnd(15)} ${r.lookupKey}${r.priceId ? ` -> ${r.priceId}` : ''}`);
  }
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
});
