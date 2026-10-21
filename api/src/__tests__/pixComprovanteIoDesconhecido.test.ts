import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Comprovante Pix de NÚMERO DESCONHECIDO (a linha IO).
//
// O cliente manda o comprovante de um telefone que não está em users.whatsapp,
// sem checkout abandonado e sem Pix pedido. Antes a foto caía na agente, sem
// resposta. Agora o sistema lê, confere que foi pra Aioros, e libera o mês.
//
// As fixtures são leituras REAIS do leitor (visão) de 20/10/2026. O que decide se
// dinheiro vira acesso são as travas, então o leitor é a única coisa simulada:
// `novoAnthropic().messages.create` devolve o JSON de cada fixture.
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
import {
  tryProcessAbandonedPixComprovante, liberarComprovantePendente, chaveE2e,
} from '../services/agents/whatsapp/pixComprovanteService';
import { lerPixSolicitado, temComprovantePendente } from '../services/agents/whatsapp/pixSolicitado';

const IMG = { type: 'base64' as const, media_type: 'image/jpeg', data: 'AAAA' };
const TEL = '5534991112222';
const TEL_FORMATO_USERS = '34991112222';

const LEO2 = {
  is_comprovante: true, valor: 27, recebedor_nome: 'Aioros Group Ltda', recebedor_documento: '63636043000188',
  data: '2026-10-19', id_transacao: 'E004169682026101919400uHT9pUwumly',
};
const LEO1 = {
  is_comprovante: true, valor: 27, recebedor_nome: 'AIOROS', recebedor_documento: null,
  data: '2026-08-28', id_transacao: '6a91d60d-2eb9-4936-b62c-a57b9a64ef42',
};
const AND3 = {
  is_comprovante: true, valor: 69.9, recebedor_nome: 'SEND CRISTTINY LIMA SANTOS DE A', recebedor_documento: '60453375000139',
  data: '2026-10-07', id_transacao: 'E607469482026100801I7A3980A7OMjI',
};
const NAO_COMPROVANTE = { is_comprovante: false };

const enviadas = () => (sendHuman as any).mock.calls as any[][];
const textoEnviado = (i = 0) => String(enviadas()[i]?.[1]?.join(' ') ?? '');
const chaves = () => db.system_state.map((r) => r.key);

function conta(over: Row = {}): Row {
  return {
    id: 'u1', email: 'leoimplant@gmail.com', password_hash: 'hash', reset_token: null, nome: 'Leo',
    plano: 'free', billing_status: 'free', plano_expira_em: null, whatsapp: null, ...over,
  };
}

