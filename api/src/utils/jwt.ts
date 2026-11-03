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

// Segredo anterior, só para VERIFICAR durante a troca do JWT_SECRET (nunca assina). Lido na hora da
// chamada. Mesma regra de força do JWT_SECRET (16+ caracteres); vazio, fraco ou igual ao novo = não existe.
export function jwtSecretAnterior(): string | null {
  // O trim só decide se a env existe: o valor devolvido é o CRU, igual ao JWT_SECRET, porque os tokens e os
  // links antigos foram assinados com o valor sem aparar.
  const s = process.env.JWT_SECRET_ANTERIOR || '';
  if (s.trim().length < 16 || s === JWT_SECRET) return null;
  return s;
}

/** Segredos que valem para verificar: o novo primeiro, o anterior depois (se existir). */
export function segredosDeVerificacao(): string[] {
  const anterior = jwtSecretAnterior();
  return anterior ? [JWT_SECRET, anterior] : [JWT_SECRET];
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string } {
  let ultimoErro: unknown;
  for (const segredo of segredosDeVerificacao()) {
    try {
      const decoded = jwt.verify(token, segredo, { algorithms: ['HS256'] }) as { userId: string };
      return { userId: decoded.userId };
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
}
