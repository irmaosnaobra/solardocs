// ─────────────────────────────────────────────────────────────────────────────
// DEFESA AUTOMÁTICA DE CONTESTAÇÃO (Stripe) — funções PURAS.
//
// Aqui não tem I/O: quem busca no banco e na Stripe é o disputeWatcher, que
// entrega o que achou em `CtxDefesa`. Isso deixa a decisão e o texto da
// evidência testáveis sem rede.
//
// Por que existe: a conta perdeu 11 de 11 disputas, a última por prazo vencido
// sem nenhuma resposta. A Stripe aceita UMA submissão por disputa, então:
//   1. o estado da Stripe manda (submission_count), não o nosso;
//   2. duplicada (cobrança em dobro, bug de Customer duplicado) NUNCA é defendida;
//   3. só campos de TEXTO. Texto em campo de ARQUIVO devolve "No such file_upload"
//      e a submissão fica pela metade (CONTESTACOES-STRIPE.md, nota 4).
// ─────────────────────────────────────────────────────────────────────────────

export const HORAS_ESPERA = 48;
export const DIAS_PRAZO_CURTO = 2;
export const DIAS_JANELA_DUPLICADA = 25;
export const TETO_CAMPO = 5000;

/** Campos de ARQUIVO da evidência. Nunca recebem texto. */
export const CAMPOS_ARQUIVO = [
  'customer_communication', 'receipt', 'refund_policy', 'cancellation_policy',
  'service_documentation', 'customer_signature', 'duplicate_charge_documentation',
  'shipping_documentation', 'uncategorized_file',
] as const;

/** Única lista de campos que esta defesa escreve. Tudo fora dela é descartado. */
export const CAMPOS_TEXTO = [
  'product_description', 'customer_name', 'customer_email_address', 'service_date',
  'access_activity_log', 'uncategorized_text', 'customer_purchase_ip', 'cancellation_rebuttal',
] as const;

export type AcaoDefesa =
  | 'ignorar' | 'ja_enviada' | 'desligado' | 'avisar_rascunho'
  | 'avisar_duplicada' | 'avisar_sem_uso' | 'esperar' | 'enviar';

export interface DecisaoDefesa { acao: AcaoDefesa; motivo: string }

export interface CobrancaResumo {
  id: string;
  amount: number;
  created: number;          // unix, segundos
  email: string | null;
  customer: string | null;
  status: string;           // 'succeeded', ...
  refunded: boolean;
  amount_refunded: number;
  disputed: boolean;
}

export interface AssinaturaResumo {
  id: string;
  status: string;
  created: number;
  canceled_at: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  /** price.recurring.interval da Stripe ('month' | 'year'); null se não veio. */
  intervalo?: string | null;
}

export interface CtxDefesa {
  /** Conta do SolarDoc com o e-mail da cobrança (ou null se nunca criou conta). */
  conta: { id: string; email: string; created_at: string; plano?: string | null } | null;
  empresa: { nome?: string | null; cnpj?: string | null; cidade?: string | null } | null;
  /** `rows`: até 1000 mais recentes, created_at CRU do banco (3h adiantado). */
  docs: { total: number; primeiro: string | null; rows: Array<{ created_at: string; tipo?: string | null }> };
  eventos: { total: number; ultimo: string | null };
  /** Todas as cobranças dos Customers com o mesmo e-mail (inclui a contestada). */
  cobrancasEmail: CobrancaResumo[];
  /** Assinaturas `active` dos Customers com o mesmo e-mail. */
  assinaturasAtivasEmail: number;
  /** Assinatura que gerou a cobrança contestada, se deu para achar. */
  assinaturaDaCobranca: AssinaturaResumo | null;
  /** DISPUTA_AUTO_OFF ligado. */
  autoOff: boolean;
}

export const ctxVazio = (): CtxDefesa => ({
  conta: null, empresa: null,
  docs: { total: 0, primeiro: null, rows: [] },
  eventos: { total: 0, ultimo: null },
  cobrancasEmail: [], assinaturasAtivasEmail: 0, assinaturaDaCobranca: null, autoOff: false,
});

export const autoOffLigado = (v: string | undefined | null): boolean =>
  ['1', 'true'].includes(String(v ?? '').trim().toLowerCase());

const DIA_MS = 86_400_000;

// ── datas ────────────────────────────────────────────────────────────────────
const TZ = 'America/Sao_Paulo';

