'use client';

import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { useNexusPortal } from '@/hooks/useNexusPortal';
import styles from './NexusBanner.module.css';

/**
 * Convite ao Portal do Parceiro NEXUS, no início do SolarDoc logado.
 *
 * Só aparece com o portal ligado (`/gerador/nexus/status`). Fechar grava
 * `nexus_banner_fechado:<userId>` no localStorage, então a pessoa que fechou não
 * vê de novo naquele aparelho. O portal é uma página estática (`/nexus/app`), não
 * uma rota do Next: o link é um <a> comum, de página inteira.
 */

const ouvintes = new Set<() => void>();
const fechadosNaVisita = new Set<string>();

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

function jaFechou(chave: string): boolean {
  if (fechadosNaVisita.has(chave)) return true;
  try { return localStorage.getItem(chave) === '1'; } catch { return false; }
}

export default function NexusBanner({ userId }: { userId?: string | number | null }) {
  const ligado = useNexusPortal();
  const chave = `nexus_banner_fechado:${userId ?? ''}`;
  // No servidor e na hidratação conta como fechado: só abre depois de ler o localStorage, sem piscar.
  const fechado = useSyncExternalStore(assinar, () => jaFechou(chave), () => true);

  if (!ligado || fechado || userId == null || userId === '') return null;

  function fechar() {
    fechadosNaVisita.add(chave);
    try { localStorage.setItem(chave, '1'); } catch { /* sem localStorage: fecha só nesta visita */ }
    ouvintes.forEach((fn) => fn());
  }

  return (
    <div className={styles.banner} role="region" aria-label="Portal do Parceiro NEXUS">
      <div className={styles.texto}>
        <p className={styles.titulo}>Venda eletropostos NEXUS com a sua marca</p>
        <p className={styles.linha}>Portal do Parceiro grátis. Entre com o seu login do SolarDoc.</p>
      </div>
      <a className={styles.botao} href="/nexus/app?o=solardoc_banner">Conhecer o portal</a>
      <button type="button" className={styles.fechar} onClick={fechar} aria-label="Fechar o aviso do Portal do Parceiro">
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
