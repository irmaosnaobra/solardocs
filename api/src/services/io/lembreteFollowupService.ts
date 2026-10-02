// ─────────────────────────────────────────────────────────────────────────────
// MÁQUINA DE LEMBRETE DE FOLLOW-UP — "liga agora nesse cliente".
//
// Ordem do Thiago (29/09/2026): revisar os contatos em aberto de TODO MUNDO e
// mandar, no celular de cada um, um lembrete direto pra ligar. Um a cada 30
// minutos, das 10h às 20h. Meta declarada: zero gente aguardando, e ninguém
// esquecido.
//
// ── O buraco, medido no banco em 29/09/2026 ────────────────────────────────
//
// Cards de reunião com horário JÁ VENCIDO e status ainda vivo, desde 01/07:
//
//     nao_atendeu          124     ninguém atendeu e ninguém ligou de novo
//     em_atendimento        65     negociando, e parou
//     agendado              59     a hora passou e o card nunca foi fechado
//     fez_orcamento         45     recebeu preço e ninguém voltou
//     proposta_apresentada  24     viu a proposta e ninguém voltou
//     ───────────────────────────
//     317 contatos em aberto      Diego 134 · Giovanna 108 · Thiago 47 · Nilce 28
//
// Nenhum robô olha pra isso hoje. Os que existem olham outra coisa:
//   • a sentinela do vácuo cobra QUEM ESCREVEU e não foi respondido (medido no
//     mesmo dia: 1 conversa na fila, ou seja, aquele buraco está fechado);
//   • o card ping avisa quem RECEBEU uma ficha no repasse de 12h;
//   • o alerta de 10 min avisa da reunião que vai começar.
// Card parado não é nada disso. É o cliente que já falou com a gente, não disse
// não, e está esperando alguém terminar o atendimento.
//
// ── Por que UM a cada 30 minutos, e não a lista ────────────────────────────
//
// Lista de 134 nomes não é tarefa, é paisagem: lê-se uma vez e ignora-se sempre.
// A sentinela já aprendeu isso na pele (o comentário dela diz: o robô que repete
// é o robô que a equipe silencia). Um cliente por vez, com o telefone e o motivo
// na mão, é uma tarefa de 3 minutos que cabe entre duas ligações.
//
// 20 slots por pessoa por dia (10h às 20h, de 30 em 30). Com 4 consultores dá 80
// toques/dia: os 317 abertos passam pela mesa de alguém em 4 dias úteis.
//
// ── O que escolhe o cliente da vez é CONTA, não modelo de linguagem ────────
//
// A ordem sai de `pontuarCard()`, que é pura, exportada e presa por teste: peso
// do ESTÁGIO (o botão de status que o consultor apertou) e dias úteis parado. A
// temperatura não entra, e desde 29/09/2026 nem existe como coluna no CRM: é
// palpite gravado uma vez no formulário, contra um status que alguém apertou
// depois de falar com a pessoa. Quando discordam, quem sabe mais é o status.
// Modelo de linguagem aqui
// só teria uma função, inventar o cliente que não existe, e essa é exatamente a
// que não pode ter. A "informação relevante" que o Thiago pediu vem de campo
// real do card (consumo, urgência, quem decide, motivo, cidade, a observação do
// lead), recortada em `contextoDoCard()`. É informação, não paráfrase.
//
// ── O que impede de virar mais um robô que a equipe silencia ───────────────
//
//   • UM envio por pessoa por slot de 30 min, carimbado ANTES do envio
//     (`lembrete_slot:`). Carimbar depois foi o bug do placar: tick repetido
//     manda duas vezes.
//   • Teto de 3 toques no MESMO card (`lembrete_card:`), com folga de 48h entre
//     eles. Sem isso um card teimoso come todos os slots pra sempre. **O teto
//     não vale pra família do ciclo** desde 30/09/2026 — ver abaixo.
//   • Janela 10h–20h, sem domingo, sem feriado. Sábado entra: a agenda do solar
//     trabalha sábado.
//   • Card que a sentinela do vácuo cobrou nas últimas 24h não vira lembrete. O
//     dono acabou de ver aquele nome; repetir por outro canal é o mesmo robô
//     falando duas vezes.
//
// ── Este envio NÃO passa pelo teto anti-ban da linha ───────────────────────
//
// Mesma medida escrita na sentinela e no placar, pelo mesmo motivo: o
// destinatário é o celular da própria equipe, conversa aberta há meses. O teto
// existe pra proteger a linha de toque frio em desconhecido. Gastar orçamento de
// lead com recado interno é, ao contrário, o bug que calou todos os follow-ups
// quando a agenda comeu o orçamento.
//
// ── O CICLO DE 48 HORAS (30/09/2026) ──────────────────────────────────────
//
// Ordem do Thiago: "aquele que é o chave na mão, arrendamento, negociando,
// 50-50, ele voltar sempre 48 horas depois, pra ele ficar rodando e a gente
// fechar ou não fechar com esse cliente. Ele vai estar sempre ocupando a nossa
// agenda, então a gente tem que se livrar dele ou fechando ou dando um sem
// interesse nele pra ele sumir de vez. A gente precisa dar destino."
//
// Duas mudanças, e a segunda é a que faz a primeira funcionar:
//   1. os quatro modelos do eletroposto entram na varredura (eram 68 cards que
//      robô nenhum olhava, no produto onde está o dinheiro);
//   2. a família do ciclo perde o teto de 3 toques. Ela volta de 48 em 48 horas
//      até alguém dar destino. Ver `ESTAGIOS_CICLO`.
//
// ── O QUE "48 HORAS" VIRA NA PRÁTICA, E POR QUE ISSO ESTÁ CERTO ───────────
//
// 48h é o DESCANSO MÍNIMO de cada card, não a promessa de giro da fila. Medido
// em 30/09: 192 cards na família do ciclo (Diego 109, Thiago 49, Giovanna 34) e
// 20 slots por pessoa por dia = 60 toques/dia. O giro completo dá ~3,2 dias, e o
// do Diego sozinho ~5,5.
//
// Forçar 48h literais exigiria um slot a cada 11 minutos, e aí morre a premissa
// que fez este módulo existir: um cliente por vez, tarefa de 3 minutos que cabe
// entre duas ligações. Robô que fala de 11 em 11 minutos é robô que a equipe
// silencia no primeiro dia, e aí o giro vira infinito.
//
// O giro APERTA SOZINHO conforme a fila drena, e a fila drena porque agora todo
// card tem saída: Vendido, Sem interesse ou Apalavrado. Que a equipe usa a saída
// já está medido — são 601 cards em `sem_interesse` no banco. `LEMBRETE_PASSO_MIN`
// existe pra apertar sem deploy, se ele quiser.
//
// ── DESLIGADO EM 30/09/2026, NO MESMO DIA EM QUE O CICLO SUBIU ────────────
//
// Ordem do Thiago, horas depois de ver o ciclo funcionando: "não terá
// necessidade de ficar avisando mais a gente pelo WhatsApp, aquela ferramenta
// que a gente criou que avisa no WhatsApp não vai ser necessário mais... todos
// vão acompanhar pelo CRM, então menos mensagem para ficar chegando, vamos
// focar nos cards novos".
//
// `LEMBRETE_OFF=1` está posto na produção. O MÓDULO FICA: a conta que escolhe o
// card da vez (`pontuarCard`), a família do ciclo (`ESTAGIOS_CICLO`) e a sala de
// espera (`dormindo`) continuam sendo a definição escrita de "card parado" e de
// "quem volta a cada 48h", e o quadro do CRM foi desenhado em cima delas.
// Apagar o módulo apagaria a regra junto com o mensageiro.
//
// QUEM FOR RELIGAR ISTO, leia antes: o acompanhamento passou a ser visual, no
// quadro. Ligar de volta sem combinar devolve à equipe um canal que foi
// desligado de propósito, e o motivo do desligamento foi volume de mensagem,
// não defeito. `LEMBRETE_ESPELHO` continua apontando pro celular do Thiago, de
// propósito: se alguém religar sem querer, a rajada chega nele primeiro e não
// no time inteiro.
//
// Kill-switch: LEMBRETE_OFF=1 congela tudo sem deploy.
// LEMBRETE_ESPELHO=<telefone> manda tudo pra um número só (modo conferência).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { horasUteisEntre } from './sentinelaVacuo';
import { EQUIPE } from '../../routes/ioEletroposto';

