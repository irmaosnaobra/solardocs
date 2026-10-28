import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { abrirNavegador } from '../controllers/pdfController';
import { codigoLegivel } from '../services/manutencao/relatorio';
import {
  BUCKET, UUID_RE, LinhaManutencao, assinaturasDe, assinarCaminho, tabelaAusente, urlsAssinadas,
} from '../services/manutencao/armazenamento';
import {
  htmlRelatorio, opcoesPdf, paginaIndisponivel, paginaNaoConcluido, paginaNaoEncontrado,
} from '../services/manutencao/htmlRelatorio';

// ─────────────────────────────────────────────────────────────────────────────
// GET /m/:id      relatório público de manutenção (sem login), só pelo UUID.
// GET /m/:id/pdf  o mesmo HTML em PDF A4, guardado no bucket por versão.
//
// Signed URL de 1 h gerada a cada abertura (nunca salva). O relatório não mostra
// telefone, CPF nem e-mail do cliente: o HTML só recebe nome do cliente e o que o
// técnico digitou em `dados`. O PDF vai para o bucket e a resposta é um 302 para
// signed URL de 10 min, porque resposta de função na Vercel passa de 4,5 MB com fotos.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

const COLS = 'id, user_id, codigo, cliente_nome, status, data_inspecao, proxima_visita, dados, fotos, assinaturas, updated_at';

type Carga =
  | { ok: true; l: LinhaManutencao }
  | { ok: false };

/** Acha o relatório pelo UUID; já responde 404/503/500 quando não dá. */
async function carregar(req: Request, res: Response): Promise<Carga> {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) { res.status(404).type('text/html').send(paginaNaoEncontrado()); return { ok: false }; }
  const { data, error } = await supabase.from('manutencoes').select(COLS).eq('id', id).maybeSingle();
  if (error) {
    if (tabelaAusente(error)) { res.status(503).type('text/html').send(paginaIndisponivel()); return { ok: false }; }
    console.error('[public-manutencao] erro lendo relatório:', error);
    res.status(500).type('text/plain').send('Erro ao carregar o relatório.');
    return { ok: false };
  }
  if (!data) { res.status(404).type('text/html').send(paginaNaoEncontrado()); return { ok: false }; }
  return { ok: true, l: data as LinhaManutencao };
}

async function entrada(l: LinhaManutencao) {
  const { data: emp } = await supabase
    .from('company').select('nome, nome_fantasia, cnpj, logo_base64, cor_marca').eq('user_id', l.user_id).limit(1).maybeSingle();
  const urls = await urlsAssinadas(l);
  const ass = assinaturasDe(l);
  return {
    linha: { id: l.id, codigo: l.codigo, cliente_nome: l.cliente_nome, data_inspecao: l.data_inspecao, proxima_visita: l.proxima_visita, dados: l.dados },
    empresa: (emp ?? {}) as Record<string, string | null>,
    fotos: urls.fotos_url,
    assinaturas: {
      ...(ass.tecnico ? { tecnico: { url: urls.assinaturas_url.tecnico ?? null, nome: ass.tecnico.nome, registro: ass.tecnico.registro } } : {}),
      ...(ass.cliente ? { cliente: { url: urls.assinaturas_url.cliente ?? null, nome: ass.cliente.nome } } : {}),
    },
  };
}

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = await carregar(req, res);
    if (!c.ok) return;
    if (c.l.status !== 'concluida') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).type('text/html').send(paginaNaoConcluido());
      return;
    }
    const html = htmlRelatorio(await entrada(c.l));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(html);
  } catch (err) {
    console.error('[public-manutencao] erro:', err);
    res.status(500).type('text/plain').send('Erro ao carregar o relatório.');
  }
});

router.get('/:id/pdf', async (req: Request, res: Response): Promise<void> => {
  let browser: Awaited<ReturnType<typeof abrirNavegador>> | undefined;
  try {
    const c = await carregar(req, res);
    if (!c.ok) return;
    const l = c.l;
    if (l.status !== 'concluida') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(409).type('text/html').send(paginaNaoConcluido());
      return;
    }

    const prefixo = `manutencoes/${l.user_id}/${l.id}`;
    const nome = `relatorio-${new Date(l.updated_at).getTime()}.pdf`;
    const caminho = `${prefixo}/${nome}`;

    // Já existe o PDF desta versão? Então só redireciona.
    const { data: achados } = await supabase.storage.from(BUCKET).list(prefixo, { limit: 1000, search: 'relatorio-' });
    const existe = (achados ?? []).some((a: { name?: string }) => a?.name === nome);

    if (!existe) {
      const html = htmlRelatorio(await entrada(l));
      browser = await abrirNavegador();
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
      const pdf = await page.pdf(opcoesPdf(l.codigo));
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(caminho, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error('upload do PDF falhou: ' + upErr.message);

      // Versões antigas do PDF saem do bucket (best-effort).
      const velhos = (achados ?? [])
        .filter((a: { name?: string }) => a?.name && a.name.startsWith('relatorio-') && a.name !== nome)
        .map((a: { name: string }) => `${prefixo}/${a.name}`);
      if (velhos.length) supabase.storage.from(BUCKET).remove(velhos).catch(() => {});
    }

    const { data: signed } = await supabase.storage.from(BUCKET)
      .createSignedUrl(caminho, 600, { download: `manutencao-${codigoLegivel(l.codigo) || l.id}.pdf` });
    const url = signed?.signedUrl ?? (await assinarCaminho(caminho, 600));
    if (!url) throw new Error('não consegui assinar o PDF');
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url);
  } catch (err) {
    console.error('[public-manutencao-pdf] erro:', err);
    if (!res.headersSent) res.status(500).type('text/plain').send('Erro ao gerar o PDF.');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

export default router;
