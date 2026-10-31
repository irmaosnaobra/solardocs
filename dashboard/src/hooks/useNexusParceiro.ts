'use client';

import { useEffect, useSyncExternalStore } from 'react';
import api from '@/services/api';

/**
 * Esta conta já é parceira da NEXUS? Serve ao banner de convite, que não deve aparecer para quem já entrou.
 *
 * Por que NÃO o `GET /gerador/nexus/eu`: essa rota CRIA o parceiro quando ele ainda não existe
 * (`garantirParceiro`: grava em nexus_parceiros, pode criar a company, consulta a Receita e avisa o
 * comercial). Chamada daqui, cadastraria toda a base que vê o banner e esvaziaria o público do convite.
 *
 * A sonda é a lista de oportunidades (`GET /gerador/nexus/oportunidades`). Para quem NÃO é parceiro ela só
 * lê (o contexto: parceiro e company) e responde 409, sem gravar nada; o custo é uma leitura da company e um
 * 409 no console por visita. Para o parceiro Pro a rota roda inteira: devolve a lista e, por regra dela,
 * marca como expirada a oferta com prazo vencido (um UPDATE em nexus_oportunidades, sem aviso a ninguém).
 *   409 `sem_parceiro`             conta sem parceiro  -> 'livre' (o banner pode aparecer)
 *   200 com JSON, ou 403           já é parceiro       -> 'parceiro' (o banner some)
 *     `etapa_bloqueada`
 *   qualquer outra resposta, ou erro de rede           -> 'livre' (melhor sobrar convite do que sumir)
 *
 * O banner depende desse 409, e nenhum teste da api o fixa ainda. Se a rota passar a responder 200 para
 * conta sem parceiro, o banner some para todo mundo, sem erro nenhum.
 *
 * Uma chamada por usuário e por visita, guardada no módulo, sem nova tentativa. Quando a api ganhar uma
 * rota só de leitura para isso, basta trocar a URL e a leitura de `sondar`.
 */

export type SituacaoParceiro = 'pendente' | 'parceiro' | 'livre';

const situacoes = new Map<string, 'parceiro' | 'livre'>();
const emVoo = new Set<string>();
const ouvintes = new Set<() => void>();

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

type ErroDaApi = { response?: { status?: number; data?: { erro?: unknown } } };

function sondar(uid: string): void {
  if (situacoes.has(uid) || emVoo.has(uid)) return;
  emVoo.add(uid);
  api.get('/gerador/nexus/oportunidades')
    .then(({ data }): 'parceiro' | 'livre' => (data !== null && typeof data === 'object' ? 'parceiro' : 'livre'))
    .catch((e: unknown): 'parceiro' | 'livre' => {
      const r = (e as ErroDaApi | null)?.response;
      return r?.status === 403 && r.data?.erro === 'etapa_bloqueada' ? 'parceiro' : 'livre';
    })
    .then((situacao) => { situacoes.set(uid, situacao); })
    .finally(() => {
      emVoo.delete(uid);
      ouvintes.forEach((fn) => fn());
    });
}

/**
 * `ativo` liga a sonda: passe true só quando o banner apareceria de qualquer jeito (portal ligado, não
 * fechado, com usuário). Enquanto a resposta não chega, devolve 'pendente'.
 */
export function useNexusParceiro(userId: string | number | null | undefined, ativo: boolean): SituacaoParceiro {
  const uid = userId == null || userId === '' ? '' : String(userId);
  const situacao = useSyncExternalStore(
    assinar,
    (): SituacaoParceiro => (uid ? situacoes.get(uid) ?? 'pendente' : 'pendente'),
    (): SituacaoParceiro => 'pendente',
  );
  useEffect(() => {
    if (ativo && uid) sondar(uid);
  }, [ativo, uid]);
  return situacao;
}
