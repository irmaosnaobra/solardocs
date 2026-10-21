// O ENSAIO NÃO FALA COM NINGUÉM. Este teste anda pelo grafo de imports (import, export ... from,
// import() e require) a partir do ensaio, do replay e de tudo que eles usam, e reprova se algum arquivo
// alcançar o envio. O controle positivo prova que o andador enxerga o zapiClient quando ele está lá.
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(__dirname, '..');
const A5040 = join(SRC, 'services', 'agentes5040');

const RAIZES = [
  'ensaio', 'replay', 'armazem', 'cota', 'ia', 'contexto', 'porteiro', 'turno', 'anuncioDoLead', 'interruptores',
  join('personas', 'index'),
].map(n => join(A5040, `${n}.ts`));
// A3 (painel) entra quando existir.
const ROTA_PAINEL = join(SRC, 'routes', 'geradorEnsaio5040.ts');
if (existsSync(ROTA_PAINEL)) RAIZES.push(ROTA_PAINEL);

/** Módulos de envio: nenhum arquivo do percurso pode ser um destes. */
const ARQUIVOS_DE_ENVIO = ['zapiClient', 'ioSend', 'encaminharMidiaConsultor', 'filaAlerta', 'lineThrottle', 'whatsappAgentService'];
/** Cópia de FUNCOES_DE_ENVIO de chefeGuarda.test.ts (o original não é exportado). */
const FUNCOES_DE_ENVIO = new Set([
  'sendWhatsApp', 'sendHuman', 'sendFrio', 'sendZAPI', 'sendImage', 'sendDocument', 'sendAudio', 'sendVideo',
  'sendSticker', 'sendToGroup', 'enviarZapiIO', 'sendDM', 'sendPrivateReply', 'replyToComment', 'zapiPost',
]);
const TABELAS_PROIBIDAS = ['whatsapp_sessions', 'agendamentos', 'atendimento_pausa', 'sdr_leads', 'message_queue'];
const METODOS_DE_ESCRITA = new Set(['insert', 'update', 'upsert', 'delete']);

const fonte = (arq: string): ts.SourceFile => ts.createSourceFile(arq, readFileSync(arq, 'utf8'), ts.ScriptTarget.Latest, true);

function resolver(de: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(de), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c)) return c;
  return null;
}

/** Os módulos que um arquivo carrega: import, export ... from, import('x') e require('x'). Type-only conta (o ts apaga, mas vigia igual). */
function carregamentos(arq: string): Array<{ spec: string; nomes: string[] }> {
  const out: Array<{ spec: string; nomes: string[] }> = [];
  const visita = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const nomes: string[] = [];
      const c = n.importClause;
      if (c?.name) nomes.push('default');
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) nomes.push('*');
        else for (const e of c.namedBindings.elements) nomes.push((e.propertyName ?? e.name).text);
      }
      out.push({ spec: n.moduleSpecifier.text, nomes });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ spec: n.moduleSpecifier.text, nomes: ['*'] });
    } else if (ts.isCallExpression(n) && n.arguments.length && ts.isStringLiteralLike(n.arguments[0]!)) {
      const e = n.expression;
      if (e.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e) && e.text === 'require')) {
        out.push({ spec: (n.arguments[0] as ts.StringLiteralLike).text, nomes: ['*'] });
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(fonte(arq));
  return out;
}

/** Todos os arquivos alcançáveis a partir das raízes, cada um com quem o trouxe. */
function percurso(raizes: string[]): Map<string, string[]> {
  const vistos = new Map<string, string[]>();
  const fila = raizes.filter(existsSync).map(r => ({ arq: r, via: '(raiz)' }));
  while (fila.length) {
    const { arq, via } = fila.pop()!;
    if (vistos.has(arq)) { vistos.get(arq)!.push(via); continue; }
    vistos.set(arq, [via]);
    for (const { spec } of carregamentos(arq)) {
      const alvo = resolver(arq, spec);
      if (alvo) fila.push({ arq: alvo, via: arq });
    }
  }
  return vistos;
}

const rel = (a: string): string => relative(SRC, a).split(sep).join('/');
const nomeBase = (a: string): string => rel(a).split('/').pop()!.replace(/\.ts$/, '');

/** Textos literais do arquivo (string e template), SEM comentários. */
function literais(arq: string): string[] {
  const out: string[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) { out.push(n.head.text); for (const s of n.templateSpans) out.push(s.literal.text); }
    ts.forEachChild(n, visita);
  };
  visita(fonte(arq));
  return out;
}

/** Nomes chamados como função ou método (foo(...) e x.foo(...)). */
function chamadas(arq: string): string[] {
  const out: string[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) out.push(e.text);
      else if (ts.isPropertyAccessExpression(e)) out.push(e.name.text);
    }
    ts.forEachChild(n, visita);
  };
  visita(fonte(arq));
  return out;
}

/** Escritas (insert/update/upsert/delete) numa tabela proibida: .from('tabela')...insert(). */
function escritasEmTabela(arq: string, tabelas: string[]): string[] {
  const achados: string[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && METODOS_DE_ESCRITA.has(n.expression.name.text)) {
      let r: ts.Expression = n.expression.expression;
      while (true) {
        if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression)) {
          if (r.expression.name.text === 'from' && r.arguments[0] && ts.isStringLiteralLike(r.arguments[0]) && tabelas.includes(r.arguments[0].text)) {
            achados.push(`${r.arguments[0].text}.${n.expression.name.text}`);
          }
          r = r.expression.expression;
        } else if (ts.isPropertyAccessExpression(r)) r = r.expression;
        else break;
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(fonte(arq));
  return achados;
}

