'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

/**
 * Galeria de vitrine: coluna de miniaturas ao lado da foto grande, e a foto
 * grande abre em tela cheia com seta para os lados.
 *
 * A miniatura troca a foto no PASSAR do mouse, não só no clique: no desktop é
 * o que faz a pessoa ver as cinco fotos sem perceber que está clicando. No
 * celular a mesma miniatura responde ao toque.
 */
export function Galeria({ imagens, titulo }: { imagens: string[]; titulo: string }) {
  const [atual, setAtual] = useState(0);
  const [ampliada, setAmpliada] = useState(false);

  const total = imagens.length;
  const ir = useCallback((passo: number) => setAtual((i) => (i + passo + total) % total), [total]);

  useEffect(() => {
    if (!ampliada) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAmpliada(false);
      if (e.key === 'ArrowRight') ir(1);
      if (e.key === 'ArrowLeft') ir(-1);
    }
    document.addEventListener('keydown', tecla);
    // Sem isto a página de trás rola junto com a foto ampliada.
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = '';
    };
  }, [ampliada, ir]);

  const principal = imagens[atual] ?? imagens[0];

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {total > 1 ? (
        <ul className="flex shrink-0 gap-2 overflow-x-auto sm:flex-col sm:overflow-visible">
          {imagens.map((img, i) => (
            <li key={img}>
              <button
                type="button"
                onMouseEnter={() => setAtual(i)}
                onFocus={() => setAtual(i)}
                onClick={() => setAtual(i)}
                aria-label={`Ver foto ${i + 1} de ${total}`}
                aria-current={i === atual}
                className={
                  'relative block size-14 shrink-0 overflow-hidden rounded-sm border bg-white transition ' +
                  (i === atual ? 'border-acao' : 'border-borda-forte hover:border-acao')
                }
              >
                <Image src={img} alt="" fill sizes="56px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setAmpliada(true)}
          aria-label="Ampliar foto"
          className="relative block aspect-[4/3] w-full cursor-zoom-in bg-white"
        >
          {principal ? (
            <Image
              src={principal}
              alt={`${titulo}, foto ${atual + 1} de ${total}`}
              fill
              sizes="(max-width: 1024px) 94vw, 520px"
              className="object-contain p-4"
              priority
            />
          ) : null}
        </button>
        <p className="mt-1 text-center text-xs text-fraco">
          {total > 1 ? `${atual + 1} de ${total} fotos · ` : ''}Clique na foto para ampliar
        </p>
      </div>

      {ampliada ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fotos de ${titulo}`}
          onClick={() => setAmpliada(false)}
          className="fixed inset-0 z-50 flex flex-col bg-white"
        >
          <div className="flex justify-end p-3">
            <button
              type="button"
              onClick={() => setAmpliada(false)}
              aria-label="Fechar"
              className="toque size-12 rounded-full text-2xl text-suave hover:bg-fundo"
            >
              ✕
            </button>
          </div>

          <div className="relative flex-1" onClick={(e) => e.stopPropagation()}>
            {principal ? (
              <Image
                src={principal}
                alt={`${titulo}, foto ${atual + 1} de ${total}`}
                fill
                sizes="100vw"
                className="object-contain p-4"
              />
            ) : null}

            {total > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => ir(-1)}
                  aria-label="Foto anterior"
                  className="toque absolute top-1/2 left-2 size-12 -translate-y-1/2 rounded-full bg-white text-2xl text-texto shadow-md"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => ir(1)}
                  aria-label="Próxima foto"
                  className="toque absolute top-1/2 right-2 size-12 -translate-y-1/2 rounded-full bg-white text-2xl text-texto shadow-md"
                >
                  ›
                </button>
              </>
            ) : null}
          </div>

          {total > 1 ? (
            <ul
              className="flex justify-center gap-2 overflow-x-auto p-4"
              onClick={(e) => e.stopPropagation()}
            >
              {imagens.map((img, i) => (
                <li key={img}>
                  <button
                    type="button"
                    onClick={() => setAtual(i)}
                    aria-label={`Ver foto ${i + 1}`}
                    aria-current={i === atual}
                    className={
                      'relative block size-14 shrink-0 overflow-hidden rounded-sm border bg-white ' +
                      (i === atual ? 'border-acao' : 'border-borda-forte')
                    }
                  >
                    <Image src={img} alt="" fill sizes="56px" className="object-contain p-1" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
