import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O robô que remarca sozinho. Os riscos aqui são maiores que os dos outros
// agentes, porque este ESCREVE na agenda: mover pro horário errado, mover sem a
// pessoa ter escolhido, oferecer horário ocupado, e responder lista de horários
// pra quem pediu pra CANCELAR.

const state = new Map<string, any>();
let compromissos: any[] = [];
const updates: Array<{ id: number; patch: any }> = [];
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
let tetoLivre = true;

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _key: null as string | null,
        _del: false,
        select() { return q; },
        eq(_c: string, v: any) {
          q._key = String(v);
          if (q._del) { state.delete(q._key!); return Promise.resolve({ error: null }); }
          return q;
        },
        like() { return q; },
        limit() { return Promise.resolve({ data: [...state.values()], error: null }); },
        maybeSingle() { return Promise.resolve({ data: state.get(q._key!) ?? null, error: null }); },
        delete() { q._del = true; return q; },
        upsert(r: any) { state.set(String(r.key), r); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _update: null as any,
        select() { return q; }, gte() { return q; }, lte() { return q; }, not() { return q; },
        update(patch: any) { q._update = patch; return q; },
        eq(_c: string, v: any) {
          if (q._update) { updates.push({ id: Number(v), patch: q._update }); return Promise.resolve({ error: null }); }
          return q;
        },
        limit() { return Promise.resolve({ data: compromissos, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoLivre),
}));

// Quinta, 13/08/2026, 10h BRT (13h UTC). A grade do dia (10h, 11h e 13h–18h) está
// quase inteira pela frente — só as 10:00 já caíram na folga de 30 min —, então dá
// pra testar oferta de HOJE e de outro dia.
const AGORA = new Date('2026-08-13T13:00:00.000Z');
/** Horário de Brasília → ISO. Deixa o teste legível: `brt('2026-08-13', 15)`. */
const brt = (ymd: string, h: number, min = 0) =>
  new Date(`${ymd}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`).toISOString();
/** A tarde inteira de terça a sexta desde 31/08/2026: 13h às 17h30, de meia em meia. */
const TARDE: Array<[number, number]> = [
  [13, 0], [13, 30], [14, 0], [14, 30], [15, 0], [15, 30], [16, 0], [16, 30], [17, 0], [17, 30],
];

/** Reunião marcada pra HOJE às 14h com o Diego. */
const ficha = (over: Partial<any> = {}) => ({
  id: 1, cliente_nome: 'Irineu de Almeida', cliente_telefone: '5569984488158',
  quando: brt('2026-08-13', 14), vendedor_nome: 'Diego', ...over,
});

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); updates.length = 0; enviadas.length = 0;
  compromissos = []; tetoLivre = true;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function mod() { return import('../services/io/eletropostoRemarcar'); }
async function vagasMod() { return import('../services/io/eletropostoVagas'); }

