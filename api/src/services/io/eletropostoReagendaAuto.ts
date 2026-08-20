// ─────────────────────────────────────────────────────────────────────────────
// O CARD FICOU VERMELHO E O HORÁRIO PASSOU — a ficha sai limpa e volta pro dia
// seguinte, sozinha.
//
// Ordem do Thiago (20/08/2026): "quando o cliente de eletroposto receber os
// contatos e ficar vermelho, quando passar o horário dele, ele sai limpo e
// agendado para o outro dia e recebe novamente os recados — e assim até o
// terceiro dia."
//
// Perguntei se "até o terceiro dia" eram 2 ou 3 voltas e ele respondeu **"2
// dias"**. Então são DOIS reagendamentos: o dia da reunião perdida mais dois —
// três dias no total, que é o que a frase dele descreve.
//
// ── O que mudou em relação ao desenho de 19/08 ──
// Até aqui o vermelho virava uma LISTA DE HORÁRIOS no WhatsApp ("responde 1, 2
// ou 3") e esperava a pessoa escolher — o `eletropostoNoShow`, que este módulo
// substitui. Quem já não respondeu a quatro mensagens não responde a um menu:
// pedir escolha a quem está em silêncio é devolver pra ele exatamente o trabalho
// que ele não fez. Agora o robô ESCOLHE por ele. A reunião é remarcada de fato,
// a ficha volta a ser `agendado`, e toda a régua de avisos recomeça do zero — a
// pessoa recebe de novo os toques que ela já ignorou uma vez, só que apontando
// pra um dia que ainda vai acontecer.
//
// A porta de saída continua aberta e é a mesma de sempre: a mensagem diz "se não
// der, me fala o dia que fica melhor", e aí quem atende é o fluxo reativo do
// `eletropostoRemarcar` (que oferece horários e move a reunião pela escolha).
//
// ── O ciclo, e onde ele para ──
//   reunião perdida  →  +45 min  →  remarca pro PRÓXIMO DIA ÚTIL, mesmo horário
//                                   se estiver livre, mesmo consultor
//                    →  a régua da agenda manda bom dia, 1h e 5min
//                    →  ficou vermelho de novo? repete
//   DOIS reagendamentos e o robô para. A ficha fica vermelha e vira assunto de
//   gente (ou do convite do grupo de frios, que já pega quem não tem reunião
//   futura).
//
// ── Por que +45 min, e não "assim que o horário passar" ──
// O toque de 5 minutos SAI pra quem já está vermelho (é decisão de 14/08: calar
// a mensagem de maior intenção transformaria a previsão em profecia). Remarcar
// antes disso mandaria "é agora, ele já está te esperando" e, vinte minutos
// depois, "remarquei pra amanhã". 45 min é a mesma folga que a repescagem usava.
//
// ── Quem NÃO entra ──
//   · reunião anterior ao piso duro (`REAGENDA_INICIO`). Sem ele, ligar o módulo
//     remarcaria de uma vez os ~22 vermelhos parados no banco — o erro que já
//     custou caro no solar (87 fichas de uma vez);
//   · quem ESCREVEU depois de perder o horário: essa conversa tem dono e já
//     passa pelo `eletropostoRespostas`, que sabe remarcar conversando;
//   · quem já tem lista de horários na mesa (`ep_remarcar:<id>` das últimas 24h).
//     Mover a reunião por baixo de uma oferta aberta faria o "2" dele apontar
//     pra reunião errada;
//   · ficha sem consultor, sem telefone ou com a reunião perdida há mais de 7
//     dias (aí não é remarcação, é lista fria);
//   · quem já foi remarcado 2 vezes.
//
// Vermelho marcado por GENTE entra igual: o consultor que ficou esperando na
// chamada é o no-show clássico, e é dele que a ordem fala. O carimbo
// `ep_nao_atendeu_auto:` separa robô de humano só na hora de DESFAZER a marca
// (lá no agente de respostas), não aqui.
//
// ── A ordem das escritas (é ela que impede promessa falsa) ──
//   1. teto anti-ban da linha — estourou, ninguém é remarcado nesta rodada;
//   2. UPDATE da ficha (com `confirmacao_at` NULO) — é ele que conta a tentativa;
//   3. mensagem;
//   4. `confirmacao_at` = agora, que é o que impede a régua da agenda de mandar
//      a confirmação padrão em cima da nossa.
// Se o envio falhar entre 2 e 4, a reunião fica marcada e `confirmacao_at` fica
// nulo — a fila lenta da agenda manda a confirmação padrão no próximo tick. O
// pior caso é uma copy menos específica, nunca um horário que ninguém avisou.
//
// UMA pessoa por tick, das 9h às 19h, como contato NÃO transacional: ninguém
// escreveu pra gente, quem puxa é o robô. A linha IO já foi bloqueada duas vezes
// por rajada.
//
// Kill-switch: EP_REAGENDA_AUTO_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import {
  quandoPorExtenso, telefoneBonito, carregarConsultores,
  EP_AGENDA_PREFIX, EP_NAO_ATENDEU_PREFIX,
} from './eletropostoAgenda';
import { EP_REMARCAR_PREFIX } from './eletropostoRemarcar';
import { proximasVagas, diaBRT } from './eletropostoVagas';

