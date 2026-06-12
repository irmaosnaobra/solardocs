import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { signToken } from '../utils/jwt';
import { sendMetaEvent } from '../utils/metaPixel';
import { sendPasswordResetEmail } from '../utils/mailer';
import { sendWelcomeWhatsApp, sendPurchaseWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';
import { sendWelcomeEmail, sendPurchaseEmail } from '../utils/mailer';
import { FREE_LIMIT } from '../services/planService';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// Trim defensivo + fallback — env vars do Vercel as vezes vêm com \n
const PRICE_PRO = ((process.env.STRIPE_PRICE_PRO || '').trim()) || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn';
const PRICE_VIP = ((process.env.STRIPE_PRICE_VIP || '').trim()) || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2';

const PRICE_TO_PLAN: Record<string, { plano: string; limite: number }> = {
  [PRICE_PRO]: { plano: 'pro',       limite: 90 },
  [PRICE_VIP]: { plano: 'ilimitado', limite: 999999 },
};

async function detectStripePlan(email: string): Promise<{ plano: string; limite: number } | null> {
  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (!customers.data.length) return null;
    // Inclui 'trialing': no fluxo LP→Stripe→cadastro, o cliente passou o cartão
    // e está nos 7 dias grátis (sub trialing, ainda sem cobrança). Tem que
    // entrar já como PRO/VIP. 'all' + filtro pega active E trialing.
    const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'all', limit: 5 });
    const sub = subs.data.find(s => s.status === 'active' || s.status === 'trialing');
    if (!sub) return null;
    const priceId = sub.items.data[0]?.price?.id ?? '';
    return PRICE_TO_PLAN[priceId] ?? null;
  } catch {
    return null;
  }
}

// Resolve plano DIRETO da checkout session (fonte autoritativa). Mais robusto que
// detectStripePlan(email): não depende do email digitado bater com o do cartão,
// e blinda cross-produto (session do Pack é mode=payment, sem subscription/price
// SolarDoc → retorna null). Usado quando o register vem com session_id.
// Atribuição forward-only: monta o patch das colunas de `users` a partir do
// metadata do checkout (utm_* + lp_session que a LP enviou). Só campos presentes.
function attributionPatchFromSession(
  meta: Record<string, unknown> | null | undefined,
  checkoutSessionId: string,
): Record<string, string> {
  const patch: Record<string, string> = { checkout_session_id: checkoutSessionId };
  let hasAttr = false;
  for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    const v = meta?.[k];
    if (typeof v === 'string' && v.trim()) { patch[k] = v.trim(); hasAttr = true; }
  }
  const lp = meta?.lp_session;
  if (typeof lp === 'string' && lp.trim()) { patch.attribution_session_id = lp.trim(); hasAttr = true; }
  if (hasAttr) patch.attribution_captured_at = new Date().toISOString();
  return patch;
}

async function detectPlanFromSession(sessionId: string): Promise<{ plano: string; limite: number; email: string | null; attribution: Record<string, string> } | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    // Guard: só checkout público do SolarDoc. Pack nunca seta source.
    if (session.metadata?.source !== 'public_checkout') return null;
    if (!session.subscription) return null;
    const sub = await stripe.subscriptions.retrieve(session.subscription as string);
    const priceId = sub.items.data[0]?.price?.id ?? '';
    const info = PRICE_TO_PLAN[priceId];
    if (!info) return null;
    const email = session.customer_email
      ?? (session.customer_details as { email?: string } | null)?.email
      ?? null;
    const attribution = attributionPatchFromSession(session.metadata, session.id);
    return { ...info, email, attribution };
  } catch {
    return null;
  }
}

// CNPJ — valida dígitos verificadores. Aceita só dígitos (frontend já tira máscara).
function isValidCnpjDigits(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(cnpj.slice(0, 12), w1) === Number(cnpj[12])
      && calc(cnpj.slice(0, 13), w2) === Number(cnpj[13]);
}

