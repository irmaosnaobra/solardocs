// Logo do integrador ajustada para o Moderno (logoAjuste.ts e propostaModernoLogo.ts). As imagens de teste são
// geradas aqui com o sharp: nenhum arquivo binário no repositório.
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { ajustarLogo, empresaComLogoAjustada, limparMemoriaLogo, type LogoMedidas } from '../services/templates/logoAjuste';
import { generateFromTemplate } from '../services/templateService';
import { cenariosModerno } from './fixtures/propostaModernoDados';

const svg = (w: number, h: number, corpo: string, fundo = '') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${fundo ? `<rect width="100%" height="100%" fill="${fundo}"/>` : ''}${corpo}</svg>`);
const rect = (x: number, y: number, w: number, h: number, cor: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${cor}"/>`;
// Marca que não é um retângulo cheio (retângulo cheio é selo): um círculo e duas barras de tamanhos diferentes.
const marca = (x: number, y: number, w: number, h: number, cor: string) =>
  `<circle cx="${x + h / 2}" cy="${y + h / 2}" r="${h / 2}" fill="${cor}"/>` + rect(x + h * 1.2, y, w - h * 1.2, h * 0.55, cor) + rect(x + h * 1.2, y + h * 0.75, (w - h * 1.2) * 0.5, h * 0.25, cor);
const png = async (b: Buffer) => `data:image/png;base64,${(await sharp(b).png().toBuffer()).toString('base64')}`;
const jpg = async (b: Buffer) => `data:image/jpeg;base64,${(await sharp(b).flatten({ background: '#fff' }).jpeg({ quality: 85 }).toBuffer()).toString('base64')}`;
const decodifica = (url: string) => Buffer.from(url.split(',')[1], 'base64');
const medidas = (r: { medidas: LogoMedidas | null }) => r.medidas as LogoMedidas;

