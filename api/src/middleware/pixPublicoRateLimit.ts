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
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { clientIp } from '../controllers/trackingGeradorController';

const temUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

// A CHAVE é o IP REAL do cliente (clientIp: 1º valor do x-forwarded-for, depois x-real-ip,
// depois o socket), o mesmo padrão do rastreio do /gerador. O quiz chama pela reescrita
// /_api do dashboard, e req.ip pode ser o IP do proxy: todo visitante dividiria o mesmo teto.
//
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

// Fallback em memória, PRÓPRIO desta rota (não divide balde com o formulário de indicação)
// e com a MESMA chave do Upstash.
export const pixPublicoLimiterMemoria = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => 'pixpublico:' + ipKeyGenerator(clientIp(req) || 'sem-ip'),
  message: { error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export async function pixPublicoRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!limitador) {
    pixPublicoLimiterMemoria(req, res, next);
    return;
  }

  try {
    const { success, reset } = await limitador.limit(clientIp(req) || 'sem-ip');
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
    pixPublicoLimiterMemoria(req, res, next);
  }
}

// ── Pix AVULSO do funil (código copia e cola) ────────────────────────────────
// Balde PRÓPRIO, de 10 por hora por IP, separado do automático: quem fecha e reabre o modal ou cai do automático no
// avulso não pode esgotar o teto do outro. (O serviço ainda devolve o mesmo QR ao mesmo e-mail enquanto ele vale.)
const limitadorAvulso = temUpstash
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'rl:pixavulso',
      analytics: false,
    })
  : null;

export const pixAvulsoLimiterMemoria = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => 'pixavulso:' + ipKeyGenerator(clientIp(req) || 'sem-ip'),
  message: { error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export async function pixAvulsoRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!limitadorAvulso) {
    pixAvulsoLimiterMemoria(req, res, next);
    return;
  }
  try {
    const { success, reset } = await limitadorAvulso.limit(clientIp(req) || 'sem-ip');
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
    pixAvulsoLimiterMemoria(req, res, next);
  }
}

// ── Lead da LP antes do "Gerar" (05/11/2026) ─────────────────────────────────
// Os MESMOS números do rate limit de pagamento (5 por hora por IP), em balde PRÓPRIO: quem digita o WhatsApp não pode gastar o teto de quem vai gerar o Pix.
const limitadorLeadLp = temUpstash
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      prefix: 'rl:pixleadlp',
      analytics: false,
    })
  : null;

export const pixLeadLpLimiterMemoria = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => 'pixleadlp:' + ipKeyGenerator(clientIp(req) || 'sem-ip'),
  message: { error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Teto GLOBAL da rota (chefe anti-ban): 30 por hora no total, de qualquer IP. Um balde só, com a chave fixa 'global'.
const TETO_GLOBAL_LEAD_LP_POR_HORA = 30;
const limitadorLeadLpGlobal = temUpstash
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(TETO_GLOBAL_LEAD_LP_POR_HORA, '1 h'),
      prefix: 'rl:pixleadlpglobal',
      analytics: false,
    })
  : null;

export const pixLeadLpGlobalMemoria = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: TETO_GLOBAL_LEAD_LP_POR_HORA,
  keyGenerator: () => 'pixleadlp-global',
  message: { error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export async function pixLeadLpRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1º o teto por IP, 2º o teto global; passando nos dois, a rota segue.
  const global = (): void => {
    if (!limitadorLeadLpGlobal) { pixLeadLpGlobalMemoria(req, res, next); return; }
    limitadorLeadLpGlobal.limit('global').then(({ success, reset }) => {
      if (!success) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
        res.status(429).json({ error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' });
        return;
      }
      next();
    }).catch(() => pixLeadLpGlobalMemoria(req, res, next));
  };
  const porIp = (): void => {
    pixLeadLpLimiterMemoria(req, res, global);
  };
  if (!limitadorLeadLp) { porIp(); return; }
  try {
    const { success, reset } = await limitadorLeadLp.limit(clientIp(req) || 'sem-ip');
    if (!success) {
      const esperaSegundos = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      res.setHeader('Retry-After', String(esperaSegundos));
      res.status(429).json({ error: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' });
      return;
    }
    global();
  } catch {
    porIp();
  }
}
