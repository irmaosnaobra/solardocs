// ─────────────────────────────────────────────────────────────────────────────
// A NEGOCIAÇÃO VIRA NO FIM DO PRÓPRIO DIA (09/10/2026)
//
// Ordem do Thiago: "quando falamos que aquele card será remarcado em 48h depois,
// ele tem que sair às 23:59 do mesmo dia e não esperar dar as 48h. Exemplo:
// 13:00, Reinaldo, chave na mão, dia 9/10: quando chegar às 23:59 ele já se
// posiciona às 13:15 do dia 10/10." E logo depois: "usei 48h como exemplo,
// seria qual tempo for; a lógica é virar no mesmo dia e ocupar seu lugar na
// próxima agenda".
//
// Até aqui a escada dizia QUANDO o card podia andar: vencidas as horas do
// degrau, o robô o pegava e o punha na próxima vaga a partir de AGORA. Nesse
// meio tempo o card ficava parado no passado, fora da agenda de qualquer dia que
// alguém abrisse. O de 48h passava o dia seguinte inteiro invisível, e só
// aparecia na agenda no instante em que já era a hora dele.
//
// Agora a escada diz ONDE ele cai, e o dia dele diz QUANDO ele sai:
//   · sai às 23:59 do dia em que estava (`jaVirou`);
//   · cai em `quando + horas do degrau`, no primeiro horário livre da faixa a
//     partir dali (`ordenarPeloLugar`): 13:00 vira 13:15.
//
// O degrau não mudou (24, 48, 48, 72, 72 …) e continua contando do horário onde
// o card estava. Muda só o momento em que ele aparece na agenda da frente: no
// fim do dia, e não quando o prazo vence.
//
// Fica num módulo NEUTRO pelo mesmo motivo do `salaDeEspera`: a regra é uma só
// pros dois produtos, e nenhum deles pode importar o outro.
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'America/Sao_Paulo';

/** O dia de Brasília (aaaa-mm-dd) de um instante. */
export const diaDeBrasilia = (t: number | string | Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(t));

/** 00:00 de Brasília do dia do instante. `-03:00` fixo: o Brasil não tem
 *  horário de verão desde 2019. */
export const inicioDoDia = (t: number | string | Date): number =>
  new Date(`${diaDeBrasilia(t)}T00:00:00-03:00`).getTime();

/** O minuto da virada: 23:59 de Brasília do dia em que o card estava. */
export const viradaDoDia = (quandoIso: string): number =>
  inicioDoDia(quandoIso) + 86400_000 - 60_000;

/** O dia do card já fechou? Horário ilegível nunca vira: card com data quebrada
 *  não pode ser movido pra um lugar calculado em cima dela. */
export function jaVirou(quandoIso: string | null | undefined, agora: number): boolean {
  if (!quandoIso || !Number.isFinite(Date.parse(quandoIso))) return false;
  return agora >= viradaDoDia(quandoIso);
}

/** Onde o card cai: o horário onde ele estava mais as horas do degrau. */
export const alvoDoDegrau = (quandoIso: string, horas: number): number =>
  Date.parse(quandoIso) + horas * 3600_000;

/** Minuto do dia em Brasília (0 a 1439). */
const minutoDoDia = (t: number): number => {
  const brt = new Date(t - 3 * 3600_000);
  return brt.getUTCHours() * 60 + brt.getUTCMinutes();
};

/**
 * O LUGAR DO CARD NA PRÓXIMA AGENDA, entre as vagas livres que a grade devolveu.
 *
 * Escolhe o PRIMEIRO dia que tem vaga e, dentro dele, nesta ordem:
 *   1. a partir da hora do alvo, subindo (alvo 13:00 → 13:15, 13:45 …);
 *   2. se dali pra frente o dia estiver cheio, a vaga ANTERIOR mais perto do
 *      alvo (12:45, 12:15 …): o card fica na agenda do dia certo, um pouco
 *      antes, em vez de pular um dia inteiro;
 * e só depois os dias seguintes, em ordem, que servem de reserva pra quando o
 * banco recusa o primeiro horário.
 *
 * A HORA DO ALVO VALE NO DIA QUE TIVER VAGA, não só no dia do alvo. É o que faz
 * o card de sexta 13:00 de 24h, que cairia no sábado, ir pra segunda às 13:15
 * e não pras 08:15: "o seu lugar" é o horário dele, não a primeira vaga da
 * semana. Sem isso, todos os cards de sexta se empilhariam no começo da manhã
 * de segunda.
 */
export function ordenarPeloLugar(vagas: readonly string[], alvoMs: number): string[] {
  const ordenadas = [...vagas]
    .filter(v => Number.isFinite(Date.parse(v)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!ordenadas.length) return [];
  const dia = diaDeBrasilia(ordenadas[0]!);
  const doDia = ordenadas.filter(v => diaDeBrasilia(v) === dia);
  const resto = ordenadas.filter(v => diaDeBrasilia(v) !== dia);
  const m = minutoDoDia(alvoMs);
  const depois = doDia.filter(v => minutoDoDia(Date.parse(v)) >= m);
  const antes = doDia.filter(v => minutoDoDia(Date.parse(v)) < m).reverse();
  return [...depois, ...antes, ...resto];
}
