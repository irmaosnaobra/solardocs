// LimpaPro dentro do app: quem pode abrir o quê, e o progresso.
//
// O curso continua sendo um produto com dois lugares de leitura (o app e a área de membros antiga, limpapro.solardoc.app),
// e os dois têm de concordar. Por isso:
//   - ACESSO: a mesma regra de produtos/limpapro.ts (`temCompraLimpapro`), por e-mail da conta ou pelo WhatsApp dela;
//   - PROGRESSO: no MESMO limpapro_membros.progresso, no mesmo formato da área de membros: um objeto { "m01#0": true }.
//     "<slug da aula>#<posição da aula>"; cada aula do LimpaPro tem uma só, então é sempre "#0". Os checklists das aulas
//     usam "chk:<slug>:<n>" no mesmo mapa. Nada de formato novo, e nunca apagamos chave que não é a que estamos mexendo;
//   - BÔNUS: o plano Completo é o item `premium` em limpapro_entitlements. O plano de R$ 47 vendido no app não tem bônus;
//   - LIBERAÇÃO ATRASADA (anti-reembolso): `libera_apos_dias` de cada aula, contado de limpapro_membros.criado_em, igual à
//     área de membros (m05, Scripts e Tabela de Precificação abrem 7 dias depois da compra).

import { supabase } from '../../utils/supabase';
import { variantesDoTelefone } from '../produtos/chaveTelefone';
import { temCompraLimpapro } from '../produtos/limpapro';
import { posseValidaEmEntitlements } from '../produtos/acessos';

export const CHAVE_PADRAO = (slug: string): string => `${slug}#0`;
export const CHAVE_CHECK = (slug: string, i: number): string => `chk:${slug}:${i}`;
const CHAVE_AULA_RE = /^[a-z0-9-]{1,40}#\d{1,3}$/;
const CHAVE_CHECK_RE = /^chk:[a-z0-9-]{1,40}:\d{1,3}$/;
/** Mesmo teto da área de membros: payload gigante não entra. */
const MAX_CHAVES = 200;

/**
 * O certificado só existe no plano Completo (como na área de membros) e abre 7 dias depois da compra.
 * Mudar para `false` entrega o certificado a todo aluno que fechar os 5 módulos.
 */
export const CERTIFICADO_SO_COMPLETO = true;
export const CERTIFICADO_ESPERA_DIAS = 7;
/** O certificado é uma página da área de membros (arquivo estático, com o nome na URL). */
export const URL_CERTIFICADO = 'https://limpapro.solardoc.app/certificado.html';

export interface AulaLinha {
  slug: string;
  grupo: 'modulo' | 'incluso' | 'bonus' | 'extra';
  modulo: number | null;
  ordem: number;
  titulo: string;
  resumo: string;
  minutos: number;
  bonus: boolean;
  requer: string;
  libera_apos_dias: number;
}

export interface MembroCurso {
  email: string;
  nome: string | null;
  progresso: Record<string, unknown>;
  criado_em: string | null;
}

export interface ContextoCurso {
  userId: string;
  email: string;
  nome: string;
  isAdmin: boolean;
  acesso: boolean;
  premium: boolean;
  itens: Set<string>;
  /** Linha do aluno em limpapro_membros. Nula para quem só entrou como administrador. */
  membro: MembroCurso | null;
  /**
   * Acesso só pelo adicional mensal (entitlements com data): `membro` é uma âncora sem linha em limpapro_membros (que valeria para sempre). O
   * progresso dessa conta mora em system_state (`limpapro_prog:<userId>`), no mesmo formato { "m01#0": true }.
   */
  somentePorAdicional?: boolean;
}

const COLUNAS_LISTA = 'slug, grupo, modulo, ordem, titulo, resumo, minutos, bonus, requer, libera_apos_dias';

const emailNorm = (v: unknown): string => String(v ?? '').toLowerCase().trim();

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/** A linha do PROPRIO e-mail da conta. Linha achada por telefone nunca entra aqui: e de outra pessoa. */
async function lerMembro(email: string): Promise<MembroCurso | null> {
  if (!email) return null;
  const { data } = await supabase
    .from('limpapro_membros').select('email, nome, telefone, progresso, criado_em').eq('email', email).eq('ativo', true).limit(1);
  return Array.isArray(data) && data[0] ? (data[0] as MembroCurso) : null;
}

