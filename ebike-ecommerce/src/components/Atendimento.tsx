import { BASE_PATH } from '../config/basePath.mjs';
import { CampanhaOculta } from './CampanhaOculta.tsx';

/**
 * O botão redondo do WhatsApp, parado no canto da tela.
 *
 * Existe para quem AINDA não escolheu modelo. O caminho da loja (escolher a
 * bike, dizer como paga, cair no consultor do rodízio) supõe uma decisão
 * tomada; quem chegou do anúncio com uma dúvida solta não passa por ele e vai
 * embora sem deixar nome. Este botão pede as três coisas com que dá para
 * retornar a conversa — nome, telefone e cidade — e manda para a central.
 *
 * `<details>` e formulário GET, sem uma linha de JavaScript: abrir, preencher e
 * sair para o WhatsApp funciona com o bundle quebrado, que é a regra desta loja
 * para todo caminho por onde o lead vai embora. Quem monta o texto da mensagem
 * é a rota `/contato`.
 */
export function Atendimento() {
  return (
    <details className="group fixed right-4 bottom-4 z-50 print:hidden">
      <summary
        aria-label="Falar no WhatsApp"
        // `list-none` some com a setinha do <details> no Firefox; o seletor do
        // marcador cuida do Safari e do Chrome.
        className="botao-principal toque flex h-14 w-14 cursor-pointer list-none rounded-full shadow-lg [&::-webkit-details-marker]:hidden"
      >
        {/* Glifo do WhatsApp em traço único, na cor do texto do botão: o
            logotipo verde oficial brigaria com o neon da marca, e emoji não é
            ícone de interface. */}
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="group-open:hidden"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
        </svg>

        {/* Aberto, o mesmo botão fecha. Sem isto, no celular o painel cobre a
            tela e a única saída é recarregar a página. */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="hidden group-open:block"
        >
          <path
            d="M6 6l12 12M18 6 6 18"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      {/* O painel vem DEPOIS do botão porque <summary> tem que ser o primeiro
          filho do <details> — fora dessa posição o navegador ignora e desenha
          uma setinha "Detalhes" no lugar. Quem o coloca acima do botão na tela
          é o `absolute bottom-full`, e é acima que ele cabe no celular sem
          ficar embaixo da mão de quem tocou. */}
      <div className="absolute right-0 bottom-full mb-3 w-[min(20rem,calc(100vw-2rem))] origin-bottom-right">
        <form
          // Formulário HTML puro não ganha o basePath sozinho, igual à foto.
          action={`${BASE_PATH}/contato`}
          method="get"
          className="cartao flex flex-col gap-3 border border-borda p-4"
        >
          <div>
            <p className="text-sm font-bold text-tinta">Quer que a gente te chame?</p>
            <p className="mt-0.5 text-xs text-suave">
              Deixe seus dados e o WhatsApp abre com tudo escrito. Sem cadastro.
            </p>
          </div>

          <CampanhaOculta />

          <div>
            <label className="block text-xs font-semibold text-tinta" htmlFor="atendimento-nome">
              Seu nome
            </label>
            <input
              id="atendimento-nome"
              name="nome"
              type="text"
              required
              maxLength={80}
              autoComplete="name"
              placeholder="Como podemos te chamar"
              className="mt-1 h-12 w-full rounded-xl border border-borda-forte bg-white px-3 text-base text-tinta placeholder:text-fraco focus:border-tinta focus:outline-none"
            />
          </div>

          <div>
            <label
              className="block text-xs font-semibold text-tinta"
              htmlFor="atendimento-telefone"
            >
              WhatsApp com DDD
            </label>
            {/* `inputMode="tel"` abre o teclado de números no celular sem
                impedir que a pessoa cole o número com parênteses e traço; a
                rota /contato joga fora tudo que não é dígito. */}
            <input
              id="atendimento-telefone"
              name="telefone"
              type="tel"
              required
              inputMode="tel"
              maxLength={20}
              autoComplete="tel"
              placeholder="(34) 99999-9999"
              className="tabular mt-1 h-12 w-full rounded-xl border border-borda-forte bg-white px-3 text-base text-tinta placeholder:text-fraco focus:border-tinta focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-tinta" htmlFor="atendimento-cidade">
              Sua cidade
            </label>
            <input
              id="atendimento-cidade"
              name="cidade"
              type="text"
              required
              maxLength={80}
              autoComplete="address-level2"
              placeholder="Uberlândia MG"
              className="mt-1 h-12 w-full rounded-xl border border-borda-forte bg-white px-3 text-base text-tinta placeholder:text-fraco focus:border-tinta focus:outline-none"
            />
          </div>

          <button type="submit" className="botao-principal toque w-full px-4 text-sm">
            Abrir o WhatsApp
          </button>
        </form>
      </div>
    </details>
  );
}
