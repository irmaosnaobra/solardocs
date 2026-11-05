import { describe, it, expect, vi, beforeEach } from 'vitest';

// D/E: a Giovanna (recuperação, resposta na conversa) troca o Pix manual/link pelo Pix AUTOMÁTICO em código (05/11/2026). Só na RESPOSTA: o toque frio
// (enviarToqueFrio) e os openers seguem com o link. Tudo simulado: nada toca banco, IA, Z-API nem relógio.

const h = vi.hoisted(() => ({
  sessao: null as null | { messages: Array<{ role: string; content: string }>; nome: string | null },
  respostaIA: '[[ENVIAR_PIX]]',
  iaChamadas: 0,
  resolver: { tipo: 'link' } as any,
  pedidosResolver: [] as Array<Record<string, any>>,
  humanas: [] as Array<{ partes: string[]; opts: any }>,
  frias: [] as string[][],
  esperas: [] as number[],
  salvas: [] as Array<Array<{ role: string; content: string }>>,
  humanoFalha: false,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q, eq: () => q, filter: () => q, update: () => q,
        maybeSingle: async () => ({ data: tabela === 'whatsapp_sessions' && h.sessao ? { messages: h.sessao.messages, nome: h.sessao.nome } : null }),
        upsert: async (p: any) => { if (tabela === 'whatsapp_sessions') h.salvas.push(p.messages); return { error: null }; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({ messages: { create: async () => { h.iaChamadas++; return { content: [{ type: 'text', text: h.respostaIA }] }; } } }),
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: async (_t: string, partes: string[], _i: string, opts: any) => { if (h.humanoFalha && partes[0]!.startsWith('000201')) throw new Error('HTTP 500'); h.humanas.push({ partes, opts }); },
  sendFrio: async (_t: string, partes: string[]) => { h.frias.push(partes); return true; },
  sleep: async (ms: number) => { h.esperas.push(ms); },
}));
vi.mock('../utils/ofertaCupom', () => ({
  ofertaCupomAtiva: async () => null, bolhasOferta: () => ['OFERTA'], resumoOfertaParaPrompt: () => 'oferta', LINK_ASSINATURA: 'https://solardoc.app/assinar',
}));
vi.mock('../services/agents/whatsapp/pixSolicitado', () => ({ guardarEmailSePendente: async () => null }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ registrarMsgProativa: vi.fn() }));
vi.mock('../services/solardoc/pixAutoCodigo', async (orig) => {
  const real = await orig<typeof import('../services/solardoc/pixAutoCodigo')>();
  return { ...real, resolverPixConversa: async (p: Record<string, any>) => { h.pedidosResolver.push(p); return h.resolver; } };
});

import { handleRecoveryReply, enviarOpenerRecuperacao } from '../services/agents/whatsapp/pixRecoveryAgentService';

const TEL = '5534991230001';
const CODIGO = '00020126580014BR.GOV.BCB.PIX0136abc5204000053039865913AIOROS GROUP6009UBERLANDIA6304A1B2';
const CPF = '52998224725';

beforeEach(() => {
  h.sessao = { messages: [{ role: 'assistant', content: 'Oi! Aqui é a Giovanna.' }], nome: 'Ana Souza' };
  h.respostaIA = 'Claro, já te mando! [[ENVIAR_PIX]]';
  h.iaChamadas = 0; h.resolver = { tipo: 'link' }; h.pedidosResolver = []; h.humanas = []; h.frias = []; h.esperas = []; h.salvas = []; h.humanoFalha = false;
});

