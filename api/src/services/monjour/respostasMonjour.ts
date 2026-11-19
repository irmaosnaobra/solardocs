// ───────────────────────────────────────────────────────────────────────────
// RESPOSTAS DO QUIZ MONJOUR: a distribuição de cada pergunta e a conversão de
// quem escolheu cada opção. Vale a última resposta de cada sessão; na múltipla
// (probado) a sessão conta em todas as opções que marcou.
// ───────────────────────────────────────────────────────────────────────────
import { PERGUNTAS_MONJOUR, ETAPA_OFERTA, type FunilMonjour } from './monjourCatalogo';
import type { SessaoMonjour } from './sessoesMonjour';

/** Valores de uma versão antiga do quiz: só aparecem se alguém respondeu. */
const LEGADOS: Record<string, string[]> = { edad: ['18', '30', '40', '50'] };
/** Valor fora da lista (alguém postando lixo no beacon): no máximo 30 por pergunta. */
const MAX_EXTRAS = 30;

const div = (a: number, b: number, casas: number): number => {
  if (b <= 0) return 0;
  const f = 10 ** casas;
  return Math.round((a / b) * f) / f;
};

export function montarRespostas(sessoes: SessaoMonjour[]): FunilMonjour['respostas'] {
  return PERGUNTAS_MONJOUR.map((p) => {
    const rotulos = new Map<string, string>(p.opcoes);
    const grupos = new Map<string, SessaoMonjour[]>(p.opcoes.map(([v]) => [v, []]));
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
      .filter(([v, g]) => g.length > 0 || !(LEGADOS[p.chave] || []).includes(v))
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
