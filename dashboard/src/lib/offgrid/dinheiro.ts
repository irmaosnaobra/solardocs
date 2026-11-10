/**
 * OFF-GRID: leitura e escrita de dinheiro e de número digitado.
 *
 * Campo de dinheiro é texto (`type="text" inputmode="decimal"`), nunca `type="number"`: o campo numérico do
 * navegador apaga a vírgula e some com o "52.700". Guarde o TEXTO que a pessoa digitou e converta só na hora de
 * usar. Formate ao sair do campo, nunca a cada tecla.
 *
 * Sem importar nada com `@/`: o script de prova roda estas funções direto com tsx.
 */

const MAX_DINHEIRO = 10_000_000;

/**
 * "52.700", "52700", "52.700,50", "52700,5", "R$ 52.700,50" e "52.7" viram número. Ponto seguido de exatamente
 * três dígitos, em grupos, é milhar ("52.700" vale 52700). Com vírgula, o ponto é sempre milhar. Qualquer outro
 * ponto é decimal ("52.7" vale 52,7). Vazio, negativo, zero ou acima de R$ 10 milhões vira 0.
 */
export function lerDinheiro(texto: string | number | null | undefined): number {
  if (typeof texto === 'number') {
    return isFinite(texto) && texto > 0 && texto <= MAX_DINHEIRO ? Math.round(texto * 100) / 100 : 0;
  }
  const s = String(texto ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return 0;
  let limpo: string;
  if (s.includes(',')) limpo = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) limpo = s.replace(/\./g, '');
  else limpo = s;
  const n = parseFloat(limpo);
  return isFinite(n) && n > 0 && n <= MAX_DINHEIRO ? Math.round(n * 100) / 100 : 0;
}

/** Número que não é dinheiro (kW, Wp, kWh, horas): vírgula ou ponto decimal, sem milhar. "5,12" e "5.12" valem 5,12. */
export function lerNumero(texto: string | number | null | undefined): number {
  if (typeof texto === 'number') return isFinite(texto) && texto > 0 ? texto : 0;
  const s = String(texto ?? '').replace(/\s/g, '');
  if (!s) return 0;
  const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return isFinite(n) && n > 0 ? n : 0;
}

/** Texto para devolver ao campo ao sair dele: "52700,5" vira "52.700,5". Zero vira vazio. */
export function formatarDinheiro(n: number): string {
  return n > 0 ? n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '';
}

/** Mesma ideia para número comum (kW, Wp, kWh). */
export function formatarNumero(n: number): string {
  return n > 0 ? n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '';
}
