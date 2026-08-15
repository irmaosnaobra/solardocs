// ─────────────────────────────────────────────────────────────────────────────
// COBRANÇAS DO GERADOR — "quero receber X" vira link pronto pra mandar.
//
// O problema que este arquivo resolve: quando a venda é parcelada, o valor que
// o cliente paga e o valor que cai na conta são DOIS números diferentes, e a
// distância entre eles cresce com o número de parcelas. Vender R$7.700 em 18x
// com antecipação deposita ~R$6,4 mil. Pra sobrar os R$7.700 é preciso cobrar
// ~R$9,6 mil — e ninguém acerta isso de cabeça no meio de uma conversa de
// WhatsApp.
//
// Então o app trabalha em cima do LÍQUIDO. O humano diz quanto quer receber; o
// código descobre quanto cobrar.
//
// Como o valor bruto é achado: por BISSEÇÃO em cima da função que calcula o
// líquido, não por fórmula invertida. Parece força bruta, e é de propósito — a
// taxa do Pix tem piso e teto, a do cartão tem parte fixa e parte percentual, e
// a antecipação incide depois do MDR. Cada uma dessas dobras é uma chance de
// errar o sinal numa álgebra invertida; a bisseção usa a MESMA função que a
// tela mostra, então prévia e cobrança nunca discordam.
//
// Regra que atravessa o arquivo: arredondamento sempre PRA CIMA no que o cliente
// paga. Um centavo a mais no bruto é invisível; um centavo a menos no líquido
// transforma "você recebe 7.700" em mentira.
// ─────────────────────────────────────────────────────────────────────────────

import { asaasFetch } from './asaasClient';
import { buscarTaxas, pctCartao, pctAntecipacaoMes, Taxas, Ambiente } from './asaasTaxas';
// Tabela no Supabase PRINCIPAL, não no do Gerador — de propósito. O projeto do
// Gerador é lido pela tela com a chave publishable, e esta tabela guarda CPF,
// telefone e valor de cliente. Aqui só o service_role entra, e a tela só enxerga
// o que passar pelo endpoint com token.
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

const LOG = 'asaas-cobrancas';

/** 'link' = o cliente escolhe como pagar na página do Asaas (não exige CPF). */
export type Meio = 'link' | 'pix' | 'boleto' | 'cartao';

export interface Cliente {
  nome: string;
  cpfCnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
}

export interface Plano {
  cliente: Cliente;
  descricao: string;
  meio: Meio;
  parcelas: number;
  /** 'liquido' = o valor é o que deve SOBRAR. 'cheio' = é o que o cliente paga. */
  valorModo: 'liquido' | 'cheio';
  valor: number;
  vencimentoDias: number;
  antecipar: boolean;
  avisos?: string[];
  explicacao?: string;
}

export interface Previa {
  meio: Meio;
  parcelas: number;
  /** O que o cliente paga no total. */
  bruto: number;
  /** O que o cliente paga por mês. */
  parcela: number;
  taxaAsaas: number;
  custoAntecipacao: number;
  /** O que cai na conta. */
  liquido: number;
  antecipar: boolean;
  quandoCai: string;
  avisos: string[];
  /** Cenário alternativo: o mesmo valor pago à vista no Pix. */
  seFossePix: { liquido: number; quandoCai: string } | null;
}

const MAX_PARCELAS = 21;

const r2 = (n: number) => Math.round(n * 100) / 100;
const paraCima = (n: number) => Math.ceil(n * 100 - 1e-6) / 100;

// ── Cálculo ──────────────────────────────────────────────────────────────────

/** Taxa do Pix respeitando tipo, piso e teto — e a cota mensal de graça. */
function taxaPix(t: Taxas, bruto: number): number {
  if (t.pixJaUsadosMes < t.pixGratisMes) return 0;
  if (t.pixTipo === 'FIXED') return t.pixFixo;
  const bruta = bruto * (t.pixPct / 100);
  const comPiso = t.pixMin > 0 ? Math.max(bruta, t.pixMin) : bruta;
  return t.pixMax > 0 ? Math.min(comPiso, t.pixMax) : comPiso;
}