describe('ajustarLogo: os casos de logo mal recortada', () => {
  beforeEach(() => limparMemoriaLogo());

  it('1. margem enorme e fora do centro: recorta o conteúdo', async () => {
    const r = await ajustarLogo(await png(svg(1600, 1200, marca(200, 300, 400, 100, '#14324F'))));
    const m = medidas(r);
    expect(m.fundo).toBe('transparente');
    expect(m.w).toBeGreaterThanOrEqual(400);
    expect(m.w).toBeLessThan(430);
    expect(m.proporcao).toBeGreaterThan(3.5);
    expect(m.proporcao).toBeLessThan(4.3);
    expect(r.logo).toMatch(/^data:image\/png;base64,/);
  });

  it('2. JPG com fundo quase branco: o fundo vira branco puro (some na folha) e continua JPG', async () => {
    const r = await ajustarLogo(await jpg(svg(900, 600, marca(300, 250, 300, 100, '#0B3B66'), '#FAFAF8')));
    expect(medidas(r).fundo).toBe('branco');
    expect(r.logo).toMatch(/^data:image\/jpeg;base64,/);
    const { data } = await sharp(decodifica(r.logo)).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(data[0], data[1], data[2])).toBeGreaterThanOrEqual(254);   // canto: branco puro, não #FAFAF8
  });

  it('2b. PNG com fundo branco: o branco ligado à borda vira transparente', async () => {
    const r = await ajustarLogo(await png(svg(900, 600, marca(300, 250, 300, 100, '#0B3B66'), '#FAFAF8')));
    expect(medidas(r).fundo).toBe('branco');
    const { data, info } = await sharp(decodifica(r.logo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);                                     // canto: transparente
    const meio = (Math.floor(info.height * 0.2) * info.width + Math.floor(info.width * 0.6)) * 4;
    expect(data[meio + 3]).toBe(255);                            // barra da marca: opaca
  });

  it('3. retângulo preto com a marca dentro: vira selo, mantém a forma e a cor', async () => {
    const r = await ajustarLogo(await jpg(svg(1000, 700, rect(140, 190, 720, 320, '#111111') + rect(300, 320, 400, 60, '#FFFFFF'), '#FFFFFF')));
    const m = medidas(r);
    expect(m.fundo).toBe('solido');
    expect(m.cor).toBe('#111111');
    expect(m.proporcao).toBeGreaterThan(2.1);
    expect(m.proporcao).toBeLessThan(2.4);
    expect(r.logo).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('3b. fundo colorido até a borda: selo quadrado continua quadrado', async () => {
    const r = await ajustarLogo(await png(svg(600, 600, rect(250, 200, 100, 200, '#FFFFFF'), '#1D4ED8')));
    const m = medidas(r);
    expect(m.fundo).toBe('solido');
    expect(m.cor).toBe('#1D4ED8');
    expect(m.proporcao).toBeCloseTo(1, 1);
    expect(m.w).toBeLessThan(600);                               // a sobra de azul saiu
  });

  it('4. logo branca em fundo transparente: marcada como clara', async () => {
    const r = await ajustarLogo(await png(svg(1200, 500, marca(200, 200, 700, 120, '#FFFFFF'))));
    expect(medidas(r).clara).toBe(true);
    const escura = await ajustarLogo(await png(svg(1200, 500, marca(200, 200, 700, 120, '#14324F'))));
    expect(medidas(escura).clara).toBe(false);
  });

  it('5. proporções extremas: larga, quadrada e alta medidas certo', async () => {
    const larga = medidas(await ajustarLogo(await png(svg(2400, 200, marca(20, 50, 2200, 100, '#14532D')))));
    const quadrada = medidas(await ajustarLogo(await png(svg(800, 800, '<circle cx="400" cy="400" r="300" fill="#EA580C"/>'))));
    const alta = medidas(await ajustarLogo(await png(svg(300, 900, '<circle cx="150" cy="150" r="100" fill="#DC2626"/>' + rect(110, 300, 80, 550, '#DC2626')))));
    expect(larga.proporcao).toBeGreaterThan(12);
    expect(quadrada.proporcao).toBeCloseTo(1, 1);
    expect(quadrada.fundo).toBe('transparente');
    expect(alta.proporcao).toBeLessThan(0.3);
    expect(alta.fundo).toBe('transparente');
  });

  it('6. logo pequena: medida no tamanho do arquivo e nunca regravada maior', async () => {
    const url = await png(svg(120, 40, marca(4, 6, 112, 28, '#0F172A')));
    const r = await ajustarLogo(url);
    const m = medidas(r);
    expect(m.w).toBeLessThanOrEqual(120);
    expect(r.logo.length).toBeLessThanOrEqual(url.length);
    const meta = await sharp(decodifica(r.logo)).metadata();
    expect(meta.width).toBeLessThanOrEqual(120);
  });

  it('foto ou degradê (misto) leve: devolve os bytes originais, com medidas', async () => {
    const degrade = `<defs><linearGradient id="g"><stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
    for (const f of ['png', 'webp'] as const) {
      const b = await sharp(svg(400, 200, degrade))[f]().toBuffer();
      const url = `data:image/${f};base64,${b.toString('base64')}`;
      const r = await ajustarLogo(url);
      expect(r.logo).toBe(url);
      expect(medidas(r).fundo).toBe('misto');
      expect(medidas(r).proporcao).toBeCloseTo(2, 1);
    }
  });

  it('logo pesada (WEBP com ruído, 1600 px) sai menor que a entrada e no máximo com 1240 px', async () => {
    const W = 1600, H = 800, ruido = Buffer.alloc(W * H * 3);
    for (let i = 0; i < ruido.length; i++) ruido[i] = Math.floor(Math.random() * 256);
    const b = await sharp(ruido, { raw: { width: W, height: H, channels: 3 } }).webp({ lossless: true }).toBuffer();
    const url = `data:image/webp;base64,${b.toString('base64')}`;
    expect(b.length).toBeGreaterThan(300 * 1024);
    const r = await ajustarLogo(url);
    expect(r.logo.length).toBeLessThan(url.length);
    const meta = await sharp(decodifica(r.logo)).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1240);
    expect(medidas(r).w).toBe(1600);                            // tamanho natural continua o do arquivo
  });

  it('em nenhum dos casos a logo regravada fica maior que a original', async () => {
    const entradas = [
      await png(svg(1600, 1200, marca(200, 300, 400, 100, '#14324F'))),
      await jpg(svg(900, 600, marca(300, 250, 300, 100, '#0B3B66'), '#FAFAF8')),
      await jpg(svg(1000, 700, rect(140, 190, 720, 320, '#111111') + rect(300, 320, 400, 60, '#FFFFFF'), '#FFFFFF')),
      await png(svg(300, 900, '<circle cx="150" cy="150" r="100" fill="#DC2626"/>' + rect(110, 300, 80, 550, '#DC2626'))),
    ];
    for (const url of entradas) expect((await ajustarLogo(url)).logo.length).toBeLessThanOrEqual(url.length);
  });

  it('prazo vencido: devolve a original sem medidas e não guarda na memória', async () => {
    const url = await png(svg(1600, 1200, marca(200, 300, 400, 100, '#14324F')));
    const vencido = await ajustarLogo(url, { prazoMs: 0 });
    expect(vencido).toEqual({ logo: url, medidas: null });
    expect((await ajustarLogo(url)).medidas?.fundo).toBe('transparente');   // a 2ª tentativa ajusta de verdade
  });

  it('7. SVG não é rasterizado: o recorte vira viewBox', async () => {
    const entrada = `data:image/svg+xml;base64,${svg(1000, 1000, marca(400, 400, 200, 100, '#7C3AED')).toString('base64')}`;
    const r = await ajustarLogo(entrada);
    expect(r.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    const txt = decodifica(r.logo).toString('utf8');
    const vb = /<svg viewBox="([^"]+)"/.exec(txt)?.[1].split(' ').map(Number) ?? [];
    expect(vb[0]).toBeGreaterThan(380); expect(vb[0]).toBeLessThan(400);   // folga pequena antes do conteúdo
    expect(vb[2]).toBeGreaterThan(200); expect(vb[2]).toBeLessThan(240);
    expect(txt).toContain('<circle cx="450" cy="450"');                   // desenho intacto, não virou bitmap
    expect(medidas(r).vetor).toBe(true);
  });

  it('SVG com <svg> comentado antes da tag de verdade: o recorte vai na tag certa', async () => {
    const corpo = svg(1000, 1000, marca(400, 400, 200, 100, '#7C3AED')).toString('utf8');
    const comComentario = `<?xml version="1.0"?>\n<!-- antigo: <svg viewBox="0 0 1 1" width="1" height="1"> -->\n${corpo}`;
    const r = await ajustarLogo(`data:image/svg+xml;base64,${Buffer.from(comComentario).toString('base64')}`);
    const txt = decodifica(r.logo).toString('utf8');
    expect(txt).not.toContain('<!--');
    const vb = /<svg viewBox="([^"]+)"/.exec(txt)?.[1].split(' ').map(Number) ?? [];
    expect(vb[0]).toBeGreaterThan(380);
    expect(vb[2]).toBeGreaterThan(200);
    expect(txt.match(/<svg\b/g)).toHaveLength(1);
  });

  it('erro, https e imagem vazia devolvem a original sem medidas', async () => {
    expect(await ajustarLogo('data:image/png;base64,iVBORw0KGgo=')).toEqual({ logo: 'data:image/png;base64,iVBORw0KGgo=', medidas: null });
    expect(await ajustarLogo('https://cdn.example/logo.png')).toEqual({ logo: 'https://cdn.example/logo.png', medidas: null });
    const vazia = await png(svg(400, 200, ''));
    expect((await ajustarLogo(vazia)).medidas).toBeNull();
  });

  it('a mesma logo sai da memória na segunda vez (mesmo objeto)', async () => {
    const url = await png(svg(600, 300, rect(100, 100, 300, 80, '#000000')));
    expect(await ajustarLogo(url)).toBe(await ajustarLogo(url));
  });
});

describe('empresaComLogoAjustada: só o Moderno', () => {
  it('modelos 1 e 4 e outros documentos recebem a empresa como veio', async () => {
    const url = await png(svg(600, 300, marca(100, 100, 300, 80, '#000000')));
    const emp = { nome: 'X', logo_base64: url };
    expect(await empresaComLogoAjustada('propostaSolar', 1, emp)).toBe(emp);
    expect(await empresaComLogoAjustada('propostaSolar', 4, emp)).toBe(emp);
    expect(await empresaComLogoAjustada('contratoSolar', 2, emp)).toBe(emp);
    const m3 = await empresaComLogoAjustada('propostaSolar', 3, emp) as typeof emp & { logo_ajuste?: LogoMedidas };
    expect(m3.logo_ajuste?.fundo).toBe('transparente');
    expect(m3.logo_base64).not.toBe(url);
  });
});

describe('Moderno com a logo ajustada', () => {
  const c = cenariosModerno[0];
  const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
  const gera = (m: Partial<LogoMedidas>, modelo: 1 | 2 | 3 | 4 = 3) => generateFromTemplate('propostaSolar',
    { ...c.empresa, logo_base64: LOGO, logo_ajuste: { w: 800, h: 200, proporcao: 4, clara: false, fundo: 'transparente', cor: '', vetor: false, ...m } },
    c.cliente, c.campos, modelo);
  const tam = (h: string, i = 0) => [...h.matchAll(/<img class="aj[^"]*" src="[^"]*" alt="[^"]*" width="(\d+)" height="(\d+)"/g)].map((x) => [Number(x[1]), Number(x[2])])[i];

  it('a mesma área para logo larga, quadrada e alta, dentro do teto do palco', () => {
    const larga = tam(gera({ proporcao: 12, w: 2400, h: 200 })), quadrada = tam(gera({ proporcao: 1, w: 800, h: 800 })), alta = tam(gera({ proporcao: 0.33, w: 300, h: 900 }));
    expect(larga[0]).toBeLessThanOrEqual(620);
    expect(quadrada[0] * quadrada[1]).toBeGreaterThan(120000);
    expect(alta[1]).toBeLessThanOrEqual(420);
    expect(alta[1]).toBeGreaterThan(300);
  });

  it('bitmap pequeno não passa de 2x o tamanho natural; SVG passa', () => {
    expect(tam(gera({ w: 90, h: 32, proporcao: 2.8 }))[0]).toBeLessThanOrEqual(180);
    expect(tam(gera({ w: 90, h: 32, proporcao: 2.8, vetor: true }))[0]).toBeGreaterThan(400);
  });

  it('logo clara vai para o palco escuro e para a placa do topo', () => {
    const h = gera({ clara: true });
    expect(h).toContain('class="palco aj escuro"');
    expect(h).toContain('<span class="placa"><img class="aj"');
  });

  it('selo ganha canto arredondado; modelo 2 só muda o topo', () => {
    expect(gera({ fundo: 'solido', cor: '#111111' })).toMatch(/class="aj selo"[^>]*border-radius:\d+px/);
    const m2 = gera({}, 2);
    expect(m2).not.toContain('class="page capa"');
    expect(m2).toContain('<div class="hd"><img class="aj"');
  });

  it('medidas inválidas e modelos 1 e 4 ignoram o ajuste', () => {
    const lixo = generateFromTemplate('propostaSolar', { ...c.empresa, logo_base64: LOGO, logo_ajuste: { w: 'x" onload="1', proporcao: 4 } }, c.cliente, c.campos, 3);
    expect(lixo).not.toContain('class="palco aj');
    expect(lixo).not.toContain('onload');
    for (const m of [1, 4] as const) {
      const com = generateFromTemplate('propostaSolar', { ...c.empresa, logo_base64: LOGO, logo_ajuste: { w: 800, h: 200, proporcao: 4, clara: true, fundo: 'solido', cor: '#000000', vetor: false } }, c.cliente, c.campos, m);
      const sem = generateFromTemplate('propostaSolar', { ...c.empresa, logo_base64: LOGO }, c.cliente, c.campos, m);
      expect(com).toBe(sem);
    }
  });
});
