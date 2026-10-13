import { describe, it, expect } from 'vitest';
import {
  proximoPassoDaRetomada, montarRetomadas, limiteDeRetomadasHoje, tetoRetomadasDoDia, lerChaveDeToque, renderRetomada,
  sessaoEntraNasRetomadas, RETOMADAS_POR_DIA, RETOMADAS_RESERVA_DE_ABERTURA,
  type CarimbosDosToques, type SessaoDeRetomada, type FiltrosDeRetomada,
} from '../services/io/investidorAgentePuro';
import { RETOMADAS } from '../services/io/investidorAgenteTextos';
import { sessaoEhDaHelena } from '../services/io/investidorAgentePosse';

// As retomadas (13/10/2026), a parte pura: quando cada toque vence, quem entra e o que a
// pessoa lê.

const AGORA = Date.parse('2026-10-15T13:00:00Z');
const DIA = 86_400_000;
const atras = (dias: number): string => new Date(AGORA - dias * DIA).toISOString();
const carimbos = (...dias: number[]): CarimbosDosToques =>
  Object.fromEntries(dias.map((d, i) => [i + 1, atras(d)])) as CarimbosDosToques;
const diasAte = (iso: number): number => Math.round(((iso - AGORA) / DIA) * 100) / 100;

describe('quando vence cada passo, contado do toque anterior que saiu', () => {
  it('toque 2: 3 dias depois do toque 1', () => {
    expect(proximoPassoDaRetomada(carimbos(2))).toMatchObject({ passo: 2 });
    expect(diasAte(proximoPassoDaRetomada(carimbos(2))!.venceEm)).toBe(1);
    expect(diasAte(proximoPassoDaRetomada(carimbos(3))!.venceEm)).toBe(0);
  });

  it('toque 3: 4 dias depois do toque 2, não do dia 0', () => {
    const p = proximoPassoDaRetomada(carimbos(20, 1));
    expect(p!.passo).toBe(3);
    expect(diasAte(p!.venceEm)).toBe(3);
  });

  it('toque 4: 60 dias depois do toque 1', () => {
    const p = proximoPassoDaRetomada(carimbos(50, 47, 43));
    expect(p!.passo).toBe(4);
    expect(diasAte(p!.venceEm)).toBe(10);
  });

  it('toque 5: 7 dias depois do toque 4', () => {
    const p = proximoPassoDaRetomada(carimbos(70, 67, 63, 2));
    expect(p!.passo).toBe(5);
    expect(diasAte(p!.venceEm)).toBe(5);
  });

  it('fecho: 7 dias depois do toque 5', () => {
    const p = proximoPassoDaRetomada(carimbos(80, 77, 73, 20, 3));
    expect(p!.passo).toBe('fecho');
    expect(diasAte(p!.venceEm)).toBe(4);
  });

  it('sem o carimbo do toque 1 não há como contar', () => {
    expect(proximoPassoDaRetomada({ 2: atras(5) })).toBeNull();
    expect(proximoPassoDaRetomada({})).toBeNull();
  });

  it('lê a chave do carimbo', () => {
    expect(lerChaveDeToque('inv_agente_sent:3499990001:t4')).toEqual({ chave: '3499990001', n: 4 });
    for (const k of ['inv_agente_sent:3499990001:t6', 'inv_agente_sent:3499990001', 'inv_agente_vez:3499990001:x', 'inv_agente_sent:34:t1']) {
      expect(lerChaveDeToque(k), k).toBeNull();
    }
  });
});

const sessao = (estagio: string, over: Partial<SessaoDeRetomada> = {}): SessaoDeRetomada =>
  ({ estagio, telefone: '5534999990001', nome: 'Ana Lima', valor_txt: 'R$ 140 mil', respostas: 0, ...over });
const livres: FiltrosDeRetomada = { silenciado: () => false, bloqueado: () => false, mudo: () => false, comHumano: () => false };

