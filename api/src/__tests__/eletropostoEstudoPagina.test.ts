import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/estudoFichas.json';
import {
  extrairFicha, extrairEndereco, preNota, notaDoLocal, sinaisDeAtencao, situacao, resumirLugares,
  validarTextoIA, montarFatosIA, BASE_ESTUDO_URL, type DadosEstudo, type LugarGoogle, type Ficha,
} from '../services/io/eletropostoEstudoPuro';
import { contaDeReferencia } from '../utils/computeEletro';
import {
  esc, imagensPermitidas, renderEstudo, paginaPreparando, pagina404, svgMedidor, svgBarras,
  svgBarrasComparadas, svgFluxo10Anos, type LinhaEstudo, type ReuniaoEstudo, type StatusEstudo,
} from '../services/io/eletropostoEstudoPagina';

const obsDe = (trecho: string): string => {
  const f = fixtures.fichas.find(x => x.caso.includes(trecho));
  if (!f) throw new Error(`fixture sem o caso ${trecho}`);
  return f.observacao;
};

const DIA = 86_400_000;
const TOKEN = 'ab'.repeat(32);
const QUANDO = '2026-09-17T17:00:00Z';
const AGORA = Date.parse('2026-09-16T12:00:00Z');
const CENTRO = { lat: -19.747, lng: -47.939 };
const TELEFONE = '34999998888';
const OBS_POSTO = `${obsDe('dono de posto')}\nWhatsApp: ${TELEFONE}`;
const OBS_ANTIGA = obsDe('travessao antigo');
const TRAVESSOES = /[–—]|&mdash;|&ndash;|&#8212;|&#8211;/;

const lugar = (id: string, nome: string, tipo: string, dLat: number, dLng: number): LugarGoogle => ({
  id, displayName: { text: nome }, primaryType: tipo, types: [tipo],
  location: { latitude: CENTRO.lat + dLat, longitude: CENTRO.lng + dLng },
});

function dadosCompletos(o: { ficha?: Partial<Ficha> } = {}): DadosEstudo {
  const fichaLida = extrairFicha(OBS_POSTO);
  const endereco = extrairEndereco(OBS_POSTO);
  const ficha: Ficha = { ...fichaLida, decisor: 'socio', ...o.ficha };
  const entorno = resumirLugares([
    lugar('p1', 'Auto Posto Exemplo', 'gas_station', 0, 0.0003),
    lugar('p2', 'Mercado Bom Preço', 'supermarket', 0.001, 0.001),
    lugar('p3', 'Restaurante da Praça', 'brazilian_restaurant', -0.002, 0.001),
    lugar('p4', 'Farmácia Central', 'pharmacy', 0.003, -0.002),
    lugar('p5', '<script>alert(1)</script>', 'gym', -0.003, -0.003),
    lugar('p6', 'Hotel Estrada', 'hotel', 0.004, 0.004),
    lugar('p7', 'Lava Rápido', 'car_wash', -0.005, 0.002),
    lugar('p8', 'Hospital Regional', 'hospital', 0.006, -0.001),
  ], CENTRO, 1000);
  const recarga = resumirLugares([
    lugar('c1', 'Eletroposto Centro', 'electric_vehicle_charging_station', 0.009, 0.009),
    lugar('c2', 'Shopping Recarga', 'electric_vehicle_charging_station', -0.02, 0.01),
  ], CENTRO, 5000, 'Carregador');
  const municipio = {
    ibge: 3170107, nome: 'Uberaba', uf: 'MG', pop_2026: 350000, pib_pc_2023: 52000.4, frota: 250000,
    plugin: 900, por_mil: 3.6, uf_por_mil: 2.9, br_por_mil: 3.1, ref: 'julho de 2026',
  };
  const sinais = sinaisDeAtencao({
    ficha, endereco, confianca: 'alta',
    estabelecimento: { nome: 'Auto Posto Exemplo', tipo: 'Posto de combustível' },
  });
  const d: DadosEstudo = {
    ficha,
    endereco_digitado: endereco,
    local: {
      place_id: 'ChIJexemplo123', lat: CENTRO.lat, lng: CENTRO.lng,
      formatado: 'Av. Brasil, 3200, Distrito Industrial, Uberaba, MG, 38000-000, Brasil',
      estabelecimento: { nome: 'Auto Posto Exemplo', tipo: 'Posto de combustível', status: 'OPERATIONAL' },
      rodovia: false,
    },
    confianca: 'alta',
    entorno,
    recarga,
    rua: { pano_id: 'pano-exemplo', data: '2023-05', heading: 120, pano_lat: -19.7471, pano_lng: -47.9391 },
    imagens: { satelite_ok: true, rua_ok: true },
    municipio,
    conta: contaDeReferencia({ kw: ficha.kw, carros: ficha.carros, rodovia: false }),
    indice: notaDoLocal({
      plugin_mun: 900, frota_mun: 250000, plugin_br: 416572, frota_br: 132323803,
      n_entorno: entorno.n, carregadores_5km: recarga.n, confianca: 'alta',
    }),
    pre_nota: preNota(ficha),
    sinais,
    situacao: situacao(sinais, 'alta'),
    historico: [],
  };
  d.ia = validarTextoIA({
    resumo: 'Posto em Uberaba com entorno movimentado e dono que decide junto com o sócio.',
    leitura_do_entorno: 'Em volta há posto, mercado, restaurante e farmácia.',
    perguntas: ['Quantas vagas ficam livres à noite?', 'Quem cuida da energia do posto?', 'O sócio pode entrar na chamada?'],
    cuidados: ['Confirmar a entrada de energia antes da proposta.'],
    modelo_sugerido: '03',
    porque_modelo: 'Ele tem capital próprio e quer o eletroposto dele.',
  }, montarFatosIA(d));
  return d;
}

