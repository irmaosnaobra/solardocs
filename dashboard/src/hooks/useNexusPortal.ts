'use client';

import { useSyncExternalStore } from 'react';
import api from '@/services/api';

/**
 * O Portal do Parceiro NEXUS está no ar? Uma chamada só, cacheada no módulo: o
 * menu e o banner da página inicial perguntam a mesma coisa.
 *
 * A rota é pública (`GET /gerador/nexus/status`) e responde `{ ligado: boolean }`.
 * Só `ligado: true` mostra alguma coisa. Rota ainda não publicada (404), erro de
 * rede ou qualquer outra resposta contam como desligado: errar para o lado de
 * esconder é invisível, errar para o lado de mostrar leva o usuário a uma página
 * "Em breve".
 */

let ligado = false;
let pedido = false;
const ouvintes = new Set<() => void>();

function buscar(): void {
  if (pedido) return;
  pedido = true;
  api.get('/gerador/nexus/status')
    .then(({ data }) => { ligado = data?.ligado === true; })
    .catch(() => { ligado = false; })
    .finally(() => { ouvintes.forEach((fn) => fn()); });
}

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  buscar();
  return () => { ouvintes.delete(fn); };
}

export function useNexusPortal(): boolean {
  return useSyncExternalStore(assinar, () => ligado, () => false);
}
