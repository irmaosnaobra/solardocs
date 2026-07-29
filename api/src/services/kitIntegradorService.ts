// ═══════════════════════════════════════════════════════════════════════════
// Kit de Fechamento do Integrador — a PONTE entre a isca de R$27 e a plataforma.
//
// Mecânica: o integrador compra o kit na Kiwify → este service cria a conta no
// SolarDoc (pendente, sem senha) → o comprador define a senha e consome o
// material DENTRO da plataforma (/materiais) → vê o gerador de documentos
// funcionando todo dia → assina o VIP.
//
// O que este arquivo NÃO faz: rota nova. O webhook da Kiwify que já existe
// (POST /webhook/kiwify) roteia pra cá quando o produto é do universo do kit —
// assim o Thiago não precisa configurar nada além do produto na Kiwify.
//
// Idempotência: kit_pedidos.order_id é UNIQUE. Reentrega da Kiwify não duplica
// conta, não reenvia e-mail e não estende trial (trial_vip_ate só é gravado uma
// vez por pedido; a concessão só roda quando o pedido é NOVO e está pago).
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { sendKitAcessoEmail, sendOpsAlert } from '../utils/mailer';

/** Dias de VIP concedidos por quem leva o order bump. */
export const KIT_BUMP_TRIAL_DIAS = 30;

/** Itens que o comprador pode ter. `kit` = produto principal.
 *  Só existe UM bump: 30 dias de VIP. O "Kit de Prospecção" que era o bump 2
 *  virou o módulo 5 do curso (já está incluso nos R$27) — vendê-lo à parte seria
 *  cobrar duas vezes pela mesma coisa. */
export type ItemKit = 'kit' | 'bump_vip';

// ── Identificação do produto ────────────────────────────────────────────────
// Preferência: IDs de produto da Kiwify via env (exato, à prova de renomeação).
// Fallback: regex no nome do produto — funciona no dia 1, antes de alguém
// preencher env var nenhuma. É de propósito: o pior cenário é o webhook chegar
// e o comprador ficar sem acesso porque faltou configuração.
const idsDoEnv = (nome: string): string[] =>
  (process.env[nome] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const RE_KIT = /kit\s*(de\s*)?fechamento|fechamento\s*(do\s*)?integrador/i;
// 'solar\s*doc' aceita "SolarDoc VIP" e "Solar Doc VIP" — o nome é digitado à
// mão no painel da Kiwify, e um espaço a mais deixaria o comprador sem o trial.
const RE_BUMP_VIP = /30\s*dias.*vip|vip.*30\s*dias|solar\s*doc\s*vip|acesso\s*vip|vip\s*30/i;

/** Classifica o produto de um evento da Kiwify. null = não é do kit. */
export function classificarProdutoKit(
  productName: string | null | undefined,
  productId: string | null | undefined,
): ItemKit | null {
  const id = (productId || '').trim();
  if (id) {
    if (idsDoEnv('KIT_KIWIFY_PRODUCT_IDS').includes(id)) return 'kit';
    if (idsDoEnv('KIT_KIWIFY_BUMP_VIP_IDS').includes(id)) return 'bump_vip';
  }
  const nome = (productName || '').trim();
  if (!nome) return null;
  if (RE_BUMP_VIP.test(nome)) return 'bump_vip';
  if (RE_KIT.test(nome)) return 'kit';
  return null;
}

// ── Entrada normalizada (o webhook faz o parse, este service faz a regra) ────
export type EventoKit = {
  orderId: string | null;
  email: string;
  nome: string | null;
  telefone: string | null;
  produto: string;
  item: ItemKit;
  /** 'paid' | 'refunded' | 'waiting_payment' | … (já normalizado pelo webhook) */
  status: string | null;
  valorCentavos: number | null;
  utm: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
  };
  /** Código do checkout usado (Kiwify manda em `checkout_link`). */
  checkoutLink?: string | null;
  /** Oferta do produto (Kiwify manda em `Product.product_offer_id`). */
  ofertaId?: string | null;
  payload: Record<string, unknown>;
};

