import { ehAdm } from '../services/gerador/solarObras';
import { sincronizarPortoes } from '../services/gerador/obraSincronia';
import { lerFase2 } from './geradorJornadaObra';
import type { GuardaObra } from './geradorJornadaGuarda';
import type { Ctx } from './geradorClientesDocs';

/**
 * O gancho do UPLOAD: um arquivo recém-registrado (foto da entrega, termo assinado, foto da carga ou do diário) pode ter fechado um portão. Confere os portões com
 * a mesma regra de autor em dois tempos: a obra COMO ESTAVA sem o arquivo novo avança em silêncio (`leitura`); o que o arquivo fechou leva o nome de quem subiu.
 * Quem chama trata falha como log: o arquivo já está salvo e o portão é conferido de novo na próxima gravação. Sem estado gravado, não faz nada (nunca materializa).
 */
export async function sincronizarAposAnexo(ctx: Ctx, novoId: string): Promise<void> {
  if (!ctx.card) return;
  const g: GuardaObra = { nome: ctx.nome, socio: ctx.socio, adm: ehAdm(ctx.nome), card: ctx.card, id: Number(ctx.codigo), ctx };
  const f = await lerFase2(g);
  if (f.din.cancelada || f.din.fechada || !f.jo) return;
  const docsIds = new Set(f.docsIds);
  docsIds.delete(novoId);
  const slots = new Map([...f.slotsMap].map(([k, v]) => [k, v.filter((i) => i !== novoId)] as [string, string[]]));
  await sincronizarPortoes(g, f, f.privada, f.privada, { docsIds, slots });
}
