import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromTemplate } from '../services/templateService';
import { empresaCB, clienteCB } from './fixtures/propostaCompletaBancoDados';

// Caso NOVO (os goldens e as variantes de propostaCompletaBancoGolden.test.ts ficam como estão): foto de obra SEM legenda.
// A galeria da empresa vem sem legenda; antes a folha desenhava uma caixa branca vazia embaixo de cada foto. Agora o bloco da
// legenda só existe quando há legenda (só espaço conta como vazia). A foto com legenda sai como sempre saiu.
// Para regravar de propósito: GERAR_GOLDEN=1.
const arq = path.join(__dirname, 'fixtures', 'propostaCompletaBanco-legenda-vazia.golden.html');
const lerGolden = (a: string) => fs.readFileSync(a, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u1/obra/1-abc123.jpg?token=xyz';
const legendas = ['', 'Obra concluída em Araguari', '   ', '', 'Obra 5 em Araguari', ''];
const campos: Record<string, unknown> = {
  emitido_em: '2026-11-05T15:00:00.000Z', cidade: 'Araguari', uf: 'MG', consumo_kwh: '650',
  qtd_modulos: '12', potencia_modulo: '550', marca_modulo: 'Canadian', marca_inversor: 'Growatt',
  potencia_inversor: '5', investimento: '28.900,00', codigo: '20261105', pag_cartao_12: true,
  fotos_obras: legendas.map((legenda) => ({ url: HTTPS, legenda })),
};

describe('Completa + Banco (modelo 4): foto de obra sem legenda', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  const html = () => generateFromTemplate('propostaSolar', empresaCB, clienteCB, campos, 4);

  if (process.env.GERAR_GOLDEN === '1') {
    it('grava a referência (só com GERAR_GOLDEN=1)', () => { fs.writeFileSync(arq, html()); });
  }

  it('byte a byte', () => {
    expect(html()).toBe(lerGolden(arq));
  });

  it('a foto sem legenda não tem caixa; a com legenda tem, como antes', () => {
    const h = html();
    expect(h.match(/<div class="ob">/g)!.length).toBe(6);
    // Só 2 legendas preenchidas: a vazia e a de só espaço não geram o bloco.
    expect(h.match(/<div class="cap">/g)!.length).toBe(2);
    expect(h).not.toContain('<div class="cap"></div>');
    expect(h).toContain('<div class="cap">Obra concluída em Araguari</div>');
    expect(h).toContain('<div class="cap">Obra 5 em Araguari</div>');
    // A foto sem legenda segue com o texto alternativo de sempre.
    expect(h).toContain('alt="Obra realizada"');
  });
});
