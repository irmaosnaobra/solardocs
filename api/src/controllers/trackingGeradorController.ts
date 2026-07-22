import { Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';

// Geo via ip-api.com (free tier, 45 req/min sem chave). Sem IP -> sem geo.
async function geoFromIp(ip: string): Promise<{ cidade?: string; uf?: string; pais?: string }> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return {};
  }
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,region,city`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return {};
    const j: any = await r.json();
    if (j.status !== 'success') return {};
    return { cidade: j.city, uf: j.region, pais: j.country };
  } catch {
    return {};
  }
}

// Heurística simples mobile/desktop/tablet a partir do UA (sem dependência externa)
function detectDispositivo(ua: string): string {
  const s = (ua || '').toLowerCase();
  if (/ipad|tablet/i.test(s)) return 'tablet';
  if (/mobile|iphone|android.*mobile|windows phone/i.test(s)) return 'mobile';
  if (/android/i.test(s)) return 'tablet';
  return 'desktop';
}

function clientIp(req: Request): string {
  // Vercel injeta X-Forwarded-For. Pega o primeiro IP da lista (cliente real).
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  const xri = String(req.headers['x-real-ip'] || '').trim();
  if (xri) return xri;
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

const EVENTOS_VALIDOS = new Set(['abertura', 'click_wpp_cta', 'click_wpp_expirado', 'click_wpp_consultor', 'click_pdf']);

export async function trackEvent(req: Request, res: Response): Promise<void> {
  try {
    const { codigo, evento } = req.body || {};
    const userAgent = String(req.body?.userAgent || req.headers['user-agent'] || '').slice(0, 500);

    if (!codigo || typeof codigo !== 'string' || !/^\d{8,12}$/.test(codigo)) {
      res.status(400).json({ error: 'codigo invalido' });
      return;
    }
    const ev = String(evento || 'abertura');
    if (!EVENTOS_VALIDOS.has(ev)) {
      res.status(400).json({ error: 'evento invalido' });
      return;
    }

    const ip = clientIp(req);
    const dispositivo = detectDispositivo(userAgent);
    const { cidade, uf, pais } = await geoFromIp(ip);

    const { error } = await supabaseGerador.rpc('registrar_acesso_ev', {
      p_codigo: codigo,
      p_evento: ev,
      p_ip: ip || null,
      p_cidade: cidade || null,
      p_uf: uf || null,
      p_pais: pais || null,
      p_user_agent: userAgent || null,
      p_dispositivo: dispositivo,
    });

    if (error) {
      console.error('[track] supabase rpc error:', error);
      res.status(500).json({ error: 'tracking falhou' });
      return;
    }

    // Notifica consultor via Z-API IO — só pra eventos de "engajamento" e com debounce 2h.
    // IMPORTANTE: precisa de AWAIT. Em serverless (Vercel) a função é congelada assim
    // que respondemos; um fire-and-forget aqui morre antes de chamar a RPC/WhatsApp
    // (era exatamente por isso que a notificação de "cliente abriu proposta" não chegava).
    // O custo é ~1-2s a mais nesta request de tracking — imperceptível pro cliente.
    // try/catch garante que uma falha de notificação nunca derruba o tracking.
    if (ev === 'abertura' || ev === 'click_wpp_cta' || ev === 'click_wpp_expirado') {
      try {
        await notificarConsultor(codigo, ev, cidade, uf);
      } catch (err) {
        console.error('[track] notif consultor falhou:', err);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[track] exception:', e);
    res.status(500).json({ error: 'erro interno' });
  }
}

// Z-API IO (instância Irmãos na Obra). Debounce de 2h por proposta no SQL —
// se a RPC retorna pode=false, simplesmente skipa.
async function notificarConsultor(codigo: string, evento: string, cidade?: string, uf?: string): Promise<void> {
  const { data, error } = await supabaseGerador.rpc('pode_notificar_consultor', { p_codigo: codigo });
  if (error) { console.error('[notif] rpc error:', error); return; }
  if (!data || data.length === 0) return;
  const row = data[0] as { pode: boolean; consultor_telefone: string; consultor_nome: string; cliente_nome: string };
  if (!row.pode || !row.consultor_telefone || row.consultor_telefone.length < 10) return;

  const cli = row.cliente_nome || 'Cliente';
  const local = cidade ? ` em ${cidade}${uf ? '/' + uf : ''}` : '';
  let msg: string;
  if (evento === 'abertura') {
    msg = `🟢 *${cli}* abriu sua proposta agora${local}.\n\nCódigo: ${codigo}`;
  } else if (evento === 'click_wpp_cta') {
    msg = `🔥 *${cli}* clicou no botão "Quero fechar — WhatsApp" da proposta ${codigo}${local}. Pode chegar mensagem dele agora.`;
  } else {
    // click_wpp_expirado
    msg = `⏰ *${cli}* tentou abrir uma proposta expirada (${codigo}) e clicou no botão pra falar com você. Refaça a proposta!`;
  }
  await sendWhatsApp(row.consultor_telefone, msg, 'io');
}
