'use client';

import { useEffect, useRef } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { useEntrega } from '../lib/cepSalvo.ts';
import { campanhaDaVisita, idDaSessao, marcarCookie } from '../lib/sessao.ts';
import { marcarNaMeta } from './Pixel.tsx';

/**
 * Avisa o servidor em que ponto do funil a visita chegou.
 *
 * Três degraus, e só três: entrou na loja, disse de onde é, abriu um modelo. O
 * quarto — clicou no WhatsApp — é gravado pela própria rota `/falar`, no
 * servidor, onde o clique de verdade acontece.
 *
 * Uma linha por sessão em cada degrau, garantido por índice único no banco:
 * recarregar a página não pode virar visita nova, senão a conversão aparece
 * menor do que é.
 */
export function Beacon({ modelo, preco }: { modelo?: string; preco?: number }) {
  const entrega = useEntrega();
  // O que já foi mandado nesta sessão. Sem isto, cada render repetiria o pedido
  // — o banco descartaria, mas o celular no 4G pagaria a conta.
  const enviados = useRef<Set<string>>(new Set());

  useEffect(() => {
    const sessao = idDaSessao();
    marcarCookie(sessao);
    const campanha = campanhaDaVisita();

    const avisar = (etapa: string, extra: Record<string, unknown> = {}) => {
      if (enviados.current.has(etapa)) return;
      enviados.current.add(etapa);
      const corpo = JSON.stringify({ sessao, etapa, campanha, ...extra });
      const url = `${BASE_PATH}/api/visita`;
      // sendBeacon sobrevive à navegação: quem clica rápido demais no card
      // ainda é contado.
      try {
        if (navigator.sendBeacon?.(url, new Blob([corpo], { type: 'application/json' }))) return;
      } catch {
        /* cai no fetch */
      }
      void fetch(url, { method: 'POST', body: corpo, keepalive: true }).catch(() => {});
    };

    avisar('loja');
    if (modelo) {
      avisar('modelo', { modelo });
      // Mesmo degrau, dois destinos: o banco para a gente medir, a Meta para
      // ela aprender quem tem cara de comprador.
      if (!enviados.current.has('meta-modelo')) {
        enviados.current.add('meta-modelo');
        marcarNaMeta('ViewContent', {
          content_ids: [modelo],
          content_type: 'product',
          currency: 'BRL',
          ...(preco ? { value: preco } : {}),
        });
      }
    }
    if (entrega) avisar('local', { cidade: entrega.cidade, uf: entrega.uf });
  }, [modelo, preco, entrega]);

  return null;
}