// As chaves que o tick (eletropostoEstudo.ts) grava em fontes.
const FONTES_OK = {
  searchText: 'ok', historico: 'zero_resultados', nearby_entorno: 'ok', nearby_recarga: 'ok',
  svMeta: 'ok', staticmap: 'ok', ibgePop: 'ok', ibgePib: 'reaproveitado', ia: 'ok',
};

const linha = (o: Partial<LinhaEstudo> = {}): LinhaEstudo => ({
  token: TOKEN, status: 'pronto', dados: dadosCompletos(), fontes: { ...FONTES_OK },
  custo_usd: 0.12, created_at: '2026-09-16T11:50:00Z', pronto_em: '2026-09-16T11:55:00Z',
  coords_apagadas_em: null, ...o,
});

const reuniao = (o: Partial<ReuniaoEstudo> = {}): ReuniaoEstudo => ({
  quando: QUANDO, status: 'agendado', vendedor_nome: 'Diego', cliente_nome: 'Maria Clara Souza',
  cidade: 'Uberaba-MG', observacao: OBS_POSTO, ...o,
});

const OPTS = { agoraMs: AGORA, imagensLigadas: true };
const render = (l: LinhaEstudo = linha(), r: ReuniaoEstudo = reuniao(), o = OPTS) => renderEstudo(l, r, o);
const textoVisivel = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

describe('botões de carregador (não dependem da Places API)', () => {
  it('com o Google recusando, a seção de recarga ainda oferece Google Maps, PlugShare e a busca na cidade', () => {
    const d = dadosCompletos();
    d.recarga = null;
    d.local = null;
    d.google_negado = true;
    if (d.municipio) { d.municipio.lat = -19.7483; d.municipio.lng = -47.9319; }
    const html = render(linha({ status: 'parcial', dados: d, fontes: { searchText: 'erro:403', nearby_recarga: 'pulado' } }));

    expect(html).toContain('Carregadores no Google Maps');
    expect(html).toContain('Ver no PlugShare');
    expect(html).toContain('Carregadores na cidade');
    // PlugShare centrado no município, já que o ponto não foi encontrado.
    expect(html).toContain('https://www.plugshare.com/?latitude=-19.74830&amp;longitude=-47.93190&amp;zoom=13');
    expect(html).toContain('google.com/maps/search/?api=1&amp;query=carregador');
  });

  it('com o ponto achado, o PlugShare abre na coordenada do ponto', () => {
    const html = render();
    const d = dadosCompletos();
    expect(html).toContain(`https://www.plugshare.com/?latitude=${(d.local!.lat as number).toFixed(5)}`);
    expect(html).toContain('Ver no PlugShare');
  });
});

function parcialSemEntorno(): string {
  const d = dadosCompletos();
  d.entorno = null;
  delete d.ia;
  return render(linha({
    status: 'parcial', dados: d,
    fontes: { ...FONTES_OK, nearby_entorno: 'erro:403', ia: 'timeout', ibgePop: 'erro:fetch https://maps.googleapis.com/x?key=abc' },
  }));
}

