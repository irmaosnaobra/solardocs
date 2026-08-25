// ─────────────────────────────────────────────────────────────────────────────
// Teto anti-ban ÚNICO da linha física IO (34998165040).
//
// A linha IO é COMPARTILHADA por mais de um agente automático:
//   • Bia (recuperação LimpaPro): prefixos `limpapro_recovery:`, `limpapro_cupom_sent:`,
//     `limpapro_fechamento_sent:` e `limpapro_grupo_sent:` (os 4 toques)
//   • Followup do /gerador (energia solar): prefixo `gerador_followup:`
//
// TODOS esses envios saem pelo MESMO número. Se cada agente tivesse seu próprio teto,
// a linha mandaria N×MAX por hora e tomaria ban — derrubando a receita da Bia JUNTO.
// Por isso o orçamento anti-ban é UM SÓ pra linha inteira: esta função conta os envios
// de TODOS os agentes na última hora (via marcadores em system_state) e diz se ainda há
// folga. Os dois serviços (Bia + gerador) chamam ela antes de cada envio.
//
// IMPORTANTE: ao adicionar um novo agente automático nessa linha, ADICIONE o prefixo de
// "envio efetivado" dele em BOT_SENT_PREFIXES — senão ele fura o teto (foi exatamente o
// bug do cupom: o teto só contava `recovery:` e o cupom passava batido).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { solardocViaIo } from '../zapiClient';

// Cap de segurança por hora na linha física (anti-ban). Compartilhado por todos os bots.
//
// [07/08] Baixado de 12 → 6 e passou a ser env-tunável (LINHA_MAX_HORA), junto com um
// TETO DIÁRIO novo (LINHA_MAX_DIA). O teto horário sozinho autorizava 12×24 = 288
// contatos frios num dia — número que nenhuma linha de empresa sustenta. Motivo do
// corte: a linha caiu/bloqueou 3× em 7 dias e o telefone é o da empresa.
// Lidos a cada chamada de propósito (mesma razão de prefixosDaLinha): instância quente
// não recarrega módulo, e afrouxar o teto sem redeploy é o que salva um dia ruim.
export const maxPorHora = (): number => Number(process.env.LINHA_MAX_HORA || 6);
export const maxPorDia  = (): number => Number(process.env.LINHA_MAX_DIA  || 40);

// RESERVA PRO TRANSACIONAL. O teto do DIA não pode calar uma confirmação de agenda ou
// um boas-vindas de quem acabou de preencher ficha: quem pediu está esperando, e o
// custo de não responder é maior que o risco de ban (a decisão de 04/08 no comentário
// dos prefixos). Frio gasta no máximo 30 dos 40; os 10 últimos ficam guardados pra
// quem levantou a mão. O teto POR HORA vale igual pros dois — é ele que impede rajada.
const RESERVA_TRANSACIONAL = () => Number(process.env.LINHA_RESERVA_TRANSACIONAL || 10);

// Compat: código antigo (painel) importava a constante. Vale o teto base da hora.
export const MAX_POR_HORA = maxPorHora();

// ─── AQUECIMENTO PÓS-RECONEXÃO ───────────────────────────────────────────────
// Linha que acabou de voltar (QR novo / reconexão) é a mais frágil que existe: o
// WhatsApp trata volume alto logo após reconectar como sinal forte de automação.
// Defina LINHA_RECONECTADA_EM=YYYY-MM-DD no dia em que reconectar; por 72h os tetos
// sobem em rampa em vez de já valerem cheios. Passados 3 dias a rampa some sozinha
// (não precisa lembrar de tirar a env).
function rampaDesde(t0: number | null, now: Date): { hora: number; dia: number } | null {
  if (t0 === null || !Number.isFinite(t0)) return null;
  const dias = (now.getTime() - t0) / (24 * 60 * 60 * 1000);
  if (dias < 0) return { hora: 2, dia: 10 };   // env no futuro → trata como dia 0
  if (dias < 1) return { hora: 2, dia: 10 };
  if (dias < 2) return { hora: 3, dia: 20 };
  if (dias < 3) return { hora: 4, dia: 30 };
  return null;                                  // aquecida: tetos cheios
}

