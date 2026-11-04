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

// ─────────────────────────────────────────────────────────────────────────────
// ORDEM DO DONO (04/11/2026): "Todos o pix será de recorrência agora, temos vários clientes que enviam pix
// para renovar, sempre oriente eles a utilizar o pix recorrente". Tudo que OFERECE Pix passa a oferecer o
// Pix AUTOMÁTICO (assina uma vez, o banco debita todo mês, sem comprovante). O copia-e-cola manual
// (gerarPixCopiaECola, PIX_DADOS) e o checkout da Kiwify continuam existindo só para a liberação por
// comprovante de quem ainda paga no manual: não são mais OFERECIDOS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Link do Pix automático (abre a assinatura direto na LP). `origem` vai em utm_source; sem utm_term de propósito.
 * Dentro do WhatsApp o link vai SEMPRE no meio de uma frase, nunca sozinho numa linha (sozinho vira uma bolha a mais).
 */
export function pixAutomaticoLink(origem: string, medium: 'whatsapp' | 'email' = 'whatsapp'): string {
  return `https://solardoc.app/?pagar=pix&utm_source=${encodeURIComponent(origem)}&utm_medium=${medium}`;
}

/** UMA frase que oferece o Pix automático, com o link dentro. Sem valor de propósito: a página mostra o preço. */
export function fraseOferecePixAutomatico(origem: string): string {
  return `O Pix agora é automático: você assina uma vez em ${pixAutomaticoLink(origem)} com o e-mail da sua conta e ele cobra sozinho todo mês, sem comprovante.`;
}

/** Fecho da confirmação de um Pix manual: oferece o Pix automático para o mês seguinte. Vai SEMPRE colado na última frase da bolha. */
export function fraseProximoMesSemComprovante(): string {
  return `Se quiser, o próximo mês já fica sem comprovante: é só assinar o Pix automático em ${pixAutomaticoLink('renovacao')}.`;
}

// Bloco do Pix pra WhatsApp (com *negrito* do WhatsApp). Uma frase só, com o link dentro.
export function pixBlocoWhatsApp(origem = 'abandono'): string {
  return `💠 *Prefere pagar no Pix?* ${fraseOferecePixAutomatico(origem)}`;
}

// Bloco do Pix pra email (HTML): botão do Pix automático.
export function pixBlocoEmailHtml(): string {
  const url = pixAutomaticoLink('email', 'email');
  return `
    <div style="margin:22px 0 6px;background:#0f231a;border-left:4px solid #10b981;border-radius:0 10px 10px 0;padding:16px 20px;">
      <p style="margin:0 0 6px;color:#34d399;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Prefere pagar no Pix?</p>
      <p style="margin:0 0 14px;color:#e2e8f0;font-size:14.5px;line-height:1.7;">O Pix agora é <strong style="color:#f8fafc;">automático</strong>: você assina uma vez, usando o e-mail da sua conta, e o banco debita todo mês sozinho. Sem comprovante e sem lembrar de pagar.</p>
      <p style="margin:0;text-align:center;">
        <a href="${url}" style="display:inline-block;background:#10b981;color:#04150e;font-weight:900;font-size:15px;padding:14px 32px;border-radius:11px;text-decoration:none;">Assinar no Pix automático</a>
      </p>
    </div>`;
}

/** O que a recuperação manda quando o lead pede Pix: UMA bolha, com o link do Pix automático dentro da frase. */
export function bolhasPixCheckout(origem = 'recuperacao'): string[] {
  return [`Claro! ${fraseOferecePixAutomatico(origem)}`];
}

