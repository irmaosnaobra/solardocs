// ─────────────────────────────────────────────────────────────────────────────
// A RÉGUA DO SIM — quem marca reunião de eletroposto e não confirma perde o
// horário, e o horário volta pra vitrine no mesmo dia.
//
// O problema (medido em 22/09/2026, ordem do dono no mesmo dia): das 63 reuniões
// futuras na agenda, 20 estavam MUDAS, sem uma palavra desde a confirmação, 18
// delas havia mais de 3 horas. Cada uma segura um horário de um consultor por
// dias (a reunião mediana é marcada com ~69h de antecedência), e o horário que
// elas seguram é exatamente o que falta pra quem quer comprar.
//
// As réguas que já existiam só agiam NO DIA da reunião: o corte das 13h exige
// que a reunião seja hoje, e o não atendido automático depende do lembrete de 1h,
// que sai 45 a 75 min antes. Quem marca pra daqui a três dias e some fica três
// dias ocupando o quadro. Esta régua age NO DIA EM QUE A PESSOA MARCOU.
//
// ── A escada, contada a partir da confirmação ──
//   +1h   cobrança 1: "conseguiu ver? responde SIM que eu travo o horário"
//   +2h   cobrança 2, o ULTIMATO: diz a hora em que o horário vai ser liberado
//   +3h   liberação: o horário volta pra agenda e a pessoa vira ficha no Curioso,
//         e só DEPOIS de tudo isso é que sai a mensagem contando
//
// Uma hora entre os degraus não é chute: dos 93 que confirmaram presença depois
// da mensagem de confirmação, 55 confirmaram na PRIMEIRA hora e apenas 1 entre a
// primeira e a terceira. Quem ia responder sozinho já respondeu; da primeira hora
// em diante, ou alguém cutuca, ou o horário morre ocupado.
//
// ── Por que `cancelado` e não `nao_atendeu` ──
// `nao_atendeu` parece o certo e é o errado aqui. Ele continua na consulta do
// agente de agenda de propósito (o toque de 5 min tem que sair pra quem o robô
// marcou), então uma ficha marcada hoje, com reunião daqui a 3 dias, receberia
// "é agora, ele já está te esperando" num horário que já foi vendido pra outra
// pessoa. Fora isso o `eletropostoReagendaAuto` remarca sozinho todo vermelho
// QUENTE vencido, e as 18 fichas mudas de hoje são todas quentes: o robô
// remarcaria justamente quem acabou de ser liberado por silêncio. `cancelado`
// sai das duas consultas, solta o índice único e devolve o horário na hora.
//
// ── A porta de volta (ordem do dono: "sempre dê a oportunidade de chamar de
//    novo") ──
// A mensagem de liberação convida a pessoa a responder, e o `eletropostoRespostas`
// devolve o mesmo horário se ele ainda estiver livre; se já tiver sido vendido,
// oferece os próximos do mesmo consultor. O carimbo `ep_liberado_sim:<id>` é o
// que prova que quem cancelou foi o ROBÔ: cancelamento escrito por gente nenhum
// robô desfaz.
//
// ── Travas (a linha IO já foi bloqueada 3 vezes por rajada) ──
//   • Liberar é escrita no banco e não custa mensagem, então libera em lote (até
//     LIBERAR_POR_TICK por rodada) e AVISA devagar (MSG_POR_TICK por rodada, com
//     o teto da linha antes de cada envio). Foi assim que as 18 fichas paradas
//     saíram da agenda na primeira rodada sem virar 18 mensagens no mesmo minuto.
//   • Uma bolha por cobrança (sendFrio). Este módulo fala com quem o agente de
//     agenda já toca 4 vezes; bolha a mais aqui é mensagem a mais na mesma linha.
//   • Janela de 8h às 20h de Brasília. 30 dos 193 agendamentos do mês entraram
//     entre 21h e 22h: pra eles a escada começa às 8h do dia seguinte.
//   • Cobrança fora da janela dela não sai atrasada. Ficha represada pula os
//     degraus vencidos e cai direto no que está valendo, porque "conseguiu ver a
//     confirmação?" três dias depois é robô falando sozinho.
//   • Ninguém é liberado a menos de MIN_ANTES_DA_REUNIAO_MIN da reunião: dali em
//     diante quem manda são o toque de 1h e o não atendido automático.
//   • Ninguém perde o horário sem ter recebido o ultimato E sem a hora prometida
//     nele ter chegado (a conta é do ENVIO do ultimato, não da confirmação: a
//     fila é lenta e um ultimato atrasado anunciaria hora já passada). A exceção
//     está escrita: passadas LIBERAR_SEM_ULTIMATO_H horas de silêncio, o horário
//     vale mais que o aviso, e é o caso do represado.
//
// Kill-switch: EP_COBRA_SIM_OFF=1. Prévia sem enviar e sem gravar:
// GET /cron/eletroposto-cobra-sim?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { agendaFechadaNoIso } from '../agenda/agendaFechada';
import { EP_RESPOSTA_PREFIX, quandoPorExtenso } from './eletropostoAgenda';

