// ─────────────────────────────────────────────────────────────────────────────
// AGENTE DE AGENDAMENTO DO ELETROPOSTO — confirma, lembra e cobra presença.
//
// O problema que ele resolve: gente marca na LP e some. Até aqui o lead saía da
// LP com "enviamos o link no seu WhatsApp antes do horário" na tela e NÃO recebia
// nada — só o Thiago e o Diego eram avisados (POST /io/eletroposto/alerta). O
// primeiro contato real acontecia na hora da reunião, quando já não dá pra
// recuperar quem esqueceu.
//
// Quatro toques, todos pro CLIENTE, todos na linha IO:
//   1. AO MARCAR      — confirma dia/hora, diz que é por vídeo, que o link chega
//                       pelo WhatsApp DO CONSULTOR, e PEDE UM "SIM" (o compromisso
//                       explícito é o que separa quem vai de quem só clicou).
//   2. MANHÃ DO DIA   — só pra quem marcou num dia ANTERIOR: às 8h, "hoje é o dia".
//                       Quem marcou com dias de antecedência viu a confirmação sumir
//                       da conversa e chega no dia sem nada.
//   3. 1 HORA ANTES   — avisa que o link está vindo e abre a porta do remarcar.
//   4. 5 MINUTOS ANTES— "ele já está te esperando, o link cai a qualquer momento".
//
// Os três avisam que pode atrasar uns minutos: a reunião de antes estica quando
// vai pra fechamento, e lead esperando sem aviso acha que furaram com ele.
//
// ── O que ele NÃO faz (de propósito) ──
//   • Não manda o link. Quem manda é gente — o robô só avisa que ele vem. Prometer
//     "já te mandei" quando o consultor não mandou é pior que não avisar nada.
//   • Não pinga o vendedor. Decisão de 25/07: o Thiago não quer mais os "🔔 Em 1
//     hora". A equipe já recebe o card NOVA REUNIÃO quando a ficha entra.
//   • Não lê a resposta do lead. O "SIM" chega no 5040 e aparece no digest de
//     entrada (12h/18h) — leitura humana. Robô nenhum marca presença aqui ainda.
//
// ── Por que não é o lembretesAgenda.ts ──
// Aquele módulo está desligado desde 28/07 e a copy dele é de ENERGIA SOLAR — foi
// exatamente ele que fez um lead de eletroposto responder "não solicitei nenhum
// serviço de energia solar". Este é o módulo separado por produto que o comentário
// de lá pede. As colunas de flag (confirmacao_at / lembrete_1h_at /
// lembrete_5min_at) são as MESMAS, e isso é seguro nos dois sentidos: o módulo
// solar só confirma created_by='lead-meta' e está atrás de kill-switch, e se um dia
// religarem, as fichas de eletroposto já vão estar marcadas — ninguém recebe duas
// vezes. Quem religar o solar: não tire aquele filtro de created_by.
//
// ── Travas (a linha IO foi bloqueada em 01–03/ago; ela não aguenta rajada) ──
//   • Ficha recém-criada confirma na hora — é transacional, o lead acabou de
//     sair da LP e está esperando.
//   • Ficha ANTIGA sem confirmação (backlog de quem marcou antes deste agente
//     existir) entra numa fila lenta: 1 por tick, só das 08h às 20h BRT e só se a
//     reunião ainda estiver a 2h+ de distância.
//   • Teto de leads tocados por rodada — o tick é de 5 min, então a fila drena
//     sozinha em vez de estourar de uma vez.
//   • Um toque por lead por rodada, do mais urgente pro menos.
//   • Cada flag só é gravada DEPOIS do envio dar certo → falha vira retry, não
//     buraco.
//
// Supressão (PARAR) NÃO é consultada aqui de propósito: quem preencheu a LP e
// escolheu um horário deu um sinal de contato novo, que vale mais que um opt-out
// antigo. Isto é mensagem sobre a reunião DELE, não abordagem fria.
//
// Kill-switch: EP_LEMBRETES_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman, sendWhatsApp } from '../agents/zapiClient';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { EQUIPE } from '../../routes/ioEletroposto';

/** Instancia Z-API da linha IO. Mesmo default do solarRespostas: um literal aqui
 *  evita import cruzado entre dois modulos de agenda so por causa de uma const. */
