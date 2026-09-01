import 'server-only';

/**
 * O funil da loja, gravado no banco.
 *
 * Sem isto a gente vê o lead chegar no WhatsApp e não sabe de quantas visitas
 * ele saiu — ou seja, não dá para dizer se o problema é o anúncio ou a página.
 * Com anúncio rodando, essa é a diferença entre aprender e só gastar.
 *
 * Passa pelo SERVIDOR, nunca direto do navegador: a loja fala com o Supabase
 * com a chave publicável, e tabela gravável por ela é tabela gravável por
 * qualquer um que abra o código-fonte. A `bike_visitas` está com RLS ligada e
 * sem policy nenhuma; quem escreve é a função `bike_registrar_visita`, que é
 * `security definer` e exige o mesmo segredo do rodízio.
 */

export type Etapa = 'loja' | 'local' | 'modelo' | 'whatsapp';

export async function registrarVisita(dados: {
  sessao: string;
  etapa: Etapa;
  modelo?: string | null;
  cidade?: string | null;
  uf?: string | null;
  campanha?: string | null;
}): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const chaveApi = process.env.SUPABASE_CHAVE;
  const segredo = process.env.RODIZIO_CHAVE;
  if (!url || !chaveApi || !segredo) return false;

  try {
    const r = await fetch(`${url}/rest/v1/rpc/bike_registrar_visita`, {
      method: 'POST',
      headers: { apikey: chaveApi, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_chave: segredo,
        p_sessao: dados.sessao,
        p_etapa: dados.etapa,
        p_modelo: dados.modelo ?? null,
        p_cidade: dados.cidade ?? null,
        p_uf: dados.uf ?? null,
        p_campanha: dados.campanha ?? null,
      }),
      // Medir não pode atrasar quem está comprando.
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    // Falha de medição nunca derruba a loja.
    return false;
  }
}
