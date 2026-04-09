import Cookies from 'js-cookie';

const TOKEN_KEY = 'solardoc_token';
const USER_KEY = 'solardoc_user';

export function getToken(): string | undefined {
  return Cookies.get(TOKEN_KEY);
}

export function setToken(token: string): void {
  Cookies.set(TOKEN_KEY, token, { expires: 7 });
}

export function removeToken(): void {
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
