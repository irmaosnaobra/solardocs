import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendWhatsApp, sendHuman, sendImage, ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { concederCursoPorAssinatura } from '../../kitIntegradorService';

// ─────────────────────────────────────────────────────────────────────────────
// Confirmação de Pix por COMPROVANTE (cliente SolarDoc).
// Fluxo: cartão falhou → oferecemos Pix (copia-e-cola R$67) → cliente paga e MANDA
// O COMPROVANTE no WhatsApp → a IA (visão) lê, valida (recebedor=Aioros + valor +
// data + dedup) e LIBERA na hora, orientando o cliente. O Thiago recebe no WhatsApp
// (34991360223) a confirmação + a IMAGEM do comprovante encaminhada pra ele conferir
// depois e arquivar.
//
// AUTO ligado (decisão Thiago 25/jul/2026). Kill-switch: PIX_AUTO_LIBERAR=false.
// Risco residual: o CNPJ Aioros (63636043000188) é o MESMO dos 3 produtos
// (SolarDoc/LimpaPro/Irmãos) → um comprovante de R$67 de outro produto passaria as
// travas. A conferência pós-fato do Thiago (recebe o comprovante) é a rede de segurança.
//
// GATE: só roda pra quem NÃO é cartão ativo (past_due/suspended/free/pendente) —
// evita corromper o billing de assinante de cartão (o guard pix do sync pararia de
// reconciliar ele com a Stripe) e corta custo de visão em prints de suporte.
// ─────────────────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// AUTO ligado por padrão; desliga com PIX_AUTO_LIBERAR=false (volta pro 1-clique do Thiago).
const AUTO_LIBERAR = (process.env.PIX_AUTO_LIBERAR ?? 'true').toLowerCase() !== 'false';
const THIAGO_PHONE = '34991360223';     // confirmação + comprovante vão pro WhatsApp do dono
const AIOROS_CNPJ  = '63636043000188';  // recebedor esperado (só dígitos)
const PLANOS_VALIDOS = [27, 49, 67];    // valores EXATOS dos planos SolarDoc (PRO/VIP PROMO/VIP)

// Valor pago → plano concedido. Oferta do Pix hoje é R$67 = completo (ilimitado).
const PLANO_POR_VALOR: Record<number, { plano: string; limite: number }> = {
  27: { plano: 'pro',        limite: 90 },
  49: { plano: 'ilimitado',  limite: 999999 },
  67: { plano: 'ilimitado',  limite: 999999 },
};

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

type ImgSrc = { type: 'base64'; media_type: any; data: string };

interface Comprovante {
  is_comprovante: boolean;
  valor: number | null;
  recebedor_nome: string | null;
  recebedor_documento: string | null;
  data: string | null;
  id_transacao: string | null;
}

async function lerComprovante(img: ImgSrc): Promise<Comprovante | null> {
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: img },
          { type: 'text', text: [
            'Esta imagem é um COMPROVANTE de pagamento Pix ou transferência bancária?',
            'Extraia os dados de QUEM RECEBEU (recebedor / beneficiário / destino).',
            'Responda SOMENTE um JSON válido, sem texto antes ou depois:',
            '{"is_comprovante": true|false, "valor": number|null, "recebedor_nome": string|null, "recebedor_documento": string|null, "data": string|null, "id_transacao": string|null}',
            'recebedor_documento = CNPJ/CPF do recebedor só com dígitos. data = AAAA-MM-DD. id_transacao = ID/E2E/autenticação da transação.',
            'Se NÃO for claramente um comprovante de pagamento, is_comprovante=false. NÃO invente dados; use null quando não tiver certeza.',
          ].join('\n') },
        ],
      }],
    });
    const block = r.content.find(b => b.type === 'text');
    const txt = block && 'text' in block ? block.text : '';
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as Comprovante) : null;
  } catch (err) {
    logger.error('pix-comprovante', 'leitura por visão falhou', err);
    return null;
  }
}