/** Carimbo de cobrança ENVIADA: `ep_cobra_sim:<id>:<passo>`. O prefixo está em
 *  BOT_SENT_PREFIXES (lineThrottle), então cada cobrança entra no orçamento da
 *  linha e os outros robôs recuam quando esta régua está falando. */
export const EP_COBRA_PREFIX = 'ep_cobra_sim:';

/** Carimbo do horário liberado POR ESTE ROBÔ: `ep_liberado_sim:<id>`, com o que
 *  a mensagem de aviso precisa (telefone, nome, quando, consultor).
 *
 *  Ele faz dois trabalhos: diz ao `eletropostoRespostas` que aquele `cancelado`
 *  é do robô e pode ser desfeito, e é a FILA da mensagem de liberação. Por isso
 *  o valor carrega os dados da ficha: quando o aviso sair, a ficha já está
 *  cancelada e fora da consulta deste módulo. */
export const EP_LIBERADO_PREFIX = 'ep_liberado_sim:';

const BRT_TZ = 'America/Sao_Paulo';

const PASSO_C1_MIN = Number(process.env.EP_COBRA_C1_MIN || 60);
const PASSO_C2_MIN = Number(process.env.EP_COBRA_C2_MIN || 120);
const PASSO_LIBERA_MIN = Number(process.env.EP_COBRA_LIBERA_MIN || 180);
/** Degrau vencido não sai atrasado: a cobrança só vale nas 2 horas seguintes à
 *  hora dela. Passou disso, a ficha cai no degrau que está valendo agora. */
const ATRASO_MAX_MIN = 120;
/** A exceção escrita da regra "ninguém perde o horário sem ultimato". Silêncio
 *  de 6 horas já é resposta, e é o caso das fichas represadas, que entraram
 *  nesta régua com a confirmação de ontem ou de três dias atrás. */
const LIBERAR_SEM_ULTIMATO_H = Number(process.env.EP_COBRA_SEM_ULTIMATO_H || 6);
/** A GRAÇA DEPOIS DO ULTIMATO, e é ela que faz a promessa ser verdade. O
 *  ultimato diz "libero às HH:MM", e essa hora é contada do ENVIO dele, não da
 *  confirmação. Sem isso, um ultimato que saísse atrasado (a fila é lenta de
 *  propósito) anunciaria uma hora JÁ PASSADA e a liberação viria minutos depois:
 *  o pior dos dois mundos, prazo mentiroso e zero chance de responder. */
const GRACA_APOS_ULTIMATO_MIN = Number(process.env.EP_COBRA_GRACA_MIN || 60);

/** Perto da reunião esta régua sai de cena: liberar 20 minutos antes não revende
 *  horário nenhum (a LP para de vender 30 min antes) e atropelaria o toque de 1h,
 *  que é quem fala com essa pessoa.
 *
 *  90 e não 60, e a diferença apareceu no primeiro dia: o toque de 1h sai de 45 a
 *  75 minutos antes, e com a folga em 60 o Andre recebeu "falta 1 hora pra sua
 *  reunião" às 14h45 e "liberei o seu horário" às 14h56. Onze minutos entre uma
 *  coisa e o contrário dela. Com 90 as duas janelas deixam de se encostar, e
 *  quem já recebeu o toque de 1h fica fora daqui de qualquer jeito (abaixo). */
const MIN_ANTES_DA_REUNIAO_MIN = Number(process.env.EP_COBRA_MIN_ANTES_MIN || 90);

/** Liberar não manda mensagem: é UPDATE, carimbo e ficha nova. Pode ir em lote,
 *  e é o que tira a agenda do sufoco no primeiro tick. */
const LIBERAR_POR_TICK = Number(process.env.EP_COBRA_LIBERAR_POR_TICK || 20);
/** Mensagem é outra história: 2 por rodada de 5 min, e ainda assim cada uma passa
 *  pelo teto da linha. 18 avisos levam ~1h pra drenar, que é o preço de não
 *  repetir a rajada de 04/08 (8 pessoas, 37 mensagens, linha bloqueada). */
const MSG_POR_TICK = Number(process.env.EP_COBRA_MSG_POR_TICK || 2);

/** Piso do teto da linha pra esta régua. O volume é limitado pela agenda (uma
 *  ficha gera no máximo 3 cobranças na vida), então ela merece piso como a
 *  confirmação e o bom dia.
 *
 *  20/h e não 12/h: 12 era o número de antes de medir, e a linha TRABALHA em 20
 *  envios por hora (158 num dia, medido em 22/09/2026). Com piso de 12 a cobrança
 *  ficaria barrada quase o dia inteiro, e a escada que o dono aprovou viraria só
 *  a liberação no fim: horário perdido sem ninguém ter sido cobrado. */
