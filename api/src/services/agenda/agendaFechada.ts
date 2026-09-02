// ──────────────────────────────────────────────────────────────────────────────
// OS DIAS EM QUE A AGENDA DOS SÓCIOS NÃO ABRE — fonte única.
//
// Feriado é uma coisa (ele já mora nas grades, é anual e vale pra todo mundo).
// Isto é outra: um bloqueio PONTUAL, com data de validade, em que Thiago e Diego
// estão fora e ninguém pode marcar com eles — nem a vitrine da LP, nem o robô que
// remarca, nem o card do Meta.
//
// HOJE A LISTA ESTÁ VAZIA e a régua inteira sai de cena (`temAgendaFechada()`
// devolve false e as cinco portas abaixo passam direto). O módulo fica de pé
// porque o caso volta: toda vez que os dois viajam juntos, o conserto é escrever
// as datas em `DIAS_FECHADOS` e nada mais.
//
// ── Quem consulta isto (cinco portas, e é de propósito que sejam as cinco) ──
//   1. eletropostoVagas.agendaAbre   → o robô para de OFERECER estes dias
//   2. eletropostoAgenda (tick)      → sem confirmação, bom dia, 1h, 5min, sem
//                                      vermelho automático pra reunião destes dias
//   3. eletropostoReagendaAuto       → reunião perdida AQUI não vira "você não
//                                      apareceu": quem não apareceu fomos nós
//   4. POST /io/eletroposto/agendar  → aba velha aberta não grava (409)
//   5. POST /io/solar/agendar        → idem, mas SÓ quando o dono é sócio
//
// As duas LPs têm a mesma lista em JavaScript (a vitrine é calculada no
// navegador). Mexeu aqui? mexa lá — `dashboard/public/io/eletroposto/index.html`
// e `dashboard/public/io/solar/index.html`, procure por AGENDA_FECHADA.
//
// ── NILCE E GIOVANNA CONTINUAM TRABALHANDO ──
// Elas não viajam e o que elas marcam é LIGAÇÃO de 15 min de conta baixa. Fechar
// a agenda delas jogaria fora dias de lead do Meta sem motivo. Por isso o corte
// aqui é por NOME (`ehSocio`), nunca por "não é Nilce" — com duas pessoas no time
// de conta baixa, `dono !== 'Nilce'` é bug (18/08/2026).
//
// ── AO FECHAR A AGENDA DE NOVO ──
// Quem já tinha reunião marcada nos dias que você fechar NÃO é avisado por nada
// disto: estas funções só impedem NOVA marcação e calam as réguas. Avisar quem
// já estava na agenda é trabalho separado, e da última vez foi um módulo próprio.
// ──────────────────────────────────────────────────────────────────────────────

const BRT_TZ = 'America/Sao_Paulo';

/** Quem está fora nestes dias. Lista explícita: o corte é por nome. */
const SOCIOS = ['Thiago', 'Diego'];

/** O motivo que vai no bloqueio da agenda interna e no log. */
export const MOTIVO_FECHADA = 'Os sócios estão fora neste dia';

/** Os dias fechados, em YMD de Brasília. Vazio = agenda normal. */
const DIAS_FECHADOS = new Set<string>([
  // Vazio = agenda normal. Formato: '2026-08-25'.
]);

/** "2026-08-25" no fuso de Brasília. Cópia local de 3 linhas de propósito:
 *  este módulo é consultado por rota, por agente e pela régua de vagas, e não
 *  pode importar nenhum deles de volta. */
export function ymdBRT(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(d));
}

/** Este dia está fechado? (recebe YMD, não data) */
export function agendaFechadaEm(ymd: string): boolean {
  return DIAS_FECHADOS.has(ymd);
}

/** Este instante cai num dia fechado? (recebe ISO/Date — converte pra BRT antes) */
export function agendaFechadaNoIso(iso: Date | string | number | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso as string | number | Date).getTime();
  if (Number.isNaN(t)) return false;
  return DIAS_FECHADOS.has(ymdBRT(t));
}

/** É um dos sócios que está na feira? Comparação por nome, sem "todo mundo que
 *  não é fulano" — a agenda tem quatro pessoas e três times diferentes. */
export function ehSocio(nome: unknown): boolean {
  const n = String(nome ?? '').trim().toLowerCase();
  return SOCIOS.some(s => s.toLowerCase() === n);
}

/** Tem algum dia fechado configurado? (a régua inteira sai de cena quando não) */
export function temAgendaFechada(): boolean {
  return DIAS_FECHADOS.size > 0;
}

/** Os dias fechados, em ordem — pra log, prévia e relatório. */
export function diasFechados(): string[] {
  return [...DIAS_FECHADOS].sort();
}
