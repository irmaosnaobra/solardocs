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
import { sendKitAcessoEmail, sendFerramentaAcessoEmail, sendMesPixAcessoEmail, sendOpsAlert } from '../utils/mailer';
import { liberarOffGrid, OFFGRID_PRODUTO_REGEX, OFFGRID_ADDON_PRECO } from './offgrid/acesso';
import { concederAcesso } from './produtos/acessos';

/** Dias de VIP concedidos por quem leva o order bump. */
export const KIT_BUMP_TRIAL_DIAS = 30;

/** Itens que o comprador pode ter. `kit` = produto principal.
 *  O "Kit de Prospecção" que era o bump 2 virou o módulo 5 do curso (já está
 *  incluso nos R$27) — vendê-lo à parte seria cobrar duas vezes pela mesma coisa.
 *
 *  Dois bumps de acesso convivem, e a diferença NÃO é cosmética:
 *  - `bump_vip`    — trial de 30 dias (legado). Carimba pack_trial_until.
 *  - `entrada_30d` — "SolarDoc - 30 dias", R$19 PAGO. Acesso completo comprado,
 *                    não trial. Carimba plano_expira_em (ver concederEntrada30Dias).
 *  - `mes_pix`     — "SolarDoc — 1 mês", R$67. É o trilho de Pix da recuperação de
 *                    checkout abandonado (a maioria não tem/não passa cartão).
 *                    MESMO acesso da entrada, SEM o curso: o Kit de Fechamento é
 *                    produto pago à parte, e dar de brinde aqui repetiria o erro
 *                    que a nota do pixRecoveryAgentService já registra. */
export type ItemKit = 'kit' | 'bump_vip' | 'entrada_30d' | 'mes_pix' | 'offgrid' | 'precificacao' | 'inventario';

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
// "SolarDoc - 30 dias" (R$19) — o bump ATUAL do checkout do kit. Em 01/ago/2026 o
// produto foi renomeado na Kiwify e perdeu o "VIP": a RE_BUMP_VIP parou de casar,
// classificarProdutoKit passou a devolver null e o pedido pago sumia sem virar
// acesso (1 comprador atingido, grilosolar@gmail.com, corrigido na mão).
// Exige 'solardoc' COLADO em '30 dias' (só separadores no meio) pra não engolir
// produto de outro funil que por acaso venda "30 dias".
const RE_ENTRADA_30D = /solar\s*doc\s*[-–—:]*\s*30\s*dias/i;
// "SolarDoc — 1 mês" (R$67), o checkout de Pix da recuperação. Casa por MÊS, nunca
// por "30 dias": a entrada de R$19 se chama "30 dias" e vem com o curso junto — um
// nome ambíguo aqui entregaria o Kit de Fechamento de graça pra quem pagou só o mês.
// Por isso também é testada ANTES das outras duas (mesma precedência que já protege
// o bump legado do VIP).
const RE_MES_PIX = /solar\s*doc[^|]*\b(1|um)\s*m[eê]s|m[eê]s\s*avulso/i;

