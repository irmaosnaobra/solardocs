import { describe, it, expect } from 'vitest';
import {
  montarCatalogo, colunasPara, colunaPublica, lerGrade, montarLinhas, validarValor, normalizarDaPlanilha, celulaDe,
  progressoDe, totais, houveConflito, aplicarGravacao, lerRegistro, aplicarSobrescritas, chaveGestao, codigoDaChave,
  numeroBR, mesclarOpcoes, LISTAS_DE_GENTE, type ColunaInterna, type RegistroGestao, type Coluna,
} from '../services/gerador/gestaoClientes';
import { celulaEhFixa, consultorEfetivo, COLUNAS_PESSOAIS, type Derivada } from '../services/gerador/gestaoClientes';
import { lerPlanilha, montarObra, type ObraBruta } from '../services/gerador/solarObras';
import { CABECALHO as CABECALHO_FIXTURE, planilhaPadrao } from './solarPlanilhaFixture';

// Dados todos inventados. As colunas de sócio levam valores-sentinela (ZZ...) para provar que nenhum chega ao consultor.

/** O cabeçalho REAL da planilha hoje, na ordem, com os nomes repetidos. */
const CABECALHO_REAL: string[] = [
  'J49', 'NOME CLIENTE', 'NOME HOMOLOGAÇÃO', 'CONSULTOR', 'ORIGEM DO LEAD', 'VALOR DA VENDA', 'FORMA DE PAGTO', 'RECEBIDO REAL',
  'RECEBIMENTO', 'SISTEMA LIBERADO PELA CONCESSIONARIA', 'DEPOIMENTO INSTAGRAM', 'CONTATO', 'ENDEREÇO', 'CIDADE', 'UF',
  'ENTREGA DO MATERIAL', 'PREVISÃO DE MONTAGEM', 'DATA INICIO INSTALAÇÃO', 'DATA FINAL INSTALAÇÃO', 'QTD PLACA', 'MODELO PLACA',
  'POT PLACA', 'STATUS', 'QTD INV', 'MODELO E VOLTAGEM DO INVERSOR', 'MODELO INVERSOR', 'STATUS', 'TIPO ESTRUTURA', 'STATUS',
  'OUTRO EQUIP', 'CONTRATO COOPERATIVA', 'TEMPO DE CONTRATO COOP', 'OBS:', 'CADASTRO TRELLO', 'PAGTO ART', 'VALOR ART',
  'DATA EMISSÃO ULTIMO PARECER DE ACESSO', 'DATA PEDIDO DE VISTORIA', 'LIBERAÇÃO VISTORIA', 'ENGENHEIRO', 'EXCEDENTES',
  'CONCESSIONARIA', 'VALOR PAGO DO PROJETO', 'VALOR KIT', 'TAXAS/DESCONTOS', 'FATOR X', 'FORNECEDOR', 'AC - CC', 'EQUIPE',
  'PREVISÃO DE MONTAGEM', 'INCIO INSTALAÇÃO', 'FIM INSTALAÇÃO', 'KM INICIAL', 'KM FINAL', 'KM TOTAL',
  'M.O / PEÇAS/ ALIM / HOSP/PED', 'NF', 'COMISSÃO VENDA', 'PRÉ VENDA', 'TOTAL CUSTO', 'TOTAL LUCRO', '% DE LUCRO',
];

const SOCIO_CHAVES = [
  'origem', 'valor_venda', 'recebido_real', 'forma_pagto', 'pagto_art', 'valor_art', 'valor_projeto', 'valor_kit', 'taxas_descontos',
  'fator_x', 'fornecedor', 'ac_cc', 'km_inicial', 'km_final', 'km_total', 'mao_de_obra', 'nf', 'comissao_venda', 'pre_venda',
  'total_custo', 'total_lucro', 'pct_lucro',
];
const CALCULADAS = ['km_total', 'total_custo', 'total_lucro', 'pct_lucro'];

/** Sentinela por coluna de sócio: se aparecer numa resposta de consultor, vazou. */
const SENTINELA: Record<string, string> = {
  origem: '#0013 ZZCleberAlheio',  valor_venda: 'R$ 8.887,77', forma_pagto: 'ZZFORMA11', recebido_real: 'R$ 7.776,66', pagto_art: 'ZZART22', valor_art: 'R$ 654,32',
  valor_projeto: 'R$ 987,65', valor_kit: 'R$ 4.321,09', taxas_descontos: 'R$ 111,22', fator_x: 'ZZFATOR12', fornecedor: 'ZZFORN33',
  ac_cc: 'R$ 4.444,44', km_inicial: 'ZZKMI101', km_final: 'ZZKMF202', km_total: 'ZZKMT303', mao_de_obra: 'R$ 555,44', nf: 'ZZNF55',
  comissao_venda: 'R$ 333,21', pre_venda: 'R$ 222,10', total_custo: 'R$ 6.543,21', total_lucro: 'R$ 2.345,67', pct_lucro: 'ZZPCT265',
};

function linhaReal(campos: Record<string, string>): string[] {
  const l = new Array(CABECALHO_REAL.length).fill('');
  l[0] = campos.codigo;
  const idx = (nome: string, n = 0) => CABECALHO_REAL.map((c, i) => [c, i] as const).filter(([c]) => c === nome)[n][1];
  const por: Record<string, number> = {
    cliente: idx('NOME CLIENTE'), consultor: idx('CONSULTOR'), uf: idx('UF'), cidade: idx('CIDADE'),
    contato: idx('CONTATO'), cadastro: idx('CADASTRO TRELLO'), fim: idx('DATA FINAL INSTALAÇÃO'),
    parecer: idx('DATA EMISSÃO ULTIMO PARECER DE ACESSO'), entrega: idx('ENTREGA DO MATERIAL'), qtd: idx('QTD PLACA'),
    recebimento: idx('RECEBIMENTO'), engenheiro: idx('ENGENHEIRO'), equipe: idx('EQUIPE'),
    statusPlaca: idx('STATUS', 0), statusInv: idx('STATUS', 1), statusEst: idx('STATUS', 2), liberado: idx('SISTEMA LIBERADO PELA CONCESSIONARIA'),
    liberVist: idx('LIBERAÇÃO VISTORIA'), inicio: idx('DATA INICIO INSTALAÇÃO'), previsao: idx('PREVISÃO DE MONTAGEM', 0),
    modeloPlaca: idx('MODELO PLACA'),
  };
  for (const [k, v] of Object.entries(campos)) if (k in por) l[por[k]] = v;
  // sentinelas de sócio
  const nomes: Record<string, string> = {
    origem: 'ORIGEM DO LEAD', valor_venda: 'VALOR DA VENDA', forma_pagto: 'FORMA DE PAGTO', recebido_real: 'RECEBIDO REAL', pagto_art: 'PAGTO ART',
    valor_art: 'VALOR ART', valor_projeto: 'VALOR PAGO DO PROJETO', valor_kit: 'VALOR KIT', taxas_descontos: 'TAXAS/DESCONTOS',
    fator_x: 'FATOR X', fornecedor: 'FORNECEDOR', ac_cc: 'AC - CC', km_inicial: 'KM INICIAL', km_final: 'KM FINAL', km_total: 'KM TOTAL',
    mao_de_obra: 'M.O / PEÇAS/ ALIM / HOSP/PED', nf: 'NF', comissao_venda: 'COMISSÃO VENDA', pre_venda: 'PRÉ VENDA',
    total_custo: 'TOTAL CUSTO', total_lucro: 'TOTAL LUCRO', pct_lucro: '% DE LUCRO',
  };
  for (const [k, nome] of Object.entries(nomes)) l[idx(nome)] = SENTINELA[k];
  return l;
}
const csv = (linhas: string[][]) => [CABECALHO_REAL, ...linhas]
  .map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

