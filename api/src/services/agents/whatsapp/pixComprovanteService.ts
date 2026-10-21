import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendWhatsApp, sendHuman, sendImage, sendDocument, ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { gerarPixCopiaECola } from '../../../utils/pixBrCode';
import { concederCursoPorAssinatura } from '../../kitIntegradorService';
import { novoAnthropic } from "../../../utils/anthropicClient";
import { hmacDe, idChaveHmac } from '../../agentes5040/hmac';
import {
  lerPixSolicitado, guardarComprovantePendente, limparComprovantePendente, marcarAvisoFalhaPendente, PixSolicitado, chaveTelefone,
} from './pixSolicitado';
import { guardarHandoffComprovante, apagarHandoffComprovante, HandoffComprovante, CodigoMotivo } from './comprovanteHandoff';

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

// REGRA DE 20/10/2026 (dono): quem renova no Pix paga R$ 67,00. Comprovante com data
// ANTERIOR ao corte segue a tabela antiga (27, 49 e 67), então o Pix de R$ 27 de 19/10
// continua valendo PRO. A partir do corte: 67 ou mais libera 1 mês ilimitado; menos que
// isso é PAGAMENTO PARCIAL (vira crédito, e o cliente é avisado do que falta). A única
// exceção é a entrada de R$ 19 de primeira vez.
export const DATA_CORTE_PIX_67 = '2026-10-20';
export const VALOR_RENOVACAO_PIX = 67;
const CENT_RENOVACAO = VALOR_RENOVACAO_PIX * 100;
/** Dinheiro SEMPRE em centavos inteiros nas contas (soma de parciais e restante). */
const emCentavos = (v: number) => Math.round(v * 100);

export type ModoPagamento = 'tabela' | 'entrada' | 'cheio' | 'parcial';

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

// ─────────────────────────────────────────────────────────────────────────────
// O MESMO código de transação não libera duas vezes (pacote A7).
// A liberação pela FOTO continua; o que muda é que o código lido no comprovante é
// guardado, e o mesmo código vindo de OUTRO número não libera de novo. Se o código
// não puder ser lido, se faltar o segredo AGENTES5040_HMAC ou se QUALQUER coisa der
// errado nesta checagem, o comportamento é o de sempre: quem pagou de verdade nunca
// é barrado por ela. Telefone NUNCA vai em claro na chave nem no valor.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maiúsculas, só letra e número. Menos de 20 caracteres = ilegível (null).
 * O piso de 20 é o que impede de tratar como código de transação o que se repete em
 * TODO comprovante legítimo: a chave Pix da Aioros (CNPJ, 14 dígitos) e os txid fixos
 * do copia-e-cola (SOLARDOCVIP, SOLARDOCCURSO). Lidos como código, eles fariam o 2º
 * cliente que paga parecer "o mesmo código de outro número".
 */
export function normalizarTxid(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t.length < 20 ? null : t;
}

export const chaveTxid = (txid: string) =>
  `pix_txid:${crypto.createHash('sha256').update(txid).digest('hex')}`;

/**
 * HMAC do telefone (últimos 11 dígitos, como o pix_solicitado), pelo hmacDe do
 * agentes5040/hmac.ts (segredo: AGENTES5040_HMAC ou a chave derivada do serviço).
 * null = sem segredo = checagem nova desligada.
 */
function donoDoTelefone(phone: string): string | null {
  const d = (phone || '').replace(/\D/g, '');
  const base = d.length > 11 ? d.slice(-11) : d;
  if (!base) return null;
  return hmacDe(base);
}

type RegistroTxid = { dono?: string; kid?: string } | null | undefined;

/**
 * O registro gravado é de OUTRO número? Só quando tem dono, foi gravado com a MESMA
 * chave de HMAC de agora (kid igual) e o dono é diferente. Registro sem kid (antigo) ou
 * de outra chave (troca de AGENTES5040_HMAC ou da SUPABASE_SERVICE_KEY) não é
 * comparável: segue como hoje, senão a troca de segredo faria o mesmo número virar "outro".
 */
function ehDeOutroDono(reg: RegistroTxid, meu: string, kidAtual: string): boolean {
  if (!reg?.dono || !reg.kid || reg.kid !== kidAtual) return false;
  return reg.dono !== meu;
}

/** Dono já gravado para o código: true só quando é comprovadamente de outro número. */
export async function txidDeOutroNumero(txid: string | null, phone: string): Promise<boolean> {
  try {
    const meu = donoDoTelefone(phone);
    const kid = idChaveHmac();
    if (!txid || !meu || !kid) return false;
    const { data } = await supabase.from('system_state').select('value').eq('key', chaveTxid(txid)).maybeSingle();
    return ehDeOutroDono((data as { value?: RegistroTxid } | null)?.value, meu, kid);
  } catch {
    return false;
  }
}

/**
 * Reserva o código por insert, ANTES de liberar. 'outro' = 23505 de outro dono (não libera).
 * Todo o resto (mesmo dono, outro erro, sem segredo, sem código legível) = 'seguir'.
 */
export async function reservarTxid(txid: string | null, phone: string, valor: number): Promise<'seguir' | 'outro'> {
  try {
    const dono = donoDoTelefone(phone);
    const kid = idChaveHmac();
    if (!txid || !dono || !kid) return 'seguir';
    const chave = chaveTxid(txid);
    const { error } = await supabase.from('system_state')
      .insert({ key: chave, value: { dono, kid, valor, em: new Date().toISOString() } });
    if (!error) return 'seguir';
    if ((error as { code?: string }).code !== '23505') {
      logger.error('pix-comprovante', 'pix_txid insert falhou (segue como antes)', error);
      return 'seguir';
    }
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    return ehDeOutroDono((data as { value?: RegistroTxid } | null)?.value, dono, kid) ? 'outro' : 'seguir';
  } catch (err) {
    logger.error('pix-comprovante', 'pix_txid reserva falhou (segue como antes)', err);
    return 'seguir';
  }
}