/**
 * Fator da antecipação — quanto do valor some por antecipar N parcelas.
 *
 * Cada parcela é antecipada por ~1 mês a mais que a anterior: a nº1 liquida em
 * D+32 do pagamento, a nº2 trinta dias depois, e assim por diante. O custo é a
 * MÉDIA desses prazos, não um mês — tratar como um mês faz o 18x parecer 9×
 * mais barato do que é.
 *
 * O prazo é contado em DIAS e depois convertido, porque o relógio começa no
 * vencimento da primeira parcela, não hoje. Conferido contra a simulação real
 * do Asaas em 14/08/2026 (18x de R$527,56): este modelo dá R$1.560 e o Asaas
 * cobrou R$1.585 — 1,5% a mais. Por isso o app não confia nesta estimativa
 * quando dá pra perguntar: em cobrança com CPF ele cria, chama
 * /anticipations/simulate e se corrige (ver `criarCobranca`).
 */
export function fatorAntecipacao(t: Taxas, parcelas: number, vencimentoDias = 3): number {
  const n = Math.max(1, Math.round(parcelas));
  const mediaDias = vencimentoDias + t.cartaoDias + (30 * (n - 1)) / 2;
  return (pctAntecipacaoMes(t, n) / 100) * (mediaDias / 30);
}

// Margem só para o LINK aberto: ali não existe cobrança pra simular antes de o
// cliente pagar, então a estimativa é tudo que há. Errar 1,5% pra menos manda o
// Thiago receber menos do que prometeu; errar pra mais cobra R$40 a mais numa
// venda de R$9,5 mil. A escolha é óbvia.
const MARGEM_LINK = 0.04;

/** Quanto sobra de um bruto — a função que a tela mostra e a bisseção usa. */
export function liquidoDe(
  t: Taxas, meio: Meio, bruto: number, parcelas: number, antecipar: boolean, vencimentoDias = 3,
): number {
  if (meio === 'pix') return bruto - taxaPix(t, bruto);
  if (meio === 'boleto') return bruto - t.boleto;

  // 'cartao' e 'link' são precificados como cartão: é o pior caso, e é o caso
  // que o humano está planejando quando fala em parcela. Se o cliente acabar
  // pagando no Pix, sobra mais — nunca menos.
  const mdr = bruto * (pctCartao(t, parcelas) / 100) + t.cartaoFixo;
  const apos = bruto - mdr;
  if (!antecipar) return apos;
  const fator = fatorAntecipacao(t, parcelas, vencimentoDias) * (meio === 'link' ? 1 + MARGEM_LINK : 1);
  return apos - apos * fator;
}

/**
 * O bruto mínimo que faz sobrar `alvo`. Bisseção: 60 passos levam o intervalo
 * a menos de um centavo mesmo partindo de 100× o alvo.
 */
export function brutoParaLiquido(
  t: Taxas, meio: Meio, alvo: number, parcelas: number, antecipar: boolean, vencimentoDias = 3,
): number {
  let lo = alvo, hi = Math.max(alvo * 3, alvo + 1000);
  for (let i = 0; i < 60 && liquidoDe(t, meio, hi, parcelas, antecipar, vencimentoDias) < alvo; i++) hi *= 1.5;
  for (let i = 0; i < 60; i++) {
    const meiodoCaminho = (lo + hi) / 2;
    if (liquidoDe(t, meio, meiodoCaminho, parcelas, antecipar, vencimentoDias) < alvo) lo = meiodoCaminho;
    else hi = meiodoCaminho;
  }
  return paraCima(hi);
}

function quandoCaiTexto(t: Taxas, meio: Meio, parcelas: number, antecipar: boolean): string {
  if (meio === 'pix') return 'na hora que ele pagar';
  if (meio === 'boleto') {
    return t.boletoDias <= 1 ? 'no dia útil seguinte ao pagamento' : `${t.boletoDias} dias após o pagamento`;
  }
  if (antecipar) return 'em até 2 dias úteis depois que a antecipação for aprovada';
  if (parcelas === 1) return `${t.cartaoDias} dias após o pagamento`;
  return `${t.cartaoDias} dias após cada parcela — a última em ~${Math.round((t.cartaoDias * parcelas) / 30)} meses`;
}

