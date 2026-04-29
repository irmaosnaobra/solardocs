import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';

const SECRET = process.env.JWT_SECRET || 'solardoc_jwt_2024_segredo_forte_production';

export function unsubToken(userId: string): string {
  return crypto.createHmac('sha256', SECRET).update(`unsub:${userId}`).digest('hex').slice(0, 32);
}

function verify(userId: string, token: string): boolean {
  const expected = unsubToken(userId);
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export async function handleUnsubscribe(req: Request, res: Response): Promise<void> {
  const userId = String(req.query.u || '').trim();
  const token = String(req.query.t || '').trim();

  const renderPage = (title: string, message: string, ok: boolean) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}
  .card{max-width:480px;width:100%;background:#1e293b;border-radius:16px;padding:36px;text-align:center}
  h1{margin:0 0 12px;font-size:22px;color:#f8fafc}
  p{margin:0 0 8px;font-size:15px;line-height:1.6;color:#94a3b8}
  .badge{display:inline-block;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:18px;background:${ok ? '#f59e0b' : '#ef4444'};color:#0f172a}
  a{color:#f59e0b;text-decoration:none}
</style></head><body><div class="card"><div class="badge">SolarDoc Pro</div><h1>${title}</h1><p>${message}</p></div></body></html>`);
  };

  if (!userId || !token || !verify(userId, token)) {
    res.status(400);
    return renderPage('Link invalido', 'Esse link de descadastro expirou ou foi alterado. Se quiser parar de receber nossos emails, responda o ultimo email que recebeu que cancelamos manualmente.', false);
  }

  const { error } = await supabase
    .from('users')
    .update({ email_opt_out: true })
    .eq('id', userId);

  if (error) {
    res.status(500);
    return renderPage('Erro ao processar', 'Nao conseguimos processar seu descadastro agora. Tente novamente em alguns minutos ou responda o email que cancelamos manualmente.', false);
  }

  // Aceita POST one-click do List-Unsubscribe-Post (RFC 8058) sem renderizar HTML
  if (req.method === 'POST') {
    res.status(200).send('OK');
    return;
  }

  res.status(200);
  renderPage('Descadastro confirmado', 'Voce nao vai mais receber emails de marketing do SolarDoc Pro. Emails transacionais (redefinicao de senha, recibo de pagamento) continuam ativos.', true);
}
