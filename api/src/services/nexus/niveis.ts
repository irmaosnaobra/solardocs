// Os níveis do parceiro NEXUS (v2, 21/10/2026), calculados AQUI e nunca no front. Função pura (sem banco, sem relógio).
// Substitui a trilha de 5 etapas da v1.
//
//   cadastrado  CNPJ ativo ('ativa' ou 'nao_verificado'). Libera início, mercado, procura, equipamentos e Simulador.
//               Com o perfil completo (logo, cidade, UF, raio e ao menos um papel) libera Orçamento Básico, Completo,
//               materiais, engenharia, usinas e negociar preço. Depois da primeira proposta libera pedir a conversa.
//   partner     a equipe marca partner_em (depois da conversa). Libera pedido de equipamento e selo.
//   pro         carregadores_comprados >= 1 E montagem_aprovada_em (a equipe aprova) E papel_montagem. Libera oportunidades.
//   master      carregadores_comprados >= 5. Só rótulo de prioridade nesta fase: sozinho NÃO libera oportunidades.

export type Nivel = 'cadastrado' | 'partner' | 'pro' | 'master';

export interface EntradaNivel {
  cnpj: string | null;
  cnpj_situacao: string | null;
  cidade: string | null;
  uf: string | null;
  raio_km: number | null;
  papel_revenda: boolean;
  papel_montagem: boolean;
  primeira_proposta_em: string | null;
  conversa_feita_em: string | null;
  partner_em: string | null;
  montagem_aprovada_em: string | null;
  carregadores_comprados: number;
  /** Vem da company da conta (é o mesmo logo do SolarDoc). */
  tem_logo: boolean;
}

export interface Libera {
  simulador: boolean;
  basico: boolean;
  completo: boolean;
  materiais: boolean;
  engenharia: boolean;
  negociar: boolean;
  usinas: boolean;
  conversa: boolean;
  pedido: boolean;
  selo: boolean;
  oportunidades: boolean;
}

export interface Progresso {
  proximo: Nivel | null;
  /** Chaves do que falta para o próximo nível. */
  faltam: string[];
  /** Só quando o próximo é master: quantos carregadores faltam comprar. */
  carregadores_faltam?: number;
}

export const CARREGADORES_PARA_MASTER = 5;

const texto = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

export function cadastroConcluido(p: EntradaNivel): boolean {
  return texto(p.cnpj) && (p.cnpj_situacao === 'ativa' || p.cnpj_situacao === 'nao_verificado');
}

/** O que falta no perfil, por chave. Vazio = perfil completo. */
export function faltasDoPerfil(p: EntradaNivel): string[] {
  const f: string[] = [];
  if (!p.tem_logo) f.push('logo');
  if (!texto(p.cidade)) f.push('cidade');
  if (!texto(p.uf)) f.push('uf');
  if (!(Number(p.raio_km) > 0)) f.push('raio_km');
  if (!(p.papel_revenda === true || p.papel_montagem === true)) f.push('papel');
  return f;
}

export function perfilCompleto(p: EntradaNivel): boolean {
  return faltasDoPerfil(p).length === 0;
}

/** Pode receber oportunidades: comprou ao menos 1, a equipe aprovou a montagem e a empresa tem o papel. */
export function ehPro(p: EntradaNivel): boolean {
  return Number(p.carregadores_comprados) >= 1 && !!p.montagem_aprovada_em && p.papel_montagem === true;
}

export function calcularNivel(p: EntradaNivel): { nivel: Nivel; progresso: Progresso; libera: Libera } {
  const cadastro = cadastroConcluido(p);
  const perfil = cadastro && perfilCompleto(p);
  const comprados = Math.max(0, Math.floor(Number(p.carregadores_comprados) || 0));
  const pro = cadastro && ehPro(p);

  const nivel: Nivel =
    cadastro && comprados >= CARREGADORES_PARA_MASTER ? 'master'
    : pro ? 'pro'
    : cadastro && p.partner_em ? 'partner'
    : 'cadastrado';

  const libera: Libera = {
    simulador: cadastro,
    basico: perfil,
    completo: perfil,
    materiais: perfil,
    engenharia: perfil,
    negociar: perfil,
    usinas: perfil,
    conversa: perfil && !!p.primeira_proposta_em,
    pedido: cadastro && !!p.partner_em,
    selo: cadastro && !!p.partner_em,
    oportunidades: pro,
  };

  let progresso: Progresso;
  if (nivel === 'cadastrado') {
    const faltam: string[] = faltasDoPerfil(p).length ? ['perfil'] : [];
    if (!p.primeira_proposta_em) faltam.push('primeira_proposta');
    if (!p.conversa_feita_em) faltam.push('conversa');
    if (!p.partner_em) faltam.push('aprovacao_partner');
    progresso = { proximo: 'partner', faltam };
  } else if (nivel === 'partner') {
    const faltam: string[] = [];
    if (p.papel_montagem !== true) faltam.push('papel_montagem');
    if (!p.montagem_aprovada_em) faltam.push('aprovacao_montagem');
    if (comprados < 1) faltam.push('primeira_compra');
    progresso = { proximo: 'pro', faltam };
  } else if (nivel === 'pro') {
    progresso = { proximo: 'master', faltam: ['compras'], carregadores_faltam: CARREGADORES_PARA_MASTER - comprados };
  } else {
    progresso = { proximo: null, faltam: [] };
  }

  return { nivel, progresso, libera };
}
