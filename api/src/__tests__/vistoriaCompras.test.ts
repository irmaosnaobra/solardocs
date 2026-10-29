import { describe, it, expect, vi, beforeEach } from 'vitest';

// Núcleo da lista de compras da vistoria. Quase tudo é função pura: saneamento da linha e da lista, quantidade,
// resumo e dados do relatório. O que toca o banco (lerCompras) roda contra o banco falso. Dados inventados.
// Travessão e emoji aparecem aqui só como escape (\u2013, \u2014, \u{1F600}), nunca como caractere literal.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));

import { banco } from './_bancoFalso';
import { CHECKLIST_VISTORIA } from '../routes/vistorias';
import { lerCompras } from '../services/vistoria/extras';
import { ROTULO_CHEIO } from '../services/vistoria/avaliacao';
import type { MapaStatus } from '../services/vistoria/avaliacao';
import {
  CHAVES_ITENS, LIMITES, QUEM, UNIDADES,
  agruparParaRelatorio, comprasVazio, comprasVisiveis, formatarQtd, frasesResumo, limparTexto, nomesPorItem,
  prazoDe, sanitizarCompras, sanitizarLinha, sanitizarLinhas, unidadePorExtenso,
} from '../services/vistoria/compras';
import type { Compras, LinhaCompra, Unidade } from '../services/vistoria/compras';

const TRAVESSAO_MEDIO = '\u2013';
const TRAVESSAO_LONGO = '\u2014';
const SOL = '\u2600';
const CORACAO = '\u2764';
const ROSTO = '\u{1F600}';
const TRAVESSOES = /[\u2013\u2014]/;
const EMOJI_TESTE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const mat = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'abc123xy', tipo: 'material', nome: 'Caixa de medição', qtd: 1, un: 'un', quem: 'cliente', ...extra,
});
const nota = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'nota0001', tipo: 'obs', obs: 'Telha antiga, pode ter amianto.', ...extra,
});
const L = (o: Record<string, unknown>): LinhaCompra => {
  const l = sanitizarLinha(o);
  if (!l) throw new Error('fixture inválida');
  return l;
};
const idN = (prefixo: string, n: number) => `${prefixo}${String(n).padStart(4, '0')}`;

describe('limparTexto', () => {
  it('tira emoji e símbolos', () => {
    expect(limparTexto(`Cabo ${SOL} solar ${CORACAO} CC ${ROSTO}`, 80)).toBe('Cabo solar CC');
  });
  it('tira o joiner, o seletor de variação e o keycap', () => {
    expect(limparTexto('a\u200Db\uFE0Fc\u20E3', 80)).toBe('Abc');
  });
  it('texto só de emoji vira vazio', () => {
    expect(limparTexto(`${ROSTO}${SOL}${CORACAO}`, 80)).toBe('');
  });
  it('troca travessão médio e longo por hífen', () => {
    expect(limparTexto(`cabo${TRAVESSAO_MEDIO}solar${TRAVESSAO_LONGO}cc`, 80)).toBe('Cabo-solar-cc');
  });
  it('junta espaços e quebras de linha e apara', () => {
    expect(limparTexto('  caixa \n\n  de\t medição \r\n ', 80)).toBe('Caixa de medição');
  });
  it('troca caractere de controle por espaço', () => {
    expect(limparTexto('a\u0000b\u0007c\u0085d', 80)).toBe('A b c d');
  });
  it('corta no limite e apara o espaço que sobrar na ponta', () => {
    const cortado = limparTexto('a'.repeat(100), 80);
    expect(cortado).toHaveLength(80);
    expect(cortado).toBe('A' + 'a'.repeat(79));
    expect(limparTexto('abcde fghij', 6)).toBe('Abcde');
  });
  it('põe só a primeira letra em maiúscula e respeita número e grau', () => {
    expect(limparTexto('cabo solar', 80)).toBe('Cabo solar');
    expect(limparTexto('élan', 80)).toBe('Élan');
    expect(limparTexto('70 °C', 80)).toBe('70 °C');
    expect(limparTexto('CABO', 80)).toBe('CABO');
  });
  it('não escapa HTML: isso é do relatório', () => {
    expect(limparTexto('<b>x</b> & "y"', 80)).toBe('<b>x</b> & "y"');
  });
  it('entrada que não é texto devolve vazio', () => {
    for (const v of [42, null, undefined, {}, [], true]) expect(limparTexto(v, 80), String(v)).toBe('');
  });
});