const VENDAS = [
  linhaReal({ codigo: '#0057', cliente: 'Ana Souza', consultor: 'Nilce', uf: 'MG', cidade: 'Uberlandia', contato: '(34) 99999-0000', cadastro: '03/08/2026', engenheiro: 'Guilherme', equipe: 'Propria' }),
  linhaReal({ codigo: '#0058', cliente: 'Bruno Lima', consultor: 'Diego', uf: 'MG', cadastro: '01/09/2026', engenheiro: 'Marcos', equipe: 'Terceira', recebimento: 'Quitado' }),
  linhaReal({ codigo: '#0059', cliente: '<script>x</script>', consultor: 'Nilce', cadastro: '20/08/2026', engenheiro: 'Guilherme' }),
];
const GRADE = lerGrade(csv(VENDAS));
const COLS = montarCatalogo(GRADE.cabecalho, GRADE.vendas);
const porChave = (cols: Coluna[], k: string) => cols.find((c) => c.chave === k)!;

describe('catálogo a partir do cabeçalho real', () => {
  it('62 colunas, chaves únicas, tipos e grupos conhecidos', () => {
    expect(CABECALHO_REAL).toHaveLength(62);
    expect(COLS).toHaveLength(62);
    expect(new Set(COLS.map((c) => c.chave)).size).toBe(62);
    expect(COLS.some((c) => c.grupo === 'Outros')).toBe(false);   // nenhuma coluna real caiu em "desconhecida"
  });
  it('os três STATUS e as duas PREVISÃO de montagem ficam distintos', () => {
    expect(['status_placa', 'status_inversor', 'status_estrutura', 'previsao_montagem', 'previsao_montagem_2']
      .every((k) => !!porChave(COLS, k))).toBe(true);
    const ind = (k: string) => (COLS.find((c) => c.chave === k) as ColunaInterna).indice;
    expect(CABECALHO_REAL[ind('status_placa') - 1]).toBe('POT PLACA');
    expect(CABECALHO_REAL[ind('status_inversor') - 1]).toBe('MODELO INVERSOR');
    expect(CABECALHO_REAL[ind('status_estrutura') - 1]).toBe('TIPO ESTRUTURA');
    expect(ind('previsao_montagem_2')).toBeGreaterThan(ind('previsao_montagem'));
    expect(porChave(COLS, 'status_placa').opcoes).toEqual(['Instalado', 'No cliente', 'Estoque', 'Comprar']);
  });
  it('só sócio, calculadas e obrigatórias seguem a regra', () => {
    for (const k of SOCIO_CHAVES) expect(porChave(COLS, k).quem_ve, k).toBe('socio');
    expect(COLS.filter((c) => c.quem_ve === 'socio').map((c) => c.chave).sort()).toEqual([...SOCIO_CHAVES].sort());
    expect(COLS.filter((c) => c.calculada).map((c) => c.chave).sort()).toEqual([...CALCULADAS].sort());
    for (const k of ['obs', 'outro_equip', 'excedentes', 'contrato_coop', 'tempo_contrato_coop']) expect(porChave(COLS, k).obrigatoria, k).toBe(false);
    for (const k of CALCULADAS) expect(porChave(COLS, k).obrigatoria, k).toBe(false);
    expect(porChave(COLS, 'codigo')).toMatchObject({ obrigatoria: false, editavel: false });
    expect(porChave(COLS, 'cliente').obrigatoria).toBe(true);
    expect(porChave(COLS, 'valor_venda').obrigatoria).toBe(true);
  });
  it('listas: fixas e dinâmicas (valores distintos das linhas, mais "outro")', () => {
    expect(porChave(COLS, 'recebimento').opcoes).toEqual(['Quitado', 'Não Quitado']);
    expect(porChave(COLS, 'sistema_liberado').opcoes).toEqual(['Liberado', 'Não liberado']);
    expect(porChave(COLS, 'depoimento').opcoes).toEqual(['Sim', 'Pedido', 'Insatisfeito', 'Não faz']);
    expect(porChave(COLS, 'uf').opcoes).toHaveLength(27);
    expect(porChave(COLS, 'uf').livre).toBe(false);
    expect(porChave(COLS, 'engenheiro')).toMatchObject({ opcoes: ['Guilherme', 'Marcos'], livre: true });
    expect(porChave(COLS, 'equipe').opcoes).toEqual(['Propria', 'Terceira']);
    expect(porChave(COLS, 'consultor').opcoes).toEqual(['Diego', 'Nilce']);
  });
  it('coluna desconhecida nasce só para sócio, e nome repetido ganha sufixo', () => {
    const cab = [...CABECALHO_REAL, 'MARGEM EXTRA', 'MARGEM EXTRA', '', 'STATUS'];
    const cols = montarCatalogo(cab, []);
    expect(cols).toHaveLength(62 + 3);                 // o cabeçalho vazio é ignorado
    const novas = cols.filter((c) => c.grupo === 'Outros');
    expect(novas.map((c) => c.chave).sort()).toEqual(['margem_extra', 'margem_extra_2', 'status'].sort());
    for (const c of novas) expect(c).toMatchObject({ quem_ve: 'socio', tipo: 'texto', calculada: false });
    expect(new Set(cols.map((c) => c.chave)).size).toBe(cols.length);
    expect(colunasPara(cols, false).some((c) => c.grupo === 'Outros')).toBe(false);
  });
  it('o cabeçalho da fixture de Obras (nomes repetidos, KM IDA etc.) também gera chaves únicas e KM desconhecido é só sócio', () => {
    const cols = montarCatalogo(CABECALHO_FIXTURE, []);
    expect(new Set(cols.map((c) => c.chave)).size).toBe(cols.length);
    for (const nome of ['KM IDA', 'KM VOLTA', 'KM RODADO', 'KM EXTRA', 'KM OBRA']) {
      const c = cols.find((x) => x.rotulo.toLowerCase() === nome.toLowerCase())!;
      expect(c, nome).toBeTruthy();
      expect(c.quem_ve).toBe('socio');
    }
    // 2ª DATA INICIO e 2ª DATA FINAL (nomes repetidos que o mapa curado não prevê) viram desconhecidas, só sócio.
    expect(cols.filter((c) => c.chave.startsWith('data_inicio_instalacao')).every((c) => c.chave === 'data_inicio_instalacao' || c.quem_ve === 'socio')).toBe(true);
  });
  it('a ordem de saída segue o grupo e depois a posição na planilha', () => {
    const grupos = COLS.map((c) => c.grupo);
    const visto: string[] = [];
    for (const g of grupos) if (visto[visto.length - 1] !== g) visto.push(g);
    expect(new Set(visto).size).toBe(visto.length);    // grupos contíguos: nenhum aparece em dois pedaços
    expect(visto[0]).toBe('Venda');
  });
});

