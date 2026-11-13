import { describe, it, expect, vi, beforeEach } from 'vitest';

// Os avisos da Helena ao consultor (12/11/2026): o aviso na marcação e o resumo do dia. Banco em memória, Z-API e as guardas da
// linha simuladas. Nomes, telefones e ids inventados.

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  main: { system_state: [] as Row[] } as Record<string, Row[]>,
  ger: { agendamentos: [] as Row[] } as Record<string, Row[]>,
  enviados: [] as Array<{ tel: string; texto: string }>,
  falhaNoEnvio: false,
  linhaLivre: 'sim' as 'sim' | 'nao',
  cabe: true,
  errosContados: [] as unknown[],
  zerados: 0,
  consultores: new Map<string, string>(),
  leituraDosCelularesFalha: false,
  antesDoUpdate: null as null | (() => void),
}));

function fabrica(base: Record<string, Row[]>) {
  return (tabela: string) => {
    const st = { op: 'select', filtros: [] as Array<(r: Row) => boolean>, ordem: [] as Array<[string, boolean]>, lim: Infinity, corpo: null as any, or: null as string | null };
    const linhas = () => (base[tabela] ??= []);
    const casa = (p: string, v: unknown) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(String(v ?? ''));
    const valor = (r: Row, c: string): unknown => (c.includes('->>') ? (r[c.split('->>')[0]!] ?? {})[c.split('->>')[1]!] : r[c]);
    const executar = () => {
      if (st.op === 'insert') {
        if (linhas().some(x => x.key === st.corpo.key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        linhas().push({ ...st.corpo });
        return { data: null, error: null };
      }
      if (st.op === 'upsert') {
        for (const n of (Array.isArray(st.corpo) ? st.corpo : [st.corpo]) as Row[]) {
          const i = linhas().findIndex(x => x.key === n.key);
          if (i >= 0) linhas()[i] = { ...n }; else linhas().push({ ...n });
        }
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        h.antesDoUpdate?.();
        const tocadas = linhas().filter(x => st.filtros.every(f => f(x)));
        for (const r of tocadas) Object.assign(r, st.corpo);
        return { data: tocadas.map(x => ({ ...x })), error: null };
      }
      const padroes = st.or ? [...st.or.matchAll(/key\.like\.([^,]+)/g)].map(m => m[1]!) : null;
      let r = linhas().filter(x => st.filtros.every(f => f(x)) && (!padroes || padroes.some(p => casa(p, x.key))));
      for (const [c, asc] of [...st.ordem].reverse()) r = [...r].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      return { data: r.slice(0, st.lim).map(x => ({ ...x })), error: null };
    };
    const q: any = {
      select: () => q,
      insert: (c: any) => { st.op = 'insert'; st.corpo = c; return q; },
      upsert: (c: any) => { st.op = 'upsert'; st.corpo = c; return q; },
      update: (c: any) => { st.op = 'update'; st.corpo = c; return q; },
      eq: (c: string, v: unknown) => { st.filtros.push(r => valor(r, c) === v); return q; },
      in: (c: string, vs: unknown[]) => { st.filtros.push(r => vs.map(String).includes(String(valor(r, c)))); return q; },
      like: (c: string, p: string) => { st.filtros.push(r => casa(p, r[c])); return q; },
      or: (e: string) => { st.or = e; return q; },
      gte: (c: string, v: any) => { st.filtros.push(r => r[c] >= v); return q; },
      lt: (c: string, v: any) => { st.filtros.push(r => r[c] < v); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { st.ordem.push([c, o?.ascending !== false]); return q; },
      limit: (n: number) => { st.lim = n; return q; },
      maybeSingle: async () => { const r = executar(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, ko),
    };
    return q;
  };
}

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => fabrica(h.main)(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => fabrica(h.ger)(t) } }));
vi.mock('../services/agents/zapiClient', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendWhatsApp: vi.fn(async (tel: string, texto: string) => {
    if (h.falhaNoEnvio) throw new Error('[zapi:io] HTTP 500');
    h.enviados.push({ tel, texto });
  }),
}));
vi.mock('../services/agentes5040/guardaDaLinha', () => ({
  linhaLivre: vi.fn(async () => h.linhaLivre),
  contarErroDaLinha: vi.fn(async (_a: Date, e: unknown) => { h.errosContados.push(e); }),
  zerarErrosDaLinha: vi.fn(async () => { h.zerados++; }),
}));
vi.mock('../services/io/jornadaMensagensBase', () => ({ cabeNaLinha: vi.fn(async () => h.cabe) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: vi.fn(async () => (h.leituraDosCelularesFalha ? { ok: false, codigo: 'interno' } : { ok: true, mapa: h.consultores })),
  telefoneDoConsultor: (mapa: Map<string, string>, nome: string) => mapa.get(String(nome ?? '').trim().toLowerCase()) ?? null,
}));

