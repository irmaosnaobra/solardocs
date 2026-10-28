import { describe, it, expect } from 'vitest';
import {
  CHECKLIST, ATIVIDADES, Dados, calcularSelo, codigoLegivel, dadosPadrao, dataPorExtenso, diasEntre, faltamStatus,
  hojeBRT, montarConclusao, montarResumo, normalizarDados, pendencias, proximoCodigo, somarMeses,
} from '../services/manutencao/relatorio';

// Regras do relatório de manutenção preventiva: tudo função pura, sem banco.

const itens = (mapa: Record<string, 'conforme' | 'atencao' | 'nao_conforme' | 'na' | null>) =>
  CHECKLIST.map((c) => ({ key: c.key, status: c.key in mapa ? mapa[c.key]! : 'conforme', visto: '', providencia: '' }));

describe('calcularSelo', () => {
  it('tudo conforme, com "não se aplica" que não pesa', () => {
    expect(calcularSelo(itens({ dps: 'na' }))).toBe('conforme');
  });
  it('um item em atenção basta', () => {
    expect(calcularSelo(itens({ cabos: 'atencao' }))).toBe('atencao');
  });
  it('não conforme vence atenção', () => {
    expect(calcularSelo(itens({ cabos: 'atencao', dps: 'nao_conforme' }))).toBe('nao_conforme');
  });
  it('item sem status não pesa', () => {
    expect(calcularSelo(itens({ cabos: null }))).toBe('conforme');
  });
});

describe('pendencias', () => {
  it('alta primeiro, depois a ordem do checklist; "na" e conforme ficam fora', () => {
    const lista = pendencias(itens({ modulos: 'atencao', cabos: 'nao_conforme', dps: 'atencao', inversor: 'nao_conforme', aterramento: 'na' }));
    expect(lista.map((p) => p.key)).toEqual(['cabos', 'inversor', 'modulos', 'dps']);
    expect(lista.map((p) => p.prioridade)).toEqual(['alta', 'alta', 'media', 'media']);
    expect(lista[0]).toMatchObject({ label: 'Cabos e conectores', status: 'nao_conforme' });
  });
  it('leva o que foi visto e a providência', () => {
    const base = itens({ modulos: 'atencao' });
    base[0] = { ...base[0]!, visto: 'sujeira', providencia: 'lavar' };
    expect(pendencias(base)[0]).toMatchObject({ visto: 'sujeira', providencia: 'lavar', prioridade: 'media' });
  });
  it('sem problema, lista vazia', () => {
    expect(pendencias(itens({}))).toEqual([]);
  });
});

describe('faltamStatus', () => {
  it('conta os itens do checklist sem status', () => {
    expect(faltamStatus(itens({ modulos: null, dps: null }))).toBe(2);
    expect(faltamStatus(itens({}))).toBe(0);
  });
  it('item que nem veio na lista também falta', () => {
    expect(faltamStatus([])).toBe(9);
  });
});

describe('somarMeses', () => {
  it('31/08 + 6 meses corta no fim de fevereiro', () => {
    expect(somarMeses('2026-08-31', 6)).toBe('2027-02-28');
  });
  it('vira o ano e respeita ano bissexto', () => {
    expect(somarMeses('2026-10-27', 3)).toBe('2027-01-27');
    expect(somarMeses('2027-11-30', 3)).toBe('2028-02-29');
    expect(somarMeses('2026-12-31', 12)).toBe('2027-12-31');
  });
  it('trimestral, semestral e anual comuns', () => {
    expect(somarMeses('2026-10-27', 6)).toBe('2027-04-27');
    expect(somarMeses('2026-10-27', 12)).toBe('2027-10-27');
  });
});

describe('datas', () => {
  it('data por extenso com mês em minúscula', () => {
    expect(dataPorExtenso('2027-04-27')).toBe('27 de abril de 2027');
    expect(dataPorExtenso('2027-03-05')).toBe('5 de março de 2027');
  });
  it('dias entre datas, negativo quando vencida', () => {
    expect(diasEntre('2026-10-27', '2026-10-30')).toBe(3);
    expect(diasEntre('2026-10-27', '2026-10-20')).toBe(-7);
    expect(diasEntre('2026-10-27', '2026-10-27')).toBe(0);
  });
  it('hoje em Brasília, não em UTC: 01h UTC ainda é o dia anterior', () => {
    expect(hojeBRT(new Date('2026-10-28T01:30:00Z'))).toBe('2026-10-27');
    expect(hojeBRT(new Date('2026-10-28T03:30:00Z'))).toBe('2026-10-28');
  });
});

describe('proximoCodigo', () => {
  it('começa em 001 e soma ao maior do ano', () => {
    expect(proximoCodigo([], 2026)).toBe('MP2026001');
    expect(proximoCodigo(['MP2026001', 'MP2026007', 'MP2025099', null], 2026)).toBe('MP2026008');
  });
  it('ano novo recomeça', () => {
    expect(proximoCodigo(['MP2026012'], 2027)).toBe('MP2027001');
  });
  it('código legível', () => {
    expect(codigoLegivel('MP2026001')).toBe('MP-2026-001');
  });
});

const dadosBase = (extra: Partial<Dados> = {}): Dados => ({
  ...dadosPadrao(),
  sistema: { tipo: 'residencial', qtd_modulos: 20, potencia_kwp: 8.2, modulo_modelo: '', inversores: [], telhado: [], endereco: '' },
  ...extra,
});

