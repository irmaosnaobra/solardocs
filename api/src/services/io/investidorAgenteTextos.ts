// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS DA HELENA, a agente de investidores do eletroposto (10/10/2026).
//
// Tudo que a Helena escreve mora AQUI, num arquivo só, porque é o redator quem
// troca estes textos. Vieram dele em 10/10/2026 e foram copiados sem reescrever
// (gerados por script a partir do arquivo dele, não digitados).
//
// Em 11/10/2026 o redator mandou o bloco de contorno ("A META E COMO CONTORNAR"
// até "QUANDO PASSAR PARA {consultor}"), que SUBSTITUIU a seção "SE A PESSOA NÃO
// QUISER", e o parágrafo "COMO VOCÊ INFORMA SUA DECISÃO", que entra logo depois.
// Também copiados sem reescrever. Eles citam nomes de ação entre crases: por
// isso as regras são strings entre aspas duplas, nunca template literal.
//
// Ainda em 11/10/2026, por ordem do dono ("marca mas não mostre que é vídeo, tem
// gente que não gosta, cita que será uma reunião"), o redator reescreveu cinco
// seções para a Helena dizer só "reunião" ou "conversa com o consultor", sem
// formato. Elas substituíram as de mesmo título, também copiadas sem reescrever.
//
// Em 12/10/2026, por decisão do dono (a primeira conversa real travou: o lead
// perguntou o que o valor engloba e a Helena respondeu duas vezes "isso é com o
// consultor"), o redator mandou o bloco de conhecimento: a seção "O QUE VOCÊ PODE
// EXPLICAR" entra depois de "COMO É A REUNIÃO E QUEM É A EMPRESA", a seção "SE
// PERGUNTAR QUANTO CUSTA..." foi SUBSTITUÍDA e "SE A PESSOA QUISER INFORMAÇÃO ANTES
// DE ACEITAR A REUNIÃO" entra logo depois dela. Copiados sem reescrever.
//
// A ÚNICA frase ajustada foi a que falava do separador de bolhas nas regras do
// prompt: o redator escreveu "separadas por ||" e o transporte da Helena é JSON
// com a lista "bolhas". O resto das regras está como chegou.
//
// Em 12/11/2026 a Helena passou a atender TODO tipo de cadastro do eletroposto
// (investidor, arrendamento, curioso e parceiro). O redator mandou o bloco A (o
// roteiro de descoberta por tipo, no lugar de "O QUE DESCOBRIR" até "QUANDO E COMO
// CONVIDAR"), as aberturas por tipo (B) e as retomadas por variante (C). Colados
// como chegaram; o que o executor mexeu em volta (as contradições do prompt antigo
// com o piso e com o "só investidor") está marcado com "(12/11/2026)" nos comentários
// de investidorAgentePuro.ts e no relatório da entrega.
//
// Variáveis: {nome} e {valor} nas aberturas, {consultor} nas regras e na
// confirmação, {h1} a {h4} na oferta, {quando} na confirmação.
//
// A abertura e a variação de cada texto fixo saem da CHAVE do contato (soma dos
// dígitos), nunca de sorteio: a mesma pessoa recebe sempre a mesma versão e o
// teste é reprodutível. Quem escolhe é o investidorAgentePuro.ts.
//
// Cuidado ao editar: são strings comuns, entre aspas duplas. Não use crase nem
// template literal aqui (crase dentro de template literal fecha a string e o tsc
// passa). Nenhum travessão, nenhum emoji, toda frase começa com maiúscula.
// ─────────────────────────────────────────────────────────────────────────────

export type TipoHelena = 'investidor' | 'arrendamento' | 'curioso' | 'parceiro';
export const TIPOS_HELENA: readonly TipoHelena[] = ['arrendamento', 'investidor', 'parceiro', 'curioso'];

/**
 * As aberturas por tipo de cadastro (redator, 12/11/2026). UMA bolha, enviada por sendFrio.
 * Variáveis: {nome}, {valor} (só Investidor) e {cidade} (só a abertura 2 de Arrendamento,
 * que só é usada quando o cadastro tem cidade).
 */
