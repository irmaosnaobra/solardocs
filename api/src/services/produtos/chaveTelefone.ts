// O telefone de uma pessoa aparece no banco de vários jeitos: 34999990000, 5534999990000, sem o nono dígito,
// com "+". A chave do projeto é DDD + os 8 últimos dígitos (chaveDoContato), e variantesDaChave devolve as
// formas em que ela costuma estar gravada. Casar conta de compra por telefone usa estas duas, as mesmas da
// caixa do WhatsApp, da pausa humana e do quiz do SolarDoc, e não uma terceira regra.

import { chaveDoContato } from '../chefe/destinos';
import { variantesDaChave } from '../gerador/caixaWhatsapp';

/**
 * Todas as formas em que este telefone pode estar gravado numa coluna de texto (users.whatsapp,
 * limpapro_membros.telefone). Vazio quando não dá para tirar uma chave segura (curto demais, grupo, lixo):
 * quem chama então não procura, em vez de procurar por um número que não é de ninguém.
 */
export function variantesDoTelefone(telefone: string | null | undefined): string[] {
  const chave = chaveDoContato(telefone);
  if (!chave) return [];
  const base = variantesDaChave(chave);
  // Algumas linhas guardam o número com "+" na frente (+5534999990000).
  return [...base, ...base.filter((v) => v.startsWith('55')).map((v) => `+${v}`)];
}