const COBRA_TETO_HORA = Number(process.env.EP_COBRA_TETO_HORA || 20);
const COBRA_TETO_DIA = Number(process.env.EP_COBRA_TETO_DIA || 200);

/** O AVISO DE LIBERAÇÃO tem piso MAIOR que a cobrança, e a diferença foi medida
 *  na primeira rodada real (22/09/2026): com piso único de 12/h, os 18 avisos
 *  ficaram todos presos, porque a linha estava em 20 envios na hora e 158 no dia.
 *  Cobrança presa é só uma cobrança que não saiu; aviso preso é gente que perdeu
 *  o horário e não ficou sabendo, que é exatamente o contrário da ordem do dono
 *  ("sempre dê a oportunidade de a pessoa chamar novamente"). 24/h é o dobro do
 *  ritmo de pico medido na linha e continua recuando nas horas mais cheias. */
const AVISO_TETO_HORA = Number(process.env.EP_COBRA_AVISO_TETO_HORA || 24);

const JANELA_INICIO_H = 8;
const JANELA_FIM_H = 20;

/** Até quando o aviso de liberação ainda vale a pena.
 *
 *  48h e não 24h, e o motivo foi medido em 22/09/2026: na tarde da estreia a
 *  linha estava em 25 envios por hora, 17 deles da própria agenda (confirmação,
 *  bom dia, 1h e 5 min das reuniões do dia). A régua recuou, como tem que
 *  recuar, e a fila de avisos parou em 5 de 18. Com validade de 24h, os 13 que
 *  sobraram seriam DESCARTADOS antes de a linha esvaziar, e essas pessoas
 *  perderiam o horário sem nunca saber, que é o único desfecho inaceitável aqui.
 *  Com 48h eles saem na manhã seguinte, quando a linha está parada, e o convite
 *  pra voltar continua de pé. O horário, esse, já voltou pra vitrine no ato. */
const AVISO_VALIDADE_MS = 48 * 3600_000;

const desligado = () => (process.env.EP_COBRA_SIM_OFF || '').trim() === '1';

function horaBrasilia(now = new Date()): number {
  return Number(now.toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}
function foraDaJanela(now = new Date()): boolean {
  const h = horaBrasilia(now);
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}

function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 && p.toLowerCase() !== 'lead' ? p : '';
}
const comNome = (n: string) => (n ? `, ${n}` : '');

/** "15h30" no fuso de Brasília, pro ultimato dizer a hora do corte. */
function horaBRT(iso: string | number | Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BRT_TZ,
  }).formatToParts(new Date(iso));
  const parte = (t: string) => (p.find(x => x.type === t)?.value ?? '').padStart(2, '0');
  const h = parte('hour');
  return `${h === '24' ? '00' : h}h${parte('minute')}`;
}

// ── AS TRÊS MENSAGENS ────────────────────────────────────────────────────────
// Uma bolha cada, por decisão: esta pessoa já recebeu 5 bolhas de confirmação e
// vai receber mais três aqui. O que precisa sobreviver em cada uma é o pedido do
// SIM (a única alavanca contra o no-show) e, na segunda, a HORA do corte.

export function bolhaCobranca1(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
): string {
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  return `Oi${comNome(primeiroNome(nome))}! Conseguiu ver a confirmação da sua reunião com o *${quem}*, `
    + `*${quandoPorExtenso(quandoIso)}*? Me responde *SIM* que eu travo o horário pra você.`;
}

/** O ultimato. A hora do corte vai escrita: "libero se você não responder" sem
 *  hora é ameaça vazia, e é a frase que a pessoa lê e deixa pra depois. */
export function bolhaCobranca2(
  nome: string | null | undefined, quandoIso: string, cortaEmIso: string | number | Date,
): string {
  const n = primeiroNome(nome);
  return `${n ? n + ', a' : 'A'}inda estou segurando o seu horário de *${quandoPorExtenso(quandoIso)}*, `
    + `e tem gente esperando esse mesmo horário. Se eu não tiver o seu *SIM* até as *${horaBRT(cortaEmIso)}*, `
    + 'eu libero pra próxima pessoa.';
}

/** O aviso da liberação. Ele é o que cumpre a ordem do dono: a vaga vai embora,
 *  mas a porta fica aberta e a pessoa sabe exatamente como voltar. */
export function bolhaLiberou(nome: string | null | undefined, quandoIso: string): string {
  const n = primeiroNome(nome);
  return `${n ? n + ', c' : 'C'}omo não tive retorno, liberei o seu horário de *${quandoPorExtenso(quandoIso)}* `
    + 'pra outra pessoa. Se ainda quiser ver o seu eletroposto, me responde aqui que eu procuro um horário novo pra você.';
}

