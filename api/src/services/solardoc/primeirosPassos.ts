// ─────────────────────────────────────────────────────────────────────────────
// PRIMEIROS PASSOS DO USUÁRIO NOVO DA SOLARDOC: a fonte única do "o que falta" (recepção de usuários novos, 09/11/2026).
// A tela (quadro "Primeiros passos") e o robô (recepcaoNovoUsuario: WhatsApp e e-mail) leem DAQUI, para os dois nunca discordarem.
//
//   empresa  = razão social e CNPJ preenchidos (company.nome e company.cnpj)
//   logo     = company.logo_base64 preenchida
//   fotos    = 6 ou mais fotos de obras (company.fotos_obras, pelo mesmo normalizador da proposta Completa)
//   proposta = existe documents.tipo = 'propostaSolar' do usuário (mesmo critério do fezProposta do pós-venda)
//   whatsapp = users.whatsapp preenchido (passo à parte: não entra em proximo, feitos nem total)
//
// `proximo`, `feitos`, `total` e `tudoPronto` olham só os 4 passos principais, na ordem empresa, logo, fotos, proposta.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { colunaAusente } from '../vistoria/extras';
import { sanitizarFotosObras } from '../../controllers/portfolioController';
import { fezProposta } from './ativacaoPosVenda';

export const MINIMO_FOTOS = 6;
export const TOTAL_PASSOS = 4;

export type PassoPrincipal = 'empresa' | 'logo' | 'fotos' | 'proposta';
export const ORDEM_PASSOS: readonly PassoPrincipal[] = ['empresa', 'logo', 'fotos', 'proposta'];

export type PassoDoUsuario =
  | { id: 'empresa'; feito: boolean }
  | { id: 'logo'; feito: boolean }
  | { id: 'fotos'; feito: boolean; qtd: number; minimo: number }
  | { id: 'proposta'; feito: boolean }
  | { id: 'whatsapp'; feito: boolean };

export interface ResultadoPassos {
  passos: PassoDoUsuario[];
  proximo: PassoPrincipal | null;
  feitos: number;
  total: 4;
  tudoPronto: boolean;
  /** Plano diferente de 'free'. */
  pago: boolean;
}

export interface EntradaPassos {
  empresaNome?: unknown;
  empresaCnpj?: unknown;
  /** company.logo_base64. */
  logo?: unknown;
  /** Quantas fotos de obras VÁLIDAS a empresa tem (já normalizadas). */
  qtdFotos: number;
  temProposta: boolean;
  whatsapp?: unknown;
  plano?: unknown;
}

const preenchido = (v: unknown): boolean => String(v ?? '').trim() !== '';

/** Pura. */
export function calcularPassos(e: EntradaPassos): ResultadoPassos {
  const qtd = Math.max(0, Math.floor(Number(e.qtdFotos) || 0));
  const feito: Record<PassoPrincipal, boolean> = {
    empresa: preenchido(e.empresaNome) && preenchido(e.empresaCnpj),
    logo: preenchido(e.logo),
    fotos: qtd >= MINIMO_FOTOS,
    proposta: e.temProposta === true,
  };
  const feitos = ORDEM_PASSOS.filter(id => feito[id]).length;
  const proximo = ORDEM_PASSOS.find(id => !feito[id]) ?? null;
  return {
    passos: [
      { id: 'empresa', feito: feito.empresa },
      { id: 'logo', feito: feito.logo },
      { id: 'fotos', feito: feito.fotos, qtd, minimo: MINIMO_FOTOS },
      { id: 'proposta', feito: feito.proposta },
      { id: 'whatsapp', feito: preenchido(e.whatsapp) },
    ],
    proximo,
    feitos,
    total: TOTAL_PASSOS,
    tudoPronto: feitos === TOTAL_PASSOS,
    pago: String(e.plano ?? 'free') !== 'free',
  };
}

export interface PassosLidos {
  resultado: ResultadoPassos;
  /** Existe linha em `company` para o usuário (a cadência de CNPJ do followupService usa este critério para "sem empresa"). */
  temLinhaEmpresa: boolean;
  plano: string;
}

interface LinhaEmpresa { user_id: string; nome: unknown; cnpj: unknown; fotos_obras?: unknown }

const emLotes = <T>(lista: readonly T[], tamanho: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
};

/**
 * Os primeiros passos de vários usuários de uma vez (o robô). Usuário que não existe fica de fora do mapa.
 * Qualquer erro de leitura LANÇA: quem chama não age (na dúvida, o robô não fala).
 */
export async function carregarPassosEmLote(userIds: readonly string[]): Promise<Map<string, PassosLidos>> {
  const mapa = new Map<string, PassosLidos>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return mapa;

  const usuarios = new Map<string, { whatsapp: unknown; plano: unknown }>();
  for (const lote of emLotes(ids, 100)) {
    const { data, error } = await supabase.from('users').select('id, whatsapp, plano').in('id', lote);
    if (error) throw new Error('leitura dos usuários falhou');
    for (const u of (data ?? []) as Array<{ id: string; whatsapp: unknown; plano: unknown }>) usuarios.set(u.id, { whatsapp: u.whatsapp, plano: u.plano });
  }

  // A logo (company.logo_base64) pode ter mais de 1 MB: o robô lê só se ELA EXISTE (consulta à parte, sem trazer o conteúdo).
  const empresas = new Map<string, LinhaEmpresa>();
  const comLogo = new Set<string>();
  for (const lote of emLotes(ids, 100)) {
    let r: { data: unknown[] | null; error: { code?: string; message?: string } | null } =
      await supabase.from('company').select('user_id, nome, cnpj, fotos_obras').in('user_id', lote);
    // A coluna `fotos_obras` nasceu depois (migration da proposta Completa): sem ela, a conta de fotos vale 0 e o resto segue.
    if (r.error && colunaAusente(r.error)) r = await supabase.from('company').select('user_id, nome, cnpj').in('user_id', lote);
    if (r.error) throw new Error('leitura das empresas falhou');
    for (const c of (r.data ?? []) as LinhaEmpresa[]) if (!empresas.has(c.user_id)) empresas.set(c.user_id, c);
    const l = await supabase.from('company').select('user_id').in('user_id', lote).not('logo_base64', 'is', null).neq('logo_base64', '');
    if (l.error) throw new Error('leitura das logos falhou');
    for (const c of (l.data ?? []) as Array<{ user_id: string }>) comLogo.add(c.user_id);
  }

  const fizeram = await fezProposta(ids);
  if (!fizeram) throw new Error('leitura das propostas falhou');

  for (const id of ids) {
    const u = usuarios.get(id);
    if (!u) continue;
    const c = empresas.get(id);
    const resultado = calcularPassos({
      empresaNome: c?.nome,
      empresaCnpj: c?.cnpj,
      logo: comLogo.has(id) ? 'sim' : '',
      qtdFotos: sanitizarFotosObras(id, c?.fotos_obras).length,
      temProposta: fizeram.has(id),
      whatsapp: u.whatsapp,
      plano: u.plano,
    });
    mapa.set(id, { resultado, temLinhaEmpresa: !!c, plano: String(u.plano ?? 'free') });
  }
  return mapa;
}

/** Os primeiros passos de um usuário. null = o usuário não existe. Erro de leitura LANÇA. */
export async function carregarPassos(userId: string): Promise<ResultadoPassos | null> {
  const mapa = await carregarPassosEmLote([userId]);
  return mapa.get(userId)?.resultado ?? null;
}