export async function calcularPrevia(plano: Plano, taxas?: Taxas): Promise<Previa> {
  const t = taxas ?? await buscarTaxas();
  const parcelas = Math.max(1, Math.min(MAX_PARCELAS, Math.round(plano.parcelas || 1)));
  const cartao = plano.meio === 'cartao' || plano.meio === 'link';
  const antecipar = cartao && plano.antecipar;

  let bruto = plano.valorModo === 'liquido'
    ? brutoParaLiquido(t, plano.meio, plano.valor, parcelas, antecipar, plano.vencimentoDias)
    : r2(plano.valor);

  // A parcela é o número que o cliente lê e repete. Arredondar ela pra cima e
  // recompor o total por multiplicação garante que 18 × parcela === bruto na
  // tela, no Asaas e no extrato — sem centavo órfão na última parcela.
  const parcela = paraCima(bruto / parcelas);
  bruto = r2(parcela * parcelas);

  const liquido = r2(liquidoDe(t, plano.meio, bruto, parcelas, antecipar, plano.vencimentoDias));
  const mdr = cartao ? r2(bruto * (pctCartao(t, parcelas) / 100) + t.cartaoFixo)
            : plano.meio === 'pix' ? r2(taxaPix(t, bruto)) : r2(t.boleto);
  const custoAntecip = antecipar ? r2(bruto - mdr - liquido) : 0;

  const avisos: string[] = [...(plano.avisos ?? [])];
  if (parcelas > 12) {
    avisos.push('Acima de 12x só existe em Visa e Mastercard — Elo, Amex e Hipercard param em 12x.');
  }
  if (parcelas > 1 && cartao) {
    avisos.push(`O limite do cartão dele precisa ter R$ ${bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} livres: parcelado trava o valor cheio de uma vez, não a parcela.`);
  }
  if (antecipar) {
    avisos.push('A antecipação passa por análise de crédito do Asaas e depende do limite liberado na conta — o prazo só começa a contar depois que ele pagar.');
  }
  if (t.ambiente === 'sandbox') {
    avisos.push('AMBIENTE DE TESTE (sandbox): esta cobrança não é real e ninguém paga nada.');
  }

  return {
    meio: plano.meio, parcelas, bruto, parcela,
    taxaAsaas: mdr, custoAntecipacao: custoAntecip, liquido, antecipar,
    quandoCai: quandoCaiTexto(t, plano.meio, parcelas, antecipar),
    avisos,
    seFossePix: cartao ? {
      liquido: r2(liquidoDe(t, 'pix', bruto, 1, false)),
      quandoCai: 'na hora',
    } : null,
  };
}

// ── Criação no Asaas ─────────────────────────────────────────────────────────

export interface CobrancaCriada {
  id: string;
  tipo: 'link' | 'avulsa' | 'parcelamento';
  url: string;
  bruto: number;
  parcela: number;
  parcelas: number;
  liquido: number;
  ambiente: Ambiente;
  /** 'exata' = número conferido no Asaas. 'estimada' = conta nossa. */
  conferencia: 'exata' | 'estimada';
  /** Quantas vezes o valor foi refeito pra bater o alvo (0, 1 ou 2). */
  ajustes: number;
}

const soDigitos = (s?: string | null) => String(s ?? '').replace(/\D/g, '');

