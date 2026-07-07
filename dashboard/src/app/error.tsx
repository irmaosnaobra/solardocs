'use client';

import { useEffect } from 'react';

/**
 * Boundary de erro do app inteiro.
 * Se o erro for ChunkLoadError ou similar de carregamento de assets,
 * redireciona automaticamente pra /limpar-cache que zera tudo e volta.
 * Pra qualquer outro erro, mostra UI de fallback simples com botão de reload.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = String(error?.message || error || '');
    const isChunkError =
      msg.indexOf('ChunkLoadError') !== -1 ||
      msg.indexOf('Loading chunk') !== -1 ||
      msg.indexOf('dynamically imported module') !== -1 ||
      msg.indexOf('Failed to fetch dynamically') !== -1;

    if (isChunkError) {
      // Auto-redirect pra página de limpeza (uma única vez)
      const SK = 'sd-error-redirect';
      if (!sessionStorage.getItem(SK)) {
        sessionStorage.setItem(SK, '1');
        window.location.replace('/limpar-cache');
      }
    }
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: 32,
      gap: 16,
      background: 'var(--color-bg, #0F172A)',
      color: 'var(--color-text, #F1F5F9)',
      fontFamily: 'Inter, sans-serif',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Algo deu errado</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted, #94A3B8)', maxWidth: 360, margin: 0 }}>
        Tenta recarregar a página. Se persistir, clica em &quot;Limpar cache&quot;.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          onClick={() => reset()}
          style={{
            padding: '10px 20px',
            background: 'var(--color-primary, #F59E0B)',
            color: '#0F172A',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
        <a
          href="/limpar-cache"
          style={{
            padding: '10px 20px',
            background: 'transparent',
            color: 'var(--color-text, #F1F5F9)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 8,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Limpar cache
        </a>
      </div>
    </div>
  );
}
