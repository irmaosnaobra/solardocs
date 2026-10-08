// ─────────────────────────────────────────────────────────────────────────────
// A RÉGUA DO QUIZ SOLAR (07/10/2026)
//
// Pedido do Thiago: o quiz do eletroposto aplicado ao solar, com vistoria
// presencial para projeto acima de 1.000 kWh até 150 km. Ordem do mesmo dia,
// depois de ver o desenho: "de início todas as presenciais serão acima de
// 1.000 kWh, depois vamos ver como vai ficar". Por isso Uberlândia, que no
// desenho tinha vistoria em qualquer conta, começa na regra geral e a lista
// CIDADES_VISITA_SEMPRE nasce vazia.
//
// REGRAS DE 08/10/2026 (ordem do Thiago, substitui a do dia 07):
//   "Até 300 kWh para Giovanna; de 300 a 1.000 Nilce; visitas todas acima de
//    1.000 com Diego; atendimentos acima de 1.000 sem visita Thiago." E: "temos
//    que selecionar todos por ponto de 0 a 100 conforme as respostas, e a visita
//    presencial será para acima de 90 pontos; queremos que chegue apenas quem
//    realmente quer fechar negócio; a lista de curiosos e demais vai sendo
//    separada para um futuro atendimento."
//
// Cinco caminhos, decididos ANTES da agenda pela pontuação, pela conta e pela
// cidade:
//   · curioso    abaixo de 40 pontos: sem agenda, vai para a lista
//   · vistoria   acima de 1.000 kWh, acima de 90 pontos e até 150 km de
//                estrada de Uberlândia: visita do Diego
//   · video      acima de 1.000 kWh sem visita: atendimento do Thiago
//   · ligacao    300 a 1.000 kWh com a Nilce; até 300 kWh com a Giovanna
//   (integrador sai da página antes de chegar aqui e nunca agenda)
//
// A PONTUAÇÃO mede vontade de fechar, não tamanho (o tamanho já decide o dono).
// Os pesos saíram dos 599 leads do formulário com todas as respostas (20/05 a
// 07/10): o prazo é o que mais separa (quem quer "para já" chegou a orçamento
// 2,6 vezes mais que quem pesquisa), depois quem decide e como paga. Acima de 90
// pontos, 13,2% chegaram a orçamento; de 30 a 49, 6,9%.
//
// Este arquivo é PURO: não lê banco. A rota da LP, a vitrine do eletroposto, o
// formulário do Meta e a régua de vagas dos robôs perguntam para ele.
// ─────────────────────────────────────────────────────────────────────────────

import { TARIFA_KWH } from './leadSolarFicha';

/** Acima disto o projeto é grande: visita do Diego ou atendimento do Thiago.
 *  NÃO é o KWH_CORTE_TIME (1.200), que continua mandando só no rodízio do
 *  formulário do Meta. São perguntas diferentes: lá "de quem é a vez", aqui
 *  "vale a viagem". */
export const KWH_VISITA = 1000;
/** Até isto a conta é da Giovanna; acima, até KWH_VISITA, da Nilce. */
export const KWH_GIOVANNA = 300;
/** Visita só ACIMA disto (0 a 100). */
export const PONTOS_VISITA = 90;
/** Abaixo disto é curioso: não ganha agenda, vai para a lista. Medido nos 599
 *  leads: abaixo de 40 ficam 12% deles e 4 dos 49 orçamentos, nenhuma venda.
 *  Abaixo de 50 seriam 26% dos leads, 11 orçamentos e 1 venda. */
export const PONTOS_CURIOSO = 40;

/** Quem atende cada faixa. Todas as visitas são do Diego. */
export const QUEM = { pequena: 'Giovanna', media: 'Nilce', visita: 'Diego', grande: 'Thiago' } as const;

/** Quilômetros de ESTRADA contados de Uberlândia, a base do Diego, que faz
 *  todas as visitas. */
export const RAIO_VISITA_KM = 150;

