import { describe, it, expect } from 'vitest';
import {
  resolverColunas, lerPlanilha, parseDataBR, parseReais, montarEtapas, etapaAtualDe, paradoHaDias,
  classificarOrigem, calcularPedir, montarObra, montarMapa, montarRanking, nomeNaOrigem,
  ordenarObras, resumirObras, ehSocio, podeVer, listaSocios, hojeBRT, codigoCanonico,
  type ObraBruta,
} from '../services/gerador/solarObras';
import { CABECALHO, I, VENDAS, PROIBIDAS, planilhaPadrao, linha, paraCsv } from './solarPlanilhaFixture';

// Lógica pura das obras do solar. Nada aqui chama Google, Trello nem banco.

const bruta = (parcial: Partial<ObraBruta> = {}): ObraBruta => ({
  codigo: '#0001', cliente: 'Fulano', homologacao: '', consultor: 'Nilce', origem: '', valorVenda: 0, recebidoReal: 0,
  recebimento: '', liberadoTxt: '', depoimentoTxt: '', telefone: '', endereco: '', cidade: '', uf: '',
  entregaMaterial: '', previsaoMontagem: '', inicioInstalacao: '', fimInstalacao: '', qtdPlaca: '', modeloPlaca: '',
  statusPlaca: '', qtdInv: '', modeloInversor: '', statusInversor: '', tipoEstrutura: '', statusEstrutura: '',
  cadastroTrello: '', parecerAcesso: '', pedidoVistoria: '', liberacaoVistoria: '', engenheiro: '',
  concessionaria: '', equipe: '',
  ...parcial,
});
const HOJE = '2026-10-10';
const feitas = (o: ObraBruta) => montarEtapas(o).filter((e) => e.feito).map((e) => e.chave);

describe('colunas repetidas', () => {
  const c = resolverColunas(CABECALHO);
  it('cada STATUS é o que vem depois de POT PLACA, MODELO INVERSOR e TIPO ESTRUTURA', () => {
    expect(c.statusPlaca).toBe(22);
    expect(c.statusInversor).toBe(26);
    expect(c.statusEstrutura).toBe(28);
  });
  it('MODELO INVERSOR não colide com MODELO E VOLTAGEM DO INVERSOR', () => {
    expect(c.modeloInversor).toBe(25);
    expect(c.modeloVoltagem).toBe(24);
  });
  it('datas: a primeira ocorrência é a principal e a segunda é a reserva', () => {
    expect([c.previsaoMontagem, c.inicioInstalacao, c.fimInstalacao]).toEqual([16, 17, 18]);
    expect([c.previsaoReserva, c.inicioReserva, c.fimReserva]).toEqual([49, 50, 51]);
  });
  it('resolve com acento e caixa diferentes', () => {
    const c2 = resolverColunas(CABECALHO.map((h) => h.toLowerCase()));
    expect(c2.cliente).toBe(1);
    expect(c2.liberacaoVistoria).toBe(38);
  });
  it('a coluna reserva de início aceita a grafia INCIO INSTALAÇÃO', () => {
    const cab = CABECALHO.map((h, i) => (i === 50 ? 'INCIO INSTALAÇÃO' : h));
    const c = resolverColunas(cab);
    expect([c.inicioInstalacao, c.inicioReserva]).toEqual([17, 50]);
    let falta: string[] = [];
    lerPlanilha(paraCsv([cab, VENDAS.ana]), (f) => { falta = f; });
    expect(falta).toEqual([]);
    const l = linha({ codigo: '#0072', cliente: 'Zé', consultor: 'Nilce', inicioReserva: '03/09/2026' });
    expect(lerPlanilha(paraCsv([cab, l]))[0].inicioInstalacao).toBe('03/09/2026');
  });
  it('a reserva só vale quando a principal está vazia', () => {
    const l = linha({ codigo: '#0070', cliente: 'Zé', consultor: 'Nilce', fimReserva: '09/09/2026' });
    const [o] = lerPlanilha(paraCsv([CABECALHO, l]));
    expect(o.fimInstalacao).toBe('09/09/2026');
    const l2 = linha({ codigo: '#0071', cliente: 'Zé', consultor: 'Nilce', fim: '01/09/2026', fimReserva: '09/09/2026' });
    expect(lerPlanilha(paraCsv([CABECALHO, l2]))[0].fimInstalacao).toBe('01/09/2026');
  });
});

