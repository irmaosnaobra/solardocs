/**
 * ESTOQUE EM DIA: leitura e escrita de quantidade, valor e mínimo digitados.
 *
 * Campo de número do estoque é texto (`type="text" inputmode="decimal"`), nunca `type="number"`: o campo numérico
 * do navegador apaga a vírgula e some com o "1.500". Guarde o TEXTO digitado e converta só na hora de usar.
 *
 * Mesma regra de milhar de `lib/offgrid/dinheiro.ts` ("1.500" vale 1500, "1,5" vale 1,5), com duas diferenças que
 * o estoque precisa: campo vazio ou inválido volta `null` (nunca vira 0 sem querer) e o zero digitado vale 0
 * (mínimo 0 e saldo 0 existem de verdade).
 *
 * Sem importar nada com `@/`: o script de prova roda estas funções direto com tsx.
 */

const MAXIMO = 10_000_000;

/**
 * Devolve o número digitado, ou `null` se estiver vazio, com letra, negativo, com duas vírgulas ou acima do limite.
 * Ponto seguido de exatamente três dígitos, em grupos (e sem começar por zero), é milhar. Com vírgula, o ponto é
 * sempre milhar. Qualquer outro ponto é decimal ("52.7" e "0.500" valem 52,7 e 0,5).
 */
export function lerQuantidade(texto: string | number | null | undefined): number | null {
  if (typeof texto === 'number') return isFinite(texto) && texto >= 0 && texto <= MAXIMO ? arredonda(texto) : null;
  const s = String(texto ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  let limpo: string;
  if (s.includes(',')) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    limpo = s.replace(/\./g, '').replace(',', '.');
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    limpo = s.replace(/\./g, '');
  } else {
    if ((s.match(/\./g) ?? []).length > 1) return null;
    limpo = s;
  }
  const n = Number(limpo);
  return isFinite(n) && n >= 0 && n <= MAXIMO ? arredonda(n) : null;
}

const arredonda = (n: number) => Math.round(n * 1000) / 1000;

/** Texto para devolver ao campo: 1500 vira "1.500", 1.5 vira "1,5". */
export function formatarQuantidade(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Valor em reais para o campo: 650 vira "650,00". */
export function formatarValor(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
