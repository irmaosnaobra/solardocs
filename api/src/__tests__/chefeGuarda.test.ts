import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import * as ts from 'typescript';

// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — GUARDA ESTÁTICA: ninguém fala com a Z-API nem com o Graph da
// Meta por fora do transporte oficial.
//
// As 4 quedas da linha 5040 (01/08, 04/08, 30/08, 02/10) tiveram o mesmo
// formato: um remetente FORA da conta, ou contado com o carimbo errado, mandando
// em rajada. A de 30/08 foi literalmente uma rota crua (zapi-admin/io/send-text)
// fazendo fetch direto na Z-API, sem teto, sem janela e sem dedup. Esta guarda
// lê o disco e reprova o próximo robô que nascer assim.
//
// O QUE REPROVA (fora da lista de migração abaixo):
//   zapi      fetch ou montagem de URL da Z-API (host api.z-api.io, o molde
//             /instances/${id}/token/${tk}/, ou o cabeçalho Client-Token) fora
//             de api/src/services/agents/zapiClient.ts. Tipos:
//               envio          o caminho é send-* (manda mensagem);
//               caminho_livre  o caminho é variável e o método não é GET
//                              provado (helper genérico que manda o que pedirem);
//               consulta       leitura ou configuração (status, me, chats,
//                              contacts, webhooks). Não manda mensagem: só
//                              precisa estar em CONSULTA_ZAPI, sem contagem.
//             Num arquivo que fala com a Z-API, um literal de caminho 'send-*'
//             solto também conta como envio: pega o tryReq('POST','send-text').
//   graph     POST (ou método não provado GET) num edge de envio do Graph
//             (/messages, /replies, /comments, /private_replies) de
//             graph.facebook.com ou graph.instagram.com, fora dos clientes
//             oficiais (igClient, fbComentarios, fbMensagens).
//   zapipost  chamada crua a zapiPost/zapiDelete fora do zapiClient.ts: pula os
//             envios tipados (bolhas, sendFrio) por onde o CHEFE vai passar.
//   script    em api/scripts e worker-prospeccao: importar o transporte da api,
//             chamar uma função de envio ou apontar para uma rota de envio. Disparo
//             passa a ser rota que passa pelo CHEFE, nunca script local.
//
// COMO A CATRACA FUNCIONA. Os ofensores que existem hoje estão em MIGRAR, com a
// contagem exata por arquivo e tipo e o porquê. O teste passa hoje e falha:
//   - para arquivo novo fora do mapa;
//   - para número que SOBE (ofensor novo dentro de arquivo já listado);
//   - para número que DESCE (migrou e esqueceu de baixar o mapa: a catraca só
//     aperta, então baixe o número ou tire a entrada).
// Mapa vazio é pré-condição do CHEFE "valendo" completo.
//
// Para ver o inventário inteiro que a varredura achou:
//   CHEFE_GUARDA_INVENTARIO=1 npx vitest run src/__tests__/chefeGuarda.test.ts
//
// LIMITES CONHECIDOS (escritos para ninguém achar que a guarda vê mais do que vê):
//   - Edge do Graph montado num arquivo SEM host do Graph e passado a um helper
//     de outro arquivo não aparece. Os helpers de hoje são privados.
//   - URL da Z-API inteira vinda de env, sem o molde /instances/.../token/ e sem
//     o cabeçalho Client-Token no arquivo, não aparece.
//   - Quem chama sendWhatsApp/sendHuman sem passar pelo CHEFE NÃO é assunto
//     desta guarda: isso é a catraca de passaporte, que entra com o CHEFE ligado.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, '..', '..', '..');

/** O transporte oficial do WhatsApp. É o único lugar que monta URL da Z-API. */
const CLIENTE_ZAPI = 'api/src/services/agents/zapiClient.ts';

/** Os clientes oficiais do Graph que hoje mandam DM, resposta privada e comentário. */
const CLIENTES_GRAPH: readonly string[] = Object.freeze([
  'api/src/services/instagram/igClient.ts',
  'api/src/services/instagram/fbComentarios.ts',
  'api/src/services/instagram/fbMensagens.ts',
]);

/** Pastas varridas. Só a api/src é obrigatória; as outras podem não existir num checkout parcial. */
const RAIZES: readonly { pasta: string; obrigatoria: boolean }[] = Object.freeze([
  { pasta: 'api/src', obrigatoria: true },
  { pasta: 'api/scripts', obrigatoria: false },
  // WhatsApp de prospecção NUNCA pela 5040 [memória chefe-antiban-da-linha.md]:
  // o worker do PC usa outro chip e o navegador; Z-API ou rota de envio da api
  // ali dentro é ofensor.
  { pasta: 'worker-prospeccao', obrigatoria: false },
  { pasta: 'cloudflare-worker', obrigatoria: false },
]);

const PASTAS_IGNORADAS = new Set(['node_modules', 'dist', '.vercel', '__tests__', 'coverage', '.next', '.git']);
const CAMINHOS_IGNORADOS = new Set(['api/scripts/out']);
const EXT_TEXTO = new Set(['.py', '.ps1', '.sh', '.cmd', '.bat', '.vbs']);

type Regra = 'zapi' | 'graph' | 'zapipost' | 'script';
type Chave =
  | 'zapi:envio' | 'zapi:caminho_livre'
  | 'graph:envio'
  | 'zapipost:chamada'
  | 'script:import' | 'script:chamada' | 'script:rota';
type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'DESCONHECIDO';

interface Achado {
  /** Relativo à raiz do repo, sempre com barra normal. */
  arquivo: string;
  linha: number;
  regra: Regra;
  /** envio | caminho_livre | consulta (zapi); envio (graph); chamada (zapipost); import | chamada | rota (script). */
  tipo: string;
  trecho: string;
}

