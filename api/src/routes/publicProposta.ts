import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

// GET /p/:id — serve a proposta solar publicamente (sem auth).
// Aceita id em 3 formatos:
//  - {slug}.{YYYYNNNN} — novo padrão, ex: irmaosnaobra.20260001 (preferido)
//  - Código humano YYYYUUUUNNNN (12 dígitos, ex: 202600010001) — legado
//  - UUID — legado / fallback
// Pega o HTML do Storage e devolve com Content-Type correto.
// Só funciona pra docs do tipo 'propostaSolar' — outros tipos ignorados.
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || '');

    type DocRow = { id: string; tipo: string; arquivo_url: string | null; content: string | null };
    let doc: DocRow | null = null;

    // Formato 1: slug.codigo_curto (ex: cmoenergiasolar.20260001) — preferido
    const slugCurtoMatch = id.match(/^([a-z0-9]+)\.(\d{8})$/);
    if (slugCurtoMatch) {
      const [, slug, codigoCurto] = slugCurtoMatch;
      const { data: comp } = await supabase
        .from('company')
        .select('user_id')
        .eq('slug', slug)
        .maybeSingle();
      if (comp?.user_id) {
        const { data: d } = await supabase
          .from('documents')
          .select('id, tipo, arquivo_url, content')
          .eq('user_id', comp.user_id)
          .eq('codigo_curto', codigoCurto)
          .maybeSingle();
        doc = (d ?? null) as DocRow | null;
      }
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      // Formato 2: UUID — fallback pra docs sem codigo_curto
      const { data: d } = await supabase
        .from('documents')
        .select('id, tipo, arquivo_url, content')
        .eq('id', id)
        .maybeSingle();
      doc = (d ?? null) as DocRow | null;
    }

    if (!doc || doc.tipo !== 'propostaSolar') {
      res.status(404).type('text/html').send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Proposta não encontrada</title>
<style>body{font-family:-apple-system,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;margin:0}h1{font-size:24px;margin:16px 0 8px}p{color:#94A3B8;font-size:14px;margin:0}.icon{font-size:48px}</style>
</head><body>
<div class="icon">🔍</div>
<h1>Proposta não encontrada</h1>
<p>O link expirou ou foi removido. Peça pro vendedor enviar novamente.</p>
</body></html>`);
      return;
    }

    let html: string | null = null;
    if (doc.arquivo_url) {
      const { data: signed } = await supabase.storage
        .from('documentos')
        .createSignedUrl(doc.arquivo_url, 60);
      if (signed?.signedUrl) {
        const r = await fetch(signed.signedUrl);
        if (r.ok) html = await r.text();
      }
    }
    if (!html && doc.content) html = String(doc.content);

    if (!html) {
      res.status(500).type('text/plain').send('Proposta indisponível.');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.send(html);
  } catch (err) {
    console.error('[public-proposta] erro:', err);
    res.status(500).type('text/plain').send('Erro ao carregar proposta.');
  }
});

export default router;
