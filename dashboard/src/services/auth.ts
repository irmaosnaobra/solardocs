import Cookies from 'js-cookie';
import { limparCacheAcessos, limparCachesDeOutros } from '@/lib/acessosCache';

const TOKEN_KEY = 'solardoc_token';
const USER_KEY = 'solardoc_user';

export function getToken(): string | undefined {
  return Cookies.get(TOKEN_KEY);
}

export function setToken(token: string): void {
  Cookies.set(TOKEN_KEY, token, { expires: 7 });
  // Quem entra não herda o cache de acessos de quem usou o aparelho antes.
  limparCachesDeOutros(token);
}

export function removeToken(): void {
  // O cache de acessos do menu é de quem sai: não fica para o próximo a entrar neste aparelho.
  limparCacheAcessos(Cookies.get(TOKEN_KEY));
  Cookies.remove(TOKEN_KEY);
  Cookies.remove(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function setUser(user: Record<string, unknown>): void {
  Cookies.set(USER_KEY, JSON.stringify(user), { expires: 7 });
}

export function getUser(): Record<string, unknown> | null {
  const raw = Cookies.get(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
