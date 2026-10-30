'use client';

// Lista de compras da vistoria: estado, gravação em ordem, reenvio e saída da página (seção 7.4 do plano).
//
// Mesmo molde do status dos itens (gravadorStatus.ts), com três reforços:
//   1. a flag "sujo" é independente do debounce: o que o servidor ainda não confirmou é lembrado mesmo depois
//      de um PUT que falhou;
//   2. na saída da página (pagehide, aba oculta) vai um fetch com keepalive FORA da cadeia;
//   3. quem conclui espera a lista (esperar), e o Concluir só segue se ela foi enviada.
//
// IDENTIDADE ESTÁVEL: carregar, limpar, mudar, esperar e sujo não mudam entre renders. O objeto que o hook devolve
// muda a cada render, por isso em page.tsx ele NUNCA entra nas dependências de um hook: desestruture as funções.

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import { criarGravadorStatus, type GravadorStatus } from './gravadorStatus';
import { adicionarLinha, normalizarLinha, removerLinha, restaurarLinha } from './comprasPuro';
import { TEXTOS_COMPRAS } from './comprasTextos';
import { LIMITES, type ComprasEstado, type LinhaCompra } from './comprasTipos';
import { ehMigracaoPendente } from './tipos';

export type SituacaoCompras = 'salvo' | 'salvando' | 'sem_rede' | 'erro' | 'conflito';

export interface UsoCompras {
  /** O que a tela mostra. */
  estado: ComprasEstado;
  /** true só se a API mandou compras_disponivel === true. */
  disponivel: boolean;
  /** true se a API mandou compras_disponivel === false (a migration ainda não rodou). */
  liberando: boolean;
  situacao: SituacaoCompras;
  /** Texto da última falha (ou da retomada da conexão). Vazio se não há. */
  mensagem: string;
  carregar(id: string, bruto: { publica?: boolean; linhas?: unknown[] } | undefined, flag: boolean | undefined): void;
  /** Ao sair da vistoria. */
  limpar(): void;
  mudar(fn: (atual: ComprasEstado) => ComprasEstado): void;
  /** true = nada pendente. Usado pelo Concluir. */
  esperar(): Promise<boolean>;
  sujo(): boolean;
}

/** O que uma gravação carrega: a vistoria e a lista inteira, como estavam quando o técnico tocou. */
interface CargaCompras { id: string; compras: ComprasEstado }

const VAZIO: ComprasEstado = { publica: true, linhas: [] };
const ATRASO_REENVIO = 10_000;
const TEMPO_LIMITE_PUT = 25_000;

type Timer = { current: ReturnType<typeof setTimeout> | null };

function parar(timer: Timer) {
  if (timer.current) { clearTimeout(timer.current); timer.current = null; }
}

/** Troca cada {chave} do modelo pelo valor. Chave sem valor fica como está. */
export function preencher(modelo: string, valores: Record<string, string | number>): string {
  return modelo.replace(/\{(\w+)\}/g, (inteiro: string, chave: string) => (chave in valores ? String(valores[chave]) : inteiro));
}

/**
 * Deixa a lista como a API deixaria: cada linha passa por normalizarLinha (as inválidas saem), id repetido fica
 * com a última ocorrência na posição da primeira, no máximo 60 linhas. `publica` só é falso se vier falso.
 */
function normalizar(bruto: { publica?: unknown; linhas?: unknown } | null | undefined): ComprasEstado {
  const posicao = new Map<string, number>();
  const linhas: LinhaCompra[] = [];
  const entrada = Array.isArray(bruto?.linhas) ? (bruto.linhas as unknown[]) : [];
  for (const b of entrada) {
    const l = normalizarLinha(b);
    if (!l) continue;
    const onde = posicao.get(l.id);
    if (onde === undefined) { posicao.set(l.id, linhas.length); linhas.push(l); } else { linhas[onde] = l; }
  }
  return { publica: bruto?.publica !== false, linhas: linhas.slice(0, LIMITES.linhas) };
}

