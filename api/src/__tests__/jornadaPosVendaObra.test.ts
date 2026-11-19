import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  garantiasDaObra, geracaoEsperadaKwh, mensagemPosVenda, posvendaInfo, primeiroNomeDe, quandoPosVenda, somarDiasCorridos, somarMeses,
} from '../services/gerador/jornadaPosVendaObra';
import { normalizarObraPrivada, obraPrivadaVazia, posVendaNormal } from '../services/gerador/jornadaObraBanco';
import { MAX_INDICACOES_POSVENDA, MAX_OCORRENCIAS_POSVENDA, SECOES_OBRA } from '../services/gerador/jornadaObra';
import { AJUSTES_PADRAO, assinarAjustes, linkAvaliacaoValido, normalizarAjustes } from '../services/gerador/jornadaDinheiro';
import { CATALOGO, LIMITE_ALBUM_CONCLUSAO, SLOTS_FORA_DO_RELATORIO, itemDoCatalogo, limiteDoItem } from '../services/gerador/docsCliente';
import { SLOTS_LIDOS_SOLAR } from '../services/gerador/cadastroVendaLeitura';

// Pós-venda solar (etapa 9, 19/11/2026): regras puras. Sem banco, sem relógio, nenhuma mensagem sai. Dados inventados.

beforeEach(() => { process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste'; });
afterEach(() => { delete process.env.VINCULO_SOLAR_SECRET; });

describe('as datas do pós-venda', () => {
  it('avaliação 7 dias e geração do mês 1 e primeira conta 30 dias depois da liberação (virada de mês e de ano)', () => {
    expect(quandoPosVenda('2026-11-05')).toEqual({ avaliacao: '2026-11-12', geracao_mes1: '2026-12-05', conta1: '2026-12-05' });
    expect(quandoPosVenda('2026-12-28')).toEqual({ avaliacao: '2027-01-04', geracao_mes1: '2027-01-27', conta1: '2027-01-27' });
    expect(quandoPosVenda('2028-02-01').geracao_mes1).toBe('2028-03-02');   // ano bissexto
  });
  it('sem liberação (ou data torta), tudo null', () => {
    expect(quandoPosVenda(null)).toEqual({ avaliacao: null, geracao_mes1: null, conta1: null });
    expect(quandoPosVenda('05/11/2026')).toEqual({ avaliacao: null, geracao_mes1: null, conta1: null });
  });
  it('somar dias e meses sem estourar o fim do mês', () => {
    expect(somarDiasCorridos('2026-11-30', 1)).toBe('2026-12-01');
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(somarMeses('2026-11-05', 12 * 25)).toBe('2051-11-05');
  });
});

describe('os textos prontos', () => {
  const LINK = 'https://g.page/r/exemplo/review';
  it('avaliação com nome e com link: as 5 linhas, a última é o link', () => {
    expect(mensagemPosVenda('avaliacao', 'Marcos', LINK).split('\n')).toEqual([
      '☀️ Marcos, tudo bem?',
      'A sua usina já está ligada e liberada.',
      'Se você gostou do atendimento da Irmãos na Obra, pode deixar uma avaliação no Google?',
      'Isso ajuda muito a gente.',
      LINK,
    ]);
  });
  it('avaliação sem link: a linha do link sai (e não sobra linha vazia)', () => {
    const t = mensagemPosVenda('avaliacao', 'Marcos', '');
    expect(t.split('\n')).toHaveLength(4);
    expect(t.endsWith('Isso ajuda muito a gente.')).toBe(true);
  });
  it('sem nome a primeira linha vira "☀️ Olá, tudo bem?", nos três textos', () => {
    for (const tipo of ['avaliacao', 'geracao_mes1', 'conta1'] as const) expect(mensagemPosVenda(tipo, '', LINK).split('\n')[0], tipo).toBe('☀️ Olá, tudo bem?');
  });
  it('geração do mês 1 e primeira conta, com o texto combinado', () => {
    expect(mensagemPosVenda('geracao_mes1', 'Ana', LINK)).toBe([
      '☀️ Ana, tudo bem?', 'Já faz um mês que a sua usina foi liberada.', 'Pode me mandar um print da tela do aplicativo do inversor com a geração do mês?',
      'Assim a gente confere se a usina está gerando o esperado.', 'Obrigado por confiar na Irmãos na Obra.',
    ].join('\n'));
    expect(mensagemPosVenda('conta1', 'Ana', LINK)).toBe([
      '☀️ Ana, tudo bem?', 'Quando chegar a primeira conta de luz depois da liberação da usina, me manda uma foto ou o PDF?',
      'A gente confere a compensação e mostra a economia que a usina trouxe.', 'Qualquer dúvida na conta, é só falar.',
    ].join('\n'));
  });
  it('o primeiro nome: primeira palavra, sem marca do WhatsApp, com maiúscula; sem nome, vazio', () => {
    expect(primeiroNomeDe('marcos vinícius andrade')).toBe('Marcos');
    expect(primeiroNomeDe('*Carla* Andrade')).toBe('Carla');
    expect(primeiroNomeDe('   ')).toBe('');
    expect(primeiroNomeDe(null)).toBe('');
  });
});

describe('a geração esperada e as garantias', () => {
  it('a geração da proposta: número, texto com ponto, texto BR; zero, vazio e lixo viram null', () => {
    expect(geracaoEsperadaKwh(412.6)).toBe(413);
    expect(geracaoEsperadaKwh('412.6')).toBe(413);
    expect(geracaoEsperadaKwh('1.234,5')).toBe(1235);
    expect(geracaoEsperadaKwh(0)).toBeNull();
    expect(geracaoEsperadaKwh('')).toBeNull();
    expect(geracaoEsperadaKwh(undefined)).toBeNull();
    expect(geracaoEsperadaKwh('abc')).toBeNull();
  });
  const base = { liberadaEm: '2026-11-05', entregaEm: '2026-11-03', registradaEm: '2026-11-04', treinado: true, modulosAnos: '12', desempenhoModulosAnos: 25, inversorAnos: '10', instalacaoValor: '1', instalacaoUnidade: 'anos' };
  it('módulos e inversor contam da liberação; a instalação, do termo de entrega', () => {
    const g = garantiasDaObra(base);
    expect(g).toMatchObject({ registrada_em: '2026-11-04', treinado: true });
    expect(g.itens.map((i) => [i.chave, i.base, i.vence_em])).toEqual([
      ['modulos', 'liberacao', '2038-11-05'], ['desempenho_modulos', 'liberacao', '2051-11-05'], ['inversor', 'liberacao', '2036-11-05'], ['instalacao', 'entrega', '2027-11-03'],
    ]);
  });
  it('instalação em meses; sem termo cai na liberação; o que não existe não entra; sem liberação não há vencimento', () => {
    const g = garantiasDaObra({ ...base, entregaEm: null, instalacaoValor: '6', instalacaoUnidade: 'meses', desempenhoModulosAnos: null, inversorAnos: '' });
    expect(g.itens.map((i) => [i.chave, i.base, i.vence_em])).toEqual([['modulos', 'liberacao', '2038-11-05'], ['instalacao', 'liberacao', '2027-05-05']]);
    expect(garantiasDaObra({ ...base, liberadaEm: null, entregaEm: null }).itens).toEqual([]);
  });
});

describe('o `posvenda_info`', () => {
  const e = { liberadaEm: '2026-11-05', entregaEm: null, registradaEm: null, treinado: false, modulosAnos: '', desempenhoModulosAnos: null, inversorAnos: '', instalacaoValor: '', instalacaoUnidade: 'anos' };
  it('datas, geração esperada e os três textos com o primeiro nome; falta_link_avaliacao só sem link', () => {
    const com = posvendaInfo({ ...e, esperadoKwhMes: '450', nomeDoCliente: 'Marcos Andrade', linkAvaliacao: ' https://g.page/r/x/review ' });
    expect(com).toMatchObject({ liberada_em: '2026-11-05', esperado_kwh_mes: 450, falta_link_avaliacao: false, quando: { avaliacao: '2026-11-12', geracao_mes1: '2026-12-05', conta1: '2026-12-05' } });
    expect(com.mensagens.avaliacao.split('\n')[0]).toBe('☀️ Marcos, tudo bem?');
    expect(com.mensagens.avaliacao.endsWith('https://g.page/r/x/review')).toBe(true);
    const sem = posvendaInfo({ ...e, esperadoKwhMes: undefined, nomeDoCliente: '', linkAvaliacao: '' });
    expect(sem.falta_link_avaliacao).toBe(true);
    expect(sem.esperado_kwh_mes).toBeNull();
    expect(sem.mensagens.avaliacao.split('\n')).toEqual([
      '☀️ Olá, tudo bem?', 'A sua usina já está ligada e liberada.', 'Se você gostou do atendimento da Irmãos na Obra, pode deixar uma avaliação no Google?', 'Isso ajuda muito a gente.',
    ]);
    expect(Object.keys(sem.mensagens)).toEqual(['avaliacao', 'geracao_mes1', 'conta1']);
  });
  it('antes da liberação não há datas', () => {
    const r = posvendaInfo({ ...e, liberadaEm: null, esperadoKwhMes: null, nomeDoCliente: 'Ana', linkAvaliacao: '' });
    expect(r.liberada_em).toBeNull();
    expect(r.quando).toEqual({ avaliacao: null, geracao_mes1: null, conta1: null });
  });
});

describe('a seção `posvenda` no obra.json', () => {
  it('é uma seção nova, com versão, e a obra antiga (sem a chave) lê vazia', () => {
    expect(SECOES_OBRA).toContain('posvenda');
    const antiga = JSON.parse(JSON.stringify(obraPrivadaVazia())) as Record<string, unknown>;
    delete antiga.posvenda;
    delete (antiga.versoes as Record<string, unknown>).posvenda;
    const n = normalizarObraPrivada(antiga);
    expect(n.posvenda).toEqual(obraPrivadaVazia().posvenda);
    expect(n.versoes.posvenda).toBe(0);
  });
  it('normaliza datas, números e centavos; texto livre sem controle; telefone só com dígitos', () => {
    const r = posVendaNormal({
      avaliacao: { pedida_em: '2026-11-12T10:00:00.000Z', avaliou_em: 'ontem' },
      geracao_mes1: { pedida_em: '2026-12-05', kwh: 431.5, print_id: 'a-print' },
      conta1: { pedida_em: null, arquivo_id: 'a-conta', valor_antes_centavos: 45_000, valor_depois_centavos: 3_900, compensado_kwh: 410 },
      ocorrencias: [{ id: 'o-1', em: '2026-12-01', problema: 'Inversor\u0000 sem wi-fi', resolvido_em: '2026-12-02', solucao: 'Troquei o roteador' }, { id: 'o-2', em: '2026-12-01', problema: '' }],
      indicacoes: [{ id: 'n-1', nome: 'João', telefone: '(34) 99999-0000', em: '2026-12-03' }, { id: '', nome: 'Sem id', telefone: '', em: '2026-12-03' }],
    });
    expect(r.avaliacao).toEqual({ pedida_em: '2026-11-12', avaliou_em: null });
    expect(r.geracao_mes1).toEqual({ pedida_em: '2026-12-05', kwh: 431.5, print_id: 'a-print' });
    expect(r.conta1).toMatchObject({ valor_antes_centavos: 45_000, valor_depois_centavos: 3_900, compensado_kwh: 410 });
    expect(r.ocorrencias).toEqual([{ id: 'o-1', em: '2026-12-01', problema: 'Inversor  sem wi-fi', resolvido_em: '2026-12-02', solucao: 'Troquei o roteador' }]);
    expect(r.indicacoes).toEqual([{ id: 'n-1', nome: 'João', telefone: '34999990000', em: '2026-12-03' }]);
  });
  it('no máximo 50 ocorrências e 50 indicações', () => {
    expect([MAX_OCORRENCIAS_POSVENDA, MAX_INDICACOES_POSVENDA]).toEqual([50, 50]);
    const r = posVendaNormal({
      ocorrencias: Array.from({ length: 60 }, (_, i) => ({ id: `o-${i}`, em: '2026-12-01', problema: `p${i}` })),
      indicacoes: Array.from({ length: 70 }, (_, i) => ({ id: `n-${i}`, nome: `N${i}`, telefone: '', em: '2026-12-01' })),
    });
    expect(r.ocorrencias).toHaveLength(50);
    expect(r.indicacoes).toHaveLength(50);
  });
  it('valor fora da faixa vira null (centavos negativos, kWh gigante)', () => {
    const r = posVendaNormal({ geracao_mes1: { kwh: -1 }, conta1: { valor_antes_centavos: -5, valor_depois_centavos: 1.5, compensado_kwh: 9_999_999 } });
    expect(r.geracao_mes1.kwh).toBeNull();
    expect(r.conta1).toMatchObject({ valor_antes_centavos: null, valor_depois_centavos: null, compensado_kwh: null });
  });
});

describe('o ajuste `link_avaliacao_google`', () => {
  it('só https, até 300 caracteres, sem espaço, sem usuário e senha', () => {
    expect(linkAvaliacaoValido('https://g.page/r/abc/review')).toBe('https://g.page/r/abc/review');
    expect(linkAvaliacaoValido('  https://search.google.com/local/writereview?placeid=XYZ  ')).toBe('https://search.google.com/local/writereview?placeid=XYZ');
    for (const ruim of ['http://g.page/r/abc', 'g.page/r/abc', 'https://', 'https://u:p@g.page/x', 'https://g.page/r/a b', 'javascript:alert(1)', `https://g.page/${'a'.repeat(300)}`, '', null, 5]) {
      expect(linkAvaliacaoValido(ruim), String(ruim)).toBe('');
    }
  });
  it('a assinatura dos Ajustes de antes (sem o link) continua valendo; com o link a assinatura muda; link ruim some', () => {
    const antigo = normalizarAjustes({ ...AJUSTES_PADRAO, editado_em: '2026-11-05T15:00:00.000Z', editado_por: 'thiago' })!;
    expect('link_avaliacao_google' in antigo).toBe(false);
    const comLink = normalizarAjustes({ ...antigo, link_avaliacao_google: 'https://g.page/r/abc/review' })!;
    expect(comLink.link_avaliacao_google).toBe('https://g.page/r/abc/review');
    expect(assinarAjustes(comLink)).not.toBe(assinarAjustes(antigo));
    expect('link_avaliacao_google' in normalizarAjustes({ ...antigo, link_avaliacao_google: 'http://ruim' })!).toBe(false);
    expect(assinarAjustes(normalizarAjustes({ ...antigo, link_avaliacao_google: '' })!)).toBe(assinarAjustes(antigo));
  });
});

describe('os slots novos', () => {
  const vs = CATALOGO.vendasolar;
  it('`ent_extra` é álbum de até 100 fotos (imagem, etapa 7, opcional); `pos_geracao` e `pos_conta` são de 1 arquivo (etapa 9)', () => {
    expect(vs.find((i) => i.chave === 'ent_extra')).toEqual({ chave: 'ent_extra', rotulo: 'Outras fotos da conclusão', aceita: 'imagem', obrigatorio: false, varios: true, etapa: 7 });
    expect(limiteDoItem(itemDoCatalogo('vendasolar', 'ent_extra')!)).toBe(LIMITE_ALBUM_CONCLUSAO);
    expect(LIMITE_ALBUM_CONCLUSAO).toBe(100);
    expect(vs.find((i) => i.chave === 'pos_geracao')).toMatchObject({ aceita: 'imagem', varios: false, obrigatorio: false, etapa: 9 });
    expect(vs.find((i) => i.chave === 'pos_conta')).toMatchObject({ aceita: 'ambos', varios: false, obrigatorio: false, etapa: 9 });
  });
  it('os três ficam fora do Trello, do relatório e da leitura por IA', () => {
    for (const s of ['ent_extra', 'pos_geracao', 'pos_conta']) {
      expect(SLOTS_FORA_DO_RELATORIO.has(s), s).toBe(true);
      expect(SLOTS_LIDOS_SOLAR.includes(s), s).toBe(false);
    }
  });
});
