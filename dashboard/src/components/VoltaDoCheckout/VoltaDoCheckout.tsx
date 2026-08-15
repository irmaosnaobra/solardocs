'use client';

import { useEffect } from 'react';
import { destinoDaVolta, limparSaidaDoCheckout } from '@/lib/saidaCheckout';

// Quem paga NÃO pode ver a tela de "faltou pouco". As duas chegadas de sucesso
// caem na mesma aba, com a marca da ida ainda de pé no sessionStorage: sem
// limpar aqui, o cliente que acabou de assinar e aperta o voltar seria recebido
// com "Não tem cartão? Dá pra entrar no Pix".
function chegouPagando(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.get('welcome') === '1'                                // conta → /documentos
    || (q.get('mode') === 'register' && !!q.get('session'));     // LP → /auth (cadastro)
}

/**
 * Fica montado na aplicação inteira e só faz uma coisa: quando a pessoa reaparece
 * numa página nossa depois de ter ido pro checkout, leva ela pra oferta de saída
 * (/quase-la) em vez de deixá-la na LP como se nada tivesse acontecido.
 *
 * Escuta `pageshow` porque ele cobre as duas voltas possíveis: a do bfcache
 * (voltar/swipe no celular, `persisted: true`) e a do carregamento normal. O
 * `useEffect` cobre o caso do App Router restaurar a árvore sem novo pageshow.
 */
export default function VoltaDoCheckout() {
  useEffect(() => {
    function conferir() {
      if (chegouPagando()) { limparSaidaDoCheckout(); return; }

      const destino = destinoDaVolta();
      if (!destino) return;

      // Já está na tela de saída (ou voltou de lá pro checkout e desistiu de
      // novo): consumir a marca e ficar parado. Redirecionar aqui seria um laço.
      if (window.location.pathname.startsWith('/quase-la')) { limparSaidaDoCheckout(); return; }

      limparSaidaDoCheckout();
      // replace, não href: o histórico já tem a ida pro checkout: empilhar mais
      // uma entrada faria o próximo "voltar" devolver a pessoa pra cá de novo.
      window.location.replace(destino);
    }

    conferir();
    window.addEventListener('pageshow', conferir);
    return () => window.removeEventListener('pageshow', conferir);
  }, []);

  return null;
}
