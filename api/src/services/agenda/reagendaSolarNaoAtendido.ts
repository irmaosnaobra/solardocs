// ─────────────────────────────────────────────────────────────────────────────
// SOLAR: QUEM NÃO ATENDEU VOLTA PRA AGENDA SOZINHO.
//
// Ordem do Thiago (29/09/2026): "todos os NÃO ATENDEU têm que remarcar
// automaticamente, adiciona na lista de followup mesmo os mais antigos, podemos
// recuperar pessoas".
//
// O eletroposto já tinha essa régua (`eletropostoReagendaAuto`, de 20/08). O
// solar não tinha nenhuma: os 48 cards em `nao_atendeu` do solar simplesmente
// ficavam lá. Este módulo é a metade que faltava.
//
// ── POR QUE ELE NÃO ESCREVE UMA LINHA PRO CLIENTE ───────────────────────────
//
// Essa é a diferença que desenha o arquivo, e ela é de propósito. No eletroposto
// a remarcação PRECISA de mensagem própria: a apresentação é por vídeo, com link,
// e quem não sabe do horário novo não entra. No solar o primeiro contato é
// LIGAÇÃO (a Nilce liga, a Giovanna liga), e a agenda delas já tem quem fala:
// o `solarAgendaGiovanna` manda o bom dia às 7h e o "oi" 5 minutos antes da
// ligação, em UMA bolha cada, com teto de linha e carimbo próprios.
//
// Então aqui o trabalho é só MOVER O CARD e limpar os dois carimbos que calariam
// o dia novo (`bomdia_at`, `lembrete_5min_at`). Quem avisa é o módulo que já
// avisa, no formato que já foi medido. Escrever uma terceira copy de "remarquei
// sua ligação" seria uma mensagem nova numa linha que já caiu 3 vezes em 7 dias,
// pra dizer o que a régua das 7h diz melhor.
//
// Consequência honesta: ficha de solar que NÃO é da Giovanna nem da Nilce (o
// `solarAgendaGiovanna` corta por nome) volta pra agenda em silêncio. O dono vê
// o card no dia e liga. Isso não é buraco, é o desenho: quem liga é gente, e a
// máquina de lembrete de follow-up cobra o dono se ele não ligar.
//
// ── O QUE SEGURA O VOLUME ───────────────────────────────────────────────────
//
//   • UMA ficha por tick. Duas no mesmo passo poderiam mirar o mesmo horário.
//   • RAMPA DIÁRIA (`SOLAR_REAGENDA_POR_DIA`, 10). É ela que impede os 48 cards
//     de virarem 48 ligações marcadas numa tarde e ~96 mensagens (bom dia + oi)
//     no mesmo dia. Sem a rampa, o tick de 2 minutos permitiria 300 por dia.
//   • DUAS voltas por ficha, igual ao eletroposto. A terceira não faz ninguém
//     atender mais; faz a agenda encher de fantasma.
//   • Cliente que já tem horário FUTURO não é movido: seria a mesma pessoa em
//     dois lugares da agenda.
//   • Quem ESCREVEU depois de perder o horário não entra: essa conversa tem dono.
//   • Dia de AGENDA FECHADA não conta como falta do cliente. Era a gente que não
//     estava lá.
//
// ── PISO ────────────────────────────────────────────────────────────────────
//
// O piso é anterior ao primeiro card da base (09/05/2026) de propósito: a ordem
// pede os antigos. O que impede o despejo é a rampa, não o piso. As duas coisas
// não podem cair juntas.
//
// Kill-switch: SOLAR_REAGENDA_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { ehOrigemEletroposto } from './origemEtiqueta';
import { agendaFechadaNoIso } from './agendaFechada';
// A leitura mora num modulo NEUTRO. A primeira versao importava do modulo do
// eletroposto, e isso arrastava o grafo dele (Z-API, teto de linha, agenda) pra
// dentro de todo teste que carrega o solar: quatro arquivos sem relacao nenhuma
// com esta mudanca passaram a falhar. A conta continua sendo UMA; o que saiu foi
// um produto depender do outro.
import { APALAVRADO_PREFIX, esperaAte } from './salaDeEspera';
import { carregarBloqueados } from '../agents/whatsapp/silenciar';
import { GRADE_NILCE } from './nilceParaGiovanna';
import { FILTRO_NAO_OCUPA } from './salaDeEspera';

const TZ = 'America/Sao_Paulo';

/** Estado do ciclo: `solar_reagenda:<id>` → { n, ultimo, de }. */
export const SOLAR_REAGENDA_PREFIX = 'solar_reagenda:';
/** A sala de espera do card, igual ao eletroposto: desde 01/10/2026 ela e MARCA
 *  e nao status, pra nao apagar a etiqueta de negociacao do cliente. */
export { APALAVRADO_PREFIX as SOLAR_APALAVRADO_PREFIX } from './salaDeEspera';

const num = (nome: string, padrao: number): number => {
  const cru = (process.env[nome] || '').trim();
  if (cru === '') return padrao;
  const v = Number(cru);
  return Number.isFinite(v) && v >= 0 ? v : padrao;
};

const desligado = (): boolean => (process.env.SOLAR_REAGENDA_OFF || '').trim() === '1';

/** A rampa. Ver o comentário do cabeçalho: é o único freio de volume que existe
 *  aqui, então ela é load-bearing. */
export const tetoPorDia = (): number => num('SOLAR_REAGENDA_POR_DIA', 10);
/**
 * A rampa dos CALADOS, que é outra conta (01/10/2026). Mesma mudança do
 * eletroposto, pelo mesmo motivo: a rampa de cima foi dimensionada por volume
 * de MENSAGEM, e os caminhos silenciosos não mandam nenhuma. Com uma rampa só,
 * o calado ficava preso atrás do que fala — medido em 01/10, o solar fechou a
 * rampa às 00h40 e deixou 116 cards esperando o dia virar.
 */
