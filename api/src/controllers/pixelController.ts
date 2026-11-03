import { Request, Response } from 'express';
import crypto from 'crypto';
import https from 'https';
import { logger } from '../utils/logger';

// Pixels permitidos (só os ids). O token NUNCA fica no código: vem de process.env.META_SYSTEM_USER_TOKEN
// na hora do envio (o system user acessa os dois pixels; é o mesmo token de utils/metaCapi.ts).
const PIXELS_PERMITIDOS = new Set<string>(['824905216831401', '446093469730871']);

const DEFAULT_PIXEL_ID = '446093469730871';

function hashData(data: string): string {
  if (!data) return '';
  return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

export async function executePixelEvent(params: {
  phone?: string;
  city?: string;
  score?: number;
  event_name?: string;
  fbc?: string;
  fbp?: string;
  event_source_url?: string;
  pixel_id?: string;
  ip?: string | null;
  userAgent?: string | null;
  value?: number;
  currency?: string;
  event_id?: string;
}): Promise<any> {
    const { phone, city, score, event_name, fbc, fbp, event_source_url, pixel_id, ip, userAgent, value, currency, event_id } = params;

    const activePixelId = pixel_id || DEFAULT_PIXEL_ID;

    if (!PIXELS_PERMITIDOS.has(activePixelId)) {
      throw new Error(`Configuração não encontrada para o Pixel: ${activePixelId}`);
    }

    // Mesma ordem de utils/metaCapi.ts: META_SYSTEM_USER_TOKEN e, na falta dele, META_PIXEL_TOKEN.
    const accessToken = (process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '').trim();
    if (!accessToken) {
      logger.warn('pixel', `META_SYSTEM_USER_TOKEN/META_PIXEL_TOKEN ausentes: evento ${event_name || 'Lead'} do pixel ${activePixelId} não enviado`);
      return { skipped: 'sem_token' };
    }

    const eventData = {
      data: [
        {
          event_name: event_name || 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: event_id || undefined,
          action_source: 'website',
          event_source_url: event_source_url || 'https://solardocs-landing.vercel.app/simulador.html',
          user_data: {
            ph: [hashData(phone || '')],
            ct: [hashData(city || '')],
            client_ip_address: IP_WASH(ip || null),
            client_user_agent: userAgent || null,
            fbc: fbc || null,
            fbp: fbp || null,
          },
          custom_data: {
            value: value || score,
            currency: currency || 'BRL',
            content_name: event_name === 'Lead' ? 'Solar Lead Conversion' : (event_name === 'Purchase' ? 'Solar Closed Sale' : 'Solar Site Interaction'),
          },
        },
      ],
    };

    function IP_WASH(ipAddr: string | null) {
      if (!ipAddr) return null;
      if (ipAddr === '::1' || ipAddr === '127.0.0.1') return '127.0.0.1';
      return ipAddr;
    }

    const postData = JSON.stringify(eventData);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/v19.0/${activePixelId}/events?access_token=${accessToken}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length,
        },
      };

      const fbReq = https.request(options, (fbRes) => {
        let responseBody = '';
        fbRes.on('data', (chunk) => { responseBody += chunk; });
        fbRes.on('end', () => {
          try {
            resolve(JSON.parse(responseBody));
          } catch (e) {
            resolve({ raw: responseBody });
          }
        });
      });

      fbReq.on('error', (error) => {
        reject(error);
      });

      fbReq.write(postData);
      fbReq.end();
    });
}

export async function sendPixelEvent(req: Request, res: Response): Promise<void> {
  try {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    const userAgent = (req.headers['user-agent'] as string) || null;

    const fb_response = await executePixelEvent({
      ...req.body,
      ip,
      userAgent
    });

    res.json({ ok: true, fb_response });
  } catch (error: any) {
    console.error('sendPixelEvent controller error:', error);
    res.status(500).json({ error: error.message || 'Erro interno no processamento do evento' });
  }
}