describe('sanitizarLinha', () => {
  it('material completo sai limpo e na ordem do envelope', () => {
    const l = sanitizarLinha({
      id: 'm3k9y7cd', tipo: 'material', nome: 'cabo solar CC', esp: '1,5 kV CC, cobre estanhado.', qtd: 12.5, un: 'm',
      quem: 'integrador', item: 'cabeamento', cid: 'cabo-solar-cc', obs: 'do telhado até o inversor.',
      ts: '2026-10-29T14:09:40.000Z', lixo: 'fora',
    });
    expect(l).toEqual({
      id: 'm3k9y7cd', tipo: 'material', nome: 'Cabo solar CC', esp: '1,5 kV CC, cobre estanhado.', qtd: 12.5, un: 'm',
      quem: 'integrador', item: 'cabeamento', cid: 'cabo-solar-cc', obs: 'Do telhado até o inversor.',
      ts: '2026-10-29T14:09:40.000Z',
    });
    expect(Object.keys(l!)).toEqual(['id', 'tipo', 'nome', 'esp', 'qtd', 'un', 'quem', 'item', 'cid', 'obs', 'ts']);
  });
  it('material mínimo ganha os padrões e sempre traz qtd e obs', () => {
    const l = sanitizarLinha({ id: 'abcdef', tipo: 'material', nome: 'Cabo' })!;
    expect(l).toEqual({ id: 'abcdef', tipo: 'material', nome: 'Cabo', qtd: null, un: 'un', quem: 'a_definir', obs: '' });
    expect('qtd' in l).toBe(true);
    for (const k of ['esp', 'item', 'cid', 'ts']) expect(k in l, k).toBe(false);
  });
  it('id fora de ^[a-z0-9]{6,24}$ descarta a linha', () => {
    const ruins = ['abc12', 'ABCDEF12', 'abc-1234', 'a'.repeat(25), '', 'abc 1234', 'abçdef12', 123456, null, undefined];
    for (const id of ruins) expect(sanitizarLinha(mat({ id })), String(id)).toBeNull();
    for (const id of ['abcdef', 'a'.repeat(24), 'm3k9x2ab']) expect(sanitizarLinha(mat({ id }))?.id, id).toBe(id);
  });
  it('tipo desconhecido descarta a linha', () => {
    for (const tipo of ['servico', 'nota', 'Material', '', undefined, 1]) expect(sanitizarLinha(mat({ tipo })), String(tipo)).toBeNull();
  });
  it('material sem nome ou com 1 letra descarta; com 2 letras vale', () => {
    for (const nome of [undefined, '', '   ', 'a', `${ROSTO}${SOL}`, 12]) expect(sanitizarLinha(mat({ nome })), String(nome)).toBeNull();
    expect(sanitizarLinha(mat({ nome: 'dr' }))?.nome).toBe('Dr');
  });
  it('nota sem texto descarta a linha', () => {
    for (const obs of [undefined, '', '   ', ROSTO, 5]) expect(sanitizarLinha(nota({ obs })), String(obs)).toBeNull();
  });
  it('nota guarda só id, tipo, obs, item, cid e ts', () => {
    const l = sanitizarLinha(nota({
      nome: 'Nome', esp: 'Esp', qtd: 3, un: 'm', quem: 'cliente', item: 'tipo_telha', cid: 'obs-pronta', ts: '2026-10-29T10:00:00.000Z',
    }));
    expect(l).toEqual({
      id: 'nota0001', tipo: 'obs', item: 'tipo_telha', cid: 'obs-pronta', obs: 'Telha antiga, pode ter amianto.', ts: '2026-10-29T10:00:00.000Z',
    });
  });
  it('un fora da lista vira un; as seis válidas passam', () => {
    for (const un of ['metro', 'M', '', 5, null, undefined]) expect(sanitizarLinha(mat({ un }))?.un, String(un)).toBe('un');
    for (const un of UNIDADES) expect(sanitizarLinha(mat({ un }))?.un, un).toBe(un);
  });
  it('quem fora da lista vira a_definir; as três válidas passam', () => {
    for (const quem of ['empresa', 'Cliente', '', 5, null, undefined]) expect(sanitizarLinha(mat({ quem }))?.quem, String(quem)).toBe('a_definir');
    for (const quem of QUEM) expect(sanitizarLinha(mat({ quem }))?.quem, quem).toBe(quem);
  });
  it('item desconhecido é omitido; as 12 chaves do checklist passam', () => {
    for (const item of ['inventado', 'PADRAO', '', 7, null]) expect('item' in sanitizarLinha(mat({ item }))!, String(item)).toBe(false);
    for (const item of CHAVES_ITENS) expect(sanitizarLinha(mat({ item }))?.item, item).toBe(item);
    expect(sanitizarLinha(nota({ item: 'padrao' }))?.item).toBe('padrao');
    expect('item' in sanitizarLinha(nota({ item: 'inventado' }))!).toBe(false);
  });
  it('serviço grava qtd null mesmo com qtd 5', () => {
    expect(sanitizarLinha(mat({ un: 'servico', qtd: 5 }))?.qtd).toBeNull();
  });
  it('qtd inválida (zero, negativa, NaN, texto, acima do teto, fora da faixa) vira null e a linha fica', () => {
    const ruins: unknown[] = [0, -3, NaN, 'abc', '5', 100000, 100000.01, 99999.005, Infinity, -Infinity, null, undefined, {}, [], true, 0.004, 1e-7, 1e21];
    for (const qtd of ruins) {
      const l = sanitizarLinha(mat({ qtd }));
      expect(l, `linha com qtd ${String(qtd)}`).not.toBeNull();
      expect(l!.qtd, `qtd ${String(qtd)}`).toBeNull();
    }
  });
  it('qtd válida fica com no máximo 2 casas, arredondando pela escrita decimal', () => {
    const casos: [number, number][] = [
      [1, 1], [3, 3], [10.1, 10.1], [0.01, 0.01], [0.005, 0.01], [12.345, 12.35], [1.005, 1.01], [0.1 + 0.2, 0.3],
      [99999, 99999], [99999.004, 99999], [120, 120], [2.5, 2.5],
    ];
    for (const [entrada, esperado] of casos) expect(sanitizarLinha(mat({ qtd: entrada }))?.qtd, String(entrada)).toBe(esperado);
  });
  it('nome de 90 letras é cortado em 80; esp em 140; obs de material em 200; obs de nota em 500', () => {
    expect(sanitizarLinha(mat({ nome: 'a'.repeat(90) }))?.nome).toHaveLength(LIMITES.nome);
    expect(sanitizarLinha(mat({ esp: 'e'.repeat(200) }))?.esp).toHaveLength(LIMITES.esp);
    expect(sanitizarLinha(mat({ obs: 'o'.repeat(300) }))?.obs).toHaveLength(LIMITES.obsLinha);
    expect(sanitizarLinha(nota({ obs: 'n'.repeat(600) }))?.obs).toHaveLength(LIMITES.obsNota);
  });
  it('esp vazia é omitida', () => {
    for (const esp of [undefined, '', '   ', ROSTO, 3]) expect('esp' in sanitizarLinha(mat({ esp }))!, String(esp)).toBe(false);
  });
  it('cid inválido é omitido; o válido passa', () => {
    for (const cid of ['ABC', 'a b', 'a'.repeat(41), '', 'cabo_solar', 5, null]) expect('cid' in sanitizarLinha(mat({ cid }))!, String(cid)).toBe(false);
    for (const cid of ['cabo-solar-cc', 'a'.repeat(40), 'dr']) expect(sanitizarLinha(mat({ cid }))?.cid, cid).toBe(cid);
  });
  it('ts inválido é omitido; data ISO passa', () => {
    const ruins: unknown[] = ['ontem', 12345, '', '2026-13-45T25:61:61Z', 'x'.repeat(40), '2026-10-29T14:03:11.000Z extra', null];
    for (const ts of ruins) expect('ts' in sanitizarLinha(mat({ ts }))!, String(ts)).toBe(false);
    for (const ts of ['2026-10-29T14:03:11.000Z', '2026-10-29T14:03:11-03:00', '2026-10-29']) expect(sanitizarLinha(mat({ ts }))?.ts, ts).toBe(ts);
  });
  it('texto do técnico sai sem travessão nem emoji, e o HTML fica como texto', () => {
    const l = sanitizarLinha(mat({
      nome: `<script>alert(1)</script> ${SOL}`, esp: `fio ${TRAVESSAO_LONGO} grosso ${ROSTO}`, obs: `ok ${TRAVESSAO_MEDIO} sim ${CORACAO}`,
    }))!;
    expect(l.nome).toBe('<script>alert(1)</script>');
    expect(l.esp).toBe('Fio - grosso');
    expect(l.obs).toBe('Ok - sim');
  });
  it('entrada que não é objeto devolve null', () => {
    for (const v of [null, undefined, 'texto', 42, [], true]) expect(sanitizarLinha(v), String(v)).toBeNull();
  });
  it('nunca lança, nem com getter que falha', () => {
    const armadilha = Object.defineProperty({}, 'id', { enumerable: true, get() { throw new Error('boom'); } });
    expect(() => sanitizarLinha(armadilha)).not.toThrow();
    expect(sanitizarLinha(armadilha)).toBeNull();
  });
  it('não muda a entrada', () => {
    const entrada = Object.freeze(mat({ nome: 'cabo', obs: ' nota ' }));
    expect(() => sanitizarLinha(entrada)).not.toThrow();
    expect(entrada.nome).toBe('cabo');
  });
});

