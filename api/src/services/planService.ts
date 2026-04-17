import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';

export async function checkLimit(userId: string): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('plano, documentos_usados, limite_documentos')
    .eq('id', userId)
    .single();

  if (!user) throw new ApiError(404, 'Usuário não encontrado');
  if (user.plano === 'ilimitado') return;

  if (user.documentos_usados >= user.limite_documentos) {
    throw new ApiError(403, 'LIMIT_REACHED');
  }
}

export async function incrementUsed(userId: string): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('documentos_usados')
    .eq('id', userId)
    .single();

  if (user) {
    await supabase
      .from('users')
      .update({ documentos_usados: user.documentos_usados + 1 })
      .eq('id', userId);
  }
}

export async function runMonthlyReset(): Promise<void> {
  const now = new Date().toISOString();
  const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('users')
    .update({ documentos_usados: 0, data_reset: nextReset })
    .in('plano', ['pro'])
    .lte('data_reset', now)
    .not('data_reset', 'is', null)
    .select('id, email');

  console.log(`Monthly reset executed for ${data?.length ?? 0} users`);
  if (error) console.error('Monthly reset error:', error);
}