export const tetoMudoPorDia = (): number => num('SOLAR_REAGENDA_MUDO_POR_DIA', 200);
/** Piso: card com horário anterior a isto nunca é movido. */
const inicioPiso = (): string =>
  (process.env.SOLAR_REAGENDA_INICIO || '').trim() || '2026-05-01T00:00:00.000Z';
/**
 * Quantos dias pra trás enxergar.
 *
 * 21, e o motivo está escrito inteiro no gêmeo do eletroposto (`janelaDias` em
 * `eletropostoReagendaAuto.ts`): com 365 este módulo foi buscar negociação
 * parada desde maio e remarcou como se fosse a 1ª volta da escada. Vinte das 53
 * fichas velhas da semana de 05/10 eram daqui, todas da Giovanna, todas com
 * origem em 01 e 02/09.
 *
 * Os dois números têm que andar juntos: o Thiago vê UMA agenda, não duas.
 */
const janelaDias = (): number => num('SOLAR_REAGENDA_JANELA_DIAS', 21);
/** Folga depois do horário perdido. Menor que a do eletroposto (45 min) porque
 *  no solar não existe toque de 5 min saindo em cima: é ligação, não call. */
const folgaMin = (): number => num('SOLAR_REAGENDA_FOLGA_MIN', 30);

/**
 * A JANELA EM QUE O MÓDULO PODE MEXER NA AGENDA. 9h às 19h, a mesma do gêmeo do
 * eletroposto.
 *
 * Ela faltou na primeira versão, e a medição de 30/09/2026 às 00h59 mostrou o
 * custo: o módulo subiu perto da meia-noite, a rampa do dia virou às 00h00, e às
 * 00h59 as 10 remarcações do dia JÁ ESTAVAM GASTAS. Dez cards mudaram de dia
 * enquanto ninguém olhava.
 *
 * Nenhuma mensagem sai de madrugada (quem fala com o cliente é a régua das 7h),
 * então o estrago não é anti-ban. É de OBSERVAÇÃO: se o remapeamento estiver
 * errado, 10 fichas se movem antes de qualquer pessoa poder reagir, e a rampa
 * que existe pra dar esse tempo não dá tempo nenhum. Robô que mexe na agenda mexe
 * no horário do expediente.
 */
const inicioH = (): number => num('SOLAR_REAGENDA_INICIO_H', 9);
const fimH = (): number => num('SOLAR_REAGENDA_FIM_H', 19);

/** A hora cheia (0-23) agora, em Brasília. */
const horaBrasilia = (base: Date = new Date()): number =>
  Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(base)) % 24;

/** Duas voltas e o card fica pra gente. Mesma conta do eletroposto. */
/**
 * Quantas vezes o NÃO ATENDEU do solar pode ser remarcado. Três desde
 * 01/10/2026, pela mesma ordem e pelo mesmo motivo do eletroposto: o teto existe
 * só no caminho que fala com o cliente. Os calados rodam sem teto.
 */
export const maxVoltas = (): number => num('SOLAR_REAGENDA_MAX_VOLTAS', 3);

/**
 * O CARD DO SOLAR QUE NINGUEM FECHOU (30/09/2026).
 *
 * Mesma regra que o eletroposto ganhou no mesmo dia, pela mesma ordem do
 * Thiago: "o card confirmado, se nao for alterado, ja sera remarcado apos 6h",
 * e "a pessoa, quando nao marca e nao utiliza a ferramenta, sempre tera os
 * clientes retornando e ocupando a agenda".
 *
 * Sem isto a regra valia so pra metade da casa: medido em 30/09, 6 cards de
 * solar vencidos e sem desfecho (Giovanna 2, Nilce 4) que robo nenhum olhava.
 */
const esquecidoH = (): number => num('SOLAR_ESQUECIDO_H', 6);

/**
 * ── A MESMA INVERSAO DO ELETROPOSTO (01/10/2026) ──────────────────────────
 *
 * "Tudo que fica pra tras tem que ser remarcado na agenda a frente, com as
 * regras de tempo de cada um ja definido; sera ciclico ate esse cliente ter um
 * destino final e parar de rodar."
 *
 * O solar estava com 51 cards de fora so por causa da lista do que ENTRA: 39 em
 * fez_orcamento, 8 negociando e 4 no whatsapp. Agora a lista e do que NAO entra,
 * e status novo nasce rodando.
 */
const negociacaoH = (): number => num('SOLAR_NEGOCIACAO_H', 48);
/**
 * ── A ESCADA DA NEGOCIAÇÃO (01/10/2026) ───────────────────────────────────
 *
 * Mesma ordem e mesma conta do eletroposto: 48h na primeira volta, e +24h a
 * cada volta em que a ETIQUETA NÃO MUDA. 48, 72, 96, 120 e assim por diante,
 * sem teto, porque o fim é o destino do card.
 *
 * As etiquetas que o Thiago nomeou (chave na mão, carregador, 50/50,
 * arrendamento) são do eletroposto. Aqui a escada vale pras etiquetas de
 * negociação do solar — `fez_orcamento`, `em_atendimento`,
 * `falando_whatsapp` — porque o mecanismo é o mesmo: etiqueta que não muda é
 * negociação que não andou, e devolver de 48 em 48h pra sempre come a grade
 * sem mudar nada. Deixar o solar de fora faria dois cards idênticos no quadro
 * se comportarem diferente.
 */
