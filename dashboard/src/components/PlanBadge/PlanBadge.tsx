import styles from './PlanBadge.module.css';
import { formatPlanName } from '@/utils/plan';

interface PlanBadgeProps {
  plano: string;
  documentosUsados: number;
  limiteDocumentos: number;
}

export default function PlanBadge({ plano, documentosUsados, limiteDocumentos }: PlanBadgeProps) {
  const isIlimitado = plano === 'ilimitado' || limiteDocumentos >= 999999;
  const percentage = isIlimitado ? 0 : Math.min((documentosUsados / limiteDocumentos) * 100, 100);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {/* Preço único: duas cores só — grátis ou ativo. Colorir por slug
            ('pro' âmbar vs 'ilimitado' verde) recriava o degrau visual que a
            oferta única acabou de tirar do texto. */}
        <span className={`${styles.badge} ${plano === 'free' ? styles.free : styles.ativo}`}>
          {formatPlanName(plano).toUpperCase()}
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
