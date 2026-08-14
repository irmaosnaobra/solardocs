// ─────────────────────────────────────────────────────────────────────────────
// AVISO DE VENDA NO WHATSAPP DO DONO
//
// Até 06/08/2026 uma venda de CARTÃO não avisava ninguém: o webhook da Stripe
// criava a conta, mandava e-mail e WhatsApp PRO CLIENTE, gravava o ledger e
// disparava Meta/UTMify — e o Thiago só ficava sabendo se abrisse o painel. O
// único caminho que falava com ele era o do Pix (notificarThiago no
// pixComprovanteService), e o copiloto de tráfego, que ele desligou em 23/07.
//
// Aqui: uma mensagem por venda, na hora, com o que decide o próximo passo —
// quem comprou, quanto, se o dinheiro entrou agora e de qual anúncio veio.
//
// LINHA: sai pela 'solardoc' (B2B). É de propósito não usar a IO: em 06/08 ela
// estava caída pela terceira vez, e o aviso de venda não pode morar na linha
// que mais cai. Se o desvio ZAPI_SOLARDOC_VIA_IO estiver ligado, o zapiClient
// redireciona sozinho — é o que se quer quando a B2B é a que está fora.
//
// E-MAIL: só quando o WhatsApp falha. sendOpsAlert é a caixa de "algo quebrou";
// mandar toda venda por lá também apagaria esse significado.
// ─────────────────────────────────────────────────────────────────────────────

import { sendWhatsApp } from './agents/zapiClient';
import { sendOpsAlert } from '../utils/mailer';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { decisaoMeta, OrigemVenda, TEXTO_MOTIVO, TEXTO_ORIGEM } from './salesLedger';

const DONO_PHONE = (process.env.VENDA_AVISO_PHONE || '34991360223').trim();

export type VendaAviso = {
  produto: string;              // 'VIP' | 'VIP PROMO' | 'PRO'
  valor: number;                // preço mensal real em R$ (27/49/67)
  cobrouAgora: boolean;         // cartão passou AGORA (sem trial) ou só capturou
  email: string | null;
  nome: string | null;
  phone: string | null;         // só dígitos
  utmSource?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  // ausente = quem chamou não conseguiu apurar (nenhuma linha é escrita);
  // null = apurou e falhou (a mensagem DIZ que não deu pra conferir).
  historico?: HistoricoCliente | null;
  // DE ONDE CHEGOU (14/08/2026): classificado em salesLedger.classificarOrigem.
  // Ausente = quem chamou não classifica (ex.: PlugCash) → a mensagem cai na
  // linha de UTM crua de antes, sem falar de Meta.
  origem?: OrigemVenda | null;
  origemDetalhe?: string | null;
};

// DUAS opções, decisão do Thiago em 14/08: ou o e-mail nunca comprou (VENDA),
// ou já comprou (RECORRENTE). Se a assinatura antiga ainda está de pé não muda
// o tipo — vira uma observação dentro da própria linha, porque quem paga duas
// vezes abre chargeback e isso não pode sumir do aviso.
export type HistoricoCliente = {
  tipo: 'novo' | 'recorrente';
  primeiraCompra: string | null;   // ISO da compra mais antiga deste e-mail
  comprasAnteriores: number;
  assinaturaAtiva: boolean;        // a anterior continua cobrando?
};

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

// Devolve '' em data impossível de ler: textoAvisoVenda roda DEPOIS de a trava
// `aviso_dono_em` ser tomada, então um throw aqui apagaria o aviso pra sempre —
// sem WhatsApp e sem o e-mail de resgate.
const dataBR = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(d);
};

// O Thiago pediu o número de MESES. Abaixo de 30 dias, mês vira "0 meses" e
// mente — então esse trecho fala em dias, que é o que a pessoa quer saber.
export function tempoDeCasa(iso: string | null): string {
  if (!iso) return '';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(dias) || dias < 0) return '';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30.44);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}