const passoNegociacaoH = (): number => num('SOLAR_NEGOCIACAO_PASSO_H', 24);
/** As horas de descanso do degrau `d`: 48, 72, 96, 120 … */
export const horasDoDegrau = (d: number): number =>
  negociacaoH() + passoNegociacaoH() * Math.max(0, Math.floor(d) - 1);
/**
 * O degrau da PRÓXIMA volta. Etiqueta igual sobe um; etiqueta diferente, ou
 * card que nunca voltou, começa no 1. Carimbo antigo não tem `status` e cai no
 * 1 também: ninguém é pulado na virada.
 */
export function degrauDaProximaVolta(
  estado: { status?: string; degrau?: number } | undefined, statusAgora: string,
): number {
  if (!estado?.status || estado.status !== statusAgora) return 1;
  const d = Math.floor(Number(estado.degrau));
  return (Number.isFinite(d) && d >= 1 ? d : 1) + 1;
}
export const DESTINO_FINAL_SOLAR = new Set<string>([
  'fechou', 'sem_interesse', 'cancelado', 'perdido', 'fechou_concorrente',
]);
/** Roda, e com qual relogio. `null` = parou de rodar. */
/**
 * ── O STATUS ANTIGO `apalavrado` NÃO É MAIS FIM DE LINHA (01/10/2026) ──────
 *
 * Ele saía da roda por DOIS caminhos: este relógio devolvia `null` e a consulta
 * o excluía. Enquanto apalavrar GRAVAVA o status, isso estava certo.
 *
 * Depois que APALAVRADO virou MARCA, ficou errado — e errado do pior jeito:
 * nada no sistema tira esse status de uma ficha, então os cards apalavrados
 * ANTES da marca ficaram presos PRA SEMPRE. A data deles não significava nada:
 * passasse 31/10 ou 31/12, eles não voltariam. É exatamente o cemitério que o
 * APALAVRADO foi criado pra não ser. Medido: 3 dos 5 cards na sala de espera
 * estavam nessa situação.
 *
 * Agora `apalavrado` roda no relógio de negociação como qualquer etiqueta, e
 * quem segura a ficha é a MARCA, que tem data. Card com o status e sem a marca
 * volta pra roda, que é o certo: ele é uma negociação sem etiqueta.
 */
export function relogioDoCicloSolar(status: string): 'fala' | 'esquecido' | 'negocia' | null {
  if (DESTINO_FINAL_SOLAR.has(status)) return null;
  if (status === 'nao_atendeu') return 'fala';
  if (status === 'agendado') return 'esquecido';
  return 'negocia';
}
/** Uma por tick: duas no mesmo passo poderiam mirar o mesmo horário. */
const POR_TICK = 1;
/**
 * Quantos cards a rodada pode TENTAR pra conseguir mover `POR_TICK`. Era 1, e
 * card sem vaga na frente da fila parava a fila inteira: a ordem não muda entre
 * ticks, então a rodada seguinte tentava o mesmo card. O limite existe porque
 * cada tentativa varre a agenda do dono.
 */
const TENTATIVAS_POR_RODADA = 8;
/**
 * Quantos HORÁRIOS tentar pro mesmo card antes de passar pro seguinte. A agenda
 * tem dois donos (o reciclo do eletroposto escreve nela também), então colisão
 * entre ler e gravar é esperada, não excepcional.
 */
const HORARIOS_POR_CARD = 4;
/** Até onde procurar vaga. Mais que isso não é remarcação, é chute. */
const HORIZONTE_DIAS_UTEIS = 10;
/** A ligação do solar ocupa 15 min; a apresentação do eletroposto, 30. A agenda
 *  é a MESMA, então a sobreposição tem que olhar os dois. */
const DUR_LIGACAO_MS = 15 * 60 * 1000;
const DUR_APRESENTACAO_MS = 30 * 60 * 1000;
const duracaoDe = (createdBy: string | null): number =>
  ehOrigemEletroposto(createdBy) ? DUR_APRESENTACAO_MS : DUR_LIGACAO_MS;

// ── Datas em Brasília ───────────────────────────────────────────────────────
// Sem aritmética de fuso na mão: o dia sai como texto e o `-03:00` é fixo (o
// Brasil não tem horário de verão desde 2019).
const ymdSP = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const isoDe = (ymd: string, hhmm: string): string =>
  new Date(`${ymd}T${hhmm}:00-03:00`).toISOString();

/**
 * Dia útil é SEGUNDA A SEXTA, sem feriado.
 *
 * ── SÁBADO SAIU EM 01/10/2026, e o comentário que estava aqui era FALSO ──
 *
 * Ele dizia "sábado entra: a agenda do solar trabalha sábado (é o que a grade
 * da LP vende)". A LP não vende: `dashboard/public/io/solar/index.html` fecha o
 * fim de semana inteiro (`if (dow === 0 || dow === 6) return []`), e o
 * `nilceParaGiovanna` e o `leadsMetaService` fecham também. Das QUATRO pontas
 * que definem a semana do solar, esta era a única que discordava — e ela
 * justificava a diferença com uma afirmação sobre as outras que não era
 * verdade.
 *
 * O preço foi medido no dia em que o ciclo começou a devolver a base inteira:
 * 30 cards foram parar no sábado 03/10, e 22 deles iam receber "bom dia, hoje
 * tem ligação" numa manhã em que ninguém atende. Zero eram de eletroposto — o
 * reciclo de lá usa `agendaAbre`, que sempre fechou o fim de semana.
 *
 * A regra da semana vive em quatro arquivos. Enquanto viver, ela precisa de um
 * teste que compare os quatro, e é o que `semanaDoSolar.test.ts` faz.
 */
