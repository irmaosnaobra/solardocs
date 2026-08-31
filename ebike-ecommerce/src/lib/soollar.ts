/**
 * Cliente do portal do fornecedor (Soollar Distribuidora).
 *
 * O portal é um app Next.js: não existe API REST pública, o front conversa com o
 * servidor por Server Actions. Então é isso que a gente chama aqui: POST na URL
 * da página com o header `Next-Action` e o corpo em JSON, exatamente como o
 * navegador faz. A resposta vem no formato de flight do React (linhas
 * `<id>:<json>`), e `lerFlight` pesca a linha do resultado.
 *
 * Duas descobertas que custaram caro e explicam o formato abaixo:
 *
 * 1. Sem o cookie `distribution-center` o servidor responde 200 com a lista
 *    VAZIA. Não dá erro, não pede login, simplesmente devolve zero produto.
 *    O cookie é só o JSON do CD, então a gente monta na mão a partir do config.
 * 2. Deslogado, o portal entrega nome, código, foto e ficha técnica, mas
 *    `value` vem 0 e `availableQuantity` vem indefinido. Preço de custo e
 *    estoque SÓ existem com login.
 * 3. O Cloudflare deles derruba `fetch` do Node com 403 (desafio de bot) por
 *    causa da impressão digital de TLS/HTTP1.1, e nenhum cabeçalho resolve.
 *    Pela mesma máquina, HTTP/2 passa. Por isso o transporte aqui é
 *    `node:http2` na unha em vez de `fetch`.
 */

import http2 from 'node:http2';

const BASE = 'https://soollar.com.br';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

/** IDs das Server Actions, lidos dos chunks do portal. Mudam quando ele faz deploy. */
const ACAO = {
  configs: '7fb8ead2b18f634024a310a61461a264dbfc42319f',
  login: '7fe6f5b602acd9b08a6175942be78fa7b038408890',
  eu: '7fa5ed8c0ec8a174f19b31ec17ec2e7f2785f01c62',
  listarProdutos: '7f288a8d9d47738630767d165ec22ad18f635122ca',
  listarCategorias: '7f507d95865e86cd19d4102042238e0c8e029b76b9',
  produto: '7f2095671fa46bcce91d254bbf8b2e9baafdff80c9',
  cdsDoProduto: '7f515c79b20fffb1e4631ed2c4c658197e37808c8b',
} as const;

/** CDN das fotos dos produtos (vem do próprio bundle do portal). */
const CDN = 'https://d242jwkdtnhx89.cloudfront.net';

export type CD = {
  distributionCenterId: string;
  name: string;
  slug: string;
  city?: string;
  state?: string;
  phone?: string;
  /** CEP da base. É daqui que sai o cálculo de distância até o cliente. */
  zipCode?: string;
};

export type Secao = {
  sectionId: string;
  name: string;
  slug: string;
};

export type ProdutoBruto = {
  id: string;
  name: string;
  ref?: string | null;
  referenceCode?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  /** Ficha técnica em HTML. Só vem na chamada de detalhe do produto. */
  technicalInformation?: string | null;
  additionalInformation?: string | null;
  variantName?: string | null;
  netWeight?: number | null;
  grossWeight?: number | null;
  pathsImages?: string[] | null;
  /** Preço negociado, em reais. Vem 0 enquanto a sessão não está logada. */
  value?: number | null;
  /**
   * Preço de tabela em CENTAVOS. Este o portal entrega mesmo deslogado, e é o
   * que sustenta o catálogo quando ainda não há credencial do fornecedor.
   */
  stockValue?: number | null;
  /** Estoque no CD. Vem nulo enquanto a sessão não está logada. */
  availableQuantity?: number | null;
  showProductWithoutStock?: boolean | null;
  productSkuId?: string | null;
  sectionId?: string | null;
};

export class ErroSoollar extends Error {
  readonly detalhe: string;
  constructor(mensagem: string, detalhe = '') {
    super(mensagem);
    this.name = 'ErroSoollar';
    this.detalhe = detalhe;
  }
}