function mensagemRecebida(texto: string, telefone = TEL): Row {
  return { telefone, texto, tipo: 'text', from_me: false, momment: new Date().toISOString(), instancia: 'io' };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T17:00:00Z'));
  db.system_state = []; db.users = [conta()]; db.company = []; db.wa_mensagens = [];
  leitura = null;
  falhaMarcaDoPedido = false;
  falhaCriarConta = false;
  (sendHuman as any).mockClear();
  (sendWhatsApp as any).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('chave do E2E', () => {
  it('usa os 21 primeiros caracteres e o valor inteiro', () => {
    expect(chaveE2e('E004169682026101919400uHT9pUwumly', 27)).toBe('pix_e2e:E00416968202610191940:27');
    // o leitor perdeu um caractere no fim: os 21 primeiros saem iguais
    expect(chaveE2e('E00416968202610191940uHT9pUwumly', 27)).toBe('pix_e2e:E00416968202610191940:27');
  });
  it('sem ID de Pix de verdade não há chave', () => {
    expect(chaveE2e('6a91d60d-2eb9-4936-b62c-a57b9a64ef42', 27)).toBeNull();
    expect(chaveE2e('E607469482026100801I7A3980A7OMjI', 69.9)).toBeNull();
    expect(chaveE2e(null, 27)).toBeNull();
  });
});

describe('número desconhecido manda comprovante', () => {
  it('1. e-mail de conta existente digitado ANTES: libera, grava as duas travas e confirma sem link de senha', async () => {
    leitura = LEO2;
    db.wa_mensagens.push(mensagemRecebida('meu email é Leoimplant@Gmail.com'));
    db.company.push({ user_id: 'u1', nome: 'Leo Implantes Ltda' });

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(db.users[0]).toMatchObject({ plano: 'pro', limite_documentos: 90, billing_status: 'active' });
    expect(chaves()).toContain(`pix_comprov:${TEL}:27:2026-10-19`);
    expect(chaves()).toContain('pix_e2e:E00416968202610191940:27');
    // Uma confirmação só, pela linha IO, em 1 bolha.
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![0]).toBe(TEL);
    expect(enviadas()[0]![2]).toBe('io');
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 1 });
    const t = textoEnviado();
    expect(t).toBe(
      'Pronto. Recebi seu Pix de R$ 27,00 e liberei o plano PRO até 20/11 na conta leoimplant@gmail.com, da Leo Implantes Ltda. '
      + 'É só entrar em solardoc.app com o seu e-mail e a sua senha. Se não lembrar a senha, use "Esqueci minha senha" na tela de entrada.',
    );
    expect(t).not.toMatch(/redefinir|token/);
    // O telefone foi gravado na conta (estava vazio e ninguém mais o usa).
    expect(db.users[0]!.whatsapp).toBe(TEL_FORMATO_USERS);
  });

  it('1b. legenda da foto com o e-mail também vale, e sem razão social não sobra vírgula', async () => {
    leitura = LEO2;

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'paguei, minha conta é leoimplant@gmail.com');

    expect(r).toBe(true);
    expect(textoEnviado()).toContain('na conta leoimplant@gmail.com. É só entrar');
    expect(db.users[0]!.plano).toBe('pro');
  });

  it('1c. não troca o telefone de uma conta que já tem WhatsApp', async () => {
    leitura = LEO2;
    db.users[0]!.whatsapp = '34900000000';

    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');

    expect(db.users[0]!.whatsapp).toBe('34900000000');
  });

  it('1d. e-mails de duas contas diferentes na conversa = ambíguo: pede o e-mail, não libera', async () => {
    leitura = LEO2;
    db.users.push(conta({ id: 'u2', email: 'outra@pessoa.com' }));
    db.wa_mensagens.push(mensagemRecebida('leoimplant@gmail.com'), mensagemRecebida('ou outra@pessoa.com'));

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(db.users.every((u) => u.plano === 'free')).toBe(true);
    expect(textoEnviado()).toContain('Qual o e-mail da sua conta no SolarDoc?');
  });

  it('1e. o "_" do e-mail digitado não vira curinga e casa conta errada', async () => {
    leitura = LEO2;
    db.users = [conta({ email: 'leoXimplant@gmail.com' })];

    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leo_implant@gmail.com');

    expect(db.users[0]!.plano).toBe('free'); // nada liberado
    expect(textoEnviado()).toContain('Qual o e-mail');
  });

  it('2. sem e-mail na conversa: guarda o pendente, pede o e-mail UMA vez; o e-mail depois libera sem link', async () => {
    leitura = LEO2;

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(db.users[0]!.plano).toBe('free');
    expect(enviadas()).toHaveLength(1);
    expect(textoEnviado()).toBe(
      'Recebi seu comprovante de R$ 27,00. Qual o e-mail da sua conta no SolarDoc? Assim que você mandar, eu libero na hora.',
    );
    expect(enviadas()[0]![2]).toBe('io');
    const guardado = db.system_state.find((r) => r.key === `pix_solicitado:${TEL_FORMATO_USERS}`);
    expect(guardado?.value.comprovante).toMatchObject({ valor: 27, passou: true, e2eKey: 'pix_e2e:E00416968202610191940:27' });

    // Depois: o texto com o e-mail chega em liberarComprovantePendente.
    (sendHuman as any).mockClear();
    const venc = await liberarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');

    expect(venc).toBeInstanceOf(Date);
    expect(db.users[0]).toMatchObject({ plano: 'pro', limite_documentos: 90 });
    expect(chaves()).toContain('pix_e2e:E00416968202610191940:27');
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![2]).toBe('io');
    expect(textoEnviado()).toContain('liberei o plano PRO até 20/11 na conta leoimplant@gmail.com');
    expect(textoEnviado()).not.toMatch(/redefinir|token/);
    // O pendente foi consumido.
    expect(db.system_state.find((r) => r.key === `pix_solicitado:${TEL_FORMATO_USERS}`)?.value.comprovante).toBeNull();
  });

  it('2b. o e-mail de OUTRO telefone nunca troca o WhatsApp de uma conta que já tem número', async () => {
    leitura = LEO2;
    db.users[0]!.whatsapp = '34900000000';
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    await liberarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');
    expect(db.users[0]!.whatsapp).toBe('34900000000');
  });

  it('3. o mesmo Pix relido com o E2E de 32 caracteres, de OUTRO telefone, sem sinal do SolarDoc: barrado, fluxo de hoje', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');
    const venc1 = db.users[0]!.plano_expira_em;
    (sendHuman as any).mockClear();

    leitura = { ...LEO2, id_transacao: 'E00416968202610191940uHT9pUwumly' };
    const r = await tryProcessAbandonedPixComprovante('5534988887777', IMG, 'io', '');

    // sem e-mail de conta, sem Pix pedido e sem abandono: nada a dizer, segue o fluxo de hoje
    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect(db.users[0]!.plano_expira_em).toBe(venc1); // não somou outro mês
    expect(db.system_state.some((r2) => r2.key.startsWith('pix_solicitado:34988887777'))).toBe(false);
  });

  it('3b. o mesmo Pix de OUTRO telefone com e-mail de conta na conversa: 1 mensagem fixa e o Thiago é avisado', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');
    const venc1 = db.users[0]!.plano_expira_em;
    (sendHuman as any).mockClear();
    (sendWhatsApp as any).mockClear();

    leitura = { ...LEO2, id_transacao: 'E00416968202610191940uHT9pUwumly' };
    // o e-mail está na conversa (não na legenda): foto sem legenda, então cala
    db.wa_mensagens.push(mensagemRecebida('leoimplant@gmail.com', '5534988887777'));
    const r = await tryProcessAbandonedPixComprovante('5534988887777', IMG, 'io', '');

    expect(r).toBe(true);
    expect(db.users[0]!.plano_expira_em).toBe(venc1);
    expect(enviadas()).toHaveLength(1);
    expect(textoEnviado()).toBe('Aqui é a Giovanna, do suporte do SolarDoc. Esse comprovante já foi usado para liberar um acesso antes. Se você fez um pagamento novo, me manda o comprovante dele.');
    expect((sendWhatsApp as any).mock.calls.some((c: any[]) => String(c[1]).includes('REVISAR'))).toBe(true);
  });

  it('4. cartão antigo (sem ID de Pix, data velha): false, nada enviado, nada liberado', async () => {
    leitura = LEO1;

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect((sendWhatsApp as any).mock.calls).toHaveLength(0);
    expect(db.users[0]!.plano).toBe('free');
    expect(db.system_state).toHaveLength(0);
  });

  it('4b. data boa e recebedor certo, mas SEM ID de Pix, com e-mail de conta: mensagem fixa + Thiago ("sem ID de Pix")', async () => {
    leitura = { ...LEO2, id_transacao: 'AUTENTICACAO 8F3A 22' };
    db.wa_mensagens.push(mensagemRecebida('leoimplant@gmail.com'));

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(enviadas()).toHaveLength(1);
    expect(textoEnviado()).toContain('Não consegui confirmar esse pagamento por aqui. Pode me mandar o comprovante do Pix, em foto ou PDF da tela do banco?');
    expect(db.users[0]!.plano).toBe('free');
    // recebedor Aioros: o Thiago recebe o motivo
    const aviso = (sendWhatsApp as any).mock.calls.find((c: any[]) => String(c[1]).includes('REVISAR'));
    expect(String(aviso?.[1])).toContain('sem ID de Pix');
  });

  it('5. pagamento a terceiro: false e nada ao cliente; sem e-mail de conta o Thiago também não é avisado', async () => {
    leitura = AND3;

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect((sendWhatsApp as any).mock.calls).toHaveLength(0);
    expect(db.users[0]!.plano).toBe('free');
  });

  it('5b. pagamento a terceiro com e-mail de conta existente na conversa: 1 mensagem fixa pela io (sem pergunta) e o Thiago é avisado', async () => {
    leitura = AND3;
    db.wa_mensagens.push(mensagemRecebida('é leoimplant@gmail.com'));

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![0]).toBe(TEL);
    expect(enviadas()[0]![2]).toBe('io');
    expect(enviadas()[0]![3]).toEqual({ maxBolhas: 1 });
    expect(enviadas()[0]![1]).toHaveLength(1);
    expect(textoEnviado()).toBe(
      'Aqui é a Giovanna, do suporte do SolarDoc. Vi seu comprovante de R$ 69,90, mas esse Pix foi para SEND CRISTTINY LIMA SANTOS DE A, e não para a gente. '
      + 'O SolarDoc recebe só pela Aioros Group Ltda, CNPJ 63.636.043/0001-88, então esse pagamento não chegou aqui.',
    );
    expect(textoEnviado()).not.toMatch(/[—–]|\p{Extended_Pictographic}|\?/u);
    // Possível pagamento a terceiro de quem fala do SolarDoc: o Thiago quer saber.
    const avisos = (sendWhatsApp as any).mock.calls.filter((c: any[]) => c[0] === '34991360223');
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0][1])).toContain('TERCEIRO');
    expect(db.users[0]!.plano).toBe('free');
    const h = db.system_state.find((x) => x.key === `pix_handoff:${TEL_FORMATO_USERS}`)!;
    expect(h.value).toMatchObject({ codigo: 'recebedor', recebedor_ok: false, instancia: 'io' });
  });

  it('6. imagem que não é comprovante: false, nada', async () => {
    leitura = NAO_COMPROVANTE;

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');

    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect((sendWhatsApp as any).mock.calls).toHaveLength(0);
    expect(db.system_state).toHaveLength(0);
  });

  it('7. e-mail digitado que não existe: cria a conta pendente e a confirmação leva o link de senha', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    (sendHuman as any).mockClear();

    const venc = await liberarComprovantePendente(TEL, 'Novo@Cliente.com', null, 'io');

    expect(venc).toBeInstanceOf(Date);
    const nova = db.users.find((u) => u.email === 'novo@cliente.com')!;
    expect(nova).toBeTruthy();
    expect(nova.password_hash).toBeNull();
    expect(enviadas()).toHaveLength(1);
    expect(enviadas()[0]![2]).toBe('io');
    expect(textoEnviado()).toContain('Pronto. Recebi seu Pix de R$ 27,00 e liberei o plano PRO até 20/11 na conta novo@cliente.com.');
    expect(textoEnviado()).toContain(`/auth?mode=redefinir&token=${nova.reset_token}`);
  });

  it('o mesmo comprovante reenviado no mesmo número não libera outro mês', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');
    const venc1 = db.users[0]!.plano_expira_em;
    (sendHuman as any).mockClear();

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true); // reenvio de comprovante já usado: sem resposta, e a imagem não segue pra Carla
    expect(db.users[0]!.plano_expira_em).toBe(venc1);
    expect(enviadas()).toHaveLength(0);
  });

  it('conta com cartão ativo não é tocada: avisa o Thiago e não manda nada ao cliente', async () => {
    leitura = LEO2;
    db.users[0] = conta({ plano: 'pro', billing_status: 'active', plano_expira_em: null });

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');

    expect(r).toBe(true);
    expect(enviadas()).toHaveLength(0);
    expect(db.users[0]!.limite_documentos).toBeUndefined();
    expect(chaves().some((k) => k.startsWith('pix_e2e:'))).toBe(false);
  });
});

