import { LOJA } from '../config/loja.ts';

/**
 * A marca: um elo de corrente cortado por um raio.
 *
 * O anel é grosso de propósito: a marca precisa aguentar 16px na aba do
 * navegador e continuar reconhecível, e traço fino some. O raio não passa POR
 * CIMA do elo, ele CORTA: o vão de respiro em volta do raio é o que faz o
 * desenho parecer partido pela corrente em vez de dois adesivos empilhados.
 *
 * Foram desenhadas sete versões e todas olhadas em 96, 48, 32 e 16px. As de C
 * aberto ficavam bonitas grandes e viravam vírgula em 16px; esta não.
 *
 * `fundo` é a cor do vão. Tem que ser a cor de trás da marca, senão o respiro
 * some e o raio volta a parecer colado.
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

/**
 * O "E" final da palavra, feito de três barras.
 *
 * É o traço que dá identidade ao logotipo: sem ele a palavra é só uma fonte
 * pesada em caixa alta, que qualquer um tem. As medidas são em `em` para a
 * barra crescer junto com a letra em qualquer tamanho.
 */
function BarrasE({ cor }: { cor: string }) {
  return (
    <svg
      viewBox="0 0 17 24"
      fill={cor}
      aria-hidden="true"
      style={{ width: '0.57em', height: '0.8em' }}
      className="shrink-0"
    >
      <rect x="0" y="0" width="17" height="5.4" rx="1.4" />
      <rect x="0" y="9.3" width="17" height="5.4" rx="1.4" />
      <rect x="0" y="18.6" width="17" height="5.4" rx="1.4" />
    </svg>
  );
}

export function Logo({
  compacto = false,
  emFundoEscuro = false,
}: {
  compacto?: boolean;
  emFundoEscuro?: boolean;
}) {
  // No claro o verde neon não passa em contraste como texto fino; ali o
  // descritor vai no verde-mata. No escuro o neon é que funciona.
  const verde = emFundoEscuro ? '#39ff14' : '#1d7a08';

  return (
    <span className={'flex items-center gap-3 ' + (emFundoEscuro ? 'text-white' : 'text-tinta')}>
      <Marca
        tamanho={compacto ? 34 : 46}
        cor={emFundoEscuro ? '#ffffff' : '#0a0a0a'}
        fundo={emFundoEscuro ? '#0a0a0a' : '#ffffff'}
      />
      <span className="leading-none">
        {/* A palavra inclina para a frente: é o que dá a leitura de movimento. */}
        <span
          className={
            'flex items-center gap-[0.12em] font-black tracking-[-0.03em] uppercase ' +
            (compacto ? 'text-xl' : 'text-[26px]')
          }
          style={{ transform: 'skewX(-9deg)' }}
        >
          {LOJA.nomeCurto.slice(0, -1)}
          <BarrasE cor="#39ff14" />
        </span>

        {compacto ? null : (
          <span
            className="mt-1.5 flex items-center gap-2 text-[9px] font-extrabold tracking-[0.2em] uppercase"
            style={{ color: verde }}
          >
            <i aria-hidden="true" className="block h-[2px] w-4 rounded-full bg-current" />
            {LOJA.descritor}
            <i aria-hidden="true" className="block h-[2px] w-4 rounded-full bg-current" />
          </span>
        )}
      </span>
    </span>
  );
}
