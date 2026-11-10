/**
 * OFF-GRID: formas de pagamento da proposta.
 *
 * As contas e as taxas padrão aqui são CÓPIA EXATA de api/src/services/propostaSolarCalculos.ts
 * (TAXA_CARTAO_DEFAULT, FIN_CARENCIA_MESES, FIN_RATE_DEFAULT, FIN_PRAZOS, valorParcelaCartao, valorParcelaFin) e de
 * pmtPriceCarencia (propostaSolarBase.ts). `comTaxasSeguras` é cópia da do template off-grid
 * (api/src/services/templates/propostaOffGridCompleta.ts). A prévia da tela e o PDF TÊM que dar a mesma parcela:
 * mexeu num lado, mexa no outro e rode o script de prova (as taxas de cartão são as do form solar).
 *
 * Sem importar nada com `@/`: o script de prova roda este arquivo direto com tsx.
 */
import { lerDinheiro } from './dinheiro';

// ─── Cópia das contas da api ────────────────────────────────────────────────────

export const TAXA_CARTAO_DEFAULT: Record<number, number> = {
  1: 3.99, 2: 5.30, 3: 5.99, 4: 6.68, 5: 7.35, 6: 8.02, 7: 9.47,
  8: 10.13, 9: 10.78, 10: 11.43, 11: 12.06, 12: 12.70, 13: 13.32,
  14: 13.94, 15: 14.56, 16: 15.17, 17: 15.77, 18: 16.37,
  19: 16.97, 20: 17.57, 21: 18.17,
};

/** Financiamento Price com 120 dias (4 meses) de carência. Taxa mensal padrão de 2,2%. */
export const FIN_CARENCIA_MESES = 4;
export const FIN_RATE_DEFAULT = 2.20; // % a.m.
export const FIN_PRAZOS = [36, 48, 60, 72, 84] as const;
/** Prazos de cartão que a tela oferece (a proposta solar vai de 1 a 21). */
export const CARTAO_PRAZOS = [6, 10, 12, 18, 21] as const;

export function pmtPriceCarencia(pv: number, i: number, n: number, carenciaMeses: number): number {
  if (!pv || pv <= 0) return 0;
  const saldo = pv * Math.pow(1 + i, carenciaMeses);
  return saldo * i / (1 - Math.pow(1 + i, -n));
}

export function taxaCartao(f: Record<string, unknown>, n: number): number {
  const raw = String(f[`taxa_cartao_${n}`] || '').replace(',', '.');
  const v = parseFloat(raw);
  return v > 0 ? v : (TAXA_CARTAO_DEFAULT[n] ?? 0);
}

export function valorParcelaCartao(f: Record<string, unknown>, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  return Math.ceil((investimento * (1 + taxaCartao(f, n) / 100)) / n);
}

export function taxaFin(f: Record<string, unknown>, n: number): number {
  const raw = String(f[`taxa_fin_${n}`] || '').replace(',', '.');
  const v = parseFloat(raw);
  return v > 0 ? v : FIN_RATE_DEFAULT;
}

export function valorParcelaFin(f: Record<string, unknown>, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  return Math.ceil(pmtPriceCarencia(investimento, taxaFin(f, n) / 100, n, FIN_CARENCIA_MESES));
}

/** Cópia de `f` em que taxa de cartão e de financiamento fora de (0, 100] some, e o helper cai na taxa padrão. */
export function comTaxasSeguras(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f };
  for (const k of Object.keys(out)) {
    if (!/^taxa_(cartao|fin)_\d+$/.test(k)) continue;
    const t = parseFloat(String(out[k] ?? '').replace(',', '.'));
    if (!(t > 0 && t <= 100)) delete out[k];
  }
  return out;
}

// ─── Estado da tela ─────────────────────────────────────────────────────────────

export type EntradaModo = 'contrato' | 'entrega' | 'montagem' | 'liberacao' | 'dias';

export const ENTRADA_MODOS: { id: EntradaModo; rotulo: string }[] = [
  { id: 'contrato', rotulo: 'Na assinatura do contrato' },
  { id: 'entrega', rotulo: 'Na entrega do material' },
  { id: 'montagem', rotulo: 'Na montagem do sistema' },
  { id: 'liberacao', rotulo: 'Na liberação do sistema' },
  { id: 'dias', rotulo: 'Em X dias' },
];

export const MAX_CUSTOM = 500;

export interface PagamentoEstado {
  vista: boolean;
  /** Texto digitado. Enquanto `vistaAuto`, vale a sugestão e este texto não é lido. */
  vistaTexto: string;
  vistaAuto: boolean;
  cartao: Record<number, boolean>;
  fin: Record<number, boolean>;
  /** Juros ao mês do financiamento, texto digitado ("2,2"). */
  juros: string;
  entrada: boolean;
  entradaTexto: string;
  entradaAuto: boolean;
  entradaModo: EntradaModo;
  entradaDias: string;
  custom: string;
}

export function pagamentoInicial(): PagamentoEstado {
  return {
    vista: true, vistaTexto: '', vistaAuto: true,
    cartao: { 6: false, 10: false, 12: true, 18: true, 21: false },
    fin: { 36: false, 48: false, 60: true, 72: true, 84: false },
    juros: '2,2',
    entrada: true, entradaTexto: '', entradaAuto: true, entradaModo: 'entrega', entradaDias: '30',
    custom: '',
  };
}

/** Sugestões de partida, em dezenas de reais: à vista 5% abaixo do preço e entrada de 30%. */
export function vistaSugerida(preco: number): number {
  return Math.round((preco * 95) / 100 / 10) * 10;
}
export function entradaSugerida(preco: number): number {
  return Math.round((preco * 30) / 100 / 10) * 10;
}