/** A marca na primeira linha da ficha. É por ela que o servidor reconhece uma
 *  ficha do quiz sem precisar de coluna nova: `created_by` continua `lp_solar`
 *  porque duração da agenda, boas-vindas, alerta, etiqueta e painel já leem
 *  esse texto, e trocar o slug tiraria a ficha de todos eles. */
export const MARCA_QUIZ = 'LP SOLAR QUIZ';

export const SOCIOS_VISITA = ['Thiago', 'Diego'] as const;
export type Socio = typeof SOCIOS_VISITA[number];
/** Carteira que não circula (dono_fixo). Cliente delas fica com elas. */
export const DONAS_LIGACAO = ['Nilce', 'Giovanna'] as const;

/** De onde cada sócio sai para a visita. */
export const BASE_DO_SOCIO: Record<Socio, string> = { Diego: 'Uberlândia', Thiago: 'Araguari' };

// ── Tempo de agenda de cada coisa (minutos) ─────────────────────────────────
export const VISITA_MIN = 60;
/** Deslocamento dentro da cidade da base, ida e volta contadas separadas. */
export const URBANO_MIN = 20;
/** Até esta distância (minutos de estrada) a visita usa a grade normal dos
 *  sócios. Acima, vira manhã de rota. 40 cobre Uberlândia e Araguari entre si
 *  (34 a 35 min), que os dois sócios rodam no dia a dia. */
export const URBANA_ATE_MIN = 40;
export const VIDEO_MIN = 30;
export const LIGACAO_MIN = 15;
/** Visita longe sai às 07:30 quando a estrada passa disto; senão 08:00. */
export const SAIDA_CEDO_SE_ESTRADA_PASSA_DE = 100;

/** Grade dos sócios no solar: a mesma lista de 17/08 (leadsMetaService,
 *  SLOTS_SOCIOS_SOLAR), encaixada nos intervalos do eletroposto. */
export const GRADE_SOCIOS_SOLAR = ['08:00', '08:30', '09:00', '09:30', '10:30', '11:30',
  '13:30', '14:30', '15:30', '16:30', '17:30', '18:30'] as const;
/** Videochamada: só as manhãs dos sócios, que o eletroposto não usa. */
export const GRADE_VIDEO = ['08:00', '08:30', '09:00', '09:30', '10:30', '11:30'] as const;
/** Ligação: a grade da Nilce desde 17/08, de 30 em 30. Com 15 min de ligação
 *  num passo de 30, um horário nunca come o seguinte. */
export const GRADE_LIGACAO = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'] as const;
/** Manhã de rota: terça a sexta. A segunda tem eletroposto às 10:00. */
export const DIAS_DE_ROTA = new Set([2, 3, 4, 5]);

// ── As faixas da conta ──────────────────────────────────────────────────────
/** Faixas em reais, com os limites casados com o corte: R$ 1.050 é 1.000 kWh a
 *  R$ 1,05, então nenhuma faixa atravessa a régua e a leitura pelo meio nunca
 *  decide de que lado alguém está. `reais` é o valor típico lido do jeito de
 *  sempre (consumoTipico): faixa pelo meio, "até N" vira N/2, "mais de N"
 *  vira N+1. */
export const FAIXAS_CONTA = [
  { v: 'ate300', l: 'Até R$ 300', reais: 150 },
  { v: '300_600', l: 'R$ 300 a R$ 600', reais: 450 },
  { v: '600_1050', l: 'R$ 600 a R$ 1.050', reais: 825 },
  { v: '1050_2000', l: 'R$ 1.050 a R$ 2.000', reais: 1525 },
  { v: '2000_5000', l: 'R$ 2.000 a R$ 5.000', reais: 3500 },
  { v: '5000_mais', l: 'Mais de R$ 5.000', reais: 5001 },
] as const;
export type FaixaConta = typeof FAIXAS_CONTA[number]['v'];

export function kwhDaFaixa(v: unknown): number | null {
  const f = FAIXAS_CONTA.find(x => x.v === v);
  return f ? Math.round(f.reais / TARIFA_KWH) : null;
}
export const rotuloDaFaixa = (v: unknown): string | null => FAIXAS_CONTA.find(x => x.v === v)?.l ?? null;

