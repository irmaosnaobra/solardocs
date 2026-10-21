import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ação "pagamento" do agente de contrato: o consultor escreve "Como o cliente vai pagar" e a IA só traduz em linhas. O
// servidor confere tudo (forma na lista, parcelas 1 a 24, números positivos, no máximo 6 linhas e uma "restante", e cada
// valor escrito no texto). A Anthropic é simulada; nenhuma chamada sai para a rede. Dados inventados.

const h = vi.hoisted(() => ({
  fila: [] as Array<{ erro?: unknown; saida?: unknown; parada?: string }>,
  chamadas: [] as Array<{ corpo: any }>,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      stream: (corpo: unknown) => {
        h.chamadas.push({ corpo });
        const e = h.fila.shift() ?? { erro: new Error('fila vazia') };
        return {
          finalMessage: async () => {
            if (e.erro) throw e.erro;
            return { stop_reason: e.parada ?? 'end_turn', parsed_output: e.saida, usage: { input_tokens: 10, output_tokens: 5 } };
          },
        };
      },
    },
  }),
}));
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { auth: { getUser: vi.fn() } } }));

import { PedidoAgente, pedirAgente, validarPagamento, numerosDoTexto, SISTEMA_PAGAMENTO, FORMAS_PAGAMENTO } from '../services/gerador/contratoAgente';

const linha = (extra: Record<string, unknown> = {}) => ({ forma: 'Pix', valor: 10000, parc: null, parcValor: null, quando: 'Na assinatura', obs: null, resto: false, ...extra });
const saida = (p: Record<string, unknown> = {}) => ({ resposta: 'Montei.', pergunta: null, linhas: [linha()], ...p });
const TEXTO = '10 mil de Pix na assinatura, 30 mil no cartão em 10x de R$ 3.330 e o restante na entrega da NF';
const pedido = (mensagem = TEXTO, extra: Record<string, unknown> = {}) => PedidoAgente.parse({
  modo: 'pagamento', tipo: 'completo', hibrido: null, clausulas: [], campos: [], mensagem,
  pagamento: { total: 100000, sinal: 0, saldo: 100000, taxas: [{ parcelas: 10, acrescimo: 11 }, { parcelas: 18, acrescimo: 31.832 }] },
  ...extra,
});
const fila = (s: unknown) => { h.fila.push({ saida: s }); };
async function montar(s: unknown, mensagem = TEXTO) {
  fila(s);
  const r = await pedirAgente(pedido(mensagem));
  if (!r.ok) throw new Error('esperava ok: ' + JSON.stringify(r));
  return r;
}

beforeEach(() => { h.fila.length = 0; h.chamadas.length = 0; });

describe('pagamento: linhas válidas', () => {
  it('devolve a ação com as linhas, e a linha restante sai com valor null', async () => {
    const r = await montar(saida({
      linhas: [
        linha(),
        linha({ forma: 'Cartão de crédito', valor: 30000, parc: 10, parcValor: 3330, quando: 'Na assinatura', obs: 'Visa' }),
        linha({ forma: 'Pix', valor: 60000, quando: 'Na entrega da NF', resto: true }),   // o valor da IA é descartado: o gerador recalcula
      ],
    }));
    expect(r.acoes).toHaveLength(1);
    const a: any = r.acoes[0];
    expect(a.tipo).toBe('pagamento');
    expect(a.pergunta).toBeNull();
    expect(a.linhas).toHaveLength(3);
    expect(a.linhas[0]).toEqual({ forma: 'Pix', valor: 10000, parc: null, parcValor: null, quando: 'Na assinatura', obs: null, resto: false });
    expect(a.linhas[1]).toMatchObject({ forma: 'Cartão de crédito', valor: 30000, parc: 10, parcValor: 3330, obs: 'Visa', resto: false });
    expect(a.linhas[2]).toMatchObject({ valor: null, resto: true });
    expect(r.avisos).toEqual([]);
  });
  it('manda o contexto (total, sinal, saldo, taxas) e o texto como dado; o prompt tem as regras e as 7 formas', async () => {
    await montar(saida());
    const c = h.chamadas[0].corpo;
    expect(typeof c.system).toBe('string');
    expect(c.system).toBe(SISTEMA_PAGAMENTO);
    for (const f of FORMAS_PAGAMENTO) expect(SISTEMA_PAGAMENTO).toContain(f);
    expect(SISTEMA_PAGAMENTO).toMatch(/NUNCA calcule/);
    expect(SISTEMA_PAGAMENTO).toMatch(/resto: true/);
    const u = c.messages[0].content as string;
    expect(u).toContain('"saldo_a_pagar":100000');
    expect(u).toContain('"sinal_ja_pago":0');
    expect(u).toContain('"acrescimo_total_percentual":31.832');
    expect(u).toContain(TEXTO);
  });
  it('"10x de R$ 6.549" e "R$ 6.549 em 10x" não se confundem: o servidor só confere que o número está no texto', () => {
    const v = validarPagamento(saida({ linhas: [linha({ forma: 'Cartão de crédito', valor: 6549, parc: 10 })] }), 'R$ 6.549 em 10x no cartão');
    expect(v.ok).toBe(true);
  });
});

