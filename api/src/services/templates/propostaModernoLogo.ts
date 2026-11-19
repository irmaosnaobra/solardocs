// Logo do integrador no Moderno (propostaSolar, modelos 2 e 3) quando ela chega ajustada pelo servidor
// (logoAjuste.ts, 18/11/2026). O tamanho sai daqui em px, já decidido: o PDF roda sem JavaScript.
// Regra do tamanho: a mesma ÁREA para toda proporção (logo larga, quadrada e alta pesam igual na folha), dentro de
// um teto de largura e altura; bitmap não passa de 2x o tamanho natural (não borra); SVG estica à vontade.
// Logo clara (feita para fundo escuro) vai sobre uma placa escura; selo (retângulo de uma cor) ganha canto e sombra.
import { pEsc } from '../propostaSolarBase';
import type { FundoLogo, LogoMedidas } from './logoAjuste';

const FUNDOS: FundoLogo[] = ['transparente', 'branco', 'solido', 'misto'];

/** Confere as medidas que vieram pela empresa: vão para atributo e estilo inline, então só número e cor #RRGGBB. */
export function medidasLogo(v: unknown): LogoMedidas | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  const w = n(o.w), h = n(o.h), r = n(o.proporcao);
  if (!w || !h || r < 0.05 || r > 40) return null;
  return {
    w, h, proporcao: r, clara: o.clara === true,
    fundo: FUNDOS.includes(o.fundo as FundoLogo) ? (o.fundo as FundoLogo) : 'misto',
    cor: typeof o.cor === 'string' && /^#[0-9A-F]{6}$/i.test(o.cor) ? o.cor : '',
    vetor: o.vetor === true,
  };
}

interface Caixa { area: number; maxW: number; maxH: number; minH: number }

function tamanho(m: LogoMedidas, c: Caixa): { w: number; h: number } {
  const r = m.proporcao;
  let h = Math.max(c.minH, Math.min(c.maxH, Math.sqrt(c.area / r)));
  let w = h * r;
  if (w > c.maxW) { w = c.maxW; h = w / r; }
  if (!m.vetor) {
    const k = Math.min(1, (m.w * 2) / w, (m.h * 2) / h);
    w *= k; h *= k;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

const selo = (m: LogoMedidas) => m.fundo === 'solido' || m.fundo === 'misto';
const raio = (w: number, h: number, f: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, Math.min(w, h) * f)));

function img(src: string, alt: string, t: { w: number; h: number }, classe: string, r = 0): string {
  return `<img class="${classe}" src="${pEsc(src)}" alt="${pEsc(alt)}" width="${t.w}" height="${t.h}" style="width:${t.w}px;height:${t.h}px${r ? `;border-radius:${r}px` : ''}"/>`;
}

/** Palco da capa (modelo 3). A altura acompanha a logo: logo baixa e larga não deixa um vazio branco em cima. */
export function palcoLogo(src: string, alt: string, m: LogoMedidas): string {
  const s = selo(m);
  const t = tamanho(m, s
    ? { area: 100000, maxW: 540, maxH: 330, minH: 120 }
    : { area: 135000, maxW: 620, maxH: m.proporcao < 0.8 ? 420 : 370, minH: 96 });  // logo alta ganha mais altura
  const altura = Math.round(Math.min(620, Math.max(470, t.h + 250)));
  const classe = `aj${s ? ' selo' : ''}`;
  return `<div class="palco aj${m.clara ? ' escuro' : ''}" style="height:${altura}px">${img(src, alt, t, classe, s ? raio(t.w, t.h, 0.08, 6, 20) : 0)}</div>`;
}

/** Logo no topo de cada folha. */
export function topoLogo(src: string, alt: string, m: LogoMedidas): string {
  if (m.clara) return `<span class="placa">${img(src, alt, tamanho(m, { area: 1700, maxW: 150, maxH: 26, minH: 18 }), 'aj')}</span>`;
  if (selo(m)) {
    const t = tamanho(m, { area: 2600, maxW: 160, maxH: 42, minH: 30 });
    return img(src, alt, t, 'aj', raio(t.w, t.h, 0.12, 3, 6));
  }
  return img(src, alt, tamanho(m, { area: 2600, maxW: 180, maxH: m.proporcao < 0.8 ? 46 : 40, minH: 24 }), 'aj');
}
