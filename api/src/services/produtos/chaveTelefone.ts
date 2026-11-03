// O telefone de uma pessoa aparece no banco de vários jeitos: 34999990000, 5534999990000, sem o nono dígito,
// com "+". A chave do projeto é DDD + os 8 últimos dígitos (chaveDoContato), e variantesDaChave devolve as
// formas em que ela costuma estar gravada. Casar conta de compra por telefone usa estas duas, as mesmas da
// caixa do WhatsApp, da pausa humana e do quiz do SolarDoc, e não uma terceira regra.

import { chaveDoContato } from '../chefe/destinos';
import { variantesDaChave } from '../gerador/caixaWhatsapp';

/**
 * O telefone serve de chave para casar COMPRA com conta? Mais exigente que o `chaveDoContato`, que serve à caixa
 * do WhatsApp e não pode ser mexido. users.whatsapp é digitado sem confirmação, então número de mentira
 * (11999999999, 3412345678) viraria chave única de todo comprador que digitasse o mesmo. Recusa:
 *   - 12 ou 13 dígitos que não comecem com 55 (número estrangeiro, que a chave dobraria num DDD brasileiro);
 *   - 11 dígitos sem o 9 do celular depois do DDD (o +1 555 123 4567 dos EUA);
 *   - DDD começado por 0 ou fora de 11 a 99;
 *   - os 8 últimos dígitos com 2 dígitos distintos ou menos;
 *   - os 8 últimos em sequência crescente ou decrescente (12345678, 87654321).
 */
export function telefoneServeDeChave(telefone: string | null | undefined): boolean {
  const d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return false;
  if (d.length >= 12 && !d.startsWith('55')) return false;
  const nacional = d.length >= 12 ? d.slice(2) : d;
  if (nacional.length < 10 || nacional.length > 11) return false;
  if (nacional.length === 11 && nacional[2] !== '9') return false;
  const ddd = Number(nacional.slice(0, 2));
  if (nacional.startsWith('0') || ddd < 11 || ddd > 99) return false;
  const oito = nacional.slice(-8);
  if (new Set(oito).size <= 2) return false;
  const passos = [...oito].slice(1).map((c, i) => Number(c) - Number(oito[i]));
  if (passos.every((x) => x === 1) || passos.every((x) => x === -1)) return false;
  return true;
}

/**
 * Todas as formas em que este telefone pode estar gravado numa coluna de texto (users.whatsapp,
 * limpapro_membros.telefone). Vazio quando não dá para tirar uma chave segura (curto demais, grupo, lixo):
 * quem chama então não procura, em vez de procurar por um número que não é de ninguém.
 */
export function variantesDoTelefone(telefone: string | null | undefined): string[] {
  if (!telefoneServeDeChave(telefone)) return [];
  const chave = chaveDoContato(telefone);
  if (!chave) return [];
  const base = variantesDaChave(chave);
  // Algumas linhas guardam o número com "+" na frente (+5534999990000).
  return [...base, ...base.filter((v) => v.startsWith('55')).map((v) => `+${v}`)];
}