describe('comprovante sem e-mail: pendente do desconhecido', () => {
  it('8. a mesma imagem duas vezes sem e-mail: 1 pedido, 1 aviso ao Thiago, 1 pendente', async () => {
    leitura = LEO2;

    const r1 = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    const r2 = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(enviadas()).toHaveLength(1);
    expect(textoEnviado()).toContain('Qual o e-mail da sua conta no SolarDoc?');
    const avisos = (sendWhatsApp as any).mock.calls.filter((c: any[]) => c[0] === '34991360223');
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0][1])).toContain('SEM e-mail de conta');
    const reg = db.system_state.find((r) => r.key === `pix_solicitado:${TEL_FORMATO_USERS}`)!;
    expect(reg.value.origem).toBe('desconhecido');
    expect(reg.value.comprovante.e2eKey).toBe('pix_e2e:E00416968202610191940:27');
  });

  it('8b. leo1 depois de um pendente desconhecido: não libera, recebe a mensagem de data; o e-mail libera o bom', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    (sendHuman as any).mockClear();
    (sendWhatsApp as any).mockClear();

    leitura = LEO1;
    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    // Há pendente (sinal do SolarDoc): o comprovante velho recebe a mensagem fixa de data
    expect(r).toBe(true);
    expect(enviadas()).toHaveLength(1);
    expect(textoEnviado()).toContain('Esse comprovante é de 28/08');
    expect(db.users[0]!.plano).toBe('free');

    const venc = await liberarComprovantePendente(TEL, 'leoimplant@gmail.com', null, 'io');
    expect(venc).toBeInstanceOf(Date);
    expect(db.users[0]!.plano).toBe('pro');
  });

  it('8c. SEGUNDO comprovante diferente com pendente aberto: não sobrescreve, não pede de novo, avisa o Thiago', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    (sendHuman as any).mockClear();
    (sendWhatsApp as any).mockClear();

    leitura = { ...LEO2, data: '2026-10-20', id_transacao: 'E999999992026102013000AAAAAAAAAA' };
    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(enviadas()).toHaveLength(0);
    expect((sendWhatsApp as any).mock.calls.some((c: any[]) => String(c[1]).includes('SEGUNDO comprovante'))).toBe(true);
    const reg = db.system_state.find((x) => x.key === `pix_solicitado:${TEL_FORMATO_USERS}`)!;
    expect(reg.value.comprovante.dedupKey).toBe(`pix_comprov:${TEL}:27:2026-10-19`);
  });

  it('8d. erro (não 23505) ao gravar a marca do pedido: pede o e-mail mesmo assim', async () => {
    leitura = LEO2;
    falhaMarcaDoPedido = true;

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(enviadas()).toHaveLength(1);
    expect(textoEnviado()).toContain('Qual o e-mail');
  });

  it('9. a Duda só cede enquanto o pendente for recente (48h)', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    expect(await temComprovantePendente(TEL)).toBe(true);

    vi.setSystemTime(new Date('2026-10-22T17:01:00Z')); // 48h e 1 min depois
    expect(await temComprovantePendente(TEL)).toBe(false);
    // mas o e-mail ainda libera (prazo do registro, 30 dias)
    expect(await temComprovantePendente(TEL, 720)).toBe(true);
  });

  it('4c. e-mail DIGITADO de conta existente SEM senha: não manda link e não toma o WhatsApp', async () => {
    leitura = LEO2;
    db.users[0] = conta({ password_hash: null, reset_token: 'tok-secreto', whatsapp: '34900000000' });
    // registro do Pix pedido pela Giovanna, com o e-mail que o cliente digitou
    db.system_state.push({
      key: `pix_solicitado:${TEL_FORMATO_USERS}`,
      value: { valor: 67, email: 'leoimplant@gmail.com', nome: null, em: new Date().toISOString(), comprovante: null },
    });

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(true);
    expect(db.users[0]!.plano).toBe('pro');
    expect(db.users[0]!.whatsapp).toBe('34900000000');
    const t = enviadas().map((c) => c[1].join(' ')).join(' ');
    expect(t).not.toMatch(/redefinir|tok-secreto/);
  });
});

