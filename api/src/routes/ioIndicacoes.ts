import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { indicacaoLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';

const router = Router();

const MAX = 200; // teto de tamanho por campo
const STATUSES = ['novo', 'contatado', 'fechado', 'pago'] as const;

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Normaliza telefone BR pra formato WhatsApp (DDI 55 + DDD + número). Conservador:
// só conserta o que dá pra inferir com segurança; o que vier estranho fica como veio
// (e guardamos o raw sempre). Mesma filosofia da normalização do LimpaPro.
function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  // tira zeros de operadora/tronco na frente
  d = d.replace(/^0+/, '');
  // já veio com DDI 55 e tamanho plausível (12 = fixo, 13 = celular) → mantém
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  // 11 dígitos (DDD + 9 + 8) ou 10 (DDD + 8) sem DDI → prefixa 55
  if (d.length === 10 || d.length === 11) return '55' + d;
  // qualquer outra coisa: devolve os dígitos como estão (admin avalia manual)
  return d;
}

// ──────────────────────────────────────────────────────────────────────────
// PÚBLICO — formulário de indicação. WRITE público: validação dura + rate-limit
// dedicado + honeypot. Chamado via /_api/io-indicacoes do dashboard.
// ──────────────────────────────────────────────────────────────────────────
router.post('/', indicacaoLimiter, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};

    // Honeypot: campo escondido no form. Bot preenche, humano não. Se vier
    // preenchido, fingimos sucesso e descartamos.
    if (clean(body.website)) {
      return res.json({ ok: true });
    }

    const indicado_nome = clean(body.indicado_nome);
    const indicado_telefone_raw = clean(body.indicado_telefone);
    const indicador_nome = clean(body.indicador_nome);
    const indicador_pix = clean(body.indicador_pix);
    const origem = clean(body.origem).slice(0, MAX) || null;

    // Todos os 4 campos obrigatórios.
    if (!indicado_nome || !indicado_telefone_raw || !indicador_nome || !indicador_pix) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    }
    // Tetos de tamanho (anti-payload gigante).
    if (
      indicado_nome.length > MAX ||
      indicado_telefone_raw.length > MAX ||
      indicador_nome.length > MAX ||
      indicador_pix.length > MAX
    ) {
      return res.status(400).json({ error: 'Algum campo está longo demais.' });
    }
    // Telefone precisa ter dígitos suficientes pra ser contatável.
    const indicado_telefone = normalizePhone(indicado_telefone_raw);
    if (indicado_telefone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Telefone/WhatsApp inválido. Inclua o DDD.' });
    }

    const { error } = await supabase.from('io_indicacoes').insert({
      indicado_nome,
      indicado_telefone,
      indicado_telefone_raw,
      indicador_nome,
      indicador_pix,
      origem,
      status: 'novo',
    });
    if (error) throw error;

    res.json({ ok: true });
  } catch (err: any) {
    // Nunca logar req.body — tem PII financeira (PIX/telefone).
    logger.error('io-indicacoes', 'insert público falhou', String(err?.message || err));
    res.status(500).json({ error: 'Não consegui registrar agora. Tente de novo.' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// ADMIN — painel de indicações (só aiorosgroup).
// ──────────────────────────────────────────────────────────────────────────
router.get('/admin', authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('io_indicacoes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, indicacoes: data ?? [] });
  } catch (err: any) {
    logger.error('io-indicacoes', 'list admin falhou', String(err?.message || err));
    res.status(500).json({ error: 'failed' });
  }
});

router.patch('/admin/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: 'status inválido' });
      }
      patch.status = req.body.status;
    }
    if (req.body?.observacoes !== undefined) {
      patch.observacoes = clean(req.body.observacoes).slice(0, 1000) || null;
    }
    const { data, error } = await supabase
      .from('io_indicacoes')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, indicacao: data });
  } catch (err: any) {
    logger.error('io-indicacoes', 'update falhou', String(err?.message || err));
    res.status(500).json({ error: 'failed' });
  }
});

router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('io_indicacoes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('io-indicacoes', 'delete falhou', String(err?.message || err));
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
