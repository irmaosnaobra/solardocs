import { candidatosDoGrupo } from './divisaoSolar';

// ─────────────────────────────────────────────────────────────────────────────
// A FILA DA CONTA BAIXA — quem recebe o próximo lead abaixo do corte.
//
// ── 23/09/2026: NÃO HÁ MAIS RODÍZIO. É TUDO DA NILCE ────────────────────────
// Ordem do Thiago: "a Nilce recebe TODOS". A Giovanna saiu do rodízio de lead
// novo do solar, de conta baixa e de conta alta. O que ela já tem continua
// dela: a carteira não circula (`dono_fixo` no `processar_repasses`), e cliente
// que volta cai no dono do telefone antes de qualquer regra de tamanho
// (`donoDoTelefone`), então ficha da Giovanna vai continuar aparecendo. O que
// acabou é a Giovanna receber lead NOVO.
//
// O que a Nilce ganhou em troca do rodízio: metade dos leads acima de 1.200 kWh
// (`FILA_CONTA_ALTA` no leadSolarFicha.ts). Ela deixou de ser a dona do lead
// pequeno e virou a dona do funil.
//
// ── POR QUE O MÓDULO CONTINUA EXISTINDO ─────────────────────────────────────
// Fila de uma pessoa só não precisa de módulo, mas precisa de LUGAR. Eram três
// cópias da regra (este módulo, a rota `routes/ioSolar.ts` e o HTML da página) e
// mudar a proporção pedia mexer nas três de uma vez; esquecer uma dava dois
// rodízios discordando. As três portas fazem a pergunta aqui, e enquanto for
// assim a próxima mudança de proporção é uma linha, não três arquivos.
//
// ── O QUE SUMIU, E ISSO É DE PROPÓSITO ──────────────────────────────────────
// A contagem no banco. Ela existia pra saber a FASE do rodízio; com uma dona só
// a resposta não depende de fase nenhuma, e consultar o banco pra responder
// sempre a mesma coisa é latência e um modo de falha (contagem falhava → caía na
// Nilce, que é justamente a resposta) sem nada em troca. `SEMANA_DA_NILCE_ATE` e
// `donaDaContaBaixa(agora, n)` saíram junto: as duas só existiam pra datar e
// posicionar o rodízio.
// ─────────────────────────────────────────────────────────────────────────────

/** A reserva de quando o banco não responde e do freio SOLAR_DIVISAO_OFF=1: só a Nilce. */
export const FILA_DEPOIS_DA_SEMANA = ['Nilce'];

/**
 * Quem recebe o PRÓXIMO lead de conta baixa (abaixo de R$ 800).
 *
 * 23/11/2026: deixou de ser a Nilce sozinha. A divisão por conta de luz (services/agenda/divisaoSolar.ts) aponta quem está mais
 * abaixo da fatia entre a Nilce e a Giovanna (50% cada), pela contagem de cards dos últimos 30 dias. Esta função só devolve o
 * primeiro da lista; quem precisa da lista inteira (para cair no próximo sem horário) chama `candidatosDoGrupo('menor')`.
 * Nunca lança: com o banco fora, vale a ordem da tabela.
 */
export async function proximoDaContaBaixa(_agora: Date = new Date()): Promise<string> {
  return (await candidatosDoGrupo('menor'))[0] ?? FILA_DEPOIS_DA_SEMANA[0];
}