describe('sanitizarLinhas', () => {
  it('id repetido: a última vence e fica na posição da primeira', () => {
    const r = sanitizarLinhas([
      mat({ id: 'aaaaaa', nome: 'Primeira' }), mat({ id: 'bbbbbb', nome: 'Segunda' }), mat({ id: 'aaaaaa', nome: 'Terceira' }),
    ]);
    expect(r.linhas.map((l) => l.nome)).toEqual(['Terceira', 'Segunda']);
    expect(r.linhas.map((l) => l.id)).toEqual(['aaaaaa', 'bbbbbb']);
    expect(r.descartadas).toBe(1);
  });
  it('descartadas conta a linha inválida e a ocorrência substituída (recebidas menos mantidas)', () => {
    const r = sanitizarLinhas([mat(), null, 'x', { id: 'curto' }, nota()]);
    expect(r.linhas).toHaveLength(2);
    expect(r.descartadas).toBe(3);
  });
  it('repetição inválida no fim não apaga a linha válida anterior', () => {
    const r = sanitizarLinhas([mat({ id: 'aaaaaa', nome: 'Boa' }), mat({ id: 'aaaaaa', nome: 'x' })]);
    expect(r.linhas.map((l) => l.nome)).toEqual(['Boa']);
    expect(r.descartadas).toBe(1);
  });
  it('não corta em 60: quem recebe decide', () => {
    const r = sanitizarLinhas(Array.from({ length: 61 }, (_, i) => mat({ id: idN('lin', i) })));
    expect(r.linhas).toHaveLength(61);
    expect(r.descartadas).toBe(0);
  });
  it('lista vazia e entrada que não é lista dão vazio', () => {
    expect(sanitizarLinhas([])).toEqual({ linhas: [], descartadas: 0 });
    expect(sanitizarLinhas('x' as never)).toEqual({ linhas: [], descartadas: 0 });
    expect(sanitizarLinhas(null as never)).toEqual({ linhas: [], descartadas: 0 });
  });
});

