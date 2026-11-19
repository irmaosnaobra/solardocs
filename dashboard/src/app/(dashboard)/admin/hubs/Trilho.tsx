'use client';

// Trilho de abas do Painel SolarDoc (produto, área e seção usam o mesmo).
// Faz três coisas que cada nível precisava sozinho:
// - no celular, quando rola de lado, marca as bordas que ainda têm aba (data-ini e data-fim)
//   para o CSS esmaecer só aquele lado;
// - traz a aba ativa para dentro da faixa quando ela muda;
// - setas, Home e End andam entre as abas (padrão de tablist), e só a ativa entra no Tab.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import n from './navegacao.module.css';

interface Props {
  rotulo: string;
  /** Chave da aba ativa: quando muda, a faixa rola até ela. */
  ativo: string;
  className?: string;
  children: ReactNode;
}

const FOLGA = 32;

export default function Trilho({ rotulo, ativo, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [bordas, setBordas] = useState({ ini: false, fim: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const resto = el.scrollWidth - el.clientWidth - el.scrollLeft;
      const ini = el.scrollLeft > 2;
      const fim = resto > 2;
      setBordas((b) => (b.ini === ini && b.fim === fim ? b : { ini, fim }));
    };
    // A primeira medida sai no próximo quadro, já com a faixa desenhada.
    const raf = requestAnimationFrame(medir);
    el.addEventListener('scroll', medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    const mo = new MutationObserver(medir);
    mo.observe(el, { childList: true });
    return () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', medir); ro.disconnect(); mo.disconnect(); };
  }, []);

  const primeira = useRef(true);
  useEffect(() => {
    const el = ref.current;
    const aba = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !aba || el.scrollWidth <= el.clientWidth) { primeira.current = false; return; }
    const r = aba.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const quieto = primeira.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = quieto ? 'auto' : 'smooth';
    if (r.left < c.left + FOLGA) el.scrollBy({ left: r.left - c.left - FOLGA, behavior });
    else if (r.right > c.right - FOLGA) el.scrollBy({ left: r.right - c.right + FOLGA, behavior });
    primeira.current = false;
  }, [ativo]);

  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    const abas = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const i = abas.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % abas.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + abas.length) % abas.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = abas.length - 1;
    if (j < 0) return;
    e.preventDefault();
    abas[j].focus();
    abas[j].click();
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={rotulo}
      className={`${n.trilho} ${className ?? ''}`}
      data-ini={bordas.ini ? '1' : undefined}
      data-fim={bordas.fim ? '1' : undefined}
      onKeyDown={teclas}
    >
      {children}
    </div>
  );
}
