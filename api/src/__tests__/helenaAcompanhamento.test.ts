import { describe, it, expect, vi, beforeEach } from 'vitest';

// Acompanhamento da Helena: mapeamento de estágio para situação, itens, placar, contagens de hoje, ficha e o
// cache de 60 s. Nomes inventados, nenhum telefone real.

const h = vi.hoisted(() => ({
  fila: [] as unknown[],
  sessoes: new Map<string, unknown>(),
  carimbos: new Map<string, Record<number, string>>(),
  chamadasDaFila: 0,
  falhaDaFila: false,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => { throw new Error('banco não deve ser tocado aqui'); } } }));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: { from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 77, quando: '2026-11-14T13:00:00Z' }], error: null }) }) }) },
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  vagasDoFrioLinha: async () => ({ hora: { teto: 6, usadas: 1 }, dia: { teto: 30, usadas: 12 } }),
}));
vi.mock('../services/io/investidorAgente', () => ({
  lerFila: async () => {
    h.chamadasDaFila++;
    if (h.falhaDaFila) throw new Error('leitura da fila falhou');
    return { resultado: { fila: h.fila }, sessoes: h.sessoes };
  },
  lerCarimbosDeToque: async () => h.carimbos,
  lerChaveDesligar: async () => ({ off: false, por: null }),
  contarAberturasHoje: async () => 5,
  contarRetomadasHoje: async () => 3,
  lerTudo: async () => [],
}));

import {
  situacaoDaSessao, itemDaFila, itemDaSessao, montarPlacar, contarDeHoje, fichaPreenchida,
  lerAcompanhamento, limparCacheDaHelena, CACHE_MS, SITUACOES,
} from '../services/io/helenaAcompanhamento';

const sessao = (o: Record<string, unknown> = {}) => ({
  estagio: 'chamado', aberto_em: '2026-11-10T12:00:00Z', abertura: 0, origem: 'parceria', id: 1, refs: [], telefone: '5511900000001',
  nome: 'Marta Inventada', cidade: 'Cidade Exemplo-PR', cadastro_em: null, valor_txt: 'R$ 100 mil', consultor: 'Renata',
  oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null, dados: {}, resumo: '', erro: null, ate: null, respostas: 0,
  atualizado_em: '2026-11-10T12:00:00Z', tipo: 'investidor', ...o,
}) as any;

const candidato = (o: Record<string, unknown> = {}) => ({
  chave: '1190000001', telefone: '5511900000001', nome: 'Paulo Fictício', valorTxt: 'R$ 50 mil', valorMil: 50, origem: 'parceria', id: 1,
  criadoEm: '2026-11-01T00:00:00Z', cidade: 'Vila Teste-SP', status: null, refs: [], tipo: 'investidor', nota: null, retorno: false,
  card: { id: 9, status: 'cancelado', quando: null, origem: 'eletroposto', vendedor: 'Aline' }, lado: null, cardsConhecidos: [9],
  faixa: 'card_parado', fatosDoCard: [], ...o,
}) as any;

beforeEach(() => {
  h.fila = []; h.sessoes = new Map(); h.carimbos = new Map(); h.chamadasDaFila = 0; h.falhaDaFila = false;
  limparCacheDaHelena();
});

