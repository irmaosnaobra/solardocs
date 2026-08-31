'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

const INTERVALO_MS = 2000;

/**
 * As bikes passando no quadro de cima, uma a cada dois segundos.
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
export function Vitrifoto({
  fotos,
}: {
  fotos: Array<{ src: string; titulo: string }>;
}) {
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
            sizes="(max-width: 640px) 92vw, 300px"
            priority={i === 0}
            className={
              'object-contain transition-opacity duration-500 ' +
              (i === atual ? 'opacity-100' : 'opacity-0')
            }
          />
        ) : null,
      )}

      {/* Diz qual bike está passando. Sem isso é enfeite; com isso é vitrine. */}
      <p className="absolute inset-x-0 bottom-0 truncate text-center text-[11px] text-suave">
        {fotos[atual].titulo}
      </p>
    </div>
  );
}
