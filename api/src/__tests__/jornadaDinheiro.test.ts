import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  AJUSTES_PADRAO, ajustesAssinados, assinarAjustes, assinarLancamentoObra, categoriaObra, comissoesPelaRegra, idDoEstorno, lancamentoObraAssinado,
  lancamentoObraParaGravar, livroDaObra, montarLancamentoObra, normalizarAjustes, normalizarLancamentoObra, recortarLivro, validarAjustes,
  type AjustesSolar, type Conferencia, type EntradaLivro, type LancamentoObra,
} from '../services/gerador/jornadaDinheiro';
import { comissoesDaVenda } from '../services/gerador/jornadaSolar';
import { jornadaAssinada, reiniciarLogsDaJornada } from '../services/gerador/jornadaSolarBanco';
import { lancamentoDe } from '../services/gerador/financeiroCliente';

// O dinheiro da obra solar, Fase 2 da Jornada (06/11/2026). Regras puras, sem banco e sem relógio. Dados inventados.
// A obra #0065 é a da SPEC 3.1 e 3.2: o livro tem que bater centavo por centavo, em cada momento da tabela.

const CARD = 65;
const SEGREDO = 'segredo-de-teste-inventado';
beforeEach(() => { process.env.VINCULO_SOLAR_SECRET = SEGREDO; reiniciarLogsDaJornada(); delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS; });
afterEach(() => { delete process.env.VINCULO_SOLAR_SECRET; });

/** Reordena as chaves como o jsonb: por tamanho e depois alfabética, em TODOS os níveis. */
const comoJsonb = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(comoJsonb);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : 1)).map(([k, x]) => [k, comoJsonb(x)]));
  }
  return v;
};

let seq = 0;
interface Opc { forma?: string; descricao?: string; contraparte?: string; comissao?: { nome: string; papel: 'venda' | 'socio'; pb: number }; conf?: Conferencia; sem_arquivo?: boolean; por?: string }
/** Um lançamento da obra (já normalizado, sem sig: o livro não confere assinatura). */
function lanc(tipo: 'entrada' | 'saida', categoria: string, etapa: number, data: string, valor: number, o: Opc = {}): LancamentoObra {
  const cat = categoriaObra(tipo, categoria)!;
  const id = `lan-${String(++seq).padStart(8, '0')}`;
  return {
    id, card_id: CARD, tipo, categoria, valor_centavos: valor, data, forma: o.forma ?? 'pix', descricao: o.descricao ?? categoria, contraparte: o.contraparte ?? '',
    id_transacao: '', arquivo: o.sem_arquivo ? null : { path: `fin/${CARD}/202610/${id}.pdf`, nome: 'comprovante.pdf', tipo: 'application/pdf', tamanho: 10, sha256: id.padEnd(64, '0') },
    origem: 'manual', lido_pela_ia: null, criado_por: o.por ?? 'giovanna', criado_em: `${data}T12:00:00.000Z`, alteracoes: [], apagado: false, apagado_por: '', apagado_em: '', motivo_apagado: '',
    obra: { v: 1, etapa, grupo: cat.grupo, conferencia: o.conf ?? 'bateu', estorno_de: null, motivo_estorno: '', devolucao: false, comissao: o.comissao ?? null, compra_id: null, carga_id: null },
    sig: 'x',
  };
}

/** A obra #0065, SPEC 3.1: 2 entradas, 15 custos e 2 retiradas (19 lançamentos, 19 comprovantes). */
function obra65(): LancamentoObra[] {
  return [
    lanc('entrada', 'entrada', 2, '2026-09-18', 1_167_000, { descricao: 'Entrada de 30%' }),
    lanc('entrada', 'financiamento', 2, '2026-10-06', 2_723_000, { forma: 'transferencia', descricao: 'Financiamento BV' }),
    lanc('saida', 'combustivel', 1, '2026-09-16', 6_000, { forma: 'cartao', por: 'nilce' }),
    lanc('saida', 'cartorio', 2, '2026-09-19', 1_840),
    lanc('saida', 'comissao_venda', 2, '2026-09-21', 194_500, { comissao: { nome: 'nilce', papel: 'venda', pb: 500 } }),
    lanc('saida', 'art', 3, '2026-09-22', 26_255, { forma: 'boleto', por: 'thiago' }),
    lanc('saida', 'projeto_eletrico', 3, '2026-09-23', 45_000, { por: 'thiago' }),
    lanc('saida', 'equipamento', 4, '2026-10-15', 1_789_000, { forma: 'boleto', por: 'thiago' }),
    lanc('saida', 'material', 4, '2026-10-15', 210_000, { por: 'diego', descricao: 'Estrutura para telhado cerâmico' }),
    lanc('saida', 'material', 4, '2026-10-16', 89_000, { forma: 'cartao', por: 'diego', descricao: 'Material elétrico' }),
    lanc('saida', 'frete', 5, '2026-10-22', 25_000, { por: 'diego' }),
    lanc('saida', 'mao_de_obra', 6, '2026-10-23', 82_500, { por: 'diego', descricao: 'Equipe Pablo, primeira metade' }),
    lanc('saida', 'alimentacao', 6, '2026-10-23', 12_000, { forma: 'cartao', por: 'diego' }),
    lanc('saida', 'material_extra', 6, '2026-10-23', 8_500, { por: 'diego' }),
    lanc('saida', 'mao_de_obra', 6, '2026-10-24', 82_500, { por: 'diego', descricao: 'Equipe Pablo, segunda metade' }),
    lanc('saida', 'outros', 7, '2026-10-24', 3_800, { por: 'diego', descricao: 'Placas de sinalização' }),
    lanc('saida', 'combustivel', 8, '2026-11-03', 4_500, { forma: 'cartao', por: 'thiago' }),
    lanc('saida', 'retirada_socio', 2, '2026-09-21', 77_800, { comissao: { nome: 'thiago', papel: 'socio', pb: 200 } }),
    lanc('saida', 'retirada_socio', 2, '2026-09-21', 77_800, { comissao: { nome: 'diego', papel: 'socio', pb: 200 } }),
  ];
}
const PREVISTO = { homologacao: 70_000, material: 2_130_000, frete: 30_000, mao_de_obra: 165_000, outros: 38_300 };
const entrada65 = (l: LancamentoObra[], o: Partial<EntradaLivro> = {}): EntradaLivro => ({
  lancamentos: l, ignoradas: 0, vendaCentavos: 3_890_000, vendedor: 'nilce', regra: AJUSTES_PADRAO.comissoes.nilce, previsto: PREVISTO,
  pendenciasDaObra: [], material: { com_origem: 11, total: 11 }, adm: true, ...o,
});

