import { describe, it, expect } from 'vitest';
import {
  FIN_PREFIX, chaveLancamento, prefixoDoCard, catalogoFinanceiro, montarLancamento, marcarApagado,
  totais, visaoDoConsultor, mascararTotais, semHistoricoDeSaida, possiveisDuplicados, centavosDeReais, lancamentoDe, ordenarLancamentos,
  VALOR_MAX_CENTAVOS, type Lancamento,
} from '../services/gerador/financeiroCliente';

// Módulo puro do financeiro por cliente. Nenhum dado de cliente de verdade: os
// nomes e valores daqui são inventados.

const CTX = { cardId: 77, autor: 'nilce', agoraIso: '2026-10-11T15:00:00.000Z', hojeBr: '2026-10-11' };
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const entradaOk = (extra: Record<string, unknown> = {}) => ({
  id: 'lanc-0001', tipo: 'entrada', categoria: 'sinal', valor_centavos: 150_000, data: '2026-10-10', ...extra,
});

function criar(extra: Record<string, unknown> = {}, ctx = CTX): Lancamento {
  const r = montarLancamento(entradaOk(extra), null, ctx);
  if (!r.ok) throw new Error(`não montou: ${r.erro}`);
  return r.lancamento;
}
const erroDe = (entrada: unknown, atual: Lancamento | null = null, ctx = CTX): string | null => {
  const r = montarLancamento(entrada, atual, ctx);
  return r.ok ? null : r.erro;
};

describe('chaves e catálogo', () => {
  it('uma chave por lançamento, com o card no prefixo', () => {
    expect(FIN_PREFIX).toBe('fin:');
    expect(chaveLancamento(12, 'abc-12345')).toBe('fin:12:abc-12345');
    expect(prefixoDoCard(12)).toBe('fin:12:');
    // O ":" do fim é o que impede o card 1 de enxergar o card 12.
    expect(chaveLancamento(12, 'abc-12345').startsWith(prefixoDoCard(1))).toBe(false);
  });
  it('catálogo com slug e rótulo', () => {
    const c = catalogoFinanceiro();
    expect(c.entrada.map((x) => x.slug)).toEqual(['sinal', 'parcela', 'a_vista', 'financiamento', 'remuneracao', 'outros']);
    expect(c.saida.map((x) => x.slug)).toEqual([
      'equipamento', 'frete', 'obra', 'material', 'mao_de_obra', 'projeto_art', 'taxa_distribuidora', 'comissao', 'imposto', 'outros',
    ]);
    expect(c.formas.map((x) => x.slug)).toEqual(['pix', 'transferencia', 'boleto', 'cartao', 'dinheiro', 'financiamento', 'outro']);
    expect(c.entrada.find((x) => x.slug === 'a_vista')?.rotulo).toBe('Pagamento à vista');
    expect(c.saida.find((x) => x.slug === 'projeto_art')?.rotulo).toBe('Projeto e ART');
  });
});

