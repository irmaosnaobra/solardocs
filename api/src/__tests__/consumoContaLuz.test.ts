import { describe, it, expect, vi, beforeEach } from 'vitest';

// Consumo médio lido da conta de luz (20/11/2026): (1) o parse da leitura (histórico, só o mês, lixo) e (2) a releitura ÚNICA das obras cuja conta de luz foi
// lida antes da mudança e ficaram sem o consumo médio. Os bancos, o armazenamento e a IA são simulados; o registro das leituras (`leituraRegistro.ts`) é o de verdade,
// numa memória em vez do bucket.

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  trilhos: new Map<string, Promise<unknown>>(),
  fila: [] as Promise<unknown>[],
  aberta: true,
  consumo: '' as string,
  ia: { ok: true } as { ok: boolean },
  arquivos: [] as unknown[],
  leiturasDoCadastro: 0,
}));

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({}) }));
vi.mock('../utils/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock('../utils/waitUntil', () => ({ waitUntil: (p: Promise<unknown>) => { h.fila.push(p); } }));
vi.mock('../services/gerador/cadastroVendaBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVendaBanco')>()),
  lerJsonBruto: async (c: string) => (h.store.has(c) ? JSON.parse(JSON.stringify(h.store.get(c))) : null),
  gravarJsonBruto: async (c: string, v: unknown) => { h.store.set(c, JSON.parse(JSON.stringify(v))); },
  // a trava de verdade serializa quem pega a mesma chave: aqui, uma fila por chave
  comTrava: async (id: string, _por: string, fn: () => Promise<unknown>) => {
    const antes = h.trilhos.get(id) ?? Promise.resolve();
    const esta = antes.then(fn, fn);
    h.trilhos.set(id, esta.catch(() => undefined));
    return esta;
  },
}));
vi.mock('../services/gerador/docsClienteBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/docsClienteBanco')>()),
  lerDocsComVersao: async () => ({ reg: { arquivos: h.arquivos }, versao: 'v' }),
  baixarObjeto: async () => Buffer.from('%PDF-1.4 conta de luz'),
}));
vi.mock('../services/gerador/cadastroVenda', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVenda')>()),
  lerCadastro: async () => { h.leiturasDoCadastro++; return { campos: h.consumo ? { consumo_medio_kwh: { valor: h.consumo } } : {} }; },
}));
vi.mock('../services/gerador/cadastroVendaLeitura', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVendaLeitura')>()),
  lerDocumentosDaVenda: vi.fn(async (arquivos: Array<{ id: string }>) => (h.ia.ok
    ? { ok: true, aceitos: arquivos.map((a) => a.id), sugestoes: {}, origens: {}, documentos: [], comercial: {}, ignorados: [], descartadas: [] }
    : { ok: false, motivo: 'ia_indisponivel', transitorio: true })),
}));
vi.mock('../services/gerador/cadastroLeituraAuto', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroLeituraAuto')>()),
  contextoDaLeitura: async () => ({ pessoas: {}, nomesDados: new Map(), rotulados: new Set(), dicas: new Map() }),
}));
vi.mock('../services/gerador/leituraGravacao', () => ({
  obraAbertaParaIa: async () => h.aberta,
  aplicarLeitura: vi.fn(async () => ({ campos: ['consumo_medio_kwh'], comercial: [], deOutraPessoa: 0 })),
}));
vi.mock('../services/gerador/vendaSolarHub', async (orig) => ({ ...(await orig<typeof import('../services/gerador/vendaSolarHub')>()), invalidarCachesHub: () => {} }));

import { limparSugestoes, lerDocumentosDaVenda } from '../services/gerador/cadastroVendaLeitura';
import { consumoDaLeitura } from '../services/gerador/consumoContaLuz';
import { leituraDaObra } from '../services/gerador/leituraPendente';
import { aplicarLeitura } from '../services/gerador/leituraGravacao';
import { normalizarRegistro } from '../services/gerador/leituraRegistro';
import type { ArquivoDoc } from '../services/gerador/docsCliente';

const arq = (id: string, slot: string): ArquivoDoc => ({ id, slot, caminho: `vendasolar/7/${id}.pdf`, mime: 'application/pdf', bytes: 21, em: '2026-11-01T12:00:00.000Z', por: 'nilce' });
const poe = (...a: ArquivoDoc[]): void => { h.arquivos = a; };
const REG = 'vendasolar/7.leitura.json';
const registro = (extra: Record<string, unknown> = {}) => ({ v: 1, lidos: [], arquivos: [{ id: 'c1' }, { id: 'd1' }], rodando: null, falha_em: null, ultima_em: null, falha_ids: [], falha_n: 0, modo_unico: false, ...extra });
const G = { card: { id: 7, cliente_nome: 'Cliente' }, nome: 'giovanna' };
const abrir = async () => leituraDaObra({ ...G, arquivos: h.arquivos as ArquivoDoc[] });
const esperar = async (): Promise<void> => { await Promise.all(h.fila.splice(0)); };
const chamadas = (): number => vi.mocked(lerDocumentosDaVenda).mock.calls.length;

