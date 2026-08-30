import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Fechamento } from '../../../components/Fechamento.tsx';
import { Galeria } from '../../../components/Galeria.tsx';
import { CardBike } from '../../../components/CardBike.tsx';
import { bikePorSlug, catalogoPublico } from '../../../lib/catalogo.ts';

export const revalidate = 86400;
/** Modelo novo no fornecedor abre na hora, sem esperar o próximo build. */
export const dynamicParams = true;

export async function generateStaticParams() {
  const { bikes } = await catalogoPublico();
  return bikes.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bike = await bikePorSlug(slug);
  if (!bike) return { title: 'Modelo não encontrado' };
  return {
    title: bike.titulo,
    description: [bike.marca, bike.potencia, bike.bateria, bike.autonomia]
      .filter(Boolean)
      .join(' · '),
  };
}

export default async function PaginaDaBike({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bike = await bikePorSlug(slug);
  if (!bike) notFound();

  const { bikes } = await catalogoPublico();
  const parecidas = bikes
    .filter((b) => b.id !== bike.id && (b.marca === bike.marca || b.categoria === bike.categoria))
    .slice(0, 3);

  const resumo = [
    ['Motor', bike.potencia],
    ['Bateria', bike.bateria],
    ['Autonomia', bike.autonomia],
    ['Velocidade máxima', bike.velocidade],
    ['Tempo de recarga', bike.recarga],
  ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <nav className="mb-8 text-sm text-suave">
        <Link href="/" className="hover:text-texto">
          Catálogo
        </Link>
        <span className="px-2">/</span>
        <span className="text-texto">{bike.titulo}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <Galeria imagens={bike.imagens} titulo={bike.titulo} />

        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-acento uppercase">
              {bike.marca} · {bike.categoria}
            </p>
            <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
              {bike.titulo}
            </h1>
            {bike.previsao ? (
              <p className="mt-3 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
                Item sob encomenda. O fornecedor informa previsão de chegada em {bike.previsao}.
                Confirme o prazo no atendimento.
              </p>
            ) : null}
          </div>

          {resumo.length ? (
            <dl className="grid grid-cols-2 gap-3">
              {resumo.map(([rotulo, valor]) => (
                <div key={rotulo} className="rounded-xl border border-borda bg-superficie px-4 py-3">
                  <dt className="text-[11px] text-suave">{rotulo}</dt>
                  <dd className="text-sm font-semibold">{valor}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <Fechamento bike={bike} />
        </div>
      </div>

      {bike.ficha.length ? (
        <section className="mt-16">
          <h2 className="mb-4 text-xl font-bold tracking-tight">Ficha técnica</h2>
          <p className="mb-4 text-xs text-suave">
            Informações como o fabricante publicou, sem edição.
          </p>
          <dl className="grid gap-x-10 gap-y-0 sm:grid-cols-2">
            {bike.ficha.map((item) => (
              <div
                key={item.rotulo}
                className="flex justify-between gap-6 border-b border-borda py-3 text-sm"
              >
                <dt className="text-suave">{item.rotulo}</dt>
                <dd className="text-right font-medium">{item.valor}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-suave">
            Descrição do fornecedor: <span className="text-texto">{bike.nomeOriginal}</span>
          </p>
        </section>
      ) : null}

      {parecidas.length ? (
        <section className="mt-16">
          <h2 className="mb-5 text-xl font-bold tracking-tight">Você também pode gostar</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {parecidas.map((b) => (
              <CardBike key={b.id} bike={b} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
