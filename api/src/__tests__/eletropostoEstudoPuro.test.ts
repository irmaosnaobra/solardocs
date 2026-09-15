import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/estudoFichas.json';
import {
  extrairFicha, extrairEndereco, normalizarEndereco, enderecoPareceFalso, textoDeBusca,
  confiancaGeo, distanciaM, rumoGraus, resumirLugares, categoriaDoLugar, preNota, notaDoLocal,
  sinaisDeAtencao, situacao, validarTextoIA, textosDeModelo, montarFatosIA, mapsUrls,
  urlDoEstudo, TOKEN_RE, quandoPorExtenso, textoPedirLocalizacao, linkPedirLocalizacao,
  primeiroNome, type Ficha, type LugarGoogle, type FatosIA,
} from '../services/io/eletropostoEstudoPuro';

const FICHAS = fixtures.fichas;
const porCaso = (trecho: string) => {
  const f = FICHAS.find(x => x.caso.includes(trecho));
  if (!f) throw new Error(`fixture sem o caso ${trecho}`);
  return f;
};

const fichaBase = (o: Partial<Ficha> = {}): Ficha => ({
  perfil: 'posto', perfil_texto: 'Dono de posto de combustível', nota: 3, pts: 11,
  ponto: 'definido', relacao: 'proprietario', vagas: null, modelo: null, rota: null,
  invest: 'proprio', valor: null, decisor: 'eu', trifasica: 'sim', kw: 80, carros: 10,
  para_investidor: false, respostas: [], ...o,
});

describe('extrairFicha e extrairEndereco sobre as fichas reais anonimizadas', () => {
  for (const fx of FICHAS) {
    it(fx.caso, () => {
      expect(extrairFicha(fx.observacao)).toMatchObject(fx.ficha);
      expect(extrairEndereco(fx.observacao)).toEqual(fx.endereco);
    });
  }

  it('rodovia com espaço duplo e número repetido no nome da rua', () => {
    const e = extrairEndereco(porCaso('beira de rodovia').observacao)!;
    expect(e.rua).toBe('Rodovia MG 184 km 12');
    expect(e.numero).toBe('12');
  });

  it('lote no nome da rua (formato de Brasília)', () => {
    const e = extrairEndereco(porCaso('lote no nome').observacao)!;
    expect(e.rua).toBe('Qe 20 conjunto C lote 3e4');
    expect(e.numero).toBe('3');
    expect(e.bairro).toBe('Guara 2');
  });

  it('rua com vírgula: o número é o último pedaço', () => {
    const e = extrairEndereco('Endereço: Rua A, Quadra 5, 120 · Centro · Goiânia-GO')!;
    expect(e.rua).toBe('Rua A, Quadra 5');
    expect(e.numero).toBe('120');
  });

  it('referência com ponto médio fica inteira', () => {
    const e = extrairEndereco('Endereço: Rua B, 10 · Centro · Uberaba-MG · ref.: fundos · portão azul')!;
    expect(e.compl).toBe('fundos · portão azul');
    expect(e.cidade).toBe('Uberaba-MG');
  });

  it('respostas saem na ordem do card, com o texto que a pessoa escolheu', () => {
    const r = extrairFicha(porCaso('dono de posto').observacao).respostas;
    expect(r[0].rotulo).toBe('Endereço');
    expect(r.find(x => x.rotulo === 'Vagas')?.texto).toBe('6 a 10');
    expect(r.find(x => x.rotulo === 'Simulou')?.texto).toBe('Simulou 120 kW com 20 carros/dia');
  });

  it('ficha vazia não quebra', () => {
    const f = extrairFicha('');
    expect(f.perfil).toBeNull();
    expect(f.nota).toBeNull();
    expect(extrairEndereco(null)).toBeNull();
  });
});