// ── A DECISÃO, em função pura ────────────────────────────────────────────────

export type PassoCobranca = 'c1' | 'c2' | 'liberar' | 'esperar';

/**
 * Qual degrau vale AGORA pra uma ficha muda.
 *
 * A ordem das perguntas é de cima pra baixo (liberar, c2, c1) de propósito: uma
 * ficha represada tem os três degraus vencidos ao mesmo tempo, e mandar a
 * cobrança 1 pra ela seria perguntar "conseguiu ver?" sobre uma confirmação de
 * três dias atrás. Do lado oposto, uma ficha que acabou de estourar as 2h com a
 * cobrança 1 ainda não enviada recebe o ULTIMATO e não as duas coladas: dois
 * degraus no mesmo tick seriam duas mensagens em minutos.
 *
 * O RELÓGIO DA LIBERAÇÃO É O ENVIO DO ULTIMATO, não a confirmação. A fila é
 * lenta de propósito e o ultimato pode sair atrasado; contando da confirmação, a
 * pessoa receberia "libero às 15h" às 15h20 e perderia o horário no tick
 * seguinte. Agora ela sempre tem GRACA_APOS_ULTIMATO_MIN depois do aviso.
 *
 * E o ultimato NÃO VENCE (só a cobrança 1 vence): enquanto ele não sair, ele é o
 * degrau que vale, porque a alternativa é tirar o horário de alguém que nunca foi
 * avisado de que ia perder.
 */
export function passoDevido(e: {
  minDesdeConfirmacao: number;
  minAteReuniao: number;
  c1Enviada: boolean;
  /** Há quantos minutos o ultimato saiu, ou null se ainda não saiu. */
  c2EnviadaHaMin: number | null;
  /** O toque de "falta 1 hora" já saiu pra ele? Então a reunião dele está
   *  acontecendo hoje, daqui a pouco, e quem manda nela é a régua de lá. */
  lembrete1hEnviado?: boolean;
}): PassoCobranca {
  // Perto da reunião mandam os avisos que já existem (1h e 5min), e é a régua do
  // lembrete de 1h + 15 min que decide ausência.
  if (e.minAteReuniao <= MIN_ANTES_DA_REUNIAO_MIN) return 'esperar';
  // Cinto de segurança do mesmo problema: se o toque de 1h já saiu, a reunião é
  // agora e liberar o horário seria desdizer a mensagem anterior.
  if (e.lembrete1hEnviado) return 'esperar';

  const ultimatoVenceu = e.c2EnviadaHaMin !== null && e.c2EnviadaHaMin >= GRACA_APOS_ULTIMATO_MIN;
  const silencioLongo = e.minDesdeConfirmacao >= LIBERAR_SEM_ULTIMATO_H * 60;
  if (e.minDesdeConfirmacao >= PASSO_LIBERA_MIN && (ultimatoVenceu || silencioLongo)) return 'liberar';

  if (e.c2EnviadaHaMin === null && e.minDesdeConfirmacao >= PASSO_C2_MIN) return 'c2';
  const dentroDoC1 = e.minDesdeConfirmacao >= PASSO_C1_MIN
    && e.minDesdeConfirmacao < PASSO_C1_MIN + ATRASO_MAX_MIN;
  if (!e.c1Enviada && dentroDoC1) return 'c1';
  return 'esperar';
}

// ── A FICHA NO CURIOSO ───────────────────────────────────────────────────────

