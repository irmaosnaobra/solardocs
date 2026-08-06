import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// TRILHA 1x1 DO LIMPAPRO — o risco desta agente não é errar a copy: é FALAR COM QUEM
// NÃO DEVIA (cliente de energia, lead da Bia), prometer acesso que não chega, ou ficar
// respondendo depois que um humano assumiu. Os testes trancam exatamente isso.

const db = {
  membros: [] as any[],
  entitlements: [] as any[],
  sessions: [] as any[],
  webhooks: [] as any[],
  state: new Map<string, any>(),
};

const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const avisos: Array<{ phone: string; texto: string }> = [];
const fetches: Array<{ url: string; body: any }> = [];
let fetchOk = true;
let respostaIA = 'Oi! Já te ajudo.';

function makeQuery(table: string) {
  const filtros: Array<{ tipo: 'eq' | 'in'; col: string; val: any }> = [];

  function linhas(): any[] {
    let base: any[] =
      table === 'limpapro_membros' ? db.membros
      : table === 'limpapro_entitlements' ? db.entitlements
      : table === 'whatsapp_sessions' ? db.sessions
      : table === 'webhook_debug' ? db.webhooks.map(payload => ({ payload, created_at: new Date().toISOString() }))
      : [];
    for (const f of filtros) {
      base = base.filter(r => f.tipo === 'eq'
        ? String(r[f.col]) === String(f.val)
        : (f.val as any[]).map(String).includes(String(r[f.col])));
    }
    return base;
  }

  const q: any = {
    select() { return q; },
    eq(col: string, val: any) { filtros.push({ tipo: 'eq', col, val }); return q; },
    in(col: string, val: any[]) { filtros.push({ tipo: 'in', col, val }); return q; },
    gte() { return q; },
    order() { return q; },
    limit() { return q; },
    maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
    then(ok: any, err: any) { return Promise.resolve({ data: linhas(), error: null }).then(ok, err); },
    upsert(payload: any) {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        if (table === 'whatsapp_sessions') {
          const i = db.sessions.findIndex(s => s.phone === row.phone && s.tipo === row.tipo);
          if (i >= 0) db.sessions[i] = { ...db.sessions[i], ...row }; else db.sessions.push({ ...row });
        } else if (table === 'system_state') {
          db.state.set(row.key, row);
        }
      }
      return Promise.resolve({ error: null });
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => makeQuery(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => { avisos.push({ phone, texto }); }),
  fmtPhone: (p: string) => { const d = String(p).replace(/\D/g, ''); return d.startsWith('55') ? d : `55${d}`; },
}));
vi.mock('../services/agents/sdr/sdrAgentService', () => ({ tryClaimMessage: vi.fn(async () => true) }));
vi.mock('../services/io/cerebroAgentes', () => ({ carregarCerebro: vi.fn(async () => null) }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn(async () => ({ content: [{ type: 'text', text: respostaIA }] })) };
  },
}));

import {
  ehAlunoLimpapro, handleLimpaproAtendimento, pollLimpaproAtendimento,
  buildAtendimentoSystemPrompt, marcarTakeoverLimpapro,
} from '../services/agents/whatsapp/limpaproAtendimentoService';

const TEL = '5517996143828';
const EMAIL = 'durval@exemplo.com';

function membro(over: Partial<any> = {}) {
  return {
    email: EMAIL, nome: 'Durval Neto', telefone: TEL, ativo: true,
    criado_em: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    ultimo_acesso_em: null, senha_hash: null, ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  db.membros = [membro()];
  db.entitlements = [{ email: EMAIL, item: 'curso-principal', ativo: true }];
  db.sessions = []; db.webhooks = []; db.state.clear();
  enviadas.length = 0; avisos.length = 0; fetches.length = 0;
  fetchOk = true; respostaIA = 'Oi Durval! Já te ajudo.';
  process.env.LIMPAPRO_ATENDIMENTO_ENABLED = 'true';
  process.env.ZAPI_INSTANCE_ID_IO = 'INSTANCIA';
  global.fetch = vi.fn(async (url: any, init: any) => {
    fetches.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return { ok: fetchOk, status: fetchOk ? 200 : 500, json: async () => ({}) } as any;
  }) as any;
});
afterEach(() => { process.env = { ...envOriginal }; vi.clearAllMocks(); });

