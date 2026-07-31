import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Campanha ativa de reconquista com a entrada de R$19.
//
// Dois riscos justificam este arquivo:
//
// 1. VAZAR A OFERTA PRA QUEM PAGA. R$19 avulso é melhor que R$67/mês pro
//    cliente e pior pra empresa. Assinante saudável NÃO pode entrar no público.
// 2. QUEIMAR A LINHA. A linha solardoc já foi banida uma vez por envio
//    automático em massa. A campanha tem que respeitar o teto COMPARTILHADO
//    com a Carla, e parar de varrer quando estoura.
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>;
const db: Record<string, Row[]> = { users: [], kit_pedidos: [], system_state: [] };

const enviados: Array<{ phone: string; msg: string }> = [];
let tetoLiberado = true;
const marcados: string[] = [];

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let onConflict = '';

  const linhas = () => (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'upsert') {
      const ex = onConflict ? (db[table] ?? []).find((r) => r[onConflict] === pendente![onConflict]) : undefined;
      if (ex) { Object.assign(ex, pendente); return { data: ex, error: null }; }
      db[table] = [...(db[table] ?? []), { ...pendente! }];
      return { data: pendente, error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    upsert: (row: Row, opts?: { onConflict?: string }) => {
      modo = 'upsert'; pendente = row; onConflict = opts?.onConflict || ''; return q;
    },
    eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
    is: (col: string, val: any) => {
      filtros.push((r) => (val === null ? r[col] == null : String(r[col]) === String(val)));
      return q;
    },
    not: (col: string, _op: string, val: any) => {
      filtros.push((r) => (val === null ? r[col] != null : String(r[col]) !== String(val)));
      return q;
    },
    like: (col: string, pattern: string) => {
      const re = new RegExp('^' + pattern.replace(/%/g, '.*') + '$');
      filtros.push((r) => re.test(String(r[col] ?? '')));
      return q;
    },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn(async () => { throw new Error('sem IA no teste'); }) }; },
}));
vi.mock('../services/agents/zapiClient', () => ({
  // O envio é bolha a bolha (sendHuman). Pro teste, o que importa é o texto que
  // saiu — junta as bolhas de volta pra checar conteúdo, e o `||` já foi consumido.
  sendHuman: vi.fn(async (phone: string, partes: string[]) => {
    enviados.push({ phone, msg: partes.join(' ') });
  }),
  sleep: vi.fn(async () => {}),
}));
vi.mock('../services/agents/whatsapp/carlaThrottle', () => ({
  dentroDoTetoCarla: vi.fn(async () => tetoLiberado),
  marcarEnvioCarla: vi.fn(async (id: string) => { marcados.push(id); }),
  dentroDaJanelaDeEnvio: vi.fn(() => true),
}));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(async () => {}),
}));

import { runCursoEntradaBroadcast, MAX_TOQUES } from '../services/agents/whatsapp/cursoEntradaBroadcast';

function user(over: Row = {}): Row {
  return {
    id: 'u1', email: 'lead@teste.com', nome: 'Joao Silva', whatsapp: '5534999990000',
    plano: 'free', billing_status: 'active', whatsapp_opt_out: false, whatsapp_replied_at: null,
    ...over,
  };
}

beforeEach(() => {
  db.users = []; db.kit_pedidos = []; db.system_state = [];
  enviados.length = 0; marcados.length = 0; tetoLiberado = true;
  // Os testes de público/cadência assumem a campanha LIGADA. A trava em si tem
  // o bloco próprio abaixo, que desliga de novo.
  process.env.CAMPANHA_CURSO19_ON = 'true';
});

