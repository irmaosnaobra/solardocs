import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar';

export async function generatePdf(req: Request, res: Response): Promise<void> {
  let browser;
  try {
    const { id } = req.params;

    const { data: doc } = await supabase
      .from('documents')
      .select('id, arquivo_url, cliente_nome, tipo')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
    if (!doc.arquivo_url) { res.status(400).json({ error: 'Arquivo não disponível ainda' }); return; }

    const { data: signed } = await supabase.storage
      .from('documentos')
      .createSignedUrl(doc.arquivo_url, 60);

    if (!signed?.signedUrl) { res.status(500).json({ error: 'Erro ao obter URL do arquivo' }); return; }

    // Baixa o HTML do Storage e injeta direto no Puppeteer
    const htmlRes = await fetch(signed.signedUrl);
    const htmlContent = await htmlRes.text();

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
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    const fileName = `${doc.tipo}-${(doc.cliente_nome ?? 'documento').replace(/\s+/g, '-').toLowerCase()}.pdf`;
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
