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

export function clientIp(req: Request): string {
  // Vercel injeta X-Forwarded-For. Pega o primeiro IP da lista (cliente real).
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  const xri = String(req.headers['x-real-ip'] || '').trim();
  if (xri) return xri;
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// 'abertura_expirada' é a abertura de um link que já venceu: o cliente ainda
// está olhando, só não vê mais os valores. Fica fora de 'abertura' de propósito —
// o contador de acessos da proposta não deve subir com quem viu a tela de
// expirado, senão o consultor lê "5 visualizações" de uma proposta que ninguém
// mais consegue ler.
const EVENTOS_VALIDOS = new Set(['abertura', 'abertura_expirada', 'click_wpp_cta', 'click_wpp_expirado', 'click_wpp_consultor', 'click_pdf']);

/**
 * O registro de um evento do link da proposta: grava em proposta_acessos (RPC registrar_acesso_ev) e, nos eventos de
 * engajamento, avisa o consultor (notificarConsultor, com a trava reservar_aviso_consultor no banco). É a ÚNICA lógica de rastreio do link:
 * o POST /track (navegador do cliente, link ?p=) e o pixel do orçamento oficial (GET /gerador/completa/:codigo/o.gif)
 * chamam esta mesma função, então o aviso e o intervalo são idênticos.
 * Devolve ok:false só quando a gravação falha (o aviso nunca derruba o registro).
 */
export async function registrarEventoGerador(a: {
  codigo: string; evento: string; ip: string; userAgent: string;
  /** Só o GET /pdf de um cliente liga: `click_pdf` registra sempre, mas só avisa o consultor com isto. O POST /track nunca liga. */
  avisarPdf?: boolean;
}): Promise<{ ok: boolean }> {
  const userAgent = String(a.userAgent || '').slice(0, 500);
  const dispositivo = detectDispositivo(userAgent);
  const { cidade, uf, pais } = await geoFromIp(a.ip);

  const { error } = await supabaseGerador.rpc('registrar_acesso_ev', {
    p_codigo: a.codigo,
    p_evento: a.evento,
    p_ip: a.ip || null,
    p_cidade: cidade || null,
    p_uf: uf || null,
    p_pais: pais || null,
    p_user_agent: userAgent || null,
    p_dispositivo: dispositivo,
  });

  if (error) {
    console.error('[track] supabase rpc error:', error);
    return { ok: false };
  }

  // Notifica consultor via Z-API IO — só pra eventos de "engajamento", com a trava no banco.
  // IMPORTANTE: precisa de AWAIT. Em serverless (Vercel) a função é congelada assim
  // que respondemos; um fire-and-forget aqui morre antes de chamar a RPC/WhatsApp
  // (era exatamente por isso que a notificação de "cliente abriu proposta" não chegava).
  // O custo é ~1-2s a mais nesta request de tracking — imperceptível pro cliente.
  // try/catch garante que uma falha de notificação nunca derruba o tracking.
  const avisa = a.evento === 'abertura' || a.evento === 'abertura_expirada' || a.evento === 'click_wpp_cta' || a.evento === 'click_wpp_expirado'
    || (a.evento === 'click_pdf' && a.avisarPdf === true);
  if (avisa) {
    try {
      await notificarConsultor(a.codigo, a.evento, cidade, uf, userAgent);
    } catch (err) {
      console.error('[track] notif consultor falhou:', err);
    }
  }
  return { ok: true };
}

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

    const r = await registrarEventoGerador({ codigo, evento: ev, ip: clientIp(req), userAgent });
    if (!r.ok) {
      res.status(500).json({ error: 'tracking falhou' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[track] exception:', e);
    res.status(500).json({ error: 'erro interno' });
  }
}

/** "pelo celular" (Mobi, Android, iPhone, iPad) ou "pelo computador". */
export function aparelhoDoUA(ua: unknown): string {
  return /Mobi|Android|iPhone|iPad/i.test(String(ua ?? '')) ? 'pelo celular' : 'pelo computador';
}

/**
 * Texto do aviso ao consultor: UMA bolha, emoji só na 1ª linha, sem travessão. Leva a cidade/UF (se a geo achou) e o aparelho
 * pelo User-Agent. Sem cidade, só o trecho da cidade some.
 */
export function textoDoAviso(evento: string, a: { cliente: string; codigo: string; cidade?: string; uf?: string; userAgent?: string }): string {
  const cli = a.cliente || 'Cliente';
  const onde = a.cidade ? `, em ${a.cidade}${a.uf ? '/' + a.uf : ''}` : '';
  const quando = `${onde}, ${aparelhoDoUA(a.userAgent)}`;
  if (evento === 'abertura') return `🟢 *${cli}* abriu sua proposta agora${quando}.\n\nCódigo: ${a.codigo}`;
  if (evento === 'click_pdf') return `📄 *${cli}* baixou o PDF da proposta agora${quando}.\n\nCódigo: ${a.codigo}`;
  if (evento === 'click_wpp_cta') {
    return `🔥 *${cli}* clicou em "Quero fechar pelo WhatsApp" da proposta ${a.codigo}${quando}. Pode chegar mensagem dele agora.`;
  }
  // Abriu, mas o prazo já tinha passado: ele viu a tela de expirado, não os valores. Texto próprio:
  // cair no de "clicou no botão" seria mentira.
  if (evento === 'abertura_expirada') {
    return `⏰ *${cli}* abriu a proposta ${a.codigo}${quando}, mas ela já estava vencida e ele viu a tela de expirado. Vale refazer e reenviar.`;
  }
  if (evento === 'click_wpp_expirado') {
    return `⏰ *${cli}* abriu uma proposta vencida (${a.codigo})${quando} e clicou no botão para falar com você. Refaça a proposta!`;
  }
  return `👀 *${cli}* interagiu com a proposta ${a.codigo}${quando} (${evento}).`;
}

type LinhaAviso = { pode: boolean; consultor_telefone: string; consultor_nome: string; cliente_nome: string };

// A trava de aviso mora no BANCO (MIGRATION_gerador_reserva_aviso.sql): a api é serverless e não guarda memória entre
// chamadas. reservar_aviso_consultor decide, numa operação só, se este aviso sai (30 min por código e grupo; 12 por hora e
// 6 por 10 min no total) e já devolve quem avisar. O fallback para a pode_notificar_consultor antiga vale SÓ quando a função
// nova não existe ainda (o deploy veio antes da migration): PGRST202, ou 42883 citando reservar_aviso_consultor; e 42501.
// Qualquer outro erro (timeout, banco fora, bug na função): log de erro e NENHUM aviso. Nada de cair calado na antiga.
function rpcAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42501') return true;
  return error.code === '42883' && /reservar_aviso_consultor/i.test(String(error.message || ''));
}

async function notificarConsultor(codigo: string, evento: string, cidade?: string, uf?: string, userAgent?: string): Promise<void> {
  let { data, error } = await supabaseGerador.rpc('reservar_aviso_consultor', { p_codigo: codigo, p_tipo: evento });
  if (error && rpcAusente(error)) {
    console.warn('[notif] reservar_aviso_consultor indisponível, usando pode_notificar_consultor:', error.code || error.message);
    ({ data, error } = await supabaseGerador.rpc('pode_notificar_consultor', { p_codigo: codigo }));
  }
  if (error) { console.error('[notif] rpc error:', error); return; }
  if (!data || data.length === 0) return;
  const row = data[0] as LinhaAviso;
  if (!row.pode || !row.consultor_telefone || row.consultor_telefone.length < 10) return;

  await sendWhatsApp(row.consultor_telefone, textoDoAviso(evento, { cliente: row.cliente_nome, codigo, cidade, uf, userAgent }), 'io');
}
