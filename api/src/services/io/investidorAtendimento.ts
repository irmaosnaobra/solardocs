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
  };
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
