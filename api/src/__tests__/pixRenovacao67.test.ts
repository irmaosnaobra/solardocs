import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// REGRA DE 20/10/2026 (dono): "todos que forem renovar no Pix têm que pagar os 67,00;
// se fizerem menos, têm que ser avisados a fazer o restante."
//
// Comprovante com data ANTERIOR ao corte segue a tabela antiga (o Pix de R$ 27 de 19/10
// continua valendo PRO). A partir do corte: 67 ou mais libera 1 mês ilimitado; menos que
// isso é PAGAMENTO PARCIAL (crédito de 7 dias + aviso do que falta + Pix do restante).
// Todos os ramos que liberam passam por `aplicarPagamentoPix`; os testes cobrem cada um.
// O modelo é simulado: o leitor devolve o JSON de cada fixture.
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let leitura: Row | null = null; // o que o "leitor" devolve neste teste
let aoAtualizarUsers: (() => void) | null = null; // gancho: roda quando um UPDATE de users acontece (dentro da trava)
let explodirNoCredito = false; // simula EXCEÇÃO ao gravar o crédito
let falhaGravarCredito = false; // simula erro ao gravar/zerar o crédito Pix
const filaLeituras: Row[] = []; // leituras seguidas do leitor (testes em paralelo)
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
    if (modo === 'upsert' && explodirNoCredito && String(pendente!.key ?? '').startsWith('pix_credito:')) {
      throw new Error('banco caiu');
    }
    if (modo === 'upsert' && falhaGravarCredito && String(pendente!.key ?? '').startsWith('pix_credito:')) {
      return { data: null, error: { code: 'XX000', message: 'banco fora' } };
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
      if (table === 'users' && aoAtualizarUsers) aoAtualizarUsers();
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
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify(filaLeituras.length ? filaLeituras.shift() : leitura) }] }),
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

