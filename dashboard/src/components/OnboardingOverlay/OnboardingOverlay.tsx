'use client';

import { useRouter } from 'next/navigation';
import styles from './OnboardingOverlay.module.css';

interface OnboardingOverlayProps {
  step: 'empresa' | 'contatos';
}

export default function OnboardingOverlay({ step }: OnboardingOverlayProps) {
  const router = useRouter();

  if (step === 'empresa') {
    return (
      <div className={styles.overlay}>
        <div className={styles.card}>
          <div className={styles.steps}>
            <div className={`${styles.stepDot} ${styles.stepDotActive}`}>1</div>
            <div className={styles.stepLine} />
            <div className={styles.stepDot}>2</div>
          </div>

          <div className={styles.icon}>🏢</div>
          <h2 className={styles.title}>Cadastre sua empresa</h2>
          <p className={styles.desc}>
            Antes de usar a plataforma, precisamos dos dados da sua empresa.
            O CNPJ será verificado na Receita Federal e as informações serão
            usadas automaticamente em todos os documentos gerados.
          </p>

          <button className={styles.btnPrimary} onClick={() => router.push('/empresa')}>
            Cadastrar empresa agora
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.steps}>
          <div className={`${styles.stepDot} ${styles.stepDotDone}`}>✓</div>
          <div className={`${styles.stepLine} ${styles.stepLineDone}`} />
          <div className={`${styles.stepDot} ${styles.stepDotActive}`}>2</div>
        </div>

        <div className={styles.icon}>👥</div>
        <h2 className={styles.title}>Cadastre um cliente ou terceiro</h2>
        <p className={styles.desc}>
          Ótimo! Empresa cadastrada com sucesso. Agora adicione pelo menos um
          cliente ou parceiro terceiro para começar a gerar documentos.
        </p>

        <div className={styles.btnGroup}>
          <button className={styles.btnPrimary} onClick={() => router.push('/clientes')}>
            Cadastrar cliente
          </button>
          <button className={styles.btnSecondary} onClick={() => router.push('/terceiros')}>
            Cadastrar terceiro
          </button>
        </div>
      </div>
    </div>
  );
}
