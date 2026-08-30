import Image from 'next/image';
import Link from 'next/link';

import { emReais } from '../config/loja.ts';
import type { Cartao } from '../types/bike.ts';

/** Etiqueta de estoque: fala o que o fornecedor informou e nada além disso. */
function Disponibilidade({ bike }: { bike: Cartao }) {
  if (bike.previsao) {
    return (
      <p className="text-xs font-semibold text-alerta">Sob encomenda · chega {bike.previsao}</p>
    );
  }
  if (typeof bike.estoque === 'number') {
    return bike.estoque > 0 ? (
      <p className="text-xs font-semibold text-vantagem">
        {bike.estoque} {bike.estoque === 1 ? 'disponível' : 'disponíveis'}
      </p>
    ) : (
      <p className="text-xs text-fraco">Sem estoque hoje</p>
    );
  }
  return <p className="text-xs text-fraco">Consultar disponibilidade</p>;
}

export function CardBike({ bike, prioridade = false }: { bike: Cartao; prioridade?: boolean }) {
  return (
    <Link
      href={`/modelo/${bike.slug}`}
      className="cartao group flex flex-col overflow-hidden transition hover:shadow-[0_4px_12px_rgb(0_0_0/0.16)]"
    >
      <div className="relative aspect-square w-full bg-white">
        <Image
          src={bike.capa}
          alt={bike.titulo}
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 240px"
          className="object-contain p-4 transition duration-200 group-hover:scale-[1.04]"
          priority={prioridade}
        />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-borda p-4">
        <p className="text-[11px] tracking-wide text-fraco uppercase">{bike.marca}</p>

        <h3 className="line-clamp-2 text-sm leading-snug text-texto group-hover:text-acao">
          {bike.titulo}
        </h3>

        <p className="mt-1 text-2xl leading-none font-light text-texto">{emReais(bike.preco)}</p>
        <p className="text-xs text-vantagem">à vista, com a bike na sua mão</p>

        <div className="mt-auto pt-2">
          <Disponibilidade bike={bike} />
        </div>
      </div>
    </Link>
  );
}
