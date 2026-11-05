import styles from './EtiquetaRastreado.module.css';

/**
 * Pílula "RASTREADO" ao lado de "Copiar link": o link da proposta avisa o vendedor
 * a cada abertura. `sobrePrimaria` inverte as cores para caber dentro do botão
 * que já é da cor primária (senão a pílula some).
 */
export default function EtiquetaRastreado({ sobrePrimaria = false }: { sobrePrimaria?: boolean }) {
  return (
    <span className={`${styles.pilula} ${sobrePrimaria ? styles.sobrePrimaria : ''}`}>Rastreado</span>
  );
}