describe('corte por papel', () => {
  const regSocio = lerRegistro({
    campos: { valor_venda: { valor: 7777, por: 'thiago', em: '2026-10-01T10:00:00.000Z' }, cidade: { valor: 'Catalão', por: 'nilce', em: '2026-10-01T10:00:00.000Z' } },
    alteracoes: [{ em: '2026-10-01T10:00:00.000Z', por: 'thiago', coluna: 'valor_venda', antes: 1234567 }],
    em: '2026-10-01T10:00:00.000Z',
  });
  const registros = new Map<string, RegistroGestao>([['#0057', regSocio]]);

  it('a resposta do consultor não tem NENHUMA chave, rótulo ou valor de coluna de sócio', () => {
    const { colunas, linhas } = montarLinhas(GRADE, COLS, registros, 'nilce', false);
    const publico = JSON.stringify({ c: colunas.map(colunaPublica), l: linhas });
    for (const k of SOCIO_CHAVES) {
      expect(colunas.some((c) => c.chave === k), `catálogo ${k}`).toBe(false);
      expect(linhas.every((l) => !(k in l.celulas)), `células ${k}`).toBe(true);
      expect(colunas.some((c) => c.rotulo === COLS.find((x) => x.chave === k)!.rotulo), `rótulo ${k}`).toBe(false);
    }
    for (const s of Object.values(SENTINELA)) expect(publico.includes(s), s).toBe(false);
    // ac_cc virou dinheiro: o valor sai lido como número, então a sentinela também é conferida na forma lida.
    for (const s of ['4444.44', '4.444,44']) expect(publico.includes(s), s).toBe(false);
    expect(publico).not.toContain('7777');
    expect(publico).not.toContain('1234567');                     // nem o valor antigo da auditoria
    expect(colunas.some((c) => c.grupo === 'Custos da obra')).toBe(false);
  });
  it('listas abertas do consultor só têm valores das vendas DELE; o sócio vê todos', () => {
    const cons = montarLinhas(GRADE, COLS, new Map(), 'nilce', false).colunas;
    expect(cons.find((c) => c.chave === 'engenheiro')!.opcoes).toEqual(['Guilherme']);   // Marcos é da venda do Diego
    expect(cons.find((c) => c.chave === 'equipe')!.opcoes).toEqual(['Propria']);          // Terceira é da venda do Diego
    const soc = montarLinhas(GRADE, COLS, new Map(), 'thiago', true).colunas;
    expect(soc.find((c) => c.chave === 'engenheiro')!.opcoes).toEqual(['Guilherme', 'Marcos']);
    expect(JSON.stringify(cons.map(colunaPublica))).not.toContain('Marcos');
  });
  it('o sócio vê as 62 colunas e todas as vendas', () => {
    const { colunas, linhas } = montarLinhas(GRADE, COLS, registros, 'thiago', true);
    expect(colunas).toHaveLength(62);
    expect(linhas.map((l) => l.codigo)).toEqual(['#0057', '#0058', '#0059']);
    expect(linhas[0].celulas.valor_venda).toMatchObject({ valor: 7777, origem: 'sistema', por: 'thiago' });
  });
  it('consultor só vê as vendas dele e a coluna CONSULTOR é só leitura para ele', () => {
    const { colunas, linhas } = montarLinhas(GRADE, COLS, registros, 'nilce', false);
    expect(linhas.map((l) => l.codigo)).toEqual(['#0057', '#0059']);
    expect(colunas.find((c) => c.chave === 'consultor')).toMatchObject({ editavel: false, opcoes: [] });
    expect(montarLinhas(GRADE, COLS, registros, 'thiago', true).colunas.find((c) => c.chave === 'consultor')!.editavel).toBe(true);
    expect(montarLinhas(GRADE, COLS, registros, 'ninguem', false).linhas).toEqual([]);
  });
  it('um sócio que troca o consultor da venda tira a venda do consultor antigo', () => {
    const r = new Map([['#0057', lerRegistro({ campos: { consultor: { valor: 'Giovanna', por: 'thiago', em: '2026-10-02T00:00:00.000Z' } } })]]);
    expect(montarLinhas(GRADE, COLS, r, 'nilce', false).linhas.map((l) => l.codigo)).toEqual(['#0059']);
    expect(montarLinhas(GRADE, COLS, r, 'giovanna', false).linhas.map((l) => l.codigo)).toEqual(['#0057']);
  });
});

describe('mescla e precedência', () => {
  const cidade = porChave(COLS, 'cidade');
  const cadastro = porChave(COLS, 'cadastro_trello');
  it('planilha quando não há sobrescrita', () => {
    expect(celulaDe(cidade, 'Uberlandia', undefined)).toEqual({ valor: 'Uberlandia', origem: 'planilha' });
    expect(celulaDe(cadastro, '3/08/26', undefined)).toEqual({ valor: '2026-08-03', origem: 'planilha' });
  });
  it('sistema por cima, campo a campo, com por e em', () => {
    const reg = lerRegistro({ campos: { cidade: { valor: 'Catalão', por: 'nilce', em: '2026-10-01T10:00:00.000Z' } } });
    expect(celulaDe(cidade, 'Uberlandia', reg)).toEqual({ valor: 'Catalão', origem: 'sistema', por: 'nilce', em: '2026-10-01T10:00:00.000Z' });
    expect(celulaDe(cadastro, '03/08/2026', reg).origem).toBe('planilha');   // outro campo segue a planilha
  });
  it('sobrescrita de coluna calculada é ignorada', () => {
    const reg = lerRegistro({ campos: { total_lucro: { valor: 1, por: 'x', em: '2026-10-01T10:00:00.000Z' } } });
    expect(celulaDe(porChave(COLS, 'total_lucro'), 'R$ 10,00', reg)).toEqual({ valor: 10, origem: 'planilha' });
  });
  it('"nc" e lixo de data viram vazio; dinheiro e telefone da planilha são lidos', () => {
    expect(normalizarDaPlanilha(cadastro, 'nc')).toBeNull();
    expect(normalizarDaPlanilha(porChave(COLS, 'valor_venda'), 'R$ 1.234,56')).toBe(1234.56);
    expect(normalizarDaPlanilha(porChave(COLS, 'contato'), '(34) 99999-0000')).toBe('34999990000');
    expect(normalizarDaPlanilha(porChave(COLS, 'recebimento'), 'nao quitado')).toBe('Não Quitado');
  });
  it('registro torto do banco não derruba nada', () => {
    expect(lerRegistro(null)).toEqual({ campos: {}, alteracoes: [], em: null });
    expect(lerRegistro({ campos: { a: 1, b: { valor: {}, por: 'x', em: 'y' }, c: { valor: 'ok', por: 'x', em: 'y' } }, alteracoes: [1, { em: 1 }] }).campos)
      .toEqual({ c: { valor: 'ok', por: 'x', em: 'y' } });
  });
});

