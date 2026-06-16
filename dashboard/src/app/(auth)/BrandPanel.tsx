'use client';

import { useSearchParams } from 'next/navigation';
import styles from './auth.module.css';

type Plano = 'pro' | 'vip' | null;

const BENEFITS: Record<'pro' | 'vip', { headline: string; sub: string; items: string[] }> = {
  pro: {
    headline: 'Plano Pro · 7 dias grátis',
    sub: 'Pro integrador que fecha 5–15 vendas/mês. Cobrado só após os 7 dias.',
    items: [
      '90 documentos por mês',
      'Gerador de Proposta com sua marca',
      'Todos os 5 tipos de documento',
      'Cláusulas revisadas para o setor solar',
      'Suporte prioritário no WhatsApp',
      'Cancela quando quiser, sem multa',
    ],
  },
  vip: {
    headline: 'Plano VIP · 7 dias grátis',
    sub: 'Pra empresa solar consolidada. Cobrado só após os 7 dias.',
    items: [
      'Documentos ilimitados',
      'Gerador de Proposta com sua marca',
      'Todos os 5 tipos de documento',
      'Procuração',
      'Vistoria Técnica',
      'Contrato PJ',
      'Contrato Vendedor',
      'E muito mais...',
      'Suporte VIP por WhatsApp',
      'Acesso antecipado a novos documentos',
      'Logo em alta resolução',
      'Cancela quando quiser, sem multa',
    ],
  },
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
  const plano: Plano = (planoRaw === 'pro' || planoRaw === 'vip') ? planoRaw : null;

  const showPlanBenefits = mode === 'register' && plano !== null;
  const content = showPlanBenefits ? BENEFITS[plano!] : DEFAULT;

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
