import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// PÓS-VENDA DA SOLARDOC (04/11/2026), as condições do chefe-antiban:
//   2a  pagou e não criou a senha   (WhatsApp P3 transacional + reenvio do e-mail)
//   2b  criou a senha e não fez a 1ª proposta em 2 dias   (frio P5)
// O banco falso impõe chave única em system_state (o claim por INSERT) e entende os filtros usados.
// O portão da linha (recuperacaoCheckoutPortao) é o de verdade; só o teto e o espaçamento da linha são trocados por chaves.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const H = vi.hoisted(() => ({
  db: {} as Record<string, Array<Record<string, any>>>,
  teto: { transacional: true, frio: true, chamadas: [] as any[], aoPerguntar: null as null | (() => void) },
  envios: [] as Array<{ tel: string; partes: string[]; instancia: string; opts: any }>,
  sendFrio: { retorno: true as boolean, lanca: false },
  sessao: [] as any[],
  suprimidos: new Set<string>(),
  emails: [] as any[],
}));
const db = H.db;

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let pendente: Row | null = null;
  let max = Infinity;
  let ordem: { col: string; asc: boolean } | null = null;
  const linhas = () => {
    let l = (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));
    if (ordem) l = [...l].sort((a, b) => (String(a[ordem!.col]) < String(b[ordem!.col]) ? -1 : 1) * (ordem!.asc ? 1 : -1));
    return l.slice(0, max);
  };
  function executa(): { data: any; error: any } {
    if (!db[table]) db[table] = [];
    if (modo === 'insert') {
      if (table === 'system_state' && db[table].some((r) => r.key === pendente!.key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      db[table].push({ ...pendente });
      return { data: null, error: null };
    }
    if (modo === 'delete') {
      const alvos = new Set(linhas());
      db[table] = db[table].filter((r) => !alvos.has(r));
      return { data: null, error: null };
    }
    if (modo === 'update') { const a = linhas(); a.forEach((r) => Object.assign(r, patch)); return { data: a, error: null }; }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }
  const q: any = {
    select: () => q,
    insert: (r: Row) => { modo = 'insert'; pendente = r; return q; },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    is: (c: string, v: any) => { filtros.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    not: (c: string, op: string, v: any) => { filtros.push((r) => (op === 'is' && v === null ? r[c] != null : true)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    gte: (c: string, v: any) => { filtros.push((r) => String(r[c]) >= String(v)); return q; },
    lte: (c: string, v: any) => { filtros.push((r) => String(r[c]) <= String(v)); return q; },
    like: (c: string, p: string) => { const pre = p.replace(/%$/, ''); filtros.push((r) => String(r[c]).startsWith(pre)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { const { data, error } = executa(); return Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error }); },
    then: (res: (v: any) => void) => res(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/mailer', () => ({
  sendCheckoutCompletionEmail: vi.fn(async (o: any) => { H.emails.push(o); }),
  sendFollowupEmail: vi.fn(), sendNoContractsReminderEmail: vi.fn(), sendCnpjOngoingEmail: vi.fn(), sendCheckoutRecoveryEmail: vi.fn(),
  sendUpgradeNudgeEmail: vi.fn(), sendAbandonedCartEmail: vi.fn(),
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: vi.fn(async (tel: string, partes: string[], instancia: string, opts: any) => {
    if (H.sendFrio.lanca) throw new Error('z-api fora');
    H.envios.push({ tel, partes, instancia, opts });
    return H.sendFrio.retorno;
  }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async () => {
  const real = await vi.importActual<typeof import('../services/agents/whatsapp/lineThrottle')>('../services/agents/whatsapp/lineThrottle');
  return {
    ...real,
    dentroDoTetoHorarioLinha: vi.fn(async (opts: any = {}) => {
      H.teto.chamadas.push({ ...opts, chaves: (db.system_state ?? []).filter((r) => String(r.key).startsWith('ativ_')).length });
      H.teto.aoPerguntar?.();
      return opts.transacional ? H.teto.transacional : H.teto.frio;
    }),
    respeitaEspacamentoLinha: vi.fn(async () => true),
  };
});
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  TOQUES_ATE_DESISTIR: 3,
  motivosDaSupressao: vi.fn(async (tel: string) => (H.suprimidos.has(tel) ? ['opt_out'] : [])),
  carregarMudos: vi.fn(async () => () => false),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({ podeFalarComLead: vi.fn(async () => ({ pode: true })) }));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ CHAVE_LINHA_PAUSA: 'ag5040_linha_pausa' }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(async (a: any) => { H.sessao.push(a); }),
}));
vi.mock('../services/agents/whatsapp/pixRecoveryAgentService', () => ({ enviarOpenerRecuperacao: vi.fn() }));
vi.mock('stripe', () => ({ default: class { } }));

import { enviarSenhaNaoCriada, enviarPrimeiraProposta, rodarAtivacaoPosVenda, contasPagasSemSenha } from '../services/solardoc/ativacaoPosVenda';
import { recoverOrphanCheckouts } from '../services/followupService';
import { dentroDoTetoHorarioLinha } from '../services/agents/whatsapp/lineThrottle';

const HORA = 3600_000, DIA = 24 * HORA;
// Quarta-feira 04/11/2026: 12h BRT = 15h UTC.
const AGORA_12H = Date.parse('2026-11-04T15:00:00Z');
const AGORA_22H = Date.parse('2026-11-05T01:00:00Z');
const AGORA_08H = Date.parse('2026-11-04T11:00:00Z');
const DOMINGO_12H = Date.parse('2026-11-08T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function usuario(over: Row = {}): Row {
  return {
    id: 'u1', email: 'maria@teste.com', nome: 'Maria da Silva', whatsapp: '5534999990001', plano: 'ilimitado',
    password_hash: null, reset_token: 'TOKEN-1', reset_token_expires: iso(AGORA_12H + 20 * DIA), created_at: iso(AGORA_12H - 3 * HORA),
    whatsapp_opt_out: false, ...over,
  };
}
const chaves = (prefixo: string) => db.system_state.filter((r) => String(r.key).startsWith(prefixo)).map((r) => r.key);

beforeEach(() => {
  for (const t of ['users', 'asaas_pix_assinaturas', 'system_state', 'sales', 'documents']) db[t] = [];
  H.teto.transacional = true; H.teto.frio = true; H.teto.chamadas.length = 0; H.teto.aoPerguntar = null;
  H.envios.length = 0; H.sessao.length = 0; H.emails.length = 0; H.suprimidos.clear();
  H.sendFrio.retorno = true; H.sendFrio.lanca = false;
  delete process.env.ATIVACAO_POS_VENDA_OFF;
  vi.mocked(dentroDoTetoHorarioLinha).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('2a · pagou e não criou a senha (WhatsApp P3, da Giovanna)', () => {
  // Pagamento de verdade: venda em `sales` com o cartão aprovado (os testes abaixo usam o e-mail padrão da conta).
  beforeEach(() => { db.sales = [{ email: 'maria@teste.com', card_passed_at: iso(AGORA_12H - 5 * HORA) }]; });

  it('conta liberada à mão (plano pago, sem venda e sem contrato Pix) NÃO recebe "seu pagamento caiu"; contrato Pix só inadimplente também não', async () => {
    db.sales = [];
    db.users = [usuario(), usuario({ id: 'inad', email: 'inad@teste.com', whatsapp: '5534977770009', plano: 'free' })];
    db.asaas_pix_assinaturas = [{ user_id: 'inad', email: 'inad@teste.com', status: 'inadimplente', ultimo_pagamento_em: iso(AGORA_12H - 4 * HORA) }];
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
    expect(chaves('ativ_senha_sent:')).toEqual([]);
    // com a venda gravada, a mesma conta recebe
    db.sales = [{ email: 'maria@teste.com', card_passed_at: iso(AGORA_12H - 5 * HORA) }];
    expect((await enviarSenhaNaoCriada(new Date(AGORA_12H))).enviados).toBe(1);
  });

  it('conta de admin ou de teste não recebe a 2a', async () => {
    db.users = [
      usuario({ id: 'adm', is_admin: true }),
      usuario({ id: 'tst', email: 'maria.teste@x.com', whatsapp: '5534977770002' }),
      usuario({ id: 'nome', nome: 'Conta Teste', whatsapp: '5534977770003' }),
    ];
    db.sales = [{ email: 'maria@teste.com', card_passed_at: iso(AGORA_12H - 5 * HORA) }, { email: 'maria.teste@x.com', card_passed_at: iso(AGORA_12H - 5 * HORA) }];
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
  });

  it('às 22h não sai; às 8h sai (janela das 7h às 21h), em 1 bolha, sem link, por sendFrio SEM a flag transacional', async () => {
    db.users = [usuario()];
    const noite = await enviarSenhaNaoCriada(new Date(AGORA_22H));
    expect(noite.motivo).toBe('fora_da_janela');
    expect(H.envios).toHaveLength(0);
    expect(chaves('ativ_senha_sent:')).toEqual([]);

    db.users = [usuario({ created_at: iso(AGORA_08H - 3 * HORA), reset_token_expires: iso(AGORA_08H + 20 * DIA) })];
    const manha = await enviarSenhaNaoCriada(new Date(AGORA_08H));
    expect(manha.enviados).toBe(1);
    expect(H.envios).toHaveLength(1);
    const e = H.envios[0]!;
    expect(e).toMatchObject({ tel: '5534999990001', instancia: 'solardoc' });
    expect(e.opts).toBeUndefined();                                     // sem { transacional: true }: a pausa humana vale
    expect(e.partes).toHaveLength(1);
    expect(e.partes[0]).toBe('Oi, Maria, aqui é a Giovanna, da SolarDoc. Seu pagamento caiu, mas a senha ainda não foi criada. O link está no e-mail m***@teste.com, e se você responder aqui eu reenvio.');
    expect(e.partes[0]).not.toMatch(/https?:|solardoc\.app|token/i);
    expect(chaves('ativ_senha_sent:')).toEqual(['ativ_senha_sent:u1']);
    expect(H.sessao).toHaveLength(1);                                   // a Giovanna fica com o contexto
    expect(H.sessao[0]).toMatchObject({ userId: 'u1', phone: '5534999990001' });
  });

  it('só depois de 2 h do pagamento', async () => {
    db.users = [usuario({ created_at: iso(AGORA_12H - 90 * 60_000) })];
    expect((await enviarSenhaNaoCriada(new Date(AGORA_12H))).enviados).toBe(0);
    db.users = [usuario({ created_at: iso(AGORA_12H - 2 * HORA) })];
    expect((await enviarSenhaNaoCriada(new Date(AGORA_12H))).enviados).toBe(1);
  });

  it('o teto transacional da linha é perguntado ANTES do claim: teto cheio, nenhum carimbo e nenhum envio', async () => {
    db.users = [usuario()];
    H.teto.transacional = false;
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r).toMatchObject({ enviados: 0, motivo: 'teto' });
    expect(vi.mocked(dentroDoTetoHorarioLinha)).toHaveBeenCalledWith({ transacional: true });
    expect(H.teto.chamadas[0]!.chaves).toBe(0);                          // na hora da pergunta ainda não havia claim
    expect(chaves('ativ_senha_sent:')).toEqual([]);
    expect(H.envios).toHaveLength(0);
  });

  it('dois relógios do /master ao mesmo tempo dão 1 envio só (o claim é por INSERT)', async () => {
    db.users = [usuario()];
    const [a, b] = await Promise.all([enviarSenhaNaoCriada(new Date(AGORA_12H)), enviarSenhaNaoCriada(new Date(AGORA_12H))]);
    expect(a.enviados + b.enviados).toBe(1);
    expect(H.envios).toHaveLength(1);
    // e uma rodada depois não repete
    await enviarSenhaNaoCriada(new Date(AGORA_12H + HORA));
    expect(H.envios).toHaveLength(1);
  });

  it('quem criou a senha no meio do tick não recebe (relê "ainda sem senha" depois do claim) e o claim é desfeito', async () => {
    db.users = [usuario()];
    H.teto.aoPerguntar = () => { db.users[0]!.password_hash = 'hash'; };    // a pessoa define a senha entre a lista e o claim
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
    expect(chaves('ativ_senha_sent:')).toEqual([]);
  });

  it('quem já tem senha, sem WhatsApp, em opt-out, suprimido ou com link vencido não recebe', async () => {
    db.users = [
      usuario({ id: 'a', password_hash: 'x' }),
      usuario({ id: 'b', whatsapp: null }),
      usuario({ id: 'c', whatsapp_opt_out: true }),
      usuario({ id: 'd', whatsapp: '5534988880004' }),
      usuario({ id: 'e', reset_token_expires: iso(AGORA_12H - HORA) }),
    ];
    H.suprimidos.add('5534988880004');
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
  });

  it('a conta do Pix automático entra mesmo com o plano ainda "free" (contrato ativo); conta free sem contrato não', async () => {
    db.users = [
      usuario({ id: 'pix', plano: 'free', email: 'pix@teste.com', created_at: iso(AGORA_12H - 5 * HORA) }),
      usuario({ id: 'gratis', plano: 'free', email: 'gratis@teste.com', whatsapp: '5534977770002' }),
    ];
    db.asaas_pix_assinaturas = [{ user_id: 'pix', email: 'pix@teste.com', status: 'ativo', ultimo_pagamento_em: iso(AGORA_12H - 4 * HORA) }];
    const contas = await contasPagasSemSenha(AGORA_12H, 7 * DIA);
    expect(contas!.map((c) => c.id)).toEqual(['pix']);
    expect(contas![0]!.viaPixAuto).toBe(true);
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r.enviados).toBe(1);
    expect(H.sessao[0]).toMatchObject({ userId: 'pix' });
  });

  it('1 por tick: dois candidatos, o segundo espera o próximo tick; sendFrio que cala (pausa humana) desfaz o claim e segue', async () => {
    db.users = [usuario({ id: 'a', created_at: iso(AGORA_12H - 5 * HORA) }), usuario({ id: 'b', whatsapp: '5534977770002', created_at: iso(AGORA_12H - 4 * HORA) })];
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r.enviados).toBe(1);
    expect(chaves('ativ_senha_sent:')).toEqual(['ativ_senha_sent:a']);

    db.system_state = [];
    H.envios.length = 0;
    H.sendFrio.retorno = false;                                          // a pausa humana calou o envio
    const calou = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(calou.enviados).toBe(0);
    expect(chaves('ativ_senha_sent:')).toEqual([]);                      // nenhum claim ficou queimado
  });

  it('erro de envio para o tick no primeiro erro e o claim FICA (não repete)', async () => {
    db.users = [usuario({ id: 'a', created_at: iso(AGORA_12H - 5 * HORA) }), usuario({ id: 'b', whatsapp: '5534977770002', created_at: iso(AGORA_12H - 4 * HORA) })];
    H.sendFrio.lanca = true;
    const r = await enviarSenhaNaoCriada(new Date(AGORA_12H));
    expect(r).toMatchObject({ enviados: 0, erros: 1 });
    expect(chaves('ativ_senha_sent:')).toEqual(['ativ_senha_sent:a']);
  });

  it('ATIVACAO_POS_VENDA_OFF=1 desliga as duas cobranças', async () => {
    db.users = [usuario()];
    process.env.ATIVACAO_POS_VENDA_OFF = '1';
    const r = await rodarAtivacaoPosVenda(new Date(AGORA_12H));
    expect(r.senha.motivo).toBe('desligado');
    expect(H.envios).toHaveLength(0);
  });
});

describe('2a · reenvio do link por e-mail (recoverOrphanCheckouts)', () => {
  it('vale também para a conta do Pix automático, 2 h depois do pagamento, uma vez por conta; o cartão segue com 30 min', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA_12H);
    db.users = [
      usuario({ id: 'cartao', email: 'cartao@teste.com', whatsapp: null, created_at: iso(AGORA_12H - 40 * 60_000) }),
      usuario({ id: 'pix', email: 'pix@teste.com', whatsapp: null, plano: 'free', created_at: iso(AGORA_12H - 3 * HORA) }),
      usuario({ id: 'pixcedo', email: 'pixcedo@teste.com', whatsapp: null, plano: 'free', created_at: iso(AGORA_12H - 3 * HORA) }),
    ];
    db.asaas_pix_assinaturas = [
      { user_id: 'pix', email: 'pix@teste.com', status: 'ativo', ultimo_pagamento_em: iso(AGORA_12H - 150 * 60_000) },
      { user_id: 'pixcedo', email: 'pixcedo@teste.com', status: 'ativo', ultimo_pagamento_em: iso(AGORA_12H - 90 * 60_000) },
    ];
    const r1 = await recoverOrphanCheckouts();
    expect(r1.sent).toBe(2);
    expect(H.emails.map((e) => e.to).sort()).toEqual(['cartao@teste.com', 'pix@teste.com']);
    expect(H.emails[0].resetUrl).toContain('/auth?mode=redefinir&token=');
    const r2 = await recoverOrphanCheckouts();                            // uma vez por conta
    expect(r2.sent).toBe(0);
    expect(H.emails).toHaveLength(2);
    expect(chaves('activation_nudge:').sort()).toEqual(['activation_nudge:cartao', 'activation_nudge:pix']);
  });
});

