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
import { sendHuman, linhaEmCooldown } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import {
  quandoPorExtenso, telefoneBonito, carregarConsultores,
  EP_AGENDA_PREFIX, EP_NAO_ATENDEU_PREFIX,
} from './eletropostoAgenda';
import { EP_REMARCAR_PREFIX } from './eletropostoRemarcar';
import { proximasVagas, diaBRT } from './eletropostoVagas';
import { agendaFechadaNoIso } from '../agenda/agendaFechada';
import { APALAVRADO_PREFIX, esperaAte } from '../agenda/salaDeEspera';
import { carregarBloqueados } from '../agents/whatsapp/silenciar';

const BRT_TZ = 'America/Sao_Paulo';

/**
 * ── A SALA DE ESPERA DEIXOU DE SER UM STATUS (01/10/2026) ─────────────────
 *
 * Ordem do dono: "a etiqueta APALAVRADO não substitui a atual, ela é
 * acrescentada; a etiqueta mantém pra conseguirmos identificar a negociação
 * correta daquele cliente".
 *
 * Até aqui apalavrar GRAVAVA `status = 'apalavrado'`, e isso apagava a
 * classificação do funil — o mesmo erro que este módulo já evita no caminho de
 * negociação ("forçar `agendado` apagaria a classificação do funil"). Os cinco
 * cards que foram apalavrados antes disto perderam a etiqueta deles pra sempre:
 * ela não está no histórico, não está em coluna nenhuma, não dá pra recuperar.
 *
 * Agora quem manda é a MARCA `apalavrado:<id>` no `system_state`, que já existia
 * (ela é quem guarda o texto e a data). O status fica com a etiqueta de
 * negociação, e é a marca que tira a ficha da roda.
 *
 * E A DATA VOLTOU A VALER PRA ALGO. Com o status, a ficha saía do ciclo PRA
 * SEMPRE: a data só aparecia na tela e, se ninguém olhasse, o card morria ali —
 * exatamente o cemitério que o status foi criado pra não ser. Agora a marca cala
 * a ficha ATÉ a data, e depois dela a ficha volta pra roda sozinha, calada como
 * todo card em negociação. É a leitura literal do que ele pediu quando criou o
 * status: "pra essa pessoa no apalavrado não sumir da vida".
 *
 * `status = 'apalavrado'` CONTINUA tirando da roda, pelos cinco cards antigos.
 */
// O prefixo e a leitura moram no modulo neutro: a conta e UMA pros dois
// produtos, mas nenhum produto pode depender do outro pra ela.
export { APALAVRADO_PREFIX as EP_APALAVRADO_PREFIX } from '../agenda/salaDeEspera';

/** Estado do ciclo: `ep_reagenda_auto:<id>` → { n, ultimo, de }. */
export const EP_REAGENDA_PREFIX = 'ep_reagenda_auto:';

/**
 * O CARD QUE FOI MOVIDO EM SILÊNCIO: `ep_mudo:<id>` → { quando }.
 *
 * ELE EXISTE POR CAUSA DE UM ESTRAGO MEDIDO (01/10/2026). O caminho silencioso
 * carimba `confirmacao_at` só pra calar a confirmação padrão da agenda, que é
 * gateada nesse campo. Só que o `eletropostoCobraSim` LÊ O MESMO CAMPO com o
 * significado original — "o robô confirmou com o cliente e está esperando a
 * resposta dele" — e, como o cliente nunca respondeu (nada foi enviado a ele),
 * ele cobrou, não teve resposta, e LIBEROU O HORÁRIO.
 *
 * Resultado na primeira noite: das 15 fichas que a regra moveu, 14 amanheceram
 * `cancelado` (Diego 13, Thiago 1). O card que devia voltar pra agenda virou
 * lead perdido, que é o oposto exato do que a regra existe pra fazer.
 *
 * A raiz é ter dado DOIS significados ao mesmo campo. A correção não é tirar o
 * carimbo (aí a agenda volta a falar com o cliente): é dizer, num lugar só e
 * com nome próprio, que esta ficha foi movida sem ninguém ser avisado. Quem
 * fala com o cliente tem que saber disso, e quem cobra resposta também.
 *
 * O `quando` vai junto de propósito: a marca vale pro horário QUE ELA MOVEU. Se
 * alguém remarcar essa ficha depois, por qualquer caminho, a marca deixa de
 * casar e a régua do SIM volta a valer, que é o certo — aí houve confirmação de
 * verdade.
 */
export const EP_MUDO_PREFIX = 'ep_mudo:';

/**
 * A linha IO está fora do ar? Fail-closed na leitura do monitor: se o banco não
 * responde, ninguém que fala é remarcado nesta rodada. A fila não tem pressa, e
 * remarcar sem avisar é marcar reunião que a pessoa não sabe que existe.
 */
async function linhaIoForaDoAr(): Promise<boolean> {
  if (linhaEmCooldown('io')) return true;
  const { data, error } = await supabase
    .from('system_state').select('key, value').in('key', ['zapi_io_health']);
  if (error) return true;
  const v = (data?.[0]?.value ?? null) as { downStreak?: number } | null;
  return Number(v?.downStreak ?? 0) > 0;
}

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
/**
 * Quantas vezes o NÃO ATENDEU pode ser remarcado. Três desde 01/10/2026 (ordem
 * do Thiago: "não atendeu, 3 voltas"), eram duas desde 20/08.
 *
 * O teto existe só aqui porque só este caminho MANDA MENSAGEM: dizer "você não
 * conseguiu entrar na apresentação" indefinidamente queima a linha e o cliente.
 * Os caminhos calados (card esquecido e card em negociação) não têm teto — eles
 * rodam até alguém dar destino, que é a regra da casa.
 *
 * Virou env na mesma hora: este número já mudou duas vezes, e número que muda
 * não devia precisar de deploy.
 */
