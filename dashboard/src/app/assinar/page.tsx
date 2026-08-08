import type { Metadata } from 'next';
import { Suspense } from 'react';
import AssinarCliente from './AssinarCliente';

// Página do link que o Thiago manda pro cliente:
//   https://solardoc.app/assinar?cupom=ACESSO19
// Pública (fora do grupo (dashboard)) — quem chega aqui ainda não tem conta. O
// cadastro nasce depois do pagamento, no fluxo que já existe (100% CADASTRO).
export const metadata: Metadata = {
  title: 'Assinar o SolarDoc Pro',
  description: 'Contrato, proposta e procuração com a sua marca em minutos.',
  // Link de oferta com cupom não é pra cair em busca — é pra ser enviado.
  robots: { index: false, follow: false },
};

export default function AssinarPage() {
  return (
    <Suspense fallback={null}>
      <AssinarCliente />
    </Suspense>
  );
}
