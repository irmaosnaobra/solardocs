import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { Suspense } from 'react';

import './globals.css';
import { Cabecalho } from '../components/Cabecalho.tsx';
import { LOJA } from '../config/loja.ts';

const inter = Inter({
  subsets: ['latin'],
  variable: '--fonte-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${LOJA.nome}: bikes e scooters elétricas`,
    template: `%s | ${LOJA.nomeCurto}`,
  },
  description: LOJA.descricao,
  // Vitrine de preço não tem por que ser indexada: quem chega vem pelo link.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#ffe600',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        {/* O cabeçalho lê a busca da URL, e useSearchParams exige Suspense
            para a página continuar sendo gerada estaticamente. */}
        <Suspense fallback={<div className="h-[92px] bg-topo" />}>
          <Cabecalho />
        </Suspense>

        {children}

        <footer className="mt-10 bg-white">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-8 text-xs text-suave sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-texto">{LOJA.nome}</p>
              <p>{LOJA.cidade}</p>
            </div>
            <p className="max-w-md leading-relaxed">
              Preços e disponibilidade sujeitos a confirmação no atendimento. Imagens e
              especificações fornecidas pelo fabricante.
            </p>
            <Link
              href="/painel"
              // Sem isto o Next pré-carrega o painel para todo visitante e leva
              // 404 na portaria, sujando o console de quem só veio ver bike.
              prefetch={false}
              className="toque -mx-2 px-2 hover:text-texto hover:underline"
            >
              Painel
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
