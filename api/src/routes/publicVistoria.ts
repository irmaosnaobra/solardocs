import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { withSignedUrls } from './vistorias';

// ─────────────────────────────────────────────────────────────────────────────
// GET /v/:id — relatório PÚBLICO da vistoria solar (sem auth).
// :id é o UUID da vistoria (inadulterável, mandado por WhatsApp).
// Gera signed URL fresca de cada foto A CADA abertura — nunca guarda URL que
// expira. Mesmo padrão do /p/:id (proposta pública).
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

type Item = { key: string; label: string; dica?: string; foto_url: string | null; obs?: string; ts?: string | null; foto_signed?: string | null };

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
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

    const itensRaw = (Array.isArray(v.itens) ? v.itens : []) as Item[];
    const itens = await withSignedUrls(itensRaw as never);
    const comFoto = itens.filter((i) => i.foto_signed);

    const data = new Date(v.created_at).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const cards = comFoto.map((i) => `
      <figure class="card">
        <img src="${esc(i.foto_signed)}" alt="${esc(i.label)}" loading="lazy"/>
        <figcaption>
          <strong>${esc(i.label)}</strong>
          ${i.obs ? `<span class="obs">${esc(i.obs)}</span>` : ''}
        </figcaption>
      </figure>`).join('');

    const faltando = itens.filter((i) => !i.foto_signed).map((i) => esc(i.label));
    const blocoFaltando = faltando.length
      ? `<div class="faltando"><strong>Sem foto:</strong> ${faltando.join(' · ')}</div>`
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
  header p{color:#94A3B8;font-size:14px;margin:0}
  .wrap{max-width:760px;margin:0 auto;padding:0 16px}
  .meta{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:#CBD5E1}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:20px}
  .card{margin:0;background:#1E293B;border:1px solid #334155;border-radius:14px;overflow:hidden}
  .card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#0B1220}
  .card figcaption{padding:10px 12px;display:flex;flex-direction:column;gap:4px}
  .card strong{font-size:14px}
  .card .obs{font-size:12px;color:#94A3B8}
  .faltando{margin-top:20px;padding:12px 14px;background:#3F1D1D;border:1px solid #7F1D1D;border-radius:12px;font-size:13px;color:#FCA5A5}
  footer{text-align:center;color:#64748B;font-size:12px;margin-top:28px}
  .empty{margin-top:24px;padding:24px;text-align:center;color:#94A3B8;background:#1E293B;border-radius:14px}
</style>
</head><body>
<header><div class="wrap">
  <p class="eyebrow">☀️ Vistoria de Energia Solar</p>
  <h1>${v.cliente_nome ? esc(v.cliente_nome) : 'Vistoria técnica'}</h1>
  <div class="meta"><span>📅 ${data}</span><span>📸 ${comFoto.length} de ${itens.length} itens</span><span>${v.status === 'concluida' ? '✅ Concluída' : '⏳ Em andamento'}</span></div>
</div></header>
<main class="wrap">
  ${comFoto.length ? `<div class="grid">${cards}</div>` : `<div class="empty">Nenhuma foto registrada ainda.</div>`}
  ${blocoFaltando}
  <footer>Relatório gerado pela SolarDoc • ${data}</footer>
</main>
</body></html>`);
  } catch (err) {
    console.error('[public-vistoria] erro:', err);
    res.status(500).type('text/plain').send('Erro ao carregar a vistoria.');
  }
});

export default router;
