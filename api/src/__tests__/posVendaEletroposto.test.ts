import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  POS_VENDA_PREFIX, chavePosVenda, MODELOS_POS_VENDA, ETAPAS_POS_VENDA, TRILHOS,
  trilhoDoModelo, catalogoPosVenda, montarPosVenda, type PosVenda,
} from '../services/agenda/posVendaEletroposto';

const AGORA = '2026-10-10T15:00:00.000Z';
const HOJE = '2026-10-10';

function criar(entrada: unknown = {}) {
  const r = montarPosVenda(entrada, null, AGORA, HOJE);
  if (!r.ok) throw new Error(`esperava ok, veio ${r.erro}`);
  return r.registro;
}
const erro = (entrada: unknown, atual: PosVenda | null = null) => {
  const r = montarPosVenda(entrada, atual, AGORA, HOJE);
  return r.ok ? null : r.erro;
};

describe('chave e catálogo', () => {
  it('a chave usa o prefixo', () => {
    expect(chavePosVenda(42)).toBe('pos_venda:42');
    expect(POS_VENDA_PREFIX).toBe('pos_venda:');
  });
  it('todo trilho começa em papeis', () => {
    for (const t of Object.values(TRILHOS)) expect(t[0]).toBe('papeis');
  });
  it('toda etapa de todo trilho existe no dicionário', () => {
    for (const t of Object.values(TRILHOS)) for (const e of t) expect(ETAPAS_POS_VENDA[e]).toBeTruthy();
  });
  it('os 6 modelos e o vazio têm trilho', () => {
    expect(Object.keys(TRILHOS).length).toBe(7);
    for (const m of MODELOS_POS_VENDA) expect(TRILHOS[m]).toBeTruthy();
  });
  it('modelo desconhecido cai no trilho vazio', () => {
    expect(trilhoDoModelo('xyz')).toEqual(['papeis']);
    expect(trilhoDoModelo('__proto__')).toEqual(['papeis']);
  });
  it('catálogo lista os modelos na ordem', () => {
    const c = catalogoPosVenda();
    expect(c.modelos.map(m => m.slug)).toEqual([...MODELOS_POS_VENDA]);
    expect(c.modelos[0].rotulo).toBe('Chave na mão');
    expect(c.modelos.find(m => m.slug === 'integrador')!.papeis).toBe('');
    expect(c.trilhos).toBe(TRILHOS);
  });
});

describe('criação', () => {
  it('padrões', () => {
    const r = criar({});
    expect(r).toEqual({
      modelo: '', valor: null, vendido_em: HOJE, etapa: 'papeis', etapa_desde: AGORA,
      previsto: '2026-10-17', responsavel: '', obs: '', por: '', em: AGORA,
    });
  });
  it('com modelo e valor', () => {
    const r = criar({ modelo: 'chave_na_mao', valor: 145000, por: ' Thiago ' });
    expect(r.etapa).toBe('papeis');
    expect(r.valor).toBe(145000);
    expect(r.por).toBe('Thiago');
  });
  it('valor arredonda em 2 casas', () => {
    expect(criar({ valor: 1234.5678 }).valor).toBe(1234.57);
    expect(criar({ valor: 0 }).valor).toBe(0);
  });
  it('responsavel e obs cortam e aparam', () => {
    const r = criar({ responsavel: `  ${'a'.repeat(60)}`, obs: 'b'.repeat(600), por: 'c'.repeat(60) });
    expect(r.responsavel.length).toBe(40);
    expect(r.obs.length).toBe(500);
    expect(r.por.length).toBe(40);
  });
});

