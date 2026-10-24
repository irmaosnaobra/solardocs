// ─────────────────────────────────────────────────────────────────────────────
// O QUIZ SOLAR NO SERVIDOR (07/10/2026)
//
// A página /io/solar pergunta; quem decide o caminho e monta a vitrine é este
// arquivo. No eletroposto a vitrine é calculada no navegador e o servidor
// revalida no clique, e isso já deu três desencontros caros (a faixa dos 15
// minutos, o dono que não é sócio, a bandeira `ep` jogada fora no map). Aqui a
// página só desenha o que o servidor devolve: não existe vitrine vendendo o que
// a gravação recusa, porque as duas são a mesma conta.
//
// Funções puras (recebem a ocupação já lida). A rota lê o banco e chama.
// ─────────────────────────────────────────────────────────────────────────────

import {
  decidirCaminho, reservaDe, horariosDoCaminho, blocoDoCompromisso, ocupacaoDaFichaSolar,
  rotuloDaFaixa, MARCA_QUIZ, RAIO_VISITA_KM, BASE_DO_SOCIO, socioMaisPerto, caminhoDaFicha, semTreino, LIMITE_TREINO_DIAS,
  FAIXAS_CONTA, kwhDaFaixa, DONA_SOLAR, LIGACAO_MIN,
  type Caminho, type Decisao, type FichaAgenda,
} from '../agenda/solarRota';
import { geracaoMensal } from '../propostaSolarData';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { agendaFechadaEm, ehSocio } from '../agenda/agendaFechada';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

/** Dois dias na vitrine, como no eletroposto desde 30/09: horário longe dá mais
 *  tempo pro lead esfriar, e reunião marcada que não acontece custa mais que a
 *  não marcada, porque ainda queima o horário de quem atende. */
export const DIAS_NA_VITRINE = 2;
/** Quantos dias para frente a vitrine procura os dois com vaga. */
export const DIAS_VARRIDOS = 14;
/** Antecedência mínima. A visita pede mais: o sócio precisa sair da base. */
export const ANTECEDENCIA_MIN: Record<Caminho, number> = { vistoria: 180, video: 60, ligacao: 30, curioso: 0 };

export const ROTULO_CAMINHO: Record<Caminho, string> = {
  vistoria: 'VISTORIA PRESENCIAL', video: 'ATENDIMENTO ONLINE', ligacao: 'LIGAÇÃO', curioso: 'CURIOSO',
};

// ── As respostas ────────────────────────────────────────────────────────────
export const OPCOES = {
  tipo: { casa: 'Casa', empresa: 'Comércio ou empresa', rural: 'Rural' },
  imovel: { proprio: 'Próprio', alugado: 'Alugado', construcao: 'Em construção' },
  urgencia: { ja: 'O quanto antes, este mês', '3meses': 'Nos próximos 3 meses', pesquisando: 'Ainda pesquisando preços' },
  concorrente: { sim: 'Sim, quer comparar', nao: 'Não, é o primeiro' },
  pagamento: { vista: 'À vista', financiamento: 'Financiamento', cartao: 'Cartão em até 21x', naosei: 'Ainda não sabe' },
  decisor: { eu: 'Decide sozinho', junto: 'Decide com mais alguém', outro: 'Outra pessoa decide' },
  grupoa: { sim: 'Sim', nao: 'Não', naosei: 'Não sabe' },
} as const;
type Campo = keyof typeof OPCOES;

export interface Respostas {
  conta: string | null;
  cidade: string;
  tipo: string | null; imovel: string | null; urgencia: string | null; concorrente: string | null;
  pagamento: string | null; decisor: string | null; grupoa: string | null;
}

