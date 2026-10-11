import { describe, it, expect } from 'vitest';
import { acharCidadePerto, montarPerto, coordenadaDaSede, type PontoMapa } from '../services/gerador/solarObras';
import { resolverCidade, distanciaKm } from '../services/io/geoCidade';

// ?perto=<cidade> do mapa do solar: achar a cidade (vários jeitos de escrever,
// desempate sem UF) e listar as cidades com obra por distância em linha reta.

/** Ponto do mapa como a rota monta: base do IBGE, com a sede no lugar do centro do território. */
function ponto(nome: string, uf: string, instaladas: number, emAndamento: number): PontoMapa {
  const r = resolverCidade(`${nome}-${uf}`);
  if (r.status !== 'ok') throw new Error(`cidade fora da base: ${nome}-${uf}`);
  return { cidade: r.municipio as string, uf: r.uf as string, ...coordenadaDaSede(r.municipio as string, r.uf as string, r.lat as number, r.lng as number), instaladas, emAndamento };
}

const MAPA: PontoMapa[] = [
  ponto('Uberlândia', 'MG', 31, 4),
  ponto('Araguari', 'MG', 2, 1),
  ponto('Uberaba', 'MG', 5, 0),
  ponto('Ituiutaba', 'MG', 1, 1),
  ponto('Monte Carmelo', 'MG', 0, 2),
  ponto('Patos de Minas', 'MG', 3, 0),
  ponto('Araxá', 'MG', 1, 0),
  ponto('Catalão', 'GO', 2, 0),
  ponto('Goiânia', 'GO', 4, 1),
  ponto('Belo Horizonte', 'MG', 1, 0),
  ponto('Brasília', 'DF', 0, 1),
];

describe('achar a cidade', () => {
  it('aceita os jeitos de escrever, com e sem UF, com acento e caixa', () => {
    for (const t of ['Araguari', 'araguari', 'Araguari/MG', 'Araguari, MG', 'Araguari - MG', 'Araguari-MG', '  ARAGUARI  /  mg ']) {
      expect(acharCidadePerto(t), t).toMatchObject({ cidade: 'Araguari', uf: 'MG' });
    }
    const a = acharCidadePerto('Araguari')!;
    expect(a.lat).toBeCloseTo(-18.6, 0);
    expect(a.lng).toBeCloseTo(-48.2, 0);
  });
  it('sem UF e em vários estados: MG primeiro, depois GO', () => {
    expect(acharCidadePerto('Formoso')).toMatchObject({ cidade: 'Formoso', uf: 'MG' });      // GO e MG
    expect(acharCidadePerto('Barro Alto')).toMatchObject({ cidade: 'Barro Alto', uf: 'GO' }); // BA e GO
    expect(acharCidadePerto('Hidrolândia')).toMatchObject({ cidade: 'Hidrolândia', uf: 'GO' }); // CE e GO
  });
  it('sem MG nem GO: a mais perto de Uberlândia', () => {
    const udi = resolverCidade('Uberlândia-MG') as { lat: number; lng: number };
    const pb = resolverCidade('Alagoinha-PB'), pe = resolverCidade('Alagoinha-PE');
    const esperada = distanciaKm(udi, pb as { lat: number; lng: number }) <= distanciaKm(udi, pe as { lat: number; lng: number }) ? 'PB' : 'PE';
    expect(acharCidadePerto('Alagoinha')).toMatchObject({ cidade: 'Alagoinha', uf: esperada });
  });
  it('UF escrita manda, mesmo fora de MG e GO', () => {
    expect(acharCidadePerto('Formoso/GO')).toMatchObject({ uf: 'GO' });
  });
  it('não achou: cidade inexistente, UF errada, duas cidades, vazio, lixo', () => {
    for (const t of ['Cidade Fantasma', 'Araguari/SP', 'Araguari e Uberaba', '', '   ', '<script>alert(1)</script>', "x'; drop table--"]) {
      expect(acharCidadePerto(t), t).toBeNull();
    }
  });
  it('texto enorme não derruba nem acha nada (corte em 80 caracteres)', () => {
    expect(acharCidadePerto('Araguari' + ' '.repeat(200))).toMatchObject({ cidade: 'Araguari' });
    expect(acharCidadePerto('x'.repeat(5000))).toBeNull();
  });
});

