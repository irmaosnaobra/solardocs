'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEsconderWhatsFab } from '@/components/AreaTrabalho/AreaTrabalho';
import styles from './ConfirmarExclusao.module.css';

interface Props {
  aberto: boolean;
  titulo: string;
  /** O que está sendo excluído, do jeito que a lista mostra. */
  resumo: ReactNode;
  /** Consequências, em ordem. Cada uma vira uma linha. */
  avisos: string[];
  /** Faz a exclusão. Se lançar erro, a mensagem do erro aparece dentro do modal. */
  onConfirmar: () => Promise<void>;
  onFechar: () => void;
}

/**
 * Confirmação de exclusão. Não mantém estado quando fechado: cada abertura nasce
 * limpa (sem o erro da vez anterior).
 */
export default function ConfirmarExclusao(props: Props) {
  if (!props.aberto) return null;
  return <Caixa {...props} />;
}

function Caixa({ titulo, resumo, avisos, onConfirmar, onFechar }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const excluirRef = useRef<HTMLButtonElement>(null);
  const ocupadoRef = useRef(false);
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });

  // No celular o botão flutuante do WhatsApp ficaria por cima do modal.
  useEsconderWhatsFab(true);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    cancelarRef.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ocupadoRef.current) { fecharRef.current(); return; }
      // Mantém o Tab dentro do modal: são só dois botões.
      if (e.key === 'Tab') {
        const a = cancelarRef.current;
        const b = excluirRef.current;
        if (!a || !b || a.disabled || b.disabled) { e.preventDefault(); return; }
        const ativo = document.activeElement;
        if (e.shiftKey && ativo === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && ativo === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, []);

  async function confirmar() {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setErro('');
    try {
      await onConfirmar();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não consegui excluir. Tente de novo.');
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }

  return (
    <div
      className={styles.fundo}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupadoRef.current) onFechar(); }}
    >
      <div className={styles.caixa} role="alertdialog" aria-modal="true" aria-labelledby="confirmar-exclusao-titulo" aria-describedby="confirmar-exclusao-avisos">
        <h2 id="confirmar-exclusao-titulo" className={styles.titulo}>{titulo}</h2>
        <div className={styles.resumo}>{resumo}</div>
        <ul id="confirmar-exclusao-avisos" className={styles.avisos}>
          {avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
        {erro && <p className={styles.erro} role="alert">{erro}</p>}
        <div className={styles.botoes}>
          <button type="button" ref={cancelarRef} className={`btn-secondary ${styles.botao}`} disabled={ocupado} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" ref={excluirRef} className={`${styles.botao} ${styles.perigo}`} disabled={ocupado} onClick={confirmar}>
            {ocupado ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
