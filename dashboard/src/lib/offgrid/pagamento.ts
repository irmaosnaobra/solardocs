/**
 * OFF-GRID: formas de pagamento da proposta.
 *
 * As contas e as taxas padrão aqui são CÓPIA EXATA de api/src/services/propostaSolarCalculos.ts
 * (TAXA_CARTAO_DEFAULT, FIN_RATE_DEFAULT, valorParcelaCartao). O financiamento (prazos, carência em dias, data da
 * 1ª parcela, parcela digitada) mora em ../propostaFinanciamento.ts, o MESMO arquivo da api. `comTaxasSeguras` é cópia da do template off-grid
 * (api/src/services/templates/propostaOffGridCompleta.ts). A prévia da tela e o PDF TÊM que dar a mesma parcela:
 * mexeu num lado, mexa no outro e rode o script de prova (as taxas de cartão são as do form solar).
 *
 * Sem importar nada com `@/`: o script de prova roda este arquivo direto com tsx.
 */
import { lerDinheiro } from './dinheiro';
import {
  FIN_BOTOES, FIN_CARENCIA_PADRAO, FIN_TAXA_PADRAO, camposFinanciamentoEnvio, comCarenciaPadrao, financiamentoNovo, parcelaFinanciamento,
  prazosFinanciamento, textoCarenciaFin, dataSaoPauloIso, type DadosFin,
} from '../propostaFinanciamento';

// ─── Cópia das contas da api ────────────────────────────────────────────────────

export const TAXA_CARTAO_DEFAULT: Record<number, number> = {
  1: 3.99, 2: 6.57, 3: 7.24, 4: 7.86, 5: 8.50, 6: 9.13, 7: 10.25,
  8: 11.01, 9: 11.72, 10: 12.44, 11: 13.23, 12: 13.65, 13: 14.80,
  14: 15.43, 15: 16.39, 16: 17.24, 17: 18.05, 18: 18.98,
  19: 20.31, 20: 21.81, 21: 23.17,
};

/** Financiamento Price com carência em dias (padrão 90). Taxa mensal padrão de 2,2%. Prazos: botões de 12 a 96 e "Outro prazo". */
export const FIN_RATE_DEFAULT = FIN_TAXA_PADRAO; // % a.m.
export const FIN_PRAZOS = FIN_BOTOES;
/** Prazos de cartão que a tela oferece (a proposta solar vai de 1 a 21). */
export const CARTAO_PRAZOS = [6, 10, 12, 18, 21] as const;

export function taxaCartao(f: Record<string, unknown>, n: number): number {
  const raw = String(f[`taxa_cartao_${n}`] || '').replace(',', '.');
  const v = parseFloat(raw);
  return v > 0 ? v : (TAXA_CARTAO_DEFAULT[n] ?? 0);
}

export function valorParcelaCartao(f: Record<string, unknown>, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  return Math.ceil((investimento * (1 + taxaCartao(f, n) / 100)) / n);
}

/** A parcela do financiamento que vale: a digitada, se houver, senão a automática (a mesma conta do PDF). */
export function valorParcelaFin(f: Record<string, unknown>, investimento: number, n: number): number {
  return parcelaFinanciamento(f, investimento, n);
}

/** Hoje, no calendário do aparelho (aaaa-mm-dd): a data base da 1ª parcela. */
/** Hoje no calendário de Brasília, o mesmo do servidor (no relógio do aparelho, AM/AC/RO/MT/MS viravam o dia antes). */
export function hojeIso(): string {
  return dataSaoPauloIso(new Date());
}