// ── Envs, lidas a cada chamada ──────────────────────────────────────────────
// Nunca no arranque do módulo: instância quente na Vercel não recarrega módulo,
// e apertar um teto no meio de um dia ruim não pode depender de deploy. Mesma
// razão dos tetos do Menu de Avisos.
const num = (nome: string, padrao: number): number => {
  const cru = (process.env[nome] || '').trim();
  if (cru === '') return padrao;
  const v = Number(cru);
  return Number.isFinite(v) && v >= 0 ? v : padrao;
};

/** Kill-switch. */
export const desligado = (): boolean => (process.env.LEMBRETE_OFF || '').trim() === '1';

/** Janela do lembrete, em hora de Brasília. Pedido: 10h às 20h. */
export const inicioH = (): number => num('LEMBRETE_INICIO_H', 10);
export const fimH = (): number => num('LEMBRETE_FIM_H', 20);
/** Tamanho do slot em minutos. Pedido: um a cada 30 min. */
export const passoMin = (): number => num('LEMBRETE_PASSO_MIN', 30);
/** Quantas vezes o MESMO card pode virar lembrete. */
const maxPorCard = (): number => num('LEMBRETE_MAX_POR_CARD', 3);
/** Folga mínima, em horas, entre dois lembretes do mesmo card. */
const folgaCardH = (): number => num('LEMBRETE_FOLGA_H', 48);
/**
 * Quantos dias pra trás a varredura enxerga.
 *
 * Nasceu em 90 dias pra cemitério não virar tarefa. Virou 10 anos em 29/09/2026,
 * por ordem do Thiago ("adiciona na lista de followup mesmo os mais antigos,
 * podemos recuperar pessoas"), e a medição mostrou que o medo do cemitério não
 * se aplica aqui: a tabela `agendamentos` inteira só tem 319 cards abertos e o
 * mais antigo é de 09/05/2026, quando a agenda começou. Os 90 dias já pegavam
 * 308 deles — abrir tudo custou 11 cards, não um despejo.
 *
 * A env continua existindo pra ESTREITAR, que é o uso que faz sentido: se um dia
 * a base tiver anos de história, 90 volta a ser um número bom.
 */
const diasJanela = (): number => num('LEMBRETE_JANELA_DIAS', 3650);
/** Piso de espera: card que venceu agora há pouco não é abandono, é o dia
 *  acontecendo. Em horas ÚTEIS. */
const esperaMinimaH = (): number => num('LEMBRETE_ESPERA_MIN_H', 4);

/**
 * MODO ESPELHO — tudo num telefone só, nenhum consultor recebe.
 *
 * Ordem do Thiago (30/09/2026): "a partir de hoje não manda para ninguém e
 * manda para si próprio". É o modo de conferência: ele quer LER o que a máquina
 * escolheu e o que ela diz antes de aquilo chegar no celular do Diego e da
 * Giovanna.
 *
 * Duas coisas mudam, e a segunda é a que evita o tiro no pé:
 *   1. o destinatário passa a ser este número, sempre;
 *   2. sai UM card por slot no TOTAL, não um por consultor. Com 3 consultores
 *      com fila (Diego 109, Thiago 49, Giovanna 34), manter um por pessoa
 *      despejaria 60 mensagens/dia num telefone só — que é exatamente a "lista
 *      que vira paisagem" que este módulo existe pra não ser, só que pior,
 *      porque chega picotada.
 *
 * Vazio = modo normal, cada consultor recebe o seu.
 */
export const espelho = (): string => (process.env.LEMBRETE_ESPELHO || '').replace(/\D/g, '');

/** Estado da sala de espera: `apalavrado:<id>` → { aguardando, retomar_em, por, em }. */
export const APALAVRADO_PREFIX = 'apalavrado:';

/** Quanto tempo o card fica parado quando ninguém diz uma data. */
export const apalavradoDiasPadrao = (): number => num('APALAVRADO_DIAS', 30);

const TZ = 'America/Sao_Paulo';

