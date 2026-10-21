// Acesso ao banco do Portal do Parceiro NEXUS (banco PRINCIPAL, service role) e a leitura do lead no banco do Gerador.
// As tabelas nascem da MIGRATION_nexus_portal.sql, que só o dono roda: até lá a sonda abaixo desliga o portal.

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { soDigitos } from '../../utils/cnpj';
import { catalogoParaFront, ENTREGA, FINANCIAMENTO, WHATSAPP_COMERCIAL } from './catalogo';
import { calcularNivel, EntradaNivel, perfilCompleto } from './niveis';
import { inicioMesBRT } from './tempo';

export type Linha = Record<string, any>;

/** Erro do banco embrulhado, para a rota decidir entre 503 (tabela ausente) e 500. */
export class ErroBanco extends Error {
  constructor(public causa: { code?: string; message?: string } | null | undefined, contexto: string) {
    super(`${contexto}: ${causa?.message ?? 'erro do banco'}`);
  }
}

/** 42P01 (Postgres) e PGRST205 (PostgREST: tabela fora do cache do schema) = a migration não rodou. */
export function tabelaAusente(causa: { code?: string; message?: string } | null | undefined): boolean {
  if (!causa) return false;
  const code = String(causa.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /could not find the table|relation .*nexus_.* does not exist/i.test(String(causa.message ?? ''));
}

// ── Sonda "as tabelas existem?" com cache de 60 s ────────────────────────────
// Só guarda resposta DEFINITIVA (existe ou ausente). Erro passageiro do banco não vira "portal desligado" por 60 s.
const TTL_SONDA_MS = 60_000;
/** A sonda de "portal ligado" exige as 6 tabelas da MIGRATION_nexus_portal.sql. */
export const TABELAS_DO_PORTAL = [
  'nexus_parceiros', 'nexus_propostas', 'nexus_pedidos', 'nexus_oportunidades', 'nexus_usinas', 'nexus_solicitacoes',
] as const;
let sonda: { ligado: boolean; ate: number } | null = null;

export function resetSondaPortal(): void {
  sonda = null;
}

export function marcarPortalAusente(): void {
  sonda = { ligado: false, ate: Date.now() + TTL_SONDA_MS };
}

export async function portalLigado(): Promise<boolean> {
  const agora = Date.now();
  if (sonda && sonda.ate > agora) return sonda.ligado;
  try {
    const respostas = await Promise.all(TABELAS_DO_PORTAL.map((t) => supabase.from(t).select('id').limit(1)));
    if (respostas.some((r) => tabelaAusente(r.error))) {
      sonda = { ligado: false, ate: agora + TTL_SONDA_MS };
      return false;
    }
    if (respostas.some((r) => r.error)) return sonda?.ligado ?? true; // passageiro: não grava no cache
    sonda = { ligado: true, ate: agora + TTL_SONDA_MS };
    return true;
  } catch {
    return sonda?.ligado ?? true;
  }
}

// ── Leituras ─────────────────────────────────────────────────────────────────
const COLUNAS_COMPANY = 'id, nome, nome_fantasia, cnpj, cidade, whatsapp, logo_base64';

/** A empresa da conta. Termina em .limit(1) e olha o array: a conta pode ter mais de uma linha. */
export async function lerCompany(userId: string): Promise<Linha | null> {
  const { data, error } = await supabase.from('company').select(COLUNAS_COMPANY).eq('user_id', userId).limit(1);
  if (error) throw new ErroBanco(error, 'leitura da empresa');
  return ((data as Linha[] | null) ?? [])[0] ?? null;
}

export async function lerParceiro(userId: string): Promise<Linha | null> {
  const { data, error } = await supabase.from('nexus_parceiros').select('*').eq('user_id', userId).limit(1);
  if (error) throw new ErroBanco(error, 'leitura do parceiro');
  return ((data as Linha[] | null) ?? [])[0] ?? null;
}

export const ORIGENS_VALIDAS: readonly string[] = Object.freeze([
  'portal', 'solardoc', 'solardoc_banner', 'partner_lp', 'convite_email', 'convite_wpp', 'anuncio',
]);

export function origemValida(v: unknown): string {
  const o = String(v ?? '').trim();
  return ORIGENS_VALIDAS.includes(o) ? o : 'portal';
}

const CHAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export function utmDe(q: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const k of CHAVES_UTM) {
    const v = typeof q[k] === 'string' ? (q[k] as string).trim().slice(0, 120) : '';
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Telefone do cadastro (DDD + 8/9 dígitos, ou já com 55) no formato do banco do Gerador: só dígitos, com DDI 55. */
export function telefoneComDdi(v: unknown): string | null {
  const d = soDigitos(v);
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

/**
 * Procura, no banco do Gerador, a ficha de integrador (eletroposto_parceria, lado='integrador') do mesmo telefone.
 * A tabela não tem coluna de CNPJ (conferido em MIGRATION_eletroposto_parceria.sql), então a ligação é pelo telefone.
 * Nunca lança: o /eu não pode falhar por causa de uma consulta de enriquecimento.
 */
export async function acharLeadGerador(telefone: unknown): Promise<{ id: string; cidade: string | null; equipe: number | null } | null> {
  const tel = telefoneComDdi(telefone);
  if (!tel) return null;
  try {
    const { data, error } = await supabaseGerador
      .from('eletroposto_parceria')
      .select('id, cidade, integrador_equipe')
      .eq('lado', 'integrador')
      .eq('telefone', tel)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return null;
    const l = ((data as Linha[] | null) ?? [])[0];
    if (!l) return null;
    const n = parseInt(String(l.integrador_equipe ?? '').match(/\d+/)?.[0] ?? '', 10);
    return {
      id: String(l.id),
      cidade: typeof l.cidade === 'string' && l.cidade.trim() ? l.cidade.trim().slice(0, 80) : null,
      equipe: Number.isFinite(n) && n > 0 && n <= 10000 ? n : null,
    };
  } catch {
    return null;
  }
}

// ── Montagem da resposta do /eu ──────────────────────────────────────────────
export function entradaDoNivel(parceiro: Linha, company: Linha | null): EntradaNivel {
  return {
    cnpj: parceiro.cnpj ?? null,
    cnpj_situacao: parceiro.cnpj_situacao ?? null,
    cidade: parceiro.cidade ?? null,
    uf: parceiro.uf ?? null,
    raio_km: parceiro.raio_km ?? null,
    papel_revenda: !!parceiro.papel_revenda,
    papel_montagem: !!parceiro.papel_montagem,
    primeira_proposta_em: parceiro.primeira_proposta_em ?? null,
    conversa_feita_em: parceiro.conversa_feita_em ?? null,
    partner_em: parceiro.partner_em ?? null,
    montagem_aprovada_em: parceiro.montagem_aprovada_em ?? null,
    carregadores_comprados: Number(parceiro.carregadores_comprados) || 0,
    tem_logo: !!company?.logo_base64,
  };
}

/** Campos que o parceiro NÃO vê da própria linha: nota da equipe e o vínculo com o lead do Gerador. */
function visaoDoParceiro(p: Linha): Linha {
  const { notas_equipe: _n, lead_gerador_id: _l, ...resto } = p;
  return resto;
}

async function contar(tabela: string, userId: string, filtro?: (q: any) => any): Promise<number> {
  let q: any = supabase.from(tabela).select('id', { count: 'exact', head: true }).eq(tabela === 'nexus_oportunidades' ? 'parceiro_user_id' : 'user_id', userId);
  if (filtro) q = filtro(q);
  const { count, error } = await q;
  if (error) throw new ErroBanco(error, `contagem de ${tabela}`);
  return count ?? 0;
}

/** Os números do parceiro para o Início do portal. */
export async function contagensDoParceiro(userId: string) {
  const mes = inicioMesBRT().toISOString();
  const [propostas_mes, pedidos, oportunidades_recebidas, usinas] = await Promise.all([
    contar('nexus_propostas', userId, (q) => q.gte('created_at', mes)),
    contar('nexus_pedidos', userId),
    contar('nexus_oportunidades', userId, (q) => q.neq('status', 'rascunho')),
    contar('nexus_usinas', userId),
  ]);
  return { propostas_mes, pedidos, oportunidades_recebidas, usinas };
}

export async function montarEu(parceiro: Linha, company: Linha | null) {
  const { nivel, progresso, libera } = calcularNivel(entradaDoNivel(parceiro, company));
  return {
    parceiro: visaoDoParceiro(parceiro),
    empresa: {
      nome: company?.nome ?? parceiro.empresa ?? null,
      nome_fantasia: company?.nome_fantasia ?? null,
      cnpj: parceiro.cnpj ?? (company?.cnpj ? soDigitos(company.cnpj) : null),
      cidade: parceiro.cidade || company?.cidade || null,
      whatsapp: company?.whatsapp ?? null,
      logo_base64: company?.logo_base64 ?? null,
    },
    nivel,
    progresso,
    libera,
    catalogo: catalogoParaFront(),
    entrega: ENTREGA,
    financiamento: { ...FINANCIAMENTO },
    contagens: await contagensDoParceiro(String(parceiro.user_id)),
    whatsappComercial: WHATSAPP_COMERCIAL,
  };
}

/** Grava perfil_completo_em na primeira vez que o perfil fecha. Devolve a linha atualizada. */
export async function marcarPerfilCompleto(parceiro: Linha, company: Linha | null): Promise<Linha> {
  const e = entradaDoNivel(parceiro, company);
  if (!perfilCompleto(e) || parceiro.perfil_completo_em) return parceiro;
  const agora = new Date().toISOString();
  const { error } = await supabase.from('nexus_parceiros').update({ perfil_completo_em: agora, updated_at: agora }).eq('id', parceiro.id);
  if (error) throw new ErroBanco(error, 'marco do perfil');
  return { ...parceiro, perfil_completo_em: agora, updated_at: agora };
}

/** Soma dos carregadores dos pedidos CONFIRMADOS do parceiro, gravada em nexus_parceiros.carregadores_comprados. */
export async function recalcularCarregadores(userId: string): Promise<number> {
  const { data, error } = await supabase.from('nexus_pedidos').select('quantidade').eq('user_id', userId).eq('status', 'confirmado');
  if (error) throw new ErroBanco(error, 'soma dos pedidos confirmados');
  const total = ((data as Linha[] | null) ?? []).reduce((s, x) => s + (Number(x.quantidade) || 0), 0);
  const up = await supabase.from('nexus_parceiros').update({ carregadores_comprados: total, updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (up.error) throw new ErroBanco(up.error, 'gravação de carregadores_comprados');
  return total;
}
