// ─────────────────────────────────────────────────────────────────────────────
// O META APRENDE O PERFIL DO CLIENTE BOM, conta acima de 762 kWh que orçou.
//
// Pedido do dono (14/08/2026). Hoje o único sinal que volta pro Meta é o
// `capiLeadsService`: contrato FECHADO, lido de uma planilha. O sinal é certo e é
// raro demais — 5 fechamentos em 90 dias. O algoritmo do Meta aprende por
// repetição; com 5 eventos em três meses ele não aprende nada, e a campanha
// continua otimizando pra "quem preenche formulário", que é o que ela mediu.
//
// Este loop manda o sinal do MEIO do funil, que é o que existe em volume:
//
//     conta acima de 762 kWh/mês  +  o consultor chegou a fazer orçamento
//
// Era a mesma régua que dividia a agenda, e em 23/09/2026 deixou de ser: o corte
// do roteamento subiu pra 1.200 kWh e este ficou onde estava, de propósito, ver
// KWH_LEAD_BOM logo abaixo. Volume medido em 90 dias neste corte: ~13 eventos,
// contra 5 de contrato fechado.
//
// ── O que ele NÃO faz ──
//   • Não substitui o `Converted` do contrato fechado. São dois estágios do mesmo
//     funil e o Meta usa os dois; este só chega antes e com mais frequência.
//   • Não inventa qualidade: quem não respondeu o consumo fica de fora. Sem
//     resposta não é lead bom nem ruim, é lead sem informação — e ensinar o Meta
//     com achismo é pior que não ensinar.
//   • Não manda duas vezes: dedup por (lead_id, event_name) na mesma tabela do
//     outro loop, e `event_id` estável pro Meta deduplicar do lado dele também.
//
// ── Por que dá pra casar com o anúncio ──
// `leads_meta.agendado_id` aponta pra ficha, então o caminho é direto: ficha
// qualificada → lead do Forms → lead_id. Sem casar telefone, sem planilha.
//
// Kill-switch: CAPI_QUALIFICADO_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendCrmLeadEvent } from '../../utils/metaPixel';
import { consumoTipico } from './leadSolarFicha';

/**
 * O corte do LEAD BOM, em kWh/mês. 762 kWh = os R$ 800 de conta que o corte de
 * roteamento usava até 22/09/2026.
 *
 * ── POR QUE ELE NÃO SEGUE MAIS O `KWH_CORTE_TIME` ──
 * Eram a mesma constante, e fazia sentido enquanto as duas perguntas tinham a
 * mesma resposta. Não têm mais, e são perguntas diferentes:
 *   • `KWH_CORTE_TIME` (1.200 desde 23/09) responde QUEM ATENDE, é uma régua de
 *     agenda, e o que ela protege é a manhã dos sócios.
 *   • este responde O QUE O META DEVE PERSEGUIR, é uma régua de aprendizado, e
 *     o que ela protege é o volume do sinal.
 * Subir este pra 1.200 junto derrubaria uma amostra que já é pequena: ~13
 * eventos em 90 dias no corte de 762. O algoritmo aprende por repetição, e
 * ensinar pouco é o mesmo que não ensinar, que é exatamente o problema que este
 * loop nasceu pra resolver. Se o Meta vier a ter volume de sobra, subir aqui é
 * uma linha.
 */
export const KWH_LEAD_BOM = 762;

/** Estágio do CRM na especificação do Meta. "Sales Opportunity" é o degrau entre
 *  o lead cru e o `Converted` — exatamente onde este sinal mora. */
export const EVENTO = 'Sales Opportunity';

/** Status que provam que o consultor chegou a orçar. `fechou` e
 *  `proposta_apresentada` entram porque quem passou desses PASSOU pelo orçamento
 *  — e a ficha nem sempre registra o degrau do meio. */
const STATUS_QUE_ORCARAM = ['fez_orcamento', 'proposta_apresentada', 'fechou'];

/** Piso de leitura. A captura de lead_id começou em 28/05 e ficha mais velha que
 *  isso não tem como casar com anúncio nenhum. */
const DESDE = '2026-05-28T00:00:00.000Z';

const desligado = () => (process.env.CAPI_QUALIFICADO_OFF || '').trim() === '1';

/**
 * O consumo respondido, lido da observação da ficha.
 *
 * Dois formatos convivem: um campo por linha e tudo numa linha só separado por
 * "·". Cortar em `\n` e em `·` é o que impede o resto do texto de entrar na
 * conta — sem isso o "30" de "30 dias" derruba "700 a 900" pra 365 e o lead bom
 * nunca é reportado ao Meta.
 *
 * A unidade vem do próprio valor: a DM responde em reais ("R$ 800 a R$ 1.500") e
 * o formulário do Meta em kWh. Deduzir pelo nome do campo leria R$ 800 como
 * 800 kWh e ensinaria o Meta com lead pequeno.
 */