describe('montarLancamento: criação', () => {
  it('monta com os padrões e o autor do contexto', () => {
    const l = criar();
    expect(l).toEqual({
      id: 'lanc-0001', card_id: 77, tipo: 'entrada', categoria: 'sinal', valor_centavos: 150_000, data: '2026-10-10',
      forma: '', descricao: '', contraparte: '', id_transacao: '', arquivo: null, origem: 'manual', lido_pela_ia: null,
      criado_por: 'nilce', criado_em: '2026-10-11T15:00:00.000Z', alteracoes: [],
      apagado: false, apagado_por: '', apagado_em: '', motivo_apagado: '',
    });
  });
  it('campo de autor ou de card vindo na entrada é ignorado', () => {
    const l = criar({ criado_por: 'thiago', card_id: 999, criado_em: '2020-01-01T00:00:00Z', apagado: true, alteracoes: [{ x: 1 }] });
    expect(l).toMatchObject({ criado_por: 'nilce', card_id: 77, criado_em: CTX.agoraIso, apagado: false, alteracoes: [] });
  });
  it('apara e corta os textos', () => {
    const l = criar({ descricao: `  ${'d'.repeat(300)}  `, contraparte: ` ${'c'.repeat(100)} `, id_transacao: ` ${'t'.repeat(100)} ` });
    expect(l.descricao).toHaveLength(200);
    expect(l.contraparte).toHaveLength(80);
    expect(l.id_transacao).toHaveLength(80);
  });
  it('corpo_invalido', () => {
    for (const ruim of [null, undefined, 'x', 5, [], [entradaOk()]]) expect(erroDe(ruim)).toBe('corpo_invalido');
    expect(erroDe(entradaOk({ origem: 'robo' }))).toBe('corpo_invalido');
    expect(erroDe(entradaOk({ lido_pela_ia: 'x' }))).toBe('corpo_invalido');
    expect(erroDe(entradaOk({ lido_pela_ia: { valor_centavos: 1.5, data: null, id_transacao: null } }))).toBe('corpo_invalido');
  });
  it('id_invalido', () => {
    for (const id of [undefined, '', 'curto', 'com espaço aqui', 'a'.repeat(65), 12345678, 'abc_12345', '../../../etc']) {
      expect(erroDe(entradaOk({ id }))).toBe('id_invalido');
    }
    expect(erroDe(entradaOk({ id: '3f2b1c0a-9d8e-4f7a-b6c5-d4e3f2a1b0c9' }))).toBeNull();
  });
  it('tipo_invalido', () => {
    for (const tipo of [undefined, 'receita', '', 1, null]) expect(erroDe(entradaOk({ tipo }))).toBe('tipo_invalido');
  });
  it('categoria_invalida: a categoria é do catálogo DO TIPO', () => {
    expect(erroDe(entradaOk({ categoria: 'frete' }))).toBe('categoria_invalida');            // frete é saída
    expect(erroDe(entradaOk({ tipo: 'saida', categoria: 'sinal' }))).toBe('categoria_invalida');
    expect(erroDe(entradaOk({ categoria: undefined }))).toBe('categoria_invalida');
    expect(erroDe(entradaOk({ categoria: 'toString' }))).toBe('categoria_invalida');
    expect(erroDe(entradaOk({ tipo: 'saida', categoria: 'frete' }))).toBeNull();
  });
  it('valor_invalido: só inteiro de centavos, maior que zero', () => {
    for (const v of [14500.5, '14500', NaN, 0, -1, Infinity, null, undefined, VALOR_MAX_CENTAVOS + 1, true]) {
      expect(erroDe(entradaOk({ valor_centavos: v }))).toBe('valor_invalido');
    }
    expect(erroDe(entradaOk({ valor_centavos: 1 }))).toBeNull();
    expect(erroDe(entradaOk({ valor_centavos: VALOR_MAX_CENTAVOS }))).toBeNull();
  });
  it('data_invalida: data real, de 2020 até hoje (Brasília) + 366 dias', () => {
    for (const d of [undefined, '', '10/10/2026', '2026-02-30', '2026-13-01', '2019-12-31', '2027-10-13', 20261010, '2026-10-10T00:00:00Z']) {
      expect(erroDe(entradaOk({ data: d }))).toBe('data_invalida');
    }
    expect(erroDe(entradaOk({ data: '2020-01-01' }))).toBeNull();
    expect(erroDe(entradaOk({ data: '2027-10-12' }))).toBeNull();   // hoje + 366
    expect(erroDe(entradaOk({ data: '2024-02-29' }))).toBeNull();   // bissexto
  });
  it('forma_invalida', () => {
    expect(erroDe(entradaOk({ forma: 'cheque' }))).toBe('forma_invalida');
    expect(erroDe(entradaOk({ forma: 5 }))).toBe('forma_invalida');
    expect(erroDe(entradaOk({ forma: '' }))).toBeNull();
    expect(criar({ forma: 'pix' }).forma).toBe('pix');
  });
  it('descricao_obrigatoria quando a categoria é outros', () => {
    expect(erroDe(entradaOk({ categoria: 'outros' }))).toBe('descricao_obrigatoria');
    expect(erroDe(entradaOk({ categoria: 'outros', descricao: '   ' }))).toBe('descricao_obrigatoria');
    expect(erroDe(entradaOk({ tipo: 'saida', categoria: 'outros', descricao: '' }))).toBe('descricao_obrigatoria');
    expect(erroDe(entradaOk({ categoria: 'outros', descricao: 'Devolução de caução' }))).toBeNull();
  });
  it('texto_invalido: texto que não é texto', () => {
    expect(erroDe(entradaOk({ descricao: { a: 1 } }))).toBe('texto_invalido');
    expect(erroDe(entradaOk({ contraparte: 5 }))).toBe('texto_invalido');
    expect(erroDe(entradaOk({ id_transacao: null }))).toBe('texto_invalido');
  });
  it('arquivo_invalido e arquivo_de_outro_card', () => {
    const arq = { path: 'fin/77/202610/abc.pdf', nome: 'pix.pdf', tipo: 'application/pdf', tamanho: 1234, sha256: SHA_A };
    expect(erroDe(entradaOk({ arquivo: arq }))).toBeNull();
    expect(erroDe(entradaOk({ arquivo: null }))).toBeNull();
    expect(erroDe(entradaOk({ arquivo: 'fin/77/x.pdf' }))).toBe('arquivo_invalido');
    expect(erroDe(entradaOk({ arquivo: { ...arq, sha256: 'curto' } }))).toBe('arquivo_invalido');
    expect(erroDe(entradaOk({ arquivo: { ...arq, tamanho: 0 } }))).toBe('arquivo_invalido');
    expect(erroDe(entradaOk({ arquivo: { ...arq, tamanho: 4 * 1024 * 1024 } }))).toBe('arquivo_invalido');
    expect(erroDe(entradaOk({ arquivo: { ...arq, tipo: 'image/heic' } }))).toBe('arquivo_invalido');
    expect(erroDe(entradaOk({ arquivo: { ...arq, path: 'fin/77/../78/abc.pdf' } }))).toBe('arquivo_invalido');
    expect(erroDe(entradaOk({ arquivo: { ...arq, path: 'fin/78/202610/abc.pdf' } }))).toBe('arquivo_de_outro_card');
    expect(erroDe(entradaOk({ arquivo: { ...arq, path: 'fin/777/202610/abc.pdf' } }))).toBe('arquivo_de_outro_card');
    expect(erroDe(entradaOk({ arquivo: { ...arq, path: 'dossie/77/abc.pdf' } }))).toBe('arquivo_de_outro_card');
  });
  it('do arquivo só ficam os cinco campos: a url assinada não vai para o banco', () => {
    const l = criar({
      arquivo: { path: 'fin/77/202610/abc.png', nome: 'print.png', tipo: 'image/png', tamanho: 10, sha256: SHA_A, url: 'https://x.test/assinada?token=1', bytes: 'zzz' },
    });
    expect(l.arquivo).toEqual({ path: 'fin/77/202610/abc.png', nome: 'print.png', tipo: 'image/png', tamanho: 10, sha256: SHA_A });
  });
  it('guarda o que a IA leu, só os três campos', () => {
    const l = criar({ origem: 'ia', lido_pela_ia: { valor_centavos: 150_000, data: '2026-10-10', id_transacao: ' E123 ', pagador: 'Fulano' } });
    expect(l.origem).toBe('ia');
    expect(l.lido_pela_ia).toEqual({ valor_centavos: 150_000, data: '2026-10-10', id_transacao: 'E123' });
  });
});