describe('a obra #0065 (SPEC 3.1)', () => {
  it('o livro final bate: Custo 25.803,95, Sobra 13.096,05 e Fica 11.540,05', () => {
    const todos = obra65();
    expect(todos).toHaveLength(19);
    expect(todos.filter((l) => l.tipo === 'entrada')).toHaveLength(2);
    expect(todos.filter((l) => l.obra.grupo === 'custo')).toHaveLength(15);
    expect(todos.filter((l) => l.obra.grupo === 'retirada')).toHaveLength(2);
    const lv = livroDaObra(entrada65(todos));
    expect(lv).toMatchObject({ recebido: 3_890_000, a_receber: 0, gasto: 2_580_395, retirada: 155_600, saldo: 1_154_005, recebido_a_mais: 0 });
    expect(lv.fechamento).toMatchObject({ custo: 2_580_395, previsto: 2_627_800, diferenca: 47_405, comprovantes: { com: 19, total: 19 }, pode_fechar: true, faltam: [] });
    expect(lv.fechamento.adm).toEqual({ sobra: 1_309_605, sobra_pct: 33.7, retirada: 155_600, fica: 1_154_005, fica_pct: 29.7 });
    expect(lv.linhas).toHaveLength(19);
    expect(lv.a_pagar).toEqual([]);
  });

  it('os 6 grupos do previsto x real e o gasto por etapa', () => {
    const lv = livroDaObra(entrada65(obra65()));
    expect(lv.previsto!.grupos.map((g) => [g.grupo, g.previsto, g.real])).toEqual([
      ['comissao_venda', 194_500, 194_500], ['homologacao', 70_000, 71_255], ['material', 2_130_000, 2_088_000],
      ['frete', 30_000, 25_000], ['mao_de_obra', 165_000, 165_000], ['outros', 38_300, 36_640],
    ]);
    expect(lv.previsto!.total).toEqual({ previsto: 2_627_800, real: 2_580_395, diferenca: 47_405 });
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => lv.por_etapa[String(n)])).toEqual([6_000, 196_340, 71_255, 2_088_000, 25_000, 185_500, 3_800, 4_500, 0]);
  });

  it('a tabela 3.2 INTEIRA, momento a momento (Recebido, A receber, Gasto e Saldo)', () => {
    const todos = obra65();
    const ate = (data: string, etapaMax = 9, fora: (l: LancamentoObra) => boolean = () => false) =>
      todos.filter((l) => l.data <= data && l.obra.etapa <= etapaMax && !fora(l));
    const linha = (l: LancamentoObra[]) => { const v = livroDaObra(entrada65(l)); return [v.recebido, v.a_receber, v.gasto, v.saldo]; };
    const eletrico = (l: LancamentoObra) => l.descricao === 'Material elétrico';
    expect(linha(ate('2026-09-17'))).toEqual([0, 3_890_000, 6_000, -6_000]);
    expect(linha(ate('2026-09-21'))).toEqual([1_167_000, 2_723_000, 202_340, 809_060]);
    expect(linha(ate('2026-10-14'))).toEqual([3_890_000, 0, 273_595, 3_460_805]);
    expect(linha(ate('2026-10-16', 4, eletrico))).toEqual([3_890_000, 0, 2_272_595, 1_461_805]);
    expect(linha(ate('2026-10-16', 4))).toEqual([3_890_000, 0, 2_361_595, 1_372_805]);
    expect(linha(ate('2026-10-22', 5))).toEqual([3_890_000, 0, 2_386_595, 1_347_805]);
    expect(linha(ate('2026-10-24', 6))).toEqual([3_890_000, 0, 2_572_095, 1_162_305]);
    expect(linha(ate('2026-10-24', 7))).toEqual([3_890_000, 0, 2_575_895, 1_158_505]);
    expect(linha(ate('2026-11-06', 9))).toEqual([3_890_000, 0, 2_580_395, 1_154_005]);
    // A etapa 4, antes do material elétrico, vale R$ 19.990,00.
    expect(livroDaObra(entrada65(ate('2026-10-16', 4, eletrico))).por_etapa['4']).toBe(1_999_000);
  });

  it('com `adm: false`, o fechamento não leva a parte do Thiago', () => {
    const lv = livroDaObra(entrada65(obra65(), { adm: false }));
    expect(lv.fechamento.adm).toBeUndefined();
    expect(JSON.stringify(lv)).not.toContain('sobra');
    expect(lv.fechamento.custo).toBe(2_580_395);
  });
});

