import 'server-only';

import reserva from '../data/snapshot.json';
import type { Base } from './montarCatalogo.ts';

/**
 * As bases do fornecedor, lidas da cópia de reserva.
 *
 * De propósito NÃO passa pelo catálogo ao vivo: endereço de galpão não muda de
 * um dia para o outro, e ler o catálogo aqui faria a cotação de um CEP esperar
 * a releitura dos produtos inteiros no fornecedor. `npm run sync` atualiza esta
 * lista junto com o resto.
 */
export function basesConhecidas(): Base[] {
  return ((reserva as unknown as { bases?: Base[] }).bases ?? []).filter(
    (b) => b.lat !== null && b.lon !== null,
  );
}
