import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Pacote A7: o mesmo código de transação (txid) do comprovante de Pix não libera
// duas vezes. A liberação pela FOTO continua; só o mesmo código vindo de OUTRO
// número é barrado. Ilegível, sem segredo ou erro na checagem = como sempre foi.
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>;
const db: Record<string, Row[]> = { system_state: [], users: [], abandoned_checkouts: [], kit_pedidos: [] };
// Erro injetado no insert de chaves pix_txid (null = nenhum).
let erroInsertTxid: { code: string; message: string } | null = null;
// Quantas leituras de chave pix_txid ainda voltam vazias (simula a corrida: a checagem
// lê antes de o outro número gravar, e só o insert da reserva encontra a chave).
let leiturasTxidCegas = 0;
// Erro injetado no insert da trava do aviso ao Thiago (pix_txid_aviso:).
let erroInsertAviso: { code: string; message: string } | null = null;

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  let pendente: Row | null = null;
  let patch: Row | null = null;
  let onConflict = '';
  const linhas = () => (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'insert') {
      if (table === 'system_state' && erroInsertTxid && String(pendente!.key).startsWith('pix_txid:')) {
        return { data: null, error: erroInsertTxid };
      }
      if (table === 'system_state' && erroInsertAviso && String(pendente!.key).startsWith('pix_txid_aviso:')) {
        return { data: null, error: erroInsertAviso };
      }
      if ((db[table] ?? []).some((r) => r.key !== undefined && r.key === pendente!.key)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      db[table] = [...(db[table] ?? []), { ...pendente! }];
      return { data: pendente, error: null };
    }
    if (modo === 'upsert') {
      const existente = onConflict ? (db[table] ?? []).find((r) => r[onConflict] === pendente![onConflict]) : undefined;
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
    const achadas = linhas();
    if (table === 'system_state' && leiturasTxidCegas > 0 && achadas.some((r) => String(r.key).startsWith('pix_txid:'))) {
      leiturasTxidCegas--;
      return { data: [], error: null };
    }
    return { data: achadas.map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    insert: (row: Row) => { modo = 'insert'; pendente = row; return q; },
    upsert: (row: Row, opts?: { onConflict?: string }) => { modo = 'upsert'; pendente = row; onConflict = opts?.onConflict || ''; return q; },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
    neq: (col: string, val: any) => { filtros.push((r) => String(r[col]) !== String(val)); return q; },
    in: (col: string, vals: any[]) => { filtros.push((r) => vals.map(String).includes(String(r[col]))); return q; },
    // ilike sem curinga (o serviço escapa _ e %): igualdade sem caixa.
    ilike: (col: string, val: string) => {
      const alvo = String(val).replace(/\\(.)/g, '$1').toLowerCase();
      filtros.push((r) => String(r[col] ?? '').toLowerCase() === alvo); return q;
    },
    gte: () => q, not: () => q, order: () => q, limit: () => q,
    single: async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
    maybeSingle: async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

const h = vi.hoisted(() => ({ lerIA: vi.fn() }));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({ messages: { create: h.lerIA } }) }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async () => {}), sendHuman: vi.fn(async () => {}),
  sendImage: vi.fn(async () => {}), sendDocument: vi.fn(async () => {}),
}));

import {
  validarComprovante, normalizarTxid,
  tryProcessPixComprovante, liberarComprovantePendente, tryProcessAbandonedPixComprovante,
} from '../services/agents/whatsapp/pixComprovanteService';
import { guardarComprovantePendente } from '../services/agents/whatsapp/pixSolicitado';
import { sendHuman, sendWhatsApp } from '../services/agents/zapiClient';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';

const AIOROS = '63636043000188';
const FONE_A = '5534991110001';
const FONE_B = '5534992220002';
const TXID = 'E18236120202610201234ABCDEFGH12';
const SEGREDO = 'segredo-de-teste';

const comprovante = (over: Record<string, any> = {}) => ({
  is_comprovante: true, valor: 67, recebedor_nome: 'AIOROS GROUP', recebedor_documento: AIOROS,
  data: new Date().toISOString().slice(0, 10), id_transacao: TXID, ...over,
}) as any;

