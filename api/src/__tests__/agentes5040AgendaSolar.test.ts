import { describe, it, expect, vi, beforeEach } from 'vitest';

// A agenda do SOLAR para a Duda (B1d-1): vagas nas duas faixas, gravar o card e remarcar o MESMO card.
// O banco é falso: o teste olha o que seria escrito, não o que o Supabase faria.

const h = vi.hoisted(() => ({
  compromissos: [] as any[] | null,
  bloqueios: [] as any[],
  bloqueiosErro: null as any,
  cardLido: null as any,
  erroLeitura: null as any,
  insertResultado: { data: { id: 77 }, error: null } as any,
  updateResultado: { data: [{ id: 5 }], error: null } as any,
  inserts: [] as any[],
  insertSelect: [] as string[],
  updates: [] as any[],
  updateEqs: [] as Array<[string, unknown]>,
  updateIs: [] as Array<[string, unknown]>,
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/io/eletropostoVagas', () => ({ carregarCompromissos: vi.fn(async () => h.compromissos) }));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      if (tabela === 'agenda_bloqueios') {
        const c: any = { select: () => c, eq: () => c, gte: () => c, limit: () => c,
          then: (ok: (v: unknown) => void) => ok({ data: h.bloqueiosErro ? null : h.bloqueios, error: h.bloqueiosErro }) };
        return c;
      }
      return {
        insert: (payload: any) => { h.inserts.push(payload); return { select: (cols: string) => { h.insertSelect.push(cols); return { single: async () => h.insertResultado }; } }; },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.cardLido, error: h.erroLeitura }) }) }),
        update: (payload: any) => {
          h.updates.push(payload);
          const c: any = { eq: (k: string, v: unknown) => { h.updateEqs.push([k, v]); return c; }, is: (k: string, v: unknown) => { h.updateIs.push([k, v]); return c; }, select: async () => h.updateResultado };
          return c;
        },
      };
    },
  },
}));

import {
  vagasSolar, aindaLivreSolar, consultoraDaFaixa, gravarCardSolar, remarcarCardSolar, marcarBoasVindasEnviada, silenciarLembretesDoCard,
} from '../services/agentes5040/agendaSolar';

// 21/10/2026 (quarta), 09:00 em Brasília = 12:00 UTC.
const AGORA = Date.parse('2026-10-21T12:00:00Z');
const brt = (ymd: string, hhmm: string): string => new Date(`${ymd}T${hhmm}:00-03:00`).toISOString();
const horas = (isos: string[] | null): string[] =>
  (isos ?? []).map(i => new Date(Date.parse(i) - 3 * 3600_000).toISOString().slice(11, 16));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  h.updateIs = [];
  h.compromissos = []; h.bloqueios = []; h.bloqueiosErro = null; h.cardLido = null; h.erroLeitura = null;
  h.insertResultado = { data: { id: 77 }, error: null };
  h.updateResultado = { data: [{ id: 5 }], error: null };
  h.inserts = []; h.insertSelect = []; h.updates = []; h.updateEqs = [];
});

