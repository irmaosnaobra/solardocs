import '@/styles/globals.css';
import Logo from '@/components/Logo/Logo';
import styles from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <div className={styles.brand}>
        <Logo className={styles.brandLogo} />
      </div>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}
