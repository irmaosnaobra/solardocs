// ─────────────────────────────────────────────────────────────────────────────
// O ANÚNCIO DE ORIGEM DE UMA CONVERSA, para o porteiro (passo 4). Só leitura.
// Lê o payload da PRIMEIRA mensagem do lead (wa_mensagens.webhook_debug_id -> webhook_debug), tira o
// id do anúncio e traduz em campanha e produto pelo acesso ao Meta que o servidor já tem
// (metaConjuntos.buscarOrigemDoAnuncio: só GET, cache de 7 dias em system_state sem dado pessoal).
//
// `ok: false` = não deu para saber se há anúncio: quem chama trata como leitura falha (ninguém responde).
// Nunca guarda ctwaClid nem telefone.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { buscarOrigemDoAnuncio, lerMapaCampanhaProduto, produtoDaCampanha } from '../io/metaConjuntos';
import { lerAnuncioDaMensagem } from './anuncio';
import type { AnuncioOrigem } from './tipos';

export async function anuncioDaMensagem(waId: number): Promise<{ ok: boolean; anuncio: AnuncioOrigem | null }> {
  try {
    const { data, error } = await supabase.from('wa_mensagens').select('webhook_debug_id').eq('id', waId).maybeSingle();
    if (error) return { ok: false, anuncio: null };
    const wid = (data as { webhook_debug_id?: string | null } | null)?.webhook_debug_id;
    if (!wid) return { ok: true, anuncio: null };
    const lido = await lerAnuncioDaMensagem(wid);
    if (!lido.ok) return { ok: false, anuncio: null };
    const adId = lido.anuncio?.adId ?? null;
    if (!adId) return { ok: true, anuncio: null };
    const origem = await buscarOrigemDoAnuncio(adId);
    const mapa = origem.ok ? await lerMapaCampanhaProduto() : {};
    const produto = origem.ok ? produtoDaCampanha(origem.campanha?.nome, mapa) : null;
    return { ok: true, anuncio: { adId, produto } };
  } catch {
    return { ok: false, anuncio: null };
  }
}