// ── As cidades do raio ──────────────────────────────────────────────────────
// 44 municípios a até 150 km de ESTRADA da base mais perto. Gerado em 07/10/2026
// com a coordenada da SEDE de cada município (IBGE) e rotas do OSRM, de
// Uberlândia e de Araguari. NÃO trocar por api/src/data/municipios.json: aquilo
// é o centro do retângulo do município e o próprio gerador avisa para não usar
// em deslocamento de equipe (por ele Araguari fica a 46 km de Uberlândia; pela
// estrada são 38). Município fora desta lista está fora do raio.
//              nome,                    UF,  km UDI, min UDI, km ARA, min ARA
const RAIO: ReadonlyArray<readonly [string, string, number, number, number, number]> = [
  ['Araguari', 'MG', 38, 34, 0, 0],
  ['Uberlândia', 'MG', 0, 0, 38, 35],
  ['Anhanguera', 'GO', 100, 82, 44, 60],
  ['Cascalho Rico', 'MG', 80, 72, 50, 50],
  ['Indianópolis', 'MG', 62, 56, 60, 66],
  ['Tupaciguara', 'MG', 70, 58, 67, 67],
  ['Cumari', 'GO', 99, 81, 68, 59],
  ['Monte Alegre de Minas', 'MG', 69, 52, 103, 79],
  ['Estrela do Sul', 'MG', 101, 94, 71, 73],
  ['Catalão', 'GO', 108, 80, 78, 58],
  ['Goiandira', 'GO', 112, 93, 82, 72],
  ['Corumbaíba', 'GO', 122, 113, 84, 81],
  ['Nova Ponte', 'MG', 84, 84, 116, 109],
  ['Prata', 'MG', 85, 68, 121, 97],
  ['Romaria', 'MG', 89, 74, 87, 84],
  ['Ouvidor', 'GO', 121, 93, 91, 72],
  ['Iraí de Minas', 'MG', 98, 81, 96, 91],
  ['Santa Juliana', 'MG', 98, 94, 130, 119],
  ['Nova Aurora', 'GO', 131, 111, 101, 90],
  ['Três Ranchos', 'GO', 136, 107, 105, 86],
  ['Uberaba', 'MG', 105, 79, 139, 107],
  ['Grupiara', 'MG', 137, 135, 107, 113],
  ['Monte Carmelo', 'MG', 108, 89, 107, 99],
  ['Marzagão', 'GO', 145, 135, 108, 103],
  ['Pedrinópolis', 'MG', 114, 109, 146, 134],
  ['Canápolis', 'MG', 121, 91, 155, 118],
  ['Araporã', 'MG', 144, 103, 123, 118],
  ['Centralina', 'MG', 128, 93, 162, 120],
  ['Água Limpa', 'GO', 167, 155, 130, 123],
  ['Davinópolis', 'GO', 160, 127, 130, 105],
  ['Douradoquara', 'MG', 156, 137, 130, 132],
  ['Itumbiara', 'GO', 150, 110, 130, 125],
  ['Caldas Novas', 'GO', 173, 161, 136, 129],
  ['Perdizes', 'MG', 136, 129, 168, 154],
  ['Delta', 'MG', 137, 103, 171, 131],
  ['Ituiutaba', 'MG', 137, 112, 170, 139],
  ['Ipameri', 'GO', 170, 135, 139, 114],
  ['Abadia dos Dourados', 'MG', 142, 120, 141, 130],
  ['Veríssimo', 'MG', 143, 113, 178, 140],
  ['Água Comprida', 'MG', 145, 109, 180, 137],
  ['Igarapava', 'SP', 148, 112, 182, 139],
  ['Patrocínio', 'MG', 150, 121, 148, 131],
  ['Aramina', 'SP', 149, 112, 183, 139],
  ['Comendador Gomes', 'MG', 150, 115, 187, 144],
];

export interface CidadeRaio {
  nome: string; uf: string;
  kmUdi: number; minUdi: number; kmAra: number; minAra: number;
}
export const CIDADES_RAIO: readonly CidadeRaio[] = RAIO.map(([nome, uf, kmUdi, minUdi, kmAra, minAra]) =>
  ({ nome, uf, kmUdi, minUdi, kmAra, minAra }));

