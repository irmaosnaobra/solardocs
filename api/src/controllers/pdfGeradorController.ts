import { Request, Response } from 'express';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import { supabaseGerador } from '../utils/supabaseGerador';

// Mesma versão usada em pdfController.ts (SolarDoc Pro) — chromium-min do package.json.
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

// URL base de onde o Puppeteer renderiza a proposta. Em produção aponta pro
// front-end do dashboard que serve /gerador/index.html.
const GERADOR_BASE_URL = process.env.GERADOR_BASE_URL || 'https://solardoc.app/gerador';

export async function generateGeradorPdf(req: Request, res: Response): Promise<void> {
  let browser;
  let stage = 'init';
  try {
    const codigo = String(req.params.codigo || '').trim();
    if (!/^\d{8,12}$/.test(codigo)) {
      res.status(400).json({ error: 'Código inválido' });
      return;
    }

    stage = 'fetch-proposta';
    const { data: prop } = await supabaseGerador
      .from('propostas')
      .select('codigo, cliente_nome, dados, created_at')
      .eq('codigo', codigo)
      .maybeSingle();
    if (!prop) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    stage = 'chromium-resolve';
    const execPath = await chromium.executablePath(CHROMIUM_URL);

    stage = 'puppeteer-launch';
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 900, height: 1200, deviceScaleFactor: 1 },
      executablePath: execPath,
      headless: true,
    });

    stage = 'goto';
    const page = await browser.newPage();

    // Injeta proposta no DOM ANTES do JS da página rodar. O JS do gerador detecta
    // window.__INJECTED_PROPOSAL e usa esses dados em vez de chamar a RPC
    // get_proposta_pub (que filtraria expiração). Token nunca vaza pro client porque
    // só existe em memória dentro do contexto do Puppeteer.
    const injected = {
      codigo: prop.codigo,
      dados: prop.dados,
      created_at: prop.created_at,
    };
    await page.evaluateOnNewDocument(`window.__INJECTED_PROPOSAL = ${JSON.stringify(injected)};`);

    // ?pdf=1 sinaliza pro JS: pula tracking, esconde controles, render como viewer.
    const url = `${GERADOR_BASE_URL}/?p=${encodeURIComponent(codigo)}&pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    stage = 'wait-render';
    // Função passada como string — executa no contexto do browser via Puppeteer,
    // evita TypeScript reclamando do `document` global.
    // Duas telas podem ser o alvo: a proposta longa do solar e o orçamento de 1
    // página (?v=orc, e sempre no eletroposto). Esperar só pela proposta faria o
    // orçamento estourar timeout — a tela dele nunca aparece.
    await page.waitForFunction(
      `(() => {
        const visivel = (id, min) => {
          const el = document.getElementById(id);
          return !!el && el.style.display !== 'none' && el.offsetHeight > min;
        };
        return visivel('propostaSection', 400) || visivel('orcViewSection', 200);
      })()`,
      { timeout: 20000 }
    );
    // Aguarda fontes/imagens base64 estabilizarem
    await new Promise((r) => setTimeout(r, 800));

    stage = 'emulate-media';
    // O CSS de impressão do gerador esconde TUDO por padrão e só libera o alvo
    // marcado no <body> — senão a tela e os documentos montados nos hosts de
    // print sairiam juntos. Sem esta classe o PDF vem em branco.
    // No orçamento de 1 página, o alvo é o host de documento: monta o mesmo HTML
    // que está na tela dentro dele e imprime por ali.
    await page.evaluate(`(() => {
      const orc = document.getElementById('orcViewSection');
      const folha = document.getElementById('orcview-folha');
      if (orc && orc.style.display !== 'none' && folha && folha.innerHTML) {
        const host = document.getElementById('doc-print');
        if (host) { host.innerHTML = folha.innerHTML; document.body.classList.add('print-doc'); return; }
      }
      document.body.classList.add('print-proposta');
    })()`);
    await page.emulateMediaType('print');

    stage = 'render-pdf';
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      preferCSSPageSize: false,
    });

    const slug = String(prop.cliente_nome || 'cliente')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const fileName = `proposta_${slug || 'cliente'}_${codigo}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdf));
  } catch (err) {
    const e = err as Error;
    console.error(`[pdf-gerador] FAILED at stage="${stage}" — ${e?.name}: ${e?.message}`);
    res.status(500).json({ error: 'Erro ao gerar PDF', stage, message: e?.message });
  } finally {
    if (browser) await browser.close();
  }
}
