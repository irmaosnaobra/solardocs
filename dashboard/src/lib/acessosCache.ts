// Última resposta de /produtos/acessos, guardada por usuário neste aparelho. Serve só para o menu
// não saltar na carga (o Kit Off-Grid depende de `bastidor`): a resposta do servidor continua
// mandando e substitui o cache assim que chega. Tudo com try/catch: sem localStorage, sem cache.

const PREFIXO = 'sd-acessos:';

export interface AcessosGuardados {
  produtos: string[];
  origem: Record<string, string>;
  plano: string;
  assinante: boolean;
  isAdmin: boolean;
  email: string | null;
  bastidor: boolean;
}

/** Id do usuário dono do token (JWT: payload.userId; token do Clerk: sub). Sem token legível, null. */
export function idDoToken(token: string | undefined | null): string | null {
  try {
    const parte = token?.split('.')[1];
    if (!parte) return null;
    const json = JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')));
    const id = json.userId ?? json.id ?? json.sub;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export function lerCacheAcessos(id: string | null): AcessosGuardados | null {
  if (!id) return null;
  try {
    const bruto = window.localStorage.getItem(PREFIXO + id);
    if (!bruto) return null;
    const d = JSON.parse(bruto);
    if (!d || !Array.isArray(d.produtos)) return null;
    return {
      produtos: d.produtos.filter((p: unknown): p is string => typeof p === 'string'),
      origem: d.origem && typeof d.origem === 'object' ? d.origem : {},
      plano: typeof d.plano === 'string' ? d.plano : 'free',
      assinante: !!d.assinante,
      isAdmin: !!d.isAdmin,
      email: typeof d.email === 'string' ? d.email : null,
      bastidor: !!d.bastidor,
    };
  } catch {
    return null;
  }
}

export function guardarCacheAcessos(id: string | null, dados: AcessosGuardados): void {
  if (!id) return;
  try { window.localStorage.setItem(PREFIXO + id, JSON.stringify(dados)); } catch { /* sem armazenamento */ }
}

/** Chamado no logout: apaga o cache de quem estava com este token. */
export function limparCacheAcessos(token: string | undefined | null): void {
  const id = idDoToken(token);
  if (!id) return;
  try { window.localStorage.removeItem(PREFIXO + id); } catch { /* sem armazenamento */ }
}

/** Chamado no login: apaga os caches de acessos de qualquer outro usuário deste aparelho. */
export function limparCachesDeOutros(token: string | undefined | null): void {
  const meu = idDoToken(token);
  try {
    const apagar: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIXO) && k !== PREFIXO + (meu ?? '')) apagar.push(k);
    }
    apagar.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* sem armazenamento */ }
}
