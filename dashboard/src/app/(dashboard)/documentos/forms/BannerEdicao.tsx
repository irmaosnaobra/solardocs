'use client';

import styles from './edicao.module.css';

/** Classe do respiro no fim da página em modo edição (CSS local). */
export const RESPIRO_EDICAO = styles.respiro;

/** Faixa do topo do formulário em modo edição: diz o que está sendo editado e dá a saída. */
export function BannerEdicao({ rotulo, cliente, onCancelar }: {
  rotulo: string;
  cliente: string | null;
  onCancelar: () => void;
}) {
  return (
    <div className={styles.banner} role="status">
      <span className={styles.bannerTexto}>
        Editando {rotulo}{cliente ? <> de <strong>{cliente}</strong></> : null}. O link e o número continuam os mesmos.
      </span>
      <button type="button" className="btn-secondary" onClick={onCancelar}>
        Cancelar edição
      </button>
    </div>
  );
}

/** Avisa que o documento aberto para editar foi excluído e que o formulário virou documento novo. */
export function AvisoExcluido({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <div className={styles.banner} role="status">
      <span className={styles.bannerTexto}>{texto}</span>
    </div>
  );
}

/** No lugar do seletor de cliente, para plano com limite em modo edição. */
export function ClienteTravado({ nome }: { nome: string | null }) {
  return (
    <div className={styles.travado}>
      <span className={styles.travadoNome}>{nome || 'Cliente do documento'}</span>
      <span className={styles.travadoAviso}>Para outro cliente, gere um documento novo.</span>
    </div>
  );
}

/** Enquanto o documento a editar carrega, ou quando ele não abre. */
export function EstadoCarga({ carregando, erro, onVoltar }: {
  carregando: boolean;
  erro: string;
  onVoltar: () => void;
}) {
  if (carregando) return <p className={styles.estado}>Abrindo o documento...</p>;
  return (
    <div className={styles.estado}>
      <p>{erro}</p>
      <button type="button" className="btn-secondary" onClick={onVoltar}>Voltar aos arquivos</button>
    </div>
  );
}
