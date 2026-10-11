// ───────────────────────────────────────────────────────────────────────────
// LEITURA DO QUIZ DA /io/solar: o funil (admin e Gerador) e o painel do
// Gerador. Só lê banco e Meta; a conta mora em quizFunil.ts e
// painelQuizSolarPuro.ts, com teste.
//
// Até 10/10/2026 o miolo morava dentro de GET /admin/solar/quiz-funil. Foi
// extraído sem mudar o JSON dessa rota (há painel em produção lendo o formato):
// o teste adminSolarQuizFunil.test.ts fixa a resposta antiga byte a byte.
// ───────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import * as qf from './quizFunil';
import { buscarConjuntosMeta, buscarAnunciosMeta, buscarAnunciosComGastoMeta } from './metaConjuntos';
import {
  lerLead, qualidadeDosLeads, resultadoDosCards, montarPorDia, montarPorAnuncio, idsDosAnuncios, acrescentarSoGasto,
  diaBRT, diasDoPeriodo,
  type CardQuiz, type VisitaComData, type LeadBruto, type PainelQuizSolar,
} from './painelQuizSolarPuro';

/** Lê em páginas de 1000: o PostgREST corta ali sem avisar, e o funil de uma
 *  semana passa disso. A consulta precisa de ordem estável para a página não
 *  repetir nem pular linha. */
export async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    tudo.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return tudo;
}

/** O Gerador não aceita "maximo" (desde julho são mais de 31 dias, e o gráfico
 *  e o custo perdem o sentido): vira 7dias. A rota de administrador segue aceitando. */
export const PERIODOS_PAINEL = ['hoje', 'ontem', '7dias', '30dias'] as const;

interface BrutosQuiz {
  desde: string; ate: string | null;
  eventos: qf.EventoQuiz[]; visitas: VisitaComData[]; cards: CardQuiz[];
}

/** Eventos, visitas e cards do quiz no período. Colunas só se ACRESCENTAM aqui:
 *  o funil e a conta por conjunto ignoram as que não usam. */
async function lerBrutos(desde: string, ate: string | null): Promise<BrutosQuiz> {
  const [eventos, visitas, cards] = await Promise.all([
    lerTudo<qf.EventoQuiz>((de, fim) => {
      let q = supabase.from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('event_type', ['quiz_passo', 'quiz_erro', 'quiz_fim'])
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      return q.order('created_at', { ascending: true }).range(de, fim);
    }),
    lerTudo<VisitaComData>((de, fim) => {
      let q = supabase.from('page_visits')
        .select('session_id, landing_url, utm_campaign, utm_term, created_at')
        .ilike('landing_url', '%/io/solar%')
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      return q.order('created_at', { ascending: true }).range(de, fim);
    }),
    lerTudo<CardQuiz>((de, fim) => {
      let q = supabaseGerador.from('agendamentos').select('utm_term, utm_content, status, created_at')
        .eq('created_by', 'lp_solar').like('observacao', 'LP SOLAR QUIZ%')
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      return q.order('created_at', { ascending: true }).range(de, fim);
    }),
  ]);
  return { desde, ate, eventos, visitas, cards };
}

/** Dia (fuso de São Paulo) em que a janela da Meta começa e termina, como o admin. */
function janelaMeta(desde: string, ate: string | null): [string, string] {
  return [diaBRT(Date.parse(desde)), diaBRT(ate ? Date.parse(ate) - 1 : Date.now())];
}

const reunioesDosCards = (cards: CardQuiz[]): qf.ResultadoLead[] =>
  cards.map((r) => ({ conjunto: r.utm_term, tipo: 'reuniao' as const, status: r.status }));

const idsDeConjunto = (funil: qf.FunilQuiz, resultados: qf.ResultadoLead[]) =>
  [...new Set([...funil.conjuntos.map((c) => c.id), ...resultados.map((r) => String(r.conjunto || ''))])];

/**
 * O que GET /admin/solar/quiz-funil devolve, EXATAMENTE (mesmas chaves, mesma
 * ordem). Erro de banco sobe para a rota decidir o status.
 */
