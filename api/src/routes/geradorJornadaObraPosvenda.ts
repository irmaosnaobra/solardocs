import type { Fase2 } from './geradorJornadaObra';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { posvendaInfo } from '../services/gerador/jornadaPosVendaObra';
import type { ContratoObra } from '../services/gerador/jornadaObra';

// ─────────────────────────────────────────────────────────────────────────────
// O `posvenda_info` do GET da obra solar (datas, geração esperada, garantias e os 3 textos prontos). Vive à parte de `geradorJornadaObra.ts` (que não pode
// crescer); só TIPOS vêm de lá (sem ciclo de boot). Nada aqui é valor de venda.
// ─────────────────────────────────────────────────────────────────────────────

/** O dia (Brasília) em que a usina foi liberada: a conclusão da etapa 8. Obra antiga materializada só vale se o passo "liberada" tem data. */
function liberadaEmDe(f: Fase2): string | null {
  const e8 = f.joView?.etapas[8];
  if (!e8?.concluida_em) return null;
  const doPasso = f.privada.liberacao.passos.liberada?.data ?? '';
  const passoOk = /^\d{4}-\d{2}-\d{2}$/.test(doPasso);
  if (e8.concluida_por === 'leitura') return passoOk ? doPasso : null;
  return diaDeBrasilia(e8.concluida_em);
}

/** O `posvenda_info` do GET. `c`: o contrato com as garantias; `nomeDoCliente`: o nome do cadastro (ou do card). */
export function posvendaDaObra(f: Fase2, c: ContratoObra, nomeDoCliente: string) {
  const itens = f.privada.compra.itens;
  const mod = itens.find((i) => i.tipo === 'modulo' && (i.garantia_fabricacao_anos || i.garantia_desempenho_anos));
  const inv = itens.find((i) => i.tipo === 'inversor' && i.garantia_anos);
  const t = f.privada.entrega.termo;
  const dados = f.proposta?.dados ?? {};
  return posvendaInfo({
    liberadaEm: liberadaEmDe(f), entregaEm: t?.assinado_em ? diaDeBrasilia(t.assinado_em) : null,
    registradaEm: f.privada.entrega.garantias.registrada_em, treinado: f.privada.entrega.garantias.treinado,
    modulosAnos: c.garantia_modulos_anos || mod?.garantia_fabricacao_anos, desempenhoModulosAnos: mod?.garantia_desempenho_anos,
    inversorAnos: c.garantia_inversor_anos || inv?.garantia_anos,
    instalacaoValor: c.garantia_instalacao_anos, instalacaoUnidade: c.garantia_instalacao_unidade,
    esperadoKwhMes: dados.mediaMensalGerada, nomeDoCliente,
    linkAvaliacao: f.din.ajustes.link_avaliacao_google ?? '',
  });
}
