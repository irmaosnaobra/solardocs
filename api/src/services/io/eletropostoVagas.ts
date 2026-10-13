// ─────────────────────────────────────────────────────────────────────────────
// QUAIS HORÁRIOS DA AGENDA DO ELETROPOSTO ESTÃO LIVRES — versão do SERVIDOR.
//
// Esta régua já existia, mas só dentro do navegador: a LP (`/io/eletroposto`)
// calcula a vitrine em JavaScript, lendo `agendamentos` direto do Supabase com a
// chave anônima. Enquanto o único jeito de marcar fosse a página, isso bastava.
// Deixou de bastar quando o robô passou a remarcar sozinho no WhatsApp: robô não
// tem navegador, e "que horários sobraram" é a pergunta central dele.
//
// É uma PORTA da régua da LP, não uma régua nova. Os números são os mesmos e
// estão aqui pelos mesmos motivos (a LP tem o histórico completo de cada um):
//   · 08:00 às 17:30, de meia em meia hora, com o almoço travado das 12:00 às
//     13:30 — 17 horários por dia, a MESMA grade de segunda a sexta (13/10/2026,
//     ordem do dono; o histórico das viradas anteriores está no bloco da grade)
//   · segunda a sexta; sábado, domingo e feriado fechados
//   · 30 min de folga mínima: o consultor monta o estudo antes de entrar na call
//   · reunião ocupa 30 min, então compromisso a menos de 30 min de distância
//     fecha o horário PARA AQUELE consultor (a agenda tem solar em horário
//     quebrado — 14:15, 16:15 — e ignorar isso vende por cima da reunião dele)
//
// ── A diferença que importa ──
// A LP pergunta "sobrou vaga pra ALGUÉM?" (o slot só fecha com os dois ocupados,
// e ela escolhe o dono na hora de gravar). Aqui a pergunta é sempre "sobrou vaga
// pro CONSULTOR DESTA FICHA?" — quem remarca continua com quem já estava marcado
// (ordem do dono, 13/08/2026). Remanejar de consultor mexeria na divisão que a
// `processar_repasses()` faz entre Thiago e Diego, e isso é decisão de gente.
//
// ── Se as duas réguas divergirem ──
// A LP é a fonte da VENDA e esta é a fonte do REMARCAR. Mudou a grade lá? Mude
// aqui junto. O pior caso de divergência é benigno mas confuso: o robô oferece um
// horário que a LP não venderia (ou o contrário), e o slot continua sendo checado
// contra a agenda real na hora de gravar — ninguém marca por cima de ninguém.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { agendaFechadaEm } from '../agenda/agendaFechada';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { FILTRO_NAO_OCUPA } from '../agenda/salaDeEspera';
import { ocupacoesSolar } from '../agenda/solarOcupacao';

const BRT_TZ = 'America/Sao_Paulo';

// Feriado nacional vem de `utils/feriadosBR`, que CALCULA o ano inteiro. Era uma
// cópia escrita à mão que acabava em 2027 — a agenda abriria no Natal de 2028
// sem ninguém notar (03/09/2026).

// ── A GRADE DE LEAD NOVO (13/10/2026) ────────────────────────────────────────
//
// Ordem do dono: "agora teremos vagas no quiz das 08 às 17:30" e "trava a agenda
// para almoço das 12:00 às 13:30". Um horário só, igual de segunda a sexta:
// 08:00 às 17:30 de 30 em 30 minutos, menos o que COMEÇA no almoço (12:00, 12:30
// e 13:00). São 17 horários por consultor por dia.
//
// A exceção da segunda (hora em hora, até 18:00) e a manhã do "dia que absorve a
// emenda" acabaram. Elas existiam porque a manhã era do solar dos sócios e o
// acúmulo do fim de semana precisava de capacidade; a manhã voltou porque o solar
// deles não toma mais a manhã inteira, e quem resolve o choque de horário é a
// ocupação (`livrePara`, que lê a visita de solar com a duração real dela).
//
// Histórico das grades anteriores: 14/08 (10:00, 11:00 e 13:00–18:00 na segunda),
// 19/08 (só a tarde de terça a sexta), 31/08 (meias-horas à tarde) e 03/09 (manhã
// no dia que herda a emenda). O passo é 'HH:MM' e não número de hora porque a
// sobreposição de ±30 min usa `<`: 13:30 e 14:00 convivem (|30 min| não é MENOR
// que 30 min), que é o que faz a meia hora funcionar sem bloquear a si mesma.
//
// A LP (`/io/eletroposto`) tem o gêmeo disto (`GRADE_NOVO`). Mudou lá, muda aqui:
// `eletropostoGradeEspelho.test.ts` roda os dois lado a lado.
const GRADE_INICIO_MIN = 8 * 60;              // 08:00
const GRADE_FIM_MIN = 17 * 60 + 30;           // 17:30, o último começo
/** O almoço travado: horário que COMEÇA em [12:00, 13:30) não existe. */
const ALMOCO_INICIO_MIN = 12 * 60;
const ALMOCO_FIM_MIN = 13 * 60 + 30;
const DIAS_UTEIS = new Set([1, 2, 3, 4, 5]);