describe('chave antiga do pix_solicitado', () => {
  const reg = (extra: Row = {}) => ({
    valor: 67, email: null, nome: null, em: new Date().toISOString(),
    comprovante: { valor: 27, dedupKey: 'pix_comprov:x', passou: true, em: new Date().toISOString() }, ...extra,
  });

  it('10. número de 12 dígitos (sem o 9) gravado na chave antiga ainda é lido', async () => {
    // antes: slice(-11) dos 12 dígitos 553498364589 = 53498364589
    db.system_state.push({ key: 'pix_solicitado:53498364589', value: reg() });
    expect((await lerPixSolicitado('553498364589'))?.valor).toBe(67);
    expect(await temComprovantePendente('553498364589')).toBe(true);
  });

  it('10b. número de 10 dígitos (sem 55, sem 9) gravado na chave antiga ainda é lido', async () => {
    db.system_state.push({ key: 'pix_solicitado:3498364589', value: reg() });
    expect((await lerPixSolicitado('3498364589'))?.valor).toBe(67);
    expect(await temComprovantePendente('3498364589')).toBe(true);
  });

  it('10c. a chave nova tem prioridade sobre a antiga', async () => {
    db.system_state.push({ key: 'pix_solicitado:53498364589', value: reg({ valor: 11 }) });
    db.system_state.push({ key: 'pix_solicitado:34998364589', value: reg({ valor: 22 }) });
    expect((await lerPixSolicitado('553498364589'))?.valor).toBe(22);
  });
});

