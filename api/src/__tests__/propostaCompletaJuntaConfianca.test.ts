import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateFromTemplate } from '../services/templateService';
import { CSS_COMPLETO } from '../services/templates/propostaSolarCompleta';
import { empresaCB, clienteCB } from './fixtures/propostaCompletaBancoDados';

// Completa + Banco (modelo 4): o investimento, os 12 bancos e as fotos das obras dividem a mesma folha quando
// cabem. Se não cabem, os bancos saem da folha do investimento e vão para a folha das obras, nunca separados delas.
const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u1/obra/1-abc123.jpg?token=xyz';
const obras = (n: number) => Array.from({ length: n }, (_, i) => ({ url: HTTPS, legenda: `Obra ${i + 1} em Araguari` }));
const TODOS_OS_BANCOS = ['sicredi', 'santander', 'bv', 'bb', 'caixa', 'sicoob', 'bradesco', 'itau', 'solfacil', 'solagora', '77sol', 'btg'];

const base: Record<string, unknown> = {
  emitido_em: '2026-11-05T15:00:00.000Z', cidade: 'Araguari', uf: 'MG', consumo_kwh: '650',
  qtd_modulos: '12', potencia_modulo: '550', marca_modulo: 'Canadian', marca_inversor: 'Growatt',
  potencia_inversor: '5', investimento: '28.900,00', codigo: '20261105',
};
// Enxuto, como o do Fabiano: só cartão e os bancos.
const enxuto = { ...base, pag_cartao_12: true, pag_cartao_18: true, bancos_logos: TODOS_OS_BANCOS };
// Cheio, como a SolarDoc com tudo ligado: à vista, entrada, cartão, financiamento, condição especial e dados bancários.
const cheio = {
  ...base, preco_avista: '27.000,00', pag_vista: true, pag_cartao_6: true, pag_cartao_12: true, pag_cartao_18: true, pag_cartao_21: true,
  pag_fin_36: true, pag_fin_48: true, pag_fin_60: true, pag_custom: 'Entrada de 30% e o restante em 10 vezes no boleto',
  bancos_logos: TODOS_OS_BANCOS, mostrar_dados_bancarios: true,
};

const gerar = (campos: Record<string, unknown>) => generateFromTemplate('propostaSolar', empresaCB, clienteCB, campos, 4);
// As folhas, na ordem: cada pedaço começa logo depois de `<div class="page`.
const folhas = (html: string) => html.split('<div class="page').slice(1);
const NOME_BANCOS = 'Bancos que financiam o seu sistema';
const comTexto = (fs: string[], t: string) => fs.filter((f) => f.includes(t));