/** Sem acento, minúsculo, só letras e espaço. */
export const normCidade = (s: unknown): string => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

const APELIDOS: Record<string, string> = { udi: 'Uberlândia', 'uberlandia mg': 'Uberlândia' };

/** A cidade digitada, se ela estiver no raio. Aceita "Uberlândia-MG",
 *  "Uberlândia - MG", "uberlandia mg", "Udi". Fora da lista devolve null, e
 *  null quer dizer FORA DO RAIO, não "não sei". */
export function acharCidadeRaio(txt: unknown): CidadeRaio | null {
  const limpo = String(txt ?? '').trim()
    .replace(/\s*[-/,(]\s*(mg|go|sp|df|ms|mt|ba|pr|rj|es)\s*\)?\s*$/i, '')
    .replace(/\s+(mg|go|sp)$/i, '');
  const t = normCidade(limpo);
  if (!t) return null;
  const alvo = APELIDOS[t] ? normCidade(APELIDOS[t]) : t;
  return CIDADES_RAIO.find(c => normCidade(c.nome) === alvo) ?? null;
}

export const kmDaBase = (c: CidadeRaio): number => Math.min(c.kmUdi, c.kmAra);

/** Minutos de estrada do sócio até a cidade. Na própria base é deslocamento urbano. */
export function deslocamentoMin(c: CidadeRaio, socio: Socio): number {
  if (c.nome === BASE_DO_SOCIO[socio]) return URBANO_MIN;
  return socio === 'Thiago' ? c.minAra : c.minUdi;
}

/** Quem chega mais rápido. Empate fica com quem tem a cidade como base. */
export function socioMaisPerto(c: CidadeRaio): Socio {
  return deslocamentoMin(c, 'Thiago') <= deslocamentoMin(c, 'Diego') ? 'Thiago' : 'Diego';
}

export const ehVisitaUrbana = (c: CidadeRaio, socio: Socio): boolean =>
  deslocamentoMin(c, socio) <= URBANA_ATE_MIN;

// ── A pontuação (0 a 100) ───────────────────────────────────────────────────
/** Pesos por resposta. Somam 100 no melhor caso: quer para já (35), decide
 *  sozinho (20), já sabe como paga à vista (20), imóvel próprio (15) e está
 *  comparando orçamento (10). Pergunta sem resposta vale 0.
 *
 *  Para passar de 90 é preciso querer para este mês, ter o imóvel e saber como
 *  paga; "nos próximos 3 meses" com todo o resto no máximo dá 83. É de
 *  propósito: a visita do Diego é para quem está fechando. */
export const PESOS = {
  urgencia: { ja: 35, '3meses': 18, pesquisando: 0 },
  decisor: { eu: 20, junto: 14, outro: 0 },
  pagamento: { vista: 20, financiamento: 16, cartao: 16, naosei: 0 },
  imovel: { proprio: 15, construcao: 8, alugado: 0 },
  concorrente: { sim: 10, nao: 5 },
} as const;
type CampoPeso = keyof typeof PESOS;

export interface Pontuacao { pontos: number; partes: Array<{ campo: CampoPeso; pts: number; max: number }> }

export function pontuar(r: Partial<Record<CampoPeso, unknown>>): Pontuacao {
  const partes = (Object.keys(PESOS) as CampoPeso[]).map(campo => {
    const tabela = PESOS[campo] as Record<string, number>;
    const v = String(r[campo] ?? '');
    return { campo, pts: Object.prototype.hasOwnProperty.call(tabela, v) ? tabela[v] : 0, max: Math.max(...Object.values(tabela)) };
  });
  return { pontos: partes.reduce((s, p) => s + p.pts, 0), partes };
}

// ── A decisão ───────────────────────────────────────────────────────────────
export type Caminho = 'vistoria' | 'video' | 'ligacao' | 'curioso';

