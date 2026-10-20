// ─────────────────────────────────────────────────────────────────────────────
// ANÁLISE DA VENDA SOLAR pelo card (20/10/2026): módulo PURO (sem banco, sem rede, sem relógio). Recebe os valores do cadastro
// `vendasolar` e o que a proposta LIGADA guarda de geração, e devolve duas conferências para a tela:
//
//   rateio   { soma, bloqueios, avisos }  a conta do rateio entre a geradora e as beneficiárias
//   consumo  { conta_kwh, contas_kwh, base, proposta_kwh, proposta_consumo_kwh, razao, aviso }  o consumo da conta contra a geração
//            da proposta (`mediaMensalGerada`, ou a média do array `mensalKwh`, ou `geracaoAnualKwh / 12`; o `consumoKwh` da proposta
//            é consumo e nunca é geração)
//
// BLOQUEIO é erro de conta (a tela não gera a procuração/rateio com ele; o cadastro grava mesmo assim). AVISO é "confira":
// depende do que só a distribuidora confirma (titularidade, área de concessão, aceitar soma abaixo de 100%).
// Base: Lei 14.300/2022 (art. 1º) e REN ANEEL 1.000/2021 com a 1.059. Nenhum valor de campo vai para log.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_UNIDADES_BENEFICIARIAS = 5;

/**
 * O que a proposta ligada guarda (`propostas.dados`, formato do gerador). Qualquer um pode faltar.
 * Geração, nesta ordem: `mediaMensalGerada`; a média do array `mensalKwh` (12 valores de GERAÇÃO, um por mês); `geracaoAnualKwh / 12`.
 * `consumoKwh` é o consumo informado no dimensionamento: não é geração e nunca entra na comparação.
 */
export interface GeracaoDaProposta { mediaMensalGerada?: unknown; mensalKwh?: unknown; geracaoAnualKwh?: unknown; consumoKwh?: unknown }
export type Valores = Readonly<Partial<Record<string, string>>>;

export interface AnaliseRateio { soma: number; bloqueios: string[]; avisos: string[] }
export type BaseConsumo = 'proposta_media_gerada' | 'proposta_mensal_12' | 'proposta_anual_12';
export interface ContaKwh { unidade: string; kwh: number }
export interface AnaliseConsumo {
  /** Soma dos consumos que o cadastro conhece (hoje só o da geradora). null = não há consumo preenchido. */
  conta_kwh: number | null;
  /** O consumo de cada conta somada, na ordem: `{ unidade: 'geradora' | 'benef_N', kwh }`. */
  contas_kwh: ContaKwh[];
  /** De que campo da proposta veio a geração; null = não houve comparação. */
  base: BaseConsumo | null;
  proposta_kwh: number | null;
  /** O consumo mensal que a proposta considerou no dimensionamento (`mensalKwh`), só para a tela mostrar junto. Não entra na conta. */
  proposta_consumo_kwh: number | null;
  /** Em uma frase: o que foi comparado, ou por que não foi. */
  razao: string;
  /** Só quando a geração está fora de 90% a 130% do consumo. Nunca é bloqueio. */
  aviso: string | null;
}
export interface AnaliseSolar { rateio: AnaliseRateio; consumo: AnaliseConsumo }

const FAIXA_MIN = 0.9;
const FAIXA_MAX = 1.3;

