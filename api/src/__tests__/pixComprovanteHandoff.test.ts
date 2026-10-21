import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Comprovante REPROVADO de quem JÁ TEM CONTA: o contexto vai pra Giovanna de suporte.
//
// Antes saía uma frase fixa ("recebi, já te libero") que prometia o que o sistema não
// ia fazer. Agora: o motivo é gravado (handoff), a Giovanna responde pelo fluxo normal
// com um bloco no prompt, e o código trava o que o modelo não pode fazer sozinho:
//   · nada de [[ENVIAR_PIX]] fora do motivo "recebedor errado", e uma vez só;
//   · uma explicação por comprovante;
//   · do 3º reprovado em 24h, silêncio e um aviso ao Thiago.
// O modelo é simulado: o leitor devolve o JSON de cada fixture (leituras reais).
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let leitura: Row | null = null; // o que o "leitor" devolve neste teste
let falhaCriarConta = false; // simula erro (não 23505) ao criar a conta pendente
let falhaMarcaDoPedido = false; // simula erro (não 23505) ao gravar a marca do pedido de e-mail

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  let pendente: Row | null = null;
  let patch: Row | null = null;
  let onConflict = '';

  const linhas = () => (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'insert') {
      if (falhaCriarConta && table === 'users') {
        return { data: null, error: { code: 'XX000', message: 'banco fora' } };
      }
      if (falhaMarcaDoPedido && String(pendente!.key ?? '').startsWith('pix_pediu_email:')) {
        return { data: null, error: { code: 'XX000', message: 'banco fora' } };
      }
      // system_state.key e users.email são UNIQUE em produção; o fake respeita.
      const unica = table === 'system_state' ? 'key' : table === 'users' ? 'email' : null;
      if (unica && (db[table] ?? []).some((r) => r[unica] === pendente![unica])) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const nova = table === 'users' ? { id: `u${(db.users ?? []).length + 1}`, ...pendente! } : { ...pendente! };
      db[table] = [...(db[table] ?? []), nova];
      return { data: nova, error: null };
    }
    if (modo === 'upsert') {
      const existente = onConflict
        ? (db[table] ?? []).find((r) => r[onConflict] === pendente![onConflict])
        : undefined;
      if (existente) { Object.assign(existente, pendente); return { data: existente, error: null }; }
      db[table] = [...(db[table] ?? []), { ...pendente! }];
      return { data: pendente, error: null };
    }
    if (modo === 'delete') {
      const alvos = linhas();
      db[table] = (db[table] ?? []).filter((r) => !alvos.includes(r));
      return { data: alvos, error: null };
    }
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos, error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    insert: (row: Row) => { modo = 'insert'; pendente = row; return q; },
    upsert: (row: Row, opts?: { onConflict?: string }) => {
      modo = 'upsert'; pendente = row; onConflict = opts?.onConflict || ''; return q;
    },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
    neq: (col: string, val: any) => { filtros.push((r) => String(r[col]) !== String(val)); return q; },
    in: (col: string, vals: any[]) => { filtros.push((r) => vals.map(String).includes(String(r[col]))); return q; },
    // ilike do Postgres: `\_` e `\%` são literais, `_` e `%` sem barra são curingas.
    ilike: (col: string, padrao: string) => {
      const re = new RegExp('^' + padrao.replace(/\\(.)/g, (_m, c) => `\u0000${c.charCodeAt(0)}\u0000`)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
        .replace(/\u0000(\d+)\u0000/g, (_m, n) => '\\' + String.fromCharCode(Number(n))) + '$', 'i');
      filtros.push((r) => re.test(String(r[col] ?? '')));
      return q;
    },
    gte: (col: string, val: any) => { filtros.push((r) => String(r[col]) >= String(val)); return q; },
    not: (col: string, _op: string, val: any) => { filtros.push((r) => r[col] !== val); return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => {
      const { data, error } = executa();
      return { data: Array.isArray(data) ? data[0] ?? null : data, error };
    },
    single: async () => {
      const { data, error } = executa();
      return { data: Array.isArray(data) ? data[0] ?? null : data, error };
    },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify(leitura) }] }),
    },
  }),
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async () => {}),
  sendHuman: vi.fn(async () => {}),
  sendImage: vi.fn(async () => {}),
  sendDocument: vi.fn(async () => {}),
}));
vi.mock('../services/agents/whatsapp/biaInboundService', () => ({ ehLeadRecuperacao: vi.fn(async () => false) }));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({ podeFalarComLead: vi.fn(async () => ({ pode: true })) }));
vi.mock('../services/kitIntegradorService', () => ({ concederCursoPorAssinatura: vi.fn(async () => {}) }));

