// ─────────────────────────────────────────────────────────────────────────────
// FERIADOS NACIONAIS — CALCULADOS, PARA QUALQUER ANO.
//
// Até 03/09/2026 isto era uma lista escrita à mão de 2026 e 2027, com o aviso
// "atualizar uma vez por ano". Duas coisas erradas com isso:
//
//   1. o aviso não é um mecanismo. Em 01/01/2028 nenhuma linha do sistema muda
//      de comportamento: a lista simplesmente para de conhecer feriado e a
//      agenda abre no Natal. Ninguém percebe até o lead marcar e ninguém ir.
//   2. eram CINCO listas (esta, o eletropostoVagas, o sdrIoPolling e as duas
//      LPs). Cinco listas que precisam concordar é uma que fica pra trás.
//
// Agora o ano inteiro sai de conta. Os fixos são fixos; os móveis penduram
// todos na Páscoa, e a Páscoa tem fórmula fechada (algoritmo gregoriano
// anônimo, o mesmo de Meeus/Butcher). Não há mais nada pra atualizar.
//
// FERIADO NACIONAL, e só. Ponto facultativo não entra e feriado municipal
// também não — se um dia Uberlândia precisar do dela (o dia da cidade), o lugar
// é uma lista PONTUAL, como o `agendaFechada`, não aqui.
// ─────────────────────────────────────────────────────────────────────────────

const p2 = (n: number): string => String(n).padStart(2, '0');
const ymdDe = (d: Date): string => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;

/**
 * Domingo de Páscoa do ano, em UTC.
 *
 * Divisões inteiras de propósito (`Math.floor`): o algoritmo é aritmética de
 * inteiros e qualquer resto quebra o resultado.
 */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** A Páscoa mais ou menos N dias, em YYYY-MM-DD. */
function daPascoa(ano: number, dias: number): string {
  const d = pascoa(ano);
  d.setUTCDate(d.getUTCDate() + dias);
  return ymdDe(d);
}

/** Os fixos. `11-20` (Consciência Negra) é nacional desde a Lei 14.759/2023. */
const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/** Cache por ano: a conta é barata, mas ela roda dentro de varredura de 21 dias. */
const porAno = new Map<number, Set<string>>();

/** Todos os feriados nacionais do ano, em YYYY-MM-DD. */
export function feriadosDoAno(ano: number): Set<string> {
  const pronto = porAno.get(ano);
  if (pronto) return pronto;
  const s = new Set<string>([
    ...FIXOS.map(md => `${ano}-${md}`),
    daPascoa(ano, -48), // Carnaval (segunda)
    daPascoa(ano, -47), // Carnaval (terça)
    daPascoa(ano, -2),  // Sexta-feira Santa
    daPascoa(ano, 60),  // Corpus Christi
  ]);
  porAno.set(ano, s);
  return s;
}

/**
 * `ymd` no formato YYYY-MM-DD (data em Brasília, não UTC).
 *
 * Aceita qualquer ano. Texto que não é uma data devolve `false` em vez de
 * explodir: quem chama está no meio de montar agenda, e uma exceção aqui
 * derrubaria a grade inteira por causa de um campo torto.
 */
export const ehFeriadoBR = (ymd: string): boolean => {
  const ano = Number(ymd?.slice(0, 4));
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) return false;
  return feriadosDoAno(ano).has(ymd);
};
