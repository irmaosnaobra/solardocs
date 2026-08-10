// ─────────────────────────────────────────────────────────────────────────────
// AGENTE DE AGENDAMENTO DO ELETROPOSTO — confirma, lembra e cobra presença.
//
// O problema que ele resolve: gente marca na LP e some. Até aqui o lead saía da
// LP com "enviamos o link no seu WhatsApp antes do horário" na tela e NÃO recebia
// nada — só o Thiago e o Diego eram avisados (POST /io/eletroposto/alerta). O
// primeiro contato real acontecia na hora da reunião, quando já não dá pra
// recuperar quem esqueceu.
//
// Três toques, todos pro CLIENTE, todos na linha IO:
//   1. AO MARCAR      — confirma dia/hora, diz que é por vídeo, que o link cai
//                       neste chat, e PEDE UM "SIM" (o compromisso explícito é o
//                       que separa quem vai de quem só clicou).
//   2. 1 HORA ANTES   — avisa que o link está vindo e abre a porta do remarcar.
//   3. 5 MINUTOS ANTES— "estamos na espera, o link cai aqui a qualquer momento".
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
import { sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

/** Marcador de envio efetivado, pro teto anti-ban da linha enxergar este agente. */
export const EP_AGENDA_PREFIX = 'ep_agenda_sent:';

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

/** Ficha nova demais pra ser backlog: confirma na hora, sem fila e sem janela. */
const FRESCA_MS = 30 * 60 * 1000;
// BACKLOG_ANTECEDENCIA_MIN (120) saiu em 10/08/2026: era ele que fazia ficha
// represada a menos de 2h da reunião nunca receber confirmação nenhuma.
const BACKLOG_POR_TICK = 1;
const MAX_TOQUES_POR_TICK = 6;
const JANELA_INICIO_H = 8;
const JANELA_FIM_H = 20;

const desligado = () => (process.env.EP_LEMBRETES_OFF || '').trim() === '1';

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}
function foraDaJanela(): boolean {
  const h = horaBrasilia();
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
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

/** A bolha do telefone só existe se o número existir. Consultor sem WhatsApp
 *  cadastrado faz a frase sumir inteira — nunca sai "(  ) -" nem "—". */
const seTelefone = (tel: string, frase: (t: string) => string): string[] => (tel ? [frase(tel)] : []);

// ── 1. AO MARCAR ────────────────────────────────────────────────────────────
// Serve pra ficha nova E pra backlog: nada aqui diz "acabei de receber", então a
// mesma copy funciona 30 segundos ou 3 dias depois do agendamento.
export function bolhasConfirmacao(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  return [
    `Oi${comNome(n)}! Aqui é da *Irmãos na Obra* — sou eu que cuido da agenda das reuniões de eletroposto. ⚡`,
    `Sua reunião com o *${quem}* está confirmada: *${quandoPorExtenso(quandoIso)}* (horário de Brasília).`,
    ...seTelefone(tel, t => `O WhatsApp do ${quem} é *${t}* — salva esse contato, é de lá que ele fala com você.`),
    'É por vídeo, pelo celular mesmo ou pelo computador. O link cai aqui neste chat pouco antes do horário — você não precisa instalar nada.',
    'O horário fica reservado só pra você, e até lá a gente monta o estudo do seu ponto. Então me confirma: responde *SIM* que eu travo no seu nome. 👍',
    // O pedido de material é o que transforma a primeira reunião: sem isso o
    // consultor descobre na call que não tem ponto, não tem conta de luz e não
    // sabe o consumo — e a hora vira entrevista em vez de proposta.
    'E já me conta o que você tem sobre o seu eletroposto: onde é (ou onde está pensando), foto ou localização do ponto, conta de luz, e o que você já pesquisou ou orçou. Pode mandar tudo aqui, por texto, foto ou áudio.',
    'Quanto mais eu souber antes, mais a reunião rende — a gente já entra falando de número em vez de gastar a hora perguntando.',
    'E se o dia ou a hora não der mais, me fala aqui que eu remarco na hora — sem problema nenhum.',
  ];
}

// ── 2. 1 HORA ANTES ─────────────────────────────────────────────────────────
export function bolhas1h(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  return [
    `Oi${comNome(n)}! Falta *1 hora* pra sua reunião com o *${quem}*, às ${horaCurta(quandoIso)}. ⏰`,
    'Daqui a pouco eu te mando o link aqui neste chat — é só clicar na hora.',
    ...seTelefone(tel, t => `O ${quem} também pode te chamar do *${t}* — é o WhatsApp dele.`),
    'Deixa separado um cantinho com internet e sinal, que a conversa é por vídeo.',
    'Se aconteceu algum imprevisto, me avisa agora que eu remarco pra outro dia. Se está de pé, me responde *SIM*. 👍',
  ];
}

// ── 3. 5 MINUTOS ANTES ──────────────────────────────────────────────────────
export function bolhas5min(
  nome: string | null | undefined, quandoIso: string, vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim() || 'nosso consultor';
  const tel = telefoneBonito(telVendedor);
  return [
    `${n ? n + ', é' : 'É'} agora! Sua reunião começa às ${horaCurta(quandoIso)}. 📹`,
    `O *${quem}* já está aqui te esperando.`,
    'Fica de olho neste chat: o link da chamada cai aqui a qualquer momento — é só clicar e entrar.',
    ...seTelefone(tel, t => `Qualquer coisa, chama ele direto no *${t}*.`),
    'Até já! ⚡',
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
  confirmacao_at: string | null;
  lembrete_1h_at: string | null;
  lembrete_5min_at: string | null;
}

export type ToquePrevisto = { id: number; cliente: string; toque: '5min' | '1h' | 'confirmacao'; quando: string; bolhas: string[] };

export type ResultadoAgendaEp = {
  confirmacoes: number;
  lembretes_1h: number;
  lembretes_5min: number;
  erros: number;
  motivo?: string;
  previa?: ToquePrevisto[];
};

/** nome do consultor → WhatsApp dele, direto do cadastro do CRM. */
async function carregarConsultores(): Promise<Map<string, string>> {
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
  ({ confirmacoes: 0, lembretes_1h: 0, lembretes_5min: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/**
 * Roda a cada ~5 min dentro do /cron/process-messages.
 * Um toque por lead por rodada, do mais urgente pro menos: 5min > 1h > confirmação.
 * `dry` roda a decisão inteira e devolve o que SAIRIA, sem enviar e sem marcar flag.
 */
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
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, created_at, created_by, confirmacao_at, lembrete_1h_at, lembrete_5min_at')
    .eq('status', 'agendado')      // cancelado/sem_interesse não recebe nada
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
  const fichas = ((data ?? []) as Ficha[]).filter(f => ehOrigemEletroposto(f.created_by));
  if (!fichas.length) return zero('nenhuma_reuniao');

  // Telefone do consultor: fonte é a tabela `consultores` (a mesma que o CRM usa),
  // não uma lista fixa aqui — número trocado no cadastro tem que valer na mensagem
  // seguinte. Falhou a leitura? A frase do telefone some e o resto do aviso sai.
  const telPorConsultor = await carregarConsultores();

  const foraDeHorario = foraDaJanela();
  let confirmacoes = 0, l1h = 0, l5min = 0, erros = 0, backlog = 0, toques = 0;
  const previa: ToquePrevisto[] = [];

  // Envia e grava a flag. Em `dry` só registra o que sairia — mesma decisão, zero
  // mensagem. É assim que se confere a régua em produção sem tocar em ninguém.
  const entregar = async (ag: Ficha, toque: ToquePrevisto['toque'], tel: string, bolhas: string[], campo: string | string[]) => {
    if (opts.dry) {
      previa.push({ id: ag.id, cliente: String(ag.cliente_nome || '—'), toque, quando: String(ag.quando), bolhas });
      return;
    }
    await sendHuman(tel, bolhas, 'io');
    // Carimbo pro teto anti-ban da linha (lineThrottle: `ep_agenda_sent:`). Este
    // agente vivia FORA do teto, e em 04/08 a fila de atraso soltou 8 pessoas na
    // mesma hora — 37 mensagens numa linha cujo teto é 12. A linha bloqueou.
    const agoraIso = new Date().toISOString();
    await supabase.from('system_state')
      .upsert({ key: `${EP_AGENDA_PREFIX}${ag.id}:${toque}`, value: { em: agoraIso }, updated_at: agoraIso }, { onConflict: 'key' })
      .then(undefined, (e: unknown) => logger.error('ep-agenda', 'carimbo do teto da linha falhou', { id: ag.id, erro: String(e) }));
    // Pode carimbar MAIS DE UMA flag no mesmo envio: a confirmação de uma reunião
    // que já está dentro da janela de 1h também mata o toque de 1h (ver abaixo).
    const campos = Array.isArray(campo) ? campo : [campo];
    await supabaseGerador.from('agendamentos')
      .update(Object.fromEntries(campos.map(c => [c, agoraIso]))).eq('id', ag.id);
  };

  for (const ag of fichas) {
    if (toques >= MAX_TOQUES_POR_TICK) break;
    const tel = String(ag.cliente_telefone || '').replace(/\D/g, '');
    if (!tel || !ag.quando) continue;

    const minutos = (new Date(ag.quando).getTime() - agora) / 60_000;
    const telDoConsultor = telPorConsultor.get(String(ag.vendedor_nome || '')) ?? null;
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
    if (!ag.confirmacao_at) {
      if (!fresca) {
        // Backlog: fila lenta e horário civilizado. Continua valendo — o que saiu foi
        // só a distância mínima da reunião.
        if (foraDeHorario || backlog >= BACKLOG_POR_TICK) continue;
        // E dentro do teto anti-ban da linha. Faltava isto: em 04/08, às 08h BRT,
        // a janela abriu com fila acumulada da noite e ESTA drenagem soltou 8
        // pessoas na mesma hora — 37 mensagens, teto de 12, linha bloqueada pela
        // 2ª vez. Ficha FRESCA e os avisos de 1h/5min seguem furando o teto de
        // propósito: são de reunião acontecendo agora. Backlog não é urgente.
        if (!opts.dry && !(await dentroDoTetoHorarioLinha({ transacional: true })  /* confirmação de agenda: quem marcou está esperando */)) {
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
    if (!ag.lembrete_1h_at && minutos <= MIN_1H.ate && minutos >= MIN_1H.de) {
      try {
        await entregar(ag, '1h', tel, bolhas1h(ag.cliente_nome, ag.quando, ag.vendedor_nome, telDoConsultor), 'lembrete_1h_at');
        l1h++; toques++;
      } catch (e) {
        logger.error('ep-agenda', 'falha no toque de 1h', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }
  }

  if (toques > 0 && !opts.dry) {
    logger.info('ep-agenda', `${toques} toque(s)`, { confirmacoes, l1h, l5min, erros });
  }
  return {
    confirmacoes, lembretes_1h: l1h, lembretes_5min: l5min, erros,
    ...(opts.dry ? { motivo: 'dry', previa } : {}),
  };
}
