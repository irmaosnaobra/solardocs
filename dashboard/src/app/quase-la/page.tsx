import type { Metadata } from 'next';
import { Suspense } from 'react';
import QuaseLaCliente from './QuaseLaCliente';

// Onde cai quem clicou em "voltar" no checkout da Stripe (o `cancel_url` dos dois
// checkouts). Antes isso caía na home com `?cancelado=1`, que ninguém lia — o
// momento de maior intenção do funil terminava numa página institucional.
//
// O que ela faz: oferece o Pix na hora (a maioria não passa cartão) e deixa o
// caminho do cartão a um clique, com o MESMO plano e cupom que a pessoa levava.
//
// O que ela NÃO cobre: fechar a aba. Isso acontece no domínio da Stripe, onde a
// gente não roda JS — quem some assim só é alcançado pela cadência de abandono.
export const metadata: Metadata = {
  title: 'Faltou pouco — SolarDoc Pro',
  description: 'Termine sua assinatura no Pix ou no cartão.',
  // Página de saída de checkout não é pra buscador: é pra quem já estava pagando.
  robots: { index: false, follow: false },
};

export default function QuaseLaPage() {
  return (
    <Suspense fallback={null}>
      <QuaseLaCliente />
    </Suspense>
  );
}