export function useCompras(): UsoCompras {
  const [estado, setEstado] = useState<ComprasEstado>(VAZIO);
  const [disponivel, setDisponivel] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [situacao, setSituacao] = useState<SituacaoCompras>('salvo');
  const [mensagem, setMensagem] = useState('');

  const idRef = useRef('');
  const estadoRef = useRef<ComprasEstado>(VAZIO);
  const sujoRef = useRef(false);               // há alteração que o servidor ainda não confirmou
  const situacaoRef = useRef<SituacaoCompras>('salvo');
  const timerReenvio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acoesRef = useRef<{ enviar: (c: CargaCompras) => Promise<boolean> }>({ enviar: async () => true });

  // Gravações em ordem: uma só no ar por vez. Sem `aoDescarregar`: a saída da página tem caminho próprio (abaixo),
  // que não depende do timer do debounce. O gravador nasce na primeira vez que alguém o pede (sempre num toque, num
  // evento ou numa espera, nunca durante o render) e fica o mesmo até a página fechar.
  const gravadorRef = useRef<GravadorStatus<CargaCompras> | null>(null);
  const obterGravador = useCallback((): GravadorStatus<CargaCompras> => {
    if (!gravadorRef.current) gravadorRef.current = criarGravadorStatus<CargaCompras>({ enviar: (c) => acoesRef.current.enviar(c) });
    return gravadorRef.current;
  }, []);

  const definir = useCallback((s: SituacaoCompras, texto = '') => {
    situacaoRef.current = s;
    setSituacao(s);
    setMensagem(texto);
  }, []);

  // Manda de novo o que o servidor não confirmou. Não faz nada se não há o que mandar ou se um debounce já vai
  // levar a lista mais nova.
  const reenviar = useCallback(() => {
    const gravador = obterGravador();
    if (!sujoRef.current || !idRef.current || gravador.pendente()) return;
    void gravador.enfileirar({ id: idRef.current, compras: estadoRef.current });
  }, [obterGravador]);

  // UM reenvio em 10 s (se já há timer, não agenda outro). O timer se zera ANTES de reenviar: se o reenvio falhar
  // ainda sem rede, o próprio enviar agenda o seguinte.
  const agendarReenvio = useCallback(() => {
    if (timerReenvio.current) return;
    timerReenvio.current = setTimeout(() => { timerReenvio.current = null; reenviar(); }, ATRASO_REENVIO);
  }, [reenviar]);

  async function enviar(c: CargaCompras): Promise<boolean> {
    if (!c.id) return true;
    // Resposta atrasada de outra vistoria nunca mexe na tela da vistoria aberta agora.
    const atual = () => idRef.current === c.id;
    try {
      await api.put(`/vistorias/${c.id}/compras`, { publica: c.compras.publica, linhas: c.compras.linhas }, { timeout: TEMPO_LIMITE_PUT });
      if (atual() && estadoRef.current === c.compras) {
        sujoRef.current = false;
        definir('salvo');
      }
      return true;
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      const status = r?.status;
      // A migration ainda não rodou: some a seção e aparece o aviso. Status e assinatura não são afetados.
      if (ehMigracaoPendente(err)) {
        if (atual()) { sujoRef.current = false; setDisponivel(false); setLiberando(true); }
        return true;
      }
      // Concluída em outro aparelho: repetir não adianta.
      if (status === 409) {
        if (atual()) { sujoRef.current = false; definir('conflito', TEXTOS_COMPRAS.conflito); }
        return true;
      }
      // Problema de conteúdo (400, 413 e afins): sem reenvio automático, o próximo toque tenta de novo.
      if (status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
        if (atual()) definir('erro', r?.data?.error || TEXTOS_COMPRAS.erroSalvar);
        return false;
      }
      // Rede, 5xx, 429 ou 401: a lista segue na tela e vai de novo em 10 s, ao voltar a rede ou ao voltar à aba.
      if (atual()) { definir('sem_rede', TEXTOS_COMPRAS.semRede); agendarReenvio(); }
      return false;
    }
  }

  useEffect(() => {
    acoesRef.current = { enviar };
  });

  // Saída da página, aba oculta, volta da rede, volta à aba e fechar com alteração solta. Um efeito só: os
  // handlers leem os refs na hora em que disparam.
  useEffect(() => {
    // Fica FORA da cadeia (a aba não vai esperar). O gatilho é a flag "sujo", NÃO o timer do debounce: depois de um
    // PUT que falhou não há timer, e a lista continuaria sem ir.
    const aoSair = () => {
      if (!sujoRef.current || !idRef.current) return;
      const corpo = JSON.stringify({ publica: estadoRef.current.publica, linhas: estadoRef.current.linhas });
      if (corpo.length > LIMITES.json) return;   // o keepalive não aguenta; fica a espera de rede
      const base = String(api.defaults.baseURL || '');
      const token = getToken();
      fetch(`${base}/vistorias/${idRef.current}/compras`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: corpo,
      }).catch(() => {});
    };
    const aoVoltarRede = () => {
      if (sujoRef.current && idRef.current) definir('salvando', TEXTOS_COMPRAS.redeVoltou);
      reenviar();
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'hidden') aoSair(); else reenviar();
    };
    const antesDeFechar = (ev: BeforeUnloadEvent) => {
      if (!sujoRef.current) return;
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('pagehide', aoSair);
    window.addEventListener('online', aoVoltarRede);
    window.addEventListener('beforeunload', antesDeFechar);
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      window.removeEventListener('pagehide', aoSair);
      window.removeEventListener('online', aoVoltarRede);
      window.removeEventListener('beforeunload', antesDeFechar);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      parar(timerReenvio);
    };
  }, [definir, reenviar]);

  const carregar = useCallback((id: string, bruto: { publica?: boolean; linhas?: unknown[] } | undefined, flag: boolean | undefined) => {
    parar(timerReenvio);
    const novo = normalizar(bruto);
    idRef.current = id;
    estadoRef.current = novo;
    sujoRef.current = false;
    setEstado(novo);
    // Campo ausente (API velha) deixa os dois falsos: a seção não aparece e nada é dito.
    setDisponivel(flag === true);
    setLiberando(flag === false);
    definir('salvo');
  }, [definir]);

  const limpar = useCallback(() => {
    parar(timerReenvio);
    idRef.current = '';
    estadoRef.current = VAZIO;
    sujoRef.current = false;
    setEstado(VAZIO);
    setDisponivel(false);
    setLiberando(false);
    definir('salvo');
  }, [definir]);

  const mudar = useCallback((fn: (atual: ComprasEstado) => ComprasEstado) => {
    if (!idRef.current) return;
    const atual = estadoRef.current;
    const proposto = fn(atual);
    if (proposto === atual) return;              // nada mudou (linha repetida, por exemplo): nada a gravar
    const novo = normalizar(proposto);
    estadoRef.current = novo;
    sujoRef.current = true;
    setEstado(novo);
    // Sem rede, segue dizendo isso (o próximo envio já vai falhar do mesmo jeito) em vez de piscar "Salvando".
    if (situacaoRef.current !== 'sem_rede') definir('salvando');
    // O id e o conteúdo ficam capturados NO TOQUE: uma gravação atrasada nunca leva a lista de uma vistoria para outra.
    obterGravador().agendar({ id: idRef.current, compras: novo });
  }, [definir, obterGravador]);

  // Dispara a troca que esperava o debounce, espera a cadeia toda e, se sobrou alteração não confirmada (a última
  // falhou), enfileira a lista atual NA cadeia. Repete enquanto houver pendência. O id é lido uma vez: quem sai da
  // vistoria chama limpar() logo depois, e uma volta seguinte nunca pode mandar com id vazio.
  const esperar = useCallback(async (): Promise<boolean> => {
    const gravador = obterGravador();
    const id = idRef.current;
    for (let volta = 0; volta < 5; volta++) {
      let ok = await gravador.esperar();
      if (sujoRef.current && idRef.current === id) ok = await gravador.enfileirar({ id, compras: estadoRef.current });
      if (!ok) return false;
      if (!gravador.pendente() && !sujoRef.current) return true;
    }
    return !sujoRef.current;
  }, [obterGravador]);

  const sujo = useCallback(() => sujoRef.current, []);

  return { estado, disponivel, liberando, situacao, mensagem, carregar, limpar, mudar, esperar, sujo };
}