/** Junta CDN + caminho do jeito que o portal junta (mesma regra do bundle dele). */
export function urlDaImagem(caminho: string | null | undefined): string | null {
  const p = (caminho ?? '').trim();
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `${CDN.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}

export function urlsDasImagens(caminhos: string[] | null | undefined): string[] {
  return (caminhos ?? []).map(urlDaImagem).filter((u): u is string => !!u);
}

/**
 * O flight do React serializa `undefined` como a string "$undefined" e usa
 * "$" como prefixo de referência. Para o que a gente lê aqui basta trocar
 * "$undefined" por null antes do JSON.parse.
 */
/** Recorta o objeto JSON que começa em `de`, casando chaves e ignorando strings. */
function recortarObjeto(texto: string, de: number): string | null {
  let profundidade = 0;
  let dentroDeString = false;
  let escapado = false;
  for (let i = de; i < texto.length; i++) {
    const c = texto[i];
    if (escapado) {
      escapado = false;
      continue;
    }
    if (dentroDeString) {
      if (c === '\\') escapado = true;
      else if (c === '"') dentroDeString = false;
      continue;
    }
    if (c === '"') dentroDeString = true;
    else if (c === '{') profundidade++;
    else if (c === '}') {
      profundidade--;
      if (profundidade === 0) return texto.slice(de, i + 1);
    }
  }
  return null;
}

function lerFlight<T>(texto: string): T {
  if (texto.includes('Just a moment') || texto.includes('cf_chl_opt')) {
    throw new ErroSoollar(
      'O Cloudflare do fornecedor barrou a chamada (desafio de bot).',
      texto.slice(0, 200),
    );
  }
  // Não dá para quebrar por linha: o flight embute blocos de texto com tamanho
  // fixo (o logo em base64, por exemplo) e o envelope da API vem colado no fim
  // de um deles. Então procuramos a abertura do envelope e casamos as chaves.
  for (const abertura of ['{"error":null,"data":', '{"error":', '{"data":']) {
    let de = texto.indexOf(abertura);
    while (de >= 0) {
      const bruto = recortarObjeto(texto, de);
      if (bruto) {
        try {
          const obj = JSON.parse(bruto.replaceAll('"$undefined"', 'null'));
          if (obj && typeof obj === 'object' && 'data' in obj) return obj as T;
        } catch {
          /* pedaço incompleto: tenta a próxima ocorrência */
        }
      }
      de = texto.indexOf(abertura, de + 1);
    }
  }
  throw new ErroSoollar(
    'Resposta do fornecedor sem o resultado esperado. Se o portal deles fez ' +
      'deploy, os IDs das Server Actions mudaram: rode `npm run acoes` e ' +
      'atualize o objeto ACAO deste arquivo.',
    texto.slice(0, 300),
  );
}

type Envelope<T> = {
  data: T | null;
  error?: Array<{ propertyName: string; propertyErrors: string[] }> | null;
  status?: number;
};

function exigirDados<T>(env: Envelope<T>, oQue: string): T {
  if (env?.error?.length) {
    const msg = env.error.map((e) => e.propertyErrors.join(', ')).join(' | ');
    throw new ErroSoollar(`O fornecedor recusou ${oQue}: ${msg}`);
  }
  if (env?.data == null) throw new ErroSoollar(`O fornecedor não devolveu ${oQue}.`);
  return env.data;
}

/**
 * Uma sessão guarda os cookies entre as chamadas, inclusive o token que o
 * login devolve. Sem isso cada chamada é anônima e volta sem preço.
 */
export class SessaoSoollar {
  private cookies = new Map<string, string>();
  /**
   * Server Action é POST na URL de uma página real. A raiz "/" responde 403 no
   * Cloudflare deles, então a gente sempre bate na página da seção.
   */
  private caminho: string;
  logado = false;

  constructor(cdSlug = 'cduberlandiamg', secaoSlug = 'ebike') {
    this.caminho = `/cd/${cdSlug}/secao/${secaoSlug}`;
  }

  private cabecalhoCookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private guardarCookies(setCookie: string[] | undefined) {
    for (const bruto of setCookie ?? []) {
      const par = bruto.split(';')[0];
      const igual = par.indexOf('=');
      if (igual > 0) this.cookies.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim());
    }
  }

  definirCookie(nome: string, valor: string) {
    this.cookies.set(nome, valor);
  }

  /** Fixa o CD da sessão. É o cookie sem o qual a listagem volta vazia. */
  usarCD(cd: CD) {
    this.definirCookie('cd-slug', cd.slug);
    this.definirCookie('distribution-center', encodeURIComponent(JSON.stringify(cd)));
  }

  /** POST HTTP/2 na página, no formato de Server Action do Next. */
  private postar(
    acao: string,
    corpo: string,
  ): Promise<{ status: number; texto: string; setCookie?: string[] }> {
    return new Promise((resolver, rejeitar) => {
      const cliente = http2.connect(BASE, { settings: { enablePush: false } });
      const encerrar = (fn: () => void) => {
        try {
          cliente.close();
        } catch {
          /* já fechado */
        }
        fn();
      };
      cliente.on('error', (e) =>
        encerrar(() =>
          rejeitar(new ErroSoollar('Não consegui falar com o fornecedor.', e.message)),
        ),
      );

      const req = cliente.request({
        ':method': 'POST',
        ':path': this.caminho,
        'next-action': acao,
        'content-type': 'text/plain;charset=UTF-8',
        accept: 'text/x-component',
        'accept-language': 'pt-BR,pt;q=0.9',
        'user-agent': UA,
        // Sem `referer`/`origin` de propósito: com eles o Cloudflare do
        // fornecedor devolve o desafio de bot (403). Sem eles, passa.
        ...(this.cookies.size ? { cookie: this.cabecalhoCookie() } : {}),
      });
      req.setTimeout(45_000, () =>
        req.destroy(new Error('o fornecedor demorou demais para responder')),
      );

      let status = 0;
      let setCookie: string[] | undefined;
      const pedacos: Buffer[] = [];
      req.on('response', (h) => {
        status = Number(h[':status'] ?? 0);
        const sc = h['set-cookie'];
        setCookie = Array.isArray(sc) ? sc : sc ? [sc] : undefined;
      });
      req.on('data', (c: Buffer) => pedacos.push(c));
      req.on('error', (e) =>
        encerrar(() => rejeitar(new ErroSoollar('A chamada ao fornecedor falhou.', e.message))),
      );
      req.on('end', () =>
        encerrar(() =>
          resolver({ status, texto: Buffer.concat(pedacos).toString('utf8'), setCookie }),
        ),
      );
      req.end(corpo);
    });
  }

  private async chamar<T>(acao: string, args: unknown[]): Promise<T> {
    const { status, texto, setCookie } = await this.postar(acao, JSON.stringify(args));
    this.guardarCookies(setCookie);
    if (status < 200 || status >= 300) {
      throw new ErroSoollar(`O fornecedor respondeu ${status}.`, texto.slice(0, 300));
    }
    return lerFlight<T>(texto);
  }

  async configs(): Promise<{ sections: Secao[]; distributionCenters: CD[]; tenant?: string }> {
    const env = await this.chamar<Envelope<{ sections: Secao[]; distributionCenters: CD[] }>>(
      ACAO.configs,
      [{}],
    );
    return exigirDados(env, 'as configurações da loja');
  }

  /** Loga no portal. Sem login o catálogo vem sem preço e sem estoque. */
  async entrar(email: string, senha: string): Promise<void> {
    const env = await this.chamar<Envelope<unknown>>(ACAO.login, [{ email, password: senha }]);
    if (env?.error?.length) {
      const msg = env.error.map((e) => e.propertyErrors.join(', ')).join(' | ');
      throw new ErroSoollar(`Login no fornecedor recusado: ${msg}`);
    }
    const eu = await this.chamar<Envelope<unknown>>(ACAO.eu, []);
    if (eu?.data == null) {
      throw new ErroSoollar('Login aceito mas a sessão não ficou de pé no fornecedor.');
    }
    this.logado = true;
  }

  /** Lista TODOS os produtos de uma seção do CD, virando as páginas. */
  async listarProdutos(cdId: string, sectionId: string): Promise<ProdutoBruto[]> {
    const itens: ProdutoBruto[] = [];
    const tamanho = 48;
    for (let pagina = 1; pagina <= 40; pagina++) {
      const env = await this.chamar<{
        data: ProdutoBruto[];
        totalCount: number;
        totalPages: number;
      }>(ACAO.listarProdutos, [
        {
          filter: { cdId, sectionId, order: 1, categoryFilter: [], searchText: null },
          pagination: { PageNumber: pagina, PageSize: tamanho },
        },
      ]);
      const lote = env?.data ?? [];
      itens.push(...lote);
      if (lote.length < tamanho || pagina >= (env?.totalPages ?? 1)) break;
    }
    return itens;
  }

  /** Ficha completa de um produto (descrição, informações técnicas e todas as fotos). */
  async produto(id: string): Promise<ProdutoBruto | null> {
    const env = await this.chamar<Envelope<ProdutoBruto | ProdutoBruto[]>>(ACAO.produto, [id]);
    const d = env?.data;
    if (!d || Array.isArray(d)) return null;
    return d;
  }

  /** Em quais CDs o produto existe. Usado quando o estoque local é zero. */
  async cdsComOProduto(id: string): Promise<Array<{ id: string; name: string; slug: string }>> {
    const env = await this.chamar<Envelope<Array<{ id: string; name: string; slug: string }>>>(
      ACAO.cdsDoProduto,
      [id],
    );
    return env?.data ?? [];
  }
}

/** Abre a sessão, escolhe o CD e (se houver credencial) faz login. */
export async function abrirSessao(opcoes: {
  cdSlug: string;
  secaoSlug: string;
  email?: string;
  senha?: string;
}): Promise<{ sessao: SessaoSoollar; cd: CD; secao: Secao; todosOsCds: CD[] }> {
  const sessao = new SessaoSoollar();
  const { sections, distributionCenters } = await sessao.configs();

  const cd = distributionCenters.find((c) => c.slug === opcoes.cdSlug);
  if (!cd) {
    throw new ErroSoollar(
      `O CD "${opcoes.cdSlug}" não existe no fornecedor.`,
      distributionCenters.map((c) => c.slug).join(', '),
    );
  }
  const secao = sections.find((s) => s.slug === opcoes.secaoSlug);
  if (!secao) {
    throw new ErroSoollar(
      `A seção "${opcoes.secaoSlug}" não existe no fornecedor.`,
      sections.map((s) => s.slug).join(', '),
    );
  }

  sessao.usarCD(cd);
  if (opcoes.email && opcoes.senha) await sessao.entrar(opcoes.email, opcoes.senha);

  return { sessao, cd, secao, todosOsCds: distributionCenters };
}
