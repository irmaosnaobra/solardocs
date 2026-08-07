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
};

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

export function textoAvisoVenda(v: VendaAviso): string {
  const origem = [v.utmSource, v.utmCampaign, v.utmContent].filter(Boolean).join(' · ');
  return [
    '💰 *VENDA — SolarDoc*',
    '',
    `*Plano:* ${v.produto} · ${brl(v.valor)}/mês`,
    // A distinção que o Thiago perguntou em 06/08: cobrança imediata virou o
    // padrão do plano único, mas o downsell de R$49 ainda pode nascer em trial.
    v.cobrouAgora
      ? '*Dinheiro:* entrou agora (cartão cobrado)'
      : '*Dinheiro:* ainda NÃO entrou — começou em teste grátis',
    `*Nome:* ${v.nome || '_não informado_'}`,
    `*E-mail:* ${v.email || '_não informado_'}`,
    ...(v.phone ? [`*WhatsApp:* wa.me/${v.phone}`] : []),
    `*Origem:* ${origem || '_sem UTM (direto, orgânico ou order bump)_'}`,
  ].join('\n');
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
      `💰 Venda nova (${v.produto} · ${brl(v.valor)}) — o WhatsApp não passou`,
      `<p>Uma venda entrou e o aviso pelo WhatsApp <strong>falhou</strong> (linha fora, cooldown ou token). ` +
      `Segue o conteúdo:</p><pre style="white-space:pre-wrap;font-family:inherit">${texto.replace(/\*/g, '')}</pre>` +
      `<p style="color:#64748b;font-size:13px;">Se este e-mail virou rotina, a linha B2B está caída — é ela que leva os avisos de venda.</p>`,
    ).catch((e) => logger.error('venda-aviso', 'e-mail de fallback também falhou', e));
    return 'email';
  }
}