const BRT_TZ = 'America/Sao_Paulo';

/** Estado do ciclo: `ep_reagenda_auto:<id>` → { n, ultimo, de }. */
export const EP_REAGENDA_PREFIX = 'ep_reagenda_auto:';

/** Piso duro: reunião perdida ANTES disto não é remarcada nunca. É o dia em que
 *  a régua entrou no ar — o estoque velho de vermelhos não vira disparo. */
const REAGENDA_INICIO = '2026-08-20T00:00:00.000Z';

/** "e assim até o terceiro dia" — e o Thiago fechou em **2 dias** quando
 *  perguntei (20/08). Então são DOIS reagendamentos: a reunião perdida mais duas
 *  voltas, três dias no total. Depois disso a ficha fica vermelha e e' assunto de
 *  gente. Este numero e' a conta de quantos slots vendaveis um lead que some pode
 *  consumir — mexer nele mexe em estoque de agenda, nao so' em mensagem. */
export const MAX_REAGENDAMENTOS = 2;
/** Folga depois do horário perdido — o toque de 5 min ainda estava saindo. */
const APOS_PERDER_MIN = 45;
/** Reunião perdida há mais de 7 dias não é remarcação, é lista fria. */
const JANELA_DIAS = 7;
/** Uma pessoa por tick: duas no mesmo passo poderiam mirar o mesmo slot. */
const POR_TICK = 1;
const JANELA_INICIO_H = 9;
const JANELA_FIM_H = 19;
/** Quantas vagas pedir pra escolher: uma grade cheia de segunda tem 8 horários,
 *  então 12 garante o dia inteiro mais folga pra cair no dia seguinte. */
const VAGAS_CONSULTADAS = 12;
/** Tentativas de gravação por ficha: o índice único é igualdade exata e a régua
 *  de vaga é sobreposição de 30 min — as duas podem discordar numa corrida com a
 *  LP. Três candidatos cobrem isso sem virar laço. */
const CANDIDATOS_MAX = 3;

const desligado = () => (process.env.EP_REAGENDA_AUTO_OFF || '').trim() === '1';

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}

/** A hora cheia (0-23) de um ISO no fuso de Brasília. */
function horaDoIso(iso: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: BRT_TZ })
    .format(new Date(iso));
  const n = Number(h);
  return n === 24 ? 0 : n;
}

/** 00:00 (BRT) do dia SEGUINTE ao do ISO. Sem aritmética de fuso na mão: o dia
 *  sai como texto e o `-03:00` é fixo (o Brasil não tem horário de verão desde
 *  2019). */
function inicioDoDiaSeguinte(iso: string): number {
  return new Date(`${diaBRT(iso)}T00:00:00-03:00`).getTime() + 86400_000;
}

type Estado = { n: number; ultimo: string; de?: string };

export type ResultadoReagendaAuto = {
  remarcados: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; tentativa: number; de: string; para: string }>;
};