const emMinutos = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const deMinutos = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** O horário de INÍCIO cai no almoço? `hhmm` é 'HH:MM' em Brasília. Vale para
 *  as duas faixas: 12:00, 12:30 e 13:00 (novo) e 12:15, 12:45 e 13:15 (remarcação).
 *  É também a validação da criação em lote. A LP tem a cópia (`ehHorarioDeAlmoco`). */
export function ehHorarioDeAlmoco(hhmm: string): boolean {
  const m = emMinutos(hhmm);
  return m >= ALMOCO_INICIO_MIN && m < ALMOCO_FIM_MIN;
}

/** De `ini` a `fim` (minutos do dia) de 30 em 30, sem o que começa no almoço. */
const gerarHoras = (ini: number, fim: number): readonly string[] => {
  const out: string[] = [];
  for (let m = ini; m <= fim; m += 30) {
    const h = deMinutos(m);
    if (!ehHorarioDeAlmoco(h)) out.push(h);
  }
  return out;
};

/** 08:00 09:00 … 11:30 e 13:30 … 17:30: 17 horários, todo dia útil. */
const HORAS_NOVO: readonly string[] = gerarHoras(GRADE_INICIO_MIN, GRADE_FIM_MIN);

// ── DUAS FAIXAS NA MESMA GRADE (30/09/2026) ────────────────────────────────
//
// Ordem do Thiago: "clientes novos de agenda ocupará hora e hora e meia, os
// clientes remarcados e followups hora e quinze e hora e quarenta e cinco".
//
// Ou seja: o lead NOVO cai em :00 e :30 (a grade que a LP vende), e quem já é
// nosso — remarcação e follow-up — cai nos quinze no meio. O ganho é que a
// remarcação para de comer o horário que a vitrine estava vendendo pra lead
// novo, que é o recurso escasso.
//
// A FAIXA DE REMARCAÇÃO É DERIVADA, não escrita à mão: `+15 min` em cima da
// grade do dia. Escrever uma segunda lista literal seria criar duas fontes da
// verdade pra mesma coisa, e a de cima já precisa espelhar a LP ("mudou lá,
// muda aqui"). Derivando, mexer na grade nova mexe nas duas faixas juntas.
// ── A FAIXA DE FOLLOW-UP VALE O DIA INTEIRO (30/09/2026, mesma tarde) ──────
//
// Ordem do Thiago, logo depois de ver a primeira versão: "a agenda para
// follow-up vai ficar liberada todo o período, das 8h15 até as 17h45. Como elas
// estão espalhadas aí por hora e 15, hora e 45, pode ficar marcado durante todo
// o dia".
//
// A PRIMEIRA VERSÃO DERIVAVA a faixa da grade do dia (`+15 min`), e eu defendi
// isso aqui mesmo como "uma fonte da verdade só". Estava errado para o que ele
// quer: derivando, a terça só teria follow-up das 13:15 às 17:45, porque a
// grade de venda da tarde começa às 13:00. A manhã inteira ficaria fechada para
// remarcar, e remarcação não disputa horário de vitrine nenhuma — ela vive nos
// quinze, onde a LP nunca vende.
//
// Então a faixa de follow-up passa a ser uma grade PRÓPRIA e fixa, e não um
// espelho da de venda: 08:15 às 17:45, de 30 em 30 minutos, todo dia útil.
//
// O ALMOÇO SAIU EM 13/10/2026. Até então esta faixa pulava o almoço de propósito
// ("durante todo o dia"); a ordem de travar a agenda das 12:00 às 13:30 vale para
// ela também, então 12:15, 12:45 e 13:15 deixaram de existir. São 17 horários por
// consultor por dia (8 de manhã, 9 à tarde), os mesmos 17 da faixa de lead novo.
const FOLLOWUP_INICIO_MIN = 8 * 60 + 15;      // 08:15
const FOLLOWUP_FIM_MIN = 17 * 60 + 45;        // 17:45, o último começo
const HORAS_FOLLOWUP: readonly string[] = gerarHoras(FOLLOWUP_INICIO_MIN, FOLLOWUP_FIM_MIN);

