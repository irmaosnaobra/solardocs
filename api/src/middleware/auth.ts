import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { ApiError } from '../utils/apiError';
import { clerkAtivo, resolverUsuarioDoClerk } from './clerkAuth';

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Id do usuário DAQUI a partir de um token de login: o do Clerk (se ligado e já amarrado) ou o JWT próprio.
 * É o reconhecimento inteiro do authMiddleware; quem precisa saber "quem é este login" fora de uma
 * rota autenticada (ex.: o /p/:id público) usa esta função. Lança se o token não valer.
 */
export async function userIdDoToken(token: string): Promise<string> {
  // Clerk só entra se estiver ligado E o usuário já estiver amarrado. Sem
  // CLERK_SECRET_KEY nem sequer é chamado: o caminho abaixo é o de sempre.
  if (clerkAtivo) {
    const userIdClerk = await resolverUsuarioDoClerk(token);
    if (userIdClerk) return userIdClerk;
  }
  return verifyToken(token).userId;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'Token não fornecido');
    }

    const token = authHeader.split(' ')[1];

    // Sem Clerk o caminho continua síncrono (sem await antes do next), como sempre foi.
    req.userId = clerkAtivo ? await userIdDoToken(token) : verifyToken(token).userId;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