describe('sanitizarCompras', () => {
  it("'{}' (texto ou objeto), null, undefined, lista vazia e lixo dão lista vazia e visível", () => {
    for (const v of ['{}', {}, null, undefined, 42, true, [], '[]', 'não é json', '"texto"']) {
      expect(sanitizarCompras(v), String(v)).toEqual({ v: 1, publica: true, linhas: [] });
    }
  });
  it('envelope válido: sanea as linhas e fixa v em 1', () => {
    const c = sanitizarCompras({ v: 7, publica: true, linhas: [mat({ nome: 'cabo' }), nota(), { lixo: 1 }], extra: 'fora' });
    expect(c).toEqual({
      v: 1, publica: true,
      linhas: [
        { id: 'abc123xy', tipo: 'material', nome: 'Cabo', qtd: 1, un: 'un', quem: 'cliente', obs: '' },
        { id: 'nota0001', tipo: 'obs', obs: 'Telha antiga, pode ter amianto.' },
      ],
    });
  });
  it('lista pura de linhas vale como lista visível', () => {
    const c = sanitizarCompras([mat(), nota()]);
    expect(c.publica).toBe(true);
    expect(c.linhas.map((l) => l.id)).toEqual(['abc123xy', 'nota0001']);
  });
  it('envelope em texto JSON também lê', () => {
    const c = sanitizarCompras(JSON.stringify({ v: 1, publica: false, linhas: [mat()] }));
    expect(c.publica).toBe(false);
    expect(c.linhas).toHaveLength(1);
  });
  it('publica false é preservado; qualquer outro valor vira true', () => {
    expect(sanitizarCompras({ publica: false, linhas: [mat()] }).publica).toBe(false);
    for (const publica of [true, undefined, null, 0, 1, 'false', 'não', {}, []]) {
      expect(sanitizarCompras({ publica, linhas: [mat()] }).publica, String(publica)).toBe(true);
    }
  });
  it('linhas que não é lista dá lista vazia', () => {
    expect(sanitizarCompras({ publica: true, linhas: 'x' }).linhas).toEqual([]);
    expect(sanitizarCompras({ publica: true, linhas: { 0: mat() } }).linhas).toEqual([]);
  });
  it('mais de 60 linhas corta em 60 sem lançar', () => {
    const muitas = Array.from({ length: 70 }, (_, i) => mat({ id: idN('lin', i) }));
    const c = sanitizarCompras({ linhas: muitas });
    expect(c.linhas).toHaveLength(LIMITES.linhas);
    expect(c.linhas[0]!.id).toBe('lin0000');
    expect(c.linhas[59]!.id).toBe('lin0059');
  });
  it('linha ruim não ocupa vaga dos 60', () => {
    const ruins = Array.from({ length: 10 }, () => ({ lixo: true }));
    const boas = Array.from({ length: 65 }, (_, i) => mat({ id: idN('boa', i) }));
    expect(sanitizarCompras({ linhas: [...ruins, ...boas] }).linhas).toHaveLength(LIMITES.linhas);
  });
  it('id repetido dentro do envelope também é resolvido', () => {
    const c = sanitizarCompras({ linhas: [mat({ nome: 'Velha' }), mat({ nome: 'Nova' })] });
    expect(c.linhas.map((l) => l.nome)).toEqual(['Nova']);
  });
  it('devolve objeto novo a cada chamada', () => {
    const a = sanitizarCompras(null);
    const b = sanitizarCompras(null);
    expect(a).not.toBe(b);
    expect(a.linhas).not.toBe(b.linhas);
    expect(comprasVazio()).not.toBe(comprasVazio());
  });
});

describe('comprasVisiveis', () => {
  const cheia: Compras = { v: 1, publica: true, linhas: [L(mat())] };
  it('devolve a própria lista quando está disponível, pública e com linha', () => {
    expect(comprasVisiveis(cheia, true)).toBe(cheia);
  });
  it('null sem a coluna', () => {
    expect(comprasVisiveis(cheia, false)).toBeNull();
  });
  it('null quando a lista está oculta', () => {
    expect(comprasVisiveis({ ...cheia, publica: false }, true)).toBeNull();
  });
  it('null quando não há linha', () => {
    expect(comprasVisiveis(comprasVazio(), true)).toBeNull();
  });
});

