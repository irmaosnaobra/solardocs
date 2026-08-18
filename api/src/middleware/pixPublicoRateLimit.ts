// Rate-limit da criação PÚBLICA de contrato de Pix recorrente.
//
// POR QUÊ: esta é a única rota sem login que cria Customer e cobrança de
// verdade no Asaas. Sem limite, um script abre contrato atrás de contrato na
// conta do Thiago — sujeira no painel do gateway, e-mail de cobrança saindo
// pra gente que nunca pediu, e risco de a conta ser sinalizada.
//
// Mesma estrutura do rate-limit da indicação: Upstash quando as variáveis
// existem (contagem compartilhada entre instâncias da Vercel e sobrevive a
// deploy) e, sem elas, o limitador em memória — que zera no cold start, mas é
// melhor do que nenhum.
import type { Request, Response, NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { indicacaoLimiter } from './rateLimiter';

const temUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

// 5 por hora, por IP. Quem está pagando de verdade cria UM contrato: o serviço
// devolve o mesmo contrato nas tentativas seguintes, então nem quem erra o CPF
// duas vezes encosta nesse teto.
const limitador = temUpstash
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      prefix: 'rl:pixpublico',
      analytics: false,
    })
  : null;

export async function pixPublicoRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!limitador) {
    indicacaoLimiter(req, res, next);
    return;
  }

  try {
    const { success, reset } = await limitador.limit(req.ip || 'sem-ip');
    if (!success) {
      const esperaSegundos = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      res.setHeader('Retry-After', String(esperaSegundos));
      res.status(429).json({
        error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
      });
      return;
    }
    next();
  } catch {
    // Redis fora do ar não pode derrubar o pagamento: volta pro limite em memória.
    indicacaoLimiter(req, res, next);
  }
}
