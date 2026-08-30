import Image from 'next/image';
import Link from 'next/link';

import { emReais } from '../config/loja.ts';
import type { Cartao } from '../types/bike.ts';

/** Etiqueta de estoque: fala o que o fornecedor informou e nada além disso. */
function Disponibilidade({ bike }: { bike: Cartao }) {
  if (bike.previsao) {
    return (
      <span className="rounded-full bg-alerta/15 px-2.5 py-1 text-[11px] font-semibold text-alerta">
        Sob encomenda · previsão {bike.previsao}
      </span>
    );
  }
  if (typeof bike.estoque === 'number') {
    return bike.estoque > 0 ? (
      <span className="rounded-full bg-acento/15 px-2.5 py-1 text-[11px] font-semibold text-acento">
        {bike.estoque} {bike.estoque === 1 ? 'unidade' : 'unidades'}
      </span>
    ) : (
      <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-suave">
        Sem estoque hoje
      </span>
    );
  }
  return (
    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-suave">
      Consultar disponibilidade
    </span>
  );
}

export function CardBike({ bike, prioridade = false }: { bike: Cartao; prioridade?: boolean }) {
  return (
    <Link
      href={`/bike/${bike.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-borda bg-superficie transition hover:border-acento/50 hover:bg-superficie-alta"
    >
      <div className="palco relative aspect-[4/3] w-full">
        <Image
          src={bike.capa}
          alt={bike.titulo}
          fill
          sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 30vw"
          className="object-contain p-4 transition duration-300 group-hover:scale-[1.03]"
          priority={prioridade}
        />
        <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-texto backdrop-blur">
          {bike.marca}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-suave">
          <span className="rounded-full border border-borda px-2.5 py-1">{bike.categoria}</span>
          <Disponibilidade bike={bike} />
        </div>

        <h3 className="text-base leading-snug font-semibold text-texto">{bike.titulo}</h3>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-suave">
          {bike.potencia ? <li>Motor {bike.potencia}</li> : null}
          {bike.autonomia ? <li>Autonomia {bike.autonomia}</li> : null}
          {bike.velocidade ? <li>Até {bike.velocidade}</li> : null}
        </ul>

        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <p className="text-[11px] text-suave">à vista</p>
            <p className="text-xl font-bold tracking-tight text-texto">{emReais(bike.preco)}</p>
          </div>
          <span className="toque rounded-xl bg-acento px-4 text-sm font-semibold text-black transition group-hover:bg-acento-escuro">
            Ver bike
          </span>
        </div>
      </div>
    </Link>
  );
}
