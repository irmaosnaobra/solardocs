import '@/styles/globals.css';
import styles from './auth.module.css';

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
          <h2 className={styles.brandHeadline}>
            O documento que vem depois do aperto de mão.
          </h2>
          <p className={styles.brandSub}>
            Contrato, proposta e procuração em minutos. Pra integrador solar com CNPJ.
          </p>

          <ul className={styles.brandList}>
            <li>10 documentos grátis pra começar</li>
            <li>Cláusulas validadas do setor solar</li>
            <li>O cliente assina pelo celular dele</li>
          </ul>
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
