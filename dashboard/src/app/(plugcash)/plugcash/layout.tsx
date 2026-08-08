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

  // O app herdava o `favicon.ico` do SolarDoc que mora na raiz de `app/` — quem
  // abria o curso via a marca errada na aba. A raiz é o único lugar onde
  // `favicon.ico` vale, então não dá pra sobrescrever por convenção de arquivo:
  // aqui a declaração é explícita, e ela ganha do que veio de cima.
  //
  // O de 16px é OUTRO desenho, não o mesmo reduzido: a barra vertical da marca
  // tem 4,5% da largura e vira meio pixel nesse tamanho. Ver
  // plugcash/brand/icones.js.
  icons: {
    icon: [
      { url: '/plugcash/img/favicon.svg', type: 'image/svg+xml' },
      { url: '/plugcash/img/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/plugcash/img/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/plugcash/img/apple-touch-icon.png',
  },
};

export default function PlugcashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
