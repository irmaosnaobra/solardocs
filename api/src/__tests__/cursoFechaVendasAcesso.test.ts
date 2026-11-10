import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// FECHA VENDAS: A ASSINATURA PAGA E ATIVA ABRE O CURSO, NO MENU E NO CURSO (10/11/2026).
//
// Antes: o menu (`acessos()`) e a página de venda diziam "vem em qualquer assinatura paga", e o
// `/kit/meu-acesso` dizia o contrário (trava de 30/07/2026) e trancava quem assinava. Agora as duas pontas
// usam a mesma função (`assinaturaAbreCurso`). O furo que motivou a trava continua fechado: quem está nos
// 7 dias grátis (billing_status 'trialing') tem plano pago sem ter pago nada, e não ganha o curso.
//
// Também: POST /kit/progresso devolvia 204 mesmo com erro e a tela fingia que salvou. Agora devolve 500.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return { supabase: supabaseFalso };
});
vi.mock('../utils/mailer', () => ({
  sendKitAcessoEmail: vi.fn(async () => {}),
  sendMesPixAcessoEmail: vi.fn(async () => {}),
  sendFerramentaAcessoEmail: vi.fn(async () => {}),
  sendOpsAlert: vi.fn(async () => {}),
}));
vi.mock('../services/agentes5040/planilhaBonus', () => ({ tentarBonusPosPagamento: vi.fn(async () => true) }));

import { db, falhas, limpar, semear } from './helpers/dbFalso';
import { acessos, assinaturaAbreCurso, assinaturaVigente } from '../services/produtos/acessos';
import { marcarProgresso, meuAcesso } from '../controllers/kitController';

const EMAIL = 'assinante@empresa.com.br';
const AMANHA = new Date(Date.now() + 86400_000).toISOString();
const ONTEM = new Date(Date.now() - 86400_000).toISOString();

function usuario(over: Record<string, any> = {}) {
  return semear('users', {
    email: EMAIL, password_hash: 'hash', plano: 'free', is_admin: false, plano_expira_em: null,
    billing_status: 'active', whatsapp: null, curso_vitalicio: false, pack_trial_until: null, ...over,
  });
}

function pedidoPago(userId: string) {
  return semear('kit_pedidos', {
    order_id: `P-${Math.random().toString(36).slice(2, 9)}`, email: EMAIL, user_id: userId, itens: ['kit'],
    status: 'paid', criado_em: new Date().toISOString(), trial_vip_ate: null,
  });
}

async function curso(userId: string) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
  await meuAcesso({ userId } as any, res);
  return out;
}

async function menu(userId: string) {
  const a = await acessos(userId);
  return { tem: a.produtos.has('curso-fechamento'), origem: a.origem['curso-fechamento'] };
}

