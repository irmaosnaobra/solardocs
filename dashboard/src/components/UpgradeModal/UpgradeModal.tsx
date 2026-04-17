'use client';

import { useState } from 'react';
import api from '@/services/api';
import styles from './UpgradeModal.module.css';

interface UpgradeModalProps {
  onClose: () => void;
  plano: string;
}

const ALL_PLANS = [
  {
    key: 'pro',
    name: 'PRO',
    amount: '47',
    indicado: 'Indicado para até 20 vendas/mês',
    features: [
      '90 documentos por mês',
      'Contrato Solar, Prestação de Serviço, Procuração, Contrato PJ e Proposta Bancária',
      'Geração com IA + 2 modelos prontos',
      'Contratos com a logomarca da sua empresa',
      'Histórico dos últimos 30 dias',
    ],
    value: 47,
    btnClass: 'planBtnPro',
    featured: false,
    label: 'Assinar PRO →',
  },
  {
    key: 'vip',
    name: 'VIP',
    amount: '97',
    indicado: 'Indicado para +20 vendas/mês',
    features: [
      'Documentos ilimitados — sem teto mensal',
      'Todos os 5 tipos de documento',
      'Geração com IA + 2 modelos prontos',
      'Contratos com a logomarca da sua empresa',
      'Histórico completo e permanente',
      'Dashboard com gráficos e analytics de uso',
      'Clientes e terceiros ilimitados',
      'Acesso antecipado a todo novo recurso',
      'Participa das decisões da plataforma',
      'Suporte prioritário direto no WhatsApp',
    ],
    value: 97,
    btnClass: 'planBtnIlimitado',
    featured: true,
    label: 'Assinar VIP →',
  },
];

const PLANS = {
  free: ALL_PLANS,
  pro:  ALL_PLANS.filter(p => p.key === 'vip'),
};

export default function UpgradeModal({ onClose, plano }: UpgradeModalProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const plans = PLANS[plano as keyof typeof PLANS] ?? PLANS.free;

  async function assinar(planKey: string, value: number, name: string) {
    setLoading(planKey);
    try {
      (window as any).fbq?.('track', 'InitiateCheckout', { value, currency: 'BRL', content_name: name });
      const { data } = await api.post('/payments/create-checkout', { plan: planKey });
      window.location.href = data.url;
    } catch {
      alert('Erro ao iniciar pagamento. Tente novamente.');
      setLoading(null);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        <div className={styles.header}>
          <span className={styles.icon}>⚡</span>
          <h2 className={styles.title}>{plano === 'free' ? 'Seus 10 docs gratuitos acabaram' : 'Faça upgrade do seu plano'}</h2>
          <p className={styles.subtitle}>Escolha um plano e continue gerando documentos agora</p>
        </div>

        <div className={styles.plans}>
          {plans.map((p) => (
            <div key={p.key} className={`${styles.plan} ${p.featured ? styles.planFeatured : ''}`}>
              {p.featured && <div className={styles.planBadge}>Mais popular</div>}
              <div className={styles.planName}>{p.name}</div>
              <div className={styles.planPrice}>
                <span className={styles.planCurrency}>R$</span>
                <span className={styles.planAmount}>{p.amount}</span>
                <span className={styles.planPeriod}>/mês</span>
              </div>
              <div className={styles.planIndicado}>{p.indicado}</div>
              <ul className={styles.planFeatures}>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button
                className={`${styles.planBtn} ${styles[p.btnClass]}`}
                onClick={() => assinar(p.key, p.value, p.name)}
                disabled={loading === p.key}
              >
                {loading === p.key ? 'Aguarde...' : p.label}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
