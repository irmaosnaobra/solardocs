// Financiamento da proposta solar e da off-grid: prazos, carência em dias, data da 1ª parcela e parcela digitada.
// Módulo PURO (sem import, sem banco, sem relógio): a api e o app SolarDoc têm o MESMO arquivo, byte a byte.
//   api:       api/src/services/propostaFinanciamento.ts
//   dashboard: dashboard/src/lib/propostaFinanciamento.ts
// Mexeu num? Copie para o outro. O teste `propostaFinanciamento.test.ts` falha se os dois divergirem.
//
// Documento ANTIGO (sem `fin_carencia_dias`) continua como foi enviado: prazos 36 a 84, "120 dias de carência", a
// mesma conta de sempre. Só o documento que traz `fin_carencia_dias` entra no modo novo.
//
// Campos novos do dados_json (nome e tipo):
//   fin_carencia_dias        número 0 a 120 (padrão 90)
//   fin_primeira_parcela     texto aaaa-mm-dd, entre a data base e a data base + 120 dias
//   fin_prazo_livre          número inteiro 1 a 120 ("Outro prazo")
//   fin_parcela_manual_<N>   número em reais, a parcela digitada do prazo N (vence a automática)
//   taxa_fin_livre           taxa ao mês do "Outro prazo" (os prazos dos botões seguem em taxa_fin_<N>)
//   pag_fin_<N>              botão do prazo N ligado (12, 24, 36, 48, 60, 72, 84, 96), como sempre foi

export type DadosFin = Record<string, unknown>;

/** Prazos dos botões, em meses. */
export const FIN_BOTOES = [12, 24, 36, 48, 60, 72, 84, 96] as const;
/** Prazos que o documento antigo conhecia. */
export const FIN_PRAZOS_ANTIGOS = [36, 48, 60, 72, 84] as const;
export const FIN_PRAZO_MAX = 120;
export const FIN_CARENCIA_PADRAO = 90;
export const FIN_CARENCIA_MAX = 120;
/** Documento antigo: 4 meses de carência, ou seja, 120 dias. */
export const FIN_CARENCIA_ANTIGA = 120;
export const FIN_TAXA_PADRAO = 2.2; // % ao mês

const DIA_MS = 86400000;