beforeEach(() => {
  limpar('users', 'kit_pedidos', 'entitlements', 'kit_progresso', 'limpapro_entitlements', 'limpapro_membros');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Fecha Vendas: quem entra pelo curso e pelo menu (a mesma resposta nas duas pontas)', () => {
  // [descrição, monta a conta, esperado, motivo no curso]
  const casos: Array<[string, () => string, boolean, string | null]> = [
    ['assinante pago (ilimitado, sem data de expiração)', () => usuario({ plano: 'ilimitado' }).id, true, 'assinatura'],
    ['assinante pago (pro, com expiração no futuro)', () => usuario({ plano: 'pro', plano_expira_em: AMANHA }).id, true, 'assinatura'],
    ['assinante com cobrança atrasada (past_due): pagou, só falhou uma cobrança depois', () => usuario({ plano: 'ilimitado', billing_status: 'past_due' }).id, true, 'assinatura'],
    ['free, sem compra', () => usuario().id, false, null],
    // O cancelamento da Stripe grava billing_status 'suspended' e deixa plano='pro' e plano_expira_em nulo.
    ['assinatura CANCELADA (suspended, plano pro, sem data de expiração)', () => usuario({ plano: 'pro', billing_status: 'suspended' }).id, false, null],
    ['assinatura cancelada (suspended, plano ilimitado)', () => usuario({ plano: 'ilimitado', billing_status: 'suspended' }).id, false, null],
    ['status unpaid da Stripe', () => usuario({ plano: 'pro', billing_status: 'unpaid' }).id, false, null],
    ['status canceled da Stripe', () => usuario({ plano: 'pro', billing_status: 'canceled' }).id, false, null],
    ['status cancelled (grafia britânica)', () => usuario({ plano: 'pro', billing_status: 'cancelled' }).id, false, null],
    ['assinatura cancelada MAS com compra avulsa: a compra vale', () => {
      const u = usuario({ plano: 'pro', billing_status: 'suspended' }); pedidoPago(u.id); return u.id;
    }, true, 'compra'],
    ['assinatura vencida (plano_expira_em no passado)', () => usuario({ plano: 'ilimitado', plano_expira_em: ONTEM }).id, false, null],
    ['7 dias grátis (trialing): plano pago, mas nada pago ainda', () => usuario({ plano: 'pro', billing_status: 'trialing' }).id, false, null],
    ['comprador avulso, conta free', () => { const u = usuario(); pedidoPago(u.id); return u.id; }, true, 'compra'],
    ['comprador avulso com a assinatura vencida: a compra vale', () => {
      const u = usuario({ plano: 'ilimitado', plano_expira_em: ONTEM }); pedidoPago(u.id); return u.id;
    }, true, 'compra'],
    ['comprador avulso que está nos 7 dias grátis: a compra vale', () => {
      const u = usuario({ plano: 'pro', billing_status: 'trialing' }); pedidoPago(u.id); return u.id;
    }, true, 'compra'],
    ['quem assina E comprou: o motivo é a compra (vale para sempre)', () => {
      const u = usuario({ plano: 'ilimitado' }); pedidoPago(u.id); return u.id;
    }, true, 'compra'],
  ];

  for (const [descricao, monta, esperado, motivo] of casos) {
    it(`${descricao} -> ${esperado ? 'abre' : 'tranca'} no curso E no menu`, async () => {
      const id = monta();
      const noCurso = await curso(id);
      const noMenu = await menu(id);
      expect(noCurso.body.liberado, 'curso').toBe(esperado);
      expect(noMenu.tem, 'menu').toBe(esperado);
      expect(noCurso.body.motivoAcesso, 'motivo').toBe(motivo);
    });
  }

  it('o grandfather (curso_vitalicio) segue abrindo o curso para quem não assina', async () => {
    const u = usuario({ curso_vitalicio: true });
    const r = await curso(u.id);
    expect(r.body.liberado).toBe(true);
    expect(r.body.motivoAcesso).toBe('vitalicio');
  });

  it('migration do curso_vitalicio ainda não rodou: o assinante abre e o free não', async () => {
    falhas.colunaAusente.add('curso_vitalicio');
    const assinante = usuario({ plano: 'ilimitado' });
    const gratis = semear('users', { email: 'g@x.com', plano: 'free', is_admin: false, billing_status: 'active', plano_expira_em: null });
    expect((await curso(assinante.id)).body.liberado).toBe(true);
    expect((await curso(gratis.id)).body.liberado).toBe(false);
  });
});

describe('assinaturaAbreCurso: a regra em si', () => {
  it('plano free nunca abre, com ou sem data', () => {
    expect(assinaturaAbreCurso({ plano: 'free' })).toBe(false);
    expect(assinaturaAbreCurso({ plano: 'free', plano_expira_em: AMANHA })).toBe(false);
    expect(assinaturaAbreCurso({})).toBe(false);
  });
  it('vigência: sem data vale; data futura vale; data passada não', () => {
    expect(assinaturaVigente({ plano: 'pro' })).toBe(true);
    expect(assinaturaVigente({ plano: 'pro', plano_expira_em: AMANHA })).toBe(true);
    expect(assinaturaVigente({ plano: 'pro', plano_expira_em: ONTEM })).toBe(false);
  });
  it('suspended (cancelada), unpaid, canceled e cancelled não abrem; past_due e active abrem', () => {
    for (const s of ['suspended', 'unpaid', 'canceled', 'cancelled', 'SUSPENDED']) {
      expect(assinaturaAbreCurso({ plano: 'pro', billing_status: s }), s).toBe(false);
    }
    for (const s of ['past_due', 'active', null, undefined]) {
      expect(assinaturaAbreCurso({ plano: 'pro', billing_status: s }), String(s)).toBe(true);
    }
  });
  it('trialing é vigente, mas não abre o curso', () => {
    expect(assinaturaVigente({ plano: 'pro', plano_expira_em: null })).toBe(true);
    expect(assinaturaAbreCurso({ plano: 'pro', billing_status: 'trialing' })).toBe(false);
  });
});

