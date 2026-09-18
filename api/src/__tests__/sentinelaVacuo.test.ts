import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A sentinela cobra GENTE, não cliente. O erro caro aqui não é mandar mensagem
// errada pro lead: é cobrar a equipe do que ela não deve, e ser silenciada no
// mesmo dia. Então o que este arquivo tranca é: relógio útil (mensagem das 19h50
// não está atrasada às 9h), um resumo por dono, e cada conversa cobrada uma vez
// por nível.
// ─────────────────────────────────────────────────────────────────────────────

interface Msg { telefone: string; from_me: boolean; texto: string | null; momment: string; chat_name?: string | null; is_group?: boolean; instancia?: string }

const db: {
  wa: Msg[]; sessoes: any[]; leads: any[];
  state: Array<{ key: string; updated_at: string; value?: string }>;
  erroNoState: boolean;
} = {
  wa: [], sessoes: [], leads: [], state: [], erroNoState: false,
};

function builder(tabela: string) {
  const q: any = {
    _filtros: [] as Array<(r: any) => boolean>,
    select() { return q; },
    eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return q; },
    like(col: string, padrao: string) {
      const pref = padrao.replace(/%$/, '');
      q._filtros.push((r: any) => String(r[col] ?? '').startsWith(pref));
      return q;
    },
    gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
    order() { return q; },
    limit() { return q; },
    maybeSingle() {
      const linhas = q._linhas();
      return Promise.resolve({ data: linhas[0] ?? null, error: null });
    },
    upsert(linha: any) {
      // Guarda a linha INTEIRA: a represa da varredura lê `value`, e um mock que
      // só guarda a chave faria o teste passar por engano (o serviço tem
      // try/catch e devolveria "pode varrer" pra qualquer defeito de leitura).
      db.state = db.state.filter(r => r.key !== linha.key).concat({ ...linha });
      return Promise.resolve({ error: null });
    },
    _linhas() {
      const fonte = tabela === 'wa_mensagens' ? db.wa
        : tabela === 'whatsapp_sessions' ? db.sessoes
        : tabela === 'sdr_leads' ? db.leads
        : db.state;
      return fonte.filter((r: any) => q._filtros.every((f: any) => f(r)));
    },
    then(res: any, rej: any) {
      // Consulta que quebra devolve data NULA e um error preenchido. É assim que
      // o supabase-js responde, e é o formato que pega quem esquece o `error`.
      if (tabela === 'system_state' && db.erroNoState) {
        return Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(res, rej);
      }
      return Promise.resolve({ data: q._linhas(), error: null }).then(res, rej);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const enviados: Array<{ phone: string; texto: string }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => { enviados.push({ phone, texto }); }),
}));

const silenciados = new Set<string>();
vi.mock('../services/agents/whatsapp/silenciar', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/agents/whatsapp/silenciar')>();
  return { ...real, carregarSilenciados: vi.fn(async () => (p: string) => silenciados.has(real.chaveContato(p) || '')) };
});

import { runSentinelaVacuo, horasUteisEntre, montarResumo, dentroDoExpediente } from '../services/io/sentinelaVacuo';

const INST = '3F26F6ECE67D72BB7FCA6244BF24326C';
const msg = (tel: string, from_me: boolean, quandoMs: number, texto = 'oi, queria um orçamento'): Msg => ({
  telefone: tel, from_me, texto, momment: new Date(quandoMs).toISOString(),
  chat_name: 'Cliente Teste', is_group: false, instancia: INST,
});

beforeEach(() => {
  db.wa = []; db.sessoes = []; db.leads = []; db.state = []; db.erroNoState = false;
  enviados.length = 0; silenciados.clear();
  process.env.ZAPI_INSTANCE_ID_IO = INST;
  delete process.env.VACUO_OFF;
  // Relógio preso numa quarta-feira às 14h de Brasília. Sem isto o teste passaria
  // de dia e falharia de madrugada — a sentinela só cobra em expediente, e teste
  // que depende da hora da máquina é teste que vermelha sozinho às 3 da manhã.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-16T17:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('horasUteisEntre', () => {
  it('não conta a madrugada: 19h50 até 9h do dia seguinte é pouco mais de 10 minutos', () => {
    // 2026-09-16 é uma quarta-feira. 19h50 BRT = 22h50 UTC.
    const de = new Date('2026-09-16T22:50:00Z');
    const ate = new Date('2026-09-17T12:05:00Z');   // 09h05 BRT
    const h = horasUteisEntre(de, ate);
    expect(h).toBeGreaterThan(0.1);
    expect(h).toBeLessThan(0.5);
  });

  it('conta o expediente cheio: 9h às 15h do mesmo dia são 6 horas', () => {
    const h = horasUteisEntre(new Date('2026-09-16T12:00:00Z'), new Date('2026-09-16T18:00:00Z'));
    expect(Math.round(h)).toBe(6);
  });

  it('domingo não conta', () => {
    // 2026-09-13 é domingo (BRT).
    const h = horasUteisEntre(new Date('2026-09-13T13:00:00Z'), new Date('2026-09-13T22:00:00Z'));
    expect(h).toBe(0);
  });
});

