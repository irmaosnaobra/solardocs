// ───────────────────────────────────────────────────────────────────────────
// LEITURA DO QUIZ DO SOLARDOC (/diagnostico, 24/10/2026): o funil de queda do
// admin. Só lê banco e Meta; a conta mora em services/io/quizFunil.ts
// (CONFIG_SOLARDOC), com teste.
//
// O JSON tem a MESMA forma do GET /admin/solar/quiz-funil, porque o painel do
// dashboard (QuizEletropostoPanel) lê as duas igual. Não existe agenda neste
// quiz, então não há reunião por conjunto: o custo por "compra" fica para a
// coluna `reunioes` das campanhas (quem foi ao cartão ou ao Pix).
// ───────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import * as qf from '../io/quizFunil';
import { buscarConjuntosMeta } from '../io/metaConjuntos';
import { lerTudo } from '../io/painelQuizSolar';

const diaSP = (ms: number): string => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

export async function lerFunilQuizSolardoc(periodo: string, conjunto: string | null) {
  const desde = qf.inicioDoPeriodo(periodo);
  const ate = qf.fimDoPeriodo(periodo);
  const [eventos, visitas] = await Promise.all([
    lerTudo<qf.EventoQuiz>((de, fim) => {
      let q = supabase.from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('event_type', ['quiz_passo', 'quiz_erro', 'quiz_fim'])
        .eq('event_data->>lp', qf.CONFIG_SOLARDOC.lp)
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      return q.order('created_at', { ascending: true }).range(de, fim);
    }),
    lerTudo<qf.VisitaQuiz>((de, fim) => {
      let q = supabase.from('page_visits')
        .select('session_id, landing_url, utm_campaign, utm_term')
        .ilike('landing_url', '%/diagnostico%')
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      return q.order('created_at', { ascending: true }).range(de, fim);
    }),
  ]);

  const funil = qf.montarFunil(eventos, visitas, { conjunto, config: qf.CONFIG_SOLARDOC });
  const ids = funil.conjuntos.map((c) => c.id);
  const meta = await buscarConjuntosMeta(ids, diaSP(Date.parse(desde)), diaSP(ate ? Date.parse(ate) - 1 : Date.now()));
  return {
    periodo, desde, ate, ...funil,
    por_conjunto: qf.montarConjuntos(funil.conjuntos, [], meta.conjuntos),
    meta_ok: meta.ok, meta_motivo: meta.motivo || null,
  };
}
