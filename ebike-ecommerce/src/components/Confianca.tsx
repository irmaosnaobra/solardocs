import { DIREITOS, EMPRESA } from '../config/empresa.ts';
import { LOJA } from '../config/loja.ts';

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-vantagem"
    >
      <path
        d="m5 13 4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Quem vende, e o que a pessoa tem de direito.
 *
 * Vai na página do PRODUTO, junto do botão, e não escondido no rodapé: a
 * dúvida "posso confiar nisso?" aparece no segundo em que a pessoa olha o preço
 * de oito mil reais, não depois de rolar a página inteira.
 *
 * A primeira linha diz quem está por trás da marca: Irmãos na Obra. CNPJ e
 * razão social NÃO entram aqui — por decisão do Thiago (03/09) eles só aparecem
 * no contrato/nota do fechamento. O que sustenta a confiança nesta tela é a
 * nota fiscal, o prazo de garantia e o preço fechado, não o número.
 */
export function Confianca() {
  return (
    <section className="cartao p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-tinta">Comprando com segurança</h2>

      <p className="mt-1.5 text-xs leading-relaxed text-suave">
        <strong className="font-semibold text-tinta">{LOJA.nomeCurto}</strong> é a marca de
        bicicletas e scooters elétricas da{' '}
        <strong className="text-tinta">{EMPRESA.nome}</strong>, em {EMPRESA.cidade}.
      </p>

      <ul className="mt-3 flex flex-col gap-2.5">
        {DIREITOS.map((d) => (
          <li key={d.titulo} className="flex gap-2">
            <Check />
            <p className="text-xs leading-relaxed text-suave">
              <strong className="font-semibold text-tinta">{d.titulo}.</strong> {d.texto}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
