// ════════════════════════════════════════════════════════════
// INSIGHTS — KPIs pra reunião puxados das ferramentas externas
// ════════════════════════════════════════════════════════════
// Fonte 1: Planilha Mestre (Google Sheets publicada como CSV)
// Fonte 2: Trello board de Homologação (precisa estar PUBLIC)
//
// Cache em memória 1h. Edição continua nas ferramentas externas — aqui
// é read-only, só pra apresentar números.
// ════════════════════════════════════════════════════════════

import { logger } from '../utils/logger';

const PLANILHA_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSvd79xaG3qQwyko6BegyUaZmvd0B1FmtkaN9Oafm3qmU5yY86T2qA0EP_CysGf6bpRjxCccMOiqLxp/pub?output=csv';
const TRELLO_BOARD_ID = '678a89a047242f02d443f8e0';
const TRELLO_API = `https://trello.com/1/boards/${TRELLO_BOARD_ID}?lists=open&cards=open&fields=name&list_fields=name&card_fields=name,idList,due,dateLastActivity`;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — atualiza 1x/dia (pre-warm pelo master cron das 9h)

export interface Insights {
  generatedAt: string;
  planilha: PlanilhaKpis | null;
  trello: TrelloKpis | null;
  errors: string[];
}

export interface KpiNum { label: string; value: string; sub?: string; }

export interface PlanilhaKpis {
  faturamentoMes: KpiNum;
  faturamentoTotal: KpiNum;
  vendasMes: KpiNum;
  vendasTotal: KpiNum;
  lucroMedioPct: KpiNum;
  ticketMedio: KpiNum;
  topConsultor: KpiNum;
  topOrigem: KpiNum;
  liberadosCemig: KpiNum;
  ultimasVendas: { codigo: string; nome: string; valor: string; data: string }[];
  // Series pra gráficos
  faturamentoMensal: { mes: string; faturamento: number; vendas: number }[]; // últimos 6 meses
  vendasPorConsultor: { nome: string; qtd: number; faturamento: number }[];
  vendasPorOrigem: { origem: string; qtd: number }[];
  vendasPorConcessionaria: { concessionaria: string; qtd: number }[];
}

export interface TrelloKpis {
  totalAtivo: KpiNum;
  porColuna: { nome: string; qtd: number }[];
}

// ─── Cache em memória ────────────────────────────────────────
let cache: { data: Insights; ts: number } | null = null;

export async function getInsights(force = false): Promise<Insights> {
  const now = Date.now();
  if (!force && cache && (now - cache.ts) < CACHE_TTL_MS) {
    return cache.data;
  }

  const errors: string[] = [];
  const [planilha, trello] = await Promise.all([
    fetchPlanilha().catch((e) => { errors.push(`Planilha: ${e.message || e}`); return null; }),
    fetchTrello().catch((e) => { errors.push(`Trello: ${e.message || e}`); return null; }),
  ]);

  const insights: Insights = {
    generatedAt: new Date().toISOString(),
    planilha,
    trello,
    errors,
  };
  cache = { data: insights, ts: now };
  logger.info('insights', `gerado — planilha=${!!planilha} trello=${!!trello} errors=${errors.length}`);
  return insights;
}

