import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fake do Supabase com estado em memória ──────────────────────────────────
// Não é mock "sempre retorna null": guarda linhas de verdade, respeita UNIQUE de
// users.email e de kit_pedidos.order_id. É o que permite testar idempotência —
// o comportamento que mais importa num webhook que a Kiwify reentrega.

type Row = Record<string, any>;
const db: Record<string, Row[]> = { users: [], kit_pedidos: [], kit_progresso: [] };
const emails = new Set<string>();

function novoId(): string {
  return 'id-' + Math.random().toString(36).slice(2, 10);
}

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let onConflict = '';

  const linhas = () => db[table].filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'insert' || modo === 'upsert') {
      const row = { ...pendente! };
      if (modo === 'upsert' && onConflict) {
        const existente = db[table].find((r) => r[onConflict] === row[onConflict]);
        if (existente) {
          Object.assign(existente, row);
          return { data: existente, error: null };
        }
      }
      if (table === 'users') {
        const email = String(row.email || '').toLowerCase();
        if (emails.has(email)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        emails.add(email);
      }
      row.id = row.id || novoId();
      row.criado_em = row.criado_em || new Date().toISOString();
      db[table].push(row);
      return { data: row, error: null };
    }
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos, error: null };
    }
    if (modo === 'delete') {
      const alvos = new Set(linhas());
      db[table] = db[table].filter((r) => !alvos.has(r));
      return { data: null, error: null };
    }
    // Cópia rasa: a rede devolve JSON, não referência. Sem isso um upsert
    // posterior mutaria a linha que o chamador já tinha lido — e o teste
    // acreditaria num comportamento que produção não tem.
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
    // ISO em string compara lexicograficamente na ordem certa
    gt: (col: string, val: any) => { filtros.push((r) => r[col] != null && String(r[col]) > String(val)); return q; },
    order: () => q,
    // .or('user_id.eq.X,email.eq.Y')
    or: (expr: string) => {
      const condicoes = expr.split(',').map((parte) => {
        const [col, , val] = parte.split('.');
        return (r: Row) => String(r[col]) === String(val);
      });
      filtros.push((r) => condicoes.some((c) => c(r)));
      return q;
    },
    maybeSingle: async () => {
      const { data, error } = executa();
      return { data: Array.isArray(data) ? data[0] ?? null : data, error };
    },
    single: async () => {
      const { data, error } = executa();
      const linha = Array.isArray(data) ? data[0] ?? null : data;
      return { data: linha, error: error ?? (linha ? null : { code: 'PGRST116' }) };
    },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));

const enviados: any[] = [];
vi.mock('../utils/mailer', () => ({
  sendKitAcessoEmail: vi.fn(async (opts: any) => { enviados.push(opts); }),
}));

import {
  classificarProdutoKit,
  processarEventoKit,
  acessoDoUsuario,
  type EventoKit,
} from '../services/kitIntegradorService';

const EMAIL = 'integrador@teste.com';

function evento(over: Partial<EventoKit> = {}): EventoKit {
  return {
    orderId: 'ORDER-1',
    email: EMAIL,
    nome: 'Integrador Teste',
    telefone: '(34) 99999-0000',
    produto: 'Kit de Fechamento do Integrador',
    item: 'kit',
    status: 'paid',
    valorCentavos: 2700,
    utm: { utm_source: 'FB', utm_campaign: 'kit|123', utm_medium: 'ads', utm_content: null, utm_term: null },
    payload: { teste: true },
    ...over,
  };
}

beforeEach(() => {
  db.users = [];
  db.kit_pedidos = [];
  db.kit_progresso = [];
  emails.clear();
  enviados.length = 0;
});

describe('classificarProdutoKit', () => {
  it('reconhece o produto principal e os bumps pelo nome', () => {
    expect(classificarProdutoKit('Kit de Fechamento do Integrador', null)).toBe('kit');
    expect(classificarProdutoKit('kit fechamento', null)).toBe('kit');
    expect(classificarProdutoKit('SolarDoc VIP — 30 dias', null)).toBe('bump_vip');
    expect(classificarProdutoKit('Kit de Prospecção', null)).toBe('bump_prospeccao');
  });

  it('NÃO captura produtos do LimpaPro (que é outro negócio, outro funil)', () => {
    expect(classificarProdutoKit('Limpa Solar Pro', null)).toBeNull();
    expect(classificarProdutoKit('Comunidade +Sol', null)).toBeNull();
    expect(classificarProdutoKit('Kit Captação', null)).toBeNull();
    expect(classificarProdutoKit('Telhados e Usinas', null)).toBeNull();
    expect(classificarProdutoKit('Contrato Recorrente', null)).toBeNull();
    expect(classificarProdutoKit(null, null)).toBeNull();
  });
});

