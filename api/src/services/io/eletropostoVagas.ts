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
//   · 10:00, 11:00 e 13:00 às 18:00, de hora em hora — 8 horários por dia
//     (14/08/2026: era 13:00–17:00. A manhã voltou e a tarde esticou; as 12:00
//      ficam de fora porque é o almoço)
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

const BRT_TZ = 'America/Sao_Paulo';

// Feriado nacional vem de `utils/feriadosBR`, que CALCULA o ano inteiro. Era uma
// cópia escrita à mão que acabava em 2027 — a agenda abriria no Natal de 2028
// sem ninguém notar (03/09/2026).

/** Horas de INÍCIO da grade, em ordem, POR DIA DA SEMANA (19/08/2026).
 *
 *  Segunda tem a grade cheia — 8 horários, com manhã — porque ela acumula o fim
 *  de semana: sábado e domingo a agenda não abre e o anúncio continua rodando.
 *  De terça a sexta é só a tarde, 13:00 às 17:00, que é a metade do dia que não
 *  disputa com a agenda de solar dos sócios.
 *
 *  Lista explícita e não um intervalo porque a grade da segunda tem BURACO no
 *  almoço: 12:00 não existe. Espelha o `FAIXAS_SEGUNDA`/`FAIXAS_PADRAO` da LP —
 *  mudou lá, muda aqui, senão o robô oferece no WhatsApp horário que a página
 *  não vende. */
// 31/08/2026: de terça a sexta a tarde passou a ter as MEIAS-HORAS abertas
// (13:30, 14:30, 15:30, 16:30, 17:30), dobrando a capacidade de 5 para 10 por
// consultor. Ordem do Thiago, pra encaixar a semana que ficou represada quando a
// linha caiu no domingo e as 35 reuniões de segunda tiveram que ser diluídas.
//
// Passou a ser 'HH:MM' e não mais número de hora: a grade deixou de caber em hora
// cheia. A sobreposição continua sendo de ±30 min e usa `<` — então 13:00 e 13:30
// convivem (|30 min| não é MENOR que 30 min), que é exatamente o que faz a grade
// de meia em meia hora funcionar sem bloquear a si mesma.
const HORAS_SEGUNDA = ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const HORAS_PADRAO = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'];
/** A manhã que a segunda tem e os outros dias não. De hora em hora de propósito:
 *  10:30 e 11:30 são da vistoria de solar dos sócios, e abrir meia-hora aqui
 *  comeria a manhã deles. */
const HORAS_MANHA_ACUMULO = ['10:00', '11:00'];
const DIAS_UTEIS = new Set([1, 2, 3, 4, 5]);
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
 * Quantos dias fechados vêm IMEDIATAMENTE antes deste. Dois ou mais e o dia
 * seguinte é o que recebe o acúmulo.
 *
 * Olha no máximo uma semana pra trás: emenda maior que isso não existe no
 * calendário nacional, e sem teto um bug em `agendaAbre` viraria laço infinito.
 */
function diasFechadosAntes(ymd: string): number {
  let n = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(`${ymd}T12:00:00-03:00`);
    d.setUTCDate(d.getUTCDate() - i);
    if (agendaAbre(diaBRT(d))) break;
    n++;
  }
  return n;
}

/**
 * A grade daquele dia.
 *
 * A regra NÃO é "segunda-feira": é O DIA QUE ABSORVE A EMENDA. A manhã existe
 * na segunda porque sábado e domingo a agenda não abre enquanto o anúncio roda,
 * e tudo isso desemboca no primeiro dia útil (19/08, ordem do Thiago). Num
 * feriado de segunda quem herda o acúmulo é a terça — e até 03/09/2026 ela
 * herdava o acúmulo SEM herdar a manhã, que é o pior dos dois mundos.
 *
 * Feriado de 07/09/2026 (Independência, uma segunda) é o primeiro caso: a terça
 * 08/09 abre 10:00 e 11:00 além da tarde dela.
 *
 * A segunda continua com a lista fechada do Thiago, intocada. Os outros dias
 * GANHAM a manhã e mantêm a tarde de meia em meia hora — 12 horários por
 * consultor contra os 8 da segunda, que é o certo para um dia que acumula três.
 */
export const horasDoDia = (ymd: string): readonly string[] => {
  if (diaDaSemana(ymd) === 1) return HORAS_SEGUNDA;
  return diasFechadosAntes(ymd) >= 2 ? [...HORAS_MANHA_ACUMULO, ...HORAS_PADRAO] : HORAS_PADRAO;
};

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

export type Compromisso = { ts: number; dono: string };

/**
 * O horário está livre PARA ESTE CONSULTOR? Sobreposição, não igualdade: o que
 * está a menos de 30 min de distância ocupa o slot (a agenda tem reunião de solar
 * em horário quebrado, e comparar timestamp exato vendia por cima dela).
 */
export function livrePara(iso: string, dono: string, compromissos: Compromisso[]): boolean {
  const t = new Date(iso).getTime();
  return !compromissos.some(c => c.dono === dono && Math.abs(c.ts - t) < DURACAO_MS);
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
    const { data, error } = await supabaseGerador
      .from('agendamentos').select('quando, vendedor_nome, status, created_by')
      .gte('quando', deIso).lte('quando', ateIso)
      .not('status', 'in', '(cancelado,sem_interesse)')
      .limit(2000);
    if (error) throw error;
    // Resposta SEM erro e SEM corpo não é uma agenda vazia — é uma resposta que
    // não dá pra ler. Tratar como `[]` diria "está tudo livre" e o robô ofereceria
    // horário ocupado; a agenda do eletroposto nunca está literalmente vazia nos
    // próximos 21 dias, então null aqui é sempre falha, nunca fato.
    if (!data) throw new Error('resposta sem corpo');
    return data
      .filter(a => a.quando && a.vendedor_nome)
      // Vermelho de eletroposto não ocupa (19/08/2026): quem foi dado como NÃO
      // ATENDIDO devolveu o horário, na vitrine da LP e aqui. Se as duas listas
      // discordassem, a página venderia um slot que o robô continuaria achando
      // ocupado — e o lead que pedisse pra remarcar nunca receberia justamente o
      // horário que a página oferece pra todo mundo.
      .filter(a => !(a.status === 'nao_atendeu' && ehOrigemEletroposto(a.created_by)))
      .map(a => ({ ts: new Date(String(a.quando)).getTime(), dono: String(a.vendedor_nome) }));
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
  dono: string, quantas: number, opts: { agora?: number; ignorarIso?: string | null } = {},
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
    for (const h of horasDoDia(ymd)) {
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