import { sendHuman, sendWhatsApp } from '../services/agents/zapiClient';
import { tryProcessPixComprovante } from '../services/agents/whatsapp/pixComprovanteService';
import { emBolhas } from '../services/agents/bolhas';
import { partesPixSobDemanda } from '../services/agents/whatsapp/pixSolicitado';
import { gerarPixCopiaECola } from '../utils/pixBrCode';
import {
  blocoComprovanteGiovanna, lerHandoffComprovante, temHandoffComprovante, pixDoHandoffPodeSair,
  type HandoffComprovante,
} from '../services/agents/whatsapp/comprovanteHandoff';

const IMG = { type: 'base64' as const, media_type: 'image/jpeg', data: 'AAAA' };
const TEL = '5534991112222';
const TEL_USERS = '34991112222';
const USER = { id: 'u1', email: 'leoimplant@gmail.com', plano: 'free' };

const LEO2 = {
  is_comprovante: true, valor: 27, recebedor_nome: 'Aioros Group Ltda', recebedor_documento: '63636043000188',
  data: '2026-10-19', id_transacao: 'E004169682026101919400uHT9pUwumly',
};
const AND3 = {
  is_comprovante: true, valor: 69.9, recebedor_nome: 'SEND CRISTTINY LIMA SANTOS DE A', recebedor_documento: '60453375000139',
  data: '2026-10-07', id_transacao: 'E607469482026100801I7A3980A7OMjI',
};

