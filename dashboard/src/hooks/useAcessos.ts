'use client';

import { useEffect, useState } from 'react';
import api from '@/services/api';

/**
 * O que esta pessoa pode usar. Uma chamada só, cacheada no módulo — a Sidebar,
 * a tela da ferramenta e a loja perguntam a mesma coisa e não faz sentido bater
 * três vezes no servidor por navegação.
 *
 * Quem decide é SEMPRE o servidor. Enquanto a resposta não chega, `carregando`
 * fica true e a tela não mostra nem cadeado nem conteúdo — piscar "compre" na
 * cara de quem já pagou é pior que esperar 200 ms.
 */

export interface AcessosState {
  carregando: boolean;
  produtos: Set<string>;
  origem: Record<string, string>;
  plano: string;
  assinante: boolean;
  isAdmin: boolean;
  /** E-mail da conta — usado pra pré-preencher o checkout. */
  email: string | null;
  /**
   * A loja de produtos está visível pra esta conta? Enquanto o lançamento é
   * restrito, quem está fora não vê item novo no menu nem cadeado em ferramenta
   * que já era grátis — pra base inteira, nada muda.
   */
  bastidor: boolean;
}

const INICIAL: AcessosState = {
  carregando: true, produtos: new Set(), origem: {},
  plano: 'free', assinante: false, isAdmin: false, email: null, bastidor: false,
};

let cache: AcessosState | null = null;
let voando: Promise<AcessosState> | null = null;
const ouvintes = new Set<(s: AcessosState) => void>();

async function buscar(): Promise<AcessosState> {
  try {
    const { data } = await api.get('/produtos/acessos');
    return {
      carregando: false,
      produtos: new Set<string>(data.produtos || []),
      origem: data.origem || {},
      plano: data.plano || 'free',
      assinante: !!data.assinante,
      isAdmin: !!data.is_admin,
      email: data.email ?? null,
      bastidor: !!data.bastidor,
    };
  } catch {
    // Servidor fora do ar tranca em vez de liberar: errar pro lado do cadeado
    // é recuperável com um F5; errar pro lado de abrir entrega produto de graça.
    return { ...INICIAL, carregando: false };
  }
}

/** Força releitura — usar depois de voltar do checkout. */
export function recarregarAcessos(): void {
  cache = null;
  voando = null;
  buscar().then((s) => {
    cache = s;
    ouvintes.forEach((fn) => fn(s));
  });
}

export function useAcessos(): AcessosState & { tem: (produto: string) => boolean } {
  const [estado, setEstado] = useState<AcessosState>(cache || INICIAL);

  useEffect(() => {
    ouvintes.add(setEstado);
    if (cache) setEstado(cache);
    else {
      voando = voando || buscar();
      voando.then((s) => { cache = s; setEstado(s); });
    }
    return () => { ouvintes.delete(setEstado); };
  }, []);

  return { ...estado, tem: (produto: string) => estado.produtos.has(produto) };
}
