// ─────────────────────────────────────────────────────────────────────────────
// OS PORTÕES DA OBRA SOLAR NO CRON DA FILA DAS 08:00 (19/11/2026). Compra, Logística, Obra e Entrega abrem a etapa seguinte pelo dado, mas só uma gravação (ou o
// anexo de um arquivo) registra isso. A obra que cumpriu o portão e ninguém salvou depois ficaria, para a fila e para a escalada, na etapa velha: o aviso iria
// para o dono errado. Antes de montar a fila, este passo registra o que já vale, SEMPRE com o autor `leitura`: o estado é gravado, mas o robô "É sua" ignora
// esse autor (nunca avisa por ele). Só grava quando muda algo e nunca usa nome de gente. Não envia nada. Falha de uma obra só tira ela da sincronia (só o código no log).
// ─────────────────────────────────────────────────────────────────────────────
import { etapaAtualCompleta } from '../gerador/jornadaObra';
import { lerObraPrivada, mudarObra, obraVazia } from '../gerador/jornadaObraBanco';
import { lerDocsComVersao } from '../gerador/docsClienteBanco';
import { aplicarPortoes } from '../gerador/obraPortoes';
import { ehRecusa, type Recusa } from '../gerador/jornadaSolarBanco';
import type { ObraFila } from './jornadaMensagensPuro';

const AUTOR_SILENCIOSO = 'leitura';

/** Registra os portões de UMA obra. Devolve o estado novo, ou o mesmo quando nada mudou. */
async function sincronizarUma(o: ObraFila, agora: string): Promise<ObraFila> {
  if (!o.jo || o.jo.fechada || o.cancelada) return o;
  const n = etapaAtualCompleta(o.js, o.jo, null);
  if (n === null || n < 4 || n > 7) return o;
  const [privada, { reg }] = await Promise.all([lerObraPrivada(o.card), lerDocsComVersao('vendasolar', String(o.card))]);
  if (!privada) return o;
  const slots = new Map<string, string[]>();
  for (const a of reg.arquivos) slots.set(a.slot, [...(slots.get(a.slot) ?? []), a.id]);
  const docsIds = new Set(reg.arquivos.map((a) => a.id));
  const r = await mudarObra(o.card, () => obraVazia(o.card), (e) => {
    const novo = aplicarPortoes(e, { privada, docsIds, slots }, agora, AUTOR_SILENCIOSO);
    return novo === e ? ({ recusa: 'nada', http: 200 } as Recusa) : novo;
  });
  return ehRecusa(r) ? o : { ...o, jo: r };
}

/**
 * Sincroniza os portões das obras abertas e devolve a lista com o estado já avançado (a fila e a escalada leem esta). Nunca lança: a obra que falha segue com
 * o estado que tinha. Em lotes de 4 (as leituras são do Storage e do banco).
 */
export async function sincronizarPortoesDaFila(obras: readonly ObraFila[], agora: Date): Promise<ObraFila[]> {
  const iso = agora.toISOString();
  const saida: ObraFila[] = [];
  for (let i = 0; i < obras.length; i += 4) {
    const lote = await Promise.all(obras.slice(i, i + 4).map((o) => sincronizarUma(o, iso).catch((err): ObraFila => {
      console.error('[jornada-msg] portoes', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
      return o;
    })));
    saida.push(...lote);
  }
  return saida;
}