export const ABERTURAS_POR_TIPO: Readonly<Record<TipoHelena, readonly string[]>> = {
  investidor: [
    "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Vi que você preencheu o formulário de eletroposto com {valor} para investir. Queria te conhecer melhor: o que foi que te chamou atenção nesse negócio?",
    "{nome}, tudo bem? Sou a Helena, da Irmãos na Obra. Você preencheu o formulário de eletroposto e indicou {valor} para investir. Fiquei curiosa para saber como você chegou até o eletroposto. Conta pra mim?",
    "Oi, {nome}! Helena aqui, da Irmãos na Obra. Você preencheu o formulário de eletroposto e marcou {valor} para investir. Queria entender melhor o seu momento. Me conta: o que você faz hoje?",
  ],
  arrendamento: [
    "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Vi que você preencheu o formulário de eletroposto e tem um local que pode receber um ponto de recarga. Me conta: que lugar é esse?",
    "{nome}, tudo bem? Sou a Helena, da Irmãos na Obra. Você preencheu o formulário de eletroposto e falou de um local em {cidade}. Queria entender melhor: que tipo de lugar é?",
    "Olá, {nome}! Helena, da Irmãos na Obra, por aqui. Vi no seu formulário de eletroposto que você tem um espaço que poderia receber carregadores. Fiquei curiosa: o que você faz com esse espaço hoje?",
  ],
  curioso: [
    "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Você preencheu o formulário de eletroposto. Queria saber, com calma: o que despertou o seu interesse nisso?",
    "{nome}, tudo bem? Sou a Helena, da Irmãos na Obra. Passando por causa do formulário de eletroposto que você preencheu. Sem pressa: como o eletroposto entrou nos seus planos?",
    "Olá, {nome}! Aqui é a Helena, da Irmãos na Obra. Vi o seu cadastro de eletroposto e fiquei com vontade de te conhecer melhor. Você já tem algum plano para o eletroposto ou está só pesquisando?",
  ],
  parceiro: [
    "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Vi que você preencheu o formulário de eletroposto querendo trabalhar junto com a gente. Me conta: o que você faz hoje?",
    "{nome}, tudo bem? Sou a Helena, da Irmãos na Obra. Você se cadastrou no formulário de eletroposto para ser parceiro. Queria entender o seu trabalho: em que área você atua hoje?",
    "Olá, {nome}! Helena, da Irmãos na Obra, por aqui. Você preencheu o formulário de eletroposto com interesse em parceria. Queria te ouvir primeiro: como você imagina trabalhar com a gente?",
  ],
};

/**
 * O mesmo molde SEM o nome, para o cadastro que não tem um primeiro nome que dê para usar
 * (vazio, nome de empresa, só sobrenome). NÃO É TEXTO NOVO: é o texto do redator com a
 * palavra "{nome}" e a pontuação dela tiradas ("Oi, {nome}, tudo bem?" vira "Oi, tudo
 * bem?"; "{nome}, tudo bem?" vira "Tudo bem?"; "Olá, {nome}!" vira "Olá!"; "Oi, {nome}. Vou" vira "Oi. Vou"). O teste
 * confere que nenhum molde sai com "{nome}" ou vírgula solta.
 */
