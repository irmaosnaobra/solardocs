// ─────────────────────────────────────────────────────────────────────────────
// REMARCAR SOZINHO — o lead diz que não dá, o robô oferece, o lead escolhe, pronto.
//
// Até aqui "não vai dar quinta" virava um ⚠️ no WhatsApp do Thiago e do Diego, e
// o lead ficava sem resposta até alguém ver o recado. Quem pede pra remarcar está
// com a intenção VIVA — é o momento mais barato de salvar a reunião, e ele passa.
//
// A conversa tem dois passos e nada mais:
//
//   lead  "não vai dar quinta, pode ser outro dia?"
//   robô  "Sem problema. Tenho: 1) sexta 14h  2) sexta 15h  3) segunda 13h"
//   lead  "2"                    (ou "sexta 15h", ou "a segunda")
//   robô  "Fechado, sexta 22/08 às 15h00 com o Diego. O horário de quinta liberei."
//
// ── O que ele NUNCA faz ──
//   • Não move calado. Só grava depois de o lead escolher um horário específico.
//   • Não cancela. O UPDATE do `quando` já devolve o horário velho pra agenda; não
//     existe caminho aqui que apague a reunião. Quem quer CANCELAR (não remarcar)
//     não é atendido por este robô — vai pro humano como sempre foi.
//   • Não troca de consultor. Quem remarca continua com quem estava marcado (ordem
//     do dono, 13/08/2026): mexer nisso mexeria na divisão que a
//     `processar_repasses()` faz entre Thiago e Diego, e isso é decisão de gente.
//   • Não insiste. Duas ofertas por ficha. Na terceira vez o robô cala e deixa o
//     recado pro humano — lead que não escolheu duas vezes quer falar com alguém.
//
// ── Onde ele mora ──
// Não tem tick próprio: ele é chamado de dentro do `eletropostoRespostas`, que já
// lê o inbound da linha, já casa telefone com ficha e já tem o corte de "mensagem
// nova". Um segundo leitor de `wa_mensagens` seria dois robôs disputando a mesma
// conversa. O alerta pra equipe continua saindo em TODOS os casos — remarcar
// sozinho não é motivo pra equipe ficar sabendo menos.
//
// Kill-switch: EP_REMARCAR_OFF=1 (volta ao comportamento antigo: só alerta).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { quandoPorExtenso, horaCurta, telefoneBonito, EP_AGENDA_PREFIX } from './eletropostoAgenda';
import { proximasVagas, aindaLivre, diaBRT } from './eletropostoVagas';

/** Marcador de envio efetivado — entra no teto anti-ban da linha (lineThrottle). */
export const EP_REMARCAR_SENT = 'ep_remarcar_sent:';
/** Oferta em aberto: `ep_remarcar:<id>` → { ofertas, em, rodada }. */
export const EP_REMARCAR_PREFIX = 'ep_remarcar:';

/** Quantos horários o robô põe na mesa. Três é escolha; cinco é formulário. */
const QUANTAS_OPCOES = 3;
/** Oferta velha não vale: um "sexta" solto três dias depois não é escolha de nada. */
const OFERTA_VALIDA_MS = 24 * 3600_000;
/** Duas ofertas por ficha. Depois disso quem fala é gente. */
const MAX_RODADAS = 2;

const desligado = () => (process.env.EP_REMARCAR_OFF || '').trim() === '1';

// ── INTENÇÃO ────────────────────────────────────────────────────────────────
// CANCELAR NÃO É REMARCAR, e o robô só atende o segundo. Os dois moravam na mesma
// expressão (a `RE_REMARCAR` do módulo de respostas, que serve pro selo e pra
// derrubar presença — lá juntar os dois está certo). Aqui não: tratar "quero
// cancelar" como remarcação faz o robô responder com uma lista de horários pra
// quem acabou de dizer que não quer mais. Quem cancela vai pro humano.
const RE_CANCELAR = /\b(cancelar|cancela|cancele|cancelado|desmarcar|desmarca|desisti|desistir|n[ãa]o (tenho|quero) (mais )?interesse|n[ãa]o quero mais)\b/i;
const RE_REAGENDAR = /\b(remarcar|remarca|remarque|reagendar|reagenda|adiar|adia|transferir|passar pra|passar para|mudar (o )?hor[áa]rio|trocar (o )?hor[áa]rio|outro dia|outro hor[áa]rio|outra data|n[ãa]o vou (poder|conseguir)|n[ãa]o consigo|n[ãa]o poderei|n[ãa]o vai dar|n[ãa]o d[áa]|tem como (ser )?(outro|mais tarde)|nesse hor[áa]rio n[ãa]o)\b/i;