const INSTANCE_ID_IO = (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { agendaFechadaNoIso } from '../agenda/agendaFechada';

/** Marcador de envio efetivado, pro teto anti-ban da linha enxergar este agente. */
export const EP_AGENDA_PREFIX = 'ep_agenda_sent:';

/** Marcador de "esta pessoa ESCREVEU alguma coisa" — gravado pelo agente de
 *  respostas quando avisa o Thiago/Diego. Mora aqui, e não lá, porque o
 *  eletropostoRespostas já importa deste módulo: a volta criaria ciclo. */
export const EP_RESPOSTA_PREFIX = 'ep_resposta:';

/** Marcador do NÃO ATENDIDO automático: quem o robô marcou, e quando.
 *  É ele que separa a marca do robô da marca de gente — e só a do robô pode
 *  ser desfeita quando o lead aparece falando. */
export const EP_NAO_ATENDEU_PREFIX = 'ep_nao_atendeu_auto:';

/** As origens de eletroposto que caem na tabela `agendamentos`. É lista de
 *  CONTAGEM (a Central das Agentes conta com `.in`), não de decisão: quem decide
 *  se a ficha é de EP é `ehOrigemEletroposto()`, que casa pela palavra. Origem
 *  nova de EP entra sozinha lá; aqui alguém precisa lembrar — e por isso aqui
 *  não pode mandar mensagem nenhuma. */
export const EP_ORIGENS = ['lp_eletroposto', 'manychat_eletroposto', 'prosp_eletroposto'];

/** Dia em que este agente entrou no ar. As MESMAS colunas de flag foram usadas
 *  pelo módulo solar até 28/07 — 16 fichas de eletroposto já têm lembrete_5min_at
 *  gravado por ele. Sem este piso, a Central das Agentes credita a este agente
 *  mensagem que ele não mandou (e com a copy errada, ainda por cima). */
export const EP_AGENDA_INICIO = '2026-08-03T00:00:00.000Z';

const BRT_TZ = 'America/Sao_Paulo';

/** Janelas alargadas: o cron é de 5 min e o GitHub Actions atrasa. A flag impede
 *  envio dobrado, então alargar é seguro — perder o toque é que não é. */
const MIN_5MIN = { de: -3, ate: 12 };
const MIN_1H = { de: 45, ate: 75 };

// ── LEMBRETE DA MANHÃ (quem marcou em outro dia) ─────────────────────────────
// Quem marca hoje pra hoje recebe a confirmação e a reunião acontece na mesma
// leva de mensagens. Quem marcou ONTEM (ou semana passada) confirmou num dia e
// aparece em outro: a confirmação já rolou pra fora da conversa, e o dia da
// reunião começa sem nada. Às 8h a pessoa ainda está montando o dia — é a última
// hora em que dá pra remarcar sem furar o horário do consultor.
//
// Janela larga, não um horário cravado, por DOIS motivos: o tick é de 5 min mas o
// GitHub Actions atrasa, e o teto anti-ban da linha é de 6/h COMPARTILHADO com todo
// o resto (backlog de confirmação, Bia, semente, followup do gerador). Uma grade
// cheia são 16 reuniões (14/08: a LP passou a vender 8 horários × 2 consultores):
// com 6/h disputados, elas não cabem em 3 horas se a manhã estiver movimentada. As
// 4 horas dão folga, e não custam nada — quem tem reunião às 13h já é barrado pelo
// MANHA_ANTECEDENCIA_MIN a partir das 11h, então a hora extra serve pros horários
// de 14h em diante.
const MANHA = { de: 7, ate: 12 };
/** Piso do teto da linha só para o bom dia: ele é 1 mensagem por reunião do dia,
 *  então o volume é limitado pela agenda e não pode explodir. Sem isto, o orçamento
 *  de 24h gasto na véspera (confirmações) calava o aviso do próprio dia. */
const MANHA_TETO_HORA = Number(process.env.EP_MANHA_TETO_HORA || 10);
const MANHA_TETO_DIA = Number(process.env.EP_MANHA_TETO_DIA || 200);
/** O MESMO piso, agora para a confirmação — e a falta dele era a assimetria que
 *  travou 13 fichas em 02/09/2026. O comentário acima descreve este bug ao
 *  contrário ("o orçamento gasto na véspera pelas confirmações calava o bom
 *  dia"); consertaram um lado só, e o lado sem piso virou o lado faminto.
 *
 *  Medido na hora do travamento: 46 envios em 24h contra teto de 20 (rampa de
 *  aquecimento da linha, 2º dia). Os 10 bons dias das 7h passaram pelo piso
 *  DELES e gastaram o orçamento; a confirmação, única das quatro réguas sem
 *  piso, leu 46 >= 20 e parou. Não é fila lenta — é fome, e ela não drena
 *  sozinha: no dia seguinte os bons dias comem o teto de novo, antes.
 *
 *  A confirmação é a régua que MAIS merece piso, não a que menos: é a primeira
 *  mensagem que o lead recebe da empresa, e é 1 por ficha para a vida inteira
 *  (`confirmacao_at` é carimbado uma vez). Volume limitado pela agenda, que é
 *  exatamente o critério que o bom dia usa para ter piso.
 *
 *  6/h e não 10/h como o bom dia: `entregar` manda até 3 bolhas por toque, então
 *  10 seriam ~30 mensagens/hora — perto das 37 que bloquearam a linha em 04/08.
 *  Em 6 são ~18, metade daquilo, e ainda drena 13 fichas em pouco mais de 2h
 *  dentro de uma janela de 13. O freio de rajada continua sendo o
 *  BACKLOG_POR_TICK (1 por tick de 2 min), que este piso não toca. */
const CONFIRMA_TETO_HORA = Number(process.env.EP_CONFIRMA_TETO_HORA || 6);
const CONFIRMA_TETO_DIA = Number(process.env.EP_CONFIRMA_TETO_DIA || 200);
/** Nunca a menos de 2h da reunião: abaixo disso quem fala é o toque de 1h, e um
 *  "hoje é o dia" 40 minutos antes é ruído.
 *
 *  14/08: a grade da LP voltou a ter 10:00 e 11:00, e é aí que esta folga passa a
 *  MORDER de propósito. Quem marcou em outro dia pra hoje às 10:00 só receberia o
 *  "bom dia" num tick exatamente às 8:00 — na prática, não recebe. Quem cobre é o
 *  toque de 1h (9:00, dentro da janela de envio), e reunião de manhã marcada com
 *  antecedência é justamente a que menos precisa de aviso ao acordar. */
// 30/08/2026: de 120 pra 60 por ordem do Thiago ("todos têm que receber essa msg na
// parte da manhã"). Com a agenda concentrada — 36 reuniões numa segunda, começando às
// 09:00 — a folga de 2h calava justamente quem abre o dia: às 08:00 a reunião das 09:00
// está a 60 minutos. O toque de 1h continua saindo depois; quem é das 9h recebe os dois
// em sequência, e isso é aceito de propósito (a alternativa é não receber o bom dia).
const MANHA_ANTECEDENCIA_MIN = 60;
/** 2 por tick. Com o tick de 5 min, a grade cheia (16 reuniões/dia) drena em 40
 *  minutos, sobrando muito da janela de 4h. Sem esse freio, um tick soltaria os 6
 *  do MAX_TOQUES — 6 pessoas × 4 bolhas em ~2 minutos é exatamente a rajada que
 *  bloqueou a linha IO em 04/08. O teto anti-ban é checado ANTES de cada envio,
 *  então quem não couber espera o próximo tick em vez de furar. */
const MANHA_POR_TICK = 3;

// ── LEMBRETE DIÁRIO DA VÉSPERA (ordem do Thiago, 22/09/2026) ────────────────
// "Quem agendou na segunda pra quarta recebe um pequeno lembrete na terça, e
// assim por diante; se marcou na segunda pra quinta, recebe na terça e na
// quarta."
//
// O buraco que ele fecha: entre a confirmação e a manhã da reunião existiam DIAS
// de silêncio. A reunião mediana é marcada com ~69h de antecedência, então o
// normal é o lead combinar numa segunda e só ouvir falar da gente na quarta de
// manhã. Nesse vão ele esquece, marca outra coisa por cima, ou esfria.
//
// UM POR DIA, e só nos DIARIO_DIAS_ANTES dias anteriores à reunião. O teto de
// dias não é economia de mensagem, é o desenho: medido em 30 dias, sem ele os
// 11 leads que marcam com 10 a 23 dias de antecedência sozinhos gerariam 136
// mensagens (34% do total), e um deles receberia 22 lembretes iguais. Com o
// corte em 3, quem marca com três semanas recebe a confirmação, some do radar, e
// volta a ouvir falar da gente na semana da reunião, que é como uma pessoa faria.
// Volume medido com o corte: ~8 mensagens por dia contra ~13 sem ele.
//
// QUEM ENTRA: quem deu sinal de vida (confirmou presença OU escreveu alguma
// coisa). Quem não deu nenhum sinal não chega aqui: a régua do SIM
// (eletropostoCobraSim) devolve o horário dele em 3 horas. Lembrar diariamente
// de uma reunião que ninguém confirmou seria falar sozinho por dias.
//
// E NUNCA no dia em que a pessoa marcou: quem combina hoje pra depois de amanhã
// acabou de receber a confirmação, e um lembrete horas depois é robô repetindo.
const DIARIO = { de: 9, ate: 14 };
const DIARIO_DIAS_ANTES = Number(process.env.EP_DIARIO_DIAS_ANTES || 3);
const DIARIO_POR_TICK = Number(process.env.EP_DIARIO_POR_TICK || 3);
const DIARIO_TETO_HORA = Number(process.env.EP_DIARIO_TETO_HORA || 10);
const DIARIO_TETO_DIA = Number(process.env.EP_DIARIO_TETO_DIA || 200);
const diarioDesligado = () => (process.env.EP_DIARIO_OFF || '').trim() === '1';

// ── NÃO ATENDIDO AUTOMÁTICO (ordem do Thiago, 14/08/2026) ───────────────────
// "Se a pessoa não confirma nenhuma das vezes, coloca em NÃO ATENDIDO
// automaticamente — ele passou por muita mensagem; se nem a de 1 hora antes,
// quando passar 15 minutos e nada, já joga essa condição."
//
// Então o gatilho é o toque de 1h + 15 min de silêncio. Na prática isso cai de
// 30 a 60 minutos ANTES da reunião: é uma PREVISÃO, não um fato consumado, e
// todo o desenho abaixo existe pra que essa previsão seja reversível.
//
// QUEM NÃO ENTRA, e por quê:
//   · quem confirmou presença (`presenca_confirmada_at`) — é o oposto do alvo;
//   · quem ESCREVEU qualquer coisa (marcador `ep_resposta:<id>`). "Qual o link?"
//     deixa `presenca_confirmada_at` nulo e não é ausência: é gente conversando.
//     Marcá-lo de ausente 40 minutos antes é a marca que alguém teria que
//     desfazer na mão;
//   · quem nunca recebeu o toque de 1h. Sem ele não existe o relógio que o
//     Thiago descreveu — e é o caso de quem marca em cima da hora (a LP vende
//     até 30 min antes), que fica de fora de propósito.
//
// O QUE A MARCA MEXE, de verdade:
//   · o toque de 5 MINUTOS CONTINUA SAINDO. É a mensagem de maior intenção do
//     fluxo ("ele já está te esperando") e calá-la transformaria a previsão em
//     profecia auto-realizável. Por isso a consulta abaixo aceita os dois
//     status e são os toques ANTERIORES que exigem `agendado`;
//   · o repasse de 12h PARA (`processar_repasses()` só olha `status='agendado'`),
//     o que é o certo: lead que não apareceu não é lead fresco pro próximo;
//   · o convite do grupo de frios NÃO dispara agora — ele pula quem tem reunião
//     futura —, e passa a valer depois que o horário passa, igual à marca de
//     um humano;
//   · a trava "um cliente, uma reunião" da LP solta: quem foi marcado consegue
//     escolher outro horário sozinho na página. É efeito colateral aceito.
//
// A VOLTA: se a pessoa aparecer falando depois da marca, o eletropostoRespostas
// devolve o status pra `agendado` — e só devolve o que ESTE robô marcou.
//
// Kill-switch próprio: EP_NAO_ATENDEU_AUTO_OFF=1.
const AUTO_NAO_ATENDEU_APOS_1H_MIN = 15;
const naoAtendeuAutoDesligado = () => (process.env.EP_NAO_ATENDEU_AUTO_OFF || '').trim() === '1';
/** Teto por rodada: marcar é barato (não manda mensagem), mas escrever 300
 *  fichas de uma vez num tick de 5 min é o tipo de coisa que ninguém revisa. */
const NAO_ATENDEU_POR_TICK = 20;

// ── O CORTE DAS 13H (ordem do Thiago, 19/08/2026) ───────────────────────────
// "O lead que não responder a primeira msg fica em amarelo; o segundo contato às
// 8h, se ele não atender até as 13h, coloca ele vermelho e libera o horário dele
// na agenda."
//
// O AMARELO não mora aqui: ele é DERIVADO na tela da agenda (silêncio desde a
// confirmação) e não muda o status de nada — é um aviso, não uma decisão. Quem
// escreve o sinal que a tela lê é o `eletropostoRespostas` (`lead_resposta_at`).
//
// O VERMELHO mora aqui, e é o mesmo `nao_atendeu` de sempre — a cor já existe na
// agenda. O que muda é O RELÓGIO: em vez de esperar o lembrete de 1h (que só cai
// 30-60 min antes da reunião), quem passou pelo SEGUNDO contato e não deu sinal
// nenhum até as 13h é dado como ausente COM HORAS DE ANTECEDÊNCIA. E é essa
// antecedência que importa: o horário volta pra vitrine da LP a tempo de ser
// vendido pra outra pessoa no mesmo dia (ver ioEletroposto `/agenda` e
// eletropostoVagas — os dois passaram a ignorar o vermelho).
//
// QUEM ENTRA, exatamente:
//   · recebeu o BOM DIA das 8h (carimbo `ep_agenda_sent:<id>:manha`). É o
//     "segundo contato" da ordem, literalmente. Quem marcou hoje pra hoje não
//     recebe bom dia e por isso NÃO entra neste corte — pra ele continua valendo
//     a régua do lembrete de 1h + 15 min, que é a que faz sentido em quem acabou
//     de chegar;
//   · a reunião é HOJE e AINDA NÃO ACONTECEU. Marcar quem já perdeu a hora não
//     libera horário nenhum — e é a régua de 1h que cobre esse caso;
//   · silêncio de verdade: sem `lead_resposta_at`, sem presença confirmada e sem
//     o marcador `ep_resposta:<id>`. Três provas da mesma coisa porque elas vêm
//     de bancos diferentes e uma pode falhar sozinha.
//
// A VOLTA é a mesma do não atendido automático: o carimbo
// `ep_nao_atendeu_auto:<id>` diz que a marca é do robô, e o agente de respostas
// devolve pra `agendado` se a pessoa aparecer. Isso é o que torna aceitável
// marcar às 13h uma reunião das 17h.
//
// Kill-switch próprio: EP_CORTE_13H_OFF=1 (volta a valer só a régua de 1h).
const CORTE_VERMELHO_H = 13;
const corteVermelhoDesligado = () => (process.env.EP_CORTE_13H_OFF || '').trim() === '1';

/** Ficha nova demais pra ser backlog: confirma na hora, sem fila e sem janela. */
const FRESCA_MS = 30 * 60 * 1000;
// BACKLOG_ANTECEDENCIA_MIN (120) saiu em 10/08/2026: era ele que fazia ficha
// represada a menos de 2h da reunião nunca receber confirmação nenhuma.
const BACKLOG_POR_TICK = 1;
const MAX_TOQUES_POR_TICK = 6;
// 30/08/2026: 7h por ordem do Thiago. Com 36 reuniões num dia só e a primeira às
// 09:00, a hora extra é o que faz o aviso da manhã caber antes do dia começar.
const JANELA_INICIO_H = 7;
const JANELA_FIM_H = 20;

const desligado = () => (process.env.EP_LEMBRETES_OFF || '').trim() === '1';

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}
function foraDaJanela(): boolean {
  const h = horaBrasilia();
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}

