import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromTemplate } from '../services/templateService';
import {
  FIN_BOTOES, camposFinanciamentoEnvio, carenciaDias, limitarPrimeiraParcela, parcelaAutomaticaFin, parcelaFinanciamento,
  pmtPriceCarenciaDias, prazoLivre, prazosFinanciamento, primeiraParcelaFin, textoCarenciaFin,
  baseFinanciamento, normalizarFinanciamento, validadeDiasFin,
} from '../services/propostaFinanciamento';
import { valorParcelaFin, prazosFin, carenciaTextoFin } from '../services/propostaSolarCalculos';
import { empresaOffGrid, clienteOffGrid, dadosOffGrid } from './fixtures/offgridDados';

// Financiamento da proposta solar e da off-grid: carência em dias, 1ª parcela, prazo livre e parcela digitada.
// O texto de proposta salva antes (sem `fin_carencia_dias`) tem que continuar como foi enviado.

const BASE = '2026-10-15'; // o dia de emissão dos documentos de teste, em Brasília
const company: any = {
  nome: 'Empresa Exemplo Solar LTDA', nome_fantasia: 'Empresa Exemplo Solar', cnpj: '12345678000190',
  endereco: 'Rua A, 10, Centro', socio_adm: 'Maria Souza', whatsapp: '17996243536', email: 'contato@exemplo.com',
  cor_marca: '#1E3A8A', cor_secundaria: '#F7B500',
};
const client: any = { nome: 'Cliente Exemplo', cidade: 'Sao Jose do Rio Preto', uf: 'SP' };
const campos: Record<string, unknown> = {
  emitido_em: '2026-10-15T12:00:00.000Z', cidade: 'Sao Jose do Rio Preto', uf: 'SP', consumo_kwh: '650',
  qtd_modulos: '12', potencia_modulo: '550', marca_modulo: 'Canadian', marca_inversor: 'Growatt',
  potencia_inversor: '5', investimento: '28.900,00', codigo: '20260012',
};
const renderSolar = (f: Record<string, unknown>, modelo: 1 | 2 | 3 | 4 = 4) => {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaSolar', company, client, { ...campos, ...f }, modelo, out);
  return { html, resumo: out.resumo ?? '' };
};
const renderOffGrid = (f: Record<string, unknown>, modelo: 1 | 2 = 2) => {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaOffGrid', empresaOffGrid, clienteOffGrid,
    { ...dadosOffGrid, emitido_em: '2026-10-15T12:00:00.000Z', codigo: '20260031', ...f }, modelo, out);
  return { html, resumo: out.resumo ?? '' };
};
const texto = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const novo = { fin_carencia_dias: 90 };
const INV = 28900;