/** Pediu pra REMARCAR (e não pra cancelar)? É este o gatilho da oferta. */
export function querRemarcar(textos: string[]): boolean {
  const limpos = textos.map(t => String(t || '').trim()).filter(Boolean);
  if (!limpos.length) return false;
  // Cancelamento em qualquer mensagem da leva desliga o robô: "não vai dar, quero
  // cancelar" é cancelamento, e a segunda metade é que manda.
  if (limpos.some(t => RE_CANCELAR.test(t))) return false;
  return limpos.some(t => RE_REAGENDAR.test(t));
}

// ── ESCOLHA ─────────────────────────────────────────────────────────────────
/** "sexta-feira, 22/08 às 15h00" → as peças que o lead pode citar de volta. */
function pecas(iso: string): { num: string; dia: string; semana: string; hora: string; hora24: string } {
  const ext = quandoPorExtenso(iso);              // "sexta-feira, 22/08 às 15h00"
  const semana = ext.split(',')[0]!.replace('-feira', '');
  const dia = (/(\d{2}\/\d{2})/.exec(ext) ?? [])[1] ?? '';
  const hora = horaCurta(iso);                    // "15h00"
  return { num: '', dia, semana, hora, hora24: hora.slice(0, 2) };
}

/**
 * Qual das opções o lead escolheu.
 *
 * Devolve o índice, `null` se nenhuma casou e `-1` se mais de uma casou — e essa
 * terceira resposta é o ponto: com duas opções na MESMA sexta, "sexta" não escolhe
 * nada. Robô que chuta no empate remarca pro horário errado, e o lead só descobre
 * na hora que ninguém entrou na chamada.
 */
export function escolhaDaResposta(textos: string[], ofertas: string[]): number | null {
  const txt = textos.join(' ').toLowerCase().trim();
  if (!txt || !ofertas.length) return null;

  const casaram = new Set<number>();

  // 1) Número da opção. Só quando é a mensagem INTEIRA ("2", "opção 2", "a 2") —
  //    "2 pessoas vão participar" não é escolha de horário.
  const soNumero = /^(?:op[çc][ãa]o\s*|a\s*|n[ºo°]?\s*)?([1-9])[\s!.,)º°]*$/.exec(txt);
  if (soNumero) {
    const i = Number(soNumero[1]) - 1;
    if (i >= 0 && i < ofertas.length) return i;   // número é inequívoco: decide sozinho
  }

  // 2) Dia da semana, data e/ou hora citados no texto. Conta QUANTOS sinais cada
  //    opção casou, e vence a mais específica — é isso que faz "segunda 15h"
  //    escolher entre duas segundas: as duas casam o dia, só uma casa a hora.
  //    Contar só "casou / não casou" empatava as duas e mandava o lead repetir.
  const pontos = ofertas.map(iso => {
    const p = pecas(iso);
    let n = 0;
    if (txt.includes(p.semana)) n++;
    if (p.dia && txt.includes(p.dia)) n++;
    // "15h", "15:00", "15 horas", "às 15" — mas NÃO o "15" solto de "15 minutos".
    if (new RegExp(`\\b${p.hora24}\\s*(h|:00|hs|horas?)\\b`).test(txt)
      || new RegExp(`\\b[àa]s\\s*${p.hora24}\\b`).test(txt)) n++;
    return n;
  });

  const melhor = Math.max(...pontos);
  if (melhor === 0) return null;
  pontos.forEach((n, i) => { if (n === melhor) casaram.add(i); });

  if (casaram.size === 1) return [...casaram][0]!;
  return -1;                                      // empate: pede pra ser específico
}

