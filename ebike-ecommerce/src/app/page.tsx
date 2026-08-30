import { Suspense } from 'react';

import { Vitrine } from '../components/Vitrine.tsx';
import { catalogoPublico, categoriasDe, marcasDe, paraCartao } from '../lib/catalogo.ts';
import { LOJA, emReais } from '../config/loja.ts';

/**
 * A página é gerada de novo uma vez por dia, e é isso que mantém preço e estoque
 * em dia sem ninguém apertar botão. O cron em `/api/sync` força a atualização
 * na hora certa da manhã.
 */
export const revalidate = 86400;

export default async function Pagina() {
  const { bikes: completas, meta } = await catalogoPublico();
  const bikes = completas.map(paraCartao);
  const marcas = marcasDe(bikes);
  const categorias = categoriasDe(bikes);
  const menorPreco = bikes.length ? Math.min(...bikes.map((b) => b.preco)) : 0;
  const atualizado = new Date(meta.atualizadoEm).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });

  return (
    <>
      <section className="mx-auto max-w-[1200px] px-4 pt-5">
        <div className="cartao flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-texto">{LOJA.chamada}</h1>
            <p className="text-sm text-suave">{LOJA.descricao}</p>
          </div>
          <dl className="flex shrink-0 gap-6 text-sm">
            <div>
              <dt className="text-xs text-fraco">modelos</dt>
              <dd className="font-semibold text-texto">{bikes.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-fraco">marcas</dt>
              <dd className="font-semibold text-texto">{marcas.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-fraco">a partir de</dt>
              <dd className="font-semibold text-vantagem">{emReais(menorPreco)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* A vitrine lê filtro e busca da URL, e useSearchParams pede Suspense
          para a página seguir sendo gerada estaticamente. */}
      <Suspense
        fallback={<p className="mx-auto max-w-[1200px] px-4 py-10 text-sm text-suave">Carregando…</p>}
      >
        <Vitrine bikes={bikes} marcas={marcas} categorias={categorias} />
      </Suspense>

      <p className="mx-auto max-w-[1200px] px-4 pb-2 text-xs text-fraco">
        Catálogo lido do nosso fornecedor em {atualizado}
        {meta.origem === 'reserva' ? ' (última leitura bem-sucedida).' : '.'}
      </p>
    </>
  );
}
