import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A IA escolhe; o código valida. Estes testes cobrem o "valida" — que é a parte
// que não pode depender de o modelo ter acertado.

let respostaDoModelo = '';
const criar = vi.fn(async () => ({ content: [{ type: 'text', text: respostaDoModelo }] }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: criar }; constructor(_o: unknown) {} },
}));

import { montarBusca, codigoIbge, custoEstimado, circuloGeoJson, ACTOR_CNPJ, ACTOR_MAPS } from '../services/io/prospeccaoBriefService';

const MUNICIPIOS_MG = [
  { id: 3170206, nome: 'Uberlândia' },
  { id: 3106200, nome: 'Belo Horizonte' },
];

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste';
  criar.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/localidades/estados/MG/municipios')) {
      return new Response(JSON.stringify(MUNICIPIOS_MG), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('brief → plano de busca', () => {
  it('pedido com "dono" cai na Receita, com CNAE e município virando código IBGE', async () => {
    respostaDoModelo = JSON.stringify({
      fonte: 'receita_cnpj',
      input: { cnae: '4731-8/00', uf: 'mg', municipio_nome: 'uberlandia' },
      limite: 200, so_celular: true,
      lista_nome: 'Postos — Uberlândia (Receita)',
      explicacao: 'Só a Receita traz o quadro de sócios.',
      avisos: ['Não vem nota do Google.'],
    });
    const p = await montarBusca('preciso de postos de combustível em Uberlândia, quero falar com o dono');

    expect(p.fonte).toBe('receita_cnpj');
    expect(p.actor_id).toBe(ACTOR_CNPJ);
    expect(p.input.cnae).toBe('4731800');            // só dígitos
    expect(p.input.uf).toBe('MG');
    expect(p.input.municipio).toBe('3170206');       // resolvido no IBGE, não chutado
    expect(p.input.municipio_nome).toBeUndefined();
    expect(p.input.maxItems).toBe(200);
    // telefone da Receita é fixo: manter "só celular" jogaria a lista inteira fora
    expect(p.so_celular).toBe(false);
    expect(p.avisos.join(' ')).toMatch(/fixo/i);
    expect(p.custo_estimado_usd).toBeCloseTo(200 * 0.0009 + 0.00005, 4);
  });

  it('município que não existe vira busca do estado, com aviso — nunca a cidade errada', async () => {
    respostaDoModelo = JSON.stringify({
      fonte: 'receita_cnpj', input: { cnae: '4731800', uf: 'MG', municipio_nome: 'Cidade Inventada' },
      limite: 50, lista_nome: 'x', explicacao: 'y', avisos: [],
    });
    const p = await montarBusca('postos na cidade inventada, falar com o dono');
    expect(p.input.municipio).toBeUndefined();
    expect(p.avisos.join(' ')).toMatch(/estado inteiro/i);
  });

  it('pedido de WhatsApp/nota cai no Maps, com pt-BR e teto aplicado', async () => {
    respostaDoModelo = JSON.stringify({
      fonte: 'google_maps',
      input: { searchStringsArray: ['energia solar'], locationQuery: 'Bahia, Brasil',
               placeMinimumStars: 'four', website: 'withoutWebsite', skipClosedPlaces: true },
      limite: 5000,                                   // acima do teto de propósito
      so_celular: true, lista_nome: 'Solares BA', explicacao: 'z', avisos: [],
    });
    const p = await montarBusca('integradores solares na Bahia com nota boa e sem site');

    expect(p.actor_id).toBe(ACTOR_MAPS);
    expect(p.limite).toBe(300);                       // teto do motor manda
    expect(p.input.maxCrawledPlacesPerSearch).toBe(300);
    expect(p.input.language).toBe('pt-BR');
    expect(p.input.countryCode).toBe('br');
    expect(p.input.skipClosedPlaces).toBe(false);     // fechado a gente corta de graça no import
    expect(p.so_celular).toBe(true);
  });

  it('add-on caro sugerido pelo modelo é removido antes de chegar na tela', async () => {
    respostaDoModelo = JSON.stringify({
      fonte: 'google_maps',
      input: { searchStringsArray: ['posto'], locationQuery: 'MG',
               maximumLeadsEnrichmentRecords: 5, verifyLeadsEnrichmentEmails: true },
      limite: 50, lista_nome: 'x', explicacao: 'y', avisos: [],
    });
    const p = await montarBusca('postos em minas com contato dos gerentes');
    expect(p.input.maximumLeadsEnrichmentRecords).toBeUndefined();
    expect(p.input.verifyLeadsEnrichmentEmails).toBeUndefined();
  });

  it('resposta do modelo com cerca de markdown ainda é lida', async () => {
    respostaDoModelo = '```json\n' + JSON.stringify({
      fonte: 'google_maps', input: { searchStringsArray: ['padaria'], locationQuery: 'Salvador' },
      limite: 25, lista_nome: 'Padarias', explicacao: 'ok', avisos: [],
    }) + '\n```';
    const p = await montarBusca('padarias em salvador');
    expect(p.input.searchStringsArray).toEqual(['padaria']);
  });

  it('sem o que buscar, falha com recado em português em vez de rodar vazio', async () => {
    respostaDoModelo = JSON.stringify({ fonte: 'google_maps', input: {}, limite: 50, lista_nome: 'x', explicacao: '', avisos: [] });
    await expect(montarBusca('quero uma lista boa')).rejects.toThrow(/o que buscar/i);
  });

  it('sem ANTHROPIC_API_KEY o erro manda montar na mão, sem chamar modelo', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(montarBusca('postos de combustível em uberlandia')).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(criar).not.toHaveBeenCalled();
  });

  it('brief curto demais nem chega no modelo', async () => {
    await expect(montarBusca('oi')).rejects.toThrow(/detalhe/i);
    expect(criar).not.toHaveBeenCalled();
  });
});