vi.mock('../services/dunningService', () => ({ cancelStripeSubsForEmail: vi.fn(async () => 1) }));
// Grupo de vendas do SolarDoc (24/10/2026): o aviso ao grupo é UM A MAIS; aqui só se confere QUANDO ele é pedido.
const grupo = vi.hoisted(() => ({ avisarCompra: vi.fn(async (_c: unknown) => 'enviado') }));
const mailer = vi.hoisted(() => ({ sendOpsAlert: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock('../utils/mailer', async (orig) => ({ ...(await orig<typeof import('../utils/mailer')>()), sendOpsAlert: mailer.sendOpsAlert }));
vi.mock('../services/solardoc/avisoGrupoSolardoc', async (orig) => ({ ...(await orig<typeof import('../services/solardoc/avisoGrupoSolardoc')>()), avisarCompra: grupo.avisarCompra }));

import { sendHuman, sendWhatsApp } from '../services/agents/zapiClient';
import {
  tryProcessPixComprovante, tryProcessAbandonedPixComprovante, aplicarComprovantePendente,
} from '../services/agents/whatsapp/pixComprovanteService';
import { crc16 } from '../utils/pixBrCode';
import { montarPartes } from '../services/agents/whatsapp/pixVipReminderService';

const IMG = { type: 'base64' as const, media_type: 'image/jpeg', data: 'AAAA' };
const TEL = '5534991112222';
const TEL_USERS = '34991112222';
const USER = { id: 'u1', email: 'leoimplant@gmail.com', plano: 'free' };

const pix = (valor: number, data: string, id: string) => ({
  is_comprovante: true, valor, recebedor_nome: 'Aioros Group Ltda', recebedor_documento: '63636043000188',
  data, id_transacao: id,
});
const LEO2 = pix(27, '2026-10-19', 'E004169682026101919400uHT9pUwumly');
const P27 = pix(27, '2026-10-20', 'E004169682026102013000AAAAAAAAAAA');
const P40 = pix(40, '2026-10-20', 'E004169682026102014000BBBBBBBBBBB');
const P67 = pix(67, '2026-10-20', 'E004169682026102015000CCCCCCCCCCC');
const P70 = pix(70, '2026-10-20', 'E004169682026102016000DDDDDDDDDDD');

const enviadas = () => (sendHuman as any).mock.calls as any[][];
const textos = () => enviadas().map((c) => c[1].join(' || '));
const thiago = () => (sendWhatsApp as any).mock.calls.filter((c: any[]) => c[0] === '34991360223');
const credito = () => db.system_state.find((r) => r.key === 'pix_credito:u1')?.value;
const u = () => db.users[0]!;

/** Campo TLV de nível 1 do BR Code. */
function campo(payload: string, id: string): string | null {
  let i = 0;
  while (i + 4 <= payload.length) {
    const cid = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    const val = payload.slice(i + 4, i + 4 + len);
    if (cid === id) return val;
    i += 4 + len;
  }
  return null;
}
function brCodeDaBolha(i = 0): string {
  const partes = enviadas()[i]![1] as string[];
  return partes[partes.length - 1]!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T17:00:00Z'));
  db.system_state = []; db.wa_mensagens = []; db.company = []; db.abandoned_checkouts = [];
  db.users = [{ id: 'u1', email: USER.email, password_hash: 'h', reset_token: null, plano: 'free', billing_status: 'free', plano_expira_em: null, whatsapp: TEL_USERS }];
  leitura = null;
  falhaGravarCredito = false;
  explodirNoCredito = false;
  aoAtualizarUsers = null;
  (sendHuman as any).mockClear();
  (sendWhatsApp as any).mockClear();
  grupo.avisarCompra.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('conhecido', () => {
  it('leo2 (R$ 27 de 19/10, antes do corte): libera PRO como antes', async () => {
    leitura = LEO2;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(u()).toMatchObject({ plano: 'pro', limite_documentos: 90 });
    expect(credito()).toBeUndefined();
    // a confirmação sai em 1 bolha só
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 1 });
  });

  it('R$ 27 de 20/10: NÃO libera, guarda crédito de 27, manda 2 bolhas com o Pix de R$ 40,00 e avisa o Thiago', async () => {
    leitura = P27;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);

    expect(u().plano).toBe('free');
    expect(credito()).toMatchObject({ total: 27 });
    expect(credito().itens).toHaveLength(1);
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![0]).toBe(TEL);
    expect(enviadas()[0]![2]).toBe('io');
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 2 });
    expect(enviadas()[0]![1]).toHaveLength(2);
    expect(textos()[0]).toContain('Recebi seu Pix de R$ 27,00, obrigado. A renovação no Pix agora é R$ 67,00, então faltam R$ 40,00. Segue abaixo o Pix do restante. Assim que você mandar o comprovante, eu libero na hora.');
    // O copia-e-cola vai por ÚLTIMO, com o valor do que falta (campo 54 = 40.00) e CRC válido.
    const code = brCodeDaBolha();
    expect(code.startsWith('000201')).toBe(true);
    expect(campo(code, '54')).toBe('40.00');
    expect(crc16(code.slice(0, -4))).toBe(code.slice(-4));
    const avisos = thiago().filter((c: any[]) => String(c[1]).includes('PARCIAL'));
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0][1])).toContain('R$ 27,00');
    expect(String(avisos[0][1])).toContain('R$ 40,00');
  });

  it('depois R$ 40 de 20/10: total 67, libera ILIMITADO e zera o crédito', async () => {
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    (sendHuman as any).mockClear();
    leitura = P40;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);

    expect(u()).toMatchObject({ plano: 'ilimitado', limite_documentos: 999999, billing_status: 'active' });
    expect(credito()).toMatchObject({ total: 0, itens: [] });
    expect(textos()[0]).toContain('liberado');
  });

  it('R$ 67 libera ILIMITADO direto; R$ 70 também, e o Thiago é avisado "acima de 67"', async () => {
    leitura = P67;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u()).toMatchObject({ plano: 'ilimitado', limite_documentos: 999999 });
    expect(thiago().some((c: any[]) => String(c[1]).includes('acima de 67'))).toBe(false);

    db.users[0] = { ...u(), plano: 'free', plano_expira_em: null, billing_status: 'free' };
    leitura = P70;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('ilimitado');
    expect(thiago().some((c: any[]) => String(c[1]).includes('acima de 67'))).toBe(true);
  });

  it('o MESMO comprovante de R$ 27 duas vezes: a 2ª é silenciosa e o crédito continua 27', async () => {
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    (sendHuman as any).mockClear();

    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(0);
    expect(credito()).toMatchObject({ total: 27 });
    expect(credito().itens).toHaveLength(1);
  });

  it('o mesmo Pix (E2E) de OUTRO telefone não credita de novo', async () => {
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    (sendHuman as any).mockClear();
    const outra = { ...P27, id_transacao: 'E00416968202610201300AAAAAAAAAAAAA' };
    leitura = outra; // mesmos 21 primeiros caracteres
    await tryProcessPixComprovante(USER, IMG, '5534988887777', 'io', '');
    expect(credito()).toMatchObject({ total: 27 });
    expect(credito().itens).toHaveLength(1);
  });

  it('crédito com mais de 7 dias é zerado antes de somar', async () => {
    const velho = new Date(Date.now() - 8 * 864e5).toISOString();
    db.system_state.push({ key: 'pix_credito:u1', value: { total: 27, itens: [{ valor: 27, data: '2026-10-12', e2e: null, em: velho }], desde: velho } });
    leitura = P27;

    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');

    expect(credito()).toMatchObject({ total: 27 });
    expect(credito().itens).toHaveLength(1);
    expect(textos()[0]).toContain('faltam R$ 40,00'); // texto do 1º comprovante, não do "somando"
    expect(u().plano).toBe('free');
  });

  it('R$ 19 de primeira vez é a entrada, como hoje; a 2ª vez de R$ 19 vira parcial (faltam R$ 48,00)', async () => {
    leitura = pix(19, '2026-10-20', 'E004169682026102011000EEEEEEEEEEE');
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u()).toMatchObject({ plano: 'ilimitado', limite_documentos: 999999 });
    expect(db.system_state.some((r) => r.key === `pix19_entrada:${TEL}`)).toBe(true);
    expect(credito()).toBeUndefined();

    db.users[0] = { ...u(), plano: 'free', plano_expira_em: null, billing_status: 'free' };
    (sendHuman as any).mockClear();
    // outra data: o dedup é por telefone+valor+data, então 2 pagamentos iguais no MESMO dia colidem
    leitura = pix(19, '2026-10-21', 'E004169682026102112000FFFFFFFFFFF');
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('free');
    expect(credito()).toMatchObject({ total: 19 });
    expect(textos()[0]).toContain('faltam R$ 48,00');
    expect(campo(brCodeDaBolha(), '54')).toBe('48.00');
  });

  it('parcial NÃO cancela o cartão em dunning; o pagamento que completa os R$ 67 cancela', async () => {
    const { cancelStripeSubsForEmail } = await import('../services/dunningService');
    (cancelStripeSubsForEmail as any).mockClear();
    db.users[0] = { ...u(), plano: 'pro', billing_status: 'past_due', plano_expira_em: new Date(Date.now() + 864e5).toISOString() };
    // past_due com plano pro e plano_expira_em: não é "cartão ativo", então entra no fluxo
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(cancelStripeSubsForEmail).not.toHaveBeenCalled();
    expect(u().billing_status).toBe('past_due');

    leitura = P40;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(cancelStripeSubsForEmail).toHaveBeenCalledTimes(1);
    expect(u().plano).toBe('ilimitado');
  });
});

