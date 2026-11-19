import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { kitVendido, relatorioFinalHtml, resumoDaVistoria, type EntradaRelatorio } from '../services/gerador/relatorioFinal';
import { assinarJornada, normalizarJornada, jornadaAssinada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado, marcaDoValor } from '../services/gerador/jornadaSolar';
import type { VistoriaObra } from '../services/gerador/jornadaObra';

// Relatório final (PDF) e o estado da etapa 1: regras puras. Dados inventados.

const entrada = (o: Partial<EntradaRelatorio> = {}): EntradaRelatorio => ({
  cliente: 'Ana Souza', codigo: '#0061', emitidoEm: '2026-11-18T12:00:00.000Z',
  secoes: [{ numero: 2, titulo: 'Informações do cliente', campos: [{ rotulo: 'Nome', valor: 'Ana Souza' }, { rotulo: 'Telefone', valor: '(34) 99999-0001' }] }, { numero: 9, titulo: 'Vazia', campos: [] }],
  kit: { placas: '14 × Canadian CS7N 590 W', inversor: '1 × Growatt 10K', kwp: 8.26, faltando: [], manual: [] },
  excedente: { tem: true, linhas: [{ papel: 'geradora', uc: '123', titular: 'Ana Souza', pct: 80 }, { papel: 'beneficiaria', uc: '456', titular: 'Ana Souza', pct: 20 }] },
  vistoria: [{ grupo: 'Telhado', campos: [['Tipo', 'colonial']] }],
  documentos: [{ rotulo: 'KMZ do local', data: '18/11/2026' }, { rotulo: 'Datasheet do inversor', data: '17/11/2026' }],
  fotos: [{ legenda: 'Fachada', url: 'https://storage.exemplo/f1.jpg' }, { legenda: 'Maliciosa', url: 'javascript:alert(1)' }],
  larguraFoto: '31%', ...o,
});

describe('relatorioFinalHtml', () => {
  it('leva cliente, kit com kWp, excedente e rateio, vistoria, miniaturas e a lista de arquivos com data', () => {
    const h = relatorioFinalHtml(entrada());
    expect(h).toContain('Relatório final · #0061');
    expect(h).toContain('emitido em 18/11/2026');
    expect(h).toContain('Informações do cliente');
    expect(h).not.toContain('Vazia');   // seção sem campo não sai
    expect(h).toContain('14 × Canadian CS7N 590 W');
    expect(h).toContain('8,26 kWp');
    expect(h).toContain('Geradora · UC 123');
    expect(h).toContain('Beneficiária · UC 456');
    expect(h).toContain('20%');
    expect(h).toContain('<h3>Telhado</h3>');
    expect(h).toContain('KMZ do local');
    expect(h).toContain('18/11/2026');
    expect(h).toContain('<img src="https://storage.exemplo/f1.jpg"');
    expect(h).not.toContain('javascript:');   // só URL https vira miniatura
  });
  it('escapa todo texto, não tem script e não tem dinheiro, contrato assinado nem recibo', () => {
    const h = relatorioFinalHtml(entrada({ cliente: '<script>alert(1)</script> & "x"', secoes: [{ numero: 2, titulo: 'T <b>', campos: [{ rotulo: '<i>', valor: "o'brien" }] }] }));
    expect(h).not.toMatch(/<script/i);
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(h).toContain('o&#39;brien');
    const limpo = relatorioFinalHtml(entrada());
    expect(limpo).not.toMatch(/R\$|valor vendido|pagamento|entrada de|parcela|recibo|contrato assinado/i);
  });
  it('sem dado diz que não há: sem vistoria, sem excedente, sem arquivo, sem kit', () => {
    const h = relatorioFinalHtml(entrada({ kit: null, vistoria: [], documentos: [], fotos: [], excedente: { tem: null, linhas: [] } }));
    expect(h).toContain('Relatório de vistoria não preenchido.');
    expect(h).toContain('Nenhum arquivo anexado.');
    expect(h).toContain('Não informado.');
    expect(h).not.toContain('Fotos da vistoria');
    expect(relatorioFinalHtml(entrada({ excedente: { tem: false, linhas: [] } }))).toContain('Sem excedente para outras contas.');
  });
});

