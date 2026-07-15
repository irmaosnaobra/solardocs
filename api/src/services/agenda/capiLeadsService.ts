import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendCrmLeadEvent } from '../../utils/metaPixel';

// ─── Loop CAPI: fechamento (planilha) → lead capturado → Meta ────────────────
// Roda DE HORA EM HORA (dentro do master cron), mas é IDEMPOTENTE: o dedup por
// (lead_id, event_name) garante que cada fechamento só é avisado ao Meta UMA vez
// — reprocessar de hora em hora não remanda. Lê a planilha "CONTRATOS FECHADOS",
// casa cada contrato (por telefone) com um lead dos Forms (leads_meta.lead_id) e
// avisa o Meta que aquele lead virou CONTRATO — via Conversions API for CRM
// (event "Converted" por lead_id). O Meta então otimiza pra buscar mais gente
// com o PERFIL de quem fecha.
//
// Escopo: SÓ contratos de origem "Tráfego" (vieram de anúncio) — indicação fica
// de fora (decisão Thiago). Só casa com lead a partir de 28/mai/2026 (quando a
// captura começou). Dedup persistido em capi_conversoes_enviadas (não remanda).
//
// A planilha é mantida À MÃO (published CSV, parse por ORDEM de coluna). Frágil:
// se renomearem/reordenarem coluna, o parse desalinha. Guard: valida o header.

const CSV_URL = process.env.META_LEADS_CONTRATOS_CSV
  || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSvd79xaG3qQwyko6BegyUaZmvd0B1FmtkaN9Oafm3qmU5yY86T2qA0EP_CysGf6bpRjxCccMOiqLxp/pub?output=csv';

// Origens que contam como "veio de anúncio" (Meta). O resto (indicação, #códigos,
// "procurou", "recorrente") fica de fora do envio ao Meta.
const ORIGENS_TRAFEGO = ['tráfego', 'trafego', 'aumento'];

interface Contrato { nome: string; telefone8: string; valor: number; origem: string; }

// Parser CSV mínimo, respeita aspas duplas e vírgulas internas.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Núcleo de 8 dígitos do telefone — imune a variação de DDD/9º dígito/DDI.
function core8(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
}

