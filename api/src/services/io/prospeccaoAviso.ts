// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO — o aviso que chega no seu WhatsApp quando alguém da prospecção
// chega no checkout ou compra.
//
// A agente vende sozinha. Isso é bom até o momento em que alguém está com o
// cartão na mão — aí você quer saber NA HORA, não no relatório de amanhã.
//
// A ponte entre os dois bancos é `utm_content`: o link que a agente manda
// carrega os 8 primeiros caracteres do id do contato. É o que transforma
// "alguém da prospecção entrou no checkout" em "a EJS SOLAR entrou no checkout".
//
// Dedup por system_state: cada checkout e cada venda avisam UMA vez. Sem isso,
// o cron de 5 em 5 minutos viraria spam no seu WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';
import { UTM_SOURCE } from './prospeccaoFunil';

const LOG = 'prospeccao-aviso';
const NOTIFY = (process.env.IO_INDICACOES_NOTIFY || '34991360223').trim();
const desligado = () => (process.env.PROSPECCAO_AVISO_OFF || '').trim() === 'true';

/** Marca que já avisamos. Devolve false se já tinha marca — aí ninguém avisa de novo. */
async function primeiraVez(chave: string): Promise<boolean> {
  const { error } = await supabase.from('system_state')
    .insert({ key: chave, value: { avisado_em: new Date().toISOString() } });
  if (error) return false;   // chave duplicada = já avisado
  return true;
}

/** De qual empresa é esse token? Sem isso o aviso vira "alguém" e não serve. */
async function empresaDoToken(token: string | null | undefined) {
  if (!token) return null;
  try {
    // O token são os 8 primeiros hex do uuid sem traços; o id no banco tem
    // traços, então comparo pelo prefixo com o traço no lugar certo.
    const { data } = await supabaseGerador
      .from('prospeccao_contatos')
      .select('empresa, cidade, uf, instagram, telefone')
      .like('id', `${token.slice(0, 8)}-%`).limit(1);
    return data?.[0] ?? null;
  } catch (err) { logger.error(LOG, 'achar empresa pelo token', err); return null; }
}

const quem = (c: any, fallback: string) => c
  ? `${c.empresa}${c.cidade ? ` · ${c.cidade}${c.uf ? '/' + c.uf : ''}` : ''}`
  : fallback;

const comoFalar = (c: any) => c
  ? (c.instagram ? `instagram.com/${c.instagram}` : (c.telefone ? `wa.me/${c.telefone}` : ''))
  : '';

export async function rodarAvisosProspeccao(): Promise<{ checkouts: number; vendas: number }> {
  if (desligado()) { logger.warn(LOG, 'PROSPECCAO_AVISO_OFF=true'); return { checkouts: 0, vendas: 0 }; }

  const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
  let checkouts = 0, vendas = 0;

  // ── 1. VENDA. O aviso que importa. ────────────────────────────────────────
  try {
    const { data } = await supabase.from('sales')
      .select('id, nome, email, valor, plano, utm_content, created_at')
      .eq('utm_source', UTM_SOURCE).gte('created_at', desde).limit(50);

    for (const v of data ?? []) {
      if (!await primeiraVez(`prosp_aviso_venda:${v.id}`)) continue;
      const c = await empresaDoToken(v.utm_content);
      const linha = comoFalar(c);
      await sendWhatsApp(NOTIFY,
        `VENDA PELA PROSPECÇÃO\n\n`
        + `${quem(c, v.nome || v.email || 'sem identificação')}\n`
        + `${v.plano || ''} · R$ ${Number(v.valor || 0).toFixed(2)}\n`
        + (linha ? `${linha}\n` : '')
        + `\nA agente fechou sozinha, do primeiro toque ao pagamento.`,
        'io').catch(e => logger.error(LOG, 'aviso de venda falhou', e));
      vendas++;
    }
  } catch (err) { logger.error(LOG, 'varrer vendas', err); }

  // ── 2. CHECKOUT ABERTO. Ainda dá tempo de ajudar. ─────────────────────────
  // abandoned_checkouts não guarda utm — o vínculo vem de page_visits pela
  // sessão. Sem esse join o aviso não sabe de quem está falando.
  try {
    const { data: ab } = await supabase.from('abandoned_checkouts')
      .select('id, session_id, email, nome, plano, created_at')
      .gte('created_at', desde).limit(50);

    const sess = (ab ?? []).map(a => a.session_id).filter(Boolean);
    if (sess.length) {
      const { data: vis } = await supabase.from('page_visits')
        .select('session_id, utm_content').eq('utm_source', UTM_SOURCE)
        .in('session_id', sess).limit(200);
      const token = new Map((vis ?? []).map(v => [v.session_id, v.utm_content]));

      for (const a of ab ?? []) {
        if (!token.has(a.session_id)) continue;                 // não veio da prospecção
        if (!await primeiraVez(`prosp_aviso_checkout:${a.id}`)) continue;
        const c = await empresaDoToken(token.get(a.session_id));
        const linha = comoFalar(c);
        await sendWhatsApp(NOTIFY,
          `CHEGOU NO CHECKOUT — prospecção\n\n`
          + `${quem(c, a.nome || a.email || 'sem identificação')}\n`
          + `${a.plano || ''}\n`
          + (linha ? `${linha}\n` : '')
          + `\nAbriu o pagamento e ainda não concluiu. Se quiser entrar na conversa, é agora.`,
          'io').catch(e => logger.error(LOG, 'aviso de checkout falhou', e));
        checkouts++;
      }
    }
  } catch (err) { logger.error(LOG, 'varrer checkouts', err); }

  if (checkouts || vendas) logger.info(LOG, `avisou ${vendas} venda(s) e ${checkouts} checkout(s)`);
  return { checkouts, vendas };
}