function ehDiaUtil(ymd: string): boolean {
  const dow = new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
  return dow !== 0 && dow !== 6 && !ehFeriadoBR(ymd);
}

function proximosDiasUteis(base: string, quantos: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${base}T12:00:00-03:00`);
  for (let i = 0; i < 40 && out.length < quantos; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const ymd = ymdSP(cursor);
    if (ehDiaUtil(ymd)) out.push(ymd);
  }
  return out;
}

/**
 * Chave de telefone: DDD + os 8 últimos dígitos, que é a mesma ideia do
 * `nilceParaGiovanna` (tolera o nono dígito entrar e sair).
 *
 * A diferença está no 55: aqui ele é tirado EM LAÇO, enquanto sobrar mais que um
 * número brasileiro (11 dígitos). O `.replace(/^55/, '')` de uma passada só
 * deixa `555534998887766` virar `5534998887766`, e aí a chave sai `5598887766`
 * em vez de `3498887766` — o mesmo cliente passa por dois, e a trava de "já tem
 * ligação marcada" não pega. O 55 duplicado é gravado de verdade pela linha e já
 * criou lead mudo antes.
 */
export function telKey(raw: string | null | undefined): string | null {
  let d = String(raw || '').replace(/\D/g, '');
  while (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

const horaBonita = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');

export interface CardSolar {
  id: number;
  quando: string;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  vendedor_nome: string | null;
  created_by: string | null;
  status: string | null;
  lead_resposta_at: string | null;
  historico: string | null;
}

export type ResultadoReagendaSolar = {
  remarcados: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; dono: string; de: string; para: string; volta: number }>;
};

const zero = (motivo?: string): ResultadoReagendaSolar =>
  ({ remarcados: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/**
 * A linha do card. Sem ela, "card parado" e "card sendo trabalhado pelo robô"
 * são a mesma tela pro consultor que abre a ficha.
 */
/**
 * A LINHA MUDA COM O RELÓGIO, porque as três situações são diferentes
 * (01/10/2026).
 *
 * Havia um texto só: "não atendeu em X". Isso é fato quando alguém apertou NÃO
 * ATENDEU. Nos outros dois caminhos não é: o card esquecido pode ter tido a
 * ligação e ido bem, e o card em negociação nunca teve ligação marcada nenhuma.
 * Medido em 01/10: os 20 cards que o módulo moveu naquele dia estavam todos em
 * `agendado`, e todos os 20 ficaram com "não atendeu" escrito no histórico, com
 * um denominador `/2` de um teto que não se aplica a eles. O cadastro inventando
 * um fato é pior que o cadastro calado: alguém lê isso e cobra o cliente.
 *
 * Mesmas três frases do eletroposto, trocando apresentação por ligação.
 */
export function linhaDoHistorico(
  deIso: string, paraIso: string, volta: number, relogio: 'fala' | 'esquecido' | 'negocia' = 'fala',
  degrau = 1,
): string {
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  if (relogio === 'negocia') {
    // A LINHA DIZ O DEGRAU E O PRÓXIMO INTERVALO: um card que volta em 5 dias em
    // vez de 2 parece defeito, e a primeira coisa que alguém faz com o que parece
    // defeito é desligar.
    const total = volta !== degrau ? ` (${volta}ª no total)` : '';
    return `[${carimbo} · Sistema] 🔁 Ciclo de ${horasDoDegrau(degrau)}h (${degrau}ª volta nesta etiqueta${total}): `
      + `a negociação parou desde ${horaBonita(deIso)} e o card voltou pra ${horaBonita(paraIso)}, `
      + 'com o mesmo consultor e o mesmo status. Nada foi enviado ao cliente. '
      + `Se a etiqueta nao mudar, a proxima volta e em ${horasDoDegrau(degrau + 1)}h; `
      + `mudar de etiqueta recomeca em ${horasDoDegrau(1)}h. `
      + 'Ele sai desta roda fechando, marcando Sem interesse ou pondo em Apalavrado.';
  }
  if (relogio === 'esquecido') {
    // Sem `x/y`: este caminho não tem teto, e escrever um denominador que não
    // existe faria a equipe esperar que o card parasse de voltar sozinho.
    return `[${carimbo} · Sistema] 🔁 Remarcação automática (${volta}ª vez): `
      + `a ligação de ${horaBonita(deIso)} passou e o card ficou sem desfecho por mais de ${esquecidoH()}h, `
      + `então ele voltou pra ${horaBonita(paraIso)}, com o mesmo consultor. `
      + 'Nada foi enviado ao cliente. Se a ligação aconteceu, é só marcar o status certo.';
  }
  return `[${carimbo} · Sistema] 🔁 Remarcação automática ${volta}/${maxVoltas()}: `
    + `não atendeu em ${horaBonita(deIso)} e voltou pra ${horaBonita(paraIso)}, com o mesmo consultor.`;
}

/**
 * Acha o primeiro horário livre na agenda de QUEM JÁ ESTAVA com o card.
 *
 * Pura de propósito (recebe a ocupação em vez de ler o banco): é a regra que
 * decide onde a ligação cai, e é ela que o teste prende. Trocar de consultor
 * aqui mexeria na divisão que o repasse faz entre as duas, e isso é decisão de
 * gente.
 */
export function primeiraVaga(
  ocupado: Array<{ ini: number; dur: number }>,
  agora: number,
  dias: string[],
): string | null {
  for (const dia of dias) {
    for (const hhmm of GRADE_NILCE) {
      const iso = isoDe(dia, hhmm);
      const t = new Date(iso).getTime();
      if (t <= agora) continue;
      const colide = ocupado.some(o => o.ini < t + DUR_LIGACAO_MS && t < o.ini + o.dur);
      if (!colide) return iso;
    }
  }
  return null;
}

/**
 * Uma rodada. Chamada de ~2 em 2 minutos dentro do /cron/process-messages.
 * `dry` decide igual e não grava nada.
 */
export async function runReagendaSolarTick(
  opts: { dry?: boolean } = {},
): Promise<ResultadoReagendaSolar> {
  const dry = !!opts.dry;
  if (desligado()) return zero('desligado');
  // O modo seco atravessa a janela de propósito, como em todo módulo da casa:
  // conferir o que ele faria é pergunta, não ação.
  // A JANELA SO SEGURA QUEM FALA. O card esquecido se move em silencio (ele nao
  // destrava `bomdia_at`/`lembrete_5min_at`), entao segura-lo ate as 9h so
  // atrasa a arrumacao do quadro. Mesma correcao feita no eletroposto.
  const h = horaBrasilia();
  const foraDaJanela = !dry && (h < inicioH() || h >= fimH());

  const agora = Date.now();
  const de = new Date(Math.max(agora - janelaDias() * 86400_000, new Date(inicioPiso()).getTime())).toISOString();
  const ate = new Date(agora - folgaMin() * 60_000).toISOString();
  if (de >= ate) return zero('piso_ainda_no_futuro');

  // 1. Os cards vermelhos do solar.
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, quando, cliente_nome, cliente_telefone, vendedor_nome, created_by, status, lead_resposta_at, historico')
    // `apalavrado` saiu: quem segura a ficha e a MARCA, que tem data.
    .not('status', 'in', `(${[...DESTINO_FINAL_SOLAR].join(',')})`)
    .gte('quando', de)
    .lte('quando', ate)
    .order('quando', { ascending: false })
    .limit(1000);
  if (error) {
    logger.error('solar-reagenda', 'ler os nao_atendeu falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  // A janela de 21 dias corta ficha parada há semanas, de propósito. Contar o
  // que ela deixou de fora é o que impede isso de ser corte calado — mesma
  // contagem do gêmeo do eletroposto, pelo mesmo motivo.
  const { count: foraDaJanelaN } = await supabaseGerador
    .from('agendamentos')
    .select('id', { count: 'exact', head: true })
    .not('status', 'in', `(${[...DESTINO_FINAL_SOLAR].join(',')})`)
    .gte('quando', inicioPiso())
    .lt('quando', de);
  if ((foraDaJanelaN ?? 0) > 0) {
    logger.info('solar-reagenda', `${foraDaJanelaN} ficha(s) ficaram FORA da janela de `
      + `${janelaDias()} dias e não voltam pra agenda, ficam na data onde pararam.`);
  }

  const corteEsquecido = new Date(agora - esquecidoH() * 3600_000).toISOString();
  const corteNegociacao = new Date(agora - negociacaoH() * 3600_000).toISOString();
  const bloqueado = await carregarBloqueados();
  const vermelhos = ((data ?? []) as CardSolar[]).filter(f =>
    // Cada um com o seu relogio: vermelho 30 min, esquecido 6h, negociacao 48h.
    (f.status !== 'agendado' || (!!f.quando && f.quando <= corteEsquecido))
    && (relogioDoCicloSolar(String(f.status)) !== 'negocia'
      || (!!f.quando && f.quando <= corteNegociacao))
    && relogioDoCicloSolar(String(f.status)) !== null
    // Fora do horario comercial sobra so o card esquecido, que e silencioso.
    && (!foraDaJanela || f.status !== 'nao_atendeu')
    // Eletroposto tem régua própria, com copy própria. Duas máquinas no mesmo
    // card remarcariam duas vezes o mesmo cliente.
    && !ehOrigemEletroposto(f.created_by)
    && !!f.cliente_telefone
    // FORA DO PADRÃO: mesma regra do reciclo do eletroposto.
    && !bloqueado(f.cliente_telefone)
    && !!f.vendedor_nome
    && !!f.quando
    // Escreveu depois de perder o horário? Não sumiu, está conversando.
    && !(f.lead_resposta_at && f.lead_resposta_at > f.quando)
    // Falta nossa não é falta dele.
    && !agendaFechadaNoIso(f.quando));
  if (!vermelhos.length) return zero(foraDaJanela ? 'fora_da_janela' : 'nenhum_vermelho');

  // 2. Estado do ciclo por card, e a rampa do dia.
  //
  //    As duas leituras são fail-closed: consulta que quebra devolve `data`
  //    nulo, e tratar isso como "ninguém foi remarcado hoje" faria a rampa
  //    desaparecer justamente no dia em que o banco está ruim. Na dúvida ninguém
  //    é movido — a fila esperou meses, espera o próximo tick.
  const ids = vermelhos.map(f => f.id);
  const estadosQ = await supabase
    .from('system_state').select('key, value')
    .in('key', ids.map(id => `${SOLAR_REAGENDA_PREFIX}${id}`));
  if (estadosQ.error) {
    logger.error('solar-reagenda', 'ler o ciclo falhou', estadosQ.error);
    return { ...zero('erro_ciclo'), erros: 1 };
  }
  // O estado deixou de ser só a contagem de voltas: a escada precisa da ETIQUETA
  // da última volta e do degrau em que ela caiu.
  // A SALA DE ESPERA por marca. Mesma leitura do eletroposto, incluindo o
  // padrao de 30 dias pra data ilegivel e o `null` pra marca sem data nenhuma.
  const esperasQ = await supabase
    .from('system_state').select('key, value')
    .in('key', ids.map(id => `${APALAVRADO_PREFIX}${id}`));
  if (esperasQ.error) {
    logger.error('solar-reagenda', 'ler a sala de espera falhou — ninguem anda nesta rodada', esperasQ.error);
    return { ...zero('erro_espera'), erros: 1 };
  }
  const esperandoAte = new Map<number, number>();
  for (const r of esperasQ.data ?? []) {
    const id = Number(String(r.key).slice(APALAVRADO_PREFIX.length));
    const ate = esperaAte(r.value);
    if (Number.isInteger(id) && ate !== null) esperandoAte.set(id, ate);
  }

  const voltasDe = new Map<number, number>();
  const estadoDe = new Map<number, { status?: string; degrau?: number }>();
  for (const r of estadosQ.data ?? []) {
    const id = Number(String(r.key).slice(SOLAR_REAGENDA_PREFIX.length));
    const v = (r.value ?? {}) as { n?: number; status?: string; degrau?: number };
    const n = Number(v.n);
    if (!Number.isInteger(id)) continue;
    if (Number.isFinite(n)) voltasDe.set(id, n);
    estadoDe.set(id, {
      ...(typeof v.status === 'string' ? { status: v.status } : {}),
      ...(typeof v.degrau === 'number' ? { degrau: v.degrau } : {}),
    });
  }

  // ── O CORTE EXATO DA ESCADA, CARD POR CARD ───────────────────────────────
  //
  // O corte de 48h lá em cima é o PISO (degrau 1): ele peneira de graça e não
  // exclui ninguém no prazo, porque nenhum degrau pede MENOS que 48h. Quem sabe
  // o degrau de cada card é o `estadoDe`, lido só agora.
  const descansou = (f: CardSolar): boolean => {
    if (relogioDoCicloSolar(String(f.status)) !== 'negocia') return true;
    const horas = horasDoDegrau(degrauDaProximaVolta(estadoDe.get(f.id), String(f.status)));
    return !!f.quando && new Date(f.quando).getTime() <= agora - horas * 3600_000;
  };
  const noPrazo = vermelhos.filter(f => !descansou(f)).length;
  // Quem o TETO DE VOLTAS barrou (so o vermelho tem teto): contado separado,
  // porque "descansando no degrau" e "estourou as voltas" se resolvem de
  // formas diferentes.
  const noTeto = vermelhos.filter(f =>
    f.status === 'nao_atendeu' && (voltasDe.get(f.id) ?? 0) >= maxVoltas()).length;
  // Sem teto pro esquecido: "sempre tera os clientes retornando". O teto segue
  // valendo pro vermelho, cujo ciclo destrava as mensagens da regua da agenda.
  const naEspera = (f: CardSolar): boolean => {
    const ate = esperandoAte.get(f.id);
    return ate !== undefined && ate > agora;
  };
  const esperando = vermelhos.filter(naEspera).length;
  const naVez = vermelhos.filter(f =>
    !naEspera(f) && descansou(f)
    && (f.status !== 'nao_atendeu' || (voltasDe.get(f.id) ?? 0) < maxVoltas()));
  if (!naVez.length) {
    // "Ninguem na vez" e "todos dentro do degrau" sao coisas diferentes, e
    // juntar as duas num motivo so esconderia a escada de quem le o tick.
    logger.info('solar-reagenda', `fila parada: ${noPrazo} em negociacao dentro do degrau, `
      + `${noTeto} vermelho(s) no teto de ${maxVoltas()} voltas, ${esperando} na sala de espera, `
      + `${vermelhos.length} candidato(s)`);
    if (noPrazo && !noTeto) return zero('todos_no_degrau');
    return zero('ninguem_na_vez');
  }

  const inicioDoDiaBRT = `${ymdSP(new Date(agora))}T00:00:00-03:00`;
  const feitosHoje = await supabase
    .from('system_state').select('key, value')
    .like('key', `${SOLAR_REAGENDA_PREFIX}%`)
    .limit(1000);
  if (feitosHoje.error) {
    logger.error('solar-reagenda', 'ler a rampa do dia falhou — ninguém remarca nesta rodada', feitosHoje.error);
    return { ...zero('erro_rampa'), erros: 1 };
  }
  // Conta pelo `value.ultimo`, o ISO que ESTE modulo grava, e nao pelo
  // `updated_at`, que e coluna de infraestrutura. Mesma regua do eletroposto.
  //
  // E conta POR RELÓGIO desde 01/10/2026: o carimbo grava `relogio`, e carimbo
  // antigo (sem o campo) conta como `fala`, que é o lado seguro — o teto que
  // protege a linha continua cheio no dia da virada.
  const desdeIso = new Date(inicioDoDiaBRT).toISOString();
  const deHoje = (feitosHoje.data || []).filter(r => {
    const u = String((r as { value?: { ultimo?: string } }).value?.ultimo || '');
    return !!u && u >= desdeIso;
  });
  const contados = (qual: 'fala' | 'mudo'): number => deHoje.filter(r => {
    const v = (r as { value?: { relogio?: string } }).value;
    return (v?.relogio === 'mudo' ? 'mudo' : 'fala') === qual;
  }).length;
  const vagaDe = {
    fala: tetoPorDia() - contados('fala'),
    mudo: tetoMudoPorDia() - contados('mudo'),
  };
  logger.info('solar-reagenda', `rampa: fala ${contados('fala')}/${tetoPorDia()}, mudo ${contados('mudo')}/${tetoMudoPorDia()} (desde ${desdeIso}), ${deHoje.length} hoje de ${(feitosHoje.data || []).length} carimbos`);

  // A FILA É FILTRADA, NÃO INTERROMPIDA. Aqui havia um `return` em cima da fila
  // inteira: com `POR_TICK = 1`, um `nao_atendeu` na frente, com a rampa dele
  // cheia, segurava todos os calados atrás dele até o dia virar.
  //
  // O modo seco ATRAVESSA as travas, do mesmo jeito que atravessa a janela de
  // horário: com a rampa cheia, `?dry=1` respondia `rampa_do_dia_cheia` e mais
  // nada, sem dizer quem seria movido nem se a fila ainda existia.
  const relogioDe = (f: CardSolar): 'fala' | 'mudo' =>
    relogioDoCicloSolar(String(f.status)) === 'fala' ? 'fala' : 'mudo';
  const aptos = dry ? naVez : naVez.filter(f => vagaDe[relogioDe(f)] > 0);
  if (!aptos.length) {
    logger.info('solar-reagenda', `ninguém pode andar: fila ${naVez.length}, vaga fala ${vagaDe.fala}, vaga mudo ${vagaDe.mudo}`);
    return zero('rampa_do_dia_cheia');
  }
  const alvos = aptos.slice(0, POR_TICK * TENTATIVAS_POR_RODADA);

  // 3. A agenda futura, pra saber o que está ocupado e quem já tem horário.
  //
  //    Uma leitura só, de TODA a agenda futura, e não uma por consultor: o card
  //    pode ser de qualquer um, e a colisão que importa é a do dono dele. Filtro
  //    no servidor por data e paginação implícita pelo limite alto — a agenda
  //    futura media 34 linhas em 29/09/2026, então 1000 é folga com sobra.
  const futuraQ = await supabaseGerador
    .from('agendamentos')
    .select('id, quando, vendedor_nome, cliente_telefone, created_by, status')
    .gte('quando', new Date(agora).toISOString())
    // ── O QUE OCUPA HORÁRIO É DENYLIST, NÃO ALLOWLIST (01/10/2026) ─────────
    //
    // Isto era uma lista do que ENTRA, e toda lista assim tem o mesmo defeito:
    // status criado depois nasce INVISÍVEL. Medido em 01/10, logo depois de o
    // ciclo de 48h começar a devolver negociação pra agenda: das 92 linhas
    // futuras, 31 estavam fora desta lista (chave_na_mao 8, carregador 5,
    // meio_a_meio 5, arrendamento 4, fez_orcamento 3 e 6 encerradas). Pro Thiago,
    // a varredura escolhia 01/10 15:00 quando o primeiro horário livre de
    // verdade era 02/10 11:00: ela marcava EM CIMA de uma reunião viva, o índice
    // único recusava a gravação e o card não andava.
    //
    // A régua agora é a MESMA do `eletropostoVagas`, que é a outra ponta que
    // escreve nesta agenda: só horário cancelado ou sem interesse deixa de
    // ocupar. Se as duas discordarem, uma marca onde a outra já marcou.
    .not('status', 'in', FILTRO_NAO_OCUPA)
    .limit(1000);
  if (futuraQ.error) {
    logger.error('solar-reagenda', 'ler a agenda futura falhou — não inventa horário', futuraQ.error);
    return { ...zero('erro_agenda'), erros: 1 };
  }
  // CÓPIA, não o array da consulta: o laço abaixo ACRESCENTA nele o horário que
  // acabou de gravar, e mexer no que outro devolveu é como se descobre, meses
  // depois, que duas rodadas estavam conversando por baixo da mesa.
  const futura = [...((futuraQ.data ?? []) as Array<{
    quando: string; vendedor_nome: string | null; cliente_telefone: string | null; created_by: string | null;
  }>)];
  const comHorarioFuturo = new Set(
    futura.map(f => telKey(f.cliente_telefone)).filter(Boolean) as string[]);

  let remarcados = 0, erros = 0;
  const previa: NonNullable<ResultadoReagendaSolar['previa']> = [];

  for (const f of alvos) {
    // Para no que MOVEU, não no que tentou: é o que faz a fila andar quando o
    // primeiro card não tem vaga na agenda do dono.
    if ((dry ? previa.length : remarcados) >= POR_TICK) break;
    const dono = String(f.vendedor_nome);
    const chave = telKey(f.cliente_telefone);
    // Já tem ligação marcada? Mover criaria a mesma pessoa em dois lugares.
    if (chave && comHorarioFuturo.has(chave)) continue;

    const ocupado = futura
      .filter(o => o.vendedor_nome === dono)
      .map(o => ({ ini: new Date(o.quando).getTime(), dur: duracaoDe(o.created_by) }));
    const dias = proximosDiasUteis(ymdSP(new Date(agora)), HORIZONTE_DIAS_UTEIS);
    const volta = (voltasDe.get(f.id) ?? 0) + 1;
    // UMA conta de degrau, usada nos tres lugares: decidir se o card podia andar,
    // escrever a linha e gravar o carimbo.
    const degrau = degrauDaProximaVolta(estadoDe.get(f.id), String(f.status));
    // UMA leitura do relógio, ANTES do update. Ler de novo depois é pedir pra
    // classificar a ficha pelo status NOVO: o vermelho volta pra `agendado` na
    // mesma gravação, e aí ele se carimbaria como calado e deixaria de gastar o
    // teto que protege a linha.
    const relogio = relogioDoCicloSolar(String(f.status)) ?? 'fala';

    // ── MAIS DE UM HORÁRIO POR CARD, QUANDO O PRIMEIRO É RECUSADO ──────────
    //
    // `primeiraVaga` decide pela agenda que a gente LEU. Entre a leitura e a
    // gravação, outra máquina pode ter marcado ali (a agenda tem dois donos: o
    // reciclo do eletroposto escreve nela também), e aí o índice único recusa.
    // Recusa de horário ocupado NÃO é erro: é o banco dizendo a verdade, e a
    // resposta certa é tentar o seguinte, não contar um erro e desistir.
    //
    // Foi o que apareceu na primeira rodada da regra nova: 8 tentativas, 8
    // `erros`, zero cards movidos. O módulo tentava 8 cards diferentes e todos
    // mirando o MESMO horário, porque `ocupado` não aprendia nada no caminho.
    let novo: string | null = null;
    let moveu = false;
    for (let tentativa = 1; tentativa <= HORARIOS_POR_CARD && !moveu; tentativa++) {
      novo = primeiraVaga(ocupado, agora, dias);
      if (!novo) break;

      if (dry) {
        previa.push({
          id: f.id, cliente: f.cliente_nome || '(sem nome)', dono,
          de: horaBonita(f.quando), para: horaBonita(novo), volta,
        });
        moveu = true;
        break;
      }

      const linha = linhaDoHistorico(f.quando, novo, volta, relogio, degrau);
    const { data: atualizado, error: erroUpd } = await supabaseGerador
      .from('agendamentos')
      .update({
        quando: novo,
        // So o VERMELHO volta pra `agendado`. O esquecido ja e, e o card em
        // negociacao mantem o status dele: e ele que diz onde o cliente esta
        // no funil, e e ele que esconde a ficha dos robos que falam.
        ...(f.status === 'nao_atendeu' ? { status: 'agendado' } : {}),
        // Os dois carimbos que calariam o dia novo. Quem fala com o cliente é o
        // `solarAgendaGiovanna` (bom dia às 7h e "oi" 5 min antes), e ele só fala
        // enquanto estes dois estão nulos.
        //
        // `boas_vindas_at` NÃO é limpo de propósito: ele é do fluxo de cadastro
        // ("bem-vindo, seu consultor é X"), que já aconteceu. Zerar traria uma
        // boas-vindas repetida pra quem é cliente desde julho.
        // O CARD ESQUECIDO NAO DESTRAVA AS MENSAGENS. A ligacao dele pode ter
        // acontecido e ido bem — o que faltou foi alguem fechar o card. Zerar
        // `bomdia_at` faria a regua da agenda mandar "bom dia, hoje tem ligacao"
        // pra quem ja conversou ontem. O vermelho destrava, porque ali o nao
        // comparecimento e fato que alguem registrou.
        ...(f.status === 'nao_atendeu' ? { bomdia_at: null, lembrete_5min_at: null } : {}),
        confirmacao_at: null,
        lembrete_1h_at: null,
        historico: f.historico ? `${linha}\n\n${f.historico}` : linha,
      })
      // Corrida com gente: mexeu no status entre a leitura e agora? quem manda
      // é a pessoa, e o update não pega linha nenhuma.
      .eq('id', f.id)
      // O status que FOI LIDO: o modulo passou a pegar `agendado` tambem.
      .eq('status', String(f.status))
      .select('id');
      if (erroUpd) {
        // 23505 = índice único: o horário foi ocupado por fora. Marca ele como
        // ocupado na agenda em memória e tenta o seguinte.
        if (String((erroUpd as { code?: string }).code) === '23505') {
          logger.info('solar-reagenda', `horário ${novo} já ocupado — tenta o seguinte`, { id: f.id, dono });
          ocupado.push({ ini: new Date(novo).getTime(), dur: DUR_LIGACAO_MS });
          continue;
        }
        logger.error('solar-reagenda', 'mover o card falhou', {
          id: f.id, codigo: String((erroUpd as { code?: string }).code || '?'),
          erro: String(erroUpd.message || erroUpd),
        });
        erros++;
        break;
      }
      if (!atualizado?.length) {
        logger.info('solar-reagenda', `card ${f.id} saiu do vermelho no meio do caminho — quem manda é a pessoa`);
        break;
      }

      const nowIso = new Date().toISOString();
      await supabase.from('system_state').upsert(
        {
          key: `${SOLAR_REAGENDA_PREFIX}${f.id}`,
          // `relogio` é o que separa as duas rampas.
          // `status` e `degrau` sao a escada: a etiqueta desta volta e o degrau em
          // que ela caiu. A proxima rodada compara a etiqueta de entao com esta.
          value: {
            n: volta, ultimo: nowIso, de: f.quando,
            relogio: relogio === 'fala' ? 'fala' : 'mudo',
            status: String(f.status), degrau,
          },
          updated_at: nowIso,
        },
        { onConflict: 'key' },
      ).then(undefined, (e: unknown) =>
        logger.error('solar-reagenda', 'carimbo do ciclo falhou', { id: f.id, erro: String(e) }));

      // A agenda em memória aprende o que acabou de ser gravado. Com
      // `POR_TICK = 1` a rodada para no primeiro card que anda, então HOJE isto
      // não muda nada: é a guarda pro dia em que mais de um card se mover na
      // mesma rodada, que senão mirariam o mesmo horário. Quem consertou as 8
      // colisões de 01/10 foi a denylist lá em cima, que fez a varredura ver o
      // horário ocupado, mais o laço de horários aqui.
      futura.push({
        quando: novo, vendedor_nome: dono,
        cliente_telefone: f.cliente_telefone, created_by: f.created_by,
      });
      if (chave) comHorarioFuturo.add(chave);

      remarcados++;
      moveu = true;
      logger.info('solar-reagenda', `card ${f.id} (${dono}) voltou pra ${novo}, volta ${volta}/${maxVoltas()}`);
    }
    if (!novo) {
      logger.info('solar-reagenda', `sem vaga na agenda do ${dono} em ${HORIZONTE_DIAS_UTEIS} dias úteis`);
    }
  }

  if (dry) return { remarcados: 0, erros: 0, motivo: previa.length ? 'remarcaria_agora' : 'sem_vaga', previa };
  return { remarcados, erros };
}