describe('conta: carência em dias', () => {
  const i = 0.022;
  it('a parcela cresce o saldo por (1+i)^(dias/30) e depois é Price', () => {
    for (const dias of [0, 30, 45, 90, 120]) {
      const esperado = Math.ceil(INV * Math.pow(1 + i, dias / 30) * i / (1 - Math.pow(1 + i, -60)));
      expect(parcelaAutomaticaFin({ ...novo, fin_carencia_dias: dias }, INV, 60)).toBe(esperado);
    }
  });

  it('120 dias dá o mesmo número do documento antigo (4 meses de carência)', () => {
    for (const n of [12, 36, 60, 84, 120]) {
      const antigo = Math.ceil(INV * Math.pow(1 + i, 4) * i / (1 - Math.pow(1 + i, -n)));
      expect(parcelaAutomaticaFin({ fin_carencia_dias: 120 }, INV, n)).toBe(antigo);
    }
  });

  it('documento antigo, sem os campos novos, vale 120 dias e os prazos 36 a 84', () => {
    const f = { pag_fin_36: true, pag_fin_60: true, pag_fin_12: true };
    expect(carenciaDias(f)).toBe(120);
    expect(prazosFinanciamento(f)).toEqual([36, 60]); // o 12 não existia: não entra
    expect(valorParcelaFin(f, INV, 60)).toBe(Math.ceil(INV * Math.pow(1 + i, 4) * i / (1 - Math.pow(1 + i, -60))));
    expect(textoCarenciaFin(f, BASE)).toBe('120 dias de carência');
  });

  it('carência fora de 0 a 120 é limitada e ilegível vira 90', () => {
    expect(carenciaDias({ fin_carencia_dias: 500 })).toBe(120);
    expect(carenciaDias({ fin_carencia_dias: -5 })).toBe(0);
    expect(carenciaDias({ fin_carencia_dias: 'abc' })).toBe(90);
    expect(carenciaDias({ fin_carencia_dias: '45' })).toBe(45);
  });

  it('taxa 0 vale 0 só no modo novo; vazio é 2,2; documento antigo não muda', () => {
    expect(parcelaAutomaticaFin({ ...novo, taxa_fin_60: '0' }, 60000, 60)).toBe(1000);
    expect(parcelaAutomaticaFin({ ...novo, taxa_fin_60: 0 }, 60000, 60)).toBe(1000);
    expect(parcelaAutomaticaFin({ ...novo, taxa_fin_60: '0,00' }, 60000, 60)).toBe(1000);
    expect(parcelaAutomaticaFin({ ...novo, taxa_fin_60: '' }, INV, 60)).toBe(parcelaAutomaticaFin(novo, INV, 60));
    expect(parcelaAutomaticaFin({ ...novo, taxa_fin_60: 'abc' }, INV, 60)).toBe(parcelaAutomaticaFin(novo, INV, 60));
    expect(valorParcelaFin({ pag_fin_60: true, taxa_fin_60: '0' }, INV, 60)).toBe(valorParcelaFin({ pag_fin_60: true }, INV, 60));
  });

  it('a taxa digitada muda a parcela e o prazo livre usa taxa_fin_livre', () => {
    const base = { ...novo, fin_prazo_livre: 100 };
    expect(parcelaAutomaticaFin({ ...base, taxa_fin_livre: '1,5' }, INV, 100)).toBeLessThan(parcelaAutomaticaFin(base, INV, 100));
    expect(parcelaAutomaticaFin({ ...base, taxa_fin_100: '1,5' }, INV, 100)).toBe(parcelaAutomaticaFin(base, INV, 100));
    expect(pmtPriceCarenciaDias(0, i, 60, 90)).toBe(0);
  });
});

describe('prazos: botões de 12 a 96 e "Outro prazo" até 120', () => {
  it('os botões marcados saem em ordem; o livre entra no lugar certo e sem repetir', () => {
    const f = { ...novo, pag_fin_96: true, pag_fin_12: true, pag_fin_60: true, fin_prazo_livre: 72 };
    expect(prazosFinanciamento(f)).toEqual([12, 60, 72, 96]);
    expect(prazosFinanciamento({ ...f, fin_prazo_livre: 60 })).toEqual([12, 60, 96]);
  });

  it('prazo livre vai de 1 a 120; fora disso, vazio ou texto, não entra', () => {
    expect(prazoLivre({ ...novo, fin_prazo_livre: '120' })).toBe(120);
    expect(prazoLivre({ ...novo, fin_prazo_livre: 1 })).toBe(1);
    expect(prazoLivre({ ...novo, fin_prazo_livre: 121 })).toBeNull();
    expect(prazoLivre({ ...novo, fin_prazo_livre: 0 })).toBeNull();
    expect(prazoLivre({ ...novo, fin_prazo_livre: '' })).toBeNull();
    expect(prazoLivre({ ...novo, fin_prazo_livre: 'x' })).toBeNull();
    expect(prazoLivre({ fin_prazo_livre: 90 })).toBeNull(); // sem `fin_carencia_dias` é documento antigo
  });

  it('os 8 botões existem', () => {
    expect([...FIN_BOTOES]).toEqual([12, 24, 36, 48, 60, 72, 84, 96]);
  });
});

