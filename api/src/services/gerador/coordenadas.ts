// Coordenadas do projeto ("latitude, longitude"): módulo puro, sem rede nem banco. Usado pelo cadastro (validação ao gravar) e
// pelo relatório de homologação (separa em latitude e longitude).

export type ResultadoCoordenadas = { ok: true; lat: number; lon: number; texto: string } | { ok: false; erro: string };
const ERRO_COORDENADAS = 'Coordenadas como o Google Maps copia: -18.912345, -48.275432.';

/**
 * "latitude, longitude" no formato que o Google Maps copia ("-18.912345, -48.275432"), com vírgula decimal ("-18,912345; -48,275432"),
 * ou com os pontos cardeais ("18.912345 S, 48.275432 W"). A latitude vai de -90 a 90 e a longitude de -180 a 180. Guardado com ponto
 * decimal, até 6 casas. Nunca devolve o valor digitado na mensagem de erro.
 */
export function lerCoordenadas(bruto: string): ResultadoCoordenadas {
  const t = String(bruto).trim().replace(/[°º]/g, '').replace(/(\d)\s+([NSEWLO])(?![A-Za-z])/gi, '$1$2');
  let partes: string[];
  if (t.includes(';')) partes = t.split(';');
  else {
    partes = t.split(/\s*,\s+|\s+/).filter(Boolean);
    if (partes.length !== 2 && !/\s/.test(t) && (t.match(/,/g) ?? []).length === 1) partes = t.split(',');
  }
  if (partes.length !== 2) return { ok: false, erro: ERRO_COORDENADAS };
  const um = (p: string, permitidas: string, neg: string): number | null => {
    const m = /^\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*([NSEWLO])?\s*$/i.exec(p);
    if (!m) return null;
    if (m[2] && !permitidas.includes(m[2].toUpperCase())) return null;   // letra trocada: latitude só N/S, longitude só E/W/L/O
    let n = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    if (m[2] && neg.includes(m[2].toUpperCase()) && n > 0) n = -n;
    return n;
  };
  const lat = um(partes[0], 'NS', 'S');
  const lon = um(partes[1], 'EWLO', 'WO');
  if (lat === null || lon === null) return { ok: false, erro: ERRO_COORDENADAS };
  if (lat < -90 || lat > 90) return { ok: false, erro: 'Latitude fora do intervalo (de -90 a 90).' };
  if (lon < -180 || lon > 180) return { ok: false, erro: 'Longitude fora do intervalo (de -180 a 180).' };
  const f = (n: number): string => String(Math.round(n * 1e6) / 1e6);
  return { ok: true, lat, lon, texto: `${f(lat)}, ${f(lon)}` };
}

