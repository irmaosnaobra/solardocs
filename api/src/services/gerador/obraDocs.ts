// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVAS DA OBRA SOLAR (19/11/2026): CPF, placa, as chaves do checklist e os 8 itens de foto da entrega. Puro, sem importar `jornadaObra`
// (que as reexporta): assim os portões novos (`obraPortoes.ts`) usam as mesmas regras sem ciclo de importação.
// ─────────────────────────────────────────────────────────────────────────────
import { cpfValido } from '../../utils/documento';

/** A placa em maiúsculas e sem hífen nem espaço (só se for Mercosul ABC1D23 ou antiga ABC1234); senão ''. */
export function normalizarPlaca(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : '';
  return /^[A-Z]{3}\d[A-Z]\d{2}$/.test(t) || /^[A-Z]{3}\d{4}$/.test(t) ? t : '';
}
export const placaValida = (v: unknown): boolean => normalizarPlaca(v) !== '';

/** Os 11 dígitos do CPF (com dígito verificador batendo); senão ''. Aceita máscara. */
export function normalizarCpf(v: unknown): string {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return d.length === 11 && cpfValido(d) ? d : '';
}

export const CHAVES_CHECKLIST = ['estrutura', 'placas', 'strings', 'inversor', 'dps', 'aterramento', 'cabos', 'padrao'] as const;
export const SLOTS_FOTO_ENTREGA = ['ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro', 'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo'] as const;
