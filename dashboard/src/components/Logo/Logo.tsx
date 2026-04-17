'use client';

interface LogoProps {
  className?: string;
}

export default function Logo({ className }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 280 256"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SolarDoc Pro"
    >
      {/* ── SOL ── */}
      <circle cx="178" cy="44" r="26" fill="#FFC107" />
      <polygon points="178,10 174,21 182,21" fill="#FFC107" />
      <polygon points="201,20 193,27 200,35" fill="#FFC107" />
      <polygon points="212,44 202,40 202,48" fill="#FFC107" />
      <polygon points="201,68 193,61 200,53" fill="#FFC107" />
      <polygon points="178,78 174,67 182,67" fill="#FFC107" />
      <polygon points="156,68 160,58 166,66" fill="#FFC107" opacity="0.5" />

      {/* ── DOCUMENTO (fundo âmbar) ── */}
      <path
        fill="#F59E0B"
        d="M58,20 L148,20 L182,54 L182,172 Q182,184 170,184 L58,184 Q46,184 46,172 L46,32 Q46,20 58,20 Z"
      />
      {/* página interna branca */}
      <path
        fill="#F8FAFC"
        d="M58,36 L148,36 L148,54 L166,54 L166,170 Q166,172 164,172 L58,172 Q56,172 56,170 L56,38 Q56,36 58,36 Z"
      />
      {/* dobra (canto) */}
      <polygon points="148,20 182,54 148,54" fill="#B45309" />

      {/* ── LINHAS DE TEXTO ── */}
      <rect x="66" y="52" width="62" height="7" rx="3" fill="#F59E0B" opacity="0.8" />
      <rect x="66" y="65" width="47" height="7" rx="3" fill="#F59E0B" opacity="0.5" />

      {/* ── PAINÉIS SOLARES (fixos, sem clipPath) ── */}
      <g transform="translate(56,90) rotate(-14,56,46)">
        {/* row 1 */}
        <rect x="0"  y="0" width="30" height="22" rx="2" fill="#1D4ED8" />
        <line x1="0"  y1="8"  x2="30" y2="8"  stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="0"  y1="15" x2="30" y2="15" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="15" y1="0"  x2="15" y2="22" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />

        <rect x="34" y="0" width="30" height="22" rx="2" fill="#1D4ED8" />
        <line x1="34" y1="8"  x2="64" y2="8"  stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="34" y1="15" x2="64" y2="15" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="49" y1="0"  x2="49" y2="22" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />

        <rect x="68" y="0" width="30" height="22" rx="2" fill="#1D4ED8" />
        <line x1="68" y1="8"  x2="98" y2="8"  stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="68" y1="15" x2="98" y2="15" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="83" y1="0"  x2="83" y2="22" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />

        {/* row 2 */}
        <rect x="0"  y="26" width="30" height="22" rx="2" fill="#1D4ED8" />
        <line x1="0"  y1="34" x2="30" y2="34" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="0"  y1="41" x2="30" y2="41" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="15" y1="26" x2="15" y2="48" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />

        <rect x="34" y="26" width="30" height="22" rx="2" fill="#1D4ED8" />
        <line x1="34" y1="34" x2="64" y2="34" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="34" y1="41" x2="64" y2="41" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="49" y1="26" x2="49" y2="48" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />

        <rect x="68" y="26" width="30" height="22" rx="2" fill="#1D4ED8" />
        <line x1="68" y1="34" x2="98" y2="34" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="68" y1="41" x2="98" y2="41" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
        <line x1="83" y1="26" x2="83" y2="48" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" />
      </g>

      {/* ── DIVISOR ── */}
      <line x1="46" y1="196" x2="234" y2="196" stroke="#F59E0B" strokeWidth="1" opacity="0.3" />

      {/* ── TEXTO SOLARDOC ── */}
      <text
        x="5" y="237"
        fontFamily="Impact, 'Arial Black', Arial, sans-serif"
        fontSize="40"
        fill="#F59E0B"
        letterSpacing="2"
      >
        SOLARDOC
      </text>

      {/* ── BADGE PRO ── */}
      <rect x="200" y="212" width="66" height="30" rx="8" fill="#DC2626" />
      <text
        x="233" y="233"
        fontFamily="Impact, Arial, sans-serif"
        fontSize="16"
        fill="white"
        textAnchor="middle"
        letterSpacing="2"
      >
        PRO
      </text>
    </svg>
  );
}