// Trava do caminho PÚBLICO de Pix (tela /pix-automatico e a rota sem login que
// cria a cobrança). Fica aqui, e não no controller, porque quem decide o
// cancel_url do Stripe é o paymentsController e quem serve a rota é o
// asaasPixController — a regra tem que ser a MESMA nos dois, senão a Stripe
// manda gente pra uma tela que responde 503.
//
// Sem a variável, desligado. Rota aberta que cria cobrança de verdade no
// gateway não sobe ligada no mesmo empurrão em que é escrita.
export function pixPublicoAtivo(): boolean {
  return (process.env.PIX_PUBLICO_ATIVO || '').trim().toLowerCase() === 'true';
}

/**
 * Trava PRÓPRIA do quiz do SolarDoc (/diagnostico, "Assinar no Pix automático").
 * Abre só a rota pública de criar contrato para chamadas com origem
 * 'quiz_solardoc' e o GET de status. NÃO é PIX_PUBLICO_ATIVO: não muda o
 * cancel_url da Stripe nem liga a tela /pix-automatico para quem abandonou o
 * checkout. Sem a variável, desligado.
 */
export function pixAutoQuizAtivo(): boolean {
  return (process.env.PIX_AUTO_QUIZ || '').trim().toLowerCase() === 'true';
}

/**
 * Trava PRÓPRIA da LP do SolarDoc (solardoc.app/, "Assinar no Pix automático").
 * Mesma ideia da do quiz: abre a rota pública de criar contrato só para chamadas
 * com origem 'lp_solardoc' e o GET de status. NÃO é PIX_PUBLICO_ATIVO. Sem a
 * variável, desligado.
 */
export function pixAutoLpAtivo(): boolean {
  return (process.env.PIX_AUTO_LP || '').trim().toLowerCase() === 'true';
}

/**
 * Trava do Pix AVULSO do funil (quiz e LP): QR estático de R$ 67, copia e cola, sem CPF.
 * Abre só POST/GET /payments/pix-avulso/publico, e só para origem quiz_solardoc ou lp_solardoc.
 * Sem a variável, desligado.
 *
 * DESLIGADO desde 03/11/2026 por ordem do dono: "Todos os pix tem que ser o recorrente da
 * asaas" e "Não coloque pix direto, vai atrapalhar a estrategia, ele tem que cobrar na conta
 * da pessoa". A produção está com PIX_AVULSO_FUNIL=false e a tela só oferece o Pix
 * automático. A rota fica dormente; o webhook do avulso continua de pé para algum QR que
 * já tenha sido gerado antes do desligamento.
 */
export function pixAvulsoFunilAtivo(): boolean {
  return (process.env.PIX_AVULSO_FUNIL || '').trim().toLowerCase() === 'true';
}

/**
 * A tela PÚBLICA de Pix do Asaas (`/pix-automatico`), quando ela está no ar.
 * Vazio = desligada, e aí ela não existe pra ninguém: a rota devolve 503.
 *
 * ⚠️ NÃO é substituta do checkout da Kiwify, por mais que as duas sejam "um
 * link de Pix". São produtos diferentes vendidos pra mesma pessoa:
 *
 *   Kiwify (`pixCheckoutUrl`)  → UM MÊS avulso de R$ 67, acaba e acabou. O
 *     webhook cria a conta se ela não existir e libera sozinho.
 *   Asaas (`pixPublicoUrl`)    → ASSINATURA. Com `ASAAS_PIX_MODO` no padrão
 *     ('auto') o cliente autoriza débito mensal no app do banco; o pagamento
 *     dele se repete. Pede CPF/CNPJ e nome no formulário. E se o e-mail não
 *     tiver conta, o webhook NÃO cria: ele avisa o Thiago pra fazer na mão
 *     (4 dos 17 abandonos de hoje cairiam aí).
 *
 * Por isso esta função existe mas ninguém a usa nas mensagens ainda: o roteiro
 * da Giovanna promete "R$ 67, um mês do plano completo", e trocar o trilho por
 * baixo transformaria isso em mentira. Trocar é decisão de produto, não de env.
 */
export function pixPublicoUrl(): string {
  if (!pixPublicoAtivo()) return '';
  const base = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
  return `${base}/pix-automatico`;
}