/**
 * Os estágios em que a bola está com a gente.
 *
 * Fora daqui é desfecho e não é assunto de robô: `sem_interesse`, `perdido`,
 * `fechou`, `fechou_concorrente`, `cancelado`, `sem_orcamento`.
 * Incluir qualquer um deles seria mandar o consultor ligar pra quem já disse não,
 * que é a forma mais rápida de ensinar a equipe a ignorar este robô.
 *
 * ── OS QUATRO MODELOS DO ELETROPOSTO ENTRARAM EM 30/09/2026 ────────────────
 *
 * `arrendamento`, `carregador`, `meio_a_meio` e `chave_na_mao` estavam fora, e
 * o comentário que os tirava daqui dizia "é desfecho e não é assunto de robô".
 * Estava errado, e a ordem do Thiago (30/09) diz exatamente o contrário: "aquele
 * que é o chave na mão, arrendamento, negociando, 50-50, ele voltar sempre 48
 * horas depois, para a gente fechar ou não fechar com esse cliente".
 *
 * Escolher o modelo de negócio não é desfecho, é o MEIO da venda: o cliente
 * disse por qual porta quer entrar e ainda não assinou nada. Eram 68 cards
 * (medidos em 30/09: arrendamento 20, carregador 21, chave_na_mao 18,
 * meio_a_meio 9) que nenhum robô olhava, no produto onde está o dinheiro.
 *
 * ── POR QUE `arrendamento` PODE ENTRAR AQUI, se ele é excluído em todo lado ──
 *
 * Porque ESTA MÁQUINA NÃO FALA COM O CLIENTE. O destinatário é o celular do
 * consultor. As listas que excluem status (`STATUS_QUE_NAO_RECEBEM`,
 * `STATUS_ENCERRADOS`, `AG_MORTO`, `CRM_STATUS_PERDIDO`) existem pra proteger o
 * CLIENTE de receber mensagem que não faz sentido pra ele — e nenhuma delas se
 * aplica a um recado interno dizendo "liga nesse cara". Quem for mexer aqui vai
 * ter o reflexo de tirar `arrendamento` de novo: é o mesmo reflexo que escreveu
 * o comentário errado da primeira vez.
 *
 * `apalavrado` entra por um motivo diferente, e só acorda na data marcada — ver
 * `ESTAGIOS_CICLO` e `pausaApalavrado()` logo abaixo.
 */
export const ESTAGIOS_ABERTOS = [
  'agendado', 'nao_atendeu', 'falando_whatsapp', 'em_atendimento',
  'fez_orcamento', 'proposta_apresentada', 'reagendar',
  'arrendamento', 'carregador', 'meio_a_meio', 'chave_na_mao',
  // 01/10/2026: os dois modelos novos. Fora daqui, marcar um card como COTISTA
  // o faz PARAR de gerar lembrete — negociação viva que emudece sem avisar.
  'cotista', 'integrador',
  'apalavrado',
] as const;

/**
 * A FAMÍLIA QUE VOLTA PARA SEMPRE, de 48 em 48 horas.
 *
 * Ordem do Thiago (30/09/2026): "ele vai estar sempre ocupando ali a nossa
 * agenda, então a gente tem que se livrar dele ou fechando ou dando um sem
 * interesse nele pra ele sumir de vez". Ou seja: card com negociação viva não
 * tem teto de insistência. Ele sai da fila pela porta da frente (`fechou`), pela
 * porta dos fundos (`sem_interesse`) ou pela sala de espera (`apalavrado`), e
 * por mais nenhuma.
 *
 * O teto de 3 toques (`LEMBRETE_MAX_POR_CARD`) continua valendo pra TODO O
 * RESTO, e isso é de propósito:
 *   · `nao_atendeu` — "continua a mesma regra", ele disse duas vezes. Quem cuida
 *     dele é a régua de remarcação (`eletropostoReagendaAuto` /
 *     `reagendaSolarNaoAtendido`), que marca a reunião de novo e faz a agenda
 *     falar. Tirar o teto aqui empilharia um segundo robô em cima do primeiro.
 *   · `agendado` e `reagendar` — a hora passou e ninguém fechou o card. É
 *     higiene de cadastro, não negociação: 3 toques resolvem ou o card está
 *     morto.
 *
 * A conta de por que isso importa: sem o corte, as 423 fichas abertas entrariam
 * no ciclo infinito e o giro completo levaria 7 dias. Com o corte, são 192, e o
 * giro cai pra ~3 dias — e aperta sozinho conforme a fila drena.
 */
export const ESTAGIOS_CICLO = new Set<string>([
  'em_atendimento', 'fez_orcamento', 'proposta_apresentada',
  'arrendamento', 'carregador', 'meio_a_meio', 'chave_na_mao',
  // 01/10/2026. Sem eles aqui, COTISTA e INTEGRADOR caem no teto de 3 toques
  // e desaparecem na quarta volta — o mesmo jeito silencioso de sumir com uma
  // pessoa que o comentário acima descreve pro `apalavrado`.
  'cotista', 'integrador',
]);

/**
 * Este estágio pode ser cobrado quantas vezes for preciso?
 *
 * `apalavrado` entra junto com a família do ciclo, e por um motivo que não é
 * óbvio: o teto de 3 toques o MATARIA em silêncio. O card acorda no dia que o
 * dono marcou, é cobrado, alguém adia, acorda de novo… na quarta volta o teto
 * fecha e o card nunca mais aparece pra ninguém. Ou seja: o status criado
 * justamente pra "essa pessoa não sumir da vida" viraria o jeito mais garantido
 * de sumir com ela, e sem nenhum aviso.
 *
 * O teto continua valendo pro que ele foi escrito: `nao_atendeu`, `agendado` e
 * `reagendar`, onde insistir sem fim é ruído. A folga de 48h vale pra todos.
 */
export const semTetoDeToques = (status: string): boolean =>
  ESTAGIOS_CICLO.has(status) || status === 'apalavrado';

/** Peso do estágio na fila. Quanto mais perto do sim, mais cedo se liga:
 *  quem já viu proposta e sumiu é quem ainda dá pra salvar. */
