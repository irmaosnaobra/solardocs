import type { Metadata } from 'next';
import { Suspense } from 'react';
import PesquisaForm from '../PesquisaForm';

// Pesquisa sem login, aberta por link com token. Fora do índice dos buscadores.
export const metadata: Metadata = {
  title: 'Seu depoimento sobre a SolarDoc',
  robots: { index: false, follow: false },
};

export default function PesquisaDepoimentoPage() {
  return (
    <Suspense fallback={null}>
      <PesquisaForm tipo="depoimento" />
    </Suspense>
  );
}