describe('resposta na conversa: [[ENVIAR_PIX]] = Pix automático em código', () => {
  it('código: texto em 1 bolha (maxBolhas 1) e o código numa chamada própria 2 a 5 s depois, total 2; o texto do modelo não sai', async () => {
    h.resolver = { tipo: 'codigo', codigo: CODIGO, validadeMs: Date.now() + 20 * 3_600_000, novo: true };
    const atendeu = await handleRecoveryReply(TEL, 'quero pagar no pix', null);
    expect(atendeu).toBe(true);
    expect(h.humanas).toHaveLength(2);
    expect(h.humanas[0]!.partes).toEqual(['Fechado, Ana. É o Pix automático de R$ 67 por mês, e você cancela quando quiser pelo app do banco. O código vai aqui embaixo.']);
    expect(h.humanas[0]!.opts).toEqual({ maxBolhas: 1 });
    expect(h.humanas[1]!.partes).toEqual([CODIGO]);
    expect(h.humanas[1]!.opts).toMatchObject({ maxBolhas: 1 });
    expect(h.esperas).toHaveLength(1);
    expect(h.esperas[0]!).toBeGreaterThanOrEqual(2000);
    expect(h.esperas[0]!).toBeLessThanOrEqual(5000);
    expect(h.humanas.flatMap(x => x.partes).join(' ')).not.toMatch(/Claro, já te mando|solardoc\.app|[—–]/);
    expect(h.pedidosResolver[0]).toMatchObject({ tel: TEL, nome: 'Ana Souza', textoDoLead: 'quero pagar no pix' });
    expect(h.salvas[0]!.map(m => m.content)).toContain(CODIGO);   // o histórico guarda o que saiu
  });

  it('sem CPF: UMA bolha pedindo o CPF (resposta, nunca toque); o histórico guarda o pedido', async () => {
    h.resolver = { tipo: 'pedir_cpf' };
    await handleRecoveryReply(TEL, 'quero pix', null);
    expect(h.humanas).toHaveLength(1);
    expect(h.humanas[0]!.partes[0]).toBe('Ana, o Pix automático pede o CPF de quem paga, e eu ainda não tenho o seu. Me manda aqui, por favor? Assim eu gero o código.');
    expect(h.esperas).toHaveLength(0);
  });

  it('a pessoa manda o CPF logo depois do pedido: o servidor cria o código SEM chamar o modelo, e o CPF vai ao resolver', async () => {
    h.sessao = { messages: [{ role: 'assistant', content: 'Ana, o Pix automático pede o CPF de quem paga, e eu ainda não tenho o seu. Me manda aqui, por favor? Assim eu gero o código.' }], nome: 'Ana' };
    h.resolver = { tipo: 'codigo', codigo: CODIGO, validadeMs: Date.now() + 3_600_000 * 24, novo: true };
    await handleRecoveryReply(TEL, `meu cpf é ${CPF}`, null);
    expect(h.iaChamadas).toBe(0);
    expect(h.pedidosResolver[0]!.textoDoLead).toContain(CPF);
    expect(h.humanas.map(x => x.partes[0])).toEqual([expect.stringContaining('O código vai aqui embaixo.'), CODIGO]);
  });

  it('CPF no texto SEM o pedido anterior não dispara nada sozinho (só o pedido de Pix)', async () => {
    h.respostaIA = 'Beleza! [[ENVIAR_LINK]]';
    await handleRecoveryReply(TEL, `meu cpf é ${CPF}`, null);
    expect(h.iaChamadas).toBe(1);
    expect(h.pedidosResolver).toHaveLength(0);
  });

  it('já pagou: o texto do redator em 1 bolha; aguardar: a hora em que o código vale, sem código novo', async () => {
    h.resolver = { tipo: 'ja_pagou' };
    await handleRecoveryReply(TEL, 'pix', null);
    expect(h.humanas).toHaveLength(1);
    expect(h.humanas[0]!.partes[0]).toBe('Boa notícia, Ana: seu pagamento já entrou e a SolarDoc já está liberada na sua conta. É só entrar em https://solardoc.app com o seu e-mail.');
    h.humanas = []; h.resolver = { tipo: 'aguardar', ateMs: Date.parse('2026-11-05T00:00:00.000Z') };   // 21h em Brasília
    await handleRecoveryReply(TEL, 'pix', null);
    expect(h.humanas).toHaveLength(1);
    expect(h.humanas[0]!.partes[0]).toBe('Oi, Ana. Seu código ainda vale, mas só até 21h. Se não der tempo, me chama aqui depois desse horário que eu mando um novo.');
    for (const x of h.humanas) expect(x.partes[0]!.length).toBeLessThanOrEqual(160);
  });

  it('o resolver cai no link (Asaas fora, sem e-mail): o link do Pix automático de sempre, texto + link na mesma chamada, teto de 2 bolhas', async () => {
    h.resolver = { tipo: 'link' };
    await handleRecoveryReply(TEL, 'pode ser pix', null);
    expect(h.humanas).toHaveLength(1);
    expect(h.humanas[0]!.opts).toEqual({ maxBolhas: 2 });
    expect(h.humanas[0]!.partes.join(' ')).toContain('https://solardoc.app/?pagar=pix');
    expect(h.humanas[0]!.partes.join(' ')).not.toContain('000201');
  });

  it('se o código não sai (erro de envio): a 1ª bolha já foi, o histórico só guarda o que saiu, e não há laço', async () => {
    h.resolver = { tipo: 'codigo', codigo: CODIGO, validadeMs: Date.now() + 3_600_000 * 24, novo: false };
    h.humanoFalha = true;
    await handleRecoveryReply(TEL, 'pix', null);
    expect(h.humanas).toHaveLength(1);
    expect(h.salvas[0]!.map(m => m.content)).not.toContain(CODIGO);
  });
});

describe('o caminho frio NÃO muda', () => {
  it('opener frio com [[ENVIAR_PIX]]: 1 sendFrio com o link do Pix automático dentro da frase, nenhuma chamada ao resolver, nenhum código', async () => {
    h.respostaIA = 'Posso te mandar o Pix? [[ENVIAR_PIX]]';
    h.sessao = null;
    const ok = await enviarOpenerRecuperacao(TEL, 'Ana', 2, { frio: true });
    expect(ok).toBe(true);
    expect(h.frias).toHaveLength(1);
    expect(h.frias[0]).toHaveLength(1);
    expect(h.frias[0]![0]).toContain('https://solardoc.app/?pagar=pix');
    expect(h.frias[0]![0]).not.toContain('000201');
    expect(h.pedidosResolver).toHaveLength(0);
    expect(h.humanas).toHaveLength(0);
  });
});