describe('estorno', () => {
  it('um frete e o estorno dele somam zero; as duas linhas ficam no livro e a original sai com `estornada`', () => {
    const frete = lanc('saida', 'frete', 5, '2026-10-22', 25_000, { por: 'diego' });
    const est = { ...lanc('saida', 'frete', 5, '2026-10-25', 25_000, { por: 'diego', conf: 'estorno', sem_arquivo: true }), id: idDoEstorno(frete.id) };
    est.obra = { ...est.obra, estorno_de: frete.id, motivo_estorno: 'Lancei no card errado' };
    const lv = livroDaObra(entrada65([frete, est]));
    expect(lv.gasto).toBe(0);
    expect(lv.por_etapa['5']).toBe(0);
    expect(lv.linhas).toHaveLength(2);
    const orig = lv.linhas.find((l) => l.id === frete.id)!;
    expect(orig.estornada).toMatchObject({ id: est.id, por: 'diego', motivo: 'Lancei no card errado' });
    expect(lv.linhas.find((l) => l.id === est.id)!.estorno_de).toBe(frete.id);
    // Sem comprovante no estorno: o total de comprovantes não conta a linha de estorno.
    expect(lv.fechamento.comprovantes).toEqual({ com: 1, total: 1 });
  });

  it('estornar uma entrada devolve o "a receber"; estornar uma comissão volta a pendência dela', () => {
    const e1 = lanc('entrada', 'entrada', 2, '2026-09-18', 1_167_000);
    const est1 = { ...lanc('entrada', 'entrada', 2, '2026-09-20', 1_167_000, { sem_arquivo: true, conf: 'estorno' }), id: idDoEstorno(e1.id) };
    est1.obra = { ...est1.obra, estorno_de: e1.id, motivo_estorno: 'Pix devolvido' };
    expect(livroDaObra(entrada65([e1, est1])).a_receber).toBe(3_890_000);

    const ent = lanc('entrada', 'entrada', 2, '2026-09-18', 1_167_000);
    const com = lanc('saida', 'comissao_venda', 2, '2026-09-21', 194_500, { comissao: { nome: 'nilce', papel: 'venda', pb: 500 } });
    const base = livroDaObra(entrada65([ent, com]));
    expect(base.comissoes.linhas.find((l) => l.nome === 'nilce')!.pago).toMatchObject({ id: com.id });
    expect(base.a_pagar.map((p) => p.texto)).not.toContain('Comissão de Nilce (venda 5%): R$ 1.945,00');
    const estCom = { ...lanc('saida', 'comissao_venda', 2, '2026-09-22', 194_500, { sem_arquivo: true, conf: 'estorno' }), id: idDoEstorno(com.id) };
    estCom.obra = { ...estCom.obra, estorno_de: com.id, motivo_estorno: 'Valor errado', comissao: com.obra.comissao };
    const depois = livroDaObra(entrada65([ent, com, estCom]));
    expect(depois.comissoes.linhas.find((l) => l.nome === 'nilce')!.pago).toBeNull();
    expect(depois.a_pagar.map((p) => p.texto)).toContain('Comissão de Nilce (venda 5%): R$ 1.945,00');
    expect(depois.gasto).toBe(0);
  });
});

describe('comissões pela regra', () => {
  it('a regra padrão dos Ajustes é igual ao `comissoesDaVenda` da Fase 1, para os 4 vendedores e um nome fora', () => {
    for (const v of ['nilce', 'diego', 'thiago', 'giovanna', 'carla', '']) {
      for (const valor of [3_890_000, 1_234_567, 0]) {
        expect(comissoesPelaRegra(v, valor, AJUSTES_PADRAO), `${v} ${valor}`).toEqual(comissoesDaVenda(v, valor));
      }
    }
  });

  it('uma regra mudada (Nilce 4%) muda a obra sem regra congelada e não muda a obra congelada', () => {
    const regra4 = { ...AJUSTES_PADRAO.comissoes, nilce: [{ nome: 'nilce', papel: 'venda' as const, pb: 400 }, ...AJUSTES_PADRAO.comissoes.nilce.slice(1)] };
    const mudada: AjustesSolar = { ...AJUSTES_PADRAO, comissoes: regra4 };
    expect(comissoesPelaRegra('nilce', 3_890_000, mudada).linhas[0].valor_centavos).toBe(155_600);
    expect(comissoesPelaRegra('nilce', 3_890_000, AJUSTES_PADRAO).linhas[0].valor_centavos).toBe(194_500);
    const ent = lanc('entrada', 'entrada', 2, '2026-09-18', 1_167_000);
    const semCongelar = livroDaObra(entrada65([ent], { regra: mudada.comissoes.nilce }));
    expect(semCongelar.comissoes.linhas[0].valor_centavos).toBe(155_600);
    // Congelada: o chamador manda a regra do `obra.json`, e a mudança dos Ajustes não chega aqui.
    const congelada = livroDaObra(entrada65([ent], { regra: AJUSTES_PADRAO.comissoes.nilce, regraCongelada: true }));
    expect(congelada.comissoes.linhas[0].valor_centavos).toBe(194_500);
    expect(congelada.comissoes.congelada).toBe(true);
  });

  it('o nome fora da lista usa o padrão com o aviso, e o `*` vira o vendedor', () => {
    const r = comissoesPelaRegra('Carla', 1_000_000);
    expect(r.aviso).toBe('Regra padrão. Confirme com o Thiago.');
    expect(r.linhas.map((l) => [l.nome, l.papel, l.valor_centavos, l.onde])).toEqual([['carla', 'venda', 50_000, 'custo'], ['thiago', 'socio', 20_000, 'retirada'], ['diego', 'socio', 20_000, 'retirada']]);
  });
});

