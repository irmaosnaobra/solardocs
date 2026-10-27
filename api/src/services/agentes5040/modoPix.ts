// ─────────────────────────────────────────────────────────────────────────────
// QUAL PIX SAI AGORA (módulo neutro, 27/10/2026). Saiu do carlaVivo.ts para que o robô de recuperação do quiz
// (solardoc/recuperacaoCarla.ts) saiba se há Pix disponível SEM importar o carlaVivo, que o cabeçalho dele reserva ao vivo.ts.
// PURO: não envia nada, não grava nada, não lê banco. Só a env do checkout (pixCheckoutUrl, lida a cada chamada) e o copia e cola.
// O comportamento é o mesmo que tinha no carlaVivo.
// ─────────────────────────────────────────────────────────────────────────────

import { gerarPixCopiaECola, crc16 } from '../../utils/pixBrCode';
import { pixCheckoutUrl } from '../../utils/pixInfo';

export const VALOR_PIX = 67;
export const TXID_PIX = 'SOLARDOCVIP';

export type ModoPix = 'link' | 'codigo' | 'indisponivel';

/** A mesma regra do vivoEnvio para a peça pix (BR Code inteiro, ASCII imprimível, CRC certo). Mantenha as duas iguais. */
const RE_PIX = /^000201[ -~]+6304[0-9A-F]{4}$/;
export const pixValido = (c: string): boolean => RE_PIX.test(c) && crc16(c.slice(0, -4)) === c.slice(-4);

export const gerarCodigo = (): string => gerarPixCopiaECola({ valor: VALOR_PIX, txid: TXID_PIX });

/** Qual Pix sai agora: o link da Kiwify (env https), o copia e cola válido, ou nenhum. */
export function modoPix(): ModoPix {
  if (/^https:\/\/[^\s]+$/i.test(pixCheckoutUrl())) return 'link';
  try { return pixValido(gerarCodigo()) ? 'codigo' : 'indisponivel'; } catch { return 'indisponivel'; }
}
