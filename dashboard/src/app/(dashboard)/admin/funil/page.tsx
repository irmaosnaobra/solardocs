'use client';

import FunilSolarDocPanel from '../_components/FunilSolarDocPanel';
import PixFunilPanel from '../_components/PixFunilPanel';

export default function FunilPage() {
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      <FunilSolarDocPanel />
      {/* Bloco separado: o Pix é um desvio de quem largou o cartão, não uma
          etapa do funil principal. Somar os dois estragaria as porcentagens. */}
      <PixFunilPanel />
    </div>
  );
}
