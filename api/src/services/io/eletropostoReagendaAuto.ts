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
// ── SÓ CLIENTE QUENTE (ordem do Thiago, 20/08/2026) ──────────────────────────
// "Quero apenas os clientes QUENTES tenham uma 2ª e 3ª chance de uma reunião; os
// demais mantêm."
//
// Quente no eletroposto não é palpite de ninguém: é `temperatura = 'quente'`, que
// a LP grava sozinha no ato do agendamento e que quer dizer **NOTA 3** (9 a 11 dos
// 11 pontos — tem onde instalar, tem com quê pagar e decide sozinho). NOTA 2 vira
// `morno` e NOTA 1 nem chega a gravar ficha. O consultor pode rebaixar a
// temperatura no CRM depois de conversar, e aí o rebaixamento MANDA: quem virou
// frio na mão de gente para de ser repescado no mesmo minuto.
//
// Morno, frio e ficha sem temperatura (ManyChat, prospecção, cadastro manual)
// seguem exatamente como antes desta régua existir: ficam vermelhos, devolvem o
// horário pra vitrine e viram trabalho de gente. Nenhuma mensagem, nenhum slot.
//
// É o corte que faz a conta fechar. Nos últimos 30 dias foram 45 cards vermelhos
// de eletroposto e só 7 eram quentes: o robô passa a mexer em ~1 a cada 4 dias em
// vez de 1,5 por dia. Isso importa MAIS que a mensagem — cada volta ocupa um
// horário vendável de uma grade de 10 por dia, e a linha IO tem teto diário.
//
// ── Quem NÃO entra ──
//   · quem não é quente (acima);
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
// ── QUEM CHAMA ESTE TICK (01/10/2026) ──────────────────────────────────────
//
// Cron PRÓPRIO na Vercel, `/cron/eletroposto-reagenda-auto` a cada 5 min, além
// do `/cron/process-messages` e do `/cron/master`.
//
// O cron próprio entrou porque o módulo estava dependendo só do
// `process-messages`, que NÃO é cron da Vercel: ele é pingado pelo pg_cron do
// projeto do gerador. Medido à 01h40 de 01/10, com a regra do card esquecido já
// em produção e 16 fichas na fila: nenhuma andou, porque àquela hora ninguém
// estava chamando aquela rota. O Thiago abriu a agenda e viu o quadro igual.
//
// A lição é a de sempre nesta casa: módulo que não é chamado não existe, e o
// deploy em READY não prova que alguém puxa o gatilho. Agora quem puxa é a
// infra da Vercel, que é a mesma dos outros cinco crons que funcionam.
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
import { agendaFechadaNoIso } from '../agenda/agendaFechada';

const BRT_TZ = 'America/Sao_Paulo';

/** Estado do ciclo: `ep_reagenda_auto:<id>` → { n, ultimo, de }. */
export const EP_REAGENDA_PREFIX = 'ep_reagenda_auto:';

// ── Envs, lidas a cada chamada ──────────────────────────────────────────────
// Não no arranque do módulo: instância quente na Vercel não recarrega módulo, e
// apertar a rampa no meio de um dia ruim não pode depender de deploy.
const num = (nome: string, padrao: number): number => {
  const cru = (process.env[nome] || '').trim();
  if (cru === '') return padrao;
  const v = Number(cru);
  return Number.isFinite(v) && v >= 0 ? v : padrao;
};

/**
 * Piso: reunião perdida ANTES disto não é remarcada nunca.
 *
 * Era `2026-08-20`, o dia em que a régua entrou no ar, justamente pra ligar o
 * módulo não despejar o estoque velho de vermelhos de uma vez (o erro que já
 * custou caro no solar, 87 fichas num disparo).
 *
 * Em 29/09/2026 o Thiago pediu o contrário: "todos os NÃO ATENDEU têm que
 * remarcar automaticamente, mesmo os mais antigos, podemos recuperar pessoas".
 * Então o piso desce pra antes do primeiro card da base (09/05/2026) e O QUE
 * IMPEDE O DESPEJO PASSA A SER A RAMPA DIÁRIA (`tetoPorDia`), não o piso. As
 * duas coisas não podem cair juntas: sem uma delas, ligar isto remarca 75 fichas
 * de eletroposto numa tarde e manda ~300 mensagens por uma linha que já caiu 3
 * vezes em 7 dias por rajada.
 */
