// ─────────────────────────────────────────────────────────────────────────────
// O ENVIO PARA A PLANILHA ANTIGA (19/11/2026). O transporte é um POST para um Apps Script publicado como app da Web, ligado à planilha "CONTRATOS
// FECHADOS" (o código dele: `api/scripts/planilha-contratos-fechados.gs`). Envs, só os NOMES (nenhum valor em arquivo; o repositório é público):
//   PLANILHA_SCRIPT_URL       o endereço https do app da Web
//   PLANILHA_SCRIPT_SEGREDO   o segredo que o script confere (nas Script Properties dele)
// Sem as duas, o envio não acontece: `nao_ligada` (a rota devolve a lista para colar à mão). Timeout curto. Falha NUNCA lança e nunca desfaz nada: devolve
// o status. Nenhum valor, nome ou URL vai para log: só o código do status.
// ─────────────────────────────────────────────────────────────────────────────
import { ehColunaInterna, type ColunaPlanilha } from './planilhaContratos';

export const TEMPO_PLANILHA_MS = 8000;

export type StatusPlanilha = 'preenchida' | 'nada_a_gravar' | 'nao_ligada' | 'falhou';
export interface ResultadoPlanilha {
  status: StatusPlanilha;
  linha: number | null;
  gravadas: string[];
  puladas: Array<{ coluna: string; motivo: string }>;
  /** O código do motivo da falha (nunca texto de resposta). */
  motivo?: string;
}
const vazio = (status: StatusPlanilha, motivo?: string): ResultadoPlanilha => ({ status, linha: null, gravadas: [], puladas: [], ...(motivo ? { motivo } : {}) });

export interface DepsPlanilha { fetch?: typeof fetch; url?: string; segredo?: string; tempoMs?: number }

/** O número do código ("#0058" -> 58); null se não parece um código. */
export const numeroDoCodigo = (codigo: string | null | undefined): number | null => {
  const m = /^#?0*(\d{1,6})$/.exec(String(codigo ?? '').trim());
  return m ? Number(m[1]) : null;
};

export async function enviarParaPlanilha(codigo: string | null, colunas: readonly ColunaPlanilha[], deps: DepsPlanilha = {}): Promise<ResultadoPlanilha> {
  const url = deps.url ?? process.env.PLANILHA_SCRIPT_URL ?? '';
  const segredo = deps.segredo ?? process.env.PLANILHA_SCRIPT_SEGREDO ?? '';
  if (!url || !segredo) return vazio('nao_ligada');
  const numero = numeroDoCodigo(codigo);
  if (!numero) return vazio('falhou', 'sem_codigo');
  if (!/^https:\/\//i.test(url)) return vazio('falhou', 'url_invalida');
  const escreve = colunas.filter((c) => c.coluna !== 'A' && !ehColunaInterna(c.coluna));
  if (!escreve.length) return vazio('nada_a_gravar');
  const f = deps.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.tempoMs ?? TEMPO_PLANILHA_MS);
  try {
    const r = await f(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, redirect: 'follow',
      body: JSON.stringify({ segredo, codigo: numero, colunas: escreve.map((c) => ({ coluna: c.coluna, valor: c.valor, tipo: c.tipo })) }),
    });
    if (!r.ok) return vazio('falhou', `http_${r.status}`);
    const j = (await r.json().catch(() => null)) as { ok?: unknown; linha?: unknown; gravadas?: unknown; puladas?: unknown; erro?: unknown } | null;
    if (!j || j.ok !== true) return vazio('falhou', typeof j?.erro === 'string' && /^[a-z_]{1,40}$/.test(j.erro) ? j.erro : 'resposta_invalida');
    const gravadas = Array.isArray(j.gravadas) ? j.gravadas.filter((x): x is string => typeof x === 'string' && /^[A-Z]{1,2}$/.test(x)) : [];
    const puladas = (Array.isArray(j.puladas) ? j.puladas : []).flatMap((x): Array<{ coluna: string; motivo: string }> => {
      const o = x as { coluna?: unknown; motivo?: unknown } | null;
      return o && typeof o.coluna === 'string' && /^[A-Z]{1,2}$/.test(o.coluna) ? [{ coluna: o.coluna, motivo: typeof o.motivo === 'string' ? o.motivo.slice(0, 30) : '' }] : [];
    });
    return { status: gravadas.length ? 'preenchida' : 'nada_a_gravar', linha: typeof j.linha === 'number' ? j.linha : null, gravadas, puladas };
  } catch (e) {
    return vazio('falhou', (e as { name?: string } | null)?.name === 'AbortError' ? 'tempo' : 'rede');
  } finally { clearTimeout(timer); }
}