describe('processarEventoKit — compra do kit', () => {
  it('pedido pendente só registra: não cria conta nem libera nada', async () => {
    const r = await processarEventoKit(evento({ status: 'waiting_payment' }));
    expect(r.acao).toBe('registrado');
    expect(db.users).toHaveLength(0);
    expect(db.kit_pedidos).toHaveLength(1);
  });

  it('compra aprovada cria a conta PENDENTE e manda o e-mail de acesso', async () => {
    const r = await processarEventoKit(evento());
    expect(r.acao).toBe('acesso_liberado');
    expect(r.contaCriada).toBe(true);

    const user = db.users[0];
    expect(user.password_hash).toBeNull();      // conta pendente — cliente define a senha
    expect(user.reset_token).toBeTruthy();      // é o link que vai no e-mail
    expect(user.plano).toBe('free');
    expect(user.limite_documentos).toBe(10);
    expect(user.whatsapp).toBe('34999990000');  // normalizado
    expect(user.utm_source).toBe('FB');

    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(EMAIL);
    expect(enviados[0].resetUrl).toContain('mode=redefinir');
  });

  // Este é o caminho de ~80% da receita (Pix): a Kiwify manda waiting_payment
  // quando o código é gerado e paid quando cai. Se o e-mail fosse gateado por
  // "pedido novo", quem paga no Pix nunca receberia o link de acesso.
  it('Pix: waiting_payment e depois paid no MESMO pedido manda o e-mail', async () => {
    await processarEventoKit(evento({ status: 'waiting_payment' }));
    expect(enviados).toHaveLength(0);
    expect(db.users).toHaveLength(0);

    const r = await processarEventoKit(evento({ status: 'paid' }));
    expect(r.acao).toBe('acesso_liberado');
    expect(r.contaCriada).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].resetUrl).toContain('mode=redefinir');
  });

  it('Pix aprovado e reentregue não manda o e-mail duas vezes', async () => {
    await processarEventoKit(evento({ status: 'waiting_payment' }));
    await processarEventoKit(evento({ status: 'paid' }));
    const r = await processarEventoKit(evento({ status: 'paid' }));

    expect(r.acao).toBe('ja_processado');
    expect(enviados).toHaveLength(1);
    expect(db.users).toHaveLength(1);
  });

  it('reembolso do bump revoga o trial que estava correndo', async () => {
    await processarEventoKit(evento());
    await processarEventoKit(evento({ orderId: 'ORDER-2', item: 'bump_vip' }));
    expect(db.users[0].pack_trial_until).toBeTruthy();

    await processarEventoKit(evento({ orderId: 'ORDER-2', item: 'bump_vip', status: 'refunded' }));
    expect(db.users[0].pack_trial_until).toBeNull();
  });

  it('reentrega do mesmo pedido não duplica conta nem reenvia e-mail', async () => {
    await processarEventoKit(evento());
    const r2 = await processarEventoKit(evento());

    expect(r2.acao).toBe('ja_processado');
    expect(db.users).toHaveLength(1);
    expect(db.kit_pedidos).toHaveLength(1);
    expect(enviados).toHaveLength(1);
  });

  it('quem já tem conta na plataforma não vira conta nova nem perde a senha', async () => {
    db.users.push({ id: 'u1', email: EMAIL, password_hash: 'hash-existente', plano: 'pro' });
    emails.add(EMAIL);

    const r = await processarEventoKit(evento());
    expect(r.contaCriada).toBe(false);
    expect(r.userId).toBe('u1');
    expect(db.users).toHaveLength(1);
    expect(db.users[0].password_hash).toBe('hash-existente');
  });
});

describe('processarEventoKit — bump do VIP', () => {
  it('concede 30 dias de ilimitado', async () => {
    await processarEventoKit(evento());
    const r = await processarEventoKit(
      evento({ orderId: 'ORDER-2', item: 'bump_vip', produto: 'SolarDoc VIP — 30 dias' }),
    );

    expect(r.trialVip).toBe(true);
    const user = db.users[0];
    expect(user.plano).toBe('ilimitado');
    expect(user.limite_documentos).toBe(999999);
    const dias = Math.round((new Date(user.pack_trial_until).getTime() - Date.now()) / 86400000);
    expect(dias).toBe(30);
  });

  it('reentrega do bump NÃO estende o trial', async () => {
    await processarEventoKit(evento());
    await processarEventoKit(evento({ orderId: 'ORDER-2', item: 'bump_vip' }));
    const validade = db.users[0].pack_trial_until;

    const r = await processarEventoKit(evento({ orderId: 'ORDER-2', item: 'bump_vip' }));
    expect(r.trialVip).toBe(false);
    expect(db.users[0].pack_trial_until).toBe(validade);
  });

  it('não "dá" VIP para quem já paga assinatura', async () => {
    db.users.push({ id: 'u1', email: EMAIL, password_hash: 'x', plano: 'ilimitado', pack_trial_until: null });
    emails.add(EMAIL);

    const r = await processarEventoKit(evento({ orderId: 'ORDER-9', item: 'bump_vip' }));
    expect(r.trialVip).toBe(false);
    expect(db.users[0].pack_trial_until).toBeNull();
  });

  it('bump que chega sozinho (webhook separado) não dispara o e-mail de boas-vindas', async () => {
    await processarEventoKit(evento({ orderId: 'ORDER-2', item: 'bump_vip' }));
    expect(enviados).toHaveLength(0);
  });
});

describe('acessoDoUsuario', () => {
  it('junta os itens de pedidos separados e só conta os pagos', async () => {
    await processarEventoKit(evento());
    await processarEventoKit(evento({ orderId: 'ORDER-2', item: 'bump_vip' }));
    await processarEventoKit(evento({ orderId: 'ORDER-3', item: 'bump_prospeccao', status: 'waiting_payment' }));

    const userId = db.users[0].id;
    const acesso = await acessoDoUsuario(userId, EMAIL);

    expect(acesso.temKit).toBe(true);
    expect(acesso.itens).toContain('kit');
    expect(acesso.itens).toContain('bump_vip');
    expect(acesso.itens).not.toContain('bump_prospeccao'); // não foi pago
    expect(acesso.trialVipAte).toBeTruthy();
  });

  it('quem nunca comprou não tem kit', async () => {
    const acesso = await acessoDoUsuario('nao-existe', 'ninguem@teste.com');
    expect(acesso.temKit).toBe(false);
    expect(acesso.itens).toHaveLength(0);
  });
});