const MOTIVO_TXID_OUTRO = 'código já usado por outro número';

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
): Promise<{ passou: boolean; motivo: string; valor: number; dedupKey: string; e2eKey: string | null; txid: string | null; txidDeOutro: boolean; jaUsado: 'telefone' | 'e2e' | null; repetidoSemE2e: boolean; repetidoTardio: boolean; recebedorOk: boolean; codigo: CodigoMotivo | null; modo: ModoPagamento | null }> {
  const doc   = (c.recebedor_documento || '').replace(/\D/g, '');
  const nome  = (c.recebedor_nome || '').toLowerCase();
  const valor = Number(c.valor) || 0;

  const recebedorOk = doc.includes(AIOROS_CNPJ) || nome.includes('aioros');
  // Data AUSENTE ou ilegível → FALHA a trava (não auto-libera comprovante sem data
  // recente comprovável — senão um comprovante antigo de R$67 passaria).
  let dataOk = false;
  if (c.data) {
    const d = Date.parse(c.data);
    if (!isNaN(d)) dataOk = (Date.now() - d) < 6 * 864e5 && d <= Date.now() + 864e5;
  }
  // O corte compara a data IMPRESSA (AAAA-MM-DD), não um Date: a máquina roda em UTC.
  const dataTxt = /^\d{4}-\d{2}-\d{2}/.exec(String(c.data ?? ''))?.[0] ?? null;
  const posCorte = dataOk && !!dataTxt && dataTxt >= DATA_CORTE_PIX_67;
  // Antes do corte, valor EXATO de um plano. Depois, qualquer valor legível: 67 ou mais
  // libera, menos que isso vira pagamento parcial.
  const valorOk = posCorte ? valor > 0 : PLANOS_VALIDOS.includes(Math.round(valor));
  // Dedup DETERMINÍSTICO por telefone+valor+data (NÃO usa id_transacao — a visão às
  // vezes lê o id num envio e não no outro, o que faria a chave divergir e dobrar o mês).
  // Como `passou` exige data recente legível, aqui a data está sempre preenchida.
  const dedupBase = `pix_comprov:${identity.replace(/\D/g, '')}:${valor}:${c.data || ''}`;
  const e2eKey = chaveE2e(c.id_transacao, valor);
  let dedupKey = dedupBase;
  const { data: usadoBase } = await supabase.from('system_state').select('key, value').eq('key', dedupBase).limit(1);
  let usado = usadoBase;
  // Dois Pix LEGÍTIMOS de mesmo valor no mesmo dia (parciais iguais) colidem nesta chave.
  // Se o registro anterior guardou o E2E e os dois E2E existem e são diferentes, é outro
  // Pix: ele ganha chave própria (`<chave>:<E2E>`) e ainda passa pela trava `pix_e2e:`.
  // Se algum dos dois não tem E2E, não dá pra distinguir: segue barrado, e quem chama
  // avisa o Thiago (possível pagamento repetido, a conferir). Chaves antigas continuam valendo.
  let repetidoSemE2e = false;
  let repetidoTardio = false;
  if (usado?.length) {
    const antigoReg = (usado[0] as { value?: { e2e?: string | null; at?: string } }).value;
    const antigo = antigoReg?.e2e ?? null;
    // Mesmo prefixo de E2E, mas o registro é de mais de 10 min atrás: pode ser reenvio
    // tardio OU um 2º Pix igual do mesmo banco e minuto. Não dá pra distinguir com
    // segurança, então segue barrado e o Thiago confere.
    if (antigo && e2eKey && antigo === e2eKey) {
      const quando = Date.parse(antigoReg?.at ?? '');
      if (!Number.isNaN(quando) && Date.now() - quando > 10 * 60_000) repetidoTardio = true;
    }
    if (antigo && e2eKey && antigo !== e2eKey) {
      dedupKey = `${dedupBase}:${e2eKey.split(':')[1]}`;
      usado = (await supabase.from('system_state').select('key, value').eq('key', dedupKey).limit(1)).data;
    } else if (!antigo || !e2eKey) {
      repetidoSemE2e = true;
    }
  }

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
  let semIdPix = false;
  let e2eUsado = false;
  if (opts.exigirIdPix) {
    semIdPix = !e2eKey;
    if (e2eKey) {
      const { data: e2e } = await supabase.from('system_state').select('key').eq('key', e2eKey).limit(1);
      e2eUsado = !!e2e?.length;
    }
  }

  // Mesmo código de transação já gravado por OUTRO número → não libera (vale em TODO
  // ramo, não só no desconhecido). Sem código legível, sem segredo ou com erro de
  // leitura, isto é sempre false (como antes).
  const txid = normalizarTxid(c.id_transacao);
  const txidDeOutro = await txidDeOutroNumero(txid, identity);

  // Entrada já usada: antes do corte reprova (o Thiago decide); depois do corte vira parcial.
  const passou = recebedorOk && valorOk && dataOk && !(usado?.length) && !(entradaRepetida && !posCorte) && !semIdPix && !e2eUsado && !txidDeOutro;

  const motivo = usado?.length ? 'comprovante já usado antes (reenvio?)'
    : e2eUsado ? 'este Pix (ID) já foi usado antes, em outro telefone ou data'
    : txidDeOutro ? MOTIVO_TXID_OUTRO
    : !recebedorOk ? 'recebedor NÃO parece ser a Aioros'
    : !valorOk ? (posCorte ? 'valor ilegível ou zerado no comprovante' : 'valor não bate com plano (19/27/49/67)')
    : !dataOk ? 'data ausente ou fora da janela'
    : (entradaRepetida && !posCorte) ? 'entrada de R$19 já usada por este número (é oferta de primeira vez)'
    : semIdPix ? 'sem ID de Pix'
    : 'ok';
  // Reenvio de comprovante JÁ liberado: quem chama não responde nada e não deixa a imagem seguir.
  // Código de transação de OUTRO número conta como 'e2e' (mesmo Pix vindo de outro
  // telefone): vira 'ja_usado' pra Giovanna e o Thiago é avisado (avisaThiagoDoReprovado).
  const jaUsado = usado?.length ? 'telefone' as const : (e2eUsado || txidDeOutro) ? 'e2e' as const : null;
  // Código estável do motivo (a Giovanna age por ele; o texto `motivo` é só pra log e aviso).
  const codigo: CodigoMotivo | null = passou ? null
    : jaUsado ? 'ja_usado'
    : !recebedorOk ? 'recebedor'
    : !valorOk ? 'valor'
    : !dataOk ? 'data'
    : (entradaRepetida && !posCorte) ? 'entrada_repetida'
    : 'sem_id_pix';
  const modo: ModoPagamento | null = !passou ? null
    : !posCorte ? 'tabela'
    : (Math.round(valor) === VALOR_ENTRADA_CURSO && !entradaRepetida) ? 'entrada'
    : emCentavos(valor) >= CENT_RENOVACAO ? 'cheio'
    : 'parcial';
  return { passou, motivo, valor, dedupKey, e2eKey, txid, txidDeOutro, jaUsado, repetidoSemE2e, repetidoTardio, recebedorOk, codigo, modo };
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

// ─────────────────────────────────────────────────────────────────────────────
// APLICAR UM PAGAMENTO PIX. Um lugar só, usado por TODOS os ramos que liberam
// (conhecido, abandono/Pix pedido, desconhecido com conta achada, e e-mail que chega
// depois do comprovante). Antes de creditar, as travas atômicas: insere `pix_comprov:`
// e `pix_e2e:` e, se qualquer uma já existia (23505), silêncio e nada é creditado.
//
// Pós-corte, o pagamento soma no crédito da conta (`pix_credito:<user_id>`, 7 dias).
// Só quando o total chega a R$ 67 libera o mês e roda o que mexe na conta (liberar,
// encerrar dunning/Stripe, marcar o abandono como recuperado). Parcial NÃO toca em nada
// disso: cancelar a assinatura de cartão de quem pagou R$ 27 e ainda não tem o mês
// seria o pior dos dois mundos.
// ─────────────────────────────────────────────────────────────────────────────

export interface PagamentoValidado {
  valor: number;
  dedupKey: string;
  e2eKey: string | null;
  modo: ModoPagamento;
  data: string | null;
  /** Código da transação normalizado (normalizarTxid). null = ilegível: a trava do txid fica fora. */
  txid?: string | null;
}

export interface ResultadoPagamento {
  // 'txid_outro' = o código da transação já está reservado por OUTRO número: nada foi
  // creditado e o Thiago já foi avisado. Quem chama trata como comprovante reprovado.
  resultado: 'liberou' | 'parcial' | 'duplicado' | 'falhou' | 'txid_outro';
  venc: Date | null;
  total: number;
  restante: number;
}

interface CreditoPix {
  total: number;
  itens: { valor: number; data: string | null; e2e: string | null; em: string }[];
  desde: string;
}

const chaveCredito = (userId: string) => `pix_credito:${userId}`;
const DIAS_VALIDADE_CREDITO = 7;

/** Crédito vivo da conta. Com `desde` de mais de 7 dias, vem zerado (ninguém paga o resto semanas depois). */
async function lerCreditoPix(userId: string): Promise<CreditoPix> {
  const vazio = (): CreditoPix => ({ total: 0, itens: [], desde: new Date().toISOString() });
  const { data } = await supabase.from('system_state').select('value').eq('key', chaveCredito(userId)).maybeSingle();
  const v = (data as { value?: CreditoPix } | null)?.value;
  if (!v || !Array.isArray(v.itens) || !v.itens.length) return vazio();
  if (Date.now() - Date.parse(v.desde) > DIAS_VALIDADE_CREDITO * 864e5) return vazio();
  return v;
}

/** true quando gravou. */
async function gravarCreditoPix(userId: string, c: CreditoPix): Promise<boolean> {
  const { error } = await supabase.from('system_state')
    .upsert({ key: chaveCredito(userId), value: c }, { onConflict: 'key' });
  if (error) logger.error('pix-comprovante', `crédito Pix não gravou (${userId})`, error);
  return !error;
}

const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Trava por conta em volta da leitura-soma-gravação do crédito (insert atômico em
 * `pix_credito_lock:<user_id>`). 23505 → até 5 tentativas com ~300 ms; trava com mais de
 * 30 s é de uma execução que morreu e pode ser tomada. Solta no `finally`. Sem conseguir
 * a trava em 5 tentativas, segue sem ela: melhor arriscar a corrida rara do que deixar
 * quem pagou sem resposta.
 */
async function comTravaDeCredito<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const key = `pix_credito_lock:${userId}`;
  // Token próprio: o `finally` só apaga a trava se ela ainda for a nossa (se a trava
  // velha foi tomada por outra execução, apagar às cegas soltaria a trava DELA).
  const token = crypto.randomBytes(8).toString('hex');
  let tomou = false;
  for (let i = 0; i < 5 && !tomou; i++) {
    const { error } = await supabase.from('system_state')
      .insert({ key, value: { em: new Date().toISOString(), token } });
    if (!error) { tomou = true; break; }
    if ((error as { code?: string }).code !== '23505') {
      logger.error('pix-comprovante', 'trava do crédito não gravou (segue sem ela)', error);
      break;
    }
    const { data } = await supabase.from('system_state').select('value').eq('key', key).maybeSingle();
    const em = Date.parse((data as { value?: { em?: string } } | null)?.value?.em ?? '');
    if (!Number.isNaN(em) && Date.now() - em > 30_000) {
      await supabase.from('system_state').delete().eq('key', key);
      continue;
    }
    await esperar(300);
  }
  if (!tomou) logger.warn('pix-comprovante', `crédito de ${userId} sem trava (segue)`);
  try {
    return await fn();
  } finally {
    if (tomou) {
      const { data } = await supabase.from('system_state').select('value').eq('key', key).maybeSingle();
      if ((data as { value?: { token?: string } } | null)?.value?.token === token) {
        await supabase.from('system_state').delete().eq('key', key);
      }
    }
  }
}

