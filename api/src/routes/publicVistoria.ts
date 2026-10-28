import { Router, Request, Response } from 'express';
import JSZip from 'jszip';
import { supabase } from '../utils/supabase';
import { abrirNavegador } from '../controllers/pdfController';
import { withSignedUrls } from './vistorias';
import { Extras, lerExtras, urlsDasAssinaturas } from '../services/vistoria/extras';
import { hashConteudoPdf, nomeDoPdf } from '../services/vistoria/cachePdf';
import {
  EntradaVistoria, htmlVistoria, opcoesPdf, paginaErroPdf, paginaNaoEncontrada,
} from '../services/vistoria/htmlRelatorio';

const BUCKET = 'documentos';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Nome de arquivo seguro: sem acento, minúsculo, só a-z0-9 e hífen.
function slugify(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v/:id — relatório PÚBLICO da vistoria solar (sem auth).
// :id é o UUID da vistoria (inadulterável, mandado por WhatsApp).
// Gera signed URL fresca de cada foto A CADA abertura — nunca guarda URL que
// expira. Mesmo padrão do /p/:id (proposta pública). Cada item pode ter várias
// fotos e arquivos (PDF).
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

function paginaErro(res: Response): void {
  res.status(404).type('text/html').send(paginaNaoEncontrada());
}

/** Monta a entrada do relatório (fotos assinadas, status e assinaturas) a partir da linha do banco. */
async function montarEntrada(
  v: { id: string; cliente_nome: string | null; status: string; itens: unknown; localizacao?: unknown; created_at: string },
  extras: Extras,
): Promise<EntradaVistoria> {
  const itens = await withSignedUrls(Array.isArray(v.itens) ? v.itens : []);
  const urls = await urlsDasAssinaturas(extras.assinaturas);
  const t = extras.assinaturas.tecnico;
  const c = extras.assinaturas.cliente;
  return {
    id: v.id,
    cliente_nome: v.cliente_nome,
    status: v.status,
    created_at: v.created_at,
    localizacao: (v.localizacao ?? null) as EntradaVistoria['localizacao'],
    itens,
    status_itens: extras.status_itens,
    assinaturas: {
      ...(t ? { tecnico: { url: urls.tecnico ?? null, nome: t.nome, registro: t.registro } } : {}),
      ...(c ? { cliente: { url: urls.cliente ?? null, nome: c.nome } } : {}),
    },
  };
}

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) {
      paginaErro(res);
      return;
    }

    const { data: v } = await supabase
      .from('vistorias')
      .select('id, cliente_nome, status, itens, localizacao, created_at')
      .eq('id', id)
      .maybeSingle();

    if (!v) {
      paginaErro(res);
      return;
    }

    // Colunas novas: sem a migration o relatório sai igual ao de antes (sem selo). Outro erro vira 500.
    const extras = await lerExtras(v.id);
    const html = htmlVistoria(await montarEntrada(v, extras), 'tela');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120');
    res.send(html);
  } catch (err) {
    console.error('[public-vistoria] erro:', err);
    res.status(500).type('text/plain').send('Erro ao carregar a vistoria.');
  }
});