describe('parcela digitada vence a automática', () => {
  it('vale a digitada, por prazo, e vazia volta a automática', () => {
    const f = { ...novo, pag_fin_60: true, pag_fin_36: true, fin_parcela_manual_60: '1.234,56' };
    expect(parcelaFinanciamento(f, INV, 60)).toBe(1234.56);
    expect(parcelaFinanciamento(f, INV, 36)).toBe(parcelaAutomaticaFin(f, INV, 36));
    expect(parcelaFinanciamento({ ...f, fin_parcela_manual_60: '' }, INV, 60)).toBe(parcelaAutomaticaFin(f, INV, 60));
    expect(valorParcelaFin({ ...f, fin_parcela_manual_60: 999 }, INV, 60)).toBe(999);
  });

  it('digitada só vale se for maior que 0 e não passar do valor financiado; fora disso vale a automática', () => {
    const auto = parcelaAutomaticaFin(novo, INV, 60);
    expect(parcelaFinanciamento({ ...novo, fin_parcela_manual_60: 0 }, INV, 60)).toBe(auto);
    expect(parcelaFinanciamento({ ...novo, fin_parcela_manual_60: '-5' }, INV, 60)).toBe(auto);
    expect(parcelaFinanciamento({ ...novo, fin_parcela_manual_60: INV + 1 }, INV, 60)).toBe(auto);
    expect(parcelaFinanciamento({ ...novo, fin_parcela_manual_60: INV }, INV, 60)).toBe(INV);
    expect(valorParcelaFin({ ...novo, fin_parcela_manual_60: 999999999 }, INV, 60)).toBe(auto);
  });

  it('documento antigo ignora parcela digitada solta', () => {
    expect(parcelaFinanciamento({ pag_fin_60: true, fin_parcela_manual_60: 1 }, INV, 60)).toBe(parcelaAutomaticaFin({}, INV, 60));
  });
});