describe('número desconhecido', () => {
  const comEmailDaConversa = () => db.wa_mensagens.push(
    { telefone: TEL, texto: 'meu email é leoimplant@gmail.com', tipo: 'text', from_me: false, momment: new Date().toISOString(), instancia: 'io' });

  it('com e-mail de conta na conversa + R$ 27 de 20/10: parcial igual (2 bolhas pela io, crédito 27)', async () => {
    leitura = P27;
    comEmailDaConversa();

    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);

    expect(u().plano).toBe('free');
    expect(credito()).toMatchObject({ total: 27 });
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![2]).toBe('io');
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 2 });
    expect(textos()[0]).toContain('faltam R$ 40,00');
    expect(campo(brCodeDaBolha(), '54')).toBe('40.00');
    expect(u().whatsapp).toBe(TEL_USERS);
  });

  it('o 2º Pix (R$ 40) completa: libera ilimitado e a confirmação mostra R$ 67,00 recebidos', async () => {
    comEmailDaConversa();
    leitura = P27;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    (sendHuman as any).mockClear();
    leitura = P40;

    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);

    expect(u()).toMatchObject({ plano: 'ilimitado', limite_documentos: 999999 });
    expect(credito()).toMatchObject({ total: 0, itens: [] });
    expect(enviadas()).toHaveLength(1);
    expect(textos()[0]).toContain('Recebi seu Pix de R$ 67,00 e liberei o plano Ilimitado');
    expect(textos()[0]).not.toMatch(/redefinir|token/);
  });

  it('pendente sem e-mail + R$ 27: pede o e-mail (sem prometer liberar); com o e-mail aplica o parcial', async () => {
    leitura = P27;
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(textos()[0]).toContain('eu aplico esse pagamento na conta');
    expect(textos()[0]).not.toContain('libero na hora');
    expect(credito()).toBeUndefined();
    (sendHuman as any).mockClear();

    const r = await aplicarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');

    expect(r).toEqual({ tratado: true, venc: null });
    expect(u().plano).toBe('free');
    expect(credito()).toMatchObject({ total: 27 });
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 2 });
    expect(textos()[0]).toContain('faltam R$ 40,00');
    // o pendente foi consumido
    expect(db.system_state.find((x) => x.key === `pix_solicitado:${TEL_USERS}`)?.value.comprovante).toBeNull();
  });

  it('pendente sem e-mail + R$ 67: o e-mail libera ilimitado', async () => {
    leitura = P67;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    expect(textos()[0]).toContain('eu libero na hora');
    const r = await aplicarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');
    expect(r.tratado).toBe(true);
    expect(r.venc).toBeInstanceOf(Date);
    expect(u().plano).toBe('ilimitado');
  });
});

