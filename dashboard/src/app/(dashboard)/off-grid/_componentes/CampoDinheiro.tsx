'use client';

import { lerDinheiro, formatarDinheiro } from '@/lib/offgrid/dinheiro';

/**
 * Campo de dinheiro: `type="text" inputmode="decimal"`, lido por lerDinheiro ("52.700", "52700", "52.700,50",
 * "52700,5" valem o que parecem). Guarda o texto digitado e só formata ao sair do campo.
 *
 * Com `auto` ligado o campo mostra o valor sugerido (`valorBase`) até a pessoa digitar. Apagou tudo e saiu? A
 * sugestão volta.
 */
export function CampoDinheiro({
  id, valorBase, auto, texto, onTexto, onRetomarAuto, rotulo, className = '',
}: {
  id: string;
  valorBase: number;
  auto: boolean;
  texto: string;
  onTexto: (t: string) => void;
  onRetomarAuto: () => void;
  rotulo?: string;
  className?: string;
}) {
  return (
    <input
      id={id}
      className={`og-input ${className}`}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={rotulo}
      value={auto ? formatarDinheiro(valorBase) : texto}
      onChange={(ev) => onTexto(ev.target.value)}
      onBlur={() => {
        if (auto) return;
        if (!texto.trim()) { onRetomarAuto(); return; }
        const v = lerDinheiro(texto);
        if (v > 0) onTexto(formatarDinheiro(v));
      }}
    />
  );
}
