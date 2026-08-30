import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Fechamento } from '../../../components/Fechamento.tsx';
import { Galeria } from '../../../components/Galeria.tsx';
import { CardBike } from '../../../components/CardBike.tsx';
import { bikePorSlug, catalogoPublico, paraCartao } from '../../../lib/catalogo.ts';

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
    .slice(0, 4)
    .map(paraCartao);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-4">
      <nav className="mb-3 text-xs text-suave">
        <Link href="/" className="hover:text-acao">
          Todos os modelos
        </Link>
        <span className="px-2 text-fraco">›</span>
        <Link href={`/?categoria=${encodeURIComponent(bike.categoria)}`} className="hover:text-acao">
          {bike.categoria}
        </Link>
        <span className="px-2 text-fraco">›</span>
        <span className="text-fraco">{bike.titulo}</span>
      </nav>

      <div className="cartao grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 lg:border-r lg:border-borda lg:pr-6">
          <Galeria imagens={bike.imagens} titulo={bike.titulo} />
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs text-suave">
              {bike.categoria} · {bike.marca}
              {bike.cor ? ` · ${bike.cor}` : ''}
            </p>
            <h1 className="mt-1 text-xl leading-snug font-semibold text-texto">{bike.titulo}</h1>
            <p className="mt-1 text-xs text-fraco">Código {bike.codigo}</p>
          </div>

          <Fechamento bike={bike} />
        </div>
      </div>

      {bike.ficha.length ? (
        <section className="cartao mt-4 p-4 sm:p-6">
          <h2 className="mb-1 text-lg font-semibold text-texto">Características do produto</h2>
          <p className="mb-4 text-xs text-fraco">
            Informações como o fabricante publicou, sem edição.
          </p>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {bike.ficha.map((item, i) => (
              <div
                key={item.rotulo}
                className={
                  'flex justify-between gap-6 px-3 py-2.5 text-sm ' +
                  (i % 2 === 0 ? 'bg-fundo/60' : '')
                }
              >
                <dt className="font-semibold text-texto">{item.rotulo}</dt>
                <dd className="text-right text-suave">{item.valor}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-fraco">
            Descrição do fornecedor: <span className="text-suave">{bike.nomeOriginal}</span>
          </p>
        </section>
      ) : null}

      {parecidas.length ? (
        <section className="mt-4">
          <h2 className="mb-3 text-lg font-semibold text-texto">Quem viu esta, viu também</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {parecidas.map((b) => (
              <CardBike key={b.id} bike={b} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