import {
  avisarMarcacao, rodarAvisosDaEquipe, enviarResumoDoDia, iniciarRodadaDeAvisos,
  PREFIXO_AVISO_MARCADA, PREFIXO_AVISO_DIA, CARIMBO_MARCADA, CARIMBO_DIA, RESERVA_DA_FICHA,
} from '../services/io/investidorAgenteAvisos';
import { conferirAntesDoAviso } from '../services/io/investidorAgenteAvisosLinha';
import { textoAvisoMarcada, textoResumoDoDia, fatosDoAviso, LINK_DA_ABA_HELENA } from '../services/io/investidorAgenteAvisosTextos';

const AGORA = new Date('2026-11-13T11:00:00Z');                 // sexta, 08:00 em Brasília
const REUNIAO = '2026-11-14T13:00:00Z';                          // sábado, 10h em Brasília
const TEL_THIAGO = '5534999990001';
const TEL_DIEGO = '5534999990002';
const sorteio0 = () => 0;
const estado = (key: string): Row | undefined => h.main.system_state!.find(r => r.key === key);
const semear = (key: string, value: Row = {}, updated_at = new Date(AGORA.getTime() - 3_600_000 * 5).toISOString()) => { h.main.system_state!.push({ key, value, updated_at }); };
const marcacao = (extra: Record<string, unknown> = {}) => ({
  comPreparo: true, cardId: 7001, iso: REUNIAO, consultor: 'Thiago', nome: 'Cliente Exemplo', tipo: 'investidor' as const,
  cidade: 'Cidade Exemplo', dados: { valor_confirmado: 'R$ 200 mil', tem_ponto: 'Terreno na avenida' }, ...extra,
});
const cardDoDia = (id: number, quando: string, dono = 'Thiago', extra: Row = {}) =>
  ({ id, vendedor_nome: dono, quando, status: 'agendado', created_by: 'agente_eletroposto', cliente_nome: `Cliente ${id}`, cidade: 'Cidade Exemplo', ...extra });

beforeEach(() => {
  h.main.system_state = []; h.ger.agendamentos = [];
  h.enviados.length = 0; h.falhaNoEnvio = false; h.linhaLivre = 'sim'; h.cabe = true; h.errosContados.length = 0; h.zerados = 0;
  h.consultores = new Map([['thiago', TEL_THIAGO], ['diego', TEL_DIEGO]]); h.antesDoUpdate = null; h.leituraDosCelularesFalha = false;
  iniciarRodadaDeAvisos();
});

