// ─────────────────────────────────────────────────────────────────────────────
// A DIVISÃO DOS LEADS SOLARES POR CONTA DE LUZ: quem recebe o próximo (decisão do dono, 23/11/2026)
//
// Substitui o "só a Nilce atende solar" de 24/10. A tabela e a ordem por déficit (a parte pura) moram em solarRota.ts
// (`GRUPOS_SOLAR`, `ordenarPorDeficit`); aqui mora o que precisa do banco:
//   · conta os cards SOLARES dos últimos 30 dias (e nunca antes de `SOLAR_DIVISAO_INICIO`: o passado da Nilce sozinha não conta) por `vendedor_nome`, separados pelo grupo de cada card (pela observação:
//     "Conta de luz:" do quiz, em reais, ou "Consumo:" do Meta, em kWh, e do ManyChat, em reais). Fora da conta: card
//     cancelado, card SAIU SEM MARCAR, card de teste (origem fora de `ORIGENS_SOLAR_DIVISAO`) e dono fora dos quatro.
//   · devolve a LISTA ordenada de candidatos (quem está mais abaixo da fatia vem primeiro), para quem chamou cair no próximo
//     se o primeiro não tiver horário.
//   · cache de 60 s na contagem. Quem cria o card de um lote (o sync do Meta) passa `reservar: true` e a escolha já entra na
//     contagem em memória, senão 5 leads no mesmo minuto cairiam todos na mesma pessoa.
//   · banco fora do ar: devolve a ordem da tabela (a Nilce primeiro). Nunca lança.
//   · kill-switch: `SOLAR_DIVISAO_OFF=1` volta a ser só a Nilce.
// Cliente que JÁ tem dono (`donoDoTelefone`) fica com ele e nunca passa por aqui.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { lerPaginado } from '../../utils/lerPaginado';
import { ehCardSaiu, ordenarPorDeficit, candidatosPadrao, divisaoSolarDesligada, grupoDaConta, grupoDaFaixaConta, reaisDoKwh, GRUPOS_SOLAR, DONOS_DE_SOLAR, SOLAR_DIVISAO_INICIO, type GrupoSolar } from './solarRota';
import { consumoTipico } from './leadSolarFicha';

/** As origens de card de solar (a mesma lista de `SOLAR_ORIGENS` em io/solarBoasVindas.ts, que um teste confere; aqui é cópia
 *  para o `agenda/` não importar um módulo de `io/` inteiro). */
export const ORIGENS_SOLAR_DIVISAO = ['lead-meta', 'leads-meta', 'lp_solar', 'manychat'] as const;
export { SOLAR_DIVISAO_INICIO };
export const JANELA_DIAS_DIVISAO = 30;
export const CACHE_DIVISAO_MS = 60_000;

/** De quando a contagem olha: os últimos 30 dias, mas nunca antes do início da divisão (`SOLAR_DIVISAO_INICIO`). */
export function desdeDaContagem(agoraMs: number, inicio: string = SOLAR_DIVISAO_INICIO): string {
  const janela = agoraMs - JANELA_DIAS_DIVISAO * 86_400_000;
  const ini = Date.parse(inicio);
  return new Date(Number.isFinite(ini) ? Math.max(janela, ini) : janela).toISOString();
}

export type Contagem = Record<GrupoSolar, Record<string, number>>;
const contagemVazia = (): Contagem => ({ menor: {}, maior: {} });

const reaisDe = reaisDoKwh;

// ── O grupo de um card, pela observação ─────────────────────────────────────
/** A conta em REAIS que a observação da ficha traz, ou null. "Conta de luz:" (quiz, em reais) vale antes de "Consumo:" (Meta em
 *  kWh, ManyChat em reais; a pista da unidade é o "R$" no valor). O que vem depois de "(" ou "·" não é a resposta. */
