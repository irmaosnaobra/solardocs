'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEsconderWhatsFab } from '@/components/AreaTrabalho/AreaTrabalho';

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Janela do Estoque em Dia: folha de baixo no celular, quadro no centro no computador.
 * role="dialog", fecha com Esc, mantém o foco dentro e devolve o foco a quem abriu.
 */
export default function Folha({
  titulo,
  subtitulo,
  onFechar,
  larga = false,
  focarCampo = true,
  fecharNoFundo = true,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  onFechar: () => void;
  larga?: boolean;
  /** false: o foco vai para a janela (no celular, evita abrir o teclado sem querer). */
  focarCampo?: boolean;
  /** false: tocar no fundo não fecha (formulário com dados digitados). */
  fecharNoFundo?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });
  useEsconderWhatsFab(true);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const caixa = ref.current;
      if (!caixa || caixa.contains(document.activeElement)) return;
      const primeiro = focarCampo ? (caixa.querySelector<HTMLElement>('input, select, textarea') ?? caixa.querySelector<HTMLElement>('button')) : null;
      (primeiro ?? caixa).focus();
    }, 30);
    const tecla = (e: KeyboardEvent) => {
      // Uma confirmação aberta por cima (role="alertdialog") cuida do próprio Esc e do próprio foco.
      if (document.querySelector('[role="alertdialog"]')) return;
      // Só a janela de cima reage: com o quadro de Saiu aberto sobre o detalhe, o Esc e o Tab são do quadro.
      const janelas = document.querySelectorAll('[role="dialog"]');
      if (janelas[janelas.length - 1] !== ref.current) return;
      if (e.key === 'Escape') { fecharRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const lista = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => el.offsetParent !== null);
      if (lista.length === 0) { e.preventDefault(); ref.current.focus(); return; }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const ativo = document.activeElement;
      const dentro = !!ativo && ativo !== ref.current && ref.current.contains(ativo);
      if (!dentro) { e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus(); }
      else if (e.shiftKey && ativo === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && ativo === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', tecla);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- só vale na abertura
  }, []);

  return (
    <div className="est-fundo" onMouseDown={(e) => { if (fecharNoFundo && e.target === e.currentTarget) onFechar(); }}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`est-folha${larga ? ' larga' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div className="est-folha-topo">
          <div className="est-folha-tit">
            <h2>{titulo}</h2>
            {subtitulo && <p>{subtitulo}</p>}
          </div>
          <button type="button" className="est-x" onClick={onFechar} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