describe('a pagar e o fechamento', () => {
  const limpo = (): LancamentoObra[] => obra65();
  it('sem nenhum pendente, `pode_fechar` é true', () => {
    expect(livroDaObra(entrada65(limpo())).fechamento.pode_fechar).toBe(true);
  });
  it('comissão sem pagamento depois da entrada entra no a pagar e bloqueia (sócio incluído)', () => {
    const sem = limpo().filter((l) => !l.obra.comissao);
    const lv = livroDaObra(entrada65(sem));
    expect(lv.a_pagar.map((p) => p.texto)).toEqual([
      'Comissão de Nilce (venda 5%): R$ 1.945,00', 'Comissão de Thiago (sócio 2%): R$ 778,00', 'Comissão de Diego (sócio 2%): R$ 778,00',
    ]);
    expect(lv.fechamento.a_pagar_total).toBe(194_500 + 77_800 + 77_800);
    expect(lv.fechamento.pode_fechar).toBe(false);
    // Antes da entrada a comissão ainda não está liberada.
    expect(livroDaObra(entrada65([])).a_pagar).toEqual([]);
  });
  it('engenheiro marcado "a pagar" sem o projeto elétrico bloqueia', () => {
    const sem = limpo().filter((l) => l.categoria !== 'projeto_eletrico');
    const lv = livroDaObra(entrada65(sem, { engenheiroAPagar: true }));
    expect(lv.a_pagar).toContainEqual({ tipo: 'engenheiro', texto: 'Engenheiro: valor a lançar', valor_centavos: null, etapa: 3 });
    expect(lv.fechamento.pode_fechar).toBe(false);
    expect(livroDaObra(entrada65(limpo(), { engenheiroAPagar: true })).fechamento.pode_fechar).toBe(true);
  });
  it('"a receber" diferente de zero, recebido a mais e venda sem valor bloqueiam', () => {
    const a = livroDaObra(entrada65(obra65().slice(0, 1).concat(obra65().slice(2))));
    expect(a.fechamento.faltam).toContain('A receber: R$ 27.230,00');
    expect(a.fechamento.pode_fechar).toBe(false);
    const mais = livroDaObra(entrada65([...obra65(), lanc('entrada', 'parcela', 8, '2026-11-05', 10_000)]));
    expect(mais.recebido_a_mais).toBe(10_000);
    expect(mais.fechamento.faltam).toContain('Recebido a mais: R$ 100,00');
    const semValor = livroDaObra(entrada65(obra65(), { vendaCentavos: null }));
    expect(semValor.a_receber).toBeNull();
    expect(semValor.fechamento.faltam).toContain('Sem valor de venda');
    expect(semValor.fechamento.adm).toMatchObject({ sobra: null, fica: null });
  });
  it('linhas sem assinatura (`ignoradas`) travam, e o material 0 de 0 também', () => {
    const lv = livroDaObra(entrada65(limpo(), { ignoradas: 2 }));
    expect(lv.fechamento.faltam).toEqual(['2 linhas do dinheiro sem assinatura. Fale com o Thiago.']);
    expect(lv.fechamento.pode_fechar).toBe(false);
    expect(lv.fechamento.pode_fechar_sem_material).toBe(false);
    const m0 = livroDaObra(entrada65(limpo(), { material: { com_origem: 0, total: 0 } }));
    expect(m0.fechamento.faltam).toEqual(['Nenhum item de material na Compra']);
    expect(m0.fechamento.pode_fechar).toBe(false);
    expect(m0.fechamento.pode_fechar_sem_material).toBe(true);
    const m5 = livroDaObra(entrada65(limpo(), { material: { com_origem: 5, total: 11 } }));
    expect(m5.fechamento.faltam).toEqual(['Material com origem: 5 de 11']);
  });
  it('lançamento sem comprovante aparece em "Falta comprovante: N lançamento"', () => {
    const l = [...limpo(), lanc('saida', 'combustivel', 8, '2026-11-04', 1_000, { sem_arquivo: true })];
    const lv = livroDaObra(entrada65(l));
    expect(lv.fechamento.faltam).toContain('Falta comprovante: 1 lançamento.');
    expect(lv.fechamento.comprovantes).toEqual({ com: 19, total: 20 });
    expect(lv.fechamento.pode_fechar).toBe(false);
  });
  it('pendências da obra (compra, equipe, frete) entram no a pagar e no fechamento', () => {
    const p = [{ tipo: 'compra' as const, texto: 'Compra Elétrica Central: falta pagar R$ 890,00', valor_centavos: 89_000, etapa: 4 }];
    const lv = livroDaObra(entrada65(limpo(), { pendenciasDaObra: p }));
    expect(lv.a_pagar).toEqual(p);
    expect(lv.fechamento).toMatchObject({ pendencias: 1, a_pagar_total: 89_000, pode_fechar: false });
  });
});

