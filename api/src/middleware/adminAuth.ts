import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import { BancoIndisponivel, lerDoBanco, responder503 } from '../utils/dbTransitorio';

export async function adminMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Soluço do banco não é "você não é admin": antes o error era ignorado e um 504
  // virava 403 "Acesso restrito" para o próprio dono.
  let user: { is_admin?: boolean | null } | null;
  try {
    user = await lerDoBanco(() => supabase
      .from('users')
      .select('is_admin')
      .eq('id', req.userId)
      .maybeSingle());
  } catch (err) {
    if (err instanceof BancoIndisponivel) { responder503(res, 'admin', err.causa); return; }
    console.error('[admin] leitura do usuário falhou:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
    return;
  }

  if (!user?.is_admin) {
    res.status(403).json({ error: 'Acesso restrito a administradores' });
    return;
  }
  next();
}