const zero = (motivo?: string): ResultadoReagendaAuto =>
  ({ remarcados: 0, erros: 0, ...(motivo ? { motivo } : {}) });

interface FichaVermelha {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  quando: string | null;
  vendedor_nome: string | null;
  created_by: string | null;
  status: string | null;
  lead_resposta_at: string | null;
  historico: string | null;
}

// ── COPY ────────────────────────────────────────────────────────────────────
// Não é a confirmação padrão de propósito. Quem recebe isto não marcou nada: ele
// PERDEU uma reunião e está sendo remarcado por conta da casa. Começar com "sua
// reunião está confirmada", sem dizer de onde ela saiu, é o robô fingindo que a
// pessoa pediu — e é assim que se ganha um "não solicitei nada".
const comNome = (n: string) => (n ? `, ${n}` : '');

export function bolhasReagendado(
  nome: string, deIso: string, paraIso: string, quem: string, telVendedor: string | null,
  tentativa: number,
): string[] {
  const tel = telefoneBonito(telVendedor);
  const perdida = quandoPorExtenso(deIso).replace('-feira', '');
  const nova = quandoPorExtenso(paraIso).replace('-feira', '');
  const ultima = tentativa >= MAX_REAGENDAMENTOS;
  return [
    // A marca na primeira frase: pra quem sumiu, esta pode ser a primeira
    // mensagem que ele de fato lê, de um número que ele nunca respondeu.
    `Oi${comNome(nome)}! Aqui é da *Irmãos na Obra*. Você não conseguiu entrar na apresentação do eletroposto de ${perdida} — sem problema, acontece.`,
    // O horário novo é AFIRMAÇÃO, não pergunta. Quem está em silêncio não escolhe
    // de uma lista; ele confirma ou desmarca algo que já está de pé.
    `Já separei outro pra você: *${nova}* (Brasília), com o *${quem}*. É por vídeo e o link chega no WhatsApp dele${tel ? `, o *${tel}*` : ''}.`,
    ultima
      // A última diz que é a última. Quem não responde a um prazo responde ao
      // fim dele — e quem não responder nem a isto não queria mesmo.
      ? `Esse é o último horário que eu seguro por aqui${comNome(nome)}. Me responde *SIM* que eu travo, ou me fala o dia que fica melhor que eu troco.`
      : 'Me responde *SIM* que eu travo o horário. Se não der nesse dia, me fala qual fica melhor que eu troco.',
  ];
}

/** Linha no card: o consultor abre a ficha e vê que o robô já a remarcou — sem
 *  isso, "vermelho parado" e "vermelho sendo trabalhado" são a mesma tela. */
function linhaDoHistorico(deIso: string, paraIso: string, tentativa: number): string {
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: BRT_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  return `[${carimbo} · Sistema] 🔁 Reagendamento automático ${tentativa}/${MAX_REAGENDAMENTOS}: `
    + `não apareceu em ${quandoPorExtenso(deIso).replace('-feira', '')} e voltou pra `
    + `*${quandoPorExtenso(paraIso).replace('-feira', '')}*, com o mesmo consultor. `
    + 'Os avisos recomeçaram do zero.';
}

/**
 * Os horários candidatos, em ordem de preferência: o PRÓXIMO DIA ÚTIL depois da
 * reunião perdida, mesmo horário se estiver livre, senão o primeiro livre
 * daquele dia — e, se o dia inteiro estiver cheio, o que vier depois.
 *
 * A grade não é recalculada aqui: quem sabe quais horas existem em cada dia da
 * semana (segunda cheia, terça a sexta só a tarde), o que é feriado e o que já
 * está ocupado é o `eletropostoVagas`, o mesmo que a conversa de remarcação usa.
 * Uma terceira cópia da grade seria um terceiro lugar pra divergir da vitrine
 * da LP.
 */
