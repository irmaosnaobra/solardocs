// Rate-limit do formulário público de indicação, com Redis de verdade.
//
// POR QUÊ: o express-rate-limit sem `store` guarda a contagem na MEMÓRIA do
// processo. Na Vercel isso significa que o limite de 8/hora zera a cada cold
// start e não vale entre instâncias — quem quiser furar é só esperar o processo
// reciclar. Com o Upstash a contagem é compartilhada e sobrevive a deploy.
//
// Sem as variáveis do Upstash, cai no limitador em memória de sempre. O
// formulário nunca fica sem proteção nenhuma.
import type { Request, Response, NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { indicacaoLimiter } from './rateLimiter';

const temUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

// Mesma regra do limitador antigo: 8 por hora, por IP.
const limitador = temUpstash
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(8, '1 h'),
      prefix: 'rl:indicacao',
      analytics: false,
    })
  : null;

export const upstashAtivo = temUpstash;

export async function indicacaoRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!limitador) {
    indicacaoLimiter(req, res, next);
    return;
  }

  try {
    const chave = req.ip || 'sem-ip';
    const { success, reset } = await limitador.limit(chave);

    if (!success) {
      const esperaSegundos = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      res.setHeader('Retry-After', String(esperaSegundos));
      res.status(429).json({
        error: 'Muitas indicações em pouco tempo. Tente novamente mais tarde.',
      });
      return;
    }

    next();
  } catch {
    // Redis fora do ar não pode derrubar o formulário: volta pro limite em memória.
    indicacaoLimiter(req, res, next);
  }
}
