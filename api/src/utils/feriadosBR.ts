// Feriados nacionais — a lista canônica do backend.
//
// Existia uma cópia dentro do sdrAgentService e outra dentro de cada LP. Três
// listas que precisam concordar é uma que vai ficar pra trás em silêncio: agenda
// que abre num feriado só aparece quando o lead marca e ninguém vai atender.
// As LPs ainda têm a delas (são HTML solto, sem build) — mas o backend fala por
// esta. Atualizar uma vez por ano.
const FERIADOS_BR_2026: string[] = [
  '2026-01-01', // Confraternização Universal
  '2026-02-16', // Carnaval (segunda)
  '2026-02-17', // Carnaval (terça)
  '2026-04-03', // Sexta-feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi
  '2026-09-07', // Independência
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamação da República
  '2026-11-20', // Consciência Negra
  '2026-12-25', // Natal
];
const FERIADOS_BR_2027: string[] = [
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21',
  '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02',
  '2027-11-15', '2027-11-20', '2027-12-25',
];

export const FERIADOS_BR: Set<string> = new Set([...FERIADOS_BR_2026, ...FERIADOS_BR_2027]);

/** `ymd` no formato YYYY-MM-DD (data em Brasília, não UTC). */
export const ehFeriadoBR = (ymd: string): boolean => FERIADOS_BR.has(ymd);