export async function candidatosDoOutroDia(
  dono: string, quandoIso: string, agora = Date.now(),
): Promise<string[] | null> {
  // Nunca no passado: reunião perdida ontem e detectada hoje de manhã tem que
  // cair de hoje pra frente, não "no dia seguinte ao de ontem".
  const inicio = Math.max(agora, inicioDoDiaSeguinte(quandoIso));
  const vagas = await proximasVagas(dono, VAGAS_CONSULTADAS, { agora: inicio, ignorarIso: quandoIso });
  if (vagas === null) return null;              // leitura falhou: não inventa horário
  if (!vagas.length) return [];

  const diaAlvo = diaBRT(vagas[0]!);
  const doDia = vagas.filter(v => diaBRT(v) === diaAlvo);
  const resto = vagas.filter(v => diaBRT(v) !== diaAlvo);
  const mesmaHora = doDia.filter(v => horaDoIso(v) === horaDoIso(quandoIso));
  // Mesma hora primeiro (é o que menos mexe na rotina de quem já tinha dito que
  // aquele horário servia), depois o resto do dia, depois os dias seguintes.
  return [...mesmaHora, ...doDia.filter(v => !mesmaHora.includes(v)), ...resto];
}

/**
 * Grava o horário novo. Devolve o ISO que pegou, ou null se nenhum candidato
 * coube.
 *
 * O 23505 é caminho normal, não exceção: `agendamentos_vq_naosolar_uniq` é
 * igualdade exata em (vendedor_nome, quando) e a régua de vaga trabalha com
 * sobreposição de 30 min — entre calcular e gravar, a LP pode ter vendido o
 * slot. Bateu no índice? Tenta o próximo da lista.
 *
 * O `.eq('status','nao_atendeu')` é a corrida com GENTE: se alguém mexeu no
 * status entre a leitura e agora, quem manda é a pessoa e o update não pega
 * linha nenhuma.
 */
async function gravarNovoHorario(
  f: FichaVermelha, candidatos: string[], tentativa: number,
): Promise<string | null> {
  for (const novo of candidatos.slice(0, CANDIDATOS_MAX)) {
    const linha = linhaDoHistorico(String(f.quando), novo, tentativa);
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({
        quando: novo,
        status: 'agendado',
        // NULO de propósito: é a mensagem deste módulo que confirma, e ela só é
        // carimbada depois de sair. Envio falhou? A fila lenta da agenda manda a
        // confirmação padrão — melhor copy genérica que horário sem aviso.
        confirmacao_at: null,
        lembrete_1h_at: null,
        lembrete_5min_at: null,
        presenca_confirmada_at: null,
        // "Sai LIMPO" inclui o silêncio. Sem zerar, quem disse "SIM" e não
        // apareceu (o no-show clássico) voltava pra agenda e NUNCA MAIS podia
        // ficar vermelho — as duas réguas de marcação exigem `lead_resposta_at`
        // vazio. O ciclo travava em 1 e a ficha ficava `agendado` até o repasse
        // de 12h pegá-la, trocar o consultor e jogá-la fora da grade.
        // O que a pessoa escreveu não se perde: está no histórico do card e na
        // conversa. O que se apaga é a afirmação "ela já falou NESTE ciclo".
        lead_resposta_at: null,
        historico: f.historico ? `${linha}\n\n${f.historico}` : linha,
      })
      .eq('id', f.id)
      .eq('status', 'nao_atendeu')
      .select('id');
    if (error) {
      if (String((error as { code?: string }).code) === '23505') {
        logger.info('ep-reagenda', 'slot ocupado no meio do caminho — tenta o próximo', { id: f.id, novo });
        continue;
      }
      logger.error('ep-reagenda', 'gravar horário novo falhou', { id: f.id, erro: String(error) });
      return null;
    }
    // Zero linhas sem erro = alguém mexeu no status. Não insiste com outro slot:
    // a ficha deixou de ser vermelha e não é mais assunto deste módulo.
    if (!data?.length) {
      logger.info('ep-reagenda', 'ficha saiu do vermelho entre a leitura e a gravação', { id: f.id });
      return null;
    }
    return novo;
  }
  return null;
}

