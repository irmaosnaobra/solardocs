/**
 * LINK DE COBRANÇA NA MARRA — o app de Cobranças sem depender da Vercel.
 *
 * Existe porque em 17/08/2026 o /gerador/cobrancas estava respondendo 503 em
 * produção (`COBRANCA_TOKEN` nunca entrou na Vercel) e havia uma venda de
 * R$7.700 pra cobrar no mesmo dia. Ligar a variável exige deploy e espera; este
 * script fala com o Asaas direto do computador, usando EXATAMENTE o mesmo
 * cálculo e a mesma função de criação que a tela usaria — nada é recalculado
 * aqui, senão o link sairia com um número e a tela mostraria outro.
 *
 * Ele também responde a pergunta que decide a venda parcelada: QUANTO DÁ PRA
 * ANTECIPAR HOJE. O custo da antecipação já vai embutido no preço; se a conta
 * não tiver limite liberado, esse dinheiro foi cobrado por um serviço que não
 * vai acontecer, e o dono precisa saber ANTES de mandar o link.
 *
 * Rodar (prévia, não cria nada):
 *   cd api && npx ts-node --transpile-only scripts/link-cobranca.ts --valor 7700 --parcelas 4 --modo cheio
 *
 * Criar de verdade: repetir com --criar
 *
 * Exige no api/.env:
 *   ASAAS_API_KEY  — a chave de PRODUÇÃO (a mesma que está na Vercel)
 *   ASAAS_ENV=prod — sem isto a cobrança nasce em sandbox e ninguém paga nada
 *   SUPABASE_URL + SUPABASE_SERVICE_KEY — pra cobrança aparecer na lista do app
 */

import 'dotenv/config';
import { asaasFetch, asaasApiKey } from '../src/services/asaas/asaasClient';
import { buscarTaxas, ambienteAsaas, pctCartao } from '../src/services/asaas/asaasTaxas';
import { calcularPrevia, criarCobranca } from '../src/services/asaas/asaasCobrancas';
import { sanearPlano } from '../src/services/asaas/cobrancaBrief';

