import 'server-only';

/**
 * O funil de hoje, para o painel.
 *
 * Lê direto da `bike_visitas` e da `bike_leads`. É a resposta para a única
 * pergunta que importa no primeiro dia de anúncio: de cada cem que entraram,
 * quantas chegaram no WhatsApp — e onde as outras noventa e tantas pararam.
 *
 * Contagem por SESSÃO, não por linha: o índice único no banco já garante uma
 * linha por sessão em cada degrau, então contar linhas e contar pessoas dá o
 * mesmo número. Se um dia esse índice sair, esta conta mente.
 */

export type Funil = {
  disponivel: boolean;
  loja: number;
  local: number;
  modelo: number;
  whatsapp: number;
  porCampanha: Array<{ campanha: string; visitas: number; leads: number }>;
};

const VAZIO: Funil = {
  disponivel: false,
  loja: 0,
  local: 0,
  modelo: 0,
  whatsapp: 0,
  porCampanha: [],
};

export async function funilDeHoje(dias = 1): Promise<Funil> {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_CHAVE;
  const segredo = process.env.RODIZIO_CHAVE;
  if (!url || !chave || !segredo) return VAZIO;

  try {
    const r = await fetch(`${url}/rest/v1/rpc/bike_funil`, {
      method: 'POST',
      headers: { apikey: chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_chave: segredo, p_dias: dias }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return VAZIO;
    const d = (await r.json()) as {
      loja?: number;
      local?: number;
      modelo?: number;
      whatsapp?: number;
      por_campanha?: Array<{ campanha: string; visitas: number; leads: number }>;
    } | null;
    if (!d) return VAZIO;
    return {
      disponivel: true,
      loja: d.loja ?? 0,
      local: d.local ?? 0,
      modelo: d.modelo ?? 0,
      whatsapp: d.whatsapp ?? 0,
      porCampanha: d.por_campanha ?? [],
    };
  } catch {
    return VAZIO;
  }
}