describe('as cidades com obra mais perto', () => {
  it('cidade com obra: ela mesma primeiro, km 0, depois por distância', () => {
    const p = montarPerto('Araguari - MG', MAPA)!;
    expect(p).toMatchObject({ cidade: 'Araguari', uf: 'MG' });
    expect(p.proximas[0]).toEqual({ cidade: 'Araguari', uf: 'MG', km: 0, instaladas: 2, emAndamento: 1 });
    expect(p.proximas[1]).toMatchObject({ cidade: 'Uberlândia', instaladas: 31, emAndamento: 4 });
    expect(p.proximas[1].km).toBeGreaterThan(20);
    expect(p.proximas[1].km).toBeLessThan(60);
    const kms = p.proximas.map((c) => c.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    expect(kms.every(Number.isInteger)).toBe(true);
  });
  it('no máximo 8, mesmo com mais cidades com obra', () => {
    const p = montarPerto('Araguari', MAPA)!;
    expect(MAPA.length).toBeGreaterThan(8);
    expect(p.proximas).toHaveLength(8);
    // as 3 mais longe ficam de fora: Belo Horizonte, Brasília e Goiânia/Catalão estão entre elas
    expect(p.proximas.map((c) => c.cidade)).not.toContain('Belo Horizonte');
  });
  it('cidade sem obra: lista as vizinhas e não se inclui', () => {
    const p = montarPerto('Tupaciguara', MAPA)!;
    expect(p).toMatchObject({ cidade: 'Tupaciguara', uf: 'MG' });
    expect(p.proximas.map((c) => c.cidade)).not.toContain('Tupaciguara');
    expect(p.proximas.slice(0, 2).map((c) => c.cidade).sort()).toEqual(['Araguari', 'Uberlândia']);   // as duas vizinhas de fato
    expect(p.proximas.length).toBeGreaterThan(3);
    expect(p.proximas[0].km).toBeGreaterThan(0);
    const kms = p.proximas.map((c) => c.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
  });
  it('cidade só com obra em andamento também entra, e obra zerada não', () => {
    const p = montarPerto('Monte Carmelo', [...MAPA, ponto('Estrela do Sul', 'MG', 0, 0)])!;
    expect(p.proximas[0]).toMatchObject({ cidade: 'Monte Carmelo', km: 0, instaladas: 0, emAndamento: 2 });
    expect(p.proximas.map((c) => c.cidade)).not.toContain('Estrela do Sul');
  });
  it('mapa vazio: acha a cidade e devolve lista vazia', () => {
    expect(montarPerto('Araguari', [])).toMatchObject({ cidade: 'Araguari', proximas: [] });
  });
  it('cidade inexistente: null', () => {
    expect(montarPerto('Cidade Fantasma', MAPA)).toBeNull();
  });
  it('só traz nome oficial e números: nada de cliente', () => {
    const p = montarPerto('Araguari', MAPA)!;
    for (const c of p.proximas) expect(Object.keys(c).sort()).toEqual(['cidade', 'emAndamento', 'instaladas', 'km', 'uf']);
    expect(Object.keys(p).sort()).toEqual(['cidade', 'lat', 'lng', 'proximas', 'uf']);
  });
});

// A base guarda o centro do TERRITÓRIO do município. Num mapa mostrado ao cliente,
// o pino de Catalão caía uns 30 km fora da cidade.
describe('sede no lugar do centro do território', () => {
  it('cidade com obra usa a coordenada da sede, com ou sem acento', () => {
    expect(coordenadaDaSede('Catalão', 'GO', -17.9785, -47.7194)).toEqual({ lat: -18.1659, lng: -47.9463 });
    expect(coordenadaDaSede('Uberlandia', 'mg', 0, 0)).toEqual({ lat: -18.9186, lng: -48.2772 });
  });
  it('cidade fora da lista fica com a coordenada da base', () => {
    expect(coordenadaDaSede('Goiânia', 'GO', -16.68, -49.25)).toEqual({ lat: -16.68, lng: -49.25 });
  });
  it('mesmo nome em outro estado não herda a sede', () => {
    expect(coordenadaDaSede('Sacramento', 'SP', 1, 2)).toEqual({ lat: 1, lng: 2 });
  });
  it('a cidade achada pelo texto e o ponto do mapa usam a MESMA coordenada', () => {
    const a = acharCidadePerto('Catalão/GO')!;
    expect({ lat: a.lat, lng: a.lng }).toEqual({ lat: -18.1659, lng: -47.9463 });
  });
});
