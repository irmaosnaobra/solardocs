// ─────────────────────────────────────────────────────────────────────────────
// O DESCARTE DO QUIZ SOLAR (27/10/2026).
//
// Regra do dono: lead do quiz solar com nota abaixo de 70, ou de cidade fora da região, é DESCARTADO.
// Sem card, sem mensagem ao cliente, sem aviso à Nilce, sem Schedule nem LeadQuente.
// A região são as 114 cidades a até 200 km de Uberlândia (a mesma lista que a campanha mira), em
// `data/cidadesRegiaoSolar.json`. NÃO usar `acharCidadeRaio`/`CIDADES_RAIO`: aquilo é o raio de 150 km
// de ESTRADA da visita e ignora a UF.
//
// A regra que manda aqui é a de sempre: na dúvida, MANTÉM. Cidade que não resolveu (texto livre sem UF,
// nome repetido entre estados) devolve null e nunca descarta. Resolvida só pelo DDD do telefone também
// nunca descarta: o DDD serve para manter o lead, não para barrá-lo.
// ─────────────────────────────────────────────────────────────────────────────
import regiao from '../../data/cidadesRegiaoSolar.json';
import { cidadeCanonica } from './cidadeCanonica';
import { chaveMunicipio } from './cidadeParse';

export const NOTA_MINIMA_SOLAR = 70;

/** O prefixo da chave de system_state que guarda o lead descartado: `solar_quiz_descartado:<DDD+8>`. */
export const CHAVE_DESCARTADO = 'solar_quiz_descartado:';

export type MotivoDescarte = 'regiao' | 'nota';

/** "Uberlândia-MG" em chave de comparação (sem acento, caixa nem pontuação). */
const REGIAO: ReadonlySet<string> = new Set(
  (regiao as Array<{ nome: string; uf: string }>).map(c => chaveMunicipio(`${c.nome}-${c.uf}`)),
);

export const TOTAL_CIDADES_REGIAO = REGIAO.size;

/**
 * A cidade digitada está na região do solar?
 *   true  = está nas 114 cidades;
 *   false = resolveu para um município do IBGE (com a UF escrita pelo lead, ou capital) que NÃO está na lista;
 *   null  = não deu para saber. NUNCA descarta por região.
 * `telefone` entra só para a canonização ser a MESMA que grava a coluna `cidade`.
 */
export function cidadeNaRegiaoSolar(texto: unknown, telefone?: unknown): boolean | null {
  const c = cidadeCanonica(texto, telefone);
  if (c.status !== 'ok' && c.status !== 'ddd') return null;
  if (REGIAO.has(chaveMunicipio(c.valor))) return true;
  // Resolvida só pelo DDD do telefone: dentro da lista mantém, fora dela NÃO descarta.
  return c.status === 'ddd' ? null : false;
}

/** Por que este lead é descartado (a região tem prioridade), ou null se ele segue. */
export function motivoDescarteSolar(p: { pontos: number; cidade: unknown; telefone?: unknown }): MotivoDescarte | null {
  if (cidadeNaRegiaoSolar(p.cidade, p.telefone) === false) return 'regiao';
  if (p.pontos < NOTA_MINIMA_SOLAR) return 'nota';
  return null;
}

/** O "Município-UF" que a página mostra no título de quem é de fora da região, ou null se a cidade não resolveu. */
export function cidadeUfDoDescarte(texto: unknown, telefone?: unknown): string | null {
  const c = cidadeCanonica(texto, telefone);
  return c.status === 'ok' ? c.valor : null;
}
