// ─────────────────────────────────────────────────────────────────────────────
// PORTÃO DO INVESTIDOR SEM FORMA DE PAGAMENTO, só como leitura no servidor.
//
// O desenho do estudo do local (15/09/2026) propôs cortar da agenda o Investidor
// que responde "Ainda não sei como vou pagar": 63% deles faltaram. O corte NÃO foi
// aprovado e a LP não mudou. Este arquivo só responde se a ficha CAIRIA nessa regra,
// e o estudo grava a resposta em `dados.portao`. Nada aqui tira ninguém da agenda.
//
// Medido no replay das fichas de 02/08 a 15/09: a regra cortaria 9 reuniões, 1
// delas com orçamento feito; desde 29/08, nenhuma.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ficha } from './eletropostoEstudoPuro';

export type RegraPortao = 'investidor_sem_capital';

export function avaliarPortao(f: Pick<Ficha, 'perfil' | 'invest'>): { cortaria: boolean; regra: RegraPortao | null } {
  const cortaria = f.perfil === 'investidor' && f.invest === 'naosei';
  return { cortaria, regra: cortaria ? 'investidor_sem_capital' : null };
}