/** dd/mm/aaaa em Brasília a partir de milissegundos. Fuso explícito: o processo roda em UTC. */
export function diaBR(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { timeZone: TZ });
}
/** dd/mm em Brasília. */
export function diaMesBR(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
}
/** AAAA-MM-DD em Brasília. */
export function isoDiaBR(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
}
/**
 * `documents.created_at` está 3h ADIANTADO no banco (bug conhecido). Devolve o
 * instante real em ms: tira 3h do valor gravado.
 */
export function docMs(createdAt: string): number {
  return new Date(createdAt).getTime() - 3 * 3_600_000;
}
const msIso = (iso: string): number => new Date(iso).getTime();

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

// ── 1. decisão ───────────────────────────────────────────────────────────────

/** Mesmo e-mail (minúsculo) tem outra cobrança paga, não estornada, de mesmo valor, até 25 dias de distância? */
export function acharCobrancaDuplicada(charge: any, ctx: CtxDefesa): CobrancaResumo | null {
  const alvo = charge as { id?: string; amount?: number; created?: number } | null;
  if (!alvo?.id || typeof alvo.created !== 'number') return null;
  const janela = DIAS_JANELA_DUPLICADA * DIA_MS;
  for (const c of ctx.cobrancasEmail) {
    if (c.id === alvo.id) continue;                      // a própria contestada não conta
    if (c.status !== 'succeeded') continue;
    if (c.refunded || c.amount_refunded > 0) continue;   // já devolvida: não é excedente vivo
    if (c.amount !== alvo.amount) continue;
    if (Math.abs(c.created - alvo.created) * 1000 <= janela) return c;
  }
  return null;
}

/**
 * Decide o que fazer com UMA disputa. Ordem das regras = ordem de prioridade:
 * a Stripe manda (já enviada), depois o freio manual, depois o que NUNCA se defende.
 */
export function decidirDefesa(d: any, ctx: CtxDefesa, agoraMs: number): DecisaoDefesa {
  if (d?.status !== 'needs_response' && d?.status !== 'warning_needs_response') {
    return { acao: 'ignorar', motivo: `status ${d?.status} não aceita resposta` };
  }
  const det = d.evidence_details ?? {};
  if ((det.submission_count ?? 0) > 0) {
    return { acao: 'ja_enviada', motivo: 'a Stripe já registra uma submissão (ela aceita só uma)' };
  }
  if (ctx.autoOff) {
    return { acao: 'desligado', motivo: 'DISPUTA_AUTO_OFF está ligado' };
  }
  if (det.has_evidence === true) {
    return { acao: 'avisar_rascunho', motivo: 'já existe rascunho de evidência salvo no painel; não vamos sobrescrever' };
  }

  const charge = typeof d.charge === 'object' ? d.charge : null;
  if (d.reason === 'duplicate') {
    return { acao: 'avisar_duplicada', motivo: 'o motivo alegado é cobrança duplicada' };
  }
  if (charge && acharCobrancaDuplicada(charge, ctx)) {
    return { acao: 'avisar_duplicada', motivo: 'o mesmo e-mail tem outra cobrança paga do mesmo valor em até 25 dias' };
  }
  if (ctx.assinaturasAtivasEmail > 1) {
    return { acao: 'avisar_duplicada', motivo: `o mesmo e-mail tem ${ctx.assinaturasAtivasEmail} assinaturas ativas` };
  }

  // Sem documento e sem uso registrado não há o que provar, exista a conta ou não.
  if (ctx.docs.total === 0 && ctx.eventos.total === 0) {
    return {
      acao: 'avisar_sem_uso',
      motivo: ctx.conta
        ? 'a conta existe, mas não tem nenhum documento nem uso de ferramenta registrado'
        : 'não existe conta no banco para esse e-mail e não há nenhum uso registrado',
    };
  }

  // Espera 48h (relógio = d.created da Stripe) para o titular ou o dono agirem,
  // mas só enquanto sobram mais de 2 dias de prazo.
  const criadaMs = (d.created ?? 0) * 1000;
  const dueMs = det.due_by ? det.due_by * 1000 : Infinity;
  if (agoraMs < criadaMs + HORAS_ESPERA * 3_600_000 && dueMs - agoraMs > DIAS_PRAZO_CURTO * DIA_MS) {
    return { acao: 'esperar', motivo: 'ainda dentro das 48h depois da abertura' };
  }
  return { acao: 'enviar', motivo: 'passou das 48h ou o prazo está curto' };
}

