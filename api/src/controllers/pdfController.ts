import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

// IMPORTANTE: a versão precisa BATER com @sparticuz/chromium-min do package.json.
// Mismatch causa TargetCloseError ao tentar ler o PDF do navegador.
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

export async function generatePdf(req: Request, res: Response): Promise<void> {
  let browser;
  let stage = 'init';
  try {
    const { id } = req.params;

    stage = 'fetch-doc';
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, arquivo_url, cliente_nome, tipo, content')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (docErr) { console.error('[pdf] supabase doc error:', docErr); }
    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }

    // Fluxo preferido: HTML do Storage (VIP/admin têm upload automático).
    // Fallback: usa o content da coluna (docs antigos sem arquivo_url).
    let htmlContent = '';
    if (doc.arquivo_url) {
      stage = 'sign-storage';
      const { data: signed, error: signErr } = await supabase.storage
        .from('documentos')
        .createSignedUrl(doc.arquivo_url, 60);
      if (signErr) console.error('[pdf] sign error:', signErr);
      if (signed?.signedUrl) {
        stage = 'fetch-html';
        const htmlRes = await fetch(signed.signedUrl);
        if (!htmlRes.ok) console.error('[pdf] html fetch status:', htmlRes.status);
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

    stage = 'chromium-resolve';
    const execPath = await chromium.executablePath(CHROMIUM_URL);

    stage = 'puppeteer-launch';
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: (chromium as any).defaultViewport,
      executablePath: execPath,
      headless: true,
    });

    stage = 'set-content';
    const page = await browser.newPage();
    // O HTML armazenado tem um <script> injetado que faz window.print() +
    // window.close() no onload (UX de impressão direta no browser). Sem
    // desabilitar JS, esse script fecha o tab antes do page.pdf() e gera
    // "Target closed". PDF não precisa de JS — todos os estilos são inline.
    await page.setJavaScriptEnabled(false);
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    stage = 'render-pdf';
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
    const e = err as Error;
    console.error(`[pdf] FAILED at stage="${stage}" — ${e?.name}: ${e?.message}\n${e?.stack}`);
    res.status(500).json({ error: 'Erro ao gerar PDF', stage, message: e?.message });
  } finally {
    if (browser) await browser.close();
  }
}
