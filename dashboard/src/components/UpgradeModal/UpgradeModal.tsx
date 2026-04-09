'use client';

import styles from './UpgradeModal.module.css';

interface UpgradeModalProps {
  onClose: () => void;
}

export default function UpgradeModal({ onClose }: UpgradeModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        <div className={styles.header}>
          <span className={styles.icon}>⚡</span>
          <h2 className={styles.title}>Escolha seu plano</h2>
          <p className={styles.subtitle}>Assine e gere documentos ilimitados para sua empresa solar</p>
        </div>

        <div className={styles.plans}>

          {/* FREE */}
          <div className={styles.plan}>
            <div className={styles.planName}>FREE</div>
            <div className={styles.planPrice}>
              <span className={styles.planAmount}>Grátis</span>
            </div>
            <ul className={styles.planFeatures}>
              <li>3 documentos por mês</li>
              <li>Todos os tipos de documento</li>
              <li>Geração com IA</li>
            </ul>
            <span className={styles.planBtnFree}>Plano atual</span>
          </div>

          {/* PRO */}
          <div className={styles.plan}>
            <div className={styles.planName}>PRO</div>
            <div className={styles.planPrice}>
              <span className={styles.planCurrency}>R$</span>
              <span className={styles.planAmount}>27</span>
              <span className={styles.planPeriod}>/mês</span>
            </div>
            <ul className={styles.planFeatures}>
              <li>30 documentos por mês</li>
              <li>Geração com IA</li>
              <li>Todos os tipos de documento</li>
              <li>Suporte prioritário</li>
            </ul>
            <a
              href="https://buy.stripe.com/test_6oU00jcQj5fY2e7cxi0Fi02"
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.planBtn} ${styles.planBtnPro}`}
            >
              Assinar PRO
            </a>
          </div>

          {/* ILIMITADO */}
          <div className={`${styles.plan} ${styles.planFeatured}`}>
            <div className={styles.planBadge}>Mais popular</div>
            <div className={styles.planName}>VIP</div>
            <div className={styles.planPrice}>
              <span className={styles.planCurrency}>R$</span>
              <span className={styles.planAmount}>97</span>
              <span className={styles.planPeriod}>/mês</span>
            </div>
            <ul className={styles.planFeatures}>
              <li>Uso Ilimitado</li>
              <li>IA com prioridade</li>
              <li>💎 Fórum exclusivo VIP</li>
              <li>Sugira novos documentos</li>
              <li>Suporte via WhatsApp</li>
            </ul>
            <a
              href="https://buy.stripe.com/test_3cI5kD9E7bEmf0T9l60Fi03"
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.planBtn} ${styles.planBtnIlimitado}`}
            >
              Assinar VIP
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