describe('quem a trilha atende', () => {
  it('nasce DESLIGADA — sem a env, nem reconhece o aluno', async () => {
    delete process.env.LIMPAPRO_ATENDIMENTO_ENABLED;
    expect(await ehAlunoLimpapro(TEL)).toBeNull();
    await handleLimpaproAtendimento(TEL, 'não consigo entrar');
    expect(enviadas).toHaveLength(0);
  });

  it('reconhece o aluno mesmo com o 9º dígito diferente do cadastro', async () => {
    const aluno = await ehAlunoLimpapro('17996143828');   // sem o 55
    expect(aluno?.email).toBe(EMAIL);
  });

  it('reconhece o aluno cujo cadastro veio da Kiwify com "+" na frente', async () => {
    // 2 dos 112 cadastros estão como "+5551997518181". Sem a forma com +, o .in() do
    // Postgres (comparação exata) nunca casaria e esse aluno ficaria invisível.
    db.membros = [membro({ telefone: '+5551997518181', email: 'gaspar@exemplo.com' })];
    const aluno = await ehAlunoLimpapro('5551997518181');
    expect(aluno?.email).toBe('gaspar@exemplo.com');
  });

  it('não responde quem NÃO é aluno (cliente de energia nunca casa)', async () => {
    expect(await ehAlunoLimpapro('5534999990000')).toBeNull();
    await handleLimpaproAtendimento('5534999990000', 'quero orçamento de placa');
    expect(enviadas).toHaveLength(0);
  });

  it('não responde membro inativo (acesso revogado)', async () => {
    db.membros = [membro({ ativo: false })];
    expect(await ehAlunoLimpapro(TEL)).toBeNull();
  });

  it('a Bia tem preferência: lead de recuperação não é tocado pela trilha', async () => {
    db.sessions.push({ phone: TEL, tipo: 'recuperacao', messages: [], lead_data: {} });
    db.webhooks.push({ type: 'ReceivedCallback', instanceId: '3F26F6ECE67D72BB7FCA6244BF24326C', phone: TEL, fromMe: false, text: { message: 'oi' }, messageId: 'm1' });
    process.env.RECUP_ENABLED = 'true';
    const r = await pollLimpaproAtendimento();
    expect(r.processed).toBe(0);
    expect(enviadas).toHaveLength(0);
  });
});

describe('takeover humano', () => {
  it('depois que o humano digita, a agente cala', async () => {
    await marcarTakeoverLimpapro(TEL);
    await handleLimpaproAtendimento(TEL, 'e o módulo 5?');
    expect(enviadas).toHaveLength(0);
    // mas guarda a mensagem no histórico, pra quem assumir ler o contexto
    const s = db.sessions.find(x => x.tipo === 'limpapro');
    expect(JSON.stringify(s.messages)).toContain('módulo 5');
  });

  it('"não quero mais mensagem" cala sem chamar a IA e não ameaça o acesso', async () => {
    await handleLimpaproAtendimento(TEL, 'não me manda mais mensagem');
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].bolhas.join(' ')).toMatch(/acesso ao curso continua/i);
    const s = db.sessions.find(x => x.tipo === 'limpapro');
    expect(s.lead_data.human_takeover).toBe(true);
  });
});

describe('ramo 1 — acesso', () => {
  it('[REENVIAR_ACESSO] dispara o link no e-mail do aluno e a tag não vaza pro cliente', async () => {
    respostaIA = 'Te mandei um link de entrada no seu e-mail agora.||Olha também o spam. [REENVIAR_ACESSO]';
    await handleLimpaproAtendimento(TEL, 'esqueci minha senha');

    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe('https://limpapro.solardoc.app/api/membro-login');
    expect(fetches[0].body).toEqual({ email: EMAIL });
    expect(enviadas[0].bolhas.join(' ')).not.toContain('REENVIAR_ACESSO');
    expect(db.sessions.find(x => x.tipo === 'limpapro').lead_data.acesso_reenviado_em).toBeTruthy();
  });

  it('dois pedidos seguidos geram UM reenvio só (cooldown)', async () => {
    respostaIA = 'Mandei no e-mail. [REENVIAR_ACESSO]';
    await handleLimpaproAtendimento(TEL, 'esqueci a senha');
    await handleLimpaproAtendimento(TEL, 'não chegou nada');
    expect(fetches).toHaveLength(1);
  });

  it('se o reenvio FALHA, chama humano em vez de deixar o aluno esperando e-mail', async () => {
    fetchOk = false;
    respostaIA = 'Já te mandei no e-mail. [REENVIAR_ACESSO]';
    await handleLimpaproAtendimento(TEL, 'não consigo entrar');

    const s = db.sessions.find(x => x.tipo === 'limpapro');
    expect(s.lead_data.human_takeover).toBe(true);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].texto).toContain(EMAIL);
    expect(avisos[0].texto).toMatch(/FALHOU/);
  });
});

