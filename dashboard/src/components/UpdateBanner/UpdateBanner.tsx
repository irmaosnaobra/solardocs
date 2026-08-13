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
    // O evento pode ter disparado ANTES desta faixa existir: o registro do SW
    // roda no 'load' e o React hidrata depois (medido, 1563ms contra 1618ms).
    // Quem volta ao app com um update já baixado cai exatamente nessa janela —
    // por isso o registro também deixa a marca, e aqui lemos a marca primeiro.
    if ((window as unknown as { __sdUpdateReady?: boolean }).__sdUpdateReady) setShow(true);
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
      <span style={{ whiteSpace: 'nowrap' }}>Nova versão disponível</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          border: 'none',
          borderRadius: 10,
          // 31px de altura era o menor alvo da plataforma inteira — no botao
          // que TIRA o cliente da versao velha. Errar aqui e' seguir preso.
          minHeight: 40,
          padding: '10px 18px',
          background: '#F26513',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Atualizar
      </button>
      <button
        type="button"
        aria-label="Dispensar"
        onClick={() => setShow(false)}
        style={{
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          background: 'transparent',
          color: '#94a3b8',
          fontSize: 20,
          lineHeight: 1,
          cursor: 'pointer',
          width: 40,
          height: 40,
          padding: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        ×
      </button>
    </div>
  );
}
