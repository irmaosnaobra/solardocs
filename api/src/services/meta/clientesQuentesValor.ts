// ── DE ONDE VEM O VALOR REAL DA VENDA (03/11/2026) ───────────────────────────
// A parte impura do `valorDaVenda` (clientesQuentesPuro.ts): lê as ligações ASSINADAS card -> `#NNNN` e card -> proposta, e o
// `valor_vendido` das propostas ligadas. Só LEITURA. Nunca lança: qualquer falha devolve fontes vazias e o Purchase sai com o
// ticket de sempre (os eventos nunca podem parar por causa do valor).
//
// Só a ligação assinada (`lerTodasLigacoes`) liga card a código e a proposta: a chave pública do banco escreve em `system_state`,
// e é por isso que o hub assina cada ligação. Nunca se lê `venda_solar:` cru daqui, e nunca se liga nada por telefone ou nome.

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { lerTodasLigacoes } from '../gerador/vendaSolarHub';
import { lerPrivadoJornada } from '../gerador/jornadaSolarBanco';
import { numeroDoCodigoSolar } from './clientesQuentesPuro';

export interface FontesLidas {
  codigosDoCard: Map<number, number[]>;
  valorDaProposta: Map<number, number>;
  valorDaJornada: Map<number, number>;
}

const LOTE = 150; // o `.in()` vai na URL do PostgREST

const LOTE_JORNADA = 5;
/** O valor gravado na obra (centavos -> reais), de 5 em 5 cards. Card que falha fica sem (vale a próxima fonte). Nunca lança. */
async function valoresDaJornada(cardIds: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const ids = [...new Set(cardIds)];
  for (let k = 0; k < ids.length; k += LOTE_JORNADA) {
    await Promise.all(ids.slice(k, k + LOTE_JORNADA).map(async (id) => {
      try {
        const v = (await lerPrivadoJornada(id))?.venda?.valor_centavos;
        if (typeof v === 'number' && Number.isInteger(v) && v > 0) out.set(id, v / 100);
      } catch (e) {
        logger.warn('clientes-quentes', 'valor da obra indisponível para um card', String((e as Error)?.message || e));
      }
    }));
  }
  return out;
}

export async function lerFontesDeValor(cardIds: readonly number[]): Promise<FontesLidas> {
  const valorDaJornada = await valoresDaJornada(cardIds);
  const vazio: FontesLidas = { codigosDoCard: new Map(), valorDaProposta: new Map(), valorDaJornada };
  try {
    const ligs = await lerTodasLigacoes();
    const codigosDoCard = new Map<number, number[]>();
    const usosDaProposta = new Map<string, number>();
    for (const [card, lig] of ligs) {
      const n = numeroDoCodigoSolar(lig.venda);
      if (n != null) codigosDoCard.set(card, [n]);
      const p = String(lig.proposta ?? '').trim();
      if (p) usosDaProposta.set(p, (usosDaProposta.get(p) ?? 0) + 1);
    }
    // Só a proposta ligada a UM card: a mesma proposta em dois cards é dúvida.
    const propostaDoCard = new Map<number, string>();
    for (const id of cardIds) {
      const p = String(ligs.get(id)?.proposta ?? '').trim();
      if (p && usosDaProposta.get(p) === 1) propostaDoCard.set(id, p);
    }
    const valorDaProposta = new Map<number, number>();
    const codigos = [...new Set(propostaDoCard.values())];
    if (codigos.length) {
      const porCodigo = new Map<string, number[]>(); // valores de cada código (mais de uma linha = dúvida)
      for (let k = 0; k < codigos.length; k += LOTE) {
        const { data, error } = await supabaseGerador.from('propostas')
          .select('codigo, vendido, valor_vendido, tipo').in('codigo', codigos.slice(k, k + LOTE));
        if (error) throw new Error(String(error.message || error));
        for (const r of (data ?? []) as Array<{ codigo: string; vendido: boolean | null; valor_vendido: number | null; tipo: string | null }>) {
          const lista = porCodigo.get(String(r.codigo)) ?? [];
          lista.push(r.vendido === true && String(r.tipo ?? 'solar').toLowerCase() !== 'eletroposto' ? Number(r.valor_vendido) : NaN);
          porCodigo.set(String(r.codigo), lista);
        }
      }
      for (const [id, cod] of propostaDoCard) {
        const v = porCodigo.get(cod);
        if (v && v.length === 1 && Number.isFinite(v[0]) && v[0] > 0) valorDaProposta.set(id, v[0]);
      }
    }
    return { codigosDoCard, valorDaProposta, valorDaJornada };
  } catch (e) {
    logger.warn('clientes-quentes', 'fontes do valor da venda indisponíveis, o Purchase sai com o ticket', String((e as Error)?.message || e));
    return vazio;
  }
}