// ── GET /v/:id/pdf — o mesmo relatório em PDF A4 ────────────────────────────────
// O PDF vai para o bucket (resposta de função na Vercel passa de 4,5 MB com fotos) e a resposta é um
// 302 para uma signed URL curta. O nome leva o hash do CONTEÚDO (fotos, observações, status, assinaturas,
// nome, situação e local): mesma vistoria, mesmo arquivo, o Chromium só roda quando algo mudou.
router.get('/:id/pdf', async (req: Request, res: Response): Promise<void> => {
  let browser: Awaited<ReturnType<typeof abrirNavegador>> | undefined;
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) {
      paginaErro(res);
      return;
    }
    const { data: v } = await supabase
      .from('vistorias')
      .select('id, user_id, cliente_nome, status, itens, localizacao, created_at')
      .eq('id', id)
      .maybeSingle();
    if (!v) {
      paginaErro(res);
      return;
    }

    const extras = await lerExtras(v.id);
    const nome = nomeDoPdf(hashConteudoPdf({
      itens: v.itens,
      status_itens: extras.status_itens,
      assinaturas: extras.assinaturas,
      cliente_nome: v.cliente_nome,
      status: v.status,
      localizacao: v.localizacao,
    }));
    const prefixo = `vistorias/${v.user_id}/${v.id}`;
    const caminho = `${prefixo}/${nome}`;

    const { data: achados } = await supabase.storage.from(BUCKET).list(prefixo, { limit: 1000, search: 'relatorio-' });
    const existe = (achados ?? []).some((a: { name?: string }) => a?.name === nome);

    if (!existe) {
      const html = htmlVistoria(await montarEntrada(v, extras), 'pdf');
      browser = await abrirNavegador();
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
      const pdf = await page.pdf(opcoesPdf());
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(caminho, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error('upload do PDF falhou: ' + upErr.message);

      // Versões antigas saem do bucket (best-effort). O arquivo atual nunca entra na lista.
      const velhos = (achados ?? [])
        .filter((a: { name?: string }) => a?.name && a.name.startsWith('relatorio-') && a.name.endsWith('.pdf') && a.name !== nome)
        .map((a: { name: string }) => `${prefixo}/${a.name}`);
      if (velhos.length) supabase.storage.from(BUCKET).remove(velhos).catch(() => {});
    }

    const { data: signed } = await supabase.storage.from(BUCKET)
      .createSignedUrl(caminho, 600, { download: `vistoria-${slugify(v.cliente_nome || 'solar')}.pdf` });
    if (!signed?.signedUrl) throw new Error('não consegui assinar o PDF');
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, signed.signedUrl);
  } catch (err) {
    console.error('[public-vistoria-pdf] erro:', err);
    if (!res.headersSent) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(500).type('text/html').send(paginaErroPdf());
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── GET /v/:id/fotos.zip — baixa TODAS as fotos/arquivos num ZIP organizado ─────
// Público (é o link que a engenharia recebe). Nomes prefixados pela ordem do item
// (01-conta-de-luz-1.jpg …) pra chegar organizado e ordenável na engenharia.
router.get('/:id/fotos.zip', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) {
      res.status(404).type('text/plain').send('Vistoria não encontrada.');
      return;
    }

    const { data: v } = await supabase
      .from('vistorias')
      .select('id, cliente_nome, itens')
      .eq('id', id)
      .maybeSingle();
    if (!v) {
      res.status(404).type('text/plain').send('Vistoria não encontrada.');
      return;
    }

    type Foto = { url: string; tipo: 'image' | 'file'; nome?: string };
    type Item = { label: string; fotos?: Foto[] };
    const itens = (Array.isArray(v.itens) ? v.itens : []) as Item[];

    // Baixa cada arquivo do Storage e adiciona ao zip com nome organizado.
    const zip = new JSZip();
    let adicionados = 0;
    await Promise.all(
      itens.flatMap((item, i) => {
        const fotos = Array.isArray(item.fotos) ? item.fotos : [];
        const ordem = String(i + 1).padStart(2, '0');
        const base = slugify(item.label);
        return fotos.map(async (f, j) => {
          const { data: blob, error } = await supabase.storage.from(BUCKET).download(f.url);
          if (error || !blob) return;
          const buf = Buffer.from(await blob.arrayBuffer());
          const ext = (f.url.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          zip.file(`${ordem}-${base}-${j + 1}.${ext}`, buf);
          adicionados++;
        });
      }),
    );

    if (adicionados === 0) {
      res.status(404).type('text/plain').send('Esta vistoria ainda não tem fotos.');
      return;
    }

    const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const fname = `vistoria-${slugify(v.cliente_nome || 'solar')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  } catch (err) {
    console.error('[public-vistoria-zip] erro:', err);
    res.status(500).type('text/plain').send('Erro ao gerar o ZIP.');
  }
});

export default router;