describe('preNota', () => {
  it('os quatro exemplos da régua', () => {
    expect(preNota({ perfil: 'posto', ponto: 'definido', relacao: 'proprietario', invest: 'proprio' }).valor).toBe(100);
    expect(preNota({ perfil: 'investidor', ponto: 'definido', relacao: 'inquilino', invest: 'proprio' }).valor).toBe(80);
    expect(preNota({ perfil: 'investidor', ponto: 'negociando', relacao: null, invest: 'naosei' }).valor).toBe(40);
    expect(preNota({ perfil: 'outro', ponto: 'negociando', relacao: null, invest: null }).valor).toBe(80);
  });

  it('P: controle 35, negociando 20, resto 0', () => {
    for (const r of ['proprietario', 'administro', 'represento', 'inquilino'] as const) {
      expect(preNota({ perfil: 'posto', ponto: 'definido', relacao: r, invest: 'proprio' }).p).toBe(35);
    }
    expect(preNota({ perfil: 'posto', ponto: 'definido', relacao: 'nao_e_meu', invest: 'proprio' }).p).toBe(0);
    expect(preNota({ perfil: 'posto', ponto: 'em_vista', relacao: null, invest: 'proprio' }).p).toBe(0);
  });

  it('Q: comércio nomeado e Outro 25, Investidor 10', () => {
    for (const p of ['posto', 'mercado', 'restaurante', 'academia', 'farmacia', 'hotel', 'estacionamento', 'condominio', 'outro'] as const) {
      expect(preNota({ perfil: p, ponto: 'definido', relacao: 'proprietario', invest: 'proprio' }).q).toBe(25);
    }
    expect(preNota({ perfil: 'investidor', ponto: 'definido', relacao: 'proprietario', invest: 'proprio' }).q).toBe(10);
  });

  it('C: só pesa para o Investidor', () => {
    const c = (invest: Ficha['invest']) => preNota({ perfil: 'investidor', ponto: 'definido', relacao: 'proprietario', invest }).c;
    expect(c('proprio')).toBe(15);
    expect(c('proprio_credito')).toBe(15);
    expect(c('fin_aprovado')).toBe(12);
    expect(c('fin_cnpj')).toBe(6);
    expect(c('fin_banco')).toBe(6);
    expect(c('naosei')).toBe(0);
    expect(c(null)).toBe(5);
    expect(preNota({ perfil: 'mercado', ponto: 'definido', relacao: 'proprietario', invest: 'naosei' }).c).toBe(15);
  });

  it('nenhuma saída tem barra (o card procura /11 na ficha)', () => {
    for (const fx of FICHAS) {
      const n = preNota(extrairFicha(fx.observacao));
      expect(JSON.stringify(n)).not.toContain('/');
      expect(n.valor).toBeGreaterThanOrEqual(0);
      expect(n.valor).toBeLessThanOrEqual(100);
    }
  });
});

describe('enderecoPareceFalso', () => {
  it('teclado batido é falso', () => {
    expect(enderecoPareceFalso('Vila velha', 'Bbbb')).toBe(true);
    expect(enderecoPareceFalso('Nnnn', 'Centro')).toBe(true);
    expect(enderecoPareceFalso('Rua X', 'xzqw')).toBe(true);
  });
  it('endereço de verdade passa', () => {
    for (const s of ['Rua A', 'Quadra AA', 'BR-050', 'Av. Brasil', 'Cj. B', 'SMPW', 'SHCGN', 'QE 20']) {
      expect(enderecoPareceFalso(s, 'Centro')).toBe(false);
      expect(enderecoPareceFalso('Rua Um', s)).toBe(false);
    }
  });
});

