import type { Metadata } from 'next';
import Landing from '@/components/Landing/Landing';

export const metadata: Metadata = {
  title: 'SolarDoc Pro — Contratos solares na palma da mão',
  description:
    'O app que fecha sua venda solar: contrato, proposta e procuração em minutos. Pra integrador com CNPJ. Comece grátis com 10 documentos.',
  openGraph: {
    title: 'SolarDoc Pro — O documento que fecha sua venda solar',
    description:
      'Contrato, proposta e procuração na palma da mão. Sem advogado. Sem Word. Comece grátis.',
    type: 'website',
    url: 'https://solardoc.app',
  },
};

export default function Home() {
  return <Landing />;
}
