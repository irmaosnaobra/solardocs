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
/** A chave da marca de um telefone (`alvo` = telKeySolar). O teste da sonda tem a chave dele. */
export const chaveDescartadoSolar = (alvo: string, teste: boolean): string => `${CHAVE_DESCARTADO}${teste ? 'teste_' : ''}${alvo}`;

/**
 * A marca de descarte vale contra este rascunho? Vale a tentativa MAIS RECENTE (23/11/2026): quem passou numa tentativa e foi descartado numa
 * seguinte não pode ganhar card nem abertura da Duda. `marcaEm` é o `em` da marca (ISO) e `atividadeMs` a última tentativa que gravou o rascunho.
 *   · sem marca: não vale;
 *   · marca mais nova que o rascunho (ou do mesmo instante): vale;
 *   · marca mais velha: o lead refez o quiz e passou depois, não vale;
 *   · marca sem horário legível, ou rascunho sem horário: NÃO dá para comparar, vale (pula sempre que a marca existir).
 */
export function marcaDescartaRascunho(marcaExiste: boolean, marcaEm: unknown, atividadeMs: number): boolean {
  if (!marcaExiste) return false;
  const m = Date.parse(String(marcaEm ?? ''));
  if (!Number.isFinite(m) || !Number.isFinite(atividadeMs)) return true;
  return m >= atividadeMs;
}

export type MotivoDescarte = 'regiao' | 'conta' | 'nota';

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

/** As faixas de conta abaixo de R$ 400: a atual (`ate400`) e a legada (`ate300`, que também fica abaixo). */
const CONTA_BAIXA: ReadonlySet<string> = new Set(['ate400', 'ate300']);

/**
 * Por que este lead é descartado, ou null se ele segue. A ordem é:
 *   1. região;
 *   2. conta (23/11/2026, decisão do dono): conta abaixo de R$ 400 E `aumento === 'nao'` (não vai aumentar o
 *      consumo). No histórico, 1 de 18 vendas tinha conta abaixo de R$ 400; quem vai aumentar o consumo
 *      (ar-condicionado, freezer, carro) segue. `aumento` vazio ou desconhecido NÃO descarta por conta: a mesma
 *      filosofia da região, dado que falta nunca descarta;
 *   3. nota abaixo de 70.
 */
export function motivoDescarteSolar(p: {
  pontos: number; cidade: unknown; telefone?: unknown; conta?: unknown; aumento?: unknown;
}): MotivoDescarte | null {
  if (cidadeNaRegiaoSolar(p.cidade, p.telefone) === false) return 'regiao';
  if (typeof p.conta === 'string' && CONTA_BAIXA.has(p.conta) && p.aumento === 'nao') return 'conta';
  if (p.pontos < NOTA_MINIMA_SOLAR) return 'nota';
  return null;
}

/** O "Município-UF" que a página mostra no título de quem é de fora da região, ou null se a cidade não resolveu. */
export function cidadeUfDoDescarte(texto: unknown, telefone?: unknown): string | null {
  const c = cidadeCanonica(texto, telefone);
  return c.status === 'ok' ? c.valor : null;
}
