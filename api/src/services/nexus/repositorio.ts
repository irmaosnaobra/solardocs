// Acesso ao banco do Portal do Parceiro NEXUS (banco PRINCIPAL, service role) e a leitura do lead no banco do Gerador.
// As tabelas nascem da MIGRATION_nexus_portal.sql, que só o dono roda: até lá a sonda abaixo desliga o portal.

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { soDigitos } from '../../utils/cnpj';
import { catalogoParaFront, ENTREGA, FINANCIAMENTO, servicosParaFront, TERMO_VERSAO, WHATSAPP_COMERCIAL } from './catalogo';
import { calcularNivel, EntradaNivel, perfilCompleto } from './niveis';
import { inicioMesBRT } from './tempo';
import { acessoAdm } from './equipe';
import { UFS } from './procura';

export type Linha = Record<string, any>;

/**
 * O cadastro do SolarDoc guarda a cidade já com a UF ("Uberlândia MG", "Goiânia - GO", "Cuiabá/MT", "Brasília, DF").
 * Se a cidade termina com uma sigla das 27 UFs e o uf veio vazio, separa; se o uf já veio e é igual, só limpa a cidade.
 * Sigla diferente do uf informado fica como está. Sem sigla (ex.: "Palmas"), nada muda.
 */
export function separarCidadeUf(cidadeBruta: unknown, ufBruto?: unknown): { cidade: string | null; uf: string | null } {
  let cidade = String(cidadeBruta ?? '').trim();
  const ufDado = String(ufBruto ?? '').trim().toUpperCase();
  let uf = UFS.includes(ufDado) ? ufDado : '';
  const m = cidade.match(/^(.*\S)\s*(?:[\/,\u2013\u2014-]\s*|\s)([A-Za-z]{2})$/);
  if (m) {
    const sigla = m[2].toUpperCase();
    if (UFS.includes(sigla) && (!uf || sigla === uf)) {
      cidade = m[1].replace(/[\s,\/\u2013\u2014-]+$/, '');
      uf = sigla;
    }
  }
  return { cidade: cidade || null, uf: uf || null };
}

/** Texto "Cidade/UF" para aviso, e-mail e resumo, com a mesma regra do portal: não repete a sigla que já vem na cidade. */
export function cidadeUf(cidade: unknown, uf?: unknown): string {
  const s = separarCidadeUf(cidade, uf);
  const u = s.uf ?? (String(uf ?? '').trim().toUpperCase() || null);
  return s.cidade && u ? `${s.cidade}/${u}` : (s.cidade ?? u ?? '');
}

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

/**
 * 42703 (Postgres: coluna inexistente) e PGRST204 (PostgREST: coluna fora do cache do schema) = a seção v3 da migration
 * não rodou. SÓ a sonda usa isto: um bug de coluna numa rota não pode desligar o portal por 60 s.
 */
export function colunaAusente(causa: { code?: string; message?: string } | null | undefined): boolean {
  if (!causa) return false;
  const code = String(causa.code ?? '');
  if (code === '42703' || code === 'PGRST204') return true;
  return /column .* does not exist|could not find the .* column/i.test(String(causa.message ?? ''));
}