describe('o aviso na marcação', () => {
  it('SÓ com o preparo em andamento: sem preparo não envia, não reserva trava e não carimba (a ficha sai na hora)', async () => {
    expect(await avisarMarcacao(marcacao({ comPreparo: false }), AGORA, sorteio0)).toBe('nada');
    expect(h.enviados).toEqual([]);
    expect(h.main.system_state).toEqual([]);
  });

  it('com preparo: 1 bolha ao celular do dono (nunca ao do dono da casa), link na última linha, trava enviado e carimbo na linha', async () => {
    expect(await avisarMarcacao(marcacao(), AGORA, sorteio0)).toBe('enviado');
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]!.tel).toBe(TEL_THIAGO);
    const texto = h.enviados[0]!.texto;
    expect(texto.split('\n').pop()).toBe(LINK_DA_ABA_HELENA);
    expect(texto).toContain('Oi, Thiago, a Helena marcou uma reunião para você.');
    expect(texto).toContain('*Da conversa:* R$ 200 mil; Terreno na avenida');
    expect(texto.length).toBeLessThanOrEqual(1200);
    expect(estado(`${PREFIXO_AVISO_MARCADA}7001:${REUNIAO}`)!.value).toMatchObject({ estado: 'enviado' });
    expect(estado(`${CARIMBO_MARCADA}7001`)).toBeDefined();
    expect(h.zerados).toBe(1);
  });

  it('a trava impede repetir: o mesmo card no mesmo horário nunca avisa duas vezes', async () => {
    await avisarMarcacao(marcacao(), AGORA, sorteio0);
    h.enviados.length = 0; iniciarRodadaDeAvisos();
    expect(await avisarMarcacao(marcacao(), new Date(AGORA.getTime() + 600_000), sorteio0)).toBe('nada');
    expect(h.enviados).toEqual([]);
  });

  it('o que não cabe fica pendente (nada sai, a trava existe): linha pausada, 40 na hora, 6 em 10 min e o espaço de 25 s', async () => {
    h.linhaLivre = 'nao';
    expect(await avisarMarcacao(marcacao({ cardId: 1 }), AGORA, sorteio0)).toBe('pendente');
    h.linhaLivre = 'sim'; h.cabe = false;
    expect(await avisarMarcacao(marcacao({ cardId: 2 }), AGORA, sorteio0)).toBe('pendente');
    h.cabe = true;
    const soAsTravas = () => { h.main.system_state = h.main.system_state.filter(r => String(r.key).startsWith(PREFIXO_AVISO_MARCADA)); };
    for (let i = 0; i < 6; i++) semear(`inv_agente_sent:x${i}`, {}, new Date(AGORA.getTime() - 120_000 - i * 1000).toISOString());
    expect(await avisarMarcacao(marcacao({ cardId: 3 }), AGORA, sorteio0)).toBe('pendente');
    soAsTravas();
    semear('ficha_lead:helena:9', {}, new Date(AGORA.getTime() - 10_000).toISOString());
    expect(await avisarMarcacao(marcacao({ cardId: 4 }), AGORA, sorteio0)).toBe('pendente');
    // O sorteio de 0 a 35 s soma ao piso de 25 s: com 40 s de folga e o sorteio no máximo, ainda espera.
    soAsTravas();
    semear('ficha_lead:helena:9', {}, new Date(AGORA.getTime() - 40_000).toISOString());
    expect(await avisarMarcacao(marcacao({ cardId: 5 }), AGORA, () => 0.99)).toBe('pendente');
    expect(h.enviados).toEqual([]);
    for (const id of [1, 2, 4, 5]) expect(estado(`${PREFIXO_AVISO_MARCADA}${id}:${REUNIAO}`)!.value).toMatchObject({ estado: 'pendente' });
  });

  it('dono sem celular cadastrado: não envia (nunca cai no telefone do dono da casa) e a trava fica pendente', async () => {
    expect(await avisarMarcacao(marcacao({ consultor: 'Giovanna' }), AGORA, sorteio0)).toBe('pendente');
    expect(h.enviados).toEqual([]);
  });

  it('erro de envio: contarErroDaLinha, a trava volta a pendente e a mesma rodada não tenta de novo', async () => {
    h.falhaNoEnvio = true;
    expect(await avisarMarcacao(marcacao({ cardId: 11 }), AGORA, sorteio0)).toBe('pendente');
    expect(h.errosContados).toHaveLength(1);
    expect(estado(`${PREFIXO_AVISO_MARCADA}11:${REUNIAO}`)!.value).toMatchObject({ estado: 'pendente' });
    h.falhaNoEnvio = false;
    expect(await avisarMarcacao(marcacao({ cardId: 12 }), AGORA, sorteio0)).toBe('pendente');
    expect(h.enviados).toEqual([]);
    // Rodada seguinte: o pendente sai (o card existe e segue igual).
    iniciarRodadaDeAvisos();
    h.ger.agendamentos = [cardDoDia(11, REUNIAO, 'Thiago')];
    const depois = new Date(AGORA.getTime() + 300_000);
    expect(await rodarAvisosDaEquipe(depois, sorteio0)).toMatchObject({ marcada: 1 });
    expect(h.enviados).toHaveLength(1);
    expect(estado(`${PREFIXO_AVISO_MARCADA}11:${REUNIAO}`)!.value).toMatchObject({ estado: 'enviado' });
  });
});

