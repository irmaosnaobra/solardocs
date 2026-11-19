'use client';

// Sub-abas reutilizáveis dentro de uma aba de hub: o 3º nível da navegação do painel
// (texto com sublinhado discreto). Mesmo trilho do produto e da área, ver ../Trilho.
import { useId, useState, type ComponentType } from 'react';
import Trilho from '../Trilho';
import n from '../navegacao.module.css';

export interface SubAba {
  key: string;
  label: string;
  Comp: ComponentType;
}

export default function SubAbas({ abas }: { abas: SubAba[] }) {
  const [ativa, setAtiva] = useState<string>(abas[0]?.key ?? '');
  const base = useId();
  const atual = abas.find((a) => a.key === ativa) ?? abas[0];
  if (!atual) return null;
  const Comp = atual.Comp;

  return (
    <div>
      <Trilho rotulo="Seções" ativo={atual.key} className={n.secoes}>
        {abas.map((a) => {
          const sel = a.key === atual.key;
          return (
            <button
              key={a.key}
              id={`${base}-aba-${a.key}`}
              type="button"
              role="tab"
              aria-selected={sel}
              aria-controls={`${base}-painel`}
              tabIndex={sel ? 0 : -1}
              className={n.secao}
              onClick={() => setAtiva(a.key)}
            >
              {a.label}
            </button>
          );
        })}
      </Trilho>
      <div id={`${base}-painel`} role="tabpanel" aria-labelledby={`${base}-aba-${atual.key}`}>
        <Comp />
      </div>
    </div>
  );
}
