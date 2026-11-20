'use client';

// Ilustrações próprias do Estúdio: um glifo por linha de conteúdo e uma cena por
// fábrica. SVG de traço, monocromático (currentColor), sem foto de pessoa real.
import { useState } from 'react';
import Image from 'next/image';
import type { FabricaId, Personagem } from './tipos';
import f from './fabricas.module.css';

export const LINHAS: Record<string, string> = {
  solar: 'Solar',
  energia: 'Energia',
  historia: 'História',
  eletroposto: 'Eletroposto',
  guerra: 'Guerra',
};

const traco = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const chapa = { fill: 'currentColor', fillOpacity: 0.16 };

/** Glifo 64x64 da linha. Sem linha conhecida, vira a claquete neutra. */
export function GlifoLinha({ linha, size = 40 }: { linha?: string; size?: number }) {
  const comum = { width: size, height: size, viewBox: '0 0 64 64', 'aria-hidden': true as const, focusable: false as const };
  switch (linha) {
    case 'solar':
      return (
        <svg {...comum}>
          <g {...traco}>
            <circle cx="45" cy="17" r="7" {...chapa} />
            <path d="M55 17h3M52.1 24.1l2.1 2.1M45 27v3M37.9 24.1l-2.1 2.1M35 17h-3M37.9 9.9l-2.1-2.1M45 7V4M52.1 9.9l2.1-2.1" />
            <path d="M8 52 17 34h32l-7 18Z" {...chapa} />
            <path d="M12.5 43h33M27.7 34l-8.4 18M38.3 34l-7.6 18M25 52v6M18 58h14" />
          </g>
        </svg>
      );
    case 'energia':
      return (
        <svg {...comum}>
          <g {...traco}>
            <path d="M27 6 13 33h11l-4 25 17-31H27l4-21Z" {...chapa} />
            <circle cx="47" cy="40" r="11" {...chapa} />
          </g>
          <g fill="currentColor">
            <circle cx="43" cy="38" r="1.9" />
            <circle cx="51" cy="38" r="1.9" />
            <circle cx="47" cy="44" r="1.7" />
          </g>
        </svg>
      );
    case 'historia':
      return (
        <svg {...comum}>
          <g {...traco}>
            <circle cx="32" cy="11" r="3.5" />
            <path d="M29.5 15h5v4h-5z" />
            <circle cx="32" cy="38" r="17" {...chapa} />
            <circle cx="32" cy="38" r="13" strokeOpacity={0.45} />
            <path d="M32 26.5v3M43.5 38h-3M32 49.5v-3M20.5 38h3M32 38v-9M32 38l6.5 4" />
          </g>
          <circle cx="32" cy="38" r="1.8" fill="currentColor" />
        </svg>
      );
    case 'eletroposto':
      return (
        <svg {...comum}>
          <g {...traco}>
            <rect x="12" y="8" width="24" height="46" rx="5" {...chapa} />
            <rect x="17" y="14" width="14" height="11" rx="2" />
            <circle cx="24" cy="37" r="4" />
            <path d="M8 56h32M36 31c13 0 15 9 13 16" />
            <rect x="44" y="47" width="10" height="9" rx="2" {...chapa} />
            <path d="M47 56v3M51 56v3" />
          </g>
          <path d="M25 15.5 21.5 20.5h3l-1.5 3 4-5h-3l1.5-3Z" fill="currentColor" />
        </svg>
      );
    case 'guerra':
      return (
        <svg {...comum}>
          <g {...traco}>
            <path d="M12 42c0-16 9-25 20-25s20 9 20 25Z" {...chapa} />
            <path d="M7 42h50" />
            <path d="M18 31c8-4 20-4 28 0" strokeOpacity={0.5} />
            <path d="M18 42c2 7 8 11 14 11s12-4 14-11" strokeOpacity={0.55} />
          </g>
        </svg>
      );
    default:
      return (
        <svg {...comum}>
          <g {...traco}>
            <rect x="10" y="24" width="44" height="30" rx="4" {...chapa} />
            <path d="m10 24 40-10 2 8M20 21.5l6 6M32 18.5l6 6" />
          </g>
        </svg>
      );
  }
}

/** Arte do vídeo: ilustração da linha e, se houver, a capa real por cima. */
export function ArteVideo({ linha, capaUrl, titulo }: { linha?: string; capaUrl?: string; titulo: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <span className={f.arte} data-linha={linha ?? 'outra'}>
      <span className={f.arteGlifo}><GlifoLinha linha={linha} size={38} /></span>
      {capaUrl && capaUrl.startsWith('https://') && !falhou ? (
        // Capa de host externo (Cloudinary) e miniatura: <img> com lazy basta.
        <img
          src={capaUrl}
          alt={`Capa: ${titulo}`}
          width={160}
          height={100}
          loading="lazy"
          decoding="async"
          className={f.arteCapa}
          onError={() => setFalhou(true)}
        />
      ) : null}
    </span>
  );
}

