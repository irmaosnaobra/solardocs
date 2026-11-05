// CPF e CNPJ: só dígitos, dígito verificador e máscara. Puro, sem banco nem rede.
// O CNPJ vem de ./cnpj (uma regra só no repositório); aqui entra o CPF e a validação
// da assinatura da proposta Completa + Banco.
import { soDigitos, cnpjValido, formatarCnpj, normalizarCnpj } from './cnpj';

export { soDigitos, cnpjValido, formatarCnpj, normalizarCnpj };

/** 11 dígitos, não todos iguais, e os dois dígitos verificadores batendo. */
export function cpfValido(v: unknown): boolean {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += parseInt(c[i], 10) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(c[9], 10) && calc(10) === parseInt(c[10], 10);
}

/** 52998224725 vira 529.982.247-25. Se não tiver 11 dígitos, devolve só os dígitos. */
export function formatarCpf(v: unknown): string {
  const d = soDigitos(v);
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// ─── Assinatura da proposta Completa + Banco ─────────────────────────────────

export interface AssinaturaEmpresa { razao_social: string; cnpj: string; representante: string; cargo: string }
export interface AssinaturaCliente { tipo: 'PF' | 'PJ'; nome: string; documento: string; representante?: string }
export interface Assinatura { empresa: AssinaturaEmpresa; cliente: AssinaturaCliente; local?: string }

const MAX_NOME = 160;
const MAX_CARGO = 60;
const MAX_LOCAL = 80;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function aparar(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max).trim() : '';
}

/**
 * Leitura tolerante: devolve a assinatura limpa (textos aparados e no tamanho máximo, documentos só
 * com dígitos) ou null se não for um objeto com empresa e cliente. NÃO valida: use validarAssinatura.
 */
export function normalizarAssinatura(v: unknown): Assinatura | null {
  if (!ehObjeto(v) || !ehObjeto(v.empresa) || !ehObjeto(v.cliente)) return null;
  const e = v.empresa;
  const c = v.cliente;
  const representante = aparar(c.representante, MAX_NOME);
  const local = aparar(v.local, MAX_LOCAL);
  return {
    empresa: {
      razao_social: aparar(e.razao_social, MAX_NOME),
      cnpj: normalizarCnpj(e.cnpj).slice(0, 14),
      representante: aparar(e.representante, MAX_NOME),
      cargo: aparar(e.cargo, MAX_CARGO),
    },
    cliente: {
      tipo: c.tipo === 'PJ' ? 'PJ' : 'PF',
      nome: aparar(c.nome, MAX_NOME),
      // PF guarda só dígitos (CPF); PJ guarda o CNPJ sem pontuação, com as letras do alfanumérico.
      documento: (c.tipo === 'PJ' ? normalizarCnpj(c.documento) : soDigitos(c.documento)).slice(0, 14),
      ...(representante ? { representante } : {}),
    },
    ...(local ? { local } : {}),
  };
}

/** Primeira mensagem de erro da assinatura (já normalizada ou crua), ou null se estiver tudo certo. */
export function validarAssinatura(a: unknown): string | null {
  const n = normalizarAssinatura(a);
  if (!n) return 'Para gerar a Completa + Banco, preencha as assinaturas do cliente e da empresa.';
  const { cliente, empresa } = n;
  if (cliente.tipo === 'PJ') {
    if (cliente.nome.length < 3) return 'Escreva a razão social do cliente.';
    if (!cnpjValido(cliente.documento)) return 'CNPJ do cliente inválido. Confira os números.';
  } else {
    if (cliente.nome.split(' ').filter(Boolean).length < 2) return 'Escreva o nome completo do cliente.';
    if (!cpfValido(cliente.documento)) return 'CPF do cliente inválido. Confira os números.';
  }
  if (empresa.razao_social.length < 3) return 'Escreva a razão social da sua empresa.';
  if (!cnpjValido(empresa.cnpj)) return 'CNPJ da sua empresa inválido. Confira na tela Empresa.';
  if (empresa.representante.length < 2) return 'Escreva quem assina pela sua empresa.';
  return null;
}
