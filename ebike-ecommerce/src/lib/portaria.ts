/**
 * Portaria do painel.
 *
 * A senha nunca vira cookie: o que fica no navegador é o hash dela com um sal
 * do servidor. Quem copiar o cookie não descobre a senha, e sem a variável de
 * ambiente o hash não confere em outro lugar.
 *
 * Usa Web Crypto (não `node:crypto`) porque o mesmo código roda no proxy e nas
 * rotas do app.
 */

export const COOKIE_PAINEL = 'painel';

export function senhaConfigurada(): string {
  return process.env.PAINEL_SENHA ?? '';
}

/** Com `SITE_PRIVADO=1` a loja inteira, e não só o painel, exige a senha. */
export function sitePrivado(): boolean {
  return process.env.SITE_PRIVADO === '1' || process.env.SITE_PRIVADO === 'true';
}

export async function crachaDaSenha(senha: string): Promise<string> {
  const sal = process.env.PAINEL_SAL ?? 'irmaos-na-obra-mobilidade';
  const bytes = new TextEncoder().encode(`${sal}:${senha}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compara em tempo constante para não vazar a senha pelo tempo de resposta. */
export function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export async function crachaValido(cracha: string | undefined): Promise<boolean> {
  const senha = senhaConfigurada();
  if (!senha || !cracha) return false;
  return iguais(cracha, await crachaDaSenha(senha));
}
