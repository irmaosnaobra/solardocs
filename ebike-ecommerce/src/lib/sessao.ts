'use client';

import { useSyncExternalStore } from 'react';

/**
 * Quem é esta visita, e de qual anúncio ela veio.
 *
 * Uma sessão por aba aberta (`sessionStorage`), não por pessoa: o que interessa
 * medir é "de cada visita, quantas chegam no WhatsApp". Guardar por pessoa
 * faria a visita de amanhã contar como a de hoje.
 *
 * A campanha é lida da URL na PRIMEIRA página e guardada. Sem isso, a pessoa
 * que entra pelo anúncio, navega para um modelo e só então clica no WhatsApp
 * chegaria como tráfego sem origem — e é justamente essa que a gente precisa
 * saber de onde veio.
 */

const SESSAO = 'corrente-sessao';
const CAMPANHA = 'corrente-campanha';
/** Cookie para a rota /falar saber a mesma sessão sem passar por campo do formulário. */
const COOKIE = 'corrente-sessao';

function guardar(chave: string, valor: string) {
  try {
    sessionStorage.setItem(chave, valor);
  } catch {
    /* aba anônima: a medição desta visita se perde, a loja não */
  }
}

function ler(chave: string): string | null {
  try {
    return sessionStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function idDaSessao(): string {
  const guardado = ler(SESSAO);
  if (guardado) return guardado;

  const novo =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s${Date.now()}${Math.round(Math.random() * 1e6)}`;
  guardar(SESSAO, novo);
  return novo;
}

/** Espelha a sessão num cookie, que é como a rota /falar a enxerga. */
export function marcarCookie(id: string) {
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; max-age=7200; SameSite=Lax`;
  } catch {
    /* sem cookie, o clique no WhatsApp entra sem sessão e o funil perde a ponta */
  }
}

/**
 * A campanha, no formato `origem/campanha/meio`. Só o que veio na URL — a loja
 * não inventa nome de anúncio, e tráfego sem UTM fica como null em vez de virar
 * "direto", que seria um palpite disfarçado de dado.
 */
export function campanhaDaVisita(): string | null {
  const guardada = ler(CAMPANHA);
  if (guardada) return guardada;

  try {
    const p = new URLSearchParams(window.location.search);
    const partes = [p.get('utm_source'), p.get('utm_campaign'), p.get('utm_medium')].map(
      (x) => x?.trim() || '',
    );
    if (!partes.some(Boolean)) return null;
    const texto = partes.join('/').slice(0, 120);
    guardar(CAMPANHA, texto);
    return texto;
  } catch {
    return null;
  }
}

/**
 * A campanha para quem desenha na tela.
 *
 * `useSyncExternalStore` em vez de estado com efeito: escrever estado dentro de
 * efeito é um render a mais em toda visita, e aqui o valor nem muda depois de
 * lido. Devolve TEXTO, não objeto — string igual é string igual, então o React
 * não entra no laço que já derrubou esta loja uma vez.
 */
export function useCampanha(): string | null {
  return useSyncExternalStore(
    () => () => {},
    campanhaDaVisita,
    () => null,
  );
}