export interface RespostasDoCaminho {
  conta?: unknown;        // valor de FAIXAS_CONTA
  cidade?: unknown;       // texto digitado
  urgencia?: unknown;     // 'ja' | '3meses' | 'pesquisando'
  decisor?: unknown;      // 'eu' | 'junto' | 'outro'
  pagamento?: unknown;    // 'vista' | 'financiamento' | 'cartao' | 'naosei'
  imovel?: unknown;       // 'proprio' | 'construcao' | 'alugado'
  concorrente?: unknown;  // 'sim' | 'nao'
}

export interface Decisao {
  caminho: Caminho;
  motivo: string;
  kwh: number | null;
  grande: boolean;
  cidade: CidadeRaio | null;
  pontos: number;
  pontuacao: Pontuacao;
  /** Em ordem de preferência. A rota escolhe o primeiro que tiver horário. */
  candidatos: string[];
  /** O cliente já é de alguém que não faz aquele atendimento: ficou com o
   *  dono, e aqui fica o que ele qualificaria. */
  qualifica: Caminho | null;
}

const ehSocioVisita = (n: unknown): n is Socio => (SOCIOS_VISITA as readonly string[]).includes(String(n));
const ehDonaLigacao = (n: unknown): boolean => (DONAS_LIGACAO as readonly string[]).includes(String(n));
const kwhTxt = (n: number) => n.toLocaleString('pt-BR');

/** A cidade está no raio da visita (estrada a partir de Uberlândia, a base do Diego)? */
export const noRaioDaVisita = (c: CidadeRaio | null): boolean => !!c && c.kmUdi <= RAIO_VISITA_KM;

/** O caminho e o dono pela pontuação, pela conta e pela cidade, sem olhar quem
 *  já é dono do telefone. */
export function caminhoPelasRespostas(r: RespostasDoCaminho): Omit<Decisao, 'qualifica'> {
  const kwh = kwhDaFaixa(r.conta);
  const cidade = acharCidadeRaio(r.cidade);
  const grande = kwh !== null && kwh > KWH_VISITA;
  const pontuacao = pontuar(r as Partial<Record<CampoPeso, unknown>>);
  const pontos = pontuacao.pontos;
  const base = { kwh, grande, cidade, pontos, pontuacao };

  if (pontos < PONTOS_CURIOSO) {
    return { ...base, caminho: 'curioso', candidatos: [],
      motivo: `${pontos} pontos, abaixo de ${PONTOS_CURIOSO}: vai para a lista de curiosos, sem agenda.` };
  }
  if (grande && pontos > PONTOS_VISITA && noRaioDaVisita(cidade)) {
    const onde = cidade!.kmUdi === 0 ? 'em Uberlândia' : `a ${cidade!.kmUdi} km de Uberlândia pela estrada`;
    return { ...base, caminho: 'vistoria', candidatos: [QUEM.visita],
      motivo: `Acima de ${kwhTxt(KWH_VISITA)} kWh, ${pontos} pontos e ${onde}: visita do Diego.` };
  }
  if (grande) {
    const porque = pontos > PONTOS_VISITA ? `fora dos ${RAIO_VISITA_KM} km da visita` : `${pontos} pontos, a visita é acima de ${PONTOS_VISITA}`;
    return { ...base, caminho: 'video', candidatos: [QUEM.grande],
      motivo: `Acima de ${kwhTxt(KWH_VISITA)} kWh, ${porque}: atendimento do Thiago sem visita.` };
  }
  if (kwh !== null && kwh > KWH_GIOVANNA) {
    return { ...base, caminho: 'ligacao', candidatos: [QUEM.media],
      motivo: `De ${kwhTxt(KWH_GIOVANNA)} a ${kwhTxt(KWH_VISITA)} kWh: ligação da Nilce.` };
  }
  return { ...base, caminho: 'ligacao', candidatos: [QUEM.pequena],
    motivo: `Até ${kwhTxt(KWH_GIOVANNA)} kWh: ligação da Giovanna.` };
}

/**
 * O caminho e quem atende.
 *
 * Cliente que volta fica com o dono (1 telefone = 1 consultor). Se o dono não
 * faz aquele atendimento, ele atende do jeito que faz e a ficha leva
 * "QUALIFICA PARA ..." para ele chamar quem faz: Nilce e Giovanna ligam; o
 * Thiago não faz visita (todas são do Diego). Curioso continua curioso.
 */