describe('abandono / Pix pedido', () => {
  it('parcial não marca o abandono como recuperado; o pagamento que completa marca', async () => {
    db.abandoned_checkouts.push({
      id: 'ab1', email: USER.email, phone: TEL, nome: 'Leo', plano: 'pro', status: 'abandoned', created_at: new Date().toISOString(),
    });
    leitura = P27;
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(db.abandoned_checkouts[0]!.status).toBe('abandoned');
    expect(u().plano).toBe('free');
    expect(textos()[0]).toContain('faltam R$ 40,00');

    leitura = P40;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    expect(db.abandoned_checkouts[0]!.status).toBe('recovered');
    expect(u().plano).toBe('ilimitado');
  });
});

describe('lembrete de renovação (plano PRO)', () => {
  it('quem tem PRO ganha a frase da mudança NA MESMA bolha, sem bolha nova', () => {
    const frase = 'A partir de agora a renovação no Pix é R$ 67,00, já com o plano Ilimitado.';
    const pro = montarPartes('Leo', 67, 'pro');
    const outro = montarPartes('Leo', 67, 'ilimitado');
    expect(pro.join(' ')).toContain(frase);
    expect(outro.join(' ')).not.toContain(frase);
    expect(pro).toHaveLength(outro.length);
  });
});

describe('lembrete de renovação', () => {
  it('pede sempre R$ 67, para qualquer plano', () => {
    const t = montarPartes('Leo').join(' ');
    expect(t).toContain('R$ 67');
    expect(t).not.toMatch(/R\$ ?27|seu plano atual/);
    // sem o link do checkout, o copia-e-cola traz o valor de 67
    const code = montarPartes('Leo').find((p) => p.startsWith('000201'));
    if (code) expect(campo(code, '54')).toBe('67.00');
  });
});