/** "2026-08-13" no fuso de Brasília. `en-CA` já sai nesse formato, e ele ordena
 *  como texto — é o que deixa "marcou num dia anterior" virar uma comparação
 *  direta, sem aritmética de fuso (o `-3h` na mão erra o dia na virada). */
function diaBRT(iso: string | number | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 && p.toLowerCase() !== 'lead' ? p : '';
}

function partesBRT(iso: string) {
  const d = new Date(iso);
  const pega = (opt: Intl.DateTimeFormatOptions, tipo: string) =>
    new Intl.DateTimeFormat('pt-BR', { ...opt, timeZone: BRT_TZ })
      .formatToParts(d).find(p => p.type === tipo)?.value ?? '';

  // Hora e minuto saem JUNTOS, do en-GB, e ainda levam padStart.
  // Por quê: `minute: '2-digit'` sozinho é ignorado pela spec do Intl (vira
  // numérico), e o resultado foi a reunião das 14:00 virar "14h0" na mensagem
  // que o lead recebeu em 04/08. en-GB garante o relógio de 24h com zero à
  // esquerda — pt-BR com hour12:false chega a devolver "24" pra meia-noite.
  const hm = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BRT_TZ,
  }).formatToParts(d);
  const parte = (t: string) => (hm.find(p => p.type === t)?.value ?? '').padStart(2, '0');
  const hora = parte('hour');

  return {
    dia: pega({ day: '2-digit' }, 'day'),
    mes: pega({ month: '2-digit' }, 'month'),
    hora: hora === '24' ? '00' : hora,
    minuto: parte('minute'),
    semana: pega({ weekday: 'long' }, 'weekday'),
  };
}

/** "quarta-feira, 05/08 às 15h00" — o lead precisa do dia da semana, é ele que
 *  a pessoa usa pra se situar; a data sozinha vira "ah, era hoje?". */
export function quandoPorExtenso(iso: string): string {
  const p = partesBRT(iso);
  return `${p.semana}, ${p.dia}/${p.mes} às ${p.hora}h${p.minuto}`;
}
/** "15h00" */
export function horaCurta(iso: string): string {
  const p = partesBRT(iso);
  return `${p.hora}h${p.minuto}`;
}

const comNome = (n: string) => (n ? `, ${n}` : '');

/** "5534991360172" → "(34) 99136-0172". Devolve '' pra qualquer coisa que não
 *  seja telefone BR completo — número torto na mensagem é pior que nenhum. */
export function telefoneBonito(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length !== 10 && d.length !== 11) return '';
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

/**
 * "pelo WhatsApp do *Diego*, o *(34) 99136-0172*" — e sem número cadastrado,
 * "pelo WhatsApp do *Diego*", nunca "(  ) -" nem "o **".
 *
 * Quem manda o link da chamada é o CONSULTOR, do número dele — não este chat.
 * A copy antiga dizia "o link cai aqui neste chat" nos três toques e mandava o
 * lead vigiar a janela errada.
 */
const deOnde = (quem: string, tel: string) => `pelo WhatsApp do *${quem}*${tel ? `, o *${tel}*` : ''}`;

// O aviso de atraso é pedido do dono: a reunião anterior estica quando vai pra
// fechamento, e sem essa linha o lead que espera 10 minutos acha que furaram.
const PODE_ATRASAR = 'a reunião de antes costuma esticar quando o cliente fecha';

// ── 1. AO MARCAR ────────────────────────────────────────────────────────────
// Serve pra ficha nova E pra backlog: nada aqui diz "acabei de receber", então a
// mesma copy funciona 30 segundos ou 3 dias depois do agendamento.
//
// Cinco bolhas, uma ideia cada — e é de propósito: o teto do `sendHuman` é 5, e
// as 8 bolhas da versão anterior eram reagrupadas na saída, colando o pedido de
// SIM no meio de um parágrafo. Bolha nova aqui custa uma linha embolada lá.
export function bolhasConfirmacao(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  // O TEXTO É O QUE O DONO ESCREVEU EM 16/09 (sem o pedido de material: desde
  // 15/09 toda reunião gera o estudo do local sozinha). O que mudou em 23/09 foi
  // só o FORMATO: de 3 bolhas para UMA mensagem completa, por ordem dele, e
  // porque em 23/09 a linha bateu 82 mensagens em 2 horas contra as 37 numa hora
  // que a bloquearam em agosto.
  return [
    `Oi${comNome(n)}! Aqui é da *NEXUS Eletropostos*. Sua reunião com o *${quem}* está confirmada: `
    + `*${quandoPorExtenso(quandoIso)}* (Brasília). É por vídeo e o link chega ${deOnde(quem, tel)}.\n\n`
    + 'Responde *SIM* que eu travo o horário. Se precisar desmarcar, me avisa antes que eu remarco: '
    + 'a procura está alta e o horário fica bloqueado.',
  ];
}

// ── 2. NA MANHÃ DO DIA (só pra quem marcou num dia anterior) ────────────────
// Não repete o que a confirmação já disse (é por vídeo, salva o contato, o que
// mandar): quem recebe isto já leu tudo aquilo. O trabalho aqui é outro — trazer
// a reunião de volta pra cabeça de quem marcou dias atrás, e abrir a porta do
// remarcar enquanto ainda dá pra encaixar outra pessoa no horário.
export function bolhasManha(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  // Mesmo conteúdo de 16/09 (sem o pedido de endereço), numa mensagem só.
  return [
    `Bom dia${comNome(n)}! Hoje é o dia: sua reunião de eletroposto é *${horaCurta(quandoIso)}*, `
    + `com o *${quem}*, e o link chega no WhatsApp dele${tel ? `, *${tel}*` : ''}. `
    + 'Se não der mais, me fala agora que eu remarco: a procura está alta e o horário fica bloqueado.',
  ];
}

// ── 2.5. O LEMBRETE DIÁRIO (nos dias ENTRE o agendamento e a reunião) ───────
// Uma bolha só, e é a regra mais importante desta mensagem: ela vai aparecer
// dois ou três dias seguidos, e o que é curto num dia é insuportável em três.
// Não repete nada que a confirmação já disse (vídeo, link, material) porque o
// trabalho dela é um só: manter a data viva na cabeça da pessoa e deixar a porta
// do remarcar aberta enquanto ainda dá pra revender o horário.
export function bolhaDiario(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  ehAmanha: boolean,
  /** Ele ainda não confirmou presença: a mesma bolha pede o SIM, porque quem
   *  confirma some 4x menos (6% de ausência contra 25% de quem só respondeu). */
  faltaConfirmar = false,
): string {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  // "amanhã, às 14h00" no lugar da data por extenso: é assim que a pessoa pensa
  // na véspera, e ler "quarta-feira, 24/09" na terça exige que ela faça a conta.
  const quando = ehAmanha ? `*amanhã, às ${horaCurta(quandoIso)}*` : `*${quandoPorExtenso(quandoIso)}*`;
  const fecho = faltaConfirmar
    ? 'Me responde *SIM* que eu confirmo, ou me fala se precisar mudar que eu remarco.'
    : 'Se precisar mudar, me avisa que eu remarco.';
  return `Oi${comNome(n)}! Lembrete rápido: sua reunião com o *${quem}* é ${quando}. ${fecho}`;
}

// ── 3. 1 HORA ANTES ─────────────────────────────────────────────────────────
export function bolhas1h(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  return [
    `Oi${comNome(n)}! Falta *1 hora*: sua reunião com o *${quem}* é às *${horaCurta(quandoIso)}*, por vídeo. `
    + `O link cai ${deOnde(quem, tel)}, fica de olho lá e separa um canto com internet.\n\n`
    + `Se ele atrasar uns minutos, segura aí: ${PODE_ATRASAR}. Se está de pé, responde *SIM*. `
    + 'Se aconteceu um imprevisto, me avisa que eu remarco.',
  ];
}

// ── 4. 5 MINUTOS ANTES ──────────────────────────────────────────────────────
export function bolhas5min(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  return [
    `${n ? n + ', é' : 'É'} agora! Sua reunião começa às *${horaCurta(quandoIso)}* e o *${quem}* já está te esperando. `
    + `O link cai no WhatsApp dele${tel ? `, *${tel}*` : ''} a qualquer momento: é só clicar e entrar. `
    + `Se demorar uns minutos, não desiste: ${PODE_ATRASAR}.`,
  ];
}

interface Ficha {
  id: number;
  vendedor_nome: string | null;
  quando: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  created_at: string;
  created_by: string | null;
  status: string | null;
  confirmacao_at: string | null;
  lembrete_1h_at: string | null;
  lembrete_5min_at: string | null;
  presenca_confirmada_at: string | null;
  /** Última vez que o LEAD escreveu (coluna nova, 19/08/2026). Nulo = silêncio —
   *  é o que pinta o card de amarelo na agenda e o que o corte das 13h exige. */
  lead_resposta_at: string | null;
  historico: string | null;
}

export type ToquePrevisto = { id: number; cliente: string; toque: '5min' | '1h' | 'manha' | 'confirmacao' | 'diario'; quando: string; bolhas: string[] };

export type ResultadoAgendaEp = {
  confirmacoes: number;
  lembretes_manha: number;
  /** Lembretes dos dias ENTRE o agendamento e a reunião (um por dia, até 3). */
  lembretes_diarios: number;
  lembretes_1h: number;
  lembretes_5min: number;
  /** Fichas que viraram NÃO ATENDIDO sozinhas nesta rodada. */
  nao_atendeu: number;
  /** Fichas em que o cliente AVISOU que não vem, e por isso nenhum toque saiu. */
  avisou_que_nao_vem: number;
  /** Destas, as que caíram pelo CORTE DAS 13H (silêncio depois do 2º contato).
   *  Contadas à parte porque são as que LIBERAM horário na vitrine — a outra
   *  régua marca perto da reunião, quando já não há o que revender. */
  vermelho_13h: number;
  erros: number;
  motivo?: string;
  previa?: ToquePrevisto[];
};