export function reaisDaObservacao(observacao: unknown): number | null {
  const obs = String(observacao ?? '');
  const conta = (/Conta de luz:\s*([^\n·(]+)/i.exec(obs) ?? [])[1]?.trim();
  if (conta) {
    const kwh = consumoTipico(conta, 'reais');
    if (kwh > 0) return reaisDe(kwh);
  }
  const consumo = (/Consumo:\s*([^\n·]+)/i.exec(obs) ?? [])[1]?.trim();
  if (consumo) {
    const emReais = /r\$/i.test(consumo);
    const kwh = consumoTipico(consumo, emReais ? 'reais' : 'kwh');
    if (kwh > 0) return reaisDe(kwh);
  }
  return null;
}
export const grupoDaObservacao = (observacao: unknown): GrupoSolar => grupoDaConta(reaisDaObservacao(observacao));

/** Soma os cards por grupo e por dono. Pura (testada sem banco). */
export function contarCards(rows: ReadonlyArray<{ vendedor_nome?: unknown; observacao?: unknown; status?: unknown }>): Contagem {
  const out = contagemVazia();
  for (const r of rows) {
    const nome = String(r.vendedor_nome ?? '').trim();
    if (!DONOS_DE_SOLAR.includes(nome)) continue;
    if (String(r.status ?? '') === 'cancelado') continue;
    if (ehCardSaiu(r.observacao)) continue;
    const g = grupoDaObservacao(r.observacao);
    if (!Object.prototype.hasOwnProperty.call(GRUPOS_SOLAR[g], nome)) continue;   // dono fora da tabela daquele grupo não conta
    out[g][nome] = (out[g][nome] ?? 0) + 1;
  }
  return out;
}

// ── A leitura no banco, com cache ───────────────────────────────────────────
let cache: { em: number; contagem: Contagem } | null = null;
/** Para os testes. */
export const _limparCacheDivisao = (): void => { cache = null; };

async function lerContagem(agoraMs: number): Promise<Contagem | null> {
  if (cache && agoraMs - cache.em < CACHE_DIVISAO_MS) return cache.contagem;
  try {
    const desde = desdeDaContagem(agoraMs);
    const rows = await lerPaginado<Record<string, unknown>>('divisao-solar', (p0, p1) => supabaseGerador.from('agendamentos')
      .select('id, vendedor_nome, observacao, status')
      .in('created_by', [...ORIGENS_SOLAR_DIVISAO])
      .in('vendedor_nome', [...DONOS_DE_SOLAR])
      .neq('status', 'cancelado')
      .gte('created_at', desde)
      .order('id', { ascending: true })
      .range(p0, p1));
    cache = { em: agoraMs, contagem: contarCards(rows) };
    return cache.contagem;
  } catch (err) {
    logger.error('divisao-solar', 'nao consegui contar os cards: vale a ordem da tabela', err);
    return null;
  }
}

/** Carrega a contagem no cache (ou renova, se venceu). Nunca lança. Quem precisa da lista de forma SÍNCRONA (a Duda, `alvoDaAgenda`) chama isto
 *  antes e depois lê `candidatosEmCache`. */
export async function aquecerDivisao(agoraMs: number = Date.now()): Promise<void> {
  if (divisaoSolarDesligada()) return;
  await lerContagem(agoraMs);
}

/** A lista do grupo pela ÚLTIMA contagem lida (de qualquer idade), sem banco. Sem cache ainda: a ordem da tabela. Só para quem não pode esperar. */
export function candidatosEmCache(g: GrupoSolar): string[] {
  if (divisaoSolarDesligada() || !cache) return candidatosPadrao(g);
  return ordenarPorDeficit(g, cache.contagem[g]);
}

/** Os candidatos do grupo, do que está mais abaixo da fatia para o que está mais acima. Nunca lança. `reservar`: a escolha
 *  (o 1º da lista) entra na contagem em memória, para o próximo lead do mesmo lote não cair na mesma pessoa. */
export async function candidatosDoGrupo(g: GrupoSolar, opt: { reservar?: boolean; agoraMs?: number } = {}): Promise<string[]> {
  if (divisaoSolarDesligada()) return candidatosPadrao(g);
  const contagem = await lerContagem(opt.agoraMs ?? Date.now());
  if (!contagem) return candidatosPadrao(g);
  const lista = ordenarPorDeficit(g, contagem[g]);
  if (opt.reservar && lista.length) contagem[g][lista[0]] = (contagem[g][lista[0]] ?? 0) + 1;
  return lista;
}

/** Quiz: pela faixa da conta (`ate400`, `400_800`, `800_1200`, `1200_mais` e as legadas). */
export const candidatosPorFaixa = (conta: unknown, opt?: { reservar?: boolean }): Promise<string[]> =>
  candidatosDoGrupo(grupoDaFaixaConta(conta), opt);

/** Meta (formulário): o consumo vem em kWh ("700 a 900"), convertido pela tarifa. Sem consumo legível: grupo menor. */
export function grupoPorKwh(consumo: string): GrupoSolar {
  const kwh = consumoTipico(consumo, 'kwh');
  return grupoDaConta(kwh > 0 ? reaisDe(kwh) : null);
}
export const candidatosPorKwh = (consumo: string, opt?: { reservar?: boolean }): Promise<string[]> =>
  candidatosDoGrupo(grupoPorKwh(consumo), opt);

/** ManyChat (DM): a conta vem em reais ("R$ 800 a R$ 1.500"). Sem valor legível: grupo menor. */
export function grupoPorReais(valorConta: string): GrupoSolar {
  const kwh = consumoTipico(valorConta, 'reais');
  return grupoDaConta(kwh > 0 ? reaisDe(kwh) : null);
}
export const candidatosPorReais = (valorConta: string, opt?: { reservar?: boolean }): Promise<string[]> =>
  candidatosDoGrupo(grupoPorReais(valorConta), opt);
