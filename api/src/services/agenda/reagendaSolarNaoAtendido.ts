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
import { GRADE_NILCE } from './nilceParaGiovanna';

const TZ = 'America/Sao_Paulo';

/** Estado do ciclo: `solar_reagenda:<id>` → { n, ultimo, de }. */
export const SOLAR_REAGENDA_PREFIX = 'solar_reagenda:';

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
/** Piso: card com horário anterior a isto nunca é movido. */
const inicioPiso = (): string =>
  (process.env.SOLAR_REAGENDA_INICIO || '').trim() || '2026-05-01T00:00:00.000Z';
/** Quantos dias pra trás enxergar. 365 cobre a base toda sem virar "sem limite". */
const janelaDias = (): number => num('SOLAR_REAGENDA_JANELA_DIAS', 365);
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
export const DESTINO_FINAL_SOLAR = new Set<string>([
  'fechou', 'sem_interesse', 'cancelado', 'perdido', 'fechou_concorrente',
]);
/** Roda, e com qual relogio. `null` = parou de rodar. */
export function relogioDoCicloSolar(status: string): 'fala' | 'esquecido' | 'negocia' | null {
  if (DESTINO_FINAL_SOLAR.has(status) || status === 'apalavrado') return null;
  if (status === 'nao_atendeu') return 'fala';
  if (status === 'agendado') return 'esquecido';
  return 'negocia';
}
/** Uma por tick: duas no mesmo passo poderiam mirar o mesmo horário. */
const POR_TICK = 1;
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

/** Dia útil é segunda a sábado, sem feriado. Sábado entra: a agenda do solar
 *  trabalha sábado (é o que a grade da LP vende). */
