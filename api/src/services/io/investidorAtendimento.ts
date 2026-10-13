// ─────────────────────────────────────────────────────────────────────────────
// ATENDIMENTO DOS INVESTIDORES: o que a /gerador mostra nas colunas "Situação" e
// "Consultor" da aba Investidores.
//
// O estado de cada conversa da Helena mora no banco PRINCIPAL (`system_state`,
// chave `inv_agente:<DDD + 8 últimos>`) e o front do /gerador só enxerga o banco do
// Gerador. Esta leitura faz a ponte, SÓ LEITURA. Telefone inteiro não sai daqui:
// a tela casa pela `chave`, que ela mesma calcula do cadastro.
//
// Erro de leitura SOBE. Lista vazia por falha enganaria a tela (todo mundo
// "Na fila"); com o erro, a tela avisa que a situação está indisponível.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { INV_SESSAO_PREFIX } from './investidorAgentePosse';
import { lerTudo } from './investidorAgente';
// A marca da etiqueta de negócio do card (`etiqueta_card:<id>`): um nome só, o de salaDeEspera.
import { ETIQUETA_PREFIX as ETIQUETA_CARD_PREFIX, TIPO_CARD_PREFIX } from '../agenda/salaDeEspera';

export interface AtendimentoInvestidor {
  chave: string;
  estagio: string | null;
  consultor: string | null;
  motivo: string | null;
  aberto_em: string | null;
  /** `updated_at` da linha da sessão: quando a conversa andou pela última vez. */
  movimento_em: string | null;
  agendamento_id: number | null;
  resumo: string;
  /** A abertura não saiu (a pessoa nunca foi chamada). */
  erro_envio: boolean;
  /** `resgate` para quem veio do grupo dos cancelados; `null` na fila principal. */
  grupo: string | null;
  /** Número do último toque que a Helena mandou (retomadas); `null` na sessão que só teve o primeiro. */
  toques: number | null;
}

interface LinhaSessao { key: string; value: unknown; updated_at?: string | null }

const RESUMO_MAX = 300;

const texto = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
};

/** Puro: uma linha de `system_state` vira um item, ou `null` se o valor não é um objeto. */
export function mapearSessao(l: LinhaSessao): AtendimentoInvestidor | null {
  let v: unknown = l.value;
  // jsonb deve chegar como objeto, mas um valor gravado como texto JSON também vale.
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  const chave = String(l.key ?? '').slice(INV_SESSAO_PREFIX.length);
  if (!chave) return null;
  const ag = Number(s.agendamento_id);
  return {
    chave,
    estagio: texto(s.estagio),
    consultor: texto(s.consultor),
    motivo: texto(s.motivo),
    aberto_em: texto(s.aberto_em),
    movimento_em: texto(l.updated_at),
    agendamento_id: s.agendamento_id != null && Number.isFinite(ag) ? ag : null,
    resumo: typeof s.resumo === 'string' ? s.resumo.slice(0, RESUMO_MAX) : '',
    erro_envio: !!s.erro,
    grupo: texto(s.grupo),
    toques: Number.isInteger(s.toques) && Number(s.toques) >= 1 ? Number(s.toques) : null,
  };
}

/**
 * Puro: as linhas `etiqueta_card:<id>` de `system_state` viram `{ "<id>": "<etiqueta>" }`.
 * Valor que chega como texto JSON vale (como em `mapearSessao`); sem etiqueta, não entra.
 */
export function mapearEtiquetas(linhas: LinhaSessao[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of linhas) {
    const k = String(l.key ?? '');
    if (!k.startsWith(ETIQUETA_CARD_PREFIX)) continue;
    const id = k.slice(ETIQUETA_CARD_PREFIX.length);
    if (!id) continue;
    let v: unknown = l.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { continue; } }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const et = texto((v as Record<string, unknown>).etiqueta);
    if (et) out[id] = et;
  }
  return out;
}

/**
 * Todas as etiquetas de negócio guardadas nos cards: `{ "<id do card>": "<etiqueta>" }`.
 * A coluna Atendimento do /gerador cruza isto com o card pelo id. Leitura paginada;
 * erro de leitura SOBE, pelo mesmo motivo de `lerAtendimentos`.
 */
export async function lerEtiquetasDosCards(): Promise<Record<string, string>> {
  const linhas = await lerTudo<LinhaSessao>('etiquetas dos cards', (de, ate) =>
    supabase.from('system_state').select('key, value')
      .like('key', `${ETIQUETA_CARD_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  return mapearEtiquetas(linhas);
}

/**
 * Puro: as linhas `tipo_card:<id>` de `system_state` viram `{ "<id>": "<tipo>" }`.
 * O tipo é a memória do que o card é (cotista, arrendamento, integrador): a etiqueta
 * guardada some quando o consultor move o card, o tipo não. Mesmo tratamento de
 * `mapearEtiquetas` para texto JSON, lixo e valor vazio.
 */
export function mapearTipos(linhas: LinhaSessao[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of linhas) {
    const k = String(l.key ?? '');
    if (!k.startsWith(TIPO_CARD_PREFIX)) continue;
    const id = k.slice(TIPO_CARD_PREFIX.length);
    if (!id) continue;
    let v: unknown = l.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { continue; } }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const t = texto((v as Record<string, unknown>).tipo);
    if (t) out[id] = t;
  }
  return out;
}

/** Todos os tipos guardados nos cards: `{ "<id do card>": "<tipo>" }`. Leitura
 *  paginada; erro de leitura SOBE, como nas outras duas. */
export async function lerTiposDosCards(): Promise<Record<string, string>> {
  const linhas = await lerTudo<LinhaSessao>('tipos dos cards', (de, ate) =>
    supabase.from('system_state').select('key, value')
      .like('key', `${TIPO_CARD_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  return mapearTipos(linhas);
}

export async function lerAtendimentos(): Promise<AtendimentoInvestidor[]> {
  const linhas = await lerTudo<LinhaSessao>('atendimento dos investidores', (de, ate) =>
    supabase.from('system_state').select('key, value, updated_at')
      .like('key', `${INV_SESSAO_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  const itens: AtendimentoInvestidor[] = [];
  for (const l of linhas) {
    const item = mapearSessao(l);
    if (item) itens.push(item);
  }
  return itens;
}