const PESO_ESTAGIO: Record<string, number> = {
  // Os quatro modelos do eletroposto vêm ACIMA de proposta apresentada: o
  // cliente já escolheu POR QUAL PORTA quer entrar, o que é um passo adiante de
  // ter só visto o preço. Sem estas quatro linhas eles cairiam no `?? 1` do
  // `pontuarCard` e ficariam atrás até de `agendado` — os 68 cards que o Thiago
  // mais quer trabalhados dormiriam no fim da fila.
  chave_na_mao: 9,          // leva o eletroposto inteiro: maior ticket, mais perto do sim
  meio_a_meio: 8,           // sociedade 50/50
  arrendamento: 8,          // cede o ponto, nós investimos 100%
  carregador: 7,            // leva só o equipamento
  // 01/10/2026. Os dois entram no degrau do carregador, e não acima: nesta
  // operação o escasso é o PONTO, não o capital. Quem entra com dinheiro é a
  // fila grande; quem tem o local é a fila curta.
  cotista: 7,               // entra com dinheiro, não com ponto
  integrador: 7,            // compra pra revender ou instalar pra terceiro
  apalavrado: 7,            // só chega aqui com o prazo VENCIDO, e aí é urgente
  proposta_apresentada: 6,
  fez_orcamento: 5,
  em_atendimento: 4,
  falando_whatsapp: 4,
  reagendar: 3,
  nao_atendeu: 2,
  agendado: 1,
};

/** Como o card aparece escrito no recado, igual à etiqueta do /gerador. */
const ROTULO_ESTAGIO: Record<string, string> = {
  chave_na_mao: 'CHAVE NA MÃO',
  meio_a_meio: '50/50 — SOCIEDADE',
  arrendamento: 'ARRENDAMENTO',
  carregador: 'CARREGADOR',
  cotista: 'COTISTA',
  integrador: 'INTEGRADOR',
  apalavrado: 'APALAVRADO — PRAZO VENCIDO',
  proposta_apresentada: 'PROPOSTA APRESENTADA',
  fez_orcamento: 'FEZ ORÇAMENTO',
  em_atendimento: 'NEGOCIANDO',
  falando_whatsapp: 'FALANDO NO WHATSAPP',
  reagendar: 'PRA REAGENDAR',
  nao_atendeu: 'NÃO ATENDEU',
  agendado: 'REUNIÃO VENCIDA SEM DESFECHO',
};

/** A frase de comando. É o que o Thiago pediu: direto, com o motivo junto. */
// Cada linha nomeia as SAÍDAS, porque é isso que o Thiago pediu ("a gente tem
// que se livrar dele ou fechando ou dando um sem interesse"). Card da família do
// ciclo volta de 48 em 48h pra sempre: quem lê precisa saber que existe um botão
// que faz ele parar, senão o robô vira barulho e a equipe aprende a ignorar.
const CHAMADA: Record<string, string> = {
  chave_na_mao: 'Escolheu CHAVE NA MÃO e parou. Liga pra fechar. Se não for agora, marca Apalavrado com a data, ou Sem interesse.',
  meio_a_meio: 'Escolheu a sociedade 50/50 e parou. Liga pra fechar. Se depender de investidor ou terreno, marca Apalavrado com a data.',
  arrendamento: 'Vai ceder o ponto e a gente investe 100%. Liga pra fechar o contrato. Se estiver esperando algo, marca Apalavrado com a data.',
  carregador: 'Quer só o carregador e parou. Liga pra fechar ou marca Sem interesse.',
  cotista: 'Quer entrar como COTISTA, com dinheiro e sem ponto. Liga pra fechar. Se estiver esperando o local, marca Apalavrado com a data.',
  integrador: 'É INTEGRADOR: compra pra revender ou instalar pra terceiro. Liga pra fechar o pedido ou marca Sem interesse.',
  apalavrado: 'Você marcou APALAVRADO e o prazo que você mesmo deu venceu. Liga pra confirmar: fecha, estica o prazo ou solta.',
  proposta_apresentada: 'Viu a proposta e não voltou. Liga pra saber o que ficou faltando.',
  fez_orcamento: 'Recebeu o preço e ninguém voltou nele. Liga pra fechar.',
  em_atendimento: 'A negociação parou no meio. Liga pra retomar.',
  falando_whatsapp: 'A conversa no WhatsApp esfriou. Liga, no áudio anda mais rápido.',
  reagendar: 'Ficou pra remarcar e não remarcou. Liga e põe uma data de pé.',
  nao_atendeu: 'Não atendeu da última vez e ninguém tentou de novo. Liga agora.',
  agendado: 'A hora da reunião passou e o card nunca foi fechado. Liga pra saber o que houve.',
};

export interface CardAberto {
  id: number;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  cidade: string | null;
  status: string;
  temperatura: string | null;
  quando: string | null;
  observacao: string | null;
  historico: string | null;
  created_at: string | null;
  proposta_em: string | null;
  apresentacao_em: string | null;
  lead_resposta_at: string | null;
  presenca_confirmada_at: string | null;
  confirmacao_at: string | null;
}

// ── Relógio ─────────────────────────────────────────────────────────────────

/** Agora em horário de Brasília, como Date lido pelos getters locais. */
export const agoraBrt = (base: Date = new Date()): Date =>
  new Date(base.toLocaleString('en-US', { timeZone: TZ }));

const ymd = (b: Date): string =>
  `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}`;

/**
 * A qual slot de 30 minutos este instante pertence, e se dá pra mandar agora.
 *
 * O slot é NUMERADO a partir do início da janela, e não é a hora do relógio: o
 * tick que chama isto roda de ~2 em 2 minutos, então sem um número de slot
 * estável o mesmo lembrete sairia 15 vezes seguidas. O carimbo `lembrete_slot:`
 * mora nesse número.
 *
 * Pura e exportada de propósito: é a regra que decide quando o robô fala, e é
 * ela que o teste prende.
 */
export function slotAgora(
  agora: Date = new Date(),
): { ok: boolean; motivo?: string; slot: number | null; dia: string } {
  const b = agoraBrt(agora);
  const dia = ymd(b);
  if (b.getDay() === 0) return { ok: false, motivo: 'domingo', slot: null, dia };
  if (ehFeriadoBR(dia)) return { ok: false, motivo: 'feriado', slot: null, dia };
  const h = b.getHours();
  if (h < inicioH() || h >= fimH()) return { ok: false, motivo: 'fora_da_janela', slot: null, dia };
  const minutos = (h - inicioH()) * 60 + b.getMinutes();
  return { ok: true, slot: Math.floor(minutos / Math.max(1, passoMin())), dia };
}

/**
 * Quando este card foi tocado pela última vez.
 *
 * `agendamentos` não tem `updated_at` (conferido no banco em 29/09/2026), então
 * o último toque é o mais recente dos carimbos que existem. O `quando` entra
 * porque a hora marcada da reunião É um toque: foi a última coisa combinada.
 */
