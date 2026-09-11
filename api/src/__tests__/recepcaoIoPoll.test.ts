import { describe, it, expect, vi, beforeEach } from 'vitest';

// O poll é a PORTA DE ENTRADA da recepção desde 11/09/2026, porque o background
// do /webhook/io é cortado em ponto imprevisível (duas execuções em produção,
// dois pontos de morte diferentes). O que este arquivo protege:
//
//   ORDEM DOS DONOS → a recepção é a última da fila. Cada trilha na frente dela
//                     (vendedora do SolarDoc, Bia, LimpaPro) já foi atropelada
//                     uma vez nesta linha, e atropelar de novo é o custo de
//                     errar aqui.
//   POSSE           → triagem aberta vale mais que gatilho que aparece no meio.
//   DEDUP           → tick sobreposto não pode responder duas vezes.

const atendidos: { phone: string; texto: string }[] = [];
let eventos: any[] = [];
let claims: string[] = [];
let donoRecepcao: string[] = [];
let leadsBia: string[] = [];
let alunosLimpapro: string[] = [];
let vendedoraDona: string[] = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q, gte: () => q, order: () => q, limit: () => q,
        then: (ok: any, no?: any) =>
          Promise.resolve({ data: eventos.map(payload => ({ payload })), error: null }).then(ok, no),
      };
      return q;
    },
  },
}));

vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));

vi.mock('../services/agents/sdr/sdrAgentService', () => ({
  tryClaimMessage: (id: string) => {
    if (claims.includes(id)) return Promise.resolve(false);
    claims.push(id);
    return Promise.resolve(true);
  },
}));

vi.mock('../services/agents/whatsapp/biaInboundService', () => ({
  ehLeadRecuperacao: (p: string) => Promise.resolve(leadsBia.includes(p)),
}));
vi.mock('../services/agents/whatsapp/limpaproAtendimentoService', () => ({
  ehAlunoLimpapro: (p: string) => Promise.resolve(alunosLimpapro.includes(p)),
}));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  ehGatilhoSolarDoc: (t: string) => /solardoc/i.test(t),
  vendedoraJaAtende: (p: string) => Promise.resolve(vendedoraDona.includes(p)),
}));
vi.mock('../services/io/recepcaoIo', () => ({
  handleRecepcaoIo: (phone: string, texto: string) => {
    atendidos.push({ phone, texto });
    return Promise.resolve();
  },
  recepcaoJaAtende: (p: string) => Promise.resolve(donoRecepcao.includes(p)),
}));

const INSTANCIA = '3F26F6ECE67D72BB7FCA6244BF24326C';
const LEAD = '5534987654321';

function evento(over: Record<string, any> = {}) {
  return {
    type: 'ReceivedCallback',
    instanceId: INSTANCIA,
    phone: LEAD,
    isGroup: false,
    fromMe: false,
    messageId: `M-${Math.random().toString(36).slice(2)}`,
    text: { message: 'Bom dia' },
    ...over,
  };
}

beforeEach(() => {
  atendidos.length = 0;
  eventos = [];
  claims = [];
  donoRecepcao = [];
  leadsBia = [];
  alunosLimpapro = [];
  vendedoraDona = [];
});

describe('poll da recepção', () => {
  it('atende quem escreveu e não é de mais ninguém', async () => {
    const { pollRecepcaoIo } = await import('../services/io/recepcaoIoPoll');
    eventos = [evento()];

    const r = await pollRecepcaoIo();

    expect(r.atendidos).toBe(1);
    expect(atendidos[0]).toEqual({ phone: LEAD, texto: 'Bom dia' });
  });

  it('ignora o que não é mensagem recebida da linha IO', async () => {
    const { pollRecepcaoIo } = await import('../services/io/recepcaoIoPoll');
    eventos = [
      evento({ type: 'MessageStatusCallback' }),     // confirmação de entrega
      evento({ instanceId: 'OUTRA-INSTANCIA' }),     // outra linha
      evento({ isGroup: true }),                     // grupo
      evento({ fromMe: true }),                      // nós mesmos
      evento({ text: { message: '   ' } }),          // sem texto
    ];

    const r = await pollRecepcaoIo();

    expect(r.atendidos).toBe(0);
    expect(atendidos).toHaveLength(0);
  });

  it('não rouba conversa das outras trilhas', async () => {
    const { pollRecepcaoIo } = await import('../services/io/recepcaoIoPoll');
    leadsBia = ['5534900000001'];
    alunosLimpapro = ['5534900000002'];
    vendedoraDona = ['5534900000003'];
    eventos = [
      evento({ phone: '5534900000001' }),                                  // Bia
      evento({ phone: '5534900000002' }),                                  // LimpaPro
      evento({ phone: '5534900000003' }),                                  // vendedora
      evento({ phone: '5534900000004', text: { message: 'quero o SolarDoc' } }), // gatilho
      evento({ phone: '5534900000005' }),                                  // sobrou: é da recepção
    ];

    const r = await pollRecepcaoIo();

    expect(r.atendidos).toBe(1);
    expect(atendidos[0].phone).toBe('5534900000005');
  });

  it('triagem aberta vence o gatilho que aparece no meio dela', async () => {
    const { pollRecepcaoIo } = await import('../services/io/recepcaoIoPoll');
    donoRecepcao = [LEAD];
    eventos = [evento({ text: { message: 'é sobre o SolarDoc mesmo' } })];

    const r = await pollRecepcaoIo();

    expect(r.atendidos).toBe(1);   // sem a posse, o gatilho levaria a conversa
  });

  it('tick sobreposto não responde duas vezes a mesma mensagem', async () => {
    const { pollRecepcaoIo } = await import('../services/io/recepcaoIoPoll');
    const ev = evento();
    eventos = [ev];

    await pollRecepcaoIo();
    const r2 = await pollRecepcaoIo();   // a janela de 6 min ainda devolve o mesmo evento

    expect(r2.atendidos).toBe(0);
    expect(atendidos).toHaveLength(1);
  });

  it('uma mensagem que explode não leva as outras junto', async () => {
    vi.resetModules();
    const mod = await import('../services/io/recepcaoIo');
    let n = 0;
    (mod as any).handleRecepcaoIo = (phone: string, texto: string) => {
      n++;
      if (n === 1) return Promise.reject(new Error('Z-API fora do ar'));
      atendidos.push({ phone, texto });
      return Promise.resolve();
    };
    const { pollRecepcaoIo } = await import('../services/io/recepcaoIoPoll');
    eventos = [evento({ phone: '5534900000007' }), evento({ phone: '5534900000008' })];

    const r = await pollRecepcaoIo();

    expect(r.erros).toBe(1);
    expect(r.atendidos).toBe(1);
    expect(atendidos[0].phone).toBe('5534900000008');
  });
});
