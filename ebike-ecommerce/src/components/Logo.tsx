import { LOJA } from '../config/loja.ts';

/**
 * A marca: um distintivo preto com o raio em verde neon vazado no meio, e o
 * raio é feito de dois elos de corrente encaixados.
 *
 * Preto sólido em vez de traço fino de propósito: a marca precisa aguentar
 * 16px na aba do navegador e continuar sendo reconhecida. Traço fino some,
 * mancha cheia não.
 */
export function Marca({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="40" height="40" rx="11" fill="#0a0a0a" />
      {/* Raio: dois elos que se encaixam e formam o traço da corrente. */}
      <path d="M22.6 6.5 12 21.4h6.2l-1.5 12.1L28.4 18h-6.6l3.4-11.5z" fill="#39ff14" />
    </svg>
  );
}

export function Logo({ compacto = false }: { compacto?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-tinta">
      <Marca tamanho={compacto ? 30 : 38} />
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
          <span className="mt-1 block text-[10px] font-semibold tracking-[0.1em] text-suave uppercase">
            {LOJA.slogan}
          </span>
        )}
      </span>
    </span>
  );
}
