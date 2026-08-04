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

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'Token não fornecido');
    }

    const token = authHeader.split(' ')[1];

    // Clerk só entra se estiver ligado E o usuário já estiver amarrado. Sem
    // CLERK_SECRET_KEY nem sequer é chamado: o caminho abaixo é o de sempre.
    if (clerkAtivo) {
      const userIdClerk = await resolverUsuarioDoClerk(token);
      if (userIdClerk) {
        req.userId = userIdClerk;
        next();
        return;
      }
    }

    const { userId } = verifyToken(token);
    req.userId = userId;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