describe('validação por tipo', () => {
  const v = (k: string, x: unknown) => validarValor(porChave(COLS, k), x);
  it('data: dd/mm/aaaa e aaaa-mm-dd guardam ISO; impossível é erro', () => {
    for (const [e, s] of [['03/08/2026', '2026-08-03'], ['2026-08-03', '2026-08-03'], ['3/8/2026', '2026-08-03']]) {
      expect(v('cadastro_trello', e)).toEqual({ ok: true, valor: s });
    }
    for (const ruim of ['31/02/2026', '2026-13-01', 'amanhã', '03-08-2026', '99/99/9999']) expect(v('cadastro_trello', ruim).ok, ruim).toBe(false);
  });
  it('dinheiro: 1.234,56, R$ 1.234,56, 1234.56 e número; "145.000" é 145 mil, nunca 145', () => {
    for (const [e, n] of [['1.234,56', 1234.56], ['R$ 1.234,56', 1234.56], ['1234.56', 1234.56], [1234.56, 1234.56], ['145.000', 145000], ['-50,5', -50.5], ['0', 0], ['R$ 10', 10]] as Array<[unknown, number]>) {
      expect(v('valor_venda', e), String(e)).toEqual({ ok: true, valor: n });
    }
    for (const ruim of ['abc', '1,2,3', '12,3x', '1.2.3', '--5', 'R$']) expect(v('valor_venda', ruim).ok, ruim).toBe(false);
    expect(v('valor_venda', 1e12).ok).toBe(false);
  });
  it('inteiro: só dígitos', () => {
    expect(v('qtd_placa', '12')).toEqual({ ok: true, valor: 12 });
    expect(v('qtd_placa', 8)).toEqual({ ok: true, valor: 8 });
    for (const ruim of ['1,5', '-2', 'dez', 1.5, '1.000']) expect(v('qtd_placa', ruim).ok, String(ruim)).toBe(false);
  });
  it('número com decimais', () => {
    expect(v('pot_placa', '585')).toEqual({ ok: true, valor: 585 });
    expect(v('pot_placa', '0,5')).toEqual({ ok: true, valor: 0.5 });
    expect(v('pot_placa', 'x').ok).toBe(false);
  });
  it('telefone: só dígitos com DDD', () => {
    expect(v('contato', '(34) 99999-0000')).toEqual({ ok: true, valor: '34999990000' });
    expect(v('contato', '+55 34 3333-4444')).toEqual({ ok: true, valor: '553433334444' });
    for (const ruim of ['99999-0000', '123', '(34) 9999-00000000']) expect(v('contato', ruim).ok, ruim).toBe(false);
  });
  it('lista fechada aceita só as opções (sem acento e caixa), lista aberta aceita outro', () => {
    expect(v('recebimento', 'nao quitado')).toEqual({ ok: true, valor: 'Não Quitado' });
    expect(v('recebimento', 'meio quitado').ok).toBe(false);
    expect(v('uf', 'mg')).toEqual({ ok: true, valor: 'MG' });
    expect(v('uf', 'XX').ok).toBe(false);
    expect(v('engenheiro', 'guilherme')).toEqual({ ok: true, valor: 'Guilherme' });
    expect(v('engenheiro', 'Fulano Novo')).toEqual({ ok: true, valor: 'Fulano Novo' });
    expect(v('engenheiro', 'x'.repeat(301)).ok).toBe(false);
  });
  it('texto: limite de 300 e sem caractere de controle', () => {
    expect(v('cidade', 'a'.repeat(300)).ok).toBe(true);
    expect(v('cidade', 'a'.repeat(301)).ok).toBe(false);
    expect(v('cidade', 'Uber\u0000lândia')).toEqual({ ok: true, valor: 'Uber lândia' });
    expect(v('cidade', { x: 1 }).ok).toBe(false);
  });
  it('vazio é permitido (apaga a sobrescrita) em todos os tipos', () => {
    for (const k of ['cidade', 'cadastro_trello', 'valor_venda', 'qtd_placa', 'pot_placa', 'contato', 'recebimento']) {
      for (const vazio of ['', '   ', null, undefined]) expect(v(k, vazio), k).toEqual({ ok: true, valor: null });
    }
  });
  it('numeroBR rejeita o que é ambíguo demais', () => {
    expect(numeroBR('1.234')).toBe(1234);
    expect(numeroBR('0.125')).toBe(0.125);
    expect(numeroBR('1.2345')).toBeNull();
  });
});

describe('gravação, apagar e conflito', () => {
  const cidade = porChave(COLS, 'cidade');
  const base = lerRegistro(null);
  it('gravar põe o campo e a trilha (50 mais recentes, com o valor de antes)', () => {
    let reg = base;
    for (let i = 0; i < 60; i++) reg = aplicarGravacao(reg, cidade, `C${i}`, i ? `C${i - 1}` : 'Uberlandia', 'nilce', `2026-10-01T10:00:${String(i).padStart(2, '0')}.000Z`);
    expect(reg.campos.cidade).toMatchObject({ valor: 'C59', por: 'nilce' });
    expect(reg.alteracoes).toHaveLength(50);
    expect(reg.alteracoes[49]).toMatchObject({ coluna: 'cidade', antes: 'C58', por: 'nilce' });
    expect(reg.alteracoes[0].antes).toBe('C9');
    expect(base.campos).toEqual({});                         // não muta o original
  });
  it('vazio apaga a sobrescrita e volta a valer a planilha', () => {
    const g = aplicarGravacao(base, cidade, 'Catalão', 'Uberlandia', 'nilce', '2026-10-01T10:00:00.000Z');
    expect(celulaDe(cidade, 'Uberlandia', g).valor).toBe('Catalão');
    const apagado = aplicarGravacao(g, cidade, null, 'Catalão', 'nilce', '2026-10-01T11:00:00.000Z');
    expect(apagado.campos.cidade).toBeUndefined();
    expect(celulaDe(cidade, 'Uberlandia', apagado)).toEqual({ valor: 'Uberlandia', origem: 'planilha' });
    expect(apagado.alteracoes).toHaveLength(2);
  });
  it('conflito: outra pessoa depois de base_em; a mesma pessoa e o que veio antes não conflitam; quem apagou também conta', () => {
    const g = aplicarGravacao(base, cidade, 'Catalão', 'Uberlandia', 'diego', '2026-10-01T10:00:00.000Z');
    expect(houveConflito(g, 'cidade', '2026-10-01T09:00:00.000Z', 'nilce')).toEqual({ por: 'diego', em: '2026-10-01T10:00:00.000Z' });
    expect(houveConflito(g, 'cidade', '2026-10-01T10:00:00.000Z', 'nilce')).toBeNull();      // base igual ou depois
    expect(houveConflito(g, 'cidade', '2026-10-01T09:00:00.000Z', 'diego')).toBeNull();      // mesma pessoa
    expect(houveConflito(g, 'uf', '2026-10-01T09:00:00.000Z', 'nilce')).toBeNull();          // outra coluna
    const apagado = aplicarGravacao(g, cidade, null, 'Catalão', 'diego', '2026-10-01T12:00:00.000Z');
    expect(apagado.campos.cidade).toBeUndefined();
    expect(houveConflito(apagado, 'cidade', '2026-10-01T11:00:00.000Z', 'nilce')).toMatchObject({ por: 'diego' });
  });
  it('a chave do registro é a mesma para #57 e #0057', () => {
    expect(chaveGestao('#57')).toBe('gestao_cliente:0057');
    expect(chaveGestao('#0057')).toBe('gestao_cliente:0057');
    expect(codigoDaChave('gestao_cliente:0057')).toBe('#0057');
  });
});