// ---------------------------------------------------------------------------------------------------------
// Apoio da tela: o que vive só enquanto a página está aberta
// ---------------------------------------------------------------------------------------------------------

export type ResultadoAdicao = 'adicionada' | 'duplicada' | 'cheia' | 'invalida';

export interface SessaoCompras {
  /** Sugestões que o técnico dispensou nesta vistoria (cids). Não persiste e não vai ao servidor. */
  dispensadas: string[];
  /** Os últimos materiais do catálogo que o técnico usou nesta sessão, o mais novo primeiro (até 8 cids). */
  recentes: string[];
  /** A linha que acabou de entrar: fica destacada por 2 s. */
  novaId: string | null;
  /** A última linha apagada, por 6 s: um nível de "Desfazer". */
  apagada: { linha: LinhaCompra; indice: number } | null;
  dispensar(cid: string): void;
  /** Ao abrir outra vistoria: as dispensadas e o destaque zeram. Os recentes ficam. */
  reiniciar(): void;
  /** Põe UMA linha no fim da lista, com destaque, recente e telemetria. */
  adicionar(linha: LinhaCompra): ResultadoAdicao;
  /** Põe várias de uma vez (um único envio). Devolve os ids que entraram. */
  adicionarVarias(linhas: LinhaCompra[]): string[];
  /** Tira várias de uma vez (o "Desfazer" do lote). */
  removerVarias(ids: string[]): void;
  /** Apaga na hora e guarda a linha para o "Desfazer". */
  apagar(id: string): void;
  desfazerApagada(): void;
}