export const maxVoltas = (): number => num('EP_REAGENDA_MAX_VOLTAS', 3);
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
 * ── O CARD EM NEGOCIAÇÃO VOLTA PRA AGENDA A CADA 48H (01/10/2026) ──────────
 *
 * Ordem do Thiago: "chave na mão, arrendamento, negociando, 50-50, ele voltar
 * sempre 48 horas depois, pra ele ficar rodando e a gente fechar ou não fechar",
 * e hoje, olhando os parados: "quero a lista lançada na regra".
 *
 * Até aqui o ciclo de 48h existia só como DESENHO NO QUADRO do CRM: o card
 * mudava de coluna, mas não voltava pra agenda de ninguém. Medido em 01/10, são
 * 60 cards nos quatro modelos (Thiago 38, Diego 22) e 94% deles passaram das 48
 * horas. Quadro não é compromisso; agenda é.
 *
 * TRÊS COISAS SEPARAM ESTE CAMINHO DOS OUTROS DOIS:
 *
 * 1. Ele NÃO mexe no status. Um `chave_na_mao` volta como `chave_na_mao`. Forçar
 *    `agendado` apagaria a classificação do funil inteiro — justamente a
 *    informação que diz por qual porta aquele cliente está entrando.
 * 2. Ele vai pra FAIXA DOS QUINZE (:15/:45), não pro horário redondo. É
 *    follow-up de quem já é nosso, e não pode comer o horário que a vitrine
 *    vende pra lead novo. São 60 cards: no horário redondo, isso fecharia a
 *    agenda de venda em dois dias.
 * 3. Ele é MUDO e não precisa de marca pra isso. Como o status não é `agendado`,
 *    nem a régua da agenda nem o alerta de 10 min nem a régua do SIM enxergam a
 *    ficha — as três filtram por `status = 'agendado'`. Nenhuma mensagem sai, e
 *    sem carimbar `confirmacao_at`, que é o campo de dois donos que custou 14
 *    leads nesta mesma semana.
 */
/**
 * ── A REGRA VIROU DO AVESSO (01/10/2026) ──────────────────────────────────
 *
 * Ordem do Thiago: "tudo que fica pra trás tem que ser remarcado na agenda à
 * frente, com as regras de tempo de cada um já definido; será cíclico até esse
 * cliente ter um destino final e parar de rodar".
 *
 * Isto não é "mais um status na lista", é a inversão dela. Antes havia uma LISTA
 * DO QUE ENTRA, e toda lista assim tem o mesmo defeito: o status que alguém
 * criar depois nasce de fora, em silêncio, e ninguém descobre até um cliente
 * sumir. A casa já pagou por isso duas vezes — é o buraco que o comentário do
 * `origemEtiqueta` descreve na prospecção, e é o que deixou 68 fichas de
 * eletroposto sem robô nenhum até ontem.
 *
 * Agora a lista é DO QUE NÃO ENTRA, e ela é curta porque é fim de linha:
 *
 *   `fechou`             vendeu
 *   `sem_interesse`      ele disse não
 *   `cancelado`          desmarcou
 *   `perdido`            botão velho, mesma coisa
 *   `fechou_concorrente` comprou de outro
 *   `apalavrado`         NÃO é fim de linha, é sala de espera: tem data própria
 *                        e volta por ela. Rodar junto seria cobrar duas vezes.
 *
 * Qualquer outra coisa roda. Status novo nasce rodando, que é o certo.
 */
export const DESTINO_FINAL = new Set<string>([
  'fechou', 'sem_interesse', 'cancelado', 'perdido', 'fechou_concorrente',
]);

/** Roda, e com qual relógio. `null` = não roda. */
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
export function relogioDoCiclo(status: string): 'fala' | 'esquecido' | 'negocia' | null {
  if (DESTINO_FINAL.has(status)) return null;
  if (status === 'nao_atendeu') return 'fala';        // 45 min, e manda mensagem
  if (status === 'agendado') return 'esquecido';      // 6h, calado
  return 'negocia';                                   // 48h, calado
}

/** Atalho: tudo que não é vermelho nem esquecido roda no relógio de 48h. */
const ehNegociacaoStatus = (st: string): boolean => relogioDoCiclo(st) === 'negocia';
const negociacaoH = (): number => num('EP_NEGOCIACAO_H', 48);
/**
 * ── A ESCADA DA NEGOCIAÇÃO (01/10/2026) ───────────────────────────────────
 *
 * Ordem do Thiago: "chave na mão, carregador, 50/50 e arrendamento, após
 * receber sua etiqueta é agendado novamente 48 hrs; se manter uma dessas
 * etiquetas, 72hrs; se manter novamente, 96; se manter novamente, 120hrs, e
 * assim por diante até ter um fim".
 *
 * 48, 72, 96, 120: base 48 e passo 24. Sem teto, porque a frase é "assim por
 * diante" e porque o fim é o destino do card, não um número de voltas.
 *
 * POR QUE ISSO É O CONTRÁRIO DE AFROUXAR A REGRA: o ciclo fixo de 48h trata
 * igual a negociação que andou ontem e a que está parada há três semanas. A
 * primeira merece o toque curto; a segunda, devolvida a cada 48h para sempre,
 * come um horário da grade por semana sem nunca mudar de estado. A escada
 * desacelera quem não anda e deixa a grade livre pra quem anda — e continua
 * voltando, que é a parte que não muda.
 *
 * O QUE ZERA A ESCADA é a ETIQUETA MUDAR. `arrendamento` virando
 * `chave_na_mao` é a negociação andando: o card volta pro degrau 1, com 48h.
 * É por isso que `Estado` guarda o status.
 */
const passoNegociacaoH = (): number => num('EP_NEGOCIACAO_PASSO_H', 24);
/** As horas de descanso do degrau `d`: 48, 72, 96, 120 … */
export const horasDoDegrau = (d: number): number =>
  negociacaoH() + passoNegociacaoH() * Math.max(0, Math.floor(d) - 1);