export async function aplicarPagamentoPix(a: {
  user: { id: string; email: string; plano_expira_em?: string | null; billing_status?: string | null };
  pag: PagamentoValidado;
  cleanPhone: string;
  originInstance: ZapiInstance;
  comprovante?: Comprovante | null;
  img?: ImgSrc | null;
  via: string;
  /** Manda a confirmação ao cliente (só quando LIBEROU). */
  confirmar: (r: { venc: Date; total: number; alvo: { plano: string; limite: number }; entrada: boolean }) => Promise<void>;
  /** Linha do aviso ao Thiago quando libera. */
  statusThiago: (r: { venc: Date; total: number }) => string;
  /** Efeito colateral de quem chama que só vale quando libera (ex.: abandono recuperado). */
  aposLiberar?: () => Promise<void>;
}): Promise<ResultadoPagamento> {
  const { user, pag, cleanPhone, originInstance } = a;
  const duplicado: ResultadoPagamento = { resultado: 'duplicado', venc: null, total: 0, restante: 0 };
  const avisar = async (texto: string) => {
    if (a.comprovante && a.img) {
      await notificarThiago(
        { email: user.email, phone: cleanPhone, valor: pag.valor, comprovante: a.comprovante }, a.img, texto);
    } else {
      await sendWhatsApp(THIAGO_PHONE, `*Pix de ${user.email}* (${cleanPhone}): ${texto}`, 'solardoc').catch(() => {});
    }
  };

  // 0) Código da transação reservado ANTES do dedup e de creditar (vale pra TODOS os
  // ramos que liberam, porque todos passam por aqui). Outro número já reservou → não
  // credita. Sem código legível, sem segredo ou com erro: 'seguir', como sempre foi.
  if (await reservarTxid(pag.txid ?? null, cleanPhone, pag.valor) === 'outro') {
    await avisar(`⚠️ REVISAR — ${MOTIVO_TXID_OUTRO}. Não creditei. Se o dinheiro chegou na Aioros, libera no /admin ("+ Pix").`);
    logger.info('pix-comprovante', `txid de outro número (${user.email}, ${a.via}): não creditou`);
    return { resultado: 'txid_outro', venc: null, total: 0, restante: 0 };
  }

  // 1) Travas atômicas ANTES de creditar. O registro guarda o E2E: é ele que distingue
  // um reenvio (mesmo Pix) de um segundo Pix legítimo de mesmo valor no mesmo dia.
  const valorDedup = {
    user_id: user.id, valor: pag.valor, data: pag.data, e2e: pag.e2eKey, at: new Date().toISOString(), via: a.via,
  };
  const { error: dedupErr } = await supabase.from('system_state').insert({ key: pag.dedupKey, value: valorDedup });
  if (dedupErr) {
    if ((dedupErr as { code?: string }).code !== '23505') {
      logger.error('pix-comprovante', 'dedup insert falhou (segue)', dedupErr);
    } else {
      const { data: ex } = await supabase.from('system_state').select('value').eq('key', pag.dedupKey).maybeSingle();
      const antigo = (ex as { value?: { e2e?: string | null } } | null)?.value?.e2e ?? null;
      const e2e21 = pag.e2eKey?.split(':')[1] ?? null;
      if (antigo && pag.e2eKey && antigo !== pag.e2eKey && e2e21 && !pag.dedupKey.endsWith(`:${e2e21}`)) {
        // Outro Pix de mesmo valor e data (corrida com o 1º): chave própria.
        const { error: err2 } = await supabase.from('system_state')
          .insert({ key: `${pag.dedupKey}:${e2e21}`, value: valorDedup });
        if (err2) {
          logger.info('pix-comprovante', `dedup: comprovante já processado (${user.email}, ${a.via})`);
          return duplicado;
        }
      } else {
        const quando = Date.parse((ex as { value?: { at?: string } } | null)?.value?.at ?? '');
        if (!antigo || !pag.e2eKey) {
          await avisar('⚠️ Possível pagamento REPETIDO (mesmo valor e data, sem ID de Pix pra comparar). Não creditei. Confere se é outro pagamento.');
        } else if (!Number.isNaN(quando) && Date.now() - quando > 10 * 60_000) {
          await avisar('⚠️ Possível pagamento REPETIDO: mesmo prefixo de ID de Pix de um comprovante processado há mais de 10 min (reenvio tardio ou 2º Pix igual do mesmo banco e minuto). Não creditei. Confere.');
        }
        logger.info('pix-comprovante', `dedup: comprovante já processado (${user.email}, ${a.via})`);
        return duplicado;
      }
    }
  }
  if (await e2eJaUsado(pag.e2eKey, pag.valor, user.id)) {
    logger.info('pix-comprovante', `dedup E2E: Pix já usado (${user.email}, ${a.via})`);
    return duplicado;
  }

  // Pagamento aceito (liberou ou virou crédito): o handoff "comprovante não aceito" some,
  // senão a Giovanna seguiria desmentindo a liberação com o bloco velho no prompt.
  const aceito = async (res: ResultadoPagamento): Promise<ResultadoPagamento> => {
    await apagarHandoffComprovante(cleanPhone);
    return res;
  };

  // 2) Antes do corte (tabela antiga) e entrada de R$ 19: libera como sempre.
  if (pag.modo === 'tabela' || pag.modo === 'entrada') {
    const alvo = PLANO_POR_VALOR[Math.round(pag.valor)] ?? { plano: 'ilimitado', limite: 999999 };
    const venc = await liberarAcessoPix(user.id, user.plano_expira_em ?? null, alvo.plano, alvo.limite);
    await encerrarDunningPix(user.id, user.email, user.billing_status);
    const entrada = Math.round(pag.valor) === VALOR_ENTRADA_CURSO;
    if (entrada) await queimarEntrada(cleanPhone, user.id, user.email, venc);
    await a.aposLiberar?.();
    await a.confirmar({ venc, total: pag.valor, alvo, entrada });
    await avisar(a.statusThiago({ venc, total: pag.valor }));
    logger.info('pix-comprovante', `AUTO-liberado (${a.via}) ${user.email} ${brl(pag.valor)} vence ${venc.toISOString()}`);
    return aceito({ resultado: 'liberou', venc, total: pag.valor, restante: 0 });
  }

  // 3) Pós-corte: soma com o crédito da conta, SOB TRAVA por conta. Dois comprovantes
  // parciais chegando juntos (27 e 40) leriam o mesmo crédito e cada um gravaria só o seu.
  // DENTRO da trava só se lê, soma, grava/zera o crédito, decide e libera o acesso:
  // envio ao cliente e aviso ao Thiago esperam a trava ser solta (WhatsApp lento não
  // pode segurar a conta dos outros comprovantes).
  type Decisao =
    | { tipo: 'liberou'; venc: Date; total: number; alvo: { plano: string; limite: number } }
    | { tipo: 'parcial'; total: number; restante: number; primeiro: boolean }
    | { tipo: 'falhou'; total: number };
  let dec: Decisao;
  try {
    dec = await comTravaDeCredito(user.id, async (): Promise<Decisao> => {
      const cred = await lerCreditoPix(user.id);
      const agora = new Date().toISOString();
      const itens = [...cred.itens, { valor: pag.valor, data: pag.data, e2e: pag.e2eKey, em: agora }];
      const totalC = emCentavos(cred.total) + emCentavos(pag.valor);
      const total = totalC / 100;

      if (totalC >= CENT_RENOVACAO) {
        // Zera o crédito ANTES de liberar: se não conseguir zerar, NÃO libera (liberar e
        // deixar o crédito de pé daria um 2º mês de graça no próximo comprovante).
        if (!(await gravarCreditoPix(user.id, { total: 0, itens: [], desde: agora }))) return { tipo: 'falhou', total };
        const alvo = { plano: 'ilimitado', limite: 999999 };
        const venc = await liberarAcessoPix(user.id, user.plano_expira_em ?? null, alvo.plano, alvo.limite);
        return { tipo: 'liberou', venc, total, alvo };
      }
      await gravarCreditoPix(user.id, { total, itens, desde: cred.itens.length ? cred.desde : agora });
      return { tipo: 'parcial', total, restante: (CENT_RENOVACAO - totalC) / 100, primeiro: cred.itens.length === 0 };
    });
  } catch (err) {
    // O comprovante já está marcado como usado e o crédito falhou: sem este aviso o
    // dinheiro some (o reenvio cai no dedup). O Thiago recebe o que precisa pra conferir.
    logger.error('pix-comprovante', `falha ao aplicar o crédito (${user.email})`, err);
    await avisar(`⚠️ ERRO ao aplicar o pagamento de R$ ${valorBr(pag.valor)} (ID ${pag.e2eKey ?? 'sem ID'}) de ${user.email}: o comprovante ficou marcado como usado mas o crédito NÃO foi aplicado. Confere e libera no /admin ("+ Pix").`);
    throw err;
  }

  if (dec.tipo === 'falhou') {
    await avisar(`⚠️ Pagamento completo (R$ ${valorBr(dec.total)}) mas NÃO consegui zerar o crédito, então não liberei. Libera no /admin ("+ Pix") e confere o crédito.`);
    return { resultado: 'falhou', venc: null, total: dec.total, restante: 0 };
  }

  if (dec.tipo === 'liberou') {
    const { venc, total, alvo } = dec;
    await encerrarDunningPix(user.id, user.email, user.billing_status);
    await a.aposLiberar?.();
    await a.confirmar({ venc, total, alvo, entrada: false });
    await avisar(a.statusThiago({ venc, total }));
    if (emCentavos(total) > CENT_RENOVACAO + 100) {
      await avisar(`⚠️ Pagou R$ ${valorBr(total)}, acima de 67. Confere se sobrou valor a devolver ou se é pagamento de outro produto da Aioros.`);
    }
    logger.info('pix-comprovante', `AUTO-liberado (${a.via}) ${user.email} total ${brl(total)} vence ${venc.toISOString()}`);
    return aceito({ resultado: 'liberou', venc, total, restante: 0 });
  }

  // 4) Parcial: avisa quanto falta e já manda o Pix do restante.
  const { total, restante, primeiro } = dec;
  const texto = primeiro
    ? `Recebi seu Pix de R$ ${valorBr(pag.valor)}, obrigado. A renovação no Pix agora é R$ ${valorBr(VALOR_RENOVACAO_PIX)}, então faltam R$ ${valorBr(restante)}. Segue abaixo o Pix do restante. Assim que você mandar o comprovante, eu libero na hora.`
    : `Recebi mais R$ ${valorBr(pag.valor)}. Somando, já chegaram R$ ${valorBr(total)}. Faltam R$ ${valorBr(restante)} para fechar os R$ ${valorBr(VALOR_RENOVACAO_PIX)} da renovação. Segue abaixo o Pix do restante.`;
  // O código vai por último, sozinho na bolha (o `sendHuman` nunca funde nem corta Pix).
  // NÃO passa por registrarPixEnviado: aquele registro (sem `origem`) mandaria o próximo
  // comprovante de um número desconhecido pelo ramo antigo, sem a trava de ID de Pix.
  const copia = gerarPixCopiaECola({ valor: restante, txid: 'SOLARDOCVIP' });
  await sendHuman(cleanPhone, [texto, copia], originInstance, { maxBolhas: 2 }).catch(() => {});
  await avisar(`⚠️ Pix PARCIAL: recebeu R$ ${valorBr(total)} de R$ ${valorBr(VALOR_RENOVACAO_PIX)}, faltam R$ ${valorBr(restante)}. Mandei o Pix do restante; libero quando completar.`);
  logger.info('pix-comprovante', `parcial (${a.via}) ${user.email} total ${brl(total)} falta ${brl(restante)}`);
  return aceito({ resultado: 'parcial', venc: null, total, restante });
}

