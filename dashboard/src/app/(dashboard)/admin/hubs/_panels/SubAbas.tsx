'use client';

// Sub-abas reutilizáveis dentro de uma aba de hub. Mesmo visual das sub-abas do
// ProductHubView, um degrau menor. Só cor por token, nada escrito à mão.
import { useState, type ComponentType } from 'react';
import styles from '../../admin.module.css';

export interface SubAba {
  key: string;
  label: string;
  Comp: ComponentType;
}

export default function SubAbas({ abas }: { abas: SubAba[] }) {
  const [ativa, setAtiva] = useState<string>(abas[0]?.key ?? '');
  const atual = abas.find((a) => a.key === ativa) ?? abas[0];
  if (!atual) return null;
  const Comp = atual.Comp;

  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label="Seções" style={{ gap: 4, marginBottom: 16 }}>
        {abas.map((a) => (
          <button
            key={a.key}
            role="tab"
            aria-selected={a.key === atual.key}
            className={a.key === atual.key ? styles.tabActive : styles.tab}
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => setAtiva(a.key)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <Comp />
    </div>
  );
}
