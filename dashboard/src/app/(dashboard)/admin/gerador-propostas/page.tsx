'use client';

import { useState } from 'react';

export default function AdminGeradorPropostasPage() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div style={{
      height: 'calc(100vh - 64px)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        gap: 8,
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>📄 Gerador de Propostas Solar</h1>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
            Gerador interno — Irmãos na Obra
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setReloadKey(k => k + 1)}
            title="Recarregar"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >🔄</button>
          <a
            href="/gerador/index.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid rgba(250,199,117,0.4)',
              background: 'rgba(250,199,117,0.12)',
              color: '#FAC775',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >Abrir em nova aba ↗</a>
        </div>
      </div>

      <iframe
        key={reloadKey}
        src="/gerador/index.html"
        title="Gerador de Propostas"
        style={{
          flex: 1,
          width: '100%',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#f0f4f8',
        }}
      />
    </div>
  );
}
