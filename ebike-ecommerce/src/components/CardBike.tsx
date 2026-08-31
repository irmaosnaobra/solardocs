import Image from 'next/image';
import Link from 'next/link';

import { PERTO_KM, RAIO_MAXIMO_KM } from '../config/frete.ts';
import { emReais } from '../config/loja.ts';
import { aindaVaiChegar } from '../lib/previsao.ts';
import type { Cartao } from '../types/bike.ts';

function Icone({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const RAIO = 'M13 2 4 14h7l-1 8 9-12h-7z';
const ESTRADA = 'M4 20 8 4M20 20 16 4M12 5v2m0 4v2m0 4v2';
const RELOGIO = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2';

/** Etiqueta de estoque: fala o que o fornecedor informou e nada além disso. */
function Selo({ bike }: { bike: Cartao }) {
  if (aindaVaiChegar(bike.previsao)) {
    return (
      <span className="rounded-full bg-alerta-clara px-2.5 py-1 text-[11px] font-semibold text-alerta">
        Sob encomenda
      </span>
    );
  }
  if (typeof bike.estoque === 'number' && bike.estoque > 0) {
    return (
      <span className="rounded-full bg-vantagem-clara px-2.5 py-1 text-[11px] font-semibold text-vantagem">
        Em estoque
      </span>
    );
  }
  return null;
}

export function CardBike({
  bike,
  prioridade = false,
  origem,
}: {
  bike: Cartao;
  prioridade?: boolean;
  /** De onde esta bike sai para quem está comprando. Ausente = não sabemos onde a pessoa está. */
  origem?: { cidade: string; uf: string; km: number; aproximado?: boolean };
}) {
  const fatos: Array<[string, string]> = [];
  if (bike.potencia) fatos.push([RAIO, bike.potencia]);
  if (bike.autonomia) fatos.push([ESTRADA, bike.autonomia]);
  if (bike.velocidade) fatos.push([RELOGIO, bike.velocidade]);

  return (
    <Link
      href={`/modelo/${bike.slug}`}
      // Atravessando o rewrite do domínio, o pedido de prefetch do Next volta
      // 404: o app da frente tenta responder por uma rota que é de outro app.
      // Pedir e levar 404 gasta dado do cliente no 4G sem acelerar nada.
      prefetch={false}
      className="cartao-clicavel group flex flex-col overflow-hidden"
    >
      <div className="relative aspect-[4/3] w-full bg-white">
        <Image
          src={bike.capa}
          alt={bike.titulo}
          fill
          sizes="(max-width: 640px) 46vw, (max-width: 1024px) 31vw, 280px"
          className="object-contain p-4 transition duration-300 group-hover:scale-[1.05]"
          priority={prioridade}
        />
        <span className="absolute top-3 left-3">
          <Selo bike={bike} />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-fraco uppercase">{bike.marca}</p>

        <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-tinta group-hover:text-mata">
          {bike.titulo}
        </h3>

        {fatos.length ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-suave">
            {fatos.map(([d, valor]) => (
              <li key={valor} className="flex items-center gap-1">
                <Icone d={d} />
                {valor}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-auto pt-2">
          <p className="tabular text-xl leading-none font-bold text-tinta">{emReais(bike.preco)}</p>
          <p className="mt-1 text-xs text-vantagem">à vista ou parcelado no cartão</p>

          {/* De onde sai, ANTES de a pessoa clicar. É o que evita descobrir o
              frete só depois de escolher, que é a hora mais cara para uma
              notícia ruim. */}
          {origem ? (
            <p className="mt-1 text-xs text-suave">
              sai de {origem.cidade} — {origem.uf} ·{' '}
              <span className={origem.km <= PERTO_KM ? 'font-semibold text-vantagem' : ''}>
                {/* Ponto da cidade não é o endereço de ninguém: o "≈" é o que
                    impede a loja de afirmar um número que ela não mediu. */}
                {origem.aproximado ? '≈ ' : ''}
                {origem.km.toLocaleString('pt-BR')} km
              </span>
            </p>
          ) : null}
          {/* Fora do raio a cotação não dá número. Sem este aviso o card ficava
              igual ao dos outros e a pessoa só descobria depois de clicar —
              que é exatamente a frustração que mostrar a origem veio matar. */}
          {origem && origem.km > RAIO_MAXIMO_KM ? (
            <p className="mt-0.5 text-xs text-alerta">frete cotado no atendimento</p>
          ) : null}
          {aindaVaiChegar(bike.previsao) ? (
            <p className="mt-1 text-xs text-alerta">chega {bike.previsao}</p>
          ) : typeof bike.estoque === 'number' && bike.estoque > 0 ? (
            <p className="mt-1 text-xs text-suave">
              {bike.estoque} {bike.estoque === 1 ? 'unidade' : 'unidades'}
            </p>
          ) : (
            <p className="mt-1 text-xs text-fraco">consultar disponibilidade</p>
          )}
        </div>
      </div>
    </Link>
  );
}
