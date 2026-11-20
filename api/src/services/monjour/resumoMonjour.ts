// ───────────────────────────────────────────────────────────────────────────
// RESUMO DO MONJOUR NO ADMIN (19/11/2026), para GET /admin/monjour/resumo.
// Vendas e leads vêm da Stripe, lidos pelo site do Monjour (api/admin-resumo.js, que
// só responde com o x-admin-token). O app (abriram, instalaram, upgradeClicks) vem de
// lp_events, pelo mesmo serviço do funil. Site fora ou sem env: 200 com indisponivel.
// O token só vai no cabeçalho: nunca entra em log, em motivo nem na resposta.
// ───────────────────────────────────────────────────────────────────────────
import { logger } from '../../utils/logger';
import { lerFunilMonjour, normalizarPeriodo } from './painelQuizMonjour';

export const URL_PADRAO_MONJOUR = 'https://monjour-natural.vercel.app';
export const TEMPO_LIMITE_MS = 12_000;
/** Primeiro dia do Monjour no ar: o "maximo" começa aqui. */
export const MONJOUR_DESDE = '2026-11-19';
/** O site recusa mais de 120 dias (MAX_DIAS em lib/admin-resumo.js), as duas pontas contam. */
export const MAX_DIAS_SITE = 120;

const SP = -3 * 3600_000;
const DIA = 86_400_000;

export interface AppMonjour { abriram: number; instalaram: number; upgradeClicks: number }

/** Um checkout aberto que não virou pagamento (bloco `checkouts` do site). `valor` em centavos. Sem ID nem dado de cartão. */
export interface CheckoutNaoPagoMonjour {
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
export type CheckoutsMonjour =
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
      lista: CheckoutNaoPagoMonjour[];
    };

export interface ResumoMonjour {
  periodo: { desde: string; ate: string };
  atualizadoEm: string;
  truncado: boolean;
  indisponivel?: true;
  motivo?: string;
  vendas: Record<string, unknown>;
  leads: Record<string, unknown>;
  /** Vem do site (passa direto). Ausente se o site ainda não tem o bloco ou está fora do ar. */
  checkouts?: CheckoutsMonjour;
  app: AppMonjour;
}

/** Dia (AAAA-MM-DD) em America/Sao_Paulo (UTC-3, sem horário de verão). */
function diaSP(ms: number): string {
  return new Date(ms + SP).toISOString().slice(0, 10);
}

/** Converte o período do painel em desde/ate (inclusive), por dia de São Paulo. */
export function periodoParaDatas(periodo: string, agora: Date = new Date()): { desde: string; ate: string } {
  const hoje = diaSP(agora.getTime());
  const antes = (dias: number): string => diaSP(agora.getTime() - dias * DIA);
  switch (normalizarPeriodo(periodo)) {
    case 'hoje': return { desde: hoje, ate: hoje };
    case 'ontem': return { desde: antes(1), ate: antes(1) };
    case '30dias': return { desde: antes(29), ate: hoje };
    case 'maximo': {
      // Nunca passa de 120 dias: o mais tarde entre o primeiro dia e hoje menos 119.
      const limite = antes(MAX_DIAS_SITE - 1);
      return { desde: limite > MONJOUR_DESDE ? limite : MONJOUR_DESDE, ate: hoje };
    }
    default: return { desde: antes(6), ate: hoje };
  }
}

const APP_VAZIO = (): AppMonjour => ({ abriram: 0, instalaram: 0, upgradeClicks: 0 });

export function resumoVazio(periodo: { desde: string; ate: string }, agora: Date, app: AppMonjour, motivo: string): ResumoMonjour {
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

/** Chama o site do Monjour. Nunca lança e nunca devolve o token no motivo. */
export async function buscarResumoNoSite(
  desde: string, ate: string, env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<Resultado> {
  const token = (env.MONJOUR_ADMIN_TOKEN || '').trim();
  if (!token) return { ok: false, motivo: 'MONJOUR_ADMIN_TOKEN não configurado' };
  const base = (env.MONJOUR_URL || '').trim().replace(/\/+$/, '') || URL_PADRAO_MONJOUR;
  try {
    const r = await buscar(`${base}/api/admin-resumo?desde=${desde}&ate=${ate}`, {
      headers: { 'x-admin-token': token, accept: 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!r.ok) return { ok: false, motivo: `O site do Monjour respondeu ${r.status}` };
    const corpo = (await r.json()) as Record<string, unknown> | null;
    if (!corpo || typeof corpo !== 'object' || !corpo.vendas || !corpo.leads) {
      return { ok: false, motivo: 'Resposta do site do Monjour fora do formato' };
    }
    return { ok: true, corpo };
  } catch (err) {
    const nome = (err as Error)?.name;
    return { ok: false, motivo: nome === 'TimeoutError' || nome === 'AbortError' ? 'O site do Monjour não respondeu em 12 s' : 'O site do Monjour está fora do ar' };
  }
}

/** O pedaço do app, de lp_events. Se o banco falhar, zera: o painel ainda mostra vendas e leads. */
async function lerApp(periodo: string, agora: Date): Promise<AppMonjour> {
  try {
    return (await lerFunilMonjour(periodo, {}, agora)).app;
  } catch (err) {
    logger.warn('monjour-resumo', 'app de lp_events falhou', { erro: String((err as Error)?.message || err) });
    return APP_VAZIO();
  }
}

export async function lerResumoMonjour(
  periodo: string, agora: Date = new Date(), env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<ResumoMonjour> {
  const datas = periodoParaDatas(periodo, agora);
  const [site, app] = await Promise.all([buscarResumoNoSite(datas.desde, datas.ate, env, buscar), lerApp(periodo, agora)]);
  if (!site.ok) {
    logger.warn('monjour-resumo', 'indisponível', { motivo: site.motivo });
    return resumoVazio(datas, agora, app, site.motivo);
  }
  return { ...(site.corpo as unknown as ResumoMonjour), app };
}
