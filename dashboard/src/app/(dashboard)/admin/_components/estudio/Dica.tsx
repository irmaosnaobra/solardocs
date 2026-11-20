'use client';

import { useId, useState } from 'react';
import f from './fabricas.module.css';

interface Props { texto: string; rotulo?: string; lado?: 'esquerda' | 'direita' }

/** O "(?)": a explicação fica escondida e abre no toque, no foco ou ao passar o mouse. */
export default function Dica({ texto, rotulo = 'O que é isso?', lado = 'esquerda' }: Props) {
  const id = useId();
  const [aberta, setAberta] = useState(false);
  return (
    <span className={f.dica} data-lado={lado}>
      <button
        type="button"
        className={f.dicaBotao}
        aria-label={rotulo}
        aria-describedby={id}
        aria-expanded={aberta}
        onClick={() => setAberta((v) => !v)}
        onBlur={() => setAberta(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setAberta(false); }}
      >
        ?
      </button>
      <span role="tooltip" id={id} className={f.dicaTexto} data-aberta={aberta || undefined}>
        {texto}
      </span>
    </span>
  );
}
