// ─────────────────────────────────────────────────────────────────────────────
// CUPONS DE PRIMEIRO MÊS — o Thiago manda um link e um código, o cliente se
// vira sozinho. Um cupom responde uma pergunta só: quanto se paga no 1º mês.
// Da segunda cobrança em diante é o preço cheio, nos dois trilhos:
//   · cartão → desconto `duration: once` na Stripe (67 − 48 = 19 na 1ª fatura)
//   · Pix    → primeira cobrança separada da mensalidade
//
// A fonte da verdade é a tabela `cupons` no Supabase: dá pra criar, limitar e
// desligar cupom sem deploy. Na Stripe o cupom é só um espelho, criado sob
// demanda com id determinístico.
// ─────────────────────────────────────────────────────────────────────────────

import { Stripe } from 'stripe';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';

export interface Cupom {
  codigo: string;
  descricao: string | null;
  primeiro_mes_valor: number;
  planos: string[];
  validade: string | null;
  usos_max: number | null;
  usos: number;
  ativo: boolean;
}

export interface CupomAplicado {
  cupom: Cupom;
  primeiroMes: number;   // o que o cliente paga agora
  precoCheio: number;    // o que ele paga do 2º mês em diante
  descontoCentavos: number;
}

const COLS = 'codigo, descricao, primeiro_mes_valor, planos, validade, usos_max, usos, ativo';

// Só A-Z, 0-9 e hífen: é o charset que a Stripe aceita num promotion code (o
// texto que o cliente digita no checkout). Underscore entraria no banco e seria
// recusado lá na hora de criar o código — melhor não deixar existir.
export function normalizarCodigo(codigo: string | null | undefined): string {
  return (codigo || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
}

// Devolve o cupom só se ele valer AGORA e PRA ESTE PLANO. Qualquer motivo de
// recusa vira null — quem chama simplesmente cobra o preço cheio.
export async function buscarCupomValido(codigoRaw: string | null | undefined, planoKey: string): Promise<Cupom | null> {
  const codigo = normalizarCodigo(codigoRaw);
  if (!codigo) return null;

  const { data, error } = await supabase.from('cupons').select(COLS).eq('codigo', codigo).maybeSingle();
  if (error || !data) return null;

  const c = data as Cupom;
  if (!c.ativo) return null;
  if (c.validade && new Date(c.validade).getTime() < Date.now()) return null;
  if (c.usos_max !== null && c.usos >= c.usos_max) return null;
  // `planos` guarda o nome do plano ('pro' | 'ilimitado'), que é o que o
  // PLAN_MAP chama de `plano` — não a chave da oferta (vip_promo, por exemplo).
  if (!c.planos?.includes(planoKey)) return null;

  return c;
}

// Calcula o desconto para um plano. Cupom que não desconta nada (ou que sairia
// negativo) é tratado como inexistente: melhor cobrar o preço cheio do que
// gerar uma fatura de R$ 0 e dar um mês grátis por engano.
export function aplicarCupom(cupom: Cupom | null, precoCheio: number): CupomAplicado | null {
  if (!cupom) return null;
  const primeiroMes = Number(cupom.primeiro_mes_valor);
  if (!(primeiroMes >= 0) || primeiroMes >= precoCheio) return null;
  return {
    cupom,
    primeiroMes,
    precoCheio,
    descontoCentavos: Math.round((precoCheio - primeiroMes) * 100),
  };
}

// Espelha o cupom na Stripe. O id carrega o desconto em centavos: mudar o valor
// do cupom no banco cria um cupom NOVO na Stripe em vez de reaproveitar em
// silêncio um antigo com o desconto velho.
// Memória por instância: o cupom e o promotion code não mudam entre checkouts,
// e sem isto cada compra pagaria 2 chamadas extras à Stripe. Cold start refaz.
const jaGarantido = new Set<string>();

export async function garantirCupomStripe(
  stripe: Stripe, aplicado: CupomAplicado, plano: string,
): Promise<string> {
  const id = `SD-${aplicado.cupom.codigo}-${plano}-${aplicado.descontoCentavos}`.toUpperCase().slice(0, 60);
  if (jaGarantido.has(id)) return id;
  try {
    await stripe.coupons.retrieve(id);
    jaGarantido.add(id);
    return id;
  } catch {
    // Não existe ainda (ou não deu pra ler) — cria. Se a criação falhar por já
    // existir (corrida entre duas instâncias), o retrieve do catch resolve.
    try {
      await stripe.coupons.create({
        id,
        amount_off: aplicado.descontoCentavos,
        currency: 'brl',
        duration: 'once',
        name: `${aplicado.cupom.codigo} — 1º mês R$ ${aplicado.primeiroMes}`,
      });
      logger.info('cupons', `cupom criado na Stripe: ${id}`);
      jaGarantido.add(id);
      return id;
    } catch (err) {
      await stripe.coupons.retrieve(id); // se estourar aqui, o chamador cai no preço cheio
      return id;
    }
  }
}

// ── CUPOM DIGITADO NO CHECKOUT ───────────────────────────────────────────────
// O caminho do link aplica o desconto sozinho. Este é o outro caminho: o cliente
// entra em solardoc.app, clica em assinar e DIGITA o código. Pra isso existir, a
// Stripe precisa de um `promotion_code` (o objeto que aceita texto digitado)
// apontando pro cupom, e o checkout precisa de `allow_promotion_codes: true`.
//
// Cuidado que vale dinheiro: no caminho digitado a nossa validação NÃO roda —
// quem decide é a Stripe. Por isso os limites do banco (validade, usos_max) são
// espelhados no promotion_code, e o `allow_promotion_codes` só é ligado no plano
// que tem cupom vivo (senão um código de R$ 48 de desconto poderia cair num
// plano de R$ 27 e zerar a fatura).

// Existe cupom vivo pra este plano? Uma consulta, usada pra decidir se o campo
// "adicionar código promocional" aparece no checkout.
export async function cupomAtivoParaPlano(plano: string): Promise<Cupom | null> {
  const { data } = await supabase
    .from('cupons').select(COLS)
    .eq('ativo', true)
    .contains('planos', [plano])
    .order('primeiro_mes_valor', { ascending: true });

  const agora = Date.now();
  const vivos = ((data as Cupom[] | null) ?? []).filter(c =>
    (!c.validade || new Date(c.validade).getTime() > agora) &&
    (c.usos_max === null || c.usos < c.usos_max),
  );
  return vivos[0] ?? null;
}

// Cria (ou reaproveita) o promotion_code com o texto que o cliente digita.
// Idempotente: a Stripe recusa código repetido ativo, então buscamos antes.
export async function garantirPromotionCode(
  stripe: Stripe, aplicado: CupomAplicado, couponId: string,
): Promise<string | null> {
  const code = aplicado.cupom.codigo;
  const memo = `promo:${code}:${couponId}`;
  if (jaGarantido.has(memo)) return code;

  // Na v22 do SDK o cupom vive dentro de `promotion` (antes era um campo solto).
  const cupomDo = (p: { promotion?: { coupon?: string | { id?: string } | null } }): string | undefined => {
    const c = p.promotion?.coupon;
    return typeof c === 'string' ? c : c?.id;
  };

  try {
    const existentes = await stripe.promotionCodes.list({ code, limit: 10 });
    const vivo = existentes.data.find(p => p.active && cupomDo(p) === couponId);
    if (vivo) { jaGarantido.add(memo); return vivo.code; }

    // Código com o mesmo texto apontando pro cupom ERRADO (valor antigo) precisa
    // sair de cena — senão o cliente digita e ganha o desconto velho.
    for (const p of existentes.data) {
      if (p.active && cupomDo(p) !== couponId) {
        await stripe.promotionCodes.update(p.id, { active: false });
        logger.info('cupons', `promotion code ${code} desativado (apontava pro cupom ${cupomDo(p)})`);
      }
    }

    const criado = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: couponId },
      code,
      // Espelha os limites do banco: no caminho digitado é a Stripe quem barra.
      ...(aplicado.cupom.usos_max ? { max_redemptions: aplicado.cupom.usos_max } : {}),
      ...(aplicado.cupom.validade ? { expires_at: Math.floor(new Date(aplicado.cupom.validade).getTime() / 1000) } : {}),
      // Trava de valor: só aplica em compra que custa pelo menos o preço cheio
      // do plano deste cupom.
      restrictions: {
        minimum_amount: Math.round(aplicado.precoCheio * 100),
        minimum_amount_currency: 'brl',
      },
    });
    logger.info('cupons', `promotion code criado: ${code} → ${couponId}`);
    jaGarantido.add(memo);
    return criado.code;
  } catch (err) {
    // Sem promotion code o cliente que DIGITAR o código vai ouvir "inválido".
    // Não derruba o checkout (o link com ?cupom= segue funcionando), mas grita.
    logger.error('cupons', `não consegui garantir o promotion code ${code} — digitar o cupom vai falhar`, err);
    return null;
  }
}