const enviadas = () => (sendHuman as any).mock.calls as any[][];
const avisosThiago = () => (sendWhatsApp as any).mock.calls.filter((c: any[]) => c[0] === '34991360223');
const handoff = () => db.system_state.find((r) => r.key === `pix_handoff:${TEL_USERS}`)?.value as HandoffComprovante | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T17:00:00Z'));
  db.system_state = []; db.wa_mensagens = [];
  db.users = [{ id: 'u1', email: USER.email, password_hash: 'h', reset_token: null, plano: 'free', billing_status: 'free', plano_expira_em: null, whatsapp: TEL_USERS }];
  leitura = null;
  (sendHuman as any).mockClear();
  (sendWhatsApp as any).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('conhecido: comprovante reprovado vai pra Giovanna', () => {
  it('Pix para terceiro: não manda frase fixa, grava o handoff, NÃO avisa o Thiago, false; o bloco traz o recebedor e proíbe dizer que liberou', async () => {
    leitura = AND3;

    const r = await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');

    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect(avisosThiago()).toHaveLength(0);
    const h = handoff()!;
    expect(h).toMatchObject({ codigo: 'recebedor', recebedor_ok: false, valor: 69.9, instancia: 'io' });
    const bloco = blocoComprovanteGiovanna(h);
    expect(bloco).toContain('SEND CRISTTINY LIMA SANTOS DE A');
    expect(bloco).toContain('63.636.043/0001-88');
    expect(bloco).toMatch(/NUNCA diga que liberou/);
    expect(bloco).toMatch(/UMA vez só/);
    expect(db.users[0]!.plano).toBe('free');
  });

  it('Aioros com valor fora de plano: handoff + Thiago avisado + false; o bloco manda escalar', async () => {
    leitura = { ...LEO2, valor: 31, id_transacao: 'E004169682026101919400AAAAAAAAAAA' };

    const r = await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');

    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect(handoff()).toMatchObject({ codigo: 'valor', recebedor_ok: true });
    const avisos = avisosThiago();
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0][1])).toContain('REVISAR');
    expect(blocoComprovanteGiovanna(handoff()!)).toContain('[HUMANO]');
  });

  it('reenvio do comprovante já usado: sem legenda é silêncio (true); com pergunta segue pra Giovanna (false)', async () => {
    leitura = LEO2;
    // registro do 1º processamento, com o E2E do mesmo Pix (reenvio de verdade)
    db.system_state.push({ key: `pix_comprov:${TEL}:27:2026-10-19`, value: { e2e: 'pix_e2e:E00416968202610191940:27' } });

    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', 'O cliente enviou esta imagem.')).toBe(true);
    expect(handoff()).toBeUndefined();

    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', 'cadê meu acesso?')).toBe(false);
    expect(handoff()).toMatchObject({ codigo: 'ja_usado' });
    expect(avisosThiago()).toHaveLength(0); // já usado não avisa o Thiago
  });

  it('reenvio já usado sem ID de Pix pra comparar: silêncio com o cliente, mas o Thiago é avisado', async () => {
    leitura = LEO2;
    db.system_state.push({ key: `pix_comprov:${TEL}:27:2026-10-19`, value: {} }); // registro antigo, sem E2E

    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(0);
    expect(avisosThiago().some((c: any[]) => String(c[1]).includes('REPETIDO'))).toBe(true);
  });

  it('o mesmo comprovante reprovado duas vezes: 1ª segue (false); a 2ª é silêncio sem legenda e segue (false) com pergunta', async () => {
    leitura = AND3;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(false);
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', 'e agora, o que eu faço?')).toBe(false);
  });

  it('comprovante reprovado e depois APROVADO: o handoff some e a Giovanna não recebe mais o bloco', async () => {
    leitura = AND3;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(handoff()).toBeDefined();
    expect(await lerHandoffComprovante(TEL)).not.toBeNull();

    leitura = LEO2;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');

    expect(db.users[0]!.plano).toBe('pro'); // liberou
    expect(handoff()).toBeUndefined();
    expect(await lerHandoffComprovante(TEL)).toBeNull();
    expect(await temHandoffComprovante(TEL, 24)).toBe(false);
  });

  it('do 3º reprovado em 24h: Thiago UMA vez e silêncio (true)', async () => {
    const teto = () => avisosThiago().filter((c: any[]) => String(c[1]).includes('REPROVADO deste número em 24h'));
    leitura = { ...AND3, data: '2026-10-07' };
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(false);
    leitura = { ...AND3, data: '2026-10-08' };
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(false);
    expect(teto()).toHaveLength(0);

    leitura = { ...AND3, data: '2026-10-09' };
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(teto()).toHaveLength(1);
    leitura = { ...AND3, data: '2026-10-10' };
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(teto()).toHaveLength(1);
  });

  it('comprovante aprovado e imagem que não é comprovante: sem handoff', async () => {
    leitura = LEO2;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true); // liberou
    expect(handoff()).toBeUndefined();
    db.system_state = [];
    leitura = { is_comprovante: false };
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(false);
    expect(handoff()).toBeUndefined();
    expect(db.system_state).toHaveLength(0);
  });
});

