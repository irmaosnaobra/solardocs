import { Request, Response } from 'express';
import crypto from 'crypto';
import https from 'https';

// Mapeamento de Funis (Tokens e IDs)
const PIXEL_CONFIGS: Record<string, string> = {
  '824905216831401': 'EAAKa1N3Sk1kBRLMt0C1vGgc0nrQjPLyCGBv1vD56nXL64A4COxB3XoGQgvgeKZAcfQ4t99wKtMLPiWF2iDZCP6fqZBc0w7vTZBXxkZBHnCt4C8wcl5C4esTpYKutwupZBUJBcmMEIJUuuD26MuYNY3yghlmeyF2BgdyFVJ9ZApwGC3c3ksbKEBvhyMwYLXhsS6YXgZDZD',
  '446093469730871': 'EAAKa1N3Sk1kBRABfJeKMtxZBJ3IBMvnCCGZBVIWh44G78n0gqm1d3q4MNf6sukReWMOwqSSm8Hir20ZBKyCZAsySY7hwP9jm4ZAb5cm8rcidoK3UFZCq24g5xnycH7lzq3cBSqw3ObpLtYGjIBuEWM3x7RC36u3ZCM4lCi8RGnahU427nQZCXOEqqKhNlmW2fRoC4AZDZD'
};

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
    const accessToken = PIXEL_CONFIGS[activePixelId];

    if (!accessToken) {
      throw new Error(`Configuração não encontrada para o Pixel: ${activePixelId}`);
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
