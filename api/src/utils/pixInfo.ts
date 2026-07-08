// ─────────────────────────────────────────────────────────────────────────────
// Dados bancários pra pagamento MANUAL por Pix — fallback quando o cartão falha.
// Fluxo: cartão recusado/abandonado → oferecemos o Pix → cliente paga e manda o
// COMPROVANTE no WhatsApp (34998165040) → o atendimento confere e libera 1 mês
// (bumpa users.plano_expira_em +1 mês; o guard no stripeSyncService não rebaixa).
// O lembrete mensal (pixVipReminderService) avisa antes de vencer.
// ─────────────────────────────────────────────────────────────────────────────

export const PIX_DADOS = {
  titular:  'Aioros Group',
  cnpj:     '63.636.043/0001-88',
  banco:    'Sicredi (748)',
  agencia:  '0333',
  conta:    '25506-3',
  chave:    '63636043000188',      // chave Pix = CNPJ (só dígitos)
  whatsapp: '34998165040',         // destino do comprovante (Giovanna / atendimento)
  whatsappLabel: '(34) 99816-5040',
};

// Bloco do Pix pra WhatsApp (com *negrito* do WhatsApp). Sem valor fixo de propósito:
// o atendimento confirma o valor no 1x1 (evita errar VIP R$67 vs VIP PROMO R$49).
export function pixBlocoWhatsApp(): string {
  return [
    '💠 *Prefere pagar por Pix?*',
    '',
    `🔑 Chave Pix (CNPJ): *${PIX_DADOS.chave}*`,
    `${PIX_DADOS.titular} · ${PIX_DADOS.banco} · Ag ${PIX_DADOS.agencia} · Conta ${PIX_DADOS.conta}`,
    '',
    'Me manda o *comprovante aqui mesmo neste número* que eu confirmo o valor e libero seu acesso na hora. 🙌',
  ].join('\n');
}

// Bloco do Pix pra email (HTML). Aponta o comprovante pro WhatsApp do atendimento.
export function pixBlocoEmailHtml(): string {
  return `
    <div style="margin:22px 0 6px;background:#0f231a;border-left:4px solid #10b981;border-radius:0 10px 10px 0;padding:16px 20px;">
      <p style="margin:0 0 6px;color:#34d399;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Prefere pagar por Pix?</p>
      <p style="margin:0 0 4px;color:#e2e8f0;font-size:14.5px;line-height:1.7;">Chave Pix (CNPJ): <strong style="color:#f8fafc;">${PIX_DADOS.chave}</strong></p>
      <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.6;">${PIX_DADOS.titular} · ${PIX_DADOS.banco} · Ag ${PIX_DADOS.agencia} · Conta ${PIX_DADOS.conta}</p>
      <p style="margin:0;color:#cbd5e1;font-size:13.5px;line-height:1.6;">Depois é só mandar o <strong style="color:#f8fafc;">comprovante no WhatsApp ${PIX_DADOS.whatsappLabel}</strong> que a gente confirma o valor e libera seu acesso.</p>
    </div>`;
}
