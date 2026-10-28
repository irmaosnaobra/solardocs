import { supabase } from '../../utils/supabase';

// Pedaços compartilhados pelas rotas autenticadas (/manutencoes) e pelas públicas (/m):
// bucket, validação de UUID, detecção de "tabela ainda não existe" e as signed URLs.

export const BUCKET = 'documentos';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FotoReg = { path: string; ts: string };
export type FotosMap = Record<string, FotoReg[]>;
export type AssinReg = { path: string; nome: string; registro?: string; ts: string };
export type AssinMap = { tecnico?: AssinReg; cliente?: AssinReg };

export interface LinhaManutencao {
  id: string;
  user_id: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  codigo: string | null;
  status: 'em_andamento' | 'concluida' | string;
  selo: string | null;
  data_inspecao: string;
  proxima_visita: string | null;
  dados: Record<string, unknown>;
  fotos: FotosMap;
  assinaturas: AssinMap;
  concluida_em: string | null;
  created_at: string;
  updated_at: string;
}

/** A migration ainda não rodou: PostgREST devolve PGRST205, o Postgres puro 42P01. */
export function tabelaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01';
}

export function fotosDe(l: { fotos?: unknown }): FotosMap {
  const f = l.fotos;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
  const out: FotosMap = {};
  for (const [g, lista] of Object.entries(f as Record<string, unknown>)) {
    if (Array.isArray(lista)) out[g] = lista.filter((x): x is FotoReg => !!x && typeof (x as FotoReg).path === 'string');
  }
  return out;
}

export function assinaturasDe(l: { assinaturas?: unknown }): AssinMap {
  const a = l.assinaturas;
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as AssinMap) : {};
}

async function assinar(path: string, segundos = 3600): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** Signed URLs de 1 hora, geradas na hora (nunca guardadas). */
export async function urlsAssinadas(l: { fotos?: unknown; assinaturas?: unknown }): Promise<{
  fotos_url: Record<string, { path: string; url: string | null }[]>;
  assinaturas_url: { tecnico?: string; cliente?: string };
}> {
  const fotos = fotosDe(l);
  const entradas = await Promise.all(
    Object.entries(fotos).map(async ([grupo, lista]) => [
      grupo,
      await Promise.all(lista.map(async (f) => ({ path: f.path, url: await assinar(f.path) }))),
    ] as const),
  );
  const ass = assinaturasDe(l);
  const assinaturas_url: { tecnico?: string; cliente?: string } = {};
  for (const quem of ['tecnico', 'cliente'] as const) {
    const reg = ass[quem];
    if (reg?.path) {
      const u = await assinar(reg.path);
      if (u) assinaturas_url[quem] = u;
    }
  }
  return { fotos_url: Object.fromEntries(entradas), assinaturas_url };
}

export const assinarCaminho = assinar;
