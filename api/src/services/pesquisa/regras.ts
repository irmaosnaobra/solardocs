// ─────────────────────────────────────────────────────────────────────────────
// AS REGRAS DAS PESQUISAS (04/11/2026). PURO: sem banco, sem relógio e sem env; tudo recebe o que precisa.
//   · saída: ex-assinante = já pagou (venda paid com valor, ou plano vencido) e hoje está free; até 10 e-mails por dia, 1 vez por pessoa;
//   · depoimento: pagante com 20 ou mais propostas (documents, tipo propostaSolar) nos últimos 30 dias; até 10 e-mails por dia; fora quem recebeu
//     a pesquisa de satisfação (pesquisa_sent_at) nos últimos 30 dias;
//   · os dois respeitam opt-out e e-mail inválido e nunca vão a conta de teste ou de admin.
// ─────────────────────────────────────────────────────────────────────────────

import { diaBRT, horaBRT } from '../agentes5040/relogio';
import { ehContaDeTeste, pagaHoje, saidaDaConta, type UsuarioRet } from '../solardoc/retomadaUsuariosRegras';

export const TETO_EMAIL_DIA = 10;
export const MIN_PROPOSTAS_DEPOIMENTO = 20;
export const JANELA_PROPOSTAS_DIAS = 30;
export const JANELA_SATISFACAO_DIAS = 30;
/** Quem saiu há menos que isto ainda pode estar renovando o Pix: não recebe a entrevista de saída. */
export const SAIU_HA_DIAS_MIN = 2;
/** Os e-mails só saem dentro desta janela do dia (hora de Brasília): das 9h às 19h. */
export const EMAIL_DESDE_H = 9;
export const EMAIL_ATE_H = 19;

export const PREFIXO_EMAIL_SAIDA = 'pesquisa_saida_email:';
export const PREFIXO_EMAIL_DEPO = 'pesquisa_depo_email:';
export const PREFIXO_WA_DEPO = 'depo_sent:';
/** Desfecho do pedido SEM mensagem. Fica FORA das listas da linha (não conta como frio); os filtros leem este e o `depo_sent:`. */
export const PREFIXO_WA_DEPO_FORA = 'depo_fora:';
/** O carimbo da retomada dos usuários (WhatsApp da Carla). O e-mail de saída pula quem o recebeu no mesmo dia. */
export const PREFIXO_RETOMADA_WA = 'usu_rec_sent:';
export const ROBO_DEPOIMENTO_PEDIDO = 'depoimento_pedido';

const DIA = 24 * 3_600_000;

// Igual ao pesquisaSatisfacao.ts: pega e-mail torto antes de gastar um envio (a base tem "…@gmail.coms").
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const TLD_TORTO = /\.com[a-z]$/i;
export const emailEntregavel = (e: unknown): boolean => EMAIL_OK.test(String(e ?? '')) && !TLD_TORTO.test(String(e ?? ''));

export interface UsuarioPesq extends UsuarioRet {
  email_opt_out?: boolean | null;
  pesquisa_sent_at?: string | null;
}

const ms = (v: unknown): number | null => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

/** Base comum dos dois e-mails: endereço entregável, sem opt-out, fora conta de teste e de admin. */
export function podeReceberEmail(u: UsuarioPesq): boolean {
  return emailEntregavel(u.email) && u.email_opt_out !== true && !ehContaDeTeste(u);
}

/** Já pagou (venda paid com valor, ou plano vencido), hoje está free e saiu há pelo menos SAIU_HA_DIAS_MIN dias (quando a data é conhecida). */
export function ehExAssinante(u: UsuarioPesq, temVendaPaga: boolean, agoraMs: number): boolean {
  if (u.plano !== 'free' || pagaHoje(u, agoraMs)) return false;
  const venceu = ms(u.plano_expira_em);
  const planoVencido = venceu !== null && venceu < agoraMs;
  if (!temVendaPaga && !planoVencido) return false;
  const { saiuEm } = saidaDaConta(u, agoraMs);
  return saiuEm === null || agoraMs - saiuEm >= SAIU_HA_DIAS_MIN * DIA;
}

/** Pagante de verdade (mesma régua do pesquisaSatisfacao): pro ou ilimitado, billing ativo. */
export const ehPagante = (u: Pick<UsuarioPesq, 'plano' | 'billing_status'>): boolean =>
  (u.plano === 'pro' || u.plano === 'ilimitado') && u.billing_status === 'active';

/** Recebeu a pesquisa de satisfação (pesquisa_sent_at) nos últimos 30 dias? */
export function recebeuSatisfacaoRecente(u: Pick<UsuarioPesq, 'pesquisa_sent_at'>, agoraMs: number): boolean {
  const t = ms(u.pesquisa_sent_at);
  return t !== null && agoraMs - t < JANELA_SATISFACAO_DIAS * DIA;
}

export const ehGrandeUsuario = (u: UsuarioPesq, propostas30d: number): boolean =>
  ehPagante(u) && !ehContaDeTeste(u) && propostas30d >= MIN_PROPOSTAS_DEPOIMENTO;

/** Dentro da janela dos e-mails (9h às 19h de Brasília). */
export const dentroDaJanelaDeEmail = (agora: Date): boolean => {
  const h = horaBRT(agora);
  return h >= EMAIL_DESDE_H && h < EMAIL_ATE_H;
};

/** O instante em que o dia de Brasília de `agora` começou. */
export const inicioDoDiaBRT = (agora: Date): Date => new Date(`${diaBRT(agora)}T03:00:00.000Z`);

/** A bolha única do WhatsApp do depoimento: sem link, 1 pergunta. `primeiro` vazio = sem nome. */
export function textoDepoimentoWhatsApp(primeiro: string | null | undefined): string {
  const p = String(primeiro ?? '').trim();
  return `Oi, ${p ? `${p}, aqui` : 'aqui'} é a Carla, da SolarDoc. Obrigada por usar tanto a SolarDoc. Você topa contar em 2 frases o que ela mudou no seu trabalho, para eu mostrar a outros integradores?`;
}