export type ResultadoKit = {
  ok: boolean;
  acao: 'ignorado' | 'registrado' | 'acesso_liberado' | 'ja_processado';
  userId?: string;
  contaCriada?: boolean;
  trialVip?: boolean;
  detalhe?: string;
};

const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

/**
 * Processa um evento de compra do kit: grava o pedido, cria/vincula a conta,
 * concede o trial VIP do bump e dispara o e-mail de acesso.
 */
export async function processarEventoKit(evt: EventoKit): Promise<ResultadoKit> {
  const email = evt.email.toLowerCase().trim();
  if (!email) return { ok: false, acao: 'ignorado', detalhe: 'sem email' };

  // Só libera acesso em pedido PAGO. Pix aguardando/abandono é só registro —
  // a recuperação desses casos é do fluxo de checkout, não daqui.
  const pago = evt.status === 'paid';

  // 1) Pedido novo? (idempotência por order_id)
  type PedidoExistente = {
    id: string; user_id: string | null; trial_vip_ate: string | null;
    status: string; acesso_email_em: string | null;
  };
  let pedidoExistente: PedidoExistente | null = null;
  if (evt.orderId) {
    const { data } = await supabase
      .from('kit_pedidos')
      .select('id, user_id, trial_vip_ate, status, acesso_email_em')
      .eq('order_id', evt.orderId)
      .maybeSingle();
    pedidoExistente = (data as unknown as PedidoExistente) ?? null;
  }

  const utmCols = evt.utm.utm_campaign
    ? {
        utm_source: evt.utm.utm_source || null,
        utm_medium: evt.utm.utm_medium || null,
        utm_campaign: evt.utm.utm_campaign,
        utm_content: evt.utm.utm_content || null,
        utm_term: evt.utm.utm_term || null,
      }
    : {};

  const linha = {
    order_id: evt.orderId || `sem-order-${crypto.randomUUID()}`,
    email,
    nome: evt.nome,
    telefone: evt.telefone,
    produto: evt.produto,
    itens: [evt.item],
    bump_vip: evt.item === 'bump_vip',
    bump_prospeccao: false, // coluna legada: o bump de prospecção deixou de existir
    valor: evt.valorCentavos != null ? evt.valorCentavos / 100 : 0,
    status: evt.status || 'unknown',
    payload: evt.payload,
    atualizado_em: new Date().toISOString(),
    // Qual checkout/oferta gerou a venda. É o que separa o link da LP do link
    // sem order bump (o da base própria) sem depender de env var configurada.
    checkout_link: evt.checkoutLink || null,
    oferta_id: evt.ofertaId || null,
    ...utmCols,
  };

  const { data: pedido, error: upErr } = await supabase
    .from('kit_pedidos')
    .upsert(linha, { onConflict: 'order_id' })
    .select('id, user_id, trial_vip_ate')
    .single();

  if (upErr) {
    console.error('[kit] upsert kit_pedidos falhou:', upErr);
    return { ok: false, acao: 'ignorado', detalhe: 'falha ao gravar pedido' };
  }

  if (!pago) {
    // Reembolso/chargeback: o material se tranca sozinho (acessoDoUsuario só olha
    // pedido 'paid'), mas o trial do bump continuaria rodando 30 dias. Limpa o
    // carimbo — quem tiver assinatura de verdade é restaurado pelo stripeSync.
    const revogar = /refund|chargeback/.test(String(evt.status));
    if (revogar && pedidoExistente?.trial_vip_ate && pedidoExistente.user_id) {
      await supabase
        .from('users')
        .update({ pack_trial_until: null })
        .eq('id', pedidoExistente.user_id)
        .gt('pack_trial_until', new Date().toISOString());
      console.info(`[kit] trial revogado por ${evt.status} · pedido ${evt.orderId}`);
    }
    return { ok: true, acao: 'registrado', detalhe: `status ${evt.status}` };
  }

  // 2) Conta: cria pendente (sem senha) ou vincula a existente.
  const { userId, contaCriada, resetUrl, jaEraMembro } = await garantirConta({
    email,
    nome: evt.nome,
    telefone: evt.telefone,
    utm: evt.utm,
  });

  if (!userId) {
    return { ok: false, acao: 'registrado', detalhe: 'não consegui criar/achar a conta' };
  }

  // 3) Bump do VIP: 30 dias de acesso ilimitado. Só concede uma vez por pedido.
  let trialVip = false;
  let bumpAplicado: boolean | null = null;
  const jaConcedeuNessePedido = !!pedidoExistente?.trial_vip_ate;
  if (evt.item === 'bump_vip' && !jaConcedeuNessePedido) {
    const r = await concederTrialVip(userId);
    trialVip = r.aplicado;
    bumpAplicado = r.aplicado;
    // Assinante que compra o bump PAGA E NÃO RECEBE: o código se recusa (com
    // razão) a mexer num plano pago, e 30 dias de VIP em cima de quem já é VIP
    // não é entrega nenhuma. Não dá pra desfazer a cobrança daqui — então vira
    // aviso pro dono resolver (reembolso ou crédito) em vez de sumir no log.
    if (r.motivo === 'ja_assinante') {
      console.warn(`[kit] bump comprado por assinante ${email} — nada a conceder (pedido ${evt.orderId})`);
      sendOpsAlert(
        'Kit: assinante comprou o bump de 30 dias',
        `${email} comprou o bump "SolarDoc VIP" (pedido ${evt.orderId}) mas já é assinante ${r.planoAtual}.\n\n` +
        `Ele pagou e não recebeu nada — o sistema não rebaixa nem duplica plano pago.\n` +
        `Resolva na Kiwify: reembolso do bump, ou crédito de um mês.\n\n` +
        `Pra não repetir: mande a base própria pro checkout SEM order bump.`,
      ).catch(() => {});
    }
  }

  // 4) E-mail de acesso — o gate é o CARIMBO, não "o pedido é novo". No Pix a
  //    Kiwify manda dois webhooks (waiting_payment e depois paid): quando o pago
  //    chega, o pedido JÁ existe. Gatear por "pedido novo" deixaria quem paga no
  //    Pix — 80% da receita — sem receber o link de acesso. Bump em pedido
  //    separado também não dispara e-mail (só o produto principal manda).
  const jaMandouEmail = !!pedidoExistente?.acesso_email_em;
  let emailEnviadoAgora = false;
  if (!jaMandouEmail && evt.item === 'kit') {
    try {
      await sendKitAcessoEmail({
        to: email,
        nome: evt.nome,
        resetUrl,
        comVip: trialVip,
        dias: KIT_BUMP_TRIAL_DIAS,
      });
      emailEnviadoAgora = true;
    } catch (err) {
      // Não carimba: a próxima reentrega da Kiwify tenta de novo.
      console.error('[kit] e-mail de acesso falhou (acesso já está liberado):', err);
    }
  }

  // Segmento: derivado de QUEM a pessoa era antes de comprar, não de config.
  // 'membro' = já tinha conta com senha (base própria comprando o curso);
  // 'lp'     = conta nova vinda de campanha (tem utm_campaign);
  // 'direto' = conta nova sem rastro de campanha (orgânico, indicação, WhatsApp).
  // Só carimba na PRIMEIRA vez. Numa reentrega da Kiwify a conta já existe com
  // senha (o comprador definiu), então jaEraMembro viria true e o pedido de um
  // comprador NOVO seria reclassificado como 'membro' — poluindo o funil que
  // decide se a mídia se paga.
  const { data: pedidoAtual } = await supabase
    .from('kit_pedidos')
    .select('segmento')
    .eq('id', pedido.id)
    .maybeSingle();
  const segmentoJaGravado = (pedidoAtual as { segmento?: string | null } | null)?.segmento;
  const segmento = segmentoJaGravado
    || (jaEraMembro ? 'membro' : evt.utm.utm_campaign ? 'lp' : 'direto');

  await supabase
    .from('kit_pedidos')
    .update({
      user_id: userId,
      conta_criada: contaCriada,
      segmento,
      ...(bumpAplicado !== null ? { bump_aplicado: bumpAplicado } : {}),
      ...(trialVip
        ? { trial_vip_ate: new Date(Date.now() + KIT_BUMP_TRIAL_DIAS * 86400_000).toISOString() }
        : {}),
      ...(emailEnviadoAgora ? { acesso_email_em: new Date().toISOString() } : {}),
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', pedido.id);

  // 'ja_processado' só quando o pedido JÁ estava pago antes — reentrega pura.
  const jaEstavaPago = pedidoExistente?.status === 'paid';

  return {
    ok: true,
    acao: jaEstavaPago ? 'ja_processado' : 'acesso_liberado',
    userId,
    contaCriada,
    trialVip,
  };
}

// ── Conta ───────────────────────────────────────────────────────────────────
// Espelha o fluxo "100% cadastro" do webhook do Stripe (paymentsController):
// conta criada com password_hash null + reset_token, e o cliente define a senha
// pelo link. authController.register detecta password_hash null e ATIVA a conta.
async function garantirConta(opts: {
  email: string;
  nome: string | null;
  telefone: string | null;
  utm: EventoKit['utm'];
}): Promise<{ userId: string | null; contaCriada: boolean; resetUrl: string; jaEraMembro: boolean }> {
  const { email } = opts;

  const { data: existente } = await supabase
    .from('users')
    .select('id, password_hash')
    .eq('email', email)
    .maybeSingle();

  // Já tem conta (é assinante, ou comprou o kit antes): não mexe em plano nem
  // em senha. Só devolve o link de login.
  // jaEraMembro olha password_hash, não "a conta existe": conta PENDENTE (sem
  // senha) é criada pelo próprio webhook, então usá-la como sinal marcaria
  // comprador novo como membro antigo quando o bump chega antes do kit.
  if (existente?.id) {
    return {
      userId: existente.id,
      contaCriada: false,
      resetUrl: `${DASHBOARD_URL}/auth`,
      jaEraMembro: existente.password_hash !== null,
    };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 7 * 86400_000).toISOString();
  const telefone = (opts.telefone || '').replace(/\D/g, '') || null;

  const attr: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const) {
    const v = opts.utm[k];
    if (typeof v === 'string' && v.trim()) attr[k] = v.trim();
  }
  if (Object.keys(attr).length) attr.attribution_captured_at = new Date().toISOString();

  const { data: criado, error } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: null, // conta PENDENTE — ativa quando o cliente definir a senha
      nome: opts.nome,
      plano: 'free',
      limite_documentos: 10,
      documentos_usados: 0,
      whatsapp: telefone,
      billing_status: 'active',
      reset_token: token,
      reset_token_expires: expira,
      // Origem: é isso que faz o funil do kit aparecer separado no /admin.
      utm_source: attr.utm_source || 'kiwify',
      utm_medium: attr.utm_medium || 'isca-integrador',
      ...attr,
      // Marcador DURÁVEL: utm_source acima é sobrescrito pelo ...attr quando a
      // pessoa vem de anúncio, e aí some justo o rastro de quem veio pela isca.
      origem_aquisicao: 'kit-integrador',
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = corrida (o /register criou a conta no meio do caminho). Busca de novo.
    if ((error as { code?: string }).code === '23505') {
      const { data: agora } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
      return { userId: agora?.id ?? null, contaCriada: false, resetUrl: `${DASHBOARD_URL}/auth`, jaEraMembro: false };
    }
    console.error('[kit] criação de conta falhou:', error);
    return { userId: null, contaCriada: false, resetUrl: `${DASHBOARD_URL}/auth`, jaEraMembro: false };
  }

  return {
    userId: criado.id,
    contaCriada: true,
    resetUrl: `${DASHBOARD_URL}/auth?mode=redefinir&token=${token}`,
    jaEraMembro: false,
  };
}