beforeEach(() => {
  h.store.clear(); h.trilhos.clear(); h.fila.length = 0; h.aberta = true; h.consumo = ''; h.ia.ok = true; h.leiturasDoCadastro = 0;
  vi.mocked(lerDocumentosDaVenda).mockClear(); vi.mocked(aplicarLeitura).mockClear();
  poe(arq('c1', 'conta_luz'), arq('d1', 'documento_titular'));
  h.store.set(REG, registro());
});

describe('parse do consumo médio lido da conta', () => {
  const arquivos = [arq('c1', 'conta_luz')];
  const documentos = [{ id: 'c1', slot: 'conta_luz', tipo: 'conta_luz', rotulo: '', nota: '' }];
  const lido = (valor: string, confianca = 'alta') => limparSugestoes({ campos: [{ campo: 'consumo_medio_kwh', valor, indice: 1, confianca, nota: '' }] }, { arquivos, documentos, linha: 'vendasolar' });

  it('média do histórico (12 ou 13 meses) vira inteiro: 412.5 -> 413, "1.234,5" -> 1235, "350 kWh" -> 350', () => {
    expect(lido('412.5').sugestoes.consumo_medio_kwh).toMatchObject({ valor: '413', slot: 'conta_luz', confianca: 'alta' });
    expect(lido('1.234,5').sugestoes.consumo_medio_kwh.valor).toBe('1235');
    expect(lido('350 kWh').sugestoes.consumo_medio_kwh.valor).toBe('350');
    expect(lido('1').sugestoes.consumo_medio_kwh.valor).toBe('1');
    expect(lido('100000').sugestoes.consumo_medio_kwh.valor).toBe('100000');
  });
  it('sem histórico a IA manda o consumo do mês faturado (confiança média): vale igual', () => {
    const r = lido('287', 'media');
    expect(r.sugestoes.consumo_medio_kwh).toMatchObject({ valor: '287', confianca: 'media' });
    expect(r.descartadas).toEqual([]);
  });
  it('lixo é descartado com o motivo, sem gravar sugestão: texto, zero, negativo, 0.4, acima de 100.000, valor em reais', () => {
    for (const lixo of ['abc', '0', '-5', '0.4', '100001', '250000', 'R$ 350,00', '12/2025', '3 meses']) {
      const r = lido(lixo);
      expect(r.sugestoes.consumo_medio_kwh, lixo).toBeUndefined();
      expect(r.descartadas, lixo).toEqual([{ campo: 'consumo_medio_kwh', slot: 'conta_luz', nota: expect.stringContaining('1 a 100.000') }]);
    }
  });
  it('consumoDaLeitura: o que não é texto não serve', () => {
    expect(consumoDaLeitura(412 as unknown)).toBeNull();
    expect(consumoDaLeitura(null)).toBeNull();
    expect(consumoDaLeitura('')).toBeNull();
    expect(consumoDaLeitura('350')).toBe('350');
  });
});