describe('montarLancamento: edição', () => {
  const depois = { ...CTX, autor: 'thiago', agoraIso: '2026-10-12T10:00:00.000Z', hojeBr: '2026-10-12' };

  it('guarda em `antes` SÓ o que mudou, com o valor antigo', () => {
    const a = criar({ descricao: 'Sinal do contrato', forma: 'pix' });
    const r = montarLancamento({ id: a.id, valor_centavos: 160_000, forma: 'pix', descricao: 'Sinal do contrato' }, a, depois);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mudou).toEqual(['valor_centavos']);
    expect(r.lancamento.valor_centavos).toBe(160_000);
    expect(r.lancamento.alteracoes).toEqual([{ em: depois.agoraIso, por: 'thiago', antes: { valor_centavos: 150_000 } }]);
    // id, card e criação não mudam
    expect(r.lancamento).toMatchObject({ id: a.id, card_id: 77, criado_por: 'nilce', criado_em: CTX.agoraIso });
  });
  it('mesmo conteúdo de novo: devolve o mesmo, sem alteração', () => {
    const arq = { path: 'fin/77/202610/abc.png', nome: 'print.png', tipo: 'image/png', tamanho: 10, sha256: SHA_A };
    const a = criar({ arquivo: arq, origem: 'ia', lido_pela_ia: { valor_centavos: 150_000, data: '2026-10-10', id_transacao: null } });
    // O pedido repetido volta com a url assinada no arquivo; o jsonb do banco
    // devolve as chaves em outra ordem. Nenhum dos dois é mudança.
    const doBanco = lancamentoDe(JSON.parse(JSON.stringify({
      ...a,
      arquivo: { sha256: SHA_A, tamanho: 10, tipo: 'image/png', nome: 'print.png', path: arq.path },
      lido_pela_ia: { data: '2026-10-10', id_transacao: null, valor_centavos: 150_000 },
    })))!;
    const r = montarLancamento({
      ...entradaOk(), arquivo: { ...arq, url: 'https://x.test/outra' }, origem: 'ia',
      lido_pela_ia: { valor_centavos: 150_000, data: '2026-10-10', id_transacao: null },
    }, doBanco, depois);
    expect(r).toMatchObject({ ok: true, criou: false, mudou: [] });
    if (r.ok) expect(r.lancamento.alteracoes).toEqual([]);
  });
  const editar = (l: Lancamento, entrada: Record<string, unknown>, i: number, autor = 'thiago'): Lancamento => {
    const r = montarLancamento(entrada, l, { ...depois, autor, agoraIso: new Date(Date.parse('2026-10-12T10:00:00.000Z') + i * 1000).toISOString() });
    if (!r.ok) throw new Error(r.erro);
    return r.lancamento;
  };

  it('corta o histórico em 20: fica a PRIMEIRA alteração e as 19 mais recentes', () => {
    let l = criar();
    for (let i = 1; i <= 25; i++) l = editar(l, { valor_centavos: 150_000 + i }, i);
    expect(l.alteracoes).toHaveLength(20);
    expect(l.alteracoes[0].antes).toEqual({ valor_centavos: 150_000 });    // a primeira nunca sai: é o valor com que nasceu
    expect(l.alteracoes[1].antes).toEqual({ valor_centavos: 150_006 });    // da 2ª à 6ª saíram
    expect(l.alteracoes[19].antes).toEqual({ valor_centavos: 150_024 });
    expect(l.valor_centavos).toBe(150_025);
    // Continua valendo depois de muitas outras.
    for (let i = 26; i <= 90; i++) l = editar(l, { valor_centavos: 150_000 + i }, i);
    expect(l.alteracoes).toHaveLength(20);
    expect(l.alteracoes[0]).toEqual({ em: '2026-10-12T10:00:01.000Z', por: 'thiago', antes: { valor_centavos: 150_000 } });
    expect(l.alteracoes[19].antes).toEqual({ valor_centavos: 150_089 });
  });
  it('30 edições na descrição depois de uma troca de valor ainda deixam o valor original recuperável', () => {
    let l = criar({ descricao: 'Sinal do contrato' });
    l = editar(l, { valor_centavos: 990_000 }, 1, 'nilce');               // a troca de valor: era 150.000
    for (let i = 1; i <= 30; i++) l = editar(l, { descricao: `Sinal do contrato, revisão ${i}` }, 1 + i);
    expect(l.alteracoes).toHaveLength(20);
    expect(l.alteracoes[0]).toMatchObject({ por: 'nilce', antes: { valor_centavos: 150_000 } });
    expect(JSON.stringify(l.alteracoes)).toContain('"valor_centavos":150000');
    expect(l.alteracoes[19].antes).toEqual({ descricao: 'Sinal do contrato, revisão 29' });
    expect(l).toMatchObject({ valor_centavos: 990_000, descricao: 'Sinal do contrato, revisão 30' });
  });
  it('até 20 alterações nada é cortado', () => {
    let l = criar();
    for (let i = 1; i <= 20; i++) l = editar(l, { valor_centavos: 150_000 + i }, i);
    expect(l.alteracoes.map((a) => a.antes.valor_centavos)).toEqual(Array.from({ length: 20 }, (_, i) => 150_000 + i));
  });
  it('a marca ja_foi_saida nasce com a saída, não volta atrás e não existe em quem nunca foi saída', () => {
    expect('ja_foi_saida' in criar()).toBe(false);
    expect('ja_foi_saida' in editar(criar(), { valor_centavos: 5 }, 1)).toBe(false);
    expect(criar({ tipo: 'saida', categoria: 'frete' }).ja_foi_saida).toBe(true);
    const virou = editar(criar(), { tipo: 'saida', categoria: 'frete' }, 1);
    expect(virou.ja_foi_saida).toBe(true);
    const voltou = editar(virou, { tipo: 'entrada', categoria: 'sinal' }, 2);
    expect(voltou).toMatchObject({ tipo: 'entrada', ja_foi_saida: true });
    // Não se liga nem desliga pelo corpo do pedido.
    expect('ja_foi_saida' in criar({ ja_foi_saida: true })).toBe(false);
    expect(editar(voltou, { ja_foi_saida: false, descricao: 'x' }, 3).ja_foi_saida).toBe(true);
    expect(lancamentoDe(JSON.parse(JSON.stringify(voltou)))).toEqual(voltou);
  });
  it('trocar o tipo confere a categoria contra o tipo novo', () => {
    const a = criar();
    expect(erroDe({ tipo: 'saida' }, a, depois)).toBe('categoria_invalida');
    const r = montarLancamento({ tipo: 'saida', categoria: 'frete' }, a, depois);
    expect(r.ok && r.lancamento.alteracoes[0].antes).toEqual({ tipo: 'entrada', categoria: 'sinal' });
  });
  it('id diferente do gravado, valor ruim e arquivo de outro card são recusados também na edição', () => {
    const a = criar();
    expect(erroDe({ id: 'outro-id-9999' }, a, depois)).toBe('id_invalido');
    expect(erroDe({ valor_centavos: 10.5 }, a, depois)).toBe('valor_invalido');
    expect(erroDe({ data: '2026-02-30' }, a, depois)).toBe('data_invalida');
    expect(erroDe({ arquivo: { path: 'fin/78/202610/a.png', nome: 'a', tipo: 'image/png', tamanho: 1, sha256: SHA_A } }, a, depois)).toBe('arquivo_de_outro_card');
    expect(erroDe({ categoria: 'outros' }, a, depois)).toBe('descricao_obrigatoria');
  });
  it('tirar o arquivo guarda o antigo', () => {
    const arq = { path: 'fin/77/202610/abc.png', nome: 'print.png', tipo: 'image/png', tamanho: 10, sha256: SHA_A };
    const a = criar({ arquivo: arq });
    const r = montarLancamento({ arquivo: null }, a, depois);
    expect(r.ok && r.lancamento.arquivo).toBeNull();
    expect(r.ok && r.lancamento.alteracoes[0].antes).toEqual({ arquivo: arq });
  });
  it('lançamento apagado não pode ser editado', () => {
    const ap = marcarApagado(criar(), { autor: 'thiago', agoraIso: depois.agoraIso }, 'lançado em dobro');
    if (!ap.ok) throw new Error(ap.erro);
    expect(erroDe({ valor_centavos: 1 }, ap.lancamento, depois)).toBe('apagado');
  });
});

