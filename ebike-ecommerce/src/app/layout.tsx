import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';

import './globals.css';
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
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#catalogo"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-acento focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
        >
          Ir para o catálogo
        </a>
        {children}
        <footer className="mt-24 border-t border-borda">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-10 text-sm text-suave sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-texto">{LOJA.nome}</p>
              <p>{LOJA.cidade}</p>
            </div>
            <p className="max-w-md text-xs leading-relaxed">
              Preços e disponibilidade sujeitos a confirmação no atendimento. Imagens e
              especificações fornecidas pelo fabricante.
            </p>
            <Link href="/painel" className="text-xs underline underline-offset-4 hover:text-texto">
              Painel
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
