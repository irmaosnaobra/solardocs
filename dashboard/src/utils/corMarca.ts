/**
 * Cores da marca do integrador, em funções puras (sem React, sem DOM).
 *
 * A tela de atalhos (/inicio) pinta o app com a cor que o assinante escolheu na tela Empresa
 * (`cor_marca` e `cor_secundaria`). Esse valor vem do banco como texto livre, então nada daqui
 * entra em CSS antes de passar por `validarCor`. Só valem `#rgb` e `#rrggbb`.
 *
 * Contraste pela fórmula do WCAG 2.x (luminância relativa e razão (L1 + 0,05) / (L2 + 0,05)).
 */

/** Laranja da SolarDoc: o que a tela usa sem cor, ou com cor inválida. */
export const COR_PADRAO = '#F26513';

const BRANCO = '#ffffff';
const QUASE_PRETO = '#111111';

const RE_COR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Aceita só `#rgb` e `#rrggbb` (com espaço nas pontas, se vier). Devolve sempre `#rrggbb`, com as
 * letras como o integrador escreveu, ou null quando o valor não é uma cor válida.
 */
export function validarCor(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  if (!RE_COR.test(v)) return null;
  const h = v.slice(1);
  return '#' + (h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h);
}

interface RGB { r: number; g: number; b: number }

function hexParaRgb(hex: string): RGB {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbParaHex({ r, g, b }: RGB): string {
  const p = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b);
}

function canalLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminância relativa (0 preto, 1 branco) de um `#rrggbb` válido. */
export function luminancia(hex: string): number {
  const { r, g, b } = hexParaRgb(hex);
  return 0.2126 * canalLinear(r) + 0.7152 * canalLinear(g) + 0.0722 * canalLinear(b);
}

/** Razão de contraste entre duas cores `#rrggbb` válidas, de 1 (iguais) a 21 (preto e branco). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Escurece a cor (mistura com preto, mantendo o matiz) só o necessário para chegar a `minimo`:1
 * sobre `fundo`. Se já passa, devolve a própria cor. Pensada para fundo claro (o branco).
 */
export function escurecerAteContraste(cor: string, minimo: number, fundo: string = BRANCO): string {
  const base = validarCor(cor) ?? COR_PADRAO;
  if (contraste(base, fundo) >= minimo) return base;
  const { r, g, b } = hexParaRgb(base);
  for (let passo = 1; passo <= 100; passo++) {
    const f = 1 - passo / 100;
    // O teste é feito no hex já arredondado: é ele que vai para a tela.
    const candidata = rgbParaHex({ r: r * f, g: g * f, b: b * f });
    if (contraste(candidata, fundo) >= minimo) return candidata;
  }
  return '#000000';
}

/**
 * Cor do texto (e do ícone) sobre `fundo`: branco ou quase preto, o que der pelo menos 4,5:1.
 * Passando os dois, vale o de maior contraste. Numa faixa estreita de luminância nenhum dos dois
 * chega a 4,5:1; ali o texto vai de preto puro, que sempre passa.
 */
export function corDoTexto(fundo: string): string {
  const cb = contraste(BRANCO, fundo);
  const cp = contraste(QUASE_PRETO, fundo);
  if (Math.max(cb, cp) < 4.5) return '#000000';
  return cb >= cp ? BRANCO : QUASE_PRETO;
}

/** Uma versão mais escura da cor principal, para quando o integrador não escolheu a secundária. */
export function derivarSecundaria(principal: string): string {
  const { r, g, b } = hexParaRgb(validarCor(principal) ?? COR_PADRAO);
  return rgbParaHex({ r: r * 0.65, g: g * 0.65, b: b * 0.65 });
}

/** `rgba(r, g, b, alfa)` de um `#rrggbb` válido (o círculo a 10% atrás do ícone). */
export function comAlfa(hex: string, alfa: number): string {
  const { r, g, b } = hexParaRgb(validarCor(hex) ?? COR_PADRAO);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

export interface PaletaMarca {
  /** `#rrggbb` validado: a cor do integrador ou o laranja da SolarDoc. */
  principal: string;
  /** Texto e ícone SOBRE a principal (faixa do topo e blocos em destaque): pelo menos 4,5:1. */
  sobrePrincipal: string;
  /** Ícone SOBRE o branco: a principal, escurecida até 3:1 se preciso. */
  icone: string;
  /** Texto SOBRE o branco na cor da marca (as iniciais da empresa): a principal, escurecida até 4,5:1. */
  textoSobreBranco: string;
  /** Círculo atrás do ícone: a principal a 10%. */
  circulo: string;
  /** Sombra dos blocos em destaque: a principal a 28%. */
  sombra: string;
  /** Título dos grupos (texto sobre o branco): a secundária, escurecida até 4,5:1. */
  titulo: string;
  /** Anel de foco sobre o branco: a secundária, escurecida até 3:1. */
  anel: string;
  /** A principal veio da empresa (valida). Falso quando caiu no laranja padrão. */
  personalizada: boolean;
}

/**
 * Tudo que a tela precisa para pintar a marca, já validado. Sem principal válida usa o laranja da
 * SolarDoc; sem secundária válida deriva uma versão mais escura da principal.
 */
export function paletaDaMarca(corMarca: unknown, corSecundaria: unknown): PaletaMarca {
  const valida = validarCor(corMarca);
  const principal = valida ?? COR_PADRAO;
  const secundaria = validarCor(corSecundaria) ?? derivarSecundaria(principal);
  return {
    principal,
    sobrePrincipal: corDoTexto(principal),
    icone: escurecerAteContraste(principal, 3),
    textoSobreBranco: escurecerAteContraste(principal, 4.5),
    circulo: comAlfa(principal, 0.1),
    sombra: comAlfa(principal, 0.28),
    titulo: escurecerAteContraste(secundaria, 4.5),
    anel: escurecerAteContraste(secundaria, 3),
    personalizada: valida !== null,
  };
}
