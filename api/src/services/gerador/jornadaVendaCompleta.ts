// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): marca no histórico assinado que o bloco VENDA da etapa 1 ficou completo (a `acao: 'venda_completa'`).
// É o gatilho do aviso de venda à equipe (7.1). Serviço, para as rotas que mexem no bloco (valor, kit, prazo, proposta ligada) chamarem sem
// importar uma da outra. NUNCA lança: erro só vira log (`venda_completa` + código). Venda sem estado (deduzida) não faz nada e não materializa.
// ─────────────────────────────────────────────────────────────────────────────
import { lerLigacao } from './vendaSolarHub';
import { blocoVendaCompleto } from './jornadaSolar';
import { lerJornadaComVersao, lerPrivadoJornada, mudarJornada } from './jornadaSolarBanco';

export async function marcarVendaCompleta(card: number, por: string): Promise<void> {
  try {
    const [{ estado }, { lig }, privado] = await Promise.all([lerJornadaComVersao(card), lerLigacao(card), lerPrivadoJornada(card)]);
    const pendente = (e: NonNullable<typeof estado>): boolean =>
      e.origem === 'vendido' && !e.cancelada && !e.etapas[1].concluida_em && !e.historico.some((h) => h.acao === 'venda_completa');
    if (!estado || !pendente(estado) || !blocoVendaCompleto(lig, privado)) return;
    await mudarJornada(card, () => estado, (e) => (!pendente(e) ? e : {
      ...e, historico: [...e.historico, { em: new Date().toISOString(), por, acao: 'venda_completa' as const, etapa: 1 }].slice(-50),
    }));
  } catch (err) {
    console.error('[jornada-solar] venda_completa', (err as { codigo?: unknown; code?: unknown } | null)?.codigo ?? (err as { code?: unknown } | null)?.code ?? 'interno');
  }
}
