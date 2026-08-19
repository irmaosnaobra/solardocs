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

const BRT_TZ = 'America/Sao_Paulo';

/** Feriados nacionais — cópia da lista da LP. Data que some daqui vira dia útil. */
const FERIADOS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01',
  '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01',
  '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25',
]);

/** Horas de INÍCIO da grade, em ordem. Lista explícita e não um intervalo porque a
 *  grade tem BURACO no almoço: 12:00 não existe. A primeira reunião do dia começa
 *  10:00 e a última, 18:00. Espelha o `FAIXAS` da LP. */
const HORAS = [10, 11, 13, 14, 15, 16, 17, 18];
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
const isoDe = (ymd: string, hora: number): string =>
  new Date(`${ymd}T${String(hora).padStart(2, '0')}:00:00-03:00`).toISOString();

/** Dia da semana (0=dom) do YMD, lido ao meio-dia pra não escorregar no fuso. */
const diaDaSemana = (ymd: string): number => new Date(`${ymd}T12:00:00-03:00`).getUTCDay();

/** A agenda abre neste dia? (dia útil e não feriado) */
export function agendaAbre(ymd: string): boolean {
  return !FERIADOS.has(ymd) && DIAS_UTEIS.has(diaDaSemana(ymd));
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
    for (const h of HORAS) {
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