// UM EMOJI POR TIPO, e ele abre a mensagem.
//
// A prévia da notificação do WhatsApp mostra só a PRIMEIRA LINHA — se o sinal
// morasse no meio do texto, o Thiago teria que abrir a conversa pra saber se a
// venda foi aquisição ou recompra. Por isso o emoji manda no cabeçalho, e se
// repete na linha *Cliente* pra quem já está lendo por dentro.
const EMOJI: Record<HistoricoCliente['tipo'], string> = {
  novo:       '💰',
  recorrente: '🔄',
};

// Formato do Thiago: emoji DENTRO do negrito e colado na palavra, o tipo
// abrindo a linha. Curto de propósito — a prévia da notificação corta o resto.
const TITULO: Record<HistoricoCliente['tipo'], string> = {
  novo:       '*💰VENDA SolarDoc*',
  recorrente: '*🔄RECORRENTE SolarDoc*',
};

export function tituloAvisoVenda(h: HistoricoCliente | null | undefined): string {
  // Sem histórico apurado o título não inventa tipo — cai no de venda comum.
  return h ? TITULO[h.tipo] : '*💰VENDA SolarDoc*';
}

function linhaCliente(h: HistoricoCliente | null | undefined): string[] {
  if (h === undefined) return [];
  if (h === null) return ['❔ *Cliente:* _não deu pra conferir o histórico_'];
  if (h.tipo === 'novo') return [`${EMOJI.novo} *Cliente:* NOVO — primeira compra`];

  const tempo = tempoDeCasa(h.primeiraCompra);
  const dia = h.primeiraCompra ? dataBR(h.primeiraCompra) : '';
  const nEsima = `${h.comprasAnteriores + 1}ª compra neste e-mail`;
  const desde = dia ? `desde ${dia}${tempo ? ` (${tempo})` : ''}` : 'já comprou antes';
  // Uma linha só. A assinatura antiga viva vira um trecho dela — não um tipo
  // novo: é o sinal de cobrança dobrada, e some junto se sair daqui.
  const anterior = h.assinaturaAtiva ? ' · a ANTERIOR ainda está ativa' : '';
  return [`${EMOJI.recorrente} *Cliente:* RECORRENTE — ${desde} · ${nEsima}${anterior}`];
}

// ── DE ONDE CHEGOU + FOI PRO META? ──────────────────────────────────────────
// As duas linhas que o Thiago pediu em 14/08: o pixel passou a receber só venda
// NOVA, então o aviso precisa dizer, na hora, quem fechou a venda e se ela vai
// (ou não) aparecer no gerenciador. Sem isto a venda de follow-up somia do Meta
// e não reaparecia em lugar nenhum.
//
// A decisão vem da MESMA função do gate (decisaoMeta) — se cada lado calculasse
// a sua, o aviso diria "contabilizada" numa venda que o ledger pulou.
function linhasOrigem(v: VendaAviso): string[] {
  const utmsCru = [v.utmSource, v.utmCampaign, v.utmContent].filter(Boolean).join(' · ');
  if (!v.origem) {
    return [`*Origem:* ${utmsCru || '_sem UTM (direto, orgânico ou order bump)_'}`];
  }

  const de = [TEXTO_ORIGEM[v.origem], v.origemDetalhe, v.utmContent]
    .filter(Boolean).join(' · ');

  // Sem histórico apurado não dá pra afirmar nada: o gate faz a própria leitura
  // e pode achar uma compra anterior que o aviso não viu. Aí a linha diz que não
  // deu pra conferir, em vez de prometer "contabilizada" e mentir.
  const clienteNovo = v.historico ? v.historico.tipo === 'novo' : true;
  const { envia, motivo } = decisaoMeta({ origem: v.origem, clienteNovo });
  const meta = !envia
    ? `*Meta:* NÃO enviada — ${TEXTO_MOTIVO[motivo!]}`
    : v.historico
      ? '*Meta:* contabilizada no anúncio'
      : '*Meta:* _não deu pra conferir se foi contabilizada_';

  return [`*De onde chegou:* ${de}`, meta];
}