const inicioPiso = (): string =>
  (process.env.EP_REAGENDA_INICIO || '').trim() || '2026-05-01T00:00:00.000Z';

/** "e assim até o terceiro dia" — e o Thiago fechou em **2 dias** quando
 *  perguntei (20/08). Então são DOIS reagendamentos: a reunião perdida mais duas
 *  voltas, três dias no total. Depois disso a ficha fica vermelha e e' assunto de
 *  gente. Este numero e' a conta de quantos slots vendaveis um lead que some pode
 *  consumir — mexer nele mexe em estoque de agenda, nao so' em mensagem. */
export const MAX_REAGENDAMENTOS = 2;
/** Folga depois do horário perdido — o toque de 5 min ainda estava saindo. */
const APOS_PERDER_MIN = 45;

/**
 * O CARD CONFIRMADO QUE NINGUÉM MEXEU (ordem do Thiago, 30/09/2026).
 *
 * "O card confirmado, se não for alterado, já será remarcado novamente após 6h.
 * Marcado e confirmado e não mexido às 13:00: quando chegar 19h, remarca para o
 * outro dia, hora e hora e 30, na mesma hora que não aconteceu ou o mais
 * próximo possível."
 *
 * O gatilho aqui é a INAÇÃO, não o botão. Até hoje este módulo só pegava quem
 * alguém marcou como NÃO ATENDEU; o buraco era o card que ficou `agendado` pra
 * sempre porque o consultor não fechou. Medido em 30/09: 119 cards em
 * `agendado` com a hora já vencida — reunião que aconteceu ou não, ninguém sabe,
 * e o lead ficava parado sem ninguém decidir nada.
 *
 * Seis horas é folga suficiente pra uma reunião de 30 min terminar e o consultor
 * respirar antes de o robô assumir que ela ficou sem desfecho.
 */
const esquecidoH = (): number => num('EP_ESQUECIDO_H', 6);
/**
 * Quantos dias pra trás a varredura enxerga.
 *
 * Era 7, com a regra "reunião perdida há mais de 7 dias não é remarcação, é
 * lista fria". A ordem de 29/09 desfaz isso: o Thiago quer os antigos de volta.
 * 365 cobre a base toda (ela começa em 09/05/2026) sem virar "sem limite", que é
 * o tipo de número que ninguém revisa depois.
 */
const janelaDias = (): number => num('EP_REAGENDA_JANELA_DIAS', 365);

/**
 * A RAMPA. Quantas fichas o módulo pode remarcar por dia (dia de Brasília).
 *
 * É a trava que substitui o piso duro e o corte de temperatura, e ela é
 * load-bearing, não decorativa. A conta que a justifica, medida em 29/09/2026:
 *
 *   · 75 cards de eletroposto em `nao_atendeu` esperando;
 *   · cada remarcação recomeça a régua da agenda — confirmação, bom dia, 1h e
 *     5 min, ou seja 3 a 4 mensagens por ficha;
 *   · a linha IO tem teto por hora e por dia, e já foi bloqueada 3× em 7 dias
 *     por leva de mensagens no mesmo minuto.
 *
 * 75 fichas de uma vez são ~300 mensagens. A 10 por dia, a fila drena em uma
 * semana e meia e o volume diário fica na mesma ordem do que a linha já carrega.
 *
 * O que NÃO é mais a trava: o slot vendável. Em 20/08 o corte de temperatura foi
 * escrito porque "cada volta ocupa um horário vendável de uma grade de 10 por
 * dia". Medido em 29/09, a grade está 80% vazia: 4 reuniões de eletroposto
 * marcadas pra amanhã e 3 pra depois, numa grade de 16 a 20 por dia. Hoje não há
 * comprador de verdade sendo empurrado pra fora — o que aperta é a linha.
 */
const tetoPorDia = (): number => num('EP_REAGENDA_POR_DIA', 10);

