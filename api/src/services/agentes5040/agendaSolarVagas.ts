// ─────────────────────────────────────────────────────────────────────────────
// VAGAS DO SOLAR PARA A DUDA (B1d-1, 21/10/2026). SÓ LEITURA.
//
// Este arquivo NÃO escreve em tabela nenhuma e NÃO importa módulo de envio: o contexto.ts (raiz do
// ensaio) importa daqui, e agentes5040Isolamento.test.ts reprova qualquer escrita em `agendamentos`
// no percurso do ensaio. As escritas (gravar o card, remarcar) moram em agendaSolar.ts.
//
// A grade é a do solar, não a do eletroposto: Nilce e Giovanna ligam das 08:00 às 16:30 nos :00/:30
// (cliente novo) e das 08:15 às 16:45 nos :15/:45 (follow-up e remarcação) — solarRota.ts, desde
// 09/10/2026. Ligação dura 15 min e o almoço fica ABERTO (ordem do dono), então não se aplica o
// travamento 12:00-13:30 do eletroposto. A conta de ocupação é a da vitrine do quiz
// (solarQuiz.blocoDaFicha): bloco pronto quando a ficha traz, reunião de eletroposto 30 min (15 nos
// :15/:45) e o resto 15 min. Por isso NÃO usamos livrePara/aindaLivre do eletroposto, que medem o
// candidato como 30 min e recusariam um :00 ao lado de um follow-up das :15.
//
// Agenda nunca bloqueia: nada aqui é freio novo de confirmação, lembrete ou remarcação. É só a leitura
// do que já ocupa a agenda (as mesmas fichas e os mesmos bloqueios manuais que o quiz já respeita).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { carregarCompromissos, type Compromisso } from '../io/eletropostoVagas';
import { ANTECEDENCIA_MIN, DIAS_VARRIDOS, diaUtil, msDe, ymdBRT } from '../io/solarQuiz';
import {
  GRADE_FOLLOWUP_LIGACAO, GRADE_NOVO_LIGACAO, blocoDoCompromisso, donoDaFaixa, horariosDoCaminho, temDuasFaixas,
  type Caminho,
} from '../agenda/solarRota';
import { agendaFechadaEm, ehSocio } from '../agenda/agendaFechada';

/** `novo` = :00/:30 (lead novo). `remarcacao` = :15/:45 (follow-up e remarcação). */
export type FaixaSolar = 'novo' | 'remarcacao';

const MIN_MS = 60_000;
const DIA_MS = 86_400_000;

/** Quem atende cada conta (o mesmo donoDaFaixa de solarRota.ts): desde 24/10/2026, sempre a Nilce. */
export const consultoraDaFaixa = (kwh: number | null): string => donoDaFaixa(kwh);

interface Bloco { ini: number; fim: number }

/** Os horários que a faixa oferece naquele dia para aquela pessoa (HH:MM de Brasília). */
function horasDaFaixa(caminho: Caminho, faixa: FaixaSolar, ymd: string, dono: string): readonly string[] {
  if (caminho === 'ligacao' && temDuasFaixas(dono)) return faixa === 'remarcacao' ? GRADE_FOLLOWUP_LIGACAO : GRADE_NOVO_LIGACAO;
  // Sócio ou outro caminho: só existe a grade de cliente novo. Não há :15/:45 de sócio no solar.
  return faixa === 'remarcacao' ? [] : horariosDoCaminho(caminho, ymd, dono, null);
}

/** O bloco de um compromisso, na mesma régua de solarQuiz.blocoDaFicha. */
function blocoDe(c: Compromisso): Bloco {
  if (typeof c.ini === 'number' && typeof c.fim === 'number') return { ini: c.ini, fim: c.fim };
  const m = new Date(c.ts).getUTCMinutes();   // Brasília é UTC-3 cheio: o minuto é o mesmo
  return { ini: c.ts, fim: c.ts + (c.ep ? ((m === 15 || m === 45) ? 15 : 30) : 15) * MIN_MS };
}

/**
 * O que ocupa a agenda desta pessoa entre `deMs` e `ateMs`: as fichas de qualquer origem (carregarCompromissos,
 * já paginado) e os bloqueios manuais (agenda_bloqueios). `null` = não deu para ler; quem chama NÃO oferece horário.
 * `ignorarMs` tira da conta o card que está sendo remarcado.
 */
