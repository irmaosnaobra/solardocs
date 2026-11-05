// ─────────────────────────────────────────────────────────────────────────────
// VALIDADE REAL DO CÓDIGO DO PIX AUTOMÁTICO (05/11/2026). Regras PURAS: nada aqui lê banco, relógio ou env.
//
// O QR imediato da autorização nasce com `expirationSeconds: 86400` (24 h). Se o Asaas recusar o valor com erro de validação (400 ou 422),
// o criador repete UMA vez com 3600. A data que importa é a que o Asaas devolve (`immediateQrCode.expirationDate`), gravada por contrato em
// `pix_auto_exp:<contrato>` (system_state, sem migration). Todo o resto (expirar contrato, fase da recuperação, resposta da conversa,
// e-mail) usa a MESMA função de vencimento daqui, para ninguém discordar sobre "o código ainda vale?".
// ─────────────────────────────────────────────────────────────────────────────

export const QR_SEGUNDOS_PADRAO = 86_400;
export const QR_SEGUNDOS_FALLBACK = 3_600;
/** Folga depois do vencimento real antes de o contrato poder ser trocado por outro (o QR velho ainda pode estar sendo pago). */
export const FOLGA_VENCIMENTO_MS = 5 * 60_000;
/** O código só é "vivo" (reenviável como está) se faltam 2 h ou mais. */
export const CODIGO_VIVO_MIN_RESTANTE_MS = 2 * 3_600_000;
/** Data devolvida pelo Asaas além de agora + 25 h não é confiável (o pedido máximo é 24 h). */
const TETO_CONFIAVEL_MS = 25 * 3_600_000;

/**
 * `expirationDate` do Asaas para ISO UTC. Com `Z` ou deslocamento (+03:00, -0300): vale como veio. Sem fuso ("AAAA-MM-DD HH:mm:ss"): é hora de Brasília
 * (-03:00), nunca a do servidor. null = ilegível.
 */
export function normalizarExpiracao(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const t = bruto.trim();
  if (!t) return null;
  let ms: number;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(t)) {
    ms = Date.parse(t);
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(t);
    if (!m) return null;
    ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? (m[4] === undefined ? 59 : 0))) + 3 * 3_600_000;
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * A expiração a gravar: a do Asaas se for legível, futura e de até 25 h; senão criação + os segundos que de fato valeram no pedido
 * (`fallback: true` quando não foi a data do Asaas).
 */
export function expiracaoParaGravar(bruto: unknown, agoraMs: number, segundosPedidos: number): { expira_em: string; fallback: boolean } {
  const iso = normalizarExpiracao(bruto);
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(ms) && ms > agoraMs && ms - agoraMs <= TETO_CONFIAVEL_MS) return { expira_em: new Date(ms).toISOString(), fallback: false };
  return { expira_em: new Date(agoraMs + segundosPedidos * 1000).toISOString(), fallback: true };
}

export interface ContratoComValidade { created_at?: string | null; expira_em?: string | null }

/**
 * Corte do QR de 24 h. Contrato criado a partir daqui, SEM a chave `pix_auto_exp` (a gravação falhou), vale 24 h e não 60 min: do lado seguro, para nunca abrir um
 * segundo contrato com o QR de 24 h ainda pagável. Contrato criado antes do corte nasceu com QR de 60 min. A env PIX_QR24H_DESDE (ISO) acerta o corte para a hora
 * real do deploy.
 */
export const QR24H_DESDE_PADRAO = '2026-11-05T02:05:00-03:00';
export const qr24hDesdeMs = (): number => {
  const env = Date.parse(String(process.env.PIX_QR24H_DESDE ?? '').trim());
  return Number.isFinite(env) ? env : Date.parse(QR24H_DESDE_PADRAO);
};

/**
 * Até quando o código do contrato vale (ms). Chave `pix_auto_exp` gravada: a data real. Sem a chave: contrato criado antes do corte = criação + 60 min (o QR antigo);
 * criado depois do corte = criação + 24 h (a gravação da chave falhou). null = sem data legível.
 */
export function validadeDoCodigoMs(c: ContratoComValidade): number | null {
  const iso = normalizarExpiracao(c.expira_em);
  if (iso) return Date.parse(iso);
  const criado = Date.parse(String(c.created_at ?? ''));
  if (!Number.isFinite(criado)) return null;
  return criado + (criado >= qr24hDesdeMs() ? QR_SEGUNDOS_PADRAO : QR_SEGUNDOS_FALLBACK) * 1000;
}

/** Quanto falta (ms, pode ser negativo). null = sem data. */
export function restanteDoCodigoMs(c: ContratoComValidade, agoraMs: number): number | null {
  const v = validadeDoCodigoMs(c);
  return v === null ? null : v - agoraMs;
}

/** O contrato pendente pode ser trocado por outro? Só depois do vencimento real mais a folga. Sem data legível não vence. */
export function codigoVencidoParaTroca(c: ContratoComValidade, agoraMs: number): boolean {
  const r = restanteDoCodigoMs(c, agoraMs);
  return r !== null && r < -FOLGA_VENCIMENTO_MS;
}

/** O código ainda é reenviável como está (faltam 2 h ou mais)? */
export function codigoReenviavel(c: ContratoComValidade, agoraMs: number): boolean {
  const r = restanteDoCodigoMs(c, agoraMs);
  return r !== null && r >= CODIGO_VIVO_MIN_RESTANTE_MS;
}

/** Copia e cola de Pix de verdade (BR Code). */
export const ehCodigoPix = (s: string | null | undefined): s is string => typeof s === 'string' && s.startsWith('000201');

const fmtHora = (ms: number): string => {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date(ms));
  return `${String(Number(f) % 24)}h`;
};
const diaDe = (ms: number): string => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * "até hoje às 23h" / "até amanhã às 21h" / "até 08/11 às 9h": hora de Brasília ARREDONDADA PARA BAIXO (a hora cheia). Nunca arredonda para cima.
 */
export function validadePorExtenso(validadeMs: number, agoraMs: number): string {
  const hoje = diaDe(agoraMs);
  const dia = diaDe(validadeMs);
  const amanha = diaDe(agoraMs + 24 * 3_600_000);
  const hora = fmtHora(validadeMs);
  if (dia === hoje) return `até hoje às ${hora}`;
  if (dia === amanha) return `até amanhã às ${hora}`;
  const [, mm, dd] = dia.split('-');
  return `até ${dd}/${mm} às ${hora}`;
}

/** "15h40" ou "21h": hora de Brasília, arredondada PARA BAIXO (minuto zero some). */
export function horaCurtaBRT(ms: number): string {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const h = String(Number(f.find(p => p.type === 'hour')?.value ?? '0') % 24);
  const m = Number(f.find(p => p.type === 'minute')?.value ?? '0');
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * O pagamento vale desde `desdeMs`? Conta como pago só o contrato `ativo`, ou um pagamento DEPOIS dessa data. `inadimplente` e `cancelado` com `ultimo_pagamento_em`
 * antigo (de antes do contrato que está sendo recuperado) NÃO contam: quem pagou há meses e saiu não "já pagou" a assinatura nova. Pagamento com id e sem data
 * (o webhook grava o id antes do `ativo`) conta: é pagamento em andamento.
 */
export function pagamentoValeDesde(c: { status: string; ultimo_pagamento_em?: string | null; ultimo_pagamento_id?: string | null }, desdeMs: number): boolean {
  if (c.status === 'ativo') return true;
  const em = Date.parse(String(c.ultimo_pagamento_em ?? ''));
  if (Number.isFinite(em)) return em > desdeMs;
  return !!c.ultimo_pagamento_id;
}