/**
 * Quem tem acesso por entitlement mas ainda não tem linha em limpapro_membros (compra feita pelo app, que só grava
 * entitlement) ganha a linha na primeira vez que abre o curso: é o que o webhook da área de membros faz na compra
 * (e-mail, nome, telefone, ativo). Sem a linha não há onde guardar progresso nem de onde contar a liberação atrasada.
 * Consequência a saber: para esses alunos a janela de 7 dias conta da PRIMEIRA ABERTURA, não do pagamento.
 * Erro de unicidade (duas abas ao mesmo tempo) é ignorado e a linha é relida.
 */
async function garantirMembro(email: string, nome: string, whatsapp: string | null | undefined): Promise<MembroCurso | null> {
  if (!email) return null;
  const digitos = String(whatsapp ?? '').replace(/\D/g, '').replace(/^0+/, '');
  let telefone: string | null = variantesDoTelefone(whatsapp).length
    ? (digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos)
    : null;
  // Telefone que já está na linha de outra pessoa não é repetido: a área de membros antiga procura por telefone
  // e acharia duas linhas.
  if (telefone) {
    const { data: outro } = await supabase.from('limpapro_membros').select('email').eq('telefone', telefone).neq('email', email).limit(1);
    if (Array.isArray(outro) && outro.length) telefone = null;
  }
  const { error } = await supabase.from('limpapro_membros').insert({ email, nome: nome || null, telefone, ativo: true });
  if (error && (error as { code?: string }).code !== '23505') {
    console.warn('[limpapro] não criou a linha do aluno:', error.message);
  }
  const { data } = await supabase
    .from('limpapro_membros').select('email, nome, telefone, progresso, criado_em').eq('email', email).eq('ativo', true).limit(1);
  return Array.isArray(data) && data[0] ? (data[0] as MembroCurso) : null;
}

/**
 * Quem e esta conta para o curso.
 *   - ACESSO: `temCompraLimpapro` (e-mail ou WhatsApp). O telefone so decide o acesso.
 *   - LINHA, ITENS (premium e extras), PROGRESSO, janela de 7 dias e nome do certificado: SO do PROPRIO e-mail da conta.
 *     Duas contas que dividem um telefone nao se misturam, e a linha achada por telefone nunca e lida nem gravada.
 *   - Conta sem e-mail (ou com acesso so pelo telefone): sem linha propria, so le. Nao grava em linha de outra pessoa.
 *   - Administrador: ve tudo, sem linha e sem consulta de membro.
 */
export async function contextoDoCurso(userId: string | undefined): Promise<ContextoCurso | null> {
  if (!userId) return null;
  const { data: u } = await supabase
    .from('users').select('email, nome, whatsapp, is_admin').eq('id', userId).maybeSingle();
  if (!u) return null;
  const email = emailNorm((u as { email?: string }).email);
  const nome = String((u as { nome?: string }).nome ?? '').trim();
  const whatsapp = (u as { whatsapp?: string | null }).whatsapp ?? null;
  const isAdmin = !!(u as { is_admin?: boolean }).is_admin;

  if (isAdmin) {
    return { userId, email, nome, isAdmin, acesso: true, premium: true, itens: new Set(), membro: null };
  }

  const [compra, membroInicial, itens] = await Promise.all([
    temCompraLimpapro({ email, whatsapp }),
    lerMembro(email),
    itensDoEmail(email),
  ]);

  let membro = membroInicial;
  const compraPropria = !!membro || itens.has('curso-principal') || itens.has('premium');
  if (compraPropria && !membro) membro = await garantirMembro(email, nome, whatsapp);

  // Adicional mensal: o acesso vem de entitlements VÁLIDO (vence). Não grava limpapro_membros (valeria para sempre): a âncora dos 7 dias da
  // liberação atrasada é a data em que a posse nasceu, e o progresso mora em system_state (`limpapro_prog:<userId>`), lido aqui e gravado por gravarChave.
  if (!compra) {
    const posse = await posseValidaEmEntitlements(userId, 'curso-limpapro');
    if (posse) {
      const ancora: MembroCurso = { email, nome: nome || null, progresso: await lerProgressoDoAdicional(userId), criado_em: posse.desde };
      return { userId, email, nome, isAdmin, acesso: true, premium: false, itens, membro: ancora, somentePorAdicional: true };
    }
  }

  return { userId, email, nome, isAdmin, acesso: compra, premium: itens.has('premium'), itens, membro };
}

async function itensDoEmail(email: string): Promise<Set<string>> {
  const itens = new Set<string>();
  if (!email) return itens;
  const { data } = await supabase.from('limpapro_entitlements').select('item').eq('email', email).eq('ativo', true);
  for (const r of Array.isArray(data) ? data : []) itens.add(String((r as { item: string }).item));
  return itens;
}