describe('lerPlanilha', () => {
  const obras = lerPlanilha(planilhaPadrao());
  it('acha o cabeçalho pela linha com NOME CLIENTE (A1 quebrado) e ignora a linha TOTAL', () => {
    expect(obras.map((o) => o.codigo)).toEqual(['#0057', '#0058', '#0059', '#0060', '#0061']);
  });
  it('nenhuma coluna proibida entra no objeto lido', () => {
    const texto = JSON.stringify(obras);
    for (const s of Object.values(PROIBIDAS)) expect(texto).not.toContain(s);
  });
  it('sem cabeçalho dá erro, em vez de lista vazia', () => {
    expect(() => lerPlanilha('a,b\n1,2\n')).toThrow();
  });
  it('avisa as colunas que sumiram do cabeçalho', () => {
    let falta: string[] = [];
    lerPlanilha(paraCsv([CABECALHO.map((h) => (h === 'EQUIPE' ? 'TIME' : h)), VENDAS.ana]), (f) => { falta = f; });
    expect(falta).toContain('equipe');
  });
});

describe('datas e dinheiro', () => {
  it('aceita dd/mm/aaaa, d/mm/aaaa e dd//mm/aaaa', () => {
    expect(parseDataBR('03/08/2026')).toBe('2026-08-03');
    expect(parseDataBR('3/8/2026')).toBe('2026-08-03');
    expect(parseDataBR('12//06/2026')).toBe('2026-06-12');
  });
  it('texto que não é data vira null', () => {
    for (const t of ['nc', 'ok', '', '  ', '31/02/2026', '13/13/2026', '00/01/2026', 'Sim']) expect(parseDataBR(t)).toBeNull();
    expect(parseDataBR(undefined)).toBeNull();
  });
  it('dinheiro brasileiro', () => {
    expect(parseReais('R$ 6.990,00')).toBe(6990);
    expect(parseReais('R$ 1.234.567,89')).toBe(1234567.89);
    expect(parseReais('')).toBe(0);
    expect(parseReais('abc')).toBe(0);
  });
  it('hoje é em Brasília: 22h de BRT ainda é o mesmo dia', () => {
    expect(hojeBRT(new Date('2026-10-11T01:30:00Z'))).toBe('2026-10-10');
    expect(hojeBRT(new Date('2026-10-10T12:00:00Z'))).toBe('2026-10-10');
  });
});