describe('Completa + Banco: confiança junto do investimento', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  it('12 fotos e folha 3 enxuta: uma folha a menos e os bancos na mesma folha das obras', () => {
    const sem = folhas(gerar(enxuto));
    const com = folhas(gerar({ ...enxuto, fotos_obras: obras(12) }));
    // Sem as fotos a folha 3 já existe; com elas a quantidade de folhas NÃO muda (antes, sobrava a folha 4).
    expect(com.length).toBe(sem.length);
    const dasObras = comTexto(com, 'Obras realizadas');
    expect(dasObras).toHaveLength(1);
    expect(dasObras[0]).toContain(NOME_BANCOS);
    expect(dasObras[0]).toContain('Investimento e formas de pagamento');
    expect(dasObras[0]).toContain('Quem já confia na gente');
    // A ordem dentro da folha: investimento, bancos, faixa da confiança, obras.
    const f = dasObras[0];
    expect(f.indexOf('Investimento e formas de pagamento')).toBeLessThan(f.indexOf(NOME_BANCOS));
    expect(f.indexOf(NOME_BANCOS)).toBeLessThan(f.indexOf('Quem já confia na gente'));
    expect(f.indexOf('Quem já confia na gente')).toBeLessThan(f.indexOf('Obras realizadas'));
    // Os 12 bancos e as 12 fotos estão nela.
    expect(f.match(/<div class="bk fx">/g)).toHaveLength(12);
    expect(f.match(/<div class="ob">/g)).toHaveLength(12);
    // Os bancos aparecem uma vez só no documento.
    expect(comTexto(com, NOME_BANCOS)).toHaveLength(1);
  });

  it('12 fotos: escolhe 3 colunas com a foto mais alta que couber, ou 4 colunas quando dá mais área', () => {
    const f = comTexto(folhas(gerar({ ...enxuto, fotos_obras: obras(12) })), 'Obras realizadas')[0];
    const m = /class="ogrid" style="--oh:(\d+)px(?:;--oc:(\d+))?"/.exec(f);
    expect(m).not.toBeNull();
    const oh = Number(m![1]);
    const oc = Number(m![2] ?? 3);
    expect([3, 4]).toContain(oc);
    expect(oc === 3 ? [150, 122, 110, 96] : [146, 130, 120, 110, 100]).toContain(oh);
  });

  it.each([6, 9, 12])('%i fotos: tudo na mesma folha do investimento, sem folha extra', (n) => {
    const sem = folhas(gerar(enxuto));
    const com = folhas(gerar({ ...enxuto, fotos_obras: obras(n) }));
    expect(com.length).toBe(sem.length);
    const f = comTexto(com, 'Obras realizadas');
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('Investimento e formas de pagamento');
    expect(f[0]).toContain(NOME_BANCOS);
    expect(f[0].match(/<div class="ob">/g)).toHaveLength(n);
    // 4 colunas só existem com 12 fotos.
    if (n !== 12) expect(f[0]).not.toContain('--oc:4');
  });

  it('com 6 ou 9 fotos o número de fileiras fecha em colunas de 3 (nunca sobra foto sozinha)', () => {
    for (const n of [6, 9]) {
      const f = comTexto(folhas(gerar({ ...enxuto, fotos_obras: obras(n) })), 'Obras realizadas')[0];
      expect(f).toMatch(/class="ogrid" style="--oh:\d+px"/);
    }
  });

  it('empresas atendidas vão junto, logo depois das obras', () => {
    const campos = { ...enxuto, fotos_obras: obras(6), empresas_atendidas: [{ url: HTTPS, nome: 'Empresa X' }] };
    const com = folhas(gerar(campos));
    const f = comTexto(com, 'Empresas atendidas');
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('Obras realizadas');
    expect(f[0]).toContain('Investimento e formas de pagamento');
    expect(f[0].indexOf('Obras realizadas')).toBeLessThan(f[0].indexOf('Empresas atendidas'));
  });

  it('a foto do telhado continua na folha dela, depois do investimento', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const com = folhas(gerar({ ...enxuto, fotos_obras: obras(12), foto_telhado_b64: PNG }));
    const tel = comTexto(com, 'Local da instalação');
    expect(tel).toHaveLength(1);
    expect(tel[0]).not.toContain('Obras realizadas');
    expect(tel[0]).not.toContain('Investimento e formas de pagamento');
    const iInv = com.findIndex((x) => x.includes('Investimento e formas de pagamento'));
    expect(com.indexOf(tel[0])).toBeGreaterThan(iInv);
  });

  it('sem fotos (ou menos de 6) nada muda de lugar: os bancos ficam na folha do investimento', () => {
    for (const n of [0, 5]) {
      const com = folhas(gerar({ ...enxuto, fotos_obras: obras(n) }));
      expect(com.some((x) => x.includes('Obras realizadas'))).toBe(false);
      const b = comTexto(com, NOME_BANCOS);
      expect(b).toHaveLength(1);
      expect(b[0]).toContain('Investimento e formas de pagamento');
    }
  });
});

