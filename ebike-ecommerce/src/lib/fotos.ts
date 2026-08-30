/**
 * As fotos passam por um endereço nosso antes de chegar ao cliente.
 *
 * Se a página apontasse direto para o CDN, o endereço da imagem entregaria o
 * nome do fornecedor em qualquer "inspecionar elemento". O token abaixo é só o
 * caminho embaralhado em base64url. Não é segredo criptográfico, é o suficiente
 * para a origem não estar escrita na página.
 */

import { BASE_PATH } from '../config/basePath.mjs';

const CDN = 'https://d242jwkdtnhx89.cloudfront.net';

/** Hospedeiros de onde aceitamos servir imagem. Nada fora desta lista passa. */
const HOSTS_PERMITIDOS = new Set(['d242jwkdtnhx89.cloudfront.net', 'd8vlg9z1oftyc.cloudfront.net']);

function base64url(texto: string): string {
  return Buffer.from(texto, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deBase64url(token: string): string {
  const pad = token.length % 4 ? '='.repeat(4 - (token.length % 4)) : '';
  return Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

/**
 * O caminho normal do fornecedor é `soollar_prd/products/<uuid>.<ext>`. Nesse
 * caso o token guarda só o uuid, e o servidor remonta o resto. Nem embaralhado
 * o endereço do fornecedor sai daqui. Qualquer outro formato cai no base64.
 */
const PADRAO = /^https:\/\/([^/]+)\/soollar_prd\/products\/([0-9a-f-]{36})\.(png|jpe?g|webp)$/i;

/**
 * O prefixo entra na mão de propósito. O `next/image` NÃO acrescenta o basePath
 * dentro do parâmetro `url`, só no caminho do otimizador: com src "/foto/x" ele
 * pede /bike/_next/image?url=/foto/x, e aí o servidor procura /foto/x, que sob
 * basePath não existe. Resultado: 404 em toda foto. Provado em produção.
 */
export function enderecoInterno(urlDoCdn: string): string {
  const m = urlDoCdn.match(PADRAO);
  const nome =
    m && m[1] === new URL(CDN).hostname
      ? `p${m[2]}.${m[3].toLowerCase()}`
      : base64url(urlDoCdn);
  return `${BASE_PATH}/foto/${nome}`;
}

/** Devolve a URL original do token, ou null se o token apontar para fora. */
export function urlDoToken(token: string): string | null {
  const curto = token.match(/^p([0-9a-f-]{36})\.(png|jpe?g|webp)$/i);
  if (curto) {
    return `${CDN}/soollar_prd/products/${curto[1].toLowerCase()}.${curto[2].toLowerCase()}`;
  }

  let texto: string;
  try {
    texto = deBase64url(token);
  } catch {
    return null;
  }
  try {
    const url = new URL(texto, CDN);
    if (url.protocol !== 'https:' || !HOSTS_PERMITIDOS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
