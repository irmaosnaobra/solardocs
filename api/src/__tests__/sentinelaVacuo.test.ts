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
  falhaUpsert: boolean;
} = {
  wa: [], sessoes: [], leads: [], state: [], erroNoState: false, falhaUpsert: false,
};

function builder(tabela: string) {
  const q: any = {
    _filtros: [] as Array<(r: any) => boolean>,
    _ordem: null as null | { col: string; asc: boolean },
    _teto: 0,
    select() { return q; },
    eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return q; },
    like(col: string, padrao: string) {
      const pref = padrao.replace(/%$/, '');
      q._filtros.push((r: any) => String(r[col] ?? '').startsWith(pref));
      return q;
    },
    gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
    // O mock ORDENA de verdade. Enquanto ele devolvia a ordem de inserção, o
    // teste não conseguia enxergar a diferença entre ler do mais novo pro mais
    // velho e o contrário — que foi exatamente o defeito de 18/09/2026.
    order(col: string, opts?: { ascending?: boolean }) {
      q._ordem = { col, asc: opts?.ascending !== false };
      return q;
    },
    // O corte é real: é ele, e não a ordem sozinha, que escondia as conversas.
    limit(n: number) { q._teto = n; return q; },
    maybeSingle() {
      const linhas = q._linhas();
      return Promise.resolve({ data: linhas[0] ?? null, error: null });
    },
    upsert(linha: any) {
      // A falha só vale pros carimbos de cobrança; a marca da varredura passa.
      if (db.falhaUpsert && String(linha.key).startsWith('vacuo_avisado:')) {
        return Promise.resolve({ error: { message: 'gravacao falhou' } });
      }
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
      const linhas = fonte.filter((r: any) => q._filtros.every((f: any) => f(r)));
      let saida = linhas;
      if (q._ordem) {
        const { col, asc } = q._ordem;
        saida = [...linhas].sort((a: any, b: any) => {
          const x = String(a[col] ?? ''); const y = String(b[col] ?? '');
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      return q._teto ? saida.slice(0, q._teto) : saida;
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

// Banco do Gerador (cards da agenda). Imita o que importa: `like '%cauda'`, a
// janela de `quando` e o corte do `limit`. `erroGerador` faz a consulta falhar.
// `travaCauda`: consulta cujo telefone termina assim nunca responde (simula timeout).
const agenda: { cards: any[]; erro: boolean; travaCauda: string | null } = { cards: [], erro: false, travaCauda: null };
function builderGerador() {
  const filtros: Array<(r: any) => boolean> = [];
  let teto = 0;
  let trava = false;
  const q: any = {
    select() { return q; },
    like(col: string, padrao: string) {
      const cauda = padrao.replace(/^%/, '');
      if (agenda.travaCauda && cauda === agenda.travaCauda) trava = true;
      filtros.push(r => String(r[col] ?? '').endsWith(cauda)); return q;
    },
    gte(col: string, v: string) { filtros.push(r => String(r[col]) >= v); return q; },
    lte(col: string, v: string) { filtros.push(r => String(r[col]) <= v); return q; },
    limit(n: number) { teto = n; return q; },
    then(res: any, rej: any) {
      if (trava) return new Promise(() => {}).then(res, rej);   // nunca resolve
      if (agenda.erro) return Promise.resolve({ data: null, error: { message: 'gerador fora do ar' } }).then(res, rej);
      const l = agenda.cards.filter(r => filtros.every(f => f(r)));
      return Promise.resolve({ data: teto ? l.slice(0, teto) : l, error: null }).then(res, rej);
    },
  };
  return q;
}
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => builderGerador() } }));

// `marcadores` = quantos carimbos vacuo_avisado existiam no banco NO INSTANTE do envio.
const enviados: Array<{ phone: string; texto: string; marcadores: number }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => {
    enviados.push({ phone, texto, marcadores: db.state.filter(r => r.key.startsWith('vacuo_avisado:')).length });
  }),
}));

const silenciados = new Set<string>();
vi.mock('../services/agents/whatsapp/silenciar', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/agents/whatsapp/silenciar')>();
  return { ...real, carregarSilenciados: vi.fn(async () => (p: string) => silenciados.has(real.chaveContato(p) || '')) };
});

import { runSentinelaVacuo, horasUteisEntre, montarResumo, dentroDoExpediente } from '../services/io/sentinelaVacuo';
import { logger } from '../utils/logger';
import { sendWhatsApp } from '../services/agents/zapiClient';

