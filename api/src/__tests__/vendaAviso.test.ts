import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// O aviso de venda é a única peça do webhook que fala com uma PESSOA. Dois
// jeitos de ele apodrecer em silêncio, os dois cobertos aqui:
//   1) a Stripe reentrega o mesmo checkout.session.completed por até 3 dias —
//      avisar duas vezes ensina o dono a ignorar o aviso;
//   2) a linha do WhatsApp cai (aconteceu 3x entre 04 e 06/08) — sem o e-mail
//      de fallback a venda passa e ninguém fica sabendo, que é exatamente o
//      problema que motivou a feature.

type Row = Record<string, any>;
const sales: Row[] = [];

// Fake do Supabase com estado: precisa respeitar o `.is('aviso_dono_em', null)`,
// senão a trava "passa" no teste e falha em produção.
vi.mock('../utils/supabase', () => {
  function query() {
    const filtros: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const alvos = () => sales.filter((r) => filtros.every((f) => f(r)));
    const q: any = {
      update: (p: Row) => { patch = p; return q; },
      eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
      is: (col: string, val: any) => { filtros.push((r) => (r[col] ?? null) === val); return q; },
      select: () => q,
      maybeSingle: async () => {
        const linhas = alvos();
        if (!linhas.length) return { data: null, error: null };
        linhas.forEach((r) => Object.assign(r, patch));
        return { data: { id: linhas[0].id }, error: null };
      },
    };
    return q;
  }
  return { supabase: { from: () => query() } };
});

const enviados: Array<{ phone: string; texto: string; linha: string }> = [];
let falharWhats = false;
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => {
    if (falharWhats) throw new Error('[zapi:solardoc] em cooldown (instância indisponível)');
    enviados.push({ phone, texto, linha });
  }),
}));

const emails: Array<{ assunto: string; corpo: string }> = [];
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: vi.fn(async (assunto: string, corpo: string) => { emails.push({ assunto, corpo }); }),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { avisarVendaAoDono, textoAvisoVenda } from '../services/vendaAviso';

const venda = (over: Partial<Parameters<typeof textoAvisoVenda>[0]> = {}) => ({
  produto: 'VIP', valor: 67, cobrouAgora: true,
  email: 'novo@integrador.com', nome: 'Luiz', phone: '5534991360223',
  utmSource: 'ig', utmCampaign: 'camp-1', utmContent: 'criativo-3',
  ...over,
});

beforeEach(() => {
  sales.length = 0; enviados.length = 0; emails.length = 0;
  falharWhats = false;
  sales.push({ id: 'venda-1', aviso_dono_em: null });
});

describe('aviso de venda no WhatsApp do dono', () => {
  it('manda a mensagem com plano, valor e se o dinheiro entrou', async () => {
    const r = await avisarVendaAoDono('venda-1', venda());
    expect(r).toBe('enviado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].linha).toBe('solardoc'); // nunca a IO, que é a que cai
    expect(enviados[0].texto).toContain('R$ 67,00/mês');
    expect(enviados[0].texto).toContain('entrou agora');
    expect(enviados[0].texto).toContain('wa.me/5534991360223');
    expect(enviados[0].texto).toContain('ig · camp-1 · criativo-3');
  });

  it('venda em trial NÃO diz que o dinheiro entrou', () => {
    const t = textoAvisoVenda(venda({ cobrouAgora: false, produto: 'VIP PROMO', valor: 49 }));
    expect(t).toContain('ainda NÃO entrou');
    expect(t).toContain('R$ 49,00/mês');
  });

  it('sem UTM não finge origem', () => {
    const t = textoAvisoVenda(venda({ utmSource: null, utmCampaign: null, utmContent: null }));
    expect(t).toContain('sem UTM');
  });

  it('reentrega da Stripe não avisa duas vezes', async () => {
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('enviado');
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('duplicado');
    expect(enviados).toHaveLength(1);
    expect(sales[0].aviso_dono_em).toBeTruthy();
  });

  it('linha caída cai pro e-mail — a venda não passa em silêncio', async () => {
    falharWhats = true;
    const r = await avisarVendaAoDono('venda-1', venda());
    expect(r).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0].assunto).toContain('R$ 67,00');
    expect(emails[0].corpo).toContain('novo@integrador.com');
  });

  it('venda que não entrou no ledger avisa mesmo assim (sem trava pra perder)', async () => {
    const r = await avisarVendaAoDono(null, venda());
    expect(r).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });
});