export function ultimoToque(c: CardAberto): Date | null {
  const candidatos = [
    c.apresentacao_em, c.proposta_em, c.lead_resposta_at,
    c.presenca_confirmada_at, c.confirmacao_at, c.quando, c.created_at,
  ];
  let maior: number | null = null;
  for (const iso of candidatos) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    // Carimbo no futuro não é toque: é reunião ainda por acontecer, e essa não é
    // assunto desta máquina (o alerta de 10 min cuida dela).
    if (t > Date.now()) continue;
    if (maior === null || t > maior) maior = t;
  }
  return maior === null ? null : new Date(maior);
}

// ── A SALA DE ESPERA ────────────────────────────────────────────────────────

/** O que fica guardado quando um card é posto em espera. */
export interface Pausa {
  /** O que estamos esperando, na palavra de quem marcou: "o investidor", "o
   *  terreno em Catalão", "a assinatura do contrato". */
  aguardando?: string;
  /** ISO. Quando o card volta pra fila sozinho. */
  retomar_em?: string;
  por?: string;
  em?: string;
}

/**
 * Este card está dormindo agora?
 *
 * Ordem do Thiago (30/09/2026): "quando a pessoa vai arrendar, a gente tem que
 * concluir com ela, então a gente tem que criar uma etiqueta para ela não ficar
 * voltando... entre o perdido e o vendido vai ter aquela margem da pessoa que
 * está em stand-by, que a gente está negociando alguma forma de fechamento. Ela
 * é uma pessoa que não fica recebendo mais mensagem."
 *
 * Os casos que ele deu são os dois que definem o estado: o cliente de Guarapari,
 * apalavrado no 50/50, esperando só o investidor; e o Cristiano de Curitiba,
 * apalavrado, esperando um terreno em Catalão pra entrar com o investimento.
 * Gente que já disse SIM e está esperando uma peça que não depende da gente.
 * Cobrar de 48 em 48 horas quem já disse sim é a maneira mais rápida de
 * transformar um sim em não.
 *
 * ── POR QUE A ESPERA TEM DATA, E NÃO É SÓ UM "PAUSADO" ────────────────────
 *
 * Porque pausa sem data é cemitério, e cemitério é o oposto do que ele pediu no
 * mesmo dia ("a gente precisa dar destino"). O card dorme até `retomar_em` e
 * acorda sozinho, com uma chamada que diz que o prazo venceu. Sem essa data, o
 * Guarapari ficaria em "esperando o investidor" pra sempre e a sala de espera
 * viraria o lugar onde os negócios vão morrer sem ninguém assinar embaixo.
 *
 * ── SEM DATA, DORME O PRAZO PADRÃO — NÃO ACORDA NA HORA ───────────────────
 *
 * O CRM grava o status direto no banco (`crmAtualizarStatus` → `supaPatch`), e
 * gravar a espera é uma segunda escrita que pode não acontecer: tela velha em
 * cache do PWA, rede caindo no meio, ou alguém mexendo na linha pelo Supabase.
 * Se "sem carimbo" quisesse dizer "acorda agora", apertar APALAVRADO devolveria
 * uma cobrança no mesmo dia — o oposto exato do botão que a pessoa apertou.
 *
 * Então sem data o card dorme `APALAVRADO_DIAS` (30) contados do último toque, e
 * depois acorda. É pausa nos dois casos, nunca gaveta: com data, a que o dono
 * deu; sem data, a padrão.
 *
 * Pura e exportada: é a regra do silêncio, e é ela que o teste prende.
 */
export function dormindo(
  p: Pausa | undefined,
  agora: Date,
  desde: Date | null,
  diasPadrao: number,
): boolean {
  const t = Date.parse(String(p?.retomar_em || ''));
  if (Number.isFinite(t)) return t > agora.getTime();   // a data que o dono deu manda
  if (!desde) return false;        // sem data e sem último toque, não há o que contar
  return agora.getTime() - desde.getTime() < diasPadrao * 86400_000;
}

/** "esperando o investidor · prazo venceu em 12/10" — a linha que entra no recado. */
export function linhaDaEspera(p: Pausa | undefined): string | null {
  if (!p) return null;
  const oQue = String(p.aguardando || '').trim();
  const t = Date.parse(String(p.retomar_em || ''));
  const dia = Number.isFinite(t)
    ? new Date(t).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
    : null;
  if (!oQue && !dia) return null;
  return [oQue ? `Estava esperando: ${oQue}` : null, dia ? `prazo ${dia}` : null]
    .filter(Boolean).join(' · ');
}

// ── A conta que escolhe o cliente da vez ────────────────────────────────────

/**
 * Nota do card. Maior liga primeiro.
 *
 * Duas parcelas:
 *   estágio × 10 — quem está perto do sim vale mais que quem nem atendeu
 *   dias úteis parados (teto 15) — o tempo desempata dentro do mesmo estágio, e
 *                                  sozinho nunca passa na frente de um estágio
 *                                  mais avançado
 *
 * ── A TEMPERATURA SAIU DAQUI EM 29/09/2026 ─────────────────────────────────
 *
 * Ela era a segunda parcela (quente × 4). Ordem do Thiago no mesmo dia: "as
 * colunas quente, morno e frio não têm necessidade, tem que acompanhar os botões
 * de status existentes".
 *
 * E ela estava ERRADA aqui pelo mesmo motivo que estava errada no kanban: é um
 * palpite gravado uma vez, no ato do agendamento, enquanto o status é o que o
 * consultor apertou DEPOIS de falar com a pessoa. Quando os dois discordam, quem
 * sabe mais é o status. Com a temperatura na conta, um lead `quente` que nunca
 * atendeu podia passar na frente de um `frio` que já tinha recebido proposta —
 * ou seja, o palpite do formulário na frente do fato da conversa.
 *
 * O parâmetro continua na assinatura e é IGNORADO de propósito: os chamadores e
 * os testes não precisam mudar de forma, e a próxima pessoa que abrir isto vê
 * que a decisão foi tomada, não esquecida.
 *
 * Pura e exportada: é a regra de prioridade, e é a que o teste prende.
 */
export function pontuarCard(status: string, _temperatura: string | null, horasUteis: number): number {
  const estagio = PESO_ESTAGIO[status] ?? 1;
  const diasParado = Math.min(horasUteis / 11, 15);          // 11h de expediente por dia
  return estagio * 10 + diasParado;
}

