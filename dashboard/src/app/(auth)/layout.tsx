import { Suspense } from 'react';
import '@/styles/globals.css';
import styles from './auth.module.css';
import BrandPanel from './BrandPanel';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <aside className={styles.brand}>
        <div className={styles.brandTop}>
          <div className={styles.brandLogoWrap}>
            <span className={styles.brandLogoText}>
              SolarDoc<span>.App</span>
            </span>
          </div>
        </div>

        <div className={styles.brandMid}>
          <Suspense fallback={null}>
            <BrandPanel />
          </Suspense>
        </div>

        <div className={styles.brandBottom}>
          <span className={styles.brandFoot}>
            Atendendo integradores em <strong>todo o Brasil</strong>.
          </span>
        </div>
      </aside>

      <main className={styles.content}>
        <div className={styles.contentLogo}>
          <span className={styles.contentLogoText}>
            SolarDoc<span>.App</span>
          </span>
        </div>

        <div className={styles.contentInner}>
          {children}
        </div>
      </main>
    </div>
  );
}