describe('os pendentes numa rodada seguinte', () => {
  const pendente = (cardId: number, extra: Row = {}) => semear(`${PREFIXO_AVISO_MARCADA}${cardId}:${REUNIAO}`, {
    estado: 'pendente', card: cardId, quando: REUNIAO, consultor: 'Thiago', nome: 'Cliente Exemplo', tipo: 'investidor', cidade: 'Cidade Exemplo', fatos: ['R$ 200 mil'], ...extra,
  });

  it('se a ficha do preparo saiu antes (reserva ficha_helena:<card>), o pendente morre sem enviar', async () => {
    pendente(21); semear(`${RESERVA_DA_FICHA}21`);
    h.ger.agendamentos = [cardDoDia(21, REUNIAO, 'Thiago')];
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    expect(h.enviados).toEqual([]);
    expect(estado(`${PREFIXO_AVISO_MARCADA}21:${REUNIAO}`)!.value).toMatchObject({ estado: 'descartado' });
  });

  it('card remarcado, cancelado ou de outro dono: o pendente morre', async () => {
    pendente(22); pendente(23); pendente(24);
    h.ger.agendamentos = [
      cardDoDia(22, '2026-11-15T13:00:00Z', 'Thiago'), cardDoDia(23, REUNIAO, 'Thiago', { status: 'cancelado' }), cardDoDia(24, REUNIAO, 'Diego'),
    ];
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    expect(h.enviados).toEqual([]);
    for (const id of [22, 23, 24]) expect(estado(`${PREFIXO_AVISO_MARCADA}${id}:${REUNIAO}`)!.value).toMatchObject({ estado: 'descartado' });
  });

  it('no máximo UM aviso por rodada: dois pendentes saem em duas rodadas, o mais antigo primeiro', async () => {
    pendente(31); pendente(32);
    h.ger.agendamentos = [cardDoDia(31, REUNIAO, 'Thiago'), cardDoDia(32, REUNIAO, 'Thiago')];
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    expect(h.enviados).toHaveLength(1);
    await rodarAvisosDaEquipe(AGORA, sorteio0);        // a mesma rodada: nada
    expect(h.enviados).toHaveLength(1);
    iniciarRodadaDeAvisos();
    await rodarAvisosDaEquipe(new Date(AGORA.getTime() + 300_000), sorteio0);
    expect(h.enviados).toHaveLength(2);
  });

  it('a marcação vai antes do resumo: com um pendente esperando a linha, o resumo não passa na frente', async () => {
    pendente(41);
    h.ger.agendamentos = [cardDoDia(41, REUNIAO, 'Thiago'), cardDoDia(42, '2026-11-13T15:00:00Z')];
    h.linhaLivre = 'nao';
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    h.linhaLivre = 'sim';
    expect(h.enviados).toEqual([]);
    expect(h.main.system_state.some(r => String(r.key).startsWith(PREFIXO_AVISO_DIA))).toBe(false);
  });
});

