// ─────────────────────────────────────────────────────────────────────────────
// A SONDA DA RECUPERAÇÃO PESADA (16/11/2026): `GET /admin/solardoc/quiz-recuperacao-pesada`. SÓ LÊ: não chama o phone-exists, não toma vez, claim
// nem posse, não cria código no Asaas e nunca envia. Devolve o estado, o lote, a fila de agora (com a avaliação de leitura de cada item) e o porquê de
// cada pessoa do lote ou da régua. Sem nome e sem telefone: só o hmac curto.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { avaliarLead, depsReais, type DepsRec, type RelatorioSonda } from './recuperacaoCarla';
import { lerLargada, pesadaLigada } from './recuperacaoCarlaEstado';
import { PAGTO_VALE_MS } from './recuperacaoCarlaRegras';
import { CHAVE_FILA_REC, LOTE_RESGATE, lerFilaPesada, loteVale, type DecisaoPesada, type ItemPesada } from './recuperacaoPesada';

export interface ItemSondaPesada { hmac8: string; grupo: string; toque: number; pagamento: 'contrato' | 'link' | 'aviso_ao_time'; avaliacao: string; adiado?: boolean }

export interface RelatorioSondaPesada {
  estado: { ligada: boolean; motivo: string };
  pesada: boolean;
  lote: { ativo: boolean; quiz_desde: string; contratos_desde: string; contratos_ate: string; vale_ate: string };
  janela_agora: boolean;
  linha_pausada: string;
  vagas_do_frio: RelatorioSonda['vagas_do_frio'];
  fila_rec: { prontos: number | null; em: string | null } | null;
  resumo: { pessoas: number; por_grupo: Record<string, number>; por_motivo: Record<string, number>; prontas: { lote: number; regua: number; avisos: number } };
  fila_agora: ItemSondaPesada[];
  pessoas: DecisaoPesada[];
  erro?: string;
}

const conta = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };

export async function sondarPesada(
  opts: { agora?: Date; vagas?: () => Promise<RelatorioSonda['vagas_do_frio']> } = {}, deps?: DepsRec,
): Promise<RelatorioSondaPesada> {
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReais();
  const agoraMs = agora.getTime();
  const estado = await d.estado();
  const pausa = await d.linhaPausada(agora);
  let filaRec: RelatorioSondaPesada['fila_rec'] = null;
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_FILA_REC).maybeSingle();
    const v = (data as { value?: { prontos?: unknown; em?: unknown } } | null)?.value;
    if (v) filaRec = { prontos: Number.isFinite(Number(v.prontos)) ? Number(v.prontos) : null, em: typeof v.em === 'string' ? v.em : null };
  } catch { filaRec = null; }
  const rel: RelatorioSondaPesada = {
    estado: { ligada: estado.ligada, motivo: estado.motivo },
    pesada: pesadaLigada(),
    lote: { ativo: loteVale(agoraMs), quiz_desde: LOTE_RESGATE.quizDesde, contratos_desde: LOTE_RESGATE.contratosDesde, contratos_ate: LOTE_RESGATE.contratosAte, vale_ate: LOTE_RESGATE.valeAte },
    janela_agora: d.janela(agora),
    linha_pausada: pausa === 'sim' ? 'sim' : pausa === 'nao' ? 'nao' : 'leitura falhou',
    vagas_do_frio: opts.vagas ? await opts.vagas().catch(() => null) : null,
    fila_rec: filaRec,
    resumo: { pessoas: 0, por_grupo: {}, por_motivo: {}, prontas: { lote: 0, regua: 0, avisos: 0 } },
    fila_agora: [],
    pessoas: [],
  };
  const marcas = d.marcasPagamento ? await d.marcasPagamento(new Date(agoraMs - PAGTO_VALE_MS).toISOString()) : [];
  const decisoes: DecisaoPesada[] = [];
  const fila = await lerFilaPesada(d, agora, (marcas ?? []).filter(m => agoraMs - Date.parse(m.em) <= PAGTO_VALE_MS), decisoes);
  rel.pessoas = decisoes;
  rel.resumo.pessoas = decisoes.length;
  for (const p of decisoes) { conta(rel.resumo.por_grupo, p.grupo); conta(rel.resumo.por_motivo, p.motivo ?? `toque_${p.proximo}`); }
  if (!fila) return { ...rel, erro: 'leitura_da_fila_falhou' };
  rel.resumo.prontas = { lote: fila.lote.length, regua: fila.regua.length, avisos: fila.avisos.length };

  // A avaliação de LEITURA de cada item da fila de agora (compra, posse, conversa, pausa humana, supressão, mudo): o que a rodada veria antes do claim.
  let largada: number | null = null;
  try { largada = await lerLargada(); } catch { largada = null; }
  let vendas: Awaited<ReturnType<DepsRec['vendas']>> | null = null;
  try { vendas = await d.vendas(agoraMs, Date.parse(LOTE_RESGATE.contratosDesde)); } catch { vendas = null; }
  const itens: ItemPesada[] = [...fila.lote, ...fila.avisos, ...fila.regua];
  for (const i of itens) {
    let avaliacao = 'nao_avaliado';
    if (i.soAviso) avaliacao = 'so_aviso_ao_time';
    else if (vendas) {
      const av = await avaliarLead(i.lead, {
        agoraMs, largadaMs: largada, vendas, viaPagamento: true, pesada: true,
        ...(i.prevEm ? { segundoToque: { emMs: Date.parse(i.prevEm), posseEmMs: Date.parse(i.posseEm ?? i.prevEm) } } : {}),
      }, d).catch(() => ({ ok: false as const, motivo: 'leitura_falhou' as const }));
      avaliacao = av.ok ? 'elegivel' : av.motivo;
    }
    rel.fila_agora.push({
      hmac8: i.hmac.slice(0, 8), grupo: i.grupo, toque: i.toque, pagamento: i.soAviso ? 'aviso_ao_time' : i.contratoId ? 'contrato' : 'link', avaliacao,
      ...(i.adiado ? { adiado: true } : {}),
    });
  }
  return rel;
}