interface Migracao {
  contagem: Partial<Record<Chave, number>>;
  /** Por que o ofensor existe e por que ainda não saiu. */
  porque: string;
  /** Para onde ele vai (a correção dos críticos vale sobre a especificação). */
  destino: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA EXPLÍCITA DE MIGRAÇÃO — os ofensores que existem hoje (base origin/main
// 2c67eaff, depois da limpeza, que apagou o POST /admin/io/send-text e os
// broadcasts do admin.ts). Referência por ROTA ou função, não por número de
// linha: as linhas já andaram desde a especificação.
// ─────────────────────────────────────────────────────────────────────────────

const MIGRAR: Readonly<Record<string, Migracao>> = Object.freeze({
  'api/src/services/io/ioSend.ts': {
    contagem: { 'zapi:caminho_livre': 1, 'zapi:envio': 4 },
    porque: 'enviarZapiIO faz fetch cru na Z-API da linha io (texto, imagem, vídeo e áudio por um caminho variável). ' +
      'Sem circuit-breaker, sem desvio e sem contagem. O chamador vivo é o avisosTickService.',
    destino: 'Usar sendWhatsApp/sendImage/sendVideo/sendAudio do zapiClient na linha io, com o mesmo retorno {ok, messageId, erro}.',
  },
  'api/src/routes/zapiAdmin.ts': {
    contagem: { 'zapi:envio': 3, 'zapi:caminho_livre': 4 },
    porque: 'Envio: GET /solardoc/test-send, POST /io/test-send e POST /io/send-text (a rota da queda de 30/08: 98 frios a 18/h). ' +
      'Caminho livre: os helpers zapiPut, tryPut e tryReq e o POST genérico do /io/setup aceitam qualquer caminho.',
    destino: '[crítica] APAGAR /solardoc/test-send e /io/test-send (migrar abriria a instância morta pela 5040). ' +
      '/io/send-text passa pelo CHEFE como frio com freio duro (6/h, 30 em 24h, 1 por chamada); a classe nunca é a que o operador declara. ' +
      'Os helpers ficam restritos a caminho fixo de leitura e configuração (nunca send-*).',
  },
  'api/src/routes/mcp.ts': {
    contagem: { 'zapi:envio': 1 },
    porque: 'A ferramenta enviar_mensagem_whatsapp faz fetch cru em send-text com a env da instância solardoc (parada desde 27/05).',
    destino: '[crítica] APAGAR a ferramenta, não migrar: com o desvio ligado ela abriria a 5040 para texto livre de fora, ' +
      'e o OAuth da rota entrega o token a quem pedir. Consertar o OAuth junto com o giro do MCP_TOKEN.',
  },
  'api/src/services/io/encaminharMidiaConsultor.ts': {
    contagem: { 'zapipost:chamada': 7 },
    porque: 'Encaminha mídia do lead ao consultor chamando zapiPost(\'send-*\') cru, sem os envios tipados.',
    destino: 'Trocar por sendImage/sendAudio (com waveform)/sendVideo/sendDocument/sendWhatsApp, como aviso ao time. ' +
      'O teto próprio de 12 por lead por hora continua.',
  },
  'api/scripts/broadcast-1mai-solardoc.mjs': {
    contagem: { 'zapi:envio': 1 },
    porque: 'Disparo único de 01/05 com fetch cru em send-text e credencial local.',
    destino: 'APAGAR o arquivo. Script local de envio deixa de existir: disparo é rota que passa pelo CHEFE.',
  },
});

/**
 * Arquivos que podem LER ou CONFIGURAR a Z-API por fora do zapiClient (sem
 * mandar mensagem). Sem contagem: leitura nova num destes arquivos passa, num
 * arquivo novo reprova.
 */
const CONSULTA_ZAPI: Readonly<Record<string, string>> = Object.freeze({
  'api/src/routes/zapiAdmin.ts': 'Painel da linha: status, me, chats, chat-messages, restart e troca de webhooks.',
  'api/src/routes/mcp.ts': 'Ferramenta de contatos do MCP (só leitura). Sai junto se o MCP for desligado.',
  'api/src/services/agents/sdr/sdrIoPolling.ts': 'Lê os chats da linha io para o polling de entrada.',
  'api/src/services/io/zapiHealthMonitor.ts': 'Lê o status da instância para o monitor da linha.',
});

// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA — a mesma função roda no disco e nas fixtures do controle positivo.
// ─────────────────────────────────────────────────────────────────────────────

const CORINGA = '${*}';
const HOST_ZAPI = /api\.z-api\.io/i;
const URL_ZAPI_SEM_HOST = /\/instances\/\$\{[^}]*\}\/token\//;
const ZAPI_ENVIO = /(^|\/)send-[a-z]/i;
const ZAPI_CAMINHO_VARIAVEL = /\/token\/\$\{[^}]*\}\/\$\{|api\.z-api\.io\/\$\{/i;
const PATH_ENVIO_SOLTO = /^\/?send-[a-z]/i;
const CABECALHO_ZAPI = /^client-token$/i;
const HOST_GRAPH = /graph\.(facebook|instagram)\.com/i;
const EDGE_ENVIO_GRAPH = /\/(messages|private_replies|replies|comments)(?=$|[/?#&])/i;
const ROTA_DE_ENVIO = /send-(text|message|image|document|audio|video|sticker|link|button)|zapi-admin|\/io\/broadcasts/i;
const MODULO_ZAPI = /(^|\/)zapiClient(\.[cm]?[jt]s)?$/;
const MODULO_TRANSPORTE = /(^|\/)(zapiClient|ioSend|igClient|fbComentarios|fbMensagens|encaminharMidiaConsultor)(\.[cm]?[jt]s)?$/;
const FUNCOES_DE_ENVIO = new Set([
  'sendWhatsApp', 'sendHuman', 'sendFrio', 'sendZAPI', 'sendImage', 'sendDocument', 'sendAudio', 'sendVideo',
  'sendSticker', 'sendToGroup', 'enviarZapiIO', 'sendDM', 'sendPrivateReply', 'replyToComment', 'zapiPost',
]);
const METODOS_DE_ROTA = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

/** Só abre o AST de quem tem chance de ofender (a varredura fica em poucos segundos). */
const GATILHOS = ['z-api', 'client-token', '/instances/', 'graph.facebook', 'graph.instagram', 'zapipost', 'zapidelete'];
const GATILHOS_SCRIPT = [
  'send', 'zapiclient', 'iosend', 'igclient', 'fbcomentarios', 'fbmensagens', 'encaminharmidia',
  'replytocomment', 'enviarzapiio', 'zapi-admin', 'broadcast',
];

const ehScript = (arquivo: string): boolean =>
  arquivo.startsWith('api/scripts/') || arquivo.startsWith('worker-prospeccao/');

function tipoDeScript(arquivo: string): ts.ScriptKind | null {
  switch (extname(arquivo).toLowerCase()) {
    case '.ts': return ts.ScriptKind.TS;
    case '.tsx': return ts.ScriptKind.TSX;
    case '.js': case '.mjs': case '.cjs': return ts.ScriptKind.JS;
    case '.jsx': return ts.ScriptKind.JSX;
    default: return null;
  }
}

function varrerFonte(texto: string, arquivo: string): Achado[] {
  const baixo = texto.toLowerCase();
  const gatilhos = ehScript(arquivo) ? [...GATILHOS, ...GATILHOS_SCRIPT] : GATILHOS;
  if (!gatilhos.some(g => baixo.includes(g))) return [];
  const kind = tipoDeScript(arquivo);
  if (kind !== null) return varrerAst(texto, arquivo, kind);
  if (EXT_TEXTO.has(extname(arquivo).toLowerCase())) return varrerTexto(texto, arquivo);
  return [];
}

/** Arquivo que não é JS/TS (python, powershell...): regra por linha, sem AST. */
function varrerTexto(texto: string, arquivo: string): Achado[] {
  const linhas = texto.split(/\r?\n/);
  const temHost = linhas.some(l => HOST_ZAPI.test(l));
  const achados: Achado[] = [];
  linhas.forEach((l, i) => {
    const base = { arquivo, linha: i + 1, trecho: l.trim().slice(0, 90) };
    if (HOST_ZAPI.test(l)) achados.push({ ...base, regra: 'zapi', tipo: ZAPI_ENVIO.test(l) ? 'envio' : 'consulta' });
    else if (!temHost && /client-token/i.test(l)) achados.push({ ...base, regra: 'zapi', tipo: 'caminho_livre' });
    else if (HOST_GRAPH.test(l) && EDGE_ENVIO_GRAPH.test(l)) achados.push({ ...base, regra: 'graph', tipo: 'envio' });
    else if (ehScript(arquivo) && ROTA_DE_ENVIO.test(l)) achados.push({ ...base, regra: 'script', tipo: 'rota' });
  });
  return achados;
}

// ── ajudantes de AST ────────────────────────────────────────────────────────

const ehSoma = (n: ts.Node): n is ts.BinaryExpression =>
  ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;

const ehLiteralDeTexto = (n: ts.Node): boolean =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);

function nomeDaPropriedade(nome: ts.PropertyName | undefined): string | null {
  if (!nome) return null;
  if (ts.isIdentifier(nome) || ts.isStringLiteral(nome) || ts.isNoSubstitutionTemplateLiteral(nome)) return nome.text;
  return null;
}

function nomeDoChamado(c: ts.CallExpression): string | null {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Literal que é caminho de módulo (import, export, require, import()) ou tipo literal: não é texto de runtime. */
function ehEspecificadorOuTipo(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) return true;
  if (ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === n) {
    if (p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(p.expression) && p.expression.text === 'require') return true;
  }
  return false;
}

function resolverTexto(e: ts.Node, consts: ReadonlyMap<string, string>, prof = 0): string | null {
  if (prof > 12) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const span of e.templateSpans) s += (resolverTexto(span.expression, consts, prof + 1) ?? CORINGA) + span.literal.text;
    return s;
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
    return resolverTexto(e.expression, consts, prof + 1);
  }
  if (ts.isIdentifier(e)) return consts.get(e.text) ?? null;
  if (ehSoma(e)) {
    const a = resolverTexto(e.left, consts, prof + 1);
    const b = resolverTexto(e.right, consts, prof + 1);
    if (a === null && b === null) return null;
    return (a ?? CORINGA) + (b ?? CORINGA);
  }
  return null;
}

/** const NOME = <texto resolvível>, em qualquer escopo (o primeiro que resolve vence). */
function coletarConstantes(sf: ts.SourceFile): Map<string, string> {
  const decls: { nome: string; init: ts.Expression }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0) {
      decls.push({ nome: n.name.text, init: n.initializer });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  const mapa = new Map<string, string>();
  for (let volta = 0; volta < 3; volta++) {
    for (const d of decls) {
      if (mapa.has(d.nome)) continue;
      const v = resolverTexto(d.init, mapa);
      if (v !== null) mapa.set(d.nome, v);
    }
  }
  return mapa;
}

function normalizarMetodo(s: string): Metodo {
  const m = s.trim().toUpperCase();
  return m === 'GET' || m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE' ? m : 'DESCONHECIDO';
}

/** Método de um objeto de opções ({ method: 'POST' }). Sem a chave: GET (padrão do fetch e do https.request). */
function metodoDoObjeto(o: ts.ObjectLiteralExpression): Metodo {
  for (const p of o.properties) {
    if (ts.isSpreadAssignment(p)) return 'DESCONHECIDO';
    if (nomeDaPropriedade(p.name) !== 'method') continue;
    if (ts.isPropertyAssignment(p)
      && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) {
      return normalizarMetodo(p.initializer.text);
    }
    return 'DESCONHECIDO';
  }
  return 'GET';
}

function metodoDaChamada(c: ts.CallExpression): Metodo {
  const nome = nomeDoChamado(c);
  if (!nome) return 'DESCONHECIDO';
  const verbo = nome.toLowerCase();
  if (verbo === 'get' || verbo === 'post' || verbo === 'put' || verbo === 'patch' || verbo === 'delete') {
    return normalizarMetodo(verbo);
  }
  if (nome !== 'fetch') return 'DESCONHECIDO'; // helper próprio (tryReq, zapiGet...): não dá para provar
  const opcoes = c.arguments[1];
  if (!opcoes) return 'GET';
  return ts.isObjectLiteralExpression(opcoes) ? metodoDoObjeto(opcoes) : 'DESCONHECIDO';
}

function subirEmbrulho(n: ts.Node): ts.Node {
  let a = n;
  while (a.parent && (ts.isParenthesizedExpression(a.parent) || ts.isAsExpression(a.parent) || ts.isNonNullExpression(a.parent))) {
    a = a.parent;
  }
  return a;
}

function escopoDe(n: ts.Node): ts.Node {
  let a: ts.Node | undefined = n.parent;
  while (a && !ts.isSourceFile(a) && !ts.isFunctionLike(a)) a = a.parent;
  return a ?? n.getSourceFile();
}

/**
 * Com que método este texto vira requisição? GET só quando PROVADO: primeiro
 * argumento de fetch sem opções (ou com method GET), const passada só a fetch
 * GET, ou objeto de opções do https.request sem method. O resto é DESCONHECIDO
 * e conta como envio possível (lado conservador).
 */
function metodoDoUso(no: ts.Node): Metodo {
  const a = subirEmbrulho(no);
  const p = a.parent;
  if (!p) return 'DESCONHECIDO';
  if (ts.isCallExpression(p) && p.arguments[0] === a) return metodoDaChamada(p);
  if (ts.isVariableDeclaration(p) && p.initializer === a && ts.isIdentifier(p.name)) {
    const nome = p.name.text;
    const metodos: Metodo[] = [];
    const procurar = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const arg = n.arguments[0];
        if (arg && ts.isIdentifier(arg) && arg.text === nome) metodos.push(metodoDaChamada(n));
      }
      ts.forEachChild(n, procurar);
    };
    procurar(escopoDe(p));
    if (metodos.length === 0) return 'DESCONHECIDO';
    return metodos.find(m => m !== 'GET') ?? 'GET';
  }
  if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent)) {
    const nome = nomeDaPropriedade(p.name);
    if (nome === 'path' || nome === 'url' || nome === 'uri') return metodoDoObjeto(p.parent);
  }
  return 'DESCONHECIDO';
}