describe('travas do crédito', () => {
  it('dois parciais em paralelo (27 e 40, E2E diferentes): o total fecha em 67 e libera', async () => {
    // O leitor devolve 27 à 1ª leitura e 40 à 2ª (cada chamada lê o seu comprovante).
    filaLeituras.push(P27, P40);
    const [a, b] = await Promise.all([
      tryProcessPixComprovante(USER, IMG, TEL, 'io', ''),
      tryProcessPixComprovante(USER, IMG, TEL, 'io', ''),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    // Sem a trava por conta os dois leriam crédito 0 e nenhum fecharia os 67.
    expect(u()).toMatchObject({ plano: 'ilimitado', limite_documentos: 999999 });
    expect(credito()).toMatchObject({ total: 0, itens: [] });
    expect(db.system_state.some((r) => r.key.startsWith('pix_credito_lock:'))).toBe(false);
  });

  it('trava velha (mais de 30 s) é tomada; trava recente espera e libera no fim', async () => {
    db.system_state.push({ key: 'pix_credito_lock:u1', value: { em: new Date(Date.now() - 60_000).toISOString() } });
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(credito()).toMatchObject({ total: 27 });
    expect(db.system_state.some((r) => r.key === 'pix_credito_lock:u1')).toBe(false);
  });

  it('2 parciais IGUAIS (R$ 33,50, mesmo dia, E2E diferentes): o 2º é OUTRO Pix, credita e libera', async () => {
    leitura = pix(33.5, '2026-10-20', 'E004169682026102011000GGGGGGGGGGG');
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(credito()).toMatchObject({ total: 33.5 });
    (sendHuman as any).mockClear();

    leitura = pix(33.5, '2026-10-20', 'E004169682026102012000HHHHHHHHHHH');
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');

    expect(u()).toMatchObject({ plano: 'ilimitado', limite_documentos: 999999 });
    expect(credito()).toMatchObject({ total: 0, itens: [] });
  });

  it('reenvio REAL do mesmo Pix de R$ 33,50 (mesmo prefixo de E2E) continua barrado: não soma', async () => {
    leitura = pix(33.5, '2026-10-20', 'E004169682026102011000GGGGGGGGGGG');
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    (sendHuman as any).mockClear();
    leitura = pix(33.5, '2026-10-20', 'E00416968202610201100XGGGGGGGGGGG'); // leitor errou o fim
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(credito()).toMatchObject({ total: 33.5 });
    expect(credito().itens).toHaveLength(1);
    expect(u().plano).toBe('free');
  });

  it('mesmo valor e dia SEM E2E pra comparar: não credita e avisa o Thiago (possível repetido)', async () => {
    leitura = { ...P27, id_transacao: null };
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(credito()).toMatchObject({ total: 27 });
    (sendWhatsApp as any).mockClear();
    leitura = { ...P27, id_transacao: null };
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(credito()).toMatchObject({ total: 27 });
    expect(thiago().some((c: any[]) => String(c[1]).includes('REPETIDO'))).toBe(true);
  });

  it('se o crédito não zera, NÃO libera e o Thiago é avisado', async () => {
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    falhaGravarCredito = true;
    (sendWhatsApp as any).mockClear();
    leitura = P40;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('free');
    expect(thiago().some((c: any[]) => String(c[1]).includes('NÃO consegui zerar'))).toBe(true);
  });
});

describe('pendente antigo e duplicado', () => {
  const pend = (extra: Record<string, any>) => db.system_state.push({
    key: `pix_solicitado:${TEL_USERS}`,
    value: {
      valor: 27, email: null, nome: null, em: new Date().toISOString(),
      comprovante: { valor: 27, dedupKey: `pix_comprov:${TEL}:27:x`, passou: true, em: new Date().toISOString(), e2eKey: null, ...extra },
    },
  });

  it('pendente SEM modo, com data de 20/10: vira parcial (não cai na tabela antiga)', async () => {
    pend({ data: '2026-10-20' });
    const r = await aplicarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');
    expect(r.tratado).toBe(true);
    expect(u().plano).toBe('free');
    expect(credito()).toMatchObject({ total: 27 });
  });

  it('pendente SEM modo, com data de 19/10: tabela antiga (PRO)', async () => {
    pend({ data: '2026-10-19' });
    await aplicarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');
    expect(u()).toMatchObject({ plano: 'pro', limite_documentos: 90 });
  });

  it('comprovante já processado: tratado=false (o e-mail segue pro fluxo normal) e o pendente é limpo', async () => {
    pend({ data: '2026-10-19', e2eKey: 'pix_e2e:E00416968202610191940:27' });
    db.system_state.push({ key: `pix_comprov:${TEL}:27:x`, value: { e2e: 'pix_e2e:E00416968202610191940:27' } });
    const r = await aplicarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');
    expect(r).toEqual({ tratado: false, venc: null });
    expect(u().plano).toBe('free');
    expect(db.system_state.find((x) => x.key === `pix_solicitado:${TEL_USERS}`)?.value.comprovante).toBeNull();
  });
});

describe('pedido de e-mail e confirmações em 1 bolha', () => {
  it('Pix pedido sem e-mail: o pedido do e-mail sai em 1 bolha só (junta as duas frases)', async () => {
    db.system_state.push({
      key: `pix_solicitado:${TEL_USERS}`,
      value: { valor: 67, email: null, nome: null, em: new Date().toISOString(), comprovante: null },
    });
    leitura = P67;
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 1 });
  });
});