// ── Trial VIP do bump ───────────────────────────────────────────────────────
// pack_trial_until já é respeitado pelo stripeSyncService (não rebaixa enquanto
// o carimbo estiver no futuro; limpa sozinho quando vence). Aqui só carimbamos.
type ResultadoTrial = {
  aplicado: boolean;
  motivo: 'ok' | 'ja_assinante' | 'erro';
  planoAtual?: string;
};

async function concederTrialVip(userId: string): Promise<ResultadoTrial> {
  const ate = new Date(Date.now() + KIT_BUMP_TRIAL_DIAS * 86400_000).toISOString();

  const { data: atual } = await supabase
    .from('users')
    .select('plano, pack_trial_until')
    .eq('id', userId)
    .maybeSingle();

  // Já é assinante pagante: não mexe (não faz sentido "dar" o que ele já paga).
  // O chamador transforma isso em alerta — a pessoa pagou por nada.
  if (atual?.plano === 'pro' || atual?.plano === 'ilimitado') {
    return { aplicado: false, motivo: 'ja_assinante', planoAtual: atual.plano };
  }

  const { error } = await supabase
    .from('users')
    .update({
      plano: 'ilimitado',
      limite_documentos: 999999,
      pack_trial_until: ate,
    })
    .eq('id', userId);

  if (error) {
    console.error('[kit] concessão de trial VIP falhou:', error);
    return { aplicado: false, motivo: 'erro' };
  }
  return { aplicado: true, motivo: 'ok' };
}

