import { LOJA } from '../config/loja.ts';

/**
 * A marca desenhada: um elo de corrente aberto, em forma de C, com o raio
 * dentro. As duas leituras do nome numa figura só, e sem nenhum detalhe que
 * suma a 24px, que é o tamanho em que ela vai viver na aba do navegador.
 *
 * `currentColor` de propósito: o mesmo arquivo serve em cima do claro e do
 * escuro sem virar duas versões que depois divergem.
 */
export function Marca({ tamanho = 30 }: { tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M23.2 8.6a10.6 10.6 0 1 0 0 14.8"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path d="M17.9 8.4 12.2 17h3.7l-1.6 6.6 5.8-8.9h-3.7z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ compacto = false }: { compacto?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-tinta">
      <Marca tamanho={compacto ? 26 : 32} />
      <span className="leading-none">
        <span
          className={
            'block font-extrabold tracking-[-0.03em] uppercase ' +
            (compacto ? 'text-lg' : 'text-xl')
          }
        >
          {LOJA.nomeCurto}
        </span>
        {compacto ? null : (
          <span className="mt-0.5 block text-[10px] tracking-[0.16em] text-suave uppercase">
            {LOJA.assinatura}
          </span>
        )}
      </span>
    </span>
  );
}