/** Classifica o produto de um evento da Kiwify. null = não é do kit. */
export function classificarProdutoKit(
  productName: string | null | undefined,
  productId: string | null | undefined,
): ItemKit | null {
  const id = (productId || '').trim();
  if (id) {
    if (idsDoEnv('KIT_KIWIFY_PRODUCT_IDS').includes(id)) return 'kit';
    if (idsDoEnv('KIT_KIWIFY_BUMP_VIP_IDS').includes(id)) return 'bump_vip';
    if (idsDoEnv('KIT_KIWIFY_ENTRADA_30D_IDS').includes(id)) return 'entrada_30d';
    if (idsDoEnv('KIT_KIWIFY_MES_PIX_IDS').includes(id)) return 'mes_pix';
    if (idsDoEnv('OFFGRID_KIWIFY_PRODUCT_IDS').includes(id)) return 'offgrid';
    if (idsDoEnv('PRECIFICACAO_KIWIFY_PRODUCT_IDS').includes(id)) return 'precificacao';
    if (idsDoEnv('INVENTARIO_KIWIFY_PRODUCT_IDS').includes(id)) return 'inventario';
  }
  const nome = (productName || '').trim();
  if (!nome) return null;
  // Mês avulso primeiro: é o único que NÃO leva curso junto, então perder a
  // classificação dele custa produto entregue de graça.
  if (RE_MES_PIX.test(nome)) return 'mes_pix';
  // VIP depois: "SolarDoc VIP — 30 dias" é o bump legado e não pode cair na
  // entrada (que é compra paga, com colunas diferentes).
  if (RE_BUMP_VIP.test(nome)) return 'bump_vip';
  if (RE_ENTRADA_30D.test(nome)) return 'entrada_30d';
  // Ferramentas antes do kit: "Kit Off-Grid" casaria com a RE_KIT e o comprador
  // receberia o material do curso em vez da ferramenta que pagou.
  if (OFFGRID_PRODUTO_REGEX.test(nome)) return 'offgrid';
  // Os nomes de VENDA na Kiwify não são os nomes de dentro da plataforma: o
  // Thiago cadastrou "Calculadora Solar" (R$67) e "Inventário Empresarial"
  // (R$67), que é como o tráfego frio procura. "Calculadora Solar" não casava
  // com NADA e o comprador ficaria pago e sem acesso — mesmo buraco que o bump
  // renomeado abriu em 01/ago. Os dois nomes valem, o de dentro e o de fora.
  if (/precifica[çc][aã]o\s*(profissional|pro)|calculadora\s*solar/i.test(nome)) return 'precificacao';
  // `empresa` sozinho já pegava "Empresarial" por prefixo, mas por acidente:
  // escrito assim, quem mexer na regra vê que os dois nomes são pra valer.
  if (/invent[áa]rio\s*(da\s*)?empresa(rial)?/i.test(nome)) return 'inventario';
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

  // Abandono de carrinho NÃO é pedido — e gravá-lo custou uma venda fantasma.
  // A Kiwify manda esse evento com payload ACHATADO onde `id` é a SESSÃO de
  // checkout, não o pedido: o upsert por order_id não acha a compra e cria linha
  // nova. Em 29/07 o abandono chegou 57min DEPOIS da venda paga do mesmo
  // comprador (mesmo checkout_link) e o painel passou a mostrar dois pedidos
  // para uma venda só. Ninguém lê 'abandoned' daqui — o material olha 'paid', o
  // Pix pendente olha 'waiting_payment', o /register olha 'paid'/'waiting_payment'
  // — e o payload cru fica no audit log do webhook, então o certo é não gravar.
  // (O abandono do LimpaPro é outra coisa: vive em limpapro_events, depois do
  // desvio do kit. Este return não passa por lá.)
  if (/abandon/i.test(String(evt.status || ''))) {
    console.info(`[kit] abandono de carrinho ignorado (não é pedido) · ${email}`);
    return { ok: true, acao: 'ignorado', detalhe: 'abandono de carrinho' };
  }

  // Só libera acesso em pedido PAGO. Pix aguardando é só registro — a
  // recuperação desses casos é do fluxo de checkout, não daqui.
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

  // Nunca REBAIXA um pedido que já está pago. A Kiwify pode reentregar o
  // 'waiting_payment' do Pix depois do 'paid' (entrega fora de ordem) e o upsert
  // trancaria o material de quem já pagou. Reembolso e chargeback continuam
  // passando — são estados finais de verdade e precisam revogar o acesso.
  const statusEntrada = evt.status || 'unknown';
  const statusGravado =
    pedidoExistente?.status === 'paid' && !/paid|refund|chargeback/.test(statusEntrada)
      ? 'paid'
      : statusEntrada;

  const linha = {
    order_id: evt.orderId || `sem-order-${crypto.randomUUID()}`,
    email,
    nome: evt.nome,
    telefone: evt.telefone,
    produto: evt.produto,
    itens: [evt.item],
    // Coluna do FUNIL: "este pedido foi o order bump do checkout do kit". Os dois
    // itens de acesso entram, senão a taxa de attach do bump ficaria zerada desde
    // que o produto virou "SolarDoc - 30 dias".
    bump_vip: evt.item === 'bump_vip' || evt.item === 'entrada_30d',
    bump_prospeccao: false, // coluna legada: o bump de prospecção deixou de existir
    valor: evt.valorCentavos != null ? evt.valorCentavos / 100 : 0,
    status: statusGravado,
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
      // Cada item carimba uma coluna diferente, então a revogação tem que bater
      // com a concessão: entrada_30d vive em plano_expira_em, o bump legado em
      // pack_trial_until. Zerar a coluna basta — o stripeSync rebaixa na sequência
      // (e restaura quem tiver assinatura de verdade).
      const coluna = evt.item === 'entrada_30d' || evt.item === 'mes_pix'
        ? 'plano_expira_em'
        : 'pack_trial_until';
      await supabase
        .from('users')
        .update({ [coluna]: null })
        .eq('id', pedidoExistente.user_id)
        .gt(coluna, new Date().toISOString());
      console.info(`[kit] acesso revogado por ${evt.status} (${coluna}) · pedido ${evt.orderId}`);
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

  // 3a) FERRAMENTA AVULSA: acesso vitalício, independente de plano. Não mexe em
  // assinatura — é compra separada, e por isso o assinante que compra também
  // recebe (ao contrário do bump de VIP, que colide com plano pago).
  const FERRAMENTAS: Record<string, string> = {
    offgrid: 'Dimensionamento Off-Grid',
    precificacao: 'Precificação Profissional',
    inventario: 'Inventário da Empresa',
  };
  if (FERRAMENTAS[evt.item]) {
    // Off-grid tem uma regra a mais (o crédito do primeiro pedido de kit), então
    // continua com a função dele; o resto é entitlement puro.
    const aplicou = evt.item === 'offgrid'
      ? await liberarOffGrid(userId, OFFGRID_ADDON_PRECO)
      : await concederAcesso({ userId, produto: evt.item, origem: 'compra', orderId: evt.orderId });
    if (!aplicou) {
      console.warn(`[kit] ${evt.item} já estava liberado pra ${email} (pedido ${evt.orderId})`);
    }

    // O E-MAIL É A COMPRA. Sem ele a pessoa pagou e não sabe onde entrar — o
    // caminho mais curto entre uma venda e um reembolso. Conta nova cai no link
    // de definir senha; quem já era da casa vai direto pro login, e os dois
    // aterrissam na loja, onde o que ele comprou está esperando.
    if (contaCriada || !jaEraMembro || resetUrl) {
      await sendFerramentaAcessoEmail({
        to: email,
        nome: evt.nome,
        produtoNome: FERRAMENTAS[evt.item],
        acessoUrl: resetUrl.includes('?') ? `${resetUrl}&next=/produtos` : `${resetUrl}?next=/produtos`,
        contaNova: contaCriada,
      }).catch((e) => {
        // Falha de e-mail não pode derrubar uma concessão que já foi gravada:
        // vira alerta pra operação mandar o acesso na mão.
        console.error('[kit] falha no e-mail de acesso da ferramenta', e);
        sendOpsAlert(
          `Compra de ${FERRAMENTAS[evt.item]} sem e-mail de acesso`,
          `<p>${email} comprou <strong>${FERRAMENTAS[evt.item]}</strong> (pedido ${evt.orderId}) e o acesso foi liberado, mas o e-mail não saiu.</p>
           <p>Mande o link na mão: <a href="${resetUrl}">${resetUrl}</a></p>`,
        ).catch(() => {});
      });
    }

    return {
      ok: true,
      acao: aplicou ? 'acesso_liberado' : 'ja_processado',
      userId,
      contaCriada,
      detalhe: `${FERRAMENTAS[evt.item]} ${aplicou ? 'liberado' : 'já estava liberado'}`,
    };
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

  // 3b) Entrada de 30 dias ("SolarDoc - 30 dias", R$19). NÃO é trial: é acesso
  //     completo COMPRADO, e por isso não passa por concederTrialVip.
  let acessoAte: Date | null = null;
  if (evt.item === 'entrada_30d' && !jaConcedeuNessePedido) {
    acessoAte = await concederEntrada30Dias(userId, email);
    if (acessoAte) bumpAplicado = true;
  }

  // 3c) MÊS AVULSO no Pix (R$67) — o trilho de quem abandonou o checkout da
  //     Stripe e não vai pagar no cartão. Mesmo acesso da entrada, SEM o curso.
  //     `bumpAplicado` fica INTOCADO de propósito: este pedido não é order bump
  //     de checkout nenhum, e a coluna alimenta a taxa de attach do kit no /admin.
  //     A idempotência não depende dela — quem carimba é `trial_vip_ate`, abaixo.
  if (evt.item === 'mes_pix' && !jaConcedeuNessePedido) {
    acessoAte = await concederMesPago(userId, email, { comCurso: false, rotulo: 'mês avulso (Pix)' });
  }

  // 4) E-mail de acesso — o gate é o CARIMBO, não "o pedido é novo". No Pix a
  //    Kiwify manda dois webhooks (waiting_payment e depois paid): quando o pago
  //    chega, o pedido JÁ existe. Gatear por "pedido novo" deixaria quem paga no
  //    Pix — 80% da receita — sem receber o link de acesso. Bump em pedido
  //    separado também não dispara e-mail (só o produto principal manda).
  // A entrada também manda, mas SÓ quando a conta acabou de nascer neste pedido:
  // é o caso de quem compra os 30 dias sem o kit (checkout próprio) e ficaria sem
  // nenhum link de acesso. No fluxo normal (bump em cima do kit) a conta já existe
  // quando a entrada chega, então contaCriada é false e quem manda é o kit — sem
  // e-mail duplicado.
  const jaMandouEmail = !!pedidoExistente?.acesso_email_em;
  let emailEnviadoAgora = false;

  // MÊS AVULSO: e-mail próprio, e SEMPRE (conta nova ou antiga). Ele não tem
  // material do kit pra anunciar — o que a pessoa precisa é saber que o acesso
  // está de pé e por onde entrar. E manda mesmo pra quem já tinha conta porque
  // este é o caminho de quem pagou no Pix sem sessão aberta: sem o e-mail, ele
  // pagou e fica esperando alguém responder no WhatsApp.
  if (!jaMandouEmail && evt.item === 'mes_pix') {
    try {
      await sendMesPixAcessoEmail({
        to: email,
        nome: evt.nome,
        acessoUrl: resetUrl,
        contaNova: contaCriada,
        ate: acessoAte,
      });
      emailEnviadoAgora = true;
    } catch (err) {
      console.error('[kit] e-mail do mês avulso falhou (acesso já está liberado):', err);
      sendOpsAlert(
        'Pix: mês liberado sem e-mail de acesso',
        `<p>${email} pagou o mês no Pix (pedido ${evt.orderId}) e o acesso foi liberado, mas o e-mail não saiu.</p>
         <p>Mande o link na mão: <a href="${resetUrl}">${resetUrl}</a></p>`,
      ).catch(() => {});
    }
  } else if (!jaMandouEmail && (evt.item === 'kit' || (evt.item === 'entrada_30d' && contaCriada))) {
    try {
      await sendKitAcessoEmail({
        to: email,
        nome: evt.nome,
        resetUrl,
        comVip: trialVip || acessoAte !== null,
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
      // trial_vip_ate é o carimbo de "este pedido já concedeu, até quando" — vale
      // para os dois bumps e é o que segura a idempotência (jaConcedeuNessePedido).
      ...(trialVip
        ? { trial_vip_ate: new Date(Date.now() + KIT_BUMP_TRIAL_DIAS * 86400_000).toISOString() }
        : acessoAte
          ? { trial_vip_ate: acessoAte.toISOString() }
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

// ── Entrada de 30 dias ("SolarDoc - 30 dias", R$19) ─────────────────────────
// Espelha `liberarAcessoPix` (pixComprovanteService.ts:145) — que é a função
// CANÔNICA de "acesso pago liberado" e trata o MESMO valor de R$19 quando o Pix
// vem manual pelo WhatsApp (PLANO_POR_VALOR[19] = ilimitado/999999). Duplicamos
// as colunas em vez de importar porque pixComprovanteService já importa daqui
// (concederCursoPorAssinatura) e o import de volta fecharia um ciclo.
//
// Por que plano_expira_em e NÃO pack_trial_until (que é o que o bump legado usa):
// stripeSyncService.ts:130-141 pega quem tem pack_trial_until vigente e FORÇA
// pro/90 — o comprador pagaria por acesso completo e acordaria no PRO na próxima
// rodada do sync. O ramo do plano_expira_em (linha 147) só faz `continue`, então
// o 'ilimitado' sobrevive. O vencimento continua automático: passada a data,
// pixAccessActive vira false, realPlano cai pra 'free' (linha 155) e o sync
// rebaixa sozinho.
const ENTRADA_30D_DIAS = 30;

/** A entrada de R$19 é "curso + 30 dias de plataforma". */
async function concederEntrada30Dias(userId: string, email: string): Promise<Date | null> {
  return concederMesPago(userId, email, { comCurso: true, rotulo: 'entrada de 30 dias' });
}

/**
 * Um mês pago de acesso completo. `comCurso` é a ÚNICA diferença entre a entrada
 * de R$19 (que vende o curso junto) e o mês avulso de R$67 do Pix — e é uma
 * diferença de produto, não de implementação: liberar o curso no mês avulso daria
 * de graça o que o Kit de Fechamento cobra.
 */
async function concederMesPago(
  userId: string,
  email: string,
  opts: { comCurso: boolean; rotulo: string },
): Promise<Date | null> {
  const ate = new Date(Date.now() + ENTRADA_30D_DIAS * 86400_000);

  const { data: atual } = await supabase
    .from('users')
    .select('plano_expira_em, billing_status')
    .eq('id', userId)
    .maybeSingle();

  // Já tem acesso pago em curso (renovação Pix, ou comprou a entrada duas vezes):
  // empilha em cima do que resta em vez de encurtar. Mesma regra do liberarAcessoPix.
  const statusAnterior = (atual as { billing_status?: string | null } | null)?.billing_status;
  const atualExpira = (atual as { plano_expira_em?: string | null } | null)?.plano_expira_em;
  const base = atualExpira && new Date(atualExpira).getTime() > Date.now()
    ? new Date(new Date(atualExpira).getTime() + ENTRADA_30D_DIAS * 86400_000)
    : ate;

  const { error } = await supabase
    .from('users')
    .update({
      plano: 'ilimitado',
      limite_documentos: 999999,
      documentos_usados: 0,
      billing_status: 'active',
      plano_expira_em: base.toISOString(),
    })
    .eq('id', userId);

  if (error) {
    console.error(`[kit] concessão da ${opts.rotulo} falhou:`, error);
    return null;
  }

  // O produto vendido é "curso + 30 dias de plataforma" (cursoEntradaBroadcast.ts:114).
  // Desde 30/jul/2026 o plano sozinho não abre mais o curso — quem abre é a linha
  // paga em kit_pedidos. Sem isto, quem leva só a entrada (sem o kit de R$27) paga
  // pelo curso e bate no cadeado.
  if (opts.comCurso) {
    try {
      await concederCursoPorAssinatura(userId, email);
    } catch (err) {
      console.error(`[kit] curso da ${opts.rotulo} falhou (acesso já liberado):`, err);
    }
  }

  // COBRANÇA DUPLA: quem estava em dunning e resolveu pagando aqui continua com a
  // assinatura de cartão falhando no Stripe — e o Smart Retries ainda pode cobrar.
  // Mesma regra do Pix manual (encerrarDunningPix, pixComprovanteService:213); o
  // import é dinâmico porque pixComprovanteService/dunningService já importam este
  // arquivo e o import estático fecharia um ciclo.
  //
  // Só no mês avulso (o trilho de Pix da recuperação). A entrada de R$19 é order
  // bump do checkout do kit, comprada por gente que está chegando — cancelar
  // assinatura por causa dela seria mexer num funil que ninguém pediu pra mexer.
  const trilhoDeRecuperacao = !opts.comCurso;
  if (trilhoDeRecuperacao && (statusAnterior === 'past_due' || statusAnterior === 'suspended')) {
    try {
      const { cancelStripeSubsForEmail } = await import('./dunningService');
      const n = await cancelStripeSubsForEmail(email);
      await supabase.from('users')
        .update({ past_due_since: null, dunning_last_day_sent: null })
        .eq('id', userId);
      console.info(`[kit] dunning encerrado por Pix (${email}): ${n} sub(s) de cartão canceladas`);
      if (n === 0) {
        // 0 = ou o cancel falhou, ou o e-mail não casou no Stripe. Nos dois casos o
        // cartão dele pode cobrar de novo — não dá pra fingir que deu certo.
        sendOpsAlert(
          'Pix reativou cliente em dunning, mas nenhuma assinatura foi cancelada',
          `<p>${email} pagou o mês no Pix estando em dunning, e não achei assinatura de cartão pra cancelar no Stripe.</p>
           <p>Confere na Stripe se o cartão dele não vai cobrar em dobro.</p>`,
        ).catch(() => {});
      }
    } catch (err) {
      console.error(`[kit] encerrar dunning por Pix falhou (${email}):`, err);
    }
  }

  console.info(`[kit] ${opts.rotulo} liberada · ${email} · até ${base.toISOString()}`);
  return base;
}

// ── Concessão do curso pela oferta "VIP com o curso junto" ──────────────────
// Desde que o plano deixou de liberar o curso sozinho (kitController), ser
// assinante não basta mais: o acesso é sempre uma linha PAGA em kit_pedidos.
// Quem entra pela oferta `vip_curso` — a que a Giovanna faz no WhatsApp e a que
// o e-mail da campanha aponta — foi PROMETIDO o curso, então precisa receber de
// fato. Sem isto ele paga os R$67, abre o curso e bate no cadeado.
//
// Por que gravar em kit_pedidos em vez de uma flag no user: é a MESMA fonte que
// a Kiwify alimenta, então `acessoDoUsuario` (e portanto /kit/meu-acesso)
// continua com uma regra só. De quebra, a campanha de e-mail já pula quem tem
// pedido pago — quem recebeu o curso para de ser convidado a comprá-lo.
//
// Idempotência de graça: order_id é UNIQUE e aqui ele é DERIVADO do userId, não
// aleatório. Webhook reentregue (at-least-once), upgrade repetido, ou o cliente
// cancelando e assinando de novo — tudo cai na mesma linha.
//
// Diferente de concederTrialVip: aquele se RECUSA a mexer em quem já é pagante
// (dar 30 dias de VIP a quem já paga não entrega nada). Aqui é o oposto — quem
// está pagando é exatamente quem tem que receber.
export async function concederCursoPorAssinatura(
  userId: string,
  email: string,
): Promise<{ concedido: boolean; jaTinha: boolean }> {
  const emailLc = (email || '').toLowerCase().trim();
  if (!userId || !emailLc) return { concedido: false, jaTinha: false };

  const orderId = `assinatura-vip-curso-${userId}`;

  const { data: existente } = await supabase
    .from('kit_pedidos')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();

  const { error } = await supabase.from('kit_pedidos').upsert(
    {
      order_id: orderId,
      email: emailLc,
      produto: 'Curso Kit de Fechamento (incluso na assinatura VIP)',
      itens: ['kit'] as ItemKit[],
      bump_vip: false,
      bump_prospeccao: false,
      // Receita ZERO: o dinheiro desta pessoa é a assinatura recorrente, que já
      // é contada pela Stripe. Somar R$27 aqui inventaria faturamento que não
      // existe no funil da isca.
      valor: 0,
      status: 'paid',
      user_id: userId,
      conta_criada: false,
      // Marcador que separa concessão de VENDA. O /kit-funil do admin filtra por
      // ele — sem isso, cada assinante entraria no funil da isca como comprador
      // e derrubaria a taxa de conversão da LP /kit.
      segmento: 'assinatura',
      payload: { origem: 'oferta_vip_curso' },
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'order_id' },
  );

  if (error) {
    console.error('[kit] concessão do curso por assinatura falhou:', error);
    return { concedido: false, jaTinha: !!existente };
  }

  if (!existente) {
    console.info(`[kit] curso concedido pela oferta vip_curso · ${emailLc}`);
  }
  return { concedido: true, jaTinha: !!existente };
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