describe('reenvio já usado e falha ao criar a conta', () => {
  it('11. reenvio de comprovante já usado: sem legenda cala (true); com pergunta segue o fluxo normal (false)', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');
    (sendHuman as any).mockClear();

    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'O cliente enviou esta imagem.')).toBe(true);
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'e agora, como eu entro?')).toBe(false);
    expect(enviadas()).toHaveLength(0);
  });

  it('11b. o mesmo Pix de outro telefone sem sinal do SolarDoc: fluxo de hoje (false), com ou sem legenda', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'leoimplant@gmail.com');
    leitura = { ...LEO2, id_transacao: 'E00416968202610191940uHT9pUwumly' };

    expect(await tryProcessAbandonedPixComprovante('5534988887777', IMG, 'io', '')).toBe(false);
    expect(await tryProcessAbandonedPixComprovante('5534988887777', IMG, 'io', 'já liberou?')).toBe(false);
  });

  it('12. falha ao criar a conta: o Thiago é avisado UMA vez, mesmo com duas tentativas', async () => {
    leitura = LEO2;
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    (sendWhatsApp as any).mockClear();
    falhaCriarConta = true;

    const v1 = await liberarComprovantePendente(TEL, 'novo@cliente.com', null, 'io');
    const v2 = await liberarComprovantePendente(TEL, 'novo@cliente.com', null, 'io');

    expect(v1).toBeNull();
    expect(v2).toBeNull();
    const falhas = (sendWhatsApp as any).mock.calls.filter((c: any[]) => String(c[1]).includes('FALHEI'));
    expect(falhas).toHaveLength(1);
    // O pendente continua (nova tentativa pode funcionar) e a conta é criada quando o banco volta.
    falhaCriarConta = false;
    const v3 = await liberarComprovantePendente(TEL, 'novo@cliente.com', null, 'io');
    expect(v3).toBeInstanceOf(Date);
  });
});