describe('Completa + Banco: folha 3 cheia (os bancos vão para a folha das obras)', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  it.each([6, 9, 12])('%i fotos: os bancos saem da folha 3 e ficam acima de "Obras realizadas", na mesma folha', (n) => {
    const html = gerar({ ...cheio, fotos_obras: obras(n) });
    const fs = folhas(html);
    const f3 = comTexto(fs, 'Investimento e formas de pagamento');
    expect(f3).toHaveLength(1);
    expect(f3[0]).not.toContain(NOME_BANCOS);
    expect(f3[0]).toContain('Condição especial');
    expect(f3[0]).toContain('Dados para pagamento');
    const dasObras = comTexto(fs, 'Obras realizadas');
    expect(dasObras).toHaveLength(1);
    expect(dasObras[0]).not.toBe(f3[0]);
    expect(dasObras[0]).toContain(NOME_BANCOS);
    expect(dasObras[0].match(/<div class="bk fx">/g)).toHaveLength(12);
    expect(dasObras[0].match(/<div class="ob">/g)).toHaveLength(n);
    const f = dasObras[0];
    expect(f.indexOf('Quem já confia na gente')).toBeLessThan(f.indexOf(NOME_BANCOS));
    expect(f.indexOf(NOME_BANCOS)).toBeLessThan(f.indexOf('Obras realizadas'));
    // Os bancos aparecem uma vez só no documento.
    expect(comTexto(fs, NOME_BANCOS)).toHaveLength(1);
  });

  it('sai a folha das obras (como antes), sem folha a mais por causa dos bancos', () => {
    const sem = folhas(gerar(cheio));
    const com = folhas(gerar({ ...cheio, fotos_obras: obras(12) }));
    expect(com.length).toBe(sem.length + 1);
  });

  it('sem fotos, os bancos seguem na folha 3 (nada para acompanhar)', () => {
    const fs = folhas(gerar(cheio));
    const b = comTexto(fs, NOME_BANCOS);
    expect(b).toHaveLength(1);
    expect(b[0]).toContain('Investimento e formas de pagamento');
  });

  it('o CSS: 6 bancos por fileira só com a classe nova; o CSS antigo (do Off-Grid) segue igual', () => {
    const html = gerar({ ...enxuto, fotos_obras: obras(12) });
    // A classe modificadora existe e é a usada nos bancos da Completa solar.
    expect(html).toContain('.bgrid.b6{ grid-template-columns:repeat(6,1fr); gap:6px; }');
    expect(html).toContain('.bgrid.b6 .bk.fx{ padding:8px 8px; min-height:58px; }');
    expect(html).toContain('.bgrid.b6 .bk.fx .lg{ height:34px;');
    expect(html).toContain('.ogrid{ grid-template-columns:repeat(var(--oc,3),1fr); }');
    expect(html).toContain('<div class="bgrid b6">');
    // As regras base ficam como eram.
    expect(html).toContain('.bgrid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }');
    expect(html).toContain('.bk.fx{ padding:14px 20px; min-height:78px; }');
    expect(html).toContain('.bk.fx .lg{ height:46px; width:100%; }');
    expect(CSS_COMPLETO).not.toContain('b6');
    expect(CSS_COMPLETO).not.toContain('--oc');
  });

  it('telhado + 12 obras + empresas com folha 3 cheia: o fallback não cria folha a mais', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const emp = [{ url: HTTPS, nome: 'Empresa X' }, { url: HTTPS, nome: 'Empresa Y' }];
    const campos = { ...cheio, foto_telhado_b64: PNG, empresas_atendidas: emp };
    // Referência: a mesma proposta sem obras (telhado e empresas dividem a folha 4, bancos na folha 3).
    const ref = folhas(gerar(campos));
    const com = folhas(gerar({ ...campos, fotos_obras: obras(12) }));
    expect(com.length).toBeLessThanOrEqual(ref.length);
    // Telhado, obras e empresas continuam juntos, numa folha só.
    const dasObras = comTexto(com, 'Obras realizadas');
    expect(dasObras).toHaveLength(1);
    expect(dasObras[0]).toContain('Local da instalação');
    expect(dasObras[0]).toContain('Empresas atendidas');
    // Nenhuma folha só com o telhado.
    expect(com.filter((x) => x.includes('Local da instalação') && !x.includes('Obras realizadas'))).toHaveLength(0);
    // Os bancos aparecem uma vez só, e na folha 3 (ficar com as fotos custaria uma folha).
    const b = comTexto(com, NOME_BANCOS);
    expect(b).toHaveLength(1);
    expect(b[0]).toContain('Investimento e formas de pagamento');
  });
});
