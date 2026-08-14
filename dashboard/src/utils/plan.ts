/**
 * Mapeia o nome interno do plano (slug do banco) para o label de exibição.
 *
 * PREÇO ÚNICO: a plataforma vende UMA assinatura. Os slugs antigos ('pro',
 * 'iniciante', 'ilimitado') continuam vivos no banco pra quem já assinou por
 * 27/47/49 — mas nenhum deles vira nome de degrau na tela. Todo mundo que paga
 * vê "Ativo"; quem não paga vê "Grátis". O teto real de documentos aparece na
 * contagem (12/90, ∞), não num rótulo de tier.
 */
export function formatPlanName(plano: string): string {
  switch (plano) {
    case 'free':       return 'Grátis';
    default:           return 'Ativo';
  }
}

export function firstName(nome?: string | null, email?: string): string {
  if (nome && nome.trim()) return nome.trim().split(/\s+/)[0];
  if (email) return email.split('@')[0];
  return '';
}