export function decidirCaminho(r: RespostasDoCaminho, dono?: string | null): Decisao {
  const base = caminhoPelasRespostas(r);
  if (base.caminho === 'curioso' || !dono || base.candidatos[0] === dono) return { ...base, qualifica: null };
  if (ehDonaLigacao(dono)) {
    return { ...base, caminho: 'ligacao', candidatos: [String(dono)],
      qualifica: base.caminho === 'ligacao' ? null : base.caminho,
      motivo: `${base.motivo} O cliente já é de ${dono}: ela atende${base.caminho === 'ligacao' ? '' : ' e chama quem faz o próximo passo'}.` };
  }
  if (dono === 'Thiago' && base.caminho === 'vistoria') {
    return { ...base, caminho: 'video', candidatos: ['Thiago'], qualifica: 'vistoria',
      motivo: `${base.motivo} O cliente já é do Thiago: ele atende e marca a visita com o Diego.` };
  }
  if (ehSocioVisita(dono)) {
    return { ...base, candidatos: [dono], qualifica: null, motivo: `${base.motivo} O cliente já é do ${dono}.` };
  }
  return { ...base, qualifica: null };
}

/** Sem horário no caminho: a visita cai no atendimento do Thiago, o atendimento
 *  do Thiago cai na ligação da Nilce, a ligação da Giovanna cai na da Nilce.
 *  O cliente nunca fica sem botão. `null` = já é a última reserva. */
export function reservaDe(dec: Decisao): Decisao | null {
  const qual = dec.qualifica ?? (dec.caminho === 'ligacao' ? null : dec.caminho);
  if (dec.caminho === 'vistoria') {
    return { ...dec, caminho: 'video', candidatos: [QUEM.grande], qualifica: 'vistoria',
      motivo: `${dec.motivo} Sem horário de visita nos próximos dias: o Thiago atende e marca a visita.` };
  }
  if (dec.caminho === 'video' || (dec.caminho === 'ligacao' && !dec.candidatos.includes(QUEM.media))) {
    return { ...dec, caminho: 'ligacao', candidatos: [QUEM.media], qualifica: qual,
      motivo: `${dec.motivo} Sem horário nos próximos dias: a Nilce liga.` };
  }
  return null;
}

// ── O tempo de agenda ───────────────────────────────────────────────────────
const MIN_MS = 60_000;
const hhmmParaMin = (h: string): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const minParaHhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ceil30 = (m: number): number => Math.ceil(m / 30) * 30;

/** Dia da semana (0 = domingo) de um YMD, lido ao meio-dia de Brasília. */
const diaDaSemana = (ymd: string): number => new Date(`${ymd}T12:00:00-03:00`).getUTCDay();

/** Horário de chegada da manhã de rota até esta cidade, saindo da base. */
export function chegadaDeRota(c: CidadeRaio, socio: Socio): string {
  const desloc = deslocamentoMin(c, socio);
  const saida = desloc > SAIDA_CEDO_SE_ESTRADA_PASSA_DE ? 7 * 60 + 30 : 8 * 60;
  return minParaHhmm(ceil30(saida + desloc));
}

/**
 * Quanto da agenda o compromisso ocupa, a partir do horário marcado.
 * Na visita, o horário marcado é a CHEGADA: o bloco começa quando o sócio sai
 * e termina quando ele volta. É isto que impede a vitrine do eletroposto de
 * vender uma apresentação com o sócio na estrada.
 */
export function blocoDoCompromisso(caminho: Caminho, quandoMs: number, socio?: string | null, cidade?: CidadeRaio | null): { ini: number; fim: number } {
  if (caminho === 'vistoria') {
    const desloc = cidade && ehSocioVisita(socio) ? deslocamentoMin(cidade, socio) : URBANO_MIN;
    return { ini: quandoMs - desloc * MIN_MS, fim: quandoMs + (VISITA_MIN + desloc) * MIN_MS };
  }
  if (caminho === 'video') return { ini: quandoMs, fim: quandoMs + VIDEO_MIN * MIN_MS };
  return { ini: quandoMs, fim: quandoMs + LIGACAO_MIN * MIN_MS };
}