describe('erros de validação', () => {
  it('corpo inválido', () => {
    for (const x of [null, undefined, 'x', 3, [1]]) expect(erro(x)).toBe('corpo_invalido');
  });
  it('modelo inválido', () => {
    expect(erro({ modelo: 'foo' })).toBe('modelo_invalido');
    expect(erro({ modelo: 3 })).toBe('modelo_invalido');
    expect(erro({ modelo: '' })).toBeNull();
  });
  it('valor inválido', () => {
    for (const v of ['100', NaN, Infinity, -1, 100_000_001]) expect(erro({ valor: v })).toBe('valor_invalido');
    expect(erro({ valor: 100_000_000 })).toBeNull();
    expect(erro({ valor: null })).toBeNull();
  });
  it('data inválida', () => {
    for (const d of ['2026-10-11', '2023-12-31', '2026-02-30', '10/10/2026', 20261010, '']) {
      expect(erro({ vendido_em: d })).toBe('data_invalida');
    }
    expect(erro({ vendido_em: '2024-01-01' })).toBeNull();
    expect(erro({ vendido_em: HOJE })).toBeNull();
  });
  it('vendido_em futuro é recusado', () => {
    expect(erro({ vendido_em: '2027-01-01' })).toBe('data_invalida');
  });
  it('etapa fora do trilho', () => {
    expect(erro({ etapa: 'credito' })).toBe('etapa_fora_do_trilho'); // modelo vazio
    expect(erro({ modelo: 'meio_a_meio', etapa: 'credito' })).toBe('etapa_fora_do_trilho');
    expect(erro({ modelo: 'chave_na_mao', etapa: 'credito' })).toBeNull();
    expect(erro({ etapa: 'nao_existe' })).toBe('etapa_fora_do_trilho');
  });
  it('texto que não é string vira texto_invalido', () => {
    for (const campo of ['obs', 'responsavel', 'por']) {
      for (const v of [{}, { a: 1 }, 5, null, ['x'], true]) expect(erro({ [campo]: v })).toBe('texto_invalido');
      expect(erro({ [campo]: 'ok' })).toBeNull();
    }
    const a = criar({ obs: 'antes', responsavel: 'Ana' });
    expect(erro({ obs: {} }, a)).toBe('texto_invalido');
    const r = montarPosVenda({ valor: 5 }, a, AGORA, HOJE); // ausente mantém
    expect(r.ok && r.registro.obs).toBe('antes');
  });
  it('previsto: hoje + 730 aceita, hoje + 731 recusa', () => {
    expect(erro({ previsto: '2028-10-09' })).toBeNull();
    expect(erro({ previsto: '2028-10-10' })).toBe('previsto_invalido');
  });
  it('previsto inválido', () => {
    for (const p of ['2023-12-31', '2028-10-11', '2026-13-01', 'amanhã', 5]) {
      expect(erro({ previsto: p })).toBe('previsto_invalido');
    }
    expect(erro({ previsto: '2028-10-09' })).toBeNull(); // hoje + 730
    expect(erro({ previsto: null })).toBeNull();
  });
});

