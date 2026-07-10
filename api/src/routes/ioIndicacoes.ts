import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { indicacaoLimiter } from '../middleware/rateLimiter';
import { sendWhatsApp } from '../services/agents/zapiClient';
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
    const indicador_telefone_raw = clean(body.indicador_telefone);
    const indicador_pix = clean(body.indicador_pix);
    const origem = clean(body.origem).slice(0, MAX) || null;

    // Todos os 5 campos obrigatórios (o telefone do indicador é onde mandamos a confirmação).
    if (!indicado_nome || !indicado_telefone_raw || !indicador_nome || !indicador_telefone_raw || !indicador_pix) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    }
    // Tetos de tamanho (anti-payload gigante).
    if (
      indicado_nome.length > MAX ||
      indicado_telefone_raw.length > MAX ||
      indicador_nome.length > MAX ||
      indicador_telefone_raw.length > MAX ||
      indicador_pix.length > MAX
    ) {
      return res.status(400).json({ error: 'Algum campo está longo demais.' });
    }
    // Telefone precisa ter dígitos suficientes pra ser contatável.
    const indicado_telefone = normalizePhone(indicado_telefone_raw);
    if (indicado_telefone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Telefone/WhatsApp da indicação inválido. Inclua o DDD.' });
    }
    const indicador_telefone = normalizePhone(indicador_telefone_raw);
    if (indicador_telefone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Seu WhatsApp está inválido. Inclua o DDD.' });
    }

    const { error } = await supabase.from('io_indicacoes').insert({
      indicado_nome,
      indicado_telefone,
      indicado_telefone_raw,
      indicador_nome,
      indicador_telefone,
      indicador_telefone_raw,
      indicador_pix,
      origem,
      status: 'novo',
    });
    if (error) throw error;

    // Confirmação por WhatsApp pro indicador — ele acabou de enviar o form e está
    // esperando isto (opt-in explícito, 1 mensagem, sem risco de ban). Isolado:
    // a indicação já está salva, então uma falha da Z-API (ou o cooldown do
    // circuit-breaker, que lança) NÃO pode derrubar a resposta do form.
    try {
      const primeiroNome = indicador_nome.split(/\s+/)[0] || indicador_nome;
      await sendWhatsApp(
        indicador_telefone,
        `Olá, ${primeiroNome}! 🌞 Recebemos a sua indicação de *${indicado_nome}* aqui na Irmãos na Obra. ` +
        `Vamos entrar em contato com ela e, quando o projeto fechar e for instalado, o seu PIX cai na chave que você informou. ` +
        `Obrigado por indicar! 💛`,
        'io',
      );
    } catch (waErr: any) {
      logger.error('io-indicacoes', 'WhatsApp confirmação indicador falhou (indicação salva)', String(waErr?.message || waErr));
    }

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

    // Notifica o indicador quando a indicação FECHA/PAGA — uma única vez
    // (notificado_fechado trava reenvio se o admin reeditar o status depois).
    // Isolado: o update já persistiu, WhatsApp é best-effort.
    if (
      (patch.status === 'fechado' || patch.status === 'pago') &&
      data?.indicador_telefone &&
      !data.notificado_fechado
    ) {
      try {
        const primeiroNome = String(data.indicador_nome || '').split(/\s+/)[0] || 'tudo bem';
        const msg = patch.status === 'pago'
          ? `Oi, ${primeiroNome}! 💸 O PIX da sua indicação de *${data.indicado_nome}* foi enviado pra chave que você cadastrou. Obrigado por indicar a Irmãos na Obra! 🌞`
          : `Oi, ${primeiroNome}! 🎉 Ótima notícia: a sua indicação de *${data.indicado_nome}* fechou o projeto com a gente! Assim que a instalação for concluída, o seu PIX cai na chave que você informou. Obrigado por indicar! 💛`;
        await sendWhatsApp(String(data.indicador_telefone), msg, 'io');
        await supabase.from('io_indicacoes').update({ notificado_fechado: true }).eq('id', req.params.id);
      } catch (waErr: any) {
        logger.error('io-indicacoes', 'WhatsApp notif fechamento falhou (status salvo)', String(waErr?.message || waErr));
      }
    }

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
