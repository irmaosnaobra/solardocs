import type { Metadata } from 'next';
import { Suspense } from 'react';
import PixAutomaticoCliente from './PixAutomaticoCliente';

// Pix Automático SEM login — onde cai quem largou o checkout da Stripe.
//
// A tela /pix-recorrente resolve o mesmo problema, mas só pra quem já tem
// conta: ela mora no grupo (dashboard) e as rotas dela exigem authMiddleware.
// Quem veio da landing e abandonou o cartão AINDA NÃO TEM CONTA — pra essa
// pessoa aquela tela é uma parede de login no pior momento possível.
//
// Esta aqui pega o nome, o e-mail e o CPF (o mesmo que a Stripe ia pedir) e
// gera o Pix na hora. A conta nasce depois, quando o pagamento confirma.
//
// Cobre dois dos três jeitos de sair do checkout: a setinha da Stripe (via
// cancel_url) e o voltar do navegador (o front guarda o mesmo destino). Fechar
// a aba continua sendo alcançado só pela cadência de abandono.
export const metadata: Metadata = {
  title: 'Assine no Pix — SolarDoc Pro',
  description: 'Assinatura mensal por Pix, sem cartão de crédito.',
  // Saída de checkout não é página pra buscador.
  robots: { index: false, follow: false },
};

export default function PixAutomaticoPage() {
  return (
    <Suspense fallback={null}>
      <PixAutomaticoCliente />
    </Suspense>
  );
}
