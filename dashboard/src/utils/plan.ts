/**
 * Mapeia o nome interno do plano (slug do banco) para o label de exibição.
 * Internamente o plano "ilimitado" é o produto vendido como "VIP".
 */
export function formatPlanName(plano: string): string {
  switch (plano) {
    case 'free':       return 'Grátis';
    case 'iniciante':  return 'Iniciante';
    case 'pro':        return 'Pro';
    case 'ilimitado':  return 'VIP';
    default:           return plano.charAt(0).toUpperCase() + plano.slice(1);
  }
}

export function firstName(nome?: string | null, email?: string): string {
  if (nome && nome.trim()) return nome.trim().split(/\s+/)[0];
  if (email) return email.split('@')[0];
  return '';
}