const img = { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } as any;
const chaveDe = (txid: string) => `pix_txid:${crypto.createHash('sha256').update(txid).digest('hex')}`;
// O dono esperado vem do próprio hmacDe (lê a env a cada chamada), nunca de valor fixo.
const hmacFone = (fone: string) => hmacDe(fone.slice(-11))!;
// Registro gravado por `fone` com a chave de HMAC de AGORA (kid atual).
const registro = (fone: string) => ({ dono: hmacFone(fone), kid: idChaveHmac()!, valor: 67, em: 'x' });
const linhasTxid = () => db.system_state.filter((r) => String(r.key).startsWith('pix_txid:'));
const usuario = (id: string, email: string) => ({
  id, email, plano: 'free', billing_status: 'free', plano_expira_em: null, password_hash: 'x', reset_token: null,
});
const avisosAoThiago = () => (sendWhatsApp as any).mock.calls.map((c: any[]) => c[1]).join('\n');
const handoffDe = (fone: string) => db.system_state.find((r) => r.key === `pix_handoff:${fone.slice(-11)}`)?.value;
const textosAoCliente = () => (sendHuman as any).mock.calls.map((c: any[]) => (c[1] as string[]).join(' ')).join('\n');

const envOriginal = { ...process.env };
beforeEach(() => {
  db.system_state = []; db.users = []; db.abandoned_checkouts = []; db.kit_pedidos = [];
  erroInsertTxid = null;
  leiturasTxidCegas = 0;
  erroInsertAviso = null;
  process.env.AGENTES5040_HMAC = SEGREDO;
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.lerIA.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(comprovante()) }] });
});
afterEach(() => { process.env = { ...envOriginal }; vi.restoreAllMocks(); });

describe('normalizarTxid', () => {
  it('maiúsculas, só letra e número', () => {
    expect(normalizarTxid('e1823-6120.2026 1020/1234abcdefgh12')).toBe('E18236120202610201234ABCDEFGH12');
  });
  it('menos de 20 caracteres, vazio ou não-texto = ilegível', () => {
    expect(normalizarTxid('E123')).toBeNull();
    expect(normalizarTxid('1234567890123456789')).toBeNull(); // 19
    expect(normalizarTxid('12345678901234567890')).toBe('12345678901234567890'); // 20
    expect(normalizarTxid('---')).toBeNull();
    expect(normalizarTxid(null)).toBeNull();
    expect(normalizarTxid(12345678901234567890 as any)).toBeNull();
  });
});