export interface FichaDaAgenda {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  vendedor_nome: string | null;
  quando: string | null;
  created_by: string | null;
  status: string | null;
  confirmacao_at: string | null;
  historico: string | null;
  lembrete_1h_at: string | null;
  cidade: string | null;
  observacao: string | null;
  ponto_relacao: string | null;
  capital_faixa: string | null;
  tem_ponto: string | null;
  perfil_slug: string | null;
  decisor_tipo: string | null;
  rota_tipo: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

const ROTULO_PAGAMENTO: Record<string, string> = {
  proprio: 'recurso próprio',
  proprio_credito: 'próprio mais crédito',
  fin_aprovado: 'financiamento aprovado',
  fin_banco: 'financiamento em análise',
  fin_cnpj: 'financiamento pelo CNPJ',
  naosei: 'ainda não sabe como pagaria',
};

/**
 * O texto da ficha que nasce no Curioso.
 *
 * A linha "Local é seu:" é a que a regra de destino LÊ (`destinoDe` em
 * eletropostoPares e `cadDestino` no /gerador): quem respondeu na LP que é dono,
 * inquilino ou representante cai no ARRENDAMENTO, não no Curioso, e é o certo,
 * porque o ponto é o ativo escasso. Nos 47 mudos de 30 dias isso eram 2 pessoas.
 *
 * O que NÃO entra aqui é "Quanto pretende investir": o que a agenda guarda é
 * COMO a pessoa pagaria (recurso próprio, financiamento), nunca um valor. Escrever
 * isso como valor faria a regra ler um número que ninguém disse. Sem valor, o
 * destino é Curioso, e é justamente pra perguntar o valor que o Curioso existe.
 */
export function fichaDoCurioso(f: FichaDaAgenda, motivo = 'marcou reunião de eletroposto e nunca respondeu'): string {
  const linhas = [
    `Veio da AGENDA: ${motivo}.`,
    f.quando ? `Reunião que ele perdeu: ${quandoPorExtenso(f.quando)}${f.vendedor_nome ? ` (${f.vendedor_nome})` : ''}` : '',
    `Local é seu: ${String(f.ponto_relacao || '').trim() || 'não respondeu'}`,
    f.tem_ponto ? `Ponto: ${f.tem_ponto}` : '',
    f.perfil_slug ? `Perfil: ${f.perfil_slug}` : '',
    f.capital_faixa ? `Como pretende pagar: ${ROTULO_PAGAMENTO[f.capital_faixa] || f.capital_faixa}` : '',
    f.decisor_tipo ? `Decisor: ${f.decisor_tipo}` : '',
    f.rota_tipo ? `Rota: ${f.rota_tipo}` : '',
    f.observacao ? `Observação: ${String(f.observacao).slice(0, 500)}` : '',
  ];
  return linhas.filter(Boolean).join('\n');
}

/** Últimos 8 dígitos: a Z-API e o CRM discordam do 9º dígito, e o telefone da
 *  agenda nem sempre é o mesmo texto do cadastro. */
function ult8(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '').slice(-8);
}

/**
 * Cria a ficha no Curioso, se essa pessoa ainda não estiver em lista nenhuma.
 *
 * `capital_faixa` fica NULO de propósito, mesmo existindo na agenda: na
 * `eletroposto_nota1` essa coluna é o filtro do convite ao investidor
 * (eletropostoConviteInvestidor), que oferece REUNIÃO. Copiar o slug faria o
 * robô convidar pra uma reunião justamente quem acabou de perder a dele por
 * silêncio. O dado não se perde: vai no texto da ficha e em `invest`.
 */
export async function criarFichaCurioso(
  f: FichaDaAgenda, dry: boolean, motivo?: string,
): Promise<'criada' | 'ja_existia' | 'erro'> {
  const tel = String(f.cliente_telefone || '').replace(/\D/g, '');
  const chave = ult8(tel);
  if (!chave) return 'erro';
  try {
    const { data: existe } = await supabaseGerador
      .from('eletroposto_nota1').select('id').like('telefone', `%${chave}`).limit(1);
    if (existe && existe.length) return 'ja_existia';
    if (dry) return 'criada';
    const { error } = await supabaseGerador.from('eletroposto_nota1').insert({
      nome: String(f.cliente_nome || 'Sem nome').slice(0, 120),
      telefone: tel,
      cidade: f.cidade,
      origem: 'agenda_sem_resposta',
      status: 'novo',
      ficha: fichaDoCurioso(f, motivo),
      tem_ponto: f.tem_ponto,
      perfil_slug: f.perfil_slug,
      decisor_tipo: f.decisor_tipo,
      rota_tipo: f.rota_tipo,
      invest: f.capital_faixa ? (ROTULO_PAGAMENTO[f.capital_faixa] || f.capital_faixa) : null,
      nota_interna: `Veio da agenda: ${motivo ?? 'liberado pela régua do SIM, marcou reunião e não respondeu'}.`,
      utm_source: f.utm_source, utm_medium: f.utm_medium, utm_campaign: f.utm_campaign,
      utm_content: f.utm_content, utm_term: f.utm_term,
    });
    if (error) throw error;
    return 'criada';
  } catch (err) {
    logger.error('ep-cobra-sim', 'criar ficha no Curioso falhou', { id: f.id, erro: String(err) });
    return 'erro';
  }
}

// ── LIBERAR ──────────────────────────────────────────────────────────────────

/**
 * Tira a ficha da agenda e põe a pessoa no Curioso. NÃO manda mensagem: o aviso
 * é a etapa seguinte, e é ela que espera a linha ter folga.
 *
 * A ordem aqui é a ordem certa e não é a mais óbvia: primeiro o estado, depois a
 * conversa. Mensagem dizendo "liberei seu horário" antes de o horário estar
 * liberado de verdade é a mesma falha de mandar e-mail antes de resolver a conta
 * do cliente, só que com a agenda.
 */
