// ───────────────────────────────────────────────────────────────────────────
// RESUMO DA DOMINA IA NO ADMIN (24/11/2026), para GET /admin/dominaia/resumo.
// Vendas e leads vêm da Stripe, lidos pelo site da Domina IA (api/admin-resumo.js, que
// só responde com o x-admin-token). O app (abriram, instalaram e as demais ações) vem de
// lp_events, pelo mesmo serviço do funil. Site fora ou sem env: 200 com indisponivel.
// O token só vai no cabeçalho: nunca entra em log, em motivo nem na resposta.
// ───────────────────────────────────────────────────────────────────────────
import { logger } from '../../utils/logger';
import { type AppDominaia, DOMINAIA_DESDE, appVazio } from './dominaiaCatalogo';
import { lerFunilDominaia, normalizarPeriodo } from './painelQuizDominaia';

export const URL_PADRAO_DOMINAIA = 'https://domina-ia.vercel.app';
export const TEMPO_LIMITE_MS = 12_000;
/** Primeiro dia da campanha da Domina IA: nenhum período começa antes daqui (antes é tráfego de teste). Vive no catálogo. */
export { DOMINAIA_DESDE };
/** O site recusa mais de 120 dias (MAX_DIAS em lib/admin-resumo.js), as duas pontas contam. */
export const MAX_DIAS_SITE = 120;

const SP = -3 * 3600_000;
const DIA = 86_400_000;

/** Um checkout aberto que não virou pagamento (bloco `checkouts` do site). `valor` em centavos. Sem ID nem dado de cartão. */
export interface CheckoutNaoPagoDominaia {
  criado: string;
  status: 'open' | 'expired' | string;
  plano: string | null;
  valor: number;
  pais: string | null;
  email: string;
  sid: string | null;
  /** decline_code, code, ou 'sem_tentativa' quando a pessoa não chegou a tentar pagar. */
  motivo: string;
  mensagem: string;
  metodo: string | null;
}

/** Quem abriu o pagamento e não pagou. Se a Stripe falhar ou recusar a permissão, só vem `indisponivel` e `motivo`. */
export type CheckoutsDominaia =
  | { indisponivel: true; motivo: string }
  | {
      indisponivel?: undefined;
      abertos: number;
      expirados: number;
      comFalha: number;
      /** Quem abriu o pagamento, voltou e pagou numa sessão nova: saiu da lista e entra aqui. */
      pagaramDepois: number;
      porMotivo: Record<string, number>;
      truncado: boolean;
      lista: CheckoutNaoPagoDominaia[];
    };

export interface ResumoDominaia {
  periodo: { desde: string; ate: string };
  atualizadoEm: string;
  truncado: boolean;
  indisponivel?: true;
  motivo?: string;
  vendas: Record<string, unknown>;
  leads: Record<string, unknown>;
  /** Vem do site (passa direto). Ausente se o site ainda não tem o bloco ou está fora do ar. */
  checkouts?: CheckoutsDominaia;
  app: AppDominaia;
}

/** Dia (AAAA-MM-DD) em America/Sao_Paulo (UTC-3, sem horário de verão). */
function diaSP(ms: number): string {
  return new Date(ms + SP).toISOString().slice(0, 10);
}

/** Converte o período do painel em desde/ate (inclusive), por dia de São Paulo. O início nunca é antes de DOMINAIA_DESDE; se o período inteiro é anterior (ontem, no dia da largada), desde fica depois de ate. */
export function periodoParaDatas(periodo: string, agora: Date = new Date()): { desde: string; ate: string } {
  const hoje = diaSP(agora.getTime());
  const antes = (dias: number): string => diaSP(agora.getTime() - dias * DIA);
  let desde: string;
  let ate = hoje;
  switch (normalizarPeriodo(periodo)) {
    case 'hoje': desde = hoje; break;
    case 'ontem': desde = antes(1); ate = desde; break;
    case '30dias': desde = antes(29); break;
    // Nunca passa de 120 dias: o mais tarde entre o primeiro dia e hoje menos 119.
    case 'maximo': desde = antes(MAX_DIAS_SITE - 1); break;
    default: desde = antes(6);
  }
  return { desde: desde > DOMINAIA_DESDE ? desde : DOMINAIA_DESDE, ate };
}

