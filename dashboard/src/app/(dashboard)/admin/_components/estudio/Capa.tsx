'use client';

import { useState } from 'react';
import s from './estudio.module.css';

interface Props { url: string | null; numero: number; titulo: string; largura: number }

/** Capa 9:16 do episódio. Sem url, ou se a imagem falhar, vira a capa desenhada. */
export default function Capa({ url, numero, titulo, largura }: Props) {
  const [falhou, setFalhou] = useState(false);
  const altura = Math.round((largura * 16) / 9);
  const nn = String(numero).padStart(2, '0');

  if (url && !falhou) {
    return (
      // A capa vem de host externo variável e é miniatura: <img> com lazy basta.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`Capa do episódio ${nn}, ${titulo}`}
        width={largura}
        height={altura}
        loading="lazy"
        decoding="async"
        className={s.capa}
        onError={() => setFalhou(true)}
      />
    );
  }
  return (
    <span className={s.capaDesenho} style={{ width: largura, height: altura, padding: `0 0 ${Math.round(largura * 0.1)}px ${Math.round(largura * 0.12)}px` }} role="img" aria-label={`Episódio ${nn}, sem capa`}>
      <span className={s.capaEp}>EP</span>
      <span className={s.capaNum} style={{ fontSize: Math.round(largura * 0.46) }}>{nn}</span>
    </span>
  );
}
