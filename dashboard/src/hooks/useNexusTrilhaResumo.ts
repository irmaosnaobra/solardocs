'use client';

import { useEffect, useSyncExternalStore } from 'react';
import api from '@/services/api';

/**
 * Onde esta conta está na Trilha do Parceiro NEXUS. Serve ao menu (etiqueta do Parceiro NEXUS), ao cartão da
 * trilha no topo do SolarDoc e ao /inicio. Os três perguntam a mesma coisa: uma chamada por usuário e por visita,
 * guardada no módulo.
 *
 * A rota é só de leitura (`GET /gerador/nexus/trilha/resumo`):
 *   desligada        `{ ligada: false }`
 *   sem parceiro     `{ ligada: true, parceiro: false, pendente: true }`
 *   parceiro         `{ ligada: true, parceiro: true, pendente, nivel, raio_x_enviado, diag_pedido, precisa_refazer }`
 * `pendente` = o Nível 1 não está concluído (conta o legado de quem já comprou e o "avançar" da equipe). É ele que decide
 * o cartão e a etiqueta, nunca `raio_x_enviado`; `precisa_refazer` (parceiro pendente) só escolhe a versão "Refazer".
 * e, nos dois casos com a trilha ligada, `convite: { fechou, recusou }`: quantas vezes a pessoa fechou o cartão com
 * "Agora não" e se disse "Não quero". `registrarConvite` grava as duas coisas (`POST /gerador/nexus/trilha/convite`).
 *
 * Rota ainda não publicada (404), erro de rede ou resposta estranha contam como 'falhou': quem usa volta ao que
 * existia antes da trilha (o convite antigo e a etiqueta "Novo"). Errar para esse lado é invisível.
 *
 * Depois que a pessoa passa pelo /parceiro-nexus (onde pode ter enviado o Raio-X), `atualizarResumoNexus` busca de
 * novo, para a etiqueta e o cartão sumirem sem recarregar a página.
 */

export type ResumoTrilha = {
  ligada: boolean;
  parceiro: boolean;
  nivel: number;
  raio_x_enviado: boolean;
  diag_pedido: boolean;
  pendente: boolean;
  precisa_refazer: boolean;
  convite: { fechou: number; recusou: boolean };
};

export type EstadoResumo =
  | { estado: 'pendente' }
  | { estado: 'falhou' }
  | { estado: 'pronto'; resumo: ResumoTrilha };

const PENDENTE: EstadoResumo = { estado: 'pendente' };
const FALHOU: EstadoResumo = { estado: 'falhou' };

const resumos = new Map<string, EstadoResumo>();
const emVoo = new Set<string>();
const ouvintes = new Set<() => void>();

function avisar(): void { ouvintes.forEach((fn) => fn()); }

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

function lerConvite(c: unknown): ResumoTrilha['convite'] {
  const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
  const fechou = Math.round(Number(o.fechou));
  return { fechou: Number.isFinite(fechou) && fechou > 0 ? fechou : 0, recusou: o.recusou === true };
}

function ler(data: unknown): EstadoResumo {
  if (!data || typeof data !== 'object') return FALHOU;
  const d = data as Record<string, unknown>;
  if (typeof d.ligada !== 'boolean') return FALHOU;
  const nivel = Math.round(Number(d.nivel));
  return {
    estado: 'pronto',
    resumo: {
      ligada: d.ligada,
      parceiro: d.parceiro === true,
      nivel: Number.isFinite(nivel) && nivel >= 1 && nivel <= 7 ? nivel : 1,
      raio_x_enviado: d.raio_x_enviado === true,
      diag_pedido: d.diag_pedido === true,
      pendente: d.pendente === true,
      precisa_refazer: d.precisa_refazer === true,
      convite: lerConvite(d.convite),
    },
  };
}