describe('2b · criou a senha e não fez a 1ª proposta (frio P5)', () => {
  const pagante = (over: Row = {}): Row => usuario({ password_hash: 'hash', reset_token: null, reset_token_expires: null, created_at: iso(AGORA_12H - 5 * DIA), ...over });
  const venda = (email: string, ha: number): Row => ({ email, card_passed_at: iso(AGORA_12H - ha) });

  it('envia a quem pagou há 2 dias ou mais, tem senha e 0 propostas: 1 bolha da Giovanna, com o claim antes do envio', async () => {
    db.users = [pagante()];
    db.sales = [venda('maria@teste.com', 3 * DIA)];
    const r = await enviarPrimeiraProposta(new Date(AGORA_12H));
    expect(r.enviados).toBe(1);
    expect(H.envios).toHaveLength(1);
    expect(H.envios[0]).toMatchObject({ tel: '5534999990001', instancia: 'solardoc' });
    expect(H.envios[0]!.partes).toHaveLength(1);
    expect(H.envios[0]!.partes[0]).toBe('Oi, Maria, aqui é a Giovanna, do suporte da SolarDoc. Se quiser, eu te guio na sua 1ª proposta aqui pelo WhatsApp. Ela sai em poucos minutos, com a logo e a cor da sua empresa, pronta para mandar no WhatsApp. O suporte está junto com você, é só chamar quando for fazer.');
    expect(chaves('ativ_proposta_sent:')).toEqual(['ativ_proposta_sent:u1']);
    expect(db.system_state.find((x) => x.key === 'ativ_proposta_sent:u1')!.updated_at).toBeTruthy();   // o teto e o espaçamento contam por updated_at
    expect(H.sessao).toHaveLength(1);
    // o teto frio foi perguntado COM o robô
    expect(vi.mocked(dentroDoTetoHorarioLinha)).toHaveBeenCalledWith({ transacional: false, robo: 'ativ_proposta' });
  });

  it('domingo não sai (janela da Base: 9h às 20h, segunda a sábado)', async () => {
    db.users = [pagante()];
    db.sales = [venda('maria@teste.com', 3 * DIA)];
    const r = await enviarPrimeiraProposta(new Date(DOMINGO_12H));
    expect(r.enviados).toBe(0);
    expect(r.motivo).toBe('fora_da_janela');
    expect(H.envios).toHaveLength(0);
    expect(chaves('ativ_proposta_sent:')).toEqual([]);
  });

  it('teto frio cheio não sai', async () => {
    db.users = [pagante()];
    db.sales = [venda('maria@teste.com', 3 * DIA)];
    H.teto.frio = false;
    const r = await enviarPrimeiraProposta(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(r.motivo).toBe('teto');
    expect(H.envios).toHaveLength(0);
    expect(chaves('ativ_proposta_sent:')).toEqual([]);
  });

  it('quem já fez proposta solar não recebe; proposta de outro tipo não conta como a 1ª proposta solar', async () => {
    db.users = [pagante({ id: 'fez' }), pagante({ id: 'nao', email: 'nao@teste.com', whatsapp: '5534977770002' })];
    db.sales = [venda('maria@teste.com', 3 * DIA), venda('nao@teste.com', 4 * DIA)];
    db.documents = [{ user_id: 'fez', tipo: 'propostaSolar' }, { user_id: 'nao', tipo: 'contrato' }];
    const r = await enviarPrimeiraProposta(new Date(AGORA_12H));
    expect(r.enviados).toBe(1);
    expect(chaves('ativ_proposta_sent:')).toEqual(['ativ_proposta_sent:nao']);
  });

  it('conta de admin ou de teste não recebe a 2b', async () => {
    db.users = [pagante({ id: 'adm', email: 'adm@t.com', is_admin: true }), pagante({ id: 'tst', email: 'qa.test@t.com', whatsapp: '5534977770002' })];
    db.sales = [venda('adm@t.com', 3 * DIA), venda('qa.test@t.com', 3 * DIA)];
    const r = await enviarPrimeiraProposta(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
  });

  it('antes de 2 dias, depois de 30 dias, sem senha, em opt-out ou suprimido não recebe', async () => {
    db.users = [
      pagante({ id: 'cedo', email: 'cedo@t.com' }),
      pagante({ id: 'velho', email: 'velho@t.com', whatsapp: '5534911110001' }),
      pagante({ id: 'semsenha', email: 'semsenha@t.com', password_hash: null, whatsapp: '5534911110002' }),
      pagante({ id: 'optout', email: 'optout@t.com', whatsapp_opt_out: true, whatsapp: '5534911110003' }),
      pagante({ id: 'supr', email: 'supr@t.com', whatsapp: '5534911110004' }),
    ];
    db.sales = [venda('cedo@t.com', 1 * DIA), venda('velho@t.com', 31 * DIA), venda('semsenha@t.com', 3 * DIA), venda('optout@t.com', 3 * DIA), venda('supr@t.com', 3 * DIA)];
    H.suprimidos.add('5534911110004');
    const r = await enviarPrimeiraProposta(new Date(AGORA_12H));
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
  });

  it('1 por tick, e quem já foi convidado não é convidado de novo', async () => {
    db.users = [pagante({ id: 'a', email: 'a@t.com' }), pagante({ id: 'b', email: 'b@t.com', whatsapp: '5534977770002' })];
    db.sales = [venda('a@t.com', 4 * DIA), venda('b@t.com', 3 * DIA)];
    expect((await enviarPrimeiraProposta(new Date(AGORA_12H))).enviados).toBe(1);
    expect(chaves('ativ_proposta_sent:')).toEqual(['ativ_proposta_sent:a']);
    expect((await enviarPrimeiraProposta(new Date(AGORA_12H))).enviados).toBe(1);
    expect(chaves('ativ_proposta_sent:').sort()).toEqual(['ativ_proposta_sent:a', 'ativ_proposta_sent:b']);
    expect((await enviarPrimeiraProposta(new Date(AGORA_12H))).enviados).toBe(0);
  });

  it('erro de envio para o tick e o claim fica', async () => {
    db.users = [pagante({ id: 'a', email: 'a@t.com' }), pagante({ id: 'b', email: 'b@t.com', whatsapp: '5534977770002' })];
    db.sales = [venda('a@t.com', 4 * DIA), venda('b@t.com', 3 * DIA)];
    H.sendFrio.lanca = true;
    const r = await enviarPrimeiraProposta(new Date(AGORA_12H));
    expect(r).toMatchObject({ enviados: 0, erros: 1 });
    expect(chaves('ativ_proposta_sent:')).toEqual(['ativ_proposta_sent:a']);
  });
});

describe('no máximo 2 proativas por pessoa no 1º mês (2a + 2b)', () => {
  it('rodar muitas vezes nunca passa de 1 cobrança de senha e 1 convite de proposta por pessoa', async () => {
    // O dia do pagamento: senha pendente. Dois dias depois, a senha criada e nenhuma proposta.
    db.sales = [{ email: 'maria@teste.com', card_passed_at: iso(AGORA_12H - 3 * HORA) }];
    db.users = [usuario({ created_at: iso(AGORA_12H - 3 * HORA) })];
    for (let i = 0; i < 3; i++) await rodarAtivacaoPosVenda(new Date(AGORA_12H + i * HORA));
    expect(H.envios).toHaveLength(1);
    db.users[0]!.password_hash = 'hash';
    db.sales = [{ email: 'maria@teste.com', card_passed_at: iso(AGORA_12H - 3 * HORA) }];
    const tresDiasDepois = AGORA_12H + 3 * DIA;
    for (let i = 0; i < 4; i++) await rodarAtivacaoPosVenda(new Date(tresDiasDepois + i * 2 * HORA));
    expect(H.envios).toHaveLength(2);
    expect(H.envios.map((e) => e.partes[0]!.includes('senha ainda não foi criada'))).toEqual([true, false]);
    expect(db.system_state.filter((r) => /^ativ_(senha|proposta)_sent:/.test(String(r.key))).map((r) => r.key).sort())
      .toEqual(['ativ_proposta_sent:u1', 'ativ_senha_sent:u1']);
  });
});
