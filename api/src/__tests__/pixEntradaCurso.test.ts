import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Travas do comprovante de Pix — com foco na ENTRADA de R$19.
//
// A entrada (curso + 30 dias de plataforma) é oferta de PRIMEIRA VEZ. Sem a
// trava, a pessoa paga R$19 por Pix todo mês e nunca assina: R$19 recorrente
// no lugar de R$67. O dedup normal não pega isso, porque ele é por
// telefone+valor+DATA — mês que vem a data muda e passa.
//
// Testa validarComprovante direto (exportada pra isto) em vez de simular a IA
// de visão: o que decide se dinheiro vira acesso são as travas, não o OCR.
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>;
const db: Record<string, Row[]> = { system_state: [], users: [], kit_pedidos: [] };

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let patch: Row | null = null;
  let onConflict = '';

  const linhas = () => (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'insert') {
      // system_state.key é UNIQUE em produção — o fake respeita, senão o teste
      // da trava passaria por acidente (duas linhas, nenhuma colisão).
      if ((db[table] ?? []).some((r) => r.key === pendente!.key)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      db[table] = [...(db[table] ?? []), { ...pendente! }];
      return { data: pendente, error: null };
    }
    if (modo === 'upsert') {
      const existente = onConflict
        ? (db[table] ?? []).find((r) => r[onConflict] === pendente![onConflict])
        : undefined;
      if (existente) { Object.assign(existente, pendente); return { data: existente, error: null }; }
      db[table] = [...(db[table] ?? []), { ...pendente! }];
      return { data: pendente, error: null };
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
    eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
    limit: () => q,
    maybeSingle: async () => {
      const { data, error } = executa();
      return { data: Array.isArray(data) ? data[0] ?? null : data, error };
    },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(), sendHuman: vi.fn(), sendImage: vi.fn(),
}));

import {
  validarComprovante,
  liberarAcessoPix,
  PLANO_POR_VALOR,
  VALOR_ENTRADA_CURSO,
} from '../services/agents/whatsapp/pixComprovanteService';
import { acessoDoUsuario } from '../services/kitIntegradorService';

const TELEFONE = '5534999990000';
const AIOROS = '63636043000188';

/** Comprovante válido "de hoje" — a trava de data exige recente e legível. */
function comprovante(over: Record<string, any> = {}) {
  return {
    is_comprovante: true,
    valor: VALOR_ENTRADA_CURSO,
    recebedor_nome: 'AIOROS GROUP',
    recebedor_documento: AIOROS,
    data: new Date().toISOString().slice(0, 10),
    id_transacao: 'E123',
    ...over,
  } as any;
}

beforeEach(() => { db.system_state = []; db.users = []; db.kit_pedidos = []; });

describe('trava da entrada de R$19', () => {
  it('a primeira vez passa', async () => {
    const r = await validarComprovante(comprovante(), TELEFONE);
    expect(r.passou).toBe(true);
    expect(r.motivo).toBe('ok');
    expect(r.valor).toBe(19);
  });

  it('a segunda vez NÃO passa, mesmo com data diferente', async () => {
    // Simula o que a liberação grava: o marcador de entrada queimada.
    db.system_state.push({ key: `pix19_entrada:${TELEFONE}` });

    // Data diferente = dedupKey diferente. Sem a trava, isto passaria.
    const outroDia = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
    const r = await validarComprovante(comprovante({ data: outroDia }), TELEFONE);

    expect(r.passou).toBe(false);
    expect(r.motivo).toMatch(/entrada de R\$19 já usada/i);
  });

  it('a trava é por número — não respinga em outro telefone', async () => {
    db.system_state.push({ key: `pix19_entrada:${TELEFONE}` });
    const r = await validarComprovante(comprovante(), '5534988887777');
    expect(r.passou).toBe(true);
  });

  it('não afeta os R$67 da reativação — esses podem repetir todo mês', async () => {
    db.system_state.push({ key: `pix19_entrada:${TELEFONE}` });
    const r = await validarComprovante(comprovante({ valor: 67 }), TELEFONE);
    expect(r.passou).toBe(true);
    expect(r.valor).toBe(67);
  });
});