function erroFichaAntiga(): string {
  const f = extrairFicha(OBS_ANTIGA);
  return render(
    linha({ status: 'erro', dados: { ficha: f, endereco_digitado: extrairEndereco(OBS_ANTIGA), pre_nota: preNota(f) }, fontes: { geocode: 'timeout' } }),
    reuniao({ observacao: OBS_ANTIGA, cidade: 'São Paulo-SP' }),
  );
}

function semEndereco(): string {
  const obs = obsDe('sem Endereço');
  const f = extrairFicha(obs);
  return render(linha({ status: 'sem_endereco', dados: { ficha: f, pre_nota: preNota(f) }, fontes: {} }), reuniao({ observacao: obs }));
}

const arquivado = () => render(linha({ coords_apagadas_em: '2026-09-25T03:00:00Z' }));

const CASOS: Array<[string, () => string]> = [
  ['pronto', () => render()],
  ['parcial sem entorno e sem IA', parcialSemEntorno],
  ['pendente', () => render(linha({ status: 'pendente', dados: {} }))],
  ['processando', () => render(linha({ status: 'processando', dados: {} }))],
  ['sem_endereco', semEndereco],
  ['descartado', () => render(linha({ status: 'descartado' }))],
  ['erro com ficha no formato antigo', erroFichaAntiga],
  ['arquivado', arquivado],
  ['pronto sem dado nenhum', () => render(linha({ dados: {}, fontes: {} }))],
  ['parcial sem dado nenhum', () => render(linha({ status: 'parcial', dados: {}, fontes: {} }))],
  ['status desconhecido', () => render(linha({ status: 'xyz' as StatusEstudo }))],
  ['reunião sem nome, sem consultor e horário ilegível', () => render(linha(), reuniao({ quando: 'lixo', cliente_nome: null, vendedor_nome: null, cidade: null }))],
  ['confirmar antes, IA de modelo', () => {
    const d = dadosCompletos({ ficha: { perfil: 'investidor', invest: 'naosei', ponto: 'negociando', relacao: null } });
    d.situacao = situacao(d.sinais || [], 'alta');
    if (d.ia) d.ia = { ...d.ia, origem: 'modelo' };
    return render(linha({ dados: d }));
  }],
  ['preparando sem reunião', () => paginaPreparando()],
  ['404', () => pagina404()],
];

describe('invariantes em todo estado da página', () => {
  for (const [nome, gerar] of CASOS) {
    it(nome, () => {
      const html = gerar();
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<html lang="pt-BR">');
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain('<meta name="referrer" content="no-referrer">');
      expect(html).toContain('<title>Estudo do local · NEXUS</title>');

      expect(html).not.toContain('<script');
      expect(html).not.toContain('maps.googleapis.com');
      expect(html).not.toContain('key=');
      expect(html).not.toContain('wa.me');
      expect(html).not.toMatch(TRAVESSOES);
      expect(html).not.toContain('Souza');
      expect(html).not.toContain(TELEFONE);
      expect(html).not.toMatch(/<link\b|@import|url\(/i);

      for (const tag of html.match(/<svg\b[^>]*>/g) || []) {
        expect(tag).toContain('viewBox="');
        expect(tag).toContain('role="img"');
        expect(tag).toContain('aria-label="');
      }
      for (const m of html.matchAll(/src="([^"]*)"/g)) {
        expect(m[1].startsWith(BASE_ESTUDO_URL)).toBe(true);
      }
      expect(textoVisivel(html)).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b|\[object/);
    });
  }
});

