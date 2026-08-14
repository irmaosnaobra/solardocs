'use client';

import { useSearchParams } from 'next/navigation';
import styles from './auth.module.css';

// PREÇO ÚNICO desde 06/08/2026: uma oferta só, cobrança na hora, sem os 7 dias
// grátis. Era um painel por degrau (Pro × VIP); agora qualquer ?plano= na URL
// — inclusive o 'pro' que um checkout de preço legado ainda pode emitir — cai
// nesta mesma lista.
const ASSINATURA = {
  headline: 'Assinatura SolarDoc · acesso imediato',
  sub: 'Tudo liberado por R$ 67/mês. Cancele quando quiser, sem fidelidade.',
  items: [
    'Documentos ilimitados',
    'Gerador de Proposta com sua marca',
    'Todos os 8 tipos de documento',
    'Procuração',
    'Vistoria Técnica',
    'Contrato PJ',
    'Contrato Vendedor',
    'E muito mais...',
    'Suporte prioritário por WhatsApp',
    'Acesso antecipado a novos documentos',
    'Logo em alta resolução',
    'Cancela quando quiser, sem multa',
  ],
};

const DEFAULT = {
  headline: 'Do aperto de mão ao contrato pronto, sem sair do escritório.',
  sub: 'Toda a papelada da venda solar em um só lugar: contrato, proposta e procuração em minutos.',
  items: [
    'Modelos prontos e revisados para energia solar',
    'Documentos com a sua marca, prontos para enviar',
    'Acompanhe e gere documentos de qualquer lugar',
  ],
};

export default function BrandPanel() {
  const params = useSearchParams();
  const mode = params.get('mode');
  const planoRaw = params.get('plano');

  const showPlanBenefits = mode === 'register' && !!planoRaw;
  const content = showPlanBenefits ? ASSINATURA : DEFAULT;

  return (
    <>
      <h2 className={styles.brandHeadline}>{content.headline}</h2>
      <p className={styles.brandSub}>{content.sub}</p>

      <ul className={styles.brandList}>
        {content.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}