describe('etapas', () => {
  it('só a venda: tudo o mais pendente, projeto é a etapa atual', () => {
    const e = montarEtapas(bruta({ cadastroTrello: '03/08/2026' }));
    expect(e.map((x) => x.chave)).toEqual(['venda', 'projeto', 'material', 'instalacao', 'vistoria', 'liberado']);
    expect(feitas(bruta())).toEqual(['venda']);
    expect(etapaAtualDe(e)).toBe('projeto');
  });
  it('projeto fecha com a data do parecer de acesso', () => {
    const o = bruta({ parecerAcesso: '05/08/2026' });
    expect(feitas(o)).toContain('projeto');
    expect(etapaAtualDe(montarEtapas(o))).toBe('material');
  });
  it('material: os três status em No Cliente ou Instalado fecham', () => {
    const ok = bruta({ statusPlaca: 'No Cliente', statusInversor: 'Instalado', statusEstrutura: 'No Cliente' });
    expect(feitas(ok)).toContain('material');
  });
  it('material: o que falta aparece no detalhe', () => {
    const e = montarEtapas(bruta({ statusPlaca: 'No Cliente', statusInversor: 'Comprar', statusEstrutura: 'Comprar' }));
    const m = e.find((x) => x.chave === 'material')!;
    expect(m.feito).toBe(false);
    expect(m.detalhe).toBe('Comprar: inversor e estrutura');
  });
  it('material: grupos diferentes e status vazio', () => {
    const m = montarEtapas(bruta({ statusPlaca: 'Estoque', statusInversor: 'Comprar', statusEstrutura: 'Comprar' }))[2];
    expect(m.detalhe).toBe('Estoque: placas; Comprar: inversor e estrutura');
    const vazio = montarEtapas(bruta())[2];
    expect(vazio.feito).toBe(false);
    expect(vazio.detalhe).toBe('sem status dos equipamentos');
  });
  it('material: a data de entrega fecha a etapa mesmo com status pendente', () => {
    const e = montarEtapas(bruta({ entregaMaterial: '10/08/2026', statusInversor: 'Comprar' }))[2];
    expect(e.feito).toBe(true);
    expect(e.em).toBe('2026-08-10');
  });
  it('material: equipamento sem status não trava quando o resto está no cliente', () => {
    expect(feitas(bruta({ statusPlaca: 'No Cliente' }))).toContain('material');
  });
  it('instalação: fecha com a data final; sem ela, mostra início ou previsão', () => {
    expect(feitas(bruta({ fimInstalacao: '20/08/2026' }))).toContain('instalacao');
    const ini = montarEtapas(bruta({ inicioInstalacao: '02/10/2026', previsaoMontagem: '01/10/2026' }))[3];
    expect(ini.feito).toBe(false);
    expect(ini.detalhe).toBe('iniciada em 02/10');
    expect(montarEtapas(bruta({ previsaoMontagem: '15/10/2026' }))[3].detalhe).toBe('prevista para 15/10');
    expect(montarEtapas(bruta({ fimInstalacao: '20/08/2026', inicioInstalacao: '02/08/2026' }))[3].detalhe).toBeNull();
  });
  it('vistoria: só o pedido vira "pedida em dd/mm"; a liberação fecha', () => {
    const p = montarEtapas(bruta({ pedidoVistoria: '05/10/2026' }))[4];
    expect(p.feito).toBe(false);
    expect(p.detalhe).toBe('pedida em 05/10');
    const l = montarEtapas(bruta({ pedidoVistoria: '05/10/2026', liberacaoVistoria: '08/10/2026' }))[4];
    expect(l.feito).toBe(true);
    expect(l.detalhe).toBeNull();
  });
  it('liberado só com o texto exato Liberado (Não liberado não vale)', () => {
    expect(feitas(bruta({ liberadoTxt: 'Liberado' }))).toContain('liberado');
    expect(feitas(bruta({ liberadoTxt: 'Não liberado' }))).not.toContain('liberado');
    expect(feitas(bruta({ liberadoTxt: '' }))).not.toContain('liberado');
  });
  it('buraco no meio: etapa posterior feita NÃO marca as anteriores, mas elas ficam semRegistro', () => {
    const o = bruta({ cadastroTrello: '01/06/2026', fimInstalacao: '12/06/2026', liberadoTxt: 'Liberado' });
    const e = montarEtapas(o);
    expect(feitas(o)).toEqual(['venda', 'instalacao', 'liberado']);
    expect(e[1].feito).toBe(false);
    expect(e[1].semRegistro).toBe(true);
    expect(e[2].semRegistro).toBe(true);
    expect(e[4].semRegistro).toBe(true);
    expect(e[0].semRegistro).toBeUndefined();
    expect(e[3].semRegistro).toBeUndefined();
  });
  it('liberada sem data de parecer = concluída, com projeto semRegistro', () => {
    const e = montarEtapas(bruta({ cadastroTrello: '01/06/2026', liberadoTxt: 'Liberado' }));
    expect(etapaAtualDe(e)).toBe('concluida');
    expect(e.find((x) => x.chave === 'projeto')).toMatchObject({ feito: false, semRegistro: true });
    expect(paradoHaDias(e, HOJE)).toBeNull();
  });
  it('etapa atual é a seguinte à última feita, mesmo com buraco antes', () => {
    const e = montarEtapas(bruta({ cadastroTrello: '01/06/2026', fimInstalacao: '12/06/2026' }));
    expect(etapaAtualDe(e)).toBe('vistoria');
    expect(e.find((x) => x.chave === 'vistoria')!.semRegistro).toBeUndefined();
  });
  it('tudo feito: concluída', () => {
    const o = montarObra(bruta(VENDAS_CONCLUIDA), HOJE);
    expect(o.etapaAtual).toBe('concluida');
    expect(o.paradoHaDias).toBeNull();
  });
});

