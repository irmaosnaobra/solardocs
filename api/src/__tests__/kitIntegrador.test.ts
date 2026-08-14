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
const alertas: any[] = [];
const enviadosMesPix: any[] = [];
vi.mock('../utils/mailer', () => ({
  sendKitAcessoEmail: vi.fn(async (opts: any) => { enviados.push(opts); }),
  sendMesPixAcessoEmail: vi.fn(async (opts: any) => { enviadosMesPix.push(opts); }),
  // Assinante que compra o bump paga e não recebe nada — o service avisa o dono
  // em vez de deixar o caso morrer no log.
  sendOpsAlert: vi.fn(async (assunto: string, corpo: string) => { alertas.push({ assunto, corpo }); }),
}));

import {
  classificarProdutoKit,
  processarEventoKit,
  acessoDoUsuario,
  concederCursoPorAssinatura,
  type EventoKit,
} from '../services/kitIntegradorService';
import { meuAcesso } from '../controllers/kitController';

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
  enviadosMesPix.length = 0;
  alertas.length = 0;
});

describe('classificarProdutoKit', () => {
  it('reconhece o produto principal e os bumps pelo nome', () => {
    expect(classificarProdutoKit('Kit de Fechamento do Integrador', null)).toBe('kit');
    expect(classificarProdutoKit('kit fechamento', null)).toBe('kit');
    expect(classificarProdutoKit('SolarDoc VIP — 30 dias', null)).toBe('bump_vip');
    // O nome é digitado à mão na Kiwify: com espaço, sem espaço, com ou sem "30 dias".
    expect(classificarProdutoKit('Solar Doc VIP', null)).toBe('bump_vip');
    expect(classificarProdutoKit('SolarDoc VIP', null)).toBe('bump_vip');
    expect(classificarProdutoKit('Acesso VIP 30 dias', null)).toBe('bump_vip');
    // 'Kit de Prospecção' virou o módulo 5 do curso — não é mais produto vendável.
    expect(classificarProdutoKit('Kit de Prospecção', null)).toBeNull();
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

  // A venda fantasma de 29/07: a Kiwify manda "carrinho abandonado" com um id de
  // SESSÃO de checkout (não de pedido), então o upsert por order_id criava uma
  // segunda linha para o MESMO comprador — e o painel mostrava dois pedidos para
  // uma venda só. Abandono não é pedido: não grava.
  it('abandono de carrinho não cria pedido (nem depois de uma venda paga)', async () => {
    await processarEventoKit(evento());
    expect(db.kit_pedidos).toHaveLength(1);

    // Chega ~1h depois, com o id da sessão de checkout e status 'abandoned'.
    const r = await processarEventoKit(evento({ orderId: '1gb0n8kpm689i9q21a', status: 'abandoned', valorCentavos: null }));

    expect(r.acao).toBe('ignorado');
    expect(db.kit_pedidos).toHaveLength(1);
    expect(db.kit_pedidos[0].status).toBe('paid');
    expect(enviados).toHaveLength(1);
  });

  // Entrega fora de ordem: se o 'waiting_payment' do Pix chegar DEPOIS do 'paid',
  // rebaixar o status trancaria o material de quem já pagou.
  it('waiting_payment atrasado não rebaixa um pedido já pago', async () => {
    await processarEventoKit(evento({ status: 'paid' }));
    await processarEventoKit(evento({ status: 'waiting_payment' }));

    expect(db.kit_pedidos).toHaveLength(1);
    expect(db.kit_pedidos[0].status).toBe('paid');
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

// ── Entrada de 30 dias ("SolarDoc - 30 dias", R$19) ─────────────────────────
// Em 01/ago/2026 o produto foi renomeado na Kiwify e perdeu o "VIP":
// classificarProdutoKit passou a devolver null, o pedido PAGO nunca chegou em
// processarEventoKit e o comprador ficou no plano free. Estes testes travam as
// DUAS metades do conserto — reconhecer o produto, e conceder na coluna certa.
describe('processarEventoKit — entrada de 30 dias (R$19)', () => {
  const entrada = (over: Partial<EventoKit> = {}) => evento({
    orderId: 'ORDER-19', item: 'entrada_30d', produto: 'SolarDoc - 30 dias',
    valorCentavos: 1900, ...over,
  });

  it('reconhece o nome atual do produto, sem "VIP"', () => {
    expect(classificarProdutoKit('SolarDoc - 30 dias', null)).toBe('entrada_30d');
    expect(classificarProdutoKit('SolarDoc 30 dias', null)).toBe('entrada_30d');
    expect(classificarProdutoKit('Solar Doc — 30 dias', null)).toBe('entrada_30d');
  });

  it('o bump legado continua caindo em bump_vip — as colunas são outras', () => {
    expect(classificarProdutoKit('SolarDoc VIP — 30 dias', null)).toBe('bump_vip');
  });

  it('não engole produto de outro funil que por acaso venda "30 dias"', () => {
    expect(classificarProdutoKit('Limpa Solar Pro', null)).toBeNull();
    expect(classificarProdutoKit('Comunidade +Sol — 30 dias', null)).toBeNull();
  });

  it('libera acesso completo em plano_expira_em — NUNCA em pack_trial_until', async () => {
    await processarEventoKit(evento());
    await processarEventoKit(entrada());

    const user = db.users[0];
    expect(user.plano).toBe('ilimitado');
    expect(user.limite_documentos).toBe(999999);
    expect(user.billing_status).toBe('active');
    // O CORAÇÃO do teste: com pack_trial_until o stripeSyncService (linha 130-141)
    // força pro/90 na rodada seguinte — o cara paga por acesso completo e acorda
    // no PRO. Se alguém "simplificar" isto de volta pro concederTrialVip, quebra aqui.
    expect(user.pack_trial_until ?? null).toBeNull();
    const dias = Math.round((new Date(user.plano_expira_em).getTime() - Date.now()) / 86400000);
    expect(dias).toBe(30);
  });

  it('entrega o curso junto — o produto é "curso + 30 dias", não só plataforma', async () => {
    await processarEventoKit(entrada());
    const acesso = await acessoDoUsuario(db.users[0].id, EMAIL);
    expect(acesso.temKit).toBe(true);
  });

  it('reentrega da Kiwify NÃO estende o acesso', async () => {
    await processarEventoKit(entrada());
    const validade = db.users[0].plano_expira_em;

    await processarEventoKit(entrada());
    expect(db.users[0].plano_expira_em).toBe(validade);
  });

  it('reembolso revoga o acesso pago, não o carimbo do trial legado', async () => {
    await processarEventoKit(entrada());
    expect(db.users[0].plano_expira_em).toBeTruthy();

    await processarEventoKit(entrada({ status: 'refunded' }));
    expect(db.users[0].plano_expira_em).toBeNull();
  });
});

// ── Mês avulso no Pix ("SolarDoc — 1 mês", R$67) ────────────────────────────
// É o trilho de quem abandonou o checkout da Stripe e não vai pagar no cartão: o
// Pix é nativo na Kiwify e a liberação vem por este webhook, sem comprovante.
// O risco que estes testes travam é o produto novo cair na entrada de R$19 e sair
// entregando o Kit de Fechamento de graça.
describe('processarEventoKit — mês avulso no Pix (R$67)', () => {
  const mes = (over: Partial<EventoKit> = {}) => evento({
    orderId: 'ORDER-67', item: 'mes_pix', produto: 'SolarDoc — 1 mês',
    valorCentavos: 6700, ...over,
  });

  it('reconhece o mês pelo nome, sem roubar a entrada de 30 dias', () => {
    expect(classificarProdutoKit('SolarDoc — 1 mês', null)).toBe('mes_pix');
    expect(classificarProdutoKit('SolarDoc - 1 mes de acesso', null)).toBe('mes_pix');
    expect(classificarProdutoKit('Solar Doc um mês', null)).toBe('mes_pix');
    // As vizinhas continuam onde estavam.
    expect(classificarProdutoKit('SolarDoc - 30 dias', null)).toBe('entrada_30d');
    expect(classificarProdutoKit('SolarDoc VIP — 30 dias', null)).toBe('bump_vip');
  });

  it('libera 30 dias de acesso completo em plano_expira_em', async () => {
    const r = await processarEventoKit(mes());
    expect(r.acao).toBe('acesso_liberado');

    const user = db.users[0];
    expect(user.plano).toBe('ilimitado');
    expect(user.limite_documentos).toBe(999999);
    expect(user.billing_status).toBe('active');
    expect(user.pack_trial_until ?? null).toBeNull();
    const dias = Math.round((new Date(user.plano_expira_em).getTime() - Date.now()) / 86400000);
    expect(dias).toBe(30);

    // Não é order bump de checkout nenhum: contar como bump inflaria a taxa de
    // attach do kit no /admin. Mas o carimbo de idempotência PRECISA existir.
    const pedido = db.kit_pedidos.find((p: any) => p.order_id === 'ORDER-67')!;
    expect(pedido.bump_vip).toBe(false);
    expect(pedido.bump_aplicado ?? null).toBeNull();
    expect(pedido.trial_vip_ate).toBeTruthy();
  });

  it('NÃO entrega o curso — o Kit de Fechamento é produto pago à parte', async () => {
    await processarEventoKit(mes());
    const acesso = await acessoDoUsuario(db.users[0].id, EMAIL);
    expect(acesso.temKit).toBe(false);
  });

  it('manda o e-mail de acesso mesmo pra quem JÁ tinha conta (pagou no Pix, sem sessão aberta)', async () => {
    db.users.push({ id: 'u1', email: EMAIL, password_hash: 'hash', plano: 'free' });
    emails.add(EMAIL);

    await processarEventoKit(mes());
    expect(enviadosMesPix).toHaveLength(1);
    expect(enviadosMesPix[0].to).toBe(EMAIL);
    expect(enviadosMesPix[0].contaNova).toBe(false);
    // Nada de e-mail do kit: ele não comprou curso nenhum.
    expect(enviados).toHaveLength(0);
  });

  it('reentrega da Kiwify não estende o acesso nem repete o e-mail', async () => {
    await processarEventoKit(mes({ status: 'waiting_payment' }));
    expect(enviadosMesPix).toHaveLength(0);

    await processarEventoKit(mes());
    const validade = db.users[0].plano_expira_em;

    await processarEventoKit(mes());
    expect(db.users[0].plano_expira_em).toBe(validade);
    expect(enviadosMesPix).toHaveLength(1);
  });

  it('reembolso revoga o acesso pago', async () => {
    await processarEventoKit(mes());
    expect(db.users[0].plano_expira_em).toBeTruthy();

    await processarEventoKit(mes({ status: 'refunded' }));
    expect(db.users[0].plano_expira_em).toBeNull();
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

  it('não "dá" VIP para quem já paga assinatura — e avisa o dono, porque a pessoa pagou por nada', async () => {
    db.users.push({ id: 'u1', email: EMAIL, password_hash: 'x', plano: 'ilimitado', pack_trial_until: null });
    emails.add(EMAIL);

    const r = await processarEventoKit(evento({ orderId: 'ORDER-9', item: 'bump_vip' }));
    expect(r.trialVip).toBe(false);
    expect(db.users[0].pack_trial_until).toBeNull();

    // O silêncio aqui é que era o problema: R$19 cobrados sem entrega nenhuma.
    expect(alertas).toHaveLength(1);
    expect(alertas[0].corpo).toContain(EMAIL);
    const pedido = db.kit_pedidos.find((p: any) => p.order_id === 'ORDER-9')!;
    expect(pedido.bump_aplicado).toBe(false);
  });

  it('carimba segmento "membro" quando quem compra já tinha conta com senha', async () => {
    db.users.push({ id: 'u1', email: EMAIL, password_hash: 'x', plano: 'free', pack_trial_until: null });
    emails.add(EMAIL);

    await processarEventoKit(evento({ orderId: 'ORDER-M' }));

    const pedido = db.kit_pedidos.find((p: any) => p.order_id === 'ORDER-M')!;
    expect(pedido.segmento).toBe('membro');
  });

  it('carimba segmento "lp" para conta nova vinda de campanha e "direto" sem campanha', async () => {
    await processarEventoKit(evento({ orderId: 'ORDER-LP', utm: { utm_campaign: '123', utm_source: 'fb' } } as any));
    expect(db.kit_pedidos.find((p: any) => p.order_id === 'ORDER-LP')!.segmento).toBe('lp');

    db.users.length = 0; emails.clear();
    // sem utm_campaign = chegou sem rastro de anúncio (orgânico, indicação, link solto)
    await processarEventoKit(evento({
      orderId: 'ORDER-DIR',
      email: 'outro@teste.com',
      utm: { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null },
    } as any));
    expect(db.kit_pedidos.find((p: any) => p.order_id === 'ORDER-DIR')!.segmento).toBe('direto');
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
    await processarEventoKit(evento({ orderId: 'ORDER-3', item: 'bump_vip', status: 'waiting_payment' }));

    const userId = db.users[0].id;
    const acesso = await acessoDoUsuario(userId, EMAIL);

    expect(acesso.temKit).toBe(true);
    expect(acesso.itens).toContain('kit');
    expect(acesso.itens).toContain('bump_vip');
    expect(acesso.itens.filter((i) => i === 'bump_vip')).toHaveLength(1); // o pendente não entrou
    expect(acesso.trialVipAte).toBeTruthy();
  });

  it('quem nunca comprou não tem kit', async () => {
    const acesso = await acessoDoUsuario('nao-existe', 'ninguem@teste.com');
    expect(acesso.temKit).toBe(false);
    expect(acesso.itens).toHaveLength(0);
  });
});

// ── Quem abre o curso (GET /kit/meu-acesso) ─────────────────────────────────
// Desde 30/07/2026 assinatura NÃO libera o curso: ele é produto à parte. Estes
// testes existem porque uma regressão aqui não quebra nada visível — só entrega
// o curso de graça pra base inteira, calada.
describe('meuAcesso — gate do curso', () => {
  function res() {
    const out: { status: number; body: any } = { status: 200, body: null };
    const r: any = {
      status(c: number) { out.status = c; return r; },
      json(b: any) { out.body = b; return r; },
      end() { return r; },
      out,
    };
    return r;
  }

  async function abrir(userId: string) {
    const r = res();
    await meuAcesso({ userId } as any, r);
    return r.out;
  }

  function usuario(plano: string): string {
    const id = 'u-' + plano + '-' + db.users.length;
    db.users.push({ id, email: `${id}@teste.com`, plano, pack_trial_until: null });
    return id;
  }

  it('assinante VIP sem compra NÃO abre o curso', async () => {
    const { body } = await abrir(usuario('ilimitado'));
    expect(body.liberado).toBe(false);
    expect(body.motivoAcesso).toBe(null);
  });

  it('assinante PRO sem compra NÃO abre o curso', async () => {
    const { body } = await abrir(usuario('pro'));
    expect(body.liberado).toBe(false);
  });

  it('free sem compra NÃO abre o curso', async () => {
    const { body } = await abrir(usuario('free'));
    expect(body.liberado).toBe(false);
  });

  it('quem comprou abre, mesmo no plano free', async () => {
    const id = usuario('free');
    db.kit_pedidos.push({
      order_id: 'ORDER-CURSO', user_id: id, email: `${id}@teste.com`,
      itens: ['kit'], status: 'paid', criado_em: new Date().toISOString(), trial_vip_ate: null,
    });
    const { body } = await abrir(id);
    expect(body.liberado).toBe(true);
    expect(body.motivoAcesso).toBe('compra');
  });

  // O buraco: POST /kit/progresso não checa acesso. Se progresso liberasse o
  // curso, qualquer um gravava uma linha e se dava o produto de graça. Quem
  // estudava de verdade foi carimbado pelo backfill da migration.
  it('gravar progresso NÃO libera o curso sozinho', async () => {
    const id = usuario('free');
    db.kit_progresso.push({ user_id: id, modulo: 'obj-1', concluido_em: new Date().toISOString() });
    const { body } = await abrir(id);
    expect(body.liberado).toBe(false);
  });

  it('nem para assinante: progresso sem a flag continua trancado', async () => {
    const id = usuario('ilimitado');
    db.users.find((u) => u.id === id)!.curso_vitalicio = false;
    db.kit_progresso.push({ user_id: id, modulo: 'obj-1', concluido_em: new Date().toISOString() });
    const { body } = await abrir(id);
    expect(body.liberado).toBe(false);
  });

  // Quem tinha o curso pelo plano, abriu, leu, e nunca clicou em "concluir lição"
  // não tem linha de progresso nenhuma. É o grosso dos assinantes — e é por isso
  // que o grandfather é coluna carimbada pela migration, não dedução.
  it('assinante grandfathered SEM lição concluída mantém o acesso', async () => {
    const id = usuario('ilimitado');
    db.users.find((u) => u.id === id)!.curso_vitalicio = true;
    const { body } = await abrir(id);
    expect(body.liberado).toBe(true);
    expect(body.motivoAcesso).toBe('vitalicio');
  });

  it('assinante novo (curso_vitalicio false) continua trancado', async () => {
    const id = usuario('ilimitado');
    db.users.find((u) => u.id === id)!.curso_vitalicio = false;
    const { body } = await abrir(id);
    expect(body.liberado).toBe(false);
  });
});

// ── Concessão pela oferta "VIP com o curso junto" ───────────────────────────
// Desde 30/jul/2026 o plano não abre mais o curso — quem abre é o pedido pago.
// Se esta concessão falhar, o cliente paga os R$67 prometidos pela Giovanna e
// bate no cadeado: é o modo de falha mais caro do fluxo, então tem teste.
describe('concederCursoPorAssinatura', () => {
  const ALUNO = 'aluno-vip@teste.com';

  it('libera o curso para quem entrou pela oferta', async () => {
    const r = await concederCursoPorAssinatura('user-1', ALUNO);
    expect(r.concedido).toBe(true);
    expect(r.jaTinha).toBe(false);

    const acesso = await acessoDoUsuario('user-1', ALUNO);
    expect(acesso.temKit).toBe(true);
    expect(acesso.itens).toContain('kit');
  });

  it('é idempotente — webhook reentregue não duplica pedido', async () => {
    await concederCursoPorAssinatura('user-1', ALUNO);
    const segunda = await concederCursoPorAssinatura('user-1', ALUNO);

    expect(segunda.jaTinha).toBe(true);
    expect(db.kit_pedidos).toHaveLength(1);
  });

  it('não entra no funil da isca como venda', async () => {
    await concederCursoPorAssinatura('user-1', ALUNO);
    const linha = db.kit_pedidos[0];

    // valor 0: o dinheiro dele é a assinatura recorrente (Stripe), não os R$27.
    expect(linha.valor).toBe(0);
    // segmento 'assinatura' é o marcador que o /kit-funil do admin filtra —
    // sem ele, cada assinante viraria "comprador" e afundaria a conversão da LP.
    expect(linha.segmento).toBe('assinatura');
    expect(linha.status).toBe('paid');
  });

  it('ignora chamada sem usuário ou sem email', async () => {
    expect((await concederCursoPorAssinatura('', ALUNO)).concedido).toBe(false);
    expect((await concederCursoPorAssinatura('user-1', '')).concedido).toBe(false);
    expect(db.kit_pedidos).toHaveLength(0);
  });

  it('normaliza o email — a leitura do acesso casa por email em lowercase', async () => {
    await concederCursoPorAssinatura('user-2', 'Aluno.VIP@Teste.com');
    expect(db.kit_pedidos[0].email).toBe('aluno.vip@teste.com');

    const acesso = await acessoDoUsuario('user-2', 'Aluno.VIP@Teste.com');
    expect(acesso.temKit).toBe(true);
  });
});
