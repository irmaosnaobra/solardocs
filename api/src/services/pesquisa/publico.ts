// ─────────────────────────────────────────────────────────────────────────────
// A LEITURA DO PÚBLICO DAS PESQUISAS (04/11/2026). SÓ LEITURA. Toda consulta é paginada (o PostgREST corta em 1000 linhas e ignora o
// .limit()); erro LANÇA, porque lista cortada também é "não saber" e quem chama não envia.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import {
  JANELA_PROPOSTAS_DIAS, ehExAssinante, ehGrandeUsuario, podeReceberEmail, type UsuarioPesq,
} from './regras';

const PAGINA = 1000;
const MAX_PAGINAS = 100;
const COLUNAS = 'id, email, nome, whatsapp, plano, billing_status, plano_expira_em, last_canceled_at, created_at, email_opt_out, whatsapp_opt_out, is_admin, pesquisa_sent_at';

export async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await pagina(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error('leitura paginada falhou');
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
  throw new Error('leitura paginada passou do limite');
}

const emLotes = <T>(lista: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};

/** As chaves de system_state com este prefixo: Map<o que vem depois do prefixo, { value, updated_at }>. */
export async function lerChavesPorPrefixo(prefixo: string): Promise<Map<string, { value: Record<string, unknown> | null; updated_at: string | null }>> {
  const linhas = await lerTudo<{ key: string; value: Record<string, unknown> | null; updated_at: string | null }>((de, ate) =>
    supabase.from('system_state').select('key, value, updated_at').like('key', `${prefixo}%`).order('key', { ascending: true }).range(de, ate));
  const mapa = new Map<string, { value: Record<string, unknown> | null; updated_at: string | null }>();
  for (const l of linhas) if (l.key.startsWith(prefixo)) mapa.set(l.key.slice(prefixo.length), { value: l.value, updated_at: l.updated_at });
  return mapa;
}

/** Os e-mails (minúsculos) com pelo menos uma venda paga de valor maior que 0. */
async function emailsComVendaPaga(): Promise<Set<string>> {
  const vendas = await lerTudo<{ email: string | null; valor: number | string | null; status: string | null }>((de, ate) =>
    supabase.from('sales').select('email, valor, status').eq('status', 'paid').order('id', { ascending: true }).range(de, ate));
  const s = new Set<string>();
  for (const v of vendas) if (Number(v.valor) > 0 && v.email) s.add(String(v.email).trim().toLowerCase());
  return s;
}

/** Ex-assinantes que podem receber o e-mail de saída, do que saiu há menos tempo para o mais antigo. */
export async function lerExAssinantes(agora: Date): Promise<UsuarioPesq[]> {
  const agoraMs = agora.getTime();
  const livres = await lerTudo<UsuarioPesq>((de, ate) =>
    supabase.from('users').select(COLUNAS).eq('plano', 'free').order('id', { ascending: true }).range(de, ate));
  const base = livres.filter(podeReceberEmail);
  if (!base.length) return [];
  const pagos = await emailsComVendaPaga();
  const saiu = (u: UsuarioPesq): number => Math.max(Date.parse(String(u.plano_expira_em ?? '')) || 0, Date.parse(String(u.last_canceled_at ?? '')) || 0);
  return base
    .filter(u => ehExAssinante(u, pagos.has(String(u.email ?? '').trim().toLowerCase()), agoraMs))
    .sort((a, b) => saiu(b) - saiu(a));
}

export interface GrandeUsuario { u: UsuarioPesq; propostas: number }

/** Pagantes com 20 ou mais propostas solares nos últimos 30 dias (os mais ativos primeiro). Não filtra e-mail nem telefone: cada canal filtra o seu. */
export async function lerGrandesUsuarios(agora: Date): Promise<GrandeUsuario[]> {
  const pagantes = (await lerTudo<UsuarioPesq>((de, ate) =>
    supabase.from('users').select(COLUNAS).in('plano', ['pro', 'ilimitado']).eq('billing_status', 'active').order('id', { ascending: true }).range(de, ate)));
  if (!pagantes.length) return [];
  const desde = new Date(agora.getTime() - JANELA_PROPOSTAS_DIAS * 24 * 3_600_000).toISOString();
  const conta = new Map<string, number>();
  for (const lote of emLotes(pagantes.map(u => u.id), 100)) {
    const docs = await lerTudo<{ user_id: string }>((de, ate) =>
      supabase.from('documents').select('user_id').in('user_id', lote).eq('tipo', 'propostaSolar').gte('created_at', desde)
        .order('created_at', { ascending: false }).range(de, ate));
    for (const d of docs) conta.set(d.user_id, (conta.get(d.user_id) ?? 0) + 1);
  }
  return pagantes
    .map(u => ({ u, propostas: conta.get(u.id) ?? 0 }))
    .filter(x => ehGrandeUsuario(x.u, x.propostas))
    .sort((a, b) => b.propostas - a.propostas);
}
