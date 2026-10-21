// Constantes do recibo de cadastro do solar que mais de um robô precisa ler. Módulo PURO: nenhum import, nada de banco nem de
// envio. Moram aqui para o agendaEnvio.ts (que fala pela agente) conferir o mesmo status e gravar o mesmo marcador do
// solarBoasVindas.ts sem importar o envio dele para dentro da agente (nem o contrário).

/**
 * Quem NÃO recebe o recibo do cadastro.
 *
 * O filtro era `status = 'agendado'`, e essa é a causa nº 1 de 87 pessoas não
 * terem recebido nada em 30 dias: a ficha sai de "agendado" em MINUTOS (a triagem
 * é rápida) e some da fila pra sempre. Das 99 do Meta, 71 já não eram elegíveis
 * quando o tick olhou — 40 delas em `sem_interesse`.
 *
 * Invertido: em vez de listar quem pode, lista quem não pode.
 *   · cancelado / sem_interesse — a pessoa disse não. Recibo aqui é insistência.
 *   · fez_orcamento — já recebeu proposta. "Antes de te chamar, a gente monta o
 *     estudo" viraria mentira na cara de quem já viu o estudo.
 *   · perdido / fechou / fechou_concorrente: a conversa já terminou, pra um lado ou
 *     pro outro. "Este é o seu pré-atendimento" pra quem já fechou, com a gente ou
 *     com outro, é mensagem fora de hora. Entraram em 14/09/2026, quando a ficha
 *     995, marcada como perdido, voltou a contar no alarme de perdidos.
 * O resto (agendado, em_atendimento, nao_atendeu) RECEBE: são justamente os casos
 * em que a conversa ainda não aconteceu — e `nao_atendeu` é literalmente quem o
 * consultor tentou ligar e não alcançou.
 */
/* `apalavrado` entrou em 30/09/2026 com a sala de espera: é quem já disse SIM e
 * está esperando uma peça de fora (o investidor, o terreno, a assinatura).
 * Ordem do Thiago no dia: "ela é uma pessoa que não fica recebendo mais
 * mensagem". Mandar "este é o seu pré-atendimento" pra quem já apertou a mão é
 * a mensagem mais fora de hora da lista inteira. */
export const STATUS_QUE_NAO_RECEBEM = ['cancelado', 'sem_interesse', 'fez_orcamento', 'perdido', 'fechou', 'fechou_concorrente', 'apalavrado'];

/** Marcador de "não mandei porque este telefone já recebeu" ou "a reserva da abertura foi descartada de propósito". Fica fora dos
 *  prefixos do teto da linha (nada saiu) e é o que a varredura de reservas usa pra não confundir com envio interrompido. */
export const SOLAR_BV_DEDUP_PREFIX = 'solar_bv_dedup:';