describe('o resumo do dia', () => {
  it('antes das 7h30 de Brasília não sai (07:29 não, 07:30 sim)', async () => {
    h.ger.agendamentos = [cardDoDia(51, '2026-11-13T15:00:00Z')];
    expect(await enviarResumoDoDia(new Date('2026-11-13T10:29:00Z'), sorteio0)).toMatchObject({ enviados: 0, motivo: 'antes_das_7h30' });
    expect(h.enviados).toEqual([]);
    expect(await enviarResumoDoDia(new Date('2026-11-13T10:30:00Z'), sorteio0)).toMatchObject({ enviados: 1 });
  });

  it('singular com uma reunião e plural com duas, em ordem de horário; trava, carimbo e nada de repetir', async () => {
    h.ger.agendamentos = [
      cardDoDia(61, '2026-11-13T17:30:00Z'), cardDoDia(62, '2026-11-13T14:00:00Z'), cardDoDia(63, '2026-11-13T15:00:00Z', 'Diego'),
    ];
    expect(await enviarResumoDoDia(AGORA, sorteio0)).toMatchObject({ enviados: 1 });
    const thiago = h.enviados.find(e => e.tel === TEL_THIAGO)!;
    expect(thiago.texto).toContain('*REUNIÕES DE HOJE*');
    expect(thiago.texto).toContain('Você tem 2 reuniões marcadas pela Helena hoje.');
    expect(thiago.texto.indexOf('Às 11h:')).toBeLessThan(thiago.texto.indexOf('Às 14h30:'));
    expect(estado(`${PREFIXO_AVISO_DIA}thiago:2026-11-13`)!.value).toMatchObject({ estado: 'enviado' });
    expect(estado(`${CARIMBO_DIA}thiago:2026-11-13`)).toBeDefined();
    // O Diego sai na rodada seguinte (1 aviso por rodada), no singular; o do Thiago não repete.
    iniciarRodadaDeAvisos();
    await enviarResumoDoDia(new Date(AGORA.getTime() + 300_000), sorteio0);
    const diego = h.enviados.find(e => e.tel === TEL_DIEGO)!;
    expect(diego.texto).toContain('*REUNIÃO DE HOJE*');
    expect(diego.texto).toContain('Você tem 1 reunião marcada pela Helena hoje.');
    iniciarRodadaDeAvisos();
    await enviarResumoDoDia(new Date(AGORA.getTime() + 600_000), sorteio0);
    expect(h.enviados).toHaveLength(2);
  });

  it('depois da primeira reunião do dono o resumo é descartado (é aviso, não agenda)', async () => {
    h.ger.agendamentos = [cardDoDia(71, '2026-11-13T11:30:00Z'), cardDoDia(72, '2026-11-13T15:00:00Z')];
    expect(await enviarResumoDoDia(new Date('2026-11-13T11:45:00Z'), sorteio0)).toMatchObject({ enviados: 0 });
    expect(h.enviados).toEqual([]);
    expect(estado(`${PREFIXO_AVISO_DIA}thiago:2026-11-13`)!.value).toMatchObject({ estado: 'descartado' });
  });

  it('tira o card cuja marcação já foi avisada hoje (trava de hoje ou ficha enviada hoje)', async () => {
    h.ger.agendamentos = [cardDoDia(81, '2026-11-13T15:00:00Z'), cardDoDia(82, '2026-11-13T16:00:00Z'), cardDoDia(83, '2026-11-13T17:00:00Z')];
    semear(`${PREFIXO_AVISO_MARCADA}81:2026-11-13T15:00:00Z`, { estado: 'enviado' }, '2026-11-13T09:00:00Z');
    semear(`${RESERVA_DA_FICHA}82`, {}, '2026-11-13T09:30:00Z');
    await enviarResumoDoDia(AGORA, sorteio0);
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]!.texto).toContain('Você tem 1 reunião marcada');
    expect(h.enviados[0]!.texto).toContain('Cliente 83');
    expect(h.enviados[0]!.texto).not.toContain('Cliente 81');
    expect(h.enviados[0]!.texto).not.toContain('Cliente 82');
  });

  it('dono sem celular cadastrado é pulado e o aviso da rodada vai para o próximo; o telefone do dono da casa nunca entra', async () => {
    h.ger.agendamentos = [cardDoDia(91, '2026-11-13T12:00:00Z', 'Giovanna'), cardDoDia(92, '2026-11-13T15:00:00Z', 'Diego')];
    await enviarResumoDoDia(AGORA, sorteio0);
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]!.tel).toBe(TEL_DIEGO);
    expect(estado(`${PREFIXO_AVISO_DIA}giovanna:2026-11-13`)).toBeUndefined();
  });

  it('só os cards que a Helena marcou e que seguem agendados entram (a leitura filtra por origem e status)', async () => {
    h.ger.agendamentos = [cardDoDia(101, '2026-11-13T15:00:00Z', 'Thiago', { created_by: 'lp_eletroposto' }), cardDoDia(102, '2026-11-13T15:00:00Z', 'Thiago', { status: 'cancelado' })];
    expect(await enviarResumoDoDia(AGORA, sorteio0)).toMatchObject({ enviados: 0, motivo: 'sem_reuniao_hoje' });
  });

  it('erro de envio no resumo: a trava fica pendente e sai numa rodada seguinte', async () => {
    h.ger.agendamentos = [cardDoDia(111, '2026-11-13T15:00:00Z')];
    h.falhaNoEnvio = true;
    expect(await enviarResumoDoDia(AGORA, sorteio0)).toMatchObject({ enviados: 0, motivo: 'pendente' });
    expect(h.errosContados).toHaveLength(1);
    expect(estado(`${PREFIXO_AVISO_DIA}thiago:2026-11-13`)!.value).toMatchObject({ estado: 'pendente' });
    h.falhaNoEnvio = false; iniciarRodadaDeAvisos();
    expect(await enviarResumoDoDia(new Date(AGORA.getTime() + 300_000), sorteio0)).toMatchObject({ enviados: 1 });
  });
});

