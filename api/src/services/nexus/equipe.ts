// Equipe do Portal do Parceiro NEXUS (v4): quem entra no ADM com o login do SolarDoc.
// Duas portas: users.is_admin = true, ou o e-mail ativo na tabela nexus_equipe (papel 'admin' ou 'socio').
//
// A tabela nexus_equipe é OPCIONAL (a sonda de "portal ligado" não a exige). Ausente, ela vale como lista vazia e só
// is_admin entra. Por isso esta leitura NÃO lança ErroBanco para tabela ausente: o responderErro marcaria o portal inteiro
// como desligado por 60 s (a regex de tabelaAusente casa "nexus_...").
//
// Este arquivo só importa o supabase (não importa repositorio.ts) para o repositorio poder chamar acessoAdm sem ciclo.

import { supabase } from '../../utils/supabase';

export type PapelEquipe = 'admin' | 'socio';
export const PAPEIS_EQUIPE: readonly PapelEquipe[] = ['admin', 'socio'];

export interface MembroEquipe {
  id: string;
  email: string;
  /** users.id da conta no momento da liberação. O acesso só vale se o JWT for DESTA conta (null = linha antiga: não entra). */
  user_id: string | null;
  papel: PapelEquipe;
  ativo: boolean;
  criado_por: string | null;
  created_at: string | null;
}

/** 42P01 (Postgres) e PGRST205 (PostgREST) = a tabela nexus_equipe não existe (a seção v4 da migration não rodou). */
export function equipeSemTabela(causa: { code?: string; message?: string } | null | undefined): boolean {
  if (!causa) return false;
  const code = String(causa.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /could not find the table .*nexus_equipe|relation .*nexus_equipe.* does not exist/i.test(String(causa.message ?? ''));
}

/** Erro do banco que NÃO é tabela ausente. A rota responde 500 (nunca libera acesso por causa dele). */
export class ErroEquipe extends Error {
  constructor(causa: { message?: string } | null | undefined, contexto: string) {
    super(`${contexto}: ${causa?.message ?? 'erro do banco'}`);
  }
}

export const normalizarEmail = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** O membro da equipe com este e-mail (qualquer estado), ou null. Tabela ausente = null. */
export async function membroPorEmail(email: string): Promise<MembroEquipe | null> {
  const e = normalizarEmail(email);
  if (!e) return null;
  const { data, error } = await supabase
    .from('nexus_equipe')
    .select('id, email, user_id, papel, ativo, criado_por, created_at')
    .eq('email', e)
    .limit(1);
  if (error) {
    if (equipeSemTabela(error)) return null;
    throw new ErroEquipe(error, 'leitura da equipe NEXUS');
  }
  const m = ((data as MembroEquipe[] | null) ?? [])[0];
  return m ?? null;
}

/**
 * Papel ATIVO em nexus_equipe, ou null (sem linha, inativa, tabela ausente ou user_id diferente). A linha só vale para a
 * conta cujo users.id foi gravado na liberação: o e-mail sozinho não basta (quem criasse conta depois, ou com o e-mail
 * trocado, não herda o acesso).
 */
export async function papelAtivo(email: string, userId: string): Promise<PapelEquipe | null> {
  const m = await membroPorEmail(email);
  if (!m || m.ativo !== true || !userId || m.user_id !== userId) return null;
  return PAPEIS_EQUIPE.includes(m.papel) ? m.papel : null;
}

/**
 * O users.id da conta com este e-mail, ou null se não há conta. Não diferencia maiúscula (conta antiga pode ter o e-mail
 * gravado com maiúscula): ilike com `\`, `%` e `_` escapados, e a comparação exata (em minúsculas) é refeita aqui, porque
 * o PostgREST ainda trata `*` como curinga.
 */
export async function contaPorEmail(email: string): Promise<string | null> {
  const e = normalizarEmail(email);
  if (!e) return null;
  const padrao = e.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await supabase.from('users').select('id, email').ilike('email', padrao).limit(10);
  if (error) throw new ErroEquipe(error, 'leitura da conta do membro');
  const linhas = (data as Array<{ id?: string; email?: string }> | null) ?? [];
  const u = linhas.find((x) => x?.id && normalizarEmail(x.email) === e);
  return u?.id ? String(u.id) : null;
}

/** Todos os membros, do mais antigo ao mais novo. Tabela ausente = lista vazia. */
export async function listarMembros(): Promise<MembroEquipe[]> {
  const { data, error } = await supabase
    .from('nexus_equipe')
    .select('id, email, user_id, papel, ativo, criado_por, created_at')
    .order('created_at', { ascending: true })
    .range(0, 999);
  if (error) {
    if (equipeSemTabela(error)) return [];
    throw new ErroEquipe(error, 'lista da equipe NEXUS');
  }
  return (data as MembroEquipe[] | null) ?? [];
}

/**
 * A conta do SolarDoc entra no ADM? is_admin, ou e-mail ativo em nexus_equipe. Usada pelo /eu do parceiro (`adm`).
 * Nunca lança: qualquer falha vira false (o /eu não pode cair por causa disto, e falha nunca libera).
 */
export async function acessoAdm(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('users').select('id, email, is_admin').eq('id', userId).limit(1);
    if (error) return false;
    const u = ((data as Array<{ id?: string; email?: string; is_admin?: boolean }> | null) ?? [])[0];
    if (!u) return false;
    if (u.is_admin === true) return true;
    return (await papelAtivo(normalizarEmail(u.email), String(u.id))) !== null;
  } catch {
    return false;
  }
}
