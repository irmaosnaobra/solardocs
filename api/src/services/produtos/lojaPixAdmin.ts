/**
 * LOJA NO PIX, visão do admin (somente leitura): o que as cobranças de `produto_cobrancas` mostram no painel
 * "Loja" do /admin. Por produto: quantas cobranças foram geradas, quantas pagas e o valor pago. Mais as últimas 20.
 *
 * Privacidade: o select nomeia as colunas e NUNCA pede cpf, qr_payload, qr_imagem nem os ids do Asaas. Da pessoa
 * sai só o primeiro nome (users.nome). E-mail e telefone nem são lidos.
 *
 * Status da tabela: pendente | pago | expirado | cancelado | reembolsado. "Paga" é só 'pago'; o reembolsado entra
 * como gerada e não soma no valor pago (o dinheiro voltou).
 */
import { supabase } from '../../utils/supabase';
import { produtoPorId } from './catalogo';
import { ORDEM_PRODUTOS_PIX } from './produtoPix';

export type PeriodoLoja = '7d' | '30d' | '90d';

export interface LojaPixProduto {
  slug: string;
  nome: string;
  geradas: number;
  pagas: number;
  valor_pago: number;
}

export interface LojaPixUltima {
  criado_em: string;
  slug: string;
  produto: string;
  status: string;
  valor: number;
  primeiro_nome: string | null;
}

export interface LojaPixResumo {
  period: PeriodoLoja;
  desde: string;
  total: { geradas: number; pagas: number; valor_pago: number };
  por_produto: LojaPixProduto[];
  ultimas: LojaPixUltima[];
}

const DIAS: Record<PeriodoLoja, number> = { '7d': 7, '30d': 30, '90d': 90 };
const PAGINA = 1000;

export function periodoLoja(bruto: unknown): PeriodoLoja {
  return bruto === '30d' || bruto === '90d' ? bruto : '7d';
}

const reais = (n: number): number => Math.round(n * 100) / 100;

type Linha = { user_id: string | null; produto: string; valor: number | string; status: string; criado_em: string };

export async function resumoLojaPix(period: PeriodoLoja, agora: number = Date.now()): Promise<LojaPixResumo> {
  const desde = new Date(agora - DIAS[period] * 86_400_000).toISOString();

  const linhas: Linha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('produto_cobrancas')
      .select('user_id, produto, valor, status, criado_em')
      .gte('criado_em', desde)
      .order('criado_em', { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = (data ?? []) as Linha[];
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }

  const nomeDe = (slug: string): string => produtoPorId(slug)?.nome ?? slug;
  const mapa = new Map<string, LojaPixProduto>();
  const garantir = (slug: string): LojaPixProduto => {
    let p = mapa.get(slug);
    if (!p) { p = { slug, nome: nomeDe(slug), geradas: 0, pagas: 0, valor_pago: 0 }; mapa.set(slug, p); }
    return p;
  };
  for (const slug of ORDEM_PRODUTOS_PIX) garantir(slug);

  for (const l of linhas) {
    const p = garantir(l.produto);
    p.geradas++;
    if (l.status === 'pago') { p.pagas++; p.valor_pago += Number(l.valor) || 0; }
  }
  const porProduto = [...mapa.values()].map((p) => ({ ...p, valor_pago: reais(p.valor_pago) }));

  // Últimas 20 (as linhas já vêm da mais nova para a mais velha). Primeiro nome só, de quem tem conta.
  const recentes = linhas.slice(0, 20);
  const ids = [...new Set(recentes.map((l) => l.user_id).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from('users').select('id, nome').in('id', ids);
    for (const u of (data ?? []) as Array<{ id: string; nome: string | null }>) {
      const primeiro = (u.nome || '').trim().split(/\s+/)[0];
      if (primeiro) nomes.set(u.id, primeiro);
    }
  }
  const ultimas: LojaPixUltima[] = recentes.map((l) => ({
    criado_em: l.criado_em,
    slug: l.produto,
    produto: nomeDe(l.produto),
    status: l.status,
    valor: Number(l.valor) || 0,
    primeiro_nome: (l.user_id && nomes.get(l.user_id)) || null,
  }));

  return {
    period,
    desde,
    total: {
      geradas: porProduto.reduce((s, p) => s + p.geradas, 0),
      pagas: porProduto.reduce((s, p) => s + p.pagas, 0),
      valor_pago: reais(porProduto.reduce((s, p) => s + p.valor_pago, 0)),
    },
    por_produto: porProduto,
    ultimas,
  };
}