export function consumoDaFichaSolar(observacao: string | null): number | null {
  const bruto = (/Consumo:\s*([^\n·]+)/i.exec(String(observacao || '')) ?? [])[1]?.trim();
  if (!bruto) return null;
  const v = consumoTipico(bruto, /r\$/i.test(bruto) ? 'reais' : 'kwh');
  return v > 0 ? v : null;
}

/** É o perfil que o dono quer que o Meta persiga? */
export function ehLeadBom(observacao: string | null, status: string | null): boolean {
  if (!STATUS_QUE_ORCARAM.includes(String(status || ''))) return false;
  const kwh = consumoDaFichaSolar(observacao);
  return kwh !== null && kwh > KWH_LEAD_BOM;
}

export type ResultadoCapiQualificado = {
  candidatos: number;
  novos: number;
  enviados: number;
  falhas: number;
  motivo?: string;
  detalhes?: Array<{ lead_id: string; ficha: number; kwh: number; status: number; ok: boolean; erro?: string }>;
};

const zero = (motivo?: string): ResultadoCapiQualificado =>
  ({ candidatos: 0, novos: 0, enviados: 0, falhas: 0, ...(motivo ? { motivo } : {}) });

/**
 * Roda de hora em hora no master. Idempotente: o dedup por (lead_id, evento)
 * garante que reprocessar não remanda.
 */
export async function runCapiLeadQualificado(
  opts: { dry?: boolean } = {},
): Promise<ResultadoCapiQualificado> {
  if (!opts.dry && desligado()) return zero('desligado');

  // 1) Fichas que orçaram, com o lead do Forms junto (agendado_id é a ponte).
  const { data, error } = await supabaseGerador
    .from('leads_meta')
    .select('lead_id, agendado_id, agendamentos!inner(id, status, observacao, created_at)')
    .not('agendado_id', 'is', null)
    .gte('created_time', DESDE)
    .in('agendamentos.status', STATUS_QUE_ORCARAM)
    .limit(1000);
  if (error) {
    logger.error('capi-qualificado', 'ler leads_meta falhou', error);
    return { ...zero('erro_leitura'), falhas: 1 };
  }

  type Linha = { lead_id: unknown; agendado_id: unknown; agendamentos: { id: number; status: string; observacao: string | null } };
  const candidatos = ((data ?? []) as unknown as Linha[])
    .map(l => ({
      leadId: String(l.lead_id ?? ''),
      ficha: Number(l.agendamentos?.id ?? 0),
      status: String(l.agendamentos?.status ?? ''),
      observacao: (l.agendamentos?.observacao ?? null) as string | null,
    }))
    .filter(c => /^\d{6,20}$/.test(c.leadId) && ehLeadBom(c.observacao, c.status))
    .map(c => ({ ...c, kwh: Math.round(consumoDaFichaSolar(c.observacao) ?? 0) }));

  if (!candidatos.length) return zero('nenhum_lead_bom');

  // 2) Dedup: quem o Meta já ouviu, com este evento.
  const ids = [...new Set(candidatos.map(c => c.leadId))];
  const { data: jaEnv } = await supabaseGerador
    .from('capi_conversoes_enviadas').select('lead_id')
    .eq('event_name', EVENTO).in('lead_id', ids);
  const enviados = new Set((jaEnv ?? []).map(r => String(r.lead_id)));
  const novos = candidatos.filter(c => !enviados.has(c.leadId));

  const res: ResultadoCapiQualificado = {
    candidatos: candidatos.length, novos: novos.length, enviados: 0, falhas: 0, detalhes: [],
  };
  if (!novos.length) return { ...res, motivo: 'nada_novo' };

  // 3) Avisa o Meta.
  for (const c of novos) {
    if (opts.dry) {
      res.detalhes!.push({ lead_id: c.leadId, ficha: c.ficha, kwh: c.kwh, status: 0, ok: true, erro: 'dry' });
      continue;
    }
    const r = await sendCrmLeadEvent(c.leadId, EVENTO, {
      leadEventSource: 'Gerador IO',
      // Estável: reprocessar não conta duas vezes nem aqui nem no Meta.
      eventId: `qualificado_${c.leadId}`,
    });
    if (r.ok) res.enviados++; else res.falhas++;
    res.detalhes!.push({ lead_id: c.leadId, ficha: c.ficha, kwh: c.kwh, status: r.status, ok: r.ok, erro: r.error });

    // Dedup gravado SÓ quando o Meta aceitou: falha volta na próxima rodada.
    if (r.ok) {
      await supabaseGerador.from('capi_conversoes_enviadas').insert({
        lead_id: c.leadId, cliente_nome: null, telefone_core8: null,
        valor: null, origem: `solar>${KWH_LEAD_BOM}kWh`, event_name: EVENTO,
        meta_status: r.status, meta_received: r.received ?? null,
      }).then(({ error: e }) => {
        if (e && !/duplicate|unique/i.test(e.message)) {
          logger.error('capi-qualificado', 'dedup insert falhou', e);
        }
      });
    }
  }

  logger.info('capi-qualificado',
    `${res.enviados} lead(s) bom(ns) reportado(s) ao Meta`, { novos: res.novos, falhas: res.falhas });
  return res;
}
