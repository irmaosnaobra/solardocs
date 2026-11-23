import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromTemplate } from '../services/templateService';
import { empresaOffGrid, clienteOffGrid, dadosOffGrid } from './fixtures/offgridDados';

// Financiamento, byte a byte: o modo novo (carência em dias, 1ª parcela, prazo livre, parcela digitada, taxa 0) e,
// ao lado de cada um, o documento ANTIGO (sem `fin_carencia_dias`), que tem que sair como sempre saiu.
// Relógio fixo em 05/11/2026 15:00 UTC (dia de emissão em Brasília: 05/11/2026). Para regravar: GERAR_GOLDEN=1.
const DIR = path.join(__dirname, 'fixtures');
const arq = (nome: string) => path.join(DIR, `propostaFinanciamento-${nome}.golden.html`);
// Um clone Windows com autocrlf regrava o golden com CRLF: o conteúdo é o mesmo, então compara com LF.
const lerGolden = (nome: string) => fs.readFileSync(arq(nome), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

const empresaSolar: any = {
  nome: 'Empresa Exemplo Solar LTDA', nome_fantasia: 'Empresa Exemplo Solar', cnpj: '12345678000190',
  endereco: 'Rua A, 10, Centro', socio_adm: 'Maria Souza', whatsapp: '17996243536', email: 'contato@exemplo.com',
  cor_marca: '#1E3A8A', cor_secundaria: '#F7B500',
};
const clienteSolar: any = { nome: 'Cliente Exemplo', cidade: 'Sao Jose do Rio Preto', uf: 'SP' };
const solarBase: Record<string, unknown> = {
  cidade: 'Sao Jose do Rio Preto', uf: 'SP', consumo_kwh: '650', qtd_modulos: '12', potencia_modulo: '550',
  marca_modulo: 'Canadian', marca_inversor: 'Growatt', potencia_inversor: '5', investimento: '28.900,00', codigo: '20260012',
  pag_vista: false, pag_cartao: false, pag_fin: true, pag_fin_36: true, pag_fin_60: true,
};
const solarNovo: Record<string, unknown> = {
  ...solarBase, fin_carencia_dias: 90, pag_fin_12: true, pag_fin_96: true, fin_prazo_livre: 100,
  taxa_fin_12: '0', fin_parcela_manual_60: '1.234,56', fin_parcela_manual_96: 999999,
};
const offBase: Record<string, unknown> = {
  ...dadosOffGrid, codigo: '20260031', investimento: 78900, pag_vista: false, pag_cartao: false, pag_fin: true, pag_fin_36: true, pag_fin_60: true,
};
const offNovo: Record<string, unknown> = {
  ...offBase, fin_carencia_dias: 45, pag_fin_96: true, fin_prazo_livre: 15, taxa_fin_36: '0', fin_parcela_manual_60: '2.100,50',
};

type Caso = { nome: string; tipo: 'propostaSolar' | 'propostaOffGrid'; modelo: 1 | 2; campos: Record<string, unknown> };
const casos: Caso[] = [
  { nome: 'solar-m1-novo', tipo: 'propostaSolar', modelo: 1, campos: solarNovo },
  { nome: 'solar-m1-antigo', tipo: 'propostaSolar', modelo: 1, campos: solarBase },
  { nome: 'solar-moderno-novo', tipo: 'propostaSolar', modelo: 2, campos: solarNovo },
  { nome: 'solar-moderno-antigo', tipo: 'propostaSolar', modelo: 2, campos: solarBase },
  { nome: 'offgrid-m1-novo', tipo: 'propostaOffGrid', modelo: 1, campos: offNovo },
  { nome: 'offgrid-m1-antigo', tipo: 'propostaOffGrid', modelo: 1, campos: offBase },
  { nome: 'offgrid-completa-novo', tipo: 'propostaOffGrid', modelo: 2, campos: offNovo },
  { nome: 'offgrid-completa-antigo', tipo: 'propostaOffGrid', modelo: 2, campos: offBase },
];

function conteudo(c: Caso): string {
  const out: { resumo?: string } = {};
  const solar = c.tipo === 'propostaSolar';
  const html = generateFromTemplate(c.tipo, solar ? empresaSolar : empresaOffGrid, solar ? clienteSolar : clienteOffGrid, { ...c.campos }, c.modelo, out);
  return `${html}\n<!--RESUMO-->\n${out.resumo ?? ''}`;
}

describe('financiamento: modo novo e documento antigo, byte a byte', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  if (process.env.GERAR_GOLDEN === '1') {
    it('grava as referências (só com GERAR_GOLDEN=1)', () => {
      for (const c of casos) fs.writeFileSync(arq(c.nome), conteudo(c));
    });
  }

  for (const c of casos) {
    it(`${c.nome} sai igual à referência`, () => {
      expect(conteudo(c) === lerGolden(c.nome)).toBe(true);
    });
  }

  it('o novo traz a carência em dias e a data; o antigo continua com "120 dias de carência"', () => {
    for (const c of casos) {
      const txt = lerGolden(c.nome).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      if (c.nome.endsWith('-antigo')) {
        expect(txt, c.nome).not.toContain('1ª parcela em');
        if (c.nome !== 'offgrid-m1-antigo') expect(txt, c.nome).toContain('120 dias de carência');
      } else {
        expect(txt, c.nome).toContain('1ª parcela em');
        expect(txt, c.nome).not.toContain('120 dias de carência');
      }
    }
  });
});