describe('trava de ligar (disparo em massa não começa sozinho)', () => {
  it('sem CAMPANHA_CURSO19_ON não envia nada, mesmo com público elegível', async () => {
    delete process.env.CAMPANHA_CURSO19_ON;
    db.users = [user()];
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
    expect(r.motivo).toMatch(/desligada/);
  });

  it('o modo seco funciona mesmo desligada — é assim que se revisa antes de ligar', async () => {
    delete process.env.CAMPANHA_CURSO19_ON;
    db.users = [user()];
    const r = await runCursoEntradaBroadcast({ seco: true });
    expect(r.previa).toHaveLength(1);
    expect(enviados).toHaveLength(0);
  });

  it('um deploy não liga a campanha: o padrão é desligado', async () => {
    delete process.env.CAMPANHA_CURSO19_ON;
    db.users = [user({ id: 'a' }), user({ id: 'b', whatsapp: '5534988887777', email: 'b@t.com' })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });
});

describe('quem entra na campanha', () => {
  it('FREE com WhatsApp recebe', async () => {
    db.users = [user()];
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(1);
    expect(enviados[0].phone).toBe('5534999990000');
  });

  it('inadimplente (cartão não passou) recebe — é o público de reconquista', async () => {
    db.users = [user({ plano: 'pro', billing_status: 'past_due' })];
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(1);
  });

  it('suspenso também recebe', async () => {
    db.users = [user({ plano: 'ilimitado', billing_status: 'suspended' })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(1);
  });
});

describe('quem NÃO pode receber', () => {
  it('PRO ativo fica de fora — R$19 canibalizaria os R$27/mês', async () => {
    db.users = [user({ plano: 'pro', billing_status: 'active' })];
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('VIP ativo fica de fora', async () => {
    db.users = [user({ plano: 'ilimitado', billing_status: 'active' })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });

  it('assinante em trial fica de fora', async () => {
    db.users = [user({ plano: 'pro', billing_status: 'trialing' })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });

  it('quem já tem o curso fica de fora — a campanha ofereceria o que ele já tem', async () => {
    db.users = [user()];
    db.kit_pedidos = [{ email: 'lead@teste.com', user_id: 'u1', itens: ['kit'], status: 'paid' }];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });

  it('quem já usou a entrada de R$19 fica de fora', async () => {
    db.users = [user()];
    db.system_state = [{ key: 'pix19_entrada:5534999990000', value: {} }];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });

  it('quem pediu pra sair (opt-out) fica de fora', async () => {
    db.users = [user({ whatsapp_opt_out: true })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });

  it('quem respondeu nas últimas 72h fica de fora — está em conversa viva', async () => {
    db.users = [user({ whatsapp_replied_at: new Date(Date.now() - 2 * 3600_000).toISOString() })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });

  it('mas quem respondeu HÁ MESES entra — é a parte mais quente da base', async () => {
    db.users = [user({ whatsapp_replied_at: new Date(Date.now() - 90 * 864e5).toISOString() })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(1);
  });

  it('sem WhatsApp fica de fora', async () => {
    db.users = [user({ whatsapp: null })];
    expect((await runCursoEntradaBroadcast()).enviados).toBe(0);
  });
});

describe('cadência', () => {
  it('T1 sai de primeira e grava o estado', async () => {
    db.users = [user()];
    await runCursoEntradaBroadcast();
    const estado = db.system_state.find((r) => r.key === 'curso19:u1');
    expect(estado?.value.count).toBe(1);
  });

  it('não repete o toque no tick seguinte (intervalo não venceu)', async () => {
    db.users = [user()];
    await runCursoEntradaBroadcast();
    enviados.length = 0;
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(0);
  });

  it('T2 sai depois de 3 dias', async () => {
    db.users = [user()];
    const tresDiasAtras = new Date(Date.now() - 4 * 864e5).toISOString();
    db.system_state = [{ key: 'curso19:u1', value: { count: 1, last_at: tresDiasAtras } }];
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(1);
    expect(db.system_state.find((s) => s.key === 'curso19:u1')?.value.count).toBe(2);
  });

  it('encerra depois do último toque e nunca mais volta', async () => {
    db.users = [user()];
    db.system_state = [{ key: 'curso19:u1', value: { count: MAX_TOQUES, last_at: new Date(0).toISOString() } }];
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(0);
  });
});

describe('anti-ban — a linha já foi banida uma vez', () => {
  it('teto estourado: não envia nada e segura pro próximo ciclo', async () => {
    db.users = [user({ id: 'u1' }), user({ id: 'u2', whatsapp: '5534988887777', email: 'b@t.com' })];
    tetoLiberado = false;
    const r = await runCursoEntradaBroadcast();
    expect(r.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('cada envio alimenta o teto COMPARTILHADO com a Carla', async () => {
    db.users = [user()];
    await runCursoEntradaBroadcast();
    expect(marcados).toEqual(['u1']);
  });

  it('respeita o limite do tick', async () => {
    db.users = [
      user({ id: 'u1' }),
      user({ id: 'u2', whatsapp: '5534988887777', email: 'b@t.com' }),
      user({ id: 'u3', whatsapp: '5534977776666', email: 'c@t.com' }),
    ];
    const r = await runCursoEntradaBroadcast({ limite: 2 });
    expect(r.enviados).toBe(2);
  });
});

describe('modo seco', () => {
  it('não envia, não marca o teto e não grava estado', async () => {
    db.users = [user()];
    const r = await runCursoEntradaBroadcast({ seco: true });

    expect(r.seco).toBe(true);
    expect(enviados).toHaveLength(0);
    expect(marcados).toHaveLength(0);
    expect(db.system_state.find((s) => s.key === 'curso19:u1')).toBeUndefined();
  });

  it('devolve a prévia com a mensagem que sairia', async () => {
    db.users = [user()];
    const r = await runCursoEntradaBroadcast({ seco: true });
    expect(r.previa?.[0].toque).toBe(1);
    expect(r.previa?.[0].nome).toBe('Joao');
    expect(r.previa?.[0].mensagem).toMatch(/R\$19/);
  });

  it('a prévia mostra o público correto e ignora quem paga', async () => {
    db.users = [user({ id: 'u1' }), user({ id: 'u2', plano: 'pro', billing_status: 'active', email: 'p@t.com' })];
    const r = await runCursoEntradaBroadcast({ seco: true });
    expect(r.previa).toHaveLength(1);
  });
});

describe('a mensagem do fallback (IA fora do ar)', () => {
  it('nunca sai vazia e nunca manda link de pagamento', async () => {
    db.users = [user()];
    await runCursoEntradaBroadcast();
    const msg = enviados[0].msg;
    expect(msg.length).toBeGreaterThan(20);
    expect(msg).not.toMatch(/https?:\/\//);      // link só no 1x1, depois da resposta
    expect(msg).not.toMatch(/7 dias/i);          // não mistura com o trial
  });
});
