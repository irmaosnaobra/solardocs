// ───────────────────────────────────────────────────────────────────────────
// RESPOSTAS DO QUIZ DOMINA IA: a distribuição de cada pergunta e a conversão de
// quem escolheu cada opção. Vale a última resposta de cada sessão; nas múltiplas
// (frena, herramientas, tareas) a sessão conta em todas as opções que marcou.
// ───────────────────────────────────────────────────────────────────────────
import { PERGUNTAS_DOMINAIA, ETAPA_OFERTA, type FunilDominaia } from './dominaiaCatalogo';
import type { SessaoDominaia } from './sessoesDominaia';

/** Valor fora da lista (alguém postando lixo no beacon): no máximo 30 por pergunta. */
const MAX_EXTRAS = 30;

const div = (a: number, b: number, casas: number): number => {
  if (b <= 0) return 0;
  const f = 10 ** casas;
  return Math.round((a / b) * f) / f;
};

export function montarRespostas(sessoes: SessaoDominaia[]): FunilDominaia['respostas'] {
  return PERGUNTAS_DOMINAIA.map((p) => {
    const rotulos = new Map<string, string>(p.opcoes);
    const grupos = new Map<string, SessaoDominaia[]>(p.opcoes.map(([v]) => [v, []]));
    let responderam = 0;
    for (const s of sessoes) {
      const valores = s.respostas.get(p.chave);
      if (!valores) continue;
      responderam += 1;
      for (const v of valores) {
        let g = grupos.get(v);
        if (!g) {
          if (grupos.size >= p.opcoes.length + MAX_EXTRAS) continue;
          g = [];
          grupos.set(v, g);
        }
        g.push(s);
      }
    }
    const opcoes = [...grupos]
      .map(([valor, g]) => {
        const compras = g.filter((s) => s.destinos.has('compra')).length;
        return {
          valor, rotulo: rotulos.get(valor) ?? valor, sessoes: g.length,
          pct: div(g.length * 100, responderam, 1),
          chegaramOferta: g.filter((s) => s.nivel >= ETAPA_OFERTA).length,
          compras, conversao: div(compras, g.length, 4),
        };
      });
    return { chave: p.chave, pergunta: p.pergunta, opcoes };
  });
}
