import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O MENU E O CURSO RESPONDEM PELA MESMA REGRA (Kit Fecha Vendas), E O LIMPAPRO DESTRAVA.
//
// Kit: o menu (`acessos()`) lia kit_pedidos só por user_id e sem olhar o item; o curso (`/kit/meu-acesso`) lia
// por user_id OU e-mail e abria com qualquer item pago. Aqui cada conta passa pelos DOIS e o resultado tem que
// ser o mesmo, para as duas pontas não voltarem a divergir em silêncio.
//
// LimpaPro: nada gravava entitlements.produto = 'curso-limpapro', então quem comprava ficava com o cadeado para
// sempre. O acessos() agora lê limpapro_entitlements e limpapro_membros, por e-mail ou pelo WhatsApp da conta.
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

import { falhas, limpar, semear } from './helpers/dbFalso';
import { acessos } from '../services/produtos/acessos';
import { meuAcesso } from '../controllers/kitController';
import { concederCursoPorAssinatura, processarEventoKit, type EventoKit } from '../services/kitIntegradorService';
import { produtosDaAssinatura } from '../services/produtos/catalogo';

const EMAIL = 'integrador@empresa.com.br';

function usuario(over: Record<string, any> = {}) {
  return semear('users', {
    email: EMAIL, password_hash: 'hash', plano: 'free', is_admin: false, plano_expira_em: null,
    whatsapp: null, curso_vitalicio: false, pack_trial_until: null, ...over,
  });
}

function pedido(over: Record<string, any> = {}) {
  return semear('kit_pedidos', {
    order_id: `P-${Math.random().toString(36).slice(2, 9)}`, email: EMAIL, user_id: null, itens: ['kit'],
    status: 'paid', criado_em: new Date().toISOString(), trial_vip_ate: null, ...over,
  });
}

/** O que o curso responde (GET /kit/meu-acesso). */
async function curso(userId: string) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: any) { out.body = b; return res; },
  };
  await meuAcesso({ userId } as any, res);
  return out;
}

/** O que o menu responde (acessos()). */
async function menu(userId: string) {
  const a = await acessos(userId);
  return { tem: a.produtos.has('curso-fechamento'), origem: a.origem['curso-fechamento'] };
}