describe('segredo do HMAC (o do agentes5040/hmac.ts)', () => {
  it('o dono gravado é o hmacDe do telefone com a env AGENTES5040_HMAC', async () => {
    db.users.push(usuario('u1', 'a@x.com'));
    await tryProcessPixComprovante({ id: 'u1', email: 'a@x.com', plano: 'free' }, img, FONE_A);
    expect(linhasTxid()[0].value.dono).toBe(hmacDe(FONE_A.slice(-11)));
  });
  it('sem a env, usa a chave derivada da chave de serviço (e o dono continua o hmacDe)', async () => {
    delete process.env.AGENTES5040_HMAC;
    process.env.SUPABASE_SERVICE_KEY = 'chave-de-servico';
    db.users.push(usuario('u1', 'a@x.com'));
    await tryProcessPixComprovante({ id: 'u1', email: 'a@x.com', plano: 'free' }, img, FONE_A);
    expect(linhasTxid()[0].value.dono).toBe(hmacDe(FONE_A.slice(-11)));
    // e muda quando o segredo muda: prova que veio mesmo do segredo
    process.env.SUPABASE_SERVICE_KEY = 'outra-chave';
    expect(linhasTxid()[0].value.dono).not.toBe(hmacDe(FONE_A.slice(-11)));
  });
  it('a env com espaços nas pontas vale igual à sem espaços (trim do hmac.ts)', async () => {
    process.env.AGENTES5040_HMAC = `  ${SEGREDO}  `;
    db.users.push(usuario('u1', 'a@x.com'));
    await tryProcessPixComprovante({ id: 'u1', email: 'a@x.com', plano: 'free' }, img, FONE_A);
    const comEspaco = linhasTxid()[0].value.dono;
    process.env.AGENTES5040_HMAC = SEGREDO;
    expect(comEspaco).toBe(hmacDe(FONE_A.slice(-11)));
  });
  it('nenhum segredo = checagem desligada (nada gravado, libera como hoje)', async () => {
    delete process.env.AGENTES5040_HMAC; delete process.env.SUPABASE_SERVICE_KEY;
    expect(hmacDe('x')).toBeNull();
    db.users.push(usuario('u1', 'a@x.com'));
    await tryProcessPixComprovante({ id: 'u1', email: 'a@x.com', plano: 'free' }, img, FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(0);
  });
});

describe('validarComprovante com o código da transação', () => {
  it('devolve o código normalizado', async () => {
    const r = await validarComprovante(comprovante({ id_transacao: 'e1823-6120202610201234abcdefgh12' }), FONE_A);
    expect(r.txid).toBe(TXID);
    expect(r.passou).toBe(true);
  });

  it('recusa quando o dono gravado é OUTRO número', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    const r = await validarComprovante(comprovante(), FONE_B);
    expect(r.passou).toBe(false);
    expect(r.motivo).toBe('código já usado por outro número');
  });

  it('o MESMO número segue (o dedup de sempre é quem trata reenvio)', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    const r = await validarComprovante(comprovante(), FONE_A);
    expect(r.passou).toBe(true);
    expect(r.motivo).toBe('ok');
  });

  it('o mesmo número sem o 55 na frente é o mesmo dono', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    const r = await validarComprovante(comprovante(), FONE_A.slice(2));
    expect(r.passou).toBe(true);
  });

  it('código ilegível ou curto não consulta nem barra', async () => {
    db.system_state.push({ key: chaveDe('E123'), value: registro(FONE_A) });
    for (const id of ['E123', null, '']) {
      const r = await validarComprovante(comprovante({ id_transacao: id }), FONE_B);
      expect(r.passou).toBe(true);
      expect(r.txid).toBeNull();
    }
  });

  it('sem segredo nenhum, a checagem fica desligada', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    delete process.env.AGENTES5040_HMAC; delete process.env.SUPABASE_SERVICE_KEY;
    const r = await validarComprovante(comprovante(), FONE_B);
    expect(r.passou).toBe(true);
  });
});

describe('troca do segredo do HMAC (kid)', () => {
  it('registro gravado com OUTRA chave (kid diferente) segue: não vira "outro número"', async () => {
    // O MESMO número gravou com a chave antiga; com a nova, o HMAC dele muda.
    const antigo = registro(FONE_A);
    process.env.AGENTES5040_HMAC = 'segredo-novo';
    expect(idChaveHmac()).not.toBe(antigo.kid);
    expect(hmacFone(FONE_A)).not.toBe(antigo.dono);
    db.system_state.push({ key: chaveDe(TXID), value: antigo });
    const r = await validarComprovante(comprovante(), FONE_A);
    expect(r.passou).toBe(true);
    expect(r.txidDeOutro).toBe(false);
    // E a reserva (23505 com kid antigo) também segue: libera.
    db.users.push(usuario('u1', 'u1@x.com'));
    await tryProcessPixComprovante({ id: 'u1', email: 'u1@x.com', plano: 'free' }, img, FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
  });

  it('a troca da SUPABASE_SERVICE_KEY (sem AGENTES5040_HMAC) também segue', async () => {
    delete process.env.AGENTES5040_HMAC;
    process.env.SUPABASE_SERVICE_KEY = 'servico-velho';
    const antigo = registro(FONE_A);
    process.env.SUPABASE_SERVICE_KEY = 'servico-novo';
    db.system_state.push({ key: chaveDe(TXID), value: antigo });
    expect((await validarComprovante(comprovante(), FONE_A)).passou).toBe(true);
  });

  it('registro antigo SEM kid segue, mesmo com dono diferente', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: { dono: hmacFone(FONE_A), valor: 67, em: 'x' } });
    const r = await validarComprovante(comprovante(), FONE_B);
    expect(r.passou).toBe(true);
    db.users.push(usuario('u2', 'u2@x.com'));
    await tryProcessPixComprovante({ id: 'u2', email: 'u2@x.com', plano: 'free' }, img, FONE_B);
    expect(db.users[0].plano).toBe('ilimitado');
  });

  it('mesmo kid e dono diferente continua barrando (controle)', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    expect((await validarComprovante(comprovante(), FONE_B)).passou).toBe(false);
  });
});

