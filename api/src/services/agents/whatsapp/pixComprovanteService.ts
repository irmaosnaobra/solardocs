import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendWhatsApp, sendHuman, sendImage, sendDocument, ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { concederCursoPorAssinatura } from '../../kitIntegradorService';
import { novoAnthropic } from "../../../utils/anthropicClient";
import {
  lerPixSolicitado, guardarComprovantePendente, limparComprovantePendente, marcarAvisoFalhaPendente, PixSolicitado,
} from './pixSolicitado';

// ID de Pix de verdade (E2E do Bacen): "E" + ISPB de 8 dígitos + data-hora de 12
// dígitos. É a prova de que o comprovante é de um Pix, e não de um boleto, de um
// TED ou de uma imagem qualquer com o nome da empresa.
const RE_ID_PIX = /^E\d{20}/;

/**
 * Chave de trava do E2E: `pix_e2e:<21 primeiros caracteres>:<valor inteiro>`.
 * Usa só os 21 primeiros porque o leitor (visão) às vezes erra um caractere no
 * FIM do ID; o começo (ISPB + data-hora) sai igual nas duas leituras. Devolve
 * null quando não há ID de Pix legível: aí não existe chave pra gravar.
 */
export function chaveE2e(idTransacao: string | null | undefined, valor: number): string | null {
  const id = String(idTransacao ?? '').replace(/\s+/g, '');
  if (!RE_ID_PIX.test(id)) return null;
  return `pix_e2e:${id.slice(0, 21).toUpperCase()}:${Math.round(valor)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmação de Pix por COMPROVANTE (cliente SolarDoc).
// Fluxo: cartão falhou → oferecemos Pix (copia-e-cola R$67) → cliente paga e MANDA
// O COMPROVANTE no WhatsApp → a IA (visão) lê, valida (recebedor=Aioros + valor +
// data + dedup) e LIBERA na hora, orientando o cliente. O Thiago recebe no WhatsApp
// (34991360223) a confirmação + o ARQUIVO do comprovante encaminhado pra ele conferir
// depois e arquivar.
//
// Aceita PRINT/FOTO e PDF. O PDF entrou em 13/08/2026: é o formato que o banco
// exporta (Sicoob, Itaú, Nubank) e, enquanto só imagem era lida, quem pagava e
// mandava a prova em PDF ouvia "não analiso esse formato" e ficava sem acesso.
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

const anthropic = novoAnthropic();

// AUTO ligado por padrão; desliga com PIX_AUTO_LIBERAR=false (volta pro 1-clique do Thiago).
const AUTO_LIBERAR = (process.env.PIX_AUTO_LIBERAR ?? 'true').toLowerCase() !== 'false';
const THIAGO_PHONE = '34991360223';     // confirmação + comprovante vão pro WhatsApp do dono
const AIOROS_CNPJ  = '63636043000188';  // recebedor esperado (só dígitos)
// Valores EXATOS aceitos. 19 é a ENTRADA (curso + 30 dias de plataforma completa);
// 27/49/67 são os planos (PRO / VIP PROMO / VIP).
const PLANOS_VALIDOS = [19, 27, 49, 67];

/** Entrada de R$19: o curso é o produto, os 30 dias de VIP são a experiência. */
export const VALOR_ENTRADA_CURSO = 19;

// Valor pago → plano concedido. Os R$19 dão o MESMO acesso do VIP, mas por 30 dias
// e sem recorrência: é o "usa tudo por um mês e decide depois" — a assinatura
// (PRO ou VIP) só entra em cena no fim desses 30 dias.
export const PLANO_POR_VALOR: Record<number, { plano: string; limite: number }> = {
  19: { plano: 'ilimitado',  limite: 999999 },
  27: { plano: 'pro',        limite: 90 },
  49: { plano: 'ilimitado',  limite: 999999 },
  67: { plano: 'ilimitado',  limite: 999999 },
};

/** Chave que marca que este telefone JÁ usou a entrada de R$19 (é de primeira vez). */
const chaveEntrada = (identity: string) => `pix19_entrada:${identity.replace(/\D/g, '')}`;

// Assinante de CARTÃO — o único que o Pix não pode tocar (mexer no plano dele
// faria o guard de pix do stripeSync parar de reconciliar com a Stripe).
// Assinante de PIX também fica billing_status='active': a diferença é ter
// plano_expira_em setado, e por isso a renovação mensal por Pix segue passando.
//
// `plano !== 'free'` NÃO é detalhe: conta que cancelou continua com
// billing_status='active' e cai pro plano 'free'. Sem esta condição ela era lida
// como assinante de cartão e o comprovante nem chegava a ser lido — em 06/08/2026
// o Luiz pagou os R$19, ouviu "vou acionar o time" e ficou 5h sem acesso (liberado
// na mão). São 115 contas nesse estado: a base inteira que a oferta de R$19 chama
// de volta, ou seja, a auto-liberação nunca tinha rodado uma vez sequer.
export function ehCartaoAtivo(
  u: { plano?: string | null; billing_status?: string | null; plano_expira_em?: string | null } | null | undefined,
): boolean {
  if (!u || !u.plano || u.plano === 'free') return false;
  return (u.billing_status === 'active' || u.billing_status === 'trialing') && !u.plano_expira_em;
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

// Comprovante chega como IMAGEM (print/foto) ou como PDF (o que o banco exporta:
// Sicoob, Itaú, Nubank…). Os dois entram aqui — o formato só muda o tipo do bloco
// que vai pra IA e o endpoint que encaminha pro Thiago.
type ImgSrc = { type: 'base64'; media_type: any; data: string };
export type ComprovanteSrc = ImgSrc;

const ehPdf = (m: ImgSrc) => String(m.media_type) === 'application/pdf';

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
    // PDF vai como bloco `document` (a Anthropic renderiza a página e lê texto +
    // imagem); print/foto vai como `image`. Mesmo prompt nos dois.
    const anexo: any = ehPdf(img)
      ? { type: 'document', source: img }
      : { type: 'image', source: img };
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          anexo,
          { type: 'text', text: [
            'Este arquivo é um COMPROVANTE de pagamento Pix ou transferência bancária?',
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
//
// Exportada para teste: é a função que decide se dinheiro vira acesso. Testá-la
// direto evita ter que simular a IA de visão só pra exercitar as travas.
export async function validarComprovante(
  c: Comprovante, identity: string, opts: { exigirIdPix?: boolean } = {},
): Promise<{ passou: boolean; motivo: string; valor: number; dedupKey: string; e2eKey: string | null; jaUsado: 'telefone' | 'e2e' | null }> {
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

  // Trava da ENTRADA: os R$19 são oferta de primeira vez. Sem isto o dedup (que é
  // por telefone+valor+DATA) deixaria a pessoa pagar R$19 todo mês por Pix e nunca
  // assinar — R$19 recorrente no lugar de R$67. Repetição não auto-liberamos: cai
  // no aviso ao Thiago, que decide caso a caso.
  let entradaRepetida = false;
  if (Math.round(valor) === VALOR_ENTRADA_CURSO) {
    const { data: entrada } = await supabase
      .from('system_state').select('key').eq('key', chaveEntrada(identity)).limit(1);
    entradaRepetida = !!entrada?.length;
  }

  // Regra EXTRA do número desconhecido (sem conta, sem checkout, sem Pix pedido):
  // exige prova de Pix, e o mesmo Pix não vale duas vezes mesmo vindo de OUTRO
  // telefone (o dedupKey é por telefone, então sozinho não pega esse reenvio).
  const e2eKey = chaveE2e(c.id_transacao, valor);
  let semIdPix = false;
  let e2eUsado = false;
  if (opts.exigirIdPix) {
    semIdPix = !e2eKey;
    if (e2eKey) {
      const { data: e2e } = await supabase.from('system_state').select('key').eq('key', e2eKey).limit(1);
      e2eUsado = !!e2e?.length;
    }
  }

  const passou = recebedorOk && valorOk && dataOk && !(usado?.length) && !entradaRepetida && !semIdPix && !e2eUsado;

  const motivo = usado?.length ? 'comprovante já usado antes (reenvio?)'
    : e2eUsado ? 'este Pix (ID) já foi usado antes, em outro telefone ou data'
    : !recebedorOk ? 'recebedor NÃO parece ser a Aioros'
    : !valorOk ? 'valor não bate com plano (19/27/49/67)'
    : !dataOk ? 'data ausente ou fora da janela'
    : entradaRepetida ? 'entrada de R$19 já usada por este número (é oferta de primeira vez)'
    : semIdPix ? 'sem ID de Pix'
    : 'ok';
  // Reenvio de comprovante JÁ liberado: quem chama não responde nada e não deixa a imagem seguir.
  const jaUsado = usado?.length ? 'telefone' as const : e2eUsado ? 'e2e' as const : null;
  return { passou, motivo, valor, dedupKey, e2eKey, jaUsado };
}

// Empurra plano_expira_em +1 mês (base = vencimento atual se ainda no futuro, senão agora).
// Exportada para teste: é aqui que o pagamento vira acesso + curso.
export async function liberarAcessoPix(
  userId: string, planoExpiraEmAtual: string | null, plano: string, limite: number,
): Promise<Date> {
  const now = Date.now();
  const base = (planoExpiraEmAtual && new Date(planoExpiraEmAtual).getTime() > now)
    ? new Date(planoExpiraEmAtual) : new Date(now);
  base.setMonth(base.getMonth() + 1);
  await supabase.from('users').update({
    plano, limite_documentos: limite, documentos_usados: 0, billing_status: 'active', plano_expira_em: base.toISOString(),
  }).eq('id', userId);

  // Acesso completo por Pix → o curso entra junto. Vale para os DOIS casos:
  // a entrada de R$19 (onde o curso é o produto principal) e a reativação de
  // R$67. Sem isto a Giovanna prometeria o curso e o sistema não entregaria —
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
  // Encaminha o arquivo (data URI base64) pra ele arquivar/conferir. PDF do banco
  // vai por send-document; print/foto por send-image.
  try {
    const dataUri = `data:${img.media_type};base64,${img.data}`;
    if (ehPdf(img)) {
      await sendDocument(THIAGO_PHONE, dataUri, `comprovante-${email}.pdf`, `Comprovante de ${email}`, 'solardoc');
    } else {
      await sendImage(THIAGO_PHONE, dataUri, `Comprovante de ${email}`, 'solardoc');
    }
  } catch (err) {
    logger.error('pix-comprovante', 'encaminhar comprovante pro Thiago falhou', err);
  }
}

// Grava a trava do E2E (`pix_e2e:`). true = JÁ existia (o mesmo Pix voltou, de
// outro telefone ou relido): quem chama NÃO libera. Sem ID de Pix legível não há
// chave e a função devolve false (os ramos antigos seguem só com o dedupKey).
async function e2eJaUsado(e2eKey: string | null, valor: number, userId: string): Promise<boolean> {
  if (!e2eKey) return false;
  const { error } = await supabase.from('system_state')
    .insert({ key: e2eKey, value: { user_id: userId, valor, at: new Date().toISOString() } });
  if (!error) return false;
  if ((error as { code?: string }).code === '23505') return true;
  logger.error('pix-comprovante', 'trava do E2E não gravou (segue liberação)', error);
  return false;
}

// Queima a entrada de R$19 (oferta de primeira vez). Falha grita no log, não bloqueia.
async function queimarEntrada(cleanPhone: string, userId: string, email: string, venc: Date): Promise<void> {
  const { error } = await supabase.from('system_state').insert({
    key: chaveEntrada(cleanPhone),
    value: { user_id: userId, email, at: new Date().toISOString(), vence: venc.toISOString() },
  });
  if (error) {
    logger.error('pix-comprovante',
      `ENTRADA R$19 NÃO MARCADA (${email}) — a trava de uma-vez-só não vai pegar neste número`, error);
  }
}

// Data em horário de Brasília (a máquina roda em UTC) como dd/mm.
const diaMes = (d: Date) => d.toLocaleDateString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
});
const valorBr = (v: number) => v.toFixed(2).replace('.', ',');

/** Razão social da conta (tabela company, ligada por user_id). Sem ela, null. */
async function razaoSocialDe(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('company').select('nome').eq('user_id', userId).limit(1).maybeSingle();
    const nome = String((data as { nome?: string } | null)?.nome ?? '').trim();
    return nome || null;
  } catch {
    return null;
  }
}

/**
 * Texto da confirmação do Pix liberado por e-mail. Uma bolha só.
 * `linkSenha` só vem preenchido quando a conta foi criada AGORA, na mesma chamada:
 * link de definir senha pra conta que já existia é entregar a conta de uma pessoa
 * a quem digitou o e-mail dela.
 */
function textoConfirmacao(a: {
  valor: number; plano: string; venc: Date; email: string; razao: string | null; linkSenha: string | null;
}): string {
  const rotulo = a.plano === 'ilimitado' ? 'Ilimitado' : a.plano.toUpperCase();
  const inicio = `Pronto. Recebi seu Pix de R$ ${valorBr(a.valor)} e liberei o plano ${rotulo} até ${diaMes(a.venc)}`;
  if (a.linkSenha) {
    return `${inicio} na conta ${a.email}. Pra entrar, defina sua senha aqui: ${a.linkSenha}`;
  }
  const conta = `${inicio} na conta ${a.email}${a.razao ? `, da ${a.razao}` : ''}.`;
  return `${conta} É só entrar em solardoc.app com o seu e-mail e a sua senha. Se não lembrar a senha, use "Esqueci minha senha" na tela de entrada.`;
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
    .select('plano, billing_status, plano_expira_em, password_hash, reset_token')
    .eq('id', user.id)
    .single();
  if (ehCartaoAtivo(uRow)) return false;

  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → fluxo normal

  const { passou, motivo, valor, dedupKey, e2eKey } = await validarComprovante(c, cleanPhone);
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
    // Mesmo Pix (E2E) já usado, por outro telefone? Não libera de novo.
    if (await e2eJaUsado(e2eKey, valor, user.id)) {
      logger.info('pix-comprovante', `dedup E2E: Pix já usado (${user.email})`);
      return true;
    }

    const alvo = PLANO_POR_VALOR[Math.round(valor)] ?? { plano: 'ilimitado', limite: 999999 };
    const venc = await liberarAcessoPix(user.id, uRow?.plano_expira_em ?? null, alvo.plano, alvo.limite);
    // Estava em dunning? cancela o cartão falhando no Stripe (evita cobrança dupla).
    await encerrarDunningPix(user.id, user.email, uRow?.billing_status);

    // Queima a entrada de R$19: a partir daqui, outro Pix de R$19 deste número não
    // auto-libera (vira aviso pro Thiago). É o que impede a oferta de primeira vez
    // de virar mensalidade de R$19 no lugar da assinatura.
    const eEntrada = Math.round(valor) === VALOR_ENTRADA_CURSO;
    if (eEntrada) {
      // Falha aqui NÃO pode ser silenciosa: se o marcador não grava, a trava da
      // entrada nunca dispara e a pessoa segue pagando R$19 por mês no lugar de
      // assinar. Não bloqueia a liberação (ele já pagou), mas grita no log.
      const { error: marcaErr } = await supabase.from('system_state').insert({
        key: chaveEntrada(cleanPhone),
        value: { user_id: user.id, email: user.email, at: new Date().toISOString(), vence: venc.toISOString() },
      });
      if (marcaErr) {
        logger.error(
          'pix-comprovante',
          `ENTRADA R$19 NÃO MARCADA (${user.email}) — a trava de uma-vez-só não vai pegar neste número`,
          marcaErr,
        );
      }
    }

    // Orienta o cliente. Conta pendente (pagou no abandono, sem senha) → link pra definir senha.
    const pendente = !uRow?.password_hash;
    // Na entrada, o que ele comprou foi o CURSO — os 30 dias de plataforma são a
    // experiência. A mensagem diz as duas coisas e já planta a decisão do dia 30,
    // sem cobrar nada agora: é assim que a oferta foi vendida no WhatsApp.
    const linhas = eEntrada
      ? [
          'Pagamento confirmado! ✅ Seu *Kit de Fechamento* está liberado 🎓',
          `E já deixei a plataforma COMPLETA aberta pra você até ${venc.toLocaleDateString('pt-BR')} — documentos ilimitados, proposta com payback, contrato com a sua marca. Usa tudo sem compromisso; lá no fim a gente conversa se vale continuar. 🌞`,
        ]
      : ['Pagamento confirmado! ✅ Seu acesso ao SolarDoc está *liberado* 🌞'];
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
  plano: string | null; billing_status: string | null; plano_expira_em: string | null;
};
const PIX_USER_COLS = 'id, email, password_hash, reset_token, plano, billing_status, plano_expira_em';

type PixUserResult = PixUser & { criadaAgora: boolean };

// Variantes BR do telefone (com/sem 55, com/sem o 9º dígito). Copiada de
// `variantesBR` do whatsappAgentService de propósito: importar aquele arquivo
// aqui cria ciclo (ele importa este de forma dinâmica) e quebra o require em CJS.
function variantesTelefone(phone: string): string[] {
  const limpo = (phone || '').replace('@c.us', '').replace(/\D/g, '');
  if (!limpo) return [];
  const c55 = limpo.startsWith('55') ? limpo : `55${limpo}`;
  const com9 = c55.length === 12 ? c55.slice(0, 4) + '9' + c55.slice(4) : c55;
  const sem9 = c55.length === 13 && c55[4] === '9' ? c55.slice(0, 4) + c55.slice(5) : c55;
  return Array.from(new Set([limpo, c55, com9, sem9, c55.replace(/^55/, ''), com9.replace(/^55/, ''), sem9.replace(/^55/, '')].filter(Boolean)));
}

// Formato gravado em users.whatsapp: DDD + número, sem o 55.
const whatsappSemDDI = (phone: string) => {
  const d = (phone || '').replace(/\D/g, '');
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
};

// Grava o WhatsApp na conta SÓ se ela não tem um e NENHUMA outra conta usa este
// telefone. Sobrescrever era a brecha: quem digitava o e-mail de outra pessoa
// passava a ser "o telefone dela" e a Giovanna, que altera cadastro pelo telefone
// da conta, passava a obedecê-lo.
async function gravarWhatsappSeLivre(userId: string, atual: string | null | undefined, phone: string): Promise<void> {
  if (atual || !phone) return;
  try {
    const { data: outros } = await supabase
      .from('users').select('id').in('whatsapp', variantesTelefone(phone)).neq('id', userId).limit(1);
    if (outros?.length) return;
    await supabase.from('users').update({ whatsapp: whatsappSemDDI(phone) }).eq('id', userId);
  } catch (err) {
    logger.error('pix-comprovante', 'gravar whatsapp na conta falhou (segue)', err);
  }
}

async function getOrCreatePixUser(
  email: string, nome: string | null, phone: string,
  opts: { whatsappSoSeLivre?: boolean } = {},
): Promise<PixUserResult | null> {
  const emailLc = email.toLowerCase().trim();
  const { data: existing } = await supabase
    .from('users').select(`${PIX_USER_COLS}, whatsapp`).eq('email', emailLc).maybeSingle();
  if (existing) {
    if (opts.whatsappSoSeLivre) {
      await gravarWhatsappSeLivre(existing.id, (existing as { whatsapp?: string | null }).whatsapp, phone);
    } else if (phone) {
      await supabase.from('users').update({ whatsapp: phone }).eq('id', existing.id);
    }
    return { ...(existing as PixUser), criadaAgora: false };
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
      // Corrida: outra chamada criou a conta no meio. Aqui ela JÁ existia pra nós.
      const { data } = await supabase
        .from('users').select(PIX_USER_COLS).eq('email', emailLc).maybeSingle();
      return data ? { ...(data as PixUser), criadaAgora: false } : null;
    }
    logger.error('pix-comprovante', `criar conta pendente Pix falhou (${emailLc})`, error);
    return null;
  }
  return { ...(created as PixUser), criadaAgora: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// O e-mail chegou DEPOIS do comprovante (ordem mais comum: manda a foto, depois
// o e-mail). Libera com o comprovante que ficou guardado. Chamado pela Giovanna
// assim que ela captura um e-mail de quem tem Pix pendente.
// Retorna a data de vencimento quando liberou; null quando não havia o que fazer.
// ─────────────────────────────────────────────────────────────────────────────
export async function liberarComprovantePendente(
  cleanPhone: string, email: string, nome: string | null, originInstance: ZapiInstance = 'solardoc',
): Promise<Date | null> {
  const reg = await lerPixSolicitado(cleanPhone);
  const pend = reg?.comprovante;
  if (!pend) return null;

  // Não passou nas travas → quem decide é o Thiago (mesma regra do fluxo normal).
  if (!pend.passou || !AUTO_LIBERAR) {
    await sendWhatsApp(THIAGO_PHONE,
      `*Pix pendente com e-mail agora* — ${email} (${cleanPhone}) · ${brl(pend.valor)}. O comprovante não passou nas travas automáticas: confere e libera no /admin ("+ Pix").`,
      'solardoc').catch(() => {});
    await limparComprovantePendente(cleanPhone);
    return null;
  }

  // whatsappSoSeLivre: o e-mail veio digitado na conversa, de quem quer que seja.
  const u = await getOrCreatePixUser(email, nome ?? reg?.nome ?? null, cleanPhone, { whatsappSoSeLivre: true });
  if (!u) {
    // Avisa UMA vez: o pendente fica (nova tentativa pode funcionar), mas o Thiago
    // não recebe o mesmo alerta a cada mensagem do cliente.
    if (!pend.avisadoFalha) {
      await sendWhatsApp(THIAGO_PHONE,
        `⚠️ *Pix pendente*: ${email} mandou o e-mail mas FALHEI ao criar a conta. Libera no /admin ("+ Pix").`,
        'solardoc').catch(() => {});
      await marcarAvisoFalhaPendente(cleanPhone).catch(() => {});
    }
    return null;
  }
  if (ehCartaoAtivo(u)) {
    await sendWhatsApp(THIAGO_PHONE,
      `⚠️ *Pix pendente*: ${email} tem CARTÃO ATIVO — não liberei (evita corromper o billing). Confere.`,
      'solardoc').catch(() => {});
    await limparComprovantePendente(cleanPhone);
    return null;
  }

  // Mesma trava atômica do fluxo normal: dedupKey do comprovante, insert → 23505
  // significa que já foi liberado (reenvio, ou o e-mail chegou duas vezes).
  const { error: dedupErr } = await supabase.from('system_state')
    .insert({ key: pend.dedupKey, value: { user_id: u.id, valor: pend.valor, at: new Date().toISOString(), via: 'email-depois' } });
  if (dedupErr && (dedupErr as { code?: string }).code === '23505') {
    await limparComprovantePendente(cleanPhone);
    logger.info('pix-comprovante', `pendente já liberado antes (${email})`);
    return null;
  }
  // E a trava do E2E: o mesmo Pix não vira dois meses, nem por outro telefone.
  if (await e2eJaUsado(pend.e2eKey ?? null, pend.valor, u.id)) {
    await limparComprovantePendente(cleanPhone);
    logger.info('pix-comprovante', `pendente: Pix (E2E) já usado antes (${email})`);
    return null;
  }

  const alvo = PLANO_POR_VALOR[Math.round(pend.valor)] ?? { plano: 'ilimitado', limite: 999999 };
  const venc = await liberarAcessoPix(u.id, u.plano_expira_em ?? null, alvo.plano, alvo.limite);
  await encerrarDunningPix(u.id, email, u.billing_status);
  if (Math.round(pend.valor) === VALOR_ENTRADA_CURSO) await queimarEntrada(cleanPhone, u.id, email, venc);
  await limparComprovantePendente(cleanPhone);

  // Link de definir senha SÓ pra conta criada agora, nesta chamada.
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
  const linkSenha = u.criadaAgora && u.reset_token
    ? `${dashboardUrl}/auth?mode=redefinir&token=${u.reset_token}` : null;
  const razao = u.criadaAgora ? null : await razaoSocialDe(u.id);
  await sendHuman(cleanPhone, [
    textoConfirmacao({ valor: pend.valor, plano: alvo.plano, venc, email: u.email || email, razao, linkSenha }),
  ], originInstance, { maxBolhas: 1 }).catch(() => {});

  await sendWhatsApp(THIAGO_PHONE,
    `✅ *AUTO-LIBERADO (Pix + e-mail depois)* — ${email} · ${brl(pend.valor)} · vence ${diaMes(venc)}.`,
    'solardoc').catch(() => {});
  logger.info('pix-comprovante', `AUTO-liberado (e-mail depois) ${email} ${brl(pend.valor)}`);
  return venc;
}

// ─────────────────────────────────────────────────────────────────────────────
// NÚMERO DESCONHECIDO, SEM CHECKOUT E SEM PIX PEDIDO (a linha IO, principalmente).
// O cliente paga e manda o comprovante de um número que não está em users.whatsapp
// e que nenhum fluxo nosso conhece. Antes caía na agente como foto comum, sem
// resposta. Agora: lê, confere que o dinheiro foi pra nós e libera o mês.
//
// É o ramo mais exposto do arquivo (ninguém nos apresentou esta pessoa), então tem
// uma trava a mais: o comprovante precisa trazer ID de Pix. Reprovado NÃO responde
// nada ao cliente: o robô não faz papel de fiscal de quem mandou foto qualquer.
// ─────────────────────────────────────────────────────────────────────────────

const RE_EMAIL_G = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const emailsDe = (t: string | null | undefined): string[] =>
  (String(t ?? '').match(RE_EMAIL_G) ?? []).map(e => e.toLowerCase().trim());

// ilike sem curinga: `_` e `%` são comuns em e-mail e casariam a conta errada.
const escapaIlike = (v: string) => v.replace(/[\\%_]/g, m => `\\${m}`);

type ContaAchada = PixUser & { nome?: string | null; whatsapp?: string | null };

/**
 * Acha a conta pelo e-mail que a pessoa digitou NESTA conversa: na legenda da foto
 * ou nas mensagens recebidas dela nos últimos 7 dias. Só vale quando há exatamente
 * uma conta. Dois e-mails de contas diferentes = ambíguo = sem conta (pede o e-mail).
 */
async function acharContaPelaConversa(cleanPhone: string, texto: string): Promise<ContaAchada | null> {
  const emails = new Set<string>(emailsDe(texto));
  try {
    const desde = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data: msgs } = await supabase
      .from('wa_mensagens').select('texto, tipo')
      .in('telefone', variantesTelefone(cleanPhone))
      .eq('from_me', false)
      .gte('momment', desde)
      .order('momment', { ascending: false })
      .limit(100);
    for (const m of (msgs ?? []) as Array<{ texto?: string | null }>) {
      for (const e of emailsDe(m.texto)) emails.add(e);
    }
  } catch (err) {
    logger.error('pix-comprovante', 'ler conversa pra achar e-mail falhou (segue sem)', err);
  }
  if (!emails.size) return null;

  const contas = new Map<string, ContaAchada>();
  for (const e of Array.from(emails).slice(0, 8)) {
    const { data } = await supabase
      .from('users').select(`${PIX_USER_COLS}, nome, whatsapp`).ilike('email', escapaIlike(e)).limit(2);
    for (const u of (data ?? []) as ContaAchada[]) contas.set(u.id, u);
  }
  return contas.size === 1 ? Array.from(contas.values())[0]! : null;
}

// Legenda que o sistema mesmo põe quando a foto/PDF chega sem texto. Fora isso, a
// pessoa escreveu algo (uma pergunta?) e o fluxo normal precisa responder.
const LEGENDAS_PADRAO = new Set(['', '[imagem]', 'o cliente enviou esta imagem.', 'o cliente enviou um arquivo pdf.']);
const legendaVazia = (t: string) => LEGENDAS_PADRAO.has(String(t ?? '').trim().toLowerCase());

async function processarComprovanteDesconhecido(
  cleanPhone: string, img: ImgSrc, originInstance: ZapiInstance, texto: string,
  solicitado: PixSolicitado | null = null,
): Promise<boolean> {
  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → segue fluxo, sem enviar nada

  const v = await validarComprovante(c, cleanPhone, { exigirIdPix: true });
  const conta = await acharContaPelaConversa(cleanPhone, texto);

  if (!v.passou || !AUTO_LIBERAR) {
    // Silêncio com o cliente. O Thiago só é avisado quando a conversa já aponta uma
    // conta SolarDoc de verdade (aí é cliente nosso, com dinheiro possivelmente pago).
    // Reenvio do MESMO comprovante já liberado neste telefone: nada a dizer, e a
    // imagem não segue pra Carla logo depois da confirmação.
    // Só cala quando a foto veio sem legenda; com pergunta, o fluxo normal responde.
    if (v.jaUsado === 'telefone') {
      logger.info('pix-comprovante', `desconhecido: reenvio de comprovante já usado (${cleanPhone})`);
      return legendaVazia(texto);
    }
    if (conta) {
      await notificarThiago(
        { email: conta.email, phone: cleanPhone, valor: v.valor, comprovante: c }, img,
        `⚠️ REVISAR (número desconhecido) — ${v.passou ? 'liberação automática desligada' : v.motivo}. Se ok, libera no /admin ("+ Pix").`,
      );
    }
    logger.info('pix-comprovante', `desconhecido: reprovado (${cleanPhone}) motivo=${v.passou ? 'auto desligado' : v.motivo}`);
    // O mesmo Pix (ID) vindo de OUTRO telefone: também não segue pra Carla.
    return v.jaUsado === 'e2e' && legendaVazia(texto);
  }

  // ── Aprovado, mas sem conta: guarda e pede o e-mail, UMA vez por comprovante ──
  if (!conta) {
    const pend = solicitado?.comprovante ?? null;
    if (pend) {
      // Já há comprovante esperando o e-mail deste número. NÃO sobrescreve (perderia o
      // e-mail da trava de ID do primeiro) e não pede de novo. Mesmo comprovante:
      // silêncio. Outro comprovante: o Thiago decide, uma vez.
      if (pend.dedupKey !== v.dedupKey) {
        await notificarThiago(
          { email: '(aguardando o e-mail do cliente)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
          `⚠️ SEGUNDO comprovante Pix (${brl(v.valor)}) de número que já tem outro esperando o e-mail. Não guardei: confere e libera no /admin ("+ Pix") se for pagamento novo.`,
        );
      }
      return true;
    }
    await guardarComprovantePendente(cleanPhone, {
      valor: v.valor, dedupKey: v.dedupKey, passou: true, em: new Date().toISOString(), e2eKey: v.e2eKey,
    }, { origem: 'desconhecido' });
    const { error: jaPediu } = await supabase.from('system_state').insert({
      key: `pix_pediu_email:${v.dedupKey}`, value: { at: new Date().toISOString() },
    });
    if (jaPediu) {
      // 23505 = outra execução já pediu: não repete. Qualquer outro erro: pede mesmo
      // assim (melhor repetir o pedido do que deixar quem pagou no silêncio).
      if ((jaPediu as { code?: string }).code === '23505') return true;
      logger.error('pix-comprovante', 'marca do pedido de e-mail não gravou (pede mesmo assim)', jaPediu);
    }
    // Avisa o Thiago UMA vez: dinheiro entrou e a conta ainda não é conhecida.
    await notificarThiago(
      { email: '(aguardando o e-mail do cliente)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
      `⚠️ Pix válido (${brl(v.valor)}) de número desconhecido, SEM e-mail de conta. Pedi o e-mail; libero sozinho quando ele mandar. Se ele sumir, libera no /admin ("+ Pix").`,
    );
    await sendHuman(cleanPhone, [
      `Recebi seu comprovante de R$ ${valorBr(v.valor)}. Qual o e-mail da sua conta no SolarDoc? Assim que você mandar, eu libero na hora.`,
    ], originInstance, { maxBolhas: 1 }).catch(() => {});
    logger.info('pix-comprovante', `desconhecido: comprovante guardado, e-mail pedido (${cleanPhone})`);
    return true;
  }

  // ── Aprovado, com conta ──
  if (ehCartaoAtivo(conta)) {
    await notificarThiago(
      { email: conta.email, phone: cleanPhone, valor: v.valor, comprovante: c }, img,
      '⚠️ Comprovante Pix de conta com CARTÃO ATIVO (número desconhecido) — NÃO liberei (evita corromper o billing do Stripe). Confere.',
    );
    return true;
  }

  // Trava atômica ANTES de liberar: o comprovante do telefone e o Pix pelo ID.
  const { error: dedupErr } = await supabase.from('system_state').insert({
    key: v.dedupKey, value: { user_id: conta.id, valor: v.valor, data: c.data, at: new Date().toISOString(), via: 'desconhecido' },
  });
  if (dedupErr) {
    if ((dedupErr as { code?: string }).code === '23505') {
      logger.info('pix-comprovante', `desconhecido: já processado (${conta.email})`);
      return true;
    }
    logger.error('pix-comprovante', 'dedup insert falhou (desconhecido, segue)', dedupErr);
  }
  if (await e2eJaUsado(v.e2eKey, v.valor, conta.id)) {
    logger.info('pix-comprovante', `desconhecido: Pix (E2E) já usado (${conta.email})`);
    return true;
  }

  const alvo = PLANO_POR_VALOR[Math.round(v.valor)] ?? { plano: 'ilimitado', limite: 999999 };
  const venc = await liberarAcessoPix(conta.id, conta.plano_expira_em ?? null, alvo.plano, alvo.limite);
  await encerrarDunningPix(conta.id, conta.email, conta.billing_status);
  if (Math.round(v.valor) === VALOR_ENTRADA_CURSO) await queimarEntrada(cleanPhone, conta.id, conta.email, venc);
  await gravarWhatsappSeLivre(conta.id, conta.whatsapp, cleanPhone);
  // Se havia um pendente do mesmo comprovante (a conta só apareceu agora), consome.
  if (solicitado?.comprovante?.dedupKey === v.dedupKey) await limparComprovantePendente(cleanPhone);

  await notificarThiago(
    { email: conta.email, phone: cleanPhone, valor: v.valor, comprovante: c }, img,
    `✅ *AUTO-LIBERADO (número desconhecido + e-mail da conversa)* — vence ${diaMes(venc)}. Confere e arquiva o comprovante.`,
  );
  const razao = await razaoSocialDe(conta.id);
  // Conta que já existia: NUNCA manda link de senha. Quem digitou o e-mail pode
  // não ser o dono dele.
  await sendHuman(cleanPhone, [
    textoConfirmacao({ valor: v.valor, plano: alvo.plano, venc, email: conta.email, razao, linkSenha: null }),
  ], originInstance, { maxBolhas: 1 }).catch(() => {});
  logger.info('pix-comprovante', `AUTO-liberado (desconhecido) ${conta.email} ${brl(v.valor)}`);
  return true;
}

// Chamado no inbound de número DESCONHECIDO com imagem. Retorna true se tratou.
// `texto` = legenda da mensagem (pode trazer o e-mail da conta).
export async function tryProcessAbandonedPixComprovante(
  cleanPhone: string, img: ImgSrc, originInstance: ZapiInstance = 'solardoc', texto = '',
): Promise<boolean> {
  const abRow = await findAbandonoByPhone(cleanPhone);
  // Segunda fonte de e-mail: o Pix que a Giovanna mandou a pedido do cliente,
  // com o e-mail que ELE informou na conversa. Sem isto, quem não veio de
  // checkout abandonado (anúncio, indicação, Instagram) pagava e ficava no limbo
  // — era o buraco que o "sempre peça o e-mail" veio tapar.
  const solicitado = await lerPixSolicitado(cleanPhone);
  const email = abRow?.email ?? solicitado?.email ?? null;

  // Nem abandono nem Pix pendente: ramo do número desconhecido (lê, confere e libera
  // sozinho, ou segue o roteamento normal sem dizer nada).
  // Registro que nasceu de um comprovante desconhecido continua no mesmo ramo: a
  // imagem seguinte tem que passar pela trava de ID de Pix, não pelo ramo antigo.
  if (!abRow && (!solicitado || solicitado.origem === 'desconhecido')) {
    return processarComprovanteDesconhecido(cleanPhone, img, originInstance, texto, solicitado);
  }

  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → segue fluxo

  // Pagou, mas ainda não sabemos o e-mail: NÃO adivinha conta. Guarda o
  // comprovante já validado, pede o e-mail (é uma bolha) e avisa o Thiago. Quando
  // o e-mail chegar, liberarComprovantePendente() solta o acesso sozinho.
  if (!email) {
    const v = await validarComprovante(c, cleanPhone);
    await guardarComprovantePendente(cleanPhone, {
      valor: v.valor, dedupKey: v.dedupKey, passou: v.passou, em: new Date().toISOString(), e2eKey: v.e2eKey,
    });
    await sendHuman(cleanPhone, [
      'Recebi seu comprovante, obrigada! 🙌',
      'Me manda só o *e-mail* que você usa (ou vai usar) no SolarDoc? É com ele que eu libero seu acesso.',
    ], originInstance).catch(() => {});
    await notificarThiago(
      { email: '(aguardando o e-mail do cliente)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
      `⚠️ Comprovante Pix SEM E-MAIL (${brl(v.valor)}) — pedi o e-mail; libero sozinho quando ele mandar. Se ele sumir, libera no /admin ("+ Pix").`,
    );
    logger.info('pix-comprovante', `comprovante sem e-mail (${cleanPhone}) — e-mail solicitado`);
    return true;
  }

  // Daqui pra baixo o fluxo é o mesmo dos dois caminhos: existe um e-mail e ele
  // manda na liberação. `ab` mantém a forma que o resto da função já esperava.
  const ab = abRow ?? { id: null as string | null, email, nome: solicitado?.nome ?? null };

  const { passou, motivo, valor, dedupKey, e2eKey } = await validarComprovante(c, cleanPhone);
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

  if (passou && AUTO_LIBERAR) {
    // 1) Conta primeiro (idempotente por email UNIQUE). Se FALHAR (erro transitório de
    // DB), NÃO queima o dedup — tranquiliza o cliente e chama o Thiago, permitindo retry
    // no reenvio (senão o pagante ficaria preso em silêncio).
    // Sem linha de abandono, o e-mail veio DIGITADO na conversa (de quem quer que
    // seja): não toma o WhatsApp da conta e não ganha link de senha de conta velha.
    const u = await getOrCreatePixUser(ab.email, ab.nome, cleanPhone, { whatsappSoSeLivre: !abRow });
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
    if (ehCartaoAtivo(u)) {
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
    if (await e2eJaUsado(e2eKey, valor, u.id)) {
      logger.info('pix-comprovante', `dedup E2E (abandono): Pix já usado (${ab.email})`);
      return true;
    }

    const alvo = PLANO_POR_VALOR[Math.round(valor)] ?? { plano: 'ilimitado', limite: 999999 };
    const venc = await liberarAcessoPix(u.id, u.plano_expira_em ?? null, alvo.plano, alvo.limite);
    // Se essa conta (por email) estava em dunning, cancela o cartão falhando no Stripe.
    await encerrarDunningPix(u.id, ab.email, u.billing_status);

    // Só quem veio de abandono tem linha pra marcar como recuperada.
    if (ab.id) {
      await supabase.from('abandoned_checkouts')
        .update({ status: 'recovered', recovered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', ab.id);
    }

    const linhas = ['Pagamento confirmado! ✅ Seu acesso ao SolarDoc (plano completo) está *liberado* 🌞'];
    const mandaLink = abRow ? !u.password_hash : u.criadaAgora;
    if (mandaLink && u.reset_token) {
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