const dinheiro = (n: number) =>
  `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function flag(nome: string, padrao?: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const v = process.argv[i + 1];
  return !v || v.startsWith('--') ? 'true' : v;
}
const tem = (nome: string) => process.argv.includes(`--${nome}`);

/**
 * Limite de antecipação disponível na conta. Trata o endpoint como opinião, não
 * como contrato: se o Asaas mudar o formato, o script imprime o cru e segue —
 * uma venda não pode travar porque um campo informativo mudou de nome.
 */
async function limiteDeAntecipacao(): Promise<void> {
  console.log('\n── LIMITE DE ANTECIPAÇÃO ────────────────────────────────');
  try {
    const r = await asaasFetch<Record<string, any>>('/anticipations/limits');
    const faixas = ['creditCard', 'automatic', 'bankSlip'] as const;
    let achou = false;
    for (const f of faixas) {
      const v = r?.[f];
      if (v && typeof v === 'object' && ('available' in v || 'total' in v)) {
        achou = true;
        console.log(`  ${f.padEnd(12)} disponível ${dinheiro(Number(v.available ?? 0))} de ${dinheiro(Number(v.total ?? 0))}`);
      }
    }
    if (!achou) console.log('  (formato não reconhecido) ' + JSON.stringify(r));
  } catch (err: any) {
    console.log(`  ⚠️  não deu pra consultar: ${err?.message || err}`);
    console.log('     Antecipação costuma estar bloqueada em conta nova ou sem análise de crédito.');
    console.log('     Se ela não estiver liberada, o dinheiro do parcelado cai no prazo normal:');
    console.log('     ~32 dias depois de CADA parcela.');
  }
}

async function main(): Promise<void> {
  if (!asaasApiKey()) {
    console.error('\n❌ ASAAS_API_KEY vazia no api/.env. Copie a chave de produção da Vercel.\n');
    process.exit(1);
  }

  const ambiente = ambienteAsaas();
  console.log('\n════════════════════════════════════════════════════════');
  console.log(`  AMBIENTE: ${ambiente.toUpperCase()}${ambiente === 'sandbox' ? '  ⚠️  NADA AQUI É REAL' : '  💳 dinheiro de verdade'}`);
  console.log('════════════════════════════════════════════════════════');

  const plano = sanearPlano({
    cliente: {
      nome: flag('nome', 'Cliente'),
      cpfCnpj: flag('cpf', ''),
      email: flag('email', ''),
      telefone: flag('telefone', ''),
    },
    descricao: flag('desc', 'Cobrança'),
    // 'link' = o cliente escolhe como pagar (inclusive Pix à vista, que cai na
    // hora e inteiro). Só vira cobrança fechada de cartão quando há CPF.
    meio: flag('meio', 'link'),
    parcelas: Number(flag('parcelas', '1')),
    valorModo: flag('modo', 'liquido'),
    valor: Number(flag('valor', '0')),
    vencimentoDias: Number(flag('venc', '3')),
    antecipar: !tem('sem-antecipar'),
  });

  const taxas = await buscarTaxas();
  const previa = await calcularPrevia(plano, taxas);

  console.log('\n── TAXAS REAIS DA CONTA ─────────────────────────────────');
  console.log(`  cartão ${plano.parcelas}x: ${pctCartao(taxas, previa.parcelas)}% + ${dinheiro(taxas.cartaoFixo)}` +
    `${taxas.promoAtiva ? `  (promo ativa${taxas.promoVence ? `, vence ${taxas.promoVence}` : ''})` : ''}`);
  console.log(`  antecipação parcelada: ${taxas.antecipParceladoMes}% a.m. | à vista: ${taxas.antecipAvistaMes}% a.m.`);
  console.log(`  sem antecipar, cartão cai em ${taxas.cartaoDias} dias por parcela`);

  if (previa.antecipar) await limiteDeAntecipacao();

  console.log('\n── A COBRANÇA ───────────────────────────────────────────');
  console.log(`  ${plano.descricao}`);
  console.log(`  ${previa.parcelas}x de ${dinheiro(previa.parcela)}  =  ${dinheiro(previa.bruto)} pro cliente`);
  console.log(`  taxa Asaas        − ${dinheiro(previa.taxaAsaas)}`);
  if (previa.antecipar) console.log(`  antecipação       − ${dinheiro(previa.custoAntecipacao)}`);
  console.log(`  CAI NA CONTA        ${dinheiro(previa.liquido)}  (${previa.quandoCai})`);
  if (previa.seFossePix) {
    console.log(`  se ele pagar no Pix: ${dinheiro(previa.seFossePix.liquido)} ${previa.seFossePix.quandoCai}`);
  }
  previa.avisos.forEach((a) => console.log(`\n  ⚠️  ${a}`));

  if (!tem('criar')) {
    console.log('\n────────────────────────────────────────────────────────');
    console.log('  PRÉVIA — nada foi criado. Repita o comando com --criar');
    console.log('────────────────────────────────────────────────────────\n');
    return;
  }

  console.log('\n── CRIANDO NO ASAAS ─────────────────────────────────────');
  const criada = await criarCobranca(plano);

  console.log(`\n  ✅ ${criada.tipo} ${criada.id}  (${criada.ambiente})`);
  console.log(`  ${criada.parcelas}x de ${dinheiro(criada.parcela)} = ${dinheiro(criada.bruto)}`);
  console.log(`  líquido ${dinheiro(criada.liquido)} — ${criada.conferencia === 'exata' ? 'CONFERIDO no Asaas' : 'estimado pela nossa conta'}` +
    `${criada.ajustes ? ` (${criada.ajustes} ajuste(s) de valor)` : ''}`);
  if (criada.conferenciaFalhou) {
    console.log(`\n  🚨 A ANTECIPAÇÃO NÃO PÔDE SER CONFERIDA: ${criada.conferenciaFalhou}`);
    console.log('     O preço já embute o custo dela. Confirme o limite no painel do Asaas');
    console.log('     ANTES de mandar o link — senão você cobrou por um saque que não sai.');
  }
  console.log(`\n  LINK:  ${criada.url}\n`);
  console.log('  Depois que ele pagar, peça a antecipação (botão Antecipar no app, ou o painel do Asaas).');
  console.log('  Ela NÃO sai sozinha.\n');
}

main().catch((err) => {
  console.error('\n❌', err?.message || err, '\n');
  process.exit(1);
});