/**
 * Quem, desta lista, JÁ recebeu o bom dia. O carimbo lido é o MESMO que o
 * `entregar` grava pro teto anti-ban (`ep_agenda_sent:<id>:manha`) — ledger que
 * já existe, sem coluna nova em `agendamentos`.
 *
 * Coluna nova seria pior aqui: o `select` da consulta lista as colunas na mão,
 * então entre o deploy do código e a migração rodar a consulta INTEIRA falha e
 * os quatro toques param — inclusive a confirmação de quem acabou de marcar.
 *
 * Leitura falhou? Devolve `null`, e quem chama trata como "todo mundo já
 * recebeu". Fail-closed de propósito: mandar bom dia duas vezes é pior que não
 * mandar — o toque de 1h ainda pega a pessoa no mesmo dia.
 */
async function jaRecebeuManha(ids: number[]): Promise<Map<number, string> | null> {
  if (!ids.length) return new Map();
  try {
    const { data, error } = await supabase
      .from('system_state').select('key, updated_at')
      .in('key', ids.map(id => `${EP_AGENDA_PREFIX}${id}:manha`));
    if (error) throw error;
    return new Map((data ?? []).map(r => [Number(String(r.key).split(':')[1]), String(r.updated_at ?? '')]));
  } catch (err) {
    logger.error('ep-agenda', 'ler carimbo do bom dia falhou — ninguém recebe nesta rodada', err);
    return null;
  }
}

/**
 * Quem, desta lista, já recebeu o lembrete DE HOJE.
 *
 * Chave por DIA (`ep_agenda_sent:<id>:d2026-09-23`), não um contador: o lembrete
 * é "um por dia" e a data no nome é o que torna isso verdade mesmo se o tick
 * rodar dez vezes, se o GitHub e a Vercel dispararem juntos, ou se a ficha for
 * remarcada no meio do caminho.
 *
 * Leitura falhou? Devolve `null` e ninguém recebe nesta rodada: mandar o mesmo
 * lembrete duas vezes no mesmo dia é pior que não mandar, porque quem já está
 * dizendo sim passa a receber robô repetindo.
 */
async function jaRecebeuCarimboDoDia(ids: number[], hoje: string): Promise<Set<number> | null> {
  if (!ids.length) return new Set();
  try {
    const { data, error } = await supabase
      .from('system_state').select('key')
      .in('key', ids.map(id => `${EP_AGENDA_PREFIX}${id}:d${hoje}`));
    if (error) throw error;
    return new Set((data ?? []).map(r => Number(String(r.key).split(':')[1])));
  } catch (err) {
    logger.error('ep-agenda', 'ler carimbo do lembrete diário falhou — ninguém recebe nesta rodada', err);
    return null;
  }
}

/**
 * O bom dia saiu HOJE?
 *
 * A data importa por causa de uma ficha que muda de dia SEM passar por aqui: a
 * `processar_repasses()` (SQL, no banco) move o `quando` pro próximo dia útil
 * quando o card fica 12h sem ação — e ela não conhece carimbo nenhum do
 * system_state, então o `ep_agenda_sent:<id>:manha` de ontem sobrevive à mudança.
 * (O robô de remarcação apaga; o repasse do banco não.)
 *
 * Sem olhar a data isso produziria as duas metades erradas: a ficha repassada
 * NUNCA receberia o bom dia do dia novo, e — pior — o corte das 13h a marcaria de
 * ausente às 13h desse dia novo, alegando um segundo contato que não aconteceu.
 *
 * Carimbo sem data legível (não deveria existir: o upsert sempre grava
 * `updated_at`) conta como recebido pro ENVIO, que é o lado conservador ali, e
 * não conta pro CORTE, que é o lado conservador aqui.
 */
function bomDiaSaiuHoje(mapa: Map<number, string>, id: number, hoje: string): boolean {
  const em = mapa.get(id);
  return !!em && diaBRT(em) === hoje;
}

/** nome do consultor → WhatsApp dele, direto do cadastro do CRM. */
export async function carregarConsultores(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data, error } = await supabaseGerador.from('consultores').select('nome, whatsapp').limit(100);
    if (error) throw error;
    for (const c of data ?? []) {
      if (c?.nome && c?.whatsapp) mapa.set(String(c.nome), String(c.whatsapp));
    }
  } catch (err) {
    logger.error('ep-agenda', 'ler consultores falhou — aviso sai sem o telefone', err);
  }
  return mapa;
}

