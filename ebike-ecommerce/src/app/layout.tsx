import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { Suspense } from 'react';

import './globals.css';
import { Cabecalho } from '../components/Cabecalho.tsx';
import { Beacon } from '../components/Beacon.tsx';
import { Logo } from '../components/Logo.tsx';
import { Pixel } from '../components/Pixel.tsx';
import { EMPRESA } from '../config/empresa.ts';
import { LOJA } from '../config/loja.ts';

const inter = Inter({
  subsets: ['latin'],
  variable: '--fonte-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${LOJA.nomeCurto}: ${LOJA.slogan}`,
    template: `%s | ${LOJA.nomeCurto}`,
  },
  description: LOJA.descricao,
  // Vitrine de preço não tem por que ser indexada: quem chega vem pelo link.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        {/* O cabeçalho lê a busca da URL, e useSearchParams exige Suspense
            para a página continuar sendo gerada estaticamente. */}
        <Suspense fallback={<div className="h-[68px] border-b border-borda bg-white" />}>
          <Cabecalho />
        </Suspense>

        {children}

        {/* Mede o funil. Sem isto a gente ve o lead chegar e nao sabe de
            quantas visitas ele saiu. */}
        <Suspense fallback={null}>
          <Beacon />
        </Suspense>

        {/* O pixel da Meta. Ele OTIMIZA a entrega do anúncio; quem MEDE é o
            beacon acima, que roda no servidor e ninguém bloqueia. */}
        <Suspense fallback={null}>
          <Pixel />
        </Suspense>

        <footer className="mt-12 border-t border-borda bg-white">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Logo />
              <p className="mt-3 text-sm text-suave">{LOJA.slogan}</p>
            </div>

            {/* Identificação do vendedor pela MARCA, mais o endereço. Razão
                social e CNPJ saíram por decisão do Thiago (03/09) — em site e
                LP é Irmãos na Obra, o resto fica no contrato. Não repor. */}
            <div className="max-w-md text-xs leading-relaxed text-suave">
              <p>
                {LOJA.nomeCurto} é a marca de bicicletas e scooters elétricas da{' '}
                <strong className="font-semibold text-tinta">{EMPRESA.nome}</strong>.
              </p>
              <p className="mt-1">{EMPRESA.endereco}</p>
              <p className="mt-1">
                {/* Era um mailto para a caixa aiorosgroup@ — o endereço soletrava
                    o nome que saiu do site. /falar é o WhatsApp com rodízio. */}
                <Link href="/falar" prefetch={false} className="toque hover:text-mata">
                  Falar com a gente no WhatsApp
                </Link>
              </p>
              <p className="mt-2">
                Imagens e especificações fornecidas pelo fabricante. A quantidade em estoque é
                confirmada no atendimento.
              </p>
            </div>

            <Link
              href="/painel"
              // Sem isto o Next pré-carrega o painel para todo visitante e leva
              // 404 na portaria, sujando o console de quem só veio ver bike.
              prefetch={false}
              className="toque -mx-2 px-2 text-xs text-suave hover:text-mata"
            >
              Painel
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
