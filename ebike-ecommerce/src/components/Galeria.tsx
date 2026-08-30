'use client';

import Image from 'next/image';
import { useState } from 'react';

export function Galeria({ imagens, titulo }: { imagens: string[]; titulo: string }) {
  const [atual, setAtual] = useState(0);
  const principal = imagens[atual] ?? imagens[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="palco relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-borda">
        {principal ? (
          <Image
            src={principal}
            alt={`${titulo}, foto ${atual + 1} de ${imagens.length}`}
            fill
            sizes="(max-width: 1024px) 94vw, 560px"
            className="object-contain p-6"
            priority
          />
        ) : null}
      </div>

      {imagens.length > 1 ? (
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {imagens.map((img, i) => (
            <li key={img}>
              <button
                type="button"
                onClick={() => setAtual(i)}
                aria-label={`Ver foto ${i + 1}`}
                aria-current={i === atual}
                className={
                  'palco-liso relative block aspect-square w-full overflow-hidden rounded-xl border transition ' +
                  (i === atual ? 'border-acento' : 'border-borda hover:border-acento/50')
                }
              >
                <Image
                  src={img}
                  alt=""
                  fill
                  sizes="120px"
                  className="object-contain p-2"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
