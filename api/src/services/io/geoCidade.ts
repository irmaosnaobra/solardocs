// ─────────────────────────────────────────────────────────────────────────────
// CIDADE DIGITADA → COORDENADA, sem sair da máquina.
//
// A resolução acontece DENTRO da requisição que grava o cadastro, porque é ela
// que decide se o aviso no WhatsApp sai com a dica de quem está perto. Chamada
// externa nesse caminho é latência que a Vercel corta depois do `res.json`, e no
// caso do Nominatim é 1 requisição por segundo com lote proibido — o IP inteiro
// levaria throttle e derrubaria junto o raio da prospecção, que usa o mesmo
// geocodificador. Por isso aqui é 100% offline, contra a tabela do IBGE.
//
// O QUE NÃO SE FAZ AQUI: busca livre em geocodificador. Testado com as cidades
// reais desta base, `geocodificar()` (prospeccaoBriefService) devolveu uma
// AVENIDA para "Caruaru- pe" e uma PEDREIRA para "Barueri  SP" — coordenada
// plausível, lugar errado, sem erro nenhum no log.
// ─────────────────────────────────────────────────────────────────────────────
import municipios from '../../data/municipios.json';
import { normalizarCidade, chaveMunicipio } from './cidadeParse';

export interface Municipio { n: string; uf: string; ibge: number; lat: number; lng: number }

const LISTA = municipios as Municipio[];

/** chave do nome → municípios com aquele nome (505 nomes se repetem entre UFs). */
const PorNome = new Map<string, Municipio[]>();
for (const m of LISTA) {
  const k = chaveMunicipio(m.n);
  const atual = PorNome.get(k);
  if (atual) atual.push(m); else PorNome.set(k, [m]);
}

export type StatusGeo = 'ok' | 'ambigua' | 'nao_encontrada';

export interface CidadeResolvida {
  status: StatusGeo;
  /** Só em 'ok'. */
  municipio?: string;
  uf?: string;
  ibge?: number;
  lat?: number;
  lng?: number;
  /** Em 'ambigua': as opções que a equipe precisa desempatar. */
  candidatos?: string[];
  /** Por que não resolveu — entra na mensagem da equipe, não no log só. */
  motivo?: string;
}

/**
 * "Araguari-MG" → ok, -18.60/-48.26
 * "Osasco"      → ok (nome único no país, a UF vem de brinde)
 * "Petrolina"   → ok  ·  "Bom Jesus" → ambigua (5 municípios)
 * "Joinvikle"   → nao_encontrada (erro de digitação)
 *
 * A regra que manda: SEM UF declarada, só aceita nome único no país. Chutar o
 * primeiro resultado é como o mapa erra — e erra calado.
 */
export function resolverCidade(texto: string | null | undefined): CidadeResolvida {
  const p = normalizarCidade(texto);

  if (p.duasCidades) {
    return { status: 'nao_encontrada', motivo: 'o campo traz duas cidades' };
  }
  if (!p.cidade) {
    return { status: 'nao_encontrada', motivo: 'cidade em branco' };
  }

  const achados = PorNome.get(chaveMunicipio(p.cidade)) || [];

  if (p.uf) {
    const naUf = achados.filter(m => m.uf === p.uf);
    if (naUf.length === 1) return ok(naUf[0]);
    // Nome que não existe na UF declarada: a UF é o dado mais confiável do par
    // (foi escrita de propósito), então NÃO se cai fora dela em silêncio.
    if (naUf.length === 0 && achados.length > 0) {
      return { status: 'nao_encontrada',
               motivo: `"${p.cidade}" não existe em ${p.uf}` };
    }
  }

  if (achados.length === 1) return ok(achados[0]);
  if (achados.length > 1) {
    return {
      status: 'ambigua',
      candidatos: achados.map(m => `${m.n}-${m.uf}`),
      motivo: `"${p.cidade}" existe em ${achados.length} estados e a UF não veio`,
    };
  }
  return { status: 'nao_encontrada', motivo: `"${p.cidade}" não bate com município nenhum` };
}

function ok(m: Municipio): CidadeResolvida {
  return { status: 'ok', municipio: m.n, uf: m.uf, ibge: m.ibge, lat: m.lat, lng: m.lng };
}

/**
 * Distância em km entre dois pontos (Haversine).
 *
 * A coordenada de cada município é o centro do retângulo que o envolve, não a
 * sede — em município gigante (Altamira/PA tem 159 mil km²) o centro fica longe
 * da cidade. Serve pra ordenar "quem está mais perto" na escala de 100 a 400 km,
 * que é o uso aqui, e NÃO serve pra preço por km ou tempo de deslocamento.
 */
export function distanciaKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
          + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/** Quantos municípios a tabela conhece. Usado no teste que trava a base. */
export const TOTAL_MUNICIPIOS = LISTA.length;