describe('releitura única da conta de luz para o consumo médio', () => {
  it('conta já lida, consumo vazio, nada pendente: relê SÓ a conta de luz, grava a marca, e abrir de novo não repete', async () => {
    const a = await abrir();
    expect(a.rodando).toBe(true);
    await esperar();
    expect(chamadas()).toBe(1);
    const lidos = vi.mocked(lerDocumentosDaVenda).mock.calls[0][0] as ArquivoDoc[];
    expect(lidos.map((x) => x.id)).toEqual(['c1']);   // o documento do titular não volta à IA
    expect(vi.mocked(lerDocumentosDaVenda).mock.calls[0][1]).toMatchObject({ linha: 'vendasolar' });
    expect(vi.mocked(aplicarLeitura)).toHaveBeenCalledTimes(1);
    const reg = normalizarRegistro(h.store.get(REG));
    expect(reg.consumo_relido).toBeTruthy();
    expect(reg.rodando).toBeNull();
    for (let i = 0; i < 3; i++) { await abrir(); await esperar(); }
    expect(chamadas()).toBe(1);   // sem laço
  });
  it('três GETs ao mesmo tempo fazem UMA releitura só', async () => {
    await Promise.all([abrir(), abrir(), abrir()]);
    await esperar();
    expect(chamadas()).toBe(1);
  });
  it('a IA falhou: a marca já está gravada, e nem passada a espera de 10 min a releitura volta', async () => {
    h.ia.ok = false;
    await abrir(); await esperar();
    expect(chamadas()).toBe(1);
    const reg = h.store.get(REG) as Record<string, unknown>;
    expect(reg.consumo_relido).toBeTruthy();
    h.store.set(REG, { ...reg, falha_em: null });   // como se os 10 minutos tivessem passado
    h.ia.ok = true;
    await abrir(); await esperar();
    expect(chamadas()).toBe(1);
  });
  it('consumo já preenchido: não relê, grava a marca UMA vez, e os GETs seguintes nem leem o cadastro de novo', async () => {
    h.consumo = '412';
    const a = await abrir(); await esperar();
    expect(a.rodando).toBe(false);
    expect(chamadas()).toBe(0);
    expect(h.leiturasDoCadastro).toBe(1);
    const marca = normalizarRegistro(h.store.get(REG)).consumo_relido;
    expect(marca).toBeTruthy();
    for (let i = 0; i < 4; i++) { await abrir(); await esperar(); }
    expect(h.leiturasDoCadastro).toBe(1);   // sem custo a mais em todo GET
    expect(normalizarRegistro(h.store.get(REG)).consumo_relido).toBe(marca);   // a marca não é regravada
    expect(chamadas()).toBe(0);
  });
  it('consumo preenchido com a IA em espera de 10 min: a marca entra do mesmo jeito', async () => {
    h.consumo = '412';
    h.store.set(REG, registro({ falha_em: new Date().toISOString() }));
    await abrir(); await esperar();
    expect(normalizarRegistro(h.store.get(REG)).consumo_relido).toBeTruthy();
  });
  it('a releitura que falha NÃO põe a leitura normal em espera: documento novo da mesma obra é lido na hora', async () => {
    h.ia.ok = false;
    await abrir(); await esperar();
    expect(chamadas()).toBe(1);
    const reg = normalizarRegistro(h.store.get(REG));
    expect(reg.falha_em).toBeNull();
    expect(reg.consumo_relido).toBeTruthy();
    // chega um documento novo (enviado há mais de 3 min) e a IA volta: a leitura normal não espera os 10 min da falha
    h.ia.ok = true;
    poe(arq('c1', 'conta_luz'), arq('d1', 'documento_titular'), arq('n1', 'comprovante_endereco_comprador'));
    const e = await abrir(); await esperar();
    expect(e.pendentes).toBe(1);
    expect(chamadas()).toBe(2);
    const lidos = vi.mocked(lerDocumentosDaVenda).mock.calls[1][0] as ArquivoDoc[];
    expect(lidos.map((x) => x.id)).toEqual(['n1']);
    // e a releitura do consumo não volta
    await abrir(); await esperar();
    expect(chamadas()).toBe(2);
  });
  it('obra finalizada, cancelada ou com a conta fechada: não relê nada', async () => {
    h.aberta = false;
    const e = await abrir(); await esperar();
    expect(e).toMatchObject({ rodando: false, pendentes: 0 });
    expect(chamadas()).toBe(0);
    expect(normalizarRegistro(h.store.get(REG)).consumo_relido).toBeUndefined();
  });
  it('sem conta de luz lida (só a da beneficiária, a IA já desistiu dela, ou nenhuma): não relê', async () => {
    poe(arq('b1', 'conta_luz_beneficiaria'), arq('d1', 'documento_titular'));
    h.store.set(REG, registro({ arquivos: [{ id: 'b1' }, { id: 'd1' }] }));
    await abrir(); await esperar();
    poe(arq('c1', 'conta_luz'));
    h.store.set(REG, registro({ arquivos: [{ id: 'c1', falhou: true }] }));
    await abrir(); await esperar();
    poe();
    h.store.set(REG, registro({ arquivos: [] }));
    await abrir(); await esperar();
    expect(chamadas()).toBe(0);
  });
  it('registro que já tem a marca (releitura feita) não relê, mesmo com o consumo vazio', async () => {
    h.store.set(REG, registro({ consumo_relido: '2026-11-20T10:00:00.000Z' }));
    await abrir(); await esperar();
    expect(chamadas()).toBe(0);
  });
  it('a marca sobrevive ao registro normalizado e some de registro antigo ou torto', () => {
    expect(normalizarRegistro({ v: 1, consumo_relido: '2026-11-20T10:00:00.000Z' }).consumo_relido).toBe('2026-11-20T10:00:00.000Z');
    expect(normalizarRegistro({ v: 1, consumo_relido: 'ontem' }).consumo_relido).toBeUndefined();
    expect('consumo_relido' in normalizarRegistro({ v: 1 })).toBe(false);
  });
});