// Valida as travas de um comprovante lido. `identity` = telefone normalizado — usado
// como base do dedupKey (MESMO valor nos dois paths → dedup consistente mesmo sem
// id_transacao). Retorna se passou + o motivo (pra log/aviso).
async function validarComprovante(c: Comprovante, identity: string): Promise<{ passou: boolean; motivo: string; valor: number; dedupKey: string }> {
  const doc   = (c.recebedor_documento || '').replace(/\D/g, '');
  const nome  = (c.recebedor_nome || '').toLowerCase();
  const valor = Number(c.valor) || 0;

  const recebedorOk = doc.includes(AIOROS_CNPJ) || nome.includes('aioros');
  const valorOk = PLANOS_VALIDOS.includes(Math.round(valor)); // valor EXATO de um plano
  // Data AUSENTE ou ilegível → FALHA a trava (não auto-libera comprovante sem data
  // recente comprovável — senão um comprovante antigo de R$67 passaria).
  let dataOk = false;
  if (c.data) {
    const d = Date.parse(c.data);
    if (!isNaN(d)) dataOk = (Date.now() - d) < 6 * 864e5 && d <= Date.now() + 864e5;
  }
  // Dedup DETERMINÍSTICO por telefone+valor+data (NÃO usa id_transacao — a visão às
  // vezes lê o id num envio e não no outro, o que faria a chave divergir e dobrar o mês).
  // Como `passou` exige data recente legível, aqui a data está sempre preenchida.
  const dedupKey = `pix_comprov:${identity.replace(/\D/g, '')}:${valor}:${c.data || ''}`;
  const { data: usado } = await supabase.from('system_state').select('key').eq('key', dedupKey).limit(1);
  const passou = recebedorOk && valorOk && dataOk && !(usado?.length);

  const motivo = usado?.length ? 'comprovante já usado antes (reenvio?)'
    : !recebedorOk ? 'recebedor NÃO parece ser a Aioros'
    : !valorOk ? 'valor não bate com plano (27/49/67)'
    : !dataOk ? 'data ausente ou fora da janela'
    : 'ok';
  return { passou, motivo, valor, dedupKey };
}

// Empurra plano_expira_em +1 mês (base = vencimento atual se ainda no futuro, senão agora).
async function liberarAcessoPix(
  userId: string, planoExpiraEmAtual: string | null, plano: string, limite: number,
): Promise<Date> {
  const now = Date.now();
  const base = (planoExpiraEmAtual && new Date(planoExpiraEmAtual).getTime() > now)
    ? new Date(planoExpiraEmAtual) : new Date(now);
  base.setMonth(base.getMonth() + 1);
  await supabase.from('users').update({
    plano, limite_documentos: limite, documentos_usados: 0, billing_status: 'active', plano_expira_em: base.toISOString(),
  }).eq('id', userId);

  // Reativou no VIP (R$67) → o curso entra junto, igual à oferta vip_curso. Sem
  // isto a Giovanna prometeria no dunning uma coisa que o sistema não entrega:
  // desde 30/jul/2026 o plano sozinho não abre mais o curso, quem abre é o
  // pedido pago que concederCursoPorAssinatura grava.
  if (plano === 'ilimitado') {
    try {
      const { data: u } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
      const email = (u as { email?: string } | null)?.email;
      if (email) await concederCursoPorAssinatura(userId, email);
    } catch (err) {
      console.error('[pix] concessão do curso na reativação falhou (acesso já liberado):', err);
    }
  }
  return base;
}