describe('situacaoDaSessao', () => {
  it('quem passou para a equipe por silêncio ou porque a equipe assumiu fica COM O CONSULTOR (a agenda não esconde o card dele)', () => {
    for (const motivo of ['silencio_depois_do_convite', 'equipe_assumiu']) {
      expect(situacaoDaSessao(sessao({ estagio: 'humano', motivo }))).toBe('com_consultor');
    }
  });
  it('mapeia cada estágio da Helena para a situação da tela', () => {
    expect(situacaoDaSessao(sessao({ estagio: 'chamado' }))).toBe('abordado');
    expect(situacaoDaSessao(sessao({ estagio: 'conversando', respostas: 0 }))).toBe('abordado');
    expect(situacaoDaSessao(sessao({ estagio: 'conversando', respostas: 2 }))).toBe('em_conversa');
    expect(situacaoDaSessao(sessao({ estagio: 'adiado' }))).toBe('em_conversa');
    expect(situacaoDaSessao(sessao({ estagio: 'conversando', respostas: 2, convidou_em: '2026-11-12T12:00:00Z' }))).toBe('convidado');
    expect(situacaoDaSessao(sessao({ estagio: 'ofertou', convidou_em: '2026-11-12T12:00:00Z' }))).toBe('horarios_enviados');
    expect(situacaoDaSessao(sessao({ estagio: 'agendado', convidou_em: '2026-11-12T12:00:00Z' }))).toBe('reuniao_marcada');
    expect(situacaoDaSessao(sessao({ estagio: 'ofertou' }))).toBe('horarios_enviados');
    expect(situacaoDaSessao(sessao({ estagio: 'agendado' }))).toBe('reuniao_marcada');
    expect(situacaoDaSessao(sessao({ estagio: 'humano' }))).toBe('com_consultor');
  });
  it('separa os motivos de sem_interesse como a coluna Atendimento do /gerador', () => {
    expect(situacaoDaSessao(sessao({ estagio: 'sem_interesse', motivo: 'sem_resposta' }))).toBe('sem_resposta');
    expect(situacaoDaSessao(sessao({ estagio: 'sem_interesse', motivo: 'disse_nao' }))).toBe('sem_interesse');
    for (const m of ['pediu_parar', 'opt_out_por_outra_trilha', 'fora_do_padrao']) {
      expect(situacaoDaSessao(sessao({ estagio: 'sem_interesse', motivo: m }))).toBe('parou');
    }
  });
  it('abertura que não saiu é envio falhou, mas só em estágio ativo', () => {
    expect(situacaoDaSessao(sessao({ estagio: 'chamado', erro: 'timeout' }))).toBe('envio_falhou');
    expect(situacaoDaSessao(sessao({ estagio: 'humano', erro: 'timeout' }))).toBe('com_consultor');
  });
  it('só devolve situações conhecidas', () => {
    for (const e of ['chamado', 'conversando', 'ofertou', 'adiado', 'agendado', 'sem_interesse', 'humano', 'estagio_novo_qualquer']) {
      expect(SITUACOES).toContain(situacaoDaSessao(sessao({ estagio: e, respostas: 1 })));
    }
  });
});