export async function listarAulas(): Promise<AulaLinha[]> {
  const { data, error } = await supabase.from('limpapro_aulas').select(COLUNAS_LISTA).order('ordem', { ascending: true });
  if (error) throw new Error(`limpapro_aulas: ${error.message}`);
  return (Array.isArray(data) ? (data as AulaLinha[]) : []).sort((a, b) => a.ordem - b.ordem);
}

export async function lerAula(slug: string): Promise<(AulaLinha & { html: string }) | null> {
  const { data, error } = await supabase
    .from('limpapro_aulas').select(`${COLUNAS_LISTA}, html`).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`limpapro_aulas: ${error.message}`);
  return (data as (AulaLinha & { html: string }) | null) ?? null;
}

export type Bloqueio =
  | { ok: true }
  | { ok: false; motivo: 'sem_acesso' | 'premium' | 'item' }
  | { ok: false; motivo: 'espera'; liberaEm: string };

/** Quando a aula abre para este aluno. Nulo = já está aberta. */
export function liberaEm(aula: Pick<AulaLinha, 'libera_apos_dias'>, ctx: ContextoCurso, agora = Date.now()): string | null {
  if (!aula.libera_apos_dias || ctx.isAdmin) return null;
  const ancora = ctx.membro?.criado_em ? new Date(ctx.membro.criado_em).getTime() : NaN;
  // Sem linha PROPRIA nao ha de onde contar (acesso so pelo telefone de outra conta): fica fechado, nunca aberto de graca.
  if (!Number.isFinite(ancora)) return new Date(agora + aula.libera_apos_dias * 24 * 60 * 60 * 1000).toISOString();
  const abre = ancora + aula.libera_apos_dias * 24 * 60 * 60 * 1000;
  return agora >= abre ? null : new Date(abre).toISOString();
}

/** A regra única de "esta pessoa abre esta aula?", usada pela lista, pela aula e pelo progresso. */
export function podeAbrir(aula: AulaLinha, ctx: ContextoCurso, agora = Date.now()): Bloqueio {
  if (!ctx.acesso) return { ok: false, motivo: 'sem_acesso' };
  if (aula.requer !== 'curso-principal' && !ctx.isAdmin) {
    // `premium` abre SO o que pede premium (os bonus). Cada extra exige o item exato, como na area de membros.
    const tem = aula.requer === 'premium' ? ctx.premium : ctx.itens.has(aula.requer);
    if (!tem) return { ok: false, motivo: aula.bonus || aula.requer === 'premium' ? 'premium' : 'item' };
  }
  const espera = liberaEm(aula, ctx, agora);
  if (espera) return { ok: false, motivo: 'espera', liberaEm: espera };
  return { ok: true };
}

/** Só as chaves "<slug>#<n>" (aulas feitas). As de checklist e as de outros usos ficam fora da resposta. */
export function progressoDasAulas(membro: MembroCurso | null): Record<string, true> {
  const saida: Record<string, true> = {};
  for (const [k, v] of Object.entries(objeto(membro?.progresso))) {
    if (v && CHAVE_AULA_RE.test(k)) saida[k] = true;
  }
  return saida;
}

export function marcadosDaAula(membro: MembroCurso | null, slug: string): number[] {
  const prefixo = `chk:${slug}:`;
  return Object.entries(objeto(membro?.progresso))
    .filter(([k, v]) => v && CHAVE_CHECK_RE.test(k) && k.startsWith(prefixo))
    .map(([k]) => Number(k.slice(prefixo.length)))
    .sort((a, b) => a - b);
}

export function modulosConcluidos(aulas: AulaLinha[], progresso: Record<string, true>): { feitos: number; total: number } {
  const mods = aulas.filter((a) => a.grupo === 'modulo');
  return { total: mods.length, feitos: mods.filter((a) => progresso[CHAVE_PADRAO(a.slug)]).length };
}

export type EstadoCertificado =
  | { liberado: true; url: string }
  | { liberado: false; motivo: 'faltam'; faltam: number }
  | { liberado: false; motivo: 'plano' }
  | { liberado: false; motivo: 'espera'; liberaEm: string };

