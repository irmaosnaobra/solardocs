import type { Metadata } from 'next';
import { Suspense } from 'react';
import PesquisaForm from '../PesquisaForm';

// Pesquisa sem login, aberta por link com token. Fora do índice dos buscadores.
export const metadata: Metadata = {
  title: 'Conta pra gente por que você saiu',
  robots: { index: false, follow: false },
};

export default function PesquisaSaidaPage() {
  return (
    <Suspense fallback={null}>
      <PesquisaForm tipo="saida" />
    </Suspense>
  );
}