describe('vagasSolar: a grade do solar, nas duas faixas', () => {
  it('lead novo cai em :00 e :30, respeitando os 30 min de antecedência (09:00 -> começa 09:30)', async () => {
    const v = await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 4, agora: AGORA, faixa: 'novo' });
    expect(horas(v)).toEqual(['09:30', '10:00', '10:30', '11:00']);
    expect(v![0]).toBe(brt('2026-10-21', '09:30'));
  });

  it('remarcação cai em :15 e :45', async () => {
    const v = await vagasSolar({ dono: 'Giovanna', caminho: 'ligacao', n: 4, agora: AGORA, faixa: 'remarcacao' });
    expect(horas(v)).toEqual(['09:45', '10:15', '10:45', '11:15']);
  });

  it('o almoço fica aberto e a grade acaba às 16:30 (novo) e 16:45 (remarcação)', async () => {
    const novo = await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 30, agora: Date.parse('2026-10-21T11:00:00Z'), faixa: 'novo' });
    const hoje = horas(novo).slice(0, horas(novo).indexOf('08:00'));
    expect(hoje).toContain('12:00');
    expect(hoje[hoje.length - 1]).toBe('16:30');
    const rem = await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 30, agora: Date.parse('2026-10-21T11:00:00Z'), faixa: 'remarcacao' });
    const hojeR = horas(rem).slice(0, horas(rem).indexOf('08:15'));
    expect(hojeR).toContain('12:15');
    expect(hojeR[hojeR.length - 1]).toBe('16:45');
  });

  it('horário ocupado some, e a outra faixa convive com ele (ligação dura 15 min)', async () => {
    h.compromissos = [
      { ts: Date.parse(brt('2026-10-21', '10:00')), dono: 'Nilce', ep: false },                       // card de 15 min
      { ts: Date.parse(brt('2026-10-21', '11:00')), dono: 'Nilce', ep: true },                        // eletroposto: 30 min
      { ts: Date.parse(brt('2026-10-21', '09:30')), dono: 'Giovanna', ep: false },                    // de outra pessoa: não conta
    ];
    const novo = horas(await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 5, agora: AGORA, faixa: 'novo' }));
    expect(novo).toEqual(['09:30', '10:30', '11:30', '12:00', '12:30']);
    const rem = horas(await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 4, agora: AGORA, faixa: 'remarcacao' }));
    // 10:15 cabe ao lado do card das 10:00; 11:15 não (reunião de eletroposto das 11:00 ocupa até 11:30), 11:45 cabe.
    expect(rem).toEqual(['09:45', '10:15', '10:45', '11:45']);
  });

  it('o bloco pronto de uma ficha do solar e o bloqueio manual também tiram o horário', async () => {
    h.compromissos = [{ ts: Date.parse(brt('2026-10-21', '10:00')), dono: 'Nilce', ep: false, vistoria: true,
      ini: Date.parse(brt('2026-10-21', '09:45')), fim: Date.parse(brt('2026-10-21', '10:30')) }];
    h.bloqueios = [{ inicio: brt('2026-10-21', '11:00'), fim: brt('2026-10-21', '11:30') }];
    const v = horas(await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 4, agora: AGORA, faixa: 'novo' }));
    expect(v).toEqual(['09:30', '10:30', '11:30', '12:00']);
  });

  it('erro de leitura = null (quem chama não oferece horário)', async () => {
    h.compromissos = null;
    expect(await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 4, agora: AGORA, faixa: 'novo' })).toBeNull();
    h.compromissos = [];
    h.bloqueiosErro = { message: 'falhou' };
    expect(await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 4, agora: AGORA, faixa: 'novo' })).toBeNull();
  });

  it('fuso de Brasília com o relógio fixo: 22:30 de quinta em BRT (01:30 UTC de sexta) começa na sexta 08:00 BRT', async () => {
    const v = await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 2, agora: Date.parse('2026-10-23T01:30:00Z'), faixa: 'novo' });
    expect(v).toEqual([brt('2026-10-23', '08:00'), brt('2026-10-23', '08:30')]);
    expect(v![0]).toBe('2026-10-23T11:00:00.000Z');
  });

  it('sexta à noite pula o fim de semana', async () => {
    const v = await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 1, agora: Date.parse('2026-10-24T01:00:00Z'), faixa: 'novo' });
    expect(v).toEqual([brt('2026-10-26', '08:00')]);
  });

  it('sócio só tem a grade de cliente novo; remarcação de sócio não oferece nada', async () => {
    expect(horas(await vagasSolar({ dono: 'Thiago', caminho: 'ligacao', n: 2, agora: AGORA, faixa: 'novo' }))).toEqual(['09:30', '10:30']);
    expect(await vagasSolar({ dono: 'Thiago', caminho: 'ligacao', n: 2, agora: AGORA, faixa: 'remarcacao' })).toEqual([]);
  });
});

describe('aindaLivreSolar', () => {
  it('livre, ocupado e leitura quebrada (null)', async () => {
    const iso = brt('2026-10-22', '10:00');
    expect(await aindaLivreSolar(iso, 'Nilce')).toBe(true);
    h.compromissos = [{ ts: Date.parse(iso), dono: 'Nilce', ep: false }];
    expect(await aindaLivreSolar(iso, 'Nilce')).toBe(false);
    expect(await aindaLivreSolar(iso, 'Nilce', { ignorarIso: iso })).toBe(true);
    h.compromissos = null;
    expect(await aindaLivreSolar(iso, 'Nilce')).toBeNull();
  });
});

describe('consultoraDaFaixa', () => {
  it('é o donoDaFaixa de solarRota: desde 24/10/2026, sempre a Nilce', () => {
    expect(consultoraDaFaixa(200)).toBe('Nilce');
    expect(consultoraDaFaixa(600)).toBe('Nilce');
    expect(consultoraDaFaixa(1500)).toBe('Nilce');
    expect(consultoraDaFaixa(null)).toBe('Nilce');
  });
});