export function moldeSemNome(molde: string): string {
  let t = molde
    .replace(/,\s*\{nome\}(?=[,!.])/g, '')    // "Oi, {nome}, tudo" -> "Oi, tudo"; "Olá, {nome}!" -> "Olá!"
    .replace(/^\{nome\},\s*/, '')            // "{nome}, tudo bem?" -> "tudo bem?"
    .replace(/\{nome\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  t = t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
  return t;
}

/** O bloco de regras que vai no prompt do sistema (mora em investidorAgentePrompt.ts). */
export { REGRAS_DO_PROMPT } from './investidorAgentePrompt';

/** a) Oferta dos horários. UMA bolha com as 4 linhas numeradas. */
export const OFERTA_HORARIOS: readonly string[] = [
  [
    "Tenho estes horários disponíveis para a reunião:",
    "1. {h1}",
    "2. {h2}",
    "3. {h3}",
    "4. {h4}",
    "Me responde só com o número do que ficar melhor para você.",
  ].join('\n'),
  [
    "Separei quatro horários para a nossa reunião. Qual encaixa melhor para você?",
    "1. {h1}",
    "2. {h2}",
    "3. {h3}",
    "4. {h4}",
    "Pode responder só com o número.",
  ].join('\n'),
];

/** b) Confirmação, depois de o card estar gravado. */
export const CONFIRMACAO: readonly string[] = [
  "Combinado! Sua reunião com {consultor} ficou para {quando}. A confirmação chega por aqui mesmo.",
  "Pronto, deixei marcado: {quando}, com {consultor}. Por aqui mesmo chega a confirmação.",
];

/** c) A resposta à oferta não é um dos 4 números. */
export const NAO_ENTENDI_O_NUMERO: readonly string[] = [
  "Não consegui entender qual horário você escolheu. Me responde só com o número, de 1 a 4. Se nenhum servir, me avisa que eu te mando outros.",
  "Não peguei qual horário ficou melhor. Pode responder com o número, de 1 a 4? Se nenhum encaixar, é só dizer que eu te passo outras opções.",
];

/** d) Passagem para o consultor (ação "humano"). */
export const PASSAGEM_PARA_O_CONSULTOR: readonly string[] = [
  "Entendi. Vou chamar o consultor da equipe: é ele quem responde isso com os números do seu caso, e ele fala com você por aqui mesmo.",
  "Certo, vou passar para o consultor da equipe, que tira essas dúvidas direto com você. Ele te chama por aqui mesmo.",
];

/** e) Despedida de quem disse que não tem interesse (ação "sem_interesse"). */
export const DESPEDIDA: readonly string[] = [
  "Tudo bem, obrigada por me avisar e boa sorte por aí! Se um dia o assunto voltar a fazer sentido, é só me chamar por aqui.",
  "Entendido, obrigada pela atenção. Se algo mudar mais para frente, pode me chamar por aqui.",
];

/** f) Pediu para parar de receber mensagem (ação "parar"). */
export const PAROU: readonly string[] = [
  "Pode deixar, não vou mais te enviar mensagem. Obrigada e desculpa o incômodo.",
  "Certo, a partir de agora não mando mais mensagem por aqui. Desculpa o incômodo e obrigada.",
];

/** Ação "adiar": a pessoa quer ser procurada mais para frente. O cadastro NÃO vira
 *  sem_interesse, e se ela escrever de novo a Helena responde. (redator, 11/10/2026) */
export const ADIADO: readonly string[] = [
  "Deixei anotado. Não vou ficar te cobrando por aqui: se quiser retomar antes, é só me chamar.",
  "Tudo bem, sem pressa. Deixei anotado do jeito que você pediu. Se quiser conversar antes, é só me chamar por aqui.",
];

/**
 * Encerramento do preparo depois de marcar: sai quando o modelo não devolve um agradecimento que dê para usar (ou
 * quando ele insiste em perguntar depois da 2ª pergunta). RASCUNHO DO EXECUTOR: o redator não mandou texto. Trocar
 * quando ele mandar. Variáveis: {consultor} e {quando} (o dia da reunião, como na confirmação). Sem 'em mãos' e sem 'anotado'.
 */
export const ENCERRAMENTO_DO_PREPARO: readonly string[] = [
  "Obrigada por me contar! {consultor} te espera {quando}.",
  "Obrigada pelas respostas, ajudam bastante. A reunião com {consultor} fica para {quando}.",
];

/** g) "Você é robô?". Não há ação para isto: quem responde é o modelo, pelas regras
 *  do prompt. O texto fica guardado aqui como referência do redator. */
export const SOU_ASSISTENTE_VIRTUAL: readonly string[] = [
  "Sou a assistente virtual da equipe da Irmãos na Obra. Se você preferir falar com uma pessoa, posso passar para o consultor agora.",
  "Sou, sim: a assistente virtual da equipe. Se preferir conversar com uma pessoa, é só pedir que eu chamo o consultor.",
];

/**
 * Frase que antecede a lista nova quando o horário escolhido foi ocupado no meio
 * do caminho. RASCUNHO DO EXECUTOR: o redator não mandou texto para este caso.
 * Trocar quando ele mandar.
 */
export const HORARIO_FOI_OCUPADO = 'Esse horário acabou de ser ocupado.';

// ─────────────────────────────────────────────────────────────────────────────
// RESGATE DOS CANCELADOS (12/10/2026, ordem do Thiago). Textos do redator,
// copiados sem reescrever de resgate-helena.md. Variáveis: {nome}, {valor} e
// {mes} (o mês da reunião que não aconteceu, por extenso e minúsculo).
// ─────────────────────────────────────────────────────────────────────────────

/** As 4 aberturas de resgate. UMA bolha, enviada por sendFrio. */
export const ABERTURAS_RESGATE: readonly string[] = [
  "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Você preencheu o nosso formulário de eletroposto com {valor} para investir e chegou a marcar uma reunião em {mes}, que acabou não acontecendo. Ainda faz sentido conversarmos sobre isso? Se não fizer mais, é só me avisar que eu não insisto.",
  "{nome}, a Helena, da Irmãos na Obra, por aqui. Depois do seu formulário de eletroposto, em que você indicou {valor}, ficou uma reunião marcada para {mes}, e ela acabou não acontecendo. Queria saber se esse plano ainda está de pé e se vale a gente conversar. Se não estiver, me avisa que eu não insisto.",
  "Olá, {nome}! Eu sou a Helena, da Irmãos na Obra. Estou te chamando porque, no formulário de eletroposto, você marcou {valor} e agendou uma reunião para {mes}, que não chegou a rolar. Esse interesse continua? Se o assunto já não faz mais sentido, pode me dizer sem cerimônia que eu não insisto.",
  "Passando rapidinho, {nome}: sou a Helena, da Irmãos na Obra. Você preencheu o formulário de eletroposto, indicou {valor} de investimento e chegou a marcar reunião em {mes}, mas ela não aconteceu. Posso saber se ainda faz sentido conversar sobre isso? Se não fizer, é só me falar que eu não insisto.",
];

/** Abertura reserva de resgate: quando o cadastro não tem um primeiro nome que dê para usar. */
export const ABERTURA_RESGATE_SEM_NOME = "Oi! Aqui é a Helena, da Irmãos na Obra. Você preencheu o nosso formulário de eletroposto, indicou {valor} e chegou a marcar uma reunião em {mes}, que acabou não acontecendo. Isso ainda faz sentido para você? Se não fizer mais, é só me avisar que eu não insisto.";

/** Parágrafo que entra nos fatos do sistema, só nas conversas de resgate. */
export const CONVERSA_DE_RESGATE = "Esta pessoa já teve uma reunião marcada em {mes}, que ela mesma escolheu pela página, e o horário foi liberado porque a presença não foi confirmada. Depois disso, ela recebeu ofertas de novo horário e não respondeu. Você está retomando o contato, então não cobre, não peça explicação e não faça a pessoa se sentir em falta. Se ela disser que não pôde, que esqueceu ou que achou que tinham cancelado, acolha em uma frase e siga para o convite. Se ela reclamar que o horário foi tirado, reconheça com simplicidade, sem discutir e sem se justificar, e ofereça novos horários. Todas as outras regras continuam iguais.";

// ─────────────────────────────────────────────────────────────────────────────
// RETOMADAS (toques 2 a 5), versão do redator de 12/11/2026, copiada sem reescrever.
// Duas variantes por toque: "local" (quem tem um espaço, o tipo Arrendamento) e "capital"
// (todos os outros). Variável: {nome}. O toque 4 também é a ABERTURA DE RETORNO: a
// pessoa que a Helena chamou há mais de 21 dias e não respondeu recebe este texto no
// lugar de uma abertura nova, porque ela já escreveu uma vez.
// ─────────────────────────────────────────────────────────────────────────────

export type VarianteDoToque = 'local' | 'capital';

/** Toque 2 (3 dias depois do toque 1), 3 (4 dias depois), 4 (60 dias depois do 1) e 5 (7 dias depois do 4). */
export const RETOMADAS_POR_VARIANTE: Readonly<Record<2 | 3 | 4 | 5, Readonly<Record<VarianteDoToque, string>>>> = {
  2: {
    local: "Oi, {nome}, a Helena de novo. Sem pressa nenhuma: o seu local ainda está disponível para receber um eletroposto? Se mudou alguma coisa por aí, pode me contar.",
    capital: "Oi, {nome}, a Helena de novo. Sem pressa nenhuma: o eletroposto ainda está nos seus planos? Se mudou alguma coisa por aí, pode me contar.",
  },
  3: {
    local: "{nome}, é a Helena. Por agora, esta é a última vez que te chamo sobre o seu local, para não incomodar. Quando quiser conversar, é só responder aqui. Se não fizer mais sentido, tudo bem também.",
    capital: "{nome}, é a Helena. Por agora, esta é a última vez que te chamo sobre o eletroposto, para não incomodar. Quando quiser conversar, é só responder aqui. Se não fizer mais sentido, tudo bem também.",
  },
  4: {
    local: "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Faz um tempo que a gente não se fala. O seu local ainda é uma possibilidade para receber um eletroposto, ou a situação mudou?",
    capital: "Oi, {nome}, tudo bem? Aqui é a Helena, da Irmãos na Obra. Faz um tempo que a gente não se fala. O eletroposto continua nos seus planos, ou as coisas mudaram por aí?",
  },
  5: {
    local: "Oi, {nome}. Vou parar de te chamar sobre o seu local, para não incomodar. Se um dia fizer sentido conversar sobre o eletroposto, é só responder aqui. Obrigada pela atenção.",
    capital: "Oi, {nome}. Vou parar de te chamar sobre o eletroposto, para não incomodar. Se um dia fizer sentido, é só responder aqui. Obrigada pela atenção.",
  },
};