const VENDAS_CONCLUIDA: Partial<ObraBruta> = {
  cadastroTrello: '03/08/2026', parecerAcesso: '05/08/2026', entregaMaterial: '10/08/2026',
  fimInstalacao: '20/08/2026', liberacaoVistoria: '25/08/2026', liberadoTxt: 'Liberado',
};

describe('paradoHaDias', () => {
  it('conta desde a data mais recente entre as etapas feitas', () => {
    const e = montarEtapas(bruta({ cadastroTrello: '03/08/2026', parecerAcesso: '30/09/2026' }));
    expect(paradoHaDias(e, HOJE)).toBe(10);
  });
  it('usa a mais recente mesmo quando está numa etapa posterior ao buraco', () => {
    const e = montarEtapas(bruta({ cadastroTrello: '01/06/2026', fimInstalacao: '01/10/2026' }));
    expect(paradoHaDias(e, HOJE)).toBe(9);
  });
  it('null sem nenhuma data, e nunca negativo', () => {
    expect(paradoHaDias(montarEtapas(bruta()), HOJE)).toBeNull();
    expect(paradoHaDias(montarEtapas(bruta({ cadastroTrello: '20/10/2026' })), HOJE)).toBe(0);
  });
});

describe('origem', () => {
  it('"#0013 Cleber" é indicação do #0013', () => {
    expect(classificarOrigem('#0013 Cleber')).toEqual({ tipo: 'indicacao', texto: '#0013 Cleber', indicadoPor: '#0013' });
  });
  it('"Indicação Adriel" é indicação sem código', () => {
    expect(classificarOrigem('Indicação Adriel')).toEqual({ tipo: 'indicacao', texto: 'Indicação Adriel', indicadoPor: null });
  });
  it('"Recorrente #0008" é recorrente e NÃO credita o #0008 como indicador', () => {
    expect(classificarOrigem('Recorrente #0008')).toEqual({ tipo: 'recorrente', texto: 'Recorrente #0008', indicadoPor: null });
  });
  it('Tráfego, Procurou e Aumento', () => {
    expect(classificarOrigem('Tráfego').tipo).toBe('trafego');
    expect(classificarOrigem('Procurou').tipo).toBe('outro');
    expect(classificarOrigem('Aumento').tipo).toBe('outro');
    expect(classificarOrigem('').tipo).toBe('outro');
  });
  it('código curto e longo são o mesmo', () => {
    expect(codigoCanonico('#13')).toBe('#0013');
    expect(classificarOrigem('#13 Cleber').indicadoPor).toBe('#0013');
  });
  it('o nome na origem', () => {
    expect(nomeNaOrigem('#0013 Cleber')).toBe('Cleber');
    expect(nomeNaOrigem('#0013')).toBe('');
  });
});