describe('runSentinelaVacuo', () => {
  it('cobra o dono quando a pessoa escreveu por último e o tempo útil passou', async () => {
    const seisHorasAtras = Date.now() - 6 * 3600_000;
    db.wa = [msg('5534999990001', false, seisHorasAtras)];
    db.sessoes = [{ phone: '5534999990001', tipo: 'recepcao_io', lead_data: { produto: 'solar' } }];

    const r = await runSentinelaVacuo();

    // Solar é da Giovanna — o recado não pode cair sempre no Thiago.
    expect(r.cobrancas).toBeGreaterThanOrEqual(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].phone).toBe('34993396255');
    expect(enviados[0].texto).toContain('esperando');
  });

  it('não cobra quando a gente já respondeu depois', async () => {
    const seis = Date.now() - 6 * 3600_000;
    db.wa = [msg('5534999990002', false, seis), msg('5534999990002', true, seis + 60_000, 'já respondi')];

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('não cobra duas vezes a mesma conversa no mesmo nível', async () => {
    db.wa = [msg('5534999990003', false, Date.now() - 6 * 3600_000)];

    await runSentinelaVacuo();
    const depoisDaPrimeira = enviados.length;
    await runSentinelaVacuo();

    expect(enviados.length).toBe(depoisDaPrimeira);
  });

  it('junta várias conversas do mesmo dono num resumo só', async () => {
    const seis = Date.now() - 6 * 3600_000;
    db.wa = [msg('5534999990004', false, seis), msg('5534999990005', false, seis), msg('5534999990006', false, seis)];

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(3);
    expect(enviados).toHaveLength(1);              // 3 conversas, 1 recado
    expect(enviados[0].texto).toContain('3 pessoas esperando');
  });

  it('quem pediu pra parar não vira cobrança', async () => {
    db.wa = [msg('5534999990007', false, Date.now() - 6 * 3600_000)];
    silenciados.add('34999990007'.slice(0, 2) + '99990007');

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(0);
  });

  it('número da própria equipe não entra na fila', async () => {
    db.wa = [msg('5534991360223', false, Date.now() - 6 * 3600_000)];   // Thiago

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(0);
  });

  it('dry mostra quem seria cobrado e não manda nada', async () => {
    db.wa = [msg('5534999990008', false, Date.now() - 6 * 3600_000)];

    const r = await runSentinelaVacuo({ dry: true });

    expect(enviados).toHaveLength(0);
    expect(db.state).toHaveLength(0);
    expect(r.motivo).toBe('cobraria_agora');
    expect(r.amostra?.length).toBe(1);
  });

  it('kill-switch VACUO_OFF cala tudo', async () => {
    process.env.VACUO_OFF = '1';
    db.wa = [msg('5534999990009', false, Date.now() - 6 * 3600_000)];

    expect((await runSentinelaVacuo()).motivo).toBe('desligada');
    expect(enviados).toHaveLength(0);
  });
});

describe('montarResumo', () => {
  it('traz nome, produto, espera, a frase da pessoa e o link da conversa', () => {
    const txt = montarResumo('giovanna', [{
      telefone: '5534999990010', nome: 'Maria', ultimaDeles: new Date().toISOString(),
      texto: 'oi, queria saber o preço', horasUteis: 4.2, produto: 'solar', nivel: 1, donos: ['giovanna'],
    }]);
    expect(txt).toContain('Giovanna');
    expect(txt).toContain('Maria');
    expect(txt).toContain('Solar');
    expect(txt).toContain('4h');
    expect(txt).toContain('wa.me/5534999990010');
    expect(txt).toContain('queria saber o preço');
  });
});

describe('dentroDoExpediente', () => {
  it('quarta às 14h de Brasília: pode cobrar', () => {
    expect(dentroDoExpediente(new Date('2026-09-16T17:00:00Z'))).toBe(true);
  });

  it('3h da manhã: não cobra ninguém', () => {
    expect(dentroDoExpediente(new Date('2026-09-16T06:00:00Z'))).toBe(false);
  });

  it('domingo não cobra nem no meio da tarde', () => {
    expect(dentroDoExpediente(new Date('2026-09-13T17:00:00Z'))).toBe(false);
  });

  it('o cron das 3h não manda recado: devolve fora_do_expediente', async () => {
    vi.setSystemTime(new Date('2026-09-16T06:00:00Z'));
    db.wa = [msg('5534999990011', false, Date.parse('2026-09-15T17:00:00Z'))];

    const r = await runSentinelaVacuo();

    expect(r.motivo).toBe('fora_do_expediente');
    expect(enviados).toHaveLength(0);
  });

  it('o modo seco responde a qualquer hora — perguntar não é enviar', async () => {
    vi.setSystemTime(new Date('2026-09-16T06:00:00Z'));
    db.wa = [msg('5534999990012', false, Date.parse('2026-09-15T17:00:00Z'))];

    const r = await runSentinelaVacuo({ dry: true });

    expect(r.motivo).toBe('cobraria_agora');
    expect(enviados).toHaveLength(0);
  });
});

describe('conversa velha não vira três recados seguidos', () => {
  it('cobrada no nível 3, não volta no 2 nem no 1 nas varreduras seguintes', async () => {
    // 60 horas úteis: ela já nasce no nível mais alto. O erro que este teste
    // tranca é o de 18/09/2026, quando as mesmas 19 conversas viraram recado às
    // 13:40, 14:00 e 14:22 porque só o nível cobrado era carimbado.
    db.wa = [msg('5534999990020', false, Date.parse('2026-09-10T13:00:00Z'))];

    const primeira = await runSentinelaVacuo();
    expect(primeira.cobrancas).toBe(1);
    expect(enviados).toHaveLength(1);

    vi.setSystemTime(new Date(Date.now() + 21 * 60_000));
    const segunda = await runSentinelaVacuo();
    vi.setSystemTime(new Date(Date.now() + 21 * 60_000));
    const terceira = await runSentinelaVacuo();

    expect(segunda.motivo).toBe('todas_ja_cobradas');
    expect(terceira.motivo).toBe('todas_ja_cobradas');
    expect(enviados).toHaveLength(1);              // um recado, não três
  });

  it('cobrada no nível 1, ainda pode subir pro 2 quando a espera crescer', async () => {
    // O carimbo retroativo não pode matar a régua: quem foi cobrado no 1 tem que
    // voltar quando de fato passar das 8 horas úteis.
    db.wa = [msg('5534999990021', false, Date.now() - 4 * 3600_000)];

    const primeira = await runSentinelaVacuo();
    expect(primeira.cobrancas).toBe(1);

    // Passa a cruzar o nível 2. A data é absoluta de propósito: "9 horas atrás"
    // no relógio cai de madrugada e vira 5 horas ÚTEIS, que não cruzam nada.
    // Terça 16h BRT até quarta 14h21 = 4h de terça + 5h de quarta ≈ 9h úteis.
    db.wa = [msg('5534999990021', false, Date.parse('2026-09-15T19:00:00Z'))];
    vi.setSystemTime(new Date(Date.now() + 21 * 60_000));
    const segunda = await runSentinelaVacuo();

    expect(segunda.cobrancas).toBe(1);
    expect(enviados).toHaveLength(2);
  });
});

describe('leitura dos marcadores', () => {
  it('consulta quebrada NÃO vira "ninguém foi cobrado ainda"', async () => {
    // O perigo não é falhar: é a falha parecer sucesso. Marcador que não foi
    // lido faz toda conversa parada parecer nova, e a equipe recebe a mesma
    // lista de novo a cada varredura.
    db.wa = [msg('5534999990015', false, Date.now() - 6 * 3600_000)];
    db.erroNoState = true;

    const r = await runSentinelaVacuo();

    expect(r.motivo).toBe('erro_marcadores');
    expect(r.cobrancas).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('sem erro, a conversa já cobrada continua sendo pulada', async () => {
    db.wa = [msg('5534999990016', false, Date.now() - 6 * 3600_000)];

    await runSentinelaVacuo();
    vi.setSystemTime(new Date(Date.now() + 21 * 60_000));
    const segunda = await runSentinelaVacuo();

    expect(enviados).toHaveLength(1);
    expect(segunda.motivo).toBe('todas_ja_cobradas');
  });
});

describe('represa da varredura', () => {
  it('chamada de minuto em minuto não varre de minuto em minuto', async () => {
    db.wa = [msg('5534999990013', false, Date.now() - 6 * 3600_000)];

    const primeira = await runSentinelaVacuo();
    const segunda = await runSentinelaVacuo();

    expect(primeira.cobrancas).toBe(1);
    expect(segunda.motivo).toBe('varrido_agora_pouco');
  });

  it('passados os 20 minutos, varre de novo', async () => {
    db.wa = [msg('5534999990014', false, Date.now() - 6 * 3600_000)];
    await runSentinelaVacuo();

    vi.setSystemTime(new Date(Date.now() + 21 * 60_000));
    const depois = await runSentinelaVacuo();

    // Varreu (não é 'varrido_agora_pouco'); a pessoa já foi cobrada no nível 1,
    // então o resultado certo é "todas já cobradas", não uma segunda cobrança.
    expect(depois.motivo).toBe('todas_ja_cobradas');
  });
});