describe('kitVendido e resumoDaVistoria', () => {
  it('kitVendido: texto, kWp da proposta ou calculado, null sem proposta', () => {
    const e = { qtdPlacas: 14, modeloPlaca: 'Canadian', potPlaca: 590, qtdInversor: 1, inversor: 'Growatt' };
    expect(kitVendido(e, undefined)).toEqual({ placas: '14 × Canadian 590 W', inversor: '1 × Growatt', kwp: 8.26, faltando: [], manual: [] });
    expect(kitVendido(e, 8.5).kwp).toBe(8.5);
    expect(kitVendido(e, 'x').kwp).toBe(8.26);
    expect(kitVendido(null, null)).toEqual({ placas: '', inversor: '', kwp: null, faltando: ['placas', 'inversor'], manual: [] });
    expect(kitVendido({ ...e, qtdPlacas: null, potPlaca: null }, null).kwp).toBeNull();
    // proposta incompleta: o texto escrito à mão ocupa o lugar; sem texto, o que falta é listado
    const sem = { ...e, modeloPlaca: '', inversor: '' };
    expect(kitVendido(sem, null, { placas: '14 x Canadian 590 W' })).toMatchObject({ placas: '14 x Canadian 590 W', inversor: '1', faltando: ['inversor'], manual: ['placas'] });
    expect(kitVendido(sem, null, { placas: '14 x Canadian 590 W', inversor: '1 x Growatt' })).toMatchObject({ inversor: '1 x Growatt', faltando: [], manual: ['placas', 'inversor'] });
    expect(kitVendido(sem, null).faltando).toEqual(['placas', 'inversor']);
    expect(kitVendido(e, null, { placas: 'texto ignorado', inversor: 'idem' }).placas).toBe('14 × Canadian 590 W');   // com dado na proposta, o dela vale
  });
  it('resumoDaVistoria: só os campos preenchidos, por grupo; conclusão por extenso; fotos não entram', () => {
    expect(resumoDaVistoria(null)).toEqual([]);
    const v = { data: '2026-11-18', quem: 'Nilce', acomp: '', concl: 'adeq', adeq: ['trocar disjuntor'], obs: '', telhado: { tipo: 'colonial', estado: '' }, entrada: { padrao: 'bifásico' }, inversor: {}, fotos: [{ arquivo_id: 'a', leg: '', txt: '' }] } as unknown as VistoriaObra;
    const r = resumoDaVistoria(v);
    expect(r.map((g) => g.grupo)).toEqual(['Vistoria', 'Telhado', 'Padrão de entrada']);
    expect(r[0].campos).toEqual([['Data', '2026-11-18'], ['Quem fez', 'Nilce'], ['Conclusão', 'Apto com adequações'], ['Adequações', 'trocar disjuntor']]);
    expect(r[1].campos).toEqual([['Tipo', 'colonial']]);
  });
});