/** Dinheiro vindo do formulário ("1.234,56") ou já número. Inválido vira 0. */
export function lerDinheiroFin(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** O documento tem os campos novos? Sem `fin_carencia_dias` é documento antigo. */
export function financiamentoNovo(f: DadosFin): boolean {
  const v = f.fin_carencia_dias;
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/** Tela do formulário: campo de carência vazio ou ausente conta como o padrão (90), nunca como documento antigo. */
export function comCarenciaPadrao(f: DadosFin): DadosFin {
  return financiamentoNovo(f) ? f : { ...f, fin_carencia_dias: FIN_CARENCIA_PADRAO };
}

/** Carência em dias que vale para a conta: antigo = 120; novo = o campo, de 0 a 120 (ilegível = 90). */
export function carenciaDias(f: DadosFin): number {
  if (!financiamentoNovo(f)) return FIN_CARENCIA_ANTIGA;
  const n = Number(String(f.fin_carencia_dias).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return FIN_CARENCIA_PADRAO;
  return Math.min(FIN_CARENCIA_MAX, Math.max(0, Math.round(n)));
}

/** "Outro prazo" digitado: inteiro de 1 a 120, ou null. Só vale no modo novo. */
export function prazoLivre(f: DadosFin): number | null {
  if (!financiamentoNovo(f)) return null;
  const raw = f.fin_prazo_livre;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= FIN_PRAZO_MAX ? r : null;
}

/** Prazos que a proposta mostra, em ordem crescente e sem repetir. */
export function prazosFinanciamento(f: DadosFin): number[] {
  if (!financiamentoNovo(f)) return FIN_PRAZOS_ANTIGOS.filter((n) => f[`pag_fin_${n}`] === true);
  const set = new Set<number>(FIN_BOTOES.filter((n) => f[`pag_fin_${n}`] === true));
  const livre = prazoLivre(f);
  if (livre) set.add(livre);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Taxa ao mês do prazo N (em %). Vazia ou inválida cai em 2,2. Taxa 0 digitada vale 0 (financiamento sem juros),
 * mas só no modo novo: documento antigo trata 0 como vazio, como sempre tratou.
 */
export function taxaPrazoFin(f: DadosFin, n: number): number {
  const novo = financiamentoNovo(f);
  const doBotao = (FIN_BOTOES as readonly number[]).includes(n) || !novo;
  const bruto = f[doBotao ? `taxa_fin_${n}` : 'taxa_fin_livre'];
  const v = parseFloat(String(bruto || (novo && bruto === 0 ? '0' : '')).replace(',', '.'));
  if (v > 0) return v;
  return novo && v === 0 ? 0 : FIN_TAXA_PADRAO;
}

/** Parcela digitada do prazo N (em reais). 0 = não tem. Só vale no modo novo. */
export function parcelaManualFin(f: DadosFin, n: number): number {
  if (!financiamentoNovo(f)) return 0;
  const v = lerDinheiroFin(f[`fin_parcela_manual_${n}`]);
  return v > 0 ? Math.round(v * 100) / 100 : 0;
}

/** Price com carência em dias: o saldo cresce (1+i)^(dias/30) na carência, depois parcelas iguais. */
export function pmtPriceCarenciaDias(pv: number, i: number, n: number, dias: number): number {
  if (!pv || pv <= 0) return 0;
  if (i === 0) return pv / n; // sem juros: parcelas iguais
  const saldo = pv * Math.pow(1 + i, dias / 30);
  return saldo * i / (1 - Math.pow(1 + i, -n));
}

/** Parcela automática do prazo N, arredondada para cima em reais inteiros. */
export function parcelaAutomaticaFin(f: DadosFin, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  return Math.ceil(pmtPriceCarenciaDias(investimento, taxaPrazoFin(f, n) / 100, n, carenciaDias(f)));
}

/** A parcela que vale: a digitada, se for maior que 0 e não passar do valor financiado; senão a automática. */
export function parcelaFinanciamento(f: DadosFin, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  const manual = parcelaManualFin(f, n);
  return manual > 0 && manual <= investimento ? manual : parcelaAutomaticaFin(f, investimento, n);
}

// ─── Datas (texto aaaa-mm-dd, sem fuso) ──────────────────────────────────────

/** Texto aaaa-mm-dd de uma data real, ou null. */
export function dataIsoValida(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function paraMs(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

export function somarDiasIso(iso: string, dias: number): string {
  return new Date(paraMs(iso) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Dias corridos de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntreIso(de: string, ate: string): number {
  return Math.round((paraMs(ate) - paraMs(de)) / DIA_MS);
}

/** aaaa-mm-dd vira dd/mm/aaaa. */
export function dataBRFin(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Limita a data da 1ª parcela entre a data base e a data base + 120 dias. */
export function limitarPrimeiraParcela(iso: string, baseIso: string): string {
  const d = diasEntreIso(baseIso, iso);
  if (d < 0) return baseIso;
  if (d > FIN_CARENCIA_MAX) return somarDiasIso(baseIso, FIN_CARENCIA_MAX);
  return iso;
}

/**
 * Carência e data da 1ª parcela, ligadas: carência = data - base. A data vale se for válida e estiver entre a base e a
 * base + 120 dias; senão ela é descartada e a data sai da carência (de 0 a 120).
 */
export function primeiraParcelaFin(f: DadosFin, baseIso: string): { dias: number; iso: string } {
  const digitada = dataIsoValida(f.fin_primeira_parcela);
  if (digitada) {
    const d = diasEntreIso(baseIso, digitada);
    if (d >= 0 && d <= FIN_CARENCIA_MAX) return { dias: d, iso: digitada };
  }
  const dias = carenciaDias(f);
  return { dias, iso: somarDiasIso(baseIso, dias) };
}

/** Dias de validade da proposta (padrão 7), igual a `propostaDiasValidade` da api. */
export function validadeDiasFin(f: DadosFin): number {
  const n = parseInt(String(f.validade_dias ?? '').replace(/\D/g, ''), 10);
  return n > 0 ? n : 7;
}

/** Dia (aaaa-mm-dd) de uma data no calendário de Brasília. */
export function dataSaoPauloIso(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * A data base do financiamento: UMA só, a mesma função na tela e no servidor. Proposta nova = hoje. Reedição (regra do
 * documentsController): o dia em que a proposta foi criada, enquanto a validade dela não venceu; vencida, hoje.
 * `criadoEm` vazio ou ilegível = proposta nova.
 */
export function baseFinanciamento(criadoEm: unknown, validadeDias: number, agora: Date): string {
  const hoje = dataSaoPauloIso(agora);
  const raw = String(criadoEm ?? '').trim();
  if (!raw) return hoje;
  const criado = new Date(raw);
  if (Number.isNaN(criado.getTime())) return hoje;
  return criado.getTime() + validadeDias * 86400000 > agora.getTime() ? dataSaoPauloIso(criado) : hoje;
}

/**
 * Deixa carência e data da 1ª parcela ligadas, para gravar e para imprimir: carência = data - base. Documento antigo
 * (sem `fin_carencia_dias`) volta como veio. Idempotente.
 */
export function normalizarFinanciamento(f: DadosFin, baseIso: string): DadosFin {
  if (!financiamentoNovo(f)) return f;
  const { dias, iso } = primeiraParcelaFin(f, baseIso);
  return { ...f, fin_carencia_dias: dias, fin_primeira_parcela: iso };
}

/** Texto da carência no PDF, no link e no resumo. Documento antigo: "120 dias de carência", como sempre. */
export function textoCarenciaFin(f: DadosFin, baseIso: string): string {
  if (!financiamentoNovo(f)) return `${FIN_CARENCIA_ANTIGA} dias de carência`;
  const { dias, iso } = primeiraParcelaFin(f, baseIso);
  const carencia = dias === 0 ? 'Sem carência' : `Carência de ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return `${carencia} · 1ª parcela em ${dataBRFin(iso)}`;
}

/**
 * Os campos de financiamento que o formulário manda: limpos e com tipo certo. Carência de 0 a 120, data entre a
 * base e a base + 120 dias (o limite vale aqui também, porque no Safari o clique em Gerar não tira o foco do
 * campo), prazo livre inteiro, e só as parcelas digitadas dos prazos que estão na proposta.
 */
export function camposFinanciamentoEnvio(f: DadosFin, baseIso: string): DadosFin {
  // Mesma regra do servidor: data válida e dentro da faixa manda (carência = data - base); fora dela, a carência calcula a data.
  const { dias, iso } = primeiraParcelaFin(comCarenciaPadrao(f), baseIso);
  const novo: DadosFin = { fin_carencia_dias: dias, fin_primeira_parcela: iso };
  const base = { ...f, ...novo };
  const livre = prazoLivre(base);
  if (livre) novo.fin_prazo_livre = livre;
  for (const n of prazosFinanciamento(base)) {
    const manual = parcelaManualFin(base, n);
    if (manual > 0) novo[`fin_parcela_manual_${n}`] = manual;
  }
  return novo;
}

/** Chaves do dados_json que o formulário limpa antes de reenviar (para não sobrar valor de prazo que saiu). */
export function chavesFinanciamentoParaLimpar(f: DadosFin): string[] {
  return Object.keys(f).filter((k) => k === 'fin_prazo_livre' || k.startsWith('fin_parcela_manual_'));
}