describe('a régua de horários livres', () => {
  // 13/08/2026 é uma QUINTA, e desde 19/08 quinta é só a tarde: 13:00 às 17:00.
  // O relógio dos testes é 10h BRT, então a primeira vaga do dia é a primeira da
  // grade — a manhã deixou de existir fora da segunda.
  // 31/08/2026: de terça a sexta a tarde passou a ser de MEIA em meia hora.
  it('oferece a grade do dia, de meia em meia hora', async () => {
    const { proximasVagas } = await vagasMod();
    const v = (await proximasVagas('Diego', 3))!;
    expect(v).toEqual([brt('2026-08-13', 13), brt('2026-08-13', 13, 30), brt('2026-08-13', 14)]);
  });

  // A grade da SEGUNDA não mudou: ela acumula o fim de semana e mantém a manhã.
  // Lotando a quinta e a sexta inteiras, o que sobra é a segunda começando às 10h.
  it('segunda continua com a manhã — é o dia que acumula o fim de semana', async () => {
    compromissos = TARDE.flatMap(([h, m]) => ([
      { quando: brt('2026-08-13', h, m), vendedor_nome: 'Diego' },
      { quando: brt('2026-08-14', h, m), vendedor_nome: 'Diego' },
    ]));
    const { proximasVagas } = await vagasMod();
    const v = (await proximasVagas('Diego', 3))!;
    expect(v).toEqual([brt('2026-08-17', 10), brt('2026-08-17', 11), brt('2026-08-17', 13)]);
  });

  it('o horário da própria ficha nunca é oferecido de volta', async () => {
    const { proximasVagas } = await vagasMod();
    const v = (await proximasVagas('Diego', 3, { ignorarIso: brt('2026-08-13', 14) }))!;
    expect(v).not.toContain(brt('2026-08-13', 14));
    expect(v[0]).toBe(brt('2026-08-13', 13));
  });

  // A agenda tem reunião de solar em horário quebrado (14:15, 16:15). Comparar
  // timestamp exato vendia por cima do compromisso do consultor.
  it('compromisso quebrado fecha o horário por sobreposição, não por igualdade', async () => {
    compromissos = [{ quando: brt('2026-08-13', 13).replace('T16:00', 'T16:15'), vendedor_nome: 'Diego' }];
    const { proximasVagas } = await vagasMod();
    const v = (await proximasVagas('Diego', 2))!;
    expect(v).not.toContain(brt('2026-08-13', 13));
  });

  it('o compromisso do OUTRO consultor não tira a vaga deste', async () => {
    compromissos = [{ quando: brt('2026-08-13', 13), vendedor_nome: 'Thiago' }];
    const { proximasVagas } = await vagasMod();
    expect((await proximasVagas('Diego', 1))![0]).toBe(brt('2026-08-13', 13));
  });

  // Sexta 14/08 é dia útil; sábado e domingo não abrem. Pulando a sexta inteira,
  // o próximo tem que ser segunda 17/08 — nunca sábado. Lotar quinta e sexta são
  // as 5 horas da tarde (19/08: fora da segunda, a grade é 13 às 17).
  it('sábado e domingo não entram', async () => {
    compromissos = TARDE.flatMap(([h, m]) => ([
      { quando: brt('2026-08-13', h, m), vendedor_nome: 'Diego' },
      { quando: brt('2026-08-14', h, m), vendedor_nome: 'Diego' },
    ]));
    const { proximasVagas } = await vagasMod();
    expect((await proximasVagas('Diego', 1))![0]).toBe(brt('2026-08-17', 10));
  });

  it('feriado não entra', async () => {
    const { agendaAbre } = await vagasMod();
    expect(agendaAbre('2026-09-07')).toBe(false);   // Independência, numa segunda
    expect(agendaAbre('2026-08-13')).toBe(true);
  });

  // Ler a agenda e falhar não pode virar "está tudo livre": seria oferecer
  // horário ocupado e marcar dois na mesma hora.
  it('falha de leitura devolve null, não uma agenda vazia', async () => {
    const { proximasVagas } = await vagasMod();
    compromissos = null as any;                     // o mock devolve data:null
    const v = await proximasVagas('Diego', 3);
    expect(v === null || v.length === 0).toBe(true);
  });
});

describe('entender o que a pessoa quis dizer', () => {
  it('pedido de remarcar liga o robô; pedido de cancelar NÃO', async () => {
    const { querRemarcar } = await mod();
    for (const t of ['não vai dar quinta', 'pode ser outro dia?', 'preciso remarcar', 'não consigo nesse horário'])
      expect(querRemarcar([t])).toBe(true);
    // Cancelar é assunto de gente: responder uma lista de horários pra quem
    // acabou de desistir é o robô ignorando o que foi dito.
    for (const t of ['quero cancelar', 'pode desmarcar', 'desisti', 'não tenho mais interesse'])
      expect(querRemarcar([t])).toBe(false);
    // A intenção mais forte vence, mesmo vindo depois.
    expect(querRemarcar(['não vai dar', 'quero cancelar'])).toBe(false);
  });

  it('escolhe pelo número, pelo dia da semana e pela hora', async () => {
    const { escolhaDaResposta } = await mod();
    const ofertas = [brt('2026-08-13', 15), brt('2026-08-17', 13), brt('2026-08-18', 16)];
    expect(escolhaDaResposta(['2'], ofertas)).toBe(1);
    expect(escolhaDaResposta(['opção 3'], ofertas)).toBe(2);
    expect(escolhaDaResposta(['segunda'], ofertas)).toBe(1);
    expect(escolhaDaResposta(['pode ser 16h'], ofertas)).toBe(2);
    expect(escolhaDaResposta(['dia 17/08'], ofertas)).toBe(1);
    expect(escolhaDaResposta(['obrigado'], ofertas)).toBe(null);
  });

  // Duas opções no mesmo dia e a pessoa diz só o dia: chutar aqui é remarcar pro
  // horário errado, e ela só descobre quando ninguém entra na chamada.
  it('empate não vira chute: pede o número', async () => {
    const { escolhaDaResposta } = await mod();
    const ofertas = [brt('2026-08-17', 13), brt('2026-08-17', 15)];
    expect(escolhaDaResposta(['segunda'], ofertas)).toBe(-1);
    expect(escolhaDaResposta(['segunda 15h'], ofertas)).toBe(1);
  });

  it('número solto no meio de uma frase não é escolha de horário', async () => {
    const { escolhaDaResposta } = await mod();
    const ofertas = [brt('2026-08-17', 13), brt('2026-08-18', 13)];
    expect(escolhaDaResposta(['vamos ser 2 pessoas na reunião'], ofertas)).toBe(null);
  });
});

