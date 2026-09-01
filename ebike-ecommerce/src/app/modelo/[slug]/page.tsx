import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Beacon } from '../../../components/Beacon.tsx';
import { Fechamento } from '../../../components/Fechamento.tsx';
import { Galeria } from '../../../components/Galeria.tsx';
import { CardBike } from '../../../components/CardBike.tsx';
import { Confianca } from '../../../components/Confianca.tsx';
import { bikePorSlug, catalogoPublico, paraCartao, slugsDaReserva } from '../../../lib/catalogo.ts';
import { textoDeConferencia } from '../../../lib/conferido.ts';

export const revalidate = 86400;
/** Modelo novo no fornecedor abre na hora, sem esperar o próximo build. */
export const dynamicParams = true;

export function generateStaticParams() {
  return slugsDaReserva().map((slug) => ({ slug }));
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

  const { bikes, meta } = await catalogoPublico();
  const parecidas = bikes
    .filter((b) => b.id !== bike.id && (b.marca === bike.marca || b.categoria === bike.categoria))
    .slice(0, 4)
    .map(paraCartao);

  const resumo = [
    ['Motor', bike.potencia],
    ['Bateria', bike.bateria],
    ['Autonomia', bike.autonomia],
    ['Velocidade máxima', bike.velocidade],
  ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-4 sm:py-5">
      {/* Qual modelo a pessoa abriu: é o degrau entre "entrou na loja" e
          "clicou no WhatsApp", e é onde o funil costuma vazar. */}
      <Beacon modelo={bike.codigo} preco={bike.preco} />
      <nav className="mb-3 text-xs text-suave">
        <Link href="/" prefetch={false} className="toque -my-2 py-2 hover:text-mata">
          Todos os modelos
        </Link>
        <span className="px-2 text-fraco">›</span>
        <Link
          href={`/?categoria=${encodeURIComponent(bike.categoria)}`}
          prefetch={false}
          className="toque -my-2 py-2 hover:text-mata"
        >
          {bike.categoria}
        </Link>
        <span className="px-2 text-fraco">›</span>
        <span className="text-fraco">{bike.titulo}</span>
      </nav>

      <div className="grid gap-5 lg:grid-cols-[1fr_368px] lg:items-start">
        {/* A ficha técnica vive DENTRO da coluna da foto, não embaixo das duas.
            Fora dela, a coluna da direita (preço, frete, pagamento, confiança)
            ficava muito mais alta e sobrava um bloco de branco do lado
            esquerdo — e a ficha só começava depois de todo esse vazio. */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="cartao min-w-0 p-3 sm:p-6">
            <div className="mb-4">
              <p className="text-xs text-suave">
                {bike.categoria} · {bike.marca}
                {bike.cor ? ` · ${bike.cor}` : ''}
              </p>
              <h1 className="mt-1 text-xl leading-snug font-bold text-tinta sm:text-2xl">
                {bike.titulo}
              </h1>
              <p className="mt-1 text-xs text-fraco">Código {bike.codigo}</p>
            </div>

            <Galeria imagens={bike.imagens} titulo={bike.titulo} />

            {resumo.length ? (
              <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-borda pt-5 sm:grid-cols-4">
                {resumo.map(([rotulo, valor]) => (
                  <div key={rotulo} className="rounded-xl bg-fundo/70 px-3 py-2.5">
                    <dt className="text-[11px] text-suave">{rotulo}</dt>
                    <dd className="text-sm font-semibold text-tinta">{valor}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          {bike.ficha.length ? (
            <section className="cartao p-5 sm:p-6">
              <h2 className="text-lg font-bold text-tinta">Características do produto</h2>
              <p className="mt-1 mb-4 text-xs text-fraco">
                Informações como o fabricante publicou, sem edição.
              </p>
              <dl className="grid gap-x-10 sm:grid-cols-2">
                {bike.ficha.map((item, i) => (
                  <div
                    key={item.rotulo}
                    className={
                      'flex justify-between gap-6 rounded-lg px-3 py-2.5 text-sm ' +
                      (i % 2 === 0 ? 'bg-fundo/70' : '')
                    }
                  >
                    <dt className="font-semibold text-tinta">{item.rotulo}</dt>
                    <dd className="text-right text-suave">{item.valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-xs text-fraco">
                Descrição do fornecedor: <span className="text-suave">{bike.nomeOriginal}</span>
              </p>
            </section>
          ) : null}
        </div>

        {/* A caixa acompanha a rolagem: em ficha técnica longa, o preço e o
            botão sumiam da tela justo quando a pessoa acabava de se convencer. */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24">
          <div className="cartao p-4 sm:p-5">
            <Fechamento bike={bike} conferidoEm={textoDeConferencia(meta.atualizadoEm)} />
          </div>

          {/* Junto do preço e do botão, não no rodapé: a dúvida "posso confiar
              nisso?" nasce no segundo em que a pessoa lê oito mil reais. */}
          <Confianca />
        </div>
      </div>

      {parecidas.length ? (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-bold text-tinta">Quem viu esta, viu também</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {parecidas.map((b) => (
              <CardBike key={b.id} bike={b} conferidoEm={textoDeConferencia(meta.atualizadoEm)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