describe('reserva ANTES de achar/criar a conta', () => {
  const contaCriada = (email: string) => db.users.some((u) => u.email === email);

  it('e-mail depois: código de outro número não cria conta nem libera', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    await guardarComprovantePendente(FONE_B, {
      valor: 67, dedupKey: `pix_comprov:${FONE_B}:67:hoje`, passou: true, em: new Date().toISOString(), txid: TXID,
    });
    expect(await liberarComprovantePendente(FONE_B, 'novo@x.com', null)).toBeNull();
    expect(contaCriada('novo@x.com')).toBe(false);
    expect(avisosAoThiago()).toContain('código já usado por outro número');
    const reg = db.system_state.find((r) => r.key.startsWith('pix_solicitado:'))!;
    expect(reg.value.comprovante).toBeNull();
  });

  it('Pix pedido com e-mail: código de outro número não cria conta nem libera', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    // A checagem do validarComprovante não vê (corrida): quem barra é a reserva antes da conta.
    leiturasTxidCegas = 1;
    db.system_state.push({
      key: `pix_solicitado:${FONE_B.slice(-11)}`, value: { valor: 67, email: 'novo@x.com', nome: null, em: new Date().toISOString() },
    });
    await tryProcessAbandonedPixComprovante(FONE_B, img);
    expect(contaCriada('novo@x.com')).toBe(false);
    expect(db.system_state.some((r) => String(r.key).startsWith('pix_comprov:'))).toBe(false);
    expect(avisosAoThiago()).toContain('código já usado por outro número');
    expect(textosAoCliente()).toContain('já foi usado para liberar um acesso antes');
  });
});

describe('caminho 1: tryProcessPixComprovante (cliente com conta)', () => {
  const chamar = (id: string, fone: string) =>
    tryProcessPixComprovante({ id, email: `${id}@x.com`, plano: 'free' }, img, fone);

  it('primeiro número libera e grava a chave', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    await chamar('u1', FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(1);
    expect(linhasTxid()[0].key).toBe(chaveDe(TXID));
  });

  it('outro número com o mesmo código NÃO libera, avisa o Thiago e vai pra Giovanna (regra do reprovado)', async () => {
    db.users.push(usuario('u1', 'u1@x.com'), usuario('u2', 'u2@x.com'));
    await chamar('u1', FONE_A);
    vi.clearAllMocks();
    const tratou = await chamar('u2', FONE_B);
    expect(db.users[1].plano).toBe('free');
    expect(db.users[1].plano_expira_em).toBeNull();
    // Reprovado de conta conhecida: nada de frase fixa; a Giovanna responde com o handoff.
    expect(tratou).toBe(false);
    expect(sendHuman).not.toHaveBeenCalled();
    expect(handoffDe(FONE_B)).toMatchObject({ codigo: 'ja_usado', motivo: 'código já usado por outro número' });
    expect(avisosAoThiago()).toContain('código já usado por outro número');
  });

  it('corrida: a checagem não viu, mas a reserva acusa outro dono → não credita e vai pra Giovanna', async () => {
    db.users.push(usuario('u2', 'u2@x.com'));
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    // A 1ª leitura (a do validarComprovante) não vê a chave: o outro número gravou no meio.
    leiturasTxidCegas = 1;
    const tratou = await chamar('u2', FONE_B);
    expect(db.users[0].plano).toBe('free');
    expect(db.users[0].plano_expira_em).toBeNull();
    // O reserva vem ANTES do dedup: nenhum pix_comprov gravado, nada creditado.
    expect(db.system_state.some((r) => String(r.key).startsWith('pix_comprov:'))).toBe(false);
    expect(tratou).toBe(false);
    expect(sendHuman).not.toHaveBeenCalled();
    expect(handoffDe(FONE_B)).toMatchObject({ codigo: 'ja_usado', motivo: 'código já usado por outro número' });
    // Um aviso só ao Thiago (o do aplicarPagamentoPix), não dois.
    const avisos = (sendWhatsApp as any).mock.calls.filter((c: any[]) => String(c[1]).includes('código já usado por outro número'));
    expect(avisos).toHaveLength(1);
  });

  it('23505 do MESMO dono (sem linha de dedup) segue e libera', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    db.users.push(usuario('u1', 'u1@x.com'));
    await chamar('u1', FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(1); // a chave semeada, intocada
  });

  it('mesmo número reenviando: cai no dedup de sempre, sem liberar duas vezes', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    await chamar('u1', FONE_A);
    const venc = db.users[0].plano_expira_em;
    await chamar('u1', FONE_A);
    expect(db.users[0].plano_expira_em).toBe(venc);
  });

  it('erro que NÃO é 23505 no insert: libera como hoje', async () => {
    erroInsertTxid = { code: '57014', message: 'timeout' };
    db.users.push(usuario('u1', 'u1@x.com'));
    await chamar('u1', FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
  });

  it('sem segredo: libera como hoje e não grava chave nenhuma', async () => {
    delete process.env.AGENTES5040_HMAC; delete process.env.SUPABASE_SERVICE_KEY;
    db.users.push(usuario('u1', 'u1@x.com'));
    await chamar('u1', FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(0);
  });

  it('código ilegível: libera como hoje e não grava chave', async () => {
    h.lerIA.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(comprovante({ id_transacao: 'E12' })) }] });
    db.users.push(usuario('u1', 'u1@x.com'));
    await chamar('u1', FONE_A);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(0);
  });
});