describe('prazoDe', () => {
  it('não conforme é alta e atenção é média', () => {
    expect(prazoDe('padrao', { padrao: 'nao_conforme' })).toBe('alta');
    expect(prazoDe('padrao', { padrao: 'atencao' })).toBe('media');
  });
  it('conforme, N/A, sem status e item indefinido não têm prazo', () => {
    expect(prazoDe('padrao', { padrao: 'conforme' })).toBeNull();
    expect(prazoDe('padrao', { padrao: 'na' })).toBeNull();
    expect(prazoDe('padrao', {})).toBeNull();
    expect(prazoDe(undefined, { padrao: 'nao_conforme' })).toBeNull();
    expect(prazoDe('', { padrao: 'nao_conforme' })).toBeNull();
  });
  it('só olha o item da linha e não tropeça em nome de propriedade do objeto', () => {
    expect(prazoDe('telhado', { padrao: 'nao_conforme' })).toBeNull();
    expect(prazoDe('constructor', {})).toBeNull();
    expect(prazoDe('padrao', undefined as never)).toBeNull();
  });
});

describe('formatarQtd', () => {
  it('pt-BR sem Intl', () => {
    const casos: [number, string][] = [
      [3, '3'], [12.5, '12,5'], [1200, '1.200'], [1200.5, '1.200,5'], [0.5, '0,5'], [100, '100'], [10.1, '10,1'],
      [12.35, '12,35'], [0.01, '0,01'], [99999, '99.999'], [1234567, '1.234.567'], [999, '999'], [1000, '1.000'],
    ];
    for (const [n, esperado] of casos) expect(formatarQtd(n), String(n)).toBe(esperado);
  });
  it('valor que não é número finito dá vazio', () => {
    expect(formatarQtd(NaN)).toBe('');
    expect(formatarQtd(Infinity)).toBe('');
    expect(formatarQtd('3' as never)).toBe('');
  });
  it('lê de volta o que lerQtd grava', () => {
    expect(formatarQtd(sanitizarLinha(mat({ qtd: 1200.5 }))!.qtd as number)).toBe('1.200,5');
  });
});

describe('unidadePorExtenso', () => {
  it('singular só com 1; o resto no plural', () => {
    const pares: [Unidade, string, string][] = [
      ['m', 'metro', 'metros'], ['un', 'unidade', 'unidades'], ['cj', 'conjunto', 'conjuntos'],
      ['barra', 'barra', 'barras'], ['pc', 'peça', 'peças'], ['servico', 'serviço', 'serviços'],
    ];
    for (const [un, um, varios] of pares) {
      expect(unidadePorExtenso(un, 1), `${un} 1`).toBe(um);
      expect(unidadePorExtenso(un, 120), `${un} 120`).toBe(varios);
      expect(unidadePorExtenso(un, 4), `${un} 4`).toBe(varios);
    }
  });
  it('quantidade a definir (null) e fração ficam no plural', () => {
    expect(unidadePorExtenso('m', null)).toBe('metros');
    expect(unidadePorExtenso('un', null)).toBe('unidades');
    expect(unidadePorExtenso('m', 0.5)).toBe('metros');
  });
  it('unidade desconhecida cai em unidade', () => {
    expect(unidadePorExtenso('xx' as never, 1)).toBe('unidade');
  });
});

describe('frasesResumo', () => {
  const mats = (n: number, un: Unidade = 'un') => Array.from({ length: n }, (_, i) => L(mat({ id: idN('mat', i + (un === 'servico' ? 500 : 0)), un })));
  const notas = (n: number) => Array.from({ length: n }, (_, i) => L(nota({ id: idN('not', i) })));
  it('singular e plural, omitindo o que é zero', () => {
    expect(frasesResumo(mats(1))).toBe('1 material.');
    expect(frasesResumo([...mats(8), ...mats(2, 'servico'), ...notas(3)])).toBe('8 materiais, 2 serviços e 3 observações.');
    expect(frasesResumo([...mats(2), ...notas(1)])).toBe('2 materiais e 1 observação.');
    expect(frasesResumo(mats(1, 'servico'))).toBe('1 serviço.');
    expect(frasesResumo(notas(3))).toBe('3 observações.');
    expect(frasesResumo([...mats(1), ...mats(1, 'servico')])).toBe('1 material e 1 serviço.');
  });
  it('lista vazia dá texto vazio', () => {
    expect(frasesResumo([])).toBe('');
    expect(frasesResumo(null as never)).toBe('');
  });
});

