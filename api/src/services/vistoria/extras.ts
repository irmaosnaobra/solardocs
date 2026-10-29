import { supabase } from '../../utils/supabase';
import { sanitizarStatus, MapaStatus } from './avaliacao';
import { Compras, comprasVazio, sanitizarCompras } from './compras';

// Colunas novas da vistoria (status_itens e assinaturas). Elas só existem depois que o
// dono roda MIGRATION_vistoria_avaliacao.sql, então NENHUM select antigo pode pedi-las:
// a leitura passa por aqui e, se a coluna não existe, devolve vazio em vez de derrubar a rota.

export const BUCKET = 'documentos';

export type AssinReg = { path: string; nome: string; registro?: string; ts: string };
export type AssinMap = { tecnico?: AssinReg; cliente?: AssinReg };

export interface Extras {
  status_itens: MapaStatus;
  assinaturas: AssinMap;
  disponivel: boolean;
}

/** Erro de "coluna não existe": 42703 no Postgres, PGRST204 no PostgREST, ou a mensagem. */
export function colunaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const m = String(error.message ?? '').toLowerCase();
  return m.includes('column') && (m.includes('does not exist') || m.includes('could not find'));
}

export function assinaturasDe(bruto: unknown): AssinMap {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const src = bruto as Record<string, unknown>;
  const out: AssinMap = {};
  for (const quem of ['tecnico', 'cliente'] as const) {
    const r = src[quem] as AssinReg | undefined;
    if (r && typeof r === 'object' && typeof r.path === 'string') out[quem] = r;
  }
  return out;
}

/**
 * Lê as colunas novas. Só "coluna não existe" vira disponivel=false (a migration ainda não rodou).
 * Qualquer outro erro (rede, permissão, banco fora) LANÇA: tratar como "sem migration" esconderia a
 * falha e deixaria a rota de escrita gravar por cima do que não conseguiu ler.
 */
export async function lerExtras(id: string): Promise<Extras> {
  const { data, error } = await supabase.from('vistorias').select('status_itens, assinaturas').eq('id', id).maybeSingle();
  if (error) {
    if (colunaAusente(error)) return { status_itens: {}, assinaturas: {}, disponivel: false };
    throw new Error(`falha lendo status_itens e assinaturas: ${error.message ?? error.code ?? 'erro'}`);
  }
  const d = (data ?? {}) as { status_itens?: unknown; assinaturas?: unknown };
  return { status_itens: sanitizarStatus(d.status_itens), assinaturas: assinaturasDe(d.assinaturas), disponivel: true };
}

export interface ComprasLidas {
  compras: Compras;
  disponivel: boolean;
}

/**
 * Lê a lista de compras (coluna `compras`, criada por MIGRATION_vistoria_compras.sql). Fica separada do
 * lerExtras de propósito: se a coluna nova entrasse no select dele e só ela faltasse, status e assinatura
 * sumiriam junto (uma flag só). Aqui a flag é própria.
 *
 * Só "coluna não existe" vira disponivel=false. Qualquer outro erro LANÇA, para a rota de escrita não gravar
 * por cima do que não conseguiu ler. A leitura é tolerante: '{}' (o padrão da coluna) é lista vazia e visível.
 */
export async function lerCompras(id: string): Promise<ComprasLidas> {
  const { data, error } = await supabase.from('vistorias').select('compras').eq('id', id).maybeSingle();
  if (error) {
    if (colunaAusente(error)) return { compras: comprasVazio(), disponivel: false };
    throw new Error(`falha lendo compras: ${error.message ?? error.code ?? 'erro'}`);
  }
  return { compras: sanitizarCompras((data as { compras?: unknown } | null)?.compras), disponivel: true };
}

/** Signed URLs de 1 hora das assinaturas, geradas na hora (nunca guardadas). */
export async function urlsDasAssinaturas(ass: AssinMap): Promise<{ tecnico?: string; cliente?: string }> {
  const out: { tecnico?: string; cliente?: string } = {};
  for (const quem of ['tecnico', 'cliente'] as const) {
    const reg = ass[quem];
    if (!reg?.path) continue;
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(reg.path, 3600);
      if (data?.signedUrl) out[quem] = data.signedUrl;
    } catch { /* sem URL: a tela mostra só o nome */ }
  }
  return out;
}
