'use client';

import { useEffect, useState } from 'react';

/**
 * Página de emergência para clientes presos em cache antigo.
 * Aponta clientes pra https://solardoc.app/limpar-cache que:
 * 1. Mata service workers
 * 2. Limpa Cache Storage API
 * 3. Limpa localStorage e sessionStorage (preserva o token de auth)
 * 4. Recarrega o app limpo
 */
export default function LimparCachePage() {
  const [status, setStatus] = useState('Limpando...');

  useEffect(() => {
    (async () => {
      try {
        // Preserva token de auth (cookie + localStorage)
        const token = localStorage.getItem('solardoc_token');
        const userJson = localStorage.getItem('solardoc_user');

        // 1. Mata service workers
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }

        // 2. Limpa Cache Storage API
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }

        // 3. Limpa storages (preserva auth)
        try { sessionStorage.clear(); } catch {}
        try {
          localStorage.clear();
          if (token) localStorage.setItem('solardoc_token', token);
          if (userJson) localStorage.setItem('solardoc_user', userJson);
        } catch {}

        setStatus('Cache limpo. Redirecionando...');

        // 4. Reload absoluto pra dashboard
        setTimeout(() => {
          window.location.replace('/dashboard');
        }, 600);
      } catch {
        setStatus('Erro ao limpar. Faça refresh manual (Ctrl+Shift+R).');
      }
    })();
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: 32,
      gap: 16,
      background: '#0F172A',
      color: '#F1F5F9',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        width: 40, height: 40,
        border: '3px solid #334155',
        borderTopColor: '#F59E0B',
        borderRadius: '50%',
        animation: 'sd-spin 0.8s linear infinite',
      }} />
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>SolarDoc Pro</h1>
      <p style={{ fontSize: 14, color: '#94A3B8', margin: 0, textAlign: 'center', maxWidth: 320 }}>
        {status}
      </p>
      <style>{`@keyframes sd-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
