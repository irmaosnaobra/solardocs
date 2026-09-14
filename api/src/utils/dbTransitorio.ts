// Erro de banco NÃO é "não achei".
//
// O supabase-js não lança: devolve { data: null, error }. Quem lê só o `data`
// transforma um 504 do gateway em "usuário não existe". Em 14/09/2026 isso foi
// visto ao vivo: login 200 e, um segundo depois, /auth/me 404 "Usuário não
// encontrado" no mesmo instante de um 504 do Supabase. No login a mesma falha
// vira "E-mail ou senha incorretos" com a senha certa, e a pessoa vai trocar a
// senha à toa.
//
// Aqui fica a regra: erro transitório ganha UMA retentativa curta; se sobrar,
// vira BancoIndisponivel (a rota responde 503 com mensagem de instabilidade).
// Erro que não é transitório vira exceção comum. Nunca vira `null`.
import type { Response } from 'express';

export const MSG_INSTABILIDADE = 'Instabilidade momentânea. Tente de novo em instantes.';

export class BancoIndisponivel extends Error {
  constructor(public readonly causa: unknown) {
    super('BANCO_INDISPONIVEL');
    this.name = 'BancoIndisponivel';
  }
}

type ErroDb = { code?: string; message?: string } | null | undefined;
/** Formato da resposta do supabase-js: sucesso { data, error: null } ou falha { data: null, error }. */
type RespostaDb = { data: unknown; error: ErroDb; status?: number };

// status 0: fetch que falhou ou foi abortado (o postgrest-js devolve assim).
// 408 e 5xx: gateway ou pool do PostgREST. 57014: statement timeout.
// 08xxx: conexão. PGRST000 a PGRST003: PostgREST sem conexão com o banco.
export function ehTransitorio(r: { error?: ErroDb; status?: number }): boolean {
  if (!r.error) return false;
  const status = r.status ?? 0;
  const code = String(r.error.code ?? '');
  return status === 0 || status === 408 || status >= 500
    || code === '57014' || code.startsWith('08') || /^PGRST00[0-3]$/.test(code)
    || /fetch failed|timeout|ECONNRESET|AbortError/i.test(String(r.error.message ?? ''));
}

/** Lê do banco com uma retentativa curta em erro transitório. A consulta vem como
 *  fábrica porque o builder do supabase-js só pode ser disparado uma vez. O tipo
 *  sai da resposta inteira: tirar só do `data` fazia o TypeScript deduzir `never`. */
export async function lerDoBanco<R extends RespostaDb>(consulta: () => PromiseLike<R>, esperaMs = 400): Promise<R['data']> {
  let r = await consulta();
  if (r.error && ehTransitorio(r)) {
    await new Promise((ok) => setTimeout(ok, esperaMs));
    r = await consulta();
  }
  if (r.error) throw falhaDoBanco(r.error, r.status);
  return r.data;
}

/** Erro de gravação que o supabase-js devolveu sem lançar, já classificado. */
export function falhaDoBanco(error: ErroDb, status?: number): Error {
  if (ehTransitorio({ error, status })) return new BancoIndisponivel(error);
  return Object.assign(new Error(error?.message ?? 'erro de banco'), { causa: error });
}

export function responder503(res: Response, contexto: string, causa: unknown): void {
  console.error(`[${contexto}] banco indisponível:`, causa);
  res.status(503).set('Retry-After', '5').json({ error: MSG_INSTABILIDADE });
}