// ── COPY ────────────────────────────────────────────────────────────────────
const comNome = (n: string) => (n ? `, ${n}` : '');

/** "1) sexta, 22/08 às 15h00" */
const linhaDaOpcao = (iso: string, i: number) => `${i + 1}) ${quandoPorExtenso(iso).replace('-feira', '')}`;

export function bolhasOferta(nome: string, ofertas: string[], quem: string): string[] {
  return [
    `Sem problema${comNome(nome)}, a gente remarca.`,
    // As opções numa bolha só, uma por linha: lista quebrada em várias mensagens
    // vira rolagem, e o lead responde "2" olhando pra opção errada.
    `Estes são os próximos horários do *${quem}*:\n\n${ofertas.map(linhaDaOpcao).join('\n')}`,
    'Me responde só o número que eu já troco pra você. Se nenhum servir, me fala o dia que fica melhor.',
  ];
}

export function bolhasAmbiguo(ofertas: string[]): string[] {
  return [
    `Tenho mais de um horário nesse dia — me diz o número pra eu não trocar pro errado:\n\n${ofertas.map(linhaDaOpcao).join('\n')}`,
  ];
}

export function bolhasRemarcado(nome: string, novoIso: string, antigoIso: string, quem: string, tel: string): string[] {
  const t = telefoneBonito(tel);
  return [
    `Pronto${comNome(nome)}! Sua reunião agora é *${quandoPorExtenso(novoIso)}*, com o *${quem}*.`,
    `Já liberei o horário de ${quandoPorExtenso(antigoIso).replace('-feira', '')} pra outra pessoa.`,
    `O link continua chegando no WhatsApp dele${t ? `, o *${t}*` : ''} — e eu te lembro no dia.`,
  ];
}

/** Sem vaga nenhuma nas próximas 3 semanas: não inventa horário, chama gente. */
export function bolhasSemVaga(nome: string, quem: string): string[] {
  return [
    `${nome ? nome + ', a' : 'A'} agenda do *${quem}* está sem horário livre por enquanto.`,
    'Já avisei ele aqui — ele te chama pra encaixar o melhor dia. Me desculpa a demora.',
  ];
}

// ── ESTADO ──────────────────────────────────────────────────────────────────
type Oferta = { ofertas: string[]; em: string; rodada: number };

async function lerOferta(id: number): Promise<Oferta | null> {
  try {
    const { data, error } = await supabase
      .from('system_state').select('value').eq('key', `${EP_REMARCAR_PREFIX}${id}`).maybeSingle();
    if (error) throw error;
    const v = data?.value as Oferta | undefined;
    if (!v?.em || !Array.isArray(v.ofertas)) return null;
    // Vencida vale como "nenhuma oferta em aberto", mas a RODADA sobrevive: quem
    // ignorou a lista de ontem não ganha oferta infinita amanhã.
    return v;
  } catch (err) {
    logger.error('ep-remarcar', 'ler oferta falhou', { id, erro: String(err) });
    return null;
  }
}

async function gravarOferta(id: number, o: Oferta): Promise<void> {
  const agoraIso = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: `${EP_REMARCAR_PREFIX}${id}`, value: o, updated_at: agoraIso }, { onConflict: 'key' });
}

/** Carimbo de envio pro teto anti-ban da linha (o mesmo padrão dos outros agentes). */
async function carimbar(id: number, etapa: string): Promise<void> {
  const agoraIso = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: `${EP_REMARCAR_SENT}${id}:${etapa}`, value: { em: agoraIso }, updated_at: agoraIso },
    { onConflict: 'key' },
  ).then(undefined, (e: unknown) => logger.error('ep-remarcar', 'carimbo falhou', { id, erro: String(e) }));
}

