// ─────────────────────────────────────────────────────────────────────────────
// A AGENDA LIMPA (12/11/2026): quais cards a tela da Agenda esconde e quais foram marcados pela Helena.
// SÓ LEITURA. Nada de card é apagado nem mudado: o card guarda o histórico e a Helena precisa dele.
//
//   · `ocultos`: os cards de eletroposto das pessoas que a Helena atende AGORA (na fila ou com a conversa aberta) e que
//     ela mesma poderia reabrir. É o MESMO predicado da fila (`cardReabre`, de investidorAgentePuro): nenhum critério
//     novo aqui. Fora, por construção: reunião de verdade (`agendado` que não é do lote), reunião da equipe, card em
//     atendimento, fechado, e as situações `reuniao_marcada` e `com_consultor` (a pessoa já tem reunião ou consultor).
//   · `marcadas`: os cards que a Helena marcou (`created_by = agente_eletroposto`; só as duas Helenas gravam essa origem).
//
// Cache de 60 s e uma leitura por vez, como o acompanhamento: a rota não leva login (igual à `/gerador/apalavrado`) e
// a tela renova de tempos em tempos.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { ORIGEM_AGENTE_EP } from './eletropostoCard';
import { lerCardsDoContato, lerTudo } from './investidorAgente';
import { cardReabre, type CardDoContato } from './investidorAgentePuro';
import { lerAcompanhamento, type ItemAcompanhamento, type Situacao } from './helenaAcompanhamento';

/** Quanto o conjunto fica em memória (o mesmo tempo do acompanhamento). */
const CACHE_MS = 60_000;

/** As situações em que a Helena está com a pessoa: os cards parados dela saem da agenda do consultor. */
export const SITUACOES_QUE_OCULTAM: ReadonlySet<Situacao> = new Set<Situacao>([
  'na_fila', 'abordado', 'em_conversa', 'convidado', 'horarios_enviados', 'sem_resposta', 'sem_interesse', 'parou', 'envio_falhou',
]);

export interface ConjuntoDaAgenda { ocultos: string[]; marcadas: string[] }
export interface AgendaDaHelena extends ConjuntoDaAgenda { gerado_em: string }

const emOrdem = (ids: Iterable<string>): string[] => [...new Set(ids)].sort((a, b) => Number(a) - Number(b));

/** Puro: os ids ocultos. Todos os cards de eletroposto da pessoa que `cardReabre`, pela chave dela. */
export function ocultosDaAgenda(
  itens: ReadonlyArray<Pick<ItemAcompanhamento, 'chave' | 'situacao'>>,
  cards: ReadonlyMap<string, readonly CardDoContato[]>,
  agoraMs: number,
): string[] {
  const ids = new Set<string>();
  for (const it of itens) {
    if (!SITUACOES_QUE_OCULTAM.has(it.situacao)) continue;
    for (const c of cards.get(it.chave) ?? []) {
      if (ehOrigemEletroposto(c.origem) && cardReabre(c, agoraMs)) ids.add(String(c.id));
    }
  }
  return emOrdem(ids);
}

/** Os ids dos cards que a Helena marcou. Erro SOBE (lista incompleta fingiria que ela não marcou). */
async function lerMarcadas(): Promise<string[]> {
  const linhas = await lerTudo<{ id: number }>('cards marcados pela Helena', (de, ate) =>
    supabaseGerador.from('agendamentos').select('id').eq('created_by', ORIGEM_AGENTE_EP).order('id', { ascending: true }).range(de, ate));
  return emOrdem(linhas.map(l => String(l.id)));
}

/** O conjunto, sem cache. A lista de situações vem do acompanhamento (cache de 60 s dele). */
export async function conjuntoDaAgenda(agora: Date = new Date()): Promise<ConjuntoDaAgenda> {
  const [acomp, cards, marcadas] = await Promise.all([lerAcompanhamento(agora), lerCardsDoContato(agora.getTime()), lerMarcadas()]);
  return { ocultos: ocultosDaAgenda(acomp.itens, cards, agora.getTime()), marcadas };
}

let cache: { em: number; dados: AgendaDaHelena } | null = null;
let emVoo: Promise<AgendaDaHelena> | null = null;

export function limparCacheDaAgenda(): void { cache = null; emVoo = null; }

/** O que a rota devolve: o conjunto com cache de 60 s e uma leitura por vez. Erro SOBE (a rota vira 503). */
export async function lerAgendaDaHelena(agora: Date = new Date()): Promise<AgendaDaHelena> {
  const t = agora.getTime();
  if (cache && t - cache.em < CACHE_MS && t >= cache.em) return cache.dados;
  if (emVoo) return emVoo;
  emVoo = conjuntoDaAgenda(agora)
    .then(c => { const dados = { ...c, gerado_em: agora.toISOString() }; cache = { em: t, dados }; return dados; })
    .finally(() => { emVoo = null; });
  return emVoo;
}