/** Só passa o que a página pode mandar. Texto livre só na cidade, cortado. */
export function limparRespostas(raw: unknown): Respostas {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pega = (campo: Campo): string | null => {
    const v = String(r[campo] ?? '');
    return Object.prototype.hasOwnProperty.call(OPCOES[campo], v) ? v : null;
  };
  return {
    conta: rotuloDaFaixa(r.conta) ? String(r.conta) : null,
    cidade: String(r.cidade ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    tipo: pega('tipo'), imovel: pega('imovel'), urgencia: pega('urgencia'), concorrente: pega('concorrente'),
    pagamento: pega('pagamento'), decisor: pega('decisor'), grupoa: pega('grupoa'),
  };
}

const rot = (campo: Campo, v: string | null): string | null =>
  v ? (OPCOES[campo] as Record<string, string>)[v] ?? null : null;

// ── As respostas NOVAS do quiz de 24/10/2026 ────────────────────────────────
// Ficam num parser à parte (e não dentro de `Respostas`) de propósito: elas NÃO entram na nota, e quem
// compara o formato antigo (testes, painel, a Duda) continua lendo o mesmo objeto de sempre.
export const OPCOES_EXTRA = {
  telhado: { ceramica: 'Cerâmica', fibrocimento: 'Fibrocimento', metalico: 'Metálico', laje: 'Laje', solo: 'No chão' },
  sombra: { sol: 'Sol o dia todo', alguma: 'Alguma sombra', naosei: 'Não sabe' },
  aumento: { clima: 'Ar-condicionado ou piscina', carro: 'Carro elétrico', maquinas: 'Máquinas, irrigação ou ampliação', nao: 'Não' },
  dor: {
    sobe: 'A conta sobe todo ano', bandeira: 'Bandeira vermelha de surpresa', evito: 'Evita ligar o ar-condicionado',
    sobra: 'Sobra pouco no mês', margem: 'Come a margem do negócio', planejar: 'Não consegue planejar o custo',
  },
  tempo: { agora: 'Começou a pensar agora', meses: 'Há alguns meses', ano: 'Há mais de 1 ano' },
  travou: { caro: 'Achou caro', valia: 'Não sabia se valia a pena', confianca: 'Não confiou nas empresas', tempo: 'Faltou tempo' },
  desejo: {
    contas: 'Pagar outras contas', guardar: 'Guardar ou investir', reformar: 'Reformar a casa',
    conforto: 'Usar o ar-condicionado sem culpa', viajar: 'Viajar com a família', negocio: 'Investir no negócio',
    producao: 'Investir na produção', lucro: 'Aumentar o lucro',
  },
  criterio: { parcela: 'Parcela que caiba no bolso', garantia: 'Garantia e segurança', rapidez: 'Instalar rápido', regiao: 'Empresa da região' },
} as const;
export type CampoExtra = keyof typeof OPCOES_EXTRA;
export type RespostasExtra = Record<CampoExtra, string | null>;

/** Só passa o código que a página pode mandar. `travou` só existe se `tempo` não for "agora" (a pergunta nem aparece). */
export function limparRespostasExtra(raw: unknown): RespostasExtra {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pega = (campo: CampoExtra): string | null => {
    const v = String(r[campo] ?? '');
    return Object.prototype.hasOwnProperty.call(OPCOES_EXTRA[campo], v) ? v : null;
  };
  const out = {} as RespostasExtra;
  for (const k of Object.keys(OPCOES_EXTRA) as CampoExtra[]) out[k] = pega(k);
  if (out.tempo === 'agora') out.travou = null;
  return out;
}

const rotExtra = (campo: CampoExtra, v: string | null | undefined): string | null =>
  v ? (OPCOES_EXTRA[campo] as Record<string, string>)[v] ?? null : null;
export { rotExtra, rot as rotuloDaResposta };

// ── O diagnóstico (sem preço) ───────────────────────────────────────────────
// De onde sai cada número:
//  · conta_mes e kwh_mes: a MESMA régua da ficha e da nota (FAIXAS_CONTA.reais e TARIFA_KWH de leadSolarFicha, R$ 1,05),
//    para a Nilce ler o mesmo consumo que o cliente viu;
//  · geração por kWp: a do Gerador/SolarDoc (propostaSolarData.geracaoMensal: HSP da cidade ou do estado, CRESESB,
//    eficiência de 80% do sistema), média dos 12 meses;
//  · PREMISSAS NOVAS (não existiam no Gerador em forma reutilizável): placa de 610 W, 2,7 m² por placa, mínimo de 4 placas,
//    folga de 20% quando o consumo vai aumentar, e a conta que fica depois (R$ 99, valor fixo do dono).
export const PLACA_KWP = 0.61;
export const AREA_POR_PLACA_M2 = 2.7;
export const MIN_PLACAS = 4;
export const FOLGA_AUMENTO = 1.2;
/** A conta que fica depois da energia solar (taxa mínima). Valor fixo do dono. */
export const CONTA_DEPOIS_REAIS = 99;

export interface Diagnostico {
  conta_mes: number; kwh_mes: number; placas: number; kwp: number; area_m2: number; geracao_kwh_mes: number;
  /** null no Grupo A: a demanda contratada continua sendo cobrada. */
  conta_depois: number | null;
  /** null no Grupo A: a conta "menos R$ 99" exagera para quem paga demanda. */
  economia_mes: number | null; economia_ano: number | null; ano: number; cinco_anos: number;
}

/** "Uberlândia-MG" → { nome: 'Uberlândia', uf: 'MG' }. Sem UF, só o nome. */
export function nomeEUfDaCidade(txt: unknown): { nome: string; uf: string } {
  const t = String(txt ?? '').trim();
  const m = t.match(/^(.*?)\s*[-/,]\s*([A-Za-z]{2})$/);
  return m ? { nome: m[1].trim(), uf: m[2].toUpperCase() } : { nome: t, uf: '' };
}

/** kWh por mês que 1 kWp gera na cidade: a média dos 12 meses do Gerador. */
export function geracaoPorKwpMes(cidade: unknown): number {
  const { nome, uf } = nomeEUfDaCidade(cidade);
  const mensal = geracaoMensal(100, uf, nome);
  return mensal.reduce((a, b) => a + b, 0) / mensal.length / 100;
}

export function calcularDiagnostico(resp: Pick<Respostas, 'conta' | 'cidade' | 'grupoa'>, extra?: Partial<RespostasExtra> | null): Diagnostico | null {
  const faixa = FAIXAS_CONTA.find(f => f.v === resp.conta);
  const kwh = kwhDaFaixa(resp.conta);
  if (!faixa || kwh === null) return null;
  const conta = faixa.reais;
  const porKwp = geracaoPorKwpMes(resp.cidade);
  const alvo = kwh * (extra?.aumento && extra.aumento !== 'nao' ? FOLGA_AUMENTO : 1);
  const placas = Math.max(MIN_PLACAS, Math.ceil(alvo / (porKwp * PLACA_KWP)));
  const kwp = Math.round(placas * PLACA_KWP * 100) / 100;
  const depois = Math.min(conta, CONTA_DEPOIS_REAIS);
  const economia = Math.max(0, conta - depois);
  const grupoA = resp.grupoa === 'sim';
  return {
    conta_mes: conta, kwh_mes: kwh, placas, kwp, area_m2: Math.round(placas * AREA_POR_PLACA_M2),
    geracao_kwh_mes: Math.round(kwp * porKwp),
    conta_depois: grupoA ? null : depois,
    economia_mes: grupoA ? null : economia, economia_ano: grupoA ? null : economia * 12, ano: conta * 12, cinco_anos: conta * 60,
  };
}

// ── A ocupação ──────────────────────────────────────────────────────────────
export interface Ocupacao { dono: string; ini: number; fim: number }

const MIN = 60_000;
/** O bloco de uma ficha que já está na agenda, de qualquer origem. As do solar
 *  vêm da régua única; reunião de eletroposto vale 30 min (15 na faixa de
 *  remarcação :15/:45); o resto é ligação ou card de 15 min. */
export function blocoDaFicha(a: FichaAgenda): { ini: number; fim: number } | null {
  if (!a.quando) return null;
  const solar = ocupacaoDaFichaSolar(a);
  if (solar) return solar;
  const t = new Date(String(a.quando)).getTime();
  if (Number.isNaN(t)) return null;
  if (ehOrigemEletroposto(a.created_by)) {
    const m = new Date(t).getUTCMinutes();
    return { ini: t, fim: t + ((m === 15 || m === 45) ? 15 : 30) * MIN };
  }
  return { ini: t, fim: t + 15 * MIN };
}

// ── Dias e horários ─────────────────────────────────────────────────────────
const BRT = 'America/Sao_Paulo';
export const ymdBRT = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export const msDe = (ymd: string, hhmm: string): number => new Date(`${ymd}T${hhmm}:00-03:00`).getTime();
const diaDaSemana = (ymd: string): number => new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
const somaDias = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00-03:00`); d.setUTCDate(d.getUTCDate() + n); return ymdBRT(d.getTime());
};
export const diaUtil = (ymd: string): boolean => {
  const w = diaDaSemana(ymd);
  return w !== 0 && w !== 6 && !ehFeriadoBR(ymd);
};

// ── A grade e o horário do quiz de 24/10/2026 ───────────────────────────────
// Só a Nilce atende solar. A vitrine do quiz tem a grade PRÓPRIA abaixo (segunda a sexta 07:00 às 17:30, sábado
// 07:00 às 11:30, de 30 em 30 min); GRADE_NOVO_LIGACAO e GRADE_FOLLOWUP_LIGACAO (solarRota.ts) ficam como estão,
// porque o formulário do Meta, o ManyChat e o robô de follow-up leem delas. O "agora" (atendimento direto) vale
// segunda a sexta das 07:00 às 18:00 e sábado das 07:00 às 12:00, horário de Brasília.
export interface OpcoesGrade { grade?: 'quiz' }

const gradeDe = (iniMin: number, fimMin: number): readonly string[] => {
  const out: string[] = [];
  for (let t = iniMin; t <= fimMin; t += 30) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  return Object.freeze(out);
};
export const GRADE_QUIZ_SEMANA = gradeDe(7 * 60, 17 * 60 + 30);
export const GRADE_QUIZ_SABADO = gradeDe(7 * 60, 11 * 60 + 30);
/** Antecedência mínima de um horário escolhido na vitrine do quiz. */
export const ANTECEDENCIA_QUIZ_MIN = 30;
/** Dia em que a Nilce atende pelo quiz: de segunda a sábado, fora de feriado nacional. */
export const diaDoQuiz = (ymd: string): boolean => diaDaSemana(ymd) !== 0 && !ehFeriadoBR(ymd);
export const horariosDoQuiz = (ymd: string): readonly string[] =>
  !diaDoQuiz(ymd) ? [] : diaDaSemana(ymd) === 6 ? GRADE_QUIZ_SABADO : GRADE_QUIZ_SEMANA;

/** Fim do atendimento direto, em minutos desde a meia-noite de Brasília. */
const AGORA_ABRE_MIN = 7 * 60;
const AGORA_FECHA_MIN = { semana: 18 * 60, sabado: 12 * 60 };

/** O botão "falar com um especialista agora" vale neste instante? Domingo e feriado nacional, não. */
export function horarioAgoraAberto(ms: number): boolean {
  if (!Number.isFinite(ms)) return false;
  const ymd = ymdBRT(ms);
  const w = diaDaSemana(ymd);
  if (w === 0 || ehFeriadoBR(ymd)) return false;
  const b = new Date(ms - 3 * 3_600_000);
  const min = b.getUTCHours() * 60 + b.getUTCMinutes();
  return min >= AGORA_ABRE_MIN && min < (w === 6 ? AGORA_FECHA_MIN.sabado : AGORA_FECHA_MIN.semana);
}

/** O instante da ligação do "agora": o próximo múltiplo de 5 min que esteja PELO MENOS 5 min à frente. `encaixe`
 *  soma 5 min por vez (o minuto estava ocupado: o índice único (vendedor, quando) recusou). */
export const PASSO_AGORA_MS = 5 * MIN;
export function quandoDoAgora(agoraMs: number, encaixe = 0): number {
  return Math.ceil((agoraMs + PASSO_AGORA_MS) / PASSO_AGORA_MS) * PASSO_AGORA_MS + encaixe * PASSO_AGORA_MS;
}

/** O horário cabe para esta pessoa, neste caminho? Mesma pergunta na vitrine e
 *  na gravação. Com `{ grade: 'quiz' }` vale a grade nova do quiz (ligação da Nilce). */
export function cabe(caminho: Caminho, ymd: string, hhmm: string, pessoa: string, dec: Decisao,
  ocupacoes: readonly Ocupacao[], agoraMs: number, opt?: OpcoesGrade): boolean {
  if (opt?.grade === 'quiz') {
    if (!horariosDoQuiz(ymd).includes(hhmm)) return false;
    const t = msDe(ymd, hhmm);
    if (t < agoraMs + ANTECEDENCIA_QUIZ_MIN * MIN) return false;
    const fim = t + LIGACAO_MIN * MIN;
    return !ocupacoes.some(o => o.dono === pessoa && o.ini < fim && t < o.fim);
  }
  if (!diaUtil(ymd)) return false;
  if (ehSocio(pessoa) && agendaFechadaEm(ymd)) return false;
  if (!horariosDoCaminho(caminho, ymd, pessoa, dec.cidade).includes(hhmm)) return false;
  const t = msDe(ymd, hhmm);
  const bloco = blocoDoCompromisso(caminho, t, pessoa, dec.cidade);
  // A antecedência conta do horário marcado; e a saída da base não pode ter passado.
  if (t < agoraMs + ANTECEDENCIA_MIN[caminho] * MIN) return false;
  if (bloco.ini < agoraMs) return false;
  return !ocupacoes.some(o => o.dono === pessoa && o.ini < bloco.fim && bloco.ini < o.fim);
}

export interface DiaVitrine { ymd: string; horas: Array<{ h: string; dono: string }> }

/** Os dois próximos dias com vaga. Cada horário fica com o primeiro candidato
 *  que cabe nele, na ordem da decisão (sócio mais perto, depois o outro). */
export function montarVitrine(dec: Decisao, ocupacoes: readonly Ocupacao[], agoraMs: number, opt?: OpcoesGrade): DiaVitrine[] {
  const out: DiaVitrine[] = [];
  const quiz = opt?.grade === 'quiz';
  let ymd = ymdBRT(agoraMs);
  for (let i = 0; i < DIAS_VARRIDOS && out.length < DIAS_NA_VITRINE; i++, ymd = somaDias(ymd, 1)) {
    if (quiz ? !diaDoQuiz(ymd) : !diaUtil(ymd)) continue;
    const porHora = new Map<string, string>();
    for (const pessoa of dec.candidatos) {
      for (const h of quiz ? horariosDoQuiz(ymd) : horariosDoCaminho(dec.caminho, ymd, pessoa, dec.cidade)) {
        if (porHora.has(h)) continue;
        if (cabe(dec.caminho, ymd, h, pessoa, dec, ocupacoes, agoraMs, opt)) porHora.set(h, pessoa);
      }
    }
    if (porHora.size) {
      out.push({ ymd, horas: [...porHora.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([h, dono]) => ({ h, dono })) });
    }
  }
  return out;
}

/** Decide e monta a vitrine. Sem horário no caminho, desce a escada de
 *  reservas (reservaDe em solarRota.ts): visita, atendimento do Thiago,
 *  ligação da Nilce. Curioso não tem vitrine. */
export function decidirEMontar(resp: Respostas, dono: string | null, ocupacoes: readonly Ocupacao[], agoraMs: number, chave?: string | null,
  opt?: OpcoesGrade): { dec: Decisao; dias: DiaVitrine[]; semHorario: boolean } {
  if (opt?.grade === 'quiz') {
    // Quiz de 24/10/2026: só a Nilce atende, por ligação, na grade do quiz. Cliente que era de sócio vira cliente da
    // Nilce. O CURIOSO (abaixo de 40 pontos) também escolhe horário: o caminho dele continua 'curioso' (sem botão
    // "agora", sem LeadQuente), mas a vitrine sai igual à dos outros.
    const d = decidirCaminho(resp, dono === DONA_SOLAR ? dono : null, chave);
    const dias = montarVitrine({ ...d, caminho: 'ligacao', candidatos: [DONA_SOLAR] }, ocupacoes, agoraMs, opt);
    return { dec: d, dias, semHorario: dias.length === 0 };
  }
  const dec = decidirCaminho(resp, dono, chave);
  if (dec.caminho === 'curioso') return { dec, dias: [], semHorario: false };
  let atual: Decisao | null = dec;
  let primeira = true;
  while (atual) {
    const dias = montarVitrine(atual, ocupacoes, agoraMs);
    // Treino da Giovanna (09/10): só é a vez dela se ela tiver horário logo.
    if (atual.treino && (!dias.length || msDe(dias[0].ymd, dias[0].horas[0].h) - agoraMs > LIMITE_TREINO_DIAS * 86_400_000)) {
      atual = semTreino(atual);
      continue;
    }
    if (dias.length) return { dec: atual, dias, semHorario: !primeira };
    atual = reservaDe(atual);
    primeira = false;
  }
  return { dec, dias: [], semHorario: true };
}

const NOME_PESO: Record<string, string> = { urgencia: 'prazo', decisor: 'decisor', pagamento: 'pagamento', imovel: 'imóvel', concorrente: 'orçamento' };

// ── O que fica escrito ──────────────────────────────────────────────────────
export interface Endereco { cep?: string; rua?: string; numero?: string; bairro?: string }

export function limparEndereco(raw: unknown): Endereco | null {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = { cep: s(e.cep, 9), rua: s(e.rua, 120), numero: s(e.numero, 20), bairro: s(e.bairro, 80) };
  return out.cep || out.rua || out.numero ? out : null;
}

/** A ficha do card. Primeira linha é a marca + o caminho: é por ela que as três
 *  agendas sabem quanto a visita ocupa (caminhoDaFicha). */
/** O que o quiz de 24/10/2026 acrescenta à ficha. Tudo opcional: sem isto a ficha sai idêntica à de antes. */
export interface ExtraDaFicha {
  respostas?: RespostasExtra | null;
  diag?: Diagnostico | null;
  /** O card do clique "agora": a 1ª linha é exatamente `LP SOLAR QUIZ · AGORA`. */
  agora?: boolean;
}

export const brl0 = (v: number): string => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;

/** A linha do diagnóstico da ficha e dos avisos. Grupo A (economia null): sem economia, com o aviso de conferir a demanda. */
export function linhaDoDiagnostico(d: Diagnostico): string {
  const base = `${d.placas} placas, ${d.kwp.toLocaleString('pt-BR')} kWp`;
  return d.economia_mes === null ? `${base} · Grupo A: conferir a demanda` : `${base}, economia de cerca de ${brl0(d.economia_mes)} por mês`;
}

/** As linhas das respostas novas e do diagnóstico, só as que existem. A ordem é a da ficha do aviso. */
export function linhasDoQuizNovo(x: ExtraDaFicha | undefined): string[] {
  const L: string[] = [];
  const r = x?.respostas;
  const add = (rotulo: string, campo: CampoExtra) => { const t = rotExtra(campo, r?.[campo]); if (t) L.push(`${rotulo}: ${t}`); };
  if (r) {
    add('Telhado', 'telhado'); add('Sombra', 'sombra'); add('Vai aumentar', 'aumento'); add('Dor', 'dor');
    add('Pensa em solar', 'tempo'); add('Travou', 'travou'); add('Desejo', 'desejo'); add('Mais importante', 'criterio');
  }
  const d = x?.diag;
  if (d) L.push(`Diagnóstico: ${linhaDoDiagnostico(d)}`);
  return L;
}

export function montarObservacao(resp: Respostas, dec: Decisao, end: Endereco | null, semHorario = false, x?: ExtraDaFicha): string {
  const L: string[] = [];
  if (x?.agora) {
    L.push(`${MARCA_QUIZ} · AGORA`);
    L.push(`Onde: ${rot('tipo', resp.tipo) ?? 'Imóvel'}`);
  } else {
    L.push(`${MARCA_QUIZ} · ${rot('tipo', resp.tipo) ?? 'Imóvel'} · ${ROTULO_CAMINHO[dec.caminho]}`);
  }
  const faixa = rotuloDaFaixa(resp.conta);
  if (faixa) L.push(`Conta de luz: ${faixa}${dec.kwh ? ` (~${dec.kwh.toLocaleString('pt-BR')} kWh/mês)` : ''}`);
  L.push(`Pontuação: ${dec.pontos}/100 (${dec.pontuacao.partes.map(p => `${NOME_PESO[p.campo]} ${p.pts}/${p.max}`).join(', ')})`);
  if (dec.cidade) {
    const c = dec.cidade;
    // Distância de Uberlândia: é de lá que o Diego sai para todas as visitas.
    const km = c.kmUdi;
    L.push(`Cidade: ${c.nome}-${c.uf}${km ? ` · ${km} km de Uberlândia pela estrada` : ''}`);
  } else if (resp.cidade) {
    L.push(`Cidade: ${resp.cidade} · FORA DO RAIO DE ${RAIO_VISITA_KM} KM`);
  }
  const linha = (rotulo: string, campo: Campo, v: string | null) => { const t = rot(campo, v); if (t) L.push(`${rotulo}: ${t}`); };
  linha('Imóvel', 'imovel', resp.imovel);
  linha('Quando quer', 'urgencia', resp.urgencia);
  linha('Já tem orçamento', 'concorrente', resp.concorrente);
  linha('Pagamento', 'pagamento', resp.pagamento);
  const dec2 = rot('decisor', resp.decisor);
  if (dec2) L.push(`Decisor: ${dec2}${resp.decisor === 'junto' && dec.caminho === 'vistoria' ? ' (pedimos os dois na visita)' : ''}`);
  const ga = rot('grupoa', resp.grupoa);
  if (ga) L.push(`Demanda contratada: ${ga}${resp.grupoa === 'sim' ? ' · GRUPO A' : ''}`);
  if (dec.qualifica) {
    const oque = dec.qualifica === 'vistoria' ? 'VISITA DO DIEGO' : 'ATENDIMENTO DO THIAGO';
    L.push(semHorario ? `SEM HORÁRIO DE ${oque}: marcar no atendimento` : `QUALIFICA PARA ${oque}: chamar quem faz no atendimento`);
  }
  if (end && dec.caminho === 'vistoria') {
    const partes = [[end.rua, end.numero].filter(Boolean).join(', '), end.bairro, dec.cidade?.nome, end.cep ? `CEP ${end.cep}` : '']
      .filter(Boolean);
    if (partes.length) L.push(`Endereço: ${partes.join(' · ')}`);
  }
  L.push(...linhasDoQuizNovo(x));
  L.push(`Por que este caminho: ${dec.motivo}`);
  return L.join('\n');
}

/** As respostas no formato do `leads_meta.field_data`, o mesmo do formulário do
 *  Meta. A tela Leads do Gerador acha as colunas pelo nome (consum, urg,
 *  pagamento, decide), então os nomes aqui seguem essas palavras. */
export function camposDoLead(resp: Respostas, dec: Decisao, extra: { semHorario?: boolean } & ExtraDaFicha = {}): Array<{ name: string; values: string[] }> {
  const f: Array<{ name: string; values: string[] }> = [];
  const add = (name: string, v: string | null | undefined) => { if (v) f.push({ name, values: [v] }); };
  add('Origem', 'Quiz Solar');
  add('Caminho', dec.caminho);
  add('Pontos', String(dec.pontos));
  add('Consumo', rotuloDaFaixa(resp.conta) ? `${rotuloDaFaixa(resp.conta)}${dec.kwh ? ` (~${dec.kwh} kWh)` : ''}` : null);
  add('Onde', rot('tipo', resp.tipo));
  add('Imóvel', rot('imovel', resp.imovel));
  add('Urgência', rot('urgencia', resp.urgencia));
  add('Já tem orçamento', rot('concorrente', resp.concorrente));
  add('Pagamento', rot('pagamento', resp.pagamento));
  add('Quem decide', rot('decisor', resp.decisor));
  add('Demanda contratada', rot('grupoa', resp.grupoa));
  // De Uberlândia, como na ficha: é de lá que o Diego sai para toda visita (08/10).
  add('Raio', dec.cidade ? `${dec.cidade.kmUdi} km` : (resp.cidade ? 'fora do raio' : null));
  if (dec.qualifica) add('Qualifica', dec.qualifica);
  if (extra.semHorario) add('Sem horário', 'sim');
  // Quiz de 24/10/2026: as respostas novas e o diagnóstico (nomes que NÃO casam com as colunas consum, urg, pagamento e decide da tela Leads).
  const r = extra.respostas;
  const addX = (nome: string, campo: CampoExtra) => add(nome, rotExtra(campo, r?.[campo]));
  if (r) {
    addX('Telhado', 'telhado'); addX('Sombra', 'sombra'); addX('Vai aumentar', 'aumento'); addX('Dor', 'dor');
    addX('Pensa em solar', 'tempo'); addX('Travou', 'travou'); addX('Desejo', 'desejo'); addX('Mais importante', 'criterio');
  }
  if (extra.diag) add('Diagnóstico', linhaDoDiagnostico(extra.diag));
  // O que fez a nota ser a nota (08/10): quanto cada resposta valeu, no fim, para
  // a planilha do Leads Solar mostrar ao lado das respostas. Ficam por último de
  // propósito: quem procura "Pagamento" acha a resposta antes dos pontos dela.
  for (const p of dec.pontuacao.partes) add(`Pontos do ${NOME_PESO[p.campo]}`, `${p.pts}/${p.max}`);
  return f;
}

// ── O aviso no celular de quem atende (08/10/2026) ──────────────────────────
// Sai pelo 5040 para o dono do card, na hora em que o cliente marca. Lê a mesma
// ficha que a agenda mostra (montarObservacao), então o que chega no celular é o
// que está no card. Pedido do Thiago: "mais completo, com emoji principal pela
// nota". Faixas: 🟢 de 90 a 100, 🟡 de 60 a 89, 🔴 abaixo de 60 (ele passou
// "100 a 90, 80 a 60, 50 a 0"; o que ficou entre as faixas cai na de baixo).
// Emoji só na primeira linha (regra de 24/09) e nada de travessão. A nota vem no
// fim, do critério de menor peso ao de maior, como na planilha do Leads Solar.
export const emojiDaNota = (n: number): string => (n >= 90 ? '🟢' : n >= 60 ? '🟡' : '🔴');

export const FONTE_DO_ANUNCIO: Record<string, string> = { ig: 'Instagram', fb: 'Facebook', an: 'Audience Network', th: 'Threads', msg: 'Messenger' };
/** [nome na linha "Pontuação", rótulo no aviso, linha da ficha], do menor peso ao maior. */
const CRITERIOS_DA_NOTA: ReadonlyArray<[string, string, string]> = [
  ['orçamento', 'Já tem orçamento', 'Já tem orçamento:'],
  ['imóvel', 'Imóvel', 'Imóvel:'],
  ['pagamento', 'Pagamento', 'Pagamento:'],
  ['decisor', 'Quem decide', 'Decisor:'],
  ['prazo', 'Prazo', 'Quando quer:'],
];

export interface FichaDoAviso {
  observacao?: unknown; quando?: unknown; vendedor_nome?: unknown; cliente_nome?: unknown; cliente_telefone?: unknown;
  utm_source?: unknown; utm_campaign?: unknown;
}

export function avisoDaEquipe(a: FichaDoAviso): string {
  const linhas = String(a.observacao || '').split('\n');
  const val = (rot: string) => linhas.find(l => l.startsWith(rot))?.slice(rot.length).trim() || '';
  const caminho = caminhoDaFicha(a.observacao) || 'ligacao';
  const tipo = (linhas[0] || '').split(' · ')[1] || '';
  // "94/100 (prazo 35/35, decisor 14/20, pagamento 20/20, imóvel 15/15, orçamento 10/10)"
  const pontuacao = val('Pontuação:');
  const m = pontuacao.match(/^(\d+)\/100/);
  const nota = m ? Number(m[1]) : null;
  const partes = new Map<string, string>();
  for (const p of pontuacao.matchAll(/(\p{L}+) (\d+)\/(\d+)/gu)) partes.set(p[1].toLowerCase(), `${p[2]} de ${p[3]}`);

  const quando = new Date(String(a.quando)).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const titulo = { vistoria: 'NOVA VISITA', video: 'NOVO ATENDIMENTO ONLINE', ligacao: 'NOVA LIGAÇÃO', curioso: 'NOVO CURIOSO' }[caminho];
  const out = [
    nota === null ? `☀️ *${titulo}, ENERGIA SOLAR*` : `${emojiDaNota(nota)} *NOTA ${nota} · ${titulo}, ENERGIA SOLAR*`,
    'Veio do quiz da /io/solar.',
    '',
    `*Quando:* ${quando}`,
    `*Com:* ${a.vendedor_nome || ''}`,
    `*Cliente:* ${a.cliente_nome || ''}`,
    `*WhatsApp:* wa.me/${String(a.cliente_telefone || '').replace(/\D/g, '')}`,
    '',
  ];
  const campo = (rot: string, v: string) => { if (v) out.push(`*${rot}:* ${v}`); };
  campo('Onde', tipo);
  const cidade = val('Cidade:');
  campo('Cidade', cidade);
  const endereco = val('Endereço:');
  campo('Endereço', endereco);
  if (endereco) {
    const busca = `${endereco.replace(/ · CEP /, ', ').replace(/ · /g, ', ')}, ${cidade.split(' · ')[0]}`;
    campo('Mapa', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
  }
  campo('Conta', val('Conta de luz:'));
  campo('Demanda contratada', val('Demanda contratada:'));
  // Quiz de 24/10/2026: as respostas novas e o diagnóstico, só as que a ficha tem (a ficha antiga não tem nenhuma).
  for (const rotulo of ['Telhado', 'Sombra', 'Vai aumentar', 'Dor', 'Pensa em solar', 'Travou', 'Desejo', 'Mais importante', 'Diagnóstico']) {
    campo(rotulo, val(`${rotulo}:`));
  }
  const fonte = String(a.utm_source || '').trim();
  const campanha = String(a.utm_campaign || '').trim();
  campo('Origem', fonte || campanha
    ? [FONTE_DO_ANUNCIO[fonte.toLowerCase()] || fonte, campanha ? `campanha ${campanha}` : ''].filter(Boolean).join(', ')
    : 'sem anúncio (link direto)');
  campo('Por que este caminho', val('Por que este caminho:'));

  if (nota !== null) {
    out.push('', '*A NOTA, DO MENOR PESO AO MAIOR*');
    for (const [nome, rotulo, linhaDaFicha] of CRITERIOS_DA_NOTA) {
      out.push(`${rotulo}: ${val(linhaDaFicha) || 'não respondeu'} (${partes.get(nome) || 'sem ponto'})`);
    }
    out.push(`*Nota: ${nota} de 100*`);
  }
  const marca = linhas.find(l => /^(QUALIFICA PARA|SEM HORÁRIO DE)/.test(l));
  if (marca) out.push('', `*${marca}*`);
  out.push('', '_Logo em seguida a Duda manda a mensagem para o cliente com o seu nome e o horário, e responde o básico no 5040. O que for com você, ela te passa aqui._');
  out.push('_Veja no CRM: solardoc.app/gerador_');
  return out.join('\n');
}
