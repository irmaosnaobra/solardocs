// Clerk — LIGADO NO CÓDIGO, DESLIGADO NA PRÁTICA.
//
// O login de hoje é feito na mão (jsonwebtoken + bcryptjs) e continua sendo o
// dono da verdade. Este arquivo só acrescenta um caminho: se um dia chegar um
// token do Clerk E o usuário já estiver amarrado a uma conta daqui, ele passa.
// Em qualquer outra situação devolve null e o authMiddleware segue no JWT de
// sempre — é por isso que dá pra deixar isto no ar sem risco.
//
// PRA VIRAR A CHAVE DE VERDADE (sessão acompanhada, não sozinho):
//   1. criar a coluna `clerk_user_id` na tabela `users`;
//   2. importar as senhas (o Clerk aceita hash bcrypt, ninguém precisa trocar);
//   3. amarrar cada usuário ao id do Clerk;
//   4. só então mexer no dashboard (Next 16) e no fluxo de login.
// Enquanto o passo 1 não existir, a busca abaixo não acha nada e o caminho novo
// nunca é usado — que é exatamente o comportamento desejado agora.
import { verifyToken } from '@clerk/backend';
import { supabase } from '../utils/supabase';

const secretKey = process.env.CLERK_SECRET_KEY;

export const clerkAtivo = Boolean(secretKey);

/**
 * Devolve o id do usuário DAQUI (não o do Clerk) quando o token é um token
 * válido do Clerk já amarrado a uma conta. Devolve null em todo o resto.
 *
 * Nunca lança: qualquer problema vira null e o login de sempre assume.
 */
export async function resolverUsuarioDoClerk(token: string): Promise<string | null> {
  if (!secretKey) return null;

  try {
    const payload = await verifyToken(token, { secretKey });
    const clerkUserId = payload?.sub;
    if (!clerkUserId) return null;

    // A amarração é o que impede o desastre: sem ela, usar o id do Clerk como
    // se fosse o id daqui apontaria o usuário pros dados de ninguém.
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    if (error || !data?.id) return null;
    return data.id as string;
  } catch {
    // Token que não é do Clerk cai aqui o tempo todo — é o caso NORMAL hoje.
    return null;
  }
}