describe('data da 1ª parcela', () => {
  it('automática = base + carência', () => {
    expect(primeiraParcelaFin({ ...novo }, BASE)).toEqual({ dias: 90, iso: '2027-01-13' });
    expect(primeiraParcelaFin({ fin_carencia_dias: 0 }, BASE).iso).toBe(BASE);
  });

  it('digitada vale quando está entre a base e a base + 120 dias', () => {
    expect(primeiraParcelaFin({ ...novo, fin_primeira_parcela: '2026-12-01' }, BASE).iso).toBe('2026-12-01');
  });

  it('data fora do limite não vale: o limite existe no cálculo, não só no campo', () => {
    expect(limitarPrimeiraParcela('2026-10-01', BASE)).toBe(BASE);
    expect(limitarPrimeiraParcela('2027-06-01', BASE)).toBe('2027-02-12');
    expect(limitarPrimeiraParcela('2026-11-20', BASE)).toBe('2026-11-20');
    expect(primeiraParcelaFin({ ...novo, fin_primeira_parcela: '2030-01-01' }, BASE).iso).toBe('2027-01-13');
    expect(primeiraParcelaFin({ ...novo, fin_primeira_parcela: 'lixo' }, BASE).iso).toBe('2027-01-13');
  });

  it('o envio do formulário limita a data e acerta os dias; só leva parcela digitada de prazo que está na proposta', () => {
    const e = camposFinanciamentoEnvio({
      fin_carencia_dias: '90', fin_primeira_parcela: '2030-01-01', pag_fin_60: true, fin_prazo_livre: '100',
      fin_parcela_manual_60: '1.000,00', fin_parcela_manual_36: '900,00', fin_parcela_manual_100: '800,50',
    }, BASE);
    // data fora da faixa é descartada e a carência (90) calcula a data
    expect(e.fin_primeira_parcela).toBe('2027-01-13');
    expect(e.fin_carencia_dias).toBe(90);
    expect(e.fin_prazo_livre).toBe(100);
    expect(e.fin_parcela_manual_60).toBe(1000);
    expect(e.fin_parcela_manual_100).toBe(800.5);
    expect('fin_parcela_manual_36' in e).toBe(false);
    const sem = camposFinanciamentoEnvio({ fin_carencia_dias: '45', fin_primeira_parcela: '' }, BASE);
    expect(sem).toEqual({ fin_carencia_dias: 45, fin_primeira_parcela: '2026-11-29' });
  });

  it('data válida dentro da faixa manda: carência = data - base, mesmo com carência diferente gravada', () => {
    const f = { ...novo, fin_primeira_parcela: '2026-12-01' };
    expect(primeiraParcelaFin(f, BASE)).toEqual({ dias: 47, iso: '2026-12-01' });
    const n = normalizarFinanciamento(f, BASE);
    expect(n.fin_carencia_dias).toBe(47);
    expect(parcelaAutomaticaFin(n, INV, 60)).toBe(parcelaAutomaticaFin({ fin_carencia_dias: 47 }, INV, 60));
    expect(textoCarenciaFin(n, BASE)).toBe('Carência de 47 dias · 1ª parcela em 01/12/2026');
    // fora da faixa ou ilegível: descarta a data e usa a carência
    expect(normalizarFinanciamento({ ...novo, fin_carencia_dias: 500, fin_primeira_parcela: '2026-10-01' }, BASE))
      .toMatchObject({ fin_carencia_dias: 120, fin_primeira_parcela: '2027-02-12' });
    expect(normalizarFinanciamento({ ...novo, fin_primeira_parcela: 'x' }, BASE)).toMatchObject({ fin_carencia_dias: 90, fin_primeira_parcela: '2027-01-13' });
    // idempotente, e documento antigo volta como veio
    expect(normalizarFinanciamento(n, BASE)).toEqual(n);
    const antigo = { pag_fin_60: true };
    expect(normalizarFinanciamento(antigo, BASE)).toBe(antigo);
  });

  it('o PDF sai com carência = data - base mesmo que o documento chegue com os dois desencontrados', () => {
    const { html } = renderSolar({ pag_cartao: false, pag_fin: true, pag_fin_60: true, fin_carencia_dias: 90, fin_primeira_parcela: '2026-12-01' }, 4);
    expect(texto(html)).toContain('Carência de 47 dias · 1ª parcela em 01/12/2026');
    const esperado = parcelaAutomaticaFin({ fin_carencia_dias: 47 }, INV, 60);
    expect(html).toContain(`R$ ${esperado.toLocaleString('pt-BR')}`);
  });

  it('data base: nova = hoje; reedição = dia da criação dentro da validade, hoje se venceu', () => {
    const agora = new Date('2026-11-05T15:00:00.000Z');
    expect(baseFinanciamento(null, 7, agora)).toBe('2026-11-05');
    expect(baseFinanciamento('', 7, agora)).toBe('2026-11-05');
    expect(baseFinanciamento('lixo', 7, agora)).toBe('2026-11-05');
    expect(baseFinanciamento('2026-11-02T12:00:00.000Z', 7, agora)).toBe('2026-11-02');
    expect(baseFinanciamento('2026-10-20T12:00:00.000Z', 7, agora)).toBe('2026-11-05');
    expect(baseFinanciamento('2026-11-06T02:00:00.000Z', 7, new Date('2026-11-06T10:00:00.000Z'))).toBe('2026-11-05'); // Brasília: ainda dia 5
    expect(validadeDiasFin({})).toBe(7);
    expect(validadeDiasFin({ validade_dias: '15' })).toBe(15);
  });

  it('o texto: "Carência de N dias · 1ª parcela em dd/mm/aaaa", sem travessão', () => {
    expect(textoCarenciaFin({ ...novo }, BASE)).toBe('Carência de 90 dias · 1ª parcela em 13/01/2027');
    expect(textoCarenciaFin({ fin_carencia_dias: 1 }, BASE)).toBe('Carência de 1 dia · 1ª parcela em 16/10/2026');
    expect(textoCarenciaFin({ fin_carencia_dias: 0 }, BASE)).toBe('Sem carência · 1ª parcela em 15/10/2026');
    expect(textoCarenciaFin({ ...novo }, BASE)).not.toMatch(/—|–/);
  });
});

