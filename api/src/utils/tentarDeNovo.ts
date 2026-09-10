// ─────────────────────────────────────────────────────────────────────────────
// Retry com espera crescente — e o que NUNCA pode ser retentado.
//
// A regra que importa aqui não é "tente 3 vezes". É saber quando a primeira
// tentativa JÁ ENTREGOU e repetir vira dano.
//
// O caso registrado: o Instagram devolve HTTP 500 / code 1 e MANDA a mensagem
// assim mesmo. Retry cego ali dobra a DM do lead — a pessoa recebe duas vezes e
// a conta fica marcada como repetitiva. Por isso `entregaIncerta` existe: quem
// chama declara se aquele erro pode ter entregue, e nesse caso não se retenta.
//
// Vale para toda chamada de saída com o mesmo formato: Z-Api, Meta, Asaas.
// ─────────────────────────────────────────────────────────────────────────────

import pRetry, { AbortError } from 'p-retry';

export interface OpcoesTentativa {
  /** Quantas tentativas no total, contando a primeira. Padrão 3. */
  tentativas?: number;
  /** Espera inicial em ms; dobra a cada tentativa. Padrão 500. */
  esperaInicialMs?: number;
  /** Teto da espera em ms. Padrão 8s — acima disso a fila já devolveu. */
  esperaMaximaMs?: number;
  /**
   * Recebe o erro e responde: "essa falha pode ter ENTREGUE mesmo assim?".
   * Respondendo `true`, a tentativa para na hora. É o disjuntor do 500/code 1
   * do Instagram. Sem isso, o padrão é retentar.
   */
  entregaIncerta?: (erro: unknown) => boolean;
  /** Nome curto para o log saber de quem está falando. */
  rotulo?: string;
}

/** Falhas que passam sozinhas e valem uma segunda tentativa. */
export function ehFalhaPassageira(erro: unknown): boolean {
  const e = String((erro as { message?: string })?.message ?? erro ?? '').toLowerCase();
  if (e.includes('rate_limit') || e.includes('overloaded') || e.includes('too many requests')) return true;
  if (e.includes('etimedout') || e.includes('econnreset') || e.includes('fetch failed')) return true;
  if (/\b(408|425|429|500|502|503|504|529)\b/.test(e)) return true;
  return false;
}

/**
 * Roda `tarefa` com espera crescente. Só retenta falha passageira — erro de
 * chave, de permissão ou de payload não melhora repetindo.
 */
export async function tentarDeNovo<T>(
  tarefa: () => Promise<T>,
  opcoes: OpcoesTentativa = {}
): Promise<T> {
  const {
    tentativas = 3,
    esperaInicialMs = 500,
    esperaMaximaMs = 8000,
    entregaIncerta,
    rotulo = 'chamada',
  } = opcoes;

  return pRetry(
    async () => {
      try {
        return await tarefa();
      } catch (erro) {
        // 1) Pode ter entregue? Então parar é mais seguro que repetir.
        if (entregaIncerta?.(erro)) {
          throw new AbortError(
            `[${rotulo}] parado sem retry: a falha pode ter entregue mesmo assim — ${String(
              (erro as { message?: string })?.message ?? erro
            )}`
          );
        }
        // 2) Falha definitiva não melhora repetindo.
        if (!ehFalhaPassageira(erro)) {
          throw new AbortError(erro as Error);
        }
        throw erro;
      }
    },
    {
      retries: Math.max(0, tentativas - 1),
      factor: 2,
      minTimeout: esperaInicialMs,
      maxTimeout: esperaMaximaMs,
      randomize: true,
    }
  );
}
