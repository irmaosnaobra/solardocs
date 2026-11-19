import styles from './LogoTexto.module.css';

// Marca escrita da SolarDoc ("Solar" + "Doc"), a do topo no computador. No celular o
// cabeçalho e o menu usam esta mesma, para a marca ser uma só nas duas telas.
export default function LogoTexto({ className }: { className?: string }) {
  return (
    <span className={`${styles.marca} ${className ?? ''}`} translate="no">
      <span className={styles.solar}>Solar</span><span className={styles.doc}>Doc</span>
    </span>
  );
}
