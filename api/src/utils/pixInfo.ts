// ─────────────────────────────────────────────────────────────────────────────
// COMO SE PAGA POR PIX. Dois trilhos, nesta ordem:
//
// 1. CHECKOUT DA KIWIFY (preferido, 14/08/2026) — link único, o Pix é nativo lá
//    dentro (QR na hora), e o webhook /webhook/kiwify libera o acesso sozinho
//    quando o pagamento cai. Ninguém manda comprovante, ninguém confere nada.
//    Nasceu do abandono de checkout da Stripe: a maioria paga no Pix, e o
//    caminho manual custava dias de espera (o PDF do Sicoob nem é lido pela
//    liberação automática — caso Junior, 11/08, 2 dias sem acesso).
//
// 2. COPIA-E-COLA MANUAL (fallback) — dados bancários + comprovante no WhatsApp
//    (34998165040) → o atendimento confere e libera 1 mês (bumpa
//    users.plano_expira_em; o guard no stripeSyncService não rebaixa).
//    Continua aqui porque link não configurado NÃO pode virar "cliente sem
//    caminho pra pagar" — mas quem consome avisa alto quando cai nele.
//
// O lembrete mensal (pixVipReminderService) avisa antes de vencer nos dois.
// ─────────────────────────────────────────────────────────────────────────────

export const PIX_DADOS = {
  titular:  'Aioros Group',
  cnpj:     '63.636.043/0001-88',
  banco:    'Sicredi (748)',
  agencia:  '0333',
  conta:    '25506-3',
  chave:    '63636043000188',      // chave Pix = CNPJ (só dígitos)
  cidade:   'UBERLANDIA',          // ⚠️ CONFIRMAR cidade real do recebedor — vai no BR Code (campo 60, ≤15 ASCII). Cosmético p/ roteamento, mas parte do padrão.
  whatsapp: '34998165040',         // destino do comprovante (Giovanna / atendimento)
  whatsappLabel: '(34) 99816-5040',
};

/** Um mês de acesso completo pago por Pix. Mesmo valor do copia-e-cola e do que
 *  o comprovante automático já reconhece (PLANO_POR_VALOR[67] = ilimitado). */
export const PIX_MES_VALOR = 67;

/**
 * Link do checkout da Kiwify onde o Pix é nativo e a liberação é automática.
 * Lido do ambiente A CADA CHAMADA de propósito: a env costuma entrar na Vercel
 * depois do deploy, e cachear no import deixaria a instância quente servindo o
 * caminho manual pra sempre.
 *
 * O produto do outro lado precisa cair em `mes_pix` no kitIntegradorService —
 * ou seja, ter "1 mês"/"mês" no nome (NÃO "30 dias", que é a entrada de R$19 e
 * vem com o curso junto). O jeito à prova de renomeação é pôr o product_id em
 * KIT_KIWIFY_MES_PIX_IDS.
 */
export function pixCheckoutUrl(): string {
  return (process.env.SOLARDOC_PIX_CHECKOUT_URL || '').trim();
}

/** Estamos no trilho automático (Kiwify) ou no manual (comprovante)? */
export const pixAutomatico = (): boolean => !!pixCheckoutUrl();

// Bloco do Pix pra WhatsApp (com *negrito* do WhatsApp).
// No trilho manual não vai valor de propósito: o atendimento confirma no 1x1
// (evita errar VIP R$67 vs VIP PROMO R$49). No trilho da Kiwify o valor está na
// própria página, então também não se repete aqui.
export function pixBlocoWhatsApp(): string {
  const url = pixCheckoutUrl();
  if (url) {
    return [
      '💠 *Prefere pagar no Pix?*',
      '',
      `É por aqui: ${url}`,
      '',
      'Escolhe *Pix* na página — o QR code aparece na hora e seu acesso libera sozinho assim que o pagamento cai. Não precisa mandar comprovante pra ninguém. 🙌',
    ].join('\n');
  }
  return [
    '💠 *Prefere pagar por Pix?*',
    '',
    `🔑 Chave Pix (CNPJ): *${PIX_DADOS.chave}*`,
    `${PIX_DADOS.titular} · ${PIX_DADOS.banco} · Ag ${PIX_DADOS.agencia} · Conta ${PIX_DADOS.conta}`,
    '',
    'Me manda o *comprovante aqui mesmo neste número* que eu confirmo o valor e libero seu acesso na hora. 🙌',
  ].join('\n');
}

// Bloco do Pix pra email (HTML).
export function pixBlocoEmailHtml(): string {
  const url = pixCheckoutUrl();
  if (url) {
    return `
    <div style="margin:22px 0 6px;background:#0f231a;border-left:4px solid #10b981;border-radius:0 10px 10px 0;padding:16px 20px;">
      <p style="margin:0 0 6px;color:#34d399;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Prefere pagar no Pix?</p>
      <p style="margin:0 0 14px;color:#e2e8f0;font-size:14.5px;line-height:1.7;">Dá pra entrar pagando no Pix, sem cartão. O QR code aparece na hora e <strong style="color:#f8fafc;">seu acesso libera sozinho</strong> assim que o pagamento cai — não precisa mandar comprovante.</p>
      <p style="margin:0;text-align:center;">
        <a href="${url}" style="display:inline-block;background:#10b981;color:#04150e;font-weight:900;font-size:15px;padding:14px 32px;border-radius:11px;text-decoration:none;">Pagar no Pix →</a>
      </p>
    </div>`;
  }
  return `
    <div style="margin:22px 0 6px;background:#0f231a;border-left:4px solid #10b981;border-radius:0 10px 10px 0;padding:16px 20px;">
      <p style="margin:0 0 6px;color:#34d399;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Prefere pagar por Pix?</p>
      <p style="margin:0 0 4px;color:#e2e8f0;font-size:14.5px;line-height:1.7;">Chave Pix (CNPJ): <strong style="color:#f8fafc;">${PIX_DADOS.chave}</strong></p>
      <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.6;">${PIX_DADOS.titular} · ${PIX_DADOS.banco} · Ag ${PIX_DADOS.agencia} · Conta ${PIX_DADOS.conta}</p>
      <p style="margin:0;color:#cbd5e1;font-size:13.5px;line-height:1.6;">Depois é só mandar o <strong style="color:#f8fafc;">comprovante no WhatsApp ${PIX_DADOS.whatsappLabel}</strong> que a gente confirma o valor e libera seu acesso.</p>
    </div>`;
}

/** Bolhas de WhatsApp do caminho automático (Kiwify). Vazio = não configurado. */
export function bolhasPixCheckout(): string[] {
  const url = pixCheckoutUrl();
  if (!url) return [];
  return [
    `Show! É por aqui ó: ${url}`,
    'Escolhe *Pix* na página que o QR aparece na hora.',
    'Assim que o pagamento cair seu acesso libera sozinho — não precisa me mandar comprovante 🙌',
  ];
}