/** Cena do topo de cada cartão de fábrica. */
export function CenaFabrica({ id, personagem }: { id: FabricaId; personagem?: Personagem }) {
  if (id === 'irmaos-na-obra') {
    const img = personagem?.imagemUrl ?? '/admin/estudio/protagonista.png';
    return (
      <span className={f.cena} data-cena="obra">
        <svg className={f.cenaFundo} viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="cena-sol" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffcf6b" stopOpacity="0.95" />
              <stop offset="0.55" stopColor="#ff9a3d" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="226" cy="66" r="70" fill="url(#cena-sol)" />
          <g stroke="#ffd08a" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round">
            <path d="M226 6v-12M266 22l8-9M186 22l-8-9M290 66h12M150 66h-12" />
          </g>
          <path d="M0 126h320" stroke="rgba(226,234,245,0.18)" />
        </svg>
        <span className={f.cenaGlifos} aria-hidden="true">
          <span data-linha="solar"><GlifoLinha linha="solar" size={34} /></span>
          <span data-linha="energia"><GlifoLinha linha="energia" size={30} /></span>
          <span data-linha="historia"><GlifoLinha linha="historia" size={28} /></span>
          <span data-linha="eletroposto"><GlifoLinha linha="eletroposto" size={30} /></span>
        </span>
        <Image src={img} alt="" width={114} height={298} className={f.cenaBoneco} priority />
      </span>
    );
  }
  if (id === 'youtube') {
    return (
      <span className={f.cena} data-cena="youtube">
        <svg className={f.cenaFundo} viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
          <g fill="none" stroke="rgba(226,234,245,0.28)" strokeWidth="1.5">
            <rect x="22" y="44" width="30" height="54" rx="5" />
            <rect x="268" y="44" width="30" height="54" rx="5" />
          </g>
          <g stroke="rgba(255,179,107,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 5" fill="none">
            <path d="M56 71h20M264 71h-20" />
          </g>
          <rect x="80" y="18" width="160" height="96" rx="9" fill="rgba(226,234,245,0.05)" stroke="rgba(226,234,245,0.42)" strokeWidth="1.5" />
          <circle cx="160" cy="60" r="18" fill="#ff7a1a" />
          <path d="M154 51.5 168 60l-14 8.5Z" fill="#1a0d03" />
          <path d="M92 102h136" stroke="rgba(226,234,245,0.22)" strokeWidth="3" strokeLinecap="round" />
          <path d="M92 102h38" stroke="#ff7a1a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="130" cy="102" r="4" fill="#ffb36b" />
          <text x="228" y="94" textAnchor="end" fill="rgba(237,241,246,0.7)" fontSize="10" fontFamily="ui-monospace, monospace">22:00</text>
        </svg>
      </span>
    );
  }
  return (
    <span className={f.cena} data-cena="guerra">
      <svg className={f.cenaFundo} viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="cena-furos" width="16" height="12" patternUnits="userSpaceOnUse">
            <rect x="4" y="3" width="8" height="6" rx="1.5" fill="rgba(226,234,245,0.2)" />
          </pattern>
        </defs>
        <rect x="0" y="14" width="320" height="112" fill="rgba(169,176,143,0.08)" />
        <rect x="0" y="14" width="320" height="12" fill="url(#cena-furos)" />
        <rect x="0" y="114" width="320" height="12" fill="url(#cena-furos)" />
        <g fill="none" stroke="rgba(226,234,245,0.18)" strokeWidth="1.5">
          <rect x="18" y="32" width="84" height="76" rx="3" />
          <rect x="218" y="32" width="84" height="76" rx="3" />
        </g>
        <path d="M24 92c14-8 26-4 38-9s22-2 34 2M224 88c16-6 30 2 44-4s20-1 28 1" stroke="rgba(169,176,143,0.45)" strokeWidth="1.5" fill="none" />
        <rect x="114" y="28" width="92" height="84" rx="3" fill="rgba(169,176,143,0.1)" stroke="rgba(214,220,190,0.55)" strokeWidth="1.5" />
      </svg>
      <span className={f.cenaCentro} data-linha="guerra"><GlifoLinha linha="guerra" size={58} /></span>
    </span>
  );
}