describe('pronto', () => {
  const html = render();

  it('cabeçalho: primeiro nome, cidade, horário, consultor, NOTA, situação e medidores', () => {
    expect(html).toContain('NEXUS Eletropostos · Estudo do local');
    expect(html).toContain('<h1>Maria</h1>');
    expect(html).not.toContain('Clara');
    expect(textoVisivel(html).replace(/\s+/g, ' ')).toContain('Uberaba-MG · Reunião qui 17/09 às 14h00 · Consultor Diego');
    expect(html).toContain('NOTA 3 · 11/11');
    expect(html).toContain('PRONTO PARA A REUNIÃO · 1 ponto de atenção');
    expect(html).toContain('selo-pronto');
    expect(html).toContain('100 de 100');
    expect(html).toContain('Prioridade alta');
    expect(html).toMatch(/\d,\d de 10/);
  });

  it('blocos na ordem combinada', () => {
    const titulos = ['Em 30 segundos', 'O local', 'Entorno em 1 km', 'Recarga em 5 km', 'Mercado do município',
      'Conta de referência', 'Roteiro da reunião', 'O que o cliente respondeu', 'Como calculamos e fontes'];
    const pos = titulos.map(t => html.indexOf(`>${t}</h2>`));
    expect(pos.every(p => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('em 30 segundos: resumo e ponto de atenção', () => {
    expect(html).toContain('Posto em Uberaba com entorno movimentado');
    expect(html).toContain('Sócio ou cônjuge decide junto');
  });

  it('o local: endereços, confiança, fato, vagas, imagens e botões', () => {
    expect(html).toContain('Avenida Brasil, 3200 · Distrito Industrial · Uberaba-MG · CEP 38000-000');
    expect(html).toContain('ao lado da conveniência');
    expect(html).toContain('Av. Brasil, 3200, Distrito Industrial, Uberaba');
    expect(html).toContain('Endereço conferido no Google');
    expect(html).toContain('No endereço o Google mostra: Auto Posto Exemplo, Posto de combustível.');
    expect(html).toContain('Vagas declaradas: <strong>6 a 10</strong>');
    expect(html).toContain(`<img src="${BASE_ESTUDO_URL}${TOKEN}/satelite.jpg" width="640" height="400" alt="Vista de satélite do local"`);
    expect(html).toContain(`<img src="${BASE_ESTUDO_URL}${TOKEN}/rua.jpg" width="640" height="400" alt="Vista da rua em frente ao local"`);
    expect(html).toContain('Imagem de maio de 2023');
    for (const b of ['Abrir no Google Maps', 'Ver satélite', 'Ver a rua', 'Traçar rota']) expect(html).toContain(`>${b}</a>`);
    expect(html).toContain('query_place_id=ChIJexemplo123');
    expect(html).toContain('heading=120');
  });

  it('entorno e recarga com distância em pt-BR e links por place_id', () => {
    expect(html).toContain('8 estabelecimentos em até');
    expect(html).toContain('Estabelecimentos por tipo');
    expect(html).toContain('Posto de combustível');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toMatch(/· \d{2,3} m</);
    expect(html).toContain('Em volta há posto, mercado, restaurante e farmácia.');
    expect(html).toContain('2 carregadores cadastrados');
    expect(html).toContain(', o mais perto a 1,4 km.');
    expect(html).toContain('query=Eletroposto%20Centro&amp;query_place_id=c1');
    expect(html).toContain('Dados do Google Maps');
  });

  it('mercado do município: cartões, gráfico e links', () => {
    expect(html).toContain('350.000');
    expect(html).toContain('R$ 52.000');
    expect(html).toContain('250.000');
    expect(html).toContain('SENATRAN/RENAVAM, julho de 2026');
    expect(html).toContain('Plug-in por mil veículos');
    expect(html).toContain('3,6 por mil');
    expect(html).toContain('https://cidades.ibge.gov.br/brasil/mg/uberaba/panorama');
    expect(html).toContain('https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2026');
  });

  it('conta de referência: tabela, fluxo, frase de 36 meses e premissas', () => {
    expect(html).toContain('Configuração de referência: 120 kW, investimento de R$ 195.000');
    expect(html).toContain('O cliente disse que pretende investir: <strong>Mais de R$ 500 mil</strong>');
    for (const t of ['Recargas por dia', 'Faturamento por mês', 'Lucro por mês', 'Payback']) expect(html).toContain(t);
    expect(html).toMatch(/\d,\d anos</);
    expect(html).toMatch(/Para pagar em 36 meses, este ponto precisa de \d+ recargas? por dia \(o carregador aguenta até 40 por dia\)\./);
    expect(html).toContain('<polyline');
    for (const t of ['Preço do kWh: R$ 2,35', 'Custo do kWh: R$ 0,70', 'Ativação: R$ 1,20 por recarga', 'Gateway: 14%',
      'Imposto: 6%', 'Manutenção: 0,1%', 'R$ 300 fixos por mês', 'Ocupação começa em 50% e chega a 100% em 24 meses',
      'Carga por recarga: 20 kWh']) expect(html).toContain(t);
    expect(html).toContain('Estimativa com as premissas do simulador da página NEXUS. Não é promessa de retorno. A proposta sai do Simulador.');
  });

  it('roteiro, respostas e método', () => {
    expect(html).toContain('<ol><li>Quantas vagas ficam livres à noite?</li>');
    expect(html).toContain('Confirmar a entrada de energia antes da proposta.');
    expect(html).toContain('Modelo NEXUS sugerido: 03');
    expect(html).toContain('Texto escrito por IA a partir dos dados acima. Números, notas e situação são calculados pelo sistema.');
    expect(html).toContain('Perfil: <strong>Dono de posto de combustível</strong>');
    expect(html).toContain('<dt>Decisor</dt><dd>Eu decido</dd>');
    expect(html).toContain('Ponto e controle: 35 de 35');
    expect(html).toContain('Perfil: 25 de 25');
    expect(html).toContain('Capital: 15 de 15');
    expect(html).toContain('Pré-nota = (P + Q + C) ÷ 75 × 100 = (35 + 25 + 15) ÷ 75 × 100 = 100 de 100');
    expect(html).toContain('A · Adoção');
    expect(html).toContain('D · Espaço para recarga');
    expect(html).toContain('Google Maps, entorno em 1 km: respondeu');
    expect(html).toContain('Custo estimado: US$ 0,12');
    expect(html).toContain('Versão dos pesos: 2026-09-15');
    expect(html).toContain('IBGE');
    expect(html).toContain('SENATRAN/RENAVAM');
  });

  it('conta de 80 kW e conta que não paga em 36 meses', () => {
    const d = dadosCompletos();
    d.conta = contaDeReferencia({});
    expect(render(linha({ dados: d }))).toContain('Configuração de referência: 80 kW, investimento de R$ 145.000');
    d.conta = { ...d.conta, recargas_36m: null, base: { ...d.conta.base, payback: null } };
    const h = render(linha({ dados: d }));
    expect(h).toContain(`Nem no limite do carregador (${d.conta.teto_fisico} recargas por dia) este ponto paga em 36 meses.`);
    expect(h).toContain('Não paga em 10 anos');
  });

  it('sem coordenada: um botão só, de busca pelo endereço digitado', () => {
    const d = dadosCompletos();
    d.local = { ...d.local!, lat: null, lng: null };
    const h = render(linha({ dados: d }));
    expect(h).toContain('>Buscar o endereço no Google Maps</a>');
    expect(h).toContain('query=Avenida%20Brasil%2C%203200');
    expect(h).not.toContain('Ver satélite');
    expect(h).not.toContain('<img');
  });
});

describe('outros estados', () => {
  it('parcial: bloco que falta diz qual fonte não respondeu, sem vazar o texto do erro', () => {
    const h = parcialSemEntorno();
    expect(h).toContain('Entorno não consultado agora (Google Maps respondeu erro 403).');
    expect(h).toContain('Roteiro não escrito agora (IA não respondeu a tempo).');
    expect(h).toContain('Google Maps, entorno em 1 km: erro 403');
    expect(h).toContain('IBGE, população: erro</li>');
    expect(h).not.toContain('Estabelecimentos por tipo');
    expect(h).toContain('Recarga em 5 km');
  });

  it('parcial com as chaves reais do tick: falha de rede, IBGE e nome legível de cada fonte', () => {
    const d = dadosCompletos();
    d.recarga = null;
    d.municipio = null;
    const h = render(linha({ status: 'parcial', dados: d, fontes: { ...FONTES_OK, nearby_recarga: 'rede', ibgePop: 'timeout' } }));
    expect(h).toContain('Carregadores não consultados agora (Google Maps não respondeu por falha de rede).');
    expect(h).toContain('Mercado do município não consultado agora (IBGE não respondeu a tempo).');
    for (const t of [
      'Google Maps, endereço: respondeu', 'Agenda, visitas anteriores no endereço: sem resultado',
      'Google Maps, vista da rua: respondeu', 'Google Maps, satélite: respondeu',
      'IBGE, PIB per capita: reaproveitado de estudo recente', 'Google Maps, carregadores em 5 km: falha de rede',
      'IA, roteiro da reunião: respondeu',
    ]) expect(h).toContain(t);
  });

  it('pendente e processando: página de preparo que se recarrega', () => {
    for (const status of ['pendente', 'processando'] as const) {
      const h = render(linha({ status }));
      expect(h).toContain('<meta http-equiv="refresh" content="30">');
      expect(h).toContain('Estudo em preparação. Fica pronto em até 15 minutos.');
      expect(h).not.toContain('Avenida Brasil');
    }
    expect(paginaPreparando(null)).toContain('content="30"');
  });

  it('sem_endereco: aviso e respostas, sem terreno', () => {
    const h = semEndereco();
    expect(h).toContain('A ficha não trouxe endereço do local, então não há estudo do terreno.');
    expect(h).toContain('O que o cliente respondeu');
    expect(h).toContain('<dd>Recurso próprio</dd>');
    expect(h).not.toContain('<img');
    expect(h).not.toContain('Entorno em');
  });

  it('descartado: só o aviso, nada do cliente', () => {
    const h = render(linha({ status: 'descartado' }));
    expect(h).toContain('Esta reunião não está mais na agenda.');
    for (const t of ['Maria', 'Diego', 'Uberaba', 'Avenida Brasil', TOKEN, '<img', 'NOTA']) expect(h).not.toContain(t);
  });

  it('erro: aviso, link de busca e respostas; ficha antiga sai sem travessão', () => {
    const h = erroFichaAntiga();
    expect(h).toContain('O estudo não conseguiu terminar. Os dados abaixo são os da ficha.');
    expect(h).toContain('>Buscar o endereço no Google Maps</a>');
    expect(h).toContain('Rua das Palmeiras, 131 · Jardim Exemplo · São Paulo-SP · CEP 05000-000 · ref.: Galeria');
    expect(h).toContain('<dt>Como pretende investir</dt>');
    expect(h).toContain('NOTA 2 · 6/11');
    expect(h).not.toContain('<img');
    expect(OBS_ANTIGA).toMatch(/—/);
  });

  it('arquivado: sem imagem e com links do Maps por place_id, sem coordenada', () => {
    const h = arquivado();
    expect(h).not.toContain('<img');
    expect(h).toContain('Arquivado');
    expect(h).toContain('query_place_id=ChIJexemplo123');
    expect(h).toContain('destination_place_id=ChIJexemplo123');
    expect(h).not.toMatch(/19\.74|47\.93/);
    expect(h).not.toContain('Ver satélite');
  });

  it('confirmar antes: selo âmbar com texto e pontos de atenção além dos 3', () => {
    const d = dadosCompletos({ ficha: { perfil: 'investidor', invest: 'naosei', ponto: 'negociando', relacao: null } });
    d.situacao = situacao(d.sinais || [], 'alta');
    d.ia = { ...d.ia!, origem: 'modelo' };
    const h = render(linha({ dados: d }));
    expect(h).toContain('selo-confirmar">CONFIRMAR ANTES · 4 pontos de atenção');
    expect(h).toContain('Mais pontos de atenção');
    expect(h).toContain('Texto padrão do sistema. A IA não respondeu a tempo.');
  });

  it('confiança do endereço: texto em selo, só com as cores da paleta', () => {
    const casos: Array<[DadosEstudo['confianca'], string]> = [
      ['alta', 'selo-pronto">Endereço conferido no Google'],
      ['media', 'selo-confirmar">Rua encontrada, número não conferido'],
      ['baixa', 'selo-confirmar">Endereço aproximado, conferir com o cliente'],
      ['nao_encontrado', 'selo-confirmar">Endereço não encontrado no Google'],
    ];
    for (const [confianca, esperado] of casos) {
      const d = dadosCompletos();
      d.confianca = confianca;
      expect(render(linha({ dados: d }))).toContain(esperado);
    }
    expect(render()).not.toContain('selo-alerta');
  });

  it('nome com HTML sai escapado', () => {
    const h = render(linha(), reuniao({ cliente_nome: '<img src=x onerror=1> Souza' }));
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img');
  });

  it('pagina404: noindex e nenhum dado', () => {
    const h = pagina404();
    expect(h).toContain('noindex');
    expect(h).toContain('Estudo não encontrado');
    for (const t of ['Maria', 'Diego', 'Uberaba', TOKEN, '<img', 'NOTA']) expect(h).not.toContain(t);
  });
});

describe('imagensPermitidas', () => {
  const l = linha();
  const r = reuniao();
  const limite = Date.parse(QUANDO) + 7 * DIA;

  it('dentro da janela, chave ligada, com pino: satélite e rua', () => {
    expect(imagensPermitidas(l, r, AGORA, true)).toEqual({ satelite: true, rua: true });
    expect(imagensPermitidas(l, r, limite - 1, true)).toEqual({ satelite: true, rua: true });
  });

  it('7 dias depois da reunião: nada', () => {
    expect(imagensPermitidas(l, r, limite, true)).toEqual({ satelite: false, rua: false });
    expect(imagensPermitidas(l, r, limite + DIA, true)).toEqual({ satelite: false, rua: false });
  });

  it('arquivado ou chave desligada: nada', () => {
    expect(imagensPermitidas(linha({ coords_apagadas_em: '2026-09-25T03:00:00Z' }), r, AGORA, true)).toEqual({ satelite: false, rua: false });
    expect(imagensPermitidas(l, r, AGORA, false)).toEqual({ satelite: false, rua: false });
  });

  it('reunião sem horário não tem prazo; rua pede dados.rua; sem lat/lng, nada', () => {
    expect(imagensPermitidas(l, reuniao({ quando: null }), limite + 90 * DIA, true)).toEqual({ satelite: true, rua: true });
    const semRua = dadosCompletos();
    semRua.rua = null;
    expect(imagensPermitidas(linha({ dados: semRua }), r, AGORA, true)).toEqual({ satelite: true, rua: false });
    const semPino = dadosCompletos();
    semPino.local = { ...semPino.local!, lat: null };
    expect(imagensPermitidas(linha({ dados: semPino }), r, AGORA, true)).toEqual({ satelite: false, rua: false });
    const semOk = dadosCompletos();
    semOk.imagens = { satelite_ok: false, rua_ok: true };
    expect(imagensPermitidas(linha({ dados: semOk }), r, AGORA, true)).toEqual({ satelite: false, rua: true });
  });
});

describe('esc e SVG', () => {
  it('esc escapa, some com vazio e troca travessão', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(NaN)).toBe('');
    expect(esc(0)).toBe('0');
    expect(esc('a — b – c')).toBe('a · b · c');
  });

  it('svgMedidor escreve o valor e a faixa', () => {
    const pre = svgMedidor(80, 100, 'Pré-nota', 'prioridade alta');
    expect(pre).toContain('viewBox=');
    expect(pre).toContain('80 de 100');
    expect(pre).toContain('Prioridade alta');
    expect(pre).not.toMatch(/\d+\s*\/\s*100/);
    expect(svgMedidor(7.4, 10, 'Mercado', 'mercado forte')).toContain('7,4 de 10');
    const nada = svgMedidor(null, 10, 'Mercado', 'sem dado suficiente');
    expect(nada).toContain('Sem dado');
    expect(nada).toContain('Sem dado suficiente');
    expect(nada).not.toMatch(/NaN/);
  });

  it('svgBarras e svgBarrasComparadas escapam rótulo e tratam sem dado', () => {
    const b = svgBarras([{ rotulo: '<b>Restaurante</b>', valor: 6 }, { rotulo: 'Farmácia', valor: 3 }], 'Por tipo');
    expect(b).toContain('&lt;b&gt;Restaurante');
    expect(b).toContain('>6</text>');
    expect(svgBarras([], 'Vazio')).toContain('Sem dado para mostrar.');
    const cmp = svgBarrasComparadas([{ rotulo: 'Uberaba', valor: 3.6 }, { rotulo: 'MG', valor: null }, { rotulo: 'Brasil', valor: 3.1 }], 'Plug-in', 'por mil');
    expect(cmp).toContain('3,6 por mil');
    expect(cmp).toContain('Sem dado');
    expect(cmp).not.toMatch(/NaN|null/);
  });

  it('svgFluxo10Anos: três linhas de 11 pontos, começando no investimento', () => {
    const conta = contaDeReferencia({ kw: 80, carros: 10 });
    const s = svgFluxo10Anos(conta);
    expect(s).toContain('viewBox=');
    const linhas = [...s.matchAll(/<polyline[^>]*points="([^"]+)"/g)];
    expect(linhas).toHaveLength(3);
    for (const l of linhas) expect(l[1].trim().split(' ')).toHaveLength(11);
    for (const t of ['Teto', 'Base', 'Piso', 'Ano 0 começa em -R$ 145.000', 'Anos depois da instalação']) expect(s).toContain(t);
    expect(s).toContain('stroke-dasharray="4 3"');
    expect(s).not.toMatch(/NaN/);
  });
});
