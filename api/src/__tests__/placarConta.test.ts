import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A CONTA DO PLACAR — quem está esperando resposta.
//
// Este arquivo existe por um defeito que foi pro celular da Giovanna em
// 21/09/2026: os placares disseram 21 conversas onde havia ~107.
//
// A contagem anda de trás pra frente em cada conversa e para quando acha a
// nossa última resposta. O campo que marcava esse ponto se chamava `respondido`,
// e o filtro final leu o nome ao pé da letra: descartava toda conversa em que a
// gente já tinha respondido alguma vez — inclusive as que o cliente escreveu DE
// NOVO depois. Só sobrava quem nunca teve resposta nenhuma na semana.
//
// Nenhum teste pegou porque nenhum semeava mensagem NOSSA: com só mensagem do
// cliente, o campo nunca virava true. Aqui cada caso real da linha tem o seu.
// ─────────────────────────────────────────────────────────────────────────────

interface Msg { telefone: string; from_me: boolean; momment: string }
let conversa: Msg[] = [];
let sessoes: Array<{ phone: string; lead_data: Record<string, unknown> }> = [];

vi.mock('../utils/supabase', () => {
  const tabela = (nome: string) => {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      range: (de: number, ate: number) => Promise.resolve({
        data: nome === 'wa_mensagens'
          ? [...conversa].sort((a, b) => (a.momment < b.momment ? 1 : -1)).slice(de, ate + 1)
          : [],
        error: null,
      }),
      then: (ok: any, err: any) =>
        Promise.resolve({ data: nome === 'whatsapp_sessions' ? sessoes : [], error: null }).then(ok, err),
    };
    return q;
  };
  return { supabase: { from: (nome: string) => tabela(nome) } };
});

vi.mock('../services/agents/whatsapp/silenciar', () => ({
  chaveContato: (p: string) => {
    const d = String(p ?? '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return null;
    const s = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    return s.length < 10 ? null : s.slice(0, 2) + s.slice(-8);
  },
}));

import { medirPlacar } from '../services/io/placarGiovanna';

// Segunda, 21/09/2026, 15h em Brasília.
const AGORA = new Date('2026-09-21T15:00:00-03:00').getTime();
const ha = (horas: number): string => new Date(AGORA - horas * 3_600_000).toISOString();
const deles = (tel: string, horas: number): Msg => ({ telefone: tel, from_me: false, momment: ha(horas) });
const nossa = (tel: string, horas: number): Msg => ({ telefone: tel, from_me: true, momment: ha(horas) });

describe('placar do 5040 — quem está esperando', () => {
  beforeEach(() => {
    conversa = [];
    sessoes = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });
  afterEach(() => { vi.useRealTimers(); });

  // O caso que o defeito escondia, e o mais comum da linha: a conversa anda,
  // a gente responde, o cliente pergunta mais alguma coisa e fica no vácuo.
  it('respondemos e o cliente escreveu de novo: ESTÁ esperando', async () => {
    const tel = '5534911110001';
    conversa = [deles(tel, 5), nossa(tel, 4), deles(tel, 2), deles(tel, 1)];
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(1);
    expect(p!.mensagens).toBe(2);                     // só as duas depois da nossa
  });

  it('a gente falou por último: não está esperando', async () => {
    const tel = '5534911110002';
    conversa = [deles(tel, 3), nossa(tel, 2)];
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(0);
  });

  it('nunca respondemos: conta tudo que ele mandou', async () => {
    const tel = '5534911110003';
    conversa = [deles(tel, 30), deles(tel, 29), deles(tel, 28)];
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(1);
    expect(p!.mensagens).toBe(3);
    expect(p!.mais24h).toBe(1);
  });

  // A despedida da recepção ("Já já alguém responde!") não é gente chegando.
  it('a bolha de entrega da Duda não fecha a conversa', async () => {
    const tel = '5534911110004';
    const entregue = new Date(AGORA - 6 * 3_600_000 + 10_000).toISOString();
    sessoes = [{ phone: tel, lead_data: { estado: 'entregue', entregue_em: entregue } }];
    conversa = [deles(tel, 6), { telefone: tel, from_me: true, momment: new Date(AGORA - 6 * 3_600_000 + 30_000).toISOString() }];
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(1);
    expect(p!.mensagens).toBe(1);
  });

  it('bolha da Duda e depois um humano respondeu: não está esperando', async () => {
    const tel = '5534911110005';
    const entregue = new Date(AGORA - 6 * 3_600_000 + 10_000).toISOString();
    sessoes = [{ phone: tel, lead_data: { estado: 'entregue', entregue_em: entregue } }];
    conversa = [
      deles(tel, 6),
      { telefone: tel, from_me: true, momment: new Date(AGORA - 6 * 3_600_000 + 30_000).toISOString() },
      nossa(tel, 5),
    ];
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(0);
  });

  it('celular da casa escrevendo pra linha não é lead esperando', async () => {
    conversa = [deles('5534993396255', 1)];                    // a própria Giovanna
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(0);
  });

  // Os casos juntos, como a linha é de verdade: uma conta errada em um deles
  // muda o total, e é o total que vai pro celular dela.
  it('a linha inteira: soma certa de conversas, mensagens, hoje e +24h', async () => {
    const A = '5534911110001', B = '5534911110002', C = '5534911110003', D = '5534911110004';
    const entregueD = new Date(AGORA - 6 * 3_600_000 + 10_000).toISOString();
    sessoes = [{ phone: D, lead_data: { estado: 'entregue', entregue_em: entregueD } }];
    conversa = [
      deles(A, 5), nossa(A, 4), deles(A, 2), deles(A, 1),        // esperando, 2 msgs, hoje
      deles(B, 3), nossa(B, 2),                                  // atendido
      deles(C, 30), deles(C, 29), deles(C, 28),                  // esperando, 3 msgs, +24h
      deles(D, 6), { telefone: D, from_me: true, momment: new Date(AGORA - 6 * 3_600_000 + 30_000).toISOString() },
    ];
    const p = await medirPlacar(14);
    expect(p!.conversas).toBe(3);
    expect(p!.mensagens).toBe(6);
    expect(p!.hoje).toBe(2);                                     // A (14h) e D (9h)
    expect(p!.mais24h).toBe(1);                                  // C
    expect(p!.lidas).toBe(conversa.length);                      // leu a janela inteira
  });
});
