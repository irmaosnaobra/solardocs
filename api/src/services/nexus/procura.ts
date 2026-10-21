// A procura que chega à NEXUS (v2), para as telas Início e Mercado do portal. Só contagens, nenhum dado pessoal.
//
// Fonte: banco do GERADOR, tabela `agendamentos`, só o eletroposto. A regra de "é eletroposto" é a mesma que o
// placar de motivos usa em routes/gerador.ts (~linha 718): `created_by` contém "eletroposto" (lp_eletroposto,
// cadastro_eletroposto, prosp_eletroposto, manychat_eletroposto, agente_eletroposto e as que vierem). A data é a
// da chegada do pedido de reunião (`created_at`), que é a procura; `quando` é o horário marcado e pode ser futuro.
// UF pelo sufixo da cidade ("Uberlândia-MG", "Uberlândia/MG", "Uberlândia - MG"). Datas em Brasília.
// Cache de 6 h em memória (por instância). PostgREST corta em 1000 linhas: pagina.

import { supabaseGerador } from '../../utils/supabaseGerador';
import { partesBRT } from './tempo';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const TTL_MS = 6 * 60 * 60 * 1000;
const POR_PAGINA = 1000;
const MAX_PAGINAS = 40;
const DIA_MS = 24 * 60 * 60 * 1000;
const BRT_MS = 3 * 60 * 60 * 1000;

export interface ProcuraGeral {
  meses: Array<{ mes: string; total: number; porUf: Record<string, number> }>;
  por_uf: Array<{ uf: string; total: number }>;
  pct_fora_mg_go_df: number | null;
  total_com_uf: number;
  atualizado_em: string;
}

export interface ProcuraDaUf {
  uf: string | null;
  reunioes_90d_uf: number;
  meses: Array<{ mes: string; total: number; uf_total: number }>;
  por_uf: Array<{ uf: string; total: number }>;
  pct_fora_mg_go_df: number | null;
  total_com_uf: number;
  atualizado_em: string;
}

/** "Uberlândia-MG", "Uberlândia/MG" ou "Uberlândia - MG" vira "MG". Sem sufixo válido, null. */
export function ufDaCidade(cidade: unknown): string | null {
  const m = /[-/]\s*([A-Za-z]{2})\s*$/.exec(String(cidade ?? '').trim());
  if (!m) return null;
  const uf = m[1].toUpperCase();
  return UFS.includes(uf) ? uf : null;
}

function mesBRT(d: Date): string {
  return new Date(d.getTime() - BRT_MS).toISOString().slice(0, 7);
}

/** Os últimos 6 meses de Brasília, do mais antigo ao corrente: ['2026-05', ..., '2026-10']. */
export function ultimosSeisMeses(agora: Date = new Date()): string[] {
  const { ano, mes } = partesBRT(agora);
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const t = new Date(Date.UTC(ano, mes - 1 - i, 1));
    out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Junta as linhas (created_at + cidade) nos números da tela. Função pura. */
export function agregarProcura(linhas: Array<{ created_at: string; cidade: string | null }>, agora: Date = new Date()): ProcuraGeral {
  const meses = ultimosSeisMeses(agora).map((mes) => ({ mes, total: 0, porUf: {} as Record<string, number> }));
  const indice = new Map(meses.map((m) => [m.mes, m]));
  const corte90 = agora.getTime() - 90 * DIA_MS;
  const porUf = new Map<string, number>();
  let comUf = 0;

  for (const l of linhas) {
    const t = new Date(l.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const uf = ufDaCidade(l.cidade);
    const m = indice.get(mesBRT(t));
    if (m) {
      m.total++;
      if (uf) m.porUf[uf] = (m.porUf[uf] ?? 0) + 1;
    }
    if (uf && t.getTime() >= corte90 && t.getTime() <= agora.getTime()) {
      porUf.set(uf, (porUf.get(uf) ?? 0) + 1);
      comUf++;
    }
  }

  const fora = [...porUf.entries()].filter(([uf]) => !['MG', 'GO', 'DF'].includes(uf)).reduce((s, [, n]) => s + n, 0);
  return {
    meses,
    por_uf: [...porUf.entries()].map(([uf, total]) => ({ uf, total })).sort((a, b) => b.total - a.total || a.uf.localeCompare(b.uf)),
    pct_fora_mg_go_df: comUf ? Math.round((fora / comUf) * 1000) / 10 : null,
    total_com_uf: comUf,
    atualizado_em: agora.toISOString(),
  };
}

async function lerLinhas(agora: Date): Promise<Array<{ created_at: string; cidade: string | null }>> {
  // Do primeiro dia do mês de 5 meses atrás (Brasília), com folga de um dia para a virada de fuso.
  const { ano, mes } = partesBRT(agora);
  const desde = new Date(Date.UTC(ano, mes - 1 - 5, 1) + BRT_MS - DIA_MS).toISOString();
  const todas: Array<{ created_at: string; cidade: string | null }> = [];
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { data, error } = await supabaseGerador
      .from('agendamentos')
      .select('created_at, cidade')
      .ilike('created_by', '%eletroposto%')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(i * POR_PAGINA, i * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;
    const linhas = (data ?? []) as Array<{ created_at: string; cidade: string | null }>;
    todas.push(...linhas);
    if (linhas.length < POR_PAGINA) break;
  }
  return todas;
}

let cache: { ate: number; geral: ProcuraGeral } | null = null;

export function resetCacheProcura(): void {
  cache = null;
}

export async function procuraGeral(agora: Date = new Date()): Promise<ProcuraGeral> {
  if (cache && cache.ate > agora.getTime()) return cache.geral;
  try {
    const geral = agregarProcura(await lerLinhas(agora), agora);
    cache = { ate: agora.getTime() + TTL_MS, geral };
    return geral;
  } catch (e) {
    if (cache) return cache.geral; // melhor um número de ontem que tela vazia
    throw e;
  }
}

export async function procuraDaUf(uf: string | null, agora: Date = new Date()): Promise<ProcuraDaUf> {
  const g = await procuraGeral(agora);
  const alvo = uf && UFS.includes(uf) ? uf : null;
  return {
    uf: alvo,
    reunioes_90d_uf: alvo ? g.por_uf.find((x) => x.uf === alvo)?.total ?? 0 : 0,
    meses: g.meses.map((m) => ({ mes: m.mes, total: m.total, uf_total: alvo ? m.porUf[alvo] ?? 0 : 0 })),
    por_uf: g.por_uf,
    pct_fora_mg_go_df: g.pct_fora_mg_go_df,
    total_com_uf: g.total_com_uf,
    atualizado_em: g.atualizado_em,
  };
}
