import 'server-only';

import { CONSULTORES, type Consultor } from '../config/loja.ts';

/**
 * De quem é o próximo lead.
 *
 * O contador vive no banco, não no navegador: se cada visitante guardasse o
 * seu, todo mundo começaria no primeiro nome e o primeiro consultor levaria
 * quase tudo. E o incremento acontece dentro do mesmo UPDATE que devolve o
 * número, então dois cliques no mesmo segundo pegam nomes diferentes.
 *
 * Regra que manda em tudo aqui: lead não espera e lead não se perde. Se o banco
 * estiver fora, cai no revezamento por relógio e a conversa acontece do mesmo
 * jeito. Split desigual custa menos que cliente sem resposta.
 */

const TEMPO_LIMITE_MS = 2500;

function porRelogio(): Consultor {
  const minutos = Math.floor(Date.now() / 60_000);
  return CONSULTORES[minutos % CONSULTORES.length];
}

export type Lead = {
  codigo: string;
  titulo: string;
  preco: number;
  pagamento: string | null;
  origem: string;
  /** De qual anúncio veio. Coluna própria: `origem` já é a cidade da entrega. */
  campanha?: string | null;
};

export async function proximoConsultor(
  lead: Lead,
): Promise<{ consultor: Consultor; registrado: boolean }> {
  const url = process.env.SUPABASE_URL;
  const chaveApi = process.env.SUPABASE_CHAVE;
  const segredo = process.env.RODIZIO_CHAVE;

  if (!url || !chaveApi || !segredo) return { consultor: porRelogio(), registrado: false };

  try {
    const resposta = await fetch(`${url}/rest/v1/rpc/bike_proximo_consultor`, {
      method: 'POST',
      headers: { apikey: chaveApi, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_chave: segredo,
        p_consultores: CONSULTORES.map((c) => c.nome),
        p_bike_codigo: lead.codigo,
        p_bike_titulo: lead.titulo,
        p_preco: lead.preco,
        p_pagamento: lead.pagamento,
        p_origem: lead.origem,
        p_campanha: lead.campanha ?? null,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });

    if (!resposta.ok) throw new Error(`rodizio respondeu ${resposta.status}`);

    const nome = String(await resposta.json());
    const achado = CONSULTORES.find((c) => c.nome === nome);
    if (!achado) throw new Error(`consultor desconhecido: ${nome}`);

    return { consultor: achado, registrado: true };
  } catch (e) {
    console.error('rodizio falhou, caindo no revezamento por relógio:', e);
    return { consultor: porRelogio(), registrado: false };
  }
}