export function textoAvisoVenda(v: VendaAviso): string {
  return [
    tituloAvisoVenda(v.historico),
    '',
    `*Plano:* ${v.produto} · ${brl(v.valor)}/mês`,
    // A distinção que o Thiago perguntou em 06/08: cobrança imediata virou o
    // padrão do plano único, mas o downsell de R$49 ainda pode nascer em trial.
    v.cobrouAgora
      ? '*Dinheiro:* entrou agora (cartão cobrado)'
      : '*Dinheiro:* ainda NÃO entrou — começou em teste grátis',
    ...linhaCliente(v.historico),
    `*Nome:* ${v.nome || '_não informado_'}`,
    `*E-mail:* ${v.email || '_não informado_'}`,
    ...(v.phone ? [`*WhatsApp:* wa.me/${v.phone}`] : []),
    ...linhasOrigem(v),
  ].join('\n');
}

// Status da Stripe que significam "esta assinatura ainda cobra". Mesmo conjunto
// do stripeSyncService (past_due dentro: dunning ainda vai tentar o cartão).
const STATUS_VIVO = new Set(['active', 'trialing', 'past_due', 'paid']);

/**
 * Este e-mail já comprou antes? E, se comprou, a assinatura velha ainda está de pé?
 *
 * DUAS FONTES, nessa ordem:
 *  1) a Stripe, quando a linha antiga tem subscription_id — é a verdade do minuto;
 *  2) o ledger `sales`, que o syncStripePlans reconcilia de hora em hora — cobre
 *     as 48 linhas do backfill, que não têm subscription_id nenhum.
 * O ledger sozinho erraria justamente no caso de quem cancela e recompra dentro
 * da mesma hora: ele ainda diria "ativa" e o aviso gritaria duplicidade à toa.
 *
 * A venda ATUAL é excluída por checkout_session_id (o upsertSale já gravou a
 * linha dela antes daqui) — exclusão explícita, não dependente de ordem: numa
 * reentrega do webhook a linha já existe e continua sendo excluída.
 *
 * Nunca joga: falha de banco/Stripe devolve `null`, e o aviso diz que não deu
 * pra conferir em vez de chutar "cliente novo".
 */
export async function historicoDoCliente(args: {
  email: string | null;
  checkoutSessionIdAtual: string;
  subscriptionIdAtual?: string | null;
  /** confirma na Stripe se a assinatura antiga está viva (opcional) */
  assinaturaViva?: (subscriptionId: string) => Promise<boolean>;
}): Promise<HistoricoCliente | null> {
  const email = (args.email || '').toLowerCase().trim();
  if (!email) return null;

  let linhas: Array<Record<string, any>>;
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('checkout_session_id, subscription_id, status, card_passed_at, created_at')
      .eq('email', email);
    if (error) throw error;
    linhas = data ?? [];
  } catch (err) {
    logger.error('venda-aviso', 'não deu pra ler o histórico do cliente no ledger', err);
    return null;
  }

  // Filtro em JS de propósito: `.neq()` no Postgres descarta linha com a coluna
  // NULL (NULL <> 'x' é NULL), o que esconderia compras antigas em silêncio.
  const anteriores = linhas.filter((r) =>
    r.checkout_session_id !== args.checkoutSessionIdAtual
    && !(args.subscriptionIdAtual && r.subscription_id === args.subscriptionIdAtual));

  if (!anteriores.length) {
    return { tipo: 'novo', primeiraCompra: null, comprasAnteriores: 0, assinaturaAtiva: false };
  }

  const quando = (r: Record<string, any>) => (r.card_passed_at || r.created_at) as string | null;
  const datas = anteriores.map(quando).filter((d): d is string => !!d).sort();

  // DA MAIS NOVA PRA MAIS VELHA antes de cortar em 3: o Postgres devolve sem
  // ordem, e quem tem 4 assinaturas antigas (já existe um caso, 3 subs no mesmo
  // e-mail) poderia ter justo a VIVA fora do corte — e o aviso deixaria de
  // avisar da cobrança dobrada exatamente no comprador mais repetido.
  let viva: boolean | null = null;
  const subs = [...new Set(
    [...anteriores]
      .sort((a, b) => String(quando(b) ?? '').localeCompare(String(quando(a) ?? '')))
      .map((r) => r.subscription_id)
      .filter(Boolean) as string[],
  )].slice(0, 3);
  if (args.assinaturaViva && subs.length) {
    try {
      viva = (await Promise.all(subs.map((s) => args.assinaturaViva!(s)))).some(Boolean);
    } catch (err) {
      logger.error('venda-aviso', 'Stripe não respondeu sobre a assinatura antiga — usando o ledger', err);
    }
  }
  if (viva === null) viva = anteriores.some((r) => STATUS_VIVO.has(String(r.status)));

  return {
    tipo: 'recorrente',
    primeiraCompra: datas[0] ?? null,
    comprasAnteriores: anteriores.length,
    assinaturaAtiva: viva,
  };
}