function envReconexao(): number | null {
  const raw = process.env.LINHA_RECONECTADA_EM?.trim();
  if (!raw) return null;
  const t = Date.parse(raw.length <= 10 ? `${raw}T00:00:00-03:00` : raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Momento da última reconexão da linha, do jeito AUTOMÁTICO: o `zapiHealthMonitor`
 * carimba `reconectadoEm` toda vez que a IO volta de uma queda. É o que faz a rampa
 * se armar sozinha — a linha cai de dias em dias, e depender de alguém setar uma env
 * à mão a cada queda é depender do esquecimento.
 *
 * Vale o marcador MAIS RECENTE entre o do monitor e a env manual (a env continua
 * servindo pra forçar aquecimento em situação que o monitor não viu, tipo QR novo).
 * Fail-open: erro de leitura → sem rampa (os tetos normais já protegem).
 */
async function inicioDoAquecimento(): Promise<number | null> {
  const env = envReconexao();
  try {
    const { data } = await supabase
      .from('system_state').select('value').eq('key', 'zapi_io_health').maybeSingle();
    const raw = (data?.value as { reconectadoEm?: string | null } | null)?.reconectadoEm;
    const auto = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(auto)) return env === null ? auto : Math.max(auto, env);
  } catch { /* fail-open */ }
  return env;
}

/** Tetos que valem AGORA, com o aquecimento armado pelo monitor (ou pela env). */
export async function tetosVigentesLinha(now: Date = new Date()): Promise<{ hora: number; dia: number }> {
  const r = rampaDesde(await inicioDoAquecimento(), now);
  return r
    ? { hora: Math.min(maxPorHora(), r.hora), dia: Math.min(maxPorDia(), r.dia) }
    : { hora: maxPorHora(), dia: maxPorDia() };
}

/** Versão só-env (sem I/O). Usada onde não dá pra esperar leitura de banco. */
export function tetosVigentes(now: Date = new Date()): { hora: number; dia: number } {
  const r = rampaDesde(envReconexao(), now);
  return r
    ? { hora: Math.min(maxPorHora(), r.hora), dia: Math.min(maxPorDia(), r.dia) }
    : { hora: maxPorHora(), dia: maxPorDia() };
}

// Prefixos de "envio efetivado" (1 chave = 1 mensagem que SAIU). NÃO inclui os `_pending`
// (esses são fila, não envio). O `:` literal no fim casa só o sufixo de enviado:
//   limpapro_recovery:<email>        → opener da Bia enviado
//   limpapro_cupom_sent:<email>      → cupom da Bia enviado
//   limpapro_fechamento_sent:<email> → 3º toque (fechamento) da Bia enviado
//   limpapro_grupo_sent:<email>      → 4º toque (grupo pago) da Bia enviado
//   gerador_followup:<chave>         → toque do followup solar enviado
// (os `_pending` usam `_` no lugar do `:`, então não casam estes LIKE — provado no banco).
const BOT_SENT_PREFIXES = [
  'limpapro_recovery:',
  'limpapro_cupom_sent:',
  'limpapro_fechamento_sent:',
  'limpapro_grupo_sent:',
  'gerador_followup:',
  'gerador_seq:',            // sequências da Central de Automação (drip do Gerador)
  'ep_repescagem_sent:',     // repescagem do eletroposto (quem ficou sem resposta no apagão)
  'ep_convite_sent:',        // convite do grupo garantido (nota 1 que a LP não conseguiu convidar)
  // [04/08] Os dois agentes de ficha estavam FORA do teto por decisão ("é
  // transacional, quem preencheu está esperando") — e foi essa decisão que
  // bloqueou a linha pela 2ª vez. Às 08h BRT de 04/08 a fila de atraso do
  // eletroposto soltou 8 pessoas na mesma hora, 37 mensagens, num teto de 12.
  // Transacional continua saindo na hora; o que passa a ser contado (e barrado)
  // é a DRENAGEM de fila, que é o que vira rajada.
  'ep_agenda_sent:',         // agente de agendamento do eletroposto
  'ep_remarcar_sent:',       // conversa de remarcação do eletroposto (oferta + confirmação)
  'solar_boasvindas_sent:',  // boas-vindas do cadastro de solar
  // [07/08] Estavam FORA do orçamento e gastavam a linha sem aparecer na conta
  // (documentado na queda de 04–06/ago). Cada um tinha janela própria, então não
  // fazia rajada sozinho — mas somado ao resto subcontava o dia inteiro.
  'semente:',                // semente solar (toques da lista fria de solar)
  'ep_grupo_frio:',          // convite de grupo pros frios do eletroposto
  'intersolar_feira_sent:',  // aviso da feira pra quem tinha reunião nos dias fechados
] as const;

// Desvio da linha B2B ligado (ZAPI_SOLARDOC_VIA_IO=1)? Então Giovanna, curso de
// R$19 e cobrança de Pix estão saindo POR AQUI e entram no MESMO orçamento —
// senão a linha manda 12/h desta lista + 4/h da Carla e leva ban de novo. Os três
// carimbam `carla_sent:<user>` (carlaThrottle.marcarEnvioCarla), então uma chave só
// cobre os três. Lido a cada chamada de propósito: a env var muda sem redeploy do
// módulo em memória.
function prefixosDaLinha(): string[] {
  return solardocViaIo() ? [...BOT_SENT_PREFIXES, 'carla_sent:'] : [...BOT_SENT_PREFIXES];
}

/**
 * Há folga no teto anti-ban da linha na última hora? Conta os envios de TODOS os bots.
 * `true` = pode enviar; `false` = estourou, segura pro próximo tick.
 */
export async function dentroDoTetoHorarioLinha(
  opts: { transacional?: boolean } = {},
): Promise<boolean> {
  const tetos = await tetosVigentesLinha();
  // Frio não encosta na reserva; transacional usa o dia inteiro.
  const tetoDia = opts.transacional
    ? tetos.dia
    : Math.max(1, tetos.dia - Math.min(RESERVA_TRANSACIONAL(), tetos.dia - 1));
  const orFilter = prefixosDaLinha().map(p => `key.like.${p}%`).join(',');

  const contar = async (janelaMs: number, teto: number): Promise<number> => {
    const desde = new Date(Date.now() - janelaMs).toISOString();
    const { data } = await supabase
      .from('system_state').select('key')
      .or(orFilter)
      .gte('updated_at', desde)
      .limit(teto + 1);
    return data?.length ?? 0;
  };

  if (await contar(60 * 60 * 1000, tetos.hora) >= tetos.hora) return false;
  // Teto do DIA (24h corridas). Sem ele, 6/h autorizava 144 contatos frios num dia.
  return (await contar(24 * 60 * 60 * 1000, tetoDia)) < tetoDia;
}

// ─── JANELA DIURNA — mensagem fria não sai de madrugada ──────────────────────
// O teto de 12/h sozinho não impede o pior padrão de ban: mensagem de VENDA, fria,
// caindo às 2 da manhã. Quem acorda com isso não responde — bloqueia e denuncia, e
// denúncia é o que derruba a linha (o teto só evita a rajada). O log de 03–05/ago
// tem envio automático às 01h, 02h, 04h, 06h e 07h; foram madrugadas assim entre os
// dois bloqueios. Uma janela só, no MESMO módulo do teto, pra todo bot que compartilha
// o número — quem entrar depois herda os dois.
//
// Fora da janela nada é perdido: os gates são PRÉ-claim, então o marcador sobrevive e
// a fila drena de manhã. Kill-switch: JANELA_DIURNA_OFF=1 (volta ao 24/7 sem deploy).
// [07/08] Fechada de 08–21h pra 09–20h: 8h da manhã e 20h30 ainda pegam gente dormindo
// ou jantando, e é bloqueio/denúncia que derruba a linha, não o volume em si.
const JANELA_INICIO_H = Number(process.env.JANELA_INICIO_H || 9);
const JANELA_FIM_H    = Number(process.env.JANELA_FIM_H    || 20);

/** É horário civil pra mensagem fria AGORA (08h–21h BRT)? Vale pra linha inteira. */
export function dentroDaJanelaDiurna(now: Date = new Date()): boolean {
  if (process.env.JANELA_DIURNA_OFF === '1') return true;
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // BRT = UTC-3 (sem horário de verão)
  // Domingo é o dia com maior taxa de denúncia pra mensagem comercial não pedida —
  // ninguém espera vendedor no domingo. Liberar: JANELA_DOMINGO_ON=1.
  if (brt.getUTCDay() === 0 && process.env.JANELA_DOMINGO_ON !== '1') return false;
  const h = brt.getUTCHours();
  return h >= JANELA_INICIO_H && h < JANELA_FIM_H;
}

// ─── ESPAÇAMENTO MÍNIMO — nada sai a menos de 5 min do envio anterior ────────
// Ordem do Thiago (06/ago/2026): "manda nada sem margem de 5 minutos".
//
// O teto de 12/h autoriza as 12 no MESMO minuto — e é assim que a rajada nasce.
// Provas: 04/ago 08h, a fila do eletroposto soltou 8 pessoas / 37 mensagens numa
// hora só; 06/ago 01h13, curso19 + Carla mandaram 4 em 37 SEGUNDOS (o loop tinha
// gap de 4s). Pro WhatsApp, 4 mensagens em 37s pra 4 desconhecidos é assinatura de
// robô; 4 espaçadas em 20 min é gente trabalhando.
//
// A régua é o marcador de envio mais recente da linha — mesma fonte de verdade do
// teto, sem escrita nova. 5 min também casa com o teto: 12/h é exatamente 1 a cada
// 5 min, então o espaçamento vira a forma NATURAL de gastar o orçamento da hora.
//
// Todo gate é PRÉ-claim: quem não passa espera o próximo tick (o /process-messages
// roda de 5 em 5 min, então a fila anda no mesmo ritmo). Kill: ESPACAMENTO_OFF=1.
// [07/08] 5 → 10 min de base, MAIS um jitter de até 5 min sorteado a cada checagem.
// Régua fixa é padrão detectável: um envio a cada 5:00 min, hora após hora, é assinatura
// de robô tão clara quanto a rajada. Com jitter os intervalos ficam 10–15 min, irregulares,
// e o dia inteiro cabe no teto diário sem precisar de fila parada.
// [25/08] Ordem do Thiago: 6 min até a Intersolar acabar. A 10 min a fila da feira
// andava a ~2,2/h e só fecharia na sexta — depois do evento. A 6 min ela fecha na
// quarta, ainda com a feira de pé.
//
// A DATA está aqui de propósito, e não numa env var na Vercel: campanha com prazo
// que afrouxa o anti-ban tem que voltar sozinha, senão a linha fica 6 min pra sempre
// e ninguém lembra por quê. Mesma ideia da rampa de reconexão, que também expira só.
// Passado o dia 28 volta pros 10 min sem ninguém precisar fazer nada.
//
// O que NÃO muda: o teto por hora (6) e o teto do dia. São eles que impedem rajada;
// isto aqui só encurta a espera entre um envio e o seguinte.
const APERTO_INTERSOLAR_ATE = Date.parse('2026-08-28T00:00:00-03:00');
const espacamentoBaseMs = (): number => {
  const daEnv = Number(process.env.ESPACAMENTO_MIN_MS || 0);
  if (daEnv > 0) return daEnv;                       // env manda, como sempre mandou
  return Date.now() < APERTO_INTERSOLAR_ATE ? 6 * 60 * 1000 : 10 * 60 * 1000;
};

// Compat: quem importava a constante continua lendo o valor vigente no arranque.
export const ESPACAMENTO_MIN_MS = espacamentoBaseMs();
const ESPACAMENTO_JITTER_MS     = Number(process.env.ESPACAMENTO_JITTER_MS || 5 * 60 * 1000);

/**
 * Passou tempo suficiente desde o último envio automático desta linha?
 * Pergunta na forma "houve QUALQUER envio na última janela?" — mesma forma do teto
 * horário (janela + limit), sem depender de ordenação.
 */
export async function respeitaEspacamentoLinha(prefixos = prefixosDaLinha()): Promise<boolean> {
  if (process.env.ESPACAMENTO_OFF === '1') return true;
  // Lido a cada chamada (não da constante): instância quente não recarrega módulo, e
  // sem isto o aperto não expiraria até o próximo deploy.
  const alvo = espacamentoBaseMs() + Math.floor(Math.random() * ESPACAMENTO_JITTER_MS);
  const desde = new Date(Date.now() - alvo).toISOString();
  const { data } = await supabase
    .from('system_state').select('key')
    .or(prefixos.map(p => `key.like.${p}%`).join(','))
    .gte('updated_at', desde)
    .limit(1);
  return (data?.length ?? 0) === 0;               // nada nos últimos 5 min → pode ir
}