describe('agruparParaRelatorio', () => {
  const rotulo = (k: string) => ROTULO_CHEIO[k] ?? k;
  const status: MapaStatus = { padrao: 'nao_conforme', sombreamento: 'atencao', cabeamento: 'conforme' };
  const cheia: Compras = {
    v: 1, publica: true,
    linhas: [
      L({ id: 'aaaaaa01', tipo: 'material', nome: 'Poda ou remoção de árvore', un: 'servico', quem: 'cliente', item: 'sombreamento', obs: 'Mangueira no fundo do terreno.' }),
      L({ id: 'aaaaaa02', tipo: 'material', nome: 'Cabo solar CC', qtd: 120, un: 'm', quem: 'integrador', item: 'cabeamento' }),
      L({ id: 'aaaaaa03', tipo: 'material', nome: 'Caixa de medição', esp: 'Modelo aprovado pela distribuidora.', qtd: 1, un: 'un', quem: 'cliente', item: 'padrao' }),
      L({ id: 'aaaaaa04', tipo: 'material', nome: 'Haste de aterramento', qtd: 3, un: 'un', quem: 'cliente', item: 'padrao' }),
      L({ id: 'aaaaaa05', tipo: 'material', nome: 'Laudo estrutural', un: 'servico', quem: 'a_definir' }),
      L({ id: 'aaaaaa06', tipo: 'material', nome: 'Eletroduto rígido', qtd: null, un: 'barra', quem: 'integrador', item: 'cabeamento' }),
      L({ id: 'aaaaaa07', tipo: 'obs', obs: 'Telha antiga, pode ter amianto.', item: 'tipo_telha' }),
      L({ id: 'aaaaaa08', tipo: 'obs', obs: 'Chamar o eletricista.' }),
    ],
  };

  it('grupos na ordem cliente, empresa instaladora e a combinar, com título e frase de apoio', () => {
    const d = agruparParaRelatorio(cheia, status, rotulo);
    expect(d.grupos.map((g) => g.quem)).toEqual(['cliente', 'integrador', 'a_definir']);
    expect(d.grupos.map((g) => g.titulo)).toEqual(['Por conta do cliente', 'Por conta da empresa instaladora', 'A combinar']);
    expect(d.grupos.map((g) => g.apoio)).toEqual([
      'O cliente providencia estes itens e serviços.',
      'Estes itens e serviços ficam com a empresa instaladora.',
      'Ainda não foi definido quem providencia. Combinar antes do orçamento.',
    ]);
  });
  it('dentro do grupo: prazo alto, prazo médio e sem prazo, e a ordem gravada desempata', () => {
    const d = agruparParaRelatorio(cheia, status, rotulo);
    expect(d.grupos[0]!.linhas.map((l) => [l.nome, l.prazo])).toEqual([
      ['Caixa de medição', 'alta'], ['Haste de aterramento', 'alta'], ['Poda ou remoção de árvore', 'media'],
    ]);
    expect(d.grupos[1]!.linhas.map((l) => [l.nome, l.prazo])).toEqual([['Cabo solar CC', null], ['Eletroduto rígido', null]]);
  });
  it('quantidade por extenso com espaço sem quebra, a definir e serviço', () => {
    const [cliente, integrador, combinar] = agruparParaRelatorio(cheia, status, rotulo).grupos;
    const porNome = (g: typeof cliente, nome: string) => g!.linhas.find((l) => l.nome === nome)!;
    expect(porNome(cliente, 'Caixa de medição')).toMatchObject({ qtdTexto: '1\u00A0unidade', aDefinir: false, servico: false });
    expect(porNome(cliente, 'Haste de aterramento').qtdTexto).toBe('3\u00A0unidades');
    expect(porNome(cliente, 'Poda ou remoção de árvore')).toMatchObject({ qtdTexto: '', aDefinir: false, servico: true });
    expect(porNome(integrador, 'Cabo solar CC').qtdTexto).toBe('120\u00A0metros');
    expect(porNome(integrador, 'Eletroduto rígido')).toMatchObject({ qtdTexto: '', aDefinir: true, servico: false });
    expect(porNome(combinar, 'Laudo estrutural')).toMatchObject({ qtdTexto: '', aDefinir: false, servico: true });
  });
  it('esp, nota da linha, item e rótulo do item', () => {
    const [cliente, , combinar] = agruparParaRelatorio(cheia, status, rotulo).grupos;
    expect(cliente!.linhas[0]).toEqual({
      nome: 'Caixa de medição', esp: 'Modelo aprovado pela distribuidora.', nota: '', qtdTexto: '1\u00A0unidade',
      aDefinir: false, servico: false, itemChave: 'padrao', itemRotulo: 'Padrão de entrada', prazo: 'alta',
    });
    expect(cliente!.linhas[2]!.nota).toBe('Mangueira no fundo do terreno.');
    expect('itemChave' in combinar!.linhas[0]!).toBe(false);
    expect('itemRotulo' in combinar!.linhas[0]!).toBe(false);
  });
  it('item Conforme, N/A ou sem status não vira prazo', () => {
    const d = agruparParaRelatorio(cheia, { padrao: 'na', sombreamento: 'conforme' }, rotulo);
    expect(d.prazos).toEqual({ alta: 0, media: 0 });
    expect(d.grupos.flatMap((g) => g.linhas).every((l) => l.prazo === null)).toBe(true);
    expect(agruparParaRelatorio(cheia, {}, rotulo).prazos).toEqual({ alta: 0, media: 0 });
  });
  it('conta o prazo de material e de serviço, e anotação não conta', () => {
    const d = agruparParaRelatorio(cheia, { ...status, tipo_telha: 'nao_conforme' }, rotulo);
    expect(d.prazos).toEqual({ alta: 2, media: 1 });
  });
  it('anotações na ordem gravada, com o rótulo do item só quando há item', () => {
    const d = agruparParaRelatorio(cheia, status, rotulo);
    expect(d.notas).toEqual([{ texto: 'Telha antiga, pode ter amianto.', itemRotulo: 'Tipo de telha' }, { texto: 'Chamar o eletricista.' }]);
    expect('itemRotulo' in d.notas[1]!).toBe(false);
  });
  it('resumo vem de frasesResumo', () => {
    expect(agruparParaRelatorio(cheia, status, rotulo).resumo).toBe('4 materiais, 2 serviços e 2 observações.');
  });
  it('soNotas só quando há anotação e nenhum material nem serviço', () => {
    expect(agruparParaRelatorio(cheia, status, rotulo).soNotas).toBe(false);
    const soNotas: Compras = { v: 1, publica: true, linhas: [L(nota()), L(nota({ id: 'nota0002', obs: 'Outra.' }))] };
    const d = agruparParaRelatorio(soNotas, status, rotulo);
    expect(d).toMatchObject({ soNotas: true, grupos: [], resumo: '2 observações.', prazos: { alta: 0, media: 0 } });
    expect(d.notas).toHaveLength(2);
    expect(agruparParaRelatorio(comprasVazio(), status, rotulo)).toEqual({
      resumo: '', soNotas: false, grupos: [], notas: [], prazos: { alta: 0, media: 0 },
    });
  });
  it('só mostra o grupo que tem linha', () => {
    const soEmpresa: Compras = { v: 1, publica: true, linhas: [L(mat({ quem: 'integrador' }))] };
    expect(agruparParaRelatorio(soEmpresa, {}, rotulo).grupos.map((g) => g.quem)).toEqual(['integrador']);
  });
  it('pede o rótulo só dos itens ligados e ignora rótulo vazio', () => {
    const pedidos: string[] = [];
    agruparParaRelatorio(cheia, status, (k) => { pedidos.push(k); return `R ${k}`; });
    expect(new Set(pedidos)).toEqual(new Set(['sombreamento', 'cabeamento', 'padrao', 'tipo_telha']));
    const d = agruparParaRelatorio(cheia, status, () => '');
    expect(d.grupos.flatMap((g) => g.linhas).some((l) => 'itemRotulo' in l)).toBe(false);
    expect(d.notas.some((n) => 'itemRotulo' in n)).toBe(false);
    expect(d.grupos.flatMap((g) => g.linhas).filter((l) => l.itemChave).length).toBe(5);
  });
});