/** Qual faixa da grade este horário ocupa. `novo` é o padrão em todo lugar: quem
 *  é remarcação sabe que é, quem não sabe é lead novo. */
export type FaixaAgenda = 'novo' | 'remarcacao';

/**
 * Quanto ESTE compromisso ocupa em volta dele.
 *
 * ERA 30 MIN PARA TUDO, e é por isso que esta função existe agora. Com a régua
 * antiga, a faixa de remarcação seria impossível de usar: 14:15 fica a 15 min de
 * 14:00 E de 14:30, então `|15| < 30` recusaria o horário nos dois lados e o robô
 * nunca acharia vaga nenhuma pra remarcar. É essa conta que obriga a regra do
 * Thiago a ser código, e não só uma lista de horários nova.
 *
 * A folga cai pra 15 min quando o compromisso é reunião NOSSA em horário da
 * grade (:00, :15, :30, :45). Vale nos dois sentidos, e tem que valer: a
 * remarcação das 14:15 precisa passar por cima do lead novo das 14:00, e o lead
 * novo das 14:00 precisa continuar cabendo com a remarcação das 14:15 já
 * marcada. Se a régua olhasse só o lado da remarcação, a primeira das duas a ser
 * marcada trancaria a outra, e qual delas depende da ordem de chegada — o pior
 * tipo de bug de agenda, porque só aparece em metade dos dias.
 *
 * A PRIMEIRA VERSÃO OLHAVA SÓ O MINUTO e um teste pegou: reunião de SOLAR do
 * Meta cai em horário quebrado, e 13:15 é dos mais comuns lá. Pelo minuto ela
 * passaria por remarcação, encolheria pra 15 min e o robô marcaria eletroposto
 * às 13:00 por cima de uma reunião que já existe. Quem separa é a ORIGEM da
 * ficha, não o relógio — e é a mesma bandeira `ep` que a vitrine usa no
 * `donosLivres`, porque as duas pontas têm que concordar.
 */
const NA_GRADE = new Set([0, 15, 30, 45]);
const naGrade = (ts: number): boolean =>
  // BRT é UTC-3 cheio, então o minuto em UTC é o mesmo de Brasília.
  NA_GRADE.has(new Date(ts).getUTCMinutes());
export function folgaDoCompromisso(c: Compromisso): number {
  return c.ep && naGrade(c.ts) ? 15 * 60 * 1000 : DURACAO_MS;
}

/**
 * Quanto tempo este compromisso realmente dura.
 *
 * A VISTORIA DE SOLAR LEVA 1 HORA: o sócio entra no carro e fica uma hora na
 * casa do lead. A vitrine já sabia (`DUR_VISTORIA_MS`), o servidor não, e até
 * 30/09/2026 ele protegia só os 30 min iniciais. A faixa nova de :15/:45
 * piorou o buraco, porque acrescentou dois horários por hora que caem dentro
 * da visita.
 */
export function duracaoDoCompromisso(c: Compromisso): number {
  return c.vistoria ? 60 * 60 * 1000 : DURACAO_MS;
}
/** Duração da reunião — é ela que define sobreposição, não o passo da grade. */
const DURACAO_MS = 30 * 60 * 1000;
/** Folga mínima: sem ela o lead marca pra daqui a 10 min e o consultor entra sem estudo. */
const ANTECEDENCIA_MIN_MS = 30 * 60 * 1000;
/** Teto da varredura. 21 dias é o mesmo da LP — não existe agenda vazia por 3 semanas. */
const DIAS_VARRIDOS = 21;

/** "2026-08-13" no fuso de Brasília (`en-CA` já sai nesse formato e ordena como texto). */
export function diaBRT(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(d));
}

/** ISO de um horário de Brasília. `-03:00` fixo: o Brasil não tem horário de verão desde 2019. */
const isoDe = (ymd: string, hora: string): string =>
  new Date(`${ymd}T${hora}:00-03:00`).toISOString();

/** Dia da semana (0=dom) do YMD, lido ao meio-dia pra não escorregar no fuso. */
const diaDaSemana = (ymd: string): number => new Date(`${ymd}T12:00:00-03:00`).getUTCDay();

/**
 * A grade daquele dia (13/10/2026): a MESMA em todo dia útil, para as duas faixas.
 * Lead novo: 17 horários de :00 e :30; remarcação: 17 horários de :15 e :45. Nenhum
 * começa no almoço (12:00 às 13:30). O `ymd` ficou na assinatura porque quem chama
 * já passa o dia, e porque a grade pode voltar a variar por dia; hoje ele não pesa.
 */
