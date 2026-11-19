// Logo do integrador ajustada para o Moderno (propostaSolar, modelos 2 e 3), em 18/11/2026.
// Muita logo chega mal recortada: margem enorme, JPG com fundo branco, selo dentro de um retângulo colorido,
// logo branca feita para fundo escuro, arquivo de 120 px. Aqui o servidor recorta o conteúdo, tira o fundo branco,
// dá respiro ao selo e mede o que o template precisa para desenhar a logo bem em qualquer caso (só HTML e CSS:
// o PDF sai com JavaScript desligado). Qualquer erro devolve a logo original, sem lançar.
// O sharp é carregado DENTRO da função: a api é CommonJS e nada aqui pode pesar no boot.
import { createHash } from 'crypto';

export type FundoLogo = 'transparente' | 'branco' | 'solido' | 'misto';

export interface LogoMedidas {
  /** Tamanho natural do conteúdo (px da imagem original, já recortada). Bitmap não estica muito além disso. */
  w: number;
  h: number;
  /** Largura dividida pela altura. */
  proporcao: number;
  /** Conteúdo claro sobre fundo transparente: some na folha branca e vai para uma placa escura. */
  clara: boolean;
  /** solido = selo (retângulo de uma cor com a marca dentro); misto = foto ou degradê, fica como está. */
  fundo: FundoLogo;
  /** Cor do selo ('#RRGGBB') quando fundo = solido; senão ''. */
  cor: string;
  vetor: boolean;
}

export interface LogoAjustada { logo: string; medidas: LogoMedidas | null }

type Rgb = [number, number, number];
interface Px { d: Buffer; W: number; H: number }
interface Caixa { x0: number; y0: number; x1: number; y1: number } // x1 e y1 exclusivos

const MAX_ENTRADA = 12 * 1024 * 1024;  // data URL acima disso nem é lido
const MAX_PIXELS = 40_000_000;          // imagem com mais pixels que isso o sharp recusa (cai na original)
const LADO_TRABALHO = 1600;             // a cópia de trabalho (só para medir) nunca passa disso
const LADO_SAIDA = 1240;                // capa a 2x: a logo nunca aparece com mais de 620 px de largura
const SAIDA_GRANDE = 300 * 1024;        // foto ou degradê até esse peso fica como veio
const PRAZO_MS = 4000;                  // prazo total do ajuste; vencido, sai a original
const SHARP_PRAZO = { seconds: 5 };
const TETO_ITENS = 32, TETO_BYTES = 8 * 1024 * 1024, MAIOR_ITEM = 1024 * 1024;
const memoria = new Map<string, { r: LogoAjustada; bytes: number }>();
let bytesNaMemoria = 0;

const dif = (d: Buffer, o: number, c: Rgb) => Math.max(Math.abs(d[o] - c[0]), Math.abs(d[o + 1] - c[1]), Math.abs(d[o + 2] - c[2]));
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const LIN = Array.from({ length: 256 }, (_, i) => { const s = i / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });

/** Lê a borda da caixa (recuada `recuo` px) e diz que fundo ela tem. */
function fundoDaBorda(p: Px, c: Caixa, recuo = 0): { tipo: FundoLogo; cor: Rgb } {
  const x0 = c.x0 + recuo, y0 = c.y0 + recuo, x1 = c.x1 - 1 - recuo, y1 = c.y1 - 1 - recuo;
  if (x1 - x0 < 6 || y1 - y0 < 6) return { tipo: 'misto', cor: [0, 0, 0] };
  const idx: number[] = [];
  for (let x = x0; x <= x1; x++) idx.push(y0 * p.W + x, y1 * p.W + x);
  for (let y = y0 + 1; y < y1; y++) idx.push(y * p.W + x0, y * p.W + x1);
  let transp = 0;
  const baldes = new Map<number, number[]>();
  for (const i of idx) {
    const o = i * 4;
    if (p.d[o + 3] < 20) { transp++; continue; }
    const k = ((p.d[o] >> 4) << 8) | ((p.d[o + 1] >> 4) << 4) | (p.d[o + 2] >> 4);
    const b = baldes.get(k) ?? [0, 0, 0, 0];
    b[0]++; b[1] += p.d[o]; b[2] += p.d[o + 1]; b[3] += p.d[o + 2];
    baldes.set(k, b);
  }
  if (transp >= idx.length * 0.6) return { tipo: 'transparente', cor: [0, 0, 0] };
  let topo: number[] | null = null;
  for (const b of baldes.values()) if (!topo || b[0] > topo[0]) topo = b;
  if (!topo) return { tipo: 'misto', cor: [0, 0, 0] };
  const cor: Rgb = [topo[1] / topo[0], topo[2] / topo[0], topo[3] / topo[0]];
  let perto = 0;
  for (const i of idx) if (p.d[i * 4 + 3] >= 20 && dif(p.d, i * 4, cor) <= 30) perto++;
  if (perto < idx.length * 0.82) return { tipo: 'misto', cor };
  return { tipo: Math.min(...cor) >= 232 ? 'branco' : 'solido', cor };
}

