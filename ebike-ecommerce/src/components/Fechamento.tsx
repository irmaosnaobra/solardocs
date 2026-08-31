import { BASE_PATH } from '../config/basePath.mjs';
import { Frete } from './Frete.tsx';
import { FORMAS_DE_PAGAMENTO, emReais } from '../config/loja.ts';
import { aindaVaiChegar } from '../lib/previsao.ts';
import type { Bike } from '../types/bike.ts';

/**
 * A caixa de compra. É um formulário comum, sem JavaScript no caminho crítico:
 * quem escolhe o consultor é o servidor, na rota /falar, e é de lá que sai o
 * link do WhatsApp.
 *
 * O botão que leva o lead embora é a peça que não pode falhar, e formulário
 * HTML funciona mesmo com o bundle quebrado. O cálculo do CEP é a única parte
 * com JavaScript, e ela é opcional: sem preencher, o lead sai igual.
 */
export function Fechamento({ bike }: { bike: Bike }) {
  return (
    // Formulário HTML puro não ganha o basePath sozinho, igual à foto.
    <form action={`${BASE_PATH}/falar`} method="get" className="flex flex-col gap-4">
      <input type="hidden" name="bike" value={bike.slug} />

      <div>
        <p className="tabular text-3xl leading-none font-bold text-tinta">{emReais(bike.preco)}</p>
        <p className="mt-1.5 text-sm text-vantagem">à vista ou parcelado no cartão</p>
      </div>

      {aindaVaiChegar(bike.previsao) ? (
        <p className="rounded-xl bg-alerta-clara px-3 py-2.5 text-sm text-texto">
          <strong className="font-semibold text-alerta">Sob encomenda.</strong> O fornecedor informa
          chegada prevista em {bike.previsao}. Confirme o prazo no atendimento.
        </p>
      ) : typeof bike.estoque === 'number' && bike.estoque > 0 ? (
        <p className="rounded-xl bg-vantagem-clara px-3 py-2.5 text-sm text-texto">
          <strong className="font-semibold text-vantagem">Em estoque.</strong> {bike.estoque}{' '}
          {bike.estoque === 1 ? 'unidade disponível' : 'unidades disponíveis'} agora.
        </p>
      ) : null}

      <Frete
        bases={bike.bases}
        pesoKg={bike.pesoKg}
        volumeM3={bike.volumeM3}
        categoria={bike.categoria}
      />

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-tinta">Como você prefere pagar?</legend>
        <div className="flex flex-col gap-2">
          {FORMAS_DE_PAGAMENTO.map((f) => (
            <label key={f.id} className="block cursor-pointer">
              <input type="radio" name="pagamento" value={f.id} required className="peer sr-only" />
              <span className="flex min-h-12 flex-col justify-center rounded-xl border border-borda-forte px-3 py-2 transition peer-checked:border-acao peer-checked:bg-acao-clara peer-focus-visible:outline peer-focus-visible:outline-acao">
                <span className="text-sm font-semibold text-tinta">{f.rotulo}</span>
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
        código, o valor, a forma de pagamento e o seu CEP já vão escritos na mensagem.
      </p>
    </form>
  );
}