describe('montarConclusao', () => {
  it('conforme, com potência', () => {
    const d = dadosBase({ itens: itens({}) });
    expect(montarConclusao(d, 'conforme', '2027-04-27')).toBe(
      'Nesta visita foram registradas 2 atividades de manutenção preventiva no sistema residencial, de 20 módulos e 8,2 kWp. ' +
      'Todos os itens inspecionados estavam conformes no momento da visita. A próxima visita está prevista para 27 de abril de 2027, com periodicidade semestral.',
    );
  });
  it('sem potência some o "e kWp"', () => {
    const d = dadosBase({ itens: itens({}), sistema: { ...dadosBase().sistema, potencia_kwp: null } });
    expect(montarConclusao(d, 'conforme', '2027-04-27')).toContain('no sistema residencial, de 20 módulos. Todos');
  });
  it('sem módulos a frase vira "no sistema residencial de 8,2 kWp"', () => {
    const d = dadosBase({ itens: itens({}), sistema: { ...dadosBase().sistema, qtd_modulos: null } });
    expect(montarConclusao(d, 'conforme', '2027-04-27')).toContain('manutenção preventiva no sistema residencial de 8,2 kWp. Todos');
    const so = dadosBase({ itens: itens({}), sistema: { ...dadosBase().sistema, qtd_modulos: null, potencia_kwp: null } });
    expect(montarConclusao(so, 'conforme', '2027-04-27')).toContain('manutenção preventiva no sistema residencial. Todos');
  });
  it('com 1 atividade usa o singular', () => {
    const d = dadosBase({
      itens: itens({}),
      atividades: ATIVIDADES.map((a) => ({ key: a.key, feita: a.key === 'limpeza', status: 'concluido' as const, obs: '' })),
    });
    expect(montarConclusao(d, 'conforme', '2027-04-27')).toContain('Nesta visita foi registrada 1 atividade de manutenção');
  });
  it('atenção lista os itens com sigla em maiúscula', () => {
    const d = dadosBase({ itens: itens({ modulos: 'atencao', dps: 'atencao' }) });
    const t = montarConclusao(d, 'atencao', '2027-04-27');
    expect(t).toContain('Não há não conformidade registrada, mas módulos e DPS pedem acompanhamento e ajuste.');
    expect(t).toContain('prevista para 27 de abril de 2027.');
  });
  it('atenção com 1 item usa o verbo no singular', () => {
    const d = dadosBase({ itens: itens({ dps: 'atencao' }) });
    const t = montarConclusao(d, 'atencao', '2027-04-27');
    expect(t).toContain('mas DPS pede acompanhamento e ajuste.');
    expect(t).toContain('Recomendamos tratar esse ponto antes que evolua, e reavaliá-lo na próxima visita');
  });
  it('não conforme com 1 item usa o singular completo', () => {
    const d = dadosBase({ itens: itens({ dps: 'nao_conforme' }) });
    const t = montarConclusao(d, 'nao_conforme', '2027-04-27');
    expect(t).toContain('Foi encontrada não conformidade em DPS, que precisa de correção. Enquanto não for corrigida, pode comprometer');
    expect(t).toContain('tratar a prioridade antes');
  });
  it('lista de três usa vírgula e "e", e o quadro CC perde o complemento', () => {
    const d = dadosBase({ itens: itens({ modulos: 'atencao', stringbox: 'atencao', quadro_ca: 'atencao' }) });
    expect(montarConclusao(d, 'atencao', '2027-04-27')).toContain('mas módulos, quadro CC e quadro CA pedem');
  });
  it('não conforme cita só os itens não conformes', () => {
    const d = dadosBase({ itens: itens({ cabos: 'nao_conforme', modulos: 'atencao' }), periodicidade_meses: 3 });
    const t = montarConclusao(d, 'nao_conforme', '2027-01-27');
    expect(t).toContain('Foi encontrada não conformidade em cabos e conectores, que precisa de correção.');
    expect(t).not.toContain('conectores e módulos');
    expect(t).toContain('prevista para 27 de janeiro de 2027.');
  });
});

describe('normalizarDados e resumo', () => {
  it('remonta na ordem fixa e descarta chave desconhecida', () => {
    const d = normalizarDados({
      itens: [{ key: 'inversor', status: 'atencao', visto: 'x', providencia: '' }, { key: 'inventado', status: 'conforme', visto: '', providencia: '' }],
    });
    expect(d.itens.map((i) => i.key)).toEqual(CHECKLIST.map((c) => c.key));
    expect(d.itens.find((i) => i.key === 'inversor')?.status).toBe('atencao');
    expect(d.itens.find((i) => i.key === 'modulos')?.status).toBeNull();
    expect(d.atividades.map((a) => a.key)).toEqual(ATIVIDADES.map((a) => a.key));
  });
  it('relatório novo: limpeza e inspeção visual feitas, semestral', () => {
    const d = dadosPadrao({ nome: 'Ana', registro: 'CFT 1' });
    expect(d.atividades.filter((a) => a.feita).map((a) => a.key)).toEqual(['limpeza', 'inspecao_visual']);
    expect(d.periodicidade_meses).toBe(6);
    expect(d.responsavel).toEqual({ nome: 'Ana', registro: 'CFT 1' });
    expect(faltamStatus(d.itens)).toBe(9);
  });
  it('resumo junta selo, pendências, faltam e próxima visita', () => {
    const d = dadosBase({ itens: itens({ dps: 'atencao' }), periodicidade_meses: 6 });
    const r = montarResumo(d, '2026-08-31');
    expect(r).toMatchObject({ selo: 'atencao', faltam_status: 0, proxima_visita: '2027-02-28' });
    expect(r.pendencias).toHaveLength(1);
    expect(r.conclusao_sugerida).toContain('28 de fevereiro de 2027');
  });
});