// ── Sonda "as tabelas existem?" com cache de 60 s ────────────────────────────
// Só guarda resposta DEFINITIVA (existe ou ausente). Erro passageiro do banco não vira "portal desligado" por 60 s.
const TTL_SONDA_MS = 60_000;
/** A sonda de "portal ligado" exige as 6 tabelas da MIGRATION_nexus_portal.sql e as colunas da seção v3 (link_token etc.). */
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
    // As colunas novas da v3 entram na mesma leitura: o portal só liga com o arquivo inteiro rodado.
    const colunas: Record<string, string> = {
      nexus_propostas: 'id, link_token', nexus_pedidos: 'id, tipo, pacote', nexus_parceiros: 'id, termo_aceito_em',
    };
    const respostas = await Promise.all(TABELAS_DO_PORTAL.map((t) => supabase.from(t).select(colunas[t] ?? 'id').limit(1)));
    if (respostas.some((r) => tabelaAusente(r.error) || colunaAusente(r.error))) {
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
  'portal', 'solardoc', 'solardoc_banner', 'partner_lp', 'convite_email', 'convite_wpp', 'anuncio', 'link_cadastro',
  'quiz_eletroposto',
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

/** O Termo de Parceria foi aceito na versão vigente? Versão antiga conta como pendente. */
export function termoAceitoNaVersao(parceiro: Linha): boolean {
  return parceiro.termo_versao === TERMO_VERSAO && !!parceiro.termo_aceito_em;
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
    termo_aceito: termoAceitoNaVersao(parceiro),
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
  const { nivel, progresso, libera, bloqueios } = calcularNivel(entradaDoNivel(parceiro, company));
  const userId = String(parceiro.user_id);
  const [contagens, saldo, adm] = await Promise.all([contagensDoParceiro(userId), saldoEngenharia(userId), acessoAdm(userId)]);
  const termoAceito = termoAceitoNaVersao(parceiro) ? String(parceiro.termo_aceito_em) : null;
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
    bloqueios,
    montagem_aprovada: !!parceiro.montagem_aprovada_em,
    adm, // v4: users.is_admin ou e-mail ativo em nexus_equipe (o portal mostra o item ADM)
    catalogo: catalogoParaFront(),
    servicos: servicosParaFront(libera),
    saldo_engenharia: saldo,
    termo: { versao: TERMO_VERSAO, disponivel: libera.termo, aceito_em: termoAceito },
    entrega: ENTREGA,
    financiamento: { ...FINANCIAMENTO },
    contagens,
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

/** Pedido de equipamento? Linha sem `tipo` (anterior à v3) é equipamento. */
export const ehPedidoDeEquipamento = (x: Linha): boolean => (x.tipo ?? 'equipamento') === 'equipamento';

/** Soma dos carregadores dos pedidos de EQUIPAMENTO CONFIRMADOS do parceiro, gravada em nexus_parceiros.carregadores_comprados. */
export async function recalcularCarregadores(userId: string): Promise<number> {
  const { data, error } = await supabase.from('nexus_pedidos').select('quantidade, tipo').eq('user_id', userId).eq('status', 'confirmado');
  if (error) throw new ErroBanco(error, 'soma dos pedidos confirmados');
  const total = ((data as Linha[] | null) ?? []).filter(ehPedidoDeEquipamento).reduce((s, x) => s + (Number(x.quantidade) || 0), 0);
  const up = await supabase.from('nexus_parceiros').update({ carregadores_comprados: total, updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (up.error) throw new ErroBanco(up.error, 'gravação de carregadores_comprados');
  return total;
}

export interface SaldoEngenharia {
  comprados: number;
  usados: number;
  disponiveis: number;
}

/**
 * Saldo de engenharia, calculado (sem coluna): comprados = soma de `pacote` dos pedidos de engenharia CONFIRMADOS;
 * usados = solicitações de engenharia com dados.usa_pacote === true e status diferente de 'cancelada'.
 * Função pura: quem chama traz as linhas (do parceiro, ou de todos filtrando por user_id antes).
 */
export function calcularSaldoEngenharia(pedidos: Linha[], solicitacoes: Linha[]): SaldoEngenharia {
  const comprados = pedidos
    .filter((p) => p.tipo === 'engenharia' && p.status === 'confirmado')
    .reduce((s, p) => s + (Number(p.pacote) || 0), 0);
  const usados = solicitacoes.filter((x) => x.tipo === 'engenharia' && x.status !== 'cancelada' && x.dados?.usa_pacote === true).length;
  return { comprados, usados, disponiveis: Math.max(0, comprados - usados) };
}

export async function saldoEngenharia(userId: string): Promise<SaldoEngenharia> {
  const [pedidos, sols] = await Promise.all([
    supabase.from('nexus_pedidos').select('tipo, status, pacote').eq('user_id', userId).eq('tipo', 'engenharia').eq('status', 'confirmado'),
    supabase.from('nexus_solicitacoes').select('tipo, status, dados').eq('user_id', userId).eq('tipo', 'engenharia').neq('status', 'cancelada'),
  ]);
  if (pedidos.error) throw new ErroBanco(pedidos.error, 'pedidos de engenharia');
  if (sols.error) throw new ErroBanco(sols.error, 'solicitações de engenharia');
  return calcularSaldoEngenharia((pedidos.data as Linha[] | null) ?? [], (sols.data as Linha[] | null) ?? []);
}

export type ResultadoUsoPacote = { ok: true; id: string } | { ok: false; erro: 'sem_saldo' };

/**
 * Grava a solicitação de engenharia que consome 1 projeto do pacote, SEM corrida: a função nexus_usar_pacote (seção v3 da
 * MIGRATION_nexus_portal.sql) trava por parceiro (pg_advisory_xact_lock), confere o saldo e insere na mesma transação.
 * Devolve {ok:true, id} ou {ok:false, erro:'sem_saldo'}. Erro do banco (função ausente inclusive) sobe como ErroBanco.
 */
export async function usarPacote(userId: string, dados: Record<string, unknown>): Promise<ResultadoUsoPacote> {
  const { data, error } = await supabase.rpc('nexus_usar_pacote', { p_user: userId, p_dados: dados });
  if (error) throw new ErroBanco(error, 'uso do pacote de engenharia');
  const r = (data ?? null) as { ok?: boolean; id?: unknown; erro?: unknown } | null;
  if (r?.ok === true && r.id) return { ok: true, id: String(r.id) };
  if (r?.ok === false && r.erro === 'sem_saldo') return { ok: false, erro: 'sem_saldo' };
  throw new ErroBanco({ message: 'resposta inesperada da função nexus_usar_pacote' }, 'uso do pacote de engenharia');
}