describe('progresso', () => {
  it('conta obrigatórias preenchidas sobre obrigatórias, do papel de quem pede', () => {
    const socio = montarLinhas(GRADE, COLS, new Map(), 'thiago', true);
    const cons = montarLinhas(GRADE, COLS, new Map(), 'nilce', false);
    const obrSocio = socio.colunas.filter((c) => c.obrigatoria).length;
    const obrCons = cons.colunas.filter((c) => c.obrigatoria).length;
    expect(obrSocio).toBeGreaterThan(obrCons);               // sócio tem as colunas de dinheiro a mais
    const ana = socio.linhas.find((l) => l.codigo === '#0057')!;
    expect(ana.progresso.total).toBe(obrSocio);
    expect(ana.progresso.preenchidas + ana.progresso.faltando).toBe(obrSocio);
    // Ana tem cliente, consultor, uf, cidade, telefone, data da venda, engenheiro, equipe e 21 colunas de sócio (menos as 4 calculadas) preenchidas.
    expect(ana.celulas.cliente.valor).toBe('Ana Souza');
    expect(cons.linhas.find((l) => l.codigo === '#0057')!.progresso.total).toBe(obrCons);
  });
  it('preencher uma célula obrigatória sobe o progresso em 1; calculada vazia não conta como pendência', () => {
    const antes = montarLinhas(GRADE, COLS, new Map(), 'thiago', true).linhas.find((l) => l.codigo === '#0058')!;
    const reg = aplicarGravacao(lerRegistro(null), porChave(COLS, 'cidade'), 'Catalão', null, 'thiago', '2026-10-01T10:00:00.000Z');
    const depois = montarLinhas(GRADE, COLS, new Map([['#0058', reg]]), 'thiago', true).linhas.find((l) => l.codigo === '#0058')!;
    expect(depois.progresso.preenchidas).toBe(antes.progresso.preenchidas + 1);
    expect(depois.progresso.total).toBe(antes.progresso.total);
    const cols = [{ ...porChave(COLS, 'total_lucro') }];
    expect(progressoDe(cols, { total_lucro: { valor: null, origem: 'planilha' } })).toEqual({ preenchidas: 0, total: 0, faltando: 0 });
  });
  it('totais somam as linhas', () => {
    const { linhas } = montarLinhas(GRADE, COLS, new Map(), 'thiago', true);
    const t = totais(linhas);
    expect(t.clientes).toBe(3);
    expect(t.faltando).toBe(linhas.reduce((s, l) => s + l.progresso.faltando, 0));
    expect(t.clientes_com_pendencia).toBe(3);
  });
});

describe('a sobrescrita move a etapa em Obras', () => {
  // Venda do formato da planilha de Obras (fixture), sem instalação nem liberação.
  const pl = lerPlanilha(planilhaPadrao());
  const carla = pl.find((o) => o.codigo === '#0059') as ObraBruta;     // instalação iniciada, sem fim
  const catalogo = montarCatalogo(CABECALHO_FIXTURE, []);
  const colFim = catalogo.find((c) => c.chave === 'data_final_instalacao' || c.rotulo === 'Data final instalação');

  it('base: sem fim da instalação a obra está na instalação', () => {
    expect(montarObra(carla, '2026-10-10').etapaAtual).toBe('instalacao');
  });
  it('gravar pelo caminho real (ISO) e aplicar: a instalação fecha e a etapa avança', () => {
    const col = porChave(COLS, 'fim_instalacao');
    const v = validarValor(col, '05/10/2026');
    expect(v).toEqual({ ok: true, valor: '2026-10-05' });
    const reg = aplicarGravacao(lerRegistro(null), col, (v as { valor: string }).valor, null, 'nilce', '2026-10-06T10:00:00.000Z');
    const obra = montarObra(aplicarSobrescritas(carla, reg), '2026-10-10');
    expect(obra.etapas.find((e) => e.chave === 'instalacao')).toMatchObject({ feito: true, em: '2026-10-05' });
    expect(obra.etapaAtual).toBe('vistoria');
  });
  it('não muta o objeto da planilha: apagar a sobrescrita volta a valer a planilha', () => {
    const col = porChave(COLS, 'fim_instalacao');
    const reg = aplicarGravacao(lerRegistro(null), col, '2026-10-05', null, 'nilce', '2026-10-06T10:00:00.000Z');
    aplicarSobrescritas(carla, reg);
    expect(carla.fimInstalacao).toBe('');
    const apagado = aplicarGravacao(reg, col, null, '2026-10-05', 'nilce', '2026-10-06T11:00:00.000Z');
    expect(montarObra(aplicarSobrescritas(carla, apagado), '2026-10-10').etapaAtual).toBe('instalacao');
  });
  it('status, dinheiro e texto também passam; a coluna principal ganha da reserva', () => {
    const grava = (reg: RegistroGestao, k: string, valor: string | number) => aplicarGravacao(reg, porChave(COLS, k), valor, null, 'x', '2026-10-06T10:00:00.000Z');
    let reg = lerRegistro(null);
    reg = grava(reg, 'status_inversor', 'Instalado');
    reg = grava(reg, 'valor_venda', 4321.5);
    reg = grava(reg, 'previsao_montagem_2', '2026-11-02');
    const o = aplicarSobrescritas(carla, reg);
    expect(o.statusInversor).toBe('Instalado');
    expect(o.valorVenda).toBe(4321.5);
    expect(o.previsaoMontagem).toBe('02/11/2026');
    reg = grava(reg, 'previsao_montagem', '2026-11-09');
    expect(aplicarSobrescritas(carla, reg).previsaoMontagem).toBe('09/11/2026');
    expect(catalogo.length).toBeGreaterThan(0);
    void colFim;
  });
  it('a voltagem do inversor NÃO é reserva do modelo: escolher "Bi - 220" não muda o inversor da Obra', () => {
    const grava = (reg: RegistroGestao, k: string, valor: string) => aplicarGravacao(reg, porChave(COLS, k), valor, null, 'x', '2026-10-06T10:00:00.000Z');
    const reg = grava(lerRegistro(null), 'modelo_voltagem_inversor', 'Bi - 220');
    for (const modelo of ['', 'Saj 3K']) {
      const base = { ...carla, modeloInversor: modelo } as ObraBruta;
      const o = aplicarSobrescritas(base, reg);
      expect(o.modeloInversor).toBe(modelo);
      expect(montarObra(o, '2026-10-10').sistema.inversor).toBe(montarObra(base, '2026-10-10').sistema.inversor);
    }
    // o campo de verdade do modelo segue valendo
    const m = aplicarSobrescritas(carla, grava(lerRegistro(null), 'modelo_inversor', 'Saj 6K'));
    expect(montarObra(m, '2026-10-10').sistema.inversor).toBe('Saj 6K');
  });
  it('sem registro devolve a mesma linha', () => {
    expect(aplicarSobrescritas(carla, undefined)).toBe(carla);
  });
});