describe('raio', () => {
  it('vira raio_km + centro, com aviso e teto de 500 km', async () => {
    respostaDoModelo = JSON.stringify({
      fonte: 'google_maps',
      input: { searchStringsArray: ['posto de combustível'], raio_km: 9000, centro: 'Uberlândia, MG' },
      limite: 200, lista_nome: 'Postos 300km', explicacao: 'raio pedido', avisos: [],
    });
    const p = await montarBusca('postos de combustível num raio de 300 km de Uberlândia');
    expect(p.input.raio_km).toBe(500);                  // teto
    expect(p.input.centro).toBe('Uberlândia, MG');
    expect(p.avisos.join(' ')).toMatch(/área circular/i);
  });

  it('raio sem centro é descartado, e sem lugar nenhum a busca nem sai', async () => {
    respostaDoModelo = JSON.stringify({
      fonte: 'google_maps', input: { searchStringsArray: ['posto'], raio_km: 100 },
      limite: 50, lista_nome: 'x', explicacao: '', avisos: [],
    });
    await expect(montarBusca('postos num raio grande')).rejects.toThrow(/onde buscar/i);
  });

  it('círculo sai em GeoJSON com [longitude, latitude] e fechado', () => {
    const c = circuloGeoJson(-18.9186, -48.2772, 300) as any;   // Uberlândia
    expect(c.type).toBe('Polygon');
    const anel = c.coordinates[0];
    expect(anel.length).toBe(33);                                // 32 lados + fecha
    expect(anel[0]).toEqual(anel[anel.length - 1]);
    const [lng, lat] = anel[0];
    expect(lng).toBeLessThan(-40);                               // longitude do Brasil é negativa e < -40
    expect(lat).toBeGreaterThan(-25);                            // latitude de Uberlândia, não do oceano
    // ~300 km ≈ 2,7° de latitude
    const lats = anel.map((p: number[]) => p[1]);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(2 * 300 / 111.32, 1);
  });
});

describe('peças que a IA não decide', () => {
  it('codigoIbge acha por nome sem acento e sem caixa', async () => {
    expect(await codigoIbge('MG', 'UBERLANDIA')).toBe('3170206');
    expect(await codigoIbge('MG', 'belo horizonte')).toBe('3106200');
    expect(await codigoIbge('MG', 'Nárnia')).toBeNull();
  });

  it('custo do Maps soma filtro e add-on por lugar', () => {
    expect(custoEstimado('google_maps', 100, {})).toBeCloseTo(0.4, 2);
    expect(custoEstimado('google_maps', 100, { placeMinimumStars: 'four' })).toBeCloseTo(0.5, 2);
    expect(custoEstimado('google_maps', 100, { placeMinimumStars: 'four', scrapeContacts: true })).toBeCloseTo(0.7, 2);
    expect(custoEstimado('receita_cnpj', 1000, {})).toBeCloseTo(0.9, 2);
  });
});