/** Cópia de `f` em que taxa de cartão e de financiamento fora de (0, 100] some, e o helper cai na taxa padrão. */
export function comTaxasSeguras(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f };
  for (const k of Object.keys(out)) {
    if (!/^taxa_(cartao|fin)_(\d+|livre)$/.test(k)) continue;
    const t = parseFloat(String(out[k] ?? '').replace(',', '.'));
    // Taxa 0 do financiamento vale 0 (sem juros) só no modo novo; vazio ou inválido cai no padrão.
    const semJuros = t === 0 && k.startsWith('taxa_fin_') && financiamentoNovo(f);
    if (!(t > 0 && t <= 100) && !semJuros) delete out[k];
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
  /** Botões de prazo do financiamento (12 a 96). */
  fin: Record<number, boolean>;
  /** "Outro prazo" digitado (1 a 120 meses). */
  finLivre: string;
  /** Carência em dias (0 a 120) e data da 1ª parcela (aaaa-mm-dd), ligadas. Data vazia = hoje + carência. */
  finCarencia: string;
  finPrimeira: string;
  /** Parcela digitada por prazo, texto "1.234,56". Vazio = a automática. */
  finManual: Record<string, string>;
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
    fin: { 12: false, 24: false, 36: false, 48: false, 60: true, 72: true, 84: false, 96: false },
    finLivre: '', finCarencia: String(FIN_CARENCIA_PADRAO), finPrimeira: '', finManual: {},
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

/** O financiamento da tela, no formato que o servidor lê (e que a conta e o componente de campos entendem). */
export function dadosFinanciamento(est: PagamentoEstado): DadosFin {
  const f: DadosFin = {
    fin_carencia_dias: est.finCarencia,
    fin_primeira_parcela: est.finPrimeira,
    fin_prazo_livre: est.finLivre,
    // A mesma taxa de juros em todos os prazos de financiamento.
    taxa_fin_livre: est.juros,
  };
  for (const n of FIN_BOTOES) {
    f[`pag_fin_${n}`] = !!est.fin[n];
    f[`taxa_fin_${n}`] = est.juros;
  }
  for (const [n, v] of Object.entries(est.finManual)) f[`fin_parcela_manual_${n}`] = v;
  return f;
}

/** Muda o estado a partir de um pedaço de dados no formato do servidor (o que o componente de campos devolve). */
export function aplicarDadosFinanciamento(est: PagamentoEstado, patch: Record<string, unknown>): Partial<PagamentoEstado> {
  const out: Partial<PagamentoEstado> = {};
  const fin = { ...est.fin };
  const manual = { ...est.finManual };
  let mexeuFin = false;
  let mexeuManual = false;
  for (const [k, v] of Object.entries(patch)) {
    const mb = /^pag_fin_(\d+)$/.exec(k);
    const mm = /^fin_parcela_manual_(\d+)$/.exec(k);
    if (mb) { fin[Number(mb[1])] = v === true; mexeuFin = true; }
    else if (mm) { manual[mm[1]] = String(v ?? ''); mexeuManual = true; }
    else if (k === 'fin_prazo_livre') out.finLivre = String(v ?? '');
    else if (k === 'fin_carencia_dias') out.finCarencia = String(v ?? '');
    else if (k === 'fin_primeira_parcela') out.finPrimeira = String(v ?? '');
  }
  if (mexeuFin) out.fin = fin;
  if (mexeuManual) out.finManual = manual;
  return out;
}

export function modeloPagamento(est: PagamentoEstado, preco: number, baseIso: string = hojeIso()): ModeloPagamento {
  const f = comTaxasSeguras(comCarenciaPadrao(dadosFinanciamento(est)));
  const cartao: Record<number, number> = {};
  const fin: Record<number, number> = {};
  const prazosFin = prazosFinanciamento(f);
  for (const n of CARTAO_PRAZOS) cartao[n] = valorParcelaCartao({}, preco, n);
  for (const n of prazosFin) fin[n] = valorParcelaFin(f, preco, n);

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
  const fins = prazosFin;
  const linhas: string[] = [];
  if (vistaAtiva) linhas.push(`À vista: ${brlTxt(vista)}.`);
  if (cartoes.length && preco > 0) linhas.push(`Cartão de crédito: ${cartoes.map((n) => `${n}× de ${brlTxt(cartao[n])}`).join(', ')}.`);
  if (fins.length && preco > 0) linhas.push(`Financiamento (${textoCarenciaFin(f, baseIso)}): ${fins.map((n) => `${n}× de ${brlTxt(fin[n])}`).join(', ')}.`);
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
export function camposPagamento(est: PagamentoEstado, preco: number, baseIso: string = hojeIso()): Record<string, unknown> {
  const m = modeloPagamento(est, preco, baseIso);
  const dadosFin = comCarenciaPadrao(dadosFinanciamento(est));
  const out: Record<string, unknown> = {
    pag_vista: est.vista,
    pag_cartao: CARTAO_PRAZOS.some((n) => est.cartao[n]),
    pag_fin: prazosFinanciamento(dadosFin).length > 0,
    pag_entrada: est.entrada,
    entrada_modo: est.entradaModo,
    entrada_dias: est.entradaDias.trim() || '30',
    pag_custom: est.custom.replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM),
  };
  if (m.vistaAtiva) out.preco_avista = m.vista;
  if (m.entrada > 0) out.entrada_valor = m.entrada;
  for (const n of CARTAO_PRAZOS) out[`pag_cartao_${n}`] = !!est.cartao[n];
  for (const n of FIN_BOTOES) {
    out[`pag_fin_${n}`] = !!est.fin[n];
    out[`taxa_fin_${n}`] = est.juros;
  }
  out.taxa_fin_livre = est.juros;
  // Carência em dias, data da 1ª parcela, "Outro prazo" e parcelas digitadas, limpos e com tipo certo.
  Object.assign(out, camposFinanciamentoEnvio(dadosFin, baseIso));
  return out;
}