describe('gravarCardSolar', () => {
  const ficha = {
    dono: 'Nilce', quando: brt('2026-10-22', '10:00'), nome: 'Maria Souza', tel: '5534999990000', cidade: 'Uberlândia-MG',
    observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: R$ 300 a R$ 600', src: 'ig', utm: { utm_source: 'meta', utm_campaign: 'c1' },
  };

  it('sem opções grava exatamente os campos que a rota do quiz gravava, com o mesmo select', async () => {
    const r = await gravarCardSolar(ficha);
    expect(r).toEqual({ status: 'ok', card: { id: 77 } });
    expect(h.inserts).toEqual([{
      vendedor_nome: 'Nilce', quando: brt('2026-10-22', '10:00'), cliente_nome: 'Maria Souza', cliente_telefone: '5534999990000',
      cidade: 'Uberlândia-MG', status: 'agendado', observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: R$ 300 a R$ 600',
      created_by: 'lp_solar', src: 'ig', utm_source: 'meta', utm_campaign: 'c1',
    }]);
    expect(Object.keys(h.inserts[0])).not.toContain('boas_vindas_at');
    expect(h.insertSelect).toEqual(['id, vendedor_nome, quando, cliente_nome, cliente_telefone, observacao, utm_source, utm_campaign']);
  });

  it('sem src e sem utm não grava as chaves; a observação corta em 4000', async () => {
    await gravarCardSolar({ ...ficha, src: null, utm: undefined, observacao: 'LP SOLAR QUIZ · x\n' + 'a'.repeat(5000) });
    expect(Object.keys(h.inserts[0])).not.toContain('src');
    expect(Object.keys(h.inserts[0])).not.toContain('utm_source');
    expect(h.inserts[0].observacao).toHaveLength(4000);
  });

  it('23505 (o índice recusou) = horario_tomado; outro erro volta como erro', async () => {
    h.insertResultado = { data: null, error: { code: '23505', message: 'dup' } };
    expect(await gravarCardSolar(ficha)).toEqual({ status: 'horario_tomado' });
    const e = { code: '42P01', message: 'x' };
    h.insertResultado = { data: null, error: e };
    expect(await gravarCardSolar(ficha)).toEqual({ status: 'erro', erro: e });
  });

  it('da agente: boas_vindas_at NULO, marca do quiz garantida na 1ª linha e horário conferido antes', async () => {
    const r = await gravarCardSolar({ ...ficha, observacao: 'Pediu ligação pelo WhatsApp' }, { faixa: 'novo' });
    expect(r.status).toBe('ok');
    expect(h.inserts[0]).toHaveProperty('boas_vindas_at', null);
    expect(h.inserts[0]).not.toHaveProperty('bomdia_at');
    expect(h.inserts[0]).not.toHaveProperty('lembrete_5min_at');
    expect(h.inserts[0].created_by).toBe('lp_solar');
    expect(h.inserts[0].observacao.split('\n')[0]).toBe('LP SOLAR QUIZ · LIGAÇÃO');
    expect(h.inserts[0].observacao).toContain('Pediu ligação pelo WhatsApp');
  });

  describe('o bom dia do card novo da agente (correção 12)', () => {
    it('HOJE antes das 11h (Brasília): o card nasce com bomdia_at = agora; o lembrete de 5 min segue de fora', async () => {
      // AGORA = 09:00 BRT de quarta 21/10; a ligação é hoje às 14:30
      const r = await gravarCardSolar({ ...ficha, quando: brt('2026-10-21', '14:30') }, { faixa: 'novo' });
      expect(r.status).toBe('ok');
      expect(h.inserts[0].bomdia_at).toBe(new Date(AGORA).toISOString());
      expect(h.inserts[0]).not.toHaveProperty('lembrete_5min_at');
      expect(h.inserts[0]).toHaveProperty('boas_vindas_at', null);
    });
    it('HOJE a partir das 11h, ou OUTRO dia: bomdia_at não entra (a régua fala no dia certo)', async () => {
      vi.setSystemTime(Date.parse('2026-10-21T14:00:00Z'));          // 11:00 BRT
      await gravarCardSolar({ ...ficha, quando: brt('2026-10-21', '15:00') }, { faixa: 'novo' });
      expect(h.inserts[0]).not.toHaveProperty('bomdia_at');
      vi.setSystemTime(AGORA);
      await gravarCardSolar({ ...ficha, quando: brt('2026-10-22', '10:00') }, { faixa: 'novo' });
      expect(h.inserts[1]).not.toHaveProperty('bomdia_at');
    });
    it('o caminho do quiz (sem faixa) continua IDÊNTICO: hoje antes das 11h não ganha bomdia_at', async () => {
      await gravarCardSolar({ ...ficha, quando: brt('2026-10-21', '14:30') });
      expect(h.inserts[0]).not.toHaveProperty('bomdia_at');
      expect(h.inserts[0]).not.toHaveProperty('boas_vindas_at');
    });
    it('ligarAgora segue com lembrete e bom dia de agora', async () => {
      await gravarCardSolar({ ...ficha, quando: brt('2026-10-21', '09:00') }, { ligarAgora: true });
      expect(h.inserts[0].bomdia_at).toBe(new Date(AGORA).toISOString());
      expect(h.inserts[0].lembrete_5min_at).toBe(new Date(AGORA).toISOString());
    });
  });

  it('da agente: horário tomado = horario_tomado e NADA é gravado; leitura quebrada = erro e nada é gravado', async () => {
    h.compromissos = [{ ts: Date.parse(ficha.quando), dono: 'Nilce', ep: false }];
    expect(await gravarCardSolar(ficha, { faixa: 'novo' })).toEqual({ status: 'horario_tomado' });
    h.compromissos = null;
    expect((await gravarCardSolar(ficha, { faixa: 'novo' })).status).toBe('erro');
    expect(h.inserts).toEqual([]);
  });

  it('da agente: fora da lista de vagas do dono na faixa = horario_fora_da_grade e NADA é gravado', async () => {
    // :15 na faixa do lead novo, :00 na faixa de remarcação, depois do fim da grade, sábado, e antes da antecedência.
    const casos: Array<[string, 'novo' | 'remarcacao']> = [
      [brt('2026-10-22', '10:15'), 'novo'],
      [brt('2026-10-22', '10:00'), 'remarcacao'],
      [brt('2026-10-22', '17:00'), 'novo'],
      [brt('2026-10-24', '10:00'), 'novo'],
      [brt('2026-10-21', '09:15'), 'remarcacao'],
    ];
    for (const [quando, faixa] of casos) {
      expect(await gravarCardSolar({ ...ficha, quando }, { faixa })).toEqual({ status: 'horario_fora_da_grade' });
    }
    expect(h.inserts).toEqual([]);
  });

  it('da agente: remarcação na faixa certa passa, e o sócio não tem :15/:45', async () => {
    expect((await gravarCardSolar({ ...ficha, quando: brt('2026-10-22', '10:15') }, { faixa: 'remarcacao' })).status).toBe('ok');
    expect(await gravarCardSolar({ ...ficha, dono: 'Thiago', quando: brt('2026-10-22', '10:15') }, { faixa: 'remarcacao' }))
      .toEqual({ status: 'horario_fora_da_grade' });
  });

  it('ligarAgora: o card já nasce com lembrete_5min_at e bomdia_at de agora; sem a opção nenhum dos dois entra', async () => {
    await gravarCardSolar(ficha, { faixa: 'novo', ligarAgora: true });
    expect(h.inserts[0].lembrete_5min_at).toBe(new Date(AGORA).toISOString());
    expect(h.inserts[0].bomdia_at).toBe(new Date(AGORA).toISOString());
    expect(h.inserts[0].boas_vindas_at).toBeNull();
    await gravarCardSolar(ficha, { faixa: 'novo' });
    expect(h.inserts[1]).not.toHaveProperty('lembrete_5min_at');
  });

  it('o 23505 do índice também vale no caminho da agente', async () => {
    h.insertResultado = { data: null, error: { code: '23505', message: 'dup' } };
    expect(await gravarCardSolar(ficha, { faixa: 'novo' })).toEqual({ status: 'horario_tomado' });
  });
});