describe('pagamento: o que o servidor recusa', () => {
  const recusa = async (s: unknown, motivo: RegExp, mensagem = TEXTO) => {
    const r = await montar(s, mensagem);
    expect(r.acoes).toEqual([]);
    expect(r.pergunta).toBeNull();
    expect(r.avisos.join(' ')).toMatch(motivo);
    return r;
  };
  it('forma fora da lista', async () => { await recusa(saida({ linhas: [linha({ forma: 'Permuta' })] }), /não está na lista/); });
  it('forma com caixa ou acento diferente também (a lista é fechada)', async () => { await recusa(saida({ linhas: [linha({ forma: 'pix' })] }), /não está na lista/); });
  it('duas linhas restante', async () => {
    await recusa(saida({ linhas: [linha({ resto: true, valor: null }), linha({ forma: 'Boleto', resto: true, valor: null })] }), /mais de uma forma como "o restante"/);
  });
  it('mais de 6 linhas', async () => { await recusa(saida({ linhas: Array.from({ length: 7 }, () => linha()) }), /mais de 6 formas/); });
  it('seis linhas passam', async () => {
    const r = await montar(saida({ linhas: Array.from({ length: 6 }, () => linha()) }));
    expect((r.acoes[0] as any).linhas).toHaveLength(6);
  });
  it('parcelas 0 e 25 (e fracionária)', async () => {
    await recusa(saida({ linhas: [linha({ forma: 'Boleto', parc: 0 })] }), /parcelas tem que ser inteiro, de 1 a 24/);
    await recusa(saida({ linhas: [linha({ forma: 'Boleto', parc: 25 })] }), /parcelas tem que ser inteiro, de 1 a 24/);
    await recusa(saida({ linhas: [linha({ forma: 'Boleto', parc: 2.5 })] }), /parcelas tem que ser inteiro, de 1 a 24/);
  });
  it('parcelas 1 e 24 passam', async () => {
    expect(validarPagamento(saida({ linhas: [linha({ parc: 1 })] }), TEXTO).ok).toBe(true);
    expect(validarPagamento(saida({ linhas: [linha({ parc: 24 })] }), '10 mil em 24x').ok).toBe(true);
  });
  it('parcela com valor da parcela mas sem quanto do preço a forma quita, fora do restante, a IA tem de perguntar', async () => {
    await recusa(saida({ linhas: [linha(), linha({ forma: 'Cartão de crédito', valor: null, parc: 10, parcValor: 6549 })] }),
      /falta quanto do preço esta forma quita/, '10 mil de Pix e 10x de R$ 6.549 no cartão');
    await recusa(saida({ linhas: [linha({ valor: null })] }), /falta quanto do preço esta forma quita/);
  });
  it('a mesma parcela como restante passa, e o valor dela é dispensado', async () => {
    const r = await montar(saida({ linhas: [linha({ forma: 'Cartão de crédito', valor: null, parc: 10, parcValor: 6549, resto: true })] }), '10x de R$ 6.549 no cartão, o restante');
    expect((r.acoes[0] as any).linhas[0]).toMatchObject({ valor: null, parc: 10, parcValor: 6549, resto: true });
  });
  it('número de parcelas inventado (fora do texto) cai', async () => {
    await recusa(saida({ linhas: [linha({ forma: 'Boleto', parc: 12 })] }), /número de parcelas não está escrito/, '10 mil de Pix e boleto parcelado');
  });
  it('número negativo ou zero, no valor e na parcela', async () => {
    await recusa(saida({ linhas: [linha({ valor: -10000 })] }), /valor tem que ser um número positivo/);
    await recusa(saida({ linhas: [linha({ valor: 0 })] }), /valor tem que ser um número positivo/);
    await recusa(saida({ linhas: [linha({ forma: 'Cartão de crédito', valor: null, parc: 10, parcValor: -6549 })] }), /parcela tem que ser um número positivo/);
  });
  it('valor de parcela sem número de parcelas', async () => {
    await recusa(saida({ linhas: [linha({ forma: 'Cartão de crédito', valor: null, parc: null, parcValor: 6549 })] }), /sem número de parcelas/);
  });
  it('vencimento acima de 80 caracteres e marcador interno', async () => {
    await recusa(saida({ linhas: [linha({ quando: 'x'.repeat(81) })] }), /passa de 80 caracteres/);
    await recusa(saida({ linhas: [linha({ obs: 'veja [travado: partes]' })] }), /marcador interno/);
  });
  it('lista vazia sem pergunta', async () => { await recusa(saida({ linhas: [] }), /nenhuma forma/); });
  it('UMA linha inválida derruba a ação inteira (não sai lista parcial)', async () => {
    await recusa(saida({ linhas: [linha(), linha({ forma: 'Cheque' })] }), /não está na lista/);
  });
  it('parcela inventada: "10x no cartão" não pode virar 10x de 6.250 sem estar no texto', async () => {
    await recusa(saida({ linhas: [linha({ forma: 'Cartão de crédito', valor: null, parc: 10, parcValor: 6250 })] }), /parcela não está escrito no seu texto/, '10x no cartão');
  });
  it('valor calculado (30% do saldo) também cai', async () => {
    await recusa(saida({ linhas: [linha({ valor: 30000 })] }), /valor não está escrito no seu texto/, '30% de entrada no Pix e o restante em boleto');
  });
  it('erro da API vira 502 e resposta cortada vira 502', async () => {
    h.fila.push({ erro: new Error('rede') });
    const a = await pedirAgente(pedido());
    expect(a).toMatchObject({ ok: false, status: 502 });
    h.fila.push({ saida: saida(), parada: 'max_tokens' });
    const b = await pedirAgente(pedido());
    expect(b).toMatchObject({ ok: false, status: 502 });
  });
  it('sem o contexto do pagamento é 400, e fora do formato é 502', async () => {
    const sem = PedidoAgente.parse({ modo: 'pagamento', tipo: 'completo', clausulas: [], mensagem: TEXTO });
    expect(await pedirAgente(sem)).toMatchObject({ ok: false, status: 400 });
    fila({ resposta: 'x' });
    expect(await pedirAgente(pedido())).toMatchObject({ ok: false, status: 502 });
  });
});

describe('pagamento: pergunta', () => {
  it('com pergunta não há linhas, mesmo que a IA as tenha mandado', async () => {
    const r = await montar(saida({ pergunta: 'Qual o valor do cartão em 10x?', linhas: [linha()] }), '10x no cartão e o restante em Pix');
    expect(r.acoes).toHaveLength(1);
    expect(r.acoes[0]).toEqual({ tipo: 'pagamento', linhas: [], pergunta: 'Qual o valor do cartão em 10x?' });
    expect(r.pergunta).toBe('Qual o valor do cartão em 10x?');
    expect(r.avisos).toEqual([]);
  });
  it('pergunta em branco não conta', () => {
    expect(validarPagamento(saida({ pergunta: '   ' }), TEXTO).ok).toBe(true);
  });
});

describe('numerosDoTexto', () => {
  it('lê as formas brasileiras', () => {
    const n = numerosDoTexto('10 mil de Pix, 10x de R$ 6.549,50, 62,5 mil e 1.234 e 2 milhões');
    for (const v of [10000, 10, 6549.5, 62500, 1234, 2_000_000]) expect(n.some(x => Math.abs(x - v) < 0.005), String(v)).toBe(true);
  });
});
