import { Router, Request, Response } from 'express';
import JSZip from 'jszip';
import { supabase } from '../utils/supabase';
import { withSignedUrls } from './vistorias';

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

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function paginaErro(res: Response): void {
  res.status(404).type('text/html').send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vistoria não encontrada</title>
<style>body{font-family:-apple-system,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;margin:0}h1{font-size:24px;margin:16px 0 8px}p{color:#94A3B8;font-size:14px;margin:0}.icon{font-size:48px}</style>
</head><body>
<div class="icon">🔍</div>
<h1>Vistoria não encontrada</h1>
<p>O link expirou ou foi removido. Peça pro técnico enviar novamente.</p>
</body></html>`);
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
      .select('id, cliente_nome, status, itens, created_at')
      .eq('id', id)
      .maybeSingle();

    if (!v) {
      paginaErro(res);
      return;
    }

    const itens = await withSignedUrls(Array.isArray(v.itens) ? v.itens : []);
    const comFoto = itens.filter((i) => i.fotos.length > 0);
    const faltando = itens.filter((i) => i.fotos.length === 0).map((i) => esc(i.label));
    const totalFotos = itens.reduce((n, i) => n + i.fotos.length, 0);

    const data = new Date(v.created_at).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    });

    // Um bloco por item, com todas as suas fotos/arquivos.
    const blocos = comFoto.map((i) => {
      const midias = i.fotos.map((f) => {
        if (!f.signed) return '';
        if (f.tipo === 'file') {
          return `<a class="file" href="${esc(f.signed)}" target="_blank" rel="noopener">📄 ${esc(f.nome || 'Arquivo')}</a>`;
        }
        return `<a class="ph" href="${esc(f.signed)}" target="_blank" rel="noopener"><img src="${esc(f.signed)}" alt="${esc(i.label)}" loading="lazy"/></a>`;
      }).join('');
      return `
      <section class="item">
        <div class="itemHead">
          <strong>${esc(i.label)}</strong>
          <span class="cnt">${i.fotos.length} ${i.fotos.length === 1 ? 'foto' : 'fotos'}</span>
        </div>
        ${i.obs ? `<p class="obs">${esc(i.obs)}</p>` : ''}
        <div class="mid">${midias}</div>
      </section>`;
    }).join('');

    const blocoFaltando = faltando.length
      ? `<div class="faltando"><strong>Sem registro:</strong> ${faltando.join(' · ')}</div>`
      : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120');
    res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vistoria${v.cliente_nome ? ' — ' + esc(v.cliente_nome) : ''}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#F1F5F9;margin:0;padding:0 0 48px}
  header{padding:28px 20px 20px;background:linear-gradient(135deg,#1E293B,#0F172A);border-bottom:1px solid #1E293B}
  header .eyebrow{color:#FBBF24;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px}
  header h1{font-size:22px;margin:0 0 4px;line-height:1.2}
  .wrap{max-width:820px;margin:0 auto;padding:0 16px}
  .meta{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:#CBD5E1}
  .item{margin-top:22px;padding-top:18px;border-top:1px solid #1E293B}
  .itemHead{display:flex;align-items:baseline;gap:10px}
  .itemHead strong{font-size:16px}
  .cnt{font-size:12px;color:#94A3B8}
  .obs{font-size:13px;color:#CBD5E1;margin:6px 0 0}
  .mid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px}
  .ph{display:block;border-radius:12px;overflow:hidden;border:1px solid #334155}
  .ph img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#0B1220}
  .file{display:flex;align-items:center;justify-content:center;padding:18px;border-radius:12px;border:1px solid #334155;background:#1E293B;color:#F1F5F9;text-decoration:none;font-size:14px;font-weight:600}
  .faltando{margin-top:24px;padding:12px 14px;background:#3F1D1D;border:1px solid #7F1D1D;border-radius:12px;font-size:13px;color:#FCA5A5}
  footer{text-align:center;color:#64748B;font-size:12px;margin-top:28px}
  .empty{margin-top:24px;padding:24px;text-align:center;color:#94A3B8;background:#1E293B;border-radius:14px}
  .dlBtn{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:12px 18px;border-radius:12px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#0f172a;font-weight:800;font-size:14px;text-decoration:none}
</style>
</head><body>
<header><div class="wrap">
  <p class="eyebrow">☀️ Vistoria de Energia Solar</p>
  <h1>${v.cliente_nome ? esc(v.cliente_nome) : 'Vistoria técnica'}</h1>
  <div class="meta"><span>📅 ${data}</span><span>✅ ${comFoto.length} de ${itens.length} itens</span><span>${v.status === 'concluida' ? 'Concluída' : 'Em andamento'}</span></div>
  ${totalFotos > 0 ? `<a class="dlBtn" href="/v/${esc(v.id)}/fotos.zip" download>⬇️ Baixar todas as fotos (${totalFotos})</a>` : ''}
</div></header>
<main class="wrap">
  ${comFoto.length ? blocos : `<div class="empty">Nenhum registro ainda.</div>`}
  ${blocoFaltando}
  <footer>Relatório gerado pela SolarDoc • ${data}</footer>
</main>
</body></html>`);
  } catch (err) {
    console.error('[public-vistoria] erro:', err);
    res.status(500).type('text/plain').send('Erro ao carregar a vistoria.');
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
