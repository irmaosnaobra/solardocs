// ───────────────────────────────────────────────────────────────────────────
// LEITURA DO FUNIL DO QUIZ DOMINA IA (24/11/2026), para GET /admin/dominaia/quiz-funil.
// Só lê lp_events (o beacon /_t/e grava lá os eventos dominaia_* que o servidor
// da Domina IA manda) e entrega ao funilDominaiaPuro.ts, onde mora a conta.
// Nenhum período começa antes de DOMINAIA_DESDE: antes disso é tráfego de teste.
// ───────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { inicioDoPeriodo, fimDoPeriodo } from '../io/quizFunil';
import {
  type EventoDominaia, type FiltrosDominaia, type FunilDominaia, DOMINAIA_DESDE, PERIODOS_DOMINAIA, TIPOS_EVENTO_DOMINAIA,
} from './dominaiaCatalogo';
import { montarFunilDominaia } from './funilDominaiaPuro';

const PAGINA = 1000;
/** Teto de linhas lidas por consulta: passou disso, a resposta sai com `truncado: true`. */
export const TETO_LINHAS = 200_000;

type Pagina = PromiseLike<{ data: EventoDominaia[] | null; error: unknown }>;

/** Lê em páginas de 1000 (o PostgREST corta ali sem avisar) até o teto. */
export async function lerEventosDominaia(consulta: (de: number, ate: number) => Pagina): Promise<{ eventos: EventoDominaia[]; truncado: boolean }> {
  const eventos: EventoDominaia[] = [];
  for (let de = 0; de < TETO_LINHAS; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw error;
    eventos.push(...(data ?? []));
    if (!data || data.length < PAGINA) return { eventos, truncado: false };
  }
  return { eventos, truncado: true };
}

/** Início de um período (ISO UTC), nunca antes de DOMINAIA_DESDE (meia-noite de São Paulo). */
export function inicioDoPeriodoDominaia(periodo: string, agora: number): string {
  const piso = Date.parse(`${DOMINAIA_DESDE}T00:00:00-03:00`);
  const inicio = inicioDoPeriodo(periodo, agora);
  return Date.parse(inicio) < piso ? new Date(piso).toISOString() : inicio;
}

/** O created_at mais antigo de um evento dominaia desde DOMINAIA_DESDE. Não derruba o painel se falhar. */
async function primeiroEvento(): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('lp_events')
      .select('created_at')
      .in('event_type', [...TIPOS_EVENTO_DOMINAIA])
      .gte('created_at', new Date(Date.parse(`${DOMINAIA_DESDE}T00:00:00-03:00`)).toISOString())
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
  return (PERIODOS_DOMINAIA as readonly string[]).includes(periodo) ? periodo : '7dias';
}

export async function lerFunilDominaia(periodo: string, filtros: FiltrosDominaia = {}, agora: Date = new Date()): Promise<FunilDominaia> {
  const per = normalizarPeriodo(periodo);
  const desde = inicioDoPeriodoDominaia(per, agora.getTime());
  const ate = fimDoPeriodo(per, agora.getTime());
  const [lidos, inicioRastreio] = await Promise.all([
    lerEventosDominaia((de, fim) => {
      let q = supabase.from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('event_type', [...TIPOS_EVENTO_DOMINAIA])
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      // O id desempata o created_at: sem isso a paginação pode repetir ou perder linha na fronteira.
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, fim);
    }),
    primeiroEvento(),
  ]);
  return montarFunilDominaia(lidos.eventos, {
    periodo: per, desde, ate: ate ?? agora.toISOString(), agora, inicioRastreio, truncado: lidos.truncado, filtros,
  });
}