describe('mesmo número no app e na api', () => {
  const api = path.resolve(__dirname, '../services/propostaFinanciamento.ts');
  const app = path.resolve(__dirname, '../../../dashboard/src/lib/propostaFinanciamento.ts');

  it('o arquivo do app é o mesmo da api, byte a byte', () => {
    expect(fs.readFileSync(app, 'utf8')).toBe(fs.readFileSync(api, 'utf8'));
  });

  it('as mesmas contas dão o mesmo número nas duas pontas, e a conta do PDF é a mesma', async () => {
    const lib = await import(/* @vite-ignore */ app) as typeof import('../services/propostaFinanciamento');
    const casos: Record<string, unknown>[] = [
      {}, { fin_carencia_dias: 90 }, { fin_carencia_dias: 0, taxa_fin_60: '1,8' }, { fin_carencia_dias: 45, fin_parcela_manual_60: '1.500,10' },
      { fin_carencia_dias: 120, fin_prazo_livre: 100, taxa_fin_livre: '2,5' }, { fin_carencia_dias: 70, taxa_fin_12: '3' },
    ];
    for (const f of casos) {
      for (const inv of [1000, 28900, 78900.5]) {
        for (const n of [1, 12, 36, 60, 96, 100, 120]) {
          expect(lib.parcelaFinanciamento(f, inv, n)).toBe(parcelaFinanciamento(f, inv, n));
          expect(valorParcelaFin(f, inv, n)).toBe(lib.parcelaFinanciamento(f, inv, n));
        }
      }
      expect(lib.textoCarenciaFin(f, BASE)).toBe(textoCarenciaFin(f, BASE));
      expect(lib.prazosFinanciamento(f)).toEqual(prazosFinanciamento(f));
      expect(lib.normalizarFinanciamento(f, BASE)).toEqual(normalizarFinanciamento(f, BASE));
    }
  });

  it('a conta da tela off-grid sai igual à do PDF (mesma parcela, mesmo texto)', async () => {
    const off = await import(/* @vite-ignore */ path.resolve(__dirname, '../../../dashboard/src/lib/offgrid/pagamento.ts')) as any;
    const est = {
      ...off.pagamentoInicial(),
      fin: { 12: false, 24: false, 36: true, 48: false, 60: true, 72: false, 84: false, 96: true },
      finLivre: '100', finCarencia: '60', finManual: { '60': '1.111,11' }, juros: '1,9',
    };
    const preco = 78900;
    const campos = off.camposPagamento(est, preco, BASE);
    const m = off.modeloPagamento(est, preco, BASE);
    const { html } = renderOffGrid({ ...campos, investimento: preco });
    for (const n of [36, 60, 96, 100]) {
      const v = valorParcelaFin(campos, preco, n);
      expect(m.fin[n]).toBe(v);
      expect(html).toContain(`<span class="n">${n}× de</span>`);
    }
    expect(m.fin[60]).toBe(1111.11);
    expect(html).toContain('R$ 1.111,11');
    expect(texto(html)).toContain('Carência de 60 dias · 1ª parcela em 14/12/2026');
    expect(m.linhas.join(' ')).toContain('Carência de 60 dias · 1ª parcela em 14/12/2026');
  });
});