describe('trava do crédito: envios fora, token e exceção', () => {
  const lockPresente = () => db.system_state.some((r) => r.key.startsWith('pix_credito_lock:'));

  it('o envio ao cliente e o aviso ao Thiago acontecem DEPOIS de soltar a trava', async () => {
    const vistos: boolean[] = [];
    (sendHuman as any).mockImplementation(async () => { vistos.push(lockPresente()); });
    (sendWhatsApp as any).mockImplementation(async () => { vistos.push(lockPresente()); });
    try {
      leitura = P27; // parcial: mensagem com o Pix do restante + aviso
      await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
      leitura = P40; // completa: confirmação + aviso
      await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    } finally {
      (sendHuman as any).mockImplementation(async () => {});
      (sendWhatsApp as any).mockImplementation(async () => {});
    }
    expect(vistos.length).toBeGreaterThanOrEqual(4);
    expect(vistos.every((v) => v === false)).toBe(true);
    expect(u().plano).toBe('ilimitado');
  });

  it('o finally só apaga a trava se ela ainda for a nossa', async () => {
    // Durante a parte travada (o UPDATE de users da liberação), outra execução toma a trava.
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    aoAtualizarUsers = () => {
      const t = db.system_state.find((r) => r.key === 'pix_credito_lock:u1');
      if (t) t.value = { em: new Date().toISOString(), token: 'de-outra-execucao' };
    };
    leitura = P40;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    const t = db.system_state.find((r) => r.key === 'pix_credito_lock:u1');
    expect(t?.value.token).toBe('de-outra-execucao'); // a trava dela não foi apagada
  });

  it('exceção na parte travada: o Thiago é avisado (valor, e-mail, ID) antes de relançar, e a trava é solta', async () => {
    explodirNoCredito = true;
    leitura = P27;

    await expect(tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).rejects.toThrow('banco caiu');

    const aviso = thiago().find((c: any[]) => String(c[1]).includes('ERRO ao aplicar'));
    expect(aviso).toBeTruthy();
    expect(String(aviso![1])).toContain('R$ 27,00');
    expect(String(aviso![1])).toContain(USER.email);
    expect(String(aviso![1])).toContain('pix_e2e:E00416968202610201300:27');
    expect(lockPresente()).toBe(false);
  });
});

describe('mesmo prefixo de E2E em momento diferente', () => {
  const seed = (minutosAtras: number) => db.system_state.push({
    key: `pix_comprov:${TEL}:27:2026-10-20`,
    value: { e2e: 'pix_e2e:E00416968202610201300:27', at: new Date(Date.now() - minutosAtras * 60_000).toISOString() },
  });

  it('registro de mais de 10 min: segue barrado (silêncio com o cliente) e o Thiago confere', async () => {
    seed(11);
    leitura = P27;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(0);
    expect(credito()).toBeUndefined();
    expect(thiago().some((c: any[]) => String(c[1]).includes('mais de 10 min'))).toBe(true);
  });

  it('reenvio logo em seguida (menos de 10 min): silencioso, sem aviso', async () => {
    seed(2);
    leitura = P27;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(thiago()).toHaveLength(0);
    expect(credito()).toBeUndefined();
  });
});

