import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';

export async function adminMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', req.userId)
    .single();

  if (!user?.is_admin) {
    res.status(403).json({ error: 'Acesso restrito a administradores' });
    return;
  }
  next();
}