function ehDiaUtil(ymd: string): boolean {
  const dow = new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
  return dow !== 0 && !ehFeriadoBR(ymd);
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
export function linhaDoHistorico(deIso: string, paraIso: string, volta: number): string {
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
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
    .not('status', 'in', `(${[...DESTINO_FINAL_SOLAR, 'apalavrado'].join(',')})`)
    .gte('quando', de)
    .lte('quando', ate)
    .order('quando', { ascending: false })
    .limit(1000);
  if (error) {
    logger.error('solar-reagenda', 'ler os nao_atendeu falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const corteEsquecido = new Date(agora - esquecidoH() * 3600_000).toISOString();
  const corteNegociacao = new Date(agora - negociacaoH() * 3600_000).toISOString();
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
  const voltasDe = new Map<number, number>();
  for (const r of estadosQ.data ?? []) {
    const id = Number(String(r.key).slice(SOLAR_REAGENDA_PREFIX.length));
    const n = Number((r.value as { n?: number } | null)?.n);
    if (Number.isInteger(id) && Number.isFinite(n)) voltasDe.set(id, n);
  }

  // Sem teto pro esquecido: "sempre tera os clientes retornando". O teto segue
  // valendo pro vermelho, cujo ciclo destrava as mensagens da regua da agenda.
  const naVez = vermelhos.filter(f =>
    f.status !== 'nao_atendeu' || (voltasDe.get(f.id) ?? 0) < maxVoltas());
  if (!naVez.length) return zero('ninguem_na_vez');

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
  const desdeIso = new Date(inicioDoDiaBRT).toISOString();
  const jaHoje = (feitosHoje.data || []).filter(r => {
    const u = String((r as { value?: { ultimo?: string } }).value?.ultimo || '');
    return !!u && u >= desdeIso;
  }).length;
  logger.info('solar-reagenda', `rampa: ${jaHoje}/${tetoPorDia()} hoje (desde ${desdeIso}), ${(feitosHoje.data || []).length} carimbos`);
  // O modo seco ATRAVESSA a rampa, do mesmo jeito que atravessa a janela de
  // horário. Na primeira versão ele parava aqui, e isso escondeu justamente o que
  // eu fui conferir: com a rampa cheia, `?dry=1` respondia `rampa_do_dia_cheia` e
  // mais nada, sem dizer quem seria movido nem se a fila ainda existia. Prévia
  // que só funciona quando o módulo já podia agir não serve pra conferir nada.
  if (!dry && jaHoje >= tetoPorDia()) {
    logger.info('solar-reagenda', `rampa do dia cheia (${jaHoje}/${tetoPorDia()})`);
    return zero('rampa_do_dia_cheia');
  }

  const cabemHoje = dry ? POR_TICK : Math.min(POR_TICK, tetoPorDia() - jaHoje);
  const alvos = naVez.slice(0, cabemHoje);
  if (!alvos.length) return zero('rampa_do_dia_cheia');

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
    .in('status', ['agendado', 'nao_atendeu', 'em_atendimento', 'falando_whatsapp'])
    .limit(1000);
  if (futuraQ.error) {
    logger.error('solar-reagenda', 'ler a agenda futura falhou — não inventa horário', futuraQ.error);
    return { ...zero('erro_agenda'), erros: 1 };
  }
  const futura = (futuraQ.data ?? []) as Array<{
    quando: string; vendedor_nome: string | null; cliente_telefone: string | null; created_by: string | null;
  }>;
  const comHorarioFuturo = new Set(
    futura.map(f => telKey(f.cliente_telefone)).filter(Boolean) as string[]);

  let remarcados = 0, erros = 0;
  const previa: NonNullable<ResultadoReagendaSolar['previa']> = [];

  for (const f of alvos) {
    const dono = String(f.vendedor_nome);
    const chave = telKey(f.cliente_telefone);
    // Já tem ligação marcada? Mover criaria a mesma pessoa em dois lugares.
    if (chave && comHorarioFuturo.has(chave)) continue;

    const ocupado = futura
      .filter(o => o.vendedor_nome === dono)
      .map(o => ({ ini: new Date(o.quando).getTime(), dur: duracaoDe(o.created_by) }));
    const dias = proximosDiasUteis(ymdSP(new Date(agora)), HORIZONTE_DIAS_UTEIS);
    const novo = primeiraVaga(ocupado, agora, dias);
    if (!novo) {
      logger.info('solar-reagenda', `sem vaga na agenda do ${dono} em ${HORIZONTE_DIAS_UTEIS} dias úteis`);
      continue;
    }
    const volta = (voltasDe.get(f.id) ?? 0) + 1;

    if (dry) {
      previa.push({
        id: f.id, cliente: f.cliente_nome || '(sem nome)', dono,
        de: horaBonita(f.quando), para: horaBonita(novo), volta,
      });
      continue;
    }

    const linha = linhaDoHistorico(f.quando, novo, volta);
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
      logger.error('solar-reagenda', 'mover o card falhou', { id: f.id, erro: String(erroUpd.message || erroUpd) });
      erros++;
      continue;
    }
    if (!atualizado?.length) {
      logger.info('solar-reagenda', `card ${f.id} saiu do vermelho no meio do caminho — quem manda é a pessoa`);
      continue;
    }

    const nowIso = new Date().toISOString();
    await supabase.from('system_state').upsert(
      { key: `${SOLAR_REAGENDA_PREFIX}${f.id}`, value: { n: volta, ultimo: nowIso, de: f.quando }, updated_at: nowIso },
      { onConflict: 'key' },
    ).then(undefined, (e: unknown) =>
      logger.error('solar-reagenda', 'carimbo do ciclo falhou', { id: f.id, erro: String(e) }));

    remarcados++;
    logger.info('solar-reagenda', `card ${f.id} (${dono}) voltou pra ${novo}, volta ${volta}/${maxVoltas()}`);
  }

  if (dry) return { remarcados: 0, erros: 0, motivo: previa.length ? 'remarcaria_agora' : 'sem_vaga', previa };
  return { remarcados, erros };
}