/** router.post('/io/send-text', ...) define rota da api: não é chamada para fora. */
function ehRotaExpress(no: ts.Node, texto: string): boolean {
  if (!texto.startsWith('/')) return false;
  const a = subirEmbrulho(no);
  const p = a.parent;
  return !!p && ts.isCallExpression(p) && p.arguments[0] === a
    && ts.isPropertyAccessExpression(p.expression) && METODOS_DE_ROTA.has(p.expression.name.text);
}

function classificarZapi(texto: string, metodo: Metodo): 'envio' | 'caminho_livre' | 'consulta' {
  if (ZAPI_ENVIO.test(texto.replace(/^https?:\/\/[^/]+/i, ''))) return 'envio';
  if (ZAPI_CAMINHO_VARIAVEL.test(texto)) return metodo === 'GET' ? 'consulta' : 'caminho_livre';
  return 'consulta';
}

interface ImportZapi { no: ts.Node; locais: string[]; namespaces: string[]; reexporta: boolean }

function varrerAst(texto: string, arquivo: string, kind: ts.ScriptKind): Achado[] {
  const sf = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  const linhaDe = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const consts = coletarConstantes(sf);
  const script = ehScript(arquivo);

  const nos: { no: ts.Node; texto: string }[] = [];
  const chamadas: ts.CallExpression[] = [];
  const importsZapi: ImportZapi[] = [];
  const importsTransporte: ts.Node[] = [];

  const registrarModulo = (no: ts.Node, modulo: string, montar: (imp: ImportZapi) => void): void => {
    if (MODULO_TRANSPORTE.test(modulo)) importsTransporte.push(no);
    if (!MODULO_ZAPI.test(modulo)) return;
    const imp: ImportZapi = { no, locais: [], namespaces: [], reexporta: false };
    montar(imp);
    importsZapi.push(imp);
  };

  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      registrarModulo(n, n.moduleSpecifier.text, imp => {
        const clausula = n.importClause;
        if (clausula?.name) imp.namespaces.push(clausula.name.text);
        const nb = clausula?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) imp.namespaces.push(nb.name.text);
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            const importado = (el.propertyName ?? el.name).text;
            if (importado === 'zapiPost' || importado === 'zapiDelete') imp.locais.push(el.name.text);
          }
        }
      });
      return;
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      registrarModulo(n, n.moduleSpecifier.text, imp => {
        const ec = n.exportClause;
        if (!ec || (ts.isNamedExports(ec) && ec.elements.some(el => {
          const nome = (el.propertyName ?? el.name).text;
          return nome === 'zapiPost' || nome === 'zapiDelete';
        }))) imp.reexporta = true;
      });
      return;
    }
    if (ts.isCallExpression(n)) {
      chamadas.push(n);
      const arg = n.arguments[0];
      const ehRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if ((ehRequire || n.expression.kind === ts.SyntaxKind.ImportKeyword) && arg && ts.isStringLiteral(arg)) {
        registrarModulo(n, arg.text, imp => {
          const pai = subirEmbrulho(n).parent;
          if (pai && ts.isVariableDeclaration(pai)) {
            if (ts.isIdentifier(pai.name)) imp.namespaces.push(pai.name.text);
            else if (ts.isObjectBindingPattern(pai.name)) {
              for (const el of pai.name.elements) {
                const importado = nomeDaPropriedade(el.propertyName) ?? (ts.isIdentifier(el.name) ? el.name.text : null);
                if ((importado === 'zapiPost' || importado === 'zapiDelete') && ts.isIdentifier(el.name)) imp.locais.push(el.name.text);
              }
            }
          }
        });
      }
    }
    const ehTexto = (ehLiteralDeTexto(n) && !(n.parent && ehSoma(n.parent)) && !ehEspecificadorOuTipo(n))
      || (ehSoma(n) && !(n.parent && ehSoma(n.parent)));
    if (ehTexto) {
      const t = resolverTexto(n, consts);
      if (t !== null) nos.push({ no: n, texto: t });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);

  const achados: Achado[] = [];
  const add = (no: ts.Node, regra: Regra, tipo: string, trecho: string): void => {
    achados.push({ arquivo, linha: linhaDe(no), regra, tipo, trecho: trecho.replace(/\s+/g, ' ').slice(0, 90) });
  };

  // ── Z-API, Graph e rota de envio (por nó de texto) ──
  const temUrlZapi = nos.some(x => HOST_ZAPI.test(x.texto) || URL_ZAPI_SEM_HOST.test(x.texto));
  const temCabecalho = nos.some(x => CABECALHO_ZAPI.test(x.texto));
  const falaComZapi = temUrlZapi || temCabecalho;
  const temHostGraph = nos.some(x => HOST_GRAPH.test(x.texto));
  for (const x of nos) {
    const rota = ehRotaExpress(x.no, x.texto);
    if (HOST_ZAPI.test(x.texto) || URL_ZAPI_SEM_HOST.test(x.texto)) {
      add(x.no, 'zapi', classificarZapi(x.texto, metodoDoUso(x.no)), x.texto);
      continue;
    }
    if (CABECALHO_ZAPI.test(x.texto)) {
      // Cabeçalho da Z-API num arquivo sem URL da Z-API: a URL vem de env ou de fora.
      if (!temUrlZapi) add(x.no, 'zapi', 'caminho_livre', `cabeçalho ${x.texto} sem URL no arquivo`);
      continue;
    }
    if (falaComZapi && !rota && PATH_ENVIO_SOLTO.test(x.texto)) {
      add(x.no, 'zapi', 'envio', x.texto);
      continue;
    }
    if (EDGE_ENVIO_GRAPH.test(x.texto) && (HOST_GRAPH.test(x.texto) || temHostGraph) && !rota && metodoDoUso(x.no) !== 'GET') {
      add(x.no, 'graph', 'envio', x.texto);
      continue;
    }
    if (script && !rota && ROTA_DE_ENVIO.test(x.texto)) add(x.no, 'script', 'rota', x.texto);
  }

  // ── zapiPost / zapiDelete crus ──
  const locais = new Set(importsZapi.flatMap(i => i.locais));
  const namespaces = new Set(importsZapi.flatMap(i => i.namespaces));
  let chamadasCruas = 0;
  for (const c of chamadas) {
    const e = c.expression;
    const crua = (ts.isIdentifier(e) && locais.has(e.text))
      || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && namespaces.has(e.expression.text)
        && (e.name.text === 'zapiPost' || e.name.text === 'zapiDelete'));
    if (crua) { add(c, 'zapipost', 'chamada', c.getText(sf)); chamadasCruas++; }
  }
  for (const imp of importsZapi) {
    if (imp.reexporta || (imp.locais.length > 0 && chamadasCruas === 0)) {
      add(imp.no, 'zapipost', 'chamada', imp.no.getText(sf));
    }
  }

  // ── script de envio ──
  if (script) {
    for (const no of importsTransporte) add(no, 'script', 'import', no.getText(sf));
    for (const c of chamadas) {
      const nome = nomeDoChamado(c);
      if (nome && FUNCOES_DE_ENVIO.has(nome)) add(c, 'script', 'chamada', c.getText(sf));
    }
  }
  return achados;
}