describe('os pendentes: dono sem celular, card que sumiu e rodadas cruzadas', () => {
  const pendente = (cardId: number, consultor = 'Thiago') => semear(`${PREFIXO_AVISO_MARCADA}${cardId}:${REUNIAO}`, {
    estado: 'pendente', card: cardId, quando: REUNIAO, consultor, nome: 'Cliente Exemplo', tipo: 'investidor', cidade: 'Cidade Exemplo', fatos: [],
  });

  it('dono sem celular vira descartado (sem_celular) e NÃO prende o pendente de trás, que sai na mesma rodada', async () => {
    pendente(201, 'Giovanna'); pendente(202, 'Thiago');
    h.ger.agendamentos = [cardDoDia(201, REUNIAO, 'Giovanna'), cardDoDia(202, REUNIAO, 'Thiago')];
    expect(await rodarAvisosDaEquipe(AGORA, sorteio0)).toMatchObject({ marcada: 1 });
    expect(estado(`${PREFIXO_AVISO_MARCADA}201:${REUNIAO}`)!.value).toMatchObject({ estado: 'descartado', motivo: 'sem_celular' });
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]!.tel).toBe(TEL_THIAGO);
    expect(estado(`${CARIMBO_MARCADA}201`)).toBeUndefined();
  });

  it('a leitura dos celulares FALHOU: a trava continua pendente (não vira sem_celular) e o pendente de trás não fica preso, mas sem celular não sai nada', async () => {
    pendente(211, 'Thiago'); pendente(212, 'Diego');
    h.ger.agendamentos = [cardDoDia(211, REUNIAO, 'Thiago'), cardDoDia(212, REUNIAO, 'Diego')];
    h.leituraDosCelularesFalha = true;
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    expect(h.enviados).toEqual([]);
    for (const id of [211, 212]) expect(estado(`${PREFIXO_AVISO_MARCADA}${id}:${REUNIAO}`)!.value).toMatchObject({ estado: 'pendente' });
    // A lista volta: sai na rodada seguinte.
    h.leituraDosCelularesFalha = false; iniciarRodadaDeAvisos();
    await rodarAvisosDaEquipe(new Date(AGORA.getTime() + 300_000), sorteio0);
    expect(h.enviados).toHaveLength(1);
  });

  it('o resumo com a leitura dos celulares falhando fica sem trava e sem envio; com a lista lida e dono sem celular, também pula', async () => {
    h.ger.agendamentos = [cardDoDia(221, '2026-11-13T15:00:00Z', 'Thiago')];
    h.leituraDosCelularesFalha = true;
    await enviarResumoDoDia(AGORA, sorteio0);
    expect(h.enviados).toEqual([]);
    expect(estado(`${PREFIXO_AVISO_DIA}thiago:2026-11-13`)).toBeUndefined();
    h.leituraDosCelularesFalha = false; iniciarRodadaDeAvisos();
    await enviarResumoDoDia(new Date(AGORA.getTime() + 300_000), sorteio0);
    expect(h.enviados).toHaveLength(1);
  });

  it('pendente de um card que não existe mais vira descartado na rodada seguinte: sem envio e sem carimbo', async () => {
    pendente(301);
    h.ger.agendamentos = [];
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    expect(h.enviados).toEqual([]);
    expect(estado(`${PREFIXO_AVISO_MARCADA}301:${REUNIAO}`)!.value).toMatchObject({ estado: 'descartado' });
    expect(estado(`${CARIMBO_MARCADA}301`)).toBeUndefined();
  });

  it('rodadas cruzadas: a trava passa de pendente para enviando por update condicional, e quem chega depois não manda', async () => {
    pendente(401);
    h.ger.agendamentos = [cardDoDia(401, REUNIAO, 'Thiago')];
    // A outra rodada pega a trava entre a leitura do pendente e o envio desta.
    h.antesDoUpdate = () => { estado(`${PREFIXO_AVISO_MARCADA}401:${REUNIAO}`)!.value = { estado: 'enviando' }; };
    await rodarAvisosDaEquipe(AGORA, sorteio0);
    expect(h.enviados).toEqual([]);
    // Sem corrida: o pendente vira enviando e depois enviado, uma vez só.
    h.antesDoUpdate = null; iniciarRodadaDeAvisos();
    estado(`${PREFIXO_AVISO_MARCADA}401:${REUNIAO}`)!.value = { estado: 'pendente', card: 401, quando: REUNIAO, consultor: 'Thiago', nome: 'Cliente Exemplo', tipo: 'investidor', cidade: 'Cidade Exemplo', fatos: [] };
    await rodarAvisosDaEquipe(new Date(AGORA.getTime() + 300_000), sorteio0);
    expect(h.enviados).toHaveLength(1);
    expect(estado(`${PREFIXO_AVISO_MARCADA}401:${REUNIAO}`)!.value).toMatchObject({ estado: 'enviado' });
  });
});