describe('caminho 2: liberarComprovantePendente (e-mail depois)', () => {
  async function pendente(fone: string, txid: string | null) {
    await guardarComprovantePendente(fone, {
      valor: 67, dedupKey: `pix_comprov:${fone}:67:hoje`, passou: true, em: new Date().toISOString(), txid,
    });
  }

  it('o código passa pelo guardarComprovantePendente', async () => {
    await pendente(FONE_A, TXID);
    const reg = db.system_state.find((r) => r.key.startsWith('pix_solicitado:'))!;
    expect(reg.value.comprovante.txid).toBe(TXID);
  });

  it('libera quando o código é novo e grava a chave', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    await pendente(FONE_A, TXID);
    const venc = await liberarComprovantePendente(FONE_A, 'u1@x.com', null);
    expect(venc).toBeInstanceOf(Date);
    expect(linhasTxid()).toHaveLength(1);
  });

  it('outro número com o código já usado: não libera e avisa o Thiago', async () => {
    db.users.push(usuario('u2', 'u2@x.com'));
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    await pendente(FONE_B, TXID);
    const venc = await liberarComprovantePendente(FONE_B, 'u2@x.com', null);
    expect(venc).toBeNull();
    expect(db.users[0].plano).toBe('free');
    expect(avisosAoThiago()).toContain('código já usado por outro número');
  });

  it('sem código no pendente: libera como hoje', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    await pendente(FONE_A, null);
    expect(await liberarComprovantePendente(FONE_A, 'u1@x.com', null)).toBeInstanceOf(Date);
    expect(linhasTxid()).toHaveLength(0);
  });

  it('erro que não é 23505: libera como hoje', async () => {
    erroInsertTxid = { code: '08006', message: 'conexão' };
    db.users.push(usuario('u1', 'u1@x.com'));
    await pendente(FONE_A, TXID);
    expect(await liberarComprovantePendente(FONE_A, 'u1@x.com', null)).toBeInstanceOf(Date);
  });
});