export const horasDoDia = (_ymd: string, faixa: FaixaAgenda = 'novo'): readonly string[] =>
  faixa === 'remarcacao' ? HORAS_FOLLOWUP : HORAS_NOVO;

/** A agenda abre neste dia? (dia útil, não feriado e sem bloqueio pontual)
 *
 *  O terceiro termo é o dos dias em que os sócios estão FORA (`agendaFechada`)
 *  (25–27/08/2026). Ele mora no `agendaFechada` e não numa constante daqui porque
 *  as mesmas datas fecham a vitrine das duas LPs, os toques da régua de avisos e a
 *  gravação nas rotas: cinco lugares, uma lista. Fechar só aqui faria o robô parar
 *  de oferecer os dias que a página continuaria vendendo. */
export function agendaAbre(ymd: string): boolean {
  return !ehFeriadoBR(ymd) && !agendaFechadaEm(ymd) && DIAS_UTEIS.has(diaDaSemana(ymd));
}

/** `ep` diz se a reunião é de ELETROPOSTO (faixa de remarcação), `vistoria` diz
 *  se é a visita de solar, que leva 1 hora. Ver `folgaDoCompromisso`. */
export type Compromisso = {
  ts: number; dono: string; ep?: boolean; vistoria?: boolean;
  /** O bloco pronto (07/10/2026): a visita do quiz solar ocupa da saída à volta
   *  do sócio, então ela traz o próprio começo e fim. Quando vem, manda. */
  ini?: number; fim?: number;
};

/**
 * O horário está livre PARA ESTE CONSULTOR? Sobreposição, não igualdade: o que
 * está a menos de 30 min de distância ocupa o slot (a agenda tem reunião de solar
 * em horário quebrado, e comparar timestamp exato vendia por cima dela).
 */
export function livrePara(iso: string, dono: string, compromissos: Compromisso[]): boolean {
  const t = new Date(iso).getTime();
  return !compromissos.some(c => {
    if (c.dono !== dono) return false;
    // Bloco pronto (visita do quiz solar, com a estrada): sobreposição pura.
    if (typeof c.ini === 'number' && typeof c.fim === 'number') return c.ini < t + DURACAO_MS && t < c.fim;
    // Reunião NOSSA na grade: a régua é DISTÂNCIA, e é ela que deixa a faixa de
    // remarcação conviver com a de venda (14:00 e 14:15 no mesmo consultor).
    if (c.ep && naGrade(c.ts)) return Math.abs(c.ts - t) < folgaDoCompromisso(c);
    // Qualquer outra coisa: SOBREPOSIÇÃO DE BLOCOS, com a duração real dela.
    //
    // Distância simétrica estava errada aqui e criaria discordância nova com a
    // vitrine: uma vistoria de 1h às 13:30 ocupa [13:30,14:30), então ela NÃO
    // pega as 13:00 (que acabam justo quando ela começa). Medindo distância, 30
    // min de |13:00 - 13:30| entraria numa folga de 60 e o servidor recusaria um
    // horário que a LP vende. Bloco contra bloco é o que as duas pontas falam.
    return c.ts < t + DURACAO_MS && t < c.ts + duracaoDoCompromisso(c);
  });
}

/**
 * Os compromissos de Thiago e Diego numa janela. Cancelado e sem_interesse não
 * ocupam — o horário de quem desistiu volta pra agenda.
 *
 * Erro de leitura devolve `null`, e quem chama PARA. Devolver lista vazia diria
 * "a agenda inteira está livre" e o robô ofereceria horário ocupado: pior que
 * não oferecer nada.
 */