describe('marcarBoasVindasEnviada', () => {
  it('UPDATE boas_vindas_at = agora SÓ onde ainda é nulo', async () => {
    expect(await marcarBoasVindasEnviada(77)).toBe(true);
    expect(h.updates).toEqual([{ boas_vindas_at: new Date(AGORA).toISOString() }]);
    expect(h.updateEqs).toEqual([['id', 77]]);
    expect(h.updateIs).toEqual([['boas_vindas_at', null]]);
  });
  it('já carimbado (nenhuma linha pega) = false; erro do banco = false, sem estourar', async () => {
    h.updateResultado = { data: [], error: null };
    expect(await marcarBoasVindasEnviada(77)).toBe(false);
    h.updateResultado = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await marcarBoasVindasEnviada(77)).toBe(false);
  });
});

describe('silenciarLembretesDoCard (ligar agora em card que já existia)', () => {
  it('UPDATE do card pelo id: lembrete_5min_at e bomdia_at = agora; true só se o banco devolveu a linha', async () => {
    h.updateResultado = { data: [{ id: 5 }], error: null };
    expect(await silenciarLembretesDoCard(5)).toBe(true);
    expect(h.updates[0]).toEqual({ lembrete_5min_at: new Date(AGORA).toISOString(), bomdia_at: new Date(AGORA).toISOString() });
    expect(h.updateEqs).toEqual([['id', 5]]);
  });
  it('nenhuma linha atualizada ou erro do banco = false, sem estourar', async () => {
    h.updateResultado = { data: [], error: null };
    expect(await silenciarLembretesDoCard(5)).toBe(false);
    h.updateResultado = { data: null, error: { code: 'XX000' } };
    expect(await silenciarLembretesDoCard(5)).toBe(false);
  });
});