async function liberar(f: FichaDaAgenda, dry: boolean): Promise<boolean> {
  if (dry) return true;
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: BRT_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  const linha = `[${carimbo} · Sistema] 🔓 Horário liberado: recebeu a confirmação, as cobranças e não respondeu nenhuma. Ficha foi pro Curioso.`;
  const { error } = await supabaseGerador.from('agendamentos')
    .update({ status: 'cancelado', historico: f.historico ? `${linha}\n\n${f.historico}` : linha })
    .eq('id', f.id)
    // Corrida com gente: quem mexeu no status entre a leitura e agora manda.
    .eq('status', 'agendado');
  if (error) {
    logger.error('ep-cobra-sim', 'liberar horário falhou', { id: f.id, erro: String(error) });
    return false;
  }
  const nowIso = new Date().toISOString();
  await supabase.from('system_state').upsert({
    key: `${EP_LIBERADO_PREFIX}${f.id}`,
    value: {
      em: nowIso, telefone: String(f.cliente_telefone || '').replace(/\D/g, ''),
      nome: f.cliente_nome, quando: f.quando, vendedor: f.vendedor_nome,
    },
    updated_at: nowIso,
  }, { onConflict: 'key' }).then(undefined, (e: unknown) =>
    logger.error('ep-cobra-sim', 'carimbo da liberação falhou', { id: f.id, erro: String(e) }));
  await criarFichaCurioso(f, false);
  return true;
}

// ── O TICK ───────────────────────────────────────────────────────────────────

export type PreviaCobranca = { id: number; cliente: string; passo: PassoCobranca; quando: string; mensagem?: string };

export type ResultadoCobraSim = {
  cobranca1: number;
  cobranca2: number;
  liberados: number;
  avisos: number;
  erros: number;
  /** Quem qualificou e ficou de fora pelo teto da linha nesta rodada. */
  segurados: number;
  motivo?: string;
  previa?: PreviaCobranca[];
};

const zero = (motivo?: string): ResultadoCobraSim =>
  ({ cobranca1: 0, cobranca2: 0, liberados: 0, avisos: 0, erros: 0, segurados: 0, ...(motivo ? { motivo } : {}) });

interface MarcadorLiberado { em?: string; telefone?: string; nome?: string | null; quando?: string | null; vendedor?: string | null }