/**
 * Limpa o que sobrou do ciclo anterior. Nenhum destes mora em `agendamentos`, e
 * cada um cala uma mensagem do dia novo se ficar pra trás:
 *   · `ep_nao_atendeu_auto:<id>` — a marca de "o robô deu como ausente". Sem
 *     apagar, a ficha nunca mais poderia ser marcada no horário NOVO;
 *   · `ep_agenda_sent:<id>:manha` — o carimbo do bom dia. Ele guarda a data, mas
 *     apagar é mais barato que confiar nela;
 *   · `ep_remarcar:<id>` — lista de horários eventualmente na mesa. Ela aponta
 *     pra reunião que acabou de mudar.
 */
async function limparCarimbos(id: number): Promise<void> {
  const chaves = [
    `${EP_NAO_ATENDEU_PREFIX}${id}`,
    `${EP_AGENDA_PREFIX}${id}:manha`,
    `${EP_REMARCAR_PREFIX}${id}`,
  ];
  await supabase.from('system_state').delete().in('key', chaves)
    .then(undefined, (e: unknown) =>
      logger.error('ep-reagenda', 'limpar carimbos falhou', { id, erro: String(e) }));
}

/**
 * Um passo da fila. Roda a cada ~5 min dentro do /cron/process-messages.
 * `dry` decide igual e não envia, não grava e não gasta tentativa.
 */
