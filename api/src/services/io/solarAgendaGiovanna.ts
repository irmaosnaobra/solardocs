// ─────────────────────────────────────────────────────────────────────────────
// OS DOIS TOQUES DO DIA DA GIOVANNA — bom dia às 7h e "oi" 5 minutos antes.
//
// Ordem do Thiago (11/09/2026), no mesmo dia em que 180 fichas de solar do
// Thiago, do Diego e da Nilce viraram agenda dela (15 ligações por dia útil, de
// 14/09 a 29/09): "todos esses clientes do dia irão receber um bom dia às 07:00"
// e um segundo toque 5 minutos antes do horário marcado.
//
// ── POR QUE UM MÓDULO NOVO, E NÃO O lembretesAgenda ──────────────────────────
// O `lembretesAgenda.ts` já tem quatro réguas escritas em cima de energia solar,
// e está mudo desde 28/07 por ordem ("nenhum lead precisa de avisos — pode cessar
// todos"). Religar aquele switch acorda a régua pra TODA a agenda, e a mesma
// agenda atende eletroposto: foi assim que o lead #584 respondeu "não solicitei
// nenhum serviço de energia solar". Este módulo é o contrário disso — o corte é
// por NOME (`DONA`) e por produto, e nada fora da carteira dela recebe nada.
//
// ── UMA BOLHA POR TOQUE, E ISSO É UMA DECISÃO DE SEGURANÇA ───────────────────
// O Thiago escreveu o bom dia em duas linhas, e a régua do eletroposto manda até
// 3 bolhas por toque. Aqui vai UMA, com a quebra de linha dentro: são 15 pessoas
// na mesma faixa de 15 minutos, e 15×2 = 30 mensagens numa hora é o mesmo formato
// que bloqueou a linha IO em 04/08/2026 (37 mensagens numa hora, teto de 12). Em
// uma bolha o contador do `lineThrottle` também passa a valer o que ele diz: ele
// conta TOQUES, então bolha dupla é volume que não aparece na conta.
//
// ── ANTI-BAN ────────────────────────────────────────────────────────────────
// Os dois toques são transacionais (a pessoa tem horário marcado HOJE), então
// furam a janela diurna de 09–20h — é assim que o bom dia das 7h existe, e é o
// mesmo caminho do `eletropostoAgenda`. O que eles NÃO furam é o teto da linha:
// cada envio carimba `solar_giovanna_sent:` no system_state do MAIN, prefixo que
// está em `BOT_SENT_PREFIXES`. Sem esse carimbo o módulo gastaria a linha sem
// aparecer na conta, que é como quase todo agente desta lista entrou nela: depois
// de uma queda.
//
// O piso por hora é 18 porque o volume é LIMITADO PELA AGENDA (1 toque por
// reunião do dia, e o dia tem 15). Ele é maior que o piso do bom dia do
// eletroposto (10), e o contador da linha é COMPARTILHADO — então, na hora em que
// esta leva drena, o bom dia do eletroposto fica sem orçamento. Isso é aceito de
// propósito e é pequeno: a janela do EP vai até as 12h com 60 min de antecedência,
// e a agenda de eletroposto é de tarde. Se um dia as duas agendas encherem de
// manhã, o que se mexe é `SOLAR_GIOVANNA_TETO_HORA`, não a rajada.
//
// A drenagem é de 2 por tick. Com o tick de 2 min do /cron/process-messages, os
// 15 saem entre 07:00 e ~07:16, um por minuto. Não é rajada, e é isso que importa:
// o que derruba a linha é bloqueio e denúncia, e denúncia vem de rajada.
//
// ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
//   • Não fala com ficha de eletroposto (corte por `ehOrigemEletroposto`).
//   • Não fala com ficha de outro consultor.
//   • Não fala com quem não está `agendado` (cancelado, sem interesse, não
//     atendido: quem teve desfecho não recebe "vou fazer seu atendimento").
//   • Não manda o bom dia a menos de 30 min da ligação — aí quem fala é o toque
//     de 5 minutos, e os dois juntos viram spam.
//   • Não manda o toque de 5 min pra quem RESPONDEU o bom dia (ordem do Thiago,
//     11/09). Quem respondeu já está em conversa e a Giovanna já foi avisada pelo
//     `solarRespostas`; "Oi, como vai?" ali é o robô falando por cima de gente —
//     e ainda por cima é a mesma frase que a pessoa acabou de responder. O sinal
//     sai do inbox da própria linha (`wa_mensagens`), lido na hora do envio: não
//     dá pra decidir isso com o retrato do começo do dia.
//
// Kill-switch: SOLAR_GIOVANNA_OFF=1 (mata os dois toques sem deploy).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { INSTANCE_ID_IO } from './solarRespostas';