describe('reprovado: uma explicação por comprovante e teto de 3 em 24h', () => {
  const variante = (dia: string) => ({ ...AND3, data: dia });

  it('13. o MESMO comprovante reprovado duas vezes: explica uma vez, a 2ª é silêncio (true)', async () => {
    leitura = AND3;
    db.wa_mensagens.push(mensagemRecebida('é leoimplant@gmail.com'));

    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(1);
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(1);
    // já explicado, mas agora com pergunta na legenda: o fluxo normal responde
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', 'e agora?')).toBe(false);
    expect(enviadas()).toHaveLength(1);
  });

  it('14. do 3º reprovado em 24h: o Thiago é avisado UMA vez e o robô cala', async () => {
    db.wa_mensagens.push(mensagemRecebida('é leoimplant@gmail.com'));
    const avisosDoTeto = () => (sendWhatsApp as any).mock.calls
      .filter((c: any[]) => String(c[1]).includes('REPROVADO deste número em 24h'));

    leitura = variante('2026-10-07');
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    leitura = variante('2026-10-08');
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    expect(enviadas()).toHaveLength(2);
    expect(avisosDoTeto()).toHaveLength(0);

    leitura = variante('2026-10-09'); // 3º
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(2);
    expect(avisosDoTeto()).toHaveLength(1);

    leitura = variante('2026-10-10'); // 4º: continua calado e não avisa de novo
    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(true);
    expect(enviadas()).toHaveLength(2);
    expect(avisosDoTeto()).toHaveLength(1);
  });

  it('14b. passadas 24h o contador recomeça', async () => {
    db.wa_mensagens.push(mensagemRecebida('é leoimplant@gmail.com'));
    for (const d of ['2026-10-07', '2026-10-08', '2026-10-09']) {
      leitura = variante(d);
      await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    }
    expect(enviadas()).toHaveLength(2);
    vi.setSystemTime(new Date('2026-10-21T17:30:00Z'));
    db.wa_mensagens.push(mensagemRecebida('é leoimplant@gmail.com'));
    leitura = variante('2026-10-20');
    await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');
    expect(enviadas()).toHaveLength(3);
  });

  it('15. R$ 5.000 para terceiro, sem sinal do SolarDoc: fluxo de hoje (false), sem handoff e sem mensagem', async () => {
    leitura = { ...AND3, valor: 5000 };

    const r = await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '');

    expect(r).toBe(false);
    expect(enviadas()).toHaveLength(0);
    expect((sendWhatsApp as any).mock.calls).toHaveLength(0);
    expect(db.system_state.some((x) => x.key.startsWith('pix_handoff:'))).toBe(false);
  });

  it('16. pausa humana na conversa: o robô não fala por cima', async () => {
    const { podeFalarComLead } = await import('../services/agents/whatsapp/pausaHumana');
    (podeFalarComLead as any).mockResolvedValueOnce({ pode: false });
    leitura = AND3;
    db.wa_mensagens.push(mensagemRecebida('é leoimplant@gmail.com'));

    expect(await tryProcessAbandonedPixComprovante(TEL, IMG, 'io', '')).toBe(false);
    expect(enviadas()).toHaveLength(0);
  });
});