beforeEach(() => {
  limpar('users', 'kit_pedidos', 'entitlements', 'kit_progresso', 'limpapro_entitlements', 'limpapro_membros');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// ── D) Kit Fecha Vendas: uma regra só ────────────────────────────────────────

describe('Kit Fecha Vendas: a assinatura segue como era (esta mudança não mexe nela)', () => {
  it('o menu continua derivando o curso da assinatura; Precificação e Inventário seguem fora', async () => {
    const derivados = produtosDaAssinatura();
    expect(derivados).toContain('curso-fechamento');
    expect(derivados).not.toContain('precificacao');
    expect(derivados).not.toContain('inventario');
    const u = usuario({ plano: 'ilimitado' });
    expect((await menu(u.id)).origem).toBe('assinatura');
  });
});

describe('Kit Fecha Vendas: o menu usa a regra do curso (user_id OU e-mail, qualquer item) e só soma', () => {
  // [descrição, monta a conta e devolve o id, esperado no menu]
  const casos: Array<[string, () => string, boolean]> = [
    ['pedido kit pago, achado pelo user_id (como o menu já fazia)', () => {
      const u = usuario();
      pedido({ user_id: u.id, email: 'outro@x.com', itens: ['kit'] });
      return u.id;
    }, true],
    ['pedido pago de outro item, achado pelo user_id (como o menu já fazia): continua aberto', () => {
      const u = usuario();
      pedido({ user_id: u.id, itens: ['precificacao'] });
      return u.id;
    }, true],
    ['pedido kit pago, achado SÓ pelo e-mail da conta (user_id nulo): GANHA', () => {
      const u = usuario();
      pedido({ user_id: null, email: EMAIL, itens: ['kit'] });
      return u.id;
    }, true],
    ['comprou Off-Grid com o e-mail da conta, user_id nulo: GANHA, como o curso já abre', () => {
      const u = usuario();
      pedido({ user_id: null, itens: ['offgrid'] });
      return u.id;
    }, true],
    ['comprou Precificação com o e-mail da conta, user_id nulo: GANHA', () => {
      const u = usuario();
      pedido({ user_id: null, itens: ['precificacao'] });
      return u.id;
    }, true],
    ['e-mail do pedido em maiúsculas na conta: acha pelo e-mail em minúsculas', () => {
      const u = usuario({ email: 'Fulano@X.com' });
      pedido({ user_id: null, email: 'fulano@x.com', itens: ['kit'] });
      return u.id;
    }, true],
    ['free sem nada', () => usuario().id, false],
    ['pedido que ainda NÃO foi pago', () => {
      const u = usuario();
      pedido({ user_id: u.id, itens: ['kit'], status: 'waiting_payment' });
      return u.id;
    }, false],
    ['pedido reembolsado', () => {
      const u = usuario();
      pedido({ user_id: u.id, itens: ['kit'], status: 'refunded' });
      return u.id;
    }, false],
    ['pedido de OUTRA pessoa não abre', () => {
      const u = usuario();
      pedido({ user_id: 'outra-pessoa', email: 'outra@x.com', itens: ['kit'] });
      return u.id;
    }, false],
    ['e-mail com "+" (gmail+tag) acha a compra pelo e-mail', () => {
      const u = usuario({ email: 'fulano+curso@gmail.com' });
      pedido({ user_id: null, email: 'fulano+curso@gmail.com', itens: ['kit'] });
      return u.id;
    }, true],
  ];

  for (const [descricao, monta, esperado] of casos) {
    it(`${descricao} -> ${esperado ? 'abre' : 'tranca'} no menu E no curso`, async () => {
      const id = monta();
      const noMenu = await menu(id);
      const noCurso = await curso(id);

      expect(noMenu.tem, 'menu').toBe(esperado);
      expect(noCurso.body.liberado, 'curso').toBe(esperado);
    });
  }

  it('o grandfather (curso_vitalicio) segue abrindo só o curso, como era: o menu não muda por ele', async () => {
    const v = usuario({ curso_vitalicio: true });
    expect((await curso(v.id)).body.liberado).toBe(true);
    expect((await menu(v.id)).tem).toBe(false);
  });

  it('a origem que o menu mostra para quem comprou é "compra"', async () => {
    const comprou = usuario({ email: 'a@x.com' });
    pedido({ user_id: null, email: 'a@x.com', itens: ['offgrid'] });
    expect((await menu(comprou.id)).origem).toBe('compra');
    expect((await curso(comprou.id)).body.motivoAcesso).toBe('compra');
  });

  it('kit_pedidos que não pode ser lida: trancado no menu, sem lançar', async () => {
    const u = usuario({ plano: 'free' });
    pedido({ user_id: u.id, itens: ['kit'] });
    falhas.tabelaQuebrada.add('kit_pedidos');

    expect((await menu(u.id)).tem).toBe(false);
  });

  it('admin vê tudo no menu, como sempre', async () => {
    const a = usuario({ is_admin: true });
    const r = await acessos(a.id);
    expect(r.produtos.has('curso-fechamento')).toBe(true);
    expect(r.produtos.has('curso-limpapro')).toBe(true);
    expect(r.origem['curso-fechamento']).toBe('admin');
  });

  it('o que entra por concederCursoPorAssinatura (oferta VIP com o curso) abre nas duas pontas', async () => {
    const u = usuario({ plano: 'ilimitado' });
    await concederCursoPorAssinatura(u.id, EMAIL);
    expect((await menu(u.id)).tem).toBe(true);
    expect((await curso(u.id)).body.liberado).toBe(true);
  });

  it('o fluxo real: comprar a Precificação com o e-mail da conta já abre o menu, igual ao curso', async () => {
    const evt = (over: Partial<EventoKit>): EventoKit => ({
      orderId: 'O1', email: EMAIL, nome: 'Integrador', telefone: null, documento: null,
      produto: 'x', item: 'precificacao', status: 'paid', valorCentavos: 6700,
      utm: { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null },
      payload: {}, ...over,
    });
    const u = usuario();
    await processarEventoKit(evt({ orderId: 'O-FERRAMENTA', item: 'precificacao' }));
    expect((await menu(u.id)).tem).toBe(true);
    expect((await curso(u.id)).body.liberado).toBe(true);
  });

  it('não muda o que a conta tem das ferramentas avulsas (entitlements seguem valendo)', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'precificacao', origem: 'compra', expira_em: null });
    const r = await acessos(u.id);
    expect(r.produtos.has('precificacao')).toBe(true);
    expect(r.produtos.has('curso-fechamento')).toBe(false);
  });
});

