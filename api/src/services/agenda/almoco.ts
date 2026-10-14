// O ALMOÇO TRAVADO (13/10/2026): horário que COMEÇA entre 12:00 e 13:30 não existe.
//
// Módulo FOLHA, de propósito: nenhum import de serviço ou de rota. A rota da LP
// (`routes/ioEletroposto.ts`) e a grade (`eletropostoVagas.ts`) precisam da mesma
// regra, e a rota não pode importar a grade nem a agenda em lote sem fechar um ciclo
// (a `api/` é CommonJS: ciclo novo no boot deixa export `undefined` com o tsc verde).
// A LP tem a função gêmea (`ehHorarioDeAlmoco`); mudou aqui, muda lá.

/** 12:00, em minutos do dia. */
export const ALMOCO_INICIO_MIN = 12 * 60;
/** 13:30, em minutos do dia. O almoço acaba aqui: 13:30 em diante é horário válido. */
export const ALMOCO_FIM_MIN = 13 * 60 + 30;

/** O horário de INÍCIO cai no almoço? `hhmm` é 'HH:MM' em Brasília. Vale para as
 *  duas faixas: 12:00, 12:30 e 13:00 (novo) e 12:15, 12:45 e 13:15 (remarcação). */
export function ehHorarioDeAlmoco(hhmm: string): boolean {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return m >= ALMOCO_INICIO_MIN && m < ALMOCO_FIM_MIN;
}

const FMT_HHMM_BRT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

/** O INÍCIO deste instante (ISO ou qualquer texto que o `Date` entenda) cai no almoço,
 *  contado em Brasília? O servidor roda em UTC. Valor inválido devolve `false`. */
export function ehAlmocoNoIso(iso: string): boolean {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;
  const p = Object.fromEntries(FMT_HHMM_BRT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return ehHorarioDeAlmoco(`${p.hour}:${p.minute}`);
}