describe('caminho sem e-mail: a reserva já acontece quando o comprovante passou', () => {
  const seedSemEmail = (fone: string) => db.system_state.push({
    key: `pix_solicitado:${fone.slice(-11)}`, value: { valor: 67, email: null, nome: null, em: new Date().toISOString() },
  });

  it('quem pagou e mandou a foto sem e-mail reserva o código; a foto de outro número vai à revisão', async () => {
    seedSemEmail(FONE_A);
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    expect(linhasTxid()).toHaveLength(1);
    expect(linhasTxid()[0].value.dono).toBe(hmacFone(FONE_A));
    const reg = db.system_state.find((r) => r.key.startsWith('pix_solicitado:'))!;
    expect(reg.value.comprovante).toMatchObject({ passou: true, txid: TXID });
    const r = await validarComprovante(comprovante(), FONE_B);
    expect(r.passou).toBe(false);
    expect(r.motivo).toBe('código já usado por outro número');
  });

  it('depois, o e-mail do mesmo número libera (23505 do mesmo dono segue)', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    seedSemEmail(FONE_A);
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    const venc = await liberarComprovantePendente(FONE_A, 'u1@x.com', null);
    expect(venc).toBeInstanceOf(Date);
    expect(db.users[0].plano).toBe('ilimitado');
  });

  it('sem segredo: nada é reservado e o pendente é o de hoje', async () => {
    delete process.env.AGENTES5040_HMAC; delete process.env.SUPABASE_SERVICE_KEY;
    seedSemEmail(FONE_A);
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    expect(linhasTxid()).toHaveLength(0);
    const reg = db.system_state.find((r) => r.key.startsWith('pix_solicitado:'))!;
    expect(reg.value.comprovante.passou).toBe(true);
  });
});

describe('caminho 3: tryProcessAbandonedPixComprovante (sem conta)', () => {
  const seedSolicitado = (fone: string, email: string) => db.system_state.push({
    key: `pix_solicitado:${fone.slice(-11)}`, value: { valor: 67, email, nome: null, em: new Date().toISOString() },
  });

  it('libera quando o código é novo', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    seedSolicitado(FONE_A, 'u1@x.com');
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(1);
  });

  it('outro número com o mesmo código não libera e avisa o Thiago', async () => {
    db.users.push(usuario('u1', 'u1@x.com'), usuario('u2', 'u2@x.com'));
    seedSolicitado(FONE_A, 'u1@x.com');
    seedSolicitado(FONE_B, 'u2@x.com');
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    vi.clearAllMocks();
    await tryProcessAbandonedPixComprovante(FONE_B, img);
    expect(db.users[1].plano).toBe('free');
    expect(db.users[1].plano_expira_em).toBeNull();
    // Regra do reprovado do main: 1 mensagem fixa da Giovanna (já usado), sem "já te libero".
    expect(textosAoCliente()).not.toContain('já te libero');
    expect(textosAoCliente()).toContain('já foi usado para liberar um acesso antes');
    expect(handoffDe(FONE_B)).toMatchObject({ codigo: 'ja_usado' });
    expect(avisosAoThiago()).toContain('código já usado por outro número');
  });

  it('erro que não é 23505: libera como hoje', async () => {
    erroInsertTxid = { code: '57014', message: 'timeout' };
    db.users.push(usuario('u1', 'u1@x.com'));
    seedSolicitado(FONE_A, 'u1@x.com');
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    expect(db.users[0].plano).toBe('ilimitado');
  });

  it('sem segredo: libera como hoje e não grava chave', async () => {
    delete process.env.AGENTES5040_HMAC; delete process.env.SUPABASE_SERVICE_KEY;
    db.users.push(usuario('u1', 'u1@x.com'));
    seedSolicitado(FONE_A, 'u1@x.com');
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(0);
  });
});

