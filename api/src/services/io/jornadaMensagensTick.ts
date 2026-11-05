// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): o TICK das mensagens. Roda DENTRO do `/cron/process-messages` que já existe (sem rota de cron nova),
// depois dos outros ticks e sozinho. Manda no MÁXIMO 1 mensagem por rodada, somando os cinco robôs: a vez é um INSERT `jornada_vez:<minuto par>`
// (o pg_cron e o GitHub Actions chamam em paralelo). Nasce DESLIGADO (`jornada_solar_mensagens`, assinada; `JORNADA_MSG_OFF=1` desliga os cinco).
// Este arquivo NÃO envia: quem envia são `jornadaAvisoEquipe`, `jornadaLiberacao` e `jornadaAniversario`. Nunca lança.
// ─────────────────────────────────────────────────────────────────────────────
import { lerMensagens, ligadosAgora } from '../gerador/jornadaMensagensChave';
import { rodarEventos, rodarFila } from './jornadaAvisoEquipe';
import { rodarLiberacao } from './jornadaLiberacao';
import { rodarAniversarios } from './jornadaAniversario';
import { GRUPOS_MSG, type GrupoMsg } from './jornadaMensagensPuro';
import { faxinaDasVezes, lerTudo, lerUmCard, tomarVez, type CtxMsg, type Leitura, type ResultadoMsg } from './jornadaMensagensBase';

/** `tomar()` toma a vez UMA vez por rodada e lembra o resultado. */
function novaVez(agora: Date): CtxMsg['vez'] {
  let feito: Promise<boolean> | null = null;
  return { tomar: () => (feito ??= tomarVez(agora).then((r) => r === 'tomada')) };
}

export async function runJornadaMensagensTick(agora: Date = new Date()): Promise<Record<string, unknown>> {
  try {
    const { m, valida } = await lerMensagens();
    const ligados = ligadosAgora(valida ? m : { ...m, grupos: Object.fromEntries(GRUPOS_MSG.map((g) => [g, { ...m.grupos[g], ligado: false }])) as typeof m.grupos });
    if (GRUPOS_MSG.every((g) => !ligados[g])) return { motivo: 'desligado' };
    await faxinaDasVezes(agora);
    const c: CtxMsg = {
      agora, ligados, sonda: false, vez: novaVez(agora),
      primeiros: Object.fromEntries(GRUPOS_MSG.map((g) => [g, m.grupos[g].primeiro_ligado_em])) as Partial<Record<GrupoMsg, string | null>>,
    };
    const leitura = await lerTudo();
    if (!leitura) return { motivo: 'leitura_falhou' };
    const saida: Record<string, string> = {};
    const passos: Array<[string, (c: CtxMsg, l: Leitura) => Promise<ResultadoMsg>]> = [
      ['fila', rodarFila], ['eventos', rodarEventos], ['liberacao', rodarLiberacao], ['aniversario', rodarAniversarios],
    ];
    for (const [nome, rodar] of passos) {
      const r = await rodar(c, leitura);
      saida[nome] = r.motivo;
      if (r.parar || r.enviado) break;
    }
    return saida;
  } catch {
    console.error('[jornada-msg] tick', 'excecao');
    return { erro: 'excecao' };
  }
}

/**
 * A sonda: o mesmo caminho dos avisos da equipe, com o transporte FALSO, só no card de teste. Todos os grupos da equipe ligados desde o
 * instante zero; NÃO toma a `jornada_vez` (senão um segundo `rodar` no mesmo minuto par pararia antes de contar `ja_travadas` e a sonda gastaria a
 * vaga da rodada de verdade); trava TODAS as chaves pendentes do card numa chamada; sem fila e sem cliente.
 */
export async function rodarSondaDoCard(card: number, agora: Date = new Date()): Promise<{ travadas: string[]; ja_travadas: number } | null> {
  const leitura = await lerUmCard(card);
  if (!leitura) return null;
  const zero = new Date(0).toISOString();
  const c: CtxMsg = {
    agora, sonda: true, vez: { tomar: async () => true },
    ligados: { venda: zero, etapa: zero, fila: null, liberacao: null, aniversario: null }, primeiros: {},
  };
  const r = await rodarEventos(c, leitura);
  return { travadas: r.travadas ?? [], ja_travadas: r.jaTravadas ?? 0 };
}
