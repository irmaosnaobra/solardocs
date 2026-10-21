// ─────────────────────────────────────────────────────────────────────────────
// ENVIO DA SENTINELA DAS FERRAMENTAS. Este é o ÚNICO arquivo da sentinela que
// manda mensagem. Robô: `sentinela_ferramentas`, classe aviso_interno_p2 (aviso
// ao time, destino = o dono).
//
// Canal, pela env SENTINELA_CANAL:
//   - whatsapp (padrão): UMA bolha ao número do dono, pela instância 'io' (5040).
//   - email: sendOpsAlert (o mesmo canal dos alertas de operação).
//
// A rodada (services/agentes5040/sentinelaRodada.ts) já garante um aviso por
// dia pela reserva sentinela_ferr:<dia>. Aqui não há reenvio nem carimbo extra:
// o carimbo próprio É essa reserva, que não começa com nenhum prefixo de
// BOT_SENT_PREFIXES e nunca com aviso_sent: (que contaria como frio).
//
// Fica em services/io/ de propósito: a pasta agentes5040/ é de módulos que
// NUNCA podem importar o cliente de envio.
// ─────────────────────────────────────────────────────────────────────────────

import { sendWhatsApp } from '../agents/zapiClient';
import { sendOpsAlert } from '../../utils/mailer';

export type CanalSentinela = 'whatsapp' | 'email';

/** SENTINELA_CANAL=email troca o canal; qualquer outra coisa (ou nada) é WhatsApp. */
export function canalDaEnv(env: Record<string, string | undefined> = process.env): CanalSentinela {
  return (env.SENTINELA_CANAL || '').trim().toLowerCase() === 'email' ? 'email' : 'whatsapp';
}

const html = (t: string): string =>
  `<p>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`;

export interface DepsEnvio {
  whatsapp?: (telefone: string, texto: string) => Promise<void>;
  email?: (assunto: string, corpoHtml: string) => Promise<void>;
  env?: Record<string, string | undefined>;
}

export interface OpcoesEnvio {
  /** Pula o WhatsApp: a própria linha está caída, então o aviso vai direto por e-mail. */
  direto_email?: boolean;
}

/**
 * Manda o texto UMA vez, no canal da env. `destino` é o WhatsApp do dono (RESUMO_DIA_WHATS).
 * Se o WhatsApp der erro, o MESMO texto sai por e-mail na mesma chamada (um aviso por dia
 * continua: o e-mail só roda quando o WhatsApp não saiu). Com a linha caída
 * (`direto_email`), nem tenta o WhatsApp.
 */
export async function enviarAviso(
  texto: string, destino: string, deps: DepsEnvio = {}, opts: OpcoesEnvio = {},
): Promise<{ canal: CanalSentinela; reserva?: boolean }> {
  const porEmail = () => (deps.email ?? sendOpsAlert)('Sentinela das ferramentas', html(texto));
  if (opts.direto_email || canalDaEnv(deps.env) === 'email') {
    await porEmail();
    return { canal: 'email' };
  }
  try {
    await (deps.whatsapp ?? ((tel, msg) => sendWhatsApp(tel, msg, 'io')))(destino, texto);
    return { canal: 'whatsapp' };
  } catch {
    await porEmail();   // se este também falhar, o erro sobe e a rodada registra falha_envio
    return { canal: 'email', reserva: true };
  }
}
