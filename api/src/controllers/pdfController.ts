import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

// IMPORTANTE: a versão precisa BATER com @sparticuz/chromium-min do package.json.
// Mismatch causa TargetCloseError ao tentar ler o PDF do navegador.
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

export async function generatePdf(req: Request, res: Response): Promise<void> {
  let browser;
  try {
    const { id } = req.params;

    const { data: doc } = await supabase
      .from('documents')
      .select('id, arquivo_url, cliente_nome, tipo, content')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }

    // Fluxo preferido: HTML do Storage (VIP/admin têm upload automático).
    // Fallback: usa o content da coluna (docs antigos sem arquivo_url).
    let htmlContent = '';
    if (doc.arquivo_url) {
      const { data: signed } = await supabase.storage
        .from('documentos')
        .createSignedUrl(doc.arquivo_url, 60);
      if (signed?.signedUrl) {
        const htmlRes = await fetch(signed.signedUrl);
        htmlContent = await htmlRes.text();
      }
    }
    if (!htmlContent && doc.content) {
      htmlContent = String(doc.content);
    }
    if (!htmlContent) {
      res.status(400).json({ error: 'Arquivo não disponível — gere o documento novamente' });
      return;
    }

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: (chromium as any).defaultViewport,
      executablePath: await chromium.executablePath(CHROMIUM_URL),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '2cm', bottom: '2.5cm', left: '2cm', right: '2cm' },
      preferCSSPageSize: false,
    });

    const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tipoSlug = stripDiacritics(doc.tipo ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const clienteSlug = stripDiacritics(doc.cliente_nome ?? 'documento')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const fileName = `${tipoSlug}_${clienteSlug}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error('generatePdf error:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  } finally {
    if (browser) await browser.close();
  }
}