export async function runEletropostoReagendaAutoTick(
  opts: { dry?: boolean } = {},
): Promise<ResultadoReagendaAuto> {
  if (desligado()) return zero('desligado');
  const h = horaBrasilia();
  if (h < JANELA_INICIO_H || h >= JANELA_FIM_H) return zero('fora_da_janela');

  const agora = Date.now();
  const de = new Date(Math.max(agora - JANELA_DIAS * 86400_000, new Date(REAGENDA_INICIO).getTime())).toISOString();
  const ate = new Date(agora - APOS_PERDER_MIN * 60_000).toISOString();
  if (de >= ate) return zero('piso_ainda_no_futuro');

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, quando, vendedor_nome, created_by, status, lead_resposta_at, historico')
    .eq('status', 'nao_atendeu')
    .gte('quando', de)
    .lte('quando', ate)
    .order('quando', { ascending: false })
    .limit(200);
  if (error) {
    logger.error('ep-reagenda', 'ler vermelhos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const candidatos = ((data ?? []) as FichaVermelha[]).filter(f =>
    ehOrigemEletroposto(f.created_by)
    && !!f.cliente_telefone
    && !!f.vendedor_nome
    && !!f.quando
    // Escreveu DEPOIS de perder o horário? Não sumiu — está conversando, e essa
    // conversa é do agente de respostas, que já sabe remarcar.
    && !(f.lead_resposta_at && f.lead_resposta_at > f.quando));
  if (!candidatos.length) return zero('nenhum_vermelho');

  const ids = candidatos.map(f => f.id);
  const [{ data: estados }, { data: ofertasVivas }] = await Promise.all([
    supabase.from('system_state').select('key, value')
      .in('key', ids.map(id => `${EP_REAGENDA_PREFIX}${id}`)),
    supabase.from('system_state').select('key, updated_at')
      .in('key', ids.map(id => `${EP_REMARCAR_PREFIX}${id}`)),
  ]);
  const estadoDe = new Map<number, Estado>();
  for (const r of estados ?? []) {
    const id = Number(String(r.key).slice(EP_REAGENDA_PREFIX.length));
    const v = (r.value ?? {}) as Partial<Estado>;
    if (Number.isInteger(id) && typeof v.n === 'number' && v.ultimo) estadoDe.set(id, { n: v.n, ultimo: v.ultimo });
  }
  // Oferta na mesa é qualquer `ep_remarcar:<id>` das últimas 24h — o mesmo prazo
  // que o fluxo reativo usa pra aceitar uma escolha.
  const comOferta = new Set(
    (ofertasVivas ?? [])
      .filter(r => r.updated_at && agora - new Date(String(r.updated_at)).getTime() < 24 * 3600_000)
      .map(r => Number(String(r.key).slice(EP_REMARCAR_PREFIX.length))));

  const naVez = candidatos.filter(f =>
    !comOferta.has(f.id) && (estadoDe.get(f.id)?.n ?? 0) < MAX_REAGENDAMENTOS);
  if (!naVez.length) return zero('ninguem_na_vez');

  // Teto anti-ban ANTES de mexer na ficha: remarcar sem conseguir avisar é
  // marcar reunião que a pessoa não sabe que existe. Estourou? Ninguém é
  // remarcado nesta rodada — a fila espera o próximo tick, ela não tem pressa.
  if (!opts.dry && !(await dentroDoTetoHorarioLinha({ transacional: false }))) {
    logger.info('ep-reagenda', 'teto da linha estourado — a fila espera o próximo tick');
    return zero('teto_da_linha');
  }

  const telPorConsultor = await carregarConsultores();
  const alvos = naVez.slice(0, POR_TICK);
  const previa: NonNullable<ResultadoReagendaAuto['previa']> = [];
  let remarcados = 0, erros = 0;

  for (const f of alvos) {
    const tentativa = (estadoDe.get(f.id)?.n ?? 0) + 1;
    const quem = String(f.vendedor_nome);
    try {
      const lista = await candidatosDoOutroDia(quem, String(f.quando), agora);
      if (lista === null) continue;             // leitura da agenda falhou
      if (!lista.length) {
        logger.info('ep-reagenda', 'agenda do consultor sem vaga — tenta no próximo tick', { id: f.id, quem });
        continue;
      }

      if (opts.dry) {
        previa.push({
          id: f.id, cliente: String(f.cliente_nome || '—'), tentativa,
          de: quandoPorExtenso(String(f.quando)), para: quandoPorExtenso(lista[0]!),
        });
        remarcados++;
        continue;
      }

      const novo = await gravarNovoHorario(f, lista, tentativa);
      if (!novo) continue;

      // A partir daqui a reunião JÁ mudou. A tentativa é contada aqui, no que
      // aconteceu de fato — mensagem é melhor esforço, remarcação não é.
      const nowIso = new Date().toISOString();
      await supabase.from('system_state').upsert(
        { key: `${EP_REAGENDA_PREFIX}${f.id}`, value: { n: tentativa, ultimo: nowIso, de: f.quando }, updated_at: nowIso },
        { onConflict: 'key' },
      ).then(undefined, (e: unknown) =>
        logger.error('ep-reagenda', 'carimbo do ciclo falhou', { id: f.id, erro: String(e) }));
      await limparCarimbos(f.id);

      const bruto = String(f.cliente_nome || '').trim().split(/\s+/)[0] || '';
      const primeiro = bruto.length >= 2 && bruto.length <= 20 && bruto.toLowerCase() !== 'lead' ? bruto : '';
      const tel = String(f.cliente_telefone).replace(/\D/g, '');
      await sendHuman(
        tel,
        bolhasReagendado(primeiro, String(f.quando), novo, quem, telPorConsultor.get(quem) ?? null, tentativa),
        'io',
      );
      // Carimbo do teto da linha (o mesmo prefixo dos outros toques da agenda) e,
      // junto, o `confirmacao_at`: é ele que impede a régua da agenda de mandar a
      // confirmação padrão em cima desta mensagem.
      await supabase.from('system_state').upsert(
        { key: `${EP_AGENDA_PREFIX}${f.id}:reagendado`, value: { em: nowIso, para: novo }, updated_at: nowIso },
        { onConflict: 'key' },
      ).then(undefined, (e: unknown) =>
        logger.error('ep-reagenda', 'carimbo do teto da linha falhou', { id: f.id, erro: String(e) }));
      await supabaseGerador.from('agendamentos')
        .update({ confirmacao_at: new Date().toISOString() }).eq('id', f.id);

      remarcados++;
      logger.info('ep-reagenda', `ficha #${f.id} remarcada (${tentativa}/${MAX_REAGENDAMENTOS})`, { de: f.quando, para: novo });
    } catch (e) {
      logger.error('ep-reagenda', 'reagendamento falhou', { id: f.id, erro: String(e) });
      erros++;
    }
  }

  return { remarcados, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