function buscar(uid: string, forcar = false): void {
  if (emVoo.has(uid) || (!forcar && resumos.has(uid))) return;
  emVoo.add(uid);
  api.get('/gerador/nexus/trilha/resumo', { timeout: 8000 })
    .then(({ data }) => ler(data))
    .catch((): EstadoResumo => FALHOU)
    .then((r) => {
      // Uma segunda leitura que falha não apaga a primeira que deu certo.
      if (r.estado === 'pronto' || !resumos.has(uid)) resumos.set(uid, r);
    })
    .finally(() => {
      emVoo.delete(uid);
      avisar();
    });
}

/** Troca o convite guardado e avisa quem desenha (menu, cartão). */
function gravarConvite(uid: string, convite: ResumoTrilha['convite']): void {
  const atual = resumos.get(uid);
  if (atual?.estado !== 'pronto') return;
  resumos.set(uid, { estado: 'pronto', resumo: { ...atual.resumo, convite } });
  avisar();
}

/**
 * "Agora não" (`fechou`) ou "Não quero" (`nao_quero`). O "Não quero" vale na hora, antes da resposta: o cartão e a
 * etiqueta do menu somem já. Se a api falhar, fica o que já está na tela (o cartão escondido nesta sessão) e nada
 * quebra; no próximo acesso o servidor decide de novo.
 */
export function registrarConvite(userId: string | number | null | undefined, acao: 'fechou' | 'nao_quero'): void {
  const uid = userId == null || userId === '' ? '' : String(userId);
  if (!uid) return;
  const atual = resumos.get(uid);
  if (acao === 'nao_quero' && atual?.estado === 'pronto') gravarConvite(uid, { ...atual.resumo.convite, recusou: true });
  api.post('/gerador/nexus/trilha/convite', { acao }, { timeout: 8000 })
    .then(({ data }) => {
      const c = lerConvite(data);
      // A resposta nunca desfaz um "Não quero" dado agora.
      gravarConvite(uid, acao === 'nao_quero' ? { ...c, recusou: true } : c);
    })
    .catch(() => { /* sem rede ou rota fora: o cartão já está escondido nesta sessão */ });
}

/** Busca de novo (a pessoa pode ter enviado o Raio-X agora). Sem efeito para quem ainda não buscou. */
export function atualizarResumoNexus(userId: string | number | null | undefined): void {
  const uid = userId == null || userId === '' ? '' : String(userId);
  if (uid && resumos.has(uid)) buscar(uid, true);
}

export function useNexusTrilhaResumo(userId: string | number | null | undefined): EstadoResumo {
  const uid = userId == null || userId === '' ? '' : String(userId);
  const estado = useSyncExternalStore(
    assinar,
    (): EstadoResumo => (uid ? resumos.get(uid) ?? PENDENTE : PENDENTE),
    (): EstadoResumo => PENDENTE,
  );
  useEffect(() => {
    if (uid) buscar(uid);
  }, [uid]);
  return estado;
}

/**
 * O cartão e a etiqueta chamativa valem enquanto a trilha está ligada, o Nível 1 está pendente (`pendente`) e a
 * pessoa não disse "Não quero".
 */
export function trilhaPendente(e: EstadoResumo): ResumoTrilha | null {
  return e.estado === 'pronto' && e.resumo.ligada && e.resumo.pendente && !e.resumo.convite.recusou ? e.resumo : null;
}

/**
 * A etiqueta do item Parceiro NEXUS, a mesma no menu e no /inicio: "Refazer agora" (parceiro pendente), "Cadastre-se"
 * (quem não é parceiro e está pendente) e nada depois do Nível 1. Resumo ainda não chegou: nada (não pisca). Resumo
 * indisponível ou trilha desligada: `padrao` (o "Novo" de antes da trilha).
 */
export function etiquetaNexus(e: EstadoResumo, padrao?: string): string | undefined {
  if (e.estado === 'pendente') return undefined;
  if (e.estado === 'falhou' || !e.resumo.ligada) return padrao;
  const r = trilhaPendente(e);
  return r ? (r.precisa_refazer ? 'Refazer agora' : 'Cadastre-se') : undefined;
}