// Se o cliente estava em DUNNING (past_due/suspended) e pagou por Pix, cancela a
// assinatura de cartão que estava falhando no Stripe — senão o Smart Retries pode
// cobrar de novo (cobrança dupla) — e limpa o estado de dunning. Só age quando o
// status ANTERIOR era past_due/suspended (não mexe em assinante de cartão saudável).
async function encerrarDunningPix(userId: string, email: string, priorStatus: string | null | undefined): Promise<void> {
  if (priorStatus !== 'past_due' && priorStatus !== 'suspended') return;
  try {
    const { cancelStripeSubsForEmail } = await import('../../dunningService');
    const n = await cancelStripeSubsForEmail(email);
    await supabase.from('users')
      .update({ past_due_since: null, dunning_last_day_sent: null })
      .eq('id', userId);
    if (n === 0) {
      // Esperávamos ≥1 sub pra cancelar (o cliente estava em dunning). 0 = o cancel falhou
      // OU o email não casou no Stripe → o cartão PODE seguir cobrando (Smart Retries).
      // Avisa o Thiago pra conferir/cancelar na mão (não finge que deu certo).
      logger.info('pix-comprovante', `dunning por Pix (${email}): 0 subs canceladas — cartão pode seguir cobrando`);
      await sendWhatsApp(THIAGO_PHONE, `⚠️ *Pix reativou ${email}* mas NÃO achei sub de cartão pra cancelar no Stripe. Confere se o cartão dele não vai cobrar em dobro.`, 'solardoc').catch(() => {});
    } else {
      logger.info('pix-comprovante', `dunning encerrado por Pix (${email}): ${n} sub(s) de cartão canceladas`);
    }
  } catch (err) {
    logger.error('pix-comprovante', `encerrar dunning por Pix falhou (${email})`, err);
  }
}

// Avisa o Thiago no WhatsApp e ENCAMINHA a imagem do comprovante pra ele conferir/arquivar.
async function notificarThiago(
  info: { email: string; phone: string; valor: number; comprovante: Comprovante },
  img: ImgSrc,
  statusLinha: string,
): Promise<void> {
  const { email, phone, valor, comprovante: c } = info;
  const doc = (c.recebedor_documento || '').replace(/\D/g, '');
  const texto = [
    '*Comprovante Pix — cliente SolarDoc*',
    '',
    `Cliente: ${email}`,
    `WhatsApp: ${phone}`,
    `Valor lido: ${brl(valor)}`,
    `Recebedor: ${c.recebedor_nome || '—'}${doc ? ' (' + doc + ')' : ''}`,
    '',
    statusLinha,
  ].join('\n');
  await sendWhatsApp(THIAGO_PHONE, texto, 'solardoc').catch(() => {});
  // Encaminha a imagem (data URI base64) pra ele arquivar/conferir.
  try {
    await sendImage(THIAGO_PHONE, `data:${img.media_type};base64,${img.data}`, `Comprovante de ${email}`, 'solardoc');
  } catch (err) {
    logger.error('pix-comprovante', 'encaminhar comprovante pro Thiago falhou', err);
  }
}