describe('estado da etapa 1: confirmados, pedidos e financiamento', () => {
  const AGORA = '2026-11-18T12:00:00.000Z';
  const base = () => ({ ...estadoMaterializado(10, 'Nilce', 1, AGORA), origem: 'vendido' as const });
  const comJsonb = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).reverse()) : x)));
  it('estado antigo (sem os campos novos) sai IGUAL: a assinatura de quem já existe continua valendo', () => {
    process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
    const e = normalizarJornada(10, base())!;
    expect(Object.keys(e.etapas[1])).toEqual(['aberta_em', 'concluida_em', 'concluida_por', 'excedente']);
    const sig = assinarJornada(10, e);
    expect(jornadaAssinada(10, { ...(comJsonb(e) as object), sig })).toEqual(e);
    delete process.env.VINCULO_SOLAR_SECRET;
  });
  it('confirmados, pedidos e financiamento: gravam, passam pelo jsonb e continuam assinados; chave desconhecida e marca torta caem', () => {
    process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
    const e = base();
    const marca = marcaDoValor('nome', 'Ana');
    (e.etapas[1] as unknown as Record<string, unknown>).financiamento = 'financeira';
    (e.etapas[1] as unknown as Record<string, unknown>).confirmados = {
      valor: { em: AGORA, por: 'Nilce', marca }, nome: { em: AGORA, por: 'nilce', marca }, chave_nova: { em: AGORA, por: 'x', marca }, email: { em: AGORA, por: 'x', marca: 'torta' }, telefone: { em: 'ontem', por: 'x', marca },
    };
    (e.etapas[1] as unknown as Record<string, unknown>).kit_texto = { inversor: ' 1 x Growatt ', placas: 'ab', outro: 'xxxx' };
    (e.etapas[1] as unknown as Record<string, unknown>).pedidos = { pedido_fachada: { em: AGORA, por: 'nilce' }, pedido_cnh: { em: AGORA, por: 'nilce' }, pedido_x: { em: AGORA, por: 'nilce' } };
    const n = normalizarJornada(10, e)!;
    expect(n.etapas[1].financiamento).toBe('financeira');
    expect(Object.keys(n.etapas[1].confirmados!)).toEqual(['nome', 'valor']);   // na ordem do contrato; o resto caiu
    expect(n.etapas[1].confirmados!.valor.por).toBe('nilce');
    expect(Object.keys(n.etapas[1].pedidos!)).toEqual(['pedido_cnh', 'pedido_fachada']);
    expect(n.etapas[1].kit_texto).toEqual({ inversor: '1 x Growatt' });   // 3 a 120 caracteres, só placas e inversor
    const sig = assinarJornada(10, n);
    expect(jornadaAssinada(10, { ...(comJsonb(n) as object), sig })).toEqual(n);
    // adulterar uma confirmação invalida a assinatura
    const forjado = comJsonb(n) as { etapas: { 1: { confirmados: Record<string, { marca: string }> } } };
    forjado.etapas[1].confirmados.nome.marca = 'f'.repeat(16);
    expect(jornadaAssinada(10, { ...forjado, sig })).toBeNull();
    expect(normalizarJornada(10, { ...base(), etapas: { ...base().etapas, 1: { ...base().etapas[1], financiamento: 'talvez' } } })!.etapas[1].financiamento).toBeUndefined();
    // o `sim` de antes abria a proposta de banco: lê-se `proprio`; os três tipos novos passam; assinatura de antes (com `sim`) continua valendo
    const com = (fin: unknown) => normalizarJornada(10, { ...base(), etapas: { ...base().etapas, 1: { ...base().etapas[1], financiamento: fin } } })!;
    expect(com('sim').etapas[1].financiamento).toBe('proprio');
    expect(['nao', 'proprio', 'financeira'].map((v) => com(v).etapas[1].financiamento)).toEqual(['nao', 'proprio', 'financeira']);
    for (const v of [null, 1, 'SIM', '']) expect(com(v).etapas[1].financiamento).toBeUndefined();
    const lido = com('sim');
    // a assinatura de um estado gravado antes dos 3 tipos: HMAC do JSON com `sim` (assinarJornada já normalizaria para `proprio`)
    const sigAntiga = createHmac('sha256', 'segredo-de-teste').update(`jornada|10|${JSON.stringify({ ...lido, etapas: { ...lido.etapas, 1: { ...lido.etapas[1], financiamento: 'sim' } } })}`).digest('hex');
    expect(sigAntiga).not.toBe(assinarJornada(10, lido));
    const gravado = comJsonb(lido) as { etapas: { 1: { financiamento: string } } };
    gravado.etapas[1].financiamento = 'sim';
    expect(jornadaAssinada(10, { ...gravado, sig: sigAntiga })!.etapas[1].financiamento).toBe('proprio');
    delete process.env.VINCULO_SOLAR_SECRET;
  });
});