describe('a conversa de ponta a ponta', () => {
  it('pediu pra remarcar: recebe a lista e nada é gravado na agenda ainda', async () => {
    const { passoDeRemarcacao } = await mod();
    const r = await passoDeRemarcacao(ficha(), ['não vai dar hoje, pode ser outro dia?'], '5534991360172');
    expect(r.acao).toBe('ofertou');
    expect(updates).toEqual([]);                     // NADA muda antes de a pessoa escolher
    const txt = enviadas[0].bolhas.join(' ');
    expect(txt).toContain('1)');
    expect(txt).toContain('Diego');
    expect(state.has('ep_remarcar:1')).toBe(true);
  });

  it('escolheu: a reunião muda de horário e a régua de avisos é ressincronizada', async () => {
    const { passoDeRemarcacao } = await mod();
    const alvo = (await passoDeRemarcacao(ficha(), ['preciso remarcar'], null)) as any;
    enviadas.length = 0;

    const r = await passoDeRemarcacao(ficha(), ['2'], '5534991360172');
    expect(r).toMatchObject({ acao: 'remarcou', para: alvo.ofertas[1] });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({
      quando: alvo.ofertas[1],
      // Sem zerar isto, a reunião nova acontece sem nenhum aviso antes dela.
      lembrete_1h_at: null, lembrete_5min_at: null,
      // Escolher horário é combinar, não é dizer "eu vou".
      presenca_confirmada_at: null,
    });
    // A confirmação (que já foi dada) não é refeita do zero.
    expect(updates[0].patch).not.toHaveProperty('confirmacao_at');
    expect(enviadas[0].bolhas.join(' ')).toContain('Pronto');
  });

  // O carimbo do bom dia é por FICHA, não por data. Sem apagar, quem remarcou pra
  // outro dia nunca receberia o "hoje é o dia" do dia novo.
  it('remarcar solta o carimbo do bom dia', async () => {
    const { passoDeRemarcacao } = await mod();
    state.set('ep_agenda_sent:1:manha', { key: 'ep_agenda_sent:1:manha', value: {} });
    await passoDeRemarcacao(ficha(), ['preciso remarcar'], null);
    await passoDeRemarcacao(ficha(), ['1'], null);
    expect(state.has('ep_agenda_sent:1:manha')).toBe(false);
  });

  it('o consultor NÃO muda: as opções são todas da agenda de quem já estava marcado', async () => {
    // Diego lotado hoje; Thiago livre. A oferta tem que pular pro próximo dia do
    // DIEGO, nunca oferecer o horário livre do Thiago.
    compromissos = TARDE.map(([h, m]) => ({ quando: brt('2026-08-13', h, m), vendedor_nome: 'Diego' }));
    const { passoDeRemarcacao } = await mod();
    const r = (await passoDeRemarcacao(ficha(), ['pode ser outro dia?'], null)) as any;
    expect(r.acao).toBe('ofertou');
    expect(r.ofertas.every((o: string) => o >= brt('2026-08-14', 10))).toBe(true);
    expect(enviadas[0].bolhas.join(' ')).toContain('Diego');
  });

  // Entre oferecer e a pessoa responder passam horas — tempo de sobra pra outra
  // marcar aquele slot na LP. Gravar sem reconferir marca dois na mesma hora.
  it('slot tomado no meio do caminho não é gravado: oferece de novo', async () => {
    const { passoDeRemarcacao } = await mod();
    const alvo = (await passoDeRemarcacao(ficha(), ['preciso remarcar'], null)) as any;
    compromissos = [{ quando: alvo.ofertas[0], vendedor_nome: 'Diego' }];
    enviadas.length = 0;

    const r = await passoDeRemarcacao(ficha(), ['1'], null);
    expect(r.acao).toBe('ofertou');
    expect(updates).toEqual([]);
    expect(enviadas[0].bolhas.join(' ')).not.toContain(alvo.ofertas[0]);
  });

  it('quem pediu pra CANCELAR não recebe lista de horários', async () => {
    const { passoDeRemarcacao } = await mod();
    const r = await passoDeRemarcacao(ficha(), ['quero cancelar'], null);
    expect(r.acao).toBe('nada');
    expect(enviadas).toHaveLength(0);
    expect(updates).toEqual([]);
  });

  it('agenda sem vaga nenhuma: chama gente em vez de inventar horário', async () => {
    // Diego lotado nos 21 dias varridos.
    // Lotar de verdade agora exige a grade das duas formas: a tarde de meia em meia
    // (ter–sex) e a manhã que só a segunda tem.
    compromissos = Array.from({ length: 21 }, (_, d) =>
      [...TARDE, [10, 0], [11, 0], [18, 0]].map(([h, m]) => ({
        quando: new Date(new Date(brt('2026-08-13', h, m)).getTime() + d * 86400_000).toISOString(),
        vendedor_nome: 'Diego',
      }))).flat();
    const { passoDeRemarcacao } = await mod();
    const r = await passoDeRemarcacao(ficha(), ['preciso remarcar'], null);
    expect(r.acao).toBe('sem_vaga');
    expect(updates).toEqual([]);
    expect(enviadas[0].bolhas.join(' ')).toContain('sem horário livre');
  });

  it('duas ofertas e para: a terceira insistência é do humano', async () => {
    const { passoDeRemarcacao } = await mod();
    expect((await passoDeRemarcacao(ficha(), ['preciso remarcar'], null)).acao).toBe('ofertou');
    expect((await passoDeRemarcacao(ficha(), ['não, outro dia'], null)).acao).toBe('ofertou');
    enviadas.length = 0;
    expect((await passoDeRemarcacao(ficha(), ['outro dia por favor'], null)).acao).toBe('desistiu');
    expect(enviadas).toHaveLength(0);
  });

  it('oferta de ontem não é escolhida por um "1" solto de hoje', async () => {
    const { passoDeRemarcacao } = await mod();
    await passoDeRemarcacao(ficha(), ['preciso remarcar'], null);
    const velha = state.get('ep_remarcar:1');
    velha.value.em = new Date(AGORA.getTime() - 30 * 3600_000).toISOString();
    enviadas.length = 0;

    const r = await passoDeRemarcacao(ficha(), ['1'], null);
    expect(r.acao).toBe('nada');
    expect(updates).toEqual([]);
  });

  it('teto da linha estourado: não fala, não grava oferta e não gasta rodada', async () => {
    const { passoDeRemarcacao } = await mod();
    tetoLivre = false;
    const r = await passoDeRemarcacao(ficha(), ['preciso remarcar'], null);
    expect(r.acao).toBe('nada');
    expect(enviadas).toHaveLength(0);
    expect(state.has('ep_remarcar:1')).toBe(false);
  });

  it('kill-switch desliga tudo', async () => {
    process.env.EP_REMARCAR_OFF = '1';
    vi.resetModules();
    const { passoDeRemarcacao } = await mod();
    expect((await passoDeRemarcacao(ficha(), ['preciso remarcar'], null)).acao).toBe('nada');
    expect(enviadas).toHaveLength(0);
  });

  it('dry decide igual e não envia nem grava', async () => {
    const { passoDeRemarcacao } = await mod();
    const r = await passoDeRemarcacao(ficha(), ['preciso remarcar'], null, { dry: true });
    expect(r.acao).toBe('ofertou');
    expect(enviadas).toHaveLength(0);
    expect(state.has('ep_remarcar:1')).toBe(false);
  });

  it('o recado da equipe conta o desfecho', async () => {
    const { linhaDoAviso } = await mod();
    expect(linhaDoAviso({ acao: 'remarcou', de: brt('2026-08-13', 14), para: brt('2026-08-17', 13) }))
      .toContain('REMARCADO PELO ROBÔ');
    expect(linhaDoAviso({ acao: 'sem_vaga' })).toContain('encaixe manual');
    expect(linhaDoAviso({ acao: 'nada' })).toBe(null);
  });
});
