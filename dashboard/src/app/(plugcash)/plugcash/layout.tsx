import type { Metadata } from 'next';

// O PlugCash tem identidade própria (preto/branco/verde) e não herda a navegação
// do SolarDoc — mas herda o auth, a fonte e o service worker do layout raiz.
export const metadata: Metadata = {
  title: 'PlugCash — o mercado de recarga elétrica, do ponto ao faturamento',
  description:
    'Conteúdo, serviços e rede de fornecedores para quem quer instalar, operar ou executar eletropostos no Brasil.',
  // A oferta de entrada não pode ser encontrada no Google: ela existe só depois
  // da desqualificação. Se o lead nota 3 achar a página de R$ 197 antes da
  // reunião, troca-se uma venda de R$ 160 mil por uma de R$ 197.
  robots: { index: false, follow: false },
};

export default function PlugcashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