// ─── O que a tela mostra e o que o servidor recebe, da MESMA fonte ──────────────

export interface ModeloPagamento {
  preco: number;
  vista: number;
  vistaAtiva: boolean;
  vistaMsg: string;
  entrada: number;
  restante: number;
  entradaAtiva: boolean;
  entradaMsg: string;
  prazoRestante: string;
  cartao: Record<number, number>;
  fin: Record<number, number>;
  /** Linhas do "Na proposta vai sair". */
  linhas: string[];
}

const brlTxt = (n: number): string =>
  Math.abs(n - Math.round(n)) < 0.005
    ? 'R$ ' + Math.round(n).toLocaleString('pt-BR')
    : 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Campos de taxa que vão ao servidor: a mesma taxa de juros em todos os prazos de financiamento. */
function camposTaxa(est: PagamentoEstado): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const n of FIN_PRAZOS) f[`taxa_fin_${n}`] = est.juros;
  return f;
}

export function modeloPagamento(est: PagamentoEstado, preco: number): ModeloPagamento {
  const f = comTaxasSeguras(camposTaxa(est));
  const cartao: Record<number, number> = {};
  const fin: Record<number, number> = {};
  for (const n of CARTAO_PRAZOS) cartao[n] = valorParcelaCartao({}, preco, n);
  for (const n of FIN_PRAZOS) fin[n] = valorParcelaFin(f, preco, n);

  const vista = est.vistaAuto ? vistaSugerida(preco) : lerDinheiro(est.vistaTexto);
  const vistaAtiva = est.vista && vista > 0 && vista < preco;
  const vistaMsg = !est.vista || preco <= 0 ? ''
    : vista <= 0 ? 'Sem valor, não aparece na proposta.'
    : vista === preco ? 'Igual ao preço final, não aparece na proposta.'
    : vista > preco ? 'Maior que o preço final, não aparece na proposta.' : '';

  const entrada = est.entradaAuto ? entradaSugerida(preco) : lerDinheiro(est.entradaTexto);
  const restante = Math.max(0, preco - entrada);
  const entradaAtiva = est.entrada && entrada > 0 && restante > 0;
  const entradaMsg = !est.entrada || preco <= 0 ? ''
    : entrada <= 0 ? 'Sem valor, não aparece na proposta.'
    : restante <= 0 ? 'A entrada tem que ser menor que o preço final. Assim não aparece na proposta.'
    : `Restante: ${brlTxt(restante)}.`;

  const diasN = parseInt(est.entradaDias, 10);
  const dias = diasN > 0 && diasN <= 365 ? diasN : 30;
  const prazoRestante = est.entradaModo === 'contrato' ? 'na assinatura do contrato'
    : est.entradaModo === 'entrega' ? 'na entrega do material'
    : est.entradaModo === 'montagem' ? 'na montagem do sistema'
    : est.entradaModo === 'liberacao' ? 'na liberação do sistema'
    : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;

  const cartoes = CARTAO_PRAZOS.filter((n) => est.cartao[n]);
  const fins = FIN_PRAZOS.filter((n) => est.fin[n]);
  const linhas: string[] = [];
  if (vistaAtiva) linhas.push(`À vista: ${brlTxt(vista)}.`);
  if (cartoes.length && preco > 0) linhas.push(`Cartão de crédito: ${cartoes.map((n) => `${n}× de ${brlTxt(cartao[n])}`).join(', ')}.`);
  if (fins.length && preco > 0) linhas.push(`Financiamento, com ${FIN_CARENCIA_MESES} meses de carência: ${fins.map((n) => `${n}× de ${brlTxt(fin[n])}`).join(', ')}.`);
  if (entradaAtiva) linhas.push(`Entrada de ${brlTxt(entrada)}, e restante de ${brlTxt(restante)} ${prazoRestante}.`);
  const cu = est.custom.replace(/\s+/g, ' ').trim();
  if (cu) linhas.push(`Outra condição: ${cu.length > MAX_CUSTOM ? cu.slice(0, MAX_CUSTOM) : cu}`);

  return { preco, vista, vistaAtiva, vistaMsg, entrada, restante, entradaAtiva, entradaMsg, prazoRestante, cartao, fin, linhas };
}

/**
 * Os campos `pag_*` do servidor (os MESMOS nomes da proposta solar). Sempre manda os três interruptores
 * (`pag_vista`, `pag_cartao`, `pag_fin`) com valor explícito: o servidor trata ausente como ligado.
 * Dinheiro vai como número. As taxas de cartão ficam de fora (vale a tabela padrão, igual à da prévia).
 */
export function camposPagamento(est: PagamentoEstado, preco: number): Record<string, unknown> {
  const m = modeloPagamento(est, preco);
  const out: Record<string, unknown> = {
    pag_vista: est.vista,
    pag_cartao: CARTAO_PRAZOS.some((n) => est.cartao[n]),
    pag_fin: FIN_PRAZOS.some((n) => est.fin[n]),
    pag_entrada: est.entrada,
    entrada_modo: est.entradaModo,
    entrada_dias: est.entradaDias.trim() || '30',
    pag_custom: est.custom.replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM),
  };
  if (m.vistaAtiva) out.preco_avista = m.vista;
  if (m.entrada > 0) out.entrada_valor = m.entrada;
  for (const n of CARTAO_PRAZOS) out[`pag_cartao_${n}`] = !!est.cartao[n];
  for (const n of FIN_PRAZOS) {
    out[`pag_fin_${n}`] = !!est.fin[n];
    out[`taxa_fin_${n}`] = est.juros;
  }
  return out;
}