/**
 * Só QUENTE ganha 2ª chance? Era a ordem de 20/08/2026 ("quero apenas os
 * clientes QUENTES tenham uma 2ª e 3ª chance"). A de 29/09 é mais ampla ("todos
 * os NÃO ATENDEU"), então o padrão virou `false` e a env existe pra voltar atrás
 * sem deploy se a linha reclamar.
 */
const soQuente = (): boolean => (process.env.EP_REAGENDA_SO_QUENTE || '').trim() === '1';
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

/** Quente é só quem está escrito como quente.
 *
 *  Comparação EXPLÍCITA, sem "tudo que não é frio conta": ficha sem temperatura
 *  (ManyChat, prospecção, cadastro na mão) tem que ficar de FORA, e um default
 *  permissivo faria origem nova entrar calada na fila — justo o oposto do que a
 *  ordem pede. Origem que passar a qualificar depois precisa gravar
 *  `temperatura='quente'`, que é o mesmo contrato que a LP já cumpre. */
export const ehQuente = (t: string | null | undefined): boolean =>
  String(t || '').trim().toLowerCase() === 'quente';

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
  /** `quente` | `morno` | `frio` | null. Só `quente` é repescado (ordem de 20/08). */
  temperatura: string | null;
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
    `Oi${comNome(nome)}! Aqui é da *NEXUS Eletropostos*. Você não conseguiu entrar na apresentação do eletroposto de ${perdida} — sem problema, acontece.`,
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
export function linhaDoHistorico(
  deIso: string, paraIso: string, tentativa: number, esquecido = false,
): string {
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: BRT_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  const de = quandoPorExtenso(deIso).replace('-feira', '');
  const para = quandoPorExtenso(paraIso).replace('-feira', '');
  // O histórico é lido por GENTE, e as duas situações são diferentes. "Não
  // apareceu" é fato quando alguém apertou NÃO ATENDEU. No card esquecido
  // ninguém sabe se apareceu: o que se sabe é que o card ficou sem desfecho.
  // Escrever "não apareceu" ali seria o cadastro inventando um fato.
  if (esquecido) {
    // Sem "x/2": este caminho não tem teto, e escrever um denominador que não
    // existe faria a equipe esperar que o card parasse de voltar sozinho.
    return `[${carimbo} · Sistema] 🔁 Reagendamento automático (${tentativa}ª vez): `
      + `a reunião de ${de} passou e o card ficou sem desfecho por mais de ${esquecidoH()}h, `
      + `então ele voltou pra *${para}*, mesmo horário e mesmo consultor. `
      + 'Nada foi enviado ao cliente. Se a reunião aconteceu, é só marcar o status certo.';
  }
  return `[${carimbo} · Sistema] 🔁 Reagendamento automático ${tentativa}/${MAX_REAGENDAMENTOS}: `
    + `não apareceu em ${de} e voltou pra *${para}*, com o mesmo consultor. `
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
  // GRADE REDONDA (:00/:30), e não a faixa dos quinze.
  //
  // Ordem do Thiago (30/09/2026, depois de ver a primeira versão): "remarca para
  // o outro dia, hora e hora e 30, na mesma hora que não aconteceu ou o mais
  // próximo possível".
  //
  // E é o que faz sentido: isto aqui não é follow-up, é a MESMA primeira
  // reunião mudando de dia. O cliente escolheu 13:00; devolver 13:15 perde
  // justamente o "na mesma hora", porque a faixa dos quinze não tem 13:00.
  // Follow-up de verdade (o convite à base, a conversa de remarcação pedida
  // pelo lead) continua nos quinze.
  const vagas = await proximasVagas(dono, VAGAS_CONSULTADAS,
    { agora: inicio, ignorarIso: quandoIso, faixa: 'novo' });
  if (vagas === null) return null;              // leitura falhou: não inventa horário
  if (!vagas.length) return [];

  const diaAlvo = diaBRT(vagas[0]!);
  const doDia = vagas.filter(v => diaBRT(v) === diaAlvo);
  const resto = vagas.filter(v => diaBRT(v) !== diaAlvo);
  // "Na mesma hora que não aconteceu": compara hora E minuto, senão 13:00 e
  // 13:30 empatam e o robô pode devolver a meia hora quando a hora cheia estava
  // livre. Na grade redonda os dois existem, então a distinção é real.
  const hm = (iso: string) => new Date(iso).toISOString().slice(11, 16);
  const mesmaHora = doDia.filter(v => hm(v) === hm(quandoIso));
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
    const linha = linhaDoHistorico(String(f.quando), novo, tentativa, f.status === 'agendado');
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
      // A corrida com GENTE. Era fixo em `nao_atendeu`; agora é o status que
      // FOI LIDO, porque o módulo passou a pegar `agendado` também. Se alguém
      // mexeu no status entre a leitura e agora, quem manda é a pessoa e o
      // update não pega linha nenhuma.
      .eq('status', String(f.status))
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
  // ── A JANELA SÓ VALE PRO CAMINHO QUE FALA (01/10/2026) ───────────────────
  //
  // 9h–19h existe por um motivo só: não mandar "você não apareceu" pra ninguém
  // às 3 da manhã. O card ESQUECIDO não manda nada, então a janela não tem o
  // que proteger nele — e segurá-lo até as 9h só atrasa a arrumação do quadro
  // que a equipe vai encontrar quando abrir o dia.
  //
  // Foi exatamente o que aconteceu: a regra subiu depois das 19h e, às 01h38, o
  // Thiago abriu a agenda e não viu card nenhum remarcado. Não estava quebrado,
  // estava fora de hora.
  const foraDaJanela = h < JANELA_INICIO_H || h >= JANELA_FIM_H;

  const agora = Date.now();
  const de = new Date(Math.max(agora - janelaDias() * 86400_000, new Date(inicioPiso()).getTime())).toISOString();
  const ate = new Date(agora - APOS_PERDER_MIN * 60_000).toISOString();
  if (de >= ate) return zero('piso_ainda_no_futuro');

  // DOIS GATILHOS, e o corte de idade de cada um é diferente:
  //   `nao_atendeu` — alguém apertou o botão. 45 min de folga (o toque de 5 min
  //                   ainda sai pra quem já está vermelho).
  //   `agendado`    — NINGUÉM apertou nada. 6 horas, ordem do Thiago.
  const corteEsquecido = new Date(agora - esquecidoH() * 3600_000).toISOString();
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, quando, vendedor_nome, created_by, status, temperatura, lead_resposta_at, historico')
    .in('status', ['nao_atendeu', 'agendado'])
    .gte('quando', de)
    .lte('quando', ate)
    .order('quando', { ascending: false })
    .limit(400);
  if (error) {
    logger.error('ep-reagenda', 'ler as fichas vencidas falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const candidatos = ((data ?? []) as FichaVermelha[]).filter(f =>
    ehOrigemEletroposto(f.created_by)
    // O `agendado` só entra depois das 6 horas. A consulta acima usa o corte
    // frouxo (45 min) porque ela é uma só pros dois status; quem aperta o corte
    // certo é esta linha.
    && (f.status !== 'agendado' || (!!f.quando && f.quando <= corteEsquecido))
    // Desde 29/09/2026 entra TODO NÃO ATENDEU, não só o quente: a ordem é
    // recuperar gente, e quem decide o volume agora é a rampa diária. Com
    // EP_REAGENDA_SO_QUENTE=1 volta a régua de 20/08 sem deploy.
    && (!soQuente() || ehQuente(f.temperatura))
    && !!f.cliente_telefone
    && !!f.vendedor_nome
    && !!f.quando
    // Escreveu DEPOIS de perder o horário? Não sumiu — está conversando, e essa
    // conversa é do agente de respostas, que já sabe remarcar.
    && !(f.lead_resposta_at && f.lead_resposta_at > f.quando)
    // Reunião perdida num dia de AGENDA FECHADA (sócios fora) não
    // é no-show: o consultor é que não estava. A copy daqui abre com "você não
    // conseguiu entrar na apresentação" e culparia o cliente pela nossa ausência.
    // Elas ficam SEM DONO: este filtro só impede a acusação errada, não avisa
    // ninguém. Quem fechar um dia na `agendaFechada` precisa avisar à mão quem já
    // estava marcado nele — senão o lead espera por uma reunião que não vai ter.
    && !agendaFechadaNoIso(f.quando)
    // Fora do horário comercial sobra só o card esquecido, que se move calado.
    && (!foraDaJanela || f.status === 'agendado'));
  if (!candidatos.length) return zero(foraDaJanela ? 'fora_da_janela' : 'nenhum_vermelho');

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

  // ── O TETO DE 2 NÃO VALE PRO CARD ESQUECIDO (01/10/2026) ─────────────────
  //
  // Ordem do Thiago: "agenda é feita para ter responsabilidade de ser
  // trabalhada, então a pessoa, quando não marca e não utiliza a ferramenta,
  // sempre terá os clientes retornando e ocupando a agenda. Vamos seguir a
  // regra."
  //
  // "Sempre" é literal, e a pressão é o ponto: o card volta todo dia, no mesmo
  // horário, até alguém dar destino a ele. Ocupar a grade é o CUSTO que faz a
  // regra funcionar, não um efeito colateral — é o que obriga a fechar o card.
  //
  // O teto continua valendo pro VERMELHO, e por um motivo diferente: aquele
  // caminho MANDA MENSAGEM pro cliente. Remarcar em silêncio pode ser infinito;
  // dizer "você não apareceu" vinte vezes, não.
  const semTeto = (f: FichaVermelha) => f.status === 'agendado';
  const naVez = candidatos.filter(f =>
    !comOferta.has(f.id) && (semTeto(f) || (estadoDe.get(f.id)?.n ?? 0) < MAX_REAGENDAMENTOS));
  if (!naVez.length) return zero('ninguem_na_vez');

  // A RAMPA DO DIA. Conta quantas fichas já foram remarcadas hoje e para no teto.
  //
  // Sem ela o módulo remarca até 1 por tick, o tick roda de ~2 em 2 minutos e a
  // janela tem 10 horas: são 300 remarcações por dia de teto teórico. Com o piso
  // duro e o corte de quente fora (29/09), isto é o único lugar em que o volume
  // é decidido.
  //
  // Fail-closed de propósito: consulta que quebra devolve `data` nulo, o
  // contador nasce zero e a rampa deixa de existir bem no dia em que o banco
  // está ruim. Na dúvida ninguém é remarcado — a fila não tem pressa, ela
  // esperou meses.
  const inicioDoDiaBRT = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: BRT_TZ }).format(new Date(agora))}T00:00:00-03:00`,
  ).toISOString();
  // A CONTA DA RAMPA SAI DO `value.ultimo`, NÃO DO `updated_at` (01/10/2026).
  //
  // Ela saía de `.gte('updated_at', inicioDoDiaBRT)` e estava ERRADA em
  // produção: às 02h de 01/10, com ZERO fichas remarcadas no dia, o módulo
  // logava `rampa do dia cheia (10/10)` a cada tick e não mexia em nada. O
  // Thiago abriu a agenda e viu o quadro intacto, com 16 fichas na fila.
  //
  // `updated_at` é coluna de infraestrutura da tabela: quem a escreve, quando, e
  // com que fuso não é contrato deste módulo, e a conta da rampa não pode
  // depender disso. `value.ultimo` é o ISO que ESTE módulo grava, no mesmo
  // upsert em que conta a tentativa — dado próprio, com significado único.
  //
  // Fail-closed segue valendo: consulta quebrada devolve `erro_rampa` e ninguém
  // é remarcado. O que mudou é só de onde sai a data.
  const feitosHoje = await supabase
    .from('system_state').select('key, value, updated_at')
    .like('key', `${EP_REAGENDA_PREFIX}%`)
    .limit(1000);
  if (feitosHoje.error) {
    logger.error('ep-reagenda', 'ler a rampa do dia falhou — ninguém remarca nesta rodada', feitosHoje.error);
    return { ...zero('erro_rampa'), erros: 1 };
  }
  const doDia = (feitosHoje.data || []).filter(r => {
    const v = (r as { value?: { ultimo?: string } }).value;
    const quando = String(v?.ultimo || '');
    // Sem `ultimo` legível o carimbo é de um formato velho: não conta como
    // feito hoje, senão carimbo antigo fecha a rampa pra sempre, que é
    // exatamente o defeito que estamos corrigindo.
    return !!quando && quando >= inicioDoDiaBRT;
  });
  const jaHoje = doDia.length;
  // Deixa VISÍVEL o que a rampa contou. Sem isto, "rampa cheia" é uma afirmação
  // sem prova nenhuma no log, e foi assim que o defeito passou despercebido.
  logger.info('ep-reagenda', `rampa: ${jaHoje}/${tetoPorDia()} hoje (desde ${inicioDoDiaBRT}), ${(feitosHoje.data || []).length} carimbos no total`);
  // Seco atravessa a rampa, igual à janela de horário: conferir é pergunta, não
  // envio. Parar aqui fazia a prévia responder só `rampa_do_dia_cheia`, sem dizer
  // quem seria remarcado — prévia que só serve quando o módulo já podia agir.
  if (!opts.dry && jaHoje >= tetoPorDia()) {
    logger.info('ep-reagenda', `rampa do dia cheia (${jaHoje}/${tetoPorDia()}) — a fila continua amanhã`);
    return zero('rampa_do_dia_cheia');
  }

  // Teto anti-ban ANTES de mexer na ficha: remarcar sem conseguir avisar é
  // marcar reunião que a pessoa não sabe que existe. Estourou? Ninguém é
  // remarcado nesta rodada — a fila espera o próximo tick, ela não tem pressa.
  //
  // Só vale pra quem VAI FALAR. O card esquecido não manda mensagem nenhuma,
  // então deixar o teto da linha travar ele seria uma trava sem nada do outro
  // lado pra proteger: a linha não é usada.
  const vaiFalar = naVez.some(f => f.status !== 'agendado');
  if (!opts.dry && vaiFalar && !(await dentroDoTetoHorarioLinha({ transacional: false }))) {
    logger.info('ep-reagenda', 'teto da linha estourado — a fila espera o próximo tick');
    return zero('teto_da_linha');
  }

  const telPorConsultor = await carregarConsultores();
  // O menor entre o passo do tick e o que resta da rampa: no último slot do dia
  // não adianta o tick permitir 1 se a rampa só tem 0.
  const alvos = naVez.slice(0, opts.dry ? POR_TICK : Math.min(POR_TICK, tetoPorDia() - jaHoje));
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

      // ── O CARD ESQUECIDO MUDA DE DIA EM SILÊNCIO ────────────────────────
      //
      // A copy deste módulo abre com "você não conseguiu entrar na
      // apresentação". Pra quem alguém marcou como NÃO ATENDEU isso é verdade.
      // Pro card que ficou `agendado` porque o CONSULTOR não fechou, não é: a
      // reunião pode ter acontecido e ido bem, e o cliente receberia uma
      // acusação de falta por causa de um cadastro que ninguém atualizou. Esse
      // é o tipo de mensagem que faz um cliente bom sumir.
      //
      // Então aqui o card volta pra grade sem que nada saia pro cliente. Quem
      // precisa ver é a EQUIPE, e ela vê: o card reaparece no dia seguinte, no
      // mesmo horário, com a linha do histórico dizendo por que se moveu. Se a
      // pessoa não aparecer no horário novo, alguém marca NÃO ATENDEU e aí sim
      // o caminho com mensagem assume.
      const esquecido = f.status === 'agendado';
      if (!esquecido) {
        const bruto = String(f.cliente_nome || '').trim().split(/\s+/)[0] || '';
        const primeiro = bruto.length >= 2 && bruto.length <= 20 && bruto.toLowerCase() !== 'lead' ? bruto : '';
        const tel = String(f.cliente_telefone).replace(/\D/g, '');
        await sendHuman(
          tel,
          bolhasReagendado(primeiro, String(f.quando), novo, quem, telPorConsultor.get(quem) ?? null, tentativa),
          'io',
        );
      }
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