// ── C) LimpaPro ──────────────────────────────────────────────────────────────

describe('LimpaPro destrava no SolarDoc', () => {
  const tem = async (userId: string) => (await acessos(userId)).produtos.has('curso-limpapro');

  it('conta SEM compra do LimpaPro: cadeado', async () => {
    const u = usuario();
    expect(await tem(u.id)).toBe(false);
  });

  it('compra com o e-mail da conta (limpapro_entitlements, item curso-principal): abre, com origem "compra"', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'curso-principal', ativo: true });
    const r = await acessos(u.id);
    expect(r.produtos.has('curso-limpapro')).toBe(true);
    expect(r.origem['curso-limpapro']).toBe('compra');
  });

  it('o plano completo (premium) também abre', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'premium', ativo: true });
    expect(await tem(u.id)).toBe(true);
  });

  it('compra reembolsada/desativada (ativo false) não abre', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'curso-principal', ativo: false });
    expect(await tem(u.id)).toBe(false);
  });

  it('só um extra (comunidade, usina...) não é a compra do curso', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'comunidade', ativo: true });
    semear('limpapro_entitlements', { email: EMAIL, item: 'usina', ativo: true });
    expect(await tem(u.id)).toBe(false);
  });

  it('compra de OUTRO e-mail não abre', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: 'outro@x.com', item: 'curso-principal', ativo: true });
    expect(await tem(u.id)).toBe(false);
  });

  it('membro ativo com o e-mail da conta abre, mesmo sem linha em entitlements', async () => {
    const u = usuario();
    semear('limpapro_membros', { email: EMAIL, telefone: null, ativo: true });
    expect(await tem(u.id)).toBe(true);
  });

  it('pelo telefone: o membro (13 dígitos, com 55) casa com o WhatsApp da conta (11 dígitos)', async () => {
    const u = usuario({ whatsapp: '34999990000' });
    semear('limpapro_membros', { email: 'comprou.com.outro@email.com', telefone: '5534999990000', ativo: true });
    expect(await tem(u.id)).toBe(true);
  });

  it('pelo telefone, com as variantes: "+55", sem o nono dígito e com máscara', async () => {
    for (const telefone of ['+5534999990000', '553499990000', '34999990000', '3499990000']) {
      limpar('users', 'kit_pedidos', 'entitlements', 'limpapro_entitlements', 'limpapro_membros');
      const u = usuario({ whatsapp: '(34) 99999-0000' });
      semear('limpapro_membros', { email: 'x@y.com', telefone, ativo: true });
      expect(await tem(u.id), telefone).toBe(true);
    }
  });

  it('pelo telefone de outra pessoa, ou com o membro inativo, não abre', async () => {
    const u = usuario({ whatsapp: '34999990000' });
    semear('limpapro_membros', { email: 'a@y.com', telefone: '5534988880000', ativo: true });   // outro número
    semear('limpapro_membros', { email: 'b@y.com', telefone: '5534999990000', ativo: false });  // inativo
    expect(await tem(u.id)).toBe(false);
  });

  it('conta sem WhatsApp cadastrado só olha o e-mail', async () => {
    const u = usuario({ whatsapp: null });
    semear('limpapro_membros', { email: 'a@y.com', telefone: '5534999990000', ativo: true });
    expect(await tem(u.id)).toBe(false);
  });

  it('tabelas do LimpaPro que não podem ser lidas: "não tem", sem lançar, e o resto do acesso continua', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'compra', expira_em: null });
    falhas.tabelaQuebrada.add('limpapro_entitlements');
    falhas.tabelaQuebrada.add('limpapro_membros');

    const r = await acessos(u.id);
    expect(r.produtos.has('curso-limpapro')).toBe(false);
    expect(r.produtos.has('inventario')).toBe(true);
  });

  it('uma linha manual em entitlements (curso-limpapro) segue valendo', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'curso-limpapro', origem: 'admin', expira_em: null });
    const r = await acessos(u.id);
    expect(r.produtos.has('curso-limpapro')).toBe(true);
    expect(r.origem['curso-limpapro']).toBe('admin');
  });
});