describe('as conferências antes de cada envio', () => {
  it('a conta das 6 proativas e dos 25 s inclui a Jornada, o quiz solar e o grupo do SolarDoc', async () => {
    for (const prefixo of ['jornada_env:', 'solar_quiz_env:', 'solardoc_aviso_sent:']) {
      h.main.system_state = [];
      semear(`${prefixo}x`, {}, new Date(AGORA.getTime() - 10_000).toISOString());
      expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: false, motivo: 'espacamento' });
    }
    h.main.system_state = [];
    for (let i = 0; i < 6; i++) semear(i % 2 ? 'jornada_env:y' + i : 'solardoc_aviso_sent:y' + i, {}, new Date(AGORA.getTime() - 200_000 - i * 1000).toISOString());
    expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: false, motivo: 'proativas_em_10_min' });
  });
});

describe('as conferências, uma a uma', () => {
  it('linha livre, menos de 40 na hora, menos de 6 proativas em 10 min e 25 s mais o sorteio, nesta ordem', async () => {
    expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: true });
    h.linhaLivre = 'nao';
    expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: false, motivo: 'linha_pausada' });
    h.linhaLivre = 'sim'; h.cabe = false;
    expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: false, motivo: 'linha_cheia_na_hora' });
    h.cabe = true;
    for (let i = 0; i < 6; i++) semear(`inv_agente_sent:y${i}`, {}, new Date(AGORA.getTime() - 200_000 - i * 1000).toISOString());
    expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: false, motivo: 'proativas_em_10_min' });
    h.main.system_state = [];
    semear('ficha_lead:helena:marcada:1', {}, new Date(AGORA.getTime() - 20_000).toISOString());
    expect(await conferirAntesDoAviso(AGORA, sorteio0)).toEqual({ ok: false, motivo: 'espacamento' });
    expect(await conferirAntesDoAviso(new Date(AGORA.getTime() + 10_000), sorteio0)).toEqual({ ok: true });
  });
});