describe('a assinatura do lançamento', () => {
  const novo = () => {
    const m = montarLancamentoObra({
      id: 'lan-0000abcd', tipo: 'saida', categoria: 'frete', etapa: 5, valor_centavos: 25_000, data: '2026-10-22', forma: 'pix', descricao: 'Frete', contraparte: 'Frete Rápido Udi',
      conferencia: 'bateu', id_transacao: 'E123', origem: 'ia', lido_pela_ia: { valor_centavos: 25_000, data: '2026-10-22', id_transacao: 'E123' },
      arquivo: { path: `fin/${CARD}/202610/a.pdf`, nome: 'c.pdf', tipo: 'application/pdf', tamanho: 10, sha256: 'a'.repeat(64) }, compra_id: null, carga_id: 'c-1',
    }, { cardId: CARD, autor: 'diego', agoraIso: '2026-10-22T10:00:00.000Z', hojeBr: '2026-10-22' });
    if (!m.ok) throw new Error(m.erro);
    return lancamentoObraParaGravar(CARD, m.lancamento)!;
  };
  it('volta igual, e relido com as chaves embaralhadas em todos os níveis continua válido', () => {
    const l = novo();
    expect(lancamentoObraAssinado(CARD, l)).toEqual(l);
    const embaralhado = comoJsonb(l);
    expect(Object.keys(embaralhado as object)).not.toEqual(Object.keys(l));
    expect(lancamentoObraAssinado(CARD, embaralhado)).toEqual(l);
    expect(lancamentoObraAssinado(CARD, JSON.parse(JSON.stringify(embaralhado)))).toEqual(l);
  });
  it('mexer em qualquer campo invalida', () => {
    const l = novo() as any;
    const mexidas: Array<(x: any) => void> = [
      (x) => { x.valor_centavos = 1; }, (x) => { x.data = '2026-10-23'; }, (x) => { x.descricao = 'Outro'; }, (x) => { x.categoria = 'material'; },
      (x) => { x.arquivo.sha256 = 'b'.repeat(64); }, (x) => { x.arquivo.path = `fin/${CARD}/202610/z.pdf`; }, (x) => { x.lido_pela_ia.valor_centavos = 1; },
      (x) => { x.obra.etapa = 6; }, (x) => { x.obra.conferencia = 'sem_leitura'; }, (x) => { x.obra.carga_id = 'c-2'; }, (x) => { x.criado_por = 'nilce'; },
      (x) => { x.id_transacao = 'E999'; }, (x) => { x.sig = x.sig.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a')); },
    ];
    for (const f of mexidas) {
      const c = JSON.parse(JSON.stringify(l));
      f(c);
      expect(lancamentoObraAssinado(CARD, c)).toBeNull();
    }
  });
  it('a assinatura de um card não vale em outro, e sem segredo é null', () => {
    const l = novo();
    expect(lancamentoObraAssinado(66, { ...l, card_id: 66 })).toBeNull();
    expect(assinarLancamentoObra(66, l)).toBeNull();
    delete process.env.VINCULO_SOLAR_SECRET;
    const antes = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      expect(assinarLancamentoObra(CARD, l)).toBeNull();
      expect(lancamentoObraAssinado(CARD, l)).toBeNull();
      expect(lancamentoObraParaGravar(CARD, l)).toBeNull();
    } finally { if (antes !== undefined) process.env.SUPABASE_SERVICE_KEY = antes; }
  });
  it('categoria fora da lista do tipo, valor ou data inválidos e grupo trocado não passam', () => {
    const l = novo() as any;
    expect(normalizarLancamentoObra(CARD, { ...l, categoria: 'sinal' })).toBeNull();
    expect(normalizarLancamentoObra(CARD, { ...l, tipo: 'entrada' })).toBeNull();
    expect(normalizarLancamentoObra(CARD, { ...l, valor_centavos: 0 })).toBeNull();
    expect(normalizarLancamentoObra(CARD, { ...l, valor_centavos: 1.5 })).toBeNull();
    expect(normalizarLancamentoObra(CARD, { ...l, data: '2026-02-31' })).toBeNull();
    expect(normalizarLancamentoObra(CARD, { ...l, obra: { ...l.obra, grupo: 'retirada' } })).toBeNull();
    expect(normalizarLancamentoObra(CARD, { ...l, obra: { ...l.obra, etapa: 10 } })).toBeNull();
  });
  it('a montagem valida categoria, valor, data, forma e descrição, e o grupo vem da categoria', () => {
    const ctx = { cardId: CARD, autor: 'diego', agoraIso: '2026-10-22T10:00:00.000Z', hojeBr: '2026-10-22' };
    const ok = { id: 'lan-0000abcd', tipo: 'saida', categoria: 'combustivel', etapa: 1, valor_centavos: 100, data: '2026-10-22', conferencia: 'sem_leitura' };
    expect(montarLancamentoObra(ok, ctx)).toMatchObject({ ok: true });
    const ret = montarLancamentoObra({ ...ok, categoria: 'retirada_socio' }, ctx);
    expect(ret.ok && ret.lancamento.obra.grupo).toBe('retirada');
    const erro = (extra: Record<string, unknown>) => { const r = montarLancamentoObra({ ...ok, ...extra }, ctx); return r.ok ? 'ok' : r.erro; };
    expect(erro({ categoria: 'sinal' })).toBe('categoria_invalida');
    expect(erro({ valor_centavos: 0 })).toBe('valor_invalido');
    expect(erro({ valor_centavos: 12.5 })).toBe('valor_invalido');
    expect(erro({ data: '2026-13-01' })).toBe('data_invalida');
    expect(erro({ data: '2019-12-31' })).toBe('data_invalida');
    expect(erro({ forma: 'cheque' })).toBe('forma_invalida');
    expect(erro({ id: 'x' })).toBe('id_invalido');
    expect(erro({ etapa: 0 })).toBe('etapa_invalida');
    expect(erro({ categoria: 'outros' })).toBe('descricao_obrigatoria');
    expect(erro({ categoria: 'outros', descricao: 'Algo' })).toBe('ok');
    expect(erro({ tipo: 'entrada', categoria: 'entrada' })).toBe('ok');
    expect(erro({ tipo: 'entrada', categoria: 'frete' })).toBe('categoria_invalida');
  });
  it('o id do estorno é fixo: o mesmo para a mesma linha', () => {
    expect(idDoEstorno('lan-0000abcd')).toBe(idDoEstorno('lan-0000abcd'));
    expect(idDoEstorno('lan-0000abcd')).toMatch(/^est-[0-9a-f]{40}$/);
    expect(idDoEstorno('lan-0000abce')).not.toBe(idDoEstorno('lan-0000abcd'));
  });
});

describe('o `lancamentoDe` antigo não perde `obra` nem `sig`', () => {
  it('uma linha solar relida mantém os dois campos novos; a de eletroposto segue sem eles', () => {
    const l = novo2();
    const lido = lancamentoDe(JSON.parse(JSON.stringify(comoJsonb(l))));
    expect(lido).not.toBeNull();
    expect(lido!.sig).toBe(l.sig);
    expect(lido!.obra).toMatchObject({ v: 1, etapa: 5, grupo: 'custo', conferencia: 'bateu', carga_id: 'c-1' });
    const velho = lancamentoDe({ id: 'ent-00000001', card_id: 5, tipo: 'entrada', categoria: 'sinal', valor_centavos: 1, data: '2026-10-01' });
    expect(velho).not.toBeNull();
    expect('obra' in velho!).toBe(false);
    expect('sig' in velho!).toBe(false);
  });
  function novo2(): LancamentoObra {
    const x = lanc('saida', 'frete', 5, '2026-10-22', 25_000, { por: 'diego' });
    x.obra.carga_id = 'c-1';
    return lancamentoObraParaGravar(CARD, x)!;
  }
});