/** O primeiro nome, pra mensagem não virar cartório. */
const primeiroNome = (n: string | null): string => {
  const p = String(n || '').trim().split(/\s+/)[0] || '';
  return p && p.toLowerCase() !== 'lead' ? p : '';
};

/** Telefone do jeito que o consultor digita: sem o 55. */
export function telExibicao(tel: string | null): string {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d.slice(2);
  return d;
}

/**
 * A informação relevante, tirada do card.
 *
 * A `observacao` dos leads de anúncio vem estruturada ("Consumo: 500 a 700",
 * "Urgência: 30 dias", "Quem decide: Decide Junto", "Motivo: ..."). São
 * justamente as linhas que decidem o tom da ligação, então elas saem nomeadas e
 * na ordem em que importam. Quando a observação é texto solto, vai o começo
 * dela; quando não há observação nenhuma, vai a primeira linha do histórico,
 * que é a última coisa que alguém escreveu ali.
 */
export function contextoDoCard(c: CardAberto, max = 4): string[] {
  const obs = String(c.observacao || '');
  const CAMPOS = ['Consumo', 'Urgência', 'Urgencia', 'Pagamento', 'Quem decide', 'Motivo', 'O que importa'];
  const achados: string[] = [];
  for (const campo of CAMPOS) {
    if (achados.length >= max) break;
    const m = obs.match(new RegExp(`^${campo}\\s*:\\s*(.+)$`, 'mi'));
    const v = m?.[1]?.trim();
    if (!v) continue;
    const rotulo = campo === 'Urgencia' ? 'Urgência' : campo;
    if (achados.some(a => a.startsWith(`${rotulo}:`))) continue;
    achados.push(`${rotulo}: ${v}`);
  }
  if (achados.length) return achados;

  const solta = obs.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('['))[0];
  if (solta) return [solta.length > 120 ? `${solta.slice(0, 120)}…` : solta];

  const hist = String(c.historico || '').split('\n').map(s => s.trim()).find(Boolean);
  if (hist) return [hist.length > 120 ? `${hist.slice(0, 120)}…` : hist];
  return [];
}

/** "3 dias de trabalho", "5h". Dia de trabalho, não dia de calendário: card que
 *  venceu sexta às 18h não está parado há 3 dias na segunda de manhã. */
export function esperaPorExtenso(horasUteis: number): string {
  const dias = horasUteis / 11;
  if (dias >= 1) return `${Math.floor(dias)} dia(s) de trabalho`;
  if (horasUteis >= 1) return `${Math.floor(horasUteis)}h`;
  return `${Math.max(1, Math.round(horasUteis * 60))}min`;
}

/**
 * O recado que chega no celular.
 *
 * Um emoji, só na primeira linha. Sem travessão. O telefone aparece em texto
 * (dá pra copiar e discar) E como link do WhatsApp, porque metade do time liga e
 * metade manda áudio. O link da ficha fecha o ciclo: quem atender tem que poder
 * mudar o status ali mesmo, senão o mesmo card volta daqui a 48h.
 */
export function montarLembrete(
  c: CardAberto,
  horasUteis: number,
  toque: number,
  opts: { pausa?: Pausa; espelhoDe?: string | null } = {},
): string {
  const nome = c.cliente_nome?.trim() || 'Sem nome';
  const tel = telExibicao(c.cliente_telefone);
  const digitos = String(c.cliente_telefone || '').replace(/\D/g, '');
  const ctx = contextoDoCard(c);
  const quem = primeiroNome(c.vendedor_nome);
  const espera = linhaDaEspera(opts.pausa);
  return [
    // No modo espelho o recado abre dizendo DE QUEM ele é. Sem esta linha o
    // Thiago recebe 20 "liga agora" por dia sem saber quais são dele e quais
    // seriam do Diego — e o modo existe justamente pra ele conferir a escolha.
    opts.espelhoDe ? `👁️ *ESPELHO — iria pra ${opts.espelhoDe.toUpperCase()}*` : null,
    opts.espelhoDe ? '' : null,
    `${opts.espelhoDe ? '' : '📞 '}*LIGA AGORA: ${nome}*`,
    tel ? `*${tel}*` : null,
    '',
    CHAMADA[c.status] || 'Esse cliente está esperando alguém finalizar o atendimento.',
    '',
    `Parado há ${esperaPorExtenso(horasUteis)}`,
    // O status é o botão que o consultor apertou, e é a única etiqueta que sai
    // aqui. A temperatura saiu da mensagem em 29/09/2026 junto com as colunas do
    // CRM: mostrar "QUENTE" ao lado de "NÃO ATENDEU" é dar duas respostas
    // diferentes pra mesma pergunta, e quem lê no celular obedece a errada.
    `Status: ${ROTULO_ESTAGIO[c.status] || c.status.toUpperCase()}${c.cidade ? ` · ${c.cidade}` : ''}`,
    espera,
    ...(ctx.length ? ['', ...ctx.map(l => `• ${l}`)] : []),
    '',
    digitos ? `Chamar no WhatsApp: wa.me/${digitos}` : null,
    `Abrir a ficha: https://solardoc.app/gerador/agenda?ag=${c.id}&ver=1`,
    '',
    // Card da família do ciclo não tem teto: ele volta de 48 em 48h até alguém
    // dar destino. Dizer isso em voz alta é o que separa "robô insistente" de
    // "robô que você sabe desligar" — e as três saídas vão nomeadas, senão a
    // única que a pessoa lembra é ignorar.
    ESTAGIOS_CICLO.has(c.status)
      ? `_${toque}º lembrete${quem ? `, ${quem}` : ''}. Este volta a cada 48h até você fechar (Vendido), soltar (Sem interesse) ou pôr na espera (Apalavrado, com a data)._`
      : toque > 1
        ? `_${toque}º lembrete deste card${quem ? `, ${quem}` : ''}. Se já resolveu, muda o status na ficha que ele para de voltar._`
        : `_Atualiza o status na ficha depois de falar${quem ? `, ${quem}` : ''}. É assim que ele sai da fila._`,
    // Sai da lista só o que FALTOU no card (`null`). As strings vazias são os
    // parágrafos, de propósito: filtrar por `l !== ''` come todas elas e o
    // recado chega como parede de texto, que é o que ninguém lê no celular.
  ].filter((l): l is string => l !== null).join('\n');
}

// ── Marcadores ──────────────────────────────────────────────────────────────

