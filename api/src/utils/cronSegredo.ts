import crypto from 'crypto';

// Aceita mais de um valor de segredo de cron durante a troca (rotação sem derrubar cron).
// As envs são lidas NA HORA da chamada, nunca no import. Valor vazio é ignorado, como antes:
// sem piso de tamanho, porque o GITHUB_CRON_SECRET é sensível na Vercel e não dá para medir.
// Sem CRON_SECRET_ANTERIOR, o comportamento é o de sempre.
export type SlotCron = 'CRON_SECRET' | 'GITHUB_CRON_SECRET' | 'CRON_SECRET_ANTERIOR';

const SLOTS: SlotCron[] = ['CRON_SECRET', 'GITHUB_CRON_SECRET', 'CRON_SECRET_ANTERIOR'];
const TAMANHO_MINIMO = 1;

/** O aviso de slot que não é o CRON_SECRET sai no máximo 1 vez por hora por (slot, rota, ua) nesta instância. */
const ultimoAviso = new Map<string, number>();
export function deveAvisarSlot(chave: string, agoraMs: number = Date.now()): boolean {
  const ult = ultimoAviso.get(chave);
  if (ult != null && agoraMs - ult < 3_600_000) return false;
  ultimoAviso.set(chave, agoraMs);
  if (ultimoAviso.size > 500) ultimoAviso.clear();
  return true;
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Qual slot casa com o valor recebido (o primeiro, na ordem acima), ou null. */
export function slotDoSegredo(recebido: unknown, env: NodeJS.ProcessEnv = process.env): SlotCron | null {
  if (typeof recebido !== 'string') return null;
  const dado = recebido.trim();
  if (!dado) return null;
  for (const slot of SLOTS) {
    const valor = String(env[slot] ?? '').trim();
    if (valor.length < TAMANHO_MINIMO) continue;
    if (igual(valor, dado)) return slot;
  }
  return null;
}
