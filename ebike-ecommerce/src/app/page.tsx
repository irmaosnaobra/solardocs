import Image from 'next/image';
import Link from 'next/link';

import { Vitrine } from '../components/Vitrine.tsx';
import { catalogoPublico, categoriasDe, marcasDe, paraCartao } from '../lib/catalogo.ts';
import { LOJA, emReais } from '../config/loja.ts';

/**
 * A página é gerada de novo uma vez por dia, e é isso que mantém preço e estoque
 * em dia sem ninguém apertar botão. O cron em `/api/sync` força a atualização
 * na hora certa da manhã.
 */
export const revalidate = 86400;

function Estatistica({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="rounded-2xl border border-borda bg-superficie px-5 py-4">
      <p className="text-lg font-bold tracking-tight text-texto sm:text-2xl">{valor}</p>
      <p className="text-xs text-suave">{rotulo}</p>
    </div>
  );
}

export default async function Pagina() {
  const { bikes: completas, meta } = await catalogoPublico();
  const bikes = completas.map(paraCartao);
  const marcas = marcasDe(bikes);
  const categorias = categoriasDe(bikes);
  // A vitrine abre com a bike que tem mais fotos: é a que rende no topo.
  const destaque = [...completas].sort((a, b) => b.imagens.length - a.imagens.length)[0];
  const menorPreco = bikes.length ? Math.min(...bikes.map((b) => b.preco)) : 0;
  const quando = new Date(meta.atualizadoEm);
  const fusoBR = { timeZone: 'America/Sao_Paulo' } as const;
  const atualizado = quando.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...fusoBR,
  });
  // No cartão do topo o ano não cabe no celular e não acrescenta nada.
  const atualizadoCurto = quando.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    ...fusoBR,
  });

  return (
    <main>
      <section className="relative overflow-hidden border-b border-borda">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-14 pb-16 lg:grid-cols-2 lg:items-center lg:pt-20">
          <div className="flex flex-col gap-6">
            <span className="w-fit rounded-full border border-acento/40 bg-acento/10 px-3 py-1 text-xs font-semibold tracking-wide text-acento">
              {LOJA.cidade}
            </span>
            <h1 className="text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl lg:text-6xl">
              {LOJA.chamada}
            </h1>
            <p className="max-w-xl text-lg text-suave">{LOJA.descricao}</p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="#catalogo"
                className="toque rounded-xl bg-acento px-6 text-base font-semibold text-black transition hover:bg-acento-escuro"
              >
                Ver os {bikes.length} modelos
              </Link>
              {destaque ? (
                <Link
                  href={`/modelo/${destaque.slug}`}
                  className="toque rounded-xl border border-borda px-6 text-base font-semibold text-texto transition hover:border-acento/60"
                >
                  A partir de {emReais(menorPreco)}
                </Link>
              ) : null}
            </div>

            <dl className="grid grid-cols-3 gap-3 pt-2">
              <Estatistica valor={String(bikes.length)} rotulo="modelos no catálogo" />
              <Estatistica valor={String(marcas.length)} rotulo="marcas" />
              <Estatistica valor={atualizadoCurto} rotulo="estoque atualizado em" />
            </dl>
          </div>

          {destaque ? (
            <div className="palco relative aspect-[4/3] w-full overflow-hidden rounded-3xl">
              <Image
                src={destaque.imagens[0]}
                alt={destaque.titulo}
                fill
                sizes="(max-width: 1024px) 94vw, 560px"
                className="object-contain"
                priority
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ['1', 'Escolha o modelo', 'Ficha técnica completa, fotos reais e preço fechado.'],
            ['2', 'Diga como quer pagar', 'Pix, cartão, boleto ou financiamento.'],
            ['3', 'Fale com quem vende', 'Vai direto para o WhatsApp do Thiago ou do Diego.'],
          ].map(([n, titulo, texto]) => (
            <li key={n} className="rounded-2xl border border-borda bg-superficie p-6">
              <span className="mb-3 flex size-9 items-center justify-center rounded-full bg-acento text-sm font-bold text-black">
                {n}
              </span>
              <h2 className="mb-1 font-semibold">{titulo}</h2>
              <p className="text-sm text-suave">{texto}</p>
            </li>
          ))}
        </ol>
      </section>

      <Vitrine bikes={bikes} marcas={marcas} categorias={categorias} />

      <p className="mx-auto max-w-6xl px-5 pb-4 text-xs text-suave">
        Catálogo lido do nosso fornecedor em {atualizado}
        {meta.origem === 'reserva' ? ' (última leitura bem-sucedida).' : '.'}
      </p>
    </main>
  );
}