export async function carregarCompromissos(deIso: string, ateIso: string): Promise<Compromisso[] | null> {
  try {
    const [{ data, error }, solar] = await Promise.all([
      supabaseGerador
        .from('agendamentos').select('quando, vendedor_nome, status, created_by')
        .gte('quando', deIso).lte('quando', ateIso)
        .not('status', 'in', FILTRO_NAO_OCUPA)
        .limit(2000),
      // As fichas da LP do solar com o bloco pronto, inclusive as marcadas fora
      // da janela que ocupam tempo dentro dela (manhã de rota). Mesma leitura da
      // vitrine do eletroposto e do formulário do Meta.
      ocupacoesSolar(deIso, ateIso),
    ]);
    if (error) throw error;
    // Sem a leitura do solar o robô PARA, como em qualquer outra falha de
    // leitura: oferecer um horário com o sócio na estrada é pior que esperar.
    if (solar === null) throw new Error('leitura das fichas do solar falhou');
    // Resposta SEM erro e SEM corpo não é uma agenda vazia — é uma resposta que
    // não dá pra ler. Tratar como `[]` diria "está tudo livre" e o robô ofereceria
    // horário ocupado; a agenda do eletroposto nunca está literalmente vazia nos
    // próximos 21 dias, então null aqui é sempre falha, nunca fato.
    if (!data) throw new Error('resposta sem corpo');
    const lista: Compromisso[] = data
      .filter(a => a.quando && a.vendedor_nome)
      .filter(a => String(a.created_by || '') !== 'lp_solar')   // entram pela leitura do solar
      // Vermelho de eletroposto não ocupa (19/08/2026): quem foi dado como NÃO
      // ATENDIDO devolveu o horário, na vitrine da LP e aqui. Se as duas listas
      // discordassem, a página venderia um slot que o robô continuaria achando
      // ocupado — e o lead que pedisse pra remarcar nunca receberia justamente o
      // horário que a página oferece pra todo mundo.
      .filter(a => !(a.status === 'nao_atendeu' && ehOrigemEletroposto(a.created_by)))
      .map(a => ({
        ts: new Date(String(a.quando)).getTime(),
        dono: String(a.vendedor_nome),
        ep: ehOrigemEletroposto(a.created_by),
      }));
    for (const s of solar) lista.push({ ts: s.quando, dono: s.dono, ep: false, vistoria: true, ini: s.ini, fim: s.fim });
    return lista;
  } catch (err) {
    logger.error('ep-vagas', 'ler compromissos falhou', err);
    return null;
  }
}

/**
 * As próximas N vagas do consultor, em ordem, a partir de agora + folga mínima.
 *
 * `ignorarIso` tira da conta o compromisso da própria ficha que está remarcando —
 * senão o horário atual dela apareceria como ocupado por ela mesma e o robô nunca
 * ofereceria o slot vizinho. (Não muda nada pro slot em si: o horário atual está
 * fora da oferta de qualquer jeito, porque quem pediu pra remarcar não quer ele.)
 */
export async function proximasVagas(
  dono: string, quantas: number,
  opts: { agora?: number; ignorarIso?: string | null; faixa?: FaixaAgenda } = {},
): Promise<string[] | null> {
  const agora = opts.agora ?? Date.now();
  const limite = agora + ANTECEDENCIA_MIN_MS;
  const fim = agora + DIAS_VARRIDOS * 86400_000;

  const compromissos = await carregarCompromissos(new Date(agora).toISOString(), new Date(fim).toISOString());
  if (compromissos === null) return null;

  const ignorar = opts.ignorarIso ? new Date(opts.ignorarIso).getTime() : null;
  const relevantes = ignorar === null
    ? compromissos
    : compromissos.filter(c => !(c.dono === dono && c.ts === ignorar));

  const vagas: string[] = [];
  for (let i = 0; i < DIAS_VARRIDOS && vagas.length < quantas; i++) {
    const ymd = diaBRT(agora + i * 86400_000);
    if (!agendaAbre(ymd)) continue;
    for (const h of horasDoDia(ymd, opts.faixa ?? 'novo')) {
      if (vagas.length >= quantas) break;
      const iso = isoDe(ymd, h);
      const t = new Date(iso).getTime();
      if (t < limite) continue;
      // O horário ATUAL da ficha nunca entra na lista. Ele está fora da conta de
      // ocupação (`relevantes`) justamente pra não bloquear os vizinhos — e sem
      // esta linha isso o faria aparecer como vaga, oferecendo à pessoa exatamente
      // o horário que ela acabou de dizer que não dá.
      if (ignorar !== null && t === ignorar) continue;
      if (livrePara(iso, dono, relevantes)) vagas.push(iso);
    }
  }
  return vagas;
}

/**
 * O horário ainda está livre pro consultor AGORA? Última checagem, feita no
 * instante de gravar. Entre oferecer e o lead responder passam minutos ou horas —
 * tempo de sobra pra outra pessoa marcar aquele slot na LP.
 */
export async function aindaLivre(iso: string, dono: string, ignorarIso?: string | null): Promise<boolean> {
  const t = new Date(iso).getTime();
  const compromissos = await carregarCompromissos(
    new Date(t - DURACAO_MS).toISOString(), new Date(t + DURACAO_MS).toISOString());
  if (compromissos === null) return false;   // não deu pra conferir: não grava
  const ignorar = ignorarIso ? new Date(ignorarIso).getTime() : null;
  return livrePara(iso, dono, ignorar === null
    ? compromissos
    : compromissos.filter(c => !(c.dono === dono && c.ts === ignorar)));
}