describe('PDF e link: proposta solar', () => {
  const finNovo = { pag_cartao: false, pag_fin: true, pag_fin_36: false, pag_fin_60: true, pag_fin_96: true, fin_carencia_dias: 90, fin_prazo_livre: 100 };

  it('Completa + Banco (4), Completa (1) e Moderno (2 e 3): carência em dias, data e todas as parcelas', () => {
    for (const modelo of [4, 2, 3] as const) {
      const { html } = renderSolar(finNovo, modelo);
      const t = texto(html);
      expect(t, `modelo ${modelo}`).toContain('Carência de 90 dias · 1ª parcela em 13/01/2027');
      expect(t, `modelo ${modelo}`).not.toContain('120 dias de carência');
      for (const n of [60, 96, 100]) {
        const v = valorParcelaFin(finNovo, INV, n);
        expect(html, `modelo ${modelo} ${n}x`).toContain(String(v).length > 3 ? v.toLocaleString('pt-BR') : String(v));
      }
    }
  });

  it('a parcela digitada sai no PDF no lugar da automática, e o resumo do WhatsApp usa o mesmo valor', () => {
    const f = { ...finNovo, fin_parcela_manual_60: '1.234,56' };
    const { html, resumo } = renderSolar(f, 4);
    expect(html).toContain('1.234,56');
    expect(html).not.toContain(`R$ ${parcelaAutomaticaFin(finNovo, INV, 60).toLocaleString('pt-BR')}<`);
    expect(resumo).toContain('Em 60x de R$ 1.234,56');
    expect(resumo).toContain('Carência de 90 dias · 1ª parcela em 13/01/2027');
    const m2 = renderSolar(f, 2).html;
    expect(m2).toContain('1.234,56');
  });

  it('data da 1ª parcela digitada aparece no lugar da automática', () => {
    const { html } = renderSolar({ ...finNovo, fin_carencia_dias: 47, fin_primeira_parcela: '2026-12-01' }, 4);
    expect(texto(html)).toContain('Carência de 47 dias · 1ª parcela em 01/12/2026');
  });

  it('documento antigo, sem os campos novos, sai como sempre: 120 dias de carência e os prazos de antes', () => {
    const antigo = { pag_cartao: false, pag_fin: true, pag_fin_36: true, pag_fin_60: true };
    for (const modelo of [4, 2, 3] as const) {
      const { html, resumo } = renderSolar(antigo, modelo);
      expect(html, `modelo ${modelo}`).toContain('120 dias de carência');
      expect(texto(html)).not.toContain('1ª parcela em');
      if (modelo === 4) expect(resumo).toContain('🏦 Financiamento (120 dias de carência):');
    }
    const { resumo } = renderSolar(antigo, 4);
    expect(resumo).toMatch(/\* 36x: R\$ [\d.,]+\/mês/);
    expect(resumo).not.toContain('Em 36x');
    // a parcela do antigo é a conta de sempre, de 4 meses
    expect(valorParcelaFin(antigo, INV, 60)).toBe(Math.ceil(INV * Math.pow(1.022, 4) * 0.022 / (1 - Math.pow(1.022, -60))));
  });

  it('modelo 1 (uma página): a parcela de destaque acompanha o prazo e a carência novos', () => {
    const { html } = renderSolar({ pag_cartao: false, pag_fin: true, pag_fin_36: false, pag_fin_96: true, fin_carencia_dias: 30 }, 1);
    const v = parcelaAutomaticaFin({ fin_carencia_dias: 30 }, INV, 96);
    expect(html).toContain(`ou 96× de R$ ${v.toLocaleString('pt-BR')},00`);
  });
});

describe('PDF e link: off-grid', () => {
  const pagOff = { investimento: 78900, pag_cartao: false, pag_fin: true, pag_fin_60: true };

  it('documento antigo: "120 dias de carência", como foi enviado', () => {
    const { html } = renderOffGrid(pagOff, 2);
    expect(html).toContain('120 dias de carência, sujeito à aprovação do banco');
  });

  it('documento novo: carência em dias com a data e o resumo com "Em Nx de R$ X"', () => {
    const f = { ...pagOff, fin_carencia_dias: 90, pag_fin_96: true, fin_prazo_livre: 15, fin_parcela_manual_15: '5.000,00' };
    const { html, resumo } = renderOffGrid(f, 2);
    expect(texto(html)).toContain('Carência de 90 dias · 1ª parcela em 13/01/2027, sujeito à aprovação do banco');
    expect(html).toContain('<span class="n">15× de</span>');
    expect(html).toContain('R$ 5.000');
    expect(resumo).toContain('Em 15x de R$ 5.000');
    expect(resumo).toContain('Financiamento (Carência de 90 dias · 1ª parcela em 13/01/2027):');
    expect(carenciaTextoFin({ ...f, emitido_em: '2026-10-15T12:00:00.000Z' })).toBe('Carência de 90 dias · 1ª parcela em 13/01/2027');
    expect(prazosFin(f)).toEqual([15, 60, 96]);
  });
});
