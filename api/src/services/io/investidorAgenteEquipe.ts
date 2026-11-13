// ─────────────────────────────────────────────────────────────────────────────
// QUEM ESCREVEU A ÚLTIMA LINHA DO HISTÓRICO DO CARD (12/11/2026). PURO.
//
// O `historico` do card é texto corrido, e TODO escritor põe a linha nova NO TOPO, separada por uma linha
// em branco (agenda/index.html: nota, status, reagendamento à mão e pós-venda; eletropostoAgenda,
// eletropostoReagendaAuto, eletropostoCobraSim, reagendaSolarNaoAtendido, investidorAgenteCard e
// `processar_repasses()` no banco). Então a linha mais RECENTE é a PRIMEIRA do texto.
//
// Dois formatos de carimbo:
//   · robô:   `[dd/mm · hh:mm · Sistema] ...`
//   · pessoa: `[dd/mm hhHmm · Nome] ...`
// Nos dois o autor é o último pedaço do carimbo, depois do último " · ".
//
// Usado pela regra "reunião marcada por gente da equipe é reunião viva" (investidorAgentePuro.cardReabre).
// ─────────────────────────────────────────────────────────────────────────────

/** Autores que NÃO são gente: robôs que gravam no histórico. Em dúvida o autor conta como pessoa: o erro do lado
 *  de lá é a Helena abordar a frio quem tem reunião marcada à mão, e o erro deste lado é só deixar o card fora da fila. */
const AUTORES_ROBO: ReadonlySet<string> = new Set(['sistema', 'helena', 'estudo', 'duda', 'carla', 'ia', 'robo', 'agente']);

const semAcento = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** O autor da linha mais recente (a primeira do texto), ou null se ela não tem carimbo `[... · Autor]`. */
export function autorDaUltimaLinha(historico: unknown): string | null {
  const primeira = String(historico ?? '').split('\n').map(l => l.trim()).find(Boolean);
  if (!primeira) return null;
  const m = /^\[([^\]]+)\]/.exec(primeira);
  if (!m) return null;
  const partes = m[1]!.split('·').map(p => p.trim()).filter(Boolean);
  // Carimbo sem separador não traz autor.
  return partes.length >= 2 ? partes[partes.length - 1]! : null;
}

/** A linha mais recente do histórico foi escrita por PESSOA da equipe (não por Sistema, Helena nem outro robô)? */
export function ultimaLinhaEhDePessoa(historico: unknown): boolean {
  const autor = autorDaUltimaLinha(historico);
  return autor !== null && !AUTORES_ROBO.has(semAcento(autor));
}