/**
 * `mudar` é o do useCompras (estável). `aoLogar` também precisa ser estável. As funções devolvidas mantêm a identidade
 * entre renders, menos `desfazerApagada`, que muda junto com `apagada`.
 */
export function useSessaoCompras(mudar: UsoCompras['mudar'], aoLogar: (tipo: string) => void): SessaoCompras {
  const [dispensadas, setDispensadas] = useState<string[]>([]);
  const [recentes, setRecentes] = useState<string[]>([]);
  const [novaId, setNovaId] = useState<string | null>(null);
  const [apagada, setApagada] = useState<{ linha: LinhaCompra; indice: number } | null>(null);
  const timerNova = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerApagada = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { parar(timerNova); parar(timerApagada); }, []);

  const destacar = useCallback((id: string) => {
    setNovaId(id);
    parar(timerNova);
    timerNova.current = setTimeout(() => { timerNova.current = null; setNovaId(null); }, 2000);
  }, []);

  const lembrar = useCallback((cid: string | undefined) => {
    if (!cid) return;
    setRecentes((r) => [cid, ...r.filter((x) => x !== cid)].slice(0, 8));
  }, []);

  const dispensar = useCallback((cid: string) => {
    setDispensadas((d) => (d.includes(cid) ? d : [...d, cid]));
  }, []);

  const reiniciar = useCallback(() => {
    setDispensadas([]);
    setNovaId(null);
    setApagada(null);
    parar(timerNova);
    parar(timerApagada);
  }, []);

  const adicionar = useCallback((linha: LinhaCompra): ResultadoAdicao => {
    let resultado = 'invalida' as ResultadoAdicao;
    mudar((atual) => {
      const r = adicionarLinha(atual, linha);
      resultado = r.resultado;
      return r.estado;
    });
    if (resultado === 'adicionada') {
      destacar(linha.id);
      lembrar(linha.cid);
      aoLogar('compras_add');
    }
    return resultado;
  }, [mudar, destacar, lembrar, aoLogar]);

  const adicionarVarias = useCallback((linhas: LinhaCompra[]): string[] => {
    const ids: string[] = [];
    mudar((atual) => {
      let e = atual;
      for (const l of linhas) {
        const r = adicionarLinha(e, l);
        if (r.resultado === 'adicionada') { e = r.estado; ids.push(l.id); lembrar(l.cid); }
      }
      return e;
    });
    if (ids.length > 0) {
      destacar(ids[ids.length - 1]);
      aoLogar('compras_add');
    }
    return ids;
  }, [mudar, destacar, lembrar, aoLogar]);

  const removerVarias = useCallback((ids: string[]) => {
    mudar((atual) => {
      let e = atual;
      for (const id of ids) e = removerLinha(e, id).estado;
      return e;
    });
  }, [mudar]);

  const apagar = useCallback((id: string) => {
    let removida = undefined as { linha: LinhaCompra; indice: number } | undefined;
    mudar((atual) => {
      const r = removerLinha(atual, id);
      removida = r.removida;
      return r.estado;
    });
    if (!removida) return;
    setApagada(removida);
    parar(timerApagada);
    timerApagada.current = setTimeout(() => { timerApagada.current = null; setApagada(null); }, 6000);
  }, [mudar]);

  const desfazerApagada = useCallback(() => {
    // Um nível só: o que está guardado volta para a posição de antes.
    if (!apagada) return;
    mudar((atual) => restaurarLinha(atual, apagada.linha, apagada.indice));
    setApagada(null);
    parar(timerApagada);
  }, [apagada, mudar]);

  return {
    dispensadas, recentes, novaId, apagada, dispensar, reiniciar, adicionar, adicionarVarias, removerVarias, apagar, desfazerApagada,
  };
}
