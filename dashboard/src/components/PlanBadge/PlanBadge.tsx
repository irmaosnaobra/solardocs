import styles from './PlanBadge.module.css';

interface PlanBadgeProps {
  plano: string;
  documentosUsados: number;
  limiteDocumentos: number;
}

export default function PlanBadge({ plano, documentosUsados, limiteDocumentos }: PlanBadgeProps) {
  const isIlimitado = plano === 'ilimitado';
  const percentage = isIlimitado ? 0 : Math.min((documentosUsados / limiteDocumentos) * 100, 100);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={`${styles.badge} ${styles[plano]}`}>
          {plano.toUpperCase()}
        </span>
        <span className={styles.count}>
          {isIlimitado ? '∞ docs' : `${documentosUsados}/${limiteDocumentos} docs`}
        </span>
      </div>
      {!isIlimitado && (
        <div className={styles.progressBar}>
          <div
            className={`${styles.progressFill} ${percentage >= 90 ? styles.progressDanger : ''}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}