describe('grupo de vendas do SolarDoc: um aviso a mais, o Thiago sempre recebe', () => {
  it('compra liberada por comprovante: o Thiago recebe e o grupo também, uma vez, com id único e plano ativo', async () => {
    leitura = P67;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('ilimitado');
    expect(thiago().length).toBeGreaterThan(0);
    expect(grupo.avisarCompra).toHaveBeenCalledTimes(1);
    const c = grupo.avisarCompra.mock.calls[0]![0] as Record<string, any>;
    expect(c).toMatchObject({ canal: 'comprovante', planoAtivo: true, valor: 67 });
    expect(c.email).toBeUndefined();   // o e-mail do cliente nunca vai ao grupo
    expect(c.id).toMatch(/^pix:[^:]+/);
    expect(c.id).not.toMatch(/null|undefined/);
  });
  it('o alerta "acima de 67" sai ANTES do aviso ao grupo e não depende dele (o grupo lança e o alerta já saiu)', async () => {
    const ordem: string[] = [];
    (sendWhatsApp as any).mockImplementation(async (_t: string, txt: string) => { if (String(txt).includes('acima de 67')) ordem.push('alerta'); });
    grupo.avisarCompra.mockImplementationOnce(async () => { ordem.push('grupo'); throw new Error('grupo fora'); });
    leitura = P70;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('ilimitado');
    expect(ordem).toEqual(['alerta', 'grupo']);
    (sendWhatsApp as any).mockImplementation(async () => {});
  });
  it('o alerta "acima de 67" que falha no WhatsApp não é engolido: vai por e-mail e o aviso ao grupo segue', async () => {
    mailer.sendOpsAlert.mockClear();
    (sendWhatsApp as any).mockImplementation(async (_t: string, txt: string) => { if (String(txt).includes('acima de 67')) throw new Error('zapi fora'); });
    leitura = P70;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('ilimitado');
    expect(mailer.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(String(mailer.sendOpsAlert.mock.calls[0]![1])).toContain('acima de 67');
    expect(grupo.avisarCompra).toHaveBeenCalledTimes(1);
    (sendWhatsApp as any).mockImplementation(async () => {});
  });
  it('renovação (conta que já tinha vencimento): o Thiago recebe, o grupo não', async () => {
    db.users[0] = { ...u(), plano: 'ilimitado', billing_status: 'active', plano_expira_em: '2026-10-25T00:00:00Z' };
    leitura = P67;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(thiago().length).toBeGreaterThan(0);
    expect(grupo.avisarCompra).not.toHaveBeenCalled();
  });
  it('pagamento parcial (não liberou, plano não ativo): o Thiago recebe e o grupo não', async () => {
    leitura = P27;
    await tryProcessPixComprovante(USER, IMG, TEL, 'io', '');
    expect(u().plano).toBe('free');
    expect(thiago().some((c: any[]) => String(c[1]).includes('PARCIAL'))).toBe(true);
    expect(grupo.avisarCompra).not.toHaveBeenCalled();
  });
  it('se o aviso ao grupo estourar, o Thiago já recebeu e a liberação segue', async () => {
    grupo.avisarCompra.mockRejectedValueOnce(new Error('grupo fora'));
    leitura = P67;
    expect(await tryProcessPixComprovante(USER, IMG, TEL, 'io', '')).toBe(true);
    expect(u().plano).toBe('ilimitado');
    expect(thiago().length).toBeGreaterThan(0);
  });
});

describe('grupo de vendas: id da venda nunca nulo', () => {
  it('sem e2eKey e sem dedupKey o aviso ao grupo é pulado (nada de pix:undefined)', async () => {
    const { avisarCompraNoGrupo } = await import('../services/agents/whatsapp/pixComprovanteService');
    await avisarCompraNoGrupo({ id: 'u1', email: USER.email, plano_expira_em: null }, { valor: 67, dedupKey: '', e2eKey: null, modo: 'tabela', data: null } as any, TEL, 67);
    expect(grupo.avisarCompra).not.toHaveBeenCalled();
    await avisarCompraNoGrupo({ id: 'u1', email: USER.email, plano_expira_em: null }, { valor: 67, dedupKey: 'dk:abc', e2eKey: null, modo: 'tabela', data: null } as any, TEL, 67);
    expect(grupo.avisarCompra).toHaveBeenCalledTimes(1);
    expect((grupo.avisarCompra.mock.calls[0]![0] as any).id).toBe('pix:dk:abc');
  });
});
