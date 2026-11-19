// ───────────────────────────────────────────────────────────────────────────
// LEITURA DO FUNIL DO QUIZ MONJOUR (19/11/2026), para GET /admin/monjour/quiz-funil.
// Só lê lp_events (o beacon /_t/e grava lá os eventos monjour_* que o servidor
// do Monjour manda) e entrega ao funilMonjourPuro.ts, onde mora a conta.
// ───────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { inicioDoPeriodo, fimDoPeriodo } from '../io/quizFunil';
import {
  type EventoMonjour, type FiltrosMonjour, type FunilMonjour, PERIODOS_MONJOUR, TIPOS_EVENTO_MONJOUR,
} from './monjourCatalogo';
import { montarFunilMonjour } from './funilMonjourPuro';

const PAGINA = 1000;
/** Teto de linhas lidas por consulta: passou disso, a resposta sai com `truncado: true`. */
export const TETO_LINHAS = 200_000;

type Pagina = PromiseLike<{ data: EventoMonjour[] | null; error: unknown }>;

/** Lê em páginas de 1000 (o PostgREST corta ali sem avisar) até o teto. */
export async function lerEventosMonjour(consulta: (de: number, ate: number) => Pagina): Promise<{ eventos: EventoMonjour[]; truncado: boolean }> {
  const eventos: EventoMonjour[] = [];
  for (let de = 0; de < TETO_LINHAS; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw error;
    eventos.push(...(data ?? []));
    if (!data || data.length < PAGINA) return { eventos, truncado: false };
  }
  return { eventos, truncado: true };
}

/** O created_at mais antigo de um evento monjour, em qualquer período. Não derruba o painel se falhar. */
async function primeiroEvento(): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('lp_events')
      .select('created_at')
      .in('event_type', [...TIPOS_EVENTO_MONJOUR])
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) return null;
    const c = (data as { created_at: string }[] | null)?.[0]?.created_at;
    return c ? new Date(c).toISOString() : null;
  } catch {
    return null;
  }
}

export function normalizarPeriodo(periodo: string): string {
  return (PERIODOS_MONJOUR as readonly string[]).includes(periodo) ? periodo : '7dias';
}

export async function lerFunilMonjour(periodo: string, filtros: FiltrosMonjour = {}, agora: Date = new Date()): Promise<FunilMonjour> {
  const per = normalizarPeriodo(periodo);
  const desde = inicioDoPeriodo(per, agora.getTime());
  const ate = fimDoPeriodo(per, agora.getTime());
  const [lidos, inicioRastreio] = await Promise.all([
    lerEventosMonjour((de, fim) => {
      let q = supabase.from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('event_type', [...TIPOS_EVENTO_MONJOUR])
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      // O id desempata o created_at: sem isso a paginação pode repetir ou perder linha na fronteira.
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, fim);
    }),
    primeiroEvento(),
  ]);
  return montarFunilMonjour(lidos.eventos, {
    periodo: per, desde, ate: ate ?? agora.toISOString(), agora, inicioRastreio, truncado: lidos.truncado, filtros,
  });
}
