import { LOJA } from '../config/loja.ts';

/**
 * A marca: um elo de corrente cortado por um raio.
 *
 * O anel é o elo, e é grosso de propósito: a marca precisa aguentar 16px na aba
 * do navegador e continuar sendo reconhecida, e traço fino some. O raio não
 * passa POR CIMA do elo, ele CORTA: o vão de respiro em volta do raio é o que
 * faz o desenho parecer partido pela corrente em vez de dois adesivos
 * empilhados. Foi o que separou este das outras quatro versões desenhadas.
 *
 * `fundo` é a cor desse vão. Tem que ser a cor de trás da marca, senão o
 * respiro some e o raio volta a parecer colado.
 */
export function Marca({
  tamanho = 40,
  cor = '#0a0a0a',
  raio = '#39ff14',
  fundo = '#ffffff',
}: {
  tamanho?: number;
  cor?: string;
  raio?: string;
  fundo?: string;
}) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M20 4a16 16 0 1 0 0 32 16 16 0 0 0 0-32Zm0 7a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z"
        fill={cor}
      />
      <path
        d="M26 3 13 21h6.2L16 37l13-18h-6.2L26 3Z"
        fill={raio}
        stroke={fundo}
        strokeWidth="3.2"
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  );
}

export function Logo({ compacto = false }: { compacto?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-tinta">
      <Marca tamanho={compacto ? 32 : 42} />
      <span className="leading-none">
        <span
          className={
            'block font-black tracking-[-0.045em] uppercase ' +
            (compacto ? 'text-xl' : 'text-2xl')
          }
        >
          {LOJA.nomeCurto}
        </span>
        {compacto ? null : (
          <span className="mt-1.5 block text-[8.5px] font-bold tracking-[0.14em] text-suave uppercase">
            {LOJA.slogan}
          </span>
        )}
      </span>
    </span>
  );
}