/** De quem é a carteira. Corte por NOME, igual ao `ehSocio` do agendaFechada:
 *  quando a regra é sobre uma pessoa, o corte é o nome dela. */
const DONA = 'Giovanna';

const TZ = 'America/Sao_Paulo';
const INSTANCE = 'io' as const;

/** Carimbo do teto da linha. Tem que estar em `BOT_SENT_PREFIXES` do lineThrottle,
 *  senão este agente gasta a linha sem aparecer na conta. */
export const SOLAR_GIOVANNA_PREFIX = 'solar_giovanna_sent:';

// ── A COPY, como o Thiago escreveu ───────────────────────────────────────────
/** Bom dia das 7h. Uma bolha, duas linhas (ver o cabeçalho). */
export const BOLHA_BOM_DIA =
  'Oi, como vai?\nSou a Giovanna da energia solar, vou fazer seu atendimento e trazer a melhor solução.';

/** Toque de 5 minutos antes. SÓ vai pra quem não respondeu o bom dia (ordem do
 *  Thiago, 11/09/2026) — ver `quemFalouDepoisDoBomDia`.
 *
 *  ATENÇÃO: veio assim, e é igual à primeira linha do bom dia que a mesma pessoa
 *  recebeu às 7h da manhã. Está aqui numa constante própria justamente pra trocar
 *  em uma linha quando o texto definitivo chegar. */
export const BOLHA_CINCO_MIN = 'Oi, como vai?';

// ── Janelas ──────────────────────────────────────────────────────────────────
/** O bom dia sai a partir das 7h. Janela e não horário cravado: o tick atrasa, e
 *  o teto da linha pode segurar alguém pro tick seguinte. Fecha às 9h porque a
 *  primeira ligação do dia é 08:15 — depois disso o aviso vira atraso. */
const MANHA = { de: 7, ate: 9 };
/** Nunca a menos disto da ligação: aí quem fala é o toque de 5 minutos. */
const MANHA_ANTECEDENCIA_MIN = 30;
const MANHA_POR_TICK = 2;

/** Minutos que faltam pra ligação. Largo de propósito nas duas pontas: o tick é
 *  de 2 min mas atrasa, e um "oi" 1 minuto depois da hora ainda é melhor que
 *  nenhum. */
const MIN_5MIN = { de: -2, ate: 10 };
const CINCO_POR_TICK = 2;

/** Piso do teto da linha. Volume limitado pela agenda (1 toque por reunião). */
const TETO_HORA = Number(process.env.SOLAR_GIOVANNA_TETO_HORA || 18);
const TETO_DIA = Number(process.env.SOLAR_GIOVANNA_TETO_DIA || 200);

/** Freio de rajada do tick inteiro, somando os dois toques. */
const MAX_TOQUES_POR_TICK = 4;

export const desligado = (): boolean => (process.env.SOLAR_GIOVANNA_OFF || '').trim() === '1';

// ── datas em Brasília ────────────────────────────────────────────────────────
const fmtYmd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
/** Dia (YYYY-MM-DD) em Brasília. */
export const diaBRT = (d: Date | string | number): string => fmtYmd.format(new Date(d));

