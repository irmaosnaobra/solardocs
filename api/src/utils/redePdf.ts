// Rede permitida ao Chromium que gera o PDF PÚBLICO da proposta (GET /p/:id/pdf). O HTML da proposta é
// montado pelo servidor, mas parte dele vem de campos de usuário: a rota pública só deixa passar o que o
// template realmente usa, e aborta o resto (nada de o navegador do servidor visitar endereço de terceiros).
//  - data: e blob: (logo, fotos em base64, QR e gráficos em linha);
//  - o host do Supabase do projeto (fotos assinadas do Storage);
//  - os hosts da fonte Inter (Google Fonts), que o template carrega.

const HOSTS_FONTE = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/** Host do Supabase do projeto (SUPABASE_URL), ou null se a variável faltar ou for inválida. */
export function hostDoSupabase(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return new URL(String(env.SUPABASE_URL || '')).hostname || null;
  } catch {
    return null;
  }
}

export function redePermitida(url: string, supabaseHost: string | null): boolean {
  if (/^(?:data|blob):/i.test(url) || url === 'about:blank') return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return (!!supabaseHost && u.hostname === supabaseHost) || HOSTS_FONTE.includes(u.hostname);
}
