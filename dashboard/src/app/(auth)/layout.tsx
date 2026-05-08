import '@/styles/globals.css';
import Image from 'next/image';
import styles from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <aside className={styles.brand}>
        <div className={styles.brandTop}>
          <div className={styles.brandLogoWrap}>
            <Image
              src="/logo.png"
              alt="SolarDoc Pro"
              width={36}
              height={36}
              priority
              className={styles.brandLogoImg}
            />
            <span className={styles.brandLogoText}>
              Solar<span>Doc</span>
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
            <li>Cliente assina pelo celular dele</li>
          </ul>
        </div>

        <div className={styles.brandBottom}>
          <span className={styles.brandFoot}>
            Já é cliente em <strong>todas as regiões do Brasil</strong>.
          </span>
        </div>
      </aside>

      <main className={styles.content}>
        <div className={styles.contentLogo}>
          <Image
            src="/logo.png"
            alt="SolarDoc Pro"
            width={40}
            height={40}
            priority
            className={styles.contentLogoImg}
          />
          <span className={styles.contentLogoText}>
            Solar<span>Doc</span>
          </span>
        </div>

        <div className={styles.contentInner}>
          {children}
        </div>
      </main>
    </div>
  );
}