describe('os Ajustes', () => {
  it('a validação recusa duas linhas `venda`, sócio que não é sócio, pb acima de 2.000 e soma acima de 2.000', () => {
    const nilce = AJUSTES_PADRAO.comissoes.nilce;
    const ok = (c: Record<string, unknown>) => validarAjustes(c);
    expect(ok({ nilce })).toMatchObject({ ok: true });
    expect(ok({ nilce: [...nilce, { nome: 'nilce', papel: 'venda', pb: 100 }].slice(0, 4) })).toEqual({ ok: false, erro: 'uma_venda' });
    expect(ok({ nilce: [{ nome: 'nilce', papel: 'venda', pb: 500 }, { nome: 'carla', papel: 'socio', pb: 200 }] })).toEqual({ ok: false, erro: 'socio_invalido' });
    expect(ok({ nilce: [{ nome: 'nilce', papel: 'venda', pb: 2001 }] })).toEqual({ ok: false, erro: 'pb_invalido' });
    expect(ok({ nilce: [{ nome: 'nilce', papel: 'venda', pb: 1500 }, { nome: 'thiago', papel: 'socio', pb: 600 }] })).toEqual({ ok: false, erro: 'soma_alta' });
    expect(ok({ nilce: [{ nome: 'thiago', papel: 'venda', pb: 500 }] })).toEqual({ ok: false, erro: 'venda_invalida' });
    expect(ok({ nilce: [] })).toEqual({ ok: false, erro: 'lista_invalida' });
    expect(ok({ nilce: [...nilce, nilce[1], nilce[2]] })).toEqual({ ok: false, erro: 'lista_invalida' });
    expect(ok({ padrao: [{ nome: 'nilce', papel: 'venda', pb: 500 }] })).toEqual({ ok: false, erro: 'venda_invalida' });
    expect(validarAjustes(null)).toEqual({ ok: false, erro: 'ajustes_invalidos' });
    // Nomes a mais: até 6.
    const extras = Object.fromEntries(['ana', 'bia', 'cris', 'dani', 'edu', 'fabi', 'gabi'].map((n) => [n, [{ nome: n, papel: 'venda', pb: 500 }]]));
    expect(validarAjustes(extras)).toEqual({ ok: false, erro: 'nomes_demais' });
    expect(validarAjustes({ ana: [{ nome: 'ana', papel: 'venda', pb: 500 }] })).toMatchObject({ ok: true });
  });
  it('assinado volta igual (mesmo embaralhado); mexido ou sem a assinatura vale o padrão', () => {
    const a: AjustesSolar = normalizarAjustes({ ...AJUSTES_PADRAO, dinheiro_aberto: false, editado_em: '2026-11-06T10:00:00.000Z', editado_por: 'thiago' })!;
    const sig = assinarAjustes(a)!;
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const value = { ...a, sig };
    expect(ajustesAssinados(value)).toEqual(a);
    expect(ajustesAssinados(JSON.parse(JSON.stringify(comoJsonb(value))))).toEqual(a);
    const forjado = JSON.parse(JSON.stringify(value));
    forjado.comissoes.nilce[0].pb = 1;
    expect(ajustesAssinados(forjado)).toBeNull();
    const aberto = JSON.parse(JSON.stringify(value));
    aberto.dinheiro_aberto = true;
    expect(ajustesAssinados(aberto)).toBeNull();
    expect(ajustesAssinados({ ...a })).toBeNull();
    expect(ajustesAssinados(null)).toBeNull();
  });
});

describe('o estado da Fase 1 segue válido (D15)', () => {
  // Gerado ANTES de qualquer edição, no HEAD de 05/11/2026, com VINCULO_SOLAR_SECRET = 'segredo-de-teste-inventado' (o `assinarJornada` da
  // Fase 1, etapa 4 aberta). Assinar aqui dentro não provaria nada: o literal prova que NENHUMA mudança desta fase invalidou o que já está gravado.
  const LITERAL = '{"v":1,"card":4242,"origem":"vendido","vendido_em":"2026-10-01T12:00:00.000Z","vendido_por":"thiago","vendedor":"nilce","etapas":{"1":{"aberta_em":"2026-10-01T12:00:00.000Z","concluida_em":"2026-10-02T12:00:00.000Z","concluida_por":"nilce","excedente":"nao"},"2":{"aberta_em":"2026-10-02T12:00:00.000Z","concluida_em":"2026-10-05T12:00:00.000Z","concluida_por":"giovanna","papeis":{"contrato":{"gerado_em":"2026-10-03T12:00:00.000Z","por":"giovanna"},"procuracao":null,"recibo":null}},"3":{"aberta_em":"2026-10-05T12:00:00.000Z","concluida_em":"2026-10-20T12:00:00.000Z","concluida_por":"thiago","rateio":null,"protocolo":{"numero":"1026-50392","em":"2026-10-06"},"engenheiro":"pago","trello":null},"4":{"aberta_em":"2026-10-20T12:00:00.000Z"}},"esperando":null,"cancelada":null,"numero":{"tentado_em":"2026-10-04T12:00:00.000Z","falha":null,"nasceu_em":"2026-10-04T12:00:00.000Z"},"historico":[{"em":"2026-10-20T12:00:00.000Z","por":"thiago","acao":"concluir","etapa":3}]}';
  const SIG = 'cc25e7ac1d32b335086efcf285ad1f4a34c17d74b4470f7cac75a499ffb2cbdf';
  it('a assinatura gravada antes da Fase 2 ainda confere', () => {
    const value = { ...JSON.parse(LITERAL), sig: SIG };
    const e = jornadaAssinada(4242, value);
    expect(e).not.toBeNull();
    expect(e!.etapas[4]).toEqual({ aberta_em: '2026-10-20T12:00:00.000Z' });
    expect(e!.etapas[3].protocolo).toEqual({ numero: '1026-50392', em: '2026-10-06' });
    expect(jornadaAssinada(4242, comoJsonb(value))).not.toBeNull();
    expect(jornadaAssinada(4243, { ...value, card: 4243 })).toBeNull();
    const mexido = JSON.parse(JSON.stringify(value));
    mexido.etapas['4'].aberta_em = '2026-10-21T12:00:00.000Z';
    expect(jornadaAssinada(4242, mexido)).toBeNull();
  });
});

