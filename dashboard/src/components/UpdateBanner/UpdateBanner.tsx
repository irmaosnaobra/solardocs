'use client';

import { useEffect, useState } from 'react';

/**
 * Faixa "Nova versão disponível". O registro do SW (script inline em layout.tsx)
 * dispara 'sw-update-ready' quando um deploy novo termina de instalar. Aqui só
 * mostramos a faixa e recarregamos NO CLIQUE — nunca sozinho, pra não perder
 * trabalho no meio (ex: os ~40 campos da proposta). Ao recarregar, o SW novo já
 * controla a página e o HTML network-first serve os chunks atuais.
 */
export default function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onUpdate() { setShow(true); }
    window.addEventListener('sw-update-ready', onUpdate);
    return () => window.removeEventListener('sw-update-ready', onUpdate);
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'calc(100vw - 24px)',
        padding: '10px 14px',
        borderRadius: 12,
        background: '#0f172a',
        color: '#fff',
        boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>✨ Nova versão disponível</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          border: 'none',
          borderRadius: 8,
          padding: '6px 14px',
          background: '#F26513',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Atualizar
      </button>
      <button
        type="button"
        aria-label="Dispensar"
        onClick={() => setShow(false)}
        style={{
          border: 'none',
          background: 'transparent',
          color: '#94a3b8',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
