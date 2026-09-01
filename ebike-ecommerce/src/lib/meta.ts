import 'server-only';

import { createHash } from 'node:crypto';

import { META_PIXEL } from '../config/pixel.ts';

/**
 * A API de Conversões da Meta: o mesmo evento, mandado pelo SERVIDOR.
 *
 * O pixel do navegador é comido por bloqueador, iOS e aba anônima — na landing
 * do LimpaPro ele enxergava 19% do que o banco registrava. Daqui não tem como
 * bloquear: quem manda somos nós, no momento em que o lead realmente nasce.
 *
 * Vai junto o `event_id` que o navegador usou. É ele que faz a Meta entender
 * que os dois avisos são o MESMO lead; sem isso ela conta em dobro e passa a
 * otimizar a entrega por um número inventado.
 *
 * Manda também CEP, cidade e estado com hash. Não é rastreamento extra: são os
 * dados que a pessoa acabou de digitar para calcular o frete, e é o que permite
 * a Meta casar o lead com a conta dela e aprender de verdade com quem comprou.
 */

const ENDERECO = `https://graph.facebook.com/v21.0/${META_PIXEL}/events`;

/** SHA-256 em minúscula e sem espaço, como a Meta exige. */
function hash(valor: string | null | undefined): string | null {
  const limpo = (valor ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!limpo) return null;
  return createHash('sha256').update(limpo).digest('hex');
}

export async function enviarLeadParaMeta(dados: {
  eventoId: string;
  url: string;
  ip: string | null;
  navegador: string | null;
  fbp: string | null;
  fbc: string | null;
  codigo: string;
  preco: number;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
}): Promise<boolean> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return false;

  const usuario: Record<string, unknown> = {};
  if (dados.ip) usuario.client_ip_address = dados.ip;
  if (dados.navegador) usuario.client_user_agent = dados.navegador;
  if (dados.fbp) usuario.fbp = dados.fbp;
  if (dados.fbc) usuario.fbc = dados.fbc;
  const zp = hash(dados.cep?.replace(/\D/g, ''));
  const ct = hash(dados.cidade);
  const st = hash(dados.uf);
  if (zp) usuario.zp = [zp];
  if (ct) usuario.ct = [ct];
  if (st) usuario.st = [st];
  // Sem nada que identifique, o evento entra sem casar com ninguém e só faz a
  // Meta contar. Melhor não mandar do que sujar o aprendizado.
  if (!Object.keys(usuario).length) return false;

  try {
    const r = await fetch(ENDERECO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        data: [
          {
            event_name: 'Lead',
            event_time: Math.floor(Date.now() / 1000),
            event_id: dados.eventoId,
            event_source_url: dados.url,
            action_source: 'website',
            user_data: usuario,
            custom_data: {
              currency: 'BRL',
              value: dados.preco,
              content_ids: [dados.codigo],
              content_type: 'product',
            },
          },
        ],
      }),
      // Ninguém espera a Meta para falar com o vendedor.
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    // Evento perdido não pode segurar um lead.
    return false;
  }
}
