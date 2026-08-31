'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

const INTERVALO_MS = 2000;

/**
 * As bikes passando no quadro de cima, uma a cada dois segundos.
 *
 * Todas as fotos são pedidas na MESMA largura. Cada largura diferente é uma
 * otimização a mais para o servidor gerar na primeira visita, e é nesse
 * instante que a foto aparece em branco por um segundo.
 *
 * Só a foto ATUAL e a SEGUINTE ficam montadas. Montar as 29 de uma vez faria o
 * navegador pedir 29 imagens no primeiro segundo, e no 4G isso atrasa o que a
 * pessoa veio ver, que é a vitrine. Montando a seguinte, ela já chega carregada
 * na hora da troca e a transição não pisca.
 *
 * Quem pede menos movimento no sistema vê a primeira e pronto: rodízio
 * automático é exatamente o tipo de coisa que essa preferência existe para
 * desligar.
 */
export function Vitrifoto({ fotos }: { fotos: Array<{ src: string; titulo: string }> }) {
  const [atual, setAtual] = useState(0);

  useEffect(() => {
    if (fotos.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = setInterval(() => setAtual((i) => (i + 1) % fotos.length), INTERVALO_MS);
    return () => clearInterval(id);
  }, [fotos.length]);

  if (!fotos.length) return null;

  const proxima = (atual + 1) % fotos.length;

  return (
    <div className="relative aspect-[5/3] w-full sm:aspect-[4/3]">
      {fotos.map((f, i) =>
        i === atual || i === proxima ? (
          <Image
            key={f.src}
            src={f.src}
            alt={i === atual ? f.titulo : ''}
            fill
            sizes="320px"
            priority={i === 0}
            className={
              'object-contain transition-opacity duration-500 ' +
              (i === atual ? 'opacity-100' : 'opacity-0')
            }
          />
        ) : null,
      )}
    </div>
  );
}
