/**
 * BASTIDOR — quem enxerga a loja de produtos antes dela abrir pra todo mundo.
 *
 * A loja, o Kit Off-Grid e os cadeados novos ficam visíveis SÓ pra esta lista
 * enquanto o lançamento é validado. Pra todo o resto da base, nada muda: as
 * ferramentas que eram grátis seguem grátis e sem cadeado, e nenhum item novo
 * aparece no menu. Lançamento escondido é lançamento que dá pra desfazer sem
 * ninguém ver.
 *
 * Abrir pra geral NÃO precisa de deploy: é só mexer na env var
 * PRODUTOS_BASTIDOR_EMAILS — deixando ela com `*`, todo mundo entra.
 */

const PADRAO = ['aiorosgroup@gmail.com'];

function lista(): string[] {
  const bruto = (process.env.PRODUTOS_BASTIDOR_EMAILS || '').trim();
  if (!bruto) return PADRAO;
  return bruto.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** `*` na env var libera a loja pra base inteira. */
export function lojaAbertaPraTodos(): boolean {
  return lista().includes('*');
}

export function noBastidor(email: string | null | undefined): boolean {
  if (lojaAbertaPraTodos()) return true;
  const e = (email || '').trim().toLowerCase();
  return !!e && lista().includes(e);
}