// ── MOVER A REUNIÃO ─────────────────────────────────────────────────────────
/**
 * Move a ficha e RESSINCRONIZA a régua de avisos. A parte fácil é o `quando`; a
 * que quebra em silêncio são as flags:
 *
 *   · `lembrete_1h_at` / `lembrete_5min_at` — gravados pro horário VELHO. Sem
 *     limpar, a reunião nova acontece sem nenhum aviso antes dela.
 *   · `ep_agenda_sent:<id>:manha` — o carimbo do bom dia não guarda data, só o id.
 *     Sem apagar, quem remarcou pra outro dia nunca recebe o bom dia do dia novo.
 *   · `presenca_confirmada_at` — escolher horário é combinar, não é dizer "eu vou".
 *     A confirmação de presença recomeça do zero.
 *
 * `confirmacao_at` FICA: a pessoa já foi apresentada ao consultor e ao formato.
 * Zerar faria o robô mandar a confirmação inteira de novo, do zero, pra quem
 * acabou de conversar com ele.
 */
async function moverReuniao(id: number, novoIso: string): Promise<void> {
  const { error } = await supabaseGerador.from('agendamentos')
    .update({
      quando: novoIso,
      lembrete_1h_at: null,
      lembrete_5min_at: null,
      presenca_confirmada_at: null,
    })
    .eq('id', id);
  if (error) throw error;

  await supabase.from('system_state').delete().eq('key', `${EP_AGENDA_PREFIX}${id}:manha`)
    .then(undefined, (e: unknown) =>
      logger.error('ep-remarcar', 'limpar carimbo do bom dia falhou', { id, erro: String(e) }));
}

// ── O PASSO ─────────────────────────────────────────────────────────────────
export type Ficha = {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  quando: string | null;
  vendedor_nome: string | null;
};

export type ResultadoRemarcar =
  | { acao: 'nada' }
  | { acao: 'ofertou'; ofertas: string[] }
  | { acao: 'ambiguo' }
  | { acao: 'remarcou'; de: string; para: string }
  | { acao: 'sem_vaga' }
  | { acao: 'desistiu' };

/**
 * Um passo da conversa de remarcação pra UMA ficha. Chamado pelo tick de
 * respostas, com as mensagens novas daquela pessoa.
 *
 * A ordem importa: ESCOLHA antes de PEDIDO. Quem já tem oferta na mesa e escreve
 * "não dá sexta, pode ser 2?" está escolhendo — reler como pedido novo geraria
 * outra lista e a conversa nunca fecharia.
 */
