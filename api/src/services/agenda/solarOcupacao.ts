// ─────────────────────────────────────────────────────────────────────────────
// O QUE AS FICHAS DA LP DO SOLAR OCUPAM NA AGENDA (07/10/2026)
//
// Até o quiz, a vistoria valia 60 minutos fixos em três lugares diferentes (a
// vitrine do eletroposto, o formulário do Meta e a régua de vagas dos robôs),
// cada um deduzindo pelo `created_by`. Com a visita contando a estrada, uma
// ficha em Catalão ocupa a manhã inteira do Thiago: se só a página do solar
// soubesse disso, a do eletroposto venderia uma apresentação com ele na BR-050.
//
// Esta é a leitura única. Ela busca só as fichas `lp_solar` (com a cidade e a
// primeira linha da observação, que dizem o caminho) e devolve o bloco de cada
// uma pela régua de solarRota.ts. As outras fichas continuam com a regra de
// quem chama, que já funcionava.
//
// A janela é alargada pela MARGEM_LEITURA_MS nas duas pontas: a visita marcada
// às 10:00 começa às 07:30 quando a estrada é longa, então uma ficha fora da
// janela pedida pode ocupar tempo dentro dela.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { FILTRO_NAO_OCUPA } from './salaDeEspera';
import { MARGEM_LEITURA_MS, ocupacaoDaFichaSolar } from './solarRota';

export interface OcupacaoSolar { dono: string; quando: number; ini: number; fim: number }

/** As fichas `lp_solar` que ocupam algo dentro de [deIso, ateIso]. `null` quer
 *  dizer "não consegui ler", e quem chama decide: as vitrines caem na regra
 *  antiga (60 min), os robôs param de oferecer. Lista vazia é fato. */
export async function ocupacoesSolar(deIso: string, ateIso: string, donos?: readonly string[]): Promise<OcupacaoSolar[] | null> {
  const de = new Date(new Date(deIso).getTime() - MARGEM_LEITURA_MS).toISOString();
  const ate = new Date(new Date(ateIso).getTime() + MARGEM_LEITURA_MS).toISOString();
  try {
    let q = supabaseGerador.from('agendamentos')
      .select('quando, vendedor_nome, created_by, cidade, observacao')
      .eq('created_by', 'lp_solar')
      .gte('quando', de).lte('quando', ate)
      .not('status', 'in', FILTRO_NAO_OCUPA)
      .limit(500);
    if (donos?.length) q = q.in('vendedor_nome', [...donos]);
    const { data, error } = await q;
    if (error) throw error;
    if (!data) throw new Error('resposta sem corpo');
    const lo = new Date(deIso).getTime(), hi = new Date(ateIso).getTime();
    const out: OcupacaoSolar[] = [];
    for (const a of data as Array<Record<string, unknown>>) {
      const b = ocupacaoDaFichaSolar(a as never);
      if (!b || !a.vendedor_nome) continue;
      if (b.fim <= lo || b.ini >= hi) continue;   // o bloco não toca a janela pedida
      out.push({ dono: String(a.vendedor_nome), quando: new Date(String(a.quando)).getTime(), ...b });
    }
    return out;
  } catch (err) {
    logger.error('solar-ocupacao', 'ler as fichas da LP do solar falhou', err);
    return null;
  }
}