export function resumoVazio(periodo: { desde: string; ate: string }, agora: Date, app: AppDominaia, motivo: string): ResumoDominaia {
  return {
    periodo, atualizadoEm: agora.toISOString(), truncado: false, indisponivel: true, motivo,
    vendas: {
      compras: 0, comprasBasico: 0, comprasPlus: 0, upgrades: 0, receitaCentavos: 0, reembolsos: 0, reembolsadoCentavos: 0,
      contestacoes: 0, ticketMedioCentavos: 0, porDia: [], porPais: [], lista: [],
    },
    leads: { total: 0, compraram: 0, conversao: 0, porDia: [], lista: [] },
    app,
  };
}

type Resultado = { ok: true; corpo: Record<string, unknown> } | { ok: false; motivo: string };

/** Chama o site da Domina IA. Nunca lança e nunca devolve o token no motivo. */
export async function buscarResumoNoSite(
  desde: string, ate: string, env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<Resultado> {
  const token = (env.DOMINAIA_ADMIN_TOKEN || '').trim();
  if (!token) return { ok: false, motivo: 'DOMINAIA_ADMIN_TOKEN não configurado' };
  const base = (env.DOMINAIA_URL || '').trim().replace(/\/+$/, '') || URL_PADRAO_DOMINAIA;
  try {
    const r = await buscar(`${base}/api/admin-resumo?desde=${desde}&ate=${ate}`, {
      headers: { 'x-admin-token': token, accept: 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!r.ok) return { ok: false, motivo: `O site da Domina IA respondeu ${r.status}` };
    const corpo = (await r.json()) as Record<string, unknown> | null;
    if (!corpo || typeof corpo !== 'object' || !corpo.vendas || !corpo.leads) {
      return { ok: false, motivo: 'Resposta do site da Domina IA fora do formato' };
    }
    return { ok: true, corpo };
  } catch (err) {
    const nome = (err as Error)?.name;
    return { ok: false, motivo: nome === 'TimeoutError' || nome === 'AbortError' ? 'O site da Domina IA não respondeu em 12 s' : 'O site da Domina IA está fora do ar' };
  }
}

/** O pedaço do app, de lp_events. Se o banco falhar, zera: o painel ainda mostra vendas e leads. */
async function lerApp(periodo: string, agora: Date): Promise<AppDominaia> {
  try {
    return (await lerFunilDominaia(periodo, {}, agora)).app;
  } catch (err) {
    logger.warn('dominaia-resumo', 'app de lp_events falhou', { erro: String((err as Error)?.message || err) });
    return appVazio();
  }
}

export async function lerResumoDominaia(
  periodo: string, agora: Date = new Date(), env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<ResumoDominaia> {
  const datas = periodoParaDatas(periodo, agora);
  // Período inteiro antes da largada (ontem, no dia 24): nada a ler, e o site recusaria o período invertido.
  if (datas.desde > datas.ate) {
    const vazio = resumoVazio(datas, agora, await lerApp(periodo, agora), '');
    delete vazio.indisponivel; delete vazio.motivo;
    return vazio;
  }
  const [site, app] = await Promise.all([buscarResumoNoSite(datas.desde, datas.ate, env, buscar), lerApp(periodo, agora)]);
  if (!site.ok) {
    logger.warn('dominaia-resumo', 'indisponível', { motivo: site.motivo });
    return resumoVazio(datas, agora, app, site.motivo);
  }
  return { ...(site.corpo as unknown as ResumoDominaia), app };
}
