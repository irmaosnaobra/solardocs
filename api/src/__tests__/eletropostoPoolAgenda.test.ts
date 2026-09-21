import { describe, it, expect, vi, beforeEach } from 'vitest';

// Três tabelas, cada uma com o que o teste pedir. O filtro `.eq('status',
// 'arrendamento')` da agenda é respeitado de verdade: se o pool esquecer o
// filtro, o lead "agendado" do meio vaza e o teste pega.
let tabelas: Record<string, Record<string, unknown>[]> = {};
vi.mock('../utils/supabaseGerador', () => {
  const resposta = (tabela: string) => {
    const filtros: Array<[string, (x: unknown) => boolean]> = [];
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { filtros.push([col, (x: unknown) => x === v]); return q; },
      in: (col: string, vs: unknown[]) => { filtros.push([col, (x: unknown) => vs.includes(x)]); return q; },
      order: () => q,
      limit: () => q,
      then: (ok: any) => Promise.resolve({
        data: (tabelas[tabela] || []).filter(l => filtros.every(([c, ok]) => ok(l[c]))),
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
        { id: 1, lado: 'ponto', nome: 'Cadastrado', telefone: '5534999990001', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Sou o proprietário' },
        // cadastrou como PONTO, mas ainda negocia o local e tem dinheiro: e investidor
        { id: 2, lado: 'ponto', nome: 'Negocia', telefone: '5534999990005', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Estou negociando com o proprietário', capital_faixa: 'R$ 100 mil a R$ 200 mil' },
        // investidor que nunca disse o valor: curioso, fora dos dois pools
        { id: 3, lado: 'capital', nome: 'Sem valor', telefone: '5534999990006', cidade: 'Uberlândia-MG',
          capital_faixa: 'Depende do ponto' },
      ],
      eletroposto_nota1: [
        { id: 7, nome: 'Da ficha', telefone: '5534999990002', cidade: 'Uberlândia-MG',
          ficha: 'Tem ponto: Já tenho o ponto definido\nLocal é seu: Sou o proprietário' },
        // tem o local em vista e disse o valor: investidor
        { id: 8, nome: 'Em vista', telefone: '5534999990007', cidade: 'Uberlândia-MG',
          ficha: 'Local é seu: Ainda não é meu\nQuanto pretende investir: R$ 140 mil' },
        // em vista e nao disse o valor: curioso
        { id: 9, nome: 'Curioso', telefone: '5534999990008', cidade: 'Uberlândia-MG',
          ficha: 'Local é seu: Ainda não é meu' },
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

  it('quem ainda negocia o local e declarou dinheiro sai do ponto e vira investidor', async () => {
    const pontos = await pool('ponto');
    const capital = await pool('capital', new Set(pontos.map(p => p.telefone)));
    expect(pontos.some(p => p.telefone === '5534999990005')).toBe(false);
    expect(capital.find(c => c.telefone === '5534999990005')?.tab).toBe('parceria');
    expect(capital.find(c => c.telefone === '5534999990007')?.tab).toBe('nota1');
  });

  it('quem nao disse o valor (curioso) nao entra em pool nenhum', async () => {
    const pontos = await pool('ponto');
    const capital = await pool('capital', new Set(pontos.map(p => p.telefone)));
    for (const tel of ['5534999990006', '5534999990008']) {
      expect(pontos.some(p => p.telefone === tel)).toBe(false);
      expect(capital.some(c => c.telefone === tel)).toBe(false);
    }
  });
});
