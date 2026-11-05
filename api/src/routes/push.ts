import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { hostPushPermitido, inscricoesAtivas, linhasDePush, registrarPush } from '../services/pushUsuario';

const router = Router();

// Chave pública VAPID: o navegador precisa dela para criar a inscrição.
router.get('/chave', authMiddleware, (_req: Request, res: Response): void => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    res.status(503).json({ error: 'Aviso no celular indisponível no momento.' });
    return;
  }
  res.json({ publicKey });
});

const inscricaoSchema = z.object({
  subscription: z.object({
    endpoint: z.string().min(10).max(1000),
    keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(10).max(100) }),
  }),
});

router.post('/inscricao', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = inscricaoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Inscrição inválida.' });
    return;
  }
  const { endpoint, keys } = parsed.data.subscription;
  if (!hostPushPermitido(endpoint)) {
    res.status(400).json({ error: 'Endereço de push não aceito.' });
    return;
  }
  try {
    // O front reenvia a inscrição a cada visita. Já ativa, não grava de novo: senão as
    // 200 linhas lidas no envio se encheriam de repetição e empurrariam outros aparelhos pra fora.
    const ativas = inscricoesAtivas(await linhasDePush(req.userId));
    if (ativas.some((a) => a.endpoint === endpoint && a.keys.p256dh === keys.p256dh && a.keys.auth === keys.auth)) {
      res.json({ ok: true });
      return;
    }
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    await registrarPush(req.userId, 'inscricao', { endpoint, keys, ua });
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] inscricao falhou', (err as Error).message);
    res.status(500).json({ error: 'Não foi possível ativar o aviso.' });
  }
});

router.delete('/inscricao', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  if (!endpoint || endpoint.length > 1000) {
    res.status(400).json({ error: 'Informe o endpoint.' });
    return;
  }
  try {
    await registrarPush(req.userId, 'cancelada', { endpoint });
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] cancelamento falhou', (err as Error).message);
    res.status(500).json({ error: 'Não foi possível desativar o aviso.' });
  }
});

export default router;
