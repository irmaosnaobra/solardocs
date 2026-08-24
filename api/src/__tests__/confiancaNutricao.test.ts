import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// CADÊNCIA DE CONFIANÇA — o que trava aqui.
//
// É a primeira cadência que escreve pra quem JÁ PAGOU, e as três formas de ela
// dar errado não aparecem em `tsc`:
//
//  1. Subir ligada. Cadência que manda e-mail pra cliente pagante não pode
//     começar a disparar só porque um deploy passou.
//  2. Mandar o "dia 1" pra quem tem três meses de casa — o que aconteceria se
//     a âncora caísse pra `users.created_at` quando não há venda casada.
//  3. Empilhar em cima de outra cadência: quem se qualifica pra duas recebe dois
//     e-mails nossos no mesmo minuto, que é a assinatura clássica de spam.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const db: Record<string, Row[]> = { users: [], sales: [] };

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' = 'select';

  const linhas = () => db[table].filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos, error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    lt: (c: string, v: any) => { filtros.push((r) => Number(r[c] ?? 0) < Number(v)); return q; },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));

const enviados: any[] = [];
vi.mock('../utils/mailer', () => ({
  CONFIANCA_TOQUES: 5,
  sendConfiancaEmail: vi.fn(async (email: string, userId: string, toque: number, nome: string | null) => {
    enviados.push({ email, userId, toque, nome });
  }),
}));

import { runConfiancaNutricao } from '../services/confiancaService';

const DIAS = (d: number) => new Date(Date.now() - d * 24 * 3600_000).toISOString();

function pagante(over: Row = {}): Row {
  const n = db.users.length + 1;
  return {
    id: `u${n}`, email: `cliente${n}@teste.com`, nome: 'Cliente Teste',
    plano: 'ilimitado', email_opt_out: false,
    confianca_count: 0, confianca_last_sent_at: null,
    followup_email_last_sent_at: null, upgrade_nudge_last_sent_at: null,
    contract_reminder_last_sent_at: null,
    ...over,
  };
}

function venda(email: string, diasAtras: number): Row {
  return { email, created_at: DIAS(diasAtras) };
}

beforeEach(() => {
  db.users = []; db.sales = []; enviados.length = 0;
  process.env.CONFIANCA_ENABLED = 'true';
});

describe('trava de segurança', () => {
  it('sem CONFIANCA_ENABLED não manda nada — nem para quem está vencido', async () => {
    delete process.env.CONFIANCA_ENABLED;
    const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 10));

    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toContain('CONFIANCA_ENABLED');
    expect(enviados).toHaveLength(0);
  });

  it('o modo seco mostra a fila MESMO desligada — é o que decide se liga', async () => {
    delete process.env.CONFIANCA_ENABLED;
    const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 3));

    const r = await runConfiancaNutricao({ seco: true });
    expect(r.enviados).toBe(0);
    expect(r.previstos).toBe(1);
    expect(r.fila?.[0]).toMatchObject({ email: u.email, toque: 1 });
    expect(enviados).toHaveLength(0);   // seco NÃO envia
  });

  it('modo seco não grava o contador — rodar a prévia duas vezes dá o mesmo', async () => {
    const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 5));

    await runConfiancaNutricao({ seco: true });
    const r = await runConfiancaNutricao({ seco: true });
    expect(r.previstos).toBe(1);
    expect(db.users[0].confianca_count).toBe(0);
  });
});

describe('quando cada toque vence', () => {
  it('no mesmo dia da compra ainda não recebe nada', async () => {
    const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 0));
    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(0);
  });

  it('no dia 1 sai o primeiro toque e o contador anda', async () => {
    const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 1));

    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(1);
    expect(enviados[0].toque).toBe(1);
    expect(db.users[0].confianca_count).toBe(1);
    expect(db.users[0].confianca_last_sent_at).toBeTruthy();
  });

  it('quem já levou o toque 1 só recebe o 2 a partir do dia 3', async () => {
    const u = pagante({ confianca_count: 1 }); db.users.push(u); db.sales.push(venda(u.email, 2));
    expect((await runConfiancaNutricao()).enviados).toBe(0);

    db.sales[0].created_at = DIAS(3);
    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(1);
    expect(enviados[0].toque).toBe(2);
  });

  it('quem entrou há muito tempo pega o toque da vez, não uma enxurrada', async () => {
    const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 90));

    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(1);
    expect(enviados).toHaveLength(1);   // UM e-mail, não cinco
    expect(enviados[0].toque).toBe(1);
  });

  it('termina no quinto toque e não recomeça', async () => {
    const u = pagante({ confianca_count: 5 }); db.users.push(u); db.sales.push(venda(u.email, 120));
    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(0);
  });
});

describe('quem fica de fora', () => {
  it('sem venda casada NÃO recebe — chutar a data mandaria "dia 1" pra quem tem meses de casa', async () => {
    const u = pagante(); db.users.push(u);   // nenhuma linha em sales

    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(0);
    expect(r.semAncora).toBe(1);
  });

  it('cancelou (voltou pra free) sai da cadência', async () => {
    const u = pagante({ plano: 'free' }); db.users.push(u); db.sales.push(venda(u.email, 7));
    expect((await runConfiancaNutricao()).enviados).toBe(0);
  });

  it('opt-out de e-mail é respeitado', async () => {
    const u = pagante({ email_opt_out: true }); db.users.push(u); db.sales.push(venda(u.email, 7));
    expect((await runConfiancaNutricao()).enviados).toBe(0);
  });

  it('quem levou e-mail de OUTRA cadência hoje não leva o nosso junto', async () => {
    const u = pagante({ upgrade_nudge_last_sent_at: new Date().toISOString() });
    db.users.push(u); db.sales.push(venda(u.email, 7));

    expect((await runConfiancaNutricao()).enviados).toBe(0);

    // Passadas mais de 23h, ele volta pra fila.
    db.users[0].upgrade_nudge_last_sent_at = DIAS(2);
    expect((await runConfiancaNutricao()).enviados).toBe(1);
  });

  it('o próprio carimbo também segura — nada de dois toques nossos no mesmo dia', async () => {
    const u = pagante({ confianca_count: 1, confianca_last_sent_at: new Date().toISOString() });
    db.users.push(u); db.sales.push(venda(u.email, 30));
    expect((await runConfiancaNutricao()).enviados).toBe(0);
  });
});

describe('teto por rodada', () => {
  it('manda no máximo 10 por tick e deixa o resto pra próxima hora', async () => {
    for (let i = 0; i < 14; i++) {
      const u = pagante(); db.users.push(u); db.sales.push(venda(u.email, 5));
    }

    const r = await runConfiancaNutricao();
    expect(r.enviados).toBe(10);
    expect(r.previstos).toBe(14);

    const r2 = await runConfiancaNutricao();
    expect(r2.enviados).toBe(4);
  });
});