// Retorna true se TRATOU o comprovante (liberou OU sinalizou) — o chamador então
// NÃO cai no LLM geral. Retorna false se não é candidato/não é comprovante (segue fluxo).
export async function tryProcessPixComprovante(
  user: { id: string; email: string; plano: string },
  img: ImgSrc,
  cleanPhone: string,
  originInstance: ZapiInstance = 'solardoc',
  texto = '',
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

  const v0 = await validarComprovante(c, cleanPhone);
  const { passou, motivo, valor, dedupKey, e2eKey } = v0;
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

  // ── REPROVADO: o contexto vai pra Giovanna, que explica e orienta ──
  // Antes saía uma frase fixa ("recebi, já te libero") que prometia o que o sistema
  // não ia fazer. Reenvio do mesmo comprovante sem legenda: silêncio.
  // `thiagoJaAvisado`: o aplicarPagamentoPix já avisou (código de outro número pego na reserva).
  const reprovar = async (v: ResultadoValidacao, thiagoJaAvisado = false): Promise<boolean> => {
    if (v.jaUsado === 'telefone' && legendaVazia(texto)) {
      logger.info('pix-comprovante', `reenvio de comprovante já usado (${user.email})`);
      if (v.repetidoSemE2e || v.repetidoTardio) await avisarRepetidoSemE2e(user.email, cleanPhone, c, img, v.valor, v.repetidoTardio);
      return true;
    }
    // Uma explicação por comprovante, e do 3º reprovado em 24h em diante, silêncio.
    const ctl = await controleDeInsistencia({ cleanPhone, c, v, img, emailConta: user.email });
    if (ctl === 'silencio') return true;
    // Já explicado: sem legenda é silêncio; com pergunta, o fluxo normal (Giovanna) responde.
    if (ctl === 'explicado') return legendaVazia(texto);
    await guardarHandoffComprovante(cleanPhone, montarHandoff(c, v, originInstance));
    // O Thiago só entra quando o dinheiro, se saiu, chegou na Aioros (e não é reenvio).
    if (!thiagoJaAvisado && avisaThiagoDoReprovado(v)) {
      await notificarThiago(
        { email: user.email, phone: cleanPhone, valor: v.valor, comprovante: c }, img,
        `⚠️ REVISAR — ${v.motivo}. A Giovanna responde ao cliente explicando. Se o dinheiro chegou, libera no /admin ("+ Pix").`,
      );
    }
    logger.info('pix-comprovante', `reprovado, segue pra Giovanna (${user.email}) motivo=${v.motivo}`);
    return false;
  };
  if (!passou) return reprovar(v0);

  // ── AUTO-LIBERAÇÃO (ou parcial: soma no crédito e pede o resto) ──
  if (passou && AUTO_LIBERAR) {
    const r = await aplicarPagamentoPix({
      user: { id: user.id, email: user.email, plano_expira_em: uRow?.plano_expira_em, billing_status: uRow?.billing_status },
      pag: { valor, dedupKey, e2eKey, txid: v0.txid, modo: v0.modo ?? 'tabela', data: c.data ?? null },
      cleanPhone, originInstance, comprovante: c, img, via: 'conhecido',
      confirmar: async ({ venc, entrada }) => {
        // Orienta o cliente. Conta pendente (pagou no abandono, sem senha) → link pra definir senha.
        const pendente = !uRow?.password_hash;
        // Na entrada, o que ele comprou foi o CURSO — os 30 dias de plataforma são a
        // experiência. A mensagem diz as duas coisas e já planta a decisão do dia 30,
        // sem cobrar nada agora: é assim que a oferta foi vendida no WhatsApp.
        const linhas = entrada
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
        await sendHuman(cleanPhone, linhas, originInstance, { maxBolhas: 1 }).catch(() => {});
      },
      statusThiago: ({ venc }) => `✅ *AUTO-LIBERADO* — vence ${venc.toLocaleDateString('pt-BR')}. Confere e arquiva o comprovante.`,
    });
    // Código de outro número pego na reserva (corrida): segue a regra do reprovado.
    if (r.resultado === 'txid_outro') return reprovar(reprovadoPorTxid(v0), true);
    return true;
  }

  // ── SÓ-SINALIZAR (passou nas travas, mas o AUTO está desligado): humano confere no /admin. ──
  await sendHuman(cleanPhone, [
    'Recebi seu comprovante! 🙌 Vou confirmar aqui e já te libero o acesso — qualquer coisa te aviso por aqui.',
  ], originInstance, { maxBolhas: 1 }).catch(() => {});
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
/**
 * Pendente gravado ANTES da regra dos R$ 67 (sem `modo`): o modo sai da data impressa
 * contra o corte. Sem data, ou antes do corte, segue a tabela antiga.
 */
async function modoDoPendenteAntigo(
  pend: { valor: number; data?: string | null }, cleanPhone: string,
): Promise<ModoPagamento> {
  const dataTxt = /^\d{4}-\d{2}-\d{2}/.exec(String(pend.data ?? ''))?.[0] ?? null;
  if (!dataTxt || dataTxt < DATA_CORTE_PIX_67) return 'tabela';
  if (Math.round(pend.valor) === VALOR_ENTRADA_CURSO) {
    const { data: usada } = await supabase.from('system_state').select('key').eq('key', chaveEntrada(cleanPhone)).limit(1);
    return usada?.length ? 'parcial' : 'entrada';
  }
  return emCentavos(pend.valor) >= CENT_RENOVACAO ? 'cheio' : 'parcial';
}

export async function aplicarComprovantePendente(
  cleanPhone: string, email: string, nome: string | null, originInstance: ZapiInstance = 'solardoc',
): Promise<{ tratado: boolean; venc: Date | null }> {
  const nada = { tratado: false, venc: null };
  const reg = await lerPixSolicitado(cleanPhone);
  const pend = reg?.comprovante;
  if (!pend) return nada;

  // Não passou nas travas → quem decide é o Thiago (mesma regra do fluxo normal).
  if (!pend.passou || !AUTO_LIBERAR) {
    await sendWhatsApp(THIAGO_PHONE,
      `*Pix pendente com e-mail agora* — ${email} (${cleanPhone}) · ${brl(pend.valor)}. O comprovante não passou nas travas automáticas: confere e libera no /admin ("+ Pix").`,
      'solardoc').catch(() => {});
    await limparComprovantePendente(cleanPhone);
    return nada;
  }

  // Código da transação reservado ANTES de achar/criar a conta: se outro número já o
  // usou, não nasce conta sem crédito. O Thiago decide (saída de "não passou nas travas").
  if (await reservarTxid(pend.txid ?? null, cleanPhone, pend.valor) === 'outro') {
    await sendWhatsApp(THIAGO_PHONE,
      `*Pix pendente com e-mail agora* — ${email} (${cleanPhone}) · ${brl(pend.valor)}. REVISAR: ${MOTIVO_TXID_OUTRO}. Não liberei: confere e libera no /admin ("+ Pix").`,
      'solardoc').catch(() => {});
    await limparComprovantePendente(cleanPhone);
    return nada;
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
    return nada;
  }
  if (ehCartaoAtivo(u)) {
    await sendWhatsApp(THIAGO_PHONE,
      `⚠️ *Pix pendente*: ${email} tem CARTÃO ATIVO — não liberei (evita corromper o billing). Confere.`,
      'solardoc').catch(() => {});
    await limparComprovantePendente(cleanPhone);
    return nada;
  }

  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
  const r = await aplicarPagamentoPix({
    user: u,
    // Pendente de antes da regra dos R$ 67 não tem `modo`: segue a tabela antiga.
    pag: { valor: pend.valor, dedupKey: pend.dedupKey, e2eKey: pend.e2eKey ?? null, txid: pend.txid ?? null, modo: pend.modo ?? await modoDoPendenteAntigo(pend, cleanPhone), data: pend.data ?? null },
    cleanPhone, originInstance, via: 'email-depois',
    confirmar: async ({ venc, total, alvo }) => {
      // Link de definir senha SÓ pra conta criada agora, nesta chamada.
      const linkSenha = u.criadaAgora && u.reset_token
        ? `${dashboardUrl}/auth?mode=redefinir&token=${u.reset_token}` : null;
      const razao = u.criadaAgora ? null : await razaoSocialDe(u.id);
      await sendHuman(cleanPhone, [
        textoConfirmacao({ valor: total, plano: alvo.plano, venc, email: u.email || email, razao, linkSenha }),
      ], originInstance, { maxBolhas: 1 }).catch(() => {});
    },
    statusThiago: ({ venc, total }) => `✅ *AUTO-LIBERADO (Pix + e-mail depois)* — ${brl(total)} · vence ${diaMes(venc)}.`,
  });
  if (r.resultado === 'falhou') return nada; // o Thiago foi avisado; o pendente fica
  // Código já usado por outro número: não liberou, o Thiago foi avisado e decide.
  // O pendente sai (mesma saída de "não passou nas travas").
  if (r.resultado === 'txid_outro') {
    await limparComprovantePendente(cleanPhone);
    return nada;
  }
  // Liberou, creditou parcial ou já estava processado: o pendente cumpriu o papel.
  await limparComprovantePendente(cleanPhone);
  // Já processado antes: o e-mail do cliente segue pro fluxo normal e recebe resposta.
  if (r.resultado === 'duplicado') return nada;
  return { tratado: true, venc: r.resultado === 'liberou' ? r.venc : null };
}

/** Wrapper que mantém o contrato antigo (data do vencimento quando liberou). */
export async function liberarComprovantePendente(
  cleanPhone: string, email: string, nome: string | null, originInstance: ZapiInstance = 'solardoc',
): Promise<Date | null> {
  return (await aplicarComprovantePendente(cleanPhone, email, nome, originInstance)).venc;
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

type ResultadoValidacao = Awaited<ReturnType<typeof validarComprovante>>;

/**
 * O comprovante passou nas travas, mas a reserva do código da transação acusou OUTRO
 * número (corrida que a checagem do validarComprovante não viu). Vira reprovado com o
 * mesmo desenho do "mesmo Pix de outro telefone": 'ja_usado' pra Giovanna.
 */
function reprovadoPorTxid(v: ResultadoValidacao): ResultadoValidacao {
  return { ...v, passou: false, motivo: MOTIVO_TXID_OUTRO, txidDeOutro: true, jaUsado: 'e2e', codigo: 'ja_usado', modo: null };
}

/**
 * Número desconhecido SEM sinal do SolarDoc recusado pela trava do código: o cliente
 * não ouve nada (regra do main), mas o Thiago é avisado UMA vez por código. Comprovante
 * repetido vindo de número que ninguém conhece é o sinal de golpe. A reserva é por
 * insert em `pix_txid_aviso:<sha256 do código>` (sem telefone): 23505 = já avisado.
 * Qualquer outro erro avisa mesmo assim (repetir o aviso é melhor que perdê-lo).
 */
async function avisarTxidOutroSemSinal(cleanPhone: string, c: Comprovante, img: ImgSrc, v: ResultadoValidacao): Promise<void> {
  if (!v.txidDeOutro || !v.txid) return;
  try {
    const key = `pix_txid_aviso:${crypto.createHash('sha256').update(v.txid).digest('hex')}`;
    const { error } = await supabase.from('system_state').insert({ key, value: { em: new Date().toISOString() } });
    if (error) {
      if ((error as { code?: string }).code === '23505') return;
      logger.error('pix-comprovante', 'reserva do aviso de txid não gravou (avisa mesmo assim)', error);
    }
  } catch (err) {
    logger.error('pix-comprovante', 'reserva do aviso de txid falhou (avisa mesmo assim)', err);
  }
  await notificarThiago(
    { email: '(número desconhecido, sem conta)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
    `⚠️ POSSÍVEL GOLPE — ${MOTIVO_TXID_OUTRO}, vindo de número desconhecido sem sinal do SolarDoc. Não respondi nem liberei. Confere.`,
  );
}

function montarHandoff(c: Comprovante, v: ResultadoValidacao, instancia: string): HandoffComprovante {
  return {
    valor: v.valor > 0 ? v.valor : null,
    recebedor_nome: c.recebedor_nome ?? null,
    recebedor_documento: c.recebedor_documento ?? null,
    data: c.data ?? null,
    id_transacao: c.id_transacao ?? null,
    motivo: v.motivo,
    codigo: v.codigo ?? 'sem_id_pix',
    recebedor_ok: v.recebedorOk,
    em: new Date().toISOString(),
    instancia,
  };
}

// Teto de comprovantes reprovados por telefone em 24h. Do 3º em diante: o Thiago é
// avisado UMA vez e o sistema fica em silêncio (quem insiste não ganha conversa de robô).
const MAX_REPROVADOS_24H = 3;

/**
 * Anti-teimosia. (1) Uma explicação por comprovante: o claim em `pix_explicado:` é
 * atômico, e o mesmo comprovante reenviado não gera outra resposta. (2) Contador de
 * reprovados por telefone em 24h. Devolve 'silencio' quando NÃO se deve explicar.
 */
async function controleDeInsistencia(a: {
  cleanPhone: string; c: Comprovante; v: ResultadoValidacao; img: ImgSrc; emailConta?: string | null;
}): Promise<'seguir' | 'silencio' | 'explicado'> {
  const { cleanPhone, c, v, img } = a;
  const chaveComprovante = v.e2eKey ?? v.dedupKey;
  const { error } = await supabase.from('system_state').insert({
    key: `pix_explicado:${chaveComprovante}`, value: { at: new Date().toISOString(), phone: cleanPhone },
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      logger.info('pix-comprovante', `comprovante reprovado já explicado antes (${cleanPhone})`);
      return 'explicado';
    }
    logger.error('pix-comprovante', 'claim da explicação não gravou (segue)', error);
  }

  const chaveContador = `pix_reprovados:${chaveTelefone(cleanPhone)}`;
  const { data } = await supabase.from('system_state').select('value').eq('key', chaveContador).maybeSingle();
  let est = (data as { value?: { n: number; desde: string; avisado: boolean } } | null)?.value ?? null;
  if (!est || !est.desde || Date.now() - Date.parse(est.desde) > 24 * 3_600_000) {
    est = { n: 0, desde: new Date().toISOString(), avisado: false };
  }
  est.n += 1;
  if (est.n >= MAX_REPROVADOS_24H && !est.avisado) {
    est.avisado = true;
    await notificarThiago(
      { email: a.emailConta ?? '(conta ainda não identificada)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
      `⚠️ ${est.n}º comprovante REPROVADO deste número em 24h (último: ${v.motivo}). Parei de responder; se for pagamento de verdade, olha na mão.`,
    );
  }
  await supabase.from('system_state').upsert({ key: chaveContador, value: est }, { onConflict: 'key' });
  return est.n >= MAX_REPROVADOS_24H ? 'silencio' : 'seguir';
}

/** Mesmo valor e data já processados e sem ID de Pix pra comparar: pode ser reenvio ou um 2º pagamento igual. */
async function avisarRepetidoSemE2e(email: string, cleanPhone: string, c: Comprovante, img: ImgSrc, valor: number, tardio = false): Promise<void> {
  await notificarThiago(
    { email, phone: cleanPhone, valor, comprovante: c }, img,
    tardio
      ? '⚠️ Possível pagamento REPETIDO: mesmo prefixo de ID de Pix de um comprovante processado há mais de 10 min (pode ser reenvio tardio ou um 2º Pix igual, do mesmo banco e minuto). Não creditei. Confere.'
      : '⚠️ Possível pagamento REPETIDO: mesmo valor e data de um comprovante já processado, sem ID de Pix pra comparar. Não creditei. Confere se é outro pagamento.',
  );
}

/** Thiago entra quando o dinheiro, se saiu, chegou na Aioros (e não é reenvio), ou quando o mesmo ID de Pix vem de OUTRO telefone. */
const avisaThiagoDoReprovado = (v: ResultadoValidacao) =>
  (v.recebedorOk && v.codigo !== 'ja_usado') || v.jaUsado === 'e2e';

const dm = (data: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(data ?? ''));
  return m ? `${m[3]}/${m[2]}` : null;
};

/** Mensagem fixa por motivo, assinada pela Giovanna (robô `pix_comprovante_cliente`). */
function mensagemFixaReprovado(c: Comprovante, v: ResultadoValidacao): string {
  const ass = 'Aqui é a Giovanna, do suporte do SolarDoc.';
  const valor = v.valor > 0 ? ` de R$ ${valorBr(v.valor)}` : '';
  const pedirPix = `${ass} Não consegui confirmar esse pagamento por aqui. Pode me mandar o comprovante do Pix, em foto ou PDF da tela do banco?`;
  switch (v.codigo) {
    case 'recebedor': {
      const quem = String(c.recebedor_nome ?? '').trim() || 'outro recebedor';
      return `${ass} Vi seu comprovante${valor}, mas esse Pix foi para ${quem}, e não para a gente. O SolarDoc recebe só pela Aioros Group Ltda, CNPJ 63.636.043/0001-88, então esse pagamento não chegou aqui.`;
    }
    case 'data': {
      const d = dm(c.data);
      return d
        ? `${ass} Esse comprovante é de ${d}, e para liberar eu preciso do comprovante do pagamento deste mês. Pode me mandar?`
        : pedirPix;
    }
    case 'ja_usado':
      return `${ass} Esse comprovante já foi usado para liberar um acesso antes. Se você fez um pagamento novo, me manda o comprovante dele.`;
    default:
      return pedirPix;
  }
}

/**
 * Comprovante REPROVADO de quem não tem conta MAS tem sinal do SolarDoc (abandono,
 * Pix pedido, ou e-mail de conta na conversa). SEM IA: uma mensagem fixa por
 * motivo, pela linha em que o cliente escreveu. Retorna true quando tratou (falou ou
 * calou de propósito), false quando o fluxo segue como sempre.
 */
async function reprovadoComMensagemFixa(a: {
  cleanPhone: string; c: Comprovante; v: ResultadoValidacao; img: ImgSrc;
  originInstance: ZapiInstance; texto: string; emailConta?: string | null;
  /** O aplicarPagamentoPix já avisou o Thiago (código de outro número pego na reserva). */
  thiagoJaAvisado?: boolean;
}): Promise<boolean> {
  const { cleanPhone, c, v, img, originInstance, texto } = a;
  // Reenvio do MESMO comprovante já liberado, sem legenda: nada a dizer.
  if (v.jaUsado === 'telefone' && legendaVazia(texto)) {
    logger.info('pix-comprovante', `reenvio de comprovante já usado (${cleanPhone})`);
    if (v.repetidoSemE2e || v.repetidoTardio) await avisarRepetidoSemE2e(a.emailConta ?? '(conta ainda não identificada)', cleanPhone, c, img, v.valor, v.repetidoTardio);
    return true;
  }
  // A Bia (LimpaPro) divide a linha IO e o CNPJ da Aioros: o Pix de um lead dela não
  // é assunto do SolarDoc.
  try {
    const { ehLeadRecuperacao } = await import('./biaInboundService');
    if (await ehLeadRecuperacao(cleanPhone)) return false;
  } catch (err) {
    logger.error('pix-comprovante', 'checar lead da Bia falhou (segue)', err);
  }
  // Pausa humana: se uma pessoa está na conversa, o robô não fala por cima.
  try {
    const { podeFalarComLead } = await import('./pausaHumana');
    if (!(await podeFalarComLead(cleanPhone)).pode) return false;
  } catch (err) {
    logger.error('pix-comprovante', 'checagem da pausa humana falhou (segue)', err);
  }
  const ctl = await controleDeInsistencia({ cleanPhone, c, v, img, emailConta: a.emailConta });
  if (ctl === 'silencio') return true;
  if (ctl === 'explicado') return legendaVazia(texto);

  if (a.thiagoJaAvisado) {
    // Nada: o aviso ao Thiago já saiu de dentro do aplicarPagamentoPix.
  } else if (v.codigo === 'recebedor') {
    // Pix para outra empresa de quem fala do SolarDoc: o Thiago quer saber (1 linha).
    await notificarThiago(
      { email: a.emailConta ?? '(conta ainda não identificada)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
      '⚠️ Possível pagamento a TERCEIRO (recebedor não é a Aioros). Respondi ao cliente. Confere se faz sentido.',
    );
  } else if (avisaThiagoDoReprovado(v)) {
    await notificarThiago(
      { email: a.emailConta ?? '(conta ainda não identificada)', phone: cleanPhone, valor: v.valor, comprovante: c }, img,
      `⚠️ REVISAR — ${v.motivo}. Respondi ao cliente com a explicação. Se o dinheiro chegou na Aioros, libera no /admin ("+ Pix").`,
    );
  }
  await guardarHandoffComprovante(cleanPhone, montarHandoff(c, v, originInstance));
  await sendHuman(cleanPhone, [mensagemFixaReprovado(c, v)], originInstance, { maxBolhas: 1 }).catch(() => {});
  logger.info('pix-comprovante', `reprovado, mensagem fixa enviada (${cleanPhone}) motivo=${v.motivo}`);
  return true;
}

async function processarComprovanteDesconhecido(
  cleanPhone: string, img: ImgSrc, originInstance: ZapiInstance, texto: string,
  solicitado: PixSolicitado | null = null,
): Promise<boolean> {
  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → segue fluxo, sem enviar nada

  const v = await validarComprovante(c, cleanPhone, { exigirIdPix: true });
  const conta = await acharContaPelaConversa(cleanPhone, texto);

  // Reprovado (inclusive pela trava do código da transação). `thiagoJaAvisado`: o
  // aplicarPagamentoPix já avisou.
  const reprovar = async (vR: ResultadoValidacao, thiagoJaAvisado = false): Promise<boolean> => {
    // Reenvio do mesmo comprovante, sem legenda: silêncio.
    if (vR.jaUsado === 'telefone' && legendaVazia(texto)) {
      logger.info('pix-comprovante', `desconhecido: reenvio de comprovante já usado (${cleanPhone})`);
      return true;
    }
    // Só age com sinal do SolarDoc: Pix pedido ou e-mail de conta existente na conversa
    // (o abandono nunca chega aqui: tem ramo próprio). Sem sinal (pagamento de obra
    // solar, foto qualquer), o fluxo segue como sempre, sem resposta nossa.
    if (!solicitado && !conta) {
      logger.info('pix-comprovante', `desconhecido: reprovado e sem sinal do SolarDoc (${cleanPhone}) motivo=${vR.motivo}`);
      // Calado pro cliente, mas código de outro número avisa o Thiago (1 vez por código).
      await avisarTxidOutroSemSinal(cleanPhone, c, img, vR);
      return false;
    }
    return reprovadoComMensagemFixa({
      cleanPhone, c, v: vR, img, originInstance, texto, emailConta: conta?.email ?? null, thiagoJaAvisado,
    });
  };

  if (!v.passou || !AUTO_LIBERAR) {
    // Passou nas travas, mas o AUTO está desligado: quem decide é o Thiago.
    if (v.passou) {
      if (conta) {
        await notificarThiago(
          { email: conta.email, phone: cleanPhone, valor: v.valor, comprovante: c }, img,
          '⚠️ REVISAR (número desconhecido) — liberação automática desligada. Se ok, libera no /admin ("+ Pix").',
        );
      }
      return false;
    }
    return reprovar(v);
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
    // Quem pagou e mandou a foto sem e-mail reserva o código JÁ: senão outro número
    // encaminhando a mesma foto antes do e-mail chegar levaria o dele à revisão.
    // Reserva acusou outro dono (corrida): é reprovado, não vira pendente.
    if (await reservarTxid(v.txid, cleanPhone, v.valor) === 'outro') return reprovar(reprovadoPorTxid(v));
    await guardarComprovantePendente(cleanPhone, {
      valor: v.valor, dedupKey: v.dedupKey, passou: true, em: new Date().toISOString(), e2eKey: v.e2eKey,
      txid: v.txid, modo: v.modo ?? 'tabela', data: c.data ?? null,
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
      v.modo === 'parcial'
        // Parcial: "libero na hora" prometeria o que ainda não é verdade.
        ? `Recebi seu comprovante de R$ ${valorBr(v.valor)}. Qual o e-mail da sua conta no SolarDoc? Assim que você mandar, eu aplico esse pagamento na conta.`
        : `Recebi seu comprovante de R$ ${valorBr(v.valor)}. Qual o e-mail da sua conta no SolarDoc? Assim que você mandar, eu libero na hora.`,
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

  const razao = await razaoSocialDe(conta.id);
  const r = await aplicarPagamentoPix({
    user: conta,
    pag: { valor: v.valor, dedupKey: v.dedupKey, e2eKey: v.e2eKey, txid: v.txid, modo: v.modo ?? 'tabela', data: c.data ?? null },
    cleanPhone, originInstance, comprovante: c, img, via: 'desconhecido',
    confirmar: async ({ venc, total, alvo }) => {
      // Conta que já existia: NUNCA manda link de senha. Quem digitou o e-mail pode
      // não ser o dono dele.
      await sendHuman(cleanPhone, [
        textoConfirmacao({ valor: total, plano: alvo.plano, venc, email: conta.email, razao, linkSenha: null }),
      ], originInstance, { maxBolhas: 1 }).catch(() => {});
    },
    statusThiago: ({ venc }) => `✅ *AUTO-LIBERADO (número desconhecido + e-mail da conversa)* — vence ${diaMes(venc)}. Confere e arquiva o comprovante.`,
  });
  if (r.resultado === 'duplicado') return true;
  // Código de outro número pego na reserva: segue a regra do reprovado (o Thiago já sabe).
  if (r.resultado === 'txid_outro') return reprovar(reprovadoPorTxid(v), true);
  await gravarWhatsappSeLivre(conta.id, conta.whatsapp, cleanPhone);
  // Se havia um pendente do mesmo comprovante (a conta só apareceu agora), consome.
  if (solicitado?.comprovante?.dedupKey === v.dedupKey) await limparComprovantePendente(cleanPhone);
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
    // Reprovado e sem e-mail: não guarda pendente nem pede e-mail. A Giovanna explica.
    if (!v.passou) {
      return reprovadoComMensagemFixa({
        cleanPhone, c, v, img, originInstance, texto,
      });
    }
    // Quem pagou e mandou a foto sem e-mail reserva o código JÁ: senão outro número
    // encaminhando a mesma foto antes do e-mail chegar levaria o dele à revisão.
    // Reserva acusou outro dono (corrida): é reprovado, não vira pendente.
    if (await reservarTxid(v.txid, cleanPhone, v.valor) === 'outro') {
      return reprovadoComMensagemFixa({
        cleanPhone, c, v: reprovadoPorTxid(v), img, originInstance, texto,
      });
    }
    await guardarComprovantePendente(cleanPhone, {
      valor: v.valor, dedupKey: v.dedupKey, passou: v.passou, em: new Date().toISOString(), e2eKey: v.e2eKey,
      txid: v.txid, modo: v.modo ?? 'tabela', data: c.data ?? null,
    });
    await sendHuman(cleanPhone, [
      'Recebi seu comprovante, obrigada! 🙌',
      'Me manda só o *e-mail* que você usa (ou vai usar) no SolarDoc? É com ele que eu libero seu acesso.',
    ], originInstance, { maxBolhas: 1 }).catch(() => {});
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

  const vAb = await validarComprovante(c, cleanPhone);
  const { passou, motivo, valor, dedupKey, e2eKey } = vAb;
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

  // Reprovado: o contexto vai pra Giovanna (a frase fixa "já te libero" prometia o
  // que o sistema não ia fazer).
  if (!passou) {
    return reprovadoComMensagemFixa({
      cleanPhone, c, v: vAb, img, originInstance, texto, emailConta: ab.email,
    });
  }

  if (passou && AUTO_LIBERAR) {
    // 0) Código da transação reservado ANTES de achar/criar a conta: outro número já o
    // usou → reprovado (regra do main), e não nasce conta sem crédito.
    if (await reservarTxid(vAb.txid, cleanPhone, valor) === 'outro') {
      return reprovadoComMensagemFixa({
        cleanPhone, c, v: reprovadoPorTxid(vAb), img, originInstance, texto, emailConta: ab.email,
      });
    }

    // 1) Conta primeiro (idempotente por email UNIQUE). Se FALHAR (erro transitório de
    // DB), NÃO queima o dedup — tranquiliza o cliente e chama o Thiago, permitindo retry
    // no reenvio (senão o pagante ficaria preso em silêncio).
    // Sem linha de abandono, o e-mail veio DIGITADO na conversa (de quem quer que
    // seja): não toma o WhatsApp da conta e não ganha link de senha de conta velha.
    const u = await getOrCreatePixUser(ab.email, ab.nome, cleanPhone, { whatsappSoSeLivre: !abRow });
    if (!u) {
      await sendHuman(cleanPhone, [
        'Recebi seu comprovante! 🙌 Tô confirmando aqui e já te libero — qualquer coisa te aviso por aqui.',
      ], originInstance, { maxBolhas: 1 }).catch(() => {});
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

    // 3) Aplica o pagamento (travas atômicas, soma de parciais, libera quando chega a R$ 67).
    const r = await aplicarPagamentoPix({
      user: u,
      pag: { valor, dedupKey, e2eKey, txid: vAb.txid, modo: vAb.modo ?? 'tabela', data: c.data ?? null },
      cleanPhone, originInstance, comprovante: c, img, via: abRow ? 'abandono' : 'pix-solicitado',
      // Só quando LIBERA: o abandono é marcado como recuperado e o dunning é encerrado.
      aposLiberar: async () => {
        // Só quem veio de abandono tem linha pra marcar como recuperada.
        if (ab.id) {
          await supabase.from('abandoned_checkouts')
            .update({ status: 'recovered', recovered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', ab.id);
        }
      },
      confirmar: async () => {
        const linhas = ['Pagamento confirmado! ✅ Seu acesso ao SolarDoc (plano completo) está *liberado* 🌞'];
        const mandaLink = abRow ? !u.password_hash : u.criadaAgora;
        if (mandaLink && u.reset_token) {
          linhas.push(`Pra entrar, é só definir sua senha aqui: ${dashboardUrl}/auth?mode=redefinir&token=${u.reset_token}`);
        } else {
          linhas.push(`É só entrar em ${dashboardUrl} com seu email (${ab.email}). Qualquer dúvida, me chama! 🙌`);
        }
        await sendHuman(cleanPhone, linhas, originInstance, { maxBolhas: 1 }).catch(() => {});
      },
      statusThiago: ({ venc }) => `✅ *AUTO-LIBERADO (abandono→Pix)* — vence ${venc.toLocaleDateString('pt-BR')}. Confere e arquiva.`,
    });
    // Código de outro número pego na reserva: segue a regra do reprovado (o Thiago já sabe).
    if (r.resultado === 'txid_outro') {
      return reprovadoComMensagemFixa({
        cleanPhone, c, v: reprovadoPorTxid(vAb), img, originInstance, texto, emailConta: ab.email, thiagoJaAvisado: true,
      });
    }
    return true;
  }

  // Passou nas travas mas o AUTO está desligado → recebe, tranquiliza o cliente e sinaliza pro Thiago.
  await sendHuman(cleanPhone, [
    'Recebi seu comprovante! 🙌 Vou confirmar aqui e já te libero o acesso — qualquer coisa te aviso por aqui.',
  ], originInstance, { maxBolhas: 1 }).catch(() => {});
  await notificarThiago(
    { email: ab.email, phone: cleanPhone, valor, comprovante: c }, img,
    passou ? `✅ Passou nas travas (${brl(valor)}). Liberar no /admin ("+ Pix").`
           : `⚠️ REVISAR (abandono→Pix) — ${motivo}. Se ok, libera no /admin ("+ Pix").`,
  );
  logger.info('pix-comprovante', `FLAG (abandono) ${ab.email} passou=${passou} motivo=${motivo}`);
  return true;
}