describe('pedir depoimento e indicação', () => {
  const agora = new Date('2026-10-10T15:00:00Z');
  const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000).toISOString();
  const pronta = { liberada: true, instalada: true, depoimento: null as 'sim' | null };
  const sem = { depoimentoPedidoEm: null, indicacaoPedidaEm: null, por: null };

  it('liberada e instalada, sem nada pedido: pede os dois', () => {
    expect(calcularPedir(pronta, sem, agora)).toEqual({ depoimento: true, indicacao: true });
  });
  it('sem liberação ou sem instalação não pede nada', () => {
    expect(calcularPedir({ ...pronta, liberada: false }, sem, agora)).toEqual({ depoimento: false, indicacao: false });
    expect(calcularPedir({ ...pronta, instalada: false }, sem, agora)).toEqual({ depoimento: false, indicacao: false });
  });
  it('depoimento já dado (Sim), não faz ou insatisfeito não pede depoimento', () => {
    for (const d of ['sim', 'nao_faz', 'insatisfeito'] as const) {
      expect(calcularPedir({ ...pronta, depoimento: d } as any, sem, agora).depoimento).toBe(false);
    }
    expect(calcularPedir({ ...pronta, depoimento: 'pedido' } as any, sem, agora).depoimento).toBe(true);
  });
  it('insatisfeito não recebe pedido de indicação, os outros recebem', () => {
    expect(calcularPedir({ ...pronta, depoimento: 'insatisfeito' } as any, sem, agora).indicacao).toBe(false);
    expect(calcularPedir({ ...pronta, depoimento: 'sim' } as any, sem, agora).indicacao).toBe(true);
  });
  it('janelas: depoimento 30 dias, indicação 60', () => {
    expect(calcularPedir(pronta, { ...sem, depoimentoPedidoEm: dias(29) }, agora).depoimento).toBe(false);
    expect(calcularPedir(pronta, { ...sem, depoimentoPedidoEm: dias(31) }, agora).depoimento).toBe(true);
    expect(calcularPedir(pronta, { ...sem, indicacaoPedidaEm: dias(59) }, agora).indicacao).toBe(false);
    expect(calcularPedir(pronta, { ...sem, indicacaoPedidaEm: dias(61) }, agora).indicacao).toBe(true);
    // Uma janela não mexe na outra.
    expect(calcularPedir(pronta, { ...sem, depoimentoPedidoEm: dias(1) }, agora).indicacao).toBe(true);
  });
});

describe('quem vê o quê', () => {
  it('padrão thiago e diego; a variável troca a lista', () => {
    expect(listaSocios(undefined)).toEqual(['thiago', 'diego']);
    expect(listaSocios('Thiago, Ana')).toEqual(['thiago', 'ana']);
  });
  it('sócio vê tudo; consultor só o próprio nome, sem acento nem caixa', () => {
    expect(ehSocio('thiago', 'thiago,diego')).toBe(true);
    expect(podeVer('diego', 'Nilce', 'thiago,diego')).toBe(true);
    expect(podeVer('nilce', 'Nilce', 'thiago,diego')).toBe(true);
    expect(podeVer('nilce', 'Giovanna', 'thiago,diego')).toBe(false);
    expect(podeVer('jose', 'José', 'thiago,diego')).toBe(true);
    expect(podeVer('', 'Nilce', 'thiago,diego')).toBe(false);
  });
  it('conta com acento NÃO é sócia nem enxerga a venda do sócio por tabela', () => {
    expect(ehSocio('thiagó', 'thiago,diego')).toBe(false);
    expect(ehSocio('THIAGO', 'thiago,diego')).toBe(true);
    expect(podeVer('thiagó', 'Thiago', 'thiago,diego')).toBe(false);
    expect(podeVer('thiagó', 'Nilce', 'thiago,diego')).toBe(false);
  });
});

