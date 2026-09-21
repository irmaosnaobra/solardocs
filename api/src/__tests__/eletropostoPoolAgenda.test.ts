import { describe, it, expect, vi, beforeEach } from 'vitest';

// Três tabelas, cada uma com o que o teste pedir. O filtro `.eq('status',
// 'arrendamento')` da agenda é respeitado de verdade: se o pool esquecer o
// filtro, o lead "agendado" do meio vaza e o teste pega.
let tabelas: Record<string, Record<string, unknown>[]> = {};
vi.mock('../utils/supabaseGerador', () => {
  const resposta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { filtros.push([col, v]); return q; },
      limit: () => q,
      then: (ok: any) => Promise.resolve({
        data: (tabelas[tabela] || []).filter(l => filtros.every(([c, v]) => l[c] === v)),
        error: null,
      }).then(ok),
    };
    return q;
  };
  return { supabaseGerador: { from: (t: string) => resposta(t) } };
});

import { pool } from '../services/io/eletropostoPares';

describe('pool do PONTO — arrendamento marcado na agenda (21/09)', () => {
  beforeEach(() => {
    tabelas = {
      eletroposto_parceria: [
        { id: 1, lado: 'ponto', nome: 'Cadastrado', telefone: '5534999990001', cidade: 'Uberlândia-MG' },
      ],
      eletroposto_nota1: [
        { id: 7, nome: 'Da ficha', telefone: '5534999990002', cidade: 'Uberlândia-MG',
          capital_faixa: 'naosei', tem_ponto: 'definido' },
      ],
      agendamentos: [
        { id: 1128, status: 'arrendamento', cliente_nome: 'Só na agenda',
          cliente_telefone: '5534999990003', cidade: 'Uberlândia-MG' },
        // mesmo telefone do cadastro: a linha rica ganha, a da agenda não duplica
        { id: 1129, status: 'arrendamento', cliente_nome: 'Duplicado',
          cliente_telefone: '5534999990001', cidade: 'Uberlândia-MG' },
        // outro status: não é arrendamento, não entra
        { id: 1130, status: 'agendado', cliente_nome: 'Só agendado',
          cliente_telefone: '5534999990004', cidade: 'Uberlândia-MG' },
      ],
    };
  });

  it('quem foi marcado ARRENDAMENTO na agenda entra no lado do ponto, com a origem certa', async () => {
    const pontos = await pool('ponto');
    const daAgenda = pontos.find(p => p.telefone === '5534999990003');
    expect(daAgenda).toBeDefined();
    expect(daAgenda!.tab).toBe('agenda');
    expect(daAgenda!.id).toBe(1128);
    // foi conversado pelo consultor: não é "da ficha, nunca falamos"
    expect(daAgenda!.daFicha).toBe(false);
  });

  it('a ordem é cadastro > ficha > agenda: o mesmo telefone não aparece duas vezes', async () => {
    const pontos = await pool('ponto');
    const doTelefone = pontos.filter(p => p.telefone === '5534999990001');
    expect(doTelefone).toHaveLength(1);
    expect(doTelefone[0].tab).toBe('parceria');
  });

  it('só o status arrendamento entra: agendado comum fica de fora', async () => {
    const pontos = await pool('ponto');
    expect(pontos.some(p => p.telefone === '5534999990004')).toBe(false);
  });

  it('a agenda NÃO alimenta o lado do capital: quem cede o local não é investidor', async () => {
    const capital = await pool('capital');
    expect(capital.some(c => c.tab === 'agenda')).toBe(false);
  });

  it('as três origens chegam juntas e com coordenada, prontas pro cálculo de pares', async () => {
    const pontos = await pool('ponto');
    expect(pontos.map(p => p.tab).sort()).toEqual(['agenda', 'nota1', 'parceria']);
    expect(pontos.every(p => typeof p.lat === 'number')).toBe(true);
  });
});
