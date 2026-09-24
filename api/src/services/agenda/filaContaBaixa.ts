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

/** Quem recebe lead novo de conta baixa. É o TAMANHO desta lista que define a
 *  proporção; com um nome só, é 100% dele. Para voltar a ter rodízio, acrescente
 *  nomes aqui e volte a girar por contagem, o histórico está no git. */
export const FILA_DEPOIS_DA_SEMANA = ['Nilce'];

/**
 * Quem recebe o PRÓXIMO lead de conta baixa.
 *
 * Continua `async` de propósito, mesmo sem esperar por nada: as três portas já
 * chamam com `await` (o `ioSolar` inclusive dentro de um `Promise.all`), e
 * voltar pra síncrono mudaria a assinatura em três arquivos só pra economizar
 * uma microtask. Quando a fila voltar a ter mais de um nome, ela precisa do
 * banco outra vez e a assinatura já está pronta.
 */
export async function proximoDaContaBaixa(_agora: Date = new Date()): Promise<string> {
  return FILA_DEPOIS_DA_SEMANA[0];
}
