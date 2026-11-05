import { describe, it, expect } from 'vitest';
import {
  chaveEspera, chaveFila, chaveLiberacao, chavePos, chaveSua, chaveVenda, eventosDoCard, filaDaPessoa, linhasDeDinheiro, linhasSemComprovante, minutoDaVez, naJanelaDaFila, semComprovanteDoLivro,
  paradosComAEquipe, placarDaSemana, textoAniversario, textoEspera, textoFila, textoLiberacao, textoSua, textoVenda, toquesDoDia,
  type DinheiroObra, type GrupoMsg, type ObraFila,
} from '../services/io/jornadaMensagensPuro';
import { estadoMaterializado, blocoVendaCompleto, itensDaEtapa, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { obraMaterializada, type EstadoObra } from '../services/gerador/jornadaObra';

// As regras PURAS das mensagens da Jornada (fase 3). Sem banco, sem relógio, sem envio. Dados inventados.

const AG = new Date('2026-11-05T15:00:00.000Z');          // quinta
const LIG = '2026-11-01T00:00:00.000Z';
const EQUIPE = ['nilce', 'thiago', 'diego', 'giovanna'];
const todos = (o: Partial<Record<GrupoMsg, string | null>> = {}): Record<GrupoMsg, string | null> =>
  ({ venda: LIG, etapa: LIG, fila: LIG, liberacao: null, aniversario: null, ...o });

/** Uma jornada gravada na etapa `etapa` (1 a 4), com os históricos extras. */
function js(card: number, etapa: number, vendedor = 'nilce', hist: EstadoJornada['historico'] = [], em = '2026-11-03T12:00:00.000Z'): EstadoJornada {
  const e = estadoMaterializado(card, vendedor, etapa, em);
  return { ...e, origem: 'vendido', historico: [...e.historico, ...hist] };
}
function jo(card: number, etapa: number, hist: EstadoObra['historico'] = [], em = '2026-11-03T12:00:00.000Z'): EstadoObra {
  const e = obraMaterializada(card, etapa, em, em);
  return { ...e, historico: [...e.historico, ...hist] };
}
const obra = (card: number, o: Partial<ObraFila> = {}): ObraFila => ({
  card, codigo: `#00${card}`, cliente: `Cliente ${card}`, cidade: 'Uberlândia - MG', vendedor: 'nilce', js: null, jo: null, cancelada: false, ...o,
});

describe('os textos', () => {
  it('7.1 aviso de venda, com e sem equipamento', () => {
    expect(textoVenda({ nome: 'Marcos *Andrade*', cidade: 'Uberlândia - MG', kwp: 7.56, placas: 14, vendedor: 'nilce' }).split('\n')).toEqual([
      '🎉🎉🎉 VENDEU! ☀️☀️☀️', '*Marcos Andrade* 🏠', 'Uberlândia-MG · 7,56 kWp · 14 placas ⚡', 'Quem vendeu: *Nilce* 🏆👏', 'Agora é a vistoria. Bora, time! 🚀',
    ]);
    expect(textoVenda({ nome: 'Ana', cidade: 'Araguari-MG', kwp: null, placas: null, vendedor: 'diego' }).split('\n')[2]).toBe('Araguari-MG ⚡');
  });
  it('7.2 é sua, com número e sem número (nunca o asterisco da venda sem número)', () => {
    expect(textoSua({ n: 4, codigo: '#0065', nome: 'Marcos', cidade: 'Uberlândia-MG', vence: '2026-11-09' }).split('\n')).toEqual([
      '📌 É sua: Compra da obra #0065', 'Marcos · Uberlândia-MG', '*Prazo:* 2 dias úteis, até 09/11.', '*Para concluir:* cada item comprado com comprovante.',
    ]);
    const sem = textoSua({ n: 2, codigo: null, nome: 'Marcos', cidade: 'Uberlândia-MG', vence: '2026-11-10' }).split('\n');
    expect(sem[0]).toBe('📌 É sua: Contrato e pagamento de Marcos');
    expect(sem[1]).toBe('Uberlândia-MG');
    expect(sem.slice(0, 2).join('\n')).not.toContain('*');
    expect(textoSua({ n: 5, codigo: '#0065', nome: 'M', cidade: '', vence: null })).toContain('*Prazo:* marque os dias da obra na etapa 6.');
  });
  it('7.5 esperando', () => {
    expect(textoEspera({ codigo: '#0065', nome: 'Marcos', n: 8, ate: '2026-11-12', marcou: 'thiago', motivo: 'cemig' }).split('\n')).toEqual([
      '⏸️ #0065 Marcos em espera até 12/11', '*Etapa:* Liberação · *Marcou:* Thiago', '*Motivo:* esperando a Cemig.', '*A cobrança volta em 12/11.*',
    ]);
  });
  it('7.7, 7.8 e 7.9 (normal e atrasado, 1 ano e 2 anos); emoji só na primeira linha', () => {
    const link = 'https://solardoc.app/io/indicacao?i=1-abcdefghij';
    const lib = textoLiberacao({ primeiro: 'Marcos', link }).split('\n');
    expect(lib).toEqual([
      '☀️ Marcos, a sua usina foi liberada pela Cemig.', 'Obrigado por confiar na Irmãos na Obra.', 'O Book da obra vai em PDF, com o termo de garantia.',
      `Conhece alguém que quer pagar menos na conta de luz? Mande este link para ele: ${link}`,
    ]);
    expect(textoAniversario({ toque: 'aniv', primeiro: 'Ana', atrasado: false, link }).split('\n')[0]).toBe('🎂 Feliz aniversário, Ana.');
    expect(textoAniversario({ toque: 'aniv', primeiro: 'Ana', atrasado: true, link }).split('\n')[0]).toBe('🎂 Feliz aniversário atrasado, Ana.');
    expect(textoAniversario({ toque: 'usina', primeiro: 'Ana', atrasado: false, anos: 1, link }).split('\n').slice(0, 2)).toEqual(['☀️ Ana, hoje a sua usina faz 1 ano.', 'Parabéns pela escolha.']);
    expect(textoAniversario({ toque: 'usina', primeiro: 'Ana', atrasado: true, anos: 2, link })).toContain('☀️ Ana, esta semana a sua usina fez 2 anos.');
    for (const t of [textoLiberacao({ primeiro: 'A', link }), textoAniversario({ toque: 'aniv', primeiro: 'A', atrasado: false, link }), textoAniversario({ toque: 'usina', primeiro: 'A', atrasado: true, anos: 2, link })]) {
      expect(t.split('\n').slice(1).join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(textoLiberacao({ primeiro: 'Marcos', link: null }).split('\n')).toHaveLength(3);
  });
});

describe('os eventos (só o gravado por gente, depois do "ligado em")', () => {
  const concluiu3 = { em: '2026-11-05T14:00:00.000Z', por: 'thiago', acao: 'concluir' as const, etapa: 3 };

  it('a venda deduzida (sem js e sem jo) nunca dispara', () => {
    expect(eventosDoCard({ card: 1, js: null, jo: null, vendedor: 'nilce' }, AG, todos())).toEqual([]);
  });
  it('materializada e por "leitura" não disparam; um concluir de gente depois da materialização dispara', () => {
    const so = js(1, 4);
    expect(eventosDoCard({ card: 1, js: so, jo: null, vendedor: 'nilce' }, AG, todos({ etapa: '2026-11-03T00:00:00.000Z' }))).toEqual([]);
    const lido = js(1, 4, 'nilce', [{ em: '2026-11-05T14:00:00.000Z', por: 'leitura', acao: 'concluir', etapa: 3 }]);
    expect(eventosDoCard({ card: 1, js: lido, jo: null, vendedor: 'nilce' }, AG, todos())).toEqual([]);
    const gente = js(1, 4, 'nilce', [concluiu3]);
    expect(eventosDoCard({ card: 1, js: gente, jo: null, vendedor: 'nilce' }, AG, todos())).toHaveLength(1);
  });
  it('a sonda só conta com aceitarSonda', () => {
    const s = js(1, 4, 'nilce', [{ ...concluiu3, por: 'sonda' }]);
    expect(eventosDoCard({ card: 1, js: s, jo: null, vendedor: 'nilce' }, AG, todos())).toEqual([]);
    expect(eventosDoCard({ card: 1, js: s, jo: null, vendedor: 'nilce' }, AG, todos(), { aceitarSonda: true })).toHaveLength(1);
  });
  it('antes do ligado_em, com mais de 24 h e com o grupo desligado: não', () => {
    const e = js(1, 4, 'nilce', [concluiu3]);
    expect(eventosDoCard({ card: 1, js: e, jo: null, vendedor: 'nilce' }, AG, todos({ etapa: '2026-11-05T14:30:00.000Z' }))).toEqual([]);
    expect(eventosDoCard({ card: 1, js: e, jo: null, vendedor: 'nilce' }, new Date('2026-11-06T14:00:01.000Z'), todos())).toEqual([]);
    expect(eventosDoCard({ card: 1, js: e, jo: null, vendedor: 'nilce' }, AG, todos({ etapa: null }))).toEqual([]);
  });
  it('"É sua" vai para os donos menos quem concluiu; as chaves são as da 2.2', () => {
    const e = js(65, 4, 'nilce', [concluiu3]);
    const [ev] = eventosDoCard({ card: 65, js: e, jo: null, vendedor: 'nilce' }, AG, todos());
    expect(ev).toMatchObject({ grupo: 'etapa', tipo: 'sua', etapa: 4, para: ['diego'], chaves: [chaveSua(65, 4, 'diego')] });
    expect(chaveSua(65, 4, 'diego')).toBe('jornada_env:sua:65:4:diego');
  });
  it('etapa que já andou não recebe "É sua" atrasado; o abrir do jo não duplica o concluir', () => {
    const j = jo(65, 5, [{ em: '2026-11-05T14:10:00.000Z', por: 'thiago', acao: 'concluir', etapa: 4 }, { em: '2026-11-05T14:10:00.000Z', por: 'thiago', acao: 'abrir', etapa: 5 }]);
    const e = js(65, 4, 'nilce', [concluiu3]);
    const evs = eventosDoCard({ card: 65, js: e, jo: j, vendedor: 'nilce' }, AG, todos());
    expect(evs.map((x) => x.etapa)).toEqual([5]);          // a 4 já andou
    expect(evs[0].para).toEqual(['diego']);
  });
  it('"Esperando": donos mais o Thiago, menos quem marcou; espera trocada depois do evento não vale', () => {
    const base = js(65, 2, 'nilce');
    const marcada: EstadoJornada = { ...base, esperando: { motivo: 'cliente', ate: '2026-11-12', etapa: 2, em: '2026-11-05T14:00:00.000Z', por: 'giovanna' },
      historico: [...base.historico, { em: '2026-11-05T14:00:00.000Z', por: 'giovanna', acao: 'esperar', etapa: 2 }] };
    const [ev] = eventosDoCard({ card: 65, js: marcada, jo: null, vendedor: 'nilce' }, AG, todos());
    expect(ev).toMatchObject({ tipo: 'espera', etapa: 2, para: ['thiago'], chaves: [chaveEspera(65, 2, '2026-11-12', 'thiago')] });
    const outra: EstadoJornada = { ...marcada, esperando: { ...marcada.esperando!, em: '2026-11-05T14:20:00.000Z' } };
    expect(eventosDoCard({ card: 65, js: outra, jo: null, vendedor: 'nilce' }, AG, todos())).toEqual([]);
  });
  it('venda cancelada: nada', () => {
    const e = { ...js(1, 4, 'nilce', [concluiu3]), cancelada: { em: AG.toISOString(), por: 'thiago', etapa: 4, com_numero: false } };
    expect(eventosDoCard({ card: 1, js: e, jo: null, vendedor: 'nilce' }, AG, todos())).toEqual([]);
  });
  it('venda_completa só com origem vendido, para a equipe recebida por parâmetro', () => {
    const h = { em: '2026-11-05T14:00:00.000Z', por: 'nilce', acao: 'venda_completa' as const, etapa: 1 };
    const aberta = { ...js(7, 1, 'nilce', [h]) };
    const [ev] = eventosDoCard({ card: 7, js: aberta, jo: null, vendedor: 'nilce' }, AG, todos(), { equipeVenda: EQUIPE });
    expect(ev).toMatchObject({ grupo: 'venda', tipo: 'venda', para: EQUIPE, chaves: EQUIPE.map((p) => chaveVenda(7, p)) });
    expect(eventosDoCard({ card: 7, js: { ...aberta, origem: 'leitura' }, jo: null, vendedor: 'nilce' }, AG, todos(), { equipeVenda: EQUIPE })).toEqual([]);
    expect(eventosDoCard({ card: 7, js: aberta, jo: null, vendedor: 'nilce' }, AG, todos())[0].para).toEqual([]);
  });
});

describe('a fila, a escalada, o placar e o dinheiro', () => {
  const HOJE = '2026-11-05';
  it('filaDaPessoa: a ordem, sem esperando, só obra gravada, os donos da etapa 4 nos dois', () => {
    const atrasada = obra(1, { js: js(1, 2, 'nilce', [], '2026-10-20T12:00:00.000Z') });             // etapa 2 (Giovanna), aberta há tempo
    const hoje = obra(2, { js: js(2, 2, 'nilce', [], '2026-11-02T12:00:00.000Z') });                  // vence em 05/11
    const noPrazo = obra(3, { js: js(3, 2, 'nilce', [], '2026-11-04T12:00:00.000Z') });
    const espera: EstadoJornada = { ...js(4, 2, 'nilce'), esperando: { motivo: 'cliente', ate: '2026-11-20', etapa: 2, em: AG.toISOString(), por: 'giovanna' } };
    const deduzida = obra(5, { js: null, jo: null });
    const compra = obra(6, { js: js(6, 4, 'nilce'), jo: jo(6, 4) });
    const todas = [noPrazo, hoje, atrasada, obra(4, { js: espera }), deduzida, compra];
    const g = filaDaPessoa('giovanna', todas, HOJE).itens;
    expect(g.map((i) => i.tipo)).toEqual(['atrasada', 'vence_hoje', 'no_prazo']);
    expect(g.map((i) => i.card)).toEqual([1, 2, 3]);
    expect(filaDaPessoa('diego', todas, HOJE).itens.map((i) => i.card)).toEqual([6]);
    expect(filaDaPessoa('thiago', todas, HOJE).itens.map((i) => i.card)).toEqual([6]);
    expect(filaDaPessoa('nilce', todas, HOJE).itens).toEqual([]);
  });
  it('paradosComAEquipe: etapa de outra gente, atrasada ou travada há 2 dias úteis ou mais', () => {
    const parada = obra(1, { js: js(1, 2, 'nilce', [], '2026-10-20T12:00:00.000Z') });
    const recente = obra(2, { js: js(2, 2, 'nilce', [], '2026-11-02T12:00:00.000Z') });
    const doThiago = obra(3, { js: js(3, 3, 'nilce', [], '2026-10-01T12:00:00.000Z') });
    const e = paradosComAEquipe([recente, doThiago, parada], HOJE);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ card: 1, dono: 'Giovanna', etapaCurta: 'Contrato' });
    expect(e[0].dias).toBeGreaterThanOrEqual(3);
  });
  it('placarDaSemana: no prazo, atrasada, as abertas atrasadas e só a semana anterior', () => {
    // 2026-11-09 é segunda; a semana vai de 02/11 a 08/11.
    const a = obra(1, { js: js(1, 3, 'nilce', [{ em: '2026-11-04T12:00:00.000Z', por: 'giovanna', acao: 'concluir', etapa: 2 }], '2026-11-02T12:00:00.000Z') });
    const velha = obra(2, { js: js(2, 3, 'nilce', [{ em: '2026-10-28T12:00:00.000Z', por: 'giovanna', acao: 'concluir', etapa: 2 }], '2026-10-27T12:00:00.000Z') });
    const p = placarDaSemana([a, velha], '2026-11-09', '2026-11-09');
    expect(p.find((x) => x.pessoa === 'giovanna')?.noPrazo).toBe(1);
    expect(p.every((x) => ['nilce', 'giovanna', 'thiago', 'diego'].includes(x.pessoa))).toBe(true);
  });
  it('dinheiro: a Giovanna cobra comissão e recebimento, o Thiago o que não foi conferido, os outros nada; a retirada só para quem a vê', () => {
    const obras: DinheiroObra[] = [{ card: 1, rotulo: '#0065 Marcos', comissoes: [{ valor_centavos: 194_500, papel: 'venda' }, { valor_centavos: 77_800, papel: 'socio' }], a_receber_centavos: 500_000, nao_conferidas: 2, nao_conferidas_retirada: 1 }];
    expect(linhasDeDinheiro('giovanna', obras).flat()).toEqual(['Comissão a pagar: #0065 Marcos · R$ 2.723,00', 'A receber: #0065 Marcos · R$ 5.000,00']);
    expect(linhasDeDinheiro('thiago', obras).flat()).toEqual(['Para conferir: #0065 Marcos · 3 lançamentos']);
    expect(linhasDeDinheiro('diego', obras)).toEqual([]);
    expect(linhasDeDinheiro('nilce', obras)).toEqual([]);
  });
  it('"Falta comprovante": cada pessoa cobra o que ELA lançou, com a obra e o valor; a retirada só para quem a vê; o bloco vai na mesma mensagem', () => {
    const obras: DinheiroObra[] = [
      {
        card: 1, rotulo: '#0065 Marcos', comissoes: [], a_receber_centavos: 0, nao_conferidas: 0, nao_conferidas_retirada: 0,
        sem_comprovante: [
          { criado_por: 'diego', valor_centavos: 25_000, retirada: false }, { criado_por: 'diego', valor_centavos: 5_000, retirada: false },
          { criado_por: 'nilce', valor_centavos: 6_000, retirada: false }, { criado_por: 'giovanna', valor_centavos: 77_800, retirada: true },
          { criado_por: 'diego', valor_centavos: 1_000, retirada: true },
        ],
      },
      { card: 2, rotulo: '#0066 Ana', comissoes: [], a_receber_centavos: 0, nao_conferidas: 0, nao_conferidas_retirada: 0, sem_comprovante: [{ criado_por: 'diego', valor_centavos: 12_345, retirada: false }] },
      { card: 3, rotulo: '#0067 Sem nada', comissoes: [], a_receber_centavos: 0, nao_conferidas: 0, nao_conferidas_retirada: 0 },
    ];
    expect(linhasSemComprovante('diego', obras).flat()).toEqual(['Falta comprovante: #0065 Marcos · 2 lançamentos, R$ 300,00', 'Falta comprovante: #0066 Ana · R$ 123,45']);
    expect(linhasSemComprovante('nilce', obras).flat()).toEqual(['Falta comprovante: #0065 Marcos · R$ 60,00']);
    expect(linhasSemComprovante('giovanna', obras).flat()).toEqual(['Falta comprovante: #0065 Marcos · R$ 778,00']);
    expect(linhasSemComprovante('thiago', obras)).toEqual([]);
    const t = textoFila({ pessoa: 'diego', itens: [], hoje: HOJE, semComprovante: linhasSemComprovante('diego', obras) })!.split('\n');
    expect(t[0]).toBe('☀️ Sua fila hoje, Diego');
    expect(t).toContain('*Falta comprovante:*');
    expect(t).toContain('Falta comprovante: #0066 Ana · R$ 123,45');
    // Só o bloco novo já basta para existir mensagem (e é UMA mensagem).
    expect(textoFila({ pessoa: 'nilce', itens: [], hoje: HOJE, semComprovante: [] })).toBeNull();
  });
  it('semComprovanteDoLivro pega só as linhas pendentes e marca a retirada', () => {
    expect(semComprovanteDoLivro([
      { sem_comprovante: true, criado_por: 'diego', valor_centavos: 100, grupo: 'custo' }, { sem_comprovante: false, criado_por: 'diego', valor_centavos: 200, grupo: 'custo' },
      { sem_comprovante: true, criado_por: 'giovanna', valor_centavos: 300, grupo: 'retirada' },
    ])).toEqual([{ criado_por: 'diego', valor_centavos: 100, retirada: false }, { criado_por: 'giovanna', valor_centavos: 300, retirada: true }]);
  });
  it('textoFila: escalada com "Falta", dinheiro e placar viram blocos da MESMA mensagem; "Nada seu"; teto de 25 linhas; sem nada, null', () => {
    const itens = filaDaPessoa('diego', [obra(6, { js: js(6, 4, 'nilce'), jo: jo(6, 4) })], HOJE).itens;
    const t = textoFila({
      pessoa: 'thiago', itens: [], hoje: HOJE,
      escalada: [{ card: 1, rotulo: '#0001 Ana', etapa: 5, etapaCurta: 'Logística', dono: 'Diego', dias: 3, falta: ['Carga 1 sem frete', 'Carga 2 sem nota', 'Fotos', 'Mais um'] }],
      dinheiro: [['Para conferir: #0001 Ana · 1 lançamento']], placar: [{ pessoa: 'nilce', noPrazo: 6, atrasadas: 1 }, { pessoa: 'thiago', noPrazo: 4, atrasadas: 2 }],
    })!.split('\n');
    expect(t[0]).toBe('☀️ Sua fila hoje, Thiago');
    expect(t[1]).toBe('Nada seu na fila hoje.');
    expect(t).toContain('*Parado com a equipe:*');
    expect(t).toContain('#0001 Ana · Logística · Diego · 3 dias · Travada');
    expect(t).toContain('Falta: Carga 1 sem frete; Carga 2 sem nota; Fotos e mais 1');
    expect(t).toContain('*Dinheiro para resolver:*');
    expect(t).toContain('Nilce 6 x 1 · Thiago 4 x 2');
    expect(textoFila({ pessoa: 'diego', itens, hoje: HOJE })!.split('\n')[1]).toBe('*Vence hoje:* #006 Cliente 6 · Compra');
    expect(textoFila({ pessoa: 'nilce', itens: [], hoje: HOJE })).toBeNull();
    const muitos = Array.from({ length: 30 }, (_, i) => ({ tipo: 'sem_prazo' as const, card: i, rotulo: `Obra ${i}`, etapaCurta: 'Compra' }));
    const cheia = textoFila({ pessoa: 'diego', itens: muitos, hoje: HOJE })!.split('\n');
    expect(cheia).toHaveLength(1 + 25 + 1);
    expect(cheia[cheia.length - 1]).toBe('E mais 5 na lista de Clientes.');
  });
});

describe('toquesDoDia', () => {
  const c8 = new Map([[1, '2026-10-01T12:00:00.000Z']]);
  const PRIMEIRO = '2026-09-01T00:00:00.000Z';
  const cache = (aniv: string | null, liberada: string | null) => new Map([[1, { aniv, liberada }]]);
  const hoje = (d: string, aniv = '11-10', lib: string | null = null, c = c8) => toquesDoDia(cache(aniv, lib), d, '2026-10-02T00:00:00.000Z', PRIMEIRO, c);

  it('sai em D, em D+1 e D+2 como atrasado e D+3 desiste', () => {
    expect(hoje('2026-11-10')).toEqual([{ card: 1, toque: 'aniv', ano: 2026, atrasado: false }]);
    expect(hoje('2026-11-11')[0].atrasado).toBe(true);
    expect(hoje('2026-11-12')[0].atrasado).toBe(true);
    expect(hoje('2026-11-13')).toEqual([]);
    expect(hoje('2026-11-09')).toEqual([]);
  });
  it('domingo em D sai na segunda como atrasado (2026-11-08 é domingo)', () => {
    const t = hoje('2026-11-09', '11-08');
    expect(t).toHaveLength(1);
    expect(t[0].atrasado).toBe(true);
  });
  it('nunca retroativo: D antes do ligado_em atual não sai; obra concluída antes do primeiro_ligado_em não entra', () => {
    expect(toquesDoDia(cache('11-10', null), '2026-11-10', '2026-11-11T12:00:00.000Z', PRIMEIRO, c8)).toEqual([]);
    expect(toquesDoDia(cache('11-10', null), '2026-11-10', '2026-10-02T00:00:00.000Z', '2026-10-05T00:00:00.000Z', c8)).toEqual([]);
    expect(hoje('2026-10-01', '10-01')).toEqual([]);     // D no dia da conclusão: não (D tem de ser depois)
  });
  it('29/02 sai em 28/02 nos anos que não são bissextos; em 2028 sai em 29/02', () => {
    expect(toquesDoDia(cache('02-29', null), '2027-02-28', '2026-10-02T00:00:00.000Z', PRIMEIRO, c8)).toHaveLength(1);
    expect(toquesDoDia(cache('02-29', null), '2028-02-29', '2026-10-02T00:00:00.000Z', PRIMEIRO, c8)).toHaveLength(1);
    expect(toquesDoDia(cache('02-29', null), '2028-02-28', '2026-10-02T00:00:00.000Z', PRIMEIRO, c8)).toEqual([]);
  });
  it('virada de ano: 31/12 atrasado em 01/01', () => {
    const t = toquesDoDia(cache('12-31', null), '2027-01-01', '2026-10-02T00:00:00.000Z', PRIMEIRO, c8);
    expect(t).toEqual([{ card: 1, toque: 'aniv', ano: 2026, atrasado: true }]);
  });
  it('usina com N = 1 e N = 2; a liberação do próprio ano não conta', () => {
    expect(hoje('2027-11-06', '01-01', '2026-11-06')).toEqual([{ card: 1, toque: 'usina', ano: 2027, atrasado: false, anos: 1 }]);
    expect(toquesDoDia(cache(null, '2026-11-06'), '2028-11-06', '2026-10-02T00:00:00.000Z', PRIMEIRO, c8)[0]).toMatchObject({ toque: 'usina', anos: 2 });
    expect(toquesDoDia(cache(null, '2026-11-06'), '2026-11-06', '2026-10-02T00:00:00.000Z', PRIMEIRO, c8)).toEqual([]);
  });
});

describe('janelas e chaves', () => {
  it('naJanelaDaFila: 07:59 não, 08:00 sim, 08:30 sim, 08:31 não, domingo não, feriado não', () => {
    expect(naJanelaDaFila(new Date('2026-11-05T10:59:00Z'))).toBe(false);
    expect(naJanelaDaFila(new Date('2026-11-05T11:00:00Z'))).toBe(true);
    expect(naJanelaDaFila(new Date('2026-11-05T11:30:59Z'))).toBe(true);
    expect(naJanelaDaFila(new Date('2026-11-05T11:31:00Z'))).toBe(false);
    expect(naJanelaDaFila(new Date('2026-11-07T11:05:00Z'))).toBe(true);      // sábado
    expect(naJanelaDaFila(new Date('2026-11-08T11:05:00Z'))).toBe(false);     // domingo
    expect(naJanelaDaFila(new Date('2026-11-02T11:05:00Z'))).toBe(false);     // Finados
  });
  it('minutoDaVez é o minuto par para baixo, em UTC', () => {
    expect(minutoDaVez(new Date('2026-11-05T11:07:30Z'))).toBe('202611051106');
    expect(minutoDaVez(new Date('2026-11-05T11:06:00Z'))).toBe('202611051106');
  });
  it('as chaves não levam telefone, nome nem texto', () => {
    const ks = [chaveVenda(1, 'nilce'), chaveSua(1, 4, 'diego'), chaveEspera(1, 4, '2026-11-12', 'thiago'), chaveFila('2026-11-05', 'giovanna'), chaveLiberacao(1), chavePos(1, 'aniv', 2026)];
    expect(ks).toEqual(['jornada_env:venda:1:nilce', 'jornada_env:sua:1:4:diego', 'jornada_env:espera:1:4:2026-11-12:thiago', 'jornada_env:fila:2026-11-05:giovanna', 'jornada_lib_sent:1', 'jornada_pos_sent:1:aniv:2026']);
  });
});

describe('blocoVendaCompleto', () => {
  const venda = (o: Record<string, unknown> = {}) => ({
    v: 1 as const,
    venda: { valor_centavos: 100, pagamento: [{ forma: 'pix' as const, valor_centavos: 100, obs: '' }], desconto_centavos: null, prazo_prometido: '30 dias', nota: '', kit_confirmado: true, combinado_por: 'x', combinado_em: AG.toISOString(), editado: [], ...o },
    cancelamento: null, descancelamentos: [],
  });
  it('é igual ao bloco Venda do itensDaEtapa(1) em 8 combinações', () => {
    const casos: Array<[string | null, ReturnType<typeof venda> | null]> = [
      ['P1', venda()], [null, venda()], ['P1', venda({ kit_confirmado: false })], ['P1', venda({ valor_centavos: 0, pagamento: [] })],
      ['P1', venda({ prazo_prometido: '   ' })], ['P1', null], ['P1', venda({ pagamento: [{ forma: 'pix', valor_centavos: 50, obs: '' }] })], [null, null],
    ];
    expect(casos).toHaveLength(8);
    for (const [proposta, privado] of casos) {
      const f = { lig: { proposta, venda: null }, slots: new Set<string>(), cad: { campos: {} } as never, privado: privado as never, estado: null };
      const esperado = itensDaEtapa(1, f).filter((i) => i.bloco === 'venda').every((i) => i.feito);
      expect(blocoVendaCompleto({ proposta }, privado as never), JSON.stringify([proposta, privado?.venda])).toBe(esperado);
    }
  });
});