/** Um envio por pessoa por slot. Carimbado ANTES de mandar. */
export const chaveSlot = (pessoa: string, dia: string, slot: number): string =>
  `lembrete_slot:${pessoa.trim().toLowerCase()}:${dia}:${slot}`;
/** Quantas vezes este card já virou lembrete, e quando foi a última. */
export const chaveCard = (id: number): string => `lembrete_card:${id}`;

export interface ResultadoLembrete {
  enviados: number;
  pessoas: string[];
  candidatos: number;
  erros: number;
  motivo?: string;
  dry?: boolean;
  previa?: Array<{
    pessoa: string; card: number; cliente: string | null; status: string;
    horas: number; nota: number; ciclo?: boolean; toque?: number;
  }>;
}

const zero = (motivo: string, extra: Partial<ResultadoLembrete> = {}): ResultadoLembrete =>
  ({ enviados: 0, pessoas: [], candidatos: 0, erros: 0, motivo, ...extra });

/**
 * Telefone de quem recebe. O cadastro do CRM manda (é onde se troca um número) e
 * a lista fixa da equipe é a rede: lembrete que não chega a ninguém é exatamente
 * o problema que este módulo existe pra resolver.
 */
async function carregarDonos(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data, error } = await supabaseGerador
      .from('consultores').select('nome, whatsapp').limit(200);
    if (error) throw error;
    for (const c of data ?? []) {
      if (c?.nome && c?.whatsapp) mapa.set(String(c.nome).trim().toLowerCase(), String(c.whatsapp).replace(/\D/g, ''));
    }
  } catch (err) {
    logger.error('lembrete-followup', 'ler consultores falhou, vai com a lista fixa', err);
  }
  for (const [nome, tel] of Object.entries(EQUIPE)) {
    if (!mapa.has(nome)) mapa.set(nome, String(tel).replace(/\D/g, ''));
  }
  return mapa;
}

/**
 * Uma rodada. Chamada de ~2 em 2 minutos dentro do /cron/process-messages e
 * represada pelo carimbo de slot: no máximo um lembrete por pessoa a cada 30
 * minutos. `dry` anda o caminho inteiro e para antes de enviar.
 */