const grafo = percurso(RAIZES);
const arquivos = [...grafo.keys()];
const doEnsaio = arquivos.filter(a => a.startsWith(A5040 + sep));

describe('isolamento do ensaio: nada do percurso alcança o envio', () => {
  it('o andador enxerga o percurso inteiro (raízes e personas)', () => {
    const nomes = arquivos.map(nomeBase);
    for (const esperado of ['ensaio', 'replay', 'armazem', 'cota', 'ia', 'contexto', 'porteiro', 'turno', 'carla', 'duda', 'helena', 'comum', 'trava', 'midia']) {
      expect(nomes, esperado).toContain(esperado);
    }
    expect(arquivos.length).toBeGreaterThan(25);
  });

  it('nenhum arquivo do percurso é um módulo de envio', () => {
    const achados = arquivos.filter(a => ARQUIVOS_DE_ENVIO.includes(nomeBase(a))).map(a => `${rel(a)} <- ${grafo.get(a)!.map(rel).join(', ')}`);
    expect(achados).toEqual([]);
  });

  it('nenhum arquivo do percurso chama uma função de envio', () => {
    const achados: string[] = [];
    for (const a of arquivos) for (const c of chamadas(a)) if (FUNCOES_DE_ENVIO.has(c)) achados.push(`${rel(a)}: ${c}()`);
    expect(achados).toEqual([]);
  });

  it('nada do ensaio importa os arquivos da ficha (outro pacote, único que envia)', () => {
    const fichas = arquivos.filter(a => /^ficha/.test(nomeBase(a)) && a.startsWith(A5040 + sep));
    expect(fichas.map(rel)).toEqual([]);
    expect(arquivos.map(nomeBase)).not.toContain('fichaEnvio');
  });

  it("o texto 'ia_falha' não aparece como literal em nenhum arquivo do ensaio (comentário não conta)", () => {
    const achados = doEnsaio.filter(a => literais(a).some(t => t.includes('ia_falha'))).map(rel);
    expect(achados).toEqual([]);
  });

  it('nenhum arquivo do ensaio escreve nas tabelas proibidas', () => {
    const achados: string[] = [];
    for (const a of doEnsaio) for (const e of escritasEmTabela(a, TABELAS_PROIBIDAS)) achados.push(`${rel(a)}: ${e}`);
    expect(achados).toEqual([]);
  });

  it('quem escreve nas tabelas proibidas, fora de agentes5040/, só entra pelas leituras de que o ensaio precisa', () => {
    // pausaHumana.ts e silenciar.ts têm funções que escrevem (atendimento_pausa, whatsapp_suppression), mas o
    // contexto.ts importa só as de LEITURA. Se alguém importar outra, este teste cai.
    const permitido: Record<string, string[]> = {
      'services/agents/whatsapp/pausaHumana.ts': ['desligado'],
      'services/agents/whatsapp/silenciar.ts': ['carregarBloqueados', 'carregarMudos', 'carregarSilenciados', 'chaveContato'],
    };
    const fora = arquivos.filter(a => !a.startsWith(A5040 + sep) && escritasEmTabela(a, TABELAS_PROIBIDAS).length > 0).map(rel);
    expect(fora.sort()).toEqual(Object.keys(permitido).filter(k => fora.includes(k)).sort());
    const imports: Record<string, Set<string>> = {};
    for (const a of arquivos) {
      for (const { spec, nomes } of carregamentos(a)) {
        const alvo = resolver(a, spec);
        if (!alvo || !(rel(alvo) in permitido)) continue;
        (imports[rel(alvo)] ??= new Set()).add(`${nomes.join(',')}`);
        for (const n of nomes) expect(permitido[rel(alvo)], `${rel(a)} importa ${n} de ${rel(alvo)}`).toContain(n);
      }
    }
  });

  it('controle positivo: a partir do solarAgenteQuiz.ts o andador acha o zapiClient', () => {
    const quiz = join(SRC, 'services', 'io', 'solarAgenteQuiz.ts');
    expect(existsSync(quiz)).toBe(true);
    const alcance = percurso([quiz]);
    expect([...alcance.keys()].map(nomeBase)).toContain('zapiClient');
  }, 60_000);
});

describe('isolamento do ensaio: em tempo de carga', () => {
  it('com o zapiClient (e os outros módulos de envio) lançando ao importar, o ensaio e o replay carregam', async () => {
    const lanca = (nome: string) => () => { throw new Error(`${nome} carregado pelo ensaio`); };
    vi.doMock('../services/agents/zapiClient', lanca('zapiClient'));
    vi.doMock('../services/io/ioSend', lanca('ioSend'));
    vi.doMock('../services/io/encaminharMidiaConsultor', lanca('encaminharMidiaConsultor'));
    vi.doMock('../services/agents/whatsapp/filaAlerta', lanca('filaAlerta'));
    vi.doMock('../services/agents/whatsapp/lineThrottle', lanca('lineThrottle'));
    vi.doMock('../services/agents/whatsapp/whatsappAgentService', lanca('whatsappAgentService'));
    vi.resetModules();
    const ensaio = await import('../services/agentes5040/ensaio');
    const replay = await import('../services/agentes5040/replay');
    expect(typeof ensaio.runEnsaioTick).toBe('function');
    expect(typeof replay.runReplay).toBe('function');
    vi.doUnmock('../services/agents/zapiClient');
  }, 60_000);
});