describe('listas pré-definidas da ficha (14/10)', () => {
  const iCab = (nome: string, n = 0) => CABECALHO_REAL.map((c, i) => [c, i] as const).filter(([c]) => c === nome)[n][1];
  /** Venda inventada com colunas escolhidas pelo NOME do cabeçalho. */
  function venda(codigo: string, consultor: string, extra: Record<string, string>): string[] {
    const l = linhaReal({ codigo, cliente: `Cliente ${codigo}`, consultor });
    for (const [nome, v] of Object.entries(extra)) l[iCab(nome)] = v;
    return l;
  }
  const G = lerGrade(csv([
    venda('#0101', 'Nilce', { CONCESSIONARIA: 'cemig', 'MODELO E VOLTAGEM DO INVERSOR': 'Bi-220', 'TIPO ESTRUTURA': 'Fibromadeira', 'FORMA DE PAGTO': 'Cartão 3x', EXCEDENTES: 'Tem excedente' }),
    venda('#0102', 'Diego', { CONCESSIONARIA: 'Energisa', 'MODELO E VOLTAGEM DO INVERSOR': 'Bi - 221', 'TIPO ESTRUTURA': 'Cerâmico', EXCEDENTES: 'nc', ENGENHEIRO: 'Marcos', EQUIPE: 'Terceira', FORNECEDOR: 'ShaktiSun' }),
    venda('#0103', 'Nilce', { 'STATUS': 'Reservado', ENGENHEIRO: 'Guilherme', EQUIPE: 'Propria' }),
  ]));
  const C = montarCatalogo(G.cabecalho, G.vendas);
  const op = (cols: Coluna[], k: string) => porChave(cols, k).opcoes;

  it('as colunas categóricas viraram lista (e as outras seguem como estavam)', () => {
    const listas = C.filter((c) => c.tipo === 'lista').map((c) => c.chave).sort();
    expect(listas).toEqual([
      'concessionaria', 'consultor', 'depoimento', 'engenheiro', 'equipe', 'excedentes', 'forma_pagto', 'fornecedor',
      'modelo_inversor', 'modelo_placa', 'modelo_voltagem_inversor', 'recebimento', 'sistema_liberado',
      'status_estrutura', 'status_inversor', 'status_placa', 'tipo_estrutura', 'uf',
    ]);
    for (const k of ['cliente', 'homologacao', 'contato', 'endereco', 'cidade', 'origem', 'obs', 'valor_venda', 'qtd_placa', 'cadastro_trello']) {
      expect(porChave(C, k).tipo, k).not.toBe('lista');
    }
  });
  it('lista aberta: opções escritas primeiro, depois o que a planilha trouxe, sem duplicar nem caixa nem acento', () => {
    expect(op(C, 'concessionaria')).toEqual(['Cemig', 'Equatorial', 'Energisa']);            // "cemig" da planilha casa com "Cemig"
    expect(op(C, 'tipo_estrutura')).toEqual(['Fibromadeira', 'Fibrometal', 'Solo', 'Mini Trilo', 'Cerâmico']);
    expect(op(C, 'modelo_voltagem_inversor')).toEqual(['Mono - 220', 'Bi - 220', 'Tri - 220', 'Bi - 221']);   // "Bi-220" casa com "Bi - 220"
    expect(op(C, 'excedentes')).toEqual(['Liberado Normal', 'Tem Excedente', 'Fastrack', 'Excedente Cadastrado']);   // "nc" não é opção
    expect(op(C, 'forma_pagto')).toContain('Cartão 3x');
    expect(op(C, 'fornecedor')!.slice(0, 4)).toEqual(['Soollar', 'Shakitsun', '77Sol', 'Edeltec']);
    for (const k of ['concessionaria', 'tipo_estrutura', 'excedentes', 'modelo_placa', 'modelo_inversor', 'forma_pagto', 'fornecedor']) {
      expect(porChave(C, k).livre, k).toBe(true);
    }
    expect(mesclarOpcoes(['A b', 'C'], ['a B', 'D', '', 'd'])).toEqual(['A b', 'C', 'D']);
  });
  it('lista fechada não ganha valor da planilha e recusa o que não é opção', () => {
    expect(op(C, 'status_placa')).toEqual(['Instalado', 'No cliente', 'Estoque', 'Comprar']);   // "Reservado" fica de fora
    expect(porChave(C, 'status_placa').livre).toBe(false);
    expect(validarValor(porChave(C, 'status_placa'), 'Reservado')).toMatchObject({ ok: false });
    expect(validarValor(porChave(C, 'status_placa'), 'NO CLIENTE')).toEqual({ ok: true, valor: 'No cliente' });
    expect(normalizarDaPlanilha(porChave(C, 'status_placa'), 'Reservado')).toBe('Reservado');   // a célula antiga continua legível
  });
  it('POST: lista aberta aceita outro valor e canoniza o que casa; limite de texto vale', () => {
    expect(validarValor(porChave(C, 'concessionaria'), 'CEMIG')).toEqual({ ok: true, valor: 'Cemig' });
    expect(validarValor(porChave(C, 'concessionaria'), 'Enel Goiás')).toEqual({ ok: true, valor: 'Enel Goiás' });
    expect(validarValor(porChave(C, 'concessionaria'), 'x'.repeat(301))).toMatchObject({ ok: false });
    expect(validarValor(porChave(C, 'tipo_estrutura'), '')).toEqual({ ok: true, valor: null });
  });
  it('o decimal faz parte da opção: 22,5k não vira 2,25k, e 1.875K casa com 1,875K', () => {
    const mi = porChave(C, 'modelo_inversor');
    expect(validarValor(mi, 'MI - Saj 2,25k')).toEqual({ ok: true, valor: 'MI - Saj 2,25K' });
    expect(validarValor(mi, 'Mi - Saj 22,5k')).toEqual({ ok: true, valor: 'Mi - Saj 22,5k' });      // outro modelo: grava como digitou
    expect(validarValor(mi, 'mi saj 2.25K')).toEqual({ ok: true, valor: 'MI - Saj 2,25K' });
    expect(validarValor(mi, 'MI - Solax 1.875K')).toEqual({ ok: true, valor: 'MI - Solax 1,875K' });
    expect(mesclarOpcoes(['Solis 75k'], ['Solis 7,5k', 'solis 75K'])).toEqual(['Solis 75k', 'Solis 7,5k']);
    expect(mesclarOpcoes(['Bi - 220'], ['Bi-220', 'Bi - 221'])).toEqual(['Bi - 220', 'Bi - 221']);
  });
  it('observação guarda a quebra de linha; os outros textos não', () => {
    expect(validarValor(porChave(C, 'obs'), 'Linha um\r\nLinha dois\u0000')).toEqual({ ok: true, valor: 'Linha um\nLinha dois ' });
    expect(validarValor(porChave(C, 'cidade'), 'Uber\nlândia')).toEqual({ ok: true, valor: 'Uber lândia' });
    expect(validarValor(porChave(C, 'obs'), 'x'.repeat(301))).toMatchObject({ ok: false });
  });
  it('consultor: lista aberta = escritas + valores só das vendas dele; sócio vê tudo', () => {
    expect(LISTAS_DE_GENTE.has('engenheiro') && LISTAS_DE_GENTE.has('equipe') && LISTAS_DE_GENTE.has('consultor')).toBe(true);
    const cons = montarLinhas(G, C, new Map(), 'nilce', false).colunas;
    expect(op(cons, 'concessionaria')).toEqual(['Cemig', 'Equatorial']);                      // as escritas; "Energisa" é só da venda do Diego
    expect(op(cons, 'tipo_estrutura')).toEqual(['Fibromadeira', 'Fibrometal', 'Solo', 'Mini Trilo']);   // "Cerâmico" é só da venda do Diego
    expect(op(cons, 'engenheiro')).toEqual(['Guilherme']);                                     // Marcos é da venda do Diego
    expect(op(cons, 'equipe')).toEqual(['Propria']);
    expect(cons.some((c) => c.chave === 'forma_pagto' || c.chave === 'fornecedor')).toBe(false);   // de sócio, nem chega
    const soc = montarLinhas(G, C, new Map(), 'thiago', true).colunas;
    expect(op(soc, 'engenheiro')).toEqual(['Guilherme', 'Marcos']);
    expect(op(soc, 'concessionaria')).toEqual(['Cemig', 'Equatorial', 'Energisa']);
    expect(op(soc, 'tipo_estrutura')).toContain('Cerâmico');
    expect(JSON.stringify(cons.map(colunaPublica))).not.toMatch(/Marcos|Terceira|ShaktiSun|Energisa|Cerâmico|Bi - 221/);
    // valor que só existe em venda ALHEIA não aparece; o dele entra depois das escritas
    const diego = montarLinhas(G, C, new Map(), 'diego', false).colunas;
    expect(op(diego, 'concessionaria')).toEqual(['Cemig', 'Equatorial', 'Energisa']);
    expect(op(diego, 'modelo_voltagem_inversor')).toEqual(['Mono - 220', 'Bi - 220', 'Tri - 220', 'Bi - 221']);
    expect(op(cons, 'modelo_voltagem_inversor')).toEqual(['Mono - 220', 'Bi - 220', 'Tri - 220']);
  });
  it('a seção Financeiro é só de sócio: o consultor vê o Recebimento na Venda; o sócio segue na Financeiro', () => {
    const cons = montarLinhas(G, C, new Map(), 'nilce', false).colunas;
    expect(cons.some((c) => c.grupo === 'Financeiro')).toBe(false);
    expect(cons.find((c) => c.chave === 'recebimento')!.grupo).toBe('Venda');
    expect(montarLinhas(G, C, new Map(), 'thiago', true).colunas.find((c) => c.chave === 'recebimento')!.grupo).toBe('Financeiro');
    expect(porChave(C, 'recebimento').grupo).toBe('Financeiro');      // o catálogo cru não muda
  });
  it('AC - CC é dinheiro (só sócio): lê "R$ 1.234,56" e recusa texto', () => {
    const ac = porChave(C, 'ac_cc');
    expect(ac).toMatchObject({ tipo: 'dinheiro', quem_ve: 'socio' });
    expect(normalizarDaPlanilha(ac, 'R$ 1.156,22')).toBe(1156.22);
    expect(validarValor(ac, '330,00')).toEqual({ ok: true, valor: 330 });
    expect(validarValor(ac, 'abc')).toMatchObject({ ok: false });
  });
});