/** Data (dd/mm) em que a defesa sai sozinha: abertura + 48h, em Brasília. */
export function dataDaDefesa(d: any): string {
  return diaMesBR((d.created ?? 0) * 1000 + HORAS_ESPERA * 3_600_000);
}

// ── 2. evidência ─────────────────────────────────────────────────────────────

const MOTIVO_PT: Record<string, string> = {
  fraudulent: 'pagamento não autorizado (fraude)',
  unrecognized: 'cobrança não reconhecida',
  subscription_canceled: 'assinatura cancelada',
  product_not_received: 'serviço não recebido',
  product_unacceptable: 'serviço não conforme',
  credit_not_processed: 'crédito não processado',
  duplicate: 'cobrança duplicada',
  general: 'motivo geral',
};

/** Sem travessão (regra de escrita da casa) e sem espaço sobrando nas pontas. */
const limpa = (s: string) => s.replace(/—/g, '-').replace(/–/g, '-').trim();

/** Corta no limite sem partir linha ao meio, quando der. */
export function cortar(texto: string, max = TETO_CAMPO): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max - 1);
  const nl = corte.lastIndexOf('\n');
  const base = nl > max * 0.6 ? corte.slice(0, nl) : corte;
  return base.trimEnd() + '…';
}

/** "por assinatura mensal/anual" conforme a Stripe; sem intervalo, sem período nenhum. */
function porAssinatura(sub: AssinaturaResumo | null): string {
  if (sub?.intervalo === 'month') return 'por assinatura mensal';
  if (sub?.intervalo === 'year') return 'por assinatura anual';
  return 'por assinatura';
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Resposta a "assinatura cancelada". SÓ existe quando o motivo é
 * subscription_canceled E a Stripe confirma que a assinatura não estava
 * cancelada nem com cancelamento marcado na data da cobrança.
 */
function textoRebuttal(d: any, sub: AssinaturaResumo | null, cobrancaMs: number): string | null {
  if (d?.reason !== 'subscription_canceled' || !sub) return null;
  const canceladaDepois = sub.canceled_at == null || sub.canceled_at * 1000 > cobrancaMs;
  const cancelAgendado = sub.cancel_at_period_end === true || (sub.cancel_at != null && sub.cancel_at * 1000 <= cobrancaMs);
  if (!canceladaDepois || cancelAgendado) return null;
  const estado = sub.canceled_at == null
    ? 'sem nenhum cancelamento registrado'
    : `sem cancelamento registrado até ${diaBR(sub.canceled_at * 1000)}`;
  return `Segundo a Stripe, a assinatura ${sub.id} estava ${estado} na data da cobrança contestada (${diaBR(cobrancaMs)}) e não tinha cancelamento marcado para o fim do período (cancel_at_period_end falso).`;
}

/**
 * Monta o objeto `evidence` da Stripe. SÓ campos de texto, com teto de 5.000
 * caracteres. Toda frase vem de dado da Stripe (`d`, `charge`, `ctx`) ou do banco.
 * Não há política de reembolso/cancelamento aqui: não existe texto de termos
 * no ar para citar, então os dois campos de "disclosure" ficam de fora.
 */
export function montarEvidencia(d: any, charge: any, ctx: CtxDefesa): Record<string, string> {
  const ch = charge ?? {};
  const cobrancaMs = (ch.created ?? d.created ?? 0) * 1000;
  const aberturaMs = (d.created ?? 0) * 1000;
  const email = String(ch.billing_details?.email || d.evidence?.customer_email_address || ctx.conta?.email || '').toLowerCase().trim();
  const nome = String(ch.billing_details?.name || d.evidence?.customer_name || '').trim();
  const valor = reais(ch.amount ?? d.amount ?? 0);
  const card = ch.payment_method_details?.card ?? null;

  // ── fatos da cobrança ──
  const fatosCobranca: string[] = [];
  fatosCobranca.push(`Cobrança ${ch.id || ''} de ${valor} em ${diaBR(cobrancaMs)}${ch.outcome?.type === 'authorized' ? ', autorizada pela emissora do cartão' : ''}.`);
  if (card?.brand || card?.last4) {
    const marca = card.brand ? String(card.brand).charAt(0).toUpperCase() + String(card.brand).slice(1) : 'Cartão';
    fatosCobranca.push(`Cartão ${marca}${card.last4 ? ` final ${card.last4}` : ''}${card.country ? `, país de emissão ${card.country}` : ''}.`);
  }
  if (card?.checks?.cvc_check === 'pass') fatosCobranca.push('O código de segurança do cartão (CVC) foi informado e confirmado pela emissora.');
  if (card?.checks?.address_postal_code_check === 'pass') fatosCobranca.push('O CEP informado confere com o cadastrado na emissora.');
  if (card?.three_d_secure?.result === 'authenticated') {
    fatosCobranca.push('A compra passou por autenticação 3D Secure e foi autenticada pelo titular.');
  }
  if (nome || email) fatosCobranca.push(`Dados de cobrança informados na compra: ${nome || 'sem nome'}${email ? `, e-mail ${email}` : ''}.`);

  // ── cobranças anteriores do mesmo e-mail que nunca foram contestadas ──
  const anteriores = ctx.cobrancasEmail
    .filter((c) => c.id !== ch.id && c.status === 'succeeded' && !c.disputed && !c.refunded && c.amount_refunded === 0 && c.created * 1000 < cobrancaMs)
    .sort((a, b) => a.created - b.created);
  let historico = '';
  if (anteriores.length) {
    const datas = anteriores.slice(-6).map((c) => diaBR(c.created * 1000));
    const resto = anteriores.length - datas.length;
    historico = `Antes desta, o mesmo e-mail pagou ${plural(anteriores.length, 'cobrança', 'cobranças')} que nunca foram contestadas, em ${datas.join(', ')}${resto > 0 ? ` e mais ${resto} anteriores` : ''}.`;
  }

  // ── uso real da conta ──
  const linhasLog: string[] = [];
  const linhasUso: string[] = [];
  const docsOrdem = ctx.docs.rows.map((r) => ({ ms: docMs(r.created_at), tipo: r.tipo ?? null })).sort((a, b) => a.ms - b.ms);
  const primeiroDocMs = ctx.docs.primeiro ? docMs(ctx.docs.primeiro) : (docsOrdem[0]?.ms ?? null);
  const ultimoDocMs = docsOrdem.length ? docsOrdem[docsOrdem.length - 1]!.ms : null;
  const ultimoEventoMs = ctx.eventos.ultimo ? msIso(ctx.eventos.ultimo) : null;

  if (ctx.conta) {
    const criadaMs = msIso(ctx.conta.created_at);
    linhasLog.push(`REGISTRO DE ACESSO da conta ${ctx.conta.email}`);
    linhasLog.push(`Identificador interno: ${ctx.conta.id}`);
    linhasLog.push('Datas no horário de Brasília.');
    const antes = Math.floor((cobrancaMs - criadaMs) / DIA_MS);
    linhasLog.push(`Conta criada em ${diaBR(criadaMs)}${antes > 0 ? `, ${plural(antes, 'dia', 'dias')} antes da cobrança contestada` : ''}.`);
  } else {
    linhasLog.push(`REGISTRO DE ACESSO: não há conta no banco com o e-mail ${email || 'da cobrança'}, mas há uso registrado por outro caminho.`);
  }

  if (ctx.docs.total > 0) {
    const dos = [primeiroDocMs ? `primeiro em ${diaBR(primeiroDocMs)}` : '', ultimoDocMs ? `último em ${diaBR(ultimoDocMs)}` : ''].filter(Boolean).join(', ');
    linhasLog.push(`Documentos gerados na plataforma: ${ctx.docs.total}${dos ? ` (${dos})` : ''}.`);
    if (ctx.docs.rows.length === ctx.docs.total) {
      const porTipo: Record<string, number> = {};
      for (const r of docsOrdem) if (r.tipo) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
      const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t}: ${n}`);
      if (tipos.length) linhasLog.push(`Tipos de documento: ${tipos.join('; ')}.`);
    }
    const depoisCobranca = docsOrdem.filter((r) => r.ms > cobrancaMs).length;
    if (depoisCobranca > 0) linhasLog.push(`Documentos gerados DEPOIS da cobrança contestada: ${depoisCobranca}.`);
    const depoisAbertura = docsOrdem.filter((r) => r.ms > aberturaMs).length;
    if (depoisAbertura > 0) linhasLog.push(`Documentos gerados DEPOIS de a contestação ser aberta (${diaBR(aberturaMs)}): ${depoisAbertura}.`);
  } else {
    linhasLog.push('Documentos gerados na plataforma: 0.');
  }

  if (ctx.eventos.total > 0) {
    linhasLog.push(`Usos de ferramenta registrados: ${ctx.eventos.total}${ultimoEventoMs ? `, o último em ${diaBR(ultimoEventoMs)}` : ''}.`);
    if (ultimoEventoMs && ultimoEventoMs > aberturaMs) linhasLog.push(`Houve uso registrado depois de a contestação ser aberta (${diaBR(aberturaMs)}).`);
  } else {
    linhasLog.push('Usos de ferramenta registrados: 0.');
  }

  if (ctx.empresa?.nome || ctx.empresa?.cnpj) {
    linhasLog.push(`Empresa cadastrada pelo usuário na conta: ${[ctx.empresa.nome, ctx.empresa.cnpj ? `CNPJ ${ctx.empresa.cnpj}` : '', ctx.empresa.cidade].filter(Boolean).join(', ')}.`);
  }
  linhasLog.push(`Contestação aberta junto à emissora em ${diaBR(aberturaMs)}.`);

  // resumo de uso para o texto livre
  if (ctx.conta) linhasUso.push(`A conta ${ctx.conta.email} foi criada em ${diaBR(msIso(ctx.conta.created_at))}.`);
  if (ctx.docs.total > 0) linhasUso.push(`Nela foram gerados ${plural(ctx.docs.total, 'documento', 'documentos')}${primeiroDocMs && ultimoDocMs ? `, do dia ${diaBR(primeiroDocMs)} ao dia ${diaBR(ultimoDocMs)}` : ''}.`);
  if (ctx.eventos.total > 0) linhasUso.push(`Há ${plural(ctx.eventos.total, 'uso de ferramenta registrado', 'usos de ferramenta registrados')}${ultimoEventoMs ? `, o último em ${diaBR(ultimoEventoMs)}` : ''}.`);
  if (ctx.docs.total === 0 && ctx.eventos.total === 0) linhasUso.push('Não há registro de documentos gerados nem de ferramentas usadas nesta conta.');
  if (ctx.empresa?.cnpj) linhasUso.push(`A empresa cadastrada na conta tem CNPJ ${ctx.empresa.cnpj}${ctx.empresa.nome ? ` (${ctx.empresa.nome})` : ''}.`);
  const usoDepois = (ultimoDocMs && ultimoDocMs > aberturaMs) || (ultimoEventoMs && ultimoEventoMs > aberturaMs);
  if (usoDepois) linhasUso.push(`Houve uso da conta depois de a contestação ser aberta em ${diaBR(aberturaMs)}.`);

  // ── texto livre ──
  const motivo = MOTIVO_PT[d.reason] ?? String(d.reason ?? 'não informado');
  const sub = ctx.assinaturaDaCobranca;
  const blocos: string[] = [];
  blocos.push(`A contestação alega: ${motivo}. Os registros do SolarDoc e da Stripe mostram a contratação e a entrega do serviço.`);
  blocos.push(`1) O serviço: SolarDoc é um software online (SaaS) de propostas e documentos para empresas de energia solar, ${porAssinatura(sub)}. O acesso é imediato, por login em https://solardoc.app. Não há produto físico.${sub?.trial_end ? ` A assinatura teve período de teste até ${diaBR(sub.trial_end * 1000)}.` : ''}`);
  blocos.push(`2) A cobrança: ${fatosCobranca.join(' ')}`);
  if (linhasUso.length) blocos.push(`3) Uso do serviço: ${linhasUso.join(' ')}`);
  else blocos.push('3) Uso do serviço: sem registro de uso nesta conta.');
  if (historico) blocos.push(`4) Histórico: ${historico}`);
  const rebuttal = textoRebuttal(d, sub, cobrancaMs);
  if (rebuttal) blocos.push(`5) Cancelamento: ${rebuttal}`);

  const ev: Record<string, string> = {};
  ev.product_description = `SolarDoc: software online (SaaS) de propostas e documentos para empresas de energia solar, vendido ${porAssinatura(sub)}. Acesso imediato por login em https://solardoc.app. Cobrança de ${valor}. Não há envio de produto físico.`;
  if (nome) ev.customer_name = nome;
  if (email) ev.customer_email_address = email;
  ev.service_date = isoDiaBR(cobrancaMs);
  ev.access_activity_log = linhasLog.join('\n');
  ev.uncategorized_text = blocos.join('\n\n');
  const ip = d.evidence?.customer_purchase_ip;
  if (typeof ip === 'string' && ip.trim()) ev.customer_purchase_ip = ip.trim();

  if (rebuttal) ev.cancellation_rebuttal = rebuttal;

  // Defesa final: só campos de texto da lista, sem travessão, com teto.
  const saida: Record<string, string> = {};
  for (const campo of CAMPOS_TEXTO) {
    const v = ev[campo];
    if (typeof v === 'string' && v.trim()) saida[campo] = cortar(limpa(v));
  }
  return saida;
}

// ── 3. prévia sem dado pessoal ───────────────────────────────────────────────

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Forma como o valor aparece dentro de um JSON serializado. */
const naJson = (x: string) => JSON.stringify(x).slice(1, -1);

/**
 * Tira o dado pessoal de TODA a resposta da prévia, inclusive de dentro dos
 * textos: troca os valores conhecidos (da charge, da disputa e do ctx) no JSON
 * serializado. e-mail vira a***@dominio, nome fica só o primeiro, CNPJ só com os
 * 2 últimos dígitos, IP sai, final do cartão vira ****. A evidência que vai para
 * a Stripe NUNCA passa por aqui.
 */
export function mascararPrevia<T>(obj: T, d: any, charge: any, ctx: CtxDefesa): T {
  let json = JSON.stringify(obj);
  const trocas: Array<[string, string]> = [];

  const emails = new Set<string>();
  for (const e of [charge?.billing_details?.email, d?.evidence?.customer_email_address, ctx.conta?.email]) {
    if (typeof e === 'string' && e.includes('@')) emails.add(e.trim());
  }
  for (const e of emails) {
    const [local, dominio] = e.split('@');
    trocas.push([e, `${(local ?? '').slice(0, 1)}***@${dominio}`]);
  }

  const nomes = new Set<string>();
  for (const n of [charge?.billing_details?.name, d?.evidence?.customer_name]) {
    if (typeof n === 'string' && n.trim()) nomes.add(n.trim());
  }
  for (const n of nomes) trocas.push([n, n.split(/\s+/)[0]!]);

  const cnpj = ctx.empresa?.cnpj;
  if (typeof cnpj === 'string' && cnpj.replace(/\D/g, '').length >= 2) {
    const dig = cnpj.replace(/\D/g, '');
    const mascara = `**.***.***/****-${dig.slice(-2)}`;
    trocas.push([cnpj.trim(), mascara]);
    if (dig !== cnpj.trim()) trocas.push([dig, mascara]);
  }

  // Razão social de MEI costuma levar o nome completo e o CPF: fica só a primeira palavra.
  const razao = ctx.empresa?.nome;
  if (typeof razao === 'string' && razao.trim()) trocas.push([razao.trim(), razao.trim().split(/\s+/)[0]!]);
  const cidade = ctx.empresa?.cidade;
  if (typeof cidade === 'string' && cidade.trim()) trocas.push([cidade.trim(), '[cidade removida]']);

  const ip = d?.evidence?.customer_purchase_ip;
  if (typeof ip === 'string' && ip.trim()) trocas.push([ip.trim(), '[IP removido]']);

  const last4 = charge?.payment_method_details?.card?.last4;

  // Mais longos primeiro: o nome completo antes de qualquer pedaço dele.
  trocas.sort((a, b) => b[0].length - a[0].length);
  for (const [de, para] of trocas) {
    json = json.replace(new RegExp(escRe(naJson(de)), 'gi'), () => naJson(para));
  }
  if (typeof last4 === 'string' && last4) json = json.replace(new RegExp(`\\b${escRe(last4)}\\b`, 'g'), '****');

  // CPF solto em qualquer texto: 11 dígitos seguidos, ou no formato 000.000.000-00.
  // O CNPJ (14 dígitos, ou com pontuação própria) já foi trocado acima e não casa aqui.
  json = json
    .replace(/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, '***.***.***-**')
    .replace(/(?<!\d)\d{11}(?!\d)/g, '***********');

  const out = JSON.parse(json);
  // O IP também sai como campo, não só de dentro dos textos.
  if (out && typeof out === 'object' && out.evidencia && typeof out.evidencia === 'object') delete out.evidencia.customer_purchase_ip;
  return out as T;
}
