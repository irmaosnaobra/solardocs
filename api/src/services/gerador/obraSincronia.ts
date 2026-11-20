// ─────────────────────────────────────────────────────────────────────────────
// O REGISTRO DOS PORTÕES DA OBRA SOLAR (19/11/2026). Compra, Logística, Obra e Entrega abrem a etapa seguinte pelo dado, sem botão: este arquivo grava
// `concluida_em` e a abertura (UMA vez, com o histórico que os robôs leem) quando o portão vale. Idempotente: sem mudança não grava nada. Só anda para a frente.
// Dois autores: o nome de quem salvou (o que ESTA gravação fechou; é o que o robô "É sua" lê) e `leitura` (o que já valia antes: silencioso, sem aviso).
// Sem rota aqui: quem lê a obra (a rota, o anexo, o cron das 08:00) entrega os dados já lidos.
// ─────────────────────────────────────────────────────────────────────────────
import { aplicarPortoes } from './obraPortoes';
import type { ObraPrivada } from './jornadaObra';
import { mudarObra, obraVazia } from './jornadaObraBanco';
import type { Recusa } from './jornadaSolarBanco';

/** O que a gravação precisa saber dos arquivos da obra e do `obra.json` de antes (a `Fase2` da rota já tem esta forma). */
export interface FonteDaSincronia { privada: ObraPrivada; docsIds: ReadonlySet<string>; slotsMap: ReadonlyMap<string, readonly string[]> }

/**
 * Registra os portões que valem (Compra, Logística, Obra e Entrega). `privada`: o `obra.json` recém-gravado; os arquivos vêm da leitura da rota.
 * `antes`: o `obra.json` de ANTES desta gravação (o que ele já cumpria avança em silêncio, com o autor `leitura`).
 */
export async function sincronizarPortoes(
  g: { id: number; nome: string }, f: FonteDaSincronia, privada: ObraPrivada, antes: ObraPrivada = f.privada,
  docsAntes?: { docsIds: ReadonlySet<string>; slots: ReadonlyMap<string, readonly string[]> },
): Promise<void> {
  const agora = new Date().toISOString();
  await mudarObra(g.id, () => obraVazia(g.id), (e) => {
    // Em dois tempos: o que a obra de ANTES desta gravação já cumpria avança em silêncio (autor `leitura`, que não dispara aviso de gente: obra antiga não
    // manda "É sua" atrasado); só o que ESTA gravação fechou leva o nome de quem salvou.
    const silencioso = aplicarPortoes(e, { privada: antes, docsIds: docsAntes?.docsIds ?? f.docsIds, slots: docsAntes?.slots ?? f.slotsMap }, agora, 'leitura');
    const novo = aplicarPortoes(silencioso, { privada, docsIds: f.docsIds, slots: f.slotsMap }, agora, g.nome);
    return novo === e ? ({ recusa: 'nada', http: 200 } as Recusa) : novo;
  });
}