/**
 * O degrau da PRÓXIMA volta desta ficha.
 *
 * Etiqueta igual à da última volta sobe um degrau; etiqueta diferente, ou ficha
 * que nunca voltou, começa no 1 (48h). Carimbo gravado antes de 01/10 não tem
 * `status`, então ele cai no 1 também: a ficha ganha mais um 48h e a escada
 * começa a contar da próxima — nenhuma ficha é pulada na virada.
 */
export function degrauDaProximaVolta(
  estado: { status?: string; degrau?: number } | undefined, statusAgora: string,
): number {
  if (!estado?.status || estado.status !== statusAgora) return 1;
  const d = Math.floor(Number(estado.degrau));
  return (Number.isFinite(d) && d >= 1 ? d : 1) + 1;
}
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
 * A RAMPA DOS CALADOS, que é outra conta (01/10/2026).
 *
 * A rampa de cima foi dimensionada por MENSAGEM: "75 fichas de uma vez são
 * ~300 mensagens". Isso descreve o `nao_atendeu`, que fala com o cliente e
 * recomeça a régua da agenda inteira. Não descreve o card esquecido nem o card
 * em negociação: esses dois não mandam nada. O único custo deles é ocupar
 * horário, e de horário quem cuida é a grade, que já espalha pelos dias quando
 * o dia enche.
 *
 * Com uma rampa só, o calado ficava preso atrás do que fala. Medido em 01/10:
 * a rampa fechou em 40/40 às 13h03 com 182 fichas ainda esperando, 110 delas
 * em negociação, nenhuma com mensagem pra mandar. A fila dava 5 dias por causa
 * de um limite que existe pra proteger uma linha de WhatsApp que elas nem usam.
 *
 * 200 não é "sem limite": é acima da base aberta inteira, de propósito, pra
 * quem decide o ritmo ser a agenda e não um número escrito aqui. Se um dia a
 * base crescer e isto virar a trava, o log diz na hora qual das duas encheu.
 */
const tetoMudoPorDia = (): number => num('EP_REAGENDA_MUDO_POR_DIA', 200);

/**
 * Só QUENTE ganha 2ª chance? Era a ordem de 20/08/2026 ("quero apenas os
 * clientes QUENTES tenham uma 2ª e 3ª chance"). A de 29/09 é mais ampla ("todos
 * os NÃO ATENDEU"), então o padrão virou `false` e a env existe pra voltar atrás
 * sem deploy se a linha reclamar.
 */
const soQuente = (): boolean => (process.env.EP_REAGENDA_SO_QUENTE || '').trim() === '1';
/** Uma pessoa por tick: duas no mesmo passo poderiam mirar o mesmo slot. */
const POR_TICK = 1;
/**
 * Quantas fichas a rodada pode TENTAR pra conseguir mover `POR_TICK`.
 *
 * Era 1: a rodada pegava a primeira da fila e, se ela não tivesse vaga, voltava
 * zero. Como a ordem da fila não muda entre ticks, a rodada seguinte tentava a
 * MESMA ficha — uma ficha sem horário livre parava a fila inteira com a rampa
 * vazia. Com a rampa em 10 isso quase não aparecia; com a dos calados em 200,
 * apareceria no primeiro dia.
 *
 * O limite existe porque cada tentativa lê a agenda do consultor: sem ele, uma
 * fila de 180 viraria 180 leituras num tick de 2 minutos.
 */
const TENTATIVAS_POR_RODADA = 8;
const JANELA_INICIO_H = 9;
/** Teto da consulta de vencidas. 1000 é onde o PostgREST corta sozinho, então
 *  pedir mais não traz mais — o que protege é o aviso quando ele é batido. */
const LIMITE_VARREDURA = 1000;
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

/**
 * O estado do ciclo de uma ficha.
 *
 * `status` e `degrau` entraram em 01/10/2026 com a escada da negociação. Eles
 * são a memória de "esta etiqueta já voltou quantas vezes seguidas": sem
 * guardar a etiqueta, não existe como saber se ela MUDOU, e é a mudança que
 * zera a escada.
 */
