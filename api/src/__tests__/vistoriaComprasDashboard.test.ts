import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Espelho do dashboard da lista de compras. Os quatro arquivos puros da tela (comprasTipos, comprasTextos,
// catalogoCompras e comprasPuro) são lidos por TEXTO e transpilados aqui, nunca importados: um import estático
// de arquivo sob dashboard/ entraria no programa do tsc e quebraria o rootDir (TS6059) com o vitest verde.
// Prova que as duas pontas (api e dashboard) dão a mesma saída, que o catálogo está inteiro e limpo e que os
// textos para o WhatsApp saem como o plano manda. Dados inventados.
// Travessão e emoji aparecem aqui só como escape (\u2013, \u2014, \u{1F600}), nunca como caractere literal.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));

import { CHECKLIST_VISTORIA } from '../routes/vistorias';
import { ITENS_COM_STATUS } from '../services/vistoria/avaliacao';
import {
  CHAVES_ITENS as API_CHAVES, LIMITES as API_LIMITES, QUEM as API_QUEM, UNIDADES as API_UNIDADES,
  formatarQtd as apiFormatarQtd, frasesResumo as apiFrasesResumo, limparTexto as apiLimparTexto,
  prazoDe as apiPrazoDe, sanitizarLinha, unidadePorExtenso as apiUnidadePorExtenso,
} from '../services/vistoria/compras';

// ---------------------------------------------------------------------------------------------------------
// Carga dos módulos do dashboard (receita 10.6 do plano)
// ---------------------------------------------------------------------------------------------------------

const PASTA = join(__dirname, '..', '..', '..', 'dashboard', 'src', 'app', '(dashboard)', 'vistoria');
const cache = new Map<string, Record<string, any>>();
function carregar(arquivo: string): Record<string, any> {
  if (cache.has(arquivo)) return cache.get(arquivo)!;
  const js = ts.transpileModule(readFileSync(join(PASTA, arquivo), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const exigir = (p: string) => {
    if (p.startsWith('./')) return carregar(p.slice(2) + '.ts');
    throw new Error('import externo não permitido nos módulos puros: ' + p);
  };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, exigir);
  cache.set(arquivo, mod.exports);
  return mod.exports;
}
const fonte = (arquivo: string): string => readFileSync(join(PASTA, arquivo), 'utf8');

const tipos = carregar('comprasTipos.ts');
const textos = carregar('comprasTextos.ts');
const catalogo = carregar('catalogoCompras.ts');
const puro = carregar('comprasPuro.ts');

interface Gat { item: string; quando: string; peso: number }
interface Entrada {
  cid: string; nome: string; cat: string; un: string; quem: string; esp: string;
  gatilhos?: Gat[]; sempre?: true; alternativa?: string; aviso?: string;
}
interface Linha {
  id: string; tipo: string; nome?: string; esp?: string; qtd?: number | null; un?: string; quem?: string;
  item?: string; cid?: string; obs: string; ts?: string;
}
interface Estado { publica: boolean; linhas: Linha[] }
interface Sugerida { entrada: Entrada; peso: number }
interface Grupo { item: string; status: string; entradas: Sugerida[] }

const CATALOGO = catalogo.CATALOGO as Entrada[];
const CATEGORIAS = catalogo.CATEGORIAS as { chave: string; rotulo: string }[];
const OBSERVACOES = catalogo.OBSERVACOES_PRONTAS as { texto: string; itens: string[] }[];
const TEXTOS = textos.TEXTOS_COMPRAS as Record<string, string>;

const {
  limparTexto, lerQtd, criarId, normalizarLinha, prazoDe, formatarQtd, unidadePorExtenso, frasesResumo,
  linhaDoCatalogo, linhaLivre, linhaNota, adicionarLinha, removerLinha, restaurarLinha, atualizarLinha,
  sugerir, contagemPorItem, sugestoesDoItem, itemQueDispara, buscar, primeiroNome, textoFornecedor, textoCliente,
} = puro;

// ---------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------

const TRAVESSAO_MEDIO = '\u2013';
const TRAVESSAO_LONGO = '\u2014';
const SOL = '\u2600';
const CORACAO = '\u2764';
const ROSTO = '\u{1F600}';
const TRAVESSOES = /[\u2013\u2014]/;
const EMOJI_TESTE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
// Lista proibida do plano (10.5): vale para os VALORES exportados, não para o texto cru do arquivo (o comentário
// do catálogo cita as fontes consultadas).
const PROIBIDO = /CEMIG|\bEnel\b|\bND-|Copel|CPFL|Energisa|Neoenergia|MC4|Canal Solar|\bINEL\b|\bCREA\b|\bABNT\b|\bNBR\b/;
const PROIBIDO_FRASES = /75 kW|sem custo/i;

const AGORA = '2026-10-29T14:00:00.000Z';
let sequencia = 0;
const novoId = () => `lin${String(++sequencia).padStart(5, '0')}`;

/** Todas as strings de um valor exportado, em qualquer fundo (objetos e listas); funções ficam de fora. */
function todasAsStrings(valor: unknown, acc: string[] = []): string[] {
  if (typeof valor === 'string') acc.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => todasAsStrings(v, acc));
  else if (valor && typeof valor === 'object') Object.values(valor).forEach((v) => todasAsStrings(v, acc));
  return acc;
}

const entrada = (cid: string): Entrada => {
  const e = CATALOGO.find((x) => x.cid === cid);
  if (!e) throw new Error('entrada inexistente: ' + cid);
  return e;
};
/** Linha criada pelo catálogo, com ajustes (quantidade, item, nota). */
const doCatalogo = (cid: string, extra: Partial<Linha> = {}, item?: string): Linha => {
  const l = linhaDoCatalogo(entrada(cid), { item, agora: AGORA, id: novoId() }) as Linha;
  return { ...l, ...extra };
};
const material = (extra: Partial<Linha> = {}): Linha => ({
  id: novoId(), tipo: 'material', nome: 'Caixa de medição', qtd: 1, un: 'un', quem: 'cliente', obs: '', ...extra,
});
const nota = (obs: string, extra: Partial<Linha> = {}): Linha => ({ id: novoId(), tipo: 'obs', obs, ...extra });
const estadoDe = (linhas: Linha[], publica = true): Estado => ({ publica, linhas });
const cheia = (): Estado => estadoDe(Array.from({ length: 60 }, (_, i) => material({ id: `cheia${String(i).padStart(3, '0')}`, nome: `Material numero ${i}` })));

// ---------------------------------------------------------------------------------------------------------
// Espelho das constantes
// ---------------------------------------------------------------------------------------------------------

describe('espelho das constantes com a API', () => {
  it('UNIDADES, QUEM, CHAVES_ITENS e LIMITES são iguais aos da API', () => {
    expect([...tipos.UNIDADES]).toEqual([...API_UNIDADES]);
    expect([...tipos.QUEM]).toEqual([...API_QUEM]);
    expect([...tipos.CHAVES_ITENS]).toEqual([...API_CHAVES]);
    expect({ ...tipos.LIMITES }).toEqual({ ...API_LIMITES });
  });

  it('a lista CHAVES_ITENS é igual às chaves de CHECKLIST_VISTORIA, na mesma ordem', () => {
    expect([...tipos.CHAVES_ITENS]).toEqual(CHECKLIST_VISTORIA.map((i) => i.key));
  });

  it('os 12 ROTULO_ITEM são iguais aos label de CHECKLIST_VISTORIA', () => {
    expect(Object.keys(tipos.ROTULO_ITEM)).toEqual(CHECKLIST_VISTORIA.map((i) => i.key));
    for (const item of CHECKLIST_VISTORIA) expect(tipos.ROTULO_ITEM[item.key]).toBe(item.label);
  });

  it('os rótulos de unidade, quem e status cobrem tudo e são os do plano', () => {
    expect(tipos.ROTULO_UNIDADE).toEqual({ un: 'Unidade', m: 'Metro', pc: 'Peça', cj: 'Conjunto', barra: 'Barra', servico: 'Serviço' });
    expect(tipos.ABREV_UNIDADE).toEqual({ un: 'un', m: 'm', pc: 'pç', cj: 'cj', barra: 'barra', servico: 'serviço' });
    expect(tipos.ROTULO_QUEM).toEqual({ integrador: 'Integrador', cliente: 'Cliente', a_definir: 'A combinar' });
    expect(tipos.ROTULO_STATUS).toEqual({ atencao: 'Atenção', nao_conforme: 'Não conforme' });
    expect(Object.keys(tipos.ROTULO_UNIDADE)).toEqual([...tipos.UNIDADES]);
    expect(Object.keys(tipos.ROTULO_QUEM)).toEqual([...tipos.QUEM]);
  });
});

describe('contrato de importação dos módulos puros', () => {
  const importacoes = (arquivo: string) => fonte(arquivo).split(/\r?\n/).filter((l) => /^\s*import\b/.test(l) || /^\s*\}\s*from\s/.test(l));

  it('comprasTipos e comprasTextos não têm import nenhum', () => {
    expect(importacoes('comprasTipos.ts')).toEqual([]);
    expect(importacoes('comprasTextos.ts')).toEqual([]);
  });

  it('o catálogo só importa TIPOS de ./comprasTipos', () => {
    expect(importacoes('catalogoCompras.ts')).toEqual(["import type { EntradaCatalogo, Gatilho } from './comprasTipos';"]);
  });

  it('comprasPuro só importa de ./comprasTipos, e o catálogo não entra por import', () => {
    const linhas = importacoes('comprasPuro.ts');
    expect(linhas.length).toBeGreaterThan(0);
    const origens = fonte('comprasPuro.ts').match(/from '[^']+'/g) ?? [];
    expect([...new Set(origens)]).toEqual(["from './comprasTipos'"]);
    expect(linhas.join('\n')).not.toMatch(/catalogoCompras|comprasTextos|react|@\//i);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Paridade com a API
// ---------------------------------------------------------------------------------------------------------

describe('paridade com a API: mesmo corpus, mesma saída', () => {
  const TEXTOS_CORPUS: unknown[] = [
    'Caixa de medição', '  caixa \n\n  de\t medição \r\n ', `Cabo ${SOL} solar ${CORACAO} CC ${ROSTO}`,
    `cabo${TRAVESSAO_MEDIO}solar${TRAVESSAO_LONGO}cc`, 'a\u200Db\uFE0Fc\u20E3', '', '   ', ROSTO, 'ç', 'çedilha',
    'x'.repeat(100), 'ação '.repeat(40), 'a\u0000b\u001Fc\u007Fd\u009Fe', 'ÁGUA', '12,5 mm', "d'água",
    undefined, null, 12, true, {}, [], ['a'],
  ];

  it('limparTexto', () => {
    for (const t of TEXTOS_CORPUS) {
      for (const max of [0, 1, 5, 80, 140, 200, 500]) {
        expect(limparTexto(t, max)).toBe(apiLimparTexto(t, max));
      }
    }
  });

  it('limparTexto: o comportamento do plano', () => {
    expect(limparTexto(`Cabo ${SOL} solar ${CORACAO} CC ${ROSTO}`, 80)).toBe('Cabo solar CC');
    expect(limparTexto(`cabo${TRAVESSAO_MEDIO}solar${TRAVESSAO_LONGO}cc`, 80)).toBe('Cabo-solar-cc');
    expect(limparTexto('  caixa \n\n  de\t medição ', 80)).toBe('Caixa de medição');
    expect(limparTexto('x'.repeat(100), 80)).toHaveLength(80);
    expect(limparTexto(undefined, 80)).toBe('');
    expect(limparTexto(42, 80)).toBe('');
  });

  it('lerQtd dá o mesmo que o qtd da linha saneada pela API', () => {
    const valores: unknown[] = [
      1, 3, 12.5, 12.345, 12.344, 1.005, 0.5, 0.01, 0.005, 0.0049, 0.004, 0, -1, -0.5, 99999, 99999.004, 99999.005,
      99999.99, 100000, 100000.0001, 1e21, 1e-7, 5e-3, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity,
      '5', '1,5', '', null, undefined, true, [], {},
    ];
    for (const qtd of valores) {
      const api = sanitizarLinha({ id: 'abc123xy', tipo: 'material', nome: 'Cabo solar', un: 'm', quem: 'integrador', qtd });
      expect(api).not.toBeNull();
      expect(lerQtd(qtd)).toBe(api!.qtd);
    }
  });

  it('lerQtd: o comportamento do plano', () => {
    expect(lerQtd(12.345)).toBe(12.35);
    expect(lerQtd(1.005)).toBe(1.01);
    expect(lerQtd(0.01)).toBe(0.01);
    expect(lerQtd(99999)).toBe(99999);
    for (const ruim of [0, -3, NaN, Infinity, '5', null, undefined, 100000, 0.004]) expect(lerQtd(ruim)).toBeNull();
  });

  it('formatarQtd', () => {
    const valores = [0, 0.01, 0.5, 1, 3, 10.1, 12.5, 100, 1200, 1200.5, 99999, 99999.99, 1234567.891, -3, -0.5, -1200.25, NaN, Infinity];
    for (const n of valores) expect(formatarQtd(n)).toBe(apiFormatarQtd(n));
    expect(formatarQtd(3)).toBe('3');
    expect(formatarQtd(12.5)).toBe('12,5');
    expect(formatarQtd(1200)).toBe('1.200');
    expect(formatarQtd(1200.5)).toBe('1.200,5');
    expect(formatarQtd(0.5)).toBe('0,5');
    expect(formatarQtd(100)).toBe('100');
    expect(formatarQtd(10.1)).toBe('10,1');
  });

  it('unidadePorExtenso', () => {
    for (const un of tipos.UNIDADES) {
      for (const qtd of [1, 2, 0, 1.5, 120, null]) expect(unidadePorExtenso(un, qtd)).toBe(apiUnidadePorExtenso(un, qtd));
    }
    expect(unidadePorExtenso('m', 1)).toBe('metro');
    expect(unidadePorExtenso('m', 120)).toBe('metros');
    expect(unidadePorExtenso('cj', 1)).toBe('conjunto');
    expect(unidadePorExtenso('pc', 4)).toBe('peças');
    expect(unidadePorExtenso('m', null)).toBe('metros');
    expect(unidadePorExtenso('xx', 1)).toBe('unidade');
  });

  it('frasesResumo', () => {
    const mat = (un: string, id: string) => ({ id, tipo: 'material', nome: 'Item', un, obs: '' });
    const not = (id: string) => ({ id, tipo: 'obs', obs: 'Texto' });
    const corpus: unknown[][] = [
      [],
      [mat('un', 'a1')],
      [mat('un', 'a1'), mat('m', 'a2'), not('n1')],
      [mat('servico', 's1'), mat('servico', 's2')],
      [mat('un', 'a1'), mat('un', 'a2'), mat('un', 'a3'), mat('un', 'a4'), mat('un', 'a5'), mat('un', 'a6'), mat('un', 'a7'), mat('un', 'a8'),
        mat('servico', 's1'), mat('servico', 's2'), not('n1'), not('n2'), not('n3')],
      [not('n1')],
      [null, undefined, 'x', 3, mat('un', 'a1')],
    ];
    for (const linhas of corpus) expect(frasesResumo(linhas)).toBe(apiFrasesResumo(linhas as never));
    expect(frasesResumo([material()])).toBe('1 material.');
    expect(frasesResumo([material(), material({ un: 'servico' }), nota('a'), nota('b'), nota('c')])).toBe('1 material, 1 serviço e 3 observações.');
    expect(frasesResumo([material(), nota('a')])).toBe('1 material e 1 observação.');
    expect(frasesResumo([])).toBe('');
  });

  it('prazoDe', () => {
    const status = { padrao: 'nao_conforme', telhado: 'atencao', medidor: 'conforme', estrutura: 'na' } as const;
    for (const item of [undefined, 'padrao', 'telhado', 'medidor', 'estrutura', 'cabeamento', 'x']) {
      expect(prazoDe(item, status)).toBe(apiPrazoDe(item, status));
    }
    expect(prazoDe('padrao', status)).toBe('alta');
    expect(prazoDe('telhado', status)).toBe('media');
    expect(prazoDe('medidor', status)).toBeNull();
    expect(prazoDe(undefined, status)).toBeNull();
  });

  describe('normalizarLinha versus sanitizarLinha', () => {
    const BASE = { id: 'abc123xy', tipo: 'material', nome: 'Caixa de medição', qtd: 1, un: 'un', quem: 'cliente' };
    const NOTA = { id: 'nota0001', tipo: 'obs', obs: 'Telha antiga, pode ter amianto.' };
    const corpus: unknown[] = [
      BASE, NOTA,
      { ...BASE, id: 'ABC123' }, { ...BASE, id: 'abc' }, { ...BASE, id: 'a-b-c-d-e' }, { ...BASE, id: 123456 }, { ...BASE, id: 'a'.repeat(25) },
      { ...BASE, id: 'a'.repeat(24) }, { ...BASE, id: undefined },
      { ...BASE, tipo: 'xyz' }, { ...BASE, tipo: undefined },
      { ...BASE, nome: 'a' }, { ...BASE, nome: undefined }, { ...BASE, nome: `Cabo ${SOL} solar ${ROSTO}` }, { ...BASE, nome: 'b'.repeat(90) },
      { ...BASE, nome: `Cabo${TRAVESSAO_LONGO}solar` }, { ...BASE, nome: '  ab  ' },
      { ...BASE, esp: '' }, { ...BASE, esp: '   ' }, { ...BASE, esp: 'e'.repeat(200) }, { ...BASE, esp: `Aço ${CORACAO} cobreado` },
      { ...BASE, qtd: 0 }, { ...BASE, qtd: -1 }, { ...BASE, qtd: NaN }, { ...BASE, qtd: '5' }, { ...BASE, qtd: 100000 }, { ...BASE, qtd: 99999 },
      { ...BASE, qtd: 12.345 }, { ...BASE, qtd: 0.005 }, { ...BASE, qtd: 0.004 }, { ...BASE, qtd: null }, { ...BASE, qtd: undefined },
      { ...BASE, un: 'servico', qtd: 5 }, { ...BASE, un: 'm', qtd: 7.5 }, { ...BASE, un: 'barra', qtd: null }, { ...BASE, un: 'xx' }, { ...BASE, un: undefined },
      { ...BASE, quem: 'integrador' }, { ...BASE, quem: 'a_definir' }, { ...BASE, quem: 'terceiro' }, { ...BASE, quem: undefined },
      { ...BASE, item: 'padrao' }, { ...BASE, item: 'sombreamento' }, { ...BASE, item: 'inexistente' }, { ...BASE, item: 12 },
      { ...BASE, cid: 'caixa-medicao' }, { ...BASE, cid: 'Caixa' }, { ...BASE, cid: 'a'.repeat(41) }, { ...BASE, cid: '' },
      { ...BASE, ts: '2026-10-29T14:03:11.000Z' }, { ...BASE, ts: '2026-10-29' }, { ...BASE, ts: '29/10/2026' }, { ...BASE, ts: 'x'.repeat(40) },
      { ...BASE, ts: '2026-13-45T10:00:00Z' }, { ...BASE, ts: 20261029 },
      { ...BASE, obs: 'nota da linha' }, { ...BASE, obs: 'o'.repeat(300) }, { ...BASE, obs: 42 },
      { ...BASE, foo: 1, publica: false },
      { ...NOTA, obs: '' }, { ...NOTA, obs: '   ' }, { ...NOTA, obs: 'n'.repeat(600) }, { ...NOTA, item: 'telhado' }, { ...NOTA, item: 'x' },
      { ...NOTA, cid: 'obs-pronta' }, { ...NOTA, ts: '2026-10-29T14:03:11Z' }, { ...NOTA, nome: 'Ignorado', qtd: 3, un: 'm' },
      null, undefined, 'texto', 12, true, [], [BASE], {},
    ];

    it('cada linha do corpus sai igual (nula ou saneada)', () => {
      for (const bruto of corpus) {
        expect(normalizarLinha(bruto)).toStrictEqual(sanitizarLinha(bruto));
      }
    });

    it('o corpus tem linhas boas e ruins (a comparação não é vazia)', () => {
      const boas = corpus.filter((b) => sanitizarLinha(b) !== null).length;
      expect(boas).toBeGreaterThan(30);
      expect(corpus.length - boas).toBeGreaterThan(15);
    });

    it('normalizar duas vezes dá o mesmo que uma', () => {
      for (const bruto of corpus) {
        const uma = normalizarLinha(bruto);
        if (uma) expect(normalizarLinha(uma)).toStrictEqual(uma);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------------------------------------

describe('catálogo', () => {
  it('tem 72 entradas, 9 categorias, 13 sempre e 59 com gatilho', () => {
    expect(CATALOGO).toHaveLength(72);
    expect(CATEGORIAS).toHaveLength(9);
    expect(CATALOGO.filter((e) => e.sempre)).toHaveLength(13);
    expect(CATALOGO.filter((e) => e.gatilhos && e.gatilhos.length > 0)).toHaveLength(59);
  });

  it('cada entrada é `sempre` ou tem gatilho, nunca as duas coisas nem nenhuma', () => {
    for (const e of CATALOGO) {
      const temGatilho = !!e.gatilhos && e.gatilhos.length > 0;
      expect(temGatilho !== !!e.sempre, e.cid).toBe(true);
    }
  });

  it('os 13 sempre são os do plano', () => {
    expect(CATALOGO.filter((e) => e.sempre).map((e) => e.cid).sort()).toEqual([
      'placa-geracao-propria', 'cabo-equipotencializacao', 'disjuntor-ca-inversor', 'fusivel-string', 'cabo-solar-cc',
      'conector-cc', 'perfil-aluminio', 'emenda-perfil', 'grampo-intermediario', 'grampo-final',
      'parafusos-inox-estrutura', 'estrutura-solo', 'epi-eletricidade',
    ].sort());
  });

  it('cid único e no formato; unidade e quem válidos; nome e esp dentro dos limites', () => {
    expect(new Set(CATALOGO.map((e) => e.cid)).size).toBe(CATALOGO.length);
    for (const e of CATALOGO) {
      expect(e.cid, e.cid).toMatch(/^[a-z0-9-]{1,40}$/);
      expect([...tipos.UNIDADES], e.cid).toContain(e.un);
      expect([...tipos.QUEM], e.cid).toContain(e.quem);
      expect(e.nome.length, e.cid).toBeGreaterThanOrEqual(2);
      expect(e.nome.length, e.cid).toBeLessThanOrEqual(tipos.LIMITES.nome);
      expect(e.esp.length, e.cid).toBeGreaterThan(0);
      expect(e.esp.length, e.cid).toBeLessThanOrEqual(140);
    }
  });

  it('toda categoria usada existe e toda categoria tem entrada', () => {
    const chaves = CATEGORIAS.map((c) => c.chave);
    for (const e of CATALOGO) expect(chaves, e.cid).toContain(e.cat);
    for (const c of chaves) expect(CATALOGO.some((e) => e.cat === c), c).toBe(true);
  });

  it('todo gatilho aponta para um dos itens do checklist, com `quando` e `peso` válidos', () => {
    for (const e of CATALOGO) {
      for (const g of e.gatilhos ?? []) {
        expect([...tipos.CHAVES_ITENS], e.cid).toContain(g.item);
        expect(['A', 'N', 'AN'], e.cid).toContain(g.quando);
        expect([1, 2, 3], e.cid).toContain(g.peso);
      }
    }
  });

  it('gatilho só em item que tem status (conta de luz e documento ficam de fora)', () => {
    for (const e of CATALOGO) for (const g of e.gatilhos ?? []) expect(ITENS_COM_STATUS, e.cid).toContain(g.item);
  });

  it('exatamente 6 entradas têm alternativa (4 telha e 2 laje), todas com gatilho', () => {
    const alternativas = CATALOGO.filter((e) => e.alternativa);
    expect(alternativas).toHaveLength(6);
    expect(alternativas.filter((e) => e.alternativa === 'telha')).toHaveLength(4);
    expect(alternativas.filter((e) => e.alternativa === 'laje')).toHaveLength(2);
    for (const e of alternativas) expect(e.gatilhos && e.gatilhos.length > 0, e.cid).toBe(true);
  });

  it("`aviso: 'amianto'` só no kit de fibrocimento e na remoção com amianto", () => {
    expect(CATALOGO.filter((e) => e.aviso).map((e) => e.cid).sort()).toEqual(['kit-fixacao-fibrocimento', 'remocao-telhado-amianto']);
    for (const e of CATALOGO.filter((x) => x.aviso)) expect(e.aviso).toBe('amianto');
  });

  it('as 72 entradas viram linha válida e a normalização não muda nome nem especificação', () => {
    for (const e of CATALOGO) {
      const l = linhaDoCatalogo(e, { item: 'telhado', agora: AGORA, id: novoId() }) as Linha;
      expect(normalizarLinha(l), e.cid).toStrictEqual(l);
      expect(l.nome, e.cid).toBe(e.nome);
      expect(l.esp, e.cid).toBe(e.esp);
    }
  });

  it('lista proibida, travessão e emoji nos VALORES exportados (não no texto cru do arquivo)', () => {
    const valores = [
      ...todasAsStrings(catalogo), ...todasAsStrings(tipos), ...todasAsStrings(textos),
    ];
    expect(valores.length).toBeGreaterThan(300);
    for (const v of valores) {
      expect(v).not.toMatch(PROIBIDO);
      expect(v).not.toMatch(PROIBIDO_FRASES);
      expect(v).not.toMatch(TRAVESSOES);
      expect(v).not.toMatch(EMOJI_TESTE);
    }
  });

  it('a lista proibida pega o que deve (a prova de que o teste olha de verdade)', () => {
    for (const ruim of ['Padrão CEMIG', 'norma ND-5.1', 'Enel Distribuição', 'segundo a ABNT', 'NBR 16690', 'CREA-SC', 'INEL']) {
      expect(PROIBIDO.test(ruim), ruim).toBe(true);
    }
    expect(PROIBIDO_FRASES.test('até 75 kW')).toBe(true);
    expect(PROIBIDO_FRASES.test('Instalação sem custo')).toBe(true);
    expect(PROIBIDO.test('Cabo solar CC, cobre estanhado')).toBe(false);
  });
});

describe('observações prontas', () => {
  it('são 33, começam com maiúscula, terminam com ponto e não falam em primeira pessoa', () => {
    expect(OBSERVACOES).toHaveLength(33);
    for (const o of OBSERVACOES) {
      expect(o.texto, o.texto).toMatch(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/);
      expect(o.texto, o.texto).toMatch(/\.$/);
      expect(o.texto, o.texto).not.toMatch(/\bRecomendo\b/);
      expect(o.texto.length, o.texto).toBeLessThanOrEqual(tipos.LIMITES.obsNota);
      expect(o.itens.length, o.texto).toBeGreaterThan(0);
      for (const item of o.itens) expect([...tipos.CHAVES_ITENS], o.texto).toContain(item);
    }
  });

  it('todas passam pela limpeza de nota sem mudar', () => {
    for (const o of OBSERVACOES) expect(limparTexto(o.texto, tipos.LIMITES.obsNota), o.texto).toBe(o.texto);
  });

  it('a nota do amianto da observação pronta é a mesma que nasce com a linha do catálogo', () => {
    const l = linhaDoCatalogo(entrada('kit-fixacao-fibrocimento'), { item: 'tipo_telha', agora: AGORA, id: novoId() }) as Linha;
    expect(OBSERVACOES.some((o) => o.texto.startsWith(l.obs))).toBe(true);
  });
});

describe('textos da tela', () => {
  const CHAVES_DO_PLANO = [
    'titulo', 'apoioPublica', 'apoioPrivada', 'interruptor', 'pilula', 'pilulaAria', 'salvo', 'salvando', 'semRede', 'semRedeAviso',
    'redeVoltou', 'erroSalvar', 'erroConcluir', 'conflito', 'liberando', 'vazioTitulo', 'vazioDica', 'vazioComSugestoes',
    'sugeridosTitulo', 'verTodas', 'dispensar', 'dispensarAria', 'naLista', 'resumoLista', 'btnAdicionar', 'btnObservacao',
    'btnWhatsapp', 'dicaSemMaterial', 'limite', 'faixaSo', 'faixaAmbas', 'faixaLista', 'folhaGeral', 'folhaItem', 'buscarBotao',
    'buscarPlaceholder', 'buscarAria', 'recentes', 'categorias', 'comuns', 'nadaEncontrado', 'adicionarLivre', 'adicionar',
    'adicionarSugeridas', 'escolhaTelha', 'seForLaje', 'mostrarMais', 'obsProntas', 'pronto', 'prontoN', 'motivo', 'diminuirAria',
    'aumentarAria', 'numeroAria', 'apagarAria', 'editarAria', 'faltaQtd', 'informarQtd', 'formLivre', 'editarLinha', 'anotar',
    'rotNome', 'rotEsp', 'rotQtd', 'rotUn', 'rotQuem', 'rotNota', 'rotItem', 'phNome', 'phEsp', 'phNota', 'phObs', 'btnAddLista',
    'salvar', 'apagarLinha', 'cancelar', 'contador', 'adicionado', 'lote', 'notaAdd', 'apagada', 'desfazer', 'jaEsta', 'nomeVazio',
    'qtdInvalida', 'amiantoAviso', 'amiantoObs', 'abaForn', 'abaCli', 'copiarTexto', 'abrirZap', 'copiou', 'naoCopiou',
    'notaPrivacidade', 'notaLink', 'fora', 'incluiCombinar', 'naoIncluiCombinar', 'faltaQtdN', 'semItemCliente', 'listaLonga',
    'painelResumo', 'painelPrivada', 'avisoSemStatus',
  ];

  it('tem todas as chaves da tabela 9.1 do plano, cada uma com texto', () => {
    for (const chave of CHAVES_DO_PLANO) {
      expect(typeof TEXTOS[chave], chave).toBe('string');
      expect(TEXTOS[chave].length, chave).toBeGreaterThan(0);
    }
  });

  it('as formas no plural e no singular existem onde o plano pede', () => {
    for (const chave of ['vazioComSugestao', 'incluiCombinarPlural', 'naoIncluiCombinarPlural', 'faltaQtdNPlural', 'loteUma', 'jaEstava']) {
      expect(typeof TEXTOS[chave], chave).toBe('string');
    }
  });

  it('todo valor é texto, começa com maiúscula ou com número ou chave, e usa só marcadores conhecidos', () => {
    const conhecidos = new Set(['n', 'max', 'nome', 'texto', 'Item', 'Status', 'a', 'm', 's', 'o', 'resumo', 'lista', 'x']);
    for (const [chave, v] of Object.entries(TEXTOS)) {
      expect(typeof v, chave).toBe('string');
      expect(v, chave).toMatch(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9{]/);
      for (const m of v.match(/\{[^}]*\}/g) ?? []) expect(conhecidos.has(m.slice(1, -1)), `${chave}: ${m}`).toBe(true);
    }
  });

  it('textos exatos que o plano cita', () => {
    expect(TEXTOS.titulo).toBe('Lista de compras');
    expect(TEXTOS.limite).toBe('A lista chegou a 60 linhas. Apague alguma para continuar.');
    expect(TEXTOS.notaPrivacidade).toBe('O texto leva só o primeiro nome do cliente. Não leva endereço nem documentos.');
    expect(TEXTOS.nadaEncontrado).toBe('Nada encontrado para “{texto}”.');
    expect(TEXTOS.adicionarLivre).toBe('Adicionar “{texto}” como material');
    expect(TEXTOS.amiantoObs).toBe('Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.');
  });

  it('os textos são exatamente os da tabela 9.1 do plano', () => {
    const exatos: Record<string, string> = {
      titulo: 'Lista de compras',
      apoioPublica: 'Anote o que precisa comprar ou providenciar. Quem abrir o link ou o PDF vê esta lista. Ela não traz preços.',
      apoioPrivada: 'Anote o que precisa comprar ou providenciar. Esta lista fica só aqui no app.',
      interruptor: 'Mostrar no relatório do cliente',
      pilula: 'Compras {n}',
      pilulaAria: 'Ir para a lista de compras. {n} linhas.',
      salvo: 'Salvo.',
      salvando: 'Salvando.',
      semRede: 'Sem conexão. A lista segue nesta tela e será enviada quando a conexão voltar.',
      semRedeAviso: 'Não feche esta tela antes de aparecer Salvo.',
      redeVoltou: 'Conexão de volta. Enviando.',
      erroSalvar: 'Não consegui salvar a lista. Ela segue nesta tela. Tente de novo em instantes.',
      erroConcluir: 'Antes de concluir: a lista de compras não foi enviada. Ela segue nesta tela. Conclua quando a conexão voltar.',
      conflito: 'Esta vistoria foi concluída em outro aparelho. Reabra para editar a lista.',
      liberando: 'A lista de compras está sendo liberada.',
      vazioTitulo: 'Nada na lista ainda.',
      vazioDica: 'Marque Atenção ou Não conforme nos itens acima e as sugestões aparecem aqui.',
      vazioComSugestoes: 'Há {n} sugestões pelos itens marcados.',
      vazioComSugestao: 'Há 1 sugestão pelos itens marcados.',
      sugeridosTitulo: 'Sugeridos pelos itens marcados',
      verTodas: 'Ver todas ({n})',
      dispensar: 'Dispensar',
      dispensarAria: 'Dispensar a sugestão {nome}',
      naLista: 'Na lista ({n})',
      resumoLista: '{m} materiais, {s} serviços e {o} observações.',
      btnAdicionar: 'Adicionar material',
      btnObservacao: 'Anotar observação',
      btnWhatsapp: 'Copiar para o WhatsApp',
      dicaSemMaterial: 'Adicione um material para gerar o texto.',
      limite: 'A lista chegou a 60 linhas. Apague alguma para continuar.',
      faixaSo: 'Sugestões de compra: {n}',
      faixaAmbas: 'Na lista: {a}. Sugestões: {n}',
      faixaLista: 'Na lista: {a}',
      folhaGeral: 'Adicionar à lista',
      folhaItem: '{Item}: {Status}',
      buscarBotao: 'Buscar material',
      buscarPlaceholder: 'Buscar material. Exemplo: haste, cabo, eletroduto',
      buscarAria: 'Buscar material',
      recentes: 'Usados por último',
      categorias: 'Por categoria',
      comuns: 'Comuns em toda instalação',
      nadaEncontrado: 'Nada encontrado para “{texto}”.',
      adicionarLivre: 'Adicionar “{texto}” como material',
      adicionar: 'Adicionar',
      adicionarSugeridas: 'Adicionar as sugeridas ({n})',
      escolhaTelha: 'Escolha a que combina com o telhado',
      seForLaje: 'Se for laje',
      mostrarMais: 'Mostrar mais {n}',
      obsProntas: 'Observações prontas',
      pronto: 'Pronto',
      prontoN: 'Pronto, {n} na lista',
      motivo: '{Item} · {Status}',
      diminuirAria: 'Diminuir a quantidade de {nome}',
      aumentarAria: 'Aumentar a quantidade de {nome}',
      numeroAria: 'Quantidade de {nome}: {n}. Toque para digitar.',
      apagarAria: 'Apagar {nome}',
      editarAria: 'Editar {nome}',
      faltaQtd: 'Falta a quantidade',
      informarQtd: 'Informar quantidade',
      formLivre: 'Material fora da lista',
      editarLinha: 'Editar linha',
      anotar: 'Anotar observação',
      rotNome: 'Nome do material',
      rotEsp: 'Especificação (vai para o fornecedor)',
      rotQtd: 'Quantidade',
      rotUn: 'Unidade',
      rotQuem: 'Quem providencia',
      rotNota: 'Nota (aparece só no relatório)',
      rotItem: 'Sobre qual item? (opcional)',
      phNome: 'Exemplo: haste de aterramento',
      phEsp: 'Exemplo: aço cobreado, modelo aprovado pela distribuidora',
      phNota: 'Exemplo: do telhado até o inversor',
      phObs: 'Escreva ou use o microfone do teclado.',
      btnAddLista: 'Adicionar à lista',
      salvar: 'Salvar',
      apagarLinha: 'Apagar linha',
      cancelar: 'Cancelar',
      contador: '{n} de {max}',
      adicionado: 'Adicionado à lista.',
      lote: '{n} sugestões adicionadas.',
      notaAdd: 'Observação adicionada.',
      apagada: 'Linha apagada.',
      desfazer: 'Desfazer',
      jaEsta: 'Já está na lista.',
      jaEstava: 'Já estava na lista.',
      nomeVazio: 'Digite o nome do material.',
      qtdInvalida: 'Informe uma quantidade maior que zero.',
      amiantoAviso: 'Telha de fibrocimento antiga pode ter amianto. Não fure nem corte sem confirmar a idade da telha.',
      amiantoObs: 'Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.',
      abaForn: 'Para o fornecedor',
      abaCli: 'Para o cliente',
      copiarTexto: 'Copiar texto',
      abrirZap: 'Abrir no WhatsApp',
      copiou: 'Texto copiado.',
      naoCopiou: 'Não consegui copiar. Toque no texto, selecione e copie.',
      notaPrivacidade: 'O texto leva só o primeiro nome do cliente. Não leva endereço nem documentos.',
      notaLink: 'Mande este texto, não o link do relatório, para o fornecedor. O link mostra os documentos do cliente.',
      fora: 'Fora do texto: {x}.',
      incluiCombinar: 'Inclui {n} item a combinar.',
      incluiCombinarPlural: 'Inclui {n} itens a combinar.',
      naoIncluiCombinar: 'Não inclui {n} item a combinar.',
      naoIncluiCombinarPlural: 'Não inclui {n} itens a combinar.',
      faltaQtdN: 'Falta a quantidade em {n} item.',
      faltaQtdNPlural: 'Falta a quantidade em {n} itens.',
      semItemCliente: 'Não há item do cliente nesta lista.',
      listaLonga: 'A lista é longa. Use Copiar e cole no WhatsApp.',
      painelResumo: 'Lista de compras: {resumo}',
      painelPrivada: 'Esta lista não aparece no relatório.',
      avisoSemStatus: 'Faltam itens sem status: {lista}. Você pode concluir assim mesmo.',
    };
    for (const [chave, texto] of Object.entries(exatos)) expect(TEXTOS[chave], chave).toBe(texto);
    // As únicas chaves a mais são as formas que o plano não escreve por extenso.
    const extras = Object.keys(TEXTOS).filter((k) => !(k in exatos)).sort();
    expect(extras).toEqual(['loteUma']);
    expect(TEXTOS.loteUma).toBe('1 sugestão adicionada.');
  });

  it('as frases que o comprasPuro escreve sozinho são as mesmas dos textos', () => {
    const com = (modelo: string, n: number | string) => modelo.replace('{n}', String(n));
    // Amianto: a nota que nasce com a linha do catálogo.
    const kit = linhaDoCatalogo(entrada('kit-fixacao-fibrocimento'), { item: 'tipo_telha', agora: AGORA, id: novoId() }) as Linha;
    expect(kit.obs).toBe(TEXTOS.amiantoObs);

    // Fornecedor: fora, inclui a combinar, falta a quantidade (singular e plural).
    const um = textoFornecedor(estadoDe([
      material({ nome: 'Cabo solar', un: 'm', qtd: null, quem: 'a_definir' }),
      material({ nome: 'Poda', un: 'servico', quem: 'cliente' }),
    ]), { clienteNome: null });
    expect(um.avisos).toEqual([com(TEXTOS.incluiCombinar, 1), com(TEXTOS.faltaQtdN, 1)]);
    expect(um.fora).toBe(TEXTOS.fora.replace('{x}', '1 serviço'));

    const dois = textoFornecedor(estadoDe([
      material({ nome: 'Cabo solar', un: 'm', qtd: null, quem: 'a_definir' }),
      material({ nome: 'Conector', un: 'cj', qtd: null, quem: 'a_definir' }),
      material({ nome: 'Caixa de medição', quem: 'cliente' }),
      material({ nome: 'Disjuntor geral', quem: 'cliente' }),
    ]), { clienteNome: null });
    expect(dois.avisos).toEqual([com(TEXTOS.incluiCombinarPlural, 2), com(TEXTOS.faltaQtdNPlural, 2)]);
    expect(dois.fora).toBe(TEXTOS.fora.replace('{x}', '2 itens do cliente'));

    // Cliente: não inclui a combinar (singular e plural).
    const c1 = textoCliente(estadoDe([material({ nome: 'Caixa', quem: 'cliente' }), material({ nome: 'Cabo', quem: 'a_definir' })]), {}, { clienteNome: null, urlRelatorio: '', incluirLink: false });
    expect(c1.avisos).toEqual([com(TEXTOS.naoIncluiCombinar, 1)]);
    const c2 = textoCliente(estadoDe([material({ nome: 'Caixa', quem: 'cliente' }), material({ nome: 'Cabo', quem: 'a_definir' }), material({ nome: 'Eletroduto', quem: 'a_definir' })]), {}, { clienteNome: null, urlRelatorio: '', incluirLink: false });
    expect(c2.avisos).toEqual([com(TEXTOS.naoIncluiCombinarPlural, 2)]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Linhas novas
// ---------------------------------------------------------------------------------------------------------

describe('criarId', () => {
  it('casa ^[a-z0-9]{6,24}$ no uso normal e nos extremos', () => {
    expect(criarId()).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(0, () => 0)).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(1, () => 0.5)).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(1_730_210_591_000, Math.random)).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(8.64e15, () => 0.999999)).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(1e30, () => 0.1)).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(NaN, () => 0.1)).toMatch(/^[a-z0-9]{6,24}$/);
    expect(criarId(-5, () => 0.1)).toMatch(/^[a-z0-9]{6,24}$/);
  });

  it('é o tempo em base 36 mais 4 letras do sorteio', () => {
    expect(criarId(1_730_210_591_000, () => 0)).toBe((1_730_210_591_000).toString(36) + 'aaaa');
    expect(criarId(1_730_210_591_000, () => 0.999)).toBe((1_730_210_591_000).toString(36) + 'zzzz');
    const sorteio = [0.5 / 26, 1.5 / 26, 2.5 / 26, 25.5 / 26];
    let i = 0;
    expect(criarId(1_730_210_591_000, () => sorteio[i++])).toBe((1_730_210_591_000).toString(36) + 'abcz');
  });

  it('um sorteio que devolve 1 ou lixo não sai do alfabeto', () => {
    expect(criarId(1_730_210_591_000, () => 1)).toBe((1_730_210_591_000).toString(36) + 'zzzz');
    expect(criarId(1_730_210_591_000, () => NaN)).toBe((1_730_210_591_000).toString(36) + 'aaaa');
    expect(criarId(1_730_210_591_000, () => -3)).toBe((1_730_210_591_000).toString(36) + 'aaaa');
  });

  it('o id passa na normalização da linha', () => {
    const l = linhaNota({ obs: 'Teste' }, { agora: AGORA, id: criarId() }) as Linha;
    expect(normalizarLinha(l)).toStrictEqual(l);
  });
});

describe('linhaDoCatalogo', () => {
  const nasce = (cid: string, item?: string) => linhaDoCatalogo(entrada(cid), { item, agora: AGORA, id: 'abc12345' }) as Linha;

  it('copia nome, especificação, unidade, quem e cid; o item é o do contexto; ts é agora', () => {
    const e = entrada('cabo-solar-cc');
    const l = nasce('cabo-solar-cc', 'cabeamento');
    expect(l).toEqual({ id: 'abc12345', tipo: 'material', nome: e.nome, esp: e.esp, qtd: null, un: 'm', quem: 'integrador', item: 'cabeamento', cid: 'cabo-solar-cc', obs: '', ts: AGORA });
  });

  it('sem item no contexto, a linha não leva a chave item', () => {
    expect(Object.keys(nasce('cabo-solar-cc'))).not.toContain('item');
  });

  it('unidade e conjunto nascem com 1; metro, barra e peça nascem a definir; serviço sempre a definir', () => {
    expect(nasce('caixa-medicao').qtd).toBe(1);
    expect(nasce('conector-cc').qtd).toBe(1);
    expect(nasce('cabo-solar-cc').qtd).toBeNull();
    expect(nasce('eletroduto-pvc-uv').qtd).toBeNull();
    expect(nasce('gancho-telha-ceramica').qtd).toBeNull();
    expect(nasce('poda-remocao-arvore').qtd).toBeNull();
    expect(nasce('poda-remocao-arvore').un).toBe('servico');
  });

  it('a entrada com aviso de amianto nasce com a nota pronta; as outras nascem sem nota', () => {
    const nota = 'Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.';
    expect(nasce('kit-fixacao-fibrocimento', 'tipo_telha').obs).toBe(nota);
    expect(nasce('remocao-telhado-amianto', 'tipo_telha').obs).toBe(nota);
    for (const e of CATALOGO.filter((x) => !x.aviso)) expect(nasce(e.cid).obs, e.cid).toBe('');
  });
});

describe('linhaLivre e linhaNota', () => {
  it('linhaLivre limpa o texto, não leva cid e deixa serviço sem quantidade', () => {
    const l = linhaLivre({ nome: `  haste ${SOL}  de   terra `, esp: 'aço cobreado', qtd: 2, un: 'un', quem: 'cliente', item: 'padrao', obs: 'nota' }, { agora: AGORA, id: 'abc12345' }) as Linha;
    expect(l).toEqual({ id: 'abc12345', tipo: 'material', nome: 'Haste de terra', esp: 'Aço cobreado', qtd: 2, un: 'un', quem: 'cliente', item: 'padrao', obs: 'Nota', ts: AGORA });
    expect(Object.keys(l)).not.toContain('cid');
    const s = linhaLivre({ nome: 'Poda de árvore', qtd: 5, un: 'servico', quem: 'cliente' }, { agora: AGORA, id: 'abc12346' }) as Linha;
    expect(s.qtd).toBeNull();
    expect(s.obs).toBe('');
  });

  it('linhaLivre com quantidade ruim vira a definir', () => {
    expect((linhaLivre({ nome: 'Cabo', qtd: 0, un: 'm', quem: 'a_definir' }, { agora: AGORA, id: 'abc12345' }) as Linha).qtd).toBeNull();
    expect((linhaLivre({ nome: 'Cabo', qtd: 12.345, un: 'm', quem: 'a_definir' }, { agora: AGORA, id: 'abc12345' }) as Linha).qtd).toBe(12.35);
  });

  it('linhaNota não tem nome, quantidade, unidade nem quem', () => {
    const l = linhaNota({ obs: 'telha antiga', item: 'tipo_telha' }, { agora: AGORA, id: 'abc12345' }) as Linha;
    expect(l).toEqual({ id: 'abc12345', tipo: 'obs', item: 'tipo_telha', obs: 'Telha antiga', ts: AGORA });
    const sem = linhaNota({ obs: 'Só o texto' }, { agora: AGORA, id: 'abc12346' }) as Linha;
    expect(Object.keys(sem).sort()).toEqual(['id', 'obs', 'tipo', 'ts']);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Operações na lista
// ---------------------------------------------------------------------------------------------------------

describe('adicionarLinha', () => {
  it('põe a linha no fim e devolve uma lista nova, sem mexer na antiga', () => {
    const antes = estadoDe([material({ nome: 'Haste de aterramento', id: 'primeira01' })], false);
    const foto = JSON.stringify(antes);
    const r = adicionarLinha(antes, doCatalogo('caixa-medicao'));
    expect(r.resultado).toBe('adicionada');
    expect(r.estado.linhas).toHaveLength(2);
    expect(r.estado.linhas[1].cid).toBe('caixa-medicao');
    expect(r.estado.publica).toBe(false);
    expect(r.estado).not.toBe(antes);
    expect(JSON.stringify(antes)).toBe(foto);
  });

  it('cheia em 60 linhas, e a lista não muda', () => {
    const c = cheia();
    const r = adicionarLinha(c, doCatalogo('caixa-medicao'));
    expect(r.resultado).toBe('cheia');
    expect(r.estado).toBe(c);
    const quase = estadoDe(c.linhas.slice(0, 59));
    expect(adicionarLinha(quase, doCatalogo('caixa-medicao')).resultado).toBe('adicionada');
    expect(adicionarLinha(quase, doCatalogo('caixa-medicao')).estado.linhas).toHaveLength(60);
  });

  it('duplicada pelo cid, e a lista não muda', () => {
    const c = estadoDe([doCatalogo('caixa-medicao')]);
    const r = adicionarLinha(c, doCatalogo('caixa-medicao', { nome: 'Outro nome', quem: 'integrador' }));
    expect(r.resultado).toBe('duplicada');
    expect(r.estado).toBe(c);
  });

  it('duplicada pelo nome sem acento, mesma unidade e mesmo quem (linha sem cid)', () => {
    const c = estadoDe([material({ nome: 'Caixa de medição', un: 'un', quem: 'cliente' })]);
    expect(adicionarLinha(c, material({ nome: 'caixa de MEDICAO', un: 'un', quem: 'cliente' })).resultado).toBe('duplicada');
    expect(adicionarLinha(c, material({ nome: '  Caixa   de medicao ', un: 'un', quem: 'cliente' })).resultado).toBe('duplicada');
    expect(adicionarLinha(c, material({ nome: 'Caixa de medição', un: 'cj', quem: 'cliente' })).resultado).toBe('adicionada');
    expect(adicionarLinha(c, material({ nome: 'Caixa de medição', un: 'un', quem: 'integrador' })).resultado).toBe('adicionada');
    expect(adicionarLinha(c, material({ nome: 'Caixa de passagem', un: 'un', quem: 'cliente' })).resultado).toBe('adicionada');
  });

  it('linha de catálogo com cid novo não é duplicada só porque o nome parece', () => {
    const c = estadoDe([material({ nome: 'Cabo solar CC', un: 'm', quem: 'integrador' })]);
    expect(adicionarLinha(c, doCatalogo('cabo-solar-cc')).resultado).toBe('adicionada');
  });

  it('duas observações diferentes não se confundem; a mesma observação no mesmo item é duplicada', () => {
    const c = estadoDe([nota('Telha antiga, pode ter amianto.', { item: 'tipo_telha' })]);
    expect(adicionarLinha(c, nota('Madeiramento com cupim.', { item: 'estrutura' })).resultado).toBe('adicionada');
    expect(adicionarLinha(c, nota('Madeiramento com cupim.')).resultado).toBe('adicionada');
    expect(adicionarLinha(c, nota('telha antiga, pode ter AMIANTO.', { item: 'tipo_telha' })).resultado).toBe('duplicada');
    expect(adicionarLinha(c, nota('Telha antiga, pode ter amianto.', { item: 'telhado' })).resultado).toBe('adicionada');
    expect(adicionarLinha(c, material({ nome: 'Telha antiga' })).resultado).toBe('adicionada');
  });

  it('id repetido é duplicada', () => {
    const c = estadoDe([material({ id: 'igual0001', nome: 'Haste de aterramento' })]);
    expect(adicionarLinha(c, material({ id: 'igual0001', nome: 'Outra coisa' })).resultado).toBe('duplicada');
  });

  it('linha que não passa na normalização é invalida e não entra', () => {
    const c = estadoDe([]);
    expect(adicionarLinha(c, material({ nome: 'a' })).resultado).toBe('invalida');
    expect(adicionarLinha(c, material({ id: 'ABC' })).resultado).toBe('invalida');
    expect(adicionarLinha(c, nota('   ')).resultado).toBe('invalida');
    expect(adicionarLinha(c, material({ nome: 'a' })).estado).toBe(c);
  });

  it('a linha que entra já vem normalizada', () => {
    const r = adicionarLinha(estadoDe([]), material({ nome: `  haste  ${SOL} `, qtd: 2.499, obs: '  nota  ' }));
    expect(r.estado.linhas[0].nome).toBe('Haste');
    expect(r.estado.linhas[0].qtd).toBe(2.5);
    expect(r.estado.linhas[0].obs).toBe('Nota');
  });
});

describe('removerLinha e restaurarLinha', () => {
  const tres = () => estadoDe([material({ id: 'um000001', nome: 'Primeiro' }), material({ id: 'dois0002', nome: 'Segundo' }), material({ id: 'tres003', nome: 'Terceiro' })], false);

  it('remove pela id e devolve a linha e a posição', () => {
    const c = tres();
    const r = removerLinha(c, 'dois0002');
    expect(r.estado.linhas.map((l: Linha) => l.id)).toEqual(['um000001', 'tres003']);
    expect(r.removida.linha.nome).toBe('Segundo');
    expect(r.removida.indice).toBe(1);
    expect(r.estado.publica).toBe(false);
    expect(c.linhas).toHaveLength(3);
  });

  it('id que não existe não muda nada', () => {
    const c = tres();
    const r = removerLinha(c, 'nao-existe');
    expect(r.estado).toBe(c);
    expect(r.removida).toBeUndefined();
  });

  it('o desfazer devolve a linha ao lugar de antes', () => {
    const c = tres();
    const r = removerLinha(c, 'um000001');
    const volta = restaurarLinha(r.estado, r.removida.linha, r.removida.indice);
    expect(volta).toEqual(c);
    const meio = removerLinha(c, 'dois0002');
    expect(restaurarLinha(meio.estado, meio.removida.linha, meio.removida.indice)).toEqual(c);
  });

  it('posição além do fim vai para o fim; posição negativa vai para o começo', () => {
    const c = tres();
    const r = removerLinha(c, 'um000001');
    expect(restaurarLinha(r.estado, r.removida.linha, 99).linhas.map((l: Linha) => l.id)).toEqual(['dois0002', 'tres003', 'um000001']);
    expect(restaurarLinha(r.estado, r.removida.linha, -4).linhas.map((l: Linha) => l.id)).toEqual(['um000001', 'dois0002', 'tres003']);
  });

  it('não restaura linha que já voltou, nem passa de 60', () => {
    const c = tres();
    const r = removerLinha(c, 'um000001');
    const uma = restaurarLinha(r.estado, r.removida.linha, 0);
    expect(restaurarLinha(uma, r.removida.linha, 0)).toBe(uma);
    const lotada = cheia();
    expect(restaurarLinha(lotada, material({ id: 'extra0001' }), 0)).toBe(lotada);
  });
});

describe('atualizarLinha', () => {
  it('muda os campos, normaliza e põe o ts de agora; o id e o tipo não mudam', () => {
    const c = estadoDe([material({ id: 'cabo0001', nome: 'Cabo solar', un: 'm', qtd: null, ts: '2026-01-01T00:00:00.000Z' })]);
    const novo = atualizarLinha(c, 'cabo0001', { qtd: 120.456, nome: '  cabo solar cc ', id: 'trocado01', tipo: 'obs' }, AGORA);
    const l = novo.linhas[0];
    expect(l.id).toBe('cabo0001');
    expect(l.tipo).toBe('material');
    expect(l.nome).toBe('Cabo solar cc');
    expect(l.qtd).toBe(120.46);
    expect(l.ts).toBe(AGORA);
    expect(c.linhas[0].qtd).toBeNull();
  });

  it('um patch que deixa a linha inválida não apaga nada', () => {
    const c = estadoDe([material({ id: 'cabo0001', nome: 'Cabo solar' })]);
    expect(atualizarLinha(c, 'cabo0001', { nome: '' }, AGORA)).toBe(c);
    expect(atualizarLinha(c, 'cabo0001', { nome: 'x' }, AGORA)).toBe(c);
  });

  it('id que não existe devolve a mesma lista', () => {
    const c = estadoDe([material({ id: 'cabo0001' })]);
    expect(atualizarLinha(c, 'outro', { qtd: 3 }, AGORA)).toBe(c);
  });

  it('item undefined tira o vínculo; unidade serviço zera a quantidade', () => {
    const c = estadoDe([material({ id: 'cabo0001', nome: 'Poda', item: 'sombreamento', qtd: 3, un: 'm' })]);
    const sem = atualizarLinha(c, 'cabo0001', { item: undefined }, AGORA).linhas[0];
    expect(Object.keys(sem)).not.toContain('item');
    const servico = atualizarLinha(c, 'cabo0001', { un: 'servico' }, AGORA).linhas[0];
    expect(servico.qtd).toBeNull();
  });

  it('observação muda o texto', () => {
    const c = estadoDe([nota('Primeira', { id: 'nota0001' })]);
    expect(atualizarLinha(c, 'nota0001', { obs: 'segunda versão' }, AGORA).linhas[0].obs).toBe('Segunda versão');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Sugestões
// ---------------------------------------------------------------------------------------------------------

describe('sugerir', () => {
  const cids = (grupos: Grupo[]) => grupos.flatMap((g) => g.entradas.map((x) => x.entrada.cid));

  it('Padrão Não conforme: caixa, cabo do ramal, haste e adequação (peso 1) vêm antes das de peso 2', () => {
    const grupos = sugerir(CATALOGO, { padrao: 'nao_conforme' }, [], []) as Grupo[];
    expect(grupos).toHaveLength(1);
    const g = grupos[0];
    expect(g.item).toBe('padrao');
    expect(g.status).toBe('nao_conforme');
    const pesos = g.entradas.map((x) => x.peso);
    expect(pesos).toEqual([...pesos].sort((a, b) => a - b));
    const peso1 = g.entradas.filter((x) => x.peso === 1).map((x) => x.entrada.cid);
    expect(new Set(peso1)).toEqual(new Set(['caixa-medicao', 'cabo-ramal-entrada', 'haste-aterramento', 'adequacao-padrao-eletricista']));
    expect(g.entradas.slice(0, 4).every((x) => x.peso === 1)).toBe(true);
    expect(g.entradas.slice(4).every((x) => x.peso === 2)).toBe(true);
  });

  it('dentro do mesmo peso, a ordem é a do catálogo', () => {
    const g = (sugerir(CATALOGO, { padrao: 'nao_conforme' }, [], []) as Grupo[])[0];
    const posicao = (cid: string) => CATALOGO.findIndex((e) => e.cid === cid);
    for (const peso of [1, 2]) {
      const dosPeso = g.entradas.filter((x) => x.peso === peso).map((x) => posicao(x.entrada.cid));
      expect(dosPeso).toEqual([...dosPeso].sort((a, b) => a - b));
    }
  });

  it('o peso é o do gatilho que casa com o status (o mesmo item pode pesar diferente em Atenção e em Não conforme)', () => {
    const naoConforme = (sugerir(CATALOGO, { padrao: 'nao_conforme' }, [], []) as Grupo[])[0].entradas;
    const atencao = (sugerir(CATALOGO, { padrao: 'atencao' }, [], []) as Grupo[])[0].entradas;
    expect(naoConforme.find((x) => x.entrada.cid === 'eletroduto-ramal-entrada')!.peso).toBe(2);
    expect(atencao.find((x) => x.entrada.cid === 'eletroduto-ramal-entrada')!.peso).toBe(1);
    expect(atencao.map((x) => x.entrada.cid)).not.toContain('caixa-medicao');
  });

  it('Tipo de telha em Atenção não duplica o que já saiu em outro grupo', () => {
    const grupos = sugerir(CATALOGO, { telhado: 'atencao', tipo_telha: 'atencao' }, [], []) as Grupo[];
    expect(grupos.map((g) => g.item)).toEqual(['telhado', 'tipo_telha']);
    const todos = cids(grupos);
    expect(new Set(todos).size).toBe(todos.length);
    const doTelhado = grupos[0].entradas.map((x) => x.entrada.cid);
    const doTipoTelha = grupos[1].entradas.map((x) => x.entrada.cid);
    for (const cid of ['selante-fita-telhado', 'telha-reposicao', 'troca-telhas-retelhamento']) {
      expect(doTelhado).toContain(cid);
      expect(doTipoTelha).not.toContain(cid);
    }
    expect(doTipoTelha).toContain('gancho-telha-ceramica');
  });

  it('a entrada fica no grupo do status mais grave, mesmo que o item venha depois no checklist', () => {
    const grupos = sugerir(CATALOGO, { padrao: 'atencao', haste: 'x', telhado: 'nao_conforme', estrutura: 'atencao' } as never, [], []) as Grupo[];
    expect(grupos.map((g) => g.item)).toEqual(['telhado', 'padrao', 'estrutura']);
    const doTelhado = grupos[0].entradas.map((x) => x.entrada.cid);
    expect(doTelhado).toContain('reforco-madeiramento');
    expect(grupos[2].entradas.map((x) => x.entrada.cid)).not.toContain('reforco-madeiramento');
  });

  it('os Não conforme vêm antes dos Atenção; cada bloco na ordem do checklist; e sempre é subsequência do checklist', () => {
    const grupos = sugerir(CATALOGO, { sombreamento: 'nao_conforme', padrao: 'atencao', telhado: 'nao_conforme', quadro_distribuicao: 'atencao' }, [], []) as Grupo[];
    expect(grupos.map((g) => `${g.item}:${g.status}`)).toEqual([
      'telhado:nao_conforme', 'sombreamento:nao_conforme', 'padrao:atencao', 'quadro_distribuicao:atencao',
    ]);
    const tudoNc: Record<string, string> = {};
    for (const k of ITENS_COM_STATUS) tudoNc[k] = 'nao_conforme';
    const ordem = (sugerir(CATALOGO, tudoNc, [], []) as Grupo[]).map((g) => ITENS_COM_STATUS.indexOf(g.item));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  });

  it('conforme, N/A e item sem status não sugerem nada', () => {
    expect(sugerir(CATALOGO, { padrao: 'conforme', telhado: 'na', quadro_distribuicao: undefined }, [], [])).toEqual([]);
    expect(sugerir(CATALOGO, {}, [], [])).toEqual([]);
    expect(sugerir(CATALOGO, null as never, [], [])).toEqual([]);
  });

  it('conta de luz e documento não têm status, então nunca disparam', () => {
    expect(sugerir(CATALOGO, { conta_luz: 'nao_conforme', documento_pessoal: 'atencao' } as never, [], [])).toEqual([]);
  });

  it('entrada cujo cid já está na lista não aparece', () => {
    const linhas = [doCatalogo('caixa-medicao')];
    const todos = cids(sugerir(CATALOGO, { padrao: 'nao_conforme' }, linhas, []) as Grupo[]);
    expect(todos).not.toContain('caixa-medicao');
    expect(todos).toContain('cabo-ramal-entrada');
  });

  it('entrada dispensada não aparece (lista ou conjunto)', () => {
    expect(cids(sugerir(CATALOGO, { padrao: 'nao_conforme' }, [], ['haste-aterramento']) as Grupo[])).not.toContain('haste-aterramento');
    expect(cids(sugerir(CATALOGO, { padrao: 'nao_conforme' }, [], new Set(['haste-aterramento'])) as Grupo[])).not.toContain('haste-aterramento');
  });

  it('grupo que ficou sem entrada some', () => {
    const tudo = (sugerir(CATALOGO, { sombreamento: 'nao_conforme' }, [], []) as Grupo[])[0].entradas.map((x) => x.entrada.cid);
    expect(sugerir(CATALOGO, { sombreamento: 'nao_conforme' }, [], tudo)).toEqual([]);
  });

  it('`sempre` nunca aparece em sugerir, nem se tiver gatilho', () => {
    const sempre = new Set(CATALOGO.filter((e) => e.sempre).map((e) => e.cid));
    const tudoNc: Record<string, string> = {};
    for (const k of ITENS_COM_STATUS) tudoNc[k] = 'nao_conforme';
    const todos = [...cids(sugerir(CATALOGO, tudoNc, [], []) as Grupo[]), ...cids(sugerir(CATALOGO, Object.fromEntries(ITENS_COM_STATUS.map((k) => [k, 'atencao'])), [], []) as Grupo[])];
    expect(todos.length).toBeGreaterThan(20);
    for (const cid of todos) expect(sempre.has(cid), cid).toBe(false);

    const sintetico: Entrada[] = [
      { cid: 'so-sempre', nome: 'So sempre', cat: 'x', un: 'un', quem: 'cliente', esp: 'e', sempre: true, gatilhos: [{ item: 'padrao', quando: 'N', peso: 1 }] },
      { cid: 'normal', nome: 'Normal', cat: 'x', un: 'un', quem: 'cliente', esp: 'e', gatilhos: [{ item: 'padrao', quando: 'N', peso: 1 }] },
    ];
    expect(cids(sugerir(sintetico, { padrao: 'nao_conforme' }, [], []) as Grupo[])).toEqual(['normal']);
  });

  it('as alternativas vêm separadas: depois das principais do grupo, telha antes de laje', () => {
    const grupo = (sugerir(CATALOGO, { tipo_telha: 'atencao' }, [], []) as Grupo[])[0];
    const primeiraAlternativa = grupo.entradas.findIndex((x) => x.entrada.alternativa);
    expect(primeiraAlternativa).toBeGreaterThan(0);
    expect(grupo.entradas.slice(0, primeiraAlternativa).every((x) => !x.entrada.alternativa)).toBe(true);
    expect(grupo.entradas.slice(primeiraAlternativa).every((x) => x.entrada.alternativa === 'telha')).toBe(true);
    expect(grupo.entradas.slice(primeiraAlternativa)).toHaveLength(4);

    const g = (id: string, alternativa?: string, peso = 1): Entrada => ({
      cid: id, nome: id.toUpperCase(), cat: 'x', un: 'un', quem: 'cliente', esp: 'e', ...(alternativa ? { alternativa } : {}),
      gatilhos: [{ item: 'telhado', quando: 'AN', peso }],
    });
    const mistura = [g('laje-um', 'laje'), g('principal-peso3', undefined, 3), g('telha-um', 'telha'), g('principal-peso1'), g('telha-dois', 'telha', 1)];
    expect(cids(sugerir(mistura, { telhado: 'atencao' }, [], []) as Grupo[])).toEqual([
      'principal-peso1', 'principal-peso3', 'telha-um', 'telha-dois', 'laje-um',
    ]);
  });

  it('não muda o que recebe', () => {
    const status = { padrao: 'nao_conforme' };
    const linhas = [doCatalogo('caixa-medicao')];
    const dispensadas = ['haste-aterramento'];
    const f = JSON.stringify([status, linhas, dispensadas]);
    sugerir(CATALOGO, status, linhas, dispensadas);
    expect(JSON.stringify([status, linhas, dispensadas])).toBe(f);
  });
});

describe('contagemPorItem', () => {
  it('Telhado em Atenção conta as 12 entradas que ele dispara, inclusive as alternativas', () => {
    const c = contagemPorItem(CATALOGO, { telhado: 'atencao' }, [], []);
    expect(c).toEqual({ telhado: 12 });
  });

  it('conta também o que já aparece em outro grupo', () => {
    const status = { telhado: 'atencao', tipo_telha: 'atencao' };
    const c = contagemPorItem(CATALOGO, status, [], []) as Record<string, number>;
    expect(c.telhado).toBe(12);
    expect(c.tipo_telha).toBe(8);
    const grupos = sugerir(CATALOGO, status, [], []) as Grupo[];
    expect(grupos[1].entradas.length).toBeLessThan(c.tipo_telha);
  });

  it('com um item só, a contagem é o tamanho do grupo de sugerir', () => {
    for (const item of ITENS_COM_STATUS) {
      for (const status of ['atencao', 'nao_conforme']) {
        const grupos = sugerir(CATALOGO, { [item]: status }, [], []) as Grupo[];
        const n = contagemPorItem(CATALOGO, { [item]: status }, [], [])[item];
        expect(n, `${item} ${status}`).toBe(grupos.length ? grupos[0].entradas.length : 0);
      }
    }
  });

  it('desconta o que já está na lista e o que foi dispensado', () => {
    const linhas = [doCatalogo('selante-fita-telhado')];
    expect(contagemPorItem(CATALOGO, { telhado: 'atencao' }, linhas, [])).toEqual({ telhado: 11 });
    expect(contagemPorItem(CATALOGO, { telhado: 'atencao' }, linhas, ['telha-reposicao'])).toEqual({ telhado: 10 });
    expect(contagemPorItem(CATALOGO, { telhado: 'atencao' }, linhas, new Set(['telha-reposicao']))).toEqual({ telhado: 10 });
  });

  it('só tem chave para item Atenção ou Não conforme, na ordem do checklist (Não conforme primeiro)', () => {
    expect(contagemPorItem(CATALOGO, { padrao: 'conforme', telhado: 'na', medidor: undefined }, [], [])).toEqual({});
    const tudo: Record<string, string> = {};
    for (const k of ITENS_COM_STATUS) tudo[k] = 'atencao';
    expect(Object.keys(contagemPorItem(CATALOGO, tudo, [], []))).toEqual(ITENS_COM_STATUS);
  });

  it('item marcado sem nada pendente fica com 0', () => {
    expect(contagemPorItem(CATALOGO, { medidor: 'atencao' }, [], [])).toEqual({ medidor: 0 });
  });
});

describe('sugestoesDoItem', () => {
  const cidsDe = (xs: Sugerida[]) => xs.map((x) => x.entrada.cid);

  it('Telhado em Atenção: 10 principais e as 2 de laje à parte, por peso', () => {
    const r = sugestoesDoItem(CATALOGO, 'telhado', { telhado: 'atencao' }, [], []);
    expect(r.principais).toHaveLength(10);
    expect(r.alternativas.map((a: { grupo: string }) => a.grupo)).toEqual(['laje']);
    expect(cidsDe(r.alternativas[0].entradas).sort()).toEqual(['estrutura-triangular-laje', 'sapata-concreto-laje']);
    const pesos = r.principais.map((x: Sugerida) => x.peso);
    expect(pesos).toEqual([...pesos].sort((a: number, b: number) => a - b));
  });

  it('Tipo de telha em Atenção: as 4 de telha à parte; a de amianto está entre elas', () => {
    const r = sugestoesDoItem(CATALOGO, 'tipo_telha', { tipo_telha: 'atencao' }, [], []);
    expect(r.alternativas.map((a: { grupo: string }) => a.grupo)).toEqual(['telha']);
    expect(cidsDe(r.alternativas[0].entradas)).toContain('kit-fixacao-fibrocimento');
    expect(r.alternativas[0].entradas).toHaveLength(4);
    expect(r.principais).toHaveLength(4);
    for (const x of r.principais as Sugerida[]) expect(x.entrada.alternativa).toBeUndefined();
  });

  it('não elimina o que outro grupo já mostrou (a folha do item mostra tudo o que o item dispara)', () => {
    const r = sugestoesDoItem(CATALOGO, 'tipo_telha', { telhado: 'atencao', tipo_telha: 'atencao' }, [], []);
    expect(cidsDe(r.principais)).toContain('selante-fita-telhado');
  });

  it('o total bate com a contagem do item', () => {
    const status = { telhado: 'atencao', padrao: 'nao_conforme' };
    for (const item of ['telhado', 'padrao']) {
      const r = sugestoesDoItem(CATALOGO, item, status, [], []);
      const total = r.principais.length + r.alternativas.reduce((s: number, a: { entradas: unknown[] }) => s + a.entradas.length, 0);
      expect(total).toBe(contagemPorItem(CATALOGO, status, [], [])[item]);
    }
  });

  it('é só o pendente: sai o que já está na lista e o que foi dispensado', () => {
    const r = sugestoesDoItem(CATALOGO, 'padrao', { padrao: 'nao_conforme' }, [doCatalogo('caixa-medicao')], ['haste-aterramento']);
    expect(cidsDe(r.principais)).not.toContain('caixa-medicao');
    expect(cidsDe(r.principais)).not.toContain('haste-aterramento');
    expect(cidsDe(r.principais)).toContain('cabo-ramal-entrada');
  });

  it('item que não está marcado Atenção nem Não conforme devolve tudo vazio', () => {
    const vazio = { principais: [], alternativas: [] };
    expect(sugestoesDoItem(CATALOGO, 'telhado', { telhado: 'conforme' }, [], [])).toEqual(vazio);
    expect(sugestoesDoItem(CATALOGO, 'telhado', {}, [], [])).toEqual(vazio);
    expect(sugestoesDoItem(CATALOGO, 'telhado', { padrao: 'nao_conforme' }, [], [])).toEqual(vazio);
    expect(sugestoesDoItem(CATALOGO, 'conta_luz', { conta_luz: 'atencao' } as never, [], [])).toEqual(vazio);
  });

  it('`sempre` nunca é sugestão do item', () => {
    const r = sugestoesDoItem(CATALOGO, 'estrutura', { estrutura: 'atencao' }, [], []);
    const todos = [...cidsDe(r.principais), ...r.alternativas.flatMap((a: { entradas: Sugerida[] }) => cidsDe(a.entradas))];
    const sempre = new Set(CATALOGO.filter((e) => e.sempre).map((e) => e.cid));
    for (const cid of todos) expect(sempre.has(cid), cid).toBe(false);
  });
});

describe('itemQueDispara', () => {
  it('devolve o item do status mais grave; empate, o primeiro do checklist', () => {
    const reforco = entrada('reforco-madeiramento');
    expect(itemQueDispara(reforco, { telhado: 'atencao', estrutura: 'nao_conforme' })).toBe('estrutura');
    expect(itemQueDispara(reforco, { telhado: 'nao_conforme', estrutura: 'atencao' })).toBe('telhado');
    expect(itemQueDispara(reforco, { telhado: 'atencao', estrutura: 'atencao' })).toBe('telhado');
    expect(itemQueDispara(reforco, { estrutura: 'atencao' })).toBe('estrutura');
  });

  it('respeita o `quando` do gatilho: só Atenção, só Não conforme ou os dois', () => {
    const selante = entrada('selante-fita-telhado');
    expect(itemQueDispara(selante, { telhado: 'atencao' })).toBe('telhado');
    expect(itemQueDispara(selante, { telhado: 'nao_conforme' })).toBeUndefined();
    const laudo = entrada('laudo-estrutural');
    expect(itemQueDispara(laudo, { telhado: 'atencao' })).toBeUndefined();
    expect(itemQueDispara(laudo, { telhado: 'nao_conforme' })).toBe('telhado');
  });

  it('item conforme, N/A, sem status ou de outra entrada não dispara', () => {
    const haste = entrada('haste-aterramento');
    expect(itemQueDispara(haste, { padrao: 'conforme' })).toBeUndefined();
    expect(itemQueDispara(haste, { padrao: 'na' })).toBeUndefined();
    expect(itemQueDispara(haste, {})).toBeUndefined();
    expect(itemQueDispara(haste, { telhado: 'atencao' })).toBeUndefined();
    expect(itemQueDispara(haste, null as never)).toBeUndefined();
  });

  it('entrada `sempre` nunca é disparada por item', () => {
    const tudo = Object.fromEntries(ITENS_COM_STATUS.map((k) => [k, 'nao_conforme']));
    for (const e of CATALOGO.filter((x) => x.sempre)) expect(itemQueDispara(e, tudo), e.cid).toBeUndefined();
  });

  it('bate com o grupo em que a entrada aparece em sugerir', () => {
    const cenarios: Record<string, string>[] = [
      { padrao: 'nao_conforme', telhado: 'atencao', estrutura: 'nao_conforme', sombreamento: 'atencao' },
      { telhado: 'atencao', tipo_telha: 'atencao' },
      Object.fromEntries(ITENS_COM_STATUS.map((k) => [k, 'atencao'])),
      Object.fromEntries(ITENS_COM_STATUS.map((k) => [k, 'nao_conforme'])),
    ];
    for (const status of cenarios) {
      const grupos = sugerir(CATALOGO, status, [], []) as Grupo[];
      expect(grupos.length).toBeGreaterThan(0);
      for (const g of grupos) for (const x of g.entradas) expect(itemQueDispara(x.entrada, status), x.entrada.cid).toBe(g.item);
    }
  });
});

describe('buscar', () => {
  it('texto vazio ou só espaço devolve lista vazia', () => {
    expect(buscar(CATALOGO, '')).toEqual([]);
    expect(buscar(CATALOGO, '   ')).toEqual([]);
    expect(buscar(CATALOGO, undefined as never)).toEqual([]);
  });

  it('acha pelo nome, ignorando acento e maiúscula', () => {
    expect(buscar(CATALOGO, 'haste').map((e: Entrada) => e.cid)[0]).toBe('haste-aterramento');
    expect(buscar(CATALOGO, 'HASTE').map((e: Entrada) => e.cid)[0]).toBe('haste-aterramento');
    expect(buscar(CATALOGO, 'caixa de medicao').map((e: Entrada) => e.cid)).toContain('caixa-medicao');
    expect(buscar(CATALOGO, 'distribuição').map((e: Entrada) => e.cid)).toEqual(buscar(CATALOGO, 'distribuicao').map((e: Entrada) => e.cid));
    expect(buscar(CATALOGO, 'protecao uv').map((e: Entrada) => e.cid)).toContain('eletroduto-pvc-uv');
  });

  it('acha pela especificação', () => {
    const achados = buscar(CATALOGO, 'aço cobreado').map((e: Entrada) => e.cid);
    expect(achados).toContain('haste-aterramento');
    const porEsp = buscar(CATALOGO, 'bidirecional').map((e: Entrada) => e.cid);
    expect(porEsp).toContain('caixa-medicao');
  });

  it('todas as palavras têm de aparecer, em qualquer ordem', () => {
    expect(buscar(CATALOGO, 'cabo cobre nu').map((e: Entrada) => e.cid)).toContain('cabo-cobre-nu-aterramento');
    expect(buscar(CATALOGO, 'nu cabo').map((e: Entrada) => e.cid)).toContain('cabo-cobre-nu-aterramento');
    expect(buscar(CATALOGO, 'haste zzzzzz')).toEqual([]);
  });

  it('quem casa no nome vem antes de quem casa só na especificação; cada bloco na ordem do catálogo', () => {
    const achados = buscar(CATALOGO, 'cabo') as Entrada[];
    const noNome = achados.filter((e) => e.nome.toLowerCase().includes('cabo'));
    const soEsp = achados.filter((e) => !e.nome.toLowerCase().includes('cabo'));
    expect(noNome.length).toBeGreaterThan(3);
    expect(soEsp.length).toBeGreaterThan(0);
    expect(achados).toEqual([...noNome, ...soEsp]);
    const posicao = (e: Entrada) => CATALOGO.indexOf(e);
    expect(noNome.map(posicao)).toEqual([...noNome.map(posicao)].sort((a, b) => a - b));
    expect(soEsp.map(posicao)).toEqual([...soEsp.map(posicao)].sort((a, b) => a - b));
  });

  it('a busca enxerga as entradas `sempre`', () => {
    expect(buscar(CATALOGO, 'perfil').map((e: Entrada) => e.cid)).toContain('perfil-aluminio');
    expect(buscar(CATALOGO, 'cabo solar').map((e: Entrada) => e.cid)).toContain('cabo-solar-cc');
  });

  it('nada encontrado devolve lista vazia', () => {
    expect(buscar(CATALOGO, 'xyzabc')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Texto para o WhatsApp
// ---------------------------------------------------------------------------------------------------------

describe('primeiroNome', () => {
  it('pega a primeira palavra', () => {
    expect(primeiroNome('Maria da Silva')).toBe('Maria');
    expect(primeiroNome('  joão   pedro ')).toBe('joão');
    expect(primeiroNome('Ana')).toBe('Ana');
  });

  it('nome todo em maiúsculas vira só com a inicial', () => {
    expect(primeiroNome('CARLOS ALBERTO SOUZA')).toBe('Carlos');
    expect(primeiroNome('JOÃO')).toBe('João');
    expect(primeiroNome('J. SILVA')).toBe('J.');
  });

  it('sem nome ou vistoria avulsa devolve vazio', () => {
    expect(primeiroNome(null)).toBe('');
    expect(primeiroNome(undefined)).toBe('');
    expect(primeiroNome('')).toBe('');
    expect(primeiroNome('   ')).toBe('');
    expect(primeiroNome('Vistoria avulsa')).toBe('');
    expect(primeiroNome('  VISTORIA  AVULSA ')).toBe('');
    expect(primeiroNome(42 as never)).toBe('');
  });

  it('sai limpo para o WhatsApp', () => {
    expect(primeiroNome('*Ana* Souza')).toBe('Ana');
    expect(primeiroNome('_Ana_')).toBe('Ana');
    expect(primeiroNome('~`Ana`~')).toBe('Ana');
    expect(primeiroNome(`${ROSTO}Ana`)).toBe('Ana');
    expect(primeiroNome(`Ana${TRAVESSAO_LONGO}Clara Souza`)).toBe('Ana-Clara');
  });
});

describe('textoFornecedor', () => {
  const ESPERADO = [
    'Olá, preciso de cotação dos materiais abaixo.',
    'Obra: Carlos',
    '',
    '1. Cabo solar CC: 120 metros',
    '   1,5 kV CC, cobre estanhado, dupla isolação, proteção UV, preto e vermelho.',
    '2. Conector CC macho e fêmea: 8 conjuntos',
    '   Mesmo fabricante nas duas metades, IP67, compatível com a seção do cabo e a tensão do arranjo.',
    '3. Eletroduto de PVC rígido com proteção UV: quantidade a confirmar',
    '   Roscável e antichama, preto com proteção UV quando exposto ao sol, barras de 3 m.',
    '4. Gancho para telha cerâmica: 24 peças',
    '   Inox ou galvanizado, preso no caibro ou na terça, nunca só na ripa.',
    '5. Telha de reposição: 10 unidades',
    '   Mesmo modelo, cor e dimensão da telha existente, com sobra para quebra.',
    '',
    'Total: 5 itens.',
    'Pode passar preço, prazo e disponibilidade?',
  ].join('\n');

  const exemplo = (): Estado => estadoDe([
    doCatalogo('cabo-solar-cc', { qtd: 120 }, 'cabeamento'),
    doCatalogo('conector-cc', { qtd: 8 }, 'cabeamento'),
    doCatalogo('eletroduto-pvc-uv', {}, 'cabeamento'),
    doCatalogo('gancho-telha-ceramica', { qtd: 24 }, 'tipo_telha'),
    doCatalogo('telha-reposicao', { qtd: 10 }, 'tipo_telha'),
  ]);

  it('o exemplo do plano bate caractere a caractere', () => {
    const r = textoFornecedor(exemplo(), { clienteNome: 'CARLOS ALBERTO SOUZA' });
    expect(r.texto).toBe(ESPERADO);
    expect(r.pode).toBe(true);
  });

  it('no exemplo: telha de reposição é a combinar e o eletroduto não tem quantidade', () => {
    const r = textoFornecedor(exemplo(), { clienteNome: 'CARLOS ALBERTO SOUZA' });
    expect(r.fora).toBe('');
    expect(r.avisos).toEqual(['Inclui 1 item a combinar.', 'Falta a quantidade em 1 item.']);
  });

  it('sem nome, a linha Obra some e o resto fica igual', () => {
    const r = textoFornecedor(exemplo(), { clienteNome: null });
    expect(r.texto).toBe(ESPERADO.replace('Obra: Carlos\n', ''));
    expect(r.texto.split('\n')[1]).toBe('');
    expect(textoFornecedor(exemplo(), { clienteNome: 'Vistoria avulsa' }).texto).toBe(r.texto);
  });

  it('não leva sobrenome, link, telefone nem o nome do item da vistoria', () => {
    const r = textoFornecedor(exemplo(), { clienteNome: 'CARLOS ALBERTO SOUZA' });
    expect(r.texto).not.toMatch(/Alberto|Souza|http|solardoc|cabeamento|Caminho do cabeamento|\d{8,}/i);
  });

  it('serviços, itens do cliente e observações ficam de fora; a especificação vai e a nota da linha não', () => {
    const c = estadoDe([
      material({ nome: 'Cabo solar', un: 'm', qtd: 10, quem: 'integrador', esp: 'Cobre estanhado', obs: 'NOTA SECRETA DA LINHA' }),
      material({ nome: 'Poda de árvore', un: 'servico', quem: 'cliente', esp: 'Poda por profissional' }),
      material({ nome: 'Instalação elétrica', un: 'servico', quem: 'integrador' }),
      material({ nome: 'Caixa de medição', quem: 'cliente', esp: 'Modelo aprovado' }),
      material({ nome: 'Disjuntor geral', quem: 'cliente' }),
      material({ nome: 'Haste de aterramento', quem: 'cliente' }),
      nota('Texto de uma observação qualquer.'),
    ]);
    const r = textoFornecedor(c, { clienteNome: 'Ana' });
    expect(r.texto).toBe([
      'Olá, preciso de cotação dos materiais abaixo.', 'Obra: Ana', '', '1. Cabo solar: 10 metros', '   Cobre estanhado', '',
      'Total: 1 item.', 'Pode passar preço, prazo e disponibilidade?',
    ].join('\n'));
    expect(r.texto).not.toMatch(/NOTA SECRETA|Poda|Caixa|Disjuntor|Haste|observação|Instalação elétrica/);
    expect(r.fora).toBe('Fora do texto: 2 serviços e 3 itens do cliente.');
    expect(r.avisos).toEqual([]);
  });

  it('o fora usa o singular e só as partes que existem', () => {
    const base = material({ nome: 'Cabo solar', un: 'm', qtd: 10, quem: 'integrador' });
    expect(textoFornecedor(estadoDe([base, material({ nome: 'Poda', un: 'servico' })]), { clienteNome: null }).fora).toBe('Fora do texto: 1 serviço.');
    expect(textoFornecedor(estadoDe([base, material({ nome: 'Caixa', quem: 'cliente' })]), { clienteNome: null }).fora).toBe('Fora do texto: 1 item do cliente.');
    expect(textoFornecedor(estadoDe([base, nota('Só uma nota.')]), { clienteNome: null }).fora).toBe('');
  });

  it('quantidade com vírgula, ponto de milhar e plural certo', () => {
    const c = estadoDe([
      material({ nome: 'Cabo A', un: 'm', qtd: 1200.5, quem: 'integrador' }),
      material({ nome: 'Cabo B', un: 'm', qtd: 1, quem: 'integrador' }),
      material({ nome: 'Cabo C', un: 'barra', qtd: 12.5, quem: 'integrador' }),
      material({ nome: 'Cabo D', un: 'pc', qtd: 1, quem: 'integrador' }),
    ]);
    const linhas = textoFornecedor(c, { clienteNome: null }).texto.split('\n');
    expect(linhas).toContain('1. Cabo A: 1.200,5 metros');
    expect(linhas).toContain('2. Cabo B: 1 metro');
    expect(linhas).toContain('3. Cabo C: 12,5 barras');
    expect(linhas).toContain('4. Cabo D: 1 peça');
  });

  it('remove asterisco, sublinhado, til e crase; asterisco entre dígitos vira x', () => {
    const c = estadoDe([material({
      nome: '*Cabo* _solar_ ~CC~ `4`', un: 'm', qtd: 3, quem: 'integrador', esp: 'bitola 4*6 mm e 2 * 3 ou 1*2*3',
    })]);
    const r = textoFornecedor(c, { clienteNome: '*Ana*_' });
    expect(r.texto).toContain('1. Cabo solar CC 4: 3 metros');
    expect(r.texto).toContain('   Bitola 4x6 mm e 2 x 3 ou 1x2x3');
    expect(r.texto).toContain('Obra: Ana');
    expect(r.texto).not.toMatch(/[*_~`]/);
  });

  it('o texto digitado com a primeira letra ao contrário volta maiúsculo depois da limpeza', () => {
    const c = estadoDe([material({ nome: '*cabo* solar', un: 'm', qtd: 3, quem: 'integrador' })]);
    expect(textoFornecedor(c, { clienteNome: null }).texto).toContain('1. Cabo solar: 3 metros');
  });

  it('Total no singular e no plural', () => {
    const um = textoFornecedor(estadoDe([material({ nome: 'Cabo solar', un: 'm', qtd: 3, quem: 'integrador' })]), { clienteNome: null });
    expect(um.texto).toContain('Total: 1 item.');
    const dois = textoFornecedor(estadoDe([
      material({ nome: 'Cabo solar', un: 'm', qtd: 3, quem: 'integrador' }),
      material({ nome: 'Conector', un: 'cj', qtd: 2, quem: 'a_definir' }),
    ]), { clienteNome: null });
    expect(dois.texto).toContain('Total: 2 itens.');
  });

  it('sem material elegível: pode é false e não há texto', () => {
    const vazio = textoFornecedor(estadoDe([]), { clienteNome: 'Ana' });
    expect(vazio).toEqual({ texto: '', pode: false, fora: '', avisos: [] });
    const soServico = textoFornecedor(estadoDe([material({ nome: 'Poda', un: 'servico' }), nota('Uma nota.')]), { clienteNome: 'Ana' });
    expect(soServico).toEqual({ texto: '', pode: false, fora: 'Fora do texto: 1 serviço.', avisos: [] });
    const soCliente = textoFornecedor(estadoDe([material({ nome: 'Caixa', quem: 'cliente' })]), { clienteNome: 'Ana' });
    expect(soCliente.pode).toBe(false);
    expect(soCliente.fora).toBe('Fora do texto: 1 item do cliente.');
  });

  it('não muda o que recebe e entradas estranhas não derrubam', () => {
    const c = exemplo();
    const foto = JSON.stringify(c);
    textoFornecedor(c, { clienteNome: 'Ana' });
    expect(JSON.stringify(c)).toBe(foto);
    expect(textoFornecedor(null as never, { clienteNome: null }).pode).toBe(false);
    expect(textoFornecedor({ publica: true } as never, { clienteNome: null }).pode).toBe(false);
  });

  it('nenhum texto gerado tem travessão, emoji ou nome da lista proibida', () => {
    const r = textoFornecedor(exemplo(), { clienteNome: 'CARLOS' });
    expect(r.texto).not.toMatch(TRAVESSOES);
    expect(r.texto).not.toMatch(EMOJI_TESTE);
    expect(r.texto).not.toMatch(PROIBIDO);
  });
});

describe('textoCliente', () => {
  const URL = 'https://solardoc.app/v/11111111-1111-4111-8111-111111111111';
  const ESPERADO = [
    'Olá, Maria. Na vistoria, vimos o que precisa ser providenciado para a instalação.',
    '',
    '*Antes de instalar*',
    '1. Caixa de medição: 1 unidade',
    '2. Disjuntor geral do padrão de entrada: 1 unidade',
    '',
    '*Antes ou durante a instalação*',
    '3. Poda ou remoção de árvore',
    '',
    'Os detalhes estão no relatório:',
    URL,
  ].join('\n');
  const STATUS = { padrao: 'nao_conforme', disjuntor_padrao: 'nao_conforme', sombreamento: 'atencao' };

  const exemplo = (): Estado => estadoDe([
    doCatalogo('caixa-medicao', {}, 'padrao'),
    doCatalogo('disjuntor-geral-padrao', {}, 'disjuntor_padrao'),
    doCatalogo('poda-remocao-arvore', {}, 'sombreamento'),
    doCatalogo('cabo-solar-cc', { qtd: 50 }, 'cabeamento'),
    nota('Uma nota que não vai.'),
  ]);

  it('o exemplo do plano bate caractere a caractere', () => {
    const r = textoCliente(exemplo(), STATUS, { clienteNome: 'Maria Souza', urlRelatorio: URL, incluirLink: true });
    expect(r.texto).toBe(ESPERADO);
    expect(r.pode).toBe(true);
    expect(r.fora).toBe('');
  });

  it('o item da empresa e a nota não entram, e o aviso não fala deles', () => {
    const r = textoCliente(exemplo(), STATUS, { clienteNome: 'Maria', urlRelatorio: URL, incluirLink: true });
    expect(r.texto).not.toMatch(/Cabo solar|nota que não vai/);
    expect(r.avisos).toEqual([]);
  });

  it('o prazo vem do status LOCAL: muda o status, muda o grupo', () => {
    const r = textoCliente(exemplo(), { padrao: 'atencao', disjuntor_padrao: 'conforme' }, { clienteNome: 'Maria', urlRelatorio: URL, incluirLink: true });
    expect(r.texto).toContain('*Antes ou durante a instalação*\n1. Caixa de medição: 1 unidade');
    expect(r.texto).toContain('*Demais itens*\n2. Disjuntor geral do padrão de entrada: 1 unidade\n3. Poda ou remoção de árvore');
    expect(r.texto).not.toContain('*Antes de instalar*');
  });

  it('sem nome a saudação é só "Olá."; nome em maiúsculas vira "Carlos"', () => {
    const sem = textoCliente(exemplo(), STATUS, { clienteNome: null, urlRelatorio: URL, incluirLink: true });
    expect(sem.texto.split('\n')[0]).toBe('Olá. Na vistoria, vimos o que precisa ser providenciado para a instalação.');
    const avulsa = textoCliente(exemplo(), STATUS, { clienteNome: 'Vistoria avulsa', urlRelatorio: URL, incluirLink: true });
    expect(avulsa.texto).toBe(sem.texto);
    const caixa = textoCliente(exemplo(), STATUS, { clienteNome: 'CARLOS ALBERTO', urlRelatorio: URL, incluirLink: true });
    expect(caixa.texto.split('\n')[0]).toBe('Olá, Carlos. Na vistoria, vimos o que precisa ser providenciado para a instalação.');
  });

  it('sem incluirLink a frase e o link saem, e o texto não termina com linha em branco', () => {
    const r = textoCliente(exemplo(), STATUS, { clienteNome: 'Maria', urlRelatorio: URL, incluirLink: false });
    expect(r.texto).toBe(ESPERADO.split('\n').slice(0, -3).join('\n'));
    expect(r.texto).not.toMatch(/Os detalhes|https/);
    expect(r.texto.endsWith('\n')).toBe(false);
    const semUrl = textoCliente(exemplo(), STATUS, { clienteNome: 'Maria', urlRelatorio: '', incluirLink: true });
    expect(semUrl.texto).toBe(r.texto);
  });

  it('itens a combinar ficam fora e o aviso conta quantos', () => {
    const c = estadoDe([
      material({ nome: 'Caixa de medição', quem: 'cliente' }),
      material({ nome: 'Barra de equipotencialização', quem: 'a_definir' }),
    ]);
    const um = textoCliente(c, {}, { clienteNome: null, urlRelatorio: URL, incluirLink: false });
    expect(um.texto).not.toContain('Barra');
    expect(um.avisos).toEqual(['Não inclui 1 item a combinar.']);
    const dois = textoCliente(estadoDe([...c.linhas, material({ nome: 'Quadro de distribuição', quem: 'a_definir' })]), {}, { clienteNome: null, urlRelatorio: URL, incluirLink: false });
    expect(dois.avisos).toEqual(['Não inclui 2 itens a combinar.']);
  });

  it('quantidade só quando existe; sem "a confirmar"; serviço sem quantidade; sem especificação e sem nota', () => {
    const c = estadoDe([
      material({ nome: 'Cabo de cobre nu', un: 'm', qtd: null, quem: 'cliente', esp: 'Cobre nu, sem emendas', obs: 'Do padrão à haste.' }),
      material({ nome: 'Haste de aterramento', un: 'un', qtd: 2, quem: 'cliente' }),
      material({ nome: 'Eletroduto', un: 'barra', qtd: 1.5, quem: 'cliente' }),
      material({ nome: 'Poda de árvore', un: 'servico', quem: 'cliente' }),
    ]);
    const r = textoCliente(c, {}, { clienteNome: null, urlRelatorio: URL, incluirLink: false });
    expect(r.texto).toContain('1. Cabo de cobre nu\n2. Haste de aterramento: 2 unidades\n3. Eletroduto: 1,5 barras\n4. Poda de árvore');
    expect(r.texto).not.toMatch(/confirmar|Cobre nu, sem|Do padrão/);
  });

  it('a numeração segue de um grupo para o outro, na ordem alta, média, demais', () => {
    const c = estadoDe([
      material({ nome: 'Sem prazo', quem: 'cliente', qtd: null }),
      material({ nome: 'Média um', quem: 'cliente', qtd: null, item: 'telhado' }),
      material({ nome: 'Alta um', quem: 'cliente', qtd: null, item: 'padrao' }),
      material({ nome: 'Média dois', quem: 'cliente', qtd: null, item: 'telhado' }),
    ]);
    const r = textoCliente(c, { padrao: 'nao_conforme', telhado: 'atencao' }, { clienteNome: null, urlRelatorio: URL, incluirLink: false });
    expect(r.texto).toBe([
      'Olá. Na vistoria, vimos o que precisa ser providenciado para a instalação.', '',
      '*Antes de instalar*', '1. Alta um', '',
      '*Antes ou durante a instalação*', '2. Média um', '3. Média dois', '',
      '*Demais itens*', '4. Sem prazo',
    ].join('\n'));
  });

  it('sem item do cliente: pode é false, sem texto', () => {
    const vazio = textoCliente(estadoDe([]), {}, { clienteNome: 'Ana', urlRelatorio: URL, incluirLink: true });
    expect(vazio).toEqual({ texto: '', pode: false, fora: '', avisos: [] });
    const soEmpresa = textoCliente(estadoDe([material({ nome: 'Cabo', quem: 'integrador' }), nota('Nota.')]), {}, { clienteNome: 'Ana', urlRelatorio: URL, incluirLink: true });
    expect(soEmpresa.pode).toBe(false);
    expect(soEmpresa.texto).toBe('');
    const soCombinar = textoCliente(estadoDe([material({ nome: 'Cabo', quem: 'a_definir' })]), {}, { clienteNome: 'Ana', urlRelatorio: URL, incluirLink: true });
    expect(soCombinar.pode).toBe(false);
    expect(soCombinar.avisos).toEqual(['Não inclui 1 item a combinar.']);
  });

  it('remove asterisco, sublinhado, til e crase do que o técnico digitou', () => {
    const c = estadoDe([material({ nome: '*Poda* de _árvore_ ~grande~ `x`', un: 'servico', quem: 'cliente' })]);
    const r = textoCliente(c, {}, { clienteNome: '~Ana~', urlRelatorio: URL, incluirLink: false });
    expect(r.texto).toContain('1. Poda de árvore grande x');
    expect(r.texto).toContain('Olá, Ana.');
    expect(r.texto.replace(/\*(Antes de instalar|Antes ou durante a instalação|Demais itens)\*/g, '')).not.toMatch(/[*_~`]/);
  });

  it('não muda o que recebe e entradas estranhas não derrubam', () => {
    const c = exemplo();
    const foto = JSON.stringify([c, STATUS]);
    textoCliente(c, STATUS, { clienteNome: 'Maria', urlRelatorio: URL, incluirLink: true });
    expect(JSON.stringify([c, STATUS])).toBe(foto);
    expect(textoCliente(null as never, null as never, { clienteNome: null, urlRelatorio: '', incluirLink: false }).pode).toBe(false);
  });

  it('nenhum texto gerado tem travessão, emoji ou nome da lista proibida', () => {
    const r = textoCliente(exemplo(), STATUS, { clienteNome: 'CARLOS', urlRelatorio: URL, incluirLink: true });
    expect(r.texto).not.toMatch(TRAVESSOES);
    expect(r.texto).not.toMatch(EMOJI_TESTE);
    expect(r.texto).not.toMatch(PROIBIDO);
  });
});