const cheio = (v: string | undefined): string => (typeof v === 'string' ? v.trim() : '');
const digitos = (t: string): string => t.replace(/\D/g, '');
/** A UC sem pontuação, espaço nem caixa: "0012-3456" e "00123456" são a mesma unidade. */
const chaveDaUc = (t: string): string => t.replace(/[^0-9a-z]/gi, '').toUpperCase();
const centavos = (n: number): number => Math.round(n * 100);
const fmtPct = (n: number): string => `${String(Math.round(n * 100) / 100).replace('.', ',')}%`;
const fmtKwh = (n: number): string => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(n))} kWh/mês`;

/** Número que veio do banco (número, "350", "350,5", "1.234,5"). null = não é número positivo. */
export function paraNumero(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) && x > 0 ? x : null;
  if (typeof x !== 'string') return null;
  let s = x.replace(/\s+/g, '').replace(/kwh(\/mês)?$/i, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A média do array de 12 gerações mensais (`dados.mensalKwh`). Aceita o array ou o seu JSON em texto. null = não é um array de
 * 12 números maiores ou iguais a zero, ou a média não passa de zero (um array pela metade não vira média).
 */
export function mediaDoArrayMensal(x: unknown): number | null {
  let a: unknown = x;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return null; } }
  if (!Array.isArray(a) || a.length !== 12) return null;
  let soma = 0;
  for (const v of a) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
    if (!Number.isFinite(n) || n < 0) return null;
    soma += n;
  }
  return soma > 0 ? soma / 12 : null;
}

interface Beneficiaria { n: number; uc: string; pct: string; doc: string; titular: string }

/** As vagas de beneficiária em uso: com UC, percentual, documento, titular ou endereço. */
function beneficiariasEmUso(v: Valores): Beneficiaria[] {
  const lista: Beneficiaria[] = [];
  for (let n = 1; n <= MAX_UNIDADES_BENEFICIARIAS; n++) {
    const b: Beneficiaria = {
      n, uc: cheio(v[`benef_${n}_uc`]), pct: cheio(v[`benef_${n}_pct`]), doc: cheio(v[`benef_${n}_doc`]), titular: cheio(v[`benef_${n}_titular`]),
    };
    if (b.uc || b.pct || b.doc || b.titular || cheio(v[`benef_${n}_endereco`])) lista.push(b);
  }
  return lista;
}

/** Mesmo titular: o mesmo documento, ou CNPJ da mesma raiz (matriz e filial). */
function mesmoTitular(a: string, b: string): boolean {
  const da = digitos(a);
  const db = digitos(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return da.length === 14 && db.length === 14 && da.slice(0, 8) === db.slice(0, 8);
}

export function analisarRateio(v: Valores): AnaliseRateio {
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  const bens = beneficiariasEmUso(v);
  const geradoraPct = cheio(v.geradora_pct) === '' ? 0 : Number(cheio(v.geradora_pct));
  let somaC = centavos(Number.isFinite(geradoraPct) ? geradoraPct : 0);
  for (const b of bens) {
    const n = b.pct === '' ? NaN : Number(b.pct);
    if (Number.isFinite(n)) somaC += centavos(n);
  }
  const soma = somaC / 100;

  if (somaC > 10000) bloqueios.push(`A soma dos percentuais é ${fmtPct(soma)} e não pode passar de 100%, contando a unidade geradora.`);

  // UC repetida (entre a geradora e as beneficiárias, ou entre beneficiárias).
  const vistas = new Map<string, string>();
  const ucGeradora = cheio(v.unidade_consumidora);
  if (ucGeradora) vistas.set(chaveDaUc(ucGeradora), 'a unidade geradora');
  const repetidas = new Set<string>();
  for (const b of bens) {
    if (!b.uc) continue;
    const k = chaveDaUc(b.uc);
    const antes = vistas.get(k);
    if (antes) repetidas.add(`A mesma unidade consumidora aparece em ${antes} e na beneficiária ${b.n}.`);
    else vistas.set(k, `a beneficiária ${b.n}`);
  }
  bloqueios.push(...repetidas);

  // Beneficiária com UC e sem percentual, ou com percentual e sem UC.
  for (const b of bens) {
    if (b.uc && !b.pct) bloqueios.push(`A beneficiária ${b.n} tem unidade consumidora e falta o percentual.`);
    else if (b.pct && !b.uc) bloqueios.push(`A beneficiária ${b.n} tem percentual e falta a unidade consumidora.`);
  }

  if (bens.length > 0) {
    if (somaC < 10000) {
      avisos.push(`A soma dos percentuais é ${fmtPct(soma)}. Em algumas distribuidoras a sobra fica na geradora. Confira com a distribuidora.`);
    }
    if (!cheio(v.rateio_modalidade)) {
      avisos.push('Escolha a modalidade do rateio. Titularidade e área de concessão só a distribuidora confirma.');
    }
    if (cheio(v.rateio_modalidade) === 'autoconsumo_remoto') {
      const docTitular = cheio(v.tuc_cpf_cnpj) || cheio(v.cpf_cnpj);
      if (!docTitular) {
        avisos.push('Falta o documento do titular da unidade geradora para conferir as beneficiárias do autoconsumo remoto.');
      } else {
        for (const b of bens) {
          if (!b.uc && !b.pct) continue;
          if (!b.doc) avisos.push(`Falta o CPF ou CNPJ da beneficiária ${b.n}. No autoconsumo remoto ela precisa ser do mesmo titular da geradora. Confira com a distribuidora.`);
          else if (!mesmoTitular(b.doc, docTitular)) avisos.push(`A beneficiária ${b.n} tem documento diferente do titular da geradora. No autoconsumo remoto o titular é o mesmo (mesmo CPF, ou matriz e filial). Confira com a distribuidora.`);
        }
      }
    }
    avisos.push('A alteração do rateio vale a partir do ciclo de faturamento seguinte.');
  }
  return { soma, bloqueios, avisos };
}

export function analisarConsumo(v: Valores, proposta: GeracaoDaProposta | null): AnaliseConsumo {
  const contas: ContaKwh[] = [];
  const geradora = paraNumero(cheio(v.consumo_medio_kwh));
  if (geradora !== null) contas.push({ unidade: 'geradora', kwh: geradora });
  const conta = contas.length ? contas.reduce((s, c) => s + c.kwh, 0) : null;
  // `consumoKwh` da proposta é o CONSUMO informado no dimensionamento, nunca a geração: só aparece à parte, para a tela mostrar junto.
  const consumoNaProposta = paraNumero(proposta?.consumoKwh);
  const vazio = (razao: string): AnaliseConsumo => ({
    conta_kwh: conta, contas_kwh: contas, base: null, proposta_kwh: null, proposta_consumo_kwh: consumoNaProposta, razao, aviso: null,
  });

  if (!proposta) return vazio('Não há proposta ligada a esta venda para comparar o consumo.');
  const media = paraNumero(proposta.mediaMensalGerada);
  const doArray = mediaDoArrayMensal(proposta.mensalKwh);
  const anual = paraNumero(proposta.geracaoAnualKwh);
  const base: BaseConsumo | null = media !== null ? 'proposta_media_gerada' : doArray !== null ? 'proposta_mensal_12' : anual !== null ? 'proposta_anual_12' : null;
  const geracao = media ?? doArray ?? (anual !== null ? anual / 12 : null);
  if (base === null || geracao === null) return vazio('A proposta ligada não tem a geração mensal.');
  if (conta === null) {
    return { conta_kwh: null, contas_kwh: [], base, proposta_kwh: geracao, proposta_consumo_kwh: consumoNaProposta, razao: 'O consumo médio da conta da geradora ainda não foi preenchido.', aviso: null };
  }

  // O cadastro só guarda o consumo da geradora: o das beneficiárias não entra na soma.
  const temBeneficiarias = beneficiariasEmUso(v).length > 0;
  const razao = `Compara a geração mensal da proposta (${base === 'proposta_media_gerada' ? 'média gerada' : base === 'proposta_mensal_12' ? 'média dos 12 meses' : 'geração anual dividida por 12'}) com o consumo da conta da geradora`
    + (temBeneficiarias ? '. O cadastro não tem o consumo das beneficiárias, então só a geradora entra na soma.' : '.');
  const razaoFator = geracao / conta;
  const fora = razaoFator < FAIXA_MIN || razaoFator > FAIXA_MAX;
  return {
    conta_kwh: conta, contas_kwh: contas, base, proposta_kwh: geracao, proposta_consumo_kwh: consumoNaProposta, razao,
    aviso: fora ? `O sistema da proposta gera ${fmtKwh(geracao)} e a conta mostra ${fmtKwh(conta)} de consumo. Confira o dimensionamento.` : null,
  };
}

/** As duas conferências da venda solar. `proposta` null = nada ligado (ou o vínculo não vale). */
export function analisarSolar(v: Valores, proposta: GeracaoDaProposta | null): AnaliseSolar {
  return { rateio: analisarRateio(v), consumo: analisarConsumo(v, proposta) };
}