/** Os horários que o caminho oferece naquele dia para aquela pessoa. */
export function horariosDoCaminho(caminho: Caminho, ymd: string, pessoa: string, cidade: CidadeRaio | null): string[] {
  if (caminho === 'curioso') return [];
  // Ligação de sócio (cliente que já é dele) fica nas manhãs: a tarde é do
  // eletroposto. Nilce e Giovanna ligam na grade delas.
  if (caminho === 'ligacao') return ehSocioVisita(pessoa) ? [...GRADE_VIDEO] : [...GRADE_LIGACAO];
  if (caminho === 'video') return [...GRADE_VIDEO];
  if (!cidade || !ehSocioVisita(pessoa)) return [];
  if (ehVisitaUrbana(cidade, pessoa)) return [...GRADE_SOCIOS_SOLAR];
  return DIAS_DE_ROTA.has(diaDaSemana(ymd)) ? [chegadaDeRota(cidade, pessoa)] : [];
}

export const horarioDaGrade = (caminho: Caminho, ymd: string, hhmm: string, pessoa: string, cidade: CidadeRaio | null): boolean =>
  horariosDoCaminho(caminho, ymd, pessoa, cidade).includes(hhmm);

// ── Ler a ocupação de uma ficha que já existe ───────────────────────────────
export interface FichaAgenda {
  quando: string | null;
  vendedor_nome?: string | null;
  created_by?: string | null;
  cidade?: string | null;
  observacao?: string | null;
}

/** O caminho escrito na primeira linha da ficha do quiz, ou null se a ficha
 *  não é do quiz. A linha é `LP SOLAR QUIZ · Casa · VISTORIA PRESENCIAL`. */
export function caminhoDaFicha(observacao: unknown): Caminho | null {
  const linha = String(observacao ?? '').split('\n')[0].toUpperCase();
  if (!linha.startsWith(MARCA_QUIZ)) return null;
  if (linha.includes('VISTORIA')) return 'vistoria';
  // "ATENDIMENTO ONLINE" desde 08/10 (o do Thiago); "VIDEOCHAMADA" nas fichas do dia 07.
  if (linha.includes('ATENDIMENTO') || linha.includes('VIDEO')) return 'video';
  return 'ligacao';
}

/** Duração da vistoria da LP antiga (até 07/10): 1 hora nos sócios, ligação de
 *  15 min no resto. Mesma regra que as três agendas usavam. */
const LEGADO_SOCIO_MS = 60 * MIN_MS;
const LEGADO_LIGACAO_MS = 15 * MIN_MS;

/**
 * O bloco que uma ficha `lp_solar` ocupa, ou null se a ficha não é desta LP
 * (quem chama segue com a regra dele para eletroposto, formulário do Meta etc.).
 */
export function ocupacaoDaFichaSolar(a: FichaAgenda): { ini: number; fim: number } | null {
  if (String(a.created_by || '') !== 'lp_solar' || !a.quando) return null;
  const t = new Date(String(a.quando)).getTime();
  if (Number.isNaN(t)) return null;
  const caminho = caminhoDaFicha(a.observacao);
  if (caminho) return blocoDoCompromisso(caminho, t, a.vendedor_nome, acharCidadeRaio(a.cidade));
  return { ini: t, fim: t + (ehSocioVisita(a.vendedor_nome) ? LEGADO_SOCIO_MS : LEGADO_LIGACAO_MS) };
}

/** Margem para ler a agenda: uma visita marcada fora da janela pode ter o bloco
 *  dentro dela (a manhã de rota começa até 2h40 antes da chegada e termina até
 *  3h40 depois). Quem lê compromissos de uma janela soma isto nas duas pontas. */
export const MARGEM_LEITURA_MS = 5 * 60 * MIN_MS;

export const _interno = { hhmmParaMin, minParaHhmm, diaDaSemana };