describe('remarcarCardSolar', () => {
  const novo = brt('2026-10-23', '14:15');
  const lido = brt('2026-10-22', '10:00');
  beforeEach(() => { h.cardLido = { id: 5, quando: lido, vendedor_nome: 'Nilce', status: 'agendado', historico: null }; });

  it('UPDATE do mesmo card: quando, agendado, bomdia_at e lembrete_5min_at nulos, historico; não cria card', async () => {
    expect(await remarcarCardSolar(5, novo)).toBe('ok');
    expect(h.inserts).toEqual([]);
    expect(h.updates).toHaveLength(1);
    const { historico, ...resto } = h.updates[0];
    expect(resto).toEqual({ quando: novo, status: 'agendado', bomdia_at: null, lembrete_5min_at: null });
    expect(historico).toBeTypeOf('string');
    // o UPDATE é travado pelo id, pelo horário lido e pelo status lido
    expect(h.updateEqs).toEqual([['id', 5], ['quando', lido], ['status', 'agendado']]);
  });

  it('nao_atendeu vira agendado, e o UPDATE é travado pelo status lido (nao_atendeu)', async () => {
    h.cardLido = { ...h.cardLido, status: 'nao_atendeu' };
    expect(await remarcarCardSolar(5, novo)).toBe('ok');
    expect(h.updates[0].status).toBe('agendado');
    expect(h.updateEqs).toContainEqual(['status', 'nao_atendeu']);
  });

  it('qualquer outro status = status_nao_permite, sem gravar', async () => {
    for (const status of ['negociacao', 'vendido', 'sem_interesse', 'apalavrado', 'cancelado', 'compareceu', '', null]) {
      h.cardLido = { ...h.cardLido, status };
      expect(await remarcarCardSolar(5, novo)).toBe('status_nao_permite');
    }
    expect(h.updates).toEqual([]);
  });

  it('o horário tem que estar na lista de vagas da faixa de remarcação (:15/:45) do dono; fora = horario_fora_da_grade sem gravar', async () => {
    for (const quando of [brt('2026-10-23', '14:00'), brt('2026-10-23', '14:30'), brt('2026-10-23', '17:15'),
      brt('2026-10-24', '10:15'), brt('2026-10-21', '09:15')]) {
      expect(await remarcarCardSolar(5, quando)).toBe('horario_fora_da_grade');
    }
    expect(h.updates).toEqual([]);
    expect(await remarcarCardSolar(5, brt('2026-10-23', '14:45'))).toBe('ok');
  });

  it('o próprio horário do card não conta como ocupado, o de outro card sim', async () => {
    const proprio = brt('2026-10-22', '10:15');
    h.cardLido = { ...h.cardLido, quando: proprio };
    h.compromissos = [{ ts: Date.parse(proprio), dono: 'Nilce', ep: false }];
    expect(await remarcarCardSolar(5, proprio)).toBe('ok');
    h.compromissos = [{ ts: Date.parse(novo), dono: 'Nilce', ep: false }];
    h.updates = [];
    expect(await remarcarCardSolar(5, novo)).toBe('horario_tomado');
    expect(h.updates).toEqual([]);
  });

  it('nao_achou: card inexistente, ou que mudou entre a leitura e o update', async () => {
    h.cardLido = null;
    expect(await remarcarCardSolar(5, novo)).toBe('nao_achou');
    h.cardLido = { id: 5, quando: lido, vendedor_nome: 'Nilce', status: 'agendado', historico: null };
    h.updateResultado = { data: [], error: null };
    expect(await remarcarCardSolar(5, novo)).toBe('nao_achou');
  });

  it('23505 no update = horario_tomado; leitura da agenda quebrada ou erro do banco = erro', async () => {
    h.updateResultado = { data: null, error: { code: '23505', message: 'dup' } };
    expect(await remarcarCardSolar(5, novo)).toBe('horario_tomado');
    h.updateResultado = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await remarcarCardSolar(5, novo)).toBe('erro');
    h.updateResultado = { data: [{ id: 5 }], error: null };
    h.compromissos = null;
    expect(await remarcarCardSolar(5, novo)).toBe('erro');
    h.compromissos = [];
    h.erroLeitura = { message: 'x' };
    expect(await remarcarCardSolar(5, novo)).toBe('erro');
  });

  it('grava a linha no historico no formato do reagendaSolarNaoAtendido, por cima do que já havia', async () => {
    await remarcarCardSolar(5, novo);
    // 21/10 09:00 BRT; de 22/10 10:00 para 23/10 14:15
    expect(h.updates[0].historico).toBe(
      '[21/10 · 09:00 · Sistema] 🔁 Remarcação pela agente (Duda): a ligação de 22/10 10:00 passou para 23/10 14:15, '
      + 'a pedido do cliente, com o mesmo consultor.');
    expect(h.updates[0].historico).not.toMatch(/Remarcação automática \d+\/\d+: não atendeu em /);
    const antes = '[18/10 · 08:00 · Sistema] 🔁 Remarcação automática 1/3: não atendeu em 18/10 08:00 e voltou pra 22/10 10:00, com o mesmo consultor.';
    h.cardLido = { ...h.cardLido, historico: antes };
    await remarcarCardSolar(5, novo);
    const h2: string = h.updates[1].historico;
    expect(h2.endsWith('\n\n' + antes)).toBe(true);
    expect(h2.startsWith('[21/10 · 09:00 · Sistema] 🔁 Remarcação pela agente')).toBe(true);
  });

  describe('o bom dia (janela das 7h às 11h do solarAgendaGiovanna)', () => {
    const ate = (isoUtc: string) => vi.setSystemTime(Date.parse(isoUtc));
    it('HOJE antes das 11h: bomdia_at = agora (não nulo); lembrete_5min_at segue nulo', async () => {
      h.cardLido = { ...h.cardLido, quando: brt('2026-10-21', '09:45') };
      expect(await remarcarCardSolar(5, brt('2026-10-21', '14:15'))).toBe('ok');
      expect(h.updates[0].bomdia_at).toBe(new Date(AGORA).toISOString());
      expect(h.updates[0].lembrete_5min_at).toBeNull();
    });
    it('HOJE antes das 7h também (a janela abre às 7h): bomdia_at = agora', async () => {
      ate('2026-10-21T08:00:00Z');   // 05:00 BRT
      h.cardLido = { ...h.cardLido, quando: brt('2026-10-21', '09:45') };
      await remarcarCardSolar(5, brt('2026-10-21', '14:15'));
      expect(h.updates[0].bomdia_at).toBe('2026-10-21T08:00:00.000Z');
    });
    it('HOJE a partir das 11h: a janela fechou, segue nulo', async () => {
      ate('2026-10-21T14:00:00Z');   // 11:00 BRT
      h.cardLido = { ...h.cardLido, quando: brt('2026-10-21', '14:15') };
      await remarcarCardSolar(5, brt('2026-10-21', '15:15'));
      expect(h.updates[0].bomdia_at).toBeNull();
      expect(h.updates[0].lembrete_5min_at).toBeNull();
    });
    it('outro dia, mesmo antes das 11h: segue nulo, para o bom dia falar no dia novo', async () => {
      expect(await remarcarCardSolar(5, brt('2026-10-22', '10:15'))).toBe('ok');
      expect(h.updates[0].bomdia_at).toBeNull();
      expect(h.updates[0].lembrete_5min_at).toBeNull();
    });
  });
});