// ── Fase 2: linhas do /gerador na grade ──────────────────────────────────────

describe('fase 2: camadas da célula e linhas do /gerador', () => {
  const reg = (campos: Record<string, string | number>): RegistroGestao =>
    lerRegistro({ campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-10-22T10:00:00.000Z' }])), alteracoes: [] });
  const der = (o: Partial<Derivada> & { codigo: string; card: number }): Derivada =>
    ({ modo: 'so_gerador', doAlocador: true, vivo: true, consultor: 'Nilce', valores: {}, ...o });

  it('celulaDe: overlay do código > overlay do card > planilha preenchida > derivado > vazio; calculada nunca recebe derivado', () => {
    const cidade = porChave(COLS, 'cidade');
    expect(celulaDe(cidade, '', undefined, 'Araguari')).toEqual({ valor: 'Araguari', origem: 'gerador' });
    expect(celulaDe(cidade, 'Uberaba', undefined, 'Araguari')).toEqual({ valor: 'Uberaba', origem: 'planilha' });
    expect(celulaDe(cidade, '', undefined, 'Araguari', reg({ cidade: 'Do Card' }))).toMatchObject({ valor: 'Do Card', origem: 'sistema' });
    expect(celulaDe(cidade, '', reg({ cidade: 'Do Codigo' }), 'Araguari', reg({ cidade: 'Do Card' }))).toMatchObject({ valor: 'Do Codigo', origem: 'sistema' });
    // G-5: o digitado no card fica ABAIXO do Excel e só completa o vazio
    expect(celulaDe(cidade, 'Uberaba', undefined, 'Araguari', reg({ cidade: 'Do Card' }))).toMatchObject({ valor: 'Uberaba', origem: 'planilha' });
    expect(celulaDe(cidade, '', undefined, undefined)).toEqual({ valor: null, origem: 'planilha' });
    expect(celulaDe(porChave(COLS, 'km_total'), '', undefined, '99')).toMatchObject({ origem: 'planilha' });
  });

  it('o formato que a linha do /gerador escreve passa intacto pela leitura da planilha (dinheiro, inteiro, data, lista)', () => {
    expect(normalizarDaPlanilha(porChave(COLS, 'valor_venda'), '145000.00')).toBe(145000);
    expect(normalizarDaPlanilha(porChave(COLS, 'valor_venda'), '1234.50')).toBe(1234.5);
    expect(normalizarDaPlanilha(porChave(COLS, 'qtd_placa'), '18')).toBe(18);
    expect(normalizarDaPlanilha(porChave(COLS, 'pot_placa'), '600')).toBe(600);
    expect(normalizarDaPlanilha(porChave(COLS, 'cadastro_trello'), '2026-10-22')).toBe('2026-10-22');
    expect(normalizarDaPlanilha(porChave(COLS, 'modelo_inversor'), 'SAJ 6K')).toBe('Saj 6K');
    expect(normalizarDaPlanilha(porChave(COLS, 'modelo_voltagem_inversor'), 'Bi - 220')).toBe('Bi - 220');
  });

  it('celulaEhFixa: pessoal em linha do alocador em QUALQUER modo; consultor só em só-Gerador; lado Gerador do conflito, tudo; ligação antiga, nada', () => {
    for (const k of COLUNAS_PESSOAIS) {
      expect(celulaEhFixa(k, { modo: 'junta', doAlocador: true }, false)).toBe(true);
      expect(celulaEhFixa(k, { modo: 'so_gerador', doAlocador: false }, false)).toBe(true);
      expect(celulaEhFixa(k, { modo: 'junta', doAlocador: false }, false)).toBe(false);
    }
    expect(celulaEhFixa('consultor', { modo: 'so_gerador', doAlocador: true }, false)).toBe(true);
    expect(celulaEhFixa('consultor', { modo: 'junta', doAlocador: true }, false)).toBe(false);
    expect(celulaEhFixa('engenheiro', undefined, true)).toBe(true);
    expect(celulaEhFixa('engenheiro', { modo: 'so_gerador', doAlocador: true }, false)).toBe(false);
  });

  it('consultorEfetivo: overlay > planilha > derivado', () => {
    const v = GRADE.vendas[0];
    expect(consultorEfetivo(COLS, v.celulas, undefined, 'Giovanna')).toBe('Nilce');
    expect(consultorEfetivo(COLS, v.celulas, reg({ consultor: 'Diego' }), 'Giovanna')).toBe('Diego');
    const vazia = v.celulas.map((c, i) => (i === COLS.find((x) => x.chave === 'consultor')!.indice ? '' : c));
    expect(consultorEfetivo(COLS, vazia, undefined, 'Giovanna')).toBe('Giovanna');
  });

  it('montarLinhas: só-Gerador no fim por código; junta completa o vazio sem tocar no preenchido; conflito em duas linhas; venda desfeita fora dos totais', () => {
    const derivadas = new Map<string, Derivada>([
      ['#0057', der({ codigo: '#0057', card: 501, modo: 'junta', valores: { cidade: 'Outra', qtd_placa: '18', engenheiro: 'Guilherme' } })],
      ['#0058', der({ codigo: '#0058', card: 502, modo: 'conflito', consultor: 'Nilce', valores: { cidade: 'Cidade Gerador' } })],
      ['#0070', der({ codigo: '#0070', card: 503, valores: { cliente: 'Hermes', contato: '34999990001', engenheiro: 'Guilherme' }, avisoTelefone: 'Mesmo telefone da linha #0057 do Excel. Se for a mesma venda, use no Excel o número #0070.' })],
      ['#0065', der({ codigo: '#0065', card: 504, vivo: false, valores: { cliente: 'Desfeito' } })],
    ]);
    const overlays = new Map([[503, reg({ engenheiro: 'Digitado' })]]);
    const { linhas } = montarLinhas(GRADE, COLS, new Map(), 'diego', true, derivadas, overlays);
    expect(linhas.map((l) => l.codigo)).toEqual(['#0057', '#0058', '#0059', '#0065', '#0070', '#0058@502']);
    const l57 = linhas[0];
    expect(l57.celulas.cidade).toMatchObject({ valor: 'Uberlandia', origem: 'planilha' });   // preenchido fica
    expect(l57.celulas.qtd_placa).toMatchObject({ valor: 18, origem: 'gerador' });           // vazio completa
    expect(l57.celulas.cidade.fixa).toBe(true);                                             // alocador em junta: pessoal só leitura
    expect(l57.card).toBe(501);
    const csv58 = linhas[1];
    expect(csv58).toMatchObject({ conflito: 'planilha' });
    expect(csv58.card).toBeUndefined();   // G-6: a linha do CSV não leva o card do cliente do /gerador
    expect(csv58.celulas.cidade.valor).not.toBe('Cidade Gerador');
    const g58 = linhas[5];
    expect(g58).toMatchObject({ exibir: '#0058', so_gerador: true, conflito: 'gerador', somente_leitura: true, card: 502 });
    expect(Object.values(g58.celulas).every((c) => c.fixa)).toBe(true);
    const l70 = linhas[4];
    expect(l70).toMatchObject({ so_gerador: true, card: 503, aviso_telefone: expect.stringMatching(/#0057/) });
    expect(l70.celulas.cliente).toMatchObject({ valor: 'Hermes', origem: 'gerador', fixa: true });
    expect(l70.celulas.consultor.fixa).toBe(true);
    expect(l70.celulas.engenheiro).toMatchObject({ valor: 'Digitado', origem: 'sistema' });
    expect(linhas[3]).toMatchObject({ venda_desfeita: true });
    expect(totais(linhas).clientes).toBe(linhas.length - 2);   // sem a venda desfeita e sem o lado /gerador do conflito (G-7)
    // G-4: card que saiu de fechou, ou dono de outro, não leva o card na linha junta
    const morto = new Map(derivadas); morto.set('#0057', { ...derivadas.get('#0057')!, vivo: false });
    expect(montarLinhas(GRADE, COLS, new Map(), 'diego', true, morto).linhas[0].card).toBeUndefined();
    const deOutro = new Map(derivadas); deOutro.set('#0057', { ...derivadas.get('#0057')!, consultor: 'Giovanna' });
    expect(montarLinhas(GRADE, COLS, new Map(), 'nilce', false, deOutro).linhas[0].card).toBeUndefined();
    // consultor: não vê linha alheia nem coluna de sócio nas derivadas
    const nilce = montarLinhas(GRADE, COLS, new Map(), 'nilce', false, new Map([...derivadas, ['#0071', der({ codigo: '#0071', card: 505, consultor: 'Giovanna' })]]));
    expect(nilce.linhas.map((l) => l.codigo)).not.toContain('#0071');
    expect(nilce.linhas.every((l) => !('valor_venda' in l.celulas))).toBe(true);
    // sem derivadas: idêntico a antes
    expect(montarLinhas(GRADE, COLS, new Map(), 'diego', true)).toEqual(montarLinhas(GRADE, COLS, new Map(), 'diego', true, undefined, undefined));
  });
});
