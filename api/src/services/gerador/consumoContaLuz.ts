import { validarCampo } from './cadastroVenda';

// ─────────────────────────────────────────────────────────────────────────────
// CONSUMO MÉDIO LIDO DA CONTA DE LUZ (20/11/2026). O campo `consumo_medio_kwh` do cadastro da venda solar guarda um número em kWh por mês. A IA manda
// a média do histórico impresso na conta (ou, sem histórico, o consumo do mês faturado); aqui o valor vira INTEIRO de 1 a 100.000 kWh. O que não é número,
// é zero ou passa do teto é lixo: a leitura descarta (e diz o motivo), em vez de gravar. A digitação à mão continua com a regra de `validarCampo`.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSUMO_MIN_KWH = 1;
export const CONSUMO_MAX_KWH = 100_000;
export const NOTA_CONSUMO_FORA = 'O consumo lido da conta não é um número de 1 a 100.000 kWh: não foi usado.';

/** "412.5", "1.234,5", "350 kWh" -> "413", "1235", "350". null = não serve (não é número, abaixo de 1 ou acima de 100.000). */
export function consumoDaLeitura(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const v = validarCampo('consumo_medio_kwh', valor);
  if (!v.ok || !v.valor) return null;
  const n = Math.round(Number(v.valor));
  return Number.isFinite(n) && n >= CONSUMO_MIN_KWH && n <= CONSUMO_MAX_KWH ? String(n) : null;
}