describe('geografia', () => {
  const municipio = { nome: 'Uberlândia', lat: -18.9186, lng: -48.2772 };
  const lugar = (o: Partial<LugarGoogle> = {}): LugarGoogle => ({
    location: { latitude: -18.9146, longitude: -48.2750 },
    types: ['street_address'],
    addressComponents: [
      { longText: '1500', types: ['street_number'] },
      { longText: 'Uberlândia', types: ['administrative_area_level_2', 'political'] },
    ],
    ...o,
  });

  it('confiancaGeo por tipo, número e distância', () => {
    expect(confiancaGeo(null, '10', municipio)).toBe('nao_encontrado');
    expect(confiancaGeo(lugar(), '1500', municipio)).toBe('alta');
    expect(confiancaGeo(lugar(), '1501', municipio)).toBe('media');
    expect(confiancaGeo(lugar({ types: ['route'] }), '1500', municipio)).toBe('media');
    expect(confiancaGeo(lugar({ types: ['locality', 'political'] }), '1500', municipio)).toBe('baixa');
    expect(confiancaGeo(lugar({ location: { latitude: -16.68, longitude: -49.25 } }), '1500', municipio)).toBe('baixa');
    expect(confiancaGeo(lugar({ addressComponents: [{ longText: 'Uberaba', types: ['administrative_area_level_2'] }] }), '1500', municipio)).toBe('baixa');
  });

  it('distância em metros e rumo', () => {
    expect(distanciaM({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 })).toBe(111);
    expect(rumoGraus({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBe(0);
    expect(rumoGraus({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBe(90);
  });

  it('resumirLugares ordena, conta por tipo e tira quem fechou', () => {
    const centro = { lat: 0, lng: 0 };
    const r = resumirLugares([
      { id: 'b', displayName: { text: 'Longe' }, location: { latitude: 0, longitude: 0.005 }, primaryType: 'pharmacy' },
      { id: 'a', displayName: { text: 'Perto' }, location: { latitude: 0, longitude: 0.001 }, primaryType: 'brazilian_restaurant' },
      { id: 'c', displayName: { text: 'Fechou' }, location: { latitude: 0, longitude: 0.002 }, primaryType: 'gym', businessStatus: 'CLOSED_PERMANENTLY' },
    ], centro, 1000);
    expect(r.lista.map(i => i.place_id)).toEqual(['a', 'b']);
    expect(r.por_tipo).toEqual({ restaurante: 1, farmacia: 1 });
    expect(r.mais_perto_m).toBe(111);
    expect(r.cheio).toBe(false);
    expect(categoriaDoLugar({ types: ['car_wash'] })?.rotulo).toBe('Lava-jato');
  });
});

describe('notaDoLocal', () => {
  const BR = { plugin_br: 416572, frota_br: 132323803 };

  it('Uberlândia com entorno cheio e 3 carregadores fica forte', () => {
    const n = notaDoLocal({ plugin_mun: 3017, frota_mun: 565639, ...BR, n_entorno: 20, carregadores_5km: 3 });
    expect(n.componentes.a).toBeCloseTo(8.5, 1);
    expect(n.componentes.b).toBeCloseTo(8.7, 1);
    expect(n.componentes.c).toBe(10);
    expect(n.componentes.d).toBe(10);
    expect(n.valor).toBeGreaterThanOrEqual(7);
    expect(n.faixa).toBe('mercado forte');
  });

  it('componente sem dado sai da média', () => {
    const n = notaDoLocal({ plugin_mun: 3017, frota_mun: 565639, ...BR, n_entorno: null, carregadores_5km: null });
    expect(n.componentes.c).toBeNull();
    expect(n.componentes.d).toBeNull();
    expect(n.valor).toBeCloseTo(((n.componentes.a as number) + (n.componentes.b as number)) / 2, 1);
  });

  it('menos de 2 componentes: sem dado suficiente', () => {
    const n = notaDoLocal({ n_entorno: 4 });
    expect(n.valor).toBeNull();
    expect(n.faixa).toBe('sem dado suficiente');
  });

  it('D some com menos de 50 plug-ins, e confiança baixa vira a confirmar', () => {
    expect(notaDoLocal({ plugin_mun: 12, frota_mun: 9000, ...BR, carregadores_5km: 0 }).componentes.d).toBeNull();
    expect(notaDoLocal({ plugin_mun: 3017, frota_mun: 565639, ...BR, confianca: 'baixa' }).faixa).toBe('a confirmar');
  });
});

describe('sinais e situação', () => {
  const end = { rua: 'Rua Um', numero: '10', bairro: 'Centro', cidade: 'Uberaba-MG', cep: '', compl: '' };

  it('dono de posto proprietário, endereço alto: pronto, com o fato do endereço', () => {
    const s = sinaisDeAtencao({ ficha: fichaBase(), endereco: end, confianca: 'alta', estabelecimento: { nome: 'Auto Posto Boa Vista', tipo: 'Posto de combustível' } });
    expect(s.filter(x => x.lado === 'atencao')).toEqual([]);
    expect(s.find(x => x.lado === 'fato')?.texto).toBe('No endereço o Google mostra: Auto Posto Boa Vista, Posto de combustível.');
    expect(situacao(s, 'alta')).toBe('pronto');
  });

  it('investidor sem forma de pagamento, negociando, sócio: confirmar antes', () => {
    const s = sinaisDeAtencao({ ficha: fichaBase({ perfil: 'investidor', invest: 'naosei', ponto: 'negociando', relacao: null, decisor: 'socio' }), endereco: end, confianca: 'alta' });
    expect(s.map(x => x.tipo)).toEqual(expect.arrayContaining(['sem_capital', 'negociando', 'decisor', 'investidor']));
    expect(situacao(s, 'alta')).toBe('confirmar');
  });

  it('endereço de mentira, número zero e endereço do lead', () => {
    const f = extrairFicha(porCaso('endereço de mentira').observacao);
    const e = extrairEndereco(porCaso('endereço de mentira').observacao);
    expect(sinaisDeAtencao({ ficha: f, endereco: e, confianca: 'media' }).map(x => x.tipo)).toContain('endereco_suspeito');

    const f2 = extrairFicha(porCaso('endereço do lead').observacao);
    const e2 = extrairEndereco(porCaso('endereço do lead').observacao);
    const s2 = sinaisDeAtencao({ ficha: f2, endereco: e2, confianca: 'alta' });
    expect(s2.map(x => x.tipo)).toContain('endereco_do_lead');
    expect(situacao(s2, 'alta')).toBe('confirmar');
  });

  it('confiança baixa sozinha já pede confirmação', () => {
    expect(situacao([], 'baixa')).toBe('confirmar');
    expect(situacao([], 'nao_encontrado')).toBe('confirmar');
  });

  it('a favor: rodovia e inquilino. Histórico vira duplicado', () => {
    const f = extrairFicha(porCaso('beira de rodovia').observacao);
    const e = extrairEndereco(porCaso('beira de rodovia').observacao);
    const s = sinaisDeAtencao({
      ficha: { ...f, relacao: 'inquilino' }, endereco: e, confianca: 'media',
      historico: [{ id: 700, quando: '2026-08-20T17:00:00Z', status: 'nao_atendeu', consultor: 'Diego' }],
    });
    expect(s.filter(x => x.lado === 'favor').map(x => x.tipo)).toEqual(['rodovia', 'inquilino']);
    expect(s.find(x => x.tipo === 'duplicado')?.texto).toBe('Já esteve na agenda: 20/08, não atendeu, Diego.');
  });
});

describe('IA: validação e texto de reserva', () => {
  const fatos: FatosIA = montarFatosIA({
    ficha: extrairFicha(porCaso('dono de posto').observacao),
    endereco_digitado: extrairEndereco(porCaso('dono de posto').observacao),
    municipio: { ibge: 3170107, nome: 'Uberaba', uf: 'MG', pop_2026: 350000, pib_pc_2023: 52000, frota: 250000, plugin: 900, por_mil: 3.6, uf_por_mil: 2.9, br_por_mil: 3.1, ref: 'julho/2026' },
    entorno: { raio_m: 1000, n: 14, cheio: false, ate_m: 980, mais_perto_m: 60, por_tipo: { restaurante: 6, farmacia: 3 }, lista: [] },
    recarga: { raio_m: 5000, n: 2, cheio: false, ate_m: 2600, mais_perto_m: 1400, por_tipo: {}, lista: [] },
    pre_nota: { valor: 100, p: 35, q: 25, c: 15, faixa: 'prioridade alta' },
    indice: { valor: 7.4, faixa: 'mercado forte', a_confirmar: false, componentes: { a: 6, b: 7.4, c: 7, d: 8 } },
    sinais: [],
    situacao: 'pronto',
  });

  const bom = {
    resumo: 'Posto em Uberaba com entorno movimentado e mercado forte, índice 7,4.',
    leitura_do_entorno: 'São 14 estabelecimentos em volta, a maioria restaurantes.',
    perguntas: ['Quantas vagas ficam livres à noite?', 'Quem cuida da energia do posto?', 'O movimento cresce no fim de semana?'],
    cuidados: ['Confirmar a entrada de energia antes da proposta.'],
    modelo_sugerido: '03',
    porque_modelo: 'Ele tem capital próprio e quer o eletroposto dele.',
  };

  it('texto limpo passa inteiro', () => {
    const v = validarTextoIA(bom, fatos);
    expect(v.reprovados).toEqual([]);
    expect(v.origem).toBe('ia');
    expect(v.resumo).toBe(bom.resumo);
    expect(v.modelo_sugerido).toBe('03');
  });

  it.each([
    ['R$ 6 mil', 'Pode render R$ 6 mil por mês.'],
    ['porcentagem', 'Margem de 47%.'],
    ['payback', 'O payback é rápido.'],
    ['travessão', 'Bom ponto — perto do centro.'],
    ['número inventado', 'Passam 800 carros por dia.'],
    ['cancelar', 'Melhor cancelar esta reunião.'],
  ])('reprova %s e troca só o campo', (_nome, texto) => {
    const v = validarTextoIA({ ...bom, resumo: texto }, fatos);
    expect(v.reprovados).toContain('resumo');
    expect(v.resumo).toBe(textosDeModelo(fatos).resumo);
    expect(v.leitura_do_entorno).toBe(bom.leitura_do_entorno);
  });

  it('pergunta ruim sai da lista; com menos de 3, entra a lista de reserva', () => {
    const v = validarTextoIA({ ...bom, perguntas: ['Qual o lucro esperado?', 'Quem decide?', 'Tem vaga?'] }, fatos);
    expect(v.perguntas).toEqual(textosDeModelo(fatos).perguntas);
  });

  it('resposta vazia vira modelo inteiro', () => {
    const v = validarTextoIA(null, fatos);
    expect(v.origem).toBe('modelo');
    expect(v.perguntas.length).toBeGreaterThanOrEqual(3);
  });

  it('o texto de reserva não tem travessão nem número de dinheiro', () => {
    const t = textosDeModelo(fatos);
    const tudo = JSON.stringify(t);
    expect(tudo).not.toMatch(/[–—]/);
    expect(tudo).not.toMatch(/R\$|payback|lucro/i);
    expect(t.perguntas.length).toBeGreaterThanOrEqual(3);
    expect(t.perguntas.length).toBeLessThanOrEqual(5);
  });

  it('fatos não levam nome, telefone, rua nem número', () => {
    const s = JSON.stringify(fatos);
    expect(s).not.toContain('Avenida Brasil');
    expect(s).not.toContain('3200');
  });
});

describe('links e textos', () => {
  it('mapsUrls codificadas e sem chave', () => {
    const u = mapsUrls(-18.9146, -48.275, 'ChIJ abc/1', 123.6);
    expect(u.abrir).toBe('https://www.google.com/maps/search/?api=1&query=-18.914600%2C-48.275000&query_place_id=ChIJ%20abc%2F1');
    expect(u.rua).toContain('map_action=pano');
    expect(u.rua).toContain('heading=124');
    expect(u.satelite).toContain('basemap=satellite');
    expect(u.rota).toBe('https://www.google.com/maps/dir/?api=1&destination=-18.914600%2C-48.275000');
    expect(JSON.stringify(u)).not.toContain('key=');
  });

  it('urlDoEstudo e TOKEN_RE', () => {
    const t = 'a'.repeat(64);
    expect(urlDoEstudo(t).startsWith('https://solardoc.app/_api/io/eletroposto/estudo/')).toBe(true);
    expect(TOKEN_RE.test(t)).toBe(true);
    expect(TOKEN_RE.test('A'.repeat(64))).toBe(false);
    expect(TOKEN_RE.test('a'.repeat(63))).toBe(false);
  });

  it('textoDeBusca e normalizarEndereco', () => {
    const e = { rua: 'Rua São José', numero: '000', bairro: 'Centro', cidade: 'Araguari-MG', cep: '', compl: '' };
    expect(textoDeBusca(e, { municipio: 'Araguari', uf: 'MG' })).toBe('Rua São José, Centro, Araguari - MG, Brasil');
    expect(normalizarEndereco({ rua: 'Rua  São José.', numero: '0120' })).toBe('rua sao jose|120');
  });

  it('horário em Brasília e pedido de localização', () => {
    expect(quandoPorExtenso('2026-09-17T17:00:00Z')).toBe('qui 17/09 às 14h00');
    const t = textoPedirLocalizacao({ primeiroNome: 'Ana', consultor: 'Diego', quando: '2026-09-17T17:00:00Z' });
    expect(t).toContain('Oi, Ana. Aqui é o Diego, da NEXUS Eletropostos, sobre a nossa conversa de 17/09 às 14:00.');
    expect(t).not.toMatch(/[–—]/);
    expect(linkPedirLocalizacao('34999998888', 'oi')).toBe('wa.me/5534999998888?text=oi');
    expect(linkPedirLocalizacao('123', 'oi')).toBeNull();
    expect(primeiroNome('  maria clara souza')).toBe('Maria');
  });
});
