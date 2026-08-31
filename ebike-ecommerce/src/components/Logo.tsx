import { LOJA } from '../config/loja.ts';

/**
 * O símbolo da marca: o E final de CORRENTE, feito de três barras inclinadas.
 *
 * É o mesmo desenho no logotipo e no favicon, de propósito. Marca que muda de
 * cara entre a aba do navegador e o cabeçalho vira duas marcas.
 *
 * A barra do meio é mais curta que as outras: é o que faz o desenho ler como a
 * letra E e não como o ícone de menu, que tem três barras iguais. Detalhe
 * pequeno, mas é a diferença entre símbolo e ícone de sistema.
 */
export function MarcaE({
  cor = '#39ff14',
  className,
  style,
}: {
  cor?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 20 24" fill={cor} aria-hidden="true" className={className} style={style}>
      <rect x="0" y="0" width="20" height="5.6" rx="1.4" />
      <rect x="0" y="9.2" width="14.5" height="5.6" rx="1.4" />
      <rect x="0" y="18.4" width="20" height="5.6" rx="1.4" />
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
    <span className={'inline-block leading-none ' + (emFundoEscuro ? 'text-white' : 'text-tinta')}>
      {/* A palavra inclina para a frente: é o que dá a leitura de movimento. */}
      <span
        className={
          'flex items-center gap-[0.11em] font-black tracking-[-0.03em] uppercase ' +
          (compacto ? 'text-[22px]' : 'text-[30px]')
        }
        style={{ transform: 'skewX(-9deg)' }}
      >
        {LOJA.nomeCurto.slice(0, -1)}
        <MarcaE className="shrink-0" style={{ width: '0.62em', height: '0.76em' }} />
      </span>

      {compacto ? null : (
        <span
          className="mt-2 flex items-center gap-2 text-[9px] font-extrabold tracking-[0.2em] uppercase"
          style={{ color: verde }}
        >
          <i aria-hidden="true" className="block h-[2px] w-4 rounded-full bg-current" />
          {LOJA.descritor}
          <i aria-hidden="true" className="block h-[2px] w-4 rounded-full bg-current" />
        </span>
      )}
    </span>
  );
}
