import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router();

const BASE_URL = process.env.API_URL || 'https://api.solardoc.app';
// Token estático — qualquer usuário autorizado do Claude.ai usa o mesmo
const STATIC_TOKEN = process.env.MCP_TOKEN || 'solardoc-mcp-token-2026';
const codes = new Map<string, number>(); // code → expiry

// ─── OAuth 2.0 Discovery ──────────────────────────────────────────
router.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
  });
});

// ─── Authorization endpoint ───────────────────────────────────────
router.get('/oauth/authorize', (req: Request, res: Response) => {
  const { redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.query as Record<string, string>;

  // Gera código de autorização
  const code = crypto.randomBytes(16).toString('hex');
  codes.set(code, Date.now() + 5 * 60 * 1000); // expira em 5 min

  // Redireciona de volta ao Claude.ai com o código
  const params = new URLSearchParams({ code, state: state || '' });
  res.redirect(`${redirect_uri}?${params.toString()}`);
});

// ─── Token endpoint ───────────────────────────────────────────────
router.post('/oauth/token', (req: Request, res: Response) => {
  const { code, grant_type } = req.body as Record<string, string>;

  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  const expiry = codes.get(code);
  if (!expiry || Date.now() > expiry) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  codes.delete(code);

  res.json({
    access_token: STATIC_TOKEN,
    token_type: 'Bearer',
    expires_in: 31536000, // 1 ano
  });
});

export default router;