// ── disco ────────────────────────────────────────────────────────────────────

function listar(pastaAbs: string, rel: string, saida: string[]): void {
  for (const e of readdirSync(pastaAbs, { withFileTypes: true })) {
    const relFilho = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!PASTAS_IGNORADAS.has(e.name) && !CAMINHOS_IGNORADOS.has(relFilho)) listar(join(pastaAbs, e.name), relFilho, saida);
      continue;
    }
    if (!e.isFile()) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
    if (tipoDeScript(e.name) !== null || EXT_TEXTO.has(extname(e.name).toLowerCase())) saida.push(relFilho);
  }
}

interface Inventario {
  lidosPorRaiz: Record<string, number>;
  achados: Achado[];
}

function varrerDisco(): Inventario {
  const lidosPorRaiz: Record<string, number> = {};
  const achados: Achado[] = [];
  for (const r of RAIZES) {
    const abs = join(RAIZ, ...r.pasta.split('/'));
    if (!existsSync(abs)) {
      if (r.obrigatoria) throw new Error(`pasta obrigatória da guarda não existe: ${r.pasta}`);
      continue;
    }
    const arquivos: string[] = [];
    listar(abs, r.pasta, arquivos);
    lidosPorRaiz[r.pasta] = arquivos.length;
    for (const arq of arquivos) achados.push(...varrerFonte(readFileSync(join(RAIZ, ...arq.split('/')), 'utf8'), arq));
  }
  return { lidosPorRaiz, achados };
}