/** Caixa do que não é fundo. Linha ou coluna com 1 px solto de ruído de JPG não conta. */
function caixaDoConteudo(p: Px, c: Caixa, tipo: FundoLogo, cor: Rgb, tol: number): Caixa | null {
  const minimo = tipo === 'transparente' ? 1 : 2;
  const col = new Uint32Array(c.x1 - c.x0), lin = new Uint32Array(c.y1 - c.y0);
  for (let y = c.y0; y < c.y1; y++) {
    for (let x = c.x0; x < c.x1; x++) {
      const o = (y * p.W + x) * 4;
      if (p.d[o + 3] < 24 || (tipo !== 'transparente' && dif(p.d, o, cor) <= tol)) continue;
      col[x - c.x0]++; lin[y - c.y0]++;
    }
  }
  const primeiro = (a: Uint32Array) => a.findIndex((v) => v >= minimo);
  const ultimo = (a: Uint32Array) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] >= minimo) return i; return -1; };
  const ix0 = primeiro(col), iy0 = primeiro(lin);
  if (ix0 < 0 || iy0 < 0) return null;
  return { x0: c.x0 + ix0, y0: c.y0 + iy0, x1: c.x0 + ultimo(col) + 1, y1: c.y0 + ultimo(lin) + 1 };
}

const folga = (c: Caixa, f: number, lim: Caixa): Caixa => ({
  x0: Math.max(lim.x0, c.x0 - f), y0: Math.max(lim.y0, c.y0 - f), x1: Math.min(lim.x1, c.x1 + f), y1: Math.min(lim.y1, c.y1 + f),
});

/** Mais da metade do traço é clara (luminância acima de 0,6): na folha branca a logo some. */
function ehClara(p: Px, c: Caixa): boolean {
  let opacos = 0, claros = 0;
  for (let y = c.y0; y < c.y1; y++) {
    for (let x = c.x0; x < c.x1; x++) {
      const o = (y * p.W + x) * 4;
      if (p.d[o + 3] < 128) continue;
      opacos++;
      if (0.2126 * LIN[p.d[o]] + 0.7152 * LIN[p.d[o + 1]] + 0.0722 * LIN[p.d[o + 2]] > 0.6) claros++;
    }
  }
  return opacos >= 20 && claros >= opacos * 0.55;
}

