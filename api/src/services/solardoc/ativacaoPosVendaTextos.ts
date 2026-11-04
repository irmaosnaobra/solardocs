// Textos e chaves do pós-venda da SolarDoc (ver ativacaoPosVenda.ts). Sem import nenhum: o webhook do Asaas usa este arquivo sem carregar a linha do WhatsApp.

export const PREFIXO_ATIV_SENHA = 'ativ_senha_sent:';
export const PREFIXO_ATIV_PROPOSTA = 'ativ_proposta_sent:';
export const PREFIXO_BOASVINDAS_PIX = 'boasvindas_pix_sent:';

export const chaveAtivSenha = (userId: string): string => `${PREFIXO_ATIV_SENHA}${userId}`;
export const chaveAtivProposta = (userId: string): string => `${PREFIXO_ATIV_PROPOSTA}${userId}`;
export const chaveBoasVindasPix = (contratoId: string): string => `${PREFIXO_BOASVINDAS_PIX}${contratoId}`;

// ── textos (pura) ────────────────────────────────────────────────────────────

/** Primeiro nome para saudar. Vazio, "Cliente" ou qualquer coisa que não seja nome vira null (texto sem nome). */
export function nomeParaSaudar(nome: string | null | undefined): string | null {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (primeiro.length < 2 || primeiro.length > 30) return null;
  if (/[\d@:/\\]/.test(primeiro)) return null;
  if (primeiro.toLowerCase() === 'cliente') return null;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/** `joao@gmail.com` -> `j***@gmail.com`. */
export function mascararEmail(email: string | null | undefined): string {
  const e = String(email ?? '').trim();
  const arroba = e.lastIndexOf('@');
  if (arroba < 1) return '';
  return `${e.slice(0, 1)}***${e.slice(arroba)}`;
}

const abertura = (nome: string | null | undefined, quem: string): string => {
  const n = nomeParaSaudar(nome);
  return n ? `Oi, ${n}, aqui é a Giovanna, ${quem}.` : `Oi, aqui é a Giovanna, ${quem}.`;
};

export function textoBoasVindasPix(nome: string | null | undefined, email: string): string {
  return `${abertura(nome, 'do suporte da SolarDoc')} Seu pagamento foi confirmado e o link para criar sua senha chegou no e-mail ${mascararEmail(email)}. Se não achar, é só responder aqui que eu te ajudo.`;
}

export function textoSenhaNaoCriada(nome: string | null | undefined, email: string): string {
  return `${abertura(nome, 'da SolarDoc')} Seu pagamento caiu, mas a senha ainda não foi criada. O link está no e-mail ${mascararEmail(email)}, e se você responder aqui eu reenvio.`;
}

export function textoPrimeiraProposta(nome: string | null | undefined): string {
  return `${abertura(nome, 'do suporte da SolarDoc')} Se quiser, eu te guio na sua 1ª proposta aqui pelo WhatsApp. Ela sai em poucos minutos, com a logo e a cor da sua empresa, pronta para mandar no WhatsApp. O suporte está junto com você, é só chamar quando for fazer.`;
}