// ── avaliação contra a lista de migração ────────────────────────────────────

function isento(a: Achado): boolean {
  if ((a.regra === 'zapi' || a.regra === 'zapipost') && a.arquivo === CLIENTE_ZAPI) return true;
  if (a.regra === 'graph' && CLIENTES_GRAPH.includes(a.arquivo)) return true;
  return false;
}

/** Devolve a lista de problemas (vazia = guarda verde). */
function avaliar(
  achados: readonly Achado[],
  mapa: Readonly<Record<string, Migracao>> = MIGRAR,
  consulta: Readonly<Record<string, string>> = CONSULTA_ZAPI,
): string[] {
  const problemas: string[] = [];
  const contagem = new Map<string, Map<string, Achado[]>>();
  for (const a of achados) {
    if (isento(a)) continue;
    if (a.regra === 'zapi' && a.tipo === 'consulta') {
      if (!(a.arquivo in consulta)) {
        problemas.push(`${a.arquivo}:${a.linha} lê ou configura a Z-API fora do zapiClient e fora de CONSULTA_ZAPI ` +
          `(${a.trecho}). Leia pelo zapiClient ou ponha o arquivo na lista com o porquê.`);
      }
      continue;
    }
    const porChave = contagem.get(a.arquivo) ?? new Map<string, Achado[]>();
    const lista = porChave.get(`${a.regra}:${a.tipo}`) ?? [];
    lista.push(a);
    porChave.set(`${a.regra}:${a.tipo}`, lista);
    contagem.set(a.arquivo, porChave);
  }
  for (const [arquivo, porChave] of contagem) {
    for (const [chave, lista] of porChave) {
      const permitido = (mapa[arquivo]?.contagem as Record<string, number | undefined> | undefined)?.[chave] ?? 0;
      const linhas = lista.map(a => a.linha).join(', ');
      if (lista.length > permitido) {
        problemas.push(`OFENSOR NOVO: ${arquivo} tem ${lista.length} × ${chave} (o mapa permite ${permitido}; linhas ${linhas}). ` +
          'Mande pelo transporte oficial (zapiClient / igClient) e passe a mudança pelo subagente chefe-antiban.');
      } else if (lista.length < permitido) {
        problemas.push(`A catraca só aperta: ${arquivo} caiu de ${permitido} para ${lista.length} × ${chave} (linhas ${linhas}). ` +
          'Baixe o número em MIGRAR.');
      }
    }
  }
  for (const [arquivo, m] of Object.entries(mapa)) {
    for (const [chave, n] of Object.entries(m.contagem)) {
      if (n && n > 0 && !contagem.get(arquivo)?.has(chave)) {
        problemas.push(`A catraca só aperta: ${arquivo} não tem mais ${chave} (o mapa diz ${n}). Tire a chave de MIGRAR.`);
      }
    }
  }
  return problemas;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

// Varre o disco uma vez, na coleta do arquivo (sem timeout de hook; o vitest 4
// não aceita beforeAll fora de describe).
const inventario: Inventario = varrerDisco();

describe('chefeGuarda: ninguém fala com a Z-API nem com o Graph por fora', () => {
  it('a varredura leu o repositório de verdade (regex que não casa nada não passa verde)', () => {
    // Hoje são 263 arquivos em api/src. O piso de 200 pega varredura que leu a
    // pasta errada ou quase nada. (A especificação falava em 400: contava antes
    // da limpeza.)
    expect(inventario.lidosPorRaiz['api/src']).toBeGreaterThan(200);
    if (existsSync(join(RAIZ, 'api', 'scripts'))) expect(inventario.lidosPorRaiz['api/scripts']).toBeGreaterThan(0);
    // O próprio cliente oficial tem de aparecer no inventário (antes da isenção).
    const doCliente = inventario.achados.filter(a => a.arquivo === CLIENTE_ZAPI && a.regra === 'zapi');
    expect(doCliente.some(a => a.tipo === 'envio')).toBe(true);
    expect(doCliente.some(a => a.tipo === 'caminho_livre')).toBe(true);
  });

  it('nenhum ofensor novo, e a lista de migração bate com o disco', () => {
    if (process.env.CHEFE_GUARDA_INVENTARIO) {
      const linhas = inventario.achados.map(a =>
        `${isento(a) ? 'isento ' : ''}${a.regra}:${a.tipo}  ${a.arquivo}:${a.linha}  ${a.trecho}`);
      console.log(`[chefeGuarda] lidos ${JSON.stringify(inventario.lidosPorRaiz)}\n${linhas.join('\n')}`);
    }
    expect(avaliar(inventario.achados)).toEqual([]);
  });

  it('toda entrada da lista diz por que existe e para onde vai', () => {
    for (const [arquivo, m] of Object.entries(MIGRAR)) {
      expect({ arquivo, porque: m.porque.length > 20, destino: m.destino.length > 20 })
        .toEqual({ arquivo, porque: true, destino: true });
      expect(Object.values(m.contagem).every(n => Number.isInteger(n) && (n ?? 0) > 0)).toBe(true);
    }
    for (const [arquivo, porque] of Object.entries(CONSULTA_ZAPI)) expect({ arquivo, ok: porque.length > 20 }).toEqual({ arquivo, ok: true });
  });

  it('os clientes oficiais existem (isenção não aponta para arquivo sumido)', () => {
    for (const f of [CLIENTE_ZAPI, ...CLIENTES_GRAPH]) expect({ f, existe: existsSync(join(RAIZ, ...f.split('/'))) }).toEqual({ f, existe: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLE POSITIVO: a MESMA função de varredura, em código sintético na
// memória, TEM de achar cada ofensor. Sem isto, uma regex quebrada passa verde.
// ─────────────────────────────────────────────────────────────────────────────

const src = (...linhas: string[]): string => linhas.join('\n');
const resumo = (achados: Achado[]): string[] => achados.map(a => `${a.regra}:${a.tipo}`);

describe('chefeGuarda: controle positivo (ofensor sintético é pego)', () => {
  it('o zapiClient.ts real, sem a isenção, tem envio e caminho livre', () => {
    const achados = varrerFonte(readFileSync(join(RAIZ, ...CLIENTE_ZAPI.split('/')), 'utf8'), 'api/src/services/io/copiaDoCliente.ts');
    expect(resumo(achados)).toContain('zapi:envio');
    expect(resumo(achados)).toContain('zapi:caminho_livre');
    expect(avaliar(achados, {}, {}).length).toBeGreaterThan(0);
  });

  it('fetch cru ao Z-API num robô novo', () => {
    const achados = varrerFonte(src(
      'export async function avisar(id: string, tk: string, phone: string) {',
      '  await fetch(`https://api.z-api.io/instances/${id}/token/${tk}/send-text`, { method: "POST", body: JSON.stringify({ phone }) });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:envio']);
  });

  it('host da Z-API numa constante e o caminho montado em outro lugar', () => {
    const achados = varrerFonte(src(
      'const BASE = "https://api.z-api.io";',
      'export async function f(id: string, tk: string) {',
      '  const url = `${BASE}/instances/${id}/token/${tk}/send-image`;',
      '  return fetch(url, { method: "POST" });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:consulta', 'zapi:envio']);
    expect(avaliar(achados, {}, {}).length).toBe(2); // consulta fora da lista + envio novo
  });

  it('helper genérico de caminho variável e o tryReq(\'POST\', \'send-text\') futuro', () => {
    const achados = varrerFonte(src(
      'async function tryReq(method: string, path: string, c: any) {',
      '  const url = `https://api.z-api.io/instances/${c.id}/token/${c.token}/${path}`;',
      '  const opts: any = { method };',
      '  return fetch(url, opts);',
      '}',
      'export const x = () => tryReq("POST", "send-text", {});',
    ), 'api/src/routes/painelNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:caminho_livre', 'zapi:envio']);
  });

  it('cabeçalho Client-Token com a URL vinda de env', () => {
    const achados = varrerFonte(src(
      'export async function f(path: string) {',
      '  return fetch(process.env.ZAPI_URL + path, { method: "POST", headers: { "Client-Token": process.env.ZAPI_CLIENT_TOKEN! } });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:caminho_livre']);
  });

  it('molde /instances/.../token/ sem o host (host vindo de env)', () => {
    const achados = varrerFonte(src(
      'export const f = (id: string, tk: string) => fetch(`${process.env.ZAPI_HOST}/instances/${id}/token/${tk}/send-text`, { method: "POST" });',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:envio']);
  });

  it('POST no Graph fora do cliente oficial (host numa constante)', () => {
    const achados = varrerFonte(src(
      'const GRAPH = "https://graph.facebook.com/v21.0";',
      'export async function responder(pagina: string, para: string, token: string) {',
      '  await fetch(`${GRAPH}/${pagina}/messages?access_token=${token}`, { method: "POST", body: JSON.stringify({ recipient: { id: para } }) });',
      '}',
    ), 'api/src/services/instagram/roboNovo.ts');
    expect(resumo(achados)).toEqual(['graph:envio']);
    // O mesmo código dentro de um cliente oficial é isento.
    expect(avaliar(achados.map(a => ({ ...a, arquivo: 'api/src/services/instagram/fbMensagens.ts' })), {}, {})).toEqual([]);
  });

  it('https.request no Graph com path /replies e POST (host noutro literal)', () => {
    const achados = varrerFonte(src(
      'import https from "https";',
      'export function comentar(id: string) {',
      '  return https.request({ hostname: "graph.instagram.com", path: `/v25.0/${id}/replies`, method: "POST" });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['graph:envio']);
  });

  it('script local: host da Z-API, transporte importado e rota de envio da api', () => {
    expect(resumo(varrerFonte(src(
      'const r = await fetch(`https://api.z-api.io/instances/${ID}/token/${TK}/send-text`, { method: "POST" });',
    ), 'api/scripts/disparo-novo.mjs'))).toEqual(['zapi:envio']);

    expect(resumo(varrerFonte(src(
      'import { sendWhatsApp } from "../src/services/agents/zapiClient";',
      'for (const p of lista) await sendWhatsApp(p, "oi", "io");',
    ), 'api/scripts/disparo-novo.ts'))).toEqual(['script:import', 'script:chamada']);

    expect(resumo(varrerFonte(src(
      'const { sendHuman } = require("../dist/services/agents/zapiClient");',
      'sendHuman(p, ["oi"], "io");',
    ), 'api/scripts/disparo-novo.cjs'))).toEqual(['script:import', 'script:chamada']);

    expect(resumo(varrerFonte(src(
      'await fetch("https://api.solardoc.app/admin/io/send-text", { method: "POST" });',
    ), 'api/scripts/disparo-novo.ts'))).toEqual(['script:rota']);

    expect(resumo(varrerFonte(src(
      'r = requests.post(f"https://api.z-api.io/instances/{i}/token/{t}/send-text", json=b)',
    ), 'api/scripts/disparo.py'))).toEqual(['zapi:envio']);
  });

  it('zapiPost cru importado fora do zapiClient (direto, com alias e por namespace)', () => {
    expect(resumo(varrerFonte(src(
      'import { zapiPost as zp } from "../agents/zapiClient";',
      'export const f = (p: string) => zp("send-text", { phone: p, message: "oi" }, 2, "io");',
    ), 'api/src/services/io/roboNovo.ts'))).toEqual(['zapipost:chamada']);

    expect(resumo(varrerFonte(src(
      'import * as z from "../agents/zapiClient";',
      'export const f = (p: string) => z.zapiPost("send-image", { phone: p }, 2, "io");',
    ), 'api/src/services/io/roboNovo.ts'))).toEqual(['zapipost:chamada']);
  });

  it('avaliar() reprova arquivo novo, número que sobe e número que desce', () => {
    const real = inventario.achados;
    // Arquivo novo fora do mapa.
    const novo: Achado = { arquivo: 'api/src/services/io/roboNovo.ts', linha: 1, regra: 'zapi', tipo: 'envio', trecho: 'x' };
    expect(avaliar([...real, novo]).join('\n')).toContain('OFENSOR NOVO: api/src/services/io/roboNovo.ts');
    // O alvo sai do próprio mapa, para o autoteste não fixar arquivo (fixar o
    // admin.ts quebrou quando a limpeza apagou o /admin/io/send-text).
    const [alvoArq, alvoM] = Object.entries(MIGRAR)[0]!;
    const alvoChave = Object.keys(alvoM.contagem)[0]!;
    const [regra, tipo] = alvoChave.split(':') as [Regra, string];
    // Um ofensor a mais num arquivo já listado.
    const mais: Achado = { arquivo: alvoArq, linha: 9999, regra, tipo, trecho: 'x' };
    expect(avaliar([...real, mais]).join('\n')).toContain(`OFENSOR NOVO: ${alvoArq}`);
    // Um ofensor a menos (migrou e não baixou o mapa): tira só 1 achado real daquela chave.
    let tirou = false;
    const semUm = real.filter(a => {
      if (!tirou && a.arquivo === alvoArq && `${a.regra}:${a.tipo}` === alvoChave) { tirou = true; return false; }
      return true;
    });
    expect(tirou).toBe(true);
    expect(avaliar(semUm).join('\n')).toContain(`A catraca só aperta: ${alvoArq}`);
    // Leitura num arquivo fora da lista de consulta.
    const leitura: Achado = { arquivo: 'api/src/services/io/roboNovo.ts', linha: 1, regra: 'zapi', tipo: 'consulta', trecho: 'x' };
    expect(avaliar([...real, leitura]).join('\n')).toContain('fora de CONSULTA_ZAPI');
  });
});

describe('chefeGuarda: controle negativo (o que NÃO é ofensor)', () => {
  it('comentário que cita o host não conta', () => {
    expect(varrerFonte(src(
      '// antes isto batia direto em https://api.z-api.io/instances/X/token/Y/send-text',
      '/* graph.facebook.com/v21.0/123/messages */',
      'export const x = 1;',
    ), 'api/src/services/io/qualquer.ts')).toEqual([]);
  });

  it('definição de rota da api (router.post(\'/send-text\')) não conta', () => {
    expect(resumo(varrerFonte(src(
      'router.post("/send-text", async (req, res) => {',
      '  const r = await fetch(`https://api.z-api.io/instances/${a}/token/${b}/status`);',
      '  res.json(await r.json());',
      '});',
    ), 'api/src/routes/zapiAdmin.ts'))).toEqual(['zapi:consulta']);
  });

  it('GET provado de /comments e leitura de anúncio no Graph não contam', () => {
    expect(varrerFonte(src(
      'const GRAPH = "https://graph.facebook.com/v21.0";',
      'export async function ler(post: string, token: string) {',
      '  const r = await fetch(`${GRAPH}/${post}/comments?fields=id,message&access_token=${token}`);',
      '  const s = await fetch(`${GRAPH}/act_1/insights?access_token=${token}`, { method: "GET" });',
      '  return [await r.json(), await s.json()];',
      '}',
    ), 'api/src/services/metaNovo.ts')).toEqual([]);
  });

  it('texto "send-text" em arquivo que não fala com a Z-API não conta (fora de script)', () => {
    expect(varrerFonte(src(
      'export const ROTULO = "send-text";',
      'logger.info("send-text falhou");',
    ), 'api/src/services/io/qualquer.ts')).toEqual([]);
  });

  it('tipo literal com caminho send-* não é runtime', () => {
    expect(resumo(varrerFonte(src(
      'type Caminho = "send-text" | "send-image";',
      'export const f = () => fetch(`https://api.z-api.io/instances/${a}/token/${b}/me`);',
    ), 'api/src/services/io/zapiHealthMonitor.ts'))).toEqual(['zapi:consulta']);
  });
});