// ── Leitura para a plataforma ───────────────────────────────────────────────
export type AcessoKit = {
  temKit: boolean;
  itens: ItemKit[];
  compradoEm: string | null;
  trialVipAte: string | null;
};

/** O que este usuário comprou do kit (usado pela aba /materiais). */
export async function acessoDoUsuario(userId: string, email: string): Promise<AcessoKit> {
  // Duas queries em vez de .or(): endereço com '+' (gmail+tag) quebra dentro do
  // filtro do PostgREST — o '+' vira espaço e o comprador some da própria compra.
  const colunas = 'order_id, itens, status, criado_em, trial_vip_ate, user_id, email';
  const [porUser, porEmail] = await Promise.all([
    supabase.from('kit_pedidos').select(colunas).eq('user_id', userId).eq('status', 'paid'),
    supabase.from('kit_pedidos').select(colunas).eq('email', email.toLowerCase()).eq('status', 'paid'),
  ]);

  type Linha = { order_id: string; itens: ItemKit[]; criado_em: string; trial_vip_ate: string | null; email: string };
  const vistos = new Set<string>();
  const linhas = ([...(porUser.data || []), ...(porEmail.data || [])] as unknown as Linha[])
    .filter((l) => {
      if (vistos.has(l.order_id)) return false;   // a mesma linha vem nas duas queries
      vistos.add(l.order_id);
      return true;
    })
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  if (!linhas.length) return { temKit: false, itens: [], compradoEm: null, trialVipAte: null };

  const itens = Array.from(new Set(linhas.flatMap((l) => l.itens || []))) as ItemKit[];
  const trial = linhas.map((l) => l.trial_vip_ate).filter(Boolean).sort().pop() || null;

  return {
    temKit: itens.includes('kit'),
    itens,
    compradoEm: linhas[0].criado_em,
    trialVipAte: trial,
  };
}
