'use client';

// Gaveta da Domina IA: à direita no computador, de baixo no celular.
// É um <dialog> nativo aberto com showModal: o foco fica preso dentro, Esc fecha e
// o resto da página fica inerte. Clique no fundo escuro também fecha.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import g from './DominaiaJornadas.module.css';

export default function DominaiaGaveta({ aberta, aoFechar, titulo, sub, aoVoltar, rotuloVoltar, larga, chave, children }: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: ReactNode;
  sub?: ReactNode;
  /** Quando existe, aparece "Voltar" no cabeçalho (ex.: da jornada para a lista). */
  aoVoltar?: () => void;
  rotuloVoltar?: string;
  larga?: boolean;
  /** Muda quando o conteúdo troca: a rolagem volta ao topo. */
  chave?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) d.showModal();
    if (!aberta && d.open) d.close();
  }, [aberta]);

  // A rolagem volta ao topo quando o conteúdo troca (lista para jornada e de volta).
  const corpo = useRef<HTMLDivElement>(null);
  useEffect(() => { corpo.current?.scrollTo({ top: 0 }); }, [chave]);

  return (
    <dialog
      ref={ref}
      className={`${g.gaveta} ${larga ? g.gavetaLarga : ''}`}
      aria-labelledby={idTitulo}
      onClose={aoFechar}
      onClick={(e) => { if (e.target === e.currentTarget) aoFechar(); }}
    >
      <div className={g.gavetaCaixa}>
        <header className={g.gavetaTopo}>
          <span className={g.alca} aria-hidden="true" />
          {aoVoltar && (
            <button type="button" className={g.voltar} onClick={aoVoltar}>
              <ArrowLeft size={16} aria-hidden="true" />
              {rotuloVoltar ?? 'Voltar'}
            </button>
          )}
          <div className={g.gavetaTitulos}>
            <h2 id={idTitulo} className={g.gavetaTitulo}>{titulo}</h2>
            {sub && <div className={g.gavetaSub}>{sub}</div>}
          </div>
          <button type="button" className={g.fechar} onClick={aoFechar} aria-label="Fechar">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className={g.gavetaCorpo} ref={corpo}>{aberta && children}</div>
      </div>
    </dialog>
  );
}