function dataMais(dias: number): string {
  const d = new Date(Date.now() + Math.max(0, dias) * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Acha o cliente pelo CPF/CNPJ antes de criar outro. Cadastro duplicado é o que
 * fez a Stripe acumular 111 assinaturas para 85 e-mails e três clientes pagarem
 * em dobro — o mesmo erro custa caro aqui.
 */
async function acharOuCriarCliente(c: Cliente): Promise<string> {
  const doc = soDigitos(c.cpfCnpj);
  if (doc) {
    const achado = await asaasFetch<{ data?: Array<{ id?: string }> }>(`/customers?cpfCnpj=${doc}&limit=1`);
    const id = achado.data?.[0]?.id;
    if (id) return id;
  }
  const novo = await asaasFetch<{ id?: string }>('/customers', {
    method: 'POST',
    body: {
      name: c.nome,
      cpfCnpj: doc || undefined,
      email: c.email || undefined,
      mobilePhone: soDigitos(c.telefone) || undefined,
      notificationDisabled: false,
    },
  });
  if (!novo?.id) throw new Error('Asaas não devolveu id do cliente');
  return novo.id;
}

const BILLING: Record<Exclude<Meio, 'link'>, string> = {
  pix: 'PIX', boleto: 'BOLETO', cartao: 'CREDIT_CARD',
};

async function criarNoAsaas(plano: Plano, previa: Previa, taxas: Taxas, ref: string): Promise<CobrancaCriada> {
  // Sem CPF não existe cliente no Asaas, e sem cliente não existe cobrança
  // avulsa. O link é a saída certa: quem preenche os dados é o comprador.
  const temDoc = !!soDigitos(plano.cliente.cpfCnpj);
  const usarLink = plano.meio === 'link' || !temDoc;

  let criada: CobrancaCriada;

  if (usarLink) {
    const r = await asaasFetch<{ id?: string; url?: string }>('/paymentLinks', {
      method: 'POST',
      body: {
        name: plano.descricao.slice(0, 100),
        description: plano.descricao.slice(0, 500),
        billingType: plano.meio === 'link' ? 'UNDEFINED' : BILLING[plano.meio as Exclude<Meio, 'link'>],
        chargeType: previa.parcelas > 1 ? 'INSTALLMENT' : 'DETACHED',
        value: previa.bruto,
        dueDateLimitDays: Math.max(1, Math.min(30, plano.vencimentoDias || 3)),
        maxInstallmentCount: previa.parcelas,
        notificationEnabled: false,
        externalReference: ref,
      },
    });
    if (!r?.id || !r?.url) throw new Error('Asaas devolveu link sem id/url');
    criada = {
      id: r.id, tipo: 'link', url: r.url,
      bruto: previa.bruto, parcela: previa.parcela, parcelas: previa.parcelas,
      liquido: previa.liquido, ambiente: taxas.ambiente,
      conferencia: 'estimada', ajustes: 0,
    };
  } else {
    const customer = await acharOuCriarCliente(plano.cliente);
    const parcelado = previa.parcelas > 1;
    const r = await asaasFetch<{ id?: string; invoiceUrl?: string; bankSlipUrl?: string; installment?: string }>('/payments', {
      method: 'POST',
      body: {
        customer,
        billingType: BILLING[plano.meio as Exclude<Meio, 'link'>],
        dueDate: dataMais(plano.vencimentoDias || 3),
        description: plano.descricao.slice(0, 500),
        externalReference: ref,
        // `installmentValue` e não `totalValue`: o Asaas divide o total por conta
        // dele e arredonda, e centavo de arredondamento é exatamente o que faz o
        // líquido cair abaixo do alvo. Aqui a parcela é lei.
        ...(parcelado
          ? { installmentCount: previa.parcelas, installmentValue: previa.parcela }
          : { value: previa.bruto }),
      },
    });
    if (!r?.id) throw new Error('Asaas devolveu cobrança sem id');
    criada = {
      id: parcelado && r.installment ? r.installment : r.id,
      tipo: parcelado && r.installment ? 'parcelamento' : 'avulsa',
      url: r.invoiceUrl || r.bankSlipUrl || '',
      bruto: previa.bruto, parcela: previa.parcela, parcelas: previa.parcelas,
      liquido: previa.liquido, ambiente: taxas.ambiente,
      conferencia: 'estimada', ajustes: 0,
    };
  }
  return criada;
}

/** Apaga uma cobrança ainda não paga. Usado só pra refazer com o valor certo. */
async function apagarNoAsaas(criada: CobrancaCriada): Promise<void> {
  const rota = criada.tipo === 'link' ? `/paymentLinks/${criada.id}`
             : criada.tipo === 'parcelamento' ? `/installments/${criada.id}`
             : `/payments/${criada.id}`;
  await asaasFetch(rota, { method: 'DELETE' });
}

/**
 * Cria a cobrança e — quando dá pra perguntar — CONFERE o líquido com o próprio
 * Asaas antes de devolver o link.
 *
 * Por que isso existe: a estimativa de antecipação erra ~1,5% pra menos.
 * Conferido em 14/08/2026 num 18x de R$9.496 — nossa conta dizia que sobrariam
 * R$7.700 e a simulação do Asaas devolveu R$7.598. Cento e um reais somem, e
 * some DEPOIS de o cliente já ter pago, quando não há mais o que fazer.
 *
 * Então: cria → chama /anticipations/simulate → se faltou, apaga (ninguém pagou
 * ainda, é seguro) e refaz com o alvo corrigido. Duas tentativas bastam porque
 * a relação bruto→líquido é quase linear; a segunda serve pra conferir a
 * primeira. O humano só vê o link final, com o número certo.
 *
 * O link aberto fica de fora: não existe cobrança pra simular antes de alguém
 * pagar. Lá vale a margem de segurança do cálculo (MARGEM_LINK).
 */
export async function criarCobranca(plano: Plano): Promise<CobrancaCriada> {
  const taxas = await buscarTaxas();
  const ref = `io:${Date.now().toString(36)}`;

  let planoAtual = plano;
  let previa = await calcularPrevia(planoAtual, taxas);
  let criada = await criarNoAsaas(planoAtual, previa, taxas, ref);

  // Só há o que conferir quando existe ALVO de líquido e antecipação em jogo —
  // sem antecipar, o MDR é percentual puro e a conta fecha exata.
  const daPraConferir = criada.tipo !== 'link' && plano.valorModo === 'liquido' && previa.antecipar;

  const MAX_AJUSTES = 2;
  if (daPraConferir) {
    // Confere SEMPRE depois de criar — inclusive depois do último ajuste. Sem a
    // conferência final o app refaria a cobrança e devolveria a estimativa como
    // se fosse número fechado, que é justamente o defeito que ele existe pra
    // não ter.
    for (let i = 0; i <= MAX_AJUSTES; i++) {
      let real: SimulacaoAntecipacao;
      try {
        real = await simularAntecipacao(criada.id, criada.tipo);
      } catch (err) {
        // Antecipação indisponível (limite, análise, conta nova) não derruba a
        // cobrança: ela vale sem antecipar. A tela avisa.
        logger.warn(LOG, 'não deu pra conferir o líquido com o Asaas', err);
        break;
      }

      criada.liquido = r2(real.liquido);
      criada.conferencia = 'exata';
      const falta = r2(plano.valor - real.liquido);
      if (falta <= 0.01 || i === MAX_AJUSTES) break;

      logger.info(LOG, `líquido ficou R$${falta} abaixo do alvo — refazendo`, { tentativa: i + 1 });
      try {
        await apagarNoAsaas(criada);
      } catch (err) {
        // Não conseguiu apagar: melhor ficar com a cobrança boa-mas-curta do que
        // criar uma segunda e deixar duas vivas pro mesmo cliente.
        logger.warn(LOG, 'não consegui apagar pra refazer — mantendo a cobrança criada', err);
        break;
      }

      planoAtual = { ...planoAtual, valor: r2(planoAtual.valor + falta) };
      previa = await calcularPrevia(planoAtual, taxas);
      const ajustes = criada.ajustes + 1;
      criada = await criarNoAsaas(planoAtual, previa, taxas, ref);
      criada.ajustes = ajustes;
    }
  }

  await guardar(plano, previa, criada, ref);
  logger.info(LOG, `cobrança criada (${criada.tipo}, ${taxas.ambiente})`, {
    id: criada.id, bruto: criada.bruto, liquido: criada.liquido,
    conferencia: criada.conferencia, ajustes: criada.ajustes,
  });
  return criada;
}

async function guardar(plano: Plano, previa: Previa, criada: CobrancaCriada, ref: string): Promise<void> {
  const { error } = await supabase.from('gerador_cobrancas').insert({
    asaas_id: criada.id,
    tipo: criada.tipo,
    ambiente: criada.ambiente,
    external_ref: ref,
    cliente_nome: plano.cliente.nome,
    cliente_doc: soDigitos(plano.cliente.cpfCnpj) || null,
    cliente_telefone: soDigitos(plano.cliente.telefone) || null,
    descricao: plano.descricao,
    meio: plano.meio,
    parcelas: previa.parcelas,
    valor_bruto: criada.bruto,
    valor_parcela: criada.parcela,
    taxa_asaas: previa.taxaAsaas,
    // O líquido gravado é o CONFERIDO quando existe — é o número que responde
    // "quanto essa venda deu de verdade" seis meses depois.
    custo_antecipacao: r2(criada.bruto - previa.taxaAsaas - criada.liquido),
    valor_liquido: criada.liquido,
    antecipar: previa.antecipar,
    url: criada.url,
    status: 'PENDING',
  });
  // Falha de registro não pode derrubar uma cobrança que JÁ existe no Asaas: o
  // link na mão do Thiago vale mais que a linha na nossa tabela.
  if (error) logger.warn(LOG, 'cobrança criada mas não registrada no banco', error);
}

// ── Consulta ─────────────────────────────────────────────────────────────────

export interface LinhaCobranca {
  id: number;
  asaas_id: string;
  tipo: string;
  ambiente: string;
  cliente_nome: string;
  descricao: string;
  meio: string;
  parcelas: number;
  valor_bruto: number;
  valor_parcela: number;
  valor_liquido: number;
  antecipar: boolean;
  url: string;
  status: string;
  criado_em: string;
  pagas?: number;
}

const FINAIS = ['RECEIVED', 'CONFIRMED', 'REFUNDED', 'PAGO'];

/**
 * Últimas cobranças, com o status conferido no Asaas na hora de mostrar.
 *
 * Por que puxar em vez de esperar webhook: o webhook do Asaas existe e aponta
 * pro trilho do PlugCash — `acharOfertaDoPagamento` devolve null pra tudo que
 * não é curso, então uma cobrança daqui chegaria lá e seria descartada em
 * silêncio. Puxar na hora custa alguns milissegundos numa tela usada por duas
 * pessoas, e nunca fica desatualizado.
 */
export async function listarCobrancas(limite = 40): Promise<LinhaCobranca[]> {
  const { data } = await supabase
    .from('gerador_cobrancas')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limite);

  const linhas = (data ?? []) as LinhaCobranca[];
  const pendentes = linhas.filter((l) => !FINAIS.includes(l.status)).slice(0, 20);

  await Promise.allSettled(pendentes.map(async (l) => {
    try {
      const st = await statusNoAsaas(l.asaas_id, l.tipo);
      if (!st) return;
      l.status = st.status;
      l.pagas = st.pagas;
      if (st.status !== 'PENDING') {
        await supabase.from('gerador_cobrancas')
          .update({ status: st.status }).eq('id', l.id);
      }
    } catch { /* status velho na tela é melhor que tela quebrada */ }
  }));

  return linhas;
}

async function statusNoAsaas(id: string, tipo: string): Promise<{ status: string; pagas: number } | null> {
  if (tipo === 'avulsa') {
    const p = await asaasFetch<{ status?: string }>(`/payments/${id}`);
    return { status: p.status ?? 'PENDING', pagas: FINAIS.includes(p.status ?? '') ? 1 : 0 };
  }
  const q = tipo === 'link' ? `paymentLink=${id}` : `installment=${id}`;
  const r = await asaasFetch<{ data?: Array<{ status?: string }> }>(`/payments?${q}&limit=100`);
  const itens = r.data ?? [];
  const pagas = itens.filter((i) => FINAIS.includes(i.status ?? '')).length;
  if (!itens.length) return { status: 'PENDING', pagas: 0 };
  return { status: pagas > 0 ? (pagas === itens.length ? 'RECEIVED' : 'PARCIAL') : 'PENDING', pagas };
}

// ── Antecipação ──────────────────────────────────────────────────────────────

export interface SimulacaoAntecipacao {
  valorTotal: number;
  taxa: number;
  liquido: number;
  exigeDocumento: boolean;
  detalhe?: string;
}

/**
 * O número EXATO da antecipação, dado pelo próprio Asaas. A prévia do app é uma
 * estimativa boa; isto aqui é a conta que vai acontecer. Só existe depois da
 * cobrança criada — antes disso não há o que antecipar.
 */
export async function simularAntecipacao(asaasId: string, tipo: string): Promise<SimulacaoAntecipacao> {
  const corpo = tipo === 'parcelamento' ? { installment: asaasId } : { payment: asaasId };
  const r = await asaasFetch<{
    totalValue?: number; fee?: number; netValue?: number; isDocumentationRequired?: boolean;
  }>('/anticipations/simulate', { method: 'POST', body: corpo });
  return {
    valorTotal: Number(r.totalValue ?? 0),
    taxa: Number(r.fee ?? 0),
    liquido: Number(r.netValue ?? 0),
    exigeDocumento: r.isDocumentationRequired === true,
  };
}

export async function pedirAntecipacao(asaasId: string, tipo: string): Promise<{ id: string; status: string }> {
  const corpo = tipo === 'parcelamento' ? { installment: asaasId } : { payment: asaasId };
  const r = await asaasFetch<{ id?: string; status?: string }>('/anticipations', { method: 'POST', body: corpo });
  await supabase.from('gerador_cobrancas')
    .update({ antecipacao_id: r.id ?? null, antecipacao_status: r.status ?? 'SCHEDULED' })
    .eq('asaas_id', asaasId);
  return { id: r.id ?? '', status: r.status ?? 'SCHEDULED' };
}