describe('nomesPorItem', () => {
  it('nomes das linhas de material ligadas ao item, na ordem gravada; anotação e linha sem item ficam fora', () => {
    const c: Compras = {
      v: 1, publica: true,
      linhas: [
        L({ id: 'bbbbbb01', tipo: 'material', nome: 'Poda ou remoção de árvore', un: 'servico', item: 'sombreamento' }),
        L({ id: 'bbbbbb02', tipo: 'material', nome: 'Cabo solar CC', un: 'm', item: 'cabeamento' }),
        L({ id: 'bbbbbb03', tipo: 'material', nome: 'Caixa de medição', item: 'padrao' }),
        L({ id: 'bbbbbb04', tipo: 'material', nome: 'Laudo estrutural', un: 'servico' }),
        L({ id: 'bbbbbb05', tipo: 'obs', obs: 'Telha antiga.', item: 'tipo_telha' }),
        L({ id: 'bbbbbb06', tipo: 'material', nome: 'Eletroduto rígido', un: 'barra', item: 'cabeamento' }),
      ],
    };
    expect(nomesPorItem(c)).toEqual({
      sombreamento: ['Poda ou remoção de árvore'],
      cabeamento: ['Cabo solar CC', 'Eletroduto rígido'],
      padrao: ['Caixa de medição'],
    });
  });
  it('lista vazia dá objeto vazio', () => {
    expect(nomesPorItem(comprasVazio())).toEqual({});
  });
  it('chave estranha não mexe no protótipo', () => {
    const c = { v: 1, publica: true, linhas: [{ id: 'cccccc01', tipo: 'material', nome: 'Cabo', item: '__proto__', obs: '' }] } as unknown as Compras;
    const r = nomesPorItem(c);
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).length).toBeUndefined();
  });
});

