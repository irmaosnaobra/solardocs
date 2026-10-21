// Os níveis do parceiro NEXUS (v3, 21/10/2026), calculados AQUI e nunca no front. Função pura (sem banco, sem relógio).
//
//   cadastrado  CNPJ ativo ('ativa' ou 'nao_verificado'). Libera início, mercado, procura, equipamentos e Simulador.
//               Com o perfil completo (logo, cidade, UF, raio e ao menos um papel) libera Orçamento Básico, Completo,
//               materiais, engenharia avulsa, usinas e negociar preço. Depois da primeira proposta libera pedir a conversa.
//   partner     a equipe marca partner_em (depois da conversa). Libera pedido de equipamento, compra de pacotes de
//               engenharia, consultoria de vendas e selo.
//   pro         carregadores_comprados >= 1 (SÓ a primeira compra confirmada). Libera o Termo de Parceria e a revenda da
//               Plataforma NEXUS. Oportunidades exigem também o Termo aceito na versão vigente. A montagem aprovada NÃO entra mais aqui: é um selo à parte
//               (montagem_aprovada_em) que só decide quem recebe oportunidade do tipo 'obra'.
//   master      carregadores_comprados >= 5. Só rótulo de prioridade nesta fase.
//
// A escada é cumulativa: quem já comprou tem tudo do Partner, mesmo que a equipe desmarque partner_em depois.

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
  /** Aceitou o Termo de Parceria na versão vigente (termo_versao igual à do catálogo e termo_aceito_em preenchido). */
  termo_aceito?: boolean;
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
  /** Compra de pacotes de engenharia de 3, 5 ou 10 projetos (Partner em diante). */
  pacotes_engenharia: boolean;
  /** Consultoria de vendas NEXUS (Partner em diante). */
  consultoria: boolean;
  /** Revenda da Plataforma NEXUS de gestão (Pro em diante). */
  plataforma: boolean;
  /** Termo de Parceria (Pro em diante). */
  termo: boolean;
}

/** Para cada item travado de `libera`, o texto de quando ele libera. Só as chaves travadas aparecem. */
export type Bloqueios = Partial<Record<keyof Libera, string>>;

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

/** Pro: comprou ao menos 1 carregador (compra confirmada). Montagem aprovada e papel não entram na regra. */
export function ehPro(p: EntradaNivel): boolean {
  return Number(p.carregadores_comprados) >= 1;
}

export const TEXTO_BLOQUEIO = Object.freeze({
  cadastro: 'Libera com o cadastro da empresa com CNPJ ativo',
  perfil: 'Libera com o perfil completo: logo, cidade e UF, raio de atendimento e um papel',
  proposta: 'Libera depois da primeira proposta gerada',
  partner: 'Libera quando a equipe NEXUS marca a sua empresa como Partner, depois da conversa com o comercial',
  compra: 'Libera com a primeira compra de carregador',
  termo: 'Aceite o Termo de Parceria para receber oportunidades',
});

function bloqueiosDe(libera: Libera, cadastro: boolean, pro: boolean): Bloqueios {
  const motivo = (chave: keyof Libera): string => {
    if (chave === 'simulador') return TEXTO_BLOQUEIO.cadastro;
    if (!cadastro) return TEXTO_BLOQUEIO.cadastro;
    switch (chave) {
      case 'basico': case 'completo': case 'materiais': case 'engenharia': case 'negociar': case 'usinas':
        return TEXTO_BLOQUEIO.perfil;
      case 'conversa': return libera.basico ? TEXTO_BLOQUEIO.proposta : TEXTO_BLOQUEIO.perfil;
      case 'pedido': case 'selo': case 'pacotes_engenharia': case 'consultoria':
        return TEXTO_BLOQUEIO.partner;
      case 'oportunidades': return pro ? TEXTO_BLOQUEIO.termo : TEXTO_BLOQUEIO.compra;
      default: return TEXTO_BLOQUEIO.compra; // plataforma, termo
    }
  };
  const out: Bloqueios = {};
  for (const k of Object.keys(libera) as Array<keyof Libera>) if (!libera[k]) out[k] = motivo(k);
  return out;
}

export function calcularNivel(p: EntradaNivel): { nivel: Nivel; progresso: Progresso; libera: Libera; bloqueios: Bloqueios } {
  const cadastro = cadastroConcluido(p);
  const perfil = cadastro && perfilCompleto(p);
  const comprados = Math.max(0, Math.floor(Number(p.carregadores_comprados) || 0));
  const pro = cadastro && ehPro(p);
  const partner = cadastro && (!!p.partner_em || pro);

  const nivel: Nivel =
    cadastro && comprados >= CARREGADORES_PARA_MASTER ? 'master'
    : pro ? 'pro'
    : partner ? 'partner'
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
    pedido: partner,
    selo: partner,
    oportunidades: pro && p.termo_aceito === true,
    pacotes_engenharia: partner,
    consultoria: partner,
    plataforma: pro,
    termo: pro,
  };

  let progresso: Progresso;
  if (nivel === 'cadastrado') {
    const faltam: string[] = faltasDoPerfil(p).length ? ['perfil'] : [];
    if (!p.primeira_proposta_em) faltam.push('primeira_proposta');
    if (!p.conversa_feita_em) faltam.push('conversa');
    if (!p.partner_em) faltam.push('aprovacao_partner');
    progresso = { proximo: 'partner', faltam };
  } else if (nivel === 'partner') {
    progresso = { proximo: 'pro', faltam: ['primeira_compra'] };
  } else if (nivel === 'pro') {
    progresso = { proximo: 'master', faltam: ['compras'], carregadores_faltam: CARREGADORES_PARA_MASTER - comprados };
  } else {
    progresso = { proximo: null, faltam: [] };
  }

  return { nivel, progresso, libera, bloqueios: bloqueiosDe(libera, cadastro, pro) };
}