export async function runEletropostoCobraSimTick(opts: { dry?: boolean } = {}): Promise<ResultadoCobraSim> {
  if (desligado()) return zero('desligado');
  if (foraDaJanela()) return zero('fora_da_janela');

  const agora = Date.now();
  const dry = opts.dry === true;

  // Só ficha MUDA: confirmada pelo robô, sem presença e sem uma palavra. Quem
  // escreveu qualquer coisa está conversando com o consultor e não é assunto
  // desta régua (a coluna `lead_resposta_at` é gravada pelo eletropostoRespostas
  // a cada mensagem do lead, qualquer que seja o teor).
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, vendedor_nome, quando, created_by, status, confirmacao_at, '
      + 'historico, lembrete_1h_at, cidade, observacao, ponto_relacao, capital_faixa, tem_ponto, perfil_slug, decisor_tipo, '
      + 'rota_tipo, utm_source, utm_medium, utm_campaign, utm_content, utm_term')
    .eq('status', 'agendado')
    .not('confirmacao_at', 'is', null)
    .is('presenca_confirmada_at', null)
    .is('lead_resposta_at', null)
    .gte('quando', new Date(agora).toISOString())
    .lte('quando', new Date(agora + 30 * 24 * 3600_000).toISOString())
    .order('quando', { ascending: true })
    .limit(300);
  if (error) {
    logger.error('ep-cobra-sim', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const fichas = ((data ?? []) as unknown as FichaDaAgenda[])
    .filter(f => ehOrigemEletroposto(f.created_by))
    // Dia em que a empresa não atende: ninguém é cobrado por não confirmar uma
    // reunião que nós é que não vamos fazer.
    .filter(f => !agendaFechadaNoIso(f.quando))
    .filter(f => !!f.confirmacao_at && !!f.quando && !!String(f.cliente_telefone || '').replace(/\D/g, ''));

  // Marcadores, numa leitura só: quem escreveu (mora no outro projeto e a coluna
  // pode estar zerada por um ciclo novo), o que já foi cobrado e quem já foi
  // liberado mas ainda não avisado.
  const [falaram, cobrancas, liberados] = await Promise.all([
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_RESPOSTA_PREFIX}%`).limit(1000),
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_COBRA_PREFIX}%`).limit(2000),
    supabase.from('system_state').select('key, value, updated_at').like('key', `${EP_LIBERADO_PREFIX}%`).limit(1000),
  ]);
  const respondeuEm = new Map<number, string>((falaram.data ?? []).map(m =>
    [Number(String(m.key).slice(EP_RESPOSTA_PREFIX.length)), String(m.updated_at ?? '')]));
  // Guarda QUANDO cada degrau saiu, não só que saiu: é o carimbo do ultimato que
  // dá o relógio da liberação (ver passoDevido).
  const cobradoEm = new Map<string, string>((cobrancas.data ?? []).map(m =>
    [String(m.key).slice(EP_COBRA_PREFIX.length), String(m.updated_at ?? '')]));
  const jaCobrado = new Set(cobradoEm.keys());
  const idadeEmMin = (iso: string | undefined): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? (agora - t) / 60_000 : 0;
  };

  // O marcador `ep_resposta:` NUNCA é apagado e a ficha pode ter recomeçado o
  // ciclo (o reagenda-auto devolve pra agenda quem sumiu). Então ele só vale a
  // partir da confirmação que está na ficha AGORA, igual às duas réguas de
  // vermelho do eletropostoAgenda.
  const falouNesteCiclo = (f: FichaDaAgenda): boolean => {
    const em = respondeuEm.get(f.id);
    if (!em) return false;
    return !f.confirmacao_at || em >= f.confirmacao_at;
  };

  let cobranca1 = 0, cobranca2 = 0, nLiberados = 0, avisos = 0, erros = 0, segurados = 0;
  const previa: PreviaCobranca[] = [];
  const paraAvisar: Array<{ id: number; passo: PassoCobranca; tel: string; mensagem: string; quando: string }> = [];
  /** Liberados NESTA rodada. Entram na fila de mensagens junto com os que já
   *  estavam esperando: o certo é a pessoa saber no mesmo minuto em que o
   *  horário dela some, e quando a fila não dá conta o carimbo garante a volta
   *  no tick seguinte. */
  const avisosDaRodada: Array<{ id: number; passo: PassoCobranca; tel: string; mensagem: string; quando: string }> = [];

  // ── 1) Liberar (sem mensagem, em lote) e separar quem será cobrado ─────────
  for (const f of fichas) {
    if (falouNesteCiclo(f)) continue;
    const minDesdeConfirmacao = (agora - new Date(f.confirmacao_at!).getTime()) / 60_000;
    const minAteReuniao = (new Date(f.quando!).getTime() - agora) / 60_000;
    const passo = passoDevido({
      minDesdeConfirmacao,
      minAteReuniao,
      c1Enviada: jaCobrado.has(`${f.id}:c1`),
      c2EnviadaHaMin: jaCobrado.has(`${f.id}:c2`) ? (idadeEmMin(cobradoEm.get(`${f.id}:c2`)) ?? 0) : null,
      lembrete1hEnviado: !!f.lembrete_1h_at,
    });
    if (passo === 'esperar') continue;

    const tel = String(f.cliente_telefone || '').replace(/\D/g, '');
    if (passo === 'liberar') {
      if (nLiberados >= LIBERAR_POR_TICK) continue;
      if (dry) {
        previa.push({ id: f.id, cliente: String(f.cliente_nome || '—'), passo, quando: String(f.quando), mensagem: bolhaLiberou(f.cliente_nome, f.quando!) });
        nLiberados++;
        continue;
      }
      const ok = await liberar(f, false);
      if (ok) {
        nLiberados++;
        avisosDaRodada.push({ id: f.id, passo: 'liberar', tel, mensagem: bolhaLiberou(f.cliente_nome, f.quando!), quando: String(f.quando) });
        logger.info('ep-cobra-sim', `ficha ${f.id} liberou o horário por silêncio`, { minutos: Math.round(minDesdeConfirmacao) });
      } else {
        erros++;
      }
      continue;
    }

    // Cobrança: entra na fila de mensagens desta rodada.
    // A hora do corte que vai ESCRITA no ultimato. Nunca no passado: vale o mais
    // tarde entre o degrau da escada e a graça contada de agora, que é o instante
    // em que esta mensagem sai.
    const corteEm = new Date(Math.max(
      new Date(f.confirmacao_at!).getTime() + PASSO_LIBERA_MIN * 60_000,
      agora + GRACA_APOS_ULTIMATO_MIN * 60_000,
    ));
    const mensagem = passo === 'c1'
      ? bolhaCobranca1(f.cliente_nome, f.quando!, f.vendedor_nome)
      : bolhaCobranca2(f.cliente_nome, f.quando!, corteEm);
    paraAvisar.push({ id: f.id, passo, tel, mensagem, quando: String(f.quando) });
  }

  // ── 2) A fila de mensagens ────────────────────────────────────────────────
  // Ordem: ultimato, aviso de liberação, cobrança 1. O ultimato vem primeiro
  // porque é ele que EVITA a liberação; o aviso vem antes da cobrança 1 porque
  // quem já perdeu o horário precisa saber disso pra ter chance de voltar.
  const pendentesAviso: Array<{ id: number; passo: PassoCobranca; tel: string; mensagem: string; quando: string }> = [];
  for (const m of liberados.data ?? []) {
    const id = Number(String(m.key).slice(EP_LIBERADO_PREFIX.length));
    if (!Number.isInteger(id) || jaCobrado.has(`${id}:liberou`)) continue;
    const v = (m.value ?? {}) as MarcadorLiberado;
    const tel = String(v.telefone || '').replace(/\D/g, '');
    if (!tel || !v.quando) continue;
    const em = Date.parse(String(v.em || m.updated_at || ''));
    if (Number.isFinite(em) && agora - em > AVISO_VALIDADE_MS) continue;
    pendentesAviso.push({ id, passo: 'liberar', tel, mensagem: bolhaLiberou(v.nome ?? null, String(v.quando)), quando: String(v.quando) });
  }

  // Aviso que já estava esperando vem antes do que acabou de ser liberado (quem
  // ficou pra trás numa rodada apertada não pode ficar pra trás em todas), e
  // dentro dos dois manda a URGÊNCIA: quem perdeu o horário de HOJE precisa saber
  // hoje, quem perdeu o de sexta pode saber daqui a duas horas. Numa fila que
  // drena devagar, a ordem é o que separa um aviso útil de um aviso tarde demais.
  const porReuniao = (a: { quando: string }, b: { quando: string }) => a.quando.localeCompare(b.quando);
  const fila = [
    ...paraAvisar.filter(p => p.passo === 'c2').sort(porReuniao),
    ...pendentesAviso.sort(porReuniao),
    ...avisosDaRodada.sort(porReuniao),
    ...paraAvisar.filter(p => p.passo === 'c1').sort(porReuniao),
  ];

  for (const item of fila) {
    if (cobranca1 + cobranca2 + avisos >= MSG_POR_TICK) { segurados++; continue; }
    if (dry) {
      previa.push({ id: item.id, cliente: String(item.id), passo: item.passo, quando: '', mensagem: item.mensagem });
      if (item.passo === 'c1') cobranca1++; else if (item.passo === 'c2') cobranca2++; else avisos++;
      continue;
    }
    // Transacional COM piso: é mensagem sobre a reunião que a própria pessoa
    // marcou, e o volume é limitado pela agenda. O piso eleva o teto, não o
    // remove: numa hora em que a linha já falou muito, esta régua recua.
    const pisoHora = item.passo === 'liberar' ? AVISO_TETO_HORA : COBRA_TETO_HORA;
    if (!(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora, pisoDia: COBRA_TETO_DIA }))) {
      segurados++;
      continue;
    }
    // CLAIM ANTES DE ENVIAR, e é `insert` e não `upsert` de propósito: a chave é
    // primary key, então quem perde a corrida leva 23505 e desiste. Sem isso,
    // dois ticks simultâneos (o cron do GitHub e o da Vercel chamam o mesmo
    // /cron/process-messages) leem a mesma fila e mandam a MESMA mensagem duas
    // vezes. Aconteceu de verdade às 14h56 de 22/09/2026, na primeira drenagem:
    // o Andre recebeu o aviso de liberação em dobro, com 2 segundos de intervalo.
    // Carimbo gravado e envio que falha vira carimbo apagado logo abaixo, então a
    // mensagem volta pra fila no tick seguinte em vez de sumir.
    const nowIso = new Date().toISOString();
    const sufixo = item.passo === 'liberar' ? 'liberou' : item.passo;
    const chave = `${EP_COBRA_PREFIX}${item.id}:${sufixo}`;
    const { error: eClaim } = await supabase.from('system_state')
      .insert({ key: chave, value: { claim: nowIso }, updated_at: nowIso });
    if (eClaim) {
      logger.info('ep-cobra-sim', 'outro tick já pegou esta mensagem', { chave });
      continue;
    }
    try {
      await sendFrio(item.tel, [item.mensagem], 'io');
      await supabase.from('system_state').upsert(
        { key: chave, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
      if (item.passo === 'c1') cobranca1++; else if (item.passo === 'c2') cobranca2++; else avisos++;
    } catch (e) {
      await supabase.from('system_state').delete().eq('key', chave).then(undefined, () => {});
      logger.error('ep-cobra-sim', 'falha ao enviar cobrança', { id: item.id, passo: item.passo, erro: String(e) });
      erros++;
    }
  }

  if (!dry && (nLiberados || cobranca1 || cobranca2 || avisos || erros)) {
    logger.info('ep-cobra-sim', 'régua do SIM', { cobranca1, cobranca2, liberados: nLiberados, avisos, erros, segurados });
  }
  // Fila segurada precisa aparecer sozinha: "ninguém para cobrar" e "a linha
  // barrou todo mundo" são o mesmo silêncio no log, e o segundo é o que exige
  // mexer em EP_COBRA_TETO_HORA.
  if (!dry && segurados > 0) {
    logger.warn('ep-cobra-sim', `${segurados} mensagem(ns) segurada(s) na fila`, { pisoHora: COBRA_TETO_HORA, porTick: MSG_POR_TICK });
  }

  return {
    cobranca1, cobranca2, liberados: nLiberados, avisos, erros, segurados,
    ...(dry ? { motivo: 'dry', previa } : {}),
  };
}