export async function passoDeRemarcacao(
  ficha: Ficha, textos: string[], telConsultor: string | null, opts: { dry?: boolean } = {},
): Promise<ResultadoRemarcar> {
  if (desligado() || !ficha.quando || !ficha.cliente_telefone) return { acao: 'nada' };

  const quem = String(ficha.vendedor_nome || '').trim();
  if (!quem) return { acao: 'nada' };            // sem consultor não há agenda pra consultar
  const nome = (String(ficha.cliente_nome || '').trim().split(/\s+/)[0] || '');
  const primeiro = nome.length >= 2 && nome.length <= 20 && nome.toLowerCase() !== 'lead' ? nome : '';
  const tel = String(ficha.cliente_telefone).replace(/\D/g, '');
  const pendente = await lerOferta(ficha.id);
  const valeAinda = !!pendente && Date.now() - new Date(pendente.em).getTime() < OFERTA_VALIDA_MS;

  const falar = async (bolhas: string[], etapa: string): Promise<boolean> => {
    if (opts.dry) return true;
    // Conversa de remarcação é transacional — é resposta a quem escreveu agora.
    if (!(await dentroDoTetoHorarioLinha({ transacional: true }))) {
      logger.info('ep-remarcar', 'teto da linha estourado — resposta espera o próximo tick', { id: ficha.id });
      return false;
    }
    await sendHuman(tel, bolhas, 'io');
    await carimbar(ficha.id, etapa);
    return true;
  };

  // ── 1. O lead está escolhendo uma das opções que estão na mesa ──
  if (valeAinda) {
    const i = escolhaDaResposta(textos, pendente!.ofertas);
    if (i === -1) {
      await falar(bolhasAmbiguo(pendente!.ofertas), 'ambiguo');
      return { acao: 'ambiguo' };
    }
    if (i !== null) {
      const novo = pendente!.ofertas[i]!;
      const antigo = ficha.quando;
      // Entre oferecer e responder passam minutos ou horas — tempo de sobra pra
      // outra pessoa marcar aquele slot na LP. Confere ANTES de gravar.
      if (!opts.dry && !(await aindaLivre(novo, quem, antigo))) {
        logger.info('ep-remarcar', 'horário escolhido foi ocupado no meio do caminho', { id: ficha.id, novo });
        return await ofertar(ficha, primeiro, quem, tel, (pendente!.rodada ?? 1), falar, opts);
      }
      if (!opts.dry) {
        await moverReuniao(ficha.id, novo);
        await supabase.from('system_state').delete().eq('key', `${EP_REMARCAR_PREFIX}${ficha.id}`)
          .then(undefined, () => { /* oferta órfã não faz mal: a próxima leitura sobrescreve */ });
      }
      await falar(bolhasRemarcado(primeiro, novo, antigo, quem, telConsultor ?? ''), 'remarcado');
      return { acao: 'remarcou', de: antigo, para: novo };
    }
  }

  // ── 2. O lead está PEDINDO pra remarcar ──
  if (!querRemarcar(textos)) return { acao: 'nada' };
  const rodada = (pendente?.rodada ?? 0) + 1;
  if (rodada > MAX_RODADAS) {
    logger.info('ep-remarcar', 'terceiro pedido sem escolha — deixa pro humano', { id: ficha.id });
    return { acao: 'desistiu' };
  }
  return await ofertar(ficha, primeiro, quem, tel, rodada, falar, opts);
}

/** Monta e manda a lista de horários. Compartilhado pelo pedido e pelo "slot foi tomado". */
async function ofertar(
  ficha: Ficha, primeiro: string, quem: string, _tel: string, rodada: number,
  falar: (b: string[], etapa: string) => Promise<boolean>, opts: { dry?: boolean },
): Promise<ResultadoRemarcar> {
  const vagas = await proximasVagas(quem, QUANTAS_OPCOES, { ignorarIso: ficha.quando });
  if (vagas === null) return { acao: 'nada' };   // leitura falhou: não inventa horário
  if (!vagas.length) {
    await falar(bolhasSemVaga(primeiro, quem), 'sem_vaga');
    return { acao: 'sem_vaga' };
  }
  const entregou = await falar(bolhasOferta(primeiro, vagas, quem), 'oferta');
  // Grava só o que foi realmente pra rua: oferta que o teto segurou não pode virar
  // rodada gasta nem lista "na mesa" que o lead nunca viu.
  if (!entregou) return { acao: 'nada' };
  if (!opts.dry) await gravarOferta(ficha.id, { ofertas: vagas, em: new Date().toISOString(), rodada });
  return { acao: 'ofertou', ofertas: vagas };
}

/** Linha extra no aviso da equipe — o humano precisa saber que o robô já resolveu. */
export function linhaDoAviso(r: ResultadoRemarcar): string | null {
  switch (r.acao) {
    case 'remarcou':
      return `🔄 REMARCADO PELO ROBÔ: ${quandoPorExtenso(r.de)} → *${quandoPorExtenso(r.para)}*. O horário antigo voltou pra agenda.`;
    case 'ofertou':
      return `🤖 O robô já ofereceu ${r.ofertas.length} horário(s) e está esperando a escolha.`;
    case 'ambiguo':
      return '🤖 O robô pediu pra pessoa escolher o número (ela citou um dia com mais de um horário).';
    case 'sem_vaga':
      return '⚠️ Pediu pra remarcar e NÃO HÁ horário livre na agenda dele — precisa de encaixe manual.';
    case 'desistiu':
      return '⚠️ Terceiro pedido de remarcar sem escolher horário — o robô parou de oferecer.';
    default:
      return null;
  }
}

/** Exportado só pro teste: o dia de Brasília usado nas ofertas. */
export { diaBRT };