describe('travas gerais que a entrada não pode furar', () => {
  it('R$19 continua sujeito ao dedup do mesmo comprovante', async () => {
    const c = comprovante();
    const primeira = await validarComprovante(c, TELEFONE);
    db.system_state.push({ key: primeira.dedupKey });   // o que a liberação grava

    const reenvio = await validarComprovante(c, TELEFONE);
    expect(reenvio.passou).toBe(false);
    expect(reenvio.motivo).toMatch(/já usado antes/i);
  });

  it('recusa valor que não é de plano nenhum (ex.: R$15)', async () => {
    const r = await validarComprovante(comprovante({ valor: 15 }), TELEFONE);
    expect(r.passou).toBe(false);
    expect(r.motivo).toMatch(/valor não bate/i);
  });

  it('recusa comprovante de outro recebedor', async () => {
    const r = await validarComprovante(
      comprovante({ recebedor_nome: 'OUTRA EMPRESA', recebedor_documento: '11222333000144' }),
      TELEFONE,
    );
    expect(r.passou).toBe(false);
    expect(r.motivo).toMatch(/recebedor/i);
  });

  it('recusa comprovante velho (fora da janela de 6 dias)', async () => {
    const velho = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const r = await validarComprovante(comprovante({ data: velho }), TELEFONE);
    expect(r.passou).toBe(false);
    expect(r.motivo).toMatch(/data/i);
  });

  it('recusa comprovante sem data legível', async () => {
    const r = await validarComprovante(comprovante({ data: null }), TELEFONE);
    expect(r.passou).toBe(false);
  });
});

// ── O que os R$19 de fato entregam ──────────────────────────────────────────
// A Giovanna promete DUAS coisas no WhatsApp: o curso (o produto) e 30 dias de
// plataforma completa (a experiência). Este bloco confere que o pagamento vira
// as duas — prometer e não entregar é o modo de falha mais caro do funil.
describe('R$19 → curso + 30 dias de plataforma', () => {
  const USER = 'user-19';
  const EMAIL = 'entrada@teste.com';

  beforeEach(() => {
    db.users = [{ id: USER, email: EMAIL, plano: 'free', limite_documentos: 10 }];
  });

  it('a tabela de valores manda os R$19 pro acesso completo', () => {
    expect(PLANO_POR_VALOR[VALOR_ENTRADA_CURSO]).toEqual({ plano: 'ilimitado', limite: 999999 });
  });

  it('libera plataforma completa e marca o vencimento ~30 dias à frente', async () => {
    const alvo = PLANO_POR_VALOR[VALOR_ENTRADA_CURSO];
    const venc = await liberarAcessoPix(USER, null, alvo.plano, alvo.limite);

    const u = db.users[0];
    expect(u.plano).toBe('ilimitado');
    expect(u.limite_documentos).toBe(999999);
    expect(u.billing_status).toBe('active');

    const dias = (venc.getTime() - Date.now()) / 864e5;
    expect(dias).toBeGreaterThan(26);   // meses curtos (fev) ainda passam
    expect(dias).toBeLessThan(32);
  });

  it('libera o CURSO junto — que é o produto que ele comprou', async () => {
    const alvo = PLANO_POR_VALOR[VALOR_ENTRADA_CURSO];
    await liberarAcessoPix(USER, null, alvo.plano, alvo.limite);

    const acesso = await acessoDoUsuario(USER, EMAIL);
    expect(acesso.temKit).toBe(true);
    expect(acesso.itens).toContain('kit');
  });

  it('a concessão não vira venda da isca (valor 0, segmento assinatura)', async () => {
    const alvo = PLANO_POR_VALOR[VALOR_ENTRADA_CURSO];
    await liberarAcessoPix(USER, null, alvo.plano, alvo.limite);

    const pedido = db.kit_pedidos[0];
    expect(pedido.valor).toBe(0);
    expect(pedido.segmento).toBe('assinatura');
  });

  it('pagar R$27 (PRO) NÃO dá o curso — PRO não é acesso completo', async () => {
    const alvo = PLANO_POR_VALOR[27];
    expect(alvo.plano).toBe('pro');
    await liberarAcessoPix(USER, null, alvo.plano, alvo.limite);

    const acesso = await acessoDoUsuario(USER, EMAIL);
    expect(acesso.temKit).toBe(false);
  });

  it('reativação de R$67 também entrega o curso', async () => {
    const alvo = PLANO_POR_VALOR[67];
    await liberarAcessoPix(USER, null, alvo.plano, alvo.limite);

    const acesso = await acessoDoUsuario(USER, EMAIL);
    expect(acesso.temKit).toBe(true);
  });
});
