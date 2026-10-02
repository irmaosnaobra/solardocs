// ─────────────────────────────────────────────────────────────────────────────
// O LINK DA VERSÃO DO CLIENTE do estudo do local (02/10/2026).
//
// A página do consultor tem roteiro, cuidados, pré-nota e o que a ficha respondeu.
// O cliente recebe OUTRO link, e desse link não dá para chegar no do consultor:
// o token do cliente é o token interno cifrado com AES-256 (dois blocos de 16 bytes,
// sem enchimento, determinístico), com chave tirada do EP_ESTUDO_DB_SEGREDO. Quem só
// tem o link do cliente não tem a chave, então não acha o token interno. Token do
// cliente forjado decifra para um token que não existe e cai na mesma 404.
//
// Sem banco novo e sem migration: a rota decifra e lê pelo token interno de sempre.
//
// ATENÇÃO ao girar o EP_ESTUDO_DB_SEGREDO: todo link de cliente já enviado morre
// junto (passa a dar 404). O do consultor continua valendo.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, createHmac } from 'crypto';
import { BASE_ESTUDO_URL, TOKEN_RE } from './eletropostoEstudoPuro';

export const BASE_CLIENTE_URL = `${BASE_ESTUDO_URL}cliente/`;

function chave(): Buffer | null {
  const s = (process.env.EP_ESTUDO_DB_SEGREDO || '').trim();
  if (s.length < 32) return null;
  return createHmac('sha256', s).update('nexus-estudo-versao-do-cliente').digest();
}

function aes(modo: 'cifra' | 'decifra', hex: string): string | null {
  const k = chave();
  if (!k || !TOKEN_RE.test(hex)) return null;
  const c = modo === 'cifra' ? createCipheriv('aes-256-ecb', k, null) : createDecipheriv('aes-256-ecb', k, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.from(hex, 'hex')), c.final()]).toString('hex');
}

/** Token do cliente a partir do interno. Sem segredo configurado, null (sem link). */
export const tokenDoCliente = (tokenInterno: string): string | null => aes('cifra', tokenInterno);

/** Token interno a partir do token do cliente. */
export const tokenInternoDoCliente = (tokenCliente: string): string | null => aes('decifra', tokenCliente);

export function urlDoCliente(tokenInterno: string): string | null {
  const t = tokenDoCliente(tokenInterno);
  return t ? `${BASE_CLIENTE_URL}${t}` : null;
}