describe('trava do [[ENVIAR_PIX]] com handoff ativo', () => {
  const h = (codigo: HandoffComprovante['codigo']): HandoffComprovante => ({
    valor: 27, recebedor_nome: 'X', recebedor_documento: null, data: '2026-10-19', id_transacao: null,
    motivo: 'm', codigo, recebedor_ok: codigo !== 'recebedor', em: new Date().toISOString(), instancia: 'io',
  });
  const hist = (...c: string[]) => c.map((content) => ({ role: 'assistant', content }));

  it('removido sempre nos motivos valor ilegível, sem ID de Pix e entrada repetida', async () => {
    for (const cod of ['valor', 'sem_id_pix', 'entrada_repetida'] as const) {
      expect(await pixDoHandoffPodeSair(h(cod), hist('oi'), TEL)).toBe(false);
    }
  });

  it('vale nos motivos recebedor errado, data fora da janela e já usado, e uma vez por conversa', async () => {
    for (const cod of ['recebedor', 'data', 'ja_usado'] as const) {
      expect(await pixDoHandoffPodeSair(h(cod), hist('oi'), TEL)).toBe(true);
    }
    // o histórico já tem o copia-e-cola
    expect(await pixDoHandoffPodeSair(h('recebedor'), hist('00020126580014BR.GOV.BCB.PIX...'), TEL)).toBe(false);
    expect(await pixDoHandoffPodeSair(h('data'), hist('00020126580014BR.GOV.BCB.PIX...'), TEL)).toBe(false);
    // o Pix pedido já foi registrado nas últimas 24h (o código sai por fora do histórico)
    db.system_state.push({
      key: `pix_solicitado:${TEL_USERS}`,
      value: { valor: 67, email: null, nome: null, em: new Date().toISOString(), comprovante: null },
    });
    expect(await pixDoHandoffPodeSair(h('recebedor'), hist('oi'), TEL)).toBe(false);
  });
});

describe('handoff: leitura e cessão', () => {
  it('lê o mais novo dentro de 24h, e temHandoffComprovante respeita a janela dada (5 min)', async () => {
    leitura = AND3;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');

    expect((await lerHandoffComprovante(TEL))?.codigo).toBe('recebedor');
    expect(await temHandoffComprovante(TEL, 5 / 60)).toBe(true);

    vi.setSystemTime(new Date('2026-10-20T17:06:00Z')); // 6 min depois
    expect(await temHandoffComprovante(TEL, 5 / 60)).toBe(false);
    expect(await temHandoffComprovante(TEL, 24)).toBe(true);

    vi.setSystemTime(new Date('2026-10-21T17:30:00Z')); // 24h30 depois
    expect(await temHandoffComprovante(TEL, 24)).toBe(false);
  });
});

describe('o bloco do prompt oferece o Pix só onde o código deixa', () => {
  const base: HandoffComprovante = {
    valor: 27, recebedor_nome: 'X', recebedor_documento: null, data: '2026-10-01', id_transacao: null,
    motivo: 'm', codigo: 'data', recebedor_ok: true, em: new Date().toISOString(), instancia: 'io',
  };
  it('recebedor, data e já usado oferecem [[ENVIAR_PIX]]; valor e sem ID de Pix não', () => {
    for (const cod of ['recebedor', 'data', 'ja_usado'] as const) {
      expect(blocoComprovanteGiovanna({ ...base, codigo: cod })).toMatch(/\[\[ENVIAR_PIX\]\]/);
    }
    for (const cod of ['valor', 'sem_id_pix'] as const) {
      const b = blocoComprovanteGiovanna({ ...base, codigo: cod });
      expect(b).not.toMatch(/ofereça o Pix/);
      expect(b).toMatch(/o sistema remove o marcador/);
    }
  });
});

describe('Pix sob demanda da Giovanna de suporte: ordem das bolhas', () => {
  it('texto, instrução e o copia-e-cola POR ÚLTIMO; com maxBolhas 1 saem no máximo 2 bolhas e o código é a última', () => {
    const copia = gerarPixCopiaECola({ valor: 67, txid: 'SOLARDOCVIP' });
    const partes = partesPixSobDemanda(copia, 67);
    expect(partes[partes.length - 1]).toBe(copia);
    expect(partes[0]).toContain('São R$ 67');
    const bolhas = emBolhas(partes.join('||'), { maxBolhas: 1 });
    expect(bolhas.length).toBeLessThanOrEqual(2);
    expect(bolhas[bolhas.length - 1]).toBe(copia);
    expect(bolhas.slice(0, -1).join(' ')).toContain('comprovante');
  });
});
