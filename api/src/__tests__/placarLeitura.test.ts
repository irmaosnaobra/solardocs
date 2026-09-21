import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A LEITURA PAGINADA DO PLACAR.
//
// Este arquivo existe por causa de um defeito que chegou a PRODUÇÃO em
// 19/09/2026: o placar disse 17 conversas onde o banco tinha 107. A leitura
// pedia páginas de mil e parava quando o lote vinha menor que mil — só que o
// servidor tem teto próprio, MENOR que isso, então o primeiro lote já vinha
// "curto" e a varredura parava na primeira página. Nenhum erro, nenhum aviso,
// só um número baixo e tranquilizador.
//
// O mock aqui devolve páginas de 500 pra um pedido de 1000, que é exatamente a
// forma do defeito. Se alguém voltar a andar pelo tamanho PEDIDO em vez do
// tamanho que VOLTOU, este teste cai.
// ─────────────────────────────────────────────────────────────────────────────

const TETO_DO_SERVIDOR = 500;

interface Msg { telefone: string; from_me: boolean; momment: string }
const banco: { wa: Msg[] } = { wa: [] };
let pedidos: Array<[number, number]> = [];

vi.mock('../utils/supabase', () => {
  const waQuery = () => {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
      range: (de: number, ate: number) => {
        pedidos.push([de, ate]);
        const pedido = ate - de + 1;
        const fatia = banco.wa.slice(de, de + Math.min(pedido, TETO_DO_SERVIDOR));
        return Promise.resolve({ data: fatia, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
    };
    return q;
  };
  return { supabase: { from: () => waQuery() } };
});

vi.mock('../services/agents/whatsapp/silenciar', () => ({
  chaveContato: (p: string) => {
    const d = String(p ?? '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return null;
    const s = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    return s.length < 10 ? null : s.slice(0, 2) + s.slice(-8);
  },
}));

import { medirPlacar } from '../services/io/placarGiovanna';

/** 1.200 mensagens: com teto de 500 por página, exige 3 idas ao banco. */
function semeia(conversas: number, porConversa: number): void {
  banco.wa = [];
  const agora = Date.now();
  for (let c = 0; c < conversas; c++) {
    const tel = `5534${String(900000000 + c).slice(0, 9)}`;
    for (let i = 0; i < porConversa; i++) {
      banco.wa.push({ telefone: tel, from_me: false, momment: new Date(agora - (c * 100 + i) * 60_000).toISOString() });
    }
  }
  // Ordem decrescente, como a consulta pede.
  banco.wa.sort((a, b) => (a.momment < b.momment ? 1 : -1));
}

describe('placar do 5040 — a leitura paginada', () => {
  beforeEach(() => { pedidos = []; });

  it('não para na primeira página quando o servidor devolve menos do que foi pedido', async () => {
    semeia(300, 4);                                  // 1.200 mensagens, 300 conversas
    const p = await medirPlacar(10);
    expect(pedidos.length).toBeGreaterThan(1);       // foi buscar de novo
    expect(p).not.toBeNull();
    expect(p!.conversas).toBe(300);                  // e achou TODAS
    expect(p!.mensagens).toBe(1200);
  });

  it('avança pelo que voltou, não pelo que pediu', async () => {
    semeia(200, 5);                                  // 1.000 mensagens
    await medirPlacar(10);
    // Com teto de 500, o 2º pedido tem que começar em 500 — não em 1000.
    expect(pedidos[0][0]).toBe(0);
    expect(pedidos[1][0]).toBe(TETO_DO_SERVIDOR);
  });

  it('para quando o banco acaba, sem laço infinito', async () => {
    semeia(10, 2);                                   // 20 mensagens, cabe numa página
    const p = await medirPlacar(10);
    expect(p!.conversas).toBe(10);
    expect(pedidos.length).toBeLessThanOrEqual(2);   // uma página + a que veio vazia
  });
});
