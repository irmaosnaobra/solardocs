'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import Cookies from 'js-cookie';
import api from '@/services/api';
import { guardarCacheAcessos, idDoToken, lerCacheAcessos } from '@/lib/acessosCache';

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
/** Quando o servidor foi perguntado pela última vez (busca inicial ou releitura). Base do intervalo mínimo. */
let ultimaLeitura = 0;
/** A última pergunta ao servidor teve resposta boa (lista de produtos de verdade)? Falha de rede não pode apagar o estado bom. */
let ultimaFoiBoa = true;
/** Quantas telas estão ouvindo; o ouvinte de foco é um só para todas. */
let montados = 0;
/** Intervalo mínimo entre duas perguntas ao servidor motivadas por a aba voltar ao foco. */
const INTERVALO_MIN_MS = 10_000;
const ouvintes = new Set<(s: AcessosState) => void>();

async function buscar(): Promise<AcessosState> {
  ultimaLeitura = Date.now();
  ultimaFoiBoa = false;
  // SEM TOKEN, NEM PERGUNTA.
  //
  // A LP pública (/lp/<slug>) monta este hook pra saber se a pessoa já tem o
  // produto. Quem chega de anúncio não tem sessão: a API responde 401 e o
  // interceptor do `api` manda pro /auth. Resultado medido pelo Thiago numa
  // janela anônima: TODAS as cinco páginas de venda caíam na tela de login
  // antes de mostrar a oferta — o anúncio pagava o clique e o visitante batia
  // num cadastro de um produto que ele ainda não conhece.
  //
  // Visitante sem sessão não tem acesso a produto nenhum, e isso a gente já
  // sabe sem perguntar ao servidor. A checagem continua sendo do servidor pra
  // quem TEM token, que é onde ela decide alguma coisa.
  if (typeof window !== 'undefined' && !document.cookie.includes('solardoc_token=')) {
    return { ...INICIAL, carregando: false, produtos: new Set(), origem: {} };
  }
  try {
    const { data } = await api.get('/produtos/acessos');
    const estado: AcessosState = {
      carregando: false,
      produtos: new Set<string>(data.produtos || []),
      origem: data.origem || {},
      plano: data.plano || 'free',
      assinante: !!data.assinante,
      isAdmin: !!data.is_admin,
      email: data.email ?? null,
      bastidor: !!data.bastidor,
    };
    // Só resposta boa do servidor (com a lista de produtos de verdade) vai para o cache; a falha, que tranca, nunca.
    if (Array.isArray(data.produtos)) {
      ultimaFoiBoa = true;
      guardarCacheAcessos(idDoToken(Cookies.get('solardoc_token')), {
        produtos: [...estado.produtos], origem: estado.origem, plano: estado.plano,
        assinante: estado.assinante, isAdmin: estado.isAdmin, email: estado.email, bastidor: estado.bastidor,
      });
    }
    return estado;
  } catch {
    // Servidor fora do ar tranca em vez de liberar: errar pro lado do cadeado
    // é recuperável com um F5; errar pro lado de abrir entrega produto de graça.
    return { ...INICIAL, carregando: false };
  }
}

/**
 * Força releitura, para usar depois de voltar do checkout. Com `soSeBoa`, uma falha de rede (comum quando a aba
 * do celular acorda) mantém o estado anterior em vez de trocá-lo pelo vazio.
 */
export function recarregarAcessos(soSeBoa = false): void {
  if (!soSeBoa) cache = null;
  voando = null;
  buscar().then((s) => {
    if (soSeBoa && !ultimaFoiBoa) return;
    cache = s;
    ouvintes.forEach((fn) => fn(s));
  });
}

/**
 * O cadeado solta sozinho: quem foi pagar numa aba e volta para esta recarrega os acessos, sem ninguém
 * apertar F5. `visibilitychange` cobre trocar de aba, `focus` cobre voltar de outra janela. No máximo uma
 * pergunta a cada 10 s (as duas costumam disparar juntas), e nada quando ainda não há sessão.
 */
function aoVoltarAoFoco(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') return;
  if (!document.cookie.includes('solardoc_token=')) return;
  if (Date.now() - ultimaLeitura < INTERVALO_MIN_MS) return;
  recarregarAcessos(true);
}

/**
 * Última resposta do servidor guardada neste aparelho. SÓ PARA DESENHAR (o menu e a /inicio): o que decide
 * acesso (`carregando`, `tem`, `bastidor`) nunca vem daqui, porque localStorage se edita e quem foi
 * estornado ainda o teria. A Sidebar e a /inicio leem, só para desenhar e só enquanto `carregando` for true.
 */
export interface PreviaAcessos {
  bastidor: boolean;
  produtos: Set<string>;
}

export function useAcessos(): AcessosState & { tem: (produto: string) => boolean; previa: PreviaAcessos | null } {
  const [estado, setEstado] = useState<AcessosState>(cache || INICIAL);
  const [previa, setPrevia] = useState<PreviaAcessos | null>(null);

  // Roda antes da pintura e depois da hidratação, então não diverge do HTML do servidor.
  useLayoutEffect(() => {
    if (cache) return;
    const g = lerCacheAcessos(idDoToken(Cookies.get('solardoc_token')));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- precisa ser depois da hidratação
    if (g) setPrevia({ bastidor: g.bastidor, produtos: new Set(g.produtos) });
  }, []);

  useEffect(() => {
    ouvintes.add(setEstado);
    if (cache) setEstado(cache);
    else {
      voando = voando || buscar();
      voando.then((s) => { cache = s; setEstado(s); });
    }
    return () => { ouvintes.delete(setEstado); };
  }, []);

  useEffect(() => {
    if (montados === 0) {
      document.addEventListener('visibilitychange', aoVoltarAoFoco);
      window.addEventListener('focus', aoVoltarAoFoco);
    }
    montados += 1;
    return () => {
      montados -= 1;
      if (montados === 0) {
        document.removeEventListener('visibilitychange', aoVoltarAoFoco);
        window.removeEventListener('focus', aoVoltarAoFoco);
      }
    };
  }, []);

  // A prévia só existe enquanto o servidor não respondeu; depois dele, sempre null.
  return { ...estado, tem: (produto: string) => estado.produtos.has(produto), previa: estado.carregando ? previa : null };
}
