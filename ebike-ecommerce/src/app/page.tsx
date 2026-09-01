import { Suspense } from 'react';

import { Vitrifoto } from '../components/Vitrifoto.tsx';
import { Vitrine } from '../components/Vitrine.tsx';
import { basesDoCatalogo, catalogoPublico, marcasDe, paraCartao } from '../lib/catalogo.ts';
import { LOJA, emReais } from '../config/loja.ts';
import { textoDeConferencia } from '../lib/conferido.ts';

/**
 * A página é gerada de novo uma vez por dia, e é isso que mantém preço e estoque
 * em dia sem ninguém apertar botão. O cron em `/api/sync` força a atualização
 * na hora certa da manhã.
 */
export const revalidate = 86400;

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div>
      <p className="tabular text-lg font-bold text-tinta sm:text-xl">{valor}</p>
      <p className="text-[11px] text-suave">{rotulo}</p>
    </div>
  );
}

export default async function Pagina() {
  const { bikes: completas, meta } = await catalogoPublico();
  const bikes = completas.map(paraCartao);
  const marcas = marcasDe(bikes);
  const menorPreco = bikes.length ? Math.min(...bikes.map((b) => b.preco)) : 0;
  const atualizado = new Date(meta.atualizadoEm).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });

  const fotos = bikes.map((b) => ({ src: b.capa, titulo: b.titulo }));
  const bases = await basesDoCatalogo();

  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-4 sm:pt-6">
        <div className="cartao grid gap-4 p-4 sm:grid-cols-[1fr_300px] sm:items-center sm:gap-6 sm:p-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-mata uppercase">
              {LOJA.slogan}
            </p>
            {/* O verde não vira texto: vira marca-texto atrás do preto. Neon
                em letra sobre branco dá 1,4:1 de contraste e some no sol. */}
            <h1 className="mt-2 text-[26px] leading-[1.1] font-black tracking-[-0.02em] text-tinta sm:text-4xl">
              {/* Sem vírgula depois do destaque: a pontuação cai fora do
                  bloco verde e fica boiando a um espaço da palavra. */}
              Bicicletas e scooters{' '}
              <span className="box-decoration-clone bg-neon px-1.5">elétricas</span> entregues em
              todo o Brasil
            </h1>

            <dl className="mt-4 flex gap-6">
              <Numero valor={String(bikes.length)} rotulo="modelos" />
              <Numero valor={String(marcas.length)} rotulo="marcas" />
              <Numero valor={emReais(menorPreco)} rotulo="a partir de" />
            </dl>
          </div>

          <Vitrifoto fotos={fotos} />
        </div>
      </section>

      {/* A vitrine lê filtro e busca da URL, e useSearchParams pede Suspense
          para a página seguir sendo gerada estaticamente. */}
      <Suspense
        fallback={
          <p className="mx-auto max-w-[1240px] px-4 py-10 text-sm text-suave">Carregando…</p>
        }
      >
        <Vitrine bikes={bikes} bases={bases} conferidoEm={textoDeConferencia(meta.atualizadoEm)} />
      </Suspense>

      <p className="mx-auto max-w-[1240px] px-4 pb-2 text-xs text-fraco">
        Catálogo lido do nosso fornecedor em {atualizado}
        {meta.origem === 'reserva' ? ' (última leitura bem-sucedida).' : '.'}
      </p>
    </>
  );
}