type Estado = { n: number; ultimo: string; de?: string; status?: string; degrau?: number };

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
  const ultima = tentativa >= maxVoltas();
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
  deIso: string, paraIso: string, tentativa: number, esquecido = false, negociacao = false,
  degrau = 1,
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
  if (negociacao) {
    // Nem "não apareceu" nem "sem desfecho": esta ficha está em NEGOCIAÇÃO e
    // volta pela escada, pra alguém dar destino a ela.
    //
    // A LINHA TEM QUE DIZER O DEGRAU E O PRÓXIMO INTERVALO. Sem isso, um card
    // que volta em 5 dias em vez de 2 parece defeito, e a primeira coisa que
    // alguém faz com o que parece defeito é desligar.
    const total = tentativa !== degrau ? ` (${tentativa}ª no total)` : '';
    return `[${carimbo} · Sistema] 🔁 Ciclo de ${horasDoDegrau(degrau)}h (${degrau}ª volta nesta etiqueta${total}): `
      + `a negociação parou desde ${de} e o card voltou pra *${para}*, nos quinze, `
      + 'com o mesmo consultor e o mesmo status. Nada foi enviado ao cliente. '
      + `Se a etiqueta não mudar, a próxima volta é em ${horasDoDegrau(degrau + 1)}h; `
      + `mudar de etiqueta recomeça em ${horasDoDegrau(1)}h. `
      + 'Ele sai desta roda fechando, marcando Sem interesse ou pondo em Apalavrado.';
  }
  if (esquecido) {
    // Sem "x/2": este caminho não tem teto, e escrever um denominador que não
    // existe faria a equipe esperar que o card parasse de voltar sozinho.
    return `[${carimbo} · Sistema] 🔁 Reagendamento automático (${tentativa}ª vez): `
      + `a reunião de ${de} passou e o card ficou sem desfecho por mais de ${esquecidoH()}h, `
      + `então ele voltou pra *${para}*, mesmo horário e mesmo consultor. `
      + 'Nada foi enviado ao cliente. Se a reunião aconteceu, é só marcar o status certo.';
  }
  return `[${carimbo} · Sistema] 🔁 Reagendamento automático ${tentativa}/${maxVoltas()}: `
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
  dono: string, quandoIso: string, agora = Date.now(), negociacao = false,
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
  // Negociação vai pros QUINZE: é follow-up de quem já é nosso e não pode comer
  // o horário redondo que a vitrine vende pra lead novo. São 60 cards — no
  // redondo, isso fecharia a agenda de venda em dois dias.
  const vagas = await proximasVagas(dono, VAGAS_CONSULTADAS,
    { agora: inicio, ignorarIso: quandoIso, faixa: negociacao ? 'remarcacao' : 'novo' });
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
  f: FichaVermelha, candidatos: string[], tentativa: number, degrau = 1,
): Promise<string | null> {
  // NEGOCIAÇÃO NÃO PERDE O STATUS. Um `chave_na_mao` volta como `chave_na_mao`:
  // forçar `agendado` apagaria a classificação do funil, que é a informação que
  // diz por qual porta o cliente está entrando. E é justamente o status não ser
  // `agendado` que mantém a ficha invisível pra todo robô que fala com cliente.
  const negociacao = ehNegociacaoStatus(String(f.status));
  // ── "DEIXA CAIR SEMPRE COMO CONFIRMADA MESMO, COM A MESMA COR" ───────────
  //
  // Ordem do Thiago (01/10/2026), olhando a agenda do Diego cheia de card rosa.
  //
  // Os zeros logo abaixo existem pra ficha que VOLTA PRA RÉGUA DA AGENDA: ela
  // precisa poder ser confirmada, lembrada e marcada de novo. O card que volta
  // MUDO não volta pra régua nenhuma, então zerar só destrói informação — e foi
  // o que produziu a tela que ele viu: `presenca_confirmada_at` zerado e
  // `confirmacao_at` carimbado viram "NÃO CONFIRMOU" em rosa. O card dizendo
  // que o cliente foi perguntado e calou, sobre gente que tinha confirmado
  // presença de verdade e sobre gente com quem ninguém nunca falou.
  //
  // Agora o card volta exatamente como estava: confirmado continua confirmado,
  // com a mesma cor. Muda só o horário e a linha do histórico.
  const mudoAqui = negociacao || f.status === 'agendado';
  for (const novo of candidatos.slice(0, CANDIDATOS_MAX)) {
    const linha = linhaDoHistorico(
      String(f.quando), novo, tentativa, f.status === 'agendado', negociacao, degrau);
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({
        quando: novo,
        // Só o VERMELHO volta pra `agendado`: é isso que faz a régua da agenda
        // reassumir a ficha. O esquecido já é `agendado` (reescrever seria
        // barulho) e a negociação mantém o status dela de propósito.
        ...(f.status === 'nao_atendeu' ? { status: 'agendado' } : {}),
        // ── NEGOCIAÇÃO NÃO ZERA CARIMBO NENHUM ────────────────────────────
        //
        // Os zeros abaixo existem pra uma ficha que VOLTA PRA RÉGUA DA AGENDA:
        // ela precisa poder ser confirmada, lembrada e marcada de novo. A ficha
        // em negociação não volta pra régua nenhuma (o status dela a esconde de
        // todas), então zerar seria apagar fato sem ganhar nada — e um deles,
        // `lead_resposta_at`, é literalmente "esta pessoa já falou com a gente",
        // que é a definição de quem está negociando. Ela leva só o horário novo
        // e a linha do histórico.
        ...(mudoAqui ? {} : {
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
        }),
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
  const corteNegociacao = new Date(agora - negociacaoH() * 3600_000).toISOString();
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, quando, vendedor_nome, created_by, status, temperatura, lead_resposta_at, historico')
    // `apalavrado` saiu desta lista: quem segura a ficha agora é a MARCA, que
    // tem data. Deixar o status aqui prendia pra sempre os cards apalavrados
    // antes da marca existir.
    .not('status', 'in', `(${[...DESTINO_FINAL].join(',')})`)
    .gte('quando', de)
    .lte('quando', ate)
    .order('quando', { ascending: false })
    .limit(LIMITE_VARREDURA);
  if (error) {
    logger.error('ep-reagenda', 'ler as fichas vencidas falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }
  // ── CORTE SILENCIOSO É O PIOR TIPO DE CORTE ──────────────────────────────
  //
  // A consulta ordena por `quando` DESC, então o que ela corta no limite é o
  // MAIS ANTIGO — exatamente a ficha mais esquecida, que é a razão de o módulo
  // existir. E a escada piora isso de propósito: card que descansa mais tempo
  // fica mais tempo com o horário no passado, então o conjunto de vencidos
  // CRESCE. Hoje são ~160 e o limite é 1000, mas "hoje cabe" não é garantia.
  //
  // Não dá pra resolver só subindo o número: o PostgREST corta em 1000 e ignora
  // `.limit()` acima disso. O que dá, e é o que importa, é NÃO CORTAR CALADO.
  if ((data?.length ?? 0) >= LIMITE_VARREDURA) {
    logger.warn('ep-reagenda', `a varredura bateu no limite de ${LIMITE_VARREDURA} fichas: `
      + 'as mais ANTIGAS ficaram de fora desta rodada. Paginar por range virou necessidade.');
  }

  // UMA leitura pra rodada inteira, nao um select por ficha: e pra isso que o
  // `carregarBloqueados` devolve predicado em vez de consultar.
  const bloqueado = await carregarBloqueados();
  const candidatos = ((data ?? []) as FichaVermelha[]).filter(f =>
    ehOrigemEletroposto(f.created_by)
    // O `agendado` só entra depois das 6 horas. A consulta acima usa o corte
    // frouxo (45 min) porque ela é uma só pros dois status; quem aperta o corte
    // certo é esta linha.
    && (f.status !== 'agendado' || (!!f.quando && f.quando <= corteEsquecido))
    // Negociação: este corte é o PISO da escada (o degrau 1, 48h). Quem sabe o
    // degrau de cada ficha é o `estadoDe`, que só é lido depois daqui — então o
    // corte exato é aplicado no `naVez`. Peneirar aqui pelo piso é de graça e
    // não exclui ninguém que esteja no prazo: nenhum degrau pede MENOS que 48h.
    && (!ehNegociacaoStatus(String(f.status)) || (!!f.quando && f.quando <= corteNegociacao))
    // Rede: status sem relógio nenhum não entra. A consulta já corta destino
    // final e apalavrado; isto segura se alguém mexer na consulta.
    && relogioDoCiclo(String(f.status)) !== null
    // Desde 29/09/2026 entra TODO NÃO ATENDEU, não só o quente: a ordem é
    // recuperar gente, e quem decide o volume agora é a rampa diária. Com
    // EP_REAGENDA_SO_QUENTE=1 volta a régua de 20/08 sem deploy.
    && (!soQuente() || ehQuente(f.temperatura))
    && !!f.cliente_telefone
    // FORA DO PADRÃO: o telefone bloqueado não volta pra agenda. Sem esta linha o
    // reciclo remarcaria a reunião dele sozinho, e remarcar é o que faz o card
    // reaparecer na fila de quem liga.
    && !bloqueado(f.cliente_telefone)
    && !!f.vendedor_nome
    && !!f.quando
    // Escreveu DEPOIS de perder o horário? Não sumiu — está conversando, e essa
    // conversa é do agente de respostas, que já sabe remarcar.
    //
    // SÓ VALE PRO CAMINHO QUE FALA (01/10/2026). O filtro existe pra não
    // atropelar conversa viva com uma mensagem nossa, e os caminhos mudos não
    // mandam mensagem nenhuma. Pior: quem escreveu depois da reunião é
    // justamente quem o consultor PRECISA retornar, e eram 10 fichas ficando de
    // fora por isso. Agora o card volta pra agenda, calado, e quem fala é gente.
    && !(f.status === 'nao_atendeu' && f.lead_resposta_at && f.lead_resposta_at > f.quando)
    // Reunião perdida num dia de AGENDA FECHADA (sócios fora) não
    // é no-show: o consultor é que não estava. A copy daqui abre com "você não
    // conseguiu entrar na apresentação" e culparia o cliente pela nossa ausência.
    // Elas ficam SEM DONO: este filtro só impede a acusação errada, não avisa
    // ninguém. Quem fechar um dia na `agendaFechada` precisa avisar à mão quem já
    // estava marcado nele — senão o lead espera por uma reunião que não vai ter.
    && !agendaFechadaNoIso(f.quando)
    // Fora do horário comercial sobra só o card esquecido, que se move calado.
    && (!foraDaJanela || f.status === 'agendado' || ehNegociacaoStatus(String(f.status))));
  if (!candidatos.length) return zero(foraDaJanela ? 'fora_da_janela' : 'nenhum_vermelho');

  const ids = candidatos.map(f => f.id);
  const [estadosQ, { data: ofertasVivas }, esperasQ] = await Promise.all([
    supabase.from('system_state').select('key, value')
      .in('key', ids.map(id => `${EP_REAGENDA_PREFIX}${id}`)),
    supabase.from('system_state').select('key, updated_at')
      .in('key', ids.map(id => `${EP_REMARCAR_PREFIX}${id}`)),
    supabase.from('system_state').select('key, value')
      .in('key', ids.map(id => `${APALAVRADO_PREFIX}${id}`)),
  ]);
  // ── FAIL-CLOSED NA LEITURA DO ESTADO DO CICLO ────────────────────────────
  //
  // Esta leitura descartava o `error`, e o cliente do Supabase daqui NÃO lança:
  // erro de banco ou de rede RESOLVE com `data: null`. O efeito era silencioso e
  // PERMANENTE: `estadoDe` nascia vazio, toda ficha lia degrau 1 e volta 1, o
  // tick remarcava, e o carimbo era REESCRITO como `{ n: 1, degrau: 1 }`. Num
  // único tick com o banco ruim, a escada de todos os cards voltava pro zero e o
  // teto de 3 voltas do vermelho também — liberando mais um "você não conseguiu
  // entrar na apresentação" pra quem já tinha recebido três.
  //
  // O gêmeo do solar já fechava esta porta (`erro_ciclo`). Era diferença entre os
  // dois, e a diferença estava do lado errado.
  if (estadosQ.error) {
    logger.error('ep-reagenda', 'ler o estado do ciclo falhou — ninguém anda nesta rodada', estadosQ.error);
    return { ...zero('erro_ciclo'), erros: 1 };
  }
  const estados = estadosQ.data;
  // FAIL-CLOSED: se a leitura da sala de espera falhar, ninguém é remarcado.
  // Na dúvida, o errado é devolver pra agenda um cliente que alguém pediu
  // explicitamente pra deixar em paz.
  if (esperasQ.error) {
    logger.error('ep-reagenda', 'ler a sala de espera falhou — ninguém anda nesta rodada', esperasQ.error);
    return { ...zero('erro_espera'), erros: 1 };
  }
  const esperandoAte = new Map<number, number>();
  for (const r of esperasQ.data ?? []) {
    const id = Number(String(r.key).slice(APALAVRADO_PREFIX.length));
    const ate = esperaAte(r.value);
    if (Number.isInteger(id) && ate !== null) esperandoAte.set(id, ate);
  }
  const estadoDe = new Map<number, Estado>();
  for (const r of estados ?? []) {
    const id = Number(String(r.key).slice(EP_REAGENDA_PREFIX.length));
    const v = (r.value ?? {}) as Partial<Estado>;
    if (!Number.isInteger(id)) continue;
    // `n` e `ultimo` são do CONTADOR DE VOLTAS; `status` e `degrau` são da
    // ESCADA. Exigir os dois primeiros pra guardar os dois últimos (como esta
    // linha fazia) significa que um carimbo com a escada mas sem `ultimo` faria
    // a ficha parecer degrau 1 — e o leitor do solar, que não exige nada, daria
    // outra resposta pro mesmo dado. Duas leituras do mesmo carimbo têm que
    // concordar.
    estadoDe.set(id, {
      n: typeof v.n === 'number' ? v.n : 0,
      ultimo: typeof v.ultimo === 'string' ? v.ultimo : '',
      ...(typeof v.status === 'string' ? { status: v.status } : {}),
      ...(typeof v.degrau === 'number' ? { degrau: v.degrau } : {}),
    });
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
  const semTeto = (f: FichaVermelha) =>
    f.status === 'agendado' || ehNegociacaoStatus(String(f.status));
  // ── O CORTE EXATO DA ESCADA, FICHA POR FICHA ─────────────────────────────
  //
  // Só a negociação tem escada. O vermelho (45 min) e o esquecido (6h) já foram
  // cortados na peneira de cima, com relógio fixo, e aqui passam direto.
  const descansou = (f: FichaVermelha): boolean => {
    if (relogioDoCiclo(String(f.status)) !== 'negocia') return true;
    const horas = horasDoDegrau(degrauDaProximaVolta(estadoDe.get(f.id), String(f.status)));
    return !!f.quando && new Date(f.quando).getTime() <= agora - horas * 3600_000;
  };
  const noPrazo = candidatos.filter(f => !descansou(f)).length;
  // Quem a fila barrou pelo TETO DE VOLTAS (só o vermelho tem teto). Contado
  // separado porque "descansando no degrau" e "estourou as 3 voltas" se
  // resolvem de formas diferentes, e um motivo só esconderia o segundo.
  const noTeto = candidatos.filter(f =>
    !semTeto(f) && (estadoDe.get(f.id)?.n ?? 0) >= maxVoltas()).length;
  // A SALA DE ESPERA, agora por MARCA e não por status. Enquanto a data não
  // chega, a ficha não anda; depois dela, volta pra roda calada como qualquer
  // card em negociação.
  const naEspera = (f: FichaVermelha): boolean => {
    const ate = esperandoAte.get(f.id);
    return ate !== undefined && ate > agora;
  };
  const esperando = candidatos.filter(naEspera).length;
  const naVez = candidatos.filter(f =>
    !comOferta.has(f.id) && !naEspera(f) && descansou(f)
    && (semTeto(f) || (estadoDe.get(f.id)?.n ?? 0) < maxVoltas()));
  if (!naVez.length) {
    // Dois motivos diferentes, e confundi-los esconde a escada: "ninguém na vez"
    // é fila vazia; "todos descansando" é fila cheia de gente dentro do prazo.
    // O log diz SEMPRE os dois números. O motivo só vira `todos_no_degrau`
    // quando a escada é a única coisa segurando a fila: se há vermelho
    // estourado no teto, dizer "todos no degrau" mandaria a gente esperar o
    // relógio por um card que só sai com decisão de gente.
    logger.info('ep-reagenda', `fila parada: ${noPrazo} em negociação dentro do degrau, `
      + `${noTeto} vermelho(s) no teto de ${maxVoltas()} voltas, ${esperando} na sala de espera, `
      + `${candidatos.length} candidato(s)`);
    if (noPrazo && !noTeto) return zero('todos_no_degrau');
    return zero('ninguem_na_vez');
  }

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
  // A CONTA DA RAMPA SAI DO `value.ultimo`, NÃO DO `updated_at` (30/09/2026).
  //
  // CORREÇÃO DO QUE EU ESCREVI AQUI PRIMEIRO: eu publiquei este bloco dizendo
  // que a rampa estava ERRADA em produção. Não estava. Ela estava certa, e quem
  // errou fui eu, lendo o relógio da minha máquina — que reporta UTC como se
  // fosse local. Eu li "01h38 de 01/10" e concluí que a rampa contava trabalho
  // que não tinha acontecido; eram 22h38 de 30/09, e os 10 reagendamentos que
  // ela contava eram reais, feitos naquela manhã entre 10:08 e 10:40.
  // "Rampa do dia cheia (10/10) — a fila continua amanhã" era a verdade.
  //
  // O QUE FICA, e fica por mérito próprio: a conta sai de `value.ultimo` em vez
  // de `updated_at`. `updated_at` é coluna de infraestrutura — quem a escreve,
  // quando e com que fuso não é contrato deste módulo. `value.ultimo` é o ISO
  // que ELE grava no mesmo upsert em que conta a tentativa: dado próprio, com
  // significado único. É mais robusto, mas não estava consertando defeito.
  //
  // E FICA A LINHA DE LOG LOGO ABAIXO, que é o que de fato resolveu: foi ela
  // que mostrou `desde 2026-09-30T03:00:00Z` e derrubou a minha conclusão
  // errada em um segundo. Número sem a sua origem ao lado não se audita.
  //
  // Fail-closed segue valendo: consulta quebrada devolve `erro_rampa` e ninguém
  // é remarcado.
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
  // ── CADA RELÓGIO TEM A RAMPA DELE (01/10/2026) ───────────────────────────
  //
  // O carimbo passou a gravar `relogio`: `fala` pro `nao_atendeu`, `mudo` pros
  // dois caminhos silenciosos. Carimbo gravado antes disto não tem o campo e
  // conta como `fala`, que é o lado seguro — o teto que protege a linha segue
  // cheio no dia da virada, e o dos calados começa do zero.
  const contados = (qual: 'fala' | 'mudo'): number => doDia.filter(r => {
    const v = (r as { value?: { relogio?: string } }).value;
    return (v?.relogio === 'mudo' ? 'mudo' : 'fala') === qual;
  }).length;
  const vagaDe = {
    fala: tetoPorDia() - contados('fala'),
    mudo: tetoMudoPorDia() - contados('mudo'),
  };
  // Deixa VISÍVEL o que a rampa contou. Sem isto, "rampa cheia" é uma afirmação
  // sem prova nenhuma no log, e foi assim que o defeito passou despercebido.
  logger.info('ep-reagenda', `rampa: fala ${contados('fala')}/${tetoPorDia()}, mudo ${contados('mudo')}/${tetoMudoPorDia()} (desde ${inicioDoDiaBRT}), ${jaHoje} hoje de ${(feitosHoje.data || []).length} carimbos no total`);

  // ── A FILA É FILTRADA, NÃO INTERROMPIDA ──────────────────────────────────
  //
  // Aqui havia dois `return` que paravam a rodada inteira: rampa cheia parava
  // tudo, teto da linha parava tudo. Com `POR_TICK = 1` isso tem um efeito que
  // não se vê lendo: UM `nao_atendeu` na frente da fila, com a rampa dele cheia,
  // segurava os 110 calados atrás dele até o dia virar.
  //
  // Agora quem não pode andar SAI DA FILA e quem pode anda. Seco atravessa as
  // duas travas, igual à janela de horário: conferir é pergunta, não envio.
  const relogioDe = (f: FichaVermelha): 'fala' | 'mudo' =>
    relogioDoCiclo(String(f.status)) === 'fala' ? 'fala' : 'mudo';
  let aptos = opts.dry ? naVez : naVez.filter(f => vagaDe[relogioDe(f)] > 0);
  let linhaEstourou = false;

  // Teto anti-ban ANTES de mexer na ficha: remarcar sem conseguir avisar é
  // marcar reunião que a pessoa não sabe que existe.
  //
  // Ele tira da fila SÓ QUEM FALA, e isto era um defeito de duas pontas: o teste
  // era `status !== 'agendado'`, que dá verdadeiro pra toda ficha em negociação
  // — calada — e era medido com `.some()` sobre a fila TODA em vez da ficha que
  // ia se mover. Com 66 `nao_atendeu` esperando, isso era sempre verdadeiro:
  // todo o ciclo silencioso ficava pendurado no teto de uma linha que ele não
  // usa. Só pergunta ao throttle se sobrou falante na fila.
  //
  // E A CONTA TEM QUE SER DA LINHA INTEIRA (02/10/2026). Era `transacional:
  // false`, que conta só os prefixos FRIOS. Só que o carimbo deste módulo é
  // `ep_agenda_sent:<id>:reagendado`, prefixo da AGENDA: o robô não enxergava os
  // próprios envios, o contador dele nunca subia e o teto de 6/h nunca fechava.
  // Em 02/10 ele mandou 39 remarcações das 9h00 às 9h55, uma a cada ~90s, para
  // fichas de agosto que nunca responderam, e a linha 5040 caiu às 9h55.
  // `transacional: true` aqui NÃO é passe livre: sem `piso*` ele só troca a
  // conta pela da linha toda, que é a que inclui este carimbo.
  //
  // LINHA FORA DO AR, MESMA SAÍDA (03/10/2026). O teto não enxerga queda: com
  // a linha caída nada sai, o contador fica zerado e o teto diz "pode". A ficha
  // era remarcada, o envio falhava logo depois, e o `break` do erro só limitava
  // o estrago a uma por tick. Das 9h46 às 10h06 de 03/10 foram 15 reuniões
  // mudadas de dia sem o cliente saber. Duas fontes, porque cada uma cega num
  // lado: o cooldown do zapiClient sabe da falha desta invocação, e o monitor
  // (`zapi_io_health.downStreak`) sabe da queda que outra invocação viu. Depois
  // que a linha volta, o monitor segura o que fala por até 1h, até a próxima
  // checagem dele, e isso também serve de aquecimento.
  if (!opts.dry && aptos.some(f => relogioDe(f) === 'fala') && (await linhaIoForaDoAr())) {
    logger.info('ep-reagenda', 'linha IO fora do ar — nesta rodada andam só os calados');
    linhaEstourou = true;
    aptos = aptos.filter(f => relogioDe(f) === 'mudo');
  }
  if (!opts.dry && aptos.some(f => relogioDe(f) === 'fala')
      && !(await dentroDoTetoHorarioLinha({ transacional: true }))) {
    logger.info('ep-reagenda', 'teto da linha estourado — nesta rodada andam só os calados');
    linhaEstourou = true;
    aptos = aptos.filter(f => relogioDe(f) === 'mudo');
  }
  if (!aptos.length) {
    logger.info('ep-reagenda', `ninguém pode andar: fila ${naVez.length}, vaga fala ${vagaDe.fala}, vaga mudo ${vagaDe.mudo}`);
    // O motivo não pode virar um só: "a linha estourou" e "a rampa encheu" se
    // resolvem de formas diferentes, e é por este campo que a gente descobre
    // qual das duas foi.
    return zero(linhaEstourou ? 'teto_da_linha' : 'rampa_do_dia_cheia');
  }

  const telPorConsultor = await carregarConsultores();
  const alvos = aptos.slice(0, POR_TICK * TENTATIVAS_POR_RODADA);
  const previa: NonNullable<ResultadoReagendaAuto['previa']> = [];
  let remarcados = 0, erros = 0;

  for (const f of alvos) {
    // Para no que MOVEU, não no que tentou: é isto que faz a fila andar quando a
    // primeira ficha não tem vaga.
    if (remarcados >= POR_TICK) break;
    const tentativa = (estadoDe.get(f.id)?.n ?? 0) + 1;
    // O degrau da escada. UMA conta, usada nos três lugares: decidir se a
    // ficha podia andar (lá no `descansou`), escrever a linha do card e gravar
    // o carimbo. Recalcular em cada lugar seria convidar os três a discordar.
    const degrau = degrauDaProximaVolta(estadoDe.get(f.id), String(f.status));
    const quem = String(f.vendedor_nome);
    try {
      const ehNegociacao = ehNegociacaoStatus(String(f.status));
      // UMA leitura do relógio, ANTES do update: o vermelho volta pra `agendado`
      // na mesma gravação, e reler depois o carimbaria como calado.
      const relogio = relogioDe(f);
      const lista = await candidatosDoOutroDia(quem, String(f.quando), agora, ehNegociacao);
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

      const novo = await gravarNovoHorario(f, lista, tentativa, degrau);
      if (!novo) continue;

      // A partir daqui a reunião JÁ mudou. A tentativa é contada aqui, no que
      // aconteceu de fato — mensagem é melhor esforço, remarcação não é.
      const nowIso = new Date().toISOString();
      await supabase.from('system_state').upsert(
        {
          key: `${EP_REAGENDA_PREFIX}${f.id}`,
          // `relogio` é o que separa as duas rampas. Sem ele a conta volta a ser
          // uma só e o calado fica preso atrás do que fala.
          // `status` e `degrau` são a escada: a etiqueta desta volta e em que
          // degrau ela caiu. A próxima rodada compara a etiqueta de então com
          // esta — igual sobe, diferente zera.
          value: {
            n: tentativa, ultimo: nowIso, de: f.quando, relogio,
            status: String(f.status), degrau,
          },
          updated_at: nowIso,
        },
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
      // MUDO: não fala com o cliente. Vale pros dois caminhos silenciosos.
      // ESQUECIDO: além de mudo, carimba `confirmacao_at`, e por isso precisa da
      // marca que impede a régua do SIM de liberar o horário. Negociação não
      // carimba nada, porque o status dela já a esconde de todo mundo.
      const esquecido = f.status === 'agendado';
      const mudo = esquecido || ehNegociacaoStatus(String(f.status));
      if (!mudo) {
        const bruto = String(f.cliente_nome || '').trim().split(/\s+/)[0] || '';
        const primeiro = bruto.length >= 2 && bruto.length <= 20 && bruto.toLowerCase() !== 'lead' ? bruto : '';
        const tel = String(f.cliente_telefone).replace(/\D/g, '');
        await sendHuman(
          tel,
          bolhasReagendado(primeiro, String(f.quando), novo, quem, telPorConsultor.get(quem) ?? null, tentativa),
          'io',
          // Quem recebe isto sumiu de uma reunião: é toque frio, e toque frio é
          // UMA mensagem desde o bloqueio de agosto. Sem `maxBolhas` o fatiador
          // soltava 3 ou mais bolhas por pessoa.
          { maxBolhas: 1, max: 1200 },
        );
      }
      // A MARCA DO SILÊNCIO. Sem ela o `eletropostoCobraSim` lê o
      // `confirmacao_at` abaixo como "o cliente foi avisado e não respondeu" e
      // libera o horário — foi assim que 14 fichas amanheceram canceladas em
      // 01/10. Vai antes do `confirmacao_at` de propósito: entre carimbar e
      // marcar não pode existir um instante em que a ficha parece confirmada
      // sem estar marcada como muda.
      // A marca vale pros DOIS caminhos mudos. Ela deixou de ser so uma defesa
      // contra a regua do SIM: desde 01/10 e ela que cala a regua da agenda
      // tambem, no lugar do `confirmacao_at` que tinha dois donos.
      if (mudo) {
        await supabase.from('system_state').upsert(
          { key: `${EP_MUDO_PREFIX}${f.id}`, value: { quando: novo, em: nowIso }, updated_at: nowIso },
          { onConflict: 'key' },
        ).then(undefined, (e: unknown) =>
          logger.error('ep-reagenda', 'marca do silêncio falhou', { id: f.id, erro: String(e) }));
      }
      // Carimbo do teto da linha (o mesmo prefixo dos outros toques da agenda) e,
      // junto, o `confirmacao_at`: é ele que impede a régua da agenda de mandar a
      // confirmação padrão em cima desta mensagem.
      // SÓ QUEM FALOU CARIMBA (03/10/2026). O teto, o espaçamento de 10 min e a
      // Central das Agentes leem este prefixo como "mensagem que saiu". O
      // caminho mudo não manda nada, e carimbando ele gastava orçamento da linha
      // com mensagem fantasma: até 200 por dia de rampa muda, segurando
      // confirmação de agenda que tinha gente esperando.
      if (!mudo) {
        await supabase.from('system_state').upsert(
          { key: `${EP_AGENDA_PREFIX}${f.id}:reagendado`, value: { em: nowIso, para: novo }, updated_at: nowIso },
          { onConflict: 'key' },
        ).then(undefined, (e: unknown) =>
          logger.error('ep-reagenda', 'carimbo do teto da linha falhou', { id: f.id, erro: String(e) }));
      }
      // ── SÓ QUEM FALOU CARIMBA `confirmacao_at` ────────────────────────────
      //
      // Este campo significa UMA coisa: "a mensagem de confirmação saiu pro
      // cliente e estamos esperando a resposta dele". Quem o lê age em cima
      // disso: a régua do SIM cobra e libera o horário, e o card da agenda pinta
      // NÃO CONFIRMOU.
      //
      // Os dois caminhos MUDOS não mandam mensagem nenhuma, então carimbar seria
      // mentir, e a mentira saiu cara em 01/10: a régua do SIM liberou 14
      // horários achando que o cliente tinha calado, e o card dizia pro Diego
      // que eles não confirmaram — quando ninguém tinha falado com eles. Quem
      // cala a régua da agenda agora é a marca `ep_mudo`, que tem um dono só.
      if (!mudo) {
        await supabaseGerador.from('agendamentos')
          .update({ confirmacao_at: new Date().toISOString() }).eq('id', f.id);
      }

      remarcados++;
      logger.info('ep-reagenda', `ficha #${f.id} remarcada (${tentativa}/${maxVoltas()})`, { de: f.quando, para: novo });
    } catch (e) {
      logger.error('ep-reagenda', 'reagendamento falhou', { id: f.id, erro: String(e) });
      erros++;
      // ERRO PARA A RODADA (02/10/2026). O laço só parava no que MOVEU, então
      // um erro seguia pra próxima ficha. Com a linha caída cada uma era
      // remarcada ANTES do envio falhar: num tick só, 8 fichas mudaram de dia
      // sem o cliente saber, e a rampa passou de 39/40 pra 47/40.
      break;
    }
  }

  return { remarcados, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