// ─── Planilha Mestre ─────────────────────────────────────────
async function fetchPlanilha(): Promise<PlanilhaKpis> {
  const res = await fetch(PLANILHA_CSV_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  const rows = parseCSV(csv);
  if (rows.length < 2) throw new Error('CSV vazio');

  const header = rows[0];
  const idx = (col: string) => header.findIndex((h) => h.trim().toUpperCase() === col.toUpperCase());
  const iValor = idx('VALOR DA VENDA');
  const iRecebido = idx('RECEBIDO REAL');
  const iCodigo = idx('CODIGO');
  const iNome = idx('NOME CLIENTE');
  const iConsultor = idx('CONSULTOR');
  const iOrigem = idx('ORIGEM DO LEAD');
  const iLucroPct = idx('% DE LUCRO');
  const iLiberacao = idx('LIBERAÇÃO VISTORIA');
  const iConcessionaria = idx('CONCESSIONARIA');
  const iDataFim = idx('DATA FINAL INSTALAÇÃO');

  const data = rows.slice(1).filter((r) => r[iCodigo]?.trim() && r[iValor]?.trim());

  const now = new Date();
  const mesAtual = now.getMonth();
  const anoAtual = now.getFullYear();

  const isMesAtual = (s: string): boolean => {
    if (!s) return false;
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return false;
    return parseInt(m[2], 10) - 1 === mesAtual && parseInt(m[3], 10) === anoAtual;
  };

  let faturamentoTotal = 0;
  let faturamentoMes = 0;
  let vendasMes = 0;
  let lucroSomado = 0;
  let lucroCount = 0;
  let liberadosCemig = 0;
  let totalCemig = 0;

  const consultorVendas: Record<string, number> = {};
  const consultorFaturamento: Record<string, number> = {};
  const origemVendas: Record<string, number> = {};
  const concessionariaVendas: Record<string, number> = {};
  const ultimas: { codigo: string; nome: string; valor: string; data: string }[] = [];

  // Faturamento dos últimos 6 meses (incluindo o atual)
  const MESES_NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const ultimos6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(anoAtual, mesAtual - (5 - i), 1);
    return { ano: d.getFullYear(), mes: d.getMonth(), key: `${d.getFullYear()}-${d.getMonth()}` };
  });
  const faturamentoMensalMap = new Map<string, { faturamento: number; vendas: number }>();
  ultimos6.forEach(m => faturamentoMensalMap.set(m.key, { faturamento: 0, vendas: 0 }));

  for (const row of data) {
    const valorNum = parseBR(row[iValor]);
    faturamentoTotal += valorNum;

    if (isMesAtual(row[iDataFim] || '')) {
      faturamentoMes += valorNum;
      vendasMes++;
    }

    const lucroPctStr = row[iLucroPct] || '';
    const lucroPctNum = parseFloat(lucroPctStr.replace('%', '').replace(',', '.'));
    if (!isNaN(lucroPctNum)) {
      lucroSomado += lucroPctNum;
      lucroCount++;
    }

    const consultor = (row[iConsultor] || '').trim();
    if (consultor) {
      consultorVendas[consultor] = (consultorVendas[consultor] || 0) + 1;
      consultorFaturamento[consultor] = (consultorFaturamento[consultor] || 0) + valorNum;
    }

    const origem = (row[iOrigem] || '').trim().split(' ')[0]; // 'Tráfego', 'Indicação', etc
    if (origem) origemVendas[origem] = (origemVendas[origem] || 0) + 1;

    const concessionariaRaw = (row[iConcessionaria] || '').trim();
    if (concessionariaRaw) {
      concessionariaVendas[concessionariaRaw] = (concessionariaVendas[concessionariaRaw] || 0) + 1;
    }
    if (concessionariaRaw.toLowerCase().includes('cemig')) {
      totalCemig++;
      const lib = (row[iLiberacao] || '').trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(lib)) liberadosCemig++;
    }

    // Faturamento mensal — agrupar pela DATA FINAL INSTALAÇÃO
    const dataInst = (row[iDataFim] || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dataInst) {
      const mDate = parseInt(dataInst[2], 10) - 1;
      const yDate = parseInt(dataInst[3], 10);
      const key = `${yDate}-${mDate}`;
      const entry = faturamentoMensalMap.get(key);
      if (entry) {
        entry.faturamento += valorNum;
        entry.vendas++;
      }
    }

    ultimas.push({
      codigo: row[iCodigo],
      nome: (row[iNome] || '').slice(0, 30),
      valor: row[iValor] || '',
      data: row[iDataFim] || '',
    });
  }

  const ticketMedio = data.length ? faturamentoTotal / data.length : 0;
  const lucroMedio = lucroCount ? lucroSomado / lucroCount : 0;

  const topConsultor = topEntry(consultorVendas);
  const topOrigem = topEntry(origemVendas);

  // Pega as 5 últimas (por ordem do CSV — assume que está ordenado por data crescente)
  const ultimasVendas = ultimas.slice(-5).reverse();

  // Séries pra gráficos
  const faturamentoMensal = ultimos6.map(m => {
    const e = faturamentoMensalMap.get(m.key)!;
    return { mes: MESES_NOMES[m.mes], faturamento: Math.round(e.faturamento), vendas: e.vendas };
  });

  const vendasPorConsultor = Object.entries(consultorVendas)
    .map(([nome, qtd]) => ({ nome, qtd, faturamento: Math.round(consultorFaturamento[nome] || 0) }))
    .sort((a, b) => b.qtd - a.qtd);

  const vendasPorOrigem = Object.entries(origemVendas)
    .map(([origem, qtd]) => ({ origem, qtd }))
    .sort((a, b) => b.qtd - a.qtd);

  const vendasPorConcessionaria = Object.entries(concessionariaVendas)
    .map(([concessionaria, qtd]) => ({ concessionaria, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
    .slice(0, 8);

  return {
    faturamentoMes: { label: 'Faturamento do mês', value: fmtBRL(faturamentoMes), sub: `${vendasMes} venda${vendasMes !== 1 ? 's' : ''}` },
    faturamentoTotal: { label: 'Faturamento total', value: fmtBRL(faturamentoTotal), sub: `${data.length} vendas no histórico` },
    vendasMes: { label: 'Vendas no mês', value: String(vendasMes) },
    vendasTotal: { label: 'Vendas total', value: String(data.length) },
    lucroMedioPct: { label: 'Lucro médio', value: lucroMedio.toFixed(1).replace('.', ',') + '%' },
    ticketMedio: { label: 'Ticket médio', value: fmtBRL(ticketMedio) },
    topConsultor: { label: 'Top consultor', value: topConsultor.nome, sub: `${topConsultor.qtd} vendas` },
    topOrigem: { label: 'Top origem dos leads', value: topOrigem.nome, sub: `${topOrigem.qtd} vendas` },
    liberadosCemig: { label: 'Liberados pela Cemig', value: `${liberadosCemig}/${totalCemig}`, sub: totalCemig > 0 ? `${Math.round((liberadosCemig / totalCemig) * 100)}% liberado` : '' },
    ultimasVendas,
    faturamentoMensal,
    vendasPorConsultor,
    vendasPorOrigem,
    vendasPorConcessionaria,
  };
}

// ─── Trello ──────────────────────────────────────────────────
interface TrelloList { id: string; name: string; }
interface TrelloCard { id: string; name: string; idList: string; due?: string | null; dateLastActivity?: string; }
interface TrelloBoard { lists?: TrelloList[]; cards?: TrelloCard[]; }

async function fetchTrello(): Promise<TrelloKpis> {
  const res = await fetch(TRELLO_API);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Board não está público — Trello → Settings → Visibility → Public');
    throw new Error(`HTTP ${res.status}`);
  }
  const board = (await res.json()) as TrelloBoard;
  const lists = board.lists || [];
  const cards = board.cards || [];

  const porColuna = lists.map((l) => ({
    nome: l.name,
    qtd: cards.filter((c) => c.idList === l.id).length,
  }));

  return {
    totalAtivo: { label: 'Projetos em homologação', value: String(cards.length) },
    porColuna,
  };
}

// ─── Helpers ────────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  // Parser simples respeitando aspas duplas
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') { /* skip */ }
      else { cell += ch; }
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseBR(s: string): number {
  if (!s) return 0;
  // "R$ 6.990,00" → 6990.00
  const cleaned = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function fmtBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function topEntry(map: Record<string, number>): { nome: string; qtd: number } {
  const entries = Object.entries(map);
  if (!entries.length) return { nome: '—', qtd: 0 };
  entries.sort((a, b) => b[1] - a[1]);
  return { nome: entries[0][0], qtd: entries[0][1] };
}
