'use client';

import { useSearchParams } from 'next/navigation';
import styles from './auth.module.css';

type Plano = 'pro' | 'vip' | null;

const BENEFITS: Record<'pro' | 'vip', { headline: string; sub: string; items: string[] }> = {
  pro: {
    headline: 'Plano Pro · acesso imediato',
    sub: 'Pro integrador que fecha 5–15 vendas/mês. Cancele quando quiser, sem fidelidade.',
    items: [
      '90 documentos por mês',
      'Gerador de Proposta com sua marca',
      'Todos os 8 tipos de documento',
      'Cláusulas revisadas para o setor solar',
      'Suporte prioritário no WhatsApp',
      'Cancela quando quiser, sem multa',
    ],
  },
  vip: {
    // Plano único desde 06/08/2026: cobrança na hora, sem os 7 dias grátis.
    headline: 'Plano VIP · acesso imediato',
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