export async function runLembreteFollowupTick(opts: { dry?: boolean } = {}): Promise<ResultadoLembrete> {
  const dry = !!opts.dry;
  if (desligado()) return zero('desligado');

  const agora = new Date();
  const janela = slotAgora(agora);
  // O modo seco ignora a janela de propósito: conferir o que ela faria é uma
  // pergunta, não um envio.
  if (!dry && !janela.ok) return zero(janela.motivo || 'fora_da_janela');
  const slot = janela.slot ?? 0;

  // 1. Os cards abertos com a hora já vencida, dentro da janela de dias.
  const desde = new Date(agora.getTime() - diasJanela() * 86400_000).toISOString();
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select([
      'id', 'vendedor_nome', 'cliente_nome', 'cliente_telefone', 'cidade', 'status',
      'temperatura', 'quando', 'observacao', 'historico', 'created_at',
      'proposta_em', 'apresentacao_em', 'lead_resposta_at', 'presenca_confirmada_at', 'confirmacao_at',
    ].join(','))
    // Filtro NO SERVIDOR, sempre. O PostgREST corta em 1000 linhas e ignora o
    // .limit() maior: trazer tudo e peneirar aqui publicaria uma fila que é só
    // a fatia que coube na resposta.
    .in('status', ESTAGIOS_ABERTOS as unknown as string[])
    .lte('quando', agora.toISOString())
    .gte('quando', desde)
    .order('quando', { ascending: false })
    .limit(1000);
  if (error) {
    logger.error('lembrete-followup', 'falha lendo os cards abertos', error);
    return zero('erro_leitura', { erros: 1 });
  }
  const cards = (data || []) as unknown as CardAberto[];
  if (!cards.length) return zero('nenhum_card_aberto');

  // 2. Marcadores: o slot de cada pessoa, o histórico de toque de cada card e a
  //    cobrança recente da sentinela do vácuo.
  //
  //    Esta leitura é a ÚNICA coisa que impede repetir, então ela não pode
  //    falhar em silêncio. Sem olhar o `error`, uma consulta quebrada devolve
  //    `data` nulo, o conjunto nasce vazio e TODO card volta a parecer nunca
  //    lembrado: a mesma rajada no celular da equipe, de 2 em 2 minutos.
  //    Fail-closed: na dúvida não manda ninguém e tenta na próxima.
  const marc = await supabase
    .from('system_state').select('key, value, updated_at')
    // `apalavrado:` entra aqui SEM o corte de 30 dias que os outros têm: uma
    // espera de 60 dias é normal (contrato, investidor, terreno) e sumir com o
    // carimbo por ser velho acordaria o card no meio da espera, que é
    // exatamente o que o Thiago pediu pra não acontecer.
    .or(`key.like.lembrete_card:%,key.like.lembrete_slot:%,key.like.vacuo_avisado:%,key.like.${APALAVRADO_PREFIX}%`)
    .gte('updated_at', new Date(agora.getTime() - 400 * 86400_000).toISOString())
    .limit(20000);
  if (marc.error) {
    logger.error('lembrete-followup', 'falha lendo os marcadores', marc.error);
    return zero('erro_marcadores', { erros: 1 });
  }
  const linhas = (marc.data || []) as Array<{ key: string; value: unknown; updated_at: string }>;
  if (linhas.length >= 20000) {
    logger.warn('lembrete-followup', 'marcadores no teto de 20000: a lista pode estar truncada');
  }

  const slotsUsados = new Set<string>();
  const toquesDoCard = new Map<number, { n: number; ultimo: number }>();
  const cobradoPelaSentinela = new Set<string>();
  const pausas = new Map<number, Pausa>();
  const LIMITE_VACUO_MS = 24 * 3600_000;
  for (const l of linhas) {
    const k = String(l.key);
    if (k.startsWith(APALAVRADO_PREFIX)) {
      const id = Number(k.slice(APALAVRADO_PREFIX.length));
      if (Number.isFinite(id)) pausas.set(id, (l.value ?? {}) as Pausa);
      continue;
    }
    if (k.startsWith('lembrete_slot:')) { slotsUsados.add(k); continue; }
    if (k.startsWith('lembrete_card:')) {
      const id = Number(k.slice('lembrete_card:'.length));
      const v = (l.value ?? {}) as { n?: number; ultimo?: string };
      const ultimo = Date.parse(String(v.ultimo || l.updated_at));
      if (Number.isFinite(id)) {
        toquesDoCard.set(id, { n: Number(v.n) || 1, ultimo: Number.isFinite(ultimo) ? ultimo : 0 });
      }
      continue;
    }
    if (k.startsWith('vacuo_avisado:')) {
      const t = Date.parse(l.updated_at);
      if (Number.isFinite(t) && agora.getTime() - t <= LIMITE_VACUO_MS) {
        cobradoPelaSentinela.add(k.split(':')[1] || '');
      }
    }
  }

  const donos = await carregarDonos();

  // 3. Fila por pessoa, já filtrada e pontuada.
  //    No modo espelho a fila é UMA só, e a chave passa a ser o destinatário:
  //    um card por slot no total, não um por consultor.
  const paraEspelho = espelho();
  const porPessoa = new Map<string, Array<{ card: CardAberto; horas: number; nota: number; toque: number; dono: string; pausa?: Pausa }>>();
  for (const c of cards) {
    const dono = String(c.vendedor_nome || '').trim().toLowerCase();
    if (!dono || !donos.has(dono)) continue;              // card sem dono conhecido não vira ligação de ninguém
    if (!String(c.cliente_telefone || '').replace(/\D/g, '')) continue;
    const pessoa = paraEspelho ? '__espelho__' : dono;
    if (!dry && slotsUsados.has(chaveSlot(pessoa, janela.dia, slot))) continue;

    const toque = toquesDoCard.get(c.id);
    // O TETO NÃO VALE PRA FAMÍLIA DO CICLO. Negociação viva volta de 48 em 48h
    // até virar Vendido, Sem interesse ou Apalavrado — ordem do Thiago
    // (30/09/2026). Ver `ESTAGIOS_CICLO`. A folga de 48h segue valendo pra
    // todos: é ela que faz disto um ciclo e não uma rajada.
    if (toque && !semTetoDeToques(c.status) && toque.n >= maxPorCard()) continue;
    if (toque && agora.getTime() - toque.ultimo < folgaCardH() * 3600_000) continue;

    const chaveTel = chaveContato(String(c.cliente_telefone || '')) || '';
    if (chaveTel && cobradoPelaSentinela.has(chaveTel)) continue;   // a sentinela já mostrou esse nome hoje

    const ult = ultimoToque(c);
    if (!ult) continue;

    // A SALA DE ESPERA. Só vale pro status `apalavrado`: carimbo velho de um
    // card que voltou pra negociação não pode continuar calando ele.
    const pausa = c.status === 'apalavrado' ? pausas.get(c.id) : undefined;
    if (c.status === 'apalavrado' && dormindo(pausa, agora, ult, apalavradoDiasPadrao())) continue;

    const horas = horasUteisEntre(ult, agora);
    if (horas < esperaMinimaH()) continue;

    const item = {
      card: c, horas, nota: pontuarCard(c.status, c.temperatura, horas),
      toque: (toque?.n || 0) + 1, dono, pausa,
    };
    porPessoa.set(pessoa, [...(porPessoa.get(pessoa) || []), item]);
  }

  const escolhidos = [...porPessoa.entries()]
    .map(([pessoa, fila]) => ({ pessoa, ...fila.sort((a, b) => b.nota - a.nota)[0] }))
    .filter(e => e.card);
  const candidatos = [...porPessoa.values()].reduce((s, f) => s + f.length, 0);

  if (!escolhidos.length) return zero('nada_pra_lembrar', { candidatos });

  if (dry) {
    return {
      enviados: 0, pessoas: escolhidos.map(e => e.pessoa), candidatos, erros: 0,
      motivo: janela.ok ? 'lembraria_agora' : `fora_da_janela(${janela.motivo})`,
      dry: true,
      previa: escolhidos.map(e => ({
        pessoa: paraEspelho ? `espelho←${e.dono}` : e.pessoa,
        card: e.card.id, cliente: e.card.cliente_nome,
        status: e.card.status, horas: Math.round(e.horas * 10) / 10, nota: Math.round(e.nota * 10) / 10,
        ciclo: ESTAGIOS_CICLO.has(e.card.status) || undefined,
        toque: e.toque,
      })),
    };
  }

  // 4. Um envio por pessoa. Carimba ANTES de mandar: falha de envio que não
  //    carimbou faria o próximo tick (2 minutos depois) mandar de novo. É o bug
  //    do placar, e ele custa uma bolha repetida no celular de quem trabalha.
  let enviados = 0, erros = 0;
  const pessoas: string[] = [];
  for (const e of escolhidos) {
    // No espelho o destino é fixo e o carimbo de slot é do DESTINATÁRIO
    // (`__espelho__`), não do dono do card: carimbar por consultor mandaria 3
    // mensagens no mesmo slot pro mesmo telefone.
    const alvo = paraEspelho || donos.get(e.pessoa);
    if (!alvo) continue;
    const agoraIso = new Date().toISOString();
    try {
      await supabase.from('system_state').upsert(
        { key: chaveSlot(e.pessoa, janela.dia, slot), value: { card: e.card.id, em: agoraIso }, updated_at: agoraIso },
        { onConflict: 'key' },
      );
      await supabase.from('system_state').upsert(
        { key: chaveCard(e.card.id), value: { n: e.toque, ultimo: agoraIso, pessoa: e.pessoa }, updated_at: agoraIso },
        { onConflict: 'key' },
      );
    } catch (err) {
      logger.error('lembrete-followup', 'carimbo falhou, não envia', { card: e.card.id, erro: String(err) });
      erros++;
      continue;
    }
    try {
      await sendWhatsApp(
        alvo,
        montarLembrete(e.card, e.horas, e.toque, {
          pausa: e.pausa,
          espelhoDe: paraEspelho ? e.dono : null,
        }),
        'io',
      );
      enviados++;
      pessoas.push(e.pessoa);
      logger.info('lembrete-followup', `lembrete ${e.toque}º do card ${e.card.id} pra ${e.pessoa}${paraEspelho ? ` (espelho, dono ${e.dono})` : ''}`);
    } catch (err) {
      logger.error('lembrete-followup', `falha avisando ${e.pessoa}`, err);
      erros++;
    }
  }

  return { enviados, pessoas, candidatos, erros };
}