/** Fundo branco ligado à borda vira transparente (o miolo branco de uma letra fechada fica). Tira o branco da franja. */
function tirarFundoBranco(p: Px, cor: Rgb): void {
  const { d, W, H } = p, visto = new Uint8Array(W * H), fila = new Int32Array(W * H);
  let ini = 0, fim = 0;
  const entra = (i: number) => { if (!visto[i] && dif(d, i * 4, cor) <= 40) { visto[i] = 1; fila[fim++] = i; } };
  for (let x = 0; x < W; x++) { entra(x); entra((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { entra(y * W); entra(y * W + W - 1); }
  while (ini < fim) {
    const i = fila[ini++], x = i % W, o = i * 4;
    const a = Math.min(1, Math.max(0, (dif(d, o, cor) - 6) / 34));
    for (let k = 0; k < 3; k++) d[o + k] = a > 0 ? Math.max(0, Math.min(255, Math.round((d[o + k] - (1 - a) * cor[k]) / a))) : 0;
    d[o + 3] = Math.round(d[o + 3] * a);
    if (x > 0) entra(i - 1);
    if (x < W - 1) entra(i + 1);
    if (i >= W) entra(i - W);
    if (i < W * (H - 1)) entra(i + W);
  }
}

interface Analise { caixa: Caixa; fundo: FundoLogo; cor: Rgb; clara: boolean; seloComMargem?: boolean }

/** Decide o recorte e o tipo da logo a partir dos pixels. null = imagem vazia (só fundo). */
function analisar(p: Px, folgaMin = 0.015): Analise | null {
  const tudo: Caixa = { x0: 0, y0: 0, x1: p.W, y1: p.H };
  const f1 = fundoDaBorda(p, tudo);
  if (f1.tipo === 'misto') return { caixa: tudo, fundo: 'misto', cor: f1.cor, clara: false };
  let selo: Caixa | null = null, corSelo: Rgb = f1.cor;
  let conteudo: Caixa | null = tudo;
  if (f1.tipo === 'solido') selo = tudo;
  else {
    conteudo = caixaDoConteudo(p, tudo, f1.tipo, f1.cor, 40);
    if (!conteudo) return null;
    // O que sobrou depois de tirar a margem é um retângulo de uma cor só? Então é um selo.
    const f2 = fundoDaBorda(p, conteudo, 2);
    if (f2.tipo === 'solido') { selo = conteudo; corSelo = f2.cor; }
  }
  if (selo) {
    // Selo: a marca dentro dele ganha respiro proporcional, sem passar da borda do próprio selo.
    // O formato do selo (quadrado, faixa) é desenho da marca: o recorte só tira sobra e mantém a proporção dele.
    const dentro = caixaDoConteudo(p, selo, 'solido', corSelo, 48) ?? selo;
    const bw = dentro.x1 - dentro.x0, bh = dentro.y1 - dentro.y0;
    const r = Math.max(0.2 * Math.min(bw, bh), 0.07 * Math.max(bw, bh));
    const sw = selo.x1 - selo.x0, sh = selo.y1 - selo.y0, forma = sw / sh;
    let w = bw + 2 * r, h = bh + 2 * r;
    if (w / h < forma) w = h * forma; else h = w / forma;
    w = Math.min(sw, w); h = Math.min(sh, h);
    const cx = (dentro.x0 + dentro.x1) / 2, cy = (dentro.y0 + dentro.y1) / 2;
    const x0 = Math.round(Math.max(selo.x0, Math.min(selo.x1 - w, cx - w / 2)));
    const y0 = Math.round(Math.max(selo.y0, Math.min(selo.y1 - h, cy - h / 2)));
    const caixa = { x0, y0, x1: Math.min(selo.x1, x0 + Math.round(w)), y1: Math.min(selo.y1, y0 + Math.round(h)) };
    return { caixa, fundo: 'solido', cor: corSelo, clara: false, seloComMargem: f1.tipo !== 'solido' };
  }
  const c = conteudo as Caixa;
  const margem = Math.max(2, Math.round(folgaMin * Math.max(c.x1 - c.x0, c.y1 - c.y0)));
  const caixa = folga(c, margem, tudo);
  return { caixa, fundo: f1.tipo, cor: f1.cor, clara: f1.tipo === 'transparente' && ehClara(p, caixa) };
}

// Tipo pela assinatura, não pela forma do módulo: na Vercel o @vercel/node compila com outra interop e `typeof import('sharp')` vira namespace sem chamada.
type Sharp = (input?: Buffer, options?: import('sharp').SharpOptions) => import('sharp').Sharp;

async function pixels(sharp: Sharp, buf: Buffer, opcoes: { density?: number } = {}): Promise<Px> {
  const { data, info } = await sharp(buf, { limitInputPixels: MAX_PIXELS, ...opcoes })
    .timeout(SHARP_PRAZO).rotate()
    .resize({ width: LADO_TRABALHO, height: LADO_TRABALHO, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, W: info.width, H: info.height };
}

const medidasDe = (a: Analise, w: number, h: number, vetor: boolean): LogoMedidas => ({
  w, h, proporcao: Math.round((w / h) * 1000) / 1000, clara: a.clara, fundo: a.fundo, cor: a.fundo === 'solido' ? hex(a.cor) : '', vetor,
});

async function ajustarBitmap(sharp: Sharp, buf: Buffer, mime: string, dataUrl: string): Promise<LogoAjustada | null> {
  const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
  const gira = (meta.orientation ?? 1) >= 5;
  const natW = (gira ? meta.height : meta.width) ?? 0, natH = (gira ? meta.width : meta.height) ?? 0;
  const p = await pixels(sharp, buf);
  const a = analisar(p);
  if (!a) return null;
  // A original, com medidas da imagem inteira. Selo achado dentro de uma margem branca volta a ser logo em fundo branco.
  const original = (): LogoAjustada => ({
    logo: dataUrl,
    medidas: medidasDe({ ...a, fundo: a.seloComMargem ? 'branco' : a.fundo }, natW || p.W, natH || p.H, false),
  });
  const escala = Math.max(1, Math.max(natW, natH) / Math.max(p.W, p.H));
  let img: import('sharp').Sharp;
  let w: number, h: number;
  if (a.fundo === 'misto') {
    // Foto ou degradê: nada a recortar. Fica a original; só a muito pesada é reduzida (e só se ficar menor).
    if (buf.length <= SAIDA_GRANDE) return original();
    img = sharp(buf, { limitInputPixels: MAX_PIXELS }).timeout(SHARP_PRAZO).rotate();
    w = p.W; h = p.H;
  } else {
    const { x0, y0, x1, y1 } = a.caixa;
    w = x1 - x0; h = y1 - y0;
    const recorte: Px = { d: Buffer.alloc(w * h * 4), W: w, H: h };
    for (let y = 0; y < h; y++) p.d.copy(recorte.d, y * w * 4, ((y0 + y) * p.W + x0) * 4, ((y0 + y) * p.W + x1) * 4);
    if (a.fundo === 'branco') tirarFundoBranco(recorte, a.cor);
    img = sharp(recorte.d, { raw: { width: w, height: h, channels: 4 } }).timeout(SHARP_PRAZO);
  }
  // Nunca cresce: logo grande desce até o que a capa usa a 2x; logo pequena fica no tamanho dela.
  img = img.resize({ width: LADO_SAIDA, height: LADO_SAIDA, fit: 'inside', withoutEnlargement: true });
  // JPG continua JPG (o fundo branco tirado vira branco puro, que some na folha); WEBP pesado continua WEBP; o resto, PNG.
  const formato = /jpe?g/.test(mime) ? 'jpeg' : a.fundo === 'misto' && mime === 'webp' ? 'webp' : 'png';
  const fundoJpg = a.fundo === 'branco' ? { r: 255, g: 255, b: 255 } : { r: a.cor[0], g: a.cor[1], b: a.cor[2] };
  const saida = formato === 'jpeg'
    ? await img.flatten({ background: fundoJpg }).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    : formato === 'webp'
      ? await img.webp({ quality: 88 }).toBuffer()
      : await img.png(a.fundo === 'misto' ? { compressionLevel: 9 } : { compressionLevel: 9, palette: true, quality: 92, effort: 8 }).toBuffer();
  // Regravada do mesmo tamanho ou maior que a original não serve: volta a original (o PDF repete a logo em toda folha).
  if (saida.length >= buf.length) return original();
  const medidas = medidasDe(a, Math.round(w * escala), Math.round(h * escala), false);
  return { logo: `data:image/${formato};base64,${saida.toString('base64')}`, medidas };
}

const numSvg = (v: string | undefined): number => {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v ?? '');
  return m ? Number(m[1]) : NaN;
};

/** SVG não é rasterizado: o recorte vira um viewBox novo. Os pixels servem só para medir. */
async function ajustarSvg(sharp: Sharp, buf: Buffer): Promise<LogoAjustada | null> {
  const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
  const longo = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (!longo) return null;
  const p = await pixels(sharp, buf, { density: Math.min(2400, Math.max(10, (72 * 800) / longo)) });
  // Folga maior que a do bitmap: texto do SVG sai um pouco mais largo no navegador que aqui, e o viewBox corta.
  const a = analisar(p, 0.05);
  if (!a) return null;
  // Comentário sai antes de procurar a tag: um <svg> comentado não pode ser o que recebe o viewBox novo.
  const txt = buf.toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<svg\b[^>]*>/i.exec(txt);
  const attr = (n: string) => (tag ? new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag[0])?.[1] : undefined);
  let vb = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    const w0 = numSvg(attr('width')), h0 = numSvg(attr('height'));
    vb = w0 > 0 && h0 > 0 ? [0, 0, w0, h0] : [];
  }
  const { x0, y0, x1, y1 } = a.caixa;
  const mesmaForma = vb.length === 4 && Math.abs(p.W / p.H - vb[2] / vb[3]) / (vb[2] / vb[3]) < 0.02;
  const recorta = !!tag && mesmaForma && !/preserveAspectRatio\s*=\s*["']none/i.test(tag[0])
    && (x1 - x0 < p.W * 0.98 || y1 - y0 < p.H * 0.98);
  if (!recorta || !tag) return { logo: `data:image/svg+xml;base64,${buf.toString('base64')}`, medidas: medidasDe({ ...a, fundo: a.seloComMargem ? 'branco' : a.fundo }, p.W, p.H, true) };
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const novo = [vb[0] + (x0 / p.W) * vb[2], vb[1] + (y0 / p.H) * vb[3], ((x1 - x0) / p.W) * vb[2], ((y1 - y0) / p.H) * vb[3]].map(r3);
  const limpa = tag[0].replace(/\s(viewBox|width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const novaTag = limpa.replace(/^<svg\b/i, `<svg viewBox="${novo.join(' ')}" width="${x1 - x0}" height="${y1 - y0}"`);
  const svg = txt.slice(0, tag.index) + novaTag + txt.slice(tag.index + tag[0].length);
  return { logo: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`, medidas: medidasDe(a, x1 - x0, y1 - y0, true) };
}

/**
 * Ajusta a logo (data:image/...;base64) para o Moderno. Devolve a logo nova e as medidas; https, formato estranho,
 * imagem vazia ou qualquer erro devolve a original com medidas null (o template cai no desenho de antes).
 */
export async function ajustarLogo(dataUrl: string, opcoes: { prazoMs?: number } = {}): Promise<LogoAjustada> {
  const original: LogoAjustada = { logo: dataUrl, medidas: null };
  const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m || dataUrl.length > MAX_ENTRADA) return original;
  const chave = createHash('sha256').update(dataUrl).digest('hex');
  const guardada = memoria.get(chave);
  if (guardada) return guardada.r;
  const prazoMs = opcoes.prazoMs ?? PRAZO_MS;
  const trabalho = (async (): Promise<LogoAjustada> => {
    const mod = (await import('sharp')) as unknown as Sharp & { default?: Sharp };
    const sharp: Sharp = typeof mod.default === 'function' ? mod.default : mod;
    const buf = Buffer.from(m[2], 'base64');
    return (m[1] === 'svg+xml' ? await ajustarSvg(sharp, buf) : await ajustarBitmap(sharp, buf, m[1], dataUrl)) ?? original;
  })();
  trabalho.catch(() => undefined); // vencido o prazo, o erro que chegar depois não vira rejeição solta
  let relogio: NodeJS.Timeout | undefined;
  const prazo = new Promise<'prazo'>((ok) => { relogio = setTimeout(() => ok('prazo'), prazoMs); relogio.unref?.(); });
  let res: LogoAjustada;
  try {
    const r = await Promise.race([trabalho, prazo]);
    if (r === 'prazo') {
      // Vencido não entra na memória: a próxima proposta tenta de novo (o 1º carregamento do sharp é o mais lento).
      console.warn(`[logo-ajuste] prazo de ${prazoMs} ms vencido; sai a logo original`);
      return original;
    }
    res = r;
  } catch (e) {
    console.warn(`[logo-ajuste] erro ao ajustar a logo; sai a original: ${e instanceof Error ? e.message : String(e)}`);
    res = original;
  } finally {
    clearTimeout(relogio);
  }
  guardar(chave, res);
  return res;
}

/** Memória por hash, com teto de itens e de bytes. Resultado grande não é guardado. */
function guardar(chave: string, r: LogoAjustada): void {
  const bytes = r.logo.length + 200;
  if (bytes > MAIOR_ITEM) return;
  while (memoria.size && (memoria.size >= TETO_ITENS || bytesNaMemoria + bytes > TETO_BYTES)) {
    const [velha, item] = memoria.entries().next().value as [string, { bytes: number }];
    memoria.delete(velha);
    bytesNaMemoria -= item.bytes;
  }
  memoria.set(chave, { r, bytes });
  bytesNaMemoria += bytes;
}

/**
 * Empresa pronta para o template: só propostaSolar nos modelos 2 e 3 (Moderno) recebe a logo ajustada e as medidas
 * em `logo_ajuste`. Qualquer outro documento recebe a empresa como veio, sem custo.
 */
export async function empresaComLogoAjustada<T extends { logo_base64?: unknown }>(tipo: string, modelo: unknown, empresa: T): Promise<T> {
  if (tipo !== 'propostaSolar' || (modelo !== 2 && modelo !== 3) || !empresa) return empresa;
  const logo = String(empresa.logo_base64 || '').trim();
  if (!logo.startsWith('data:image/')) return empresa;
  const r = await ajustarLogo(logo);
  return r.medidas ? { ...empresa, logo_base64: r.logo, logo_ajuste: r.medidas } : empresa;
}

/** Só para teste: esvazia a memória em processo. */
export function limparMemoriaLogo(): void { memoria.clear(); bytesNaMemoria = 0; }
