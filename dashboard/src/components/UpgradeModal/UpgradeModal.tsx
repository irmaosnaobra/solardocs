'use client';

import { useState } from 'react';
import api from '@/services/api';
import LinkPagarPix from '@/components/LinkPagarPix/LinkPagarPix';
import styles from './UpgradeModal.module.css';

interface UpgradeModalProps {
  onClose: () => void;
  plano: string;
}

// PREÇO ÚNICO. Antes eram dois cards lado a lado (PRO R$27 × VIP R$67) e o
// visitante gastava a atenção comparando degrau em vez de decidir. Agora é uma
// oferta só: tudo liberado por R$ 67/mês.
//
// Quem já assina por 27/47/49 continua valendo — quem resolve isso é o
// planByPrice do backend, não esta vitrine. Aqui só sumiu o comparativo.
const OFERTA = {
  key: 'ilimitado',
  amount: '67',
  chamada: 'Tudo liberado, sem teto mensal',
  features: [
    'Documentos ilimitados — sem teto mensal',
    'Os 8 tipos: Proposta, Contrato Solar, Procuração, Recibo, Vistoria, Prestação de Serviço, Contrato Vendedor e Proposta Bancária',
    'Modelos prontos pro setor solar',
    'Contratos com a logomarca da sua empresa',
    'Histórico completo e permanente',
    'Dashboard com gráficos e analytics de uso',
    'Clientes e terceiros ilimitados',
    'Acesso antecipado a todo novo recurso',
    'Participa das decisões da plataforma',
    'Suporte prioritário direto no WhatsApp',
  ],
  value: 67,
  label: 'Assinar agora →',
};

export default function UpgradeModal({ onClose, plano }: UpgradeModalProps) {
  const [loading, setLoading] = useState<string | null>(null);

  async function assinar(planKey: string, value: number, name: string) {
    setLoading(planKey);
    try {
      (window as any).fbq?.('track', 'InitiateCheckout', { value, currency: 'BRL', content_name: name });
      const { data } = await api.post('/payments/create-checkout', { plan: planKey });
      if (data.upgraded) {
        // Continua existindo pra quem assina por um preço antigo (27/47/49):
        // a Stripe cobra a diferença por proração.
        alert('Assinatura atualizada! A diferença foi cobrada no seu cartão. Recarregando...');
        window.location.reload();
        return;
      }
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
          <h2 className={styles.title}>{plano === 'free' ? 'Seus 10 docs gratuitos acabaram' : 'Libere a SolarDoc completa'}</h2>
          <p className={styles.subtitle}>Uma assinatura só, tudo incluso — continue gerando documentos agora</p>
        </div>

        <div className={styles.plans}>
          <div className={styles.plan}>
            <div className={styles.planPrice}>
              <span className={styles.planCurrency}>R$</span>
              <span className={styles.planAmount}>{OFERTA.amount}</span>
              <span className={styles.planPeriod}>/mês</span>
            </div>
            <div className={styles.planIndicado}>{OFERTA.chamada}</div>
            <ul className={styles.planFeatures}>
              {OFERTA.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button
              className={`${styles.planBtn} ${styles.planBtnIlimitado}`}
              onClick={() => assinar(OFERTA.key, OFERTA.value, 'SolarDoc')}
              disabled={loading === OFERTA.key}
            >
              {loading === OFERTA.key ? 'Aguarde...' : OFERTA.label}
            </button>
            <p className={styles.planRodape}>Cancele quando quiser · sem fidelidade</p>
          </div>
        </div>

        {/* Saída pra quem não tem cartão — é a objeção nº 1 de quem pede Pix.
            Sem este link a pessoa fecha o modal e some. */}
        <LinkPagarPix className={styles.pixLink} />
      </div>
    </div>
  );
}
