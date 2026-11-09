import type { Metadata } from 'next';
import Landing from '@/components/Landing/Landing';

export const metadata: Metadata = {
  title: 'SolarDoc Pro — Contratos solares na palma da mão',
  description:
    'O app que fecha sua venda solar: contrato, proposta e procuração em minutos. Pra integrador com CNPJ. Garantia de 7 dias.',
  // Só na home, nunca no layout: canonical no layout vale para toda rota do app
  // e mandaria o Google tratar cada página como cópia desta.
  alternates: { canonical: 'https://solardoc.app' },
  openGraph: {
    title: 'SolarDoc Pro — O documento que fecha sua venda solar',
    description:
      'Contrato, proposta e procuração na palma da mão. Sem advogado. Sem Word. Garantia de 7 dias.',
    type: 'website',
    url: 'https://solardoc.app',
  },
};

export default function Home() {
  return <Landing />;
}