// Cadastro pós-checkout pago (session/fromCheckout): a pessoa JÁ passou o cartão,
// então o cadastro é só email + senha (mínimo atrito — entra na plataforma na hora).
// WhatsApp/CNPJ/nome ficam pra depois (tela /empresa + cadência de email de CNPJ).
// Cadastro FREE orgânico continua exigindo WhatsApp + CNPJ válido (sem isso a conta
// não vira "ativa": é o gate que alimenta toda a cadência de onboarding por CNPJ).
const registerSchema = z.object({
  email:    z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  nome:     z.string().min(2, 'Nome obrigatório').optional(),
  cargo:    z.string().optional(),
  // WhatsApp/CNPJ: aceitam vazio aqui; a obrigatoriedade é decidida no superRefine
  // conforme a origem. Quando vêm preenchidos, validam normalmente.
  whatsapp: z.string()
    .transform(v => (v ?? '').replace(/\D/g, ''))
    .refine(d => d === '' || d.length === 10 || d.length === 11, 'WhatsApp deve ter DDD + 8 ou 9 dígitos')
    .optional(),
  cnpj:     z.string()
    .transform(v => (v ?? '').replace(/\D/g, ''))
    .refine(d => d === '' || isValidCnpjDigits(d), 'CNPJ inválido')
    .optional(),
  empresa:  z.string().optional(),
  // Marcadores de origem — usados pra decidir se WhatsApp/CNPJ são obrigatórios.
  session:      z.string().optional(),
  fromCheckout: z.boolean().optional(),
}).superRefine((data, ctx) => {
  const fromPaidCheckout = !!data.session || data.fromCheckout === true;
  if (fromPaidCheckout) return; // pós-pago: só email + senha bastam.

  // Fluxo free orgânico: WhatsApp + CNPJ obrigatórios (gate de conta "ativa").
  if (!data.whatsapp) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['whatsapp'], message: 'WhatsApp deve ter DDD + 8 ou 9 dígitos' });
  }
  if (!data.cnpj) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cnpj'], message: 'CNPJ inválido' });
  }
});

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const body = registerSchema.parse(req.body);

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', body.email)
      .single();

    const sessionId = body.session;
    const fromCheckout = body.fromCheckout === true;

    // Detecta o plano pago. PRIORIDADE: pela session_id (autoritativo — não depende
    // do email digitado). Fallback: por email (fluxos antigos / sem session).
    // No fluxo LP→Stripe→cadastro a pessoa já passou o cartão (7d grátis) antes daqui.
    let stripePlan: { plano: string; limite: number } | null = null;
    // Atribuição UTM→Stripe (escrita PRIMÁRIA): só o fluxo por session traz os
    // UTMs do metadata. Fica vazio nos fluxos sem session (orgânico/email).
    let attribution: Record<string, string> = {};
    if (sessionId) {
      const fromSession = await detectPlanFromSession(sessionId);
      if (fromSession) {
        // Segurança: o email do cadastro tem que ser o MESMO do checkout (quando o
        // Stripe coletou um). Evita pagar como A e cadastrar como B.
        if (fromSession.email && fromSession.email.toLowerCase() !== body.email.toLowerCase()) {
          res.status(400).json({ error: 'EMAIL_DIFERENTE_DO_PAGAMENTO' });
          return;
        }
        stripePlan = { plano: fromSession.plano, limite: fromSession.limite };
        attribution = fromSession.attribution;
      }
    }
    if (!stripePlan) {
      stripePlan = await detectStripePlan(body.email);
    }

    // [PENDENTE — trial Pack→SolarDoc] Aqui entra a concessão do trial PRO grátis
    // pra quem comprou o Pack com o bump 'solardoc_trial'. NÃO ativar via param
    // origem='pack-solar' (atacável). Verificar pedido REAL pago:
    //   pack.pedidos WHERE email=body.email AND paid_at NOT NULL
    //     AND bump_solardoc_trial=true AND solardoc_user_id IS NULL
    // Se válido: criar conta com pack_trial_until = now()+7d (coluna já existe;
    // syncStripePlans já respeita e expira). Stampar solardoc_user_id/
    // solardoc_trial_ativado_at no pedido (anti-double-grant). Decidir caso
    // existing (já tem conta). GATED: só fiar após 1 checkout real testar o
    // fluxo P0 (detectPlanFromSession) em produção. origem chega em req.body.origem.

    // Veio do checkout público (passou pelo Stripe)? Se sim e a detecção falhou,
    // NÃO cria conta free silenciosa — pagou mas algo deu errado, retorna claro.
    // Keyado em fromPaidCheckout (session OU fromCheckout) — o MESMO sinal que
    // relaxa o CNPJ no schema. Sem isso, um POST com session sem plano detectável
    // criaria uma conta free SEM CNPJ, furando o gate do fluxo orgânico.
    const fromPaidCheckout = !!sessionId || fromCheckout;
    if (fromPaidCheckout && !stripePlan && !existing) {
      res.status(402).json({ error: 'PAGAMENTO_NAO_DETECTADO' });
      return;
    }

    if (existing) {
      // Email já tem conta. Se acabou de pagar (tem plano no Stripe), ATIVA o
      // plano na conta existente e manda fazer login — não recria, não reseta senha.
      if (stripePlan) {
        await supabase
          .from('users')
          .update({ plano: stripePlan.plano, limite_documentos: stripePlan.limite, billing_status: 'active', ...attribution })
          .eq('id', existing.id);
        // Boas-vindas de COMPRA também nesta branch — quem já tinha conta FREE e
        // comprou depois cai aqui e antes não recebia NADA. AWAIT obrigatório em
        // serverless (ver nota na branch de conta nova).
        const tasks: Promise<unknown>[] = [];
        if (body.whatsapp) {
          tasks.push(sendPurchaseWhatsApp(body.whatsapp, stripePlan.plano, body.nome || null).catch(() => {}));
        }
        tasks.push(sendPurchaseEmail({ to: body.email, userId: existing.id, nome: body.nome || null, plano: stripePlan.plano }).catch(() => {}));
        await Promise.allSettled(tasks);
        res.status(409).json({ error: 'JA_TEM_CONTA_PLANO_ATIVADO', planoAtivado: stripePlan.plano });
        return;
      }
      res.status(409).json({ error: 'Email já cadastrado' });
      return;
    }

    const password_hash = await bcrypt.hash(body.password, 12);

    const plano             = stripePlan?.plano  ?? 'free';
    const limite_documentos = stripePlan?.limite ?? FREE_LIMIT;

    const dataReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: body.email, password_hash, nome: body.nome || null, cargo: body.cargo || null, plano, limite_documentos, documentos_usados: 0, data_reset: dataReset, whatsapp: body.whatsapp || null, ...attribution })
      .select('id, email, nome, plano, limite_documentos, documentos_usados, created_at')
      .single();

    if (error) throw error;

    // Cria empresa imediatamente se CNPJ veio do cadastro (fluxo simplificado).
    // Se não vier, fluxo continua: user cadastra empresa depois em /empresa.
    if (body.cnpj || body.empresa) {
      try {
        await supabase.from('company').insert({
          user_id: user.id,
          nome: body.empresa || null,
          cnpj: body.cnpj || null,
          whatsapp: body.whatsapp || null,
        });
      } catch {}
    }

    const token = signToken(user.id);

    // Meta CAPI — Lead (server-side, deduplica com pixel client)
    sendMetaEvent('Lead', {
      eventId:   req.headers['x-meta-event-id'] as string | undefined,
      email:     body.email,
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Boas-vindas: WhatsApp (Giovanna) + email (Resend).
    // Quem COMPROU (stripePlan) recebe o pacote de compra (agradece + confirma
    // plano + instruções completas); quem é FREE recebe a boas-vindas padrão.
    // AWAIT é obrigatório em serverless — sem ele, a função encerra antes
    // das bolhas terminarem (vimos: só a 1ª chegava). Resposta demora ~20s
    // mas user só vê depois das mensagens enviadas (mais coerente).
    const tasks: Promise<unknown>[] = [];
    if (stripePlan) {
      if (body.whatsapp) {
        tasks.push(sendPurchaseWhatsApp(body.whatsapp, stripePlan.plano, body.nome || null).catch(() => {}));
      }
      tasks.push(sendPurchaseEmail({ to: body.email, userId: user.id, nome: body.nome || null, plano: stripePlan.plano }).catch(() => {}));
    } else {
      if (body.whatsapp) {
        tasks.push(sendWelcomeWhatsApp(body.whatsapp, body.email, body.nome || null).catch(() => {}));
      }
      tasks.push(sendWelcomeEmail({ to: body.email, userId: user.id, nome: body.nome || null }).catch(() => {}));
    }
    await Promise.allSettled(tasks);

    res.status(201).json({ token, user });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Contador real pra social proof no /auth?mode=register.
// Cache em módulo: 5min por instância serverless — evita martelar o DB.
let signupsCache: { value: number; expiresAt: number } | null = null;

export async function recentSignupsCount(_req: Request, res: Response): Promise<void> {
  try {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');

    if (signupsCache && signupsCache.expiresAt > Date.now()) {
      res.json({ count: signupsCache.value });
      return;
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);

    if (error) throw error;

    const value = count ?? 0;
    signupsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
    res.json({ count: value });
  } catch (err) {
    console.error('recentSignupsCount error:', err);
    // Fallback silencioso — popup tem fallback próprio.
    res.json({ count: 0 });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const body = loginSchema.parse(req.body);

    const { data: user } = await supabase
      .from('users')
      // is_admin + billing_status precisam vir no login: o front salva este user
      // no cookie e o Sidebar decide a Área Restrita por is_admin. Sem eles, o
      // admin loga e a Área Restrita some até o /auth/me corrigir (race no 1º paint).
      .select('id, email, nome, password_hash, plano, limite_documentos, documentos_usados, data_reset, created_at, is_admin, billing_status')
      .eq('email', body.email)
      .single();

    if (!user) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    const validPassword = await bcrypt.compare(body.password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    const { password_hash: _, ...userWithoutPassword } = user;
    const token = signToken(user.id);
    res.json({ token, user: userWithoutPassword });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body as { email: string };
    if (!email) { res.status(400).json({ error: 'Email obrigatório' }); return; }

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    // Resposta genérica para não revelar se o email existe
    if (!user) { res.json({ message: 'Se o email estiver cadastrado, você receberá as instruções.' }); return; }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    console.log(`[ForgotPass] Gerando token para ${email}`);

    const { error: updateErr } = await supabase
      .from('users')
      .update({ reset_token: token, reset_token_expires: expires })
      .eq('id', user.id);

    if (updateErr) {
      console.error('[ForgotPass] Erro ao atualizar token no banco:', updateErr);
      throw updateErr;
    }

    const dashboardUrl = process.env.DASHBOARD_URL || 'https://solardocs-dashboard.vercel.app';
    const resetUrl = `${dashboardUrl}/auth?mode=redefinir&token=${token}`;
    
    console.log(`[ForgotPass] Enviando e-mail para ${email} com URL: ${resetUrl}`);

    try {
      await sendPasswordResetEmail(email, resetUrl);
      console.log(`[ForgotPass] E-mail enviado com sucesso para ${email}`);
    } catch (mailErr) {
      console.error('[ForgotPass] Erro fatal ao enviar e-mail:', mailErr);
      // Não rethrow para manter a resposta genérica, mas logamos o erro
    }

    res.json({ message: 'Se o email estiver cadastrado, você receberá as instruções.' });
  } catch (err) {
    console.error('ForgotPassword error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, password } = req.body as { token: string; password: string };
    if (!token || !password) { res.status(400).json({ error: 'Token e senha são obrigatórios' }); return; }
    if (password.length < 6) { res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' }); return; }

    const { data: user } = await supabase
      .from('users')
      .select('id, reset_token_expires')
      .eq('reset_token', token)
      .single();

    if (!user) { res.status(400).json({ error: 'Link inválido ou expirado' }); return; }
    if (new Date(user.reset_token_expires) < new Date()) {
      res.status(400).json({ error: 'Link expirado. Solicite um novo.' }); return;
    }

    const password_hash = await bcrypt.hash(password, 12);
    await supabase
      .from('users')
      .update({ password_hash, reset_token: null, reset_token_expires: null })
      .eq('id', user.id);

    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch (err) {
    console.error('ResetPassword error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Troca de senha estando logado — exige a senha atual (segurança).
export async function changePassword(req: Request, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Senha atual e nova são obrigatórias' }); return; }
    if (newPassword.length < 6) { res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' }); return; }

    const { data: user } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', req.userId)
      .single();

    if (!user) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) { res.status(400).json({ error: 'Senha atual incorreta' }); return; }

    const password_hash = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash }).eq('id', user.id);

    res.json({ message: 'Senha alterada com sucesso!' });
  } catch (err) {
    console.error('ChangePassword error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Edita o perfil — SÓ o nome. Email (login) e plano NÃO mudam por aqui (segurança).
export async function updateProfile(req: Request, res: Response): Promise<void> {
  try {
    const { nome } = req.body as { nome?: string };
    const nomeLimpo = (nome ?? '').trim();
    if (!nomeLimpo) { res.status(400).json({ error: 'Nome não pode ficar vazio' }); return; }
    if (nomeLimpo.length > 120) { res.status(400).json({ error: 'Nome muito longo' }); return; }

    const { data: user, error } = await supabase
      .from('users')
      .update({ nome: nomeLimpo })
      .eq('id', req.userId)
      .select('id, email, nome, plano, limite_documentos, documentos_usados, is_admin, billing_status')
      .single();

    if (error || !user) { res.status(500).json({ error: 'Falha ao atualizar perfil' }); return; }
    res.json({ user });
  } catch (err) {
    console.error('UpdateProfile error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, nome, plano, limite_documentos, documentos_usados, data_reset, created_at, is_admin, billing_status, past_due_since')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error('GetMe error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