describe('marcarApagado', () => {
  const ctx = { autor: 'thiago', agoraIso: '2026-10-12T10:00:00.000Z' };
  it('exige motivo de 3 a 200 caracteres', () => {
    const l = criar();
    for (const m of [undefined, null, '', '  ', 'ab', ' a ', 5, 'x'.repeat(201)]) {
      expect(marcarApagado(l, ctx, m)).toEqual({ ok: false, erro: 'motivo_obrigatorio' });
    }
  });
  it('marca sem tirar nada do lançamento', () => {
    const l = criar();
    const r = marcarApagado(l, ctx, '  lançado em dobro  ');
    expect(r).toMatchObject({ ok: true, mudou: true });
    if (!r.ok) return;
    expect(r.lancamento).toEqual({ ...l, apagado: true, apagado_por: 'thiago', apagado_em: ctx.agoraIso, motivo_apagado: 'lançado em dobro' });
    expect(l.apagado).toBe(false);   // não mexe no original
  });
  it('apagar o já apagado devolve o mesmo, sem trocar autor nem motivo', () => {
    const r1 = marcarApagado(criar(), ctx, 'lançado em dobro');
    if (!r1.ok) throw new Error(r1.erro);
    const r2 = marcarApagado(r1.lancamento, { autor: 'diego', agoraIso: '2026-10-13T00:00:00.000Z' }, '');
    expect(r2).toMatchObject({ ok: true, mudou: false });
    if (r2.ok) expect(r2.lancamento).toBe(r1.lancamento);
  });
});