describe('POST /kit/progresso: o erro chega à tela', () => {
  function chama(userId: string, body: unknown) {
    const out: { status: number; body: any; fim: boolean } = { status: 0, body: null, fim: false };
    const res: any = {
      status(c: number) { out.status = c; return res; },
      json(b: any) { out.body = b; return res; },
      end() { out.fim = true; if (!out.status) out.status = 204; return res; },
    };
    return marcarProgresso({ userId, body } as any, res).then(() => out);
  }

  it('gravou: 204 e a linha existe no banco', async () => {
    const u = usuario({ plano: 'ilimitado' });
    const r = await chama(u.id, { modulo: 'objecoes:preco', concluido: true });
    expect(r.status).toBe(204);
    expect(db.kit_progresso.some((l) => l.user_id === u.id && l.modulo === 'objecoes:preco')).toBe(true);
  });

  it('desmarcou: 204 e a linha some', async () => {
    const u = usuario({ plano: 'ilimitado' });
    semear('kit_progresso', { user_id: u.id, modulo: 'objecoes:preco' });
    const r = await chama(u.id, { modulo: 'objecoes:preco', concluido: false });
    expect(r.status).toBe(204);
    expect(db.kit_progresso.length).toBe(0);
  });

  it('o banco recusou a gravação: 500 com mensagem, nunca 204', async () => {
    const u = usuario({ plano: 'ilimitado' });
    falhas.tabelaQuebrada.add('kit_progresso');
    const r = await chama(u.id, { modulo: 'objecoes:preco', concluido: true });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/salvar/i);
  });

  it('o banco recusou a exclusão: 500 também', async () => {
    const u = usuario({ plano: 'ilimitado' });
    falhas.tabelaQuebrada.add('kit_progresso');
    const r = await chama(u.id, { modulo: 'objecoes:preco', concluido: false });
    expect(r.status).toBe(500);
  });

  it('sem acesso ao curso (free, sem compra): 403 e nada é gravado', async () => {
    const u = usuario();
    const r = await chama(u.id, { modulo: 'objecoes:preco', concluido: true });
    expect(r.status).toBe(403);
    expect(db.kit_progresso.length).toBe(0);
  });

  it('sem acesso: desmarcar também é 403 e a linha fica', async () => {
    const u = usuario();
    semear('kit_progresso', { user_id: u.id, modulo: 'objecoes:preco' });
    const r = await chama(u.id, { modulo: 'objecoes:preco', concluido: false });
    expect(r.status).toBe(403);
    expect(db.kit_progresso.length).toBe(1);
  });

  it('assinatura cancelada (suspended) e 7 dias grátis (trialing): 403', async () => {
    const cancelada = usuario({ plano: 'pro', billing_status: 'suspended' });
    expect((await chama(cancelada.id, { modulo: 'a:b' })).status).toBe(403);
    const trial = semear('users', { email: 't@x.com', plano: 'pro', is_admin: false, billing_status: 'trialing', plano_expira_em: null });
    expect((await chama(trial.id, { modulo: 'a:b' })).status).toBe(403);
    expect(db.kit_progresso.length).toBe(0);
  });

  it('comprador avulso (conta free) grava progresso: 204', async () => {
    const u = usuario();
    pedidoPago(u.id);
    const r = await chama(u.id, { modulo: 'objecoes:preco' });
    expect(r.status).toBe(204);
    expect(db.kit_progresso.length).toBe(1);
  });

  it('conta que não existe: 403', async () => {
    const r = await chama('fantasma', { modulo: 'a:b' });
    expect(r.status).toBe(403);
  });

  it('corpo inválido segue 400', async () => {
    const u = usuario();
    const r = await chama(u.id, {});
    expect(r.status).toBe(400);
  });
});