describe('montarObra, ordem e resumo', () => {
  const obras = lerPlanilha(planilhaPadrao()).map((b) => montarObra(b, HOJE));
  const por = (c: string) => obras.find((o) => o.codigo === c)!;

  it('cada venda cai na etapa certa', () => {
    expect(por('#0057').etapaAtual).toBe('concluida');
    expect(por('#0058').etapaAtual).toBe('material');
    expect(por('#0059').etapaAtual).toBe('instalacao');
    expect(por('#0060').etapaAtual).toBe('vistoria');
    // Liberada, sem parecer nem material na planilha: buraco, não obra presa.
    expect(por('#0061').etapaAtual).toBe('concluida');
    expect(por('#0061').etapas[1]).toMatchObject({ feito: false, semRegistro: true });
  });
  it('recebimento e valor a receber', () => {
    expect(por('#0058').recebimento).toBe('nao_quitado');
    expect(por('#0058').valores).toEqual({ venda: 10000, recebido: 4000, aReceber: 6000 });
    expect(por('#0057').valores.aReceber).toBe(0);
    expect(por('#0061').recebimento).toBe('sem_registro');
  });
  it('telefone normalizado com 55 ou null', () => {
    expect(por('#0057').telefone).toBe('5534999990000');
    expect(por('#0058').telefone).toBe('5534988887777');
    expect(por('#0059').telefone).toBeNull();
  });
  it('em andamento primeiro (a mais parada no topo), concluídas depois', () => {
    const ord = ordenarObras(obras).map((o) => o.codigo);
    expect(ord).toEqual(['#0060', '#0059', '#0058', '#0057', '#0061']);
  });
  it('resumo: sem dinheiro quando não é sócio', () => {
    const r = resumirObras(obras, false);
    expect(r).toMatchObject({ total: 5, emAndamento: 3, concluidas: 2, naoQuitadas: 1 });
    expect(r.porEtapa).toEqual({ projeto: 0, material: 1, instalacao: 1, vistoria: 1, liberado: 0 });
    expect('aReceber' in r).toBe(false);
    expect(resumirObras(obras, true).aReceber).toBe(6000);
  });
});

describe('mapa e ranking', () => {
  const obras = lerPlanilha(planilhaPadrao()).map((b) => montarObra(b, HOJE));
  it('casa cidade com acento e sem acento no mesmo município', () => {
    const m = montarMapa(obras);
    const u = m.cidades.filter((c) => c.cidade === 'Uberlândia');
    expect(u).toHaveLength(1);
    expect(u[0].uf).toBe('MG');
    // Ana e Fabio: instalação feita. Bruno ainda não instalou.
    expect(u[0]).toMatchObject({ instaladas: 2, emAndamento: 1 });
    expect(typeof u[0].lat).toBe('number');
  });
  it('cidade que não existe vai para semCoordenada', () => {
    const m = montarMapa(obras);
    expect(m.semCoordenada).toBe(1);
    expect(m.semCoordenadaLista).toEqual(['Cidade Inventada/XX']);
  });
  it('venda sem cidade conta em semCoordenada, mas não entra na lista de texto', () => {
    const m = montarMapa([montarObra(bruta({ cidade: '' }), HOJE), montarObra(bruta({ cidade: 'Lugar Nenhum', uf: 'MG' }), HOJE)]);
    expect(m.semCoordenada).toBe(2);
    expect(m.semCoordenadaLista).toEqual(['Lugar Nenhum/MG']);
  });
  it('mesma cidade em outra UF não é a mesma', () => {
    const outras = [bruta({ cidade: 'Bom Jesus', uf: 'PI', fimInstalacao: '01/01/2026' }), bruta({ cidade: 'Bom Jesus', uf: 'RS' })]
      .map((b) => montarObra(b, HOJE));
    expect(montarMapa(outras).cidades.map((c) => c.uf).sort()).toEqual(['PI', 'RS']);
  });
  it('ranking só conta indicação com código; o recorrente não entra', () => {
    const r = montarRanking(obras, new Map([['#0013', 'Cleber']]));
    expect(r).toEqual([{ codigo: '#0013', cliente: 'Cleber', indicou: 1, vendas: ['#0057'] }]);
    // Limitado aos indicadores permitidos (cliente do consultor comum).
    expect(montarRanking(obras, new Map(), new Set(['#0099']))).toEqual([]);
    expect(montarRanking(obras, new Map(), new Set(['#0013']))).toHaveLength(1);
  });
});

describe('colunas proibidas', () => {
  it('as 14 colunas proibidas do cabeçalho existem na fixture (o teste de vazamento é sério)', () => {
    for (const i of Object.keys(PROIBIDAS)) expect(CABECALHO[Number(i)]).toBeTruthy();
    expect(Object.keys(PROIBIDAS).length).toBeGreaterThanOrEqual(14);
    expect(I.fimReserva).toBe(51);
  });
});