const L = (tipo: 'entrada' | 'saida', categoria: string, valor_centavos: number, extra: Partial<Lancamento> = {}): Lancamento => ({
  ...criar({ id: `l-${tipo}-${categoria}-${valor_centavos}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 60), tipo, categoria, valor_centavos, descricao: 'x' }),
  ...extra,
});

describe('centavos', () => {
  it('10 + 20 centavos são 30, e não 0,30000000000000004', () => {
    expect(0.1 + 0.2).not.toBe(0.3);   // o defeito que os centavos inteiros evitam
    const t = totais([L('entrada', 'sinal', 10), L('entrada', 'parcela', 20)], 100);
    expect(t.recebido).toBe(30);
    expect(t.a_receber).toBe(70);
  });
  it('muitos lançamentos de 1 centavo somam exato', () => {
    const muitos = Array.from({ length: 100_000 }, () => ({ tipo: 'entrada' as const, categoria: 'parcela', valor_centavos: 1, apagado: false }));
    const t = totais(muitos, null);
    expect(t.recebido).toBe(100_000);
    expect(t.por_categoria.entrada.parcela).toBe(100_000);
    expect(t.qtd_entradas).toBe(100_000);
  });
  it('centavosDeReais', () => {
    expect(centavosDeReais(1234.56)).toBe(123456);
    expect(centavosDeReais(0.1 + 0.2)).toBe(30);
    expect(centavosDeReais(19.99)).toBe(1999);
    expect(centavosDeReais(145000)).toBe(14_500_000);
    expect(centavosDeReais(0)).toBe(0);
    for (const ruim of [null, undefined, NaN, -1, -0.01, Infinity]) expect(centavosDeReais(ruim as number | null)).toBeNull();
    expect(centavosDeReais('10' as unknown as number)).toBeNull();
  });
  it('linha estragada (fração, zero, texto) não entra na soma', () => {
    const t = totais([
      L('entrada', 'sinal', 100),
      { tipo: 'entrada', categoria: 'sinal', valor_centavos: 10.5, apagado: false },
      { tipo: 'saida', categoria: 'frete', valor_centavos: '50' as unknown as number, apagado: false },
      { tipo: 'saida', categoria: 'frete', valor_centavos: 0, apagado: false },
    ], null);
    expect(t).toMatchObject({ recebido: 100, gasto: 0, qtd_entradas: 1, qtd_saidas: 0 });
  });
});

describe('totais', () => {
  const lista = [
    L('entrada', 'sinal', 1_000_000),
    L('entrada', 'parcela', 2_500_000),
    L('saida', 'equipamento', 1_800_000),
    L('saida', 'frete', 73_113),
    L('saida', 'frete', 26_887),
  ];
  it('com valor da venda', () => {
    expect(totais(lista, 5_000_000)).toEqual({
      recebido: 3_500_000, gasto: 1_900_000, resultado_caixa: 1_600_000,
      a_receber: 1_500_000, recebido_a_mais: 0,
      resultado_previsto: 3_100_000, margem_prevista: 62,
      por_categoria: { entrada: { sinal: 1_000_000, parcela: 2_500_000 }, saida: { equipamento: 1_800_000, frete: 100_000 } },
      qtd_entradas: 2, qtd_saidas: 3,
    });
  });
  it('sem valor da venda: o que depende dele é null, não zero', () => {
    expect(totais(lista, null)).toMatchObject({
      recebido: 3_500_000, gasto: 1_900_000, resultado_caixa: 1_600_000,
      a_receber: null, recebido_a_mais: 0, resultado_previsto: null, margem_prevista: null,
    });
  });
  it('recebido maior que a venda: a receber não fica negativo, e o excesso aparece', () => {
    const t = totais(lista, 3_000_000);
    expect(t.a_receber).toBe(0);
    expect(t.recebido_a_mais).toBe(500_000);
    expect(t.resultado_previsto).toBe(1_100_000);
    expect(t.margem_prevista).toBe(36.7);
  });
  it('margem com 1 casa, negativa quando o gasto passa da venda, null com venda zero', () => {
    expect(totais([L('saida', 'obra', 1_333)], 3_000).margem_prevista).toBe(55.6);
    expect(totais([L('saida', 'obra', 4_500)], 3_000)).toMatchObject({ resultado_previsto: -1_500, margem_prevista: -50, resultado_caixa: -4_500 });
    expect(totais(lista, 0)).toMatchObject({ a_receber: 0, recebido_a_mais: 3_500_000, resultado_previsto: -1_900_000, margem_prevista: null });
  });
  it('valor da venda que não é centavo inteiro é tratado como ausente', () => {
    for (const v of [NaN, 10.5, -1]) expect(totais(lista, v).a_receber).toBeNull();
  });
  it('ignora os apagados', () => {
    const comApagados = [...lista, L('entrada', 'sinal', 999_999, { apagado: true }), L('saida', 'imposto', 888_888, { apagado: true })];
    expect(totais(comApagados, 5_000_000)).toEqual(totais(lista, 5_000_000));
  });
  it('lista vazia', () => {
    expect(totais([], 1000)).toEqual({
      recebido: 0, gasto: 0, resultado_caixa: 0, a_receber: 1000, recebido_a_mais: 0, resultado_previsto: 1000, margem_prevista: 100,
      por_categoria: { entrada: {}, saida: {} }, qtd_entradas: 0, qtd_saidas: 0,
    });
  });
  it('reconciliação: a soma das categorias é o total', () => {
    const variados: Lancamento[] = [];
    const ent = ['sinal', 'parcela', 'a_vista', 'financiamento', 'remuneracao'];
    const sai = ['equipamento', 'frete', 'obra', 'material', 'mao_de_obra', 'projeto_art', 'taxa_distribuidora', 'comissao', 'imposto'];
    for (let i = 1; i <= 300; i++) {
      variados.push(L('entrada', ent[i % ent.length], i * 37 + 1, { id: `e-${i}-reconc` }));
      variados.push(L('saida', sai[i % sai.length], i * 53 + 7, { id: `s-${i}-reconc`, apagado: i % 11 === 0 }));
    }
    const t = totais(variados, 9_999_999);
    const soma = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    expect(soma(t.por_categoria.entrada)).toBe(t.recebido);
    expect(soma(t.por_categoria.saida)).toBe(t.gasto);
    expect(t.resultado_caixa).toBe(t.recebido - t.gasto);
    for (const v of [t.recebido, t.gasto, t.resultado_caixa, t.a_receber, t.recebido_a_mais, t.resultado_previsto]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('visaoDoConsultor', () => {
  // Valores "com cara própria", para procurar no JSON sem falso positivo.
  const GASTO_A = 1_873_219;
  const GASTO_B = 64_457;
  const lista = [
    L('entrada', 'sinal', 1_000_000),
    L('saida', 'equipamento', GASTO_A, { contraparte: 'Fornecedor Sigiloso', descricao: 'Inversor de custo' }),
    L('saida', 'comissao', GASTO_B),
    L('entrada', 'parcela', 500_000, { apagado: true }),
  ];
  const completos = totais(lista, 5_000_000);
  const visao = visaoDoConsultor(lista, completos);

  it('só as entradas (inclusive a apagada)', () => {
    expect(visao.lancamentos.map((l) => l.tipo)).toEqual(['entrada', 'entrada']);
  });
  it('totais sem nada que dependa de custo; recebido e a receber continuam verdadeiros', () => {
    expect(visao.totais).toEqual({
      recebido: 1_000_000, gasto: null, resultado_caixa: null, a_receber: 4_000_000, recebido_a_mais: 0,
      resultado_previsto: null, margem_prevista: null,
      por_categoria: { entrada: { sinal: 1_000_000 }, saida: null }, qtd_entradas: 1, qtd_saidas: null,
    });
    expect(mascararTotais(completos)).toEqual(visao.totais);
  });
  it('NENHUM campo de saída passa: o JSON não traz gasto, resultado, margem nem o fornecedor', () => {
    const json = JSON.stringify(visao);
    const proibidos = [
      GASTO_A, GASTO_B, GASTO_A + GASTO_B,           // cada gasto e o total gasto
      completos.resultado_caixa,                      // recebido - gasto
      completos.resultado_previsto,                   // venda - gasto
      completos.margem_prevista,
    ];
    for (const p of proibidos) expect(json).not.toContain(String(p));
    for (const p of ['Fornecedor Sigiloso', 'Inversor de custo', 'equipamento', 'comissao', '"tipo":"saida"']) expect(json).not.toContain(p);
    expect(json).toContain('"saida":null');
    // A máscara não é cópia com campos apagados: é lista branca.
    expect(Object.keys(visao.totais).sort()).toEqual(Object.keys(completos).sort());
  });
  it('entrada que já foi saída: o histórico do tempo de saída não passa', () => {
    const ctx = (s: number) => ({ ...CTX, autor: 'thiago', agoraIso: `2026-10-12T10:00:${String(s).padStart(2, '0')}.000Z` });
    const passo = (l: Lancamento, entrada: Record<string, unknown>, s: number): Lancamento => {
      const r = montarLancamento(entrada, l, ctx(s));
      if (!r.ok) throw new Error(r.erro);
      return r.lancamento;
    };
    // Nasce saída com um gasto, o gasto é corrigido, vira entrada, e a entrada é corrigida.
    // (id neutro: o do ajudante L() traz a categoria e o valor no próprio texto)
    let l = L('saida', 'equipamento', GASTO_A, { id: 'conv-00000001', contraparte: 'Fornecedor Sigiloso' });
    l = passo(l, { valor_centavos: GASTO_B }, 1);                                   // antes: { valor: GASTO_A }, sem `tipo`
    l = passo(l, { tipo: 'entrada', categoria: 'sinal', valor_centavos: 700_000, contraparte: 'Cliente de Teste' }, 2);
    l = passo(l, { valor_centavos: 710_000 }, 3);                                   // já como entrada
    expect(l.alteracoes).toHaveLength(3);

    const semSaida = semHistoricoDeSaida(l);
    expect(semSaida.alteracoes).toEqual([{ em: ctx(3).agoraIso, por: 'thiago', antes: { valor_centavos: 700_000 } }]);
    expect(l.alteracoes).toHaveLength(3);                                           // o gravado não muda

    const json = JSON.stringify(visaoDoConsultor([l], totais([l], null)));
    for (const p of [GASTO_A, GASTO_B, 'Fornecedor Sigiloso', 'equipamento', '"tipo":"saida"']) expect(json).not.toContain(String(p));
    expect(json).toContain('710000');
    // Quem nunca foi saída fica como está.
    const normal = passo(criar(), { valor_centavos: 5 }, 4);
    expect(semHistoricoDeSaida(normal)).toBe(normal);
  });
  it('saída lida por IA que virou entrada: o que a IA leu naquele tempo não passa', () => {
    const LIDO = 1_644_457;
    const ctx = (s: number) => ({ ...CTX, autor: 'thiago', agoraIso: new Date(Date.parse('2026-10-12T10:00:00.000Z') + s * 1000).toISOString() });
    const passo = (l: Lancamento, entrada: Record<string, unknown>, s: number): Lancamento => {
      const r = montarLancamento(entrada, l, ctx(s));
      if (!r.ok) throw new Error(r.erro);
      return r.lancamento;
    };
    const saida = montarLancamento({
      id: 'conv-00000002', tipo: 'saida', categoria: 'equipamento', valor_centavos: GASTO_A, data: '2026-10-02',
      origem: 'ia', lido_pela_ia: { valor_centavos: LIDO, data: '2026-10-02', id_transacao: 'E2E-SAIDA-1' },
    }, null, ctx(0));
    if (!saida.ok) throw new Error(saida.erro);
    let l = passo(saida.lancamento, { tipo: 'entrada', categoria: 'sinal', valor_centavos: 700_000 }, 1);
    expect(l.lido_pela_ia).toEqual({ valor_centavos: LIDO, data: '2026-10-02', id_transacao: 'E2E-SAIDA-1' });   // gravado, fica

    const visto = (x: Lancamento) => JSON.stringify(visaoDoConsultor([x], totais([x], null)));
    expect(semHistoricoDeSaida(l)).toMatchObject({ lido_pela_ia: null, alteracoes: [] });
    expect('ja_foi_saida' in semHistoricoDeSaida(l)).toBe(false);
    for (const p of [LIDO, GASTO_A, 'E2E-SAIDA-1', 'ja_foi_saida']) expect(visto(l)).not.toContain(String(p));

    // 40 edições depois, a alteração que virou a saída em entrada já foi
    // cortada do histórico. Quem segura a máscara é a marca: o que a IA leu
    // continua fora, e a primeira alteração (que é do tempo de saída) também.
    for (let i = 1; i <= 40; i++) l = passo(l, { descricao: `revisão ${i}` }, 1 + i);
    expect(l.alteracoes).toHaveLength(20);
    expect(l.alteracoes[0].antes).toMatchObject({ tipo: 'saida', valor_centavos: GASTO_A });
    const limpo = semHistoricoDeSaida(l);
    expect(limpo.lido_pela_ia).toBeNull();
    expect(limpo.alteracoes).toHaveLength(19);
    for (const p of [LIDO, GASTO_A, 'E2E-SAIDA-1', 'equipamento', '"tipo":"saida"']) expect(visto(l)).not.toContain(String(p));

    // Entrada, saída, entrada: a virada some no corte e a primeira alteração é de ANTES dela.
    let vai = criar({ id: 'conv-00000003' });
    vai = passo(vai, { descricao: 'antes de tudo' }, 1);
    vai = passo(vai, { tipo: 'saida', categoria: 'equipamento', valor_centavos: GASTO_B, lido_pela_ia: { valor_centavos: LIDO, data: null, id_transacao: null } }, 2);
    vai = passo(vai, { tipo: 'entrada', categoria: 'sinal', valor_centavos: 700_000 }, 3);
    for (let i = 1; i <= 40; i++) vai = passo(vai, { descricao: `revisão ${i}` }, 3 + i);
    expect(vai.alteracoes.some((a) => a.antes.tipo === 'saida')).toBe(false);   // a virada foi cortada
    expect(vai.ja_foi_saida).toBe(true);
    expect(semHistoricoDeSaida(vai).alteracoes).toHaveLength(19);
    for (const p of [LIDO, GASTO_B, 'antes de tudo']) expect(visto(vai)).not.toContain(String(p));
    // O gravado não foi tocado.
    expect(vai.lido_pela_ia).toMatchObject({ valor_centavos: LIDO });
  });
  it('não mexe nos totais completos', () => {
    expect(completos.gasto).toBe(GASTO_A + GASTO_B);
    expect(completos.por_categoria.saida).toEqual({ equipamento: GASTO_A, comissao: GASTO_B });
  });
});

describe('possiveisDuplicados', () => {
  const arq = (sha: string) => ({ path: 'fin/77/202610/x.png', nome: 'x.png', tipo: 'image/png', tamanho: 5, sha256: sha });
  const base = [
    L('entrada', 'sinal', 100_000, { id: 'dup-arquivo', arquivo: arq(SHA_A), data: '2026-09-01' }),
    L('saida', 'frete', 200_000, { id: 'dup-transacao', id_transacao: 'E2E-123', data: '2026-09-02' }),
    L('entrada', 'parcela', 300_000, { id: 'dup-valor-data', data: '2026-09-03' }),
    L('saida', 'obra', 300_000, { id: 'outro-tipo-000', data: '2026-09-03' }),
    L('entrada', 'parcela', 300_000, { id: 'apagado-00000', data: '2026-09-03', apagado: true }),
  ];
  const novo = (extra: Partial<Lancamento>) => L('entrada', 'parcela', 1, { id: 'novo-0000000', data: '2026-10-01', ...extra });

  it('mesmo arquivo', () => {
    expect(possiveisDuplicados(novo({ arquivo: arq(SHA_A) }), base)).toEqual([
      { id: 'dup-arquivo', tipo: 'entrada', valor_centavos: 100_000, data: '2026-09-01', categoria: 'sinal', motivo: 'mesmo_arquivo' },
    ]);
    expect(possiveisDuplicados(novo({ arquivo: arq(SHA_B) }), base)).toEqual([]);
  });
  it('mesma transação (aparada), e vazio nunca casa com vazio', () => {
    expect(possiveisDuplicados(novo({ id_transacao: ' E2E-123 ' }), base)).toEqual([
      { id: 'dup-transacao', tipo: 'saida', valor_centavos: 200_000, data: '2026-09-02', categoria: 'frete', motivo: 'mesma_transacao' },
    ]);
    expect(possiveisDuplicados(novo({ id_transacao: '' }), base)).toEqual([]);
  });
  it('mesmo tipo, valor e data (o de outro tipo e o apagado ficam de fora)', () => {
    const achados = possiveisDuplicados(novo({ valor_centavos: 300_000, data: '2026-09-03' }), base);
    expect(achados).toEqual([
      { id: 'dup-valor-data', tipo: 'entrada', valor_centavos: 300_000, data: '2026-09-03', categoria: 'parcela', motivo: 'mesmo_valor_e_data' },
    ]);
  });
  it('o próprio lançamento não é duplicado de si mesmo', () => {
    expect(possiveisDuplicados(base[0], base)).toEqual([]);
  });
  it('nada parecido, nada devolvido', () => {
    expect(possiveisDuplicados(novo({}), base)).toEqual([]);
  });
});

describe('lancamentoDe e ordem', () => {
  it('recusa o que não tem cara de lançamento', () => {
    for (const ruim of [null, 'x', [], {}, { id: 'abc-12345', tipo: 'xx', card_id: 1, valor_centavos: 1, data: '2026-01-01' }]) {
      expect(lancamentoDe(ruim)).toBeNull();
    }
    const l = criar();
    expect(lancamentoDe(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });
  it('data decrescente, depois criação decrescente', () => {
    const a = { id: 'a', data: '2026-10-01', criado_em: '2026-10-01T10:00:00Z' };
    const b = { id: 'b', data: '2026-10-05', criado_em: '2026-10-05T10:00:00Z' };
    const c = { id: 'c', data: '2026-10-05', criado_em: '2026-10-06T10:00:00Z' };
    expect(ordenarLancamentos([a, b, c]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});
