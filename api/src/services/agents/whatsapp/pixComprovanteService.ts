import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendWhatsApp, sendHuman, ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Confirmação de Pix por COMPROVANTE (cliente SolarDoc).
// Fluxo: cartão falhou → oferecemos Pix → cliente paga e MANDA O COMPROVANTE no
// WhatsApp → a IA (visão) lê o comprovante, valida e AVISA o Thiago na hora.
//
// ROLLOUT SEGURO (jul/2026): começa em SÓ-SINALIZAR (AUTO_LIBERAR=false). A IA lê +
// avisa o Thiago com o resultado das travas; a liberação é o 1-clique dele no
// "+ Pix" do /admin. Depois que ele vir a leitura acertar uns comprovantes reais,
// vira o AUTO com 1 linha. Por que não auto no day-one:
//   (a) não dá pra testar (Z-API inbound + comprovante real + visão);
//   (b) fail-safe cobre DÚVIDA, não "confiante-porém-errado" (photoshop / colisão);
//   (c) o CNPJ Aioros (63636043000188) é o MESMO dos 3 produtos (SolarDoc/LimpaPro/
//       Irmãos na Obra) → um comprovante do curso LimpaPro (R$49) passaria a trava
//       de recebedor. Só o humano sabe pra qual produto foi.
//
// GATE: só roda pra quem NÃO é cartão ativo (past_due/suspended/free) — evita
// corromper o billing de assinante de cartão (o guard pix do sync pararia de
// reconciliar ele com a Stripe) e corta custo de visão em prints de suporte.
// ─────────────────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AUTO_LIBERAR = false;             // FLAG-ONLY até validar a leitura em comprovantes reais
const THIAGO_PHONE = '34991360223';     // avisos de Pix vão pro WhatsApp do dono
const AIOROS_CNPJ  = '63636043000188';  // recebedor esperado (só dígitos)
const PLANOS_VALIDOS = [27, 49, 67];    // valores EXATOS dos planos SolarDoc (PRO/VIP PROMO/VIP)

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

// Retorna true se TRATOU o comprovante (liberou OU sinalizou) — o chamador então
// NÃO cai no LLM geral. Retorna false se não é candidato/não é comprovante (segue fluxo).
export async function tryProcessPixComprovante(
  user: { id: string; email: string; plano: string },
  img: ImgSrc,
  cleanPhone: string,
  originInstance: ZapiInstance = 'solardoc',
): Promise<boolean> {
  // GATE: só cliente que NÃO é cartão ativo/trial é candidato a Pix.
  const { data: uRow } = await supabase.from('users').select('billing_status, plano_expira_em').eq('id', user.id).single();
  const cartaoAtivo = uRow?.billing_status === 'active' || uRow?.billing_status === 'trialing';
  if (cartaoAtivo) return false; // assinante de cartão ok → segue fluxo normal (não mexe no billing)

  const c = await lerComprovante(img);
  if (!c || !c.is_comprovante) return false; // não é comprovante → fluxo normal

  const doc   = (c.recebedor_documento || '').replace(/\D/g, '');
  const nome  = (c.recebedor_nome || '').toLowerCase();
  const valor = Number(c.valor) || 0;
  const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

  // ── Travas ──
  const recebedorOk = doc.includes(AIOROS_CNPJ) || nome.includes('aioros');
  const valorOk = PLANOS_VALIDOS.includes(Math.round(valor)); // valor EXATO de um plano
  let dataOk = true;
  if (c.data) {
    const d = Date.parse(c.data);
    if (!isNaN(d)) dataOk = (Date.now() - d) < 6 * 864e5 && d <= Date.now() + 864e5;
  }
  const dedupKey = `pix_comprov:${c.id_transacao || `${user.id}:${valor}:${c.data || ''}`}`;
  const { data: usado } = await supabase.from('system_state').select('key').eq('key', dedupKey).limit(1);
  const passou = recebedorOk && valorOk && dataOk && !(usado?.length);

  const motivo = usado?.length ? 'comprovante já usado antes (reenvio?)'
    : !recebedorOk ? 'recebedor NÃO parece ser a Aioros'
    : !valorOk ? 'valor não bate com plano (27/49/67)'
    : !dataOk ? 'data fora da janela'
    : 'ok';

  // ── AUTO-LIBERAÇÃO (desligada por enquanto) ──
  if (AUTO_LIBERAR && passou) {
    await supabase.from('system_state')
      .insert({ key: dedupKey, value: { user_id: user.id, valor, data: c.data, at: new Date().toISOString() } })
      .then(() => {}, () => {});
    const now = Date.now();
    const base = (uRow?.plano_expira_em && new Date(uRow.plano_expira_em).getTime() > now)
      ? new Date(uRow.plano_expira_em) : new Date(now);
    base.setMonth(base.getMonth() + 1);
    await supabase.from('users')
      .update({ plano: 'ilimitado', limite_documentos: 999999, billing_status: 'active', plano_expira_em: base.toISOString() })
      .eq('id', user.id);
    await sendHuman(cleanPhone, ['Pagamento confirmado! ✅', 'Seu acesso ao SolarDoc está *liberado por 30 dias*. Bom uso! 🌞'], originInstance).catch(() => {});
    await sendWhatsApp(THIAGO_PHONE, `✅ *Cliente SolarDoc pagou por Pix* (auto-liberado)\n\n${user.email}\nValor: ${brl(valor)}\nVence ${base.toLocaleDateString('pt-BR')}.`, 'solardoc').catch(() => {});
    logger.info('pix-comprovante', `AUTO-liberado ${user.email} ${brl(valor)}`);
    return true;
  }

  // ── SÓ-SINALIZAR (modo atual): a IA leu e avisa o Thiago; ele libera no "+ Pix". ──
  await sendHuman(cleanPhone, [
    'Recebi seu comprovante! 🙌 Vou confirmar aqui e já te libero o acesso — qualquer coisa te aviso por aqui.',
  ], originInstance).catch(() => {});
  const status = passou
    ? `✅ Passou nas travas (recebedor Aioros · ${brl(valor)} · data ok). Pode liberar.`
    : `⚠️ REVISAR — ${motivo}.`;
  await sendWhatsApp(THIAGO_PHONE,
    `*Comprovante Pix — cliente SolarDoc*\n\nCliente: ${user.email}\nWhatsApp: ${cleanPhone}\nValor lido: ${brl(valor)}\nRecebedor: ${c.recebedor_nome || '—'}${doc ? ' (' + doc + ')' : ''}\n\n${status}\n\nConfere e, se ok, libera no /admin pelo botão "+ Pix".`,
    'solardoc').catch(() => {});
  logger.info('pix-comprovante', `FLAG ${user.email} passou=${passou} motivo=${motivo}`);
  return true;
}