describe('a retirada dos sócios só para quem pode ver (recorte do livro)', () => {
  const inteiro = () => livroDaObra(entrada65(obra65()));
  it('o ADM e a Giovanna recebem o livro inteiro; os outros, sem as linhas, sem o total e com o saldo igual a recebido menos gasto', () => {
    const l = inteiro();
    expect(recortarLivro(l, true)).toBe(l);
    const v = recortarLivro(l, false) as any;
    expect(v.retirada).toBeUndefined();
    expect('retirada' in v).toBe(false);
    expect(v.saldo).toBe(3_890_000 - 2_580_395);
    expect(v.linhas).toHaveLength(17);
    expect(v.linhas.some((x: any) => x.grupo === 'retirada' || x.categoria === 'retirada_socio')).toBe(false);
    expect(v.comissoes.linhas.map((x: any) => [x.nome, x.papel])).toEqual([['nilce', 'venda']]);
    expect(v.fechamento.comprovantes).toEqual({ com: 17, total: 17 });
    expect(v.fechamento.adm).toBeUndefined();
    expect(v.gasto).toBe(2_580_395);
    expect(v.por_etapa['2']).toBe(196_340);   // o custo da etapa 2 (cartório e comissão de quem vendeu) fica
    // Nada do que sobra permite deduzir os 1.556,00 da retirada.
    const texto = JSON.stringify(v);
    expect(texto).not.toMatch(/77800|155600|retirada_socio|sócio|socio/);
    expect(l.retirada).toBe(155_600);
  });
  it('a pendência do sócio some da conta dos outros, mas a de quem vendeu fica; o servidor segue decidindo pelo livro inteiro', () => {
    const sem = obra65().filter((x) => !x.obra.comissao);
    const l = livroDaObra(entrada65(sem));
    expect(l.a_pagar).toHaveLength(3);
    const v = recortarLivro(l, false);
    expect(v.a_pagar.map((p) => p.texto)).toEqual(['Comissão de Nilce (venda 5%): R$ 1.945,00']);
    expect(v.fechamento).toMatchObject({ a_pagar_total: 194_500, pendencias: 1 });
    expect(v.fechamento.faltam.join('|')).not.toMatch(/Thiago|Diego|sócio/);
    expect(l.fechamento.pode_fechar).toBe(false);
  });
  it('quando o sócio vende, a parte dele como vendedor (custo) fica e a de sócio (retirada) sai', () => {
    const l = livroDaObra(entrada65([lanc('entrada', 'entrada', 2, '2026-09-18', 3_890_000)], { vendedor: 'diego', regra: AJUSTES_PADRAO.comissoes.diego }));
    expect(l.comissoes.linhas.map((x) => [x.nome, x.papel])).toEqual([['diego', 'venda'], ['diego', 'socio'], ['thiago', 'socio']]);
    expect(recortarLivro(l, false).comissoes.linhas.map((x) => [x.nome, x.papel])).toEqual([['diego', 'venda']]);
  });
});

