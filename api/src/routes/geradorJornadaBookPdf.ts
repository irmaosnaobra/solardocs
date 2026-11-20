import { abrirNavegador } from '../controllers/pdfController';
import { TETO_BOOK_BYTES, bookHtml, type EntradaBook } from '../services/gerador/bookObra';

// ─────────────────────────────────────────────────────────────────────────────
// O PDF DO BOOK, no navegador do servidor (por ação de gente, nunca no cron). Vive à parte de `geradorJornadaObra.ts` (que não pode crescer).
// Tenta a foto em 31% da largura e, se o PDF passa do teto, em 15%. Sempre fecha o navegador. Falha do navegador LANÇA (a rota responde 503).
// ─────────────────────────────────────────────────────────────────────────────
export async function renderizarBookPdf(d: Omit<EntradaBook, 'fotos' | 'larguraFoto' | 'testes'> & { testes: unknown }, fotos: readonly string[]): Promise<Buffer | null> {
  const browser = await abrirNavegador();
  let pdf: Buffer | null = null;
  try {
    for (const larguraFoto of ['31%', '15%'] as const) {
      const page = await browser.newPage();
      try {
        await page.setJavaScriptEnabled(false);
        await page.setContent(bookHtml({
          titulo: d.titulo, cliente: d.cliente, cidade: d.cidade, fotos, testes: d.testes as Record<string, unknown>,
          monitoramento: d.monitoramento, contatos: d.contatos, termo_html: d.termo_html, aviso_garantias: d.aviso_garantias, larguraFoto,
        }), { waitUntil: 'networkidle0', timeout: 45_000 });
        pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
      } finally { await page.close().catch(() => {}); }
      if (pdf.length <= TETO_BOOK_BYTES) break;
    }
  } finally { await browser.close().catch(() => {}); }
  return pdf;
}
