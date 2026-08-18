import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// PARA ONDE VAI QUEM SAI DO CHECKOUT DA STRIPE.
//
// Três regras que valem dinheiro, e por isso estão travadas aqui:
//
//   1. O ANUAL nunca cai no Pix. O trilho do Asaas só tem a mensalidade de
//      R$ 67 — mandar quem estava levando os 12 meses pra lá troca o produto
//      dele no meio da compra e ainda derruba o ticket.
//   2. Quem TEM conta e quem NÃO tem vão pra telas diferentes. A /pix-recorrente
//      exige login: mandar quem veio do anúncio pra lá é uma parede de senha no
//      exato momento em que a pessoa ainda estava pagando.
//   3. Sem PIX_PUBLICO_ATIVO, ninguém é mandado pra tela pública — senão a
//      Stripe empurra gente pra uma página cuja rota responde 503.
// ═══════════════════════════════════════════════════════════════════════════

const DASH = 'https://solardoc.app';

// asaasHabilitado() lê a chave do Asaas; o destino depende dela.
vi.mock('../services/asaas/asaasClient', () => ({
  asaasHabilitado: () => process.env.ASAAS_API_KEY === 'ligado',
  asaasFetch: vi.fn(),
  asaasApiKey: () => process.env.ASAAS_API_KEY,
  AsaasError: class extends Error {},
}));

// `await import` no TOPO nao compila no build da API (tsc com module=commonjs,
// TS1378) — e' o que derrubou o deploy cc27aae. Dentro de um beforeAll async
// nao e' top-level await, e o import segue tardio, que e' o que importa aqui:
// o modulo so' carrega depois do vi.mock do asaasClient.
type DestinoDeSaida = typeof import('../controllers/paymentsController')['destinoDeSaida'];
let destinoDeSaida: DestinoDeSaida;

beforeAll(async () => {
  ({ destinoDeSaida } = await import('../controllers/paymentsController'));
});

const ORIGINAL = { ...process.env };
beforeEach(() => {
  process.env.ASAAS_API_KEY = 'ligado';
  process.env.PIX_PUBLICO_ATIVO = 'true';
});
afterEach(() => { process.env = { ...ORIGINAL }; });

describe('destino de quem sai do checkout', () => {
  it('sem conta e com o Pix público ligado, vai direto pra tela de pagar', () => {
    const url = destinoDeSaida({ dashboardUrl: DASH, via: 'lp', ehAnual: false, plano: 'vip' });
    expect(url).toContain('/pix-automatico');
    expect(url).toContain('via=lp');
    expect(url).toContain('plano=vip');
  });

  it('com conta, vai pra tela logada — que já sabe o e-mail dele', () => {
    const url = destinoDeSaida({ dashboardUrl: DASH, via: 'conta', ehAnual: false, plano: 'vip' });
    expect(url).toContain('/pix-recorrente');
    expect(url).not.toContain('/pix-automatico');
  });

  // A regra mais cara do arquivo.
  it('ANUAL nunca vai pro Pix, nem logado nem deslogado', () => {
    for (const via of ['lp', 'conta'] as const) {
      const url = destinoDeSaida({ dashboardUrl: DASH, via, ehAnual: true, plano: 'anual' });
      expect(url).toContain('/quase-la');
      expect(url).not.toContain('/pix-');
    }
  });

  it('sem PIX_PUBLICO_ATIVO, quem não tem conta volta pra /quase-la', () => {
    process.env.PIX_PUBLICO_ATIVO = '';
    const url = destinoDeSaida({ dashboardUrl: DASH, via: 'lp', ehAnual: false, plano: 'vip' });
    expect(url).toContain('/quase-la');
  });

  it('Asaas desligado derruba os dois caminhos de Pix', () => {
    process.env.ASAAS_API_KEY = '';
    expect(destinoDeSaida({ dashboardUrl: DASH, via: 'lp', ehAnual: false, plano: 'vip' })).toContain('/quase-la');
    expect(destinoDeSaida({ dashboardUrl: DASH, via: 'conta', ehAnual: false, plano: 'vip' })).toContain('/quase-la');
  });

  it('leva o cupom junto — sem ele a tela mostra outro preço do que ele viu', () => {
    const url = destinoDeSaida({ dashboardUrl: DASH, via: 'lp', ehAnual: false, plano: 'vip', cupom: 'ACESSO19' });
    expect(url).toContain('cupom=ACESSO19');
  });

  it('escapa o que vai na query em vez de concatenar cru', () => {
    const url = destinoDeSaida({ dashboardUrl: DASH, via: 'lp', ehAnual: false, plano: 'vip', cupom: 'A B&C' });
    expect(url).toContain('cupom=A%20B%26C');
  });
});

describe('trava do caminho público', () => {
  it('só liga com a palavra exata "true"', async () => {
    const { pixPublicoAtivo } = await import('../utils/pixInfo');
    for (const v of ['true', 'TRUE', ' true ']) {
      process.env.PIX_PUBLICO_ATIVO = v;
      expect(pixPublicoAtivo()).toBe(true);
    }
    for (const v of ['', '1', 'sim', 'false', 'yes']) {
      process.env.PIX_PUBLICO_ATIVO = v;
      expect(pixPublicoAtivo()).toBe(false);
    }
    delete process.env.PIX_PUBLICO_ATIVO;
    expect(pixPublicoAtivo()).toBe(false);
  });
});
