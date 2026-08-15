// ─────────────────────────────────────────────────────────────────────────────
// "Venda pro Bruno de 7.700 em 18x, quero receber tudo" → plano de cobrança.
//
// Mesma divisão de trabalho da Prospecção: a IA LÊ o português e preenche o
// formulário; o CÓDIGO decide o que é válido e a MATEMÁTICA é feita nas taxas
// reais da conta. O modelo nunca calcula dinheiro — ele só entende o pedido.
// Se um dia ele alucinar "R$ 7,70", o número aparece gigante na tela antes de
// virar cobrança, e nada é criado sem o humano clicar de novo.
//
// A pegadinha que o prompt precisa cobrir: em português "7.700" é sete mil e
// setecentos. Modelo treinado em inglês lê isso como 7,7 — e a venda inteira
// vira setecentos centavos.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { Plano, Meio } from './asaasCobrancas';
import { logger } from '../../utils/logger';

const LOG = 'cobranca-brief';
const MODELO = 'claude-sonnet-4-6';    // mesmo modelo do resto da casa
const TETO_VALOR = 500_000;            // acima disso é erro de digitação, não venda

const SISTEMA = `Você lê o pedido de cobrança de um vendedor brasileiro e devolve os campos
preenchidos. Você NÃO faz conta de taxa, juros ou parcela — isso é feito depois, com as taxas
reais da conta. Seu trabalho é entender o português.

NÚMEROS EM PORTUGUÊS (a regra mais importante):
- "7.700" é sete mil e setecentos → 7700. O ponto é separador de MILHAR.
- "7.700,50" → 7700.50. A vírgula é o separador decimal.
- "7,7 mil" → 7700. "12 mil" → 12000. "1,5k" → 1500.
- Sempre devolva o valor como número simples, sem símbolo e sem separador de milhar.

CAMPOS:
- cliente_nome: o nome de quem vai pagar. Se o pedido não disser, use "Cliente".
- cliente_cpf: CPF ou CNPJ só se aparecer no texto. Senão null.
- cliente_telefone: só se aparecer. Senão null.
- cliente_email: só se aparecer. Senão null.
- descricao: o que está sendo vendido, curto e reconhecível pelo cliente na fatura.
  Ex: "Entrada do eletroposto — Bruno Henrique". Nunca escreva o valor aqui.
- meio: "link" | "pix" | "boleto" | "cartao".
  * "link" é o PADRÃO e o mais seguro: uma página onde o cliente escolhe Pix, boleto ou cartão,
    e onde ELE preenche os próprios dados. Use quando o pedido não cravar a forma de pagamento,
    e SEMPRE que não houver CPF no texto.
  * "cartao" só quando o pedido cravar cartão E houver CPF/CNPJ no texto.
  * "pix" e "boleto" idem: só com forma cravada e CPF no texto.
- parcelas: número de vezes. 1 quando for à vista ou quando não disser. Máximo 21.
- valor_modo: "liquido" ou "cheio".
  * "liquido" quando o vendedor fala do que QUER RECEBER / QUER QUE SOBRE / "receber limpo",
    "receber os X", "cair na conta X", "repassar a taxa pro cliente".
  * "cheio" quando ele fala do PREÇO que o cliente paga: "cobrar X", "vender por X", "a venda é X".
  * Na dúvida entre os dois, escolha "liquido" — é o que o vendedor quase sempre quer dizer.
- valor: o número correspondente ao valor_modo.
- vencimento_dias: em quantos dias o link/boleto expira. Padrão 3. Se falar "hoje", use 1.
- antecipar: true quando o vendedor quiser o dinheiro ANTES do prazo normal do cartão
  ("receber no outro dia", "receber à vista", "não posso esperar", "preciso do dinheiro agora").
  Se o meio não for cartão nem link, use false. Se não falar nada e for parcelado, use true.
- explicacao: uma frase dizendo o que você entendeu do pedido.
- avisos: 0 a 3 avisos curtos em português sobre o que pode dar errado NESTE pedido
  (ex: falta o CPF, o cliente vai precisar de limite alto). Não repita regra de taxa.

Responda SOMENTE com JSON, sem texto em volta:
{"cliente_nome":"...","cliente_cpf":null,"cliente_telefone":null,"cliente_email":null,
 "descricao":"...","meio":"link","parcelas":1,"valor_modo":"liquido","valor":0,
 "vencimento_dias":3,"antecipar":false,"explicacao":"...","avisos":["..."]}`;