describe('itens', () => {
  it('quem está na fila leva a posição, a faixa e nenhum telefone', () => {
    const i = itemDaFila(candidato(), 3);
    expect(i).toMatchObject({ situacao: 'na_fila', posicao_fila: 3, faixa: 'pediu_reuniao', consultor: 'Aline', card_id: 9, tipo: 'investidor', valor_txt: 'R$ 50 mil' });
    expect(JSON.stringify(i)).not.toContain('5511');
    expect(itemDaFila(candidato({ faixa: 'lote_mudo', card: null }), 1)).toMatchObject({ faixa: 'lote_13_10', consultor: null, card_id: null });
    expect(itemDaFila(candidato({ retorno: true }), 1)).toMatchObject({ faixa: 'retorno', proximo_passo: { o_que: 'Abertura de retorno' } });
    expect(itemDaFila(candidato({ tipo: 'curioso' }), 1).valor_txt).toBeNull();
  });
  it('sessão: último contato é o mais recente entre a sessão e os toques, e o próximo passo vem da régua das retomadas', () => {
    const i = itemDaSessao('1190000001', sessao(), { 1: '2026-11-10T12:00:00Z', 2: '2026-11-13T12:00:00Z' }, null);
    expect(i.situacao).toBe('abordado');
    expect(i.ultimo_contato_em).toBe('2026-11-13T12:00:00.000Z');
    expect(i.proximo_passo?.o_que).toMatch(/^Toque [3-5]$/);
    expect(i.proximo_passo?.quando).toMatch(/^\d{4}-/);
    expect(i.posicao_fila).toBeNull();
    expect(i.toques).toBe(1);
  });
  it('reunião marcada leva o horário do card; horários enviados espera a escolha', () => {
    expect(itemDaSessao('1', sessao({ estagio: 'agendado', agendamento_id: 77 }), undefined, '2026-11-14T13:00:00.000Z'))
      .toMatchObject({ situacao: 'reuniao_marcada', card_id: 77, proximo_passo: { o_que: 'Reunião', quando: '2026-11-14T13:00:00.000Z' } });
    expect(itemDaSessao('1', sessao({ estagio: 'ofertou' }), undefined, null).proximo_passo?.o_que).toBe('Esperar a escolha do horário');
  });
  it('convidado espera o sim; reunião marcada com preparo aberto mostra o preparo, sem preparo (ou vencido) mostra a reunião', () => {
    const agora = Date.parse('2026-11-12T15:00:00Z');
    expect(itemDaSessao('1', sessao({ estagio: 'conversando', respostas: 1, convidou_em: '2026-11-12T14:00:00Z' }), undefined, null).proximo_passo?.o_que).toBe('Esperar o sim para o horário');
    const preparo = { inicio_em: '2026-11-12T14:00:00Z', reuniao_em: '2026-11-14T13:00:00Z', ate_em: '2026-11-13T14:00:00Z', perguntas: 1, pergunta_em: '2026-11-12T14:00:00Z' };
    expect(itemDaSessao('1', sessao({ estagio: 'agendado', preparo }), undefined, '2026-11-14T13:00:00.000Z', agora).proximo_passo).toEqual({ o_que: 'Preparo da reunião', quando: '2026-11-14T13:00:00.000Z' });
    expect(itemDaSessao('1', sessao({ estagio: 'agendado', preparo }), undefined, null, agora).proximo_passo).toEqual({ o_que: 'Preparo da reunião', quando: '2026-11-14T13:00:00Z' });
    expect(itemDaSessao('1', sessao({ estagio: 'agendado', preparo }), undefined, '2026-11-14T13:00:00.000Z', Date.parse('2026-11-13T15:00:00Z')).proximo_passo?.o_que).toBe('Reunião');
    expect(itemDaSessao('1', sessao({ estagio: 'agendado' }), undefined, null).proximo_passo?.o_que).toBe('Reunião');
  });
  it('faixa da sessão: retorno, lote e card parado', () => {
    expect(itemDaSessao('1', sessao({ retorno: true }), undefined, null).faixa).toBe('retorno');
    expect(itemDaSessao('1', sessao({ card_antigo: { status: 'cancelado', lote: true } }), undefined, null).faixa).toBe('lote_13_10');
    expect(itemDaSessao('1', sessao({ card_antigo: { status: 'cancelado', lote: false } }), undefined, null).faixa).toBe('pediu_reuniao');
    expect(itemDaSessao('1', sessao(), undefined, null).faixa).toBeNull();
  });
  it('sessão antiga sem tipo vale como investidor, e o resumo é cortado', () => {
    const i = itemDaSessao('1', sessao({ tipo: undefined, resumo: 'x'.repeat(900) }), undefined, null);
    expect(i.tipo).toBe('investidor');
    expect(i.resumo.length).toBe(600);
  });
});

describe('placar', () => {
  it('conta por situação, total e por tipo (os quatro tipos sempre existem)', () => {
    const p = montarPlacar([
      { tipo: 'investidor', situacao: 'na_fila' }, { tipo: 'investidor', situacao: 'na_fila' },
      { tipo: 'arrendamento', situacao: 'em_conversa' }, { tipo: 'parceiro', situacao: 'parou' },
    ]);
    expect(p.total).toEqual({ na_fila: 2, em_conversa: 1, parou: 1 });
    expect(p.por_tipo.investidor).toEqual({ na_fila: 2 });
    expect(p.por_tipo.curioso).toEqual({});
    expect(Object.keys(p.por_tipo).sort()).toEqual(['arrendamento', 'curioso', 'investidor', 'parceiro']);
  });
  it('respostas e reuniões de hoje saem das sessões que andaram hoje', () => {
    const ini = '2026-11-12T03:00:00Z';
    const hoje = '2026-11-12T15:00:00Z';
    const r = contarDeHoje([
      sessao({ estagio: 'agendado', atualizado_em: hoje, respostas: 4 }),
      sessao({ estagio: 'agendado', atualizado_em: hoje, motivo: 'card_por_outra_porta' }),
      sessao({ estagio: 'conversando', atualizado_em: hoje, respostas: 1 }),
      sessao({ estagio: 'chamado', atualizado_em: hoje }),
      sessao({ estagio: 'conversando', atualizado_em: '2026-11-11T15:00:00Z', respostas: 3 }),
    ], ini);
    expect(r).toEqual({ respostas: 2, reunioes: 1, convites: 0 });
    const c = contarDeHoje([
      sessao({ estagio: 'conversando', respostas: 1, convidou_em: hoje, atualizado_em: hoje }),
      sessao({ estagio: 'ofertou', respostas: 2, convidou_em: hoje, atualizado_em: hoje }),
      sessao({ estagio: 'conversando', respostas: 1, convidou_em: '2026-11-11T15:00:00Z', atualizado_em: hoje }),
    ], ini);
    expect(c.convites).toBe(2);
  });
});