describe('ramo 4 — escalar', () => {
  it('[ESCALAR] cala a agente, avisa o dono e não manda a tag pro cliente', async () => {
    respostaIA = 'Poxa, sinto muito. Vou passar pro time agora. [ESCALAR]';
    await handleLimpaproAtendimento(TEL, 'quero reembolso, me cobraram duas vezes');

    expect(enviadas[0].bolhas.join(' ')).not.toContain('ESCALAR');
    expect(avisos).toHaveLength(1);
    expect(avisos[0].phone).toBe('34991360223');
    expect(avisos[0].texto).toContain('reembolso');
    const s = db.sessions.find(x => x.tipo === 'limpapro');
    expect(s.lead_data.human_takeover).toBe(true);

    // e a próxima mensagem dele já não é respondida pela IA
    enviadas.length = 0;
    await handleLimpaproAtendimento(TEL, 'e aí?');
    expect(enviadas).toHaveLength(0);
  });
});

describe('ramo 4b — assunto de outra área', () => {
  it('[NAO_E_COMIGO] avisa o time SEM matar a trilha: ele volta a ser atendido depois', async () => {
    respostaIA = 'Isso é com o time de energia, já avisei eles. [NAO_E_COMIGO]';
    await handleLimpaproAtendimento(TEL, 'quero orçamento de placa pra minha casa');

    expect(enviadas[0].bolhas.join(' ')).not.toContain('NAO_E_COMIGO');
    expect(avisos).toHaveLength(1);
    const s = db.sessions.find(x => x.tipo === 'limpapro');
    expect(s.lead_data.human_takeover).toBeUndefined();   // NÃO cala

    // dias depois ele pergunta do curso — e é atendido normalmente
    enviadas.length = 0;
    respostaIA = 'Claro! Te ajudo com a senha agora.';
    await handleLimpaproAtendimento(TEL, 'e minha senha do app?');
    expect(enviadas).toHaveLength(1);
  });

  it('perguntar de placa três vezes gera UM recado só (cooldown de 6h)', async () => {
    respostaIA = 'Já avisei o time. [NAO_E_COMIGO]';
    await handleLimpaproAtendimento(TEL, 'quanto custa instalar placa?');
    await handleLimpaproAtendimento(TEL, 'e com bateria?');
    await handleLimpaproAtendimento(TEL, 'me manda um orçamento');
    expect(avisos).toHaveLength(1);
  });
});

describe('o que o prompt garante', () => {
  const base = { email: EMAIL, itens: ['curso-principal'], diasDesdeCompra: 3, jaAcessou: false, temSenha: false };

  it('proíbe prometer vídeo e manda o acesso só por e-mail', () => {
    const p = buildAtendimentoSystemPrompt({ ...base, nome: 'Durval' });
    expect(p).toMatch(/NÃO É VIDEOAULA/);
    expect(p).toMatch(/NUNCA mande link de acesso\/senha por aqui/);
    expect(p).toContain(EMAIL);
  });

  it('conta os dias que faltam pro módulo 5 em vez de deixar a IA chutar', () => {
    expect(buildAtendimentoSystemPrompt({ ...base, diasDesdeCompra: 3 })).toMatch(/abrem em 4 dia\(s\)/);
    expect(buildAtendimentoSystemPrompt({ ...base, diasDesdeCompra: 9 })).toMatch(/JÁ estão abertos/);
    expect(buildAtendimentoSystemPrompt({ ...base, diasDesdeCompra: null })).toMatch(/não afirme/i);
  });

  it('leva os três degraus da mentoria com preço e link exatos', () => {
    const p = buildAtendimentoSystemPrompt(base);
    expect(p).toContain('R$ 297 · https://limpapro.solardoc.app/mentoria-297');
    expect(p).toContain('R$ 497 · https://limpapro.solardoc.app/mentoria-497');
    expect(p).toContain('R$ 997 · https://limpapro.solardoc.app/mentoria');
    expect(p).toMatch(/no máximo UM degrau por conversa/i);
  });

  it('separa o que cala a agente do que é só recado de outra área', () => {
    const p = buildAtendimentoSystemPrompt(base);
    expect(p).toMatch(/\[ESCALAR\][\s\S]*reembolso/);
    expect(p).toMatch(/\[NAO_E_COMIGO\]/);
    expect(p).toMatch(/aqui você NÃO some/i);
  });

  it('não vende curso pra quem já comprou', () => {
    expect(buildAtendimentoSystemPrompt(base)).toMatch(/NUNCA venda o curso pra quem já comprou/);
  });
});

describe('auditoria', () => {
  it('grava marcador fora dos prefixos do teto anti-ban (resposta não come cota da Bia)', async () => {
    await handleLimpaproAtendimento(TEL, 'oi');
    const chaves = [...db.state.keys()];
    expect(chaves.some(k => k.startsWith('limpapro_atendimento:'))).toBe(true);
    // os prefixos contados pelo lineThrottle são estes — nenhum pode casar
    const contados = ['limpapro_recovery:', 'limpapro_cupom_sent:', 'limpapro_fechamento_sent:', 'limpapro_grupo_sent:'];
    expect(chaves.some(k => contados.some(p => k.startsWith(p)))).toBe(false);
  });
});
