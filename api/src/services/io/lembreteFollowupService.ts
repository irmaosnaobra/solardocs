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
// do estágio, peso da temperatura e dias úteis parado. Modelo de linguagem aqui
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
//     eles. Sem isso um card teimoso come todos os slots pra sempre.
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
// Kill-switch: LEMBRETE_OFF=1 congela tudo sem deploy.
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
/** Quantos dias pra trás a varredura enxerga. Cemitério não vira tarefa. */
const diasJanela = (): number => num('LEMBRETE_JANELA_DIAS', 90);
/** Piso de espera: card que venceu agora há pouco não é abandono, é o dia
 *  acontecendo. Em horas ÚTEIS. */
const esperaMinimaH = (): number => num('LEMBRETE_ESPERA_MIN_H', 4);

const TZ = 'America/Sao_Paulo';

/**
 * Os estágios em que a bola está com a gente.
 *
 * Fora daqui é desfecho e não é assunto de robô: `sem_interesse`, `perdido`,
 * `fechou`, `fechou_concorrente`, `cancelado`, `arrendamento`, `sem_orcamento`.
 * Incluir qualquer um deles seria mandar o consultor ligar pra quem já disse não,
 * que é a forma mais rápida de ensinar a equipe a ignorar este robô.
 */
export const ESTAGIOS_ABERTOS = [
  'agendado', 'nao_atendeu', 'falando_whatsapp', 'em_atendimento',
  'fez_orcamento', 'proposta_apresentada', 'reagendar',
] as const;

/** Peso do estágio na fila. Quanto mais perto do sim, mais cedo se liga:
 *  quem já viu proposta e sumiu é quem ainda dá pra salvar. */
const PESO_ESTAGIO: Record<string, number> = {
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
  proposta_apresentada: 'PROPOSTA APRESENTADA',
  fez_orcamento: 'FEZ ORÇAMENTO',
  em_atendimento: 'NEGOCIANDO',
  falando_whatsapp: 'FALANDO NO WHATSAPP',
  reagendar: 'PRA REAGENDAR',
  nao_atendeu: 'NÃO ATENDEU',
  agendado: 'REUNIÃO VENCIDA SEM DESFECHO',
};

/** A frase de comando. É o que o Thiago pediu: direto, com o motivo junto. */
const CHAMADA: Record<string, string> = {
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

// ── A conta que escolhe o cliente da vez ────────────────────────────────────

/**
 * Nota do card. Maior liga primeiro.
 *
 * Três parcelas, nesta ordem de força:
 *   estágio × 10  — quem está perto do sim vale mais que quem nem atendeu
 *   temperatura × 4 — quente na frente de frio, dentro do mesmo estágio
 *   dias úteis parados (teto 15) — o tempo desempata e, sozinho, faz o card
 *                                  velho subir sem nunca passar na frente de um
 *                                  quente recém-parado
 *
 * Pura e exportada: é a regra de prioridade, e é a que o teste prende.
 */
export function pontuarCard(status: string, temperatura: string | null, horasUteis: number): number {
  const estagio = PESO_ESTAGIO[status] ?? 1;
  const t = (temperatura || '').trim().toLowerCase();
  const calor = t === 'quente' ? 3 : t === 'morno' ? 2 : 1;
  const diasParado = Math.min(horasUteis / 11, 15);          // 11h de expediente por dia
  return estagio * 10 + calor * 4 + diasParado;
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
export function montarLembrete(c: CardAberto, horasUteis: number, toque: number): string {
  const nome = c.cliente_nome?.trim() || 'Sem nome';
  const tel = telExibicao(c.cliente_telefone);
  const digitos = String(c.cliente_telefone || '').replace(/\D/g, '');
  const ctx = contextoDoCard(c);
  const quem = primeiroNome(c.vendedor_nome);
  return [
    `📞 *LIGA AGORA: ${nome}*`,
    tel ? `*${tel}*` : null,
    '',
    CHAMADA[c.status] || 'Esse cliente está esperando alguém finalizar o atendimento.',
    '',
    `Parado há ${esperaPorExtenso(horasUteis)}`,
    `Status: ${ROTULO_ESTAGIO[c.status] || c.status.toUpperCase()}${c.cidade ? ` · ${c.cidade}` : ''}`,
    ...(c.temperatura ? [`Temperatura: ${c.temperatura.toUpperCase()}`] : []),
    ...(ctx.length ? ['', ...ctx.map(l => `• ${l}`)] : []),
    '',
    digitos ? `Chamar no WhatsApp: wa.me/${digitos}` : null,
    `Abrir a ficha: https://solardoc.app/gerador/agenda?ag=${c.id}&ver=1`,
    '',
    toque > 1
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
  previa?: Array<{ pessoa: string; card: number; cliente: string | null; status: string; horas: number; nota: number }>;
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
    .or(`key.like.lembrete_card:%,key.like.lembrete_slot:%,key.like.vacuo_avisado:%`)
    .gte('updated_at', new Date(agora.getTime() - 30 * 86400_000).toISOString())
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
  const LIMITE_VACUO_MS = 24 * 3600_000;
  for (const l of linhas) {
    const k = String(l.key);
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
  const porPessoa = new Map<string, Array<{ card: CardAberto; horas: number; nota: number; toque: number }>>();
  for (const c of cards) {
    const pessoa = String(c.vendedor_nome || '').trim().toLowerCase();
    if (!pessoa || !donos.has(pessoa)) continue;          // card sem dono conhecido não vira ligação de ninguém
    if (!String(c.cliente_telefone || '').replace(/\D/g, '')) continue;
    if (!dry && slotsUsados.has(chaveSlot(pessoa, janela.dia, slot))) continue;

    const toque = toquesDoCard.get(c.id);
    if (toque && toque.n >= maxPorCard()) continue;       // já insistiu o bastante
    if (toque && agora.getTime() - toque.ultimo < folgaCardH() * 3600_000) continue;

    const chaveTel = chaveContato(String(c.cliente_telefone || '')) || '';
    if (chaveTel && cobradoPelaSentinela.has(chaveTel)) continue;   // a sentinela já mostrou esse nome hoje

    const ult = ultimoToque(c);
    if (!ult) continue;
    const horas = horasUteisEntre(ult, agora);
    if (horas < esperaMinimaH()) continue;

    const item = { card: c, horas, nota: pontuarCard(c.status, c.temperatura, horas), toque: (toque?.n || 0) + 1 };
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
        pessoa: e.pessoa, card: e.card.id, cliente: e.card.cliente_nome,
        status: e.card.status, horas: Math.round(e.horas * 10) / 10, nota: Math.round(e.nota * 10) / 10,
      })),
    };
  }

  // 4. Um envio por pessoa. Carimba ANTES de mandar: falha de envio que não
  //    carimbou faria o próximo tick (2 minutos depois) mandar de novo. É o bug
  //    do placar, e ele custa uma bolha repetida no celular de quem trabalha.
  let enviados = 0, erros = 0;
  const pessoas: string[] = [];
  for (const e of escolhidos) {
    const alvo = donos.get(e.pessoa);
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
      await sendWhatsApp(alvo, montarLembrete(e.card, e.horas, e.toque), 'io');
      enviados++;
      pessoas.push(e.pessoa);
      logger.info('lembrete-followup', `lembrete ${e.toque}º do card ${e.card.id} pra ${e.pessoa}`);
    } catch (err) {
      logger.error('lembrete-followup', `falha avisando ${e.pessoa}`, err);
      erros++;
    }
  }

  return { enviados, pessoas, candidatos, erros };
}