describe('sem comprovante, divergente e a assinatura que não muda (05/11/2026)', () => {
  it('uma linha no formato de ANTES (sem nenhum campo novo), assinada antes desta mudança, continua válida', () => {
    // O JSON abaixo é, byte a byte, o que o normalizador antigo produzia. A assinatura é calculada aqui, de fora, sobre ele.
    const antigo = {
      id: 'lan-0000legc', card_id: CARD, tipo: 'saida', categoria: 'frete', valor_centavos: 25_000, data: '2026-10-22', forma: 'pix', descricao: 'Frete', contraparte: 'Frete Rápido Udi',
      id_transacao: 'E123', arquivo: { path: `fin/${CARD}/202610/a.pdf`, nome: 'c.pdf', tipo: 'application/pdf', tamanho: 10, sha256: 'a'.repeat(64) }, origem: 'ia',
      lido_pela_ia: { valor_centavos: 25_000, data: '2026-10-22', id_transacao: 'E123' }, criado_por: 'diego', criado_em: '2026-10-22T10:00:00.000Z',
      alteracoes: [{ em: '2026-10-23T10:00:00.000Z', por: 'thiago', de: 'sem_leitura', para: 'conferido_adm' }],
      apagado: false, apagado_por: '', apagado_em: '', motivo_apagado: '',
      obra: { v: 1, etapa: 5, grupo: 'custo', conferencia: 'bateu', estorno_de: null, motivo_estorno: '', devolucao: false, comissao: null, compra_id: null, carga_id: 'c-1' },
    };
    const sig = crypto.createHmac('sha256', Buffer.from(SEGREDO, 'utf8')).update(`fin_obra|${CARD}|${antigo.id}|${JSON.stringify(antigo)}`).digest('hex');
    const lido = lancamentoObraAssinado(CARD, comoJsonb({ ...antigo, sig }));
    expect(lido).not.toBeNull();
    expect(lido!.obra).toEqual(antigo.obra);
    expect(lido!.obra).not.toHaveProperty('dispensa');
    expect(lido!.obra).not.toHaveProperty('divergencia');
    expect(lido!.obra).not.toHaveProperty('nota_ia');
    expect(lido!.alteracoes[0]).toEqual(antigo.alteracoes[0]);
    // Assinar de novo gera o MESMO valor.
    expect(assinarLancamentoObra(CARD, antigo)).toBe(sig);
  });

  const base1 = () => lancamentoObraParaGravar(CARD, {
    ...normalizarLancamentoObra(CARD, lanc('saida', 'frete', 5, '2026-10-22', 25_000, { sem_arquivo: true, conf: 'sem_comprovante' }))!,
  })!;
  it('os campos novos (nota_ia, divergencia, dispensa, motivo da alteração) entram na assinatura: mexer neles invalida', () => {
    const l = lancamentoObraParaGravar(CARD, {
      ...base1(),
      alteracoes: [{ em: '2026-10-23T10:00:00.000Z', por: 'thiago', de: 'sem_comprovante', para: 'dispensado', motivo: 'Pagou em dinheiro' }],
      obra: { ...base1().obra, nota_ia: 'A IA não reconheceu como comprovante', divergencia: { lido_centavos: 30_000, digitado_centavos: 25_000 }, dispensa: { em: '2026-10-23T10:00:00.000Z', por: 'thiago', motivo: 'Pagou em dinheiro' } },
    })!;
    expect(l.obra).toMatchObject({ nota_ia: 'A IA não reconheceu como comprovante', divergencia: { lido_centavos: 30_000, digitado_centavos: 25_000 }, dispensa: { por: 'thiago', motivo: 'Pagou em dinheiro' } });
    expect(l.alteracoes[0].motivo).toBe('Pagou em dinheiro');
    expect(lancamentoObraAssinado(CARD, comoJsonb(l))).toEqual(l);
    const mexidas: Array<(x: any) => void> = [
      (x) => { x.obra.dispensa.motivo = 'Outro motivo'; }, (x) => { delete x.obra.dispensa; }, (x) => { x.obra.divergencia.lido_centavos = 25_000; },
      (x) => { x.obra.nota_ia = ''; }, (x) => { x.alteracoes[0].motivo = 'Outro'; }, (x) => { x.obra.conferencia = 'bateu'; },
    ];
    for (const f of mexidas) {
      const c = JSON.parse(JSON.stringify(l));
      f(c);
      expect(lancamentoObraAssinado(CARD, c), String(f)).toBeNull();
    }
  });
  it('dispensa incompleta ou divergência sem os dois valores é descartada, e o valor novo de conferência vale', () => {
    const n = normalizarLancamentoObra(CARD, {
      ...base1(), obra: { ...base1().obra, dispensa: { em: 'x', por: '', motivo: '' }, divergencia: { lido_centavos: 5 }, nota_ia: '   ' },
    })!;
    expect(n.obra).not.toHaveProperty('dispensa');
    expect(n.obra).not.toHaveProperty('divergencia');
    expect(n.obra).not.toHaveProperty('nota_ia');
    expect(n.obra.conferencia).toBe('sem_comprovante');
    expect(normalizarLancamentoObra(CARD, { ...base1(), obra: { ...base1().obra, conferencia: 'inventada' } })).toBeNull();
  });

  const semProva = (por = 'diego', valor = 25_000) => lanc('saida', 'frete', 5, '2026-10-22', valor, { sem_arquivo: true, conf: 'sem_comprovante', por });
  it('o livro: saída sem comprovante entra no gasto, aparece na linha e trava o fechamento (inclusive o da etapa 8)', () => {
    const lv = livroDaObra(entrada65([...obra65(), semProva()]));
    const linha = lv.linhas.find((x) => x.conferencia === 'sem_comprovante')!;
    expect(linha).toMatchObject({ sem_comprovante: true, comprovante: null, dispensa: null, criado_por: 'diego' });
    expect(lv.gasto).toBe(2_580_395 + 25_000);
    expect(lv.fechamento.faltam).toEqual(['Falta comprovante: 1 lançamento.']);
    expect(lv.fechamento).toMatchObject({ pode_fechar: false, pode_fechar_sem_material: false, comprovantes: { com: 19, total: 20 } });
    // Não é pendência de pagar: o "a pagar" não cresce.
    expect(lv.a_pagar).toEqual([]);
    expect(lv.fechamento.a_pagar_total).toBe(0);
  });
  it('o livro: linha liberada pelo ADM conta como resolvida, a estornada não pesa, e o estorno sem devolução não precisa de arquivo', () => {
    const liberada = semProva();
    liberada.obra.dispensa = { em: '2026-10-23T10:00:00.000Z', por: 'thiago', motivo: 'Pagou em dinheiro' };
    const lv = livroDaObra(entrada65([...obra65(), liberada]));
    expect(lv.linhas.find((x) => x.id === liberada.id)).toMatchObject({ sem_comprovante: false, dispensa: { por: 'thiago' } });
    expect(lv.fechamento).toMatchObject({ pode_fechar: true, faltam: [], comprovantes: { com: 20, total: 20 } });
    const errada = semProva('diego', 7_000);
    const est = { ...lanc('saida', 'frete', 5, '2026-10-23', 7_000, { sem_arquivo: true, conf: 'estorno', por: 'diego' }), id: 'est-0000aaaa' };
    est.obra.estorno_de = errada.id;
    const lv2 = livroDaObra(entrada65([...obra65(), errada, est]));
    expect(lv2.fechamento.faltam).toEqual([]);
    expect(lv2.fechamento.pode_fechar).toBe(true);
    expect(lv2.linhas.find((x) => x.id === errada.id)).toMatchObject({ sem_comprovante: false });
  });
  it('o livro: `divergente` conta como não conferido pela IA até o ADM marcar', () => {
    const dv = lanc('saida', 'frete', 5, '2026-10-22', 26_000, { conf: 'divergente', por: 'diego' });
    dv.obra.divergencia = { lido_centavos: 25_000, digitado_centavos: 26_000 };
    const lv = livroDaObra(entrada65([...obra65(), dv]));
    expect(lv.fechamento.faltam).toEqual(['1 lançamento não conferido pela IA. O Thiago confere.']);
    expect(lv.linhas.find((x) => x.id === dv.id)).toMatchObject({ conferencia: 'divergente', divergencia: { lido_centavos: 25_000, digitado_centavos: 26_000 } });
    const ok = { ...dv, obra: { ...dv.obra, conferencia: 'conferido_adm' as const } };
    expect(livroDaObra(entrada65([...obra65(), ok])).fechamento.pode_fechar).toBe(true);
  });
  it('recortarLivro: quem não vê a retirada não conta a retirada sem comprovante, nem em `faltam`, nem em `comprovantes`', () => {
    const ret = lanc('saida', 'retirada_socio', 2, '2026-10-02', 77_800, { sem_arquivo: true, conf: 'sem_comprovante', por: 'giovanna', comissao: { nome: 'thiago', papel: 'socio', pb: 200 } });
    const venda = semProva('diego');
    const lv = livroDaObra(entrada65([...obra65(), ret, venda]));
    expect(lv.fechamento.faltam).toContain('Falta comprovante: 2 lançamentos.');
    const v = recortarLivro(lv, false) as any;
    expect(v.fechamento.faltam).toContain('Falta comprovante: 1 lançamento.');
    expect(v.fechamento.faltam).not.toContain('Falta comprovante: 2 lançamentos.');
    expect(v.fechamento.comprovantes).toEqual({ com: 17, total: 18 });
    expect(v.linhas.every((x: any) => x.grupo !== 'retirada')).toBe(true);
    expect(v.fechamento.pode_fechar).toBe(false);
    // Só a retirada sem comprovante: para quem não a vê o fechamento não fala dela.
    const so = recortarLivro(livroDaObra(entrada65([...obra65(), ret])), false) as any;
    expect(so.fechamento.faltam.some((t: string) => t.startsWith('Falta comprovante'))).toBe(false);
    expect(so.fechamento.comprovantes).toEqual({ com: 17, total: 17 });
  });
});