const zero = (motivo?: string): ResultadoAgendaEp =>
  ({ confirmacoes: 0, lembretes_manha: 0, lembretes_diarios: 0, lembretes_1h: 0, lembretes_5min: 0, nao_atendeu: 0, avisou_que_nao_vem: 0, vermelho_13h: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/**
 * Quem passou por todos os toques e não confirmou nada vira NÃO ATENDIDO.
 *
 * Não envia mensagem nenhuma — é só o status na ficha, pro consultor não ficar
 * esperando e pro card sair da fila de quem ainda está em jogo. As condições e
 * os efeitos colaterais estão documentados no bloco de constantes lá em cima.
 *
 * A marca vai junto com uma linha no `historico`, no mesmo formato que a
 * `processar_repasses()` usa: quem abre o card no CRM vê QUEM decidiu e QUANDO,
 * em vez de um status que mudou sozinho sem explicação.
 */
/**
 * O `lembrete_1h_at` desta ficha é do horário QUE ESTÁ NELA AGORA?
 *
 * Achado nos dados de produção antes de a regra rodar pela primeira vez: existe
 * ficha com o lembrete de 1h carimbado ONTEM e a reunião marcada pra HOJE —
 * alguém moveu o horário na mão pelo CRM, e ali a flag não é limpa (só o robô de
 * remarcação limpa). Sem esta guarda, essa ficha seria dada como ausente na hora,
 * horas antes da reunião de hoje, por causa de um aviso de outro dia.
 *
 * O toque de 1h sai de 45 a 75 min antes; 2 horas de folga cobrem qualquer atraso
 * do cron com sobra e ainda assim recusam um carimbo do dia anterior.
 */
const JANELA_LEMBRETE_DA_REUNIAO_MS = 2 * 60 * 60 * 1000;
function lembreteEhDestaReuniao(f: Ficha): boolean {
  if (!f.lembrete_1h_at || !f.quando) return false;
  const distancia = new Date(f.quando).getTime() - new Date(f.lembrete_1h_at).getTime();
  return distancia >= 0 && distancia <= JANELA_LEMBRETE_DA_REUNIAO_MS;
}

/**
 * Quem ESCREVEU alguma coisa (não é ausente, é gente conversando) e quem este
 * robô JÁ marcou (o status pode ter voltado pra `agendado` na mão de alguém —
 * refazer a marca seria brigar com o humano).
 *
 * Uma leitura só, compartilhada pelas duas réguas de marcação: elas rodam no
 * mesmo tick e perguntam exatamente a mesma coisa ao mesmo banco.
 */
async function marcadoresDeSilencio(): Promise<{ respondeuEm: Map<number, string>; jaMarcado: Set<number> }> {
  const [{ data: falaram }, { data: marcados }] = await Promise.all([
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_RESPOSTA_PREFIX}%`).limit(1000),
    supabase.from('system_state').select('key').like('key', `${EP_NAO_ATENDEU_PREFIX}%`).limit(1000),
  ]);
  return {
    respondeuEm: new Map((falaram ?? []).map(m =>
      [Number(String(m.key).slice(EP_RESPOSTA_PREFIX.length)), String(m.updated_at ?? '')])),
    jaMarcado: new Set((marcados ?? []).map(m => Number(String(m.key).slice(EP_NAO_ATENDEU_PREFIX.length)))),
  };
}

/**
 * A pessoa falou NESTE ciclo?
 *
 * O `lead_resposta_at` mora na ficha e é zerado quando o ciclo recomeça, então
 * ele já responde certo sozinho. O marcador `ep_resposta:<id>` não: ele mora no
 * outro projeto, guarda só o id e NUNCA é apagado.
 *
 * Isso bastava enquanto uma ficha tinha um ciclo só. Desde 20/08 o
 * `eletropostoReagendaAuto` devolve pra agenda quem não apareceu e recomeça a
 * régua do zero — e aí um "SIM" de três dias atrás calaria as DUAS marcações de
 * vermelho pra sempre: a ficha voltaria pro dia seguinte e nunca mais poderia
 * ser dada como ausente. Ela ficaria `agendado` até o repasse de 12h pegá-la,
 * trocar o consultor e jogá-la num horário fora da grade.
 *
 * É a mesma armadilha do carimbo do bom dia (19/08) e a saída é a mesma: o
 * carimbo só vale a partir do começo do ciclo — e o começo do ciclo é a
 * confirmação que está na ficha AGORA.
 *
 * Ficha ainda sem `confirmacao_at` (backlog, ou o instante entre remarcar e
 * avisar): o marcador vale cheio. É o lado conservador — não dar de ausente
 * quem talvez esteja falando.
 */
function falouNesteCiclo(f: Ficha, respondeuEm: Map<number, string>): boolean {
  if (f.lead_resposta_at) return true;
  const em = respondeuEm.get(f.id);
  if (!em) return false;
  return !f.confirmacao_at || em >= f.confirmacao_at;
}

/**
 * A pessoa falou HOJE?
 *
 * Esta é a régua do CORTE DAS 13H, e ela é diferente do `falouNesteCiclo` de
 * propósito, por um buraco medido em 22/09/2026 nas reuniões dos últimos 30 dias:
 *
 *   confirmou SIM : 77 reuniões,  5 não atenderam ( 6%), 41 andaram na venda
 *   só respondeu  : 48 reuniões, 12 não atenderam (25%), 17 andaram na venda
 *   ficou mudo    : 35 reuniões, 14 não atenderam (40%),  ZERO andaram na venda
 *
 * O grupo do meio é o problema. `lead_resposta_at` guarda a ÚLTIMA vez que o lead
 * escreveu, e o `falouNesteCiclo` aceita qualquer data: quem perguntou "qual o
 * link?" três dias atrás e sumiu ficava imune às duas réguas de vermelho para
 * sempre. O horário dele só morria com ele, e em 1 de cada 4 vezes ele não
 * aparecia. O mudo perde o horário em 3 horas (régua do SIM) e este não perdia
 * nunca, sendo que a diferença entre os dois é uma frase de três dias atrás.
 *
 * Agora vale a ordem de 19/08 ao pé da letra: "recebeu o segundo contato às 8h e
 * não deu sinal até as 13h". SINAL É DE HOJE. Quem confirmou presença continua
 * fora disto (é outro campo, e é o grupo de 6%), e quem aparecer falando depois
 * volta pra agenda pelo `eletropostoRespostas`, como sempre.
 */
function falouHoje(f: Ficha, respondeuEm: Map<number, string>, hoje: string): boolean {
  if (f.lead_resposta_at && diaBRT(f.lead_resposta_at) === hoje) return true;
  const em = respondeuEm.get(f.id);
  return !!em && diaBRT(em) === hoje;
}

/** Escreve a marca: status, linha no histórico e carimbo de "foi o robô".
 *  Devolve `false` se o update não pegou (falha ou corrida com gente). */
async function escreverNaoAtendeu(f: Ficha, motivo: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: BRT_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  const linha = `[${carimbo} · Sistema] 🚫 ${motivo}`;
  const { error } = await supabaseGerador.from('agendamentos')
    .update({
      status: 'nao_atendeu',
      historico: f.historico ? `${linha}\n\n${f.historico}` : linha,
    })
    .eq('id', f.id)
    // Corrida com gente: se alguém mexeu no status entre a leitura e agora,
    // quem manda é a pessoa. O update simplesmente não pega nenhuma linha.
    .eq('status', 'agendado');
  if (error) {
    logger.error('ep-agenda', 'marcar não atendido falhou', { id: f.id, erro: String(error) });
    return false;
  }
  await supabase.from('system_state').upsert(
    { key: `${EP_NAO_ATENDEU_PREFIX}${f.id}`, value: { em: nowIso, lembrete_1h_at: f.lembrete_1h_at, quando: f.quando }, updated_at: nowIso },
    { onConflict: 'key' },
  ).then(undefined, (e: unknown) => logger.error('ep-agenda', 'carimbo do não atendido falhou', { id: f.id, erro: String(e) }));
  return true;
}

async function marcarNaoAtendeuAutomatico(
  fichas: Ficha[], agora: number, dry: boolean,
  marcadores: { respondeuEm: Map<number, string>; jaMarcado: Set<number> } | null,
): Promise<number> {
  if (naoAtendeuAutoDesligado()) return 0;

  const limite = agora - AUTO_NAO_ATENDEU_APOS_1H_MIN * 60_000;
  const candidatos = fichas.filter(f =>
    f.status === 'agendado'
    && !!f.lembrete_1h_at
    && new Date(f.lembrete_1h_at).getTime() <= limite
    && lembreteEhDestaReuniao(f)
    && !f.presenca_confirmada_at);
  if (!candidatos.length || !marcadores) return 0;

  // As duas provas do silêncio ficam juntas no `falouNesteCiclo`: a coluna da
  // ficha e o marcador do outro projeto dizem a mesma coisa, e quando discordam
  // quem tiver visto a pessoa falar NESTE ciclo ganha.
  const alvos = candidatos
    .filter(f => !falouNesteCiclo(f, marcadores.respondeuEm) && !marcadores.jaMarcado.has(f.id))
    .slice(0, NAO_ATENDEU_POR_TICK);
  if (!alvos.length) return 0;
  if (dry) return alvos.length;

  let n = 0;
  for (const f of alvos) {
    const ok = await escreverNaoAtendeu(f, 'Não atendido automático: passou por todos os avisos '
      + `e não confirmou nem ${AUTO_NAO_ATENDEU_APOS_1H_MIN} min depois do lembrete de 1 hora.`);
    if (ok) n++;
  }
  if (n) logger.info('ep-agenda', `${n} ficha(s) viraram NÃO ATENDIDO sozinhas`);
  return n;
}

/**
 * O CORTE DAS 13H — quem levou o segundo contato e não deu sinal até as 13h vira
 * vermelho, e o horário dele volta pra agenda ainda a tempo de ser vendido.
 *
 * A régua inteira está documentada no bloco de constantes lá em cima. O que vale
 * repetir aqui é o desenho: esta função NÃO manda mensagem nenhuma e NÃO cancela
 * nada — ela muda o status, escreve no histórico e carimba que a marca é do robô.
 * Quem fala com a pessoa depois disso é o `eletropostoReagendaAuto`, que usa
 * exatamente este vermelho como gatilho: 45 min depois do horário perdido ele
 * remarca a ficha sozinho pro próximo dia útil e recomeça esta régua do zero
 * (ordem do Thiago, 20/08/2026 — até 2 reagendamentos, e SÓ pra lead quente).
 */
async function marcarVermelhoDoCorte(
  fichas: Ficha[], agora: number, dry: boolean,
  marcadores: { respondeuEm: Map<number, string>; jaMarcado: Set<number> } | null,
): Promise<number> {
  if (corteVermelhoDesligado()) return 0;
  if (horaBrasilia() < CORTE_VERMELHO_H) return 0;

  const hoje = diaBRT(agora);
  const candidatos = fichas.filter(f =>
    f.status === 'agendado'
    && !!f.quando
    && diaBRT(f.quando) === hoje
    // Ainda por acontecer: é O HORÁRIO que este corte existe pra devolver. Quem
    // já perdeu a hora não libera nada e continua com a régua do lembrete de 1h.
    && new Date(f.quando).getTime() > agora
    && !f.presenca_confirmada_at);
  if (!candidatos.length || !marcadores) return 0;

  // O SEGUNDO CONTATO é o bom dia das 8h, e o carimbo dele é a única prova de que
  // saiu (ele é o único toque sem coluna em `agendamentos`). Leitura falhou?
  // `jaRecebeuManha` devolve null e ninguém é marcado — fail-closed, igual ao
  // envio: marcar de ausente quem talvez não tenha recebido o 2º toque seria a
  // pior das duas metades do erro.
  const recebeuBomDia = await jaRecebeuManha(candidatos.map(f => f.id));
  if (!recebeuBomDia) return 0;

  const alvos = candidatos
    .filter(f => bomDiaSaiuHoje(recebeuBomDia, f.id, hoje)
      && !falouHoje(f, marcadores.respondeuEm, hoje) && !marcadores.jaMarcado.has(f.id))
    .slice(0, NAO_ATENDEU_POR_TICK);
  if (!alvos.length) return 0;
  if (dry) return alvos.length;

  let n = 0;
  for (const f of alvos) {
    const ok = await escreverNaoAtendeu(f, `Sem sinal HOJE até as ${CORTE_VERMELHO_H}h: recebeu o bom dia do dia `
      + 'e não respondeu nem confirmou presença. O horário voltou pra agenda.');
    if (ok) n++;
  }
  if (n) logger.info('ep-agenda', `${n} ficha(s) viraram VERMELHO no corte das ${CORTE_VERMELHO_H}h — horário liberado`);
  return n;
}

/**
 * Roda a cada ~5 min dentro do /cron/process-messages.
 * Um toque por lead por rodada, do mais urgente pro menos: 5min > 1h > confirmação.
 * `dry` roda a decisão inteira e devolve o que SAIRIA, sem enviar e sem marcar flag.
 */
// ─────────────────────────────────────────────────────────────────────────────
// ELE AVISOU QUE NÃO VEM — e a régua precisa ficar sabendo.
//
// O caso real, medido em 14 dias: 8 de cada 10 pessoas que desmarcaram levaram
// "é agora! o Diego já está te esperando" DEPOIS de terem avisado, quase sempre
// entre meia e uma hora depois. Não houve remarcação nenhuma no meio — o aviso
// simplesmente não era lido por este módulo.
//
// Por que passava batido: a régua só entendia a palavra "SIM". Qualquer outra
// frase não desarmava nada, e o `status = 'nao_atendeu'` só é marcado DEPOIS da
// hora da reunião, quando o estrago já foi feito. O cliente foi educado, avisou
// com antecedência, e a resposta foi uma carteirada de "você faltou".
//
// ── Por que regex e não IA ──
// Foi medido em 30 dias de conversa real desta linha: pega 38 avisos e nenhum
// falso positivo grave. Um classificador aqui seria um modelo decidindo CALAR
// um lembrete, e lembrete calado por engano faz a pessoa perder a reunião. A
// regra desta casa vale igual aqui: modelo pode manter o silêncio, nunca criar.
//
// As duas exclusões não são enfeite. "Não consigo ouvir o áudio" e "não consegui
// abrir o link" são de quem está TENTANDO entrar, e calar o lembrete deles é o
// oposto do que se quer. "Cancelar o cadastro" e "não consigo ajudar com isso"
// (o robô do outro lado) também saem.
// ─────────────────────────────────────────────────────────────────────────────
const AVISOU_QUE_NAO_VEM =
  /(\bremarc|\bcancel\w*\b.{0,25}(reuni|hor[áa]rio|apresenta|chamada)|^\s*cancela\w*\b|n[ãa]o (vou|irei|poderei|vou poder|vou conseguir|consigo) .{0,20}(particip|comparec|reuni|apresenta)|(hoje|agora|amanh[ãa]) .{0,12}n[ãa]o (consigo|vou|d[áa]|posso)|n[ãa]o (consigo|vou conseguir|posso) (hoje|agora|amanh[ãa])|n[ãa]o vou conseguir\b|\b[ie]mprevisto|vamos deixar pra|outro (dia|hor[áa]rio)|n[ãa]o vou poder\b)/i;

/** Quem está TENTANDO entrar, não desmarcando. */
const FALA_DE_ACESSO = /(ouvir|[áa]udio|som|c[âa]mera|abrir o link|acessar o link)/i;
const NAO_E_A_REUNIAO = /(cancelar o (cadastro|plano|contrato|email)|n[ãa]o consigo ajudar)/i;

export function ehAvisoDeQueNaoVem(texto: string): boolean {
  const t = String(texto || '').trim();
  if (!t) return false;
  if (FALA_DE_ACESSO.test(t) || NAO_E_A_REUNIAO.test(t)) return false;
  return AVISOU_QUE_NAO_VEM.test(t);
}

/**
 * Lê o inbound da linha e devolve, por ficha, o aviso de que o cliente não vem.
 *
 * Duas bases diferentes: a ficha mora no `supabaseGerador` e a mensagem no
 * `supabase` principal, então não dá join — casa por DDD + 8 últimos em JS, o
 * mesmo caminho que o eletropostoRespostas já faz.
 *
 * Só conta o que o cliente disse DEPOIS de a ficha existir: frase de uma
 * reunião velha não pode calar o lembrete da nova.
 *
 * Fail-open: leitura falhou, ninguém é marcado, e os toques saem como saíam.
 * Calar a agenda inteira porque o banco piscou é pior que o bug que isto conserta.
 */
async function quemAvisouQueNaoVem(
  fichas: Ficha[],
): Promise<Map<number, { texto: string; quando: string }>> {
  const achados = new Map<number, { texto: string; quando: string }>();
  const comTelefone = fichas.filter(f => f.cliente_telefone && f.quando);
  if (!comTelefone.length) return achados;

  const porChave = new Map<string, Ficha[]>();
  let piso = Date.now();
  for (const f of comTelefone) {
    const k = chaveContato(String(f.cliente_telefone));
    if (!k) continue;
    porChave.set(k, [...(porChave.get(k) ?? []), f]);
    piso = Math.min(piso, new Date(f.created_at).getTime());
  }
  if (!porChave.size) return achados;

  try {
    const { data, error } = await supabase
      .from('wa_mensagens')
      .select('telefone, texto, momment')
      .eq('from_me', false)
      .eq('is_group', false)
      .eq('instancia', INSTANCE_ID_IO)
      .gte('momment', new Date(piso).toISOString())
      .order('momment', { ascending: true })
      .limit(2000);
    if (error) throw error;

    for (const m of (data ?? []) as Array<{ telefone: string; texto: string | null; momment: string }>) {
      if (!ehAvisoDeQueNaoVem(m.texto ?? '')) continue;
      const k = chaveContato(m.telefone);
      if (!k) continue;
      for (const f of porChave.get(k) ?? []) {
        // Depois de a ficha nascer e antes da hora da reunião: é sobre ESTA reunião.
        if (m.momment <= f.created_at) continue;
        if (f.quando && m.momment > f.quando) continue;
        achados.set(f.id, { texto: String(m.texto ?? '').slice(0, 160), quando: m.momment });
      }
    }
  } catch (err) {
    logger.error('ep-agenda', 'leitura dos avisos de "não vou" falhou — os toques saem normalmente', err);
  }
  return achados;
}

/**
 * Passa a bola pro humano quando o cliente avisa que não vem.
 *
 * Calar o robô resolve metade do problema. A outra metade é o Diego sentado
 * esperando alguém que avisou com uma hora de antecedência — e essa parte só
 * se resolve com gente sabendo. Por isso o robô para de falar com o cliente E
 * fala com o dono da ficha, na mesma rodada.
 *
 * Uma vez por ficha: o carimbo em `system_state` é o que impede a agenda de
 * cobrar o mesmo consultor a cada 5 minutos até a hora da reunião.
 */
async function avisarConsultorQueNaoVem(
  ag: Ficha,
  aviso: { texto: string; quando: string },
  telDoConsultor: string | null,
): Promise<void> {
  const marca = `ep_agenda_naovem:${ag.id}`;
  const { data: ja } = await supabase
    .from('system_state').select('key').eq('key', marca).limit(1);
  if (ja && ja.length) return;

  const quandoBRT = new Date(ag.quando!).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const texto = [
    '🟠 *DESMARCOU — eletroposto*',
    '',
    `*Cliente:* ${ag.cliente_nome || 'sem nome'}`,
    `*Reunião:* ${quandoBRT}${ag.vendedor_nome ? ` (${ag.vendedor_nome})` : ''}`,
    `*WhatsApp:* wa.me/${String(ag.cliente_telefone || '').replace(/\D/g, '')}`,
    '',
    `*Ele escreveu:* "${aviso.texto}"`,
    '',
    '_Os lembretes automáticos foram cortados pra esta reunião. Remarcar ou cancelar é com você._',
  ].join('\n');

  const destinos = new Set<string>(Object.values(EQUIPE));
  if (telDoConsultor) destinos.add(telDoConsultor.replace(/\D/g, ''));
  await Promise.allSettled([...destinos].filter(Boolean).map(n => sendWhatsApp(n, texto, 'io')));

  await supabase.from('system_state').upsert(
    { key: marca, value: { em: new Date().toISOString(), texto: aviso.texto }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  logger.info('ep-agenda', `${ag.id} desmarcou — toques cortados e consultor avisado`);
}

export async function runEletropostoAgendaTick(opts: { dry?: boolean } = {}): Promise<ResultadoAgendaEp> {
  if (desligado()) return zero('desligado');

  const agora = Date.now();
  // Piso 5 min no passado: a janela do toque de 5min aceita até -3 min, e sem esse
  // piso a reunião que acabou de começar sumia da consulta antes do aviso sair.
  const piso = new Date(agora - 5 * 60_000).toISOString();
  const teto = new Date(agora + 30 * 24 * 3600_000).toISOString();

  // O filtro de produto NÃO vai na consulta: vem depois, por família
  // (ehOrigemEletroposto). Com `.in` numa lista fixa, toda origem de EP que
  // alguém esquecesse de cadastrar aqui virava reunião sem confirmação nenhuma —
  // foi o que aconteceu com a prospecção (EP Prospec ficou de fora até 06/08).
  // O limite subiu porque a consulta agora traz solar junto e ele é o volume.
  // `nao_atendeu` entra junto com `agendado` por UM motivo: o toque de 5 minutos
  // tem que continuar saindo pra quem o próprio robô marcou de ausente (ver o
  // bloco do NÃO ATENDIDO AUTOMÁTICO lá em cima). Os toques anteriores checam
  // `agendado` um a um — cancelado e sem_interesse seguem sem receber nada.
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, created_at, created_by, status, confirmacao_at, lembrete_1h_at, lembrete_5min_at, presenca_confirmada_at, lead_resposta_at, historico')
    .in('status', ['agendado', 'nao_atendeu'])
    .gte('quando', piso)
    .lte('quando', teto)
    .order('quando', { ascending: true })
    .limit(600);

  if (error) {
    logger.error('ep-agenda', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }
  // Aqui é que entra o produto. Ficha de solar não passa: a copy é de
  // eletroposto e o solar tem módulo próprio (desligado desde 28/07).
  //
  // E aqui sai a AGENDA FECHADA (os dias em que os sócios estão fora). Um filtro só, no
  // ponto em que as sete réguas deste módulo já se abastecem, porque todas elas
  // estariam erradas nesses dias: a confirmação combinaria uma reunião que não
  // vai ter, o bom dia diria "hoje é o dia", o toque de 1h prometeria um link que
  // ninguém vai mandar, e as duas réguas de vermelho (corte das 13h e o não
  // atendido automático) dariam de AUSENTE o cliente — quando quem não apareceu
  // fomos nós. AVISAR quem já estava marcado nesses dias é trabalho de outro
  // módulo, e hoje não existe nenhum: fechar dia sem escrever esse aviso deixa o
  // lead esperando por uma reunião que ninguém vai fazer.
  const fichas = ((data ?? []) as Ficha[])
    .filter(f => ehOrigemEletroposto(f.created_by))
    .filter(f => !agendaFechadaNoIso(f.quando));
  if (!fichas.length) return zero('nenhuma_reuniao');

  // Telefone do consultor: fonte é a tabela `consultores` (a mesma que o CRM usa),
  // não uma lista fixa aqui — número trocado no cadastro tem que valer na mensagem
  // seguinte. Falhou a leitura? A frase do telefone some e o resto do aviso sai.
  const telPorConsultor = await carregarConsultores();

  // Quem avisou que não vem. Lido ANTES dos toques porque é justamente o que
  // impede o "é agora" de cair em cima de quem já desmarcou.
  const desmarcaram = await quemAvisouQueNaoVem(fichas);

  // ── AS DUAS RÉGUAS DE "ELE NÃO VEM" ───────────────────────────────────────
  // Rodam ANTES dos toques e num laço próprio: não mandam mensagem, então não
  // gastam o teto de toques da rodada nem passam pelo teto anti-ban da linha.
  //
  // Elas não competem — cobrem gente diferente. O CORTE DAS 13H pega quem passou
  // pelo bom dia do dia e ainda tem reunião pela frente (e é o único que devolve
  // horário vendável); a régua do LEMBRETE DE 1H pega o resto, perto da hora.
  // Uma leitura de marcadores serve às duas.
  const marcadores = await marcadoresDeSilencio().catch(err => {
    logger.error('ep-agenda', 'ler marcadores de silêncio falhou — ninguém é marcado nesta rodada', err);
    return null;
  });
  const vermelho13h = await marcarVermelhoDoCorte(fichas, agora, opts.dry === true, marcadores);
  const naoAtendeu = await marcarNaoAtendeuAutomatico(fichas, agora, opts.dry === true, marcadores);

  const foraDeHorario = foraDaJanela();
  let confirmacoes = 0, lManha = 0, lDiario = 0, l1h = 0, l5min = 0, erros = 0, backlog = 0, toques = 0;
  let naoVem = 0;
  /** Quem qualificou pro bom dia e ficou de fora pelo teto da linha. Contado e
   *  logado porque, sem isso, "a manhã inteira barrada no teto" e "ninguém tinha
   *  reunião hoje" são o MESMO silêncio no log — e o primeiro é um bom dia que
   *  nunca sai, já que a janela fecha ao meio-dia. */
  let manhaSegurados = 0;
  /** O mesmo, para a confirmação. Sem este contador o travamento de 02/09 é
   *  invisível: "13 fichas esperando o teto" e "ninguém para confirmar" saem
   *  como o mesmo silêncio, e foi preciso ir ao banco contar system_state à mão
   *  para descobrir qual dos dois era. Confirmação segurada é a falha mais cara
   *  do módulo — o lead fica sem saber com quem, nem a que horas. */
  let confirmaSegurados = 0;
  /** O mesmo, pro lembrete diário. Ele é o último da fila e o primeiro a ser
   *  segurado num dia cheio: sem contador, isso viraria "ninguém tinha reunião
   *  perto" no log, que é uma frase falsa. */
  let diarioSegurados = 0;
  const previa: ToquePrevisto[] = [];

  // ── Quem entra no bom dia de hoje ──────────────────────────────────────────
  // Reunião é HOJE, foi marcada num dia ANTERIOR (quem marcou hoje pra hoje já
  // teve a confirmação há pouco — repetir seria a mesma informação duas vezes em
  // horas) e ainda está longe o bastante pra não pisar no toque de 1h.
  //
  // A comparação é `created_at < quando`, e não "a ficha é de ontem", DE PROPÓSITO:
  // quem marcou hoje pra hoje e depois REMARCOU pra semana que vem (o robô de
  // eletropostoRemarcar move o `quando` e não toca no `created_at`) passa a
  // qualificar — e tem que passar, porque agora ele é exatamente o caso que o bom
  // dia existe pra cobrir: combinou num dia, aparece em outro.
  const horaAgora = horaBrasilia();
  const naJanelaDaManha = horaAgora >= MANHA.de && horaAgora < MANHA.ate;
  const hojeBRT = diaBRT(agora);
  const ehDaManha = (f: Ficha): boolean =>
    naJanelaDaManha && !!f.quando &&
    diaBRT(f.quando) === hojeBRT &&
    diaBRT(f.created_at) < diaBRT(f.quando) &&
    (new Date(f.quando).getTime() - agora) / 60_000 >= MANHA_ANTECEDENCIA_MIN;

  // Uma leitura por rodada, só na janela da manhã e só dos candidatos — não é
  // varredura do system_state inteiro.
  const candidatosManha = naJanelaDaManha ? fichas.filter(ehDaManha) : [];
  const manhaFeita = await jaRecebeuManha(candidatosManha.map(f => f.id));

  // ── Quem entra no LEMBRETE DIÁRIO de hoje ─────────────────────────────────
  // A reunião é de um dia FUTURO, está dentro dos últimos DIARIO_DIAS_ANTES dias
  // antes dela, a pessoa marcou num dia anterior a hoje (quem marcou hoje acabou
  // de receber a confirmação) e já deu sinal de vida. O controle de "um por dia"
  // é o carimbo `ep_agenda_sent:<id>:d<AAAA-MM-DD>`, que segue o mesmo caminho do
  // bom dia: nenhuma coluna nova em `agendamentos`, nenhuma migração pra quebrar
  // o select entre o deploy e o banco.
  const naJanelaDoDiario = horaAgora >= DIARIO.de && horaAgora < DIARIO.ate;
  const diasAte = (iso: string): number => {
    const dia = (d: string) => new Date(`${d}T12:00:00-03:00`).getTime();
    return Math.round((dia(diaBRT(iso)) - dia(hojeBRT)) / 86_400_000);
  };
  const ehDoDiario = (f: Ficha): boolean => {
    if (!naJanelaDoDiario || diarioDesligado() || !f.quando) return false;
    const faltam = diasAte(f.quando);
    if (faltam < 1 || faltam > DIARIO_DIAS_ANTES) return false;
    if (diaBRT(f.created_at) >= hojeBRT) return false;
    return !!f.presenca_confirmada_at || !!f.lead_resposta_at;
  };
  const candidatosDiario = fichas.filter(ehDoDiario);
  const diarioFeito = candidatosDiario.length
    ? await jaRecebeuCarimboDoDia(candidatosDiario.map(f => f.id), hojeBRT)
    : new Set<number>();
  /** Leitura do carimbo falhou: ninguém recebe bom dia nesta rodada (ver `jaRecebeuManha`). */
  const manhaCega = manhaFeita === null;

  // Envia e grava a flag. Em `dry` só registra o que sairia — mesma decisão, zero
  // mensagem. É assim que se confere a régua em produção sem tocar em ninguém.
  // `campo` null = toque que não tem coluna de flag em `agendamentos` (o bom dia,
  // que se controla pelo carimbo do system_state). O envio e o carimbo do teto
  // acontecem igual; só o UPDATE é pulado.
  const entregar = async (
    ag: Ficha, toque: ToquePrevisto['toque'], tel: string, bolhas: string[],
    campo: string | string[] | null,
    // O lembrete diário carimba POR DIA (`:d2026-09-23`) em vez de por toque: é
    // o que faz "um por dia" valer sem coluna nova e sem contador.
    sufixoCarimbo?: string,
  ) => {
    if (opts.dry) {
      previa.push({ id: ag.id, cliente: String(ag.cliente_nome || '—'), toque, quando: String(ag.quando), bolhas });
      return;
    }
    // ── CLAIM ANTES DE FALAR ─────────────────────────────────────────────
    // A flag era gravada DEPOIS do envio, e isso significa que dois ticks que
    // rodam juntos leem a mesma ficha sem flag e mandam o mesmo toque duas
    // vezes. Não é hipótese: medido em 22/09/2026, 513 mensagens duplicadas em
    // 7 dias, 98 pessoas. O Waldir recebeu "falta 1 hora pra sua reunião" duas
    // vezes com 24 segundos de intervalo, e o Andre com 14. Numa linha que já
    // foi bloqueada 3 vezes, é o dobro do volume e o jeito mais rápido de a
    // pessoa perceber que está falando com robô.
    //
    // O cron do GitHub e o da Vercel chamam o MESMO /cron/process-messages, e o
    // Actions atrasa: a sobreposição é rotina, não exceção.
    //
    // Agora a flag é a reserva: `update ... where <campo> is null` devolve linha
    // pra UM tick só (o banco resolve a corrida), e quem voltar de mãos vazias
    // desiste. Toque sem coluna (bom dia, lembrete diário) usa o carimbo do
    // system_state como reserva, que é primary key e falha igual.
    //
    // Envio que falha DESFAZ a reserva, senão a mensagem some em silêncio, que
    // é o erro oposto e pior: ninguém recebe e ninguém fica sabendo.
    const agoraIso = new Date().toISOString();
    const chaveCarimbo = `${EP_AGENDA_PREFIX}${ag.id}:${sufixoCarimbo ?? toque}`;
    const campos = campo === null ? [] : (Array.isArray(campo) ? campo : [campo]);
    if (campos.length) {
      const { data: reservou, error: eReserva } = await supabaseGerador.from('agendamentos')
        .update(Object.fromEntries(campos.map(c => [c, agoraIso])))
        .eq('id', ag.id).is(campos[0], null).select('id');
      if (eReserva || !(reservou?.length)) {
        logger.info('ep-agenda', 'outro tick já pegou este toque', { id: ag.id, toque });
        return;
      }
    } else {
      const { error: eCarimbo } = await supabase.from('system_state')
        .insert({ key: chaveCarimbo, value: { claim: agoraIso }, updated_at: agoraIso });
      if (eCarimbo) {
        logger.info('ep-agenda', 'outro tick já pegou este toque', { id: ag.id, toque });
        return;
      }
    }

    const desfazerReserva = async () => {
      if (campos.length) {
        await supabaseGerador.from('agendamentos')
          .update(Object.fromEntries(campos.map(c => [c, null]))).eq('id', ag.id)
          .then(undefined, () => {});
      } else {
        await supabase.from('system_state').delete().eq('key', chaveCarimbo).then(undefined, () => {});
      }
    };

    // Teto de 3, não o padrão de 2 da casa. Este agente é o MAIOR emissor da
    // linha: media 5,22 bolhas por toque, contra 3,78 do resto (medido em 30 dias
    // em 31/08/2026). Baixar para 2 corta 62%, mas afunda o pedido de *SIM* num
    // parágrafo de 404 caracteres, e o SIM é a única alavanca contra o no-show.
    // Em 3 o corte ainda é de 42% e a alavanca continua numa bolha própria e
    // legível, que é o que o teste 'o pedido de SIM sobrevive' guarda.
    //
    // A exceção se defende também pelo risco: isto é transacional, vai pra quem
    // marcou a reunião. O contador ele enche; denúncia, não.
    try {
      // UMA bolha, e `max` alto pra não fatiar o texto antes de juntar: cada toque
    // agora é uma mensagem completa, escrita pra ser uma só (ordem do dono,
    // 23/09/2026). O teto de bolhas sozinho já juntaria, mas fatiar e remendar
    // perde as quebras de linha que separam as ideias do texto.
    await sendHuman(tel, bolhas, 'io', { maxBolhas: 1, max: 1200 });
    } catch (e) {
      await desfazerReserva();
      throw e;
    }
    // Carimbo pro teto anti-ban da linha (lineThrottle: `ep_agenda_sent:`). Este
    // agente vivia FORA do teto, e em 04/08 a fila de atraso soltou 8 pessoas na
    // mesma hora — 37 mensagens, teto de 12. A linha bloqueou. Nos toques com
    // coluna ele vem depois do envio (a reserva já foi a flag); nos sem coluna
    // ele JÁ existe desde a reserva, e o upsert só troca o valor pra "enviado".
    await supabase.from('system_state')
      .upsert({ key: chaveCarimbo, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .then(undefined, (e: unknown) => logger.error('ep-agenda', 'carimbo do teto da linha falhou', { id: ag.id, erro: String(e) }));
  };

  for (const ag of fichas) {
    if (toques >= MAX_TOQUES_POR_TICK) break;
    const tel = String(ag.cliente_telefone || '').replace(/\D/g, '');
    if (!tel || !ag.quando) continue;

    const minutos = (new Date(ag.quando).getTime() - agora) / 60_000;
    const telDoConsultor = telPorConsultor.get(String(ag.vendedor_nome || '')) ?? null;
    /** Marcado de ausente (por este robô ou por gente): só o toque de 5 min
     *  ainda vale. Confirmar, dar bom dia ou avisar "falta 1 hora" pra quem já
     *  foi dado como ausente é o robô discordando de si mesmo por escrito. */
    const ausente = ag.status === 'nao_atendeu';

    // ── ELE AVISOU QUE NÃO VEM ────────────────────────────────────────────
    // Nenhum dos quatro toques sai. Vale inclusive pro de 5 min, que é
    // justamente o "é agora!" — 8 dos 10 casos medidos eram ele e o de 1 hora.
    //
    // Reparar que isto fica FORA do `ausente`: ausente é quem não apareceu,
    // descoberto depois da hora. Aqui é quem avisou ANTES, que é o oposto em
    // tudo que importa. Tratar os dois igual é o que produziu a carteirada de
    // "você não conseguiu entrar" em cima de quem tinha avisado com horas de
    // antecedência.
    //
    // A reunião NÃO é cancelada aqui de propósito: quem cancela é gente. O robô
    // só para de falar e passa a bola, porque um falso positivo que cancela
    // agenda é muito pior que um falso positivo que cala um lembrete.
    const avisou = desmarcaram.get(ag.id);
    if (avisou) {
      naoVem++;
      if (!opts.dry) {
        await avisarConsultorQueNaoVem(ag, avisou, telDoConsultor).catch(e =>
          logger.error('ep-agenda', 'aviso de desmarcação ao consultor falhou', { id: ag.id, erro: String(e) }));
      }
      continue;
    }
    /** Marcada agora há pouco: a confirmação dela sai NESTE tick, sem fila nem janela. */
    const fresca = agora - new Date(ag.created_at).getTime() <= FRESCA_MS;

    // ── Confirmação — SEMPRE a primeira mensagem que o lead recebe ──────────
    // Ordem invertida em 10/08/2026 (ordem do Thiago: "tem que receber confirmação
    // sempre"). Antes a régua era 5min → 1h → confirmação, cada ramo com `continue`,
    // e isso produzia dois furos:
    //
    //   · lead que marcava dentro da janela de 1h recebia "Falta 1 hora pra sua
    //     reunião" como PRIMEIRA mensagem da empresa, sem nunca ter visto a
    //     confirmação. Virou alcançável quando a folga mínima da LP caiu de 2h pra
    //     30 min — o horário mais próximo passou a cair em 45–60 min.
    //   · ficha que perdia a janela de confirmação (envio falhou, agente desligado)
    //     e chegava a menos de 2h da reunião NUNCA era confirmada: o gate de
    //     `BACKLOG_ANTECEDENCIA_MIN` a barrava pra sempre. Esse gate saiu.
    //
    // Agora quem ainda não foi confirmado é confirmado, ponto — e só depois entra na
    // fila dos lembretes. A consulta já recorta reunião futura (`quando >= agora-5min`),
    // então nunca se confirma reunião que já passou.
    if (!ag.confirmacao_at && !ausente) {
      if (!fresca) {
        // Backlog: fila lenta e horário civilizado. Continua valendo — o que saiu foi
        // só a distância mínima da reunião.
        if (foraDeHorario || backlog >= BACKLOG_POR_TICK) continue;
        // E dentro do teto anti-ban da linha. Faltava isto: em 04/08, às 08h BRT,
        // a janela abriu com fila acumulada da noite e ESTA drenagem soltou 8
        // pessoas na mesma hora — 37 mensagens, teto de 12, linha bloqueada pela
        // 2ª vez. Ficha FRESCA e os avisos de 1h/5min seguem furando o teto de
        // propósito: são de reunião acontecendo agora. Backlog não é urgente.
        if (!opts.dry && !(await dentroDoTetoHorarioLinha({
          transacional: true, pisoHora: CONFIRMA_TETO_HORA, pisoDia: CONFIRMA_TETO_DIA,
        })  /* confirmação de agenda: quem marcou está esperando */)) {
          confirmaSegurados++;
          logger.info('ep-agenda', 'teto da linha estourado — fila de atraso espera o próximo tick');
          continue;
        }
        backlog++;
      }
      // Reunião já DENTRO da janela de 1h: a confirmação carimba o toque de 1h junto
      // e o mata. Ela acabou de dizer o horário, o consultor e que o link vem neste
      // chat — mandar "falta 1 hora" logo atrás é a mesma informação duas vezes em
      // minutos. O de 5 min continua valendo: esse é o "entra agora".
      const campos = minutos <= MIN_1H.ate ? ['confirmacao_at', 'lembrete_1h_at'] : 'confirmacao_at';
      try {
        await entregar(ag, 'confirmacao', tel, bolhasConfirmacao(ag.cliente_nome, ag.quando, ag.vendedor_nome, telDoConsultor), campos);
        confirmacoes++; toques++;
      } catch (e) {
        logger.error('ep-agenda', 'falha na confirmação', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }

    // ── 5 minutos antes ──
    if (!ag.lembrete_5min_at && minutos <= MIN_5MIN.ate && minutos >= MIN_5MIN.de) {
      try {
        await entregar(ag, '5min', tel, bolhas5min(ag.cliente_nome, ag.quando, ag.vendedor_nome, telDoConsultor), 'lembrete_5min_at');
        l5min++; toques++;
      } catch (e) {
        logger.error('ep-agenda', 'falha no toque de 5min', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }

    // ── 1 hora antes ──
    if (!ag.lembrete_1h_at && !ausente && minutos <= MIN_1H.ate && minutos >= MIN_1H.de) {
      try {
        await entregar(ag, '1h', tel, bolhas1h(ag.cliente_nome, ag.quando, ag.vendedor_nome, telDoConsultor), 'lembrete_1h_at');
        l1h++; toques++;
      } catch (e) {
        logger.error('ep-agenda', 'falha no toque de 1h', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }

    // ── Bom dia, hoje é o dia (quem marcou em outro dia) ────────────────────
    // Último da fila de propósito: é o toque menos urgente dos quatro, e a janela
    // dele tem 3 horas de folga. Se um lead tem reunião hoje E acabou de marcar
    // outra coisa, a confirmação passa na frente.
    // `manhaFeita` guarda QUANDO o carimbo foi gravado, não só que existe: ficha
    // que o repasse do banco moveu pra hoje carrega o carimbo do dia da reunião
    // ANTIGA, e ele não pode calar o bom dia de hoje (ver `bomDiaSaiuHoje`).
    if (!manhaCega && !ausente && lManha < MANHA_POR_TICK
      && !bomDiaSaiuHoje(manhaFeita!, ag.id, hojeBRT) && ehDaManha(ag)) {
      // Este é o único toque que sai em LOTE (todo mundo do dia, na mesma faixa
      // de horário), então é o único que consegue fazer rajada sozinho. Fica
      // atrás do teto anti-ban — como transacional, que é o que ele é: mensagem
      // sobre a reunião que a própria pessoa marcou.
      if (!opts.dry && !(await dentroDoTetoHorarioLinha({
        transacional: true, pisoHora: MANHA_TETO_HORA, pisoDia: MANHA_TETO_DIA,
      }))) {
        manhaSegurados++;
        continue;
      }
      try {
        await entregar(ag, 'manha', tel, bolhasManha(ag.cliente_nome, ag.quando, ag.vendedor_nome, telDoConsultor), null);
        lManha++; toques++;
      } catch (e) {
        logger.error('ep-agenda', 'falha no bom dia', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }

    // ── Lembrete diário, nos dias ENTRE o agendamento e a reunião ───────────
    // O ÚLTIMO da fila, de propósito: é o toque menos urgente de todos (a
    // reunião é amanhã ou depois) e a janela dele tem 5 horas. Qualquer outra
    // mensagem da agenda passa na frente dele no mesmo tick.
    if (diarioFeito && !ausente && lDiario < DIARIO_POR_TICK
      && !diarioFeito.has(ag.id) && ehDoDiario(ag)) {
      // Mesmo tratamento do bom dia: sai em LOTE (todo mundo cuja reunião está
      // perto, na mesma faixa de horário), então fica atrás do teto da linha,
      // como transacional com piso — é mensagem sobre a reunião que a própria
      // pessoa marcou, e o volume é limitado pela agenda.
      if (!opts.dry && !(await dentroDoTetoHorarioLinha({
        transacional: true, pisoHora: DIARIO_TETO_HORA, pisoDia: DIARIO_TETO_DIA,
      }))) {
        diarioSegurados++;
        continue;
      }
      try {
        const bolha = bolhaDiario(
          ag.cliente_nome, ag.quando, ag.vendedor_nome,
          diasAte(ag.quando) === 1, !ag.presenca_confirmada_at);
        await entregar(ag, 'diario', tel, [bolha], null, `d${hojeBRT}`);
        lDiario++; toques++;
      } catch (e) {
        logger.error('ep-agenda', 'falha no lembrete diário', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }
  }

  if (toques > 0 && !opts.dry) {
    logger.info('ep-agenda', `${toques} toque(s)`, { confirmacoes, lManha, lDiario, l1h, l5min, naoVem, erros });
  }
  // Fora do `if` de propósito: uma rodada que só segurou bom dia não tem toque
  // nenhum, e é justamente ela que precisa aparecer.
  if (manhaSegurados > 0 && !opts.dry) {
    logger.info('ep-agenda', `${manhaSegurados} bom dia segurado(s) pelo teto da linha`, {
      candidatos: candidatosManha.length, enviados: lManha,
    });
  }
  // Nível `warn` e não `info`, de propósito: confirmação segurada é a prioridade
  // número um do módulo parando de sair, e num log cheio de `info` de rotina ela
  // tem que saltar. Se esta linha aparecer repetida entre 7h e 20h, o piso acima
  // está apertado demais para a agenda do dia — é o sinal para revisar
  // EP_CONFIRMA_TETO_HORA, não para esperar drenar.
  if (confirmaSegurados > 0 && !opts.dry) {
    logger.warn('ep-agenda', `${confirmaSegurados} CONFIRMAÇÃO segurada(s) pelo teto da linha`, {
      enviadas: confirmacoes, pisoHora: CONFIRMA_TETO_HORA, pisoDia: CONFIRMA_TETO_DIA,
    });
  }
  if (diarioSegurados > 0 && !opts.dry) {
    logger.info('ep-agenda', `${diarioSegurados} lembrete(s) diário(s) segurado(s) pelo teto da linha`, {
      candidatos: candidatosDiario.length, enviados: lDiario,
    });
  }
  return {
    confirmacoes, lembretes_manha: lManha, lembretes_diarios: lDiario, lembretes_1h: l1h, lembretes_5min: l5min,
    // O total soma as duas réguas (é ele que a Central das Agentes mostra); o
    // corte das 13h aparece também sozinho, porque é o que libera horário.
    nao_atendeu: naoAtendeu + vermelho13h, vermelho_13h: vermelho13h, erros,
    avisou_que_nao_vem: naoVem,
    ...(opts.dry ? { motivo: 'dry', previa } : {}),
  };
}