const INST = '3F26F6ECE67D72BB7FCA6244BF24326C';
const msg = (tel: string, from_me: boolean, quandoMs: number, texto = 'oi, queria um orçamento'): Msg => ({
  telefone: tel, from_me, texto, momment: new Date(quandoMs).toISOString(),
  chat_name: 'Cliente Teste', is_group: false, instancia: INST,
});

beforeEach(() => {
  db.wa = []; db.sessoes = []; db.leads = []; db.state = []; db.erroNoState = false; db.falhaUpsert = false;
  enviados.length = 0; silenciados.clear();
  agenda.cards = []; agenda.erro = false; agenda.travaCauda = null;
  vi.mocked(logger.warn).mockClear();
  vi.mocked(sendWhatsApp).mockClear();
  // A espera entre donos nasce zerada nos testes: eles não dormem. O teste da
  // espera injeta a sua própria (`opts.esperar`) com a env padrão.
  process.env.VACUO_ESPERA_DONOS_S = '0';
  process.env.VACUO_SORTEIO_DONOS_S = '0';
  process.env.ZAPI_INSTANCE_ID_IO = INST;
  delete process.env.VACUO_OFF;
  delete process.env.VACUO_DONO_DO_CARD_OFF;
  delete process.env.VACUO_MAX_MSGS;
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

    // Solar é da Nilce desde 24/10/2026 — o recado não pode cair sempre no Thiago.
    expect(r.cobrancas).toBeGreaterThanOrEqual(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].phone).toBe('34991516846');   // Nilce
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
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(db.state).toHaveLength(0);                 // nem carimbo de cobrança, nem marca de varredura
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

describe('a conversa mais recente não pode ficar de fora', () => {
  it('a leitura é do mais novo pro mais velho, e vale a ÚLTIMA fala de cada lado', async () => {
    // Em 18/09/2026 a consulta era crescente e a resposta vinha truncada: a
    // sentinela só via a fatia mais VELHA da semana e era cega pra quem escreveu
    // hoje. Aqui a conversa tem uma resposta nossa ANTIGA e uma fala dela
    // RECENTE: lendo do fim pro começo, ela continua esperando.
    const ontem = Date.parse('2026-09-15T13:00:00Z');
    const seis = Date.now() - 6 * 3600_000;
    db.wa = [
      msg('5534999990040', false, ontem, 'oi, tudo bem?'),
      msg('5534999990040', true, ontem + 60_000, 'respondi ontem'),
      msg('5534999990040', false, seis, 'e o orçamento?'),
    ];

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(1);
    expect(enviados[0].texto).toContain('e o orçamento?');
  });

  it('com a leitura truncada, quem escreveu HOJE continua sendo visto', async () => {
    // Este é o teste que prova o defeito de 18/09/2026. Com o teto em 3 e quatro
    // mensagens na janela, ler do mais VELHO pro mais novo devolve só as três
    // antigas e some com a conversa de hoje. Era exatamente isso que acontecia em
    // produção: 5.487 mensagens na semana e a sentinela enxergando até 17/09 17h.
    process.env.VACUO_MAX_MSGS = '3';
    const antigo = Date.parse('2026-09-15T13:00:00Z');
    db.wa = [
      msg('5534999990060', false, antigo, 'primeira de uma conversa velha'),
      msg('5534999990060', false, antigo + 1000, 'segunda'),
      msg('5534999990060', false, antigo + 2000, 'terceira'),
      msg('5534999990061', false, Date.now() - 6 * 3600_000, 'tenho um ponto comercial'),
    ];

    const r = await runSentinelaVacuo();

    const textos = enviados.map(e => e.texto).join('\n');
    expect(textos).toContain('tenho um ponto comercial');
    expect(r.cobrancas).toBeGreaterThanOrEqual(1);
  });

  it('a nossa resposta MAIS NOVA encerra, mesmo com fala antiga dela no meio', async () => {
    const ontem = Date.parse('2026-09-15T13:00:00Z');
    db.wa = [
      msg('5534999990041', false, ontem, 'oi'),
      msg('5534999990041', false, Date.now() - 7 * 3600_000, 'e o orçamento?'),
      msg('5534999990041', true, Date.now() - 6 * 3600_000, 'segue o orçamento'),
    ];

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(0);
  });
});

describe('a bolha de entrega da recepção não conta como resposta', () => {
  it('entregou e ninguém veio: continua sendo cobrança', async () => {
    // O caso do Cléber (17/09/2026): ele mandou o endereço do ponto e a bolha
    // "já já alguém responde" saiu no MESMO segundo. A regra crua lia isso como
    // atendido, e o lead mais quente do dia ficou invisível.
    const seis = Date.now() - 6 * 3600_000;
    db.wa = [msg('5534999990030', false, seis, 'Tenho excelente ponto comercial')];
    db.wa.push(msg('5534999990030', true, seis, 'Deixa eu chamar a pessoa certa pra te atender.'));
    db.sessoes = [{
      phone: '5534999990030', tipo: 'recepcao_io',
      lead_data: { produto: 'eletroposto', estado: 'entregue', entregue_em: new Date(seis).toISOString() },
    }];

    const r = await runSentinelaVacuo();

    // Uma conversa parada, e ela é de eletroposto: o recado vai pro Thiago E pro
    // Diego, que são os dois donos do produto. Por isso dois envios pra uma parada.
    expect(r.paradas).toBe(1);
    expect(r.avisados.sort()).toEqual(['diego', 'thiago']);
    expect(enviados).toHaveLength(2);
  });

  it('gente respondeu DEPOIS da entrega: aí sim está atendido', async () => {
    const seis = Date.now() - 6 * 3600_000;
    db.wa = [
      msg('5534999990031', false, seis, 'Tenho excelente ponto comercial'),
      msg('5534999990031', true, seis, 'Deixa eu chamar a pessoa certa pra te atender.'),
      msg('5534999990031', true, seis + 30 * 60_000, 'Oi! Aqui é o Thiago, vamos conversar'),
    ];
    db.sessoes = [{
      phone: '5534999990031', tipo: 'recepcao_io',
      lead_data: { produto: 'eletroposto', estado: 'entregue', entregue_em: new Date(seis).toISOString() },
    }];

    const r = await runSentinelaVacuo();

    expect(r.cobrancas).toBe(0);
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

describe('dono do card da agenda', () => {
  const GIOVANNA = '34993396255';
  const THIAGO = '34991360223';
  const TEL = '5534999990070';                       // 55 + 34 + 9 + 99990070
  const emDias = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
  const card = (extra: Record<string, unknown> = {}) => ({
    cliente_telefone: '34999990070', vendedor_nome: 'Giovanna', created_by: 'cadastro_eletroposto',
    status: 'agendado', quando: emDias(2), ...extra,
  });
  const seis = () => Date.now() - 6 * 3600_000;

  it('níveis 1 e 2: o resumo vai só para a Giovanna, dona da reunião', async () => {
    agenda.cards = [card()];
    db.wa = [msg(TEL, false, seis())];
    const n1 = await runSentinelaVacuo();
    expect(n1.avisados).toEqual(['giovanna']);
    expect(enviados.map(e => e.phone)).toEqual([GIOVANNA]);

    // nível 2: terça 16h BRT até quarta 14h ≈ 9h úteis
    enviados.length = 0; db.state = [];
    db.wa = [msg(TEL, false, Date.parse('2026-09-15T19:00:00Z'))];
    const n2 = await runSentinelaVacuo();
    expect(n2.avisados).toEqual(['giovanna']);
    expect(enviados.map(e => e.phone)).toEqual([GIOVANNA]);
  });

  it('nível 3: Giovanna e Thiago, sem repetir nome', async () => {
    agenda.cards = [card({ vendedor_nome: 'Thiago' }), card({ vendedor_nome: 'Giovanna', quando: emDias(1) })];
    db.wa = [msg(TEL, false, Date.parse('2026-09-10T13:00:00Z'))];
    const r = await runSentinelaVacuo();
    expect(r.avisados.sort()).toEqual(['giovanna', 'thiago']);
    expect(enviados).toHaveLength(2);
  });

  it('nível 3 com card do próprio Thiago: um recado só', async () => {
    agenda.cards = [card({ vendedor_nome: 'Thiago' })];
    db.wa = [msg(TEL, false, Date.parse('2026-09-10T13:00:00Z'))];
    const r = await runSentinelaVacuo();
    expect(r.avisados).toEqual(['thiago']);
    expect(enviados).toHaveLength(1);
  });

  it.each([
    ['status fechado', { status: 'cancelado' }],
    ['status fechou', { status: 'fechou' }],
    ['card velho demais (fora da janela)', { quando: '2026-08-20T17:00:00.000Z' }],
    ['card distante demais (fora da janela)', { quando: '2026-12-31T17:00:00.000Z' }],
    ['vendedor desconhecido', { vendedor_nome: 'Fulano' }],
  ])('ignora o card: %s (destino de hoje, Thiago)', async (_nome, extra) => {
    agenda.cards = [card(extra as Record<string, unknown>)];
    db.wa = [msg(TEL, false, seis())];
    const r = await runSentinelaVacuo();
    expect(r.avisados).toEqual(['thiago']);
    expect(enviados.map(e => e.phone)).toEqual([THIAGO]);
    expect(enviados[0].texto).toContain('Sem produto definido');
  });

  it('vários cards: vale o de quando mais perto de agora', async () => {
    agenda.cards = [card({ vendedor_nome: 'Diego', quando: emDias(30) }), card({ vendedor_nome: 'Nilce', quando: emDias(1) })];
    db.wa = [msg(TEL, false, seis())];
    const r = await runSentinelaVacuo();
    expect(r.avisados).toEqual(['nilce']);
  });

  it('erro na consulta ao Gerador: destino de hoje e a rodada segue', async () => {
    agenda.cards = [card()];
    agenda.erro = true;
    db.wa = [msg(TEL, false, seis())];
    const r = await runSentinelaVacuo();
    expect(r.cobrancas).toBe(1);
    expect(r.avisados).toEqual(['thiago']);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('VACUO_DONO_DO_CARD_OFF=1: destino de hoje', async () => {
    process.env.VACUO_DONO_DO_CARD_OFF = '1';
    agenda.cards = [card()];
    db.wa = [msg(TEL, false, seis())];
    const r = await runSentinelaVacuo();
    expect(r.avisados).toEqual(['thiago']);
  });

  it("produto 'outro' com card de eletroposto: o rótulo vira Eletroposto", async () => {
    agenda.cards = [card()];
    db.wa = [msg(TEL, false, seis())];
    await runSentinelaVacuo();
    expect(enviados[0].texto).toContain('(Eletroposto)');
    expect(enviados[0].texto).not.toContain('Sem produto definido');
  });

  it('card que não é de eletroposto não muda o rótulo', async () => {
    agenda.cards = [card({ created_by: 'lp_solar' })];
    db.wa = [msg(TEL, false, seis())];
    await runSentinelaVacuo();
    expect(enviados[0].phone).toBe(GIOVANNA);
    expect(enviados[0].texto).toContain('Sem produto definido');
  });

  it('telefone com e sem o 9º dígito casa nos dois sentidos', async () => {
    // conversa COM o 9, card SEM o 9
    agenda.cards = [card({ cliente_telefone: '553499990070' })];
    db.wa = [msg(TEL, false, seis())];
    expect((await runSentinelaVacuo()).avisados).toEqual(['giovanna']);

    // conversa SEM o 9, card COM o 9
    enviados.length = 0; db.state = []; db.wa = [];
    agenda.cards = [card({ cliente_telefone: '5534999990070' })];
    db.wa = [msg('553499990070', false, seis())];
    expect((await runSentinelaVacuo()).avisados).toEqual(['giovanna']);
  });

  it('mesmos 8 dígitos finais em outro DDD não casa', async () => {
    agenda.cards = [card({ cliente_telefone: '11999990070' })];
    db.wa = [msg(TEL, false, seis())];
    expect((await runSentinelaVacuo()).avisados).toEqual(['thiago']);
  });

  it('dry devolve porDono (só números) e não envia nada', async () => {
    agenda.cards = [card()];
    db.wa = [msg(TEL, false, seis()), msg('5534999990071', false, seis())];
    const r = await runSentinelaVacuo({ dry: true });
    expect(r.motivo).toBe('cobraria_agora');
    expect(r.porDono).toEqual({ giovanna: 1, thiago: 1 });
    expect(enviados).toHaveLength(0);
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(db.state).toHaveLength(0);
  });

  it('card de ontem da Giovanna e reunião daqui a 3 dias da Nilce: vale a Nilce (futuro primeiro)', async () => {
    agenda.cards = [card({ vendedor_nome: 'Giovanna', quando: emDias(-1) }), card({ vendedor_nome: 'Nilce', quando: emDias(3) })];
    db.wa = [msg(TEL, false, seis())];
    expect((await runSentinelaVacuo()).avisados).toEqual(['nilce']);
  });

  it('sem futuro, vale o passado mais recente', async () => {
    agenda.cards = [card({ vendedor_nome: 'Diego', quando: emDias(-8) }), card({ vendedor_nome: 'Nilce', quando: emDias(-2) })];
    db.wa = [msg(TEL, false, seis())];
    expect((await runSentinelaVacuo()).avisados).toEqual(['nilce']);
  });

  it('entre dois futuros, vale o mais próximo', async () => {
    agenda.cards = [card({ vendedor_nome: 'Diego', quando: emDias(20) }), card({ vendedor_nome: 'Nilce', quando: emDias(2) })];
    db.wa = [msg(TEL, false, seis())];
    expect((await runSentinelaVacuo()).avisados).toEqual(['nilce']);
  });

  it('timeout num lote: os cards já achados valem e o aviso diz quantos telefones ficaram sem consulta', async () => {
    // 6 conversas = 2 lotes (5 + 1). O 6º telefone (o mais antigo, último da fila) nunca responde.
    const base = seis();
    const tels = [1, 2, 3, 4, 5, 6].map(n => `553499990${String(100 + n)}`);   // 55 34 9 9999 0xxx
    db.wa = tels.map((t, i) => msg(t, false, base - i * 1000));
    agenda.cards = tels.map(t => card({ cliente_telefone: t.slice(2) }));
    agenda.travaCauda = tels[5].slice(-8);

    const p = runSentinelaVacuo();
    await vi.advanceTimersByTimeAsync(11_000);
    const r = await p;

    expect(r.paradas).toBe(6);
    expect(r.avisados.sort()).toEqual(['giovanna', 'thiago']);   // 5 com dono do card, 1 no destino de hoje
    const doCard = enviados.find(e => e.phone === GIOVANNA)!;
    expect(doCard.texto).toContain('5 pessoas esperando');
    const aviso = vi.mocked(logger.warn).mock.calls.map(c => String(c[1])).find(m => m.includes('sem consulta'));
    expect(aviso).toContain('1 de 6 telefone(s) ficaram sem consulta');
  });

  // ── Envio: estado primeiro, espera entre donos ──
  const TELS = ['5534999990081', '5534999990082'];
  it('com 2 donos: marcadores de TODAS as cobranças antes do 1º envio e a espera é chamada 1 vez, entre os dois', async () => {
    agenda.cards = [
      { cliente_telefone: '34999990081', vendedor_nome: 'Giovanna', created_by: 'cadastro_eletroposto', status: 'agendado', quando: new Date(Date.now() + 86400_000).toISOString() },
      { cliente_telefone: '34999990082', vendedor_nome: 'Nilce', created_by: 'cadastro_eletroposto', status: 'agendado', quando: new Date(Date.now() + 86400_000).toISOString() },
    ];
    db.wa = TELS.map((t, i) => msg(t, false, Date.now() - 6 * 3600_000 - i * 1000));
    const esperas: Array<{ ms: number; enviadosAteAli: number }> = [];
    delete process.env.VACUO_ESPERA_DONOS_S;
    delete process.env.VACUO_SORTEIO_DONOS_S;

    const r = await runSentinelaVacuo({ esperar: async (ms) => { esperas.push({ ms, enviadosAteAli: enviados.length }); } });

    expect(r.cobrancas).toBe(2);
    expect(enviados).toHaveLength(2);
    // Cada conversa cobrada no nível 1 = 1 carimbo; os 2 já existiam no 1º envio.
    expect(enviados[0].marcadores).toBe(2);
    expect(esperas).toHaveLength(1);
    expect(esperas[0].enviadosAteAli).toBe(1);                       // depois do 1º envio, antes do 2º
    expect(esperas[0].ms).toBeGreaterThanOrEqual(25_000);
    expect(esperas[0].ms).toBeLessThanOrEqual(45_000);
  });

  it('com 1 dono só, a espera nunca é chamada', async () => {
    db.wa = [msg(TELS[0], false, Date.now() - 6 * 3600_000)];
    const esperar = vi.fn(async () => {});
    await runSentinelaVacuo({ esperar });
    expect(esperar).not.toHaveBeenCalled();
  });

  it('gravação dos marcadores falha: a rodada não envia nada', async () => {
    db.wa = [msg(TELS[0], false, Date.now() - 6 * 3600_000)];
    db.falhaUpsert = true;
    const r = await runSentinelaVacuo();
    expect(r.motivo).toBe('erro_gravando_marcadores');
    expect(r.cobrancas).toBe(0);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('dry com todas_ja_cobradas também devolve porDono', async () => {
    agenda.cards = [card()];
    db.wa = [msg(TEL, false, seis())];
    await runSentinelaVacuo();
    const r = await runSentinelaVacuo({ dry: true });
    expect(r.motivo).toBe('todas_ja_cobradas');
    expect(r.porDono).toEqual({ giovanna: 1 });
  });

  it('sem dry não devolve porDono', async () => {
    db.wa = [msg(TEL, false, seis())];
    expect((await runSentinelaVacuo()).porDono).toBeUndefined();
  });
});
