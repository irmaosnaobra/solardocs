// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): O COFRE da senha do app de monitoramento.
//
// AES-256-GCM, com a chave derivada por HKDF do `segredoDoVinculo()` e o rótulo `cofre-monitoramento-v1`. A senha cifrada mora no JSON privado da
// obra e nunca vai para o `system_state`, para o GET da obra nem para log. Só sócio revela, por rota própria. Trocar o `VINCULO_SOLAR_SECRET`
// apaga o acesso às senhas guardadas (a rota responde "O cofre não abriu. Grave a senha de novo.").
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { segredoDoVinculo } from './vendaSolarHub';
import { ErroJornada } from './jornadaSolarBanco';

export interface Cifra { cifra: string; iv: string; tag: string }

export function chaveDoCofre(): Buffer {
  const segredo = segredoDoVinculo();
  if (!segredo) throw new ErroJornada('sem_segredo');
  return Buffer.from(crypto.hkdfSync('sha256', segredo, 'jornada-solar', 'cofre-monitoramento-v1', 32));
}

/** Cifra o texto: IV de 12 bytes aleatório a cada vez (duas cifras do mesmo texto saem diferentes). */
export function cifrar(texto: string): Cifra {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveDoCofre(), iv);
  const cifra = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return { cifra: cifra.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

/** Confere a tag e devolve o texto. Falha (tag mexida, segredo trocado) lança. */
export function decifrar(x: Cifra): string {
  const d = crypto.createDecipheriv('aes-256-gcm', chaveDoCofre(), Buffer.from(x.iv, 'base64'));
  d.setAuthTag(Buffer.from(x.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(x.cifra, 'base64')), d.final()]).toString('utf8');
}
