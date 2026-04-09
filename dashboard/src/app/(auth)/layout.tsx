import '@/styles/globals.css';
import styles from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="SolarDoc Pro" className={styles.brandLogo} />
      </div>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}