describe('ficha', () => {
  it('só os campos preenchidos, na ordem da ficha, ignorando o que não é da ficha', () => {
    expect(fichaPreenchida({ quando_comecar: ' em março ', cidade: 'Cidade Exemplo', duvidas: '', segredo: 'x', ocupacao: null }))
      .toEqual({ cidade: 'Cidade Exemplo', quando_comecar: 'em março' });
    expect(fichaPreenchida(undefined)).toEqual({});
  });
});

describe('lerAcompanhamento', () => {
  it('junta a fila (mesma ordem) e as sessões, sem repetir quem volta como retorno', async () => {
    h.fila = [candidato({ chave: '1190000001' }), candidato({ chave: '1190000002', tipo: 'parceiro', faixa: 'lote_mudo', card: null })];
    h.sessoes.set('1190000001', sessao({ estagio: 'chamado' }));            // retorno: já está na fila
    h.sessoes.set('1190000003', sessao({ estagio: 'agendado', agendamento_id: 77, atualizado_em: new Date().toISOString(), respostas: 2 }));
    const a = await lerAcompanhamento(new Date('2026-11-12T15:00:00Z'));
    expect(a.itens.map(i => [i.chave, i.situacao, i.posicao_fila])).toEqual([
      ['1190000001', 'na_fila', 1], ['1190000002', 'na_fila', 2], ['1190000003', 'reuniao_marcada', null],
    ]);
    expect(a.itens[2]!.proximo_passo).toEqual({ o_que: 'Reunião', quando: '2026-11-14T13:00:00.000Z' });
    expect(a.ligada).toBe(true);
    expect(a.ritmo).toEqual({ frios_24h: 12, teto_frios: 30, aberturas_hoje: 5, retomadas_hoje: 3 });
    expect(a.placar.total).toEqual({ na_fila: 2, reuniao_marcada: 1 });
    expect(a.placar.hoje).toMatchObject({ aberturas: 5, retomadas: 3 });
    expect(JSON.stringify(a)).not.toContain('5511');
  });
  it('guarda em memória por 60 s: a segunda chamada não relê o banco, a de 61 s depois relê', async () => {
    const t0 = new Date('2026-11-12T15:00:00Z');
    await lerAcompanhamento(t0);
    await lerAcompanhamento(new Date(t0.getTime() + CACHE_MS - 1));
    expect(h.chamadasDaFila).toBe(1);
    await lerAcompanhamento(new Date(t0.getTime() + CACHE_MS + 1));
    expect(h.chamadasDaFila).toBe(2);
  });
  it('vários navegadores ao mesmo tempo viram uma leitura só', async () => {
    const t = new Date('2026-11-12T15:00:00Z');
    await Promise.all([lerAcompanhamento(t), lerAcompanhamento(t), lerAcompanhamento(t)]);
    expect(h.chamadasDaFila).toBe(1);
  });
  it('erro da fila sobe e não fica guardado', async () => {
    h.falhaDaFila = true;
    await expect(lerAcompanhamento(new Date('2026-11-12T15:00:00Z'))).rejects.toThrow('fila');
    h.falhaDaFila = false;
    await expect(lerAcompanhamento(new Date('2026-11-12T15:00:01Z'))).resolves.toMatchObject({ ok: true });
  });
});
