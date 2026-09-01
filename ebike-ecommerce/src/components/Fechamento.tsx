import { BASE_PATH } from '../config/basePath.mjs';
import { CampanhaOculta } from './CampanhaOculta.tsx';
import { PixelLead } from './PixelLead.tsx';
import { Frete } from './Frete.tsx';
import { FORMAS_DE_PAGAMENTO, PARCELAS_MAXIMAS, emReais } from '../config/loja.ts';
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
export function Fechamento({ bike, conferidoEm }: { bike: Bike; conferidoEm?: string | null }) {
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
      ) : conferidoEm ? (
        /* Sem o login do fornecedor não vem a QUANTIDADE. Então a loja diz a
           única coisa que sabe de verdade, e ela não é fraca: este modelo
           estava no catálogo do fornecedor na última varredura, que roda duas
           vezes por dia. */
        <p className="rounded-xl bg-fundo px-3 py-2.5 text-sm text-suave">
          <strong className="font-semibold text-tinta">Disponível no fornecedor.</strong> Conferido
          em {conferidoEm}. A loja revisa o estoque das 22 unidades duas vezes por dia, às 7h e às
          13h; a quantidade exata o vendedor confirma na conversa.
        </p>
      ) : null}

      <CampanhaOculta />
      <PixelLead codigo={bike.codigo} preco={bike.preco} />

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
            /* O input é irmão do rótulo e do bloco de parcelas, não pai deles:
               é isso que deixa "peer-checked" abrir as parcelas SEM javascript.
               Este formulário é o que leva o lead embora, e ele tem que
               funcionar mesmo se o bundle quebrar. */
            <div key={f.id}>
              <input
                type="radio"
                id={`pagamento-${f.id}`}
                name="pagamento"
                value={f.id}
                required
                className="peer sr-only"
              />
              <label
                htmlFor={`pagamento-${f.id}`}
                className="flex min-h-12 cursor-pointer flex-col justify-center rounded-xl border border-borda-forte px-3 py-2 transition peer-checked:border-acao peer-checked:bg-acao-clara peer-focus-visible:outline peer-focus-visible:outline-acao"
              >
                <span className="text-sm font-semibold text-tinta">{f.rotulo}</span>
                <span className="text-xs text-suave">{f.detalhe}</span>
              </label>

              {f.id === 'cartao' ? (
                <div className="hidden peer-checked:block">
                  <label className="mt-2 block text-xs font-semibold text-tinta" htmlFor="parcelas">
                    Em quantas vezes?
                  </label>
                  <select
                    id="parcelas"
                    name="parcelas"
                    defaultValue=""
                    className="mt-1 h-12 w-full rounded-xl border border-borda-forte bg-white px-3 text-sm text-tinta focus:border-tinta focus:outline-none"
                  >
                    <option value="">A combinar com o vendedor</option>
                    {Array.from({ length: PARCELAS_MAXIMAS }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                  {/* Só a QUANTIDADE. O valor da parcela depende de juros que
                      não foram confirmados, e número errado numa página pública
                      é promessa que quem atende teria de desdizer. */}
                  <p className="mt-1 text-xs text-suave">
                    A sua escolha vai na mensagem. O valor de cada parcela o vendedor confirma na
                    conversa.
                  </p>
                </div>
              ) : null}
            </div>
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
