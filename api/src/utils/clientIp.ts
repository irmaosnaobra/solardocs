import type { Request } from 'express';

/**
 * O IP real do cliente: 1º valor do x-forwarded-for (a Vercel injeta), depois x-real-ip, depois o socket.
 * Mora aqui, sem dependência nenhuma, para o middleware de limite não puxar o controller de rastreio
 * (que importa o cliente de envio do WhatsApp) para a árvore dos agentes da 5040.
 */
export function clientIp(req: Request): string {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  const xri = String(req.headers['x-real-ip'] || '').trim();
  if (xri) return xri;
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}
