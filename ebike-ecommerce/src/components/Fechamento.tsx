import { BASE_PATH } from '../config/basePath.mjs';
import { FORMAS_DE_PAGAMENTO, emReais } from '../config/loja.ts';
import type { Bike } from '../types/bike.ts';

/**
 * A caixa de compra. É um formulário comum, sem JavaScript: quem escolhe o
 * consultor é o servidor, na rota /falar, e é de lá que sai o link do WhatsApp.
 *
 * Sem JS de propósito. O botão que leva o lead embora é a peça que não pode
 * falhar, e formulário HTML funciona mesmo com o bundle quebrado.
 */
export function Fechamento({ bike }: { bike: Bike }) {
  return (
    // Formulário HTML puro não ganha o basePath sozinho, igual à foto.
    <form action={`${BASE_PATH}/falar`} method="get" className="flex flex-col gap-4">
      <input type="hidden" name="bike" value={bike.slug} />

      <div>
        <p className="text-3xl leading-none font-light text-texto">{emReais(bike.preco)}</p>
        <p className="mt-1 text-sm text-vantagem">
          à vista &middot; entrega combinada no atendimento
        </p>
      </div>

      {bike.previsao ? (
        <p className="rounded-sm bg-alerta/10 px-3 py-2 text-sm text-texto">
          <strong className="font-semibold">Sob encomenda.</strong> O fornecedor informa chegada
          prevista em {bike.previsao}. Confirme o prazo no atendimento.
        </p>
      ) : typeof bike.estoque === 'number' && bike.estoque > 0 ? (
        <p className="text-sm text-texto">
          <strong className="font-semibold">Estoque:</strong> {bike.estoque}{' '}
          {bike.estoque === 1 ? 'unidade disponível' : 'unidades disponíveis'}
        </p>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-texto">
          Como você prefere pagar?
        </legend>
        <div className="flex flex-col gap-2">
          {FORMAS_DE_PAGAMENTO.map((f) => (
            <label key={f.id} className="block cursor-pointer">
              <input
                type="radio"
                name="pagamento"
                value={f.id}
                required
                className="peer sr-only"
              />
              <span className="flex min-h-12 flex-col justify-center rounded-sm border border-borda-forte px-3 py-2 transition peer-checked:border-acao peer-checked:bg-acao-clara peer-focus-visible:outline peer-focus-visible:outline-acao">
                <span className="text-sm font-semibold text-texto">{f.rotulo}</span>
                <span className="text-xs text-suave">{f.detalhe}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className="botao-principal toque w-full px-6 text-base">
        Falar com o vendedor no WhatsApp
      </button>

      <p className="text-xs text-suave">
        Você fala direto com um dos nossos consultores, sem cadastro e sem formulário. O modelo, o
        código, o valor e a forma de pagamento já vão escritos na mensagem.
      </p>
    </form>
  );
}
