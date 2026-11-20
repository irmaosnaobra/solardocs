import { describe, it, expect } from 'vitest';
import type { ItemCompra } from '../services/gerador/jornadaObra';
import { serieDoInversor } from '../services/gerador/compraKit';
import { camposDoTermo } from '../services/gerador/termoGarantia';
import { equipamentoFinal, itensParaTermo } from '../services/gerador/equipamentoFinal';

// A série do inversor é digitada só no Monitoramento (Entrega). Quem LÊ usa essa e, vazia, cai para a série do item inversor da Compra (da NF).
const AGORA = '2026-11-20T12:00:00.000Z';
const item = (id: string, o: Partial<ItemCompra> = {}): ItemCompra => ({
  id, origem: 'manual', tipo: 'outro', descricao: id, quantidade: 1, unidade: 'un', marca: '', modelo: '', potencia_w: null, potencia_kw: null,
  garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: null, fornecedor: '', valor_centavos: null, data: null,
  etapa: 4, criado_por: 'thiago', criado_em: AGORA, comprado: true, orcado_centavos: null, lido_de: '', documento_id: '', serie: '', ...o,
});
const inv = (serie: string): ItemCompra => item('i-2', { tipo: 'inversor', marca: 'SAJ', modelo: 'R5 8K', potencia_kw: 8, serie });

describe('série do inversor: Monitoramento primeiro, item da Compra como fallback', () => {
  it('serieDoInversor devolve a do item e vazio sem ela', () => {
    expect(serieDoInversor([inv('NF-123')])).toBe('NF-123');
    expect(serieDoInversor([inv('')])).toBe('');
  });
  it('equipamentoFinal (planilha e Resumo): a do Monitoramento vale; vazia, cai para a do item', () => {
    expect(equipamentoFinal([inv('NF-123')], null, [], 'MON-9').inversores[0].serie).toBe('MON-9');
    expect(equipamentoFinal([inv('NF-123')], null, [], '').inversores[0].serie).toBe('NF-123');
    expect(equipamentoFinal([inv('')], null, [], '').inversores[0].serie).toBe('');
  });
  it('termo de garantia (de onde a trava do Book lê): sem série no Monitoramento, a do item entra', () => {
    const base = { codigo: '#1', privadaContrato: null, termoEntrega: { assinado_em: '2026-10-30T15:00:00.000Z' }, entregaYmd: '2026-10-30' };
    const com = camposDoTermo({ ...base, itensCompra: itensParaTermo([inv('NF-123')]), monitoramento: { serie: '' } });
    expect(com.inversores[0].serie).toBe('NF-123');
    const mon = camposDoTermo({ ...base, itensCompra: itensParaTermo([inv('NF-123')]), monitoramento: { serie: 'MON-9' } });
    expect(mon.inversores[0].serie).toBe('MON-9');
    const sem = camposDoTermo({ ...base, itensCompra: itensParaTermo([inv('')]), monitoramento: { serie: '' } });
    expect(sem.inversores[0].serie).toBe('');
  });
});
