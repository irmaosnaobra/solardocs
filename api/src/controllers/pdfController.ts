import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

// IMPORTANTE: a versão precisa BATER com @sparticuz/chromium-min do package.json.
// Mismatch causa TargetCloseError ao tentar ler o PDF do navegador.
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Lança o Chromium com retry curto. O launch pode dar `spawn ETXTBSY` ("text
// file busy") quando DUAS invocações concorrentes no mesmo container Lambda
// tentam extrair/spawnar o binário em /tmp ao mesmo tempo — o binário ainda
// está sendo escrito por uma quando a outra tenta executar. É transitório:
// esperar alguns ms e tentar de novo resolve. Visto 2× em ~2 meses; sem o
// retry, cada uma dessas chega no cliente como "erro ao baixar". Só retenta
// erros transitórios de launch; erro real (ex: binário corrompido) estoura na
// última tentativa e cai no catch com o stage certo.
async function launchWithRetry(opts: Parameters<typeof puppeteer.launch>[0]) {
  const TRANSIENT = /ETXTBSY|Target closed|Failed to launch/i;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await puppeteer.launch(opts);
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message || '';
      if (!TRANSIENT.test(msg) || attempt === 3) throw err;
      console.warn(`[pdf] launch retry ${attempt}/2 após erro transitório: ${msg}`);
      await sleep(attempt * 300);
    }
  }
  throw lastErr;
}

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
    browser = await launchWithRetry({
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

    const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tipoSlug = stripDiacritics(doc.tipo ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Margem por tipo: a Proposta de Banco saía com margens grandes/assimétricas
    // (top 2 / bottom 2.5), deixando o conteúdo apertado e desbalanceado. Usa um
    // conjunto mais enxuto e simétrico (espelha o da proposta solar, equilibrada).
    // Demais documentos mantêm o padrão 2/2.5/2/2 que já estava bom.
    const margin = tipoSlug === 'propostabanco'
      ? { top: '1.5cm', bottom: '1.5cm', left: '1.5cm', right: '1.5cm' }
      : { top: '2cm', bottom: '2.5cm', left: '2cm', right: '2cm' };

    stage = 'render-pdf';
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin,
      preferCSSPageSize: false,
    });

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