/**
 * Avisa o dono de uma venda nova. Idempotente por linha do ledger.
 *
 * A TRAVA é tomada ANTES do envio de propósito: o webhook da Stripe reentrega
 * por até 3 dias, e uma venda avisada duas vezes ensina o dono a ignorar o
 * aviso. Se WhatsApp E e-mail falharem, o aviso não sai depois — sobra o log e
 * a linha em `sales`, que é o que o painel já mostra.
 *
 * Venda SEM linha no ledger (upsertSale falhou) avisa sem trava: perder o aviso
 * dela seria perder a única pista de que ela existiu.
 */
export async function avisarVendaAoDono(
  saleId: string | null,
  v: VendaAviso,
): Promise<'enviado' | 'email' | 'duplicado'> {
  if (saleId) {
    const { data: claim } = await supabase
      .from('sales')
      .update({ aviso_dono_em: new Date().toISOString() })
      .eq('id', saleId)
      .is('aviso_dono_em', null)
      .select('id')
      .maybeSingle();
    if (!claim) return 'duplicado';
  }

  const texto = textoAvisoVenda(v);
  try {
    await sendWhatsApp(DONO_PHONE, texto, 'solardoc');
    return 'enviado';
  } catch (err) {
    logger.error('venda-aviso', 'WhatsApp da venda não passou — caindo pro e-mail', err);
    await sendOpsAlert(
      // O e-mail de resgate carrega o MESMO sinal do WhatsApp: quando a linha
      // cai, é ele que vira o aviso — e a distinção não pode cair junto.
      `${v.historico ? `${EMOJI[v.historico.tipo]} ` : '💰 '}Venda nova ` +
      `(${v.produto} · ${brl(v.valor)}) — o WhatsApp não passou`,
      `<p>Uma venda entrou e o aviso pelo WhatsApp <strong>falhou</strong> (linha fora, cooldown ou token). ` +
      `Segue o conteúdo:</p><pre style="white-space:pre-wrap;font-family:inherit">${texto.replace(/\*/g, '')}</pre>` +
      `<p style="color:#64748b;font-size:13px;">Se este e-mail virou rotina, a linha B2B está caída — é ela que leva os avisos de venda.</p>`,
    ).catch((e) => logger.error('venda-aviso', 'e-mail de fallback também falhou', e));
    return 'email';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RENOVAÇÃO MENSAL
//
// A plataforma é assinatura: todo mês a Stripe cobra de novo. Até aqui só a
// PRIMEIRA cobrança avisava alguém — o dinheiro que entra do mês 2 em diante
// (que é a maior parte dele) passava em silêncio absoluto.
//
// Sai pela mesma linha e com o mesmo formato de cabeçalho da venda, trocando
// só o rótulo: *💰VENDA SolarDoc* é cliente novo, *🔄RECORRENTE SolarDoc* é
// o mês que renovou.
// ─────────────────────────────────────────────────────────────────────────────

export type RenovacaoAviso = {
  produto: string;
  valor: number;                 // o que a Stripe COBROU agora (não o de tabela)
  email: string | null;
  nome: string | null;
  phone: string | null;
  clienteDesde: string | null;   // ISO da primeira compra deste e-mail
};

// "3º mês" a partir da primeira compra do e-mail. Renovação é sempre >= 2º.
function mesDaAssinatura(desde: string | null): number | null {
  if (!desde) return null;
  const dias = Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
  if (!Number.isFinite(dias) || dias < 0) return null;
  return Math.max(2, Math.floor(dias / 30.44) + 1);
}

export function textoAvisoRenovacao(v: RenovacaoAviso): string {
  const mes = mesDaAssinatura(v.clienteDesde);
  const dia = v.clienteDesde ? dataBR(v.clienteDesde) : '';
  const tempo = tempoDeCasa(v.clienteDesde);
  const casa = [mes ? `${mes}º mês` : '', tempo, dia ? `desde ${dia}` : '']
    .filter(Boolean).join(' · ');

  return [
    TITULO.recorrente,
    '',
    `*Plano:* ${v.produto} · ${brl(v.valor)}/mês`,
    '*Dinheiro:* entrou agora (renovação cobrada)',
    `🔄 *Cliente:* ${casa || '_tempo de casa não apurado_'}`,
    `*Nome:* ${v.nome || '_não informado_'}`,
    `*E-mail:* ${v.email || '_não informado_'}`,
    ...(v.phone ? [`*WhatsApp:* wa.me/${v.phone}`] : []),
  ].join('\n');
}

/**
 * Avisa o dono de uma RENOVAÇÃO mensal. Idempotente por fatura.
 *
 * A trava é `system_state` com a chave `venda_aviso_invoice:<invoice.id>`, e não
 * a coluna `aviso_dono_em` de `sales`: aquela linha é da VENDA, uma só, e
 * carimbá-la na primeira renovação faria todas as outras — todo mês, pra sempre
 * — voltarem como 'duplicado' sem ninguém perceber.
 *
 * INSERT contra a PK = trava atômica: a reentrega da Stripe bate em 23505 e
 * desiste. Tomada ANTES do envio, mesma escolha da venda (avisar duas vezes
 * ensina o dono a ignorar o aviso).
 */
export async function avisarRenovacaoAoDono(
  invoiceId: string,
  v: RenovacaoAviso,
): Promise<'enviado' | 'email' | 'duplicado'> {
  const { error: travaErr } = await supabase
    .from('system_state')
    .insert({ key: `venda_aviso_invoice:${invoiceId}`, value: { em: new Date().toISOString() } });
  if (travaErr) {
    // 23505 = já avisada. Qualquer outro erro também para aqui: sem trava
    // confiável, o risco de repetir todo mês é pior que o de perder um aviso.
    if ((travaErr as { code?: string }).code !== '23505') {
      logger.error('venda-aviso', 'trava da renovação falhou — não vou arriscar avisar em dobro', travaErr);
    }
    return 'duplicado';
  }

  const texto = textoAvisoRenovacao(v);
  try {
    await sendWhatsApp(DONO_PHONE, texto, 'solardoc');
    return 'enviado';
  } catch (err) {
    logger.error('venda-aviso', 'WhatsApp da renovação não passou — caindo pro e-mail', err);
    await sendOpsAlert(
      `🔄 Renovação (${v.produto} · ${brl(v.valor)}) — o WhatsApp não passou`,
      `<p>Uma renovação foi cobrada e o aviso pelo WhatsApp <strong>falhou</strong>. Segue o conteúdo:</p>` +
      `<pre style="white-space:pre-wrap;font-family:inherit">${texto.replace(/\*/g, '')}</pre>`,
    ).catch((e) => logger.error('venda-aviso', 'e-mail de fallback da renovação também falhou', e));
    return 'email';
  }
}