// Retorna true se TRATOU o comprovante (liberou OU sinalizou) — o chamador então
// NÃO cai no LLM geral. Retorna false se não é candidato/não é comprovante (segue fluxo).
export async function tryProcessPixComprovante(
  user: { id: string; email: string; plano: string },
  img: ImgSrc,
  cleanPhone: string,
  originInstance: ZapiInstance = 'solardoc',
): Promise<boolean> {
  // GATE: só cliente que NÃO é cartão ativo/trial é candidato a Pix.
  const { data: uRow } = await supabase
    .from('users')
    .select('billing_status, plano_expira_em, password_hash, reset_token')
    .eq('id', user.id)
    .single();
  // Pula quem é CARTÃO ativo/trial (não mexer no billing do Stripe). Mas o assinante
  // de PIX também fica billing_status='active' — a diferença é que ele tem
  // plano_expira_em setado. Então "cartão" = active/trial SEM plano_expira_em; assim a
  // RENOVAÇÃO mensal por Pix (cliente ainda 'active' quando paga) continua sendo processada.
  const cartaoAtivo = (uRow?.billing_status === 'active' || uRow?.billing_status === 'trialing') && !uRow?.plano_expira_em;
  if (cartaoAtivo) return false;

  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → fluxo normal

  const { passou, motivo, valor, dedupKey } = await validarComprovante(c, cleanPhone);
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

  // ── AUTO-LIBERAÇÃO ──
  if (passou && AUTO_LIBERAR) {
    // Trava atômica: insere o dedup ANTES de liberar. Se já existe (reenvio/corrida),
    // NÃO libera de novo (23505 na chave única de system_state).
    const { error: dedupErr } = await supabase.from('system_state')
      .insert({ key: dedupKey, value: { user_id: user.id, valor, data: c.data, at: new Date().toISOString() } });
    if (dedupErr) {
      if ((dedupErr as { code?: string }).code === '23505') {
        logger.info('pix-comprovante', `dedup: comprovante já processado (${user.email})`);
        return true;
      }
      logger.error('pix-comprovante', 'dedup insert falhou (segue liberação)', dedupErr);
    }

    const alvo = PLANO_POR_VALOR[Math.round(valor)] ?? { plano: 'ilimitado', limite: 999999 };
    const venc = await liberarAcessoPix(user.id, uRow?.plano_expira_em ?? null, alvo.plano, alvo.limite);
    // Estava em dunning? cancela o cartão falhando no Stripe (evita cobrança dupla).
    await encerrarDunningPix(user.id, user.email, uRow?.billing_status);

    // Orienta o cliente. Conta pendente (pagou no abandono, sem senha) → link pra definir senha.
    const pendente = !uRow?.password_hash;
    const linhas = ['Pagamento confirmado! ✅ Seu acesso ao SolarDoc está *liberado* 🌞'];
    if (pendente && uRow?.reset_token) {
      linhas.push(`Pra entrar, é só definir sua senha aqui: ${dashboardUrl}/auth?mode=redefinir&token=${uRow.reset_token}`);
    } else {
      linhas.push(`É só entrar em ${dashboardUrl} com seu email e usar. Qualquer dúvida, me chama por aqui! 🙌`);
    }
    await sendHuman(cleanPhone, linhas, originInstance).catch(() => {});

    await notificarThiago(
      { email: user.email, phone: cleanPhone, valor, comprovante: c }, img,
      `✅ *AUTO-LIBERADO* — vence ${venc.toLocaleDateString('pt-BR')}. Confere e arquiva o comprovante.`,
    );
    logger.info('pix-comprovante', `AUTO-liberado ${user.email} ${brl(valor)} vence ${venc.toISOString()}`);
    return true;
  }

  // ── SÓ-SINALIZAR (auto off OU não passou nas travas): humano confere no /admin. ──
  await sendHuman(cleanPhone, [
    'Recebi seu comprovante! 🙌 Vou confirmar aqui e já te libero o acesso — qualquer coisa te aviso por aqui.',
  ], originInstance).catch(() => {});
  const status = passou
    ? `✅ Passou nas travas (recebedor Aioros · ${brl(valor)} · data ok). Pode liberar no /admin ("+ Pix").`
    : `⚠️ REVISAR — ${motivo}. Se ok, libera no /admin ("+ Pix").`;
  await notificarThiago({ email: user.email, phone: cleanPhone, valor, comprovante: c }, img, status);
  logger.info('pix-comprovante', `FLAG ${user.email} passou=${passou} motivo=${motivo}`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPROVANTE DE ABANDONO — pagante que ainda NÃO tem conta.
// O lead abandonou o checkout de cartão, recebeu a oferta de Pix e pagou. Ele manda
// o comprovante de um número que NÃO mapeia pra nenhum `users`. Aqui cruzamos o
// telefone com `abandoned_checkouts`, validamos o comprovante e CRIAMOS/ATIVAMOS a
// conta na hora (create-on-payment — não cria conta de não-pagante).
// ─────────────────────────────────────────────────────────────────────────────

// Casa o número inbound com uma linha recente de abandoned_checkouts pelos últimos
// 8 dígitos (evita o inferno de variações 55/9 entre Stripe e Z-API).
async function findAbandonoByPhone(cleanPhone: string) {
  const suffix = cleanPhone.replace(/\D/g, '').slice(-8);
  if (suffix.length < 8) return null;
  const since = new Date(Date.now() - 15 * 864e5).toISOString();
  const { data: rows } = await supabase
    .from('abandoned_checkouts')
    .select('id, email, phone, nome, plano, status')
    .eq('status', 'abandoned')
    .gte('created_at', since)
    .not('phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  const matches = (rows ?? []).filter(r => (r.phone || '').replace(/\D/g, '').slice(-8) === suffix);
  if (!matches.length) return null;
  // Colisão de sufixo entre PESSOAS diferentes (emails distintos) → não arrisca
  // criar/ativar a conta errada nem mandar o link de senha pro dono errado. Thiago trata.
  const emails = new Set(matches.map(m => (m.email || '').toLowerCase()).filter(Boolean));
  if (emails.size > 1) return null;
  return matches[0]; // 1 match, ou a mesma pessoa (pega o mais recente)
}

// Pega a conta pelo email OU cria uma PENDENTE (sem senha) — o cliente ativa pelo
// link "defina sua senha". Idempotente (email é UNIQUE; trata corrida 23505).
type PixUser = {
  id: string; email: string; password_hash: string | null; reset_token: string | null;
  billing_status: string | null; plano_expira_em: string | null;
};
const PIX_USER_COLS = 'id, email, password_hash, reset_token, billing_status, plano_expira_em';

async function getOrCreatePixUser(
  email: string, nome: string | null, phone: string,
): Promise<PixUser | null> {
  const emailLc = email.toLowerCase().trim();
  const { data: existing } = await supabase
    .from('users').select(PIX_USER_COLS).eq('email', emailLc).maybeSingle();
  if (existing) {
    if (phone) await supabase.from('users').update({ whatsapp: phone }).eq('id', existing.id);
    return existing as PixUser;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresIso = new Date(Date.now() + 30 * 864e5).toISOString();
  const { data: created, error } = await supabase
    .from('users')
    .insert({
      email: emailLc, password_hash: null, nome,
      plano: 'free', limite_documentos: 0, documentos_usados: 0,
      data_reset: expiresIso, whatsapp: phone, billing_status: 'free',
      reset_token: token, reset_token_expires: expiresIso,
    })
    .select(PIX_USER_COLS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const { data } = await supabase
        .from('users').select(PIX_USER_COLS).eq('email', emailLc).maybeSingle();
      return (data as PixUser) ?? null;
    }
    logger.error('pix-comprovante', `criar conta pendente Pix falhou (${emailLc})`, error);
    return null;
  }
  return created as PixUser;
}

// Chamado no inbound de número DESCONHECIDO com imagem. Retorna true se tratou.
export async function tryProcessAbandonedPixComprovante(
  cleanPhone: string, img: ImgSrc, originInstance: ZapiInstance = 'solardoc',
): Promise<boolean> {
  const ab = await findAbandonoByPhone(cleanPhone);
  if (!ab || !ab.email) return false; // não é lead de abandono conhecido → segue roteamento SDR

  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → segue fluxo

  const { passou, motivo, valor, dedupKey } = await validarComprovante(c, cleanPhone);
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

  if (passou && AUTO_LIBERAR) {
    // 1) Conta primeiro (idempotente por email UNIQUE). Se FALHAR (erro transitório de
    // DB), NÃO queima o dedup — tranquiliza o cliente e chama o Thiago, permitindo retry
    // no reenvio (senão o pagante ficaria preso em silêncio).
    const u = await getOrCreatePixUser(ab.email, ab.nome, cleanPhone);
    if (!u) {
      await sendHuman(cleanPhone, [
        'Recebi seu comprovante! 🙌 Tô confirmando aqui e já te libero — qualquer coisa te aviso por aqui.',
      ], originInstance).catch(() => {});
      await notificarThiago(
        { email: ab.email, phone: cleanPhone, valor, comprovante: c }, img,
        '⚠️ Comprovante Pix OK, mas FALHEI ao criar/achar a conta — libera manualmente no /admin ("+ Pix").',
      );
      logger.error('pix-comprovante', `abandono: getOrCreatePixUser falhou (${ab.email})`);
      return true;
    }

    // 2) Não mexer em conta que já é CARTÃO ativo (billing do Stripe). Pix tem plano_expira_em.
    const cartaoAtivo = (u.billing_status === 'active' || u.billing_status === 'trialing') && !u.plano_expira_em;
    if (cartaoAtivo) {
      await notificarThiago(
        { email: ab.email, phone: cleanPhone, valor, comprovante: c }, img,
        '⚠️ Comprovante Pix de conta com CARTÃO ATIVO — NÃO liberei (evita corromper o billing do Stripe). Confere.',
      );
      logger.info('pix-comprovante', `abandono: pulou liberação (cartão ativo) ${ab.email}`);
      return true;
    }

    // 3) Trava atômica IMEDIATAMENTE antes de liberar (a conta já existe/é idempotente).
    // Reenvio/corrida → 23505 → não libera de novo.
    const { error: dedupErr } = await supabase.from('system_state')
      .insert({ key: dedupKey, value: { abandoned_id: ab.id, user_id: u.id, valor, at: new Date().toISOString() } });
    if (dedupErr) {
      if ((dedupErr as { code?: string }).code === '23505') {
        logger.info('pix-comprovante', `dedup (abandono): já processado (${ab.email})`);
        return true;
      }
      logger.error('pix-comprovante', 'dedup insert falhou (abandono, segue)', dedupErr);
    }

    const alvo = PLANO_POR_VALOR[Math.round(valor)] ?? { plano: 'ilimitado', limite: 999999 };
    const venc = await liberarAcessoPix(u.id, u.plano_expira_em ?? null, alvo.plano, alvo.limite);
    // Se essa conta (por email) estava em dunning, cancela o cartão falhando no Stripe.
    await encerrarDunningPix(u.id, ab.email, u.billing_status);

    await supabase.from('abandoned_checkouts')
      .update({ status: 'recovered', recovered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', ab.id);

    const linhas = ['Pagamento confirmado! ✅ Seu acesso ao SolarDoc (plano completo) está *liberado* 🌞'];
    if (!u.password_hash && u.reset_token) {
      linhas.push(`Pra entrar, é só definir sua senha aqui: ${dashboardUrl}/auth?mode=redefinir&token=${u.reset_token}`);
    } else {
      linhas.push(`É só entrar em ${dashboardUrl} com seu email (${ab.email}). Qualquer dúvida, me chama! 🙌`);
    }
    await sendHuman(cleanPhone, linhas, originInstance).catch(() => {});

    await notificarThiago(
      { email: ab.email, phone: cleanPhone, valor, comprovante: c }, img,
      `✅ *AUTO-LIBERADO (abandono→Pix)* — vence ${venc.toLocaleDateString('pt-BR')}. Confere e arquiva.`,
    );
    logger.info('pix-comprovante', `AUTO-liberado (abandono) ${ab.email} ${brl(valor)}`);
    return true;
  }

  // Não passou / auto off → recebe, tranquiliza o cliente e sinaliza pro Thiago revisar.
  await sendHuman(cleanPhone, [
    'Recebi seu comprovante! 🙌 Vou confirmar aqui e já te libero o acesso — qualquer coisa te aviso por aqui.',
  ], originInstance).catch(() => {});
  await notificarThiago(
    { email: ab.email, phone: cleanPhone, valor, comprovante: c }, img,
    passou ? `✅ Passou nas travas (${brl(valor)}). Liberar no /admin ("+ Pix").`
           : `⚠️ REVISAR (abandono→Pix) — ${motivo}. Se ok, libera no /admin ("+ Pix").`,
  );
  logger.info('pix-comprovante', `FLAG (abandono) ${ab.email} passou=${passou} motivo=${motivo}`);
  return true;
}