describe('merge e troca de etapa', () => {
  const base = () => criar({ modelo: 'chave_na_mao', valor: 100, responsavel: 'Ana', obs: 'x', vendido_em: '2026-10-01' });

  it('campo ausente mantém o valor atual', () => {
    const a = base();
    const r = montarPosVenda({ obs: 'novo' }, a, '2026-10-12T10:00:00.000Z', '2026-10-12');
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro).toMatchObject({
      modelo: 'chave_na_mao', valor: 100, responsavel: 'Ana', obs: 'novo', vendido_em: '2026-10-01',
      etapa: 'papeis', etapa_desde: AGORA, previsto: a.previsto, em: '2026-10-12T10:00:00.000Z',
    });
  });
  it('valor null limpa', () => {
    const r = montarPosVenda({ valor: null }, base(), AGORA, HOJE);
    expect(r.ok && r.registro.valor).toBeNull();
  });
  it('troca de etapa reinicia etapa_desde e recalcula previsto pelo prazo', () => {
    const r = montarPosVenda({ etapa: 'credito' }, base(), '2026-10-20T09:00:00.000Z', '2026-10-20');
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro.etapa).toBe('credito');
    expect(r.registro.etapa_desde).toBe('2026-10-20T09:00:00.000Z');
    expect(r.registro.previsto).toBe('2026-11-19'); // +30
  });
  it('troca de etapa com previsto na entrada usa o que veio', () => {
    const r = montarPosVenda({ etapa: 'credito', previsto: '2026-12-01' }, base(), AGORA, HOJE);
    expect(r.ok && r.registro.previsto).toBe('2026-12-01');
  });
  it('soma de dias vira o mês e o ano sem escorregar', () => {
    const a = criar({ modelo: 'cotista' });
    const r = montarPosVenda({ etapa: 'captacao' }, a, '2026-12-20T00:00:00.000Z', '2026-12-20');
    expect(r.ok && r.registro.previsto).toBe('2027-03-20'); // +90
  });
  it('mesma etapa mantém etapa_desde e previsto', () => {
    const a = base();
    const r = montarPosVenda({ etapa: 'papeis' }, a, '2026-10-15T00:00:00.000Z', '2026-10-15');
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro.etapa_desde).toBe(a.etapa_desde);
    expect(r.registro.previsto).toBe(a.previsto);
  });
  it('mesma etapa com previsto na entrada troca só o previsto', () => {
    const a = base();
    const r = montarPosVenda({ previsto: '2026-11-01' }, a, AGORA, HOJE);
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro.previsto).toBe('2026-11-01');
    expect(r.registro.etapa_desde).toBe(a.etapa_desde);
  });
  it('previsto null explícito limpa a data sem trocar de etapa', () => {
    const a = base();
    expect(a.previsto).not.toBeNull();
    const r = montarPosVenda({ previsto: null }, a, AGORA, HOJE);
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro.previsto).toBeNull();
    expect(r.registro.etapa).toBe(a.etapa);
    expect(r.registro.etapa_desde).toBe(a.etapa_desde);
  });
  it('vendido_em igual a hoje é aceito', () => {
    const r = montarPosVenda({ vendido_em: HOJE }, base(), AGORA, HOJE);
    expect(r.ok && r.registro.vendido_em).toBe(HOJE);
  });
  it('concluido deixa previsto null', () => {
    const a = criar({ modelo: 'integrador' });
    const r = montarPosVenda({ etapa: 'concluido' }, a, AGORA, HOJE);
    expect(r.ok && r.registro.previsto).toBeNull();
  });
  it('troca de modelo que tira a etapa atual do trilho volta para a primeira', () => {
    const a = montarPosVenda({ etapa: 'credito' }, base(), AGORA, HOJE);
    if (!a.ok) throw new Error(a.erro);
    const r = montarPosVenda({ modelo: 'meio_a_meio' }, a.registro, '2026-10-11T00:00:00.000Z', '2026-10-11');
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro.etapa).toBe('papeis');
    expect(r.registro.etapa_desde).toBe('2026-10-11T00:00:00.000Z');
    expect(r.registro.previsto).toBe('2026-10-18');
  });
  it('troca de modelo que mantém a etapa preserva', () => {
    const a = montarPosVenda({ etapa: 'obra' }, base(), AGORA, HOJE);
    if (!a.ok) throw new Error(a.erro);
    const r = montarPosVenda({ modelo: 'arrendamento' }, a.registro, '2026-10-30T00:00:00.000Z', '2026-10-30');
    if (!r.ok) throw new Error(r.erro);
    expect(r.registro.etapa).toBe('obra');
    expect(r.registro.etapa_desde).toBe(a.registro.etapa_desde);
    expect(r.registro.previsto).toBe(a.registro.previsto);
  });
  it('modelo e etapa na mesma entrada valem juntos', () => {
    const r = montarPosVenda({ modelo: 'carregador', etapa: 'entrega' }, base(), AGORA, HOJE);
    expect(r.ok && r.registro.etapa).toBe('entrega');
  });
});

describe('as duas rotas em routes/gerador.ts', () => {
  const fonte = readFileSync(join(__dirname, '..', 'routes', 'gerador.ts'), 'utf8');
  it('existem POST e GET /pos-venda', () => {
    expect(fonte).toMatch(/router\.post\(\s*'\/pos-venda'/);
    expect(fonte).toMatch(/router\.get\(\s*'\/pos-venda'/);
  });
  it('usam o prefixo e a chave do módulo', () => {
    expect(fonte).toMatch(/chavePosVenda\(/);
    expect(fonte).toMatch(/POS_VENDA_PREFIX/);
  });
  it('o POST passa por montarPosVenda e grava com upsert por key', () => {
    const post = fonte.slice(fonte.indexOf("router.post('/pos-venda'"), fonte.indexOf("router.get('/pos-venda'"));
    expect(post).toMatch(/montarPosVenda\(/);
    expect(post).toMatch(/onConflict:\s*'key'/);
  });
  it('erro de banco não devolve a mensagem interna', () => {
    const rotas = fonte.slice(fonte.indexOf("router.post('/pos-venda'"), fonte.indexOf('// O PLACAR DO NÃO'));
    expect(rotas).not.toMatch(/detail:/);
  });
  it('a data de hoje é a de Brasília, não o relógio UTC', () => {
    expect(fonte).toMatch(/montarPosVenda\([^)]*diaDeBrasilia\(/);
  });
});
