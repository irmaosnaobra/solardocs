// Opções do page.pdf() dos relatórios (vistoria e manutenção): A4 em pé, margem pelo @page e rodapé
// com empresa, código do documento, cliente e "Página X de Y". Módulo PURO: só importa `esc`.

import { esc } from './base';

/**
 * Margem do PDF em milímetros. O `@page` dos dois relatórios usa a MESMA margem:
 * `@page{size:A4;margin:14mm 16mm 18mm}`.
 */
export const MARGEM_PDF_MM = { topo: 14, lados: 16, base: 18 } as const;

/**
 * `esquerda` é o texto do canto esquerdo do rodapé (empresa, código e cliente já juntos pelo
 * chamador, que limita o tamanho de cada nome com cortarNaPalavra). O texto passa por esc() e, se não couber em
 * 84% da largura, quebra na linha de baixo em vez de ser cortado no meio da palavra. Com os limites dos
 * relatórios (48 letras da empresa e 64 do cliente) o texto cabe em duas linhas de 10,5 px dentro dos 18 mm
 * da margem de baixo.
 */
export function opcoesPdfComRodape({ esquerda }: { esquerda: string }) {
  return {
    format: 'A4' as const,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      `<div style="width:100%;padding:0 ${MARGEM_PDF_MM.lados}mm;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.3;color:#4A5568;display:flex;justify-content:space-between;align-items:flex-end;gap:12px;">` +
      `<span style="min-width:0;max-width:84%;overflow-wrap:anywhere;">${esc(esquerda)}</span>` +
      `<span style="white-space:nowrap;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
  };
}
