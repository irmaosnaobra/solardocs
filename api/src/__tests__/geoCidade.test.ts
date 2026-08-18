import { describe, it, expect } from 'vitest';
import { resolverCidade, distanciaKm, TOTAL_MUNICIPIOS } from '../services/io/geoCidade';

describe('a tabela de municípios', () => {
  it('tem os 5.570 municípios do Brasil', () => {
    // Se este número mudar sem alguém ter rodado gerar-municipios.mjs de
    // propósito, a tabela veio pela metade e metade do país deixa de resolver
    // — em silêncio, porque cidade não encontrada é um caminho normal.
    expect(TOTAL_MUNICIPIOS).toBe(5570);
  });
});

describe('resolverCidade — as strings reais da base', () => {
  it('resolve as que trazem UF', () => {
    expect(resolverCidade('Araguari-MG')).toMatchObject({ status: 'ok', municipio: 'Araguari', uf: 'MG' });
    expect(resolverCidade('Maceio-AL')).toMatchObject({ status: 'ok', municipio: 'Maceió', uf: 'AL' });
    expect(resolverCidade('Caruaru- pe')).toMatchObject({ status: 'ok', municipio: 'Caruaru', uf: 'PE' });
    expect(resolverCidade('Barueri  SP')).toMatchObject({ status: 'ok', municipio: 'Barueri', uf: 'SP' });
    expect(resolverCidade('Itapipoca/ceara')).toMatchObject({ status: 'ok', municipio: 'Itapipoca', uf: 'CE' });
    expect(resolverCidade('Divinopolis Minas gerais')).toMatchObject({ status: 'ok', municipio: 'Divinópolis', uf: 'MG' });
    expect(resolverCidade('Vitória da Conquista- Bahia')).toMatchObject({ status: 'ok', uf: 'BA' });
  });

  it('resolve SEM UF quando o nome é único no país', () => {
    // É o que salva 13 fichas que não trazem estado nenhum.
    for (const s of ['Osasco', 'Araguari', 'Divinopolis', 'Montes Claros', 'Aracaju',
                     'Aparecida de Goiânia', 'Foz Do IguaÇu', 'Lauro de freitas',
                     'São Domingos do Maranhão']) {
      expect(resolverCidade(s).status, s).toBe('ok');
    }
  });

  it('acento e caixa não impedem o casamento', () => {
    expect(resolverCidade('Maceio')).toMatchObject({ municipio: 'Maceió', uf: 'AL' });
    expect(resolverCidade('SÃo Paulo')).toMatchObject({ municipio: 'São Paulo', uf: 'SP' });
    expect(resolverCidade('Foz Do IguaÇu')).toMatchObject({ municipio: 'Foz do Iguaçu', uf: 'PR' });
  });

  it('erro de digitação vira nao_encontrada, não vira cidade errada', () => {
    expect(resolverCidade('Joinvikle').status).toBe('nao_encontrada');
    expect(resolverCidade('Iniuna').status).toBe('nao_encontrada');
  });

  it('duas cidades no campo não viram uma escolhida no chute', () => {
    const r = resolverCidade('Porto seguro e Eunapolis/ BA');
    expect(r.status).toBe('nao_encontrada');
    expect(r.motivo).toMatch(/duas cidades/);
  });

  it('nome repetido sem UF vira ambígua, com os candidatos na mão', () => {
    const r = resolverCidade('Bom Jesus');
    expect(r.status).toBe('ambigua');
    expect((r.candidatos || []).length).toBeGreaterThan(1);
    // A equipe precisa ver as opções pra desempatar com o lead numa pergunta só.
    expect(r.candidatos!.join(' ')).toMatch(/-/);
  });

  it('UF declarada manda: nome que não existe nela não cai pra outra', () => {
    // Araguari só existe em MG. Dizer "Araguari-SP" é erro do lead, e resolver
    // pra MG seria decidir por ele; resolver pra qualquer coisa em SP, pior.
    const r = resolverCidade('Araguari-SP');
    expect(r.status).toBe('nao_encontrada');
    expect(r.motivo).toMatch(/não existe em SP/);
  });

  it('vazio não explode', () => {
    expect(resolverCidade('').status).toBe('nao_encontrada');
    expect(resolverCidade(null).status).toBe('nao_encontrada');
  });
});

describe('distanciaKm', () => {
  const uberlandia = { lat: -19.0033, lng: -48.3633 };
  const araguari = { lat: -18.6048, lng: -48.2633 };
  const manaus = { lat: -2.5858, lng: -59.999 };

  it('mede vizinhas em dezenas de km', () => {
    const d = distanciaKm(uberlandia, araguari);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(70);
  });

  it('mede o outro lado do país em milhares', () => {
    expect(distanciaKm(uberlandia, manaus)).toBeGreaterThan(2000);
  });

  it('o mesmo ponto dá zero', () => {
    expect(distanciaKm(uberlandia, uberlandia)).toBe(0);
  });

  it('é simétrica', () => {
    expect(distanciaKm(uberlandia, manaus)).toBe(distanciaKm(manaus, uberlandia));
  });
});