describe('caminho 4: número desconhecido (sem abandono e sem Pix pedido)', () => {
  // Só a chave pix_txid do outro número é semeada, sem pix_e2e: quem barra é a trava do
  // código, não a do E2E do main.
  it('e-mail de outra conta na legenda, mesmo código de outro número: não libera e avisa o Thiago', async () => {
    db.users.push(usuario('u2', 'u2@x.com'));
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    await tryProcessAbandonedPixComprovante(FONE_B, img, 'solardoc', 'u2@x.com');
    expect(db.users[0].plano).toBe('free');
    expect(db.users[0].plano_expira_em).toBeNull();
    expect(db.system_state.some((r) => String(r.key).startsWith('pix_e2e:'))).toBe(false);
    expect(avisosAoThiago()).toContain('código já usado por outro número');
    expect(textosAoCliente()).not.toContain('já te libero');
  });

  it('o mesmo cenário com código novo libera (prova que o bloqueio acima é da trava)', async () => {
    db.users.push(usuario('u2', 'u2@x.com'));
    await tryProcessAbandonedPixComprovante(FONE_B, img, 'solardoc', 'u2@x.com');
    expect(db.users[0].plano).toBe('ilimitado');
    expect(linhasTxid()).toHaveLength(1);
    expect(linhasTxid()[0].value.dono).toBe(hmacFone(FONE_B));
  });

  it('sem sinal do SolarDoc: cliente não ouve nada, Thiago avisado UMA vez por código', async () => {
    const FONE_C = '5534993330003';
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    const golpes = () => (sendWhatsApp as any).mock.calls
      .filter((c: any[]) => String(c[1]).includes('POSSÍVEL GOLPE') && String(c[1]).includes('código já usado por outro número'));

    expect(await tryProcessAbandonedPixComprovante(FONE_B, img)).toBe(false);
    expect(sendHuman).not.toHaveBeenCalled();
    expect(golpes()).toHaveLength(1);
    // Nada de pendente, nada de liberação, e a trava do aviso não leva telefone.
    expect(db.system_state.some((r) => String(r.key).startsWith('pix_solicitado:'))).toBe(false);
    const aviso = db.system_state.find((r) => String(r.key).startsWith('pix_txid_aviso:'))!;
    expect(aviso.key).toBe(`pix_txid_aviso:${chaveDe(TXID).slice('pix_txid:'.length)}`);
    for (const pedaco of [FONE_B, FONE_B.slice(-8)]) expect(JSON.stringify(aviso)).not.toContain(pedaco);

    // O mesmo código de novo (o mesmo número ou um terceiro): não avisa outra vez.
    await tryProcessAbandonedPixComprovante(FONE_B, img);
    await tryProcessAbandonedPixComprovante(FONE_C, img);
    expect(golpes()).toHaveLength(1);
    expect(sendHuman).not.toHaveBeenCalled();
  });

  it('sem sinal, reprovado por OUTRO motivo (recebedor errado): segue calado e sem aviso', async () => {
    h.lerIA.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(comprovante({ recebedor_nome: 'OUTRA LTDA', recebedor_documento: '11111111000111' })) }] });
    expect(await tryProcessAbandonedPixComprovante(FONE_B, img)).toBe(false);
    expect(sendHuman).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(db.system_state.some((r) => String(r.key).startsWith('pix_txid_aviso:'))).toBe(false);
  });

  it('sem sinal: erro (não 23505) na reserva do aviso avisa mesmo assim', async () => {
    db.system_state.push({ key: chaveDe(TXID), value: registro(FONE_A) });
    erroInsertAviso = { code: '57014', message: 'timeout' };
    await tryProcessAbandonedPixComprovante(FONE_B, img);
    expect(avisosAoThiago()).toContain('POSSÍVEL GOLPE');
  });

  it('sem conta: o pendente guarda o código e já o reserva', async () => {
    await tryProcessAbandonedPixComprovante(FONE_A, img);
    const reg = db.system_state.find((r) => r.key.startsWith('pix_solicitado:'))!;
    expect(reg.value.comprovante).toMatchObject({ passou: true, txid: TXID });
    expect(linhasTxid()[0].value.dono).toBe(hmacFone(FONE_A));
  });
});

describe('privacidade: nenhum dígito de telefone na chave nem no valor', () => {
  it('chave e valor gravados não têm o telefone, inteiro ou em pedaço', async () => {
    db.users.push(usuario('u1', 'u1@x.com'));
    await tryProcessPixComprovante({ id: 'u1', email: 'u1@x.com', plano: 'free' }, img, FONE_A);
    const linha = linhasTxid()[0];
    expect(linha).toBeTruthy();
    const texto = JSON.stringify(linha);
    for (const pedaco of [FONE_A, FONE_A.slice(2), FONE_A.slice(-8), '991110001']) {
      expect(texto).not.toContain(pedaco);
    }
    expect(Object.keys(linha.value).sort()).toEqual(['dono', 'em', 'kid', 'valor']);
    expect(linha.value.kid).toBe(idChaveHmac());
    expect(linha.value.kid).toMatch(/^[0-9a-f]{8}$/);
    expect(linha.value.dono).toMatch(/^[0-9a-f]{64}$/);
    expect(linha.key).toMatch(/^pix_txid:[0-9a-f]{64}$/);
  });
});