async function blocosDe(dono: string, deMs: number, ateMs: number, ignorarMs?: number | null): Promise<Bloco[] | null> {
  const compromissos = await carregarCompromissos(new Date(deMs).toISOString(), new Date(ateMs).toISOString());
  if (compromissos === null) return null;
  let bloqueios: Array<{ inicio: string | null; fim: string | null }>;
  try {
    const { data, error } = await supabaseGerador.from('agenda_bloqueios')
      .select('inicio, fim').eq('vendedor_nome', dono).gte('fim', new Date(deMs).toISOString()).limit(500);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('bloqueios não vieram como lista');
    bloqueios = data as typeof bloqueios;
  } catch (err) {
    logger.error('agentes5040-agenda-solar', 'ler os bloqueios falhou', err);
    return null;
  }
  const out: Bloco[] = compromissos
    .filter(c => c.dono === dono && !(ignorarMs != null && c.ts === ignorarMs))
    .map(blocoDe);
  for (const b of bloqueios) {
    const ini = Date.parse(String(b.inicio)), fim = Date.parse(String(b.fim));
    if (Number.isFinite(ini) && Number.isFinite(fim)) out.push({ ini, fim });
  }
  return out;
}

const cabeNosBlocos = (alvo: Bloco, blocos: readonly Bloco[]): boolean =>
  !blocos.some(b => b.ini < alvo.fim && alvo.ini < b.fim);

/**
 * As próximas `n` vagas (ISO) da consultora, na faixa pedida, a partir de `agora` (ms) + antecedência da ligação.
 * Erro de leitura = null: quem chama não oferece horário. `ignorarIso` tira da conta o card que está sendo remarcado.
 */
export async function vagasSolar(
  p: { dono: string; caminho: Caminho; n: number; agora: number; faixa: FaixaSolar; ignorarIso?: string | null },
): Promise<string[] | null> {
  const { dono, caminho, n, agora, faixa } = p;
  const ignorar = p.ignorarIso ? Date.parse(p.ignorarIso) : null;
  const limite = agora + ANTECEDENCIA_MIN[caminho] * MIN_MS;
  const blocos = await blocosDe(dono, agora, agora + (DIAS_VARRIDOS + 1) * DIA_MS, Number.isFinite(ignorar as number) ? ignorar : null);
  if (blocos === null) return null;
  const vagas: string[] = [];
  for (let i = 0; i < DIAS_VARRIDOS && vagas.length < n; i++) {
    const ymd = ymdBRT(agora + i * DIA_MS);
    if (!diaUtil(ymd)) continue;
    if (ehSocio(dono) && agendaFechadaEm(ymd)) continue;   // a Nilce e a Giovanna não fecham nesses dias
    for (const h of horasDaFaixa(caminho, faixa, ymd, dono)) {
      if (vagas.length >= n) break;
      const t = msDe(ymd, h);
      const bloco = blocoDoCompromisso(caminho, t, dono, null);
      if (t < limite || bloco.ini < agora) continue;
      if (cabeNosBlocos(bloco, blocos)) vagas.push(new Date(t).toISOString());
    }
  }
  return vagas;
}

/**
 * O horário ainda está livre para a consultora AGORA? Última conferência antes de gravar, pela mesma leitura
 * de ocupação das vagas. `true`/`false` = fato; `null` = não deu para ler (quem chama não grava e não afirma
 * que o horário foi tomado). `ignorarIso` tira da conta o card que está sendo remarcado.
 */
export async function aindaLivreSolar(
  iso: string, dono: string, opts: { caminho?: Caminho; ignorarIso?: string | null } = {},
): Promise<boolean | null> {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const ignorar = opts.ignorarIso ? Date.parse(opts.ignorarIso) : null;
  const blocos = await blocosDe(dono, t - 60 * MIN_MS, t + 60 * MIN_MS, Number.isFinite(ignorar as number) ? ignorar : null);
  if (blocos === null) return null;
  return cabeNosBlocos(blocoDoCompromisso(opts.caminho ?? 'ligacao', t, dono, null), blocos);
}