export async function lerFunilQuizSolar(periodo: string, conjunto: string | null) {
  const desde = qf.inicioDoPeriodo(periodo);
  const ate = qf.fimDoPeriodo(periodo);
  const b = await lerBrutos(desde, ate);
  const funil = qf.montarFunil(b.eventos, b.visitas, { conjunto, config: qf.CONFIG_SOLAR });
  const resultados = reunioesDosCards(b.cards);
  const [d1, d2] = janelaMeta(desde, ate);
  const meta = await buscarConjuntosMeta(idsDeConjunto(funil, resultados), d1, d2);
  return {
    periodo, desde, ate, ...funil,
    por_conjunto: qf.montarConjuntos(funil.conjuntos, resultados, meta.conjuntos),
    meta_ok: meta.ok, meta_motivo: meta.motivo || null,
  };
}

/** Leads do quiz (`quiz_<telefone>`) criados no período. */
async function lerLeadsDoQuiz(desde: string, ate: string | null): Promise<LeadBruto[]> {
  const linhas = await lerTudo<LeadBruto>((de, fim) => {
    // No LIKE o "_" é curinga: o filtro de verdade é o startsWith logo abaixo.
    let q = supabaseGerador.from('leads_meta').select('lead_id, created_time, field_data')
      .like('lead_id', 'quiz_%').gte('created_time', desde);
    if (ate) q = q.lt('created_time', ate);
    // Segunda chave de ordem: carimbos iguais não podem repetir nem pular
    // linha na virada da página.
    return q.order('created_time', { ascending: true }).order('lead_id', { ascending: true }).range(de, fim);
  });
  return linhas.filter((l) => String(l.lead_id || '').startsWith('quiz_'));
}

/**
 * O painel completo do Gerador, COM gasto (quem corta é `respostaDoPainel`).
 * O banco é lido em paralelo; só depois, já sabendo quais anúncios existem, vai
 * à Meta. Falha de banco sobe; falha da Meta vira `meta_ok: false`.
 */
export async function lerPainelQuizSolar(periodo: string): Promise<PainelQuizSolar> {
  const desde = qf.inicioDoPeriodo(periodo);
  const ate = qf.fimDoPeriodo(periodo);
  const [b, leadsBrutos] = await Promise.all([lerBrutos(desde, ate), lerLeadsDoQuiz(desde, ate)]);

  const funil = qf.montarFunil(b.eventos, b.visitas, { config: qf.CONFIG_SOLAR });
  const leads = leadsBrutos.map(lerLead);
  const resultados = reunioesDosCards(b.cards);
  const [d1, d2] = janelaMeta(desde, ate);
  const [mc, ma] = await Promise.all([
    buscarConjuntosMeta(idsDeConjunto(funil, resultados), d1, d2),
    buscarAnunciosMeta(idsDosAnuncios(leads, b.cards), d1, d2),
  ]);

  // Anúncio que gastou e não trouxe lead nem card: busca nos conjuntos que mais
  // gastaram (no máximo 5). Só o sócio recebe essas linhas.
  const porConjunto = qf.montarConjuntos(funil.conjuntos, resultados, mc.conjuntos);
  const maisGastaram = porConjunto.filter((c) => (c.gasto || 0) > 0).sort((a, b) => (b.gasto || 0) - (a.gasto || 0)).slice(0, 5).map((c) => c.id);
  const sg = await buscarAnunciosComGastoMeta(maisGastaram, d1, d2);

  const fimDoDia = ate ? diaBRT(Date.parse(ate) - 1) : diaBRT(Date.now());
  const dias = diasDoPeriodo(diaBRT(Date.parse(desde)), fimDoDia);
  return {
    periodo, desde, ate, funil,
    leads: qualidadeDosLeads(leads),
    resultado: resultadoDosCards(b.cards),
    porDia: montarPorDia(dias, b.visitas, b.eventos, b.cards),
    porAnuncio: acrescentarSoGasto(montarPorAnuncio(leads, b.cards, ma.anuncios, ma.ok), sg.anuncios),
    porConjunto,
    meta_ok: mc.ok && ma.ok && sg.ok,
    meta_motivo: mc.motivo || ma.motivo || sg.motivo || null,
  };
}