describe('textos que o cliente lê', () => {
  it('nada do que sai tem travessão nem emoji, e as frases fecham como esperado', () => {
    const rotulo = (k: string) => ROTULO_CHEIO[k] ?? k;
    const c: Compras = {
      v: 1, publica: true,
      linhas: [
        L(mat({ id: 'dddddd01', un: 'm', qtd: 12.5, quem: 'cliente', item: 'padrao' })),
        L(mat({ id: 'dddddd02', un: 'servico', quem: 'integrador' })),
        L(mat({ id: 'dddddd03', un: 'cj', qtd: null, quem: 'a_definir' })),
        L(nota({ id: 'dddddd04', item: 'tipo_telha' })),
      ],
    };
    const d = agruparParaRelatorio(c, { padrao: 'nao_conforme' }, rotulo);

    const folhas: string[] = [];
    const colher = (v: unknown): void => {
      if (typeof v === 'string') folhas.push(v);
      else if (Array.isArray(v)) v.forEach(colher);
      else if (v && typeof v === 'object') Object.values(v).forEach(colher);
    };
    colher(d);
    colher([...UNIDADES, ...QUEM, ...CHAVES_ITENS]);
    for (const un of UNIDADES) for (const q of [1, 2, null]) folhas.push(unidadePorExtenso(un, q));
    for (const n of [0.5, 12.5, 1200, 99999]) folhas.push(formatarQtd(n));
    folhas.push(frasesResumo(c.linhas), frasesResumo([]), frasesResumo(c.linhas.slice(0, 1)));

    expect(folhas.length).toBeGreaterThan(40);
    for (const t of folhas) {
      expect(t, t).not.toMatch(TRAVESSOES);
      expect(t, t).not.toMatch(EMOJI_TESTE);
    }
    for (const g of d.grupos) {
      expect(g.titulo).toMatch(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/);
      expect(g.apoio).toMatch(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ].*\.$/);
    }
    expect(d.resumo).toMatch(/\.$/);
  });
});

describe('contrato com o checklist', () => {
  it('CHAVES_ITENS é igual às chaves de CHECKLIST_VISTORIA, na mesma ordem', () => {
    expect([...CHAVES_ITENS]).toEqual(CHECKLIST_VISTORIA.map((c) => c.key));
  });
  it('limites do plano', () => {
    expect(LIMITES).toEqual({ linhas: 60, nome: 80, esp: 140, obsLinha: 200, obsNota: 500, qtdMax: 99999, json: 48000 });
    expect([...UNIDADES]).toEqual(['un', 'm', 'pc', 'cj', 'barra', 'servico']);
    expect([...QUEM]).toEqual(['integrador', 'cliente', 'a_definir']);
  });
});

describe('lerCompras (banco falso)', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const COLUNA_AUSENTE = { code: '42703', message: 'column vistorias.compras does not exist' };
  const BANCO_FORA = { code: '57P01', message: 'terminating connection due to administrator command' };
  const poeVistoria = (extra: Record<string, unknown> = {}) =>
    banco.poe('vistorias', { id: ID, user_id: 'user-1', status: 'em_andamento', itens: [], ...extra });

  beforeEach(() => banco.reset());

  it('lê o envelope gravado e sanea', async () => {
    poeVistoria({ compras: { v: 1, publica: false, linhas: [mat({ nome: 'cabo solar' }), { id: 'x', tipo: 'material', nome: 'ruim' }, nota()] } });
    const r = await lerCompras(ID);
    expect(r.disponivel).toBe(true);
    expect(r.compras.publica).toBe(false);
    expect(r.compras.linhas.map((l) => l.nome ?? l.obs)).toEqual(['Cabo solar', 'Telha antiga, pode ter amianto.']);
  });
  it("o padrão da coluna ('{}') é lista vazia e visível", async () => {
    poeVistoria({ compras: {} });
    expect(await lerCompras(ID)).toEqual({ compras: { v: 1, publica: true, linhas: [] }, disponivel: true });
  });
  it('vistoria sem a chave compras, ou id que não existe, também dá lista vazia com a coluna disponível', async () => {
    poeVistoria();
    expect(await lerCompras(ID)).toEqual({ compras: comprasVazio(), disponivel: true });
    expect(await lerCompras('00000000-0000-4000-8000-000000000000')).toEqual({ compras: comprasVazio(), disponivel: true });
  });
  it('coluna que não existe vira disponivel false, pelos três jeitos de o banco avisar', async () => {
    poeVistoria();
    const avisos = [
      COLUNA_AUSENTE,
      { code: 'PGRST204', message: "Could not find the 'compras' column of 'vistorias' in the schema cache" },
      { code: 'XX000', message: 'column "compras" does not exist' },
    ];
    for (const erro of avisos) {
      banco.falhas['vistorias.select'] = { erro, uma: true };
      expect(await lerCompras(ID), erro.message).toEqual({ compras: comprasVazio(), disponivel: false });
    }
  });
  it('qualquer outro erro LANÇA, para a escrita não gravar por cima do que não leu', async () => {
    poeVistoria({ compras: { linhas: [mat()] } });
    banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true };
    await expect(lerCompras(ID)).rejects.toThrow(/falha lendo compras/);
  });
  it('o select pede a coluna compras (com a projeção do banco falso ligada) e não escreve nada', async () => {
    poeVistoria({ compras: { linhas: [mat({ nome: 'cabo solar' })] }, cliente_nome: 'Maria Souza' });
    banco.projeta = true;
    const r = await lerCompras(ID);
    expect(r.compras.linhas.map((l) => l.nome)).toEqual(['Cabo solar']);
    expect(banco.escritas).toHaveLength(0);
  });
});