// Registra o uso DEPOIS do pagamento confirmado (webhook), nunca na criação do
// checkout — sessão abandonada não pode queimar um cupom limitado.
export async function registrarUsoCupom(args: {
  codigo: string; email: string | null; origem: 'stripe' | 'pix'; referencia: string; valor: number | null;
}): Promise<void> {
  const codigo = normalizarCodigo(args.codigo);
  if (!codigo || !args.referencia) return;
  try {
    const { data, error } = await supabase.rpc('registrar_uso_cupom', {
      p_codigo: codigo,
      p_email: args.email,
      p_origem: args.origem,
      p_referencia: args.referencia,
      p_valor: args.valor,
    });
    if (error) throw error;
    if (data === 'repetido') return; // reentrega de webhook — já contabilizado
    logger.info('cupons', `cupom ${codigo} usado por ${args.email ?? 'sem email'} (${args.origem})`);
  } catch (err) {
    // Contagem é relatório, não é o pagamento: falhar aqui não pode derrubar a
    // liberação de acesso de quem já pagou.
    logger.error('cupons', `não consegui registrar o uso do cupom ${codigo}`, err);
  }
}

// Consulta pública (a tela /assinar usa) — devolve só o que dá pra mostrar.
// `precoCheio` volta SEMPRE, mesmo com cupom inválido: é o preço que a tela
// exibe nesse caso, e ela não pode ter um valor chutado no código.
export async function resumoPublicoCupom(codigoRaw: string, planoKey: string, precoCheio: number) {
  const cupom = await buscarCupomValido(codigoRaw, planoKey);
  const aplicado = aplicarCupom(cupom, precoCheio);
  if (!aplicado) return { valido: false as const, precoCheio };
  return {
    valido: true as const,
    codigo: aplicado.cupom.codigo,
    descricao: aplicado.cupom.descricao,
    primeiroMes: aplicado.primeiroMes,
    precoCheio: aplicado.precoCheio,
  };
}