/** Hora cheia em Brasília. -03:00 fixo: o Brasil não tem horário de verão. */
function horaBrasilia(now: Date = new Date()): number {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

/** Chave de telefone igual à do CRM e à do solarRespostas: tira o 55, DDD +
 *  últimos 8 (ignora o 9º dígito, que varia entre as fontes). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

/**
 * Quem falou com a linha e QUANDO (a mensagem mais recente de cada telefone),
 * a partir do bom dia mais antigo do dia.
 *
 * É isto que decide quem NÃO recebe o toque de 5 minutos: quem respondeu o bom
 * dia já está em conversa, e a Giovanna já foi avisada pelo `solarRespostas`.
 * Mandar "Oi, como vai?" por cima é o robô falando em cima de gente — e é a
 * mesma frase que a pessoa acabou de responder.
 *
 * Devolve `null` quando a leitura falha, e o chamador trata isso como CEGUEIRA:
 * nenhum toque de 5 min sai nesta rodada. É a mesma escolha do `manhaCega` do
 * eletropostoAgenda — na dúvida entre calar e falar por cima, cala. A janela do
 * toque tem ~6 ticks, então um erro passageiro não custa a mensagem.
 */
async function quemFalouDepoisDoBomDia(comBomDia: Ficha[]): Promise<Map<string, string> | null> {
  if (!comBomDia.length) return new Map();
  const piso = comBomDia.map(f => String(f.bomdia_at)).sort()[0];
  const { data, error } = await supabase
    .from('wa_mensagens')
    .select('telefone, momment')
    .eq('from_me', false)
    .eq('is_group', false)
    .eq('instancia', INSTANCE_ID_IO)
    .gte('momment', piso)
    .limit(1000);
  if (error) {
    logger.error('solar-giovanna', 'ler o inbox da linha falhou — nenhum toque de 5 min nesta rodada', error);
    return null;
  }
  const ultima = new Map<string, string>();
  for (const m of data ?? []) {
    const k = telKey((m as { telefone?: string }).telefone);
    if (!k) continue;
    const quando = String((m as { momment?: unknown }).momment ?? '');
    if (!quando) continue;
    const atual = ultima.get(k);
    if (!atual || quando > atual) ultima.set(k, quando);
  }
  return ultima;
}

type Ficha = {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  vendedor_nome: string | null;
  quando: string | null;
  status: string;
  created_by: string | null;
  bomdia_at: string | null;
  lembrete_5min_at: string | null;
};

export type ToquePrevisto = { id: number; cliente: string; toque: 'bom_dia' | '5min'; quando: string; bolha: string };

export type ResultadoSolarGiovanna = {
  ok: true;
  motivo?: string;
  candidatos: number;
  bom_dia: number;
  cinco_min: number;
  /** Não receberam o toque de 5 min porque responderam o bom dia. */
  ja_responderam: number;
  segurados_pelo_teto: number;
  erros: number;
  previa?: ToquePrevisto[];
};

const zero = (motivo?: string): ResultadoSolarGiovanna => ({
  ok: true, ...(motivo ? { motivo } : {}),
  candidatos: 0, bom_dia: 0, cinco_min: 0, ja_responderam: 0, segurados_pelo_teto: 0, erros: 0,
});

/**
 * Um tick dos dois toques. `dry` decide tudo e não manda nada — é assim que se
 * confere a copy contra ficha real sem tocar em ninguém.
 */
export async function runSolarAgendaGiovannaTick(
  opts: { dry?: boolean } = {},
): Promise<ResultadoSolarGiovanna> {
  const dry = !!opts.dry;
  if (!dry && desligado()) return zero('desligado');

  const agora = Date.now();
  const hojeBRT = diaBRT(agora);

  // Só a agenda DELA, só o que ainda está de pé, e só de hoje pra frente (o
  // recorte de -15 min existe pro toque de 5 min sobreviver a um tick atrasado).
  // O fim do dia sai do próprio filtro em JS: um `lte` em ISO erraria a virada.
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, vendedor_nome, quando, status, created_by, bomdia_at, lembrete_5min_at')
    .eq('vendedor_nome', DONA)
    .eq('status', 'agendado')
    .gte('quando', new Date(agora - 15 * 60 * 1000).toISOString())
    .order('quando', { ascending: true })
    .limit(200);

  if (error) {
    logger.error('solar-giovanna', 'ler a agenda falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  // Só reunião de HOJE, e nunca ficha de eletroposto (ela não atende essa linha).
  const fichas = ((data ?? []) as Ficha[]).filter(f =>
    !!f.quando && diaBRT(f.quando) === hojeBRT && !ehOrigemEletroposto(f.created_by));

  if (!fichas.length) return { ...zero('nada_hoje'), ...(dry ? { previa: [] } : {}) };

  const hora = horaBrasilia();
  const naJanelaDaManha = hora >= MANHA.de && hora < MANHA.ate;

  // Quem está na janela dos 5 minutos AGORA e já levou o bom dia. Só por causa
  // deles é que vale ler o inbox — numa rodada sem ninguém nessa faixa (que é a
  // maioria delas) o módulo não encosta na tabela de mensagens.
  const naJanelaDos5 = (f: Ficha) => {
    if (f.lembrete_5min_at || !f.quando) return false;
    const m = (new Date(f.quando).getTime() - agora) / 60_000;
    return m <= MIN_5MIN.ate && m >= MIN_5MIN.de;
  };
  const precisamDoInbox = fichas.filter(f => naJanelaDos5(f) && !!f.bomdia_at);
  const falou = precisamDoInbox.length ? await quemFalouDepoisDoBomDia(precisamDoInbox) : new Map<string, string>();
  /** Leitura do inbox falhou: nesta rodada ninguém recebe o toque de 5 min. */
  const cegoParaRespostas = falou === null;

  const previa: ToquePrevisto[] = [];
  let bomDia = 0, cincoMin = 0, jaResponderam = 0, segurados = 0, erros = 0, toques = 0;

  /** Manda a bolha, carimba o teto da linha e grava a flag na ficha. */
  const entregar = async (f: Ficha, toque: ToquePrevisto['toque'], tel: string, bolha: string, campo: string) => {
    if (dry) {
      previa.push({ id: f.id, cliente: String(f.cliente_nome || '—'), toque, quando: String(f.quando), bolha });
      return;
    }
    await sendHuman(tel, [bolha], INSTANCE, { maxBolhas: 1 });
    const agoraIso = new Date().toISOString();
    await supabase.from('system_state')
      .upsert({ key: `${SOLAR_GIOVANNA_PREFIX}${f.id}:${toque}`, value: { em: agoraIso }, updated_at: agoraIso },
        { onConflict: 'key' })
      .then(undefined, (e: unknown) =>
        logger.error('solar-giovanna', 'carimbo do teto da linha falhou', { id: f.id, erro: String(e) }));
    await supabaseGerador.from('agendamentos').update({ [campo]: agoraIso }).eq('id', f.id);
  };

  for (const f of fichas) {
    if (toques >= MAX_TOQUES_POR_TICK) break;
    const tel = String(f.cliente_telefone || '').replace(/\D/g, '');
    if (!tel || !f.quando) continue;

    const minutos = (new Date(f.quando).getTime() - agora) / 60_000;

    // ── 5 minutos antes ───────────────────────────────────────────────────────
    // Primeiro na fila: é o toque com hora marcada de verdade. O bom dia tem duas
    // horas de janela e pode esperar o próximo tick; este, não.
    if (!f.lembrete_5min_at && minutos <= MIN_5MIN.ate && minutos >= MIN_5MIN.de) {
      if (cincoMin >= CINCO_POR_TICK) continue;
      // Só pra quem NÃO respondeu o bom dia (ordem do Thiago, 11/09). Quem
      // respondeu está em conversa, a Giovanna já foi avisada, e a frase seria a
      // mesma que a pessoa acabou de responder. Não carimba nada: se o lead
      // falou, ele simplesmente não recebe este toque, hoje nem depois.
      if (cegoParaRespostas) continue;
      const k = telKey(f.cliente_telefone);
      const ultimaDele = k ? falou!.get(k) : undefined;
      if (f.bomdia_at && ultimaDele && ultimaDele > String(f.bomdia_at)) {
        jaResponderam++;
        continue;
      }
      if (!dry && !(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora: TETO_HORA, pisoDia: TETO_DIA }))) {
        segurados++;
        continue;
      }
      try {
        await entregar(f, '5min', tel, BOLHA_CINCO_MIN, 'lembrete_5min_at');
        cincoMin++; toques++;
      } catch (e) {
        logger.error('solar-giovanna', 'falha no toque de 5 min', { id: f.id, erro: String(e) });
        erros++;
      }
      continue;
    }

    // ── Bom dia das 7h ────────────────────────────────────────────────────────
    if (naJanelaDaManha && !f.bomdia_at && minutos >= MANHA_ANTECEDENCIA_MIN) {
      if (bomDia >= MANHA_POR_TICK) continue;
      if (!dry && !(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora: TETO_HORA, pisoDia: TETO_DIA }))) {
        segurados++;
        continue;
      }
      try {
        await entregar(f, 'bom_dia', tel, BOLHA_BOM_DIA, 'bomdia_at');
        bomDia++; toques++;
      } catch (e) {
        logger.error('solar-giovanna', 'falha no bom dia', { id: f.id, erro: String(e) });
        erros++;
      }
    }
  }

  if (segurados) {
    logger.info('solar-giovanna', `${segurados} toque(s) segurados pelo teto da linha — esperam o próximo tick`);
  }
  if (jaResponderam) {
    logger.info('solar-giovanna', `${jaResponderam} não levaram o toque de 5 min: responderam o bom dia`);
  }
  if (bomDia || cincoMin) {
    logger.info('solar-giovanna', `${bomDia} bom dia e ${cincoMin} toque(s) de 5 min`);
  }

  return {
    ok: true,
    candidatos: fichas.length,
    bom_dia: bomDia,
    cinco_min: cincoMin,
    ja_responderam: jaResponderam,
    segurados_pelo_teto: segurados,
    erros,
    ...(dry ? { previa } : {}),
  };
}