describe('os textos', () => {
  const base = { consultor: 'Thiago', nome: 'Cliente Exemplo', tipo: 'Investidor', cidade: 'Cidade Exemplo', quando: REUNIAO, fatos: ['R$ 200 mil', 'Terreno'] };
  it('aviso: link na última linha, linha sem dado some inteira, com um fato só a linha não leva ponto e vírgula', () => {
    const t = textoAvisoMarcada({ ...base, cidade: '', fatos: ['R$ 200 mil'] }, AGORA.toISOString());
    expect(t).not.toContain('*Cidade:*');
    expect(t).toContain('*Da conversa:* R$ 200 mil\n');
    expect(t).toContain('*Quando:* amanhã, sábado, 14/11, às 10h');
    expect(textoAvisoMarcada({ ...base, fatos: [] }, AGORA.toISOString())).not.toContain('Da conversa');
    expect(t.split('\n').slice(-2)).toEqual(['A conversa está na aba Helena do /gerador:', LINK_DA_ABA_HELENA]);
  });
  it('resumo: hora "10h" ou "10h30", sem cidade a linha fecha no tipo sem vírgula sobrando', () => {
    const t = textoResumoDoDia('Thiago', [{ quando: '2026-11-13T13:00:00Z', nome: 'Cliente A', tipo: 'Investidor', cidade: '' }, { quando: '2026-11-13T13:30:00Z', nome: 'Cliente B', tipo: 'Parceiro', cidade: 'Cidade X' }]);
    expect(t).toContain('Às 10h: Cliente A, Investidor\n');
    expect(t).toContain('Às 10h30: Cliente B, Parceiro, Cidade X');
    expect(t).toContain('As conversas estão na aba Helena do /gerador.');
  });
  it('fatos por tipo: investidor (quanto, depois o local), arrendamento (tipo do local, espaço), parceiro, curioso; sem dado, lista vazia', () => {
    expect(fatosDoAviso('investidor', { valor_confirmado: 'R$ 1 mi', cidade: 'Cidade X' })).toEqual(['R$ 1 mi', 'Cidade X']);
    expect(fatosDoAviso('arrendamento', { tipo_local: 'Posto', tamanho_espaco: '6 vagas', bairro_local: 'x' })).toEqual(['Posto', '6 vagas']);
    expect(fatosDoAviso('parceiro', { atuacao: 'Instalador', regiao_atuacao: 'Triângulo' })).toEqual(['Instalador', 'Triângulo']);
    expect(fatosDoAviso('curioso', { duvidas: 'Quanto custa' })).toEqual(['Quanto custa']);
    expect(fatosDoAviso('investidor', {})).toEqual([]);
  });
});