export function estadoCertificado(ctx: ContextoCurso, aulas: AulaLinha[], progresso: Record<string, true>, agora = Date.now()): EstadoCertificado {
  const { feitos, total } = modulosConcluidos(aulas, progresso);
  if (total === 0 || feitos < total) return { liberado: false, motivo: 'faltam', faltam: Math.max(total - feitos, 0) };
  if (CERTIFICADO_SO_COMPLETO && !ctx.premium) return { liberado: false, motivo: 'plano' };
  const espera = liberaEm({ libera_apos_dias: CERTIFICADO_ESPERA_DIAS }, ctx, agora);
  if (espera) return { liberado: false, motivo: 'espera', liberaEm: espera };
  const nome = (ctx.membro?.nome || ctx.nome || '').trim();
  return { liberado: true, url: `${URL_CERTIFICADO}?nome=${encodeURIComponent(nome)}` };
}

export class ProgressoCheio extends Error {}

/** Onde o progresso de quem tem SÓ o adicional mensal fica (sem migration e sem linha em limpapro_membros). */
export const chaveProgressoDoAdicional = (userId: string): string => `limpapro_prog:${userId}`;

async function lerProgressoDoAdicional(userId: string): Promise<Record<string, unknown>> {
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', chaveProgressoDoAdicional(userId)).maybeSingle();
    return objeto((data as { value?: { progresso?: unknown } } | null)?.value?.progresso);
  } catch {
    return {};
  }
}

function rpcAusente(e: { code?: string; message?: string }): boolean {
  return e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(e.message ?? '');
}

type ClienteComRpc = {
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

/**
 * Grava uma chave de progresso SEM apagar as outras.
 * Caminho principal: a RPC `limpapro_progresso_set` (MIGRATION_limpapro_progresso_rpc.sql), um UPDATE atomico no banco
 * (`progresso || {chave: true}` ou `progresso - chave`), sem ler e regravar o objeto. Enquanto a RPC nao existe, cai no
 * caminho antigo (le, troca a chave, regrava). O teto de 200 chaves vale so ao MARCAR: desmarcar nunca falha por isso.
 * Quem nao tem linha PROPRIA em limpapro_membros (administrador, conta sem e-mail, acesso so pelo telefone) nao grava.
 */
export async function gravarChave(
  ctx: ContextoCurso, chave: string, valor: boolean,
): Promise<{ salvo: boolean; progresso: Record<string, unknown> }> {
  if (!ctx.membro) return { salvo: false, progresso: {} };
  if (ctx.somentePorAdicional) {
    // Mesma regra do curso (teto de 200 chaves só ao marcar; desmarcar nunca falha), guardada em system_state.
    const atual = await lerProgressoDoAdicional(ctx.userId);
    if (valor) {
      if (!(chave in atual) && Object.keys(atual).length >= MAX_CHAVES) throw new ProgressoCheio();
      atual[chave] = true;
    } else delete atual[chave];
    const { error } = await supabase.from('system_state')
      .upsert({ key: chaveProgressoDoAdicional(ctx.userId), value: { progresso: atual, atualizado_em: new Date().toISOString() } }, { onConflict: 'key' });
    if (error) throw new Error(`system_state: ${error.message}`);
    ctx.membro.progresso = atual;
    return { salvo: true, progresso: atual };
  }
  const email = ctx.membro.email;

  const cliente = supabase as unknown as ClienteComRpc;
  if (typeof cliente.rpc === 'function') {
    const { data, error } = await cliente.rpc('limpapro_progresso_set', { p_email: email, p_chave: chave, p_valor: valor });
    if (!error) {
      // null = a linha do aluno sumiu entre a leitura e a gravação: nada foi salvo.
      if (data === null || data === undefined) return { salvo: false, progresso: ctx.membro.progresso ? objeto(ctx.membro.progresso) : {} };
      const novo = objeto(data);
      ctx.membro.progresso = novo;
      return { salvo: true, progresso: novo };
    }
    if (/progresso_cheio/.test(error.message ?? '')) throw new ProgressoCheio();
    if (!rpcAusente(error)) throw new Error(`limpapro_progresso_set: ${error.message}`);
  }

  const { data } = await supabase.from('limpapro_membros').select('progresso').eq('email', email).limit(1);
  const atual = objeto(Array.isArray(data) && data[0] ? (data[0] as { progresso?: unknown }).progresso : ctx.membro.progresso);
  if (valor) {
    if (!(chave in atual) && Object.keys(atual).length >= MAX_CHAVES) throw new ProgressoCheio();
    atual[chave] = true;
  } else delete atual[chave];
  const { error } = await supabase
    .from('limpapro_membros').update({ progresso: atual, atualizado_em: new Date().toISOString() }).eq('email', email);
  if (error) throw new Error(`limpapro_membros: ${error.message}`);
  ctx.membro.progresso = atual;
  return { salvo: true, progresso: atual };
}