describe('quem entra nas retomadas', () => {
  it('chamado e conversando com zero respostas; o resto não', () => {
    expect(sessaoEntraNasRetomadas(sessao('chamado'))).toBe(true);
    expect(sessaoEntraNasRetomadas(sessao('conversando', { respostas: 0 }))).toBe(true);
    expect(sessaoEntraNasRetomadas(sessao('conversando', { respostas: 2 }))).toBe(false);
    for (const e of ['adiado', 'humano', 'ofertou', 'agendado', 'sem_interesse']) expect(sessaoEntraNasRetomadas(sessao(e)), e).toBe(false);
  });

  it('o resgate (grupo ou sem_retomada) e a abertura com erro de envio nunca entram', () => {
    expect(sessaoEntraNasRetomadas(sessao('chamado', { grupo: 'resgate' }))).toBe(false);
    expect(sessaoEntraNasRetomadas(sessao('chamado', { sem_retomada: true }))).toBe(false);
    expect(sessaoEntraNasRetomadas(sessao('chamado', { erro: 'HTTP 500' }))).toBe(false);
    expect(sessaoEntraNasRetomadas(sessao('chamado', { telefone: '' }))).toBe(false);
  });
});

describe('montarRetomadas: a fila, a ordem e os cortes', () => {
  const sessoes = new Map<string, SessaoDeRetomada>([
    ['3499990001', sessao('chamado', { telefone: '5534999990001' })],
    ['3499990002', sessao('chamado', { telefone: '5534999990002', nome: 'Bruno' })],
    ['3499990003', sessao('chamado', { telefone: '5534999990003', nome: 'Carla' })],
    ['3499990004', sessao('adiado', { telefone: '5534999990004' })],
  ]);

  it('a mais antiga (vencida há mais tempo) primeiro, e a vencida por toque', () => {
    const c = new Map<string, CarimbosDosToques>([
      ['3499990001', carimbos(4)],               // venceu há 1 dia
      ['3499990002', carimbos(9)],               // venceu há 6 dias
      ['3499990003', carimbos(10, 5)],           // toque 3, venceu há 1 dia (5 - 4)
      ['3499990004', carimbos(30)],              // adiado: fora
    ]);
    const r = montarRetomadas(sessoes, c, livres, AGORA);
    expect(r.fila.map(x => [x.chave, x.toque, x.vencidaHaDias])).toEqual([
      ['3499990002', 2, 6], ['3499990001', 2, 1], ['3499990003', 3, 1],
    ]);
    expect(r.vencidasPorToque).toEqual({ 2: 2, 3: 1, 4: 0, 5: 0 });
  });

  it('o que não venceu não aparece', () => {
    const r = montarRetomadas(sessoes, new Map([['3499990001', carimbos(2)]]), livres, AGORA);
    expect(r.fila).toEqual([]);
    expect(r.vencidasPorToque).toEqual({ 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('opt-out, bloqueio, pausa humana e os DOIS cortes de mudo tiram da fila, mas contam como vencidas', () => {
    const c = new Map<string, CarimbosDosToques>([
      ['3499990001', carimbos(4)], ['3499990002', carimbos(4)], ['3499990003', carimbos(4)],
    ]);
    const r = montarRetomadas(sessoes, c, {
      silenciado: t => t.endsWith('0001'), bloqueado: t => t.endsWith('0002'),
      mudo: t => t.endsWith('0003'), comHumano: () => false,
    }, AGORA);
    expect(r.fila).toEqual([]);
    expect(r.excluidos).toEqual({ opt_out: 1, bloqueado: 1, mudo: 1 });
    expect(r.vencidasPorToque[2]).toBe(3);

    // O corte próprio: 3 carimbos nos últimos 60 dias.
    const tres = montarRetomadas(new Map([['3499990001', sessoes.get('3499990001')!]]),
      new Map([['3499990001', carimbos(90, 20, 15, 8)]]), livres, AGORA);
    expect(tres.fila).toEqual([]);
    expect(tres.excluidos).toEqual({ toques_em_60_dias: 1 });
    // Com 2 carimbos nos 60 dias passa.
    const dois = montarRetomadas(new Map([['3499990001', sessoes.get('3499990001')!]]),
      new Map([['3499990001', carimbos(61, 58, 54)]]), livres, AGORA);
    expect(dois.fila.map(x => x.toque)).toEqual([4]);
    const pausa = montarRetomadas(sessoes, new Map([['3499990001', carimbos(4)]]), { ...livres, comHumano: () => true }, AGORA);
    expect(pausa.excluidos).toEqual({ humano_na_conversa: 1 });
  });

  it('o fecho: só depois de 7 dias do toque 5, o mais antigo primeiro, e nunca para o resgate', () => {
    const c = new Map<string, CarimbosDosToques>([
      ['3499990001', carimbos(90, 87, 83, 30, 8)],
      ['3499990002', carimbos(90, 87, 83, 30, 12)],
      ['3499990003', carimbos(90, 87, 83, 30, 6)],
    ]);
    const s = new Map(sessoes);
    s.set('3499990003', sessao('chamado', { telefone: '5534999990003' }));
    const r = montarRetomadas(s, c, livres, AGORA);
    expect(r.fechos.map(f => f.chave)).toEqual(['3499990002', '3499990001']);
    expect(r.fila).toEqual([]);
    const resgate = montarRetomadas(new Map([['3499990001', sessao('chamado', { grupo: 'resgate' })]]), c, livres, AGORA);
    expect(resgate.fechos).toEqual([]);
  });
});

describe('o intervalo mínimo entre toques', () => {
  it('toque 4: o MAIOR entre toque 1 + 60 dias e último toque + 7 dias', () => {
    // toque 3 no dia 59: o 4 espera até o dia 66, não vence no dia 60.
    const p = proximoPassoDaRetomada(carimbos(61, 58, 2));
    expect(p!.passo).toBe(4);
    expect(diasAte(p!.venceEm)).toBe(5);
    // toque 3 cedo (dia 7): vale o prazo de 60 dias do toque 1.
    const q = proximoPassoDaRetomada(carimbos(50, 47, 43));
    expect(diasAte(q!.venceEm)).toBe(10);
  });

  it('nunca com menos de 3 dias do toque anterior, em nenhum passo', () => {
    for (const dias of [[10], [10, 6], [90, 87, 83], [90, 87, 83, 20], [90, 87, 83, 20, 8]]) {
      const c = carimbos(...dias);
      const p = proximoPassoDaRetomada(c)!;
      const ultimo = Date.parse(String(c[dias.length as 1 | 2 | 3 | 4 | 5]));
      expect(p.venceEm - ultimo, String(dias)).toBeGreaterThanOrEqual(3 * DIA);
    }
  });
});

describe('o ciclo encerrado por outra conversa', () => {
  it('a sessão com ciclo_encerrado não entra nas retomadas nem no fecho', () => {
    const s: SessaoDeRetomada = { estagio: 'chamado', telefone: '5534999990001', nome: 'Ana', valor_txt: 'R$ 140 mil', ciclo_encerrado: 'outra_conversa' };
    expect(sessaoEntraNasRetomadas(s)).toBe(false);
    const r = montarRetomadas(new Map([['3499990001', s]]), new Map([['3499990001', carimbos(90, 87, 83, 20, 8)]]),
      { silenciado: () => false, bloqueado: () => false, mudo: () => false, comHumano: () => false }, AGORA);
    expect(r.fila).toEqual([]);
    expect(r.fechos).toEqual([]);
  });
});

describe('o teto de 15 e a reserva de 5 para abertura', () => {
  it('com teto 20: 15; com teto 30: 15; com teto 12: 7; com teto 5 ou menos: 0', () => {
    expect(RETOMADAS_POR_DIA).toBe(15);
    expect(RETOMADAS_RESERVA_DE_ABERTURA).toBe(5);
    expect(limiteDeRetomadasHoje(20)).toBe(15);
    expect(limiteDeRetomadasHoje(30)).toBe(15);
    expect(limiteDeRetomadasHoje(12)).toBe(7);
    expect(limiteDeRetomadasHoje(5)).toBe(0);
    expect(limiteDeRetomadasHoje(3)).toBe(0);
  });

  it('a env só aperta', () => {
    expect(tetoRetomadasDoDia('3')).toBe(3);
    expect(tetoRetomadasDoDia('99')).toBe(15);
    expect(tetoRetomadasDoDia('abc')).toBe(15);
    expect(tetoRetomadasDoDia()).toBe(15);
    expect(limiteDeRetomadasHoje(20, '4')).toBe(4);
    expect(limiteDeRetomadasHoje(8, '10')).toBe(3);
  });
});

describe('os textos das retomadas', () => {
  it('3 variações e 1 reserva por toque, de 2 a 5', () => {
    for (const n of [2, 3, 4, 5] as const) {
      expect(RETOMADAS[n].variacoes, String(n)).toHaveLength(3);
      expect(RETOMADAS[n].reserva).toBeTruthy();
      expect(RETOMADAS[n].reserva).not.toContain('{nome}');
      for (const v of RETOMADAS[n].variacoes) expect(v).toContain('{nome}');
    }
  });

  it('só {nome} e {valor}; nada de travessão, emoji, link, "cota"; toda mensagem começa com maiúscula', () => {
    for (const n of [2, 3, 4, 5] as const) {
      for (const t of [...RETOMADAS[n].variacoes, RETOMADAS[n].reserva]) {
        for (const v of t.match(/\{[^}]*\}/g) ?? []) expect(['{nome}', '{valor}']).toContain(v);
        expect(t).not.toMatch(/[—–]/);
        expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(t).not.toMatch(/https?:\/\/|www\./i);
        expect(t).not.toMatch(/(?<!\p{L})cot(?:a|ista)s?(?!\p{L})/iu);
        expect(t).toMatch(/^(\{nome\}|[A-ZÀ-Ý])/);
        expect(t.length).toBeLessThanOrEqual(900);
      }
    }
  });

  it('os que usam {valor} ficam sem variável depois de renderizar, e o valor entra como a pessoa marcou', () => {
    for (const n of [2, 3, 4, 5] as const) {
      for (let k = 0; k < 3; k++) {
        const chave = String(3400000000 + k);       // as 3 variações de cada toque
        const { texto } = renderRetomada(n, chave, 'Carlos Lima', 'Até R$ 50 mil');
        expect(texto).not.toMatch(/\{[^}]*\}/);
        expect(texto).toContain('Carlos');
        if (RETOMADAS[n].variacoes.some(v => v.includes('{valor}') && texto.includes('até R$ 50 mil'))) expect(texto).toContain('até R$ 50 mil');
      }
    }
  });

  it('a variação é fixa pela chave e pelo número do toque; nome que não é de pessoa usa a reserva', () => {
    const a = renderRetomada(3, '3499990001', 'Ana', 'R$ 140 mil');
    expect(renderRetomada(3, '3499990001', 'Ana', 'R$ 140 mil')).toEqual(a);
    const indices = new Set([2, 3, 4, 5].map(n => renderRetomada(n as 2 | 3 | 4 | 5, '3499990001', 'Ana', 'R$ 140 mil').indice));
    expect(indices.size).toBeGreaterThan(1);                           // muda de um toque para o outro
    for (const n of [2, 3, 4, 5] as const) {
      const r = renderRetomada(n, '3499990001', 'Eletro posto', 'R$ 140 mil');
      expect(r.indice).toBe(-1);
      expect(r.texto).toBe(RETOMADAS[n].reserva.split('{valor}').join('R$ 140 mil'));
    }
    const todas = new Set(['3400000000', '3400000001', '3400000002'].map(k => renderRetomada(2, k, 'Ana', 'R$ 1 mil').indice));
    expect(todas.size).toBe(3);
  });
});

describe('a posse de quem está no ciclo das retomadas', () => {
  const hoje = Date.parse('2026-10-15T13:00:00Z');
  const em = (dias: number) => new Date(hoje - dias * DIA).toISOString();

  it('sem toques, chamado há mais de 10 dias deixa de ser da Helena (regra de sempre)', () => {
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: em(11) }, hoje)).toBe(false);
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: em(9) }, hoje)).toBe(true);
  });

  it('no ciclo (toques de 2 em diante) a conversa segue dela por 70 dias depois do último toque', () => {
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: em(40), toques: 3, ultimo_toque_em: em(33) }, hoje)).toBe(true);
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: em(100), toques: 4, ultimo_toque_em: em(2) }, hoje)).toBe(true);
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: em(200), toques: 5, ultimo_toque_em: em(71) }, hoje)).toBe(false);
    // Toque 1 só não é ciclo.
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: em(11), toques: 1, ultimo_toque_em: em(11) }, hoje)).toBe(false);
  });
});
