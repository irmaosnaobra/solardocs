import jwt from 'jsonwebtoken';

// Secret de assinatura. SEM fallback hardcoded — um fallback conhecido permite
// forjar tokens de qualquer usuário. Em produção, a falta do JWT_SECRET é erro
// fatal (melhor derrubar o boot do que assinar com segredo previsível). Em dev,
// usa um valor efêmero só-de-dev — que NÃO serve pra forjar nada em produção
// (lá o env é obrigatório). Exportado pra reuso (ex: token de unsubscribe).
export const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET ausente ou fraco em produção — defina nas env vars.');
  }
  return 'dev-only-insecure-secret-not-for-production';
})();

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string } {
  const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
  return { userId: decoded.userId };
}
