'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PARCEIROS NEXUS — a Trilha do Parceiro pela equipe.
//
// Embute a tela estática /nexus/adm/ (a mesma do ADM do Portal do Parceiro) já
// aberta no Funil da Trilha. É da mesma origem, então o login do admin vale: o
// painel lê a sessão sozinho. Os atalhos trocam o hash do iframe, e o próprio
// painel (trilha.js) escuta o hashchange e troca a visão sem recarregar.
//   #funil          Funil, Aptos para reunião, Começaram e pararam, Não querem
//   #trilha         Aptos para reunião: a lista da trilha na fila de quem pediu a reunião
//   #mapa           Mapa de demanda
//   #trilha/<id>    abre direto a ficha (link dos avisos da equipe)
// Dentro do iframe a página esconde o menu lateral e o título dela (classe adm-embed).
// Só o iframe rola: a altura é a da janela menos o que o hub já ocupa em cima.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';

const BASE = '/nexus/adm/index.html';

const ATALHOS = [
  { hash: 'funil', label: 'Funil' },
  { hash: 'trilha', label: 'Aptos para reunião' },
  { hash: 'mapa', label: 'Mapa de demanda' },
] as const;

type Hash = (typeof ATALHOS)[number]['hash'];

const botao = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
} as const;

export default function NexusParceirosPanel() {
  const [hash, setHash] = useState<Hash>('funil');
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div
      style={{
        // Janela menos o topo do hub (título, produtos, abas) e o respiro de baixo.
        height: 'max(520px, calc(100vh - 250px))',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
        <div role="group" aria-label="Atalhos da Trilha" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ATALHOS.map((a) => {
            const ativo = a.hash === hash;
            return (
              <button
                key={a.hash}
                type="button"
                aria-pressed={ativo}
                onClick={() => setHash(a.hash)}
                style={{
                  ...botao,
                  color: ativo ? 'var(--color-text)' : 'var(--color-text-muted)',
                  borderColor: ativo ? '#3B82D6' : 'var(--color-border)',
                  background: ativo ? 'rgba(0,96,199,0.22)' : 'transparent',
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={botao}>
            Atualizar
          </button>
          <a href={`${BASE}#${hash}`} target="_blank" rel="noopener noreferrer" style={botao}>
            Abrir em nova aba
          </a>
        </div>
      </div>

      <iframe
        key={reloadKey}
        src={`${BASE}#${hash}`}
        title="Parceiros NEXUS: Trilha do Parceiro"
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#f0f4f8',
        }}
      />
    </div>
  );
}
