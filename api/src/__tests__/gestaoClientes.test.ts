import { describe, it, expect } from 'vitest';
import {
  montarCatalogo, colunasPara, colunaPublica, lerGrade, montarLinhas, validarValor, normalizarDaPlanilha, celulaDe,
  progressoDe, totais, houveConflito, aplicarGravacao, lerRegistro, aplicarSobrescritas, chaveGestao, codigoDaChave,
  numeroBR, type ColunaInterna, type RegistroGestao, type Coluna,
} from '../services/gerador/gestaoClientes';
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
  ac_cc: 'ZZACCC44', km_inicial: 'ZZKMI101', km_final: 'ZZKMF202', km_total: 'ZZKMT303', mao_de_obra: 'R$ 555,44', nf: 'ZZNF55',
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
  it('sem registro devolve a mesma linha', () => {
    expect(aplicarSobrescritas(carla, undefined)).toBe(carla);
  });
});
