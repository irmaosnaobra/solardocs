export interface Item {
  id: string;
  local: string;
  nome: string;
  marca: string | null;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  estoque_minimo: number;
  ordem: number;
  updated_at?: string;
}

export interface Movimento {
  id?: string;
  tipo: string;
  quantidade: number;
  observacao?: string | null;
  created_at: string;
}

export type TipoMov = 'saida' | 'entrada' | 'ajuste';

/** Mensagem de erro do servidor (axios), ou a de reserva. */
export function msgErro(e: unknown, reserva: string): string {
  const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return m && typeof m === 'string' ? m : reserva;
}
