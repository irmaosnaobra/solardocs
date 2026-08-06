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
export const MAX_POR_HORA = 12;

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
  'solar_boasvindas_sent:',  // boas-vindas do cadastro de solar
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
export async function dentroDoTetoHorarioLinha(): Promise<boolean> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const orFilter = prefixosDaLinha().map(p => `key.like.${p}%`).join(',');
  const { data } = await supabase
    .from('system_state').select('key')
    .or(orFilter)
    .gte('updated_at', desde)
    .limit(MAX_POR_HORA + 1);
  return (data?.length ?? 0) < MAX_POR_HORA;
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
const JANELA_INICIO_H = 8;   // 08:00 BRT — primeira hora aceitável pra mensagem comercial
const JANELA_FIM_H    = 21;  // 21:00 BRT — última (envio às 20h59 vale, às 21h00 não)

/** É horário civil pra mensagem fria AGORA (08h–21h BRT)? Vale pra linha inteira. */
export function dentroDaJanelaDiurna(now: Date = new Date()): boolean {
  if (process.env.JANELA_DIURNA_OFF === '1') return true;
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // BRT = UTC-3 (sem horário de verão)
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
export const ESPACAMENTO_MIN_MS = 5 * 60 * 1000;

/**
 * Passaram-se ≥5 min desde o último envio automático desta linha?
 * Pergunta na forma "houve QUALQUER envio nos últimos 5 min?" — mesma forma do teto
 * horário (janela + limit), sem depender de ordenação.
 */
export async function respeitaEspacamentoLinha(prefixos = prefixosDaLinha()): Promise<boolean> {
  if (process.env.ESPACAMENTO_OFF === '1') return true;
  const desde = new Date(Date.now() - ESPACAMENTO_MIN_MS).toISOString();
  const { data } = await supabase
    .from('system_state').select('key')
    .or(prefixos.map(p => `key.like.${p}%`).join(','))
    .gte('updated_at', desde)
    .limit(1);
  return (data?.length ?? 0) === 0;               // nada nos últimos 5 min → pode ir
}
