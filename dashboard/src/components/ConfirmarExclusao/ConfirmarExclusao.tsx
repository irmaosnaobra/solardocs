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
  const caixaRef = useRef<HTMLDivElement>(null);
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
      // Prende o Tab entre Cancelar e Excluir. Ocupado (botões desabilitados) o foco fica no próprio diálogo.
      if (e.key === 'Tab') {
        const botoes = [cancelarRef.current, excluirRef.current].filter((b): b is HTMLButtonElement => !!b && !b.disabled);
        if (botoes.length === 0) { e.preventDefault(); caixaRef.current?.focus(); return; }
        const primeiro = botoes[0];
        const ultimo = botoes[botoes.length - 1];
        const ativo = document.activeElement;
        const dentro = !!ativo && ativo !== caixaRef.current && !!caixaRef.current?.contains(ativo);
        if (!dentro) { e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus(); }
        else if (e.shiftKey && ativo === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && ativo === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, []);

  // Depois de um erro, o foco volta ao Excluir para tentar de novo pelo teclado.
  useEffect(() => {
    if (erro && !ocupado) excluirRef.current?.focus();
  }, [erro, ocupado]);

  async function confirmar() {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    // Os botões vão desabilitar; sem isto o foco cairia no body e o Tab sairia do diálogo.
    caixaRef.current?.focus();
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
      <div ref={caixaRef} tabIndex={-1} className={styles.caixa} role="alertdialog" aria-modal="true" aria-labelledby="confirmar-exclusao-titulo" aria-describedby="confirmar-exclusao-avisos">
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
