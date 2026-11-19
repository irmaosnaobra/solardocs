// ───────────────────────────────────────────────────────────────────────────
// LEITURA DO USO DO APP MONJOUR (19/11/2026) em lp_events: tipo monjour_app, só os
// eventos com `m` (a pessoa, HMAC do e-mail gravado pelo /api/t do site; o e-mail
// nunca chega aqui). Só as colunas necessárias, tiradas do JSON pelo próprio banco,
// em páginas de 1000 e com teto: passou dele, a resposta sai com `truncado: true`.
// A leitura é do mais novo ao mais velho, então o teto corta o mais antigo.
// ───────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { inicioDoPeriodo, fimDoPeriodo } from '../io/quizFunil';
import { normalizarPeriodo } from './painelQuizMonjour';
import { periodoParaDatas } from './resumoMonjour';

const PAGINA = 1000;
/** Teto de linhas de uso lidas numa consulta da lista ou do "O que mais gostam". */
export const TETO_USO = 100_000;
/** Teto de eventos lidos de uma pessoa só (a linha do tempo mostra os 500 mais novos). */
export const TETO_MEMBRO = 5_000;

/** Tudo vem como texto ou nulo, porque o banco tira os campos do JSON com `->>`. */
export interface EventoApp {
  m: string | null; acao: string | null; alvo: string | null; nome: string | null;
  dia: string | null; ligado: string | null; cada: string | null;
  plan: string | null; cortesia: string | null; pais: string | null; created_at: string;
}

const COLUNAS = 'm:event_data->>m, acao:event_data->>acao, alvo:event_data->>alvo, nome:event_data->>nome, '
  + 'dia:event_data->>dia, ligado:event_data->>on, cada:event_data->>cada, plan:event_data->>plan, '
  + 'cortesia:event_data->>cortesia, pais:event_data->>pais, created_at';

/** O `m` é hex (HMAC curto). Qualquer outra coisa não entra nem na consulta. */
export const MEMBRO_VALIDO = /^[0-9a-f]{8,64}$/;

type Pagina = PromiseLike<{ data: unknown[] | null; error: unknown }>;

async function lerPaginas(
  consulta: (de: number, ate: number) => Pagina, teto: number, parar: () => boolean = () => false,
): Promise<{ eventos: EventoApp[]; truncado: boolean }> {
  const eventos: EventoApp[] = [];
  for (let de = 0; de < teto; de += PAGINA) {
    // Quem chamou já sabe que vai jogar o uso fora (o site caiu): não lê as páginas que faltam.
    if (parar()) return { eventos, truncado: false };
    const { data, error } = await consulta(de, Math.min(de + PAGINA, teto) - 1);
    if (error) throw error;
    eventos.push(...((data ?? []) as EventoApp[]));
    if (!data || data.length < PAGINA) return { eventos, truncado: false };
  }
  return { eventos, truncado: true };
}

/** Uso de todas as pessoas desde `desdeIso`. Mais novo primeiro. `parar` interrompe entre uma página e outra. */
export function lerUsoDesde(desdeIso: string, parar?: () => boolean): Promise<{ eventos: EventoApp[]; truncado: boolean }> {
  return lerPaginas((de, ate) => supabase.from('lp_events')
    .select(COLUNAS)
    .eq('event_type', 'monjour_app')
    .not('event_data->>m', 'is', null)
    .gte('created_at', desdeIso)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(de, ate), TETO_USO, parar);
}

/** Uso de uma pessoa só. Mais novo primeiro. */
export function lerUsoDoMembro(m: string): Promise<{ eventos: EventoApp[]; truncado: boolean }> {
  return lerPaginas((de, ate) => supabase.from('lp_events')
    .select(COLUNAS)
    .eq('event_type', 'monjour_app')
    .eq('event_data->>m', m)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(de, ate), TETO_MEMBRO);
}

/** Primeiro instante que a lista de membros lê: o começo do site, nunca mais de 120 dias atrás (o limite do site). */
export function desdeDeTodos(agora: Date): string {
  return `${periodoParaDatas('maximo', agora).desde}T00:00:00-03:00`;
}

/** Janela do período do painel em milissegundos: [desde, ate), ate = null quando vai até agora. */
export function janelaDoPeriodo(periodo: string, agora: Date): { desde: number; ate: number | null } {
  const per = normalizarPeriodo(periodo);
  const fim = fimDoPeriodo(per, agora.getTime());
  return { desde: Date.parse(inicioDoPeriodo(per, agora.getTime())), ate: fim ? Date.parse(fim) : null };
}