function extrairJson(texto: string): Record<string, unknown> {
  const t = texto.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* segue */ }
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i >= 0 && f > i) return JSON.parse(t.slice(i, f + 1));
  throw new Error('a IA não devolveu JSON');
}

const MEIOS: Meio[] = ['link', 'pix', 'boleto', 'cartao'];
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export async function montarPlanoCobranca(texto: string): Promise<Plano> {
  const pedido = String(texto || '').trim();
  if (pedido.length < 6) throw new Error('escreva a venda com um pouco mais de detalhe');
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor — preencha os campos na mão');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 900,
    system: SISTEMA,
    messages: [{ role: 'user', content: pedido.slice(0, 2000) }],
  });
  const bloco = resp.content[0];
  const bruto = extrairJson(bloco && bloco.type === 'text' ? bloco.text : '');

  // ── daqui pra baixo quem manda é o código ───────────────────────────────────
  const valor = Number(bruto.valor);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('não achei o valor da venda no texto');
  if (valor > TETO_VALOR) throw new Error(`R$ ${valor} parece erro de digitação — confira o valor`);

  const parcelas = Math.max(1, Math.min(21, Math.round(Number(bruto.parcelas) || 1)));
  const doc = soDigitos(bruto.cliente_cpf);
  const docValido = doc.length === 11 || doc.length === 14;

  let meio = MEIOS.includes(bruto.meio as Meio) ? (bruto.meio as Meio) : 'link';
  const avisos: string[] = Array.isArray(bruto.avisos)
    ? (bruto.avisos as unknown[]).map((a) => String(a)).slice(0, 3) : [];

  // Cobrança avulsa exige cliente cadastrado, e cliente exige CPF/CNPJ. Sem
  // documento no texto, o link é a única forma que funciona — e funciona
  // melhor: é o comprador que preenche os dados dele.
  if (meio !== 'link' && !docValido) {
    meio = 'link';
    avisos.unshift('Sem CPF no pedido eu montei um LINK: o próprio cliente preenche os dados dele na página.');
  }

  const cartao = meio === 'cartao' || meio === 'link';
  const antecipar = cartao ? bruto.antecipar !== false : false;

  const plano: Plano = {
    cliente: {
      nome: String(bruto.cliente_nome || 'Cliente').slice(0, 100),
      cpfCnpj: docValido ? doc : null,
      email: String(bruto.cliente_email || '').trim().toLowerCase() || null,
      telefone: soDigitos(bruto.cliente_telefone) || null,
    },
    descricao: String(bruto.descricao || 'Cobrança').slice(0, 200),
    meio,
    parcelas,
    valorModo: bruto.valor_modo === 'cheio' ? 'cheio' : 'liquido',
    valor: Math.round(valor * 100) / 100,
    vencimentoDias: Math.max(1, Math.min(30, Math.round(Number(bruto.vencimento_dias) || 3))),
    antecipar,
    avisos,
    explicacao: String(bruto.explicacao || '').slice(0, 300),
  };

  logger.info(LOG, 'plano montado', { meio, parcelas, modo: plano.valorModo, valor: plano.valor });
  return plano;
}

/** Normaliza o plano que volta EDITADO da tela — o humano pode ter mudado tudo. */
export function sanearPlano(entrada: unknown): Plano {
  const p = (entrada ?? {}) as Record<string, unknown>;
  const c = (p.cliente ?? {}) as Record<string, unknown>;
  const valor = Number(p.valor);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('valor inválido');
  if (valor > TETO_VALOR) throw new Error('valor acima do teto de segurança');

  const doc = soDigitos(c.cpfCnpj);
  const docValido = doc.length === 11 || doc.length === 14;
  let meio = MEIOS.includes(p.meio as Meio) ? (p.meio as Meio) : 'link';
  if (meio !== 'link' && !docValido) meio = 'link';

  return {
    cliente: {
      nome: String(c.nome || 'Cliente').slice(0, 100),
      cpfCnpj: docValido ? doc : null,
      email: String(c.email || '').trim().toLowerCase() || null,
      telefone: soDigitos(c.telefone) || null,
    },
    descricao: String(p.descricao || 'Cobrança').slice(0, 200),
    meio,
    parcelas: Math.max(1, Math.min(21, Math.round(Number(p.parcelas) || 1))),
    valorModo: p.valorModo === 'cheio' ? 'cheio' : 'liquido',
    valor: Math.round(valor * 100) / 100,
    vencimentoDias: Math.max(1, Math.min(30, Math.round(Number(p.vencimentoDias) || 3))),
    antecipar: (meio === 'cartao' || meio === 'link') && p.antecipar !== false,
    avisos: [],
    explicacao: '',
  };
}