function brl(s: string): number {
  return Number((s || '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;
}

async function baixarContratos(): Promise<Contrato[]> {
  const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`planilha HTTP ${res.status}`);
  const rows = parseCSV(await res.text());
  if (!rows.length) throw new Error('planilha vazia');

  const head = rows[0].map(h => (h || '').trim().toUpperCase());
  const iNome = head.indexOf('NOME CLIENTE');
  const iCont = head.indexOf('CONTATO');
  const iVal  = head.indexOf('VALOR DA VENDA');
  const iOrig = head.indexOf('ORIGEM DO LEAD');
  // Guard: se o header desalinhou (coluna renomeada/movida), não processa às cegas.
  if (iNome < 0 || iCont < 0 || iVal < 0 || iOrig < 0) {
    throw new Error(`header da planilha mudou (NOME CLIENTE/CONTATO/VALOR DA VENDA/ORIGEM DO LEAD) — não processo às cegas. head=${head.slice(0, 6).join('|')}`);
  }

  const out: Contrato[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nome = (r[iNome] || '').trim();
    if (!nome) continue;
    const t8 = core8(r[iCont]);
    if (!t8) continue;
    out.push({ nome, telefone8: t8, valor: brl(r[iVal]), origem: (r[iOrig] || '').trim() });
  }
  return out;
}

function ehTrafego(origem: string): boolean {
  const o = (origem || '').toLowerCase();
  return ORIGENS_TRAFEGO.some(t => o.includes(t));
}

export interface CapiLeadsResult {
  contratos: number;
  trafego: number;
  casados: number;
  novos: number;
  enviados: number;
  falhas: number;
  detalhes: Array<{ nome: string; lead_id: string; valor: number; status: number; ok: boolean; erro?: string }>;
}

export async function runCapiLeads(opts: { dry?: boolean } = {}): Promise<CapiLeadsResult> {
  const res: CapiLeadsResult = { contratos: 0, trafego: 0, casados: 0, novos: 0, enviados: 0, falhas: 0, detalhes: [] };

  // 1) Planilha
  const contratos = await baixarContratos();
  res.contratos = contratos.length;
  const trafego = contratos.filter(c => ehTrafego(c.origem));
  res.trafego = trafego.length;
  if (!trafego.length) return res;

  // 2) Leads capturados (lead_id + núcleo do telefone). Paginado defensivo.
  const leadsPorFone = new Map<string, { lead_id: string; nome: string }>();
  const { data: leads, error } = await supabaseGerador
    .from('leads_meta')
    .select('lead_id, whatsapp, nome')
    .not('whatsapp', 'is', null)
    .not('lead_id', 'is', null);
  if (error) { logger.error('cron', 'capi-leads: leads_meta falhou', error); throw new Error(error.message); }
  for (const l of (leads ?? [])) {
    const k = core8(l.whatsapp as string);
    if (k && !leadsPorFone.has(k)) leadsPorFone.set(k, { lead_id: String(l.lead_id), nome: String(l.nome ?? '') });
  }

  // 3) Casa contrato→lead
  const casados = trafego
    .map(c => ({ c, lead: leadsPorFone.get(c.telefone8) }))
    .filter((x): x is { c: Contrato; lead: { lead_id: string; nome: string } } => !!x.lead);
  res.casados = casados.length;
  if (!casados.length) return res;

  // 4) Dedup: já enviados (por lead_id + event 'Converted')
  const leadIds = [...new Set(casados.map(x => x.lead.lead_id))];
  const { data: jaEnv } = await supabaseGerador
    .from('capi_conversoes_enviadas')
    .select('lead_id')
    .eq('event_name', 'Converted')
    .in('lead_id', leadIds);
  const enviadosSet = new Set((jaEnv ?? []).map(r => String(r.lead_id)));

  const novos = casados.filter(x => !enviadosSet.has(x.lead.lead_id));
  res.novos = novos.length;
  if (!novos.length) return res;

  // 5) Dispara (dry = só simula)
  for (const { c, lead } of novos) {
    if (opts.dry) {
      res.detalhes.push({ nome: c.nome, lead_id: lead.lead_id, valor: c.valor, status: 0, ok: true, erro: 'dry' });
      continue;
    }
    const r = await sendCrmLeadEvent(lead.lead_id, 'Converted', {
      value: c.valor > 0 ? c.valor : undefined,
      currency: 'BRL',
      leadEventSource: 'Gerador IO',
      eventId: `contrato_${lead.lead_id}`,   // idempotência no Meta
    });
    if (r.ok) res.enviados++; else res.falhas++;
    res.detalhes.push({ nome: c.nome, lead_id: lead.lead_id, valor: c.valor, status: r.status, ok: r.ok, erro: r.error });

    // Grava o dedup só quando ENVIOU de verdade (falha reenvia no próximo dia).
    if (r.ok) {
      await supabaseGerador.from('capi_conversoes_enviadas').insert({
        lead_id: lead.lead_id, telefone_core8: c.telefone8, cliente_nome: c.nome,
        valor: c.valor || null, origem: c.origem, event_name: 'Converted',
        meta_status: r.status, meta_received: r.received ?? null,
      }).then(({ error: e }) => { if (e && !/duplicate|unique/i.test(e.message)) logger.error('cron', 'capi-leads: dedup insert falhou', e); });
    }
  }

  logger.info('cron', `capi-leads: ${res.enviados} enviados, ${res.falhas} falhas (de ${res.novos} novos / ${res.casados} casados / ${res.trafego} tráfego / ${res.contratos} contratos)`);
  return res;
}
